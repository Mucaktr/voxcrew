"""Teslim uç noktaları (CG-DELIVER). Hepsi kullanıcıya aittir: MCP istemcileri ve ajanlar teslim edemez.

| Uç | Gövde / sorgu | Yanıt |
|---|---|---|
| `GET /api/delivery/targets` | `?deliverable=&check=` | `{targets, suggested, settings}` · MCP 403 |
| `POST /api/delivery/preview` | `{deliverable_id, target, options}` | `{payload, preview_hash, quality, …}` (hiçbir şey yazmaz) |
| `POST /api/delivery/deliver` | `{deliverable_id, target, options, preview_hash, approved: true, override_reason?}` | `{ok, record, client_action?}` |
| `PUT /api/delivery/settings` | `{redact_pii?}` | ayarlar |
| `GET /api/deliverables/{id}/deliveries` | — | `{items}` (teslim kayıtları; içerik yok; MCP'ye yerel yol yok) |

POST/PUT yolları `USER_ONLY_RE` (`delivery/`) ile sunum katmanında arayüz jetonu ister; rota ayrıca `ui_present` ve
MCP başlığını denetler (derinlemesine savunma).
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from studio.delivery.adapters import DeliveryError
from studio.delivery.service import DeliveryService

if TYPE_CHECKING:
    from studio.api import Studio

USER_ONLY = "Teslim yalnızca uygulama arayüzünden, kullanıcı onayıyla yapılabilir"


def get_service(studio: "Studio") -> DeliveryService:
    svc = getattr(studio, "_delivery", None)
    if svc is None:
        svc = DeliveryService(studio)
        studio._delivery = svc  # type: ignore[attr-defined]
        from studio import delivery
        delivery.bind(studio)
    return svc


def _not_mcp(request: Request) -> None:
    from studio.clients.tracker import mcp_client
    if mcp_client(request) is not None:
        raise HTTPException(403, USER_ONLY)


def _user_only(request: Request) -> None:
    from studio.presence import ui_present
    _not_mcp(request)
    if not ui_present(request):
        raise HTTPException(403, USER_ONLY)


async def _body(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except ValueError:
        data = None
    if not isinstance(data, dict):
        raise HTTPException(400, "Gövde bir nesne olmalı")
    return data


MAX_ID = 200
LOCAL_KEYS = ("folder", "filename", "repo", "branch", "path", "base", "head")  # MCP'ye verilmeyen yerel ayrıntı


def _did(data: dict[str, Any]) -> str:
    """boş ya da biçimsiz çıktı kimliği 500 değil 400."""
    raw = data.get("deliverable_id")
    did = str(raw).strip() if isinstance(raw, (str, int)) and not isinstance(raw, bool) else ""
    if not did:
        raise HTTPException(400, "deliverable_id gerekli")
    if len(did) > MAX_ID or not did.isprintable():
        raise HTTPException(400, "deliverable_id geçersiz")
    return did


_TOKEN_SEG = re.compile(r"(?:^|[/_=-])(?:ghp_|gho_|ghs_|ghu_|github_pat_|glpat-|xox[abprs]-|sk-|AKIA[0-9A-Z]{8}|AIza)", re.I)
_HOOK_SEG = {"webhook", "webhooks", "hooks", "hook", "key", "keys"}  # IFTTT `/with/key/<anahtar>`


def _secret_path(host: str, path: str) -> bool:
    """QA34b-04: yolu başlı başına gizli değer taşıyan bağlantılar (Slack / Discord / Teams / Telegram webhook'u, bilinen
    jeton önekleri). Bunlarda MCP'ye yalnız şema + ana makine gider."""
    h, low = host.lower(), path.lower()
    segs = {x for x in low.split("/") if x}
    return bool(
        h.startswith(("hook.", "hooks.")) or h.endswith("hooks.slack.com") or h.endswith("webhook.office.com") or h.endswith("hooks.zapier.com")
        or (h.endswith(("discord.com", "discordapp.com")) and "webhooks" in segs)
        or (h.endswith("office.com") and bool(segs & _HOOK_SEG))
        or (h == "api.telegram.org" and any(x.startswith("bot") for x in segs))
        or bool(segs & _HOOK_SEG) or _TOKEN_SEG.search(path))


def mcp_link(link: Any) -> Any:
    """MCP'ye giden bağlantı. `http(s)` (ör. GitHub PR) sorgu / parçası olmadan; `kullanici:parola@` kullanıcı
    bilgisi her zaman düşer (QA34b-04) ve yolu gizli değer taşıyan bağlantılar (webhook, jeton) yalnız şema + ana makine olarak
    gider. Diğer şemalar (`mailto:` alıcı ve gövde, `file:` yerel yol,...) yalnız ŞEMA olarak ("mailto:", "file:") gider."""
    if not isinstance(link, str) or not link:
        return link
    low = link.lower()
    if low.startswith(("http://", "https://")):
        try:
            parts = urlsplit(link)
            host, port = parts.hostname or "", parts.port
        except ValueError:
            return None
        if not host:
            return None
        hostport = (f"[{host}]" if ":" in host else host) + (f":{port}" if port else "")
        base = f"{parts.scheme.lower()}://{hostport}"
        path = parts.path.split(";", 1)[0]  # `;param=` yol parametreleri de atılır
        return base if _secret_path(host, path) else base + path
    head, sep, _rest = link.partition(":")
    return f"{head}:" if sep and head.isalpha() else None


def _mcp_record(rec: dict[str, Any]) -> dict[str, Any]:
    """MCP'ye teslim kaydı yerel yol / depo / dal olmadan gider (`/api/delivery/targets` de MCP'ye kapalı)."""
    out = {k: v for k, v in rec.items() if k not in ("path", "options")}
    opts = rec.get("options") if isinstance(rec.get("options"), dict) else {}
    out["options"] = {k: v for k, v in opts.items() if k not in LOCAL_KEYS}
    if "link" in rec:
        out["link"] = None if str(rec.get("link") or "").startswith("file:") else mcp_link(rec.get("link"))
    local = str(rec.get("path") or "")
    if local:  # "Klasöre kaydedildi: <yol>" gibi sonuç/hata metinleri yerel yolu taşır
        shown = str(rec.get("label") or "dosya")
        for key in ("result", "error"):
            if isinstance(out.get(key), str):
                out[key] = out[key].replace(local, shown)
    return out


def _err(exc: DeliveryError) -> JSONResponse:
    return JSONResponse({"detail": str(exc), "code": exc.code}, status_code=exc.status)


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(tags=["delivery"])

    @r.get("/api/delivery/targets")
    async def targets(request: Request, deliverable: str | None = None, check: bool = False) -> dict[str, Any]:
        _not_mcp(request)
        return await get_service(studio).targets(deliverable_id=deliverable, check=check)

    @r.post("/api/delivery/preview", response_model=None)
    async def preview(request: Request) -> Any:
        _user_only(request)
        data = await _body(request)
        did = _did(data)
        try:
            return await get_service(studio).preview(did, data.get("target"), data.get("options") or {})
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc
        except DeliveryError as exc:
            return _err(exc)

    @r.post("/api/delivery/deliver", response_model=None)
    async def deliver(request: Request) -> Any:
        _user_only(request)
        data = await _body(request)
        did = _did(data)
        try:
            return await get_service(studio).deliver(
                did, data.get("target"), data.get("options") or {},
                preview_hash_=str(data.get("preview_hash") or ""), approved=data.get("approved") is True,
                override_reason=str(data.get("override_reason") or "") or None)
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc
        except DeliveryError as exc:
            return _err(exc)

    @r.put("/api/delivery/settings")
    async def put_settings(request: Request) -> dict[str, Any]:
        _user_only(request)
        data = await _body(request)
        try:
            return get_service(studio).store.update_settings({k: v for k, v in data.items() if k == "redact_pii"})
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @r.get("/api/deliverables/{did}/deliveries")
    async def records(did: str, request: Request) -> dict[str, Any]:
        from studio.clients.tracker import mcp_client
        items = get_service(studio).records(did)
        if mcp_client(request) is not None:
            items = [_mcp_record(r) for r in items]
        return {"items": items}

    return r
