"""Graf CDC tüketicileri (Faz B-1): `graph_changes` günlüğünü imleçle okuyan, en az bir kez işleyen tüketici çatısı.

Önceden günlüğü okuyan hiçbir şey yoktu (yalnız `GET /api/graph/changes`); ölçüm defteri grafı filigranla yeniden
tarıyordu. Bu modül:

- **İmleç tablosu** `<veri>/cdc.sqlite` → `cdc_cursors(consumer, last_seen_id, journal_id, …)`: tüketici başına kalıcı
  imleç. Yeni ve ayrı dosya: `studio.db` (tek yazıcı GraphStore) ve mevcut tablolar DEĞİŞMEZ.
- **En az bir kez**: tüketici bir sayfayı (`handle`) işler, ANCAK başarılı olursa imleç ilerler. Arada çökerse sayfa
  yeniden gelir; tüketici idempotent olmalıdır (ölçüm: deterministik olay kimliği + `INSERT OR IGNORE`).
- **Yeniden eşitleme**: imleç yokken (ilk açılış), budanmış tabanın gerisindeyken ya da günlük kimliği değiştiyse
  (`resync_required`: veritabanı geri yüklendi) tüketicinin `rebuild()`'i (eski tam yol) çağrılır ve imleç rebuild'den
  ÖNCE okunan başa konur (arada gelen satırlar yeniden işlenir: en az bir kez).
- **Uyandırma**: `graph.changed` olayı (birleştirilmiş, commit sonrası) + emniyet için her `SAFETY_S` saniyede bir.
- **Gecikme**: `status()` tüketici başına `head - last_seen_id` (Sistem sağlığı sayfası).
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from studio.api import Studio

log = logging.getLogger("studio.cdc_consumers")

PAGE = 500          # tek okumada en çok günlük satırı
DEBOUNCE_S = 1.0    # graph.changed ardından toplu işleme gecikmesi
SAFETY_S = 60.0     # olay kaçsa bile en geç bu aralıkla yoklama

SCHEMA = """
CREATE TABLE IF NOT EXISTS cdc_cursors (
    consumer     TEXT PRIMARY KEY,
    last_seen_id INTEGER NOT NULL,
    journal_id   TEXT,
    updated_at   REAL NOT NULL,
    processed    INTEGER NOT NULL DEFAULT 0,
    resyncs      INTEGER NOT NULL DEFAULT 0,
    errors       INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT,
    last_error_at REAL
);
"""


class Consumer(Protocol):
    name: str

    def handle(self, changes: list[dict[str, Any]]) -> None:
        """Bir sayfa günlük satırı (seq sırasıyla). İdempotent olmalı; hata imleci ilerletmez."""

    def rebuild(self) -> None:
        """İmleç geçersizken tam (eski) yol."""


class CursorStore:
    """Tüketici imleçleri (kendi SQLite dosyası, WAL)."""

    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(self.path), isolation_level=None, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.executescript(SCHEMA)

    def get(self, name: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM cdc_cursors WHERE consumer=?", (name,)).fetchone()
        return dict(row) if row else None

    def all(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute("SELECT * FROM cdc_cursors ORDER BY consumer").fetchall()]

    def advance(self, name: str, last_seen_id: int, journal_id: str | None, *, processed: int = 0,
                resync: bool = False) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO cdc_cursors(consumer, last_seen_id, journal_id, updated_at, processed, resyncs) "
                "VALUES(?,?,?,?,?,?) ON CONFLICT(consumer) DO UPDATE SET last_seen_id=excluded.last_seen_id, "
                "journal_id=excluded.journal_id, updated_at=excluded.updated_at, "
                "processed=processed+excluded.processed, resyncs=resyncs+excluded.resyncs",
                (name, int(last_seen_id), journal_id, time.time(), int(processed), 1 if resync else 0))

    def error(self, name: str, message: str) -> None:
        with self._lock:
            self._conn.execute("UPDATE cdc_cursors SET errors=errors+1, last_error=?, last_error_at=? WHERE consumer=?",
                               (message[:300], time.time(), name))

    def close(self) -> None:
        with self._lock:
            self._conn.close()


class CdcRunner:
    """Kayıtlı tüketicileri günlükten besler. `poll` iş parçacığı güvenli (tüketici başına kilit)."""

    def __init__(self, store: Any, cursors: CursorStore, *, page: int = PAGE):
        self.store = store
        self.cursors = cursors
        self.page = max(1, int(page))
        self.consumers: dict[str, Consumer] = {}
        self._locks: dict[str, threading.Lock] = {}

    def register(self, consumer: Consumer) -> None:
        self.consumers[consumer.name] = consumer
        self._locks.setdefault(consumer.name, threading.Lock())

    def has(self, name: str) -> bool:
        return name in self.consumers

    def _resync(self, name: str, consumer: Consumer, head: int, journal: str | None, *, first: bool = False) -> None:
        consumer.rebuild()
        self.cursors.advance(name, head, journal, resync=not first)  # ilk kurulum "yeniden eşitleme" sayılmaz

    def poll(self, name: str) -> int:
        """Tüketiciyi başa kadar besler; işlenen günlük satırı sayısını döner. Tüketici hatası yukarı çıkar
        (imleç o sayfada kalır)."""
        consumer = self.consumers[name]
        with self._locks[name]:
            cur = self.cursors.get(name)
            if cur is None:  # ilk açılış: tarih tam yoldan, imleç rebuild'den önceki başa
                first = self.store.changes(after=0, limit=1)
                self._resync(name, consumer, int(first["head"]), first.get("journal_id"), first=True)
                return 0
            after, journal, done = int(cur["last_seen_id"]), cur.get("journal_id"), 0
            while True:
                page = self.store.changes(after=after, limit=self.page, journal=journal)
                if page.get("resync_required"):
                    log.info("cdc %s: imleç geçersiz (after=%s floor=%s head=%s) → yeniden eşitleme",
                             name, after, page.get("floor"), page.get("head"))
                    self._resync(name, consumer, int(page["head"]), page.get("journal_id"))
                    return done
                rows = page["changes"]
                if rows:
                    try:
                        consumer.handle(rows)
                    except Exception as exc:
                        self.cursors.error(name, f"{type(exc).__name__}: {exc}")
                        raise
                after, journal = int(page["next"]), page.get("journal_id") or journal
                self.cursors.advance(name, after, journal, processed=len(rows))
                done += len(rows)
                if not page.get("more"):
                    return done

    def poll_all(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for name in list(self.consumers):
            try:
                out[name] = self.poll(name)
            except Exception:  # noqa: BLE001 - bir tüketici diğerlerini durdurmaz; hata imleç kaydında
                log.exception("cdc %s: işlenemedi (imleç ilerlemedi; sonra yeniden)", name)
                out[name] = -1
        return out

    def status(self) -> list[dict[str, Any]]:
        try:
            head = int(self.store.changes(after=0, limit=1)["head"])
        except Exception:  # noqa: BLE001
            head = None
        rows = {r["consumer"]: r for r in self.cursors.all()}
        out = []
        for name in sorted(set(self.consumers) | set(rows)):
            r = rows.get(name) or {}
            last = r.get("last_seen_id")
            out.append({"consumer": name, "registered": name in self.consumers, "last_seen_id": last, "head": head,
                        "lag": (head - int(last) if head is not None and last is not None else None),  # <0: imleç baştan ileride
                        "processed": r.get("processed", 0), "resyncs": r.get("resyncs", 0),
                        "errors": r.get("errors", 0), "last_error": r.get("last_error"),
                        "last_error_at": r.get("last_error_at"), "updated_at": r.get("updated_at")})
        return out


# ------------------------------------------------------------------ yaşam döngüsü
def runner_for(studio: Any) -> CdcRunner:
    runner = getattr(studio, "_cdc", None)
    if runner is None:
        runner = CdcRunner(studio.store, CursorStore(Path(studio.changes.data_dir) / "cdc.sqlite"))
        studio._cdc = runner
    return runner


async def _loop(studio: "Studio", q: Any) -> None:
    runner = runner_for(studio)
    while True:
        try:
            ev = await asyncio.wait_for(q.get(), timeout=SAFETY_S)
            if ev.get("type") != "graph.changed":
                continue
            await asyncio.sleep(DEBOUNCE_S)
            while not q.empty():
                q.get_nowait()
        except asyncio.TimeoutError:
            pass
        await asyncio.to_thread(runner.poll_all)


async def start(studio: "Studio") -> None:
    if getattr(studio, "_cdc_task", None) is not None:
        return
    runner = runner_for(studio)
    await asyncio.to_thread(runner.poll_all)  # açılışta yetiş
    q = studio.bus.subscribe()
    studio._cdc_queue = q  # type: ignore[attr-defined]
    studio._cdc_task = asyncio.create_task(_loop(studio, q), name="cdc-consumers")  # type: ignore[attr-defined]


async def stop(studio: "Studio") -> None:
    task = getattr(studio, "_cdc_task", None)
    if task is not None:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        studio._cdc_task = None  # type: ignore[attr-defined]
    q = getattr(studio, "_cdc_queue", None)
    if q is not None:
        studio.bus.unsubscribe(q)
        studio._cdc_queue = None  # type: ignore[attr-defined]
    runner = getattr(studio, "_cdc", None)
    if runner is not None:
        runner.cursors.close()
        studio._cdc = None


__all__ = ["CdcRunner", "Consumer", "CursorStore", "runner_for", "start", "stop"]
