"""/api/clients uç noktaları — Claude Code ve Codex içinden kullanım (MCP) kurulumu (Ekip S11).

- `GET  /status`       CLI algılama ve sürüm, istemci başına son MCP çağrısı, `clients.mcp` ayarları
- `GET  /snippets`     bu makinedeki mutlak yollarla kurulum komutları (anlık üretilir, hiçbir yere yazılmaz)
- `GET  /ping`         MCP sunucusunun açılışta attığı "merhaba" (Bağlantıyı sına)
- `GET  /approvals`    onay bekleyen adımlar ve araç izinleri (MCP `list_pending_approvals`)
- `POST /codex/plan`   `~/.codex/config.toml` için değişiklik planı (YAZMAZ)
- `POST /claude/plan`  seçilen proje klasöründeki `.mcp.json` için değişiklik planı (YAZMAZ)

Planlar `studio.changes` ile oluşturulur; dosyaya yalnızca kullanıcı arayüzde onaylarsa
`/api/changes/plans/{id}/apply` yazar (yedek + atomik yazma + geri al).
"""

from __future__ import annotations

import asyncio
import os
import shutil
import time
import tomllib
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from studio import brand
from studio.changes import read_exact
from studio.clients import configs, snippets
from studio.clients.tracker import HEADER, client_seen, parse_header, tracker_for
from studio.connectors.discovery import run_quick

if TYPE_CHECKING:
    from studio.api import Studio

CLIENTS = ("claude-code", "codex")
PROBE_KIND = {"claude-code": "claude", "codex": "codex"}
_NODE_CACHE: dict[str, Any] = {}
NODE_TTL_S = 300


def codex_config_path() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "config.toml"


def _display(path: Path) -> str:
    """Arayüzde gösterim için ev dizinini `~` ile kısaltır."""
    try:
        return "~" + os.sep + str(path.relative_to(Path.home()))
    except ValueError:
        return str(path)


def _node_info() -> dict[str, Any]:
    if _NODE_CACHE and time.monotonic() - _NODE_CACHE.get("t", 0) < NODE_TTL_S:
        return _NODE_CACHE["info"]
    exe = shutil.which("node")
    info: dict[str, Any] = {"available": bool(exe), "version": None}
    if exe:
        rc, out = run_quick([exe, "--version"], timeout=10)
        info["version"] = out.strip().lstrip("v") if rc == 0 and out else None
        try:
            info["supported"] = int((info["version"] or "0").split(".")[0]) >= 18
        except ValueError:
            info["supported"] = None
    _NODE_CACHE.update(t=time.monotonic(), info=info)
    return info


def _codex_config_state() -> dict[str, Any]:
    path = codex_config_path()
    state: dict[str, Any] = {"path": str(path), "display": _display(path), "exists": path.is_file(),
                             "has_server": False, "notify": "none", "error": None}
    if not state["exists"]:
        return state
    try:
        data = tomllib.loads(path.read_text("utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        state["error"] = f"config.toml okunamadı: {exc}"
        return state
    state["has_server"] = configs.SERVER_NAME in (data.get("mcp_servers") or {})
    notify = data.get("notify")
    if notify:
        ours = isinstance(notify, list) and any("studio-hook" in str(x) for x in notify)
        state["notify"] = "ours" if ours else "other"
    return state


def _awaiting_message(studio: "Studio", run_id: str, step_id: str) -> str | None:
    try:
        events = studio.store.run_events(run_id)
    except Exception:  # noqa: BLE001 - mesaj yalnızca süs
        return None
    for e in reversed(events):
        if e.get("type") == "step.awaiting" and e.get("step") == step_id:
            return str(e.get("message") or "") or None
    return None


def pending_approvals(studio: "Studio") -> list[dict[str, Any]]:
    """Canlı koşulardaki onay adımları ve Hermes araç izinleri (karar yalnızca arayüzden ya da izinli MCP'den)."""
    engine = studio.engine
    runs = dict(getattr(engine, "runs", {}) or {})
    out: list[dict[str, Any]] = []
    for run_id, run in runs.items():
        # FOLLOWUP: duraklatılmış/kesilmiş koşunun bekleyen adımı karara açık değil ("önce sürdür") → listelenmez
        if str(getattr(run, "status", "running") or "running") != "running":
            continue
        for st in list((getattr(run, "steps", None) or {}).values()):
            if getattr(st, "status", None) != "awaiting_approval":
                continue
            spec = st.spec
            out.append({"kind": "step", "run_id": run_id, "run_title": getattr(run, "title", None),
                        "step": spec.id, "agent": getattr(spec, "agent", None),
                        "message": _awaiting_message(studio, run_id, spec.id) or getattr(spec, "message", None)
                        or "Devam edilsin mi?",
                        "choices": ["approve", "reject"], "requested_at": getattr(st, "started_at", None),
                        "ui_path": f"/gorevler/{run_id}"})
    for item in engine.pending_tool_approvals():
        run_id = str(item.get("run_id"))
        run = runs.get(run_id)
        out.append({"kind": "tool", "run_id": run_id, "run_title": getattr(run, "title", None),
                    "step": item.get("step"), "agent": item.get("agent"), "approval_id": item.get("approval_id"),
                    "tool": item.get("tool"), "summary": item.get("summary") or "",
                    "command": str(item.get("command") or "")[:500], "choices": item.get("choices") or [],
                    "requested_at": item.get("requested_at"), "expires_at": item.get("expires_at"),
                    "ui_path": f"/gorevler/{run_id}"})
    return out


def _forbidden_dirs() -> list[Path]:
    home = Path.home()
    return [home / ".claude", home / ".codex", home / ".hermes"]


def _validate_project_dir(raw: str) -> Path:
    if not raw.strip():
        raise HTTPException(400, "Proje klasörü gerekli")
    path = Path(raw.strip()).expanduser()
    if not path.is_absolute():
        raise HTTPException(400, "Proje klasörü mutlak bir yol olmalı")
    try:
        path = path.resolve()
    except OSError as exc:
        raise HTTPException(400, f"Klasör çözümlenemedi: {exc}") from exc
    if not path.is_dir():
        raise HTTPException(400, f"Klasör bulunamadı: {path}")
    for bad in _forbidden_dirs():
        try:
            bad_r = bad.resolve()
        except OSError:
            continue
        if path == bad_r or bad_r in path.parents:
            raise HTTPException(400, "Bu klasör bir araç yapılandırma klasörü; bir proje klasörü seç")
    return path


def _plan_checked(studio: "Studio", path: Path, current: str | None, new_text: str, summary: str,
                  kind: str) -> dict[str, Any]:
    """Planı oluşturur ve planın 'önce' hâlinin hesapladığımız metinle aynı olduğunu doğrular (arada dosya
    değiştiyse eski içerikten üretilmiş bir planı sunmamak için)."""
    plan = studio.changes.plan_text(path, new_text, summary, kind=kind)
    pending = studio.changes.pending.get(plan["id"])
    if pending is not None and pending.before != current:
        studio.changes.pending.pop(plan["id"], None)
        raise HTTPException(409, "Dosya bu arada değişti; planı yeniden oluştur")
    return plan


def build_router(studio: "Studio") -> APIRouter:
    tracker = tracker_for(studio)
    r = APIRouter(prefix="/api/clients", tags=["clients"], dependencies=[Depends(client_seen(studio))])

    @r.get("/ping")
    async def ping(request: Request) -> dict[str, Any]:
        parsed = parse_header(request.headers.get(HEADER))
        return {"ok": True, "client": parsed[1] if parsed else None, "ts": time.time()}

    @r.get("/status")
    async def status(force: bool = False) -> dict[str, Any]:
        conns, node, codex_cfg = await asyncio.gather(
            studio.probe.get(force=force), asyncio.to_thread(_node_info), asyncio.to_thread(_codex_config_state))
        by_kind = {c.get("kind"): c for c in conns}
        clients: dict[str, Any] = {}
        for name in CLIENTS:
            c = by_kind.get(PROBE_KIND[name]) or {}
            clients[name] = {
                "cli": {"available": bool(c.get("available")), "version": c.get("version"), "path": c.get("path"),
                        "logged_in": c.get("logged_in"), "detail": c.get("detail")},
                "last_seen": tracker.get("mcp", name),
            }
        p = snippets.paths()
        return {
            "clients": clients,
            "others": [e for e in tracker.all("mcp") if e.get("client") not in CLIENTS],
            "settings": {"enabled": studio.settings.get("clients.mcp.enabled", True) is not False,
                         "allow_decisions": studio.settings.get("clients.mcp.allow_decisions", False) is True,
                         # AGENT-DELETE: "Ajanlar silebilsin" (yalnız arayüzden değişir)
                         "agent_delete": studio.settings.get("clients.agents.allow_delete", False) is True},
            "node": node,
            "server": {"exists": p.server.is_file(), "plugin_copy": p.plugin_server.is_file(),
                       "hook": p.hook.is_file()},
            "codex_config": codex_cfg,
            "now": time.time(),
        }

    @r.get("/snippets")
    async def get_snippets(request: Request) -> dict[str, Any]:
        url = snippets.studio_url_from_scope(request.scope)
        return await asyncio.to_thread(snippets.build, url)

    @r.get("/approvals")
    async def approvals() -> list[dict[str, Any]]:
        return pending_approvals(studio)

    @r.post("/codex/plan")
    async def codex_plan(request: Request, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        path = codex_config_path()
        p = snippets.paths()
        url = snippets.studio_url_from_scope(request.scope)
        include_notify = data.get("notify") is True

        def compute() -> tuple[str | None, configs.CodexEdit]:
            try:
                current = read_exact(path)  # satır sonları korunur (CRLF)
            except (OSError, UnicodeDecodeError) as exc:
                raise configs.ConfigError(f"config.toml okunamadı: {exc}") from None
            return current, configs.plan_codex_config(current, str(p.server), studio_url=url,
                                                      hook_path=str(p.hook) if include_notify else None)

        try:
            current, edit = await asyncio.to_thread(compute)
        except configs.ConfigError as exc:
            raise HTTPException(400, str(exc)) from exc
        warnings: list[str] = []
        if not p.server.is_file():
            warnings.append("MCP sunucu dosyası bulunamadı; depo eksik olabilir")
        if include_notify and not p.hook.is_file():
            warnings.append("Oturum takibi programı (studio-hook.mjs) henüz yok; notify satırı eklenirse Codex "
                            "tur sonlarında hata günlüğü yazabilir")
        summary = {"add": f"Codex: {brand.NAME} MCP sunucusunu ekle",
                   "update": f"Codex: {brand.NAME} MCP sunucusu ayarlarını güncelle",
                   "keep": f"Codex: {brand.NAME} MCP sunucusu zaten ekli"}[edit.action]
        if edit.notify.get("status") == "added":
            summary += " + oturum takibi (notify)"
        plan = _plan_checked(studio, path, current, edit.text, summary, "toml")
        return {"plan": plan, "target": str(path), "display": _display(path), "action": edit.action,
                "block": edit.block, "notify": edit.notify, "notes": edit.notes, "warnings": warnings}

    @r.post("/claude/plan")
    async def claude_plan(request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        project = await asyncio.to_thread(_validate_project_dir, str(data.get("project_dir") or ""))
        target = project / ".mcp.json"
        p = snippets.paths()
        url = snippets.studio_url_from_scope(request.scope)

        def compute() -> tuple[str | None, str, dict[str, Any]]:
            current = read_exact(target)
            new_text, info = configs.plan_claude_mcp_json(current, str(p.server), studio_url=url)
            return current, new_text, info

        try:
            current, new_text, info = await asyncio.to_thread(compute)
        except (OSError, UnicodeDecodeError) as exc:
            raise HTTPException(400, f".mcp.json okunamadı: {exc}") from exc
        except configs.ConfigError as exc:
            raise HTTPException(400, str(exc)) from exc
        summary = {"add": f"Claude Code: projeye {brand.NAME} MCP sunucusunu ekle",
                   "update": f"Claude Code: {brand.NAME} MCP sunucusu ayarlarını güncelle",
                   "keep": f"Claude Code: {brand.NAME} MCP sunucusu zaten ekli"}[info["action"]]
        plan = _plan_checked(studio, target, current, new_text, summary, "json")
        notes = ["Claude Code proje kapsamındaki sunucuları ilk açılışta onayına sunar.",
                 ".mcp.json depoya işlenirse içindeki mutlak yol da paylaşılır; yalnızca kendin için "
                 "`claude mcp add --scope local` ya da `--scope user` tercih edilebilir."]
        if info["others"]:
            notes.insert(0, f"Var olan sunucular korunur: {', '.join(info['others'])}")
        return {"plan": plan, "target": str(target), "action": info["action"], "others": info["others"],
                "notes": notes}

    return r
