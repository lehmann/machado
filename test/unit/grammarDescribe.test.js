import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeToken, describeRelation } from '../../src/grammar/describe.js';

test('describeToken names the POS and lists morph in PT', () => {
  const d = describeToken({ pos: 'NOUN', morph: { Gender: 'Masc', Number: 'Sing', Case: 'Nom' } });
  assert.equal(d.title, 'Substantivo');
  assert.equal(d.detail, 'masculino, singular, nominativo');
});

test('describeToken handles a finite verb', () => {
  const d = describeToken({ pos: 'VERB', morph: { Person: '3', Number: 'Sing', Tense: 'Pres' } });
  assert.equal(d.title, 'Verbo');
  assert.equal(d.detail, 'singular, 3ª pessoa, presente');
});

test('describeToken falls back gracefully for unknown POS / no morph', () => {
  const d = describeToken({ pos: 'ZZZ', morph: {} });
  assert.equal(d.title, 'Palavra');
  assert.equal(d.detail, '');
});

test('describeRelation (det-noun) is oriented by the focus token', () => {
  const tokens = [{ text: 'der' }, { text: 'Hund' }];
  const rel = { type: 'det-noun', kind: 'agreement', head: 1, deps: [0], features: ['Gender', 'Number', 'Case'] };
  // focus = the noun (head)
  assert.match(describeRelation(rel, tokens, 1), /artigo «der».*gênero, número e caso/);
  // focus = the article (dependent)
  assert.match(describeRelation(rel, tokens, 0), /substantivo «Hund».*gênero, número e caso/);
});

test('describeRelation (subj-verb) mentions the counterpart', () => {
  const tokens = [{ text: 'er' }, { text: 'schläft' }];
  const rel = { type: 'subj-verb', kind: 'agreement', head: 1, deps: [0], features: ['Person', 'Number'] };
  assert.match(describeRelation(rel, tokens, 1), /sujeito «er».*pessoa e número/);
  assert.match(describeRelation(rel, tokens, 0), /verbo «schläft».*sujeito/);
});
