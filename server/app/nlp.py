"""Lazy spaCy pipeline loading. Pipelines provide sentence segmentation and the
dependency parse used for syntactic CEFR features. If a model isn't installed,
get_nlp returns None and callers fall back to regex-based heuristics.
"""
from functools import lru_cache

from .config import SPACY_MODELS


@lru_cache(maxsize=None)
def get_nlp(lang: str):
    model = SPACY_MODELS.get(lang)
    if not model:
        return None
    try:
        import spacy
        # Keep the parser (needed for sents + dep labels); drop what we don't use.
        return spacy.load(model, disable=["ner", "lemmatizer", "attribute_ruler"])
    except Exception:
        return None


@lru_cache(maxsize=None)
def get_nlp_full(lang: str):
    """Full pipeline for the grammar feature: keeps the components that populate
    token.morph and token.lemma_ (morphologizer / attribute_ruler / lemmatizer) in
    addition to the parser. Only NER is dropped. Returns None if the model isn't
    installed, so the /grammar route can report the capability as unavailable.
    """
    model = SPACY_MODELS.get(lang)
    if not model:
        return None
    try:
        import spacy
        return spacy.load(model, disable=["ner"])
    except Exception:
        return None


def grammar_available(lang: str) -> bool:
    return get_nlp_full(lang) is not None
