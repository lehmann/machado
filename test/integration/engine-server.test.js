// Integration tests: the real frontend engine code (ServerProvider,
// TranslatorEngine) talking over HTTP to a real running server. Verifies the
// end-to-end `parts[]` contract and the mode-selection / fallback behavior.
//
// The server runs with MACHADO_FAKE_MT=1 (deterministic stand-in translation),
// so no GPU or NLLB model is needed. If the server can't start (Python deps
// missing), every test skips.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from './server-harness.js';
import { ServerProvider } from '../../src/engine/ServerProvider.js';
import { TranslatorEngine } from '../../src/engine/TranslatorEngine.js';

let server = null;

before(async () => { server = await startServer(); });
after(() => { server?.stop?.(); });

const SKIP_MSG =
  'server-side indisponível — instale server/requirements.txt (fastapi+uvicorn bastam com MACHADO_FAKE_MT)';

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('ServerProvider.health() is true against a live server', async (t) => {
  if (!server) return t.skip(SKIP_MSG);
  const sp = new ServerProvider({}, { baseUrl: server.url });
  assert.equal(await sp.health(), true);
});

test('ServerProvider.translate() returns the parts[] contract', async (t) => {
  if (!server) return t.skip(SKIP_MSG);
  const got = deferred();
  const sp = new ServerProvider({ onResult: (d) => got.resolve(d) }, { baseUrl: server.url });
  await sp.translate({ text: 'Olá mundo. Como vai?', direction: 'pt-de', id: 1 });
  const res = await got.promise;

  assert.equal(res.engine, 'server');
  assert.ok(Array.isArray(res.parts) && res.parts.length > 0);
  const sentences = res.parts.filter((p) => p.type === 'sentence');
  assert.equal(sentences.length, 2);
  for (const s of sentences) {
    assert.ok(s.text.startsWith('DE: '));                 // fake MT marker
    assert.ok(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(s.cefr.level));
  }
  // Reassembled text equals the concatenation of parts.
  assert.equal(res.text, res.parts.map((p) => p.text).join(''));
});

test('TranslatorEngine routes to the live server when consent + reachable', async (t) => {
  if (!server) return t.skip(SKIP_MSG);
  const got = deferred();
  const modes = [];
  // Real ServerProvider (default factory) + a fake local to prove it's unused.
  const engine = new TranslatorEngine(
    { onResult: (d) => got.resolve(d), onModeChange: (m) => modes.push(m) },
    { serverBaseUrl: server.url, hasToken: true, consent: true },
    { createLocal: () => ({ calls: [], translate(r) { this.calls.push(r); }, setToken() {}, clearCache() {}, dispose() {}, async health() { return true; } }) }
  );
  await engine.translate({ text: 'Bom dia.', direction: 'pt-de', id: 5 });
  const res = await got.promise;

  assert.equal(res.engine, 'server');
  assert.equal(engine.activeMode, 'server');
  assert.deepEqual(modes, ['server']);
  assert.equal(engine.local.calls.length, 0);
});

test('analyzeGrammar falls back to local when the server lacks spaCy', async (t) => {
  if (!server) return t.skip(SKIP_MSG);
  // The fake-MT server advertises grammar:{pt:false,de:false} (no spaCy in CI),
  // so the engine must route grammar to the local heuristic and still honor the
  // shared contract.
  // Fake the translation LocalProvider (the real one needs a browser Worker);
  // the grammar providers use their real default factories.
  const engine = new TranslatorEngine(
    {},
    { serverBaseUrl: server.url, hasToken: true, consent: true },
    { createLocal: () => ({ translate() {}, setToken() {}, clearCache() {}, dispose() {}, async health() { return true; } }) }
  );
  const analysis = await engine.analyzeGrammar({ text: 'Der große Hund schläft.', lang: 'de' });

  assert.equal(analysis.source, 'local');
  assert.equal(analysis.lang, 'de');
  assert.ok(Array.isArray(analysis.tokens) && analysis.tokens.length > 0);
  assert.ok(Array.isArray(analysis.relations));
  // Offsets are relative to the analysed sentence.
  const text = 'Der große Hund schläft.';
  for (const tok of analysis.tokens) {
    assert.equal(text.slice(tok.start, tok.end), tok.text);
  }
});

test('TranslatorEngine falls back to local when the server URL is dead', async (t) => {
  if (!server) return t.skip(SKIP_MSG);
  const engine = new TranslatorEngine(
    {},
    { serverBaseUrl: 'http://127.0.0.1:59999', hasToken: true, consent: true },
    { createLocal: () => ({ calls: [], translate(r) { this.calls.push(r); }, setToken() {}, clearCache() {}, dispose() {}, async health() { return true; } }) }
  );
  await engine.translate({ text: 'Bom dia.', direction: 'pt-de', id: 9 });
  assert.equal(engine.local.calls.length, 1);
  assert.equal(engine.local.calls[0].id, 9);
  assert.equal(engine.activeMode, 'local');
});
