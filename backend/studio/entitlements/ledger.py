"""Ayrı hak defterleri.

Dört defter, birbirine DÖNÜŞMEZ:

- `purchased`: satın alınmış hak. Yalnız lisans (`license:plus|pro`), koltuk (`seat`), özellik paketi (`pack:<id>`) ve
  kozmetik set (`cosmetic:<set>`; COS-A, §11.5) ve sahne (`scene:<id>`; 2026-10-19 gece kararı).
  **Para bakiyesi, kredi ya da tüketilebilir kapasite yoktur** (Ç-G3 / D3).
- `promo`: deneme ve kurucu hakları (`trial:<plan>`, `founder`), promosyon kotası ve tasarım ortağına verilen kozmetik
  set (`cosmetic:<set>`; satın alınmış sayılmaz).
- `period`: dönem içi haklar (aylık ve yükselme sandığı, yayın kotası). Dönem bitince süresi dolar.
- `game_xp`: oyun XP'sinin SALT OKUNUR görünümü. Bu modül oyun verisini içe aktarmaz ve yazmaz; görünüm, çağıranın verdiği
  okuyucudan bir kopya üretir. XP ve jeton hak doğurmaz; hak XP ya da jeton doğurmaz (ETHICS #1, #2, #7).

Kurallar:
- Her defter kendi tablosundadır. Hiçbir SQL deyimi iki defter tablosuna birlikte dokunmaz; defterler arası taşıma,
  dönüştürme ya da takas işlevi yoktur (mimari test: tests/test_rev_ledgers.py).
- `source_txn` bütün defterlerde tektir (`ent_txn`): aynı olay iki hak doğurmaz. Yineleme idempotenttir.
  tekillik yalnız HAK veren işlemler içindir; tüketim (`consume`) ve finans durumu (`billing_events`) kendi
  ad alanlarında tekildir ve bir hak kimliğini yeniden kullanabilir (hak doğurmadıkları için çift hak riski yoktur).
- Oyun kaynaklı olay (`game:`, `xp:`, `coin:` …) hak kaynağı olamaz; hak veren kimlik yalnız izin listesindeki
  öneklerden (`GRANT_SOURCES`: ödeme sağlayıcısı, lisans, promosyon, dönem) gelir. geçerlilik zamanları sonludur.
- Tüketim sırası: promo → period → purchased (yalnız tüketilebilir haklar; purchased'da tüketilebilir hak yoktur).
- **Gerçek lisans yokken yazma yok:** `writable` yanlışsa her yazma yalnız önizleme döner; dosya bile oluşmaz (S40).
- Ağ, ödeme, fiyat ve tutar alanı yok. Satır tutar değil ADET taşır (`units`).
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
import threading
import time
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Mapping

from studio.entitlements.plans import PACK_BY_ID, PLANS

DB_FILE = "entitlements.sqlite"
KINDS = ("purchased", "promo", "period")          # yazılabilir defterler
VIEW_KINDS = (*KINDS, "game_xp")                  # game_xp yalnız görünüm
TABLES = MappingProxyType({k: f"ent_{k}" for k in KINDS})
CONSUME_ORDER = ("promo", "period", "purchased")
CONSUMABLE = frozenset({"publish", "chest:monthly", "chest:tier_up"})

_PAID_PLANS = "|".join(sorted(p for p in PLANS if p != "free"))
_PACKS = "|".join(sorted(re.escape(p) for p in PACK_BY_ID))
# COS-A (§11.5): kozmetik set hakkı; set kimliğinin varlığını cosmetics.service doğrular (defter kataloğu içe aktarmaz).
# Tüketilemez (CONSUMABLE dışında) ve süresizdir. Ücretsiz kazanım yolu deftere YAZMAZ (game_inventory, source='earn').
_COSMETIC = r"cosmetic:[a-z0-9][a-z0-9_-]{1,40}"
# 2026-10-19 gece kararı ("her şey satılabilir"): sahne parayla da alınabilir (K6 gevşedi). Hak `scene:<id>`; sahnenin
# varlığını ve "çizilmeden satılmaz" kuralını oyun tarafı denetler. Jeton + seviye yolu aynen kalır; hak süresizdir.
_SCENE = r"scene:[a-z0-9][a-z0-9_-]{1,40}"
RIGHTS: Mapping[str, re.Pattern[str]] = MappingProxyType({
    "purchased": re.compile(rf"^(?:license:(?:{_PAID_PLANS})|seat|pack:(?:{_PACKS})|{_COSMETIC}|{_SCENE})$"),
    "promo": re.compile(rf"^(?:trial:(?:{_PAID_PLANS})|founder|publish|chest:(?:monthly|tier_up)|{_COSMETIC}|{_SCENE})$"),
    "period": re.compile(r"^(?:publish|chest:(?:monthly|tier_up))$"),
})
_TXN_RE = re.compile(r"^[A-Za-z0-9_.:@/-]{1,160}$")
_OFFER_RE = re.compile(r"^[a-z0-9:_-]{1,60}@[0-9]{1,6}$")
# Oyun olayları hak kaynağı olamaz (XP/jeton → hak dönüşümü yok)
FORBIDDEN_SOURCES = ("game:", "xp:", "coin:", "coins:", "season:", "chest_open:", "quest:", "achievement:")
# hak doğuran işlem kimliği yalnız ödeme sağlayıcısı (MoR), lisans, promosyon ve dönem öneklerinden gelir
# (izin listesi; oyun/yürüyüş/hediye/mağaza-jeton olayı yeni bir önekle de hak doğuramaz)
GRANT_SOURCES = ("mor:", "lic:", "promo:", "per:", "period:", "txn:")
MAX_UNITS = 1000

_COLUMNS = """
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_txn TEXT NOT NULL UNIQUE,
  right TEXT NOT NULL,
  units INTEGER NOT NULL CHECK (units > 0 AND units <= {max_units}),
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed >= 0 AND consumed <= units),
  offer TEXT NOT NULL,
  scope TEXT,
  valid_from REAL NOT NULL,
  valid_until REAL,
  reason TEXT NOT NULL,
  created_at REAL NOT NULL
""".format(max_units=MAX_UNITS)

SCHEMA = "\n".join(
    [f"CREATE TABLE IF NOT EXISTS {t} ({_COLUMNS});" for t in TABLES.values()]
    + ["CREATE TABLE IF NOT EXISTS ent_txn (source_txn TEXT PRIMARY KEY, ledger TEXT NOT NULL, ts REAL NOT NULL);",
       "CREATE TABLE IF NOT EXISTS ent_consumption (id INTEGER PRIMARY KEY AUTOINCREMENT, source_txn TEXT NOT NULL, "
       "ledger TEXT NOT NULL, entry_id INTEGER NOT NULL, right TEXT NOT NULL, units INTEGER NOT NULL CHECK (units > 0), "
       "ts REAL NOT NULL, UNIQUE (source_txn, ledger, entry_id));"]
)


class LedgerError(ValueError):
    """Geçersiz defter işlemi (API katmanında 400)."""


# ---------------------------------------------------------------- dosya erişimi (ortak; billing_state de kullanır)
class EntStore:
    """`entitlements.sqlite`. Okuma dosya yoksa boş döner ve dosya OLUŞTURMAZ; yazma şemayı kurar."""

    _lock = threading.RLock()

    def __init__(self, data_dir: Path | str):
        self.path = Path(data_dir) / DB_FILE

    def exists(self) -> bool:
        return self.path.is_file()

    def read(self) -> sqlite3.Connection | None:
        if not self.exists():
            return None
        con = sqlite3.connect(f"{self.path.as_uri()}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        return con

    def write(self, extra_schema: str = "") -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(self.path, isolation_level=None)
        con.row_factory = sqlite3.Row
        con.executescript(SCHEMA + extra_schema)
        return con


@dataclass(frozen=True)
class Entry:
    ledger: str
    id: int
    source_txn: str
    right: str
    units: int
    consumed: int
    offer: str
    scope: Mapping[str, Any] | None
    valid_from: float
    valid_until: float | None
    reason: str

    def active(self, now: float) -> bool:
        return self.valid_from <= now and (self.valid_until is None or now < self.valid_until)

    def remaining(self, now: float) -> int:
        return max(0, self.units - self.consumed) if self.active(now) else 0

    def public(self, now: float) -> dict[str, Any]:
        return {"ledger": self.ledger, "id": self.id, "source_txn": self.source_txn, "right": self.right,
                "units": self.units, "consumed": self.consumed, "remaining": self.remaining(now), "offer": self.offer,
                "scope": dict(self.scope) if self.scope else None, "valid_from": self.valid_from,
                "valid_until": self.valid_until, "active": self.active(now), "reason": self.reason}


@dataclass(frozen=True)
class GameXpView:
    """Oyun ilerlemesinin salt okunur kopyası. Hak defterine yazılamaz, haktan türetilmez, hakka çevrilmez."""

    office_level: int
    office_xp: int
    available: bool
    read_only: bool = True
    convertible: bool = False

    def public(self) -> dict[str, Any]:
        return {"office_level": self.office_level, "office_xp": self.office_xp, "available": self.available,
                "read_only": True, "convertible": False}


def game_xp_view(reader: Callable[[], Mapping[str, Any] | None] | None) -> GameXpView:
    """Okuyucu (çağıranın verdiği; bu modül oyunu içe aktarmaz) → değişmez görünüm. Hata ya da okuyucu yoksa boş."""
    data: Mapping[str, Any] | None = None
    if reader is not None:
        try:
            data = reader()
        except Exception:  # noqa: BLE001 - görünüm asla hak kararını bozmaz
            data = None
    if not data:
        return GameXpView(1, 0, False)
    return GameXpView(int(data.get("office_level") or 1), int(data.get("office_xp") or 0), True)


def writable_for(resolved: Any) -> bool:
    """Kalıcı yazım yalnız gerçek lisansla. Yönetici/test modu ve test paketi yalnız önizler (S40)."""
    source = getattr(resolved, "source", "default")
    if source in ("admin", "test"):
        return False
    lic = getattr(resolved, "license", None) or {}
    return lic.get("state") in ("valid", "offline_grace")


def _row_entry(kind: str, row: sqlite3.Row) -> Entry:
    scope = json.loads(row["scope"]) if row["scope"] else None
    return Entry(kind, int(row["id"]), row["source_txn"], row["right"], int(row["units"]), int(row["consumed"]),
                 row["offer"], MappingProxyType(scope) if isinstance(scope, dict) else None, float(row["valid_from"]),
                 None if row["valid_until"] is None else float(row["valid_until"]), row["reason"])


class Ledgers:
    """Üç yazılabilir defter + salt okur XP görünümü. Defterler arası işlev YOKTUR."""

    def __init__(self, data_dir: Path | str, writable: bool | Callable[[], bool] = False):
        self.store = EntStore(data_dir)
        self._writable = writable

    def writable(self) -> bool:
        w = self._writable
        try:
            return bool(w() if callable(w) else w)
        except Exception:  # noqa: BLE001 - emin değilsek yazma yok
            return False

    # ------------------------------------------------------------ doğrulama
    @staticmethod
    def _validate(kind: str, source_txn: str, right: str, units: int, offer: str, reason: str,
                  valid_from: float, valid_until: float | None) -> None:
        if kind not in KINDS:
            raise LedgerError(f"Bilinmeyen defter: {kind}")
        if not isinstance(source_txn, str) or not _TXN_RE.match(source_txn):
            raise LedgerError("Geçersiz işlem kimliği")
        if source_txn.lower().startswith(FORBIDDEN_SOURCES):
            raise LedgerError("Oyun olayı hak doğurmaz")
        if not isinstance(right, str) or not RIGHTS[kind].match(right):
            raise LedgerError(f"Bu defterde bu hak tutulamaz: {kind}")
        if isinstance(units, bool) or not isinstance(units, int) or not 0 < units <= MAX_UNITS:
            raise LedgerError("Adet 1 ile 1000 arasında olmalı")
        if not isinstance(offer, str) or not _OFFER_RE.match(offer):
            raise LedgerError("Teklif kimliği kimlik@sürüm biçiminde olmalı")
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 200:
            raise LedgerError("Gerekçe gerekli")
        for v in (valid_from, valid_until):  # NaN/±inf → süresiz ya da bozuk pencere olmasın
            if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)):
                raise LedgerError("Geçerlilik zamanı sonlu bir sayı olmalı")
        if valid_until is not None and valid_until <= valid_from:
            raise LedgerError("Bitiş başlangıçtan sonra olmalı")

    # ------------------------------------------------------------ yazma (tek defter)
    def grant(self, kind: str, *, source_txn: str, right: str, offer: str, reason: str, units: int = 1,
              valid_from: float | None = None, valid_until: float | None = None,
              scope: Mapping[str, Any] | None = None, now: float | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        try:
            valid_from = now if valid_from is None else float(valid_from)
        except (TypeError, ValueError):
            raise LedgerError("Geçerlilik zamanı sonlu bir sayı olmalı") from None
        self._validate(kind, source_txn, right, units, offer, reason, valid_from, valid_until)
        if not source_txn.lower().startswith(GRANT_SOURCES):  # izin listesi
            raise LedgerError("Hak yalnız ödeme, lisans, promosyon ya da dönem işleminden doğar")
        if kind == "period" and valid_until is None:
            raise LedgerError("Dönem hakkının bitişi olmalı")
        planned = {"ledger": kind, "source_txn": source_txn, "right": right, "units": units, "offer": offer,
                   "valid_from": valid_from, "valid_until": valid_until, "reason": reason}
        if not self.writable():
            return {"state": "preview", "written": False, **planned}
        table = TABLES[kind]
        scope_json = json.dumps(dict(scope), sort_keys=True, ensure_ascii=False) if scope else None
        with self.store._lock, closing(self.store.write()) as con:
            con.execute("BEGIN IMMEDIATE")
            try:
                seen = con.execute("SELECT ledger FROM ent_txn WHERE source_txn=?", (source_txn,)).fetchone()
                if seen is not None:
                    con.execute("ROLLBACK")
                    return {"state": "duplicate", "written": False, "ledger": seen["ledger"], "source_txn": source_txn}
                con.execute("INSERT INTO ent_txn (source_txn, ledger, ts) VALUES (?,?,?)", (source_txn, kind, now))
                cur = con.execute(
                    f"INSERT INTO {table} (source_txn, right, units, offer, scope, valid_from, valid_until, reason, "
                    "created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                    (source_txn, right, units, offer, scope_json, valid_from, valid_until, reason, now))
                con.execute("COMMIT")
            except Exception:
                con.execute("ROLLBACK")
                raise
        return {"state": "written", "written": True, "id": int(cur.lastrowid or 0), **planned}

    def consume(self, right: str, *, source_txn: str, units: int = 1, now: float | None = None) -> dict[str, Any]:
        """Tüketilebilir hakkı promo → period → purchased sırasıyla düşer. Her parça yalnız KENDİ defterinde azalır;
        bir defterden başka deftere değer aktarılmaz."""
        now = time.time() if now is None else now
        if right not in CONSUMABLE:
            raise LedgerError("Bu hak tüketilemez")
        if not isinstance(source_txn, str) or not _TXN_RE.match(source_txn):
            raise LedgerError("Geçersiz işlem kimliği")
        if isinstance(units, bool) or not isinstance(units, int) or not 0 < units <= MAX_UNITS:
            raise LedgerError("Adet 1 ile 1000 arasında olmalı")
        prior = self._consumed(source_txn)
        if prior:
            return {"state": "duplicate", "written": False, "right": right, "parts": prior}
        plan = self._plan_consume(right, units, now)
        if plan is None:
            return {"state": "insufficient", "written": False, "right": right, "units": units}
        if not self.writable():
            return {"state": "preview", "written": False, "right": right, "parts": plan}
        with self.store._lock, closing(self.store.write()) as con:
            con.execute("BEGIN IMMEDIATE")
            try:
                done = con.execute("SELECT ledger, entry_id, units FROM ent_consumption WHERE source_txn=?",
                                   (source_txn,)).fetchall()
                if done:
                    con.execute("ROLLBACK")
                    return {"state": "duplicate", "written": False, "right": right,
                            "parts": [{"ledger": d["ledger"], "entry_id": d["entry_id"], "units": d["units"]}
                                      for d in done]}
                for part in plan:
                    table = TABLES[part["ledger"]]
                    cur = con.execute(f"UPDATE {table} SET consumed = consumed + ? WHERE id=? AND consumed + ? <= units",
                                      (part["units"], part["entry_id"], part["units"]))
                    if cur.rowcount != 1:
                        raise LedgerError("Hak bu arada tükendi")
                    con.execute("INSERT INTO ent_consumption (source_txn, ledger, entry_id, right, units, ts) "
                                "VALUES (?,?,?,?,?,?)", (source_txn, part["ledger"], part["entry_id"], right,
                                                         part["units"], now))
                con.execute("COMMIT")
            except Exception:
                con.execute("ROLLBACK")
                raise
        return {"state": "written", "written": True, "right": right, "parts": plan}

    def _consumed(self, source_txn: str) -> list[dict[str, Any]]:
        con = self.store.read()
        if con is None:
            return []
        with closing(con):
            try:
                rows = con.execute("SELECT ledger, entry_id, units FROM ent_consumption WHERE source_txn=?",
                                   (source_txn,)).fetchall()
            except sqlite3.OperationalError:
                return []
        return [{"ledger": r["ledger"], "entry_id": r["entry_id"], "units": r["units"]} for r in rows]

    def _plan_consume(self, right: str, units: int, now: float) -> list[dict[str, Any]] | None:
        need, parts = units, []
        for kind in CONSUME_ORDER:
            for e in self.entries(kind, now=now):
                if e.right != right:
                    continue
                take = min(need, e.remaining(now))
                if take > 0:
                    parts.append({"ledger": kind, "entry_id": e.id, "units": take})
                    need -= take
                if need == 0:
                    return parts
        return None

    # ------------------------------------------------------------ okuma
    def entries(self, kind: str, *, now: float | None = None, active_only: bool = False) -> list[Entry]:
        if kind not in KINDS:
            raise LedgerError(f"Bilinmeyen defter: {kind}")
        now = time.time() if now is None else now
        con = self.store.read()
        if con is None:
            return []
        with closing(con):
            try:
                rows = con.execute(f"SELECT * FROM {TABLES[kind]} ORDER BY valid_from, id").fetchall()
            except sqlite3.OperationalError:
                return []
        out = [_row_entry(kind, r) for r in rows]
        return [e for e in out if e.active(now)] if active_only else out

    def available(self, right: str, *, now: float | None = None) -> dict[str, int]:
        now = time.time() if now is None else now
        return {k: sum(e.remaining(now) for e in self.entries(k, now=now) if e.right == right) for k in KINDS}

    def active_trial(self, *, now: float | None = None) -> str | None:
        """Promo defterindeki etkin deneme (okuma kancası; engine.snapshot)."""
        for e in self.entries("promo", now=now, active_only=True):
            if e.right.startswith("trial:"):
                return e.right.split(":", 1)[1]
        return None

    def view(self, *, now: float | None = None,
             xp_reader: Callable[[], Mapping[str, Any] | None] | None = None) -> dict[str, Any]:
        now = time.time() if now is None else now
        out: dict[str, Any] = {k: [e.public(now) for e in self.entries(k, now=now)] for k in KINDS}
        out["game_xp"] = game_xp_view(xp_reader).public()
        out["writable"] = self.writable()
        out["consume_order"] = list(CONSUME_ORDER)
        out["convertible"] = False
        return out
