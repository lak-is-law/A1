import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ChessEngineInputError,
  getBestMoveForChessFen,
  validateChessFen,
  type ChessDifficulty,
} from "@/lib/ai/chessEngine";

const MoveReqSchema = z.object({
  game: z.enum(["chess", "baduk"]).default("chess"),
  difficulty: z.enum(["adaptive", "easy", "medium", "hard", "god"]).default("adaptive"),
  time_ms: z.number().int().min(50).max(10000).default(2500),

  fen: z.string().optional(),
  size: z.number().int().min(5).max(13).default(9),
  to_play: z.enum(["black", "white"]).optional(),
  komi: z.number().default(7.5),
  board: z.array(z.number().int()).optional(), // row-major; 0 empty, 1 black, -1 white
});

export const runtime = "nodejs";

function difficultyToDepth(difficulty: ChessDifficulty | "god", timeMs: number): number {
  if (difficulty === "easy") return 2;
  if (difficulty === "medium") return 3;
  if (difficulty === "hard") return 5;
  if (difficulty === "god") return 5;

  // Adaptive: scale with time budget.
  if (timeMs <= 1200) return 2;
  if (timeMs <= 2000) return 3;
  if (timeMs <= 3000) return 4;
  return 5;
}

type Stone = 1 | 0 | -1; // 1 black, -1 white, 0 empty

function idxOf(r: number, c: number, size: number) {
  return r * size + c;
}

function neighbors4(idx: number, size: number) {
  const r = Math.floor(idx / size);
  const c = idx % size;
  const out: number[] = [];
  if (r > 0) out.push(idxOf(r - 1, c, size));
  if (r < size - 1) out.push(idxOf(r + 1, c, size));
  if (c > 0) out.push(idxOf(r, c - 1, size));
  if (c < size - 1) out.push(idxOf(r, c + 1, size));
  return out;
}

function groupAndLiberties(board: Stone[], start: number, size: number) {
  const color = board[start];
  const visited = new Set<number>([start]);
  const stones: number[] = [];
  const liberties = new Set<number>();

  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    stones.push(cur);
    for (const nb of neighbors4(cur, size)) {
      const v = board[nb];
      if (v === 0) {
        liberties.add(nb);
      } else if (v === color && !visited.has(nb)) {
        visited.add(nb);
        stack.push(nb);
      }
    }
  }

  return { stones, libertiesCount: liberties.size };
}

function applyMove(board: Stone[], move: number, toPlay: Stone, size: number) {
  const next = board.slice() as Stone[];
  next[move] = toPlay;

  // Capture adjacent opponent groups with no liberties.
  const opp = (toPlay === 1 ? -1 : 1) as Stone;
  let captured = 0;

  for (const nb of neighbors4(move, size)) {
    if (next[nb] !== opp) continue;
    const { stones, libertiesCount } = groupAndLiberties(next, nb, size);
    if (libertiesCount === 0) {
      captured += stones.length;
      for (const s of stones) next[s] = 0;
    }
  }

  return { next, captured };
}

function isLegalMove(board: Stone[], move: number, toPlay: Stone, size: number) {
  if (board[move] !== 0) return false;

  const { next } = applyMove(board, move, toPlay, size);
  // Suicide is illegal: the placed stone's group must have liberties.
  const { libertiesCount } = groupAndLiberties(next, move, size);
  return libertiesCount > 0;
}

function moveToBadukString(move: number, size: number) {
  const r = Math.floor(move / size);
  const c = move % size;
  return `${r},${c}`;
}

function parseBadukMoveString(move: string, size: number): number | null {
  if (move === "pass") return null;
  const parts = move.split(",");
  if (parts.length !== 2) return null;
  const r = Number(parts[0]);
  const c = Number(parts[1]);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
  if (r < 0 || r >= size || c < 0 || c >= size) return null;
  return idxOf(r, c, size);
}

function legalMovesFor(board: Stone[], toPlay: Stone, size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0) continue;
    if (isLegalMove(board, i, toPlay, size)) out.push(i);
  }
  return out;
}

async function requestExternalGodMove(params: {
  board: Stone[];
  size: number;
  toPlay: Stone;
  komi: number;
  timeMs: number;
}): Promise<
  | { ok: true; move: number | null; depth: number; nodes: number; score: number }
  | { ok: false; reason: string }
> {
  const url = process.env.BADUK_GOD_API_URL?.trim();
  if (!url) {
    return { ok: false, reason: "BADUK_GOD_API_URL is not configured" };
  }

  const apiKey = process.env.BADUK_GOD_API_KEY?.trim();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  try {
    const timeoutMs = Math.min(6000, Math.max(400, params.timeMs + 600));
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game: "baduk",
        difficulty: "god",
        size: params.size,
        to_play: params.toPlay === 1 ? "black" : "white",
        komi: params.komi,
        board: params.board,
        time_ms: params.timeMs,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { ok: false, reason: `God provider returned HTTP ${res.status}` };
    }
    const data = (await res.json()) as { move?: unknown; depth?: unknown; nodes?: unknown; score?: unknown };
    if (typeof data.move !== "string") {
      return { ok: false, reason: "God provider response missing move string" };
    }

    const parsedMove = parseBadukMoveString(data.move, params.size);
    if (parsedMove !== null && !isLegalMove(params.board, parsedMove, params.toPlay, params.size)) {
      return { ok: false, reason: "God provider returned illegal move" };
    }

    const depth = typeof data.depth === "number" ? data.depth : 0;
    const nodes = typeof data.nodes === "number" ? data.nodes : 0;
    const score = typeof data.score === "number" ? data.score : 0;
    return { ok: true, move: parsedMove, depth, nodes, score };
  } catch {
    return { ok: false, reason: "God provider request failed or timed out" };
  }
}

export async function POST(req: Request) {
  const json = await req.json();
  const parsed = MoveReqSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const payload = parsed.data;

  try {
    if (payload.game === "baduk") {
      const size = payload.size;
      const boardLen = size * size;

      const toPlay: Stone = payload.to_play === "white" ? -1 : 1; // default to black

      const board: Stone[] = (() => {
        if (!payload.board) return new Array(boardLen).fill(0) as Stone[];
        if (payload.board.length !== boardLen) return [] as Stone[];
        return payload.board.map((x) => (x === 1 ? 1 : x === -1 ? -1 : 0)) as Stone[];
      })();

      if (board.length !== boardLen) {
        return NextResponse.json({ error: "Invalid baduk board size" }, { status: 400 });
      }

      // MVP: no ko rule, but we do enforce suicide and captures.
      const legalMoves = legalMovesFor(board, toPlay, size);

      if (!legalMoves.length) {
        return NextResponse.json(
          { move: "pass", depth: 0, nodes: 0, score: 0 },
          { status: 200 }
        );
      }

      if (payload.difficulty === "god") {
        const external = await requestExternalGodMove({
          board,
          size,
          toPlay,
          komi: payload.komi,
          timeMs: Math.min(4200, payload.time_ms),
        });
        if (external.ok) {
          return NextResponse.json(
            {
              move: external.move === null ? "pass" : moveToBadukString(external.move, size),
              depth: external.depth || 12,
              nodes: external.nodes,
              score: external.score,
            },
            { status: 200 }
          );
        }
        return NextResponse.json(
          {
            error: `God mode requires external Baduk API: ${external.reason}`,
          },
          { status: 503 }
        );
      }

      // Baseline heuristic for non-god mode.
      let bestMove: number = legalMoves[0];
      let bestCaptured = -1;
      let bestLiberties = -1;

      for (const m of legalMoves) {
        const { next, captured } = applyMove(board, m, toPlay, size);
        const { libertiesCount } = groupAndLiberties(next, m, size);
        if (
          captured > bestCaptured ||
          (captured === bestCaptured && libertiesCount > bestLiberties) ||
          (captured === bestCaptured && libertiesCount === bestLiberties && m < bestMove)
        ) {
          bestMove = m;
          bestCaptured = captured;
          bestLiberties = libertiesCount;
        }
      }

      return NextResponse.json(
        {
          move: moveToBadukString(bestMove, size),
          depth: 1,
          nodes: 0,
          score: bestCaptured, // simple proxy for UI
        },
        { status: 200 }
      );
    }

    const fen = payload.fen?.trim();
    if (!fen) {
      return NextResponse.json({ error: "Missing FEN (fen) for chess" }, { status: 400 });
    }

    const fenValidation = validateChessFen(fen);
    if (!fenValidation.ok) {
      return NextResponse.json(
        { error: fenValidation.error ?? "Invalid FEN" },
        { status: 400 }
      );
    }

    const maxDepth = difficultyToDepth(payload.difficulty, payload.time_ms);

    // Hard cap for response time. (Requirement: < 2 seconds)
    const maxTimeMs = Math.min(payload.time_ms, 1900);

    const rootColor = payload.to_play
      ? payload.to_play === "white"
        ? "w"
        : "b"
      : undefined;

    const result = getBestMoveForChessFen({
      fen,
      maxDepth,
      maxTimeMs,
      rootColor,
    });

    return NextResponse.json(
      {
        // Required by your spec:
        bestMove: result.bestMove,
        evaluation: result.evaluation,
        depth: result.depth,

        // Kept for compatibility with existing UI:
        move: result.bestMove,
        score: result.score,
        nodes: result.nodes,
      },
      { status: 200 }
    );
  } catch (e) {
    if (e instanceof ChessEngineInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    const message = e instanceof Error ? e.message : "Engine error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

