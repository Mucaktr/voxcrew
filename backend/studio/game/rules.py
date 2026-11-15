"""Oyunlaştırma kuralları: seviye eğrileri, kıdem/unvan bantları, azalan getiri ve katı onay işareti.

Kaynak: (B.2–B.6, B.11). Bu modül saf fonksiyonlardan oluşur; durum tutmaz.
"""

from __future__ import annotations

import math
import re
from typing import Any

from studio.clock import DAY_START_HOUR, day_of, next_day_start, week_of  # noqa: F401 - tek gün sınırı (studio.clock)
from studio.clock import shifted as _shifted  # noqa: F401 - geriye uyum

RULE_VERSION = 2            # G2-D (R-2): ajan XP tabanı doğrulanmış iş; v1 kayıtları olduğu gibi kalır
LEVEL_CAP = 30            # ajan ve yönetici için v1 tavanı
OFFICE_LEVEL_CAP = 100
# DAY_START_HOUR (04:00) artık studio.clock'ta; burada yeniden dışa aktarılır (R.DAY_START_HOUR)

# ---------------------------------------------------------------- ajan XP (B.2)
STEP_DONE = 20
FIRST_TRY = 10
RECOVERY = 5
GATE_SHARE = 10
CLEAN_TOOLS = 3
EFFICIENT = 3
HANDOFF_USED = 4
HANDOFF_STEP_MAX = 8      # adım başına en çok +8 teslim XP'si
RUN_SUCCESS = 5
STEP_CAP = 60             # H4: adım başına tavan
TEAM_SHARE_RATE = 0.10    # devretme kökü: astların o koşudaki XP'sinin %10'u
TEAM_SHARE_MAX = 20
TRIVIAL_CHARS = 80        # H1: önemsiz iş eşiği
REPEAT_WINDOW_S = 24 * 3600   # H2
EXTERNAL_SESSION_XP = 10      # harici oturum (Claude Code/Codex) tabanı; 0,5 çarpanla
EXTERNAL_MULTIPLIER = 0.5

# G2-D / karar R-2: ajan XP'si adım bitince DEĞİL, kullanıcı işi doğrulayınca (kendi kabul kararı) verilir. Koşu
# sırasında bu kurallar yalnız "bekleyen" kayda yazılır (`game_pending`); kullanıcının kabulünde, teslimin sürüm zinciri
# başına BİR kez deftere geçer. Ret, revizyon isteği ve ajan hakem kararı ajan XP'si üretmez. Tavanlar (adım tavanı,
# günlük azalma, ofis adalet tavanı) kabul anında aynen uygulanır.
PARTIAL_XP_FACTOR = 0.5  # "kısmen kullanılabilir" kabul tam doğrulanmış XP vermez
VERIFIED_RULES = frozenset({"step_done", "clean_tools", "first_try", "efficient", "recovery", "gate_share",
                            "handoff_used", "run_success", "team_share"})
# Bu kurallara bağlı ajan başarım sayaçları da kabulde artar (ör. "İlk Teslimat" artık doğrulanmış ilk adımda açılır)
VERIFIED_COUNTERS = {"step_done": "steps_done", "first_try": "first_try", "recovery": "recovery",
                     "gate_share": "gate_share"}
XP_BASIS = "verified"

# ---------------------------------------------------------------- yönetici XP (B.3): (xp, günlük sınır)
HUMAN_RULES: dict[str, tuple[int, int | None]] = {
    "decision": (5, 20),
    "decision_note": (3, 20),
    "tool_decision": (2, 20),
    "run_start": (2, 10),
    "wf_first_success": (25, None),
    "memory_curate": (3, 10),
    "goal_completed": (20, None),
    # S31 Akademi: ders başına bir kez (anahtar academy:v1:<ders>), 10 ders → en çok 100 XP; atlama/tekrar ödülsüz
    "academy_lesson": (10, None),
    # W4 yürüme: karar kurallarından küçük; ajan XP'si yürüme ve takdirden hiç artmaz
    "walk_visit": (1, 5),       # gün × ajan bir kez
    "walk_discover": (2, 6),    # hatıra ya da simge vizesi (sonlu, tek seferlik)
    "recognition": (2, 6),      # çıktıya bağlı takdir (gift_log ile doğrulanır)
}
GOAL_OWNER_XP = 15

# ---------------------------------------------------------------- nadirlik ödülleri (B.9)
RARITIES = ("common", "rare", "epic", "legendary")
RARITY_LABEL = {"common": "Yaygın", "rare": "Nadir", "epic": "Epik", "legendary": "Efsanevi"}
RARITY_COINS = {"common": 25, "rare": 75, "epic": 200, "legendary": 500}
RARITY_XP = {"common": 10, "rare": 30, "epic": 80, "legendary": 200}

QUEST_REWARD = {"daily": (15, 10), "weekly": (60, 50)}   # (jeton, yönetici XP'si)
XP_COINS_SOFT_CAP = 150   # H12: XP'den gelen günlük jeton bu sınırı aşınca fazlası %50


# ---------------------------------------------------------------- seviye eğrileri (B.5)
def total_xp(level: int) -> int:
    """Sv L'ye ulaşmak için gereken birikmiş XP: (L−1)(30L+40)."""
    return (level - 1) * (30 * level + 40)


def office_total_xp(level: int) -> int:
    """Ofis Sv L için birikmiş XP: (L−1)(150L+200)."""
    return (level - 1) * (150 * level + 200)


def level_for(xp: int, *, office: bool = False) -> int:
    fn, cap = (office_total_xp, OFFICE_LEVEL_CAP) if office else (total_xp, LEVEL_CAP)
    level = 1
    while level < cap and fn(level + 1) <= xp:
        level += 1
    return level


def progress(xp: int, level: int | None = None, *, office: bool = False) -> dict[str, Any]:
    """Seviye özeti: {level, xp, into, need, xp_to_next, progress(0–1), max}."""
    fn, cap = (office_total_xp, OFFICE_LEVEL_CAP) if office else (total_xp, LEVEL_CAP)
    lv = max(level or 1, level_for(xp, office=office))
    if lv >= cap:
        return {"level": lv, "xp": xp, "into": xp - fn(lv), "need": 0, "xp_to_next": 0, "progress": 1.0, "max": True}
    base, nxt = fn(lv), fn(lv + 1)
    need = nxt - base
    into = max(0, xp - base)
    return {"level": lv, "xp": xp, "into": into, "need": need, "xp_to_next": max(0, nxt - xp),
            "progress": round(min(1.0, into / need), 4) if need else 1.0, "max": False}


# ---------------------------------------------------------------- kıdem ve unvanlar (B.3, B.6)
# (en düşük seviye, kıdem adı, karşılık gelen pozisyon rütbesi)
SENIORITY_BANDS: list[tuple[int, str, str]] = [
    (1, "Stajyer", "intern"), (4, "Analist", "analyst"), (8, "Kıdemli", "senior"), (13, "Lider", "lead"),
    (18, "Müdür", "manager"), (23, "GMY", "deputy"), (28, "Genel Müdür", "ceo"),
]
MANAGER_TITLES: list[tuple[int, str]] = [
    (1, "Girişimci"), (5, "Kurucu"), (10, "Patron"), (15, "Yönetim Kurulu Başkanı"),
    (20, "Holding Başkanı"), (25, "Efsane Kurucu"),
]
RANK_ORDER = ["intern", "analyst", "specialist", "senior", "lead", "manager", "director", "deputy", "ceo"]
RANK_LABEL = {"ceo": "Genel Müdür", "deputy": "Genel Müdür Yardımcısı", "director": "Direktör", "manager": "Müdür",
              "lead": "Lider", "senior": "Kıdemli Uzman", "specialist": "Uzman", "analyst": "Analist",
              "intern": "Stajyer"}


def band_index(level: int) -> int:
    idx = 0
    for i, (lo, _name, _rank) in enumerate(SENIORITY_BANDS):
        if level >= lo:
            idx = i
    return idx


def seniority(level: int) -> str:
    return SENIORITY_BANDS[band_index(level)][1]


def manager_title(level: int) -> str:
    title = MANAGER_TITLES[0][1]
    for lo, name in MANAGER_TITLES:
        if level >= lo:
            title = name
    return title


def rank_index(rank: str | None) -> int:
    return RANK_ORDER.index(rank) if rank in RANK_ORDER else -1


def promotion_hint(level: int, rank: str | None) -> dict[str, Any] | None:
    """Kıdem bandı pozisyonun üstündeyse bir kez gösterilecek terfi önerisi (pozisyon asla otomatik değişmez)."""
    if not rank or rank not in RANK_ORDER:
        return None
    b = band_index(level)
    band_rank = SENIORITY_BANDS[b][2]
    if rank_index(band_rank) <= rank_index(rank):
        return None
    return {"band": b, "seniority": SENIORITY_BANDS[b][1], "suggested_rank": band_rank,
            "suggested_label": RANK_LABEL.get(band_rank, band_rank), "current_label": RANK_LABEL.get(rank, rank)}


# ---------------------------------------------------------------- günlük azalma (H3) ve jeton (H12)
def diminished(total: float) -> float:
    """Günlük ham toplamın etkin karşılığı: ilk 150 %100, 150–300 %50, 300 üstü %25."""
    a = min(total, 150.0)
    b = min(max(total - 150.0, 0.0), 150.0) * 0.5
    c = max(total - 300.0, 0.0) * 0.25
    return a + b + c


def diminish_delta(before: int, raw: int) -> int:
    return int(math.floor(diminished(before + raw))) - int(math.floor(diminished(before)))


# §6.1 adalet tavanı: ofisin günlük etkin XP'si ajan sayısından bağımsız doyar (20 ajan, aynı iş için 2 ajanı
# seviye hızında ≈%25'ten fazla geçemez). İlk 400 %100, 400–800 %50, 800 üstü %10. Jeton da bu etkin XP'den hesaplanır.
OFFICE_DAY_FULL = 400
OFFICE_DAY_HALF = 800


def office_diminished(total: float) -> float:
    a = min(total, float(OFFICE_DAY_FULL))
    b = min(max(total - OFFICE_DAY_FULL, 0.0), float(OFFICE_DAY_HALF - OFFICE_DAY_FULL)) * 0.5
    c = max(total - OFFICE_DAY_HALF, 0.0) * 0.1
    return a + b + c


def office_delta(before: int, raw: int) -> int:
    return int(math.floor(office_diminished(before + raw))) - int(math.floor(office_diminished(before)))


def xp_coin_target(day_xp: int) -> int:
    c = max(0, day_xp) // 10
    return c if c <= XP_COINS_SOFT_CAP else XP_COINS_SOFT_CAP + (c - XP_COINS_SOFT_CAP) // 2


# ---------------------------------------------------------------- zaman
# day_of / week_of / next_day_start: studio.clock (çekirdek ve oyun aynı 04:00 sınırını paylaşır; davranış aynı)


# ---------------------------------------------------------------- katı onay işareti (araştırma §0-7)
_NEGATIONS = re.compile(
    r"onaylanmad|onaylamıyor|onaylamiyor|onaylayam|onay\s+verm(?:iyor|em|ed)|onay\s+yok|onaylanamaz|"
    r"reddedil|reddediyor|revize\s+(?:gerek|edil|et)|düzeltilmeli|değişiklik\s+gerek", re.IGNORECASE)
_KARAR = re.compile(r"KARAR\s*[:：]\s*([^\W\d_]+)", re.IGNORECASE)


def _tr_lower(s: str) -> str:
    return s.replace("İ", "i").replace("I", "ı").lower()


def strict_approved(output: str | None, until: str | None = None) -> bool:
    """İnceleyici çıktısı gerçekten onay mı? Alt dize değil, kelime sınırı ve olumsuzluk denetimi.

    1) `KARAR: ONAY` / `KARAR: REVİZE` işareti varsa yalnızca son işaret belirleyicidir.
    2) Yoksa: olumsuz kalıplar ("onaylanmadı", "onay vermiyorum"…) varsa onay değildir; aksi hâlde
       bitiş sözcüğü (varsayılan ONAY) tam kelime olarak geçmelidir ("onaylanmadı" eşleşmez).
    """
    text = output or ""
    token = (until or "ONAY").strip() or "ONAY"
    marks = _KARAR.findall(text)
    if marks:
        return _tr_lower(marks[-1]) == _tr_lower(token)
    if _NEGATIONS.search(text):
        return False
    return re.search(rf"(?<!\w){re.escape(token)}(?!\w)", text, re.IGNORECASE) is not None


# ---------------------------------------------------------------- araç türü (frontend/voxel/scenes.ts toolKind ile aynı)
def tool_kind(name: str | None) -> str | None:
    if not name:
        return None
    n = name.lower()
    if re.search(r"web|search|fetch|brows|http|url|extract", n):
        return "web"
    if re.search(r"shell|bash|terminal|exec|command|process|python|code_run", n):
        return "shell"
    if re.search(r"todo|plan|delegat|subagent|task|kanban|schedul|cron", n):
        return "plan"
    if re.search(r"write|edit|patch|dosya|create|save", n):
        return "write"
    if re.search(r"read|view|skill|glob|grep|list|file|session|memory|recall", n):
        return "read"
    return "write"


# Akademi alıştırma akışları: demo koşular XP/görev/karar puanı üretmez;
# dersin kendisi bir kez ödüllendirilir (award_academy_lesson). Kanıtlı işe bağlı XP ilkesi.
PRACTICE_WORKFLOWS = frozenset({"akademi-alistirma"})
