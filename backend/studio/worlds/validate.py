"""`voxcrew-world.json` v1 / v1.1 doğrulaması ve kanonik özet (Faz 7a, S30) —

Arayüzdeki `frontend/src/voxel/worldFormat.ts` `validateWorld` ile aynı kodları üretir: şema (tür, renk, grup, sayı
aralığı, güvensiz metin), prefab ayak izi (yol bulma engelleri) ve navigasyon (istasyon/dinlenme yürünebilir, tek bağlı
bileşende; blok bütçesi). Blok sayısı burada prefab başına ÜST SINIR ile hesaplanır (arayüz kesin sayıyı pişirerek
bulur). İletiler Türkçedir; İngilizce karşılıkları `studio/locales/en.py`'dedir. Her sorun mümkünse karoyu (`tile`)
ve prefab sırasını (`prefab`) taşır ki editör sorunlu karoyu vurgulasın.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import deque
from decimal import Decimal
from typing import Any

from studio._edition import EDITION
from studio.cities import NEW_CITY_IDS

FORMAT = "voxcrew-world"
VERSION = 1
# SP-W1 — biçim v1.1 (geriye uyumlu ek; arayüzdeki worldFormat.ts ile aynı): `env.weather` listesi, `env.time`, `zones`
# (sacred/quiet/landmark), `layers.backdrop` (ufuk silüeti, ≤ 1200 kutu — SCENE-BACKDROP-001), `layers.movers` (≤ 12
# nesne, ≤ 400 kutu — SCENE-MOVER-001), `nav.open` (köprü gibi engeli kaldırılan karolar). Biri doluysa sürüm 1.1 olmalı.
VERSION_11 = 1.1
# E3 — biçim v1.2: `expanse` (tohum, biyom, keşif yarıçapı, parsel gövdeleri, blok paleti).
# v1.1'in üst kümesi; `expanse` doluysa sürüm 1.2 olmalı. Parsel gövdesi E3 kurallarıyla (studio/expanse/build.py) doğrulanır.
VERSION_12 = 1.2
# biçim v1.3: `city_map` (şehir haritası: varış meydanı, semtler, landmark yerleşimleri,
# duraklar, ulaşım hatları). v1.2'nin üst kümesi; `city_map` doluysa sürüm 1.3 olmalı (studio/worlds/citymap.py). v1–v1.2 aynı.
VERSION_13 = 1.3
VERSIONS = (VERSION, VERSION_11, VERSION_12, VERSION_13)
MAX_BACKDROP = 1200
MAX_ZONES = 16
MAX_MOVERS = 12
MAX_MOVER_BOXES = 400
MAX_OPEN = 256
# W2-INT — v1.1 `layers.glows`: prefab'tan türemeyen gece parıltı işaretleri (şehir kiti pencere/lamba; AVM/okul pencereleri)
# [tür, x, y, z, r, w, h, renk]; ≤ 512 (worldFormat.ts MAX_GLOWS / isGlow ile aynı)
MAX_GLOWS = 512
GLOW_KINDS = ("window", "lamp")
WEATHER_KINDS = ("rain", "snow", "mist", "bubbles", "embers", "aurora", "petals")  # W2b-INT: petals (kiraz yaprağı)
SCENE_TIMES = ("auto", "day", "night")
ZONE_KINDS = ("sacred", "quiet", "landmark", "hotel")  # HOTEL-SYS (E1): şehrin tek otelinin dış kabuğu
ZONE_TAG_RE = re.compile(r"^[a-z][a-z0-9_]{0,23}$")
# Hareketli şekil başına kutu sayısı (frontend/src/voxel/props/movers.ts SHAPES; eşlik testi: test_scene_packs.py)
# VEHICLE-DETAIL (kalite D2): araç şekilleri ayrıntılandı — kapı, far/stop, tampon, boji, korkuluk, filika, lateen yelken; şekil
# başına ≤ 40, sahne tavanı 400 aynı (en kalabalık sahne: 6 taksi + 3 tekne + vapur = 207)
MOVER_BOXES = {"ferry": 33, "tram": 32, "bus": 40, "airship": 23, "balloon": 16, "boat": 16, "felucca": 15, "cablecar": 19,
               "submarine": 17, "train": 34, "manta": 8, "fish_school": 12,
               "taxi": 21, "drone": 6, "skiplane": 14}  # W3a-INT: dron, kayaklı uçak
GRID_W = 24
BASE_D = 16
MAX_D = 32
MAX_BLOCKS = 6000
# CITY-BIG — çekirdekli (`grid.core`) büyük şehir tabanı (24×16'dan büyük bölge katı: genişlik 12'nin katı ≤ 48, derinlik 16
# ya da 32): blok ve ufuk tavanı (worldFormat.ts MAX_BLOCKS_BIG / MAX_BACKDROP_BIG; kurallar CORE-BUDGET-001 / SCENE-BACKDROP-001)
MAX_BLOCKS_BIG = 12000
MAX_BACKDROP_BIG = 1600
MAX_GRID_W_BIG = 48
MAX_PREFABS = 4000
MAX_LIGHTS = 8
TOOL_KINDS = ("web", "read", "plan", "shell", "write")
ANNEX_IDS = ("office", "park", "home", "beach", "cafe", "camp", "battlefield", "sea", "yacht", "space", "snow", "mall", "school",
             "istanbul", "londra", "kapadokya",
             *NEW_CITY_IDS)  # yeni dünya şehirleri
if EDITION == "full":  # kaldırılan şehir ve premium sahneler dahil tam liste (studio/full)
    from studio.full.scene_lists import ANNEX_IDS as _FULL_ANNEX
    ANNEX_IDS = (*_FULL_ANNEX, *NEW_CITY_IDS)
LICENSES = ("CC-BY-4.0", "CC-BY-NC-4.0", "CC0-1.0", "VoxCrew-Pack-1.0", "All-Rights-Reserved", "MIT", "LicenseRef-PolyForm-Shield-1.0.0")
GROUPS = ("solid", "glow", "water", "glass", "cloud", "flame", "wave", "bob", "flag", "snow", "spin")
# `spin` (dönen yapı) yalnız decor parçasında, 10. alandaki dönüş tanımıyla; cube ve ufuk dönüş taşımaz
STATIC_GROUPS = tuple(g for g in GROUPS if g != "spin")
SPIN_AXES = ("x", "y", "z")
SPIN_PART_KEYS = ("a", "o", "w", "ph", "k", "e")
MAX_SPIN_BLOCKS = 600
MAX_SPIN_SPEED = 3
MAX_SPIN_PHASE = 7
MAX_SPIN_RADIUS = 16
ATMOSPHERE = ("cloud", "flowers", "snowfall")

HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
ID_RE = re.compile(r"^(w_[a-z0-9]{6,32}|[a-z][a-z0-9_-]{1,31})$")
USER_ID_RE = re.compile(r"^w_[a-z0-9]{6,32}$")
UNSAFE = re.compile(r"<|>|\b(?:javascript|data|vbscript):|://", re.IGNORECASE)

# Prefab alan şeması (arayüzdeki FIELDS ile aynı); "?" isteğe bağlı alan.
FIELDS: dict[str, dict[str, str]] = {
    "cube": {"i": "int", "j": "int", "y": "num", "h?": "num", "c": "color", "g?": "group", "jit?": "num", "solid?": "bool"},
    "decor": {"i": "int", "j": "int", "parts": "parts", "cells?": "cells", "free?": "bool"},
    "block": {"i": "int", "j": "int"},
    "desk": {"i": "int", "j": "int", "w": "int", "top": "color", "legs": "color", "bare?": "bool"},
    "plant": {"i": "int", "j": "int"}, "pine": {"i": "int", "j": "int"}, "palm": {"i": "int", "j": "int"},
    "snowyPine": {"i": "int", "j": "int"}, "snowman": {"i": "int", "j": "int"}, "campfire": {"i": "int", "j": "int"},
    "tree": {"i": "int", "j": "int", "h": "int"},
    "lantern": {"i": "int", "j": "int", "glow": "color", "post": "color"},
    "terminal": {"i": "int", "j": "int", "glow": "glow"},
    "flag": {"i": "int", "j": "int", "c": "color", "h": "num", "emblem?": "color"},
    "wall": {"i": "int", "j": "int", "len": "int", "h": "int", "axis": "axis", "c?": "color", "colors?": "colors", "win?": "win"},
    "sandbags": {"i": "int", "j": "int", "len": "int", "axis": "axis", "layers": "int"},
    "sea": {"i": "int", "j": "int", "c": "color", "top": "num", "blocking": "bool"},
    "crate": {"i": "int", "j": "int", "c": "color", "s": "num"},
    "table": {"i": "int", "j": "int", "top": "color"},
    "bookshelf": {"i": "int", "j": "int", "c": "color"},
    "sofa": {"i": "int", "j": "int", "c": "color", "back": "color"},
    "lamp": {"i": "int", "j": "int", "glow": "color", "desk?": "bool", "dx?": "num", "dz?": "num"},
    "rock": {"i": "int", "j": "int", "c": "color"},
    "cloud": {"x": "num", "y": "num", "z": "num", "seed": "int"},
    "flowers": {"n": "int", "seed": "int", "mask": "mask"},
    "snowfall": {"n": "int", "seed": "int"},
    # S33 canlı dekor (arayüz prefabs.ts / worldFormat.ts ile aynı)
    "monitor": {"i": "int", "j": "int", "face": "dir", "dx?": "num", "dz?": "num", "y?": "num"},
    "chair": {"i": "int", "j": "int", "face": "dir", "c?": "color"},
    "server_rack": {"i": "int", "j": "int", "face": "dir"},
    "coffee_machine": {"i": "int", "j": "int", "face?": "dir", "counter?": "bool"},
    "scoreboard": {"i": "int", "j": "int", "w": "int"},
}
RANGE: dict[str, tuple[float, float]] = {
    "w": (1, 4), "h": (0.01, 8), "len": (1, 32), "layers": (1, 4), "n": (0, 400), "y": (-4, 12), "s": (0.1, 1.5),
    "top": (-3, 1), "jit": (0, 0.5), "dx": (-0.5, 0.5), "dz": (-0.5, 0.5),
}

MESSAGES: dict[str, str] = {
    "format": "Dünya dosyası biçimi tanınmadı (voxcrew-world v1 bekleniyor)",
    "version": "Desteklenmeyen dünya sürümü",
    "id": "Geçersiz dünya kimliği",
    "grid": "Izgara 24 sütun ve 16–32 satır olmalı; büyüme kiti tanınmadı",
    "meta": "Dünya adı, açıklaması ya da lisansı geçersiz",
    "unsafe_text": "Metin alanlarında betik ya da bağlantı kabul edilmez",
    "color": "Geçersiz renk ya da ortam ayarı: {}",
    "number": "Geçersiz sayı: {}",
    "ground_shape": "Zemin katmanı ızgara boyutunda değil",
    "prefab_type": "Prefab #{}: bilinmeyen tür",
    "prefab_field": "Prefab #{} ({}): '{}' alanı geçersiz",
    "out_of_bounds": "Karo ({}, {}): prefab #{} ızgaranın dışında",
    "too_many_prefabs": "Çok fazla prefab ({} > {})",
    "too_many_blocks": "Çok fazla blok ({} > {})",
    "too_many_lights": "Çok fazla ışık ({} > {})",
    "no_station": "En az bir çalışma istasyonu gerekli",
    "station_outside": "Karo ({}, {}): istasyon ızgaranın dışında",
    "station_blocked": "Karo ({}, {}): istasyon yürünemeyen bir karoda",
    "station_unreachable": "Karo ({}, {}): istasyona yürüyerek ulaşılamıyor",
    "no_rest": "En az bir dinlenme noktası gerekli",
    "rest_outside": "Karo ({}, {}): dinlenme noktası ızgaranın dışında",
    "rest_blocked": "Karo ({}, {}): dinlenme noktası yürünemeyen bir karoda",
    "rest_unreachable": "Karo ({}, {}): dinlenme noktasına yürüyerek ulaşılamıyor",
    "spot_outside": "Karo ({}, {}): '{}' araç noktası ızgaranın dışında",
    "spot_unreachable": "Karo ({}, {}): '{}' araç noktasına ulaşılamıyor",
    "missing_spot": "'{}' aracı için nokta yok; ajan masasında kalır",
    "unknown_key": "Tanınmayan alan: {}",
    "too_deep": "Dünya dosyası çok derin iç içe yapı içeriyor (en çok {} düzey)",
    "expanse": "Genişleme bloğu (parseller ve inşa) geçersiz: {}",
    "city_map": "Şehir haritası bloğu (semtler ve ulaşım) geçersiz: {}",
}

# ---------------------------------------------------------------- kapalı şema (QA O-05)
# Her sözlük düzeyinin izinli anahtarları (arayüzdeki `WorldFile` tipiyle aynı). Bilinmeyen alan SİLİNMEZ, reddedilir:
# böylece dosyadaki sha256 özeti geçerli kalır ve dünya dosyası sır/istem taşıyıcısı olamaz.
MAX_DEPTH = 32
MAX_UNKNOWN_REPORTED = 20
MAX_ELEMENTS = 64
ELEMENT_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
ALLOWED: dict[str, frozenset[str]] = {
    "": frozenset({"format", "version", "id", "meta", "grid", "env", "layers", "nav", "zones", "elements", "baked", "expanse",
                   "city_map"}),
    "meta": frozenset({"name", "description", "author", "license", "created", "updated", "tags", "ip_risk", "basedOn",
                       "sha256"}),
    "meta.author": frozenset({"name", "id"}),
    "meta.basedOn": frozenset({"id", "sha256"}),
    # RING-INT (v1.1): `core` — simge çekirdeği [i0, j0, w, d] (şehir sahneleri halka halinde büyür)
    "grid": frozenset({"w", "d", "annex", "core"}),
    "env": frozenset({"swatch", "sky", "fog", "hemi", "sun", "night", "ocean", "weather", "weather_night", "time"}),
    "env.sun": frozenset({"color", "intensity", "pos"}),
    "env.ocean": frozenset({"color", "y"}),
    "layers": frozenset({"ground", "under", "groundJit", "prefabs", "lights", "backdrop", "movers", "glows"}),
    "light": frozenset({"pos", "color", "intensity", "distance", "flicker"}),
    # S41: uyku noktaları ve canlı ortam kancaları; istasyon duruş/cihaz/yükseklik/yatak türü
    "nav": frozenset({"stations", "rest", "spots", "sleep", "ambient", "open"}),
    "station": frozenset({"tile", "face", "pose", "device", "y", "bed"}),
    "ambient": frozenset({"kind", "tile", "r"}),
    # SP-W1 (v1.1)
    "zone": frozenset({"kind", "i0", "j0", "w", "d", "buffer", "tag"}),
    "mover": frozenset({"shape", "path", "period", "phase", "mode", "color", "accent", "scale", "dayOnly"}),
}
# Prefab türü başına izinli anahtarlar: `FIELDS` tablosundan türetilir ("t" + alan adları, "?" atılarak).
PREFAB_KEYS: dict[str, frozenset[str]] = {t: frozenset({"t", *(k.rstrip("?") for k in f)}) for t, f in FIELDS.items()}
# Değeri tek bir skaler olması gereken alanlar (iç içe sözlük/liste ile serbest veri taşınmasın).
_SCALAR_FIELDS: dict[str, tuple[str, ...]] = {
    "meta": ("name", "description", "license", "created", "updated", "ip_risk", "sha256"),
    "meta.author": ("name", "id"),
    "meta.basedOn": ("id", "sha256"),
    "env": ("night",),
    "station": ("pose", "device", "y", "bed"),
    "ambient": ("kind", "r"),
    "zone": ("kind", "i0", "j0", "w", "d", "buffer", "tag"),
    "mover": ("shape", "period", "phase", "mode", "color", "accent", "scale", "dayOnly"),
}


def too_deep(value: Any, limit: int = MAX_DEPTH) -> bool:
    """İç içe derinlik `limit`i aşıyor mu? Yinelemeli (özyinelemesiz): 3000 düzeylik belge de RecursionError vermez."""
    stack: list[tuple[Any, int]] = [(value, 0)]
    while stack:
        x, d = stack.pop()
        if isinstance(x, dict):
            if d >= limit:
                return True
            stack.extend((y, d + 1) for y in x.values())
        elif isinstance(x, list):
            if d >= limit:
                return True
            stack.extend((y, d + 1) for y in x)
    return False


def unknown_keys(doc: Any) -> list[str]:
    """Kapalı şemada tanınmayan alanların yolları (ör. `meta.prompt`, `layers.prefabs[3].api_key`). Tür doğrulaması
    `validate_world`'dedir; burada yalnızca izin listesi dışındaki anahtarlar ve serbest veri taşıyabilecek değerler."""
    out: list[str] = []
    if not isinstance(doc, dict):
        return out

    def check(obj: Any, schema: str, path: str) -> None:
        if not isinstance(obj, dict):
            return
        allowed = ALLOWED[schema]
        out.extend(f"{path}.{k}" if path else str(k) for k in obj if k not in allowed)
        for k in _SCALAR_FIELDS.get(schema, ()):
            if isinstance(obj.get(k), (dict, list)):
                out.append(f"{path}.{k}")

    check(doc, "", "")
    meta = doc.get("meta")
    check(meta, "meta", "meta")
    if isinstance(meta, dict):
        check(meta.get("author"), "meta.author", "meta.author")
        check(meta.get("basedOn"), "meta.basedOn", "meta.basedOn")
        tags = meta.get("tags")
        if isinstance(tags, list):
            out.extend(f"meta.tags[{n}]" for n, t in enumerate(tags) if not isinstance(t, str))
    check(doc.get("grid"), "grid", "grid")
    env = doc.get("env")
    check(env, "env", "env")
    if isinstance(env, dict):
        check(env.get("sun"), "env.sun", "env.sun")
        check(env.get("ocean"), "env.ocean", "env.ocean")
        weather = env.get("weather")
        if weather is not None and not (isinstance(weather, list) and all(isinstance(w, str) for w in weather)):
            out.append("env.weather")  # v1.1: yalnız kısa tür adları listesi
        wn = env.get("weather_night")
        if wn is not None and not (isinstance(wn, list) and all(isinstance(w, str) for w in wn)):
            out.append("env.weather_night")  # W3a-INT: yalnız gece görünen hava türleri
    layers = doc.get("layers")
    check(layers, "layers", "layers")
    if isinstance(layers, dict):
        for n, p in enumerate(layers.get("prefabs") if isinstance(layers.get("prefabs"), list) else []):
            if isinstance(p, dict) and p.get("t") in PREFAB_KEYS:
                allowed = PREFAB_KEYS[p["t"]]
                out.extend(f"layers.prefabs[{n}].{k}" for k in p if k not in allowed)
        for n, lt in enumerate(layers.get("lights") if isinstance(layers.get("lights"), list) else []):
            check(lt, "light", f"layers.lights[{n}]")
        for n, m in enumerate(layers.get("movers") if isinstance(layers.get("movers"), list) else []):
            check(m, "mover", f"layers.movers[{n}]")
    nav = doc.get("nav")
    check(nav, "nav", "nav")
    if isinstance(nav, dict):
        for n, s in enumerate(nav.get("stations") if isinstance(nav.get("stations"), list) else []):
            check(s, "station", f"nav.stations[{n}]")
        spots = nav.get("spots")
        for k, v in (spots.items() if isinstance(spots, dict) else []):
            for n, s in enumerate(v if isinstance(v, list) else []):
                check(s, "station", f"nav.spots.{k}[{n}]")
        for n, s in enumerate(nav.get("sleep") if isinstance(nav.get("sleep"), list) else []):
            check(s, "station", f"nav.sleep[{n}]")
        for n, a in enumerate(nav.get("ambient") if isinstance(nav.get("ambient"), list) else []):
            check(a, "ambient", f"nav.ambient[{n}]")
    for n, z in enumerate(doc.get("zones") if isinstance(doc.get("zones"), list) else []):
        check(z, "zone", f"zones[{n}]")
    els = doc.get("elements")
    if isinstance(els, list) and (len(els) > MAX_ELEMENTS
                                  or not all(isinstance(e, str) and ELEMENT_RE.match(e) for e in els)):
        out.append("elements")  # kısa kimlik listesi; serbest metin taşımaz
    return out


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) or (isinstance(v, float) and v.is_integer())


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _is_hex(v: Any) -> bool:
    return isinstance(v, str) and bool(HEX.match(v))


def _is_v3(v: Any, xz: float, y: float) -> bool:
    return isinstance(v, list) and len(v) == 3 and all(_is_num(x) for x in v) and abs(v[0]) <= xz and abs(v[2]) <= xz         and abs(v[1]) <= y


def is_spin_part(v: Any, pos: list[Any]) -> bool:
    """ dönüş tanımı {a, o, w, ph?, k?, e?} (o/k çapaya göre görece) — ön yüz `voxel/spin.ts isSpinPart` ile aynı."""
    if not isinstance(v, dict) or any(k not in SPIN_PART_KEYS for k in v):
        return False
    if v.get("a") not in SPIN_AXES or not _is_v3(v.get("o"), 64, 40) or not _is_num(v.get("w"))             or abs(v["w"]) > MAX_SPIN_SPEED:
        return False
    if "ph" in v and not (_is_num(v["ph"]) and abs(v["ph"]) <= MAX_SPIN_PHASE):
        return False
    if "k" in v and not _is_v3(v["k"], 64, 40):
        return False
    if "e" in v and v["e"] is not True:
        return False
    o = v["o"]
    return math.hypot(pos[0] - o[0], pos[1] - o[1], pos[2] - o[2]) <= MAX_SPIN_RADIUS


def _check(kind: str, v: Any, grid_w: int, grid_d: int) -> bool:
    if kind == "int":
        return _is_int(v)
    if kind == "num":
        return _is_num(v)
    if kind == "color":
        return _is_hex(v)
    if kind == "group":
        return v in STATIC_GROUPS
    if kind == "bool":
        return isinstance(v, bool)
    if kind == "axis":
        return v in ("x", "z")
    if kind == "glow":
        return v in ("+z", "+x", "-x")
    if kind == "dir":
        return v in ("+z", "-z", "+x", "-x")
    if kind == "mask":
        return isinstance(v, str) and len(v) == grid_w * grid_d and set(v) <= {"0", "1"}
    if kind in ("cells", "win"):
        limit = 256 if kind == "cells" else 32
        return isinstance(v, list) and len(v) <= limit and all(
            isinstance(c, list) and len(c) == 2 and _is_int(c[0]) and _is_int(c[1]) for c in v)
    if kind == "colors":
        return isinstance(v, list) and len(v) <= 32 and all(
            isinstance(col, list) and len(col) <= 8 and all(_is_hex(c) for c in col) for col in v)
    if kind == "parts":
        if not isinstance(v, list) or not 1 <= len(v) <= 400:
            return False
        size_cap = max(grid_w, grid_d) + 16
        for pt in v:
            if not isinstance(pt, list) or not 7 <= len(pt) <= 10 or not all(_is_num(x) for x in pt[:6]):
                return False
            if not all(0 < s <= size_cap for s in pt[3:6]) or abs(pt[0]) > 64 or abs(pt[2]) > 64 or abs(pt[1]) > 40:
                return False
            if not _is_hex(pt[6]) or (len(pt) > 7 and pt[7] is not None and pt[7] not in GROUPS):
                return False
            if len(pt) > 8 and pt[8] is not None and not (_is_num(pt[8]) and 0 <= pt[8] <= 0.5):
                return False
            # `spin` parçası dönüş tanımını zorunlu taşır; başka grup taşıyamaz
            if (len(pt) > 7 and pt[7] == "spin") != (len(pt) == 10) or (len(pt) == 10 and not is_spin_part(pt[9], pt[:3])):
                return False
        return True
    return False


def footprint(p: dict[str, Any]) -> list[tuple[int, int]]:
    """Prefab'ın engellediği karolar (arayüzdeki prefabs.ts `footprint` ile aynı)."""
    t = p["t"]
    if t in ATMOSPHERE:
        return []
    i, j = int(p["i"]), int(p["j"])
    if t == "cube":
        return [(i, j)] if p.get("solid") else []
    if t == "sea":
        return [(i, j)] if p.get("blocking") else []
    if t == "block":
        return [(i, j)]
    if t == "decor":
        return [(i + int(c[0]), j + int(c[1])) for c in p.get("cells") or []]
    if t == "desk":
        return [(i + k, j) for k in range(int(p["w"]))]
    if t == "sofa":
        return [(i + k, j) for k in range(3)]
    if t in ("monitor", "chair", "scoreboard"):
        return []
    if t == "lamp" and p.get("desk"):
        return []
    if t == "coffee_machine" and p.get("counter"):
        return []
    if t in ("wall", "sandbags"):
        return [(i + k, j) if p["axis"] == "x" else (i, j + k) for k in range(int(p["len"]))]
    return [(i, j)]


def block_bound(p: dict[str, Any]) -> int:
    """Pişince üretilecek blok sayısının üst sınırı (arayüzdeki `blockBound` ile aynı tablo)."""
    t = p["t"]
    fixed = {"cube": 1, "sea": 1, "block": 0, "plant": 3, "pine": 5, "palm": 16, "snowyPine": 9, "lantern": 3,
             "terminal": 5, "crate": 2, "sofa": 2, "lamp": 2, "rock": 2, "table": 6, "bookshelf": 13, "campfire": 10,
             "snowman": 7, "cloud": 4, "monitor": 3, "chair": 5, "server_rack": 8, "coffee_machine": 5, "scoreboard": 2}
    if t in fixed:
        return fixed[t]
    if t == "decor":
        return len(p["parts"])
    if t == "desk":
        return 9 if p["w"] > 1 else 8
    if t == "tree":
        return int(p["h"]) + 14
    if t == "flag":
        return 5 if p.get("emblem") else 4
    if t == "wall":
        return int(p["len"]) * int(p["h"])
    if t == "sandbags":
        return int(p["len"]) * int(p["layers"]) * 2
    if t == "flowers":
        return int(p["n"]) * 2
    if t == "snowfall":
        return int(p["n"])
    return 0


def _strings(v: Any, out: list[str], depth: int = 0) -> None:
    if depth > 12:
        return
    if isinstance(v, str):
        out.append(v)
    elif isinstance(v, list):
        for x in v:
            _strings(x, out, depth + 1)
    elif isinstance(v, dict):
        for k, x in v.items():
            out.append(str(k))
            _strings(x, out, depth + 1)


def _issue(level: str, code: str, args: tuple[Any, ...] = (), tile: tuple[int, int] | list[int] | None = None,
           prefab: int | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"level": level, "code": code, "message": MESSAGES[code].format(*args)}
    if tile is not None:
        out["tile"] = [int(tile[0]), int(tile[1])]
    if prefab is not None:
        out["prefab"] = prefab
    return out


def _is_station(s: Any) -> bool:
    return isinstance(s, dict) and isinstance(s.get("tile"), list) and len(s["tile"]) == 2 \
        and all(_is_int(x) for x in s["tile"]) and _is_num(s.get("face"))


def _is_tile(t: Any) -> bool:
    return isinstance(t, list) and len(t) == 2 and all(_is_int(x) for x in t)


def uses_v11(doc: Any) -> bool:
    """v1.1 alanlarından biri dolu mu (hava listesi, saat, bölge, ufuk, hareketli, açılan karo)?"""
    if not isinstance(doc, dict):
        return False
    env = doc.get("env") if isinstance(doc.get("env"), dict) else {}
    layers = doc.get("layers") if isinstance(doc.get("layers"), dict) else {}
    nav = doc.get("nav") if isinstance(doc.get("nav"), dict) else {}
    return bool(isinstance(env.get("weather"), list) and env["weather"]) or "time" in env or "weather_night" in env \
        or bool(isinstance(doc.get("zones"), list) and doc["zones"]) or "backdrop" in layers or "movers" in layers \
        or "glows" in layers or "open" in nav         or (isinstance(doc.get("grid"), dict) and "core" in doc["grid"])


def _is_zone(z: Any) -> bool:
    if not isinstance(z, dict) or z.get("kind") not in ZONE_KINDS or set(z) - ALLOWED["zone"]:
        return False
    if not all(_is_int(z.get(k)) for k in ("i0", "j0", "w", "d")):
        return False
    if not all(-64 <= z[k] <= 64 for k in ("i0", "j0")) or not all(1 <= z[k] <= 32 for k in ("w", "d")):
        return False
    if "buffer" in z and not (_is_int(z["buffer"]) and 0 <= z["buffer"] <= 4):
        return False
    return "tag" not in z or (isinstance(z["tag"], str) and bool(ZONE_TAG_RE.match(z["tag"])))


def _is_backdrop_part(pt: Any) -> bool:
    """Ufuk kutusu [x, y, z, w, h, d, renk, grup?, titreşim?] — mutlak dünya koordinatı, sınırlı."""
    if not isinstance(pt, list) or not 7 <= len(pt) <= 9 or not all(_is_num(x) for x in pt[:6]):
        return False
    if abs(pt[0]) > 120 or abs(pt[2]) > 120 or not -4 <= pt[1] <= 60 or not all(0 < x <= 40 for x in pt[3:6]):
        return False
    if not _is_hex(pt[6]) or (len(pt) > 7 and pt[7] is not None and pt[7] not in STATIC_GROUPS):
        return False
    return not (len(pt) > 8 and pt[8] is not None and not (_is_num(pt[8]) and 0 <= pt[8] <= 0.5))


def _is_glow(g: Any) -> bool:
    """Gece parıltı işareti [tür, x, y, z, r, w, h, renk] — mutlak dünya koordinatı, sınırlı (W2-INT)."""
    if not isinstance(g, list) or len(g) != 8 or g[0] not in GLOW_KINDS or not all(_is_num(x) for x in g[1:7]):
        return False
    if abs(g[1]) > 120 or abs(g[3]) > 120 or not -4 <= g[2] <= 60 or abs(g[4]) > 7 or not all(0 <= x <= 8 for x in g[5:7]):
        return False
    return _is_hex(g[7])


def _valid_movers(v: Any) -> bool:
    """≤ 12 nesne, ≤ 400 kutu (SCENE-MOVER-001), ≤ 32 noktalı sonlu yol, olumlu süre."""
    if not isinstance(v, list) or len(v) > MAX_MOVERS:
        return False
    boxes = 0
    for m in v:
        if not isinstance(m, dict) or m.get("shape") not in MOVER_BOXES or set(m) - ALLOWED["mover"]:
            return False
        boxes += MOVER_BOXES[m["shape"]]
        path = m.get("path")
        if not isinstance(path, list) or not 1 <= len(path) <= 32 or not all(
                isinstance(q, list) and len(q) == 3 and all(_is_num(x) for x in q)
                and abs(q[0]) <= 120 and abs(q[2]) <= 120 and -10 <= q[1] <= 60 for q in path):
            return False
        if not _is_num(m.get("period")) or not 0 < m["period"] <= 600:
            return False
        if "phase" in m and not (_is_num(m["phase"]) and 0 <= m["phase"] <= 1):
            return False
        if "mode" in m and m["mode"] not in ("loop", "pingpong"):
            return False
        if any(k in m and not _is_hex(m[k]) for k in ("color", "accent")):
            return False
        if "scale" in m and not (_is_num(m["scale"]) and 0.2 <= m["scale"] <= 4):
            return False
        if "dayOnly" in m and not isinstance(m["dayOnly"], bool):
            return False
    return boxes <= MAX_MOVER_BOXES


def validate_world(doc: Any) -> list[dict[str, Any]]:
    """Sorun listesi: `level` error (kaydı engeller) | warning. Boş liste → geçerli."""
    out: list[dict[str, Any]] = []

    def err(code: str, *args: Any, tile: Any = None, prefab: int | None = None) -> None:
        out.append(_issue("error", code, args, tile, prefab))

    def warn(code: str, *args: Any, tile: Any = None) -> None:
        out.append(_issue("warning", code, args, tile))

    if not isinstance(doc, dict):
        err("format")
        return out
    if too_deep(doc):  # QA O-08: aşırı iç içe belge özyinelemeli işlere (kopya, özet) hiç ulaşmasın
        err("too_deep", MAX_DEPTH)
        return out
    if doc.get("format") != FORMAT:
        err("format")
    version = doc.get("version")
    if (isinstance(version, bool) or version not in VERSIONS or (uses_v11(doc) and version == VERSION)
            or ("expanse" in doc and version not in (VERSION_12, VERSION_13))
            or ("city_map" in doc and version != VERSION_13)):
        err("version")
    if "expanse" in doc:  # v1.2 (E3): kapalı şema; parsel gövdesi parsel PUT'uyla aynı kurallar
        from studio.expanse.build import expanse_issues  # noqa: PLC0415 (worlds → expanse tek yönlü)
        bad = expanse_issues(doc["expanse"], ANNEX_IDS)
        if bad:
            err("expanse", ", ".join(bad[:6]))
    if "city_map" in doc:  # v1.3: kapalı şema; arayüz eşi citymap/format.ts cityMapIssues
        from studio.worlds.citymap import city_map_issues  # noqa: PLC0415
        bad_city = city_map_issues(doc["city_map"])
        if bad_city:
            err("city_map", ", ".join(bad_city[:6]))
    if not isinstance(doc.get("id"), str) or not ID_RE.match(doc["id"]):
        err("id")
    texts: list[str] = []
    _strings(doc, texts)
    if any(UNSAFE.search(s) for s in texts):
        err("unsafe_text")
    unknown = unknown_keys(doc)
    for path in unknown[:MAX_UNKNOWN_REPORTED]:
        err("unknown_key", path)
    if len(unknown) > MAX_UNKNOWN_REPORTED:
        err("unknown_key", f"… (+{len(unknown) - MAX_UNKNOWN_REPORTED})")
    meta = doc.get("meta")
    if not isinstance(meta, dict) or not isinstance(meta.get("name"), str) or not meta["name"].strip() \
            or len(meta["name"]) > 80 or not isinstance(meta.get("description"), str) \
            or len(meta["description"]) > 500 or meta.get("license") not in LICENSES:
        err("meta")
    grid = doc.get("grid")
    # CITY-BIG: genişlik 24; çekirdekli büyük şehir tabanında 12'nin katı (24–48) ve derinlik 16'nın katı
    big_ok = isinstance(grid, dict) and "core" in grid and _is_int(grid.get("w")) and grid["w"] % 12 == 0 \
        and GRID_W <= grid["w"] <= MAX_GRID_W_BIG and _is_int(grid.get("d")) and grid["d"] % BASE_D == 0
    if not isinstance(grid, dict) or not (grid.get("w") == GRID_W or big_ok) or not _is_int(grid.get("d")) \
            or not BASE_D <= grid["d"] <= MAX_D or not (grid.get("annex") == "none" or grid.get("annex") in ANNEX_IDS):
        err("grid")
        return out
    gw, gd = int(grid["w"]), int(grid["d"])
    big = "core" in grid and gw * gd > GRID_W * BASE_D
    max_blocks = MAX_BLOCKS_BIG if big else MAX_BLOCKS
    max_backdrop = MAX_BACKDROP_BIG if big else MAX_BACKDROP

    def in_grid(i: int, j: int) -> bool:
        return 0 <= i < gw and 0 <= j < gd

    # RING-INT: simge çekirdeği — 4 tam sayı, en az 1×1, ızgaranın içinde (worldFormat.ts ile aynı)
    core = grid.get("core")
    if "core" in grid and not (isinstance(core, list) and len(core) == 4 and all(_is_int(x) for x in core)
                               and core[0] >= 0 and core[1] >= 0 and core[2] >= 1 and core[3] >= 1
                               and core[0] + core[2] <= gw and core[1] + core[3] <= gd):
        err("number", "grid.core")

    env = doc.get("env")
    env_ok = isinstance(env, dict) and isinstance(env.get("swatch"), list) and len(env["swatch"]) == 2 \
        and all(_is_hex(c) for c in env["swatch"]) and _is_hex(env.get("sky")) \
        and isinstance(env.get("fog"), list) and len(env["fog"]) == 2 and all(_is_num(x) for x in env["fog"]) \
        and isinstance(env.get("hemi"), list) and len(env["hemi"]) == 3 and _is_hex(env["hemi"][0]) \
        and _is_hex(env["hemi"][1]) and _is_num(env["hemi"][2]) and isinstance(env.get("sun"), dict) \
        and _is_hex(env["sun"].get("color")) and _is_num(env["sun"].get("intensity")) \
        and isinstance(env["sun"].get("pos"), list) and len(env["sun"]["pos"]) == 3 \
        and all(_is_num(x) for x in env["sun"]["pos"]) \
        and (env.get("ocean") is None or (isinstance(env["ocean"], dict) and _is_hex(env["ocean"].get("color"))
                                          and _is_num(env["ocean"].get("y"))))
    if not env_ok:
        err("color", "env")
    if isinstance(env, dict):  # v1.1: hava katmanları (≤ 3, tekrarsız, bilinen tür) ve sahne saati
        weather = env.get("weather")
        if weather is not None and not (isinstance(weather, list) and len(weather) <= 3
                                        and len(set(map(str, weather))) == len(weather)
                                        and all(w in WEATHER_KINDS for w in weather)):
            err("number", "env.weather")
        # W3a-INT: `weather_night` — yalnız gece görünen türler (ateş böceği, aurora…); `weather`'ın tekrarsız alt kümesi
        wn = env.get("weather_night")
        if wn is not None and not (isinstance(wn, list) and 0 < len(wn) <= 3 and len(set(map(str, wn))) == len(wn)
                                   and isinstance(weather, list) and all(w in weather for w in wn)):
            err("number", "env.weather_night")
        if "time" in env and env["time"] not in SCENE_TIMES:
            err("number", "env.time")
    zones = doc.get("zones")
    if isinstance(zones, list) and not (len(zones) <= MAX_ZONES and all(_is_zone(z) for z in zones)):
        err("number", "zones")
    layers = doc.get("layers")
    if not isinstance(layers, dict) or not isinstance(layers.get("prefabs"), list) or not isinstance(layers.get("lights"), list):
        err("format")
        return out
    ground = layers.get("ground")
    if ground is not None and not (isinstance(ground, list) and len(ground) == gd and all(
            isinstance(row, list) and len(row) == gw and all(c is None or _is_hex(c) for c in row) for row in ground)):
        err("ground_shape")
    if not (layers.get("under") is None or _is_hex(layers.get("under"))):
        err("color", "under")
    jit = layers.get("groundJit")
    if not _is_num(jit) or not 0 <= jit <= 0.5:
        err("number", "groundJit")
    prefabs = layers["prefabs"]
    if len(prefabs) > MAX_PREFABS:
        err("too_many_prefabs", len(prefabs), MAX_PREFABS)
        return out
    bound = 0
    spins = 0  # dönen blok sayısı (decor parçaları)
    blocked: set[tuple[int, int]] = set()
    for idx, p in enumerate(prefabs):
        if not isinstance(p, dict) or p.get("t") not in FIELDS:
            err("prefab_type", idx, prefab=idx)
            continue
        ok = True
        for raw_name, kind in FIELDS[p["t"]].items():
            optional = raw_name.endswith("?")
            name = raw_name.rstrip("?")
            if name not in p and optional:
                continue
            v = p.get(name)
            rng = RANGE.get(name)
            if not _check(kind, v, gw, gd) or (rng and _is_num(v) and not rng[0] <= v <= rng[1]):
                tile = (p["i"], p["j"]) if _is_int(p.get("i")) and _is_int(p.get("j")) else None
                err("prefab_field", idx, p["t"], name, tile=tile, prefab=idx)
                ok = False
                break
        if not ok:
            continue
        bound += block_bound(p)
        if p["t"] == "decor":
            spins += sum(1 for pt in p["parts"] if len(pt) > 7 and pt[7] == "spin")
        if p["t"] in ATMOSPHERE or (p["t"] == "decor" and p.get("free")):
            continue
        cells = footprint(p)
        outside = next((c for c in [(int(p["i"]), int(p["j"])), *cells] if not in_grid(*c)), None)
        if outside:
            err("out_of_bounds", outside[0], outside[1], idx, tile=outside, prefab=idx)
        blocked.update(cells)
    if "backdrop" in layers and not (isinstance(layers["backdrop"], list) and len(layers["backdrop"]) <= max_backdrop
                                     and all(_is_backdrop_part(pt) for pt in layers["backdrop"])):
        err("number", "layers.backdrop")
    if "movers" in layers and not _valid_movers(layers["movers"]):
        err("number", "layers.movers")
    if "glows" in layers and not (isinstance(layers["glows"], list) and len(layers["glows"]) <= MAX_GLOWS
                                  and all(_is_glow(g) for g in layers["glows"])):
        err("number", "layers.glows")
    lights = layers["lights"]
    if len(lights) > MAX_LIGHTS:
        err("too_many_lights", len(lights), MAX_LIGHTS)
    if not all(isinstance(lt, dict) and isinstance(lt.get("pos"), list) and len(lt["pos"]) == 3
               and all(_is_num(x) for x in lt["pos"]) and _is_hex(lt.get("color"))
               and _is_num(lt.get("intensity")) and 0 <= lt["intensity"] <= 30
               and _is_num(lt.get("distance")) and 0 < lt["distance"] <= 40
               and isinstance(lt.get("flicker", False), bool) for lt in lights):
        err("number", "lights")
    nav = doc.get("nav")
    if not isinstance(nav, dict) or not isinstance(nav.get("stations"), list) or not all(_is_station(s) for s in nav["stations"]) \
            or not isinstance(nav.get("rest"), list) or not all(_is_tile(t) for t in nav["rest"]) \
            or not isinstance(nav.get("spots"), dict) or not all(
                k in TOOL_KINDS and isinstance(v, list) and all(_is_station(s) for s in v) for k, v in nav["spots"].items()) \
            or ("open" in nav and not (isinstance(nav["open"], list) and len(nav["open"]) <= MAX_OPEN
                                       and all(_is_tile(t) and in_grid(int(t[0]), int(t[1])) for t in nav["open"]))):
        err("format")
        return out
    # v1.1: pişirmeden sonra engeli kaldırılan karolar (köprü)
    blocked.difference_update((int(t[0]), int(t[1])) for t in nav.get("open") or [])
    if not isinstance(doc.get("zones"), list) or not isinstance(doc.get("elements"), list):
        err("format")
    if any(i["level"] == "error" for i in out):
        return out

    # ---- navigasyon
    if isinstance(ground, list):
        bound += sum(1 for row in ground for c in row if c)
    if layers.get("under"):
        bound += gw * gd
    if bound > max_blocks:
        err("too_many_blocks", bound, max_blocks)
    if spins > MAX_SPIN_BLOCKS:
        err("number", "spin")
    stations = [(int(s["tile"][0]), int(s["tile"][1])) for s in nav["stations"]]
    rest = [(int(t[0]), int(t[1])) for t in nav["rest"]]
    if not stations:
        err("no_station")
    if not rest:
        err("no_rest")
    for s in stations:
        if not in_grid(*s):
            err("station_outside", *s, tile=s)
        elif s in blocked:
            err("station_blocked", *s, tile=s)
    for t in rest:
        if not in_grid(*t):
            err("rest_outside", *t, tile=t)
        elif t in blocked:
            err("rest_blocked", *t, tile=t)
    spots = {k: [(int(s["tile"][0]), int(s["tile"][1])) for s in nav["spots"].get(k) or []] for k in TOOL_KINDS}
    for k in TOOL_KINDS:
        if not spots[k]:
            warn("missing_spot", k)
        for s in spots[k]:
            if not in_grid(*s):
                err("spot_outside", *s, k, tile=s)
    if any(i["level"] == "error" for i in out):
        return out
    reach = _reachable(stations[0], gw, gd, blocked)
    for s in stations:
        if s not in reach:
            err("station_unreachable", *s, tile=s)
    for t in rest:
        if t not in reach:
            err("rest_unreachable", *t, tile=t)
    for k in TOOL_KINDS:
        for (i, j) in spots[k]:
            if (i, j) not in reach and not any((i + a, j + c) in reach for a, c in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                warn("spot_unreachable", i, j, k, tile=(i, j))
    return out


def _reachable(start: tuple[int, int], gw: int, gd: int, blocked: set[tuple[int, int]]) -> set[tuple[int, int]]:
    seen = {start}
    queue = deque([start])
    while queue:
        i, j = queue.popleft()
        for a, c in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (i + a, j + c)
            if 0 <= n[0] < gw and 0 <= n[1] < gd and n not in seen and n not in blocked:
                seen.add(n)
                queue.append(n)
    return seen


def errors_of(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [i for i in issues if i["level"] == "error"]


# ---------------------------------------------------------------- kanonik JSON + sha256
def _js_num(x: float) -> str:
    """Sayıyı JavaScript `JSON.stringify` biçiminde yazar (arayüzün ürettiği özetle aynı olsun)."""
    if x.is_integer() and abs(x) < 1e21:
        return str(int(x))
    r = repr(x)
    if "e" not in r:
        return r
    if 1e-6 <= abs(x) < 1e21:
        return format(Decimal(r), "f")
    mant, exp = r.split("e")
    sign = "-" if exp.startswith("-") else "+"
    return f"{mant}e{sign}{int(exp.lstrip('+-'))}"


def _ser(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return _js_num(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ",".join(_ser(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(f"{json.dumps(str(k), ensure_ascii=False)}:{_ser(v[k])}" for k in sorted(v)) + "}"
    raise TypeError(f"JSON dışı değer: {type(v).__name__}")


def canonical_json(doc: dict[str, Any]) -> str:
    """`meta.sha256` ve `baked` çıkarılmış, anahtarları sıralı, boşluksuz JSON (arayüzdeki `canonicalJson`)."""
    body = {k: v for k, v in doc.items() if k != "baked"}
    if isinstance(body.get("meta"), dict):
        body["meta"] = {k: v for k, v in body["meta"].items() if k != "sha256"}
    return _ser(body)


def world_sha256(doc: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(doc).encode("utf-8")).hexdigest()
