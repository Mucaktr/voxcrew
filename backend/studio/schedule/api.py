"""/api/schedules ve /api/triggers/{id} uç noktaları — Ekip S25.

| Uç | Açıklama |
|---|---|
| `GET /api/schedules` | `{schedules: [...], enabled, tick_s, running}` (S24 MCP `list_schedules` bu şekli kullanır) |
| `GET /api/schedules/{id}` | zamanlama + son koşular (`recent_runs`) |
| `POST /api/schedules` | oluştur; webhook ise yanıtta düz `token` BİR KEZ döner |
| `PATCH /api/schedules/{id}` | alan güncelle (aç/kapa dahil) |
| `DELETE /api/schedules/{id}` | sil |
| `POST /api/schedules/{id}/run` | şimdi çalıştır (eşzamanlılık politikasına uyar) |
| `POST /api/schedules/{id}/token` | webhook jetonunu yenile (düz jeton bir kez döner) |
| `POST /api/triggers/{id}` | webhook: yalnızca loopback, `Origin` başlığı varsa 403, `X-Trigger-Token` sabit zamanlı karşılaştırma |
| `GET /api/schedules/sources` | CG2: e-posta/takvim tetikleyicisine uygun MCP sunucuları (önbellekten; süreç başlatmaz) |
| `POST /api/schedules/sources/{server}/events` | CG2: toplantı seçmek için yakın etkinlikler (salt-okuma aracı; yalnız arayüz) |

Güvenlik: `X-Studio-Client` başlıklı istemciler (MCP, hook, CLI) zamanlamaları yalnızca LİSTELEYEBİLİR; oluşturma,
düzenleme, silme, çalıştırma ve jeton yenileme 403 (zamanlanmış koşu içinden zamanlama oluşturulamaz).
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException, Request

from studio.ontology import OntologyError
from studio.schedule import triggers
from studio.schedule.runner import ScheduleRunner
from studio.schedule.service import ScheduleError, ScheduleService

if TYPE_CHECKING:
    from studio.api import Studio

LOOPBACK_CLIENTS = {"127.0.0.1", "::1", "localhost"}
MAX_TRIGGER_BODY = 64 * 1024
TOKEN_HEADER = "x-trigger-token"


class ScheduleRuntime:
    def __init__(self, studio: "Studio"):
        self.service = ScheduleService(studio)
        self.runner = ScheduleRunner(studio, self.service)


def get_runtime(studio: "Studio") -> ScheduleRuntime:
    rt = getattr(studio, "_schedule_runtime", None)
    if rt is None:
        rt = ScheduleRuntime(studio)
        setattr(studio, "_schedule_runtime", rt)
    return rt


def _user_only(request: Request) -> None:
    if (request.headers.get("x-studio-client") or "").strip():
        raise HTTPException(403, "Zamanlamalar yalnızca uygulama arayüzünden değiştirilebilir; "
                                 "MCP ve diğer istemciler yalnızca listeleyebilir")


def _guard(fn: Any) -> Any:
    try:
        return fn()
    except KeyError as exc:
        raise HTTPException(404, str(exc).strip("'")) from exc
    except (ScheduleError, OntologyError) as exc:
        raise HTTPException(400, str(exc)) from exc


async def _trigger_body(request: Request) -> dict[str, Any]:
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_TRIGGER_BODY:
        raise HTTPException(413, "Gövde çok büyük (en fazla 64 KB)")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_TRIGGER_BODY:
            raise HTTPException(413, "Gövde çok büyük (en fazla 64 KB)")
    if not body.strip():
        return {}
    try:
        data = json.loads(bytes(body))
    except ValueError:
        raise HTTPException(400, "Gövde geçerli JSON değil") from None
    if not isinstance(data, dict):
        raise HTTPException(400, "Gövde bir JSON nesnesi olmalı")
    return data


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(tags=["schedule"])
    rt = get_runtime(studio)
    svc, runner = rt.service, rt.runner

    @r.get("/api/schedules")
    def list_schedules() -> dict[str, Any]:
        return {"schedules": svc.list(), "enabled": runner.enabled(), "tick_s": runner.tick_s(),
                "running": runner.running()}

    @r.get("/api/schedules/sources")
    def trigger_sources() -> dict[str, Any]:
        """CG2: e-posta etiketi / toplantı bitişi için kullanılabilecek MCP sunucuları ve seçilecek okuma aracı."""
        return {"sources": triggers.mcp_sources(studio), "folder_debounce_s": triggers.FOLDER_DEFAULT_DEBOUNCE_S,
                "mcp_every_s": {"min": triggers.MCP_MIN_EVERY_S, "default": triggers.MCP_DEFAULT_EVERY_S}}

    @r.post("/api/schedules/sources/{server}/events")
    async def trigger_events(server: str, request: Request) -> dict[str, Any]:
        """CG2: kullanıcı bir toplantı seçsin diye ±12 saatlik etkinlikler (salt-okuma; MCP istemcisi çağıramaz)."""
        _user_only(request)
        now = triggers.datetime.now().astimezone()
        try:
            res = await triggers.call_read_tool(studio, server, "calendar", {}, now)
        except triggers.TriggerError as exc:
            raise HTTPException(424, str(exc)) from exc
        events = sorted(triggers.parse_events(res["result"]), key=lambda e: e["end"])
        return {"tool": res["tool"], "events": [
            {"id": e["id"], "title": e["title"] or e["id"], "start": e["start"].isoformat() if e.get("start") else None,
             "end": e["end"].isoformat()} for e in events[:50]]}

    @r.get("/api/schedules/{sid}")
    def get_schedule(sid: str) -> dict[str, Any]:
        return _guard(lambda: svc.get(sid))

    @r.post("/api/schedules")
    async def create_schedule(request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        _user_only(request)
        sched, token = _guard(lambda: svc.create(data, created_by="ui"))
        if sched["kind"] == "file_watch":
            runner.prime(svc.node(sched["id"]))
        studio.bus.publish("schedule.changed", schedule_id=sched["id"], schedule=sched, created=True)
        return {**sched, **({"token": token} if token else {})}

    @r.patch("/api/schedules/{sid}")
    async def update_schedule(sid: str, request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        _user_only(request)
        sched, token = _guard(lambda: svc.update(sid, data))
        if not sched.get("enabled"):
            runner.drop_queued(sid)  # kapatılan zamanlamanın sıradaki tetikleri atılır
        if sched["kind"] == "file_watch" and ("spec" in data or "kind" in data or data.get("enabled") is True):
            runner.prime(svc.node(sid))
        studio.bus.publish("schedule.changed", schedule_id=sid, schedule=sched)
        return {**sched, **({"token": token} if token else {})}

    @r.delete("/api/schedules/{sid}")
    async def delete_schedule(sid: str, request: Request) -> dict[str, Any]:
        _user_only(request)
        _guard(lambda: svc.delete(sid))
        runner.queues.pop(sid, None)
        runner.watch.pop(sid, None)
        runner.pending.pop(sid, None)
        svc.live.pop(sid, None)
        studio.bus.publish("schedule.changed", schedule_id=sid, deleted=True)
        return {"ok": True, "id": sid}

    @r.post("/api/schedules/{sid}/run")
    async def run_schedule(sid: str, request: Request) -> dict[str, Any]:
        _user_only(request)
        _guard(lambda: svc.node(sid))
        res = await runner.run_now(sid)
        return {"ok": bool(res.get("run_id") or res.get("queued")), **res}

    @r.post("/api/schedules/{sid}/token")
    async def regenerate_token(sid: str, request: Request) -> dict[str, Any]:
        _user_only(request)
        sched, token = _guard(lambda: svc.regenerate_token(sid))
        studio.bus.publish("schedule.changed", schedule_id=sid, schedule=sched)
        return {**sched, "token": token}

    @r.post("/api/triggers/{sid}")
    async def trigger(sid: str, request: Request) -> dict[str, Any]:
        # external/api.py alım kurallarıyla aynı: tarayıcıdan (Origin) yok, yalnızca yerel istemci
        if request.headers.get("origin") is not None:
            raise HTTPException(403, "Origin başlıklı istek reddedildi: tetikleyici yalnızca yerel araçlardan çağrılır")
        host = request.client.host if request.client else ""
        if host not in LOOPBACK_CLIENTS:
            raise HTTPException(403, "Tetikleyici yalnızca yerel (loopback) istemcileri kabul eder")
        node = studio.store.find("Schedule", sid)
        if not node or node["props"].get("kind") != "webhook":
            raise HTTPException(403, "Geçersiz tetikleyici ya da erişim anahtarı")
        if not svc.check_token(node, request.headers.get(TOKEN_HEADER)):
            raise HTTPException(403, "Geçersiz tetikleyici ya da erişim anahtarı")
        if not node["props"].get("enabled"):
            raise HTTPException(409, "Zamanlama kapalı")
        if not runner.enabled():  # zamanlayıcı ayarlarda kapalıyken webhook da tetiklemez
            raise HTTPException(409, "Zamanlayıcı ayarlarda kapalı")
        payload = await _trigger_body(request)
        res = await runner.run_now(sid, reason="webhook", payload=payload or None)
        return {"ok": bool(res.get("run_id") or res.get("queued")), **res}

    return r


async def start(studio: "Studio") -> None:
    """Açılışta: olay aboneliği (gözetimsiz onay politikası), kaçan tetikler ve tick döngüsü."""
    await get_runtime(studio).runner.start()


async def stop(studio: "Studio") -> None:
    """Kapanışta: tick döngüsü ve olay tüketicisi temizce durur."""
    await get_runtime(studio).runner.stop()
