"""Başlatma hatalarının kullanıcıya gösterilecek düz metni.

`HTTPException.detail` yapılandırılmış olabilir (`{"code": "no_brain", "message": …}`, paket sınırı kararı): `str(exc)`
bir Python sözlük dökümü verir. Zamanlama, eval, kabul incelemesi ve eval-kapı yolları bu yardımcıyı kullanır."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException


def error_text(exc: BaseException, limit: int = 500) -> str:
    """`detail["message"]` varsa o; yoksa `detail` / `str(exc)` (HTTP durum öneki olmadan), en çok `limit` karakter."""
    detail: Any = exc.detail if isinstance(exc, HTTPException) else None
    if isinstance(detail, dict) and isinstance(detail.get("message"), str):
        text = detail["message"]
    elif isinstance(exc, HTTPException):
        text = str(detail)
    else:
        text = str(exc)
    return text.strip("'")[:limit]


def status_of(exc: BaseException, default: int = 400) -> int:
    return int(exc.status_code) if isinstance(exc, HTTPException) else default
