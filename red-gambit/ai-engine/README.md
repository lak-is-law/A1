## AI Engine (FastAPI)

This microservice provides the Minimax + Alpha-Beta move search used by Red Gambit.

### Deploy free (Render.com, about5 minutes)

1. Push this repo to GitHub.
2. [Render](https://render.com) → **New** → **Web Service** → connect the repo.
3. **Root directory:** `red-gambit/ai-engine`  
   **Environment:** Docker (uses the `Dockerfile` here)  
   **Instance type:** Free is fine.

Copy the service URL (e.g. `https://red-gambit-ai.onrender.com`). In **Vercel** (your Next app) set:

- **Name:** `AI_ENGINE_URL`  
- **Value:** `https://red-gambit-ai.onrender.com` (no `/move`)

Redeploy Vercel. Baduk **God** mode and health checks use that URL automatically.

### Local Run
```bash
cd ai-engine
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001
```

### API
`GET /health` — returns `{"status":"ok"}` for uptime checks.

`POST /move`

Body:
- `game`: `"chess"` or `"baduk"`
- `difficulty`: `"adaptive"` | `"medium"` | `"hard"` | `"god"` (stronger search; used by Baduk God mode on Vercel)
- `time_ms`: integer

Chess:
- `fen`: required

Baduk:
- `size`: default 9
- `to_play`: `"black"` or `"white"`
- `komi`: default 7.5
- `board`: row-major array length `size*size` with values `0` (empty), `1` (black), `-1` (white)

### Response
- `move`: chess `uci` (e.g. `g1f3`), or baduk `"r,c"` / `"pass"`
- `depth`, `nodes`, `score`

