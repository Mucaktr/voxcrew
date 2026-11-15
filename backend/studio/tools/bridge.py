"""Araç köprüsü: ayardaki MCP sunucuları + ajan politikası → adım başına araç oturumu.

Bağlayıcılar köprüyü motor değişikliği olmadan bulur: `tools/api.py:start` stüdyonun köprüsünü
`register(bridge)` ile kaydeder; `get_bridge(settings)` aynı Settings nesnesine kayıtlı köprüyü (yoksa geçici bir
köprü) döndürür. Ajan politikası `Invocation.agent` (Agent düğümü props'u, `tools` alanı dahil) üzerinden okunur.

Süreç kuralı (otomatik başlatma yok):
- stdio sunucusu yalnızca bir koşu adımı ona gerçekten ihtiyaç duyduğunda başlar: araç listesi yoklama önbelleğinde
  varsa ilk araç çağrısında, yoksa adım başında (listeyi almak için); adım bitince `StepSession.close` öldürür;
- "Yokla" (probe) kullanıcı tıklamasıdır: başlat → listele → durdur; sonuç önbelleğe (veri dizini) yazılır.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from studio.tools import policy as P
from studio.tools.mcp_client import (McpClient, McpError, config_fingerprint, connect, env_status, mask_deep,
                                     mask_secrets, register_env_refs, result_text, validate_server)

log = logging.getLogger("studio.tools.bridge")

CACHE_FILE = "mcp_tools_cache.json"
FN_NAME_MAX = 64


@dataclass
class ToolSpec:
    server: str
    tool: str
    fn: str                      # modele verilen işlev adı (Ollama `tools`)
    description: str
    schema: dict[str, Any]
    annotations: dict[str, Any] | None = None  # MCP `readOnlyHint` / `idempotentHint` / `destructiveHint`

    @property
    def name(self) -> str:       # politika ve arayüz adı
        return f"{self.server}:{self.tool}"


# stüdyonun yerleşik araç adları (`tools/outputs.READ_FN`, `tools/builtin_skill.SKILL_FN`) dış sunucu
# araçlarına verilmez
RESERVED_FNS = frozenset({"studio__artifact_read", "studio__skill_load"})
# yerleşik araçların görünen adları (onay kartı, iz). Dış sunucu aracının işlev adı ya da görünen adı bunlardan
# biriyle (büyük/küçük harf, ayraç ve `_N` soneki fark etmeksizin) çakışırsa araç hiç sunulmaz ve çözülmez.
RESERVED_TOOL_NAMES = frozenset({"studio:artifact_read", "studio:skill_load"})


def _builtin_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").casefold())


_RESERVED_KEYS = frozenset({_builtin_key(n) for n in (*RESERVED_FNS, *RESERVED_TOOL_NAMES)})


def collides_builtin(server: str, tool: str) -> bool:
    """dış araç yerleşik bir aracın adını (işlev ya da görünen ad) taşıyor mu."""
    return (_builtin_key(f"{server}{tool}") in _RESERVED_KEYS
            or _builtin_key(re.sub(r"_\d+$", "", f"{server}{tool}")) in _RESERVED_KEYS)


def spec_collides(t: Any) -> bool:
    """Araç tanımı (ToolSpec ya da benzeri) yerleşik adla çakışıyor mu: sunucu+araç, görünen ad ya da işlev adı."""
    server, tool = getattr(t, "server", None), getattr(t, "tool", None)
    if isinstance(server, str) and isinstance(tool, str) and collides_builtin(server, tool):
        return True
    name = getattr(t, "name", None)
    return isinstance(name, str) and bool(name) and collides_builtin("", name)


def _fn_name(server: str, tool: str, taken: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9_-]", "_", f"{server}__{tool}")[:FN_NAME_MAX] or "tool"
    name, n = base, 2
    while name in taken or name in RESERVED_FNS:
        suffix = f"_{n}"
        name, n = base[:FN_NAME_MAX - len(suffix)] + suffix, n + 1
    taken.add(name)
    return name


class StepSession:
    """Tek adımın araç oturumu: sunucular gerekince açılır, `close()` hepsini kapatır (stdio süreçleri öldürülür)."""

    def __init__(self, bridge: "ToolBridge", policy: P.ToolPolicy, *, run_id: str = "", step_id: str = ""):
        self.bridge = bridge
        self.policy = policy
        self.run_id, self.step_id = run_id, step_id
        self.tools: list[ToolSpec] = []
        self.errors: list[str] = []
        self.clients: dict[str, McpClient] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._closed = False

    @property
    def timeout_s(self) -> float:
        return float(self.bridge.tools_settings().get("call_timeout_s") or 60)

    async def prepare(self) -> list[ToolSpec]:
        """Ajanın sunucularındaki izinli araçları toplar (önbellek varsa süreç başlatmadan)."""
        taken: set[str] = set()
        for sid in self.policy.servers:
            cfg = self.bridge.server(sid)
            if cfg is None:
                continue
            listed = self.bridge.cached_tools(sid)
            if listed is None:
                try:
                    client = await self._client(sid)
                    listed = await client.list_tools()
                    self.bridge.remember(sid, cfg, ok=True, tools=listed, client=client)
                except (McpError, OSError) as exc:
                    self.errors.append(f"{sid}: {exc}")
                    self.bridge.remember(sid, cfg, ok=False, error=str(exc))
                    continue
            for t in listed:
                name = f"{sid}:{t['name']}"
                if not self.policy.allowed(name):
                    continue
                if collides_builtin(sid, str(t["name"])):  # yerleşik ada bürünen dış araç sunulmaz
                    log.warning("MCP aracı yerleşik adla çakışıyor, sunulmadı: %s", name[:120])
                    continue
                self.tools.append(ToolSpec(sid, t["name"], _fn_name(sid, t["name"], taken),
                                           str(t.get("description") or ""),
                                           t.get("inputSchema") or {"type": "object", "properties": {}},
                                           t.get("annotations") if isinstance(t.get("annotations"), dict) else None))
        return self.tools

    def ollama_tools(self) -> list[dict[str, Any]]:
        # modele giden yük de maskelenir (önbellek eski bir sürümden kalmış olabilir)
        return mask_deep([{"type": "function", "function": {"name": t.fn, "description": t.description[:1000] or t.name,
                                                            "parameters": t.schema}} for t in self.tools])

    def resolve(self, fn_name: str) -> ToolSpec | None:
        """İşlev adı (ya da görünen ad) → araç. yerleşik adla çakışan dış araç hiçbir adla çözülmez."""
        return next((t for t in self.tools if (t.fn == fn_name or t.name == fn_name)
                     and not collides_builtin(t.server, t.tool) and t.fn not in RESERVED_FNS), None)

    async def _client(self, sid: str) -> McpClient:
        if self._closed:
            raise McpError("Araç oturumu kapalı")
        lock = self._locks.setdefault(sid, asyncio.Lock())
        async with lock:
            if sid in self.clients:
                return self.clients[sid]
            cfg = self.bridge.server(sid)
            if cfg is None:
                raise McpError(f"Sunucu tanımlı değil ya da kapalı: {sid}")
            client = await self.bridge.connect(cfg)
            self.clients[sid] = client
            self.bridge.active[sid] = self.bridge.active.get(sid, 0) + 1
            return client

    async def call(self, spec: ToolSpec, arguments: dict[str, Any]) -> tuple[bool, str]:
        """Aracı çağırır; her hata (zaman aşımı, süreç çöküşü) modele okunabilir bir hata metni olarak döner."""
        if not self.policy.allowed(spec.name):  # savunma: liste dışı ad ya da sonradan değişen politika
            return False, f"Araç politika gereği kapalı: {spec.name}"
        try:
            client = await self._client(spec.server)
            res = await client.call_tool(spec.tool, arguments, timeout_s=self.timeout_s)
        except McpError as exc:
            return False, f"Araç hatası ({spec.name}): {exc}"
        except OSError as exc:
            return False, f"Araç hatası ({spec.name}): {exc}"
        # 20 000 karakterlik sessiz kesme yok; büyük sonuç ToolLoop'ta artefakt + kesit olur (`tools/outputs.py`)
        from studio.tools.outputs import STORE_MAX  # noqa: PLC0415
        return result_text(res, limit=STORE_MAX + 1)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        clients, self.clients = self.clients, {}
        for sid, client in clients.items():
            try:
                await client.close()
            except Exception as exc:  # noqa: BLE001 - kapatma hatası adımı bozmasın; süreç yine de öldürülür
                log.warning("MCP sunucusu %s kapatılamadı: %s", sid, exc)
                client.kill()
            finally:
                n = self.bridge.active.get(sid, 1) - 1
                if n > 0:
                    self.bridge.active[sid] = n
                else:
                    self.bridge.active.pop(sid, None)

    def kill(self) -> None:
        """Eşzamanlı yedek (iptal sırasında await mümkün değilse)."""
        for client in self.clients.values():
            client.kill()


class ToolBridge:
    def __init__(self, settings: Any, *, http_transport: httpx.AsyncBaseTransport | None = None,
                 cache_dir: Path | None = None):
        self.settings = settings
        self.http_transport = http_transport
        self.cache_dir = cache_dir or (Path(settings.path).parent if getattr(settings, "path", None) else None)
        self.cache: dict[str, dict[str, Any]] = {}
        self.active: dict[str, int] = {}
        self.probing: set[str] = set()
        self.bus: Any = None          # api.start() bağlar (guard.flagged vb. olaylar için)
        self._load_cache()

    def publish(self, type_: str, **data: Any) -> None:
        """Olay yayını (veri yolu bağlı değilse sessiz); yayın hatası çağıranı asla bozmaz."""
        if self.bus is None:
            return
        try:
            self.bus.publish(type_, **data)
        except Exception as exc:  # noqa: BLE001
            log.warning("olay yayınlanamadı (%s): %s", type_, exc)

    # ------------------------------------------------------------ ayar
    def tools_settings(self) -> dict[str, Any]:
        ts = self.settings.get("tools", None) if self.settings is not None else None
        return ts if isinstance(ts, dict) else {}

    def raw_servers(self) -> list[dict[str, Any]]:
        return [s for s in self.tools_settings().get("mcp_servers") or [] if isinstance(s, dict)]

    def servers(self) -> list[dict[str, Any]]:
        """Ayardaki sunucular; geçersiz satırlar `invalid` ile işaretlenir (genel ayar API'sinden yazılmış olabilir)."""
        out = []
        for raw in self.raw_servers():
            try:
                out.append(validate_server(raw))
            except ValueError as exc:
                out.append({"id": str(raw.get("id") or "?"), "transport": raw.get("transport"),
                            "enabled": False, "invalid": str(exc)})
        return out

    def server(self, sid: str) -> dict[str, Any] | None:
        """Etkin ve geçerli sunucu yapılandırması (değilse None)."""
        for cfg in self.servers():
            if cfg.get("id") == sid and cfg.get("enabled") and not cfg.get("invalid"):
                return cfg
        return None

    def policy_for(self, agent: dict[str, Any] | None) -> P.ToolPolicy:
        ts = dict(self.tools_settings())
        ts["mcp_servers"] = [s for s in self.servers() if not s.get("invalid")]
        return P.effective(ts, agent)

    def max_rounds(self) -> int:
        try:
            return max(1, min(50, int(self.tools_settings().get("max_rounds") or 6)))
        except (TypeError, ValueError):
            return 6

    # ------------------------------------------------------------ bağlantı ve önbellek
    async def connect(self, cfg: dict[str, Any]) -> McpClient:
        cwd = None
        try:
            cwd = self.settings.workdir
        except (AttributeError, KeyError, OSError, TypeError):
            pass
        return await connect(cfg, timeout_s=float(self.tools_settings().get("call_timeout_s") or 60), cwd=cwd,
                             http_transport=self.http_transport)

    def cached_tools(self, sid: str) -> list[dict[str, Any]] | None:
        cfg = self.server(sid)
        entry = self.cache.get(sid)
        if not cfg or not entry or not entry.get("ok") or entry.get("fingerprint") != config_fingerprint(cfg):
            return None
        return list(mask_deep(entry.get("tools") or []))

    def remember(self, sid: str, cfg: dict[str, Any], *, ok: bool, tools: list[dict[str, Any]] | None = None,
                 error: str | None = None, client: McpClient | None = None) -> dict[str, Any]:
        # önbelleğe (diske) yalnız maskelenmiş üst veri yazılır
        entry = {"ok": ok, "fingerprint": config_fingerprint(cfg), "probed_at": time.time(),
                 "tools": mask_deep(tools or []), "error": mask_secrets(error or "")[:500] or None}
        if client is not None:
            entry.update(server_info=mask_deep(client.server_info), protocol_version=client.protocol_version,
                         stateless=client.stateless)
        if not ok and sid in self.cache and self.cache[sid].get("ok"):
            entry["tools"] = self.cache[sid].get("tools") or []  # son başarılı liste görünür kalsın
        self.cache[sid] = entry
        self._save_cache()
        return entry

    def _cache_path(self) -> Path | None:
        return self.cache_dir / CACHE_FILE if self.cache_dir else None

    def _load_cache(self) -> None:
        path = self._cache_path()
        if not path or not path.is_file():
            return
        try:
            data = json.loads(path.read_text("utf-8"))
            if isinstance(data, dict):
                self.cache = {k: v for k, v in data.items() if isinstance(v, dict)}
        except (OSError, json.JSONDecodeError):
            return
        # eski sürümün maskesiz yazdığı değerler — güncel env_refs değerlerini kaydet, önbelleği maskele, yaz
        try:
            for raw in self.raw_servers():
                refs = raw.get("env_refs")
                if isinstance(refs, list):
                    register_env_refs([str(x) for x in refs])
        except Exception as exc:  # noqa: BLE001 - ayar okunamazsa önbellek yine maskelenir (kayıtlı değerlerle)
            log.warning("MCP env_refs kaydedilemedi: %s", exc)
        masked = mask_deep(self.cache)
        if masked != self.cache:
            self.cache = masked
            self._save_cache()

    def _save_cache(self) -> None:
        path = self._cache_path()
        if not path:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.cache, ensure_ascii=False, indent=1), "utf-8")
            tmp.replace(path)
        except OSError as exc:
            log.warning("MCP araç önbelleği yazılamadı: %s", exc)

    def forget(self, sid: str) -> None:
        if self.cache.pop(sid, None) is not None:
            self._save_cache()

    async def probe(self, sid: str) -> dict[str, Any]:
        """Kullanıcı tıklaması: başlat → araçları listele → durdur. Sonuç önbelleğe yazılır."""
        cfg = next((c for c in self.servers() if c.get("id") == sid), None)
        if cfg is None:
            raise KeyError(sid)
        if cfg.get("invalid"):
            raise ValueError(cfg["invalid"])
        if sid in self.probing:
            raise RuntimeError("Bu sunucu zaten yoklanıyor")
        self.probing.add(sid)
        started = time.monotonic()
        client: McpClient | None = None
        try:
            client = await self.connect(cfg)
            tools = await client.list_tools()
            entry = self.remember(sid, cfg, ok=True, tools=tools, client=client)
        except (McpError, OSError) as exc:
            diag = client.diagnostics() if client else ""
            entry = self.remember(sid, cfg, ok=False, error=str(exc) + (f" — {diag}" if diag else ""))
        finally:
            if client is not None:
                await client.close()
            self.probing.discard(sid)
        return {**entry, "ms": int((time.monotonic() - started) * 1000)}

    def open_session(self, agent: dict[str, Any] | None, *, run_id: str = "", step_id: str = "") -> StepSession:
        return StepSession(self, self.policy_for(agent), run_id=run_id, step_id=step_id)

    def status(self) -> list[dict[str, Any]]:
        out = []
        for cfg in self.servers():
            sid = cfg.get("id", "?")
            entry = self.cache.get(sid) or {}
            fresh = bool(entry) and not cfg.get("invalid") and entry.get("fingerprint") == config_fingerprint(cfg)
            state = ("invalid" if cfg.get("invalid") else "disabled" if not cfg.get("enabled") else
                     "probing" if sid in self.probing else "running" if self.active.get(sid) else
                     "ok" if fresh and entry.get("ok") else "error" if fresh and not entry.get("ok") else "unknown")
            out.append(mask_deep({**cfg, "status": state, "active_sessions": self.active.get(sid, 0),
                        # karar 1: yalnızca "tanımlı mı" (değer asla dönmez)
                        "env_status": env_status(cfg.get("env_refs")) if cfg.get("env_refs") else [],
                        "tools": [self._tool_row(sid, t) for t in (entry.get("tools") or [])] if fresh else [],
                        "probed_at": entry.get("probed_at") if fresh else None,
                        "error": entry.get("error") if fresh else None,
                        "server_info": entry.get("server_info") if fresh else None,
                        "protocol_version": entry.get("protocol_version") if fresh else None,
                        "stateless": entry.get("stateless") if fresh else None}))
        return out

    def _tool_row(self, sid: str, t: dict[str, Any]) -> dict[str, Any]:
        """Araçlar sayfası satırı. yan etki sınıfı (etkin), kaynağı ve kullanıcının işareti."""
        from studio.tools.loop import declared_by_server, tool_class  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın
        name = f"{sid}:{t.get('name')}"
        ann = t.get("annotations") if isinstance(t.get("annotations"), dict) else None
        user = (self.tools_settings().get("tool_classes") or {}).get(name)
        hints = {k: ann[k] for k in ("readOnlyHint", "idempotentHint", "destructiveHint") if isinstance(ann.get(k), bool)}             if ann else {}
        return {"name": t.get("name"), "description": str(t.get("description") or "")[:300],
                "class": tool_class(self.settings, name, ann), "user_class": user if isinstance(user, str) else None,
                "hints": hints or None,
                # sunucu beyanından çıkan sınıf (kullanıcı işareti hariç; çelişkide yan etkili) ve sunucu bir
                # şey beyan etti mi (etmediyse arayüz "beyan yok — yan etkili sayılır" der, "sunucunun beyanı" değil)
                "declared": tool_class(None, name, ann), "declared_by_server": declared_by_server(ann)}

    def known_tool_names(self, servers: list[str]) -> list[str]:
        names = []
        for sid in servers:
            for t in self.cached_tools(sid) or []:
                names.append(f"{sid}:{t['name']}")
        return names


# ---------------------------------------------------------------- kayıt (bağlayıcılar için arama yolu)
_REGISTRY: list[ToolBridge] = []


def register(bridge: ToolBridge) -> ToolBridge:
    unregister(bridge)
    _REGISTRY.append(bridge)
    return bridge


def unregister(bridge: ToolBridge) -> None:
    while bridge in _REGISTRY:
        _REGISTRY.remove(bridge)


def get_bridge(settings: Any) -> ToolBridge:
    """Aynı Settings nesnesine kayıtlı köprü; yoksa ayardan geçici köprü (testler, uygulama dışı kullanım)."""
    for b in reversed(_REGISTRY):
        if b.settings is settings:
            return b
    return ToolBridge(settings)
