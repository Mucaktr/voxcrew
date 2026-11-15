"""Hedef servisi: Goal düğümleri, SUPPORTS / GOAL_OF / PURSUES kenarları, ilerleme hesabı, devretmeyle başlatma.

- İlerleme (0..1): hedef tamamlandıysa 1; anahtar sonuç (KR) varsa KR ortalaması; yoksa iptal edilmemiş alt
  hedeflerin ortalaması; hiçbiri yoksa elle girilen değer. Değişiklik üst hedef zincirine yayılır.
- Bütün KR'ler tamamlanınca hedef kendiliğinden "done" olur ve `goal.completed` yayınlanır (S5 ödüllendirir).
- Başlat: S6 `engine.start_delegation(...)` çağrılır; koşu `PURSUES` kenarıyla hedefe bağlanır (kenar tekildir).
- Koşu bitişi (`goal.run_finished`): done → KR'ler ve hedef tamamlanır; failed → blocked; iptal → active.

Olay yayınlayan yöntemler yalnızca olay döngüsünden (async rotalar / olay tüketicisi) çağrılmalıdır.
"""

from __future__ import annotations

import itertools
import time
from typing import TYPE_CHECKING, Any, Iterable

from studio.goals.parser import (BulkParseError, MAX_GOALS, MAX_KRS, MAX_TITLE, ParsedGoal, normalize_due,
                                 normalize_priority, parse_bulk, parse_kr)
from studio.graph import namespace as nsm
from studio.graph.store import now_iso

if TYPE_CHECKING:
    from studio.api import Studio

LEVELS = ("company", "team", "agent")
LEVEL_ORDER = {lvl: i for i, lvl in enumerate(LEVELS)}
STATUSES = ("draft", "active", "in_progress", "done", "blocked", "cancelled")
PRIORITY_TR = {"low": "düşük", "medium": "orta", "high": "yüksek", "critical": "kritik"}
MAX_DESCRIPTION = 4000
MAX_UNIT = 30
RUN_ACTIVE = {"running", "pending"}
LAUNCH_DEFAULTS: dict[str, Any] = {"depth": 2, "max_subtasks": 6, "allow_hiring": True,
                                   "hiring_approval": "ask", "hire_budget": 2}
LAUNCH_LIMITS = {"depth": (1, 3, "derinlik"), "max_subtasks": (1, 8, "en fazla alt görev"),
                 "hire_budget": (0, 3, "işe alım bütçesi")}

_seq = itertools.count()


class GoalError(ValueError):
    """Geçersiz girdi (400). `errors`: satır/yol bazlı ayrıntılar."""

    def __init__(self, message: str, errors: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.errors = errors or []


class EngineUnavailable(RuntimeError):
    """S6 devretme motoru (start_delegation) henüz yok (503)."""


def new_goal_id() -> str:
    """Zaman sıralı kimlik: kardeşler kimliğe göre sıralanınca oluşturma (toplu metin) sırası korunur."""
    return f"goal_{int(time.time() * 1000):011x}{next(_seq) % 4096:03x}"


def _num(value: Any, name: str, *, allow_none: bool = True) -> float | int | None:
    if value is None or value == "":
        if allow_none:
            return None
        raise GoalError(f"{name} boş olamaz")
    if isinstance(value, bool):
        raise GoalError(f"{name} bir sayı olmalı")
    if isinstance(value, str):
        try:
            value = float(value.replace(",", ".").strip())
        except ValueError:
            raise GoalError(f"{name} bir sayı olmalı") from None
    if not isinstance(value, (int, float)) or value != value or value in (float("inf"), float("-inf")):
        raise GoalError(f"{name} bir sayı olmalı")
    return int(value) if float(value).is_integer() else float(value)


def kr_progress(kr: dict[str, Any]) -> float:
    if kr.get("done"):
        return 1.0
    target, current = kr.get("target"), kr.get("current") or 0
    if isinstance(target, (int, float)) and not isinstance(target, bool) and target > 0:
        return max(0.0, min(1.0, float(current) / float(target)))
    return 0.0


class GoalService:
    def __init__(self, studio: "Studio"):
        self.studio = studio
        self.launched: dict[str, str] = {}            # run_id → goal_id (bu süreçte başlatılan koşular)
        self.launched_by: dict[str, str] = {}         # run_id → başlatan (user | mcp:<x> | local)
        self._pending: dict[str, tuple[str, str | None]] = {}  # Run düğümü henüz yoksa: run_id → (goal_id, kök)
        self._finished: set[tuple[str, str, str]] = set()  # işlenmiş (goal_id, run_id, durum) bitişleri

    # ------------------------------------------------------------------ yardımcılar
    @property
    def store(self):  # noqa: ANN201 - GraphStore
        return self.studio.store

    def _publish(self, type_: str, **data: Any) -> None:
        self.studio.bus.publish(type_, **data)

    def _node(self, goal_id: str) -> dict[str, Any]:
        node = self.store.find("Goal", str(goal_id)) if goal_id else None
        if not node:
            raise KeyError(f"Hedef yok: {goal_id}")
        return node

    def _all(self) -> list[dict[str, Any]]:
        return self.store.nodes("Goal", limit=5000)

    def _team(self, slug: str | None) -> dict[str, Any] | None:
        return self.store.find("Team", slug) if slug else None

    def _agent(self, slug: str | None) -> dict[str, Any] | None:
        return self.studio.agents.node(slug) if slug else None

    def _team_lead(self, slug: str | None) -> str | None:
        team = self._team(slug)
        lead = team["props"].get("lead") if team else None
        return lead if lead and self._agent(lead) else None

    def _children(self, goal_id: str) -> list[dict[str, Any]]:
        """Alt hedefler oluşturma sırasıyla (kimlik zaman sıralıdır)."""
        return sorted(self.store.find_by_prop("Goal", "parent", goal_id, limit=2000), key=lambda n: n["props"]["id"])

    def _live_runs(self) -> dict[str, Any]:
        runs = getattr(self.studio.engine, "runs", None)
        return runs if isinstance(runs, dict) else {}

    def default_root(self, p: dict[str, Any]) -> str | None:
        """Başlat için varsayılan kök: ajan düzeyinde sahip ajan; değilse sahip ekibin lideri; o da yoksa sahip ajan."""
        owner_agent = p.get("owner_agent")
        if p.get("level") == "agent" and owner_agent and self._agent(owner_agent):
            return owner_agent
        lead = self._team_lead(p.get("owner_team"))
        if lead:
            return lead
        return owner_agent if owner_agent and self._agent(owner_agent) else None

    # ------------------------------------------------------------------ okuma
    @staticmethod
    def _kr_out(kr: dict[str, Any]) -> dict[str, Any]:
        return {"id": kr.get("id"), "title": kr.get("title") or "", "target": kr.get("target"),
                "current": kr.get("current") or 0, "unit": kr.get("unit"), "done": bool(kr.get("done")),
                "progress": round(kr_progress(kr), 4)}

    def runs_of(self, node: dict[str, Any], limit: int = 50) -> list[dict[str, Any]]:
        live = self._live_runs()
        out = []
        for edge, nb, _d in self.store.neighbors(node["id"], ["PURSUES"], "in"):
            if nb["type"] != "Run":
                continue
            p = nb["props"]
            state = live.get(p.get("id"))
            out.append({"id": p.get("id"), "title": p.get("title"), "kind": p.get("kind"),
                        "status": getattr(state, "status", None) or p.get("status"),
                        "started_at": p.get("started_at"), "finished_at": p.get("finished_at"),
                        "root_agent": edge["props"].get("root_agent")})
        out.sort(key=lambda r: r.get("started_at") or "", reverse=True)
        return out[:limit]

    def to_dict(self, node: dict[str, Any], *, runs: bool = True) -> dict[str, Any]:
        p = node["props"]
        data = {
            "id": p["id"], "title": p.get("title") or "", "description": p.get("description") or "",
            "level": p.get("level") or "company", "owner_team": p.get("owner_team"),
            "owner_agent": p.get("owner_agent"), "parent": p.get("parent"),
            "key_results": [self._kr_out(k) for k in p.get("key_results") or []],
            "status": p.get("status") or "active", "progress": round(float(p.get("progress") or 0.0), 4),
            "due": p.get("due"), "priority": p.get("priority") or "medium",
            "created_at": p.get("created_at") or node.get("created_at"), "completed_at": p.get("completed_at"),
            "updated_at": node.get("updated_at"), "default_root": self.default_root(p),
            "project": p.get("project") or None,  # hedefin koşularının bellek ad alanı (None → global)
        }
        if runs:
            data["runs"] = self.runs_of(node)
        return data

    def tree(self, level: str | None = None, owner: str | None = None) -> list[dict[str, Any]]:
        """Kök hedefler (alt hedefler `children` içinde). Süzgeçte üst hedef elenirse en yakın uyan ataya bağlanır."""
        if level and level not in LEVELS:
            raise GoalError(f"Geçersiz düzey: {level} (company, team, agent)")
        items = {n["props"]["id"]: self.to_dict(n) for n in self._all()}
        selected = {gid: g for gid, g in items.items()
                    if (not level or g["level"] == level)
                    and (not owner or owner in (g["owner_team"], g["owner_agent"]))}
        for g in selected.values():
            g["children"] = []
        roots: list[dict[str, Any]] = []
        for gid in sorted(selected):
            g, anc, seen = selected[gid], selected[gid]["parent"], set()
            while anc and anc not in selected and anc in items and anc not in seen:
                seen.add(anc)
                anc = items[anc]["parent"]
            (selected[anc]["children"] if anc in selected and anc != gid else roots).append(g)
        roots.sort(key=lambda g: (LEVEL_ORDER.get(g["level"], 9), g["id"]))
        return roots

    def detail(self, goal_id: str) -> dict[str, Any]:
        node = self._node(goal_id)
        data = self.to_dict(node)
        by_id = {n["props"]["id"]: n for n in self._all()}
        kids: dict[str, list[str]] = {}
        for gid in sorted(by_id):
            parent = by_id[gid]["props"].get("parent")
            if parent:
                kids.setdefault(parent, []).append(gid)

        def subtree(gid: str, seen: set[str]) -> list[dict[str, Any]]:
            out = []
            for cid in kids.get(gid, []):
                if cid in seen:
                    continue
                seen.add(cid)
                child = self.to_dict(by_id[cid])
                child["children"] = subtree(cid, seen)
                out.append(child)
            return out

        data["children"] = subtree(data["id"], {data["id"]})
        ancestors, cur, seen = [], data["parent"], {data["id"]}
        while cur and cur in by_id and cur not in seen:
            seen.add(cur)
            ap = by_id[cur]["props"]
            ancestors.append({"id": cur, "title": ap.get("title"), "level": ap.get("level")})
            cur = ap.get("parent")
        data["ancestors"] = list(reversed(ancestors))
        return data

    # ------------------------------------------------------------------ doğrulama
    def _clean_krs(self, items: Any) -> list[dict[str, Any]]:
        if items is None:
            return []
        if not isinstance(items, list):
            raise GoalError("key_results bir liste olmalı")
        if len(items) > MAX_KRS:
            raise GoalError(f"Bir hedefte en fazla {MAX_KRS} anahtar sonuç olabilir")
        out: list[dict[str, Any]] = []
        for i, raw in enumerate(items, start=1):
            if isinstance(raw, str):
                raw = parse_kr(raw)
            if not isinstance(raw, dict):
                raise GoalError(f"{i}. anahtar sonuç metin ya da nesne olmalı")
            title = str(raw.get("title") or "").strip()
            if not title:
                raise GoalError(f"{i}. anahtar sonucun başlığı boş")
            if len(title) > MAX_TITLE:
                raise GoalError(f"{i}. anahtar sonuç {MAX_TITLE} karakteri aşıyor")
            target = _num(raw.get("target"), f"{i}. anahtar sonucun hedef değeri")
            if target is not None and target <= 0:
                raise GoalError(f"{i}. anahtar sonucun hedef değeri sıfırdan büyük olmalı")
            current = _num(raw.get("current"), f"{i}. anahtar sonucun mevcut değeri") or 0
            unit = str(raw.get("unit") or "").strip()[:MAX_UNIT] or None
            done = raw.get("done")
            if done is not None and not isinstance(done, bool):
                raise GoalError(f"{i}. anahtar sonucun done alanı true/false olmalı")
            done = bool(done) or (target is not None and current >= target)
            kid = str(raw.get("id") or "").strip()[:40] or None
            out.append({"id": kid, "title": title, "target": target, "current": current, "unit": unit, "done": done})
        used = {k["id"] for k in out if k["id"]}
        if len(used) != len([k for k in out if k["id"]]):
            raise GoalError("Anahtar sonuç kimlikleri tekil olmalı")
        n = 0
        for k in out:
            if not k["id"]:
                n += 1
                while f"kr{n}" in used:
                    n += 1
                k["id"] = f"kr{n}"
                used.add(k["id"])
        return out

    def _clean(self, data: dict[str, Any], *, partial: bool) -> dict[str, Any]:
        if not isinstance(data, dict):
            raise GoalError("Gövde bir nesne olmalı")
        out: dict[str, Any] = {}
        if "title" in data or not partial:
            title = " ".join(str(data.get("title") or "").split())
            if not title:
                raise GoalError("Hedef başlığı boş olamaz")
            if len(title) > MAX_TITLE:
                raise GoalError(f"Hedef başlığı {MAX_TITLE} karakteri aşıyor")
            out["title"] = title
        if "description" in data:
            desc = str(data.get("description") or "").strip()
            if len(desc) > MAX_DESCRIPTION:
                raise GoalError(f"Açıklama {MAX_DESCRIPTION} karakteri aşıyor")
            out["description"] = desc or None
        if data.get("level") not in (None, ""):
            if data["level"] not in LEVELS:
                raise GoalError(f"Geçersiz düzey: {data['level']} (company, team, agent)")
            out["level"] = data["level"]
        for key, label in (("owner_team", "ekip"), ("owner_agent", "ajan")):
            if key in data:
                slug = str(data.get(key) or "").strip() or None
                if slug and not (self._team(slug) if key == "owner_team" else self._agent(slug)):
                    raise GoalError(f"Sahip {label} bulunamadı: {slug}")
                out[key] = slug
        if "priority" in data:
            try:
                out["priority"] = normalize_priority(data.get("priority")) or "medium"
            except ValueError as exc:
                raise GoalError(str(exc)) from None
        if "due" in data:
            try:
                out["due"] = normalize_due(data.get("due"))
            except ValueError as exc:
                raise GoalError(str(exc)) from None
        if data.get("status") not in (None, ""):
            if data["status"] not in STATUSES:
                raise GoalError(f"Geçersiz durum: {data['status']} ({', '.join(STATUSES)})")
            out["status"] = data["status"]
        if "key_results" in data:
            out["key_results"] = self._clean_krs(data.get("key_results"))
        if "parent" in data:
            parent = str(data.get("parent") or "").strip() or None
            if parent and not self.store.find("Goal", parent):
                raise GoalError(f"Üst hedef bulunamadı: {parent}")
            out["parent"] = parent
        if "project" in data:  # bellek ad alanı (proje anahtarı | project:<k> | global/boş)
            out["project"] = self._project(data.get("project"))
        if "progress" in data and data.get("progress") is not None:
            prog = _num(data.get("progress"), "İlerleme")
            if prog is None or not 0 <= prog <= 1:
                raise GoalError("İlerleme 0 ile 1 arasında olmalı")
            out["progress"] = float(prog)
        return out

    def _project(self, value: Any) -> str | None:
        """Hedefin `project` alanı → kanonik ad alanı; boş/global → None (alan yazılmaz = global)."""
        memory = getattr(self.studio, "memory", None)
        try:
            nsm.reject_reserved(value)  # matrisin ayrılmış öneki (hedef oluşturma/güncelleme/başlatma)
            ns = memory.namespace(value) if memory is not None and hasattr(memory, "namespace") \
                else nsm.normalize(value)
        except nsm.NamespaceError as exc:
            raise GoalError(str(exc)) from None
        return None if nsm.is_global(ns) else ns

    def _resolve_owner(self, props: dict[str, Any]) -> dict[str, Any]:
        """Düzeyi sahiplerden çıkarır, ajanın ekibini sahip ekip yapar ve tutarlılığı denetler."""
        owner_agent, owner_team = props.get("owner_agent"), props.get("owner_team")
        if owner_agent and not owner_team:
            team = (self._agent(owner_agent) or {}).get("props", {}).get("team")
            owner_team = team if team and self._team(team) else None
        level = props.get("level") or ("agent" if owner_agent else "team" if owner_team else "company")
        if level == "agent" and not owner_agent:
            raise GoalError("Ajan düzeyindeki hedefin bir sahip ajanı olmalı")
        if level == "team" and not owner_team:
            raise GoalError("Ekip düzeyindeki hedefin bir sahip ekibi olmalı")
        return {**props, "level": level, "owner_team": owner_team, "owner_agent": owner_agent}

    @staticmethod
    def clean_options(raw: Any) -> dict[str, Any]:
        if raw is None:
            raw = {}
        if not isinstance(raw, dict):
            raise GoalError("options bir nesne olmalı")
        out = dict(LAUNCH_DEFAULTS)
        for key, (lo, hi, label) in LAUNCH_LIMITS.items():
            v = raw.get(key)
            if v is None:
                continue
            if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v:
                raise GoalError(f"{key} ({label}) bir tam sayı olmalı")
            if not lo <= v <= hi:
                raise GoalError(f"{key} ({label}) {lo}–{hi} arasında olmalı")
            out[key] = int(v)
        if raw.get("allow_hiring") is not None:
            if not isinstance(raw["allow_hiring"], bool):
                raise GoalError("allow_hiring true ya da false olmalı")
            out["allow_hiring"] = raw["allow_hiring"]
        if raw.get("hiring_approval") is not None:
            if raw["hiring_approval"] not in ("ask", "auto"):
                raise GoalError("hiring_approval 'ask' (onayımla) ya da 'auto' (otomatik) olmalı")
            out["hiring_approval"] = raw["hiring_approval"]
        if not out["allow_hiring"]:
            out["hire_budget"] = 0
        return out

    # ------------------------------------------------------------------ kenarlar, ilerleme, durum
    def _sync_owner_edges(self, node: dict[str, Any]) -> None:
        self.store.unlink("GOAL_OF", node["id"])
        p = node["props"]
        for target in (self._team(p.get("owner_team")), self._agent(p.get("owner_agent"))):
            if target:
                self.store.link("GOAL_OF", node["id"], target["id"])

    def _sync_parent_edge(self, node: dict[str, Any]) -> None:
        self.store.unlink("SUPPORTS", node["id"])
        parent = self.store.find("Goal", node["props"].get("parent") or "") if node["props"].get("parent") else None
        if parent:
            self.store.link("SUPPORTS", node["id"], parent["id"])

    def _computed(self, p: dict[str, Any], children: list[dict[str, Any]]) -> float:
        if p.get("status") == "done":
            return 1.0
        krs = p.get("key_results") or []
        if krs:
            return round(sum(kr_progress(k) for k in krs) / len(krs), 4)
        kids = [c for c in children if c.get("status") != "cancelled"]
        if kids:
            return round(sum(float(c.get("progress") or 0) for c in kids) / len(kids), 4)
        return float(p.get("progress") or 0.0)

    def _recompute(self, goal_id: str | None) -> list[str]:
        """Hedefin ve üst zincirinin ilerlemesini yeniler. Dönüş: ilerlemesi değişen hedefler."""
        changed: list[str] = []
        seen: set[str] = set()
        gid = goal_id
        while gid and gid not in seen:
            seen.add(gid)
            node = self.store.find("Goal", gid)
            if not node:
                break
            p = node["props"]
            prog = self._computed(p, [c["props"] for c in self._children(gid)])
            if abs(prog - float(p.get("progress") or 0.0)) > 1e-6:
                self.store.patch_node(node["id"], {"progress": prog})
                changed.append(gid)
            gid = p.get("parent")
        return changed

    def _set_status(self, node: dict[str, Any], status: str) -> tuple[dict[str, Any], bool]:
        """Durumu yazar; `completed_at` alanını yönetir. Dönüş: (düğüm, yeni tamamlandı mı)."""
        prev = node["props"].get("status")
        if prev == status:
            return node, False
        patch: dict[str, Any] = {"status": status}
        if status == "done":
            patch["completed_at"] = now_iso()
        elif node["props"].get("completed_at"):
            patch["completed_at"] = None
        return self.store.patch_node(node["id"], patch), status == "done"

    def _kr_status(self, node: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Tüm KR'ler tamamsa hedefi tamamlar; tamamlanmış hedefte açık KR kalırsa yeniden etkinleştirir."""
        p = node["props"]
        krs = p.get("key_results") or []
        if not krs:
            return node, False
        all_done = all(kr_progress(k) >= 1 for k in krs)
        status = p.get("status") or "active"
        if all_done and status not in ("done", "cancelled"):
            return self._set_status(node, "done")
        if not all_done and status == "done":
            node, _ = self._set_status(node, "active")
        return node, False

    def _has_active_run(self, node: dict[str, Any], exclude: str | None = None) -> bool:
        live = self._live_runs()
        for _e, nb, _d in self.store.neighbors(node["id"], ["PURSUES"], "in"):
            rid = nb["props"].get("id")
            if rid == exclude:
                continue
            if (getattr(live.get(rid), "status", None) or nb["props"].get("status")) in RUN_ACTIVE:
                return True
        return False

    def _emit_changes(self, first: str | None, changed: Iterable[str], *, completed: Iterable[str] = (),
                      run_id: str | None = None, reason: str | None = None, root: str | None = None,
                      by: str | None = None) -> None:
        order: list[str] = []
        for gid in ([first] if first else []) + list(changed):
            if gid and gid not in order:
                order.append(gid)
        for gid in order:
            node = self.store.find("Goal", gid)
            if node:
                extra = {"reason": reason, "run_id": run_id} if gid == first and (reason or run_id) else {}
                self._publish("goal.updated", goal_id=gid, goal=self.to_dict(node), **extra)
        for gid in completed:
            node = self.store.find("Goal", gid)
            if node:
                self._completed_event(node, run_id=run_id, root=root, by=by)

    def _completed_event(self, node: dict[str, Any], *, run_id: str | None = None, root: str | None = None,
                         by: str | None = None) -> None:
        """`by`: tamamlamayı kim yaptı — `user` yalnız arayüzden işaretlenen ya da kullanıcının başlattığı
        hedef koşusunun "done" bitişi; MCP / başlıksız süreç / bilinmeyen → oyun ödülü yok."""
        p = node["props"]
        agent = root or p.get("owner_agent") or self._team_lead(p.get("owner_team"))
        self._publish("goal.completed", goal_id=p["id"], title=p.get("title"), level=p.get("level"),
                      owner_team=p.get("owner_team"), owner_agent=p.get("owner_agent"), priority=p.get("priority"),
                      run_id=run_id, agent=agent, goal=self.to_dict(node, runs=False), by=by or "unknown")

    # ------------------------------------------------------------------ yazma
    def _write(self, props: dict[str, Any]) -> dict[str, Any]:
        """Yeni Goal düğümü + kenarları (olay yok, ilerleme yayılımı yok)."""
        gid = new_goal_id()
        status = props.get("status") or "active"
        clean = {k: v for k, v in props.items() if v is not None and k != "progress"}
        clean.update(id=gid, status=status, priority=props.get("priority") or "medium", created_at=now_iso(),
                     progress=1.0 if status == "done" else float(props.get("progress") or 0.0))
        if status == "done":
            clean["completed_at"] = now_iso()
        node = self.store.upsert_node("Goal", clean)
        self._sync_owner_edges(node)
        self._sync_parent_edge(node)
        return node

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        props = self._resolve_owner(self._clean(data, partial=False))
        node = self._write(props)
        gid = node["props"]["id"]
        # Tamamlanmış olarak oluşturulan hedef bir "tamamlanma" geçişi değildir: goal.completed yayınlanmaz
        # (S5 ödülleri yalnızca yaşam döngüsündeki done geçişine bağlı kalır; toplu eklemeyle ödül toplanamaz).
        self._kr_status(node)
        changed = self._recompute(gid)
        self._publish("goal.created", goal_id=gid, goal=self.to_dict(self._node(gid)))
        self._emit_changes(None, [c for c in changed if c != gid])
        return self.to_dict(self._node(gid))

    # ---------------- toplu ekleme
    def _spec_from_parsed(self, g: ParsedGoal) -> dict[str, Any]:
        try:
            krs = self._clean_krs([{k: v for k, v in kr.items() if k != "line"} for kr in g.key_results])
        except GoalError as exc:
            raise GoalError(str(exc), [{"line": g.line, "message": str(exc)}]) from None
        return {"title": g.title, "line": g.line, "priority": g.priority, "due": g.due,
                "owner_agent": g.owner_agent, "owner_team": g.owner_team, "key_results": krs,
                "children": [self._spec_from_parsed(c) for c in g.children]}

    def _spec_from_item(self, item: Any, path: str, errors: list[dict[str, Any]]) -> dict[str, Any] | None:
        if isinstance(item, str):
            item = {"title": item}
        if not isinstance(item, dict):
            errors.append({"path": path, "message": "Hedef metin ya da nesne olmalı"})
            return None
        fields = {k: item[k] for k in ("title", "description", "level", "owner_team", "owner_agent", "priority",
                                       "due", "status", "key_results", "project") if k in item}
        try:
            spec = self._clean(fields, partial=False)
        except GoalError as exc:
            errors.append({"path": path, "message": str(exc)})
            spec = None
        children = item.get("children") or []
        if not isinstance(children, list):
            errors.append({"path": f"{path}.children", "message": "children bir liste olmalı"})
            children = []
        kids = [self._spec_from_item(c, f"{path}.children[{i}]", errors) for i, c in enumerate(children)]
        if spec is None:
            return None
        spec["path"] = path
        spec["children"] = [k for k in kids if k is not None]
        return spec

    def _resolve_spec(self, spec: dict[str, Any], inherited: dict[str, Any], errors: list[dict[str, Any]]) -> None:
        own_agent, own_team = spec.get("owner_agent"), spec.get("owner_team")
        if own_agent or own_team:
            base = {"level": spec.get("level"), "owner_agent": own_agent, "owner_team": own_team}
        else:
            base = {"level": spec.get("level") or inherited.get("level"),
                    "owner_agent": inherited.get("owner_agent"), "owner_team": inherited.get("owner_team")}
        try:
            resolved = self._resolve_owner(base)
        except GoalError as exc:
            where = {"line": spec["line"]} if spec.get("line") else {"path": spec.get("path")}
            errors.append({**where, "message": str(exc)})
            resolved = {**base, "level": base.get("level") or "company"}
        spec.update(level=resolved["level"], owner_agent=resolved.get("owner_agent"),
                    owner_team=resolved.get("owner_team"))
        for child in spec.get("children") or []:
            self._resolve_spec(child, resolved, errors)

    def _preview(self, spec: dict[str, Any]) -> dict[str, Any]:
        return {k: spec.get(k) for k in ("title", "line", "level", "owner_team", "owner_agent", "priority", "due",
                                         "key_results")} | {"children": [self._preview(c) for c in spec["children"]]}

    def bulk(self, data: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(data, dict):
            raise GoalError("Gövde bir nesne olmalı")
        defaults = self._clean({k: data[k] for k in ("level", "owner_team", "owner_agent", "parent") if k in data},
                               partial=True)
        text, items = data.get("text"), data.get("items")
        errors: list[dict[str, Any]] = []
        if isinstance(text, str) and text.strip():
            agents = [n["props"]["slug"] for n in self.store.nodes("Agent", limit=5000)]
            teams = [n["props"]["slug"] for n in self.store.nodes("Team", limit=1000)]
            roots, errors = parse_bulk(text, agents=agents, teams=teams)
            if errors:
                raise BulkParseError(errors)
            try:
                specs = [self._spec_from_parsed(r) for r in roots]
            except GoalError as exc:
                raise BulkParseError(exc.errors or [{"line": 0, "message": str(exc)}]) from None
        elif isinstance(items, list) and items:
            specs = [s for i, it in enumerate(items) if (s := self._spec_from_item(it, f"items[{i}]", errors))]
            if errors:
                raise GoalError(f"{errors[0]['path']}: {errors[0]['message']}", errors)
        else:
            raise GoalError("Toplu ekleme için 'text' (çok satırlı metin) ya da 'items' (liste) gerekli")
        total = sum(1 + self._count(s["children"]) for s in specs)
        if total > MAX_GOALS:
            raise GoalError(f"Tek seferde en fazla {MAX_GOALS} hedef eklenebilir")
        inherited = {"level": defaults.get("level"), "owner_team": defaults.get("owner_team"),
                     "owner_agent": defaults.get("owner_agent")}
        for spec in specs:
            self._resolve_spec(spec, inherited, errors)
        if errors:
            first = errors[0]
            where = f"Satır {first['line']}: " if first.get("line") else (f"{first['path']}: " if first.get("path") else "")
            raise GoalError(where + first["message"], errors)
        if data.get("dry_run"):
            return {"dry_run": True, "count": total, "goals": [self._preview(s) for s in specs]}

        created: list[str] = []

        def write(spec: dict[str, Any], parent: str | None) -> None:
            props = {k: spec.get(k) for k in ("title", "description", "level", "owner_team", "owner_agent",
                                               "priority", "due", "status", "key_results")}
            props["parent"] = parent
            node = self._write(props)
            gid = node["props"]["id"]
            created.append(gid)
            for child in spec["children"]:
                write(child, gid)

        top_parent = defaults.get("parent")
        for spec in specs:
            write(spec, top_parent)
        for gid in reversed(created):  # önce yapraklar, sonra üstleri
            node, _ = self._kr_status(self._node(gid))  # oluşturulurken tamamlanan hedef ödül olayı üretmez
            prog = self._computed(node["props"], [c["props"] for c in self._children(gid)])
            if abs(prog - float(node["props"].get("progress") or 0)) > 1e-6:
                self.store.patch_node(node["id"], {"progress": prog})
        changed = self._recompute(top_parent) if top_parent else []
        for gid in created:
            self._publish("goal.created", goal_id=gid, goal=self.to_dict(self._node(gid), runs=False), bulk=True)
        self._emit_changes(None, changed)
        roots = [self.detail(gid) for gid in created if self._node(gid)["props"].get("parent") == top_parent]
        return {"count": len(created), "created": created, "goals": roots}

    def _count(self, specs: list[dict[str, Any]]) -> int:
        return sum(1 + self._count(s.get("children") or []) for s in specs)

    # ---------------- düzenleme / silme
    def _descendants(self, goal_id: str) -> set[str]:
        out: set[str] = set()
        stack = [goal_id]
        while stack:
            for child in self._children(stack.pop()):
                cid = child["props"]["id"]
                if cid not in out:
                    out.add(cid)
                    stack.append(cid)
        return out

    def update(self, goal_id: str, data: dict[str, Any], *, by: str | None = None) -> dict[str, Any]:
        node = self._node(goal_id)
        p = node["props"]
        clean = self._clean(data, partial=True)
        if not clean:
            raise GoalError("Güncellenecek alan yok")
        if clean.get("parent"):
            if clean["parent"] == goal_id or clean["parent"] in self._descendants(goal_id):
                raise GoalError("Hedef kendisinin ya da alt hedefinin altına taşınamaz")
        merged = {**p, **clean}
        owners_changed = "owner_agent" in clean or "owner_team" in clean or "level" in clean
        if owners_changed:
            if "owner_agent" in clean and clean["owner_agent"] and "owner_team" not in clean:
                merged["owner_team"] = None  # ajanın ekibinden yeniden türet
            if "level" not in clean:
                merged["level"] = None
            merged = self._resolve_owner(merged)
        if "progress" in clean:
            has_kids = bool(self._children(goal_id))
            if merged.get("key_results") or has_kids:
                raise GoalError("Bu hedefin ilerlemesi anahtar sonuçlardan ya da alt hedeflerden hesaplanıyor")
        patch = {k: merged.get(k) for k in set(clean) | ({"level", "owner_team", "owner_agent"} if owners_changed else set())}
        status_change = patch.pop("status", None)
        node = self.store.patch_node(node["id"], patch) if patch else node
        completed = False
        if status_change:
            node, completed = self._set_status(node, status_change)
        elif "key_results" in clean:
            node, completed = self._kr_status(node)
        if owners_changed:
            self._sync_owner_edges(node)
        old_parent = p.get("parent")
        if "parent" in clean and clean["parent"] != old_parent:
            self._sync_parent_edge(node)
        changed = self._recompute(goal_id)
        if "parent" in clean and old_parent and clean["parent"] != old_parent:
            changed += self._recompute(old_parent)
        self._emit_changes(goal_id, changed, completed=[goal_id] if completed else [], by=by)
        return self.to_dict(self._node(goal_id))

    def delete(self, goal_id: str) -> dict[str, Any]:
        node = self._node(goal_id)
        parent_id = node["props"].get("parent")
        parent = self.store.find("Goal", parent_id) if parent_id else None
        moved: list[str] = []
        for child in self._children(goal_id):
            child = self.store.patch_node(child["id"], {"parent": parent["props"]["id"] if parent else None})
            self._sync_parent_edge(child)
            moved.append(child["props"]["id"])
        self.store.delete_node(node["id"])  # GOAL_OF / SUPPORTS / PURSUES kenarları ON DELETE CASCADE
        changed = self._recompute(parent["props"]["id"]) if parent else []
        self._publish("goal.deleted", goal_id=goal_id, parent=parent_id if parent else None, reparented=moved)
        self._emit_changes(None, moved + changed)
        return {"ok": True, "id": goal_id, "parent": parent_id if parent else None, "reparented": moved}

    def update_kr(self, goal_id: str, kr_id: str, data: dict[str, Any], *, by: str | None = None) -> dict[str, Any]:
        node = self._node(goal_id)
        krs = [dict(k) for k in node["props"].get("key_results") or []]
        idx = next((i for i, k in enumerate(krs) if k.get("id") == kr_id), None)
        if idx is None:
            raise KeyError(f"Anahtar sonuç yok: {kr_id}")
        if not isinstance(data, dict):
            raise GoalError("Gövde bir nesne olmalı")
        kr = krs[idx]
        fields = [k for k in ("title", "target", "current", "unit", "done") if k in data]
        if not fields:
            raise GoalError("Güncellenecek alan yok (current, done, title, target, unit)")
        for k in fields:
            kr[k] = data[k]
        if "done" not in data and ("current" in data or "target" in data):
            target = _num(kr.get("target"), "Hedef değeri")
            current = _num(kr.get("current"), "Mevcut değer") or 0
            kr["done"] = target is not None and current >= target
        krs[idx] = kr
        node = self.store.patch_node(node["id"], {"key_results": self._clean_krs(krs)})
        node, completed = self._kr_status(node)
        changed = self._recompute(goal_id)
        self._emit_changes(goal_id, changed, completed=[goal_id] if completed else [], reason="kr", by=by)
        return self.to_dict(self._node(goal_id))

    # ------------------------------------------------------------------ başlatma (S6 devretme motoru)
    def goal_text(self, node: dict[str, Any]) -> str:
        p = node["props"]
        lines = [f"Hedef: {p.get('title')}"]
        if p.get("description"):
            lines += ["", str(p["description"])]
        parent = self.store.find("Goal", p["parent"]) if p.get("parent") else None
        if parent:
            lines += ["", f"Bu hedef şu üst hedefe hizmet eder: {parent['props'].get('title')}"]
        krs = p.get("key_results") or []
        if krs:
            lines += ["", "Anahtar sonuçlar (başarı ölçütleri):"]
            for k in krs:
                target = ""
                if k.get("target") is not None:
                    target = f" (hedef: {k['target']}{' ' + k['unit'] if k.get('unit') else ''}, şu an: {k.get('current') or 0})"
                lines.append(f"- {k.get('title')}{target}{' — tamamlandı' if k.get('done') else ''}")
        kids = [c["props"] for c in self._children(p["id"]) if c["props"].get("status") not in ("done", "cancelled")]
        if kids:
            lines += ["", "Açık alt hedefler:"]
            for c in kids:
                owner = c.get("owner_agent") or c.get("owner_team")
                lines.append(f"- {c.get('title')}{f' (sahibi: {owner})' if owner else ''}")
        meta = []
        if p.get("due"):
            meta.append(f"Son tarih: {p['due']}")
        if p.get("priority"):
            meta.append(f"Öncelik: {PRIORITY_TR.get(p['priority'], p['priority'])}")
        if meta:
            lines += ["", " · ".join(meta)]
        lines += ["", "Bu hedefi ekibinle gerçekleştir: işi alt görevlere böl, uygun kişilere ata, gerekiyorsa "
                      "yeni bir uzman işe al ve sonucu anahtar sonuçlara göre özetle."]
        return "\n".join(lines)

    def _link_run(self, run_id: str, goal_id: str, root: str | None = None) -> bool:
        run, goal = self.store.find("Run", run_id), self.store.find("Goal", goal_id)
        if not goal:
            return False
        if not run:
            self._pending[run_id] = (goal_id, root)
            return False
        self.store.link("PURSUES", run["id"], goal["id"], {"root_agent": root} if root else None)
        if not run["props"].get("goal"):
            self.store.patch_node(run["id"], {"goal": goal_id})
        self._pending.pop(run_id, None)
        return True

    async def launch(self, goal_id: str, data: dict[str, Any], *, by: str | None = None) -> dict[str, Any]:
        node = self._node(goal_id)
        p = node["props"]
        if not isinstance(data, dict):
            raise GoalError("Gövde bir nesne olmalı")
        # Faz 6 (S24): `launch_mode` (gövde > ayar `goals.launch_mode`) — delegate (varsayılan) | orchestrate
        mode = str(data.get("launch_mode") or self.studio.settings.get("goals.launch_mode", "delegate") or "delegate")
        if mode not in ("delegate", "orchestrate"):
            raise GoalError("launch_mode 'delegate' ya da 'orchestrate' olmalı")
        start = getattr(self.studio.engine, "start_orchestration" if mode == "orchestrate" else "start_delegation", None)
        if not callable(start):
            raise EngineUnavailable("Devretme motoru hazır değil")
        if p.get("status") == "cancelled":
            raise GoalError("İptal edilmiş hedef başlatılamaz; önce durumunu değiştir")
        raw_opts = data.get("options")
        is_mcp = str(data.get("origin") or "").startswith("mcp:")
        if is_mcp and isinstance(raw_opts, dict):
            # (A-08): MCP işe alım onayını kendine veremez, bütçeyi de büyütemez
            raw_opts = {k: v for k, v in raw_opts.items() if k not in ("hiring_approval", "hire_budget")}
        options = self.clean_options(raw_opts)
        if is_mcp:
            options["hiring_approval"] = "ask"
        root = str(data.get("root_agent") or "").strip() or self.default_root(p)
        if not root:
            raise GoalError("Bu hedef için kök ajan yok: hedefe lideri olan bir ekip ya da bir sahip ajan ata "
                            "veya başlatırken kök ajanı seç")
        if not self._agent(root):
            raise GoalError(f"Kök ajan bulunamadı: {root}")
        title = " ".join(str(data.get("title") or "").split())[:90] or f"Hedef: {p.get('title')}"[:90]
        extra = {"origin": data["origin"]} if data.get("origin") else {}  # yoksa motor "goal" kökenini kullanır
        # koşu hedefin bellek ad alanında (gövdedeki `project` geçersiz kılar); global ise alan geçirilmez
        project = self._project(data["project"]) if "project" in data else (p.get("project") or None)
        if project:
            extra["project"] = project
        run_id = str(await start(self.goal_text(node), root, title=title, options=options, goal_id=goal_id, **extra))
        self.launched[run_id] = goal_id
        if by:
            self.launched_by[run_id] = by
        self._link_run(run_id, goal_id, root)
        if by and (run_node := self.store.find("Run", run_id)) and (goal_node := self.store.find("Goal", goal_id)):
            self.store.link("PURSUES", run_node["id"], goal_node["id"], {"launched_by": by})  # yeniden başlatmaya dayanır
        node = self._node(goal_id)
        if node["props"].get("status") != "in_progress":
            node, _ = self._set_status(node, "in_progress")
        changed = self._recompute(goal_id)
        self._emit_changes(goal_id, changed, run_id=run_id, reason="launched", root=root)
        return {"run_id": run_id, "root_agent": root, "options": options, "launch_mode": mode,
                "project": project or nsm.GLOBAL, "goal": self.to_dict(self._node(goal_id))}

    def _pursue_edge(self, goal_node: dict[str, Any], run_id: str) -> dict[str, Any] | None:
        for edge, nb, _d in self.store.neighbors(goal_node["id"], ["PURSUES"], "in"):
            if nb["props"].get("id") == run_id:
                return edge
        return None

    def on_run_finished(self, goal_id: str | None, run_id: str, status: str) -> None:
        goal_id = goal_id or self.launched.get(run_id)
        status_key = status or "unknown"
        # Aynı koşu kimliği yeniden denenip/sürdürülüp farklı bir durumla yeniden bitebilir (failed → done):
        # tekilleştirme (hedef, koşu, durum) üzerinedir; yalnızca aynı durumla tekrar gelen olay atlanır.
        key = (goal_id or "", run_id, status_key)
        if not goal_id or not run_id or key in self._finished:
            return
        node = self.store.find("Goal", goal_id)
        if not node:
            return
        root = (self._pending.get(run_id) or (None, None))[1]
        self._link_run(run_id, goal_id, root)
        edge = self._pursue_edge(node, run_id)
        if edge and edge["props"].get("finished_status") == status_key:
            self._finished.add(key)  # yeniden başlatma sonrası aynı durumla tekrar gelen olay: bir kez işlenir
            return
        self._finished.add(key)
        launched_by = self.launched_by.get(run_id) or (edge["props"].get("launched_by") if edge else None)
        if edge:
            root = root or edge["props"].get("root_agent")
            run = self.store.find("Run", run_id)
            if run:
                self.store.link("PURSUES", run["id"], node["id"], {"finished_status": status or "unknown"})
        p = node["props"]
        completed = False
        if p.get("status") == "cancelled":
            # iptal edilmiş hedef iptal kalır — durum, ilerleme, KR değişmez, goal.completed yayınlanmaz
            return
        if status == "done":
            # KR'ler tamamlandı işaretlenir ama `current` uydurulmaz (gerçek değer kullanıcıdan/ajandan gelir)
            krs = [dict(k, done=True) for k in p.get("key_results") or []]
            if krs:
                node = self.store.patch_node(node["id"], {"key_results": krs})
            node, completed = self._set_status(node, "done")
        elif status in ("failed", "rejected"):
            if p.get("status") not in ("done", "cancelled"):
                node, _ = self._set_status(node, "blocked")
        elif p.get("status") == "in_progress" and not self._has_active_run(node, exclude=run_id):
            node, _ = self._set_status(node, "active")
        changed = self._recompute(goal_id)
        # hedefin kendi koşusunun "done" bitişi yalnız kullanıcı başlattıysa kullanıcının işi sayılır
        self._emit_changes(goal_id, changed, completed=[goal_id] if completed else [], run_id=run_id,
                           reason="run_finished", root=root, by="user" if launched_by == "user" else "run")

    def handle_event(self, ev: dict[str, Any]) -> None:
        kind = ev.get("type")
        if kind == "goal.run_finished":
            self.on_run_finished(str(ev.get("goal_id") or "") or None, str(ev.get("run_id") or ""),
                                 str(ev.get("status") or ""))
        elif kind == "run.finished":
            run_id = str(ev.get("run_id") or "")
            if run_id in self.launched:  # S6 goal.run_finished yayınlamasa da hedef güncellenir (idempotent)
                self.on_run_finished(self.launched[run_id], run_id, str(ev.get("status") or ""))
        elif kind == "run.started":
            run_id = str(ev.get("run_id") or "")
            detail = ev.get("detail") if isinstance(ev.get("detail"), dict) else {}
            goal_id = str(detail.get("goal") or "") or (self._pending.get(run_id) or (None, None))[0]
            if run_id and goal_id:
                root = (self._pending.get(run_id) or (None, None))[1]
                self._link_run(run_id, goal_id, root)
