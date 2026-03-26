"use client";

import { create } from "zustand";
import type { ThemeId } from "./themeTypes";

type ThemeState = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  hydrateFromStorage: () => void;
};

const STORAGE_KEY = "rg_theme_v1";

export const useThemeStore = create<ThemeState>((set) => ({
  theme: "midnight",
  setTheme: (theme) => set({ theme }),
  hydrateFromStorage: () => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const next = raw as ThemeId;
    if (next === "midnight" || next === "british" || next === "mughal") {
      set({ theme: next });
    }
  },
}));

