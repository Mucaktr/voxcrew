"""Sprint boss'u v1 ( adım 6 "daha büyük iş", §6.4 haftalık satır; gamification B.13).

- Haftalık, İSTEĞE BAĞLI bir "daha büyük iş" meydan okuması. Kullanıcı gerçek, çok adımlı bir iş akışını (en az iki
  ajan adımı) ya da bir hedefi seçer ve hedef sayıyı belirler.
- İlerleme yalnız GERÇEK kabul edilen teslimlerden gelir: bu hafta (`rules.week_of`, gün 04:00'te başlar) kararı
  verilmiş `Acceptance.status == accepted` kayıtları; koşunun `workflow` ya da `goal` alanı seçimle eşleşmeli.
  Hacim, token ve süre sayılmaz (Y7). İlerleme saklanmaz, her okumada yeniden hesaplanır (hile/çift sayım yok).
- Ceza yok: hafta biterken yenilmemiş boss "dinlenmeye çekilir" (`resting`); hiçbir şey kaybedilmez, seri yoktur.
  Kullanıcı boss'u istediği an dinlenmeye gönderebilir ya da başka bir işle değiştirebilir.
- Ödül yalnız kozmetik unvandır (XP, jeton, koltuk ya da özellik yok; Y4/İ2). Satın alınamaz.

Göç eklemelidir: `sprint_boss` tablosu ilk kullanımda `CREATE TABLE IF NOT EXISTS` ile açılır (walk/service deseni).
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

from studio.game import rules as R
from studio.game.first_session import ts_of

if TYPE_CHECKING:
    from studio.api import Studio
    from studio.game.db import GameDB

SCHEMA = """
CREATE TABLE IF NOT EXISTS sprint_boss (
  week TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('workflow','goal')),
  ref TEXT NOT NULL, title TEXT NOT NULL, target INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','defeated','resting')),
  created_at REAL NOT NULL, defeated_at REAL, reward TEXT);
"""
KINDS = ("workflow", "goal")
TARGETS = {"workflow": (1, 5, 3), "goal": (1, 3, 1)}   # (en az, en çok, varsayılan)
GOAL_OPEN = ("draft", "active", "in_progress", "blocked")
SCAN = 2000
# Kozmetik unvan kademeleri (toplam yenilen boss sayısı → unvan); yalnız gösterim
TITLES: tuple[tuple[int, str, str], ...] = (
    (1, "Sprint Avcısı", "Sprint Hunter"),
    (3, "Boss Terbiyecisi", "Boss Tamer"),
    (8, "Efsanevi Avcı", "Legendary Hunter"),
)


class BossError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def ensure_schema(db: "GameDB") -> None:
    with db._lock:  # noqa: SLF001 - GameDB tek bağlantı; şema işlemi kilit altında
        db.conn.executescript(SCHEMA)


def _db(studio: "Studio") -> "GameDB":
    from studio.game.api import get_service  # noqa: PLC0415

    db = get_service(studio).db
    ensure_schema(db)
    return db


def _bounds(week: str) -> tuple[float, float]:
    from studio.game.spotlight import week_bounds  # noqa: PLC0415

    return week_bounds(week)


def _agentic_steps(wf: dict[str, Any]) -> int:
    from studio.workflow.spec import AGENTIC_TYPES  # noqa: PLC0415

    return sum(1 for s in wf.get("steps") or [] if (s.get("type") or "agent") in AGENTIC_TYPES)


def candidates(studio: "Studio") -> dict[str, Any]:
    """Seçilebilecek gerçek işler: en az iki ajan adımlı akışlar ve açık hedefler."""
    flows = []
    for wf in studio.library.list():
        if wf.get("error") or str(wf.get("slug") or "").startswith("hero-"):
            continue
        n = _agentic_steps(wf)
        if n >= 2:
            flows.append({"kind": "workflow", "ref": wf["slug"], "title": wf.get("name") or wf["slug"], "steps": n})
    goals = []
    for g in studio.store.nodes("Goal", limit=500, order="updated_at DESC"):
        p = g["props"]
        if (p.get("status") or "active") in GOAL_OPEN:
            goals.append({"kind": "goal", "ref": p.get("id"), "title": p.get("title") or p.get("id")})
    return {"workflows": flows, "goals": goals,
            "targets": {k: {"min": a, "max": b, "default": d} for k, (a, b, d) in TARGETS.items()}}


def _resolve(studio: "Studio", kind: str, ref: str) -> str:
    if kind == "workflow":
        try:
            spec = studio.library.get(ref)
        except KeyError as exc:
            raise BossError(404, "İş akışı yok") from exc
        steps = [{"type": s.type} for s in spec.steps]
        if _agentic_steps({"steps": steps}) < 2:
            raise BossError(400, "Sprint boss'u en az iki ajan adımlı bir iş akışı ister")
        return str(spec.name or ref)
    node = studio.store.find("Goal", ref)
    if not node:
        raise BossError(404, "Hedef yok")
    if (node["props"].get("status") or "active") not in GOAL_OPEN:
        raise BossError(400, "Bu hedef kapalı; açık bir hedef seç")
    return str(node["props"].get("title") or ref)


def progress(studio: "Studio", kind: str, ref: str, week: str, since: float | None = None) -> int:
    """Boss seçildikten sonra bu hafta kabul edilen teslimler; koşu seçilen akışa ya da hedefe ait olmalı (çift
    sayım yok). Seçimden önceki kabuller sayılmaz: boss "daha büyük iş" için bir davettir, geçmişin ödülü değil."""
    ws, we = _bounds(week)
    ws = max(ws, since or ws)
    field = "workflow" if kind == "workflow" else "goal"
    runs: set[str] = set()
    for n in studio.store.nodes("Acceptance", limit=SCAN, order="updated_at DESC", props={"status": "accepted"}):
        decided = ts_of(n["props"].get("decided_at"))
        rid = str(n["props"].get("run_id") or "")
        if not decided or not (ws <= decided < we) or not rid or rid in runs:
            continue
        if n["props"].get("reviewer_kind") != "user":
            continue  # yalnız kullanıcının kabul ettiği teslimler ("senin kabul ettiğin"); ajan hakem sayılmaz
        run = studio.store.find("Run", rid)
        if run and str(run["props"].get(field) or "") == ref:
            runs.add(rid)
    return len(runs)


def _title_for(count: int) -> tuple[str, str] | None:
    best = None
    for need, tr, en in TITLES:
        if count >= need:
            best = (tr, en)
    return best


def _row(r: Any) -> dict[str, Any]:
    return {k: r[k] for k in r.keys()}


def _settle(studio: "Studio", db: "GameDB", now: float) -> None:
    """Geçmiş haftaların yenilmemiş boss'ları dinlenmeye çekilir (ceza yok)."""
    db.exec("UPDATE sprint_boss SET status='resting' WHERE status='active' AND week < ?", R.week_of(now))


def _defeat(db: "GameDB", week: str, title: str, now: float) -> tuple[str, str] | None:
    with db.tx():
        if db.exec("UPDATE sprint_boss SET status='defeated', defeated_at=? WHERE week=? AND status='active'",
                   now, week) != 1:
            return None
        count = int(db.scalar("SELECT COUNT(*) FROM sprint_boss WHERE status='defeated'"))
        reward = _title_for(count)
        if reward:
            db.exec("UPDATE sprint_boss SET reward=? WHERE week=?", reward[0], week)
        db.feed(now, "boss", "human", "me", f"Sprint boss'u yenildi: {title}", None,
                {"week": week, "title_reward": reward[0] if reward else None})
    return reward


def view(studio: "Studio", now: float | None = None, lang: str = "tr") -> dict[str, Any]:
    now = now or time.time()
    db = _db(studio)
    _settle(studio, db, now)
    week = R.week_of(now)
    cur = db.one("SELECT * FROM sprint_boss WHERE week=?", week)
    current = None
    if cur is not None:
        row = _row(cur)
        done = progress(studio, row["kind"], row["ref"], week, float(row["created_at"]))
        if row["status"] == "active" and done >= int(row["target"]):
            _defeat(db, week, row["title"], now)
            row = _row(db.one("SELECT * FROM sprint_boss WHERE week=?", week))
        current = {**row, "progress": min(done, int(row["target"])), "accepted": done}
    count = int(db.scalar("SELECT COUNT(*) FROM sprint_boss WHERE status='defeated'"))
    title = _title_for(count)
    nxt = next(((need, tr, en) for need, tr, en in TITLES if count < need), None)
    history = [_row(r) for r in db.q("SELECT * FROM sprint_boss WHERE week < ? ORDER BY week DESC LIMIT 6", week)]
    ws, we = _bounds(week)
    return {"week": week, "ends_at": we, "current": current, "history": history, "defeated": count,
            "title": (title[1] if lang == "en" else title[0]) if title else None,
            "next_title": {"need": nxt[0], "title": nxt[2] if lang == "en" else nxt[1]} if nxt else None}


def pick(studio: "Studio", kind: str, ref: str, target: Any = None, now: float | None = None) -> None:
    now = now or time.time()
    if kind not in KINDS:
        raise BossError(400, "Tür 'workflow' ya da 'goal' olmalı")
    ref = str(ref or "").strip()
    if not ref:
        raise BossError(400, "Bir iş akışı ya da hedef seç")
    lo, hi, default = TARGETS[kind]
    try:
        n = int(target) if target not in (None, "") else default
    except (TypeError, ValueError) as exc:
        raise BossError(400, "Hedef sayı geçersiz") from exc
    n = max(lo, min(hi, n))
    title = _resolve(studio, kind, ref)
    db = _db(studio)
    week = R.week_of(now)
    cur = db.one("SELECT status FROM sprint_boss WHERE week=?", week)
    if cur is not None and cur["status"] == "defeated":
        raise BossError(409, "Bu haftanın boss'u zaten yenildi; yenisi gelecek hafta")
    db.exec("INSERT INTO sprint_boss(week,kind,ref,title,target,status,created_at) VALUES(?,?,?,?,?,'active',?) "
            "ON CONFLICT(week) DO UPDATE SET kind=excluded.kind, ref=excluded.ref, title=excluded.title, "
            "target=excluded.target, status='active', created_at=CASE WHEN sprint_boss.kind=excluded.kind AND "
            "sprint_boss.ref=excluded.ref THEN sprint_boss.created_at ELSE excluded.created_at END",
            week, kind, ref, title[:120], n, now)


def rest(studio: "Studio", now: float | None = None) -> None:
    """Kullanıcı bu haftanın boss'unu dinlenmeye gönderir (ceza yok; yenilmiş boss değişmez)."""
    now = now or time.time()
    db = _db(studio)
    db.exec("UPDATE sprint_boss SET status='resting' WHERE week=? AND status='active'", R.week_of(now))
