"""Adım politikası: yeniden deneme / geri çekilme / zaman aşımı / hata akışı + devre kesici.

`policy: {retries 0–5, backoff exp|fixed, base_s, timeout_min, on_fail fail|skip|continue|ask}` adım düzeyinde;
akış düzeyinde `defaults.policy`. Motor yalnızca **geçici** (`transient`) hatalarda yeniden dener: bağlayıcı
`CEvent error` verisinde `transient: True` işaretler; işaret yoksa `transient_hint` ileti kalıplarına bakar.
Devre kesici: bağlantı türü başına ardışık hata sayacı; eşiğe ulaşınca `degraded` ve adım yeniden denenmez,
`on_fail` politikasına düşer (ask: "bekle / başka beyinle dene / atla" kartı).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from studio.connectors.base import transient_hint

BACKOFFS = ("exp", "fixed")
ON_FAIL = ("fail", "skip", "continue", "ask")
MAX_RETRIES = 5
MAX_BACKOFF_S = 300.0
DEFAULT_BREAKER_FAILURES = 3
ASK_CHOICES = ("retry", "skip", "route")  # on_fail=ask kartının yanıtları (not: "retry" | "skip" | "route:<conn>[:<model>]")


class PolicyError(ValueError):
    pass


@dataclass
class StepPolicy:
    retries: int = 1
    backoff: str = "exp"
    base_s: float = 10.0
    timeout_min: float | None = None
    on_fail: str = "fail"

    @classmethod
    def parse(cls, raw: Any, *, base: "StepPolicy | None" = None, where: str = "") -> "StepPolicy":
        out = StepPolicy(**asdict(base)) if base else StepPolicy()
        if raw is None:
            return out
        pre = f"{where}: " if where else ""
        if not isinstance(raw, dict):
            raise PolicyError(f"{pre}policy bir sözlük olmalı")
        if "retries" in raw and raw["retries"] is not None:
            v = raw["retries"]
            if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v or not 0 <= int(v) <= MAX_RETRIES:
                raise PolicyError(f"{pre}policy.retries 0–{MAX_RETRIES} arası tam sayı olmalı")
            out.retries = int(v)
        if raw.get("backoff") is not None:
            if raw["backoff"] not in BACKOFFS:
                raise PolicyError(f"{pre}policy.backoff exp ya da fixed olmalı")
            out.backoff = str(raw["backoff"])
        if "base_s" in raw and raw["base_s"] is not None:
            try:
                b = float(raw["base_s"])
            except (TypeError, ValueError):
                raise PolicyError(f"{pre}policy.base_s sayı olmalı") from None
            if isinstance(raw["base_s"], bool) or b < 0 or b > MAX_BACKOFF_S:
                raise PolicyError(f"{pre}policy.base_s 0–{int(MAX_BACKOFF_S)} sn arası olmalı")
            out.base_s = b
        if "timeout_min" in raw:
            v = raw["timeout_min"]
            if v is None or v == "":
                out.timeout_min = None
            else:
                try:
                    t = float(v)
                except (TypeError, ValueError):
                    raise PolicyError(f"{pre}policy.timeout_min pozitif sayı olmalı") from None
                if isinstance(v, bool) or t <= 0:
                    raise PolicyError(f"{pre}policy.timeout_min pozitif sayı olmalı")
                out.timeout_min = t
        if raw.get("on_fail") is not None:
            if raw["on_fail"] not in ON_FAIL:
                raise PolicyError(f"{pre}policy.on_fail fail, skip, continue ya da ask olmalı")
            out.on_fail = str(raw["on_fail"])
        return out

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def delay_s(self, attempt: int) -> float:
        """`attempt` numaralı (1'den başlayan, başarısız olan) denemeden sonra beklenecek süre."""
        if self.backoff == "fixed":
            return min(self.base_s, MAX_BACKOFF_S)
        return min(self.base_s * (2 ** max(0, attempt - 1)), MAX_BACKOFF_S)

    def timeout_s(self, default_min: float) -> int:
        mins = self.timeout_min if self.timeout_min is not None else default_min
        return max(1, int(round(float(mins) * 60)))


def is_transient(errors: list[dict[str, Any]]) -> bool:
    """Bağlayıcı hata olayları: açık `transient` işareti; yoksa ileti kalıbı. Tümü geçiciyse yeniden denenebilir."""
    if not errors:
        return False
    for e in errors:
        flag = e.get("transient")
        if flag is None:
            flag = transient_hint(str(e.get("message") or ""))
        if not flag:
            return False
    return True


def parse_ask_choice(note: str | None) -> tuple[str, dict[str, Any]]:
    """on_fail=ask kararı: not boşsa "retry"; "skip"; "route:<connection>[:<model>]" → ("route", {...})."""
    text = str(note or "").strip()
    low = text.lower()
    if not text or low.startswith("retry") or low.startswith("bekle") or low.startswith("yeniden"):
        return "retry", {}
    if low.startswith("skip") or low.startswith("atla"):
        return "skip", {}
    if low.startswith("route") or low.startswith("rota") or low.startswith("beyin"):
        parts = text.split(":", 2)
        return "route", {"connection": parts[1].strip() if len(parts) > 1 and parts[1].strip() else None,
                         "model": parts[2].strip() if len(parts) > 2 and parts[2].strip() else None}
    return "retry", {}


class CircuitBreaker:
    """Bağlantı türü başına ardışık hata sayacı. `record` → (eşiğe şimdi ulaşıldı mı)."""

    def __init__(self, threshold: int = DEFAULT_BREAKER_FAILURES):
        self.threshold = max(1, int(threshold))
        self.failures: dict[str, int] = {}
        self.open: set[str] = set()

    def record(self, kind: str, ok: bool) -> bool:
        if ok:
            self.failures[kind] = 0
            self.open.discard(kind)
            return False
        n = self.failures.get(kind, 0) + 1
        self.failures[kind] = n
        if n >= self.threshold and kind not in self.open:
            self.open.add(kind)
            return True
        return False

    def degraded(self, kind: str) -> bool:
        return kind in self.open

    def reset(self, kind: str | None = None) -> None:
        if kind is None:
            self.failures.clear()
            self.open.clear()
        else:
            self.failures.pop(kind, None)
            self.open.discard(kind)

    def snapshot(self) -> dict[str, Any]:
        return {"threshold": self.threshold, "failures": dict(self.failures), "degraded": sorted(self.open)}
