"""Direct PT<->DE translation via NLLB-200-distilled-1.3B served with
CTranslate2 (int8) on the GPU. No English pivot.

The model is loaded lazily at import; if the converted model or its deps are
missing, `translator.available` stays False and the server still boots (so you
can iterate on everything else). /translate then returns 503.
"""
import os

from .config import (
    NLLB_CT2_PATH, NLLB_TOKENIZER, MODEL_NAME, CT2_DEVICE, CT2_COMPUTE,
    BEAM_SIZE, FLORES,
)


class Translator:
    def __init__(self):
        self.available = False
        self.model_name = MODEL_NAME
        self.error = None
        self.fake = False
        self._translator = None
        self._tokenizer = None
        # Test seam: MACHADO_FAKE_MT=1 makes the translator "available" with a
        # deterministic stand-in transform, so integration tests can exercise the
        # full server path (segmentation, CEFR, parts assembly) without the GPU
        # model. Never set in production.
        if os.environ.get("MACHADO_FAKE_MT"):
            self.available = True
            self.fake = True
            self.model_name = "fake-mt"
            return
        self._load()

    def _load(self):
        try:
            import ctranslate2
            from transformers import AutoTokenizer

            if not os.path.isdir(NLLB_CT2_PATH):
                raise FileNotFoundError(
                    f"Converted model not found at {NLLB_CT2_PATH}. "
                    "Run scripts/convert_model.sh."
                )
            self._translator = ctranslate2.Translator(
                NLLB_CT2_PATH, device=CT2_DEVICE, compute_type=CT2_COMPUTE
            )
            self._tokenizer = AutoTokenizer.from_pretrained(NLLB_TOKENIZER)
            self.available = True
        except Exception as e:  # noqa: BLE001 — boot even if the model is absent
            self.error = str(e)
            self.available = False

    def translate_batch(self, texts, source, target):
        if not self.available:
            raise RuntimeError(f"Translator unavailable: {self.error}")
        if not texts:
            return []

        if self.fake:
            # Deterministic stand-in: prefix with the target language code.
            return [f"{target.upper()}: {t}" for t in texts]

        src_code = FLORES[source]
        tgt_code = FLORES[target]
        tok = self._tokenizer
        tok.src_lang = src_code

        sources = [tok.convert_ids_to_tokens(tok.encode(t)) for t in texts]
        target_prefix = [[tgt_code]] * len(sources)

        results = self._translator.translate_batch(
            sources,
            target_prefix=target_prefix,
            beam_size=BEAM_SIZE,
            max_batch_size=16,
        )

        outputs = []
        for res in results:
            hyp = res.hypotheses[0]
            # Drop the leading target-language token before decoding.
            if hyp and hyp[0] == tgt_code:
                hyp = hyp[1:]
            ids = tok.convert_tokens_to_ids(hyp)
            outputs.append(tok.decode(ids, skip_special_tokens=True))
        return outputs


translator = Translator()
