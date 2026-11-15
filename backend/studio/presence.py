"""Kullanıcı varlığı (user presence) kapısı — ADR:.

Sorun: `security.py` Origin göndermeyen yerel istekleri kabul eder. Stüdyonun başlattığı bir ajan koşusu kabuk adımında
kullanıcıya ait uçları (onay kararı, `/api/admin/*`, mağaza, pasaport, model politikası, yürüme, takdir…) çağırabilirdi.

Kullanıcıya ait (USER_ONLY_RE + onay kararı) durum değiştiren bir istek ancak şunların hepsiyle geçer:

1. Sayfa jetonu (`X-Studio-UI`): her sayfa yüklemesinde yeni üretilir; yalnızca bellekte (diske, ayara, olay günlüğüne,
   ortama yazılmaz). Arayüz onu gizli bir iframe'in açtığı oturum belgesinden okur; JSON oturum ucu yoktur.
2. Oturum çerezi (HttpOnly, SameSite=Strict, Path=/api): aynı belgeyle verilir; sayfa jetonu bu çereze bağlıdır.
   Sayfa betiği çerezi göremez; yalnız jeton ya da yalnız çerez işe yaramaz.
3. Aynı köken `Origin` (Host ile birebir aynı köken; tarayıcı durum değiştiren her fetch'te gönderir).
4. Karşı süreç stüdyonun başlattığı bir süreç (ajan, kabuk aracı, MCP araç sunucusu, gateway) değildir
   (`studio.peer`; Windows ve Linux).

Kalan risk (ADR): kullanıcıyla aynı hesapta, stüdyonun süreç ağacı dışında çalışan bir süreç tarayıcıyı bilerek
taklit edebilir. Kapı kazara, alışkanlıkla ya da istem enjeksiyonuyla yapılan çağrıları durdurur ve stüdyonun başlattığı
ajanları süreç düzeyinde ayırır; işletim sistemi yalıtımının yerini tutmaz.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import re
import secrets
import threading
import time
from collections import OrderedDict
from http.cookies import SimpleCookie
from typing import Any, Awaitable, Callable
from urllib.parse import unquote, urlsplit

from studio import peer
from studio._edition import EDITION
from studio.clients.tracker import DECISION_RE, HEADER as CLIENT_HEADER, USER_ONLY_RE, parse_header

log = logging.getLogger("studio.presence")

UI_HEADER = "x-studio-ui"
BOOTSTRAP_PATH = "/api/ui/bootstrap"
COOKIE_PREFIX = "vc_ui_"
SAFE = {"GET", "HEAD", "OPTIONS"}
# Hata ayıklayan istemci (ve ajan) neden reddedildiğini anlasın; oturumun nasıl açıldığı söylenmez
DENIED = "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir"
DENIED_CODE = "user_presence_required"
MAX_COOKIES = 8      # canlı tarayıcı oturumu (profil) sayısı; en eskisi düşer
MAX_PAGES = 24       # canlı sayfa jetonu (sekme / yeniden yükleme); en eskisi düşer, sekme sessizce yenilenir
STATE_KEY = "studio.ui_present"  # scope anahtarı: ara katmanın vardığı karar (ui_present okur)

# USER_ONLY_RE dışında kendi kullanıcı-yalnız kapısı olan yollar (MCP'yi kendi iletisiyle reddeder): kahraman işe alma
# ve kaldırma (heroes/api.py `user_only`).
EXTRA_USER_ONLY_RE = re.compile(r"^/api/heroes/")
# başlıksız yerel süreç (ajan kabuk adımı) için kullanıcıya ait, ama MCP'ye AÇIK yazma yolları. Burada arayüz
# jetonu istenir; `mcp/*` başlıklı istek ara katmandan geçer ve rota kendi dar yolunu uygular (tarif başlatma: MCP
# başlatabilir ama ajan işe alamaz, köken başlıktan gelir). USER_ONLY_RE'ye konmaz: orada MCP de 403 alırdı.
PRESENCE_OR_MCP_RE = re.compile(r"(?!)")  # EDITION1: free sürümde böyle bir uç yok (hiçbir yolla eşleşmez)
if EDITION == "full":
    from studio.full.paths import PRESENCE_OR_MCP_PATTERN

    PRESENCE_OR_MCP_RE = re.compile(PRESENCE_OR_MCP_PATTERN)

# AGENT-DELETE (karar 31 Ekim, denetim #8): arayüzden gelmeyen her DELETE /api/… (MCP, hook/CLI, başlıksız yerel
# süreç) varsayılan olarak reddedilir. Kullanıcı Güvenlik bölümünden riskleri onaylayarak açabilir; ayar `clients.`
# altındadır, bu yüzden MCP_PROTECTED_SETTINGS / izin listesiyle ajana kapalıdır. Kullanıcı-yalnız DELETE'ler
# (USER_ONLY_RE, heroes) bu izinle de açılmaz. Muaf (zararsız) DELETE yok: ajanın geçici kilit/oturum silen ucu bulunmuyor.
AGENT_DELETE_SETTING = "clients.agents.allow_delete"
AGENT_DELETE_CODE = "agent_delete_disabled"
AGENT_DELETE_PAGE = "/baglan#ajan-silme"
AGENT_DELETE_TR = ("Silme yetkisi yalnız kullanıcıda: ajanlar (MCP ve diğer yerel süreçler) varsayılan olarak hiçbir şeyi "
                   "silemez. Bu öğenin silinmesi gerekiyorsa kullanıcıdan uygulama arayüzünden silmesini iste. Kullanıcı "
                   "isterse Claude ve Codex sayfasının Güvenlik bölümündeki «Ajanlar silebilsin» ayarını riskleri "
                   "onaylayarak açabilir; bu ayarı ajanlar değiştiremez.")
AGENT_DELETE_EN = ("Deletion is reserved for the user: agents (MCP clients and other local processes) can't delete "
                   "anything by default. If this item should be deleted, ask the user to delete it in the studio UI. "
                   "The user can turn on “Agents may delete” in the Security section of the Claude and Codex page "
                   "after confirming the risks; agents can't change this setting.")


def agent_delete_allowed(studio: Any) -> bool:
    """Kullanıcı "Ajanlar silebilsin" iznini açtı mı (varsayılan kapalı; okunamazsa kapalı sayılır)."""
    try:
        return studio.settings.get(AGENT_DELETE_SETTING, False) is True
    except Exception:  # noqa: BLE001
        return False


def agent_delete_refusal(headers: dict[str, str], path: str) -> dict[str, Any]:
    """403 gövdesi ve `clients.delete_refused` olayının alanları: kim, hangi öğe, ayar nerede."""
    parsed = parse_header(headers.get(CLIENT_HEADER))
    kind, client = parsed if parsed else ("local", "local")
    resource, _, item = path[len("/api/"):].rstrip("/").rpartition("/")
    return {"client": client, "kind": kind, "resource": resource or item, "item": unquote(item) if resource else "",
            "path": path}

_lock = threading.Lock()
_cookies: "OrderedDict[str, float]" = OrderedDict()  # çerez değeri → oluşturulma
_pages: "OrderedDict[str, str]" = OrderedDict()      # sayfa jetonu → bağlı çerez değeri

Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]


# ---------------------------------------------------------------- oturum deposu (yalnızca bellek)
def server_port(scope: Scope) -> int:
    """Sunucunun dinlediği port (taşıyıcı vermezse şemanın varsayılanı)."""
    port = (scope.get("server") or (None, None))[1]
    return int(port) if port else (443 if scope.get("scheme") == "https" else 80)


def cookie_name(server_port: int | None) -> str:
    """Çerezler porta bağlı değildir (aynı makinedeki iki stüdyo birbirinin çerezini ezmesin): ada port eklenir."""
    return f"{COOKIE_PREFIX}{int(server_port or 0)}"


def _new_cookie() -> str:
    value = secrets.token_urlsafe(32)
    _cookies[value] = time.time()
    while len(_cookies) > MAX_COOKIES:
        old, _ = _cookies.popitem(last=False)
        for tok in [t for t, c in _pages.items() if c == old]:
            _pages.pop(tok, None)
    return value


def _known_cookie(value: str | None) -> str | None:
    if not value:
        return None
    for known in _cookies:
        if hmac.compare_digest(known.encode(), value.encode()):
            return known
    return None


def open_session(cookie: str | None = None) -> tuple[str, str, bool]:
    """Yeni sayfa jetonu üretir; geçerli çerez varsa ona bağlar, yoksa yeni çerez açar. (çerez, jeton, yeni_çerez)"""
    with _lock:
        known = _known_cookie(cookie)
        fresh = known is None
        value = known or _new_cookie()
        _cookies.move_to_end(value)
        token = secrets.token_urlsafe(32)
        _pages[token] = value
        while len(_pages) > MAX_PAGES:
            _pages.popitem(last=False)
        return value, token, fresh


def credentials_ok(token: str | None, cookie: str | None) -> bool:
    """Sayfa jetonu canlı ve sunulan çereze bağlı mı (sabit zamanlı karşılaştırma)."""
    if not token or not cookie:
        return False
    with _lock:
        bound = None
        for known, value in _pages.items():
            if hmac.compare_digest(known.encode(), token.encode()):
                bound = value
                break
        if bound is None or not hmac.compare_digest(bound.encode(), cookie.encode()):
            return False
        # Kullanılan oturum canlı kalır: başka sekmelerin yeniden yüklemeleri etkin sekmenin jetonunu düşürmez
        _pages.move_to_end(token)
        _cookies.move_to_end(bound)
        return True


def reset_sessions() -> None:
    """Testler için: tüm oturumları düşürür."""
    with _lock:
        _cookies.clear()
        _pages.clear()


def secrets_in_memory() -> list[str]:
    """Testler için: sızıntı taramasında aranacak canlı değerler."""
    with _lock:
        return [*_cookies.keys(), *_pages.keys()]


# ---------------------------------------------------------------- sınıflandırma ve doğrulama
def is_user_only(method: str, path: str) -> bool:
    """Kullanıcı varlığı isteyen istek mi: durum değiştiren yöntem + kullanıcıya ait yol ya da onay kararı."""
    return method.upper() not in SAFE and bool(USER_ONLY_RE.match(path) or DECISION_RE.match(path)
                                                  or EXTRA_USER_ONLY_RE.match(path) or PRESENCE_OR_MCP_RE.match(path))


def _cookie_from(headers: dict[str, str], name: str) -> str | None:
    raw = headers.get("cookie")
    if not raw:
        return None
    jar: SimpleCookie = SimpleCookie()
    try:
        jar.load(raw)
    except Exception:  # noqa: BLE001 - bozuk çerez başlığı: çerez yok say
        return None
    morsel = jar.get(name)
    return morsel.value if morsel is not None else None


def same_origin(headers: dict[str, str]) -> bool:
    """Origin var, "null" değil ve Host ile birebir aynı köken (Vite vekilinde Host da vekilin adresidir)."""
    origin = (headers.get("origin") or "").strip()
    host = (headers.get("host") or "").strip().lower()
    if not origin or origin == "null" or not host:
        return False
    parts = urlsplit(origin)
    if parts.scheme not in ("http", "https") or parts.netloc.lower() != host:
        return False
    site = (headers.get("sec-fetch-site") or "").strip().lower()
    return not site or site == "same-origin"


def headers_present(headers: dict[str, str], server_port: int | None) -> bool:
    """Başlık katmanı: `X-Studio-Client` yok, sayfa jetonu + bağlı çerez + aynı köken Origin var."""
    if headers.get(CLIENT_HEADER):
        return False
    if not same_origin(headers):
        return False
    return credentials_ok(headers.get(UI_HEADER), _cookie_from(headers, cookie_name(server_port)))


def ui_present(request: Any) -> bool:
    """İstek stüdyo arayüzünden mi. MCP'yi sınırlayan A-08 kapıları (ajan izni, korunan ayarlar, teslim/mesaj okundu)
    bunu kullanır: başlıksız yerel süreç de MCP kadar sınırlı kalır. Karşı süreç denetimi ara katmanda yapılır."""
    if STATE_KEY in request.scope:
        return bool(request.scope[STATE_KEY])
    headers = {k.lower(): v for k, v in request.headers.items()}
    return headers_present(headers, server_port(request.scope))


def ui_present_strict(request: Any) -> bool:
    """okuma (GET) dahil her yöntemde tam arayüz varlığı: `X-Studio-Client` yok (boşluk dahil), sayfa jetonu +
    bağlı çerez + aynı köken Origin, ve istek stüdyonun başlattığı bir süreçten gelmiyor. Ara katman güvenli
    yöntemlerde kimlik denetlemediği için özel okumalar (ör. eğlence sorusu yanıtı) bunu rotada çağırır."""
    headers = {k.lower(): v for k, v in request.headers.items()}
    if CLIENT_HEADER in headers:
        return False
    if not ui_present(request):
        return False
    scope = request.scope
    client = scope.get("client") or (None, None)
    return peer.from_studio(client[0], client[1], server_port(scope)) is not True


def _bootstrap_request(headers: dict[str, str]) -> bool:
    """Oturum belgesi yalnızca stüdyo sayfasının kendi kökeninden açtığı iframe gezinmesine verilir."""
    return (headers.get("sec-fetch-site", "").lower() == "same-origin"
            and headers.get("sec-fetch-mode", "").lower() == "navigate"
            and headers.get("sec-fetch-dest", "").lower() == "iframe"
            and not headers.get(CLIENT_HEADER))


async def _from_studio(scope: Scope) -> bool:
    client = scope.get("client") or (None, None)
    server = scope.get("server") or (None, None)
    verdict = await asyncio.to_thread(peer.from_studio, client[0], client[1], server[1])
    return verdict is True


def _audit(scope: Scope, action: str, **data: Any) -> None:
    """Oturum açılışı ve süreç reddi olay yoluna yazılır (jeton/çerez değeri asla)."""
    try:
        scope["app"].state.studio.bus.publish("ui.presence", action=action, **data)
    except Exception:  # noqa: BLE001 - denetim kaydı kapıyı bozmamalı
        log.debug("ui.presence olayı yayınlanamadı", exc_info=True)


class UserPresenceMiddleware:
    def __init__(self, app: Callable[..., Awaitable[None]]):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        raw = [k.decode("latin-1").lower() for k, _ in scope.get("headers", [])]
        # kimlik başlıkları tek olmalı. Çift `X-Studio-Client`/`X-Studio-UI` (ya da Origin) gönderen istek, ara
        # katmanın son değeri, bağımlılığın ilk değeri okumasından doğan farkla kullanıcı-yalnız kapıyı atlayabiliyordu.
        for name in (CLIENT_HEADER, UI_HEADER, "origin", "cookie"):
            if raw.count(name) > 1:
                await _json(send, 400, {"detail": "Yinelenen kimlik başlığı", "code": "duplicate_identity_header"})
                return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        method = str(scope.get("method", "GET")).upper()
        path = str(scope.get("path") or "")
        port = server_port(scope)
        if path == BOOTSTRAP_PATH:
            await self._bootstrap(scope, send, method, headers, port)
            return
        if method not in SAFE:
            present = headers_present(headers, port)
            if present and await _from_studio(scope):
                present = False
                _audit(scope, "denied_studio_process", path=path)
                log.warning("kullanıcı kimlik bilgisi uygulamanın başlattığı bir süreçten geldi; reddedildi: %s", path)
            scope[STATE_KEY] = present
            # AGENT-DELETE: arayüz dışı silme (kullanıcı-yalnız yollar aşağıdaki/rotadaki kendi kapısında kalır)
            if method == "DELETE" and path.startswith("/api/") and not present and not is_user_only(method, path):
                if not headers.get(CLIENT_HEADER) and same_origin(headers):
                    # jetonu düşmüş arayüz sekmesi: lib/presence.ts oturumu yenileyip yeniden dener (ajan bildirimi yok)
                    await _json(send, 403, {"detail": DENIED, "code": DENIED_CODE})
                    return
                studio = getattr(getattr(scope.get("app"), "state", None), "studio", None)
                if not agent_delete_allowed(studio):
                    info = agent_delete_refusal(headers, path)
                    try:
                        studio.bus.publish("clients.delete_refused", **info)  # type: ignore[union-attr]
                    except Exception:  # noqa: BLE001 - bildirim kapıyı bozmamalı
                        log.debug("clients.delete_refused yayınlanamadı", exc_info=True)
                    await _json(send, 403, {"detail": AGENT_DELETE_TR, "code": AGENT_DELETE_CODE,
                                            "message_tr": AGENT_DELETE_TR, "message_en": AGENT_DELETE_EN,
                                            "setting": AGENT_DELETE_SETTING, "settings_page": AGENT_DELETE_PAGE,
                                            **info})
                    return
            if is_user_only(method, path) and not _mcp(headers):
                # Arayüz olduğunu varsayan istek tam kimlik göstermeli; hook/CLI/tanınmayan başlık arayüz değildir.
                # `mcp/*` istekleri burada geçer: kullanıcıya ait yolların hepsi `client_seen` bağımlılığında (ya da
                # heroes `user_only`) MCP'ye 403 verir; onay kararında kullanıcının açık izni (clients.mcp.allow_decisions)
                # ve kendi koşusunu onaylama yasağı da orada uygulanır. tests/test_user_presence.py her yolu sınar.
                if not present:
                    await _json(send, 403, {"detail": DENIED, "code": DENIED_CODE})
                    return
        await self.app(scope, receive, send)

    async def _bootstrap(self, scope: Scope, send: Send, method: str, headers: dict[str, str],
                         server_port: int | None) -> None:
        if method != "GET":
            await _json(send, 405, {"detail": "Yalnızca GET"})
            return
        if not _bootstrap_request(headers):
            await _json(send, 403, {"detail": DENIED, "code": DENIED_CODE})
            return
        if await _from_studio(scope):
            _audit(scope, "denied_studio_process", path=BOOTSTRAP_PATH)
            log.warning("arayüz oturumu uygulamanın başlattığı bir süreçten istendi; reddedildi")
            await _json(send, 403, {"detail": DENIED, "code": DENIED_CODE})
            return
        name = cookie_name(server_port)
        cookie, token, fresh = open_session(_cookie_from(headers, name))
        _audit(scope, "session_opened", new_browser=fresh)
        body = (f'<!doctype html><meta charset="utf-8"><meta name="vc-ui" content="{token}">'
                '<title>-</title>').encode("utf-8")
        out = [(b"content-type", b"text/html; charset=utf-8"), (b"content-length", str(len(body)).encode()),
               (b"cache-control", b"no-store"), (b"pragma", b"no-cache"), (b"x-frame-options", b"SAMEORIGIN"),
               (b"content-security-policy", b"default-src 'none'; frame-ancestors 'self'"),
               (b"referrer-policy", b"no-referrer"), (b"x-content-type-options", b"nosniff")]
        if fresh:
            out.append((b"set-cookie",
                        f"{name}={cookie}; Path=/api; HttpOnly; SameSite=Strict".encode("latin-1")))
        await send({"type": "http.response.start", "status": 200, "headers": out})
        await send({"type": "http.response.body", "body": body})


def _mcp(headers: dict[str, str]) -> bool:
    parsed = parse_header(headers.get(CLIENT_HEADER))
    return bool(parsed) and parsed[0] == "mcp"


async def _json(send: Send, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json; charset=utf-8"),
                            (b"content-length", str(len(body)).encode()),
                            (b"cache-control", b"no-store")]})
    await send({"type": "http.response.body", "body": body})
