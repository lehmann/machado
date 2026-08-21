"""Server-side grammar analysis (high precision) using the full spaCy pipeline.

Produces the SAME structured contract the browser's heuristic analyzer emits, so
the UI phrases both identically (see src/grammar/describe.js):

  token:    {i, start, end, text, pos, lemma, morph:{...}, isPunct}
  relation: {type, kind, head, deps:[...], features:[...]}

Dependency-label handling is defensive: Portuguese spaCy models use Universal
Dependencies labels (det, amod, nsubj, case) while German models use the TIGER
scheme (nk, sb, ...). We accept BOTH so the code works regardless of which label
set the installed model produces.
"""
from typing import Any, Dict, List

from .nlp import get_nlp_full

# Agreement features surfaced per relation/language (mirrors the local analyzer).
_NP_FEATURES = {"de": ["Gender", "Number", "Case"], "pt": ["Gender", "Number"]}
_SV_FEATURES = ["Person", "Number"]
_PREP_FEATURES = ["Case"]

_NOUNISH = {"NOUN", "PROPN", "PRON"}
_DET_DEPS = {"det", "nk"}                       # UD det / TIGER nk
_ADJ_DEPS = {"amod", "nk"}
_SUBJ_DEPS = {"nsubj", "nsubj:pass", "csubj", "sb"}
_AUX_DEPS = {"aux", "aux:pass", "cop", "oc"}


def _token_dict(token) -> Dict[str, Any]:
    return {
        "i": token.i,
        "start": token.idx,
        "end": token.idx + len(token.text),
        "text": token.text,
        "pos": token.pos_,
        "lemma": token.lemma_ or None,
        "morph": token.morph.to_dict(),
        "isPunct": bool(token.is_punct),
    }


def _features(names: List[str], head) -> List[str]:
    """Keep only the agreement features the head token actually carries; fall back
    to the full list when morph is empty (small models sometimes omit it)."""
    have = head.morph.to_dict()
    present = [n for n in names if n in have]
    return present or list(names)


def _build_relations(doc, lang: str) -> List[Dict[str, Any]]:
    np_feats = _NP_FEATURES.get(lang, ["Gender", "Number"])
    rels: List[Dict[str, Any]] = []
    seen = set()

    def add(rtype: str, kind: str, head: int, dep: int, features: List[str]) -> None:
        key = (rtype, head, dep)
        if head == dep or key in seen:
            return
        seen.add(key)
        rels.append({"type": rtype, "kind": kind, "head": head, "deps": [dep], "features": features})

    for tok in doc:
        head = tok.head
        dep = tok.dep_

        # determiner → noun (gender/number/case agreement)
        if tok.pos_ == "DET" and dep in _DET_DEPS and head.pos_ in _NOUNISH:
            add("det-noun", "agreement", head.i, tok.i, _features(np_feats, head))
        # adjective → noun
        elif tok.pos_ == "ADJ" and dep in _ADJ_DEPS and head.pos_ in {"NOUN", "PROPN"}:
            add("adj-noun", "agreement", head.i, tok.i, _features(np_feats, head))
        # subject → verb (person/number agreement)
        elif dep in _SUBJ_DEPS:
            add("subj-verb", "agreement", head.i, tok.i, _features(_SV_FEATURES, head))
        # auxiliary / copula → main verb
        elif dep in _AUX_DEPS:
            add("aux-verb", "dependency", head.i, tok.i, [])

        # preposition → governed noun (case government)
        if tok.pos_ == "ADP":
            # UD: the ADP attaches to its object via `case` (object is the head).
            if dep == "case" and head.pos_ in _NOUNISH:
                add("prep-obj", "government", tok.i, head.i, _features(_PREP_FEATURES, head))
            # TIGER/other: the object is a child of the preposition.
            for child in tok.children:
                if child.pos_ in _NOUNISH:
                    add("prep-obj", "government", tok.i, child.i, _features(_PREP_FEATURES, child))

    return rels


def analyze(text: str, lang: str) -> Dict[str, Any]:
    nlp = get_nlp_full(lang)
    if nlp is None:
        return {"lang": lang, "source": "server", "tokens": [], "relations": []}
    doc = nlp(text)
    return {
        "lang": lang,
        "source": "server",
        "tokens": [_token_dict(t) for t in doc],
        "relations": _build_relations(doc, lang),
    }
