"""Ekip S35 — oyunlaştırma vitrini: skor tablosu, haftalık özet ve yerel lider tablosu.

İş değeri ile oyun deneyimi ayrıdır: skor tablosunun iş KPI'ları (bugün biten görev, saatlik dağılım, çalışan
ajan) oyun defterinden değil, motorun kalıcı olay günlüğünden (`run_events`) ve canlı motor durumundan okunur; oyun
kapalıyken de doğrudur. Oyun alanları (seviye, XP) ayrı tutulur ve arayüzde oyun kapalı / odak modundayken gizlenir.

Seri yok (araştırma Y1): "seri" yerine bu haftaki aktif gün sayısı gösterilir; kaçırılan gün bir şey
kaybettirmez, hafta başında yeniden sayılır. Akademi alıştırma koşuları (R.PRACTICE_WORKFLOWS) sayılmaz.
Lider tablosu yalnızca yerel ve yalnızca kullanıcının kendi ajanları arasındadır; çevrimiçi sıralama yoktur.
"""

from __future__ import annotations

import re
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any

from studio.game import rules as R

if TYPE_CHECKING:
    from studio.game.service import GameService

HOURS = 8                 # skor tablosu saatlik çubuk sayısı (S33 duvar panosu sözleşmesi)
CACHE_S = 2.0             # olay seli sırasında run_events taramasını sınırla
WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")
_cache_lock = threading.Lock()


# ---------------------------------------------------------------- zaman (gün 04:00'te başlar, rules.DAY_START_HOUR)
def _at_start(d: date) -> float:
    return datetime(d.year, d.month, d.day, R.DAY_START_HOUR).timestamp()


def day_start(ts: float) -> float:
    return _at_start((datetime.fromtimestamp(ts) - timedelta(hours=R.DAY_START_HOUR)).date())


def week_bounds(week: str) -> tuple[float, float]:
    """ISO hafta kimliği ("2026-W42") → [pazartesi 04:00, sonraki pazartesi 04:00)."""
    y, w = int(week[:4]), int(week[6:])
    monday = date.fromisocalendar(y, w, 1)
    return _at_start(monday), _at_start(monday + timedelta(days=7))


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts).astimezone().isoformat(timespec="seconds")


# ---------------------------------------------------------------- iş verisi (run_events, salt okunur)
@dataclass
class DoneRun:
    run_id: str
    ts: float
    title: str
    workflow: str


def _first_rowid(conn: sqlite3.Connection, since: float) -> int:
    """`ts >= since` olan ilk satırın rowid'i (ikili arama; olay günlüğü ekleme sırasıyla zamana göre artar)."""
    lo, hi = conn.execute("SELECT COALESCE(MIN(rowid),0), COALESCE(MAX(rowid),0) FROM run_events").fetchone()
    lo, hi = int(lo), int(hi)
    while lo < hi:
        mid = (lo + hi) // 2
        row = conn.execute("SELECT ts FROM run_events WHERE rowid>=? ORDER BY rowid LIMIT 1", (mid,)).fetchone()
        if row is None or float(row[0]) >= since:
            hi = mid
        else:
            lo = mid + 1
    return lo


# kullanıcının işi sayılmayan koşu kökenleri (değerlendirme, hakem, gizli sistem koşusu)
SYSTEM_ORIGINS = ("eval:", "review:", "system:")


def is_system_run(origin: object, hidden: object = None, sealed: object = None) -> bool:
    """Değerlendirme (`eval:`), hakem (`review:`), sistem (`system:`), gizli ya da mühürlü koşu mu?"""
    return bool(hidden) or bool(sealed) or (isinstance(origin, str) and origin.startswith(SYSTEM_ORIGINS))


def done_runs(svc: "GameService", since: float, until: float | None = None) -> list[DoneRun]:
    """`since` ile `until` arasında "done" biten koşular (görev + iş akışı); alıştırma koşuları hariç."""
    conn = svc._reader()
    if conn is None:
        return []
    try:
        start = _first_rowid(conn, since)
        rows = conn.execute(
            "SELECT run_id, ts FROM run_events WHERE rowid>=? AND ts>=? AND ts<? AND type='run.finished' "
            "AND json_extract(data,'$.status')='done' AND json_extract(data,'$.hidden') IS NULL ORDER BY rowid",
            (start, since, until if until is not None else 9e18)).fetchall()
        if not rows:
            return []
        meta: dict[str, tuple[str, str]] = {}
        system: set[str] = set()
        ids = list(dict.fromkeys(r[0] for r in rows))
        for i in range(0, len(ids), 400):
            chunk = ids[i:i + 400]
            marks = ",".join("?" * len(chunk))
            for rid, wf, title, origin, hidden, sealed in conn.execute(
                    f"SELECT run_id, json_extract(data,'$.detail.workflow'), json_extract(data,'$.detail.title'), "
                    f"json_extract(data,'$.detail.origin'), json_extract(data,'$.detail.hidden'), "
                    f"json_extract(data,'$.detail.sealed') "
                    f"FROM run_events WHERE type='run.started' AND run_id IN ({marks})", chunk).fetchall():
                meta.setdefault(rid, (str(wf or ""), str(title or "")))
                if is_system_run(origin, hidden, sealed):
                    system.add(rid)
    except sqlite3.Error:
        return []
    out: list[DoneRun] = []
    seen: set[str] = set()
    for rid, ts in rows:
        if rid in seen:
            continue  # devam ettirilen koşu iki kez bitmiş olabilir: bir kez sayılır
        seen.add(rid)
        wf, title = meta.get(rid, ("", ""))
        if wf in R.PRACTICE_WORKFLOWS or rid in system:
            continue  # değerlendirme/hakem/sistem ya da gizli/mühürlü koşu kullanıcının işi sayılmaz
        out.append(DoneRun(rid, float(ts), title, wf))
    return out


def active_agents(svc: "GameService") -> int:
    """Şu an çalışan bir adımı olan farklı ajan sayısı (canlı motor durumu)."""
    busy: set[str] = set()
    try:
        for run in list(svc.studio.engine.runs.values()):
            if getattr(run.spec, "slug", "") in R.PRACTICE_WORKFLOWS:
                continue
            for st in list(run.steps.values()):
                if st.status == "running" and st.spec.agent:
                    busy.add(str(st.spec.agent))
    except Exception:  # noqa: BLE001 - motor yoksa (testler) sıfır
        return 0
    return len(busy)


# ---------------------------------------------------------------- oyun verisi
def _week_active_days(svc: "GameService", since: float, until: float) -> int:
    return int(svc.db.scalar(
        "SELECT COUNT(DISTINCT day) FROM game_ledger WHERE ts>=? AND ts<? AND amount>0 "
        "AND subject_type IN ('agent','human')", since, until))


def scoreboard(svc: "GameService", now: float | None = None) -> dict[str, Any]:
    """Duvar panosu ve dünya kaplaması için tek çağrı. İş KPI'ları oyun ayarından bağımsızdır."""
    now = now or time.time()
    with _cache_lock:
        hit: tuple[float, dict[str, Any]] | None = getattr(svc, "_spot_cache", None)
        if hit and now - hit[0] < CACHE_S and now >= hit[0]:
            return hit[1]
    ds = day_start(now)
    hour0 = datetime.fromtimestamp(now).replace(minute=0, second=0, microsecond=0).timestamp()
    first_hour = hour0 - (HOURS - 1) * 3600
    runs = done_runs(svc, min(ds, first_hour))
    hourly = [0] * HOURS
    for r in runs:
        idx = int((r.ts - first_hour) // 3600)
        if 0 <= idx < HOURS:
            hourly[idx] += 1
    ws, we = week_bounds(R.week_of(now))
    office = svc._subject_view("office", "office")
    data = {
        # iş KPI'ları (oyundan bağımsız)
        "tasks_today": sum(1 for r in runs if r.ts >= ds), "hourly": hourly, "active_agents": active_agents(svc),
        "day_start": _iso(ds), "hours_from": _iso(first_hour),
        # oyun alanları (arayüz oyun kapalı / odak modundayken gizler)
        "level": office["level"], "progress": office["progress"],
        "xp_today": int(svc.db.scalar("SELECT COALESCE(SUM(amount),0) FROM game_ledger WHERE day=? "
                                      "AND subject_type IN ('agent','human')", R.day_of(now))),
        "week_active_days": _week_active_days(svc, ws, we),
    }
    with _cache_lock:
        svc._spot_cache = (now, data)  # type: ignore[attr-defined]
    return data


def invalidate(svc: "GameService") -> None:
    with _cache_lock:
        svc._spot_cache = None  # type: ignore[attr-defined]


def _has_activity(svc: "GameService", week: str) -> bool:
    ws, we = week_bounds(week)
    if int(svc.db.scalar("SELECT COUNT(*) FROM game_ledger WHERE ts>=? AND ts<? AND amount>0", ws, we)):
        return True
    return bool(done_runs(svc, ws, we))


def recap(svc: "GameService", week: str | None = None, now: float | None = None) -> dict[str, Any]:
    """Haftalık özet. Hafta verilmezse: geçen hafta (etkinlik varsa ve kapatılmadıysa), değilse bu hafta."""
    now = now or time.time()
    current = R.week_of(now)
    if week is None:
        prev = R.week_of(week_bounds(current)[0] - 3600)
        week = prev if (not svc.db.meta(f"recap_dismissed:{prev}") and _has_activity(svc, prev)) else current
    if not WEEK_RE.match(week):
        raise ValueError("Geçersiz hafta")
    ws, we = week_bounds(week)
    runs = done_runs(svc, ws, we)
    xp = int(svc.db.scalar("SELECT COALESCE(SUM(amount),0) FROM game_ledger WHERE ts>=? AND ts<? "
                           "AND subject_type IN ('agent','human')", ws, we))
    # (kullanıcı kararı C-02 "ajanlar sıralanmaz"): XP'ye göre "haftanın ajanı" YOK. Yalnızca kullanıcının
    # kendi seçtiği haftanın çalışanı (W4 takdir, `weekly_pick`) varsa gösterilir.
    pick = svc.db.one("SELECT agent, reason FROM weekly_pick WHERE week=?", week)
    return {
        "week": week, "current": week == current, "from": _iso(ws), "to": _iso(we),
        "shipped": len(runs), "titles": [r.title for r in reversed(runs) if r.title][:3],
        "xp": xp,
        "weekly_pick": {"slug": pick["agent"], "name": svc._name(pick["agent"]), "reason": pick["reason"] or ""}
        if pick else None,
        "achievements": int(svc.db.scalar("SELECT COUNT(*) FROM game_achievements WHERE unlocked_at>=? AND "
                                          "unlocked_at<?", ws, we)),
        "quests": int(svc.db.scalar("SELECT COUNT(*) FROM game_quests WHERE status='claimed' AND claimed_at>=? AND "
                                    "claimed_at<?", ws, we)),
        "active_days": _week_active_days(svc, ws, we),
        "dismissed": bool(svc.db.meta(f"recap_dismissed:{week}")),
    }


def dismiss_recap(svc: "GameService", week: str) -> None:
    if not WEEK_RE.match(week):
        raise ValueError("Geçersiz hafta")
    with svc._lock:
        svc.db.set_meta(f"recap_dismissed:{week}", 1)


def contribution(svc: "GameService", period: str = "week", now: float | None = None) -> dict[str, Any]:
    """Ekip katkısı (kullanıcı kararı C-02, seçenek A): ajanlar SIRALANMAZ; ada göre listelenir, üstte ekip toplamı.

    XP yalnızca kanıtlı işten gelir; yanında kanıt olarak biten adım ve ilk turda onay sayısı verilir.
    Sıra numarası ya da "en iyi ajan" alanı yoktur (ajanları hacim için yarıştırmamak)."""
    if period not in ("week", "all"):
        raise ValueError("Geçersiz dönem")
    now = now or time.time()
    since = week_bounds(R.week_of(now))[0] if period == "week" else 0.0
    rows = {r["subject_id"]: r for r in svc.db.q(
        "SELECT subject_id, SUM(amount) xp, SUM(CASE WHEN rule='step_done' AND amount>0 THEN 1 ELSE 0 END) steps, "
        "SUM(CASE WHEN rule='first_try' AND amount>0 THEN 1 ELSE 0 END) first_try FROM game_ledger "
        "WHERE subject_type='agent' AND ts>=? GROUP BY subject_id", since)}
    items = []
    for slug, info in svc._agents.items():
        r = rows.get(slug)
        if info.get("hidden") and not (r and r["xp"]):
            continue
        view = svc._subject_view("agent", slug)
        items.append({"slug": slug, "name": info.get("name") or slug, "xp": int(r["xp"]) if r else 0,
                      "steps": int(r["steps"]) if r else 0, "first_try": int(r["first_try"]) if r else 0,
                      "level": view["level"], "title": view["title"]})
    items.sort(key=lambda x: (str(x["name"]).casefold(), x["slug"]))
    team = {"xp": sum(i["xp"] for i in items), "steps": sum(i["steps"] for i in items),
            "first_try": sum(i["first_try"] for i in items), "agents": sum(1 for i in items if i["xp"] > 0 or i["steps"] > 0)}
    return {"period": period, "since": _iso(since) if since else None, "team": team, "items": items}

