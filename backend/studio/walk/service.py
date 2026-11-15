"""Yürüme modu W4 ilerleme servisi. Sözleşme:.

Veri `game.sqlite` içinde eklemeli `walk_*` tablolarındadır (graf belleğine yazılmaz, §10.1). Ödüller mevcut oyun
servisinin yollarından geçer (jeton defteri, `HUMAN_RULES`, sayaç → başarım, görev sinyali) ve hepsi idempotenttir.

İlkeler:
- Yürümek, beklemek ve konum yazmak hiçbir ödül vermez. Ödül yalnızca sonlu (hatıra) ya da sunucuda doğrulanan
  (koşu, çıktı) olaylardan ve günlük sınırlar içinde gelir.
- Vize koleksiyondur: jeton vermez, şehir açan damga sayacına (`city_flows`) ve envantere dokunmaz.
- Mini oyun kartları kozmetiktir: jeton ve XP yok; kart başarımları `special` (ödülsüz) rozettir.
- Yönetici / test modunda ilerleme yazılmaz ve ödül yoktur (konum hariç; ödül değildir).
- Sahne açıklığı GERÇEK sahipliktir: yaratıcı mod ve yönetici modu kilitli sahneyi yalnızca görüntülemek için açar; orada
  hatıra/vize kaydı ve ödül yoktur (FIX-SEC, QA).
- Günlük jeton sınırından sonra bulunan hatıra kaydedilir ama ödenmez (`paid: false, reason: "daily_cap"`).
"""

from __future__ import annotations

import json
import math
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from studio.game import rules as R
from studio.walk import avatar as AV
from studio.walk import catalog as W
from studio.walk import explore as EX
from studio.walk import ipmigrate as IPM

if TYPE_CHECKING:
    from studio.api import Studio
    from studio.game.db import GameDB
    from studio.game.service import GameService

WALK_SCHEMA = """
CREATE TABLE IF NOT EXISTS walk_state (
  world TEXT PRIMARY KEY, x REAL NOT NULL, z REAL NOT NULL, facing REAL NOT NULL, view TEXT NOT NULL,
  updated REAL NOT NULL);
CREATE TABLE IF NOT EXISTS walk_found (
  item TEXT PRIMARY KEY, world TEXT NOT NULL, ts REAL NOT NULL, day TEXT NOT NULL, coins INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_walk_found_day ON walk_found(day);
CREATE TABLE IF NOT EXISTS walk_visas (
  landmark TEXT PRIMARY KEY, world TEXT NOT NULL, ts REAL NOT NULL, day TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS walk_cards (
  card TEXT PRIMARY KEY, count INTEGER NOT NULL, first_ts REAL NOT NULL, updated REAL NOT NULL);
CREATE TABLE IF NOT EXISTS walk_card_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, card TEXT NOT NULL, added INTEGER NOT NULL,
  migration INTEGER NOT NULL DEFAULT 0, ts REAL NOT NULL);
CREATE INDEX IF NOT EXISTS ix_walk_card_log_day ON walk_card_log(day, migration);
CREATE TABLE IF NOT EXISTS walk_visits (
  day TEXT NOT NULL, agent TEXT NOT NULL, ts REAL NOT NULL, PRIMARY KEY (day, agent));
CREATE TABLE IF NOT EXISTS walk_events (
  key TEXT PRIMARY KEY, type TEXT NOT NULL, ref TEXT NOT NULL, ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS walk_requests (
  request_id TEXT PRIMARY KEY, response TEXT NOT NULL, ts REAL NOT NULL);
"""

LAST_USED_KEY = "walk:last_used"
MIGRATED_KEY = "walk:cards_migrated"
AVATAR_KEY = "walk:avatar"


class WalkError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def ensure_schema(db: "GameDB") -> None:
    """`walk_*` tablolarını eklemeli olarak kurar (bağlantı başına bir kez; işlem dışında çağrılır)."""
    if getattr(db, "_walk_schema", False):
        return
    with db._lock:
        db.conn.executescript(WALK_SCHEMA)
        db._walk_schema = True  # type: ignore[attr-defined]
    IPM.migrate(db)  # FREE-MAP-IP: eski simge vizesi kimlikleri yenilerine


def _human() -> tuple[str, str]:
    from studio.game.service import HUMAN
    return HUMAN


def _iso_ts(value: Any) -> float | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _xp_max(rule: str) -> int:
    xp, cap = R.HUMAN_RULES[rule]
    return xp * (cap or 0)


def open_scenes(g: "GameService") -> list[str]:
    """Sahibi olunan ya da her zaman açık sahneler (yönetici atlaması sayılmaz: gerçek sahiplik)."""
    return [s for s in W.SCENES if g.is_owned(f"scene:{s}", bypass=False)]


def quest_facts(g: "GameService", now: float | None = None) -> dict[str, Any]:
    """`requires: walk*` görev şablonları için gerçekler (game.service.gather_facts çağırır)."""
    ensure_schema(g.db)
    now = now or time.time()
    last = float(g.db.meta(LAST_USED_KEY) or 0)
    found = {r["item"] for r in g.db.q("SELECT item FROM walk_found")}
    visas = {r["landmark"] for r in g.db.q("SELECT landmark FROM walk_visas")}
    scenes = open_scenes(g)
    left = {s: sum(1 for i in W.souvenir_ids(s) if i not in found) for s in scenes}
    return {"walk": bool(last) and now - last <= W.WALK_ACTIVE_DAYS * 86400,
            "walk_souvenirs": sum(left.values()),
            "walk_souvenir_scenes": sum(1 for n in left.values() if n > 0),
            "walk_landmarks": sum(1 for s in scenes for i in W.landmark_ids(s) if i not in visas)}


class WalkService:
    def __init__(self, studio: "Studio"):
        self.studio = studio
        self._rl_lock = threading.Lock()
        self._writes: deque[float] = deque()
        self._pos_last: dict[str, float] = {}

    # ------------------------------------------------------------------ yardımcılar
    @property
    def game(self) -> "GameService":
        from studio.game.api import get_service
        g = get_service(self.studio)
        ensure_schema(g.db)
        EX.ensure_schema(g.db)  # WALK-EXPLORE: keşif tabloları (paylaşılan günlük jeton sınırı collect'te de okunur)
        return g

    def _rate(self) -> None:
        now = time.monotonic()
        with self._rl_lock:
            while self._writes and now - self._writes[0] > 60:
                self._writes.popleft()
            if len(self._writes) >= W.WRITES_PER_MIN:
                raise WalkError(429, "Çok fazla istek; biraz bekle")
            self._writes.append(now)

    @staticmethod
    def _rid(data: dict[str, Any], route: str) -> str | None:
        raw = data.get("client_request_id")
        if raw is None or raw == "":
            return None
        if not isinstance(raw, str) or len(raw) > 80:
            raise WalkError(400, "client_request_id en çok 80 karakterlik metin olmalı")
        return f"{route}:{raw}"

    @staticmethod
    def _fp(*parts: Any) -> str:
        """İsteğin kimliği (W5, QA): aynı `client_request_id` başka bir gövdeyle gelirse eski yanıt dönmez, 409 olur."""
        return json.dumps(parts, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    @staticmethod
    def _replayed(db: "GameDB", rid: str | None, fp: str | None = None) -> dict[str, Any] | None:
        if not rid:
            return None
        row = db.one("SELECT response FROM walk_requests WHERE request_id=?", rid)
        if row is None:
            return None
        body = json.loads(row["response"])
        stored = body.pop("_fp", None)
        # Eski kayıtlarda parmak izi yok: eski davranış (yanıtı yeniden oynat)
        if fp is not None and stored is not None and stored != fp:
            raise WalkError(409, "Bu istek kimliği başka bir istek için kullanıldı")
        return {**body, "already": True, "events": []}

    @staticmethod
    def _remember(db: "GameDB", rid: str | None, resp: dict[str, Any], now: float, fp: str | None = None) -> None:
        if rid:
            body = {k: v for k, v in resp.items() if k != "events"}
            if fp is not None:
                body["_fp"] = fp
            db.exec("INSERT OR IGNORE INTO walk_requests(request_id,response,ts) VALUES(?,?,?)", rid,
                    json.dumps(body, ensure_ascii=False), now)

    @staticmethod
    def _touch(db: "GameDB", now: float) -> None:
        db.set_meta(LAST_USED_KEY, now)

    def _scene_open(self, g: "GameService", scene: str) -> bool:
        """Gerçek sahiplik (ya da her zaman açık sahne); yaratıcı mod ve yönetici modu sayılmaz."""
        return g.is_owned(f"scene:{scene}", bypass=False)

    def _view_only(self, g: "GameService", scene: str) -> str | None:
        """Kilitli sahne yalnızca görüntüleme atlamasıyla mı açık: "admin" / "creative"; açık ya da kilitliyse None."""
        if self._scene_open(g, scene):
            return None
        if g.admin():
            return "admin"
        if g.creative():
            return "creative"
        return None

    def _gate(self, g: "GameService", world: str) -> str | None:
        """Sahne yazma kapısı: gerçek sahip → None (kaydet); görüntüleme atlaması → neden (kaydetme); değilse 403.
        Yönetici modu her sahnede kayıtsızdır (önceki davranış)."""
        if g.admin():
            return "admin"
        if self._scene_open(g, world):
            return None
        if g.creative():
            return "creative"
        raise WalkError(403, "Bu sahne açık değil")

    def _album(self, db: "GameDB", scene: str) -> dict[str, Any]:
        ids = W.souvenir_ids(scene)
        found = int(db.scalar("SELECT COUNT(*) FROM walk_found WHERE world=?", scene))
        return {"found": found, "total": len(ids), "complete": bool(ids) and found >= len(ids)}

    def _collection(self, db: "GameDB") -> dict[str, int]:
        return {r["card"]: int(r["count"]) for r in db.q("SELECT card, count FROM walk_cards ORDER BY card")
                if int(r["count"]) > 0}

    def _admin_reply(self, g: "GameService", **extra: Any) -> dict[str, Any]:
        with g._lock:
            self._touch(g.db, time.time())
        return {"ok": True, "already": False, "admin": True, "recorded": False, **extra, "events": []}

    def _view_only_reply(self, g: "GameService", reason: str, **extra: Any) -> dict[str, Any]:
        """Yaratıcı/yönetici atlamasıyla görülen kilitli sahne: hiçbir şey kaydedilmez, ödül yok."""
        if reason == "admin":
            return self._admin_reply(g, **extra, paid=False, reason="admin")
        with g._lock:
            self._touch(g.db, time.time())
        return {"ok": True, "already": False, "admin": False, "creative": True, "recorded": False, **extra,
                "paid": False, "reason": "creative", "events": []}

    # ------------------------------------------------------------------ okuma
    def state(self, world: str | None = None) -> dict[str, Any]:
        g = self.game
        db = g.db
        if world is not None and not W.valid_world(world):
            raise WalkError(400, "Geçersiz dünya kimliği")
        now = time.time()
        day = R.day_of(now)
        position = None
        scene = None
        if world:
            row = db.one("SELECT * FROM walk_state WHERE world=?", world)
            if row is not None:
                position = {"x": row["x"], "z": row["z"], "facing": row["facing"], "view": row["view"],
                            "updated": row["updated"]}
        found_rows = db.q("SELECT item, world FROM walk_found ORDER BY ts, item")
        visa_rows = db.q("SELECT landmark, world, ts FROM walk_visas ORDER BY ts, landmark")
        found = [r["item"] for r in found_rows]
        visas = [r["landmark"] for r in visa_rows]
        if world and W.is_scene(world):
            sid = W.souvenir_ids(world)
            lid = W.landmark_ids(world)
            sf = [i for i in sid if i in set(found)]
            scene = {"id": world, "open": self._scene_open(g, world), "view_only": self._view_only(g, world),
                     "souvenirs": {"ids": list(sid), "found": sf, "total": len(sid), "complete": len(sf) == len(sid)},
                     "landmarks": {"ids": list(lid), "found": [i for i in lid if i in set(visas)]}}
        albums: dict[str, dict[str, Any]] = {}
        for r in found_rows:
            albums.setdefault(r["world"], {"found": 0, "total": W.SOUVENIRS_PER_SCENE, "complete": False})
            albums[r["world"]]["found"] += 1
        for a in albums.values():
            a["complete"] = a["found"] >= a["total"]
        human = _human()

        def rule_used(rule: str) -> int:
            return int(db.scalar("SELECT COALESCE(SUM(amount),0) FROM game_ledger WHERE rule=? AND subject_type=? "
                                 "AND subject_id=? AND day=?", rule, human[0], human[1], day))

        avatar, avatar_name = AV.parse_stored(db.meta(AVATAR_KEY))
        avatar = AV.visible(g, avatar)
        return {
            "world": world, "position": position, "scene": scene, "found": found,
            "visas": [{"id": r["landmark"], "world": r["world"], "ts": r["ts"]} for r in visa_rows],
            "albums": albums, "albums_complete": sum(1 for a in albums.values() if a["complete"]),
            "cards": {"collection": self._collection(db), "migrated": db.meta(MIGRATED_KEY) == "1"},
            "limits": {
                "day": day,
                "souvenir_coins": {"used": EX.coins_used_today(db, day), "max": W.SOUVENIR_COINS_PER_DAY},
                "cards": {"used": int(db.scalar("SELECT COALESCE(SUM(added),0) FROM walk_card_log WHERE day=? AND "
                                                "migration=0", day)), "max": W.CARDS_PER_DAY},
                "visit_xp": {"used": rule_used("walk_visit"), "max": _xp_max("walk_visit")},
                "discover_xp": {"used": rule_used("walk_discover"), "max": _xp_max("walk_discover")},
            },
            "admin": g.admin(), "avatar": avatar, "avatar_name": avatar_name,
        }

    def cards(self) -> dict[str, Any]:
        g = self.game
        return {"collection": self._collection(g.db), "migrated": g.db.meta(MIGRATED_KEY) == "1",
                "catalog": list(W.CARDS), "admin": g.admin()}

    # ------------------------------------------------------------------ konum (ödülsüz)
    def position(self, data: dict[str, Any]) -> dict[str, Any]:
        world = data.get("world")
        if not W.valid_world(world):
            raise WalkError(400, "Geçersiz dünya kimliği")
        vals: dict[str, float] = {}
        for key in ("x", "z", "facing"):
            v = data.get(key, 0.0 if key == "facing" else None)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                raise WalkError(400, "Konum değerleri sonlu sayı olmalı")
            vals[key] = float(v)
        if abs(vals["x"]) > W.COORD_LIMIT or abs(vals["z"]) > W.COORD_LIMIT:
            raise WalkError(400, "Konum sınır dışında")
        facing = (vals["facing"] + math.pi) % (2 * math.pi) - math.pi
        view = data.get("view") or "third"
        if view not in W.VIEWS:
            raise WalkError(400, "Görünüm third ya da first olmalı")
        mono = time.monotonic()
        with self._rl_lock:
            last = self._pos_last.get(str(world))
            if last is not None and mono - last < W.POSITION_MIN_INTERVAL_S:
                raise WalkError(429, "Konum çok sık kaydediliyor")
            self._pos_last[str(world)] = mono
        g = self.game
        now = time.time()
        with g._lock, g.db.tx():
            g.db.exec("INSERT INTO walk_state(world,x,z,facing,view,updated) VALUES(?,?,?,?,?,?) "
                      "ON CONFLICT(world) DO UPDATE SET x=excluded.x, z=excluded.z, facing=excluded.facing, "
                      "view=excluded.view, updated=excluded.updated", world, vals["x"], vals["z"], facing, view, now)
            self._touch(g.db, now)
        return {"ok": True, "position": {"world": world, "x": vals["x"], "z": vals["z"], "facing": facing,
                                         "view": view, "updated": now}}

    # ------------------------------------------------------------------ W5: "Ben" avatarı (ödülsüz)
    def put_avatar(self, data: dict[str, Any]) -> dict[str, Any]:
        """Avatar görünümünü kaydeder (D1 A: `game_meta['walk:avatar']`). Ödül, XP ve sayaç üretmez; yönetici modunda da
        kaydedilir (konum gibi; ödül değildir). Kilitli kozmetik 403, geçersiz parça 400."""
        try:
            avatar = AV.normalize(data.get("avatar"))
            name = AV.clean_name(data.get("name"))
        except AV.AvatarError as exc:
            raise WalkError(exc.status, exc.message) from exc
        self._rate()
        g = self.game
        current, _ = AV.parse_stored(g.db.meta(AVATAR_KEY))
        try:
            AV.check_owned(g, avatar, current)
        except AV.AvatarError as exc:
            raise WalkError(exc.status, exc.message) from exc
        now = time.time()
        with g._lock, g.db.tx():
            g.db.set_meta(AVATAR_KEY, json.dumps({"avatar": avatar, "name": name}, ensure_ascii=False, sort_keys=True))
        return {"ok": True, "avatar": avatar, "name": name, "updated": now, "admin": g.admin(),
                "events": [("walk.avatar", {"name": name})]}

    # ------------------------------------------------------------------ hatıra
    def _scene_item(self, data: dict[str, Any], field: str, ids_of: Any, label: str) -> tuple[str, str]:
        world = data.get("world")
        if not W.is_scene(world):
            raise WalkError(400, "Bilinmeyen sahne")
        item = data.get(field)
        if not isinstance(item, str) or item not in ids_of(world):
            raise WalkError(400, f"Bu {label} bu sahnenin listesinde yok")
        return str(world), item

    def collect(self, data: dict[str, Any]) -> dict[str, Any]:
        world, item = self._scene_item(data, "item", W.souvenir_ids, "hatıra")
        rid = self._rid(data, "collect")
        fp = self._fp("collect", world, item)
        g = self.game
        bypass = self._gate(g, world)  # yönetici / yaratıcı: kilit yalnızca görüntüleme için açılır, kayıt yok
        self._rate()
        if bypass:
            return self._view_only_reply(g, bypass, world=world, item=item, coins=0, capped=False,
                                         balance=g.db.balance(), album=self._album(g.db, world))
        now = time.time()
        day = R.day_of(now)
        human = _human()
        events: list[tuple[str, dict[str, Any]]] = []
        with g._lock:
            with g.db.tx():
                prior = self._replayed(g.db, rid, fp)
                if prior is not None:
                    return prior
                self._touch(g.db, now)
                already = g.db.one("SELECT 1 FROM walk_found WHERE item=?", item) is not None
                coins = 0
                capped = False
                just_completed = False
                if not already:
                    # WALK-EXPLORE: keşif jetonu da aynı günlük yürüme sınırını paylaşır (explore.coins_used_today)
                    used = int(g.db.scalar("SELECT COALESCE(SUM(coins),0) FROM walk_found WHERE day=?", day))                         + EX.explore_coins_today(g.db, day)
                    if used + W.SOUVENIR_COINS <= W.SOUVENIR_COINS_PER_DAY:
                        coins = W.SOUVENIR_COINS
                    else:
                        capped = True
                    g.db.exec("INSERT INTO walk_found(item,world,ts,day,coins) VALUES(?,?,?,?,?)",
                              item, world, now, day, coins)
                    if coins:
                        g.db.add_coins(f"walk:souvenir:{item}", now, day, coins, "walk",
                                       f"Hatıra: {item} (+{coins} jeton)", ref=item)
                    g._human("walk_discover", f"walk_discover:v1:{item}", now, "Hatıra buldun")
                    g._bump(*human, "souvenirs_found", item, now)
                    album = self._album(g.db, world)
                    if album["complete"]:
                        just_completed = g._bump(*human, "albums_completed", world, now) is not None
                        if just_completed:
                            g.db.feed(now, "walk", *human, f"Albüm tamamlandı: {world}", None,
                                      {"world": world, "album": True})
                    g.db.feed(now, "walk", *human, f"Hatıra bulundu: {item}", coins or None,
                              {"world": world, "item": item})
                    g._quest_signal("walk_souvenir", item, now, value=world)
                    events = g._drain()
                album = {**self._album(g.db, world), "just_completed": just_completed}
                # Günlük sınırdan sonra bulunan hatıra kaydedilir (albüm, XP, görev) ama ödenmez; yanıt bunu söyler
                paid = bool(coins)
                reason = None if paid else ("already_found" if already else "daily_cap" if capped else None)
                resp = {"ok": True, "already": already, "admin": False, "recorded": not already, "world": world,
                        "item": item, "coins": coins, "capped": capped, "paid": paid, "reason": reason,
                        "balance": g.db.balance(), "album": album}
                self._remember(g.db, rid, resp, now, fp)
        if not already:
            events.append(("walk.collected", {"world": world, "item": item, "coins": coins, "album": album}))
        return {**resp, "events": events}

    # ------------------------------------------------------------------ simge vizesi (şehir açmaz)
    def discover(self, data: dict[str, Any]) -> dict[str, Any]:
        if isinstance(data, dict):  # FREE-MAP-IP: eski istemcinin eski simge kimliği
            data = {**data, "landmark": IPM.alias(data.get("landmark"))}
        world, landmark = self._scene_item(data, "landmark", W.landmark_ids, "simge")
        rid = self._rid(data, "discover")
        fp = self._fp("discover", world, landmark)
        g = self.game
        bypass = self._gate(g, world)  # yönetici / yaratıcı: vize, kaşif ilerlemesi ve XP yazılmaz
        self._rate()
        if bypass:
            return self._view_only_reply(g, bypass, world=world, landmark=landmark, coins=0,
                                         visas=int(g.db.scalar("SELECT COUNT(*) FROM walk_visas")))
        now = time.time()
        human = _human()
        events: list[tuple[str, dict[str, Any]]] = []
        with g._lock:
            with g.db.tx():
                prior = self._replayed(g.db, rid, fp)
                if prior is not None:
                    return prior
                self._touch(g.db, now)
                already = g.db.one("SELECT 1 FROM walk_visas WHERE landmark=?", landmark) is not None
                if not already:
                    g.db.exec("INSERT INTO walk_visas(landmark,world,ts,day) VALUES(?,?,?,?)", landmark, world, now,
                              R.day_of(now))
                    g._human("walk_discover", f"walk_discover:v1:{landmark}", now, "Simge keşfettin")
                    g._bump(*human, "visas", landmark, now)
                    g.db.feed(now, "walk", *human, f"Vize: {landmark}", None, {"world": world, "landmark": landmark})
                    g._quest_signal("walk_visa", landmark, now, value=world)
                    events = g._drain()
                visas = int(g.db.scalar("SELECT COUNT(*) FROM walk_visas"))
                resp = {"ok": True, "already": already, "admin": False, "recorded": not already, "world": world,
                        "landmark": landmark, "visas": visas, "coins": 0}
                self._remember(g.db, rid, resp, now, fp)
        if not already:
            events.append(("walk.discovered", {"world": world, "landmark": landmark, "visas": visas}))
        return {**resp, "events": events}

    # ------------------------------------------------------------------ ajan ziyareti
    def visit(self, data: dict[str, Any]) -> dict[str, Any]:
        slug = data.get("agent")
        if not isinstance(slug, str) or not slug or self.studio.store.find("Agent", slug) is None:
            raise WalkError(404, "Ajan yok")
        rid = self._rid(data, "visit")
        fp = self._fp("visit", slug)
        g = self.game
        self._rate()
        if g.admin():
            return self._admin_reply(g, agent=slug, xp=0)
        now = time.time()
        day = R.day_of(now)
        with g._lock:
            with g.db.tx():
                prior = self._replayed(g.db, rid, fp)
                if prior is not None:
                    return prior
                self._touch(g.db, now)
                fresh = g.db.exec("INSERT OR IGNORE INTO walk_visits(day,agent,ts) VALUES(?,?,?)", day, slug, now) == 1
                xp = g._human("walk_visit", f"walk_visit:v1:{day}:{slug}", now, "Ajan ziyareti") if fresh else 0
                events = g._drain()
                resp = {"ok": True, "already": not fresh, "admin": False, "recorded": fresh, "agent": slug, "xp": xp}
                self._remember(g.db, rid, resp, now, fp)
        return {**resp, "events": events}

    # ------------------------------------------------------------------ gerçek işe bağlı olay (sunucu doğrular)
    def _run(self, run_id: str) -> dict[str, Any] | None:
        engine = getattr(self.studio, "engine", None)
        live = getattr(engine, "runs", {}).get(run_id) if engine is not None else None
        if live is not None:
            return {"origin": live.origin, "started_at": live.started_at}
        node = self.studio.store.find("Run", run_id)
        return dict(node["props"]) if node else None

    def event(self, data: dict[str, Any]) -> dict[str, Any]:
        etype = data.get("type")
        if etype not in W.EVENT_TYPES:
            raise WalkError(400, "Bilinmeyen olay türü")
        ref = data.get("ref")
        if not isinstance(ref, str) or not ref or len(ref) > 200:
            raise WalkError(400, "ref gerekli")
        rid = self._rid(data, "event")
        fp = self._fp("event", etype, ref)
        now = time.time()
        day = R.day_of(now)
        if etype == "run_started":
            run = self._run(ref)
            if run is None:
                raise WalkError(404, "Çalıştırma yok")
            origin = str(run.get("origin") or "")
            if origin.startswith("mcp:"):
                raise WalkError(400, "MCP ile başlatılan koşu sayılmaz")
            if origin != "ui":
                raise WalkError(400, "Yalnızca arayüzden başlatılan koşu sayılır")
            started = _iso_ts(run.get("started_at"))
            if started is None or now - started > W.RUN_FRESH_S:
                raise WalkError(409, "Koşu çok eski; yeni başlatılan koşu sayılır")
            key, signal, qkey = f"run_started:{ref}", "walk_run", ref
        else:
            node = self.studio.store.find("Deliverable", ref)
            if node is None:
                raise WalkError(404, "Çıktı yok")
            agent = (node.get("props") or {}).get("agent")
            if not agent:
                raise WalkError(400, "Bu çıktı bir ajana ait değil")
            key, signal, qkey = f"deliverable_viewed:{day}:{ref}", "walk_review", str(agent)
        g = self.game
        self._rate()
        if g.admin():
            return self._admin_reply(g, type=etype, ref=ref, counted=False)
        with g._lock:
            with g.db.tx():
                prior = self._replayed(g.db, rid, fp)
                if prior is not None:
                    return prior
                self._touch(g.db, now)
                fresh = g.db.exec("INSERT OR IGNORE INTO walk_events(key,type,ref,ts) VALUES(?,?,?,?)",
                                  key, etype, ref, now) == 1
                if fresh:
                    g._quest_signal(signal, qkey, now)
                events = g._drain()
                resp = {"ok": True, "already": not fresh, "admin": False, "recorded": fresh, "type": etype, "ref": ref,
                        "counted": fresh}
                self._remember(g.db, rid, resp, now, fp)
        return {**resp, "events": events}

    # ------------------------------------------------------------------ mini oyun kartları (kozmetik)
    @staticmethod
    def _validate_cards(raw: Any) -> dict[str, int]:
        if not isinstance(raw, dict):
            raise WalkError(400, "cards bir nesne olmalı")
        out: dict[str, int] = {}
        for cid, n in raw.items():
            if cid not in W.CARDS:
                raise WalkError(400, "Bilinmeyen kart")
            if isinstance(n, bool) or not isinstance(n, int) or n < 0:
                raise WalkError(400, "Kart adedi pozitif tam sayı olmalı")
            out[cid] = min(W.CARD_MAX, n)
        return out

    def sync_cards(self, data: dict[str, Any]) -> dict[str, Any]:
        cards = self._validate_cards(data.get("cards"))
        rid = self._rid(data, "cards")
        fp = self._fp("cards", cards)
        g = self.game
        self._rate()
        if g.admin():
            return self._admin_reply(g, migration=False, collection=self._collection(g.db), added={}, capped=False,
                                     new_cards=[])
        now = time.time()
        day = R.day_of(now)
        human = _human()
        events: list[tuple[str, dict[str, Any]]] = []
        with g._lock:
            with g.db.tx():
                prior = self._replayed(g.db, rid, fp)
                if prior is not None:
                    return prior
                self._touch(g.db, now)
                server = self._collection(g.db)
                migration = not server and g.db.meta(MIGRATED_KEY) != "1"
                used = int(g.db.scalar("SELECT COALESCE(SUM(added),0) FROM walk_card_log WHERE day=? AND migration=0",
                                       day))
                remaining = max(0, W.CARDS_PER_DAY - used)
                added: dict[str, int] = {}
                capped = False
                for cid in sorted(cards):
                    have = server.get(cid, 0)
                    want = cards[cid]
                    if want <= have:
                        continue
                    inc = want - have if migration else min(want - have, remaining)
                    if inc < want - have:
                        capped = True
                    if inc <= 0:
                        continue
                    if not migration:
                        remaining -= inc
                    g.db.exec("INSERT INTO walk_cards(card,count,first_ts,updated) VALUES(?,?,?,?) "
                              "ON CONFLICT(card) DO UPDATE SET count=excluded.count, updated=excluded.updated",
                              cid, have + inc, now, now)
                    g.db.exec("INSERT INTO walk_card_log(day,card,added,migration,ts) VALUES(?,?,?,?,?)",
                              day, cid, inc, 1 if migration else 0, now)
                    added[cid] = inc
                if migration and added:
                    g.db.set_meta(MIGRATED_KEY, 1)
                collection = self._collection(g.db)
                new_cards = [c for c in added if server.get(c, 0) == 0]
                # Ödülsüz rozetler (special): kart jeton/XP vermez (D2 A)
                g._set_max(*human, "fish_cards", sum(1 for c in collection if c.startswith("fish:")), now)
                g._set_max(*human, "board_wins", collection.get("board", 0), now)
                events = g._drain()
                resp = {"ok": True, "already": False, "admin": False, "recorded": bool(added), "migration": migration,
                        "collection": collection, "added": added, "capped": capped, "new_cards": new_cards}
                self._remember(g.db, rid, resp, now, fp)
        if added:
            events.append(("walk.cards", {"added": added}))
        return {**resp, "events": events}
