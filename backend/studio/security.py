"""Yerel-yalnız güvenlik katmanı (QA-B2 DNS rebinding, QA-m7 CSRF).

- Host başlığı yalnızca loopback adları olabilir (127.0.0.1, localhost, ::1) — 127.0.0.1'e bağlanmak tek başına
  DNS rebinding'e karşı korumaz.
- Durum değiştiren yöntemlerde (POST/PUT/PATCH/DELETE) tarayıcı başka bir siteden geliyorsa (Origin loopback
  değil, Origin "null" ya da Sec-Fetch-Site cross-site) istek reddedilir. Origin göndermeyen yerel istemciler
  (curl, Claude Code hook betiği, testler) etkilenmez.
- Tüm yöntemlerde (GET dahil; denetim B-12) tarayıcının `Sec-Fetch-Site: cross-site` ya da `same-site` (başka port /
  başka yerel ad) işaretlediği istekler reddedilir: yan etkili GET uçları (`<img src=…/api/…>`) başka siteden
  tetiklenemez. Stüdyonun kendi arayüzü (Vite vekili dahil) `same-origin`, adres çubuğu / yer imi `none` gönderir.
  Tek istisna: başka siteden gelen bağlantıyla üst düzey sayfa açılışı (`Sec-Fetch-Mode: navigate`,
  `Sec-Fetch-Dest: document`, GET/HEAD) `/api` dışındaki yollarda serbesttir — stüdyo bir bağlantıdan açılabilsin.
  Başlığı göndermeyen istemciler (curl, MCP sunucusu, testler) etkilenmez.
- Ek host adları `STUDIO_ALLOWED_HOSTS` ortam değişkeniyle (virgülle) eklenebilir.
- İstek gövdesi boyutu sınırlıdır (varsayılan 4 MiB, `STUDIO_MAX_BODY_BYTES`): Content-Length büyükse 413 döner;
  Content-Length'siz (chunked) gövdeler okunurken sayılır ve sınır aşılınca 413 ile kesilir. Daha sıkı sınır
  isteyen uç noktalar (ör. Claude Code alımı ≤ 256 KB) kendi denetimini ayrıca yapar.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit

from starlette.exceptions import HTTPException

from studio.brand import NAME

LOOPBACK = {"127.0.0.1", "localhost", "::1", "[::1]"}
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
FOREIGN_SITES = {"cross-site", "same-site"}  # Sec-Fetch-Site: stüdyonun kendi kökeni dışı
DEFAULT_MAX_BODY = 4 * 1024 * 1024
# DELIV-P0 (D4): sandbox'lı uygulama önizlemesinin alt kaynakları (opak köken → `Sec-Fetch-Site: cross-site`) yalnızca
# TAHMİN EDİLEMEZ oturum belirteciyle okunur (`/site/<belirteç>/…`; belirteci yalnızca arayüzün kullanıcı-yalnız POST'u verir,
# rota geçerliliğini ayrıca denetler). Yalnızca GET/HEAD; belirteçsiz `/api` istekleri eskisi gibi reddedilir.
SITE_ASSET_RE = re.compile(r"^/api/deliverables/[^/]+/site/[A-Za-z0-9_-]{20,}(?:/|$)")

Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]


class BodyTooLarge(HTTPException):
    """Gövde sınırı aşıldı (Content-Length'siz akışta okuma sırasında fark edilir). HTTPException olduğu için
    FastAPI gövde ayrıştırması bunu 400'e çevirmez; uygulama içi istisna katmanı 413 yanıtı üretir."""

    def __init__(self, limit: int = DEFAULT_MAX_BODY):
        super().__init__(status_code=413, detail=f"İstek gövdesi çok büyük (sınır {limit // 1024} KB)")


def allowed_hosts() -> set[str]:
    extra = {h.strip().lower() for h in os.environ.get("STUDIO_ALLOWED_HOSTS", "").split(",") if h.strip()}
    # "testserver" (Starlette TestClient) yalnızca testlerde: conftest STUDIO_ALLOWED_HOSTS ile ekler (QA-F3 m9)
    return LOOPBACK | extra


def max_body_bytes() -> int:
    try:
        value = int(os.environ.get("STUDIO_MAX_BODY_BYTES", "") or DEFAULT_MAX_BODY)
    except ValueError:
        return DEFAULT_MAX_BODY
    return value if value > 0 else DEFAULT_MAX_BODY


def _host_only(host: str) -> str:
    host = host.strip().lower()
    if host.startswith("["):
        return host.split("]", 1)[0] + "]"
    return host.rsplit(":", 1)[0] if host.count(":") == 1 else host


class LocalOnlyMiddleware:
    def __init__(self, app: Callable[..., Awaitable[None]], max_body: int | None = None):
        self.app = app
        self.hosts = allowed_hosts()
        self.max_body = max_body or max_body_bytes()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        if _host_only(headers.get("host", "")) not in self.hosts:
            await _reject(send, 400, f"Geçersiz Host başlığı: {NAME} yalnızca yerel adresten kullanılabilir")
            return
        method = scope.get("method", "GET").upper()
        if _foreign_fetch(headers, method, str(scope.get("path") or "")):
            await _reject(send, 403, "Başka bir siteden gelen istek reddedildi")
            return
        if method in UNSAFE:
            origin = headers.get("origin")
            site = headers.get("sec-fetch-site", "")
            cross = site == "cross-site"
            if origin is not None:
                o_host = (urlsplit(origin).hostname or "").lower() if origin != "null" else ""
                cross = cross or o_host not in self.hosts
            if cross:
                await _reject(send, 403, "Başka bir siteden gelen istek reddedildi")
                return
        started: dict[str, bool] | None = None
        if scope.get("type") == "http":
            length = headers.get("content-length")
            if length is not None:
                try:
                    too_big = int(length) > self.max_body
                except ValueError:
                    await _reject(send, 400, "Geçersiz Content-Length başlığı")
                    return
                if too_big:
                    await _reject(send, 413, f"İstek gövdesi çok büyük (sınır {self.max_body // 1024} KB)")
                    return
            receive, send, started = _limit_body(receive, send, self.max_body)
        try:
            await self.app(scope, receive, send)
        except BodyTooLarge:
            if started is None or started["value"]:
                raise
            await _reject(send, 413, f"İstek gövdesi çok büyük (sınır {self.max_body // 1024} KB)")


def _foreign_fetch(headers: dict[str, str], method: str, path: str) -> bool:
    """Tarayıcı başka bir siteden (ya da aynı sitenin başka kökeninden) gelen isteği işaretlediyse True (B-12).
    Üst düzey sayfa açılışı `/api` dışında serbest; `/api` ve alt kaynaklar (img, script, fetch, websocket) değil."""
    site = headers.get("sec-fetch-site", "").strip().lower()
    if site not in FOREIGN_SITES:
        return False
    top_level = (headers.get("sec-fetch-mode", "").lower() == "navigate"
                 and headers.get("sec-fetch-dest", "document").lower() == "document")
    is_api = path == "/api" or path.startswith("/api/")
    if method in ("GET", "HEAD") and SITE_ASSET_RE.match(path):
        return False
    return not (top_level and method in ("GET", "HEAD") and not is_api)


def _limit_body(receive: Receive, send: Send, limit: int) -> tuple[Receive, Send, dict[str, bool]]:
    """Gövdeyi okunurken sayar; sınır aşılırsa BodyTooLarge fırlatır. Yanıt başladı mı bilgisini de tutar."""
    seen = {"bytes": 0}
    started = {"value": False}

    async def limited_receive() -> dict[str, Any]:
        message = await receive()
        if message.get("type") == "http.request":
            seen["bytes"] += len(message.get("body", b"") or b"")
            if seen["bytes"] > limit:
                raise BodyTooLarge(limit)
        return message

    async def tracking_send(message: dict[str, Any]) -> None:
        if message.get("type") == "http.response.start":
            started["value"] = True
        await send(message)

    return limited_receive, tracking_send, started


async def _reject(send: Send, status: int, message: str) -> None:
    body = json.dumps({"detail": message}, ensure_ascii=False).encode("utf-8")
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json; charset=utf-8"),
                            (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})
