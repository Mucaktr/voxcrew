"""STALE-DIST — sunulan arayüz derlemesi (frontend/dist) kaynak koddan eski mi?

`npm run build` sonunda Vite eklentisi `dist/build-info.json` yazar (frontend/scripts/build-info.mjs):
`{schema, commit, dirty, built_at, source_hash}`. Sunucu açılışta bunu kaynakla karşılaştırır, eskiyse konsola açık bir
uyarı yazar ve `GET /api/meta/build` ile arayüze bildirir (arayüz kapatılabilir bir bant gösterir).

Karar yolu (ucuzdan pahalıya değil, doğrudan doğruya):
1. `build-info.json` + `source_hash` varsa: şimdiki kaynak özeti (frontend/src + package-lock.json) hesaplanır; farklıysa
   eskidir. Yalnız commit karşılaştırması kullanılmaz: arayüze dokunmayan (backend) commit'ler yanlış alarm verir,
   işlenmemiş arayüz değişikliklerini ise kaçırır. Özet ~700 dosya / ~11 MB için onlarca milisaniyedir.
2. `build-info.json` yoksa (bu özellikten önceki derlemeler) ya da bozuksa: `dist/index.html` değişim zamanı kaynaktaki en yeni
   dosyanın zamanıyla karşılaştırılır (yalnız `stat`, içerik okunmaz).
3. git varsa `behind`: derlemeden bu yana frontend/src ya da package-lock.json'a dokunan commit sayısı (build-info'da commit
   varsa `<commit>..HEAD`, yoksa index.html zamanından beri). git yoksa ya da commit geçmişte bulunamazsa `null`.

Yanıtta dosya yolu yoktur; yalnız kısa commit kimlikleri ve zaman. Uç salt okunurdur (MCP için de güvenli).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter

from studio.config import FRONTEND_DIST, ROOT

BUILD_INFO_FILE = "build-info.json"
# Kaynak kapsamı (build-info.mjs ile birebir aynı): frontend/src altındaki dosyalar + frontend/package-lock.json
SOURCE_DIR = "src"
LOCK_FILE = "package-lock.json"
GIT_PATHS = ("frontend/src", "frontend/package-lock.json")
SHORT = 12
MTIME_SLACK_S = 2.0  # dosya sistemi zaman çözünürlüğü (FAT/SMB 2 sn); derleme ile aynı anda dokunulan dosya eski saymaz
CACHE_TTL_S = 30.0

GitRunner = Callable[[list[str]], "str | None"]


# ------------------------------------------------------------------------------------------------ kaynak özeti
def _source_files(frontend: Path) -> list[str]:
    """`src/...` POSIX göreli yolları (nokta ile başlayan adlar hariç, sembolik bağ izlenmez) + varsa package-lock.json."""
    out: list[str] = []
    stack: list[tuple[Path, str]] = [(frontend / SOURCE_DIR, SOURCE_DIR)]
    while stack:
        directory, rel = stack.pop()
        try:
            entries = list(os.scandir(directory))
        except OSError:
            continue
        for e in entries:
            if e.name.startswith("."):
                continue
            r = f"{rel}/{e.name}"
            try:
                if e.is_dir(follow_symlinks=False):
                    stack.append((Path(e.path), r))
                elif e.is_file(follow_symlinks=False):
                    out.append(r)
            except OSError:
                continue
    if (frontend / LOCK_FILE).is_file():
        out.append(LOCK_FILE)
    out.sort(key=lambda s: s.encode("utf-8"))
    return out


def source_hash(frontend: Path) -> str:
    """build-info.mjs `sourceHash` ile aynı: her dosya için `"<yol>\\0<sha256hex>\\n"`, UTF-8 bayt sırasıyla."""
    h = hashlib.sha256()
    for rel in _source_files(frontend):
        try:
            digest = hashlib.sha256((frontend / rel).read_bytes()).hexdigest()
        except OSError:
            continue
        h.update(f"{rel}\0{digest}\n".encode("utf-8"))
    return f"sha256:{h.hexdigest()}"


def newest_source_mtime(frontend: Path) -> float | None:
    newest: float | None = None
    for rel in _source_files(frontend):
        try:
            m = (frontend / rel).stat().st_mtime
        except OSError:
            continue
        newest = m if newest is None or m > newest else newest
    return newest


# ------------------------------------------------------------------------------------------------ git
def default_git(repo: Path) -> GitRunner | None:
    """Bu deponun kendi git'i (üst klasördeki ilgisiz bir depo sayılmaz); git yoksa None."""
    exe = shutil.which("git")
    if exe is None or not (repo / ".git").exists():
        return None
    kwargs: dict[str, Any] = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    def run(args: list[str]) -> str | None:
        try:
            proc = subprocess.run([exe, *args], cwd=repo, capture_output=True, text=True, encoding="utf-8",
                                  errors="replace", timeout=5, stdin=subprocess.DEVNULL, **kwargs)
        except (OSError, subprocess.SubprocessError):
            return None
        return proc.stdout.strip() if proc.returncode == 0 else None

    return run


def _is_sha(value: Any) -> bool:
    return isinstance(value, str) and 7 <= len(value) <= 64 and all(c in "0123456789abcdef" for c in value)


def _count(text: str | None) -> int | None:
    try:
        return int(text) if text is not None else None
    except ValueError:
        return None


# ------------------------------------------------------------------------------------------------ karar
def read_build_info(dist: Path) -> dict[str, Any] | None:
    try:
        data = json.loads((dist / BUILD_INFO_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def check(dist: Path | None = None, frontend: Path | None = None, git: GitRunner | None | bool = True) -> dict[str, Any]:
    """Derleme durumu. `git=True` → depo git'i (varsa); `None`/`False` → git yok sayılır; çağrılabilir → sahte git (test)."""
    dist = FRONTEND_DIST if dist is None else dist
    frontend = ROOT / "frontend" if frontend is None else frontend
    runner: GitRunner | None = default_git(ROOT) if git is True else (git or None)
    head_raw = runner(["rev-parse", "HEAD"]) if runner else None
    head = head_raw if _is_sha(head_raw) else None
    result: dict[str, Any] = {
        "stale": False, "built_commit": None, "source_commit": head[:SHORT] if head else None, "behind": None,
        "built_at": None, "method": "none", "has_build_info": False,
    }
    index = dist / "index.html"
    if not index.is_file() or not (frontend / SOURCE_DIR).is_dir():
        return result  # sunulan arayüz yok ya da kaynak yok (paket kurulumu): karşılaştırılacak bir şey yok
    info = read_build_info(dist)
    built_commit = info.get("commit") if info and _is_sha(info.get("commit")) else None
    recorded_hash = info.get("source_hash") if info else None
    result["has_build_info"] = info is not None
    result["built_commit"] = built_commit[:SHORT] if built_commit else None

    if isinstance(recorded_hash, str) and recorded_hash.startswith("sha256:"):
        result["method"] = "hash"
        built_at = info.get("built_at") if info else None
        result["built_at"] = built_at if isinstance(built_at, str) else None
        stale = source_hash(frontend) != recorded_hash
    else:
        result["method"] = "mtime"
        try:
            built_ts = index.stat().st_mtime
        except OSError:
            return result
        result["built_at"] = _iso(built_ts)
        newest = newest_source_mtime(frontend)
        stale = newest is not None and newest > built_ts + MTIME_SLACK_S
    result["stale"] = stale

    if not stale:
        result["behind"] = 0
    elif runner and head:
        if built_commit:
            # derleme commit'i geçmişte yoksa (başka klon, yeniden yazılmış geçmiş) rev-list başarısız → null
            result["behind"] = _count(runner(["rev-list", "--count", f"{built_commit}..HEAD", "--", *GIT_PATHS]))
        elif result["method"] == "mtime":
            since = int(index.stat().st_mtime)
            result["behind"] = _count(runner(["rev-list", "--count", f"--since={since}", "HEAD", "--", *GIT_PATHS]))
    return result


# ------------------------------------------------------------------------------------------------ önbellek + uç
_lock = threading.Lock()
_cache: dict[str, Any] = {"key": None, "at": 0.0, "value": None}


def _cache_key(dist: Path) -> tuple[Any, ...]:
    out: list[Any] = []
    for name in (BUILD_INFO_FILE, "index.html"):
        try:
            out.append((dist / name).stat().st_mtime_ns)
        except OSError:
            out.append(None)
    return tuple(out)


def status(force: bool = False) -> dict[str, Any]:
    """Önbellekli `check()`: derleme dosyaları değişince ya da 30 sn geçince yeniden hesaplanır (git pull sonrası da)."""
    key = _cache_key(FRONTEND_DIST)
    now = time.monotonic()
    with _lock:
        if not force and _cache["value"] is not None and _cache["key"] == key and now - _cache["at"] < CACHE_TTL_S:
            return dict(_cache["value"])
    value = check()
    with _lock:
        _cache.update(key=key, at=now, value=value)
    return dict(value)


def stale_warning(info: dict[str, Any]) -> str | None:
    """Açılış konsolu için iki dilli uyarı (eski değilse None)."""
    if not info.get("stale"):
        return None
    cmd = "start.ps1 -Rebuild" if sys.platform == "win32" else "./start.sh --rebuild"
    built = info.get("built_commit") or info.get("built_at") or "?"
    behind = info.get("behind")
    extra_tr = f", {behind} arayüz commit'i geride" if isinstance(behind, int) and behind > 0 else ""
    extra_en = f", {behind} UI commits behind" if isinstance(behind, int) and behind > 0 else ""
    return (
        f"UYARI: arayüz derlemesi (frontend/dist) kaynak koddan eski (derleme: {built}{extra_tr}); yeni özellikler "
        f"görünmeyebilir. Yeniden derlemek için: {cmd}\n"
        f"WARNING: the UI build is older than the source (build: {built}{extra_en}); new features may be missing. "
        f"Rebuild with: {cmd}"
    )


def warn_if_stale(stream: Any = None) -> dict[str, Any] | None:
    """Açılışta bir kez: denetle, önbelleği doldur, eskiyse konsola yaz. Denetim hatası açılışı asla durdurmaz."""
    try:
        info = status(force=True)
    except Exception:  # noqa: BLE001 — uyarı yardımcıdır; sunucu yine açılır
        return None
    text = stale_warning(info)
    if text:
        print(text, file=stream or sys.stderr, flush=True)
    return info


# Başlatma betikleri (start.ps1 / start.sh) bu değişkeni yalnız kendi başlattıkları sunucuya verir: denetimi zaten yapıp
# uyarıyı gösterdiler, sunucu aynı uyarıyı ikinci kez yazmaz.
CHECKED_ENV = "STUDIO_BUILD_CHECKED"


def build_router(_studio: Any = None) -> APIRouter:
    r = APIRouter(prefix="/api/meta", tags=["meta"])

    @r.get("/build")
    async def build() -> dict[str, Any]:
        return await asyncio.to_thread(status)

    return r


def main() -> int:
    """`python -m studio.buildinfo`: eskiyse uyarıyı yazar. Her zaman 0 döner (betikler `set -e` ile durmasın)."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass
    warn_if_stale(sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
