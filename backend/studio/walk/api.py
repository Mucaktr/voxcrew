"""/api/walk/* — yürüme modu ilerlemesi (W4). Sözleşme:.

Yazma uçları yalnızca kullanıcıdan: `/api/walk/` yolu `clients/tracker.py USER_ONLY_RE` içindedir; MCP istemcisi GET dışı
her istekte 403 alır ve `studio.presence` arayüz jetonu olmayan yerel süreç 403 alır. GET uçları salt okumadır.
"""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException, Query, Request

from studio.clients.tracker import mcp_client
from studio.walk import catalog as W
from studio.walk import explore as EX
from studio.walk import fishing as FI
from studio.walk import minigame as MG
from studio.walk import rituals as RT
from studio.walk.service import WalkError, WalkService

if TYPE_CHECKING:
    from studio.api import Studio


def get_service(studio: "Studio") -> WalkService:
    svc = getattr(studio, "_walk_service", None)
    if svc is None:
        svc = WalkService(studio)
        studio._walk_service = svc  # type: ignore[attr-defined]
    return svc


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/walk", tags=["walk"])
    S = studio

    def svc() -> WalkService:
        return get_service(S)

    async def call(fn: Any, *args: Any) -> Any:
        try:
            return await asyncio.to_thread(fn, *args)
        except WalkError as exc:
            raise HTTPException(exc.status, exc.message) from exc

    async def write(fn: Any, data: Any) -> dict[str, Any]:
        if not isinstance(data, dict):
            raise HTTPException(400, "Gövde bir nesne olmalı")
        res = await call(fn, data)
        for etype, payload in res.pop("events", []):
            S.bus.publish(etype, **payload)
        return res

    waiting = {"n": 0}

    async def cue(fn: Any, data: Any) -> dict[str, Any]:
        """ işaret uzun yoklaması: sunucu gizli ana dek bekler, yanıtta yalnız `cue` (zaman damgası yok)."""
        if not isinstance(data, dict):
            raise HTTPException(400, "Gövde bir nesne olmalı")
        info = await call(fn, data)
        due = info.pop("due", None)
        if due is not None and due - time.time() > 0:
            if waiting["n"] >= MG.CUE_MAX_WAITERS:
                raise HTTPException(429, "Çok fazla bekleyen işaret; biraz bekle")
            waiting["n"] += 1
            try:
                until = time.time() + MG.CUE_MAX_WAIT_S
                # dilimlerle bekle: tur kapanırsa (erken toplandı, yeni atış) bekleme hemen biter
                while due is not None and time.time() < min(due, until):
                    await asyncio.sleep(max(0.0, min(min(due, until) - time.time(), MG.CUE_SLICE_S)))
                    info = await call(fn, data)
                    due = info.pop("due", None)
            finally:
                waiting["n"] -= 1
        return {**info, "cue": bool(info.get("open")) and due is not None and time.time() >= due - 0.02}

    # ---------------------------------------------------------------- okuma (MCP okuyabilir)
    @r.get("/catalog")
    async def catalog() -> dict[str, Any]:
        return W.public()

    @r.get("/state")
    async def state(world: str | None = Query(None, max_length=64)) -> dict[str, Any]:
        return await call(svc().state, world or None)

    @r.get("/explore/catalog")
    async def explore_catalog() -> dict[str, Any]:
        """WALK-EXPLORE: keşif kataloğu (iç mekân, seyir noktası, keşif parçası, POI, gizli köşe; görevler, unvanlar)."""
        return EX.public()

    @r.get("/explore")
    async def explore_state(world: str | None = Query(None, max_length=64)) -> dict[str, Any]:
        return await call(EX.state, svc(), world or None)

    @r.get("/city/catalog")
    async def city_catalog() -> dict[str, Any]:
        """şehir haritası kataloğu (semt damgaları, landmarklar, seyir noktaları, duraklar)."""
        return EX.city_public()

    @r.get("/city")
    async def city_state(city: str | None = Query(None, max_length=64)) -> dict[str, Any]:
        """şehir pasaportu ve ziyaret edilmiş duraklar (hızlı seyahat hedefleri)."""
        return await call(EX.city_state, svc(), city or None)

    @r.get("/fish/catalog")
    async def fish_catalog() -> dict[str, Any]:
        """WORLD-FIX: olta kademe/biyom tablosu ve günlük sınırlar (salt okuma)."""
        return FI.public()

    @r.get("/fish")
    async def fish_state() -> dict[str, Any]:
        return await call(FI.state, svc())

    @r.get("/minigame/catalog")
    async def minigame_catalog() -> dict[str, Any]:
        """mini oyun tür tablosu, ortak günlük havuz ve sınırlar (salt okuma; zaman bilgisi yok)."""
        return MG.public()

    @r.get("/minigame")
    async def minigame_state() -> dict[str, Any]:
        """bugünkü ortak mini oyun havuzu (olta dahil) ve bakiye."""
        return await call(MG.state, svc())

    @r.get("/cards")
    async def cards() -> dict[str, Any]:
        return await call(svc().cards)

    # ---------------------------------------------------------------- yazma (yalnız kullanıcı)
    @r.put("/position")
    async def position(data: Any = Body(...)) -> dict[str, Any]:
        return await write(svc().position, data)

    @r.put("/avatar")
    async def avatar(data: Any = Body(...)) -> dict[str, Any]:
        """W5: "Ben" avatarı (kullanıcı-yalnız; MCP 403). Ödülsüz."""
        return await write(svc().put_avatar, data)

    @r.post("/collect")
    async def collect(data: Any = Body(...)) -> dict[str, Any]:
        return await write(svc().collect, data)

    @r.post("/discover")
    async def discover(data: Any = Body(...)) -> dict[str, Any]:
        return await write(svc().discover, data)

    @r.post("/visit")
    async def visit(data: Any = Body(...)) -> dict[str, Any]:
        return await write(svc().visit, data)

    @r.post("/event")
    async def event(data: Any = Body(...)) -> dict[str, Any]:
        return await write(svc().event, data)

    @r.post("/cards")
    async def sync_cards(data: Any = Body(...)) -> dict[str, Any]:
        return await write(svc().sync_cards, data)

    @r.post("/fish/cast")
    async def fish_cast(data: Any = Body(...)) -> dict[str, Any]:
        """WORLD-FIX: olta atışı (kullanıcı-yalnız; MCP 403). Tür ve vuruş anı sunucuda seçilir.
        vuruş anı ve pencere yanıta girmez (`MG.client_view`); istemci vuruşu `/fish/bite` ile öğrenir."""
        return MG.client_view(await write(lambda d: FI.cast(svc(), d), data))

    @r.post("/fish/bite")
    async def fish_bite(data: Any = Body(...)) -> dict[str, Any]:
        """vuruş işareti (kullanıcı-yalnız). Sunucu vuruş anına dek bekler ve `{cue: true}` döner; zaman yok."""
        return await cue(lambda d: MG.fish_cue(svc(), d), data)

    @r.post("/fish/reel")
    async def fish_reel(data: Any = Body(...)) -> dict[str, Any]:
        """WORLD-FIX: çekiş — sonuç ve jeton yalnız sunucu saatinden (istemci miktar iletemez; atış başına tek ödeme)."""
        return await write(lambda d: FI.reel(svc(), d), data)

    @r.post("/minigame/start")
    async def minigame_start(data: Any = Body(...)) -> dict[str, Any]:
        """genel mini oyun turu (kullanıcı-yalnız; MCP 403). Gizli parametreler sunucuda kalır."""
        return await write(lambda d: MG.start(svc(), d), data)

    @r.post("/minigame/cue")
    async def minigame_cue(data: Any = Body(...)) -> dict[str, Any]:
        """genel turun işareti (uzun yoklama; kullanıcı-yalnız)."""
        return await cue(lambda d: MG.cue_due(svc(), d), data)

    @r.post("/minigame/finish")
    async def minigame_finish(data: Any = Body(...)) -> dict[str, Any]:
        """tur sonucu — yargıç ve jeton sunucuda, ortak günlük havuzdan (tavan 30); bitmiş tur 409."""
        return await write(lambda d: MG.finish(svc(), d), data)

    @r.post("/explore")
    async def explore(data: Any = Body(...)) -> dict[str, Any]:
        """WALK-EXPLORE: keşif kaydı (kullanıcı-yalnız; MCP 403). Sunucu katalog, sahiplik, zincir ve idempotentlik uygular."""
        return await write(lambda d: EX.discover(svc(), d), data)

    @r.post("/city")
    async def city_visit(data: Any = Body(...)) -> dict[str, Any]:
        """şehir pasaportu damgası / durak kaydı (kullanıcı-yalnız; MCP 403). Katalog, zincir ve idempotentlik sunucuda."""
        return await write(lambda d: EX.city_visit(svc(), d), data)

    @r.post("/city/seen")
    async def city_seen(data: Any = Body(...)) -> dict[str, Any]:
        """"yeni damga eklendi" bildirimini kapatır (kullanıcı-yalnız; idempotent; ödülsüz)."""
        return await write(lambda d: EX.city_seen_ack(svc(), d), data)

    # ---------------------------------------------------------------- anı defteri (yalnız kullanıcı; ödülsüz)
    @r.get("/rituals")
    async def ritual_book(request: Request) -> dict[str, Any]:
        """anı defteri — şehir başına `{found, total, done, title?}`. Kullanıcının günlüğüdür: MCP okuyamaz (403)."""
        if mcp_client(request) is not None:
            raise HTTPException(403, "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir")
        return await call(RT.book, svc())

    @r.post("/ritual")
    async def ritual(data: Any = Body(...)) -> dict[str, Any]:
        """ritüelin ilk yapılışı anı defterine (kullanıcı-yalnız; MCP 403). Jeton, XP, SP yok; idempotent."""
        return await write(lambda d: RT.record(svc(), d), data)

    return r
