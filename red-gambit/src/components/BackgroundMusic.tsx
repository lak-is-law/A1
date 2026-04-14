"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Public-domain piano: Für Elise (Wikimedia Commons). */
const BGM_MP3 =
  "https://upload.wikimedia.org/wikipedia/commons/transcoded/7/7b/FurElise.ogg/FurElise.ogg.mp3";
const BGM_OGG = "https://upload.wikimedia.org/wikipedia/commons/7/7b/FurElise.ogg";

const STORAGE_KEY = "rg_piano_bgm_on";

function subscribeToNothing() {
  return () => {};
}

function useIsClient() {
  return useSyncExternalStore(subscribeToNothing, () => true, () => false);
}

function MusicNoteIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function BackgroundMusic() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isClient = useIsClient();
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!isClient) return;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "1") {
        const a = audioRef.current;
        if (a) {
          a.volume = 0.22;
          void a.play().then(
            () => setIsPlaying(true),
            () => setIsPlaying(false)
          );
        }
      }
    } catch {
      // ignore
    }
  }, [isClient]);

  const persist = useCallback((on: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = 0.22;
    if (isPlaying) {
      a.pause();
      setIsPlaying(false);
      persist(false);
    } else {
      void a.play().then(
        () => {
          setIsPlaying(true);
          persist(true);
        },
        () => {
          setIsPlaying(false);
          persist(false);
        }
      );
    }
  }, [isPlaying, persist]);

  if (!isClient) return null;

  return (
    <>
      <audio ref={audioRef} loop playsInline preload="metadata" className="hidden" aria-hidden tabIndex={-1}>
        <source src={BGM_MP3} type="audio/mpeg" />
        <source src={BGM_OGG} type="audio/ogg" />
      </audio>
      <button
        type="button"
        onClick={toggle}
        className={[
          "fixed z-[100] flex h-12 w-12 items-center justify-center rounded-2xl border shadow-lg transition",
          "bottom-[max(1.5rem,env(safe-area-inset-bottom,0px))] right-[max(1.5rem,env(safe-area-inset-right,0px))]",
          "border-white/15 bg-black/40 text-white/90 backdrop-blur-md",
          "hover:bg-white/10 hover:text-white",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--rb-accent)]",
        ].join(" ")}
        aria-pressed={isPlaying}
        aria-label={isPlaying ? "Pause piano background music" : "Play piano background music"}
        title="Für Elise — soft piano BGM (public domain, Wikimedia Commons)"
      >
        {isPlaying ? (
          <PauseIcon className="h-5 w-5 opacity-95" />
        ) : (
          <MusicNoteIcon className="h-6 w-6 opacity-95" />
        )}
      </button>
    </>
  );
}
