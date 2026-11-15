"""/api/citypacks — şehir paketleri vitrini (CITY-PACKS). Satış KAPALI; yalnız okuma uçları.

| Yöntem | Yol | Not |
|---|---|---|
| GET | /api/citypacks/store | paketler, öğeler, risk, ÖNERİ fiyat, sahiplik (bayrak açıkken), jeton teklifi |
| GET | /api/citypacks/packs/{id} | tek paket (aynı alanlar) |

Para ile satın alma, ödeme, hediye ya da yazma ucu YOKTUR. Jetonla alma oyunun mevcut kullanıcı-yalnız alım ucundandır
(`POST /api/game/shop/store:city-<paket>/buy {confirm:true}`; bayrak `store.cosmetics_enabled` açıkken).
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, HTTPException

from studio.citypacks import catalog as K
from studio.citypacks import service as SVC
from studio.game.api import get_service

if TYPE_CHECKING:
    from studio.api import Studio


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/citypacks", tags=["citypacks"])
    S = studio

    def game() -> Any | None:
        try:
            return get_service(S)
        except Exception:  # noqa: BLE001 - oyun yoksa yalnız önizleme
            return None

    @r.get("/store")
    async def store() -> dict[str, Any]:
        return await asyncio.to_thread(lambda: SVC.store_view(game(), S))

    @r.get("/packs/{pack_id}")
    async def one(pack_id: str) -> dict[str, Any]:
        p = K.get(pack_id)
        if p is None:
            raise HTTPException(404, "Böyle bir şehir paketi yok")
        view = await asyncio.to_thread(lambda: SVC.store_view(game(), S))
        return next(x for x in view["packs"] if x["id"] == p.id) | {"enabled": view["enabled"], "admin": view["admin"]}

    return r
