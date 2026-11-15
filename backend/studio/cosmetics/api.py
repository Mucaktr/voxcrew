"""/api/cosmetics — kozmetik mağazası (COS-A). Satış KAPALI.

| Yöntem | Yol | Not |
|---|---|---|
| GET | /api/cosmetics/store | vitrin: setler, parçalar, yüzeyler, kapsam kapısı. Bayrak kapalıyken yalnız önizleme verisi |
| GET | /api/cosmetics/sets/{id} | tek set (aynı alanlar) |
| GET | /api/cosmetics/coverage | "her yerde çizili" kapısının ham raporu |
| GET | /api/cosmetics/collection | sahip olunan `store:*` parçaları (bayrak gerekir) |
| POST | /api/cosmetics/sync | haktan envantere projeksiyon + ücretsiz yol (yalnız kullanıcı; bayrak gerekir) |

Para ile satın alma, para fiyatı, ödeme, hediye ya da deneme-yazma ucu YOKTUR (tests/test_cosmetics_api.py). Aynı set
jetonla da alınabilir (2026-10-19 gece kararı): bu, burada değil oyunun mevcut kullanıcı-yalnız alım ucundan yapılır
(`POST /api/game/shop/store:<set>/buy {confirm:true}`; bayrak açık ve set her yüzeyde çiziliyse). Jeton satılmaz. Yazma uçları
`clients/tracker.USER_ONLY_RE` (`cosmetics/`) ile MCP'ye kapalıdır (403).
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, HTTPException

from studio.cosmetics import catalog as K
from studio.cosmetics import coverage as COV
from studio.cosmetics import service as SVC
from studio.game.api import _publish, get_service

if TYPE_CHECKING:
    from studio.api import Studio


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/cosmetics", tags=["cosmetics"])
    S = studio
    agents = getattr(S, "agents", None)
    if agents is not None:   # ajan avatarının `wear` alanı yalnız sahip olunan, giyilebilir parçayla kaydedilir
        agents.wear_filter = lambda w: SVC.clean_wear(get_service(S), w)

    def game() -> Any | None:
        return get_service(S) if SVC.enabled(S) else None

    @r.get("/store")
    async def store() -> dict[str, Any]:
        return await asyncio.to_thread(lambda: SVC.store_view(game(), S))

    @r.get("/sets/{set_id}")
    async def one_set(set_id: str) -> dict[str, Any]:
        cs = K.get(set_id)
        if cs is None:
            raise HTTPException(404, "Böyle bir kozmetik set yok")
        out = await asyncio.to_thread(lambda: SVC.set_view(game(), cs))
        return {**out, "enabled": SVC.enabled(S), "mode": "preview"}

    @r.get("/coverage")
    async def coverage() -> dict[str, Any]:
        return await asyncio.to_thread(COV.report)

    @r.get("/collection")
    async def collection() -> dict[str, Any]:
        if not SVC.enabled(S):
            return {"enabled": False, "items": [], "count": 0}
        g = get_service(S)
        await asyncio.to_thread(SVC.ensure_schema, g)
        return {"enabled": True, **await asyncio.to_thread(SVC.collection_view, g)}

    @r.post("/sync")
    async def sync() -> dict[str, Any]:
        try:
            res = await asyncio.to_thread(SVC.sync, get_service(S))
        except SVC.CosmeticsDisabled as exc:
            raise HTTPException(403, str(exc)) from exc
        _publish(S, res.pop("events", []))
        return res

    return r
