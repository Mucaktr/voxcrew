""" sezon sistemi.

Sezon 8 haftalık bir temadır. Sezon puanı (SP) YALNIZ gerçek iş sinyallerinden gelir (Y7): kabul edilen teslim, ilk
turda onay, hedef tamamlama, akış iyileştirme, karar (onay ya da ret eşit, Y9), görev yuvası. Hacim, token ve süre
hiçbir yerde sayılmaz: `SP_RULES` dışında SP kaynağı yoktur ve her kaynak sabit bir miktardır.

- **Tamamlanabilir tasarım:** 30 kademe × `TIER_SP`; haftalık `WEEKLY_CAP` tavanı grind'i önler. Orta kullanım 8 haftanın
  ≈5'inde biter (benzetim: tests/test_season.py).
- **Ücretsiz yol** her pakette aynıdır (jeton, rozet, masa süsü ve sezon sahnesinin ek kazanım yolu).
- **Premium yol yalnız kozmetiktir.** Para düğmesi yoktur: ödeme olmadığı için satın alma yolu gizlidir; Pro ve
  kurucu kurulum premium ödülleri `entitlements.check("season_premium")` ile kendiliğinden alır. Yönetici/test modu
  premium'u yalnız GÖSTERİR (S40 kuralı: envantere yazılmaz).
- **Geriye dönük:** premium hak sezonun herhangi bir anında gelirse geçmiş kademelerin premium ödülleri hemen verilir.
- **Arşiv:** sezon bitince premium set arşive işaretlenir (`season_archive`); hiçbir şey silinmez.
- **Geç kalanlar:** sezon bitince ulaşılamamış ücretsiz öğe ödülleri sırayla "geç kalanlar görevi" olur; sonraki SP ile
  kazanılır. Süre dolmaz, ceza yoktur.
- Geri sayım ve "son şans" yok: arayüze yalnız dürüst bitiş TARİHİ verilir (kalan gün sayısı verilmez).
- Kademe satın alma, SP artırıcı, sezon özel ücretli öğe YOK; bu modülde fiyat ya da ödeme alanı bulunmaz.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any, Callable

from studio.game import catalog as C
from studio.game import rules as R

if TYPE_CHECKING:
    from studio.game.service import GameService

log = logging.getLogger("studio.game.season")

TIERS = 30
TIER_SP = 50                 # 30 × 50 = 1500 SP
WEEKLY_CAP = 400             # haftalık SP tavanı (yoğun kullanım en erken 4. haftada bitirir)
LATECOMER_SP = 100           # geç kalanlar görevi başına gereken SP (2 kademe kadar gerçek iş)
WEEK_S = 7 * 86400

# kaynak → (SP, günlük sayılan en çok olay; None = sınırsız). Hacim/token/süre kaynağı YOK (Y7).
SP_RULES: dict[str, tuple[int, int | None]] = {
    "delivery": (12, 10),       # kabul edilen teslim (acceptance.updated → accepted)
    "review": (12, 10),         # kullanıcının teslimi reddetmesi: kabul ile eşit (Y9)
    "first_try": (8, 10),       # ilk turda onay (gözden geçiren, öz-inceleme hariç)
    "goal": (25, 3),            # hedef tamamlandı
    "workflow": (15, 3),        # akış iyileştirme: kendi akışının ilk başarısı ya da aynı gün başarısızlıktan dönüş
    "decision": (4, 15),        # onay kapısı ya da araç onayı kararı (onay = ret)
    "quest_daily": (6, None),   # günlük görev yuvası ödülü alındı
    "quest_weekly": (20, None),  # haftalık görev yuvası ödülü alındı
}
SOURCE_LABEL = {
    "delivery": ("Kabul edilen teslim", "Accepted delivery"),
    "review": ("Teslim incelemesi (ret, kabulle eşit)", "Delivery review (rejection, equal to acceptance)"),
    "first_try": ("İlk turda onay", "First-try approval"),
    "goal": ("Hedef tamamlandı", "Goal completed"),
    "workflow": ("Akış iyileştirildi", "Workflow improved"),
    "decision": ("Karar (onay ya da ret)", "Decision (approve or reject)"),
    "quest_daily": ("Günlük görev yuvası", "Daily quest slot"),
    "quest_weekly": ("Haftalık görev yuvası", "Weekly quest slot"),
}


@dataclass(frozen=True)
class Reward:
    tier: int
    kind: str                # coins | badge | desk | outfit | celebration | sign | scene
    label_tr: str
    label_en: str
    item: str | None = None  # envanter kimliği (coins için None)
    coins: int = 0

    @property
    def label(self) -> str:
        return C._pick(self.label_tr, self.label_en)


@dataclass(frozen=True)
class Season:
    id: str
    number: int
    name_tr: str
    name_en: str
    theme_tr: str
    theme_en: str
    start: date               # Pazartesi; gün `R.DAY_START_HOUR`'da başlar
    weeks: int = 8
    free: tuple[Reward, ...] = field(default_factory=tuple)
    premium: tuple[Reward, ...] = field(default_factory=tuple)

    @property
    def name(self) -> str:
        return C._pick(self.name_tr, self.name_en)

    @property
    def theme(self) -> str:
        return C._pick(self.theme_tr, self.theme_en)

    @property
    def start_ts(self) -> float:
        return datetime(self.start.year, self.start.month, self.start.day, R.DAY_START_HOUR).timestamp()

    @property
    def end_ts(self) -> float:
        d = self.start + timedelta(weeks=self.weeks)
        return datetime(d.year, d.month, d.day, R.DAY_START_HOUR).timestamp()

    @property
    def last_day(self) -> date:
        return self.start + timedelta(weeks=self.weeks) - timedelta(days=1)


def _item(tier: int, kind: str, item: str, tr: str, en: str) -> Reward:
    return Reward(tier, kind, tr, en, item=item)


def _coins(tier: int, n: int) -> Reward:
    return Reward(tier, "coins", f"{n} jeton", f"{n} coins", coins=n)


S1 = Season(
    "s1", 1, "Kış Ofisi", "Winter Office",
    "Sıcak kakao, kar küresi ve camda buğu: ekip kışı birlikte geçirir.",
    "Hot cocoa, a snow globe and fogged windows: the team gets through winter together.",
    date(2026, 10, 19),
    free=(
        _coins(3, 50),
        _item(6, "badge", "season:s1-snowflake", "Kar tanesi rozeti", "Snowflake badge"),
        _coins(9, 75),
        _item(12, "desk", "season:s1-cocoa", "Sıcak kakao kupası", "Hot cocoa mug"),
        _coins(15, 100),
        _item(18, "desk", "season:s1-lantern", "Kış feneri", "Winter lantern"),
        _coins(21, 100),
        _item(24, "badge", "season:s1-mitten", "Eldiven rozeti", "Mitten badge"),
        _coins(27, 125),
        # sezon sahnesinin EK kazanım yolu: Karlı köy (ofis Sv 6 kapısı aynen kalır)
        _item(30, "scene", "scene:snow", "Karlı köy sahnesi", "Snowy village scene"),
    ),
    premium=(  # yalnız kozmetik: kıyafet, masa süsü, kutlama stili, sezon tabelası
        _item(5, "outfit", "season:s1-scarf", "Örgü kış atkısı", "Knitted winter scarf"),
        _item(10, "desk", "season:s1-snowglobe", "Kar küresi", "Snow globe"),
        _item(15, "outfit", "season:s1-coat", "Kapitone kış montu", "Quilted winter coat"),
        _item(20, "celebration", "season:s1-snowfall", "Kar yağışı kutlaması", "Snowfall celebration"),
        _item(25, "outfit", "season:s1-earmuffs", "Kulak ısıtıcı", "Earmuffs"),
        _item(30, "sign", "season:s1-sign", "Kış Ofisi tabelası", "Winter Office sign"),
    ),
)
SEASONS: tuple[Season, ...] = (S1,)
SEASON_BY_ID = {s.id: s for s in SEASONS}
ITEM_LABELS: dict[str, Reward] = {r.item: r for s in SEASONS for r in (*s.free, *s.premium) if r.item}


# ---------------------------------------------------------------- zaman
def season_at(ts: float) -> Season | None:
    for s in SEASONS:
        if s.start_ts <= ts < s.end_ts:
            return s
    return None


def week_index(season: Season, ts: float) -> int:
    return max(1, min(season.weeks, int((ts - season.start_ts) // WEEK_S) + 1))


def tier_for(sp: int) -> int:
    return max(0, min(TIERS, int(sp) // TIER_SP))


# ---------------------------------------------------------------- premium hakkı
def premium_state(svc: "GameService") -> dict[str, Any]:
    """`entitlements.check("season_premium")` → {active, source, persist}. Satın alma yolu yok."""
    try:
        d = svc.season_premium()   # kontrol noktası C12 (game/service.py; T15 yalnız orada motoru sorar)
        if d is None:
            return {"active": False, "source": None, "persist": False}
    except Exception:  # noqa: BLE001 - hak motoru okunamazsa premium kapalı sayılır, ilerleme sürer
        log.exception("sezon premium hakkı okunamadı")
        return {"active": False, "source": None, "persist": False}
    # yönetici ve test paketi (oturumluk test paketi) premium'u yalnız ÖNİZLER; envantere
    # hiçbir şey yazılmaz (S40). Kalıcı premium yalnız gerçek Pro / kurucu hakkından gelir.
    preview = d.source in ("admin", "test")
    return {"active": bool(d.allowed), "source": d.source if d.allowed else None,
            "persist": bool(d.allowed) and not preview}


# ---------------------------------------------------------------- yazımlar (GameService işlemi içinde)
def _savepoint(svc: "GameService", fn: Callable[[], Any], default: Any = 0) -> Any:
    """Sezon hatası oyun olayını (XP, görev) bozmasın: kendi SAVEPOINT'i içinde çalışır."""
    conn = svc.db.conn
    with svc.db._lock:  # noqa: SLF001
        conn.execute("SAVEPOINT season")
        try:
            out = fn()
        except Exception:  # noqa: BLE001
            conn.execute("ROLLBACK TO season")
            conn.execute("RELEASE season")
            log.exception("sezon kaydı yazılamadı")
            return default
        conn.execute("RELEASE season")
        return out


def award(svc: "GameService", source: str, key: str, ts: float) -> int:
    """Bir gerçek iş sinyali için SP yazar (idempotent: `sp:<kaynak>:<anahtar>`). Verilen SP'yi döndürür."""
    if source not in SP_RULES or not key:
        return 0
    return int(_savepoint(svc, lambda: _award(svc, source, key, ts)))


def _award(svc: "GameService", source: str, key: str, ts: float) -> int:
    db = svc.db
    idem = f"sp:{source}:{key}"
    if db.one("SELECT 1 FROM season_points WHERE idem=?", idem):
        return 0
    _archive_ended(svc, ts)
    season = season_at(ts)
    sid = season.id if season else ""
    day, week = R.day_of(ts), R.week_of(ts)
    raw, daily = SP_RULES[source]
    amount = raw
    notes: list[str] = []
    if daily is not None:
        used = int(db.scalar("SELECT COUNT(*) FROM season_points WHERE source=? AND day=? AND amount>0", source, day))
        if used >= daily:
            amount = 0
            notes.append("günlük sınır")
    week_used = int(db.scalar("SELECT COALESCE(SUM(amount),0) FROM season_points WHERE week=?", week))
    capped = max(0, min(amount, WEEKLY_CAP - week_used))
    if capped < amount:
        notes.append("haftalık tavan")
    amount = capped
    tr, _en = SOURCE_LABEL[source]
    explain = f"{tr} (+{amount} SP)" + (" · " + ", ".join(notes) if notes else "")
    db.exec("INSERT INTO season_points(idem,ts,day,week,season_id,source,raw,amount,explain) VALUES(?,?,?,?,?,?,?,?,?)",
            idem, ts, day, week, sid, source, raw, amount, explain)
    if amount <= 0:
        return 0
    if season is not None:
        before = _season_sp(svc, season.id) - amount
        _ensure_progress(svc, season, ts)
        sp = before + amount
        db.exec("UPDATE season_progress SET sp=?, tier=?, updated_at=? WHERE season_id=?", sp, tier_for(sp), ts,
                season.id)
        new_tier, old_tier = tier_for(sp), tier_for(before)
        if new_tier > old_tier:
            db.feed(ts, "season", "human", "me", f"{season.name_tr}: {new_tier}. kademe", new_tier,
                    {"season": season.id, "tier": new_tier})
            svc._emit("game.season", season=season.id, tier=new_tier, sp=sp)  # noqa: SLF001
        _grant_rewards(svc, season, ts)
    _latecomer_progress(svc, amount, ts)
    return amount


def _season_sp(svc: "GameService", season_id: str) -> int:
    return int(svc.db.scalar("SELECT COALESCE(SUM(amount),0) FROM season_points WHERE season_id=?", season_id))


def _ensure_progress(svc: "GameService", season: Season, ts: float) -> None:
    svc.db.exec("INSERT OR IGNORE INTO season_progress(season_id,sp,tier,started_at,updated_at) VALUES(?,0,0,?,?)",
                season.id, ts, ts)


def _give(svc: "GameService", season: Season, track: str, rw: Reward, ts: float) -> bool:
    """Kademe ödülünü bir kez verir (season_rewards birincil anahtarı)."""
    db = svc.db
    if db.exec("INSERT OR IGNORE INTO season_rewards(season_id,track,tier,item_id,coins,granted_at) VALUES(?,?,?,?,?,?)",
               season.id, track, rw.tier, rw.item, rw.coins, ts) != 1:
        return False
    if rw.coins:
        db.add_coins(f"season:{season.id}:{track}:{rw.tier}", ts, R.day_of(ts), rw.coins, "season",
                     f"{season.name_tr} {rw.tier}. kademe (+{rw.coins} jeton)", ref=season.id)
        db.feed(ts, "season", "human", "me", f"{season.name_tr}: +{rw.coins} jeton", rw.coins,
                {"season": season.id, "tier": rw.tier, "track": track})
        return True
    if rw.item:
        grant_item(svc, rw.item, f"season:{track}", ts)
    return True


def grant_item(svc: "GameService", item_id: str, source: str, ts: float) -> bool:
    """Envantere yazar; mağaza öğesiyse (ör. `scene:snow`) servisin kendi yolunu kullanır (gardırop, kutlama)."""
    if item_id in C.SHOP_BY_ID:
        return svc._grant(item_id, source, ts)  # noqa: SLF001
    if not svc.db.grant(item_id, source, ts):
        return False
    rw = ITEM_LABELS.get(item_id)
    label_tr = rw.label_tr if rw else item_id
    svc.db.feed(ts, "unlock", None, None, f"Kilit açıldı: {label_tr}", None, {"item": item_id, "source": source})
    svc._emit("game.unlock", item=item_id, label=rw.label if rw else item_id,  # noqa: SLF001
              kind=rw.kind if rw else "cosmetic", source=source)
    return True


def _grant_rewards(svc: "GameService", season: Season, ts: float) -> int:
    """Ulaşılan kademelerin ücretsiz ve (hak varsa) premium ödülleri. Premium geriye dönüktür: hak geldiği an tüm
    geçmiş kademeler bir kerede ödenir."""
    if ts >= season.end_ts:
        return 0
    row = svc.db.one("SELECT tier, premium_at FROM season_progress WHERE season_id=?", season.id)
    tier = int(row["tier"]) if row else 0
    given = 0
    for rw in season.free:
        if rw.tier <= tier and _give(svc, season, "free", rw, ts):
            given += 1
    prem = premium_state(svc)
    if prem["persist"]:
        _ensure_progress(svc, season, ts)
        first = row is None or row["premium_at"] is None
        if first:
            svc.db.exec("UPDATE season_progress SET premium_at=? WHERE season_id=?", ts, season.id)
        back = sum(1 for rw in season.premium if rw.tier <= tier and _give(svc, season, "premium", rw, ts))
        if first and back > 1:
            svc.db.feed(ts, "season", "human", "me",
                        f"{season.name_tr} premium yolu: {back} geçmiş kademe ödülü geriye dönük verildi", back,
                        {"season": season.id, "retroactive": back})
        given += back
    return given


def _archive_ended(svc: "GameService", ts: float) -> None:
    """Biten sezonun premium setini arşive işaretler ve kaçırılan ücretsiz öğe ödüllerini geç kalanlar görevine çevirir."""
    db = svc.db
    for season in SEASONS:
        if ts < season.end_ts or not db.once(f"season_archived:{season.id}", ts):
            continue
        for rw in season.premium:
            if rw.item:
                db.exec("INSERT OR IGNORE INTO season_archive(item_id,season_id,tier,archived_at) VALUES(?,?,?,?)",
                        rw.item, season.id, rw.tier, ts)
        _ensure_progress(svc, season, ts)
        db.exec("UPDATE season_progress SET archived_at=? WHERE season_id=?", ts, season.id)
        got = {r["tier"] for r in db.q("SELECT tier FROM season_rewards WHERE season_id=? AND track='free'", season.id)}
        for rw in season.free:
            if rw.item and rw.tier not in got and not db.owns(rw.item):
                db.exec("INSERT OR IGNORE INTO season_latecomer(item_id,season_id,tier,progress,target,status,created_at)"
                        " VALUES(?,?,?,0,?,'pending',?)", rw.item, season.id, rw.tier, LATECOMER_SP, ts)
        db.feed(ts, "season", "human", "me", f"{season.name_tr} bitti; premium set arşive geçti", None,
                {"season": season.id, "archived": True})
        _activate_latecomer(svc, ts)


def _activate_latecomer(svc: "GameService", ts: float) -> None:
    if svc.db.one("SELECT 1 FROM season_latecomer WHERE status='active'"):
        return
    nxt = svc.db.one("SELECT item_id FROM season_latecomer WHERE status='pending' ORDER BY season_id, tier LIMIT 1")
    if nxt:
        svc.db.exec("UPDATE season_latecomer SET status='active', started_at=? WHERE item_id=?", ts, nxt["item_id"])


def _latecomer_progress(svc: "GameService", amount: int, ts: float) -> None:
    db = svc.db
    while amount > 0:
        row = db.one("SELECT * FROM season_latecomer WHERE status='active' LIMIT 1")
        if row is None:
            return
        need = int(row["target"]) - int(row["progress"])
        step = min(need, amount)
        amount -= step
        progress = int(row["progress"]) + step
        if progress >= int(row["target"]):
            db.exec("UPDATE season_latecomer SET progress=?, status='done', done_at=? WHERE item_id=?", progress, ts,
                    row["item_id"])
            grant_item(svc, row["item_id"], "season:latecomer", ts)
            _activate_latecomer(svc, ts)
        else:
            db.exec("UPDATE season_latecomer SET progress=? WHERE item_id=?", progress, row["item_id"])


def sync(svc: "GameService", now: float | None = None) -> list[tuple[str, dict[str, Any]]]:
    """Arşiv ve (geriye dönük) ödül eşitlemesi; GET /api/game/season çağırır. Yayınlanacak olayları döndürür."""
    ts = now or time.time()
    with svc._lock:  # noqa: SLF001
        with svc.db.tx():
            def run() -> None:
                _archive_ended(svc, ts)
                season = season_at(ts)
                if season is not None and svc.db.one("SELECT 1 FROM season_progress WHERE season_id=?", season.id):
                    _grant_rewards(svc, season, ts)
            _savepoint(svc, run, None)
        return svc._drain()  # noqa: SLF001


# ---------------------------------------------------------------- görünüm
def _reward_view(rw: Reward | None, granted: set[tuple[str, int]], track: str, owned: Callable[[str], bool]) -> Any:
    if rw is None:
        return None
    got = (track, rw.tier) in granted
    return {"tier": rw.tier, "kind": rw.kind, "label": rw.label, "item": rw.item, "coins": rw.coins or None,
            "granted": got, "owned": got or bool(rw.item and owned(rw.item))}


def view(svc: "GameService", now: float | None = None) -> dict[str, Any]:
    ts = now or time.time()
    db = svc.db
    season = season_at(ts)
    last = next((s for s in reversed(SEASONS) if s.end_ts <= ts), None)
    shown = season or last
    prem = premium_state(svc)
    out: dict[str, Any] = {
        "status": "active" if season else ("ended" if last else "upcoming"),
        "tiers": TIERS, "tier_sp": TIER_SP,
        "weekly": {"cap": WEEKLY_CAP, "week": R.week_of(ts),
                   "used": int(db.scalar("SELECT COALESCE(SUM(amount),0) FROM season_points WHERE week=?",
                                         R.week_of(ts)))},
        "sources": [{"source": k, "sp": v[0], "daily_cap": v[1], "label": C._pick(*SOURCE_LABEL[k])}
                    for k, v in SP_RULES.items()],
        # Para düğmesi yok: yalnız "pakete dahil" ya da "yakında". Fiyat alanı bilinçli olarak yoktur.
        "premium": {"active": prem["active"], "source": prem["source"], "view_only": prem["active"] and not prem["persist"],
                    "included_in": "pro", "purchase": {"available": False}},
    }
    if shown is None:
        nxt = SEASONS[0]
        out["season"] = {"id": nxt.id, "number": nxt.number, "name": nxt.name, "theme": nxt.theme,
                         "starts_on": nxt.start.isoformat(), "ends_on": nxt.last_day.isoformat(), "weeks": nxt.weeks}
    else:
        out["season"] = {"id": shown.id, "number": shown.number, "name": shown.name, "theme": shown.theme,
                         "starts_on": shown.start.isoformat(), "ends_on": shown.last_day.isoformat(),
                         "weeks": shown.weeks, "week": week_index(shown, ts) if season else shown.weeks}
        sp = _season_sp(svc, shown.id)
        tier = tier_for(sp)
        granted = {(r["track"], int(r["tier"])) for r in db.q(
            "SELECT track, tier FROM season_rewards WHERE season_id=?", shown.id)}
        free = {r.tier: r for r in shown.free}
        premium = {r.tier: r for r in shown.premium}
        owned = db.owns
        out.update(sp=sp, tier=tier, next_tier_sp=None if tier >= TIERS else (tier + 1) * TIER_SP,
                   track=[{"tier": t, "reached": t <= tier,
                           "free": _reward_view(free.get(t), granted, "free", owned),
                           "premium": _reward_view(premium.get(t), granted, "premium", owned)}
                          for t in range(1, TIERS + 1)])
        out["premium_count"] = len(shown.premium)
        out["free_count"] = len(shown.free)
    out["archive"] = [{"season": s.id, "name": s.name, "items": [
        {"item": r.item, "label": r.label, "kind": r.kind, "tier": r.tier, "owned": db.owns(r.item or "")}
        for r in s.premium if r.item and db.one("SELECT 1 FROM season_archive WHERE item_id=?", r.item)]}
        for s in SEASONS if db.one("SELECT 1 FROM season_progress WHERE season_id=? AND archived_at IS NOT NULL", s.id)]
    out["latecomer"] = [{"item": r["item_id"], "season": r["season_id"], "tier": int(r["tier"]),
                         "label": ITEM_LABELS[r["item_id"]].label if r["item_id"] in ITEM_LABELS else r["item_id"],
                         "progress": int(r["progress"]), "target": int(r["target"]), "status": r["status"]}
                        for r in db.q("SELECT * FROM season_latecomer ORDER BY season_id, tier")]
    out["recent"] = [{"ts": r["ts"], "source": r["source"], "amount": int(r["amount"]), "raw": int(r["raw"]),
                      "label": C._pick(*SOURCE_LABEL.get(r["source"], (r["source"], r["source"])))}
                     for r in db.q("SELECT * FROM season_points ORDER BY id DESC LIMIT 12")]
    return out


def strip(svc: "GameService", now: float | None = None) -> dict[str, Any]:
    """Kompakt şerit (görev panosu): sezon adı, kademe, SP ve dürüst bitiş tarihi."""
    v = view(svc, now)
    return {k: v.get(k) for k in ("status", "season", "sp", "tier", "tiers", "tier_sp", "next_tier_sp", "premium")}
