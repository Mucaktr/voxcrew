"""Ayarlar sayfasındaki sayısal alanların sunucu tarafı sınırları.

Arayüz min/max ile de sınırlar (frontend/src/lib/settingsLimits.ts, aynı değerler); asıl kapı burasıdır, çünkü
MCP ve curl arayüzden geçmez. Bozuk değer (-5, "abc", 99999999999, bool, ondalık) sessizce kaydedilmez, 400 döner.
"""

from __future__ import annotations

from typing import Any

# yol -> (en az, en çok, okunur ad)
LIMITS: dict[str, tuple[int, int, str]] = {
    "ollama.num_ctx": (512, 1_048_576, "Bağlam penceresi"),
    "max_turns": (1, 500, "Azami tur"),
    "step_timeout_min": (1, 1440, "Adım zaman aşımı (dk)"),
    "memory.budget_chars": (600, 6000, "Bellek bütçesi"),
}
CONCURRENCY = (1, 8)


def _bad(name: str, lo: int, hi: int) -> str:
    return f"{name}: {lo:,} ile {hi:,} arasında bir tam sayı olmalı".replace(",", ".")


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def validate_numeric_settings(data: dict[str, Any]) -> list[str]:
    """Yamadaki sayısal alanları denetler; hata iletilerinin listesini döner (boşsa geçerli). Yoksa alanı atlar."""
    errors: list[str] = []
    for path, (lo, hi, name) in LIMITS.items():
        cur: Any = data
        for part in path.split("."):
            if not isinstance(cur, dict) or part not in cur:
                cur = None
                break
            cur = cur[part]
        else:
            if not _is_int(cur) or not lo <= cur <= hi:
                errors.append(_bad(name, lo, hi))
    conc = data.get("concurrency")
    if isinstance(conc, dict):
        for k, v in conc.items():
            if not _is_int(v) or not CONCURRENCY[0] <= v <= CONCURRENCY[1]:
                errors.append(_bad(f"Eşzamanlılık ({k})", *CONCURRENCY))
    return errors
