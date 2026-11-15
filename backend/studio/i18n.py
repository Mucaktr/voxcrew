"""Sunucu tarafı çok dillilik (Ekip S16) — ve §2 S16.

Sözleşme:
- `request_lang` → "tr" | "en": istek başına (X-Studio-Lang → Accept-Language → ayar ui.language → "tr").
- `I18nMiddleware`: saf ASGI; isteğin dilini bir contextvar'a koyar ve dil "en" ise JSON hata yanıtlarındaki
  (durum ≥ 400, küçük gövde) `detail` / `error` / `message` metinlerini `studio/locales/en.py` kataloğuyla çevirir.
  Akış gövdeleri ve başarılı yanıtlar dokunulmadan geçer; katalogda olmayan ileti Türkçe kalır. main.py'de zaten
  bağlıdır; ek bir exception handler kaydı GEREKMEZ.
- `agent_lang(settings)` → ajan istemlerinin dili (ayar agents.language: ui | tr | en; "ui" → ui.language, o da
  "auto" ise isteğin dili). Motor koşuyu başlatan isteğin bağlamını (contextvar kopyası) taşır.
- `LanguageStage` (order 10): `prepare` ctx.lang'ı belirler; `finalize` dil "en" ise bölüm başlıklarını ve bilinen
  sistem kuralı satırlarını İngilizceye çevirir. Kayıt: `register_stages` (main.py açılışında çağrılmalı).
- `translate(text, lang)`: tek bir iletiyi çevirir (katalog: tam eşleşme, sonra `{}` şablon eşleşmesi).
"""

from __future__ import annotations

import contextvars
import json
import re
from functools import lru_cache
from typing import Any, Mapping

SUPPORTED = ("tr", "en")
DEFAULT_LANG = "tr"
# Çevrilecek en büyük hata gövdesi (bayt); daha büyük gövdeler olduğu gibi geçer (akışı tıkamamak için).
MAX_TRANSLATE_BODY = 64 * 1024
_TRANSLATED_KEYS = ("detail", "error", "message")

_LANG: contextvars.ContextVar[str] = contextvars.ContextVar("studio_lang", default=DEFAULT_LANG)


# ---------------------------------------------------------------- dil çözümü
def request_lang() -> str:
    return _LANG.get()


def set_request_lang(lang: str) -> contextvars.Token[str]:
    """İstek dilini elle ayarlar (testler ve istek dışı bağlamlar için); dönen token ile `reset_request_lang`."""
    return _LANG.set(lang if lang in SUPPORTED else DEFAULT_LANG)


def reset_request_lang(token: contextvars.Token[str]) -> None:
    _LANG.reset(token)


def normalize_lang(value: str | None) -> str | None:
    """"en-US" → "en", "tr-TR" → "tr"; boş, "auto" ve "*" → None (karar yok); başka dil → "en" (ARCH: tr dışı → EN)."""
    val = (value or "").strip().lower()
    if not val or val in ("auto", "*"):
        return None
    tag = re.split(r"[-_;,]", val, maxsplit=1)[0]
    return "tr" if tag == "tr" else "en"


def accept_language(header: str | None) -> str | None:
    """Accept-Language'daki en yüksek q'lu dil ("*" sayılmaz): tr → "tr", diğerleri → "en"; yoksa None."""
    if not header:
        return None
    ranked: list[tuple[float, int, str]] = []
    for i, part in enumerate(header.split(",")):
        tag, _, params = part.strip().partition(";")
        tag = tag.strip().lower()
        if not tag or tag == "*":
            continue
        q = 1.0
        for p in params.split(";"):
            k, _, v = p.strip().partition("=")
            if k.strip() == "q":
                try:
                    q = float(v)
                except ValueError:
                    q = 0.0
        if q > 0:
            ranked.append((-q, i, tag))
    if not ranked:
        return None
    ranked.sort()
    return normalize_lang(ranked[0][2])


def resolve_lang(headers: Mapping[str, str], settings: Any = None) -> str:
    """İstek dili: X-Studio-Lang → Accept-Language → ayar ui.language → varsayılan."""
    explicit = normalize_lang(headers.get("x-studio-lang"))
    if explicit:
        return explicit
    browser = accept_language(headers.get("accept-language"))
    if browser:
        return browser
    ui = _setting(settings, "ui.language", "auto")
    return ui if ui in SUPPORTED else DEFAULT_LANG


def _setting(settings: Any, key: str, default: str) -> str:
    if settings is None:
        return default
    try:
        return str(settings.get(key, default) or default)
    except Exception:  # noqa: BLE001 — ayar nesnesi beklenmedikse varsayılan
        return default


def agent_lang(settings: Any) -> str:
    pref = _setting(settings, "agents.language", "ui")
    if pref in SUPPORTED:
        return pref
    ui = _setting(settings, "ui.language", "auto")
    return ui if ui in SUPPORTED else request_lang()


# ---------------------------------------------------------------- ileti çevirisi
_PLACEHOLDER = re.compile(r"\{(\d*)\}")


class _Catalog:
    """TR → hedef dil kataloğu: tam eşleşme sözlüğü + `{}` şablonlarından türetilmiş düzenli ifadeler."""

    def __init__(self, messages: Mapping[str, str]):
        self.exact: dict[str, str] = {}
        self.patterns: list[tuple[re.Pattern[str], str]] = []
        templated: list[tuple[int, str, str]] = []
        for tr, en in messages.items():
            if _PLACEHOLDER.search(tr):
                literal = len(_PLACEHOLDER.sub("", tr))
                templated.append((literal, tr, en))
            else:
                self.exact[tr] = en
        # Daha uzun sabit metin → daha özgül şablon → önce denenir
        templated.sort(key=lambda t: (-t[0], t[1]))
        for _n, tr, en in templated:
            self.patterns.append((self._compile(tr), en))

    @staticmethod
    def _compile(template: str) -> re.Pattern[str]:
        parts = _PLACEHOLDER.split(template)  # sabit, indeks, sabit, indeks, … , sabit
        out: list[str] = []
        holes = len(parts) // 2
        for i, part in enumerate(parts):
            if i % 2 == 0:
                out.append(re.escape(part))
            else:
                out.append("(.+)" if (i // 2) == holes - 1 else "(.+?)")
        return re.compile("".join(out), re.S)

    def translate(self, text: str) -> str:
        hit = self.exact.get(text)
        if hit is not None:
            return hit
        for pattern, en in self.patterns:
            m = pattern.fullmatch(text)
            if m:
                try:
                    return en.format(*m.groups())
                except (IndexError, KeyError, ValueError):
                    return text
        return text


@lru_cache(maxsize=None)
def _catalog(lang: str) -> _Catalog | None:
    if lang == "en":
        from studio.locales import en
        return _Catalog(en.MESSAGES)
    return None


def translate(text: str, lang: str | None = None) -> str:
    """Tek bir kullanıcı iletisini çevirir; karşılığı yoksa metin olduğu gibi döner."""
    lang = lang or request_lang()
    if not isinstance(text, str) or not text or lang == DEFAULT_LANG:
        return text
    cat = _catalog(lang)
    if cat is None:
        return text
    out = cat.translate(text)
    if out != text:
        return out
    stripped = text.strip()
    if stripped != text:
        inner = cat.translate(stripped)
        if inner != stripped:
            return inner
    # KeyError metinleri tırnak içinde gelebilir ("'Ajan yok: x'")
    if len(stripped) > 2 and stripped[0] == stripped[-1] and stripped[0] in "'\"":
        inner = cat.translate(stripped[1:-1])
        if inner != stripped[1:-1]:
            return f"{stripped[0]}{inner}{stripped[0]}"
    return text


def translate_detail(value: Any, lang: str | None = None) -> Any:
    """`detail` / `error` / `message` değerini çevirir: dizgi, {message, errors[]} sözlüğü ya da dizgi listesi."""
    if isinstance(value, str):
        return translate(value, lang)
    if isinstance(value, dict):
        out = dict(value)
        for key in _TRANSLATED_KEYS:
            if isinstance(out.get(key), str):
                out[key] = translate(out[key], lang)
        errors = out.get("errors")
        if isinstance(errors, list):
            out["errors"] = [translate(e, lang) if isinstance(e, str) else e for e in errors]
        return out
    if isinstance(value, list):
        return [translate_detail(v, lang) if isinstance(v, (str, dict)) else v for v in value]
    return value


def translate_error_body(raw: bytes, lang: str) -> bytes:
    """JSON hata gövdesindeki üst düzey detail/error/message alanlarını çevirir; değişmezse aynı nesne döner."""
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return raw
    if not isinstance(data, dict):
        return raw
    changed = False
    for key in _TRANSLATED_KEYS:
        if key in data:
            new = translate_detail(data[key], lang)
            if new != data[key]:
                data[key], changed = new, True
    if not changed:
        return raw
    return json.dumps(data, ensure_ascii=False).encode("utf-8")


# ---------------------------------------------------------------- ASGI ara katmanı
class I18nMiddleware:
    """İsteğin dilini contextvar'a koyar; dil Türkçe değilse JSON hata yanıtlarının iletilerini çevirir."""

    def __init__(self, app: Any, settings: Any = None) -> None:
        self.app = app
        self.settings = settings  # None → scope["app"].state.studio.settings (varsa)

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}
        lang = resolve_lang(headers, self.settings if self.settings is not None else _settings_from_scope(scope))
        token = _LANG.set(lang)
        try:
            if lang == DEFAULT_LANG:
                await self.app(scope, receive, send)
            else:
                await self.app(scope, receive, _translating_send(send, lang))
        finally:
            _LANG.reset(token)


def _settings_from_scope(scope: Any) -> Any:
    try:
        return scope["app"].state.studio.settings
    except (KeyError, AttributeError, TypeError):
        return None


def _translating_send(send: Any, lang: str) -> Any:
    """Durumu ≥ 400 ve içeriği JSON olan küçük yanıtları tamponlayıp çevirir; diğer her şeyi olduğu gibi iletir."""
    held: dict[str, Any] = {"start": None, "chunks": [], "size": 0}

    async def flush(last: dict[str, Any] | None) -> None:
        start = held["start"]
        held["start"] = None
        chunks, held["chunks"], held["size"] = held["chunks"], [], 0
        await send(start)
        body = b"".join(chunks)
        more = bool(last.get("more_body", False)) if last is not None else False
        await send({"type": "http.response.body", "body": body, "more_body": more})

    async def wrapped(message: dict[str, Any]) -> None:
        kind = message.get("type")
        if kind == "http.response.start":
            ctype = b""
            for k, v in message.get("headers") or []:
                if k.lower() == b"content-type":
                    ctype = v.lower()
                    break
            if int(message.get("status", 200)) >= 400 and ctype.startswith(b"application/json"):
                held["start"] = message
                return
            await send(message)
            return
        if kind == "http.response.body" and held["start"] is not None:
            body = message.get("body", b"") or b""
            held["chunks"].append(body)
            held["size"] += len(body)
            if held["size"] > MAX_TRANSLATE_BODY:
                await flush(message)  # çok büyük: dokunmadan ilet
                return
            if message.get("more_body", False):
                return
            start = held["start"]
            raw = b"".join(held["chunks"])
            held["start"], held["chunks"], held["size"] = None, [], 0
            new = translate_error_body(raw, lang)
            if new is not raw:
                headers = [(k, v) for k, v in start.get("headers") or [] if k.lower() != b"content-length"]
                headers.append((b"content-length", str(len(new)).encode("latin-1")))
                start = {**start, "headers": headers}
            await send(start)
            await send({"type": "http.response.body", "body": new})
            return
        await send(message)

    return wrapped


# ---------------------------------------------------------------- istem hattı: dil aşaması (order 10)
def section_title(key: str, lang: str | None = None) -> str:
    """Bilinen TR bölüm başlığının verilen dildeki karşılığı (bilinmeyen başlık olduğu gibi döner)."""
    if (lang or request_lang()) != "en":
        return key
    from studio.locales import en
    return en.SECTION_TITLES.get(key, key)


@lru_cache(maxsize=None)
def _system_line_catalog() -> _Catalog:
    from studio.locales import en
    return _Catalog(en.SYSTEM_LINES)


def translate_system_line(line: str, lang: str | None = None) -> str:
    if (lang or request_lang()) != "en" or not line:
        return line
    return _system_line_catalog().translate(line)


class LanguageStage:
    """İstem hattının dil aşaması: ctx.lang'ı belirler; EN'de bölüm başlıklarını ve sistem kurallarını çevirir.

    Motor EN dilinde istemleri zaten EN kurar; bu aşama başlıkları/kuralları TR kurulmuş bağlamlar için de
    doğru dile çeker (idempotent) ve raporuna dili yazar. TR'de hiçbir şeyi değiştirmez (istem birebir aynı)."""

    name = "language"
    order = 10

    def prepare(self, ctx: Any) -> None:
        ctx.lang = agent_lang(ctx.settings)

    def finalize(self, ctx: Any) -> None:
        if ctx.lang != "en":
            return
        titles = 0
        for section in ctx.sections:
            if section.title:
                new = section_title(section.title, "en")
                if new != section.title:
                    section.title, titles = new, titles + 1
        lines = 0
        for i, line in enumerate(ctx.system_lines):
            new = translate_system_line(line, "en")
            if new != line:
                ctx.system_lines[i], lines = new, lines + 1
        ctx.note(self.name, lang="en", titles=titles, lines=lines)


def register_stages() -> None:
    """Dil aşamasını istem hattına kaydeder (main.py açılışında çağrılır; yeniden çağrılması zararsızdır)."""
    from studio.workflow import prompting
    prompting.register(LanguageStage())
