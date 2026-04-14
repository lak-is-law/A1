## Red Gambit

Red Gambit is a premium strategy gaming platform with a “luxury hacker” aesthetic and a real Minimax (Alpha-Beta pruning) AI engine.

This repo contains:
- `red-gambit/` Next.js frontend (App Router + Tailwind + Framer Motion)
- `ai-engine/` FastAPI microservice implementing Chess Minimax + Alpha-Beta, iterative deepening, and a lightweight Baduk (Go) MVP search

## Local Setup

### 1) Start the AI engine (FastAPI)
```bash
cd ai-engine
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001
```

### 2) Start the web app (Next.js)
In a new terminal:
```bash
cd red-gambit
npm install   # copies Stockfish WASM to public/stockfish (postinstall)
npm run dev
```

**Chess engines**
- **Human mode** uses the built-in Minimax API (`POST /api/engine/move`).
- **God mode** uses **Stockfish.js** (WASM) in a browser Web Worker, served from `public/stockfish/`.

### 3) Try it
- Landing: `/`
- Chess vs AI: `/play/chess`
- Baduk (Go) MVP vs AI: `/play/baduk`

## Environment Variables

See `red-gambit/.env.example`.

Key one for gameplay:
- `AI_ENGINE_URL` (e.g. `http://localhost:8001`)
- `BADUK_GOD_API_URL` (optional, used by Baduk `god` difficulty for external super-strong engine)
- `BADUK_GOD_HEALTH_URL` (optional, explicit health probe URL; otherwise `/move` is mapped to `/health`)
- `BADUK_GOD_API_KEY` (optional bearer token for that provider)

Health endpoint:
- `GET /api/engine/health` returns current status of the configured Baduk god provider.

## Engine API Contract

Frontend proxy route:
- `POST /api/engine/move`

It forwards to:
- `POST {AI_ENGINE_URL}/move`

The microservice returns:
- chosen move (`uci` for chess; `r,c` for baduk or `pass`)
- search metadata (`depth`, `nodes`, `score`)

## Deployment (Vercel + Engine)

1. Deploy `red-gambit` to Vercel.
2. Deploy `ai-engine` separately (Railway / Render / Fly / any container host).
3. Set `AI_ENGINE_URL` in Vercel environment to the production engine URL.

### Notes on WebSockets
Vercel serverless environments are not ideal for long-lived WebSocket connections. For production realtime, run a dedicated realtime server (Node/Express + `ws` or `socket.io`) separately, and have the frontend connect to that endpoint.

## Next Feature Steps (Roadmap)
- WebSocket-based realtime move events and engine “thinking…” streaming
- Supabase Auth (Google/Apple/Yahoo OAuth), match history, resume-from-saved-state
- Post-game analysis (PV lines) + limited hints top-K
- Stronger Go search + better tactical pruning while keeping Minimax/Alpha-Beta
