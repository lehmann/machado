// Local (offline) heuristic grammar analyzer. Produces the SAME structured
// contract the server (spaCy) produces, but from rules + compact lexicons rather
// than a statistical parser. It is intentionally APPROXIMATE — good enough to
// show a word's likely function and the agreement/government links in simple
// sentences (article↔noun gender/case, subject↔verb person/number). The UI marks
// local results as approximate (source:'local').
//
// Output: { lang, source:'local', tokens:[...], relations:[...] } — see describe.js.
import deGender from './data/de-gender.js';
import { TABLES } from './data/closed-class.js';

// Word | number | single other char (punctuation/symbol). Offsets come from the
// match index so they align with the sentence text the UI renders.
const TOKEN_RE = /[\p{L}][\p{L}­'’\-]*|\d+(?:[.,]\d+)?|[^\s]/gu;

const VERB_END = {
  de: /(en|st|te|et|t)$/,
  pt: /(ar|er|ir|ou|am|em|ram|ava|ia|amos|emos|imos)$/,
};

const isLetterNum = (ch) => /[\p{L}\p{N}]/u.test(ch);
const isUpperFirst = (s) => /^[\p{Lu}]/u.test(s);

function tokenize(text) {
  const tokens = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  let i = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const t = m[0];
    tokens.push({
      i: i++,
      start: m.index,
      end: m.index + t.length,
      text: t,
      pos: null,
      lemma: null,
      morph: {},
      isPunct: !isLetterNum(t[0]),
    });
  }
  return tokens;
}

function prune(morph) {
  const out = {};
  for (const k of Object.keys(morph)) if (morph[k] != null) out[k] = morph[k];
  return out;
}

// First pass: closed classes + (German) capitalized nouns.
function classifyClosed(tokens, lang) {
  const T = TABLES[lang];
  for (const tok of tokens) {
    if (tok.isPunct) { tok.pos = 'PUNCT'; continue; }
    const lower = tok.text.toLowerCase();

    if (Object.prototype.hasOwnProperty.call(T.articles, lower)) {
      tok.pos = 'DET';
      tok.morph = { ...T.articles[lower] };
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(T.pronouns, lower)) {
      tok.pos = 'PRON';
      tok.morph = { ...T.pronouns[lower] };
      continue;
    }
    const preps = T.prepositions;
    const isPrep = preps instanceof Set ? preps.has(lower) : Object.prototype.hasOwnProperty.call(preps, lower);
    if (isPrep) {
      tok.pos = 'ADP';
      tok.morph = preps instanceof Set ? {} : { ...preps[lower] };
      continue;
    }
    if (T.coordinators.has(lower)) { tok.pos = 'CCONJ'; continue; }
    if (T.subordinators.has(lower)) { tok.pos = 'SCONJ'; continue; }

    // German nouns are capitalized. Non-sentence-initial capitalized words that
    // aren't closed-class are almost always nouns.
    if (lang === 'de' && isUpperFirst(tok.text)) {
      tok.pos = 'NOUN';
      const g = deGender[tok.text];
      if (g) tok.morph.Gender = g;
    }
    // everything else stays content (pos null) for the structural pass
  }
}

const isContent = (t) => t && t.pos == null && !t.isPunct;
const nextNonPunct = (tokens, from) => {
  for (let j = from; j < tokens.length; j++) if (!tokens[j].isPunct) return tokens[j];
  return null;
};

// Build noun phrases anchored on determiners; returns det-noun / adj-noun relations.
function buildNounPhrases(tokens, lang) {
  const rels = [];
  const featNP = lang === 'de' ? ['Gender', 'Number', 'Case'] : ['Gender', 'Number'];

  for (let idx = 0; idx < tokens.length; idx++) {
    const det = tokens[idx];
    if (det.pos !== 'DET') continue;

    const adjs = [];
    let j = idx + 1;
    let noun = null;

    if (lang === 'de') {
      // pre-nominal adjectives (lowercase content) then the (capitalized) noun
      while (j < tokens.length && isContent(tokens[j]) && !isUpperFirst(tokens[j].text)) {
        adjs.push(tokens[j]); j++;
      }
      if (j < tokens.length && (tokens[j].pos === 'NOUN' || (isContent(tokens[j]) && isUpperFirst(tokens[j].text)))) {
        noun = tokens[j]; noun.pos = 'NOUN';
        const g = deGender[noun.text];
        if (g && !noun.morph.Gender) noun.morph.Gender = g;
      }
    } else {
      // Portuguese: the first content word after the article is the noun
      if (j < tokens.length && isContent(tokens[j])) {
        noun = tokens[j]; noun.pos = 'NOUN';
        // gender/number from the article; plural also hinted by trailing -s
        if (det.morph.Gender && !noun.morph.Gender) noun.morph.Gender = det.morph.Gender;
        const num = det.morph.Number ?? (/s$/i.test(noun.text) ? 'Plur' : 'Sing');
        noun.morph.Number = noun.morph.Number ?? num;
      }
    }

    if (!noun) continue;
    noun.morph.Number = noun.morph.Number ?? 'Sing';

    // reconcile the determiner's ambiguous features with the noun
    if (noun.morph.Gender && !det.morph.Gender) det.morph.Gender = noun.morph.Gender;
    if (noun.morph.Number && !det.morph.Number) det.morph.Number = noun.morph.Number;

    rels.push({ type: 'det-noun', kind: 'agreement', head: noun.i, deps: [det.i], features: featNP });
    for (const a of adjs) {
      a.pos = 'ADJ';
      a.morph = prune({ Gender: noun.morph.Gender, Number: noun.morph.Number, Case: noun.morph.Case });
      rels.push({ type: 'adj-noun', kind: 'agreement', head: noun.i, deps: [a.i], features: featNP });
    }
  }
  return rels;
}

function pickVerb(tokens, lang) {
  const content = tokens.filter(isContent);
  if (content.length === 0) return null;
  const strong = content.filter((t) => VERB_END[lang].test(t.text.toLowerCase()));
  const pool = strong.length ? strong : content;
  return pool[pool.length - 1]; // last remaining content word — the usual verb slot
}

// Trailing/adjacent leftover content words next to a noun become adjectives.
function attachLooseAdjectives(tokens, lang) {
  const rels = [];
  const featNP = lang === 'de' ? ['Gender', 'Number', 'Case'] : ['Gender', 'Number'];
  for (const tok of tokens) {
    if (!isContent(tok)) continue;
    const prev = tokens[tok.i - 1];
    const next = tokens[tok.i + 1];
    const nounNeighbor = [prev, next].find((n) => n && n.pos === 'NOUN');
    if (nounNeighbor) {
      tok.pos = 'ADJ';
      tok.morph = prune({ Gender: nounNeighbor.morph.Gender, Number: nounNeighbor.morph.Number, Case: nounNeighbor.morph.Case });
      rels.push({ type: 'adj-noun', kind: 'agreement', head: nounNeighbor.i, deps: [tok.i], features: featNP });
    } else {
      tok.pos = 'X';
    }
  }
  return rels;
}

function subjectFor(tokens, verb) {
  // Prefer a subject-like pronoun before the verb (no oblique case), else the
  // nearest preceding noun.
  let subj = null;
  for (const t of tokens) {
    if (t.i >= verb.i) break;
    if (t.pos === 'PRON' && t.morph.Case !== 'Acc' && t.morph.Case !== 'Dat') subj = t;
    else if (t.pos === 'NOUN') subj = t;
  }
  return subj;
}

/**
 * Analyze a single sentence heuristically.
 * @param {string} text
 * @param {'de'|'pt'} lang
 * @returns {{lang, source:'local', tokens:Array, relations:Array}}
 */
export function analyzeLocal(text, lang) {
  const L = lang === 'de' ? 'de' : 'pt';
  const tokens = tokenize(text ?? '');
  const relations = [];

  classifyClosed(tokens, L);
  relations.push(...buildNounPhrases(tokens, L));

  const verb = pickVerb(tokens, L);
  if (verb) verb.pos = 'VERB';

  relations.push(...attachLooseAdjectives(tokens, L));

  if (verb) {
    const subj = subjectFor(tokens, verb);
    const person = subj ? (subj.morph.Person ?? '3') : '3';
    const number = subj ? (subj.morph.Number ?? 'Sing') : 'Sing';
    verb.morph = prune({ ...verb.morph, Person: person, Number: number, VerbForm: 'Fin' });
    if (subj) {
      relations.push({ type: 'subj-verb', kind: 'agreement', head: verb.i, deps: [subj.i], features: ['Person', 'Number'] });
    }
  }

  // German preposition → governed noun (case government)
  if (L === 'de') {
    for (const tok of tokens) {
      if (tok.pos !== 'ADP' || !tok.morph.Case) continue;
      const noun = (() => {
        for (let j = tok.i + 1; j < tokens.length; j++) {
          if (tokens[j].pos === 'NOUN') return tokens[j];
          if (tokens[j].pos === 'VERB' || tokens[j].isPunct) return null;
        }
        return null;
      })();
      if (noun) {
        if (!noun.morph.Case) noun.morph.Case = tok.morph.Case;
        relations.push({ type: 'prep-obj', kind: 'government', head: tok.i, deps: [noun.i], features: ['Case'] });
      }
    }
  }

  // Any remaining unclassified content → generic
  for (const tok of tokens) if (tok.pos == null) tok.pos = tok.isPunct ? 'PUNCT' : 'X';

  for (const tok of tokens) tok.morph = prune(tok.morph);

  return { lang: L, source: 'local', tokens, relations };
}
