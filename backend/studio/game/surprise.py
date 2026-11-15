""" sürpriz teslim kutusu ( §6.8 madde 1).

Haftalık bir görev bittiğinde kullanıcıya **ücretsiz** bir kutu yazılır (görev başına bir kutu). Kutu açılınca havuzdan
rastgele bir kozmetik çıkar. Kurallar:

- Olasılıklar kutunun üstünde yazılıdır: yaygın %70 · nadir %25 · epik %5 (`BASE_ODDS`). Bir nadirlik dilimi boşaldıysa
  (her şey sende) kalan dilimler aynı oranla yeniden ölçeklenir ve arayüz bu ETKİN oranları gösterir (dürüst değişkenlik).
- Kopya koruması: sahip olunan öğe asla çıkmaz. Havuz tamamen biterse kutu kapalı bekler; hiçbir şey kaybolmaz.
- Satın alınamaz, jetonla açılamaz, yeniden çekilemez: bu modülde jeton, fiyat ya da para yazan tek satır yoktur ve
  açılmış kutu her çağrıda AYNI sonucu döndürür. XP ve jeton asla rastgele değildir (Y4).
- Yönetici/test modunda kutu açılmaz (S40: envantere yazılmaz); kutu sonraya kalır.
"""

from __future__ import annotations

import json
import random
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from studio.game import catalog as C
from studio.game import rules as R

if TYPE_CHECKING:
    from studio.game.service import GameService

RARITIES = ("common", "rare", "epic")
BASE_ODDS: dict[str, int] = {"common": 70, "rare": 25, "epic": 5}   # yüzde; toplam 100


@dataclass(frozen=True)
class Collectible:
    """Yalnız kutudan çıkan küçük masa koleksiyonu (satılmaz; mağazada yoktur)."""
    id: str
    rarity: str
    label_tr: str
    label_en: str

    @property
    def label(self) -> str:
        return C._pick(self.label_tr, self.label_en)


EXTRAS: tuple[Collectible, ...] = (
    Collectible("desk:plant-mini", "common", "Mini saksı", "Mini plant"),
    Collectible("desk:sticky-notes", "common", "Renkli yapışkan notlar", "Colourful sticky notes"),
    Collectible("desk:rubber-duck", "common", "Hata ayıklama ördeği", "Debugging duck"),
    Collectible("desk:pencil-cup", "common", "Kalemlik", "Pencil cup"),
    Collectible("desk:globe", "rare", "Masa küresi", "Desk globe"),
    Collectible("desk:lava-lamp", "rare", "Lav lambası", "Lava lamp"),
    Collectible("desk:bonsai", "epic", "Bonsai", "Bonsai"),
)
EXTRA_BY_ID = {e.id: e for e in EXTRAS}


def _shop_pool() -> list[tuple[str, str]]:
    """Mağazanın giyilebilir kozmetikleri ve kutlama stilleri; başarım ya da seviyeyle kazanılanlar havuza girmez
    (kazanım yolları kutuya devredilmez)."""
    return [(i.id, i.rarity) for i in C.SHOP
            if i.kind in ("cosmetic", "celebration") and i.rarity in RARITIES and not i.achievement
            and not i.min_level and not i.unlock_level]


def pool(svc: "GameService") -> dict[str, list[str]]:
    """Nadirliğe göre SAHİP OLUNMAYAN öğeler (kopya koruması)."""
    out: dict[str, list[str]] = {r: [] for r in RARITIES}
    starters = set(C.STARTER_COSMETICS)
    for item_id, rarity in _shop_pool():
        if item_id in starters or svc.is_owned(item_id, bypass=False):
            continue
        out[rarity].append(item_id)
    for e in EXTRAS:
        if not svc.db.owns(e.id):
            out[e.rarity].append(e.id)
    return out


def effective_odds(buckets: dict[str, list[str]]) -> dict[str, float]:
    """Boş dilim atlanır, kalanlar `BASE_ODDS` oranıyla 100'e ölçeklenir (gösterilen oran = uygulanan oran)."""
    live = {r: BASE_ODDS[r] for r in RARITIES if buckets.get(r)}
    total = sum(live.values())
    return {r: round(100 * live[r] / total, 1) if r in live and total else 0.0 for r in RARITIES}


def draw(buckets: dict[str, list[str]], rng: random.Random) -> tuple[str, str]:
    """Önce nadirlik (`effective_odds` ile aynı ağırlık), sonra o dilimden eşit olasılıkla sahip olunmayan bir öğe."""
    rarities = [x for x in RARITIES if buckets.get(x)]
    rarity = rng.choices(rarities, weights=[BASE_ODDS[x] for x in rarities], k=1)[0]
    return rarity, rng.choice(sorted(buckets[rarity]))


def label_of(item_id: str) -> str:
    if item_id in EXTRA_BY_ID:
        return EXTRA_BY_ID[item_id].label
    item = C.SHOP_BY_ID.get(item_id)
    return item.label if item else item_id


def rarity_of(item_id: str) -> str:
    if item_id in EXTRA_BY_ID:
        return EXTRA_BY_ID[item_id].rarity
    item = C.SHOP_BY_ID.get(item_id)
    return item.rarity if item else "common"


# ---------------------------------------------------------------- kazanma (GameService işlemi içinde)
def earn(svc: "GameService", quest_id: str, ts: float) -> bool:
    """Haftalık görev bitti → bir kutu (görev başına bir kez; `quest_id` benzersiz)."""
    added = svc.db.exec("INSERT OR IGNORE INTO surprise_log(id,quest_id,earned_at) VALUES(?,?,?)",
                        f"box:{quest_id}", quest_id, ts) == 1
    if added:
        svc.db.feed(ts, "surprise", "human", "me", "Sürpriz teslim kutusu kazandın (ücretsiz)", None,
                    {"box": f"box:{quest_id}", "quest": quest_id})
        svc._emit("game.surprise", box=f"box:{quest_id}", quest=quest_id, status="earned")  # noqa: SLF001
    return added


# ---------------------------------------------------------------- açma (tek yol; bedel yok)
def open_box(svc: "GameService", box_id: str, rng: random.Random | None = None) -> dict[str, Any]:
    """Kutuyu açar. Açılmış kutu aynı sonucu döndürür (yeniden çekme yok). Bedel, jeton ya da fiyat parametresi YOK."""
    if svc.admin():
        raise ValueError("Yönetici / test modunda sürpriz kutu açılmaz")
    now = time.time()
    with svc._lock:  # noqa: SLF001
        with svc.db.tx():
            row = svc.db.one("SELECT * FROM surprise_log WHERE id=?", box_id)
            if row is None:
                raise KeyError("Sürpriz kutu yok")
            if row["opened_at"] is not None:
                return {"ok": True, "already": True, "box": _box_view(row), "events": []}
            buckets = pool(svc)
            odds = effective_odds(buckets)
            if not any(buckets.values()):
                raise ValueError("Havuzdaki her kozmetik zaten sende; kutu yeni öğeler eklenince açılabilir")
            rarity, item_id = draw(buckets, rng or random.SystemRandom())
            svc.db.exec("UPDATE surprise_log SET opened_at=?, item_id=?, rarity=?, odds=? WHERE id=? AND opened_at IS NULL",
                        now, item_id, rarity, json.dumps(odds), box_id)
            from studio.game.season import grant_item  # noqa: PLC0415

            grant_item(svc, item_id, "surprise", now)
            svc.db.feed(now, "surprise", "human", "me", f"Sürpriz kutudan: {label_of(item_id)}", None,
                        {"box": box_id, "item": item_id, "rarity": rarity})
            svc._emit("game.surprise", box=box_id, status="opened", item=item_id, rarity=rarity,  # noqa: SLF001
                      label=label_of(item_id))
            row = svc.db.one("SELECT * FROM surprise_log WHERE id=?", box_id)
        events = svc._drain()  # noqa: SLF001
    return {"ok": True, "box": _box_view(row), "events": events}


def _box_view(r: Any) -> dict[str, Any]:
    item = r["item_id"]
    return {"id": r["id"], "quest": r["quest_id"], "earned_at": r["earned_at"], "opened_at": r["opened_at"],
            "item": item, "label": label_of(item) if item else None, "rarity": r["rarity"],
            "odds_at_open": json.loads(r["odds"]) if r["odds"] else None}


def view(svc: "GameService") -> dict[str, Any]:
    buckets = pool(svc)
    # açılmamış kutuların HEPSİ (sınırsız; her kazanılan kutu arayüzden açılabilir) + son 30 geçmiş kaydı
    unopened = svc.db.q("SELECT * FROM surprise_log WHERE opened_at IS NULL ORDER BY earned_at DESC")
    history = svc.db.q("SELECT * FROM surprise_log WHERE opened_at IS NOT NULL ORDER BY earned_at DESC LIMIT 30")
    rows = sorted([*unopened, *history], key=lambda r: r["earned_at"], reverse=True)
    return {
        "base_odds": dict(BASE_ODDS),
        "odds": effective_odds(buckets),          # kutunun üstünde yazan oran (uygulanan)
        "pool": {r: len(v) for r, v in buckets.items()},
        "pool_empty": not any(buckets.values()),
        "boxes": [_box_view(r) for r in rows],
        "unopened": len(unopened),
        "week": R.week_of(time.time()),
        # Etik sözleşme (arayüz bunu metin olarak gösterir): satın alma, jetonla açma ve yeniden çekme yok
        "rules": {"free": True, "purchasable": False, "coin_open": False, "reroll": False, "duplicates": False},
    }
