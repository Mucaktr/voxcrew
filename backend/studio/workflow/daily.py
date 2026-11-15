"""Günlük toplam bütçe tavanı (karar 13, 2026-10-19).

Ayar `limits.daily_budget = {cost_usd, tokens}`; ikisi de boşsa kapalı. "Gün" oyunla aynı sınırda başlar: yerel
saatle 04:00 (`studio.clock.DAY_START_HOUR`; gece yarısı çalışmaları önceki güne sayılır). Çekirdek motor oyun
modülünü içe aktarmaz.

Sayım: bugünkü TÜM koşuların harcaması — dolar yalnızca API anahtarlı / ücretli API beyinlerinden gelir (yerel ve
abonelikli adımlar `cost_usd = 0` yazar), jeton ise abonelikli Claude Code / Codex dahil her beyinden. Koşu başına son
görülen toplam saklanır; artış (delta) bugüne eklenir. Böylece yeniden deneme ya da devam aynı işi iki kez saymaz,
ama gerçekten yeniden harcanan jeton (yeni deneme) sayılır. Defter veri dizininde `daily_spend.json` (yalnız sayılar).

Tavan aşılınca motor koşuyu sessizce öldürmez: "günlük bütçe doldu" kartı açar (bugün için yükselt / durdur). Tavan
dolmuşken yeni koşu 409 ile reddedilir (`DailyBudgetReached`). Bugün için yükseltme yalnız bugünü etkiler (defterde
`raised`), ayarı değiştirmez.
"""

from __future__ import annotations

import json
import logging
import math
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from studio import clock

log = logging.getLogger("studio.workflow.daily")

FILE = "daily_spend.json"
METRICS = ("cost_usd", "tokens")
KEEP_RUN_DAYS = 3        # bu kadar gün görülmeyen koşu kaydı defterden düşer
WARN_RATIO = 0.8


def day_key(ts: float | None = None) -> str:
    return clock.day_of(time.time() if ts is None else ts)   # tek gün sınırı kaynağı (04:00)


def next_reset(ts: float | None = None) -> float:
    return clock.next_day_start(time.time() if ts is None else ts)


def _num(v: Any, key: str) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        raise ValueError(f"Günlük bütçe alanı sayı olmalı: {key}")
    try:
        out = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"Günlük bütçe alanı sayı olmalı: {key}") from None
    if not math.isfinite(out):  # "nan"/"inf" tavan değildir (sınırsız sayılıyordu)
        raise ValueError(f"Günlük bütçe alanı sayı olmalı: {key}")
    if out < 0:
        raise ValueError(f"Günlük bütçe alanı negatif olamaz: {key}")
    if out > 1e12:
        raise ValueError(f"Günlük bütçe alanı çok büyük: {key}")
    return out


def parse_cap(raw: Any) -> dict[str, float | None]:
    """`{cost_usd, tokens}` → doğrulanmış sözlük (None = o metrik sınırsız). Geçersizse ValueError."""
    if raw is None:
        return {k: None for k in METRICS}
    if not isinstance(raw, dict):
        raise ValueError("Günlük bütçe bir sözlük olmalı (cost_usd, tokens)")
    unknown = set(raw) - set(METRICS)
    if unknown:
        raise ValueError("Günlük bütçede yalnızca cost_usd ve tokens olabilir")
    return {k: _num(raw.get(k), k) for k in METRICS}


def settings_cap(settings: Any) -> dict[str, float | None]:
    """Kayıtlı tavan. elle düzenlenmiş/eski bozuk değer (NaN, inf, negatif, metin) SINIRSIZ sayılmaz; o metrik
    0'a kilitlenir (güvenli taraf: harcama durur, kullanıcı tavanı arayüzden düzeltir)."""
    try:
        raw = settings.get("limits.daily_budget", None) if settings is not None else None
    except Exception:  # noqa: BLE001
        raw = None
    if not isinstance(raw, dict):
        return {k: None for k in METRICS}
    out: dict[str, float | None] = {}
    for k in METRICS:
        try:
            out[k] = _num(raw.get(k), k)
        except ValueError:
            log.warning("günlük bütçe tavanı geçersiz (%s); güvenli taraf: 0", k)
            out[k] = 0.0
    return out


# sıfır (ya da çok küçük) tavanda "+%50" bir şey değiştirmez; yükseltme en az bu kadar yer açar.
MIN_RAISE: dict[str, float] = {"cost_usd": 0.05, "tokens": 1000.0}
_LABELS = {"tr": {"cost_usd": "dolar", "tokens": "token"}, "en": {"cost_usd": "dollars", "tokens": "tokens"}}


def metric_label(metric: str, lang: str = "tr") -> str:
    """kullanıcıya dönük metrik adı (ham anahtar `tokens` iletiye girmez)."""
    return _LABELS.get(lang, _LABELS["tr"]).get(metric, metric)


def fmt_amount(metric: str, value: float, lang: str = "tr") -> str:
    """yerel sayı biçimi — TR'de binlik ayırıcı nokta, ondalık virgül (`2.000`, `$1,50`)."""
    if metric == "cost_usd":
        text = f"{float(value):,.2f}"
        prefix = "$"
    else:
        text = f"{int(round(float(value))):,}"
        prefix = ""
    if lang != "en":
        text = text.translate(str.maketrans(",.", ".,"))
    return prefix + text


def propose_raise(eff: dict[str, float | None], spent: dict[str, Any],
                  need: dict[str, float] | None = None) -> dict[str, float | None]:
    """Bugün için yükseltme önerisi: etkin tavanın +%50'si; en az `MIN_RAISE`; sıradaki işin tahmini
    (`need`) biliniyorsa en az `harcanan + tahmin`; her durumda harcananın üstünde (yükseltme kartı kapatır)."""
    out: dict[str, float | None] = {}
    for k in METRICS:
        if eff.get(k) is None:
            out[k] = None
            continue
        e = float(eff[k])  # type: ignore[arg-type]
        used = float(spent.get(k) or 0)
        n = float((need or {}).get(k) or 0)
        target = max(e * 1.5, MIN_RAISE[k])
        if n > 0:
            target = max(target, used + n)
        if target <= used:
            target = used + max(e * 0.5, MIN_RAISE[k])
        out[k] = round(target, 6)
    return out


class DailyBudgetReached(HTTPException):
    """Tavan dolmuşken yeni koşu → 409 (arayüz iletiyi olduğu gibi gösterir)."""

    def __init__(self, metric: str, used: float, limit: float):
        label = metric_label(metric)
        amounts = f"{fmt_amount(metric, used)} / {fmt_amount(metric, limit)}"
        detail = (f"Günlük bütçe doldu ({label}: {amounts}). Yeni koşu başlatılamaz; tavanı bugün için Koşular "
                  "sayfasından yükseltebilir ya da gün dönümünü (04:00) bekleyebilirsin.")
        super().__init__(409, detail)
        self.metric, self.used, self.limit = metric, used, limit


class DailyLedger:
    """Bugünün harcaması + koşu başına son görülen toplamlar (yalnız sayılar; iş parçacığı güvenli)."""

    def __init__(self, path: Path | None):
        self.path = path
        self._lock = threading.Lock()
        self.state: dict[str, Any] = {"day": day_key(), "cost_usd": 0.0, "tokens": 0.0, "runs": {}, "raised": None}
        # uçuştaki çağrıların açık rezervasyon toplamı (`workflow.reserve` defteri yazar; bellek içi, kalıcı değil)
        self.reserved: dict[str, float] = {"cost_usd": 0.0, "tokens": 0.0}
        self._load()

    # ------------------------------------------------------------ kalıcılık
    def _load(self) -> None:
        if not self.path or not self.path.is_file():
            return
        try:
            data = json.loads(self.path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if isinstance(data, dict):
            runs = data.get("runs") if isinstance(data.get("runs"), dict) else {}
            self.state = {"day": str(data.get("day") or day_key()),
                          "cost_usd": float(data.get("cost_usd") or 0), "tokens": float(data.get("tokens") or 0),
                          "runs": {str(k): v for k, v in runs.items() if isinstance(v, dict)},
                          "raised": data.get("raised") if isinstance(data.get("raised"), dict) else None}

    def _save(self) -> None:
        if not self.path:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.state, ensure_ascii=False), "utf-8")
            tmp.replace(self.path)
        except OSError as exc:
            log.warning("günlük bütçe defteri yazılamadı: %s", exc)

    def _roll(self, now: float) -> None:
        today = day_key(now)
        if self.state.get("day") == today:
            return
        # gün döndü: toplamlar sıfırlanır; koşu başına son toplamlar kalır (uzun koşu ertesi güne yalnız artışı taşır)
        self.state["day"], self.state["cost_usd"], self.state["tokens"] = today, 0.0, 0.0
        raised = self.state.get("raised")
        if isinstance(raised, dict) and raised.get("day") != today:
            self.state["raised"] = None
        cutoff = now - KEEP_RUN_DAYS * 86400
        self.state["runs"] = {k: v for k, v in self.state["runs"].items() if float(v.get("seen") or 0) >= cutoff}

    def set_reserved(self, totals: dict[str, float]) -> None:
        """rezervasyon defterinden açık rezervasyon toplamı (yalnız görünüm; denetim `reserve.py`de)."""
        self.reserved = {k: round(float(totals.get(k) or 0), 6) for k in METRICS}

    # ------------------------------------------------------------ sayım
    def observe(self, run_id: str, cost_usd: float | None, tokens: float | None, now: float | None = None) -> None:
        """Koşunun güncel toplamı → artış bugüne eklenir (azalma, yeniden denemede adım sıfırlanınca olur: yok sayılır)."""
        now = time.time() if now is None else now
        cost, tok = float(cost_usd or 0), float(tokens or 0)
        with self._lock:
            self._roll(now)
            prev = self.state["runs"].get(run_id) or {"cost_usd": 0.0, "tokens": 0.0}
            d_cost = cost - float(prev.get("cost_usd") or 0)
            d_tok = tok - float(prev.get("tokens") or 0)
            changed = d_cost != 0 or d_tok != 0 or run_id not in self.state["runs"]
            if d_cost > 0:
                self.state["cost_usd"] = round(self.state["cost_usd"] + d_cost, 6)
            if d_tok > 0:
                self.state["tokens"] += d_tok
            self.state["runs"][run_id] = {"cost_usd": cost, "tokens": tok, "seen": now}
            if changed:
                self._save()

    def add(self, key: str, cost_usd: float | None, tokens: float | None, now: float | None = None) -> None:
        """Koşu dışı harcama (sistem çağrısı, `system_calls.account`): artış doğrudan bugüne eklenir; `key`
        (`sys:<tür>`) altında birikimli toplam tutulur (iz için)."""
        now = time.time() if now is None else now
        cost, tok = max(0.0, float(cost_usd or 0)), max(0.0, float(tokens or 0))
        with self._lock:
            self._roll(now)
            prev = self.state["runs"].get(key) or {"cost_usd": 0.0, "tokens": 0.0}
            self.state["cost_usd"] = round(self.state["cost_usd"] + cost, 6)
            self.state["tokens"] += tok
            self.state["runs"][key] = {"cost_usd": float(prev.get("cost_usd") or 0) + cost,
                                       "tokens": float(prev.get("tokens") or 0) + tok, "seen": now}
            self._save()

    def baseline(self, run_id: str, cost_usd: float | None, tokens: float | None, now: float | None = None) -> None:
        """Koşunun var olan toplamını bugüne eklemeden kaydeder (çatala kopyalanan kullanım yeni harcama değildir)."""
        now = time.time() if now is None else now
        with self._lock:
            self._roll(now)
            self.state["runs"][run_id] = {"cost_usd": float(cost_usd or 0), "tokens": float(tokens or 0), "seen": now}
            self._save()

    def spent(self, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        with self._lock:
            self._roll(now)
            return {"day": self.state["day"], "cost_usd": round(self.state["cost_usd"], 6),
                    "tokens": int(self.state["tokens"])}

    def raised(self, now: float | None = None) -> dict[str, float | None] | None:
        now = time.time() if now is None else now
        with self._lock:
            self._roll(now)
            r = self.state.get("raised")
            return {k: r.get(k) for k in METRICS} if isinstance(r, dict) else None

    def raise_today(self, cap: dict[str, float | None], now: float | None = None) -> None:
        now = time.time() if now is None else now
        with self._lock:
            self._roll(now)
            self.state["raised"] = {"day": self.state["day"], **{k: cap.get(k) for k in METRICS}}
            self._save()

    # ------------------------------------------------------------ tavan
    def effective(self, settings: Any, now: float | None = None) -> dict[str, float | None]:
        """Etkin tavan: ayar; bugün için yükseltildiyse metrik başına büyük olan (yükseltme ayarı düşüremez)."""
        cap = settings_cap(settings)
        r = self.raised(now)
        if r:
            for k in METRICS:
                if cap[k] is not None and r.get(k) is not None:
                    cap[k] = max(float(cap[k]), float(r[k]))  # type: ignore[arg-type]
        return cap

    def breach(self, settings: Any, now: float | None = None, *, inclusive: bool = False) -> tuple[str, float, float] | None:
        """İlk aşılan metrik (used > limit; `inclusive` → used ≥ limit, yeni koşu kapısı). Kapalıysa None."""
        cap = self.effective(settings, now)
        spent = self.spent(now)
        for k in METRICS:
            limit = cap.get(k)
            if limit is None:
                continue
            used = float(spent[k])
            if used > limit or (inclusive and used >= limit):
                return k, used, float(limit)
        return None

    def warnings(self, settings: Any, now: float | None = None) -> list[tuple[str, float, float]]:
        cap = self.effective(settings, now)
        spent = self.spent(now)
        out = []
        for k in METRICS:
            limit = cap.get(k)
            if limit and float(spent[k]) >= limit * WARN_RATIO:
                out.append((k, float(spent[k]), float(limit)))
        return out

    def status(self, settings: Any, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        cap = settings_cap(settings)
        eff = self.effective(settings, now)
        spent = self.spent(now)
        on = any(cap[k] is not None for k in METRICS)
        b = self.breach(settings, now, inclusive=True) if on else None
        return {"enabled": on, "day": spent["day"], "cap": cap, "effective": eff, "raised": self.raised(now),
                "spent": {"cost_usd": spent["cost_usd"], "tokens": spent["tokens"]},
                "reserved": {"cost_usd": self.reserved.get("cost_usd", 0.0), "tokens": int(self.reserved.get("tokens", 0))},
                "reached": b is not None, "metric": b[0] if b else None,
                "resets_at": next_reset(now)}


def ledger_for(settings: Any) -> DailyLedger:
    """Aynı Settings nesnesi için tek defter (motor ve API paylaşır)."""
    led = getattr(settings, "_daily_ledger", None)
    if isinstance(led, DailyLedger):
        return led
    path = None
    try:
        if getattr(settings, "path", None):
            path = Path(settings.path).parent / FILE
    except (TypeError, ValueError):
        path = None
    led = DailyLedger(path)
    try:
        settings._daily_ledger = led  # type: ignore[attr-defined]
    except AttributeError:
        pass
    return led
