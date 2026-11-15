"""/api/hermes uç noktaları — Ekip S1.

Tüm GET'ler salt okunurdur. SOUL ve bellek PUT'ları dosyaya YAZMAZ: `studio.changes.plan_text(...)` ile
maskeli diff'li bir plan döner; uygulama yalnızca kullanıcı onayıyla `/api/changes/plans/{id}/apply` üzerinden
olur. Profil klonlama `confirm: true` ister ve `hermes profile create` komutunu yalnızca bu tıklamayla çalıştırır.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException, Query

from studio.connectors.discovery import find_hermes, hermes_version
from studio.i18n import translate
from studio.hermes.caps import (
    PROFILE_NAME_RE, REASONING_LEVELS, TRANSPORTS, HermesCaps, caps_for, fold, join_memory, run_profile_create, sha,
    split_memory,
)

if TYPE_CHECKING:
    from studio.api import Studio


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/hermes", tags=["hermes"])

    def caps() -> HermesCaps:
        return caps_for(studio.settings)

    def need_profile(profile: str) -> str:
        if profile not in caps().profile_dirs():
            raise HTTPException(404, f"Hermes profili bulunamadı: {profile}")
        return profile

    def agents_brief() -> list[dict[str, Any]]:
        out = []
        for a in studio.agents.list():
            out.append({"slug": a["slug"], "name": a.get("name"), "color": a.get("color"),
                        "runtime": a.get("runtime"), "hermes_profile": a.get("hermes_profile"),
                        "skills": list(a.get("skills") or []), "hidden": bool(a.get("hidden"))})
        return out

    def profile_agents(profile: str) -> list[dict[str, Any]]:
        return [a for a in agents_brief() if a["runtime"] == "hermes" and (a["hermes_profile"] or "default") == profile]

    def skill_users(profile: str, entry: dict[str, Any]) -> list[dict[str, Any]]:
        keys = {entry["name"], entry["load_name"], entry["rel_path"]}
        return [{"slug": a["slug"], "name": a["name"], "color": a["color"]} for a in profile_agents(profile)
                if keys & set(a["skills"])]

    # ---------------------------------------------------------------- genel bakış
    @r.get("/overview")
    def overview() -> dict[str, Any]:
        # S29: durum alanları tek bağlantı modeline uygun; okuma hatası "klasör yok" sayılmaz (status: error).
        c = caps()
        home = c.home
        exists = home.is_dir()
        exe = find_hermes(home) if exists else None
        base: dict[str, Any] = {"home": str(home), "exists": exists, "installed": bool(exe), "runner": str(exe) if exe else None,
                                "version": hermes_version(home) if exists else None, "profiles": [], "toolsets": [],
                                "registry": None, "reasoning_levels": list(REASONING_LEVELS), "transports": list(TRANSPORTS),
                                "status": "ok", "error": None}
        if not exists:
            base["status"] = "not_found"
            return base
        from studio.connectors.discovery import _looks_like_hermes_home  # noqa: PLC0415
        if not _looks_like_hermes_home(home):
            base["status"], base["installed"], base["runner"] = "empty", False, None
            return base
        try:
            profiles = []
            for info in c.profiles():
                info["agents"] = [{"slug": a["slug"], "name": a["name"], "color": a["color"]}
                                  for a in profile_agents(info["name"])]
                profiles.append(info)
            default = "default" if "default" in c.profile_dirs() else (profiles[0]["name"] if profiles else None)
            base.update(profiles=profiles, registry=c.toolset_registry()["source"],
                        toolsets=c.toolsets(default) if default else [])
            if not profiles:
                base["status"] = "empty"  # klasör var ama Hermes verisi yok (config.yaml / profiles)
        except Exception as exc:  # noqa: BLE001 - okunamayan klasör: hata yolu, "bulunamadı" değil
            base["status"], base["error"] = "error", f"{type(exc).__name__}: {exc}"[:300]
        conn = getattr(studio, "connections", None)
        if conn is not None:
            conn.feed("hermes", installed=bool(exe), install_path=str(exe) if exe else None, version=base["version"])
        return base

    @r.get("/profiles")
    def profiles() -> list[dict[str, Any]]:
        return caps().profiles()

    # ---------------------------------------------------------------- skill'ler
    @r.get("/skills")
    def skills(profile: str = "default", q: str = "", include_hidden: bool = True) -> list[dict[str, Any]]:
        need_profile(profile)
        items = caps().skills(profile)
        if not include_hidden:
            items = [s for s in items if s["listed"]]
        if q.strip():
            needle = fold(q.strip())
            items = [s for s in items if needle in fold(" ".join([s["name"], s["description"], s["category"] or "",
                                                                  " ".join(s["tags"])]))]
        users: dict[str, list[dict[str, Any]]] = {}
        for a in profile_agents(profile):
            for sk in a["skills"]:
                users.setdefault(sk, []).append({"slug": a["slug"], "name": a["name"], "color": a["color"]})
        out = []
        for s in items:
            seen: dict[str, dict[str, Any]] = {}
            for key in {s["name"], s["load_name"], s["rel_path"]}:
                for u in users.get(key, []):
                    seen[u["slug"]] = u
            out.append({**s, "agents": list(seen.values()), "reason": caps().skill_reason(s)})
        return out

    @r.get("/skills/{name:path}")
    def skill_detail(name: str, profile: str = "default") -> dict[str, Any]:
        need_profile(profile)
        try:
            detail = caps().skill_detail(profile, name)
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc
        detail["agents"] = skill_users(profile, detail)
        detail["reason"] = caps().skill_reason(detail)
        return detail

    # ---------------------------------------------------------------- araç setleri
    @r.get("/toolsets")
    def toolsets(profile: str = "default") -> list[dict[str, Any]]:
        need_profile(profile)
        return caps().toolsets(profile)

    # ---------------------------------------------------------------- SOUL.md
    @r.get("/profiles/{profile}/soul")
    def get_soul(profile: str) -> dict[str, Any]:
        need_profile(profile)
        return {**caps().soul(profile), "agents": profile_agents(profile)}

    @r.put("/profiles/{profile}/soul")
    async def put_soul(profile: str, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Yazmaz: plan döner. `base_sha` verilirse ve dosya o zamandan beri değiştiyse 409."""
        need_profile(profile)
        content = data.get("content")
        if not isinstance(content, str):
            raise HTTPException(400, "content (metin) gerekli")
        current = caps().soul(profile)
        base = data.get("base_sha")
        if base is not None and base != current["sha"]:
            raise HTTPException(409, "Dosya dışarıda değişti; yeniden yükleyip tekrar dene")
        users = [a["name"] for a in profile_agents(profile)]
        summary = f"'{profile}' profilinin kişiliği (SOUL.md) güncellenecek"
        if len(users) > 1:
            summary += f" — bu profili kullanan {len(users)} ajan etkilenir: {', '.join(users)}"
        plan = studio.changes.plan_text(current["path"], content, summary, kind="soul")
        return {**plan, "profile": profile, "affected_agents": users,
                "note": translate("Değişiklik Hermes'in bir sonraki oturumunda geçerli olur.")}

    # ---------------------------------------------------------------- MEMORY.md / USER.md
    @r.get("/profiles/{profile}/memory")
    def get_memory(profile: str) -> dict[str, Any]:
        need_profile(profile)
        return caps().memory(profile)

    @r.put("/profiles/{profile}/memory")
    async def put_memory(profile: str, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        """Yazmaz: plan döner. Girdiler `\\n§\\n` ile birleştirilir; karakter sınırı uygulanır."""
        need_profile(profile)
        which = data.get("which")
        if which not in ("memory", "user"):
            raise HTTPException(400, "which: 'memory' veya 'user' olmalı")
        if isinstance(data.get("entries"), list):
            entries = [str(e) for e in data["entries"]]
        elif isinstance(data.get("content"), str):
            entries = split_memory(data["content"])
        else:
            raise HTTPException(400, "entries (liste) ya da content (metin) gerekli")
        text = join_memory(entries)
        mem = caps().memory(profile)
        cur = mem[which]
        if len(text) > cur["limit"]:
            raise HTTPException(400, f"Karakter sınırı aşıldı: {len(text)}/{cur['limit']}. "
                                     "Hermes bu dosyayı sınırı aşınca kabul etmez; bazı girdileri kısalt.")
        base = data.get("base_sha")
        if base is not None and base != cur["sha"]:
            raise HTTPException(409, "Dosya dışarıda değişti; yeniden yükleyip tekrar dene")
        label = "MEMORY.md (ajan notları)" if which == "memory" else "USER.md (kullanıcı profili)"
        n = len(split_memory(text))
        plan = studio.changes.plan_text(cur["path"], text,
                                        f"'{profile}' profilinin {label} dosyası güncellenecek ({n} girdi, "
                                        f"{len(text)}/{cur['limit']} karakter)", kind="memory")
        return {**plan, "profile": profile, "which": which, "chars": len(text), "limit": cur["limit"],
                "sha_new": sha(text), "note": translate("Bellek oturum başında okunur; değişiklik yeni oturumda geçerli olur.")}

    # ---------------------------------------------------------------- oturumlar ve cron (salt okunur)
    @r.get("/profiles/{profile}/sessions")
    def sessions(profile: str, limit: int = Query(50, ge=1, le=500), include_hidden: bool = False) -> list[dict[str, Any]]:
        need_profile(profile)
        return caps().sessions(profile, limit, include_hidden)

    @r.get("/profiles/{profile}/cron")
    def cron(profile: str) -> list[dict[str, Any]]:
        need_profile(profile)
        return caps().cron(profile)

    # ---------------------------------------------------------------- profil klonlama (onaylı)
    @r.post("/profiles")
    async def create_profile(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        if data.get("confirm") is not True:
            raise HTTPException(400, "Profil oluşturmak için açık onay (confirm: true) gerekli")
        name = str(data.get("name") or "").strip()
        source = str(data.get("clone_from") or "default").strip()
        if not PROFILE_NAME_RE.match(name) or name == "default":
            raise HTTPException(400, "Profil adı küçük harf, rakam, '-' veya '_' içermeli, harf/rakamla başlamalı "
                                     "(en fazla 64 karakter); 'default' kullanılamaz")
        c = caps()
        c.invalidate()
        if name in c.profile_dirs() or (c.home / "profiles" / name).exists():
            raise HTTPException(409, f"'{name}' adında bir profil zaten var")
        need_profile(source)
        exe = find_hermes(c.home)
        if not exe:
            raise HTTPException(400, f"hermes.exe bulunamadı ({c.home})")
        result = await asyncio.to_thread(run_profile_create, c.home, exe, name, source)
        c.invalidate()
        if not result["ok"]:
            raise HTTPException(502, f"hermes profile create başarısız: {result['output'][-600:]}")
        synced = studio.agents.sync_profiles()  # yeni profil stüdyoda ajan olarak görünsün (arayüz listeyi yeniler)
        return {"ok": True, "name": name, "clone_from": source, "output": result["output"],
                "argv": result["argv"], "agents": synced}

    return r
