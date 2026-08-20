// LocalGrammarProvider — offline grammar analysis in the browser via the
// heuristic analyzer. Mirrors the provider shape of the translation engine but
// is request/response (analyze returns a Promise) since grammar is a discrete
// query triggered by a click, not a streaming job. Runs on the main thread — the
// heuristic is light and needs no model download.
import { analyzeLocal } from './heuristic.js';

export class LocalGrammarProvider {
  name = 'local';

  // eslint-disable-next-line class-methods-use-this
  async analyze({ text, lang }) {
    return analyzeLocal(text, lang);
  }
}
