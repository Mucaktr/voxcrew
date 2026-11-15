"""W5 — yürüme modu "Ben" avatarının doğrulaması (D1 A).

Avatar ajan değildir: beyni, XP'si, sıralaması yoktur; graf belleğine yazılmaz. Görünüm `game_meta['walk:avatar']` içinde
`{"avatar": {...}, "name": "..."}` olarak saklanır ( b gelince "Ben" düğümüne taşınır).

`normalize` ön yüzdeki `normalizeAvatar` eşdeğeridir: bilinmeyen alan atılır, eksik alan varsayılanla dolar, sözlük dışı
değer ve geçersiz renk 400 verir. Kozmetik sahipliği GERÇEK sahipliktir (`GameService.is_owned(bypass=False)`): oyunlaştırma
açıkken envanterde olmayan şapka, gözlük ya da kıyafet kaydedilemez; yaratıcı mod ve yönetici/test modu kilidi yalnızca
önizlemede (ön yüz) açar, kayda izin vermez (FIX-SEC, QA). Kayıtlı avatarda sahip olunmayan eşya varsa (ör. eski
sürümde yaratıcı modla giyilmiş) okurken varsayılana döner (`visible`), yani yaratıcı mod kapanınca görünüm korunmaz.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from studio.game.service import GameService

SPECIES = ("human", "cat", "dog", "fox", "bear", "rabbit", "panda", "penguin")
HAIR = ("none", "short", "long", "bun", "curly", "spiky", "bob", "ponytail", "mohawk", "bald")
BEARDS = ("none", "stubble", "full", "goatee", "mustache")
OUTFITS = ("tshirt", "hoodie", "suit", "sweater", "labcoat", "dress", "overalls", "hawaii", "shirt", "blazer")
GLASSES = ("none", "round", "square", "sun", "star")
HATS = ("none", "cap", "beanie", "tophat", "straw", "headphones", "beret", "crown", "party")
CAPES = ("none", "short", "long")
MASKS = ("none", "domino", "visor", "cowl")
EMBLEMS = ("none", "ring", "check", "spark", "wave", "bubble", "book", "lock", "chevron", "gear", "arrows")

DEFAULT: dict[str, Any] = {
    "species": "human", "skin": "#D9A066", "hair": "short", "hairColor": "#2B1D14", "beard": "none",
    "outfit": "hoodie", "outfitColor": "#F28C28", "accent": "#FFE08A", "glasses": "none", "hat": "none",
}
ENUMS: dict[str, tuple[str, ...]] = {
    "species": SPECIES, "hair": HAIR, "beard": BEARDS, "outfit": OUTFITS, "glasses": GLASSES, "hat": HATS,
    "cape": CAPES, "mask": MASKS, "emblem": EMBLEMS,
}
COLORS = ("skin", "hairColor", "outfitColor", "accent", "capeColor")
BOOLS = ("boots", "gloves", "hover")
LOCK_SLOTS = ("hat", "glasses", "outfit")
NAME_MAX = 24
_HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
_CTRL = re.compile(r"[\x00-\x1f\x7f]")
_WEAR = re.compile(r"^(?:|(?:store:)?[a-z0-9][a-z0-9_-]{1,80})$")


class AvatarError(ValueError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def normalize(raw: Any) -> dict[str, Any]:
    """Ön yüz `normalizeAvatar` eşdeğeri + sözlük denetimi. Geçersizse AvatarError(400)."""
    if not isinstance(raw, dict):
        raise AvatarError(400, "avatar bir nesne olmalı")
    out = dict(DEFAULT)
    for key, allowed in ENUMS.items():
        if key in raw and raw[key] is not None:
            v = raw[key]
            if not isinstance(v, str) or v not in allowed:
                raise AvatarError(400, "Avatarda bilinmeyen parça")
            out[key] = v
    for key in COLORS:
        if key in raw and raw[key] is not None:
            v = raw[key]
            if not isinstance(v, str) or not _HEX.match(v):
                raise AvatarError(400, "Avatar rengi #RRGGBB olmalı")
            out[key] = v
    for key in BOOLS:
        if key in raw and raw[key] is not None:
            if not isinstance(raw[key], bool):
                raise AvatarError(400, "Avatarda bilinmeyen parça")
            out[key] = raw[key]
    if "wear" in raw and raw["wear"] is not None:   # COS-A: mağaza kıyafeti (öğe kimliği); sahipliği check_owned süzer
        v = raw["wear"]
        if not isinstance(v, str) or not _WEAR.match(v):
            raise AvatarError(400, "Avatarda bilinmeyen parça")
        if v:
            out["wear"] = v[len("store:"):] if v.startswith("store:") else v
    if "aura" in raw and raw["aura"] is not None:
        v = raw["aura"]
        if not isinstance(v, str) or not (v == "none" or _HEX.match(v)):
            raise AvatarError(400, "Avatar rengi #RRGGBB olmalı")
        out["aura"] = v
    return out


def clean_name(raw: Any) -> str:
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise AvatarError(400, "Ad en çok 24 karakterlik metin olmalı")
    name = _CTRL.sub("", raw).strip()
    if len(name) > NAME_MAX:
        raise AvatarError(400, "Ad en çok 24 karakterlik metin olmalı")
    return name


def locks_active(g: "GameService") -> bool:
    """Oyunlaştırma açıkken kozmetik kilitleri geçerlidir. Yaratıcı mod ve yönetici/test modu kaydı açmaz (FIX-SEC)."""
    settings = g.studio.settings.get("game") or {}
    return bool(settings.get("enabled", True))


def _owned(g: "GameService", slot: str, value: Any) -> bool:
    return not value or value == "none" or g.is_owned(f"{slot}:{value}", bypass=False)


def check_owned(g: "GameService", avatar: dict[str, Any], current: dict[str, Any] | None = None) -> None:
    """Gerçekten sahip olunmayan kilitli kozmetik seçildiyse AvatarError(403). `current` geriye uyum için kabul edilir;
    kayıtlı eşyaya istisna tanınmaz (yaratıcı modla giyilen eşya mod kapanınca kalmasın)."""
    del current
    strip_wear(g, avatar)   # iade edilmiş ya da sahip olunmayan mağaza kıyafeti kayda girmez (403 değil, atılır)
    if not locks_active(g):
        return
    for slot in LOCK_SLOTS:
        if not _owned(g, slot, avatar.get(slot)):
            raise AvatarError(403, "Bu kozmetik kilitli; önce mağazadan aç")


def strip_wear(g: "GameService", avatar: dict[str, Any]) -> None:
    """`wear` yalnız sahip olunan ve giyilebilir (iade edilmemiş) `store:*` avatar parçasıysa kalır (yerinde)."""
    if "wear" not in avatar:
        return
    from studio.cosmetics.service import clean_wear  # noqa: PLC0415 - walk → cosmetics (salt okuma)

    keep = clean_wear(g, avatar.get("wear"))
    if keep:
        avatar["wear"] = keep
    else:
        avatar.pop("wear", None)


def visible(g: "GameService", avatar: dict[str, Any] | None) -> dict[str, Any] | None:
    """Okuma: sahip olunmayan kilitli eşyayı varsayılana çevirir (kilitler geçerliyse)."""
    if avatar is None:
        return avatar
    if "wear" in avatar:
        avatar = dict(avatar)
        strip_wear(g, avatar)
    if not locks_active(g):
        return avatar
    out = dict(avatar)
    for slot in LOCK_SLOTS:
        if not _owned(g, slot, out.get(slot)):
            out[slot] = DEFAULT.get(slot, "none")
    return out


def parse_stored(raw: str | None) -> tuple[dict[str, Any] | None, str]:
    """`game_meta['walk:avatar']` → (avatar, ad). Eski biçim (doğrudan avatar nesnesi) de okunur; bozuksa (None, "")."""
    import json

    if not raw:
        return None, ""
    try:
        val = json.loads(raw)
    except ValueError:
        return None, ""
    if not isinstance(val, dict):
        return None, ""
    if isinstance(val.get("avatar"), dict):
        try:
            return normalize(val["avatar"]), clean_name(val.get("name"))
        except AvatarError:
            return None, ""
    try:
        return normalize(val), ""
    except AvatarError:
        return None, ""
