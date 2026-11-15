"""WALK-EXPLORE — yürüme modunda keşif: iç mekânlar, seyir noktaları, keşif parçaları, ilgi noktaları ve gizli köşeler.

Katalog SABİT ve sonludur; istemci yalnızca bu listedeki kimlikleri gönderebilir. Kimlikler (frontend
`src/voxel/interiors/catalog.ts` EXPLORE-CATALOG bloğu ile birebir; `tests/test_walk_explore.py` karşılaştırır):
- `<sahne>:in:<yer>` iç mekâna giriş
- `<sahne>:vp:<yer>` seyir noktası (önce o yerin iç mekânına girilmiş olmalı)
- `<sahne>:k:<yer>:<n>` keşif parçası (hatıradan AYRI tür; sahne başına 5 hatıra tavanına girmez; önce iç mekâna girilmiş olmalı)
- `<sahne>:poi:<n>` ilgi noktası (bilgi notu)
- `<sahne>:gz:<n>` gizli köşe

Etik: ücretli rastgelelik yok (hiçbir şey rastgele değildir), FOMO yok (görevlerin bitiş tarihi
yok), seri cezası yok (hiçbir şey düşmez), ajan sıralaması yok (keşif kullanıcınındır). Ödül yalnızca kullanıcının kendi yürüme
eyleminden gelir: sunucu katalog, sahne sahipliği (yaratıcı/yönetici modu kaydetmez), zincir kuralı (parça ve manzara için
önce giriş), idempotentlik (`client_request_id` + parmak izi) ve kullanıcı-yalnız yazma (`walk/` USER_ONLY) uygular.
Jeton yalnızca keşif parçası, gizli köşe ve keşif görevi verir ve hatıralarla AYNI günlük yürüme jeton sınırını
(`SOUVENIR_COINS_PER_DAY`, 20) paylaşır; sınırdan sonra kayıt yapılır ama ödenmez (şeffaf: `reason: "daily_cap"`).
XP mevcut `walk_discover` kuralından (günlük sınırlı) gelir. Kültür incelemesi bekleyen ibadet yeri iç mekânı (`review`) 403.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import TYPE_CHECKING, Any, Iterable

from studio._edition import EDITION
from studio.game import rules as R
from studio.walk import catalog as W
from studio.cities import NEW_CITY_CATALOGS
from studio.walk import ipmigrate as IPM

if TYPE_CHECKING:
    from studio.game.db import GameDB
    from studio.walk.service import WalkService

# --------------------------------------------------------------------------------------------- katalog (frontend ile aynı)
CATALOG: dict[str, Any] = {
    "version": 1,
    "scenes": {
        "office": {"sites": {"ust_kat": {"kind": "office_upper", "vp": 1, "k": 2}}, "poi": 0, "gz": 2},
        "park": {"sites": {}, "poi": 0, "gz": 2},
        "home": {"sites": {}, "poi": 0, "gz": 2},
        "beach": {"sites": {}, "poi": 0, "gz": 2},
        "cafe": {"sites": {"loft": {"kind": "cafe_loft", "vp": 1, "k": 1}}, "poi": 0, "gz": 2},
        "camp": {"sites": {}, "poi": 0, "gz": 2},
        "mall": {"sites": {"ust_kat": {"kind": "mall_upper", "vp": 1, "k": 2}}, "poi": 0, "gz": 2},
        "school": {"sites": {}, "poi": 0, "gz": 2},
        "battlefield": {"sites": {}, "poi": 0, "gz": 2},
        "sea": {"sites": {}, "poi": 0, "gz": 2},
        "yacht": {"sites": {}, "poi": 0, "gz": 2},
        "space": {"sites": {}, "poi": 0, "gz": 2},
        "snow": {"sites": {}, "poi": 0, "gz": 2},
        "istanbul": {"sites": {
            "galata": {"kind": "tower", "vp": 1, "k": 2},
            "teras": {"kind": "terrace", "vp": 1, "k": 1},
            "iskele": {"kind": "pier", "vp": 1, "k": 1},
            "ayasofya": {"kind": "sacred", "vp": 0, "k": 0, "review": 1},
            "sultanahmet": {"kind": "courtyard", "vp": 0, "k": 0}}, "poi": 3, "gz": 2},
        "kapadokya": {"sites": {
            "castle": {"kind": "castle", "vp": 1, "k": 2},
            "teras": {"kind": "terrace", "vp": 1, "k": 1}}, "poi": 3, "gz": 2},
        "londra": {"sites": {
            "clocktower": {"kind": "tower", "vp": 1, "k": 2},
            "keep": {"kind": "museum", "vp": 1, "k": 2},
            "teras": {"kind": "terrace", "vp": 1, "k": 1},
            "iskele": {"kind": "pier", "vp": 1, "k": 1}}, "poi": 3, "gz": 2},
    },
}
# yeni şehirlerin sahne keşif girdileri (catalog.json `explore`; ön yüz interiors/catalog.ts aynı dosyayı okur)
CATALOG["scenes"].update({c: v["explore"] for c, v in NEW_CITY_CATALOGS.items()})
if EDITION == "full":  # kaldırılan şehir/premium sahne girdileri, özgün sırayla (studio/full)
    from studio.full.walk_explore import merge_explore_scenes
    CATALOG["scenes"] = merge_explore_scenes(CATALOG["scenes"])

KINDS = ("in", "vp", "k", "poi", "gz")
COINS: dict[str, int] = {"in": 0, "vp": 0, "k": 2, "poi": 0, "gz": 2}
QUEST_COINS = 5
# Unvanlar (yalnız görünüm; kozmetik): toplam keşif sayısı eşiği → anahtar (locales/explore.ts `title_*`)
TITLES: tuple[tuple[int, str], ...] = ((0, "title_none"), (3, "title_merakli"), (10, "title_sokak"), (25, "title_sehir"),
                                       (50, "title_dunya"))
LOG_LIMIT = 40

EXPLORE_SCHEMA = """
CREATE TABLE IF NOT EXISTS walk_explore (
  id TEXT PRIMARY KEY, world TEXT NOT NULL, kind TEXT NOT NULL, ts REAL NOT NULL, day TEXT NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_walk_explore_day ON walk_explore(day);
CREATE TABLE IF NOT EXISTS walk_explore_quests (
  id TEXT PRIMARY KEY, world TEXT NOT NULL, ts REAL NOT NULL, day TEXT NOT NULL, coins INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_walk_explore_quests_day ON walk_explore_quests(day);
"""

_ID_RE = re.compile(r"^([a-z0-9_]+):(in|vp|k|poi|gz):([a-z0-9_]+)(?::([0-9]+))?$")


class ExploreError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def ensure_schema(db: "GameDB") -> None:
    if getattr(db, "_explore_schema", False):
        return
    with db._lock:
        db.conn.executescript(EXPLORE_SCHEMA)
    IPM.migrate(db)  # FREE-MAP-IP: eski keşif kimlikleri (korunan yapı adları) yenilerine
    db._explore_schema = True  # type: ignore[attr-defined] # yalnız göç başarılıysa; başarısızsa sonraki çağrı yeniden dener


# --------------------------------------------------------------------------------------------- katalog yardımcıları
def scene_spec(scene: str) -> dict[str, Any] | None:
    return CATALOG["scenes"].get(scene)


def is_open_site(spec: dict[str, Any] | None) -> bool:
    return bool(spec) and not spec.get("review")  # type: ignore[union-attr]


def ids(scene: str) -> tuple[str, ...]:
    """Sahnenin girilebilir keşif kimlikleri (incelemedeki yerler hariç); sıra belirlenimci."""
    s = scene_spec(scene)
    if not s:
        return ()
    out: list[str] = []
    for site, spec in s["sites"].items():
        if not is_open_site(spec):
            continue
        out.append(f"{scene}:in:{site}")
        if spec.get("vp"):
            out.append(f"{scene}:vp:{site}")
        out.extend(f"{scene}:k:{site}:{n}" for n in range(1, int(spec.get("k", 0)) + 1))
    out.extend(f"{scene}:poi:{n}" for n in range(1, int(s["poi"]) + 1))
    out.extend(f"{scene}:gz:{n}" for n in range(1, int(s["gz"]) + 1))
    return tuple(out)


ALL_IDS: frozenset[str] = frozenset(i for s in CATALOG["scenes"] for i in ids(s))
REVIEW_IDS: frozenset[str] = frozenset(f"{s}:in:{site}" for s, v in CATALOG["scenes"].items()
                                       for site, spec in v["sites"].items() if spec.get("review"))


def parse(id_: str) -> dict[str, Any] | None:
    m = _ID_RE.match(id_) if isinstance(id_, str) else None
    if not m:
        return None
    scene, kind, a, b = m.groups()
    if kind == "k":
        return {"scene": scene, "kind": kind, "site": a, "n": int(b)} if b else None
    if kind in ("in", "vp"):
        return None if b else {"scene": scene, "kind": kind, "site": a}
    if b or not a.isdigit():
        return None
    return {"scene": scene, "kind": kind, "n": int(a)}


def kind_of(id_: str) -> str | None:
    p = parse(id_)
    return p["kind"] if p else None


def quests(scene: str) -> list[dict[str, Any]]:
    """Sahnenin keşif görevleri (süresiz; katalogdan türetilir): tür başına bir görev, hedef = o türün tümü (en çok 3 iç mekân)."""
    counts = {k: 0 for k in KINDS}
    for i in ids(scene):
        counts[kind_of(i) or ""] = counts.get(kind_of(i) or "", 0) + 1
    out = []
    for kind in ("vp", "in", "poi", "gz", "k"):
        n = counts.get(kind, 0)
        if n <= 0:
            continue
        target = min(n, 3) if kind == "in" else n
        out.append({"id": f"{scene}:q:{kind}", "scene": scene, "kind": kind, "target": target, "reward_coins": QUEST_COINS})
    return out


ALL_QUESTS: dict[str, dict[str, Any]] = {q["id"]: q for s in CATALOG["scenes"] for q in quests(s)}


def title_for(count: int) -> tuple[dict[str, Any], dict[str, Any] | None]:
    cur, nxt = TITLES[0], None
    for i, t in enumerate(TITLES):
        if count >= t[0]:
            cur = t
            nxt = TITLES[i + 1] if i + 1 < len(TITLES) else None
    return {"id": cur[1], "min": cur[0]}, ({"id": nxt[1], "min": nxt[0]} if nxt else None)


def coins_used_today(db: "GameDB", day: str) -> int:
    """Bugün ödenen yürüme jetonu: hatıra + keşif + keşif görevi (paylaşılan günlük sınır). Şema `WalkService.game` ile kurulur
    (işlem içinde `executescript` çağrılmaz: örtük COMMIT açık işlemi bozar)."""
    return (int(db.scalar("SELECT COALESCE(SUM(coins),0) FROM walk_found WHERE day=?", day))
            + int(db.scalar("SELECT COALESCE(SUM(coins),0) FROM walk_explore WHERE day=?", day))
            + int(db.scalar("SELECT COALESCE(SUM(coins),0) FROM walk_explore_quests WHERE day=?", day)))


def explore_coins_today(db: "GameDB", day: str) -> int:
    return (int(db.scalar("SELECT COALESCE(SUM(coins),0) FROM walk_explore WHERE day=?", day))
            + int(db.scalar("SELECT COALESCE(SUM(coins),0) FROM walk_explore_quests WHERE day=?", day)))


def public() -> dict[str, Any]:
    """Katalog özeti (GET /api/walk/explore/catalog)."""
    return {"version": CATALOG["version"], "scenes": {s: list(ids(s)) for s in CATALOG["scenes"]},
            "review": sorted(REVIEW_IDS), "quests": list(ALL_QUESTS.values()),
            "rewards": {"coins": COINS, "quest_coins": QUEST_COINS, "shared_daily_cap": W.SOUVENIR_COINS_PER_DAY},
            "titles": [{"id": t[1], "min": t[0]} for t in TITLES]}


# --------------------------------------------------------------------------------------------- servis
def _progress(found: set[str], scene: str) -> dict[str, int]:
    out = {k: 0 for k in KINDS}
    for i in found:
        p = parse(i)
        if p and p["scene"] == scene:
            out[p["kind"]] += 1
    return out


def state(svc: "WalkService", world: str | None = None) -> dict[str, Any]:
    g = svc.game
    db = g.db
    ensure_schema(db)
    if world is not None and not W.valid_world(world):
        from studio.walk.service import WalkError
        raise WalkError(400, "Geçersiz dünya kimliği")
    rows = db.q("SELECT id, world, kind, ts, coins FROM walk_explore ORDER BY ts, id")
    found = {r["id"] for r in rows if r["id"] in ALL_IDS}
    done_q = {r["id"] for r in db.q("SELECT id FROM walk_explore_quests")}
    souv = {r["item"] for r in db.q("SELECT item FROM walk_found")}
    visas = {r["landmark"] for r in db.q("SELECT landmark FROM walk_visas")}
    scenes: dict[str, dict[str, int]] = {}
    for s in CATALOG["scenes"]:
        ex = ids(s)
        sv = W.souvenir_ids(s)
        lm = W.landmark_ids(s)
        total = len(ex) + len(sv) + len(lm)
        got = sum(1 for i in ex if i in found) + sum(1 for i in sv if i in souv) + sum(1 for i in lm if i in visas)
        scenes[s] = {"total": total, "found": got, "percent": int(round(100 * got / total)) if total else 0,
                     "explore_total": len(ex), "explore_found": sum(1 for i in ex if i in found)}
    qs = []
    for q in ALL_QUESTS.values():
        if world and q["scene"] != world:
            continue
        prog = _progress(found, q["scene"])[q["kind"]]
        qs.append({**q, "progress": min(prog, q["target"]), "done": q["id"] in done_q})
    count = len(found)
    cur, nxt = title_for(count)
    day = R.day_of(time.time())
    log = [{"id": r["id"], "world": r["world"], "kind": r["kind"], "ts": r["ts"]} for r in rows if r["id"] in found][-LOG_LIMIT:]
    return {"world": world, "found": sorted(found), "scenes": scenes, "quests": qs, "count": count,
            "title": cur, "next_title": nxt, "log": log[::-1], "review": sorted(REVIEW_IDS),
            "coins": {"used": coins_used_today(db, day), "max": W.SOUVENIR_COINS_PER_DAY}, "admin": g.admin()}


def discover(svc: "WalkService", data: dict[str, Any]) -> dict[str, Any]:
    from studio.walk.service import WalkError, _human
    world = data.get("world")
    if not W.is_scene(world):
        raise WalkError(400, "Bilinmeyen sahne")
    id_ = IPM.alias(data.get("id"))  # FREE-MAP-IP: eski istemcinin eski kimliği
    p = parse(id_) if isinstance(id_, str) else None
    if p is None or p["scene"] != world:
        raise WalkError(400, "Bu keşif bu sahnenin listesinde yok")
    if id_ in REVIEW_IDS:
        raise WalkError(403, "Bu iç mekân kültür incelemesinde; şimdilik girilemez")
    if id_ not in ALL_IDS:
        raise WalkError(400, "Bu keşif bu sahnenin listesinde yok")
    rid = svc._rid(data, "explore")
    fp = svc._fp("explore", world, id_)
    g = svc.game
    ensure_schema(g.db)
    bypass = svc._gate(g, str(world))
    svc._rate()
    if bypass:
        return svc._view_only_reply(g, bypass, world=world, id=id_, kind=p["kind"], coins=0, quests_completed=[])
    now = time.time()
    day = R.day_of(now)
    human = _human()
    kind = p["kind"]
    events: list[tuple[str, dict[str, Any]]] = []
    with g._lock:
        with g.db.tx():
            prior = svc._replayed(g.db, rid, fp)
            if prior is not None:
                return prior
            # zincir kuralı: keşif parçası ve seyir noktası o yerin iç mekânına girildikten sonra sayılır
            if kind in ("k", "vp"):
                need = f"{world}:in:{p['site']}"
                if g.db.one("SELECT 1 FROM walk_explore WHERE id=?", need) is None:
                    raise WalkError(409, "Önce bu iç mekâna gir")
            svc._touch(g.db, now)
            already = g.db.one("SELECT 1 FROM walk_explore WHERE id=?", id_) is not None
            coins = 0
            capped = False
            xp = 0
            completed: list[dict[str, Any]] = []
            if not already:
                want = COINS.get(kind, 0)
                if want:
                    if coins_used_today(g.db, day) + want <= W.SOUVENIR_COINS_PER_DAY:
                        coins = want
                    else:
                        capped = True
                g.db.exec("INSERT INTO walk_explore(id,world,kind,ts,day,coins) VALUES(?,?,?,?,?,?)",
                          id_, world, kind, now, day, coins)
                if coins:
                    g.db.add_coins(f"walk:explore:{id_}", now, day, coins, "walk", f"Keşif: {id_} (+{coins} jeton)", ref=id_)
                xp = g._human("walk_discover", f"walk_discover:v1:{id_}", now, "Keşif")
                g._bump(*human, "explore_found", id_, now)
                if kind == "in":
                    g._bump(*human, "interiors_visited", id_, now)
                elif kind == "vp":
                    g._bump(*human, "viewpoints", id_, now)
                g.db.feed(now, "walk", *human, f"Keşif: {id_}", coins or None, {"world": world, "explore": id_})
                # keşif görevleri (süresiz): bu keşifle tamamlananlar bir kez ödüllenir
                found = {r["id"] for r in g.db.q("SELECT id FROM walk_explore WHERE world=?", world)}
                prog = _progress(found, str(world))
                for q in quests(str(world)):
                    if prog[q["kind"]] < q["target"]:
                        continue
                    if g.db.one("SELECT 1 FROM walk_explore_quests WHERE id=?", q["id"]) is not None:
                        continue
                    qc = q["reward_coins"] if coins_used_today(g.db, day) + q["reward_coins"] <= W.SOUVENIR_COINS_PER_DAY else 0
                    g.db.exec("INSERT INTO walk_explore_quests(id,world,ts,day,coins) VALUES(?,?,?,?,?)", q["id"], world, now,
                              day, qc)
                    if qc:
                        g.db.add_coins(f"walk:explore_quest:{q['id']}", now, day, qc, "walk",
                                       f"Keşif görevi: {q['id']} (+{qc} jeton)", ref=q["id"])
                    g._bump(*human, "explore_quests", q["id"], now)
                    g.db.feed(now, "walk", *human, f"Keşif görevi tamam: {q['id']}", qc or None,
                              {"world": world, "explore_quest": q["id"]})
                    completed.append({**q, "coins": qc, "paid": bool(qc), "reason": None if qc else "daily_cap"})
                events = g._drain()
            total = len(ids(str(world)))
            got = int(g.db.scalar("SELECT COUNT(*) FROM walk_explore WHERE world=?", world))
            paid = bool(coins)
            reason = None if paid else ("already_found" if already else "daily_cap" if capped else None)
            resp = {"ok": True, "already": already, "admin": False, "recorded": not already, "world": world, "id": id_,
                    "kind": kind, "coins": coins, "capped": capped, "paid": paid, "reason": reason, "xp": xp,
                    "quests_completed": completed, "explore": {"found": got, "total": total},
                    "balance": g.db.balance()}
            svc._remember(g.db, rid, resp, now, fp)
    if not already:
        events.append(("walk.explored", {"world": world, "id": id_, "kind": kind, "coins": coins,
                                         "quests": [q["id"] for q in completed]}))
    return {**resp, "events": events}


# ============================================================================================= şehir haritası
# "Arka uç": semt kimlikli keşif kayıtları, şehir pasaportu damgaları ve ziyaret edilmiş
# duraklar (hızlı seyahat yalnız bunlara). Katalog SABİT ve sonludur; arayüz `frontend/src/voxel/citymap/catalog.ts`
# CITY-CATALOG bloğu ile birebir (tests/test_city_map.py karşılaştırır). Kimlikler:
#   `city:<şehir>:<semt>`               semte ilk giriş (damga)
#   `city:<şehir>:<semt>:lm:<landmark>` landmark ziyareti (damga)
#   `city:<şehir>:<semt>:in:<landmark>` girilebilir landmarkın iç mekânı (damga)
#   `city:<şehir>:<semt>:vp:<n>`        seyir noktası (damga)
#   `city:<şehir>:<semt>:gz:<n>` gizli köşe (damga)
#   `city:<şehir>:<semt>:an:<an>` zamanlı an (örn. Kız Kulesi'nden gün batımı; damga)
#   `city:<şehir>:stop:<durak>`         ziyaret edilmiş durak (damga değil)
# Zincir: landmark, iç mekân, seyir noktası, gizli köşe ve an damgası önce o semte girilmiş olmasını ister (409). Ödül yok
# (kayıt ve ilerleme; jeton/XP sonraki fazlarda mevcut günlük sınırlarla).
# (İstanbul): semt kilidi (`unlock`: önceki semte girilmiş olmalı ya da ofis seviyesi yeterli; para yolu yok, SK-K5) —
# kilitli semtin damgası 423; süresiz görevler (`quests`: `need` kimliklerinin tümü pasaportta) kayıttan hesaplanır, saklanmaz
# (geri sayım, seri ve kayıp yok; ETHICS #3–#4). Yazma kullanıcı-yalnız (`/api/walk/` USER_ONLY_RE) ve
# idempotent (`client_request_id` + parmak izi; aynı kimlik ikinci kez yazılmaz). Sahne sahipliği keşifle aynı kapıdan
# (yaratıcı/yönetici modu kaydetmez).
CITY_CATALOG: dict[str, Any] = {
    "version": 2,  # kimlik kümesi büyüyünce artır (v2: ~30 yeni damga: avlu/iç mekân `in:` + 2 seyir noktası)
    "cities": {
        "sk0_test": {"scene": "office", "test": 1,
                     "districts": {
                         "deneme": {"landmarks": {"kule": 1, "anit": 0}, "vp": 1},
                         "ek": {"landmarks": {}, "vp": 0}},
                     "stops": ["durak_a", "durak_b"]},
        "istanbul": {
            "scene": "istanbul",
            "districts": {
                "tarihi_yarimada": {"landmarks": {"ayasofya": 1, "sultanahmet": 1, "topkapi": 1, "yerebatan": 1, "hipodrom": 0,
                                                  "kapalicarsi": 1, "misir_carsisi": 0, "suleymaniye": 1}, "vp": 1, "gz": 2},
                "halic": {"landmarks": {"galata_koprusu": 1, "balat": 0}, "vp": 1, "gz": 2},
                "beyoglu": {"landmarks": {"galata_kulesi": 1, "karakoy_rihtim": 0, "tunel": 0, "istiklal": 0, "taksim": 0},
                            "vp": 1, "gz": 2},
                "bogaz": {"landmarks": {"dolmabahce_saat": 0, "dolmabahce": 0, "ortakoy": 0, "bogaz_koprusu": 0,
                                        "rumeli_hisari": 1}, "vp": 2, "gz": 2},
                "uskudar": {"landmarks": {"kiz_kulesi": 1, "uskudar_iskele": 0, "haydarpasa": 0, "kadikoy_carsi": 0}, "vp": 2,
                            "gz": 2, "an": ["gun_batimi"]}},
            "stops": ["beyazit", "sultanahmet", "eminonu", "eminonu_iskele", "karakoy", "karakoy_tunel", "tunel", "taksim",
                      "karakoy_iskele", "kasimpasa_iskele", "balat_iskele", "kabatas", "besiktas_iskele", "ortakoy_iskele",
                      "rumeli_iskele", "uskudar_iskele", "kadikoy_iskele", "salacak", "kiz_kulesi_iskele"],
            "unlock": {
                "halic": {"after": "tarihi_yarimada", "level": 3},
                "beyoglu": {"after": "tarihi_yarimada", "level": 3},
                "bogaz": {"after": "beyoglu", "level": 5},
                "uskudar": {"after": "tarihi_yarimada", "level": 3}},
            "quests": [
                {"id": "gizli_cesmeler", "district": "tarihi_yarimada",
                 "need": ["city:istanbul:tarihi_yarimada:gz:1", "city:istanbul:tarihi_yarimada:gz:2"]},
                {"id": "yer_alti_saray", "district": "tarihi_yarimada",
                 "need": ["city:istanbul:tarihi_yarimada:in:yerebatan", "city:istanbul:tarihi_yarimada:in:topkapi"]},
                {"id": "kopru_alti", "district": "halic",
                 "need": ["city:istanbul:halic:in:galata_koprusu", "city:istanbul:halic:lm:balat"]},
                {"id": "istiklal_turu", "district": "beyoglu", "need": ["city:istanbul:stop:tunel", "city:istanbul:stop:taksim"]},
                {"id": "hisar_surlari", "district": "bogaz",
                 "need": ["city:istanbul:bogaz:in:rumeli_hisari", "city:istanbul:bogaz:lm:bogaz_koprusu"]},
                {"id": "iki_kita", "district": "uskudar", "need": ["city:istanbul:tarihi_yarimada", "city:istanbul:uskudar"]},
                {"id": "gun_batimi", "district": "uskudar", "need": ["city:istanbul:uskudar:an:gun_batimi"]}]},
        "londra": {
            "scene": "londra",
            "districts": {
                "westminster": {"landmarks": {"saat_kulesi": 1, "parlamento": 0, "cark": 0}, "vp": 1, "gz": 2, "an": ["gun_batimi"]},
                "kale": {"landmarks": {"kule_koprusu": 0, "kale": 1}, "vp": 1, "gz": 2},
                "carsi": {"landmarks": {"kapali_carsi": 1, "galeri": 0, "meydan_cesmesi": 0}, "vp": 1, "gz": 2},
                "park": {"landmarks": {"saray": 0, "muzik_kosku": 0, "kayikhane": 0}, "vp": 1, "gz": 2},
                "sehir": {"landmarks": {"kubbeli_katedral": 0, "anit_sutun": 0, "borsa": 0}, "vp": 1, "gz": 2}},
            "stops": ["westminster_ist", "westminster_otobus", "westminster_iskele", "kale_iskele", "tower_hill", "covent", "trafalgar", "bank", "sehir_otobus", "park_kosesi"],
            "unlock": {
                "kale": {"after": "westminster", "level": 3},
                "carsi": {"after": "westminster", "level": 3},
                "park": {"after": "carsi", "level": 4},
                "sehir": {"after": "kale", "level": 5}},
            "quests": [
                {"id": "saat_mekanizmasi", "district": "westminster", "need": ["city:londra:westminster:in:saat_kulesi", "city:londra:westminster:lm:parlamento"]},
                {"id": "gun_batimi", "district": "westminster", "need": ["city:londra:westminster:an:gun_batimi"]},
                {"id": "nehir_turu", "district": "kale", "need": ["city:londra:stop:westminster_iskele", "city:londra:stop:kale_iskele"]},
                {"id": "kale_ve_kopru", "district": "kale", "need": ["city:londra:kale:in:kale", "city:londra:kale:lm:kule_koprusu", "city:londra:kale:vp:1"]},
                {"id": "carsi_turu", "district": "carsi", "need": ["city:londra:carsi:in:kapali_carsi", "city:londra:carsi:lm:galeri"]},
                {"id": "park_gizli", "district": "park", "need": ["city:londra:park:gz:1", "city:londra:park:gz:2"]},
                {"id": "iki_katli", "district": "park", "need": ["city:londra:stop:park_kosesi", "city:londra:stop:sehir_otobus"]}]},
        "kapadokya": {"scene": "kapadokya",
          "districts": {
            "goreme": {"landmarks": {"peri_bacalari": 0, "magara_otel": 0, "kaya_kiliseleri": 0, "hali_atolyesi": 0}, "vp": 1, "gz": 2},
            "vadiler": {"landmarks": {"pasabag": 0, "ask_vadisi": 0, "guvercinlik": 0}, "vp": 1, "gz": 2, "an": ["gun_batimi"]},
            "uchisar": {"landmarks": {"uchisar_kalesi": 1, "magara_evleri": 0}, "vp": 1, "gz": 2},
            "balon": {"landmarks": {"kalkis_alani": 0, "sabah_kahvesi": 0}, "vp": 1, "gz": 2},
            "avanos": {"landmarks": {"comlek_atolyesi": 1, "comlekci_sokagi": 0, "asma_kopru": 0}, "vp": 1, "gz": 2},
            "yeralti": {"landmarks": {"yeralti_sehri": 1, "havalandirma": 0, "koy_cesmesi": 0}, "vp": 1, "gz": 2}},
          "stops": ["goreme_otogar", "goreme_kasaba", "balon_alani", "vadi_inis", "uchisar", "avanos", "derinkuyu"],
          "unlock": {
            "vadiler": {"after": "goreme", "level": 3},
            "balon": {"after": "goreme", "level": 3},
            "avanos": {"after": "goreme", "level": 4},
            "uchisar": {"after": "vadiler", "level": 4},
            "yeralti": {"after": "uchisar", "level": 5}},
          "quests": [
            {"id": "kaya_kiliseleri", "district": "goreme", "need": ["city:kapadokya:goreme:lm:kaya_kiliseleri", "city:kapadokya:goreme:lm:peri_bacalari"]},
            {"id": "vadi_patikasi", "district": "vadiler", "need": ["city:kapadokya:vadiler:gz:1", "city:kapadokya:vadiler:gz:2"]},
            {"id": "balon_turu", "district": "balon", "need": ["city:kapadokya:stop:balon_alani", "city:kapadokya:stop:vadi_inis"]},
            {"id": "kale_zirvesi", "district": "uchisar", "need": ["city:kapadokya:uchisar:in:uchisar_kalesi", "city:kapadokya:uchisar:vp:1"]},
            {"id": "comlek_atolyesi", "district": "avanos", "need": ["city:kapadokya:avanos:in:comlek_atolyesi", "city:kapadokya:avanos:lm:asma_kopru"]},
            {"id": "yeralti_kesfi", "district": "yeralti", "need": ["city:kapadokya:yeralti:in:yeralti_sehri", "city:kapadokya:yeralti:lm:havalandirma"]},
            {"id": "gun_batimi", "district": "vadiler", "need": ["city:kapadokya:vadiler:an:gun_batimi"]}]},
    },
}
# yeni şehirlerin pasaport girdileri (catalog.json `city`; ön yüz citymap/catalog.ts aynı dosyayı okur)
CITY_CATALOG["cities"].update({c: v["city"] for c, v in NEW_CITY_CATALOGS.items()})
if EDITION == "full":  # kaldırılan şehirlerin pasaport girdileri, özgün sırayla (studio/full)
    from studio.full.walk_explore import merge_city_catalog
    CITY_CATALOG["cities"] = merge_city_catalog(CITY_CATALOG["cities"])

CITY_SCHEMA = """
CREATE TABLE IF NOT EXISTS walk_city (
  id TEXT PRIMARY KEY, city TEXT NOT NULL, district TEXT, kind TEXT NOT NULL, ts REAL NOT NULL, day TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_walk_city_city ON walk_city(city);
"""

CITY_KINDS = ("district", "lm", "in", "vp", "gz", "an", "stop")
_CITY_RE = re.compile(r"^city:([a-z][a-z0-9_]{0,23}):([a-z][a-z0-9_]{0,23})(?::(lm|in|vp|gz|an):([a-z0-9_]{1,24}))?$")
_STOP_RE = re.compile(r"^city:([a-z][a-z0-9_]{0,23}):stop:([a-z][a-z0-9_]{0,23})$")


def ensure_city_schema(db: "GameDB") -> None:
    if getattr(db, "_city_schema", False):
        return
    with db._lock:
        db.conn.executescript(CITY_SCHEMA)
        # durak kaydı, görev semti kilitliyken alındıysa o semtleri tutar (`locked_for`, virgülle); eski satır NULL
        cols = {r[1] for r in db.conn.execute("PRAGMA table_info(walk_city)").fetchall()}
        if "locked_for" not in cols:
            db.conn.execute("ALTER TABLE walk_city ADD COLUMN locked_for TEXT")
            db.conn.commit()
    IPM.migrate(db)  # FREE-MAP-IP: eski pasaport damgaları ve duraklar yeni kimliklere
    db._city_schema = True  # type: ignore[attr-defined] # göç başarısızsa bayrak kalkmaz, yeniden denenir


def city_ids(city: str) -> tuple[str, ...]:
    """Şehrin bütün kimlikleri (damgalar + duraklar); sıra belirlenimci (arayüz `cityIds` ile aynı)."""
    c = CITY_CATALOG["cities"].get(city)
    if not c:
        return ()
    out: list[str] = []
    for d, spec in c["districts"].items():
        out.append(f"city:{city}:{d}")
        for lm, inn in spec["landmarks"].items():
            out.append(f"city:{city}:{d}:lm:{lm}")
            if inn:
                out.append(f"city:{city}:{d}:in:{lm}")
        out.extend(f"city:{city}:{d}:vp:{n}" for n in range(1, int(spec["vp"]) + 1))
        out.extend(f"city:{city}:{d}:gz:{n}" for n in range(1, int(spec.get("gz", 0)) + 1))
        out.extend(f"city:{city}:{d}:an:{a}" for a in spec.get("an", []))
    out.extend(f"city:{city}:stop:{s}" for s in c["stops"])
    return tuple(out)


CITY_ALL_IDS: frozenset[str] = frozenset(i for c in CITY_CATALOG["cities"] for i in city_ids(c))


def city_parse(id_: Any) -> dict[str, Any] | None:
    if not isinstance(id_, str):
        return None
    s = _STOP_RE.match(id_)
    if s:
        return {"city": s.group(1), "kind": "stop", "target": s.group(2), "district": None}
    m = _CITY_RE.match(id_)
    if not m or m.group(2) == "stop":
        return None
    city, district, kind, target = m.groups()
    if not kind:
        return {"city": city, "kind": "district", "district": district, "target": None}
    if kind in ("vp", "gz"):
        return {"city": city, "kind": kind, "district": district, "target": target} if re.fullmatch(r"[1-9][0-9]?", target) else None
    return {"city": city, "kind": kind, "district": district, "target": target} if target[0].isalpha() else None


TEST_CITIES: bool | None = None  # None → yalnız testte / STUDIO_DEV_CITIES=1 iken; testler zorlayabilir


def test_cities_enabled() -> bool:
    if TEST_CITIES is not None:
        return TEST_CITIES
    return "PYTEST_CURRENT_TEST" in os.environ or os.environ.get("STUDIO_DEV_CITIES") == "1"


def city_available(city: str) -> bool:
    """`test: 1` şehirleri (ör. sk0_test) üretim kataloğunda yok; damgalanamaz ve listelenmez."""
    c = CITY_CATALOG["cities"].get(city)
    return bool(c) and (not c.get("test") or test_cities_enabled())


def city_public() -> dict[str, Any]:
    """Şehir kataloğu özeti (GET /api/walk/city/catalog)."""
    return {"version": CITY_CATALOG["version"],
            "cities": {c: {"scene": v["scene"], "ids": list(city_ids(c))} for c, v in CITY_CATALOG["cities"].items()
                       if city_available(c)}}


def city_locked(city: str, found: set[str], level: int) -> list[str]:
    """kilitli semtler (kural sırasıyla). Semt açılır: önceki semte girilmiş ya da ofis seviyesi eşikte/üstünde."""
    c = CITY_CATALOG["cities"][city]
    return [d for d, u in c.get("unlock", {}).items() if f"city:{city}:{u['after']}" not in found and level < int(u["level"])]


def city_stale(rows: Iterable[Any]) -> dict[str, set[str]]:
    """kilitliyken kaydedilmiş duraklar → o anda kilitli olan görev semtleri."""
    out: dict[str, set[str]] = {}
    for r in rows:
        raw = r["locked_for"]
        if raw:
            out[r["id"]] = {d for d in str(raw).split(",") if d}
    return out


def city_quests(city: str, found: set[str], locked: Any = (), stale: dict[str, set[str]] | None = None
                ) -> list[dict[str, Any]]:
    """süresiz görevler ve ilerlemesi (kayıttan hesaplanır; saklanmaz). kilitli semtin görevi (ör. durak
    kayıtlarıyla dolan `istiklal_turu`) semt açılana kadar tamamlanmaz. görev semti kilitliyken kaydedilen durak
    (`stale`) görevi kilit açılınca kendiliğinden tamamlamaz; kullanıcı o semte girince (semt damgası) tamamlanır. Arayüz
    `questProgress` aynı kuralı uygular."""
    stale = stale or {}
    out = []
    for q in CITY_CATALOG["cities"][city].get("quests", []):
        got = sum(1 for i in q["need"] if i in found)
        entered = f"city:{city}:{q['district']}" in found
        early = any(q["district"] in stale.get(i, ()) for i in q["need"])
        out.append({"id": q["id"], "district": q["district"], "target": len(q["need"]), "progress": got,
                    "done": got == len(q["need"]) and q["district"] not in locked and (entered or not early)})
    return out


# katalog v2'de eklenen damgalar (v1 oyuncusu için "yeni" sayılır). Kayıt tutmayan eski oyuncunun görülmüş kümesi
# = bugünkü damgalar − bu liste. v3 ve sonrası bunu büyütmez: `walk:city_seen:<şehir>` kaydı tohumlanır.
CITY_V2_ADDED: frozenset[str] = frozenset({
    "city:istanbul:tarihi_yarimada:in:ayasofya",
    "city:istanbul:tarihi_yarimada:in:suleymaniye",
    "city:istanbul:tarihi_yarimada:in:sultanahmet",
})
if EDITION == "full":
    from studio.full.walk_explore import CITY_V2_ADDED_EXTRA
    CITY_V2_ADDED = CITY_V2_ADDED | CITY_V2_ADDED_EXTRA
CITY_SEEN_PREFIX = "walk:city_seen:"


def _city_stamps(city: str) -> list[str]:
    return [i for i in city_ids(city) if ":stop:" not in i]


def city_new_ids(db: "GameDB", city: str, found: set[str], persist: bool = True) -> list[str]:
    """oyuncu son baktığından beri kataloğa eklenen, henüz bulunmamış damgalar. Yüzde hesabı değişmez; bu yalnız
    "yüzde neden düştü" açıklamasıdır. Kayıt yoksa tohumlanır (hiç damgası yoksa her şey görülmüş; eski oyuncuda v2 eklentileri yeni)."""
    stamps = _city_stamps(city)
    raw = db.meta(CITY_SEEN_PREFIX + city)
    try:
        seen = set(json.loads(raw)) if raw else None
    except (ValueError, TypeError):
        seen = None
    if seen is None:
        mine = any(i in found for i in stamps)
        seen = set(stamps) - (CITY_V2_ADDED if mine else set())
        if persist:
            db.set_meta(CITY_SEEN_PREFIX + city, json.dumps(sorted(seen)))
    return [i for i in stamps if i not in seen and i not in found]


def city_seen_ack(svc: "WalkService", data: dict[str, Any]) -> dict[str, Any]:
    """"N yeni damga" bildirimini kapatır (şehrin bugünkü damgaları görülmüş sayılır; idempotent)."""
    from studio.walk.service import WalkError
    city = data.get("city")
    if not isinstance(city, str) or not city_available(city):
        raise WalkError(400, "Bilinmeyen şehir")
    ensure_city_schema(svc.game.db)
    svc.game.db.set_meta(CITY_SEEN_PREFIX + city, json.dumps(sorted(_city_stamps(city))))
    return {"ok": True, "city": city}


def _city_summary(city: str, found: set[str]) -> dict[str, Any]:
    c = CITY_CATALOG["cities"][city]
    ids = city_ids(city)
    stamps = [i for i in ids if ":stop:" not in i]
    districts: dict[str, dict[str, int]] = {}
    for d in c["districts"]:
        mine = [i for i in stamps if i == f"city:{city}:{d}" or i.startswith(f"city:{city}:{d}:")]
        got = sum(1 for i in mine if i in found)
        districts[d] = {"total": len(mine), "found": got, "percent": int(round(100 * got / len(mine))) if mine else 0}
    got_all = [i for i in stamps if i in found]
    return {"found": got_all, "stops": [i for i in ids if ":stop:" in i and i in found], "districts": districts,
            "total": len(stamps), "found_count": len(got_all),
            "percent": int(round(100 * len(got_all) / len(stamps))) if stamps else 0}


def city_state(svc: "WalkService", city: str | None = None) -> dict[str, Any]:
    from studio.walk.service import WalkError
    if city is not None and not city_available(city):
        raise WalkError(400, "Bilinmeyen şehir")
    g = svc.game
    ensure_city_schema(g.db)
    rows = [r for r in g.db.q("SELECT id, locked_for FROM walk_city") if r["id"] in CITY_ALL_IDS]
    found = {r["id"] for r in rows}
    stale = city_stale(rows)
    level = g.office_level()
    view_only = g.admin() or g.creative()
    cities = {}
    for c in CITY_CATALOG["cities"]:
        if (city is not None and c != city) or not city_available(c):
            continue
        locked = [] if view_only else city_locked(c, found, level)
        mine = {k: v for k, v in stale.items() if k.startswith(f"city:{c}:")}
        cities[c] = {**_city_summary(c, found), "locked": locked, "quests": city_quests(c, found, locked, mine),
                     "stale": {k: sorted(v) for k, v in mine.items()}, "new_ids": city_new_ids(g.db, c, found, not view_only)}
    return {"cities": cities, "admin": g.admin(), "level": level}


def city_visit(svc: "WalkService", data: dict[str, Any]) -> dict[str, Any]:
    """Şehir pasaportu / durak kaydı (kullanıcı-yalnız; idempotent; zincir: semt damgası önce)."""
    from studio.walk.service import WalkError
    city = data.get("city")
    if not isinstance(city, str) or not city_available(city):
        raise WalkError(400, "Bilinmeyen şehir")
    id_ = IPM.alias(data.get("id"))  # FREE-MAP-IP: eski istemcinin eski kimliği
    p = city_parse(id_)
    if p is None or p["city"] != city or id_ not in CITY_ALL_IDS:
        raise WalkError(400, "Bu kayıt bu şehrin listesinde yok")
    rid = svc._rid(data, "city")
    fp = svc._fp("city", city, id_)
    g = svc.game
    ensure_city_schema(g.db)
    scene = str(CITY_CATALOG["cities"][city]["scene"])
    bypass = svc._gate(g, scene)
    svc._rate()
    kind = p["kind"]
    stamp = kind != "stop"
    if bypass:
        return svc._view_only_reply(g, bypass, city=city, id=id_, kind=kind, stamp=stamp)
    now = time.time()
    day = R.day_of(now)
    with g._lock:
        with g.db.tx():
            prior = svc._replayed(g.db, rid, fp)
            if prior is not None:
                return prior
            prev_rows = g.db.q("SELECT id, locked_for FROM walk_city WHERE city=?", city)
            prev = {r["id"] for r in prev_rows}
            stale = city_stale(prev_rows)
            if p["district"] is not None and p["district"] in city_locked(city, prev, g.office_level()):
                raise WalkError(423, "Bu semt henüz kilitli")
            if kind in ("lm", "in", "vp", "gz", "an"):
                need = f"city:{city}:{p['district']}"
                if need not in prev:
                    raise WalkError(409, "Önce bu semte gir")
            svc._touch(g.db, now)
            already = id_ in prev
            lvl = g.office_level()
            locked_for: list[str] = []
            if not already:
                if kind == "stop":  # görev semti şu an kilitliyse kayıt bunu taşır
                    now_locked = set(city_locked(city, prev, lvl))
                    locked_for = sorted({q["district"] for q in CITY_CATALOG["cities"][city].get("quests", [])
                                         if id_ in q["need"] and q["district"] in now_locked})
                g.db.exec("INSERT INTO walk_city(id,city,district,kind,ts,day,locked_for) VALUES(?,?,?,?,?,?,?)",
                          id_, city, p["district"], kind, now, day, ",".join(locked_for) or None)
            found = prev | {id_}
            stale_after = {**stale, **({id_: set(locked_for)} if locked_for else {})}
            summary = _city_summary(city, found)
            done_before = {q["id"] for q in city_quests(city, prev, city_locked(city, prev, lvl), stale) if q["done"]}
            completed = [q["id"] for q in city_quests(city, found, city_locked(city, found, lvl), stale_after)
                         if q["done"] and q["id"] not in done_before]
            resp = {"ok": True, "already": already, "admin": False, "recorded": not already, "city": city, "id": id_,
                    "kind": kind, "stamp": stamp, "district": p["district"],
                    "progress": {"found": summary["found_count"], "total": summary["total"], "percent": summary["percent"]},
                    "quests_completed": completed, "locked": city_locked(city, found, g.office_level()),
                    "locked_for": locked_for}
            svc._remember(g.db, rid, resp, now, fp)
    events: list[tuple[str, dict[str, Any]]] = []
    if not already:
        events.append(("walk.city", {"city": city, "id": id_, "kind": kind, "quests": resp["quests_completed"]}))
    return {**resp, "events": events}
