"""Kurumsal rütbeler (hiyerarşi düzeyi), Türkçe/İngilizce etiketleri ve işe alınan ajanlar için sevimli görünüm üretimi.

Rütbe sırası yukarıdan aşağıya: ceo (Genel Müdür) … intern (Stajyer). Devretme motoru işe alınan ajana
yöneticisinin bir altındaki rütbeyi verir; ofis API'si raporlama hattı rütbe sırasına uymazsa uyarır.

Dil (S16): `RANK_LABELS` Türkçe (geriye uyumlu), `RANK_LABELS_EN` İngilizce; `rank_label(rank, lang)` ve
`rank_labels(lang)` istek diline göre döner (lang verilmezse `studio.i18n.request_lang()`).
"""

from __future__ import annotations

import random
from typing import Any

from studio.i18n import request_lang

RANKS: tuple[str, ...] = ("ceo", "deputy", "director", "manager", "lead", "senior", "specialist", "analyst", "intern")
RANK_LABELS: dict[str, str] = {
    "ceo": "Genel Müdür",
    "deputy": "Genel Müdür Yardımcısı",
    "director": "Direktör",
    "manager": "Müdür",
    "lead": "Lider",
    "senior": "Kıdemli Uzman",
    "specialist": "Uzman",
    "analyst": "Analist",
    "intern": "Stajyer",
}
RANK_LABELS_EN: dict[str, str] = {
    "ceo": "Chief Executive",
    "deputy": "Deputy Chief Executive",
    "director": "Director",
    "manager": "Manager",
    "lead": "Lead",
    "senior": "Senior Specialist",
    "specialist": "Specialist",
    "analyst": "Analyst",
    "intern": "Intern",
}
_LABELS_BY_LANG = {"tr": RANK_LABELS, "en": RANK_LABELS_EN}
DEFAULT_HIRE_RANK = "specialist"


def rank_index(rank: str | None) -> int | None:
    return RANKS.index(rank) if rank in RANKS else None


def rank_labels(lang: str | None = None) -> dict[str, str]:
    """Verilen dilin (yoksa istek dilinin) rütbe etiketleri; bilinmeyen dil → Türkçe."""
    return _LABELS_BY_LANG.get(lang or request_lang(), RANK_LABELS)


def rank_label(rank: str | None, lang: str | None = None) -> str | None:
    return rank_labels(lang).get(rank or "")


def rank_below(rank: str | None, fallback: str | None = None) -> str:
    """Yöneticinin bir alt rütbesi (en alt: stajyer). Yöneticinin rütbesi yoksa `fallback` ya da 'specialist'."""
    i = rank_index(rank)
    if i is None:
        # rütbesiz yönetici varsayılan işe alım rütbesinden yükseğini (ör. genel müdür) atayamaz (AUDIT A-13)
        ok = fallback in RANKS and rank_index(fallback) >= rank_index(DEFAULT_HIRE_RANK)  # type: ignore[operator]
        return fallback if ok else DEFAULT_HIRE_RANK  # type: ignore[return-value]
    return RANKS[min(i + 1, len(RANKS) - 1)]


def rank_order_warning(member_rank: str | None, boss_rank: str | None, member: str, boss: str) -> str | None:
    """Raporlanan kişinin rütbesi astınkinden yüksek olmalı; değilse kullanıcıya gösterilecek uyarı (engellemez)."""
    mi, bi = rank_index(member_rank), rank_index(boss_rank)
    if mi is None or bi is None or bi < mi:
        return None
    return (f"Rütbe sırası tutarsız: {member} ({RANK_LABELS[member_rank]}), kendisiyle aynı ya da daha düşük "  # type: ignore[index]
            f"rütbedeki {boss} ({RANK_LABELS[boss_rank]}) kişisine raporluyor")  # type: ignore[index]


# ------------------------------------------------------------------ işe alınan ajanların görünümü
# GIFTS-GENDER: havuzda yalnızca açıkça erkek ya da kadın adı var (Ada/Kuzey/Tuna/Bulut/Yağmur/Rüzgar/Toprak/Su gibi
# uniseks ya da belirsiz adlar çıkarıldı); her ad `presentation.py` tablosunda tanımlıdır, işe alınan ajan adına uygun giyinir.
HIRE_NAMES = ("Ece", "Mert", "Zeynep", "Can", "Elif", "Ozan", "Aylin", "Kerem", "Nil", "Efe", "Lara", "Emre",
              "Duru", "Aras", "Mina", "Kaan", "İpek", "Atlas", "Selin", "Burak", "Defne", "Berk", "Naz", "Alp")
_SPECIES = ("human", "cat", "dog", "fox", "bear", "rabbit", "panda", "penguin")
_FUR = {"cat": ["#A39A92", "#F4A261", "#3B3B3B"], "dog": ["#C8A27A", "#8D6E63", "#F5F5F4"],
        "fox": ["#E8833A", "#D9622B"], "bear": ["#8D6E63", "#5D4037"], "rabbit": ["#F3F4F6", "#D6CFC7"],
        "panda": ["#F5F5F4"], "penguin": ["#2B2D42"],
        "human": ["#FCE3CF", "#F5D0B5", "#E0AC69", "#C68642", "#8D5524", "#5C3A21"]}
_HAIR = ("short", "long", "bun", "curly", "spiky", "bob", "ponytail", "bald")  # nötr havuz; sunuma göre presentation.HAIR_BY
_HAIR_COLORS = ("#2B1D14", "#5B3A1E", "#B45309", "#1F1A17", "#9CA3AF", "#7C2D12")
# Yalnızca ücretsiz başlangıç kozmetikleri (game.catalog.STARTER_COSMETICS); mağaza öğeleri satın alınarak açılır (QA-F3 m7)
# + "shirt"/"blazer" (S34): mağazada yok, her zaman açık
_OUTFITS = ("tshirt", "hoodie", "sweater", "overalls", "shirt", "blazer")
# S34: işe alınan ajanlar varsayılan olarak insan görünümlüdür; arada bir hayvan maskot çıkar
HUMAN_SHARE = 0.85
_COLORS = ("#7C5CFF", "#3B82F6", "#EF4444", "#F59E0B", "#10B981", "#EC4899", "#14B8A6", "#0EA5E9", "#F97316")
_ACCENTS = ("#FFD166", "#FDE68A", "#F472B6", "#38BDF8", "#22C55E", "#FFF1E6")
_GLASSES = ("none", "none", "round", "square")
_HATS = ("none", "none", "cap", "beanie", "headphones")


def cute_avatar(rng: random.Random | None = None, presentation: str = "n") -> dict[str, Any]:
    """İşe alınan ajanın görünümü. `presentation` (`m`/`f`/`n`; `presentation.presentation_of_name`) saç, sakal ve kıyafet
    havuzunu belirler: erkek -> erkek giyimi, sakal serbest; kadın -> kadın giyimi, sakal yok."""
    from studio.office.presentation import BEARD_BY, HAIR_BY, OUTFIT_BY
    p = presentation if presentation in ("m", "f", "n") else "n"
    r = rng or random.Random()
    species = "human" if r.random() < HUMAN_SHARE else r.choice(_SPECIES[1:])
    human = species == "human"
    return {"species": species, "skin": r.choice(_FUR[species]),
            "hair": r.choice(HAIR_BY[p]) if human else "none", "hairColor": r.choice(_HAIR_COLORS),
            "beard": r.choice(BEARD_BY[p]) if human else "none",
            "outfit": r.choice(OUTFIT_BY[p]), "outfitColor": r.choice(_COLORS), "accent": r.choice(_ACCENTS),
            "glasses": r.choice(_GLASSES), "hat": r.choice(_HATS)}


def pick_name(taken: set[str], rng: random.Random | None = None) -> str:
    r = rng or random.Random()
    free = [n for n in HIRE_NAMES if n.casefold() not in {t.casefold() for t in taken}]
    return r.choice(free) if free else f"{r.choice(HIRE_NAMES)} {r.randint(2, 99)}"
