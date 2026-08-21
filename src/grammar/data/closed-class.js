// Deterministic closed-class tables for the LOCAL (heuristic) grammar analyzer.
// Closed classes (articles, pronouns, prepositions, conjunctions) are small and
// finite, so we can encode them by hand. Values use the same UD-style feature
// keys as the server (Gender/Number/Case/Person/Definite) so describe.js phrases
// both engines identically.
//
// These are intentionally APPROXIMATE — many German article forms are ambiguous
// across case/gender (e.g. "die" = Fem.Sing or Plur), so we record only what is
// unambiguous and let the noun-phrase reconciliation in heuristic.js narrow it.

// ── German ──────────────────────────────────────────────────────────
export const DE = {
  // Definite + indefinite article forms. `amb` marks forms whose gender/case is
  // ambiguous on their own; heuristic.js resolves gender from the head noun.
  articles: {
    // definite
    der: { Definite: 'Def' },            // Masc.Nom | Fem.Dat/Gen | Plur.Gen
    die: { Definite: 'Def' },            // Fem.Sing | Plur
    das: { Definite: 'Def', Gender: 'Neut', Number: 'Sing' },
    den: { Definite: 'Def', Case: 'Acc' },
    dem: { Definite: 'Def', Case: 'Dat' },
    des: { Definite: 'Def', Case: 'Gen' },
    // indefinite
    ein: { Definite: 'Ind' },
    eine: { Definite: 'Ind', Gender: 'Fem', Number: 'Sing' },
    einen: { Definite: 'Ind', Case: 'Acc', Gender: 'Masc' },
    einem: { Definite: 'Ind', Case: 'Dat' },
    einer: { Definite: 'Ind', Case: 'Dat', Gender: 'Fem' },
    eines: { Definite: 'Ind', Case: 'Gen' },
    // possessives / negation article behave like determiners
    kein: { Definite: 'Ind' }, keine: { Definite: 'Ind' }, mein: {}, dein: {},
    sein: {}, ihr: {}, unser: {}, euer: {}, dieser: {}, diese: {}, dieses: {},
  },
  pronouns: {
    ich: { Person: '1', Number: 'Sing' },
    du: { Person: '2', Number: 'Sing' },
    er: { Person: '3', Number: 'Sing', Gender: 'Masc' },
    sie: { Person: '3' },                 // sie = she (Sing) or they (Plur)
    es: { Person: '3', Number: 'Sing', Gender: 'Neut' },
    wir: { Person: '1', Number: 'Plur' },
    ihr: { Person: '2', Number: 'Plur' },
    Sie: { Person: '3', Number: 'Plur' }, // formal
    // object / oblique forms
    mich: { Person: '1', Number: 'Sing', Case: 'Acc' },
    dich: { Person: '2', Number: 'Sing', Case: 'Acc' },
    mir: { Person: '1', Number: 'Sing', Case: 'Dat' },
    dir: { Person: '2', Number: 'Sing', Case: 'Dat' },
    uns: { Person: '1', Number: 'Plur' },
    euch: { Person: '2', Number: 'Plur' },
    ihm: { Person: '3', Number: 'Sing', Case: 'Dat' },
    ihn: { Person: '3', Number: 'Sing', Case: 'Acc' },
  },
  // Prepositions and the case they govern. Two-way (Wechsel-) prepositions are
  // ambiguous (Acc/Dat) and left without a Case.
  prepositions: {
    mit: { Case: 'Dat' }, zu: { Case: 'Dat' }, von: { Case: 'Dat' }, aus: { Case: 'Dat' },
    bei: { Case: 'Dat' }, nach: { Case: 'Dat' }, seit: { Case: 'Dat' }, außer: { Case: 'Dat' },
    gegenüber: { Case: 'Dat' },
    für: { Case: 'Acc' }, ohne: { Case: 'Acc' }, gegen: { Case: 'Acc' }, um: { Case: 'Acc' },
    durch: { Case: 'Acc' }, bis: { Case: 'Acc' }, entlang: { Case: 'Acc' },
    während: { Case: 'Gen' }, wegen: { Case: 'Gen' }, trotz: { Case: 'Gen' }, statt: { Case: 'Gen' },
    // two-way (no fixed case)
    in: {}, an: {}, auf: {}, über: {}, unter: {}, vor: {}, hinter: {}, neben: {}, zwischen: {},
  },
  coordinators: new Set(['und', 'oder', 'aber', 'denn', 'sondern', 'sowie']),
  subordinators: new Set(['dass', 'weil', 'wenn', 'als', 'ob', 'obwohl', 'während', 'damit',
    'bevor', 'nachdem', 'sobald', 'solange', 'seitdem', 'falls', 'indem', 'sodass']),
};

// ── Portuguese ──────────────────────────────────────────────────────
export const PT = {
  articles: {
    o: { Gender: 'Masc', Number: 'Sing', Definite: 'Def' },
    a: { Gender: 'Fem', Number: 'Sing', Definite: 'Def' },   // also a preposition — resolved by context
    os: { Gender: 'Masc', Number: 'Plur', Definite: 'Def' },
    as: { Gender: 'Fem', Number: 'Plur', Definite: 'Def' },
    um: { Gender: 'Masc', Number: 'Sing', Definite: 'Ind' },
    uma: { Gender: 'Fem', Number: 'Sing', Definite: 'Ind' },
    uns: { Gender: 'Masc', Number: 'Plur', Definite: 'Ind' },
    umas: { Gender: 'Fem', Number: 'Plur', Definite: 'Ind' },
  },
  pronouns: {
    eu: { Person: '1', Number: 'Sing' },
    tu: { Person: '2', Number: 'Sing' },
    você: { Person: '3', Number: 'Sing' },
    ele: { Person: '3', Number: 'Sing', Gender: 'Masc' },
    ela: { Person: '3', Number: 'Sing', Gender: 'Fem' },
    nós: { Person: '1', Number: 'Plur' },
    vós: { Person: '2', Number: 'Plur' },
    vocês: { Person: '3', Number: 'Plur' },
    eles: { Person: '3', Number: 'Plur', Gender: 'Masc' },
    elas: { Person: '3', Number: 'Plur', Gender: 'Fem' },
  },
  prepositions: {
    de: {}, em: {}, para: {}, com: {}, por: {}, sem: {}, sobre: {},
    entre: {}, até: {}, desde: {}, contra: {}, sob: {}, perante: {},
    // "a" is both article and preposition; heuristic prefers article before a noun.
  },
  coordinators: new Set(['e', 'ou', 'mas', 'porém', 'nem', 'todavia', 'contudo']),
  subordinators: new Set(['que', 'porque', 'quando', 'se', 'embora', 'enquanto', 'como',
    'conforme', 'caso', 'pois', 'porquanto', 'conquanto', 'senão']),
};

export const TABLES = { de: DE, pt: PT };
