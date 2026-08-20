import { pipeline, env } from '@xenova/transformers';
import { assessSentence } from './cefr.js';

// CRITICAL: disable local model lookup. When enabled (the default), transformers
// first fetches http://<origin>/models/<model>/config.json etc. The Vite dev
// server answers ANY unknown route with index.html (SPA fallback) — a 200 OK of
// ~885 bytes — which transformers tries to parse as JSON and silently hangs on.
// Disabling local models forces requests straight to the HuggingFace remote host.
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

// Point ort-web at its .wasm binaries. Vite pre-bundles the JS into /.vite/deps/
// but does NOT emit the .wasm files there, and the node_modules path depends on
// npm hoisting — when it's wrong, ort fetches the Vite SPA-fallback index.html
// and tries to "compile" HTML as wasm (the compilation warnings you saw), then
// hangs. Pinning to the CDN for the EXACT ort version transformers bundles
// (1.14.0) guarantees the correct binary. It's fetched once and cached.
env.backends.onnx.wasm.wasmPaths =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';
// Single-threaded WASM — avoids the SharedArrayBuffer requirement and nested
// worker-proxy issues inside this Web Worker.
env.backends.onnx.wasm.numThreads = 1;

// Transformers.js explicitly refuses to attach auth headers in the browser
// (see its hub.js: the browser branch calls `fetch(url)` with no headers).
// So we intercept globalThis.fetch and inject the token ourselves for HF URLs.
//
// The dev token is baked in at build time via Vite `define`, so it is set
// BEFORE any fetch runs — no reliance on a postMessage arriving first.
// In production builds __DEV_HF_TOKEN__ is '' and the token comes via set_token.
let hfToken = (typeof __DEV_HF_TOKEN__ === 'string') ? __DEV_HF_TOKEN__ : '';

function isHFUrl(url) {
  return url.includes('huggingface.co') || url.includes('hf.co');
}

const _origFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);

  if (hfToken && isHFUrl(url)) {
    if (input instanceof Request) {
      const headers = new Headers(input.headers);
      headers.set('Authorization', `Bearer ${hfToken}`);
      return _origFetch(new Request(input, { headers }));
    }
    // transformers' browser path calls fetch(url) with no init — supply one.
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${hfToken}`);
    return _origFetch(url, { ...init, headers });
  }

  return init !== undefined ? _origFetch(input, init) : _origFetch(input);
};

self.onerror = (msg, src, line, col, err) => {
  self.postMessage({ type: 'error', message: err?.message ?? String(msg) });
};

// No direct PT<->DE OPUS-MT model exists (ONNX/browser), so we pivot through
// English using dedicated single-pair models — best translation quality.
const MODELS = {
  'pt-en': 'Xenova/opus-mt-ROMANCE-en', // Portuguese (Romance) -> English (no prefix)
  'en-de': 'Xenova/opus-mt-en-de',      // English -> German
  'de-en': 'Xenova/opus-mt-de-en',      // German -> English
  'en-pt': 'Xenova/opus-mt-en-ROMANCE', // English -> Romance (needs >>pt_br<< prefix)
};

// Each UI direction is a two-hop route through English.
// `prefix` is prepended to that hop's input to select the target Romance
// language (Brazilian Portuguese) for the en-ROMANCE model.
const ROUTES = {
  'pt-de': [{ model: 'pt-en' }, { model: 'en-de' }],
  'de-pt': [{ model: 'de-en' }, { model: 'en-pt', prefix: '>>pt_br<< ' }],
};

// Map UI language codes to BCP-47 locales for the sentence segmenter.
const LOCALES = { pt: 'pt-BR', de: 'de-DE', en: 'en-US' };

// OPUS-MT is sentence-level: given a multi-sentence input it emits end-of-
// sequence after the first sentence and drops the rest. So we split the text
// into sentences and translate each one. Segments keep their surrounding
// whitespace (lead/trail) so newlines and spacing survive reassembly.
function splitIntoSegments(text, lang) {
  let pieces;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter(LOCALES[lang] ?? lang, { granularity: 'sentence' });
    pieces = Array.from(seg.segment(text), s => s.segment);
  } else {
    // Fallback: break after sentence-final punctuation, keeping the delimiter.
    pieces = text.match(/[^.!?…]*[.!?…]+["'”’)\]]*\s*|[^.!?…]+$/g) ?? [text];
  }
  return pieces.map(raw => {
    const [, lead, core, trail] = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return { lead, core, trail };
  });
}

// OPUS-MT frequently drops content wrapped in brackets/parentheses. When a whole
// sentence is enclosed, we peel the wrapper so the model translates the inner
// text as a normal sentence, then re-wrap the result. `close` carries any
// sentence-final punctuation that trailed the closing bracket.
const WRAP_PAIRS = { '(': ')', '[': ']', '{': '}', '«': '»', '“': '”' };
function peelWrap(core) {
  const open = core[0];
  const close = WRAP_PAIRS[open];
  if (!close) return { open: '', inner: core, close: '' };
  const trail = core.match(/[.!?…,;:]*\s*$/)[0];
  const body = trail ? core.slice(0, core.length - trail.length) : core;
  if (body.length > 2 && body[body.length - 1] === close) {
    const inner = body.slice(1, -1);
    // Bail on nested/multiple pairs (e.g. "(a) e (b)") to avoid mangling them.
    if (!inner.includes(close)) return { open, inner, close: close + trail };
  }
  return { open: '', inner: core, close: '' };
}

const translators = {}; // cached pipelines, keyed by model key

function loadModel(modelKey) {
  if (translators[modelKey]) return Promise.resolve(translators[modelKey]);

  return new Promise((resolve, reject) => {
    // Rolling watchdog: resets on every progress event; fires if a load stalls.
    const WATCHDOG_MS = 45_000;
    let watchdogTimer = null;

    function resetWatchdog() {
      clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        reject(new Error(
          'Tempo esgotado ao carregar o modelo. Recarregue a página (F5) e tente novamente.'
        ));
      }, WATCHDOG_MS);
    }

    resetWatchdog();

    pipeline('translation', MODELS[modelKey], {
      progress_callback: (p) => {
        resetWatchdog();
        self.postMessage({ type: 'progress', ...p });
      },
    })
      .then(t => { clearTimeout(watchdogTimer); translators[modelKey] = t; resolve(t); })
      .catch(e => { clearTimeout(watchdogTimer); reject(e); });
  });
}

async function clearBrowserCache() {
  if (typeof caches === 'undefined') return 0;
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  return keys.length;
}

self.addEventListener('message', async ({ data }) => {
  if (data.type === 'set_token') {
    hfToken = data.token ?? '';
    self.postMessage({ type: 'token_ack', hasToken: !!hfToken });
    return;
  }

  if (data.type === 'clear_cache') {
    const count = await clearBrowserCache();
    self.postMessage({ type: 'cache_cleared', count });
    return;
  }

  if (data.type !== 'translate') return;

  const { text, direction, id } = data;
  const route = ROUTES[direction];
  if (!route) {
    self.postMessage({ type: 'error', message: `Direção não suportada: ${direction}`, id });
    return;
  }

  try {
    // Phase 1 — download/warm all models this route needs (shows progress).
    for (const hop of route) await loadModel(hop.model);
    self.postMessage({ type: 'model_ready', direction });

    // Phase 2 — segment into sentences, then run the pivot on the whole batch
    // per hop (text -> English -> target). Batching keeps it fast; segmenting
    // stops OPUS-MT from dropping every sentence after the first.
    const srcLang = direction.split('-')[0];
    const segments = splitIntoSegments(text, srcLang);
    // Peel bracket wrappers so parenthetical sentences aren't dropped.
    const wraps = segments.filter(s => s.core).map(s => peelWrap(s.core));
    let current = wraps.map(w => w.inner);

    for (const hop of route) {
      if (current.length === 0) break;
      const inputs = current.map(s => (hop.prefix ?? '') + s);
      const outputs = await translators[hop.model](inputs, { max_new_tokens: 512 });
      current = outputs.map(o => o.translation_text);
    }

    // Re-wrap peeled brackets to form the final translated sentences.
    const finals = current.map((t, i) => wraps[i].open + t + wraps[i].close);

    // Build ordered display parts: 'gap' = whitespace to render verbatim,
    // 'sentence' = a translated sentence carrying its CEFR assessment (scored
    // in the TARGET language). The UI renders sentences as hoverable spans.
    const tgtLang = direction.split('-')[1];
    const parts = [];
    let ci = 0;
    for (const seg of segments) {
      if (seg.core) {
        const translation = finals[ci++];
        if (seg.lead) parts.push({ type: 'gap', text: seg.lead });
        parts.push({ type: 'sentence', text: translation, cefr: assessSentence(translation, tgtLang) });
        if (seg.trail) parts.push({ type: 'gap', text: seg.trail });
      } else if (seg.lead) {
        parts.push({ type: 'gap', text: seg.lead });
      }
    }
    const resultText = parts.map(p => p.text).join('');
    self.postMessage({ type: 'result', text: resultText, parts, id });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message ?? String(err), id });
  }
});
