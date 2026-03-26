import { Chess, SQUARES, validateFen, type Color, type Move, type Square } from "chess.js";

export type ChessDifficulty = "easy" | "medium" | "hard" | "adaptive";

export type ChessEngineResult = {
  bestMove: string;
  evaluation: number;
  depth: number; // depth actually completed
  nodes: number; // nodes visited in minimax
  score: number; // alias of evaluation (for UI compatibility)
};

export class ChessEngineInputError extends Error {
  public readonly code: "INVALID_FEN" | "TURN_MISMATCH";

  constructor(message: string, code: "INVALID_FEN" | "TURN_MISMATCH") {
    super(message);
    this.code = code;
  }
}

type TTFlag = "EXACT" | "LOWERBOUND" | "UPPERBOUND";
type TTEntry = {
  depth: number;
  value: number;
  flag: TTFlag;
  bestMove?: string;
};

const PIECE_VALUE: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
};

// Scale everything to "centi-pawns-ish" so alpha-beta comparisons remain stable.
const MATERIAL_SCALE = 100;
const CONTROL_SCALE = 3;
const KING_SAFETY_SCALE = 25;

const MATE_SCORE = 1_000_000;
const INF = 1_200_000_000;

function moveToUci(move: Move): string {
  const promotion = move.promotion ? move.promotion : "";
  return `${move.from}${move.to}${promotion}`;
}

function getThreatSquares(kingSq: Square, adj: Record<Square, Square[]>): Square[] {
  return [kingSq, ...adj[kingSq]];
}

function buildAdjacencyMap(): Record<Square, Square[]> {
  const adj = {} as Record<Square, Square[]>;

  for (const sq of SQUARES) {
    const file = sq.charCodeAt(0) - 97; // a=0
    const rank = Number(sq[1]) - 1; // 1=0

    const neighbors: Square[] = [];
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const nf = file + df;
        const nr = rank + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const nsq = `${String.fromCharCode(97 + nf)}${nr + 1}` as Square;
        neighbors.push(nsq);
      }
    }
    adj[sq] = neighbors;
  }

  return adj;
}

const ADJACENT_SQUARES = buildAdjacencyMap();

export function validateChessFen(fen: string): { ok: boolean; error?: string } {
  return validateFen(fen);
}

function countAttackedSquares(chess: Chess, attackedBy: Color): number {
  let count = 0;
  for (const sq of SQUARES) {
    if (chess.isAttacked(sq, attackedBy)) count++;
  }
  return count;
}

function evaluateWhitePerspective(chess: Chess): number {
  // Material
  let whiteMaterial = 0;
  let blackMaterial = 0;
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell) continue;
      const val = PIECE_VALUE[cell.type] ?? 0;
      if (cell.color === "w") whiteMaterial += val;
      else blackMaterial += val;
    }
  }
  const materialDiff = whiteMaterial - blackMaterial;

  // Board control (attacked square count)
  const controlWhite = countAttackedSquares(chess, "w");
  const controlBlack = countAttackedSquares(chess, "b");
  const controlDiff = controlWhite - controlBlack;

  // King safety: number of squares (king + adjacent) attacked by the opponent
  const whiteKingSq = chess.findPiece({ type: "k", color: "w" })[0];
  const blackKingSq = chess.findPiece({ type: "k", color: "b" })[0];

  const threatWhite = whiteKingSq ? getThreatSquares(whiteKingSq, ADJACENT_SQUARES).reduce((acc, sq) => acc + (chess.isAttacked(sq, "b") ? 1 : 0), 0) : 0;
  const threatBlack = blackKingSq ? getThreatSquares(blackKingSq, ADJACENT_SQUARES).reduce((acc, sq) => acc + (chess.isAttacked(sq, "w") ? 1 : 0), 0) : 0;

  // Positive means White is safer than Black.
  const kingSafetyDiff = threatBlack - threatWhite;

  return materialDiff * MATERIAL_SCALE + controlDiff * CONTROL_SCALE + kingSafetyDiff * KING_SAFETY_SCALE;
}

function evaluateFromRootPerspective(chess: Chess, rootColor: Color): number {
  const whiteEval = evaluateWhitePerspective(chess);
  return rootColor === "w" ? whiteEval : -whiteEval;
}

class EngineTimeout extends Error {
  constructor() {
    super("Engine timeout");
  }
}

export function getBestMoveForChessFen(params: {
  fen: string;
  maxDepth: number;
  maxTimeMs: number;
  rootColor?: Color;
}): ChessEngineResult {
  const validation = validateFen(params.fen);
  if (!validation.ok) {
    throw new ChessEngineInputError(validation.error ?? "Invalid FEN", "INVALID_FEN");
  }

  const chess = new Chess(params.fen);
  const rootColor = params.rootColor ?? chess.turn();
  if (chess.turn() !== rootColor) {
    throw new ChessEngineInputError(`Provided to_play does not match FEN side-to-move`, "TURN_MISMATCH");
  }

  const stopAt = Date.now() + Math.max(25, params.maxTimeMs);

  const tt = new Map<string, TTEntry>();
  let nodes = 0;
  let bestMove = "";
  let bestValue = 0;
  let depthUsed = 0;

  // Order moves by simple heuristics (captures/promotions/check).
  const orderMoves = (moves: Move[], ttBestMove?: string): Move[] => {
    if (moves.length <= 1) return moves;

    const scored = moves.map((m) => {
      const uci = moveToUci(m);

      // Put TT move first if present.
      const ttFirst = ttBestMove && uci === ttBestMove ? 100_000 : 0;

      const captured = m.captured ? PIECE_VALUE[m.captured] ?? 0 : 0;
      const movingPiece = PIECE_VALUE[m.piece] ?? 0;
      const captureScore = captured ? captured * 10 - movingPiece : 0;

      const promotionScore = m.promotion ? (PIECE_VALUE[m.promotion] ?? 0) * 25 : 0;

      const checkScore = m.san.endsWith("+") || m.san.endsWith("#") ? 45 : 0;

      return { m, s: ttFirst + captureScore + promotionScore + checkScore };
    });

    scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.m);
  };

  const alphabeta = (depth: number, alpha: number, beta: number, ply: number): number => {
    nodes++;
    if (Date.now() >= stopAt) throw new EngineTimeout();

    // Transposition table probe (works for both terminal and non-terminal nodes).
    const key = chess.hash(); // position hash
    const entry = tt.get(key);
    if (entry && entry.depth >= depth) {
      if (entry.flag === "EXACT") return entry.value;
      if (entry.flag === "LOWERBOUND") alpha = Math.max(alpha, entry.value);
      if (entry.flag === "UPPERBOUND") beta = Math.min(beta, entry.value);
      if (alpha >= beta) return entry.value;
    }

    if (depth === 0 || chess.isGameOver()) {
      if (chess.isCheckmate()) {
        // Side to move is checkmated.
        const sideToMove = chess.turn();
        const mateDir = sideToMove === rootColor ? -1 : 1;
        const value = mateDir * (MATE_SCORE - ply);
        if (tt.size > 200000) tt.clear();
        tt.set(key, { depth, value, flag: "EXACT" });
        return value;
      }
      if (chess.isDraw() || chess.isStalemate() || chess.isInsufficientMaterial() || chess.isThreefoldRepetition() || chess.isDrawByFiftyMoves()) {
        if (tt.size > 200000) tt.clear();
        tt.set(key, { depth, value: 0, flag: "EXACT" });
        return 0;
      }
      const value = evaluateFromRootPerspective(chess, rootColor);
      if (tt.size > 200000) tt.clear();
      tt.set(key, { depth, value, flag: "EXACT" });
      return value;
    }

    const isMax = chess.turn() === rootColor;
    let bestValueLocal = isMax ? -INF : INF;
    let bestMoveLocal: string | undefined;

    const alpha0 = alpha;
    const beta0 = beta;

    const ttBestMove = entry?.bestMove;
    const moves = orderMoves(chess.moves({ verbose: true }) as Move[], ttBestMove);

    if (moves.length === 0) {
      // Should be covered by isGameOver(), but be safe.
      return evaluateFromRootPerspective(chess, rootColor);
    }

    for (const mv of moves) {
      const uci = moveToUci(mv);
      const moved = chess.move(
        mv.promotion
          ? { from: mv.from, to: mv.to, promotion: mv.promotion }
          : { from: mv.from, to: mv.to }
      );
      if (!moved) continue;
      try {
        const value = alphabeta(depth - 1, alpha, beta, ply + 1);
        if (isMax) {
          if (value > bestValueLocal) {
            bestValueLocal = value;
            bestMoveLocal = uci;
          }
          alpha = Math.max(alpha, bestValueLocal);
        } else {
          if (value < bestValueLocal) {
            bestValueLocal = value;
            bestMoveLocal = uci;
          }
          beta = Math.min(beta, bestValueLocal);
        }
        if (alpha >= beta) break;
      } finally {
        chess.undo();
      }
    }

    // Store TT entry.
    let flag: TTFlag = "EXACT";
    if (bestValueLocal <= alpha0) flag = "UPPERBOUND";
    else if (bestValueLocal >= beta0) flag = "LOWERBOUND";

    // Limit TT size to keep memory bounded.
    if (tt.size > 200000) tt.clear();
    tt.set(key, { depth, value: bestValueLocal, flag, bestMove: bestMoveLocal });

    return bestValueLocal;
  };

  // Root search: iterate moves so we can return the best move string.
  const rootSearch = (depth: number): { value: number; best: string } => {
    const isMax = chess.turn() === rootColor;

    let alpha = -INF;
    let beta = INF;

    let best = "";
    let bestVal = isMax ? -INF : INF;

    const key = chess.hash();
    const entry = tt.get(key);
    const ttBestMove = entry?.bestMove;

    const moves = orderMoves(chess.moves({ verbose: true }) as Move[], ttBestMove);
    if (moves.length === 0) return { value: evaluateFromRootPerspective(chess, rootColor), best: "" };

    for (const mv of moves) {
      const uci = moveToUci(mv);
      const moved = chess.move(
        mv.promotion
          ? { from: mv.from, to: mv.to, promotion: mv.promotion }
          : { from: mv.from, to: mv.to }
      );
      if (!moved) continue;
      try {
        const value = alphabeta(depth - 1, alpha, beta, 1);

        if (isMax) {
          if (value > bestVal) {
            bestVal = value;
            best = uci;
          }
          alpha = Math.max(alpha, bestVal);
        } else {
          if (value < bestVal) {
            bestVal = value;
            best = uci;
          }
          beta = Math.min(beta, bestVal);
        }
        if (alpha >= beta) break;
      } finally {
        chess.undo();
      }
    }

    return { value: bestVal, best };
  };

  const maxDepth = Math.max(1, Math.floor(params.maxDepth));

  // Iterative deepening to improve move ordering quickly.
  for (let d = 1; d <= maxDepth; d++) {
    if (Date.now() >= stopAt) break;
    try {
      const { value, best } = rootSearch(d);
      if (best) {
        bestMove = best;
        bestValue = value;
        depthUsed = d;
      }

      // If we have a forced mate (or very close), stop deepening.
      if (Math.abs(value) >= MATE_SCORE - d) break;
    } catch (e) {
      if (e instanceof EngineTimeout) break;
      throw e;
    }
  }

  // If the position is terminal, bestMove may stay empty (no legal moves).
  return {
    bestMove,
    evaluation: bestValue,
    depth: depthUsed,
    nodes,
    score: bestValue,
  };
}

