"""/api/mcp-catalog — CG2 MCP bağlayıcı kataloğu (bkz. `mcp_catalog.py`).

| Uç | Açıklama |
|---|---|
| `GET /api/mcp-catalog` | `?lang=` kayıtlar + birebir komutlar + nerede zaten tanımlı (salt okuma; MCP de listeler) |
| `POST /api/mcp-catalog/{id}/plan` | `{brain: claude\\|codex, project_dir?, params?}` → değişiklik PLANI (YAZMAZ) |

Plan `/api/changes/plans/{id}/apply` ile yalnızca kullanıcı onaylayınca uygulanır (yedek + geri al). POST yolu
`clients/tracker.py USER_ONLY_RE` içindedir: MCP istemcileri plan oluşturamaz. Hiçbir şey kurulmaz/çalıştırılmaz.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException, Request

from studio.changes import read_exact
from studio.connections import mcp_catalog as C

if TYPE_CHECKING:
    from studio.api import Studio

BRAINS = ("claude", "codex")


def _lang(value: str | None) -> str:
    if value in ("tr", "en"):
        return value
    from studio.i18n import request_lang  # noqa: PLC0415

    return "en" if request_lang() == "en" else "tr"


def _codex_path() -> Path:
    from studio.clients.api import codex_config_path  # noqa: PLC0415

    return codex_config_path()


def _project_dir(raw: Any) -> Path:
    from studio.clients.api import _validate_project_dir  # noqa: PLC0415 - aynı kural (araç ayar klasörü yasak)

    return _validate_project_dir(str(raw or ""))


def _folder_param(studio: "Studio") -> Any:
    def check(val: str) -> Path:
        from studio.delivery.safety import PathRejected, validate_folder  # noqa: PLC0415

        try:
            return validate_folder(val, studio)
        except PathRejected as exc:
            raise C.CatalogError(str(exc)) from None
    return check


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/mcp-catalog", tags=["connections"])

    @r.get("")
    async def catalog(lang: str | None = None) -> dict[str, Any]:
        lg = _lang(lang)

        def read_codex() -> str | None:
            try:
                return read_exact(_codex_path())
            except (OSError, UnicodeDecodeError):
                return None
        codex_text = await asyncio.to_thread(read_codex)
        try:
            from studio.tools.api import bridge_for  # noqa: PLC0415
            servers = bridge_for(studio).raw_servers()
        except Exception:  # noqa: BLE001
            servers = []
        configured = C.configured_in(servers, codex_text)
        return {"items": [C.public(e, lg, configured) for e in C.CATALOG], "checked_at": C.VERIFIED_AT,
                "reliability": list(C.RELIABILITY)}

    @r.post("/{eid}/plan")
    async def plan(eid: str, request: Request, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        e = C.BY_ID.get(eid)
        if e is None:
            raise HTTPException(404, f"Katalogda yok: {eid}")
        brain = str(data.get("brain") or "")
        if brain not in BRAINS:
            raise HTTPException(400, "Hedef claude ya da codex olmalı")
        if e["verification"]["status"] == "unverified":
            raise HTTPException(409, "Bu kaydın komutu doğrulanmadı; yapılandırma önerilmez")
        params = data.get("params") if isinstance(data.get("params"), dict) else {}

        def compute() -> tuple[Path, str | None, str, str]:
            args = C._fill(e, params, _folder_param(studio))  # noqa: SLF001
            if brain == "claude":
                target = _project_dir(data.get("project_dir")) / ".mcp.json"
                current = read_exact(target)
                new_text, action = C.plan_claude_json(current, e, args)
            else:
                target = _codex_path()
                current = read_exact(target)
                new_text, action = C.plan_codex_toml(current, e, args)
            return target, current, new_text, action

        try:
            target, current, new_text, action = await asyncio.to_thread(compute)
        except C.CatalogError as exc:
            raise HTTPException(exc.status, str(exc)) from exc
        except (OSError, UnicodeDecodeError) as exc:
            raise HTTPException(400, f"Yapılandırma dosyası okunamadı: {exc}") from exc
        name = e["name"]["tr"]
        summary = (f"Claude Code: projeye {name} MCP sunucusunu ekle" if brain == "claude"
                   else f"Codex: {name} MCP sunucusunu ekle")
        if action == "keep":
            summary = f"{name} zaten ekli"
        plan_ = studio.changes.plan_text(target, new_text, summary, kind="json" if brain == "claude" else "toml")
        pending = studio.changes.pending.get(plan_["id"])
        if pending is not None and pending.before != current:
            studio.changes.pending.pop(plan_["id"], None)
            raise HTTPException(409, "Dosya bu arada değişti; planı yeniden oluştur")
        notes = []
        if e["env"]:
            notes.append("Ortam değişkenlerinin değerleri yazılmaz; kabuğunda tanımla: " + ", ".join(e["env"]))
        if brain == "claude":
            notes.append("Claude Code proje kapsamındaki sunucuları ilk açılışta onayına sunar.")
        return {"plan": plan_, "target": str(target), "action": action, "command": C.commands(e)[brain],
                "notes": notes}

    return r
