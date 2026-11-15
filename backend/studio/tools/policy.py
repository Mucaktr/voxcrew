"""Araç izin politikası — saf fonksiyonlar, G/Ç yok.

Araç adı `sunucu:araç` biçimindedir (ör. `github:create_issue`). Kalıplar `fnmatch` (büyük/küçük harf duyarlı):
  - `github:*` github sunucusunun tüm araçları
  - `*:delete_*` tüm sunuculardaki delete_ ile başlayan araçlar
  - `github` iki nokta yoksa: sunucu adı YA DA araç adıyla eşleşir (`github:*` ∪ `*:github`)

Etkin politika = ayar (`tools.allow/deny`) ∪ ajan (`Agent.tools.allow/deny`):
  - deny kazanır (bir araç hem allow hem deny ile eşleşirse reddedilir);
  - allow boşsa ajanın etkin sunucularının tüm araçları izinlidir;
  - ajanın sunucuları = `Agent.tools.mcp` (sunucu kimliği ya da kalıbı) ∩ ayarda etkin sunucular. Ajan sunucu
    atanmamışsa MCP aracı yoktur (açık katılım: kimse habersiz araç almaz, hiçbir süreç başlatılmaz).
  - `Agent.tools.auto_approve`: onay kartı istenmeden çalışabilecek araç kalıpları (varsayılan boş = her çağrı onaylı).

Beyin bazında uygulanma (`ENFORCEMENT`): Ollama (stüdyo araç döngüsü) ve Claude Code (`--disallowedTools`) uygular;
Codex CLI'nin araç başına bayrağı yoktur → "uygulanmaz" olarak gösterilir.
"""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field
from typing import Any, Iterable

SERVER_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
PATTERN_RE = re.compile(r"^[A-Za-z0-9_.:*?\[\]/-]{1,120}$")
MAX_PATTERNS = 100

# beyin → politika uygulanıyor mu (arayüz ve API bu tabloyu gösterir; yalan söylememek için tek kaynak)
ENFORCEMENT: dict[str, dict[str, Any]] = {
    "ollama": {"enforced": True, "how": "studio_loop"},
    "claude": {"enforced": True, "how": "claude_flags"},
    "codex": {"enforced": False, "how": "none"},
    "hermes": {"enforced": False, "how": "none"},
    "openai_compat": {"enforced": False, "how": "no_tools"},
}


def _clean_list(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        return []
    out: list[str] = []
    for v in value:
        s = str(v or "").strip()
        if s and s not in out:
            out.append(s)
    return out[:MAX_PATTERNS]


def validate_patterns(value: Any, field_name: str = "allow") -> list[str]:
    """Kullanıcı girdisi kalıp listesini doğrular; geçersizse ValueError (Türkçe ileti)."""
    if value is None:
        return []
    if not isinstance(value, (list, tuple)):
        raise ValueError(f"'{field_name}' bir liste olmalı")
    out = _clean_list(value)
    if len(value) > MAX_PATTERNS:
        raise ValueError(f"'{field_name}' en çok {MAX_PATTERNS} kalıp alabilir")
    for p in out:
        if not PATTERN_RE.match(p):
            raise ValueError(f"Geçersiz araç kalıbı: {p}")
    return out


def split_name(name: str) -> tuple[str, str]:
    server, sep, tool = str(name).partition(":")
    return (server, tool) if sep else ("", server)


def matches(pattern: str, name: str) -> bool:
    """`sunucu:araç` adı kalıpla eşleşiyor mu (iki noktasız kalıp sunucu ya da araç adına bakar)."""
    if ":" in pattern:
        return fnmatch.fnmatchcase(name, pattern)
    server, tool = split_name(name)
    return fnmatch.fnmatchcase(server, pattern) or fnmatch.fnmatchcase(tool, pattern)


def any_match(patterns: Iterable[str], name: str) -> bool:
    return any(matches(p, name) for p in patterns)


@dataclass(frozen=True)
class ToolPolicy:
    allow: tuple[str, ...] = ()
    deny: tuple[str, ...] = ()
    servers: tuple[str, ...] = ()          # ajanın etkin MCP sunucuları (ayarda tanımlı + etkin + ajana atanmış)
    auto_approve: tuple[str, ...] = ()
    agent_allow: tuple[str, ...] = ()
    agent_deny: tuple[str, ...] = ()
    agent_mcp: tuple[str, ...] = ()
    unknown_servers: tuple[str, ...] = field(default=())  # ajana atanmış ama ayarda olmayan/kapalı sunucular

    def allowed(self, name: str) -> bool:
        """Araç bu ajana açık mı: sunucusu ajanın sunucularında, deny ile eşleşmiyor, allow boş ya da eşleşiyor."""
        server, _tool = split_name(name)
        if server and server not in self.servers:
            return False
        if any_match(self.deny, name):
            return False
        return not self.allow or any_match(self.allow, name)

    def needs_approval(self, name: str) -> bool:
        return not any_match(self.auto_approve, name)

    @property
    def restricted(self) -> bool:
        """Politika bir şeyi sınırlıyor mu (CLI beyinlerinde uyarı göstermek için)."""
        return bool(self.allow or self.deny)

    def to_dict(self) -> dict[str, Any]:
        return {"allow": list(self.allow), "deny": list(self.deny), "servers": list(self.servers),
                "auto_approve": list(self.auto_approve),
                "agent": {"allow": list(self.agent_allow), "deny": list(self.agent_deny), "mcp": list(self.agent_mcp),
                          "auto_approve": list(self.auto_approve)},
                "unknown_servers": list(self.unknown_servers)}


def agent_tools(agent: dict[str, Any] | None) -> dict[str, list[str]]:
    raw = (agent or {}).get("tools")
    raw = raw if isinstance(raw, dict) else {}
    return {"allow": _clean_list(raw.get("allow")), "deny": _clean_list(raw.get("deny")),
            "mcp": _clean_list(raw.get("mcp")), "auto_approve": _clean_list(raw.get("auto_approve"))}


def enabled_servers(tools_settings: dict[str, Any] | None) -> list[str]:
    out = []
    for s in (tools_settings or {}).get("mcp_servers") or []:
        if isinstance(s, dict) and s.get("enabled", True) and SERVER_ID_RE.match(str(s.get("id") or "")):
            out.append(str(s["id"]))
    return out


def effective(tools_settings: dict[str, Any] | None, agent: dict[str, Any] | None) -> ToolPolicy:
    """Ayar ∪ ajan katmanlı etkin politika."""
    ts = tools_settings or {}
    at = agent_tools(agent)
    enabled = enabled_servers(ts)
    servers: list[str] = []
    unknown: list[str] = []
    for pat in at["mcp"]:
        hits = [s for s in enabled if fnmatch.fnmatchcase(s, pat)]
        if not hits and not any(c in pat for c in "*?["):
            unknown.append(pat)
        servers += [h for h in hits if h not in servers]
    allow = _clean_list(ts.get("allow")) + [p for p in at["allow"] if p not in _clean_list(ts.get("allow"))]
    deny = _clean_list(ts.get("deny")) + [p for p in at["deny"] if p not in _clean_list(ts.get("deny"))]
    return ToolPolicy(allow=tuple(allow), deny=tuple(deny), servers=tuple(servers),
                      # TRUST güvenli mod: tools.require_approval_all → ajanın auto_approve kalıpları yok sayılır
                      auto_approve=() if ts.get("require_approval_all") is True else tuple(at["auto_approve"]),
                      agent_allow=tuple(at["allow"]),
                      agent_deny=tuple(at["deny"]), agent_mcp=tuple(at["mcp"]), unknown_servers=tuple(unknown))


def filter_tools(policy: ToolPolicy, names: Iterable[str]) -> list[str]:
    return [n for n in names if policy.allowed(n)]


def enforcement(connector: str) -> dict[str, Any]:
    return dict(ENFORCEMENT.get(connector, {"enforced": False, "how": "none"}))


# ---------------------------------------------------------------- Claude Code eşlemesi
_CLAUDE_BUILTIN_RE = re.compile(r"^[A-Z][A-Za-z]+$")


def _claude_token(part: str) -> str:
    return re.sub(r"[^A-Za-z0-9_*-]", "_", part)


def claude_rule(pattern: str) -> str | None:
    """VoxCrew kalıbı → Claude Code izin kuralı.

    `sunucu:araç` → `mcp__sunucu__araç`, `sunucu:*` → `mcp__sunucu`, `Bash`/`WebFetch` gibi büyük harfle başlayan
    iki noktasız ad → olduğu gibi (Claude yerleşik aracı). Eşlenemeyen kalıp (ör. `*:delete_*`) None döner."""
    if ":" in pattern:
        server, tool = pattern.split(":", 1)
        if not server or "*" in server or "?" in server or "[" in server:
            return None
        if tool in ("*", ""):
            return f"mcp__{_claude_token(server)}"
        return f"mcp__{_claude_token(server)}__{_claude_token(tool)}"
    if _CLAUDE_BUILTIN_RE.match(pattern):
        return pattern
    if SERVER_ID_RE.match(pattern):
        return f"mcp__{pattern}"  # iki noktasız küçük harfli ad: sunucunun tamamı
    return None


def claude_flags(policy: ToolPolicy) -> dict[str, list[str]]:
    """Claude için `--disallowedTools` (deny) ve `--allowedTools`a eklenecek MCP kuralları (allow).

    Allow listesi yerleşik araçları ASLA genişletmez (kabuk/yazma izni bağlayıcının izin düzeyindedir); yalnızca
    `mcp__…` kuralları eklenir. Eşlenemeyen kalıplar `unmapped` içinde raporlanır."""
    disallowed: list[str] = []
    allowed_mcp: list[str] = []
    unmapped: list[str] = []
    for p in policy.deny:
        r = claude_rule(p)
        if r is None:
            unmapped.append(p)
        elif r not in disallowed:
            disallowed.append(r)
    for p in policy.allow:
        r = claude_rule(p)
        if r is None or not r.startswith("mcp__"):
            if r is None:
                unmapped.append(p)
            continue
        if r not in allowed_mcp and r not in disallowed:
            allowed_mcp.append(r)
    return {"disallowed": disallowed, "allowed_mcp": allowed_mcp, "unmapped": unmapped}
