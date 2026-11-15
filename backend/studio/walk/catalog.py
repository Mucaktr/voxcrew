"""Yürüme modu W4 kataloğu: sahneler, hatıralar, simge vizeleri, mini oyun kartları.

Her şey SABİT ve sonludur; istemci yalnızca bu listelerdeki kimlikleri gönderebilir (rastgele kimlik yok):
- Hatıra: sahne başına 5 tane, `<sahne>:h1` … `<sahne>:h5`. Konumları istemci `souvenirSpots(base, sahne)` ile
  deterministik üretir (frontend/src/voxel/walk/controller.ts); kimlik sırası yerleşim sırasıdır.
- Simge vizesi: `<sahne>:<etiket>`. Etiketler sahnenin `landmark` bölgelerinin `tag` alanıdır
  (frontend/src/voxel/worlds/*.json `zones`; test_walk.py sapmayı denetler). Vize koleksiyondur; şehir AÇMAZ.
- Kart: `fish:<tür>`, `board`, `toss` (frontend/src/voxel/fun/minigameLogic.ts ALL_CARDS). Kart eşitlemesi (`/cards`) kozmetiktir:
  jeton/XP yok. WORLD-FIX: olta jetonu yalnız sunucu yetkili yakalamadan gelir (walk/fishing.py, `/fish/cast` + `/fish/reel`).

Ekonomi sabitleri (§6.1, karar D2 A): kalıcı durumda yürüme geliri ≤ ~20 jeton/gün; yürümek ve beklemek hiçbir şey vermez.
"""

from __future__ import annotations

import re

from studio._edition import EDITION
from studio.cities import NEW_CITY_CATALOGS, NEW_CITY_IDS, check_collisions

# yerleşik sahneler (frontend/src/voxel/scenes.ts SCENE_ORDER ile aynı sıra; kaldırılan şehir/premium sahneler studio/full)
SCENES: tuple[str, ...] = (
    "office", "park", "home", "beach", "cafe", "camp", "mall", "school", "battlefield", "sea", "yacht", "space", "snow",
    "istanbul", "kapadokya", "londra",
)
if EDITION == "full":
    from studio.full.walk_catalog import SCENES  # noqa: E402 - tam sürümün özgün sahne sırası (25 sahne)
check_collisions(SCENES)
SCENES = (*SCENES, *NEW_CITY_IDS)  # yeni dünya şehirleri (ön yüz SCENE_ORDER `...NEW_CITY_IDS` ile aynı sıra)
SOUVENIRS_PER_SCENE = 5

# Sahne → simge etiketleri (taban dünya `landmark` bölgeleri). Simgesi olmayan sahnede vize yoktur.
LANDMARKS: dict[str, tuple[str, ...]] = {
    "istanbul": ("ayasofya", "sultanahmet", "galata", "bosphorus_bridge", "maiden_tower"),
    "kapadokya": ("balloon_field", "castle", "open_air_museum", "fairy_chimneys", "zelve"),
    "londra": ("parliament", "clocktower", "wheel", "bascule", "palace", "memorial", "column", "keep"),
    # yeni şehirlerin simge vizeleri (catalog.json `scene_landmarks`)
    **{c: tuple(v["scene_landmarks"]) for c, v in NEW_CITY_CATALOGS.items() if v["scene_landmarks"]},
}
if EDITION == "full":
    from studio.full.walk_catalog import merge_landmarks
    LANDMARKS = merge_landmarks(LANDMARKS)

# Mini oyun kartları (kimlik → (tür, nadirlik)); yalnızca koleksiyon albümünü doldurur
FISH: tuple[tuple[str, str], ...] = (
    ("hamsi", "common"), ("istavrit", "common"), ("cupra", "common"), ("sazan", "common"), ("levrek", "common"),
    ("alabalik", "common"), ("palamut", "rare"), ("lufer", "rare"), ("japon", "rare"), ("cizme", "common"),
    # WORLD-FIX: biyom türleri (olta jetonu kademesi walk/fishing.py SPECIES_TIER; kart nadirliği yalnız albüm içindir)
    ("palyaco", "common"), ("morina", "common"), ("cerrah", "common"), ("somon", "common"), ("turna", "rare"),
    ("papagan", "rare"), ("yilan_baligi", "rare"), ("koi", "rare"), ("kalkan", "rare"), ("orkinos", "rare"),
    ("yayin", "rare"),
)
CARDS: dict[str, tuple[str, str]] = {
    **{f"fish:{fid}": ("fish", rarity) for fid, rarity in FISH},
    "board": ("board", "common"),   # masa oyununda (üç taş) galibiyet
    "toss": ("toss", "rare"),        # atışta tam isabet
}
CARD_MAX = 999                       # kart başına adet tavanı (istemciyle aynı)

# ---------------------------------------------------------------- ekonomi ve sınırlar
SOUVENIR_COINS = 5                   # hatıra başına tek seferlik (25 sahne × 5 × 5 = en çok 625 jeton, ömür boyu)
SOUVENIR_COINS_PER_DAY = 20          # günde en çok 4 jetonlu hatıra; sonrası kaydedilir ama jeton 0
CARDS_PER_DAY = 40                   # günlük kart artışı tavanı (ilk eşitleme/taşıma hariç)
RUN_FRESH_S = 120                    # "görev başlat" olayı: koşu en çok bu kadar saniye önce başlamış olmalı
WRITES_PER_MIN = 60                  # konum dışı yazma uçları (mevcut `signal` deseni)
POSITION_MIN_INTERVAL_S = 1.0        # dünya başına konum yazımı en çok saniyede 1
COORD_LIMIT = 10_000.0
VIEWS = ("third", "first")
EVENT_TYPES = ("run_started", "deliverable_viewed")
WALK_ACTIVE_DAYS = 7                 # `requires: walk` görevleri: son 7 günde yürüme modu kullanıldıysa

_WORLD_RE = re.compile(r"^[a-z0-9][a-z0-9_.:-]{0,63}$")


def souvenir_ids(scene: str) -> tuple[str, ...]:
    if scene not in SCENES:
        return ()
    return tuple(f"{scene}:h{i}" for i in range(1, SOUVENIRS_PER_SCENE + 1))


def landmark_ids(scene: str) -> tuple[str, ...]:
    return tuple(f"{scene}:{tag}" for tag in LANDMARKS.get(scene, ()))


ALL_SOUVENIRS: frozenset[str] = frozenset(i for s in SCENES for i in souvenir_ids(s))
ALL_LANDMARKS: frozenset[str] = frozenset(i for s in SCENES for i in landmark_ids(s))


def valid_world(world: object) -> bool:
    """Konum anahtarı: yerleşik sahne kimliği ya da kullanıcı dünyası kimliği (küçük harf, ≤ 64)."""
    return isinstance(world, str) and bool(_WORLD_RE.match(world))


def is_scene(world: object) -> bool:
    return isinstance(world, str) and world in SCENES


def public() -> dict[str, object]:
    """GET /api/walk/catalog gövdesi."""
    return {
        "scenes": {s: {"souvenirs": list(souvenir_ids(s)), "landmarks": list(landmark_ids(s))} for s in SCENES},
        "cards": [{"id": cid, "kind": kind, "rarity": rarity} for cid, (kind, rarity) in CARDS.items()],
        "rewards": {"souvenir_coins": SOUVENIR_COINS, "souvenir_coins_per_day": SOUVENIR_COINS_PER_DAY,
                    "visa_coins": 0, "card_coins": 0, "card_xp": 0},
        "limits": {"cards_per_day": CARDS_PER_DAY, "run_fresh_s": RUN_FRESH_S, "writes_per_min": WRITES_PER_MIN,
                   "position_min_interval_s": POSITION_MIN_INTERVAL_S},
        "totals": {"souvenirs": len(ALL_SOUVENIRS), "landmarks": len(ALL_LANDMARKS), "cards": len(CARDS)},
    }
