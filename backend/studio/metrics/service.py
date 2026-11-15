"""Ölçüm servisi (G1-A): graftan filigranlı doldurma, olay yolu abonesi ve kuzey yıldızı hesapları.

Tanımlar:

- **Kök görev** (`task_root_id`): çatal zincirinin (`forked_from`) ilk koşusu. Gizli sistem koşusu (`system:…`,
  `parent_run`) ve ajan hakem koşusu (`review:acc_<koşu>`) bağlı olduğu koşunun köküne bağlanır.
- **Köken sınıfı** (`origin_class`, tek yer: `classify_origin`): `eval` · `system` · `academy` · `demo` · `real`.
- **WAD**: haftada `real` kök görevlerden kullanıcının (`reviewer_kind = user`) kabul ettikleri, kök başına bir kez,
  yerine yenisi gelmemiş en son kabul edilen sürümde ve G1-C `derive_outcome` sonucu `accepted` olanlar (`partial`
  ayrı ölçüdür). Eski `Acceptance.status` alanı kullanılmaz (ret ile revizyon isteğini karıştırır).
  Hafta ve gün sınırı `studio.clock` (yerel 04:00).
- **TPA / kabul başına maliyet**: pencere içindeki `real` köklere bağlı tüm kullanım (başarısız, iptal, duraklatılmış
  koşular, köke bağlanan gizli denetçi/hakem koşuları) + köke bağlanamayan sistem çağrıları (bellek çıkarımı) / pencere
  içinde kabul edilen kök sayısı. Payda 0 → `None` + `"undefined"`.
- Abonelik ve yerel beyin maliyeti "$0" değil `subscription` / `local` diye ayrı sayılır.

Gizlilik: deftere yalnız kimlik ve sayı yazılır; ağ çağrısı yoktur.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterable

from studio import clock
from studio.metrics import ledger as L

if TYPE_CHECKING:
    from studio.api import Studio

log = logging.getLogger("studio.metrics")

# ------------------------------------------------------------------ sabitler
EVAL_PREFIX = "eval:"
REVIEW_PREFIX = "review:"          # ajan hakem koşusu: review:acc_<run_id>
LEGACY_QUALITY_PREFIX = "quality:"
SYSTEM_PREFIXES = ("system:", REVIEW_PREFIX, LEGACY_QUALITY_PREFIX)  # system: = gizli sistem koşusu (CORE-P1)
ACADEMY_SLUG = "akademi-alistirma"  # tam sürüm PRACTICE_SLUG
CLASSES = ("real", "demo", "academy", "eval", "system")
WINDOWS = {"7d": 7, "28d": 28, "all": None}
SETTLED = ("done", "failed", "cancelled", "paused", "interrupted")
MATURE_DAYS = 7
DEFAULT_RETENTION_DAYS = 400
PAGE = 500
UNDEFINED = "undefined"
SUBSCRIPTION_LOCAL = "subscription_local"
NOT_MEASURED = "not_measured"   # sağlayıcı önbellek alanı bildirmedi (arayüz: "ölçülmedi")
METERED_BASES = ("measured", "estimated", "mixed")
SYNC_EVENTS = {"run.started", "run.finished", "run.paused", "run.forked", "acceptance.updated", "system.call"}
DEBOUNCE_S = 1.0


# ------------------------------------------------------------------ saf yardımcılar
def classify_origin(origin: Any, workflow: Any = None, agents: Iterable[Any] = (),
                    is_demo_agent: Callable[[str], bool] | None = None) -> str:
    """Koşunun köken sınıfı (TEK yer; CORE-P1 biçimi değişirse yalnız burası güncellenir).

    Sıra: `eval:` → eval; `system:` (gizli denetçi, `workflow/system_calls.SYSTEM_ORIGIN`), `review:` (ajan hakem),
    `quality:` (eski) → system; akademi alıştırma akışı → academy; ajanlı adımların tümü demo ajan → demo; gerisi real.
    """
    o = str(origin or "")
    if o.startswith(EVAL_PREFIX):
        return "eval"
    if o.startswith(SYSTEM_PREFIXES):
        return "system"
    if str(workflow or "") == ACADEMY_SLUG:
        return "academy"
    named = [str(a) for a in agents if a]
    if named and is_demo_agent is not None and all(is_demo_agent(a) for a in named):
        return "demo"
    return "real"


def to_ts(value: Any) -> float | None:
    """ISO metin ya da sayı → unix zaman damgası (saat dilimsiz ISO yerel kabul edilir)."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def utc_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds")


def day_index(ts: float) -> int:
    """Studio günü (04:00 sınırlı yerel tarih) → sıra sayısı; iki gün arasındaki fark gün sayısıdır."""
    return clock.shifted(ts).date().toordinal()


def day_start_ts(ordinal: int) -> float:
    d = datetime.fromordinal(ordinal)
    return datetime(d.year, d.month, d.day, clock.DAY_START_HOUR).timestamp()


def window_start(window: str, now: float) -> float | None:
    days = WINDOWS.get(window)
    if days is None:
        return None
    return day_start_ts(day_index(now) - (days - 1))


def input_signature(inputs: Any) -> str | None:
    """Girdilerin kısa özeti (yalnız eşitlik karşılaştırması için; içerik saklanmaz)."""
    if inputs in (None, {}, [], ""):
        return None
    raw = json.dumps(inputs, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def task_family(props: dict[str, Any]) -> str:
    slug = str(props.get("workflow") or "")
    if slug.startswith("recipe-"):
        return f"recipe:{slug[len('recipe-'):]}"
    if slug == "gorev" or props.get("kind") == "task":
        return "gorev"
    return f"workflow:{slug or 'unknown'}"


def ratio(num: float, den: int) -> float | None:
    return None if den <= 0 else num / den


def percentile(values: list[float], q: float) -> float | None:
    """En yakın sıra (nearest-rank) yüzdeliği."""
    if not values:
        return None
    s = sorted(values)
    k = max(1, math.ceil(q / 100.0 * len(s)))
    return s[min(k, len(s)) - 1]


def personal_windows(accepts: list[tuple[float, str | None]], now: float) -> dict[str, Any]:
    """Kişisel tekrar pencereleri. `accepts` = (kabul zamanı, girdi imzası) listesi.

    İlk kabulün studio gününe göre [7,14) ve [28,35). günlerde, ilk kabulden FARKLI girdi imzalı yeni kabul var mı.
    Pencere bitmediyse ve henüz kabul yoksa `None` (olgunlaşıyor). `repeat_14d`: ilk 14 günde farklı girdili ikinci kabul.
    Yalnız bilgi; hedef, seri ya da baskı yoktur.
"""
    if not accepts:
        return {"first_accept_at": None, "repeat_14d": None, "w1": None, "w4": None}
    items = sorted(accepts, key=lambda a: a[0])
    t0, sig0 = items[0]
    d0, today = day_index(t0), day_index(now)

    def hit(lo: int, hi: int) -> bool | None:
        found = any(lo <= day_index(t) - d0 < hi and (sig is None or sig != sig0) and t > t0 for t, sig in items[1:])
        if found:
            return True
        return False if today - d0 >= hi else None

    return {"first_accept_at": utc_iso(t0), "repeat_14d": hit(0, 14),
            "w1": hit(7, 14), "w4": hit(28, 35)}


# ------------------------------------------------------------------ servis
class MetricsService:
    def __init__(self, studio: Any, data_dir: Path | str | None = None):
        self.studio = studio
        base = Path(data_dir) if data_dir else Path(studio.changes.data_dir)
        self.ledger = L.MetricsLedger(base / "metrics.sqlite")
        self._sync_lock = threading.Lock()
        self._run_cache: dict[str, dict[str, Any] | None] = {}
        self._demo_cache: dict[str, bool] = {}

    # ------------------------------------------------------------ graf okuma
    @property
    def store(self) -> Any:
        return self.studio.store

    def _run(self, run_id: str | None) -> dict[str, Any] | None:
        if not run_id:
            return None
        if run_id not in self._run_cache:
            node = self.store.find("Run", str(run_id))
            self._run_cache[run_id] = dict(node["props"]) if node else None
        return self._run_cache[run_id]

    def _is_demo_agent(self, slug: str) -> bool:
        if slug not in self._demo_cache:
            try:
                node = self.studio.agents.node(slug)
            except Exception:  # noqa: BLE001 - ajan okunamazsa demo sayılmaz
                node = None
            self._demo_cache[slug] = bool(node and node["props"].get("demo") is True)
        return self._demo_cache[slug]

    def classify(self, props: dict[str, Any] | None) -> str:
        if not props:
            return "real"
        agents = [s.get("agent") for s in props.get("steps") or [] if isinstance(s, dict)]
        return classify_origin(props.get("origin"), props.get("workflow"), agents, self._is_demo_agent)

    def _link_parent(self, props: dict[str, Any]) -> str | None:
        """Bir koşunun bağlı olduğu koşu: gizli sistem koşusu → `parent_run`; hakem → kabulün koşusu; çatal → kaynak."""
        if props.get("parent_run"):
            return str(props["parent_run"])
        origin = str(props.get("origin") or "")
        if origin.startswith(REVIEW_PREFIX):
            acc = origin[len(REVIEW_PREFIX):]
            return acc[4:] if acc.startswith("acc_") else None
        if origin.startswith("system:quality:"):
            ref = origin[len("system:quality:"):]
            if self._run(ref):
                return ref
            dlv = self.store.find("Deliverable", ref) if ref else None
            if dlv and dlv["props"].get("run_id"):
                return str(dlv["props"]["run_id"])
            return None
        if props.get("forked_from"):
            return str(props["forked_from"])
        return None

    def root_of(self, run_id: str) -> tuple[str, int]:
        """(kök koşu kimliği, çatal derinliği). Döngüye karşı korumalı."""
        cur, depth, seen = run_id, 0, {run_id}
        for _ in range(64):
            props = self._run(cur)
            if not props:
                break
            parent = self._link_parent(props)
            if not parent or parent in seen or not self._run(parent):
                break
            if props.get("forked_from") and str(props["forked_from"]) == parent:
                depth += 1
            seen.add(parent)
            cur = parent
        return cur, depth

    def _own_usage(self, props: dict[str, Any]) -> dict[str, Any]:
        """Koşunun KENDİ kullanımı. Çatal, kaynağın bitmiş adımlarını kopyalar (karar 13); kopyalar düşülür."""
        usage = props.get("usage") if isinstance(props.get("usage"), dict) else {}
        tokens = props.get("tokens") if isinstance(props.get("tokens"), dict) else {}
        total, cost = self._spent(usage, tokens)
        brk = {k: float(tokens.get(k) or 0) for k in ("input", "output", "cache_read_tokens", "cache_write_tokens")}
        cache_known = "cache_read_tokens" in tokens or "cache_write_tokens" in tokens
        parent = props.get("forked_from")
        # Motorun kaydı (`usage.inherited` alanı var) çatala kopyalanan adımları zaten dışarıda tutar; yalnız eski
        # kayıtlarda (alan yok) kopyalar toplamdan düşülür (iki kez düşülmesin)
        if parent and "inherited" not in usage:
            copied = self._copied_steps(str(props.get("id")), str(parent))
            for st in copied:
                su = st.get("usage") if isinstance(st.get("usage"), dict) else {}
                stk = st.get("tokens") if isinstance(st.get("tokens"), dict) else {}
                total -= float(su.get("tokens") or stk.get("total") or 0)
                if cost is not None and isinstance(su.get("cost_usd"), (int, float)):
                    cost -= float(su["cost_usd"])
                for k in brk:
                    brk[k] -= float(stk.get(k) or 0)
        total = max(0.0, total)
        brk = {k: max(0.0, v) for k, v in brk.items()}
        if cost is not None:
            cost = max(0.0, round(cost, 6))
        fresh_input = max(0.0, brk["input"] - brk["cache_read_tokens"] - brk["cache_write_tokens"])
        return {"tokens_total": total, "tokens_input": fresh_input, "tokens_output": brk["output"],
                "tokens_cache_read": brk["cache_read_tokens"], "tokens_cache_write": brk["cache_write_tokens"],
                "cache_known": 1 if cache_known and total > 0 else 0, "cost_usd": cost,
                "cost_basis": str(usage.get("cost_basis") or "unknown")}

    def _copied_steps(self, run_id: str, parent_id: str) -> list[dict[str, Any]]:
        """Çatala kaynaktan kopyalanan adımlar: aynı adım kimliği ve aynı başlangıç zamanı."""
        try:
            mine = self.store.nodes("Step", limit=1000, props={"run_id": run_id})
            theirs = self.store.nodes("Step", limit=1000, props={"run_id": parent_id})
        except Exception:  # noqa: BLE001
            return []
        src = {(n["props"].get("step_id"), n["props"].get("started_at")) for n in theirs
               if n["props"].get("started_at")}
        return [n["props"] for n in mine
                if n["props"].get("started_at") and (n["props"].get("step_id"), n["props"].get("started_at")) in src]

    @staticmethod
    def _spent(usage: dict[str, Any], tokens: dict[str, Any] | None = None) -> tuple[float, float | None]:
        """koşunun GERÇEK harcaması (güncel denemeler + durdurulan/yeniden oynatılan denemeler, `usage.spent`):
        kart, çubuk, "Bugünkü harcama", iz ve öngörüyle aynı sayı. Eski kayıtta `spent` yoksa `tokens + replayed`."""
        def num(v: Any) -> float | None:
            return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
        spent = usage.get("spent") if isinstance(usage.get("spent"), dict) else {}
        replayed = usage.get("replayed") if isinstance(usage.get("replayed"), dict) else {}
        base = float(usage.get("tokens") or (tokens or {}).get("total") or 0)
        total = num(spent.get("tokens"))
        if total is None:
            total = base + float(num(replayed.get("tokens")) or 0)
        cost = num(spent.get("cost_usd")) if "cost_usd" in spent else None
        if cost is None:
            c = num(usage.get("cost_usd"))
            rc = num(replayed.get("cost_usd")) or 0.0
            cost = None if c is None and not rc else float(c or 0) + rc
        return total, cost

    @staticmethod
    def _overrun(props: dict[str, Any]) -> bool:
        budget = props.get("budget") if isinstance(props.get("budget"), dict) else {}
        usage = props.get("usage") if isinstance(props.get("usage"), dict) else {}
        spent = usage.get("spent") if isinstance(usage.get("spent"), dict) else {}
        for metric in ("tokens", "cost_usd", "minutes", "steps"):
            # tavan mutlak toplamdır → gerçek harcamayla (yeniden oynatılan denemeler dahil) karşılaştırılır
            cap, used = budget.get(metric), (spent.get(metric) if spent.get(metric) is not None else usage.get(metric))
            if isinstance(cap, (int, float)) and isinstance(used, (int, float)) and used > cap:
                return True
        return False

    @staticmethod
    def _unknown_effects(props: dict[str, Any]) -> int:
        ck = props.get("checkpoint") if isinstance(props.get("checkpoint"), dict) else {}
        effects = props.get("effects") or ck.get("effects") or []
        return sum(1 for e in effects if isinstance(e, dict) and e.get("status") == "unknown")

    def _environment(self) -> str:
        try:
            if self.studio.settings.get("admin.enabled", False) is True:
                return "admin_preview"
        except Exception:  # noqa: BLE001
            pass
        return "normal"

    def _base(self, etype: str, eid: str, ts: float, cls: str, root_cls: str | None, *, run_id: str | None = None,
              root: str | None = None, attempt: int = 0, family: str | None = None, recipe_version: Any = None,
              env: str = "normal") -> dict[str, Any]:
        from studio import __version__  # noqa: PLC0415
        return {"event_id": eid, "event_type": etype, "event_version": L.EVENT_VERSION, "occurred_at": ts,
                "occurred_at_utc": utc_iso(ts), "received_at_utc": utc_iso(time.time()), "app_version": __version__,
                "is_demo": 1 if cls == "demo" or root_cls == "demo" else 0, "environment": env, "run_id": run_id,
                "task_root_id": root, "attempt": attempt, "task_family": family,
                "recipe_version": str(recipe_version)[:64] if recipe_version else None,
                "origin_class": cls, "root_class": root_cls}

    # ------------------------------------------------------------ olay türetme
    def events_for_run(self, node: dict[str, Any], env: str = "normal") -> list[dict[str, Any]]:
        props = dict(node["props"])
        run_id = str(props.get("id") or "")
        if not run_id:
            return []
        self._run_cache[run_id] = props
        cls = self.classify(props)
        root, depth = self.root_of(run_id)
        root_props = self._run(root) or props
        root_cls = cls if root == run_id else self.classify(root_props)
        family = task_family(root_props)
        rv = props.get("recipe_version") or root_props.get("recipe_version")
        started = to_ts(props.get("started_at")) or to_ts(node.get("created_at")) or time.time()
        common = {"run_id": run_id, "root": root, "attempt": depth, "family": family, "recipe_version": rv, "env": env}
        out = [{**self._base(L.TASK_SUBMITTED, L.event_id(L.TASK_SUBMITTED, run_id), started, cls, root_cls, **common),
                "input_sig": input_signature(props.get("inputs")), "status": "started"}]
        status = str(props.get("status") or "")
        if status in SETTLED:
            usage = self._own_usage(props)
            at = to_ts(props.get("finished_at")) or to_ts(node.get("updated_at")) or started
            eid = L.event_id(L.COST_RECORDED, run_id, status, props.get("finished_at") or node.get("updated_at"),
                             round(usage["tokens_total"]), usage["cost_usd"])
            ck = props.get("checkpoint") if isinstance(props.get("checkpoint"), dict) else {}
            reason = props.get("pause_reason") or ck.get("pause_reason")
            budget_stop = status in ("paused", "failed", "cancelled") and (reason == "budget" or self._overrun(props))
            out.append({**self._base(L.COST_RECORDED, eid, at, cls, root_cls, **common), **usage, "status": status,
                        "budget_overrun": 1 if self._overrun(props) else 0, "budget_stop": 1 if budget_stop else 0,
                        "unknown_effects": self._unknown_effects(props)})
        return out

    def _outcome(self, run_props: dict[str, Any], acc: dict[str, Any]) -> dict[str, Any]:
        """G1-C `derive_outcome` (içe aktarılır; kural kopyalanmaz). Girdiler graftaki Run ve QualityReport'tan."""
        from studio.outcome import derive_outcome  # noqa: PLC0415
        ck = run_props.get("checkpoint") if isinstance(run_props.get("checkpoint"), dict) else {}
        steps = [{"id": (it.get("spec") or {}).get("id"), "status": it.get("status"),
                  "soft_fail": bool(it.get("soft_fail")), "artifacts": bool(it.get("artifacts"))}
                 for it in ck.get("steps") or [] if isinstance(it, dict) and not it.get("parent")]
        run = {"status": run_props.get("status"), "output": run_props.get("output") or "", "steps": steps}
        if run_props.get("indeterminate"):
            run["indeterminate"] = True
        effects = [e for e in ck.get("effects") or [] if isinstance(e, dict)]
        try:
            quality = [{"deliverable_id": q["props"].get("deliverable_id"), "status": q["props"].get("status"),
                        "accepted_anyway": bool(q["props"].get("accepted_anyway"))}
                       for q in self.store.nodes("QualityReport", limit=50, props={"run_id": run_props.get("id")})]
        except Exception:  # noqa: BLE001 - kalite raporu okunamazsa sonuç kalite eksiği olmadan türetilir
            quality = []
        return derive_outcome(run, acc, effects, quality)

    def events_for_acceptance(self, node: dict[str, Any], env: str = "normal") -> list[dict[str, Any]]:
        """İnceleme kararı (G1-C `review_status`; eski `status` alanına güvenilmez: ret ile revizyon isteğini
        karıştırır). Sonuç `derive_outcome` ile türetilir; sürüm ve `superseded_by` kaydedilir."""
        from studio.outcome import legacy_review_status  # noqa: PLC0415
        p = node["props"]
        review = legacy_review_status(p)
        if review == "unreviewed":
            return []
        run_id = str(p.get("run_id") or "")
        props = self._run(run_id)
        if not props:
            return []
        cls = self.classify(props)
        root, depth = self.root_of(run_id)
        root_props = self._run(root) or props
        root_cls = cls if root == run_id else self.classify(root_props)
        outcome = str(self._outcome(props, p).get("outcome") or "pending")
        etype = L.ARTIFACT_ACCEPTED if review == "accepted" else L.ARTIFACT_REJECTED
        at = to_ts(p.get("decided_at")) or to_ts(node.get("updated_at")) or time.time()
        missing = any(isinstance(c, dict) and c.get("kind") == "artifacts" and c.get("status") == "failed"
                      for c in p.get("checks") or [])
        superseded = 1 if p.get("superseded_by") else 0
        try:
            version = int(p.get("version") or 1)
        except (TypeError, ValueError):
            version = 1
        eid = L.event_id(etype, p.get("id"), p.get("decided_at") or node.get("updated_at"), review, outcome,
                         superseded)
        return [{**self._base(etype, eid, at, cls, root_cls, run_id=run_id, root=root, attempt=depth,
                              family=task_family(root_props), recipe_version=root_props.get("recipe_version"), env=env),
                 "status": review, "review_status": review, "outcome": outcome, "version": version,
                 "superseded": superseded, "reviewer_kind": str(p.get("reviewer_kind") or "") or None,
                 "ref_id": str(p.get("id") or "") or None, "input_sig": input_signature(props.get("inputs")),
                 "missing_artifacts": 1 if missing else 0}]

    def events_for_system_call(self, node: dict[str, Any], env: str = "normal") -> list[dict[str, Any]]:
        """Motor dışı sistem çağrısı (bugün: bellek çıkarımı). `CALLED_FOR` bir koşuya gidiyorsa o köke bağlanır;
        yoksa köksüz sistem maliyetidir ve pencere payına girer."""
        p = node["props"]
        sid = str(p.get("id") or node.get("id"))
        run_id = root = None
        root_cls: str | None = None
        depth = 0
        try:
            for _e, nb, _d in self.store.neighbors(node["id"], ["CALLED_FOR"], "out"):
                if nb.get("type") == "Run":
                    run_id = str(nb["props"].get("id"))
                    break
        except Exception:  # noqa: BLE001
            run_id = None
        if run_id and self._run(run_id):
            root, depth = self.root_of(run_id)
            root_cls = self.classify(self._run(root))
        usage = p.get("usage") if isinstance(p.get("usage"), dict) else {}
        tokens = float(p.get("tokens") or usage.get("total") or 0)
        inp, outp = float(usage.get("input") or 0), float(usage.get("output") or 0)
        cr, cw = float(usage.get("cache_read_tokens") or 0), float(usage.get("cache_write_tokens") or 0)
        cost = p.get("cost_usd")
        at = to_ts(p.get("created_at")) or to_ts(node.get("created_at")) or time.time()
        return [{**self._base(L.COST_RECORDED, L.event_id(L.COST_RECORDED, "sys", sid), at, "system", root_cls,
                              run_id=run_id, root=root, attempt=depth, family=f"system:{p.get('kind') or 'call'}",
                              env=env),
                 "status": "done" if p.get("status") == "ok" else "failed", "ref_id": sid, "tokens_total": tokens,
                 "tokens_input": max(0.0, inp - cr - cw), "tokens_output": outp, "tokens_cache_read": cr,
                 "tokens_cache_write": cw,
                 "cache_known": 1 if tokens > 0 and ("cache_read_tokens" in usage or "cache_write_tokens" in usage) else 0,
                 "cost_usd": float(cost) if isinstance(cost, (int, float)) and not isinstance(cost, bool) else None,
                 "cost_basis": str(usage.get("cost_basis") or "unknown")}]

    # ------------------------------------------------------------ doldurma
    def retention_days(self) -> int:
        """Saklama süresi (gün): defterin `meta.retention_days` değeri; yoksa 400. Sınır 30–3650."""
        try:
            v = int(self.ledger.get_meta("retention_days") or DEFAULT_RETENTION_DAYS)
        except (TypeError, ValueError):
            v = DEFAULT_RETENTION_DAYS
        return max(30, min(3650, v))

    def set_retention_days(self, days: int) -> int:
        days = max(30, min(3650, int(days)))
        self.ledger.set_meta("retention_days", str(days))
        self.ledger.purge_before(time.time() - days * 86400)
        return days

    def sync(self) -> int:
        """Graftan filigranlı artımlı okuma (Run, Acceptance, SystemCall) → deftere `INSERT OR IGNORE`."""
        if not self._sync_lock.acquire(blocking=True, timeout=30):
            return 0
        try:
            self._run_cache.clear()
            self._demo_cache.clear()
            epoch = self.ledger.epoch()
            env = self._environment()
            added = 0
            for type_name, fn in (("Run", self.events_for_run), ("Acceptance", self.events_for_acceptance),
                                  ("SystemCall", self.events_for_system_call)):
                added += self._sync_type(type_name, fn, epoch, env)
            self.ledger.purge_before(time.time() - self.retention_days() * 86400)
            return added
        finally:
            self._sync_lock.release()

    def refresh(self) -> int:
        """Okumadan önce defteri güncel getirir: CDC tüketicisi bağlıysa günlükten (Faz B-1), değilse ya da CDC
        okunamazsa eski filigranlı tarama (`sync`). Dönüş: işlenen günlük satırı ya da eklenen olay sayısı."""
        runner = getattr(self.studio, "_cdc", None)
        if runner is not None and runner.has("metrics"):
            try:
                return runner.poll("metrics")
            except Exception:  # noqa: BLE001 - CDC hatası okumayı bozmaz; tarama yedeği
                log.warning("metrics: CDC okunamadı, taramaya dönülüyor", exc_info=True)
        return self.sync()

    def _nodes_since(self, type_name: str, mark: str, offset: int, limit: int) -> list[dict[str, Any]]:
        """Filigrandan (dahil) sonraki düğümler, `updated_at` sırasıyla. `updated_at` saniye çözünürlüklü olduğundan
        sınır saniyesindeki düğümler bir sonraki taramada yeniden okunur (olay kimliği deterministik: yinelenmez).
        Grafın okuma bağlantısı varsa SQL ile süzülür; yoksa genel `nodes()` taranır (aynı sonuç, daha yavaş)."""
        reader = getattr(self.store, "_read", None)
        if reader is not None:
            from studio.graph.store import _node  # noqa: PLC0415
            with reader() as conn:
                rows = conn.execute("SELECT * FROM nodes WHERE type=? AND updated_at >= ? "
                                    "ORDER BY updated_at ASC, id ASC LIMIT ? OFFSET ?",
                                    (type_name, mark, int(limit), int(offset))).fetchall()
            return [_node(r) for r in rows]
        out = [n for n in self.store.nodes(type_name, limit=100000, order="updated_at ASC")
               if str(n.get("updated_at") or "") >= mark]
        out.sort(key=lambda n: (str(n.get("updated_at") or ""), str(n["id"])))
        return out[offset:offset + limit]

    def _sync_type(self, type_name: str, fn: Callable[..., list[dict[str, Any]]], epoch: float, env: str) -> int:
        key = f"watermark:{type_name}"
        start = self.ledger.get_meta(key, "") or ""
        newest, added, offset = start, 0, 0
        while True:
            try:
                nodes = self._nodes_since(type_name, start, offset, PAGE)
            except Exception:  # noqa: BLE001 - graf okunamazsa defter olduğu gibi kalır
                log.exception("metrics: %s okunamadı", type_name)
                break
            batch: list[dict[str, Any]] = []
            for n in nodes:
                try:
                    evs = fn(n, env)
                except Exception:  # noqa: BLE001 - tek kayıt hatası taramayı durdurmaz
                    log.exception("metrics: %s %s işlenemedi", type_name, n.get("id"))
                    evs = []
                batch += [e for e in evs if e["occurred_at"] >= epoch]
                newest = max(newest, str(n.get("updated_at") or ""))
            added += self.ledger.insert(batch)
            if len(nodes) < PAGE:
                break
            offset += PAGE
        if newest != start:
            self.ledger.set_meta(key, newest)
        return added

    def erase(self) -> int:
        """Kullanıcı silmesi: defter boşalır; silme anından önceki graf geçmişi yeniden doldurulmaz."""
        with self._sync_lock:
            return self.ledger.clear(time.time())

    # ------------------------------------------------------------ hesaplar
    def _state(self) -> dict[str, Any]:
        evs = self.ledger.events()
        submitted: dict[str, dict[str, Any]] = {}
        latest_cost: dict[str, dict[str, Any]] = {}
        loose_costs: list[dict[str, Any]] = []
        decisions: dict[str, dict[str, Any]] = {}
        for e in evs:
            t = e["event_type"]
            if t == L.TASK_SUBMITTED and e["run_id"]:
                submitted[e["run_id"]] = e
            elif t == L.COST_RECORDED:
                if e["ref_id"] and e["task_family"] and str(e["task_family"]).startswith("system:"):
                    loose_costs.append(e)  # sistem çağrısı (tek kayıt; köke bağlı olabilir)
                elif e["run_id"]:
                    latest_cost[e["run_id"]] = e  # olaylar zamana göre sıralı: son anlık görüntü kazanır
            elif t in (L.ARTIFACT_ACCEPTED, L.ARTIFACT_REJECTED) and e["ref_id"]:
                prev = decisions.get(e["ref_id"])
                if prev is not None and prev["superseded"] and not e["superseded"]:
                    e = {**e, "superseded": 1}  # yerine yeni sürüm gelmesi geri alınmaz
                decisions[e["ref_id"]] = e
        return {"submitted": submitted, "cost": latest_cost, "sys": loose_costs, "decisions": decisions}

    @staticmethod
    def _root_accepts(decisions: dict[str, dict[str, Any]], outcome: str = "accepted") -> dict[str, dict[str, Any]]:
        """Kök görev (çıktı zinciri) başına tek kayıt: yerine yenisi gelmemiş, kullanıcının (`reviewer_kind = user`)
        kabul ettiği EN SON sürüm; sonucu (`derive_outcome`) `outcome` olanlar. Yalnız `real` kökler."""
        latest: dict[str, dict[str, Any]] = {}
        for d in decisions.values():
            if (d["event_type"] != L.ARTIFACT_ACCEPTED or d["reviewer_kind"] != "user" or d["root_class"] != "real"
                    or d["superseded"]):
                continue
            root = d["task_root_id"] or d["run_id"]
            cur = latest.get(root)
            if cur is None or (d["version"], d["occurred_at"]) > (cur["version"], cur["occurred_at"]):
                latest[root] = d
        return {r: d for r, d in latest.items() if d["outcome"] == outcome}

    def summary(self, window: str = "7d", now: float | None = None, *, sync: bool = True) -> dict[str, Any]:
        if window not in WINDOWS:
            window = "7d"
        if sync:
            self.refresh()
        now = time.time() if now is None else now
        start = window_start(window, now)
        st = self._state()
        accepts = self._root_accepts(st["decisions"])
        partials = self._root_accepts(st["decisions"], "partial")

        def in_win(ts: float) -> bool:
            return (start is None or ts >= start) and ts <= now

        # --- kuzey yıldızı: WAD (bu studio haftası) ve değerli haftalar (toplam; seri yok)
        this_week = clock.week_of(now)
        weeks = {clock.week_of(a["occurred_at"]) for a in accepts.values()}
        wad = sum(1 for a in accepts.values() if clock.week_of(a["occurred_at"]) == this_week)

        # --- pay: real köklere bağlı tüm kullanım + köksüz sistem çağrıları
        accepted_win = [r for r, a in accepts.items() if in_win(a["occurred_at"])]
        contrib = [c for c in st["cost"].values() if c["root_class"] == "real" and in_win(c["occurred_at"])]
        contrib += [c for c in st["sys"] if in_win(c["occurred_at"]) and c["root_class"] in ("real", None)]
        tok = {k: sum(float(c[k] or 0) for c in contrib) for k in
               ("tokens_total", "tokens_input", "tokens_output", "tokens_cache_read", "tokens_cache_write")}
        with_tokens = [c for c in contrib if float(c["tokens_total"] or 0) > 0]
        known = sum(1 for c in with_tokens if c["cache_known"])
        cache_split = "unknown" if not with_tokens or known == 0 else ("measured" if known == len(with_tokens) else "partial")
        # önbellek isabeti = Σ cache_read / Σ girdi (önbelleksiz + okuma + yazma), yalnız sağlayıcının önbellek
        # alanı bildirdiği katkılarda; hiç yoksa None → "ölçülmedi" (0 uydurulmaz)
        measured = [c for c in with_tokens if c["cache_known"]]
        hit_in = sum(float(c["tokens_input"] or 0) + float(c["tokens_cache_read"] or 0)
                     + float(c["tokens_cache_write"] or 0) for c in measured)
        hit_ratio = ratio(sum(float(c["tokens_cache_read"] or 0) for c in measured), hit_in) if hit_in > 0 else None
        bases: dict[str, int] = {}
        metered = 0.0
        metered_n = 0
        for c in contrib:
            b = str(c["cost_basis"] or "unknown")
            if float(c["tokens_total"] or 0) <= 0 and c["cost_usd"] in (None, 0):
                continue
            bases[b] = bases.get(b, 0) + 1
            if b in METERED_BASES and c["cost_usd"] is not None:
                metered += float(c["cost_usd"])
                metered_n += 1
        den = len(accepted_win)
        tpa = ratio(tok["tokens_total"], den)
        cpa = ratio(metered, den) if metered_n else None
        if den == 0:
            cpa_label = UNDEFINED
        elif metered_n == 0 and (bases.get("subscription") or bases.get("local")):
            cpa_label = SUBSCRIPTION_LOCAL
        elif metered_n == 0:
            cpa_label = UNDEFINED
        else:
            cpa_label = None
        statuses: dict[str, int] = {}
        for c in contrib:
            key = "system" if c["origin_class"] == "system" else str(c["status"] or "unknown")
            statuses[key] = statuses.get(key, 0) + 1

        # --- görev başarısı (7 günü dolmuş kökler)
        real_roots = {rid: e for rid, e in st["submitted"].items() if e["origin_class"] == "real" and e["attempt"] == 0
                      and (e["task_root_id"] in (None, rid))}
        started_win = {r: e for r, e in real_roots.items() if in_win(e["occurred_at"])}
        mature = {r: e for r, e in started_win.items() if now - e["occurred_at"] >= MATURE_DAYS * 86400}
        maturing = len(started_win) - len(mature)
        succ = [r for r, e in mature.items()
                if r in accepts and accepts[r]["occurred_at"] - e["occurred_at"] < MATURE_DAYS * 86400]
        chain_last: dict[str, dict[str, Any]] = {}
        for c in st["cost"].values():
            root = c["task_root_id"] or c["run_id"]
            if c["origin_class"] != "system" and (root not in chain_last
                                                  or c["occurred_at"] >= chain_last[root]["occurred_at"]):
                chain_last[root] = c
        fail_brk = {"cancelled": 0, "budget_stop": 0, "technical_failure": 0, "other": 0}
        for r in mature:
            if r in succ:
                continue
            last = chain_last.get(r)
            if last is None:
                fail_brk["other"] += 1
            elif last["budget_stop"]:
                fail_brk["budget_stop"] += 1
            elif last["status"] == "cancelled":
                fail_brk["cancelled"] += 1
            elif last["status"] == "failed":
                fail_brk["technical_failure"] += 1
            else:
                fail_brk["other"] += 1

        # --- düzeltme yükü: kabul edilen köklerin çatal (revizyon) sayısı / kabul
        forks: dict[str, int] = {}
        for e in st["submitted"].values():
            if e["origin_class"] == "real" and e["attempt"] > 0 and e["task_root_id"]:
                forks[e["task_root_id"]] = forks.get(e["task_root_id"], 0) + 1
        revisions = sum(forks.get(r, 0) for r in accepted_win)

        # --- güvenilirlik ve bütçe (pencere; real kökler)
        real_runs = [c for c in st["cost"].values() if c["root_class"] == "real" and c["origin_class"] != "system"
                     and in_win(c["occurred_at"])]
        missing = sum(1 for d in st["decisions"].values()
                      if d["root_class"] == "real" and d["missing_artifacts"] and in_win(d["occurred_at"]))

        # --- kişisel pencereler (tüm zamanlar)
        pw = personal_windows([(a["occurred_at"], a["input_sig"]) for a in accepts.values()], now)

        return {
            "window": {"key": window, "start": utc_iso(start) if start is not None else None, "end": utc_iso(now),
                       "day_start_hour": clock.DAY_START_HOUR},
            "north_star": {"wad": wad, "week": this_week, "valuable_weeks_total": len(weeks),
                           # "kısmen kullanılabilir" kabul tam başarı sayılmaz: ayrı ölçü (G1-C `partial`)
                           "partial_week": sum(1 for a in partials.values()
                                               if clock.week_of(a["occurred_at"]) == this_week),
                           "partial_window": sum(1 for a in partials.values() if in_win(a["occurred_at"]))},
            "accepted": den,
            "tpa": {"value": round(tpa, 1) if tpa is not None else None, "label": UNDEFINED if tpa is None else None,
                    "tokens": round(tok["tokens_total"]),
                    "breakdown": {"input": round(tok["tokens_input"]), "output": round(tok["tokens_output"]),
                                  "cache_read": round(tok["tokens_cache_read"]),
                                  "cache_write": round(tok["tokens_cache_write"])},
                    "cache_split": cache_split, "contributors": statuses,
                    "cache_hit": {"ratio": round(hit_ratio, 4) if hit_ratio is not None else None,
                                  "label": NOT_MEASURED if hit_ratio is None else None, "measured": len(measured)}},
            "cpa": {"value": round(cpa, 6) if cpa is not None else None, "label": cpa_label,
                    "cost_usd": round(metered, 6), "basis": bases},
            "task_success": {"started": len(started_win), "mature": len(mature), "maturing": maturing,
                             "accepted": len(succ), "rate": ratio(len(succ), len(mature)),
                             "label": UNDEFINED if not mature else None, "not_accepted": fail_brk},
            "correction_load": {"revisions": revisions, "per_accept": ratio(revisions, den),
                                "label": UNDEFINED if den == 0 else None},
            "personal_windows": pw,
            "reliability": {"interrupted": sum(1 for c in real_runs if c["status"] == "interrupted"),
                            "missing_artifacts": missing,
                            "unknown_effects": sum(int(c["unknown_effects"] or 0) for c in real_runs)},
            "budget": {"overruns": sum(1 for c in real_runs if c["budget_overrun"])},
            "privacy": {"local_only": True, "network": False, "retention_days": self.retention_days(),
                        "events": self.ledger.count()},
        }

    def strip(self, window: str = "7d", now: float | None = None, *, sync: bool = True) -> dict[str, Any]:
        """Ana ekran şeridi: maliyet · token · ajan süresi · testler. Yeni veri toplanmaz; var olan kaynaklar:
        maliyet/token = defterdeki COST_RECORDED (summary ile aynı `real` kök katkısı), tur = bitmiş `real` koşu,
        süre = Run.duration_ms (motorun etkin süresi), testler = en son `real` koşunun QualityReport durumu.
        Kaynağı olmayan değer `None` döner (uydurma sıfır yok); fiyatsız yerel/abonelik maliyeti `basis` ile ayrılır."""
        if window not in WINDOWS:
            window = "7d"
        if sync:
            self.refresh()
        now = time.time() if now is None else now
        start = window_start(window, now)

        def in_win(ts: float) -> bool:
            return (start is None or ts >= start) and ts <= now

        st = self._state()
        contrib = [c for c in st["cost"].values() if c["root_class"] == "real" and in_win(c["occurred_at"])]
        contrib += [c for c in st["sys"] if in_win(c["occurred_at"]) and c["root_class"] in ("real", None)]
        turns = sorted((c for c in contrib if c["origin_class"] != "system" and c["run_id"]),
                       key=lambda c: c["occurred_at"])
        metered = [c for c in contrib if str(c["cost_basis"] or "unknown") in METERED_BASES and c["cost_usd"] is not None]
        cost_total = round(sum(float(c["cost_usd"]) for c in metered), 6)
        bases = {str(c["cost_basis"] or "unknown") for c in contrib if float(c["tokens_total"] or 0) > 0}
        if metered:
            basis = "metered"
        elif "local" in bases:
            basis = "local"
        elif "subscription" in bases:
            basis = "subscription"
        else:
            basis = None  # kullanım yok ya da maliyet bilinmiyor: arayüz "henüz veri yok" der
        turn_costs = [float(c["cost_usd"]) for c in turns
                      if str(c["cost_basis"] or "unknown") in METERED_BASES and c["cost_usd"] is not None]
        tokens = round(sum(float(c["tokens_total"] or 0) for c in contrib))
        durs = []
        for c in turns:
            d = (self._run(c["run_id"]) or {}).get("duration_ms")
            if isinstance(d, (int, float)) and not isinstance(d, bool) and d >= 0:
                durs.append(float(d) / 1000.0)
        return {
            "window": window,
            "turns": len(turns),
            "cost": {"basis": basis, "usd": cost_total if metered else None,
                     "last_usd": turn_costs[-1] if turn_costs else None,
                     "avg_usd": round(sum(turn_costs) / len(turn_costs), 6) if turn_costs else None,
                     "spark": [round(v, 6) for v in turn_costs[-14:]]},
            "tokens": {"total": tokens if tokens > 0 else None},
            "agent_time": {"seconds": round(sum(durs), 1) if durs else None,
                           "avg_seconds": round(sum(durs) / len(durs), 1) if durs else None, "runs": len(durs)},
            "tests": self._latest_tests(),
        }

    def _latest_tests(self) -> dict[str, Any]:
        """En son gerçek koşunun kalite kapısı raporu (`QualityReport.status`: passed | warn | failed)."""
        try:
            reports = self.store.nodes("QualityReport", limit=50, order="updated_at DESC")
        except Exception:  # noqa: BLE001 - graf okunamazsa "henüz yok"
            return {"status": None, "at": None}
        for q in reports:
            p = q["props"]
            run = self._run(p.get("run_id"))
            if run is None or self.classify(run) != "real":
                continue
            status = p.get("status") if p.get("status") in ("passed", "warn", "failed") else None
            at = to_ts(p.get("updated_at")) or to_ts(q.get("updated_at")) or to_ts(p.get("created_at"))
            return {"status": status, "at": at}
        return {"status": None, "at": None}

    def cost_distribution(self, window: str = "all", now: float | None = None, *, sync: bool = True) -> dict[str, Any]:
        """Görev ailesi başına kök görev maliyeti: P50 / P95 / P99 / en yüksek, en pahalı %5'in toplamdaki payı, n."""
        if window not in WINDOWS:
            window = "all"
        if sync:
            self.refresh()
        now = time.time() if now is None else now
        start = window_start(window, now)
        st = self._state()
        per_root: dict[str, dict[str, Any]] = {}
        rows = [c for c in st["cost"].values() if c["root_class"] == "real"]
        rows += [c for c in st["sys"] if c["root_class"] == "real" and c["task_root_id"]]
        for c in rows:
            root = c["task_root_id"] or c["run_id"]
            sub = st["submitted"].get(root)
            if sub is None or (start is not None and sub["occurred_at"] < start):
                continue
            r = per_root.setdefault(root, {"family": sub["task_family"] or "unknown", "tokens": 0.0, "cost": 0.0,
                                           "cost_n": 0})
            r["tokens"] += float(c["tokens_total"] or 0)
            if c["cost_usd"] is not None and str(c["cost_basis"]) in METERED_BASES:
                r["cost"] += float(c["cost_usd"])
                r["cost_n"] += 1
        fams: dict[str, list[dict[str, Any]]] = {}
        for r in per_root.values():
            fams.setdefault(r["family"], []).append(r)

        def dist(values: list[float]) -> dict[str, Any]:
            total = sum(values)
            top_n = max(1, math.ceil(len(values) * 0.05)) if values else 0
            top = sum(sorted(values, reverse=True)[:top_n])
            return {"n": len(values), "p50": percentile(values, 50), "p95": percentile(values, 95),
                    "p99": percentile(values, 99), "max": max(values) if values else None,
                    "top5_share": round(top / total, 4) if total > 0 else None}

        families = []
        for fam, items in sorted(fams.items()):
            costed = [i["cost"] for i in items if i["cost_n"]]
            families.append({"family": fam, "tokens": dist([i["tokens"] for i in items]), "cost_usd": dist(costed)})
        return {"window": window, "families": families}

    def token_report(self, window: str = "7d", now: float | None = None) -> dict[str, Any]:
        """G4 ölçüsü: adım başına jeton dağılımı (P50/P95, `real` koşuların biten ajan adımları; bağlayıcı ve adım türü
        başına) + referanslı araç çıktısı tasarrufu (kaçınılan karakter). Kabul başına jeton `summary`dedir (G1-A).
        Yalnız sayı; graf ve `<veri>/tool_outputs/index.sqlite` üzerinde yereldir."""
        if window not in WINDOWS:
            window = "7d"
        now = time.time() if now is None else now
        start = window_start(window, now)
        reader = getattr(self.store, "_read", None)
        if reader is not None:
            from studio.graph.store import _node  # noqa: PLC0415
            with reader() as conn:
                rows = [_node(r) for r in conn.execute("SELECT * FROM nodes WHERE type='Step'").fetchall()]
        else:
            rows = self.store.nodes("Step", limit=100000)
        values: list[float] = []
        by_conn: dict[str, list[float]] = {}
        by_type: dict[str, list[float]] = {}
        capped = 0
        for n in rows:
            p = n["props"]
            if p.get("type", "agent") not in ("agent", "delegate", "orchestrate", "system_llm"):
                continue
            if p.get("status") not in ("done", "failed", "cancelled", "skipped", "rejected"):
                continue
            ts = to_ts(p.get("finished_at"))
            if ts is None or (start is not None and ts < start):
                continue
            usage = p.get("usage") if isinstance(p.get("usage"), dict) else {}
            tok = float(usage.get("tokens") or 0)
            if tok <= 0:
                continue
            if self.classify(self._run(p.get("run_id"))) != "real":
                continue
            values.append(tok)
            by_conn.setdefault(str(p.get("connector") or "unknown"), []).append(tok)
            by_type.setdefault(str(p.get("type") or "agent"), []).append(tok)
            budget = p.get("budget") if isinstance(p.get("budget"), dict) else {}
            if budget.get("tokens") and tok >= float(budget["tokens"]):
                capped += 1

        def dist(vals: list[float]) -> dict[str, Any]:
            return {"n": len(vals), "p50": percentile(vals, 50), "p95": percentile(vals, 95),
                    "max": max(vals) if vals else None, "total": sum(vals)}

        try:
            from studio.tools.outputs import store_for  # noqa: PLC0415
            tstore = store_for(self.studio.settings)
            savings = tstore.savings(start) if tstore is not None else None
        except Exception:  # noqa: BLE001 - ölçü hiçbir işi bozmaz
            savings = None
        empty = {"artifacts": 0, "stored_chars": 0, "inline_chars": 0, "chars_avoided": 0, "chars_read_back": 0,
                 "net_chars_avoided": 0, "reads": 0, "basis": "chars"}
        return {"window": window, "steps": {**dist(values), "at_step_cap": capped,
                                            "by_connector": {k: dist(v) for k, v in sorted(by_conn.items())},
                                            "by_type": {k: dist(v) for k, v in sorted(by_type.items())}},
                "tool_outputs": savings or empty}


# ------------------------------------------------------------------ yaşam döngüsü
def service_for(studio: Any) -> MetricsService:
    svc = getattr(studio, "_metrics", None)
    if svc is None:
        svc = MetricsService(studio)
        studio._metrics = svc
    return svc


async def _consume(studio: "Studio", q: Any) -> None:
    svc = service_for(studio)
    while True:
        ev = await q.get()
        if ev.get("type") not in SYNC_EVENTS:
            continue
        await asyncio.sleep(DEBOUNCE_S)  # aynı anda gelen olaylar tek taramada işlenir
        while not q.empty():
            q.get_nowait()
        try:
            await asyncio.to_thread(svc.sync)
        except Exception:  # noqa: BLE001 - ölçüm hiçbir işi bozmaz
            log.exception("metrics: eşitleme başarısız")


async def start(studio: "Studio") -> None:
    if getattr(studio, "_metrics_task", None) is not None:
        return
    try:
        service_for(studio)
    except Exception:  # noqa: BLE001 - defter açılamazsa stüdyo yine açılır
        log.exception("metrics: defter açılamadı")
        return
    try:  # Faz B-1: graf CDC günlüğünden artımlı (studio/cdc_consumers.py çalıştırır); eski tarama yedekte kalır
        from studio.cdc_consumers import runner_for  # noqa: PLC0415
        from studio.metrics.cdc import MetricsCdcConsumer  # noqa: PLC0415
        runner_for(studio).register(MetricsCdcConsumer(service_for(studio)))
        return
    except Exception:  # noqa: BLE001 - CDC kurulamazsa eski olay-yolu + tarama tüketicisi
        log.exception("metrics: CDC tüketicisi kurulamadı; filigranlı taramaya dönülüyor")
    q = studio.bus.subscribe()
    studio._metrics_queue = q  # type: ignore[attr-defined]
    studio._metrics_task = asyncio.create_task(_consume(studio, q), name="metrics-consumer")  # type: ignore[attr-defined]


async def stop(studio: "Studio") -> None:
    task = getattr(studio, "_metrics_task", None)
    if task is not None:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        studio._metrics_task = None  # type: ignore[attr-defined]
    q = getattr(studio, "_metrics_queue", None)
    if q is not None:
        studio.bus.unsubscribe(q)
        studio._metrics_queue = None  # type: ignore[attr-defined]
    svc = getattr(studio, "_metrics", None)
    if svc is not None:
        svc.ledger.close()
        studio._metrics = None  # type: ignore[attr-defined]


__all__ = ["MetricsService", "classify_origin", "personal_windows", "service_for", "start", "stop"]
