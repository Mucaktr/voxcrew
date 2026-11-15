"""Kahraman servisi: listele, önizle (plan), işe al, kaldır.

İşe alma tek işlemde şunları kurar ve hepsini `hero:<id>` izine bağlar (kaldırma eksiksiz geri alır):
1. Skill'ler: paketteki beyan edici SKILL.md (ajan dilinde) veri dizinine `skills/hero-<ad>/` olarak yazılır
   (zaten varsa kullanıcının sürümü korunur). Kod çalıştırılmaz.
2. Ajan: `AgentRegistry.create` (beyin `available_brains` ile zincirden seçilir; Hermes'e bağımlı değil), izin
   varsayılanı paketten (çoğunlukla `read`), `hero` işareti. XP/seviye yazılmaz.
3. Booster profili: ajan başına geçersiz kılma (`BoostService.set_agent_overrides`).
4. Hazır hafıza: Fact/Concept düğümleri (`source = hero:<id>`, `agent = <slug>`) + bir "Hazır hafıza" anısı (Episode),
   ajan → REMEMBERS. Ağ çağrısı yok; yalnızca yerel graf.
5. Başlangıç akışı: `kahraman-<slug>` (onay kapılı) kullanıcı akışları dizinine kaydedilir.
Araç/MCP önerileri yalnızca gösterilir; hiçbir şey kurulmaz ya da açılmaz.
"""

from __future__ import annotations

import hashlib
import json
from typing import TYPE_CHECKING, Any

from studio._edition import EDITION

from studio.graph.store import now_iso
from studio.i18n import agent_lang
from studio.ontology import normalize_key

from .presets import HeroPreset, load_all, pick, render_workflow

if TYPE_CHECKING:
    from studio.api import Studio

SOURCE_PREFIX = "hero:"
WORKFLOW_PREFIX = "kahraman-"


class HeroError(ValueError):
    pass


def _lang(lang: str | None, studio: "Studio") -> str:
    lang = (lang or "").lower()
    return lang if lang in ("tr", "en") else agent_lang(studio.settings)


class HeroService:
    def __init__(self, studio: "Studio", presets: dict[str, HeroPreset] | None = None):
        self.studio = studio
        self.presets = presets if presets is not None else load_all()

    # ------------------------------------------------------------------ okuma
    def get(self, key: str) -> HeroPreset:
        key = key.removeprefix(SOURCE_PREFIX)
        p = self.presets.get(key)
        if p is None:
            raise KeyError(f"Kahraman yok: {key}")
        return p

    def recruited(self, key: str | None = None) -> list[dict[str, Any]]:
        nodes = self.studio.store.nodes("Agent", limit=5000, order="created_at ASC")
        return [n for n in nodes if n["props"].get("hero") and (key is None or n["props"]["hero"] == key)]

    def brain_pick(self, p: HeroPreset, brains: dict[str, Any] | None = None) -> dict[str, Any]:
        """Zincirden ilk kurulu beyin. Hiçbiri yoksa son seçenek (yerel Ollama) yazılır, `ready=False`."""
        b = dict(brains if brains is not None else self.studio.agents.available_brains())
        chain = list(p.data["brains"])
        blocked = self._policy_blocked(chain)
        for kind in blocked:  # S37 model erişim politikası: engellenen beyin önerilmez (rota yine sunucuda denetlenir)
            b[kind] = False
        route = self.studio.agents._starter_brain({"brains": chain}, b)  # noqa: SLF001 - aynı başlangıç ekibi kuralı
        kind = "hermes" if route.get("runtime") == "hermes" else route["connection"]
        ready = bool(b.get(kind))
        return {"chain": chain, "pick": kind, "ready": ready and kind not in blocked, "route": route,
                "available": [c for c in chain if b.get(c)], "blocked": blocked}

    def _policy_blocked(self, chain: list[str]) -> list[str]:
        try:
            from studio.connections.policy import allowed_brain
        except ImportError:  # politika modülü yoksa (eski sürüm) süzgeç yok
            return []
        out = []
        for kind in chain:
            conn = "profile" if kind == "hermes" else kind
            try:
                if not allowed_brain(self.studio.settings, conn):
                    out.append(kind)
            except Exception:  # noqa: BLE001 - politika okunamazsa öneri engellenmez; rota yine denetlenir
                continue
        return out

    def card(self, p: HeroPreset, lang: str, brains: dict[str, Any] | None = None) -> dict[str, Any]:
        d = p.data
        brain = self.brain_pick(p, brains)
        return {
            "id": p.key, "preset_id": p.id, "archetype": d["archetype"],
            "name": p.text("name", lang), "title": p.text("title", lang), "problem": p.text("problem", lang),
            "origin": p.text("origin", lang), "catchphrase": p.text("catchphrase", lang),
            "color": d["color"], "avatar": dict(d["avatar"]), "ip_risk": p.ip_risk, "license": d["license"],
            "skills": [{"id": sid, "name": _skill_name(p.skills.get(sid, {}).get(lang, ""), sid)} for sid in d["skills"]],
            "memory_size": p.memory_size,
            "brain": {k: brain[k] for k in ("chain", "pick", "ready", "available", "blocked")},
            "boosters": dict(d.get("boosters") or {}),
            "permissions": d["permissions"], "permissions_note": pick(d.get("permissions_note"), lang),
            "tools": [{"id": t["id"], "label": t.get("label", t["id"]), "kind": t.get("kind", "mcp"),
                       "access": t["access"], "why": pick(t["why"], lang), "suggested": True, "enabled": False}
                      for t in d.get("tools") or []],
            "workflow": {"name": pick(d["workflow"]["name"], lang),
                         "description": pick(d["workflow"]["description"], lang),
                         "steps": len(d["workflow"]["steps"]),
                         "approvals": sum(1 for s in d["workflow"]["steps"] if s.get("type") == "approval")},
            "starter_tasks": [{"title": pick(t["title"], lang), "prompt": pick(t["prompt"], lang)}
                              for t in d.get("starter_tasks") or []],
            "recruited": [n["props"]["slug"] for n in self.recruited(p.key)],
        }

    def list(self, lang: str | None = None) -> list[dict[str, Any]]:
        lang = _lang(lang, self.studio)
        brains = self.studio.agents.available_brains()
        return [self.card(p, lang, brains) for p in self.presets.values()]

    def detail(self, key: str, lang: str | None = None) -> dict[str, Any]:
        lang = _lang(lang, self.studio)
        p = self.get(key)
        out = self.card(p, lang)
        out["persona"] = pick(p.data["persona"]["system"], lang)
        out["tone"] = pick(p.data["persona"]["tone"], lang)
        out["memory_preview"] = [f[lang] for f in p.data["memory"]["facts"][:5]]
        out["concepts"] = [c["name"] for c in p.data["memory"].get("concepts") or []]
        return out

    # ------------------------------------------------------------------ plan / işe al
    def plan(self, key: str, lang: str | None = None, name: str | None = None) -> dict[str, Any]:
        """Hiçbir şey yazmadan neyin oluşturulacağını döner (önizleme → onay adımı)."""
        lang = _lang(lang, self.studio)
        p = self.get(key)
        brain = self.brain_pick(p)
        lib = self._lib()
        skills = []
        for sid in p.data["skills"]:
            exists = self._skill_exists(lib, sid)
            skills.append({"id": sid, "action": "reuse" if exists else "install"})
        return {
            "hero": p.key, "lang": lang, "agent_name": (name or p.text("name", lang)).strip()[:80],
            "brain": {k: brain[k] for k in ("chain", "pick", "ready", "available", "blocked")},
            "permissions": p.data["permissions"], "skills": skills,
            "boosters": dict(p.data.get("boosters") or {}), "memory_nodes": p.memory_size,
            "workflow": pick(p.data["workflow"]["name"], lang),
            "tools_suggested": [t["id"] for t in p.data.get("tools") or []], "tools_enabled": [],
            "network": False, "xp": 0,
        }

    def recruit(self, key: str, lang: str | None = None, name: str | None = None) -> dict[str, Any]:
        lang = _lang(lang, self.studio)
        p = self.get(key)
        if not p.shippable:
            raise HeroError("Bu kahraman paketi yayımlama kapısından geçmedi (ip_risk > 1)")
        d = p.data
        brain = self.brain_pick(p)
        installed_skills = self._install_skills(p, lang)
        agent_name = (name or p.text("name", lang)).strip()[:80] or p.text("name", lang)
        data: dict[str, Any] = {
            "name": agent_name, "slug": agent_name, "role": p.text("problem", lang),
            "persona": pick(d["persona"]["system"], lang), "color": d["color"], "avatar": dict(d["avatar"]),
            "permissions": d["permissions"], "title": pick(d.get("role", {}).get("title") or d["title"], lang),
            "rank": d["role"]["rank"], "memory_scope": "shared", "memory_enabled": True,
            "skills": [f"vox:{sid}" for sid in d["skills"]], **brain["route"],
        }
        agent = self.studio.agents.create(data)
        slug = agent["slug"]
        try:
            node = self.studio.agents.node(slug)
            assert node is not None
            self.studio.store.patch_node(node["id"], {"hero": p.key})
            boosters = self._apply_boosters(slug, d.get("boosters") or {})
            memory = self.seed_memory(p, slug, node["id"], lang)
            workflow = self._save_workflow(p, slug, lang)
        except Exception:
            self.remove(slug, memory=True)
            raise
        return {"agent": self.studio.agents.get(slug), "hero": p.key, "skills": installed_skills,
                "boosters": boosters, "memory": memory, "workflow": workflow,
                "brain": {k: brain[k] for k in ("chain", "pick", "ready")}}

    # ------------------------------------------------------------------ hazır hafıza
    def seed_memory(self, p: HeroPreset, slug: str, agent_node_id: str, lang: str) -> dict[str, Any]:
        st = self.studio.store
        source = SOURCE_PREFIX + p.key
        now = now_iso()
        mem = p.data["memory"]
        concept_ids: dict[str, str] = {}
        created_concepts = 0
        for c in mem.get("concepts") or []:
            name = str(c["name"]).strip()
            existing = st.find("Concept", name)
            if existing:  # kullanıcının var olan kavramı: kaynağı değiştirilmez, yalnızca bağlanır
                concept_ids[normalize_key(name)] = existing["id"]
                continue
            node = st.upsert_node("Concept", {"name": name, "display": name, "kind": c.get("kind") or "kavram",
                                              "mentions": 1, "source": source})
            concept_ids[normalize_key(name)] = node["id"]
            created_concepts += 1
        episode = st.upsert_node("Episode", {
            "id": f"ep:{source}:{slug}", "title": ("Hazır hafıza: " if lang == "tr" else "Starter memory: ")
            + p.text("name", lang), "summary": p.text("problem", lang), "agent": slug, "extractor": "hero-seed",
            "importance": 6, "created_at": now, "source": source})
        st.link("REMEMBERS", agent_node_id, episode["id"])
        facts = 0
        with st.bulk():
            for f in mem["facts"]:
                statement = f[lang].strip()
                digest = hashlib.sha1(f"{source}|{slug}|{normalize_key(statement)}".encode("utf-8")).hexdigest()[:16]
                fact = st.upsert_node("Fact", {"hash": digest, "statement": statement, "confidence": 0.9,
                                               "importance": int(f.get("importance", 6)), "agent": slug,
                                               "created_at": now, "valid_at": now, "source": source})
                st.link("ASSERTED_IN", fact["id"], episode["id"])
                for name in f.get("about") or []:
                    cid = concept_ids.get(normalize_key(name))
                    if cid:
                        st.link("ABOUT", fact["id"], cid)
                facts += 1
        return {"facts": facts, "concepts": len(concept_ids), "concepts_created": created_concepts,
                "episode": episode["id"], "source": source}

    def seed_nodes(self, slug: str) -> list[dict[str, Any]]:
        node = self.studio.agents.node(slug)
        if not node or not node["props"].get("hero"):
            raise KeyError(f"Kahraman ajanı yok: {slug}")
        source = SOURCE_PREFIX + node["props"]["hero"]
        return [n for n in self.studio.store.find_by_prop("Fact", "source", source, limit=2000)
                if n["props"].get("agent") == slug]

    # ------------------------------------------------------------------ kaldır
    def remove(self, slug: str, memory: bool = True) -> dict[str, Any]:
        st = self.studio.store
        node = self.studio.agents.node(slug)
        if not node or not node["props"].get("hero"):
            raise KeyError(f"Kahraman ajanı yok: {slug}")
        key = node["props"]["hero"]
        source = SOURCE_PREFIX + key
        skills = [s.removeprefix("vox:") for s in node["props"].get("skills") or []]
        self.studio.agents.delete(slug)
        self._apply_boosters(slug, None)
        workflow = self._delete_workflow(slug)
        removed_skills = self._remove_unused_skills(skills, key)
        out: dict[str, Any] = {"ok": True, "agent": slug, "hero": key, "workflow": workflow,
                               "skills_removed": removed_skills, "memory_removed": 0}
        if memory:
            n = 0
            for f in st.find_by_prop("Fact", "source", source, limit=5000):
                if f["props"].get("agent") == slug:
                    st.delete_node(f["id"])
                    n += 1
            ep = st.find("Episode", f"ep:{source}:{slug}")
            if ep:
                st.delete_node(ep["id"])
                n += 1
            for c in st.find_by_prop("Concept", "source", source, limit=2000):
                if not st.neighbors(c["id"], ["ABOUT", "MENTIONS", "RELATED_TO"], "both"):
                    st.delete_node(c["id"])
                    n += 1
            out["memory_removed"] = n
        return out

    # ------------------------------------------------------------------ yardımcılar
    def _lib(self) -> Any:
        from studio.skills.library import library_for
        return library_for(self.studio)

    @staticmethod
    def _skill_exists(lib: Any, sid: str) -> bool:
        try:
            lib.get(f"vox:{sid}")
            return True
        except KeyError:
            return False

    def _install_skills(self, p: HeroPreset, lang: str) -> list[dict[str, Any]]:
        lib = self._lib()
        out = []
        for sid in p.data["skills"]:
            if self._skill_exists(lib, sid):
                out.append({"id": sid, "action": "reuse"})
                continue
            lib.create({"id": sid, "content": p.skills[sid][lang]})
            d = lib.root / sid
            manifest = json.loads((d / "skill.json").read_text("utf-8"))
            manifest["source"] = {"kind": "hero", "ref": SOURCE_PREFIX + p.key}
            (d / "skill.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8")
            lib.invalidate()
            out.append({"id": sid, "action": "install"})
        return out

    def _remove_unused_skills(self, skills: list[str], key: str) -> list[str]:
        lib = self._lib()
        removed = []
        in_use = {s.removeprefix("vox:") for a in self.studio.agents.list() for s in (a.get("skills") or [])}
        for sid in skills:
            if sid in in_use or not self._skill_exists(lib, sid):
                continue
            try:
                manifest = json.loads((lib.root / sid / "skill.json").read_text("utf-8"))
            except (OSError, ValueError):
                continue
            src = manifest.get("source") or {}
            if src.get("kind") == "hero" and src.get("ref") == SOURCE_PREFIX + key:
                lib.delete(f"vox:{sid}")
                removed.append(sid)
        return removed

    def _boost(self) -> Any:
        from studio.full.boost import boost_service
        return boost_service(self.studio)

    def _apply_boosters(self, slug: str, boosters: dict[str, bool] | None) -> dict[str, list[str]]:
        if EDITION != "full":
            return {"on": [], "off": []}  # booster yok: kahraman profili booster ayarı uygulamaz
        svc = self._boost()
        if boosters is None:  # kaldır: ajanın tüm geçersiz kılmalarını temizle
            cur = svc.agent_overrides(slug)
            return svc.set_agent_overrides(slug, {b: None for b in cur["on"] + cur["off"]})
        return svc.set_agent_overrides(slug, dict(boosters))

    def _save_workflow(self, p: HeroPreset, slug: str, lang: str) -> str | None:
        lib = self.studio.library
        wslug = WORKFLOW_PREFIX + slug
        if lib.exists(wslug):
            return None  # kullanıcının aynı adlı akışı ezilmez
        lib.save(render_workflow(p.data["workflow"], slug, lang, wslug))
        return wslug

    def _delete_workflow(self, slug: str) -> str | None:
        lib = self.studio.library
        wslug = WORKFLOW_PREFIX + slug
        try:
            spec = lib.get(wslug)
        except (KeyError, ValueError):
            return None
        agents = {s.agent for s in spec.steps if s.type != "approval"}
        if agents != {slug}:
            return None  # kullanıcı değiştirmiş ya da başka ajan eklemiş: dokunma
        try:
            lib.delete(wslug)
        except (KeyError, ValueError):
            return None
        return wslug


def _skill_name(md: str, fallback: str) -> str:
    for line in md.splitlines()[:8]:
        if line.startswith("name:"):
            return line.split(":", 1)[1].strip().strip('"')
    return fallback


def service_for(studio: "Studio") -> HeroService:
    svc = getattr(studio, "_hero_service", None)
    if svc is None:
        svc = HeroService(studio)
        studio._hero_service = svc  # type: ignore[attr-defined]
    return svc
