"""/api/portability uç noktaları: "hepsini dışa aktar".

| Uç | Gövde / sorgu | Yanıt |
|---|---|---|
| `GET /api/portability/manifest` | — | bölüm sayıları, hariç tutulanlar, sınırlar (içerik yok) |
| `POST /api/portability/export` | `{reason?: cancel\\|downgrade\\|manual}` | `application/zip` akışı (ek dosya) |

Güvenlik: `POST /api/portability/export` `clients/tracker.USER_ONLY_RE` içindedir — MCP 403; başlıksız yerel süreç
arayüz jetonu ister (`presence`). Paket tüm kullanıcı verisini taşır; bu yüzden ajan/MCP indiremez. Uç yalnız okur.
Router kaydı `main.py`dedir (entegratör): `app.include_router(portability_router(st), dependencies=seen)`.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body
from fastapi.responses import StreamingResponse

from .service import REASONS, service_for

if TYPE_CHECKING:
    from studio.api import Studio


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/portability", tags=["portability"])

    @r.get("/manifest")
    async def manifest() -> dict[str, Any]:
        return await asyncio.to_thread(service_for(studio).manifest)

    @r.post("/export")
    async def export(data: dict[str, Any] | None = Body(default=None)) -> StreamingResponse:
        reason = str((data or {}).get("reason") or "manual")
        reason = reason if reason in REASONS else "manual"
        svc = service_for(studio)
        name = svc.filename()
        # senkron üreteç: Starlette onu iş parçacığı havuzunda yürütür (olay döngüsü bloklanmaz)
        return StreamingResponse(svc.stream(reason), media_type="application/zip",
                                 headers={"Content-Disposition": f'attachment; filename="{name}"',
                                          "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})

    return r
