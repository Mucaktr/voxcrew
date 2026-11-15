"""Kozmetik hak → oyun envanteri projeksiyonu, iade ve ücretsiz kazanım yolu.

```text
purchased|promo cosmetic:<set>@<teklif> ─(sync; idempotent)─▶ game_inventory(item_id='store:<set>-<parça>', source='store')
iade ─▶ hak iptal (cosmetic_refunds) ─▶ 'store' satırları "giyilemez" işaretlenir (SİLİNMEZ; yapıdaki bloklar kalır)
imza başarımı / arşiv görevi ─▶ game_inventory(source='earn') (hak defterine YAZMAZ)
jeton (2026-10-19 gece kararı) ─▶ POST /api/game/shop/store:<set>/buy → GameService (game_coins tek satır, idempotent)
                                 ─▶ game_inventory(source='coin') (hak defterine YAZMAZ)
```

Para ile jeton yolu birbirine dokunmaz: para hakkının iadesi jetonu geri vermez ve jetonla alınmış parçayı giyilemez
yapmaz; jeton alımı hak doğurmaz. Jeton fiyatı para fiyatından türetilmez (sabit kur yok); jeton satılmaz.

Kurallar:
- Kaynak hak defteridir (`entitlements.ledger`, salt okuma). Bu modül deftere yazmaz; ücretsiz yol da yazmaz.
- Envantere yalnız `GameService.grant_store` ile yazılır (`store`/`earn`/`coin` kaynağı). Bu paket jeton, XP, SP, başarım
  ya da sezon tablosuna YAZMAZ; jeton harcaması yalnız oyunun mevcut alım akışındadır (mimari test:
  tests/test_cosmetics_api.py). `game_coins` yalnız okunur (jetonla kapsanan parçalar).
- Bayrak `store.cosmetics_enabled` kapalıyken hiçbir yazma yapılmaz (`CosmeticsDisabled`).
- Yönetici/test modu ve test paketi yalnız önizler (S40): plan döner, hiçbir şey yazılmaz. Deneme (3D önizleme)
  arayüzde bellekte kalır; arka uçta deneme ucu yoktur.
- Para ile satın alma, para fiyatı, ödeme ve ağ yok. `store:*` jetona bozdurulamaz; jeton satılmaz.
"""

from __future__ import annotations

import time
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING, Any

from studio.cosmetics import catalog as K
from studio.cosmetics import coverage as COV
from studio.entitlements import offers as O

if TYPE_CHECKING:
    from studio.game.service import GameService

FLAG = "store.cosmetics_enabled"
RIGHT_PREFIX = "cosmetic:"
RIGHT_LEDGERS = ("purchased", "promo")

SCHEMA = """
CREATE TABLE IF NOT EXISTS cosmetic_refunds (
  source_txn TEXT PRIMARY KEY, set_id TEXT NOT NULL, reason TEXT NOT NULL, ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS cosmetic_wear (
  item_id TEXT PRIMARY KEY, wearable INTEGER NOT NULL CHECK (wearable IN (0,1)), reason TEXT, updated_at REAL NOT NULL);
"""


class CosmeticsDisabled(PermissionError):
    """Bayrak kapalı (API'de 403)."""


def enabled(studio: Any) -> bool:
    settings = getattr(studio, "settings", None)
    try:
        return settings is not None and settings.get(FLAG, False) is True
    except Exception:  # noqa: BLE001 - emin değilsek kapalı
        return False


def ensure_schema(svc: "GameService") -> None:
    svc.db.conn.executescript(SCHEMA)


def _ledgers(studio: Any) -> Any | None:
    """Bağlı hak motorunun defterleri (salt okuma). Motor içe aktarılmaz ve karar sorulmaz (T15); motor yoksa None."""
    ent = getattr(studio, "entitlements", None)
    return getattr(ent, "ledgers", None) if ent is not None else None


def persist(svc: "GameService") -> bool:
    """Kalıcı yazım: yönetici/test modu ve test paketi yalnız önizler."""
    if svc.admin():
        return False
    m = svc.membership()
    return m is None or bool(m.get("persist"))


def _refunded(svc: "GameService") -> set[str]:
    try:   # işlem içinden de çağrılır: şema burada kurulmaz (executescript işlemi kapatır)
        return {r["source_txn"] for r in svc.db.q("SELECT source_txn FROM cosmetic_refunds")}
    except Exception:  # noqa: BLE001 - tablo henüz yok → iade yok
        return set()


def rights(svc: "GameService", now: float | None = None) -> list[dict[str, Any]]:
    """Etkin kozmetik haklar (purchased + promo; iade edilenler hariç, bilinmeyen set yok sayılır)."""
    now = time.time() if now is None else now
    led = _ledgers(svc.studio)
    if led is None:
        return []
    refunded = _refunded(svc)
    out = []
    for kind in RIGHT_LEDGERS:
        for e in led.entries(kind, now=now, active_only=True):
            if not e.right.startswith(RIGHT_PREFIX) or e.source_txn in refunded:
                continue
            cs = K.SET_BY_ID.get(e.right[len(RIGHT_PREFIX):])
            if cs is None:
                continue
            out.append({"set": cs.id, "ledger": kind, "source_txn": e.source_txn, "offer": e.offer})
    return out


def _achieved(svc: "GameService", ach: str) -> bool:
    return svc.db.one("SELECT 1 FROM game_achievements WHERE achievement_id=? LIMIT 1", ach) is not None


def archive_open(cs: K.CosmeticSet, now: float) -> bool:
    """Satıştan `free_after_months` ay sonra tüm set arşiv göreviyle kazanılabilir. Satış yoksa (released_at None) kapalı."""
    if not cs.released_at:
        return False
    try:
        d = date.fromisoformat(cs.released_at)
    except ValueError:
        return False
    months = d.year * 12 + d.month - 1 + cs.free_after_months
    opens = datetime(months // 12, months % 12 + 1, min(d.day, 28), tzinfo=timezone.utc).timestamp()
    return now >= opens


def earn_plan(svc: "GameService", now: float) -> list[tuple[str, str]]:
    """(parça, gerekçe) — ücretsiz yoldan kazanılmış ama envanterde olmayan parçalar."""
    plan: list[tuple[str, str]] = []
    for cs in K.SETS:
        if cs.is_collection:
            continue
        if cs.signature_piece and cs.signature_achievement and _achieved(svc, cs.signature_achievement):
            plan.append((cs.signature_piece, f"signature:{cs.signature_achievement}"))
        if archive_open(cs, now) and cs.archive_quest and all(_achieved(svc, a) for a in cs.archive_quest):
            plan.extend((p.id, "archive_quest") for p in cs.pieces)
    seen: set[str] = set()
    return [(i, r) for i, r in plan if not (i in seen or seen.add(i)) and not svc.db.owns(i)]  # type: ignore[func-returns-value]


def _store_rows(svc: "GameService") -> dict[str, str]:
    return {r["item_id"]: r["source"] for r in svc.db.q(
        "SELECT item_id, source FROM game_inventory WHERE item_id LIKE 'store:%'")}


def coin_covered(svc: "GameService") -> set[str]:
    """Jetonla alınmış parçalar (salt okuma): oyunun alım satırlarındaki parça listesi + `coin` kaynaklı satırlar."""
    out = {i for i, src in _store_rows(svc).items() if src == "coin"}
    for r in svc.db.q("SELECT idem, ref FROM game_coins WHERE reason='purchase' AND ref LIKE 'store:%' AND amount < 0"):
        prefix = f"buy:{r['ref']}:"
        if str(r["idem"]).startswith(prefix):
            out |= {p for p in str(r["idem"])[len(prefix):].split(",") if p in K.PIECE_BY_ID}
    return out


def _entitled(svc: "GameService", now: float) -> dict[str, str]:
    out: dict[str, str] = {}
    for r in rights(svc, now):
        for p in K.pieces_of(K.SET_BY_ID[r["set"]]):
            out.setdefault(p.id, r["set"])
    return out


def wearable_pieces(svc: "GameService", now: float | None = None) -> set[str]:
    """Giyilebilir sahip olunan parçalar: kazanılmış, jetonla alınmış ya da etkin para/promosyon hakkıyla kapsanan."""
    now = time.time() if now is None else now
    have = _store_rows(svc)
    covered = coin_covered(svc) | set(_entitled(svc, now))
    return {i for i, src in have.items() if src in ("earn", "coin") or i in covered}


def sync(svc: "GameService", now: float | None = None) -> dict[str, Any]:
    """Haktan envantere idempotent projeksiyon + ücretsiz yol + iade işaretleri. Bayrak kapalıysa `CosmeticsDisabled`."""
    if not enabled(svc.studio):
        raise CosmeticsDisabled("Kozmetik mağazası kapalı (store.cosmetics_enabled)")
    ensure_schema(svc)
    ts = time.time() if now is None else now
    active = rights(svc, ts)
    entitled = _entitled(svc, ts)
    earned = earn_plan(svc, ts)
    have = _store_rows(svc)
    coins = coin_covered(svc)
    earned_ids = {i for i, _ in earned}
    to_store = [i for i in entitled if i not in have and i not in earned_ids]   # kazanılan parça 'earn' kalır
    # iade: para hakkı kalmayan 'store' parçası giyilemez — jetonla da alınmışsa giyilebilir kalır (jeton iade edilmez)
    blocked = [i for i, src in have.items() if src == "store" and i not in entitled and i not in coins]
    plan = {"store": to_store, "earn": [i for i, _ in earned], "unwearable": blocked,
            "rights": [{"set": r["set"], "ledger": r["ledger"], "offer": r["offer"]} for r in active]}
    if not persist(svc):
        return {"state": "preview", "written": False, **plan, "events": []}
    with svc._lock:  # noqa: SLF001
        for item, _why in earned:
            svc.grant_store(item, ts, source="earn")
        for item in to_store:
            svc.grant_store(item, ts, source="store")
        with svc.db.tx():
            for item in [*entitled, *(i for i in coins if i in have)]:
                svc.db.exec("INSERT INTO cosmetic_wear(item_id, wearable, reason, updated_at) VALUES(?,1,NULL,?) "
                            "ON CONFLICT(item_id) DO UPDATE SET wearable=1, reason=NULL, updated_at=excluded.updated_at "
                            "WHERE cosmetic_wear.wearable=0", item, ts)
            for item in blocked:
                svc.db.exec("INSERT INTO cosmetic_wear(item_id, wearable, reason, updated_at) VALUES(?,0,'refunded',?) "
                            "ON CONFLICT(item_id) DO UPDATE SET wearable=0, reason='refunded', "
                            "updated_at=excluded.updated_at WHERE cosmetic_wear.wearable=1", item, ts)
        events = svc._drain()  # noqa: SLF001
    unequipped = unequip_unwearable(svc, ts) if blocked else []  # iade edilen parça üstlerden çıkar
    return {"state": "written", "written": True, **plan, "events": events, "unequipped": unequipped}


def unequip_unwearable(svc: "GameService", now: float | None = None) -> list[str]:
    """giyilebilir olmayan (iade edilmiş / hakkı kalmamış) `avatar.wear` ajanlardan ve Ben'den kalıcı olarak
    çıkarılır (yalnız `wear` alanı; avatarın geri kalanı korunur). Dönüş: çıkarılanlar (`agent:<slug>` / `me`)."""
    ok = wearable_pieces(svc, now)

    def keep(wear: Any) -> bool:
        if not isinstance(wear, str) or not wear:
            return False
        return (wear if wear.startswith(K.STORE_PREFIX) else f"{K.STORE_PREFIX}{wear}") in ok

    out: list[str] = []
    store = getattr(svc.studio, "store", None)
    if store is not None:
        for n in store.nodes("Agent", limit=5000):
            av = n["props"].get("avatar")
            if isinstance(av, dict) and "wear" in av and not keep(av.get("wear")):
                store.patch_node(n["id"], {"avatar": {k: v for k, v in av.items() if k != "wear"}})
                out.append(f"agent:{n['props'].get('slug')}")
    try:
        import json  # noqa: PLC0415

        from studio.walk.service import AVATAR_KEY  # noqa: PLC0415 - cosmetics → walk (yalnız anahtar adı)
        raw = svc.db.meta(AVATAR_KEY)
        val = json.loads(raw) if raw else None
        av = val.get("avatar") if isinstance(val, dict) and isinstance(val.get("avatar"), dict) else val
        if isinstance(av, dict) and "wear" in av and not keep(av.get("wear")):
            av.pop("wear", None)
            with svc._lock, svc.db.tx():  # noqa: SLF001
                svc.db.set_meta(AVATAR_KEY, json.dumps(val, ensure_ascii=False, sort_keys=True))
            out.append("me")
    except (ImportError, ValueError, TypeError):
        pass
    return out


def refund(svc: "GameService", source_txn: str, *, reason: str = "refund", now: float | None = None) -> dict[str, Any]:
    """MoR iadesi → hak iptal → parçalar giyilemez (silinmez). Uç yoktur (ödeme sağlayıcısı bağlanınca çağrılır)."""
    ensure_schema(svc)
    ts = time.time() if now is None else now
    led = _ledgers(svc.studio)
    match = None
    for kind in RIGHT_LEDGERS:
        for e in (led.entries(kind, now=ts) if led is not None else []):
            if e.source_txn == source_txn and e.right.startswith(RIGHT_PREFIX):
                match = e
    if match is None:
        raise KeyError("Bu işlem kimliğiyle kozmetik hak yok")
    set_id = match.right[len(RIGHT_PREFIX):]
    if not persist(svc):
        return {"state": "preview", "written": False, "source_txn": source_txn, "set": set_id}
    with svc._lock:  # noqa: SLF001
        with svc.db.tx():
            added = svc.db.exec("INSERT OR IGNORE INTO cosmetic_refunds(source_txn, set_id, reason, ts) "
                                "VALUES(?,?,?,?)", source_txn, set_id, str(reason)[:120], ts) == 1
    out: dict[str, Any] = {"state": "written" if added else "duplicate", "written": added, "source_txn": source_txn,
                           "set": set_id}
    if enabled(svc.studio):
        out["sync"] = sync(svc, ts)
    # bayrak kapalı olsa da iade edilen parça giyili kalmaz (sync zaten çıkardıysa onun listesi de dahil)
    out["unequipped"] = list((out.get("sync") or {}).get("unequipped") or []) + unequip_unwearable(svc, ts)
    return out


# ---------------------------------------------------------------- görünümler (salt okuma)
def _wear(svc: "GameService") -> dict[str, tuple[int, str | None]]:
    try:
        return {r["item_id"]: (int(r["wearable"]), r["reason"]) for r in
                svc.db.q("SELECT item_id, wearable, reason FROM cosmetic_wear")}
    except Exception:  # noqa: BLE001 - tablo henüz yok
        return {}


def _offer(cs: K.CosmeticSet) -> dict[str, Any]:
    return O.cosmetic_offer(cs.id, K.scope_items(cs)).to_dict()


def _piece_view(svc: "GameService" | None, p: K.Piece, rep: dict[str, Any], have: dict[str, str],
                wear: dict[str, tuple[int, str | None]], ok: set[str]) -> dict[str, Any]:
    src = have.get(p.id)
    w = wear.get(p.id)
    wearable = p.id in ok
    drawn = COV.piece_drawn(rep, p.id)
    return {"id": p.id, "kind": p.kind, "label": K.pick(p.label_tr, p.label_en), "surfaces": list(p.surfaces),
            "drawn": drawn, "owned": src is not None, "source": src, "wearable": wearable,
            "unwearable_reason": None if wearable or src is None else (w[1] if w else "no_right"),
            "temporarily_not_drawn": src is not None and not all(drawn.values())}


def set_view(svc: "GameService" | None, cs: K.CosmeticSet, rep: dict[str, Any] | None = None,
             now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    rep = rep if rep is not None else COV.report()
    have = _store_rows(svc) if svc is not None else {}
    wear = _wear(svc) if svc is not None else {}
    ok = wearable_pieces(svc, now) if svc is not None else set()
    gate = rep["sets"].get(cs.id) or COV.check_set(cs, None)
    pieces = K.pieces_of(cs)
    missing = [p.id for p in pieces if p.id not in ok]
    cost = 0 if not missing else -(-cs.coin_price * len(missing) // len(pieces))
    balance = svc.db.balance() if svc is not None else None
    return {
        "id": cs.id, "store_id": cs.store_id, "right": cs.right,
        "name": K.pick(cs.name_tr, cs.name_en), "description": K.pick(cs.description_tr, cs.description_en),
        "bucket": cs.bucket, "price": None, "currency": None, "for_sale": False,
        "offer": _offer(cs), "surfaces": list(cs.surfaces()), "sets": list(cs.sets),
        "pieces": [_piece_view(svc, p, rep, have, wear, ok) for p in pieces],
        # jetonla aynı eşya (2026-10-19 gece kararı): [H] fiyat; para fiyatından türetilmez. Alım oyunun mevcut akışından.
        "coin_price": cs.coin_price, "coin_cost": cost if svc is not None else cs.coin_price,
        "coin_buy": {"method": "POST", "path": f"/api/game/shop/{cs.store_id}/buy", "confirm": True},
        "can_buy_coins": bool(svc is not None and gate["sellable"] and missing and balance is not None
                              and balance >= cost and not svc.admin()),
        # ödeme sağlayıcısı bağlanınca para alımından ÖNCE bakılır (tüm parçalar zaten giyilebilir → uyarı)
        "already_owned": bool(svc is not None and not missing),
        "sellable": bool(gate["sellable"]), "sale_blockers": gate["reasons"],
        "status": "temporarily_unavailable" if not gate["sellable"] else "preview",
        "ip_risk": cs.ip_risk, "culture_risk": cs.culture_risk, "risk": K.risk_state(cs),
        "free_path": {"signature_piece": cs.signature_piece, "signature_achievement": cs.signature_achievement,
                      "archive_quest": list(cs.archive_quest), "free_after_months": cs.free_after_months,
                      "archive_open": archive_open(cs, now), "coins": False},
    }


def store_view(svc: "GameService" | None, studio: Any, now: float | None = None) -> dict[str, Any]:
    """Mağaza vitrini. Bayrak kapalıyken de yalnız önizleme verisidir: fiyat yok, satın al yok, sahiplik yok."""
    on = enabled(studio)
    rep = COV.report()
    sets = [set_view(svc if on else None, cs, rep, now) for cs in K.SETS]
    return {"enabled": on, "mode": "preview", "for_sale": False, "price": None, "sets": sets,
            "coverage": {"source_ok": rep["source_ok"], "error": rep["error"], "generated_at": rep["generated_at"],
                         "sellable": rep["sellable"]},
            "balance": svc.db.balance() if (on and svc is not None) else None,
            "rules": {"random": False, "countdown": False, "coin_sale": False, "coin_price_derived": False,
                      "advantage": False}}


def collection_view(svc: "GameService") -> dict[str, Any]:
    """Sahip olunan `store:*` parçaları: set, parça, yüzey, çizim durumu, giyilebilirlik."""
    rep = COV.report()
    have = _store_rows(svc)
    wear = _wear(svc)
    ok = wearable_pieces(svc)
    items = []
    for item_id in sorted(have):
        p = K.PIECE_BY_ID.get(item_id)
        if p is None:
            continue
        row = _piece_view(svc, p, rep, have, wear, ok)
        row["set"] = K.PIECE_SET[item_id]
        items.append(row)
    return {"items": items, "count": len(items)}


# ---------------------------------------------------------------- giyim (avatar.wear; Ben ve ajanlar)
WEAR_SURFACES = frozenset({"avatar", "me"})


def clean_wear(svc: "GameService", value: Any) -> str | None:
    """`avatar.wear` → sahip olunan VE giyilebilir (iade edilmemiş) avatar parçasının öğe kimliği (`store:` öneksiz,
    arayüz biçimi); değilse None (kayıtta atılır). Yalnız okur."""
    if not isinstance(value, str) or not value or len(value) > 100:
        return None
    pid = value if value.startswith(K.STORE_PREFIX) else f"{K.STORE_PREFIX}{value}"
    p = K.PIECE_BY_ID.get(pid)
    if p is None or not WEAR_SURFACES & set(p.surfaces):
        return None
    return pid[len(K.STORE_PREFIX):] if pid in wearable_pieces(svc) else None


# ---------------------------------------------------------------- jeton yolu kaydı (cosmetics → game; game içe aktarmaz)
def _coin_sellable(set_id: str) -> Any:
    def check(svc: "GameService") -> bool:
        """Bayrak açık VE set her yüzeyde çizili (çizilmeden satılmaz kapısı jeton satışında da aynen)."""
        if not enabled(svc.studio):
            return False
        cs = K.SET_BY_ID.get(set_id)
        return cs is not None and bool(COV.check_set(cs, *COV.load())["sellable"])
    return check


def register_coin_sets() -> None:
    from studio.game.service import StoreSet, register_store_labels, register_store_set  # noqa: PLC0415

    # kilit açma bildirimi için set ve parça adları (koleksiyonlar dahil)
    labels: dict[str, tuple[str, str]] = {cs.store_id: (cs.name_tr, cs.name_en) for cs in K.SETS}
    labels.update({p.id: (p.label_tr, p.label_en) for cs in K.SETS for p in cs.pieces})
    register_store_labels(labels)
    for cs in K.SETS:
        if cs.is_collection or cs.coin_price <= 0:
            continue
        register_store_set(StoreSet(cs.store_id, cs.name_tr, cs.coin_price, tuple(p.id for p in cs.pieces),
                                    owned=wearable_pieces, enabled=_coin_sellable(cs.id)))


register_coin_sets()
