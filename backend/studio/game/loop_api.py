"""/api/game/loop — Oyun döngüsü 2 uçları (ilk oturum, açılım yolu, ofis sağlığı, sprint boss'u).

| Yöntem | Yol | Not |
|---|---|---|
| GET | /api/game/loop/first-session | ilk oturum adımları (gerçek veriden), kabul süresi ve dakika kovası |
| GET | /api/game/loop/ikili | İkili ofis şablonları (2 rol) |
| POST | /api/game/loop/first-office `{template}` | İkili ofisi kurar ve iki koltuğu doldurur (yalnız kullanıcı) |
| GET | /api/game/loop/unlock-path | açılım yolu kartları (kilit yok; paket sınırı yalnız bilgi) |
| GET | /api/game/loop/health | ofis sağlığı sinyalleri (ajan sıralaması yok) |
| GET | /api/game/loop/boss | bu haftanın sprint boss'u, ilerleme, unvan |
| GET | /api/game/loop/boss/candidates | seçilebilir çok adımlı akışlar ve açık hedefler |
| POST | /api/game/loop/boss `{kind, ref, target?}` | boss seç (yalnız kullanıcı) |
| POST | /api/game/loop/boss/rest | boss'u dinlenmeye gönder (yalnız kullanıcı; ceza yok) |

Yazma uçları `clients/tracker.USER_ONLY_RE` ile MCP'ye kapalıdır.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException

from studio.game import boss, first_session, health, unlock
from studio.i18n import request_lang

if TYPE_CHECKING:
    from studio.api import Studio


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/game/loop", tags=["game"])
    S = studio

    @r.get("/first-session")
    async def first() -> dict[str, Any]:
        return await asyncio.to_thread(first_session.state, S)

    @r.get("/ikili")
    async def ikili() -> list[dict[str, Any]]:
        return await asyncio.to_thread(first_session.ikili_templates)

    @r.post("/first-office")
    async def first_office(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            return await first_session.first_office(S, str(data.get("template") or ""),
                                                    confirm=data.get("confirm") is True,
                                                    dry_run=data.get("dry_run") is True)
        except first_session.FirstSessionError as exc:
            detail = {"message": exc.message, **exc.detail} if exc.detail else exc.message
            raise HTTPException(exc.status, detail) from exc
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'\"")) from exc
        except ValueError as exc:  # OfficeError, TemplateError
            raise HTTPException(400, str(exc)) from exc

    @r.get("/unlock-path")
    async def unlock_path() -> dict[str, Any]:
        return await asyncio.to_thread(unlock.path, S)

    @r.get("/health")
    async def office_health() -> dict[str, Any]:
        return await asyncio.to_thread(health.health, S)

    @r.get("/boss")
    async def boss_view() -> dict[str, Any]:
        lang = request_lang()
        return await asyncio.to_thread(lambda: boss.view(S, lang=lang))

    @r.get("/boss/candidates")
    async def boss_candidates() -> dict[str, Any]:
        return await asyncio.to_thread(boss.candidates, S)

    @r.post("/boss")
    async def boss_pick(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        lang = request_lang()
        try:
            await asyncio.to_thread(boss.pick, S, str(data.get("kind") or ""), str(data.get("ref") or ""),
                                    data.get("target"))
        except boss.BossError as exc:
            raise HTTPException(exc.status, exc.message) from exc
        return await asyncio.to_thread(lambda: boss.view(S, lang=lang))

    @r.post("/boss/rest")
    async def boss_rest() -> dict[str, Any]:
        lang = request_lang()
        await asyncio.to_thread(boss.rest, S)
        return await asyncio.to_thread(lambda: boss.view(S, lang=lang))

    return r
