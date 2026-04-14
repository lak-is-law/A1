"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";

import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { RedGambitLogo } from "@/components/RedGambitLogo";
import { ChessVsAi } from "@/components/game/chess/ChessVsAi";
import { BadukVsAi } from "@/components/game/baduk/BadukVsAi";
import { BattleshipVsAi } from "@/components/game/battleship/BattleshipVsAi";

const GAME_LABEL: Record<string, string> = {
  chess: "Chess",
  baduk: "Baduk (Go)",
  battleship: "Battleship",
};

export default function PlayPage() {
  const params = useParams<{ game: string }>();
  const router = useRouter();
  const game = params.game ?? "chess";
  const label = GAME_LABEL[game] ?? "Unknown";

  const [difficulty, setDifficulty] = useState<"adaptive" | "medium" | "hard" | "god">("adaptive");

  const difficultyCopy = useMemo(() => {
    switch (difficulty) {
      case "medium":
        return { title: "Medium", sub: "Fast search, strong heuristics" };
      case "hard":
        return { title: "Hard", sub: "Deeper search with heavier pruning" };
      case "god":
        return { title: "God Mode", sub: "AlphaGo-style Monte Carlo search for Baduk" };
      default:
        return { title: "Adaptive", sub: "Iterative deepening tuned per position" };
    }
  }, [difficulty]);

  const difficultyOptions = game === "baduk" ? (["adaptive", "medium", "hard", "god"] as const) : (["adaptive", "medium", "hard"] as const);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-xl hover:bg-white/5 px-2 py-1 transition"
        >
          <RedGambitLogo size={26} />
        </button>
        <div className="flex items-center gap-3">
          <ThemeSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="text-3xl font-extrabold tracking-tight"
            >
              {label} vs Red Gambit
            </motion.h1>
            <p className="mt-2 text-sm text-white/65">Real-time move rendering + analysis mode (next).</p>
          </div>

          <div className="rb-glass flex items-center gap-2 rounded-2xl p-3">
            <div className="text-xs font-semibold tracking-[0.18em] text-white/60">DIFFICULTY</div>
            {difficultyOptions.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDifficulty(d)}
                className={[
                  "rounded-xl px-3 py-2 text-sm transition",
                  d === difficulty ? "bg-white/10 text-white" : "bg-transparent text-white/70 hover:bg-white/5",
                ].join(" ")}
                aria-pressed={d === difficulty}
              >
                {d === "adaptive" ? "Adaptive" : d === "god" ? "God" : d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
          <section className="rb-glass rounded-[28px] p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold tracking-[0.22em] text-white/60">BOARD</div>
                <div className="mt-1 text-lg font-extrabold">
                  {game === "chess" ? "8x8 Arena" : game === "baduk" ? "9x9 Arena (MVP)" : "10x10 Naval Battlefield"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-white/60">MODE</div>
                <div className="mt-1 flex flex-wrap text-sm font-bold text-white/90">Vs AI</div>
              </div>
            </div>

            <div className="mt-5">
              {game === "chess" ? (
                <ChessVsAi difficulty={difficulty === "god" ? "hard" : difficulty} />
              ) : game === "baduk" ? (
                <BadukVsAi difficulty={difficulty} />
              ) : game === "battleship" ? (
                <BattleshipVsAi difficulty={difficulty === "god" ? "hard" : difficulty} />
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center rounded-2xl border border-white/10 bg-black/15 p-6">
                  <div className="text-center">
                    <div className="text-sm font-semibold text-white/80">Baduk mode (MVP)</div>
                    <div className="mt-1 text-xs text-white/55">
                      Next: 9x9 rules, minimax move generation, and capture legality.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="rb-glass rounded-[28px] p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold tracking-[0.22em] text-white/60">AI STATUS</div>
                <div className="mt-1 text-lg font-extrabold">{difficultyCopy.title}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-white/60">SEARCH</div>
                <div className="mt-1 text-sm font-bold text-[color:var(--rb-accent)]">Ready</div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-4">
              <div className="text-sm font-semibold">What’s coming immediately</div>
              <ul className="mt-2 space-y-2 text-xs text-white/65">
                <li>Iterative deepening + alpha-beta pruning</li>
                <li>Transposition table (Zobrist hashing)</li>
                <li>Fast move ordering + heuristics</li>
                <li>WebSocket realtime updates (engine events)</li>
              </ul>
              <div className="mt-4 text-xs text-white/55">{difficultyCopy.sub}</div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

