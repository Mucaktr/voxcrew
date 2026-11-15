"""/api/tools uç noktaları (S27 araç köprüsü + guardrail) —.

GET /api/tools sunucular + durum + etkin politika özeti + beyin bazında uygulanma tablosu
PUT /api/tools/settings {allow?, deny?, max_rounds?, call_timeout_s?, injection?}
POST /api/tools/servers {id, transport: stdio|http, command?, args?, url?, enabled?, name?,
                                            env_refs?: [AD], confirm_env?: [AD]}
PUT /api/tools/servers/{id} aynı gövde (kimlik değişmez)

Karar 1 — ortam değişkeni başvuruları (`env_refs`): yalnızca ADLAR saklanır; değer sunucu başlarken VoxCrew'in kendi
ortamından alt sürece kopyalanır. `env_refs` eklemek/değiştirmek yalnızca kullanıcıdan (USER_ONLY_RE `tools/` + arayüz
varlığı; MCP 403) ve adları tek tek sayan açık onayla (`confirm_env` = yeni ad kümesi) olur. Yanıtlar yalnızca
`env_status: [{name, set}]` taşır; değer hiçbir yanıt, olay ya da dosyaya yazılmaz.
DELETE /api/tools/servers/{id}
POST /api/tools/servers/{id}/probe kullanıcı tıklaması: başlat → araçları listele → durdur (sonuç önbelleğe)
PUT /api/tools/classes {tool: "sunucu:araç", class: read|idempotent|effect|null} — aracın yan
                                            etki sınıfı (yalnız kullanıcı; MCP ve arayüz dışı 403). Salt okunur /
                                            idempotent araç baştan çalışan denemede yeniden yürür; yan etkili (ve sınıfı
                                            bilinmeyen) araç yürütme defterinden yeniden oynatılır. Yalnız stüdyonun kendi
                                            API araç döngüsünü etkiler (Claude Code, Codex, Hermes kendi araçlarını çalıştırır).
GET /api/tools/agents/{slug} ajanın etkin araç listesi ve politikası
PUT /api/tools/agents/{slug} {allow?, deny?, mcp?, auto_approve?} → Agent.tools

Olaylar: `tools.changed {servers}`, `tools.probed {server, ok, tools, error}`, `guard.flagged {run_id, step, section,
patterns, mode, chunks, agent?, tool?}`. Hiçbir uç noktası kullanıcı tıklaması olmadan süreç başlatmaz.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException, Request

from studio.guard.injection import MODES, GuardStage
from studio.tools import policy as P
from studio.tools.bridge import ToolBridge, register, unregister
from studio.tools.mcp_client import validate_server
from studio.workflow import prompting

if TYPE_CHECKING:
    from studio.api import Studio


def bridge_for(studio: "Studio") -> ToolBridge:
    b = getattr(studio, "_tool_bridge", None)
    if b is None:
        b = ToolBridge(studio.settings)
        b.bus = studio.bus
        register(b)
        studio._tool_bridge = b  # type: ignore[attr-defined]
    return b


def _agent_route(studio: "Studio", node: dict[str, Any]) -> dict[str, Any]:
    try:
        r = studio.agents.route(node)
        return {"connector": r.connector, "connection": r.connection, "model": r.model}
    except Exception:  # noqa: BLE001 - rota hatası (ör. kurulu olmayan beyin) araç görünümünü engellemesin
        return {"connector": None, "connection": None, "model": None}


def _model_supports_tools(studio: "Studio", model: str | None) -> bool | None:
    models = getattr(studio.agents, "ollama_models", None) or []
    m = next((x for x in models if x.get("name") == model), None)
    if m is None:
        return None
    return "tools" in (m.get("capabilities") or [])


def agent_view(studio: "Studio", node: dict[str, Any]) -> dict[str, Any]:
    b = bridge_for(studio)
    props = node["props"]
    pol = b.policy_for(props)
    route = _agent_route(studio, node)
    connector = route["connector"] or "?"
    tools: list[dict[str, Any]] = []
    servers: list[dict[str, Any]] = []
    for sid in pol.servers:
        cached = b.cached_tools(sid)
        servers.append({"id": sid, "listed": cached is not None, "count": len(cached or [])})
        for t in cached or []:
            name = f"{sid}:{t['name']}"
            tools.append({"name": name, "server": sid, "tool": t["name"], "description": str(t.get("description") or "")[:300],
                          "allowed": pol.allowed(name), "needs_approval": pol.needs_approval(name)})
    enf = P.enforcement(connector)
    notes: list[str] = []
    if connector == "ollama" and route["model"] and _model_supports_tools(studio, route["model"]) is False:
        enf["enforced"] = True
        notes.append("model_no_tools")
    if connector in ("codex", "hermes") and pol.restricted:
        notes.append("not_enforced")
    return {"slug": props.get("slug"), "route": route, "enforcement": enf, "notes": notes,
            "policy": pol.to_dict(), "servers": servers, "tools": tools,
            "available_servers": [s["id"] for s in b.servers() if s.get("enabled") and not s.get("invalid")]}


ENV_USER_ONLY = "Ortam değişkeni aktarımı yalnızca uygulama arayüzünden, kullanıcı tarafından değiştirilebilir"
CLASS_USER_ONLY = "Araç sınıfı yalnızca uygulama arayüzünden, kullanıcı tarafından değiştirilebilir"


def command_change(old: tuple[Any, list[str]], new: tuple[Any, list[str]]) -> str:
    """onay metni için değişikliğin TAMAMI — önce fark (komut, eklenen/çıkarılan argümanlar), sonra yeni komut
    satırı. Hiçbir parça kesilmez: değişen argüman uzun bir yorumlayıcı yolunun arkasında kaybolmaz."""
    parts: list[str] = []
    if old[0] != new[0]:
        parts.append(f"komut {old[0] or '-'} → {new[0] or '-'}")
    added = [a for a in new[1] if a not in old[1]]
    removed = [a for a in old[1] if a not in new[1]]
    if added:
        parts.append("eklenen argümanlar: " + " ".join(added))
    if removed:
        parts.append("çıkarılan argümanlar: " + " ".join(removed))
    if not added and not removed and old[1] != new[1]:
        parts.append("argüman sırası değişti")
    full = " ".join([str(new[0] or ""), *new[1]])
    return "; ".join(parts + [f"yeni komut satırı: {full}"])


def _env_gate(request: Request, old: list[str], new: list[str], confirm: Any, *,
              new_command: str | None = None) -> None:
    """`env_refs` eklenip değişiyorsa: MCP/arayüz dışı 403; onay adları yeni kümeyle birebir değilse 409.
    adlar aynı kalsa da komut ya da argümanlar değiştiyse (`new_command`) değerler başka bir programa gider:
    onay yeniden istenir ve iletide yeni komut adı geçer."""
    if not new or (set(old) == set(new) and new_command is None):
        return  # değişmedi ya da tümüyle kaldırıldı (erişim daralır)
    from studio.clients.tracker import mcp_client  # noqa: PLC0415
    from studio.presence import ui_present  # noqa: PLC0415
    if mcp_client(request) is not None or not ui_present(request):
        raise HTTPException(403, ENV_USER_ONLY)
    names = sorted(str(x).strip() for x in confirm) if isinstance(confirm, list) else None
    if names != sorted(new):
        if new_command is not None and set(old) == set(new):
            raise HTTPException(409, "Ortam değişkeni aktarımı için açık onay gerekli: " + ", ".join(sorted(new))
                                + " — sunucu komutu değişti; bu adların değerleri yeni komuta verilecek: "
                                + new_command)  # kesilmez (değişen argüman her zaman görünür)
        raise HTTPException(409, "Ortam değişkeni aktarımı için açık onay gerekli: " + ", ".join(sorted(new))
                            + " — bu adların değerleri sunucu sürecine verilecek")


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/tools", tags=["tools"])
    S = studio

    def ts() -> dict[str, Any]:
        v = S.settings.get("tools", None)
        return v if isinstance(v, dict) else {}

    def save_servers(servers: list[dict[str, Any]]) -> None:
        S.settings.update({"tools": {"mcp_servers": servers}})
        S.bus.publish("tools.changed", servers=[s.get("id") for s in servers])

    def raw_servers() -> list[dict[str, Any]]:
        return [dict(s) for s in ts().get("mcp_servers") or [] if isinstance(s, dict)]

    def overview() -> dict[str, Any]:
        b = bridge_for(S)
        t = ts()
        agents = []
        for a in S.agents.list():
            pol = b.policy_for(a)
            if pol.agent_mcp or pol.agent_allow or pol.agent_deny:
                connector = (a.get("route") or {}).get("connector")
                agents.append({"slug": a["slug"], "name": a.get("name"), "connector": connector,
                               "servers": list(pol.servers), "allow": list(pol.agent_allow), "deny": list(pol.agent_deny),
                               "enforced": P.enforcement(connector or "").get("enforced", False)})
        return {"servers": b.status(),
                "settings": {"allow": P._clean_list(t.get("allow")), "deny": P._clean_list(t.get("deny")),
                             "max_rounds": b.max_rounds(), "call_timeout_s": float(t.get("call_timeout_s") or 60)},
                "guard": {"injection": str(S.settings.get("guard.injection", "warn") or "warn"),
                          "output_schema_retries": int(S.settings.get("guard.output_schema_retries", 1) or 0)},
                "enforcement": P.ENFORCEMENT, "agents": agents}

    @r.get("")
    def get_tools() -> dict[str, Any]:
        return overview()

    @r.put("/settings")
    async def put_settings(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        patch: dict[str, Any] = {}
        try:
            for key in ("allow", "deny"):
                if key in data:
                    patch[key] = P.validate_patterns(data[key], key)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if "max_rounds" in data:
            try:
                n = int(data["max_rounds"])
            except (TypeError, ValueError):
                raise HTTPException(400, "Araç turu sınırı 1–50 arasında bir tam sayı olmalı") from None
            if not 1 <= n <= 50:
                raise HTTPException(400, "Araç turu sınırı 1–50 arasında bir tam sayı olmalı")
            patch["max_rounds"] = n
        if "call_timeout_s" in data:
            try:
                sec = float(data["call_timeout_s"])
            except (TypeError, ValueError):
                raise HTTPException(400, "Araç çağrısı zaman aşımı 1–600 sn olmalı") from None
            if not 1 <= sec <= 600:
                raise HTTPException(400, "Araç çağrısı zaman aşımı 1–600 sn olmalı")
            patch["call_timeout_s"] = sec
        full: dict[str, Any] = {"tools": patch} if patch else {}
        if "injection" in data:
            if data["injection"] not in MODES:
                raise HTTPException(400, "Enjeksiyon kipi off, warn ya da block olmalı")
            full["guard"] = {"injection": data["injection"]}
        if full:
            S.settings.update(full)
            S.bus.publish("tools.changed", servers=[s.get("id") for s in raw_servers()])
        return overview()

    @r.post("/servers")
    async def add_server(request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        servers = raw_servers()
        confirm = data.pop("confirm_env", None)
        try:
            cfg = validate_server(data, existing_ids={str(s.get("id")) for s in servers})
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        _env_gate(request, [], cfg.get("env_refs") or [], confirm)
        save_servers(servers + [cfg])
        return overview()

    @r.put("/servers/{sid}")
    async def put_server(sid: str, request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        servers = raw_servers()
        confirm = data.pop("confirm_env", None)
        idx = next((i for i, s in enumerate(servers) if s.get("id") == sid), None)
        if idx is None:
            raise HTTPException(404, f"Sunucu yok: {sid}")
        if data.get("id") not in (None, sid):
            raise HTTPException(400, "Sunucu kimliği değiştirilemez")
        try:
            merged = {**servers[idx], **data, "id": sid}
            if merged.get("transport") == "http":
                merged.pop("env_refs", None)  # HTTP'ye geçişte aktarım düşer (yalnız stdio)
            cfg = validate_server(merged)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if cfg.get("transport") == "stdio":
            cfg.pop("url", None)
        else:
            cfg.pop("command", None)
            cfg.pop("args", None)
            cfg.pop("env_refs", None)
        old_refs = [str(x) for x in servers[idx].get("env_refs") or [] if isinstance(x, str)]
        old_cmd = (servers[idx].get("command"), [str(a) for a in servers[idx].get("args") or []])
        new_cmd = (cfg.get("command"), list(cfg.get("args") or []))
        changed = command_change(old_cmd, new_cmd) if old_cmd != new_cmd else None
        _env_gate(request, old_refs, cfg.get("env_refs") or [], confirm, new_command=changed)
        servers[idx] = cfg
        save_servers(servers)
        return overview()

    @r.delete("/servers/{sid}")
    async def delete_server(sid: str) -> dict[str, Any]:
        servers = raw_servers()
        if not any(s.get("id") == sid for s in servers):
            raise HTTPException(404, f"Sunucu yok: {sid}")
        save_servers([s for s in servers if s.get("id") != sid])
        bridge_for(S).forget(sid)
        return overview()

    @r.post("/servers/{sid}/probe")
    async def probe_server(sid: str) -> dict[str, Any]:
        b = bridge_for(S)
        try:
            res = await b.probe(sid)
        except KeyError:
            raise HTTPException(404, f"Sunucu yok: {sid}") from None
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(409, str(exc)) from exc
        S.bus.publish("tools.probed", server=sid, ok=res.get("ok"), tools=len(res.get("tools") or []),
                      error=res.get("error"))
        return {"server": sid, "ok": res.get("ok"), "ms": res.get("ms"), "error": res.get("error"),
                "protocol_version": res.get("protocol_version"), "stateless": res.get("stateless"),
                "server_info": res.get("server_info"),
                "tools": [{"name": t.get("name"), "description": str(t.get("description") or "")[:300]}
                          for t in res.get("tools") or []]}

    @r.put("/classes")
    async def put_tool_class(request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """kullanıcının araç sınıfı işareti (salt okunur / idempotent / yan etkili; null = MCP açıklaması)."""
        from studio.clients.tracker import mcp_client  # noqa: PLC0415
        from studio.presence import ui_present  # noqa: PLC0415
        from studio.tools.loop import TOOL_CLASSES  # noqa: PLC0415
        if mcp_client(request) is not None or not ui_present(request):
            raise HTTPException(403, CLASS_USER_ONLY)
        name = str(data.get("tool") or "").strip()
        sid, _sep, tool = name.partition(":")
        if not sid or not tool or len(name) > 200 or any(c.isspace() for c in name):
            raise HTTPException(400, "Araç adı 'sunucu:araç' biçiminde olmalı")
        if not any(s.get("id") == sid for s in raw_servers()):
            raise HTTPException(404, f"Sunucu yok: {sid}")
        cls = data.get("class")
        if cls is not None and cls not in TOOL_CLASSES:
            raise HTTPException(400, "Sınıf read, idempotent, effect ya da null olmalı")
        cur = dict(ts().get("tool_classes") or {})
        if cls is None:
            cur.pop(name, None)
        else:
            cur[name] = cls
        S.settings.update({"tools": {"tool_classes": cur or None}})  # bütün değer yazılır (silinen anahtar kalmaz)
        S.bus.publish("tools.changed", servers=[s.get("id") for s in raw_servers()])
        return overview()

    @r.get("/agents/{slug}")
    def get_agent_tools(slug: str) -> dict[str, Any]:
        node = S.agents.node(slug)
        if not node:
            raise HTTPException(404, f"Ajan yok: {slug}")
        return agent_view(S, node)

    @r.put("/agents/{slug}")
    async def put_agent_tools(slug: str, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        node = S.agents.node(slug)
        if not node:
            raise HTTPException(404, f"Ajan yok: {slug}")
        current = P.agent_tools(node["props"])
        try:
            for key in ("allow", "deny", "auto_approve"):
                if key in data:
                    current[key] = P.validate_patterns(data[key], key)
            if "mcp" in data:
                mcp = P.validate_patterns(data["mcp"], "mcp")
                if any(":" in m for m in mcp):
                    raise ValueError("Sunucu listesinde yalnızca sunucu kimliği (ya da kalıbı) olabilir")
                current["mcp"] = mcp
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        value = {k: v for k, v in current.items() if v}
        node = S.store.patch_node(node["id"], {"tools": value or None})
        agent = S.agents.serialize(node)
        S.bus.publish("agent.updated", agent=agent)
        return agent_view(S, node)

    return r


async def start(studio: "Studio") -> None:
    """Açılışta: köprüyü kaydet (bağlayıcılar `get_bridge(settings)` ile bulur) ve `guard` istem aşamasını ekle.
    Hiçbir MCP sunucusu başlatılmaz (otomatik başlatma yok)."""
    bridge_for(studio)

    def publish(type_: str, **data: Any) -> Any:
        # guard.flagged koşu olaylarına da yazılır (iz görünümü + yeniden yükleme), motor `_emit` ile aynı yol
        event = studio.bus.publish(type_, **data)
        if data.get("run_id"):
            try:
                studio.store.add_run_event(str(data["run_id"]), event)
            except Exception:  # noqa: BLE001 - kalıcı yazım hatası istem hattını bozmamalı
                pass
        return event

    prompting.register(GuardStage(publish=publish))


async def stop(studio: "Studio") -> None:
    """Kapanışta: aşamayı ve köprü kaydını kaldır (testlerde yeniden kayıt temiz olsun)."""
    prompting.unregister(GuardStage.name)
    b = getattr(studio, "_tool_bridge", None)
    if b is not None:
        unregister(b)
        studio._tool_bridge = None  # type: ignore[attr-defined]
