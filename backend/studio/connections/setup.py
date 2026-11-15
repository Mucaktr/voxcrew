"""Sihirbaz eylemleri — hepsi kullanıcı tıklamasıyla (otomatik başlatma yok):

- `apply_hermes_home(path)`: stüdyo AYARI (`hermes_home`); kullanıcı dosyasına yazılmaz.
- `OllamaRunner`: stüdyonun alt süreci olarak `ollama serve` (gateway yönetim deseni: Popen + kill_tree + atexit);
  kapanışta durdurma ayarı `connections.ollama.stop_on_exit`.
- `open_login_terminal(kind)`: resmî CLI ile oturum açma için kullanıcının bilgisayarında bir terminal penceresi açar
  (`codex login` / `claude`). Kimlik bilgisi arayüzden geçmez; terminal açılamazsa komut kopyalanmak üzere döner.
- `configure_openai_compat(...)`: ayar + anahtar (secrets.json, maskeli).
"""

from __future__ import annotations

import asyncio
import atexit
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

import httpx

from studio.connectors.base import child_env, group_popen_kwargs, kill_tree, mark_group
from studio.i18n import translate
from studio.connectors.discovery import find_claude, find_codex, find_ollama, hermes_home_candidates


class SetupError(ValueError):
    pass


# ---------------------------------------------------------------------- Hermes klasörü
def _check_hermes_home(settings: Any, path: str, *, env: Any = None, home: Path | None = None,
                       platform: str | None = None, which: Any = shutil.which) -> tuple[Path, dict[str, Any] | None]:
    p = Path(path).expanduser()
    if not p.is_dir():
        raise SetupError(f"Klasör bulunamadı: {p}")
    cands = hermes_home_candidates(None, env=env, home=home, platform=platform, which=which)
    cand = next((c for c in cands if Path(c["path"]).resolve() == p.resolve()), None)
    from studio.connectors.discovery import _looks_like_hermes_home  # noqa: PLC0415
    if not (cand or _looks_like_hermes_home(p)):
        raise SetupError("Bu klasör bir Hermes veri kökü gibi görünmüyor (config.yaml / profiles / SOUL.md yok)")
    if "hermes_home" in getattr(settings, "env_locked", []):
        raise SetupError("HERMES_HOME ortam değişkeni ayarlı; uygulama ayarı onu geçersiz kılamaz")
    return p, cand


def preview_hermes_home(settings: Any, path: str, **kw: Any) -> dict[str, Any]:
    """Önizleme (hiçbir şey yazmaz): yalnızca STÜDYO ayarı `hermes_home` değişir; seçilen Hermes klasörüne yazılmaz.
    Arayüz bunu gösterip kullanıcı onaylayınca `apply_hermes_home` çağrılır."""
    p, cand = _check_hermes_home(settings, path, **kw)
    from studio.connectors.discovery import _looks_like_hermes_home, hermes_version  # noqa: PLC0415
    profiles = (cand or {}).get("profiles") or []
    return {"setting": "hermes_home", "from": str(settings.get("hermes_home") or ""), "to": str(p),
            "changed": str(settings.get("hermes_home") or "") != str(p), "writes": "studio_settings",
            "touches_folder": False, "looks_like_home": _looks_like_hermes_home(p),
            "runner": (cand or {}).get("runner"), "version": (cand or {}).get("version") or hermes_version(p),
            "profiles": profiles}


def apply_hermes_home(settings: Any, path: str, *, env: Any = None, home: Path | None = None,
                      platform: str | None = None, which: Any = shutil.which) -> dict[str, Any]:
    p, _ = _check_hermes_home(settings, path, env=env, home=home, platform=platform, which=which)
    settings.update({"hermes_home": str(p)})
    return {"ok": True, "hermes_home": str(p)}


# ---------------------------------------------------------------------- Ollama süreci
class OllamaRunner:
    """Stüdyonun başlattığı `ollama serve`. Dışarıda zaten çalışan Ollama'ya dokunmaz."""

    def __init__(self, settings: Any, data_dir: Path, *, popen: Callable[..., Any] | None = None,
                 http_transport: httpx.AsyncBaseTransport | None = None, finder: Callable[..., Path | None] = find_ollama):
        self.settings = settings
        self.data_dir = Path(data_dir)
        self.log_path = self.data_dir / "ollama.log"
        self._popen = popen or subprocess.Popen
        self.http_transport = http_transport
        self.finder = finder
        self.proc: Any = None
        self.started_at: float | None = None
        self.last_error: str | None = None
        self._lock = asyncio.Lock()
        self._atexit = False

    @property
    def managed(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def url(self) -> str:
        return str(self.settings.get("ollama_url")).rstrip("/")

    async def healthy(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=1.5, trust_env=False, transport=self.http_transport) as client:
                return (await client.get(f"{self.url()}/api/version")).status_code == 200
        except httpx.HTTPError:
            return False

    def info(self) -> dict[str, Any]:
        return {"managed": self.managed, "pid": self.proc.pid if self.managed else None, "started_at": self.started_at,
                "error": translate(self.last_error) if self.last_error else None, "log_path": str(self.log_path),
                "stop_on_exit": bool(self.settings.get("connections.ollama.stop_on_exit", True))}

    async def start(self) -> dict[str, Any]:
        async with self._lock:
            if await self.healthy():
                raise SetupError("Ollama zaten çalışıyor")
            exe = self.finder()
            if not exe:
                raise SetupError("ollama çalıştırıcısı bulunamadı; ollama.com'dan kur")
            parts = urlsplit(self.url())
            env = child_env({"OLLAMA_HOST": f"{parts.hostname or '127.0.0.1'}:{parts.port or 11434}"})
            self.last_error = None
            try:
                self.data_dir.mkdir(parents=True, exist_ok=True)
                if self.log_path.is_file() and self.log_path.stat().st_size > 5_000_000:  # süreç tutamaç tuttuğu için başlangıçta döndürülür
                    self.log_path.replace(self.log_path.with_suffix(".log.1"))
                log = open(self.log_path, "ab")  # noqa: SIM115 - süreç yaşadıkça açık kalır
                self.proc = mark_group(self._popen([str(exe), "serve"], env=env, stdin=subprocess.DEVNULL, stdout=log,
                                                   stderr=subprocess.STDOUT, **group_popen_kwargs()))
            except OSError as exc:
                self.last_error = f"Ollama başlatılamadı: {exc}"
                raise SetupError(self.last_error) from exc
            self.started_at = time.time()
            if not self._atexit:
                atexit.register(self._on_exit)
                self._atexit = True
            for _ in range(32):  # ~8 sn sağlık bekle
                if self.proc.poll() is not None:
                    self.last_error = f"Ollama {self.proc.returncode} koduyla çıktı (günlük: {self.log_path.name})"
                    raise SetupError(self.last_error)
                if await self.healthy():
                    break
                await asyncio.sleep(0.25)
            return self.info()

    async def stop(self) -> dict[str, Any]:
        async with self._lock:
            if not self.managed:
                raise SetupError("Uygulamanın başlattığı bir Ollama süreci yok (dışarıda başlatılmışsa oradan kapat)")
            kill_tree(self.proc)
            await asyncio.sleep(0.2)
            return self.info()

    def _on_exit(self) -> None:
        if self.managed and bool(self.settings.get("connections.ollama.stop_on_exit", True)):
            try:
                kill_tree(self.proc, grace=0)
            except Exception:  # noqa: BLE001
                pass

    async def shutdown(self) -> None:
        self._on_exit()


# ---------------------------------------------------------------------- terminalde giriş
def login_command(kind: str, *, env: Any = None, home: Path | None = None, platform: str | None = None,
                  which: Any = shutil.which) -> tuple[list[str], str]:
    """(argv, görünen komut). Claude'da etkileşimli oturum açılır; kullanıcı /login yazar."""
    if kind == "codex":
        exe = find_codex(env=env, home=home, platform=platform, which=which)
        if not exe:
            raise SetupError("codex CLI bulunamadı")
        # PATH dışındaki CLI (ör. Codex uygulamasının paketlediği): elle çalıştırılacak komut tam yolla gösterilir
        return [str(exe), "login"], ("codex login" if which("codex") else f'"{exe}" login')
    if kind == "claude":
        exe = find_claude(env=env, home=home, platform=platform, which=which)
        if not exe:
            raise SetupError("claude CLI bulunamadı")
        return [str(exe)], ("claude" if which("claude") else f'"{exe}"') + "   (sonra: /login)"
    raise SetupError("Giriş yalnızca codex ve claude için")


def open_terminal(argv: list[str], *, platform: str | None = None, popen: Callable[..., Any] | None = None,
                  which: Any = shutil.which) -> dict[str, Any]:
    """Komutu yeni bir terminal penceresinde çalıştırır. Çıktı stüdyoya akmaz (kimlik bilgisi arayüzden geçmez)."""
    platform = platform or sys.platform
    popen = popen or subprocess.Popen
    shown = " ".join(argv)
    try:
        if platform == "win32":
            # cmd /k: pencere komut bitince de açık kalsın (kullanıcı çıktıyı görsün)
            popen(["cmd.exe", "/k", *argv], creationflags=subprocess.CREATE_NEW_CONSOLE)
            return {"ok": True, "opened": True, "command": shown}
        if platform == "darwin":
            script = 'tell application "Terminal" to do script "' + shown.replace('"', '\\"') + '"'
            popen(["osascript", "-e", script, "-e", 'tell application "Terminal" to activate'])
            return {"ok": True, "opened": True, "command": shown}
        for term, pre in (("x-terminal-emulator", ["-e"]), ("gnome-terminal", ["--"]), ("konsole", ["-e"]),
                          ("xfce4-terminal", ["-x"]), ("xterm", ["-e"])):
            if which(term):
                popen([term, *pre, *argv])
                return {"ok": True, "opened": True, "command": shown}
        return {"ok": False, "opened": False, "command": shown,
                "error": translate("Terminal uygulaması bulunamadı; komutu kendin çalıştır")}  # 200 yanıt (C-04)
    except OSError as exc:
        return {"ok": False, "opened": False, "command": shown, "error": str(exc)}


SHELLS = ("powershell", "cmd", "sh")


def open_shell(shell: str, *, platform: str | None = None, popen: Callable[..., Any] | None = None,
               which: Any = shutil.which, home: Path | None = None) -> dict[str, Any]:
    """Kurulum rehberinin "Terminal aç" düğmesi (SETUP): kullanıcının ev klasöründe BOŞ bir terminal penceresi açar.

    Hiçbir komut çalıştırılmaz ve komut parametresi KABUL EDİLMEZ — kullanıcı rehberden kopyaladığı resmî kurulum
    komutunu kendisi yapıştırır (sessiz kurulum yok). Windows'ta `powershell` ya da `cmd`; macOS/Linux'ta varsayılan
    terminal uygulaması (`sh` dışındaki seçimler bu platformlarda yok sayılır)."""
    shell = shell if shell in SHELLS else "sh"  # bilinmeyen seçim: platformun varsayılan terminali
    platform = platform or sys.platform
    popen = popen or subprocess.Popen
    cwd = str(home or Path.home())
    try:
        if platform == "win32":
            argv = ["powershell.exe", "-NoExit", "-NoLogo"] if shell != "cmd" else ["cmd.exe", "/k"]
            popen(argv, cwd=cwd, creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0))
            return {"ok": True, "opened": True, "shell": "cmd" if shell == "cmd" else "powershell"}
        if platform == "darwin":
            popen(["osascript", "-e", 'tell application "Terminal" to do script ""', "-e",
                   'tell application "Terminal" to activate'], cwd=cwd)
            return {"ok": True, "opened": True, "shell": "sh"}
        for term in ("x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"):
            if which(term):
                popen([term], cwd=cwd)
                return {"ok": True, "opened": True, "shell": "sh"}
        return {"ok": False, "opened": False, "shell": "sh",
                "error": translate("Terminal uygulaması bulunamadı; komutu kendin çalıştır")}
    except OSError as exc:
        return {"ok": False, "opened": False, "shell": shell, "error": str(exc)}


# ---------------------------------------------------------------------- OpenAI uyumlu ayar
def configure_openai_compat(settings: Any, secrets: Any, data: dict[str, Any]) -> dict[str, Any]:
    """Eski tek-bağlantı ucu (PUT /openai_compat): VARSAYILAN API bağlantısını ayarlar (S37'den beri çoklu uç noktanın
    biri). Hiç bağlantı yoksa `default` kimliğiyle oluşturulur (anahtar adı eskisiyle aynı: `openai_compat.api_key`).
    Boş base_url varsayılan bağlantıyı devre dışı bırakır (anahtar silinmez)."""
    from studio.connections import endpoints as E  # noqa: PLC0415

    base_url = str(data.get("base_url") or "").strip().rstrip("/")
    if base_url and not base_url.startswith(("http://", "https://")):
        raise SetupError("base_url http:// ya da https:// ile başlamalı")
    eid = E.default_endpoint_id(settings)
    try:
        if not base_url:
            if eid:
                E.save_endpoint(settings, secrets, {"enabled": False}, eid)
        else:
            patch: dict[str, Any] = {"base_url": base_url, "label": str(data.get("label") or "")[:60] or None,
                                     "model": str(data.get("model") or "")[:120]}
            if not patch["label"]:
                patch.pop("label")
            if "api_key" in data:
                patch["api_key"] = data.get("api_key")
            if eid is None:
                patch["id"] = E.LEGACY_ID if not any(e["id"] == E.LEGACY_ID for e in E.endpoints_of(settings)) else ""
                patch["make_default"] = True
            E.save_endpoint(settings, secrets, patch, eid)
            eid = eid or E.default_endpoint_id(settings)
    except E.EndpointError as exc:
        raise SetupError(str(exc)) from exc
    ep = E.get_endpoint(settings, eid) if eid else None
    if not ep or not ep["enabled"]:
        return {"enabled": False, "base_url": "", "label": "", "model": "", "has_key": False, "api_key_masked": None}
    pub = E.public_endpoint(ep, secrets, E.default_endpoint_id(settings))
    return {"enabled": True, "base_url": ep["base_url"], "label": ep["label"], "model": ep["model"], "id": ep["id"],
            "has_key": pub["has_key"], "api_key_masked": pub["api_key_masked"]}


__all__ = ["OllamaRunner", "SHELLS", "SetupError", "apply_hermes_home", "configure_openai_compat", "login_command",
           "open_shell", "open_terminal"]
