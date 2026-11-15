"""Model API beyni: OpenAI uyumlu sohbet (LM Studio, llama.cpp, vLLM, Jan; Mistral, OpenRouter, Groq, Gemini…
"kendi anahtarınla") ve Anthropic Messages API (S37) — adlandırılmış çoklu uç nokta.

Rota: `Route("openai_compat", "openai_compat", model, provider=<uç nokta kimliği>)`; kimlik yoksa varsayılan uç nokta
(eski tek bağlantı = `default`). `api: anthropic` uç noktası `anthropic_api.run_messages`'a devredilir.
`POST {base}/chat/completions` akışı (SSE `data:` satırları) normalize olaylara çevrilir. Anahtar SecretStore'dan okunur;
asla olaylara/loglara yazılmaz. Kayıt: Studio.connectors["openai_compat"].

Araç çağrısı: ajana MCP sunucusu atanmışsa ve uç nokta araç destekliyorsa (`endpoints.tools_mode`) ortak araç
döngüsü (`studio.tools.loop`, S27) kullanılır: `tools` gönderilir, `delta.tool_calls` birleştirilir, onay motorun
`respond` yolundan geçer (karar yoksa ret), sonuçlar `role: tool` iletileriyle geri döner, tur sınırı döngünündür.
"try" modundaki sunucu araçları reddederse (400/404/422) adım araçsız sürer ve not düşülür. Araç köprüsü kurulu
değilse (eski kurulum) davranış araçsız akışla birebir aynıdır.

Maliyet: yerel uç nokta (localhost) → `usage.cost_usd = 0`; OpenRouter yanıtındaki `usage.cost` → ölçülmüş maliyet;
diğer uzak uç noktalarda yalnızca jeton bildirilir (motor tahmini maliyeti pricing tablosundan hesaplar).
"""

from __future__ import annotations

import copy
import json
import math
from typing import Any, AsyncIterator

import httpx

from studio.changes import redact_text
from studio.connections.endpoints import get_endpoint, is_local_url, preset, secret_name, text as ep_text, tools_mode
from studio.connectors import anthropic_api
from studio.connectors.base import CEvent, Connector, Invocation, err, ev, http_transient, usage_int

try:  # S27 araç döngüsü; yoksa (köprü kurulmamış) araçsız yol
    from studio.tools.loop import (ApprovalDesk, OpenAIToolCallAccumulator, ToolLoop, openai_assistant_message,
                                   openai_tool_message)
except ImportError:  # pragma: no cover - köprüsüz kurulum
    ApprovalDesk = OpenAIToolCallAccumulator = ToolLoop = None  # type: ignore[assignment,misc]
    openai_assistant_message = openai_tool_message = None  # type: ignore[assignment]

SECRET_NAME = "openai_compat.api_key"  # eski tek bağlantının anahtar adı (endpoints.LEGACY_SECRET)
TOOL_REJECT_CODES = (400, 404, 422)


async def list_models(base: str, key: str | None, *, transport: Any = None, timeout: float = 4.0) -> tuple[int, list[str]]:
    """OpenAI uyumlu `GET {base}/models` → (HTTP durum kodu, model kimlikleri)."""
    hdrs = {"Authorization": f"Bearer {key}"} if key else {}
    async with httpx.AsyncClient(timeout=timeout, trust_env=False, transport=transport) as client:
        resp = await client.get(f"{base.rstrip('/')}/models", headers=hdrs)
    if resp.status_code != 200:
        return resp.status_code, []
    data = resp.json()
    items = data.get("data") if isinstance(data, dict) else data
    return 200, [str(m.get("id")) for m in (items or []) if isinstance(m, dict) and m.get("id")]


def scrub_error(e: CEvent, key: str | None) -> CEvent:
    """Hata olayının metnindeki anahtarı ve sır görünümlü jetonları maskeler (denetim B-03): sağlayıcı hata gövdesi
    anahtarı geri yansıtsa bile koşu olaylarına, SSE'ye, MCP'ye ve OTLP'ye açık anahtar düşmez."""
    if e.kind == "error" and isinstance(e.data.get("message"), str):
        e.data["message"] = redact_text(e.data["message"], (key,))
    return e


def tools_rejected_note(ep: dict[str, Any], status: int, lang: str = "tr") -> str:
    return ep_text("tools_rejected", lang, label=ep.get("label") or ep.get("host"), status=status)


class _Desk:
    """Araç köprüsü yokken `respond` çağrısı için boş masa (motor sözleşmesi bozulmasın)."""

    async def respond(self, run_id: str | None, request_id: str | None, choice: str) -> dict[str, Any]:
        return {"ok": False}


class OpenAICompatConnector(Connector):
    kind = "openai_compat"

    def __init__(self, settings: Any, secrets: Any = None, transport: httpx.AsyncBaseTransport | None = None):
        super().__init__(settings)
        self.secrets = secrets
        self.transport = transport
        self.desk = ApprovalDesk() if ApprovalDesk is not None else _Desk()  # onay kimliği → karar (motor respond ile yazar)

    async def respond(self, run_id: str | None, request_id: str | None, choice: str) -> dict[str, Any]:
        """Motorun araç onayı kararını iletme yolu (`Engine._tool_approval` → `connector.respond`)."""
        return await self.desk.respond(run_id, request_id, choice)

    def _key(self, eid: str) -> str | None:
        return self.secrets.get(secret_name(eid)) if self.secrets else None

    def open_tool_loop(self, ep: dict[str, Any], inv: Invocation) -> Any:
        """Araç döngüsü (ajana MCP sunucusu atanmış, uç nokta araç destekli, yapılandırılmış çıktı istenmemiş) ya da None."""
        if ToolLoop is None or tools_mode(ep) == "no" or (inv.extra or {}).get("format"):
            return None
        return ToolLoop.open(self.settings, inv, self.desk)

    async def run(self, inv: Invocation) -> AsyncIterator[CEvent]:
        eid = inv.route.provider or None
        ep = get_endpoint(self.settings, eid)
        if not ep:
            yield err("OpenAI uyumlu sunucu ayarlanmadı (Bağlantılar → OpenAI uyumlu sunucu)" if not eid
                      else f"API bağlantısı bulunamadı: {eid} (Bağlantılar → Model API'leri)")
            return
        model = inv.route.model or ep["model"]
        if not model:
            yield err("Model seçilmedi (sunucunun /models listesinden bir model seç)")
            return
        key = self._key(ep["id"])
        loop = self.open_tool_loop(ep, inv)
        try:
            if ep["api"] == "anthropic":
                async for e in anthropic_api.run_messages(ep, key, inv, model, transport=self.transport, loop=loop):
                    yield scrub_error(e, key)
            else:
                async for e in self._chat(ep, key, inv, model, loop):
                    yield scrub_error(e, key)
        finally:
            if loop is not None:
                await loop.close()  # adım bitti/iptal: stdio MCP sunucuları kapanır

    # ------------------------------------------------------------------ OpenAI uyumlu akış
    def _headers(self, key: str | None) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if key:
            h["Authorization"] = f"Bearer {key}"
        return h

    async def _round(self, client: httpx.AsyncClient, ep: dict[str, Any], key: str | None, payload: dict[str, Any],
                     box: dict[str, Any]) -> AsyncIterator[CEvent]:
        """Tek /chat/completions akışı: metin/düşünce olaylarını verir; içerik, araç çağrıları, kullanım `box`a yazılır.
        HTTP hatası `box["status"]`a yazılır, olayı çağıran verir (araç reddinde araçsız yeniden denemek için)."""
        acc = OpenAIToolCallAccumulator() if OpenAIToolCallAccumulator is not None and payload.get("tools") else None
        box.update(content=[], calls=[], usage=None, status=200, body="", acc=acc)
        async with client.stream("POST", f"{ep['base_url']}/chat/completions", json=payload,
                                 headers=self._headers(key)) as resp:
            if resp.status_code != 200:
                box["status"] = resp.status_code
                box["body"] = (await resp.aread()).decode("utf-8", "replace")
                return
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if isinstance(obj.get("error"), dict):  # akış ortasında sağlayıcı hatası (OpenRouter vb.)
                    e = obj["error"]
                    code = str(e.get("code") or "")
                    yield err(f"Sunucu: {str(e.get('message') or e)[:200]}",
                              transient=http_transient(int(code)) if code.isdigit() else False)
                    box["stream_error"] = True
                    continue
                for ch in obj.get("choices") or []:
                    delta = ch.get("delta") or {}
                    thought = delta.get("reasoning_content") or delta.get("reasoning")
                    if thought and isinstance(thought, str):
                        yield ev("thought", text=thought)
                    if delta.get("content"):
                        box["content"].append(str(delta["content"]))
                        yield ev("text", text=str(delta["content"]))
                    if acc is not None and delta.get("tool_calls"):
                        acc.feed(delta["tool_calls"])
                if obj.get("usage"):
                    box["usage"] = obj["usage"]
        if acc is not None:
            box["calls"] = acc.calls()

    def _payload(self, ep: dict[str, Any], inv: Invocation, model: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
        payload: dict[str, Any] = {"model": model, "stream": True, "messages": messages}
        pre = preset(ep.get("preset"))
        if pre and pre.get("stream_usage"):
            # yalnızca belgesi bu alanı tanıyan sağlayıcılarda (bazıları bilinmeyen alanı 4xx ile reddeder)
            payload["stream_options"] = {"include_usage": True}
        return payload

    def enforcement_hint(self, route: Any) -> str | None:
        """bu uç nokta araç turlarında tur başına kullanım bildirmedi (çalışma anında saptandı) → tavan bu uç
        noktada yalnız adım sonunda denetlenebilir (`step_end`). Bilinmiyorsa None (bağlayıcının varsayılanı)."""
        eid = getattr(route, "provider", None) or "default"
        return "step_end" if eid in self.usage_missing else None

    @property
    def usage_missing(self) -> set[str]:
        """kullanım bildirmeyen uç noktalar — ayarda kalıcı (yeniden başlatmada kaybolmaz)."""
        cur = self.__dict__.get("_usage_missing")
        if cur is None:
            try:
                saved = self.settings.get("connections.openai_compat.usage_missing", []) if self.settings else []
            except Exception:  # noqa: BLE001
                saved = []
            cur = {str(x) for x in saved or [] if isinstance(x, str) and x}
            self.__dict__["_usage_missing"] = cur
        return cur

    def _set_usage_missing(self, eid: str, missing: bool) -> None:
        """saptamayı belleğe ve ayara yazar (yalnız değiştiyse)."""
        cur = self.usage_missing
        if (eid in cur) == missing:
            return
        (cur.add if missing else cur.discard)(eid)
        try:
            if self.settings is not None:
                self.settings.update({"connections": {"openai_compat": {"usage_missing": sorted(cur)}}})
        except Exception as exc:  # noqa: BLE001 - ayar yazılamazsa bellekteki saptama yine geçerli
            import logging  # noqa: PLC0415
            logging.getLogger("studio.connectors.openai_compat").warning("usage_missing yazılamadı: %s", exc)

    async def _chat(self, ep: dict[str, Any], key: str | None, inv: Invocation, model: str,
                    loop: Any) -> AsyncIterator[CEvent]:
        local = is_local_url(ep["base_url"])
        messages: list[dict[str, Any]] = [{"role": "system", "content": inv.system}, {"role": "user", "content": inv.prompt}]
        # motor bu adımı bir tur sınırında durdurduysa ve onaylandıysa konuşma kaldığı yerden sürer
        resume = inv.resume if isinstance(inv.resume, dict) and inv.resume.get("api") == "openai" \
            and inv.resume.get("endpoint") == ep["id"] and inv.resume.get("model") == model else None
        cbox = inv.checkpoint if isinstance(inv.checkpoint, dict) else None
        yield ev("meta", model=model, session_id=None)
        if loop is not None:
            async for e in loop.start():
                yield e
            if not loop.offered:
                loop = None
        pending: dict[str, Any] | None = None
        rnd = 0
        if resume is not None and loop is not None:
            messages = copy.deepcopy(resume.get("messages") or messages)
            pending = resume.get("pending") if isinstance(resume.get("pending"), dict) else None
            rnd = int(resume.get("rnd") or 0)
            # gerçek devam: defter yalnız kesilen turun bekleyen çağrılarını (kimlik + argüman) yeniden oynatır
            loop.mark_continuation([c for c in (pending or {}).get("calls") or [] if isinstance(c, dict)], rnd=rnd)
            if cbox is not None:  # bekleyen araçlar yürütülürken durulursa aynı noktadan yeniden sürdürülür
                cbox.clear()
                cbox.update(copy.deepcopy(resume), valid=True)
            yield ev("meta", invocation={"continued": True, "continued_from_round": rnd + 1})
        elif resume is not None:  # araçlar şimdi açılamadı: konuşma sürdürülemez, adım baştan çalışır (dürüst not)
            yield ev("meta", invocation={"continued": False, "continue_failed": "tools"})
        totals: dict[str, Any] = {"input": 0, "output": 0, "cost": None, "seen": False}
        est = {"input": 0, "output": 0, "rounds": 0}  # kullanım bildirmeyen turların kaba tahmini (≈ karakter/4)
        final_text = ""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(inv.timeout_s, connect=10), trust_env=False,
                                         transport=self.transport) as client:
                max_rounds = loop.max_rounds if loop is not None else 0
                if pending is not None and loop is not None:
                    # durdurulan turun istediği araç çağrıları henüz çalışmamıştı: önce onlar, sonra sıradaki tur
                    calls = [c for c in pending.get("calls") or [] if isinstance(c, dict)]
                    messages.append(openai_assistant_message(str(pending.get("content") or ""), calls))
                    for k, c in enumerate(calls):
                        async for e in _run_tool(loop, c["id"], c["name"], c["arguments"], (rnd, k)):
                            yield e
                        messages.append(openai_tool_message(c["id"], loop.results[c["id"]].text))
                    loop.end_continuation()  # sonraki her çağrı yeni (kimlik yeniden kullanılsa da)
                    rnd += 1
                while True:
                    last = loop is None or rnd >= max_rounds
                    if cbox is not None:
                        # kutu, tur sınırından SONRAKİ model isteği gönderilene dek geçerli kalır. Sınırdaki
                        # araçlar yürütülürken (araç duyurusu, araç onayı, araç turu rezervasyonu) durulursa devam bu
                        # noktadan sürer; yürütülmüş araçları yürütme defteri tekrar etmez.
                        cbox["valid"] = False
                    body = self._payload(ep, inv, model, messages)
                    if loop is not None:
                        if last:
                            body["messages"] = messages + [{"role": "user", "content": loop.round_limit_message()}]
                        else:
                            body["tools"] = loop.openai_tools()
                    box: dict[str, Any] = {}
                    async for e in self._round(client, ep, key, body, box):
                        yield e
                    if box["status"] != 200:
                        # "try" modundaki sunucu araçları reddetti → bu adım araçsız sürer (bir kez), açık not
                        if body.get("tools") and box["status"] in TOOL_REJECT_CODES and tools_mode(ep) == "try":
                            from studio.i18n import agent_lang  # noqa: PLC0415
                            note = tools_rejected_note(ep, box["status"], agent_lang(self.settings))
                            yield ev("meta", invocation={"tools_note": note})
                            yield ev("thought", text=note)
                            loop = None
                            continue
                        hint = " — anahtar geçersiz ya da eksik" if box["status"] in (401, 403) else ""
                        yield err(f"Sunucu {box['status']}{hint}: {box['body'][:200]}", transient=http_transient(box["status"]))
                        return
                    _add_usage(totals, box.get("usage"))
                    content = "".join(box["content"])
                    calls = box.get("calls") or []
                    if not box.get("usage"):
                        # bu tur kullanım bildirmedi → kaba tahmin (gönderilen iletiler + yanıt, ≈ karakter/4).
                        # Tur başına kullanım yoksa tavan tur sınırında uygulanamaz: uç nokta `step_end` olarak işaretlenir
                        est["input"] += _approx_tokens(body.get("messages"))
                        est["output"] += _approx_tokens(content) + _approx_tokens(calls)
                        est["rounds"] += 1
                        self._set_usage_missing(ep.get("id") or "default", True)  # kalıcı
                        if est["rounds"] == 1:
                            yield ev("meta", enforcement="step_end", usage_estimated=True,
                                     invocation={"usage_reported": False})
                    if loop is None or last or not calls or box.get("stream_error"):
                        final_text = content
                        break
                    if box.get("usage"):  # PROC2-FIX P1: araç turundan ÖNCE şimdiye kadarki kullanım (tur arası tavan)
                        lu = box.get("usage") or {}
                        if cbox is not None:  # motor burada durursa konuşma bu noktadan sürdürülebilir
                            cbox.clear()
                            cbox.update(api="openai", endpoint=ep["id"], model=model, rnd=rnd, valid=True,
                                        messages=copy.deepcopy(messages),
                                        pending={"content": content, "calls": copy.deepcopy(calls)})
                        # tur sınırı işareti; sıradaki tur bu turun bağlamını en az bir kez yeniden okur
                        yield ev("usage", input=totals["input"], output=totals["output"],
                                 total=totals["input"] + totals["output"], partial=True, turn_end=True, next_turn=True,
                                 next_min=usage_int(lu.get("prompt_tokens")) + usage_int(lu.get("completion_tokens")))
                    if content:
                        yield ev("text", text="\n\n")
                    messages.append(openai_assistant_message(content, calls))
                    for k, c in enumerate(calls):
                        async for e in _run_tool(loop, c["id"], c["name"], c["arguments"], (rnd, k)):
                            yield e
                        messages.append(openai_tool_message(c["id"], loop.results[c["id"]].text))
                    rnd += 1
        except httpx.TimeoutException as exc:
            yield err(f"Sunucu zaman aşımı: {exc}", transient=True)
        except httpx.HTTPError as exc:
            yield err(f"Sunucu bağlantı hatası: {exc}", transient=True)
        if not est["rounds"] and totals["seen"] and loop is not None:
            # araç döngüsünde her tur kullanım bildirdi → uç nokta artık "bildirmiyor" sayılmaz
            self._set_usage_missing(ep.get("id") or "default", False)
        if est["rounds"]:  # bildirilmeyen turlar tahminle sayılır (0 değil); motor bunu `tahmini` gösterir
            totals["seen"] = True
            totals["input"] += est["input"]
            totals["output"] += est["output"]
        if totals["seen"]:
            pin, pout = totals["input"], totals["output"]
            out: dict[str, Any] = {"input": pin, "output": pout, "total": pin + pout}
            if totals.get("cache_read") is not None:
                out["cache_read_tokens"] = int(totals["cache_read"])  # fiyat: workflow.pricing önbellek çarpanı
            if local:
                out["cost_usd"] = 0.0
            elif totals["cost"] is not None:
                out["cost_usd"] = float(totals["cost"])  # OpenRouter: yanıtta ölçülmüş maliyet
            yield ev("usage", **out)
        yield ev("final", text=final_text.strip())


def _approx_tokens(value: Any) -> int:
    """kullanım bildirmeyen uç noktada kaba jeton tahmini (≈ 4 karakter = 1 jeton; içerik JSON metni)."""
    if not value:
        return 0
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return max(1, math.ceil(len(text) / 4))


def _add_usage(totals: dict[str, Any], usage: dict[str, Any] | None) -> None:
    if not usage:
        return
    totals["seen"] = True
    totals["input"] += usage_int(usage.get("prompt_tokens"))  # sonlu, ≥ 0 # önbellekten okunanlar dahil (OpenAI anlamı)
    totals["output"] += usage_int(usage.get("completion_tokens"))
    # C-5: OpenAI biçimi `prompt_tokens_details.cached_tokens` (sağlayıcı bildiriyorsa; alan adı sağlayıcıya göre
    # değişebilir — yoksa kayıt yok, uydurulmaz)
    details = usage.get("prompt_tokens_details")
    cached = details.get("cached_tokens") if isinstance(details, dict) else None
    if isinstance(cached, (int, float)) and not isinstance(cached, bool):
        totals["cache_read"] = int(totals.get("cache_read") or 0) + usage_int(cached)
    cost = usage.get("cost")
    if isinstance(cost, (int, float)) and not isinstance(cost, bool) and math.isfinite(cost) and cost >= 0:
        totals["cost"] = (totals["cost"] or 0.0) + float(cost)


def _run_tool(loop, call_id, name, arguments, turn):  # noqa: ANN001,ANN202
    """aracı (tur, sıra) bilgisiyle yürüt; tur bilgisini almayan araç döngüsü (ör. test sahtesi) yine çalışır."""
    if hasattr(loop, "set_turn"):
        loop.set_turn(*turn)
    return loop.execute(call_id, name, arguments)
