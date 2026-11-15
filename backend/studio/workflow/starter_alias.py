"""PROC-FIX P2 — örnek akışların başlangıç ajanlarını stüdyonun GERÇEKTEN kurduğu ajanlara çözme.

Süreç testi A (§9): örnek akışlar başlangıç ekibinin slug'larını (`arastirmaci`, `yazilimci`) ister. Hermes algılanan
taze kurulumda ise stüdyo Hermes profillerinden `arastirma` (Araştırmacı) ve `yazim` (Yazar) ajanlarını kurar ve başlangıç
ekibi hiç oluşmaz; kartta "adlı ajan yok" çıkar. Bu modül, istenen slug yoksa aynı göreve sahip var olan ajanı bulur:

- `arastirmaci` → Hermes `arastirma` profili ajanı; yoksa adı/unvanı "Araştırmacı"/"Researcher" olan görünür ajan.
- `yazilimci` → adı/unvanı "Yazılımcı"/"Developer" olan görünür ajan; yoksa Hermes `yazim` (Yazar) ajanı (örnek
  akışlarda Yazılımcı metin yazar ve fikir üretir).

Yalnız bu iki başlangıç slug'ı çözülür; kullanıcının kendi akışındaki başka eksik slug her zaman hata olarak kalır.
"""

from __future__ import annotations

from typing import Any

STARTER_ALIASES: dict[str, dict[str, tuple[str, ...]]] = {
    "arastirmaci": {"slugs": ("arastirma",), "names": ("araştırmacı", "arastirmaci", "researcher")},
    "yazilimci": {"slugs": (), "names": ("yazılımcı", "yazilimci", "developer"), "then": ("yazim",)},
}


def _visible(agents: Any) -> list[dict[str, Any]]:
    try:
        return [a for a in agents.list() if not a.get("hidden")]
    except Exception:  # noqa: BLE001 - kayıt okunamazsa çözüm yok
        return []


def resolve(agents: Any, slug: str | None, listed: list[dict[str, Any]] | None = None) -> str | None:
    """`slug` bir başlangıç slug'ıysa ve böyle bir ajan yoksa aynı görevdeki var olan ajanın slug'ı; yoksa None."""
    rule = STARTER_ALIASES.get(str(slug or ""))
    if not rule:
        return None
    items = listed if listed is not None else _visible(agents)
    have = {a.get("slug") for a in items}
    if slug in have:
        return None
    for s in rule.get("slugs", ()):
        if s in have:
            return s
    names = rule.get("names", ())
    for a in items:
        text = " ".join(str(a.get(k) or "") for k in ("name", "title")).replace("İ", "i").lower()
        if any(n in text for n in names):
            return str(a.get("slug"))
    for s in rule.get("then", ()):
        if s in have:
            return s
    return None


def resolvable(agents: Any) -> set[str]:
    """Doğrulama için: bu kurulumda çözülebilen başlangıç slug'ları."""
    items = _visible(agents)
    return {k for k in STARTER_ALIASES if resolve(agents, k, items)}
