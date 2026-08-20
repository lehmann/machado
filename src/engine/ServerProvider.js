// ServerProvider — full server-side engine. Calls the self-hosted backend
// (FastAPI + NLLB-200 + spaCy CEFR, to be built) over HTTP. Returns the SAME
// `parts[]` contract the worker produces, so the UI is engine-agnostic.
//
// The backend does not exist yet: until it does, health() simply returns false
// (server unreachable) and the engine falls back to local — no breakage.
//
// API contract:
//   GET  /health    -> { ok: true, models: {...} }
//   POST /translate -> { text, source, target } => { text, parts, engine, model }
export class ServerProvider {
  name = 'server';

  constructor(handlers, { baseUrl = '', timeoutMs = 30000, healthTimeoutMs = 1500 } = {}) {
    this.handlers = handlers;
    // '' = same origin. In dev, set VITE_SERVER_URL (e.g. http://localhost:8000).
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.healthTimeoutMs = healthTimeoutMs;
  }

  // Token is an HF-Hub concern of the local engine only; irrelevant server-side.
  setToken() {}

  // Model cache lives on the server; nothing to clear from the browser.
  clearCache() {}

  // Full /health body (or null if unreachable). Used by the engine to read both
  // the translation `ok` flag and per-language capabilities (e.g. grammar).
  async info() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.healthTimeoutMs);
      const res = await fetch(`${this.baseUrl}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null; // unreachable, aborted, offline — treat as unavailable
    }
  }

  async health() {
    const body = await this.info();
    return !!body?.ok;
  }

  async translate({ text, direction, id }) {
    const [source, target] = direction.split('-');
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      const res = await fetch(`${this.baseUrl}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source, target }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Servidor respondeu ${res.status}`);
      const data = await res.json();
      this.handlers.onResult?.({
        type: 'result',
        text: data.text,
        parts: data.parts ?? null,
        id,
        engine: 'server',
      });
    } catch (err) {
      // recoverable → the engine may retry the request on the local provider.
      this.handlers.onError?.({
        message: err.message ?? String(err),
        id,
        engine: 'server',
        recoverable: true,
      });
    }
  }

  dispose() {}
}
