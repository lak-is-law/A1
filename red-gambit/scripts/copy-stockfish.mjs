import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const srcDir = path.join(root, "node_modules", "stockfish", "bin");
const destDir = path.join(root, "public", "stockfish");

const FILES = ["stockfish-18-lite-single.js", "stockfish-18-lite-single.wasm"];

function main() {
  if (!fs.existsSync(srcDir)) {
    console.warn(`[copy-stockfish] Skip: missing ${srcDir} (npm install stockfish first)`);
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });

  for (const name of FILES) {
    const from = path.join(srcDir, name);
    const to = path.join(destDir, name);
    if (!fs.existsSync(from)) {
      console.warn(`[copy-stockfish] Skip missing file: ${from}`);
      continue;
    }
    fs.copyFileSync(from, to);
  }

  console.log("[copy-stockfish] Copied Stockfish lite-single assets to public/stockfish/");
}

main();
