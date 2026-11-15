"""/api/goals uç noktaları ve olay aboneliği — Ekip S10.

- `GET /api/goals?level=&owner=` hedef ağacı (kökler; alt hedefler `children` içinde)
- `GET /api/goals/{id}` tek hedef: alt ağaç, üst zincir (`ancestors`), bağlı koşular
- `POST /api/goals` tek hedef
- `POST /api/goals/bulk` `{text | items[], level?, owner_team?, owner_agent?, parent?, dry_run?}`
- `PATCH /api/goals/{id}` · `DELETE /api/goals/{id}` (alt hedefler üst hedefe bağlanır)
- `POST /api/goals/{id}/launch` `{root_agent?, options?, title?, project?}` → S6 `engine.start_delegation`
  (koşu hedefin `project` bellek ad alanında; gövdedeki `project` geçersiz kılar. Hedef gövdeleri de
  `project` alır: proje anahtarı | `project:<k>` | `global`/boş)
- `POST /api/goals/{id}/kr/{kr_id}` `{current?, done?, title?, target?, unit?}`

`start(studio)` / `stop(studio)`: olay yoluna abone olur; `goal.run_finished` (S6) gelince hedefin durumunu ve
ilerlemesini günceller. Uygulama yaşam döngüsüne bağlanması teknik liderdedir (main.py).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import weakref
from typing import TYPE_CHECKING, Any, Callable

from fastapi import APIRouter, Body, HTTPException, Query, Request

from studio.goals.parser import BulkParseError
from studio.goals.service import EngineUnavailable, GoalError, GoalService
from studio.ontology import OntologyError

if TYPE_CHECKING:
    from studio.api import Studio

log = logging.getLogger(__name__)

_services: "weakref.WeakKeyDictionary[Any, GoalService]" = weakref.WeakKeyDictionary()
_consumers: "weakref.WeakKeyDictionary[Any, tuple[asyncio.Queue[dict[str, Any]], asyncio.Task[None]]]" = \
    weakref.WeakKeyDictionary()


def service_for(studio: "Studio") -> GoalService:
    """Stüdyo başına tek hedef servisi (router ve olay tüketicisi aynı nesneyi paylaşır)."""
    svc = _services.get(studio)
    if svc is None:
        svc = _services[studio] = GoalService(studio)
    return svc


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, EngineUnavailable):
        return HTTPException(503, str(exc))
    if isinstance(exc, BulkParseError):
        return HTTPException(400, {"message": str(exc), "errors": exc.errors})
    if isinstance(exc, GoalError):
        return HTTPException(400, {"message": str(exc), "errors": exc.errors} if exc.errors else str(exc))
    if isinstance(exc, KeyError):
        return HTTPException(404, str(exc).strip("'\""))
    return HTTPException(400, str(exc))


def _guard(fn: Callable[[], Any]) -> Any:
    try:
        return fn()
    except (EngineUnavailable, GoalError, KeyError, ValueError, OntologyError) as exc:
        raise _http(exc) from exc


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/goals", tags=["goals"])
    svc = service_for(studio)

    @r.get("")
    def list_goals(level: str | None = Query(None), owner: str | None = Query(None)) -> list[dict[str, Any]]:
        return _guard(lambda: svc.tree(level or None, (owner or "").strip() or None))

    @r.get("/{goal_id}")
    def get_goal(goal_id: str) -> dict[str, Any]:
        return _guard(lambda: svc.detail(goal_id))

    @r.post("")
    async def create_goal(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return _guard(lambda: svc.create(data))

    @r.post("/bulk")
    async def bulk_goals(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        return _guard(lambda: svc.bulk(data))

    @r.patch("/{goal_id}")
    async def update_goal(goal_id: str, request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        from studio.api import request_actor  # tamamlamayı kimin yaptığı goal.completed olayına yazılır
        by = request_actor(request)
        return _guard(lambda: svc.update(goal_id, data, by=by))

    @r.delete("/{goal_id}")
    async def delete_goal(goal_id: str) -> dict[str, Any]:
        return _guard(lambda: svc.delete(goal_id))

    @r.post("/{goal_id}/launch")
    async def launch_goal(goal_id: str, request: Request, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        from studio.api import run_origin  # QA-F3 m1: MCP'den başlatılan hedef koşusu kökenini korur
        from studio.api import request_actor  # hedef koşusunu kullanıcı mı başlattı
        from studio.workflow import idem  # noqa: PLC0415 — G1-B: gönderim idempotency'si
        by = request_actor(request)
        raw = data
        if isinstance(data, dict):
            data = {**data, "origin": run_origin(data, request)}

        async def start() -> dict[str, Any]:
            try:
                return await svc.launch(goal_id, data, by=by)
            except (EngineUnavailable, GoalError, KeyError, ValueError, OntologyError) as exc:
                raise _http(exc) from exc

        return await idem.guarded(studio.settings, request, f"goal:{goal_id}", raw, start)

    @r.post("/{goal_id}/kr/{kr_id}")
    async def update_key_result(goal_id: str, kr_id: str, request: Request,
                                data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        from studio.api import request_actor
        by = request_actor(request)
        return _guard(lambda: svc.update_kr(goal_id, kr_id, data, by=by))

    return r


# ---------------------------------------------------------------------- yaşam döngüsü (olay aboneliği)
async def _consume(svc: GoalService, queue: "asyncio.Queue[dict[str, Any]]") -> None:
    while True:
        event = await queue.get()
        try:
            svc.handle_event(event)
        except Exception:  # noqa: BLE001 - tek bir bozuk olay tüketiciyi durdurmamalı
            log.exception("Hedef olayı işlenemedi: %s", event.get("type"))


async def start(studio: "Studio") -> None:
    """EventBus'a abone olur (idempotent). Uygulama açılışında çağrılır."""
    if studio in _consumers:
        return
    svc = service_for(studio)
    queue = studio.bus.subscribe()
    task = asyncio.create_task(_consume(svc, queue), name="goals-events")
    _consumers[studio] = (queue, task)


async def stop(studio: "Studio") -> None:
    """Aboneliği kapatır. Uygulama kapanışında çağrılır."""
    item = _consumers.pop(studio, None)
    if not item:
        return
    queue, task = item
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    studio.bus.unsubscribe(queue)
