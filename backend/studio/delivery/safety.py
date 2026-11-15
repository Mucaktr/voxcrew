"""Teslim güvenliği (CG-DELIVER): klasör yolu doğrulama, sır + kişisel veri maskeleme, komut argümanı temizliği.

- Klasör: yalnızca var olan, mutlak bir klasör; `..` bileşeni yok; `~/.hermes`, `~/.claude`, `~/.codex`, ayardaki Hermes
  kökü, stüdyo veri dizini ve ajanların çalışma klasörü (ve bunların altı) yasak. Dosya adı tek bileşendir.
- Metin: `studio.changes.redact_text` (anahtar, jeton, `api_key=` atamaları) her zaman; ayar açıkken e-posta, telefon,
  T.C. kimlik no, IBAN ve kart numarası da maskelenir.
- Argüman: içerik asla komut satırına girmez (gövde stdin'den). Başlık/dal gibi kısa değerler `--ad=değer` biçiminde tek
  argüman olur; Windows `.cmd/.bat` sarmalayıcısı cmd.exe'den geçtiği için metakarakterler ayrıca atılır.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Iterable

from studio.changes import redact_text

# ---------------------------------------------------------------- maskeleme
_PII: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b"), "[IBAN]"),
    (re.compile(r"(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])"), "[kart no]"),
    (re.compile(r"(?<!\d)[1-9]\d{10}(?!\d)"), "[kimlik no]"),
    (re.compile(r"(?<![\w+])(?:\+\d{1,3}[ -]?)?(?:\(?0?\d{3}\)?[ -]?)\d{3}[ -]?\d{2}[ -]?\d{2}(?!\d)"), "[telefon]"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[e-posta]"),
]


def redact(text: str | None, *, pii: bool = False) -> str:
    """Dışarı giden her metin: sırlar her zaman, kişisel veri ayar açıkken maskelenir."""
    out = redact_text(str(text or ""))
    if pii:
        for rx, repl in _PII:
            out = rx.sub(repl, out)
    return out


# ---------------------------------------------------------------- klasör doğrulama
class PathRejected(PermissionError):
    pass


def _norm(p: Path) -> str:
    return os.path.normcase(str(p))


def _inside(child: Path, parent: Path) -> bool:
    c, p = _norm(child), _norm(parent).rstrip("\\/")
    return c == p or c.startswith(p + os.sep)


def forbidden_roots(studio: Any) -> list[Path]:
    """Teslimin asla yazamayacağı kökler (çözülmüş)."""
    home = Path.home()
    roots: list[Path] = [home / ".hermes", home / ".claude", home / ".codex"]
    for env in ("CODEX_HOME", "CLAUDE_CONFIG_DIR", "HERMES_HOME"):
        if (os.environ.get(env) or "").strip():
            roots.append(Path(os.environ[env]).expanduser())
    settings = getattr(studio, "settings", None)
    if settings is not None:
        for key in ("hermes_home", "workdir"):
            try:
                v = settings.get(key)
            except Exception:  # noqa: BLE001
                v = None
            if v:
                roots.append(Path(str(v)).expanduser())
    changes = getattr(studio, "changes", None)
    if changes is not None and getattr(changes, "data_dir", None):
        roots.append(Path(changes.data_dir))
    try:
        from studio.config import DATA_DIR
        roots.append(Path(DATA_DIR))
    except Exception:  # noqa: BLE001
        pass
    out: list[Path] = []
    for r in roots:
        try:
            out.append(r.resolve())
        except OSError:
            out.append(r)
    return out


def validate_folder(raw: Any, studio: Any) -> Path:
    """Kullanıcının seçtiği klasör → çözülmüş yol. Uygun değilse PathRejected (kullanıcıya dönen ileti)."""
    s = str(raw or "").strip()
    if not s:
        raise PathRejected("Hedef klasörü seç")
    if "\x00" in s or len(s) > 1024:
        raise PathRejected("Klasör yolu geçersiz")
    parts = re.split(r"[\\/]+", s)
    if any(p == ".." for p in parts):
        raise PathRejected("Klasör yolunda '..' kullanılamaz")
    p = Path(s).expanduser()
    if not p.is_absolute():
        raise PathRejected("Klasör yolu tam (mutlak) olmalı; ör. ~/Belgeler/Raporlar")
    try:
        resolved = p.resolve(strict=True)
    except (OSError, RuntimeError):
        raise PathRejected("Klasör bulunamadı") from None
    if not resolved.is_dir():
        raise PathRejected("Bu yol bir klasör değil")
    for root in forbidden_roots(studio):
        if _inside(resolved, root):
            raise PathRejected("Bu klasöre teslim edilemez (ajan/araç ayar klasörü ya da uygulama veri dizini)")
    return resolved


_BAD_NAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def validate_filename(name: Any) -> str:
    n = str(name or "").strip()
    if not n or len(n) > 120 or n in (".", "..") or n.startswith(".") or _BAD_NAME.search(n):
        raise PathRejected("Dosya adı geçersiz (tek ad; / \\ : * ? \" < > | ve baştaki nokta olmaz)")
    if n.split(".")[0].lower() in _RESERVED:
        raise PathRejected("Bu dosya adı işletim sistemince ayrılmış")
    return n


def target_file(folder: Path, filename: str) -> Path:
    """Klasör + ad → hedef; sembolik bağlantı ya da klasör dışına çıkan hedef reddedilir."""
    path = folder / validate_filename(filename)
    if path.is_symlink():
        raise PathRejected("Hedef bir sembolik bağlantı; teslim edilmez")
    if _norm(path.parent.resolve()) != _norm(folder):
        raise PathRejected("Hedef klasör dışına çıkıyor")
    if path.exists() and not path.is_file():
        raise PathRejected("Hedefte aynı adlı bir klasör var")
    return path


def validate_repo_path(rel: Any, repo: Path) -> tuple[str, Path]:
    """Depo içi göreli dosya yolu (ör.) → (posix göreli, mutlak)."""
    s = str(rel or "").strip().replace("\\", "/").strip("/")
    if not s or len(s) > 300 or "\x00" in s:
        raise PathRejected("Depodaki dosya yolu geçersiz")
    parts = s.split("/")
    if any(p in ("", ".", "..") or p.startswith(".git") or _BAD_NAME.search(p) for p in parts):
        raise PathRejected("Depodaki dosya yolunda '..', '.git' ya da geçersiz karakter olamaz")
    path = repo.joinpath(*parts)
    if not _inside(path.parent.resolve() if path.parent.exists() else path.parent, repo):
        raise PathRejected("Dosya deponun dışına çıkıyor")
    if path.is_symlink():
        raise PathRejected("Hedef bir sembolik bağlantı; teslim edilmez")
    return "/".join(parts), path


# ---------------------------------------------------------------- komut argümanları
_BRANCH = re.compile(r"^(?!-)(?!.*\.\.)(?!.*//)(?!.*@\{)[A-Za-z0-9._/-]{1,100}(?<![./])$")
_CMD_META = re.compile(r'[\r\n"%!^&|<>`]')


def validate_branch(name: Any) -> str:
    s = str(name or "").strip()
    if not _BRANCH.match(s) or s.endswith(".lock"):
        raise PathRejected("Dal adı geçersiz (harf, rakam, . _ / -; '..' yok; '-' ile başlamaz)")
    return s


def one_line(value: Any, limit: int = 200) -> str:
    """Komut satırına girecek kısa değer: tek satır, kontrol karakteri yok."""
    s = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value or "")).strip()
    return s[:limit]


def shim_safe(argv: Iterable[str], exe: str) -> list[str]:
    """Windows `.cmd/.bat` sarmalayıcısı cmd.exe'den geçer: metakarakterler atılır (gerçek `gh.exe`te gerekmez)."""
    args = list(argv)
    if os.name == "nt" and exe.lower().endswith((".cmd", ".bat")):
        return [args[0], *[_CMD_META.sub(" ", a) for a in args[1:]]]
    return args
