"""FastAPI app exposing the server-side translation engine.

Contract (matches the frontend ServerProvider):
  GET  /health    -> { ok, models }
  POST /translate -> { text, source, target } => { text, parts, engine, model }
  POST /analyze   -> { text, lang }            => { parts }
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import ALLOWED_ORIGINS
from .schemas import (
    AnalyzeRequest, AnalyzeResponse, TranslateRequest, TranslateResponse,
)
from .analysis import analyze_and_build, translate_and_build
from .nlp import get_nlp
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
