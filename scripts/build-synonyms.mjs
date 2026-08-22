// One-time generator: builds src/grammar/data/synonyms-{de,pt}.js — compact
// synonym lookups used by the per-word grammar tooltip. The suggestion happens
// entirely in the UI (see src/grammar/synonyms.js), keyed by the token's
// lemma/surface form, so BOTH engines (local heuristic and server/spaCy) read
// the same table and the server stays lean.
//
// Source: the LibreOffice MyThes thesauri (dictionaries repo). The German data
// derives from OpenThesaurus; the Brazilian-Portuguese data from TeP 2.0. The
// MyThes .dat format and the thesaurus code are under a BSD-style license
// (Kevin B. Hendricks); keep this attribution if the generated files are shipped.
//
// We intersect head words with the existing frequency lists (src/data/freq-*.js,
// OpenSubtitles top-N) so only learner-relevant words are kept, and we rank each
// entry's synonyms by frequency so the most common alternative comes first. Only
// single-word synonyms are kept (multi-word phrases and usage-note annotations
// are dropped) — the tooltip shows at most 2.
//
//   Run: node scripts/build-synonyms.mjs
import { writeFileSync } from 'fs';

import freqDe from '../src/data/freq-de.js';
import freqPt from '../src/data/freq-pt.js';

const SOURCES = {
  de: {
    url: 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master/de/th_de_DE_v2.dat',
    freq: freqDe,
  },
  pt: {
    url: 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master/pt_BR/th_pt_BR.dat',
    freq: freqPt,
  },
};

const MAX_SYNONYMS = 3; // stored per head word; the UI caps display at 2

// Parse a MyThes .dat file into a Map<headword(lowercased), sense[][]> where
// each sense is an ordered, de-duplicated array of single-word synonyms.
// Structure: an optional encoding line, then repeating blocks of
//   <headword>|<senseCount>
//   <sense line> × senseCount
// A sense line is '|'-separated. Field 0 is a POS/relation marker: German uses
// '-' or '(Adjektiv)'; pt_BR glues the first synonym onto the tag, e.g.
// '(Sinônimo)anexar'. Stripping a leading '(...)' from every field unifies both.
// We keep senses SEPARATE (not merged) so the caller can prefer one meaning and
// avoid mixing distant acceptions (e.g. "abandonar" → "matar" from another sense).
function parseMyThes(text) {
  const lines = text.split(/\r?\n/);
  const map = new Map();
  let i = 0;
  if (/^(utf-?8|iso[-]?8859)/i.test(lines[0] ?? '')) i = 1; // encoding declaration

  while (i < lines.length) {
    const line = lines[i++];
    if (!line) continue;
    const head = line.split('|');
    // Head word line: exactly "<word>|<integer>".
    if (head.length !== 2 || !/^\d+$/.test(head[1])) continue;
    const word = head[0].trim();
    const senses = parseInt(head[1], 10);
    const key = word.toLowerCase();
    const groups = map.get(key) ?? [];

    for (let s = 0; s < senses && i < lines.length; s++) {
      const sense = lines[i++];
      if (!sense) continue;
      const seen = new Set();
      const group = [];
      for (const field of sense.split('|')) {
        let w = field.replace(/^\([^)]*\)/, '');   // drop a leading (tag)
        w = w.replace(/\s*\([^)]*\)/g, '').trim();  // drop usage-note parentheticals
        if (!w || w === '-') continue;
        if (!/^[\p{L}]+$/u.test(w)) continue;       // single alphabetic word only
        if (w.length < 2) continue;
        const lc = w.toLowerCase();
        if (lc === key || seen.has(lc)) continue;   // not the head word / no dupes
        seen.add(lc);
        group.push(w);
      }
      if (group.length) groups.push(group);
    }
    if (groups.length) map.set(key, groups);
  }
  return map;
}

async function build(lang) {
  const { url, freq } = SOURCES[lang];
  const text = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`fetch failed (${lang}): ${r.status} ${r.statusText}`);
    return r.text();
  });

  const words = freq.split(' ');
  const rank = new Map(words.map((w, idx) => [w, idx]));
  const rankOf = (lc) => (rank.has(lc) ? rank.get(lc) : Infinity);

  const map = parseMyThes(text);

  // Build an undirected synonymy graph, keyed lowercased. neigh[a] holds every
  // word listed under a (across all senses); display[] remembers a surface form
  // (keeps German nouns capitalised). Reciprocity is checked on the lc keys.
  const neigh = new Map();   // lc → Set<lc>
  const display = new Map(); // lc → surface form
  for (const [head, senses] of map) {
    const set = neigh.get(head) ?? new Set();
    for (const group of senses) {
      for (const w of group) {
        const lc = w.toLowerCase();
        set.add(lc);
        if (!display.has(lc)) display.set(lc, w);
      }
    }
    neigh.set(head, set);
    if (!display.has(head)) display.set(head, head);
  }

  // Jaccard overlap of two words' neighbourhoods. True synonyms share many
  // neighbours; loose associations (casa↔família) share few. This second-order
  // signal is far more precise than raw frequency on broad thesauri like TeP.
  const jaccard = (A, B) => {
    if (!A || !B) return 0;
    const [small, big] = A.size <= B.size ? [A, B] : [B, A];
    let inter = 0;
    for (const x of small) if (big.has(x)) inter++;
    return inter / (A.size + B.size - inter);
  };

  // High precision over coverage ("only suggest when it makes sense"): a synonym
  // must be (1) mutual, (2) tightly overlapping in neighbourhood, and (3) itself
  // a common word (in the frequency list). Words that don't clear the bar simply
  // get no suggestions — the tooltip then shows none.
  const J_MIN = Number(process.env.J_MIN ?? 0.2);
  const table = {};
  for (const head of neigh.keys()) {
    if (!rank.has(head)) continue; // keep only common (clickable) head words → compact
    const A = neigh.get(head);
    const chosen = [...A]
      .filter((b) => b !== head && neigh.get(b)?.has(head)) // mutual
      .map((b) => ({ b, j: jaccard(A, neigh.get(b)), r: rankOf(b) }))
      .filter((x) => x.j >= J_MIN && x.r !== Infinity)      // tight AND common
      .sort((x, y) => y.j - x.j || x.r - y.r)               // tightest, then most frequent
      .slice(0, MAX_SYNONYMS)
      .map((x) => display.get(x.b));
    if (chosen.length) table[head] = chosen.join(' ');
  }

  const keys = Object.keys(table).sort((a, b) => a.localeCompare(b, lang));
  const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(table[k])},`).join('\n');
  const src = lang === 'de'
    ? 'OpenThesaurus (via LibreOffice MyThes, BSD-style license)'
    : 'TeP 2.0 (via LibreOffice MyThes, BSD-style license)';
  const out = new URL(`../src/grammar/data/synonyms-${lang}.js`, import.meta.url);
  writeFileSync(
    out,
    `// Auto-generated by scripts/build-synonyms.mjs — ${keys.length} common ${lang.toUpperCase()}\n` +
    `// words → up to ${MAX_SYNONYMS} synonyms. High-precision selection: mutual (reciprocal)\n` +
    `// synonyms only, ranked by neighbourhood overlap (Jaccard) then frequency, and\n` +
    `// intersected with the top OpenSubtitles words to stay compact. Keys are lowercased;\n` +
    `// words without a confident match are omitted (the tooltip then shows none).\n` +
    `// Source: ${src}. Used by src/grammar/synonyms.js (UI-side, both engines).\n` +
    `export default {\n${body}\n};\n`
  );
  console.log(`synonyms-${lang}.js: ${keys.length} entries`);
}

await build('de');
await build('pt');
