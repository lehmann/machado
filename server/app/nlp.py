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
