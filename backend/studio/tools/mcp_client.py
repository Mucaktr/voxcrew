"""Elle yazılmış MCP istemcisi (JSON-RPC 2.0) — stdio ve streamable-HTTP taşımaları.

Yeni bağımlılık yok: stdio için `subprocess` + iş parçacıkları (olay döngüsü türünden bağımsız; Windows'ta
SelectorEventLoop'ta da çalışır), HTTP için zaten bağımlılık olan `httpx`.

Yaşam döngüsü: `initialize` (sürüm pazarlığı) → `notifications/initialized` → `tools/list` (sayfalı) → `tools/call`
→ kapatma. Stdio kapatma MCP belgesindeki sırayla: stdin kapatılır, kısa bekleme, ardından süreç ağacı
`connectors/base.kill_tree` ile öldürülür. HTTP kapatma: oturum kimliği varsa `DELETE` (405 normaldir).

Sürüm pazarlığı: istemci `PROTOCOL_VERSION` önerir; sunucunun yanıtladığı sürüm `SUPPORTED_VERSIONS` içindeyse ya da
daha yeni tarihliyse kabul edilir (tools/list ve tools/call sürümler arasında kararlıdır). Daha eski/bilinmeyen biçim
reddedilir. Durumsuz (stateless) sunucular: `initialize` yöntemi yoksa (-32601) ya da HTTP 404/405 dönerse istemci
el sıkışmasız moda geçer ve her istekte `MCP-Protocol-Version` başlığını gönderir.

Süreçler YALNIZCA çağıran istediğinde başlar (bir koşu adımı ya da kullanıcının "Yokla" tıklaması); stüdyo açılışında
hiçbir sunucu başlatılmaz.
"""

from __future__ import annotations

import asyncio
import itertools
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
from collections import deque
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from studio.connectors.base import group_popen_kwargs, kill_tree, mark_group

log = logging.getLogger("studio.tools.mcp")

PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CLIENT_INFO = {"name": "voxcrew-studio", "version": "1.0"}
MAX_LINE = 8 * 1024 * 1024          # stdio: tek JSON-RPC satırı üst sınırı
MAX_TOOL_PAGES = 20
MAX_RESULT_CHARS = 20_000
STDIO_EXIT_GRACE_S = 0.6

# Kabuk kullanmıyoruz; yine de komut/argümanda kabuk metakarakterleri açık bir yanlışlık ya da saldırı işaretidir.
SHELL_META = set(";&|<>`$\n\r\x00")
SERVER_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
MAX_ARGS = 40

# Resmî MCP SDK'larının stdio varsayılanı gibi: alt sürece yalnızca güvenli ortam değişkenleri geçer (sır sızmasın).
_SAFE_ENV_WIN = ("APPDATA", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE",
                 "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERNAME", "USERPROFILE", "PROGRAMFILES", "COMSPEC")
_SAFE_ENV_POSIX = ("HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER", "LANG", "LC_ALL", "TMPDIR")

# Karar 1 (2026-10-19): sunucu başına ortam değişkeni BAŞVURULARI (`env_refs`). Ayarda yalnızca ADLAR durur; değer
# sunucu başlarken VoxCrew'in kendi süreç ortamından kopyalanır ve hiçbir yere (ayar, dosya, günlük, olay, graf,
# API yanıtı) yazılmaz. Arayüz yalnızca "tanımlı / tanımlı değil" görür.
ENV_REF_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
MAX_ENV_REFS = 16
# Alt sürecin yükleyicisini, yorumlayıcısını, yollarını, ağ yönünü ya da araç yapılandırmasını değiştirebilen adlar ve
# VoxCrew'in kendi iç değişkenleri reddedilir (taban güvenli ortam zaten geçer; ezilemez).
DENIED_ENV_NAMES = frozenset({
    "PATH", "PATHEXT", "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "PYTHONUSERBASE", "PYTHONEXECUTABLE",
    "PYTHONIOENCODING", "PYTHONUTF8", "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "LD_PRELOAD",
    "LD_LIBRARY_PATH", "LD_AUDIT", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FRAMEWORK_PATH", "COMSPEC",
    "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "SHELL", "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "APPDATA",
    "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMDATA", "TEMP", "TMP", "TMPDIR", "USERNAME", "USER", "LOGNAME",
    "PERL5LIB", "PERL5OPT", "PERLLIB", "RUBYOPT", "RUBYLIB", "BASH_ENV", "ENV", "PROMPT_COMMAND", "IFS", "CDPATH",
    "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH", "PSMODULEPATH", "GCONV_PATH",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE", "CLAUDE_CONFIG_DIR", "DOCKER_HOST", "DOCKER_CONFIG", "KUBECONFIG", "EDITOR", "VISUAL",
    "PAGER", "BROWSER", "TERM", "LANG", "LC_ALL",
    #.NET / CLR profilleyici ve başlangıç kancaları, OpenSSL yapılandırması, Electron, Lua, PHP, Perl, R, zsh,
    # TLS anahtar günlüğü, Go/Rust araç zinciri, WSL köprüsü, kabuk istemi, AWS yapılandırma dosyaları
    "DOTNET_STARTUP_HOOKS", "COR_PROFILER", "COR_PROFILER_PATH", "COR_ENABLE_PROFILING", "CORECLR_PROFILER",
    "CORECLR_PROFILER_PATH", "CORECLR_ENABLE_PROFILING", "OPENSSL_CONF", "OPENSSL_ENGINES", "OPENSSL_MODULES",
    "ELECTRON_RUN_AS_NODE", "LUA_INIT", "LUA_PATH", "LUA_CPATH", "PHPRC", "PHP_INI_SCAN_DIR", "PERL5DB",
    "R_PROFILE", "R_PROFILE_USER", "R_ENVIRON", "R_ENVIRON_USER", "ZDOTDIR", "SSLKEYLOGFILE", "GOFLAGS", "GODEBUG",
    "GOROOT", "GOPATH", "GOTOOLCHAIN", "GOPROXY", "GOENV", "GOEXPERIMENT", "GOINSECURE", "GONOSUMDB", "GOPRIVATE",
    "GOSUMDB", "GOBIN", "GOCACHE", "GOMODCACHE", "GOOS", "GOARCH", "GOWORK", "RUSTC_WRAPPER", "RUSTFLAGS", "RUSTC", "CARGO_BUILD_RUSTC_WRAPPER",
    "WSLENV", "PROMPT", "AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "GNUPGHOME", "SSH_AUTH_SOCK",
    "SSH_ASKPASS", "SUDO_ASKPASS", "MAVEN_OPTS", "GRADLE_OPTS", "DOTNET_ROOT",
})
DENIED_ENV_PREFIXES = ("LD_", "DYLD_", "PYTHON", "NODE_", "NPM_CONFIG_", "GIT_", "UV_", "PIP_", "XDG_", "LC_",
                       "STUDIO_", "VOXCREW_", "HERMES_", "CODEX_", "BUN_", "DENO_", "CONDA_", "VIRTUAL_ENV",
                       "DOTNET_", "COR_", "CORECLR_", "COMPLUS_", "OPENSSL_", "ELECTRON_", "LUA_", "RUSTC", "CARGO_", "PERL", "PHP_", "R_PROFILE", "R_ENVIRON", "ZSH", "SSLKEYLOG")
DENIED_ENV_SUFFIXES = ("_HOME", "_CONFIG_DIR", "_CONFIG_PATH", "_PROXY", "_OPTIONS", "_OPTS", "_PRELOAD",
                       "_LIBRARY_PATH")
# Maskelemede kısa değerler metni bozmasın: bu uzunluğun altındaki değerler kayıt defterine alınmaz
MIN_MASK_LEN = 6


class McpError(RuntimeError):
    def __init__(self, message: str, code: int | None = None, data: Any = None):
        super().__init__(mask_secrets(message))  # karar 1: sunucu hata iletisi aktarılan değeri yansıtabilir
        self.code = code
        self.data = data


class McpTimeout(McpError):
    pass


# ---------------------------------------------------------------- yapılandırma doğrulama
def validate_server(raw: Any, *, existing_ids: set[str] | None = None) -> dict[str, Any]:
    """Ayar satırını doğrular ve normalize eder. Geçersizse ValueError (kullanıcıya dönen Türkçe ileti)."""
    if not isinstance(raw, dict):
        raise ValueError("Sunucu tanımı bir nesne olmalı")
    sid = str(raw.get("id") or "").strip()
    if not SERVER_ID_RE.match(sid):
        raise ValueError("Sunucu kimliği küçük harf, rakam, - ve _ içermeli (en çok 40 karakter)")
    if existing_ids is not None and sid in existing_ids:
        raise ValueError(f"Bu kimlikle bir sunucu zaten var: {sid}")
    transport = str(raw.get("transport") or "stdio").strip()
    out: dict[str, Any] = {"id": sid, "transport": transport, "enabled": bool(raw.get("enabled", True))}
    if raw.get("name"):
        out["name"] = str(raw["name"]).strip()[:80]
    if transport == "stdio":
        command = str(raw.get("command") or "").strip()
        if not command:
            raise ValueError("stdio sunucusu için komut gerekli")
        args = raw.get("args") or []
        if isinstance(args, str):
            raise ValueError("Argümanlar liste olmalı (her argüman ayrı öğe)")
        if not isinstance(args, (list, tuple)) or len(args) > MAX_ARGS:
            raise ValueError(f"Argümanlar en çok {MAX_ARGS} öğelik bir liste olmalı")
        args = [str(a) for a in args]
        for part in [command, *args]:
            if SHELL_META & set(part):
                raise ValueError("Komut ve argümanlarda kabuk metakarakterleri (; & | < > ` $ satır sonu) kullanılamaz")
            if len(part) > 1000:
                raise ValueError("Komut ya da argüman çok uzun")
        out.update(command=command, args=args)
        refs = validate_env_refs(raw.get("env_refs"))
        if refs:
            out["env_refs"] = refs
    elif transport == "http":
        url = str(raw.get("url") or "").strip()
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise ValueError("HTTP sunucusu adresi http:// ya da https:// ile başlamalı")
        if parts.username or parts.password:
            raise ValueError("Adreste kullanıcı adı/parola olamaz")
        if any(c in url for c in "\r\n\x00 "):
            raise ValueError("Adreste boşluk ya da kontrol karakteri olamaz")
        out["url"] = url
    else:
        raise ValueError("Taşıma 'stdio' ya da 'http' olmalı")
    if transport != "stdio" and raw.get("env_refs"):
        raise ValueError("Ortam değişkeni aktarımı yalnızca stdio sunucuları içindir")
    return out


def config_fingerprint(cfg: dict[str, Any]) -> str:
    """Yoklama önbelleği anahtarı: yapılandırma değişince önbellek geçersizleşir."""
    keys = ("transport", "command", "args", "url")
    data = {k: cfg.get(k) for k in keys}
    if cfg.get("env_refs"):  # yalnızca varsa: eski önbellek anahtarları değişmesin
        data["env_refs"] = sorted(cfg["env_refs"])
    return json.dumps(data, sort_keys=True, ensure_ascii=False)


def accept_version(server_version: Any) -> bool:
    v = str(server_version or "")
    if v in SUPPORTED_VERSIONS:
        return True
    # daha yeni tarihli sürüm: tools/list ve tools/call kararlı; el sıkışmayı reddetmek yerine kabul et
    return bool(_DATE_RE.match(v)) and v > SUPPORTED_VERSIONS[0]


def env_ref_problem(name: str) -> str | None:
    """Ad kabul edilemezse Türkçe neden; uygunsa None."""
    if not ENV_REF_RE.match(name):
        return f"Ortam değişkeni adı büyük harf, rakam ve _ içermeli (en çok 64 karakter): {name[:70]}"
    if name in DENIED_ENV_NAMES or name.startswith(DENIED_ENV_PREFIXES) or name.endswith(DENIED_ENV_SUFFIXES):
        return (f"{name} aktarılamaz: süreç yollarını, yükleyiciyi, ağ yönünü, araç yapılandırmasını ya da uygulamanın "
                "kendi ayarlarını değiştirebilir")
    return None


def validate_env_refs(raw: Any) -> list[str]:
    """`env_refs` listesini doğrular: yalnızca ADLAR (değer içeren `AD=...` biçimi reddedilir)."""
    if raw is None or raw == []:
        return []
    if isinstance(raw, str) or not isinstance(raw, (list, tuple)):
        raise ValueError("env_refs bir ad listesi olmalı")
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            raise ValueError("env_refs yalnızca ortam değişkeni adları içerebilir")
        name = item.strip()
        if "=" in name:
            raise ValueError("env_refs yalnızca ad alır; değer yazılmaz (AD=değer biçimi kabul edilmez)")
        problem = env_ref_problem(name)
        if problem:
            raise ValueError(problem)
        if name not in out:
            out.append(name)
    if len(out) > MAX_ENV_REFS:
        raise ValueError(f"En çok {MAX_ENV_REFS} ortam değişkeni aktarılabilir")
    return out


def _environ_lookup(name: str) -> str | None:
    """Süreç ortamından değer (Windows'ta ad büyük/küçük harf duyarsız). Değer çağırana döner, saklanmaz."""
    if sys.platform == "win32":
        upper = {k.upper(): k for k in os.environ}
        real = upper.get(name.upper())
        return os.environ.get(real) if real is not None else None
    return os.environ.get(name)


def env_status(names: list[str] | tuple[str, ...] | None) -> list[dict[str, Any]]:
    """Yalnızca "tanımlı mı" bilgisi (değer asla dönmez)."""
    return [{"name": n, "set": bool(_environ_lookup(n))} for n in names or ()]


# ---------------------------------------------------------------- maskeleme kayıt defteri
_SECRET_LOCK = threading.Lock()
_SECRET_VALUES: set[str] = set()


def register_secret(value: str | None) -> None:
    """Alt sürece aktarılan bir değer: bundan sonra `mask_secrets` (ve `changes.redact_text`) onu maskeler."""
    v = str(value or "").strip()
    if len(v) >= MIN_MASK_LEN:
        with _SECRET_LOCK:
            _SECRET_VALUES.add(v)


def registered_secrets() -> tuple[str, ...]:
    with _SECRET_LOCK:
        return tuple(sorted(_SECRET_VALUES, key=len, reverse=True))  # uzun önce: iç içe değerler tam maskelensin


def mask_secrets(text: str) -> str:
    """Aktarılan ortam değerlerini metinde tümüyle maskeler (son 4 hane bile gösterilmez).

 (kapsam sınırı): maskeleme birebir metin eşleşmesidir; sunucunun değeri dönüştürüp (ters çevirme, base64,
    parçalama) döndürmesini yakalayamaz. Güven sınırı kullanıcının seçtiği sunucudur: değeri alan program onu her
    biçimde sızdırabilir; maskeleme yalnız kazara yansımayı (hata, günlük, üst veri) önler."""
    out = str(text or "")
    if not _SECRET_VALUES:
        return out
    for v in registered_secrets():
        if v in out:
            out = out.replace(v, "••••")
    return out


def mask_deep(obj: Any, _depth: int = 0) -> Any:
    """sunucu üst verisi (araç adı, açıklama, şema, serverInfo, instructions) güvenilmezdir; içindeki her metin
    (sözlük anahtarları dahil) maskelenir. Kayıt defteri boşsa nesne aynen döner."""
    if not _SECRET_VALUES or _depth > 64:
        return obj
    if isinstance(obj, str):
        return mask_secrets(obj)
    if isinstance(obj, dict):
        return {(mask_secrets(k) if isinstance(k, str) else k): mask_deep(v, _depth + 1) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [mask_deep(v, _depth + 1) for v in obj]
    return obj


def register_env_refs(env_refs: list[str] | tuple[str, ...] | None) -> None:
    """yeniden başlatmadan sonra kayıt defteri boştur; yapılandırılmış `env_refs` adlarının GÜNCEL değerleri
    önbellek okunmadan önce kaydedilir (değer saklanmaz, yalnız maskeleme için bellekte tutulur)."""
    for name in env_refs or ():
        if isinstance(name, str) and not env_ref_problem(name):
            register_secret(_environ_lookup(name))


def child_env(env_refs: list[str] | tuple[str, ...] | None) -> dict[str, str]:
    """Taban güvenli ortam + YALNIZCA adı verilen (ve reddedilmeyen) değişkenler. Tanımsız ad sessizce atlanır."""
    env = safe_env()
    for name in env_refs or ():
        if env_ref_problem(name):  # savunma: ayar dosyası elle bozulduysa
            continue
        value = _environ_lookup(name)
        if value:
            register_secret(value)
            env[name] = value
    return env


def safe_env() -> dict[str, str]:
    names = _SAFE_ENV_WIN if sys.platform == "win32" else _SAFE_ENV_POSIX
    upper = {k.upper(): k for k in os.environ}
    env = {}
    for n in names:
        real = upper.get(n.upper())
        if real is not None and os.environ.get(real) and not os.environ[real].startswith("()"):
            env[real] = os.environ[real]
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    return env


def resolve_command(command: str) -> str:
    """Komutu PATH'te çözer (Windows'ta PATHEXT: `npx` → `npx.cmd`); `.exe` varsayılmaz."""
    if os.path.isabs(command) or os.sep in command or (os.altsep and os.altsep in command):
        if Path(command).is_file():
            return command
        raise McpError(f"Komut bulunamadı: {command}")
    found = shutil.which(command)
    if not found:
        raise McpError(f"Komut bulunamadı: {command} (PATH'te yok)")
    return found


def result_text(result: dict[str, Any] | None, limit: int = MAX_RESULT_CHARS) -> tuple[bool, str]:
    """tools/call sonucu → (başarılı mı, model için metin)."""
    result = result or {}
    parts: list[str] = []
    for item in result.get("content") or []:
        if not isinstance(item, dict):
            continue
        t = item.get("type")
        if t == "text":
            parts.append(str(item.get("text") or ""))
        elif t in ("image", "audio"):
            parts.append(f"[{t}: {item.get('mimeType') or '?'}]")
        elif t == "resource":
            res = item.get("resource") or {}
            parts.append(str(res.get("text") or res.get("uri") or "[resource]"))
        elif t == "resource_link":
            parts.append(f"[{item.get('name') or 'resource'}: {item.get('uri') or ''}]")
    if not parts and result.get("structuredContent") is not None:
        parts.append(json.dumps(result["structuredContent"], ensure_ascii=False))
    text = mask_secrets("\n".join(p for p in parts if p).strip())
    if len(text) > limit:
        text = text[:limit] + "\n…[kırpıldı]"
    return (not bool(result.get("isError")), text)


# ---------------------------------------------------------------- taşımalar
class _Transport:
    stateless = False
    version = PROTOCOL_VERSION

    async def request(self, method: str, params: dict[str, Any] | None, timeout: float) -> Any:  # pragma: no cover
        raise NotImplementedError

    async def notify(self, method: str, params: dict[str, Any] | None = None) -> None:  # pragma: no cover
        raise NotImplementedError

    async def close(self) -> None:  # pragma: no cover
        raise NotImplementedError

    def diagnostics(self) -> str:
        return ""


class StdioTransport(_Transport):
    """Satır sınırlı JSON-RPC (stdin/stdout); stderr günlük olarak son satırları tutulur."""

    def __init__(self, command: str, args: list[str], *, cwd: Path | None = None,
                 env: dict[str, str] | None = None):
        self.command, self.args = command, list(args)
        self.cwd, self.env = cwd, env
        self.proc: subprocess.Popen[bytes] | None = None
        self._ids = itertools.count(1)
        self._pending: dict[int, asyncio.Future[Any]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._wlock = threading.Lock()
        self._stderr: deque[str] = deque(maxlen=20)
        self._eof = False
        self._closed = False

    @property
    def pid(self) -> int | None:
        return self.proc.pid if self.proc else None

    def diagnostics(self) -> str:
        return mask_secrets(" | ".join(list(self._stderr)[-5:]))

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        exe = resolve_command(self.command)
        try:
            self.proc = subprocess.Popen([exe, *self.args], cwd=str(self.cwd) if self.cwd else None,
                                         env=self.env if self.env is not None else safe_env(),
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                         **group_popen_kwargs())
        except OSError as exc:
            raise McpError(f"Sunucu süreci başlatılamadı: {exc}") from exc
        mark_group(self.proc)
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

    # -------- iş parçacıkları
    def _read_stdout(self) -> None:
        assert self.proc and self.proc.stdout
        loop = self._loop
        try:
            for raw in iter(lambda: self.proc.stdout.readline(MAX_LINE), b""):  # type: ignore[union-attr]
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    self._stderr.append(f"(stdout, JSON değil) {line[:200]}")
                    continue
                if loop and not loop.is_closed():
                    loop.call_soon_threadsafe(self._dispatch, obj)
        except (OSError, ValueError):
            pass
        finally:
            if loop and not loop.is_closed():
                try:
                    loop.call_soon_threadsafe(self._on_eof)
                except RuntimeError:
                    pass

    def _read_stderr(self) -> None:
        assert self.proc and self.proc.stderr
        try:
            for raw in iter(self.proc.stderr.readline, b""):
                line = raw.decode("utf-8", "replace").rstrip()
                if line:
                    self._stderr.append(line[:300])
        except (OSError, ValueError):
            pass

    def _write(self, data: bytes) -> None:
        with self._wlock:
            if not self.proc or not self.proc.stdin or self.proc.stdin.closed:
                raise McpError("Sunucu süreci kapalı")
            try:
                self.proc.stdin.write(data)
                self.proc.stdin.flush()
            except (OSError, ValueError) as exc:
                raise McpError(f"Sunucuya yazılamadı: {exc}") from exc

    async def _send(self, obj: dict[str, Any]) -> None:
        data = (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        await asyncio.to_thread(self._write, data)

    # -------- olay döngüsü tarafı
    def _dispatch(self, obj: Any) -> None:
        if isinstance(obj, list):  # toplu ileti (eski sürümler)
            for o in obj:
                self._dispatch(o)
            return
        if not isinstance(obj, dict):
            return
        if "method" in obj and obj.get("id") is not None:
            # sunucudan istemciye istek: ping yanıtlanır, desteklenmeyenler -32601
            mid, method = obj["id"], obj.get("method")
            reply: dict[str, Any] = ({"jsonrpc": "2.0", "id": mid, "result": {}} if method == "ping" else
                                     {"jsonrpc": "2.0", "id": mid,
                                      "error": {"code": -32601, "message": f"Method not supported: {method}"}})
            asyncio.ensure_future(self._safe_send(reply))
            return
        if "method" in obj:
            return  # bildirim (günlük, ilerleme, list_changed): yok sayılır
        fut = self._pending.pop(obj.get("id"), None) if isinstance(obj.get("id"), int) else None
        if fut is None or fut.done():
            return
        if obj.get("error") is not None:
            e = obj["error"] if isinstance(obj["error"], dict) else {"message": str(obj["error"])}
            fut.set_exception(McpError(str(e.get("message") or "MCP hatası"), e.get("code"), e.get("data")))
        else:
            fut.set_result(obj.get("result"))

    async def _safe_send(self, obj: dict[str, Any]) -> None:
        try:
            await self._send(obj)
        except McpError:
            pass

    def _on_eof(self) -> None:
        self._eof = True
        tail = self.diagnostics()
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(McpError("Sunucu süreci kapandı" + (f": {tail}" if tail else "")))
        self._pending.clear()

    async def request(self, method: str, params: dict[str, Any] | None, timeout: float) -> Any:
        if self._eof or self._closed:
            raise McpError("Sunucu süreci kapalı" + (f": {self.diagnostics()}" if self.diagnostics() else ""))
        mid = next(self._ids)
        fut: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[mid] = fut
        msg: dict[str, Any] = {"jsonrpc": "2.0", "id": mid, "method": method}
        if params is not None:
            msg["params"] = params
        try:
            await self._send(msg)
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            await self._safe_send({"jsonrpc": "2.0", "method": "notifications/cancelled",
                                   "params": {"requestId": mid, "reason": "timeout"}})
            raise McpTimeout(f"MCP isteği zaman aşımına uğradı ({method}, {timeout:g} sn)") from None
        finally:
            self._pending.pop(mid, None)

    async def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        await self._send(msg)

    async def close(self) -> None:
        """stdin'i kapat → kısa bekle → süreç ağacını öldür → çıkışı bekle (yetim süreç kalmaz)."""
        if self._closed:
            return
        self._closed = True
        proc = self.proc
        if proc is None:
            return
        if sys.platform == "win32":
            # Windows'ta `taskkill /T` ağacı yalnızca lider yaşarken bulur: önce ağaç, sonra borular (yetim kalmasın)
            await asyncio.to_thread(self.kill)
        try:
            with self._wlock:
                if proc.stdin and not proc.stdin.closed:
                    proc.stdin.close()
        except OSError:
            pass
        if sys.platform != "win32":
            try:
                await asyncio.to_thread(proc.wait, STDIO_EXIT_GRACE_S)
            except subprocess.TimeoutExpired:
                pass
            await asyncio.to_thread(self.kill)  # POSIX: lider çıkmış olsa da süreç grubu (torunlar) killpg ile kapanır
        try:
            await asyncio.to_thread(proc.wait, 5)
        except subprocess.TimeoutExpired:  # pragma: no cover - kill_tree sonrası beklenmez
            log.warning("MCP sunucusu (pid %s) kapanmadı", proc.pid)

    def kill(self) -> None:
        """Eşzamanlı yedek: süreç ağacını hemen öldürür (POSIX'te grup; Windows'ta taskkill /T)."""
        proc = self.proc
        if proc is None:
            return
        try:
            kill_tree(proc, grace=0.5)
        except OSError:
            pass


class HttpTransport(_Transport):
    """Streamable HTTP: her ileti POST; yanıt application/json ya da text/event-stream (SSE)."""

    def __init__(self, url: str, *, transport: httpx.AsyncBaseTransport | None = None):
        self.url = url
        host = (urlsplit(url).hostname or "").lower()
        loopback = host in ("localhost", "::1") or host.startswith("127.")
        # trust_env=False yerelde: HTTP(S)_PROXY yerel MCP isteklerini dışarı yönlendirmesin
        self.client = httpx.AsyncClient(transport=transport, trust_env=not loopback, follow_redirects=False,
                                        timeout=httpx.Timeout(60.0, connect=10.0))
        self.session_id: str | None = None
        self.initialized = False
        self._ids = itertools.count(1)

    def _headers(self) -> dict[str, str]:
        h = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        if self.initialized or self.stateless:
            h["MCP-Protocol-Version"] = self.version
        if self.session_id:
            h["Mcp-Session-Id"] = self.session_id
        return h

    async def _post(self, msg: dict[str, Any], want_id: int | None) -> Any:
        async with self.client.stream("POST", self.url, json=msg, headers=self._headers()) as resp:
            sid = resp.headers.get("mcp-session-id")
            if sid and msg.get("method") == "initialize":
                self.session_id = sid
            if resp.status_code == 202 or want_id is None:
                await resp.aread()
                if resp.status_code >= 400:
                    raise McpError(f"MCP HTTP {resp.status_code}", code=resp.status_code)
                return None
            if resp.status_code >= 400:
                body = (await resp.aread()).decode("utf-8", "replace")[:300]
                if resp.status_code == 404 and self.session_id:
                    raise McpError("MCP oturumu sona erdi (404)", code=404)
                raise McpError(f"MCP HTTP {resp.status_code}: {body}", code=resp.status_code)
            ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
            if ctype == "text/event-stream":
                return await self._read_sse(resp, want_id)
            raw = await resp.aread()
            try:
                obj = json.loads(raw.decode("utf-8", "replace"))
            except json.JSONDecodeError as exc:
                raise McpError("MCP sunucusu geçersiz JSON döndürdü") from exc
            return self._pick(obj, want_id)

    def _pick(self, obj: Any, want_id: int) -> Any:
        items = obj if isinstance(obj, list) else [obj]
        for o in items:
            if isinstance(o, dict) and o.get("id") == want_id and "method" not in o:
                if o.get("error") is not None:
                    e = o["error"] if isinstance(o["error"], dict) else {"message": str(o["error"])}
                    raise McpError(str(e.get("message") or "MCP hatası"), e.get("code"), e.get("data"))
                return {"__result__": o.get("result")}
        return None

    async def _read_sse(self, resp: httpx.Response, want_id: int) -> Any:
        data: list[str] = []
        async for line in resp.aiter_lines():
            if line == "":
                if data:
                    payload, data = "\n".join(data), []
                    try:
                        obj = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(obj, dict) and "method" in obj and obj.get("id") is not None:
                        await self._answer_server_request(obj)
                        continue
                    hit = self._pick(obj, want_id)
                    if hit is not None:
                        return hit
                continue
            if line.startswith(":"):
                continue
            field, _, value = line.partition(":")
            if field == "data":
                data.append(value[1:] if value.startswith(" ") else value)
        return None

    async def _answer_server_request(self, obj: dict[str, Any]) -> None:
        method = obj.get("method")
        reply: dict[str, Any] = ({"jsonrpc": "2.0", "id": obj["id"], "result": {}} if method == "ping" else
                                 {"jsonrpc": "2.0", "id": obj["id"],
                                  "error": {"code": -32601, "message": f"Method not supported: {method}"}})
        try:
            await self._post(reply, None)
        except (McpError, httpx.HTTPError):
            pass

    async def request(self, method: str, params: dict[str, Any] | None, timeout: float) -> Any:
        mid = next(self._ids)
        msg: dict[str, Any] = {"jsonrpc": "2.0", "id": mid, "method": method}
        if params is not None:
            msg["params"] = params
        try:
            hit = await asyncio.wait_for(self._post(msg, mid), timeout=timeout)
        except asyncio.TimeoutError:
            raise McpTimeout(f"MCP isteği zaman aşımına uğradı ({method}, {timeout:g} sn)") from None
        except httpx.HTTPError as exc:
            raise McpError(f"MCP sunucusuna ulaşılamadı ({type(exc).__name__})") from exc
        if hit is None:
            raise McpError(f"MCP sunucusu {method} için yanıt vermedi")
        return hit["__result__"]

    async def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        try:
            await asyncio.wait_for(self._post(msg, None), timeout=10)
        except (asyncio.TimeoutError, httpx.HTTPError, McpError) as exc:
            log.debug("MCP bildirimi gönderilemedi: %s", exc)

    async def close(self) -> None:
        try:
            if self.session_id:
                await asyncio.wait_for(self.client.delete(self.url, headers=self._headers()), timeout=5)
        except (asyncio.TimeoutError, httpx.HTTPError):
            pass
        finally:
            await self.client.aclose()


# ---------------------------------------------------------------- istemci
class McpClient:
    """Tek MCP sunucusuna bağlı istemci. `async with connect(...) as c:` ya da `await c.close()`."""

    def __init__(self, transport: _Transport, *, timeout_s: float = 60.0, server_id: str = ""):
        self.t = transport
        self.timeout_s = max(1.0, float(timeout_s))
        self.server_id = server_id
        self.server_info: dict[str, Any] = {}
        self.capabilities: dict[str, Any] = {}
        self.instructions: str | None = None
        self.protocol_version: str | None = None
        self.stateless = False

    async def initialize(self) -> dict[str, Any]:
        params = {"protocolVersion": PROTOCOL_VERSION, "capabilities": {}, "clientInfo": CLIENT_INFO}
        try:
            res = await self.t.request("initialize", params, self.timeout_s)
        except McpError as exc:
            if exc.code in (-32601, 404, 405):
                # durumsuz sunucu: el sıkışma yok; sürüm her istekte başlıkla gider
                self.stateless = self.t.stateless = True
                self.protocol_version = PROTOCOL_VERSION
                return {"stateless": True}
            raise
        res = res or {}
        version = str(res.get("protocolVersion") or "")
        if not accept_version(version):
            raise McpError(f"Desteklenmeyen MCP protokol sürümü: {version or '?'}")
        self.protocol_version = version
        self.t.version = version
        self.server_info = mask_deep(res.get("serverInfo") or {})  # üst veri güvenilmez
        self.capabilities = res.get("capabilities") or {}
        self.instructions = mask_deep(res.get("instructions"))
        if isinstance(self.t, HttpTransport):
            self.t.initialized = True
        await self.t.notify("notifications/initialized")
        return res

    async def list_tools(self) -> list[dict[str, Any]]:
        tools: list[dict[str, Any]] = []
        cursor: str | None = None
        for _ in range(MAX_TOOL_PAGES):
            res = await self.t.request("tools/list", {"cursor": cursor} if cursor else {}, self.timeout_s) or {}
            for tool in res.get("tools") or []:
                if isinstance(tool, dict) and tool.get("name"):
                    tools.append({"name": str(tool["name"]), "description": str(tool.get("description") or "")[:2000],
                                  "inputSchema": tool.get("inputSchema") if isinstance(tool.get("inputSchema"), dict)
                                  else {"type": "object", "properties": {}},
                                  **({"annotations": tool["annotations"]} if isinstance(tool.get("annotations"), dict)
                                     else {})})
            cursor = res.get("nextCursor")
            if not cursor:
                break
        return mask_deep(tools)  # ad, açıklama ve şema aktarılan değeri yansıtabilir

    async def call_tool(self, name: str, arguments: dict[str, Any] | None = None,
                        timeout_s: float | None = None) -> dict[str, Any]:
        res = await self.t.request("tools/call", {"name": name, "arguments": arguments or {}},
                                   float(timeout_s or self.timeout_s))
        return res if isinstance(res, dict) else {"content": [], "isError": True}

    async def close(self) -> None:
        await self.t.close()

    def kill(self) -> None:
        if isinstance(self.t, StdioTransport):
            self.t.kill()

    @property
    def pid(self) -> int | None:
        return self.t.pid if isinstance(self.t, StdioTransport) else None

    def diagnostics(self) -> str:
        return self.t.diagnostics()

    async def __aenter__(self) -> "McpClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()


async def connect(cfg: dict[str, Any], *, timeout_s: float = 60.0, cwd: Path | None = None,
                  http_transport: httpx.AsyncBaseTransport | None = None,
                  env: dict[str, str] | None = None) -> McpClient:
    """Sunucuyu başlatır/bağlanır ve el sıkışmayı yapar. Hata olursa başlatılan süreç öldürülür."""
    cfg = validate_server(cfg)
    if cfg["transport"] == "stdio":
        if env is None and cfg.get("env_refs"):
            env = child_env(cfg["env_refs"])  # yalnızca adı verilen değişkenler; değerler saklanmaz
        t: _Transport = StdioTransport(cfg["command"], cfg.get("args") or [], cwd=cwd, env=env)
        client = McpClient(t, timeout_s=timeout_s, server_id=cfg["id"])
        try:
            await t.start()  # type: ignore[attr-defined]
            await client.initialize()
        except BaseException:
            await client.close()
            raise
        return client
    t = HttpTransport(cfg["url"], transport=http_transport)
    client = McpClient(t, timeout_s=timeout_s, server_id=cfg["id"])
    try:
        await client.initialize()
    except BaseException:
        await client.close()
        raise
    return client
