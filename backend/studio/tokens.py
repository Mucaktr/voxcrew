"""Karakter tabanlı token tahmini (gerçek tokenizer bağımlılığı yok); istem hattı ve iz özetleri kullanır."""

from __future__ import annotations

import math
import re

# Türkçe BPE'de token başına ~3.3 karakter (Latin alfabeli İngilizce ~4). Tahmin; gerçek sayım bağlayıcının usage'ından gelir.
CHARS_PER_TOKEN = {"tr": 3.3, "en": 4.0}
_TR_CHARS = re.compile(r"[çğıöşüÇĞİÖŞÜ]")


def est_tokens(text: str, lang: str | None = None) -> int:
    """Karakter tabanlı token tahmini (gerçek tokenizer bağımlılığı yok)."""
    if not text:
        return 0
    if lang not in CHARS_PER_TOKEN:
        lang = "tr" if len(_TR_CHARS.findall(text)) > len(text) / 200 else "en"
    return math.ceil(len(text) / CHARS_PER_TOKEN[lang])
