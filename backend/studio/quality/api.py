"""Kalite kapısı uçları (CG-QUALITY). Okuma herkese (MCP dahil); her yazma yalnızca kullanıcıdan (USER_ONLY_RE
`quality/` + burada `ui_present` — ajan/MCP kapıyı geçemez, bulguyu yanlış-pozitif sayamaz, "yine de kabul" diyemez).

| Uç | Gövde | Yanıt |
|---|---|---|
| `GET /api/quality/deliverables/{id}` | — | `{report: QualityReport|null, gate: {internal, external}}` |
| `GET /api/quality/deliverables/{id}/reviewer` | — | `{brain, model, label, local, estimate}` (CG-COST varsa maliyet) |
| `POST /api/quality/deliverables/{id}/assess` | `{reviewer?, run_check?}` | `{ok, report}` · MCP 403 |
| `POST /api/quality/deliverables/{id}/accept` | `{reason?}` | `{ok, report}` · MCP 403 |
| `POST /api/quality/deliverables/{id}/accept/revoke` | — | `{ok, report}` · MCP 403 |
| `POST /api/quality/deliverables/{id}/findings/{fid}` | `{false_positive: bool}` | `{ok, report}` · MCP 403 |
| `POST /api/quality/deliverables/{id}/revise` | `{note?}` | `{ok, run_id, forked_from, step_id}` · MCP 403 |
| `GET /api/quality/settings` | — | `{enabled, gate, gate_external, block_on_fail, reviewer}` |
| `PUT /api/quality/settings` | `{block_on_fail?: bool, reviewer?: bool}` | aynı görünüm · MCP 403 (FOLLOWUP: arayüz anahtarları) |
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, Callable

from fastapi import APIRouter, HTTPException, Request

from studio.quality.service import QualityError, get_service

if TYPE_CHECKING:
    from studio.api import Studio

USER_ONLY = "Kalite kararları yalnızca uygulama arayüzünden, kullanıcı tarafından verilebilir"


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(tags=["quality"])

    def user_only(request: Request) -> None:
        from studio.presence import ui_present
        if not ui_present(request):
            raise HTTPException(403, USER_ONLY)

    def guard(fn: Callable[[], Any]) -> Any:
        try:
            return fn()
        except QualityError as exc:
            raise HTTPException(exc.status, exc.detail) from exc
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc

    async def body(request: Request) -> dict[str, Any]:
        try:
            data = await request.json()
        except ValueError:
            data = None
        if data is None:
            return {}
        if not isinstance(data, dict):
            raise HTTPException(400, "Gövde bir nesne olmalı")
        return data

    def view(did: str) -> dict[str, Any] | None:
        return get_service(studio).view(did)

    def settings_out() -> dict[str, Any]:
        svc = get_service(studio)
        ext = svc.gate_mode("external")
        return {"enabled": svc.enabled(), "gate": svc.gate_mode("internal"), "gate_external": ext,
                "block_on_fail": ext == "block", "reviewer": studio.settings.get("quality.reviewer", {})}

    @r.get("/api/quality/settings")
    def settings_view() -> dict[str, Any]:
        return settings_out()

    @r.put("/api/quality/settings")
    async def settings_put(request: Request) -> dict[str, Any]:
        """FOLLOWUP: arayüz anahtarları. `block_on_fail` = başarısız çıktının dış teslimi engellensin mi
        (`quality.gate_external` block ↔ warn); `reviewer` = AI denetçi varsayılan açık mı (`quality.reviewer.enabled`).
        Yalnızca kullanıcı (USER_ONLY_RE `quality/` + `ui_present`): MCP/ajan kapıyı gevşetemez."""
        user_only(request)
        data = await body(request)
        patch: dict[str, Any] = {}
        for key in ("block_on_fail", "reviewer"):
            if key in data and not isinstance(data[key], bool):
                raise HTTPException(400, f"{key} true/false olmalı")
        if "block_on_fail" in data:
            patch["gate_external"] = "block" if data["block_on_fail"] else "warn"
        if "reviewer" in data:
            patch["reviewer"] = {"enabled": data["reviewer"]}
        if patch:
            await asyncio.to_thread(studio.settings.update, {"quality": patch})
            bus = getattr(studio, "bus", None)
            if bus is not None:
                bus.publish("config.changed", change={"setting": "quality"})
        return settings_out()

    @r.get("/api/quality/deliverables/{did}")
    async def get_report(did: str) -> dict[str, Any]:
        svc = get_service(studio)
        rep = await asyncio.to_thread(lambda: guard(lambda: svc.view(did)))
        if rep is None:  # eski (kalite kapısından önceki) çıktı: ilk okumada deterministik denetim
            if not studio.store.find("Deliverable", did):
                raise HTTPException(404, f"Çıktı yok: {did}")
            if svc.enabled():
                await asyncio.to_thread(lambda: guard(lambda: svc.assess(did)))
                rep = view(did)
        return {"report": rep, "gate": {"internal": svc.gate_mode("internal"), "external": svc.gate_mode("external")}}

    @r.get("/api/quality/deliverables/{did}/reviewer")
    async def reviewer_plan(did: str) -> dict[str, Any]:
        svc = get_service(studio)
        return await asyncio.to_thread(lambda: guard(lambda: svc.review_plan(did)))

    @r.post("/api/quality/deliverables/{did}/assess")
    async def reassess(did: str, request: Request) -> dict[str, Any]:
        user_only(request)
        data = await body(request)
        for key in ("reviewer", "run_check"):
            if key in data and not isinstance(data[key], bool):
                raise HTTPException(400, f"{key} true/false olmalı")
        svc = get_service(studio)
        rep = await asyncio.to_thread(lambda: guard(lambda: svc.assess(did, force=True)))
        if rep is None:
            raise HTTPException(400, "Bu çıktı metin içermiyor; kalite denetimi yapılamaz")
        if data.get("run_check"):
            await svc.run_check(did)
        if data.get("reviewer"):
            await svc.review(did)
        return {"ok": True, "report": view(did)}

    @r.post("/api/quality/deliverables/{did}/accept")
    async def accept(did: str, request: Request) -> dict[str, Any]:
        user_only(request)
        data = await body(request)
        reason = data.get("reason", "")
        if not isinstance(reason, str):
            raise HTTPException(400, "reason metin olmalı")
        svc = get_service(studio)
        guard(lambda: svc.accept_anyway(did, reason))
        return {"ok": True, "report": view(did)}

    @r.post("/api/quality/deliverables/{did}/accept/revoke")
    async def revoke(did: str, request: Request) -> dict[str, Any]:
        user_only(request)
        svc = get_service(studio)
        guard(lambda: svc.revoke_accept(did))
        return {"ok": True, "report": view(did)}

    @r.post("/api/quality/deliverables/{did}/findings/{fid}")
    async def finding(did: str, fid: str, request: Request) -> dict[str, Any]:
        user_only(request)
        data = await body(request)
        value = data.get("false_positive", True)
        if not isinstance(value, bool):
            raise HTTPException(400, "false_positive true/false olmalı")
        svc = get_service(studio)
        guard(lambda: svc.mark_false_positive(did, fid, value))
        return {"ok": True, "report": view(did)}

    @r.post("/api/quality/deliverables/{did}/revise")
    async def revise(did: str, request: Request) -> dict[str, Any]:
        user_only(request)
        data = await body(request)
        note = data.get("note", "")
        if not isinstance(note, str):
            raise HTTPException(400, "note metin olmalı")
        svc = get_service(studio)
        out = guard(lambda: svc.request_revision(did, note))
        return {"ok": True, **out}

    return r
