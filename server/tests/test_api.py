"""Endpoint tests via FastAPI's TestClient.

Skipped automatically when fastapi/httpx aren't installed. Uses a monkeypatched
translator so no NLLB model is needed, while still exercising the real routing,
validation, segmentation, CEFR and parts assembly.
"""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")  # required by starlette's TestClient

from fastapi.testclient import TestClient  # noqa: E402

import app.translation as translation_mod  # noqa: E402
from app.main import app  # noqa: E402


def _install_fake_mt(monkeypatch):
    monkeypatch.setattr(translation_mod.translator, "available", True)
    monkeypatch.setattr(translation_mod.translator, "model_name", "fake-mt")
    monkeypatch.setattr(
        translation_mod.translator,
        "translate_batch",
        lambda texts, source, target: [f"{target.upper()}: {t}" for t in texts],
    )


def _assert_parts_contract(parts):
    assert isinstance(parts, list) and parts
    for p in parts:
        assert p["type"] in ("gap", "sentence")
        assert isinstance(p["text"], str)
        if p["type"] == "sentence":
            assert p["cefr"] is not None
            assert p["cefr"]["level"] in ("A1", "A2", "B1", "B2", "C1", "C2")


@pytest.fixture
def client(monkeypatch):
    _install_fake_mt(monkeypatch)
    return TestClient(app)


def test_health_ok_when_translator_available(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["models"]["translation"]["available"] is True
    assert set(body["models"]["cefr"].keys()) == {"pt", "de"}


def test_translate_returns_parts_contract(client):
    r = client.post("/translate", json={"text": "Olá mundo. Como vai?", "source": "pt", "target": "de"})
    assert r.status_code == 200
    body = r.json()
    assert body["engine"] == "server"
    assert body["model"] == "fake-mt"
    _assert_parts_contract(body["parts"])
    sentences = [p for p in body["parts"] if p["type"] == "sentence"]
    assert len(sentences) == 2
    assert all(s["text"].startswith("DE: ") for s in sentences)
    # `text` is the concatenation of every part.
    assert body["text"] == "".join(p["text"] for p in body["parts"])


def test_analyze_returns_parts_contract(client):
    r = client.post("/analyze", json={"text": "O gato dorme. Ele está cansado.", "lang": "pt"})
    assert r.status_code == 200
    _assert_parts_contract(r.json()["parts"])


def test_invalid_language_is_rejected(client):
    r = client.post("/translate", json={"text": "oi", "source": "xx", "target": "de"})
    assert r.status_code == 422


def test_translate_503_when_model_unavailable(monkeypatch):
    monkeypatch.setattr(translation_mod.translator, "available", False)
    monkeypatch.setattr(translation_mod.translator, "error", "no model")
    client = TestClient(app)
    r = client.post("/translate", json={"text": "oi", "source": "pt", "target": "de"})
    assert r.status_code == 503
