// LocalProvider — full client-side engine. Wraps the existing translation
// worker (Transformers.js pivot MT + heuristic CEFR) behind the common
// Provider interface. Emits the worker's streaming events (download progress,
// model_ready, result, error) through the handler callbacks so the UI can
// show model-download progress exactly as before.
//
// Provider interface (shared with ServerProvider):
//   name: string
//   setToken(token): void
//   translate({ text, direction, id }): void   // async work, results via handlers
//   clearCache(): void
//   health(): Promise<boolean>
//   dispose(): void
export class LocalProvider {
  name = 'local';

  constructor(handlers) {
    this.handlers = handlers;
    this.worker = new Worker(
      new URL('../translator.worker.js', import.meta.url),
      { type: 'module' }
    );
    this.worker.onmessage = ({ data }) => this._dispatch(data);
    this.worker.onerror = (e) => {
      this.handlers.onError?.({
        message: `Falha ao inicializar o worker: ${e.message ?? 'erro desconhecido'}. Abra o console do navegador para detalhes.`,
        engine: 'local',
      });
    };
  }

  _dispatch(data) {
    switch (data.type) {
      case 'progress':
        this.handlers.onProgress?.(data);
        break;
      case 'model_ready':
        this.handlers.onModelReady?.(data);
        break;
      case 'result':
        this.handlers.onResult?.({ ...data, engine: 'local' });
        break;
      case 'error':
        this.handlers.onError?.({ ...data, engine: 'local' });
        break;
      // token_ack, cache_cleared — no UI action needed
    }
  }

  setToken(token) {
    this.worker.postMessage({ type: 'set_token', token: token ?? '' });
  }

  translate({ text, direction, id }) {
    this.worker.postMessage({ type: 'translate', text, direction, id });
  }

  clearCache() {
    this.worker.postMessage({ type: 'clear_cache' });
  }

  // The local worker is always reachable; model downloads happen lazily on
  // first translate. Availability here means "the engine can run", not "models
  // are already cached".
  async health() {
    return true;
  }

  dispose() {
    this.worker.terminate();
  }
}
