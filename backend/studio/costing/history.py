"""Bu bilgisayarın koşu geçmişi (CG-COST): bitmiş adımlardan süre ve jeton örnekleri.

Kaynak graf `Step` düğümleridir (motor her adımda `connection`, `model`, `type`, `duration_ms`, `tokens`, `usage`
yazar); ayrı bir kopya tutulmaz, böylece her biten adım kendiliğinden geçmişe girer (gerçekleşen → öngörü döngüsü).
Okuma 30 sn önbelleklidir; adım bitiş kancası önbelleği boşaltır.
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass
from typing import Any, Iterable

CACHE_S = 30.0
MAX_SAMPLES = 3000


@dataclass(frozen=True)
class Sample:
    connection: str
    model: str
    type: str
    minutes: float
    tokens_in: float
    tokens_out: float
    prompt_chars: int = 0
    run_id: str = ""
    # adımın kimliği (iş akışı + adım; ajan) — geçmiş önce aynı adımın örneklerinden okunur
    workflow: str = ""
    step_id: str = ""
    agent: str = ""
    # kısmi çıktıyla bitirilen ya da kaldığı yerden sürdürülen adım: örnek adımın TÜM harcamasıdır ama tam bir
    # işi anlatmayabilir → p90'dan dışlanır (başka örnek yoksa kullanılır)
    flagged: bool = False
    first_in: float = 0.0  # CLI adımının ilk tur girdisi (beynin sabit istem payı ölçümü)

    @property
    def tokens(self) -> float:
        return self.tokens_in + self.tokens_out


def percentile(values: Iterable[float], q: float) -> float | None:
    """Doğrusal aradeğerli yüzdelik (q 0..1); boş listede None."""
    xs = sorted(float(v) for v in values)
    if not xs:
        return None
    if len(xs) == 1:
        return xs[0]
    pos = (len(xs) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def sample_from_props(p: dict[str, Any]) -> Sample | None:
    """Biten (`done`) bir adım düğümünden örnek; süre ya da bağlantı yoksa None."""
    if p.get("status") != "done":
        return None
    conn = str(p.get("connection") or "").strip()
    if not conn:
        return None
    usage = p.get("usage") if isinstance(p.get("usage"), dict) else {}
    minutes = None
    if isinstance(p.get("duration_ms"), (int, float)):
        minutes = float(p["duration_ms"]) / 60000.0
    elif isinstance(usage.get("minutes"), (int, float)):
        minutes = float(usage["minutes"])
    if minutes is None or minutes < 0:
        return None
    minutes = max(minutes, 0.5 / 60.0)  # zaman damgaları saniye çözünürlüğünde: 0 ms = 1 sn'den kısa
    tok = p.get("tokens") if isinstance(p.get("tokens"), dict) else {}
    hist = p.get("history") if isinstance(p.get("history"), dict) else {}

    def num(v: Any) -> float:
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0

    tin, tout = num(tok.get("input")), num(tok.get("output"))
    total = num(tok.get("total"))
    if not tin and not tout and total:
        tin, tout = total * 0.8, total * 0.2  # yalnız toplam verildiyse kaba bölüş
    elif total > tin + tout:
        # PROC2-FIX P1: bazı bağlayıcılar (Hermes) önbellekten okunan girdiyi yalnız `total`a koyar (A2 Kaynak:
        # giriş 71.727 + çıkış 4.282, toplam 436.841). Adım tavanı ve kart `total`ı saydığı için örnek de onu sayar:
        # fark girişe eklenir (budget.BRAIN_STEP_DEFAULTS'taki tek jeton tanımı).
        tin = total - tout
    flagged = bool(hist.get("partial") or hist.get("continued"))
    full = num(hist.get("tokens"))
    if flagged and full > tin + tout:
        # kısmi/devam bitişi adımın TÜM harcamasıyla kaydedilir (son denemeyle değil); giriş/çıkış oranı aynı
        scale = full / (tin + tout) if tin + tout > 0 else 0.0
        tin, tout = (tin * scale, tout * scale) if scale else (full * 0.8, full * 0.2)
    return Sample(conn, str(p.get("model") or "").strip().lower(), str(p.get("type") or "agent"), minutes,
                  tin, tout, len(str(p.get("prompt") or "")), str(p.get("run_id") or ""),
                  str(p.get("workflow") or ""), str(p.get("step_id") or ""), str(p.get("agent") or ""), flagged,
                  num(p.get("first_in")))


class History:
    """Graf deposu üzerinden önbellekli örnek listesi."""

    def __init__(self, store: Any = None, samples: list[Sample] | None = None):
        self.store = store
        self._fixed = samples
        self._cache: list[Sample] | None = None
        self._at = 0.0
        self._lock = threading.Lock()

    def invalidate(self, *_a: Any) -> None:
        with self._lock:
            self._cache = None

    def samples(self) -> list[Sample]:
        if self._fixed is not None:
            return self._fixed
        with self._lock:
            if self._cache is not None and time.monotonic() - self._at < CACHE_S:
                return self._cache
        out: list[Sample] = []
        if self.store is not None:
            try:
                nodes = self.store.nodes("Step", limit=MAX_SAMPLES, props={"status": "done"})
            except TypeError:  # eski depo imzası
                nodes = self.store.nodes("Step", limit=MAX_SAMPLES)
            for n in nodes:
                s = sample_from_props(n.get("props") or {})
                if s is not None:
                    out.append(s)
        with self._lock:
            self._cache, self._at = out, time.monotonic()
        return out

    def match(self, connection: str, model: str | None, type_: str, *, workflow: str | None = None,
              step: str | None = None, agent: str | None = None) -> tuple[list[Sample], str]:
        """En özel düzeyden geriye. önce adımın KENDİ kimliği — (bağlantı, iş akışı + adım) → (bağlantı, iş
        akışı + ajan, tür) — sonra (bağlantı, model, tür) → (bağlantı, model) → (bağlantı). Bağlantı düzeyi farklı
        büyüklükteki işleri karıştırır; aynı adımın geçmişi varsa o kullanılır. En az 3 örnekli ilk düzey kazanır;
        hiçbiri 3'e ulaşmazsa en özel boş olmayan düzey (az örnek → düşük güven) döner. işaretli (kısmi/devam)
        örnekler düzeyde başka örnek varsa dışlanır."""
        all_ = self.samples()
        m = str(model or "").strip().lower()
        same = [s for s in all_ if s.connection == connection]
        levels = [
            ("step", [s for s in same if s.workflow == workflow and s.step_id == step] if workflow and step else []),
            # ajan + tarif (aynı iş akışında aynı ajan): iş akışı bilinmiyorsa kimlik yok, bağlantı düzeylerine düşülür
            ("agent", [s for s in same if s.workflow == workflow and s.agent == agent and s.type == type_]
             if workflow and agent else []),
            ("model_type", [s for s in same if s.model == m and s.type == type_] if m else []),
            ("model", [s for s in same if s.model == m] if m else []),
            ("connection", same),
        ]
        levels = [(name, clean(xs)) for name, xs in levels]
        for name, xs in levels:
            if len(xs) >= 3:
                return xs, name
        for name, xs in levels:
            if xs:
                return xs, name
        return [], "none"


def clean(xs: list[Sample]) -> list[Sample]:
    """işaretli (kısmi çıktıyla bitirilen / kaldığı yerden sürdürülen) örnekler, başka örnek varsa dışlanır."""
    full = [s for s in xs if not s.flagged]
    return full if full else xs
