"""WORK-ZONES uç noktaları ve görev/koşu kancaları.

| Uç | Gövde / sorgu | Yanıt |
|---|---|---|
| `GET /api/work-zones` | `?scene=` (yoksa geçerli sahne) | `{scene, default: "office", zones[{id, name, tr, en, scene, office, look, desks}]}` |
| `GET /api/work-zones/active` | — | `{scene, active[{run_id, zone, agents[], status, started_at}], defaults{slug: zone}}` (süren koşular) |
| `PUT /api/agents/{slug}/work-zone` | `{zone}` (`office` / boş = varsayılanı kaldır) | `{slug, work_zone}` · yalnız kullanıcı (MCP 403) |

Görev: `POST /api/tasks` gövdesindeki `work_zone` (`task_zone` + `attach`): yalnız kullanıcı arayüzünden (MCP 403), geçerli sahnenin
bölgesi olmalı (400); `office`/boş → graf alanı yazılmaz (bugünkü davranış). Koşu düğümüne `Run.work_zone` `GraphStore.patch_node`
ile yazılır (CDC günlüğü `user` aktörlü), `workzone.changed` yayınlanır. Koşu ayrıntısı (`GET /api/runs/{id}`) `work_zone` taşır.
Okuma uçları MCP'ye açıktır (yalnız bölge kimliği ve ajan kısa adı; içerik yok).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException, Request

from studio import workzones as wz

if TYPE_CHECKING:
    from studio.api import Studio

USER_ONLY = "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir"
ACTIVE = frozenset({"running", "pending", "waiting"})


def _user(request: Request | None) -> bool:
    """Kullanıcı arayüzünden mi (arayüz jetonu var, MCP başlığı yok) — `api.user_started` ile aynı ölçüt."""
    if request is None:
        return False
    from studio.clients.tracker import mcp_client  # noqa: PLC0415
    from studio.presence import ui_present  # noqa: PLC0415
    return not mcp_client(request) and ui_present(request)


def scene_now(S: "Studio") -> str:
    return str(S.settings.get("scene", wz.BASE_ZONE) or wz.BASE_ZONE)


def task_zone(S: "Studio", data: dict[str, Any], request: Request) -> str | None:
    """`POST /api/tasks` gövdesinin bölgesi (koşu açılmadan ÖNCE denetlenir): MCP/başlıksız süreç → 403, geçersiz → 400."""
    raw = data.get("work_zone")
    if raw is None or raw == "" or raw == wz.BASE_ZONE:
        return None
    if not _user(request):
        raise HTTPException(403, USER_ONLY)
    try:
        return wz.normalize(raw, scene_now(S))
    except wz.ZoneError as exc:
        raise HTTPException(400, str(exc)) from exc


def attach(S: "Studio", run_id: str, zone: str | None) -> None:
    """Koşu düğümüne bölgeyi yazar (GraphStore; CDC) ve `workzone.changed` yayınlar. Bölge yoksa hiçbir şey yapmaz."""
    if not zone:
        return
    live = S.engine.runs.get(run_id)
    node_id = getattr(live, "node_id", None) if live is not None else None
    if not node_id:
        node = S.store.find("Run", run_id)
        node_id = node["id"] if node else None
    if not node_id:
        return
    S.store.patch_node(node_id, {"work_zone": zone})
    agents = sorted({st.spec.agent for st in live.steps.values() if st.spec.agent}) if live is not None else []
    S.bus.publish("workzone.changed", run_id=run_id, zone=zone, agents=agents)


def run_zone(S: "Studio", run_id: str) -> str | None:
    live = S.engine.runs.get(run_id)
    node_id = getattr(live, "node_id", None) if live is not None else None
    node = S.store.get_node(node_id) if node_id else S.store.find("Run", run_id)
    zone = ((node or {}).get("props") or {}).get("work_zone")
    return zone if isinstance(zone, str) and zone else None


def decorate(S: "Studio", run_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Koşu ayrıntısına `work_zone` (varsa) ekler."""
    try:
        zone = run_zone(S, run_id)
    except (KeyError, ValueError):
        zone = None
    if zone:
        data["work_zone"] = zone
    return data


def build_router(S: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api", tags=["work-zones"])

    @r.get("/work-zones")
    def list_zones(request: Request, scene: str | None = None) -> dict[str, Any]:
        sc = (scene or scene_now(S))[:32]
        lang = "en" if str(request.headers.get("x-studio-lang") or "").lower().startswith("en") else "tr"
        return {"scene": sc, "default": wz.BASE_ZONE, "zones": [{**z, "name": z[lang]} for z in wz.zones_for(sc)]}

    @r.get("/work-zones/active")
    def active() -> dict[str, Any]:
        rows: list[dict[str, Any]] = []
        sealed = getattr(S.engine, "sealed", set())
        for run in list(S.engine.runs.values()):
            if run.status not in ACTIVE or run.id in sealed or not run.node_id:
                continue
            try:
                zone = run_zone(S, run.id)
            except KeyError:
                continue
            if not zone:
                continue
            agents = sorted({st.spec.agent for st in run.steps.values() if st.spec.agent})
            rows.append({"run_id": run.id, "zone": zone, "agents": agents, "status": run.status, "started_at": run.started_at})
        rows.sort(key=lambda x: (str(x.get("started_at") or ""), x["run_id"]))
        defaults: dict[str, str] = {}
        for n in S.store.nodes("Agent", limit=5000):
            p = n.get("props") or {}
            z = p.get("work_zone")
            if isinstance(z, str) and z and isinstance(p.get("slug"), str):
                defaults[p["slug"]] = z
        return {"scene": scene_now(S), "active": rows, "defaults": defaults}

    @r.put("/agents/{slug}/work-zone")
    async def set_default(slug: str, request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        if not _user(request):
            raise HTTPException(403, USER_ONLY)
        node = S.agents.node(slug)
        if not node:
            raise HTTPException(404, f"Ajan yok: {slug}")
        try:
            zone = wz.normalize(data.get("zone"), scene_now(S))
        except wz.ZoneError as exc:
            raise HTTPException(400, str(exc)) from exc
        if (node.get("props") or {}).get("work_zone") != zone:
            node = S.store.patch_node(node["id"], {"work_zone": zone})  # None = varsayılanı kaldır
            S.bus.publish("agent.updated", agent=S.agents.serialize(node))
        S.bus.publish("workzone.changed", agent=slug, zone=zone or wz.BASE_ZONE)
        return {"slug": slug, "work_zone": zone}

    return r
