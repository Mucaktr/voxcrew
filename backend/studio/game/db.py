"""Oyun verisi: veri dizininde ayrı `game.sqlite` (araştırma D.2). Graf temiz kalır; sıfırlama ve dışa aktarma kolaydır.

Tüm yazımlar idempotenttir: her ödülün deterministik bir anahtarı (`idem`) vardır ve `INSERT OR IGNORE` ile yazılır.
Bağlantı birden çok iş parçacığından kullanılabilir; her işlem `tx()` kilidi altında yürür.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS game_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS game_seen (idem TEXT PRIMARY KEY, ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS game_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idem TEXT NOT NULL UNIQUE,
  ts REAL NOT NULL, day TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('agent','human','office','external')),
  subject_id TEXT NOT NULL,
  rule TEXT NOT NULL, rule_version INTEGER NOT NULL,
  raw INTEGER NOT NULL, capped INTEGER NOT NULL, amount INTEGER NOT NULL,
  diminish INTEGER NOT NULL DEFAULT 0, cap_key TEXT,
  run_id TEXT, step_id TEXT, explain TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_ledger_subject_day ON game_ledger(subject_type, subject_id, day);
CREATE INDEX IF NOT EXISTS ix_ledger_cap ON game_ledger(cap_key);
CREATE INDEX IF NOT EXISTS ix_ledger_run ON game_ledger(run_id);
CREATE INDEX IF NOT EXISTS ix_ledger_rule_day ON game_ledger(rule, subject_type, day);
CREATE TABLE IF NOT EXISTS game_coins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, idem TEXT NOT NULL UNIQUE, ts REAL NOT NULL, day TEXT NOT NULL,
  amount INTEGER NOT NULL, reason TEXT NOT NULL, ref TEXT, explain TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_coins_day ON game_coins(day, reason);
CREATE TABLE IF NOT EXISTS game_state (
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, updated_at REAL,
  PRIMARY KEY (subject_type, subject_id));
CREATE TABLE IF NOT EXISTS game_counters (
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, name TEXT NOT NULL, value REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (subject_type, subject_id, name));
CREATE TABLE IF NOT EXISTS game_achievements (
  subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, achievement_id TEXT NOT NULL, tier INTEGER NOT NULL,
  unlocked_at REAL NOT NULL, idem TEXT NOT NULL UNIQUE, seen INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject_type, subject_id, achievement_id, tier));
CREATE TABLE IF NOT EXISTS game_quests (
  id TEXT PRIMARY KEY, template TEXT NOT NULL, kind TEXT NOT NULL, period TEXT NOT NULL, slot INTEGER NOT NULL,
  params TEXT NOT NULL DEFAULT '{}', progress INTEGER NOT NULL DEFAULT 0, target INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','done','claimed','swapped')),
  created_at REAL NOT NULL, done_at REAL, claimed_at REAL);
CREATE TABLE IF NOT EXISTS game_inventory (
  item_id TEXT PRIMARY KEY, source TEXT NOT NULL, acquired_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS game_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, kind TEXT NOT NULL,
  subject_type TEXT, subject_id TEXT, text TEXT NOT NULL, amount INTEGER, data TEXT);
CREATE TABLE IF NOT EXISTS game_repeat (hash TEXT NOT NULL, ts REAL NOT NULL, run_id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_repeat_hash ON game_repeat(hash, ts);
CREATE TABLE IF NOT EXISTS game_tokens (
  workflow TEXT NOT NULL, step TEXT NOT NULL, run_id TEXT NOT NULL, tokens INTEGER NOT NULL, ts REAL NOT NULL,
  PRIMARY KEY (workflow, step, run_id));
-- W1b takdir (eklemeli göç): hediye kaydı, haftanın çalışanı (kullanıcı seçer), takdir ayarları
CREATE TABLE IF NOT EXISTS gift_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, item TEXT NOT NULL, kind TEXT NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0, recognition_id TEXT, run_id TEXT, deliverable_id TEXT, team TEXT,
  ts REAL NOT NULL, day TEXT NOT NULL, week TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE);
CREATE INDEX IF NOT EXISTS ix_gift_agent_day ON gift_log(agent, day);
CREATE INDEX IF NOT EXISTS ix_gift_agent_week ON gift_log(agent, week);
CREATE TABLE IF NOT EXISTS weekly_pick (
  week TEXT PRIMARY KEY, agent TEXT NOT NULL, recognition_id TEXT, reason TEXT, ts REAL NOT NULL);
CREATE TABLE IF NOT EXISTS recognition_prefs (scope TEXT PRIMARY KEY, value TEXT NOT NULL);
-- PK-2 sezon (eklemeli göç; game/season.py): SP defteri (yalnız gerçek iş sinyali), sezon durumu, verilen kademe
-- ödülleri, arşiv işaretleri ve geç kalanlar görevleri
CREATE TABLE IF NOT EXISTS season_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT, idem TEXT NOT NULL UNIQUE, ts REAL NOT NULL, day TEXT NOT NULL,
  week TEXT NOT NULL, season_id TEXT NOT NULL, source TEXT NOT NULL, raw INTEGER NOT NULL, amount INTEGER NOT NULL,
  explain TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_season_points_week ON season_points(week);
CREATE INDEX IF NOT EXISTS ix_season_points_src ON season_points(source, day);
CREATE TABLE IF NOT EXISTS season_progress (
  season_id TEXT PRIMARY KEY, sp INTEGER NOT NULL DEFAULT 0, tier INTEGER NOT NULL DEFAULT 0,
  premium_at REAL, archived_at REAL, started_at REAL NOT NULL, updated_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS season_rewards (
  season_id TEXT NOT NULL, track TEXT NOT NULL CHECK (track IN ('free','premium')), tier INTEGER NOT NULL,
  item_id TEXT, coins INTEGER NOT NULL DEFAULT 0, granted_at REAL NOT NULL, PRIMARY KEY (season_id, track, tier));
CREATE TABLE IF NOT EXISTS season_archive (
  item_id TEXT PRIMARY KEY, season_id TEXT NOT NULL, tier INTEGER NOT NULL, archived_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS season_latecomer (
  item_id TEXT PRIMARY KEY, season_id TEXT NOT NULL, tier INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
  target INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','active','done')),
  created_at REAL NOT NULL, started_at REAL, done_at REAL);
-- G2-D / karar R-2 (eklemeli göç; game/service.py): koşu sırasında hesaplanan ajan XP'si önce burada BEKLER;
-- kullanıcının kabulünde teslimin sürüm zinciri başına bir kez deftere geçer (granted) ya da yerini yeni sürüm aldıysa
-- düşer (void). `game_versions`: kabul kaydı → kök teslim ve koşu (sürüm zinciri; yalnız kimlikler).
CREATE TABLE IF NOT EXISTS game_pending (
  idem TEXT PRIMARY KEY, ts REAL NOT NULL, run_id TEXT NOT NULL, step_id TEXT, agent TEXT NOT NULL,
  rule TEXT NOT NULL, raw INTEGER NOT NULL, capped INTEGER NOT NULL, diminish INTEGER NOT NULL DEFAULT 0,
  cap_key TEXT, explain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','granted','void')), settled_at REAL,
  settled_by TEXT);
CREATE INDEX IF NOT EXISTS ix_pending_run ON game_pending(run_id, status);
CREATE INDEX IF NOT EXISTS ix_pending_cap ON game_pending(cap_key);
CREATE TABLE IF NOT EXISTS game_versions (
  acceptance_id TEXT PRIMARY KEY, root_id TEXT NOT NULL, run_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS ix_versions_root ON game_versions(root_id);
-- PK-2 sürpriz teslim kutusu (eklemeli göç; game/surprise.py): haftalık görev başına bir ücretsiz kutu
CREATE TABLE IF NOT EXISTS surprise_log (
  id TEXT PRIMARY KEY, quest_id TEXT NOT NULL UNIQUE, earned_at REAL NOT NULL, opened_at REAL, item_id TEXT,
  rarity TEXT, odds TEXT);
"""


class GameDB:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        if str(path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.created = str(path) == ":memory:" or not self.path.exists()
        self._lock = threading.RLock()
        self._depth = 0
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        if str(path) != ":memory:":
            self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self.conn.close()

    @contextmanager
    def tx(self) -> Iterator[None]:
        """Tek bir SQLite işlemi (iç içe çağrılar dıştakine katılır)."""
        with self._lock:
            outer = self._depth == 0
            if outer:
                self.conn.execute("BEGIN IMMEDIATE")
            self._depth += 1
            try:
                yield
            except BaseException:
                self._depth -= 1
                if outer:
                    self.conn.execute("ROLLBACK")
                raise
            self._depth -= 1
            if outer:
                self.conn.execute("COMMIT")

    # ------------------------------------------------------------ genel yardımcılar
    def q(self, sql: str, *params: Any) -> list[sqlite3.Row]:
        with self._lock:
            return self.conn.execute(sql, params).fetchall()

    def one(self, sql: str, *params: Any) -> sqlite3.Row | None:
        with self._lock:
            return self.conn.execute(sql, params).fetchone()

    def scalar(self, sql: str, *params: Any, default: Any = 0) -> Any:
        row = self.one(sql, *params)
        return default if row is None or row[0] is None else row[0]

    def exec(self, sql: str, *params: Any) -> int:
        """Değişen satır sayısını döndürür."""
        with self._lock:
            return self.conn.execute(sql, params).rowcount

    # ------------------------------------------------------------ meta ve tekillik
    def meta(self, key: str, default: str | None = None) -> str | None:
        row = self.one("SELECT value FROM game_meta WHERE key=?", key)
        return row["value"] if row else default

    def set_meta(self, key: str, value: Any) -> None:
        self.exec("INSERT INTO game_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  key, str(value))

    def once(self, idem: str, ts: float | None = None) -> bool:
        """Anahtar ilk kez görülüyorsa True (idempotent sayaçlar için)."""
        return self.exec("INSERT OR IGNORE INTO game_seen(idem, ts) VALUES(?,?)", idem, ts or time.time()) == 1

    # ------------------------------------------------------------ sayaçlar
    def counter(self, st: str, sid: str, name: str) -> float:
        return float(self.scalar("SELECT value FROM game_counters WHERE subject_type=? AND subject_id=? AND name=?",
                                 st, sid, name))

    def incr(self, st: str, sid: str, name: str, by: float = 1) -> float:
        self.exec("INSERT INTO game_counters(subject_type,subject_id,name,value) VALUES(?,?,?,?) "
                  "ON CONFLICT(subject_type,subject_id,name) DO UPDATE SET value=value+excluded.value",
                  st, sid, name, by)
        return self.counter(st, sid, name)

    def set_max(self, st: str, sid: str, name: str, value: float) -> float:
        self.exec("INSERT INTO game_counters(subject_type,subject_id,name,value) VALUES(?,?,?,?) "
                  "ON CONFLICT(subject_type,subject_id,name) DO UPDATE SET value=MAX(value, excluded.value)",
                  st, sid, name, value)
        return self.counter(st, sid, name)

    # ------------------------------------------------------------ durum
    def state(self, st: str, sid: str) -> tuple[int, int]:
        row = self.one("SELECT xp, level FROM game_state WHERE subject_type=? AND subject_id=?", st, sid)
        return (int(row["xp"]), int(row["level"])) if row else (0, 1)

    def set_state(self, st: str, sid: str, xp: int, level: int, ts: float) -> None:
        self.exec("INSERT INTO game_state(subject_type,subject_id,xp,level,updated_at) VALUES(?,?,?,?,?) "
                  "ON CONFLICT(subject_type,subject_id) DO UPDATE SET xp=excluded.xp, level=excluded.level, "
                  "updated_at=excluded.updated_at", st, sid, xp, level, ts)

    def balance(self) -> int:
        return int(self.scalar("SELECT COALESCE(SUM(amount),0) FROM game_coins"))

    def add_coins(self, idem: str, ts: float, day: str, amount: int, reason: str, explain: str,
                  ref: str | None = None) -> bool:
        return self.exec("INSERT OR IGNORE INTO game_coins(idem,ts,day,amount,reason,ref,explain) VALUES(?,?,?,?,?,?,?)",
                         idem, ts, day, amount, reason, ref, explain) == 1

    def owns(self, item_id: str) -> bool:
        return self.one("SELECT 1 FROM game_inventory WHERE item_id=?", item_id) is not None

    def grant(self, item_id: str, source: str, ts: float) -> bool:
        return self.exec("INSERT OR IGNORE INTO game_inventory(item_id,source,acquired_at) VALUES(?,?,?)",
                         item_id, source, ts) == 1

    def feed(self, ts: float, kind: str, st: str | None, sid: str | None, text: str, amount: int | None = None,
             data: dict[str, Any] | None = None) -> None:
        self.exec("INSERT INTO game_feed(ts,kind,subject_type,subject_id,text,amount,data) VALUES(?,?,?,?,?,?,?)",
                  ts, kind, st, sid, text, amount, json.dumps(data or {}, ensure_ascii=False))
