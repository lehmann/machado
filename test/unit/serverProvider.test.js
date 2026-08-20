import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ServerProvider } from '../../src/engine/ServerProvider.js';

// Swap globalThis.fetch for the duration of `fn`.
async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test('health() returns true when /health responds ok:true', async () => {
  await withFetch(async () => jsonResponse({ ok: true }), async () => {
    const sp = new ServerProvider({}, { baseUrl: 'http://x' });
    assert.equal(await sp.health(), true);
  });
});

test('health() returns false on non-ok HTTP', async () => {
  await withFetch(async () => jsonResponse({}, false, 500), async () => {
    const sp = new ServerProvider({}, { baseUrl: 'http://x' });
    assert.equal(await sp.health(), false);
  });
});

test('health() returns false when fetch throws (offline/unreachable)', async () => {
  await withFetch(async () => { throw new Error('ECONNREFUSED'); }, async () => {
    const sp = new ServerProvider({}, { baseUrl: 'http://x' });
    assert.equal(await sp.health(), false);
  });
});

test('translate() forwards parts to onResult with engine tag', async () => {
  const parts = [{ type: 'sentence', text: 'Hallo', cefr: { level: 'A1' } }];
  let result = null;
  await withFetch(async (url) => {
    assert.ok(String(url).endsWith('/translate'));
    return jsonResponse({ text: 'Hallo', parts });
  }, async () => {
    const sp = new ServerProvider({ onResult: (d) => { result = d; } }, { baseUrl: 'http://x' });
    await sp.translate({ text: 'Olá', direction: 'pt-de', id: 7 });
  });
  assert.equal(result.type, 'result');
  assert.equal(result.engine, 'server');
  assert.equal(result.id, 7);
  assert.deepEqual(result.parts, parts);
});

test('translate() sends source/target derived from direction', async () => {
  let sentBody = null;
  await withFetch(async (url, init) => {
    sentBody = JSON.parse(init.body);
    return jsonResponse({ text: '', parts: [] });
  }, async () => {
    const sp = new ServerProvider({ onResult() {} }, { baseUrl: 'http://x' });
    await sp.translate({ text: 'Hallo', direction: 'de-pt', id: 1 });
  });
  assert.equal(sentBody.source, 'de');
  assert.equal(sentBody.target, 'pt');
  assert.equal(sentBody.text, 'Hallo');
});

test('translate() reports a recoverable error on HTTP failure', async () => {
  let err = null;
  await withFetch(async () => jsonResponse({}, false, 503), async () => {
    const sp = new ServerProvider({ onError: (d) => { err = d; } }, { baseUrl: 'http://x' });
    await sp.translate({ text: 'Olá', direction: 'pt-de', id: 3 });
  });
  assert.equal(err.engine, 'server');
  assert.equal(err.recoverable, true);
  assert.equal(err.id, 3);
});
