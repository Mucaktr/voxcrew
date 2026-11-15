"""Ajan kayıt defteri (graf üzerinde) ve beyin rotası çözümleme.

Hermes profilleri (Hermes kuruluysa) otomatik keşfedilir ve Agent düğümü olur; kullanıcı ayarları (beyin, görünüm,
kişilik) korunur. Hermes profil dosyalarına asla yazılmaz. Hermes isteğe bağlıdır: klasör yoksa ya da boşsa eşitleme
atlanır, gizli "default" ajanı oluşmaz.

Taze kurulumda (eşitlemeden sonra görünür ajan yoksa) bir kez "Yazılımcı" ve "Araştırmacı" başlangıç ajanları
oluşturulur; beyinleri kurulu bağlantılardan seçilir (STARTER_TEAM). Bu değerlendirme idempotenttir.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

import yaml

from studio.config import Settings
from studio.connections import endpoints as endpoint_api
from studio.connections import policy as model_policy
from studio.connectors.base import Route
from studio.connectors.discovery import claude_login_state, codex_session_state, find_claude, find_codex, hermes_available
from studio.graph.store import GraphStore
from studio.i18n import agent_lang
from studio.hermes.caps import (PROFILE_MARKERS, REASONING_LEVELS, TRANSPORTS, caps_for, clean_name_list,
                                toolset_allowed)


class RouteError(ValueError):
    pass


# (UX-P2): başlangıç ajanına hazır beyin bulunamadıysa ajan beyinsiz doğar (`needs_brain`); rota bu iletiyle
# reddedilir, arayüz "Beyin seç" gösterir. Bağlantı alanı ontoloji gereği bir yer tutucudur (çalıştırılmaz).
NO_BRAIN = "Beyin seçilmedi: bu ajana hazır bir beyin seç (profil → Beyin)"


PALETTE = ["#7C5CFF", "#FF8A3D", "#10B981", "#EC4899", "#3B82F6", "#F59E0B", "#14B8A6", "#EF4444"]

# Hazır avatarlar yalnızca ücretsiz başlangıç kozmetiklerini giyer (QA-F3 m7). S34: avatarsız oluşturulan yeni ajanlar
# sırayla insan görünümü alır (farklı ten, saç, sakal, gözlük, kıyafet); hayvan türleri düzenleyicide seçilebilir kalır.
# "shirt" ve "blazer" mağazada olmayan (her zaman açık) kıyafetlerdir.
AVATAR_PRESETS: list[dict[str, Any]] = [
    {"species": "human", "skin": "#C68642", "hair": "short", "hairColor": "#1F1A17", "beard": "stubble",
     "outfit": "hoodie", "outfitColor": "#2D6CDF", "accent": "#38BDF8", "glasses": "square", "hat": "none"},
    {"species": "human", "skin": "#F5D0B5", "hair": "bob", "hairColor": "#B45309", "beard": "none",
     "outfit": "blazer", "outfitColor": "#334155", "accent": "#FFD166", "glasses": "round", "hat": "none"},
    {"species": "human", "skin": "#8D5524", "hair": "curly", "hairColor": "#1F1A17", "beard": "none",
     "outfit": "shirt", "outfitColor": "#F8FAFC", "accent": "#0EA5E9", "glasses": "none", "hat": "none"},
    {"species": "human", "skin": "#E0AC69", "hair": "ponytail", "hairColor": "#4A2F1D", "beard": "none",
     "outfit": "sweater", "outfitColor": "#10B981", "accent": "#FFF1E6", "glasses": "none", "hat": "headphones"},
    {"species": "human", "skin": "#5C3A21", "hair": "bald", "hairColor": "#E8E1D3", "beard": "full",
     "outfit": "blazer", "outfitColor": "#8E6CEF", "accent": "#FFF1E6", "glasses": "round", "hat": "none"},
    {"species": "human", "skin": "#FCE3CF", "hair": "long", "hairColor": "#D4A55C", "beard": "none",
     "outfit": "tshirt", "outfitColor": "#E85D75", "accent": "#FFD166", "glasses": "round", "hat": "none"},
    {"species": "human", "skin": "#C68642", "hair": "bun", "hairColor": "#1F1A17", "beard": "none",
     "outfit": "shirt", "outfitColor": "#0EA5E9", "accent": "#F8FAFC", "glasses": "none", "hat": "none"},
    {"species": "human", "skin": "#F5D0B5", "hair": "spiky", "hairColor": "#8B5A2B", "beard": "goatee",
     "outfit": "overalls", "outfitColor": "#334155", "accent": "#FB923C", "glasses": "none", "hat": "beanie"},
]

# GIFTS-GENDER: her hazır görünümün sunumu (m erkek, f kadın, n nötr/herkese uyar); `preset_for` ajan adına uyanı seçer.
PRESET_PRESENTATION: tuple[str, ...] = ("m", "f", "n", "f", "m", "f", "n", "m")


def preset_for(name: str | None, index: int) -> dict[str, Any]:
    """Avatarsız oluşturulan ajanın hazır görünümü: adı erkek/kadın adıysa o sunuma (ve nötr görünümlere) uyan, sırayla
    döner; ad tanınmıyorsa (ör. "Ajan 3") eski sıralı davranış. Veri göçü yok: yalnızca yeni ajanın başlangıç görünümü."""
    from studio.office.presentation import presentation_of_name
    p = presentation_of_name(name)
    ok = [i for i, k in enumerate(PRESET_PRESENTATION) if p == "n" or k in (p, "n")] or list(range(len(AVATAR_PRESETS)))
    return dict(AVATAR_PRESETS[ok[index % len(ok)]])


KNOWN_PROFILES: dict[str, dict[str, Any]] = {
    "arastirma": {"name": "Araştırmacı", "role": "Web'de araştırma yapar, kaynaklı ve doğrulanabilir notlar çıkarır.",
                  "preset": 0},
    "yazim": {"name": "Yazar", "role": "Notları ve bulguları net, akıcı Türkçe metinlere dönüştürür.", "preset": 1},
    "default": {"name": "Hermes", "role": "Genel amaçlı Hermes ajanı (varsayılan profil).", "preset": 2},
}

# Başlangıç ekibi (ARCH §S8, KARAR VERİLDİ). `brains`: sıradaki ilk HAZIR beyin kullanılır (`usable_brains` —
# oturumu açık Codex/Claude, modeli olan erişilebilir Ollama, gerçek Hermes profili). Hiçbiri hazır değilse ajan beyinsiz
# doğar (`needs_brain`, rota "Beyin seçilmedi") ve arayüz "Beyin seç" gösterir; bozuk varsayılan yazılmaz.
# "hermes" = web araç seti açık bir Hermes profili.
STARTER_TEAM: list[dict[str, Any]] = [
    {"key": "developer", "slug": "yazilimci", "name": "Yazılımcı", "title": "Yazılımcı", "rank": "specialist",
     "role": "Kod yazar, hata ayıklar ve teknik görevleri çalışma klasöründe uygular.",
     "persona": "Titiz ve sade çözümleri seven bir yazılımcı. Değişiklikleri küçük adımlarla yapar, ne yaptığını "
                "kısaca açıklar, denemeden 'bitti' demez.",
     "permissions": "write", "color": "#3B82F6", "brains": ["codex", "claude", "ollama"],
     # S34: taze kurulumda insan (mevcut kullanıcıların ajanları değişmez; tohum yalnızca bir kez çalışır)
     "avatar": {"species": "human", "skin": "#C68642", "hair": "short", "hairColor": "#1F1A17", "beard": "stubble",
                "outfit": "hoodie", "outfitColor": "#2D6CDF", "accent": "#38BDF8", "glasses": "square",
                "hat": "headphones"},
     # Arayüz/ajan dili EN ise tohum bu metinlerle yazılır (AUDIT-2026-10 C-05); slug dilden bağımsızdır
     "en": {"name": "Developer", "title": "Developer",
            "role": "Writes code, debugs and carries out technical tasks in the work folder.",
            "persona": "A meticulous developer who likes simple solutions. Works in small steps, briefly explains "
                       "what changed and never says 'done' without trying it."}},
    {"key": "researcher", "slug": "arastirmaci", "name": "Araştırmacı", "title": "Araştırmacı", "rank": "analyst",
     "role": "Web'de ve belgelerde araştırma yapar; kaynaklı, doğrulanabilir notlar çıkarır.",
     "persona": "Meraklı ve şüpheci bir araştırmacı. Her iddiayı kaynağıyla verir, emin olmadığı yeri açıkça "
                "belirtir.",
     "permissions": "read", "color": "#10B981", "brains": ["hermes", "codex", "ollama"],
     "avatar": {"species": "human", "skin": "#F5D0B5", "hair": "bob", "hairColor": "#B45309", "beard": "none",
                "outfit": "blazer", "outfitColor": "#0F766E", "accent": "#FFF1E6", "glasses": "round",
                "hat": "none"},
     "en": {"name": "Researcher", "title": "Researcher",
            "role": "Researches the web and documents; produces sourced, verifiable notes.",
            "persona": "A curious and sceptical researcher. Gives a source for every claim and says plainly where "
                       "they are unsure."}},
]


_STARTER_BY_SLUG = {s["slug"]: s for s in STARTER_TEAM}


def starter_display(props: dict[str, Any]) -> dict[str, str]:
    """Başlangıç ekibi sunucu açılışında (istek dili yokken, yani TR) tohumlanır: EN arayüzde elle değiştirilmemiş
    TR metin İngilizce gösterilir (kayıt değişmez; EN tohumlanmış ekip olduğu gibi kalır). Döner: üzerine yazılacak alanlar."""
    from studio.i18n import request_lang

    spec = _STARTER_BY_SLUG.get(str(props.get("slug")))
    if not spec or request_lang() != "en":
        return {}
    en = spec.get("en") or {}
    return {k: en[k] for k in ("name", "title", "role", "persona") if en.get(k) and props.get(k) == spec.get(k)}


def _read_yaml(path: Path) -> dict[str, Any]:
    try:
        data = yaml.safe_load(path.read_text("utf-8", errors="replace"))
        return data if isinstance(data, dict) else {}
    except (OSError, yaml.YAMLError):
        return {}


def scan_profiles(home: Path) -> list[dict[str, Any]]:
    """Hermes profilleri. Hermes klasörü yoksa ya da Hermes verisi içermiyorsa boş liste (hayalet ajan yok)."""
    if not home.is_dir():
        return []
    dirs: list[tuple[str, Path]] = []
    if any((home / m).exists() for m in PROFILE_MARKERS):
        dirs.append(("default", home))
    if (home / "profiles").is_dir():
        dirs += sorted((p.name, p) for p in (home / "profiles").iterdir() if (p / "config.yaml").is_file())
    out = []
    for name, d in dirs:
        model = (_read_yaml(d / "config.yaml").get("model") or {})
        if isinstance(model, str):  # kısa biçim `model: <ad>`; bozuk profil stüdyonun açılışını düşürmesin (QA-F56)
            model = {"default": model}
        elif not isinstance(model, dict):
            model = {}
        soul = ""
        try:
            soul = (d / "SOUL.md").read_text("utf-8", errors="replace")[:600]
        except OSError:
            pass
        out.append({
            "profile": name,
            "model": str(model.get("default") or model.get("model") or ""),
            "provider": str(model.get("provider") or "auto"),
            "base_url": str(model.get("base_url") or ""),
            "has_codex_auth": (d / "auth.json").is_file(),
            "soul": soul,
        })
    return out


def _host_port(url: str) -> tuple[str, int | None]:
    try:
        parts = urlsplit(url if "://" in url else f"http://{url}")
        host = (parts.hostname or "").lower()
        return ("127.0.0.1" if host in ("localhost", "::1") else host), parts.port
    except ValueError:
        return "", None


def _long_ctx_copy(m: dict[str, Any]) -> bool:
    """Modelfile'ında uzun bağlam (≥ HERMES_MIN_CTX) sabitlenmiş Ollama modeli (ör. Hermes için açılan `*-64k` kopyası)."""
    from studio.connectors.ollama import HERMES_MIN_CTX  # noqa: PLC0415
    n = m.get("num_ctx")
    return isinstance(n, int) and not isinstance(n, bool) and n >= HERMES_MIN_CTX


def infer_connection(provider: str, base_url: str, ollama_url: str | None = None) -> str:
    """Profilin model sağlayıcısından stüdyo bağlantısını çıkarır. Ollama: varsayılan port ya da ayardaki
    (OLLAMA_HOST) adresle aynı host:port."""
    if provider in ("custom", "ollama"):
        if re.search(r":11434", base_url):
            return "ollama"
        if ollama_url and base_url and _host_port(base_url) == _host_port(ollama_url) and _host_port(base_url)[1]:
            return "ollama"
    if provider == "openai-codex":
        return "codex"
    return "profile"


def slugify(text: str) -> str:
    table = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    s = re.sub(r"[^a-z0-9]+", "-", text.translate(table).lower()).strip("-")
    return s or "ajan"


# kullanıcı ve sistem kökenini taklit edebilecek ajan kısa adları ayrılmıştır (oluşturmada 400). Karşılaştırma
# normalleştirilmiş biçimde yapılır: NFKC, harf benzerleri (Kiril/Yunan "е", "ѕ" …), Türkçe harfler, büyük/küçük harf,
# ayraçlar ve sondaki sayı sonekleri ("User", "u_s.e-r", "kullanıcı", "Studio-2", "uѕer") aynı sayılır.
# görünen ad da (oluşturma VE yeniden adlandırma, her yoldan) aynı kurala tabidir; Türkçe "sistem" ve
# "stüdyo"/"studyo" da ayrılmıştır. hata iletisi kullanıcının yazdığını (kısa adın türetilmiş hâlini değil) anar.
RESERVED_AGENT_SLUGS = frozenset({"user", "kullanici", "system", "sistem", "studio", "studyo"})
ERR_RESERVED_AGENT = ("“{}” ayrılmış bir ajan adı: Kullanıcı / User, Sistem / System ve Stüdyo / Studio (ve benzer "
                      "yazımları ya da bu sözcük ve bir niteleyiciyle başlayan adlar) kullanıcı ve sistem kayıtlarına "
                      "ayrılmıştır; ad ya da kısa ad olarak kullanılamaz, başka bir ad seç")


def _typed(value: Any, limit: int = 60) -> str:
    """hata iletisinde kullanıcının yazdığı değer (görünmez biçim/denetim karakterleri U+FFFD olur; kısaltılmış)."""
    import unicodedata  # noqa: PLC0415

    text = "".join("\ufffd" if unicodedata.category(ch)[0] == "C" else ch for ch in str(value or ""))
    return text if len(text) <= limit else text[:limit - 1] + "…"


def check_reserved_agent(*values: Any) -> None:
    """ad ya da kısa ad ayrılmış bir adın benzeriyse ValueError (→ 400); ileti yazılan değeri anar."""
    for v in values:
        if v not in (None, "") and reserved_agent_slug(v):
            raise ValueError(ERR_RESERVED_AGENT.format(_typed(v)))


def _reserved_core(parts: list[str], folder: Callable[[str], str]) -> str:
    import unicodedata  # noqa: PLC0415

    core = "".join(folder(x) for x in parts)
    core = core.translate(str.maketrans("çğıöşüâîû", "cgiosuaiu"))
    core = "".join(ch for ch in unicodedata.normalize("NFKD", core) if not unicodedata.combining(ch))
    core = re.sub(r"[^a-z0-9]", "", core.lower())
    return re.sub(r"\d+$", "", core)


def reserved_agent_slug(value: Any) -> bool:
    """değer (ad ya da kısa ad) ayrılmış bir ajan adının benzeri mi.

    (1) harf benzerleri iki yoldan katlanır — mevcut `fold` (büyük harf tablosu önce: Yunan "Υ" → "y") ve
    önce küçük harfe indirip `fold` (Yunan "Υ" → "υ" → "u"); biri ayrılmış ada düşerse ayrılmıştır ("Υser").
    (2) katlanmış İLK sözcük ayrılmış bir adsa ve ardından bir niteleyici ayraç geliyorsa (parantez, " - ", iki nokta,
    eğik çizgi, simge …) ad ayrılmıştır: "Kullanıcı (sen)", "User - main", "Sistem: ana". Düz boşluk ya da kısa ad
    birleştiricisi ("-", "_") ile süren doğal ad öbekleri serbesttir ("Sistem Analisti", "Kullanıcı Deneyimi Uzmanı",
    "sistem-analisti"). Harf harf aralıklı ilk sözcük ("K u l l a n ı c ı (sen)") tek harfler birleştirilerek okunur."""
    import unicodedata  # noqa: PLC0415

    from studio.graph.forget import fold  # noqa: PLC0415 - unutmanın harf benzeri katlaması (Kiril/Yunan → Latin)
    raw = unicodedata.normalize("NFKC", str(value or ""))
    ms = list(re.finditer(r"[^\W_]+", raw))
    if not ms:
        return False
    parts = [m.group() for m in ms]
    k = 0  # ilk sözcüğün son parçası
    if len(parts[0]) == 1:
        while k + 1 < len(parts) and len(parts[k + 1]) == 1:
            k += 1
    head = parts[:k + 1]
    qualified = False
    if k + 1 < len(ms):
        sep = raw[ms[k].end():ms[k + 1].start()]
        visible = "".join(ch for ch in sep if not ch.isspace() and unicodedata.category(ch)[0] != "C")
        qualified = not (visible == "" or sep in ("-", "_"))  # boşluklu " - " niteleyicidir; "user-main" değil
    folders: tuple[Callable[[str], str], ...] = (fold, lambda x: fold(x.lower()))
    for folder in folders:
        if _reserved_core(parts, folder) in RESERVED_AGENT_SLUGS:
            return True
        if qualified and _reserved_core(head, folder) in RESERVED_AGENT_SLUGS:
            return True
    return False


class AgentRegistry:
    # COS-A: kozmetik mağaza kıyafeti (`avatar.wear`). `cosmetics.api` kaydeder (sahip olunan ve giyilebilir `store:*`
    # parçası → öğe kimliği, değilse None). Kayıt yoksa `wear` atılır (fail-closed): iade edilmiş ya da sahip olunmayan
    # parça ajana kaydedilmez.
    wear_filter: Callable[[Any], str | None] | None = None

    def _clean_wear(self, avatar: Any) -> Any:
        if not isinstance(avatar, dict) or "wear" not in avatar:
            return avatar
        out = dict(avatar)
        wear = out.pop("wear")
        keep = None
        if wear and self.wear_filter is not None:
            try:
                keep = self.wear_filter(wear)
            except Exception:  # noqa: BLE001 - emin değilsek giydirme
                keep = None
        if keep:
            out["wear"] = keep
        return out

    def __init__(self, store: GraphStore, settings: Settings):
        self.store = store
        self.settings = settings
        self.ollama_models: list[dict[str, Any]] = []
        # Hermes skill / araç seti keşfi (salt okunur, önbellekli) — doğrulama ve HAS_SKILL için
        self.caps = caps_for(settings)

    # ------------------------------------------------------------ keşif
    def sync_profiles(self) -> dict[str, int]:
        added = updated = 0
        existing = self.store.nodes("Agent", limit=self.MAX_LIST)
        for i, prof in enumerate(scan_profiles(Path(self.settings.get("hermes_home")))):
            info = {"profile_model": prof["model"], "profile_provider": prof["provider"],
                    "has_codex_auth": prof["has_codex_auth"]}
            node = next((n for n in existing if n["props"].get("hermes_profile") == prof["profile"]), None)
            if node:
                self.store.patch_node(node["id"], info)
                updated += 1
                continue
            known = KNOWN_PROFILES.get(prof["profile"], {})
            preset = AVATAR_PRESETS[known.get("preset", (len(existing) + i) % len(AVATAR_PRESETS))]
            conn = infer_connection(prof["provider"], prof["base_url"], self.settings.get("ollama_url"))
            name = known.get("name", prof["profile"].replace("-", " ").title())
            slug_base = prof["profile"]
            if reserved_agent_slug(slug_base) or reserved_agent_slug(name):  # "system" adlı Hermes profili
                # "User (Hermes)" ilk sözcük + niteleyici kuralına takılır; "… profili (Hermes)" doğal ad öbeğidir
                slug_base, name = f"hermes-{slug_base}", f"{name} profili (Hermes)"
            props = {
                "slug": self._free_slug(slug_base),
                "name": name,
                "role": known.get("role", "Hermes profili"),
                "persona": "",
                "color": PALETTE[(len(existing) + i) % len(PALETTE)],
                "avatar": dict(preset),
                "hermes_profile": prof["profile"],
                "runtime": "hermes",
                "connection": conn,
                "model": prof["model"] if conn != "profile" else "",
                "permissions": "read",
                "memory_scope": "shared",
                "memory_enabled": True,
                # Anahtarsız varsayılan profil kalabalık yapmasın diye gizli başlar.
                "hidden": prof["profile"] == "default",
                # gizli ajan da koltuk sayılır; sistemin gizlediği profil koltuk tutmasın diye yedekte doğar
                **({"benched": True} if prof["profile"] == "default" else {}),
                "created_by": "hermes",
                **info,
            }
            node = self.store.upsert_node("Agent", props)
            existing.append(node)
            self._link_brain(node)
            added += 1
        result: dict[str, Any] = {"added": added, "updated": updated}
        starter = self.ensure_starter_team()
        if starter:
            result["starter"] = starter
        return result

    # ------------------------------------------------------------ başlangıç ekibi (S8)
    def available_brains(self) -> dict[str, Any]:
        """Kurulu bağlantılar — süreç başlatmadan (PATH ve bilinen kurulum yolları; Ollama için son model listesi).

        Ofis kurulumu ve yeni ajan varsayılanı da bunu kullanabilir (Hermes'e bağımlı varsayılan yok)."""
        home = Path(self.settings.get("hermes_home"))
        hermes = hermes_available(home)
        profiles: list[str] = []
        if hermes:
            try:
                profiles = list(self.caps.profile_dirs())
            except Exception:  # noqa: BLE001 - bozuk Hermes kurulumu açılışı engellemesin
                profiles = []
        # FOLLOWUP: yalnız uzak Ollama sunucusu olan kullanıcı da "Ollama var" görür (ilk kullanımda onay yine sorulur)
        return {"ollama": any(m.get("local") or self._remote_host_model(m) for m in self.ollama_models),
                "codex": find_codex() is not None, "claude": find_claude() is not None,
                "openai_compat": endpoint_api.get_endpoint(self.settings) is not None,  # S37: herhangi bir API bağlantısı
                "hermes": hermes and bool(profiles), "hermes_profiles": profiles}

    def usable_brains(self) -> dict[str, Any]:
        """ŞU AN kullanılabilir beyinler — `available_brains` (kurulu) + hazır olma: Codex/Claude oturumu açık
        (oturum dosyası ya da API anahtarı; bilinmiyorsa — macOS anahtar zinciri — hazır sayılmaz), Ollama'ya ulaşıldı ve
        bulut olmayan bir model var (son model listesi), Hermes profili gerçek (işaret dosyası olan profil; boş klasör değil)
        ve model politikası izin veriyor. Süreç başlatmaz, ağa çıkmaz. Başlangıç ekibi bunu kullanır."""
        b = self.available_brains()
        out: dict[str, Any] = {"ollama": False, "codex": False, "claude": False, "hermes": False, "hermes_profiles": []}
        model = self.default_ollama_model(for_hermes=False) if b.get("ollama") else None
        out["ollama"] = model is not None and self._policy_ok("ollama", model)
        if b.get("codex"):
            out["codex"] = codex_session_state().get("logged_in") is True and self._policy_ok("codex")
        if b.get("claude"):
            out["claude"] = claude_login_state().get("logged_in") is True and self._policy_ok("claude")
        if b.get("hermes") and self._policy_ok("profile"):
            real = {p["profile"] for p in scan_profiles(Path(self.settings.get("hermes_home")))}
            out["hermes_profiles"] = [p for p in b.get("hermes_profiles") or [] if p in real]
            out["hermes"] = bool(out["hermes_profiles"])
        return out

    def _policy_ok(self, connection: str, model: str | None = None) -> bool:
        try:
            return model_policy.allowed_brain(self.settings, connection, model)
        except Exception:  # noqa: BLE001 - politika okunamazsa rota yine denetler
            return True

    def default_connection(self, brains: dict[str, Any] | None = None) -> str:
        """Doğrudan çalışma zamanı için varsayılan beyin: yerel Ollama modeli → Codex → Claude Code → Ollama."""
        b = brains or self.available_brains()
        for conn in ("ollama", "codex", "claude", "openai_compat"):
            if b.get(conn):
                return conn
        return "ollama"

    def _hermes_web_profile(self, brains: dict[str, Any]) -> str | None:
        """Web araç seti açık ilk Hermes profili (araştırmacı için)."""
        for profile in brains.get("hermes_profiles") or []:
            try:
                if "web" in self.caps.enabled_toolsets(profile, "cli"):
                    return profile
            except Exception:  # noqa: BLE001
                continue
        return None

    def _starter_brain(self, spec: dict[str, Any], brains: dict[str, Any]) -> dict[str, Any]:
        """Sıra kuralı (eski arayüz): hiçbiri yoksa son seçenek. Tohum `_starter_pick` kullanır (yoksa beyinsiz)."""
        picked = self._starter_pick(spec, brains)
        if picked:
            return picked
        return {"runtime": "direct", "connection": spec["brains"][-1] if spec["brains"][-1] != "hermes" else "ollama",
                "model": ""}

    def _starter_pick(self, spec: dict[str, Any], brains: dict[str, Any]) -> dict[str, Any] | None:
        """`brains` içinde hazır olan ilk beyin (sıra `spec["brains"]`); hiçbiri hazır değilse None."""
        for brain in spec["brains"]:
            if brain == "hermes":
                profile = self._hermes_web_profile(brains) if brains.get("hermes") else None
                if profile:
                    return {"runtime": "hermes", "hermes_profile": profile, "connection": "profile", "model": ""}
            elif brain == "ollama":
                if brains.get("ollama"):
                    return {"runtime": "direct", "connection": "ollama", "model": ""}
            elif brains.get(brain):
                return {"runtime": "direct", "connection": brain, "model": ""}
        return None

    def ensure_starter_team(self) -> list[str]:
        """Taze kurulumda (görünür ajan yoksa) başlangıç ekibini bir kez oluşturur. İdempotent: değerlendirme
        `onboarding.starter_seeded` ile işaretlenir; silinen başlangıç ajanları geri gelmez, var olan slug atlanır."""
        if self.settings.get("onboarding.starter_seeded"):
            return []
        nodes = self.store.nodes("Agent", limit=self.MAX_LIST)
        created: list[str] = []
        if not any(not n["props"].get("hidden") for n in nodes):
            brains = self.usable_brains()  # kurulu değil, şu an hazır olan beyinler
            lang = agent_lang(self.settings)  # ayar yoksa isteğin dili (ilk açılışı tetikleyen tarayıcı)
            for spec in STARTER_TEAM:
                if self.store.find("Agent", spec["slug"]):
                    continue
                data = {k: spec[k] for k in ("slug", "name", "title", "rank", "role", "persona", "permissions",
                                             "color")}
                if lang != "tr":
                    data.update(spec.get(lang) or {})
                data["avatar"] = dict(spec["avatar"])
                brain = self._starter_pick(spec, brains)
                # hazır beyin yok: beyinsiz doğar (bağlantı ontoloji gereği yer tutucu; rota "Beyin seçilmedi")
                data.update(brain or {"runtime": "direct", "connection": "ollama", "model": ""})
                created.append(self.create(data, needs_brain=brain is None)["slug"])
        try:
            self.settings.update({"onboarding": {"starter_seeded": True, "starter_agents": created}})
        except OSError:
            pass  # ayar dosyası yazılamazsa bir sonraki açılışta slug denetimi yine çift oluşturmayı önler
        return created

    def _free_slug(self, base: str) -> str:
        slug, n = slugify(base), 2
        while self.store.find("Agent", slug):
            slug = f"{slugify(base)}-{n}"
            n += 1
        return slug

    # ------------------------------------------------------------ CRUD
    MAX_LIST = 5000  # TOTAL_AGENT_CAP üstü güvenli tavan

    def _list_filters(self, include_hidden: bool, q: str | None, team: str | None) -> dict[str, Any]:
        props: dict[str, Any] = {}
        if team:
            props["team"] = team
        if not include_hidden:
            # hidden yok ya da false → [NULL, 0]; ifade indeksi ix_nodes_hidden kullanılır
            props["hidden"] = [None, 0]
        return {"props": props or None, "q": q or None}

    def list(self, include_hidden: bool = True, *, q: str | None = None, team: str | None = None,
             limit: int | None = None, offset: int = 0) -> list[dict[str, Any]]:
        """Ajanlar oluşturulma sırasıyla (parametresiz: tümü, gizliler dahil — eski davranış).
        Süzgeç ve sayfalama SQL tarafında: q (ad/slug metni), team, limit/offset. N+1 sorgu yok: tek liste
        sorgusu; serileştirme bellek içidir."""
        filters = self._list_filters(include_hidden, q, team)
        props = filters["props"] or {}
        if "hidden" in props:  # IN (NULL, 0) NULL'u yakalamaz: SQL'de hidden!=1 için iki sorgu yerine Python süzgeci
            props = {k: v for k, v in props.items() if k != "hidden"}
            nodes = self.store.nodes("Agent", limit=self.MAX_LIST, order="created_at ASC", props=props or None,
                                     q=filters["q"])
            nodes = [n for n in nodes if not n["props"].get("hidden")]
            nodes = nodes[offset:offset + limit] if limit is not None else nodes[offset:]
        else:
            nodes = self.store.nodes("Agent", limit=self.MAX_LIST if limit is None else limit, order="created_at ASC",
                                     offset=offset, props=props or None, q=filters["q"])
        return [self.serialize(n) for n in nodes]

    def count(self, include_hidden: bool = True, *, q: str | None = None, team: str | None = None) -> int:
        filters = self._list_filters(include_hidden, q, team)
        props = filters["props"] or {}
        if "hidden" in props:
            props = {k: v for k, v in props.items() if k != "hidden"}
            return sum(1 for n in self.store.nodes("Agent", limit=self.MAX_LIST, props=props or None, q=filters["q"])
                       if not n["props"].get("hidden"))
        return self.store.count("Agent", props=props or None, q=filters["q"])

    def node(self, slug: str) -> dict[str, Any] | None:
        return self.store.find("Agent", slug)

    def get(self, slug: str) -> dict[str, Any] | None:
        n = self.node(slug)
        return self.serialize(n) if n else None

    def create(self, data: dict[str, Any], *, eval_matrix: str | None = None,
               eval_temp: str | None = None, needs_brain: bool = False) -> dict[str, Any]:
        """`eval_matrix`: yalnız değerlendirme matrisi/booster kapısı geçici ajanı için iç işaret (kimlik);
        olağan yollar `eval-mx`/`evalmx` önekli ajan oluşturamaz (ValueError → 400). `eval_temp`: klasik
        değerlendirmenin geçici ajanı için iç işaret (görünümler yalnız işaretli ajanı gizler; ada/öneke bakılmaz)."""
        name = (data.get("name") or "Yeni ajan").strip()
        count = len(self.store.nodes("Agent", limit=self.MAX_LIST))
        runtime = data.get("runtime") or ("hermes" if data.get("hermes_profile") else "direct")
        # Bağlantı verilmediyse doğrudan çalışmada kurulu bir beyin seçilir (yalnızca Ollama varsayımı yok).
        connection = data.get("connection") or (self.default_connection() if runtime == "direct" else "ollama")
        from studio.graph import namespace as nsm  # noqa: PLC0415
        slug = self._free_slug(data.get("slug") or name)
        if not eval_matrix and (nsm.is_reserved(slug) or nsm.is_reserved(str(data.get("slug") or ""))):
            raise ValueError(nsm.ERR_RESERVED.format(slug))
        check_reserved_agent(data.get("slug"), data.get("name"), slug)  # (yazılan değer önce)
        props = {
            "slug": slug,
            "name": name,
            "role": data.get("role", ""),
            "persona": data.get("persona", ""),
            "color": data.get("color") or PALETTE[count % len(PALETTE)],
            "avatar": self._clean_wear(data.get("avatar")) or preset_for(name, count),
            "hermes_profile": data.get("hermes_profile") or None,
            "runtime": runtime,
            "connection": connection,
            "model": data.get("model") or "",
            "permissions": data.get("permissions") or "read",
            "memory_scope": data.get("memory_scope") or "shared",
            "memory_enabled": bool(data.get("memory_enabled", True)),
            "hidden": False,
            "created_by": "studio",
        }
        if self.settings is not None and self.settings.get("limits.new_agents_read_only", False) is True:
            props["permissions"] = "read"  # TRUST güvenli mod: yeni ajan salt okuma doğar (sonra elle açılabilir)
        caps_patch = {k: data[k] for k in ("skills", "toolsets", "reasoning", "transport") if k in data}
        self._check_caps(caps_patch, {**props, **caps_patch}, previous=None)
        props.update({k: v for k, v in caps_patch.items() if v not in (None, [])})
        # Faz 3: ofis konumu ve işe alım kaydı (devretme motoru işe aldığı ajanı bu alanlarla oluşturur)
        org = {k: data[k] for k in ("team", "title", "reports_to", "rank") if data.get(k)}
        self._check_org(props["slug"], org)
        props.update(org)
        props.update({k: data[k] for k in ("hired_by", "hired_in_run") if data.get(k)})
        # E1: koltuk doluysa ajan yedekte doğar (silinmez, değişim ücretsiz). Motor yalnız create_app'te bağlıdır.
        from studio.entitlements import gate  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın
        if (ent := gate(self)) is not None and not ent.check("seats").allowed:
            props["benched"] = True
        if eval_matrix:
            props["eval_matrix"] = str(eval_matrix)
        if eval_temp:
            props["eval_temp"] = str(eval_temp)
        if needs_brain:  # yalnız başlangıç tohumu yazar (olağan API'ler yazamaz)
            props["needs_brain"] = True
        node = self.store.upsert_node("Agent", props)
        if not needs_brain:  # yer tutucu bağlantı grafa beyin bağı olarak yazılmaz
            self._link_brain(node)
        if props.get("skills"):
            self._sync_skills(node)
        if org.get("team") or org.get("reports_to"):
            self._sync_org(node)
        return self.serialize(node)

    EDITABLE = {"name", "role", "persona", "color", "avatar", "hermes_profile", "runtime", "connection",
                "model", "permissions", "memory_scope", "memory_enabled", "hidden",
                # Faz 2: Hermes yetenekleri ve ofis alanları
                "skills", "toolsets", "reasoning", "team", "title", "reports_to", "transport",
                # Faz 3: rütbe (ceo … intern; ontoloji enum'u doğrular)
                "rank"}

    def update(self, slug: str, patch: dict[str, Any]) -> dict[str, Any]:
        node = self.node(slug)
        if not node:
            raise KeyError(slug)
        clean = {k: v for k, v in patch.items() if k in self.EDITABLE}
        if "name" in clean and clean["name"] != node["props"].get("name"):  # yeniden adlandırma
            check_reserved_agent(clean["name"])
        if "avatar" in clean:
            clean["avatar"] = self._clean_wear(clean["avatar"])
        self._check_caps(clean, {**node["props"], **clean}, previous=node["props"])
        self._check_org(slug, clean)
        if node["props"].get("needs_brain") and {"connection", "runtime", "hermes_profile"} & clean.keys():
            clean["needs_brain"] = False  # kullanıcı beyin seçti
        node = self.store.patch_node(node["id"], clean)
        if {"connection", "model"} & clean.keys():
            self._link_brain(node)
        if {"skills", "runtime", "hermes_profile"} & clean.keys():
            self._sync_skills(node)
        if {"team", "reports_to"} & clean.keys():
            self._sync_org(node)
        return self.serialize(node)

    # ------------------------------------------------------------ ofis alanları (QA-m6)
    def _check_org(self, slug: str, clean: dict[str, Any]) -> None:
        """reports_to döngüsünü ve bilinmeyen ekip/yöneticiyi reddeder (ofis API'siyle aynı kurallar)."""
        team = clean.get("team")
        if team and not self.store.find("Team", team):
            raise ValueError(f"Böyle bir ekip yok: {team}")
        boss = clean.get("reports_to")
        if not boss:
            return
        if boss == slug:
            raise ValueError("Bir ajan kendine raporlayamaz")
        seen = {slug}
        cur: str | None = boss
        while cur:
            if cur in seen:
                raise ValueError("Raporlama döngüsü oluşur; bu yönetici zaten bu ajana bağlı")
            seen.add(cur)
            node = self.store.find("Agent", cur)
            if not node:
                raise ValueError(f"Böyle bir yönetici yok: {cur}")
            cur = node["props"].get("reports_to")

    def _sync_org(self, node: dict[str, Any]) -> None:
        p = node["props"]
        self.store.unlink("MEMBER_OF", node["id"])
        if p.get("team") and (team := self.store.find("Team", p["team"])):
            self.store.link("MEMBER_OF", node["id"], team["id"])
        self.store.unlink("REPORTS_TO", node["id"])
        if p.get("reports_to") and (boss := self.store.find("Agent", p["reports_to"])):
            self.store.link("REPORTS_TO", node["id"], boss["id"])

    # ------------------------------------------------------------ Hermes yetenekleri (skill, araç seti, …)
    def _check_caps(self, clean: dict[str, Any], merged: dict[str, Any],
                    previous: dict[str, Any] | None) -> None:
        """skills / toolsets / reasoning / transport alanlarını doğrular ve `clean` içinde normalize eder.

        Yalnızca YENİ eklenen skill ve araç setleri denetlenir: daha önce atanmış ama sonradan profilden
        kalkmış bir skill ("eksik") başka bir değişikliği engellemez; çalıştırmada zaten gönderilmez.
        """
        if "reasoning" in clean:
            v = clean["reasoning"]
            if v in (None, "", "default"):
                clean["reasoning"] = None
            elif v not in REASONING_LEVELS:
                raise ValueError(f"Geçersiz akıl yürütme düzeyi: {v}. Geçerli değerler: {', '.join(REASONING_LEVELS)}")
        if "transport" in clean:
            v = clean["transport"]
            if v in (None, ""):
                clean["transport"] = None
            elif v not in TRANSPORTS:
                raise ValueError(f"Geçersiz taşıma: {v}. Geçerli değerler: {', '.join(TRANSPORTS)}")

        profile = merged.get("hermes_profile") or "default"
        use_hermes = merged.get("runtime") == "hermes"
        same_target = bool(previous) and (previous.get("hermes_profile") or "default") == profile \
            and previous.get("runtime") == merged.get("runtime")

        for field in ("skills", "toolsets"):
            if field not in clean:
                continue
            if clean[field] is not None and not isinstance(clean[field], (list, tuple)):
                raise ValueError(f"{field} bir liste olmalı")
            clean[field] = clean_name_list(clean[field])

        if clean.get("skills"):
            before = set((previous or {}).get("skills") or []) if same_target else set()
            new = [s for s in clean["skills"] if s not in before]
            # VoxCrew (vox:<id>) ve Claude (claude:<ad>) skill'leri Hermes profilinde aranmaz: bağlayıcı bunları
            # -s'ten eler, skill istem aşaması (S14) isteme ekler. Yalnızca çıplak Hermes adları profilde denetlenir.
            new = [s for s in new if not str(s).startswith(("vox:", "claude:"))]
            if new and use_hermes:
                try:
                    index = self.caps.skill_index(profile)
                except KeyError:
                    raise ValueError(f"'{profile}' Hermes profili bulunamadı; skill atanamaz") from None
                for s in new:
                    entry = index.get(s)
                    if not entry:
                        raise ValueError(f"'{s}' skill'i '{profile}' profilinde kurulu değil")
                    reason = self.caps.skill_reason(entry)
                    if reason:
                        raise ValueError(f"'{s}' skill'i atanamaz: {reason}")

        if clean.get("toolsets"):
            before = set((previous or {}).get("toolsets") or []) if same_target else set()
            new = [t for t in clean["toolsets"] if t not in before]
            if new:
                names = self.caps.toolset_names(profile if use_hermes else None)
                unknown = [t for t in new if t not in names]
                if unknown:
                    raise ValueError(f"Bilinmeyen araç seti: {', '.join(unknown)}")
                registry = self.caps.toolset_registry()
                foreign = [t for t in new if not toolset_allowed(t, registry, "cli")]
                if foreign:
                    raise ValueError(f"Bu araç setleri yalnızca kendi mesajlaşma platformunda çalışır, CLI'da "
                                     f"kullanılamaz: {', '.join(foreign)}")
                if use_hermes:
                    try:
                        off = self.caps.profile_disabled_toolsets(profile)
                    except KeyError:
                        off = set()
                    blocked = [t for t in new if t in off]
                    if blocked:
                        raise ValueError(f"Bu araç setleri '{profile}' profilinde kapalı (agent.disabled_toolsets) ve "
                                         f"-t ile açılamaz: {', '.join(blocked)}")

    def _sync_skills(self, node: dict[str, Any]) -> None:
        """Agent -HAS_SKILL-> Skill kenarlarını ajanın skill listesiyle eşler (çıkarılanların kenarı silinir)."""
        p = node["props"]
        self.store.unlink("HAS_SKILL", node["id"])
        skills = list(p.get("skills") or [])
        if not skills:
            return
        index: dict[str, dict[str, Any]] = {}
        if p.get("runtime") == "hermes":
            try:
                index = self.caps.skill_index(p.get("hermes_profile") or "default")
            except KeyError:
                index = {}
        for name in skills:
            entry = index.get(name)
            props: dict[str, Any] = {"name": entry["name"] if entry else name}
            if entry:
                props.update({"description": entry["description"][:1000] or None, "category": entry["category"],
                              "source": entry["source"], "path": entry["path"]})
            skill = self.store.upsert_node("Skill", props)
            self.store.link("HAS_SKILL", node["id"], skill["id"])

    def delete(self, slug: str) -> None:
        node = self.node(slug)
        if not node:
            raise KeyError(slug)
        # Claude `~/.claude` devralma onayı yalnız bu örneğe aitti; silinen ajanın kaydı da silinir
        try:
            from studio.connectors import claude_isolation  # noqa: PLC0415

            claude_isolation.forget(self.settings, slug, claude_isolation.instance_of(node))
            from studio.connectors import codex_isolation  # noqa: PLC0415 - PROC-FIX

            codex_isolation.forget(self.settings, claude_isolation.instance_of(node))
        except Exception:  # noqa: BLE001 - kayıt silinemese de yeni örnek (farklı kimlik) yalıtılmış başlar
            pass
        if node["props"].get("created_by") == "hermes":
            # Hermes profilleri bir sonraki taramada geri gelir; gizlemek yeterli ve geri alınabilir.
            self.store.patch_node(node["id"], {"hidden": True, "benched": True})  # koltuğu da bırakır
        else:
            # B-16: ajanın anıları silinmez ama sahipliği mezar taşı değerine taşınır; aynı slug ile sonradan
            # oluşturulan ajan eski (özel) anıları devralmaz. Ad alanı damgaları olduğu gibi kalır.
            from studio.graph.memory import retire_agent_memories  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın

            with self.store.bulk():
                retire_agent_memories(self.store, slug)
                self.store.delete_node(node["id"])

    def _link_brain(self, node: dict[str, Any]) -> None:
        p = node["props"]
        conn = self.store.upsert_node("Connection", {"kind": p.get("connection", "profile"),
                                                     "name": CONNECTION_NAMES.get(p.get("connection", "profile"), "?")})
        self.store.unlink("USES_CONNECTION", node["id"])
        self.store.link("USES_CONNECTION", node["id"], conn["id"])
        self.store.unlink("PREFERS_MODEL", node["id"])
        if p.get("model"):
            model = self.store.upsert_node("Model", {"name": p["model"], "connection": p.get("connection")})
            self.store.link("PREFERS_MODEL", node["id"], model["id"])
            self.store.link("SERVED_BY", model["id"], conn["id"])

    # ------------------------------------------------------------ rota
    @staticmethod
    def _remote_host_model(m: dict[str, Any]) -> bool:
        """Uzak (bu bilgisayar olmayan) Ollama sunucusundaki bulut olmayan model ( sonrası local:false)."""
        return not m.get("local") and bool(m.get("host")) and not m.get("cloud")

    def default_ollama_model(self, for_hermes: bool) -> str | None:
        """Önce yerel model; yoksa uzak Ollama sunucusundaki model (FOLLOWUP). Uzak modelin ilk kullanımında politika
        (connections/policy.py) yine `ollama-remote:<host>` onayı ister; bulut modelleri varsayılan olmaz."""
        for pool in ([m for m in self.ollama_models if m.get("local")],
                     [m for m in self.ollama_models if self._remote_host_model(m)]):
            if for_hermes:
                ready = [m for m in pool if m.get("hermes_ready")]
                if ready:
                    return ready[0]["name"]
            else:
                # BRAINS-LIVE: doğrudan çalışmada Hermes için açılmış uzun bağlamlı kopya (Modelfile num_ctx ≥ 64K) varsayılan
                # olmaz — liste Hermes uyumluları öne sıralar; o kopya her istemde 64K KV önbelleği ayırır (CPU'da dakikalar)
                plain = [m for m in pool if not _long_ctx_copy(m)]
                if plain:
                    return plain[0]["name"]
            if pool:
                return pool[0]["name"]
        return None

    def smallest_ollama_model(self) -> str | None:
        """Bağlantı testi için bu bilgisayardaki en küçük yerel model (boyut; uzun bağlamlı kopya en sona). Bulut ve uzak
        sunucu modelleri seçilmez; yerel model yoksa None (çağıran `default_ollama_model`a döner)."""
        pool = [m for m in self.ollama_models if m.get("local") and not m.get("cloud")]
        if not pool:
            return None

        def key(m: dict[str, Any]) -> tuple[bool, float, str]:
            size = m.get("size_bytes")
            ok = isinstance(size, (int, float)) and not isinstance(size, bool) and size > 0
            return (_long_ctx_copy(m), float(size) if ok else float("inf"), str(m.get("name") or ""))

        return str(min(pool, key=key)["name"])

    def route(self, agent: dict[str, Any], connection: str | None = None, model: str | None = None) -> Route:
        """Rota + model erişim politikası (S37, connections/policy.py). İzinsiz model → RouteError; motor adımı bu
        iletiyle düşürür, başka modele sessizce geçilmez. Yönetici/test modu politikayı aşmaz."""
        r = AgentRegistry._resolve_route(self, agent, connection, model)  # type: ignore[arg-type]
        remote = cloud = None
        if r.connection == "ollama":
            m = next((x for x in getattr(self, "ollama_models", None) or [] if x.get("name") == r.model), None)
            remote = (not m.get("local", True)) if m else None
            cloud = m.get("cloud") if m and "cloud" in m else None
        try:
            model_policy.enforce(self.settings, r, ollama_remote=remote, ollama_cloud=cloud)
        except model_policy.PolicyError as exc:
            raise RouteError(str(exc)) from None
        return r

    def _resolve_route(self, agent: dict[str, Any], connection: str | None = None, model: str | None = None) -> Route:
        p = agent.get("props", agent)
        if p.get("needs_brain") and not connection:  # beyinsiz başlangıç ajanı (açık bağlantı geçersiz kılar)
            raise RouteError(NO_BRAIN)
        conn = connection or p.get("connection") or "profile"
        if connection and connection != p.get("connection"):
            chosen = model or None
        else:
            chosen = model or p.get("model") or None
        profile = p.get("hermes_profile")
        use_hermes = p.get("runtime") == "hermes" and bool(profile)

        if conn == "claude":
            return Route("claude", "claude", chosen)
        if conn == "openai_compat":  # S29/S37: adlandırılmış API bağlantısı (LM Studio, Mistral, Claude API…; doğrudan)
            # model alanı "<uç nokta>::<model>" olabilir (endpoints.model_ref); kimliksizse varsayılan uç nokta
            eid, bare = endpoint_api.parse_model_ref(chosen)
            ep = endpoint_api.get_endpoint(self.settings, eid)
            if ep is None:
                if eid:
                    raise RouteError(f"API bağlantısı bulunamadı: {eid} (Bağlantılar → Model API'leri)")
                raise RouteError("OpenAI uyumlu sunucu ayarlanmadı (Bağlantılar → OpenAI uyumlu sunucu)")
            # Koşu adımlarında da "Mistral AI · model" görünsün (yalnız ajan kartında değil; AUDIT D-06)
            return Route("openai_compat", "openai_compat", bare or ep["model"] or None, ep["id"],
                         endpoint_label=(ep.get("label") or None) if ep["id"] != endpoint_api.LEGACY_ID else None)
        if use_hermes:
            if conn == "profile":
                return Route("hermes", "profile", None, None, profile)
            if conn == "ollama":
                chosen = chosen or self.default_ollama_model(for_hermes=True)
                if not chosen:
                    raise RouteError("Ollama'da kurulu model yok")
                return Route("hermes", "ollama", chosen, "custom", profile)
            if conn == "codex":
                if not chosen:
                    chosen = (p.get("profile_model") if p.get("profile_provider") == "openai-codex"
                              else self.settings.get("codex_hermes_model"))
                return Route("hermes", "codex", chosen, "openai-codex", profile)
        else:
            if conn == "profile":
                raise RouteError("'Profil ayarı' yalnızca Hermes çalışma zamanında kullanılabilir")
            if conn == "ollama":
                chosen = chosen or self.default_ollama_model(for_hermes=False)
                if not chosen:
                    raise RouteError("Ollama'da kurulu model yok")
                return Route("ollama", "ollama", chosen)
            if conn == "codex":
                return Route("codex", "codex", chosen)
        raise RouteError(f"Bilinmeyen bağlantı: {conn}")

    def serialize(self, node: dict[str, Any]) -> dict[str, Any]:
        p = node["props"]
        data = {"id": node["id"], **p, "updated_at": node["updated_at"]}
        if node.get("created_at"):  # örnek damgası (Claude ~/.claude devralma kaydı kimlik + damgaya bağlı)
            data["created_at"] = node["created_at"]
        if isinstance(p.get("avatar"), dict) and "wear" in p["avatar"]:
            data["avatar"] = self._clean_wear(p["avatar"])  # iade edilmiş parça okumada da görünmez
        from studio.i18n import translate  # S19: rota etiketi/uyarısı/hatası istek dilinde (TR'de değişmez)

        data.update(starter_display(p))

        try:
            r = self.route(node)
            data["route"] = r.to_dict()
            data["route"]["label"] = translate(data["route"]["label"])
            if r.connector == "openai_compat" and r.provider:  # S37: "Mistral AI · mistral-small-latest"
                ep = endpoint_api.get_endpoint(self.settings, r.provider)
                if ep:
                    data["route"]["label"] = ep["label"] + (f" · {r.model}" if r.model else "")
                    data["route"]["endpoint"] = ep["id"]
                    if not endpoint_api.is_local_url(ep["base_url"]):
                        data["route"]["remote"] = True
            if r.connector == "hermes" and r.connection == "codex" and not p.get("has_codex_auth"):
                data["route"]["warning"] = translate("Bu Hermes profilinde Codex oturumu yok (hermes auth gerekebilir)")
            if r.connector == "hermes" and r.connection == "ollama":
                m = next((m for m in self.ollama_models if m["name"] == r.model), None)
                if m and not m.get("hermes_ready"):
                    data["route"]["warning"] = translate("Hermes ≥64K bağlam ister; bu model için num_ctx ayarlı değil")
            data["route_error"] = None
        except RouteError as exc:
            data["route"] = None
            data["route_error"] = translate(str(exc))
        return data


CONNECTION_NAMES = {"ollama": "Ollama", "codex": "GPT Codex", "claude": "Claude Code", "profile": "Hermes profil ayarı",
                    "openai_compat": "OpenAI uyumlu sunucu"}
