"""FastAPI app exposing the server-side translation engine.

Contract (matches the frontend ServerProvider):
  GET  /health    -> { ok, models }
  POST /translate -> { text, source, target } => { text, parts, engine, model }
  POST /analyze   -> { text, lang }            => { parts }
  POST /grammar   -> { text, lang }            => { lang, source, tokens, relations }
"""
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import ALLOWED_ORIGINS
from .schemas import (
    AnalyzeRequest, AnalyzeResponse, GrammarRequest, GrammarResponse,
    TranslateRequest, TranslateResponse,
)
from .analysis import analyze_and_build, translate_and_build
from . import grammar as grammar_mod
from .nlp import get_nlp, grammar_available
from .translation import translator

app = FastAPI(title="machado server", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": translator.available,
        "models": {
            "translation": {
                "name": translator.model_name,
                "available": translator.available,
                "error": translator.error,
            },
            "cefr": {
                "pt": get_nlp("pt") is not None,
                "de": get_nlp("de") is not None,
            },
            "grammar": {
                "pt": grammar_available("pt"),
                "de": grammar_available("de"),
            },
        },
    }


@app.post("/translate", response_model=TranslateResponse)
def translate(req: TranslateRequest):
    if req.source != req.target and not translator.available:
        raise HTTPException(
            status_code=503,
            detail=f"Translation model unavailable: {translator.error}",
        )
    return translate_and_build(req.text, req.source, req.target)


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    return analyze_and_build(req.text, req.lang)


@app.post("/grammar", response_model=GrammarResponse)
def grammar(req: GrammarRequest):
    if not grammar_available(req.lang):
        raise HTTPException(
            status_code=503,
            detail=f"Grammar model unavailable for '{req.lang}' (install the spaCy model)",
        )
    return grammar_mod.analyze(req.text, req.lang)


# ── Optional: serve the built SPA on the same origin (production) ──────────
# Set MACHADO_STATIC_DIR=/path/to/dist to have this API also serve the frontend
# build, with the COOP/COEP headers the local ONNX engine needs. Unset (dev/CI)
# → this block is inert and the API behaves exactly as before. Registered after
# the API routes so those keep precedence; the "/" mount is the catch-all.
_STATIC_DIR = os.environ.get("MACHADO_STATIC_DIR")
if _STATIC_DIR and os.path.isdir(_STATIC_DIR):
    from fastapi.staticfiles import StaticFiles

    @app.middleware("http")
    async def _cross_origin_isolation(request, call_next):
        response = await call_next(request)
        # Required for SharedArrayBuffer / ONNX Runtime Web (local fallback).
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Embedder-Policy"] = "credentialless"
        return response

    # Optional: self-host the local-engine ONNX models so the browser fetches
    # them from our own origin (no HuggingFace token needed offline). Kept OUT of
    # the SPA dir so `npm run build` doesn't wipe the ~474 MB. The build must set
    # VITE_MODELS_BASE=/models so the worker points here (see fetch-models.mjs).
    # Mounted BEFORE "/" so it takes precedence over the SPA catch-all.
    _WEB_MODELS_DIR = os.environ.get("MACHADO_WEB_MODELS_DIR")
    if _WEB_MODELS_DIR and os.path.isdir(_WEB_MODELS_DIR):
        app.mount("/models", StaticFiles(directory=_WEB_MODELS_DIR), name="models")

    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="spa")
