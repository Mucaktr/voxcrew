"""/api/game uç noktaları ve olay aboneliği (Ekip S5).

`start(studio)` uygulama açılışında çağrılır: EventBus'a abone olur, önce `run_events` imlecinden geçmişi
yakalar (kutlamasız), sonra canlı olayları işleyip `game.*` olaylarını yayınlar. `stop` kapanışta tüketiciyi
temizce durdurur. Oyunlaştırma kapalıyken (`game.enabled=false`) hesap sürer; yalnızca arayüz gizlenir.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException, Query

from studio.game import season, spotlight, surprise
from studio.game.service import ConfirmRequired, GameService, InsufficientCoins

if TYPE_CHECKING:
    from studio.api import Studio

log = logging.getLogger("studio.game")
_SETTING_KEYS = ("enabled", "celebrations", "sounds", "show_world_badges")


def get_service(studio: "Studio") -> GameService:
    """Studio başına tek GameService (tembel oluşturulur; testlerde yaşam döngüsü olmadan da çalışır)."""
    svc = getattr(studio, "_game_service", None)
    if svc is None:
        svc = GameService(studio)
        studio._game_service = svc  # type: ignore[attr-defined]
    return svc


def _publish(studio: "Studio", events: list[tuple[str, dict[str, Any]]]) -> None:
    for etype, payload in events:
        studio.bus.publish(etype, **payload)


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/game", tags=["game"])
    S = studio

    def svc() -> GameService:
        return get_service(S)

    async def ensure_quests() -> GameService:
        g = svc()
        facts = await asyncio.to_thread(g.gather_facts)
        await asyncio.to_thread(g.ensure_quests, time.time(), facts)
        return g

    @r.get("/profile")
    async def profile() -> dict[str, Any]:
        return await asyncio.to_thread(svc().profile)

    @r.get("/agents/{slug}")
    async def agent(slug: str) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(svc().agent, slug)
        except KeyError as exc:
            raise HTTPException(404, "Ajan yok") from exc

    @r.post("/agents/{slug}/promotion/dismiss")
    async def dismiss_promotion(slug: str) -> dict[str, Any]:
        await asyncio.to_thread(svc().dismiss_promotion, slug)
        return {"ok": True}

    @r.get("/achievements")
    async def achievements() -> dict[str, Any]:
        return await asyncio.to_thread(svc().achievements)

    @r.post("/achievements/seen")
    async def achievements_seen() -> dict[str, Any]:
        await asyncio.to_thread(svc().mark_seen)
        return {"ok": True}

    @r.get("/quests")
    async def quests() -> dict[str, Any]:
        g = await ensure_quests()
        return await asyncio.to_thread(g.quests)

    @r.post("/quests/{quest_id}/claim")
    async def claim(quest_id: str) -> dict[str, Any]:
        try:
            res = await asyncio.to_thread(svc().claim_quest, quest_id)
        except KeyError as exc:
            raise HTTPException(404, "Görev yok") from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        _publish(S, res.pop("events", []))
        return res

    @r.post("/quests/{quest_id}/swap")
    async def swap(quest_id: str) -> dict[str, Any]:
        g = svc()
        facts = await asyncio.to_thread(g.gather_facts)
        try:
            res = await asyncio.to_thread(g.swap_quest, quest_id, facts)
        except KeyError as exc:
            raise HTTPException(404, "Görev yok") from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        S.bus.publish("game.quest", quest=res["quest"], status="active", swapped=quest_id)
        return res

    @r.get("/shop")
    async def shop() -> dict[str, Any]:
        return await asyncio.to_thread(svc().shop)

    @r.post("/shop/{item_id}/buy")
    async def buy(item_id: str, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        """Jetonla kozmetik/sahne kilidi açar. Açık onay ister: gövdede `confirm: true` yoksa reddedilir."""
        try:
            res = await asyncio.to_thread(svc().buy, item_id, confirm=data.get("confirm") is True,
                                          request_id=str(data.get("client_request_id") or "") or None)
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc
        except (ConfirmRequired, InsufficientCoins, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc
        _publish(S, res.pop("events", []))
        return res

    @r.post("/passport/redeem")
    async def redeem_stamp(data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        """SP-W1: bir pasaport damgasıyla seçilen şehri kalıcı açar (jeton/para yok). Yalnız kullanıcı: MCP istemcisi 403 alır
        (`clients/tracker.py USER_ONLY_RE`); gövdede `confirm: true` yoksa ve yönetici/test modunda reddedilir."""
        scene = data.get("scene")
        if not isinstance(scene, str) or not scene:
            raise HTTPException(400, "Şehir kimliği (scene) gerekli")
        try:
            res = await asyncio.to_thread(svc().redeem_stamp, scene, confirm=data.get("confirm") is True)
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc
        except (ConfirmRequired, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc
        _publish(S, res.pop("events", []))
        return res

    @r.get("/feed")
    async def feed(limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
        return await asyncio.to_thread(svc().feed, limit)

    @r.post("/signal")
    async def signal(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Beyaz listedeki arayüz sinyalleri (context.opened, species.previewed); hız sınırlıdır."""
        try:
            events = await asyncio.to_thread(svc().signal, str(data.get("type") or ""), dict(data.get("data") or {}))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        _publish(S, events)
        return {"ok": True}

    @r.put("/settings")
    async def put_settings(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Kullanıcı-yalnız (FIX-SEC `clients/tracker.py USER_ONLY_RE`). Değerler gerçek boolean olmalı
        (`"false"` metni açık sayılmasın)."""
        keys = (*_SETTING_KEYS, "creative", "focus")
        if any(k in data and not isinstance(data[k], bool) for k in keys):
            raise HTTPException(400, "Oyun ayarları true ya da false olmalı")
        patch = {k: data[k] for k in _SETTING_KEYS if k in data}
        g = svc()
        if patch:
            await asyncio.to_thread(S.settings.update, {"game": patch})
        if "creative" in data:
            await asyncio.to_thread(g.set_creative, bool(data["creative"]))
        if "focus" in data:  # S35 odak modu: oyun katmanları gizlenir, iş KPI'ları kalır
            await asyncio.to_thread(g.set_focus, bool(data["focus"]))
        prof = await asyncio.to_thread(g.profile)
        S.bus.publish("game.settings", **{k: prof[k] for k in (*_SETTING_KEYS, "creative", "focus")})
        return prof

    # ---------------------------------------------------------------- S35 vitrin
    @r.get("/scoreboard")
    async def scoreboard() -> dict[str, Any]:
        """Duvar panosu / dünya kaplaması: iş KPI'ları (run_events, oyundan bağımsız) + ekip seviyesi."""
        return await asyncio.to_thread(spotlight.scoreboard, svc())

    @r.get("/recap")
    async def recap(week: str | None = Query(None, max_length=10)) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(spotlight.recap, svc(), week)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @r.post("/recap/{week}/dismiss")
    async def dismiss_recap(week: str) -> dict[str, Any]:
        try:
            await asyncio.to_thread(spotlight.dismiss_recap, svc(), week)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"ok": True}

    @r.get("/contribution")
    async def contribution(period: str = Query("week", pattern="^(week|all)$")) -> dict[str, Any]:
        """Ekip katkısı: ajanlar ada göre, üstte ekip toplamı; sıralama yok (kullanıcı kararı C-02)."""
        return await asyncio.to_thread(spotlight.contribution, svc(), period)

    # ---------------------------------------------------------------- sezon ve sürpriz kutu
    @r.get("/season")
    async def season_view() -> dict[str, Any]:
        """Sezon yolu: SP, kademeler, ücretsiz + kozmetik premium yol (para düğmesi yok), arşiv, geç kalanlar."""
        g = svc()
        _publish(S, await asyncio.to_thread(season.sync, g))
        return await asyncio.to_thread(season.view, g)

    @r.get("/collection")
    async def collection_view() -> dict[str, Any]:
        """kazanılan sezon öğeleri ve kutu masa süsleri, adlarıyla (dünyada henüz çizilmiyor; salt okunur)."""
        from studio.game import collection  # noqa: PLC0415
        return await asyncio.to_thread(collection.view, svc())

    @r.get("/surprise")
    async def surprise_view() -> dict[str, Any]:
        """Sürpriz teslim kutuları ve kutunun üstünde yazan olasılıklar (yalnız okuma)."""
        return await asyncio.to_thread(surprise.view, svc())

    @r.post("/surprise/{box_id}/open")
    async def surprise_open(box_id: str) -> dict[str, Any]:
        """Kazanılmış ücretsiz kutuyu açar. Bedel yok; açılmış kutu aynı sonucu döndürür (yeniden çekme yok)."""
        try:
            res = await asyncio.to_thread(surprise.open_box, svc(), box_id)
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        _publish(S, res.pop("events", []))
        return res

    @r.get("/export")
    async def export() -> dict[str, Any]:
        return await asyncio.to_thread(svc().export)

    return r


async def _consume(studio: "Studio", g: GameService, q: asyncio.Queue[dict[str, Any]], limit: int) -> None:
    try:
        processed = await asyncio.to_thread(g.catch_up, limit)
        await asyncio.to_thread(g.sync_graph)
        facts = await asyncio.to_thread(g.gather_facts)
        await asyncio.to_thread(g.ensure_quests, time.time(), facts)
        studio.bus.publish("game.sync", replayed=processed)
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001 - yakalama başarısızsa canlı işlemeye devam
        log.exception("oyun geçmişi yakalanamadı")
    last_seq = 0
    gap = False
    last_mark = 0.0
    while True:
        ev = await q.get()
        seq = int(ev.get("seq") or 0)
        if last_seq and seq and seq != last_seq + 1:
            gap = True  # yavaş tüketici: olay düşmüş olabilir → kuyruk boşalınca imleçten yakala
        last_seq = seq or last_seq
        try:
            events = await asyncio.to_thread(g.handle, ev)
            if events:
                _publish(studio, events)
                await asyncio.to_thread(g.flush_graph)
            if q.empty():
                if gap:
                    gap = False
                    await asyncio.to_thread(g.catch_up)
                    await asyncio.to_thread(g.flush_graph)
                elif time.monotonic() - last_mark > 5:
                    g.mark_cursor()  # senkron: araya yeni olay giremez
                    last_mark = time.monotonic()
                if g.quests_stale():
                    facts = await asyncio.to_thread(g.gather_facts)
                    await asyncio.to_thread(g.ensure_quests, time.time(), facts)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("oyun olayı işlenemedi")


async def start(studio: "Studio") -> None:
    if getattr(studio, "_game_task", None) is not None:
        return
    try:
        g = await asyncio.to_thread(get_service, studio)
    except Exception:  # noqa: BLE001 - oyun başlatılamazsa stüdyo yine açılır
        log.exception("oyunlaştırma başlatılamadı")
        return
    # Abonelik ve yakalama sınırı aynı anda (arada await yok): sınırdan önceki olaylar geçmişten sessizce,
    # sonrakiler canlı kuyruktan kutlamalı işlenir; ikisi örtüşse de anahtarlar sayesinde iki kez sayılmaz.
    # Yönetici modu (ör. ortam değişkeniyle) kapalı açıldıysa, modla seçilmiş kilitli sahne kalıntı bırakmaz (AUDIT B-04)
    try:
        from studio import admin

        if not admin.is_active(studio.settings):
            await asyncio.to_thread(admin._restore_scene, studio)
    except Exception:  # noqa: BLE001 - sahne geri dönüşü açılışı engellemesin
        log.exception("yönetici modu sahne geri dönüşü yapılamadı")
    q = studio.bus.subscribe()
    limit = g.max_rowid()
    studio._game_queue = q  # type: ignore[attr-defined]
    studio._game_task = asyncio.create_task(_consume(studio, g, q, limit), name="game-consumer")  # type: ignore[attr-defined]


async def stop(studio: "Studio") -> None:
    task = getattr(studio, "_game_task", None)
    if task is not None:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        studio._game_task = None  # type: ignore[attr-defined]
    q = getattr(studio, "_game_queue", None)
    drained = q is None or q.empty()
    if q is not None:
        studio.bus.unsubscribe(q)
        studio._game_queue = None  # type: ignore[attr-defined]
    svc = getattr(studio, "_game_service", None)
    if svc is not None:
        if drained:  # işlenmemiş olay kaldıysa imleç ilerlemez; sonraki açılışta yakalanır
            try:
                svc.mark_cursor()
            except Exception:  # noqa: BLE001
                pass
        svc.close()
        studio._game_service = None  # type: ignore[attr-defined]
