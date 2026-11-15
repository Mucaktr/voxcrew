"""`system_llm` adım türü — gizli sistem koşularının tek LLM adımı (AUDIT 2026-10-19 §2.3-3, kullanıcı kararı 1).

AI kalite denetçisi gibi sistem işleri artık motoru atlamaz: tek `system_llm` adımlı, gizli (`origin` = `system:…`)
bir koşu olarak `engine._launch` üzerinden çalışır. Böylece koşu bütçesi, günlük tavan, iz (trace) ve graf (Run/Step,
USED_MODEL) bedavaya gelir.

Ajan adımından farkları (bilinçli):
- Ajan yoktur: istem hattı (`prompting`: skill, bellek, takdir, booster) UYGULANMAZ. Sistem istemi ve görev metni
  çağıranın verdiği sabit metindir (denetçinin enjeksiyon güvenliği bu sabitliğe dayanır).
- Araç yok, salt okunur, tek tur (`max_turns=1`); onay kartı açılmaz (bütçe aşımında motor durdurur), işe alım yok.
- Geçici hatada adım politikası kadar yeniden dener; `on_fail` kartı açmaz.

Adım tanımı: `StepSpec(type="system_llm", connection=…, model=…, prompt=<görev>)`; koşu girdisi
`inputs["_system_llm"] = {"system": <sistem istemi>, "connector": <bağlayıcı>, "slug": <iz adı>, "name": <ad>}`.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from typing import TYPE_CHECKING, Any

from studio.connectors.base import Invocation, Route
from studio.graph.store import now_iso
from studio.workflow.spec import StepSpec

if TYPE_CHECKING:
    from studio.workflow.engine import Engine, RunState, StepState

TYPE = "system_llm"
INPUT_KEY = "_system_llm"
MAX_ATTEMPTS = 3


def validate_step(spec: StepSpec) -> list[str]:
    errors = []
    if not (spec.connection or "").strip():
        errors.append(f"{spec.id}: system_llm adımı bir bağlantı (connection) ister")
    if not (spec.prompt or "").strip():
        errors.append(f"{spec.id}: system_llm adımının istemi boş")
    return errors


async def run_system_llm(engine: "Engine", run: "RunState", st: "StepState") -> None:
    spec = st.spec
    cfg: dict[str, Any] = dict((run.inputs or {}).get(INPUT_KEY) or {})
    connection = spec.connection or ""
    route = Route(connector=str(cfg.get("connector") or connection), connection=connection, model=spec.model)
    connector = engine.connectors.get(route.connector)
    if connector is None:
        engine._finish_step(run, st, "failed", error=f"Bağlayıcı yok: {route.connector}", cause="connector.missing")
        return
    agent = {"slug": str(cfg.get("slug") or "system"), "name": str(cfg.get("name") or "System"),
             "role": "system", "tools": {}, "memory_enabled": False}
    timeout_s = engine._policy(run, st).timeout_s(float(engine.settings.get("step_timeout_min", 30) or 30))
    for _ in range(MAX_ATTEMPTS):
        st.status, st.started_at, st.error, st.finished_at = "running", now_iso(), None, None
        st.output, st.thought, st.route, st.model = "", "", route.to_dict(), route.model
        st.invocation, st.pending_approval, st.warning = {}, None, None
        st.tools = []
        st.retry_in = None
        engine._begin_attempt(run, st)
        engine._emit(run, "step.started", step=spec.id, agent=None, route=st.route, attempt=st.attempt)
        st.prompt = spec.prompt
        engine._persist_step(run, st, prompt=spec.prompt)
        inv = Invocation(run_id=run.id, step_id=spec.id, agent=agent, system=str(cfg.get("system") or ""),
                         prompt=spec.prompt, route=route, workdir=engine.settings.workdir, timeout_s=timeout_s,
                         max_turns=1, permissions="read", extra={"no_tools": True})
        lock = engine.locks.get(route.resource) or contextlib.nullcontext()
        queued_at = time.monotonic()
        async with lock, engine._round(run, st):  # gizli denetçi koşusu da rezerve eder; tur kapanışı
            await engine._dispatched(run, st, route, queued_at, purpose=TYPE)
            await engine._consume(run, st, connector, inv)
        if st.status == "pending" and st.retry_in is not None:  # geçici hata: politika yeniden deneme planladı
            engine._emit(run, "step.retry_scheduled", step=spec.id, attempt=st.attempt + 1, in_s=st.retry_in,
                         reason=(st.last_error or "")[:300])
            await asyncio.sleep(st.retry_in)
            continue
        break
    if st.status not in ("done", "failed", "cancelled", "skipped"):
        engine._finish_step(run, st, "failed", error=st.last_error or "system_llm adımı tamamlanamadı")


def register(engine: "Engine") -> None:
    async def handler(run: "RunState", st: "StepState") -> None:
        await run_system_llm(engine, run, st)

    engine.register_step_type(TYPE, handler, validate_step)
