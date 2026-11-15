"""5 alanlı cron ifadesi (dakika saat ay-günü ay hafta-günü) — bağımlılıksız, yerel duvar saati.

Desteklenen: `*`, `*/n`, `a`, `a-b`, `a-b/n`, `a/n` (a'dan sona), virgüllü listeler; ay ve gün adları (JAN…DEC,
SUN…SAT); hafta günü 0 ya da 7 = pazar. Ay-günü ve hafta-günü ikisi de kısıtlıysa Vixie cron kuralı geçerlidir: ikisinden
biri uyarsa gün uyar.

`next_after(dt)` saf (naive) yerel duvar saatinde çalışır: DST geçişinden bağımsızdır ("her gün 09:00" geçişten sonra
da 09:00'dır). Yerel saat dilimine bağlamak çağıranın işidir (`datetime.astimezone()`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

MONTHS = {n: i + 1 for i, n in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct",
                                         "nov", "dec"))}
DAYS = {n: i for i, n in enumerate(("sun", "mon", "tue", "wed", "thu", "fri", "sat"))}
# (alan adı — iletilerde iki dilde aynı kalan teknik ad, en küçük, en büyük, ad tablosu)
FIELDS: tuple[tuple[str, int, int, dict[str, int]], ...] = (
    ("minute", 0, 59, {}), ("hour", 0, 23, {}), ("day-of-month", 1, 31, {}), ("month", 1, 12, MONTHS),
    ("day-of-week", 0, 7, DAYS))
SEARCH_YEARS = 6  # 29 Şubat gibi seyrek ifadeler için yeterli; uymayan ifade (31 Şubat) hata verir


class CronError(ValueError):
    pass


def _value(token: str, lo: int, hi: int, names: dict[str, int], field: str) -> int:
    t = token.strip().lower()
    if t in names:
        return names[t]
    if not t.isdigit():
        raise CronError(f"Cron {field} alanında geçersiz değer: {token}")
    v = int(t)
    if v < lo or v > hi:
        raise CronError(f"Cron {field} alanı {lo}–{hi} aralığında olmalı: {token}")
    return v


def _field(text: str, lo: int, hi: int, names: dict[str, int], field: str) -> tuple[frozenset[int], bool]:
    """Alanı değer kümesine çevirir. İkinci değer: alan kısıtsız mı (`*` ya da `*/1`)."""
    out: set[int] = set()
    star = False
    for part in text.split(","):
        part = part.strip()
        if not part:
            raise CronError(f"Cron {field} alanında boş öğe var")
        base, _, step_s = part.partition("/")
        step = 1
        if step_s:
            if not step_s.isdigit() or int(step_s) < 1:
                raise CronError(f"Cron {field} alanında geçersiz adım: {part}")
            step = int(step_s)
        if base == "*":
            start, end = lo, hi
            star = star or step == 1
        elif "-" in base:
            a, _, b = base.partition("-")
            start, end = _value(a, lo, hi, names, field), _value(b, lo, hi, names, field)
            if start > end:
                raise CronError(f"Cron {field} alanında ters aralık: {part}")
        else:
            start = _value(base, lo, hi, names, field)
            end = hi if step_s else start
        out.update(range(start, end + 1, step))
    return frozenset(out), star


@dataclass(frozen=True)
class CronExpr:
    text: str
    minutes: frozenset[int]
    hours: frozenset[int]
    days: frozenset[int]
    months: frozenset[int]
    weekdays: frozenset[int]   # 0 = pazar … 6 = cumartesi
    dom_star: bool
    dow_star: bool

    @classmethod
    def parse(cls, text: str) -> "CronExpr":
        if not isinstance(text, str) or not text.strip():
            raise CronError("Cron ifadesi boş")
        parts = text.split()
        if len(parts) != 5:
            raise CronError("Cron ifadesi 5 alan olmalı: dakika saat ay-günü ay hafta-günü")
        sets = [_field(p, lo, hi, names, name) for p, (name, lo, hi, names) in zip(parts, FIELDS)]
        weekdays = frozenset(0 if d == 7 else d for d in sets[4][0])
        expr = cls(" ".join(parts), sets[0][0], sets[1][0], sets[2][0], sets[3][0], weekdays, sets[2][1], sets[4][1])
        if expr.next_after(datetime(2000, 1, 1)) is None:
            raise CronError(f"Cron ifadesi hiçbir zaman çalışmaz: {text}")
        return expr

    def _day_ok(self, d: datetime) -> bool:
        dom = d.day in self.days
        dow = ((d.weekday() + 1) % 7) in self.weekdays  # Python: pazartesi=0 → cron: pazar=0
        if self.dom_star and self.dow_star:
            return True
        if self.dom_star:
            return dow
        if self.dow_star:
            return dom
        return dom or dow

    def matches(self, d: datetime) -> bool:
        return (d.minute in self.minutes and d.hour in self.hours and d.month in self.months and self._day_ok(d))

    def next_after(self, after: datetime) -> datetime | None:
        """`after`dan kesinlikle sonraki ilk eşleşen dakika (saf yerel saat; tz bilgisi korunmaz)."""
        t = after.replace(tzinfo=None, second=0, microsecond=0) + timedelta(minutes=1)
        limit = t.year + SEARCH_YEARS
        while t.year <= limit:
            if t.month not in self.months:
                t = (t.replace(day=1, hour=0, minute=0) + timedelta(days=32)).replace(day=1)
                continue
            if not self._day_ok(t):
                t = t.replace(hour=0, minute=0) + timedelta(days=1)
                continue
            if t.hour not in self.hours:
                t = t.replace(minute=0) + timedelta(hours=1)
                continue
            if t.minute not in self.minutes:
                later = [m for m in self.minutes if m > t.minute]
                t = t.replace(minute=min(later)) if later else t.replace(minute=0) + timedelta(hours=1)
                continue
            return t
        return None

