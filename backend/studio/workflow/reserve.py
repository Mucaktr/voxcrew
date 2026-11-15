"""Atomik bütçe rezervasyonu (Rehber 1 AW-R21, §13.4).

Kural: her model ya da araç turundan ÖNCE, tavanı olan her kapsam için (koşu, adım, günlük)

    kullanılan + açık rezervasyonlar + yeni ≤ tavan

denetlenir ve sığarsa rezervasyon aynı kilit altında yazılır. Kilit TEK'tir (ayar nesnesi başına bir defter; motor,
paralel adımlar, gizli sistem koşuları ve `system_calls` aynı defteri paylaşır). Böylece iki paralel adım son
bakiyeyi birlikte aşamaz: ikisi de "yer var" görüp aynı anda gönderemez.

- **Yeni** = çağrı başına en çok (`estimate.estimator.per_call_max`): bu bilgisayarın geçmişinde p90 jeton ve süre;
  para = p90 jeton × fiyat. Yerel ve abonelikli beyinde para 0 (yalnız jeton ve süre ayrılır).
- **Tahmin yoksa** (geçmiş örneği yok) uydurma miktar ayrılmaz: çağrı yalnız tavanda yer kaldıysa (kullanılan + açık <
  tavan) ve aynı kapsamda uçuşta başka çağrı yoksa gider (boyutu bilinmeyen iki çağrı aynı tavanı birlikte
  aşamasın). Aşımda motor `ask` kartı açar (gizli koşu durur).
- **Açık rezervasyon** = ayrılan − bu çağrının şimdiye kadar bildirilen kullanımı (`consume`); kullanım zaten
  "kullanılan"a girdiği için iki kez sayılmaz.
- **Kapanış:** temiz biten çağrı `settle` (kalan serbest; olay `budget.settled`). Kullanım bildirmeden yarıda kalan
  (hata, zaman aşımı, iptal) çağrı **belirsizdir**: rezervasyonu erken bırakılmaz (`uncertain`); aynı çağrı yeniden
  denenince aynı anahtarla yeniden kullanılır (sistem kaynaklı yeniden deneme ikinci rezervasyon/ücret
  doğurmaz), koşu bitince ya da `UNCERTAIN_TTL_S` sonra bırakılır (`budget.released`).
- Defter bellek içidir (süreç yeniden başlarsa açık rezervasyon kalmaz; uçuştaki çağrılar da kalmaz).

Olaylar (motor koşu olayı olarak yayar; sistem çağrısı veri yoluna): `budget.reserved`, `budget.settled`,
`budget.released` (Rehber adlarıyla `budget_reserved/settled/released`).
"""

from __future__ import annotations

import math
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

METRICS = ("tokens", "cost_usd", "minutes")
UNCERTAIN_TTL_S = 15 * 60.0     # belirsiz rezervasyonun en uzun tutulma süresi
SYS_PREFIX = "sys:"


def _f(v: Any) -> float:
    try:
        x = float(v or 0)
    except (TypeError, ValueError):
        return 0.0
    return x if math.isfinite(x) else 0.0


def _need(metric: str, v: Any) -> float | None:
    """tahmin temizliği. Sonlu olmayan (NaN/inf) ya da negatif tahmin ve 0 jetonluk tahmin (kullanımı
    bildirilmemiş geçmiş) BİLİNMİYOR sayılır → "yer var mı + uçuşta başka çağrı yok" kuralı uygulanır."""
    if v is None:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x) or x < 0 or (metric == "tokens" and x <= 0):
        return None
    return x


@dataclass
class Reservation:
    key: str
    run_id: str | None
    step_id: str | None
    purpose: str
    amount: dict[str, float | None]           # None = bu metrikte tahmin yok (yalnız "yer var mı")
    base: dict[str, float] = field(default_factory=dict)       # açılıştaki kullanım (consume bundan farkı alır)
    consumed: dict[str, float] = field(default_factory=lambda: {m: 0.0 for m in METRICS})
    basis: str = "history"                    # history | none
    status: str = "open"                      # open (uçuşta) | uncertain (yarıda kaldı, tutuluyor)
    id: str = field(default_factory=lambda: f"res_{uuid.uuid4().hex[:12]}")
    opened: float = field(default_factory=time.time)
    since: float = field(default_factory=time.time)
    reused: int = 0

    def remaining(self, metric: str) -> float:
        a = self.amount.get(metric)
        if a is None:
            return 0.0
        return max(0.0, float(a) - self.consumed.get(metric, 0.0))

    def exhausted(self) -> bool:
        """Tahmini olan bir metrikte ayrılan tükendi mi (araç turu yeni dilim ister)."""
        return any(self.amount.get(m) is not None and self.consumed.get(m, 0.0) >= float(self.amount[m] or 0)
                   and float(self.amount[m] or 0) > 0 for m in METRICS)

    def to_dict(self) -> dict[str, Any]:
        return {"reservation_id": self.id, "key": self.key, "purpose": self.purpose, "basis": self.basis,
                "status": self.status, "reused": self.reused,
                "reserved": {m: (None if self.amount.get(m) is None else round(float(self.amount[m] or 0), 6))
                             for m in METRICS},
                "consumed": {m: round(self.consumed.get(m, 0.0), 6) for m in METRICS}}


@dataclass
class Scope:
    """Denetlenecek tek tavan. `used` sözlük ya da kilit içinde okunan işlev; `member` hangi rezervasyonların bu
    kapsamın açık rezervasyonu sayıldığını söyler."""
    name: str                                   # run | step | daily
    limits: dict[str, float | None]
    used: dict[str, float] | Callable[[], dict[str, float]]
    member: Callable[[Reservation], bool]
    # boyutu bilinmeyen çağrı aynı kapsamda uçuşta başka çağrı varken beklesin mi. Otomatik koşu bütçesinde
    # (kullanıcı sınır koymadı) hayır: yalnız "yer var mı" denetlenir, paralel adımlar sıraya girmez (geçmişsiz ilk
    # koşu yavaşlamaz); kullanıcının koyduğu sınırda eski kural (iki bilinmeyen boyut sınırı birlikte aşmasın)
    serial_unknown: bool = True


@dataclass
class Blocked:
    scope: str
    metric: str
    projected: float      # kullanılan + açık + yeni
    limit: float
    wait: bool            # uçuşta başka çağrı var: bitince yer açılabilir (bekle, sonra yeniden dene)
    basis: str

    def to_dict(self) -> dict[str, Any]:
        return {"scope": self.scope, "metric": self.metric, "projected": round(self.projected, 6),
                "limit": self.limit, "wait": self.wait, "basis": self.basis}


class ReservationBook:
    """Ayar nesnesi başına tek defter; tüm denetim + yazma tek `threading.Lock` altında (sistem çağrıları iş
    parçacığından da gelir)."""

    def __init__(self, on_change: Callable[[dict[str, float]], None] | None = None):
        self._lock = threading.Lock()
        self.items: dict[str, Reservation] = {}
        self.version = 0
        self.on_change = on_change   # günlük deftere açık rezervasyon toplamı (`DailyLedger.reserved`)

    # ------------------------------------------------------------ iç
    def _expire(self, now: float) -> list[Reservation]:
        out = [r for r in self.items.values() if r.status == "uncertain" and now - r.since > UNCERTAIN_TTL_S]
        for r in out:
            self.items.pop(r.key, None)
        return out

    def _bump(self) -> None:
        self.version += 1
        if self.on_change is not None:
            try:
                self.on_change(self.totals_unlocked())
            except Exception:  # noqa: BLE001 - görünüm hatası rezervasyonu bozmaz
                pass

    def totals_unlocked(self) -> dict[str, float]:
        return {m: round(sum(r.remaining(m) for r in self.items.values()), 6) for m in METRICS}

    def _check(self, key: str, new: dict[str, float | None], scopes: list[Scope], basis: str) -> Blocked | None:
        for sc in scopes:
            used = sc.used() if callable(sc.used) else sc.used
            others = [r for r in self.items.values() if r.key != key and sc.member(r)]
            in_flight = any(r.status == "open" for r in others)
            for m in METRICS:
                limit = sc.limits.get(m)
                if limit is None:
                    continue
                limit = float(limit)
                base = _f(used.get(m)) + sum(r.remaining(m) for r in others)
                n = new.get(m)
                if n is None:
                    # tahmin yok: yer kalmalı ve aynı tavanda uçuşta başka çağrı olmamalı (bilinmeyen boyut)
                    if base >= limit or (in_flight and sc.serial_unknown):
                        return Blocked(sc.name, m, base, limit, in_flight, "none")
                    continue
                if base + float(n) > limit:
                    return Blocked(sc.name, m, base + float(n), limit, in_flight, basis)
        return None

    # ------------------------------------------------------------ genel
    def get(self, key: str) -> Reservation | None:
        with self._lock:
            return self.items.get(key)

    def open_for(self, run_id: str | None = None) -> list[Reservation]:
        with self._lock:
            return [r for r in self.items.values() if run_id is None or r.run_id == run_id]

    def totals(self) -> dict[str, float]:
        with self._lock:
            return self.totals_unlocked()

    def reserve(self, key: str, *, run_id: str | None, step_id: str | None, purpose: str,
                need: dict[str, float | None], scopes: list[Scope], basis: str = "history",
                base: dict[str, float] | None = None) -> tuple[Reservation | None, Blocked | None]:
        """Atomik denetim + yazma. Aynı anahtarda açık ya da belirsiz rezervasyon varsa YENİDEN KULLANILIR
        (miktar = ikisinin büyüğü; ikinci rezervasyon açılmaz —). Dönüş: (rezervasyon, None) ya da (None, engel)."""
        now = time.time()
        with self._lock:
            expired = self._expire(now)
            prev = self.items.get(key)
            amount: dict[str, float | None] = {}
            for m in METRICS:
                a, b = _need(m, need.get(m)), (prev.amount.get(m) if prev else None)
                amount[m] = None if a is None and b is None else max(_f(a), _f(b))
            blocked = self._check(key, amount, scopes, basis)
            if blocked is not None:
                if expired:
                    self._bump()
                return None, blocked
            if prev is not None:
                prev.amount, prev.base = amount, dict(base or {})
                prev.consumed = {m: 0.0 for m in METRICS}
                prev.status, prev.since, prev.reused = "open", now, prev.reused + 1
                prev.basis = basis if basis == "history" else prev.basis
                res = prev
            else:
                res = Reservation(key, run_id, step_id, purpose, amount, dict(base or {}), basis=basis)
                self.items[key] = res
            self._bump()
            return res, None

    def extend(self, key: str, topup: dict[str, float | None], scopes: list[Scope]) -> tuple[Reservation | None,
                                                                                            Blocked | None]:
        """Uçuştaki çağrının yeni turu (araç turu, çıktı şeması düzeltme turu). Ayrılan tükendiyse `topup` kadar
        yeni dilim; tükenmediyse dilim eklenmez ama tavan yeniden doğrulanır (başka çağrıların aşımı)."""
        with self._lock:
            res = self.items.get(key)
            if res is None:
                return None, None
            if res.exhausted():
                amount: dict[str, float | None] = {}
                for m in METRICS:
                    a, t = res.amount.get(m), topup.get(m)
                    used_m = res.consumed.get(m, 0.0)
                    if a is not None and _f(a) > used_m:
                        # yalnız TÜKENEN metrik yeni dilim alır; başka bir metrik (ör. süre) tükendi diye
                        # jeton ayrımına bir tam dilim daha eklenmez (erken ve sahte "sığmıyor" kartı doğuruyordu)
                        amount[m] = a
                    else:
                        amount[m] = None if a is None and t is None else max(_f(a), used_m) + _f(t)
                remaining = {m: (None if amount[m] is None else max(0.0, _f(amount[m]) - res.consumed.get(m, 0.0)))
                             for m in METRICS}
                blocked = self._check(key, remaining, scopes, res.basis)
                if blocked is not None:
                    return None, blocked
                res.amount = amount
                self._bump()
                return res, None
            # tükenmedi: yeni dilim yok; "kullanılan + açık ≤ tavan" yeniden doğrulanır (yalnız gerçek aşım engeller)
            blocked = self._check(key, {m: res.remaining(m) for m in METRICS}, scopes, res.basis)
            return (None, blocked) if blocked is not None else (res, None)

    def consume(self, key: str, usage: dict[str, float]) -> None:
        """Çağrının şimdiye kadarki kullanımı (açılıştaki taban düşülür) → açık rezervasyon azalır."""
        with self._lock:
            res = self.items.get(key)
            if res is None:
                return
            for m in METRICS:
                res.consumed[m] = max(0.0, _f(usage.get(m)) - _f(res.base.get(m)))
            self._bump()

    def settle(self, key: str) -> Reservation | None:
        with self._lock:
            res = self.items.pop(key, None)
            if res is not None:
                self._bump()
            return res

    def mark_uncertain(self, key: str) -> Reservation | None:
        with self._lock:
            res = self.items.get(key)
            if res is not None:
                res.status, res.since = "uncertain", time.time()
                self._bump()
            return res

    def release(self, key: str) -> Reservation | None:
        return self.settle(key)

    def release_run(self, run_id: str) -> list[Reservation]:
        with self._lock:
            out = [r for r in self.items.values() if r.run_id == run_id]
            for r in out:
                self.items.pop(r.key, None)
            if out:
                self._bump()
            return out


def book_for(settings: Any) -> ReservationBook:
    """Aynı Settings nesnesi için tek defter (motor, paralel adımlar ve sistem çağrıları paylaşır)."""
    book = getattr(settings, "_reservation_book", None)
    if isinstance(book, ReservationBook):
        return book
    from studio.workflow.daily import ledger_for  # noqa: PLC0415
    led = ledger_for(settings)
    book = ReservationBook(on_change=led.set_reserved)
    try:
        settings._reservation_book = book  # type: ignore[attr-defined]
    except AttributeError:
        pass
    return book


def daily_scope(settings: Any) -> Scope:
    """Günlük tavan (karar 13): bugünkü harcama + TÜM açık rezervasyonlar (koşular ve sistem çağrıları)."""
    from studio.workflow.daily import ledger_for  # noqa: PLC0415
    led = ledger_for(settings)
    eff = led.effective(settings)

    def used() -> dict[str, float]:
        sp = led.spent()
        return {"cost_usd": _f(sp.get("cost_usd")), "tokens": _f(sp.get("tokens"))}

    return Scope("daily", {"cost_usd": eff.get("cost_usd"), "tokens": eff.get("tokens"), "minutes": None}, used,
                 lambda r: True)
