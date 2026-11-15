"""Skill anlık görüntüleri (G1-D, AUDIT §3.2 kural 1 ve 5): değişmez sürüm kopyası + sha256.

- **sha256** = normalize edilmiş `SKILL.md` + `references/**` metin dosyalarının (göreli yola göre sıralı) özeti.
  Normalizasyon: UTF-8 (BOM atılır, bozuk bayt `�`), CRLF → LF. Frontmatter `version` yalnız gösterimdir.
- **Değişmez kopya:** `<veri>/skills/.versions/<anahtar-adı>/versions/<sha>/` altına `SKILL.md`, `references/…` ve
  `meta.json` (ad, açıklama, etiketler — anlık görüntü anındaki katalog bilgisi; sha'ya girmez). Klasör geçici bir
  dizine yazılıp tek `os.replace` ile yerine konur; var olan sürüm asla üzerine yazılmaz. `.` ile başlayan kök dizin
  VoxCrew kütüphane taramasında görünmez.
- **Kaynak salt okunur:** `~/.claude/skills`, Hermes profilleri ve VoxCrew klasörü yalnızca okunur; bu modül
  kaynağa hiçbir koşulda yazmaz (yalnız veri dizinindeki `.versions` altına yazar).
- **Doğrulama:** `verify()` diskteki kopyanın özetini yeniden hesaplar; sha tutmazsa (elle değişmiş, bozulmuş ya da
  eksik) sonuç `mismatch` / `missing` olur ve istem aşaması skill'i yüklemez.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

SHA_RE = re.compile(r"^[0-9a-f]{64}$")
REF_DIR = "references"
MAX_REF_FILES = 100
MAX_REF_BYTES = 1024 * 1024        # dosya başına; daha büyük referans özete girmez (ve kopyalanmaz)
MAX_TOTAL_BYTES = 6 * 1024 * 1024


class SnapshotError(ValueError):
    """Anlık görüntü alınamadı ya da doğrulanamadı."""


def normalize(text: str) -> str:
    text = text or ""
    return (text[1:] if text.startswith("﻿") else text).replace("\r\n", "\n").replace("\r", "\n")  # tek CR de LF


def _read(path: Path) -> str | None:
    try:
        return normalize(path.read_bytes().decode("utf-8", "replace"))
    except OSError:
        return None


def collect(skill_dir: Path, skill_md: Path | None = None) -> dict[str, str]:
    """Kaynak klasörden özetlenecek metinleri okur (YALNIZ OKUR): {"SKILL.md": …, "references/x.md": …}.

    Sembolik bağlar, gizli dosyalar ve sınırı aşan referanslar atlanır. SKILL.md okunamazsa SnapshotError."""
    skill_dir = Path(skill_dir)
    md = Path(skill_md) if skill_md else skill_dir / "SKILL.md"
    text = _read(md)
    if text is None:
        raise SnapshotError("SKILL.md okunamadı")
    files: dict[str, str] = {"SKILL.md": text}
    refs = skill_dir / REF_DIR
    if refs.is_dir() and not refs.is_symlink():
        total = len(text.encode("utf-8"))
        for dirpath, dirnames, filenames in os.walk(refs, followlinks=False):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
            for f in sorted(filenames):
                p = Path(dirpath) / f
                if f.startswith(".") or p.is_symlink():
                    continue
                try:
                    size = p.stat().st_size
                except OSError:
                    continue
                if size > MAX_REF_BYTES or total + size > MAX_TOTAL_BYTES or len(files) > MAX_REF_FILES:
                    continue
                body = _read(p)
                if body is None:
                    continue
                files[p.relative_to(skill_dir).as_posix()] = body
                total += size
    return files


def digest(files: dict[str, str]) -> str:
    h = hashlib.sha256()
    for rel in sorted(files):
        h.update(rel.encode("utf-8") + b"\0" + normalize(files[rel]).encode("utf-8") + b"\0")
    return h.hexdigest()


def safe_name(key: str) -> str:
    """Atama anahtarından (`claude:docx`, `pdf`, `vox-a`) güvenli, çakışmasız klasör adı."""
    base = re.sub(r"[^A-Za-z0-9_-]+", "_", str(key or "")).strip("_")[:48] or "skill"
    return f"{base}-{hashlib.sha256(str(key).encode('utf-8')).hexdigest()[:10]}"


def _safe_rel(rel: str) -> bool:
    parts = rel.split("/")
    return bool(parts) and all(p not in ("", ".", "..") for p in parts) and ":" not in rel and "\\" not in rel


class SnapshotStore:
    def __init__(self, skills_root: Path):
        self.root = Path(skills_root) / ".versions"

    def skill_dir(self, key: str) -> Path:
        return self.root / safe_name(key)

    def version_dir(self, key: str, sha: str) -> Path:
        if not SHA_RE.match(str(sha or "")):
            raise SnapshotError("Geçersiz sürüm özeti")
        return self.skill_dir(key) / "versions" / sha

    # ------------------------------------------------------------------ yazma (yalnız veri dizini)
    def write(self, key: str, files: dict[str, str], meta: dict[str, Any]) -> str:
        """Değişmez sürüm kopyası oluşturur ve sha'yı döndürür. Aynı sha zaten varsa ve sağlamsa dokunmaz."""
        if "SKILL.md" not in files or any(not _safe_rel(r) for r in files):
            raise SnapshotError("Geçersiz anlık görüntü içeriği")
        sha = digest(files)
        target = self.version_dir(key, sha)
        if target.is_dir():
            if self.verify(key, sha) == "ok":
                return sha
            raise SnapshotError("Bu sürümün kayıtlı kopyası bozulmuş; elle incele (üzerine yazılmaz)")
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.parent / f".tmp-{uuid.uuid4().hex[:10]}"
        try:
            for rel, text in files.items():
                p = tmp / Path(*rel.split("/"))
                p.parent.mkdir(parents=True, exist_ok=True)
                with open(p, "w", encoding="utf-8", newline="") as fh:
                    fh.write(normalize(text))
            info = {"key": key, "sha": sha, "created_at": time.time(),
                    **{k: meta.get(k) for k in ("id", "source", "name", "description", "tags", "version") if k in meta}}
            (tmp / "meta.json").write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n", "utf-8")
            os.replace(tmp, target)
        except OSError as exc:
            shutil.rmtree(tmp, ignore_errors=True)
            if target.is_dir() and self.verify(key, sha) == "ok":  # eşzamanlı yazım kazandı
                return sha
            raise SnapshotError(f"Anlık görüntü yazılamadı: {exc.strerror or exc}") from None
        return sha

    # ------------------------------------------------------------------ okuma
    def read(self, key: str, sha: str) -> dict[str, str] | None:
        try:
            d = self.version_dir(key, sha)
        except SnapshotError:
            return None
        if not d.is_dir():
            return None
        out: dict[str, str] = {}
        for dirpath, dirnames, filenames in os.walk(d, followlinks=False):
            dirnames[:] = sorted(dirnames)
            for f in sorted(filenames):
                p = Path(dirpath) / f
                rel = p.relative_to(d).as_posix()
                if rel == "meta.json" or p.is_symlink():
                    continue
                text = _read(p)
                if text is None:
                    return None
                out[rel] = text
        return out if "SKILL.md" in out else None

    def meta(self, key: str, sha: str) -> dict[str, Any]:
        try:
            raw = (self.version_dir(key, sha) / "meta.json").read_text("utf-8")
            data = json.loads(raw)
        except (OSError, ValueError, SnapshotError):
            return {}
        return data if isinstance(data, dict) else {}

    def verify(self, key: str, sha: str) -> str:
        """`ok` · `missing` (kopya yok) · `mismatch` (diskteki içerik sabitlenen sha ile uyuşmuyor)."""
        files = self.read(key, sha)
        if files is None:
            return "missing"
        return "ok" if digest(files) == sha else "mismatch"

    def load(self, key: str, sha: str) -> dict[str, Any] | None:
        """Doğrulanmış içerik: {files, meta}; doğrulama başarısızsa None (çağıran skill'i yüklemez)."""
        files = self.read(key, sha)
        if files is None or digest(files) != sha:
            return None
        return {"files": files, "meta": self.meta(key, sha)}
