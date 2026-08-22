// Setup-time fetcher: downloads the OPUS-MT ONNX models the LOCAL (in-browser)
// translator uses into web-models/, so a PRODUCTION deploy can serve them from
// its own origin (uvicorn mounts the dir at /models; see server/app/main.py).
// That removes the HuggingFace token requirement for offline use — the browser
// no longer contacts a third party to fetch model weights.
//
// Only the files Transformers.js loads by default are fetched: the *quantized*
// encoder/decoder ONNX graphs plus the tokenizer/config assets. ~474 MB total
// for both translation directions (4 single-pair pivot models).
//
//   Run: node scripts/fetch-models.mjs [--out DIR] [--models a,b,...]
//
// Idempotent — a file already present with the expected size is skipped, so
// re-running only fetches what's missing. Dev/preview are unaffected: they keep
// pulling from the Hub with the dev token (see vite.config.js / __MODELS_BASE__).
// This is purely a production convenience.
//
// A HuggingFace token is used if available (huggingface.token file, or HF_TOKEN /
// HUGGING_FACE_HUB_TOKEN env) to avoid anonymous rate limits; the models are
// public, so it is not strictly required.
import { createWriteStream } from 'fs';
import { mkdir, stat, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const HF = 'https://huggingface.co';
const REVISION = 'main';

// The 4 single-pair pivot models — must match src/translator.worker.js MODELS.
const ALL_MODELS = [
  'Xenova/opus-mt-ROMANCE-en', // pt→en
  'Xenova/opus-mt-en-de',      // en→de
  'Xenova/opus-mt-de-en',      // de→en
  'Xenova/opus-mt-en-ROMANCE', // en→pt
];

// Files Transformers.js needs. ONNX = the default (quantized) graphs only —
// NOT the fp32/fp16/q4 variants, which the browser engine never requests.
const REQUIRED = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];
// Present on these repos but not fatal if a future repo drops one.
const OPTIONAL = [
  'generation_config.json',
  'special_tokens_map.json',
  'source.spm',
  'target.spm',
];

// ── args ────────────────────────────────────────────────────────────
let outDir = 'web-models';
let models = ALL_MODELS;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--out') outDir = process.argv[++i];
  else if (a === '--models') models = process.argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '-h' || a === '--help') {
    console.log('Usage: node scripts/fetch-models.mjs [--out DIR] [--models a,b,...]');
    process.exit(0);
  } else { console.error(`Unknown option: ${a}`); process.exit(2); }
}

async function readToken() {
  if (process.env.HF_TOKEN) return process.env.HF_TOKEN.trim();
  if (process.env.HUGGING_FACE_HUB_TOKEN) return process.env.HUGGING_FACE_HUB_TOKEN.trim();
  try { return (await readFile('huggingface.token', 'utf-8')).trim(); } catch { return ''; }
}
const token = await readToken();
const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

function fmtMB(bytes) { return `${(bytes / 1e6).toFixed(1)} MB`; }

// Remote size via HEAD (Content-Length), or null if unknown.
async function remoteSize(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: authHeaders, redirect: 'follow' });
    if (!r.ok) return null;
    const len = r.headers.get('content-length');
    return len ? Number(len) : null;
  } catch { return null; }
}

async function localSize(path) {
  try { return (await stat(path)).size; } catch { return -1; }
}

async function download(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const r = await fetch(url, { headers: authHeaders, redirect: 'follow' });
  if (!r.ok) { const e = new Error(`${r.status} ${r.statusText}`); e.status = r.status; throw e; }
  if (!r.body) throw new Error('empty response body');
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
}

let totalBytes = 0;
let downloaded = 0;
let skipped = 0;

for (const model of models) {
  console.log(`\n=== ${model} ===`);
  for (const file of [...REQUIRED, ...OPTIONAL]) {
    const optional = OPTIONAL.includes(file);
    const url = `${HF}/${model}/resolve/${REVISION}/${file}`;
    const dest = join(outDir, model, file);

    const want = await remoteSize(url);
    const have = await localSize(dest);
    if (have >= 0 && want !== null && have === want) {
      console.log(`  skip  ${file} (${fmtMB(have)})`);
      totalBytes += have; skipped++;
      continue;
    }
    try {
      process.stdout.write(`  get   ${file}${want !== null ? ` (${fmtMB(want)})` : ''}… `);
      await download(url, dest);
      const size = await localSize(dest);
      totalBytes += size >= 0 ? size : 0; downloaded++;
      console.log('done');
    } catch (err) {
      if (optional && err.status === 404) { console.log('absent (optional)'); continue; }
      console.log('FAILED');
      console.error(`\nFailed to fetch ${url}: ${err.message}`);
      if (err.status === 401 || err.status === 403) {
        console.error('Authentication failed — set a valid token (huggingface.token or HF_TOKEN).');
      }
      process.exit(1);
    }
  }
}

console.log(`\n✓ Models ready in ${outDir}/ — ${downloaded} fetched, ${skipped} cached, ${fmtMB(totalBytes)} total.`);
