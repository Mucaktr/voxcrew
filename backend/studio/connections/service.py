"""Tek ConnectionService (S29 /): sağlayıcı başına SÜRÜMLÜ durum, 30 sn önbellek, zorunlu yenileme,
kademeli kontrol (önce hızlı dosya/port, sonra arka planda HTTP/--version), `connection.changed` olayı.

Durum şekli (sağlayıcı başına):
  kind, name, subtitle, optional, state_version, checking, installed, install_path, version, runner_running,
  service_reachable, session_valid, models_ready, fit_for_task, last_check, last_use, timeout,
  problems:[{code, message, severity, fix:{kind: button|command|link, label, action|command|url, args}}],
  ready: ok | needs_action | unavailable | checking | soon,
  + eski alanlar (available, path, detail, warning, logged_in, default_model, models, loaded, profiles, error)

Zaman aşımı "kurulu değil" sayılmaz: önceki bilinen alanlar korunur, `timeout=True` ve kısa önbellek (5 sn).
Hermes caps/overview, gateway durumu, probe ve test SONUÇLARI bu tek kaynağı besler (`record_use`, `feed`).
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import threading
import time
import weakref
from pathlib import Path
from typing import Any, Callable

from studio.connections.hardware import HardwareCache
from studio.connections.providers import Provider, ProviderContext, default_providers
from studio.connections.providers.cli_tools import looks_like_auth_error
from studio.i18n import request_lang, translate

DEFAULT_TTL_S = 30.0
TIMEOUT_TTL_S = 5.0
FAST_STAGE_TIMEOUT_S = 6.0
SLOW_STAGE_TIMEOUT_S = 40.0
DEFAULT_WAIT_S = 2.5
RECHECK_MIN_INTERVAL_S = 4.0
# önerilen (varsayılan) beyin sırası: agents.default_connection ile aynı
DEFAULT_BRAIN_ORDER = ("ollama", "codex", "claude", "openai_compat")
# ucuz yeniden taramada "değişti mi" karşılaştırması için hızlı aşama alanları
_RECHECK_KEYS = ("installed", "install_path", "runner_running", "service_reachable", "extra")

# (tr, en) — sorun ve düzeltme metinleri; parametreler {ad} ile doldurulur
MESSAGES: dict[str, tuple[str, str]] = {
    "sub_hermes": ("Ajan çalışma zamanı (isteğe bağlı)", "Agent runtime (optional)"),
    "sub_ollama": ("Yerel ve ücretsiz modeller", "Local, free models"),
    "sub_codex": ("ChatGPT aboneliği ile Codex CLI", "Codex CLI with your ChatGPT subscription"),
    "sub_claude": ("Claude aboneliği ile Claude Code CLI", "Claude Code CLI with your Claude subscription"),
    "sub_openai_compat": ("LM Studio, llama.cpp ya da kendi anahtarınla Mistral, Claude API, Gemini, OpenRouter…",
                          "LM Studio, llama.cpp or Mistral, Claude API, Gemini, OpenRouter… with your own key"),
    "sub_gemini": ("Yakında", "Coming soon"),
    "hermes_home_wrong": ("Ayarlı Hermes klasöründe ({home}) Hermes kurulu değil; Hermes şurada bulundu: {path}. "
                          "“Bu klasörü kullan” yalnız VoxCrew ayarını değiştirir (önce önizleme ve onay); Hermes klasörüne bir şey yazılmaz.",
                          "The configured Hermes folder ({home}) has no Hermes install; Hermes was found at: {path}. "
                          "“Use this folder” only changes the VoxCrew setting (preview and confirm first); nothing is written to the Hermes folder."),
    "hermes_home_env_locked": ("Hermes klasörü HERMES_HOME ortam değişkeniyle {home} olarak ayarlı ama orada Hermes yok. Hermes şurada: "
                               "{path}. Çözmek için HERMES_HOME'u bu yola çevir ya da sil, sonra uygulamayı yeniden başlat.",
                               "The HERMES_HOME environment variable points to {home}, which has no Hermes; Hermes was found at: "
                               "{path}. To fix it, point HERMES_HOME to this path or remove it, then restart the app."),
    "hermes_runner_missing": ("Hermes veri klasörü bulundu ama `hermes` komutu bulunamadı (PATH'te değil ya da kurulum eksik).",
                              "Hermes data folder found, but the `hermes` command was not found (not on PATH or install incomplete)."),
    "hermes_pick_home": ("Birden çok Hermes klasörü adayı var; birini seç.", "Several Hermes folders found; pick one."),
    # tek, boş (Hermes kurulumu olmayan) klasör: "birden çok aday" değil, kurulu değil
    "hermes_home_empty": ("Kurulu değil — isteğe bağlı. Hermes klasörü ({home}) boş ya da Hermes kurulumu içermiyor. "
                          "Ajanlar Ollama, Codex ya da Claude Code ile doğrudan çalışır.",
                          "Not installed — optional. The Hermes folder ({home}) is empty or has no Hermes install. "
                          "Agents run directly with Ollama, Codex or Claude Code."),
    "hermes_not_installed": ("Kurulu değil — isteğe bağlı. Ajanlar Ollama, Codex ya da Claude Code ile doğrudan çalışır.",
                             "Not installed — optional. Agents run directly with Ollama, Codex or Claude Code."),
    "hermes_pm_repair": ("Hermes bağımlılık ortamı kayıtlı değil; sorun yaşarsan terminalde `hermes pm repair` çalıştır.",
                         "Hermes dependency environment is not registered; run `hermes pm repair` if you hit problems."),
    "hermes_api_off": ("API sunucusu etkin değil (isteğe bağlı: araç onayları ve anında durdurma için).",
                       "API server is not enabled (optional: tool approvals and instant stop)."),
    "hermes_gateway_stopped": ("API sunucusu hazır ama çalışmıyor.", "API server is configured but not running."),
    "ollama_not_installed": ("Ollama kurulu değil. “Kurulum rehberi”ni aç: ücretsizdir, hesap gerekmez. Kurunca bu kart kendiliğinden yenilenir.",
                             "Ollama is not installed. Open the “Install guide”: it is free and needs no account. Once installed, this card refreshes by itself."),
    "ollama_stopped": ("Ollama kurulu ama çalışmıyor ({url}).", "Ollama is installed but not running ({url})."),
    # S39: teknik olmayan kullanıcı için önce yapılacak şey, sonra ayrıntı
    "ollama_unreachable": ("Ollama'ya ulaşılamıyor ({url}). Ollama kapalı olabilir: uygulamayı başlatıp “Yeniden dene”ye bas. "
                           "Adresi kendin değiştirdiysen doğru olduğunu denetle.",
                           "Can't reach Ollama ({url}). It may be closed: start the Ollama app, then press “Retry”. "
                           "If you changed the address yourself, check that it is correct."),
    "ollama_slow": ("Ollama yanıt vermekte gecikti (bilgisayar yoğun olabilir); son bilinen durum gösteriliyor.",
                    "Ollama was slow to respond (the machine may be busy); showing the last known state."),
    "ollama_http_error": ("Ollama'ya ulaşıldı ama yanıt hatalı: {error}", "Ollama answered but the response was invalid: {error}"),
    "ollama_host_mismatch": ("OLLAMA_HOST ({env_url}) uygulamanın adresinden ({url}) farklı.", "OLLAMA_HOST ({env_url}) differs from the studio address ({url})."),
    "ollama_no_models": ("Henüz model yok. Donanımına uygun bir model indirelim.", "No models yet. Let's download one that fits your hardware."),
    "ollama_no_tools_model": ("Araç kullanabilen model yok; ajanlar için araç destekli bir model öneririz.",
                              "No tool-capable model; we recommend one with tool support for agents."),
    "codex_not_installed": ("Codex bu bilgisayarda bulunamadı. “Kurulum rehberi”ni aç (resmî komut: {command}) ya da Codex "
                            "uygulamasını kur; ChatGPT hesabı gerekir. Kurunca bu kart kendiliğinden yenilenir.",
                            "Codex was not found on this computer. Open the “Install guide” (official command: {command}) or "
                            "install the Codex app; a ChatGPT account is needed. Once installed, this card refreshes by itself."),
    "codex_app_no_cli": ("Codex uygulaması ya da oturumu bulundu ama komut satırı aracı (codex CLI) yok. Codex uygulamasını bir kez "
                         "açıp kapat (paketlediği CLI'yi açar) ya da CLI'yi kur: {command}",
                         "The Codex app or a Codex sign-in was found, but not the command-line tool (codex CLI). Open the Codex "
                         "app once (it unpacks its bundled CLI) or install the CLI: {command}"),
    "cli_not_on_path": ("{name} PATH'te değil ama şurada bulundu: {path}. Uygulama bu yolu doğrudan kullanır; terminalde `{cmd}` "
                        "yazmak için bu klasörü PATH'e ekle.",
                        "{name} is not on PATH but was found at: {path}. The studio uses this path directly; to type `{cmd}` "
                        "in a terminal, add its folder to PATH."),
    "claude_not_installed": ("Claude Code bu bilgisayarda bulunamadı. “Kurulum rehberi”ni aç (resmî komut: {command}); ücretli "
                             "bir Claude planı ya da API hesabı gerekir. Kurunca bu kart kendiliğinden yenilenir.",
                             "Claude Code was not found on this computer. Open the “Install guide” (official command: {command}); "
                             "it needs a paid Claude plan or an API account. Once installed, this card refreshes by itself."),
    "codex_login_needed": ("Giriş gerekli — ChatGPT hesabınla terminalde oturum aç.", "Sign-in needed — log in with your ChatGPT account in the terminal."),
    "claude_login_needed": ("Giriş gerekli — Claude hesabınla terminalde oturum aç.", "Sign-in needed — log in with your Claude account in the terminal."),
    "codex_session_expired": ("Oturum geçersiz ya da süresi dolmuş; yeniden giriş yap.", "Session invalid or expired; sign in again."),
    "claude_session_expired": ("Oturum süresi dolmuş (OAuth); yeniden giriş yap.", "Session expired (OAuth); sign in again."),
    "codex_session_unknown": ("Oturum durumu ilk görevde anlaşılır; istersen şimdi test et.", "Session state is known after the first task; test it now if you like."),
    "claude_session_unknown": ("Oturum anahtar zincirinde; durum ilk görevde anlaşılır.", "Session lives in the keychain; state is known after the first task."),
    "compat_found": ("{label} çalışıyor gibi görünüyor; bağlayalım mı?", "{label} seems to be running; connect it?"),
    "compat_unconfigured": ("İsteğe bağlı: LM Studio gibi yerel bir sunucu ya da kendi anahtarınla bir API ekle.",
                            "Optional: add a local server such as LM Studio or an API with your own key."),
    "compat_stopped": ("{label} şu an yanıt vermiyor.", "{label} is not answering right now."),
    "compat_key_rejected": ("Sunucu anahtarı reddetti (401/403).", "The server rejected the key (401/403)."),
    "compat_key_missing": ("{label} için API anahtarı gerekli.", "{label} needs an API key."),
    "compat_http_error": ("Sunucuya ulaşılamadı: {error}", "Could not reach the server: {error}"),
    "compat_pick_model": ("Varsayılan model seçilmedi.", "No default model chosen."),
    "compat_untested": ("{label} yanıt veriyor ama henüz test edilmedi. Ajanlara vermeden önce bir kez test et.",
                        "{label} answers but has not been tested yet. Run one test before giving it to agents."),
    "compat_default_failed": ("{label} son testte başarısız oldu ({error}). Adresi ve modeli kontrol edip yeniden test et.",
                              "{label} failed its last test ({error}). Check the address and model, then test again."),
    "gemini_soon": ("Gemini CLI algılandı; bağlayıcı yakında.", "Gemini CLI detected; connector coming soon."),
    "gemini_soon_absent": ("Gemini CLI desteği yakında.", "Gemini CLI support is coming soon."),
    "fix_use_folder": ("Bu klasörü kullan", "Use this folder"),
    "fix_pick_folder": ("Klasör seç", "Pick folder"),
    "fix_install_guide": ("Kurulum rehberi", "Install guide"),
    "fix_run_command": ("Komutu kopyala", "Copy command"),
    "fix_copy_path": ("Yolu kopyala", "Copy path"),
    "fix_enable_api": ("API sunucusunu etkinleştir", "Enable API server"),
    "fix_start_gateway": ("API sunucusunu başlat", "Start API server"),
    "fix_start_ollama": ("Ollama'yı başlat", "Start Ollama"),
    "fix_retry": ("Yeniden dene", "Retry"),
    "fix_pull_model": ("Model indir", "Download a model"),
    "fix_login": ("Giriş yap", "Sign in"),
    "fix_test": ("Test et", "Test"),
    "fix_use_server": ("Bağla", "Connect"),
    "fix_configure": ("Ayarla", "Configure"),
    "fit_ok": ("Ajan görevleri için hazır", "Ready for agent tasks"),
    "fit_ollama_cpu": ("Yerel model: ücretsiz, CPU'da yavaş olabilir", "Local model: free, may be slow on CPU"),
    "fit_hermes_ready": ("Hermes için uzun bağlamlı model var", "Has a long-context model for Hermes"),
    "fit_hermes_short": ("Hermes için uzun bağlamlı model yok (32K+ önerilir)", "No long-context model for Hermes (32K+ recommended)"),
    "fit_sub": ("Abonelik: güçlü model, küçük istemler ücretsiz değil", "Subscription: strong model; prompts count against your plan"),
    "fit_soon": ("Henüz kullanılamaz", "Not usable yet"),
    "fit_optional": ("İsteğe bağlı", "Optional"),
    "fit_unavailable": ("Kurulum gerekiyor", "Needs installation"),
}


# Eski arayüz (kenar çubuğu HealthDots, BrainPicker, onboarding) yalnızca bu türleri tanır; yeni türler (openai_compat,
# gemini) `?all=true` ile gelir. openai_compat ajan beyni olarak seçilebilir olunca (agents.py rotası) buraya eklenir.
LEGACY_KINDS = ("hermes", "ollama", "codex", "claude")


def legacy_visible(c: dict[str, Any]) -> bool:
    return c["kind"] in LEGACY_KINDS


def msg(key: str | None, params: dict[str, Any] | None = None, lang: str | None = None) -> str:
    if not key:
        return ""
    pair = MESSAGES.get(key)
    if not pair:
        return key
    text = pair[1] if (lang or request_lang()) == "en" else pair[0]
    try:
        return text.format(**{k: ("" if v is None else v) for k, v in (params or {}).items()})
    except (KeyError, IndexError):
        return text


def _localized_extra(extra: dict[str, Any], lang: str) -> dict[str, Any]:
    """S19: `extra` içindeki iç içe `note` metinlerini (ör. WSL bilgisi) istek diline çevirir; TR'de aynen döner."""
    if lang != "en":
        return extra
    out: dict[str, Any] = {}
    for k, v in extra.items():
        if isinstance(v, dict) and isinstance(v.get("note"), str):
            v = {**v, "note": translate(v["note"], lang)}
        out[k] = v
    return out


def _localized_endpoint(ep: dict[str, Any], lang: str) -> dict[str, Any]:
    """S37: uç nokta sorunları (endpoints.TEXTS kodları) ve düzeltme etiketleri istek dilinde."""
    from studio.connections.endpoints import text as ep_text  # noqa: PLC0415

    probs = []
    for q in ep.get("problems") or []:
        fix = q.get("fix")
        if fix:
            fix = {**fix, "label": msg(fix.get("label"), lang=lang)}
        probs.append({"code": q["code"], "severity": q.get("severity", "block"), "params": q.get("params") or {},
                      "message": ep_text(q["code"], lang, **(q.get("params") or {})), "fix": fix})
    return {**ep, "problems": probs}


# sorun türetmesinin (problems()) duruma eklediği alanlar: "değişti mi" karşılaştırmasına girmez
_DERIVED_KEYS = frozenset({"problems", "ready", "models_live", "last_use"})


def _fingerprint(value: Any) -> str:
    """Ucuz yeniden taramada hızlı aşama sonucunun karşılaştırma izi (türetilmiş alanlar hariç, sıra bağımsız)."""
    def norm(v: Any) -> Any:
        if isinstance(v, dict):
            return {k: norm(x) for k, x in v.items() if k not in _DERIVED_KEYS}
        if isinstance(v, (list, tuple)):
            return [norm(x) for x in v]
        return v
    return json.dumps(norm(value), sort_keys=True, default=str)


def _auth_flag(ok: bool, error: str | None) -> bool | None:
    if ok:
        return True
    return False if looks_like_auth_error(error) else None


class ConnectionService:
    def __init__(self, settings: Any, *, providers: list[Provider] | None = None, ttl: float = DEFAULT_TTL_S,
                 context: ProviderContext | None = None, wait_s: float = DEFAULT_WAIT_S):
        self.settings = settings
        self.ttl = ttl
        self.wait_s = wait_s
        self.providers: dict[str, Provider] = {p.kind: p for p in (providers or default_providers())}
        self.ctx = context or ProviderContext(settings=settings)
        if self.ctx.hardware is None:
            self.ctx.hardware = HardwareCache()
        self.states: dict[str, dict[str, Any]] = {}
        self.last_use: dict[str, dict[str, Any]] = {}
        self._version = 0
        self._fast_ts = 0.0
        self._lock: asyncio.Lock | None = None
        self._slow_task: asyncio.Task[None] | None = None
        self._gen = 0  # yenileme nesli: eski yavaş sonuç yeni hızlı sonucu ezmez
        self._recheck_ts = 0.0
        self._recheck_slow: set[asyncio.Task[None]] = set()
        self._tlock = threading.Lock()
        self.bus: Any = None
        self.on_change: list[Callable[[str, dict[str, Any]], None]] = []

    # ------------------------------------------------------------------ bağlama
    def attach(self, *, bus: Any = None, gateway: Any = None, secrets: Any = None, ollama_runner: Any = None) -> None:
        if bus is not None:
            self.bus = bus
        if gateway is not None:
            self.ctx.gateway = gateway
        if secrets is not None:
            self.ctx.secrets = secrets
        if ollama_runner is not None:
            self.ctx.ollama_runner = ollama_runner

    def _loop_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    # ------------------------------------------------------------------ dışa açık
    @property
    def order(self) -> list[str]:
        return [p.kind for p in sorted(self.providers.values(), key=lambda p: p.order)]

    def snapshot(self, kind: str) -> dict[str, Any] | None:
        st = self.states.get(kind)
        return self.public(kind) if st else None

    def all_public(self) -> list[dict[str, Any]]:
        return [self.public(k) for k in self.order if k in self.states]

    def summary(self) -> dict[str, Any]:
        items = self.all_public()
        ready = [c["kind"] for c in items if c["ready"] == "ok" and c["kind"] not in ("hermes", "gemini")]
        # önerilen beyin: AgentRegistry.default_connection ile aynı sıra, ama HAZIR olanlar arasından (SETUP)
        default = next((k for k in DEFAULT_BRAIN_ORDER if k in ready), None)
        return {"brains_ready": ready, "any_brain": bool(ready), "checking": any(c["checking"] for c in items),
                "default_brain": default, "version": self._version}

    async def list(self, force: bool = False, wait_s: float | None = None, include_all: bool = True) -> list[dict[str, Any]]:
        await self.refresh(force=force, wait_s=self.wait_s if wait_s is None else wait_s)
        items = self.all_public()
        return items if include_all else [c for c in items if legacy_visible(c)]

    async def get(self, kind: str, force: bool = False) -> dict[str, Any]:
        await self.refresh(force=force)
        if kind not in self.states:
            raise KeyError(kind)
        return self.public(kind)

    def invalidate(self, kind: str | None = None) -> None:
        """Bir eylemden sonra (Ollama başlatıldı, model indirildi, hermes_home değişti) sonraki okuma yeniden tarar."""
        self._fast_ts = 0.0
        if kind and kind in self.states:
            self.states[kind]["stale"] = True

    def record_use(self, kind: str, ok: bool, error: str | None = None) -> None:
        """Gerçek çalıştırma / test sonucu → oturum geçerliliği (dosya varlığı ≠ oturum)."""
        now = time.time()
        self.last_use[kind] = {"ok": ok, "error": (error or "")[:300] or None, "ts": now}
        st = self.states.get(kind)
        if st is None:
            return
        st["last_use"] = self.last_use[kind]
        multi = kind == "openai_compat" and len((st.get("extra") or {}).get("endpoints") or []) > 1
        if kind in ("codex", "claude", "openai_compat") and not multi:
            # S37: motor yalnızca türü bildirir; birden çok API bağlantısında hangisinin başarısız olduğu bilinmez
            flag = _auth_flag(ok, error)
            if flag is not None:
                st["session_valid"] = flag
        elif kind == "ollama" and ok:
            st["service_reachable"] = True
            st["runner_running"] = True
            st["timeout"] = False
        self._finalize(kind)

    def record_endpoint_use(self, eid: str, ok: bool, error: str | None = None) -> None:
        """S37: bir API bağlantısının (uç nokta) gerçek test/çalıştırma sonucu → o uç noktanın oturum bayrağı."""
        st = self.states.get("openai_compat")
        if st is None:
            return
        status = st.setdefault("endpoint_status", {})
        cur = dict(status.get(eid) or {})
        cur["last_use"] = {"ok": ok, "error": (error or "")[:300] or None, "ts": time.time()}
        flag = _auth_flag(ok, error)
        if flag is not None:
            cur["session_valid"] = flag
        if ok:
            cur["reachable"] = True
        status[eid] = cur
        if eid == ((st.get("extra") or {}).get("default_endpoint")):
            self.record_use("openai_compat", ok, error)
            return
        self._finalize("openai_compat")

    def feed(self, kind: str, **fields: Any) -> None:
        """Dış kaynak (gateway durumu, hermes overview) alan besler; sürüm artar, olay yayınlanır."""
        st = self.states.get(kind)
        if st is None:
            return
        st.update(fields)
        self._finalize(kind)

    # ------------------------------------------------------------------ yenileme
    def _ttl_now(self) -> float:
        return TIMEOUT_TTL_S if any(s.get("timeout") for s in self.states.values()) else self.ttl

    def _stale(self) -> bool:
        return (not self.states or time.monotonic() - self._fast_ts > self._ttl_now()
                or any(s.get("stale") for s in self.states.values()))

    async def refresh(self, force: bool = False, wait_s: float = 0.0) -> None:
        async with self._loop_lock():
            if force or self._stale():
                self._gen += 1
                gen = self._gen
                await self._run_fast(gen)
                if self._slow_task and not self._slow_task.done():
                    self._slow_task.cancel()
                self._slow_task = asyncio.create_task(self._run_slow(gen))
        if wait_s > 0 and self._slow_task and not self._slow_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(self._slow_task), wait_s)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass

    async def recheck(self, wait_s: float = 0.0, *, min_interval: float = RECHECK_MIN_INTERVAL_S) -> dict[str, Any]:
        """UCUZ yeniden tarama (pencereye dönüş, periyodik, kurulum rehberindeki "Tekrar kontrol et"; SETUP).

        Yalnızca HAZIR OLMAYAN sağlayıcıların hızlı aşaması koşar (dosya varlığı, yerel port; süreç başlatılmaz,
        `--version` çalıştırılmaz). Yavaş aşama (HTTP, sürüm) yalnızca hızlı alanları DEĞİŞEN sağlayıcı için ve çalışan
        ama modelsiz Ollama için koşar (model indirildi mi). Hiçbir şey değişmediyse sürüm artmaz, olay yayınlanmaz.
        Kısa aralıkla gelen çağrılar (`min_interval`) tarama yapmadan son durumu döner. Henüz durum yoksa tam tarama yapar.
        """
        if not self.states:
            await self.refresh(wait_s=wait_s)
            return {"checked": list(self.order), "changed": list(self.order), "full": True, "throttled": False}
        if time.monotonic() - self._recheck_ts < min_interval:
            return {"checked": [], "changed": [], "full": False, "throttled": True}
        async with self._loop_lock():
            self._recheck_ts = time.monotonic()
            gen = self._gen
            targets = [p for p in self.providers.values() if (self.states.get(p.kind) or {}).get("ready") != "ok"]

            async def one(p: Provider) -> tuple[Provider, dict[str, Any] | None]:
                try:
                    return p, await asyncio.wait_for(asyncio.to_thread(p.fast, self._ctx_for(p.kind)), FAST_STAGE_TIMEOUT_S)
                except Exception:  # noqa: BLE001 - zaman aşımı ya da hata: ucuz taramada önceki durum korunur
                    return p, None

            results = await asyncio.gather(*(one(p) for p in targets))
            if gen != self._gen:
                return {"checked": [], "changed": [], "full": False, "throttled": False}
            now = time.time()
            changed: list[str] = []
            slow: list[Provider] = []
            for p, res in results:
                prev = self.states.get(p.kind) or {}
                if res is None:
                    continue
                before = _fingerprint({k: prev.get(k) for k in _RECHECK_KEYS})
                after = _fingerprint({k: res.get(k) for k in _RECHECK_KEYS})
                mr = prev.get("models_ready") or {}
                ollama_waiting = p.kind == "ollama" and res.get("runner_running") and not mr.get("count")
                if before == after and not ollama_waiting:
                    prev["last_check"] = now  # sessiz: sürüm artmaz
                    continue
                if before != after:
                    changed.append(p.kind)
                    st = {**prev, **res, "kind": p.kind, "last_check": now, "checking": True, "stale": False,
                          "timeout": False, "last_use": self.last_use.get(p.kind)}
                    self.states[p.kind] = st
                    self._finalize(p.kind)
                slow.append(p)
            if slow:
                task = asyncio.create_task(self._run_slow_for(gen, slow))
                self._recheck_slow.add(task)
                task.add_done_callback(self._recheck_slow.discard)
        if wait_s > 0 and self._recheck_slow:
            try:
                await asyncio.wait_for(asyncio.shield(asyncio.gather(*self._recheck_slow)), wait_s)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
        return {"checked": [p.kind for p in targets], "changed": changed, "full": False, "throttled": False}

    async def _run_slow_for(self, gen: int, providers: list[Provider]) -> None:
        """Yalnızca verilen sağlayıcılar için yavaş aşama (ucuz yeniden taramanın devamı). Bu arada tam yenileme
        başladıysa (nesil değiştiyse) sonuç atılır."""
        async def one(p: Provider) -> None:
            st = self.states.get(p.kind) or {}
            try:
                res = await asyncio.wait_for(p.slow(self._ctx_for(p.kind), st), SLOW_STAGE_TIMEOUT_S)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                res = {}
            if gen != self._gen or p.kind not in self.states:
                return
            res.setdefault("timeout", False)
            before = self.states[p.kind].get("models_ready")
            self.states[p.kind].update(res)
            was_checking = self.states[p.kind].get("checking")
            self.states[p.kind]["checking"] = False
            if was_checking or res.get("models_ready") != before:
                self._finalize(p.kind)

        await asyncio.gather(*(one(p) for p in providers), return_exceptions=True)

    def _ctx_for(self, kind: str) -> ProviderContext:
        # Sağlayıcı başına AYRI bağlam: kontroller eşzamanlı koşar; ortak nesneyi değiştirmek bir sağlayıcının başka
        # sağlayıcının önceki durumunu / son kullanımını okumasına yol açıyordu (QA-F56).
        return dataclasses.replace(self.ctx, previous=dict(self.states.get(kind) or {}), last_use=self.last_use.get(kind))

    async def _run_fast(self, gen: int) -> None:
        async def one(p: Provider) -> tuple[str, dict[str, Any]]:
            ctx = self._ctx_for(p.kind)
            try:
                res = await asyncio.wait_for(asyncio.to_thread(p.fast, ctx), FAST_STAGE_TIMEOUT_S)
            except asyncio.TimeoutError:
                res = {"timeout": True}
            except Exception as exc:  # noqa: BLE001 - bir sağlayıcı diğerlerini düşürmesin
                res = {"error": str(exc)[:200]}
            return p.kind, res

        results = await asyncio.gather(*(one(p) for p in self.providers.values()))
        if gen != self._gen:
            return
        now = time.time()
        for kind, res in results:
            prev = self.states.get(kind) or {}
            st = {**prev, **res, "kind": kind, "last_check": now, "checking": True, "stale": False}
            st.setdefault("timeout", False)
            if res.get("timeout") and prev:
                st["timeout"] = True
            # yavaş aşama sonucu bekleniyor: önceki yavaş alanlar (sürüm, model listesi) korunur
            st["last_use"] = self.last_use.get(kind)
            self.states[kind] = st
            self._finalize(kind, publish=False)
        self._fast_ts = time.monotonic()

    async def _run_slow(self, gen: int) -> None:
        async def one(p: Provider) -> None:
            fast = self.states.get(p.kind) or {}
            ctx = self._ctx_for(p.kind)
            try:
                res = await asyncio.wait_for(p.slow(ctx, fast), SLOW_STAGE_TIMEOUT_S)
            except asyncio.TimeoutError:
                res = {"timeout": True}
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                res = {"error": str(exc)[:200]}
            if gen != self._gen:
                return
            st = self.states.get(p.kind)
            if st is None:
                return
            if "timeout" not in res:
                res["timeout"] = False
            st.update(res)
            st["checking"] = False
            self._finalize(p.kind)

        await asyncio.gather(*(one(p) for p in self.providers.values()), return_exceptions=True)

    # ------------------------------------------------------------------ türetme + yayın
    def _finalize(self, kind: str, publish: bool = True) -> None:
        st = self.states[kind]
        p = self.providers[kind]
        try:
            st["problems"] = p.problems(st, self.ctx)
        except Exception as exc:  # noqa: BLE001
            st["problems"] = [{"code": "internal", "params": {"error": str(exc)[:120]}, "fix": None, "severity": "block"}]
        st["ready"] = self._ready(kind, st)
        st["fit_for_task"] = self._fit(kind, st)
        with self._tlock:
            self._version += 1
            st["state_version"] = self._version
        if publish:
            pub = self.public(kind)
            for cb in self.on_change:
                try:
                    cb(kind, pub)
                except Exception:  # noqa: BLE001
                    pass
            if self.bus is not None:
                try:
                    self.bus.publish("connection.changed", kind=kind, state=pub, summary=self.summary())
                except Exception:  # noqa: BLE001
                    pass

    @staticmethod
    def _ready(kind: str, st: dict[str, Any]) -> str:
        if kind == "gemini":
            return "soon"
        blocking = [q for q in st.get("problems", []) if q.get("severity") == "block"]
        if not st.get("installed"):
            if st.get("checking") and st.get("installed") is None:
                return "checking"
            return "needs_action" if any(q.get("fix") for q in blocking) else "unavailable"
        if blocking:
            return "needs_action"
        if st.get("checking") and kind in ("ollama", "openai_compat") and st.get("models_ready") is None:
            return "checking"
        return "ok"

    @staticmethod
    def _fit(kind: str, st: dict[str, Any]) -> str:
        if kind == "gemini":
            return "fit_soon"
        if not st.get("installed"):
            return "fit_optional" if kind in ("hermes", "openai_compat") else "fit_unavailable"
        if kind == "ollama":
            mr = st.get("models_ready") or {}
            if mr.get("hermes_ready"):
                return "fit_hermes_ready"
            if mr.get("count"):
                return "fit_ollama_cpu"
            return "fit_hermes_short" if mr else "fit_ollama_cpu"
        if kind in ("codex", "claude"):
            return "fit_sub"
        return "fit_ok"

    def public(self, kind: str) -> dict[str, Any]:
        st = self.states[kind]
        p = self.providers[kind]
        lang = request_lang()
        problems = []
        for q in st.get("problems", []):
            fix = q.get("fix")
            if fix:
                fix = {**fix, "label": msg(fix.get("label"), lang=lang)}
            problems.append({"code": q["code"], "severity": q.get("severity", "block"), "params": q.get("params") or {},
                             "message": msg(q["code"], q.get("params"), lang), "fix": fix})
        legacy = p.legacy(st)
        extra = _localized_extra(st.get("extra") or {}, lang)
        if kind == "openai_compat" and extra.get("endpoints"):
            extra = {**extra, "endpoints": [_localized_endpoint(e, lang) for e in extra["endpoints"]]}
        detail = legacy.get("detail") or (problems[0]["message"] if problems else None)
        out: dict[str, Any] = {
            "kind": kind, "name": translate(p.name, lang), "subtitle": msg(p.subtitle_key, lang=lang), "optional": p.optional,
            "state_version": st.get("state_version", 0), "checking": bool(st.get("checking")),
            "installed": st.get("installed"), "install_path": st.get("install_path"), "version": st.get("version"),
            "runner_running": st.get("runner_running"), "service_reachable": st.get("service_reachable"),
            "session_valid": st.get("session_valid"), "models_ready": st.get("models_ready"),
            "fit_for_task": msg(st.get("fit_for_task"), lang=lang), "last_check": st.get("last_check"),
            "last_use": st.get("last_use"), "timeout": bool(st.get("timeout")), "problems": problems,
            "ready": st.get("ready", "checking"), "extra": extra,
            # eski alanlar
            "available": bool(legacy.get("available")), "path": legacy.get("path"), "detail": detail,
            "warning": legacy.get("warning"), "error": legacy.get("error") or st.get("error"),
        }
        for k in ("logged_in", "default_model", "models", "loaded", "profiles", "optional"):
            if k in legacy:
                out[k] = legacy[k]
        if "extra_gateway" in st:
            out["gateway"] = st["extra_gateway"]
        return out


# ---------------------------------------------------------------------- ayar başına tek örnek
# Zayıf anahtar: Settings nesnesi gidince servisi de bırak (id() yeniden kullanımıyla eski durum sızmasın — testler).
_INSTANCES: "weakref.WeakKeyDictionary[Any, ConnectionService]" = weakref.WeakKeyDictionary()
_INSTANCES_LOCK = threading.Lock()


def service_for(settings: Any, ttl: float = DEFAULT_TTL_S) -> ConnectionService:
    with _INSTANCES_LOCK:
        svc = _INSTANCES.get(settings)
        if svc is None:
            svc = ConnectionService(settings, ttl=ttl)
            _INSTANCES[settings] = svc
        return svc


def data_dir_of(studio: Any) -> Path:
    return Path(getattr(getattr(studio, "changes", None), "data_dir", None) or Path(studio.settings.path).parent)
