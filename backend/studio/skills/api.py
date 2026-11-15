"""/api/skills uç noktaları — "S14 Skill'ler".

Listeleme ve ayrıntı tüm kaynaklar için; oluştur / düzenle / sil / içe aktar yalnızca VoxCrew kaynağına yazar.
Atama `studio.agents.update(slug, {"skills": [...]})` ile yapılır (HAS_SKILL kenarları orada eşlenir) ve her
ajan için `agent.updated` olayı yayınlanır. İstem aşaması `skills` (order 30) `start` içinde kaydedilir.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException, Query, Request

from studio.hermes.caps import clean_name_list
from studio.i18n import agent_lang
from studio.workflow import prompting

from .binding import MODES as BIND_MODES
from .binding import BindingError, effective
from .importplan import ImportPlanError, token_cost
from .library import ReadOnlyError, SkillError, SkillLibrary, library_for, parse_skill_md
from .snapshot import SnapshotError, collect, digest
from .stage import SkillsStage, plan_injection

if TYPE_CHECKING:
    from studio.api import Studio

ASSIGN_MODES = ("add", "remove", "set")


def _guard(fn: Any) -> Any:
    try:
        return fn()
    except KeyError as exc:
        raise HTTPException(404, str(exc).strip("'")) from exc
    except ReadOnlyError as exc:
        raise HTTPException(403, str(exc)) from exc
    except (SkillError, ImportPlanError, BindingError, SnapshotError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(500, f"Dosya işlemi başarısız: {exc}") from exc


def _brief(e: dict[str, Any]) -> dict[str, Any]:
    keep = ("id", "key", "source", "readonly", "name", "description", "version", "author", "license", "tags", "category",
            "permissions", "size_chars", "body_chars", "tokens", "updated_at", "files_count", "has_scripts", "loadable",
            "reason", "profile", "profiles", "scope", "trust", "state")
    return {k: e.get(k) for k in keep if k in e}


def agent_skill_view(lib: SkillLibrary, studio: "Studio", slug: str) -> dict[str, Any]:
    agent = studio.agents.get(slug)
    if not agent:
        raise KeyError(f"Ajan yok: {slug}")
    is_hermes = agent.get("runtime") == "hermes"
    max_chars = int(studio.settings.get("skills.max_chars", 6000) or 6000)
    plan = plan_injection(lib, agent, is_hermes=is_hermes, max_chars=max_chars, lang=agent_lang(studio.settings))
    items = []
    for r in lib.resolve_assigned(agent):
        items.append({"key": r["key"], "how": r["how"], "entry": _brief(r["entry"]) if r["entry"] else None,
                      "in_prompt": r["key"] in plan["injected"], "truncated": r["key"] in plan["truncated"],
                      "pin": pin_status(lib, slug, r["key"], r["entry"]) if r["how"] == "prompt" and r["entry"] else None})
    return {
        "slug": slug, "runtime": agent.get("runtime"), "connection": agent.get("connection"),
        "profile": agent.get("hermes_profile") or ("default" if is_hermes else None),
        "items": items, "pinning": lib.bindings.active,
        "budget": {"max_chars": max_chars, "chars": plan["chars"], "injected": plan["injected"],
                   "truncated": plan["truncated"], "omitted": plan["omitted"], "via_flags": plan["via_flags"],
                   "missing": plan["missing"], "inject": bool(studio.settings.get("skills.inject", True)),
                   "blocked": plan["blocked"], "pending": plan["pending"], "disabled": plan["disabled"],
                   "catalog_only": plan["catalog_only"], "tokens": plan["tokens"]},
    }


def live_sha(entry: dict[str, Any]) -> str | None:
    """Kaynağın şimdiki içeriğinin özeti (YALNIZ OKUR); okunamazsa None."""
    try:
        md = Path(entry["path"])
        return digest(collect(md.parent, md))
    except (SnapshotError, OSError, KeyError):
        return None


def pin_status(lib: SkillLibrary, slug: str, key: str, entry: dict[str, Any]) -> dict[str, Any]:
    """Arayüz için bağlama durumu: kip, sabit sha, durum (ok/pending/blocked/off/legacy), güncelleme bayrağı, token."""
    eff = effective(lib.bindings, lib.snapshots, slug, key)
    live = live_sha(entry)
    out: dict[str, Any] = {"mode": eff["mode"], "sha": eff["sha"], "status": eff["status"], "origin": eff.get("origin"),
                           "reason": eff.get("reason"), "live_sha": live, "latest_sha": lib.bindings.latest(key),
                           "versions": len(lib.bindings.versions(key)),
                           "update_available": bool(eff["sha"] and live and live != eff["sha"])}
    if eff["status"] == "ok":
        meta, files = eff["content"]["meta"], eff["content"]["files"]
        body = parse_skill_md(files["SKILL.md"], meta.get("name") or key)["body"]
        out["tokens"] = token_cost(key, meta.get("name"), meta.get("description"), body)
    return out


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/skills", tags=["skills"])

    def lib() -> SkillLibrary:
        return library_for(studio)

    def changed(action: str, entry: dict[str, Any] | None = None, **extra: Any) -> None:
        studio.bus.publish("skills.changed", action=action, id=(entry or {}).get("id"), **extra)

    # ---------------------------------------------------------------- liste ve özet
    @r.get("")
    def list_skills(source: str | None = None, q: str = "", tag: str | None = None, agent: str | None = None,
                    limit: int = Query(2000, le=5000), offset: int = Query(0, ge=0)) -> dict[str, Any]:
        L = lib()
        agent_node = None
        if agent:
            agent_node = studio.agents.get(agent)
            if not agent_node:
                raise HTTPException(404, f"Ajan yok: {agent}")
        items = _guard(lambda: L.list(source=source, q=q, tag=tag, agent=agent_node))
        users = L.users()
        page = items[offset:offset + limit]
        return {"items": [{**_brief(e), "agents": users.get(e["id"], [])} for e in page],
                "total": len(items), "offset": offset, "limit": limit}

    @r.get("/sources")
    def sources() -> dict[str, Any]:
        return lib().summary()

    # ---------------------------------------------------------------- ajan görünümü ve atama
    @r.get("/agents/{slug}")
    def agent_skills(slug: str) -> dict[str, Any]:
        return _guard(lambda: agent_skill_view(lib(), studio, slug))

    @r.post("/assign")
    async def assign(request: Request, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Toplu atama: {agents: [slug…], skills: [id|key…], mode: add|remove|set}. Ajan başına sonuç döner;
        bir ajandaki hata diğerlerini engellemez (ör. Hermes ajanına profilde olmayan skill).

        atama bağlamayı değiştirir (yeni atama onaylı en son sürüme bağlanır, skill yüklenebilir olur) →
        yalnız kullanıcıdan (MCP ve arayüz jetonu olmayan başlıksız süreç 403; ajan izni kapısıyla aynı `ui_present`)."""
        from studio.presence import ui_present  # noqa: PLC0415
        if not ui_present(request):
            raise HTTPException(403, "Ajanın skill atamaları MCP üzerinden değiştirilemez; uygulama arayüzünden ata")
        mode = str(data.get("mode") or "add")
        if mode not in ASSIGN_MODES:
            raise HTTPException(400, f"mode: {', '.join(ASSIGN_MODES)} olmalı")
        slugs = clean_name_list(data.get("agents"))
        wanted = clean_name_list(data.get("skills"))
        if not slugs:
            raise HTTPException(400, "agents (slug listesi) gerekli")
        if not wanted and mode != "set":
            raise HTTPException(400, "skills (kimlik listesi) gerekli")
        L = lib()
        await asyncio.to_thread(L.ensure_migrated)    # G1-D: önce bugünkü atamalar `always` olarak korunur
        keys: list[str] = []
        for w in wanted:
            try:
                keys.append(L.get(w)["key"])          # kütüphane kimliği (vox:… / hermes:… / claude:…)
            except KeyError:
                keys.append(w)                        # doğrudan atama anahtarı (ör. Hermes yükleme adı)
        results: list[dict[str, Any]] = []
        for slug in slugs:
            agent = studio.agents.get(slug)
            if not agent:
                results.append({"agent": slug, "ok": False, "error": "Ajan yok"})
                continue
            current = clean_name_list(agent.get("skills"))
            if mode == "add":
                nxt = current + [k for k in keys if k not in current]
            elif mode == "remove":
                nxt = [k for k in current if k not in keys]
            else:
                nxt = list(keys)
            if nxt == current:
                results.append({"agent": slug, "ok": True, "skills": current, "changed": False})
                continue
            try:
                updated = studio.agents.update(slug, {"skills": nxt})
            except (ValueError, KeyError) as exc:
                results.append({"agent": slug, "ok": False, "error": str(exc).strip("'"), "skills": current})
                continue
            L.enrich_graph(nxt, updated)
            # G1-D / karar 2: yeni atama `catalog` + en son onaylı sürüm (yoksa onay bekler); çıkarılanın bağlaması silinir
            L.bindings.record_new(slug, [k for k in nxt if k not in current])
            L.bindings.drop(slug, [k for k in current if k not in nxt])
            studio.bus.publish("agent.updated", agent=updated)
            results.append({"agent": slug, "ok": True, "skills": updated.get("skills") or [], "changed": True})
        ok = sum(1 for x in results if x["ok"])
        studio.bus.publish("skills.assigned", mode=mode, agents=slugs, skills=keys, ok=ok, failed=len(results) - ok)
        return {"mode": mode, "skills": keys, "results": results, "ok": ok, "failed": len(results) - ok}

    # ---------------------------------------------------------------- içe aktarma
    @r.post("/import")
    async def import_skill(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """{kind: "paste", content, id?} ya da {kind: "folder", path, id?}. Zip için /import/zip."""
        kind = str(data.get("kind") or "paste")
        sid = data.get("id") or None
        if kind == "paste":
            entry = _guard(lambda: lib().import_paste(str(data.get("content") or ""), sid))
        elif kind == "folder":
            entry = _guard(lambda: lib().import_folder(str(data.get("path") or ""), sid))
        else:
            raise HTTPException(400, "kind: paste ya da folder olmalı (zip için /api/skills/import/zip)")
        changed("import", entry, kind=kind)
        return entry

    @r.post("/import/zip")
    async def import_zip(request: Request, id: str | None = None) -> dict[str, Any]:
        """Gövde: ham zip baytları (Content-Type: application/zip). Zip slip, boyut ve dosya sayısı korumalı."""
        data = await request.body()
        entry = _guard(lambda: lib().import_zip(data, id or None))
        changed("import", entry, kind="zip")
        return entry

    # ---------------------------------------------------------------- G1-D: sürümlü, onaylı içe aktarma ve bağlama
    @r.post("/import/plan")
    async def import_plan(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """{id} (kütüphane kimliği ya da atama anahtarı) → önizleme: guard bulguları, token, fark. Hiçbir şey yazmaz."""
        ref = str((data or {}).get("id") or (data or {}).get("key") or "")
        return await asyncio.to_thread(lambda: _guard(lambda: lib().imports.plan(ref)))

    @r.post("/import/confirm")
    async def import_confirm(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Yalnız kullanıcı (USER_ONLY_RE; MCP 403): {plan_id, confirm: true, accept_risk?, agents?, mode?}."""
        data = data or {}
        agents = clean_name_list(data.get("agents"))
        mode = data.get("mode") or None
        result = await asyncio.to_thread(lambda: _guard(lambda: lib().imports.confirm(
            str(data.get("plan_id") or ""), confirm=data.get("confirm"), accept_risk=data.get("accept_risk"),
            agents=agents, mode=mode)))
        changed("version", {"id": result["id"]}, key=result["key"], sha=result["sha"], rebound=result["rebound"])
        for slug in result["rebound"]:
            agent = studio.agents.get(slug)
            if agent:
                studio.bus.publish("agent.updated", agent=agent)
        return result

    @r.post("/bind")
    async def bind(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Yalnız kullanıcı (USER_ONLY_RE; MCP 403): {agent, key, mode?, sha? | latest: true}.

        Kip değiştirir ya da ajanı onaylı başka bir sürüme geçirir (güncelleme / geri alma). Onaysız sha reddedilir."""
        data = data or {}
        slug = str(data.get("agent") or "")
        key = str(data.get("key") or "")
        mode = data.get("mode")
        if mode is not None and mode not in BIND_MODES:
            raise HTTPException(400, f"mode: {', '.join(BIND_MODES)} olmalı")
        agent = studio.agents.get(slug)
        if not agent:
            raise HTTPException(404, f"Ajan yok: {slug}")
        if key not in clean_name_list(agent.get("skills")):
            raise HTTPException(400, "Bu skill ajana atanmamış; önce ata")
        L = lib()

        def run() -> dict[str, Any]:
            L.ensure_migrated()
            store = L.bindings
            cur = store.binding(slug, key) or {"sha": store.latest(key), "mode": "catalog"}
            sha = cur.get("sha")
            if data.get("latest"):
                sha = store.latest(key)
                if not sha:
                    raise BindingError("Onaylı sürüm yok; önce içe aktarma önizlemesini onayla")
            elif data.get("sha"):
                sha = str(data["sha"])
            return store.bind(slug, key, mode=mode or cur.get("mode") or "catalog", sha=sha, origin="user")
        rec = await asyncio.to_thread(lambda: _guard(run))
        changed("bind", {"id": key}, agent=slug, key=key, mode=rec["mode"])
        studio.bus.publish("agent.updated", agent=agent)
        entry = L.resolve_key(key, hermes_agent=agent.get("runtime") == "hermes", profile=agent.get("hermes_profile"))
        return {"agent": slug, "key": key, "binding": rec,
                "pin": pin_status(L, slug, key, entry) if entry else None}

    # ---------------------------------------------------------------- oluştur
    @r.post("")
    async def create_skill(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        entry = _guard(lambda: lib().create(data))
        changed("create", entry)
        return entry

    # ---------------------------------------------------------------- tekil (en sonda: path parametresi her şeyi yakalar)
    @r.post("/{sid:path}/copy")
    async def copy_skill(sid: str, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        entry = _guard(lambda: lib().copy_to_voxcrew(sid, (data or {}).get("id") or None))
        changed("copy", entry, source=sid)
        return entry

    @r.get("/{sid:path}/versions")
    def skill_versions(sid: str) -> dict[str, Any]:
        """Onaylı sürümler (yeniden eskiye), kaynağın şimdiki özeti ve hangi ajanın hangi sürümde olduğu."""
        L = lib()
        e = _guard(lambda: L.get(sid))
        key = e["key"]
        bound = [{"agent": slug, **b} for slug, keys in L.bindings.load()["agents"].items()
                 for k, b in keys.items() if k == key and isinstance(b, dict)]
        versions = [{**v, "intact": L.snapshots.verify(key, v["sha"]) == "ok"}
                    for v in reversed(L.bindings.versions(key))]
        return {"id": e["id"], "key": key, "live_sha": live_sha(e), "versions": versions, "bindings": bound,
                "pinning": L.bindings.active}

    @r.get("/{sid:path}")
    def skill_detail(sid: str) -> dict[str, Any]:
        L = lib()
        detail = _guard(lambda: L.detail(sid))
        detail["agents"] = L.users().get(detail["id"], [])
        return detail

    @r.put("/{sid:path}")
    async def update_skill(sid: str, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        entry = _guard(lambda: lib().update(sid, data))
        changed("update", entry)
        return entry

    @r.delete("/{sid:path}")
    async def delete_skill(sid: str, request: Request) -> dict[str, Any]:
        # silme atamaları ve bağlamaları kaldırır → bağlama değiştiren uç, yalnız kullanıcıdan
        from studio.presence import ui_present  # noqa: PLC0415
        if not ui_present(request):
            raise HTTPException(403, "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir")
        result = _guard(lambda: lib().delete(sid))
        for slug in result.get("unassigned") or []:
            agent = studio.agents.get(slug)
            if agent:
                studio.bus.publish("agent.updated", agent=agent)
        changed("delete", {"id": sid}, unassigned=result.get("unassigned") or [])
        return result

    return r


async def start(studio: "Studio") -> None:
    """Açılışta: `skills` istem aşamasını kaydet (order 30) ve VoxCrew skill dizinini oluştur."""
    lib = library_for(studio)
    try:
        lib.root.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    # G1-D göçü (bir kez): bugünkü atamalar `always` + bugünkü sha ile sabitlenir; istem bayt bayt aynı kalır
    try:
        await asyncio.to_thread(lib.ensure_migrated)
    except (OSError, ValueError) as exc:  # göç açılışı engellemesin; bağlama kaydı yoksa eski davranış sürer
        import logging  # noqa: PLC0415

        logging.getLogger("studio.skills").warning("skill bağlama göçü yapılamadı: %s", exc)
    prompting.register(SkillsStage(lib))


async def stop(studio: "Studio") -> None:
    """Kapanışta: aşamayı kaldır (testlerde yeniden kayıt temiz olsun)."""
    prompting.unregister(SkillsStage.name)
