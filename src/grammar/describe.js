// Shared PT-BR phrasing for grammatical analysis. This is the SINGLE SOURCE of
// natural-language text for the grammar feature: both the local (heuristic) and
// server (spaCy) providers emit only STRUCTURED data (pos + morph + relations),
// and this module turns that structure into the strings the tooltip shows. That
// keeps the two engines phrased identically and keeps the server lean.
//
// The token/relation shapes are the shared contract:
//   token:    { i, start, end, text, pos, lemma, morph:{...}, isPunct }
//   relation: { type, kind:'agreement'|'government'|'dependency', head, deps:[...], features:[...] }

// UPOS tag → Portuguese part-of-speech name.
const POS_PT = {
  NOUN: 'Substantivo',
  PROPN: 'Nome próprio',
  VERB: 'Verbo',
  AUX: 'Verbo auxiliar',
  ADJ: 'Adjetivo',
  ADV: 'Advérbio',
  ADP: 'Preposição',
  DET: 'Artigo / determinante',
  PRON: 'Pronome',
  CCONJ: 'Conjunção coordenativa',
  SCONJ: 'Conjunção subordinativa',
  NUM: 'Numeral',
  PART: 'Partícula',
  INTJ: 'Interjeição',
  PUNCT: 'Pontuação',
  SYM: 'Símbolo',
  X: 'Palavra',
};

// UD morphological feature values → Portuguese.
const MORPH_PT = {
  Gender: { Masc: 'masculino', Fem: 'feminino', Neut: 'neutro' },
  Number: { Sing: 'singular', Plur: 'plural' },
  Case: { Nom: 'nominativo', Acc: 'acusativo', Dat: 'dativo', Gen: 'genitivo' },
  Person: { 1: '1ª pessoa', 2: '2ª pessoa', 3: '3ª pessoa', '1': '1ª pessoa', '2': '2ª pessoa', '3': '3ª pessoa' },
  Tense: { Pres: 'presente', Past: 'pretérito', Fut: 'futuro', Imp: 'pretérito imperfeito' },
  Mood: { Ind: 'indicativo', Sub: 'subjuntivo', Imp: 'imperativo', Cnd: 'condicional' },
  VerbForm: { Fin: 'forma finita', Inf: 'infinitivo', Part: 'particípio', Ger: 'gerúndio' },
  Degree: { Pos: 'grau normal', Cmp: 'comparativo', Sup: 'superlativo' },
  Definite: { Def: 'definido', Ind: 'indefinido' },
};

// Feature key → Portuguese noun (for "concorda em gênero, número e caso").
const FEATURE_PT = {
  Gender: 'gênero',
  Number: 'número',
  Case: 'caso',
  Person: 'pessoa',
  Tense: 'tempo',
  Mood: 'modo',
};

// Order in which morph features read most naturally in Portuguese.
const MORPH_ORDER = ['Gender', 'Number', 'Case', 'Person', 'Tense', 'Mood', 'VerbForm', 'Degree', 'Definite'];

function posName(pos) {
  return POS_PT[pos] ?? 'Palavra';
}

// Join a list of Portuguese words as "a, b e c".
function joinPt(items) {
  const xs = items.filter(Boolean);
  if (xs.length === 0) return '';
  if (xs.length === 1) return xs[0];
  return `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
}

// Human list of morph values for a token, e.g. "masculino, singular, nominativo".
function morphDetailPt(morph) {
  if (!morph) return '';
  const parts = [];
  for (const key of MORPH_ORDER) {
    const raw = morph[key];
    if (raw == null) continue;
    const label = MORPH_PT[key]?.[raw];
    if (label) parts.push(label);
  }
  return parts.join(', ');
}

// Turn a feature-key list into "gênero, número e caso".
function featuresPt(features) {
  return joinPt((features ?? []).map((f) => FEATURE_PT[f]).filter(Boolean));
}

/**
 * Describe a single token for the tooltip header/body.
 * @returns {{ title: string, detail: string }}
 */
export function describeToken(token) {
  return {
    title: posName(token?.pos),
    detail: morphDetailPt(token?.morph),
  };
}

const quote = (s) => `«${s}»`;

/**
 * Describe one relation from the perspective of the clicked (focus) token.
 * Returns a Portuguese sentence, or '' if nothing sensible can be said.
 */
export function describeRelation(rel, tokens, focusIdx) {
  const head = tokens[rel.head];
  const deps = (rel.deps ?? []).map((j) => tokens[j]).filter(Boolean);
  if (!head || deps.length === 0) return '';

  const feats = featuresPt(rel.features);
  const depsText = joinPt(deps.map((t) => quote(t.text)));
  const focusIsHead = focusIdx === rel.head;

  switch (rel.type) {
    case 'det-noun':
      return focusIsHead
        ? `O artigo ${depsText} concorda com este substantivo${feats ? ` em ${feats}` : ''}.`
        : `Concorda com o substantivo ${quote(head.text)}${feats ? ` em ${feats}` : ''}.`;
    case 'adj-noun':
      return focusIsHead
        ? `O adjetivo ${depsText} é declinado conforme este substantivo${feats ? ` (${feats})` : ''}.`
        : `Declinado conforme o substantivo ${quote(head.text)}${feats ? ` (${feats})` : ''}.`;
    case 'subj-verb':
      return focusIsHead
        ? `Conjugado para concordar com o sujeito ${depsText}${feats ? ` em ${feats}` : ''}.`
        : `O verbo ${quote(head.text)} concorda com este sujeito${feats ? ` em ${feats}` : ''}.`;
    case 'prep-obj':
      return focusIsHead
        ? `Rege ${depsText}${feats ? ` no ${morphDetailPt({ Case: head.morph?.Case }) || feats}` : ''}.`
        : `Regido pela preposição ${quote(head.text)}${feats ? ` (${feats})` : ''}.`;
    case 'aux-verb':
      return focusIsHead
        ? `Forma verbal composta com ${depsText}.`
        : `Auxiliar do verbo ${quote(head.text)}.`;
    default:
      return focusIsHead
        ? `Relaciona-se com ${depsText}.`
        : `Relaciona-se com ${quote(head.text)}.`;
  }
}

// Exposed for tests / reuse.
export const _internal = { posName, morphDetailPt, featuresPt, joinPt };
