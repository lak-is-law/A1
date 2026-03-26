"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

import { RedGambitLogo } from "@/components/RedGambitLogo";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

const AiThinkingCanvas = dynamic(
  () => import("@/components/AiThinkingCanvas").then((m) => m.AiThinkingCanvas),
  { ssr: false }
);

export default function Home() {
  const router = useRouter();
  const [intensity, setIntensity] = useState(0.95);

  const ctas = useMemo(
    () => [
      { label: "Play Chess", game: "chess" as const, hint: "Minimax + alpha-beta" },
      { label: "Play Baduk", game: "baduk" as const, hint: "Strategic search under pressure" },
      { label: "Play Battleship", game: "battleship" as const, hint: "Tactical probability warfare" },
    ],
    []
  );

  return (
    <div className="min-h-screen bg-transparent">
      {/* Top bar */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <RedGambitLogo size={30} />
        </motion.div>

        <div className="flex items-center gap-3">
          <ThemeSwitcher />
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-6xl px-6 pb-16 pt-6">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <section className="relative">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="rb-glass relative overflow-hidden rounded-[28px] p-7 sm:p-10"
            >
              <div className="absolute inset-0 opacity-70 rb-flicker" />
              <div className="relative z-10">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1">
                  <span className="h-2 w-2 rounded-full bg-[var(--rb-accent)] shadow-[0_0_22px_var(--rb-glow)]" />
                  <span className="text-xs font-semibold tracking-[0.22em] text-white/70">
                    ELITE AI ENGINE
                  </span>
                </div>

                <motion.h1
                  className="mt-5 text-balance text-4xl font-extrabold leading-[1.05] sm:text-5xl"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.65, delay: 0.05 }}
                >
                  Sacrifice Everything. Win Anyway.
                </motion.h1>

                <p className="mt-4 max-w-xl text-pretty text-[15px] leading-6 text-white/70">
                  Premium strategy warfare powered by Minimax with Alpha-Beta pruning, iterative deepening, and
                  transposition-table speedups.
                </p>

                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  {ctas.map((cta, idx) => (
                    <motion.button
                      key={cta.game}
                      type="button"
                      onMouseEnter={() => setIntensity(0.98 + idx * 0.01)}
                      onClick={() => router.push(`/play/${cta.game}`)}
                      className={[
                        "group relative overflow-hidden rounded-2xl border px-5 py-4 text-left transition",
                        "border-white/10 bg-white/5 hover:bg-white/10",
                        "focus:outline-none focus:ring-2 focus:ring-[color:var(--rb-accent)] focus:ring-offset-0",
                      ].join(" ")}
                    >
                      <div
                        className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                        style={{
                          background:
                            "radial-gradient(600px 150px at 20% 0%, rgba(255,42,42,0.35), transparent 50%), radial-gradient(420px 160px at 80% 20%, rgba(123,11,255,0.25), transparent 55%)",
                        }}
                      />
                      <div className="relative z-10">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-white">{cta.label}</div>
                            <div className="mt-1 text-xs text-white/60">{cta.hint}</div>
                          </div>
                          <div className="text-2xl">{idx === 0 ? "♟︎" : "⚫︎"}</div>
                        </div>
                        <div className="mt-3 h-1 w-full rounded-full bg-white/10">
                          <div
                            className="h-1 rounded-full bg-[color:var(--rb-accent)]"
                            style={{ width: `${45 + idx * 20}%`, boxShadow: "0 0 22px var(--rb-glow)" }}
                          />
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>

                <div className="mt-6 flex items-center gap-3">
                  <span className="text-xs font-semibold tracking-wide text-white/60">Ready to test your limits?</span>
                  <motion.span
                    className="text-xs font-bold text-[color:var(--rb-accent)]"
                    animate={{ opacity: [0.55, 1, 0.55] }}
                    transition={{ duration: 1.8, repeat: Infinity }}
                  >
                    ONLINE NOW
                  </motion.span>
                </div>
              </div>
            </motion.div>
          </section>

          <section className="relative">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: "easeOut", delay: 0.08 }}
              className="space-y-5"
            >
              <div className="rb-glass rounded-[28px] p-4 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold tracking-[0.22em] text-white/60">AI THINKING</div>
                    <div className="mt-1 text-lg font-extrabold text-white">Search in progress</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-white/60">Difficulty</div>
                    <div className="text-sm font-bold text-white/90">Adaptive</div>
                  </div>
                </div>

                <div className="mt-4">
                  <AiThinkingCanvas active intensity={intensity} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { k: "Alpha-Beta", v: "Pruned search" },
                  { k: "Iterative", v: "Depth ramp" },
                  { k: "TT", v: "Zobrist cache" },
                  { k: "Hints", v: "Limited assist" },
                ].map((x) => (
                  <div key={x.k} className="rb-glass rounded-2xl p-4">
                    <div className="text-xs font-semibold tracking-[0.18em] text-white/60">{x.k}</div>
                    <div className="mt-1 text-sm font-bold text-white/90">{x.v}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          </section>
        </div>
      </main>

      <footer className="mx-auto max-w-6xl px-6 pb-10 text-xs text-white/55">
        Red Gambit is built for speed, clarity, and brutal strategy. Your moves are logged, your matches are recoverable.
      </footer>
    </div>
  );
}
