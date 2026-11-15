"""İsteğe bağlı OTLP/HTTP (JSON) dışa aktarma — / P1.

Yalnızca `observability.otlp_url` doluysa ve koşu bittiğinde çalışır (kullanıcının yazdığı adrese; varsayılan boş).
İçerik (istem, araç girdi/çıktısı, onay notu, hatırlanan bellek etiketleri) yalnızca `observability.send_prompts`
açıkken gönderilir; aksi hâlde span'ler yalnızca yapı, süre, durum ve sayılardan oluşur. Öznitelik adları OTel GenAI
anlam kuralları adaylarıyla eşlenir (`gen_ai.*`; semconv henüz "development" — iç adlar bizim).
Hata yutulur ve günlüğe yazılır: dışa aktarma koşuyu ya da stüdyoyu asla etkilemez.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

import httpx

from studio import __version__
from studio.brand import NAME as BRAND_NAME

from .service import scrub, span_hex

log = logging.getLogger("studio.trace")

_KIND_OP = {"agent": "invoke_agent", "tool": "execute_tool", "retriever": "retrieve", "guardrail": "approval",
            "span": "workflow", "generation": "chat"}
# send_prompts kapalıyken gönderilmeyen öznitelikler (build_trace(content=False) zaten çıkarır; ikinci emniyet)
CONTENT_KEYS = {"message", "note", "input", "output", "items", "command", "detail"}


def endpoint(url: str) -> str | None:
    """`http(s)://host[:port]` → `/v1/traces` eklenir; yol verilmişse olduğu gibi. Geçersiz şema → None."""
    raw = (url or "").strip()
    if not raw:
        return None
    p = urlparse(raw)
    if p.scheme not in ("http", "https") or not p.netloc:
        return None
    if p.path in ("", "/"):
        return raw.rstrip("/") + "/v1/traces"
    return raw


def _value(v: Any) -> dict[str, Any] | None:
    if isinstance(v, bool):
        return {"boolValue": v}
    if isinstance(v, int):
        return {"intValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, (list, tuple)):
        vals = [x for x in (_value(i) for i in v) if x is not None]
        return {"arrayValue": {"values": vals}}
    return None


def _scrub(v: Any) -> Any:
    """İkinci emniyet (O-13): dışa giden her metin değeri sır maskelemeden geçer (`build_trace` zaten maskeler)."""
    if isinstance(v, str):
        return scrub(v)
    if isinstance(v, (list, tuple)):
        return [_scrub(i) for i in v]
    return v


def _attrs(d: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for k, v in d.items():
        if v is None:
            continue
        val = _value(v)
        if val is not None:
            out.append({"key": k, "value": val})
    return out


def _span_attrs(sp: dict[str, Any], send_prompts: bool) -> dict[str, Any]:
    a = dict(sp.get("attrs") or {})
    out: dict[str, Any] = {"studio.span.kind": sp.get("kind"), "studio.step.id": sp.get("step"),
                           "studio.step.attempt": sp.get("attempt"),
                           "gen_ai.operation.name": _KIND_OP.get(str(sp.get("kind")), "workflow")}
    if sp.get("kind") == "agent":
        out["gen_ai.agent.name"] = a.get("agent")
        out["gen_ai.request.model"] = a.get("model")
        out["gen_ai.provider.name"] = a.get("connection") or a.get("connector")
        tok = a.get("tokens") if isinstance(a.get("tokens"), dict) else {}
        out["gen_ai.usage.input_tokens"] = tok.get("input")
        out["gen_ai.usage.output_tokens"] = tok.get("output")
        usage = a.get("usage") if isinstance(a.get("usage"), dict) else {}
        out["studio.usage.cost_usd"] = usage.get("cost_usd")
        out["studio.usage.cost_basis"] = usage.get("cost_basis")
        for k in ("ready_wait_ms", "first_output_ms", "error_class", "will_retry", "resumed",
                  # O-10 / O-11: kuyruk bekleme ↔ sağlayıcı süresi ayrımı ve geri çekilme
                  "queue_wait_ms", "lock_wait_ms", "provider_ms", "provider_first_output_ms", "backoff_ms", "resource"):
            out[f"studio.{k}"] = a.get(k)
    elif sp.get("kind") == "tool":
        out["gen_ai.tool.name"] = a.get("tool")
    elif sp.get("name") == "prompt":
        out["studio.prompt.chars"] = a.get("chars")
        out["studio.prompt.boosters"] = a.get("boosters") or None
        out["studio.prompt.skills"] = a.get("skills") or None
        out["studio.prompt.saved_tokens_est"] = a.get("saved_tokens_est")
    elif sp.get("kind") == "guardrail":
        out["studio.approval.kind"] = a.get("approval_kind") or a.get("tool")
        out["studio.approval.approved"] = a.get("approved")
        out["studio.approval.choice"] = a.get("choice")
    if send_prompts:
        for k in sorted(CONTENT_KEYS):
            if k in a and isinstance(a[k], (str, list)):
                out[f"studio.content.{k}"] = _scrub(a[k])
    return out


def to_otlp(trace: dict[str, Any], *, send_prompts: bool = False) -> dict[str, Any]:
    """`build_trace` çıktısı → OTLP/HTTP JSON gövdesi (`resourceSpans`)."""
    run_id = str(trace.get("run_id"))
    tid = str(trace.get("trace_id"))
    t0 = float(trace.get("t0") or 0)
    spans = []
    for sp in trace.get("spans") or []:
        start_ns = int((t0 + sp["start_ms"] / 1000.0) * 1e9)
        end_ns = int((t0 + sp["end_ms"] / 1000.0) * 1e9)
        failed = sp.get("status") in ("failed", "rejected")
        spans.append({
            "traceId": tid, "spanId": sp.get("span_id") or span_hex(run_id, sp["id"]),
            **({"parentSpanId": span_hex(run_id, sp["parent"])} if sp.get("parent") else {}),
            # span adı koşu/adım BAŞLIĞIDIR (görevde istemin ilk satırı): içerik paylaşımı kapalıyken yapısal ad (QA-F56)
            "name": (scrub(str(sp.get("name") or sp["id"])) if send_prompts else f"{sp.get('kind') or 'span'}:{sp['id']}")[:200],
            "kind": 1,
            "startTimeUnixNano": str(start_ns), "endTimeUnixNano": str(max(end_ns, start_ns)),
            "attributes": _attrs({**_span_attrs(sp, send_prompts), "studio.status": sp.get("status")}),
            "events": [{"name": e.get("name"), "timeUnixNano": str(int((t0 + e["offset_ms"] / 1000.0) * 1e9)),
                        "attributes": _attrs({k: _scrub(v) for k, v in (e.get("attrs") or {}).items()
                                              if send_prompts or k not in CONTENT_KEYS | {"reason"}})}
                       for e in sp.get("events") or []],
            "status": {"code": 2 if failed else 1},
        })
    resource = _attrs({"service.name": BRAND_NAME.lower(), "service.version": __version__,
                       "studio.run.id": run_id, "studio.run.status": trace.get("status")})
    return {"resourceSpans": [{"resource": {"attributes": resource},
                               "scopeSpans": [{"scope": {"name": "studio.trace", "version": __version__},
                                               "spans": spans}]}]}


async def export(url: str, payload: dict[str, Any], *, transport: httpx.AsyncBaseTransport | None = None,
                 timeout: float = 5.0) -> dict[str, Any]:
    """OTLP gövdesini gönderir. Sonuç: `{ok, status?, error?, url}` — istisna fırlatmaz."""
    target = endpoint(url)
    if target is None:
        return {"ok": False, "error": "invalid_url", "url": None}
    try:
        async with httpx.AsyncClient(timeout=timeout, transport=transport) as client:
            res = await client.post(target, json=payload, headers={"Content-Type": "application/json"})
        return {"ok": res.status_code < 300, "status": res.status_code, "url": target}
    except Exception as exc:  # noqa: BLE001 - dışa aktarma hatası yutulur
        log.warning("OTLP dışa aktarma başarısız: %s", exc)
        return {"ok": False, "error": type(exc).__name__, "url": target}
