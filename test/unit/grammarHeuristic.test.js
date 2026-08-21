import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeLocal } from '../../src/grammar/heuristic.js';

function findRel(rels, type) {
  return rels.filter((r) => r.type === type);
}

test('German: "Der große Hund schläft." — NP agreement + subject-verb', () => {
  const g = analyzeLocal('Der große Hund schläft.', 'de');
  assert.equal(g.lang, 'de');
  assert.equal(g.source, 'local');

  const [der, grosse, hund, schlaeft] = g.tokens;
  assert.equal(der.pos, 'DET');
  assert.equal(grosse.pos, 'ADJ');
  assert.equal(hund.pos, 'NOUN');
  assert.equal(hund.morph.Gender, 'Masc');   // from the bundled lexicon
  assert.equal(schlaeft.pos, 'VERB');

  // offsets align with the source text
  assert.equal('Der große Hund schläft.'.slice(hund.start, hund.end), 'Hund');

  const det = findRel(g.relations, 'det-noun');
  assert.ok(det.some((r) => r.head === hund.i && r.deps.includes(der.i)));
  const adj = findRel(g.relations, 'adj-noun');
  assert.ok(adj.some((r) => r.head === hund.i && r.deps.includes(grosse.i)));
  const sv = findRel(g.relations, 'subj-verb');
  assert.ok(sv.some((r) => r.head === schlaeft.i && r.deps.includes(hund.i)));
});

test('Portuguese: "O cachorro grande dorme." — article-noun + subject-verb', () => {
  const g = analyzeLocal('O cachorro grande dorme.', 'pt');
  assert.equal(g.lang, 'pt');

  const [o, cachorro, grande, dorme] = g.tokens;
  assert.equal(o.pos, 'DET');
  assert.equal(cachorro.pos, 'NOUN');
  assert.equal(cachorro.morph.Gender, 'Masc'); // inherited from the article
  assert.equal(grande.pos, 'ADJ');
  assert.equal(dorme.pos, 'VERB');

  const det = findRel(g.relations, 'det-noun');
  assert.ok(det.some((r) => r.head === cachorro.i && r.deps.includes(o.i)));
  const sv = findRel(g.relations, 'subj-verb');
  assert.ok(sv.some((r) => r.head === dorme.i && r.deps.includes(cachorro.i)));
});

test('German preposition governs the following noun (case government)', () => {
  const g = analyzeLocal('Ich fahre mit dem Auto.', 'de');
  const mit = g.tokens.find((t) => t.text === 'mit');
  const auto = g.tokens.find((t) => t.text === 'Auto');
  assert.equal(mit.pos, 'ADP');
  const prep = g.relations.filter((r) => r.type === 'prep-obj');
  assert.ok(prep.some((r) => r.head === mit.i && r.deps.includes(auto.i)));
});

test('punctuation is tagged and never crashes on empty input', () => {
  assert.deepEqual(analyzeLocal('', 'de').tokens, []);
  const g = analyzeLocal('Hallo!', 'de');
  assert.equal(g.tokens.at(-1).pos, 'PUNCT');
  assert.equal(g.tokens.at(-1).isPunct, true);
});
