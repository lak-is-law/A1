"use client";

import { useThemeStore } from "@/lib/theme/themeStore";
import { THEME_META, type ThemeId } from "@/lib/theme/themeTypes";

export function ThemeSwitcher() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2 backdrop-blur">
      <span className="text-xs font-semibold tracking-wider text-white/70">THEME</span>
      <div className="flex items-center gap-1">
        {THEME_META.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id as ThemeId)}
            className={[
              "relative flex items-center gap-2 rounded-full px-3 py-1 text-sm transition",
              "ring-1 ring-transparent hover:bg-white/5",
              theme === t.id ? "bg-white/10 ring-white/30" : "bg-transparent",
            ].join(" ")}
            aria-pressed={theme === t.id}
            title={t.label}
          >
            <span className="text-base">{t.emoji}</span>
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

