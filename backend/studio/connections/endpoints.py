"""Adlandırılmış model API bağlantıları (S37 ·…): aynı anda birden çok OpenAI uyumlu uç nokta
(LM Studio, Mistral, OpenRouter…) ve Anthropic Messages API — hepsi "kendi anahtarınla" (hesap aracılığı yok).

Ayar: `connections.openai_compat.endpoints` (liste) + `default_endpoint` (kimlik). Her uç nokta:
  {id, label, preset, api: openai|anthropic, base_url, model, models: [...], enabled}
Anahtar ASLA ayara yazılmaz: SecretStore'da `secret_name(id)` adıyla (maskeli döner).

Geriye uyum (kayıpsız taşıma): eski tek blok (`connections.openai_compat.{base_url,label,model}` + `openai_compat.api_key`)
`id="default"` uç noktası olur; anahtarı aynı ad altında kalır (veri taşınmaz, kopyalanmaz). Eski alanlar varsayılan
uç noktanın YANSISI olarak güncel tutulur (eski okuyucular, ör. motorun yerel-maliyet denetimi, çalışmayı sürdürür).

Ajan/görev başvurusu: `model` alanı `"<uç nokta kimliği>::<model>"` biçiminde olabilir (`model_ref`); kimliksiz değer
varsayılan uç noktayı kullanır. Böylece görev penceresinin `connection` + `model` geçersiz kılması değişmeden çalışır.
"""

from __future__ import annotations

import ipaddress
import re
from typing import Any
from urllib.parse import urlsplit

from studio.connections.secrets import display_path

LEGACY_ID = "default"
LEGACY_SECRET = "openai_compat.api_key"
REF_SEP = "::"
APIS = ("openai", "anthropic")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
MAX_ENDPOINTS = 24
ANTHROPIC_VERSION = "2023-06-01"

# ---------------------------------------------------------------------- ön ayar kataloğu
# Adresler resmî belgelerden doğrulandı; kaynak + tarih:. `stream_usage`: akışta
# jeton kullanımı için `stream_options.include_usage` gönderilir (belgede destekleniyorsa). `key`: required | optional |
# none. `supported: False` olan ön ayar listede "henüz desteklenmiyor" diye görünür, eklenemez.
VERIFIED_ON = "2026-10-17"
# Araç çağrısı: "yes" = sağlayıcı belgesinde function calling var; "try" = sunucu bayrağına ya da modele bağlı
# (vLLM --enable-auto-tool-choice, llama-server --jinja, OpenRouter/Together'da modele göre) — araçlar gönderilir,
# sunucu reddederse (400/404/422) o adım araçsız sürer ve açık bir not düşülür; "no" = gönderilmez. Kullanıcı uç nokta
# başına kapatabilir (`tools: false`). Araçlar yalnızca ajana MCP sunucusu atanmışsa sunulur (studio.tools.loop).
TOOL_MODES = ("yes", "try", "no")
PRESETS: list[dict[str, Any]] = [
    # --- yerel (ücretsiz, veri bu bilgisayarda kalır)
    {"id": "lmstudio", "tools": "yes", "label": "LM Studio", "group": "local", "api": "openai", "base_url": "http://127.0.0.1:1234/v1",
     "key": "none", "stream_usage": False, "docs": "https://lmstudio.ai/docs/developer/openai-compat"},
    # llama-server varsayılan portu güncel sürümde 9931 (eski sürümler ve Docker örnekleri 8080; keşif ikisine de bakar)
    {"id": "llamacpp", "tools": "try", "label": "llama.cpp server", "group": "local", "api": "openai", "base_url": "http://127.0.0.1:9931/v1",
     "key": "optional", "stream_usage": False, "note": "note_llamacpp",
     "docs": "https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md"},
    {"id": "vllm", "tools": "try", "label": "vLLM", "group": "local", "api": "openai", "base_url": "http://127.0.0.1:8000/v1",
     "key": "optional", "stream_usage": False,
     "docs": "https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/"},
    {"id": "jan", "tools": "try", "label": "Jan", "group": "local", "api": "openai", "base_url": "http://127.0.0.1:1337/v1",
     "key": "optional", "stream_usage": False, "docs": "https://docs.jan.ai/desktop/api-server"},
    # --- bulut (kendi anahtarınla; veri bu bilgisayardan çıkar)
    # Mistral şeması bilinmeyen alanı reddeder (additionalProperties: false) → stream_options GÖNDERİLMEZ.
    {"id": "mistral", "tools": "yes", "label": "Mistral AI", "group": "cloud", "api": "openai", "base_url": "https://api.mistral.ai/v1",
     "key": "required", "stream_usage": False, "key_url": "https://console.mistral.ai/home?profile_dialog=api-keys",
     "docs": "https://docs.mistral.ai/api/", "note": "note_mistral"},
    {"id": "anthropic", "tools": "yes", "label": "Anthropic (Claude API)", "group": "cloud", "api": "anthropic",
     "base_url": "https://api.anthropic.com/v1", "key": "required", "stream_usage": False,
     "key_url": "https://platform.claude.com/",
     "docs": "https://platform.claude.com/docs/en/about-claude/models/overview", "note": "note_anthropic",
     # yalnızca öneri; asıl liste GET /v1/models'tan gelir (kaynak: modeller sayfası, 2026-10-17)
     "suggested_models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]},
    {"id": "gemini", "tools": "yes", "label": "Google Gemini", "group": "cloud", "api": "openai",
     "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "key": "required", "stream_usage": True,
     "key_url": "https://aistudio.google.com/apikey", "docs": "https://ai.google.dev/gemini-api/docs/openai",
     "note": "note_gemini"},
    # OpenRouter kullanımı ve maliyeti (usage.cost, USD tabanlı kredi) her zaman son akış iletisinde döner
    {"id": "openrouter", "tools": "try", "label": "OpenRouter", "group": "cloud", "api": "openai", "base_url": "https://openrouter.ai/api/v1",
     "key": "required", "stream_usage": False, "key_url": "https://openrouter.ai/settings/keys",
     "docs": "https://openrouter.ai/docs/use-cases/usage-accounting", "note": "note_openrouter"},
    {"id": "groq", "tools": "yes", "label": "Groq", "group": "cloud", "api": "openai", "base_url": "https://api.groq.com/openai/v1",
     "key": "required", "stream_usage": True, "key_url": "https://console.groq.com/keys",
     "docs": "https://console.groq.com/docs/openai"},
    # DeepSeek: belgedeki adres /v1'siz; son akış parçası kullanımı varsayılan olarak taşır
    {"id": "deepseek", "tools": "yes", "label": "DeepSeek", "group": "cloud", "api": "openai", "base_url": "https://api.deepseek.com",
     "key": "required", "stream_usage": False, "key_url": "https://platform.deepseek.com/api_keys",
     "docs": "https://api-docs.deepseek.com/"},
    {"id": "together", "tools": "try", "label": "Together AI", "group": "cloud", "api": "openai", "base_url": "https://api.together.ai/v1",
     "key": "required", "stream_usage": False, "key_url": "https://api.together.ai/settings/projects/~current/api-keys",
     "docs": "https://docs.together.ai/docs/openai-api-compatibility"},
    {"id": "xai", "tools": "yes", "label": "xAI (Grok)", "group": "cloud", "api": "openai", "base_url": "https://api.x.ai/v1",
     "key": "required", "stream_usage": True, "key_url": "https://console.x.ai/team/default/api-keys",
     "docs": "https://docs.x.ai/developers/rest-api-reference/inference/chat-completions"},
    {"id": "cerebras", "tools": "yes", "label": "Cerebras", "group": "cloud", "api": "openai", "base_url": "https://api.cerebras.ai/v1",
     "key": "required", "stream_usage": False, "key_url": "https://cloud.cerebras.ai",
     "docs": "https://inference-docs.cerebras.ai/resources/openai"},
    {"id": "openai", "tools": "yes", "label": "OpenAI", "group": "cloud", "api": "openai", "base_url": "https://api.openai.com/v1",
     "key": "required", "stream_usage": True, "key_url": "https://platform.openai.com/settings/organization/api-keys",
     "docs": "https://developers.openai.com/api/reference/overview"},
    {"id": "azure", "tools": "no", "label": "Azure OpenAI", "group": "cloud", "api": "openai", "base_url": "", "key": "required",
     "supported": False, "docs": "https://learn.microsoft.com/en-us/azure/ai-foundry/openai/api-version-lifecycle",
     "note": "note_azure"},
]

# (tr, en) — ön ayar notları ve uç nokta sorunları (ConnectionService.public dile çevirir)
TEXTS: dict[str, tuple[str, str]] = {
    "note_mistral": ("Codestral (codestral-latest) da aynı adres ve anahtarla kullanılır.",
                     "Codestral (codestral-latest) works with the same address and key."),
    "note_llamacpp": ("Güncel llama-server 9931 portunu kullanır; eski sürümlerde 8080'dir (adresi düzeltebilirsin).",
                      "Current llama-server listens on port 9931; older builds use 8080 (you can edit the address)."),
    "note_anthropic": ("Claude API kendi anahtarınla, kullandıkça ödenir; Claude aboneliğinden (Claude Code) ayrı faturalanır.",
                       "Claude API with your own key, pay as you go; billed separately from a Claude subscription (Claude Code)."),
    "note_gemini": ("Google'ın OpenAI uyumlu adresi. Gemini CLI algılaması ayrıca sürer.",
                    "Google's OpenAI-compatible address. Gemini CLI detection stays separate."),
    "note_openrouter": ("Tek anahtarla birçok sağlayıcının modeli; maliyet yanıtla birlikte ölçülür.",
                        "Many providers' models with one key; cost is measured from the response."),
    "note_azure": ("Henüz desteklenmiyor: Azure kaynak adına özel adres, dağıtım adı ve api-key başlığı ister; doğrulanmadan bozuk bir ön ayar sunmuyoruz.",
                   "Not supported yet: Azure needs a per-resource address, a deployment name and an api-key header; we don't ship an unverified preset."),
    "group_local": ("Bu bilgisayarda (ücretsiz)", "On this computer (free)"),
    "group_cloud": ("Bulut API (kendi anahtarınla)", "Cloud API (your own key)"),
    "ep_ok": ("Hazır", "Ready"),
    "tools_rejected": ("{label} araç çağrısını kabul etmedi ({status}); bu adım araçsız sürdü. Sunucu/model araç "
                       "desteklemiyorsa bağlantı ayarından araçları kapat.",
                       "{label} did not accept tool calling ({status}); this step continued without tools. If the "
                       "server/model has no tool support, turn tools off in the connection settings."),
    "tools_off": ("{label} için araç çağrısı kapalı; ajanın MCP araçları bu adımda sunulmadı.",
                  "Tool calling is off for {label}; the agent's MCP tools were not offered in this step."),
    "ep_stopped": ("{label} şu an yanıt vermiyor.", "{label} is not answering right now."),
    "ep_key_missing": ("{label} için API anahtarı gerekli.", "{label} needs an API key."),
    "ep_key_rejected": ("{label} anahtarı reddetti (401/403): anahtar geçersiz ya da süresi dolmuş.",
                        "{label} rejected the key (401/403): the key is invalid or expired."),
    "ep_http_error": ("{label} adresine ulaşılamadı: {error}", "Could not reach {label}: {error}"),
    "ep_pick_model": ("{label} için varsayılan model seçilmedi.", "No default model chosen for {label}."),
    "ep_test_failed": ("{label} son testte başarısız oldu ({error}). Adresi ve modeli kontrol edip yeniden test et.",
                       "{label} failed its last test ({error}). Check the address and model, then test again."),
    "ep_untested": ("{label} yanıt veriyor ama henüz test edilmedi. Bir kez test et.",
                    "{label} answers but has not been tested yet. Run one test."),
    "ep_checking":("Kontrol ediliyor…", "Checking…"),
    "ep_remote": ("İstemler ve yanıtlar bu bilgisayardan çıkar ({host}).", "Prompts and replies leave this computer ({host})."),
}


class EndpointError(ValueError):
    pass


def text(key: str, lang: str = "tr", **params: Any) -> str:
    pair = TEXTS.get(key)
    if not pair:
        return key
    s = pair[1] if lang == "en" else pair[0]
    try:
        return s.format(**{k: ("" if v is None else v) for k, v in params.items()})
    except (KeyError, IndexError):
        return s


def preset(pid: str | None) -> dict[str, Any] | None:
    return next((p for p in PRESETS if p["id"] == pid), None) if pid else None


def presets_public(lang: str = "tr") -> list[dict[str, Any]]:
    out = []
    for p in PRESETS:
        item = {k: v for k, v in p.items() if k != "note"}
        item.setdefault("supported", True)
        item["local"] = is_local_url(p["base_url"]) if p["base_url"] else False
        item["note"] = text(p["note"], lang) if p.get("note") else None
        item["group_label"] = text(f"group_{p['group']}", lang)
        item["verified"] = VERIFIED_ON
        out.append(item)
    return out


# ---------------------------------------------------------------------- yardımcılar
def is_local_url(url: Any) -> bool:
    """Ana makine bu bilgisayar mı (localhost, *.localhost, 127.0.0.0/8, ::1)? (workflow/pricing.is_local_endpoint ile aynı)"""
    raw = str(url or "").strip()
    if not raw:
        return False
    try:
        host = (urlsplit(raw if "://" in raw else f"http://{raw}").hostname or "").lower()
    except ValueError:
        return False
    if not host:
        return False
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def origin_of(url: str) -> tuple[str, str, int | None]:
    """(şema, ana makine, port) — varsayılan port açıkça yazılsa da aynı köken sayılır (https:443, http:80)."""
    try:
        parts = urlsplit(str(url or "").strip())
        scheme, host, port = (parts.scheme or "").lower(), (parts.hostname or "").lower(), parts.port
    except ValueError:
        return ("", str(url or ""), None)
    if port == {"http": 80, "https": 443}.get(scheme):
        port = None
    return (scheme, host, port)


def host_of(url: str) -> str:
    try:
        return urlsplit(url).hostname or url
    except ValueError:
        return url


def secret_name(eid: str) -> str:
    """Eski tek bağlantının anahtarı aynı adla kalır (kayıpsız); yenileri kimlikle ad alanlı."""
    return LEGACY_SECRET if eid == LEGACY_ID else f"openai_compat.{eid}.api_key"


def model_ref(eid: str | None, model: str | None) -> str:
    """Ajan/görev `model` alanı: `<kimlik>::<model>` (kimlik yoksa yalnızca model)."""
    m = str(model or "")
    return f"{eid}{REF_SEP}{m}" if eid else m


def parse_model_ref(value: str | None) -> tuple[str | None, str]:
    v = str(value or "")
    if REF_SEP in v:
        eid, _, m = v.partition(REF_SEP)
        eid = eid.strip()
        if ID_RE.match(eid):
            return eid, m.strip()
    return None, v.strip()


def validate_base_url(url: str) -> str:
    url = str(url or "").strip().rstrip("/")
    if not url:
        raise EndpointError("Adres (base URL) gerekli")
    if not url.startswith(("http://", "https://")):
        raise EndpointError("base_url http:// ya da https:// ile başlamalı")
    try:
        parts = urlsplit(url)
    except ValueError as exc:
        raise EndpointError("Geçersiz adres") from exc
    if not parts.hostname:
        raise EndpointError("Geçersiz adres")
    if parts.username or parts.password:  # anahtar adrese gömülmesin (settings.json'a düşerdi)
        raise EndpointError("Adrese kullanıcı adı/parola yazma; anahtarı API anahtarı alanına gir")
    if parts.query or parts.fragment:
        raise EndpointError("Adreste ? ya da # olmamalı")
    return url


def _clean_models(models: Any) -> list[str]:
    out: list[str] = []
    for m in models or []:
        s = str(m or "").strip()[:160]
        if s and s not in out:
            out.append(s)
    return out[:200]


def _normalize(ep: dict[str, Any]) -> dict[str, Any]:
    api = ep.get("api") if ep.get("api") in APIS else "openai"
    return {"id": str(ep.get("id") or ""), "label": str(ep.get("label") or ep.get("id") or "")[:60],
            "preset": str(ep.get("preset") or "") or None, "api": api,
            "base_url": str(ep.get("base_url") or "").rstrip("/"), "model": str(ep.get("model") or "")[:160],
            "models": _clean_models(ep.get("models")), "enabled": ep.get("enabled", True) is not False,
            "tools": ep.get("tools") if isinstance(ep.get("tools"), bool) else None}


# ---------------------------------------------------------------------- okuma
def _block(settings: Any) -> dict[str, Any]:
    b = settings.get("connections.openai_compat") or {}
    return b if isinstance(b, dict) else {}


def legacy_endpoint(block: dict[str, Any]) -> dict[str, Any] | None:
    base = str(block.get("base_url") or "").rstrip("/")
    if not base:
        return None
    return _normalize({"id": LEGACY_ID, "label": block.get("label") or "OpenAI uyumlu sunucu", "api": "openai",
                       "base_url": base, "model": block.get("model") or "", "preset": _guess_preset(base)})


def _guess_preset(base: str) -> str | None:
    base = base.rstrip("/")
    return next((p["id"] for p in PRESETS if p["base_url"] and p["base_url"].rstrip("/") == base), None)


def endpoints_of(settings: Any) -> list[dict[str, Any]]:
    """Kayıtlı uç noktalar. Liste boş ve eski tek blok doluysa onu (henüz taşınmamış) `default` uç noktası olarak verir."""
    block = _block(settings)
    raw = block.get("endpoints")
    if isinstance(raw, list) and raw:
        return [_normalize(e) for e in raw if isinstance(e, dict) and ID_RE.match(str(e.get("id") or ""))]
    legacy = legacy_endpoint(block)
    return [legacy] if legacy else []


def default_endpoint_id(settings: Any) -> str | None:
    eps = [e for e in endpoints_of(settings) if e["enabled"]]
    if not eps:
        return None
    want = str(_block(settings).get("default_endpoint") or "")
    return want if any(e["id"] == want for e in eps) else eps[0]["id"]


def get_endpoint(settings: Any, eid: str | None = None) -> dict[str, Any] | None:
    """Kimlikle uç nokta; kimlik yoksa varsayılan. Devre dışı uç nokta yalnızca açık kimlikle döner."""
    eps = endpoints_of(settings)
    if eid:
        return next((e for e in eps if e["id"] == eid), None)
    did = default_endpoint_id(settings)
    return next((e for e in eps if e["id"] == did), None)


def tools_mode(ep: dict[str, Any] | None) -> str:
    """Uç noktada araç çağrısı: kullanıcı kapattıysa "no"; açtıysa en az "try"; yoksa ön ayarın değeri (özel adres: try)."""
    if not ep:
        return "no"
    if ep.get("tools") is False:
        return "no"
    pre = preset(ep.get("preset"))
    mode = (pre or {}).get("tools") or "try"
    if ep.get("tools") is True and mode == "no":
        return "try"
    return mode if mode in TOOL_MODES else "try"


def route_is_local(settings: Any, route: dict[str, Any] | None) -> bool | None:
    """Motor için öneri (pricing sahibine): adım rotası yerel bir uç noktaya mı gidiyor? openai_compat değilse None."""
    if not route or route.get("connection") != "openai_compat":
        return None
    ep = get_endpoint(settings, route.get("provider"))
    return is_local_url(ep["base_url"]) if ep else None


# ---------------------------------------------------------------------- yazma
def _write(settings: Any, eps: list[dict[str, Any]], default_id: str | None) -> None:
    ids = [e["id"] for e in eps if e["enabled"]]
    if default_id not in ids:
        default_id = ids[0] if ids else ""
    mirror = _mirror(eps, default_id)
    settings.update({"connections": {"openai_compat": {
        "endpoints": [dict(e) for e in eps], "default_endpoint": default_id or "", **mirror}}})


def _mirror(eps: list[dict[str, Any]], default_id: str | None) -> dict[str, Any]:
    """Eski tek-blok alanları (geriye uyum). Varsayılan uç noktayı yansıtır; ANCAK varsayılan yerel iken başka bir uzak
    (ücretli) uç nokta da varsa uzak olanı yansıtır: motorun yalnızca bu adrese bakan "yerel → maliyet 0" kuralı ücretli
    çağrıyı asla bedava göstermesin (temkinli taraf). Kalıcı çözüm: motorun `route_is_local` kullanması (rapor).

    Denetim B-22: eski sürüm bu adresi eski anahtar adıyla (`openai_compat.api_key` = `default` uç noktasının anahtarı)
    eşleştirir. Yansıtılan uç nokta `default` DEĞİLSE ve listede bir `default` uç noktası (dolayısıyla o anahtar) varsa
    adres boş yazılır: eski bir sürüm `default` anahtarını başka bir ana makineye gönderemez. Boş adres motor için
    "yerel değil" demektir (temkinli taraf korunur)."""
    enabled = [e for e in eps if e["enabled"]]
    pick = next((e for e in enabled if e["id"] == default_id), None)
    if pick and is_local_url(pick["base_url"]):
        remote = next((e for e in enabled if not is_local_url(e["base_url"])), None)
        pick = remote or pick
    if not pick:
        return {"enabled": False, "base_url": "", "label": "", "model": ""}
    if pick["id"] != LEGACY_ID and any(e["id"] == LEGACY_ID for e in eps):
        return {"enabled": False, "base_url": "", "label": "", "model": ""}
    return {"enabled": True, "base_url": pick["base_url"], "label": pick["label"], "model": pick["model"]}


def migrate(settings: Any) -> dict[str, Any] | None:
    """Eski tek bağlantıyı kalıcı olarak `endpoints` listesine taşır (idempotent; anahtar adı değişmez)."""
    block = _block(settings)
    if isinstance(block.get("endpoints"), list) and block.get("endpoints"):
        return None
    legacy = legacy_endpoint(block)
    if not legacy:
        return None
    _write(settings, [legacy], LEGACY_ID)
    if not is_local_url(legacy["base_url"]):
        # kullanıcı bu uzak bağlantıyı S37'den önce kendisi kurmuştu: ilk kullanım onayı verilmiş sayılır (kayıtlı)
        from studio.connections.policy import give_consent  # noqa: PLC0415
        give_consent(settings, f"endpoint:{LEGACY_ID}", source="migrated")
    return legacy


def _free_id(base: str, taken: set[str]) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")[:28] or "api"
    if not slug[0].isalnum():
        slug = "api-" + slug
    cand, n = slug, 2
    while cand in taken or cand == LEGACY_ID:  # "default" eski tek bağlantının anahtar adına eşlenir
        cand = f"{slug}-{n}"
        n += 1
    return cand


def save_endpoint(settings: Any, secrets: Any, data: dict[str, Any], eid: str | None = None) -> dict[str, Any]:
    """Uç nokta ekle (eid yok) ya da güncelle. `api_key`: alan yoksa korunur; None/"" silinir; değer kaydedilir."""
    eps = endpoints_of(settings)
    block_default = default_endpoint_id(settings)
    cur = next((e for e in eps if e["id"] == eid), None) if eid else None
    if eid and cur is None:
        raise EndpointError(f"Böyle bir API bağlantısı yok: {eid}")
    pre = preset(data.get("preset")) or (preset(cur.get("preset")) if cur else None)
    if pre and pre.get("supported") is False:
        raise EndpointError(f"{pre['label']} henüz desteklenmiyor")
    base = validate_base_url(data.get("base_url") if "base_url" in data else (cur or {}).get("base_url") or (pre or {}).get("base_url") or "")
    moved = cur is not None and origin_of(base) != origin_of(cur.get("base_url") or "")
    if moved and "api_key" not in data and secrets is not None and secrets.has(secret_name(cur["id"])):
        # Denetim B-02: kayıtlı anahtar yeni bir ana makineye sessizce gitmesin (adres değişince anahtar yeniden girilir)
        raise EndpointError("Adres başka bir sunucuya değişti; güvenlik için API anahtarını yeniden gir")
    api = data.get("api") or (cur or {}).get("api") or (pre or {}).get("api") or "openai"
    if api not in APIS:
        raise EndpointError("api openai ya da anthropic olmalı")
    label = str(data.get("label") or (cur or {}).get("label") or (pre or {}).get("label") or host_of(base)).strip()[:60]
    if cur is None:
        if len(eps) >= MAX_ENDPOINTS:
            raise EndpointError(f"En çok {MAX_ENDPOINTS} API bağlantısı eklenebilir")
        taken = {e["id"] for e in eps}
        want = str(data.get("id") or "").strip().lower()
        new_id = want if want and ID_RE.match(want) and want not in taken else _free_id(str((pre or {}).get("id") or label), taken)
        while new_id in taken:
            new_id = _free_id(new_id + "-2", taken)
        cur = {"id": new_id, "enabled": True, "models": []}
        eps.append(cur)
    cur.update({"label": label, "base_url": base, "api": api,
                "preset": (pre or {}).get("id") or cur.get("preset") or _guess_preset(base)})
    if "model" in data:
        cur["model"] = str(data.get("model") or "").strip()[:160]
    if "models" in data:
        cur["models"] = _clean_models(data.get("models"))
    if "enabled" in data:
        cur["enabled"] = bool(data["enabled"])
    if "tools" in data:
        cur["tools"] = data["tools"] if isinstance(data["tools"], bool) else None
    eps = [_normalize(e) for e in eps]
    default_id = block_default
    if data.get("make_default") or not default_id:
        default_id = cur["id"]
    if "api_key" in data:   # önce anahtar: bozuk secrets.json'da (SecretsCorrupt) ayar yarım yazılmaz
        key = data.get("api_key")
        secrets.set(secret_name(cur["id"]), str(key).strip() if key else None)
    _write(settings, eps, default_id)
    return public_endpoint(get_endpoint(settings, cur["id"]) or cur, secrets, default_endpoint_id(settings))


def delete_endpoint(settings: Any, secrets: Any, eid: str) -> None:
    eps = endpoints_of(settings)
    if not any(e["id"] == eid for e in eps):
        raise EndpointError(f"Böyle bir API bağlantısı yok: {eid}")
    rest = [e for e in eps if e["id"] != eid]
    _write(settings, rest, default_endpoint_id(settings) if default_endpoint_id(settings) != eid else None)
    if secrets.has(secret_name(eid)):   # bozuk dosyada has() False: silme anahtar dosyasına dokunmadan sürer
        secrets.set(secret_name(eid), None)


def set_default(settings: Any, eid: str) -> None:
    eps = endpoints_of(settings)
    ep = next((e for e in eps if e["id"] == eid), None)
    if not ep or not ep["enabled"]:
        raise EndpointError(f"Böyle bir API bağlantısı yok: {eid}")
    _write(settings, eps, eid)


def remember_models(settings: Any, eid: str, names: list[str]) -> None:
    """/models listesi değiştiyse kalıcı listeyi güncelle (ajan başına seçim çevrimdışıyken de görünsün)."""
    eps = endpoints_of(settings)
    ep = next((e for e in eps if e["id"] == eid), None)
    names = _clean_models(names)
    if not ep or not names or ep["models"] == names:
        return
    ep["models"] = names
    _write(settings, eps, default_endpoint_id(settings))


def public_endpoint(ep: dict[str, Any], secrets: Any, default_id: str | None = None, corrupt: bool | None = None) -> dict[str, Any]:
    name = secret_name(ep["id"])
    has = bool(secrets and secrets.has(name))
    if corrupt is None:     # liste çağıranı bir kez hesaplar (her uç nokta dosyayı yeniden okuyup hata loglamasın)
        corrupt = bool(secrets and getattr(secrets, "is_corrupt", lambda: False)())
    pre = preset(ep.get("preset"))
    return {**ep, "local": is_local_url(ep["base_url"]), "has_key": has,
            "secrets_corrupt": corrupt, "secrets_path": display_path(secrets.path) if corrupt else None,
            "api_key_masked": secrets.masked(name) if has else None, "is_default": ep["id"] == default_id,
            "key_required": (pre or {}).get("key") == "required" or (ep["api"] == "anthropic"),
            "key_url": (pre or {}).get("key_url"), "host": host_of(ep["base_url"]), "tools_mode": tools_mode(ep)}


__all__ = ["EndpointError", "PRESETS", "LEGACY_ID", "LEGACY_SECRET", "REF_SEP", "ANTHROPIC_VERSION", "endpoints_of",
           "default_endpoint_id", "get_endpoint", "route_is_local", "migrate", "save_endpoint", "delete_endpoint",
           "set_default", "remember_models", "public_endpoint", "presets_public", "secret_name", "model_ref",
           "parse_model_ref", "tools_mode", "is_local_url", "validate_base_url", "text", "preset", "host_of", "origin_of"]
