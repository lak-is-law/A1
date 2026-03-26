## AI Engine (FastAPI)

This microservice provides the Minimax + Alpha-Beta move search used by Red Gambit.

### Local Run
```bash
cd ai-engine
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
./venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001
```

### API
`POST /move`

Body:
- `game`: `"chess"` or `"baduk"`
- `difficulty`: `"adaptive"` | `"medium"` | `"hard"`
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

