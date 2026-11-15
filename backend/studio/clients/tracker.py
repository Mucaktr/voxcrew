"""İstemci "son görülme" kaydı ve `client_seen` FastAPI bağımlılığı (Ekip S11).

MCP sunucusu (integrations/mcp/studio-mcp.mjs) her isteğe `X-Studio-Client: mcp/<istemci>` başlığı koyar.
Bu modül başlığı okur, istemci başına son görülme zamanını tutar (veri dizininde `clients_seen.json`) ve
`clients.seen` olayı yayınlar (istemci başına en fazla 10 sn'de bir; SSE akışını boğmamak için).

Ara katman (middleware) EKLENMEZ: bağımlılık, router'lara `Depends(client_seen(studio))` ile bağlanır.
`/api/clients/*` bunu kendisi kullanır; genel `/api` router'ına bağlamayı teknik lider yapar.
`clients.mcp.enabled` ayarı kapalıysa `mcp/*` başlıklı istekler 403 ile reddedilir.

A-08 güvenlik kapıları (MCP olarak kendini tanıtan çağıran için): genel ayarların korunan anahtarları, ajan izinleri,
koşu bütçesi, kendi başlattığı koşunun onayı, kalıcı araç izni ve köken sahteciliği. Not: başlık
göndermeyen yerel bir süreç arayüz gibi görünür; sunucu yerel-yalnızdır ve bunu tasarım gereği ayırt etmez — bu
kapılar arayüz isteklerini değil, MCP sunucusu (ve onu kullanan ajan) üzerinden gelen istekleri sınırlar.
Başlıksız yerel süreçler için kullanıcıya ait uçlar (USER_ONLY_RE + onay kararı) ayrıca `studio.presence` arayüz
jetonunu ister.
"""

from __future__ import annotations

import asyncio
import json
import re
import threading
import time
import unicodedata
from pathlib import Path
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from fastapi import HTTPException, Request

if TYPE_CHECKING:
    from studio.api import Studio

HEADER = "x-studio-client"
SEEN_FILE = "clients_seen.json"
PUBLISH_EVERY_S = 10.0
KNOWN_KINDS = {"mcp", "hook", "cli"}
DECISION_RE = re.compile(r"^/api/runs/(?P<run>[^/]+)/(?:steps/[^/]+/decision|approvals/[^/]+)$")
# A-15: MCP'den adım yeniden denemesi, dış etkisi (araç çağrısı / mesaj) uygulanmış adımı tekrar çalıştıramaz
RETRY_RE = re.compile(r"^/api/runs/(?P<run>[^/]+)/steps/(?P<step>[^/]+)/retry$")
REPLAY_GUARDED_KINDS = ("tool", "message")
# S40: /api/admin/* (yönetici/test modu, demo ajanlar) yalnızca kullanıcı arayüzünden değişir
# S37: model erişim politikası + uzak model onayları ve API bağlantıları (anahtar/uç nokta) yalnızca kullanıcıdan
# A-08: koşu bütçesini değiştirmek/yükseltmek de kullanıcıya aittir
USER_ONLY_RE = re.compile(r"^/api/(?:changes/|admin/|gateway/(?:enable|start|stop)$|clients/(?:codex|claude)/plan$"
                          r"|connections/models/(?:policy|consent)|connections/openai_compat(?:/endpoints|$)"
                          r"|runs/[^/]+/budget$"
                          # Faz 6 dalga 3: araç izinleri/MCP sunucuları (stdio komutu = kod çalıştırma), mesaj politikası,
                          # zamanlamalar, kabul kararları ve eval başlatma yalnızca kullanıcıdan (yetki yükseltme/kota)
                          r"|tools/|messages/policy$|schedules(?:/|$)|acceptance/|evals/runs"
                          # SP-W1: pasaport damgasıyla şehir açmak kullanıcının kalıcı oyun kararı (ajan harcayamaz)
                          r"|game/passport/redeem$"
                          # QA scene packs: mağaza satın alımı kullanıcının jetonunu harcar (MCP harcayamaz)
                          r"|game/shop/[^/]+/buy$|recognition/|walk/"  # W1b takdir/hediye + W4 yürüme yazma uçları
                          # FIX-SEC: yaratıcı mod / oyun ayarları ve görev ödülü/değişimi kullanıcının
                          # ekonomi kararlarıdır (ajan kilitli sahne açamaz, görev ödülü alamaz, görev çarkı çeviremez)
                          r"|game/settings$|game/quests/[^/]+/(?:claim|swap)$"
                          r"|game/loop/(?:first-office$|boss(?:/rest)?$)"  # ilk ofis kurulumu ve sprint boss seçimi
                          r"|game/surprise/[^/]+/open$"  # sürpriz kutuyu açmak kullanıcının anı (ajan açamaz)
                          r"|game/chests/[^/]+/open$"  # üyelik sandığını açmak ve seçmek yalnız kullanıcıdan
                          r"|game/fun(?:/|$)"  # G2-D R-3: haftalık "eğlenceli miydi?" yanıtı yalnız kullanıcının
                          # kadro değişimi ve test paketi anahtarı yalnız kullanıcıdan (MCP koltuk değiştiremez)
                          r"|plan/(?:seats/|test-plan$)"
                          # CG-COST: fiyat tablosu geçersiz kılması kullanıcının kararı (MCP öngörüyü/bütçe önerisini eğemez)
                          r"|estimate/prices"
                          # CG2: MCP katalog yapılandırma planı ve zaman tasarrufu tabanı yalnız kullanıcıdan
                          r"|mcp-catalog/|time-saved/"
                          r"|delivery/"  # CG-DELIVER: çıktı teslimi (önizleme/teslim/ayar) yalnızca kullanıcı onayıyla
                          r"|quality/"  # CG-QUALITY: kalite kararları (yine de kabul, yanlış-pozitif, revizyon)
                          # SETUP: terminal penceresi açmak ve giriş komutu başlatmak yalnızca kullanıcıdan (MCP pencere açamaz)
                          r"|connections/terminal$|connections/[^/]+/login$"
                          # Hermes kökü değişince stüdyo <kök>/bin/hermes çalıştırır — ajan kendi programını çalıştıramasın
                          r"|connections/hermes/home$"
                          # dış kaynak gizlilik ayarları (ham istem/transcript saklama) yalnız kullanıcıdan
                          r"|external/settings$"
                          r"|metrics(?:/retention)?$"  # G1-A: ölçüm defterini silmek ve saklama süresi yalnız kullanıcıdan
                          r"|evals/matrix"  # G5: matris öngörüsü, başlatma ve iptal yalnız kullanıcıdan (kota harcar)
                          r"|boost/gate"  # booster kapısı öngörüsü, başlatma, iptal ve politika yalnız kullanıcıdan
                          # bellek bilgisi bakımı (sabitle/düzenle/sil) kullanıcının kararı; MCP oyun kredisi üretemez
                          r"|memory/facts/[^/]+$"
                          # kullanıcı beyanı, doğrula / itiraz et / düzelt / değişti / ortağa terfi yalnız kullanıcıdan
                          r"|memory/user-facts$|memory/facts/[^/]+/(?:verify|dispute|correct|supersede|promote)$"
                          r"|memory/forget/"  # unutma planı, uygulama, geri alma ve yeniden uygulama yalnız kullanıcıdan
                          # TRUST: güvenli mod ön ayarı ve yerel 18+ beyanı yalnız kullanıcıdan (MCP gevşetemez, beyan veremez)
                          r"|safe-mode/"
                          # SHARE: paket içe aktarma ve çıktı şablonu yazma yalnız kullanıcıdan (MCP dışa aktarabilir)
                          r"|share/(?:import|outputs/)"
                          # E2: parsel sahiplenme (jeton harcar), parsel gövdesi ve keşif kümesi yalnız kullanıcıdan
                          r"|expanse/"
                          # REV-C: iş geliştirme karar defteri ve zaman kaydı yalnız kullanıcıdan (MCP karar yazamaz)
                          r"|bizdev/"
                          # karar 13: günlük toplam bütçe tavanı (ayar ve bugün için yükseltme) yalnız kullanıcıdan
                          r"|budget/"
                          r"|portability/export$"  # tüm veriyi taşıyan "hepsini dışa aktar" zip'i yalnız kullanıcıdan
                          # G1-D: skill sürümünü onaylamak ve ajana bağlamak (kip/sürüm) yalnız kullanıcıdan
                          r"|skills/(?:import/confirm|bind)$"
                          # skill mağazası kurulum onayı yalnız kullanıcıdan (MCP satın alamaz/kuramaz/onaylayamaz)
                          r"|market/store/confirm$"
                          # Pazar paketi kurma/kaldırma ajan yeteneklerini değiştirir: yalnız kullanıcıdan (MCP kendine skill kuramaz)
                          r"|market/packs/[^/]+/(?:install|uninstall)$"
                          r"|market/sources(?:/|$)"  # katalog kaynağı ekleme/değiştirme kullanıcının kararı
                          # COS-A: kozmetik hak projeksiyonu ve ücretsiz yol yazımı yalnız kullanıcıdan (MCP envanter yazamaz)
                          r"|cosmetics/"
                          # FAZB2: dünya grafı eşitleme/silme ve kavram taksonomisi düzenleme yalnız kullanıcıdan
                          r"|world-graph/|taxonomy/"
                          r"|worktrace/notify$"  # teslim bildirimi sıklığı yalnız kullanıcıdan
                          # (karar 3): Claude ajanına kullanıcı ~/.claude kurulumunu açmak/kapatmak yalnız kullanıcıdan
                          r"|claude-isolation/"
                          # PROC-FIX Codex ajanına kişisel Codex kurulumu / web araması izni yalnız kullanıcıdan
                          r"|codex-isolation/"
                          # hesap bağlama, satın alma başlatma, lisans anahtarı, cihaz ve bulut ayarları yalnız kullanıcıdan
                          r"|account/"
                          # G7: telemetri rızası, önizleme, gönderim ve takma adlı DSR yalnız kullanıcıdan (ajan rıza veremez)
                          r"|telemetry/"
                          # AUDIT-FIX (AGENTS kural 4): `ollama serve` süreci başlatmak ve model indirmek yalnız kullanıcı tıklamasıyla
                          r"|connections/ollama/(?:start|pull)$)")
# A-08: MCP'nin genel PUT /api/settings ile değiştiremeyeceği anahtarlar (kendi kapısını açma, çalışma klasörü,
# koşu/limit güvenlik ayarları, araç izinleri, Hermes kökü, alım jetonu, dışa telemetri). Bilgi amaçlı liste;
# asıl kural beri aşağıdaki izin listesidir (listede olmayan her üst düzey anahtar MCP'ye kapalı).
# AGENT-DELETE: "clients" ayrıca "Ajanlar silebilsin" iznini (clients.agents.allow_delete) korur
MCP_PROTECTED_SETTINGS = ("clients", "workdir", "runs", "limits", "tools", "hermes_home", "external", "observability",
                          "quality",  # CG-QUALITY: MCP/ajan kalite kapısını kapatamaz ya da gevşetemez
                          # kabul, guard, bellek, mesajlaşma, zamanlama, skill, Ollama adresi, bağlantılar,
                          # hedef başlatma kipi, teslim — hepsi kapı ya da veri yönü kararları
                          "acceptance", "guard", "memory", "messaging", "schedule", "skills", "ollama_url",
                          "connections", "goals", "delivery", "evals", "events", "models", "admin",
                          "cloud")  # bulut hesabı (taban adres, açık/kapalı) yalnız hesap ayarları ucuyla
# MCP (ve arayüz jetonu olmayan başlıksız süreç) genel PUT /api/settings ile YALNIZCA bu üst düzey anahtarları
# yazabilir: görünüm/oyun tercihleri ve zararsız model ayarları. Yeni bir ayar eklenince varsayılan olarak korunur.
MCP_WRITABLE_SETTINGS = frozenset({"scene", "game", "ui", "agents", "boost", "ollama", "codex_hermes_model"})


def mcp_blocked_settings(data: dict[str, Any]) -> list[str]:
    """MCP'nin genel ayar yoluyla yazamayacağı üst düzey anahtarlar (izin listesi dışındaki her şey)."""
    return [k for k in data if k not in MCP_WRITABLE_SETTINGS]
# A-08: MCP araç onayında yalnızca tek seferlik izin ya da ret (kalıcı/oturumluk izin yalnızca arayüzden)
MCP_TOOL_CHOICES = ("once", "deny")


def normalize_client(raw: str | None) -> str:
    """clientInfo.name → kararlı ad: "claude-code", "codex" ya da sadeleştirilmiş ad (MCP sunucusuyla aynı kural)."""
    s = (raw or "").strip().lower()
    if not s:
        return "unknown"
    if s == "claude" or re.search(r"claude[-_ ]?code", s):
        return "claude-code"
    if "codex" in s:
        return "codex"
    ascii_s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_s).strip("-")[:40].rstrip("-")
    return slug or "unknown"


def parse_header(value: str | None) -> tuple[str, str] | None:
    """`mcp/claude-code` → ("mcp", "claude-code"). Boş ya da tanınmayan tür → None (kayıt tutulmaz)."""
    v = (value or "").strip()[:120]
    if not v:
        return None
    kind, _, name = v.partition("/")
    kind = kind.strip().lower()
    if kind not in KNOWN_KINDS:
        return None
    return kind, normalize_client(name)


class ClientTracker:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / SEEN_FILE
        self._lock = threading.Lock()
        self.entries: dict[str, dict[str, Any]] = self._load()
        self._published: dict[str, float] = {}

    def _load(self) -> dict[str, dict[str, Any]]:
        try:
            data = json.loads(self.path.read_text("utf-8"))
        except (OSError, ValueError):
            return {}
        return {k: v for k, v in data.items() if isinstance(v, dict)} if isinstance(data, dict) else {}

    def record(self, kind: str, client: str, method: str, path: str, now: float | None = None) -> bool:
        """Görülmeyi kaydeder. Olay yayınlanmalı (ve dosyaya yazılmalı) ise True döner."""
        now = time.time() if now is None else now
        key = f"{kind}:{client}"
        with self._lock:
            prev = self.entries.get(key) or {"kind": kind, "client": client, "first_seen": now, "count": 0}
            self.entries[key] = {**prev, "last_seen": now, "count": int(prev.get("count", 0)) + 1,
                                 "last_method": method, "last_path": path[:200]}
            due = now - self._published.get(key, 0.0) >= PUBLISH_EVERY_S
            if due:
                self._published[key] = now
            return due

    def save(self) -> None:
        with self._lock:
            snapshot = json.dumps(self.entries, ensure_ascii=False, indent=1)
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_name(self.path.name + ".tmp")
            tmp.write_text(snapshot, "utf-8")
            tmp.replace(self.path)
        except OSError:
            pass  # son görülme kaydı yalnızca kolaylık; yazılamazsa bellekte kalır

    def get(self, kind: str, client: str) -> dict[str, Any] | None:
        with self._lock:
            e = self.entries.get(f"{kind}:{client}")
            return dict(e) if e else None

    def all(self, kind: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            items = [dict(e) for e in self.entries.values() if kind is None or e.get("kind") == kind]
        return sorted(items, key=lambda e: e.get("last_seen", 0), reverse=True)


def _data_dir(studio: "Studio") -> Path:
    changes = getattr(studio, "changes", None)
    if changes is not None and getattr(changes, "data_dir", None):
        return Path(changes.data_dir)
    from studio.config import DATA_DIR
    return DATA_DIR


def tracker_for(studio: "Studio") -> ClientTracker:
    tracker = getattr(studio, "_client_tracker", None)
    if tracker is None:
        tracker = ClientTracker(_data_dir(studio))
        setattr(studio, "_client_tracker", tracker)
    return tracker


def mcp_enabled(studio: "Studio") -> bool:
    return studio.settings.get("clients.mcp.enabled", True) is not False


def mcp_client(request: Request | None) -> str | None:
    """`X-Studio-Client: mcp/<istemci>` başlıklı istekte istemci adı, yoksa None (arayüz ya da başlıksız istek).
    Başlıksız yerel süreçler ayırt edilemez (tasarım gereği; bkz. modül notu)."""
    if request is None:
        return None
    parsed = parse_header(request.headers.get(HEADER))
    return parsed[1] if parsed and parsed[0] == "mcp" else None


def _run_origin(studio: "Studio", run_id: str) -> str:
    try:
        node = studio.store.find("Run", run_id)
    except Exception:  # noqa: BLE001
        node = None
    origin = (node or {}).get("props", {}).get("origin") if node else None
    if not origin:
        try:
            origin = (studio.engine.get_run(run_id) or {}).get("origin")
        except Exception:  # noqa: BLE001 - koşu yoksa köken bilinmez; karar rotası kendi 404'ünü verir
            origin = None
    return str(origin or "")


def applied_side_effects(studio: "Studio", run_id: str, step_id: str) -> list[dict[str, Any]]:
    """Yeniden denemede tekrar çalışacak adımların (adım, geçişli bağımlıları ve alt görevleri) uygulanmış araç/mesaj
    etkileri (A-15). Canlı koşuda motorun etki günlüğü, soğuk koşuda Run düğümünün kontrol noktası okunur."""
    try:
        run = studio.engine.get_run(run_id) or {}
    except Exception:  # noqa: BLE001 - koşu yoksa retry rotası kendi 404'ünü verir
        return []
    effects = run.get("effects")
    if not isinstance(effects, list):
        try:
            node = studio.store.find("Run", run_id)
        except Exception:  # noqa: BLE001
            node = None
        effects = (((node or {}).get("props") or {}).get("checkpoint") or {}).get("effects") or []
    steps = [s for s in run.get("steps") or [] if isinstance(s, dict)]
    targets = {step_id}
    changed = True
    while changed:  # geçişli bağımlılar ve dinamik alt görevler de yeniden açılır
        changed = False
        for s in steps:
            sid = str(s.get("id"))
            if sid in targets:
                continue
            if s.get("parent") in targets or any(d in targets for d in s.get("depends_on") or []):
                targets.add(sid)
                changed = True
    return [e for e in effects if isinstance(e, dict) and e.get("step") in targets
            and e.get("status") == "applied" and e.get("kind") in REPLAY_GUARDED_KINDS]


def client_seen(studio: "Studio") -> Callable[[Request], Awaitable[None]]:
    """FastAPI bağımlılığı üretir: `APIRouter(dependencies=[Depends(client_seen(studio))])`.

    `X-Studio-Client` başlığı yoksa hiçbir şey yapmaz. Varsa son görülme kaydını günceller ve gerektiğinde
    `clients.seen {client, kind, method, path, last_seen, count}` olayını yayınlar. Olay yolu yalnızca olay
    döngüsünden çağrılabildiği için bağımlılık `async def`'tir; dosya yazımı iş parçacığında yapılır.
    """
    tracker = tracker_for(studio)

    async def dependency(request: Request) -> None:
        parsed = parse_header(request.headers.get(HEADER))
        if parsed is None:
            # (derinlemesine savunma): başlık VAR ama çözülemiyorsa kullanıcı-yalnız yazma yolu arayüz kimliği
            # olmadan geçmez (ara katmanla aynı `parse_header`; çift başlık ara katmanda 400)
            if (request.headers.get(HEADER) or "").strip() and request.method != "GET"                     and USER_ONLY_RE.match(request.url.path):
                from studio.presence import ui_present  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın
                if not ui_present(request):
                    raise HTTPException(403, "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir")
            return
        kind, client = parsed
        if kind == "mcp" and not mcp_enabled(studio):
            raise HTTPException(403, "Uygulama ayarlarında MCP erişimi kapalı (Claude ve Codex sayfasından açılabilir)")
        if kind == "mcp" and request.method != "GET":
            path = request.url.path
            # Kullanıcıya ait eylemler: dosya değişikliği uygulama/geri alma ve gateway yönetimi MCP'den asla yapılmaz
            if USER_ONLY_RE.match(path):
                raise HTTPException(403, "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir")
            # QA-F3 m3: onay kararları sunucuda da kapalı (ayar: clients.mcp.allow_decisions)
            decision = DECISION_RE.match(path)
            if decision and studio.settings.get("clients.mcp.allow_decisions", False) is not True:
                raise HTTPException(403, "MCP istemcilerinin onay kararı vermesi kapalı; kararı uygulama arayüzünden ver")
            # A-08: ayar açıkken bile bir MCP istemcisi kendi başlattığı koşunun onayını veremez
            if decision and _run_origin(studio, decision.group("run")) == f"mcp:{client}":
                raise HTTPException(403, "MCP istemcisi kendi başlattığı koşunun onayını veremez; "
                                         "kararı uygulama arayüzünden ver")
            # A-15: dış etkisi uygulanmış adımın yeniden denemesi o eylemi tekrarlar (yalnız istem notu korur):
            # MCP'den yalnızca kullanıcı karar iznini açıkça verdiyse
            retry = RETRY_RE.match(path)
            if retry and studio.settings.get("clients.mcp.allow_decisions", False) is not True:
                applied = await asyncio.to_thread(applied_side_effects, studio, retry.group("run"), retry.group("step"))
                if applied:
                    raise HTTPException(403, "Bu adımın dış etkisi (araç çağrısı ya da mesaj) zaten uygulandı; yeniden "
                                             "deneme o eylemi tekrarlar. Kararı uygulama arayüzünden ver")
        if tracker.record(kind, client, request.method, request.url.path):
            entry = tracker.get(kind, client) or {}
            studio.bus.publish("clients.seen", client=client, kind=kind, method=request.method,
                               path=request.url.path, last_seen=entry.get("last_seen"), count=entry.get("count"))
            await asyncio.to_thread(tracker.save)

    return dependency
