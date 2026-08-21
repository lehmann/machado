# CLAUDE.md

Guidance for agents working in this repo. For human-facing docs see
[`README.md`](README.md) (overview), [`src/README.md`](src/README.md) (UI), and
[`server/README.md`](server/README.md) (backend). This file captures the
non-obvious rules and invariants — read it before making changes.

## What this is

**machado** is a PT-BR ↔ DE translator with per-sentence CEFR (A1–C2) scoring
and per-word grammar explanations. It runs in one of two modes, chosen
automatically at translate time:

- **Local** (default): 100% in the browser — OPUS-MT (ONNX via Transformers.js),
  pivoting through English. No data leaves the device.
- **Server** (opt-in): a FastAPI backend on the user's own hardware — NLLB-200
  direct PT↔DE (CTranslate2/GPU) + spaCy-enriched CEFR.

## Hard constraints (do not violate)

- **No LLMs** (cloud or local) and **no third-party services** (Google, DeepL,
  etc.). The server engine must stay **lightweight**; classic ML on a local GPU
  (RTX 3070, 8 GB) is the ceiling. Chosen: NLLB-200-distilled-1.3B.
- **The `parts[]` contract is the interface between UI and both engines.** Any
  result — local or server — is an ordered array of
  `{type:'gap', text}` and `{type:'sentence', text, cefr}`, where
  `cefr = {level, index, factors, metrics}` with Portuguese `factors` strings.
  If you touch one engine's output shape, mirror it in the other and update the
  contract tests. The UI must render identically regardless of which engine ran.
- **`huggingface.token` (repo root) is a real credential.** Never commit,
  print, or send it anywhere. It's a dev-only convenience injected via Vite
  `define` (`__DEV_HF_TOKEN__`); production builds get an empty string. The
  user's token is otherwise stored only in browser `localStorage`.
- **`MACHADO_FAKE_MT` is a test-only seam** (deterministic `"DE: <text>"`
  stand-in). Never enable it in production, and keep it out of any prod path.
- **Privacy promise is user-visible.** The badge/footer must reflect the active
  mode. Offline or no-consent must always fall back to full client-side.
- **Offline shell via `public/sw.js`** (hand-written, no Workbox). It stale-while-
  revalidates same-origin assets, serves cached `index.html` for navigations, and
  cache-firsts the `cdn.jsdelivr.net` ONNX `.wasm`. It deliberately does **not**
  intercept HuggingFace model requests (Transformers.js caches those itself).
  Registered in `src/main.jsx` **prod only** (dev would clash with Vite HMR); bump
  `VERSION` in `sw.js` when shell caching logic changes so old caches are purged.

## Architecture

```
App.jsx → TranslatorEngine → LocalProvider  → Web Worker → Transformers.js
                           └→ ServerProvider → fetch → FastAPI → CTranslate2 + spaCy
```

- **`src/engine/TranslatorEngine.js`** is the only thing the UI talks to. It
  resolves mode (`server ⟺ consent AND online AND /health OK`, cached ~30s),
  handles server→local fallback on recoverable errors, and gates on the HF token
  (`onNeedToken`). Its constructor's 3rd arg `{createLocal, createServer}` is a
  **test seam** for injecting fake providers — keep it.
- **Frequency lists** (`src/data/freq-*.js`) are the single source of truth for
  CEFR vocabulary scoring; the **server reads the same files** (see
  `server/app/freq.py`). Don't fork them. Regenerate via
  `node scripts/build-freq.mjs` (one-time). The German gender lexicon is likewise
  regenerated via `node scripts/build-lexicon.mjs` (one-time).
- **CEFR is heuristic by design.** Research confirmed no open CEFR-graded PT-BR
  list exists, so both engines use the same weighted heuristic
  (`0.55·vocab + 0.30·length + 0.15·syntax`); the server enriches syntax with a
  spaCy dependency parse. Keep the two implementations in sync.

## Grammar feature (per-word explanation)

Clicking/selecting a word in the **output** panel opens a tooltip with its
grammatical function and highlights the sentence words it impacts. Same pattern
as translation/CEFR: **one shared contract, two providers.**

- **Shared grammar contract** (local == server), one sentence at a time:
  `{ lang, source:'server'|'local', tokens:[{i,start,end,text,pos,lemma,morph,isPunct}],
  relations:[{type,kind:'agreement'|'government'|'dependency',head,deps:[…],features:[…]}] }`.
  `start/end` are offsets **relative to the sentence**. If you change one
  provider's shape, mirror the other and update the contract tests.
- **`src/grammar/describe.js` is the SINGLE source of PT-BR phrasing.** Providers
  emit only structured data; the UI turns it into text. Never phrase grammar in
  Python or in the local heuristic — do it in `describe.js` so both engines read
  identically and the server stays lean.
- **Capability-based routing.** `/health.models.grammar:{pt,de}` advertises spaCy
  availability. `engine.analyzeGrammar` uses the server only when
  `consent && online && health.models.grammar[lang]`; otherwise (or on server
  error) it falls back to the local heuristic. This avoids duplicating the
  heuristic in Python and makes CI (no spaCy → 503) deterministically use local.
- **DE and PT dependency labels differ** (PT = Universal Dependencies, DE = TIGER).
  `server/app/grammar.py` handles both; keep them in sync when editing relations.
- **Grammar needs a fuller spaCy pipeline** than CEFR: `get_nlp_full` keeps the
  morphologizer/attribute_ruler/lemmatizer (for `token.morph`/`lemma_`), dropping
  only NER. Don't reuse `get_nlp` (which disables them) for grammar.
- **Local gender lexicon** (`src/grammar/data/de-gender.js`) is generated by
  `scripts/build-lexicon.mjs` from gambolputty/german-nouns (MIT; Wiktionary
  CC BY-SA). Keep the attribution. The local analyzer is explicitly approximate
  (badge `≈ local`).

## Commands

```bash
scripts/dev.sh         # start ALL services (frontend + optional backend); Ctrl+C stops both
npm run dev            # Vite dev server only (http://localhost:5173)
npm run build          # production build → dist/
npm test               # JS unit + integration
npm run test:unit      # node:test, no extra deps
npm run test:integration  # UI engine ↔ real server over HTTP
npm run test:server    # cd server && python -m pytest
```

Server run/setup lives in `server/README.md`. Point the UI at a running server
with `VITE_SERVER_URL` (e.g. in `.env.local`).

## Testing notes

- JS tests use the **built-in `node:test`** runner (no Jest/Vitest). Unit tests
  import plain `src/` modules — no `node_modules` needed.
- The integration harness (`test/integration/server-harness.js`) spawns
  `python3 -m uvicorn` **detached** with `MACHADO_FAKE_MT=1`, kills the whole
  process group on teardown, and **auto-skips** if the server can't start. When
  editing it, preserve `detached:true` + `proc.unref()` + group-kill — otherwise
  a leaked child keeps Node's event loop alive and tests hang.
- Server + integration tests need only the **lightweight** deps:
  `pip install -r server/requirements-ci.txt` (fastapi, uvicorn, httpx, pytest)
  — **not** `requirements.txt` (ctranslate2/spacy/transformers, heavy/GPU).
- Python API tests use `pytest.importorskip` so they skip cleanly when fastapi/
  httpx are absent.
- **CI:** `.github/workflows/tests.yml` runs the full suite on every push (any
  branch + main) using the lightweight deps. Keep tests runnable without a GPU
  or the NLLB model.

## Environment

- **Node 18+** (has global `fetch` + built-in test runner). CI uses Node 20.
- **Python 3.11** in practice / CI. ⚠️ `pyproject.toml` currently declares
  `requires-python >=3.13` — a known mismatch; confirm with the user before
  relying on either.

## Conventions

- Comments in code are in **English**; user-facing UI strings and CEFR
  `factors` are in **Portuguese (BR)**. Match the surrounding style.
- When you add a config knob, document it in the relevant README's env-var table.
- Commit or push only when asked. Never stage `huggingface.token`, `models/`,
  `.venv/`, or `.env.local`.
