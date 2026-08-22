import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TranslatorEngine } from '../../src/engine/TranslatorEngine.js';

// Build a fake provider factory. The returned factory captures the engine's
// internal handler bundle so a test can drive fallback by emitting onError.
function fakeProviderFactory(name, opts = {}) {
  return (handlers) => ({
    name,
    handlers,
    calls: [],
    tokenSet: undefined,
    async health() { return opts.health ?? true; },
    translate(req) {
      this.calls.push(req);
      opts.onTranslate?.(this, req);
    },
    setToken(t) { this.tokenSet = t; },
    clearCache() { this.cacheCleared = true; },
    dispose() {},
  });
}

function makeEngine(app, opts, deps) {
  return new TranslatorEngine(app, opts, deps);
}

test('no consent → always local', async () => {
  const engine = makeEngine({}, { hasToken: true, consent: false }, {
    createLocal: fakeProviderFactory('local'),
    createServer: fakeProviderFactory('server', { health: true }),
  });
  await engine.translate({ text: 'oi', direction: 'pt-de', id: 1 });
  assert.equal(engine.local.calls.length, 1);
  assert.equal(engine.server.calls.length, 0);
  assert.equal(engine.activeMode, 'local');
});

test('consent + healthy server → server, fires onModeChange', async () => {
  const modes = [];
  const engine = makeEngine({ onModeChange: (m) => modes.push(m) }, { hasToken: true, consent: true }, {
    createLocal: fakeProviderFactory('local'),
    createServer: fakeProviderFactory('server', { health: true }),
  });
  await engine.translate({ text: 'oi', direction: 'pt-de', id: 1 });
  assert.equal(engine.server.calls.length, 1);
  assert.equal(engine.local.calls.length, 0);
  assert.equal(engine.activeMode, 'server');
  assert.deepEqual(modes, ['server']);
});

test('consent but unhealthy server → local', async () => {
  const engine = makeEngine({}, { hasToken: true, consent: true }, {
    createLocal: fakeProviderFactory('local'),
    createServer: fakeProviderFactory('server', { health: false }),
  });
  await engine.translate({ text: 'oi', direction: 'pt-de', id: 1 });
  assert.equal(engine.local.calls.length, 1);
  assert.equal(engine.server.calls.length, 0);
});

test('offline forces local even with consent + healthy server', async () => {
  const prev = globalThis.navigator;
  globalThis.navigator = { onLine: false };
  try {
    const engine = makeEngine({}, { hasToken: true, consent: true }, {
      createLocal: fakeProviderFactory('local'),
      createServer: fakeProviderFactory('server', { health: true }),
    });
    await engine.translate({ text: 'oi', direction: 'pt-de', id: 1 });
    assert.equal(engine.local.calls.length, 1);
    assert.equal(engine.server.calls.length, 0);
  } finally {
    if (prev === undefined) delete globalThis.navigator;
    else globalThis.navigator = prev;
  }
});

test('recoverable server error → falls back to local + fires onModeFallback', async () => {
  const fallbacks = [];
  const engine = makeEngine({ onModeFallback: (d) => fallbacks.push(d) }, { hasToken: true, consent: true }, {
    createLocal: fakeProviderFactory('local'),
    createServer: fakeProviderFactory('server', {
      health: true,
      onTranslate: (self, req) => self.handlers.onError({ engine: 'server', recoverable: true, id: req.id }),
    }),
  });
  await engine.translate({ text: 'oi', direction: 'pt-de', id: 42 });
  assert.equal(engine.server.calls.length, 1);
  assert.equal(engine.local.calls.length, 1);       // re-dispatched locally
  assert.equal(engine.local.calls[0].id, 42);
  assert.equal(fallbacks.length, 1);
  assert.equal(engine.activeMode, 'local');
});

test('local with no token → onNeedToken, does not translate', async () => {
  let needed = 0;
  const engine = makeEngine({ onNeedToken: () => { needed += 1; } }, { hasToken: false, consent: false }, {
    createLocal: fakeProviderFactory('local'),
    createServer: fakeProviderFactory('server'),
  });
  await engine.translate({ text: 'oi', direction: 'pt-de', id: 1 });
  assert.equal(needed, 1);
  assert.equal(engine.local.calls.length, 0);
});

test('local with no token but self-hosted models → translates, no onNeedToken', async () => {
  let needed = 0;
  const engine = makeEngine(
    { onNeedToken: () => { needed += 1; } },
    { hasToken: false, consent: false, modelsSelfHosted: true },
    { createLocal: fakeProviderFactory('local'), createServer: fakeProviderFactory('server') },
  );
  await engine.translate({ text: 'oi', direction: 'pt-de', id: 1 });
  assert.equal(needed, 0);
  assert.equal(engine.local.calls.length, 1);
});

test('server error fallback with no token but self-hosted → re-dispatches locally', async () => {
  let needed = 0;
  const engine = makeEngine(
    { onNeedToken: () => { needed += 1; } },
    { hasToken: false, consent: true, modelsSelfHosted: true },
    {
      createLocal: fakeProviderFactory('local'),
      createServer: fakeProviderFactory('server', {
        health: true,
        onTranslate: (self, req) => self.handlers.onError({ engine: 'server', recoverable: true, id: req.id }),
      }),
    },
  );
  await engine.translate({ text: 'oi', direction: 'pt-de', id: 7 });
  assert.equal(needed, 0);
  assert.equal(engine.local.calls.length, 1);
  assert.equal(engine.local.calls[0].id, 7);
});

test('setToken updates hasToken and forwards to local provider', async () => {
  const engine = makeEngine({}, { hasToken: false, consent: false }, {
    createLocal: fakeProviderFactory('local'),
    createServer: fakeProviderFactory('server'),
  });
  engine.setToken('hf_abc');
  assert.equal(engine.hasToken, true);
  assert.equal(engine.local.tokenSet, 'hf_abc');
});

test('non-recoverable error is forwarded to app onError', async () => {
  let err = null;
  const engine = makeEngine({ onError: (d) => { err = d; } }, { hasToken: true, consent: true }, {
    createLocal: fakeProviderFactory('local'),
    createServer: fakeProviderFactory('server', {
      health: true,
      onTranslate: (self, req) => self.handlers.onError({ engine: 'server', message: 'boom', id: req.id }),
    }),
  });
  await engine.translate({ text: 'oi', direction: 'pt-de', id: 1 });
  assert.equal(err.message, 'boom');
  assert.equal(engine.local.calls.length, 0); // no fallback without recoverable
});
