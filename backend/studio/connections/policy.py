"""Model erişim politikası (S37): hangi beyin/model kullanılabilir — yerel, izin verilen çevrimiçi modeller.

Ayar `models.policy` (yalnızca kullanıcı arayüzünden değişir; MCP istemcileri `clients/tracker.USER_ONLY_RE` ile, genel
`PUT /api/settings` de `models` anahtarını yok sayarak engellenir; yönetici/test modu bu politikayı AŞMAZ — bu bir oyun
kilidi değil, güvenlik ve gizlilik denetimidir):

  mode: all | local_only | allowlist      (varsayılan all: bugünkü davranış)
  allow / deny: kalıplar (deny her zaman kazanır)
  require_consent_remote: true            (uzak uç nokta ilk kullanımda bir kez "veriler bu bilgisayardan çıkar" onayı)

Model başvurusu (kalıpların eşleştiği metin, büyük/küçük harf duyarsız, `*` ve `?` joker):
  openai_compat → `<uç nokta>::<model>`   ör. mistral::mistral-small-latest, anthropic::claude-sonnet-5-5
  ollama        → `ollama:<model>`         ör. ollama:qwen3:4b; bulut modeli ayrıca `ollama:<model>:cloud` ile de eşleşir
  codex/claude  → `codex:<model|default>`, `claude:<model|default>` (abonelik CLI'ları; uzak sayılır)
  Hermes profili → `hermes:<profil>` (modeli bilinmez; local_only'de kapalı)
Özel kalıp `local`: bu bilgisayarda çalışan her model (Ollama yerel, localhost uç noktaları).

Uygulama TEK yerde: `agents.AgentRegistry.route()` → `enforce()`; motor her adımda route() çağırır, izinsiz rota adımı
açık iletiyle düşürür (sessizce model değiştirilmez). Kahraman önerileri gibi başka öneri katmanları `allowed_brain()`
yardımcısını kullanır.
"""

from __future__ import annotations

import fnmatch
import time
from dataclasses import dataclass, field
from typing import Any

from studio.connections import endpoints as E

MODES = ("all", "local_only", "allowlist")
CLOUD_CONSENT_KEY = "ollama:cloud"
REMOTE_OLLAMA_PREFIX = "ollama-remote:"  # FOLLOWUP: uzak Ollama sunucusu başına onay (ollama-remote:<host>)


CONSENT_KEY_MAX = 80
_HOST_MAX = CONSENT_KEY_MAX - len(REMOTE_OLLAMA_PREFIX)   # 66
_HOST_KEEP = 48


def _fnv1a32(text: str) -> str:
    """FNV-1a 32 bit (UTF-8): uzun ana makine adını iki tarafta (lib/modelPolicy.ts) aynı biçimde kısaltmak için."""
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def ollama_remote_host(url_or_host: str) -> str:
    """adresi normalleştirir (şema, büyük/küçük harf, varsayılan bağlantı noktası) ve yalnız ana makine adını
    döner: `192.0.2.7:11434`, `http://192.0.2.7` ve `HTTP://192.0.2.7:11434/` aynı sunucudur."""
    from studio.config import normalize_ollama_host  # noqa: PLC0415

    raw = str(url_or_host or "").strip()
    if not raw:
        return ""
    norm = normalize_ollama_host(raw) or raw
    host = E.host_of(norm) or ""
    return host.strip().strip("[]").lower()


def remote_ollama_key(host: str) -> str:
    """Uzak (bu bilgisayar olmayan) Ollama sunucusu için ilk kullanım onay anahtarı. adres normalleştirilir;
    uzun ana makine adı deterministik kısaltılır (ilk 48 karakter + "~" + FNV-1a), böylece anahtar 80 karakteri aşmaz
    ve verme / denetleme aynı anahtarı kullanır. Arayüz (lib/modelPolicy.ts remoteOllamaKey) aynı kuralı uygular."""
    h = ollama_remote_host(host)
    if len(h) > _HOST_MAX:
        h = f"{h[:_HOST_KEEP]}~{_fnv1a32(h)}"
    return f"{REMOTE_OLLAMA_PREFIX}{h or '?'}"
MAX_PATTERNS = 100
DEFAULT_POLICY: dict[str, Any] = {"mode": "all", "allow": [], "deny": [], "require_consent_remote": True}

# Arayüz ön ayarları (allowlist): "Yalnız yerel" ve "Yerel + seçili online" (çevrimiçi kalıplar kullanıcı seçer)
PRESETS: dict[str, dict[str, Any]] = {
    "local_only": {"mode": "local_only", "allow": [], "deny": []},
    "local_plus": {"mode": "allowlist", "allow": ["local"], "deny": []},
    "all": {"mode": "all", "allow": [], "deny": []},
}

# (tr, en) — politika iletileri (RouteError metni TR üretilir; en.py kataloğu da aynı şablonları çevirir)
TEXTS: dict[str, tuple[str, str]] = {
    "denied": ("Bu model yönetici politikasıyla kapalı: {ref}", "This model is blocked by the model access policy: {ref}"),
    "not_local": ("Bu model yönetici politikasıyla kapalı (yalnız yerel modellere izin var): {ref}",
                  "This model is blocked by the model access policy (only local models are allowed): {ref}"),
    "not_allowed": ("Bu model yönetici politikasıyla kapalı (izin listesinde yok): {ref}",
                    "This model is blocked by the model access policy (not on the allow list): {ref}"),
    "consent": ("{provider} çevrimiçi bir model: istemler bu bilgisayardan {host} adresine gider. Önce bir kez onay ver "
                "(Bağlantılar → Model izinleri).",
                "{provider} is an online model: prompts leave this computer for {host}. Give one-time consent first "
                "(Connections → Model access)."),
}


class PolicyError(ValueError):
    def __init__(self, code: str, message: str, decision: "Decision"):
        super().__init__(message)
        self.code = code
        self.decision = decision


@dataclass
class Decision:
    ref: str
    allowed: bool = True
    remote: bool = False
    reason: str | None = None          # denied | not_local | not_allowed | consent
    consent_key: str | None = None     # uzak uç nokta: ilk kullanım onayı anahtarı
    provider: str = ""
    host: str = ""
    keys: list[str] = field(default_factory=list)

    def message(self, lang: str = "tr") -> str:
        return text(self.reason or "denied", lang, ref=self.ref, provider=self.provider, host=self.host)

    def to_dict(self, lang: str = "tr") -> dict[str, Any]:
        return {"ref": self.ref, "allowed": self.allowed, "remote": self.remote, "reason": self.reason,
                "consent_key": self.consent_key, "provider": self.provider, "host": self.host,
                "message": self.message(lang) if self.reason else None}


def text(key: str, lang: str = "tr", **params: Any) -> str:
    pair = TEXTS.get(key) or (key, key)
    s = pair[1] if lang == "en" else pair[0]
    try:
        return s.format(**{k: ("" if v is None else v) for k, v in params.items()})
    except (KeyError, IndexError):
        return s


# ---------------------------------------------------------------------- ayar
def _clean_patterns(raw: Any) -> list[str]:
    out: list[str] = []
    for p in raw or []:
        s = str(p or "").strip()[:160]
        if s and s not in out:
            out.append(s)
    return out[:MAX_PATTERNS]


def policy_of(settings: Any) -> dict[str, Any]:
    raw = settings.get("models.policy") if settings is not None else None
    raw = raw if isinstance(raw, dict) else {}
    mode = raw.get("mode") if raw.get("mode") in MODES else "all"
    return {"mode": mode, "allow": _clean_patterns(raw.get("allow")), "deny": _clean_patterns(raw.get("deny")),
            "require_consent_remote": raw.get("require_consent_remote", True) is not False}


def validate(data: dict[str, Any]) -> dict[str, Any]:
    if "mode" in data and data["mode"] not in MODES:
        raise ValueError(f"Geçersiz mod: {data['mode']}")
    for k in ("allow", "deny"):
        if k in data and not isinstance(data[k], list):
            raise ValueError(f"{k} bir liste olmalı")
    cur = {**DEFAULT_POLICY, **{k: data[k] for k in DEFAULT_POLICY if k in data}}
    cur["allow"], cur["deny"] = _clean_patterns(cur["allow"]), _clean_patterns(cur["deny"])
    cur["require_consent_remote"] = cur["require_consent_remote"] is not False
    return cur


def save_policy(settings: Any, data: dict[str, Any]) -> dict[str, Any]:
    pol = validate({**policy_of(settings), **data})
    settings.update({"models": {"policy": pol}})
    return policy_of(settings)


def consents(settings: Any) -> list[dict[str, Any]]:
    raw = settings.get("models.consent") if settings is not None else None
    return [c for c in (raw or []) if isinstance(c, dict) and c.get("key")]


def has_consent(settings: Any, key: str) -> bool:
    if key == f"endpoint:{E.LEGACY_ID}" and _legacy_unmigrated(settings):
        return True  # eski tek bağlantı (S37 öncesi kullanıcı ayarı): taşınırken onay kaydedilir; o zamana dek geçerli
    return any(c["key"] == key for c in consents(settings))


def _legacy_unmigrated(settings: Any) -> bool:
    block = settings.get("connections.openai_compat") if settings is not None else None
    return isinstance(block, dict) and not block.get("endpoints") and bool(block.get("base_url"))


def give_consent(settings: Any, key: str, source: str = "user") -> list[dict[str, Any]]:
    key = str(key or "").strip()
    if len(key) > CONSENT_KEY_MAX:  # kısaltılan anahtar denetlenen anahtarla aynı olmalı
        raise ValueError("Onay anahtarı çok uzun")
    if not key:
        raise ValueError("Onay anahtarı gerekli")
    items = [c for c in consents(settings) if c["key"] != key]
    items.append({"key": key, "ts": time.time(), "source": source})
    settings.update({"models": {"consent": items[-200:]}})
    return consents(settings)


def revoke_consent(settings: Any, key: str) -> list[dict[str, Any]]:
    settings.update({"models": {"consent": [c for c in consents(settings) if c["key"] != key]}})
    return consents(settings)


# ---------------------------------------------------------------------- değerlendirme
def matches(pattern: str, keys: list[str], *, local: bool) -> bool:
    p = pattern.strip().lower()
    if p == "local":
        return local
    return any(fnmatch.fnmatchcase(k.lower(), p) for k in keys)


def ollama_url_of(settings: Any) -> str:
    """Ayarlı Ollama adresi (yoksa boş: yerel varsayılan kabul edilir)."""
    try:
        return str((settings.get("ollama_url") if settings is not None else "") or "").strip()
    except Exception:  # noqa: BLE001 - sahte/eksik ayar nesnesi
        return ""


def ollama_is_local(settings: Any) -> bool:
    """Ollama bu bilgisayarda mı (boş adres = yerel varsayılan)."""
    url = ollama_url_of(settings)
    return not url or E.is_local_url(url)


def describe(settings: Any, connection: str, model: str | None, *, provider: str | None = None,
             profile: str | None = None, ollama_remote: bool | None = None,
             ollama_cloud: bool | None = None) -> Decision:
    """Bağlantı + model → başvuru, yerel/uzak bilgisi ve onay anahtarı (politika uygulanmadan)."""
    m = str(model or "")
    if connection == "openai_compat":
        eid, bare = E.parse_model_ref(m)
        ep = E.get_endpoint(settings, eid or provider)
        eid = (ep or {}).get("id") or eid or provider or "?"
        bare = bare or (ep or {}).get("model") or ""
        remote = not E.is_local_url((ep or {}).get("base_url")) if ep else True
        ref = f"{eid}{E.REF_SEP}{bare}"
        return Decision(ref=ref, remote=remote, keys=[ref], provider=(ep or {}).get("label") or eid,
                        host=E.host_of((ep or {}).get("base_url") or ""), consent_key=f"endpoint:{eid}" if remote else None)
    if connection == "ollama":
        from studio.connections.models import is_cloud_model  # noqa: PLC0415

        url = ollama_url_of(settings)
        host_remote = bool(url) and not E.is_local_url(url)
        # `ollama_remote` (eski çağrılar) = modelin "local" alanının tersi; uzak sunucuda bu her model için doğrudur, bu
        # yüzden bulut bilgisi ayrıca (`ollama_cloud`) ya da addan alınır.
        if ollama_cloud is not None:
            cloud = bool(ollama_cloud)
        elif ollama_remote is None or host_remote:
            cloud = is_cloud_model(m)
        else:
            cloud = bool(ollama_remote)
        # Ollama adresi bu bilgisayar değilse her model uzaktır (istem o sunucuya gider); local_only reddeder
        remote = cloud or host_remote
        ref = f"ollama:{m or 'default'}"
        keys = [ref] + ([f"{ref}:cloud"] if remote else [])
        if host_remote:
            # İstemler bu bilgisayardan çıkar: adresi kim ayarlamış olursa olsun ilk kullanımda bir kez onay istenir.
            # FOLLOWUP: onay sunucu başınadır (ollama-remote:<host>). model adı bulut modeli (`*-cloud`) olsa da
            # istem önce o uzak sunucuya gider; Ollama Cloud onayı ("ollama:cloud") bir LAN/uzak sunucuyu kapsamaz.
            # Arayüz (lib/modelPolicy.ts decide) aynı anahtarı üretir, ConsentDialog onu verir.
            host = ollama_remote_host(url)
            return Decision(ref=ref, remote=True, keys=keys, provider="Ollama (uzak sunucu)", host=host,
                            consent_key=remote_ollama_key(host))
        return Decision(ref=ref, remote=remote, keys=keys, provider="Ollama Cloud" if cloud else "Ollama",
                        host="ollama.com" if cloud else "", consent_key=CLOUD_CONSENT_KEY if cloud else None)
    if connection in ("codex", "claude"):
        ref = f"{connection}:{m or 'default'}"
        return Decision(ref=ref, remote=True, keys=[ref], provider={"codex": "Codex", "claude": "Claude Code"}[connection])
    ref = f"hermes:{profile or 'default'}"
    return Decision(ref=ref, remote=True, keys=[ref], provider="Hermes")  # profil modeli bilinmez → yerel sayılmaz


def evaluate(settings: Any, d: Decision, *, check_consent: bool = True) -> Decision:
    pol = policy_of(settings)
    local = not d.remote
    if any(matches(p, d.keys, local=local) for p in pol["deny"]):
        d.allowed, d.reason = False, "denied"
    elif pol["mode"] == "local_only" and not local:
        d.allowed, d.reason = False, "not_local"
    elif pol["mode"] == "allowlist" and not any(matches(p, d.keys, local=local) for p in pol["allow"]):
        d.allowed, d.reason = False, "not_allowed"
    elif check_consent and d.consent_key and pol["require_consent_remote"] and not has_consent(settings, d.consent_key):
        d.allowed, d.reason = False, "consent"
    return d


def check_route(settings: Any, route: Any, *, check_consent: bool = True, ollama_remote: bool | None = None,
                ollama_cloud: bool | None = None) -> Decision:
    conn = route.connection
    if route.connector == "hermes" and conn == "profile":
        d = describe(settings, "profile", None, profile=route.profile)
    elif conn == "openai_compat":
        d = describe(settings, conn, E.model_ref(route.provider, route.model or ""), provider=route.provider)
    else:
        d = describe(settings, conn, route.model, ollama_remote=ollama_remote, ollama_cloud=ollama_cloud)
    return evaluate(settings, d, check_consent=check_consent)


def enforce(settings: Any, route: Any, **kw: Any) -> Decision:
    """İzinsiz rota → PolicyError (agents.route bunu RouteError'a çevirir)."""
    d = check_route(settings, route, **kw)
    if not d.allowed:
        raise PolicyError(d.reason or "denied", d.message("tr"), d)
    return d


def allowed_brain(settings: Any, connection: str, model: str | None = None, *, check_consent: bool = False) -> bool:
    """Öneri katmanları (kahramanlar, başlangıç ekibi, işe alım) için: bu bağlantı + model politikaya uyuyor mu?
    Onay varsayılan olarak sayılmaz (onay ilk kullanımda alınır); `check_consent=True` ile o da denetlenir."""
    if connection == "profile":
        d = describe(settings, "profile", None)
    else:
        d = describe(settings, connection, model)
    return evaluate(settings, d, check_consent=check_consent).allowed


def preview(settings: Any, ollama_models: list[dict[str, Any]] | None = None, lang: str = "tr") -> list[dict[str, Any]]:
    """Canlı önizleme: bilinen modeller ve politikaya göre durumları (arayüz: Model izinleri bölümü)."""
    items: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(conn: str, label: str, d: Decision) -> None:
        if d.ref in seen:
            return
        seen.add(d.ref)
        evaluate(settings, d)
        items.append({"connection": conn, "label": label, **d.to_dict(lang)})

    for m in ollama_models or []:
        name = str(m.get("name") or "")
        if name:
            add("ollama", name, describe(settings, "ollama", name, ollama_remote=not m.get("local", True),
                                         ollama_cloud=m.get("cloud") if "cloud" in m else None))
    for ep in E.endpoints_of(settings):
        if not ep["enabled"]:
            continue
        names = [n for n in dict.fromkeys([ep["model"], *ep["models"]]) if n][:40] or [""]
        for n in names:
            add("openai_compat", f"{ep['label']} · {n}" if n else ep["label"],
                describe(settings, "openai_compat", E.model_ref(ep["id"], n)))
    for conn in ("codex", "claude"):
        add(conn, {"codex": "Codex", "claude": "Claude Code"}[conn], describe(settings, conn, None))
    return items


__all__ = ["MODES", "PRESETS", "PolicyError", "Decision", "policy_of", "save_policy", "validate", "consents",
           "has_consent", "give_consent", "revoke_consent", "describe", "evaluate", "check_route", "enforce",
           "allowed_brain", "preview", "matches", "CLOUD_CONSENT_KEY", "REMOTE_OLLAMA_PREFIX", "remote_ollama_key", "text"]
