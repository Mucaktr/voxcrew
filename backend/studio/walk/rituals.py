"""Anı defteri: şehir ritüellerinin ilk yapılışı.

Sözleşme: "Anı defteri"; etik: "CX ritüelleri".

- **Katalog** (`CATALOG`) dalga 1'in 25 ritüel kimliğidir; ön yüz `voxel/fun/rituals/index.ts RITUAL_IDS` ile aynı şehir ve
  aynı sırada (eşlik testi `tests/test_walk_rituals.py`). Anı kimliği `rt:<şehir>:<ritüel>` (`ritualMemoryId`).
- **Pasaporttan ayrı:** ayrı tablo (`walk_rituals`) ve ayrı kimlik alanı (`rt:`). `walk_city`, `explore.CITY_CATALOG` ve
  `explore.CATALOG` değişmez; `an:` damgaları kullanılmaz (lider kararı D2).
- **Ödül yok (D3):** ritüel jeton, XP ya da SP yazmaz; `game_coins` satırı hiçbir yolda yazılmaz (mimari test). Şehrin bütün
  ritüelleri tamamlanınca yalnız gösterilen **kozmetik unvan** (`TITLES`) gelir; o da kayıttan hesaplanır, saklanmaz.
- **Dünya → şehir:** ritüel olayının `world` alanı yürüme dünyasıdır (sahne kimliği). Şehir haritası, sahnesinin kapısından
  açıldığı için aynı `world`'ü taşır: sahne `istanbul` ve İstanbul şehir haritası AYNI şehre sayılır (aynı anı kimliği; ikinci
  kapsam yeniden yazmaz).
- **Kapı (keşif kuralıyla aynı):** `svc._gate` — gerçek sahiplik kaydeder; yönetici modu ya da yaratıcı modla görülen kilitli
  sahne ritüeli oynatır ama kaydetmez (`recorded: false`); sahiplik yoksa 403.
- **İdempotent:** aynı anı ikinci kez yazılmaz (`already: true`); `client_request_id` + parmak izi aynı yanıtı döndürür, aynı
  kimlik başka gövdeyle 409. Yürüme yazma hız sınırı (60/dk) 429.
- Yazma kullanıcı-yalnızdır (`/api/walk/` `USER_ONLY_RE`); defter okuması da MCP'ye kapalıdır (api.py).
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

from studio._edition import EDITION
from studio.game import rules as R
from studio.walk import catalog as W
from studio.cities import NEW_CITY_CATALOGS
from studio.walk import explore as EX

if TYPE_CHECKING:
    from studio.game.db import GameDB
    from studio.walk.service import WalkService

RITUALS_SCHEMA = """
CREATE TABLE IF NOT EXISTS walk_rituals (
  id TEXT PRIMARY KEY, city TEXT NOT NULL, world TEXT NOT NULL, scope TEXT NOT NULL, ts REAL NOT NULL, day TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_walk_rituals_city ON walk_rituals(city);
"""

# Dalga 1 (ön yüz RITUAL_IDS ile aynı şehir sırası ve aynı kimlik sırası)
CATALOG: dict[str, tuple[str, ...]] = {
    "istanbul": ("simit_marti", "cay_bogaz", "guvercin_yem", "balik_ekmek", "kedi_mama"),
    "londra": ("ordek_bezelye", "ikindi_cayi", "balik_patates"),
    "kapadokya": ("teras_balon", "testi_kebabi", "hali_dugum"),
    **{c: tuple(v["rituals"]) for c, v in NEW_CITY_CATALOGS.items()},  # (catalog.json `rituals`)
}
if EDITION == "full":  # kaldırılan şehir ritüelleri, özgün sırayla (studio/full)
    from studio.full.walk_misc import merge_rituals
    CATALOG = merge_rituals(CATALOG)
# Şehrin bütün ritüelleri yapılınca gösterilen kozmetik unvan (§2.4); adları ön yüz `locales/ritualBook.ts title_<kimlik>`
TITLES: dict[str, str] = {
    "istanbul": "bogaz_misafiri",
    "londra": "ikindi_caycisi",
    "kapadokya": "safak_izleyicisi",
    **{c: v["ritual_title"] for c, v in NEW_CITY_CATALOGS.items()},  # (catalog.json `ritual_title`)
}
if EDITION == "full":
    from studio.full.walk_misc import merge_titles
    TITLES = merge_titles(TITLES)
SCOPES = ("scene", "map")
PREFIX = "rt:"


def memory_id(city: str, ritual: str) -> str:
    return f"{PREFIX}{city}:{ritual}"


ALL_IDS: frozenset[str] = frozenset(memory_id(c, r) for c, rs in CATALOG.items() for r in rs)
TOTAL = len(ALL_IDS)


def parse(id_: Any) -> tuple[str, str] | None:
    """`rt:<şehir>:<ritüel>` → (şehir, ritüel); katalog dışı ya da biçimsiz → None."""
    if not isinstance(id_, str) or id_ not in ALL_IDS:
        return None
    _, city, ritual = id_.split(":", 2)
    return city, ritual


def city_of_world(world: Any) -> str | None:
    """Yürüme dünyası → ritüel şehri. Sahne kimliği şehir kimliğiyle aynıdır; şehir haritası sahnesinin kapısından açılır
    (`explore.CITY_CATALOG[şehir].scene`), bu yüzden harita kapsamı da aynı şehre düşer."""
    if not W.is_scene(world):
        return None
    if world in CATALOG:
        return str(world)
    for city, spec in EX.CITY_CATALOG["cities"].items():
        if city in CATALOG and spec.get("scene") == world:
            return city
    return None


def ensure_schema(db: "GameDB") -> None:
    if getattr(db, "_rituals_schema", False):
        return
    with db._lock:
        db.conn.executescript(RITUALS_SCHEMA)
        db._rituals_schema = True  # type: ignore[attr-defined]


def _found(db: "GameDB") -> list[Any]:
    return [r for r in db.q("SELECT id, city, scope, day FROM walk_rituals ORDER BY ts") if r["id"] in ALL_IDS]


def _city(city: str, rows: list[Any]) -> dict[str, Any]:
    mine = [r for r in rows if r["city"] == city]
    total = len(CATALOG[city])
    out: dict[str, Any] = {"found": len(mine), "total": total,
                           "done": [{"id": str(r["id"]).split(":", 2)[2], "scope": r["scope"], "day": r["day"]} for r in mine]}
    if len(mine) >= total:
        out["title"] = TITLES[city]
    return out


def public() -> dict[str, Any]:
    return {"cities": {c: list(rs) for c, rs in CATALOG.items()}, "titles": dict(TITLES), "total": TOTAL}


def book(svc: "WalkService") -> dict[str, Any]:
    """GET /api/walk/rituals: şehir başına `{found, total, done[], title?}` (unvan yalnız şehir tamamlanınca)."""
    g = svc.game
    ensure_schema(g.db)
    rows = _found(g.db)
    cities = {c: _city(c, rows) for c in CATALOG}
    return {"cities": cities, "found": len(rows), "total": TOTAL,
            "titles": [cities[c]["title"] for c in CATALOG if "title" in cities[c]]}


def record(svc: "WalkService", data: dict[str, Any]) -> dict[str, Any]:
    """POST /api/walk/ritual: ritüelin ilk yapılışı anı defterine (kullanıcı-yalnız; ödülsüz; idempotent)."""
    from studio.walk.service import WalkError
    parsed = parse(data.get("id"))
    if parsed is None:
        raise WalkError(400, "Bu ritüel anı defterinin listesinde yok")
    city, ritual = parsed
    world = data.get("world")
    if not W.valid_world(world):
        raise WalkError(400, "Geçersiz dünya kimliği")
    scope = data.get("scope", "scene")
    if scope not in SCOPES:
        raise WalkError(400, "scope scene ya da map olmalı")
    if city_of_world(world) != city:
        raise WalkError(400, "Bu ritüel bu dünyada yok")
    id_ = memory_id(city, ritual)
    rid = svc._rid(data, "ritual")
    fp = svc._fp("ritual", id_, world, scope)
    g = svc.game
    ensure_schema(g.db)
    bypass = svc._gate(g, str(world))
    svc._rate()
    if bypass:
        return svc._view_only_reply(g, bypass, city=city, id=id_, ritual=ritual, scope=scope)
    now = time.time()
    day = R.day_of(now)
    with g._lock:
        with g.db.tx():
            prior = svc._replayed(g.db, rid, fp)
            if prior is not None:
                return prior
            already = g.db.one("SELECT 1 FROM walk_rituals WHERE id=?", id_) is not None
            had_title = "title" in _city(city, _found(g.db))
            if not already:
                g.db.exec("INSERT INTO walk_rituals(id,city,world,scope,ts,day) VALUES(?,?,?,?,?,?)",
                          id_, city, world, scope, now, day)
            svc._touch(g.db, now)
            summary = _city(city, _found(g.db))
            title_new = summary.get("title") if not had_title and "title" in summary else None
            resp = {"ok": True, "already": already, "admin": False, "recorded": not already, "city": city, "id": id_,
                    "ritual": ritual, "scope": scope, "book": {k: v for k, v in summary.items() if k != "done"},
                    "title_new": title_new}
            svc._remember(g.db, rid, resp, now, fp)
    events: list[tuple[str, dict[str, Any]]] = []
    if not already:
        events.append(("walk.ritual", {"city": city, "id": id_, "title": title_new}))
    return {**resp, "events": events}
