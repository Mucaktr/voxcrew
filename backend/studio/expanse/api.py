"""/api/expanse/* — E2 parseller ve keşif kümesi.

    GET /api/expanse/{world} tohum, yarıçap, parseller, sıradaki parselin fiyatı, keşif kümesi
    GET /api/expanse/{world}/plots/{id} parsel gövdesi (E3 inşa farkları)
    POST /api/expanse/{world}/plots sahiplen {slot, confirm, color?, name?, client_request_id?}
    PUT /api/expanse/{world}/plots/{id} parsel gövdesi (tam; şema doğrulamalı, ≤ 64 KB)
    POST /api/expanse/{world}/explored keşfedilen parsel bit kümesi (yalnız mini harita; ödül yok)

Yazma uçları yalnızca kullanıcıdan: `/api/expanse/` yolu `clients/tracker.py USER_ONLY_RE` içindedir (MCP 403; arayüz jetonu
olmayan yerel süreç 403). GET uçları salt okumadır.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException, Path

from studio.expanse.service import ExpanseError, ExpanseService

if TYPE_CHECKING:
    from studio.api import Studio

WORLD = Path(..., max_length=64)
PLOT = Path(..., max_length=32)


def get_service(studio: "Studio") -> ExpanseService:
    svc = getattr(studio, "_expanse_service", None)
    if svc is None:
        svc = ExpanseService(studio)
        studio._expanse_service = svc  # type: ignore[attr-defined]
    return svc


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/expanse", tags=["expanse"])
    S = studio

    def svc() -> ExpanseService:
        return get_service(S)

    async def call(fn: Any, *args: Any) -> Any:
        try:
            return await asyncio.to_thread(fn, *args)
        except ExpanseError as exc:
            raise HTTPException(exc.status, exc.message) from exc

    @r.get("/{world}")
    async def state(world: str = WORLD) -> dict[str, Any]:
        return await call(svc().state, world)

    @r.get("/{world}/plots/{plot_id}")
    async def plot(world: str = WORLD, plot_id: str = PLOT) -> dict[str, Any]:
        return await call(svc().plot, world, plot_id)

    @r.post("/{world}/plots")
    async def claim(world: str = WORLD, data: Any = Body(...)) -> dict[str, Any]:
        return await call(svc().claim, world, data)

    @r.put("/{world}/plots/{plot_id}")
    async def put_plot(world: str = WORLD, plot_id: str = PLOT, data: Any = Body(...)) -> dict[str, Any]:
        return await call(svc().put_plot, world, plot_id, data)

    @r.post("/{world}/explored")
    async def explored(world: str = WORLD, data: Any = Body(...)) -> dict[str, Any]:
        return await call(svc().explored, world, data)

    return r
