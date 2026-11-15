"""Yollar ve kalıcı ayarlar (<veri dizini>/settings.json). Yalnızca DEFAULTS'ta tanımlı anahtarlar yazılabilir.

Ortam değişkenleri (hepsi isteğe bağlı):
- `STUDIO_DATA_DIR`  veri dizini (graf veritabanı, ayarlar, kullanıcı iş akışları, çalışma klasörü)
- `STUDIO_PORT`      sunucu portu (varsayılan 7420)
- `STUDIO_WORKDIR`   ajanların dosya okuyup yazdığı çalışma klasörü (varsayılan <veri dizini>/workspace)
- `HERMES_HOME`      Hermes Agent kök klasörü (varsayılan ~/.hermes; Hermes isteğe bağlıdır)
- `OLLAMA_HOST`      Ollama adresi (`127.0.0.1:11434`, `http://host:port` …; varsayılan http://127.0.0.1:11434)
- `STUDIO_ALLOWED_HOSTS` ek Host adları (bkz. security.py)
- `STUDIO_FRONTEND_DIST` sunulan arayüz derleme klasörü (varsayılan depodaki frontend/dist; yalnız deneme için)

Ortam değişkeni ayarlıysa kayıtlı ayarın önüne geçer (açılışta uygulanır).

Veri dizini önceliği (geriye uyumlu):
1. `STUDIO_DATA_DIR`
2. depo kökündeki `data/` klasörü VARSA (kaynaktan çalıştırılan eski kurulumlar olduğu gibi çalışmaya devam eder)
3. platform varsayılanı: Windows `%LOCALAPPDATA%\\VoxCrew`, macOS `~/Library/Application Support/VoxCrew`,
   Linux `$XDG_DATA_HOME/voxcrew` (yoksa `~/.local/share/voxcrew`)
Taşıma isteğe bağlıdır: eski `data/` klasörünü platform dizinine taşımak isteyen, klasörü taşıyıp (ya da
`STUDIO_DATA_DIR` ile gösterip) uygulamayı yeniden başlatır; uygulama kendiliğinden hiçbir şey taşımaz.
"""

from __future__ import annotations

import copy
import json
import logging
import os
import shutil
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit

from studio._edition import EDITION

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
# STALE-DIST: `STUDIO_FRONTEND_DIST` sunulan derleme klasörünü değiştirir (yalnız deneme: eski bir dist kopyasını ayrı portta
# sunmak); verilmezse depodaki frontend/dist.
FRONTEND_DIST = (Path(os.environ["STUDIO_FRONTEND_DIST"].strip()).expanduser()
                 if os.environ.get("STUDIO_FRONTEND_DIST", "").strip() else ROOT / "frontend" / "dist")
ONTOLOGY_FILE = BACKEND_DIR / "ontology" / "studio.ontology.yaml"
LEGACY_DATA_DIR = ROOT / "data"
DEFAULT_PORT = 7420
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"


def platform_data_dir(env: Mapping[str, str] | None = None, platform: str | None = None,
                      home: Path | None = None) -> Path:
    """İşletim sistemine uygun kullanıcı veri dizini (oluşturmaz)."""
    env = os.environ if env is None else env
    platform = platform or sys.platform
    home = home or Path.home()
    if platform == "win32":
        base = env.get("LOCALAPPDATA") or env.get("APPDATA")
        return (Path(base) if base else home / "AppData" / "Local") / "VoxCrew"
    if platform == "darwin":
        return home / "Library" / "Application Support" / "VoxCrew"
    xdg = env.get("XDG_DATA_HOME")
    return (Path(xdg) if xdg and Path(xdg).is_absolute() else home / ".local" / "share") / "voxcrew"


def platform_state_dir(env: Mapping[str, str] | None = None, platform: str | None = None,
                       home: Path | None = None) -> Path:
    """Kullanıcı DURUM dizini (veri dizininden AYRI; veri klasörü yedekten dönse de bu dönmez). graf günlüğünün
    veri klasörü dışındaki parmak izi burada tutulur. `STUDIO_STATE_DIR` ile geçersiz kılınır (oluşturmaz)."""
    env = os.environ if env is None else env
    explicit = (env.get("STUDIO_STATE_DIR") or "").strip()
    if explicit:
        return Path(explicit).expanduser()
    platform = platform or sys.platform
    home = home or Path.home()
    if platform == "win32":
        base = env.get("LOCALAPPDATA") or env.get("APPDATA")
        return (Path(base) if base else home / "AppData" / "Local") / "VoxCrewState"
    if platform == "darwin":
        return home / "Library" / "Application Support" / "VoxCrewState"
    xdg = env.get("XDG_STATE_HOME")
    return (Path(xdg) if xdg and Path(xdg).is_absolute() else home / ".local" / "state") / "voxcrew"


def resolve_data_dir(env: Mapping[str, str] | None = None, legacy: Path | None = None,
                     platform: str | None = None, home: Path | None = None) -> Path:
    """Veri dizini: STUDIO_DATA_DIR → (varsa) depo içi eski `data/` → platform varsayılanı."""
    env = os.environ if env is None else env
    explicit = (env.get("STUDIO_DATA_DIR") or "").strip()
    if explicit:
        return Path(explicit).expanduser()
    legacy = LEGACY_DATA_DIR if legacy is None else legacy
    if legacy.is_dir():
        return legacy
    return platform_data_dir(env, platform, home)


def resolve_port(env: Mapping[str, str] | None = None) -> int:
    env = os.environ if env is None else env
    try:
        port = int((env.get("STUDIO_PORT") or "").strip() or DEFAULT_PORT)
    except ValueError:
        return DEFAULT_PORT
    return port if 0 < port < 65536 else DEFAULT_PORT


def normalize_ollama_host(value: str | None) -> str | None:
    """OLLAMA_HOST biçimlerini (`0.0.0.0`, `:11434`, `host:port`, `http://host:port/`) tam URL'ye çevirir."""
    raw = (value or "").strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = "http://" + raw
    parts = urlsplit(raw)
    host = parts.hostname or "127.0.0.1"
    if host in ("0.0.0.0", "::", "[::]"):
        host = "127.0.0.1"  # dinleme adresi; istemci olarak loopback'e bağlanılır
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    try:
        port = parts.port or 11434
    except ValueError:
        port = 11434
    scheme = parts.scheme if parts.scheme in ("http", "https") else "http"
    return f"{scheme}://{host}:{port}"


def env_overrides(env: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Ortam değişkenlerinden gelen ayar geçersiz kılmaları (yalnızca ayarlı olanlar)."""
    env = os.environ if env is None else env
    out: dict[str, Any] = {}
    if (env.get("HERMES_HOME") or "").strip():
        out["hermes_home"] = str(Path(env["HERMES_HOME"].strip()).expanduser())
    url = normalize_ollama_host(env.get("OLLAMA_HOST"))
    if url:
        out["ollama_url"] = url
    if (env.get("STUDIO_WORKDIR") or "").strip():
        out["workdir"] = str(Path(env["STUDIO_WORKDIR"].strip()).expanduser())
    return out


DATA_DIR = resolve_data_dir()
STUDIO_PORT = resolve_port()
# İş akışları: depodaki `workflows/` yalnızca ÖRNEKLERDİR (salt okunur kabul edilir); kullanıcının kaydettiği ya da
# şablondan oluşturduğu akışlar veri dizinine yazılır. WorkflowLibrary (S6) ikisini birlikte okur, kullanıcı kopyası
# aynı slug'lı örneğin önüne geçer.
EXAMPLE_WORKFLOWS_DIR = ROOT / "workflows"
USER_WORKFLOWS_DIR = DATA_DIR / "workflows"
# Geriye uyum: S6 kütüphaneyi iki dizine bağlayana kadar eski davranış (tek dizin) sürer.
WORKFLOWS_DIR = EXAMPLE_WORKFLOWS_DIR


def _default_workdir() -> str:
    # Ajanların dosya paylaştığı klasör (Hermes profillerinin HERMES_WRITE_SAFE_ROOT'u buraya ayarlanabilir).
    # Veri dizinindedir, depoya girmez. Kayıtlı bir `workdir` ayarı varsa o kullanılır.
    return str(DATA_DIR / "workspace")


if EDITION == "full":
    from studio.full.cloud import CLOUD_DEFAULTS

    _FULL_DEFAULTS: dict[str, Any] = {"cloud": CLOUD_DEFAULTS}
else:
    _FULL_DEFAULTS = {}

DEFAULTS: dict[str, Any] = {
    "ollama_url": DEFAULT_OLLAMA_URL,
    "hermes_home": str(Path.home() / ".hermes"),
    "workdir": _default_workdir(),
    "max_turns": 30,
    "step_timeout_min": 30,
    "concurrency": {"ollama": 1, "codex": 2, "claude": 2, "openai_compat": 2, "profile": 2},
    # think=True: düşünen modeller (qwen3 vb.) akıl yürütmeyi ayrı alanda verir, yanıt temiz kalır;
    # False iken bu Ollama sürümünde akıl yürütme yanıt metnine karışıyor (gözlendi 2026-10-16).
    "ollama": {"num_ctx": 8192, "temperature": 0.4, "think": True},
    "codex_hermes_model": "gpt-5.6-luna",
    # Ajan dünyasının sahnesi: office | park | home | beach | cafe | camp | (Faz 3: battlefield | sea | yacht …)
    "scene": "office",
    # Faz 3 — oyunlaştırma (kapatılabilir; hareket azaltmaya saygılı)
    "game": {"enabled": True, "celebrations": True, "sounds": True, "show_world_badges": True},
    # Faz 4 — harici ajan kaynakları (Claude Code). Varsayılanlar gizlilik dostu: transcript izleme kapalı,
    # ham istem/araç girdisi saklanmaz.
    "external": {"claude_code": {"ingest_enabled": True, "token": "", "transcripts_enabled": False,
                                 "store_prompts": False, "otlp_enabled": False},
                 # Codex oturumları: notify programı + isteğe bağlı rollout izleyicisi (varsayılan kapalı)
                 "codex": {"ingest_enabled": True, "transcripts_enabled": False, "store_prompts": False}},
    # Claude Code / Codex içinden kullanım (MCP). Onay kararları varsayılan kapalı: bir ajan kendi yetki
    # yükseltmesini başka bir ajana onaylatamasın.
    # AGENT-DELETE (karar 31 Ekim): ajanların (MCP/yerel süreç) DELETE çağrıları varsayılan kapalı; yalnız kullanıcı
    # riskleri onaylayarak açar (presence.AGENT_DELETE_SETTING; `clients` MCP_PROTECTED_SETTINGS içinde)
    "clients": {"mcp": {"enabled": True, "allow_decisions": False}, "agents": {"allow_delete": False}},
    # Faz 5 — dil: arayüz ve ajan çıktısı. auto = tarayıcı dili (tr → Türkçe, diğerleri → İngilizce).
    # agents = ajanlara giden istemlerin/çıktının dili; "ui" arayüz diliyle aynı demektir.
    # DASH-MVP: arayüz görünümü — world (Dünya Görünümü, varsayılan) | board (Pano Görünümü); ui_mode_value doğrular
    "ui": {"language": "auto", "mode": "world"},
    "agents": {"language": "ui"},
    # Faz 5 — ölçek: kurulum başına ajan tavanı (işe alım dahil), liste sayfa boyu, SSE abonelik kuyruğu
    # (bağlantı başına olay; taşmada önce durum/akış olayları düşer) ve ajan başına durum olayı hızı (olay/sn)
    "limits": {"max_agents": 300, "page_size": 100, "sse_queue": 2000, "state_events_per_sec": 4,
               # koşu bütçesi varsayılanı: None = sınırsız; aşımda pause | stop | ask
               "default_budget": {"tokens": None, "cost_usd": None, "minutes": None, "on_exceeded": "pause"},
               # karar 13: günlük toplam tavan (bugünkü tüm koşular, gün 04:00'te başlar); ikisi de None = kapalı
               "daily_budget": {"cost_usd": None, "tokens": None},
               # TRUST güvenli mod: True iken yeni oluşturulan her ajan salt okuma izniyle doğar (sonra elle açılabilir)
               "new_agents_read_only": False,
               # / karar 4: Anthropic API açık istem önbelleği süresi: 5m (varsayılan) | 1h | off.
               # cache_ttl_scheduled: zamanlanmış koşular için ayrı süre (ör. "1h"); None → cache_ttl
               "cache_ttl": "5m", "cache_ttl_scheduled": None,
               # ajan adımı başına varsayılan jeton tavanı (adımın `budget.tokens`'ı ya da akış
               # `defaults.budget.tokens` yoksa); aşımda adımın kart kuralı (varsayılan ask). None = kapalı.
               # G4-REST: "auto" = öngörü varsa üst bant × 3 (50 bin…2 milyon), yoksa 2 000 000; sayı = sabit tavan
               "step_tokens": "auto",
               # kullanıcı sabit bir sayı kaydettiyse True (PUT /api/settings yazar). İşaretsiz 2 000 000
               # eski kurulumların yerleşik varsayılanıdır ve "auto" okunur; işaretliyse açık seçimdir.
               "step_tokens_explicit": False,
               # koşu jeton sınırı olmadan başlayan koşuya otomatik koşu bütçesi (öngörü × 1,25, `ask`): taşan
               # adımlar tek, gruplanmış koşu kartına döner. False → eski davranış (otomatik adım tavanı başına kart)
               "auto_run_budget": True,
               # koşunun mutlak bitiş süresi (dakika; başlangıçta `deadline_at` yazılır, devam/yeniden deneme
               # uzatamaz). Koşu başına `deadline_min` ile geçersiz kılınır. None = kapalı
               "run_deadline_min": 1440},
    # Faz 5 — booster'lar (token tasarrufu vb.; ayrıntılı ayarlar booster modülünde, kayıt bu ad alanında)
    # on/off: profil varsayılanını ezen genel booster listeleri (ajan başına geçersiz kılma booster modülünün kendi deposunda)
    "boost": {"enabled": True, "profile": "balanced", "on": [], "off": []},
    # Faz 6 — orkestratör ve dayanıklılık
    "runs": {"auto_resume": False,                        # açılışta yarıda kalan koşular kendiliğinden sürmez
             "breaker_failures": 3,                       # aynı bağlantıda ardışık bu kadar hata → devre kesici sorar
             # / TRUST güvenli mod: True iken her ajan adımı model çağrısından önce onay ister (MCP değiştiremez)
             "approve_every_step": False},
    "goals": {"launch_mode": "delegate",                 # delegate | orchestrate
              "allow_hiring": True},                   # TRUST: False → yönetici hiçbir koşuda yeni ajan işe almaz
    "messaging": {"policy": "hierarchical"},              # free | hierarchical | custom (ekip ayarı geçersiz kılar)
    "schedule": {"enabled": True, "tick_s": 30, "catch_up": "once", "unattended_approvals": "pause"},
    "observability": {"otlp_url": "", "send_prompts": False},
    # S27 araç köprüsü: mcp_servers = [{id, transport: stdio|http, command?, args?, url?, enabled}] — yalnızca koşu
    # sırasında, kullanıcının başlattığı adım için açılır (otomatik başlatma yok); allow/deny araç adı kalıpları (fnmatch)
    "tools": {"mcp_servers": [], "allow": [], "deny": [], "max_rounds": 6, "call_timeout_s": 60,
              # TRUST güvenli mod: True iken ajanların auto_approve kalıpları yok sayılır (her araç çağrısı onaylı)
              "require_approval_all": False,
              # bundan büyük araç sonucu artefakt olur (modele baş + son + artifact:// referansı)
              "inline_max_chars": 12000,
              # kullanıcının araç sınıfı işaretleri {"sunucu:araç": "read" | "idempotent" | "effect"} (yalnız
              # arayüzden; MCP 403). Salt okunur / idempotent araç baştan çalışmada yeniden yürür; yoksa MCP açıklaması
              "tool_classes": None},
    # S27 guardrail: upstream/bellek/mesaj/araç metinlerinde enjeksiyon taraması (off | warn | block)
    "guard": {"injection": "warn", "output_schema_retries": 1},
    # kritik olaylar kalıcı (SSE ?since=/Last-Event-ID ile telafi); retention = tutulacak son olay sayısı
    "events": {"persist_critical": True, "retention": 20000, "replay_limit": 2000},
    # CDC (C1): graf değişiklik günlüğü saklama penceresi (graph/store.py `graph_changes`; 0 = o sınır kapalı)
    "graph": {"cdc": {"max_rows": 200000, "max_age_days": 30}},
    # S28: eval koşuları ve kanıtlı kapanış
    "evals": {"enabled": True, "repeats": 1},
    "acceptance": {"enabled": True, "require_reviewer": True},
    # (Ç-6): masaüstü bildirimi yalnız teslim için; sıklık off | immediate | daily (günde en çok bir özet).
    # Yalnız tam sürüm (kullanıcı-yalnız) yazar; MCP genel ayar ucundan değiştiremez (izin listesinde yok).
    "notify": {"deliverables": "immediate"},
    # Teslim kasası sınırları (MB): dosya başına ve toplam. `STUDIO_VAULT_MAX_FILE_MB` / `STUDIO_VAULT_MAX_TOTAL_MB`
    # ortam değişkenleri (varsa) bu ayarın önüne geçer (deliverables/vault.py `limits`).
    "deliverables": {"vault": {"max_file_mb": 100, "max_total_mb": 2048},
                     "view": {"max_mb": 64}},  # satır içi PDF/ses/video üst sınırı (MB; 1 MB..kasa dosya sınırı)
    # CG2 zaman tasarrufu panosu: kullanıcının iş akışı/tarif başına elle süre tabanı [{key, manual_minutes, review_minutes}]
    "time_saved": {"baselines": []},
    # CG-QUALITY kalite kapısı (yalnız kullanıcı; MCP_PROTECTED_SETTINGS). gate = iç teslim, gate_external = dış hedef:
    # off | warn | block. reviewer = isteğe bağlı AI denetçi (brain: auto = yerel Ollama varsa o; model boş = ilk yerel)
    "quality": {"enabled": True, "gate": "warn", "gate_external": "block",
                "reviewer": {"enabled": False, "brain": "auto", "model": ""}},
    # Faz 5 — skill'ler: Hermes dışı beyinlere skill bağlamı enjeksiyonu
    # claude_dirs: Claude Code skill klasörleri (boş = varsayılanlar: ~/.claude/skills ve proje .claude/skills; salt okunur)
    "skills": {"inject": True, "max_chars": 6000, "claude_dirs": []},
    # İlk kurulum sihirbazı (S8): completed = sihirbaz bitirildi ya da kapatıldı (Ayarlar'dan yeniden açılır).
    # starter_seeded = başlangıç ekibi değerlendirmesi bir kez yapıldı (silinen başlangıç ajanları geri gelmez);
    # starter_agents = oluşturulan başlangıç ajanlarının slug'ları (sihirbaz bunları gösterir).
    "onboarding": {"completed": False, "starter_seeded": False, "starter_agents": []},
    # TRUST (S2): yerel 18+ beyanı age_ok = {adult, at}; hiçbir yere gönderilmez, yalnız /api/safe-mode/age yazar.
    "trust": {"age_ok": None},
    # COS-A: kozmetik mağazası bayrağı. Kapalıyken yalnız önizleme; açıkken de satış, fiyat,
    # ödeme ve ağ yoktur. MCP değiştiremez (MCP_WRITABLE_SETTINGS dışında).
    "store": {"cosmetics_enabled": False},
    # TRUST güvenli mod ön ayarı (studio/safemode.py): previous/applied = açarken saklanan önceki ve yazılan değerler.
    # Genel PUT /api/settings yazamaz; yalnız kullanıcıya ait /api/safe-mode/* uçları değiştirir.
    "safe_mode": {"enabled": False, "since": None, "source": None, "previous": None, "applied": None},
    # S29 — bağlantı sihirbazı: stüdyonun başlattığı `ollama serve` kapanışta dursun mu; OpenAI uyumlu sunucu
    # (LM Studio / llama.cpp / vLLM ya da kendi anahtarınla bir API; anahtar settings.json'a DEĞİL secrets.json'a yazılır)
    "connections": {
        "ollama": {"stop_on_exit": True},
        "openai_compat": {"enabled": False, "base_url": "", "label": "", "model": "",
                          # S37: adlandırılmış çoklu API bağlantısı (LM Studio + Mistral + Anthropic … aynı anda);
                          # yukarıdaki tek-blok alanları varsayılan uç noktanın yansısıdır (connections/endpoints.py)
                          "endpoints": [], "default_endpoint": "",
                          # araç turlarında kullanım bildirmediği saptanan uç noktalar (kimlik listesi; yeniden
                          # başlatmada da tavan "adım sonunda" etiketiyle dürüst gösterilir)
                          "usage_missing": []},
    },
    **_FULL_DEFAULTS,  # tam sürüme özgü anahtarlar (studio/full/cloud.py); free sürümde yok
    # S40 — yönetici / test modu: kilitleri geçici olarak açar (hiçbir şey vermez). Yalnızca brand.ADMIN_MODE_AVAILABLE
    # True iken etkilidir; genel PUT /api/settings bu anahtarı yok sayar, yalnızca /api/admin/mode değiştirir.
    # Bu sürümde yönetici modu yoktur.
    "admin": {"enabled": False},
    # S37 — model erişim politikası (connections/policy.py): all | local_only | allowlist; deny her zaman kazanır.
    # Yalnızca arayüzden değişir (genel PUT /api/settings ve MCP yok sayar); yönetici modu aşmaz.
    # consent: uzak uç noktaların bir kerelik "veri bu bilgisayardan çıkar" onayları [{key, ts, source}]
    "models": {"policy": {"mode": "all", "allow": [], "deny": [], "require_consent_remote": True}, "consent": []},
    "memory": {
        "recall": True,
        # auto: Ollama erişilebilirse LLM ile çıkar, değilse sezgisel; llm | heuristic
        "extractor": "auto",
        "extractor_model": "qwen3:4b",
        "budget_chars": 2400,
        # G5: recall'da graf komşu genişletmesi (0 = yalnız metin araması, 1 = 1 adım)
        "graph_expand": 1,
        # proje ad alanı izolasyonu — recall/yazma yalnızca koşunun ad alanında; çapraz okuma yok (global dahil)
        "isolation": True,
        # / karar R-1: ortak belleğe yazma. on_accept: koşunun bilgisi ajana özel yazılır, koşu kullanıcıca
        # kabul edilince ortak olur · auto: eski davranış (her çıktı ortak) · manual: kullanıcı tek tek terfi ettirir
        "shared_write": "on_accept",
    },
}


UI_MODES = ("world", "board")


def ui_mode_value(value: Any) -> str:
    """DASH-MVP: `ui.mode` yalnız `world` | `board`. Araştırma taslağındaki eski `plain` adı `board` sayılır (geriye
    uyum); başka her değer ValueError (PUT /api/settings 400 döner)."""
    if isinstance(value, str):
        v = value.strip().lower()
        if v == "plain":
            return "board"
        if v in UI_MODES:
            return v
    raise ValueError("ui.mode 'world' ya da 'board' olmalı")


def _merge_known(dst: dict[str, Any], src: dict[str, Any], schema: dict[str, Any]) -> None:
    for key, value in src.items():
        if key not in schema:
            continue
        if isinstance(schema[key], dict):
            if isinstance(value, dict):
                _merge_known(dst[key], value, schema[key])
        else:
            dst[key] = value


_log = logging.getLogger(__name__)


class SettingsCorrupt(RuntimeError):
    pass


def atomic_write_text(path: Path, text: str, private: bool = False, prepare: Callable[[Path], None] | None = None) -> None:
    """Benzersiz geçici dosya + os.replace: yarıda kalan yazma hedefi bozmaz (kullanıcı verisi yazımları ortak yardımcı).
    `private=True` (sır dosyaları): geçici dosya 0600 ile `O_EXCL` açılır ve fsync edilir. `prepare(tmp)` içerik yazılmadan ÖNCE
    çağrılır (Windows'ta 0600 yalnız salt-okunur bitidir: ACL burada kısıtlanır); istisna fırlatırsa yazma iptal, hedefe dokunulmaz."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        if private:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                if prepare:
                    prepare(tmp)
                f.write(text)
                f.flush()
                os.fsync(f.fileno())
        else:
            tmp.write_text(text, "utf-8")
        for i in range(6):  # Windows: okuyan süreç dosyayı tutarken os.replace PermissionError verebilir
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                if i == 5:
                    raise
                time.sleep(0.03 * (i + 1))
    finally:
        tmp.unlink(missing_ok=True)


class Settings:
    def __init__(self, path: Path | None = None, env: Mapping[str, str] | None = None):
        self.path = path or DATA_DIR / "settings.json"
        self._lock = threading.Lock()
        self.corrupt = False
        self.on_write: Callable[[Path], None] | None = None  # FAZB2: yazım sonrası kanca (studio.config_cdc)
        # Kalıcı katman (varsayılanlar + settings.json + kullanıcı değişiklikleri) ile çalışma anı görünümü
        # (kalıcı + ortam değişkenleri) ayrı tutulur: ortam değişkeni değerleri dosyaya yazılmaz (QA-F3 m8).
        self._persisted: dict[str, Any] = copy.deepcopy(DEFAULTS)
        if self.path.exists():
            try:
                _merge_known(self._persisted, json.loads(self.path.read_text("utf-8")), DEFAULTS)
            except json.JSONDecodeError:
                # Bozuk dosya sessizce varsayılanlarla ezilmesin: .corrupt yedeği al, yazmayı reddet
                self.corrupt = True
                try:
                    shutil.copy2(self.path, self.path.with_name(self.path.name + ".corrupt"))
                except OSError:
                    pass
                _log.error("settings.json okunamadı (bozuk JSON); .corrupt yedeği alındı, ayarlar güncellenmeyecek: %s", self.path)
            except OSError:
                self.corrupt = True
                _log.error("settings.json okunamadı: %s", self.path)
        # DASH-MVP: elle düzenlenmiş ya da eski (`plain`) görünüm değeri açılışı bozmasın
        try:
            self._persisted["ui"]["mode"] = ui_mode_value(self._persisted["ui"].get("mode"))
        except ValueError:
            self._persisted["ui"]["mode"] = "world"
        # Ortam değişkenleri kayıtlı ayarın önüne geçer (ör. özel HERMES_HOME ile kurulmuş Hermes).
        self._env = env_overrides(env)
        self.env_locked = sorted(self._env)
        self.data: dict[str, Any] = {}
        self._refresh_view()

    def _refresh_view(self) -> None:
        view = copy.deepcopy(self._persisted)
        _merge_known(view, self._env, DEFAULTS)
        self.data.clear()  # kimlik korunur: self.data'ya referans tutan kod güncel görünümü görür
        self.data.update(view)

    def get(self, dotted: str, default: Any = None) -> Any:
        cur: Any = self.data
        for part in dotted.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return default
            cur = cur[part]
        return cur

    def update(self, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            if self.corrupt:
                raise SettingsCorrupt(f"{self.path.name} bozuk; üzerine varsayılanlar yazılmadı (yedek: {self.path.name}.corrupt). Dosyayı düzeltin ya da silin.")
            # yama önce kopyaya uygulanır, dosyaya yazılınca yerine geçer (yarıda kalan güncelleme yok)
            nxt = copy.deepcopy(self._persisted)
            _merge_known(nxt, patch, DEFAULTS)
            atomic_write_text(self.path, json.dumps(nxt, ensure_ascii=False, indent=2))
            self._persisted = nxt
            self._refresh_view()
        if self.on_write is not None:
            self.on_write(self.path)
        return self.data

    @property
    def workdir(self) -> Path:
        p = Path(self.data["workdir"])
        p.mkdir(parents=True, exist_ok=True)
        return p
