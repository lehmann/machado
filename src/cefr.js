// Heuristic CEFR (A1–C2) estimator for a single sentence.
// Combines three axes: vocabulary rarity (from word-frequency lists — the most
// predictive), sentence length, and syntactic complexity (clause markers).
// This is an approximation, as all sentence-level CEFR scoring inherently is.
import freqDe from './data/freq-de.js';
import freqPt from './data/freq-pt.js';

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const RAW = { de: freqDe, pt: freqPt };
const RANK_MAPS = {}; // lang -> Map(word -> rank index)

function rankMap(lang) {
  if (!RANK_MAPS[lang]) {
    const words = (RAW[lang] ?? '').split(' ');
    const m = new Map();
    for (let i = 0; i < words.length; i++) m.set(words[i], i);
    RANK_MAPS[lang] = m;
  }
  return RANK_MAPS[lang];
}

// Single-word subordinating conjunctions — a rough clause-complexity signal.
const SUBORDINATORS = {
  de: new Set(['dass', 'weil', 'wenn', 'als', 'ob', 'obwohl', 'während', 'damit',
    'bevor', 'nachdem', 'sobald', 'solange', 'seitdem', 'falls', 'indem',
    'sodass', 'obgleich', 'sofern', 'wohingegen']),
  pt: new Set(['que', 'porque', 'quando', 'se', 'embora', 'enquanto', 'como',
    'conforme', 'caso', 'pois', 'contudo', 'todavia', 'porquanto', 'conquanto',
    'porém', 'senão', 'consoante']),
};

// Map a frequency rank to a difficulty band 1 (A1) … 6 (C2).
function bandFromRank(rank) {
  if (rank == null) return 6;      // outside the top list → rare
  if (rank < 500) return 1;
  if (rank < 1000) return 2;
  if (rank < 2000) return 3;
  if (rank < 3500) return 4;
  if (rank < 6000) return 5;
  return 6;
}

function tokenize(text) {
  return text.toLowerCase().match(/[\p{L}][\p{L}''-]*/gu) ?? [];
}

/**
 * @returns {{level, index, factors, metrics} | null}
 */
export function assessSentence(text, lang) {
  const words = tokenize(text);
  const n = words.length;
  if (n === 0) return null;

  const map = rankMap(lang);
  const bands = words.map(w => bandFromRank(map.get(w)));

  // Vocabulary: average difficulty of the hardest quartile (min 1 word),
  // so a single rare word doesn't slam the whole sentence to C2.
  const sortedDesc = [...bands].sort((a, b) => b - a);
  const hardCount = Math.max(1, Math.ceil(n * 0.25));
  const vocab = sortedDesc.slice(0, hardCount).reduce((s, b) => s + b, 0) / hardCount;

  // Length axis (word count).
  const length = n <= 6 ? 1 : n <= 10 ? 2 : n <= 15 ? 3 : n <= 22 ? 4 : n <= 30 ? 5 : 6;

  // Syntax axis: subordinating conjunctions + commas (clause boundaries).
  const subs = words.filter(w => SUBORDINATORS[lang]?.has(w)).length;
  const commas = (text.match(/,/g) ?? []).length;
  const markers = subs + commas;
  const syntax = markers === 0 ? 1 : markers === 1 ? 3 : markers === 2 ? 4 : markers === 3 ? 5 : 6;

  const composite = 0.55 * vocab + 0.30 * length + 0.15 * syntax;
  const index = Math.min(5, Math.max(0, Math.round(composite) - 1));
  const level = LEVELS[index];

  // Hardest words (B2+) for the tooltip — most difficult first, deduped.
  const hardWords = [...new Set(
    words
      .map((w, i) => ({ w, b: bands[i] }))
      .filter(x => x.b >= 4)
      .sort((a, b) => b.b - a.b)
      .map(x => x.w)
  )].slice(0, 4);

  const factors = [];
  if (vocab >= 4) {
    factors.push(hardWords.length
      ? `Vocabulário avançado: ${hardWords.join(', ')}`
      : 'Vocabulário pouco frequente');
  } else if (vocab >= 3) {
    factors.push('Vocabulário intermediário');
  } else {
    factors.push('Vocabulário comum');
  }
  if (length >= 4) factors.push(`Sentença longa (${n} palavras)`);
  if (subs >= 1) factors.push(`${subs} oração(ões) subordinada(s)`);

  return {
    level,
    index,
    factors,
    metrics: { words: n, vocab: +vocab.toFixed(1) },
  };
}
