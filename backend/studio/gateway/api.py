"""/api/gateway uç noktaları — Ekip S2.

GET /api/gateway → {gateway:{...}, profiles:[...]} (kart için tek çağrı)
GET /api/gateway/status → [{profile, port, key_present, enabled_in_env, running, pid?, healthy, url, managed, state}]
GET /api/gateway/preview?profiles=arastirma,yazim → {plans:[ChangePlan+{profile, changes}], warnings:[...]} (yazmaz)
POST /api/gateway/enable {plan_ids:[...], confirm:true} → planları sırayla uygular (yedekli), ilk hatada durur
POST /api/gateway/start {confirm:true} · POST /api/gateway/stop (yalnızca kullanıcı tıklaması; otomatik başlatma yok)
GET /api/gateway/logs?lines=200 → maskeli son satırlar
Hiçbir yanıt anahtar değeri içermez.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException

from studio.changes import ChangeError
from studio.gateway.manager import GatewayError
from studio.gateway.setup import EnableFlow

if TYPE_CHECKING:
    from studio.api import Studio


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/gateway", tags=["gateway"])
    manager = studio.gateway
    flow = EnableFlow(manager, studio.changes)
    studio.gateway_setup = flow  # type: ignore[attr-defined]  # testler ve teşhis için

    async def publish() -> dict[str, Any]:
        info = await manager.overview(force=True)
        studio.bus.publish("gateway.changed", gateway=info["gateway"])
        return info

    @r.get("")
    async def overview(force: bool = False) -> dict[str, Any]:
        return await manager.overview(force=force)

    @r.get("/status")
    async def status(force: bool = False) -> list[dict[str, Any]]:
        return await manager.status(force=force)

    @r.get("/preview")
    async def preview(profiles: str = "") -> dict[str, Any]:
        try:
            return flow.preview(profiles.split(","))
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc

    @r.post("/enable")
    async def enable(data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        try:
            result = flow.enable(list(data.get("plan_ids") or []), data.get("confirm") is True)
        except ChangeError as exc:
            raise HTTPException(400, str(exc)) from exc
        for entry in result["applied"]:
            if not entry.get("skipped"):
                studio.bus.publish("config.changed", change=entry)
        result["status"] = await publish()
        return result

    @r.post("/start")
    async def start(data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        if data.get("confirm") is not True:
            raise HTTPException(400, "Gateway'i başlatmak için açık onay (confirm: true) gerekli")
        try:
            await manager.start()
        except GatewayError as exc:
            await publish()
            raise HTTPException(409, str(exc)) from exc
        return await publish()

    @r.post("/stop")
    async def stop() -> dict[str, Any]:
        try:
            await manager.stop()
        except GatewayError as exc:
            raise HTTPException(409, str(exc)) from exc
        return await publish()

    @r.get("/logs")
    async def logs(lines: int = 200) -> dict[str, Any]:
        return {"path": str(manager.log_path), "lines": manager.log_tail(lines)}

    return r
