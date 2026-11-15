"""Ollama: model kataloğu ve doğrudan (Hermes'siz) sohbet akışı.

Araç döngüsü (Faz 6, S27 —): model `tools` yeteneğine sahipse ve ajana MCP sunucusu atanmışsa
(`Agent.tools.mcp`), izinli MCP araçları Ollama `tools` alanıyla sunulur; model araç çağırdıkça çağrılar köprüden
(`studio.tools.bridge`) yürütülür, en çok `tools.max_rounds` tur. Her çağrı motorun mevcut araç onayı yolundan geçer:
bağlayıcı `approval` olayı verir, motor kullanıcı kararını bekler ve `respond(run_id, request_id, choice)` ile buraya
iletir (motor değişikliği gerekmez). Karar gelmezse (ör. motor dışı tüketici) çağrı reddedilir — kendiliğinden onay yok.
Araç çağrıları diğer bağlayıcılarla aynı `tool` / `tool_result` olaylarıyla iz ve koşu görünümüne düşer.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, AsyncIterator

import httpx

from studio.connectors.base import CEvent, Connector, Invocation, ev, http_transient, usage_int
from studio.tools.loop import ApprovalDesk, ToolLoop, ollama_tool_message

HERMES_MIN_CTX = 64_000
DEFAULT_NUM_CTX = 8192
DEFAULT_KEEP_ALIVE = "30m"
MIN_NUM_CTX = 2048


def _num_ctx(parameters: str | None) -> int | None:
    m = re.search(r"^num_ctx\s+(\d+)", parameters or "", re.M)
    return int(m.group(1)) if m else None


# ------------------------------------------------------------------ model başına sabit num_ctx (AUDIT C-2)
# Aynı modele farklı `num_ctx` gönderilirse Ollama modeli yeniden yükler (KV önbelleği boşa gider).
# Bu yüzden num_ctx model başına BİR kez seçilir ve her Ollama çağıranı (ajan adımı, araç döngüsü, denetçi koşusu,
# bellek çıkarımı) aynı değeri ve aynı `keep_alive`ı gönderir. İstemin boyuna göre adım adım değişmez.
_FIXED_CTX: dict[tuple[str, str, int], int] = {}


def base_num_ctx(settings: Any) -> int:
    try:
        return int((settings.get("ollama", {}) or {}).get("num_ctx") or DEFAULT_NUM_CTX)
    except (TypeError, ValueError, AttributeError):
        return DEFAULT_NUM_CTX


def keep_alive(settings: Any) -> str:
    """Tüm Ollama çağıranlarının ortak `keep_alive` değeri (ayar `ollama.keep_alive`; varsayılan 30m)."""
    try:
        return str((settings.get("ollama", {}) or {}).get("keep_alive") or DEFAULT_KEEP_ALIVE)
    except AttributeError:
        return DEFAULT_KEEP_ALIVE


def show_context(info: dict[str, Any] | None) -> tuple[int | None, int | None]:
    """/api/show yanıtından (Modelfile `num_ctx`, modelin en büyük bağlamı)."""
    info = info or {}
    cmax = None
    for k, v in (info.get("model_info") or {}).items():
        if str(k).endswith(".context_length") and isinstance(v, (int, float)) and not isinstance(v, bool):
            cmax = int(v)
            break
    return _num_ctx(info.get("parameters")), cmax


def choose_num_ctx(settings: Any, modelfile_ctx: int | None = None, context_max: int | None = None) -> int:
    """Kural: ayar (`ollama.num_ctx`, varsayılan 8192) ile modelin uzun bağlam ayarı (Modelfile `num_ctx`, ör. Hermes
    için oluşturulan 64K kopya) arasından büyüğü; modelin en büyük bağlamıyla sınırlı; en az 2048."""
    n = max(base_num_ctx(settings), int(modelfile_ctx or 0))
    if context_max:
        n = min(n, int(context_max))
    return max(MIN_NUM_CTX, n)


def cached_num_ctx(settings: Any, url: str, model: str) -> int | None:
    return _FIXED_CTX.get((str(url).rstrip("/"), model, base_num_ctx(settings)))


def fixed_num_ctx(settings: Any, url: str, model: str, info: dict[str, Any] | None = None) -> int:
    """Model başına sabit num_ctx: ilk kez model bilgisinden seçilir, sonra hep aynı değer döner (ayar değişirse
    yeniden seçilir)."""
    key = (str(url).rstrip("/"), model, base_num_ctx(settings))
    if key not in _FIXED_CTX:
        value = choose_num_ctx(settings, *show_context(info))
        if not info or info.get("error"):  # /api/show başarısız → yedek değer önbelleğe yazılmaz (sonraki çağrı yeniden sorar)
            return value
        _FIXED_CTX[key] = value
    return _FIXED_CTX[key]


async def resolve_num_ctx(settings: Any, url: str, model: str, client: Any) -> int:
    """Önbellekte yoksa /api/show ile bir kez seçer (çıkarım gibi bağlayıcı dışı çağıranlar için)."""
    hit = cached_num_ctx(settings, url, model)
    if hit is not None:
        return hit
    info: dict[str, Any] = {}
    try:
        info = (await client.post(f"{str(url).rstrip('/')}/api/show", json={"model": model})).json() or {}
    except (httpx.HTTPError, ValueError):
        info = {}
    return fixed_num_ctx(settings, url, model, info if isinstance(info, dict) else {})


async def list_models(url: str) -> list[dict[str, Any]]:
    url = url.rstrip("/")
    async with httpx.AsyncClient(timeout=10) as client:
        tags = (await client.get(f"{url}/api/tags")).json().get("models", [])

        async def show(name: str) -> dict[str, Any]:
            try:
                return (await client.post(f"{url}/api/show", json={"model": name})).json()
            except (httpx.HTTPError, ValueError):
                return {}

        shows = await asyncio.gather(*(show(m["name"]) for m in tags))
    # "yerel" = bu bilgisayar. Uzak bir Ollama sunucusundaki her model (bulut olmasa da) yerel/ücretsiz sayılmaz:
    # istemler bu bilgisayardan çıkar, local_only politikası onu reddeder.
    from studio.connections.endpoints import is_local_url  # noqa: PLC0415
    from studio.connections.policy import ollama_remote_host  # noqa: PLC0415

    host_local = is_local_url(url)
    models = []
    for tag, info in zip(tags, shows):
        d = tag.get("details") or {}
        name = tag["name"]
        cloud = bool(tag.get("remote_host") or tag.get("remote_model")) or name.endswith(("-cloud", ":cloud"))
        remote = cloud or not host_local
        num_ctx = _num_ctx(info.get("parameters"))
        caps = tag.get("capabilities") or info.get("capabilities") or []
        models.append({
            "name": name,
            "family": d.get("family"),
            "parameter_size": d.get("parameter_size"),
            "quantization": d.get("quantization_level"),
            "size_bytes": tag.get("size"),
            "digest": tag.get("digest"),  # eval koşularında kesin model sürümü
            "context_max": d.get("context_length"),
            "num_ctx": num_ctx,
            "capabilities": caps,
            "local": not remote,
            "free": not remote,
            "cloud": cloud,
            "host": "" if host_local else ollama_remote_host(url),  # uzak Ollama sunucusu (etiket, onay anahtarı)
            "hermes_ready": bool(num_ctx and num_ctx >= HERMES_MIN_CTX) and "tools" in caps,
            "modified_at": tag.get("modified_at"),
        })
    models.sort(key=lambda m: (not m["hermes_ready"], m["name"]))
    return models


class OllamaConnector(Connector):
    kind = "ollama"

    def __init__(self, settings: Any, transport: httpx.AsyncBaseTransport | None = None):
        super().__init__(settings)
        self.transport = transport              # testlerde httpx.MockTransport
        self.desk = ApprovalDesk()              # onay kimliği → kullanıcı kararı (motor respond ile yazar)

    def _client(self, timeout: Any) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=timeout, transport=self.transport)

    async def respond(self, run_id: str | None, request_id: str | None, choice: str) -> dict[str, Any]:
        """Motorun araç onayı kararını iletme yolu (`Engine._tool_approval` → `connector.respond`)."""
        return await self.desk.respond(run_id, request_id, choice)

    async def run(self, inv: Invocation) -> AsyncIterator[CEvent]:
        url = self.settings.get("ollama_url").rstrip("/")
        model = inv.route.model
        if not model:
            yield ev("error", message="Ollama modeli seçilmedi")
            return
        opts = self.settings.get("ollama", {})
        payload: dict[str, Any] = {
            "model": model,
            "messages": [{"role": "system", "content": inv.system}, {"role": "user", "content": inv.prompt}],
            "stream": True,
            "options": {"num_ctx": base_num_ctx(self.settings), "temperature": float(opts.get("temperature", 0.4))},
        }
        # Booster'lar (istem hattı ctx.extra): keep_alive, think, yapılandırılmış çıktı. `num_ctx` istem başına
        # DEĞİŞMEZ (C-2): model başına sabit değer (`fixed_num_ctx`); extra'daki num_ctx yalnız bilgi amaçlıdır.
        x = dict((inv.extra or {}).get("ollama") or {})
        payload["keep_alive"] = x["keep_alive"] if x.get("keep_alive") is not None else keep_alive(self.settings)
        if (inv.extra or {}).get("format"):
            payload["format"] = inv.extra["format"]
        info = await self._show(url, model)
        caps = info.get("capabilities", []) if isinstance(info, dict) else []
        payload["options"]["num_ctx"] = fixed_num_ctx(self.settings, url, model, info if isinstance(info, dict) else {})
        if "thinking" in caps:
            payload["think"] = bool(x["think"]) if "think" in x else bool(opts.get("think", False))
        yield ev("meta", model=model, session_id=None)

        # Yapılandırılmış çıktı (plan şeması vb.) istenen çağrılarda araç sunulmaz.
        loop = ToolLoop.open(self.settings, inv, self.desk) if "tools" in caps and not payload.get("format") else None
        if loop is None:
            async for e in self._plain(url, payload, inv):
                yield e
            return
        try:
            async for e in self._tool_loop(url, payload, inv, loop):
                yield e
        finally:
            await loop.close()  # adım bitti/iptal: stdio sunucuları öldürülür

    # ------------------------------------------------------------------ tek tur akış
    async def _round(self, client: httpx.AsyncClient, url: str, payload: dict[str, Any],
                     box: dict[str, Any]) -> AsyncIterator[CEvent]:
        """Bir /api/chat akışı: düşünce/metin olaylarını verir; içerik, araç çağrıları ve kullanım `box`a yazılır."""
        box.update(content=[], tool_calls=[], pin=None, pout=None, error=False, done=False)
        async with client.stream("POST", f"{url}/api/chat", json=payload) as resp:
            if resp.status_code != 200:
                body = (await resp.aread()).decode("utf-8", "replace")
                box["error"] = True
                yield ev("error", message=f"Ollama {resp.status_code}: {body[:300]}",
                         transient=http_transient(resp.status_code))
                return
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if obj.get("error"):
                    box["error"] = True
                    yield ev("error", message=str(obj["error"]))
                    break
                msg = obj.get("message") or {}
                if msg.get("thinking"):
                    yield ev("thought", text=msg["thinking"])
                if msg.get("content"):
                    box["content"].append(msg["content"])
                    yield ev("text", text=msg["content"])
                for call in msg.get("tool_calls") or []:
                    if isinstance(call, dict):
                        box["tool_calls"].append(call)
                if obj.get("done"):
                    box["pin"], box["pout"] = (None if obj.get(k) is None else usage_int(obj.get(k))
                                              for k in ("prompt_eval_count", "eval_count"))
                    box["done"] = True

    async def _plain(self, url: str, payload: dict[str, Any], inv: Invocation) -> AsyncIterator[CEvent]:
        """Araçsız tek tur (önceki davranış birebir)."""
        box: dict[str, Any] = {}
        try:
            async with self._client(httpx.Timeout(inv.timeout_s, connect=10)) as client:
                async for e in self._round(client, url, payload, box):
                    yield e
                if box.get("done"):
                    pin, pout = box["pin"], box["pout"]
                    yield ev("usage", input=pin, output=pout, total=(pin or 0) + (pout or 0))
        except httpx.HTTPError as exc:
            yield ev("error", message=f"Ollama bağlantı hatası: {exc}", transient=True)
        yield ev("final", text="".join(box.get("content") or []).strip())

    # ------------------------------------------------------------------ araç döngüsü
    async def _tool_loop(self, url: str, payload: dict[str, Any], inv: Invocation, loop: ToolLoop) -> AsyncIterator[CEvent]:
        """Ollama'ya özgü kısım (istek gövdesi, ileti biçimi); onay/çağrı/guard `studio.tools.loop`ta ortaktır."""
        async for e in loop.start():
            yield e
        if not loop.offered:
            async for e in self._plain(url, payload, inv):
                yield e
            return
        max_rounds = loop.max_rounds
        messages: list[dict[str, Any]] = list(payload["messages"])
        pin_total = pout_total = 0
        final_text = ""
        try:
            async with self._client(httpx.Timeout(inv.timeout_s, connect=10)) as client:
                for rnd in range(max_rounds + 1):
                    last = rnd == max_rounds
                    body = {**payload, "messages": messages}
                    if last:
                        body["messages"] = messages + [{"role": "user", "content": loop.round_limit_message()}]
                    else:
                        body["tools"] = loop.ollama_tools()  # artefakt sonrası okuma aracı eklenir
                    box: dict[str, Any] = {}
                    async for e in self._round(client, url, body, box):
                        yield e
                    pin_total += int(box.get("pin") or 0)
                    pout_total += int(box.get("pout") or 0)
                    if box.get("done"):
                        yield ev("usage", input=pin_total, output=pout_total, total=pin_total + pout_total)
                    content = "".join(box.get("content") or [])
                    calls = box.get("tool_calls") or []
                    if box.get("error") or last or not calls:
                        final_text = content
                        break
                    if content:
                        yield ev("text", text="\n\n")
                    messages.append({"role": "assistant", "content": content, "tool_calls": calls})
                    for i, call in enumerate(calls):
                        fn = call.get("function") if isinstance(call.get("function"), dict) else {}
                        fn_name = str(fn.get("name") or "")
                        call_id = str(call.get("id") or f"r{rnd}c{i}")
                        async for e in _run_tool(loop, call_id, fn_name, fn.get("arguments"), (rnd, i)):
                            yield e
                        messages.append(ollama_tool_message(fn_name, loop.results[call_id].text))
        except httpx.HTTPError as exc:
            yield ev("error", message=f"Ollama bağlantı hatası: {exc}", transient=True)
        yield ev("final", text=final_text.strip())

    async def _show(self, url: str, model: str) -> dict[str, Any]:
        try:
            async with self._client(5) as client:
                data = (await client.post(f"{url}/api/show", json={"model": model})).json()
                return data if isinstance(data, dict) else {}
        except (httpx.HTTPError, ValueError):
            return {}

    async def _capabilities(self, url: str, model: str) -> list[str]:
        return list((await self._show(url, model)).get("capabilities", []) or [])


def _run_tool(loop, call_id, name, arguments, turn):  # noqa: ANN001,ANN202
    """aracı (tur, sıra) bilgisiyle yürüt; tur bilgisini almayan araç döngüsü (ör. test sahtesi) yine çalışır."""
    if hasattr(loop, "set_turn"):
        loop.set_turn(*turn)
    return loop.execute(call_id, name, arguments)
