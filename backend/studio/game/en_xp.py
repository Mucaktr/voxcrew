"""DECB-FIX: `game.xp` olayındaki XP gerekçesinin İngilizcesi (`reason_en`).

Gerekçe, kural etiketlerinin " · " ile birleşmiş hâlidir (ör. "Adım tamamlandı (+10) · kabul edildi"). Her parça ayrı
çevrilir; bilinmeyen parça (kullanıcı metni, eski sürüm etiketi) olduğu gibi kalır. Defter ve akış Türkçe kalır; bu
yalnızca İngilizce arayüzün bildirim gövdesi içindir.
"""

from __future__ import annotations

from studio._edition import EDITION

import re
from functools import lru_cache

SEP = " · "

FIXED = {
    "Çalıştırma başlattın": "You started a run",
    "Onay kapısı kararı": "Approval gate decision",
    "Karara gerekçe notu": "Reason note on a decision",
    "Araç onayı kararı": "Tool approval decision",
    "Kendi akışın ilk kez başarılı": "Your own workflow succeeded for the first time",
    "Bellek bakımı": "Memory upkeep",
    "Takdir": "Recognition",
    "Keşif": "Discovery",
    "Hatıra buldun": "You found a keepsake",
    "Simge keşfettin": "You discovered a landmark",
    "Ajan ziyareti": "Agent visit",
    "Adım tamamlandı": "Step completed",
    "Temiz araç kullanımı": "Clean tool use",
    "Akış başarıyla bitti": "Workflow finished successfully",
    "İlk turda onay": "Approved on the first try",
    "Verimli adım": "Efficient step",
    "Revizeden toparlandı": "Recovered after a revision",
    "Onay kapısından geçti": "Passed the approval gate",
    "Teslim işe yaradı": "Handoff paid off",
    "Ekibin başarısından pay": "Share of the team's success",
    "Hedefi tamamlandı": "Completed the goal",
    "Harici oturum tamamlandı": "External session completed",
    "Görev ödülü": "Quest reward",
    "kabul edildi": "accepted",
    "adım tavanı": "step cap",
    "XP yok: çıktı çok kısa": "No XP: output too short",
    "XP yok: aynı iş 24 saat içinde tekrarlandı": "No XP: same work repeated within 24 hours",
}

_AMOUNT = re.compile(r"^(?P<body>.*?)(?P<amount> \(\+\d+\))?$", re.S)
_LIMIT_TR = ": günlük sınır doldu"
_DIMINISH = re.compile(r"^günlük azalma: \+(\d+)$")


@lru_cache(maxsize=1)
def _achievement_names() -> dict[str, str]:
    from studio.game import catalog as C

    out: dict[str, str] = {}
    for ach in C.ACHIEVEMENTS:
        for tier in range(1, len(ach.tiers) + 1):
            tr, en = ach.tier_name(tier, "tr"), ach.tier_name(tier, "en")
            if tr and en:
                out[tr] = en
    return out


@lru_cache(maxsize=1)
def _lesson_titles() -> dict[str, str]:
    if EDITION != "full":
        return {}
    try:
        from studio.full.academy import LESSONS
    except Exception:  # noqa: BLE001 - akademi modülü yoksa başlık çevrilmez
        return {}
    return {lesson.title_tr: lesson.title_en for lesson in LESSONS if lesson.title_en}


def _body_en(body: str) -> str:
    if body in FIXED:
        return FIXED[body]
    if body.startswith("Akademi dersi: "):
        title = body[len("Akademi dersi: "):]
        return f"Academy lesson: {_lesson_titles().get(title, title)}"
    if body.startswith("Başarım: "):
        name = body[len("Başarım: "):]
        return f"Achievement: {_achievement_names().get(name, name)}"
    if body.startswith("Hedef tamamlandı: "):
        return f"Goal completed: {body[len('Hedef tamamlandı: '):]}"
    return body


def _part_en(part: str) -> str:
    m = _DIMINISH.match(part)
    if m:
        return f"daily diminishing: +{m.group(1)}"
    limited = part.endswith(_LIMIT_TR)
    if limited:
        part = part[: -len(_LIMIT_TR)]
    m2 = _AMOUNT.match(part)
    body, amount = (m2.group("body"), m2.group("amount") or "") if m2 else (part, "")
    return f"{_body_en(body)}{amount}{': daily limit reached' if limited else ''}"


def xp_reason_en(reason: str) -> str:
    """Türkçe XP gerekçesini parça parça İngilizceye çevirir; bilinmeyen parçalar aynen kalır."""
    if not reason:
        return ""
    return SEP.join(_part_en(p) for p in reason.split(SEP))
