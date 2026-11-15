"""/api/metrics — yerel ölçüm defteri ve kuzey yıldızı (G1-A).

| Uç | Açıklama |
|---|---|
| `GET /api/metrics/summary?window=7d\\|28d\\|all` | WAD, kabul başına token/maliyet, görev başarısı, düzeltme yükü, değerli hafta toplamı, kişisel pencereler, güvenilirlik, bütçe aşımı |
| `GET /api/metrics/strip?window=7d\\|28d\\|all` | ana ekran şeridi (maliyet + son/ort., token, tur, ajan süresi, son kalite testi) |
| `GET /api/metrics/cost-distribution?window=` | görev ailesi başına P50/P95/P99/en yüksek ve en pahalı %5'in payı |
| `GET /api/metrics/tokens?window=` | G4: adım başına jeton dağılımı (P50/P95; bağlayıcı/tür başına) + referanslı araç çıktısı tasarrufu |
| `GET /api/metrics/export` | defterin tamamı (JSON; yalnız kimlik ve sayı) |
| `PUT /api/metrics/retention` | `{days}` saklama süresi (30–3650, varsayılan 400); yalnız kullanıcı |
| `DELETE /api/metrics` | defteri siler; yalnız kullanıcı (`clients/tracker.py USER_ONLY_RE` → `metrics(?:/retention)?$`) |

Okuma herkese açık (MCP dahil). Hiçbir uç ağ çağrısı yapmaz; hesaplar `<veri>/metrics.sqlite` üzerinde yereldir.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, Query

from studio.metrics.service import service_for, start, stop

if TYPE_CHECKING:
    from studio.api import Studio

WINDOW_RE = r"^(7d|28d|all)$"

__all__ = ["build_router", "start", "stop"]


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/metrics", tags=["metrics"])

    @r.get("/summary")
    async def summary(window: str = Query("7d", pattern=WINDOW_RE)) -> dict[str, Any]:
        return await asyncio.to_thread(service_for(studio).summary, window)

    @r.get("/strip")
    async def strip(window: str = Query("7d", pattern=WINDOW_RE)) -> dict[str, Any]:
        """ana ekran şeridi (maliyet, token, ajan süresi, testler); boş kaynak `null` döner."""
        return await asyncio.to_thread(service_for(studio).strip, window)

    @r.get("/cost-distribution")
    async def cost_distribution(window: str = Query("all", pattern=WINDOW_RE)) -> dict[str, Any]:
        return await asyncio.to_thread(service_for(studio).cost_distribution, window)

    @r.get("/tokens")
    async def tokens(window: str = Query("7d", pattern=WINDOW_RE)) -> dict[str, Any]:
        """G4: adım başına jeton P50/P95 + araç çıktısı artefaktı tasarrufu (kaçınılan karakter)."""
        return await asyncio.to_thread(service_for(studio).token_report, window)

    @r.get("/export")
    async def export() -> dict[str, Any]:
        svc = service_for(studio)
        await asyncio.to_thread(svc.refresh)
        return await asyncio.to_thread(svc.ledger.export)

    @r.put("/retention")
    async def retention(days: int = Body(..., embed=True, ge=30, le=3650)) -> dict[str, Any]:
        return {"retention_days": await asyncio.to_thread(service_for(studio).set_retention_days, days)}

    @r.delete("")
    async def erase() -> dict[str, Any]:
        deleted = await asyncio.to_thread(service_for(studio).erase)
        studio.bus.publish("metrics.erased", deleted=deleted)
        return {"ok": True, "deleted": deleted}

    return r
