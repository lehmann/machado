import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TranslatorEngine } from '../../src/engine/TranslatorEngine.js';

// Minimal fake translation providers (grammar routing only reads server.info()).
function translateFakes(infoBody) {
  const base = {
    calls: [], translate(r) { this.calls.push(r); }, setToken() {}, clearCache() {},
    dispose() {}, async health() { return !!infoBody?.ok; },
  };
  return {
    createLocal: () => ({ ...base, calls: [] }),
    createServer: () => ({ ...base, calls: [], async info() { return infoBody; } }),
  };
}

// Fake grammar providers that count analyze() calls.
function grammarFakes() {
  const mk = (name) => ({ name, calls: 0, async analyze({ text, lang }) { this.calls += 1; return { source: name, lang, text, tokens: [], relations: [] }; } });
  const local = mk('local');
  const server = mk('server');
  return {
    local, server,
    createLocalGrammar: () => local,
    createServerGrammar: () => server,
  };
}

function makeEngine({ consent, infoBody }) {
  const t = translateFakes(infoBody);
  const g = grammarFakes();
  const engine = new TranslatorEngine({}, { serverBaseUrl: 'http://x', hasToken: true, consent }, {
    ...t,
    createLocalGrammar: g.createLocalGrammar,
    createServerGrammar: g.createServerGrammar,
  });
  return { engine, g };
}

test('grammar → server when consent + server advertises the grammar capability', async () => {
  const { engine, g } = makeEngine({ consent: true, infoBody: { ok: true, models: { grammar: { de: true, pt: true } } } });
  const res = await engine.analyzeGrammar({ text: 'Der Hund schläft.', lang: 'de' });
  assert.equal(res.source, 'server');
  assert.equal(g.server.calls, 1);
  assert.equal(g.local.calls, 0);
});

test('grammar → local when the server lacks the grammar capability', async () => {
  const { engine, g } = makeEngine({ consent: true, infoBody: { ok: true, models: { grammar: { de: false, pt: false } } } });
  const res = await engine.analyzeGrammar({ text: 'Der Hund schläft.', lang: 'de' });
  assert.equal(res.source, 'local');
  assert.equal(g.local.calls, 1);
  assert.equal(g.server.calls, 0);
});

test('grammar → local when there is no consent', async () => {
  const { engine, g } = makeEngine({ consent: false, infoBody: { ok: true, models: { grammar: { de: true } } } });
  const res = await engine.analyzeGrammar({ text: 'Olá.', lang: 'pt' });
  assert.equal(res.source, 'local');
  assert.equal(g.server.calls, 0);
});

test('grammar falls back to local when the server analyzer throws', async () => {
  const { engine, g } = makeEngine({ consent: true, infoBody: { ok: true, models: { grammar: { de: true } } } });
  g.server.analyze = async () => { throw new Error('boom'); };
  const res = await engine.analyzeGrammar({ text: 'Der Hund schläft.', lang: 'de' });
  assert.equal(res.source, 'local');
  assert.equal(g.local.calls, 1);
});

test('grammar results are cached per (lang, text)', async () => {
  const { engine, g } = makeEngine({ consent: true, infoBody: { ok: true, models: { grammar: { de: true } } } });
  await engine.analyzeGrammar({ text: 'Der Hund schläft.', lang: 'de' });
  await engine.analyzeGrammar({ text: 'Der Hund schläft.', lang: 'de' });
  assert.equal(g.server.calls, 1); // second call served from cache
});
