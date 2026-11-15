"""Ofis sağlığı panosu ( "yerel Ofis sağlığı"; yalnız kullanıcıya, hiçbir yere gönderilmez).

Dürüst sinyaller, yalnız GERÇEK veriden (graf ve canlı motor, salt okunur):

- `approvals` bekleyen onay kapıları ve teslim kabulleri, en eski bekleme; son 7 günde ortalama karar süresi
- `failures` son 7 günde başarısız koşular ve reddedilen teslimler; hata sınıfı başına koşu sayısı (`classes`,
               yalnız bilgi: durum, puan ya da ceza değişmez)
- `stuck` 30 dakikadır ilerlemeyen "çalışıyor" ve 24 saattir duraklatılmış koşular
- `budget` bütçeli koşulardan sınırın %80'ine yaklaşan ya da aşanlar
- `quality` son 7 gündeki kalite kapısı sonuçları (geçti / uyarı / kaldı)
- `bench` yedekteki ve 14 gündür iş almamış etkin ajan SAYISI

Her sinyal tek bir önerilen eylem taşır. Ajanlar sıralanmaz ve adla karşılaştırılmaz (kullanıcı kararı C-02):
yalnız sayılar ve süreler verilir. Kuzey yıldızı: bu hafta kabul edilen teslim (WAD).
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

from studio.game import rules as R
from studio.game.first_session import SKIP_ORIGINS, ts_of
from studio.workflow import error_class as ec

if TYPE_CHECKING:
    from studio.api import Studio

DAY = 86400.0
STUCK_RUNNING_S = 30 * 60
STUCK_PAUSED_S = DAY
PENDING_ACT_S = DAY
IDLE_S = 14 * DAY
SCAN = 2000
GATE_STATES = ("awaiting_approval", "awaiting_tool_approval")


def _node_ts(n: dict[str, Any], key: str = "created_at") -> float | None:
    return ts_of(n["props"].get(key)) or ts_of(n.get(key))


def _sig(sid: str, status: str, action: str, to: str, **values: Any) -> dict[str, Any]:
    """status: ok | watch | act | none (veri yok). `action` arayüzde yerelleştirilen eylem anahtarıdır."""
    return {"id": sid, "status": status, "action": {"key": action, "to": to}, **values}


def _approvals(studio: "Studio", now: float, since: float) -> dict[str, Any]:
    gates: list[float] = []
    try:
        for run in list(studio.engine.runs.values()):
            for st in list(run.steps.values()):
                if st.status in GATE_STATES:
                    gates.append(ts_of(getattr(st, "started_at", None)) or now)
    except Exception:  # noqa: BLE001 - canlı motor okunamazsa yalnız kabuller sayılır
        pass
    pending = [(_node_ts(n) or now) for n in studio.store.nodes("Acceptance", limit=SCAN, order="created_at ASC",
                                                                 props={"status": "pending"})]
    waits: list[float] = []
    for status in ("accepted", "rejected"):
        for n in studio.store.nodes("Acceptance", limit=SCAN, order="updated_at DESC", props={"status": status}):
            decided, created = ts_of(n["props"].get("decided_at")), _node_ts(n)
            if decided and created and decided >= since and decided >= created:
                waits.append(decided - created)
    oldest = max((now - t for t in [*gates, *pending]), default=None)
    avg = round(sum(waits) / len(waits) / 60, 1) if waits else None
    count = len(gates) + len(pending)
    status = "act" if oldest is not None and oldest >= PENDING_ACT_S else "watch" if count else \
        "ok" if waits else "none"
    return _sig("approvals", status, "review_pending" if count else "keep_deciding", "/gelen-kutusu",
                gates=len(gates), deliveries=len(pending),
                oldest_min=None if oldest is None else round(oldest / 60, 1), avg_decision_min=avg,
                decided=len(waits))


def _recent_runs(studio: "Studio", since: float) -> list[dict[str, Any]]:
    out = []
    for n in studio.store.nodes("Run", limit=SCAN, order="created_at DESC"):
        t = ts_of(n["props"].get("started_at")) or _node_ts(n)
        if t is None or t < since:
            continue  # sıralama created_at, karşılaştırma started_at; sıra dışı satır taramayı bitirmesin
        if str(n["props"].get("origin") or "").startswith(SKIP_ORIGINS) or n["props"].get("hidden"):
            continue
        out.append(n)
    return out


def _failures(studio: "Studio", runs: list[dict[str, Any]], since: float) -> dict[str, Any]:
    failed = sum(1 for n in runs if n["props"].get("status") in ("failed", "rejected"))
    rejected = 0
    for n in studio.store.nodes("Acceptance", limit=SCAN, order="updated_at DESC", props={"status": "rejected"}):
        if n["props"].get("review_status") == "revision_requested":
            continue  # PROC-FIX revizyon isteği bir ret değildir (eski `status` alanı geriye uyum için rejected)
        decided = ts_of(n["props"].get("decided_at"))
        if decided and decided >= since:
            rejected += 1
    total = len(runs)
    rate = round(failed / total, 2) if total else None
    status = "none" if not total and not rejected else \
        "act" if failed >= 3 or (rate or 0) >= 0.3 else "watch" if failed or rejected else "ok"
    # başarısız ya da kısmen başarısız koşuların hata sınıfı sayımı (yalnız sayı; durumu etkilemez)
    classes = {k: v for k, v in ec.counts(n["props"].get("error_class") for n in runs
                                          if n["props"].get("error_class")).items() if v}
    return _sig("failures", status, "open_failed" if failed or rejected else "keep_going", "/gorevler",
                runs=total, failed=failed, rejected=rejected, rate=rate, classes=classes)


def _stuck(studio: "Studio", now: float) -> dict[str, Any]:
    running = paused = 0
    for status, limit, bump in (("running", STUCK_RUNNING_S, "r"), ("paused", STUCK_PAUSED_S, "p")):
        for n in studio.store.nodes("Run", limit=SCAN, order="updated_at ASC", props={"status": status}):
            t = ts_of(n.get("updated_at")) or _node_ts(n)
            if t is not None and now - t >= limit:
                if bump == "r":
                    running += 1
                else:
                    paused += 1
    n = running + paused
    return _sig("stuck", "act" if running else "watch" if paused else "ok",
                "open_stuck" if n else "nothing_stuck", "/gorevler", running=running, paused=paused)


def _budget(runs: list[dict[str, Any]]) -> dict[str, Any]:
    budgeted = near = over = 0
    tokens = 0
    for n in runs:
        p = n["props"]
        usage = p.get("usage") if isinstance(p.get("usage"), dict) else {}
        # PROC-FIX: gerçek harcama = güncel denemeler + atılan denemeler (çatala kopyalanan hariç)
        tokens += int(usage.get("tokens") or 0) + int(((usage.get("replayed") or {}).get("tokens")) or 0)
        budget = p.get("budget") if isinstance(p.get("budget"), dict) else {}
        ratios = [float(usage.get(k) or 0) / float(v) for k, v in budget.items()
                  if isinstance(v, (int, float)) and v > 0 and k in ("tokens", "cost_usd", "minutes", "steps")]
        overran = int(p.get("budget_overruns") or 0) > 0  # PROC-FIX: kart onayıyla tavan sonradan yükselse de aştı
        if not ratios and not overran:
            continue
        budgeted += 1
        top = max(ratios) if ratios else 0.0
        if top >= 1 or overran:
            over += 1
        elif top >= 0.8:
            near += 1
    status = "none" if not budgeted else "act" if over else "watch" if near else "ok"
    action = "raise_or_split" if over or near else "set_budget" if not budgeted else "budget_fine"
    return _sig("budget", status, action, "/akislar", budgeted=budgeted, near=near, over=over, tokens=tokens,
                runs=len(runs))


def _quality(studio: "Studio", since: float) -> dict[str, Any]:
    counts = {"passed": 0, "warn": 0, "failed": 0}
    anyway = 0
    for n in studio.store.nodes("QualityReport", limit=SCAN, order="updated_at DESC"):
        t = ts_of(n["props"].get("updated_at")) or ts_of(n.get("updated_at"))
        if t is None or t < since:
            continue  # düğüm updated_at ile props.updated_at farklı sıralanabilir; erken bitirme yok
        s = n["props"].get("status")
        if s in counts:
            counts[s] += 1
        if n["props"].get("accepted_anyway"):
            anyway += 1
    total = sum(counts.values())
    blocking = max(0, counts["failed"] - anyway)
    status = "none" if not total else "act" if blocking else "watch" if counts["warn"] else "ok"
    return _sig("quality", status, "fix_quality" if blocking or counts["warn"] else
                "add_quality" if not total else "quality_fine", "/ciktilar", total=total, accepted_anyway=anyway,
                **counts)


def _bench(studio: "Studio", now: float) -> dict[str, Any]:
    from studio.game.api import get_service  # noqa: PLC0415 - kadro okuması C1 kontrol noktasından (T15)

    state = get_service(studio).roster_state()
    nodes = state["nodes"]
    bench = sum(1 for n in nodes if n["props"].get("benched"))
    used = state["last_used"]
    busy = state["busy"]
    idle = 0
    for n in nodes:
        p = n["props"]
        if p.get("benched") or p["slug"] in busy:
            continue
        last = ts_of(used.get(p["slug"])) or _node_ts(n)
        if last is not None and now - last >= IDLE_S:
            idle += 1
    status = "watch" if bench or idle else "ok" if nodes else "none"
    return _sig("bench", status, "swap_bench" if bench or idle else "roster_fine", "/paket",
                bench=bench, idle=idle, active=len(nodes) - bench)


def health(studio: "Studio", now: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    since = now - 7 * DAY
    from studio.game.spotlight import week_bounds  # noqa: PLC0415

    ws = week_bounds(R.week_of(now))[0]
    runs = _recent_runs(studio, since)
    wad = 0
    for n in studio.store.nodes("Acceptance", limit=SCAN, order="updated_at DESC", props={"status": "accepted"}):
        decided = ts_of(n["props"].get("decided_at"))
        if decided and decided >= ws:
            wad += 1
    signals = [_approvals(studio, now, since), _failures(studio, runs, since), _stuck(studio, now),
               _budget(runs), _quality(studio, since), _bench(studio, now)]
    return {"wad": wad, "week": R.week_of(now), "window_days": 7, "signals": signals,
            "attention": sum(1 for s in signals if s["status"] == "act")}
