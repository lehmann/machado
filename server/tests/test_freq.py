"""Unit tests for the frequency-list loader and band mapping."""
from app.freq import _extract_word_string, band_from_rank, rank_map


def test_extract_word_string_parses_js_module():
    js = (
        "// a comment\n"
        "// another\n"
        'export default "der die und";\n'
    )
    assert _extract_word_string(js) == "der die und"


def test_extract_word_string_missing_export_returns_empty():
    assert _extract_word_string("no export here") == ""


def test_rank_map_loads_real_lists():
    for lang in ("pt", "de"):
        rm = rank_map(lang)
        assert len(rm) > 5000, f"{lang} list looks too small"
        # ranks are 0-based and unique across the list
        assert min(rm.values()) == 0
        assert max(rm.values()) == len(rm) - 1


def test_rank_map_is_cached():
    assert rank_map("pt") is rank_map("pt")


def test_band_from_rank_thresholds():
    assert band_from_rank(None) == 6      # unknown word → rarest
    assert band_from_rank(0) == 1
    assert band_from_rank(499) == 1
    assert band_from_rank(500) == 2
    assert band_from_rank(999) == 2
    assert band_from_rank(1000) == 3
    assert band_from_rank(1999) == 3
    assert band_from_rank(2000) == 4
    assert band_from_rank(3499) == 4
    assert band_from_rank(3500) == 5
    assert band_from_rank(5999) == 5
    assert band_from_rank(6000) == 6
