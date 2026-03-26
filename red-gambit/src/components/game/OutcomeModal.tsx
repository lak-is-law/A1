"use client";

import { useEffect, useMemo, useRef } from "react";
import { motion } from "framer-motion";

type OutcomeTone = "win" | "lose" | "draw" | "checkmate" | "stalemate";

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator === "undefined") return;
    if (!("vibrate" in navigator)) return;
    navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}

function playToneMusic(tone: OutcomeTone) {
  try {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioCtx = w.AudioContext ?? w.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    const now = ctx.currentTime;

    const seq =
      tone === "win"
        ? [659, 784, 988, 1175]
        : tone === "lose"
          ? [523, 392, 330]
          : tone === "draw"
            ? [523, 587, 523, 587]
            : tone === "checkmate"
              ? [740, 880, 1046, 880]
              : [440, 392, 330, 392]; // stalemate-ish

    const baseDur = tone === "lose" ? 0.12 : 0.09;
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.10, now + 0.02);

    seq.forEach((freq, i) => {
      const t0 = now + i * baseDur;
      const osc = ctx.createOscillator();
      osc.type = tone === "draw" ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, t0);
      osc.connect(master);
      master.gain.setValueAtTime(0.10, t0);
      master.gain.exponentialRampToValueAtTime(0.0001, t0 + baseDur * 0.92);
      osc.start(t0);
      osc.stop(t0 + baseDur * 0.95);
    });

    // Soft tail
    const tEnd = now + seq.length * baseDur + 0.08;
    master.gain.exponentialRampToValueAtTime(0.0001, tEnd);
    window.setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {
    // ignore
  }
}

export function OutcomeModal({
  open,
  title,
  message,
  tone,
  onExitToMenu,
  hapticsOn = true,
}: {
  open: boolean;
  title: string;
  message: string;
  tone: OutcomeTone;
  onExitToMenu: () => void;
  hapticsOn?: boolean;
}) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      firedRef.current = false;
      return;
    }
    if (firedRef.current) return;
    firedRef.current = true;
    if (hapticsOn) vibrate(tone === "win" ? [45, 25, 65, 25, 75] : tone === "lose" ? [25, 15, 25] : [35, 20, 35]);
    playToneMusic(tone);
  }, [open, tone, hapticsOn]);

  const toneBadge = useMemo(() => {
    if (tone === "win") return "VICTORY";
    if (tone === "lose") return "DEFEAT";
    if (tone === "draw") return "DRAW";
    if (tone === "checkmate") return "CHECKMATE";
    return "STALEMATE";
  }, [tone]);

  if (!open) return null;

  return (
    <motion.div
      className="fixed inset-0 z-[50] flex items-center justify-center px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => {
          // Intentionally no click-to-dismiss: user must confirm with checkbox.
        }}
      />

      <motion.div
        className="relative w-full max-w-lg rounded-[28px] rb-glass p-6"
        initial={{ scale: 0.98, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <div className="text-xs font-semibold tracking-[0.22em] text-white/60">{toneBadge}</div>
        <div className="mt-2 text-2xl font-extrabold">{title}</div>
        <div className="mt-2 text-sm leading-6 text-white/70">{message}</div>

        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <input
            id="rg_ok"
            type="checkbox"
            defaultChecked={false}
            onChange={(e) => {
              if (e.target.checked) onExitToMenu();
            }}
            className="mt-1 h-4 w-4 accent-[color:var(--rb-accent)]"
          />
          <label htmlFor="rg_ok" className="text-xs text-white/70 select-none cursor-pointer">
            OK. Exit to main menu.
          </label>
        </div>

        <div className="mt-4 text-[11px] text-white/45">
          Tip: this keeps the experience calm and prevents accidental exits.
        </div>
      </motion.div>
    </motion.div>
  );
}

