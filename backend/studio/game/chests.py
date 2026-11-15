"""Üyelik sandıkları (-10-19; etik madde 6).

Minecraft'taki sandık hissi, ama yasal ve etik:

- **İçerik açmadan önce bellidir.** Aylık sandık "gösterilen 3 öğeden 1'ini seç"tir; üç seçenek bütün üyeler için AYNI aylık
  rotasyondan gelir (`MONTHLY_SETS`, takvimden belirlenir) ve sandık yazıldığı an saklanır. Yükselme sandığı sabit settir.
  Hiçbir yerde rastgele çekiliş yoktur: ücretli rastgelelik (ganimet kutusu) mümkün değildir.
- **Satın alınamaz, jetonla açılamaz, yeniden çekilemez.** Bu modülde fiyat, jeton ya da ödeme alanı yoktur; açılmış sandık her
  çağrıda aynı sonucu döndürür. Sandık yalnız üyeliğin (Plus, Pro) yan hakkıdır; tek başına satılmaz.
- **Yalnız kozmetik.** Masa süsü, kahraman görünüşü, sahne varyantı, yapı malzemesi kaplaması, kutlama stili. XP, jeton, SP,
  koltuk ya da üretkenlik vermez.
- **Kazanma:** üye olunan her ayın sandıkları (yerel 04:00 gün sınırıyla ay; `R.day_of`) ve her katmana ilk yükselişte bir sabit
  set. Ay içinde üye olan o ayın sandığını hemen alır (geriye dönük). Geçmiş aylar geriye yazılmaz; rotasyon 5 ayda bir döner,
  hiçbir öğe kalıcı olarak kaçmaz. Açılmamış sandık süresiz bekler; üyelik bitse de açılabilir (İ4).
- **Kopya koruması:** sahip olunan öğe seçilemez; sabit setin sahip olunan öğesi atlanır. Hepsi sendeyse sandık boş açılır,
  hiçbir şey kaybolmaz.
- **Yönetici / test modu ve test paketi yalnız ÖNİZLER** (S40): sandık yazılmaz, açılmaz.
- Paket bilgisi yalnız `GameService.membership` yardımcısından gelir (T15: motor yalnız kontrol noktalarından sorulur).
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from studio.game import catalog as C
from studio.game import rules as R

if TYPE_CHECKING:
    from studio.game.db import GameDB
    from studio.game.service import GameService

SCHEMA = """
CREATE TABLE IF NOT EXISTS chest_grants (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('monthly','tier_up')), tier TEXT NOT NULL,
  period TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('choose','fixed')), options TEXT NOT NULL,
  granted_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS chest_opens (
  grant_id TEXT PRIMARY KEY, chosen TEXT, items TEXT NOT NULL, opened_at REAL NOT NULL);
"""

TIER_ORDER = ("free", "plus", "pro")


@dataclass(frozen=True)
class ChestItem:
    id: str
    kind: str          # decor | skin | variant | material | celebration | plaque
    label_tr: str
    label_en: str

    @property
    def label(self) -> str:
        return C._pick(self.label_tr, self.label_en)


ITEMS: tuple[ChestItem, ...] = (
    ChestItem("chest:desk-terrarium", "decor", "Masa teraryumu", "Desk terrarium"),
    ChestItem("chest:desk-hourglass", "decor", "Kum saati", "Hourglass"),
    ChestItem("chest:desk-record", "decor", "Pikap", "Record player"),
    ChestItem("chest:skin-explorer", "skin", "Kâşif görünüşü (kahraman)", "Explorer look (hero)"),
    ChestItem("chest:skin-chef", "skin", "Aşçı görünüşü (kahraman)", "Chef look (hero)"),
    ChestItem("chest:skin-astronaut", "skin", "Astronot görünüşü (kahraman)", "Astronaut look (hero)"),
    ChestItem("chest:variant-office-night", "variant", "Ofis sahnesi: gece ışıkları", "Office scene: night lights"),
    ChestItem("chest:variant-park-autumn", "variant", "Park sahnesi: sonbahar", "Park scene: autumn"),
    ChestItem("chest:variant-beach-sunset", "variant", "Plaj sahnesi: gün batımı", "Beach scene: sunset"),
    ChestItem("chest:mat-copper", "material", "Bakır kaplama (yapı malzemesi)", "Copper finish (builder material)"),
    ChestItem("chest:mat-tile", "material", "Mozaik karo (yapı malzemesi)", "Mosaic tile (builder material)"),
    ChestItem("chest:mat-birch", "material", "Huş tahtası (yapı malzemesi)", "Birch plank (builder material)"),
    ChestItem("chest:cel-gold-confetti", "celebration", "Altın konfeti kutlaması", "Gold confetti celebration"),
    ChestItem("chest:cel-lanterns", "celebration", "Uçan fener kutlaması", "Sky lantern celebration"),
    ChestItem("chest:cel-bubbles", "celebration", "Baloncuk kutlaması", "Bubble celebration"),
    ChestItem("chest:plaque-plus", "plaque", "Plus üye plaketi", "Plus member plaque"),
    ChestItem("chest:banner-plus", "decor", "Plus ofis bayrağı", "Plus office banner"),
    ChestItem("chest:plaque-pro", "plaque", "Pro üye plaketi", "Pro member plaque"),
    ChestItem("chest:statue-pro", "decor", "Pro masa heykelciği", "Pro desk statuette"),
    ChestItem("chest:cel-pro-aurora", "celebration", "Kutup ışığı kutlaması", "Aurora celebration"),
)
ITEM_BY_ID = {i.id: i for i in ITEMS}

# Aylık rotasyon: her set farklı türleri karıştırır. Ay indeksi (yıl × 12 + ay) ve sandık sırası seti seçer; herkes için
# aynıdır ve önceden bellidir (gelecek ay görünümde yazılı).
MONTHLY_SETS: tuple[tuple[str, str, str], ...] = (
    ("chest:desk-terrarium", "chest:skin-explorer", "chest:variant-office-night"),
    ("chest:mat-copper", "chest:cel-gold-confetti", "chest:desk-hourglass"),
    ("chest:skin-chef", "chest:variant-park-autumn", "chest:mat-tile"),
    ("chest:cel-lanterns", "chest:desk-record", "chest:skin-astronaut"),
    ("chest:variant-beach-sunset", "chest:mat-birch", "chest:cel-bubbles"),
)
# Katmana ilk yükselişte sabit set (bir kez; hem Plus hem Pro'ya geçen ikisini de alır).
TIER_UP_SETS: dict[str, tuple[str, ...]] = {
    "plus": ("chest:plaque-plus", "chest:banner-plus"),
    "pro": ("chest:plaque-pro", "chest:statue-pro", "chest:cel-pro-aurora"),
}


def ensure_schema(db: "GameDB") -> None:
    """Eklemeli göç (bağlantı başına bir kez; işlem dışında çağrılır)."""
    if getattr(db, "_chest_schema", False):
        return
    with db._lock:  # noqa: SLF001
        db.conn.executescript(SCHEMA)
        db._chest_schema = True  # type: ignore[attr-defined]


# ---------------------------------------------------------------- takvim ve haklar
def month_of(ts: float) -> str:
    """Yerel ay, gün sınırı 04:00 (`R.day_of` ile aynı): 'YYYY-AA'.

 (bilinçli ödünleşim): saat yerel işletim sisteminden okunur; saati ileri alan kullanıcı gelecek ayların
    sandıklarını erken açabilir. İçerik yalnız görünüştür, yereldir ve önceden gösterilir; (lisans) gelince aylık
    hak lisansın geçerlilik penceresine bağlanacak."""
    return R.day_of(ts)[:7]


def _month_index(month: str) -> int:
    y, m = month.split("-")
    return int(y) * 12 + int(m) - 1


def _next_month(month: str) -> str:
    i = _month_index(month) + 1
    return f"{i // 12:04d}-{i % 12 + 1:02d}"


def monthly_options(month: str, n: int) -> tuple[str, str, str]:
    """Ayın n. sandığının üç seçeneği (n = 0, 1). Deterministik, kullanıcıya göre değişmez."""
    return MONTHLY_SETS[(_month_index(month) * 2 + n) % len(MONTHLY_SETS)]


def _tier_rank(tier: str | None) -> int:
    return TIER_ORDER.index(tier) if tier in TIER_ORDER else 0


def entitled(svc: "GameService", month: str) -> list[dict[str, Any]]:
    """Bu üyeliğin bu ay için hak ettiği sandıklar (yazılmamış tanımlar). Motor yok ya da Free → []."""
    m = svc.membership()
    if not m:
        return []
    tier, rule = m["chest_tier"], m["chests"]
    out: list[dict[str, Any]] = []
    for n in range(int(rule.get("monthly") or 0)):
        out.append({"id": f"chest:m:{month}:{n}", "kind": "monthly", "tier": tier, "period": month, "mode": "choose",
                    "options": list(monthly_options(month, n))})
    if rule.get("tier_up"):
        for t in TIER_ORDER[1:_tier_rank(tier) + 1]:
            out.append({"id": f"chest:t:{t}", "kind": "tier_up", "tier": t, "period": t, "mode": "fixed",
                        "options": list(TIER_UP_SETS[t])})
    return out


# ---------------------------------------------------------------- yazımlar
def sync(svc: "GameService", now: float | None = None) -> list[tuple[str, dict[str, Any]]]:
    """Hak edilen sandıkları bir kez yazar (idempotent: birincil anahtar). Önizleme modunda hiçbir şey yazmaz."""
    ensure_schema(svc.db)
    ts = now or time.time()
    m = svc.membership()
    if not m or not m["persist"]:
        return []
    with svc._lock:  # noqa: SLF001
        with svc.db.tx():
            for g in entitled(svc, month_of(ts)):
                added = svc.db.exec(
                    "INSERT OR IGNORE INTO chest_grants(id,kind,tier,period,mode,options,granted_at) VALUES(?,?,?,?,?,?,?)",
                    g["id"], g["kind"], g["tier"], g["period"], g["mode"], json.dumps(g["options"]), ts) == 1
                if added:
                    svc.db.feed(ts, "chest", "human", "me", "Üyelik sandığı geldi (içeriği açmadan önce belli)", None,
                                {"chest": g["id"], "kind": g["kind"]})
                    svc._emit("game.chest", chest=g["id"], status="granted")  # noqa: SLF001
        return svc._drain()  # noqa: SLF001


def open_chest(svc: "GameService", chest_id: str, choice: str | None = None) -> dict[str, Any]:
    """Sandığı açar. `choice`: aylık sandıkta gösterilen 3 öğeden biri. Bedel, jeton ya da fiyat parametresi YOK; açılmış
    sandık aynı sonucu döndürür (yeniden çekme yok)."""
    ensure_schema(svc.db)
    m = svc.membership()
    if svc.admin() or (m is not None and m["source"] in ("admin", "test")):
        raise ValueError("Yönetici / test modunda sandık açılmaz (yalnız önizleme)")
    now = time.time()
    with svc._lock:  # noqa: SLF001
        with svc.db.tx():
            row = svc.db.one("SELECT * FROM chest_grants WHERE id=?", chest_id)
            if row is None:
                raise KeyError("Sandık yok")
            done = svc.db.one("SELECT * FROM chest_opens WHERE grant_id=?", chest_id)
            if done is not None:
                return {"ok": True, "already": True, "chest": _view(svc, row, done), "events": []}
            options: list[str] = json.loads(row["options"])
            unowned = [i for i in options if not svc.db.owns(i)]
            if row["mode"] == "choose":
                if unowned:
                    if not choice:
                        raise ValueError("Bu sandıktan bir öğe seç")
                    if choice not in options:
                        raise ValueError("Seçilen öğe bu sandıkta yok")
                    if choice not in unowned:
                        raise ValueError("Bu öğe zaten sende; başka birini seç")
                    items = [choice]
                else:
                    items = []          # hepsi sende: boş açılır, hiçbir şey kaybolmaz
            else:
                items = unowned
            for item in items:
                _grant(svc, item, chest_id, now)
            svc.db.exec("INSERT INTO chest_opens(grant_id,chosen,items,opened_at) VALUES(?,?,?,?)",
                        chest_id, choice if row["mode"] == "choose" and items else None, json.dumps(items), now)
            labels = ", ".join(ITEM_BY_ID[i].label_tr for i in items) or "yeni öğe yok (hepsi sende)"
            svc.db.feed(now, "chest", "human", "me", f"Üyelik sandığı açıldı: {labels}", None,
                        {"chest": chest_id, "items": items})
            svc._emit("game.chest", chest=chest_id, status="opened", items=items)  # noqa: SLF001
            done = svc.db.one("SELECT * FROM chest_opens WHERE grant_id=?", chest_id)
            view_row = _view(svc, row, done)
        events = svc._drain()  # noqa: SLF001
    return {"ok": True, "chest": view_row, "events": events}


def _grant(svc: "GameService", item_id: str, chest_id: str, ts: float) -> bool:
    if not svc.db.grant(item_id, f"chest:{chest_id}", ts):
        return False
    it = ITEM_BY_ID[item_id]
    svc.db.feed(ts, "unlock", None, None, f"Kilit açıldı: {it.label_tr}", None, {"item": item_id, "source": "chest"})
    svc._emit("game.unlock", item=item_id, label=it.label, kind=it.kind, source="chest")  # noqa: SLF001
    return True


# ---------------------------------------------------------------- görünüm
def _option(svc: "GameService", item_id: str) -> dict[str, Any]:
    it = ITEM_BY_ID[item_id]
    return {"item": it.id, "kind": it.kind, "label": it.label, "owned": svc.db.owns(it.id)}


def _view(svc: "GameService", row: Any, opened: Any | None) -> dict[str, Any]:
    options = json.loads(row["options"])
    return {"id": row["id"], "kind": row["kind"], "tier": row["tier"], "period": row["period"], "mode": row["mode"],
            "granted_at": row["granted_at"], "options": [_option(svc, i) for i in options],
            "opened_at": opened["opened_at"] if opened else None,
            "chosen": opened["chosen"] if opened else None,
            "items": [_option(svc, i) for i in json.loads(opened["items"])] if opened else [],
            "preview": False}


def _preview(svc: "GameService", g: dict[str, Any]) -> dict[str, Any]:
    return {"id": g["id"], "kind": g["kind"], "tier": g["tier"], "period": g["period"], "mode": g["mode"],
            "granted_at": None, "options": [_option(svc, i) for i in g["options"]], "opened_at": None, "chosen": None,
            "items": [], "preview": True}


def view(svc: "GameService", now: float | None = None) -> dict[str, Any]:
    ensure_schema(svc.db)
    ts = now or time.time()
    month = month_of(ts)
    m = svc.membership() or {"plan": "free", "source": "default", "chest_tier": "free",
                             "chests": {"monthly": 0, "tier_up": False}, "packs": [], "persist": False}
    rows = svc.db.q("SELECT * FROM chest_grants ORDER BY granted_at DESC, id")
    opens = {r["grant_id"]: r for r in svc.db.q("SELECT * FROM chest_opens")}
    chests = [_view(svc, r, opens.get(r["id"])) for r in rows]
    preview = [] if m["persist"] else [_preview(svc, g) for g in entitled(svc, month)]
    nxt = _next_month(month)
    return {
        "month": month,
        "membership": {"plan": m["plan"], "source": m["source"], "tier": m["chest_tier"],
                       "monthly": int(m["chests"].get("monthly") or 0), "tier_up": bool(m["chests"].get("tier_up")),
                       "persist": bool(m["persist"])},
        "chests": chests,
        "unopened": sum(1 for c in chests if c["opened_at"] is None),
        "preview": preview,
        # Gelecek ayın seçenekleri önceden yazılı (Plus 1. set, Pro 1. ve 2. set)
        "next_month": {"month": nxt, "sets": [[_option(svc, i) for i in monthly_options(nxt, n)] for n in range(2)]},
        "tier_up_sets": {t: [_option(svc, i) for i in s] for t, s in TIER_UP_SETS.items()},
        # Etik sözleşme (arayüz metin olarak gösterir)
        "rules": {"contents_known": True, "purchasable": False, "coin_open": False, "reroll": False,
                  "random": False, "duplicates": False, "expires": False, "cosmetic_only": True},
        "free_alternative": "surprise_box",
    }
