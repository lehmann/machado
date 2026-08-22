// Per-word synonym suggestions for the grammar tooltip. Like describe.js, this
// runs entirely in the UI and is shared by BOTH engines: it keys off the token's
// lemma (or, when the local heuristic doesn't supply one, its surface form) plus
// its part of speech, and looks the word up in a compact bundled thesaurus
// (src/grammar/data/synonyms-{de,pt}.js). The server stays lean — it emits only
// the structured contract; suggestions are derived here identically in both modes
// (server mode is better because it provides a real lemma).
//
// The thesauri are loaded lazily (dynamic import) so they don't weigh down the
// initial bundle for users who never open a word tooltip; each language table is
// its own chunk, cached by the service worker after first use.
//
// "Only when it makes sense": suggestions are offered for open-class content words
// (noun, verb, adjective, adverb) and only when the thesaurus has a confident
// entry; otherwise none are returned. At most 2 are shown.

const LOADERS = {
  de: () => import('./data/synonyms-de.js'),
  pt: () => import('./data/synonyms-pt.js'),
};

const cache = {}; // lang → Promise<table>

function loadTable(lang) {
  const l = LOADERS[lang] ? lang : 'pt';
  if (!cache[l]) {
    // Cache the promise; on failure (e.g. offline before first fetch) fall back
    // to an empty table and forget it so a later attempt can retry.
    cache[l] = LOADERS[l]()
      .then((m) => m.default)
      .catch(() => { delete cache[l]; return {}; });
  }
  return cache[l];
}

// Open-class parts of speech worth suggesting synonyms for. Function words
// (articles, prepositions, pronouns, conjunctions) and punctuation are skipped.
const CONTENT_POS = new Set(['NOUN', 'VERB', 'ADJ', 'ADV']);

const MAX_SHOWN = 2;

// Returns up to 2 synonym strings for a token, or [] when none make sense.
export async function suggestSynonyms(token, lang) {
  if (!token || token.isPunct) return [];
  if (!CONTENT_POS.has(token.pos)) return [];

  const key = (token.lemma || token.text || '').toLowerCase();
  if (!key) return [];

  const table = await loadTable(lang);
  const raw = table[key];
  if (!raw) return [];

  return raw
    .split(' ')
    .filter((w) => w && w.toLowerCase() !== key) // never echo the word itself
    .slice(0, MAX_SHOWN);
}
