"""Açılım yolu kartları ( yönetici hattı, §6.5 "ilerlemeli gösterim, kilit değil").

Yönetici seviyesi yükseldikçe bir sonraki özellik ÖNE ÇIKARILIR. Hiçbir şey kilitlenmez: her kart `usable: True`
taşır ve özelliğin sayfasına gider; seviye yalnız bir öğrenme haritasıdır (gamification A.1-8). Paket sınırları
 yeni bir kilit olarak eklenmez; yalnız bilgi olarak gösterilir (`plan_limit`: ör. Free'de 1 zamanlama).

Kartın "denendi" durumu gerçek veriden gelir (kayıtlı akış koşusu, hedef, zamanlama, tetikleyici, teslim kaydı,
kalite raporu, yürüme ziyareti, özel dünya). Böylece kullanıcı bir özelliği seviyeden önce denerse kart "denendi"
olur ve yol bir sonrakine geçer.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from studio.api import Studio


@dataclass(frozen=True)
class PathCard:
    id: str
    level: int          # yönetici seviyesi: bu seviyede öne çıkar (kilit değil)
    to: str             # arayüz rotası
    plan_key: str | None = None   # sayım sınırı anahtarı (yalnız bilgi)


# Tempo: tablosuna göre (ilk oturum Sv 2; 1. gün Sv 3; 2–3. gün zamanlayıcı; 1. hafta teslim/kalite …)
PATH: tuple[PathCard, ...] = (
    PathCard("workflows", 2, "/akislar", "workflows"),
    PathCard("goals", 3, "/hedefler"),
    PathCard("scheduler", 4, "/zamanlayici", "schedules"),
    PathCard("triggers", 5, "/zamanlayici"),
    PathCard("delivery", 6, "/ciktilar"),
    PathCard("quality", 7, "/ciktilar"),
    PathCard("walk", 8, "/"),
    PathCard("builder", 10, "/dunya-yapici", "worlds"),
)


def _count(studio: "Studio", type_name: str, props: dict[str, Any] | None = None) -> int:
    try:
        return int(studio.store.count(type_name, props=props))
    except Exception:  # noqa: BLE001 - sayım hatası kartı "denenmedi" bırakır
        return 0


def _schedules(studio: "Studio") -> tuple[bool, bool]:
    from studio.schedule.triggers import EVENT_KINDS  # noqa: PLC0415

    sched = trig = False
    for n in studio.store.nodes("Schedule", limit=2000):
        if n["props"].get("kind") in EVENT_KINDS:
            trig = True
        else:
            sched = True
    return sched, trig


def _delivered(studio: "Studio") -> bool:
    from studio.delivery.records import RECORDS_FILE  # noqa: PLC0415

    try:
        data = json.loads((Path(studio.changes.data_dir) / RECORDS_FILE).read_text("utf-8"))
    except (OSError, ValueError, AttributeError):
        return False
    return bool((data or {}).get("records"))


def _walked(studio: "Studio") -> bool:
    try:
        from studio.game.api import get_service  # noqa: PLC0415

        return bool(get_service(studio).db.scalar("SELECT COUNT(*) FROM walk_visits"))
    except Exception:  # noqa: BLE001 - tablo yoksa yürüme hiç kullanılmadı
        return False


def _worlds(studio: "Studio") -> bool:
    try:
        from studio.worlds.service import get_store  # noqa: PLC0415

        return get_store(studio).count() > 0
    except Exception:  # noqa: BLE001
        return False


def tried(studio: "Studio") -> dict[str, bool]:
    sched, trig = _schedules(studio)
    return {
        "workflows": _count(studio, "Run", {"kind": "workflow"}) > 0,
        "goals": _count(studio, "Goal") > 0,
        "scheduler": sched,
        "triggers": trig,
        "delivery": _delivered(studio),
        "quality": _count(studio, "QualityReport") > 0,
        "walk": _walked(studio),
        "builder": _worlds(studio),
    }


def path(studio: "Studio") -> dict[str, Any]:
    from studio.game.api import get_service  # noqa: PLC0415

    g = get_service(studio)
    from studio.game.service import HUMAN  # noqa: PLC0415

    level = int(g.db.state(*HUMAN)[1])
    used = tried(studio)
    info = g.seat_info()  # sınırları C1 kontrol noktasından (T15); yalnız bilgi
    limits: dict[str, Any] = dict(info["limits"]) if info else {}
    cards: list[dict[str, Any]] = []
    for c in PATH:
        state = "tried" if used.get(c.id) else "spotlight" if level >= c.level else "later"
        cards.append({"id": c.id, "level": c.level, "to": c.to, "state": state, "usable": True,
                      "plan_limit": limits.get(c.plan_key) if c.plan_key else None})
    nxt = next((c for c in cards if c["state"] == "spotlight"), None) \
        or next((c for c in cards if c["state"] == "later"), None)
    if nxt:
        nxt["next"] = True
    return {"level": level, "cards": cards, "next": nxt["id"] if nxt else None,
            "done": sum(1 for c in cards if c["state"] == "tried"), "total": len(cards)}
