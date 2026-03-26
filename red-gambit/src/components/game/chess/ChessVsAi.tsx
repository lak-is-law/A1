"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Move, type Square } from "chess.js";
import { motion } from "framer-motion";

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

type Difficulty = "adaptive" | "medium" | "hard";

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator === "undefined") return;
    if (!("vibrate" in navigator)) return;
    navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}

function spriteForPiece(piece: { color: "w" | "b"; type: string }) {
  // Mapping extracted from the original historic `Chess/Piece.js`.
  // chess.js gives color 'w'/'b' and type 'p'/'n'/'b'/'r'/'q'/'k'.
  const { color, type } = piece;
  if (color === "w") {
    switch (type) {
      case "k":
        return "/chess-pieces/sprite_01.png";
      case "q":
        return "/chess-pieces/sprite_02.png";
      case "b":
        return "/chess-pieces/sprite_03.png";
      case "n":
        return "/chess-pieces/sprite_04.png";
      case "r":
        return "/chess-pieces/sprite_05.png";
      case "p":
        return "/chess-pieces/sprite_06.png";
    }
  } else {
    switch (type) {
      case "k":
        return "/chess-pieces/sprite_07.png";
      case "q":
        return "/chess-pieces/sprite_08.png";
      case "b":
        return "/chess-pieces/sprite_09.png";
      case "n":
        return "/chess-pieces/sprite_10.png";
      case "r":
        return "/chess-pieces/sprite_11.png";
      case "p":
        return "/chess-pieces/sprite_12.png";
    }
  }
  return null;
}

function uciToMove(uci: string): { from: Square; to: Square; promotion?: string } | null {
  if (uci.length < 4) return null;
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = uci.length >= 5 ? uci[4] : undefined;
  const prom = promotion ? promotion.toLowerCase() : undefined;
  return prom ? { from, to, promotion: prom } : { from, to };
}

function timeForDifficulty(d: Difficulty) {
  if (d === "medium") return 1800;
  if (d === "hard") return 3200;
  return 2500;
}

export function ChessVsAi({ difficulty }: { difficulty: Difficulty }) {
  const [mounted, setMounted] = useState(false);
  const [timeline, setTimeline] = useState<string[]>([INITIAL_FEN]);
  const [cursor, setCursor] = useState(0);
  const fen = timeline[cursor];

  const [selected, setSelected] = useState<Square | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [hintCount, setHintCount] = useState(3);
  const [hintMove, setHintMove] = useState<string | null>(null);
  const [aiMeta, setAiMeta] = useState<{ depth: number; nodes: number; score: number } | null>(null);

  const chess = useMemo(() => new Chess(fen), [fen]);

  const requestIdRef = useRef(0);
  const lastCheckmateFenRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const aiColor = "b";
  const playerColor = "w";
  const isGameOver = chess.isGameOver();
  const isCheckmate = chess.isCheckmate();

  const legalTargets = useMemo(() => {
    if (!selected) return new Set<Square>();
    const moves = chess.moves({ square: selected, verbose: true }) as Move[];
    return new Set(moves.map((m) => m.to));
  }, [chess, selected]);

  const lastMove = useMemo(() => {
    // Chess.js doesn't expose last move from history directly by fen,
    // so we derive it by comparing current fen with previous if available.
    if (cursor <= 0) return null;
    const prevFen = timeline[cursor - 1];
    if (!prevFen) return null;
    const prev = new Chess(prevFen);
    // We compare by finding a move that transitions prev -> current (best-effort).
    // For UI highlighting, we just find any legal move in prev that matches current placement.
    const prevMoves = prev.moves({ verbose: true }) as Move[];
    const nextFen = chess.fen();
    for (const mv of prevMoves) {
      const temp = new Chess(prevFen);
      temp.move(mv);
      if (temp.fen() === nextFen) {
        return { from: mv.from, to: mv.to };
      }
    }
    return null;
  }, [chess, cursor, timeline]);

  async function requestAiMove(currentFen: string) {
    const requestId = ++requestIdRef.current;
    setAiLoading(true);
    setHintMove(null);

    try {
      const res = await fetch("/api/engine/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          game: "chess",
          difficulty,
          fen: currentFen,
          time_ms: timeForDifficulty(difficulty),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Engine error");

      if (requestId !== requestIdRef.current) return; // ignore stale

      const uci = data?.move as string | undefined;
      if (!uci) throw new Error("Engine did not return a move");

      const moveSpec = uciToMove(uci);
      if (!moveSpec) throw new Error("Invalid UCI move");

      const c = new Chess(currentFen);
      const moveArgs = moveSpec.promotion
        ? { from: moveSpec.from, to: moveSpec.to, promotion: moveSpec.promotion }
        : { from: moveSpec.from, to: moveSpec.to };
      const moved = c.move(moveArgs);
      if (!moved) throw new Error("Engine move was illegal for this position");

      const nextFen = c.fen();

      setTimeline((prev) => {
        const head = prev.slice(0, cursor + 1);
        return [...head, nextFen];
      });
      setCursor((v) => v + 1);
      setAiMeta({ depth: data?.depth ?? 0, nodes: data?.nodes ?? 0, score: data?.score ?? 0 });
      vibrate([12, 10, 18]);
    } catch {
      setAiMeta(null);
    } finally {
      // Only clear loader if this request is the newest.
      if (requestId === requestIdRef.current) setAiLoading(false);
    }
  }

  // Auto-respond when it's the AI's turn and user isn't thinking.
  useEffect(() => {
    if (isGameOver) return;
    if (aiLoading) return;
    if (chess.turn() !== aiColor) return;
    void requestAiMove(fen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, isGameOver, aiLoading]);

  useEffect(() => {
    if (!mounted) return;
    if (!isCheckmate) return;
    if (lastCheckmateFenRef.current === fen) return;
    lastCheckmateFenRef.current = fen;
    vibrate([35, 20, 35, 20, 65]);
  }, [fen, mounted, isCheckmate]);

  function resetGame() {
    requestIdRef.current += 1;
    setSelected(null);
    setHintCount(3);
    setHintMove(null);
    setAiMeta(null);
    setAiLoading(false);
    setTimeline([INITIAL_FEN]);
    setCursor(0);
  }

  function undo() {
    if (aiLoading) return;
    if (cursor <= 0) return;
    setSelected(null);
    setHintMove(null);
    setCursor((v) => v - 1);
  }

  function redo() {
    if (aiLoading) return;
    if (cursor >= timeline.length - 1) return;
    setSelected(null);
    setHintMove(null);
    setCursor((v) => v + 1);
  }

  async function requestHint() {
    if (hintCount <= 0) return;
    if (aiLoading) return;
    if (isGameOver) return;
    if (chess.turn() !== playerColor) return;

    setHintMove(null);
    setAiLoading(true);
    const requestId = ++requestIdRef.current;

    try {
      const res = await fetch("/api/engine/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          game: "chess",
          difficulty,
          fen,
          time_ms: 1200,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Engine error");
      if (requestId !== requestIdRef.current) return;

      const uci = data?.move as string | undefined;
      if (!uci) throw new Error("Missing hint move");
      setHintMove(uci);
      setHintCount((n) => Math.max(0, n - 1));
    } catch {
      // ignore
    } finally {
      if (requestId === requestIdRef.current) setAiLoading(false);
    }
  }

  const hintSquares = useMemo(() => {
    if (!hintMove) return null;
    const spec = uciToMove(hintMove);
    if (!spec) return null;
    return { from: spec.from, to: spec.to };
  }, [hintMove]);

  const selectedPiece = selected ? chess.get(selected) : null;
  const selectedSpriteSrc = selectedPiece ? spriteForPiece(selectedPiece) : null;

  if (!mounted) {
    return (
      <div className="space-y-4">
        <div className="rb-glass rounded-[28px] p-4 h-[420px] animate-pulse" />
      </div>
    );
  }

  function onSquareClick(square: Square) {
    if (aiLoading) return;
    if (isGameOver) return;
    if (chess.turn() !== playerColor) return;

    // If we already have a selected piece, try to move.
    if (selected) {
      const moves = chess.moves({ square: selected, verbose: true }) as Move[];
      const legal = moves.find((m) => m.to === square);
      if (!legal) {
        // Selecting a different own piece is allowed.
        const piece = chess.get(square);
        if (piece && piece.color === "w") {
          setSelected(square);
        } else {
          setSelected(null);
        }
        return;
      }

      // Apply move (promote to queen by default).
      const c = new Chess(fen);
      const moveRes = legal.promotion
        ? c.move({ from: selected, to: square, promotion: legal.promotion })
        : c.move({ from: selected, to: square });

      if (!moveRes) return;
      const nextFen = c.fen();

      setSelected(null);
      setHintMove(null);
      setTimeline((prev) => [...prev.slice(0, cursor + 1), nextFen]);
      setCursor((v) => v + 1);
      setAiMeta(null);
      vibrate([14, 10, 14]);
      return;
    }

    // Select a piece if it belongs to the player.
    const piece = chess.get(square);
    if (!piece) return;
    if (piece.color !== "w") return;
    setSelected(square);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <div className="text-xs font-semibold tracking-[0.22em] text-white/60">CHESS</div>
          <div className="mt-1 font-extrabold">{isGameOver ? "Game Over" : chess.turn() === playerColor ? "Your turn" : "AI turn"}</div>
          {isCheckmate ? (
            <div className="mt-2 text-xs text-white/65">
              {chess.turn() === aiColor
                ? "Checkmate. You delivered the gambit—congratulations."
                : "Checkmate. The AI sacrifices everything and seals it."}
            </div>
          ) : null}
          {aiMeta ? (
            <div className="mt-1 text-xs text-white/60">
              Depth {aiMeta.depth} · Nodes {aiMeta.nodes} · Score {Math.round(aiMeta.score)}
            </div>
          ) : (
            <div className="mt-1 text-xs text-white/55">Click-to-move. Undo/redo supported.</div>
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
          <button
            type="button"
            onClick={requestHint}
            className="rounded-xl border border-[color:var(--rb-accent)]/30 bg-[color:var(--rb-accent)]/10 px-3 py-2 text-sm font-bold hover:bg-[color:var(--rb-accent)]/20 transition disabled:opacity-60"
            disabled={aiLoading || hintCount <= 0 || chess.turn() !== playerColor || isGameOver}
          >
            Hint ({hintCount})
          </button>
        </div>
      </div>

      <div className="rb-glass rounded-[28px] p-4">
        <div className="grid grid-cols-8 gap-0.5 rounded-2xl bg-black/20 p-0.5">
          {Array.from({ length: 8 }).map((_, row) => {
            const rank = 8 - row;
            return (
              <div key={row} className="contents">
                {Array.from({ length: 8 }).map((__, file) => {
                  const fileChar = String.fromCharCode(97 + file);
                  const square = `${fileChar}${rank}` as Square;

                  const isLight = (file + row) % 2 === 0;
                  const isSelected = selected === square;
                  const isTarget = legalTargets.has(square);
                  const isHintFrom = hintSquares?.from === square;
                  const isHintTo = hintSquares?.to === square;
                  const isLastFrom = lastMove?.from === square;
                  const isLastTo = lastMove?.to === square;

                  const piece = chess.get(square);
                  const pieceKey = piece ? `${piece.color}${piece.type}${square}` : square;
                  const spriteSrc = piece ? spriteForPiece(piece) : null;

                  const squareClass = [
                    "relative aspect-square flex items-center justify-center select-none",
                    isLight ? "bg-white/10" : "bg-black/35",
                    isSelected ? "ring-2 ring-[color:var(--rb-accent)]" : "",
                    isTarget ? "ring-1 ring-white/25" : "",
                    isHintFrom ? "ring-2 ring-[color:var(--rb-accent-2)]" : "",
                    isHintTo ? "ring-2 ring-[color:var(--rb-accent-3)]" : "",
                    isLastFrom ? "ring-2 ring-white/20" : "",
                    isLastTo ? "ring-2 ring-[color:var(--rb-accent)]" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <button
                      key={pieceKey}
                      type="button"
                      onClick={() => onSquareClick(square)}
                      className={squareClass}
                      aria-label={`Square ${square}`}
                      disabled={aiLoading || isGameOver}
                    >
                      {piece && spriteSrc ? (
                        <motion.img
                          key={`${piece.color}${piece.type}_${square}`}
                          initial={{ scale: 0.98, opacity: 0.7 }}
                          animate={{ scale: isLastTo ? 1.07 : 1, opacity: 1 }}
                          transition={{ duration: 0.25 }}
                          src={spriteSrc}
                          alt={`${piece.color} ${piece.type}`}
                          draggable={false}
                          className={[
                            "rg-piece",
                            piece.color === "w" ? "rg-piece--w" : "rg-piece--b",
                            "h-[70%] w-[70%] object-contain select-none",
                          ].join(" ")}
                        />
                      ) : isTarget ? (
                        selectedSpriteSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={selectedSpriteSrc}
                            alt="move target"
                            draggable={false}
                            className={[
                              "rg-piece",
                              selectedPiece?.color === "w" ? "rg-piece--w" : "rg-piece--b",
                              "h-[38%] w-[38%] object-contain select-none opacity-55",
                            ].join(" ")}
                          />
                        ) : (
                          <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                        )
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

