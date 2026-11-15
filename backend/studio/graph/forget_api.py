"""Unutma uçları. `api.build_router` içinden `register(r, S)` ile eklenir.

| Uç | İş |
|---|---|
| `POST /api/memory/forget/plan` `{scope: fact\\|episode\\|project, id?, project?, tokens?, extra_terms?, unscoped?, amounts?}` | önizleme (hiçbir şey yazmaz); `tokens` seçili jetonlar (yoksa varsayılan), `extra_terms` kullanıcı terimleri; `unscoped` içeride de karartılmayacak işaretsiz terimler; `amounts` tutar biçimiyle de eşleşecek sayısal terimler; yanıtta `remains`, `separator_matches` (`outcome` redact/delete), `amount_matches`, `other_projects` |
| (uygula yanıtı) | `remains` uygulamadan SONRAKİ doğrulama taramasından (bütün kayıt türleri, kavramlar dahil; etiketsiz), `verified`, `other_projects`, `message {tr, en}`; günlüğe yalnız sayılar yazılır |
| `POST /api/memory/forget/plans/{plan_id}/apply` `{confirm: true, stop_runs?: true}` | yedek → uygula → mezar kaydı; kapsamda süren koşu varsa 409, `stop_runs` önce onları durdurur |
| `POST /api/memory/forget/{change_id}/undo` `{confirm: true}` | pencere içinde yedekten geri al |
| `POST /api/memory/forget/reapply` | mezar kayıtlarını yeniden uygula (geri yükleme / içe aktarma sonrası) |
| `GET /api/memory/forget/history` | unutma kayıtları (içerik yok: kimlik, kapsam, sayılar) |

Yazma uçları kullanıcıya aittir: `clients/tracker.py USER_ONLY_RE` (`memory/forget/`) MCP'ye 403 verir ve başlıksız
yerel süreçten arayüz jetonu ister; rota ayrıca MCP istemcisini kendisi de reddeder (savunma derinliği).
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import TYPE_CHECKING, Any, Callable

from fastapi import APIRouter, Body, HTTPException, Request

from studio.clients.tracker import mcp_client
from studio.graph import forget as fg
from studio.ontology import OntologyError

if TYPE_CHECKING:
    from studio.api import Studio


def _run(fn: Callable[[], Any]) -> Any:
    try:
        return fn()
    except fg.ForgetBusy as exc:  # kapsamda süren koşu
        raise HTTPException(409, str(exc)) from exc
    except fg.ForgetDenied as exc:
        raise HTTPException(403, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, str(exc).strip("'\"")) from exc
    except (ValueError, OntologyError) as exc:
        raise HTTPException(400, str(exc)) from exc


def _strings(raw: Any) -> list[str]:
    """İstek gövdesindeki terim listesi (yalnız kısa metinler; en çok `MAX_TOKENS`)."""
    if not isinstance(raw, list):
        return []
    return [str(x)[:120] for x in raw if isinstance(x, str) and x.strip()][:fg.MAX_TOKENS]


async def _stop_runs(S: "Studio", ids: list[str], timeout_s: float = 20.0) -> bool:
    """koşuları iptal eder ve bitmelerini bekler (True = hepsi bitti)."""
    engine = S.engine
    for rid in ids:
        try:
            engine.cancel(rid)
        except (KeyError, ValueError):
            pass
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout_s
    while loop.time() < end:
        live = [engine.runs.get(rid) for rid in ids]
        if all(r is None or (str(r.status) in fg.RUN_FINAL and (r.task is None or r.task.done())) for r in live):
            return True
        await asyncio.sleep(0.05)
    return False


def register(r: APIRouter, S: "Studio") -> None:
    svc = fg.service_for(S)  # yazma kapısı ve motor kancası şimdi kurulur

    def actor(request: Request) -> str:
        if mcp_client(request):
            raise HTTPException(403, fg.ERR_USER_ONLY)
        return "user"

    @r.post("/memory/forget/plan")
    async def forget_plan(request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        by = actor(request)
        scope = str(data.get("scope") or "")
        target = data.get("id")
        project = data.get("project")
        tokens = _strings(data.get("tokens")) if data.get("tokens") is not None else None
        extra = _strings(data.get("extra_terms"))
        unscoped = _strings(data.get("unscoped"))  # içeride de karartılmayacak işaretsiz terimler
        amounts = _strings(data.get("amounts"))  # tutar biçimiyle ("900.000 TL") de eşleşecek sayısal terimler
        return await asyncio.to_thread(lambda: _run(lambda: svc.plan(
            scope, str(target) if target else None, str(project) if project else None, by=by, tokens=tokens,
            extra_terms=extra, unscoped=unscoped, amounts=amounts)))

    @r.post("/memory/forget/plans/{plan_id}/apply")
    async def forget_apply(plan_id: str, request: Request, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        by = actor(request)
        confirm = data.get("confirm") is True
        ns = svc.plan_namespace(plan_id)
        # durdurma + uygulama boyunca ad alanında yeni koşu başlamaz (kapı motor girişlerinde bekletir)
        with svc.start_gate(ns) if ns else contextlib.nullcontext():
            if confirm and data.get("stop_runs") is True:  # "bu koşuları durdur ve unut" (yalnız kullanıcı)
                ids = await asyncio.to_thread(lambda: _run(lambda: svc.busy_runs(plan_id)))
                if not await _stop_runs(S, ids):
                    raise HTTPException(409, fg.ERR_STILL_ACTIVE)
            return await asyncio.to_thread(lambda: _run(lambda: svc.apply(plan_id, confirm, by=by, active="refuse")))

    @r.post("/memory/forget/reapply")
    async def forget_reapply(request: Request) -> dict[str, Any]:
        actor(request)
        return await asyncio.to_thread(lambda: _run(lambda: svc.reapply(force=True)))

    @r.post("/memory/forget/{change_id}/undo")
    async def forget_undo(change_id: str, request: Request, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        by = actor(request)
        return await asyncio.to_thread(lambda: _run(lambda: svc.undo(change_id, data.get("confirm") is True, by=by)))

    @r.get("/memory/forget/history")
    def forget_history(request: Request, limit: int = 50) -> dict[str, Any]:
        # geçmiş içeriksizdir (kimlik, kapsam, sayılar) ama kullanıcının kararıdır: MCP 403. Başlıksız yerel
        # okuma açık kalır (tarayıcı aynı köken GET'te kimlik gösteremez; içerik yok).
        actor(request)
        return {"items": svc.history(max(1, min(500, int(limit)))), "undo_window_s": fg.UNDO_WINDOW_S}
