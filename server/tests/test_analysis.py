"""Unit tests for segmentation, bracket peeling, and parts assembly.

These exercise the fallback (regex) segmentation path since spaCy models are
optional. Translation is either skipped (source == target) or monkeypatched, so
no NLLB model is required.
"""
import app.translation as translation_mod
from app.analysis import (
    analyze_and_build, peel_wrap, segment, translate_and_build,
)


# ── peel_wrap ────────────────────────────────────────────────────

def test_peel_wrap_plain_sentence_untouched():
    w = peel_wrap("Isto é uma frase.")
    assert w == {"open": "", "inner": "Isto é uma frase.", "close": ""}


def test_peel_wrap_parenthesized_sentence():
    w = peel_wrap("(Uma observação importante.)")
    assert w["open"] == "("
    assert w["inner"] == "Uma observação importante."
    assert w["close"] == ")"


def test_peel_wrap_trailing_punctuation_outside_bracket():
    w = peel_wrap("(nota).")
    assert w["open"] == "("
    assert w["inner"] == "nota"
    assert w["close"] == ")."


def test_peel_wrap_bails_on_nested_pairs():
    w = peel_wrap("(a) e (b)")
    assert w["open"] == ""  # left intact to avoid mangling


# ── segment ──────────────────────────────────────────────────────

def test_segment_preserves_whitespace_roundtrip():
    text = "Olá mundo. Tudo bem?\n\nMais uma frase."
    segs = segment(text, "pt")
    reconstructed = "".join(s["lead"] + s["core"] + s["trail"] for s in segs)
    assert reconstructed == text


def test_segment_splits_multiple_sentences():
    segs = segment("Primeira. Segunda. Terceira.", "pt")
    cores = [s["core"] for s in segs if s["core"]]
    assert len(cores) == 3


# ── analyze_and_build ────────────────────────────────────────────

def test_analyze_build_shape_and_cefr():
    out = analyze_and_build("O gato dorme. Ele está cansado.", "pt")
    sentences = [p for p in out["parts"] if p["type"] == "sentence"]
    assert len(sentences) == 2
    for s in sentences:
        assert s["cefr"] is not None
        assert "level" in s["cefr"]


# ── translate_and_build ──────────────────────────────────────────

def test_translate_same_language_skips_mt_and_roundtrips():
    # source == target → no model needed; text should reconstruct verbatim.
    text = "Uma frase. Outra frase."
    out = translate_and_build(text, "pt", "pt")
    assert out["text"] == text
    assert out["engine"] == "server"
    sentences = [p for p in out["parts"] if p["type"] == "sentence"]
    assert len(sentences) == 2


def test_translate_uses_translator_and_builds_parts(monkeypatch):
    # Monkeypatch the shared translator singleton with a deterministic stub.
    monkeypatch.setattr(translation_mod.translator, "available", True)
    monkeypatch.setattr(
        translation_mod.translator,
        "translate_batch",
        lambda texts, source, target: [f"{target.upper()}: {t}" for t in texts],
    )

    out = translate_and_build("Olá mundo. Como vai?", "pt", "de")
    sentences = [p for p in out["parts"] if p["type"] == "sentence"]
    assert len(sentences) == 2
    for s in sentences:
        assert s["text"].startswith("DE: ")
        assert s["cefr"] is not None


def test_translate_rewraps_parenthetical(monkeypatch):
    monkeypatch.setattr(translation_mod.translator, "available", True)
    # Echo the inner text so we can check the wrapper is restored.
    monkeypatch.setattr(
        translation_mod.translator,
        "translate_batch",
        lambda texts, source, target: list(texts),
    )
    out = translate_and_build("(uma nota).", "pt", "de")
    sentence = next(p for p in out["parts"] if p["type"] == "sentence")
    assert sentence["text"] == "(uma nota)."
