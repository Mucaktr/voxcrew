"""/api/heroes uç noktaları (S44).

GET    /api/heroes                         kahraman kartları (dil: ?lang= ya da X-Studio-Lang)
GET    /api/heroes/{id}                    ayrıntı (kişilik, hafıza önizlemesi, araç önerileri)
POST   /api/heroes/{id}/recruit            gövde {confirm?: bool, name?: str, lang?: str}
                                           confirm yoksa yalnızca PLAN döner (hiçbir şey yazılmaz); confirm=true kurar
GET    /api/heroes/agents/{slug}/memory    işe alınmış kahramanın hazır hafıza düğümleri
DELETE /api/heroes/agents/{slug}?memory=   kahraman ajanını kaldırır; memory=true (varsayılan) hazır hafızayı da siler

Yalnızca kullanıcı: durum değiştiren istekler MCP istemcilerinden (`X-Studio-Client: mcp/*`) 403 alır — işe alma
ajan, skill, akış ve bellek yazar; kaldırma bunları siler (clients/tracker.py USER_ONLY kuralıyla aynı ilke).
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

from studio.i18n import request_lang

from .presets import PresetError
from .service import HeroError, service_for

if TYPE_CHECKING:
    from studio.api import Studio


def user_only(request: Request) -> None:
    hdr = (request.headers.get("x-studio-client") or "").strip().lower()
    if request.method != "GET" and hdr.startswith("mcp/"):
        raise HTTPException(403, "Kahraman işe alma ve kaldırma yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir")


def _guard(fn: Any) -> Any:
    try:
        return fn()
    except KeyError as exc:
        raise HTTPException(404, str(exc).strip("'\"")) from exc
    except (HeroError, PresetError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/heroes", tags=["heroes"], dependencies=[Depends(user_only)])
    S = studio

    def lang_of(lang: str | None) -> str:
        return lang if lang in ("tr", "en") else request_lang()

    @r.get("")
    async def list_heroes(lang: str | None = None) -> list[dict[str, Any]]:
        lg = lang_of(lang)
        return await asyncio.to_thread(lambda: service_for(S).list(lg))

    @r.get("/agents/{slug}/memory")
    async def hero_memory(slug: str) -> dict[str, Any]:
        nodes = _guard(lambda: service_for(S).seed_nodes(slug))
        return {"slug": slug, "count": len(nodes),
                "facts": [{"id": n["id"], "statement": n["props"].get("statement"), "source": n["props"].get("source")}
                          for n in nodes]}

    @r.get("/{hero_id}")
    async def hero_detail(hero_id: str, lang: str | None = None) -> dict[str, Any]:
        lg = lang_of(lang)
        return _guard(lambda: service_for(S).detail(hero_id, lg))

    @r.post("/{hero_id}/recruit")
    async def recruit(hero_id: str, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        lg = data.get("lang") if data.get("lang") in ("tr", "en") else None
        name = str(data.get("name") or "").strip() or None
        svc = service_for(S)
        if data.get("confirm") is not True:
            return {"plan": _guard(lambda: svc.plan(hero_id, lg, name)), "confirmed": False}
        out = await asyncio.to_thread(lambda: _guard(lambda: svc.recruit(hero_id, lg, name)))
        S.bus.publish("agent.updated", agent=out["agent"])
        S.bus.publish("hero.recruited", hero=out["hero"], agent=out["agent"]["slug"])
        return {**out, "confirmed": True}

    @r.delete("/agents/{slug}")
    async def remove(slug: str, memory: bool = Query(True)) -> dict[str, Any]:
        out = await asyncio.to_thread(lambda: _guard(lambda: service_for(S).remove(slug, memory=memory)))
        S.bus.publish("agent.removed", agent=slug)
        return out

    return r

