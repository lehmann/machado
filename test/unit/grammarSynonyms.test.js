import { test } from 'node:test';
import assert from 'node:assert/strict';

import { suggestSynonyms } from '../../src/grammar/synonyms.js';
import DE from '../../src/grammar/data/synonyms-de.js';
import PT from '../../src/grammar/data/synonyms-pt.js';

// Pick any generated entry so the test doesn't hardcode a specific word that a
// future thesaurus rebuild might drop.
function anyEntry(table) {
  const key = Object.keys(table)[0];
  return { key, syns: table[key].split(' ') };
}

test('suggests at most 2 synonyms for a content word', async () => {
  const { key, syns } = anyEntry(PT);
  const out = await suggestSynonyms({ pos: 'NOUN', text: key, isPunct: false }, 'pt');
  assert.ok(out.length >= 1 && out.length <= 2, `got ${out.length}`);
  assert.deepEqual(out, syns.slice(0, 2));
});

test('uses the lemma over the surface form when present', async () => {
  const { key, syns } = anyEntry(DE);
  // Surface form is some inflection not in the table; lemma is the head word.
  const out = await suggestSynonyms({ pos: 'NOUN', text: 'XÇÇinexistent', lemma: key, isPunct: false }, 'de');
  assert.deepEqual(out, syns.slice(0, 2));
});

test('is case-insensitive on the key (German nouns are capitalised)', async () => {
  const key = Object.keys(DE)[0];
  const out = await suggestSynonyms({ pos: 'NOUN', text: key.toUpperCase(), isPunct: false }, 'de');
  assert.ok(out.length >= 1);
});

test('offers nothing for function words / punctuation', async () => {
  const { key } = anyEntry(PT);
  assert.deepEqual(await suggestSynonyms({ pos: 'DET', text: key, isPunct: false }, 'pt'), []);
  assert.deepEqual(await suggestSynonyms({ pos: 'ADP', text: key, isPunct: false }, 'pt'), []);
  assert.deepEqual(await suggestSynonyms({ pos: 'PUNCT', text: '.', isPunct: true }, 'pt'), []);
});

test('offers nothing for an unknown word', async () => {
  assert.deepEqual(await suggestSynonyms({ pos: 'NOUN', text: 'zzqxwv', isPunct: false }, 'pt'), []);
});

test('never echoes the word itself', async () => {
  for (const [lang, table] of [['de', DE], ['pt', PT]]) {
    for (const key of Object.keys(table).slice(0, 200)) {
      const out = await suggestSynonyms({ pos: 'NOUN', text: key, isPunct: false }, lang);
      assert.ok(!out.some((w) => w.toLowerCase() === key), `${lang}:${key} echoed itself`);
    }
  }
});

test('handles a null/empty token without throwing', async () => {
  assert.deepEqual(await suggestSynonyms(null, 'pt'), []);
  assert.deepEqual(await suggestSynonyms({ pos: 'NOUN', text: '', isPunct: false }, 'pt'), []);
});
