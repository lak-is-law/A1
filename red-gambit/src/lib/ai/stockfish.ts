"use client";

type StockfishScore = {
  cpWhite?: number;
  mateWhite?: number;
};

export type StockfishMoveResult = {
  bestMove: string;
  score?: StockfishScore;
};

let worker: Worker | null = null;
let initPromise: Promise<Worker> | null = null;
let chain: Promise<unknown> = Promise.resolve();

function workerScriptUrl(): string {
  if (typeof window === "undefined") {
    throw new Error("Stockfish only runs in the browser");
  }
  const origin = window.location.origin;
  const js = `${origin}/stockfish/stockfish-18-lite-single.js`;
  const wasm = `${origin}/stockfish/stockfish-18-lite-single.wasm`;
  return `${js}#${encodeURIComponent(wasm)},worker`;
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(workerScriptUrl());
  }
  return worker;
}

function collectUntil(
  w: Worker,
  pred: (line: string) => boolean,
  opts: { ms: number; onLine?: (line: string) => void }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      w.removeEventListener("message", onMsg);
      reject(new Error("Stockfish timeout"));
    }, opts.ms);

    const onMsg = (ev: MessageEvent) => {
      const raw = String(ev.data ?? "");
      for (const part of raw.split("\n")) {
        const line = part.trim();
        if (!line) continue;
        opts.onLine?.(line);
        if (pred(line)) {
          window.clearTimeout(timer);
          w.removeEventListener("message", onMsg);
          resolve(line);
          return;
        }
      }
    };

    w.addEventListener("message", onMsg);
  });
}

async function ensureUciReady(): Promise<Worker> {
  if (!initPromise) {
    initPromise = (async () => {
      const w = getWorker();

      const uciWait = collectUntil(w, (l) => l === "uciok", { ms: 30_000 });
      w.postMessage("uci");
      await uciWait;

      const readyWait = collectUntil(w, (l) => l === "readyok", { ms: 30_000 });
      w.postMessage("isready");
      await readyWait;

      return w;
    })();
  }

  try {
    return await initPromise;
  } catch (e) {
    initPromise = null;
    throw e;
  }
}

function parseFenSideToMove(fen: string): "w" | "b" {
  const parts = fen.trim().split(/\s+/);
  return parts[1] === "b" ? "b" : "w";
}

function parseLastInfoScore(infoLine: string, fen: string): StockfishScore {
  const turn = parseFenSideToMove(fen);
  const mateMatch = infoLine.match(/\bscore mate (-?\d+)/);
  if (mateMatch) {
    const m = Number.parseInt(mateMatch[1]!, 10);
    return { mateWhite: turn === "w" ? m : -m };
  }
  const cpMatch = infoLine.match(/\bscore cp (-?\d+)/);
  if (cpMatch) {
    const cp = Number.parseInt(cpMatch[1]!, 10);
    return { cpWhite: turn === "w" ? cp : -cp };
  }
  return {};
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(() => fn(), () => fn());
  chain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/**
 * Stockfish.js (WASM lite-single) in a Web Worker. Assets live at `/stockfish/*` (see `scripts/copy-stockfish.mjs`).
 */
export async function getStockfishMove(
  fen: string,
  opts?: { depth?: number; timeoutMs?: number }
): Promise<StockfishMoveResult> {
  const depth = opts?.depth ?? 15;
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const fenClean = fen.trim();

  return enqueue(async () => {
    const w = await ensureUciReady();
    let lastScoringInfo = "";

    const bestLine = await new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        w.removeEventListener("message", onMsg);
        reject(new Error("Stockfish search timeout"));
      }, timeoutMs);

      const onMsg = (ev: MessageEvent) => {
        const raw = String(ev.data ?? "");
        for (const part of raw.split("\n")) {
          const line = part.trim();
          if (!line) continue;
          if (line.startsWith("info ") && line.includes(" score ")) {
            lastScoringInfo = line;
          }
          if (line.startsWith("bestmove ")) {
            window.clearTimeout(timer);
            w.removeEventListener("message", onMsg);
            resolve(line);
            return;
          }
        }
      };

      w.addEventListener("message", onMsg);
      w.postMessage(`position fen ${fenClean}`);
      w.postMessage(`go depth ${depth}`);
    });

    const parts = bestLine.split(/\s+/);
    const best = parts[1];
    if (!best || best === "(none)") {
      throw new Error("Stockfish returned no move");
    }

    const score = lastScoringInfo ? parseLastInfoScore(lastScoringInfo, fenClean) : undefined;
    return { bestMove: best, score };
  });
}
