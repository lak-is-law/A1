"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Difficulty = "adaptive" | "medium" | "hard";
type Stone = 1 | 0 | -1; // 1 black, -1 white, 0 empty

const SIZE = 9;
const KOMI = 7.5;

function timeForDifficulty(d: Difficulty) {
  if (d === "medium") return 1300;
  if (d === "hard") return 2200;
  return 1700;
}

function idxOf(r: number, c: number) {
  return r * SIZE + c;
}

function neighbors(idx: number) {
  const r = Math.floor(idx / SIZE);
  const c = idx % SIZE;
  const out: number[] = [];
  if (r > 0) out.push(idxOf(r - 1, c));
  if (r < SIZE - 1) out.push(idxOf(r + 1, c));
  if (c > 0) out.push(idxOf(r, c - 1));
  if (c < SIZE - 1) out.push(idxOf(r, c + 1));
  return out;
}

function groupAndLiberties(board: Stone[], start: number) {
  const color = board[start];
  const visited = new Set<number>([start]);
  const stones: number[] = [];
  const liberties = new Set<number>();

  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    stones.push(cur);
    for (const nb of neighbors(cur)) {
      const v = board[nb];
      if (v === 0) {
        liberties.add(nb);
      } else if (v === color && !visited.has(nb)) {
        visited.add(nb);
        stack.push(nb);
      }
    }
  }
  return { stones, liberties: liberties.size };
}

function applyMove(board: Stone[], move: number | null, toPlay: Stone): Stone[] {
  if (move === null) return board.slice(); // PASS (no placement)
  const next = board.slice();
  next[move] = toPlay;

  // Capture adjacent opponent groups with no liberties.
  const opp = (toPlay === 1 ? -1 : 1) as Stone;
  for (const nb of neighbors(move)) {
    if (next[nb] !== opp) continue;
    const { stones, liberties } = groupAndLiberties(next, nb);
    if (liberties === 0) {
      for (const s of stones) next[s] = 0;
    }
  }
  return next;
}

function isLegalMove(board: Stone[], move: number | null, toPlay: Stone) {
  if (move === null) return true; // PASS always
  if (board[move] !== 0) return false;
  const next = applyMove(board, move, toPlay);
  const { liberties } = groupAndLiberties(next, move);
  return liberties > 0;
}

function stoneToCss(stone: Stone) {
  if (stone === 1) return { bg: "bg-black/90", shadow: "shadow-[0_0_20px_rgba(0,0,0,0.55)]" };
  if (stone === -1) return { bg: "bg-white/90", shadow: "shadow-[0_0_20px_rgba(255,255,255,0.35)]" };
  return null;
}

function parseAiMove(moveStr: string): number | null {
  if (moveStr === "pass") return null;
  const parts = moveStr.split(",");
  if (parts.length !== 2) return null;
  const r = Number(parts[0]);
  const c = Number(parts[1]);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
  return idxOf(r, c);
}

export function BadukVsAi({ difficulty }: { difficulty: Difficulty }) {
  const initialBoard = useMemo<Stone[]>(() => new Array(SIZE * SIZE).fill(0) as Stone[], []);
  const [timeline, setTimeline] = useState<Stone[][]>([initialBoard]);
  const [cursor, setCursor] = useState(0);
  const board = timeline[cursor];

  const playerToPlay: Stone = 1; // human plays black
  const aiToPlay: Stone = -1;
  const isPlayersTurn = cursor % 2 === 0;

  const [aiLoading, setAiLoading] = useState(false);
  const [aiMeta, setAiMeta] = useState<{ depth: number; nodes: number; score: number } | null>(null);

  const requestIdRef = useRef(0);

  const toPlay: Stone = isPlayersTurn ? playerToPlay : aiToPlay;

  const canPlay = !aiLoading && isPlayersTurn;

  async function requestAiMove(currentBoard: Stone[], currentCursor: number) {
    const requestId = ++requestIdRef.current;
    setAiLoading(true);
    setAiMeta(null);

    try {
      const res = await fetch("/api/engine/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          game: "baduk",
          difficulty,
          size: SIZE,
          to_play: toPlay === 1 ? "black" : "white",
          komi: KOMI,
          board: currentBoard,
          time_ms: timeForDifficulty(difficulty),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Engine error");
      if (requestId !== requestIdRef.current) return;

      const moveStr = data?.move as string | undefined;
      if (!moveStr) throw new Error("Missing move");
      const moveIdx = parseAiMove(moveStr);

      const nextBoard = moveIdx === null ? currentBoard.slice() : applyMove(currentBoard, moveIdx, aiToPlay);

      setTimeline((prev) => {
        const head = prev.slice(0, currentCursor + 1);
        return [...head, nextBoard];
      });
      setCursor((v) => v + 1);
      setAiMeta({ depth: data?.depth ?? 0, nodes: data?.nodes ?? 0, score: data?.score ?? 0 });
    } catch {
      setAiMeta(null);
    } finally {
      if (requestId === requestIdRef.current) setAiLoading(false);
    }
  }

  // Auto respond when it's the AI's turn.
  useEffect(() => {
    if (aiLoading) return;
    if (isPlayersTurn) return;
    void requestAiMove(board, cursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, cursor, aiLoading, isPlayersTurn]);

  function resetGame() {
    requestIdRef.current += 1;
    setAiLoading(false);
    setAiMeta(null);
    setTimeline([initialBoard]);
    setCursor(0);
  }

  function undo() {
    if (aiLoading) return;
    if (cursor <= 0) return;
    setCursor((v) => v - 1);
  }

  function redo() {
    if (aiLoading) return;
    if (cursor >= timeline.length - 1) return;
    setCursor((v) => v + 1);
  }

  async function onIntersection(r: number, c: number) {
    if (!canPlay) return;
    const idx = idxOf(r, c);
    if (!isLegalMove(board, idx, playerToPlay)) return;

    const next = applyMove(board, idx, playerToPlay);
    setTimeline((prev) => [...prev.slice(0, cursor + 1), next]);
    setCursor((v) => v + 1);
    setAiMeta(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <div className="text-xs font-semibold tracking-[0.22em] text-white/60">BADUK</div>
          <div className="mt-1 font-extrabold">{isPlayersTurn ? "Your turn (Black)" : "AI turn"}</div>
          {aiMeta ? (
            <div className="mt-1 text-xs text-white/60">
              Depth {aiMeta.depth} · Nodes {aiMeta.nodes} · Score {Math.round(aiMeta.score)}
            </div>
          ) : (
            <div className="mt-1 text-xs text-white/55">No ko rule (MVP). Captures enforced.</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetGame}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10 transition disabled:opacity-60"
            disabled={aiLoading}
          >
            New
          </button>
          <button
            type="button"
            onClick={undo}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10 transition disabled:opacity-60"
            disabled={aiLoading || cursor <= 0}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold hover:bg-white/10 transition disabled:opacity-60"
            disabled={aiLoading || cursor >= timeline.length - 1}
          >
            Redo
          </button>
        </div>
      </div>

      <div className="rb-glass rounded-[28px] p-4">
        <div className="grid grid-cols-9 gap-0.5 rounded-2xl bg-black/20 p-0.5">
          {Array.from({ length: SIZE }).map((_, r) =>
            Array.from({ length: SIZE }).map((__, c) => {
              const idx = idxOf(r, c);
              const stone = board[idx];
              const isMoveSpot = canPlay && stone === 0;
              const s = stoneToCss(stone);
              return (
                <button
                  key={`${r}_${c}`}
                  type="button"
                  onClick={() => void onIntersection(r, c)}
                  disabled={!canPlay}
                  className={[
                    "relative aspect-square flex items-center justify-center",
                    "bg-white/10 hover:bg-white/15 transition",
                    stone !== 0 ? "cursor-default" : "",
                    isMoveSpot ? "ring-1 ring-white/10" : "",
                  ].join(" ")}
                  aria-label={`Intersection ${r},${c}`}
                >
                  {stone !== 0 ? (
                    <span
                      className={[
                        "h-[72%] w-[72%] rounded-full border border-black/20",
                        s?.bg ?? "",
                        s?.shadow ?? "",
                      ].join(" ")}
                    />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

