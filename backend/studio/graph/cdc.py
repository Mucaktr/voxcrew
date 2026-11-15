"""Graf değişiklik günlüğü (CDC, ürün sahibi C1) — bağlam, olay birleştirme ve imleç ucu.

Günlüğün kendisi `graph/store.py` içindedir (`graph_changes` tablosu): `GraphStore`'un her düğüm/kenar yazımı aynı SQLite
işleminde bir günlük satırı ekler (içerik YOK: yalnız tuzlu özetler, değişen anahtar adları ve kim/hangi koşu/adım).
Bu modül yalnız yan parçaları taşır (store'u içe aktarmaz; döngü yok):

- **Bağlam** (`contextvars`): yazımı yapan aktör, koşu ve adım. Varsayılan `system`. API katmanında
  `GraphActorMiddleware` (`user` ya da `mcp:<istemci>`), iş akışı motorunda `scoped(...)` süslemesi (`workflow` /
  `agent:<slug>` + run_id/step_id) kurar. asyncio görevleri ve `asyncio.to_thread` bağlamı devralır; çıplak
  `threading.Thread` devralmaz (`system`).
- **`ChangeNotifier`**: commit SONRASI (yazma kilidi altında, herhangi bir iş parçacığından) çağrılır; özetleri birleştirir
  ve olay döngüsünde `WINDOW_S` aralıkla TEK `graph.changed {first_seq, last_seq, commits, rows, nodes, edges}` olayı
  yayınlar (içerik yok; `events.db`'ye yazılmaz — `graph.` kritik önek değildir). Kalıcı imleç kaynağı olay değil
  `GET /api/graph/changes`'tir.
- **`register(r, S)`**: `GET /api/graph/changes?after=<seq>&limit=<n>` (yerel-yalnız; MCP istemcisine 403).
"""

# Not: `from __future__ import annotations` YOK — FastAPI rota imzası (`Request`) yerel içe aktarımla çözülür.
import asyncio
import contextvars
import functools
import logging
import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Awaitable, Callable

if TYPE_CHECKING:
    from fastapi import APIRouter

    from studio.api import Studio

log = logging.getLogger("studio.graph.cdc")

WINDOW_S = 0.25        # graph.changed birleştirme penceresi
PAGE_MAX = 1000        # /api/graph/changes tek sayfada en çok satır
DEFAULT_ACTOR = "system"


@dataclass(frozen=True)
class GraphContext:
    actor: str = DEFAULT_ACTOR
    run_id: str | None = None
    step_id: str | None = None


_CTX: contextvars.ContextVar[GraphContext] = contextvars.ContextVar("graph_cdc_ctx", default=GraphContext())


def current() -> GraphContext:
    return _CTX.get()


def set_context(actor: str | None = None, run_id: str | None = None, step_id: str | None = None) -> contextvars.Token:
    """Bağlamı kurar (çağıran `reset(token)` ile geri alır). Verilmeyen alan YENİ bağlamda boş olur (aktör hariç: korunur)."""
    cur = _CTX.get()
    return _CTX.set(GraphContext(str(actor or cur.actor)[:120], run_id, step_id))


def reset(token: contextvars.Token) -> None:
    _CTX.reset(token)


class context:  # noqa: N801 - `with cdc.context(actor=..., run_id=...)`
    """Eşzamanlı/asenkron kapsam: `with context(actor="x"): ...`."""

    def __init__(self, actor: str | None = None, run_id: str | None = None, step_id: str | None = None):
        self._args = (actor, run_id, step_id)
        self._token: contextvars.Token | None = None

    def __enter__(self) -> GraphContext:
        self._token = set_context(*self._args)
        return _CTX.get()

    def __exit__(self, *_exc: Any) -> None:
        if self._token is not None:
            _CTX.reset(self._token)


def scoped(extract: Callable[..., dict[str, Any]]) -> Callable[[Callable[..., Awaitable[Any]]], Callable[..., Awaitable[Any]]]:
    """Asenkron yöntem süslemesi: `extract(*args)` → {actor, run_id, step_id}; çağrı boyunca bağlam kurulur ve sonunda
    geri alınır (doğrudan `await` edilen çağrılarda çağıranın bağlamı sızmaz). Çıkarım hatası yazımı durdurmaz."""
    def deco(fn: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                token = set_context(**extract(*args, **kwargs))
            except Exception:  # noqa: BLE001 - bağlam yalnız künye; iş akışını asla düşürmez
                log.debug("graf CDC bağlamı çıkarılamadı", exc_info=True)
                return await fn(*args, **kwargs)
            try:
                return await fn(*args, **kwargs)
            finally:
                _CTX.reset(token)
        return wrapper
    return deco


def engine_run_ctx(_engine: Any, run: Any, *_a: Any, **_k: Any) -> dict[str, Any]:
    return {"actor": "workflow", "run_id": str(run.id)}


def engine_step_ctx(_engine: Any, run: Any, st: Any, *_a: Any, **_k: Any) -> dict[str, Any]:
    agent = getattr(st.spec, "agent", None)
    return {"actor": f"agent:{agent}" if agent else "workflow", "run_id": str(run.id), "step_id": str(st.spec.id)}


class GraphActorMiddleware:
    """Saf ASGI: HTTP isteği boyunca graf yazımlarının aktörü — `X-Studio-Client: mcp/<ad>` → `mcp:<ad>`, başlıksız
    (arayüz / yerel kullanıcı) → `user`. Yanıtı değiştirmez."""

    def __init__(self, app: Callable[..., Awaitable[None]]):
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        actor = "user"
        raw = next((v for k, v in scope.get("headers") or () if k == b"x-studio-client"), None)
        if raw:
            from studio.clients.tracker import parse_header  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın
            parsed = parse_header(raw.decode("latin-1"))
            actor = f"{parsed[0]}:{parsed[1]}" if parsed else "client"
        token = _CTX.set(GraphContext(actor))
        try:
            await self.app(scope, receive, send)
        finally:
            _CTX.reset(token)


# ------------------------------------------------------------------------------------------- olay birleştirme
def _empty_counts() -> dict[str, dict[str, int]]:
    return {"nodes": {"insert": 0, "update": 0, "delete": 0}, "edges": {"insert": 0, "update": 0, "delete": 0}}


class ChangeNotifier:
    """`GraphStore.cdc_listener`: commit özetlerini (`{first_seq, last_seq, rows, counts}`) birleştirir ve olay
    döngüsünde tek `graph.changed` yayınlar. `EventBus.publish` yalnız döngü iş parçacığından çağrılabildiği için
    yazıcı iş parçacığı yalnız birleştirir ve `call_soon_threadsafe` ile zamanlar. Döngü yoksa (betik/test) özet
    `flush()` çağrılana dek bekler."""

    def __init__(self, bus: Any, window_s: float = WINDOW_S):
        self.bus = bus
        self.window_s = float(window_s)
        self.loop: asyncio.AbstractEventLoop | None = None
        self._lock = threading.Lock()
        self._pending: dict[str, Any] | None = None
        self._scheduled = False
        self.published = 0

    def bind_loop(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        """Olay döngüsünü bağlar (Studio.startup). Döngüden önce biriken özet varsa yayın zamanlanır."""
        self.loop = loop or asyncio.get_running_loop()
        with self._lock:
            arm = self._pending is not None and not self._scheduled
            self._scheduled = self._scheduled or arm
        if arm:
            self.loop.call_soon_threadsafe(self._arm)

    def __call__(self, summary: dict[str, Any]) -> None:
        with self._lock:
            p = self._pending
            if p is None:
                p = self._pending = {"first_seq": summary["first_seq"], "last_seq": summary["last_seq"],
                                     "commits": 0, "rows": 0, **_empty_counts()}
            p["first_seq"] = min(p["first_seq"], summary["first_seq"])
            p["last_seq"] = max(p["last_seq"], summary["last_seq"])
            p["commits"] += 1
            p["rows"] += int(summary.get("rows") or 0)
            for kind in ("nodes", "edges"):
                for op, n in (summary.get(kind) or {}).items():
                    p[kind][op] = p[kind].get(op, 0) + int(n)
            if self._scheduled:
                return
            loop = self.loop
            if loop is None or loop.is_closed():
                return  # döngü yok: flush() bekler (olay kaybı değil; imleç ucu kalıcı kaynaktır)
            self._scheduled = True
        try:
            loop.call_soon_threadsafe(self._arm)
        except RuntimeError:  # döngü kapandı
            with self._lock:
                self._scheduled = False

    def _arm(self) -> None:
        assert self.loop is not None
        self.loop.call_later(self.window_s, self.flush)

    def flush(self) -> dict[str, Any] | None:
        """Bekleyen özeti yayınlar (olay döngüsünden ya da döngüsüz testten). Dönüş: yayınlanan yük."""
        with self._lock:
            payload, self._pending, self._scheduled = self._pending, None, False
        if payload is None:
            return None
        try:
            self.bus.publish("graph.changed", **payload)
            self.published += 1
        except Exception:  # noqa: BLE001 - bildirim yan etkidir; imleç ucu kalıcı kaynaktır
            log.exception("graph.changed yayınlanamadı")
        return payload


# ------------------------------------------------------------------------------------------- bağlama + uç
def attach(S: "Studio") -> ChangeNotifier:
    """Studio kurulurken: bildirimciyi depoya bağlar, saklama ayarlarını uygular (idempotent)."""
    store = S.store
    cur = getattr(store, "cdc_listener", None)
    if isinstance(cur, ChangeNotifier):
        return cur
    notifier = ChangeNotifier(S.bus)
    store.cdc_listener = notifier
    try:
        rows = S.settings.get("graph.cdc.max_rows", None)
        days = S.settings.get("graph.cdc.max_age_days", None)
        store.set_cdc_retention(max_rows=int(rows) if rows else None, max_age_days=float(days) if days else None)
    except (TypeError, ValueError):
        log.warning("graph.cdc saklama ayarı geçersiz; varsayılanlar kullanılıyor")
    return notifier


def register(r: "APIRouter", S: "Studio") -> None:
    from fastapi import HTTPException, Query, Request  # noqa: PLC0415

    from studio.clients.tracker import mcp_client  # noqa: PLC0415

    attach(S)

    @r.get("/graph/changes")
    def graph_changes(request: Request, after: int = Query(0, ge=0), limit: int = Query(500, ge=1, le=PAGE_MAX),
                      journal: str | None = Query(None, max_length=64)) -> dict[str, Any]:
        """Kalıcı imleç: `after` sonrası günlük satırları (içerik yok). `resync_required` → imleç saklama penceresinden
        eski ya da günlük başka bir veritabanına ait: istemci `GET /api/graph` anlık görüntüsünü alıp `head`'den sürer."""
        if mcp_client(request):
            raise HTTPException(403, "Graf değişiklik günlüğü yalnız uygulamanın kendi istemcilerine açıktır")
        return S.store.changes(after=after, limit=limit, journal=journal)
