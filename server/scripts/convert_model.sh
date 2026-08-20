#!/usr/bin/env bash
# One-time conversion of NLLB-200-distilled-1.3B to a CTranslate2 model,
# quantized to int8_float16 (fits comfortably in the RTX 3070's 8 GB VRAM).
# Downloads ~5 GB of HF weights on first run; the CT2 output is ~1.3 GB.
#
# Run from the repo root:  bash server/scripts/convert_model.sh
set -euo pipefail

OUT_DIR="server/models/nllb-200-distilled-1.3B-ct2"

if [ -d "$OUT_DIR" ]; then
  echo "Model already converted at $OUT_DIR — nothing to do."
  exit 0
fi

ct2-transformers-converter \
  --model facebook/nllb-200-distilled-1.3B \
  --output_dir "$OUT_DIR" \
  --quantization int8_float16 \
  --copy_files tokenizer.json tokenizer_config.json special_tokens_map.json sentencepiece.bpe.model

echo "Done → $OUT_DIR"
