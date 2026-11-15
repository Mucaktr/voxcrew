"""Tarafsız saat: studio genelindeki "gün" sınırı (AUDIT 2026-10-19 P1-c).

"Gün" yerel saatle 04:00'te başlar; gece yarısı çalışmaları önceki güne sayılır. Çekirdek iş akışı (günlük bütçe
tavanı, `workflow/daily.py`) ve oyun modülleri (`game/*`) bu sınırı buradan alır. Böylece çekirdek motor oyun
modülüne bağımlı olmaz. Saf fonksiyonlar; durum tutmaz, içe aktardığı başka studio modülü yoktur.
"""

from __future__ import annotations

from datetime import datetime, timedelta

DAY_START_HOUR = 4        # "gün" yerel saatle 04:00'te başlar (gece yarısı çalışmaları önceki güne sayılır)


def shifted(ts: float) -> datetime:
    """Yerel saat − gün başlangıcı: tarihi doğrudan "studio günü"nü verir."""
    return datetime.fromtimestamp(ts) - timedelta(hours=DAY_START_HOUR)


def day_of(ts: float) -> str:
    """'YYYY-AA-GG' (yerel, 04:00 sınırlı)."""
    return shifted(ts).date().isoformat()


def week_of(ts: float) -> str:
    """ISO hafta 'YYYY-Www' (yerel, 04:00 sınırlı)."""
    y, w, _ = shifted(ts).date().isocalendar()
    return f"{y}-W{w:02d}"


def next_day_start(ts: float) -> float:
    """Bir sonraki gün başlangıcının (yerel 04:00) zaman damgası."""
    d = shifted(ts).date() + timedelta(days=1)
    return datetime(d.year, d.month, d.day, DAY_START_HOUR).timestamp()
