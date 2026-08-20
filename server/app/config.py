"""Runtime configuration, all overridable via environment variables."""
import os
from pathlib import Path

# Repo root = two levels up from this file (server/app/config.py -> repo/).
REPO_ROOT = Path(__file__).resolve().parents[2]

# Single source of truth for frequency lists: the same JS data modules the
# browser (local engine) uses, so both engines rank vocabulary identically.
FREQ_DATA_DIR = REPO_ROOT / "src" / "data"

# Converted CTranslate2 model directory (see scripts/convert_model.sh).
NLLB_CT2_PATH = os.environ.get(
    "NLLB_CT2_PATH", str(REPO_ROOT / "server" / "models" / "nllb-200-distilled-1.3B-ct2")
)
# HF tokenizer to pair with the converted model.
NLLB_TOKENIZER = os.environ.get("NLLB_TOKENIZER", "facebook/nllb-200-distilled-1.3B")
MODEL_NAME = os.environ.get("MODEL_NAME", "nllb-200-distilled-1.3B")

# GPU by default (RTX 3070). int8_float16 keeps VRAM low with good quality.
CT2_DEVICE = os.environ.get("CT2_DEVICE", "cuda")
CT2_COMPUTE = os.environ.get(
    "CT2_COMPUTE", "int8_float16" if CT2_DEVICE == "cuda" else "int8"
)
BEAM_SIZE = int(os.environ.get("BEAM_SIZE", "4"))

# spaCy pipelines for sentence segmentation + syntactic CEFR features.
SPACY_MODELS = {
    "pt": os.environ.get("SPACY_PT", "pt_core_news_sm"),
    "de": os.environ.get("SPACY_DE", "de_core_news_sm"),
}

# NLLB FLORES-200 language codes.
FLORES = {"pt": "por_Latn", "de": "deu_Latn"}

# CORS: dev servers (Vite dev 5173, preview 4173). Comma-separated override.
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4173"
).split(",")
