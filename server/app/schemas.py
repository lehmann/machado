from typing import Any, Dict, List, Literal

from pydantic import BaseModel, Field

Lang = Literal["pt", "de"]


class TranslateRequest(BaseModel):
    text: str = Field(..., max_length=20000)
    source: Lang
    target: Lang


class AnalyzeRequest(BaseModel):
    text: str = Field(..., max_length=20000)
    lang: Lang


class GrammarRequest(BaseModel):
    # One sentence at a time (clicked in the UI); keep it small.
    text: str = Field(..., max_length=5000)
    lang: Lang


class TranslateResponse(BaseModel):
    text: str
    parts: List[Dict[str, Any]]
    engine: str
    model: str


class AnalyzeResponse(BaseModel):
    parts: List[Dict[str, Any]]


class GrammarResponse(BaseModel):
    lang: str
    source: str
    tokens: List[Dict[str, Any]]
    relations: List[Dict[str, Any]]
