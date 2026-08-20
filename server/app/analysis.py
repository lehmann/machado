"""Segmentation + parts assembly, mirroring the browser worker so both engines
emit an identical `parts[]` contract:

  {type: "gap", text}                     — verbatim whitespace between sentences
  {type: "sentence", text, cefr}          — a sentence carrying its CEFR

/translate segments the source, translates each sentence directly (NLLB), scores
CEFR on the TARGET; /analyze segments and scores CEFR in place (no translation).
"""
import re

from .cefr import assess_sentence
from .nlp import get_nlp
from .translation import translator

# Fallback sentence splitter (used only when a spaCy model is unavailable):
# break after sentence-final punctuation, keeping the delimiter.
_SENT_FALLBACK_RE = re.compile(r"[^.!?…]*[.!?…]+[\"'”’)\]]*\s*|[^.!?…]+$")
_SPLIT_PIECE_RE = re.compile(r"^(\s*)([\s\S]*?)(\s*)$")

# Bracket wrappers NLLB may otherwise under-translate; peeled before MT.
_WRAP_PAIRS = {"(": ")", "[": "]", "{": "}", "«": "»", "“": "”"}
_TRAIL_PUNCT_RE = re.compile(r"[.!?…,;:]*\s*$")


def _split_piece(piece: str) -> dict:
    m = _SPLIT_PIECE_RE.match(piece)
    lead, core, trail = m.group(1), m.group(2), m.group(3)
    return {"lead": lead, "core": core, "trail": trail}


def segment(text: str, lang: str):
    """Split into segments of {lead, core, trail}, preserving all whitespace."""
    nlp = get_nlp(lang)
    if nlp is not None:
        doc = nlp(text)
        sents = list(doc.sents)
        if sents:
            pieces = []
            first = sents[0].start_char
            if first > 0:
                pieces.append(text[:first])  # leading whitespace → pure gap
            for i, s in enumerate(sents):
                end = sents[i + 1].start_char if i + 1 < len(sents) else len(text)
                pieces.append(text[s.start_char:end])
            return [_split_piece(p) for p in pieces]
    # Fallback path.
    pieces = _SENT_FALLBACK_RE.findall(text) or [text]
    return [_split_piece(p) for p in pieces]


def peel_wrap(core: str) -> dict:
    """Peel a whole-sentence bracket wrapper so its inner text translates as a
    normal sentence; `close` carries any punctuation trailing the bracket.
    """
    if not core:
        return {"open": "", "inner": core, "close": ""}
    open_ = core[0]
    close = _WRAP_PAIRS.get(open_)
    if not close:
        return {"open": "", "inner": core, "close": ""}
    trail = _TRAIL_PUNCT_RE.search(core).group(0)
    body = core[: len(core) - len(trail)] if trail else core
    if len(body) > 2 and body[-1] == close:
        inner = body[1:-1]
        if close not in inner:  # bail on nested/multiple pairs
            return {"open": open_, "inner": inner, "close": close + trail}
    return {"open": "", "inner": core, "close": ""}


def _build_parts(segments, finals, cefr_lang):
    parts = []
    ci = 0
    for seg in segments:
        if seg["core"]:
            translation = finals[ci]
            ci += 1
            if seg["lead"]:
                parts.append({"type": "gap", "text": seg["lead"]})
            parts.append({
                "type": "sentence",
                "text": translation,
                "cefr": assess_sentence(translation, cefr_lang),
            })
            if seg["trail"]:
                parts.append({"type": "gap", "text": seg["trail"]})
        elif seg["lead"]:
            parts.append({"type": "gap", "text": seg["lead"]})
    return parts


def translate_and_build(text: str, source: str, target: str) -> dict:
    segments = segment(text, source)
    cores = [s["core"] for s in segments if s["core"]]
    wraps = [peel_wrap(c) for c in cores]
    inners = [w["inner"] for w in wraps]

    if source == target:
        translated = inners  # no MT needed; still segment + score CEFR
    else:
        translated = translator.translate_batch(inners, source, target)

    finals = [wraps[i]["open"] + translated[i] + wraps[i]["close"]
              for i in range(len(translated))]
    parts = _build_parts(segments, finals, target)
    return {
        "text": "".join(p["text"] for p in parts),
        "parts": parts,
        "engine": "server",
        "model": translator.model_name,
    }


def analyze_and_build(text: str, lang: str) -> dict:
    segments = segment(text, lang)
    finals = [s["core"] for s in segments if s["core"]]
    parts = _build_parts(segments, finals, lang)
    return {"parts": parts}
