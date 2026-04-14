"use client";

import { useEffect } from "react";
import { BackgroundMusic } from "@/components/BackgroundMusic";
import { useThemeStore } from "./themeStore";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  const hydrateFromStorage = useThemeStore((s) => s.hydrateFromStorage);

  useEffect(() => {
    hydrateFromStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <>
      {children}
      <BackgroundMusic />
    </>
  );
}

