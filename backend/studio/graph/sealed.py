"""mühürlü (ayrık değerlendirme) ad alanları — koşu sürerken okuma uçlarından görünmez.

Ayrık (holdout) matris denemesi, vakanın `memory_facts` bilgilerini koşudan önce yalıtılmış `project:eval-…` ad alanına
yazar ve koşu bitince siler. Koşu sürerken bu bilgiler grafta durur; motor onları kendi içinden (hatırlama) okur, ama
hiçbir HTTP okuma ucu (MCP ya da arayüz, `GET /api/graph`, arama, hatırlama, dışa aktarım …) göstermemelidir.

`seal` ad alanını ve bilgi metinlerini kaydeder, `add_ids` yazılan düğüm kimliklerini ekler, `unseal` kaldırır.
`SealedReadMiddleware` yalnız en az bir mühür etkinken çalışır (aksi hâlde maliyetsiz geçiş) ve `GET /api/*`
yanıtlarını süzer:
- JSON: mühürlü ad alanına (`namespace`, `project`, `props.namespace`) ya da mühürlü düğüm kimliğine (`id`, `src`,
  `dst`) ait nesneler listelerden çıkarılır; tek nesne yanıtı `{"id", "sealed": true}` olur; mühürlü metni (ya da ilk
  `PREFIX` karakterini ve devamını, önekte kesik kopyasını ya da son `PREFIX` karakterini; bkz. `_keys`) taşıyan her
  metin alanı `MARK` olur.
- Metin yanıtları: aynı metin karartması.
- İkili yanıtlar (zip, dosya): mühür sürerken 423 (dışa aktarım koşu bitince yapılır). GET dışı yöntemler de
  (POST `/api/portability/export` dahil) süzülür; yolu mühürlü kimlik/ad alanı taşıyan GET dışı istek 423 alır.
  423 gövdesi `{"detail", "code": "sealed"}`; arayüz koda göre kendi TR/EN iletisini gösterir.
SSE akışı süzülmez (mühürlü koşu olayları zaten içerik taşımaz; bilgi yazımı olay yayınlamaz; mühürlü bilginin durumunu
değiştiren GET dışı istek 423 ile çalıştırılmaz).
"""

from __future__ import annotations

import json
import threading
import uuid
from typing import Any, Awaitable, Callable, Iterable

MARK = "[mühürlü]"
PREFIX = 24
ERR_LOCKED = "Ayrık değerlendirme sürüyor; bu içerik koşu bitince kullanılabilir"
ERR_LOCKED_NODE = "Ayrık değerlendirme sürüyor; bu kayıt koşu bitince değiştirilebilir"
LOCKED_CODE = "sealed"  # arayüz 423 yanıtını bu kodla tanır ve kendi TR/EN iletisini gösterir

_lock = threading.Lock()
_seals: dict[str, dict[str, Any]] = {}


def seal(namespaces: Iterable[str], texts: Iterable[str]) -> str:
    token = uuid.uuid4().hex
    with _lock:
        _seals[token] = {"ns": {str(n) for n in namespaces if n}, "ids": set(),
                         "texts": [str(t) for t in texts if str(t or "").strip()]}
    return token


def add_ids(token: str, ids: Iterable[str]) -> None:
    with _lock:
        if token in _seals:
            _seals[token]["ids"].update(str(i) for i in ids if i)


def unseal(token: str) -> None:
    with _lock:
        _seals.pop(token, None)


def active() -> bool:
    return bool(_seals)


def _snapshot() -> tuple[set[str], set[str], list[str]]:
    with _lock:
        ns: set[str] = set()
        ids: set[str] = set()
        texts: list[str] = []
        for s in _seals.values():
            ns |= s["ns"]
            ids |= s["ids"]
            texts += s["texts"]
    return ns, ids, texts


SHARE = 0.6  # baştan eşleşen kısım mühürlü metnin en az bu oranı olmalı (ya da kopya orada kesilmeli)


def _keys(texts: list[str]) -> list[tuple[str, str, str]]:
    """Mühürlü metin başına (baş `PREFIX`, tam metin, son `PREFIX`). baş öneki paylaşıp sonra AYRILAN bir
    kullanıcı metni karartılmaz. Karartma için (a) baştan itibaren mühürlü metnin en az `SHARE` oranı (ya da tamamı)
    aynen geçmeli, (b) baştan eşleşen kopya orada kesilmiş olmalı (metin sonu ya da üç nokta: kırpılmış özet) ya da
    (c) son `PREFIX` karakter geçmeli (baştan kırpılmış kopya). Mühürlü içerik hiçbir kopyada sızmaz; serbest kalan
    yalnız mühürlü metinle ORTAK başlangıçtır (kullanıcının kendi yazdığı)."""
    out = []
    for t in texts:
        t = " ".join(t.split())
        if t:
            out.append((t[:PREFIX], t, t[-PREFIX:]))
    return out


def _hit(flat: str, keys: list[tuple[str, str, str]]) -> bool:
    for head, full, tail in keys:
        if tail in flat:
            return True
        i = flat.find(head)
        while i >= 0:
            n = len(head)
            while n < len(full) and i + n < len(flat) and flat[i + n] == full[n]:
                n += 1
            rest = flat[i + n:].lstrip()
            if n >= len(full) * SHARE or not rest or rest.startswith(("…", "...")):
                return True
            i = flat.find(head, i + 1)
    return False


def _sealed_dict(d: dict[str, Any], ns: set[str], ids: set[str]) -> bool:
    if any(isinstance(d.get(k), str) and d.get(k) in ids for k in ("id", "src", "dst", "node_id")):
        return True
    cands = [d.get("namespace"), d.get("project")]
    if isinstance(d.get("props"), dict):
        cands.append(d["props"].get("namespace"))
    return any(isinstance(c, str) and c in ns for c in cands)


def filter_obj(obj: Any, ns: set[str], ids: set[str], keys: list[tuple[str, str, str]]) -> Any:
    if isinstance(obj, str):
        flat = " ".join(obj.split())
        return MARK if _hit(flat, keys) else obj
    if isinstance(obj, list):
        return [filter_obj(x, ns, ids, keys) for x in obj
                if not (isinstance(x, dict) and _sealed_dict(x, ns, ids))]
    if isinstance(obj, dict):
        return {k: filter_obj(v, ns, ids, keys) for k, v in obj.items()}
    return obj


def filter_payload(obj: Any) -> Any:
    ns, ids, texts = _snapshot()
    if isinstance(obj, dict) and _sealed_dict(obj, ns, ids):
        return {"id": obj.get("id"), "sealed": True}
    return filter_obj(obj, ns, ids, _keys(texts))


def filter_text(text: str) -> str:
    _ns, _ids, texts = _snapshot()
    keys = _keys(texts)
    if not keys:
        return text
    out = []
    for line in text.splitlines(keepends=True):
        flat = " ".join(line.split())
        out.append(MARK + ("\n" if line.endswith("\n") else "") if _hit(flat, keys) else line)
    return "".join(out)


Scope = dict[str, Any]
Receive = Callable[[], Awaitable[dict[str, Any]]]
Send = Callable[[dict[str, Any]], Awaitable[None]]


class SealedReadMiddleware:
    """`/api/*` yanıtlarını mühür sürerken süzer (bkz. modül belgesi). Mühür yoksa doğrudan geçer. GET dışındaki
    yöntemler de (POST dışa aktarım, bilgi durum değişikliği …) aynı süzgeçten geçer; yolu mühürlü bir kimlik ya da ad
    alanı taşıyan GET dışı istek hiç çalıştırılmadan 423 alır (mühürlü kayıt değiştirilmez, olay yayınlanmaz)."""

    def __init__(self, app: Callable[..., Awaitable[None]]):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http" or not str(scope.get("path") or "").startswith("/api") or not active():
            await self.app(scope, receive, send)
            return
        if scope.get("method") not in ("GET", "HEAD", "OPTIONS") and _targets_sealed(str(scope.get("path") or "")):
            body = _locked_body(ERR_LOCKED_NODE)
            await send({"type": "http.response.start", "status": 423,
                        "headers": [(b"content-type", b"application/json"),
                                    (b"content-length", str(len(body)).encode("ascii"))]})
            await send({"type": "http.response.body", "body": body})
            return
        start: dict[str, Any] | None = None
        chunks: list[bytes] = []
        passthrough = False

        async def wrapped(msg: dict[str, Any]) -> None:
            nonlocal start, passthrough
            if msg["type"] == "http.response.start":
                ctype = _ctype(msg)
                if "text/event-stream" in ctype:
                    passthrough = True
                    await send(msg)
                    return
                start = msg
                return
            if passthrough or msg["type"] != "http.response.body":
                await send(msg)
                return
            chunks.append(msg.get("body", b"") or b"")
            if msg.get("more_body"):
                return
            status, headers, body = _filtered(start or {"status": 200, "headers": []}, b"".join(chunks))
            await send({"type": "http.response.start", "status": status, "headers": headers})
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, wrapped)


def _targets_sealed(path: str) -> bool:
    ns, ids, _texts = _snapshot()
    parts = [p for p in path.split("/") if p]
    keys = ids | ns | {n.split(":", 1)[-1] for n in ns}
    return any(p in keys for p in parts)


def _locked_body(detail: str) -> bytes:
    return json.dumps({"detail": detail, "code": LOCKED_CODE}, ensure_ascii=False).encode("utf-8")


def _ctype(msg: dict[str, Any]) -> str:
    for k, v in msg.get("headers") or []:
        if bytes(k).lower() == b"content-type":
            return bytes(v).decode("latin-1").lower()
    return ""


def _filtered(start: dict[str, Any], body: bytes) -> tuple[int, list[tuple[bytes, bytes]], bytes]:
    status = int(start.get("status") or 200)
    ctype = _ctype(start)
    headers = [(bytes(k), bytes(v)) for k, v in start.get("headers") or []
               if bytes(k).lower() not in (b"content-length", b"content-disposition")]
    if not body:
        return status, headers, body
    if "json" in ctype:
        try:
            new = json.dumps(filter_payload(json.loads(body.decode("utf-8"))), ensure_ascii=False).encode("utf-8")
        except (ValueError, UnicodeDecodeError):
            new = MARK.encode("utf-8")
    elif ctype.startswith("text/"):
        new = filter_text(body.decode("utf-8", "replace")).encode("utf-8")
    else:
        status = 423
        headers = [(k, v) for k, v in headers if k.lower() != b"content-type"]
        headers.append((b"content-type", b"application/json"))
        new = _locked_body(ERR_LOCKED)
    if "json" in ctype or ctype.startswith("text/"):
        headers = headers + [(b"content-disposition", v) for k, v in start.get("headers") or []
                             if bytes(k).lower() == b"content-disposition"]
    headers.append((b"content-length", str(len(new)).encode("ascii")))
    return status, headers, new


__all__ = ["seal", "add_ids", "unseal", "active", "filter_payload", "filter_text", "SealedReadMiddleware", "MARK"]
