"""Çıktılar uç noktaları (S50) — koşuların kullanıcıya teslim ettiği raporlar ve dosyalar.

| Uç | Gövde / sorgu | Yanıt |
|---|---|---|
| `GET /api/deliverables` | `?q=&agent=&team=&project=&goal=&kind=&source=&run=&since=&until=&pinned=&unread=&limit=&offset=` | `{items, total, unread, facets, goals}` |
| `GET /api/deliverables/unread` | — | `{count}` |
| `GET /api/deliverables/{id}` | — | `{item, content: {kind, text?, lang?, truncated}, abs_path?}` (metin maskeli) |
| `PATCH /api/deliverables/{id}` | `{pinned?, read?}` | `{ok, item}` · MCP 403 (yalnızca kullanıcı) |
| `POST /api/deliverables/read-all` | — | `{ok, count}` · MCP 403 |
| `GET /api/deliverables/{id}/download` | `?format=md\\|txt\\|docx\\|original` | ek dosya (metin maskeli) |
| `GET /api/deliverables/{id}/raw` | — | görsel/PDF dosyası (satır içi) |
| `POST /api/deliverables/{id}/original` | — | D1: ikili orijinal (maskelenmemiş), `attachment` + `nosniff` · YALNIZ arayüz (403) |
| `POST /api/deliverables/{id}/reveal` | `{}` → plan · `{confirm: true, plan_hash}` → dosya yöneticisi | D3 · YALNIZ arayüz; yol sunucuda çözülür |
| `POST /api/deliverables/{id}/site-session` | `{scripts?: bool}` (varsayılan false) | D4: önizleme oturumu `{url, scripts}` (tahmin edilemez belirteç, 2 sa); betik yalnız açık onayla · YALNIZ arayüz |
| `GET /api/deliverables/{id}/site/{belirteç}/{yol}` (GET ve HEAD) | — | D4: `kind: app` paketinden dosya (CSP sandbox, `connect-src 'none'`; betiksiz kipte `script-src 'none'`) · belirteçsiz/MCP 403 |
| `POST /api/deliverables/zip` · `POST /api/deliverables/{id}/zip` | `{run_id / ids[], unmasked?, dry_run?}` | kasa baytlarından zip + `MANIFEST.txt`; `dry_run` → `{count, bytes, skipped[]}` · YALNIZ arayüz (403) — bkz. `bundle.py` |
| `GET /api/deliverables/{id}/versions` | — | `{items}` aynı `family`'nin sürümleri |
| `GET /api/deliverables/{id}/diff` | `?against=<sürüm kimliği>` | `{left, right, mode, …}` aynı `family`'nin iki sürümü; metin farkı MASKELİ (`compare.py`) |
| `POST /api/deliverables/{id}/view` | — | PDF / ses / video baytları (KASA kopyası, maskelenmemiş ikili, boyut sınırlı) · YALNIZ arayüz (403) |

Teslim (CG-DELIVER): `/api/delivery/*` ve `GET /api/deliverables/{id}/deliveries` bu router'a eklenir; liste ve tekil
kalemlerde son başarılı teslim `delivery {target, label, link, ref, delivered_at}` alanındadır.

Dışa aktarımlar her zaman `redact_text`'ten geçer; ham dosya yalnızca görsel ve PDF içindir.
"""

from __future__ import annotations

import asyncio
import mimetypes
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from studio.deliverables import reveal as reveal_mod
from studio.deliverables.formats import RAW_EXT, RAW_PUBLIC_EXT
from studio.deliverables.service import KINDS, SOURCES, DeliverableService, ViewError

if TYPE_CHECKING:
    from studio.api import Studio

FORMATS = ("md", "txt", "docx", "original")
USER_ONLY = "Bu işlem yalnızca uygulama arayüzünden, kullanıcı tarafından yapılabilir"
UI_ONLY_BINARY = "Bu dosya yalnızca uygulama arayüzünden, maskelenmemiş orijinal olarak indirilebilir"
UI_ONLY_VIEW = "Bu önizleme yalnızca uygulama arayüzünden, kullanıcı tarafından açılabilir"  # DEPO-TESLIM
# D4: uygulama önizlemesi — opak köken (sandbox, allow-same-origin YOK), ağ yok, form yok, yalnızca kendi dosyaları.
# VARSAYILAN betiksiz (`sandbox` boş, `script-src 'none'`): CSP, çerçevenin kendini başka siteye yönlendirmesini
# (`location = 'https://…'`) sınırlayamaz; betik çalışırsa paket içeriği dışarı taşınabilir. Betik yalnızca kullanıcının
# oturum başına açık onayıyla (`site-session {scripts: true}`) çalışır ve kalıcı değildir.
_SITE_COMMON = ("style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; "
                "media-src 'self' data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; "
                "frame-ancestors 'self'")
SITE_CSP_NOSCRIPT = f"sandbox; default-src 'none'; script-src 'none'; {_SITE_COMMON}"
SITE_CSP_SCRIPTS = f"sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; {_SITE_COMMON}"
SITE_CSP = SITE_CSP_SCRIPTS  # geriye uyum: betikli kip
_SITE_BASE = {"X-Content-Type-Options": "nosniff",
              "Access-Control-Allow-Origin": "*",  # opak köken (sandbox): ES modülü / yazı tipi CORS'u; belirteç zaten gizli
              "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
              "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
              "Cross-Origin-Opener-Policy": "same-origin"}


def site_headers(scripts: bool = False) -> dict[str, str]:
    return {"Content-Security-Policy": SITE_CSP_SCRIPTS if scripts else SITE_CSP_NOSCRIPT, **_SITE_BASE}


SITE_HEADERS = site_headers(False)  # hata yanıtları ve varsayılan: betiksiz (en sıkı)
# Betiksiz kipte `<meta http-equiv=…>` (refresh = otomatik gezinme; değer HTML varlıklarıyla gizlenebilir) söküm.
# regex DEĞİL, HTML belirteçleme kurallarını izleyen küçük bir ayrıştırıcı (tırnaklı / tırnaksız / kapanmamış
# tırnaklı değerler tarayıcıyla aynı biçimde bölünür). Asıl koruma CSP `sandbox`; bu derinlemesine savunmadır.
SITE_HTML_SANITIZE_MAX = 16 * 1024 * 1024
_WS = " "+chr(9)+chr(10)+chr(13)+chr(12)


def _meta_end(text: str, i: int) -> tuple[int, bool]:
    """`<meta`'den sonraki konumdan etiket sonuna kadar öznitelikleri okur → (bitiş konumu, http-equiv var mı)."""
    n, equiv = len(text), False
    while i < n:
        while i < n and text[i] in _WS + "/":
            i += 1
        if i >= n:
            break
        if text[i] == ">":
            return i + 1, equiv
        j = i
        while j < n and text[j] not in _WS + "/>=":
            j += 1
        if text[i:j].lower() == "http-equiv":
            equiv = True
        i = j if j > i else i + 1
        while i < n and text[i] in _WS:
            i += 1
        if i < n and text[i] == "=":
            i += 1
            while i < n and text[i] in _WS:
                i += 1
            if i < n and text[i] in "\"'":
                q = text[i]
                end = text.find(q, i + 1)
                i = n if end < 0 else end + 1
            else:
                while i < n and text[i] not in _WS + ">":
                    i += 1
    return n, equiv


def strip_meta_equiv(html: bytes) -> bytes:
    text = html.decode("utf-8", "replace")
    out: list[str] = []
    pos = 0
    low = text.lower()
    while True:
        k = low.find("<meta", pos)
        if k < 0:
            break
        after = k + 5
        if after < len(text) and text[after] not in _WS + "/>":  # `<metadata>` gibi başka etiket
            out.append(text[pos:after])
            pos = after
            continue
        end, equiv = _meta_end(text, after)
        out.append(text[pos:k])
        if not equiv:
            out.append(text[k:end])
        pos = end
    out.append(text[pos:])
    return "".join(out).encode("utf-8")


def get_service(studio: "Studio") -> DeliverableService:
    svc = getattr(studio, "_deliverables", None)
    if svc is None:
        svc = DeliverableService.for_engine(studio.engine, data_dir=studio.changes.data_dir)
        studio._deliverables = svc  # type: ignore[attr-defined]
    return svc


def _disposition(filename: str, inline: bool = False) -> str:
    ascii_name = filename.encode("ascii", "ignore").decode("ascii").replace('"', "") or "cikti"
    return f'{"inline" if inline else "attachment"}; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(filename)}'


def build_router(studio: "Studio") -> APIRouter:
    r = APIRouter(tags=["deliverables"])

    def guard(fn: Any) -> Any:
        try:
            return fn()
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(404, "Dosya artık çalışma klasöründe yok") from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    def user_only(request: Request) -> None:
        from studio.presence import ui_present
        if not ui_present(request):  # MCP ve arayüz jetonu olmayan başlıksız yerel süreç
            raise HTTPException(403, USER_ONLY)

    async def user_only_strict(request: Request, message: str = USER_ONLY) -> None:
        """D1/D3: tam kullanıcı varlığı (arayüz jetonu + bağlı çerez + aynı köken Origin + `X-Studio-Client` yok +
        istek stüdyonun başlattığı süreçten gelmiyor). Okuma değil POST olduğundan tarayıcı Origin'i gönderir."""
        from studio.presence import ui_present_strict
        if not await asyncio.to_thread(ui_present_strict, request):
            raise HTTPException(403, message)

    @r.get("/api/deliverables")
    async def list_deliverables(request: Request, q: str | None = None, agent: str | None = None, team: str | None = None,
                                project: str | None = None, goal: str | None = None, kind: str | None = None,
                                source: str | None = None, run: str | None = None, since: str | None = None,
                                until: str | None = None, pinned: bool | None = None, unread: bool | None = None,
                                limit: int = 100, offset: int = 0, recipe: str | None = None) -> dict[str, Any]:
        if kind and kind not in KINDS:
            raise HTTPException(400, f"Geçersiz çıktı türü: {kind}")
        if source and source not in SOURCES:
            raise HTTPException(400, f"Geçersiz çıktı kaynağı: {source}")
        svc = get_service(studio)
        out = await asyncio.to_thread(lambda: svc.list(
            q=(q or "")[:200] or None, agent=agent or None, team=team or None, project=project or None,
            goal=goal or None, kind=kind or None, source=source or None, run=run or None, since=since or None,
            until=until or None, pinned=bool(pinned), unread=bool(unread), limit=limit, offset=offset,
            recipe=(recipe or "")[:60] or None))  # FOLLOWUP: tarif süzgeci ("*" = herhangi bir tarif)
        _attach_delivery(out["items"], request)  # CG-DELIVER: son teslim rozeti ("Teslim edildi: GitHub PR #12")
        return out

    @r.get("/api/deliverables/unread")
    def unread() -> dict[str, Any]:
        return {"count": get_service(studio).unread_count()}

    @r.post("/api/deliverables/read-all")
    async def read_all(request: Request) -> dict[str, Any]:
        user_only(request)
        return {"ok": True, "count": get_service(studio).mark_all_read()}

    @r.get("/api/deliverables/{did}")
    async def get_one(did: str, request: Request) -> dict[str, Any]:
        svc = get_service(studio)
        item = guard(lambda: svc.get(did))
        content = await asyncio.to_thread(lambda: guard(lambda: svc.content(did)))
        if not (request.headers.get("x-studio-client") or "").strip():  # G1-C: kullanıcının açması (MCP okuması değil)
            svc.artifact_event("artifact_opened", item)
        _attach_delivery([item], request)
        return {"item": item, "content": content, "abs_path": guard(lambda: svc.abs_path(did))}

    @r.patch("/api/deliverables/{did}")
    async def patch(did: str, request: Request) -> dict[str, Any]:
        user_only(request)
        try:
            data = await request.json()
        except ValueError:
            data = None
        if not isinstance(data, dict):
            raise HTTPException(400, "Gövde bir nesne olmalı")
        for key in ("pinned", "read"):
            if key in data and not isinstance(data[key], bool):
                raise HTTPException(400, f"{key} true/false olmalı")
        svc = get_service(studio)
        return {"ok": True, "item": guard(lambda: svc.update(did, pinned=data.get("pinned"), read=data.get("read")))}

    @r.get("/api/deliverables/{did}/download")
    async def download(did: str, request: Request, format: str = "md") -> Response:  # noqa: A002 - sorgu parametresi adı
        if format not in FORMATS:
            raise HTTPException(400, f"Geçersiz biçim: {format}")
        svc = get_service(studio)
        item = guard(lambda: svc.get(did))
        if format == "original" and item.get("binary"):
            name = str(item.get("name") or "cikti")
            if Path(name).suffix.lower() not in RAW_EXT:  # D1: diğer ikili orijinaller yalnızca arayüzden (POST /original)
                raise HTTPException(403, UI_ONLY_BINARY)
            if Path(name).suffix.lower() not in RAW_PUBLIC_EXT:  # maskelenmemiş PDF jetonsuz GET ile verilmez
                await user_only_strict(request, UI_ONLY_BINARY)
            path = await asyncio.to_thread(lambda: guard(lambda: svc.raw_file(did)))
            svc.artifact_event("artifact_exported", item, format)  # G1-C: yalnız kimlik
            return FileResponse(path, media_type=item.get("mime") or mimetypes.guess_type(name)[0]
                                or "application/octet-stream",
                                headers={"Content-Disposition": _disposition(name),
                                         "X-Content-Type-Options": "nosniff"})
        text, stem = await asyncio.to_thread(lambda: guard(lambda: svc.export_text(did)))
        svc.artifact_event("artifact_exported", item, format)  # G1-C: yalnız kimlik
        if format == "docx":
            from studio.deliverables.export import markdown_to_docx
            data = await asyncio.to_thread(markdown_to_docx, text, item.get("title") if item["source"] == "output"
                                           else None)
            return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                            headers={"Content-Disposition": _disposition(f"{stem}.docx")})
        if format == "original":
            name = str(item.get("name") or f"{stem}.txt")
            media = mimetypes.guess_type(name)[0] or "text/plain"
            if not media.startswith("text/") and media not in ("application/json", "application/xml"):
                media = "text/plain"
        else:
            name, media = f"{stem}.{format}", "text/markdown" if format == "md" else "text/plain"
        return Response(text.encode("utf-8"), media_type=f"{media}; charset=utf-8",
                        headers={"Content-Disposition": _disposition(name), "X-Content-Type-Options": "nosniff"})

    @r.get("/api/deliverables/{did}/raw")
    async def raw(did: str, request: Request) -> Response:
        svc = get_service(studio)
        item = guard(lambda: svc.get(did))
        if Path(str(item.get("name") or "")).suffix.lower() not in RAW_PUBLIC_EXT:  # PDF yalnız tam kullanıcı varlığıyla
            await user_only_strict(request, UI_ONLY_BINARY)
        path = await asyncio.to_thread(lambda: guard(lambda: svc.raw_file(did)))
        name = str(item.get("name") or path.name)
        media = mimetypes.guess_type(name)[0] or "application/octet-stream"
        if Path(name).suffix.lower() == ".svg":
            media = "image/svg+xml"
        # SVG içinde betik çalışmasın: kum havuzu + nosniff (img etiketinde zaten çalışmaz)
        return FileResponse(path, media_type=media, headers={
            "Content-Disposition": _disposition(name, inline=True), "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'"})

    @r.post("/api/deliverables/{did}/original")
    async def original(did: str, request: Request) -> Response:
        """D1: ikili orijinal (pptx/xlsx/docx/zip/mp4…), MASKELENMEMİŞ — yalnızca arayüzden. Metin dosyaları 403."""
        await user_only_strict(request, UI_ONLY_BINARY)
        svc = get_service(studio)
        item = guard(lambda: svc.get(did))
        path, name = await asyncio.to_thread(lambda: guard(lambda: svc.original_file(did)))
        svc.artifact_event("artifact_exported", item, "original")  # G1-C: yalnız kimlik
        media = item.get("mime") or mimetypes.guess_type(name)[0] or "application/octet-stream"
        return FileResponse(path, media_type=media, headers={
            "Content-Disposition": _disposition(name), "X-Content-Type-Options": "nosniff",
            "X-Studio-Unmasked": "1", "Cache-Control": "no-store"})

    @r.post("/api/deliverables/{did}/reveal", response_model=None)
    async def reveal(did: str, request: Request) -> Any:
        """D3: plan → onay → dosya yöneticisi. Gövde `{}` = plan; `{confirm: true, plan_hash}` = aç. Yol sunucuda çözülür."""
        await user_only_strict(request)
        try:
            data = await request.json()
        except ValueError:
            data = None
        if not isinstance(data, dict):
            raise HTTPException(400, "Gövde bir nesne olmalı")
        svc = get_service(studio)
        try:
            if data.get("confirm") is True:
                out = await asyncio.to_thread(reveal_mod.confirm, svc, did, data.get("plan_hash"))
                svc._publish("deliverable.revealed", id=did)  # yol yok
                return out
            return await asyncio.to_thread(reveal_mod.plan, svc, did)
        except reveal_mod.RevealError as exc:
            return JSONResponse({"detail": str(exc), "code": exc.code}, status_code=exc.status)
        except KeyError as exc:
            raise HTTPException(404, str(exc).strip("'")) from exc
        except FileNotFoundError as exc:
            raise HTTPException(404, "Dosya artık çalışma klasöründe yok") from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    from studio.deliverables.bundle import build_router as zip_router  # zip paketi (yalnız arayüz)
    r.include_router(zip_router(studio, get_service))

    @r.get("/api/deliverables/{did}/versions")
    async def versions(did: str) -> dict[str, Any]:
        svc = get_service(studio)
        return {"items": await asyncio.to_thread(lambda: guard(lambda: svc.versions(did)))}

    # ---- DEPO-TESLIM: iki sürümün karşılaştırması (okuma; metin zaten `content` ile maskeli)
    @r.get("/api/deliverables/{did}/diff")
    async def diff(did: str, against: str = "") -> dict[str, Any]:
        if not against or len(against) > 200:
            raise HTTPException(400, "against (karşılaştırılacak sürüm) gerekli")
        svc = get_service(studio)
        return await asyncio.to_thread(lambda: guard(lambda: svc.compare(did, against)))

    # ---- DEPO-TESLIM: PDF / ses / video için satır içi görüntüleme baytları. Tarayıcı `<audio src>` / `<iframe src>`
    # istekleri sayfa jetonunu taşıyamaz; bu yüzden POST (jeton + çerez + Origin) ile alınıp `blob:` URL'sine çevrilir.
    @r.post("/api/deliverables/{did}/view", response_model=None)
    async def view(did: str, request: Request) -> Response:
        await user_only_strict(request, UI_ONLY_VIEW)
        svc = get_service(studio)
        try:
            path, media, name = await asyncio.to_thread(lambda: guard(lambda: svc.view_file(did)))
        except ViewError as exc:
            return JSONResponse({"detail": str(exc)}, status_code=exc.status)
        return FileResponse(path, media_type=media, headers={
            "Content-Disposition": _disposition(name, inline=True), "X-Content-Type-Options": "nosniff",
            "X-Studio-Unmasked": "1", "Cache-Control": "no-store",
            "Content-Security-Policy": "sandbox; default-src 'none'"})

    def _site_response(did: str, token: str, sub: str, request: Request) -> Response:
        svc = get_service(studio)
        # MCP / istemci başlığı ya da geçersiz/süresi dolmuş belirteç: maskelenmemiş uygulama dosyası verilmez
        if (request.headers.get("x-studio-client") or "").strip() or not svc.site_token_ok(did, token):
            return JSONResponse({"detail": USER_ONLY}, status_code=403, headers=SITE_HEADERS)
        scripts = svc.site_token_scripts(did, token)
        headers = site_headers(scripts)
        try:
            path, media = svc.site_file(did, sub)
        except KeyError as exc:
            return JSONResponse({"detail": str(exc).strip("'")}, status_code=404, headers=headers)
        except PermissionError as exc:
            return JSONResponse({"detail": str(exc)}, status_code=403, headers=headers)
        except FileNotFoundError:
            return JSONResponse({"detail": "Dosya pakette yok"}, status_code=404, headers=headers)
        if media.startswith("text/"):
            media += "; charset=utf-8"
        if not scripts and media.startswith("text/html"):
            try:
                if path.stat().st_size <= SITE_HTML_SANITIZE_MAX:
                    body = strip_meta_equiv(path.read_bytes())
                    resp = Response(b"" if request.method == "HEAD" else body, media_type=media, headers=headers)
                    resp.headers["content-length"] = str(len(body))
                    return resp
            except OSError:
                return JSONResponse({"detail": "Dosya pakette yok"}, status_code=404, headers=headers)
        return FileResponse(path, media_type=media, headers=headers)

    @r.post("/api/deliverables/{did}/site-session")
    async def site_session(did: str, request: Request) -> dict[str, Any]:
        """D4: önizleme oturumu. Yalnızca arayüz (jeton + çerez + aynı köken Origin); belirteç iframe `src` yolundadır.
        Gövde isteğe bağlı `{scripts: true}`: betikler yalnızca bu açık onayla çalışır; varsayılan kapalı."""
        await user_only_strict(request)
        try:
            data = await request.json()
        except ValueError:
            data = {}
        if data is not None and not isinstance(data, dict):
            raise HTTPException(400, "Gövde bir nesne olmalı")
        scripts = (data or {}).get("scripts")
        if scripts is not None and not isinstance(scripts, bool):
            raise HTTPException(400, f"{'scripts'} true/false olmalı")
        svc = get_service(studio)
        sess = await asyncio.to_thread(lambda: guard(lambda: svc.open_site_session(did, scripts=bool(scripts))))
        entry = "/".join(quote(part) for part in sess["entry"].split("/"))
        return {"url": f"/api/deliverables/{quote(did)}/site/{sess['token']}/{entry}", "entry": sess["entry"],
                "scripts": bool(sess["scripts"])}

    @r.api_route("/api/deliverables/{did}/site/{token}", methods=["GET", "HEAD"], response_model=None)
    async def site_root(did: str, token: str, request: Request) -> Response:
        return await asyncio.to_thread(_site_response, did, token, "", request)

    @r.api_route("/api/deliverables/{did}/site/{token}/{sub:path}", methods=["GET", "HEAD"], response_model=None)
    async def site(did: str, token: str, sub: str, request: Request) -> Response:
        return await asyncio.to_thread(_site_response, did, token, sub, request)

    def _attach_delivery(items: list[dict[str, Any]], request: Request | None = None) -> None:
        try:  # CG-DELIVER (isteğe bağlı): son başarılı teslim özeti; içerik taşımaz
            from studio.delivery.api import get_service as delivery_service
            latest = delivery_service(studio).store.latest_by_deliverable()
        except Exception:  # noqa: BLE001 - teslim modülü yoksa rozet yok
            return
        from studio.clients.tracker import mcp_client
        from studio.delivery.api import mcp_link
        mcp = mcp_client(request) is not None  # MCP rozette yerel / alıcı ayrıntısı görmez ( ile aynı kural)
        for it in items:
            rec = latest.get(str(it.get("id")))
            if rec:
                badge = {k: rec.get(k) for k in ("target", "label", "link", "ref", "delivered_at")}
                if mcp:
                    badge["link"] = None if str(badge.get("link") or "").startswith("file:") else mcp_link(badge.get("link"))
                it["delivery"] = badge

    try:  # CG-DELIVER: /api/delivery/* ve /api/deliverables/{id}/deliveries (yazma uçları kullanıcı-yalnız)
        from studio.delivery.api import build_router as delivery_router, get_service as delivery_service
        delivery_service(studio)
        r.include_router(delivery_router(studio))
    except ImportError:
        pass
    try:  # CG-QUALITY: /api/quality/* (okuma serbest; yazma uçları kullanıcı-yalnız)
        from studio.quality.api import build_router as quality_router
        r.include_router(quality_router(studio))
    except ImportError:
        pass

    return r


async def start(studio: "Studio") -> None:
    """Açılışta: motor kancası + sınırlı geri doldurma (son 200 bitmiş koşu; iş parçacığında, açılışı bekletmez)."""
    svc = get_service(studio)
    svc.attach(studio.engine)

    async def _backfill() -> None:
        try:
            await asyncio.to_thread(svc.backfill)
            if svc.vault is not None:  # unutmada silinemeyen kasa dosyaları (açık tutamaç) yeniden denenir
                await asyncio.to_thread(svc.vault.purge_pending)
        except Exception:  # noqa: BLE001 - geri doldurma açılışı bozmaz
            import logging
            logging.getLogger("studio.deliverables").exception("geri doldurma başarısız")

    task = asyncio.get_running_loop().create_task(_backfill())
    studio._deliverables_backfill = task  # type: ignore[attr-defined]


async def stop(studio: "Studio") -> None:
    task = getattr(studio, "_deliverables_backfill", None)
    if task is not None and not task.done():
        task.cancel()
