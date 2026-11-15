"""EN kataloğu — AUDIT 2026-10-19 P1 (sistem çağrısı muhasebesi, gizli denetçi koşusu)."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "Beyaz listede olmayan sistem çağrısı: {}": "System call is not on the whitelist: {}",
    "Denetçi zaman aşımı ({} sn)": "Reviewer timed out ({} s)",
}
