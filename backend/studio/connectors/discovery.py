"""Yerel kurulum keşfi: Hermes, Ollama, Codex CLI, Claude Code CLI, Gemini CLI — yol, sürüm, oturum ipucu.

Platformlar arası: önce PATH (`shutil.which`), sonra bilinen kurulum yolları — Windows'ta `.exe`, macOS/Linux'ta
uzantısız ikililer (`~/.local/bin`, Homebrew, `/usr/local/bin`, npm global). Uygulama bir GUI ya da servis
yöneticisinden başlatıldığında PATH eksik olabileceği için bu yedek yollar önemlidir. Keşif süreç başlatmaz;
yalnızca `probe_*` işlevleri sürüm için `--version` çalıştırır.

S29: `*_candidates()` işlevleri kurulum ADAYLARINI (veri kökü ↔ çalıştırıcı ayrı) listeler; tek bir
`hermes_home` ayarı yoksa ya da yanlışsa `studio.connections` servisi bu adaylardan kullanıcıya seçtirir.
`ConnectionProbe` artık ince bir kabuktur: tek bağlantı durumu modeli `studio.connections.service` içindedir.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit

import httpx

from studio.config import Settings

_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0


def _newest(paths: list[Path]) -> Path | None:
    paths = [p for p in paths if p.is_file()]
    return max(paths, key=lambda p: p.stat().st_mtime) if paths else None


def _bin_names(name: str, platform: str | None = None) -> list[str]:
    """Platforma göre çalıştırılabilir dosya adları (Windows'ta uzantısız betikler doğrudan çalışmaz)."""
    platform = platform or sys.platform
    return [f"{name}.exe", f"{name}.cmd"] if platform == "win32" else [name]


def _bin_dirs(home: Path | None, env: Mapping[str, str] | None) -> list[Path]:
    """`_posix_bin_dirs` sarmalı: varsayılan ev/ortamda parametresiz çağrı (testler parametresiz yamalayabilir)."""
    if (home is None or home == Path.home()) and (env is None or env is os.environ):
        return _posix_bin_dirs()
    return _posix_bin_dirs(home, env)


def _posix_bin_dirs(home: Path | None = None, env: Mapping[str, str] | None = None) -> list[Path]:
    """PATH dışında sık kullanılan kullanıcı ve sistem bin klasörleri (macOS/Linux)."""
    home = home or Path.home()
    env = os.environ if env is None else env
    dirs = [home / ".local" / "bin", home / ".npm-global" / "bin", home / ".volta" / "bin", home / "bin",
            Path("/opt/homebrew/bin"), Path("/usr/local/bin"), Path("/usr/bin")]
    prefix = env.get("NPM_CONFIG_PREFIX")
    if prefix:
        dirs.insert(0, Path(prefix) / "bin")
    return dirs


def _first_file(cands: list[Path]) -> Path | None:
    for c in cands:
        try:
            if c.is_file():
                return c
        except OSError:
            continue
    return None


def _is_dir(p: Path) -> bool:
    try:
        return p.is_dir()
    except OSError:
        return False


# ---------------------------------------------------------------- Hermes
# "bin" işaret DEĞİLDİR: PATH'teki ~/.local/bin/hermes, ~/.local'i veri kökü gibi gösteriyordu; veri kökü ile çalıştırıcı
# yolu ayrı tutulur (QA-F56).
HERMES_HOME_MARKERS = ("config.yaml", "profiles", "hermes-agent", "SOUL.md", ".env")


def _looks_like_hermes_home(p: Path) -> bool:
    return _is_dir(p) and any((p / m).exists() for m in HERMES_HOME_MARKERS)


def hermes_home_candidates(settings_home: str | None = None, *, env: Mapping[str, str] | None = None,
                           home: Path | None = None, platform: str | None = None,
                           which: Any = None) -> list[dict[str, Any]]:
    """Hermes veri kökü (HERMES_HOME) adayları, öncelik sırasıyla (D-02 /).

    Kaynaklar: stüdyo ayarı → HERMES_HOME ortam değişkeni → ~/.hermes → PATH'teki hermes(.exe) konumundan türetme
    (<home>/bin/hermes) → pipx/uv tool dizinleri → %LOCALAPPDATA%/hermes. WSL yalnızca bilgi (`wsl_hint`).
    Tüm disk taranmaz. Her aday: {path, source, exists, looks_like_home, runner, version, profiles, recommended}.
"""
    env = os.environ if env is None else env
    home = home or Path.home()
    platform = platform or sys.platform
    which = which or shutil.which
    seen: dict[str, dict[str, Any]] = {}

    def add(path: Path | str | None, source: str) -> None:
        if not path:
            return
        p = Path(str(path)).expanduser()
        try:
            key = str(p.resolve()).lower() if platform == "win32" else str(p.resolve())
        except OSError:
            key = str(p)
        if key in seen:
            seen[key]["sources"].append(source)
            return
        exists = _is_dir(p)
        # çalıştırıcı: adayın KENDİ bin klasörü (PATH'teki hermes yalnızca "path" kaynaklı adaya aittir)
        runner = _first_file([p / "bin" / n for n in ("hermes.exe", "hermes")]) if exists else None
        if runner is None and source == "path":
            runner = Path(exe) if exe else None
        try:
            profiles = sorted(x.name for x in (p / "profiles").glob("*") if (x / "config.yaml").is_file()) if exists else []
        except OSError:
            profiles = []
        seen[key] = {"path": str(p), "source": source, "sources": [source], "exists": exists,
                     "looks_like_home": _looks_like_hermes_home(p), "runner": str(runner) if runner else None,
                     "version": hermes_version(p) if exists else None, "profiles": profiles}

    exe = which("hermes")
    add(settings_home, "setting")
    if (env.get("HERMES_HOME") or "").strip():
        add(env["HERMES_HOME"].strip(), "env")
    add(home / ".hermes", "default")
    if exe:
        # <home>/bin/hermes → <home>
        parent = Path(exe).resolve().parent
        if parent.name.lower() == "bin":
            add(parent.parent, "path")
    for d in (home / ".local" / "pipx" / "venvs" / "hermes-agent", home / ".local" / "share" / "uv" / "tools" / "hermes-agent"):
        if _is_dir(d):
            add(d, "tool")
    if platform == "win32":
        local = env.get("LOCALAPPDATA")
        if local:
            add(Path(local) / "hermes", "localappdata")
    out = list(seen.values())
    # öneri: var olan + Hermes'e benzeyen + çalıştırıcısı olan ilk aday
    best = next((c for c in out if c["exists"] and c["looks_like_home"] and c["runner"]), None) \
        or next((c for c in out if c["exists"] and c["looks_like_home"]), None)
    for c in out:
        c["recommended"] = c is best
    return out


def wsl_hint(platform: str | None = None, which: Any = None) -> dict[str, Any] | None:
    """Windows'ta WSL varsa yalnızca bilgi: Linux tarafındaki ~/.hermes ayrı bir kurulumdur (süreç çalıştırılmaz)."""
    platform = platform or sys.platform
    which = which or shutil.which
    if platform != "win32":
        return None
    if not which("wsl"):
        return None
    return {"available": True, "note": "WSL kurulu: Linux tarafındaki ~/.hermes ayrı bir Hermes kurulumu olabilir; "
                                       "uygulama yalnızca Windows (native) kurulumunu kullanır."}


def find_hermes(home: Path, *, platform: str | None = None, which: Any = None) -> Path | None:
    platform = platform or sys.platform
    which = which or shutil.which
    found = _first_file([home / "bin" / n for n in ("hermes.exe", "hermes")])
    if found:
        return found
    w = which("hermes")
    if w:
        return Path(w)
    if platform != "win32":
        return _first_file([d / "hermes" for d in _posix_bin_dirs()])
    return None


def hermes_available(home: Path) -> bool:
    """Hermes kullanılabilir mi: klasör var ve hermes ikilisi bulunuyor (süreç başlatmaz)."""
    try:
        return home.is_dir() and find_hermes(home) is not None
    except OSError:
        return False


def hermes_version(home: Path) -> str | None:
    """Hermes sürümü kurulum damgasından okunur (hermes_cli.__version__ ile aynı kaynak)."""
    src = home / "hermes-agent"
    try:
        stamp = json.loads((src / "install-stamp.json").read_text("utf-8-sig"))
        if stamp.get("baseVersion"):
            return str(stamp["baseVersion"])
    except (OSError, ValueError, AttributeError):
        pass
    try:
        m = re.search(r'__release_date__\s*=\s*"([^"]+)"', (src / "hermes_cli" / "__init__.py").read_text("utf-8"))
        return m.group(1) if m else None
    except OSError:
        return None


# ---------------------------------------------------------------- Ollama
def find_ollama(*, env: Mapping[str, str] | None = None, home: Path | None = None, platform: str | None = None,
                which: Any = None) -> Path | None:
    """Ollama çalıştırıcısı: PATH → %LOCALAPPDATA%\\Programs\\Ollama → /usr/local/bin → /Applications (macOS)."""
    env = os.environ if env is None else env
    home = home or Path.home()
    platform = platform or sys.platform
    which = which or shutil.which
    w = which("ollama")
    if w:
        return Path(w)
    cands: list[Path] = []
    if platform == "win32":
        local = env.get("LOCALAPPDATA")
        if local:
            cands += [Path(local) / "Programs" / "Ollama" / "ollama.exe"]
        cands += [Path(env.get("ProgramFiles", r"C:\Program Files")) / "Ollama" / "ollama.exe"]
    else:
        cands += [d / "ollama" for d in _bin_dirs(home, env)]
        if platform == "darwin":
            cands += [Path("/Applications/Ollama.app/Contents/Resources/ollama")]
    return _first_file(cands)


def ollama_url_from(settings_url: str, env: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Stüdyonun kullandığı adres ve OLLAMA_HOST farklıysa uyarı bilgisi."""
    from studio.config import normalize_ollama_host
    env = os.environ if env is None else env
    env_url = normalize_ollama_host(env.get("OLLAMA_HOST"))
    url = settings_url.rstrip("/")
    return {"url": url, "env_url": env_url, "mismatch": bool(env_url and env_url.rstrip("/") != url)}


def port_open(url: str, timeout: float = 0.6) -> bool | None:
    """Hızlı TCP kontrolü (HTTP isteği değil). Reddedilen bağlantıda False; çözümlenemeyen adres ya da zaman aşımında
    None (bilinmiyor — "kurulu değil" sayılmaz, QA-F56)."""
    parts = urlsplit(url if "://" in url else f"http://{url}")
    host, port = parts.hostname or "127.0.0.1", parts.port or (443 if parts.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (socket.gaierror, TimeoutError):
        return None
    except OSError:
        return False


# ---------------------------------------------------------------- Codex / Claude / Gemini
# Kod düzenleyici eklenti klasörleri: OpenAI'nin VS Code eklentisi (openai.chatgpt-*) Codex CLI'yi bin/<platform>/ altında taşır.
_EDITOR_EXT_DIRS = (".vscode", ".vscode-insiders", ".cursor", ".windsurf")


def _glob_files(base: Path, pattern: str) -> list[Path]:
    try:
        return [p for p in base.glob(pattern) if p.is_file()] if _is_dir(base) else []
    except OSError:
        return []


def codex_candidates(*, env: Mapping[str, str] | None = None, home: Path | None = None,
                     platform: str | None = None) -> list[tuple[Path, str]]:
    """PATH DIŞINDAKİ Codex CLI adayları, öncelik sırasıyla: (yol, kaynak). Süreç başlatmaz, yalnızca dosya varlığı.

    Kaynaklar: `codex_app` (Codex masaüstü uygulamasının paketlediği CLI), `npm` (genel önek), `editor` (VS Code /
    Cursor eklentisinin paketlediği CLI), `bin` (macOS/Linux kullanıcı/sistem bin klasörleri). Aynı kaynakta birden çok
    sürüm varsa en yenisi (mtime) önce gelir. Windows'ta `.exe`/`.cmd`, macOS/Linux'ta uzantısız ad aranır.
    """
    env = os.environ if env is None else env
    home = home or Path.home()
    platform = platform or sys.platform
    exe = "codex.exe" if platform == "win32" else "codex"
    out: list[tuple[Path, str]] = []

    def add(paths: list[Path], source: str) -> None:
        for p in sorted(paths, key=lambda x: x.stat().st_mtime if x.exists() else 0, reverse=True):
            if all(p != q for q, _ in out):
                out.append((p, source))

    if platform == "win32":
        local = (env.get("LOCALAPPDATA") or "").strip()
        if local:
            # Codex masaüstü uygulaması CLI'yi %LOCALAPPDATA%\OpenAI\Codex\bin\<sürüm>\codex.exe altına açar; MSIX
            # sanallaştırması etkinse aynı ağaç paket önbelleğinde durur (Packages\OpenAI.Codex_*\LocalCache\Local\...).
            add(_glob_files(Path(local) / "OpenAI" / "Codex" / "bin", "*/codex.exe"), "codex_app")
            add(_glob_files(Path(local) / "Packages", "OpenAI.Codex_*/LocalCache/Local/OpenAI/Codex/bin/*/codex.exe"), "codex_app")
        npm_dirs = [Path(p) for p in ((env.get("NPM_CONFIG_PREFIX") or "").strip(),) if p]
        if (env.get("APPDATA") or "").strip():
            npm_dirs.append(Path(env["APPDATA"]) / "npm")
        add([p for d in npm_dirs for p in (d / "codex.cmd", d / "codex.exe", d / "codex") if _first_file([p])], "npm")
    else:
        if platform == "darwin":
            apps = [Path("/Applications/Codex.app"), home / "Applications" / "Codex.app"]
            add([p for a in apps for p in (a / "Contents" / "Resources" / "codex", a / "Contents" / "MacOS" / "codex")
                 if _first_file([p])], "codex_app")
        add([d / "codex" for d in _bin_dirs(home, env) if _first_file([d / "codex"])], "bin")
    for ed in _EDITOR_EXT_DIRS:
        add(_glob_files(home / ed / "extensions", f"openai.chatgpt-*/bin/*/{exe}"), "editor")
    return out


def find_codex(*, env: Mapping[str, str] | None = None, home: Path | None = None, platform: str | None = None,
               which: Any = None) -> Path | None:
    """Codex CLI: önce PATH, sonra `codex_candidates` (masaüstü uygulamasının paketlediği CLI, npm, editör eklentisi)."""
    which = which or shutil.which
    found = which("codex")
    if found:
        return Path(found)
    cands = codex_candidates(env=env, home=home, platform=platform)
    return cands[0][0] if cands else None


def codex_app_present(*, env: Mapping[str, str] | None = None, home: Path | None = None,
                      platform: str | None = None) -> bool:
    """Codex masaüstü uygulaması ya da oturum klasörü var mı (yalnızca VARLIK; kimlik dosyası okunmaz). CLI bulunamadığında
    "uygulama var ama komut satırı aracı yok" iletisini seçmek için kullanılır."""
    env = os.environ if env is None else env
    home = home or Path.home()
    platform = platform or sys.platform
    codex_home = Path(env.get("CODEX_HOME") or (home / ".codex"))
    try:
        if (codex_home / "auth.json").is_file():
            return True
    except OSError:
        pass
    if platform == "win32":
        local = (env.get("LOCALAPPDATA") or "").strip()
        if local:
            if _is_dir(Path(local) / "OpenAI" / "Codex"):
                return True
            try:
                return any(Path(local, "Packages").glob("OpenAI.Codex_*"))
            except OSError:
                return False
        return False
    if platform == "darwin":
        return any(_is_dir(a) for a in (Path("/Applications/Codex.app"), home / "Applications" / "Codex.app"))
    return False


def on_path(name: str, which: Any = None) -> bool:
    """Komut PATH'te mi (terminalde adıyla çalışır mı)."""
    return bool((which or shutil.which)(name))


def find_claude(*, env: Mapping[str, str] | None = None, home: Path | None = None, platform: str | None = None,
                which: Any = None) -> Path | None:
    env = os.environ if env is None else env
    home = home or Path.home()
    platform = platform or sys.platform
    which = which or shutil.which
    found = which("claude")
    if found:
        return Path(found)
    cands: list[Path] = []
    for d in (home / ".local" / "bin", home / ".claude" / "local"):
        cands += [d / n for n in _bin_names("claude", platform)]
    if platform == "win32":
        base = Path(env.get("APPDATA", "")) / "Claude" / "claude-code"
        if base.exists():
            cands += list(base.glob("*/*/claude.exe")) + list(base.glob("*/claude.exe"))
        appdata = env.get("APPDATA")
        if appdata:
            cands += [Path(appdata) / "npm" / n for n in ("claude.cmd", "claude")]
    else:
        cands += [d / "claude" for d in _bin_dirs(home, env)]
    return _newest(cands)


def find_gemini(*, env: Mapping[str, str] | None = None, home: Path | None = None, platform: str | None = None,
                which: Any = None) -> Path | None:
    """Gemini CLI (yalnızca algılama; bağlayıcı yok — 'yakında')."""
    env = os.environ if env is None else env
    home = home or Path.home()
    platform = platform or sys.platform
    which = which or shutil.which
    found = which("gemini")
    if found:
        return Path(found)
    if platform == "win32":
        appdata = env.get("APPDATA")
        return _first_file([Path(appdata) / "npm" / n for n in ("gemini.cmd", "gemini")]) if appdata else None
    return _first_file([d / "gemini" for d in _bin_dirs(home, env)])


# sürüm yoklaması (`claude --version`) ana makinenin ortamını değil, en küçük ortamı alır: PATH + platformun
# süreç başlatmak için gereken değişkenleri. Oturum/anahtar/`CLAUDE_*` değişkenleri alt sürece geçmez.
_MINIMAL_ENV_KEYS = ("PATH", "PATHEXT", "SYSTEMROOT", "SystemRoot", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP",
                     "TMPDIR", "HOME", "USERPROFILE", "LANG", "LC_ALL", "LC_CTYPE")


def minimal_env(base: Mapping[str, str] | None = None) -> dict[str, str]:
    """PATH ve platformun temel değişkenleri (Windows'ta SystemRoot/ComSpec/PATHEXT; POSIX'te HOME/LANG/TMPDIR)."""
    src = os.environ if base is None else base
    keys = {k.upper() for k in _MINIMAL_ENV_KEYS}
    return {k: v for k, v in src.items() if k.upper() in keys}


def run_quick(argv: list[str], timeout: float = 20, env: Mapping[str, str] | None = None) -> tuple[int, str]:
    try:
        proc = subprocess.run(argv, capture_output=True, timeout=timeout, creationflags=_FLAGS,
                              env=dict(env) if env is not None else None)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return -1, str(exc)
    out = (proc.stdout + proc.stderr).decode("utf-8", "replace").strip()
    return proc.returncode, out


def codex_session_state(env: Mapping[str, str] | None = None, home: Path | None = None) -> dict[str, Any]:
    """Codex oturum İPUCU (D-03): auth.json varlığı oturumun geçerli olduğunu kanıtlamaz → logged_in dosya varlığı,
    session_valid None (bilinmiyor; gerçek sonuç son çalıştırma/test ile gelir)."""
    env = os.environ if env is None else env
    home = home or Path.home()
    codex_home = Path(env.get("CODEX_HOME") or (home / ".codex"))
    has_auth = (codex_home / "auth.json").is_file()
    default_model = None
    try:
        m = re.search(r'^\s*model\s*=\s*"([^"]+)"', (codex_home / "config.toml").read_text("utf-8"), re.M)
        default_model = m.group(1) if m else None
    except OSError:
        pass
    return {"logged_in": has_auth, "session_hint": "file" if has_auth else "none", "default_model": default_model,
            "detail": "Oturum dosyası var (geçerliliği ilk görevde anlaşılır)" if has_auth else "Giriş gerekli: `codex login`"}


def claude_login_state(home: Path | None = None, platform: str | None = None,
                       env: dict[str, str] | None = None) -> dict[str, Any]:
    """Claude Code oturum durumu tahmini. macOS'ta kimlik bilgisi Keychain'de durur: dosya yoksa "bilinmiyor" (None).
    Gerçek sağlık, son gerçek çalıştırma (last_use) ile ayrıca gösterilir."""
    home = home or Path.home()
    platform = platform or sys.platform
    env = dict(os.environ) if env is None else env
    # CLAUDE_CONFIG_DIR ayarlıysa Claude Code kimlik dosyasını orada tutar (external/setup.py ile aynı kural, QA-F56)
    config_dir = Path(env["CLAUDE_CONFIG_DIR"]) if (env.get("CLAUDE_CONFIG_DIR") or "").strip() else home / ".claude"
    if (config_dir / ".credentials.json").is_file():
        return {"logged_in": True, "session_hint": "file", "detail": "Oturum dosyası bulundu"}
    if env.get("ANTHROPIC_API_KEY"):
        return {"logged_in": True, "session_hint": "api_key", "detail": "API anahtarıyla (ANTHROPIC_API_KEY)"}
    if platform == "darwin":
        return {"logged_in": None, "session_hint": "keychain",
                "detail": "Oturum macOS anahtar zincirinde tutulur; durum ilk görevde anlaşılır"}
    return {"logged_in": False, "session_hint": "none", "detail": "Oturum dosyası yok — terminalde `claude` açıp /login gerekebilir"}


# ---------------------------------------------------------------- eski probe_* (geriye uyum; servis bunları kullanır)
async def probe_ollama(url: str) -> dict[str, Any]:
    info: dict[str, Any] = {"kind": "ollama", "name": "Ollama", "available": False, "path": url,
                            "subtitle": "Yerel ve ücretsiz modeller"}
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=8, trust_env=False) as client:
                info["version"] = (await client.get(f"{url}/api/version")).json().get("version")
                models = (await client.get(f"{url}/api/tags")).json().get("models", [])
                loaded = (await client.get(f"{url}/api/ps")).json().get("models", [])
            info.update(available=True, models=len(models), loaded=[m.get("name") for m in loaded])
            info["detail"] = f"{len(models)} model kurulu" + (f", {len(loaded)} bellekte" if loaded else "")
            info.pop("timeout", None)
            return info
        except httpx.TimeoutException as exc:
            info["timeout"] = True
            info["detail"] = "Ollama yanıt vermedi (zaman aşımı) — bilgisayar yoğun olabilir; yeniden tara"
            info["error"] = str(exc)
            if attempt == 0:
                await asyncio.sleep(0.5)
        except (httpx.HTTPError, ValueError) as exc:
            info["detail"] = "Ollama'ya ulaşılamadı — uygulamayı başlatın (ollama serve)"
            info["error"] = str(exc)
            break
    return info


def probe_hermes(home: Path) -> dict[str, Any]:
    exe = find_hermes(home) if home.is_dir() else None
    info: dict[str, Any] = {"kind": "hermes", "name": "Hermes Agent", "available": bool(exe),
                            "path": str(exe) if exe else None, "subtitle": "Ajan çalışma zamanı (isteğe bağlı)",
                            "optional": True, "version": hermes_version(home)}
    try:
        profiles = sorted(p.name for p in (home / "profiles").glob("*") if (p / "config.yaml").is_file())
    except OSError:
        profiles = []
    info["profiles"] = profiles
    if not exe:
        info["detail"] = ("Kurulu değil — isteğe bağlı. Ajanlar Ollama, Codex ya da Claude Code ile doğrudan çalışır. "
                          "(hermes; HERMES_HOME/bin ya da PATH içinde aranır)")
        return info
    info["detail"] = f"{len(profiles) + 1} profil (default dahil)"
    rc, out = run_quick([str(exe), "--version"], timeout=25)
    if rc == -1 and "timed out" in out.lower():
        info["timeout"] = True
        info["warning"] = "hermes --version zaman aşımına uğradı (bilgisayar yoğun olabilir); kurulum kullanılabilir."
    if not info["version"] and rc == 0:
        m = re.search(r"\bv?(\d+\.\d+(?:\.\d+)?)\b", out)
        info["version"] = m.group(1) if m else None
    if "pm repair" in out:
        info["warning"] = "Hermes bağımlılık ortamı kayıtlı değil; sorun yaşarsanız terminalde `hermes pm repair` çalıştırın."
    return info


def probe_codex() -> dict[str, Any]:
    exe = find_codex()
    info: dict[str, Any] = {"kind": "codex", "name": "GPT Codex", "available": bool(exe),
                            "path": str(exe) if exe else None, "subtitle": "ChatGPT aboneliği ile Codex CLI"}
    if not exe:
        info["detail"] = "codex CLI bulunamadı"
        return info
    rc, out = run_quick([str(exe), "--version"])
    info["version"] = out.splitlines()[0].replace("codex-cli", "").strip() if rc == 0 and out else None
    info.update(codex_session_state())
    return info


def probe_claude() -> dict[str, Any]:
    exe = find_claude()
    info: dict[str, Any] = {"kind": "claude", "name": "Claude Code", "available": bool(exe),
                            "path": str(exe) if exe else None, "subtitle": "Claude aboneliği ile Claude Code CLI"}
    if not exe:
        info["detail"] = "claude CLI bulunamadı"
        return info
    rc, out = run_quick([str(exe), "--version"], env=minimal_env())
    info["version"] = out.split()[0] if rc == 0 and out else None
    info.update(claude_login_state())
    return info


class ConnectionProbe:
    """Geriye uyumlu kabuk: eski `probe.get/record/cached` arayüzü, tek ConnectionService'e yönlenir.

    `Studio.probe` ve motorun `on_connector_result` kancası bu sınıfı kullanır; böylece /api/overview,
    /api/connections ve gerçek çalıştırma sonuçları aynı durum kaynağını besler."""

    def __init__(self, settings: Settings, ttl: float = 30):
        from studio.connections.service import service_for
        self.settings = settings
        self.ttl = ttl
        self.service = service_for(settings, ttl=ttl)

    @property
    def last_use(self) -> dict[str, dict[str, Any]]:
        return self.service.last_use

    def record(self, kind: str, ok: bool, error: str | None = None) -> None:
        self.service.record_use(kind, ok, error)

    async def get(self, force: bool = False) -> list[dict[str, Any]]:
        return await self.service.list(force=force, include_all=False)

    def _ttl_for(self, items: list[dict[str, Any]]) -> float:
        """Zaman aşımı içeren (geçici) sonuçlar kısa önbelleklenir; arayüz hemen yeniden deneyebilir."""
        return 5.0 if any(c.get("timeout") for c in items) else self.ttl

    def cached(self, kind: str) -> dict[str, Any] | None:
        return self.service.snapshot(kind)


__all__ = [
    "ConnectionProbe", "claude_login_state", "codex_app_present", "codex_candidates", "codex_session_state", "find_claude",
    "find_codex", "find_gemini", "on_path",
    "find_hermes", "find_ollama", "hermes_available", "hermes_home_candidates", "hermes_version", "ollama_url_from",
    "port_open", "probe_claude", "probe_codex", "probe_hermes", "probe_ollama", "run_quick", "wsl_hint",
]
