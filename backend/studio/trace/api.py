"""İz (trace) uç noktaları — Ekip S26.

- `GET /api/runs/{id}/trace` — span ağacı + zaman çizelgesi özeti (salt okunur; graf + run_events + iz defteri).
- `GET /api/runs/{id}/spans` — OTel biçimli saklı span'ler (fazb3; `?format=otlp` → yerel OTLP-JSON dosyası).
- `GET /api/trace/status` — OTLP dışa aktarma durumu (adres ayarlı mı, içerik gönderiliyor mu, son sonuç).

Açılışta olay veri yoluna abone olunur: `step.prompt` ve denemenin ilk çıktısı deftere (`trace.sqlite`) yazılır;
`observability.otlp_url` doluysa biten koşu OTLP/HTTP JSON olarak gönderilir (içerik yalnızca `send_prompts` ile).
"""

from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from studio import __version__
from studio.brand import NAME as BRAND_NAME

from . import otlp
from . import spans as span_store
from .service import TraceLedger, TraceRecorder, build_trace

if TYPE_CHECKING:
    from studio.api import Studio

log = logging.getLogger("studio.trace")


def _data_dir(studio: "Studio") -> Path:
    return Path(studio.changes.data_dir)


def get_recorder(studio: "Studio") -> TraceRecorder:
    """Studio başına tek kaydedici (tembel; testlerde yaşam döngüsü olmadan da çalışır)."""
    rec = getattr(studio, "_trace_recorder", None)
    if rec is None:
        rec = TraceRecorder(TraceLedger(_data_dir(studio) / "trace.sqlite"))
        studio._trace_recorder = rec  # type: ignore[attr-defined]
    return rec


def run_trace(studio: "Studio", run_id: str, *, content: bool = True) -> dict[str, Any] | None:
    run = studio.engine.get_run(run_id)
    if run is None:
        return None
    extra = get_recorder(studio).ledger.for_run(run_id)
    return build_trace(run, extra, content=content)


def persist_spans(studio: "Studio", run_id: str) -> int:
    """fazb3 / Faz B §2: koşunun OTel biçimli span'lerini `trace.sqlite:spans`'e yazar (içeriksiz, idempotent)."""
    trace = run_trace(studio, run_id, content=False)
    if trace is None:
        return 0
    return span_store.write(get_recorder(studio).ledger, run_id, span_store.to_rows(trace))


def run_spans(studio: "Studio", run_id: str) -> dict[str, Any] | None:
    """Saklı span'ler; yoksa (eski ya da süren koşu) aynı projeksiyon canlı hesaplanır, yazılmaz."""
    rows = span_store.read(get_recorder(studio).ledger, run_id)
    source = "stored"
    if not rows:
        trace = run_trace(studio, run_id, content=False)
        if trace is None:
            return None
        rows, source = span_store.to_rows(trace), "live"
    return {"run_id": run_id, "trace_id": rows[0]["trace_id"] if rows else None, "source": source, "spans": rows,
            "genai_names": span_store.GENAI_NAMES}


def _otlp_settings(studio: "Studio") -> tuple[str, bool]:
    url = str(studio.settings.get("observability.otlp_url", "") or "").strip()
    return url, bool(studio.settings.get("observability.send_prompts", False))


async def export_run(studio: "Studio", run_id: str, *, transport: Any = None) -> dict[str, Any] | None:
    """Ayar varsa koşunun izini OTLP ile gönderir; ayar yoksa None (hiçbir ağ çağrısı yapılmaz)."""
    url, send_prompts = _otlp_settings(studio)
    if not url:
        return None
    trace = await asyncio.to_thread(run_trace, studio, run_id, content=send_prompts)
    if trace is None:
        return None
    payload = otlp.to_otlp(trace, send_prompts=send_prompts)
    res = await otlp.export(url, payload, transport=transport)
    res = {**res, "run_id": run_id, "spans": len(trace["spans"]), "ts": time.time()}
    await asyncio.to_thread(get_recorder(studio).ledger.set_meta, "last_export", res)
    return res


async def consume(studio: "Studio", q: Any) -> None:
    rec = get_recorder(studio)
    pending: set[asyncio.Task[Any]] = set()
    while True:
        ev = await q.get()
        try:
            t = ev.get("type")
            row = rec.observe(ev)  # bellek içi; yazılacak satır varsa iş parçacığında yazılır
            if row is not None:
                await asyncio.to_thread(rec.ledger.add, *row)
            if t == "run.finished" and ev.get("run_id"):
                await asyncio.to_thread(persist_spans, studio, str(ev["run_id"]))
            elif t == "run.resumed" and ev.get("run_id"):  # sürüyor: saklı küme bayatlar, okuma canlıya döner
                await asyncio.to_thread(span_store.write, rec.ledger, str(ev["run_id"]), [])
            if t == "run.finished" and ev.get("run_id") and _otlp_settings(studio)[0]:
                # ağ çağrısı tüketiciyi bekletmesin (yavaş toplayıcı olay kuyruğunu doldurmasın)
                task = asyncio.create_task(export_run(studio, str(ev["run_id"])))
                pending.add(task)
                task.add_done_callback(pending.discard)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - iz hatası motoru etkilemez
            log.exception("iz olayı işlenemedi")


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api", tags=["trace"])
    S = studio

    @r.get("/runs/{run_id}/trace")
    async def trace(run_id: str) -> dict[str, Any]:
        data = await asyncio.to_thread(run_trace, S, run_id)
        if data is None:
            raise HTTPException(404, "Çalıştırma yok")
        url, send_prompts = _otlp_settings(S)
        data["export"] = {"enabled": bool(url), "send_prompts": send_prompts}
        return data

    @r.get("/runs/{run_id}/spans")
    async def spans(run_id: str, format: str = "json") -> Any:
        data = await asyncio.to_thread(run_spans, S, run_id)
        if data is None:
            raise HTTPException(404, "Çalıştırma yok")
        if format != "otlp":
            return data
        # yalnız yerel dosya indirme (ağ dışa aktarıcısı yok); öznitelikler zaten içeriksiz
        body = span_store.to_otlp_json(run_id, data["spans"], service=BRAND_NAME.lower(), version=__version__)
        safe = "".join(ch for ch in run_id if ch.isalnum() or ch in "-_")[:80] or "run"
        return JSONResponse(body, headers={"Content-Disposition": f'attachment; filename="spans-{safe}.otlp.json"'})

    @r.get("/trace/status")
    async def status() -> dict[str, Any]:
        url, send_prompts = _otlp_settings(S)
        last = await asyncio.to_thread(get_recorder(S).ledger.meta, "last_export", None)
        return {"otlp_enabled": bool(url), "otlp_valid": otlp.endpoint(url) is not None if url else None,
                "send_prompts": send_prompts, "last_export": last}

    return r


async def start(studio: "Studio") -> None:
    """Açılışta: olay aboneliği (istem raporu, ilk çıktı, OTLP dışa aktarma)."""
    if getattr(studio, "_trace_task", None) is not None:
        return
    try:
        await asyncio.to_thread(get_recorder, studio)
    except Exception:  # noqa: BLE001 - iz defteri açılamazsa stüdyo yine açılır
        log.exception("iz defteri açılamadı")
        return
    q = studio.bus.subscribe()
    studio._trace_queue = q  # type: ignore[attr-defined]
    studio._trace_task = asyncio.create_task(consume(studio, q), name="trace-consumer")  # type: ignore[attr-defined]


async def stop(studio: "Studio") -> None:
    """Kapanışta: aboneliği ve defteri kapat."""
    task = getattr(studio, "_trace_task", None)
    if task is not None:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        studio._trace_task = None  # type: ignore[attr-defined]
    q = getattr(studio, "_trace_queue", None)
    if q is not None:
        studio.bus.unsubscribe(q)
        studio._trace_queue = None  # type: ignore[attr-defined]
    rec = getattr(studio, "_trace_recorder", None)
    if rec is not None:
        rec.ledger.close()
        studio._trace_recorder = None  # type: ignore[attr-defined]
