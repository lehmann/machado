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


class TranslateResponse(BaseModel):
    text: str
    parts: List[Dict[str, Any]]
    engine: str
    model: str


class AnalyzeResponse(BaseModel):
    parts: List[Dict[str, Any]]
