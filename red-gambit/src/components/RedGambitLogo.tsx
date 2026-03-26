import React from "react";

export function RedGambitLogo({ size = 28 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="rg-grad" x1="8" y1="6" x2="58" y2="62" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--rb-accent)" />
            <stop offset="0.55" stopColor="var(--rb-accent-2)" />
            <stop offset="1" stopColor="var(--rb-accent-3)" />
          </linearGradient>
          <linearGradient id="rg-metal" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop stopColor="rgba(255,255,255,0.9)" />
            <stop offset="1" stopColor="rgba(255,255,255,0.15)" />
          </linearGradient>
        </defs>

        {/* Minimalist gambit chess symbol (aggressive split) */}
        <path
          d="M32 6 L52 18 V30 L32 54 L12 30 V18 L32 6Z"
          fill="rgba(0,0,0,0.35)"
          stroke="url(#rg-grad)"
          strokeWidth="2.2"
        />
        <path
          d="M32 10 L48 19 V28 L32 47 L16 28 V19 L32 10Z"
          fill="url(#rg-grad)"
          opacity="0.18"
        />
        <path
          d="M22 38 C26 28, 34 27, 42 22"
          stroke="url(#rg-metal)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M24 43 C29 34, 37 33, 44 28"
          stroke="url(#rg-grad)"
          strokeWidth="2.2"
          strokeLinecap="round"
          opacity="0.9"
        />
      </svg>
      <div className="leading-tight">
        <div className="text-xs font-semibold tracking-[0.38em] text-white/60 dark:text-white/60">
          RED
        </div>
        <div className="text-sm font-extrabold tracking-wide text-white">
          GAMB I T
        </div>
      </div>
    </div>
  );
}

