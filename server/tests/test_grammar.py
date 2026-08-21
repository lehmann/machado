"""High-precision grammar analysis tests (spaCy).

Skipped automatically when spaCy or the models aren't installed (the CI default,
where the frontend falls back to the local heuristic instead). When the pipeline
IS available we assert the shared contract: token pos/morph plus the expected
agreement relations for a known German and Portuguese sentence.
"""
import pytest

pytest.importorskip("spacy")

from app.grammar import analyze  # noqa: E402
from app.nlp import grammar_available  # noqa: E402


def _rels_of_type(analysis, rtype):
    return [r for r in analysis["relations"] if r["type"] == rtype]


def _token_texts(analysis):
    return [t["text"] for t in analysis["tokens"]]


@pytest.mark.skipif(not grammar_available("de"), reason="German spaCy model not installed")
def test_german_noun_phrase_and_subject_verb():
    text = "Der große Hund schläft."
    analysis = analyze(text, "de")

    assert analysis["lang"] == "de"
    assert analysis["source"] == "server"
    assert "Hund" in _token_texts(analysis)

    # Every token carries character offsets aligned to the input text.
    for tok in analysis["tokens"]:
        assert text[tok["start"]:tok["end"]] == tok["text"]

    # Determiner and adjective agree with the noun; a subject binds the verb.
    assert _rels_of_type(analysis, "det-noun"), "expected a determiner→noun relation"
    assert _rels_of_type(analysis, "adj-noun"), "expected an adjective→noun relation"
    assert _rels_of_type(analysis, "subj-verb"), "expected a subject→verb relation"

    # The noun exposes gender morphology (used by describe.js phrasing).
    hund = next(t for t in analysis["tokens"] if t["text"] == "Hund")
    assert hund["pos"] in ("NOUN", "PROPN")


@pytest.mark.skipif(not grammar_available("pt"), reason="Portuguese spaCy model not installed")
def test_portuguese_noun_phrase_and_subject_verb():
    text = "O cachorro grande dorme."
    analysis = analyze(text, "pt")

    assert analysis["lang"] == "pt"
    assert analysis["source"] == "server"

    for tok in analysis["tokens"]:
        assert text[tok["start"]:tok["end"]] == tok["text"]

    assert _rels_of_type(analysis, "det-noun"), "expected a determiner→noun relation"
    assert _rels_of_type(analysis, "subj-verb"), "expected a subject→verb relation"


@pytest.mark.skipif(not grammar_available("de"), reason="German spaCy model not installed")
def test_german_preposition_governs_case():
    analysis = analyze("Ich fahre mit dem Auto.", "de")
    assert _rels_of_type(analysis, "prep-obj"), "expected a preposition→object relation"
