"""Yedek kulübesi (§2.5; K4).

- Etkin kadro N koltuktur. Koltuk doluyken oluşturulan ajan yedekte doğar (E1, `agents.py`).
- Değişim ücretsizdir; tek koşul: ikisi de çalışan bir koşuda olmamalı.
- Hiçbir şey silinmez: yedekteki ajanın belleği, XP'si ve geçmişi korunur.
- Düşürmede (`reconcile`) en son kullanılan N ajan aktif kalır, kalanı yedeğe alınır; fazla zamanlamalar duraklar;
  pakete dahil sahne kilitlendiyse seçili sahne `office`e döner.
- Yönetici/test modunda kadro değişmez (atla, verme).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from studio.entitlements import usage
from studio.entitlements.engine import Decision, EntitlementError, Entitlements, msg
from studio.graph.store import now_iso

if TYPE_CHECKING:
    from studio.api import Studio


class SeatError(Exception):
    def __init__(self, status: int, detail: Any):
        super().__init__(str(detail))
        self.status = status
        self.detail = detail


def busy_agents(studio: "Studio") -> set[str]:
    """Çalışan koşulardaki ajanlar (adımları ve devretme çocukları dahil)."""
    out: set[str] = set()
    for run in list(getattr(studio.engine, "runs", {}).values()):
        if getattr(run, "status", None) not in ("running", "paused", "waiting"):
            continue
        for st in list(run.steps.values()):
            if st.spec.agent:
                out.add(st.spec.agent)
    return out


def last_used(studio: "Studio", limit: int = 4000) -> dict[str, str]:
    """Ajan → en son adımının zamanı (Step düğümleri, yeniden eskiye)."""
    seen: dict[str, str] = {}
    for n in studio.store.nodes("Step", limit=limit, order="created_at DESC"):
        a = n["props"].get("agent")
        if a and a not in seen:
            seen[a] = n.get("created_at") or n.get("updated_at") or ""
    return seen


def roster(studio: "Studio", ent: Entitlements) -> dict[str, Any]:
    r = ent.resolve()
    busy = busy_agents(studio)
    used = last_used(studio)
    active, bench = [], []
    from studio.agents import starter_display  # yerel: agents → entitlements döngüsü olmasın

    for n in usage.roster_nodes(studio):
        p = {**n["props"], **starter_display(n["props"])}  # EN arayüzde dokunulmamış TR başlangıç adı/unvanı
        item = {"slug": p["slug"], "name": p.get("name") or p["slug"], "title": p.get("title") or p.get("role") or "",
                "color": p.get("color"), "avatar": p.get("avatar"), "hero": p.get("hero"), "team": p.get("team"),
                "hired_by": p.get("hired_by"), "busy": p["slug"] in busy, "last_used": used.get(p["slug"]),
                "benched_at": p.get("benched_at")}
        (bench if p.get("benched") else active).append(item)
    admin_on = r.source == "admin"
    return {"plan": r.plan, "source": r.source, "limit": None if admin_on else r.seats, "used": len(active),
            "free": None if admin_on else max(0, r.seats - len(active)), "active": active, "bench": bench,
            "locked": admin_on}


def _node(studio: "Studio", slug: str) -> dict[str, Any]:
    node = studio.agents.node(slug)
    if not node or usage.seat_exempt(node):
        raise SeatError(404, "Ajan yok")
    return node


def _guard_admin(ent: Entitlements) -> None:
    if ent.admin_active():
        r = ent.resolve()
        raise SeatError(409, Decision(False, "seats", "admin_mode", None, None, r.plan, r.source,
                                      message=msg("admin_mode")).to_dict())


def _guard_busy(studio: "Studio", node: dict[str, Any]) -> None:
    if node["props"]["slug"] in busy_agents(studio):
        name = node["props"].get("name") or node["props"]["slug"]
        raise SeatError(409, {"code": "plan_limit", "reason": "agent_busy", "feature": "seats",
                              "agents": [node["props"]["slug"]], "message": msg("agent_busy", name=name)})


def _set(studio: "Studio", node: dict[str, Any], benched: bool) -> None:
    studio.store.patch_node(node["id"], {"benched": benched, "benched_at": now_iso() if benched else None})


def bench(studio: "Studio", ent: Entitlements, slug: str) -> None:
    _guard_admin(ent)
    node = _node(studio, slug)
    if node["props"].get("benched"):
        return
    _guard_busy(studio, node)
    _set(studio, node, True)


def activate(studio: "Studio", ent: Entitlements, slug: str, swap_out: str | None = None) -> None:
    """E2: yedekteki ajanı kadroya alır. `swap_out` verilirse önce o ajan yedeğe alınır (ücretsiz değişim)."""
    _guard_admin(ent)
    node = _node(studio, slug)
    if not node["props"].get("benched"):
        return
    out = None
    if swap_out:
        out = _node(studio, swap_out)
        if out["props"].get("benched"):
            raise SeatError(400, "Değiştirilecek ajan zaten yedekte")
        _guard_busy(studio, out)
    if out is None:
        d = ent.check("seats")
        if not d.allowed:
            raise EntitlementError(d)
    with studio.store.bulk():
        if out is not None:
            _set(studio, out, True)
        _set(studio, node, False)


def reconcile(studio: "Studio", ent: Entitlements) -> dict[str, Any]:
    """Plan sınırını kadroya uygular (düşürme, deneme sonu, lisans süresi). İdempotent; yönetici modunda yazmaz.
    Hiçbir şey silinmez: fazla ajanlar yedeğe, fazla zamanlamalar duraklatılır."""
    if ent.admin_active():
        return {"benched": [], "paused": []}
    r = ent.resolve()
    result: dict[str, Any] = {"benched": [], "paused": [], "scene_reset": None}
    nodes = [n for n in usage.roster_nodes(studio) if not n["props"].get("benched")]
    if len(nodes) > r.seats:
        busy = busy_agents(studio)
        used = last_used(studio)
        # çalışanlar önde, sonra en son kullanılanlar (yeniden eskiye), sonra hiç kullanılmamışlar (eskiden yeniye)
        slug = lambda n: n["props"]["slug"]  # noqa: E731
        running = [n for n in nodes if slug(n) in busy]
        recent = sorted((n for n in nodes if slug(n) not in busy and slug(n) in used),
                        key=lambda n: used[slug(n)], reverse=True)
        never = sorted((n for n in nodes if slug(n) not in busy and slug(n) not in used),
                       key=lambda n: n.get("created_at") or "")
        # gizliler (eski kurulumda yedeksiz gizlenmiş Hermes default vb.) önce yedeğe gider; görünür kadro korunur
        ranked = sorted(running + recent + never, key=lambda n: bool(n["props"].get("hidden")))
        with studio.store.bulk():
            for n in ranked[r.seats:]:
                if n["props"]["slug"] in busy:
                    continue
                _set(studio, n, True)
                result["benched"].append(n["props"]["slug"])
    limit = r.limits.get("schedules")
    if limit is not None:
        enabled = sorted((n for n in studio.store.nodes("Schedule", limit=5000) if n["props"].get("enabled")),
                         key=lambda n: n.get("created_at") or "")
        for n in enabled[limit:]:
            studio.store.patch_node(n["id"], {"enabled": False, "next_run_at": None})
            result["paused"].append(n["props"].get("id"))
    state = getattr(ent, "state", None)   # çekirdekte plan sabit Free: değişim izi tutulmaz
    sig = {"plan": r.plan, "seats": r.seats, "scene_packs": r.scene_packs}
    last = (state.read().get("last") or {}) if state is not None else sig
    if last != sig:
        if last.get("scene_packs") == "all" and r.scene_packs != "all":
            try:
                from studio.admin import _restore_scene

                result["scene_reset"] = _restore_scene(studio)
            except Exception:  # noqa: BLE001 - sahne geri dönüşü kadro işini bozmasın
                result["scene_reset"] = None
        try:
            state.update({"last": sig})
        except OSError:
            pass
    return result

