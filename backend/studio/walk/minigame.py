"""mini oyun ortak motoru: genel tur defteri + TEK günlük mini oyun jeton havuzu (karar K3).

Sözleşme: "Mini oyun motoru"; tasarım:; etik:.

Havuz (K3): bütün mini oyunlar (olta dahil) günde EN ÇOK `POOL_COINS_PER_DAY` (30) jeton öder; yürüme (hatıra + keşif) kendi
20'lik sınırında ayrı kalır. Havuz ayrı bir sayaç değildir: o günün `game_coins` satırlarından (`walk:fish:*` ve `walk:mg:*`
anahtarları) hesaplanır. Böylece bu sürümden önce bugün oltadan kazanılmış jeton havuza kendiliğinden sayılır (göç adımı yok,
hiçbir satır silinmez ya da düşülmez: kimse kazandığını kaybetmez); havuz yalnız SONRAKİ ödemeleri sınırlar.

Tür kaydı (`KINDS`; ön yüz `voxel/fun/minigames.ts MINIGAMES` ile eşlik testi `test_walk_minigame.py`):
- `ledger="fishing"`: olta kendi uçlarını kullanır (`/api/walk/fish/*`, walk/fishing.py); ödemesi bu havuzdan (`pool_used`).
- `ledger="generic"`:..28 oyunları. `setup(rnd, assist) -> (gizli, açık)` sunucuda turu kurar (gizli kısım istemciye
  gitmez), `judge(gizli, gövde, geçen_ms) -> (sonuç, taban_jeton)` sonucu sunucu saatiyle ve gizli parametreyle değerlendirir.
  Uçlar `/api/walk/minigame/{start,cue,finish}` (yalnız kullanıcı: `USER_ONLY_RE` `walk/`).
- `ledger="local"`: yerel oyun (masa, atış): jeton yok, yalnız kozmetik kart.

Tur defteri kuralları (genel): tür başına tek açık tur (yeni tur öncekini `abandoned` yapar); tür başına başlatma aralığı
(`start_interval_s`, yoksa 429) ve yürüme yazma hız sınırı (60/dk, 429); `client_request_id` + parmak izi ile idempotent
(aynı istek → saklı yanıt; aynı kimlik başka gövde → 409); bitmiş/bırakılmış turu yeniden bitirmek 409; `min_ms`'ten kısa ya da
yargıcın geçersiz saydığı bitiş 409 (tur açık kalır); `max_ms` + ağ payını aşan bitiş `expired` (jeton yok). Jeton anahtarı
`walk:mg:<tür>:<tur>` ile `INSERT OR IGNORE` (yarışta çift ödeme yok). Azalan getiri: tür başına günün ilk `FULL_ROUNDS` ödenen
turu tam, sonrası yarım (en az 1). Yönetici modu ve kilitli sahnenin görüntülemesi: oynanır, jeton yok.

Zamanlama gizliliği: açık parametrelerde ve başlatma yanıtında zaman bilgisi olmaz (`_check_public`). İşaret ("şimdi!") gereken
oyunlar gizli `cue_ms` tutar; istemci `cue` ucunu çağırır, sunucu o ana dek BEKLER ve yalnız `{cue: true}` döner (uzun yoklama;
yanıtta zaman damgası yok). Olta da aynı deseni kullanır: `/api/walk/fish/bite` (`fish_cue`), `bite_ms` yanıttan çıkarılır
(`client_view`).
"""

from __future__ import annotations

import json
import random
import re
import secrets
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable

from studio.game import rules as R
from studio.walk import catalog as W

if TYPE_CHECKING:
    from studio.game.db import GameDB
    from studio.walk.service import WalkService

MG_SCHEMA = """
CREATE TABLE IF NOT EXISTS walk_mg_rounds (
  round_id TEXT PRIMARY KEY, kind TEXT NOT NULL, world TEXT NOT NULL, ts REAL NOT NULL, day TEXT NOT NULL,
  assist INTEGER NOT NULL DEFAULT 0, secret TEXT NOT NULL, pay TEXT, state TEXT NOT NULL DEFAULT 'open', result TEXT,
  coins INTEGER NOT NULL DEFAULT 0, finish_ts REAL, response TEXT);
CREATE INDEX IF NOT EXISTS ix_walk_mg_day ON walk_mg_rounds(day, kind, state);
"""

# ---------------------------------------------------------------- havuz (K3)
POOL_COINS_PER_DAY = 30              # bütün mini oyunlar (olta dahil) için tek günlük tavan; yürüme 20 ayrı
POOL_KEYS: tuple[str, ...] = ("walk:fish:", "walk:mg:")   # havuza sayılan `game_coins.idem` önekleri
FULL_ROUNDS = 3                      # genel oyunlarda tür başına günün ilk 3 ödenen turu tam, sonrası yarım
FINISH_SLACK_MS = 1200               # ağ gidiş-dönüş payı (olta LATE_SLACK_MS ile aynı)
CUE_MAX_WAIT_S = 8.0                 # işaret uzun yoklamasının en uzun beklemesi (olta vuruşu ≤ 5,2 sn)
CUE_MAX_WAITERS = 8                  # aynı anda bekleyen işaret isteği (fazlası 429)
CUE_SLICE_S = 0.5                    # bekleyen işaret turun hâlâ açık olduğunu bu aralıkla yoklar
LEDGERS = ("fishing", "generic", "local")
# olta atış yanıtından istemciye gitmeyen alanlar (vuruş anı ve pencere; sunucu saklar ve kendisi değerlendirir)
SECRET_FIELDS: tuple[str, ...] = ("bite_ms", "window_ms")
ROUTES: dict[str, dict[str, str] | None] = {
    "fishing": {"start": "/api/walk/fish/cast", "cue": "/api/walk/fish/bite", "finish": "/api/walk/fish/reel"},
    "generic": {"start": "/api/walk/minigame/start", "cue": "/api/walk/minigame/cue",
                "finish": "/api/walk/minigame/finish"},
    "local": None,
}

Rnd = random.Random | random.SystemRandom
Setup = Callable[[Rnd, bool], tuple[dict[str, Any], dict[str, Any]]]
Judge = Callable[[dict[str, Any], dict[str, Any], float], tuple[str, int]]


# geliştirici hataları (kullanıcıya gösterilmez; kayıt ve açık parametre kuralları)
_DEV_LEDGER = "unknown ledger"
_DEV_GENERIC = "generic kinds need setup and judge"
_DEV_COINS = "coins must be 0 <= min <= max"
_DEV_TIMING = "timing must stay server-side"


class InvalidFinish(Exception):
    """Yargıç bu bitişi geçersiz sayar (409; tur açık kalır)."""


@dataclass(frozen=True)
class Kind:
    id: str
    ledger: str
    coins: tuple[int, int] = (0, 0)          # tur başına taban jeton aralığı (havuz ve azalan getiri öncesi)
    min_ms: int = 0                          # bundan kısa bitiş geçersiz (409)
    max_ms: int = 120_000                    # bundan (+ ağ payı) uzun bitiş `expired`
    start_interval_s: float = 0.8            # aynı türün iki başlatması arası en az
    setup: Setup | None = None
    judge: Judge | None = None

    @property
    def pool(self) -> bool:
        return self.ledger != "local" and self.coins[1] > 0


KINDS: dict[str, Kind] = {}


def register(kind: Kind) -> Kind:
    """Tür kaydı (..28 burada bir satır + ön yüz `MINIGAMES` satırı ekler; eşlik testi ikisini karşılaştırır)."""
    if kind.ledger not in LEDGERS:
        raise ValueError(_DEV_LEDGER, kind.ledger)
    if kind.ledger == "generic" and (kind.setup is None or kind.judge is None):
        raise ValueError(_DEV_GENERIC, kind.id)
    if not 0 <= kind.coins[0] <= kind.coins[1]:
        raise ValueError(_DEV_COINS, kind.id)
    KINDS[kind.id] = kind
    return kind


# olta: taban jeton aralığı fishing.TIER_COINS'in en azı/en çoğu (test_walk_minigame denetler)
register(Kind("fishing", "fishing", coins=(0, 12)))
register(Kind("board", "local"))
register(Kind("toss", "local"))


# ---------------------------------------------------------------- yardımcı yargıçlar (..28 için yapı taşı)
def score_judge(max_score: int, coins_for: Callable[[int], int]) -> Judge:
    """İstemcinin bildirdiği tam sayı skor (0..max_score) → taban jeton. Havuz tavanı ve `min_ms` hileyi sınırlar."""
    def judge(_secret: dict[str, Any], body: dict[str, Any], _elapsed_ms: float) -> tuple[str, int]:
        score = body.get("score")
        if not isinstance(score, int) or isinstance(score, bool) or not 0 <= score <= max_score:
            raise InvalidFinish
        return ("scored" if score > 0 else "missed"), coins_for(score)
    return judge


def timing_judge(coins: int, *, early_slack_ms: int = 60) -> Judge:
    """Olta deseni: gizli `cue_ms` + `window_ms`; sonuç YALNIZ sunucu saatinden (gövde yok sayılır)."""
    def judge(secret: dict[str, Any], _body: dict[str, Any], elapsed_ms: float) -> tuple[str, int]:
        cue, window = float(secret["cue_ms"]), float(secret["window_ms"])
        if elapsed_ms < cue - early_slack_ms:
            return "early", 0
        if elapsed_ms > cue + window + FINISH_SLACK_MS:
            return "late", 0
        return "hit", coins
    return judge


_TIMING_KEY = re.compile(r"(?:^|_)(?:ms|s|ts|at|due|cue|bite|time|deadline|window)(?:_|$)", re.I)


def _check_public(params: Any, path: str = "params") -> None:
    """Açık parametrelerde zaman bilgisi olmaz (motor kuralı; ihlal geliştirici hatasıdır)."""
    if isinstance(params, dict):
        for key, val in params.items():
            if _TIMING_KEY.search(str(key)):
                raise RuntimeError(_DEV_TIMING, path, key)
            _check_public(val, f"{path}.{key}")
    elif isinstance(params, list):
        for i, val in enumerate(params):
            _check_public(val, f"{path}[{i}]")


def client_view(resp: dict[str, Any]) -> dict[str, Any]:
    """Olta atış yanıtının istemciye giden hâli: vuruş anı ve pencere çıkarılır (sunucu saklar ve değerlendirir)."""
    return {k: v for k, v in resp.items() if k not in SECRET_FIELDS}


# ---------------------------------------------------------------- şema ve havuz
def ensure_schema(db: "GameDB") -> None:
    if getattr(db, "_mg_schema", False):
        return
    with db._lock:
        db.conn.executescript(MG_SCHEMA)
        db._mg_schema = True  # type: ignore[attr-defined]


def pool_used(db: "GameDB", day: str) -> int:
    """O gün mini oyunlardan (olta + genel) ödenmiş jeton: `game_coins` defterinden (tek doğruluk kaynağı)."""
    where = " OR ".join("idem LIKE ?" for _ in POOL_KEYS)
    return int(db.scalar(f"SELECT COALESCE(SUM(amount),0) FROM game_coins WHERE day=? AND ({where})",
                         day, *(f"{p}%" for p in POOL_KEYS)))


def pool(db: "GameDB", day: str) -> dict[str, int]:
    used = pool_used(db, day)
    return {"used": used, "max": POOL_COINS_PER_DAY, "left": max(0, POOL_COINS_PER_DAY - used)}


def reward(db: "GameDB", kind: Kind, day: str, base: int) -> tuple[int, str | None]:
    """(jeton, neden): tür başına azalan getiri, sonra ortak havuzun kalanı."""
    if base <= 0:
        return 0, None
    paid = int(db.scalar("SELECT COUNT(*) FROM walk_mg_rounds WHERE day=? AND kind=? AND state='finished' AND coins>0",
                         day, kind.id))
    amount = base if paid < FULL_ROUNDS else max(1, base // 2)
    room = POOL_COINS_PER_DAY - pool_used(db, day)
    if room <= 0:
        return 0, "daily_cap"
    if amount > room:
        return room, "daily_cap"
    return amount, None


def public() -> dict[str, Any]:
    """GET /api/walk/minigame/catalog: tür tablosu, havuz ve sınırlar (zaman bilgisi yok)."""
    return {
        "kinds": [{"id": k.id, "ledger": k.ledger, "pool": k.pool, "coins": list(k.coins),
                   "routes": ROUTES[k.ledger]} for k in KINDS.values()],
        "pool": {"coins_per_day": POOL_COINS_PER_DAY, "kinds": [k.id for k in KINDS.values() if k.pool],
                 "walk_coins_per_day": W.SOUVENIR_COINS_PER_DAY, "walk_separate": True},
        "limits": {"full_rounds": FULL_ROUNDS, "writes_per_min": W.WRITES_PER_MIN},
    }


def state(svc: "WalkService") -> dict[str, Any]:
    g = svc.game
    ensure_schema(g.db)
    day = R.day_of(time.time())
    return {"pool": pool(g.db, day), "balance": g.db.balance(), "admin": g.admin()}


# ---------------------------------------------------------------- genel tur defteri
def _generic(kind_id: Any) -> Kind:
    from studio.walk.service import WalkError
    kind = KINDS.get(kind_id) if isinstance(kind_id, str) else None
    if kind is None:
        raise WalkError(400, "Bilinmeyen mini oyun")
    if kind.ledger != "generic":
        raise WalkError(400, "Bu mini oyun genel tur defterini kullanmıyor")
    return kind


def _round_id(data: dict[str, Any]) -> str:
    from studio.walk.service import WalkError
    rid = data.get("round_id")
    if not isinstance(rid, str) or not rid.startswith("mg_") or len(rid) > 40:
        raise WalkError(400, "round_id gerekli")
    return rid


def start(svc: "WalkService", data: dict[str, Any], *, rnd: Rnd | None = None, now: float | None = None) -> dict[str, Any]:
    from studio.walk.service import WalkError
    kind = _generic(data.get("kind"))
    world = data.get("world")
    if not W.valid_world(world):
        raise WalkError(400, "Geçersiz dünya kimliği")
    assist = data.get("assist", False)
    if not isinstance(assist, bool):
        raise WalkError(400, "assist doğru/yanlış olmalı")
    rid = svc._rid(data, "mg_start")
    fp = svc._fp("mg_start", kind.id, world, assist)
    g = svc.game
    ensure_schema(g.db)
    bypass = svc._gate(g, str(world)) if W.is_scene(world) else ("admin" if g.admin() else None)
    svc._rate()
    rnd = rnd or random.SystemRandom()
    now = time.time() if now is None else now
    day = R.day_of(now)
    with g._lock:
        with g.db.tx():
            prior = svc._replayed(g.db, rid, fp)
            if prior is not None:
                return prior
            last = g.db.scalar("SELECT MAX(ts) FROM walk_mg_rounds WHERE kind=?", kind.id)
            if last is not None and 0 <= now - float(last) < kind.start_interval_s:
                raise WalkError(429, "Mini oyun çok sık başlatılıyor; biraz bekle")
            g.db.exec("UPDATE walk_mg_rounds SET state='abandoned', finish_ts=? WHERE kind=? AND state='open'", now, kind.id)
            assert kind.setup is not None
            secret, params = kind.setup(rnd, assist)
            _check_public(params)
            round_id = f"mg_{secrets.token_hex(8)}"
            g.db.exec("INSERT INTO walk_mg_rounds(round_id,kind,world,ts,day,assist,secret,pay,state) "
                      "VALUES(?,?,?,?,?,?,?,?,'open')", round_id, kind.id, world, now, day, 1 if assist else 0,
                      json.dumps(secret, ensure_ascii=False), bypass)
            svc._touch(g.db, now)
            resp = {"ok": True, "round_id": round_id, "kind": kind.id, "world": world, "assist": assist, "params": params,
                    "paid_mode": bypass is None, "reason": bypass, "pool": pool(g.db, day), "balance": g.db.balance(),
                    "admin": bypass == "admin"}
            svc._remember(g.db, rid, resp, now, fp)
    return {**resp, "events": []}


def finish(svc: "WalkService", data: dict[str, Any], *, now: float | None = None) -> dict[str, Any]:
    """Tur sonucu: yargıç sunucuda (gizli parametre + sunucu saati); istemci miktar iletemez."""
    from studio.walk.service import WalkError, _human
    round_id = _round_id(data)
    body = data.get("result", {})
    if not isinstance(body, dict) or len(body) > 16:
        raise WalkError(400, "result bir nesne olmalı")
    rid = svc._rid(data, "mg_finish")
    fp = svc._fp("mg_finish", round_id, body)
    g = svc.game
    ensure_schema(g.db)
    svc._rate()
    now = time.time() if now is None else now
    events: list[tuple[str, dict[str, Any]]] = []
    coins = 0
    with g._lock:
        with g.db.tx():
            prior = svc._replayed(g.db, rid, fp)
            if prior is not None:
                return prior
            row = g.db.one("SELECT * FROM walk_mg_rounds WHERE round_id=?", round_id)
            if row is None:
                raise WalkError(404, "Mini oyun turu bulunamadı")
            if row["state"] != "open":
                raise WalkError(409, "Bu tur zaten kapandı")
            kind = KINDS.get(str(row["kind"]))
            if kind is None or kind.ledger != "generic" or kind.judge is None:
                raise WalkError(409, "Bu tur artık geçerli değil")
            elapsed = (now - float(row["ts"])) * 1000.0
            if elapsed < kind.min_ms:
                raise WalkError(409, "Tur bu kadar kısa sürede bitemez")
            if elapsed > kind.max_ms + FINISH_SLACK_MS:
                result, base = "expired", 0
            else:
                try:
                    result, base = kind.judge(json.loads(row["secret"]), body, elapsed)
                except InvalidFinish as exc:
                    raise WalkError(409, "Tur sonucu geçersiz") from exc
                base = max(0, min(int(base), kind.coins[1]))
            day = str(row["day"])
            reason: str | None = None
            bypass = row["pay"]
            if base > 0:
                if bypass:
                    reason = str(bypass)
                else:
                    coins, reason = reward(g.db, kind, day, base)
                    if coins and not g.db.add_coins(f"walk:mg:{kind.id}:{round_id}", now, day, coins, "walk",
                                                    f"Mini oyun: {kind.id} (+{coins} jeton)", ref=f"mg:{kind.id}"):
                        coins = 0
                    if coins:
                        g.db.feed(now, "walk", *_human(), f"Mini oyun: {kind.id} (+{coins} jeton)", coins,
                                  {"world": row["world"], "kind": kind.id})
                        events = g._drain()
            g.db.exec("UPDATE walk_mg_rounds SET state='finished', result=?, coins=?, finish_ts=? WHERE round_id=?",
                      result, coins, now, round_id)
            resp = {"ok": True, "already": False, "round_id": round_id, "kind": kind.id, "result": result, "coins": coins,
                    "paid": coins > 0, "reason": reason, "balance": g.db.balance(), "pool": pool(g.db, day),
                    "admin": bypass == "admin"}
            g.db.exec("UPDATE walk_mg_rounds SET response=? WHERE round_id=?", json.dumps(resp, ensure_ascii=False),
                      round_id)
            svc._touch(g.db, now)
            svc._remember(g.db, rid, resp, now, fp)
    if coins:
        events.append(("walk.minigame", {"kind": kind.id, "coins": coins, "balance": resp["balance"]}))
    return {**resp, "events": events}


# ---------------------------------------------------------------- işaret (uzun yoklama; api.py bekler)
def cue_due(svc: "WalkService", data: dict[str, Any]) -> dict[str, Any]:
    """Genel tur: `{round_id, open, due}`. `due` YALNIZ sunucu içidir (api.py bekler, yanıttan çıkarır)."""
    from studio.walk.service import WalkError
    round_id = _round_id(data)
    g = svc.game
    ensure_schema(g.db)
    row = g.db.one("SELECT ts, secret, state FROM walk_mg_rounds WHERE round_id=?", round_id)
    if row is None:
        raise WalkError(404, "Mini oyun turu bulunamadı")
    cue_ms = json.loads(row["secret"]).get("cue_ms")
    if not isinstance(cue_ms, (int, float)):
        raise WalkError(409, "Bu turda işaret yok")
    is_open = row["state"] == "open"
    return {"ok": True, "round_id": round_id, "open": is_open,
            "due": float(row["ts"]) + float(cue_ms) / 1000.0 if is_open else None}


def fish_cue(svc: "WalkService", data: dict[str, Any]) -> dict[str, Any]:
    """Olta vuruşu: `{cast_id, open, due}` (`due` sunucu içi). Atış kapalıysa (erken toplandı, yeni atış) `open: false`."""
    from studio.walk import fishing as FI
    from studio.walk.service import WalkError
    cast_id = data.get("cast_id")
    if not isinstance(cast_id, str) or not cast_id.startswith("fc_") or len(cast_id) > 40:
        raise WalkError(400, "cast_id gerekli")
    g = svc.game
    FI.ensure_schema(g.db)
    row = g.db.one("SELECT ts, bite_ms, state FROM walk_fish_casts WHERE cast_id=?", cast_id)
    if row is None:
        raise WalkError(404, "Atış bulunamadı")
    is_open = row["state"] == "open"
    return {"ok": True, "cast_id": cast_id, "open": is_open,
            "due": float(row["ts"]) + int(row["bite_ms"]) / 1000.0 if is_open else None}
