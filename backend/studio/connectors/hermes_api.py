"""Hermes API Server bağlayıcısı (Runs API + SSE) ve CLI/API dağıtıcısı — Ekip S2.

Kaynak:-9.8.
  POST {base}/runs {input, instructions?, model?, provider?, model_options:{reasoning_effort}} → 202 {run_id}
  GET {base}/runs/{id}/events SSE: `id: <seq>` + `data: {json}` (olay adı JSON'daki "event"), `:` yorum satırları,
                                 Last-Event-ID ile sürdürme; terminal olaydan sonra akış kapanır
  POST {base}/runs/{id}/approval {choice: once|session|always|deny, request_id}
  POST {base}/runs/{id}/stop
  base = http://127.0.0.1:<port>/v1 (default) · http://127.0.0.1:<port>/p/<profil>/v1 (adlandırılmış profil)
Bearer = o profilin kendi.env'indeki API_SERVER_KEY; her çağrıda dosyadan okunur, hiçbir yere yazılmaz.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any, AsyncIterator

import httpx

from studio.connectors.base import CEvent, Connector, Invocation, ev, preview

TERMINAL_EVENTS = {"run.completed", "run.failed", "run.cancelled", "run.interrupted"}
TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}
VALID_CHOICES = ("once", "session", "always", "deny")


class HermesApiError(RuntimeError):
    pass


def describe_http_error(resp: httpx.Response) -> str:
    try:
        err = resp.json().get("error") or {}
        msg = str(err.get("message") or err.get("code") or "")[:240]
    except (ValueError, AttributeError):
        msg = ""
    code = resp.status_code
    if code == 401:
        return ("Hermes API anahtarı reddedildi (401). Profil .env'deki API_SERVER_KEY gateway'in yüklediğiyle "
                "uyuşmuyor olabilir; gateway'i yeniden başlat.")
    if code == 429:
        return "Gateway eşzamanlı çalıştırma sınırında (429); biraz sonra tekrar dene."
    if code == 503:
        return "Gateway mevcut işleri boşaltıyor (503); biraz sonra tekrar dene."
    if code == 404:
        return f"Hermes API: bulunamadı (404){': ' + msg if msg else ''}"
    return f"Hermes API HTTP {code}{': ' + msg if msg else ''}"


class HermesApiConnector(Connector):
    kind = "hermes"

    def __init__(self, settings: Any, gateway: Any, transport: httpx.AsyncBaseTransport | None = None):
        super().__init__(settings)
        self.gateway = gateway
        self.transport = transport
        self.reconnect_delay = 0.25
        self._runs: dict[str, str] = {}  # hermes run_id → profil (onay/durdur çağrıları için)

    # ------------------------------------------------------------------ yardımcılar
    def _client(self, timeout: httpx.Timeout | float = 15.0) -> httpx.AsyncClient:
        # trust_env=False: Bearer anahtarı hiçbir koşulda HTTP(S)_PROXY'ye gitmez; yalnızca 127.0.0.1'e bağlanılır
        return httpx.AsyncClient(transport=self.transport, timeout=timeout, trust_env=False)

    def _auth(self, profile: str) -> dict[str, str]:
        key = self.gateway.profile_key(profile)
        if not key:
            raise HermesApiError(f"'{profile}' profilinde kullanılabilir API_SERVER_KEY yok")
        return {"Authorization": f"Bearer {key}"}

    @staticmethod
    def map_event(obj: dict[str, Any]) -> list[CEvent]:
        """Hermes SSE olayı → normalize stüdyo olayları. Bilinmeyen olaylar yok sayılır."""
        name = obj.get("event")
        if name == "message.delta":
            return [ev("text", text=str(obj.get("delta") or ""))]
        if name == "message.interim":
            text = str(obj.get("text") or "")
            return [] if obj.get("already_streamed") or not text else [ev("text", text=text + "\n\n")]
        if name == "reasoning.available":
            return [ev("thought", text=str(obj.get("text") or "") + "\n")]
        if name == "tool.started":
            return [ev("tool", name=str(obj.get("tool") or "?"), input=preview(obj.get("preview") or ""))]
        if name == "tool.completed":
            return [ev("tool_result", name=str(obj.get("tool") or "?"), ok=not obj.get("error"),
                       output=preview(obj.get("preview") or ""))]
        if name == "subagent.start":
            return [ev("tool", name="subagent", input=preview(obj.get("goal") or obj.get("preview") or ""))]
        if name == "subagent.complete":
            status = str(obj.get("status") or "")
            return [ev("tool_result", name="subagent", ok=status not in ("failed", "error", "cancelled", "interrupted"),
                       output=preview(obj.get("summary") or obj.get("preview") or status))]
        if name == "approval.request":
            choices = [c for c in (obj.get("choices") or ["once", "deny"]) if c in VALID_CHOICES] or ["once", "deny"]
            return [ev("approval", run_id=obj.get("run_id"), request_id=obj.get("request_id"),
                       command=str(obj.get("command") or ""), description=str(obj.get("description") or ""),
                       tool=str(obj.get("tool") or obj.get("pattern_key") or "terminal"), choices=choices,
                       allow_session=bool(obj.get("allow_session")), allow_permanent=bool(obj.get("allow_permanent")),
                       smart_denied=bool(obj.get("smart_denied")))]
        if name == "run.completed":
            usage = obj.get("usage") or {}
            return [ev("usage", input=usage.get("input_tokens"), output=usage.get("output_tokens"),
                       total=usage.get("total_tokens")), ev("final", text=str(obj.get("output") or ""))]
        if name == "run.failed":
            out = []
            if obj.get("usage"):
                u = obj["usage"]
                out.append(ev("usage", input=u.get("input_tokens"), output=u.get("output_tokens"), total=u.get("total_tokens")))
            out.append(ev("error", message=str(obj.get("error") or obj.get("turn_exit_reason") or "Hermes çalıştırması başarısız")))
            return out
        if name == "run.cancelled":
            return [ev("error", message="Hermes çalıştırması durduruldu")]
        if name == "run.interrupted":
            return [ev("error", message=str(obj.get("error") or "Gateway kapanırken çalıştırma yarıda kaldı"))]
        return []

    @staticmethod
    def _from_status(st: dict[str, Any]) -> list[CEvent]:
        status = st.get("status")
        if status == "completed":
            return HermesApiConnector.map_event({"event": "run.completed", **st})
        if status == "failed":
            return HermesApiConnector.map_event({"event": "run.failed", **st})
        if status == "cancelled":
            return HermesApiConnector.map_event({"event": "run.cancelled"})
        return HermesApiConnector.map_event({"event": "run.interrupted", "error": st.get("error")})

    # ------------------------------------------------------------------ çalıştırma
    async def run(self, inv: Invocation) -> AsyncIterator[CEvent]:  # type: ignore[override]
        profile = inv.route.profile or "default"
        try:
            auth = self._auth(profile)
        except HermesApiError as exc:
            yield ev("error", message=f"{exc} — Bağlantılar → Hermes API sunucusu bölümünden etkinleştir")
            return
        base = self.gateway.profile_api_base(profile)
        body: dict[str, Any] = {"input": inv.prompt}
        if inv.system.strip():
            body["instructions"] = inv.system
        if inv.route.model:
            body["model"] = inv.route.model
        if inv.route.provider:
            body["provider"] = inv.route.provider
        reasoning = inv.agent.get("reasoning")
        if reasoning:
            body["model_options"] = {"reasoning_effort": str(reasoning)}
        invocation = {"transport": "api", "endpoint": f"POST {httpx.URL(base).path}/runs", "profile": profile,
                      "model": inv.route.model, "provider": inv.route.provider,
                      "reasoning": str(reasoning) if reasoning else None, "instructions": bool(inv.system.strip())}
        yield ev("meta", model=inv.route.model, invocation={k: v for k, v in invocation.items() if v is not None})

        headers = {**auth, "Idempotency-Key": f"studio-{inv.run_id}-{inv.step_id}-{uuid.uuid4().hex[:8]}"}
        async with self._client(httpx.Timeout(20.0, read=60.0)) as client:
            try:
                resp = await client.post(f"{base}/runs", json=body, headers=headers)
            except httpx.HTTPError as exc:
                yield ev("error", message=f"Hermes gateway'e ulaşılamadı ({type(exc).__name__})")
                return
            if resp.status_code not in (200, 201, 202):
                yield ev("error", message=describe_http_error(resp))
                return
            try:
                run_id = str(resp.json()["run_id"])
            except (ValueError, KeyError, TypeError):
                yield ev("error", message="Hermes API beklenmeyen yanıt verdi (run_id yok)")
                return
            self._runs[run_id] = profile
            yield ev("meta", invocation={"hermes_run_id": run_id})
            state = {"terminal": False}
            events = self._events(client, base, run_id, auth, inv.timeout_s, state)
            try:
                async for e in events:
                    yield e
            except (asyncio.CancelledError, GeneratorExit):
                if not state["terminal"]:  # stüdyoda iptal → Hermes'te de durdur (E5.4-d)
                    await self._stop_quiet(client, base, run_id, auth)
                raise
            finally:
                await events.aclose()
                self._runs.pop(run_id, None)

    async def _events(self, client: httpx.AsyncClient, base: str, run_id: str, auth: dict[str, str],
                      timeout_s: float, state: dict[str, bool]) -> AsyncIterator[CEvent]:
        deadline = time.monotonic() + timeout_s
        last_seq: int | None = None
        reconnects = 0
        while True:
            headers = dict(auth)
            if last_seq is not None:
                headers["Last-Event-ID"] = str(last_seq)
            try:
                async with client.stream("GET", f"{base}/runs/{run_id}/events", headers=headers) as resp:
                    if resp.status_code != 200:
                        await resp.aread()
                        state["terminal"] = True
                        yield ev("error", message=describe_http_error(resp))
                        return
                    data: list[str] = []
                    cur_id: str | None = None
                    async for line in resp.aiter_lines():
                        if time.monotonic() > deadline:
                            await self._stop_quiet(client, base, run_id, auth)
                            state["terminal"] = True
                            yield ev("error", message=f"Zaman aşımı ({int(timeout_s // 60)} dk); çalıştırma durduruldu")
                            return
                        if line == "":
                            if data:
                                payload, data = "\n".join(data), []
                                try:
                                    obj = json.loads(payload)
                                except json.JSONDecodeError:
                                    cur_id = None
                                    continue
                                seq = obj.get("seq", cur_id)
                                if seq is not None:
                                    try:
                                        last_seq = int(seq)
                                    except (TypeError, ValueError):
                                        pass
                                obj.setdefault("run_id", run_id)
                                terminal = obj.get("event") in TERMINAL_EVENTS
                                if terminal:
                                    state["terminal"] = True
                                for ce in self.map_event(obj):
                                    yield ce
                                if terminal:
                                    return
                            cur_id = None
                            continue
                        if line.startswith(":"):
                            continue  # ": open", ": keepalive", ": stream closed"
                        field, _, value = line.partition(":")
                        value = value[1:] if value.startswith(" ") else value
                        if field == "data":
                            data.append(value)
                        elif field == "id":
                            cur_id = value.strip()
            except httpx.HTTPError:
                pass  # bağlantı koptu → durum yoklaması ve Last-Event-ID ile yeniden bağlan
            st = await self._status(client, base, run_id, auth)
            if st and st.get("status") in TERMINAL_STATUSES:
                state["terminal"] = True
                for ce in self._from_status(st):
                    yield ce
                return
            reconnects += 1
            if reconnects > 8 or time.monotonic() > deadline:
                await self._stop_quiet(client, base, run_id, auth)
                state["terminal"] = True
                yield ev("error", message="Hermes olay akışı koptu ve yeniden bağlanılamadı; çalıştırma durduruldu")
                return
            await asyncio.sleep(min(2.0, self.reconnect_delay * reconnects))

    async def _status(self, client: httpx.AsyncClient, base: str, run_id: str,
                      auth: dict[str, str]) -> dict[str, Any] | None:
        try:
            resp = await client.get(f"{base}/runs/{run_id}", headers=auth)
            return resp.json() if resp.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            return None

    async def _stop_quiet(self, client: httpx.AsyncClient, base: str, run_id: str, auth: dict[str, str]) -> None:
        try:
            await asyncio.wait_for(client.post(f"{base}/runs/{run_id}/stop", headers=auth), timeout=5)
        except (httpx.HTTPError, asyncio.TimeoutError, OSError):
            pass

    # ------------------------------------------------------------------ kontrol (onay / durdur)
    async def respond(self, run_id: str, request_id: str | None, choice: str) -> dict[str, Any]:
        if choice not in VALID_CHOICES:
            raise HermesApiError(f"Geçersiz onay seçimi: {choice}")
        profile = self._runs.get(run_id)
        if profile is None:
            raise HermesApiError("Bu Hermes çalıştırması artık etkin değil")
        base = self.gateway.profile_api_base(profile)
        body: dict[str, Any] = {"choice": choice}
        if request_id:
            body["request_id"] = request_id
        async with self._client(10.0) as client:
            try:
                resp = await client.post(f"{base}/runs/{run_id}/approval", json=body, headers=self._auth(profile))
            except httpx.HTTPError as exc:
                raise HermesApiError(f"Onay gateway'e iletilemedi ({type(exc).__name__})") from exc
        if resp.status_code >= 400:
            raise HermesApiError("Onay iletilemedi: " + describe_http_error(resp))
        try:
            return resp.json()
        except ValueError:
            return {}

    async def stop(self, run_id: str) -> dict[str, Any]:
        profile = self._runs.get(run_id, "default")
        base = self.gateway.profile_api_base(profile)
        async with self._client(10.0) as client:
            resp = await client.post(f"{base}/runs/{run_id}/stop", headers=self._auth(profile))
        if resp.status_code >= 400:
            raise HermesApiError(describe_http_error(resp))
        return resp.json()


class HermesDispatcher(Connector):
    """Studio.connectors["hermes"]: ajan başına taşıma seçer (ARCH: Agent.transport).

    auto (varsayılan): skill/araç seti atanmışsa CLI (API bunları run başına uygulamaz); değilse gateway sağlıklı ve
    profil anahtarı varsa API; aksi hâlde CLI. cli/api zorlar; api istenip kullanılamıyorsa açık hata verir.
    """

    kind = "hermes"

    def __init__(self, settings: Any, cli: Connector, api: HermesApiConnector, gateway: Any):
        super().__init__(settings)
        self.cli, self.api, self.gateway = cli, api, gateway

    async def decide(self, inv: Invocation) -> dict[str, Any]:
        mode = str(inv.agent.get("transport") or "auto").lower()
        if mode not in ("auto", "cli", "api"):
            mode = "auto"
        profile = inv.route.profile or "default"
        if mode == "cli":
            return {"transport": "cli", "mode": mode, "reason": "ajan ayarı: CLI zorunlu"}
        ok, why = await self.gateway.available_for(profile)
        if mode == "api":
            if ok:
                extra = (" (atanmış skill/araç seti bu yolda uygulanmaz)"
                         if inv.agent.get("skills") or inv.agent.get("toolsets") else "")
                return {"transport": "api", "mode": mode, "reason": "ajan ayarı: API zorunlu" + extra}
            return {"transport": "api", "mode": mode, "reason": why,
                    "error": (f"Bu ajan Hermes API taşımasına ayarlı ama API kullanılamıyor: {why}. Bağlantılar → "
                              "Hermes API sunucusu bölümünden etkinleştirip başlat ya da ajanın taşımasını "
                              "'Otomatik' veya 'CLI' yap.")}
        if inv.agent.get("skills") or inv.agent.get("toolsets"):
            return {"transport": "cli", "mode": mode,
                    "reason": "otomatik: skill/araç seti atanmış (API yolunda run başına uygulanmaz)"}
        if not ok:
            return {"transport": "cli", "mode": mode, "reason": f"otomatik: {why}"}
        if inv.route.provider == "custom" and not getattr(self.gateway, "managed", False):
            return {"transport": "cli", "mode": mode,
                    "reason": "otomatik: Ollama beyni ve gateway uygulama dışında başlatılmış (CUSTOM_BASE_URL garanti değil)"}
        return {"transport": "api", "mode": mode, "reason": "otomatik: gateway sağlıklı ve profil anahtarı var"}

    async def run(self, inv: Invocation) -> AsyncIterator[CEvent]:  # type: ignore[override]
        d = await self.decide(inv)
        yield ev("meta", invocation={"transport": d["transport"], "mode": d["mode"], "reason": d["reason"]})
        if d.get("error"):
            yield ev("error", message=d["error"])
            return
        agen = (self.api if d["transport"] == "api" else self.cli).run(inv)
        try:
            async for e in agen:
                yield e
        finally:
            await agen.aclose()  # iptalde alt bağlayıcı da kapanır (API: /stop, CLI: süreç ağacı)

    async def respond(self, run_id: str, request_id: str | None, choice: str) -> dict[str, Any]:
        return await self.api.respond(run_id, request_id, choice)

    async def stop(self, run_id: str) -> dict[str, Any]:
        return await self.api.stop(run_id)
