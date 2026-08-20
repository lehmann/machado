// TranslatorEngine — the indirection layer between the UI and the two engines.
//
// The app talks only to this class; it never touches a provider directly. On
// each translate() it resolves which engine to use:
//
//   server  ⟺  user consented  AND  online  AND  /health OK (cached ~30s)
//   local   ⟺  otherwise (offline, no consent, or server unavailable)
//
// If a server request fails mid-flight it falls back to the local engine and
// re-dispatches the same request, notifying the UI of the mode change.
//
// Both engines emit the same events and the same `parts[]` result shape, so the
// UI renders identically regardless of which one ran.
import { LocalProvider } from './LocalProvider.js';
import { ServerProvider } from './ServerProvider.js';

const HEALTH_TTL_MS = 30000;

export class TranslatorEngine {
  constructor(handlers, { serverBaseUrl = '', hasToken = false, consent = false } = {}, deps = {}) {
    this.app = handlers;
    this.hasToken = hasToken;
    this.consent = consent;
    this.activeName = 'local';
    this._lastReq = null;
    this._health = null; // { ok, ts }

    // Providers share one handler bundle; the engine intercepts errors so it
    // can implement server→local fallback before forwarding to the app.
    const providerHandlers = {
      onProgress: (d) => this.app.onProgress?.(d),
      onModelReady: (d) => this.app.onModelReady?.(d),
      onResult: (d) => this.app.onResult?.(d),
      onError: (d) => this._onProviderError(d),
    };

    // `deps.createLocal`/`deps.createServer` are test seams — they let tests
    // inject fake providers. In production both default to the real engines.
    const createLocal = deps.createLocal ?? ((h) => new LocalProvider(h));
    const createServer = deps.createServer ?? ((h) => new ServerProvider(h, { baseUrl: serverBaseUrl }));
    this.local = createLocal(providerHandlers);
    this.server = createServer(providerHandlers);
  }

  // ── configuration ──────────────────────────────────────────────

  setToken(token) {
    this.hasToken = !!token;
    this.local.setToken(token);
  }

  setConsent(consent) {
    this.consent = !!consent;
    this._health = null; // re-probe on next resolve
  }

  // Force a fresh health probe (used by the settings UI). Returns availability.
  async checkServer() {
    const ok = this.consent ? await this.server.health() : false;
    this._health = { ok, ts: Date.now() };
    return ok;
  }

  // ── dispatch ───────────────────────────────────────────────────

  async translate(req) {
    this._lastReq = req;
    const name = await this._resolve();

    if (name === 'local' && !this.hasToken) {
      // Local engine needs an HF token to download models — ask the UI for one
      // instead of hanging silently.
      this.app.onNeedToken?.();
      return;
    }

    this._setActive(name);
    (name === 'server' ? this.server : this.local).translate(req);
  }

  clearCache() {
    this.local.clearCache();
    this.server.clearCache();
  }

  dispose() {
    this.local.dispose();
    this.server.dispose();
  }

  get activeMode() {
    return this.activeName;
  }

  // ── internals ──────────────────────────────────────────────────

  async _resolve() {
    if (!this.consent) return 'local';
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'local';
    return (await this._serverAvailable()) ? 'server' : 'local';
  }

  async _serverAvailable() {
    const now = Date.now();
    if (this._health && now - this._health.ts < HEALTH_TTL_MS) return this._health.ok;
    const ok = await this.server.health();
    this._health = { ok, ts: now };
    return ok;
  }

  _setActive(name) {
    if (name !== this.activeName) {
      this.activeName = name;
      this.app.onModeChange?.(name);
    }
  }

  _onProviderError(d) {
    // A recoverable server failure → retry on the local engine.
    if (d.engine === 'server' && d.recoverable && this._lastReq) {
      this._health = { ok: false, ts: Date.now() }; // stop hammering a dead server
      this.app.onModeFallback?.({ from: 'server', to: 'local', reason: d.message });
      if (!this.hasToken) {
        this._setActive('local');
        this.app.onNeedToken?.();
        return;
      }
      this._setActive('local');
      this.local.translate(this._lastReq);
      return;
    }
    this.app.onError?.(d);
  }
}
