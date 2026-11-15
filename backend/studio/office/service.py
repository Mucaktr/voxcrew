"""Ofis servisi: Team ve Role düğümleri, üye atama (MEMBER_OF / REPORTS_TO / LEADS / HAS_ROLE / ROLE_IN
kenarları), rütbeler, işe alınanlar ve şablondan ofis kurulumu (beyin stratejisiyle).

Doğruluk kaynağı Agent özellikleridir (team, title, reports_to, rank); kenarlar her yazımda bunlarla eşitlenir.
Rol ataması HAS_ROLE kenarıdır (rol başına tek taşıyıcı, ajan başına tek rol). Hiçbir işlem Hermes profil
dosyalarına dokunmaz; ajanlar stüdyo ajanı olarak oluşturulur.
"""

from __future__ import annotations

import asyncio
import re
from typing import TYPE_CHECKING, Any, Callable

from studio.agents import PALETTE, slugify
from studio.graph.store import now_iso
from studio.office import catalog
from studio.office.ranks import RANK_LABELS, RANKS, rank_label, rank_order_warning
from studio.workflow.spec import parse, validate

if TYPE_CHECKING:
    from studio.api import Studio


class OfficeError(ValueError):
    pass


BRAINS = ("codex", "ollama", "claude", "profile")
RUNTIMES = ("hermes", "direct")
STRATEGIES = ("economy", "balanced", "quality")
STRATEGY_LABELS = {"economy": "Tasarruf", "balanced": "Dengeli", "quality": "Kalite"}
BRAIN_LABELS = {"codex": "Codex", "claude": "Claude Code", "ollama": "Ollama", "profile": "Hermes profili"}
TEAM_PALETTE = ["#7C5CFF", "#3B82F6", "#EF4444", "#F59E0B", "#10B981", "#EC4899", "#14B8A6", "#64748B"]
_HEX = re.compile(r"^#[0-9a-fA-F]{3,8}$")
TEAM_EDITABLE = ("name", "mission", "color", "icon", "order")
ROLE_EDITABLE = ("name", "description", "team", "rank", "skills_hint", "brain_hint")


def default_profile(profiles: list[str]) -> str | None:
    """Varsayılan Hermes profili: "default" dışındaki ilk profil, yoksa "default", hiç yoksa None (Hermes yok)."""
    named = [p for p in profiles if p != "default"]
    return named[0] if named else (profiles[0] if profiles else None)


class Office:
    def __init__(self, studio: "Studio"):
        self.studio = studio

    @property
    def store(self):  # noqa: ANN201 - GraphStore
        return self.studio.store

    @property
    def agents(self):  # noqa: ANN201 - AgentRegistry
        return self.studio.agents

    def _publish(self, kind: str, **data: Any) -> None:
        bus = getattr(self.studio, "bus", None)
        if bus is not None:
            bus.publish(kind, **data)

    # ------------------------------------------------------------------ okuma
    def team_nodes(self) -> list[dict[str, Any]]:
        nodes = self.store.nodes("Team", limit=1000)
        return sorted(nodes, key=lambda n: (n["props"].get("order", 0), n["created_at"], n["props"]["slug"]))

    def members(self) -> list[dict[str, Any]]:
        teams = {n["props"]["slug"] for n in self.team_nodes()}
        nodes = sorted(self.store.nodes("Agent", limit=1000), key=lambda n: n["created_at"])
        slugs = {n["props"]["slug"] for n in nodes}
        # N+1 yerine tek toplu sorgu (S15): ajan → HAS_ROLE → Role
        role_nb = self.store.neighbors_many([n["id"] for n in nodes], ["HAS_ROLE"], "out")
        out = []
        for n in nodes:
            p = n["props"]
            role = next((nb for _e, nb, _d in role_nb.get(n["id"], []) if nb["type"] == "Role"), None)
            out.append({
                "slug": p["slug"], "name": p.get("name") or p["slug"], "title": p.get("title") or None,
                "team": p.get("team") if p.get("team") in teams else None,
                "reports_to": p.get("reports_to") if p.get("reports_to") in slugs else None,
                "avatar": p.get("avatar") or {}, "color": p.get("color") or PALETTE[0],
                "role": p.get("role", ""), "hidden": bool(p.get("hidden")), "created_by": p.get("created_by"),
                "rank": p.get("rank") or None, "rank_label": rank_label(p.get("rank") or ""),
                "hired_by": p.get("hired_by") or None, "hired_in_run": p.get("hired_in_run") or None,
                "role_id": role["props"]["id"] if role else None,
                "role_name": (role["props"].get("name") or role["props"]["id"]) if role else None,
            })
        return out

    def _role_of(self, agent_node_id: str) -> dict[str, Any] | None:
        roles = [nb for _e, nb, _d in self.store.neighbors(agent_node_id, ["HAS_ROLE"], "out") if nb["type"] == "Role"]
        return roles[0] if roles else None

    def _team_info(self, node: dict[str, Any], members: list[dict[str, Any]]) -> dict[str, Any]:
        p = node["props"]
        slug = p["slug"]
        mine = [m["slug"] for m in members if m["team"] == slug]
        lead = p.get("lead")
        return {
            "slug": slug, "name": p.get("name") or slug, "mission": p.get("mission") or "",
            "color": p.get("color") or TEAM_PALETTE[0], "icon": p.get("icon") or "users",
            "lead": lead if lead and any(m["slug"] == lead for m in members) else None,
            "order": p.get("order", 0), "template": p.get("template"),
            "created_at": p.get("created_at") or node["created_at"], "members": mine,
        }

    def teams(self) -> list[dict[str, Any]]:
        members = self.members()
        return [self._team_info(n, members) for n in self.team_nodes()]

    def team(self, slug: str) -> dict[str, Any]:
        node = self._team_node(slug)
        return self._team_info(node, self.members())

    def overview(self, templates: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        members = self.members()
        return {"teams": [self._team_info(n, members) for n in self.team_nodes()], "members": members,
                "roles": self.roles(), "ranks": [{"id": r, "label": rank_label(r)} for r in RANKS],
                "templates": [catalog.summary(t) for t in (templates if templates is not None
                                                            else catalog.load_templates())]}

    # ------------------------------------------------------------------ roller (QA-M1, m15)
    def _role_info(self, node: dict[str, Any]) -> dict[str, Any]:
        p = node["props"]
        holders = sorted((nb for _e, nb, _d in self.store.neighbors(node["id"], ["HAS_ROLE"], "in")
                          if nb["type"] == "Agent"), key=lambda n: n["created_at"])
        visible = [h for h in holders if not h["props"].get("hidden")]
        return {"id": p["id"], "name": p.get("name") or p["id"], "description": p.get("description") or "",
                "team": p.get("team") if p.get("team") and self.store.find("Team", p["team"]) else None,
                "rank": p.get("rank") or None, "rank_label": rank_label(p.get("rank") or ""),
                "skills_hint": list(p.get("skills_hint") or []), "brain_hint": p.get("brain_hint") or None,
                "template": p.get("template"), "created_at": p.get("created_at") or node["created_at"],
                "holder": visible[0]["props"]["slug"] if visible else None,
                "holders": [h["props"]["slug"] for h in holders]}

    def roles(self) -> list[dict[str, Any]]:
        nodes = sorted(self.store.nodes("Role", limit=2000), key=lambda n: (n["created_at"], n["props"]["id"]))
        return [self._role_info(n) for n in nodes]

    def role(self, role_id: str) -> dict[str, Any]:
        return self._role_info(self._role_node(role_id))

    def _role_node(self, role_id: str) -> dict[str, Any]:
        node = self.store.find("Role", role_id) if role_id else None
        if not node:
            raise KeyError(f"Rol yok: {role_id}")
        return node

    def roles_with_holders(self) -> set[str]:
        """İş akışı doğrulaması için: taşıyıcısı (görünür ajanı) olan Role.id kümesi."""
        return {r["id"] for r in self.roles() if r["holder"]}

    def _clean_role_fields(self, data: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if "name" in data:
            name = str(data.get("name") or "").strip()
            if not name:
                raise OfficeError("Rol adı boş olamaz")
            out["name"] = name[:60]
        if "description" in data:
            out["description"] = str(data.get("description") or "").strip()[:1200]
        if "team" in data:
            team = str(data["team"]).strip() if data.get("team") else None
            if team and not self.store.find("Team", team):
                raise OfficeError(f"Ekip yok: {team}")
            out["team"] = team
        if "rank" in data:
            rank = data.get("rank") or None
            if rank is not None and rank not in RANKS:
                raise OfficeError(f"Rütbe şunlardan biri olmalı: {', '.join(RANKS)}")
            out["rank"] = rank
        if "skills_hint" in data:
            hints = data.get("skills_hint") or []
            if not isinstance(hints, list):
                raise OfficeError("skills_hint bir liste olmalı")
            out["skills_hint"] = [str(h).strip()[:64] for h in hints if str(h).strip()][:20]
        if "brain_hint" in data:
            hint = data.get("brain_hint") or None
            if hint is not None and hint not in catalog.BRAIN_HINTS:
                raise OfficeError("Beyin ağırlığı light, standard ya da heavy olmalı")
            out["brain_hint"] = hint
        return out

    def _sync_role_team(self, node: dict[str, Any]) -> None:
        self.store.unlink("ROLE_IN", node["id"])
        team = node["props"].get("team")
        if team and (team_node := self.store.find("Team", team)):
            self.store.link("ROLE_IN", node["id"], team_node["id"])

    def create_role(self, data: dict[str, Any]) -> dict[str, Any]:
        fields = self._clean_role_fields({"name": data.get("name"), **{k: data[k] for k in ROLE_EDITABLE
                                                                      if k in data and k != "name"}})
        base = slugify(str(data.get("id") or fields["name"]))[:40].strip("-") or "rol"
        rid, n = base, 2
        while self.store.find("Role", rid):
            rid, n = f"{base}-{n}", n + 1
        node = self.store.upsert_node("Role", {"id": rid, **{k: v for k, v in fields.items() if v not in (None, [])},
                                               "created_at": now_iso()})
        self._sync_role_team(node)
        if data.get("holder"):
            self.set_role_holder(rid, str(data["holder"]), publish=False)
        self._publish("office.changed", role=rid)
        return self.role(rid)

    def update_role(self, role_id: str, data: dict[str, Any]) -> dict[str, Any]:
        node = self._role_node(role_id)
        fields = self._clean_role_fields({k: v for k, v in data.items() if k in ROLE_EDITABLE})
        if fields:
            node = self.store.patch_node(node["id"], fields)
            if "team" in fields:
                self._sync_role_team(node)
        if "holder" in data:
            self.set_role_holder(role_id, str(data["holder"]) if data.get("holder") else None, publish=False)
        self._publish("office.changed", role=role_id)
        return self.role(role_id)

    def delete_role(self, role_id: str) -> dict[str, Any]:
        node = self._role_node(role_id)
        self.store.delete_node(node["id"])  # HAS_ROLE / ROLE_IN kenarları ON DELETE CASCADE ile silinir
        self._publish("office.changed", role=role_id)
        return {"ok": True}

    def set_role_holder(self, role_id: str, agent_slug: str | None, publish: bool = True) -> dict[str, Any]:
        """Rolü bir ajana verir (rolün önceki taşıyıcısı ve ajanın önceki rolü bırakılır) ya da boşaltır."""
        role = self._role_node(role_id)
        agent = None
        if agent_slug:
            agent = self.agents.node(agent_slug)
            if not agent:
                raise OfficeError(f"Ajan yok: {agent_slug}")
        for _e, nb, _d in self.store.neighbors(role["id"], ["HAS_ROLE"], "in"):
            self.store.unlink("HAS_ROLE", nb["id"], role["id"])
        if agent:
            self.store.unlink("HAS_ROLE", agent["id"])
            self.store.link("HAS_ROLE", agent["id"], role["id"])
        if publish:
            self._publish("office.changed", role=role_id, agent=agent_slug)
        return self.role(role_id)

    def _team_node(self, slug: str) -> dict[str, Any]:
        node = self.store.find("Team", slug)
        if not node:
            raise KeyError(f"Ekip yok: {slug}")
        return node

    def _agent_node(self, slug: str) -> dict[str, Any]:
        node = self.agents.node(slug)
        if not node:
            raise KeyError(f"Ajan yok: {slug}")
        return node

    # ------------------------------------------------------------------ ekipler
    def _free_team_slug(self, base: str) -> str:
        root = slugify(base)
        slug, n = root, 2
        while self.store.find("Team", slug):
            slug = f"{root}-{n}"
            n += 1
        return slug

    @staticmethod
    def _clean_team_fields(data: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if "name" in data:
            name = str(data.get("name") or "").strip()
            if not name:
                raise OfficeError("Ekip adı boş olamaz")
            out["name"] = name[:60]
        if "mission" in data:
            out["mission"] = str(data.get("mission") or "").strip()[:600]
        if "color" in data and data["color"] is not None:
            color = str(data["color"]).strip()
            if not _HEX.match(color):
                raise OfficeError("Renk #RRGGBB biçiminde olmalı")
            out["color"] = color
        if "icon" in data and data["icon"] is not None:
            out["icon"] = str(data["icon"]).strip()[:32] or "users"
        if "order" in data and data["order"] is not None:
            try:
                out["order"] = int(data["order"])
            except (TypeError, ValueError):
                raise OfficeError("Sıra bir tam sayı olmalı") from None
        return out

    def _next_order(self) -> int:
        return max((n["props"].get("order", 0) for n in self.team_nodes()), default=0) + 1

    def create_team(self, data: dict[str, Any]) -> dict[str, Any]:
        fields = self._clean_team_fields({"name": data.get("name"), **{k: data[k] for k in data if k != "name"}})
        if data.get("lead") and not self.agents.node(str(data["lead"])):
            raise OfficeError(f"Lider olarak seçilen ajan yok: {data['lead']}")
        count = len(self.team_nodes())
        props = {
            "slug": self._free_team_slug(str(data.get("slug") or fields["name"])),
            "name": fields["name"],
            "mission": fields.get("mission", ""),
            "color": fields.get("color") or TEAM_PALETTE[count % len(TEAM_PALETTE)],
            "icon": fields.get("icon") or "users",
            "order": fields.get("order", self._next_order()),
            "created_at": now_iso(),
        }
        if data.get("template"):
            props["template"] = str(data["template"])
        node = self.store.upsert_node("Team", props)
        if data.get("lead"):
            self._set_lead(node, str(data["lead"]))
        self._publish("office.changed", team=props["slug"])
        return self.team(props["slug"])

    def update_team(self, slug: str, data: dict[str, Any]) -> dict[str, Any]:
        node = self._team_node(slug)
        fields = self._clean_team_fields({k: v for k, v in data.items() if k in TEAM_EDITABLE})
        if fields:
            node = self.store.patch_node(node["id"], fields)
        if "lead" in data:
            self._set_lead(node, str(data["lead"]) if data["lead"] else None)
        self._publish("office.changed", team=slug)
        return self.team(slug)

    def delete_team(self, slug: str) -> dict[str, Any]:
        node = self._team_node(slug)
        released = [m["slug"] for m in self.members() if m["team"] == slug]
        for agent_slug in released:
            agent = self.agents.update(agent_slug, {"team": None})
            self._publish("agent.updated", agent=agent)
        for role in self.store.find_by_prop("Role", "team", slug, limit=2000):
            self.store.patch_node(role["id"], {"team": None})  # rol silinmez, ekipsiz kalır
        self.store.delete_node(node["id"])  # MEMBER_OF / LEADS / ROLE_IN kenarları ON DELETE CASCADE ile silinir
        self._publish("office.changed", team=slug)
        return {"ok": True, "released": released}

    def _set_lead(self, team_node: dict[str, Any], agent_slug: str | None) -> None:
        for _e, nb, _d in self.store.neighbors(team_node["id"], ["LEADS"], "in"):
            self.store.unlink("LEADS", nb["id"], team_node["id"])
        if agent_slug:
            agent = self.agents.node(agent_slug)
            if not agent:
                raise OfficeError(f"Lider olarak seçilen ajan yok: {agent_slug}")
            self.store.link("LEADS", agent["id"], team_node["id"])
        self.store.patch_node(team_node["id"], {"lead": agent_slug or None})

    # ------------------------------------------------------------------ üyeler
    def _would_cycle(self, agent_slug: str, manager_slug: str) -> bool:
        seen: set[str] = set()
        cur: str | None = manager_slug
        while cur:
            if cur == agent_slug:
                return True
            if cur in seen:  # var olan bozuk döngü: yeni bağlantıyı da reddet
                return True
            seen.add(cur)
            node = self.agents.node(cur)
            cur = node["props"].get("reports_to") if node else None
        return False

    def rank_warnings(self, slug: str) -> list[str]:
        """Raporlama hattı rütbe sırasına uymuyorsa uyarılar (engellemez): ajan ↔ yöneticisi ve ajan ↔ astları."""
        node = self.agents.node(slug)
        if not node:
            return []
        p = node["props"]
        out: list[str] = []
        boss = self.agents.node(p.get("reports_to") or "") if p.get("reports_to") else None
        if boss:
            w = rank_order_warning(p.get("rank"), boss["props"].get("rank"), p.get("name") or slug,
                                   boss["props"].get("name") or boss["props"]["slug"])
            if w:
                out.append(w)
        for sub in self.store.find_by_prop("Agent", "reports_to", slug, limit=500):
            w = rank_order_warning(sub["props"].get("rank"), p.get("rank"),
                                   sub["props"].get("name") or sub["props"]["slug"], p.get("name") or slug)
            if w:
                out.append(w)
        return out

    def assign(self, slug: str, data: dict[str, Any]) -> dict[str, Any]:
        """{team?, title?, reports_to?, rank?, role_id?} — döngü reddedilir; rütbe sırası tutarsızsa yalnızca uyarılır."""
        node = self._agent_node(slug)
        old = node["props"]
        patch: dict[str, Any] = {}
        team_node = manager = None
        if "rank" in data:
            rank = data.get("rank") or None
            if rank is not None and rank not in RANKS:
                raise OfficeError(f"Rütbe şunlardan biri olmalı: {', '.join(RANKS)}")
            patch["rank"] = rank
        if "role_id" in data and data.get("role_id"):
            self._role_node(str(data["role_id"]))  # yoksa 404
        if "team" in data:
            team = str(data["team"]).strip() if data["team"] else None
            if team:
                team_node = self.store.find("Team", team)
                if not team_node:
                    raise OfficeError(f"Ekip yok: {team}")
            patch["team"] = team
        if "title" in data:
            title = str(data["title"]).strip()[:60] if data["title"] else ""
            patch["title"] = title or None
        if "reports_to" in data:
            boss = str(data["reports_to"]).strip() if data["reports_to"] else None
            if boss:
                if boss == slug:
                    raise OfficeError("Bir ajan kendisine raporlayamaz")
                manager = self.agents.node(boss)
                if not manager:
                    raise OfficeError(f"Yönetici olarak seçilen ajan yok: {boss}")
                if self._would_cycle(slug, boss):
                    raise OfficeError("Bu atama raporlama hattında döngü oluşturur")
            patch["reports_to"] = boss
        if "role_id" in data:
            role_id = str(data["role_id"]) if data.get("role_id") else None
            if role_id:
                self.set_role_holder(role_id, slug, publish=False)
            else:
                self.store.unlink("HAS_ROLE", node["id"])
            if not patch:
                self._publish("office.changed", agent=slug)
        if not patch:
            return {**self.agents.serialize(self._agent_node(slug)), "warnings": self.rank_warnings(slug)}

        agent = self.agents.update(slug, patch)
        if "team" in patch:
            self.store.unlink("MEMBER_OF", node["id"])
            if team_node:
                self.store.link("MEMBER_OF", node["id"], team_node["id"])
            prev = old.get("team")
            if prev and prev != patch["team"]:
                prev_node = self.store.find("Team", prev)
                if prev_node and prev_node["props"].get("lead") == slug:
                    self._set_lead(prev_node, None)
        if "reports_to" in patch:
            self.store.unlink("REPORTS_TO", node["id"])
            if manager:
                self.store.link("REPORTS_TO", node["id"], manager["id"])
        self._publish("agent.updated", agent=agent)
        self._publish("office.changed", agent=slug)
        return {**agent, "warnings": self.rank_warnings(slug)}

    # ------------------------------------------------------------------ işe alınanlar
    def fire(self, slug: str, mode: str = "hide") -> dict[str, Any]:
        """İşe alınan ajanı işten çıkarır: 'hide' gizler (geri alınabilir), 'delete' siler. Astları, çıkarılan
        ajanın yöneticisine bağlanır; liderliği ve rolü bırakılır. Yalnızca devretmede işe alınan ajanlar için."""
        node = self._agent_node(slug)
        p = node["props"]
        if not p.get("hired_by"):
            raise OfficeError("Yalnızca devretme sırasında işe alınan ajanlar işten çıkarılabilir; "
                              "diğer ajanları ajan ayarlarından kaldırabilirsin")
        if mode not in ("hide", "delete"):
            raise OfficeError("Kip 'hide' ya da 'delete' olmalı")
        boss = p.get("reports_to") if p.get("reports_to") and self.agents.node(p["reports_to"]) else None
        moved = []
        for sub in self.store.find_by_prop("Agent", "reports_to", slug, limit=500):
            sub_slug = sub["props"]["slug"]
            updated = self.agents.update(sub_slug, {"reports_to": boss if boss != sub_slug else None})
            moved.append(sub_slug)
            self._publish("agent.updated", agent=updated)
        for team in self.team_nodes():
            if team["props"].get("lead") == slug:
                self._set_lead(team, None)
        self.store.unlink("HAS_ROLE", node["id"])
        if mode == "delete":
            self.agents.delete(slug)
            self._publish("agent.removed", agent=slug)
        else:
            self.store.patch_node(node["id"], {"benched": True})  # gizli ajan koltuk sayılır; çıkarılan koltuğu bırakır
            agent = self.agents.update(slug, {"hidden": True})
            self._publish("agent.updated", agent=agent)
        self._publish("office.changed", agent=slug, fired=mode)
        return {"ok": True, "mode": mode, "reassigned": moved, "new_manager": boss}

    # ------------------------------------------------------------------ şablondan kurulum
    def hermes_profiles(self) -> list[str]:
        """Gerçek Hermes profilleri (QA-m10: kurulum ve arayüz seçenekleri buradan gelir)."""
        try:
            return list(self.agents.caps.profile_dirs().keys())
        except Exception:  # noqa: BLE001 - Hermes yoksa boş liste
            return []

    async def availability(self) -> dict[str, Any]:
        """Kurulumdaki beyin bağlantıları; strateji yalnızca bunlardan seçer. Süreç başlatmayan
        `AgentRegistry.available_brains` (S8) varsa o, yoksa önbellekli bağlantı yoklaması kullanılır.
        model politikasının izin vermediği beyin (ör. güvenli mod / local_only'de Codex, Claude Code) mevcut
        sayılmaz; şablon ajanları yalnız çalışabilecekleri beyinle kurulur."""
        return self._policy_filter(await self._raw_availability())

    def _policy_filter(self, avail: dict[str, Any]) -> dict[str, Any]:
        from studio.connections.policy import allowed_brain  # noqa: PLC0415

        out = dict(avail)
        settings = self.studio.settings
        try:
            for key, conn in (("codex", "codex"), ("claude", "claude"), ("hermes", "profile")):
                if out.get(key) and not allowed_brain(settings, conn):
                    out[key] = False
            if out.get("ollama") and not allowed_brain(settings, "ollama", out.get("ollama_model")):
                out["ollama"] = False
        except Exception:  # noqa: BLE001 - politika okunamazsa rota denetimi yine geçerli
            return avail
        return out

    async def _raw_availability(self) -> dict[str, Any]:
        profiles = self.hermes_profiles()
        ollama_model = self.agents.default_ollama_model(for_hermes=False)
        brains = getattr(self.agents, "available_brains", None)
        if callable(brains):
            try:
                b = await asyncio.to_thread(brains)
                return {"hermes": bool(b.get("hermes")) and bool(profiles), "codex": bool(b.get("codex")),
                        "claude": bool(b.get("claude")), "ollama": bool(b.get("ollama")),
                        "ollama_model": ollama_model, "profiles": profiles}
            except Exception:  # noqa: BLE001 - yoklamaya düş
                pass
        try:
            conns = await self.studio.probe.get()
        except Exception:  # noqa: BLE001 - yoklama hatası: hiçbir bağlantı yok sayılır
            conns = []
        by = {c.get("kind"): c for c in conns}
        ollama = by.get("ollama") or {}
        return {"hermes": bool((by.get("hermes") or {}).get("available")) and bool(profiles),
                "codex": bool((by.get("codex") or {}).get("available")),
                "claude": bool((by.get("claude") or {}).get("available")),
                "ollama": bool(ollama.get("available")) and bool(ollama_model or ollama.get("models")),
                "ollama_model": ollama_model, "profiles": profiles}

    @staticmethod
    def brain_label(b: dict[str, Any]) -> str:
        name = BRAIN_LABELS.get(b["brain"], b["brain"])
        if b["brain"] == "profile":
            return f"{name} ({b.get('hermes_profile')})"
        if b["runtime"] == "hermes":
            return f"{name} · Hermes ({b.get('hermes_profile')})"
        if b["brain"] == "ollama" and b.get("model"):
            return f"{name} · {b['model']}"
        return name

    def plan_brains(self, t: dict[str, Any], data: dict[str, Any], avail: dict[str, Any] | None) -> dict[str, Any]:
        """Rol başına beyin. `strategy` (economy | balanced | quality) verilirse rolün `brain_hint`'ine ve yalnızca
        kurulumda MEVCUT bağlantılara göre seçilir (QA-M5); verilmezse eski tek-beyin yolu (`brain`)."""
        avail = avail or {"profiles": self.hermes_profiles()}
        profiles = list(avail.get("profiles") or [])
        warnings: list[str] = []
        requested = str(data.get("hermes_profile") or "").strip() or None
        if requested and requested not in profiles:
            raise OfficeError(f"Hermes profili bulunamadı: {requested}"
                              + (f" (mevcut: {', '.join(profiles)})" if profiles else " (Hermes profili yok)"))
        profile = requested or default_profile(profiles)
        model = str(data.get("model") or "").strip() or None
        strategy = data.get("strategy") or None
        roles = t.get("roles") or []

        if strategy is None:  # tek beyin (Faz 2 sözleşmesi)
            brain = str(data.get("brain") or "codex")
            if brain not in BRAINS:
                raise OfficeError(f"Beyin şunlardan biri olmalı: {', '.join(BRAINS)}")
            asked = data.get("runtime")
            runtime = str(asked or ("hermes" if brain in ("codex", "profile") else "direct"))
            if runtime not in RUNTIMES:
                raise OfficeError("Çalışma zamanı 'hermes' ya da 'direct' olmalı")
            if brain == "profile":
                runtime = "hermes"
            if brain == "claude":
                runtime = "direct"
            if runtime == "hermes" and not profile:
                if brain == "profile" or asked == "hermes":
                    raise OfficeError("Hermes profili bulunamadı; Hermes çalışma zamanı kullanılamaz")
                runtime = "direct"  # Hermes yoksa Codex doğrudan çalışır
                warnings.append("Hermes profili yok: Codex doğrudan (Hermes'siz) kullanılacak")
            single = {"brain": brain, "runtime": runtime, "hermes_profile": profile if runtime == "hermes" else None,
                      "model": model}
            return {"strategy": None, "single": single, "roles": {r["key"]: dict(single) for r in roles},
                    "profile": profile, "warnings": warnings}

        if strategy not in STRATEGIES:
            raise OfficeError("Strateji economy (Tasarruf), balanced (Dengeli) ya da quality (Kalite) olmalı")
        hermes_ok = bool(avail.get("hermes")) and profile is not None
        strong = next((k for k in ("codex", "claude") if avail.get(k)), None) \
            or ("profile" if hermes_ok else None) or ("ollama" if avail.get("ollama") else None)
        if strong is None:
            strong = "codex"
            warnings.append("Hiçbir beyin bağlantısı algılanmadı; roller Codex ile kuruldu. Bağlantıyı kurunca "
                            "çalışır ya da ajan ayarlarından beyni değiştirebilirsin.")
        light = "ollama" if avail.get("ollama") else strong
        if strategy != "quality" and not avail.get("ollama"):
            warnings.append("Ollama bulunamadı: hafif roller de güçlü beyinle kuruldu")

        def make(kind: str) -> dict[str, Any]:
            if kind == "codex":
                return {"brain": "codex", "runtime": "hermes" if hermes_ok else "direct",
                        "hermes_profile": profile if hermes_ok else None, "model": None}
            if kind == "profile":
                return {"brain": "profile", "runtime": "hermes", "hermes_profile": profile, "model": None}
            if kind == "claude":
                return {"brain": "claude", "runtime": "direct", "hermes_profile": None, "model": None}
            return {"brain": "ollama", "runtime": "direct", "hermes_profile": None,
                    "model": model or avail.get("ollama_model")}

        out: dict[str, dict[str, Any]] = {}
        for r in roles:
            weight = r.get("brain_hint") or "standard"
            if strategy == "quality":
                kind = strong
            elif strategy == "economy":
                kind = strong if weight == "heavy" else light
            else:
                kind = light if weight == "light" else strong
            out[r["key"]] = make(kind)
        return {"strategy": strategy, "single": None, "roles": out, "profile": profile, "warnings": warnings,
                "strong": make(strong), "light": make(light)}

    def _skill_index(self, profile: str | None) -> dict[str, Any] | None:
        if not profile:
            return None
        try:
            return self.agents.caps.skill_index(profile)
        except Exception:  # noqa: BLE001 - profil okunamazsa öneriler "kurulu değil" görünür
            return None

    def _installed(self, index: dict[str, Any] | None, name: str) -> bool:
        if not index or name not in index:
            return False
        return self.agents.caps.skill_reason(index[name]) is None

    def preview(self, template_id: str, data: dict[str, Any], avail: dict[str, Any] | None = None) -> dict[str, Any]:
        """Kurulum önizlemesi (yazmaz): rol başına beyin, kurulu/kurulu olmayan skill önerileri ve
        "X adım Codex, Y adım Ollama" sayımı (QA-M2, M5, E4.5-c)."""
        t = catalog.localize_template(catalog.get_template(template_id))  # istek dilinde adlar/unvanlar
        problems = catalog.check_template(t)
        if problems:
            raise OfficeError("; ".join(problems))
        prefix = self._prefix(data)
        plan = self.plan_brains(t, data, avail)
        index = self._skill_index(plan["profile"])
        existing = {a["slug"] for a in self.agents.list()}

        def sl(key: str) -> str:
            return f"{prefix}-{key}" if prefix else key

        roles = []
        brain_counts: dict[str, int] = {}
        seat_of = self.seat_plan(t, sl, existing)
        for r in t.get("roles") or []:
            b = plan["roles"][r["key"]]
            label = BRAIN_LABELS.get(b["brain"], b["brain"])
            brain_counts[label] = brain_counts.get(label, 0) + 1
            roles.append({"key": r["key"], "slug": sl(r["key"]), "exists": sl(r["key"]) in existing,
                          "name": r.get("name"), "title": r.get("title"), "team": r.get("team"),
                          "rank": r.get("rank"), "rank_label": rank_label(r.get("rank") or ""),
                          "brain_hint": r.get("brain_hint") or "standard",
                          "brain": {**b, "label": self.brain_label(b)}, "seat": seat_of.get(r["key"]),
                          "skills": [{"name": s, "installed": self._installed(index, s)}
                                     for s in r.get("skills_hint") or []]})
        step_counts: dict[str, int] = {}
        for s in (t.get("workflow") or {}).get("steps") or []:
            if s.get("type", "agent") in ("agent", "delegate"):
                b = plan["roles"].get(catalog.step_role_key(s) or "")
                if b:
                    label = BRAIN_LABELS.get(b["brain"], b["brain"])
                    step_counts[label] = step_counts.get(label, 0) + 1
        summary = ", ".join(f"{n} adım {label}" for label, n in sorted(step_counts.items(), key=lambda x: -x[1]))
        fresh = sum(1 for r in roles if not r["exists"])
        return {"template": t["id"], "prefix": prefix, "strategy": plan["strategy"],
                "install_order": [sl(k) for k in catalog.install_order(t)],
                "strategy_label": STRATEGY_LABELS.get(plan["strategy"] or ""), "profile": plan["profile"],
                "profiles": list((avail or {}).get("profiles") or self.hermes_profiles()),
                "available": ({k: bool(avail.get(k)) for k in ("hermes", "codex", "claude", "ollama")}
                              if avail else None),
                "skills_source": plan["profile"] if index is not None else None,
                "roles": roles, "brain_counts": brain_counts, "step_counts": step_counts, "step_summary": summary,
                "counts": {"new": fresh, "existing": len(roles) - fresh}, "warnings": plan["warnings"],
                "workflow_exists": self.studio.library.exists(catalog.build_workflow(t, sl, prefix)["slug"])}

    def seat_plan(self, t: dict[str, Any], sl: Callable[[str], str], existing: set[str]) -> dict[str, str]:
        """Kurulum kuralı önizlemesi : yeni roller hiyerarşi sırasıyla boş koltuklara "active", kalanı
        "bench"; var olan ajanlar kendi durumunu korur ("existing"). Paket sınırı yoksa (yönetici/sınırsız) hepsi active."""
        from studio.game.api import get_service  # noqa: PLC0415 - koltuk sorgusu C1 kontrol noktasından (T15)
        info = get_service(self.studio).seat_info()
        free: int | None = None if info is None else int(info["free"])
        out: dict[str, str] = {}
        for key in catalog.install_order(t):
            if sl(key) in existing:
                out[key] = "existing"
            elif free is None or free > 0:
                out[key] = "active"
                free = None if free is None else free - 1
            else:
                out[key] = "bench"
        return out

    @staticmethod
    def _prefix(data: dict[str, Any]) -> str:
        raw = str(data.get("prefix") or "").strip()
        return slugify(raw)[:16].strip("-") if raw else ""

    def instantiate(self, template_id: str, data: dict[str, Any], avail: dict[str, Any] | None = None) -> dict[str, Any]:
        t = catalog.localize_template(catalog.get_template(template_id))  # istek dilinde adlar/unvanlar
        problems = catalog.check_template(t)
        if problems:
            raise OfficeError("; ".join(problems))
        prefix = self._prefix(data)
        plan = self.plan_brains(t, data, avail)
        assign_skills = bool(data.get("assign_skills"))
        index = self._skill_index(plan["profile"]) if assign_skills else None

        def sl(key: str) -> str:
            return f"{prefix}-{key}" if prefix else key

        # ekipler
        teams_created, teams_skipped = [], []
        team_slug: dict[str, str] = {}
        order = self._next_order()
        for i, tm in enumerate(t.get("teams") or []):
            slug = sl(tm["key"])
            team_slug[tm["key"]] = slug
            if self.store.find("Team", slug):
                teams_skipped.append(slug)
                continue
            self.store.upsert_node("Team", {
                "slug": slug, "name": tm["name"] + (f" · {prefix}" if prefix else ""),
                "mission": tm.get("mission", ""), "color": tm.get("color") or TEAM_PALETTE[i % len(TEAM_PALETTE)],
                "icon": tm.get("icon") or "users", "order": order + i, "template": t["id"], "created_at": now_iso()})
            teams_created.append(slug)

        # roller (Role düğümleri + ROLE_IN); var olanlara dokunulmaz
        roles_created, roles_skipped = [], []
        for role in t.get("roles") or []:
            rid = sl(role["key"])
            if self.store.find("Role", rid):
                roles_skipped.append(rid)
                continue
            team = team_slug.get(role["team"])
            props = {"id": rid, "name": role["title"], "description": role.get("role", ""),
                     "team": team if team and self.store.find("Team", team) else None,
                     "rank": role.get("rank") or None, "skills_hint": list(role.get("skills_hint") or []),
                     "brain_hint": role.get("brain_hint") or "standard", "template": t["id"], "created_at": now_iso()}
            node = self.store.upsert_node("Role", {k: v for k, v in props.items() if v not in (None, [])})
            self._sync_role_team(node)
            roles_created.append(rid)

        # ajanlar (stüdyo ajanı; Hermes profil dosyalarına dokunulmaz). kurulum kuralı : hiyerarşide
        # yukarıdan aşağı oluşturulur; koltuk dolunca kalanlar yedekte doğar (E1, agents.create) → etkin = ilk N rol.
        agents_created, agents_skipped = [], []
        by_key = {r["key"]: r for r in t.get("roles") or []}
        for role in (by_key[k] for k in catalog.install_order(t)):
            slug = sl(role["key"])
            if self.agents.node(slug):
                agents_skipped.append(slug)
                continue
            b = plan["roles"][role["key"]]
            skills = ([s for s in role.get("skills_hint") or [] if self._installed(index, s)]
                      if assign_skills and b["runtime"] == "hermes" else [])
            created = self.agents.create({
                "slug": slug, "name": role["name"], "role": role.get("role", ""), "persona": role.get("persona", ""),
                "color": role.get("color"), "avatar": dict(role.get("avatar") or {}) or None,
                "hermes_profile": b["hermes_profile"], "runtime": b["runtime"], "connection": b["brain"],
                "model": b["model"] or "", "permissions": "write" if role.get("permissions") == "write" else "read",
                "memory_scope": "shared", "memory_enabled": True, **({"skills": skills} if skills else {})})
            if created["slug"] != slug:  # olmamalı (yukarıda var olanlar atlandı)
                raise OfficeError(f"Ajan slug'ı çakıştı: {slug}")
            agents_created.append(slug)

        # unvan, ekip, rütbe ve raporlama hattı + kenarlar: yeni ajanlar ve aynı anahtarlı ama henüz ekibi olmayan
        # (Lobi'deki, ör. başlangıç ekibi) ajanlar. Ekibi olan var olan ajanlara dokunulmaz (QA-F3 m6).
        roles = {r["key"]: r for r in t.get("roles") or []}
        for key, role in roles.items():
            slug = sl(key)
            if slug not in agents_created:
                existing = self.agents.node(slug) if slug in agents_skipped else None
                if not existing or existing["props"].get("team"):
                    continue
            boss = sl(role["reports_to"]) if role.get("reports_to") else None
            if boss and not self.agents.node(boss):
                boss = None
            team = team_slug.get(role["team"])
            if team and not self.store.find("Team", team):
                team = None
            patch: dict[str, Any] = {"team": team, "title": role["title"], "reports_to": boss}
            if role.get("rank"):
                patch["rank"] = role["rank"]
            self.assign(slug, patch)

        # rol sahipleri: taşıyıcısı olmayan role, aynı anahtarlı ve rolsüz ajan atanır
        for key in roles:
            rid = slug = sl(key)
            role_node = self.store.find("Role", rid)
            agent = self.agents.node(slug)
            if not role_node or not agent:
                continue
            if self.store.neighbors(role_node["id"], ["HAS_ROLE"], "in") or self._role_of(agent["id"]):
                continue
            self.store.link("HAS_ROLE", agent["id"], role_node["id"])

        for tm in t.get("teams") or []:
            slug = team_slug[tm["key"]]
            lead = self.agents.node(sl(tm["lead"])) if tm.get("lead") else None
            # lider yalnızca o ekibin üyesiyse atanır; aksi hâlde ekip lidersiz kalır (org şeması tutarlı)
            if slug in teams_created and lead and lead["props"].get("team") == slug:
                self._set_lead(self.store.find("Team", slug), sl(tm["lead"]))

        # iş akışı (adımlar role: ile yazılır)
        wf = catalog.build_workflow(t, sl, prefix)
        wf_slug = wf["slug"]
        workflow = {"slug": wf_slug, "name": wf.get("name", wf_slug), "created": False, "skipped": False}
        if self.studio.library.exists(wf_slug):
            workflow["skipped"] = True  # kullanıcının düzenlemelerini ezme
        else:
            errors = validate(parse(dict(wf)), {a["slug"] for a in self.agents.list()}, self.roles_with_holders())
            if errors:
                raise OfficeError("İş akışı doğrulanamadı: " + "; ".join(errors)) from None
            spec = self.studio.library.save(dict(wf))
            self.store.upsert_node("Workflow", {"slug": spec.slug, "name": spec.name, "description": spec.description})
            workflow["created"] = True

        self._publish("office.changed", template=t["id"])
        parts = [f"{len(teams_created)} ekip", f"{len(roles_created)} rol", f"{len(agents_created)} ajan"]
        if workflow["created"]:
            parts.append("1 iş akışı")
        skipped = len(teams_skipped) + len(agents_skipped) + (1 if workflow["skipped"] else 0)
        message = ", ".join(parts) + " oluşturuldu" + (f"; {skipped} öğe zaten vardı, atlandı." if skipped else ".")
        single = plan["single"] or plan["strong"]
        return {
            "template": t["id"], "prefix": prefix, "message": message,
            "strategy": plan["strategy"], "warnings": plan["warnings"],
            "brain": {"brain": single["brain"], "runtime": single["runtime"],
                      "hermes_profile": single["hermes_profile"], "model": single["model"] or None},
            "brains": {sl(k): {**b, "label": self.brain_label(b)} for k, b in plan["roles"].items()},
            "teams": {"created": teams_created, "skipped": teams_skipped},
            "roles": {"created": roles_created, "skipped": roles_skipped},
            "agents": {"created": agents_created, "skipped": agents_skipped},
            "workflow": workflow,
        }

    # ------------------------------------------------------------------ mesajlaşma politikası (Faz 6 S24)
    # Genel politika ayardır (`messaging.policy`: free | hierarchical | custom). `custom` iken her ekibin kendi
    # politikası (free | hierarchical) gönderenin ekibine uygulanır; ekip ayarları veri dizinindeki küçük bir JSON
    # dosyasındadır (Team ontolojisinde alan yok; ayar şeması `messaging.teams` tanımadığı için). Kullanıcı ve sistem
    # her ajana yazabilir; motorun ürettiği görev/yanıt/devir mesajları org yapısını izlediği için politikaya tabi değildir.
    MESSAGING_POLICIES = ("free", "hierarchical", "custom")
    TEAM_MESSAGING_POLICIES = ("free", "hierarchical")
    _LEAD_RANKS = ("ceo", "deputy", "director")
    _TEAM_POLICY_FILE = "messaging_teams.json"

    def _team_policy_path(self):  # noqa: ANN202 - Path | None
        from pathlib import Path
        settings = getattr(self.studio, "settings", None)
        path = getattr(settings, "path", None)
        return Path(path).parent / self._TEAM_POLICY_FILE if path else None

    def team_messaging_policies(self) -> dict[str, str]:
        import json
        path = self._team_policy_path()
        if path is None or not path.is_file():
            return {}
        try:
            raw = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            return {}
        teams = raw.get("teams") if isinstance(raw, dict) else None
        return {str(k): str(v) for k, v in (teams or {}).items() if v in self.TEAM_MESSAGING_POLICIES}

    def messaging_policy(self) -> dict[str, Any]:
        """{policy, teams: {ekip: free|hierarchical}} — `teams` yalnızca `custom` iken etkilidir."""
        settings = getattr(self.studio, "settings", None)
        policy = str(settings.get("messaging.policy", "hierarchical") if settings is not None else "hierarchical")
        if policy not in self.MESSAGING_POLICIES:
            policy = "hierarchical"
        return {"policy": policy, "teams": self.team_messaging_policies()}

    def set_messaging_policy(self, policy: str | None = None, teams: dict[str, Any] | None = None) -> dict[str, Any]:
        """Genel politikayı (ayar) ve/veya ekip politikalarını yazar. Ekip değeri None → ekip ayarı silinir."""
        import json
        if policy is not None:
            if policy not in self.MESSAGING_POLICIES:
                raise OfficeError("Mesajlaşma politikası free, hierarchical ya da custom olmalı")
            self.studio.settings.update({"messaging": {"policy": policy}})
        if teams is not None:
            if not isinstance(teams, dict):
                raise OfficeError("Ekip politikaları bir sözlük olmalı")
            current = self.team_messaging_policies()
            for slug, value in teams.items():
                if not self.store.find("Team", str(slug)):
                    raise KeyError(f"Ekip yok: {slug}")
                if value is None or value == "":
                    current.pop(str(slug), None)
                elif value in self.TEAM_MESSAGING_POLICIES:
                    current[str(slug)] = str(value)
                else:
                    raise OfficeError("Ekip mesajlaşma politikası free ya da hierarchical olmalı")
            path = self._team_policy_path()
            if path is not None:
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".tmp")
                tmp.write_text(json.dumps({"teams": current}, ensure_ascii=False, indent=2), "utf-8")
                tmp.replace(path)
        self._publish("messaging.policy", **self.messaging_policy())
        return self.messaging_policy()

    def _is_lead(self, props: dict[str, Any]) -> bool:
        """Ekip lideri (Team.lead) ya da ekiplerin üstündeki yönetici (ceo/deputy/director)."""
        if props.get("rank") in self._LEAD_RANKS:
            return True
        team = self.store.find("Team", str(props["team"])) if props.get("team") else None
        return bool(team and team["props"].get("lead") == props.get("slug"))

    def _reports_chain(self, slug: str) -> list[str]:
        """Ajanın raporlama zinciri (yöneticisi, onun yöneticisi …); döngüde durur."""
        out: list[str] = []
        node = self.agents.node(slug)
        cur = node["props"].get("reports_to") if node else None
        while cur and cur not in out and cur != slug and len(out) < 50:
            out.append(cur)
            nxt = self.agents.node(cur)
            cur = nxt["props"].get("reports_to") if nxt else None
        return out

    def can_message(self, sender: str | None, recipient: str) -> tuple[bool, str | None]:
        """İletişim izni: (izinli mi, ret nedeni). Hiyerarşik politikada ekip içi serbesttir; ekipler arası mesaj
        yalnızca raporlama zinciri boyunca (yönetici ↔ ast, her düzeyde) ya da liderden lidere gidebilir."""
        if not sender or sender in ("user", "system") or sender == recipient:
            return True, None
        s_node, r_node = self.agents.node(sender), self.agents.node(recipient)
        if not r_node:
            raise KeyError(f"Ajan yok: {recipient}")
        if not s_node:
            raise KeyError(f"Ajan yok: {sender}")
        sp, rp = s_node["props"], r_node["props"]
        conf = self.messaging_policy()
        policy = conf["policy"]
        if policy == "custom":
            policy = conf["teams"].get(str(sp.get("team") or ""), "hierarchical")
        if policy == "free":
            return True, None
        if (sp.get("team") or None) == (rp.get("team") or None):
            return True, None
        if recipient in self._reports_chain(sender) or sender in self._reports_chain(recipient):
            return True, None
        if self._is_lead(sp) and self._is_lead(rp):
            return True, None
        return False, (f"Hiyerarşik mesajlaşma: '{sp.get('name') or sender}' ekipler arası mesajı doğrudan "
                       f"'{rp.get('name') or recipient}' ajanına gönderemez; mesaj ekip liderleri ya da raporlama "
                       "zinciri üzerinden gitmeli")
