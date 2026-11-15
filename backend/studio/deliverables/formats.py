"""Biçim kayıt defteri (-P0): uzantı → tür, MIME ve "metin olarak okunur mu".

Tek tablo: yeni biçim = bir satır. `service.py` türü, `content`/`excerpt` kararını ve indirme politikasını buradan alır.
İkili biçimler (docx/xlsx/pptx/zip/mp4…) asla UTF-8 metne çevrilmez: görüntüleyici "önizlenemiyor" der, orijinal yalnızca
arayüzden (`ui_present_strict`) maskelenmemiş olarak indirilir.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

# uzantı → tür (metin ve ikili). Eski sözleşme korunur (.pdf "report", .csv "data"); yeni ikili aileler eklendi.
_KIND_TABLE: dict[str, tuple[str, ...]] = {
    "report": (".md", ".markdown", ".rst", ".pdf", ".rtf", ".html", ".htm"),
    "document": (".docx", ".odt", ".doc"),
    "presentation": (".pptx", ".ppt", ".odp", ".key"),
    "sheet": (".xlsx", ".xls", ".ods"),
    "text": (".txt", ".log"),
    "code": (".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".scss", ".sh", ".ps1", ".bat", ".sql", ".go",
             ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".rb", ".php", ".swift", ".lua", ".r", ".ipynb",
             ".toml", ".ini"),
    "data": (".json", ".jsonl", ".csv", ".tsv", ".xml", ".yaml", ".yml", ".parquet", ".sqlite", ".db"),
    "image": (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"),
    "media": (".mp3", ".wav", ".ogg", ".m4a", ".flac", ".mp4", ".webm", ".mov", ".mkv", ".avi"),
    "archive": (".zip", ".tar", ".gz", ".tgz", ".7z", ".rar", ".bz2", ".xz"),
}
EXT_KIND: dict[str, str] = {ext: kind for kind, exts in _KIND_TABLE.items() for ext in exts}

# Türü metin ailesinde olsa bile BAYT olarak okunması gereken uzantılar (UTF-8'e çevrilirse çöp metin çıkar).
BINARY_EXT = frozenset({".pdf", ".docx", ".odt", ".doc", ".xlsx", ".xls", ".ods", ".pptx", ".ppt", ".odp", ".key",
                        ".parquet", ".sqlite", ".db", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
                        ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".mp4", ".webm", ".mov", ".mkv", ".avi",
                        ".zip", ".tar", ".gz", ".tgz", ".7z", ".rar", ".bz2", ".xz"})
# Metin ailesi türleri (görüntüleyicide metin, `excerpt` ve maskeli dışa aktarım)
TEXT_KINDS = ("report", "text", "code", "data")
# Tarayıcıda satır içi güvenle gösterilen ham türler (görsel/PDF; sandbox'lı) — eski `RAW_EXT`
RAW_EXT = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf"})
# `GET /raw` ve `GET /download?format=original` jetonsuz da çalışır (`<img src>` jeton taşıyamaz). Bu yüzden
# yalnız GÖRSELLER (SVG sandbox'lı) herkese açık ham verilir; maskelenemeyen PDF baytları bu GET yollarında tam kullanıcı
# varlığı (`ui_present_strict`) ister. PDF arayüzde `POST /view` (önizleme) ve `POST /original` (indirme) ile gelir.
RAW_PUBLIC_EXT = RAW_EXT - {".pdf"}

# Statik uygulama paketine girebilen web varlıkları (index.html + varlıklar)
WEB_EXT = frozenset({".html", ".htm", ".css", ".js", ".mjs", ".json", ".map", ".txt", ".svg", ".png", ".jpg", ".jpeg",
                     ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".mp4", ".webm", ".wav",
                     ".ogg", ".xml", ".csv"})

_MIME_FIX = {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
             ".svg": "image/svg+xml", ".html": "text/html", ".htm": "text/html", ".woff2": "font/woff2",
             ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".webp": "image/webp", ".map": "application/json",
             ".md": "text/markdown", ".csv": "text/csv", ".pptx": "application/vnd.openxmlformats-officedocument."
             "presentationml.presentation", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
             ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
             ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".zip": "application/zip"}


# DEPO-TESLIM: tarayıcının yerel olarak oynattığı / gösterdiği ikili biçimler (`<audio>`, `<video>`, PDF görüntüleyici).
# Yalnız bu liste `POST /api/deliverables/{id}/view` ile (arayüz, kasa kopyası) verilir; MIME istemciden değil bu tablodan gelir.
VIEW_MIME: dict[str, tuple[str, str]] = {
    ".pdf": ("pdf", "application/pdf"),
    ".mp3": ("audio", "audio/mpeg"), ".wav": ("audio", "audio/wav"), ".ogg": ("audio", "audio/ogg"),
    ".m4a": ("audio", "audio/mp4"), ".flac": ("audio", "audio/flac"),
    ".mp4": ("video", "video/mp4"), ".webm": ("video", "video/webm"),
}


def view_kind(name: str) -> str | None:
    """Satır içi görüntülenebilir ikili biçim: pdf | audio | video | None (görsel `raw` yolunu kullanır)."""
    hit = VIEW_MIME.get(suffix(name))
    return hit[0] if hit else None


def view_mime(name: str) -> str | None:
    hit = VIEW_MIME.get(suffix(name))
    return hit[1] if hit else None


def suffix(name: str) -> str:
    return Path(str(name)).suffix.lower()


def kind_for_suffix(ext: str) -> str:
    return EXT_KIND.get(ext.lower(), "other")


def is_binary(name: str) -> bool:
    """Bu dosya bayt olarak ele alınır mı (UTF-8 çözümü yok, `excerpt` yok, görüntüleyicide metin yok)."""
    ext = suffix(name)
    return ext in BINARY_EXT or kind_for_suffix(ext) not in TEXT_KINDS


def is_masked_text(name: str) -> bool:
    """Dışa çıkarken maskelenebilen metin dosyası mı (indirme/içerik `redact_text`'ten geçer)."""
    return not is_binary(name)


def mime_for(name: str) -> str:
    ext = suffix(name)
    return _MIME_FIX.get(ext) or mimetypes.guess_type(f"x{ext}")[0] or "application/octet-stream"
