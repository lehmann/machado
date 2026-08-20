"""Server-side heuristic CEFR (A1–C2) estimator for a single sentence.

Same three axes and weights as the browser's src/cefr.js — vocabulary rarity
(frequency lists), sentence length, syntactic complexity — but the syntax axis
uses a real dependency parse (subordinate-clause count) instead of counting
commas, and it's symmetric across PT and DE. Output shape matches the frontend
exactly: {level, index, factors, metrics:{words, vocab}}, with `factors` as the
same Portuguese strings, so the tooltip reads identically regardless of engine.
"""
import math
import re

from .freq import rank_map, band_from_rank
from .nlp import get_nlp

LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

# Unicode letters, allowing internal apostrophe/hyphen. re matches accented
# letters via [^\W\d_].
_TOKEN_RE = re.compile(r"[^\W\d_][^\W\d_'\-]*", re.UNICODE)

# Dependency labels that head a subordinate/embedded clause (UD-style, as used
# by the pt/de core_news models).
_SUBORD_DEPS = {
    "advcl", "acl", "relcl", "acl:relcl", "ccomp", "xcomp", "csubj", "csubjpass",
}

# Fallback single-word subordinators (only used when no spaCy model is present).
_SUBORDINATORS = {
    "de": {"dass", "weil", "wenn", "als", "ob", "obwohl", "während", "damit",
           "bevor", "nachdem", "sobald", "solange", "seitdem", "falls", "indem",
           "sodass", "obgleich", "sofern", "wohingegen"},
    "pt": {"que", "porque", "quando", "se", "embora", "enquanto", "como",
           "conforme", "caso", "pois", "contudo", "todavia", "porquanto",
           "conquanto", "porém", "senão", "consoante"},
}


def _round_half_up(x: float) -> int:
    return math.floor(x + 0.5)


def _features(text: str, lang: str):
    """Return (words, subordinate_clause_count). Uses spaCy when available."""
    nlp = get_nlp(lang)
    if nlp is not None:
        doc = nlp(text)
        words = [t.text.lower() for t in doc if t.is_alpha]
        subs = sum(1 for t in doc if t.dep_ in _SUBORD_DEPS)
        return words, subs
    # Fallback: regex tokens + subordinator/comma heuristic (like the frontend).
    words = _TOKEN_RE.findall(text.lower())
    subordinators = _SUBORDINATORS.get(lang, set())
    subs = sum(1 for w in words if w in subordinators) + text.count(",")
    return words, subs


def assess_sentence(text: str, lang: str):
    words, subs = _features(text, lang)
    n = len(words)
    if n == 0:
        return None

    ranks = rank_map(lang)
    bands = [band_from_rank(ranks.get(w)) for w in words]

    # Vocabulary: mean difficulty of the hardest quartile (min 1 word), so one
    # rare word doesn't slam the whole sentence to C2.
    hard_count = max(1, math.ceil(n * 0.25))
    vocab = sum(sorted(bands, reverse=True)[:hard_count]) / hard_count

    # Length axis (word count).
    length = (1 if n <= 6 else 2 if n <= 10 else 3 if n <= 15
              else 4 if n <= 22 else 5 if n <= 30 else 6)

    # Syntax axis from subordinate-clause count.
    syntax = (1 if subs == 0 else 3 if subs == 1 else 4 if subs == 2
              else 5 if subs == 3 else 6)

    composite = 0.55 * vocab + 0.30 * length + 0.15 * syntax
    index = min(5, max(0, _round_half_up(composite) - 1))
    level = LEVELS[index]

    # Hardest words (band >= 4) for the tooltip — most difficult first, deduped.
    hard_words = []
    seen = set()
    for w, b in sorted(zip(words, bands), key=lambda x: x[1], reverse=True):
        if b >= 4 and w not in seen:
            seen.add(w)
            hard_words.append(w)
        if len(hard_words) == 4:
            break

    factors = []
    if vocab >= 4:
        factors.append(
            f"Vocabulário avançado: {', '.join(hard_words)}"
            if hard_words else "Vocabulário pouco frequente"
        )
    elif vocab >= 3:
        factors.append("Vocabulário intermediário")
    else:
        factors.append("Vocabulário comum")
    if length >= 4:
        factors.append(f"Sentença longa ({n} palavras)")
    if subs >= 1:
        factors.append(f"{subs} oração(ões) subordinada(s)")

    return {
        "level": level,
        "index": index,
        "factors": factors,
        "metrics": {"words": n, "vocab": round(vocab, 1)},
    }
