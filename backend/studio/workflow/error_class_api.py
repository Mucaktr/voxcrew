"""/api/error-classes — hata taksonomisi sayımları (salt okunur, yalnız sayılar).

| Uç | Sorgu | Yanıt |
|---|---|---|
| `GET /api/error-classes` | `days` (1–90, varsayılan 7) | `{window_days, runs, failed, partial, classified, counts: {sınıf: n}, steps: {sınıf: n}, classes: [{id, label: {tr, en}, runs, steps}]}` |

İçerik (hata metni, çıktı, istem) hiç dönmez; MCP de okuyabilir ve yalnız sayı görür. Gizli sistem/değerlendirme
koşuları sayılmaz. Sınıflar ve etiketler `workflow/error_class.py` içindedir.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Query

from studio.workflow import error_class as ec

if TYPE_CHECKING:
    from studio.api import Studio

SCAN = 2000
SKIP_ORIGINS = ("review:", "eval:", "system:")  # game/first_session.py ile aynı (gizli koşular sayılmaz)


def _ts(value: Any) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def recent_runs(store: Any, since: float) -> list[dict[str, Any]]:
    """Penceredeki görünür koşu düğümleri (başlangıç zamanına göre; gizli/sistem/değerlendirme hariç)."""
    out = []
    for n in store.nodes("Run", limit=SCAN, order="created_at DESC"):
        p = n["props"]
        t = _ts(p.get("started_at")) or _ts(n.get("created_at"))
        if t is None or t < since:
            continue
        if str(p.get("origin") or "").startswith(SKIP_ORIGINS) or p.get("hidden"):
            continue
        out.append(n)
    return out


def aggregate(store: Any, days: int = 7, now: float | None = None) -> dict[str, Any]:
    now = now or time.time()
    runs = recent_runs(store, now - days * 86400.0)
    run_ids = {str(n["props"].get("id")) for n in runs}
    run_cls = [n["props"].get("error_class") for n in runs if n["props"].get("error_class")]
    failed = sum(1 for n in runs if n["props"].get("status") == "failed")
    partial = sum(1 for n in runs if n["props"].get("status") == "done" and n["props"].get("error_class"))
    step_cls: list[Any] = []
    if run_ids:
        for sn in store.nodes("Step", limit=SCAN * 5, order="created_at DESC"):
            sp = sn["props"]
            if sp.get("error_class") and str(sp.get("run_id")) in run_ids:
                step_cls.append(sp["error_class"])
    counts, steps = ec.counts(run_cls), ec.counts(step_cls)
    return {"window_days": days, "runs": len(runs), "failed": failed, "partial": partial,
            "classified": len(run_cls), "counts": counts, "steps": steps,
            "classes": [{"id": c, "label": dict(ec.LABELS[c]), "runs": counts[c], "steps": steps[c]}
                        for c in ec.ERROR_CLASSES]}


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(prefix="/api/error-classes", tags=["error-classes"])

    @r.get("")
    async def error_classes(days: int = Query(7, ge=1, le=90)) -> dict[str, Any]:
        return await asyncio.to_thread(aggregate, studio.store, days)

    return r
