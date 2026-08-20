# machado — server-side engine

Full server-side mode: **direct PT↔DE translation** (NLLB-200-distilled-1.3B via
CTranslate2, int8, on GPU) + **CEFR analysis** (frequency lists + spaCy
dependency parse). Runs entirely on your own hardware — data never leaves your
infrastructure. The browser uses this engine only when the user consents and the
server is reachable; otherwise it falls back to the full client-side engine.

Emits the exact same `parts[]` / `cefr` shape the browser worker produces, so
the UI is engine-agnostic. For the project overview and the frontend, see
[`../README.md`](../README.md) and [`../src/README.md`](../src/README.md).

## Endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/health` | — | `{ ok, models }` |
| POST | `/translate` | `{ text, source, target }` | `{ text, parts, engine, model }` |
| POST | `/analyze` | `{ text, lang }` | `{ parts }` |

`source`/`target`/`lang` are `"pt"` or `"de"`. `parts[]` entries are either
`{type:"gap", text}` or `{type:"sentence", text, cefr}`.

## Setup

```bash
cd server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# spaCy models for segmentation + CEFR syntax features
python -m spacy download pt_core_news_sm
python -m spacy download de_core_news_sm

# Convert the NLLB model to CTranslate2 (int8_float16). One-time, ~5 GB download.
# Run from the repo root:
cd .. && bash server/scripts/convert_model.sh
```

## Run

```bash
cd server
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The server **boots even without the converted model** (so you can iterate on the
API/CEFR); `/health` then reports `ok:false` and `/translate` returns 503, which
makes the frontend fall back to local — exactly the intended behavior.

## Point the frontend at it

In dev the Vite app and this server are on different ports, so set the base URL:

```bash
# repo root
echo 'VITE_SERVER_URL=http://localhost:8000' >> .env.local
```

Then enable **"Permitir processamento no servidor"** in the app settings.

## Configuration (env vars)

| Var | Default | Notes |
|---|---|---|
| `NLLB_CT2_PATH` | `server/models/nllb-200-distilled-1.3B-ct2` | Converted model dir |
| `NLLB_TOKENIZER` | `facebook/nllb-200-distilled-1.3B` | HF tokenizer |
| `CT2_DEVICE` | `cuda` | `cpu` to run without GPU |
| `CT2_COMPUTE` | `int8_float16` (cuda) / `int8` (cpu) | Quantization |
| `BEAM_SIZE` | `4` | Decoding beam width |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:4173` | CORS origins |
| `MACHADO_FAKE_MT` | *(unset)* | **Tests only** — see below. Never set in production. |

## Tests

```bash
# from the repo root — lightweight deps, no GPU / model / spaCy needed
pip install -r server/requirements-ci.txt   # fastapi, uvicorn, httpx, pytest
npm run test:server                          # or: cd server && python -m pytest
```

Tests run with **`MACHADO_FAKE_MT=1`**, a test-only seam that makes the
translator report itself available and return a deterministic stand-in
(`"DE: <text>"`) instead of loading NLLB/CTranslate2. CEFR then falls back to
the regex heuristic and segmentation to the regex splitter, so the full API is
exercised without any heavy dependency. This same seam lets the frontend's
integration tests (`npm run test:integration`) boot a real server over HTTP.

The suite runs in CI on every push — see `.github/workflows/tests.yml`.
