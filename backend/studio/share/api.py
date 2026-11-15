"""/api/share uç noktaları — hafif ekip paylaşımı (dışa/içe aktarma; bulut ve hesap yok).

| Uç | Gövde / sorgu | Yanıt |
|---|---|---|
| `GET /api/share/exportable` | — | `{jobs, agents, outputs}` dışa aktarılabilir öğeler |
| `POST /api/share/export` | `{items: [{kind: job\\|agent\\|output, id}]}` | `{bundle, preview, bytes, filename}` (okuma; MCP de) |
| `POST /api/share/import/preview` | paket JSON (≤ 256 KB) | `{ok, items: [plan]}`: çakışma, fark, tam istemler, bayraklar |
| `POST /api/share/import` | `{bundle, choices: {"<kind>:<id>": add\\|replace\\|skip}, confirm: true}` | `{ok, results}` |
| `GET /api/share/outputs` | — | çıktı şablonları |
| `POST /api/share/outputs/{id}/apply` | `{workflow}` | şablonu akışın `quality` bloğuna uygular |
| `DELETE /api/share/outputs/{id}` | — | `{ok}` |
| `GET /api/share/imported` | — | içe aktarılanlar kaydı (`{"<kind>:<id>": {imported_at, flags…}}`) |

Güvenlik: içe aktarma ve şablon yazma uçları `clients/tracker.USER_ONLY_RE` içindedir (MCP 403; başlıksız yerel süreç
arayüz jetonu ister: `presence`). Paket gövdesi akış hâlinde okunur ve 256 KB'ı aşınca 413 döner.
"""

from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException, Request

from studio.share import bundle as B
from studio.share.service import ShareError, service_for

if TYPE_CHECKING:
    from studio.api import Studio

IMPORT_SLACK = 16 * 1024  # seçimler + confirm için paketin üstüne pay


async def read_json(request: Request, limit: int) -> Any:
    length = request.headers.get("content-length")
    too_big = f"Paket çok büyük (en fazla {B.MAX_BUNDLE_BYTES // 1024} KB)"
    if length and length.isdigit() and int(length) > limit:
        raise HTTPException(413, too_big)
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise HTTPException(413, too_big)
    try:
        return json.loads(bytes(body).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise HTTPException(400, "Paket geçerli bir JSON dosyası değil") from None


def _fail(exc: Exception) -> HTTPException:
    if isinstance(exc, B.BundleError):
        return HTTPException(exc.status, {"message": "Paket reddedildi", "errors": exc.errors})
    if isinstance(exc, ShareError):
        return HTTPException(exc.status, str(exc))
    if isinstance(exc, KeyError):
        return HTTPException(404, str(exc).strip("'\""))
    return HTTPException(400, str(exc))


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/share", tags=["share"])
    svc = service_for(studio)

    @r.get("/exportable")
    def exportable() -> dict[str, Any]:
        return svc.exportable()

    @r.post("/export")
    async def export(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            return await asyncio.to_thread(svc.export, data.get("items"))
        except (B.BundleError, ShareError, KeyError, ValueError) as exc:
            raise _fail(exc) from exc

    @r.post("/import/preview")
    async def import_preview(request: Request) -> dict[str, Any]:
        data = await read_json(request, B.MAX_BUNDLE_BYTES)
        try:
            return await asyncio.to_thread(svc.preview, data)
        except (B.BundleError, ShareError, KeyError, ValueError) as exc:
            raise _fail(exc) from exc

    @r.post("/import")
    async def import_apply(request: Request) -> dict[str, Any]:
        body = await read_json(request, B.MAX_BUNDLE_BYTES + IMPORT_SLACK)
        if not isinstance(body, dict):
            raise HTTPException(400, "Gövde {bundle, choices, confirm} biçiminde olmalı")
        bundle = body.get("bundle")
        if len(json.dumps(bundle, ensure_ascii=False).encode("utf-8")) > B.MAX_BUNDLE_BYTES:
            raise HTTPException(413, f"Paket çok büyük (en fazla {B.MAX_BUNDLE_BYTES // 1024} KB)")
        try:
            out = await asyncio.to_thread(svc.apply, bundle, body.get("choices"), body.get("confirm"))
        except (B.BundleError, ShareError, KeyError, ValueError) as exc:
            raise _fail(exc) from exc
        for res in out["results"]:
            if res["kind"] == "agent" and res.get("id"):
                agent = studio.agents.get(res["id"])
                if agent:
                    studio.bus.publish("agent.updated", agent=agent)
        return out

    @r.get("/outputs")
    def outputs() -> dict[str, Any]:
        return {"items": svc.outputs()}

    @r.post("/outputs/{oid}/apply")
    async def apply_output(oid: str, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        from studio.workflow.spec import WorkflowError  # noqa: PLC0415
        try:
            return await asyncio.to_thread(svc.apply_output, oid, str(data.get("workflow") or ""))
        except (KeyError, ShareError, WorkflowError) as exc:
            raise _fail(exc) from exc

    @r.delete("/outputs/{oid}")
    async def delete_output(oid: str) -> dict[str, Any]:
        try:
            await asyncio.to_thread(svc.delete_output, oid)
        except KeyError as exc:
            raise _fail(exc) from exc
        return {"ok": True}

    @r.get("/imported")
    def imported() -> dict[str, Any]:
        return {"items": svc.imported()}

    return r
