"""Hermes gateway yöneticisi (Ekip S2).

v0.22.2 topolojisi: tek host gateway tüm profillere hizmet eder.
  başlat: hermes -p default gateway run --external-supervisor
           (HERMES_HOME, HERMES_GATEWAY_DETACHED=1, PYTHONIOENCODING=utf-8; Ollama için CUSTOM_BASE_URL)
  durdur: hermes -p default gateway stop (30 sn'ye kadar boşaltır) → hâlâ yaşıyorsa süreç ağacı sonlandırılır
  sağlık: GET http://127.0.0.1:<port>/health (kimlik doğrulamasız)
  profil X: http://127.0.0.1:<port>/p/X/v1/... — X'in kendi profiles/X/.env API_SERVER_KEY'iyle

Kurallar: otomatik başlatma yok (yalnızca kullanıcı tıklaması), stüdyo kapanınca yönettiği gateway de durur,
anahtar değerleri asla yanıtlara/loglara/data'ya yazılmaz (gateway çıktısı maskelenerek data/gateway.log'a gider).
"""

from __future__ import annotations

import asyncio
import atexit
import collections
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import httpx
import yaml

from studio.changes import ENV_LINE_RE, env_get
from studio.connectors.base import child_env, kill_tree
from studio.connectors.discovery import find_hermes
from studio.i18n import translate

DEFAULT_PORT = 8642
HOST = "127.0.0.1"
PROFILE_MARKERS = ("config.yaml", ".env", "SOUL.md", "profile.yaml", "auth.json", "state.db")
STOP_TIMEOUT_S = 40.0

# hermes_cli/auth.py:282-314 ile aynı yer tutucu kuralı (has_usable_secret(min_length=16))
_PLACEHOLDERS = {"*", "**", "***", "changeme", "your_api_key", "your_api_key_here", "your-api-key",
                 "placeholder", "example", "dummy", "null", "none"}

# gateway/config_env.py:_ENV_ENABLE_CREDENTIALS — yalnızca ANAHTAR ADLARI kontrol edilir, değer okunup dönmez.
# (etiket, hepsi dolu olmalı, değer "true" gibi bir bayrak mı)
ADAPTER_CREDENTIALS: list[tuple[str, tuple[str, ...], bool]] = [
    ("Telegram", ("TELEGRAM_BOT_TOKEN",), False),
    ("Discord", ("DISCORD_BOT_TOKEN",), False),
    ("Slack", ("SLACK_BOT_TOKEN",), False),
    ("WhatsApp", ("WHATSAPP_ENABLED",), True),
    ("WhatsApp Cloud", ("WHATSAPP_CLOUD_PHONE_NUMBER_ID", "WHATSAPP_CLOUD_ACCESS_TOKEN"), False),
    ("Signal", ("SIGNAL_HTTP_URL",), False),
    ("Mattermost", ("MATTERMOST_TOKEN",), False),
    ("Matrix", ("MATRIX_ACCESS_TOKEN",), False),
    ("Matrix", ("MATRIX_PASSWORD",), False),
    ("E-posta", ("EMAIL_ADDRESS", "EMAIL_PASSWORD"), False),
    ("SMS (Twilio)", ("TWILIO_ACCOUNT_SID",), False),
    ("DingTalk", ("DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"), False),
    ("Feishu", ("FEISHU_APP_ID", "FEISHU_APP_SECRET"), False),
    ("WeCom", ("WECOM_BOT_ID", "WECOM_SECRET"), False),
    ("WeCom callback", ("WECOM_CALLBACK_CORP_ID", "WECOM_CALLBACK_CORP_SECRET"), False),
    ("Weixin", ("WEIXIN_TOKEN", "WEIXIN_ACCOUNT_ID"), False),
    ("BlueBubbles", ("BLUEBUBBLES_SERVER_URL", "BLUEBUBBLES_PASSWORD"), False),
    ("QQ", ("QQ_APP_ID", "QQ_CLIENT_SECRET"), False),
    ("Yuanbao", ("YUANBAO_APP_ID", "YUANBAO_APP_SECRET"), False),
    ("Relay", ("GATEWAY_RELAY_URL",), False),
    ("Webhook", ("WEBHOOK_ENABLED",), True),
    ("MS Graph webhook", ("MSGRAPH_WEBHOOK_ENABLED",), True),
]

_TRUTHY = {"1", "true", "yes", "on"}
_SECRET_ASSIGN_RE = re.compile(r"\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD))(\s*[=:]\s*)(\"?)([^\s\"']+)", re.I)
_BEARER_RE = re.compile(r"(Bearer\s+)[A-Za-z0-9._~+/=-]+", re.I)


def usable_key(value: str | None) -> bool:
    """Hermes'in API sunucusunu açacağı anahtar mı? (en az 16 karakter, yer tutucu değil)"""
    if not isinstance(value, str):
        return False
    v = value.strip()
    low = v.lower()
    if len(v) < 16 or low in _PLACEHOLDERS:
        return False
    if low.startswith("your_") and low.endswith("_here"):
        return False
    for prefix in ("sk-", "ghp_", "hf_"):
        tail = low[len(prefix):]
        if low.startswith(prefix) and tail and set(tail) == {"x"}:
            return False
    stripped = low.replace(" ", "").replace("-", "").replace("_", "")
    return not (stripped and set(stripped) == {"x"})


def env_keys(text: str | None) -> dict[str, bool]:
    """Etkin (yorum olmayan) satırlardaki anahtar adları → değeri dolu mu. Değerin kendisi dönmez."""
    out: dict[str, bool] = {}
    for line in (text or "").splitlines():
        m = ENV_LINE_RE.match(line)
        if m:
            out[m.group(2)] = bool(m.group(3).strip().strip('"').strip("'"))
    return out


def _env_truthy(text: str | None, key: str) -> bool:
    return (env_get(text, key) or "").strip().lower() in _TRUTHY


def _detect(get: Callable[[str], str | None]) -> list[dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for label, names, flag in ADAPTER_CREDENTIALS:
        values = [(get(n) or "").strip().strip('"').strip("'") for n in names]
        ok = all(v.lower() in _TRUTHY for v in values) if flag else all(values)
        if ok and label not in found:
            found[label] = {"adapter": label, "keys": list(names)}
    return list(found.values())


def detect_adapters(text: str | None) -> list[dict[str, Any]]:
    """Kimlik bilgisi görünen mesajlaşma bağdaştırıcıları. Yalnızca adapter adı ve ANAHTAR ADLARI döner;
    değerler yalnızca doluluk/bayrak kontrolü için okunur, hiçbir yere yazılmaz."""
    return _detect(lambda k: env_get(text, k))


def redact(line: str, secrets: list[str] | tuple[str, ...] = ()) -> str:
    for s in secrets:
        if s and len(s) >= 8 and s in line:
            line = line.replace(s, "••••")
    line = _SECRET_ASSIGN_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}••••", line)
    return _BEARER_RE.sub(r"\1••••", line)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _kill_on_close_job(proc: subprocess.Popen[bytes]) -> Any:
    """Windows: süreci 'iş kapanınca öldür' iş nesnesine bağlar; stüdyo çökse bile gateway yetim kalmaz.
    En iyi çaba — başarısız olursa None döner ve normal kapatma kancası yeterli olur."""
    if sys.platform != "win32" or not getattr(proc, "_handle", None):
        return None
    try:
        import ctypes
        from ctypes import wintypes

        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateJobObjectW.restype = wintypes.HANDLE
        k32.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
        k32.SetInformationJobObject.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
        k32.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)

        class Basic(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD),
                        ("SchedulingClass", wintypes.DWORD)]

        class Io(ctypes.Structure):
            _fields_ = [(n, ctypes.c_uint64) for n in ("r", "w", "o", "rb", "wb", "ob")]

        class Extended(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", Basic), ("IoInfo", Io), ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                        ("PeakJobMemoryUsed", ctypes.c_size_t)]

        job = k32.CreateJobObjectW(None, None)
        if not job:
            return None
        info = Extended()
        info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
            return None
        if not k32.AssignProcessToJobObject(job, wintypes.HANDLE(int(proc._handle))):  # type: ignore[attr-defined]
            return None
        return job  # tutamak açık kaldıkça bağ sürer; stüdyo süreci bitince işletim sistemi kapatır
    except Exception:  # noqa: BLE001 - en iyi çaba
        return None


class GatewayError(RuntimeError):
    pass


class GatewayManager:
    """Tek host gateway'in durumu, başlatılması ve durdurulması. Hermes dosyalarına yazmaz."""

    def __init__(self, settings: Any, data_dir: Path, *,
                 popen: Callable[..., Any] | None = None,
                 run_cmd: Callable[..., Any] | None = None,
                 http_transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.data_dir = Path(data_dir)
        self.log_path = self.data_dir / "gateway.log"
        self._popen = popen or subprocess.Popen
        self._run_cmd = run_cmd or subprocess.run
        self.http_transport = http_transport
        self.proc: Any = None
        self.started_at: str | None = None
        self.exit_code: int | None = None
        self.last_error: str | None = None
        self.tail: collections.deque[str] = collections.deque(maxlen=200)
        self._job: Any = None
        self._health: tuple[float, dict[str, Any]] | None = None
        self._op_lock = asyncio.Lock()
        self._busy: str | None = None
        self._user_stopped = False
        self._atexit_registered = False

    # ------------------------------------------------------------------ dosya sistemi (salt okunur)
    @property
    def home(self) -> Path:
        return Path(self.settings.get("hermes_home"))

    def profiles(self) -> list[tuple[str, Path]]:
        out = [("default", self.home)]
        pdir = self.home / "profiles"
        if pdir.is_dir():
            for p in sorted(pdir.iterdir()):
                if p.is_dir() and any((p / m).exists() for m in PROFILE_MARKERS):
                    out.append((p.name, p))
        return out

    def profile_dir(self, profile: str) -> Path:
        for name, d in self.profiles():
            if name == profile:
                return d
        raise KeyError(f"Profil yok: {profile}")

    def env_path(self, profile: str) -> Path:
        return self.profile_dir(profile) / ".env"

    def read_env(self, profile: str) -> str | None:
        try:
            path = self.env_path(profile)
        except KeyError:
            return None
        try:
            return path.read_text("utf-8") if path.is_file() else None
        except OSError:
            return None

    def profile_key(self, profile: str) -> str | None:
        """Profilin API anahtarı — yalnızca çalışma anında, bellek içinde kullanılmak üzere. Asla döndürme/loglama."""
        key = env_get(self.read_env(profile), "API_SERVER_KEY")
        return key if usable_key(key) else None

    def key_present(self, profile: str) -> bool:
        return self.profile_key(profile) is not None

    def port(self) -> int:
        raw = env_get(self.read_env("default"), "API_SERVER_PORT")
        if raw and raw.strip().isdigit():
            return int(raw.strip())
        try:
            cfg = yaml.safe_load((self.home / "config.yaml").read_text("utf-8", errors="replace")) or {}
        except (OSError, yaml.YAMLError):
            cfg = {}
        for path in (("platforms", "api_server", "port"), ("gateway", "api_server", "port"),
                     ("gateway", "platforms", "api_server", "port")):
            cur: Any = cfg
            for part in path:
                cur = cur.get(part) if isinstance(cur, dict) else None
            if isinstance(cur, int):
                return cur
        return DEFAULT_PORT

    def base_url(self) -> str:
        return f"http://{HOST}:{self.port()}"

    def profile_api_base(self, profile: str) -> str:
        """default için öneksiz /v1, adlandırılmış profil için /p/<profil>/v1 (araştırma §9.2-A)."""
        prefix = "" if profile in ("", "default") else f"/p/{profile}"
        return f"{self.base_url()}{prefix}/v1"

    def secrets(self) -> list[str]:
        return [k for k in (env_get(self.read_env(p), "API_SERVER_KEY") for p, _d in self.profiles()) if k]

    # ------------------------------------------------------------------ süreç durumu
    @property
    def managed(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def _reap(self) -> None:
        if self.proc is not None and self.proc.poll() is not None and self.exit_code is None:
            self.exit_code = int(self.proc.returncode)
            if self.exit_code != 0 and not self.last_error and not self._user_stopped:
                self.last_error = f"Gateway {self.exit_code} koduyla çıktı"

    async def health(self, force: bool = False) -> dict[str, Any]:
        now = time.monotonic()
        if not force and self._health and now - self._health[0] < 3:
            return self._health[1]
        result: dict[str, Any] = {"healthy": False}
        try:
            # trust_env=False: yerel gateway çağrıları asla sistem proxy'sine gitmez
            async with httpx.AsyncClient(transport=self.http_transport, timeout=1.5, trust_env=False) as client:
                resp = await client.get(f"{self.base_url()}/health")
            body = resp.json() if resp.status_code == 200 else {}
            if resp.status_code == 200 and body.get("status") == "ok":
                result = {"healthy": True, "version": body.get("version"), "platform": body.get("platform")}
            else:
                result = {"healthy": False, "error": f"/health → HTTP {resp.status_code}"}
        except (httpx.HTTPError, ValueError, OSError) as exc:
            result = {"healthy": False, "error": type(exc).__name__}
        self._health = (time.monotonic(), result)
        return result

    def _port_busy(self, port: int) -> bool:
        try:
            with socket.create_connection((HOST, port), timeout=0.4):
                return True
        except OSError:
            return False

    async def gateway_info(self, force: bool = False) -> dict[str, Any]:
        self._reap()
        h = await self.health(force=force)
        managed = self.managed
        root_key = self.key_present("default")
        exe = find_hermes(self.home)
        blocker = None
        if self._busy:
            blocker = "İşlem sürüyor…"
        elif not exe:
            blocker = f"hermes bulunamadı ({self.home / 'bin'})"
        elif not root_key:
            blocker = "Önce API sunucusunu etkinleştir (kök .env içinde API_SERVER_KEY yok)"
        elif h["healthy"]:
            blocker = "Gateway zaten çalışıyor" + ("" if managed else " (uygulama dışında başlatılmış)")
        elif managed:
            blocker = "Gateway başlıyor…"
        if managed and h["healthy"]:
            state = "running"
        elif h["healthy"]:
            state = "external"
        elif managed:
            state = "starting"
        elif self.last_error:
            state = "error"
        else:
            state = "stopped"
        return {
            "port": self.port(), "url": self.base_url(), "state": state, "busy": self._busy,
            "running": managed or h["healthy"], "healthy": h["healthy"], "managed": managed,
            "external": h["healthy"] and not managed, "version": h.get("version"),
            "pid": self.proc.pid if managed else None, "started_at": self.started_at if managed else None,
            "exit_code": self.exit_code, "error": translate(self.last_error) if self.last_error else None,
            "hermes_found": bool(exe),
            "can_start": blocker is None, "start_blocker": translate(blocker) if blocker else None, "can_stop": managed and not self._busy,
            "log_path": str(self.log_path), "command": "hermes -p default gateway run --external-supervisor",
        }

    async def status(self, force: bool = False) -> list[dict[str, Any]]:
        """ARCH sözleşmesi: profil başına [{profile, port, key_present, enabled_in_env, running, pid?, healthy, url, managed}]."""
        g = await self.gateway_info(force=force)
        out = []
        for name, d in self.profiles():
            text = self.read_env(name)
            key = self.key_present(name)
            if not key:
                state = "unconfigured"
            elif g["state"] in ("running", "external", "starting", "error"):
                state = g["state"]
            else:
                state = "configured"
            out.append({
                "profile": name, "port": g["port"], "key_present": key,
                "enabled_in_env": _env_truthy(text, "API_SERVER_ENABLED"),
                "running": g["running"], "pid": g["pid"], "healthy": g["healthy"], "managed": g["managed"],
                "url": self.profile_api_base(name), "env_path": str(d / ".env"), "env_exists": text is not None,
                "state": state, "adapters": [a["adapter"] for a in detect_adapters(text)],
            })
        return out

    async def overview(self, force: bool = False) -> dict[str, Any]:
        return {"gateway": await self.gateway_info(force=force), "profiles": await self.status()}

    async def available_for(self, profile: str) -> tuple[bool, str]:
        """API taşıması bu profil için kullanılabilir mi? (gateway sağlıklı + profil anahtarı var)"""
        if not self.key_present(profile):
            return False, f"'{profile}' profilinde API anahtarı yok"
        h = await self.health()
        if not h["healthy"]:
            return False, "Hermes gateway çalışmıyor"
        return True, "gateway sağlıklı ve profil anahtarı var"

    # ------------------------------------------------------------------ başlat / durdur
    def _argv(self, *args: str) -> list[str]:
        exe = find_hermes(self.home)
        if not exe:
            raise GatewayError(f"hermes bulunamadı ({self.home / 'bin'})")
        return [str(exe), "-p", "default", "gateway", *args]

    def _env(self) -> dict[str, str]:
        return child_env({
            "HERMES_HOME": str(self.home),
            "HERMES_GATEWAY_DETACHED": "1",
            "PYTHONIOENCODING": "utf-8",
            # Ollama beyinli API çalıştırmaları (provider: custom) bu adrese gider
            "CUSTOM_BASE_URL": str(self.settings.get("ollama_url")).rstrip("/") + "/v1",
        })

    def _log(self, line: str) -> None:
        self.tail.append(line)
        try:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            if self.log_path.is_file() and self.log_path.stat().st_size > 5_000_000:  # çalışırken de döndür
                self.log_path.replace(self.log_path.with_suffix(".log.1"))
            with self.log_path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass

    def _pump(self, stream: Any, secrets: list[str]) -> None:
        try:
            for raw in iter(stream.readline, b""):
                text = raw.decode("utf-8", "replace").rstrip("\r\n") if isinstance(raw, bytes) else str(raw).rstrip()
                if text.strip():
                    self._log(redact(text, secrets))
        except (OSError, ValueError):
            pass

    async def start(self) -> dict[str, Any]:
        async with self._op_lock:
            info = await self.gateway_info(force=True)
            if not info["can_start"]:
                raise GatewayError(info["start_blocker"] or "Gateway başlatılamıyor")
            port = info["port"]
            if await asyncio.to_thread(self._port_busy, port):
                raise GatewayError(f"Port {port} başka bir süreç tarafından kullanılıyor; gateway başlatılmadı")
            argv = self._argv("run", "--external-supervisor")
            flags = 0
            if sys.platform == "win32":
                flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
            self.exit_code, self.last_error, self._user_stopped = None, None, False
            try:  # basit döndürme: günlük 5 MB'ı aşarsa bir önceki kopya olarak sakla
                if self.log_path.is_file() and self.log_path.stat().st_size > 5_000_000:
                    self.log_path.replace(self.log_path.with_suffix(".log.1"))
            except OSError:
                pass
            if not self._atexit_registered:
                atexit.register(self._atexit)
                self._atexit_registered = True
            self._log(f"--- {_now_iso()} uygulama gateway'i başlatıyor: hermes -p default gateway run --external-supervisor")
            try:
                proc = self._popen(argv, cwd=str(self.settings.workdir), env=self._env(), stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=flags)
            except OSError as exc:
                self.last_error = f"Gateway başlatılamadı: {exc}"
                raise GatewayError(self.last_error) from exc
            self.proc, self.started_at = proc, _now_iso()
            self._job = _kill_on_close_job(proc)
            if getattr(proc, "stdout", None) is not None:
                threading.Thread(target=self._pump, args=(proc.stdout, self.secrets()), daemon=True).start()
            self._busy = "starting"
            try:
                for _ in range(24):  # ~6 sn sağlık bekle; olmazsa "başlıyor" durumunda döner
                    if proc.poll() is not None:
                        break
                    if (await self.health(force=True))["healthy"]:
                        break
                    await asyncio.sleep(0.25)
            finally:
                self._busy = None
            self._reap()
            return await self.gateway_info(force=True)

    async def stop(self) -> dict[str, Any]:
        async with self._op_lock:
            self._reap()
            if not self.managed:
                h = await self.health(force=True)
                if h["healthy"]:
                    raise GatewayError("Bu gateway uygulama dışında başlatılmış; uygulama onu durdurmaz")
                return await self.gateway_info(force=True)
            self._busy = "stopping"
            try:
                await asyncio.to_thread(self._stop_blocking, STOP_TIMEOUT_S)
            finally:
                self._busy = None
            return await self.gateway_info(force=True)

    def _stop_blocking(self, timeout: float) -> None:
        proc = self.proc
        if proc is None or proc.poll() is not None:
            return
        self._user_stopped = True
        self._log(f"--- {_now_iso()} uygulama gateway'i durduruyor: hermes -p default gateway stop")
        try:
            flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            self._run_cmd(self._argv("stop"), env=self._env(), capture_output=True, timeout=timeout,
                          creationflags=flags)
        except (OSError, subprocess.TimeoutExpired, GatewayError) as exc:
            self._log(f"gateway stop başarısız: {type(exc).__name__}")
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        if proc.poll() is None:
            self._log("gateway hâlâ çalışıyor → süreç ağacı sonlandırılıyor")
            kill_tree(proc)
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        self._reap()
        self._log(f"--- {_now_iso()} gateway durdu")

    async def shutdown(self) -> None:
        """Stüdyo kapanırken: yönettiği gateway'i durdurur (yetim süreç bırakmaz)."""
        if self.managed:
            await asyncio.to_thread(self._stop_blocking, 15.0)

    def _atexit(self) -> None:
        try:
            if self.proc is not None and self.proc.poll() is None:
                kill_tree(self.proc)
        except Exception:  # noqa: BLE001
            pass

    # ------------------------------------------------------------------ log
    def log_tail(self, lines: int = 200) -> list[str]:
        lines = max(1, min(int(lines), 500))
        if self.tail:
            return list(self.tail)[-lines:]
        try:
            text = self.log_path.read_text("utf-8", errors="replace").splitlines()[-lines:]
        except OSError:
            return []
        secrets = self.secrets()
        return [redact(t, secrets) for t in text]

    # ------------------------------------------------------------------ yan etkiler (önizleme uyarıları)
    def side_effects(self) -> dict[str, Any]:
        """Gateway başladığında ne çalışır? Yalnızca anahtar adları ve dosya varlığı okunur."""
        adapters: list[dict[str, Any]] = []
        hooks = 0
        cron_jobs = 0
        for name, d in self.profiles():
            for a in detect_adapters(self.read_env(name)):
                adapters.append({**a, "profile": name})
            hd = d / "hooks"
            try:
                if hd.is_dir():
                    hooks += sum(1 for h in hd.iterdir() if (h / "HOOK.yaml").is_file())
            except OSError:
                pass
            jobs = d / "cron" / "jobs.json"
            if jobs.is_file():
                try:
                    data = json.loads(jobs.read_text("utf-8"))
                    items = data.get("jobs", data) if isinstance(data, dict) else data
                    cron_jobs += len(items) if isinstance(items, (list, dict)) else 0
                except (OSError, ValueError):
                    pass
        env_adapters = [a["adapter"] for a in _detect(os.environ.get)]  # gateway stüdyonun ortamını devralır
        return {"adapters": adapters, "env_adapters": env_adapters, "hooks": hooks, "cron_jobs": cron_jobs,
                "profiles": [p for p, _d in self.profiles()]}
