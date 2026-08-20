// ServerGrammarProvider — high-precision grammar analysis from the self-hosted
// backend (FastAPI + spaCy). POSTs one sentence to /grammar and returns the same
// structured contract the local analyzer produces. Throws on any failure so the
// engine can fall back to the local heuristic.
export class ServerGrammarProvider {
  name = 'server';

  constructor({ baseUrl = '', timeoutMs = 15000 } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  async analyze({ text, lang }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/grammar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Servidor respondeu ${res.status}`);
      const data = await res.json();
      return { ...data, source: 'server' };
    } finally {
      clearTimeout(timer);
    }
  }
}
