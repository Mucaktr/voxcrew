"""Anthropic Messages API beyni (S37 ·) — kullanıcının KENDİ anahtarıyla, akışlı (SSE).

Hesap aracılığı yok: anahtar kullanıcının Anthropic konsolundan gelir, stüdyonun SecretStore'unda maskeli durur, asla
olaylara/loglara yazılmaz. Claude Code CLI yolundan (abonelik) ayrıdır ve ayrı faturalanır.

Uç: `POST {base}/messages` (`x-api-key`, `anthropic-version`), akış olayları `message_start` (giriş jetonu),
`content_block_start/delta/stop` (`text_delta` → text, `thinking_delta` → thought, `input_json_delta` → araç girdisi),
`message_delta` (çıkış jetonu), `error`. Model listesi: `GET {base}/models`.

Araç çağrısı: ortak döngü (`studio.tools.loop`) verilirse `tools` (`input_schema`) gönderilir; yanıttaki
`tool_use` blokları döngüde onaydan geçip çalıştırılır, sonuçlar `tool_result` bloklarıyla (`role: user`) geri gider.
Asistan turu içerik bloklarıyla AYNEN geri gönderilir (düşünme blokları imzasıyla — araç + düşünme birlikteyken API bunu
ister). Tur sınırı döngünündür; son turda araç sunulmaz.
"""

from __future__ import annotations

import copy
import json
from typing import Any, AsyncIterator

import httpx

from studio.changes import redact_text
from studio.connectors.base import CEvent, Invocation, err, ev, http_transient, usage_int

try:  # S27 araç döngüsü yardımcıları
    from studio.tools.loop import anthropic_tool_result_message, parse_arguments
except ImportError:  # pragma: no cover - köprüsüz kurulum
    anthropic_tool_result_message = None  # type: ignore[assignment]

    def parse_arguments(raw: Any) -> dict[str, Any]:  # type: ignore[misc]
        try:
            v = json.loads(raw) if isinstance(raw, str) and raw.strip() else raw
        except json.JSONDecodeError:
            return {}
        return v if isinstance(v, dict) else {}

ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_MAX_TOKENS = 8192

# ---------------------------------------------------------------- açık istem önbelleği (`cache_control`)
# Biçim 2026-10-20'de resmî belgeden doğrulandı (platform.claude.com/docs/en/build-with-claude/prompt-caching):
# `{"type": "ephemeral"}` (5 dk, varsayılan) ya da `{"type": "ephemeral", "ttl": "1h"}`; system/tools/messages içerik
# bloklarına konur; istek başına en çok 4 kırılma; önbellek sırası tools → system → messages; modelin en az önek
# uzunluğunun altında istek önbelleksiz işlenir (hata yok). 1 sa için beta başlığı belgede geçmiyor.
# Kırılmalar: ⟂1 kararlı katmanın sonu (sistem + ≤L2 bölümleri), ⟂2 koşu katmanının sonu (L3), ⟂3 araç döngüsünde
# son kullanıcı turu (tool_result). Ayar: `limits.cache_ttl` = 5m | 1h | off (prompting.cache_ttl).
MAX_BREAKPOINTS = 4


def cache_control(ttl: str | None) -> dict[str, str] | None:
    """`limits.cache_ttl` → blok işareti; "off"/bilinmeyen → None (önbellek işareti konmaz)."""
    if ttl == "1h":
        return {"type": "ephemeral", "ttl": "1h"}
    if ttl == "5m":
        return {"type": "ephemeral"}   # TTL verilmezse 5 dk (belgedeki varsayılan)
    return None


def _segments(prompt: str, layout: Any) -> list[tuple[int, int, int]] | None:
    """`prompt_layout.segments` doğrulaması: 0'dan başlayan, artan, aralarında yalnız "\\n\\n" olan aralıklar."""
    raw = layout.get("segments") if isinstance(layout, dict) else None
    if not isinstance(raw, list) or not raw:
        return None
    out: list[tuple[int, int, int]] = []
    prev = None
    for item in raw:
        try:
            a, b, g = (int(x) for x in item)
        except (TypeError, ValueError):
            return None
        if not 0 <= a < b <= len(prompt):
            return None
        if prev is not None and prompt[prev:a] != "\n\n":
            return None
        out.append((a, b, g))
        prev = b
    return out if out[0][0] == 0 else None


SEP = "\n\n"  # bölüm ayırıcı (prompt_layout)


def build_cached_request(inv: Invocation) -> tuple[Any, Any, int]:
    """(system, ilk kullanıcı içeriği, kırılma sayısı). Düzen yoksa ya da TTL "off" ise düz metinler (eski davranış).
    Blok metinleri "\\n\\n" ile birleşince `inv.prompt` ile aynıdır. yalnız boşluktan oluşan bölüm blok olmaz ve
    işaretlenmez (API reddeder); birleşik bloklar istemin bütün metnini kapsamıyorsa düz isteme düşülür."""
    layout = (inv.extra or {}).get("prompt_layout")
    cc = cache_control(layout.get("cache_ttl")) if isinstance(layout, dict) else None
    segs = _segments(inv.prompt, layout) if cc else None
    if cc is None or segs is None:
        return inv.system or None, inv.prompt, 0
    has_system = bool(inv.system and inv.system.strip())
    system: Any = [{"type": "text", "text": inv.system}] if has_system else None
    content: list[dict[str, Any]] = []
    marks = 0
    tail_from = 0
    for a, b, g in segs:
        if g > 3:   # değişken + görev (L4–L5): önbelleğe yazılmaz, kuyrukta kalır
            break
        tail_from = b
        if not inv.prompt[a:b].strip():
            continue  # boş bölüm blok olmaz, işaret almaz
        content.append({"type": "text", "text": inv.prompt[a:b], "cache_control": dict(cc)})
        marks += 1
    if system and (not content or segs[0][2] > 2):
        # kullanıcı isteminde kararlı bölüm yok: kararlı katman = sistem istemi → ⟂1 sistemin sonunda
        system[-1]["cache_control"] = dict(cc)
        marks += 1
    if marks == 0:
        return inv.system or None, inv.prompt, 0
    tail = inv.prompt[tail_from:]
    if tail.startswith(SEP):
        tail = tail[len(SEP):]
    if tail.strip():
        content.append({"type": "text", "text": tail})
    # kapsama denetimi — atlanan yalnız boşluktur; başka bir fark varsa önbelleksiz düz istem
    if content and SEP.join(c["text"] for c in content).split() != inv.prompt.split():
        return inv.system or None, inv.prompt, 0
    return system, content or inv.prompt, marks


def _with_turn_breakpoint(messages: list[dict[str, Any]], cc: dict[str, str] | None, used: int) -> list[dict[str, Any]]:
    """⟂3: araç döngüsünde son kullanıcı turunun (tool_result) son bloğu. Önceki turların işaretleri birikmez (kopya)."""
    if cc is None or used >= MAX_BREAKPOINTS or len(messages) < 3:
        return messages
    last = messages[-1]
    blocks = last.get("content")
    if last.get("role") != "user" or not isinstance(blocks, list) or not blocks:
        return messages
    marked = {**last, "content": [*blocks[:-1], {**blocks[-1], "cache_control": dict(cc)}]}
    return [*messages[:-1], marked]


def headers(key: str | None) -> dict[str, str]:
    h = {"anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json"}
    if key:
        h["x-api-key"] = key
    return h


async def list_models(base: str, key: str | None, *, transport: Any = None, timeout: float = 4.0) -> tuple[int, list[str]]:
    """(HTTP durum kodu, model kimlikleri). Anahtarsız istek 401 döner (anahtar gerekli)."""
    async with httpx.AsyncClient(timeout=timeout, trust_env=False, transport=transport) as client:
        resp = await client.get(f"{base.rstrip('/')}/models", params={"limit": 100}, headers=headers(key))
    if resp.status_code != 200:
        return resp.status_code, []
    data = resp.json()
    return 200, [str(m.get("id")) for m in (data.get("data") or []) if isinstance(m, dict) and m.get("id")]


class _Blocks:
    """Akıştaki içerik bloklarını indeks sırasıyla toplar: text, thinking (+imza), redacted_thinking, tool_use."""

    def __init__(self) -> None:
        self.blocks: dict[int, dict[str, Any]] = {}

    def start(self, idx: int, block: dict[str, Any]) -> None:
        t = block.get("type")
        if t == "text":
            self.blocks[idx] = {"type": "text", "text": str(block.get("text") or "")}
        elif t == "thinking":
            self.blocks[idx] = {"type": "thinking", "thinking": str(block.get("thinking") or ""),
                                "signature": str(block.get("signature") or "")}
        elif t == "redacted_thinking":
            self.blocks[idx] = {"type": "redacted_thinking", "data": block.get("data")}
        elif t == "tool_use":
            initial = block.get("input")
            self.blocks[idx] = {"type": "tool_use", "id": str(block.get("id") or ""), "name": str(block.get("name") or ""),
                                "_json": "", "input": initial if isinstance(initial, dict) else {}}

    def delta(self, idx: int, d: dict[str, Any]) -> None:
        b = self.blocks.get(idx)
        t = d.get("type")
        if b is None:  # content_block_start gelmeden delta (eski/sahte akış): türünden blok aç
            if t == "text_delta":
                b = self.blocks[idx] = {"type": "text", "text": ""}
            elif t in ("thinking_delta", "signature_delta"):
                b = self.blocks[idx] = {"type": "thinking", "thinking": "", "signature": ""}
            else:
                return
        if t == "text_delta" and b["type"] == "text":
            b["text"] += str(d.get("text") or "")
        elif t == "thinking_delta" and b["type"] == "thinking":
            b["thinking"] += str(d.get("thinking") or "")
        elif t == "signature_delta" and b["type"] == "thinking":
            b["signature"] += str(d.get("signature") or "")
        elif t == "input_json_delta" and b["type"] == "tool_use":
            b["_json"] += str(d.get("partial_json") or "")

    def tool_uses(self) -> list[dict[str, Any]]:
        out = []
        for idx in sorted(self.blocks):
            b = self.blocks[idx]
            if b["type"] == "tool_use" and b["name"]:
                out.append({"id": b["id"] or f"toolu_{idx}", "name": b["name"],
                            "input": parse_arguments(b["_json"]) if b["_json"] else b["input"]})
        return out

    def text(self) -> str:
        return "".join(self.blocks[i]["text"] for i in sorted(self.blocks) if self.blocks[i]["type"] == "text")

    def assistant_content(self) -> list[dict[str, Any]]:
        """Bir sonraki isteğe asistan turu olarak AYNEN dönecek bloklar (boş metin ve imzasız düşünce hariç)."""
        out = []
        uses = {u["id"]: u for u in self.tool_uses()}
        for idx in sorted(self.blocks):
            b = self.blocks[idx]
            if b["type"] == "text" and b["text"]:
                out.append({"type": "text", "text": b["text"]})
            elif b["type"] == "thinking" and b["signature"]:
                out.append({"type": "thinking", "thinking": b["thinking"], "signature": b["signature"]})
            elif b["type"] == "redacted_thinking" and b.get("data"):
                out.append({"type": "redacted_thinking", "data": b["data"]})
            elif b["type"] == "tool_use" and b["name"]:
                u = uses.get(b["id"] or f"toolu_{idx}") or {}
                out.append({"type": "tool_use", "id": u.get("id"), "name": b["name"], "input": u.get("input") or {}})
        return out


async def _round(client: httpx.AsyncClient, base: str, key: str, payload: dict[str, Any],
                 box: dict[str, Any]) -> AsyncIterator[CEvent]:
    blocks = _Blocks()
    box.update(blocks=blocks, status=200, body="", input=0, output=0, failed=False, stop_reason=None)
    async with client.stream("POST", f"{base}/messages", json=payload, headers=headers(key)) as resp:
        if resp.status_code != 200:
            box["status"] = resp.status_code
            box["body"] = (await resp.aread()).decode("utf-8", "replace")
            return
        event = ""
        async for line in resp.aiter_lines():
            line = line.strip()
            if line.startswith("event:"):
                event = line[6:].strip()
                continue
            if not line.startswith("data:"):
                continue
            try:
                obj = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            kind = obj.get("type") or event
            idx = obj.get("index")
            if kind == "message_start":
                u = (obj.get("message") or {}).get("usage") or {}
                # `input` = tüm girdi (önbellek okuma + yazma dahil; geriye uyumlu); önbellek alanları ayrıca (C-5)
                box["cache_read"] = usage_int(u.get("cache_read_input_tokens"))
                box["cache_write"] = usage_int(u.get("cache_creation_input_tokens"))
                box["cache_known"] = "cache_read_input_tokens" in u or "cache_creation_input_tokens" in u
                cc_brk = u.get("cache_creation") if isinstance(u.get("cache_creation"), dict) else {}
                box["cache_write_1h"] = min(usage_int(cc_brk.get("ephemeral_1h_input_tokens")), box["cache_write"])
                box["input"] = usage_int(u.get("input_tokens")) + box["cache_read"] + box["cache_write"]
                box["output"] = usage_int(u.get("output_tokens"))
            elif kind == "content_block_start" and isinstance(idx, int):
                blocks.start(idx, obj.get("content_block") or {})
            elif kind == "content_block_delta":
                d = obj.get("delta") or {}
                blocks.delta(idx if isinstance(idx, int) else -1, d)
                if d.get("type") == "text_delta" and d.get("text"):
                    yield ev("text", text=str(d["text"]))
                elif d.get("type") == "thinking_delta" and d.get("thinking"):
                    yield ev("thought", text=str(d["thinking"]))
            elif kind == "message_delta":
                u = obj.get("usage") or {}
                if u.get("output_tokens") is not None:
                    box["output"] = usage_int(u["output_tokens"])  # kümülatif
                box["stop_reason"] = (obj.get("delta") or {}).get("stop_reason") or box["stop_reason"]
            elif kind == "error":
                e = obj.get("error") or {}
                etype = str(e.get("type") or "")
                box["failed"] = True
                yield err(f"Anthropic: {etype} {str(e.get('message') or '')[:200]}".strip(),
                          transient=etype in ("overloaded_error", "api_error", "rate_limit_error"))
            elif kind == "message_stop":
                break


async def run_messages(ep: dict[str, Any], key: str | None, inv: Invocation, model: str, *,
                       transport: Any = None, loop: Any = None) -> AsyncIterator[CEvent]:
    """Messages akışı; hata olaylarının metni anahtardan ve sır görünümlü jetonlardan arındırılır (denetim B-03:
    sunucu hata gövdesinde anahtarı geri yansıtsa bile koşu olaylarına/SSE'ye/MCP'ye/OTLP'ye düşmez)."""
    async for e in _run_messages(ep, key, inv, model, transport=transport, loop=loop):
        if e.kind == "error" and isinstance(e.data.get("message"), str):
            e.data["message"] = redact_text(e.data["message"], (key,))
        yield e


async def _run_messages(ep: dict[str, Any], key: str | None, inv: Invocation, model: str, *,
                        transport: Any = None, loop: Any = None) -> AsyncIterator[CEvent]:
    base =str(ep.get("base_url") or "").rstrip("/")
    if not key:
        yield err(f"{ep.get('label') or 'Anthropic'}: API anahtarı gerekli (Bağlantılar → Model API'leri)")
        return
    yield ev("meta", model=model, session_id=None)
    if loop is not None:
        async for e in loop.start():
            yield e
        if not loop.offered or anthropic_tool_result_message is None:
            loop = None
    system, first, marks = build_cached_request(inv)
    layout = (inv.extra or {}).get("prompt_layout")
    turn_cc = cache_control(layout.get("cache_ttl")) if marks and isinstance(layout, dict) else None
    messages: list[dict[str, Any]] = [{"role": "user", "content": first}]
    # motor bu adımı bir tur sınırında durdurduysa ve onaylandıysa konuşma kaldığı turdan sürer
    resume = inv.resume if isinstance(inv.resume, dict) and inv.resume.get("api") == "anthropic"         and inv.resume.get("endpoint") == ep.get("id") and inv.resume.get("model") == model else None
    cbox = inv.checkpoint if isinstance(inv.checkpoint, dict) else None
    pending: dict[str, Any] | None = None
    start = 0
    if resume is not None and loop is not None:
        messages = copy.deepcopy(resume.get("messages") or messages)
        if resume.get("system") is not None:
            system = copy.deepcopy(resume["system"])
        pending = resume.get("pending") if isinstance(resume.get("pending"), dict) else None
        start = int(resume.get("rnd") or 0)
        # gerçek devam: defter yalnız kesilen turun bekleyen çağrılarını (kimlik + argüman) yeniden oynatır
        loop.mark_continuation([u for u in (pending or {}).get("uses") or [] if isinstance(u, dict)], rnd=start)
        if cbox is not None:  # bekleyen araçlar yürütülürken durulursa aynı noktadan yeniden sürdürülür
            cbox.clear()
            cbox.update(copy.deepcopy(resume), valid=True)
        yield ev("meta", invocation={"continued": True, "continued_from_round": start + 1})
    elif resume is not None:  # araçlar şimdi açılamadı: konuşma sürdürülemez, adım baştan çalışır (dürüst not)
        yield ev("meta", invocation={"continued": False, "continue_failed": "tools"})
    pin = pout = c_read = c_write = c_write_1h = 0
    seen = failed = cache_known = False
    final_text = ""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(inv.timeout_s, connect=10), trust_env=False,
                                     transport=transport) as client:
            max_rounds = loop.max_rounds if loop is not None else 0
            if pending is not None and loop is not None:
                # durdurulan turun istediği araç çağrıları henüz çalışmamıştı: önce onlar, sonra sıradaki tur
                messages.append({"role": "assistant", "content": pending.get("content") or []})
                results = []
                for k, u in enumerate([x for x in pending.get("uses") or [] if isinstance(x, dict)]):
                    async for e in _run_tool(loop, u["id"], u["name"], u["input"], (start, k)):
                        yield e
                    r = loop.results[u["id"]]
                    results.append((u["id"], r.text, not r.ok))
                messages.append(anthropic_tool_result_message(results))
                loop.end_continuation()  # sonraki her çağrı yeni (kimlik yeniden kullanılsa da)
                start += 1
            for rnd in range(start, max_rounds + 1):
                last = loop is None or rnd >= max_rounds
                if cbox is not None:  # kutu sıradaki model isteğine dek geçerli (araç yürütme sırasında durma)
                    cbox["valid"] = False
                payload: dict[str, Any] = {"model": model, "max_tokens": DEFAULT_MAX_TOKENS, "stream": True,
                                           "messages": _with_turn_breakpoint(messages, turn_cc, marks)}
                if system:
                    payload["system"] = system
                if loop is not None:
                    if last:
                        payload["messages"] = payload["messages"] + [{"role": "user",
                                                                      "content": loop.round_limit_message()}]
                    else:
                        payload["tools"] = loop.anthropic_tools()
                box: dict[str, Any] = {}
                async for e in _round(client, base, key, payload, box):
                    yield e
                if box["status"] != 200:
                    hint = " — anahtar geçersiz ya da eksik" if box["status"] in (401, 403) else ""
                    yield err(f"Sunucu {box['status']}{hint}: {_brief(box['body'])}", transient=http_transient(box["status"]))
                    return
                seen = True
                pin += box["input"]
                pout += box["output"]
                c_read += int(box.get("cache_read") or 0)
                c_write += int(box.get("cache_write") or 0)
                c_write_1h += int(box.get("cache_write_1h") or 0)
                cache_known = cache_known or bool(box.get("cache_known"))
                blocks: _Blocks = box["blocks"]
                uses = blocks.tool_uses()
                if box["failed"]:
                    failed = True
                if loop is None or last or not uses or box["failed"]:
                    final_text = blocks.text()
                    break
                # PROC2-FIX P1: araç turundan ÖNCE şimdiye kadarki kullanım (motor adım tavanını tur arasında uygular).
                # tur sınırı işareti; sıradaki tur bu turun bağlamını (giriş + çıkış) en az bir kez yeniden okur.
                if cbox is not None:  # motor burada durursa konuşma bu noktadan sürdürülebilir
                    cbox.clear()
                    cbox.update(api="anthropic", endpoint=ep.get("id"), model=model, rnd=rnd, valid=True,
                                system=copy.deepcopy(system), messages=copy.deepcopy(messages),
                                pending={"content": copy.deepcopy(blocks.assistant_content()),
                                         "uses": copy.deepcopy(uses)})
                yield ev("usage", input=pin, output=pout, total=pin + pout, partial=True,
                         turn_end=True, next_turn=True,
                         next_min=int(box.get("input") or 0) + int(box.get("output") or 0),
                         **({"cache_read_tokens": c_read, "cache_write_tokens": c_write}
                            if cache_known or c_read or c_write else {}))
                if blocks.text():
                    yield ev("text", text="\n\n")
                messages.append({"role": "assistant", "content": blocks.assistant_content()})
                results = []
                for k, u in enumerate(uses):
                    async for e in _run_tool(loop, u["id"], u["name"], u["input"], (rnd, k)):
                        yield e
                    r = loop.results[u["id"]]
                    results.append((u["id"], r.text, not r.ok))
                messages.append(anthropic_tool_result_message(results))
    except httpx.TimeoutException as exc:
        yield err(f"Sunucu zaman aşımı: {exc}", transient=True)
        failed = True
    except httpx.HTTPError as exc:
        yield err(f"Sunucu bağlantı hatası: {exc}", transient=True)
        failed = True
    if seen and (pin or pout):
        # Önbellek alanları sağlayıcı bildirdiyse (0 da olsa) yazılır: "ölçüldü, isabet yok" ≠ "ölçülmedi".
        # Fiyat: workflow.pricing (okuma/yazma çarpanları; `cache_write_1h_tokens` = yazmanın 1 sa TTL payı).
        cache: dict[str, int] = ({"cache_read_tokens": c_read, "cache_write_tokens": c_write}
                                 if cache_known or c_read or c_write else {})
        if c_write_1h:
            cache["cache_write_1h_tokens"] = c_write_1h
        yield ev("usage", input=pin, output=pout, total=pin + pout, **cache)
    if not failed or final_text:
        yield ev("final", text=final_text.strip())


def _brief(body: str) -> str:
    try:
        obj = json.loads(body)
        e = obj.get("error") if isinstance(obj, dict) else None
        if isinstance(e, dict):
            return f"{e.get('type') or ''} {e.get('message') or ''}".strip()[:200]
    except (ValueError, AttributeError):
        pass
    return body[:200]


def _run_tool(loop, call_id, name, arguments, turn):  # noqa: ANN001,ANN202
    """aracı (tur, sıra) bilgisiyle yürüt; tur bilgisini almayan araç döngüsü (ör. test sahtesi) yine çalışır."""
    if hasattr(loop, "set_turn"):
        loop.set_turn(*turn)
    return loop.execute(call_id, name, arguments)
