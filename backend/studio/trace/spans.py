"""OTel biçimli kalıcı span'ler — Faz B §2 (fazb3). EK: mevcut `trace.sqlite`'a yeni `spans` tablosu; eski veri taşınmaz.

Kaynak: `build_trace(content=False)` span ağacı (koşu/adım/araç yollarının zaten yazdığı `run_events` + iz defteri).
Koşu bittiğinde ya da duraklayınca iz tüketicisi (`trace/api.consume`) koşunun span kümesini tek işlemde YENİDEN yazar
(sil + ekle): aynı girdi → aynı satırlar, olay tekrar işlense de çoğalmaz. Yeniden denemeler `s:<adım>:<deneme>`
kimliğiyle kardeş span'dir.

Gizlilik: öznitelikler YALNIZ `ATTRS` tablosundaki alanlardan, tür denetimiyle kurulur (boyut, token, model/araç/ajan
adı, süre, durum). İstem/yanıt gövdesi, araç girdi/çıktısı, onay notu, hata metni ve span başlığı (görevde istemin ilk
satırı) hiç yazılmaz; metin değerleri ayrıca sır maskelemesinden geçer.

Ad sözleşmesi: saklanan anahtarlar `studio.*` (bizim, kalıcı). OTel GenAI semconv hâlâ "Development"; aday `gen_ai.*`
adları yalnız `ATTRS` tablosunun üçüncü sütununda durur ve yalnız OTLP-JSON dışa aktarmada uygulanır. Sözleşme
değişirse tek yer burasıdır; saklanan satırlar yeniden adlandırılmaz.
"""

from __future__ import annotations

import json
from typing import Any, Callable

from .service import scrub, span_hex, trace_id

# (saklanan ad, kaynaktan okuyucu, OTLP dışa aktarımdaki aday GenAI adı ya da None)
_Get = Callable[[dict[str, Any]], Any]


def _a(key: str) -> _Get:
    return lambda sp: (sp.get("attrs") or {}).get(key)


def _tok(key: str) -> _Get:
    return lambda sp: ((sp.get("attrs") or {}).get("tokens") or {}).get(key) \
        if isinstance((sp.get("attrs") or {}).get("tokens"), dict) else None


def _cost(sp: dict[str, Any]) -> Any:
    u = (sp.get("attrs") or {}).get("usage")
    return u.get("cost_usd") if isinstance(u, dict) else None


_OP = {"agent": "invoke_agent", "tool": "execute_tool", "retriever": "retrieve", "guardrail": "approval",
       "span": "workflow", "generation": "chat"}

ATTRS: list[tuple[str, _Get, str | None]] = [
    ("studio.operation", lambda sp: _OP.get(str(sp.get("kind")), "workflow"), "gen_ai.operation.name"),
    ("studio.span.kind", lambda sp: sp.get("kind"), None),
    ("studio.status", lambda sp: sp.get("status"), None),
    ("studio.step.id", lambda sp: sp.get("step"), None),
    ("studio.step.attempt", lambda sp: sp.get("attempt"), None),
    ("studio.agent.name", _a("agent"), "gen_ai.agent.name"),
    ("studio.model", _a("model"), "gen_ai.request.model"),
    ("studio.provider", lambda sp: (sp.get("attrs") or {}).get("connection") or (sp.get("attrs") or {}).get("connector"),
     "gen_ai.provider.name"),
    ("studio.tool.name", _a("tool"), "gen_ai.tool.name"),
    ("studio.tokens.input", _tok("input"), "gen_ai.usage.input_tokens"),
    ("studio.tokens.output", _tok("output"), "gen_ai.usage.output_tokens"),
    ("studio.tokens.total", _tok("total"), None),
    ("studio.cost_usd", _cost, None),
    ("studio.prompt.chars", _a("chars"), None),
    ("studio.prompt.saved_tokens_est", _a("saved_tokens_est"), None),
    ("studio.tool.artifact_size", _a("artifact_size"), None),
    ("studio.error.class", _a("error_class"), "error.type"),
    ("studio.will_retry", _a("will_retry"), None),
    ("studio.approval.approved", _a("approved"), None),
    ("studio.duration_ms", lambda sp: sp.get("duration_ms"), None),
    ("studio.ready_wait_ms", _a("ready_wait_ms"), None),
    ("studio.queue_wait_ms", _a("queue_wait_ms"), None),
    ("studio.lock_wait_ms", _a("lock_wait_ms"), None),
    ("studio.provider_ms", _a("provider_ms"), None),
    ("studio.first_output_ms", _a("first_output_ms"), None),
    ("studio.provider_first_output_ms", _a("provider_first_output_ms"), None),
    ("studio.backoff_ms", _a("backoff_ms"), None),
]
GENAI_NAMES = {k: g for k, _f, g in ATTRS if g}
_STR_KEYS = {"studio.operation", "studio.span.kind", "studio.status", "studio.step.id", "studio.agent.name",
             "studio.model", "studio.provider", "studio.tool.name", "studio.error.class"}
MAX_STR = 120


def _clean(key: str, v: Any) -> Any:
    """Tür denetimi: adlar kısa metin (maskeli), geri kalan her şey sayı/bool. Başka tür → atılır."""
    if v is None:
        return None
    if key in _STR_KEYS:
        return scrub(str(v))[:MAX_STR] if isinstance(v, (str, int)) and not isinstance(v, bool) else None
    if isinstance(v, bool) or (isinstance(v, (int, float)) and v == v):
        return v
    return None


def span_name(sp: dict[str, Any]) -> str:
    """Yapısal ad (başlık asla: görevde istemin ilk satırıdır)."""
    attrs = sp.get("attrs") or {}
    kind = str(sp.get("kind") or "span")
    if sp.get("id") == "run":
        return "run"
    if kind == "agent":
        return f"invoke_agent {_clean('studio.agent.name', attrs.get('agent')) or sp.get('step')}"[:MAX_STR]
    if kind == "tool":
        return f"execute_tool {_clean('studio.tool.name', attrs.get('tool')) or 'tool'}"[:MAX_STR]
    if kind == "guardrail":
        return "approval"
    if kind == "retriever":
        return str(sp.get("name")) if sp.get("name") in ("memory.recall", "memory.consolidate") else "retrieve"
    return "prompt" if sp.get("name") == "prompt" else kind


def otel_status(status: Any) -> str:
    return "OK" if status == "done" else "ERROR" if status in ("failed", "rejected") else "UNSET"


def to_rows(trace: dict[str, Any]) -> list[dict[str, Any]]:
    """`build_trace` çıktısı → OTel biçimli span satırları (yalnız izinli öznitelikler)."""
    run_id = str(trace.get("run_id"))
    tid = trace_id(run_id)
    t0 = float(trace.get("t0") or 0)
    rows = []
    for sp in trace.get("spans") or []:
        attrs = {k: c for k, f, _g in ATTRS if (c := _clean(k, f(sp))) is not None}
        start_ns = int(round((t0 + sp["start_ms"] / 1000.0) * 1e9))
        rows.append({"trace_id": tid, "span_id": span_hex(run_id, sp["id"]),
                     "parent_span_id": span_hex(run_id, sp["parent"]) if sp.get("parent") else None,
                     "name": span_name(sp), "kind": "INTERNAL", "start_ns": start_ns,
                     "end_ns": max(start_ns, int(round((t0 + sp["end_ms"] / 1000.0) * 1e9))),
                     "status": otel_status(sp.get("status")), "attributes": attrs})
    return rows


_SCHEMA = """
CREATE TABLE IF NOT EXISTS spans (
  run_id TEXT NOT NULL, trace_id TEXT NOT NULL, span_id TEXT NOT NULL, parent_span_id TEXT, name TEXT NOT NULL,
  kind TEXT NOT NULL, start_ns INTEGER NOT NULL, end_ns INTEGER NOT NULL, status TEXT NOT NULL,
  attributes TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (trace_id, span_id));
CREATE INDEX IF NOT EXISTS spans_run ON spans(run_id, start_ns);
"""
_COLS = ("trace_id", "span_id", "parent_span_id", "name", "kind", "start_ns", "end_ns", "status")


def ensure_schema(ledger: Any) -> None:
    with ledger._lock, ledger._conn:
        ledger._conn.executescript(_SCHEMA)


def write(ledger: Any, run_id: str, rows: list[dict[str, Any]]) -> int:
    """Koşunun span kümesini tek işlemde yerine koyar (idempotent: tekrar yazım aynı satırları verir)."""
    ensure_schema(ledger)
    with ledger._lock, ledger._conn:
        ledger._conn.execute("DELETE FROM spans WHERE run_id=?", (run_id,))
        ledger._conn.executemany(
            "INSERT INTO spans(run_id, trace_id, span_id, parent_span_id, name, kind, start_ns, end_ns, status, attributes)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)",
            [(run_id, *(r[c] for c in _COLS), json.dumps(r["attributes"], ensure_ascii=False, sort_keys=True))
             for r in rows])
    return len(rows)


def read(ledger: Any, run_id: str) -> list[dict[str, Any]]:
    ensure_schema(ledger)
    with ledger._lock:
        rows = ledger._conn.execute("SELECT * FROM spans WHERE run_id=? ORDER BY start_ns, rowid", (run_id,)).fetchall()
    return [{**{c: r[c] for c in _COLS}, "attributes": json.loads(r["attributes"] or "{}")} for r in rows]


def to_otlp_json(run_id: str, rows: list[dict[str, Any]], *, service: str, version: str) -> dict[str, Any]:
    """Saklanan satırlar → OTLP/JSON (`resourceSpans`); yalnız yerel dosya indirme için, ağ yok."""
    from .otlp import _attrs  # noqa: PLC0415 - aynı değer kodlayıcı

    spans = [{"traceId": r["trace_id"], "spanId": r["span_id"],
              **({"parentSpanId": r["parent_span_id"]} if r["parent_span_id"] else {}),
              "name": r["name"], "kind": 1, "startTimeUnixNano": str(r["start_ns"]), "endTimeUnixNano": str(r["end_ns"]),
              "attributes": _attrs({GENAI_NAMES.get(k, k): v for k, v in r["attributes"].items()}),
              "status": {"code": {"OK": 1, "ERROR": 2}.get(r["status"], 0)}} for r in rows]
    resource = _attrs({"service.name": service, "service.version": version, "studio.run.id": run_id})
    return {"resourceSpans": [{"resource": {"attributes": resource},
                               "scopeSpans": [{"scope": {"name": "studio.spans", "version": version}, "spans": spans}]}]}
