export type ThemeId = "midnight" | "british" | "mughal";

export type ThemeMeta = {
  id: ThemeId;
  label: string;
  emoji: string;
};

export const THEME_META: ThemeMeta[] = [
  { id: "midnight", label: "Midnight Haunt", emoji: "🌑" },
  { id: "british", label: "Royal Museum", emoji: "🏛️" },
  { id: "mughal", label: "Mughal Court", emoji: "🕌" },
];

