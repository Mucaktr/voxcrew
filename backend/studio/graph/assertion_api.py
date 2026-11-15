"""Bellek iddiası uçları. `api.build_router` içinden `register(r, S)` ile eklenir.

| Uç | İş |
|---|---|
| `GET /api/memory/facts?project=&recorded_at=&valid_at=&include_private=` | iki eksenli zaman sorgusu (AW-T02) |
| `POST /api/memory/user-facts` | kullanıcı beyanı (`user_stated`, `trusted`, ortak; hemen hatırlanır) |
| `POST /api/memory/facts/{id}/verify` | doğrula (`verified` yalnız kullanıcı) |
| `POST /api/memory/facts/{id}/dispute` | itiraz et (`disputed`; isteğe bağlı karşı iddia + `CONTRADICTS`) |
| `POST /api/memory/facts/{id}/correct` | düzelt (eski `invalid` kalır, `CORRECTS`) |
| `POST /api/memory/facts/{id}/supersede` | dünyada değişti (eski `superseded`, `SUPERSEDES`) |
| `POST /api/memory/facts/{id}/promote` | özel notu ortak belleğe taşı (`manual` kip ya da kullanıcı isteği) |
| `GET /api/memory/facts/{id}/history` | sürüm / çelişki / terfi zinciri |

Yazma uçlarının hepsi kullanıcıya aittir: `clients/tracker.py USER_ONLY_RE` (`memory/user-facts$`,
`memory/facts/<id>/(verify|dispute|correct|supersede|promote)$`) sunum katmanında MCP'ye 403 verir ve arayüz jetonu ister;
rota ayrıca MCP istemcisini kendisi de reddeder (savunma derinliği). Gövdede `expected_version` verilirse beklenen sürüme
karşı yazılır; uyuşmazlık 409.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, Callable

from fastapi import APIRouter, Body, HTTPException, Request

from studio.clients.tracker import mcp_client
from studio.graph import assertion as asn
from studio.graph import namespace as nsm
from studio.ontology import OntologyError

if TYPE_CHECKING:
    from studio.api import Studio


def _run(fn: Callable[[], Any]) -> Any:
    try:
        return fn()
    except asn.AssertionConflict as exc:
        raise HTTPException(409, {"message": str(exc), "expected": exc.expected, "current": exc.actual}) from exc
    except asn.AssertionDenied as exc:
        raise HTTPException(403, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, str(exc).strip("'")) from exc
    except (ValueError, OntologyError) as exc:
        raise HTTPException(400, str(exc)) from exc


def register(r: APIRouter, S: "Studio") -> None:
    def actor(request: Request) -> str:
        if mcp_client(request):
            raise HTTPException(403, asn.ERR_USER_ONLY)
        return "user"

    def ns_of(data: dict[str, Any]) -> str | None:
        raw = data.get("project")
        return None if raw in (None, "") else _run(lambda: S.memory.namespace(raw))

    def publish(node: dict[str, Any] | None, op: str) -> None:
        if node:
            S.bus.publish("memory.fact", fact=node, changed=True, by="user", op=op)

    @r.get("/memory/facts")
    def facts_query(request: Request, project: str | None = None, recorded_at: str | None = None,
                    valid_at: str | None = None, include_private: bool = False) -> dict[str, Any]:
        if mcp_client(request):
            include_private = False  # R-1 "özel: yalnız o ajan + kullanıcı" — MCP özel notu okumaz
        ns = _run(lambda: S.memory.namespace(project or "global"))
        rec = _run(lambda: asn._iso(recorded_at))  # noqa: SLF001
        val = _run(lambda: asn._iso(valid_at))  # noqa: SLF001
        items = asn.facts_as_of(S.store, ns, recorded_at=rec, valid_at=val, include_private=include_private)
        return {"namespace": ns, "recorded_at": rec, "valid_at": val, "items": items,
                "shared_write": S.memory.shared_write}

    @r.post("/memory/user-facts")
    async def fact_add(request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        by = actor(request)
        ns = _run(lambda: S.memory.namespace(data.get("project") or "global"))
        _run(lambda: nsm.reject_reserved(ns))  # matrisin ayrılmış öneki (400)
        node = await asyncio.to_thread(lambda: _run(lambda: asn.add_user_fact(
            S.store, str(data.get("statement") or ""), ns, valid_from=data.get("valid_from"),
            valid_to=data.get("valid_to"), by=by)))
        publish(node, "add")
        return node

    @r.post("/memory/facts/{fact_id}/verify")
    async def fact_verify(fact_id: str, request: Request, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        by = actor(request)
        ns = ns_of(data)
        node = await asyncio.to_thread(lambda: _run(lambda: asn.verify(
            S.store, fact_id, by=by, expected_version=data.get("expected_version"), namespace=ns)))
        publish(node, "verify")
        return node

    @r.post("/memory/facts/{fact_id}/dispute")
    async def fact_dispute(fact_id: str, request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        by = actor(request)
        ns = ns_of(data)
        out = await asyncio.to_thread(lambda: _run(lambda: asn.dispute(
            S.store, fact_id, by=by, reason=str(data.get("reason") or ""), statement=data.get("statement"),
            expected_version=data.get("expected_version"), namespace=ns)))
        publish(out.get("fact"), "dispute")
        return out

    def _replace(op: str) -> Callable[..., Any]:
        fn = asn.correct if op == "correct" else asn.supersede

        async def handler(fact_id: str, request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
            by = actor(request)
            ns = ns_of(data)
            out = await asyncio.to_thread(lambda: _run(lambda: fn(
                S.store, fact_id, by=by, statement=str(data.get("statement") or ""),
                valid_from=data.get("valid_from"), valid_to=data.get("valid_to"),
                expected_version=data.get("expected_version"), namespace=ns)))
            publish(out.get("new") or out.get("old"), op)
            return out
        return handler

    r.add_api_route("/memory/facts/{fact_id}/correct", _replace("correct"), methods=["POST"])
    r.add_api_route("/memory/facts/{fact_id}/supersede", _replace("supersede"), methods=["POST"])

    @r.post("/memory/facts/{fact_id}/promote")
    async def fact_promote(fact_id: str, request: Request, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        by = actor(request)
        ns = ns_of(data)
        node = await asyncio.to_thread(lambda: _run(lambda: asn.promote_fact(S.store, fact_id, by=by, namespace=ns)))
        publish(node, "promote")
        return node

    @r.get("/memory/facts/{fact_id}/history")
    def fact_history(fact_id: str, request: Request) -> dict[str, Any]:
        items = _run(lambda: asn.history(S.store, fact_id))
        if mcp_client(request):  # özel (kabul edilmemiş) sürümler MCP'ye listelenmez
            items = [i for i in items if i.get("visibility") != "private"]
        return {"id": fact_id, "items": items}
