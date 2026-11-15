"""Codex `config.toml` ve Claude Code `.mcp.json` için metin dönüşümleri (Ekip S11).

Bu modül YAZMAZ: yalnızca var olan metinden yeni metni üretir. Yazım, değişiklik servisi
(`studio.changes.plan_text` → kullanıcı onayı → `/api/changes/plans/{id}/apply`) üzerinden yapılır.

Codex:
- `[mcp_servers.voxcrew]` bloğu (ve `.env` alt tablosu) idempotent olarak eklenir ya da güncellenir;
  dosyadaki diğer tablolar, yorumlar ve satır sonu biçimi (CRLF/LF) korunur.
- İsteğe bağlı kök `notify` satırı yalnızca hiç `notify` yoksa eklenir. Var olan `notify` ezilmez; çakışma
  sonuçta bildirilir.
- Her dönüşümden sonra `tomllib` ile doğrulanır: ilgili anahtarlar dışında hiçbir değer değişmemiş olmalıdır.
"""

from __future__ import annotations

import json
import re
import tomllib
from dataclasses import dataclass, field
from typing import Any

from studio import brand

SERVER_NAME = brand.SLUG  # MCP sunucu adı: eklenti .mcp.json ve studio-mcp.mjs ile aynı ("voxcrew")
DEFAULT_STUDIO_URL = "http://127.0.0.1:7420"
STARTUP_TIMEOUT_S = 20
TOOL_TIMEOUT_S = 150  # run_task en fazla 120 sn bekler

_N = re.escape(SERVER_NAME)
_OUR_HEADER = re.compile(
    rf"""^\s*\[\s*mcp_servers\s*\.\s*(?:{_N}|"{_N}"|'{_N}')\s*(?:\.\s*[^\]]+)?\]\s*(?:\#.*)?$""")
_ANY_HEADER = re.compile(r"^\s*\[")
_MARK = f"# {brand.NAME} MCP sunucusu (uygulama arayüzünden, kullanıcı onayıyla eklendi)"
_NOTIFY_MARK = f"# {brand.NAME} oturum takibi (Codex notify; kullanıcı onayıyla eklendi)"


class ConfigError(ValueError):
    """Dosya ayrıştırılamıyor ya da güvenle düzenlenemiyor (kullanıcı elle düzenlemeli)."""


@dataclass
class CodexEdit:
    text: str
    block: str
    action: str  # "add" | "update" | "keep"
    notify: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


def toml_string(value: str) -> str:
    """Windows yollarına uygun TOML dizesi: mümkünse literal ('...'), değilse kaçışlı temel dize."""
    if "'" not in value and not any(ord(c) < 32 for c in value):
        return f"'{value}'"
    return json.dumps(value, ensure_ascii=False)


def codex_block(server_path: str, studio_url: str = DEFAULT_STUDIO_URL) -> list[str]:
    lines = [f"[mcp_servers.{SERVER_NAME}]", 'command = "node"', f"args = [{toml_string(server_path)}]",
             f"startup_timeout_sec = {STARTUP_TIMEOUT_S}", f"tool_timeout_sec = {TOOL_TIMEOUT_S}"]
    if studio_url.rstrip("/") != DEFAULT_STUDIO_URL:
        lines += ["", f"[mcp_servers.{SERVER_NAME}.env]", f"STUDIO_URL = {toml_string(studio_url.rstrip('/'))}"]
    return lines


def notify_value(hook_path: str, studio_url: str = DEFAULT_STUDIO_URL) -> list[str]:
    url = studio_url.rstrip("/") or DEFAULT_STUDIO_URL
    # QA-F3 m5: stüdyo varsayılan portta değilse hook betiği adresi taşımalı (S9 setup.py ile aynı kural)
    return ["node", hook_path, "--source", "codex"] + (["--url", url] if url != DEFAULT_STUDIO_URL else [])


def notify_line(hook_path: str, studio_url: str = DEFAULT_STUDIO_URL) -> str:
    return "notify = [" + ", ".join(toml_string(v) for v in notify_value(hook_path, studio_url)) + "]"


def _parse(text: str, what: str) -> dict[str, Any]:
    try:
        return tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"{what} geçerli TOML değil ({exc}); önce dosyayı düzelt") from None


def _without_ours(data: dict[str, Any]) -> dict[str, Any]:
    out = dict(data)
    servers = dict(out.pop("mcp_servers", None) or {})
    servers.pop(SERVER_NAME, None)
    if servers:
        out["mcp_servers"] = servers
    out.pop("notify", None)
    return out


def _header_flags(lines: list[str]) -> list[bool]:
    """Hangi satırlar gerçek tablo başlığı? Çok satırlı dizelerin (\"\"\" / ''') içindeki `[` ile başlayan satırlar
    (ör. Markdown bağlantıları) başlık sayılmaz. Kaba bir tarayıcıdır; sonuç ayrıca tomllib ile doğrulanır."""
    flags: list[bool] = []
    open_delim: str | None = None
    for line in lines:
        if open_delim:
            flags.append(False)
            if line.count(open_delim) % 2 == 1:
                open_delim = None
            continue
        flags.append(bool(_ANY_HEADER.match(line)))
        code = line.split("#", 1)[0] if '"' not in line and "'" not in line else line
        for delim in ('"""', "'''"):
            if code.count(delim) % 2 == 1:
                open_delim = delim
                break
    return flags


def _block_span(lines: list[str]) -> tuple[int, int] | None:
    """Bizim tablomuzun [başlangıç, bitiş) satır aralığı; alt tablolar (`.env` vb.) dahil, sondaki boş satır ve
    yorumlar hariç (onlar bir sonraki tabloya ait olabilir)."""
    flags = _header_flags(lines)
    ours = [i for i, l in enumerate(lines) if flags[i] and _OUR_HEADER.match(l)]
    if not ours:
        return None
    start = ours[0]
    end = len(lines)
    for j in range(start + 1, len(lines)):
        if flags[j] and not _OUR_HEADER.match(lines[j]):
            end = j
            break
    while end > start + 1 and (not lines[end - 1].strip() or lines[end - 1].lstrip().startswith("#")):
        end -= 1
    # aynı tablonun dosyanın başka yerinde ikinci bir parçası (ör. alt tablo ayrı yazılmış) varsa elle düzenlensin
    if any(i >= end for i in ours):
        raise ConfigError(f"[mcp_servers.{SERVER_NAME}] dosyada birden fazla yerde tanımlı; elle birleştir")
    return start, end


def plan_codex_config(current: str | None, server_path: str, *, studio_url: str = DEFAULT_STUDIO_URL,
                      hook_path: str | None = None) -> CodexEdit:
    """Var olan config.toml metninden (None = dosya yok) yeni metni üretir. Yazmaz."""
    text = current or ""
    nl = "\r\n" if "\r\n" in text else "\n"
    before = _parse(text, "config.toml")
    lines = text.splitlines()
    notes: list[str] = []
    block = codex_block(server_path, studio_url)

    # 1) isteğe bağlı kök notify — var olanı ASLA ezme
    notify: dict[str, Any] = {"requested": hook_path is not None}
    if hook_path is not None:
        desired = notify_value(hook_path, studio_url)
        existing = before.get("notify")
        if existing is None:
            first_table = next((i for i, f in enumerate(_header_flags(lines)) if f), len(lines))
            insert = [_NOTIFY_MARK, notify_line(hook_path, studio_url)]
            if first_table < len(lines):
                insert.append("")
            if first_table > 0 and lines[first_table - 1].strip():
                insert.insert(0, "")
            lines[first_table:first_table] = insert
            notify.update(status="added", value=desired)
        elif existing == desired:
            notify.update(status="exists_same", value=desired)
        else:
            notify.update(status="conflict", existing=existing, desired=desired)
            notes.append("config.toml dosyasında zaten bir notify programı var; Codex yalnızca bir notify çalıştırır. "
                         "Var olan satır korunur, uygulama takibi için eklenmedi.")
    else:
        notify["status"] = "skipped"

    # 2) [mcp_servers.voxcrew] bloğu
    exists_in_data = SERVER_NAME in (before.get("mcp_servers") or {})
    span = _block_span(lines)
    if span is None and exists_in_data:
        raise ConfigError(f"'{SERVER_NAME}' sunucusu config.toml içinde satır içi (inline) ya da noktalı anahtarla "
                          f"tanımlı; [mcp_servers.{SERVER_NAME}] tablosuna çevirip yeniden dene ya da elle düzenle")
    if span is None:
        while lines and not lines[-1].strip():
            lines.pop()
        if lines:
            lines.append("")
        lines += [_MARK, *block]
        action = "add"
    else:
        start, end = span
        action = "keep" if lines[start:end] == block else "update"
        lines[start:end] = block
    new_text = nl.join(lines) + nl

    # 3) doğrulama: yalnızca bizim anahtarlarımız değişmiş olmalı
    after = _parse(new_text, "Üretilen config.toml")
    if _without_ours(after) != _without_ours(before):
        raise ConfigError("config.toml güvenle düzenlenemedi (beklenmeyen yapı); bloğu elle ekle")
    if (after.get("mcp_servers") or {}).get(SERVER_NAME, {}).get("args") != [server_path]:
        raise ConfigError("Üretilen blok doğrulanamadı; bloğu elle ekle")
    if "notify" in before and after.get("notify") != before.get("notify"):
        raise ConfigError("Var olan notify değeri korunamadı; işlem durduruldu")
    if action == "keep" and new_text != (current or ""):
        action = "update"
    if current is None:
        notes.append("config.toml henüz yok; onaylarsan yeni dosya oluşturulur.")
    return CodexEdit(text=new_text, block=nl.join(block), action=action, notify=notify, notes=notes)


# ---------------------------------------------------------------------------- Claude Code .mcp.json
def claude_entry(server_path: str, studio_url: str = DEFAULT_STUDIO_URL) -> dict[str, Any]:
    entry: dict[str, Any] = {"type": "stdio", "command": "node", "args": [server_path]}
    if studio_url.rstrip("/") != DEFAULT_STUDIO_URL:
        entry["env"] = {"STUDIO_URL": studio_url.rstrip("/")}
    return entry


def _indent_of(text: str) -> int | str:
    m = re.search(r"^([ \t]+)\S", text, re.M)
    if not m:
        return 2
    ws = m.group(1)
    return "\t" if ws.startswith("\t") else len(ws)


def plan_claude_mcp_json(current: str | None, server_path: str, *,
                         studio_url: str = DEFAULT_STUDIO_URL) -> tuple[str, dict[str, Any]]:
    """Proje `.mcp.json` metnine voxcrew sunucusunu ekler/günceller; diğer sunucular korunur. Yazmaz."""
    data: dict[str, Any] = {}
    if current is not None and current.strip():
        try:
            data = json.loads(current)
        except json.JSONDecodeError as exc:
            raise ConfigError(f".mcp.json geçerli JSON değil ({exc.msg}, satır {exc.lineno}); önce dosyayı düzelt") from None
        if not isinstance(data, dict):
            raise ConfigError(".mcp.json bir JSON nesnesi olmalı")
    servers = data.get("mcpServers")
    if servers is None:
        servers = {}
    if not isinstance(servers, dict):
        raise ConfigError(".mcp.json içindeki mcpServers bir nesne olmalı")
    entry = claude_entry(server_path, studio_url)
    others = [k for k in servers if k != SERVER_NAME]
    previous = servers.get(SERVER_NAME)
    info = {"others": others, "action": "keep" if previous == entry else ("update" if previous else "add")}
    if previous == entry and current is not None:
        return current, info
    data = {**data, "mcpServers": {**servers, SERVER_NAME: entry}}
    nl = "\r\n" if current and "\r\n" in current else "\n"
    out = json.dumps(data, ensure_ascii=False, indent=_indent_of(current or ""))
    return out.replace("\n", nl) + nl, info
