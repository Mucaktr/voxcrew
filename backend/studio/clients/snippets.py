"""Kurulum komutları — bu makinedeki mutlak yollarla, istek anında üretilir (Ekip S11).

Üretilen metin yalnızca HTTP yanıtında döner; depoya ya da veri dizinine yazılmaz (açık kaynak kuralı: depoda
kişisel yol bulunmaz).
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from studio.brand import GITHUB_REPO, REPO_PUBLIC
from studio.clients.configs import (DEFAULT_STUDIO_URL, SERVER_NAME, claude_entry, codex_block, notify_line)
from studio.config import ROOT
from studio.i18n import request_lang

LOOPBACK = {"127.0.0.1", "::1", "localhost"}


@dataclass(frozen=True)
class Paths:
    root: Path
    server: Path
    plugin_dir: Path
    plugin_server: Path
    hook: Path
    marketplace: Path
    agents_snippet: Path


def paths(root: Path = ROOT) -> Paths:
    plugin = root / "integrations" / "claude-code" / "plugins" / SERVER_NAME
    return Paths(root=root, server=root / "integrations" / "mcp" / "studio-mcp.mjs", plugin_dir=plugin,
                 plugin_server=plugin / "mcp" / "studio-mcp.mjs", hook=plugin / "hooks" / "studio-hook.mjs",
                 marketplace=root / ".claude-plugin" / "marketplace.json",
                 agents_snippet=root / "integrations" / "codex" / "AGENTS.snippet.md")


def studio_url_from_scope(scope: dict[str, Any]) -> str:
    """Stüdyonun gerçek dinleme adresi (Vite vekili arkasında da backend portu). Bilinmiyorsa varsayılan."""
    server = scope.get("server")
    if server and str(server[0]) in LOOPBACK and server[1]:
        return f"http://127.0.0.1:{int(server[1])}"
    port = os.environ.get("STUDIO_PORT", "").strip()
    return f"http://127.0.0.1:{int(port)}" if port.isdigit() else DEFAULT_STUDIO_URL


def plugin_ref(p: Paths) -> dict[str, Any]:
    """Pazar yeri ve eklenti adı (S9'un `.claude-plugin/marketplace.json` dosyasından; yoksa varsayılan)."""
    market, plugin, found = SERVER_NAME, SERVER_NAME, False
    try:
        data = json.loads(p.marketplace.read_text("utf-8"))
        market = str(data.get("name") or market)
        found = True
        for entry in data.get("plugins") or []:
            src = str(entry.get("source") or "") if isinstance(entry, dict) else ""
            if src.rstrip("/").endswith(f"plugins/{SERVER_NAME}"):
                plugin = str(entry.get("name") or plugin)
                break
    except (OSError, ValueError, AttributeError):
        pass
    return {"marketplace": market, "plugin": plugin, "marketplace_file": found}


def _quote(value: str, shell: str) -> str:
    if shell == "powershell":
        return "'" + value.replace("'", "''") + "'"
    return "'" + value.replace("'", "'\\''") + "'"


def build(studio_url: str, p: Paths | None = None, platform: str = sys.platform) -> dict[str, Any]:
    p = p or paths()
    shell = "powershell" if platform == "win32" else "bash"
    q = lambda v: _quote(v, shell)  # noqa: E731
    server = str(p.server)
    custom = studio_url.rstrip("/") != DEFAULT_STUDIO_URL
    ref = plugin_ref(p)
    claude_env = f" -e STUDIO_URL={studio_url}" if custom else ""
    codex_env = f" --env STUDIO_URL={studio_url}" if custom else ""
    try:
        agents_md = p.agents_snippet.read_text("utf-8")
    except OSError:
        agents_md = ""
    project_json = json.dumps({"mcpServers": {SERVER_NAME: claude_entry(server, studio_url)}}, ensure_ascii=False, indent=2)
    return {
        "shell": shell,
        "studio_url": studio_url,
        "custom_url": custom,
        "paths": {"repo": str(p.root), "server": server, "plugin_dir": str(p.plugin_dir), "hook": str(p.hook)},
        "exists": {"server": p.server.is_file(), "plugin_server": p.plugin_server.is_file(),
                   "plugin_mcp_json": (p.plugin_dir / ".mcp.json").is_file(), "hook": p.hook.is_file(),
                   "marketplace": ref["marketplace_file"]},
        "claude_code": {
            # Yerel yol yalnızca bu bilgisayar için üretilir (depoya yazılmaz). GitHub yolu herkes için aynıdır;
            # depo yayımlanana kadar arayüz bunu "yakında" diye işaretler.
            "plugin": [f"claude plugin marketplace add {q(str(p.root))}",
                       f"claude plugin install {ref['plugin']}@{ref['marketplace']}"],
            "plugin_github": [f"/plugin marketplace add {GITHUB_REPO}",
                              f"/plugin install {ref['plugin']}@{ref['marketplace']}"],
            "repo_public": REPO_PUBLIC,
            "user": f"claude mcp add --scope user {SERVER_NAME}{claude_env} -- node {q(server)}",
            "project_json": project_json,
            "verify": ["claude mcp list", "/mcp"],
        },
        "codex": {
            "add": f"codex mcp add {SERVER_NAME}{codex_env} -- node {q(server)}",
            "toml": "\n".join(codex_block(server, studio_url)),
            "notify": notify_line(str(p.hook)),
            "agents_md": agents_md,
            "verify": ["codex mcp list", "/mcp"],
        },
        "examples": EXAMPLES_EN if request_lang() == "en" else EXAMPLES_TR,  # S16: istek dilinde
    }


EXAMPLES_TR = [
    "Uygulamadaki Araştırmacı'ya şu görevi ver: rakiplerin fiyat sayfalarını özetle; bitince sonucu göster.",
    "Uygulamada şu an ne çalışıyor? Onay bekleyen bir şey var mı?",
    "Yazılımcı'ya bu hatanın kök nedenini araştırma görevi ver ve 60 saniye bekle.",
    "Şu üç hedefi uygulamaya ekle ve ilkini ekibe başlat: …",
]
EXAMPLES_EN = [
    "Give the Researcher in the studio this task: summarize the competitors' pricing pages; show me the result when done.",
    "What is running in the studio right now? Is anything waiting for approval?",
    "Give the Developer a task to investigate the root cause of this bug and wait 60 seconds.",
    "Add these three goals to the studio and start the first one with the team: …",
]
