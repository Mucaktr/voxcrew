"""/api/changes — kullanıcı onaylı yapılandırma değişiklikleri (teknik lider; S1 ve S2 kullanır).

Planlar özellik uç noktalarında oluşturulur (ör. SOUL kaydet → plan döner). Arayüz diff'i gösterir;
kullanıcı onaylarsa buradaki apply çağrılır.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException

from studio.changes import ChangeError

if TYPE_CHECKING:
    from studio.api import Studio


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/changes", tags=["changes"])

    @r.get("")
    def history(limit: int = 50) -> list[dict[str, Any]]:
        return list(reversed(studio.changes.history(limit)))

    @r.get("/plans/{plan_id}")
    def plan(plan_id: str) -> dict[str, Any]:
        p = studio.changes.pending.get(plan_id)
        if not p:
            raise HTTPException(404, "Plan yok veya süresi doldu")
        return p.public()

    @r.post("/plans/{plan_id}/apply")
    async def apply(plan_id: str, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        try:
            # dosya kilidi birkaç saniye bekleyebilir: olay döngüsünü bloklamamak için iş parçacığında
            entry = await asyncio.to_thread(studio.changes.apply, plan_id, data.get("confirm") is True)
        except ChangeError as exc:
            raise HTTPException(400, str(exc)) from exc
        studio.bus.publish("config.changed", change=entry)
        return entry

    @r.post("/{change_id}/undo")
    async def undo(change_id: str, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        try:
            entry = await asyncio.to_thread(studio.changes.undo, change_id, data.get("confirm") is True)
        except ChangeError as exc:
            raise HTTPException(400, str(exc)) from exc
        studio.bus.publish("config.changed", change=entry)
        return entry

    return r
