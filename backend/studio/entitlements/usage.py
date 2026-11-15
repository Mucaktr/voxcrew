"""Sayaçlar : koltuk, özel akış, zamanlanmış iş, özel dünya, adlandırılmış API bağlantısı.

Kaynak her zaman mevcut servislerdir; burada ayrı bir sayaç tablosu tutulmaz (yazma yok, kayma yok).

Koltuk tanımı (§2.2, K4): `Agent` düğümü; `demo` değil, değerlendirme geçici ajanı değil, `benched` değil.
`hidden` yalnız görünürlüktür ve koltuktan muaf tutmaz: kullanıcı düzenleyebildiği için muafiyet sınırı aşmaya
yol açıyordu. Sistemin gizlediği ajanlar (Hermes `default` profili, kaldırılmış Hermes profilleri, işten çıkarılanlar)
gizlenirken yedeğe de alınır; değerlendirme ajanları yalnız iç işaretle (`eval_temp`/`eval_matrix`) muaftır.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from studio.api import Studio

HERO_WORKFLOW_PREFIX = "kahraman-"   # kahraman başlangıç akışları paketle gelir; özel akış sayılmaz


def seat_exempt(node: dict[str, Any] | None) -> bool:
    """Koltuk dışı: demo ya da değerlendirme geçici ajanı. İşaretler yalnız iç yollardan yazılır (EDITABLE dışı)."""
    p = node["props"] if node else {}
    return bool(p.get("demo") or p.get("eval_temp") or p.get("eval_matrix"))


def roster_nodes(studio: "Studio") -> list[dict[str, Any]]:
    """Kadroya giren ajan düğümleri (oluşturulma sırasıyla): demo ve değerlendirme ajanları hariç."""
    nodes = studio.store.nodes("Agent", limit=studio.agents.MAX_LIST, order="created_at ASC")
    return [n for n in nodes if not seat_exempt(n)]


def is_benched(node: dict[str, Any] | None) -> bool:
    return bool(node and node["props"].get("benched"))


def counts_as_seat(node: dict[str, Any] | None) -> bool:
    return bool(node) and not seat_exempt(node) and not is_benched(node)


def seats(studio: "Studio") -> dict[str, int]:
    nodes = roster_nodes(studio)
    benched = sum(1 for n in nodes if is_benched(n))
    return {"used": len(nodes) - benched, "benched": benched}


def workflows(studio: "Studio") -> int:
    d = getattr(studio.library, "dir", None)
    if d is None or not d.is_dir():
        return 0
    return sum(1 for p in d.glob("*.yaml") if not p.stem.startswith(HERO_WORKFLOW_PREFIX))


def schedules(studio: "Studio") -> int:
    """Etkin zamanlanmış işler (duraklatılmış olanlar sayılmaz: fazlası duraklar, silinmez)."""
    return sum(1 for n in studio.store.nodes("Schedule", limit=5000) if n["props"].get("enabled"))


def worlds(studio: "Studio") -> int:
    from studio.worlds.service import get_store

    return get_store(studio).count()


def api_connections(studio: "Studio") -> int:
    """Uzak (yerel olmayan) adlandırılmış API bağlantıları. Yerel sunucular (LM Studio, llama.cpp…) yerel modeldir ve
    asla sayılmaz (§0.5)."""
    from studio.connections import endpoints as E

    try:
        return sum(1 for e in E.endpoints_of(studio.settings) if not E.is_local_url(e.get("base_url") or ""))
    except Exception:  # noqa: BLE001 - bozuk ayar sayımı engellemesin
        return 0


COUNTERS = {"workflows": workflows, "schedules": schedules, "worlds": worlds, "api_connections": api_connections}


def count(studio: "Studio", key: str) -> int:
    if key == "seats":
        return seats(studio)["used"]
    fn = COUNTERS.get(key)
    return fn(studio) if fn else 0


def all_usage(studio: "Studio") -> dict[str, int]:
    out = {k: fn(studio) for k, fn in COUNTERS.items()}
    out.update({"seats": seats(studio)["used"]})
    return out
