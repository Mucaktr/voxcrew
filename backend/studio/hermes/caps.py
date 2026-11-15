"""Hermes yetenek keşfi — SALT OKUNUR.

`settings.hermes_home` altındaki dosyalardan profilleri, skill'leri (SKILL.md frontmatter), araç seti
kayıt defterini (`hermes-agent/toolsets.py` → `ast` ile ayrıştırılır, çalıştırılmaz), SOUL.md,
MEMORY.md/USER.md, oturumları (`state.db`, `mode=ro`) ve cron işlerini okur.

Kurallar:
- Hermes dizinine hiçbir koşulda yazılmaz (yazımlar `studio.changes` planlarından geçer).
- CLI tablo çıktısı ayrıştırılmaz; tek doğruluk kaynağı dosyalardır.
- Ucuz sonuçlar 30 sn önbelleklenir.
"""

from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
import weakref
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import quote

import yaml

REASONING_LEVELS: tuple[str, ...] = ("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra")
TRANSPORTS: tuple[str, ...] = ("auto", "cli", "api")

MEMORY_DELIM = "\n§\n"            # tools/memory_tool_store.py: ENTRY_DELIMITER
MEMORY_LIMIT_DEFAULT = 2200        # memory.memory_char_limit
USER_LIMIT_DEFAULT = 1375          # memory.user_char_limit

ESSENTIAL_SKILLS = frozenset({"hermes-agent"})        # kapatılamaz (agent/skill_utils.py)
PLATFORM_MAP = {"macos": "darwin", "linux": "linux", "windows": "win32"}
EXCLUDED_DIRS = frozenset({".git", ".github", ".hub", ".archive", ".curator_backups", ".locks", ".venv", "venv",
                           "node_modules", "site-packages", "__pycache__", ".tox", ".nox", ".pytest_cache",
                           ".mypy_cache", ".ruff_cache"})
RISKY_TOOLSETS = frozenset({"terminal", "browser", "code_execution", "delegation", "computer_use"})
PROFILE_MARKERS = ("config.yaml", ".env", "SOUL.md", "profile.yaml", "auth.json", "state.db")
PROFILE_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
PLATFORM_COMPOSITE = {"cli": "hermes-cli", "api_server": "hermes-api-server"}
CACHE_TTL = 30.0
MAX_SKILL_CHARS = 400_000

# hermes-agent kaynağı okunamazsa kullanılan yedek kayıt (araştırma belgesi §2, v0.22.2)
_FALLBACK_TOOLSETS: dict[str, tuple[str, list[str]]] = {
    "web": ("Web research and content extraction tools", ["web_search", "web_extract"]),
    "browser": ("Browser automation for web interaction", [
        "browser_navigate", "browser_snapshot", "browser_click", "browser_type", "browser_scroll", "browser_back",
        "browser_press", "browser_get_images", "browser_vision", "browser_console", "browser_cdp", "browser_dialog",
        "browser_vault", "browser_exec"]),
    "terminal": ("Terminal/command execution and process management tools", ["terminal", "process_manage"]),
    "file": ("File manipulation tools: read, write, patch, search", ["read_file", "write_file", "patch", "search_files"]),
    "code_execution": ("Run Python scripts that call tools programmatically", ["execute_code"]),
    "vision": ("Image analysis and vision tools", ["vision_analyze"]),
    "video": ("Video analysis (opt-in)", ["video_analyze"]),
    "image_gen": ("Creative generation tools (images)", ["image_generate"]),
    "video_gen": ("Video generation tools", ["video_generate", "xai_video_edit", "xai_video_extend"]),
    "x_search": ("Search X (Twitter) posts", ["x_search"]),
    "tts": ("Text-to-speech", ["text_to_speech"]),
    "stt": ("Speech-to-text (config only)", []),
    "skills": ("Access, create, edit, and manage skill documents", ["skills_list", "skill_view", "skill_manage"]),
    "todo": ("Task planning and tracking for multi-step work", ["todo_list"]),
    "kanban": ("Kanban multi-agent coordination", []),
    "memory": ("Persistent memory across sessions", ["memory"]),
    "context_engine": ("Runtime tools exposed by the active context engine", []),
    "session_search": ("Search and recall past conversations", ["session_search"]),
    "connections": ("Remote connector discovery and account authorization", ["manage_connections"]),
    "clarify": ("Ask the user clarifying questions", ["clarify"]),
    "delegation": ("Spawn subagents with isolated context", ["delegate_task"]),
    "cronjob": ("Cronjob management tool", ["cronjob_manage"]),
    "computer_use": ("Background desktop control via cua-driver", ["computer_use"]),
}
_FALLBACK_DEFAULT_OFF = frozenset({"spotify", "discord", "discord_admin", "video", "video_gen", "x_search", "a2a",
                                   "kanban"})
_FALLBACK_CLI_ON = ["web", "browser", "terminal", "file", "code_execution", "vision", "image_gen", "tts", "skills",
                    "todo", "memory", "session_search", "connections", "clarify", "delegation", "cronjob",
                    "computer_use"]


# =====================================================================================================
# küçük yardımcılar
# =====================================================================================================
def fold(text: Any) -> str:
    """Türkçe duyarlı, büyük/küçük harf duyarsız karşılaştırma anahtarı (İ/i, I/ı aynı sayılır)."""
    s = str(text or "").replace("İ", "i").replace("I", "ı").lower()
    return s.replace("ı", "i").replace("̇", "")


def iso(ts: float | int | str | None) -> str | None:
    if ts is None or ts == "":
        return None
    if isinstance(ts, str):
        try:
            return iso(float(ts))
        except ValueError:
            return ts
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat(timespec="seconds")
    except (OverflowError, OSError, ValueError):
        return None


def sha(text: str | None) -> str | None:
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text is not None else None


def str_list(value: Any) -> list[str]:
    """Liste ya da JSON/YAML dizisi biçiminde string (`hermes config set` böyle saklar) → string listesi."""
    if value is None or value == "":
        return []
    if isinstance(value, (list, tuple, set, frozenset)):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str):
        s = value.strip()
        if s.startswith("["):
            for loader in (json.loads, ast.literal_eval):
                try:
                    parsed = loader(s)
                except (ValueError, SyntaxError):
                    continue
                if isinstance(parsed, (list, tuple)):
                    return [str(v).strip() for v in parsed if str(v).strip()]
        return [p.strip() for p in s.split(",") if p.strip()]
    return [str(value).strip()]


def clean_name_list(value: Any) -> list[str]:
    """Ajan alanları için: string listesi, kırpılmış, tekrarsız, sıra korunur."""
    out: list[str] = []
    for item in str_list(value):
        if item not in out:
            out.append(item)
    return out


def read_text(path: Path, limit: int | None = None) -> str | None:
    try:
        text = path.read_text("utf-8-sig", errors="replace")
    except OSError:
        return None
    return text[:limit] if limit else text


def read_yaml(path: Path) -> dict[str, Any]:
    text = read_text(path)
    if not text:
        return {}
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}


def read_json(path: Path) -> Any:
    text = read_text(path)
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def json_safe(value: Any) -> Any:
    """YAML'dan gelen tarih vb. değerleri JSON'a uygun hâle getirir."""
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def mtime_iso(path: Path) -> str | None:
    try:
        return iso(path.stat().st_mtime)
    except OSError:
        return None


def parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    """SKILL.md YAML frontmatter'ı (Hermes `agent/skill_utils.py::parse_frontmatter` ile aynı kurallar)."""
    content = content.removeprefix("﻿")
    end = re.search(r"\n---\s*\n", content[3:]) if content.startswith("---") else None
    if not end:
        return {}, content
    raw = content[3:end.start() + 3]
    body = content[end.end() + 3:]
    fm: dict[str, Any] = {}
    try:
        parsed = yaml.safe_load(raw)
        if isinstance(parsed, dict):
            fm = parsed
    except yaml.YAMLError:
        for line in raw.strip().split("\n"):
            if ":" in line:
                k, v = line.split(":", 1)
                fm[k.strip()] = v.strip()
    return fm, body


def platform_ok(platforms: list[str], current: str = sys.platform) -> bool:
    if not platforms:
        return True
    return any(current.startswith(PLATFORM_MAP.get(p.lower().strip(), p.lower().strip())) for p in platforms)


def split_memory(text: str | None) -> list[str]:
    if not text:
        return []
    norm = text.replace("\r\n", "\n")
    return [e.strip() for e in norm.split(MEMORY_DELIM) if e.strip()]


def join_memory(entries: Iterable[str]) -> str:
    return MEMORY_DELIM.join(e.strip() for e in entries if e and e.strip())


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        return default


def _strip_emoji(label: str) -> tuple[str, str | None]:
    parts = (label or "").strip().split(None, 1)
    if len(parts) == 2 and not any(ch.isascii() and ch.isalnum() for ch in parts[0]):
        return parts[1].strip(), parts[0]
    return (label or "").strip(), None


# =====================================================================================================
# araç seti kayıt defteri: toolsets.py ve tools_config.py ast ile (ÇALIŞTIRILMADAN) okunur
# =====================================================================================================
class _Unsupported(Exception):
    pass


def _ts(description: str = "", tools: Iterable[str] = (), includes: Iterable[str] = (), **extra: Any) -> dict[str, Any]:
    return {"description": description, "tools": list(tools), "includes": list(includes),
            **{k: v for k, v in extra.items() if isinstance(v, (str, int, float, bool))}}


class _AstEval:
    """toolsets.py için çok küçük, yan etkisiz bir ifade değerlendiricisi (yalnızca sabitler, listeler,
    birkaç bilinen yardımcı ve basit liste üreteçleri). Bilinmeyen her şey `_Unsupported` fırlatır."""

    def __init__(self) -> None:
        self.env: dict[str, Any] = {}
        core = lambda: self.env.get("_HERMES_CORE_TOOLS", [])  # noqa: E731
        self.funcs: dict[str, Callable[..., Any]] = {
            "_ts": _ts,
            "_bundle": lambda description="", extras=(): _ts(description, list(core()) + list(extras)),
            "_core_without": lambda *excluded, kanban=True: [
                t for t in core() if t not in excluded and (kanban or not t.startswith("kanban_"))],
            "list": list, "tuple": tuple, "set": set, "frozenset": frozenset, "sorted": sorted,
        }

    def ev(self, node: ast.AST, local: dict[str, Any] | None = None) -> Any:
        local = local or {}
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            items: list[Any] = []
            for elt in node.elts:
                if isinstance(elt, ast.Starred):
                    items.extend(self.ev(elt.value, local))
                else:
                    items.append(self.ev(elt, local))
            return tuple(items) if isinstance(node, ast.Tuple) else set(items) if isinstance(node, ast.Set) else items
        if isinstance(node, ast.Dict):
            return {self.ev(k, local): self.ev(v, local) for k, v in zip(node.keys, node.values) if k is not None}
        if isinstance(node, ast.Name):
            if node.id in local:
                return local[node.id]
            if node.id in self.env:
                return self.env[node.id]
            raise _Unsupported(node.id)
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            left, right = self.ev(node.left, local), self.ev(node.right, local)
            if isinstance(left, (list, tuple)) and isinstance(right, (list, tuple)):
                return list(left) + list(right)
            if isinstance(left, str) and isinstance(right, str):
                return left + right
            raise _Unsupported("binop")
        if isinstance(node, ast.Subscript):
            value = self.ev(node.value, local)
            if isinstance(node.slice, ast.Slice):
                lo = self.ev(node.slice.lower, local) if node.slice.lower else None
                hi = self.ev(node.slice.upper, local) if node.slice.upper else None
                return value[lo:hi]
            return value[self.ev(node.slice, local)]
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Attribute):
                obj = self.ev(node.func.value, local)
                if isinstance(obj, str) and node.func.attr in ("startswith", "endswith") and len(node.args) == 1:
                    return getattr(obj, node.func.attr)(self.ev(node.args[0], local))
                raise _Unsupported("attr-call")
            if isinstance(node.func, ast.Name) and node.func.id in self.funcs:
                args: list[Any] = []
                for a in node.args:
                    if isinstance(a, ast.Starred):
                        args.extend(self.ev(a.value, local))
                    else:
                        args.append(self.ev(a, local))
                kwargs = {k.arg: self.ev(k.value, local) for k in node.keywords if k.arg}
                return self.funcs[node.func.id](*args, **kwargs)
            raise _Unsupported("call")
        if isinstance(node, ast.ListComp) and len(node.generators) == 1:
            gen = node.generators[0]
            if not isinstance(gen.target, ast.Name):
                raise _Unsupported("comp-target")
            out = []
            for item in self.ev(gen.iter, local):
                scope = {**local, gen.target.id: item}
                if all(self.ev(cond, scope) for cond in gen.ifs):
                    out.append(self.ev(node.elt, scope))
            return out
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            left, right, op = self.ev(node.left, local), self.ev(node.comparators[0], local), node.ops[0]
            if isinstance(op, ast.In):
                return left in right
            if isinstance(op, ast.NotIn):
                return left not in right
            if isinstance(op, ast.Eq):
                return left == right
            if isinstance(op, ast.NotEq):
                return left != right
            raise _Unsupported("compare")
        if isinstance(node, ast.BoolOp):
            vals = [self.ev(v, local) for v in node.values]
            return all(vals) if isinstance(node.op, ast.And) else any(vals)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            return not self.ev(node.operand, local)
        raise _Unsupported(type(node).__name__)


def parse_toolsets_py(path: Path) -> dict[str, dict[str, Any]]:
    """`toolsets.py` içindeki TOOLSETS sözlüğünü kodu çalıştırmadan çıkarır."""
    src = read_text(path)
    if not src:
        return {}
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return {}
    evaluator = _AstEval()
    result: dict[str, dict[str, Any]] = {}
    for stmt in tree.body:
        target, value = None, None
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
            target, value = stmt.targets[0].id, stmt.value
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name) and stmt.value is not None:
            target, value = stmt.target.id, stmt.value
        if target is None or value is None:
            continue
        if target == "TOOLSETS" and isinstance(value, ast.Dict):
            for k, v in zip(value.keys, value.values):
                if not isinstance(k, ast.Constant) or not isinstance(k.value, str):
                    continue
                try:
                    spec = evaluator.ev(v)
                except (_Unsupported, TypeError, KeyError, IndexError, AttributeError):
                    continue
                if isinstance(spec, dict):
                    result[k.value] = {"description": str(spec.get("description") or ""),
                                       "tools": [str(t) for t in spec.get("tools") or []],
                                       "includes": [str(t) for t in spec.get("includes") or []]}
            continue
        try:
            evaluator.env[target] = evaluator.ev(value)
        except (_Unsupported, TypeError, KeyError, IndexError, AttributeError):
            continue
    return result


def parse_tools_config(path: Path) -> tuple[list[tuple[str, str, str]], frozenset[str]]:
    """`hermes_cli/tools_config.py` → (CONFIGURABLE_TOOLSETS, _DEFAULT_OFF_TOOLSETS); `literal_eval` ile."""
    src = read_text(path)
    if not src:
        return [], frozenset()
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return [], frozenset()
    conf: list[tuple[str, str, str]] = []
    off: frozenset[str] = frozenset()
    for stmt in tree.body:
        if not (isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name)):
            continue
        name = stmt.targets[0].id
        try:
            if name == "CONFIGURABLE_TOOLSETS":
                conf = [(str(a), str(b), str(c)) for a, b, c in ast.literal_eval(stmt.value)]
            elif name == "_DEFAULT_OFF_TOOLSETS":
                off = frozenset(str(x) for x in ast.literal_eval(stmt.value))
        except (ValueError, SyntaxError, TypeError):
            continue
    return conf, off


def parse_platform_restrictions(path: Path) -> dict[str, set[str]]:
    """`hermes_cli/toolset_scope.py::_TOOLSET_PLATFORM_RESTRICTIONS` (ör. discord yalnızca discord platformunda)."""
    src = read_text(path)
    if src:
        try:
            for stmt in ast.parse(src).body:
                if (isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name)
                        and stmt.targets[0].id == "_TOOLSET_PLATFORM_RESTRICTIONS"):
                    value = ast.literal_eval(stmt.value)
                    return {str(k): {str(x) for x in v} for k, v in value.items()}
        except (SyntaxError, ValueError, TypeError, AttributeError):
            pass
    return {"discord": {"discord"}, "discord_admin": {"discord"}}


def load_toolset_registry(agent_src: Path) -> dict[str, Any]:
    toolsets = parse_toolsets_py(agent_src / "toolsets.py")
    conf, off = parse_tools_config(agent_src / "hermes_cli" / "tools_config.py")
    restrictions = parse_platform_restrictions(agent_src / "hermes_cli" / "toolset_scope.py")
    source = "hermes-agent"
    if not toolsets:
        toolsets = {k: {"description": d, "tools": list(t), "includes": []} for k, (d, t) in _FALLBACK_TOOLSETS.items()}
        source = "yerleşik"
        toolsets["hermes-cli"] = {"description": "Full interactive CLI toolset", "includes": [],
                                  "tools": sorted({t for k in _FALLBACK_CLI_ON for t in _FALLBACK_TOOLSETS[k][1]})}
        toolsets["hermes-api-server"] = {"description": "OpenAI-compatible API server", "includes": [],
                                         "tools": [t for t in toolsets["hermes-cli"]["tools"]
                                                   if t not in ("text_to_speech", "clarify", "computer_use")]}
    if not conf:
        conf = [(k, k, ", ".join(_FALLBACK_TOOLSETS[k][1])) for k in _FALLBACK_TOOLSETS]
    return {"toolsets": toolsets, "configurable": conf, "default_off": off or _FALLBACK_DEFAULT_OFF, "source": source,
            "restrictions": restrictions}


def toolset_allowed(name: str, registry: dict[str, Any], platform: str = "cli") -> bool:
    allowed = (registry.get("restrictions") or {}).get(name)
    return not allowed or platform in allowed


def resolve_toolset(name: str, toolsets: dict[str, dict[str, Any]], seen: set[str] | None = None) -> list[str]:
    seen = seen if seen is not None else set()
    if name in seen or name not in toolsets:
        return []
    seen.add(name)
    spec = toolsets[name]
    tools = list(spec.get("tools") or [])
    for inc in spec.get("includes") or []:
        tools += resolve_toolset(inc, toolsets, seen)
    return list(dict.fromkeys(tools))


def platform_toolsets(cfg: dict[str, Any], registry: dict[str, Any], platform: str = "cli") -> list[str]:
    """Bir profilin bir platformda (cli | api_server) açık araç setleri — `hermes_cli/tools_config.py::
    _get_platform_tools` sadeleştirilmiş eşleniği (açık liste > bileşik paket − varsayılan kapalılar,
    en son `agent.disabled_toolsets` çıkarılır)."""
    toolsets: dict[str, dict[str, Any]] = registry["toolsets"]
    conf_keys = [k for k, _, _ in registry["configurable"] if toolset_allowed(k, registry, platform)]
    default_off = set(registry["default_off"])
    pt = cfg.get("platform_toolsets")
    raw = pt.get(platform) if isinstance(pt, dict) else None
    explicit = isinstance(raw, list) or (isinstance(raw, str) and raw.strip().startswith("["))
    names = str_list(raw) if explicit else [PLATFORM_COMPOSITE.get(platform, "hermes-cli")]
    expanded: list[str] = []
    for n in names:
        expanded += ["hermes-cli", "hermes-api-server"] if n == "hermes" else [n]
    names = expanded

    def subset(tool_names: set[str]) -> set[str]:
        out = set()
        for k in conf_keys:
            ts = set(resolve_toolset(k, toolsets))
            if ts and ts <= tool_names:
                out.add(k)
        return out

    if any(n in conf_keys for n in names):
        enabled = {n for n in names if n in conf_keys}
        comp = {t for n in names if n not in conf_keys and n in toolsets for t in resolve_toolset(n, toolsets)}
        if comp:
            enabled |= subset(comp) - default_off
    else:
        enabled = subset({t for n in names for t in resolve_toolset(n, toolsets)}) - default_off
    enabled |= {n for n in names if n not in conf_keys and n not in toolsets}  # MCP / özel adlar olduğu gibi
    if not explicit and "kanban" in str_list(cfg.get("toolsets")):
        enabled.add("kanban")
    enabled -= set(str_list((cfg.get("agent") or {}).get("disabled_toolsets")))
    order = {k: i for i, k in enumerate(conf_keys)}
    return sorted(enabled, key=lambda k: (order.get(k, 999), k))


# =====================================================================================================
# skill dosyaları
# =====================================================================================================
def walk_skill_files(root: Path, max_depth: int = 5) -> list[Path]:
    """`<root>/**/SKILL.md` — nokta ile başlayan ve hariç tutulan dizinler atlanır; bir skill dizininin
    içine (scripts/, references/ …) inilmez."""
    found: list[Path] = []
    if not root.is_dir():
        return found
    stack: list[tuple[Path, int]] = [(root, 0)]
    while stack:
        d, depth = stack.pop()
        try:
            children = list(os.scandir(d))
        except OSError:
            continue
        if d != root and any(c.name == "SKILL.md" and c.is_file() for c in children):
            found.append(d / "SKILL.md")
            continue
        if depth >= max_depth:
            continue
        for c in children:
            try:
                is_dir = c.is_dir(follow_symlinks=False)
            except OSError:
                continue
            if is_dir and not c.name.startswith(".") and c.name not in EXCLUDED_DIRS:
                stack.append((Path(c.path), depth + 1))
    return sorted(found)


def skill_files(skill_dir: Path, limit: int = 200) -> list[str]:
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(skill_dir):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d not in EXCLUDED_DIRS)
        for f in sorted(filenames):
            rel = (Path(dirpath) / f).relative_to(skill_dir).as_posix()
            if rel != "SKILL.md" and not f.startswith("."):
                out.append(rel)
                if len(out) >= limit:
                    return out
    return out


def _bundled_names(root: Path) -> set[str]:
    text = read_text(root / ".bundled_manifest") or ""
    return {ln.split(":", 1)[0].strip() for ln in text.splitlines() if ln.strip()}


def _hub_installed(root: Path) -> dict[str, dict[str, Any]]:
    data = read_json(root / ".hub" / "lock.json")
    installed = data.get("installed") if isinstance(data, dict) else None
    return {str(k): (v if isinstance(v, dict) else {}) for k, v in (installed or {}).items()}


def _usage(root: Path) -> dict[str, dict[str, Any]]:
    data = read_json(root / ".usage.json")
    return {str(k): v for k, v in data.items() if isinstance(v, dict)} if isinstance(data, dict) else {}


# =====================================================================================================
# ana sınıf
# =====================================================================================================
class HermesCaps:
    """Bir stüdyo ayar nesnesine bağlı, önbellekli, salt okunur Hermes keşfi."""

    def __init__(self, settings: Any, current_platform: str = sys.platform):
        self.settings = settings
        self.platform = current_platform
        self._cache: dict[tuple[Any, ...], tuple[float, Any]] = {}
        self._lock = threading.RLock()

    # ------------------------------------------------------------------ önbellek
    @property
    def home(self) -> Path:
        return Path(str(self.settings.get("hermes_home")))

    def _cached(self, key: tuple[Any, ...], fn: Callable[[], Any], ttl: float = CACHE_TTL) -> Any:
        full = (str(self.home), *key)
        now = time.monotonic()
        with self._lock:
            hit = self._cache.get(full)
            if hit and now - hit[0] < ttl:
                return hit[1]
        value = fn()
        with self._lock:
            self._cache[full] = (now, value)
        return value

    def invalidate(self) -> None:
        with self._lock:
            self._cache.clear()

    # ------------------------------------------------------------------ profiller
    def profile_dirs(self) -> dict[str, Path]:
        def scan() -> dict[str, Path]:
            home = self.home
            out: dict[str, Path] = {}
            if home.is_dir():
                out["default"] = home
            pdir = home / "profiles"
            if pdir.is_dir():
                for p in sorted(pdir.iterdir(), key=lambda x: x.name):
                    if (p.is_dir() and p.name != "default" and PROFILE_NAME_RE.match(p.name)
                            and any((p / m).exists() for m in PROFILE_MARKERS)):
                        out[p.name] = p
            return out
        return self._cached(("profiles",), scan)

    def profile_dir(self, profile: str) -> Path:
        d = self.profile_dirs().get(profile)
        if d is None:
            raise KeyError(f"Hermes profili bulunamadı: {profile}")
        return d

    def config(self, profile: str) -> dict[str, Any]:
        return self._cached(("config", profile), lambda: read_yaml(self.profile_dir(profile) / "config.yaml"))

    def profile_info(self, profile: str) -> dict[str, Any]:
        d = self.profile_dir(profile)
        cfg = self.config(profile)
        model = cfg.get("model")
        model = model if isinstance(model, dict) else {"default": model} if model else {}
        soul = read_text(d / "SOUL.md") or ""
        agent_cfg = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}
        try:
            skills = self.skills(profile)
        except KeyError:
            skills = []
        return {
            "name": profile, "path": str(d), "is_default": profile == "default",
            "model": str(model.get("default") or model.get("model") or ""),
            "provider": str(model.get("provider") or "auto"),
            "base_url": str(model.get("base_url") or ""),
            "reasoning_effort": agent_cfg.get("reasoning_effort"),
            "has_soul": bool(soul.strip()), "soul_chars": len(soul), "soul_preview": soul.strip()[:320],
            "skills": sum(1 for s in skills if s["listed"]), "skills_total": len(skills),
            "toolsets_cli": self.enabled_toolsets(profile, "cli"),
            "sessions": self.session_count(profile),
            "has_env": (d / ".env").is_file(),
        }

    def profiles(self) -> list[dict[str, Any]]:
        return [self.profile_info(p) for p in self.profile_dirs()]

    # ------------------------------------------------------------------ araç setleri
    def toolset_registry(self) -> dict[str, Any]:
        return self._cached(("registry",), lambda: load_toolset_registry(self.home / "hermes-agent"), ttl=300)

    def enabled_toolsets(self, profile: str, platform: str = "cli") -> list[str]:
        return self._cached(("enabled", profile, platform),
                            lambda: platform_toolsets(self.config(profile), self.toolset_registry(), platform))

    def mcp_servers(self, profile: str) -> list[str]:
        servers = self.config(profile).get("mcp_servers")
        return sorted(str(k) for k in servers) if isinstance(servers, dict) else []

    def toolsets(self, profile: str = "default") -> list[dict[str, Any]]:
        reg = self.toolset_registry()
        cfg = self.config(profile)
        cli = set(self.enabled_toolsets(profile, "cli"))
        api = set(self.enabled_toolsets(profile, "api_server"))
        disabled = set(str_list((cfg.get("agent") or {}).get("disabled_toolsets")))
        out: list[dict[str, Any]] = []
        for key, label, summary in reg["configurable"]:
            spec = reg["toolsets"].get(key) or {}
            tools = resolve_toolset(key, reg["toolsets"])
            clean_label, emoji = _strip_emoji(label)
            out.append({"name": key, "label": clean_label, "emoji": emoji,
                        "description": spec.get("description") or summary, "summary": summary,
                        "tools": tools, "default": key in cli, "api_default": key in api,
                        "profile_disabled": key in disabled, "default_off": key in reg["default_off"],
                        "risky": key in RISKY_TOOLSETS, "config_only": not tools, "kind": "toolset",
                        "platforms": sorted((reg.get("restrictions") or {}).get(key) or []),
                        "cli_allowed": toolset_allowed(key, reg, "cli")})
        for name in self.mcp_servers(profile):
            out.append({"name": name, "label": name, "emoji": None, "description": "MCP sunucusu (config.yaml → mcp_servers)",
                        "summary": "MCP", "tools": [], "default": name in cli, "api_default": name in api,
                        "profile_disabled": name in disabled, "default_off": False, "risky": False,
                        "config_only": False, "kind": "mcp", "platforms": [], "cli_allowed": True})
        return out

    def toolset_names(self, profile: str | None = None) -> set[str]:
        reg = self.toolset_registry()
        names = set(reg["toolsets"]) | {k for k, _, _ in reg["configurable"]} | {"all", "*"}
        if profile:
            try:
                names |= set(self.mcp_servers(profile))
            except KeyError:
                pass
        return names

    def profile_disabled_toolsets(self, profile: str) -> set[str]:
        return set(str_list((self.config(profile).get("agent") or {}).get("disabled_toolsets")))

    # ------------------------------------------------------------------ skill'ler
    def skills(self, profile: str) -> list[dict[str, Any]]:
        return self._cached(("skills", profile), lambda: self._scan_skills(profile))

    def _scan_skills(self, profile: str) -> list[dict[str, Any]]:
        pdir = self.profile_dir(profile)
        cfg = self.config(profile)
        root = pdir / "skills"
        skills_cfg = cfg.get("skills") if isinstance(cfg.get("skills"), dict) else {}
        pdis = skills_cfg.get("platform_disabled") if isinstance(skills_cfg.get("platform_disabled"), dict) else {}
        disabled = (set(str_list(skills_cfg.get("disabled"))) | set(str_list(pdis.get("cli")))) - ESSENTIAL_SKILLS
        bundled, hub, usage = _bundled_names(root), _hub_installed(root), _usage(root)
        hub_paths = {Path(str(v.get("install_path") or "")).name for v in hub.values() if v.get("install_path")}
        cli_toolsets = set(self.enabled_toolsets(profile, "cli"))

        sources: list[tuple[Path, Path, str]] = [(f, root, "local") for f in walk_skill_files(root)]
        sources += [(f, root / ".archive", "archive") for f in walk_skill_files(root / ".archive")]
        for ext in str_list(skills_cfg.get("external_dirs"))[:10]:
            ext_path = Path(os.path.expandvars(os.path.expanduser(ext)))
            sources += [(f, ext_path, "external") for f in walk_skill_files(ext_path)[:500]]

        out: list[dict[str, Any]] = []
        seen: dict[str, int] = {}
        for skill_md, base, origin in sources:
            entry = self._skill_entry(profile, skill_md, base, origin, disabled=disabled, bundled=bundled, hub=hub,
                                      hub_paths=hub_paths, usage=usage, cli_toolsets=cli_toolsets)
            if entry is None:
                continue
            if origin == "external" and entry["name"] in seen:
                continue  # yerel skill öncelikli (skills.md: project → local → external)
            seen[entry["name"]] = seen.get(entry["name"], 0) + 1
            out.append(entry)
        for e in out:  # aynı ad birden çok yerde varsa `-s` için `kategori/ad` kullanılır
            if seen.get(e["name"], 0) > 1 and e["state"] != "archived":
                e["duplicate"] = True
                e["load_name"] = e["rel_path"]
        out.sort(key=lambda e: (fold(e["category"] or "~"), fold(e["name"])))
        return out

    def _skill_entry(self, profile: str, skill_md: Path, base: Path, origin: str, *, disabled: set[str],
                     bundled: set[str], hub: dict[str, Any], hub_paths: set[str], usage: dict[str, Any],
                     cli_toolsets: set[str]) -> dict[str, Any] | None:
        text = read_text(skill_md)
        if text is None:
            return None
        fm, body = parse_frontmatter(text)
        try:
            rel = skill_md.parent.relative_to(base).as_posix()
        except ValueError:
            rel = skill_md.parent.name
        name = str(fm.get("name") or skill_md.parent.name).strip()
        meta = fm.get("metadata") if isinstance(fm.get("metadata"), dict) else {}
        hmeta = meta.get("hermes") if isinstance(meta.get("hermes"), dict) else {}
        category = hmeta.get("category") or fm.get("category") or (rel.split("/")[0] if "/" in rel else None)
        platforms = str_list(fm.get("platforms"))
        environments = [e.lower() for e in str_list(fm.get("environments"))]
        requires = str_list(hmeta.get("requires_toolsets"))
        u = usage.get(name) or {}
        if origin == "archive":
            state = "archived"
        else:
            state = str(u.get("state") or "active")
            state = state if state in ("active", "stale", "archived") else "active"
        if origin == "external":
            source = "external"
        elif name in hub or skill_md.parent.name in hub_paths:
            source = "hub"
        elif name in bundled:
            source = "bundled"
        elif u.get("created_by") == "agent":
            source = "agent"
        else:
            source = "local"

        def env_active(tag: str) -> bool:
            if tag == "kanban":
                return "kanban" in cli_toolsets
            if tag in ("docker", "s6"):
                return False
            return True

        p_ok = platform_ok(platforms, self.platform)
        env_ok = any(env_active(t) for t in environments) if environments else True
        is_disabled = name in disabled
        hub_entry = hub.get(name) or {}
        return {
            "name": name, "load_name": name, "profile": profile, "rel_path": rel, "path": str(skill_md),
            "description": str(fm.get("description") or "").strip(),
            "category": str(category) if category else None,
            "source": source, "trust": hub_entry.get("trust_level") or ("builtin" if source == "bundled" else None),
            "version": str(fm["version"]) if fm.get("version") is not None else None,
            "author": str(fm["author"]) if fm.get("author") else None,
            "license": str(fm["license"]) if fm.get("license") else None,
            "tags": str_list(hmeta.get("tags") or fm.get("tags")),
            "related": str_list(hmeta.get("related_skills")),
            "platforms": platforms, "platform_ok": p_ok,
            "environments": environments, "env_ok": env_ok,
            "requires_toolsets": requires, "missing_toolsets": [t for t in requires if t not in cli_toolsets],
            "required_env": [str(v.get("name")) for v in fm.get("required_environment_variables") or []
                             if isinstance(v, dict) and v.get("name")],
            "disabled": is_disabled, "state": state, "pinned": bool(u.get("pinned")),
            "use_count": _as_int(u.get("use_count")),
            "last_used_at": u.get("last_used_at"),
            "size_chars": len(text), "tokens": (len(text) + 3) // 4, "body_chars": len(body),
            "updated_at": mtime_iso(skill_md),
            "loadable": p_ok and not is_disabled and state != "archived",
            "listed": p_ok and env_ok and state != "archived",
            "duplicate": False,
        }

    def skill_index(self, profile: str) -> dict[str, dict[str, Any]]:
        """ad / `-s` yükleme adı / göreli yol → skill. Arşivlenmişler yalnızca etkin bir eşi yoksa adla bulunur."""
        idx: dict[str, dict[str, Any]] = {}
        items = self.skills(profile)
        for e in (e for e in items if e["state"] != "archived"):
            idx[e["load_name"]] = e
            idx.setdefault(e["name"], e)
            idx.setdefault(e["rel_path"], e)
        for e in (e for e in items if e["state"] == "archived"):
            idx.setdefault(f".archive/{e['rel_path']}", e)
            idx.setdefault(e["name"], e)
        return idx

    def skill_detail(self, profile: str, name: str) -> dict[str, Any]:
        entry = self.skill_index(profile).get(name)
        if not entry:
            raise KeyError(f"Skill bulunamadı: {name} (profil: {profile})")
        path = Path(entry["path"])
        text = read_text(path) or ""
        fm, body = parse_frontmatter(text)
        return {**entry, "content": text[:MAX_SKILL_CHARS], "truncated": len(text) > MAX_SKILL_CHARS,
                "body": body[:MAX_SKILL_CHARS], "frontmatter": json_safe(fm), "files": skill_files(path.parent)}

    def skill_reason(self, entry: dict[str, Any]) -> str | None:
        if not entry["platform_ok"]:
            return f"bu işletim sisteminde kullanılamaz (platforms: {', '.join(entry['platforms'])})"
        if entry["disabled"]:
            return "profil config.yaml'da devre dışı (skills.disabled)"
        if entry["state"] == "archived":
            return "curator tarafından arşivlenmiş"
        return None

    # ------------------------------------------------------------------ SOUL ve bellek
    def soul(self, profile: str) -> dict[str, Any]:
        path = self.profile_dir(profile) / "SOUL.md"
        text = read_text(path) if path.is_file() else None
        return {"profile": profile, "path": str(path), "content": text or "", "exists": text is not None,
                "updated_at": mtime_iso(path) if text is not None else None, "sha": sha(text),
                "chars": len(text or "")}

    def memory_limits(self, profile: str) -> tuple[int, int, dict[str, bool]]:
        mem = self.config(profile).get("memory")
        mem = mem if isinstance(mem, dict) else {}
        return (_as_int(mem.get("memory_char_limit"), MEMORY_LIMIT_DEFAULT),
                _as_int(mem.get("user_char_limit"), USER_LIMIT_DEFAULT),
                {"memory": mem.get("memory_enabled", True) is not False,
                 "user": mem.get("user_profile_enabled", True) is not False})

    def memory_path(self, profile: str, which: str) -> Path:
        if which not in ("memory", "user"):
            raise ValueError("which: 'memory' veya 'user' olmalı")
        return self.profile_dir(profile) / "memories" / ("MEMORY.md" if which == "memory" else "USER.md")

    def memory(self, profile: str) -> dict[str, Any]:
        mem_limit, user_limit, enabled = self.memory_limits(profile)
        out: dict[str, Any] = {"profile": profile, "enabled": enabled, "delimiter": "§"}
        for which, limit in (("memory", mem_limit), ("user", user_limit)):
            path = self.memory_path(profile, which)
            text = read_text(path) if path.is_file() else None
            entries = split_memory(text)
            out[which] = {"path": str(path), "content": text or "", "exists": text is not None, "entries": entries,
                          "chars": len(join_memory(entries)), "limit": limit, "sha": sha(text),
                          "updated_at": mtime_iso(path) if text is not None else None}
        return out

    # ------------------------------------------------------------------ oturumlar (state.db, salt okunur)
    def _ro_connect(self, db: Path) -> sqlite3.Connection:
        uri = f"file:{quote(db.as_posix(), safe='/:')}?mode=ro"
        con = sqlite3.connect(uri, uri=True, timeout=2, check_same_thread=False)
        con.row_factory = sqlite3.Row
        return con

    def session_count(self, profile: str) -> int | None:
        def count() -> int | None:
            db = self.profile_dir(profile) / "state.db"
            if not db.is_file():
                return 0
            try:
                con = self._ro_connect(db)
                try:
                    cols = {r[1] for r in con.execute("PRAGMA table_info(sessions)")}
                    where = " WHERE COALESCE(hidden,0)=0" if "hidden" in cols else ""
                    return int(con.execute(f"SELECT COUNT(*) FROM sessions{where}").fetchone()[0])
                finally:
                    con.close()
            except sqlite3.Error:
                return None
        return self._cached(("session_count", profile), count)

    def sessions(self, profile: str, limit: int = 50, include_hidden: bool = False) -> list[dict[str, Any]]:
        db = self.profile_dir(profile) / "state.db"
        if not db.is_file():
            return []
        limit = max(1, min(int(limit), 500))
        try:
            con = self._ro_connect(db)
        except sqlite3.Error:
            return []
        try:
            cols = {r[1] for r in con.execute("PRAGMA table_info(sessions)")}
            if "id" not in cols:
                return []
            want = ["id", "title", "source", "model", "started_at", "last_activity_at", "ended_at", "message_count",
                    "hidden", "archived", "parent_session_id", "tool_call_count", "end_reason"]
            sel = ", ".join(c if c in cols else f"NULL AS {c}" for c in want)
            order = "COALESCE(last_activity_at, started_at)" if "last_activity_at" in cols else (
                "started_at" if "started_at" in cols else "rowid")
            where = "" if include_hidden or "hidden" not in cols else " WHERE COALESCE(hidden,0)=0"
            rows = con.execute(f"SELECT {sel} FROM sessions{where} ORDER BY {order} DESC LIMIT ?", (limit,)).fetchall()
        except sqlite3.Error:
            return []
        finally:
            con.close()
        return [{"id": r["id"], "title": r["title"], "source": r["source"], "model": r["model"],
                 "started_at": iso(r["started_at"]),
                 "updated_at": iso(r["last_activity_at"] or r["ended_at"] or r["started_at"]),
                 "ended_at": iso(r["ended_at"]), "messages": r["message_count"],
                 "tool_calls": r["tool_call_count"], "hidden": bool(r["hidden"]), "archived": bool(r["archived"]),
                 "parent_id": r["parent_session_id"], "end_reason": r["end_reason"]} for r in rows]

    # ------------------------------------------------------------------ cron (salt okunur)
    def cron(self, profile: str) -> list[dict[str, Any]]:
        cdir = self.profile_dir(profile) / "cron"
        data = read_json(cdir / "jobs.json")
        jobs = data.get("jobs") if isinstance(data, dict) else data if isinstance(data, list) else []
        out: list[dict[str, Any]] = []
        for j in jobs or []:
            if not isinstance(j, dict):
                continue
            sched = j.get("schedule")
            if isinstance(sched, dict):
                schedule = str(sched.get("display") or sched.get("expr") or sched.get("value") or "")
            else:
                schedule = str(sched or "")
            prompt = str(j.get("prompt") or "")
            out.append({"id": str(j.get("id") or ""), "name": str(j.get("name") or j.get("id") or "İsimsiz iş"),
                        "schedule": schedule, "enabled": j.get("enabled", True) is not False,
                        "state": j.get("state"), "next_run": j.get("next_run_at"), "last_run": j.get("last_run_at"),
                        "last_status": j.get("last_status"),
                        "prompt": prompt[:400] + ("…" if len(prompt) > 400 else ""),
                        "skills": str_list(j.get("skills")), "model": j.get("model")})
        return out

    def cron_heartbeat(self, profile: str) -> str | None:
        return mtime_iso(self.profile_dir(profile) / "cron" / "ticker_heartbeat")


# =====================================================================================================
# profil klonlama (yalnızca kullanıcı onayıyla; geliştirmede/testte süreç taklit edilir)
# =====================================================================================================
def profile_create_argv(exe: Path | str, name: str, clone_from: str) -> list[str]:
    """`hermes profile create <ad> --clone-from <kaynak> --no-alias` (alias kabuk betiği oluşturmasın diye)."""
    return [str(exe), "profile", "create", name, "--clone-from", clone_from, "--no-alias"]


def run_profile_create(home: Path, exe: Path | str, name: str, clone_from: str, timeout: float = 180) -> dict[str, Any]:
    argv = profile_create_argv(exe, name, clone_from)
    env = {**os.environ, "HERMES_HOME": str(home), "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    try:
        proc = subprocess.run(argv, capture_output=True, timeout=timeout, env=env, creationflags=flags,
                              stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return {"ok": False, "code": None, "output": "Zaman aşımı", "argv": argv[1:]}
    except OSError as exc:
        return {"ok": False, "code": None, "output": f"Süreç başlatılamadı: {exc}", "argv": argv[1:]}
    out = (proc.stdout + proc.stderr).decode("utf-8", "replace") if isinstance(proc.stdout, bytes) else (
        f"{proc.stdout or ''}{proc.stderr or ''}")
    return {"ok": proc.returncode == 0, "code": proc.returncode, "output": out.strip()[-3000:], "argv": argv[1:]}


# =====================================================================================================
# paylaşılan örnek (ayar nesnesi başına bir tane)
# =====================================================================================================
_INSTANCES: "weakref.WeakKeyDictionary[Any, HermesCaps]" = weakref.WeakKeyDictionary()
_INSTANCES_LOCK = threading.Lock()


def caps_for(settings: Any) -> HermesCaps:
    with _INSTANCES_LOCK:
        caps = _INSTANCES.get(settings)
        if caps is None:
            caps = HermesCaps(settings)
            _INSTANCES[settings] = caps
        return caps
