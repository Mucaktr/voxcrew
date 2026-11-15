"""WORLD-FIX — olta mini oyununun sunucu yetkili jeton ödülü (yürüme modu; sözleşme: "Olta").

Akış: istemci oltayı atınca `POST /api/walk/fish/cast` (sunucu atışı kurar: balık türü sunucuda seçilir ve gizli kalır,
vuruş anı `bite_ms` ve çekme penceresi `window_ms` döner), oyuncu "Çek!" anında `POST /api/walk/fish/reel` gönderir. Sunucu
kendi saatine göre karar verir: atıştan bu yana geçen süre vuruştan önceyse `early`, pencere + ağ payından sonraysa `late`,
aradaysa `caught`. İstemci miktar, tür, nadirlik ya da sonuç İLETEMEZ (gövdedeki bu alanlar yok sayılır).

Ekonomi (mevcut jeton defteri `game_coins`; yeni para birimi yok, gerçek para bağı yok, yalnız kozmetik alır):
- Jeton YALNIZ başarılı yakalamadan; miktar türün kademesine göre (`TIER_COINS`): çöp 0, yaygın 2, orta 3, nadir 6, efsane 12.
- Kademe olasılıkları her biyomda AYNI (`TIER_WEIGHTS`): biyom seçimi beklenen kazancı değiştirmez (istemcinin bildirdiği
  `water` yalnız tür listesini seçer).
- Azalan getiri: bugünkü ödenmiş yakalamaların ilk `FULL_CATCHES`'i tam, sonraki `HALF_CATCHES`'i yarım, sonrası çeyrek
  (en az 1); günlük tavan `FISH_COINS_PER_DAY` (30). Tavandan sonra yakalama kaydedilir ama ödenmez (`reason: "daily_cap"`).
- İdempotentlik: atış başına tek sonuç (`walk_fish_casts.state`); aynı atış için ikinci `reel` saklı sonucu döner (`already`),
  jeton satırı `walk:fish:<cast_id>` anahtarıyla `INSERT OR IGNORE` (yarışta da çift ödeme yok); `client_request_id` + parmak
  izi diğer yürüme uçlarıyla aynı.
- Aynı anda tek açık atış: yeni atış öncekini `abandoned` yapar (paralel atışla çiftleme yok); atışlar arası en az
  `CAST_MIN_INTERVAL_S`.
- Yönetici modu ve kilitli sahnenin yaratıcı/yönetici görüntülemesi: oyun oynanır, jeton yok (`reason: "admin"/"creative"`).
- Erişilebilirlik (`assist: true`, hareket azaltma): pencere `ASSIST_WINDOW_MS`; ödül aynı (vuruş beklemesi hızı belirler).
"""

from __future__ import annotations

import json
import random
import secrets
import time
from typing import TYPE_CHECKING, Any

from studio._edition import EDITION
from studio.cities import NEW_CITY_CATALOGS
from studio.game import rules as R
from studio.walk import catalog as W
from studio.walk import minigame as MG

if TYPE_CHECKING:
    from studio.game.db import GameDB
    from studio.walk.service import WalkService

FISH_SCHEMA = """
CREATE TABLE IF NOT EXISTS walk_fish_casts (
  cast_id TEXT PRIMARY KEY, world TEXT NOT NULL, biome TEXT NOT NULL, ts REAL NOT NULL, day TEXT NOT NULL,
  bite_ms INTEGER NOT NULL, window_ms INTEGER NOT NULL, assist INTEGER NOT NULL DEFAULT 0, fish TEXT NOT NULL,
  pay TEXT, state TEXT NOT NULL DEFAULT 'open', coins INTEGER NOT NULL DEFAULT 0, reel_ts REAL, response TEXT);
CREATE INDEX IF NOT EXISTS ix_walk_fish_day ON walk_fish_casts(day, state);
"""

# ---------------------------------------------------------------- katalog (frontend voxel/fun/minigameLogic.ts ile aynı)
TIERS: tuple[str, ...] = ("junk", "common", "uncommon", "rare", "legendary")
TIER_WEIGHTS: dict[str, int] = {"junk": 3, "common": 55, "uncommon": 27, "rare": 12, "legendary": 3}
TIER_COINS: dict[str, int] = {"junk": 0, "common": 2, "uncommon": 3, "rare": 6, "legendary": 12}
# tür → kademe (kart nadirliği W.FISH'te: nadir/efsane → "rare", diğerleri "common")
SPECIES_TIER: dict[str, str] = {
    "cizme": "junk",
    "hamsi": "common", "istavrit": "common", "sazan": "common", "palyaco": "common", "morina": "common",
    "cupra": "uncommon", "levrek": "uncommon", "alabalik": "uncommon", "cerrah": "uncommon", "somon": "uncommon",
    "palamut": "rare", "lufer": "rare", "japon": "rare", "turna": "rare", "papagan": "rare", "yilan_baligi": "rare",
    "koi": "rare", "kalkan": "rare",
    "orkinos": "legendary", "yayin": "legendary",
}
# biyom → kademe → türler (her biyomda her kademe dolu; çöp her yerde eski çizme)
BIOMES: dict[str, dict[str, tuple[str, ...]]] = {
    "sea": {"common": ("hamsi", "istavrit"), "uncommon": ("cupra", "levrek"), "rare": ("palamut", "lufer", "kalkan"),
            "legendary": ("orkinos",)},
    "lake": {"common": ("sazan",), "uncommon": ("alabalik",), "rare": ("japon", "turna", "koi"), "legendary": ("yayin",)},
    "river": {"common": ("sazan",), "uncommon": ("alabalik",), "rare": ("turna", "yilan_baligi"), "legendary": ("yayin",)},
    "reef": {"common": ("palyaco",), "uncommon": ("cerrah",), "rare": ("papagan",), "legendary": ("orkinos",)},
    "arctic": {"common": ("morina",), "uncommon": ("somon",), "rare": ("kalkan",), "legendary": ("orkinos",)},
}
# sahne → açık su biyomu (gölet kıyısı her sahnede `lake`); bilinmeyen/kullanıcı dünyası: açık su `sea`
SCENE_BIOME: dict[str, str] = {
    "beach": "sea", "sea": "sea", "yacht": "sea", "istanbul": "sea", "londra": "river", "snow": "arctic",
    "park": "lake", "camp": "lake", "home": "lake", "kapadokya": "lake", "office": "lake",
    "cafe": "lake", "mall": "lake", "school": "lake", "battlefield": "lake", "space": "lake",
}
if EDITION == "full":  # kaldırılan şehir/premium sahnelerin biyomları, özgün sırayla (studio/full)
    from studio.full.walk_misc import merge_scene_biome
    SCENE_BIOME = merge_scene_biome(SCENE_BIOME)
# yeni şehirler (dizin) catalog.json `fish_biome` alanından (varsayılan "sea"); ön yüz minigameLogic.ts aynı alanı okur
CITY_FISH_BIOME: dict[str, str] = {cid: c.get("fish_biome", "sea") for cid, c in NEW_CITY_CATALOGS.items()}
SCENE_BIOME.update(CITY_FISH_BIOME)
WATERS = ("pond", "open")

FISH_COINS_PER_DAY = 30
FULL_CATCHES = 6                     # günün ilk 6 ödenen yakalaması tam
HALF_CATCHES = 8                     # sonraki 8'i yarım, sonrası çeyrek (en az 1)
BITE_MS = (2200, 5200)               # atıştan vuruşa (atış yayı dahil)
WINDOW_MS = 1400                     # çekme penceresi
ASSIST_WINDOW_MS = 3200              # hareket azaltma / erişilebilirlik
EARLY_SLACK_MS = 60                  # saat yuvarlama payı (istemci vuruşu sunucudan önce göremez)
LATE_SLACK_MS = 1200                 # ağ gidiş-dönüş payı (istemci vuruşu yanıt geldikten sonra sayar)
CAST_MIN_INTERVAL_S = 0.8


def ensure_schema(db: "GameDB") -> None:
    if getattr(db, "_fish_schema", False):
        return
    with db._lock:
        db.conn.executescript(FISH_SCHEMA)
        db._fish_schema = True  # type: ignore[attr-defined]


def biome_of(world: str, water: str) -> str:
    if water == "pond":
        return "lake"
    return SCENE_BIOME.get(world, "sea")


def pick_fish(biome: str, rnd: random.Random | random.SystemRandom) -> str:
    """Kademe (her biyomda aynı olasılık) → biyomun o kademedeki türlerinden biri."""
    table = BIOMES[biome]
    roll = rnd.randrange(sum(TIER_WEIGHTS.values()))
    tier = TIERS[-1]
    for t in TIERS:
        roll -= TIER_WEIGHTS[t]
        if roll < 0:
            tier = t
            break
    if tier == "junk":
        return "cizme"
    species = table[tier]
    return species[rnd.randrange(len(species))]


def reward_for(tier: str, paid_before: int, used: int) -> tuple[int, str | None]:
    """(jeton, neden). `paid_before`: bugün ödenen yakalama sayısı; `used`: bugün ödenen balık jetonu."""
    base = TIER_COINS[tier]
    if base <= 0:
        return 0, "junk"
    if paid_before < FULL_CATCHES:
        amount = base
    elif paid_before < FULL_CATCHES + HALF_CATCHES:
        amount = max(1, base // 2)
    else:
        amount = max(1, base // 4)
    room = FISH_COINS_PER_DAY - used
    if room <= 0:
        return 0, "daily_cap"
    if amount > room:
        return room, "daily_cap"
    return amount, None


def today(db: "GameDB", day: str) -> dict[str, int]:
    used = MG.pool_used(db, day)   # (K3): ortak günlük mini oyun havuzu (olta dahil, tavan 30)
    paid = int(db.scalar("SELECT COUNT(*) FROM walk_fish_casts WHERE day=? AND state='caught' AND coins>0", day))
    catches = int(db.scalar("SELECT COUNT(*) FROM walk_fish_casts WHERE day=? AND state='caught'", day))
    return {"coins_used": used, "max": FISH_COINS_PER_DAY, "paid_catches": paid, "catches": catches}


def public() -> dict[str, Any]:
    """Katalog özeti (GET /api/walk/fish/catalog): kademe tablosu, biyomlar, sınırlar."""
    return {"tiers": list(TIERS), "tier_weights": TIER_WEIGHTS, "tier_coins": TIER_COINS, "species": SPECIES_TIER,
            "biomes": {b: {t: list(s) for t, s in v.items()} for b, v in BIOMES.items()}, "scene_biome": SCENE_BIOME,
            "limits": {"coins_per_day": FISH_COINS_PER_DAY, "full_catches": FULL_CATCHES, "half_catches": HALF_CATCHES,
                       "window_ms": WINDOW_MS, "assist_window_ms": ASSIST_WINDOW_MS, "bite_ms": list(BITE_MS)}}


def state(svc: "WalkService") -> dict[str, Any]:
    g = svc.game
    ensure_schema(g.db)
    day = R.day_of(time.time())
    return {"today": today(g.db, day), "balance": g.db.balance(), "admin": g.admin()}


# ---------------------------------------------------------------- yazma
def _world(data: dict[str, Any]) -> str:
    from studio.walk.service import WalkError
    world = data.get("world")
    if not W.valid_world(world):
        raise WalkError(400, "Geçersiz dünya kimliği")
    return str(world)


def cast(svc: "WalkService", data: dict[str, Any], *, rnd: random.Random | random.SystemRandom | None = None,
         now: float | None = None) -> dict[str, Any]:
    from studio.walk.service import WalkError
    world = _world(data)
    water = data.get("water", "open")
    if water not in WATERS:
        raise WalkError(400, "water pond ya da open olmalı")
    assist = data.get("assist", False)
    if not isinstance(assist, bool):
        raise WalkError(400, "assist doğru/yanlış olmalı")
    rid = svc._rid(data, "fish_cast")
    fp = svc._fp("fish_cast", world, water, assist)
    g = svc.game
    ensure_schema(g.db)
    # sahne kapısı: gerçek sahip → ödüllü; görüntüleme atlaması → oynanır, ödülsüz; kilitli → 403
    if W.is_scene(world):
        bypass = svc._gate(g, world)
    else:
        bypass = "admin" if g.admin() else None
    svc._rate()
    rnd = rnd or random.SystemRandom()
    now = time.time() if now is None else now
    day = R.day_of(now)
    biome = biome_of(world, str(water))
    with g._lock:
        with g.db.tx():
            prior = svc._replayed(g.db, rid, fp)
            if prior is not None:
                return prior
            last = g.db.scalar("SELECT MAX(ts) FROM walk_fish_casts")
            if last is not None and 0 <= now - float(last) < CAST_MIN_INTERVAL_S:
                raise WalkError(429, "Olta çok sık atılıyor; biraz bekle")
            # aynı anda tek açık atış: öncekiler bırakılır (paralel atışla çiftleme yok)
            g.db.exec("UPDATE walk_fish_casts SET state='abandoned', reel_ts=? WHERE state='open'", now)
            cast_id = f"fc_{secrets.token_hex(8)}"
            bite = rnd.randint(*BITE_MS)
            window = ASSIST_WINDOW_MS if assist else WINDOW_MS
            fish = pick_fish(biome, rnd)
            g.db.exec("INSERT INTO walk_fish_casts(cast_id,world,biome,ts,day,bite_ms,window_ms,assist,fish,pay,state) "
                      "VALUES(?,?,?,?,?,?,?,?,?,?,'open')", cast_id, world, biome, now, day, bite, window,
                      1 if assist else 0, fish, bypass)
            svc._touch(g.db, now)
            resp = {"ok": True, "cast_id": cast_id, "world": world, "biome": biome, "bite_ms": bite, "window_ms": window,
                    "assist": assist, "paid_mode": bypass is None, "reason": bypass, "today": today(g.db, day),
                    "balance": g.db.balance(), "admin": bypass == "admin"}
            svc._remember(g.db, rid, resp, now, fp)
    return {**resp, "events": []}


def reel(svc: "WalkService", data: dict[str, Any], *, now: float | None = None) -> dict[str, Any]:
    """Çekiş: sonuç YALNIZ sunucu saatinden; istemcinin gönderdiği tür/miktar/sonuç alanları yok sayılır."""
    from studio.walk.service import WalkError, _human
    cast_id = data.get("cast_id")
    if not isinstance(cast_id, str) or not cast_id.startswith("fc_") or len(cast_id) > 40:
        raise WalkError(400, "cast_id gerekli")
    rid = svc._rid(data, "fish_reel")
    fp = svc._fp("fish_reel", cast_id)
    g = svc.game
    ensure_schema(g.db)
    svc._rate()
    now = time.time() if now is None else now
    events: list[tuple[str, dict[str, Any]]] = []
    with g._lock:
        with g.db.tx():
            prior = svc._replayed(g.db, rid, fp)
            if prior is not None:
                return prior
            row = g.db.one("SELECT * FROM walk_fish_casts WHERE cast_id=?", cast_id)
            if row is None:
                raise WalkError(404, "Atış bulunamadı")
            if row["state"] != "open":
                # atış başına tek sonuç: saklı yanıt (yeniden ödeme yok)
                if row["response"]:
                    return {**json.loads(row["response"]), "already": True, "events": []}
                raise WalkError(409, "Bu atış kapandı; yeniden at")
            elapsed = (now - float(row["ts"])) * 1000.0
            bite, window = int(row["bite_ms"]), int(row["window_ms"])
            if elapsed < bite - EARLY_SLACK_MS:
                result = "early"
            elif elapsed > bite + window + LATE_SLACK_MS:
                result = "late"
            else:
                result = "caught"
            day = R.day_of(float(row["ts"]))
            fish = str(row["fish"])
            tier = SPECIES_TIER.get(fish, "common")
            coins, reason = 0, None
            bypass = row["pay"]
            if result == "caught":
                if bypass:
                    reason = str(bypass)
                else:
                    t = today(g.db, day)
                    coins, reason = reward_for(tier, t["paid_catches"], t["coins_used"])
                    # anahtar atış başına: yarışta da çift ödeme yok
                    if coins and not g.db.add_coins(f"walk:fish:{cast_id}", now, day, coins, "walk",
                                                    f"Olta: {fish} (+{coins} jeton)", ref=f"fish:{fish}"):
                        coins = 0   # anahtar zaten yazılmış (olası değil: atış açıktı) — çift ödeme yok
                    if coins:
                        g.db.feed(now, "walk", *_human(), f"Balık yakalandı: {fish} (+{coins} jeton)", coins,
                                  {"world": row["world"], "fish": fish, "tier": tier})
                        events = g._drain()
            # atış kapanır (tek sonuç); bugünün özeti bu satırdan SONRA okunur
            g.db.exec("UPDATE walk_fish_casts SET state=?, coins=?, reel_ts=? WHERE cast_id=? AND state='open'",
                      result, coins, now, cast_id)
            resp = {"ok": True, "already": False, "cast_id": cast_id, "result": result,
                    "fish": ({"id": fish, "tier": tier, "card": f"fish:{fish}"} if result == "caught" else None),
                    "coins": coins, "paid": coins > 0, "reason": reason, "balance": g.db.balance(),
                    "today": today(g.db, day), "admin": bypass == "admin"}
            g.db.exec("UPDATE walk_fish_casts SET response=? WHERE cast_id=?", json.dumps(resp, ensure_ascii=False), cast_id)
            svc._touch(g.db, now)
            svc._remember(g.db, rid, resp, now, fp)
    if coins:
        events.append(("walk.fish", {"fish": fish, "tier": tier, "coins": coins, "balance": resp["balance"]}))
    return {**resp, "events": events}
