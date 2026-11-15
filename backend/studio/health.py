"""Sistem sağlığı (Faz B-1): `GET /api/health/details` + eşik uyarıları.

Tek bakışta: veri dizinindeki her SQLite dosyasının ve WAL'inin boyutu, CDC tüketicisi başına gecikme, olay hızı
(son 1 sa / 24 sa), son hatalar, koşu kuyruğu ve kapı benzeri değişmezler. Her şey yereldir, ağ yok, içerik yok
(hata iletileri `redact_text`'ten geçer ve kısaltılır). Değişmez bozulunca (iyi → kötü geçişinde, bir kez)
`health.alert` olayı yayınlanır; arayüz bunu mevcut bildirim akışına (akış + masaüstü bildirimi) düşürür.

| Uç | Açıklama |
|---|---|
| `GET /api/health/details` | yukarıdaki görünüm (yerel-yalnız; MCP istemcisine 403) |
| `GET /api/events/types` | tek olay türü kaydı (studio/event_types.py) |
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import time
from collections import deque
from pathlib import Path
from typing import TYPE_CHECKING, Any

from studio import event_types

from fastapi import APIRouter, HTTPException, Request  # modül düzeyinde: rota imzası `Request` çözülebilsin

if TYPE_CHECKING:
    from studio.api import Studio

log = logging.getLogger("studio.health")

# Eşikler (değişmez kimliği → sınır). Yalnız gözlem; hiçbir işi durdurmaz.
WAL_WARN_BYTES = 128 * 1024 * 1024   # graf WAL'i 64 MB'ta yeniden başlatılır; iki katı kalıcı sorun demektir
CDC_LAG_WARN = 5000                  # tüketici bu kadar satır gerideyse
DISK_FREE_WARN = 1024 ** 3           # veri diskinde 1 GB'tan az boş yer
ERROR_WINDOW_S = 3600.0
ERRORS_WARN = 20                     # son bir saatte bu kadar hata kaydı
CHECK_S = 60.0                       # arka plan denetim aralığı
DB_SUFFIXES = (".db", ".sqlite", ".sqlite3")


class ErrorRing(logging.Handler):
    """`studio` kaydedicisinin ERROR+ kayıtlarının son N'i (yalnız zaman, kaydedici, kısaltılmış/maskeli ileti)."""

    def __init__(self, size: int = 50):
        super().__init__(level=logging.ERROR)
        self.items: deque[dict[str, Any]] = deque(maxlen=size)

    def emit(self, record: logging.LogRecord) -> None:
        try:
            from studio.changes import redact_text  # noqa: PLC0415
            msg = redact_text(record.getMessage())[:300]
            if record.exc_info and record.exc_info[0] is not None:
                msg = f"{msg} ({record.exc_info[0].__name__})"
            self.items.append({"ts": record.created, "logger": record.name, "level": record.levelname, "message": msg})
        except Exception:  # noqa: BLE001 - kayıt tutucu hiçbir zaman hata atmaz
            pass

    def recent(self, since: float | None = None) -> list[dict[str, Any]]:
        return [e for e in self.items if since is None or e["ts"] >= since]


_RING: ErrorRing | None = None


def error_ring() -> ErrorRing:
    global _RING
    if _RING is None:
        _RING = ErrorRing()
        logging.getLogger("studio").addHandler(_RING)
    return _RING


def _data_dir(studio: Any) -> Path:
    return Path(studio.changes.data_dir)


def databases(data_dir: Path) -> list[dict[str, Any]]:
    out = []
    if not data_dir.is_dir():
        return out
    for p in sorted(data_dir.iterdir()):
        if not p.is_file() or p.suffix.lower() not in DB_SUFFIXES:
            continue
        wal = Path(str(p) + "-wal")
        try:
            size = p.stat().st_size
            wal_size = wal.stat().st_size if wal.is_file() else 0
        except OSError:
            continue
        out.append({"name": p.name, "bytes": size, "wal_bytes": wal_size})
    return out


def _graph_change_counts(store: Any, now: float) -> dict[str, int | None]:
    reader = getattr(store, "_read", None)
    if reader is None:
        return {"last_1h": None, "last_24h": None}
    try:
        with reader() as conn:
            h1 = conn.execute("SELECT COUNT(*) FROM graph_changes WHERE ts >= ?", (now - 3600,)).fetchone()[0]
            h24 = conn.execute("SELECT COUNT(*) FROM graph_changes WHERE ts >= ?", (now - 86400,)).fetchone()[0]
        return {"last_1h": int(h1), "last_24h": int(h24)}
    except Exception:  # noqa: BLE001
        return {"last_1h": None, "last_24h": None}


def _run_queue(studio: Any) -> dict[str, Any]:
    engine = getattr(studio, "engine", None)
    runs = list(getattr(engine, "runs", {}).values()) if engine is not None else []
    by_status: dict[str, int] = {}
    awaiting = 0
    for r in runs:
        by_status[str(r.status)] = by_status.get(str(r.status), 0) + 1
        awaiting += sum(1 for s in getattr(r, "steps", {}).values() if getattr(s, "status", None) == "awaiting")
    slots = {}
    for name, sem in (getattr(engine, "locks", {}) or {}).items():
        waiters = getattr(sem, "_waiters", None)
        slots[name] = {"free": int(getattr(sem, "_value", 0)), "waiting": len(waiters) if waiters else 0}
    return {"live": len(runs), "by_status": by_status, "awaiting_human": awaiting, "slots": slots,
            "queued": sum(v["waiting"] for v in slots.values())}


def _config_changes(studio: Any) -> list[dict[str, Any]]:
    """FAZB2: son yapılandırma değişiklikleri (yalnız dosya, anahtar yolu, aktör, zaman; değer yok)."""
    cc = getattr(studio, "_config_cdc", None)
    try:
        return cc.recent(10) if cc is not None else []
    except Exception:  # noqa: BLE001
        return []


def details(studio: Any, now: float | None = None) -> dict[str, Any]:
    now = time.time() if now is None else now
    data_dir = _data_dir(studio)
    dbs = databases(data_dir)
    runner = getattr(studio, "_cdc", None)
    cdc = runner.status() if runner is not None else []
    bus = studio.bus
    rate = getattr(bus, "rate", None)
    bus_stats = bus.stats()
    unreg = event_types.unregistered()
    ring = error_ring()
    errors = ring.recent()
    errors_1h = [e for e in errors if e["ts"] >= now - ERROR_WINDOW_S]
    try:
        free = shutil.disk_usage(data_dir if data_dir.exists() else Path.cwd()).free
    except OSError:
        free = None
    big_wal = [d["name"] for d in dbs if d["wal_bytes"] >= WAL_WARN_BYTES]
    lagging = [c["consumer"] for c in cdc if c.get("lag") is not None and c["lag"] >= CDC_LAG_WARN]
    ahead = [c["consumer"] for c in cdc if c.get("lag") is not None and c["lag"] < 0]  # başka/geri yüklenmiş veritabanı
    cdc_err = [c["consumer"] for c in cdc if (c.get("last_error_at") or 0) >= now - ERROR_WINDOW_S]
    invariants = [
        {"id": "EVT-REG", "ok": not unreg, "value": sorted(unreg)[:10]},
        {"id": "CDC-LAG", "ok": not lagging and not ahead, "value": lagging + ahead, "limit": CDC_LAG_WARN},
        {"id": "CDC-ERR", "ok": not cdc_err, "value": cdc_err},
        {"id": "WAL-SIZE", "ok": not big_wal, "value": big_wal, "limit": WAL_WARN_BYTES},
        {"id": "BUS-LOSS", "ok": not bus_stats.get("persist_errors") and not bus_stats.get("gapped"),
         "value": {"persist_errors": bus_stats.get("persist_errors", 0), "gapped": bus_stats.get("gapped", 0)}},
        {"id": "DISK-FREE", "ok": free is None or free >= DISK_FREE_WARN, "value": free, "limit": DISK_FREE_WARN},
        {"id": "ERR-RATE", "ok": len(errors_1h) < ERRORS_WARN, "value": len(errors_1h), "limit": ERRORS_WARN},
    ]
    return {
        "at": now,
        "uptime_s": int(now - getattr(studio, "started", now)),
        "databases": dbs,
        "total_bytes": sum(d["bytes"] + d["wal_bytes"] for d in dbs),
        "disk_free_bytes": free,
        "cdc": cdc,
        "events": {"bus_last_1h": rate.count(3600) if rate else None, "bus_last_24h": rate.count(86400) if rate else None,
                   "graph_changes": _graph_change_counts(studio.store, now), "bus": bus_stats,
                   "unregistered": unreg},
        "errors": {"last_1h": len(errors_1h), "recent": list(reversed(errors[-10:]))},
        "runs": _run_queue(studio),
        "config_changes": _config_changes(studio),
        "invariants": invariants,
        "alerts": [i["id"] for i in invariants if not i["ok"]],
    }


class AlertWatch:
    """Değişmez iyi → kötü geçişinde bir kez `health.alert` yayınlar; düzelince `resolved` ile bir kez daha."""

    def __init__(self) -> None:
        self.failing: set[str] = set()

    def apply(self, studio: Any, d: dict[str, Any]) -> list[dict[str, Any]]:
        """`details()` çıktısını işler; geçişlerde olay yayınlar (olay döngüsü iş parçacığından çağrılmalı)."""
        out = []
        for inv in d["invariants"]:
            iid = inv["id"]
            if not inv["ok"] and iid not in self.failing:
                self.failing.add(iid)
                out.append(studio.bus.publish("health.alert", id=iid, state="failing", value=inv.get("value"),
                                              limit=inv.get("limit")))
            elif inv["ok"] and iid in self.failing:
                self.failing.discard(iid)
                out.append(studio.bus.publish("health.alert", id=iid, state="resolved"))
        return out


async def _loop(studio: "Studio") -> None:
    watch: AlertWatch = studio._health_watch  # type: ignore[attr-defined]
    while True:
        await asyncio.sleep(CHECK_S)
        try:
            # ağır kısım (dosya/SQLite) iş parçacığında; yayın olay döngüsünde (publish yalnız döngü iş parçacığından)
            watch.apply(studio, await asyncio.to_thread(details, studio))
        except Exception:  # noqa: BLE001 - sağlık denetimi hiçbir işi bozmaz
            log.warning("sağlık denetimi başarısız", exc_info=True)


async def start(studio: "Studio") -> None:
    error_ring()
    if getattr(studio, "_health_task", None) is not None:
        return
    studio._health_watch = AlertWatch()  # type: ignore[attr-defined]
    studio._health_task = asyncio.create_task(_loop(studio), name="health-watch")  # type: ignore[attr-defined]


async def stop(studio: "Studio") -> None:
    task = getattr(studio, "_health_task", None)
    if task is not None:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        studio._health_task = None  # type: ignore[attr-defined]


def build_router(studio: "Studio") -> APIRouter:
    from studio.clients.tracker import mcp_client  # noqa: PLC0415

    r = APIRouter(prefix="/api", tags=["health"])
    error_ring()

    @r.get("/health/details")
    async def health_details(request: Request) -> dict[str, Any]:
        if mcp_client(request):
            raise HTTPException(403, "Sistem sağlığı yalnız uygulamanın kendi arayüzüne açıktır")
        return await asyncio.to_thread(details, studio)

    @r.get("/events/types")
    def events_types() -> dict[str, Any]:
        return event_types.registry()

    return r


__all__ = ["AlertWatch", "build_router", "details", "error_ring", "start", "stop"]
