"""E2 parsel verisi.

`game.sqlite` içinde ayrı, eklemeli tablolar (oyun defteriyle aynı bağlantı; jeton harcaması aynı işlemde yazılır):

- `expanse_worlds`: dünya başına tohum (yerleşik sahnede NULL → arayüz `worldSeed(sahne)` kullanır) ve keşfedilen parsel
  bit kümesi (yalnız mini harita; ödül yok).
- `expanse_plots`: sahiplenilen parseller. Anahtar `(world, slot)` tekildir; parselin dünya konumu saklanmaz, arayüz yuva
  sırasından her seferinde hesaplar (§7.2). `source`: `free` (ilk parsel), `coins` (kazanılmış jeton), `admin` (yönetici/test
  modu deneme parseli; jeton harcanmaz, mod kapanınca görünmez ve yuva yeniden sahiplenilebilir).

Dünya anahtarı: yerleşik sahnede sahne kimliği (`office`, `istanbul`…), kullanıcı dünyasında `w_…` kimliği.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from studio.game.db import GameDB

SCHEMA = """
CREATE TABLE IF NOT EXISTS expanse_worlds (
  world TEXT PRIMARY KEY, seed INTEGER, explored BLOB NOT NULL DEFAULT x'', created REAL NOT NULL, updated REAL NOT NULL);
CREATE TABLE IF NOT EXISTS expanse_plots (
  id TEXT PRIMARY KEY, world TEXT NOT NULL, slot INTEGER NOT NULL CHECK (slot >= 0 AND slot < 16),
  source TEXT NOT NULL CHECK (source IN ('free','coins','admin')), price INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '{}',
  claimed_at REAL NOT NULL, updated REAL NOT NULL, UNIQUE (world, slot));
CREATE INDEX IF NOT EXISTS ix_expanse_plots_world ON expanse_plots(world);
CREATE TABLE IF NOT EXISTS expanse_requests (
  request_id TEXT PRIMARY KEY, response TEXT NOT NULL, ts REAL NOT NULL);
"""


def ensure_schema(db: "GameDB") -> None:
    """Tabloları eklemeli kurar (bağlantı başına bir kez; işlem dışında çağrılır)."""
    if getattr(db, "_expanse_schema", False):
        return
    with db._lock:
        db.conn.executescript(SCHEMA)
        _widen_slots(db)
        db._expanse_schema = True  # type: ignore[attr-defined]


def _widen_slots(db: "GameDB") -> None:
    """2026-10-19 ek arsa paketi: eski tablolardaki `slot < 12` denetimini `slot < 16`'ya genişletir (satırlar aynen
    kopyalanır; SQLite CHECK değiştiremediği için tablo tek işlemde yeniden kurulur). Yeni kurulumda iş yoktur."""
    row = db.conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='expanse_plots'").fetchone()
    if not row or "slot < 12" not in (row[0] or ""):
        return
    new_sql = row[0].replace("slot < 12", "slot < 16").replace("CREATE TABLE expanse_plots", "CREATE TABLE expanse_plots_v2", 1)
    if "expanse_plots_v2" not in new_sql:
        return
    db.conn.executescript(
        "BEGIN;"
        f"{new_sql};"
        "INSERT INTO expanse_plots_v2 SELECT * FROM expanse_plots;"
        "DROP TABLE expanse_plots;"
        "ALTER TABLE expanse_plots_v2 RENAME TO expanse_plots;"
        "CREATE INDEX IF NOT EXISTS ix_expanse_plots_world ON expanse_plots(world);"
        "COMMIT;")
