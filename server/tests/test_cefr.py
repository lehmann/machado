"""Unit tests for the heuristic CEFR estimator.

spaCy is optional here; when absent, assess_sentence uses its regex/comma
fallback. These tests assert the contract shape and monotonic behavior that
hold regardless of the syntax backend.
"""
import pytest

from app.cefr import LEVELS, assess_sentence


def test_empty_returns_none():
    assert assess_sentence("", "pt") is None
    assert assess_sentence("   ...  ", "pt") is None  # no alphabetic tokens


def test_shape_matches_frontend_contract():
    r = assess_sentence("O gato dorme na cama.", "pt")
    assert set(r.keys()) == {"level", "index", "factors", "metrics"}
    assert r["level"] in LEVELS
    assert 0 <= r["index"] <= 5
    assert LEVELS[r["index"]] == r["level"]
    assert isinstance(r["factors"], list) and r["factors"]
    assert set(r["metrics"].keys()) == {"words", "vocab"}
    assert r["metrics"]["words"] > 0


def test_simple_sentence_is_low_level():
    r = assess_sentence("Eu gosto de café.", "pt")
    assert r["index"] <= 2  # A1..B1


def test_complex_sentence_is_higher_than_simple():
    simple = assess_sentence("O cão é grande.", "pt")
    complex_ = assess_sentence(
        "Embora estivesse exausto, o pesquisador prosseguiu meticulosamente "
        "porque necessitava concluir a dissertação interdisciplinar.",
        "pt",
    )
    assert complex_["index"] > simple["index"]


def test_word_count_metric():
    r = assess_sentence("um dois três quatro cinco", "pt")
    assert r["metrics"]["words"] == 5


def test_factors_are_portuguese_strings_both_languages():
    for text, lang in [("O gato dorme.", "pt"), ("Der Hund schläft.", "de")]:
        r = assess_sentence(text, lang)
        # The first factor is always a vocabulary label in Portuguese.
        assert r["factors"][0].startswith("Vocabulário")


def test_long_sentence_flags_length_factor():
    long_pt = " ".join(["palavra"] * 25) + "."
    r = assess_sentence(long_pt, "pt")
    assert any("Sentença longa" in f for f in r["factors"])
