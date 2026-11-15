"""MCP bağlayıcı kataloğu (CG2, dalga 2): yaygın MCP sunucularının seçilmiş, etiketli listesi.

Her kayıt: ad, amaç, kurulum komutu (Claude Code ve Codex), gerekli ortam değişkeni ADLARI (asla değer), güvenilirlik
etiketi ("resmi" | "topluluk" | "deneysel"), doğrulama durumu ve kaynağı, VoxCrew'de açtığı özellikler (teslim
hedefleri, tetikleyiciler, tarifler).

"Tek tık" = önce birebir komutu göster, sonra yapılandırmayı DEĞİŞİKLİK SERVİSİNDEN ekle (plan → açık onay → yedek →
atomik yazım → geri al). Hiçbir şey kendiliğinden kurulmaz; paket indirilmez, komut çalıştırılmaz. `~/.claude` ve
`~/.codex` dosyalarına doğrudan yazılmaz:
- Claude Code: seçilen proje klasöründeki `.mcp.json` (ortam değişkenleri `${AD}` olarak; değer yazılmaz).
- Codex: `~/.codex/config.toml` içine `[mcp_servers.<id>]` bloğu (`env_vars` = yalnızca adlar; kabuktan iletilir).
- VoxCrew'in kendi araç köprüsü: yerel stdio sunucuları "MCP sunucusu ekle" akışıyla eklenir. Karar 1: ortam değişkeni
  isteyen kayıtlar `env_refs` (yalnızca ADLAR) ile, adları sayan açık onaydan sonra eklenir; değer VoxCrew'in kendi
  ortamından sunucu başlarken alt sürece kopyalanır, hiçbir yere yazılmaz. Katalog yalnızca "tanımlı / tanımlı değil"
  ve değersiz, işletim sistemine göre bir tanımlama ipucu gösterir.

Doğrulama: komut ve paket adları 2026-10-19'da resmî kaynaklardan (proje README'si, satıcı belgesi) kontrol edildi.
`verified` = paket ve komut biçimi kaynakta birebir; `partial` = paket adı doğrulandı, CLI biçimi Claude Code / Codex
belgelerindeki genel sözdiziminden kuruldu; `unverified` = doğrulanamadı (kurulum önerilmez, yalnız bilgi).
"""

from __future__ import annotations

import copy
import json
import re
from typing import Any

from studio._edition import EDITION

VERIFIED_AT = "2026-10-19"
RELIABILITY = ("resmi", "topluluk", "deneysel")
VERIFICATION = ("verified", "partial", "unverified")
PARAM_RE = re.compile(r"<([A-Z_]+)>")


def L(tr: str, en: str) -> dict[str, str]:
    return {"tr": tr, "en": en}


# launch: stdio → {command, args}; http → {url}. Yer tutucular <KLASOR> gibi; kurulumda kullanıcı doldurur.
CATALOG: list[dict[str, Any]] = [
    {
        "id": "filesystem", "category": "files", "reliability": "resmi",
        "name": L("Dosya sistemi", "Filesystem"),
        "purpose": L("Ajanlara seçtiğin klasörde dosya okuma/yazma aracı verir.",
                     "Gives agents read/write tools for a folder you choose."),
        "transport": "stdio",
        "launch": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "<KLASOR>"]},
        "env": [], "env_optional": [],
        "params": {"KLASOR": L("İzin verilecek klasör (tam yol)", "Folder to allow (full path)")},
        "verification": {"status": "verified", "source": "https://github.com/modelcontextprotocol/servers"},
        "unlocks": {"delivery": [], "triggers": [], "recipes": ["belge-taslagi", "ajans-aylik-rapor"]},
        "notes": L("Klasör tetikleyicisi bu sunucuya gerek duymaz (uygulama kendisi yoklar).",
                   "The folder trigger does not need this server (the studio polls the folder itself)."),
    },
    {
        "id": "github", "category": "code", "reliability": "resmi",
        "name": L("GitHub", "GitHub"),
        "purpose": L("Depo, issue ve PR'ları ajan araçları olarak açar.", "Exposes repos, issues and PRs as agent tools."),
        "transport": "stdio",
        "launch": {"command": "docker", "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
                                                 "ghcr.io/github/github-mcp-server"]},
        "env": ["GITHUB_PERSONAL_ACCESS_TOKEN"], "env_optional": [],
        "verification": {"status": "partial", "source": "https://github.com/github/github-mcp-server",
                         "note": L("Claude Code biçimi README'de; Codex biçimi genel sözdiziminden.",
                                   "Claude Code form is in the README; the Codex form follows the generic syntax.")},
        "unlocks": {"delivery": [], "triggers": [], "recipes": ["kod-inceleme"]},
        "notes": L("PR/issue teslimi zaten `gh` CLI ile çalışır; bu sunucu ajanların okuması içindir. Uzak sürüm: "
                   "https://api.githubcopilot.com/mcp/ (Docker gerekmez).",
                   "PR/issue delivery already works through the `gh` CLI; this server is for agents to read. Remote "
                   "option: https://api.githubcopilot.com/mcp/ (no Docker needed)."),
    },
    {
        "id": "notion", "category": "notes", "reliability": "resmi",
        "name": L("Notion", "Notion"),
        "purpose": L("Notion sayfalarını okur ve sayfa oluşturur.", "Reads Notion pages and creates new ones."),
        "transport": "http", "launch": {"url": "https://mcp.notion.com/mcp"},
        "env": [], "env_optional": [],
        "verification": {"status": "verified", "source": "https://developers.notion.com/docs/get-started-with-mcp"},
        "unlocks": {"delivery": ["notion"], "triggers": [], "recipes": ["belge-taslagi", "toplanti-eylem"]},
        "notes": L("Barındırılan sunucu OAuth ile giriş ister (Claude Code'da /mcp). Yerel paket "
                   "@notionhq/notion-mcp-server artık bakım görmüyor.",
                   "The hosted server signs in with OAuth (/mcp in Claude Code). The local package "
                   "@notionhq/notion-mcp-server is no longer maintained."),
    },
    {
        "id": "slack", "category": "chat", "reliability": "topluluk",
        "name": L("Slack", "Slack"),
        "purpose": L("Kanallara ileti gönderir ve kanal geçmişini okur.", "Posts to channels and reads channel history."),
        "transport": "stdio", "launch": {"command": "npx", "args": ["-y", "@zencoderai/slack-mcp-server"]},
        "env": ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"], "env_optional": ["SLACK_CHANNEL_IDS"],
        "verification": {"status": "partial", "source": "https://github.com/zencoderai/slack-mcp-server",
                         "note": L("Eski @modelcontextprotocol/server-slack arşivlendi; bakım Zencoder'da. Slack'in "
                                   "resmî sunucusu (https://mcp.slack.com/mcp) kayıtlı uygulama ve yönetici onayı ister.",
                                   "The old @modelcontextprotocol/server-slack is archived; Zencoder maintains it now. "
                                   "Slack's official server (https://mcp.slack.com/mcp) needs a registered app and "
                                   "admin approval.")},
        "unlocks": {"delivery": ["slack"], "triggers": [], "recipes": ["sabah-brifingi"]},
    },
    {
        "id": "google-workspace", "category": "mail", "reliability": "topluluk",
        "name": L("Google Workspace (Gmail, Takvim, Drive, Docs)", "Google Workspace (Gmail, Calendar, Drive, Docs)"),
        "purpose": L("Gmail iletilerini okur ve taslak oluşturur, takvim etkinliklerini listeler, Drive/Docs belgeleri açar.",
                     "Reads Gmail and creates drafts, lists calendar events, opens Drive/Docs files."),
        "transport": "stdio",
        "launch": {"command": "uvx", "args": ["workspace-mcp", "--tools", "gmail", "drive", "calendar", "docs"]},
        "env": ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"], "env_optional": [],
        "verification": {"status": "partial", "source": "https://github.com/taylorwilsdon/google_workspace_mcp",
                         "note": L("README Claude Code için yalnız HTTP biçimi veriyor; stdio komutu genel sözdiziminden. "
                                   "Resmî @modelcontextprotocol/server-gdrive arşivlendi.",
                                   "The README shows only the HTTP form for Claude Code; the stdio command follows "
                                   "the generic syntax. The official @modelcontextprotocol/server-gdrive is archived.")},
        "unlocks": {"delivery": ["email_draft", "gdocs"], "triggers": ["email_label", "meeting_end"],
                    "recipes": ["gelen-kutusu", "musteri-yaniti", "toplanti-eylem"]},
        "notes": L("Kendi Google OAuth istemcini oluşturman gerekir. Arşivlenmiş Gmail sunucularını (ör. "
                   "server-gmail-autoauth-mcp) kullanma.",
                   "You need your own Google OAuth client. Do not use archived Gmail servers (e.g. "
                   "server-gmail-autoauth-mcp)."),
    },
    {
        "id": "google-calendar", "category": "calendar", "reliability": "topluluk",
        "name": L("Google Takvim", "Google Calendar"),
        "purpose": L("Takvim etkinliklerini listeler (toplantı bitişi tetikleyicisi için).",
                     "Lists calendar events (for the meeting-end trigger)."),
        "transport": "stdio", "launch": {"command": "npx", "args": ["-y", "@cocal/google-calendar-mcp"]},
        "env": ["GOOGLE_OAUTH_CREDENTIALS"], "env_optional": [],
        "verification": {"status": "partial", "source": "https://github.com/nspady/google-calendar-mcp",
                         "note": L("GOOGLE_OAUTH_CREDENTIALS bir kimlik dosyasının yoludur.",
                                   "GOOGLE_OAUTH_CREDENTIALS is the path to a credentials file.")},
        "unlocks": {"delivery": [], "triggers": ["meeting_end"], "recipes": ["toplanti-eylem"]},
    },
    {
        "id": "ms365", "category": "mail", "reliability": "topluluk",
        "name": L("Microsoft 365 (Outlook posta ve takvim)", "Microsoft 365 (Outlook mail and calendar)"),
        "purpose": L("Outlook postalarını okur ve taslak oluşturur, takvim etkinliklerini listeler.",
                     "Reads Outlook mail and creates drafts, lists calendar events."),
        "transport": "stdio", "launch": {"command": "npx", "args": ["-y", "@softeria/ms-365-mcp-server"]},
        "env": [], "env_optional": ["MS365_MCP_CLIENT_ID", "MS365_MCP_TENANT_ID"],
        "verification": {"status": "verified", "source": "https://github.com/Softeria/ms-365-mcp-server",
                         "note": L("Microsoft'un değil, topluluğun sunucusu. İş/okul hesabı için --org-mode.",
                                   "A community server, not Microsoft's. Add --org-mode for work/school accounts.")},
        "unlocks": {"delivery": ["email_draft"], "triggers": ["email_label", "meeting_end"],
                    "recipes": ["gelen-kutusu", "musteri-yaniti", "toplanti-eylem"]},
        "notes": L("İlk kullanımda cihaz koduyla giriş ister.", "Asks for a device-code sign-in on first use."),
    },
    {
        "id": "playwright", "category": "browser", "reliability": "resmi",
        "name": L("Tarayıcı (Playwright)", "Browser (Playwright)"),
        "purpose": L("Ajanlara web sayfası açma, tıklama ve okuma aracı verir.", "Lets agents open, click and read web pages."),
        "transport": "stdio", "launch": {"command": "npx", "args": ["@playwright/mcp@latest"]},
        "env": [], "env_optional": [],
        "verification": {"status": "verified", "source": "https://github.com/microsoft/playwright-mcp"},
        "unlocks": {"delivery": [], "triggers": [], "recipes": ["rakip-taramasi", "pazar-arastirmasi"]},
        "notes": L("Node 18+ gerekir.", "Needs Node 18+."),
    },
    {
        "id": "brave-search", "category": "search", "reliability": "resmi",
        "name": L("Web araması (Brave)", "Web search (Brave)"),
        "purpose": L("Ajanlara web araması aracı verir.", "Gives agents a web search tool."),
        "transport": "stdio", "launch": {"command": "npx", "args": ["-y", "@brave/brave-search-mcp-server"]},
        "env": ["BRAVE_API_KEY"], "env_optional": [],
        "verification": {"status": "partial", "source": "https://github.com/brave/brave-search-mcp-server",
                         "note": L("Eski @modelcontextprotocol/server-brave-search arşivlendi.",
                                   "The old @modelcontextprotocol/server-brave-search is archived.")},
        "unlocks": {"delivery": [], "triggers": [], "recipes": ["rakip-taramasi", "pazar-arastirmasi"]},
    },
    {
        "id": "fetch", "category": "search", "reliability": "resmi",
        "name": L("Web sayfası okuma (fetch)", "Web page fetch"),
        "purpose": L("Bir adresin içeriğini indirip metne çevirir.", "Downloads a URL and turns it into text."),
        "transport": "stdio", "launch": {"command": "uvx", "args": ["mcp-server-fetch"]},
        "env": [], "env_optional": [],
        "verification": {"status": "partial", "source": "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch"},
        "unlocks": {"delivery": [], "triggers": [], "recipes": ["rakip-taramasi", "pazar-arastirmasi"]},
    },
]
BY_ID = {e["id"]: e for e in CATALOG}


class CatalogError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def tr_en(v: Any, lang: str) -> Any:
    return v.get(lang) or v.get("tr") if isinstance(v, dict) and ("tr" in v or "en" in v) else v


def _q(a: str) -> str:
    return a if re.fullmatch(r"[A-Za-z0-9_./:=@%+,<>-]+", a) else '"' + a.replace('"', '\\"') + '"'


def commands(e: dict[str, Any]) -> dict[str, str]:
    """Birebir kurulum komutları (gösterim). Ortam değişkeni değerleri yer tutucudur: <AD>."""
    sid = e["id"]
    if e["transport"] == "http":
        url = e["launch"]["url"]
        return {"claude": f"claude mcp add --transport http {sid} {url}", "codex": f"codex mcp add {sid} --url {url}"}
    cmd = " ".join(_q(x) for x in [e["launch"]["command"], *e["launch"]["args"]])
    envs = " ".join(f"-e {n}=<{n}>" for n in e["env"])
    cenvs = " ".join(f"--env {n}=<{n}>" for n in e["env"])
    return {"claude": " ".join(x for x in ("claude mcp add", sid, envs, "--", cmd) if x),
            "codex": " ".join(x for x in ("codex mcp add", sid, cenvs, "--", cmd) if x)}


def voxcrew_server(e: dict[str, Any]) -> dict[str, Any] | None:
    """VoxCrew araç köprüsüne eklenebilir yapılandırma (yer tutucu yoksa; HTTP OAuth yoksa). Gerekli ortam
    değişkenleri `env_refs` olarak (yalnızca adlar) gelir; eklemek adları sayan açık onay ister (karar 1)."""
    if e["transport"] != "stdio" or any(PARAM_RE.search(a) for a in e["launch"]["args"]):
        return None
    out: dict[str, Any] = {"id": e["id"], "name": e["name"]["tr"], "transport": "stdio",
                           "command": e["launch"]["command"], "args": list(e["launch"]["args"]), "enabled": True}
    if e["env"]:
        out["env_refs"] = list(e["env"])
    return out


def env_platform() -> str:
    import sys  # noqa: PLC0415
    return "windows" if sys.platform == "win32" else "macos" if sys.platform == "darwin" else "linux"


def env_hint(names: list[str], platform: str | None = None, lang: str = "tr") -> dict[str, Any] | None:
    """Ortam değişkenini tanımlama ipucu — DEĞER YOK, yalnızca `<değer>` yer tutucusu. VoxCrew yeniden başlatılınca
    yeni değeri görür (değişken, stüdyoyu başlatan kabuktan/oturumdan miras alınır). `rc`: POSIX kabuk dosyası."""
    if not names:
        return None
    plat = platform or env_platform()
    ph = "<value>" if lang == "en" else "<değer>"
    if plat == "windows":
        return {"platform": plat, "rc": None, "lines": [f'setx {n} "{ph}"' for n in names]}
    rc = "~/.zshrc" if plat == "macos" else "~/.bashrc"
    return {"platform": plat, "rc": rc, "lines": [f'export {n}="{ph}"' for n in names]}


def public(e: dict[str, Any], lang: str, configured: dict[str, list[str]] | None = None) -> dict[str, Any]:
    v = e["verification"]
    out = {
        "id": e["id"], "category": e["category"], "name": tr_en(e["name"], lang), "purpose": tr_en(e["purpose"], lang),
        "reliability": e["reliability"], "transport": e["transport"], "launch": copy.deepcopy(e["launch"]),
        "env": list(e["env"]), "env_optional": list(e["env_optional"]),
        "params": {k: tr_en(v2, lang) for k, v2 in (e.get("params") or {}).items()},
        "verification": {"status": v["status"], "source": v.get("source"), "checked_at": VERIFIED_AT,
                         "note": tr_en(v.get("note"), lang) if v.get("note") else None},
        "unlocks": copy.deepcopy(e["unlocks"]), "notes": tr_en(e.get("notes"), lang) if e.get("notes") else None,
        "commands": commands(e), "voxcrew_server": voxcrew_server(e),
        "configured": (configured or {}).get(e["id"], []),
        "env_status": _env_status(e["env"]), "env_hint": env_hint(list(e["env"]), lang=lang),
    }
    return out


def _env_status(names: list[str]) -> list[dict[str, Any]]:
    from studio.tools.mcp_client import env_status  # noqa: PLC0415 - yalnızca "tanımlı mı" (değer dönmez)
    return env_status(names)


# ---------------------------------------------------------------- yapılandırma planları (yazmaz)
def _fill(e: dict[str, Any], params: dict[str, Any], validate_dir: Any) -> list[str]:
    args = []
    for a in e["launch"].get("args") or []:
        m = PARAM_RE.fullmatch(a)
        if m:
            val = str((params or {}).get(m.group(1)) or "").strip()
            if not val:
                raise CatalogError(f"Eksik değer: {m.group(1)}")
            args.append(str(validate_dir(val)))
        elif PARAM_RE.search(a):
            raise CatalogError("Desteklenmeyen yer tutucu")
        else:
            args.append(a)
    return args


def claude_entry(e: dict[str, Any], args: list[str]) -> dict[str, Any]:
    if e["transport"] == "http":
        return {"type": "http", "url": e["launch"]["url"]}
    out: dict[str, Any] = {"command": e["launch"]["command"], "args": args}
    if e["env"]:
        out["env"] = {n: "${" + n + "}" for n in e["env"]}  # değer yok: Claude Code ortamdan genişletir
    return out


def plan_claude_json(current: str | None, e: dict[str, Any], args: list[str]) -> tuple[str, str]:
    """Proje `.mcp.json` metni → (yeni metin, eylem: add | keep). Var olan farklı kayıt ezilmez (409)."""
    data: dict[str, Any] = {}
    if current and current.strip():
        try:
            data = json.loads(current)
        except ValueError:
            raise CatalogError(".mcp.json geçerli JSON değil; elle düzelt") from None
        if not isinstance(data, dict):
            raise CatalogError(".mcp.json bir nesne olmalı")
    servers = data.get("mcpServers") if isinstance(data.get("mcpServers"), dict) else {}
    entry = claude_entry(e, args)
    if e["id"] in servers:
        if servers[e["id"]] == entry:
            return current or "", "keep"
        raise CatalogError(f"`{e['id']}` adlı sunucu .mcp.json içinde zaten var ve farklı; var olan ayar ezilmez", 409)
    data["mcpServers"] = {**servers, e["id"]: entry}
    nl = "\r\n" if current and "\r\n" in current else "\n"
    return json.dumps(data, ensure_ascii=False, indent=2).replace("\n", nl) + nl, "add"


def _toml_str(v: str) -> str:
    return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'


def plan_codex_toml(current: str | None, e: dict[str, Any], args: list[str]) -> tuple[str, str]:
    """`~/.codex/config.toml` sonuna `[mcp_servers.<id>]` bloğu; varsa dokunulmaz (keep / 409)."""
    import tomllib  # noqa: PLC0415

    text = current or ""
    try:
        data = tomllib.loads(text) if text.strip() else {}
    except tomllib.TOMLDecodeError as exc:
        raise CatalogError(f"config.toml okunamadı: {exc}") from None
    if e["id"] in (data.get("mcp_servers") or {}):
        raise CatalogError(f"`{e['id']}` adlı MCP sunucusu config.toml içinde zaten var; var olan ayar ezilmez", 409)
    nl = "\r\n" if "\r\n" in text else "\n"
    lines = [f"# VoxCrew MCP kataloğu: {e['name']['tr']}" +
             (f" — gerekli ortam değişkenleri: {', '.join(e['env'])}" if e["env"] else ""),
             f"[mcp_servers.{e['id']}]"]
    if e["transport"] == "http":
        lines.append(f"url = {_toml_str(e['launch']['url'])}")
    else:
        lines.append(f"command = {_toml_str(e['launch']['command'])}")
        lines.append("args = [" + ", ".join(_toml_str(a) for a in args) + "]")
        if e["env"]:
            lines.append("env_vars = [" + ", ".join(_toml_str(n) for n in e["env"]) + "]")
    prefix = text if not text or text.endswith(("\n", "\r\n")) else text + nl
    sep = nl if prefix.strip() else ""
    return prefix + sep + nl.join(lines) + nl, "add"


def configured_in(voxcrew: list[dict[str, Any]], codex_text: str | None) -> dict[str, list[str]]:
    """Katalog kaydı nerede zaten tanımlı (salt okuma): VoxCrew araç köprüsü ve Codex config.toml."""
    out: dict[str, list[str]] = {}
    for e in CATALOG:
        pkg = next((a for a in (e["launch"].get("args") or []) if a.startswith("@") or "mcp" in a), None)
        for s in voxcrew:
            hay = " ".join([str(s.get("command") or ""), *(str(a) for a in s.get("args") or []), str(s.get("url") or "")])
            if s.get("id") == e["id"] or (pkg and pkg in hay) or (e["transport"] == "http" and e["launch"]["url"] in hay):
                out.setdefault(e["id"], []).append("voxcrew")
                break
    if codex_text:
        try:
            import tomllib  # noqa: PLC0415
            names = set((tomllib.loads(codex_text).get("mcp_servers") or {}).keys())
        except Exception:  # noqa: BLE001
            names = set()
        for e in CATALOG:
            if e["id"] in names:
                out.setdefault(e["id"], []).append("codex")
    return out


def validate_catalog() -> list[str]:
    """Kayıt şeması (testler): alanlar, etiketler, sır olmayan env adları, açılan özelliklerin gerçekliği."""
    from studio.delivery.adapters import ADAPTERS  # noqa: PLC0415
    from studio.schedule.triggers import MCP_KINDS  # noqa: PLC0415

    recipes: set[str] = set()
    if EDITION == "full":
        from studio.full.recipes import RECIPES  # noqa: PLC0415
        recipes = {r["id"] for r in RECIPES}
    errors: list[str] = []
    for e in CATALOG:
        eid = e.get("id")
        if e.get("reliability") not in RELIABILITY:
            errors.append(f"{eid}: güvenilirlik etiketi")
        if e["verification"].get("status") not in VERIFICATION:
            errors.append(f"{eid}: doğrulama durumu")
        if e["verification"].get("status") != "unverified" and not str(e["verification"].get("source") or "").startswith("https://"):
            errors.append(f"{eid}: doğrulama kaynağı yok")
        for n in [*e["env"], *e["env_optional"]]:
            if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,60}", n):
                errors.append(f"{eid}: env adı {n}")
        for k in ("name", "purpose"):
            if not all(e[k].get(x) for x in ("tr", "en")):
                errors.append(f"{eid}: {k} tr/en")
        for d in e["unlocks"]["delivery"]:
            if d not in ADAPTERS:
                errors.append(f"{eid}: bilinmeyen teslim hedefi {d}")
        for t in e["unlocks"]["triggers"]:
            if t not in MCP_KINDS:
                errors.append(f"{eid}: bilinmeyen tetikleyici {t}")
        for r in e["unlocks"]["recipes"]:
            if r not in recipes:
                errors.append(f"{eid}: bilinmeyen tarif {r}")
    return errors

