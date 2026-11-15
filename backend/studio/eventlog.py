"""Kalıcı kritik olay günlüğü ( "SSE replay").

`EventBus` kritik bir olayı (bkz. `events.is_critical`) abonelere teslim etmeden ÖNCE buraya ekler; SSE
`/api/events?since=<seq>` / `Last-Event-ID` ve `GET /api/events/log` kaçan olayları buradan yeniden gönderir.

Depolama kararı — ayrı dosya (`<veri dizini>/events.db`), graf veritabanı (`studio.db`) DEĞİL:
- Graf deposunun yazıcısı `bulk` ile uzun işlemler açar ve commit'i erteler; günlük o işlemin içinde kalsaydı olay
  bulk bitene kadar kalıcı olmaz ve olay döngüsü graf yazıcı kilidini beklerdi.
- Sürekli ekleme + budama (retention) graf veritabanını ve WAL'ını şişirmez; günlük bağımsız silinip sıfırlanabilir,
  şema ontolojiye bağlı değildir.
- `events.persist_critical: false` ya da bellek içi graf (`:memory:`, testler) → bellek içi günlük: süreç içinde
  replay çalışır, yeniden başlatmada istemci `resync_required` alır.

Kalıcılık güvencesi (tam olarak): ekleme otomatik commit'li tek INSERT'tür (WAL, `synchronous=NORMAL`) ve
`append` dönmeden tamamlanır; yayıncı olayı ancak bundan sonra abonelere koyar. Yani teslim edilen her kritik
olay süreç çökmesine karşı kalıcıdır (işletim sistemi önbelleğinde); elektrik kesintisi/OS çökmesinde son WAL
kontrol noktasından sonraki çerçeveler kaybolabilir (SQLite `synchronous=NORMAL` sözleşmesi).

Sıra numarası (`seq`) tüm olay yolu için tektir ve monotondur (kritik olmayan olaylar da numara alır; günlükte
yalnızca kritikler bulunur, yani günlükteki seq'ler artan ama ardışık değildir). Budanan en büyük seq `meta`
tablosunda (`pruned_through`) tutulur: daha eski bir imleç "pencere dışı" sayılır.

Yük sınırı: bir olayın saklanan JSON'u en çok `max_chars` karakterdir; büyük metin alanları (istem, çıktı)
kısaltılır, kimlikler (`run_id`, `step`, `agent`…) korunur ve kayda `"truncated": true` eklenir. Canlı teslim
edilen olay kısaltılmaz; yalnızca yeniden gönderilen kopya kısaltılmış olabilir.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Any

log = logging.getLogger("studio.eventlog")

DEFAULT_RETENTION = 20000
MIN_RETENTION = 10
MAX_EVENT_CHARS = 16 * 1024
# Kısaltmada asla dokunulmayan (kısa, kimlik niteliğindeki) alanlar
KEEP_KEYS = frozenset({"seq", "type", "ts", "run_id", "step", "step_id", "agent", "approval_id", "id", "goal",
                       "goal_id", "schedule_id", "message_id", "status", "kind", "from", "to", "name"})
# Aşamalı kısaltma: (metin üst sınırı, liste üst sınırı)
_SHRINK_PASSES = ((2000, 200), (400, 40), (80, 8))

SCHEMA = """
CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, ts REAL NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
"""


def _dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


def _shrink(value: Any, text_cap: int, list_cap: int) -> Any:
    if isinstance(value, str):
        return value if len(value) <= text_cap else f"{value[:text_cap]}… [+{len(value) - text_cap}]"
    if isinstance(value, dict):
        return {k: (v if k in KEEP_KEYS and (v is None or isinstance(v, (str, int, float, bool))) and
                    (not isinstance(v, str) or len(v) <= 200) else _shrink(v, text_cap, list_cap))
                for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_shrink(v, text_cap, list_cap) for v in value[:list_cap]]
    return value


def cap_event(event: dict[str, Any], max_chars: int = MAX_EVENT_CHARS) -> tuple[str, bool, str]:
    """(saklanacak JSON, kısaltıldı mı, tam JSON). Önce tam hâli serileştirilir (çoğu olay küçüktür; tam JSON
    canlı SSE için yeniden kullanılır)."""
    full = _dumps(event)
    if len(full) <= max_chars:
        return full, False, full
    for text_cap, list_cap in _SHRINK_PASSES:
        raw = _dumps({**_shrink(dict(event), text_cap, list_cap), "truncated": True})
        if len(raw) <= max_chars:
            return raw, True, full
    # son çare: yalnızca kimlik alanları
    keep = {k: v for k, v in event.items()
            if k in KEEP_KEYS and (v is None or isinstance(v, (int, float, bool)) or (isinstance(v, str) and len(v) <= 200))}
    return _dumps({**keep, "truncated": True}), True, full


class EventLog:
    """Yalnızca eklenen SQLite olay günlüğü. Tüm işlemler tek bağlantı + kilitle; okumalar `asyncio.to_thread`
    ile çağrılabilir (kilit kısa tutulur)."""

    def __init__(self, path: str | Path | None = None, *, retention: int = DEFAULT_RETENTION,
                 max_chars: int = MAX_EVENT_CHARS) -> None:
        self.path = Path(path) if path not in (None, ":memory:") else None
        self.persistent = self.path is not None
        self.retention = max(MIN_RETENTION, int(retention or DEFAULT_RETENTION))
        self.max_chars = max(1024, int(max_chars))
        # Budama aralığı: satır sayısı retention + slack'i aşınca retention'a indirilir (ekleme başına maliyet sabit)
        self._slack = max(10, self.retention // 10)
        self._lock = threading.Lock()
        if self.path is not None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(self.path), isolation_level=None, check_same_thread=False)
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.execute("PRAGMA busy_timeout=2000")
            self._conn.execute("PRAGMA secure_delete=ON")  # karartılan olay metni serbest sayfada kalmaz
        else:
            self._conn = sqlite3.connect(":memory:", isolation_level=None, check_same_thread=False)
        self._conn.executescript(SCHEMA)
        row = self._conn.execute("SELECT COUNT(*), COALESCE(MAX(seq), 0) FROM events").fetchone()
        self._count = int(row[0])
        self.last_seq = int(row[1])  # en son kalıcı (teslim edilmiş) kritik olayın seq'i
        self.pruned_through = self._meta("pruned_through")
        self.appended = 0
        self.truncated = 0
        self._closed = False
        if self._count > self.retention:
            self.prune()

    @classmethod
    def open(cls, path: str | Path | None, **kwargs: Any) -> "EventLog":
        """Dosya açılamazsa (bozuk/kilitli) bellek içi günlüğe düşer; uygulama açılışı engellenmez."""
        try:
            return cls(path, **kwargs)
        except (sqlite3.Error, OSError):
            log.exception("olay günlüğü açılamadı (%s); bellek içi günlük kullanılıyor", path)
            return cls(None, **kwargs)

    # ------------------------------------------------------------------ meta
    def _meta(self, key: str) -> int:
        row = self._conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return int(row[0]) if row else 0

    def _set_meta(self, key: str, value: int) -> None:
        self._conn.execute("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                           (key, int(value)))

    @property
    def high_water(self) -> int:
        """Yeniden başlatmada olay yolunun devam edeceği seq: kalıcı son kritik seq ya da kapanışta yazılan tavan."""
        with self._lock:
            return max(self.last_seq, self._meta("high_water"))

    # ------------------------------------------------------------------ yazma
    def append(self, event: dict[str, Any]) -> str:
        """Olayı ekler ve commit eder. Dönüş: olayın TAM JSON'u (canlı SSE önbelleği yeniden kullanır; saklanan
        kopya kısaltılmış olabilir). Hata yükseltir (yayıncı sayar ve olayı kalıcı olmayan olarak teslim eder)."""
        seq = int(event["seq"])
        raw, truncated, full = cap_event(event, self.max_chars)
        with self._lock:
            self._conn.execute("INSERT INTO events(seq, ts, type, data) VALUES(?, ?, ?, ?)",
                               (seq, float(event.get("ts") or 0.0), str(event.get("type") or ""), raw))
            self.last_seq = max(self.last_seq, seq)
            self._count += 1
            self.appended += 1
            if truncated:
                self.truncated += 1
            if self._count > self.retention + self._slack:
                self._prune_locked()
        return full

    def prune(self) -> int:
        with self._lock:
            return self._prune_locked()

    def _prune_locked(self) -> int:
        row = self._conn.execute("SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?",
                                 (self.retention,)).fetchone()
        if row is None:
            return 0
        cut = int(row[0])
        self._conn.execute("BEGIN")
        try:
            n = self._conn.execute("DELETE FROM events WHERE seq<=?", (cut,)).rowcount
            self.pruned_through = max(self.pruned_through, cut)
            self._set_meta("pruned_through", self.pruned_through)
            self._conn.execute("COMMIT")
        except BaseException:
            self._conn.execute("ROLLBACK")
            raise
        self._count = max(0, self._count - max(0, n))
        return n

    # ------------------------------------------------------------------ okuma
    def oldest_seq(self) -> int:
        with self._lock:
            row = self._conn.execute("SELECT MIN(seq) FROM events").fetchone()
        return int(row[0] or 0)

    def count(self) -> int:
        with self._lock:
            return self._count

    def count_after(self, seq: int, cap: int) -> int:
        """seq'ten sonraki olay sayısı, en çok `cap` (sınırlı tarama)."""
        with self._lock:
            row = self._conn.execute("SELECT COUNT(*) FROM (SELECT 1 FROM events WHERE seq>? ORDER BY seq LIMIT ?)",
                                     (int(seq), int(cap))).fetchone()
        return int(row[0])

    def read_after(self, seq: int, limit: int, *, strict: bool = False) -> list[tuple[int, str]] | None:
        """seq'ten sonraki en çok `limit` olay, artan sırayla: [(seq, json)]. `strict`: seq budanmış pencerenin
        içindeyse (aradaki satırlar silinmiş olabilir) None — kontrol ve okuma aynı kilit altında."""
        with self._lock:
            if strict and seq < self.pruned_through:
                return None
            rows = self._conn.execute("SELECT seq, data FROM events WHERE seq>? ORDER BY seq LIMIT ?",
                                      (int(seq), int(limit))).fetchall()
        return [(int(s), d) for s, d in rows]

    def tail(self, limit: int) -> list[tuple[int, str]]:
        """En son `limit` olay, artan sırayla."""
        with self._lock:
            rows = self._conn.execute("SELECT seq, data FROM events ORDER BY seq DESC LIMIT ?", (int(limit),)).fetchall()
        return [(int(s), d) for s, d in reversed(rows)]

    # ------------------------------------------------------------------ yük karartma (unutma)
    def all_rows(self) -> list[tuple[int, str]]:
        """Saklanan tüm olaylar [(seq, json)] (retention ile sınırlı). Unutma planı içerik arar."""
        with self._lock:
            rows = self._conn.execute("SELECT seq, data FROM events ORDER BY seq").fetchall()
        return [(int(s), d) for s, d in rows]

    def rewrite_rows(self, rows: list[tuple[int, str]]) -> int:
        """Olay yükünü yerinde değiştirir (seq ve tür korunur): unutulan içerik karartılır ya da geri alınır."""
        n = 0
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                for seq, data in rows:
                    n += self._conn.execute("UPDATE events SET data=? WHERE seq=?", (data, int(seq))).rowcount
                self._conn.execute("COMMIT")
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
        return n

    def delete_runs(self, run_ids: list[str]) -> int:
        """koşuların olay satırlarını siler (değerlendirme denemesi ölçüldükten sonra `purge_run`)."""
        ids = [str(r) for r in dict.fromkeys(run_ids) if r]
        if not ids:
            return 0
        n = 0
        with self._lock:
            if self._closed:
                return 0
            self._conn.execute("BEGIN")
            try:
                for i in range(0, len(ids), 500):
                    chunk = ids[i:i + 500]
                    marks = ",".join("?" * len(chunk))
                    n += self._conn.execute(
                        "DELETE FROM events WHERE (CASE WHEN json_valid(data) THEN json_extract(data, '$.run_id') "
                        f"END) IN ({marks})", chunk).rowcount
                self._conn.execute("COMMIT")
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
            self._count = max(0, self._count - max(0, n))
        return n

    def marker(self, key: str) -> bool:
        """bu günlük dosyasında `key` işareti var mı (yedekten geri yüklenen günlük işaretsiz gelir)."""
        with self._lock:
            return self._meta(f"marker:{key}") == 1

    def set_marker(self, key: str, on: bool = True) -> None:
        with self._lock:
            if on:
                self._set_meta(f"marker:{key}", 1)
            else:
                self._conn.execute("DELETE FROM meta WHERE key=?", (f"marker:{key}",))

    def info(self) -> dict[str, Any]:
        return {"persistent": self.persistent, "count": self.count(), "oldest": self.oldest_seq(),
                "latest": self.last_seq, "pruned_through": self.pruned_through, "retention": self.retention,
                "appended": self.appended, "truncated": self.truncated}

    # ------------------------------------------------------------------ kapanış
    def scrub_free_space(self) -> bool:
        """unutmadan sonra VACUUM + `wal_checkpoint(TRUNCATE)`; eski olay metni dosyada/WAL'da kalmaz.
        Günlük saklama sınırıyla küçük tutulur, VACUUM kısa sürer."""
        if not self.persistent:
            return False
        with self._lock:
            if self._closed:
                return False
            try:
                self._conn.execute("VACUUM")
            except sqlite3.Error:
                log.exception("olay günlüğü sıkıştırılamadı")
                return False
        return self.wal_truncate()

    def wal_truncate(self) -> bool:
        """`wal_checkpoint(TRUNCATE)`; tamamlanamazsa False (çağıran yeniden dener)."""
        if not self.persistent:
            return True
        with self._lock:
            if self._closed:
                return False
            try:
                row = self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                return bool(row is not None and int(row[0]) == 0)
            except sqlite3.Error:
                return False

    def close(self, high_water: int | None = None) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            try:
                if high_water is not None and high_water > self.last_seq:
                    self._set_meta("high_water", high_water)
                self._conn.close()
            except sqlite3.Error:  # kapanışta yapılacak başka bir şey yok
                log.exception("olay günlüğü kapatılamadı")

    @property
    def closed(self) -> bool:
        return self._closed
