// Gender of common German nouns (Masc/Fem/Neut). German noun gender is lexical
// (not derivable from form), so the local heuristic analyzer needs a lookup.
// This is a compact hand-curated seed of high-frequency nouns; regenerate/expand
// with `node scripts/build-lexicon.mjs` from an openly-licensed source.
//
// Keys are the noun as normally written (capitalized). Lookups should try the
// exact token first. Coverage is partial by design — unknown nouns simply get no
// gender in the local analysis (the server/spaCy path is exact).
export default {
  // people / family
  Mann: 'Masc', Frau: 'Fem', Kind: 'Neut', Junge: 'Masc', Mädchen: 'Neut',
  Vater: 'Masc', Mutter: 'Fem', Sohn: 'Masc', Tochter: 'Fem', Bruder: 'Masc',
  Schwester: 'Fem', Freund: 'Masc', Freundin: 'Fem', Mensch: 'Masc', Leute: 'Fem',
  Familie: 'Fem', Eltern: 'Fem', Person: 'Fem', Herr: 'Masc', Dame: 'Fem',
  Lehrer: 'Masc', Lehrerin: 'Fem', Schüler: 'Masc', Student: 'Masc', Arzt: 'Masc',
  Ärztin: 'Fem', Chef: 'Masc', Nachbar: 'Masc', Gast: 'Masc', Baby: 'Neut',
  // animals
  Hund: 'Masc', Katze: 'Fem', Pferd: 'Neut', Vogel: 'Masc', Fisch: 'Masc',
  Maus: 'Fem', Kuh: 'Fem', Schwein: 'Neut', Tier: 'Neut', Löwe: 'Masc',
  Bär: 'Masc', Wolf: 'Masc', Affe: 'Masc', Huhn: 'Neut', Ente: 'Fem',
  // home / objects
  Haus: 'Neut', Wohnung: 'Fem', Zimmer: 'Neut', Tür: 'Fem', Fenster: 'Neut',
  Tisch: 'Masc', Stuhl: 'Masc', Bett: 'Neut', Schrank: 'Masc', Lampe: 'Fem',
  Uhr: 'Fem', Buch: 'Neut', Zeitung: 'Fem', Brief: 'Masc', Papier: 'Neut',
  Stift: 'Masc', Tasche: 'Fem', Schlüssel: 'Masc', Geld: 'Neut', Karte: 'Fem',
  Telefon: 'Neut', Computer: 'Masc', Fernseher: 'Masc', Bild: 'Neut', Spiegel: 'Masc',
  Flasche: 'Fem', Glas: 'Neut', Teller: 'Masc', Messer: 'Neut', Gabel: 'Fem',
  Löffel: 'Masc', // spelled without umlaut in some sources
  // food
  Brot: 'Neut', Butter: 'Fem', Käse: 'Masc', Milch: 'Fem', Wasser: 'Neut',
  Wein: 'Masc', Bier: 'Neut', Kaffee: 'Masc', Tee: 'Masc', Apfel: 'Masc',
  Ei: 'Neut', Fleisch: 'Neut', Suppe: 'Fem', Salz: 'Neut', Zucker: 'Masc',
  Obst: 'Neut', Gemüse: 'Neut', Essen: 'Neut', Frühstück: 'Neut', Kuchen: 'Masc',
  // places / travel
  Stadt: 'Fem', Dorf: 'Neut', Land: 'Neut', Straße: 'Fem', Weg: 'Masc',
  Platz: 'Masc', Bahnhof: 'Masc', Flughafen: 'Masc', Schule: 'Fem', Universität: 'Fem',
  Kirche: 'Fem', Krankenhaus: 'Neut', Geschäft: 'Neut', Laden: 'Masc', Markt: 'Masc',
  Restaurant: 'Neut', Hotel: 'Neut', Bank: 'Fem', Park: 'Masc', Garten: 'Masc',
  Auto: 'Neut', Zug: 'Masc', Bus: 'Masc', Fahrrad: 'Neut', Schiff: 'Neut',
  Flugzeug: 'Neut', Reise: 'Fem', Welt: 'Fem', Meer: 'Neut', Berg: 'Masc',
  Fluss: 'Masc', Baum: 'Masc', Blume: 'Fem', Wald: 'Masc', Himmel: 'Masc',
  // time / abstract
  Zeit: 'Fem', Tag: 'Masc', Nacht: 'Fem', Woche: 'Fem', Monat: 'Masc',
  Jahr: 'Neut', Stunde: 'Fem', Minute: 'Fem', Morgen: 'Masc', Abend: 'Masc',
  Leben: 'Neut', Arbeit: 'Fem', Beruf: 'Masc', Wort: 'Neut', Sprache: 'Fem',
  Name: 'Masc', Frage: 'Fem', Antwort: 'Fem', Problem: 'Neut', Idee: 'Fem',
  Geschichte: 'Fem', Musik: 'Fem', Liebe: 'Fem', Angst: 'Fem', Freude: 'Fem',
  Hoffnung: 'Fem', Gedanke: 'Masc', Grund: 'Masc', Sache: 'Fem', Ding: 'Neut',
  Weise: 'Fem', Teil: 'Masc', Ende: 'Neut', Anfang: 'Masc', Beispiel: 'Neut',
  // body / nature
  Kopf: 'Masc', Hand: 'Fem', Auge: 'Neut', Ohr: 'Neut', Nase: 'Fem',
  Mund: 'Masc', Herz: 'Neut', Fuß: 'Masc', Arm: 'Masc', Bein: 'Neut',
  Sonne: 'Fem', Mond: 'Masc', Stern: 'Masc', Regen: 'Masc', Schnee: 'Masc',
  Wind: 'Masc', Feuer: 'Neut', Luft: 'Fem', Erde: 'Fem', Wetter: 'Neut',
};
