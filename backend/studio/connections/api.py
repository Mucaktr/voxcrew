"""/api/connections — tek bağlantı durumu + sihirbaz eylemleri (S29).

GET  /api/connections?force=&wait=         → sağlayıcı durumları (eski alanlar korunur)
GET  /api/connections/summary              → {brains_ready, any_brain, checking, version}
GET  /api/connections/{kind}               → tek sağlayıcı
POST /api/connections/rescan               → önbelleği geçersiz kıl, yeniden tara
POST /api/connections/{kind}/test          → gerçek kısa çalıştırma (ollama, codex, claude, hermes, openai_compat)
GET  /api/connections/hardware             → RAM / GPU özeti
GET  /api/connections/models/available?refresh=  → seçilebilir modeller (UI-CLARITY): {connections: {kind: {ready, reason,
     reason_text, link, default_model, models: [{id, label, source, default}]}}} — 5 sn önbellekli, yeni ağ çağrısı yok
GET  /api/connections/models/recommend     → donanıma göre öneriler + bağlam seçenekleri
POST /api/connections/ollama/pull   {model, confirm}            → iş başlatır (ilerleme: GET /jobs/{id}, olay connection.job)
POST /api/connections/ollama/create {name, from, num_ctx, confirm} → geniş bağlamlı kopya (Modelfile yok)
GET  /api/connections/jobs · GET /jobs/{id} · POST /jobs/{id}/cancel
POST /api/connections/ollama/start {confirm} · POST /ollama/stop   → stüdyonun alt süreci olarak `ollama serve`
GET  /api/connections/hermes/candidates · POST /hermes/home {path, preview?} → stüdyo ayarı hermes_home
     (preview: true → yazmadan önizleme {from, to, touches_folder:false}; arayüz onaydan sonra {path, confirm:true} yollar)
POST /api/connections/{kind}/login {confirm}                       → terminal penceresinde resmî giriş (codex/claude)
POST /api/connections/recheck?wait=   → UCUZ yeniden tarama (yalnız hazır olmayanlar; pencereye dönüş / kurulum rehberi)
POST /api/connections/terminal {shell, confirm}                    → BOŞ terminal (kurulum rehberi; komut çalıştırmaz)
PUT  /api/connections/openai_compat {base_url, label, model, api_key?} → VARSAYILAN API bağlantısı (eski tek uç; maskeli)
S37 — adlandırılmış çoklu API bağlantısı (Mistral + LM Studio + Claude API … aynı anda; anahtarlar secrets.json'da):
GET  /api/connections/openai_compat/presets                 → doğrulanmış ön ayar kataloğu (kaynak + tarih)
GET  /api/connections/openai_compat/endpoints               → uç noktalar (maskeli) + durum
POST /api/connections/openai_compat/endpoints {preset?, label, base_url, api, model, api_key?, make_default?}
PUT  /api/connections/openai_compat/endpoints/{id}  (api_key: alan yok = koru, null/"" = sil)
DELETE /api/connections/openai_compat/endpoints/{id}        → uç nokta + anahtarı
POST /api/connections/openai_compat/endpoints/{id}/default
GET  /api/connections/openai_compat/endpoints/{id}/models   → canlı /models listesi (kalıcı listeyi tazeler)
POST /api/connections/openai_compat/test {endpoint?, model?} → gerçek kısa çalıştırma (o uç nokta)
S37 — model erişim politikası (yalnızca arayüz; MCP: USER_ONLY_RE, genel PUT /api/settings `models`'ı yok sayar):
GET  /api/connections/models/policy                  → {policy, presets, consent, preview}
PUT  /api/connections/models/policy {mode, allow, deny, require_consent_remote}
POST /api/connections/models/consent {key, confirm}  → uzak uç noktaya bir kerelik onay · POST /models/consent/revoke {key}
Kayıt: main.py'de `build_router(studio)` (önek /api/connections). Çekirdek router (studio.api) bu rotaları içermez.
"""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Body, HTTPException

from studio.connectors.base import Invocation, Route
from studio.connectors.discovery import hermes_home_candidates, wsl_hint
from studio.connectors.openai_compat import OpenAICompatConnector
from studio.connections import available as models_available
from studio.connections import endpoints as E
from studio.connections import policy as model_policy
from studio.connections.models import OllamaJobs, recommend_context, recommend_models
from studio.connections.providers.openai_compat import probe as probe_endpoint
from studio.connections.secrets import SecretsCorrupt, SecretStore
from studio.connections.service import ConnectionService, data_dir_of, service_for
from studio.connections.setup import (
    OllamaRunner, SetupError, apply_hermes_home, configure_openai_compat, login_command, open_shell, open_terminal,
    preview_hermes_home,
)
from studio.i18n import request_lang, translate

if TYPE_CHECKING:
    from studio.api import Studio

TESTABLE = ("ollama", "codex", "claude", "hermes", "openai_compat")
AVAILABLE_TTL_S = 5.0  # /models/available önbelleği
AVAILABLE_WAIT_S = 2.0  # durum tazelemesi + Ollama liste denemesi üst sınırı
COMPAT_SAVE_WAIT_S = 6.0  # openai_compat HTTP denemesi (4 sn) + pay


def wire(studio: "Studio") -> ConnectionService:
    """Servisi stüdyoya bağlar (bus, gateway, secrets, Ollama süreci, işler). Birden çok çağrı güvenlidir."""
    svc = service_for(studio.settings)
    if getattr(svc, "_wired_to", None) is studio:
        return svc
    data_dir = data_dir_of(studio)
    secrets = SecretStore(data_dir)
    runner = OllamaRunner(studio.settings, data_dir)
    svc.attach(bus=studio.bus, gateway=getattr(studio, "gateway", None), secrets=secrets, ollama_runner=runner)
    try:  # S37: eski tek OpenAI uyumlu bağlantıyı adlandırılmış listeye kayıpsız taşı (idempotent)
        E.migrate(studio.settings)
    except Exception:  # noqa: BLE001 - bozuk ayar açılışı engellemesin; okuma yolu yine eski bloğu görür
        pass

    async def models_changed() -> None:
        try:
            await studio.refresh_models()
        finally:
            svc.invalidate("ollama")
            await svc.refresh(force=True, wait_s=3.0)

    svc.jobs = OllamaJobs(lambda: str(studio.settings.get("ollama_url")), on_done=models_changed, bus=studio.bus)  # type: ignore[attr-defined]
    svc.secrets = secrets  # type: ignore[attr-defined]
    svc.runner = runner  # type: ignore[attr-defined]
    studio.connections = svc  # type: ignore[attr-defined]
    # openai_compat bağlayıcısı aynı anahtar deposunu kullansın
    compat = (getattr(studio, "connectors", None) or {}).get("openai_compat")
    if compat is not None:
        compat.secrets = secrets
    svc._wired_to = studio  # type: ignore[attr-defined]
    return svc


def build_router(studio: "Studio", prefix: str = "/api/connections") -> APIRouter:
    r = APIRouter(prefix=prefix, tags=["connections"])
    S = studio
    svc = wire(studio)
    jobs: OllamaJobs = svc.jobs  # type: ignore[attr-defined]
    secrets: SecretStore = svc.secrets  # type: ignore[attr-defined]
    runner: OllamaRunner = svc.runner  # type: ignore[attr-defined]

    def confirmed(data: dict[str, Any]) -> None:
        if data.get("confirm") is not True:
            raise HTTPException(400, "Bu işlem için açık onay (confirm: true) gerekli")

    # ------------------------------------------------------------------ durum
    @r.get("")
    async def list_connections(force: bool = False, wait: float = 2.5, all: bool = False) -> list[dict[str, Any]]:  # noqa: A002
        """Varsayılan: eski arayüzün tanıdığı türler (geriye uyum). `all=true`: sihirbaz için tüm sağlayıcılar."""
        return await svc.list(force=force, wait_s=max(0.0, min(wait, 20.0)), include_all=all)

    @r.get("/summary")
    async def summary() -> dict[str, Any]:
        await svc.refresh()
        return svc.summary()

    @r.post("/rescan")
    async def rescan(wait: float = 3.0) -> list[dict[str, Any]]:
        svc.invalidate()
        return await svc.list(force=True, wait_s=max(0.0, min(wait, 20.0)), include_all=True)

    @r.post("/recheck")
    async def recheck(wait: float = 1.5) -> dict[str, Any]:
        """SETUP: kullanıcı bir aracı stüdyo açıkken kurduysa yeniden başlatmadan "hazır"a geçsin — ucuz tarama."""
        info = await svc.recheck(wait_s=max(0.0, min(wait, 10.0)))
        return {**info, "states": svc.all_public(), "summary": svc.summary()}

    @r.post("/terminal")
    async def terminal(data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        """SETUP kurulum rehberi: yalnızca kullanıcı tıklamasıyla, boş bir terminal açar (komut almaz, çalıştırmaz)."""
        confirmed(data)
        return await asyncio.to_thread(open_shell, str(data.get("shell") or "sh"))

    @r.get("/hardware")
    async def hardware(force: bool = False) -> dict[str, Any]:
        import asyncio
        hw = await asyncio.to_thread(svc.ctx.hardware.get, force)
        # S19: bilgi notu istek dilinde (TR'de aynen)
        return {**hw, "note": translate(hw["note"])} if isinstance(hw, dict) and isinstance(hw.get("note"), str) else hw

    @r.get("/models/recommend")
    async def recommend() -> dict[str, Any]:
        import asyncio
        hw = await asyncio.to_thread(svc.ctx.hardware.get)
        await svc.refresh(wait_s=2.0)
        detailed = [m for m in S.agents.ollama_models if m.get("local")]
        known = {m["name"] for m in detailed}
        # servis durumundaki adlar (ayrıntısı henüz alınmamış modeller) + ajan kaydındaki ayrıntılı liste
        names = list(((svc.states.get("ollama") or {}).get("models_ready") or {}).get("names") or [])
        installed = [m["name"] for m in detailed] + [n for n in names if n not in known]
        out = recommend_models(hw, installed, request_lang())
        out["installed"] = [{"name": m["name"], "parameter_size": m.get("parameter_size"), "num_ctx": m.get("num_ctx"),
                             "context_max": m.get("context_max"), "hermes_ready": m.get("hermes_ready"),
                             "tools": "tools" in (m.get("capabilities") or []),
                             "context": recommend_context(_params_b(m.get("parameter_size")), hw, m.get("context_max"))}
                            for m in detailed]
        out["installed"] += [{"name": n, "parameter_size": None, "num_ctx": None, "context_max": None, "hermes_ready": None,
                              "tools": None, "context": recommend_context(_params_b(None), hw, None)}
                             for n in names if n not in known]
        return out

    # ------------------------------------------------------------------ Hermes klasörü
    @r.get("/hermes/candidates")
    async def hermes_candidates() -> dict[str, Any]:
        cands = hermes_home_candidates(str(S.settings.get("hermes_home") or ""))
        return {"candidates": cands, "current": S.settings.get("hermes_home"), "wsl": _wsl_localized(),
                "env_locked": "hermes_home" in getattr(S.settings, "env_locked", [])}

    @r.post("/hermes/home")
    async def set_hermes_home(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        path = str(data.get("path") or "").strip()
        if not path:
            raise HTTPException(400, "path gerekli")
        if data.get("preview") is True:
            # önizle → onayla: önce neyin değişeceği gösterilir (yalnızca stüdyo ayarı; Hermes klasörüne yazılmaz)
            try:
                return {"preview": preview_hermes_home(S.settings, path)}
            except SetupError as exc:
                raise HTTPException(400, str(exc)) from exc
        try:
            result = apply_hermes_home(S.settings, path)
        except SetupError as exc:
            raise HTTPException(400, str(exc)) from exc
        S.agents.caps.invalidate()
        S.agents.sync_profiles()
        svc.invalidate("hermes")
        result["state"] = await svc.get("hermes", force=True)
        S.bus.publish("config.changed", change={"setting": "hermes_home", "value": path})
        return result

    # ------------------------------------------------------------------ Ollama süreci
    @r.post("/ollama/start")
    async def ollama_start(data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        confirmed(data)
        try:
            info = await runner.start()
        except SetupError as exc:
            raise HTTPException(409, str(exc)) from exc
        svc.invalidate("ollama")
        await svc.refresh(force=True, wait_s=4.0)
        await S.refresh_models()
        return {"runner": info, "state": svc.public("ollama")}

    @r.post("/ollama/stop")
    async def ollama_stop() -> dict[str, Any]:
        try:
            info = await runner.stop()
        except SetupError as exc:
            raise HTTPException(409, str(exc)) from exc
        svc.invalidate("ollama")
        await svc.refresh(force=True, wait_s=1.0)
        return {"runner": info, "state": svc.public("ollama")}

    @r.get("/ollama/runner")
    async def ollama_runner() -> dict[str, Any]:
        return runner.info()

    # ------------------------------------------------------------------ model işleri
    @r.post("/ollama/pull")
    async def ollama_pull(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        confirmed(data)
        try:
            return jobs.start_pull(str(data.get("model") or ""))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @r.post("/ollama/create")
    async def ollama_create(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        confirmed(data)
        source = str(data.get("from") or data.get("source") or "")
        num_ctx = int(data.get("num_ctx") or 0)
        name = str(data.get("name") or "").strip() or f"{source.split(':')[0]}-{num_ctx // 1024}k"
        try:
            return jobs.start_create(name, source, num_ctx)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    @r.get("/jobs")
    async def list_jobs() -> list[dict[str, Any]]:
        return sorted(jobs.jobs.values(), key=lambda j: j["started"], reverse=True)

    @r.get("/jobs/{job_id}")
    async def job(job_id: str) -> dict[str, Any]:
        if job_id not in jobs.jobs:
            raise HTTPException(404, "İş bulunamadı")
        return jobs.jobs[job_id]

    @r.post("/jobs/{job_id}/cancel")
    async def cancel_job(job_id: str) -> dict[str, Any]:
        return {"ok": jobs.cancel(job_id)}

    # ------------------------------------------------------------------ giriş (terminal)
    @r.post("/{kind}/login")
    async def login(kind: str, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        confirmed(data)
        try:
            argv, shown = login_command(kind)
        except SetupError as exc:
            raise HTTPException(400, str(exc)) from exc
        result = open_terminal(argv)
        result["shown"] = shown
        result["next"] = ("Terminaldeki adımları tamamla; giriş bitince burada 'Test et' ile doğrula."
                          if request_lang() != "en" else "Finish the steps in the terminal; then click 'Test' here to verify.")
        return result

    # ------------------------------------------------------------------ OpenAI uyumlu
    @r.put("/openai_compat")
    async def put_openai_compat(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            cfg = configure_openai_compat(S.settings, secrets, data)
        except SetupError as exc:
            raise HTTPException(400, str(exc)) from exc
        except SecretsCorrupt as exc:
            raise HTTPException(409, str(exc)) from exc
        svc.invalidate("openai_compat")
        # yanıt, anahtar/uç gerçekten denendikten SONRAKİ durumdur (yalnız hızlı aşama "hazır" gösteriyordu, QA-F56)
        await svc.refresh(force=True, wait_s=COMPAT_SAVE_WAIT_S)
        return {"config": cfg, "state": svc.public("openai_compat")}

    # ------------------------------------------------------------------ S37: adlandırılmış API bağlantıları
    def _ep_state() -> dict[str, Any]:
        return svc.public("openai_compat") if "openai_compat" in svc.states else {}

    async def _after_change() -> dict[str, Any]:
        svc.invalidate("openai_compat")
        await svc.refresh(force=True, wait_s=COMPAT_SAVE_WAIT_S)
        S.bus.publish("config.changed", change={"setting": "connections.openai_compat"})
        return _ep_state()

    def _ep_or_404(eid: str) -> dict[str, Any]:
        ep = E.get_endpoint(S.settings, eid)
        if not ep:
            raise HTTPException(404, f"Böyle bir API bağlantısı yok: {eid}")
        return ep

    def _find(state: dict[str, Any], eid: str) -> dict[str, Any] | None:
        return next((e for e in (state.get("extra") or {}).get("endpoints") or [] if e["id"] == eid), None)

    async def _remember(eid: str) -> dict[str, Any] | None:
        """Canlı /models → kalıcı liste (ajan başına seçim çevrimdışıyken de görünsün). Anahtar yanıta girmez."""
        ep = E.get_endpoint(S.settings, eid)
        if not ep:
            return None
        key = secrets.get(E.secret_name(eid))
        if E.public_endpoint(ep, secrets)["key_required"] and not key:
            return None
        res = await probe_endpoint(ep, key, svc.ctx.http_transport)
        names = (res.get("models") or {}).get("names")
        if names:
            E.remember_models(S.settings, eid, names)
        return res

    @r.get("/openai_compat/presets")
    async def compat_presets() -> list[dict[str, Any]]:
        return E.presets_public(request_lang())

    @r.get("/openai_compat/endpoints")
    async def compat_endpoints() -> dict[str, Any]:
        await svc.refresh(wait_s=2.0)
        st = _ep_state()
        return {"endpoints": (st.get("extra") or {}).get("endpoints") or [],
                "default_endpoint": E.default_endpoint_id(S.settings), "state": st}

    @r.post("/openai_compat/endpoints")
    async def compat_add(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        from studio.entitlements import gate as plan_gate  # E9: yalnız uzak API sayılır; yerel sunucu asla
        _url = str(data.get("base_url") or (E.preset(data.get("preset")) or {}).get("base_url") or "")
        if (_ent := plan_gate(S)) is not None and not (_url and E.is_local_url(_url)):
            _ent.require("api_connections")
        try:
            ep = E.save_endpoint(S.settings, secrets, data, None)
        except E.EndpointError as exc:
            raise HTTPException(400, str(exc)) from exc
        except SecretsCorrupt as exc:
            raise HTTPException(409, str(exc)) from exc
        await _remember(ep["id"])
        state = await _after_change()
        return {"endpoint": _find(state, ep["id"]) or ep, "state": state}

    @r.put("/openai_compat/endpoints/{eid}")
    async def compat_update(eid: str, data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        _ep_or_404(eid)
        try:
            ep = E.save_endpoint(S.settings, secrets, {k: v for k, v in data.items() if k not in ("id", "preset")}, eid)
        except E.EndpointError as exc:
            raise HTTPException(400, str(exc)) from exc
        except SecretsCorrupt as exc:
            raise HTTPException(409, str(exc)) from exc
        await _remember(eid)
        state = await _after_change()
        return {"endpoint": _find(state, eid) or ep, "state": state}

    @r.delete("/openai_compat/endpoints/{eid}")
    async def compat_delete(eid: str) -> dict[str, Any]:
        _ep_or_404(eid)
        try:
            E.delete_endpoint(S.settings, secrets, eid)
        except E.EndpointError as exc:
            raise HTTPException(400, str(exc)) from exc
        (svc.states.get("openai_compat") or {}).get("endpoint_status", {}).pop(eid, None)
        return {"ok": True, "state": await _after_change()}

    @r.post("/openai_compat/endpoints/{eid}/default")
    async def compat_default(eid: str) -> dict[str, Any]:
        _ep_or_404(eid)
        try:
            E.set_default(S.settings, eid)
        except E.EndpointError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"ok": True, "state": await _after_change()}

    @r.get("/openai_compat/endpoints/{eid}/models")
    async def compat_models(eid: str) -> dict[str, Any]:
        ep = _ep_or_404(eid)
        res = await _remember(eid)
        names = ((res or {}).get("models") or {}).get("names")
        return {"endpoint": eid, "models": names if names is not None else ep["models"], "live": names is not None,
                "error": (res or {}).get("error"), "session_valid": (res or {}).get("session_valid")}

    # ------------------------------------------------------------------ UI-CLARITY: seçilebilir modeller
    available_cache: dict[str, tuple[float, dict[str, Any]]] = {}

    @r.get("/models/available")
    async def models_available_route(refresh: bool = False) -> dict[str, Any]:
        lang = request_lang()
        hit = available_cache.get(lang)
        if hit and not refresh and time.monotonic() - hit[0] < AVAILABLE_TTL_S:
            return hit[1]
        await svc.refresh(force=refresh, wait_s=AVAILABLE_WAIT_S)
        states = {k: svc.public(k) for k in models_available.KINDS if k in svc.states}
        models = list(S.agents.ollama_models)
        if not models and (states.get("ollama") or {}).get("service_reachable"):
            try:  # önbellek boşken tek kısa deneme; Ollama kapalıysa sessizce boş liste
                models = await asyncio.wait_for(S.refresh_models(), AVAILABLE_WAIT_S)
            except Exception:  # noqa: BLE001
                models = []
        body = models_available.build(S.settings, states, models)
        available_cache[lang] = (time.monotonic(), body)
        return body

    # ------------------------------------------------------------------ S37: model erişim politikası
    def _policy_view() -> dict[str, Any]:
        lang = request_lang()
        return {"policy": model_policy.policy_of(S.settings), "modes": list(model_policy.MODES),
                "presets": model_policy.PRESETS, "consent": model_policy.consents(S.settings),
                "preview": model_policy.preview(S.settings, list(S.agents.ollama_models), lang)}

    @r.get("/models/policy")
    async def get_model_policy() -> dict[str, Any]:
        return _policy_view()

    @r.put("/models/policy")
    async def put_model_policy(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        try:
            await asyncio.to_thread(model_policy.save_policy, S.settings, data)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        S.bus.publish("config.changed", change={"setting": "models.policy"})
        return _policy_view()

    @r.post("/models/consent")
    async def post_model_consent(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        confirmed(data)
        try:
            await asyncio.to_thread(model_policy.give_consent, S.settings, str(data.get("key") or ""))
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return _policy_view()

    @r.post("/models/consent/revoke")
    async def revoke_model_consent(data: dict[str, Any] = Body(...)) -> dict[str, Any]:
        await asyncio.to_thread(model_policy.revoke_consent, S.settings, str(data.get("key") or ""))
        return _policy_view()

    # ------------------------------------------------------------------ gerçek test (tek yer)
    @r.post("/{kind}/test")
    async def test_connection(kind: str, data: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        model = data.get("model")
        if kind not in TESTABLE:
            raise HTTPException(400, "Test edilebilir bağlantılar: " + ", ".join(TESTABLE))
        await svc.refresh()  # durum kaydı olsun ki sonuç tek kaynağa işlensin
        connector = S.connectors.get(kind)
        profile: str | None = None
        if kind == "ollama":
            # BRAINS-LIVE: kart "en küçük yerel model" der; liste Hermes uyumlu (64K) kopyayı öne aldığı için ilk model
            # 9B/64K oluyordu (CPU'da ~1 dk, ~9 GB). Test en küçük yerel modelle yapılır.
            model = model or S.agents.smallest_ollama_model() or S.agents.default_ollama_model(for_hermes=False)
            if not model:
                raise HTTPException(409, "Ollama'da kurulu yerel model yok; önce bir model indir")
            route = Route("ollama", "ollama", model)
        elif kind in ("codex", "claude"):
            route = Route(kind, kind, model)
        elif kind == "hermes":
            hx = (svc.snapshot("hermes") or {}).get("extra") or {}
            rows = [r for r in hx.get("profile_models") or [] if isinstance(r, dict)]
            known = {"default", *(str(r.get("profile")) for r in rows), *(str(p) for p in hx.get("profiles") or [])}
            # BRAINS-LIVE: profil seçilmezse önerilen profil (yerel modelli) — varsayılan profil bu bilgisayarda olmayan
            # bir bulut modeline bağlı olabilir
            profile = str(data.get("profile") or hx.get("test_profile") or "default")
            if profile not in known:
                raise HTTPException(400, f"Böyle bir Hermes profili yok: {profile[:64]}")
            model = next((r.get("model") for r in rows if r.get("profile") == profile), None) or None
            route = Route("hermes", "profile", None, None, profile)
        else:
            eid = str(data.get("endpoint") or "") or None
            ep = E.get_endpoint(S.settings, eid)
            if eid and not ep:
                raise HTTPException(404, f"Böyle bir API bağlantısı yok: {eid}")
            ref_eid, ref_model = E.parse_model_ref(model)
            if ref_eid and not eid:
                ep = E.get_endpoint(S.settings, ref_eid) or ep
            model = ref_model or (ep or {}).get("model") or None
            route = Route("openai_compat", "openai_compat", model, (ep or {}).get("id"))
            connector = connector or OpenAICompatConnector(S.settings, secrets)
        if connector is None:
            raise HTTPException(409, f"'{kind}' bağlayıcısı kayıtlı değil")
        # model erişim politikası testte de geçerli (açık kullanıcı tıklaması: ilk kullanım onayı burada aranmaz)
        decision = model_policy.check_route(S.settings, route, check_consent=False)
        if not decision.allowed:
            raise HTTPException(403, decision.message(request_lang()))
        agent: dict[str, Any] = {"name": "Test", "transport": "cli"}
        inv = Invocation(run_id="test", step_id="test", agent=agent, system="Kısa ve net yanıt ver.",
                         prompt="Sadece 'Merhaba, hazırım!' yaz.", route=route, workdir=S.settings.workdir,
                         timeout_s=_test_timeout(kind, data.get("timeout_s")), max_turns=2)
        t0, text, errors = time.monotonic(), "", []
        # AUDIT P1: bağlantı testi beyaz listedeki bir sistem çağrısıdır (günlük tavan + defter + SystemCall düğümü)
        from studio.workflow import system_calls  # noqa: PLC0415
        from studio.workflow.daily import DailyBudgetReached  # noqa: PLC0415
        try:
            with system_calls.account(S.settings, "connection_test", ref=kind, store=S.store,
                                      connector=route.connector, connection=route.connection, model=route.model,
                                      title=f"Bağlantı testi: {kind}") as call:
                try:
                    async for e in connector.run(inv):
                        if e.kind == "final":
                            text = e.data.get("text", "")
                        elif e.kind == "meta" and isinstance(e.data.get("model"), str) and e.data["model"]:
                            model = e.data["model"][:200]  # CLI'nin bildirdiği gerçek model (Claude, Hermes)
                        elif e.kind == "error":
                            errors.append(str(e.data.get("message")))
                        elif e.kind == "usage":
                            call.usage = {}
                            call.add_usage(e.data)
                except Exception as exc:  # noqa: BLE001 - test hiçbir zaman 500 vermesin
                    errors.append(str(exc)[:300])
                if errors:
                    call.fail(" · ".join(errors))
        except DailyBudgetReached as exc:
            errors.append(str(exc.detail))
        ok = bool(text) and not errors
        if kind == "openai_compat" and route.provider:
            svc.record_endpoint_use(route.provider, ok, " · ".join(errors) or None)
        else:
            svc.record_use(kind, ok, " · ".join(errors) or None)
        return {"ok": ok, "text": text[:400], "error": " · ".join(errors) or None,
                "ms": int((time.monotonic() - t0) * 1000), "model": model, "profile": profile,
                "state": svc.public(kind)}

    @r.get("/{kind}")
    async def get_one(kind: str, force: bool = False) -> dict[str, Any]:
        try:
            return await svc.get(kind, force=force)
        except KeyError as exc:
            raise HTTPException(404, f"Bilinmeyen bağlantı: {kind}") from exc

    return r


def _test_timeout(kind: str, value: Any) -> int:
    """Bağlantı testi süre sınırı (sn). Hermes yerel modelle büyük sistem istemi işler: CPU'da 9B/64K modelle tek istem
    ~4 dk sürdü (BRAINS-LIVE), 180 sn yetmiyordu. İstek değeri 30–1800 aralığına kırpılır."""
    default = 600 if kind == "hermes" else 180
    try:
        n = int(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        n = default
    return max(30, min(1800, n))


def _params_b(size: str | None) -> float:
    if not size:
        return 8.0
    import re
    m = re.search(r"([\d.]+)\s*([BM])", str(size).upper())
    if not m:
        return 8.0
    v = float(m.group(1))
    return v / 1000 if m.group(2) == "M" else v


def _wsl_localized() -> dict | None:
    """S19: WSL bilgi notu istek dilinde."""
    hint = wsl_hint()
    return {**hint, "note": translate(hint["note"])} if hint and isinstance(hint.get("note"), str) else hint
