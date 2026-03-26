"use client";

import { getStockfishMove } from "./stockfish";

export type ChessAiMode = "stockfish" | "minimax";

export type ChessBestMoveResult = {
  bestMove: string;
  source: ChessAiMode;
  /** Approximate advantage for White (+ = White better). */
  whiteAdvantage?: number;
  mateForWhite?: number;
  depth?: number;
  nodes?: number;
  /** Minimax root evaluation in engine units (side-to-move perspective). */
  rawEvaluation?: number;
};

function parseSideToMove(fen: string): "w" | "b" {
  const t = fen.trim().split(/\s+/)[1];
  return t === "b" ? "b" : "w";
}

/** Engine `/api` evaluation is from the perspective of the side to move at root. */
function minimaxToWhitePerspective(fen: string, evaluation: number): number {
  const stm = parseSideToMove(fen);
  return stm === "w" ? evaluation : -evaluation;
}

export function describeEvaluation(whiteAdv: number | undefined, mateForWhite?: number): string {
  if (mateForWhite !== undefined && mateForWhite !== 0) {
    if (mateForWhite > 0) return "You are winning (mate on the board)";
    return "AI dominating (mate on the board)";
  }
  if (whiteAdv === undefined) return "";
  if (whiteAdv > 180) return "You are winning";
  if (whiteAdv < -180) return "AI dominating";
  if (whiteAdv > 60) return "You have a slight edge";
  if (whiteAdv < -60) return "AI has a slight edge";
  return "Roughly equal";
}

type MinimaxOptions = {
  difficulty?: "adaptive" | "easy" | "medium" | "hard";
  time_ms?: number;
};

async function postMinimax(fen: string, opts?: MinimaxOptions): Promise<ChessBestMoveResult> {
  const res = await fetch("/api/engine/move", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fen,
      game: "chess",
      difficulty: opts?.difficulty ?? "adaptive",
      time_ms: opts?.time_ms ?? 2500,
    }),
  });

  const data: unknown = await res.json();
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : "Minimax engine error";
    throw new Error(msg);
  }

  const bestMove =
    data && typeof data === "object"
      ? String((data as { bestMove?: unknown }).bestMove ?? (data as { move?: unknown }).move ?? "")
      : "";

  if (!bestMove) throw new Error("Minimax did not return bestMove");

  const evaluation =
    data && typeof data === "object" && typeof (data as { evaluation?: unknown }).evaluation === "number"
      ? (data as { evaluation: number }).evaluation
      : undefined;

  const depth =
    data && typeof data === "object" && typeof (data as { depth?: unknown }).depth === "number"
      ? (data as { depth: number }).depth
      : undefined;

  const nodes =
    data && typeof data === "object" && typeof (data as { nodes?: unknown }).nodes === "number"
      ? (data as { nodes: number }).nodes
      : undefined;

  const whiteAdvantage =
    evaluation !== undefined && Number.isFinite(evaluation) ? minimaxToWhitePerspective(fen, evaluation) : undefined;

  return {
    bestMove,
    source: "minimax",
    whiteAdvantage,
    mateForWhite: undefined,
    depth,
    nodes,
    rawEvaluation: evaluation,
  };
}

/**
 * Hybrid move picker: Stockfish in-browser (Worker + WASM) or server minimax, with Stockfish → minimax fallback.
 */
export async function getBestMove(
  mode: ChessAiMode,
  fen: string,
  opts?: {
    stockfish?: { depth?: number; timeoutMs?: number };
    minimax?: MinimaxOptions;
  }
): Promise<ChessBestMoveResult> {
  if (mode === "stockfish") {
    try {
      const r = await getStockfishMove(fen, {
        depth: opts?.stockfish?.depth ?? 15,
        timeoutMs: opts?.stockfish?.timeoutMs ?? 45_000,
      });
      const mateForWhite = r.score?.mateWhite;
      const whiteAdvantage = r.score?.cpWhite;
      return {
        bestMove: r.bestMove,
        source: "stockfish",
        whiteAdvantage,
        mateForWhite,
        depth: opts?.stockfish?.depth ?? 15,
      };
    } catch {
      return postMinimax(fen, opts?.minimax);
    }
  }

  return postMinimax(fen, opts?.minimax);
}
