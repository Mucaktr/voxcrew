"""Sistem LLM çağrıları ve gizli sistem koşuları için muhasebe kapısı (AUDIT 2026-10-19 §2.3, P1).

Kural ("her şey bir iş akışı koşusudur"): bir modele token harcatan her çağrı ya

(a) motorda bir `RunState` adımı olarak çalışır (`engine._launch`: bütçe, günlük tavan, iz, graf), ya da
(b) adı konmuş bir **sistem çağrısı** olarak bu modüldeki `account(...)` kapısından geçer.

(b) yalnız beyaz listedeki çağıranlar içindir (`WHITELIST`; mimari test `tests/test_architecture_workflow.py`
bunu kilitler). Bugün **bellek çıkarımı** (`graph/memory.py` → `graph/extract.py`) ve **bağlantı testi**
(`connections/api.py`) bu yolu kullanır.
AI kalite denetçisi (kullanıcı kararı 1, 2026-10-19) (a) yolundadır: gizli, tek adımlı bir sistem koşusu
(`origin` = `system:quality:<çıktı>`; bkz. `quality/reviewer.py`).

`account(...)`:
1. Açılışta günlük tavanı sorar (`daily.ledger_for(...).breach(inclusive=True)`); doluysa `DailyBudgetReached` (409).
   Çağıran bunu yakalayıp LLM'siz yola düşer (ör. sezgisel çıkarım).
2. Kapanışta kullanımı (`add_usage`) günlük deftere yazar (`DailyLedger.add("sys:<tür>", …)`), maliyeti hesaplar
   (yerel 0; ölçülmüş varsa o; yoksa fiyat tablosu tahmini — önbellek token'ları fiyata girmez, TODO P4) ve grafa
   bir `SystemCall` düğümü yazar (isteğe bağlı `CALLED_FOR` kenarı). Graf ya da defter hatası çağrıyı bozmaz.

Gizli sistem koşuları (`SYSTEM_ORIGIN` ön ekli `origin`): koşu listesinde ve oyun ödüllerinde görünmez, iz ve
çıktı ayrıntısında görünür; onay kartı açmaz (bütçe aşımında durur), işe alım yapmaz, üst koşuyla birlikte iptal
edilir. Bu kurallar motorda `is_system_origin` ile uygulanır.

Kullanım alanları (bağlayıcıların `usage` olayıyla aynı anlam):
- `input`: istemin TÜM girdi token'ları (önbellekten okunan ve önbelleğe yazılanlar dahil; geriye uyumlu anlam),
- `output`, `total`,
- `cache_read_tokens` / `cache_write_tokens`: sağlayıcı bildiriyorsa `input`un alt kümeleri (yalnız ölçü; fiyat P4).
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger("studio.workflow.system_calls")

# Beyaz liste: motor dışında model çağırmasına izin verilen sistem işleri (tür → açıklama)
WHITELIST: dict[str, str] = {
    "memory_extract": "Bellek çıkarımı (graph/extract.py, Ollama)",
    "connection_test": "Bağlantı testi (connections/api.py; kullanıcı tıklaması)",
}
SYSTEM_ORIGIN = "system:"            # gizli sistem koşularının origin ön eki
QUALITY_ORIGIN = "system:quality:"   # AI kalite denetçisi koşusu: system:quality:<Deliverable.id>
USAGE_KEYS = ("input", "output", "total", "cache_read_tokens", "cache_write_tokens", "cost_usd")


def is_system_origin(origin: Any) -> bool:
    """Gizli sistem koşusu mu (koşu listesi, oyun ödülleri, çıktı/kabul kancaları bunu atlar)."""
    return isinstance(origin, str) and origin.startswith(SYSTEM_ORIGIN)


def gate(settings: Any) -> None:
    """Günlük tavan dolmuşsa `DailyBudgetReached` (motorun `_daily_gate`i ile aynı kural)."""
    from studio.workflow.daily import DailyBudgetReached, ledger_for  # noqa: PLC0415
    hit = ledger_for(settings).breach(settings, inclusive=True)
    if hit is not None:
        raise DailyBudgetReached(*hit)


def _cost(settings: Any, connector: str | None, connection: str | None, model: str | None,
          usage: dict[str, Any]) -> tuple[float | None, str]:
    from studio.workflow.pricing import LOCAL_CONNECTIONS, estimate_cost, price_overrides  # noqa: PLC0415
    if (connection or connector) in LOCAL_CONNECTIONS:
        return 0.0, "local"
    if connection in ("claude", "codex"):
        try:
            from studio.costing.estimator import Context, StepPlan, billing_of  # noqa: PLC0415
            if billing_of(StepPlan(id="", connection=connection, model=model), Context(session_hints={})) == "subscription":
                return 0.0, "subscription"
        except Exception:  # noqa: BLE001 - fatura türü okunamazsa tahmine düş
            pass
    measured = usage.get("cost_usd")
    if isinstance(measured, (int, float)) and not isinstance(measured, bool):
        return float(measured), "measured"
    # TODO(P4): önbellek okuma/yazma çarpanları (cache_read_tokens / cache_write_tokens) fiyata henüz girmez
    est = estimate_cost(model, usage.get("input"), usage.get("output"), connection=connection,
                        overrides=price_overrides(settings))
    return est, ("estimated" if est is not None else "unknown")


class SystemCall:
    """Tek bir sistem LLM çağrısının muhasebesi. `with account(...) as call:` → `call.add_usage(...)`."""

    def __init__(self, settings: Any, kind: str, *, ref: str | None = None, store: Any = None, bus: Any = None,
                 connector: str | None = None, connection: str | None = None, model: str | None = None,
                 title: str | None = None, ref_node_id: str | None = None):
        if kind not in WHITELIST:
            raise ValueError(f"Beyaz listede olmayan sistem çağrısı: {kind}")
        self.settings, self.kind, self.ref, self.store, self.bus = settings, kind, ref, store, bus
        self.connector, self.connection, self.model = connector, connection or connector, model
        self.title = title or WHITELIST[kind]
        self.ref_node_id = ref_node_id
        self.usage: dict[str, Any] = {}
        self.status = "ok"
        self.error: str | None = None
        self.node: dict[str, Any] | None = None
        self.t0 = time.monotonic()
        gate(settings)   # tavan doluysa burada 409 — model hiç çağrılmaz
        self.reservation = _reserve(self)   # günlük tavandan atomik rezervasyon; sığmazsa 409 (model çağrılmaz)

    def add_usage(self, data: dict[str, Any] | None) -> None:
        """Bağlayıcı/HTTP kullanımını ekler (tur başına; sayısal alanlar toplanır)."""
        for k, v in (data or {}).items():
            if k in USAGE_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool):
                self.usage[k] = self.usage.get(k, 0) + v

    def fail(self, error: str) -> None:
        self.status, self.error = "error", str(error)[:500]

    def __enter__(self) -> "SystemCall":
        return self

    def __exit__(self, exc_type: Any, exc: Any, _tb: Any) -> bool:
        if exc is not None and self.status == "ok":
            self.fail(f"{type(exc).__name__}: {exc}")
        self.finish()
        return False

    def finish(self) -> dict[str, Any]:
        u = self.usage
        if "total" not in u and ("input" in u or "output" in u):
            u["total"] = int(u.get("input") or 0) + int(u.get("output") or 0)
        tokens = int(u.get("total") or 0)
        cost, basis = _cost(self.settings, self.connector, self.connection, self.model, u)
        try:
            from studio.workflow.daily import ledger_for  # noqa: PLC0415
            ledger_for(self.settings).add(f"sys:{self.kind}", cost, tokens)
        except Exception as exc:  # noqa: BLE001 - defter hatası çağrıyı bozmaz
            log.warning("sistem çağrısı günlük deftere yazılamadı: %s", exc)
        # harcama önce günlük deftere, rezervasyon SONRA kapanır (arada ikinci çağrı boş yer görmez)
        _close_reservation(self)
        record = {"id": f"sys_{uuid.uuid4().hex[:12]}", "title": self.title, "kind": self.kind, "ref": self.ref,
                  "connector": self.connector, "connection": self.connection, "model": self.model,
                  "status": self.status, "usage": {**u, "cost_basis": basis,
                                                   "ms": int((time.monotonic() - self.t0) * 1000)},
                  "tokens": tokens, "cost_usd": cost, "error": self.error,
                  "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        if self.store is not None:
            try:
                self.node = self.store.upsert_node("SystemCall", {k: v for k, v in record.items() if v is not None})
                if self.ref_node_id:
                    self.store.link("CALLED_FOR", self.node["id"], self.ref_node_id)
            except Exception as exc:  # noqa: BLE001 - graf hatası çağrıyı bozmaz
                log.warning("SystemCall düğümü yazılamadı: %s", exc)
        if self.bus is not None:
            try:
                self.bus.publish("system.call", **{k: v for k, v in record.items() if k != "error"})
            except Exception:  # noqa: BLE001
                pass
        return record


# ---------------------------------------------------------------- sistem çağrısı rezervasyonu
def _reserve(call: "SystemCall") -> Any:
    """Günlük kapsamda (`reserve.daily_scope`) çağrı başına en çok = geçmişte p90 (yerel/abonelik $0; geçmiş yoksa
    tahmin yok → yalnız "yer var mı" ve uçuşta başka çağrı yok). Sığmazsa `DailyBudgetReached` (çağıran LLM'siz yola
    düşer). Rezervasyon defteri ya da geçmiş okunamazsa çağrı engellenmez (fail-open, eski davranış)."""
    from studio.workflow.daily import DailyBudgetReached  # noqa: PLC0415
    try:
        from studio.costing.estimator import per_call_max  # noqa: PLC0415
        from studio.workflow.pricing import estimate_cost, price_overrides  # noqa: PLC0415
        from studio.workflow.reserve import book_for, daily_scope  # noqa: PLC0415
        cost0, billing = _cost(call.settings, call.connector, call.connection, call.model, {"input": 0, "output": 0})
        billing = "local" if billing == "local" else "subscription" if billing == "subscription" else "api"
        need: dict[str, Any] = {"tokens": None, "cost_usd": 0.0 if billing != "api" else None, "basis": "none"}
        if call.store is not None:
            from studio.costing.history import History  # noqa: PLC0415
            hist = _HISTORY.get(id(call.store))
            if hist is None or hist.store is not call.store:
                hist = _HISTORY[id(call.store)] = History(call.store)
            conn = call.connection or call.connector or ""
            need = per_call_max(hist, conn, call.model, "system", billing=billing,
                                price=lambda tin, tout: estimate_cost(call.model, tin, tout, connection=conn,
                                                                      overrides=price_overrides(call.settings)))
        key = f"{SYS_KEY}{call.kind}:{uuid.uuid4().hex[:10]}"
        book = book_for(call.settings)
        res, blocked = book.reserve(key, run_id=None, step_id=None, purpose=call.kind,
                                    need={"tokens": need.get("tokens"), "cost_usd": need.get("cost_usd"),
                                          "minutes": None},
                                    scopes=[daily_scope(call.settings)],
                                    basis="history" if need.get("basis") == "history" else "none")
    except Exception as exc:  # noqa: BLE001 - rezervasyon altyapısı hatası çağrıyı engellemez
        log.warning("sistem çağrısı rezerve edilemedi: %s", exc)
        return None
    if blocked is not None:
        if call.bus is not None:
            try:
                call.bus.publish("budget.exceeded", scope="daily", reserve="system_call", kind=call.kind,
                                 metric=blocked.metric, used=round(blocked.projected, 6), limit=blocked.limit)
            except Exception:  # noqa: BLE001
                pass
        raise DailyBudgetReached(blocked.metric, blocked.projected, blocked.limit)
    _publish(call, "budget.reserved", res)
    return res


def _close_reservation(call: "SystemCall") -> None:
    """Çağrı bitti: kullanım bildirildiyse (ya da hatasız bittiyse) uzlaştır; kullanım bildirmeden hatayla bittiyse
    belirsiz — `reserve.UNCERTAIN_TTL_S` boyunca tutulur (erken bırakılmaz)."""
    res = getattr(call, "reservation", None)
    if res is None:
        return
    call.reservation = None
    try:
        from studio.workflow.reserve import book_for  # noqa: PLC0415
        book = book_for(call.settings)
        tokens = float(call.usage.get("total") or (call.usage.get("input") or 0) + (call.usage.get("output") or 0))
        if call.status != "ok" and tokens <= 0:
            # aynı tür + hedefin (ör. aynı bağlantı testi) art arda başarısızlığı günlük yeri bir kez tutar
            slot = (call.kind, str(call.ref or ""), str(call.connection or call.connector or ""))
            with _UNCERTAIN_LOCK:
                prev = _UNCERTAIN.get(slot)
                _UNCERTAIN[slot] = res.key
            if prev and prev != res.key:
                gone = book.release(prev)
                if gone is not None:
                    _publish(call, "budget.released", gone)
            out = book.mark_uncertain(res.key)
            _publish(call, "budget.reserved", out)
            return
        book.consume(res.key, {"tokens": tokens})
        _publish(call, "budget.settled", book.settle(res.key))
    except Exception as exc:  # noqa: BLE001
        log.warning("sistem çağrısı rezervasyonu kapatılamadı: %s", exc)


def _publish(call: "SystemCall", etype: str, res: Any) -> None:
    if call.bus is None or res is None:
        return
    try:
        call.bus.publish(etype, system_call=call.kind, ref=call.ref, **res.to_dict())
    except Exception:  # noqa: BLE001
        pass


_HISTORY: dict[int, Any] = {}
SYS_KEY = "sys:"
_UNCERTAIN: dict[tuple[str, str, str], str] = {}   # (tür, hedef, bağlantı) → son belirsiz rezervasyon
_UNCERTAIN_LOCK = threading.Lock()


def account(settings: Any, kind: str, *, ref: str | None = None, store: Any = None, bus: Any = None,
            connector: str | None = None, connection: str | None = None, model: str | None = None,
            title: str | None = None, ref_node_id: str | None = None) -> SystemCall:
    """Beyaz listedeki bir sistem çağrısını açar (günlük tavan kapısı hemen uygulanır). Bağlam yöneticisidir."""
    return SystemCall(settings, kind, ref=ref, store=store, bus=bus, connector=connector, connection=connection,
                      model=model, title=title, ref_node_id=ref_node_id)
