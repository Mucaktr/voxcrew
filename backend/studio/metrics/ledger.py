"""Yerel ölçüm defteri: `<veri>/metrics.sqlite` (G1-A).

Kurallar:
- `events` tablosunun birincil anahtarı deterministik `event_id`'dir; yazma `INSERT OR IGNORE`. Aynı olay iki kez
  gelirse (olay yolu + graf taraması, yeniden başlatma) tek kayıt kalır (AW-T21 deseni).
- Yalnız kimlik ve sayı: koşu/kabul/sistem çağrısı kimliği, sınıf, durum, token, maliyet, girdi İMZASI (özet). İstem,
  çıktı, başlık, dosya adı ya da ajan adı yazılmaz.
- Atılan ortak alanlar: `user_id`, `session_id`, `acquisition_channel`, `experiment_assignments` (STRATEGY §6.1).
- `meta` tablosu: graf filigranları, silme anı (`epoch`) ve şema sürümü.
- Ağ çağrısı yok; dosya yerel veri dizinindedir.
"""

from __future__ import annotations

import hashlib
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 1
EVENT_VERSION = 1

# Olay türleri (Rehber 2 §12 adlarının yerel karşılıkları)
TASK_SUBMITTED = "task_submitted"        # koşu başladı (kök, çatal ya da gizli sistem koşusu)
COST_RECORDED = "cost_recorded"          # koşunun ya da sistem çağrısının (o anki) kullanım anlık görüntüsü
ARTIFACT_ACCEPTED = "artifact_accepted"  # kabul kararı
ARTIFACT_REJECTED = "artifact_rejected"  # ret ya da revizyon isteği (kabul değil)
EVENT_TYPES = (TASK_SUBMITTED, COST_RECORDED, ARTIFACT_ACCEPTED, ARTIFACT_REJECTED)

COLUMNS: tuple[tuple[str, str], ...] = (
    ("event_id", "TEXT PRIMARY KEY"),
    ("event_type", "TEXT NOT NULL"),
    ("event_version", "INTEGER NOT NULL"),
    ("occurred_at", "REAL NOT NULL"),          # unix zaman damgası (hesaplar bunu kullanır)
    ("occurred_at_utc", "TEXT NOT NULL"),
    ("received_at_utc", "TEXT NOT NULL"),
    ("app_version", "TEXT"),
    ("is_demo", "INTEGER NOT NULL DEFAULT 0"),
    ("environment", "TEXT NOT NULL DEFAULT 'normal'"),  # normal | test_plan | admin_preview
    ("run_id", "TEXT"),
    ("task_root_id", "TEXT"),
    ("attempt", "INTEGER NOT NULL DEFAULT 0"),           # çatal zincirindeki derinlik (0 = kök)
    ("task_family", "TEXT"),                             # recipe:<id> | workflow:<slug> | gorev
    ("recipe_version", "TEXT"),
    ("origin_class", "TEXT NOT NULL"),                   # real | demo | academy | eval | system
    ("root_class", "TEXT"),                              # kök görevin sınıfı (sistem koşusu gerçek köke bağlanır)
    ("status", "TEXT"),
    ("reviewer_kind", "TEXT"),                           # user | agent (kabul olayları)
    ("review_status", "TEXT"),                           # unreviewed | accepted | revision_requested | rejected (G1-C)
    ("outcome", "TEXT"),                                 # tam sürüm: accepted | partial | …
    ("version", "INTEGER NOT NULL DEFAULT 1"),           # çıktı sürümü (G1-C)
    ("superseded", "INTEGER NOT NULL DEFAULT 0"),        # yerine yeni sürüm geldi (sayılmaz)
    ("ref_id", "TEXT"),                                  # Acceptance ya da SystemCall kimliği
    ("input_sig", "TEXT"),                               # girdilerin kısa özeti (içerik değil)
    ("tokens_total", "REAL NOT NULL DEFAULT 0"),
    ("tokens_input", "REAL NOT NULL DEFAULT 0"),         # önbelleksiz girdi (input − cache_read − cache_write)
    ("tokens_output", "REAL NOT NULL DEFAULT 0"),
    ("tokens_cache_read", "REAL NOT NULL DEFAULT 0"),
    ("tokens_cache_write", "REAL NOT NULL DEFAULT 0"),
    ("cache_known", "INTEGER NOT NULL DEFAULT 0"),       # sağlayıcı önbellek ayrımını bildirdi mi
    ("cost_usd", "REAL"),
    ("cost_basis", "TEXT"),                              # measured | estimated | subscription | local | mixed | unknown
    ("budget_overrun", "INTEGER NOT NULL DEFAULT 0"),    # bitişte tavanı aşan koşu
    ("budget_stop", "INTEGER NOT NULL DEFAULT 0"),       # bütçe yüzünden durdu
    ("unknown_effects", "INTEGER NOT NULL DEFAULT 0"),   # çözülmemiş `unknown` etki sayısı
    ("missing_artifacts", "INTEGER NOT NULL DEFAULT 0"), # kabulde eksik/değişmiş artefakt
)
COLUMN_NAMES = tuple(c for c, _ in COLUMNS)
# NOT NULL DEFAULT sütunlarının varsayılanı: `INSERT OR IGNORE` NOT NULL ihlalini de sessizce yutar; eksik alan
# varsayılana çevrilir ki olay kaybolmasın.
DEFAULTS: dict[str, Any] = {name: (0 if "DEFAULT 0" in decl else 1 if "DEFAULT 1" in decl else "normal")
                            for name, decl in COLUMNS if "NOT NULL DEFAULT" in decl}
FORBIDDEN_FIELDS = ("user_id", "session_id", "acquisition_channel", "experiment_assignments")


def event_id(*parts: Any) -> str:
    """Deterministik olay kimliği: aynı olay aynı kimliği üretir (yinelenen olay tek kayıt)."""
    raw = "\x1f".join("" if p is None else str(p) for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


class MetricsLedger:
    """`metrics.sqlite` üzerinde küçük, iş parçacığı güvenli defter."""

    def __init__(self, path: Path | str):
        self.path = Path(path)
        if str(path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock, self._conn:
            self._conn.execute("PRAGMA journal_mode=WAL")
            cols = ", ".join(f"{name} {decl}" for name, decl in COLUMNS)
            self._conn.execute(f"CREATE TABLE IF NOT EXISTS events ({cols})")
            have = {r[1] for r in self._conn.execute("PRAGMA table_info(events)").fetchall()}
            for name, decl in COLUMNS:  # sonradan eklenen sütunlar (eski defter dosyası)
                if name not in have:
                    self._conn.execute(f"ALTER TABLE events ADD COLUMN {name} {decl}")
            self._conn.execute("CREATE INDEX IF NOT EXISTS ix_events_time ON events(occurred_at)")
            self._conn.execute("CREATE INDEX IF NOT EXISTS ix_events_run ON events(run_id, event_type)")
            self._conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
            self._conn.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', ?)",
                               (str(SCHEMA_VERSION),))

    # ------------------------------------------------------------ olaylar
    def insert(self, events: Iterable[dict[str, Any]]) -> int:
        """Olayları `INSERT OR IGNORE` ile yazar; yeni eklenen satır sayısını döner. Yalnız `COLUMNS` alanları yazılır;
        `FORBIDDEN_FIELDS` ya da başka bir alan gelse bile deftere girmez."""
        rows = [tuple(DEFAULTS.get(c) if e.get(c) is None else e.get(c) for c in COLUMN_NAMES) for e in events]
        if not rows:
            return 0
        marks = ",".join("?" * len(COLUMN_NAMES))
        with self._lock, self._conn:
            before = self._conn.total_changes
            self._conn.executemany(f"INSERT OR IGNORE INTO events ({','.join(COLUMN_NAMES)}) VALUES ({marks})", rows)
            return self._conn.total_changes - before

    def events(self, *, since: float | None = None, types: Iterable[str] | None = None) -> list[dict[str, Any]]:
        clauses, params = [], []  # type: list[str], list[Any]
        if since is not None:
            clauses.append("occurred_at >= ?")
            params.append(float(since))
        tl = list(types or [])
        if tl:
            clauses.append(f"event_type IN ({','.join('?' * len(tl))})")
            params += tl
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        with self._lock:
            rows = self._conn.execute(f"SELECT * FROM events{where} ORDER BY occurred_at ASC, received_at_utc ASC",
                                      params).fetchall()
        return [dict(r) for r in rows]

    def count(self) -> int:
        with self._lock:
            return int(self._conn.execute("SELECT COUNT(*) FROM events").fetchone()[0])

    def purge_before(self, ts: float) -> int:
        """Saklama süresini aşan olayları siler."""
        with self._lock, self._conn:
            return self._conn.execute("DELETE FROM events WHERE occurred_at < ?", (float(ts),)).rowcount

    def clear(self, epoch: float) -> int:
        """Kullanıcı silmesi: tüm olaylar ve filigranlar silinir; `epoch` öncesi graf geçmişi bir daha okunmaz."""
        with self._lock, self._conn:
            n = self._conn.execute("DELETE FROM events").rowcount
            self._conn.execute("DELETE FROM meta WHERE key LIKE 'watermark:%'")
            self._conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('epoch', ?)", (repr(float(epoch)),))
        return n

    # ------------------------------------------------------------ meta
    def get_meta(self, key: str, default: str | None = None) -> str | None:
        with self._lock:
            row = self._conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row[0] if row else default

    def set_meta(self, key: str, value: str) -> None:
        with self._lock, self._conn:
            self._conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", (key, value))

    def epoch(self) -> float:
        try:
            return float(self.get_meta("epoch") or 0.0)
        except ValueError:
            return 0.0

    def export(self) -> dict[str, Any]:
        with self._lock:
            meta = {r[0]: r[1] for r in self._conn.execute("SELECT key, value FROM meta").fetchall()}
        return {"schema_version": SCHEMA_VERSION, "meta": meta, "events": self.events()}

    def close(self) -> None:
        with self._lock:
            self._conn.close()
