"""şehir dizini: yeni dünya şehirlerinin `catalog.json` kayıtları.

Kaynak: `frontend/src/voxel/cities/<id>/catalog.json` (ön yüz AYNI dosyayı okur; `frontend/scripts/cities.mjs` aynı şemayı
denetler). Paylaşılan listeler (api.SCENES, walk/catalog.py SCENES/LANDMARKS, walk/explore.py CATALOG/CITY_CATALOG,
walk/rituals.py CATALOG/TITLES, worlds/validate.py ANNEX_IDS, game/catalog.py SCENE_PACKS/SHOP) bu modülden BİR KEZ genişletilir;
şehir ekibi o dosyalara dokunmaz.

- Sıra: `order`, eşitlikte kimlik (ön yüz `NEW_CITIES` ile aynı).
- Kaynak klasör yoksa (ör. yalnız arka uç kurulu paket) şehir yoktur: bugünkü davranış aynen sürer.
- `STUDIO_DEV_CITY_FIXTURE=1` (yalnız geliştirme/test): `frontend/scripts/fixtures/cities/*` örnek şehri de yüklenir.
- Geçersiz kayıt sessizce atlanmaz: `CityIndexError` (ValueError; yanlış veri sunucuyu ürün gibi açmasın; `cities.mjs` aynı hatayı CI'da verir).

Bağımlılık yok; saf JSON okuma.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
CITIES_DIR = ROOT / "frontend" / "src" / "voxel" / "cities"
FIXTURE_DIR = ROOT / "frontend" / "scripts" / "fixtures" / "cities"
FIXTURE_ENV = "STUDIO_DEV_CITY_FIXTURE"

ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,23}$")
TITLE_RE = re.compile(r"^[a-z][a-z0-9_]{1,31}$")
REGIONS = ("europe", "asia", "middle_east", "africa", "americas", "oceania")
RARITY = ("common", "rare", "epic", "legendary")
# olta açık su biyomu (walk/fishing.py BIOMES = ön yüz FishBiome); `fish_biome` isteğe bağlı, varsayılan "sea"
FISH_BIOMES = ("sea", "lake", "river", "reef", "arctic")
REQUIRED_FILES = ("catalog.json", "manifest.ts", "scene.ts", "style.ts", "map.ts", "rituals.ts", "locale.ts")


class CityIndexError(ValueError):
    """Şehir dizini geçersiz (başlangıç/CI tanısı; kullanıcıya dönen ileti değil): sorun listesi taşır, metin `__str__`'de."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__(problems)
        self.problems = problems

    def __str__(self) -> str:
        return "şehir dizini geçersiz: " + "; ".join(self.problems)


def fixture_enabled() -> bool:
    return os.environ.get(FIXTURE_ENV) == "1"


def catalog_issues(c: Any, folder: str) -> list[str]:
    """Şema denetimi (ön yüz `scripts/cities.mjs catalogIssues` ile aynı kurallar)."""
    bad: list[str] = []

    def is_obj(v: Any) -> bool:
        return isinstance(v, dict)

    def str_list(v: Any) -> bool:
        return isinstance(v, list) and all(isinstance(x, str) and x for x in v)

    if not is_obj(c):
        return [f"{folder}: catalog.json nesne değil"]
    if not isinstance(c.get("id"), str) or not ID_RE.match(c["id"]):
        bad.append(f"{folder}: id biçimi")
    if c.get("id") != folder:
        bad.append(f"{folder}: id klasör adıyla aynı değil")
    if not isinstance(c.get("order"), int) or isinstance(c.get("order"), bool) or c["order"] < 0:
        bad.append(f"{folder}: order")
    if c.get("region") not in REGIONS:
        bad.append(f"{folder}: region")
    if c.get("size") not in ("S", "M"):
        bad.append(f"{folder}: size")
    ip = c.get("ip")
    if not is_obj(ip) or ip.get("ip_risk") not in (0, 1) or ip.get("culture_risk") not in (0, 1):
        bad.append(f"{folder}: ip")
    s = c.get("shop")
    if (not is_obj(s) or not isinstance(s.get("pack"), str) or not isinstance(s.get("price"), int) or s["price"] <= 0
            or s.get("rarity") not in RARITY or s.get("earn") != "stamp"
            or not all(isinstance(s.get(k), str) and s[k].strip() for k in ("label_tr", "label_en", "description_tr", "description_en"))):
        bad.append(f"{folder}: shop")
    if not str_list(c.get("scene_landmarks")):
        bad.append(f"{folder}: scene_landmarks")
    e = c.get("explore")
    if not is_obj(e) or not is_obj(e.get("sites")) or not isinstance(e.get("poi"), int) or not isinstance(e.get("gz"), int):
        bad.append(f"{folder}: explore")
    city = c.get("city")
    if not is_obj(city) or city.get("scene") != c.get("id") or not is_obj(city.get("districts")) or not str_list(city.get("stops", [])):
        bad.append(f"{folder}: city")
    elif city.get("test"):
        bad.append(f"{folder}: city.test")
    r = c.get("rituals")
    if not str_list(r) or len(set(r)) != len(r):
        bad.append(f"{folder}: rituals")
    if not isinstance(c.get("ritual_title"), str) or not TITLE_RE.match(c["ritual_title"]):
        bad.append(f"{folder}: ritual_title")
    if "fish_biome" in c and c["fish_biome"] not in FISH_BIOMES:
        bad.append(f"{folder}: fish_biome")
    bl = c.get("ip_blocklist")
    if not str_list(bl) or any(n != n.lower() or len(n.strip()) < 3 for n in bl):
        bad.append(f"{folder}: ip_blocklist")
    return bad


def load(roots: list[Path] | None = None) -> dict[str, dict[str, Any]]:
    """Kök klasörlerdeki şehir kayıtları (sıralı sözlük: `order`, sonra kimlik)."""
    if roots is None:
        roots = [CITIES_DIR, *([FIXTURE_DIR] if fixture_enabled() else [])]
    found: list[dict[str, Any]] = []
    problems: list[str] = []
    for root in roots:
        if not root.is_dir():
            continue
        for d in sorted(p for p in root.iterdir() if p.is_dir()):
            missing = [f for f in REQUIRED_FILES if not (d / f).is_file()]
            if missing:
                problems.append(f"{d.name}: eksik dosya {', '.join(missing)}")
                continue
            c = json.loads((d / "catalog.json").read_text("utf-8"))
            problems.extend(catalog_issues(c, d.name))
            found.append(c)
    ids = [c["id"] for c in found]
    if len(set(ids)) != len(ids):
        problems.append("yinelenen şehir kimliği")
    if problems:
        raise CityIndexError(problems)
    found.sort(key=lambda c: (c["order"], c["id"]))
    return {c["id"]: c for c in found}


NEW_CITY_CATALOGS: dict[str, dict[str, Any]] = load()
NEW_CITY_IDS: tuple[str, ...] = tuple(NEW_CITY_CATALOGS)


def check_collisions(builtin: tuple[str, ...] | list[str]) -> None:
    """Yeni şehir kimliği yerleşik bir sahneyle çakışamaz (paylaşılan listeler genişletilirken çağrılır)."""
    clash = sorted(set(NEW_CITY_IDS) & set(builtin))
    if clash:
        raise CityIndexError([f"yerleşik sahneyle çakışan kimlik {c}" for c in clash])
