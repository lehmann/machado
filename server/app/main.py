"""FastAPI app exposing the server-side translation engine.

Contract (matches the frontend ServerProvider):
  GET  /health    -> { ok, models }
  POST /translate -> { text, source, target } => { text, parts, engine, model }
  POST /analyze   -> { text, lang }            => { parts }
  POST /grammar   -> { text, lang }            => { lang, source, tokens, relations }
"""
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
