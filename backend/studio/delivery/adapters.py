"""Teslim hedefleri (adaptörler). Her biri iki adımlıdır:

- `plan(ctx, options)` → (normalize seçenekler, yük): yan etkisizdir; gönderilecek içeriği, hedefi, yazılacak dosyaları,
  çalışacak komutları (argüman dizisi) ya da MCP aracını ve argümanlarını birebir verir. Önizleme penceresi bunu gösterir.
- `send(ctx, options, payload)`: yalnızca kullanıcı arayüzde onayladıktan sonra (servis önizleme özetini yeniden
  hesaplayıp karşılaştırır) çağrılır.

Hiçbir adaptör e-posta GÖNDERMEZ: `.eml` taslak dosyası, `mailto:` (posta istemcisi açılır, gönderme kullanıcıda) ya da
kullanıcının kendi posta MCP sunucusunda **taslak oluşturma** aracı. Adı "send/forward/reply" içeren araç asla seçilmez.
Üçüncü taraf hesabı ya da jeton saklanmaz: GitHub kullanıcının `gh` CLI oturumuyla, Notion / Google Docs / Slack yalnızca
kullanıcının ayarladığı MCP sunucularıyla çalışır.
"""

from __future__ import annotations

import asyncio
import difflib
import os
import re
import shutil
import time
import uuid
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.policy import SMTP
from pathlib import Path
from typing import Any
from urllib.parse import quote

from studio.delivery.safety import (PathRejected, one_line, shim_safe, target_file, validate_branch, validate_folder,
                                    validate_repo_path)


class DeliveryError(ValueError):
    """Kullanıcıya dönen teslim hatası (`status` HTTP kodu, `code` makine kodu)."""

    def __init__(self, message: str, status: int = 400, code: str = "delivery_error"):
        super().__init__(message)
        self.status, self.code = status, code


@dataclass
class Ctx:
    studio: Any
    item: dict[str, Any]
    text: str | None          # maskeli metin (ikili çıktıda None)
    title: str                # maskeli başlık
    stem: str                 # dosya adı kökü
    raw_path: Path | None = None  # görsel/PDF ham dosya (yalnız klasöre kopya)
    extra: dict[str, Any] = field(default_factory=dict)


def _require_text(ctx: Ctx) -> str:
    if ctx.text is None:
        raise DeliveryError("Bu çıktı metin değil; yalnızca klasöre kopyalanabilir ya da indirilebilir")
    return ctx.text


def _bool(v: Any) -> bool:
    return v is True or str(v).lower() in ("true", "1", "yes", "on")


# ================================================================ süreç çalıştırma (connectors/base.py)
# Testler sahte `gh`/`git` için buraya önek koyar: {"gh": [sys.executable, "<sahte_gh.py>"]}
EXE_OVERRIDES: dict[str, list[str]] = {}
COMMAND_TIMEOUT_S = 120.0


def exe(name: str) -> list[str] | None:
    if name in EXE_OVERRIDES:
        return list(EXE_OVERRIDES[name])
    found = shutil.which(name)
    return [found] if found else None


def tool_env() -> dict[str, str]:
    from studio.connectors.base import child_env
    return child_env({"GIT_TERMINAL_PROMPT": "0", "GH_PROMPT_DISABLED": "1", "GH_NO_UPDATE_NOTIFIER": "1",
                      "GIT_EDITOR": "true", "GH_PAGER": "", "PAGER": ""})


async def run(name: str, args: list[str], *, cwd: Path, stdin: str | None = None,
              timeout_s: float = COMMAND_TIMEOUT_S) -> tuple[int, str, str]:
    """Argüman dizisiyle (kabuk yok) çalıştırır; içerik yalnızca stdin'den gider. (dönüş kodu, stdout, stderr)"""
    from studio.connectors.base import stream_process
    prefix = exe(name)
    if prefix is None:
        raise DeliveryError(f"`{name}` bulunamadı (PATH'te yok)", 424, "tool_missing")
    argv = shim_safe([*prefix, *args], prefix[0])
    out: list[str] = []
    err: list[str] = []
    rc = 1
    async for tag, line in stream_process(argv, cwd=cwd, env=tool_env(), stdin_text=stdin, timeout_s=timeout_s):
        if tag == "out":
            out.append(line)
        elif tag == "err":
            err.append(line)
        elif tag == "timeout":
            err.append("zaman aşımı")
        elif tag == "exit":
            rc = int(line or 1)
    return rc, "\n".join(out), "\n".join(err)


def display(name: str, args: list[str]) -> str:
    """Önizlemede gösterilen komut (bilgi amaçlı; çalıştırma argüman dizisiyle yapılır)."""
    def q(a: str) -> str:
        return a if re.fullmatch(r"[A-Za-z0-9_./:=@%+,-]+", a) else '"' + a.replace('"', '\\"') + '"'
    return " ".join([name, *(q(a) for a in args)])


# ================================================================ atomik yazım
def write_bytes_atomic(path: Path, data: bytes, *, overwrite: bool) -> Path | None:
    """Geçici dosya + os.replace. Var olan dosya yalnızca `overwrite` ile ve yedeği alınarak değişir. → yedek yolu"""
    from studio.changes import _unique_backup
    backup = None
    if path.exists():
        if not overwrite:
            raise DeliveryError("Hedefte aynı adlı dosya var; üzerine yazmak için onay ver", 409, "exists")
        backup = _unique_backup(path)
        shutil.copy2(path, backup)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:6]}.studio-tmp")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    except OSError as exc:
        raise DeliveryError(f"Dosya yazılamadı: {exc.strerror or exc}", 500, "write_failed") from None
    finally:
        tmp.unlink(missing_ok=True)
    return backup


def write_text_via_changes(studio: Any, path: Path, text: str, summary: str, *, overwrite: bool) -> dict[str, Any]:
    """Metin dosyaları değişiklik servisinden geçer (kilit, yedek, atomik yazım, geri al geçmişi)."""
    if path.exists() and not overwrite:
        raise DeliveryError("Hedefte aynı adlı dosya var; üzerine yazmak için onay ver", 409, "exists")
    changes = studio.changes
    plan = changes.plan_text(path, text, summary, kind="delivery")
    try:
        return changes.apply(plan["id"], confirm=True)
    except ValueError as exc:
        raise DeliveryError(str(exc), 409, "write_failed") from None


# ================================================================ temel sınıf
class Adapter:
    id = ""
    external = False
    label = {"tr": "", "en": ""}

    async def readiness(self, studio: Any, *, check: bool = False) -> dict[str, Any]:
        return {"available": True, "ready": True, "reason": None}

    async def plan(self, ctx: Ctx, options: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        raise NotImplementedError

    async def send(self, ctx: Ctx, options: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError


# ================================================================ pano / indirme (her zaman)
class ClipboardAdapter(Adapter):
    id = "clipboard"
    label = {"tr": "Panoya kopyala", "en": "Copy to clipboard"}

    async def plan(self, ctx: Ctx, options: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        text = _require_text(ctx)
        return {}, {"summary": "Metin panoya kopyalanır", "content": text}

    async def send(self, ctx: Ctx, options: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        return {"result": "Panoya kopyalandı", "client_action": "copy", "content": payload["content"]}


class DownloadAdapter(Adapter):
    id = "download"
    label = {"tr": "İndir", "en": "Download"}
    FORMATS = ("md", "txt", "docx", "original")

    async def plan(self, ctx: Ctx, options: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        fmt = str(options.get("format") or ("md" if ctx.text is not None else "original"))
        if fmt not in self.FORMATS:
            raise DeliveryError(f"Geçersiz biçim: {fmt}")
        if fmt != "original":
            _require_text(ctx)
        name = str(ctx.item.get("name")) if fmt == "original" else f"{ctx.stem}.{fmt}"
        return {"format": fmt}, {"summary": f"Tarayıcı indirmesi: {name}", "filename": name,
                                 "content": ctx.text if fmt != "docx" else ctx.text}

    async def send(self, ctx: Ctx, options: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        return {"result": f"İndirildi: {payload['filename']}", "client_action": "download",
                "format": options["format"]}


# ================================================================ yerel klasör
class FolderAdapter(Adapter):
    id = "folder"
    label = {"tr": "Klasöre kaydet", "en": "Save to a folder"}
    FORMATS = ("md", "txt", "docx", "original")

    async def plan(self, ctx: Ctx, options: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            folder = await asyncio.to_thread(validate_folder, options.get("folder"), ctx.studio)
        except PathRejected as exc:
            raise DeliveryError(str(exc), 400, "path_rejected") from None
        fmt = str(options.get("format") or ("md" if ctx.text is not None else "original"))
        if fmt not in self.FORMATS:
            raise DeliveryError(f"Geçersiz biçim: {fmt}")
        binary = ctx.text is None
        if binary and fmt != "original":
            raise DeliveryError("Bu çıktı metin değil; yalnızca özgün dosya olarak kaydedilir")
        if binary and ctx.raw_path is None:
            raise DeliveryError("Bu dosya türü klasöre kopyalanamaz")
        default = str(ctx.item.get("name") or f"{ctx.stem}.txt") if fmt == "original" else f"{ctx.stem}.{fmt}"
        filename = str(options.get("filename") or default).strip()
        try:
            path = target_file(folder, filename)
        except PathRejected as exc:
            raise DeliveryError(str(exc), 400, "path_rejected") from None
        overwrite = _bool(options.get("overwrite"))
        exists = path.exists()
        payload = {"summary": f"{path} dosyasına yazılır" + (" (var olan dosyanın üzerine, yedek alınarak)"
                                                            if exists else ""),
                   "path": str(path), "format": fmt, "exists": exists, "overwrite": overwrite,
                   "content": ctx.text, "binary": binary,
                   "size": (ctx.raw_path.stat().st_size if binary and ctx.raw_path else len((ctx.text or "").encode()))}
        if exists and not overwrite:
            payload["warnings"] = ["Hedefte aynı adlı dosya var. Üzerine yazmak için kutuyu işaretle ya da adı değiştir."]
        return {"folder": str(folder), "format": fmt, "filename": path.name, "overwrite": overwrite}, payload

    async def send(self, ctx: Ctx, options: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        path = Path(payload["path"])
        fmt = options["format"]
        overwrite = bool(options.get("overwrite"))

        def write() -> dict[str, Any]:
            if fmt == "docx":
                from studio.deliverables.export import markdown_to_docx
                backup = write_bytes_atomic(path, markdown_to_docx(ctx.text or "", ctx.title), overwrite=overwrite)
                return {"backup": str(backup) if backup else None}
            if payload.get("binary"):
                backup = write_bytes_atomic(path, Path(str(ctx.raw_path)).read_bytes(), overwrite=overwrite)
                return {"backup": str(backup) if backup else None}
            entry = write_text_via_changes(ctx.studio, path, ctx.text or "", f"Teslim: {ctx.title}",
                                           overwrite=overwrite)
            return {"backup": entry.get("backup"), "change_id": entry.get("id")}

        info = await asyncio.to_thread(write)
        return {"result": f"Klasöre kaydedildi: {path}", "path": str(path), "label": path.name, **info}


# ================================================================ e-posta taslağı (asla göndermez)
_EMAIL = re.compile(r"^[^@\s,;<>\"'()\[\]\\]+@[^@\s,;<>\"'()\[\]\\]+\.[A-Za-z]{2,}$")
MAILTO_BODY_MAX = 1800


def parse_addresses(raw: Any, field_name: str) -> list[str]:
    items = raw if isinstance(raw, list) else re.split(r"[,;\s]+", str(raw or ""))
    out = [str(a).strip() for a in items if str(a).strip()]
    if len(out) > 20:
        raise DeliveryError(f"{field_name}: en çok 20 adres")
    for a in out:
        if not _EMAIL.match(a) or len(a) > 254:
            raise DeliveryError(f"{field_name}: geçersiz e-posta adresi")
    return out


class EmailDraftAdapter(Adapter):
    id = "email_draft"
    external = True
    label = {"tr": "E-posta taslağı", "en": "Email draft"}
    MODES = ("eml", "mailto", "mcp")

    async def readiness(self, studio: Any, *, check: bool = False) -> dict[str, Any]:
        servers = [s for s in mcp_services(studio) if s["service"] == "email"]
        return {"available": True, "ready": True, "reason": None, "modes": list(self.MODES),
                "mcp_servers": [{"id": s["id"], "name": s["name"], "ready": s["ready"], "reason": s["reason"]}
                                for s in servers]}

    async def plan(self, ctx: Ctx, options: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        text = _require_text(ctx)
        mode = str(options.get("mode") or "eml")
        if mode not in self.MODES:
            raise DeliveryError("Kip 'eml', 'mailto' ya da 'mcp' olmalı")
        to = parse_addresses(options.get("to"), "Kime")
        cc = parse_addresses(options.get("cc"), "Bilgi")
        subject = one_line(options.get("subject") or ctx.title, 200) or ctx.stem
        opts: dict[str, Any] = {"mode": mode, "to": to, "cc": cc, "subject": subject}
        base = {"to": to, "cc": cc, "subject": subject, "content": text, "sends": False}
        if mode == "mailto":
            body = text if len(text) <= MAILTO_BODY_MAX else text[:MAILTO_BODY_MAX] + "\n…"
            params = [f"subject={quote(subject)}", f"body={quote(body)}"]
            if cc:
                params.append(f"cc={quote(','.join(cc))}")
            url = f"mailto:{quote(','.join(to), safe='@,')}?{'&'.join(params)}"
            warn = ["Metin uzun; posta istemcisine ilk kısmı gider. Tamamı için .eml taslağını kullan."] \
                if len(text) > MAILTO_BODY_MAX else []
            return opts, {**base, "summary": "Posta istemcin yeni bir taslakla açılır; göndermek sende.",
                          "mailto": url, "content": body, "warnings": warn}
        if mode == "eml":
            try:
                folder = await asyncio.to_thread(validate_folder, options.get("folder"), ctx.studio)
                path = target_file(folder, str(options.get("filename") or f"{ctx.stem}.eml"))
            except PathRejected as exc:
                raise DeliveryError(str(exc), 400, "path_rejected") from None
            if path.suffix.lower() != ".eml":
                raise DeliveryError("Taslak dosyasının uzantısı .eml olmalı")
            attach = str(options.get("attach") or "none")
            if attach not in ("none", "md", "docx"):
                raise DeliveryError("Ek 'none', 'md' ya da 'docx' olmalı")
            overwrite = _bool(options.get("overwrite"))
            opts.update(folder=str(folder), filename=path.name, attach=attach, overwrite=overwrite)
            payload = {**base, "summary": f"Gönderilmemiş taslak dosyası: {path} (posta istemcinde açıp gönderirsin)",
                       "path": str(path), "exists": path.exists(),
                       "attachments": [f"{ctx.stem}.{attach}"] if attach != "none" else []}
            if path.exists() and not overwrite:
                payload["warnings"] = ["Aynı adlı taslak dosyası var; üzerine yazmak için onay ver."]
            return opts, payload
        # mcp: kullanıcının posta MCP sunucusunda taslak oluşturma
        call = mcp_call_plan(ctx.studio, "email", options.get("server"),
                             {"to": to, "cc": cc, "subject": subject, "body": text, "title": subject})
        opts["server"] = call["server"]
        return opts, {**base, **call, "summary": f"{call['server_name']} üzerinde taslak oluşturulur "
                                                 f"(`{call['tool']}`); gönderilmez."}

    def build_eml(self, ctx: Ctx, options: dict[str, Any]) -> bytes:
        msg = EmailMessage(policy=SMTP)
        if options["to"]:
            msg["To"] = ", ".join(options["to"])
        if options["cc"]:
            msg["Cc"] = ", ".join(options["cc"])
        msg["Subject"] = options["subject"]
        msg["X-Unsent"] = "1"  # posta istemcileri dosyayı gönderilmemiş taslak olarak açar
        msg.set_content(ctx.text or "", charset="utf-8")
        attach = options.get("attach")
        if attach == "md":
            msg.add_attachment((ctx.text or "").encode("utf-8"), maintype="text", subtype="markdown",
                               filename=f"{ctx.stem}.md")
        elif attach == "docx":
            from studio.deliverables.export import markdown_to_docx
            msg.add_attachment(markdown_to_docx(ctx.text or "", ctx.title), maintype="application",
                               subtype="vnd.openxmlformats-officedocument.wordprocessingml.document",
                               filename=f"{ctx.stem}.docx")
        return bytes(msg)

    async def send(self, ctx: Ctx, options: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        mode = options["mode"]
        if mode == "mailto":
            return {"result": "Posta istemcisi taslakla açılıyor (gönderme sende)", "client_action": "open",
                    "link": payload["mailto"], "label": "mailto"}
        if mode == "eml":
            path = Path(payload["path"])
            data = self.build_eml(ctx, options)
            backup = await asyncio.to_thread(write_bytes_atomic, path, data, overwrite=bool(options.get("overwrite")))
            return {"result": f"Taslak dosyası oluşturuldu: {path}", "path": str(path), "label": path.name,
                    "backup": str(backup) if backup else None}
        res = await mcp_call_send(ctx.studio, payload)
        return {**res, "result": res.get("result") or "Taslak oluşturuldu", "label": "taslak"}


# ================================================================ GitHub (kullanıcının `gh` CLI'si)
_GH_CACHE: dict[str, Any] = {}
GH_CACHE_S = 60.0


async def gh_status(*, check: bool) -> dict[str, Any]:
    if exe("gh") is None:
        return {"available": False, "ready": False, "reason": "GitHub CLI (`gh`) kurulu değil",
                "hint": "https://cli.github.com"}
    if exe("git") is None:
        return {"available": False, "ready": False, "reason": "`git` kurulu değil"}
    cached = _GH_CACHE.get("auth")
    if cached and time.time() - cached["t"] < GH_CACHE_S:
        return cached["v"]
    if not check:
        return {"available": True, "ready": None, "reason": "Oturum durumu denetlenmedi"}
    try:
        rc, _out, err = await run("gh", ["auth", "status"], cwd=Path.home(), timeout_s=20)
    except DeliveryError as exc:
        return {"available": False, "ready": False, "reason": str(exc)}
    v = {"available": True, "ready": rc == 0,
         "reason": None if rc == 0 else "gh oturumu açık değil: terminalde `gh auth login` çalıştır"}
    _GH_CACHE["auth"] = {"t": time.time(), "v": v}
    return v


def _ref(url: str | None) -> str | None:
    m = re.search(r"/(?:pull|issues)/(\d+)", url or "")
    return f"#{m.group(1)}" if m else None


def _first_url(text: str) -> str | None:
    m = re.search(r"https?://[^\s\"'<>)\]]+", text or "")
    return m.group(0) if m else None


async def _repo(ctx: Ctx, raw: Any) -> Path:
    try:
        repo = await asyncio.to_thread(validate_folder, raw, ctx.studio)
    except PathRejected as exc:
        raise DeliveryError(str(exc), 400, "path_rejected") from None
    rc, out, _ = await run("git", ["rev-parse", "--show-toplevel"], cwd=repo, timeout_s=20)
    if rc != 0:
        raise DeliveryError("Bu klasör bir git deposu değil", 400, "not_a_repo")
    return repo


class GithubIssueAdapter(Adapter):
    id = "github_issue"
    external = True
    label = {"tr": "GitHub issue", "en": "GitHub issue"}

    async def readiness(self, studio: Any, *, check: bool = False) -> dict[str, Any]:
        return await gh_status(check=check)

    async def plan(self, ctx: Ctx, options: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        text = _require_text(ctx)
        repo = await _repo(ctx, options.get("repo"))
        title = one_line(options.get("title") or ctx.title, 200) or ctx.stem
        args = ["issue", "create", f"--title={title}", "--body-file=-"]
        return {"repo": str(repo), "title": title}, {
            "summary": f"{repo} deposunun GitHub'ında yeni issue açılır (gövde aşağıdaki metin)",
            "title": title, "content": text[:60000], "commands": [{"cwd": str(repo), "argv": ["gh", *args],
                                                                    "display": display("gh", args),
                                                                    "stdin": "gövde metni"}]}

    async def send(self, ctx: Ctx, options: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        cmd = payload["commands"][0]
        rc, out, err = await run("gh", cmd["argv"][1:], cwd=Path(cmd["cwd"]), stdin=payload["content"])
        if rc != 0:
            raise DeliveryError(f"gh hata verdi: {(err or out)[-400:]}", 502, "command_failed")
        link = _first_url(out)
        ref = _ref(link)
        return {"result": f"GitHub issue {ref or ''} açıldı".replace("  ", " "), "link": link, "ref": ref,
                "label": f"GitHub issue {ref}" if ref else "GitHub issue"}


class GithubPrAdapter(Adapter):
    id = "github_pr"
    external = True
    label = {"tr": "GitHub PR", "en": "GitHub PR"}

    async def readiness(self, studio: Any, *, check: bool = False) -> dict[str, Any]:
        return await gh_status(check=check)

    async def plan(self, ctx: Ctx, options: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        text = _require_text(ctx)
        repo = await _repo(ctx, options.get("repo"))
        did = str(ctx.item.get("id") or "")
        try:
            branch = validate_branch(options.get("branch") or f"delivery/{ctx.stem}-{did[-6:]}")
            rel, path = validate_repo_path(options.get("path") or f"docs/{ctx.stem}.md", repo)
        except PathRejected as exc:
            raise DeliveryError(str(exc), 400, "path_rejected") from None
        title = one_line(options.get("title") or ctx.title, 200) or ctx.stem
        base = options.get("base")
        if base:
            try:
                base = validate_branch(base)
            except PathRejected as exc:
                raise DeliveryError(str(exc), 400, "path_rejected") from None
        overwrite = _bool(options.get("overwrite"))
        rc, current, _ = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd=repo, timeout_s=20)
        current = current.strip()
        if rc != 0 or not current or current == "HEAD":
            raise DeliveryError("Deponun etkin dalı okunamadı (ayrık HEAD?)", 400, "repo_state")
        rc_b, _, _ = await run("git", ["rev-parse", "--verify", "--quiet", f"refs/heads/{branch}"], cwd=repo,
                               timeout_s=20)
        if rc_b == 0:
            raise DeliveryError(f"'{branch}' dalı zaten var; başka bir dal adı seç", 409, "branch_exists")
        before = path.read_text("utf-8", errors="replace") if path.is_file() else None
        if before is not None and not overwrite:
            warnings = [f"{rel} depoda zaten var; değiştirmek için onay ver."]
        else:
            warnings = []
        diff = list(difflib.unified_diff((before or "").splitlines(), text.splitlines(),
                                         fromfile=f"a/{rel}" if before is not None else "/dev/null",
                                         tofile=f"b/{rel}", lineterm="", n=2))[:2000]
        body = f"{title}\n\n{text}"[:60000]
        steps = [["switch", "-c", branch], None, ["add", "--", rel], ["commit", f"--message={title}", "--", rel],
                 ["push", "--set-upstream", "origin", branch]]
        gh_args = ["pr", "create", f"--title={title}", "--body-file=-", f"--head={branch}",
                   *([f"--base={base}"] if base else [])]
        commands: list[dict[str, Any]] = []
        for s in steps:
            if s is None:
                commands.append({"write": rel, "display": f"(dosya yazılır) {rel}"})
            else:
                commands.append({"cwd": str(repo), "argv": ["git", *s], "display": display("git", s)})
        commands.append({"cwd": str(repo), "argv": ["gh", *gh_args], "display": display("gh", gh_args),
                         "stdin": "PR açıklaması"})
        commands.append({"cwd": str(repo), "argv": ["git", "switch", current],
                         "display": display("git", ["switch", current]), "note": "önceki dala dönülür"})
        opts = {"repo": str(repo), "branch": branch, "path": rel, "title": title, "base": base or None,
                "overwrite": overwrite}
        return opts, {"summary": f"{repo} deposunda '{branch}' dalı açılır, {rel} eklenir ve PR oluşturulur",
                      "title": title, "branch": branch, "file": rel, "current_branch": current,
                      "exists": before is not None, "diff": diff, "content": text, "pr_body": body,
                      "commands": commands, "warnings": warnings}

    async def send(self, ctx: Ctx, options: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        repo = Path(options["repo"])
        if payload.get("exists") and not options.get("overwrite"):
            raise DeliveryError("Dosya depoda var; üzerine yazmak için onay ver", 409, "exists")
        _rel, path = validate_repo_path(options["path"], repo)
        done: list[str] = []
        switched = False
        try:
            for cmd in payload["commands"]:
                if cmd.get("note"):
                    continue
                if "write" in cmd:
                    await asyncio.to_thread(lambda: (path.parent.mkdir(parents=True, exist_ok=True),
                                                     write_bytes_atomic(path, (ctx.text or "").encode("utf-8"),
                                                                        overwrite=True)))
                    done.append(cmd["display"])
                    continue
                name, args = cmd["argv"][0], cmd["argv"][1:]
                stdin = payload["pr_body"] if name == "gh" else None
                rc, out, err = await run(name, args, cwd=repo, stdin=stdin)
                if rc != 0:
                    raise DeliveryError(f"`{cmd['display']}` başarısız: {(err or out)[-400:]}", 502, "command_failed")
                if args[:2] == ["switch", "-c"]:
                    switched = True
                done.append(cmd["display"])
                if name == "gh":
                    link = _first_url(out)
                    ref = _ref(link)
                    return {"result": f"GitHub PR {ref or ''} açıldı".replace("  ", " "), "link": link, "ref": ref,
                            "label": f"GitHub PR {ref}" if ref else "GitHub PR", "steps": done}
            raise DeliveryError("PR komutu çalışmadı", 500, "command_failed")
        finally:
            if switched:
                await run("git", ["switch", payload["current_branch"]], cwd=repo, timeout_s=30)


# ================================================================ MCP üzerinden (Notion / Google Docs / Slack / posta)
SERVICE_KEYS: dict[str, re.Pattern[str]] = {
    "email": re.compile(r"gmail|outlook|office365|m365|microsoft|exchange|imap|mail", re.I),
    "notion": re.compile(r"notion", re.I),
    "gdocs": re.compile(r"gdocs|google[-_ ]?docs|googledocs|gdrive|google[-_ ]?drive|google[-_ ]?workspace", re.I),
    "slack": re.compile(r"slack", re.I),
}
TOOL_PICK: dict[str, re.Pattern[str]] = {
    "email": re.compile(r"(create|new|save|compose|add)[-_ ]?.*draft|draft[-_ ]?.*(create|new|save|compose)", re.I),
    "notion": re.compile(r"(create|new|add)[-_ ]?.*page|page[-_ ]?.*(create|new)", re.I),
    "gdocs": re.compile(r"(create|new)[-_ ]?.*(doc|document|file)|(doc|document)[-_ ]?.*(create|new)", re.I),
    "slack": re.compile(r"(post|send)[-_ ]?.*message|chat[-_ .]?post|message[-_ ]?.*(post|send)", re.I),
}
# Taslak dışı her şey yasak (e-posta asla gönderilmez); diğer hizmetlerde silme/güncelleme seçilmez
TOOL_FORBID: dict[str, re.Pattern[str]] = {
    "email": re.compile(r"send|forward|reply|delete|trash|update|modify|schedule", re.I),
    "notion": re.compile(r"delete|archive|update|remove", re.I),
    "gdocs": re.compile(r"delete|trash|update|remove|share|permission", re.I),
    "slack": re.compile(r"delete|update|remove|schedule|dm|direct", re.I),
}
ARG_KEYS: dict[str, tuple[str, ...]] = {
    "to": ("to", "recipients", "recipient", "to_recipients", "toRecipients", "to_addresses", "emails"),
    "cc": ("cc", "cc_recipients", "ccRecipients"),
    "subject": ("subject",),
    "title": ("title", "name", "subject"),
    "body": ("body", "content", "text", "markdown", "message", "body_text", "bodyText", "html_body", "htmlBody"),
    "channel": ("channel", "channel_id", "channelId", "conversation", "conversation_id"),
    "parent": ("parent", "parent_id", "parentId", "parent_page_id", "page_id", "folder_id", "folderId",
               "database_id"),
}


def _bridge(studio: Any) -> Any:
    from studio.tools.api import bridge_for
    return bridge_for(studio)


def mcp_services(studio: Any) -> list[dict[str, Any]]:
    """Kullanıcının ayarladığı (etkin, geçerli) MCP sunucuları → hizmet türü ve uygun araç."""
    try:
        b = _bridge(studio)
        servers = b.servers()
    except Exception:  # noqa: BLE001 - araç köprüsü yoksa MCP hedefi yok
        return []
    out = []
    for cfg in servers:
        if not cfg.get("enabled") or cfg.get("invalid"):
            continue
        hay = " ".join(str(cfg.get(k) or "") for k in ("id", "name", "command", "url")) + " " + \
            " ".join(str(a) for a in cfg.get("args") or [])
        tools = b.cached_tools(cfg["id"])
        names = [str(t.get("name")) for t in tools or []]
        for service, rx in SERVICE_KEYS.items():
            if not rx.search(hay) and not (service == "email" and any(_pick(service, [n]) for n in names)):
                continue
            tool = _pick(service, names) if tools is not None else None
            reason = None
            if tools is None:
                reason = "Araç listesi yok: Bağlantılar sayfasında sunucuyu bir kez yokla"
            elif tool is None:
                reason = "Bu sunucuda uygun araç bulunamadı" + (" (taslak oluşturma)" if service == "email" else "")
            out.append({"id": cfg["id"], "name": cfg.get("name") or cfg["id"], "service": service, "tool": tool,
                        "ready": tool is not None, "reason": reason})
    return out


def _pick(service: str, names: list[str]) -> str | None:
    for n in names:
        if TOOL_PICK[service].search(n) and not TOOL_FORBID[service].search(n):
            return n
    return None


def mcp_call_plan(studio: Any, service: str, server: Any, values: dict[str, Any]) -> dict[str, Any]:
    cands = [s for s in mcp_services(studio) if s["service"] == service]
    if not cands:
        raise DeliveryError("Bu hedef için ayarlı bir MCP sunucusu yok. Bağlantılar sayfasından kendi MCP sunucunu "
                            "ekle.", 424, "mcp_missing")
    chosen = next((s for s in cands if s["id"] == server), None) if server else cands[0]
    if chosen is None:
        raise DeliveryError("Seçilen MCP sunucusu bu hedef için uygun değil", 400, "mcp_missing")
    if not chosen["ready"]:
        raise DeliveryError(chosen["reason"] or "MCP sunucusu hazır değil", 424, "mcp_not_ready")
    tool = chosen["tool"]
    if service == "email" and TOOL_FORBID["email"].search(tool):  # savunma: e-posta asla gönderilmez
        raise DeliveryError("E-posta gönderen araçlar kullanılmaz; yalnızca taslak", 400, "send_forbidden")
    schema = next((t.get("inputSchema") for t in _bridge(studio).cached_tools(chosen["id"]) or []
                   if t.get("name") == tool), None) or {}
    props = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
    required = [str(r) for r in schema.get("required") or []]
    args: dict[str, Any] = {}
    used: set[str] = set()
    for sem in ("to", "cc", "subject", "title", "body", "channel", "parent"):
        val = values.get(sem)
        if val in (None, "", []):
            continue
        for key in ARG_KEYS[sem]:
            if key in props and key not in used:
                kind = (props.get(key) or {}).get("type")
                if isinstance(val, list) and kind != "array":
                    val = ", ".join(val)
                elif not isinstance(val, list) and kind == "array":
                    val = [val]
                args[key] = val
                used.add(key)
                break
    missing = [r for r in required if r not in args]
    if missing:
        raise DeliveryError(f"MCP aracı şu alanları istiyor: {', '.join(missing)}", 400, "mcp_args")
    return {"server": chosen["id"], "server_name": chosen["name"], "tool": tool, "arguments": args}


async def mcp_call_send(studio: Any, payload: dict[str, Any]) -> dict[str, Any]:
    from studio.tools.mcp_client import McpError, result_text
    b = _bridge(studio)
    cfg = b.server(payload["server"])
    if cfg is None:
        raise DeliveryError("MCP sunucusu artık etkin değil", 424, "mcp_missing")
    try:
        client = await b.connect(cfg)
        try:
            res = await client.call_tool(payload["tool"], payload["arguments"])
        finally:
            await client.close()
    except (McpError, OSError) as exc:
        raise DeliveryError(f"MCP çağrısı başarısız: {str(exc)[:300]}", 502, "mcp_failed") from None
    ok, text = result_text(res)
    if not ok:
        raise DeliveryError(f"MCP aracı hata döndü: {text[:300]}", 502, "mcp_failed")
    return {"result": text[:300] or "Tamamlandı", "link": _first_url(text)}


class McpTargetAdapter(Adapter):
    external = True

    def __init__(self, tid: str, label: dict[str, str]):
        self.id, self.label = tid, label

    async def readiness(self, studio: Any, *, check: bool = False) -> dict[str, Any]:
        servers = [s for s in mcp_services(studio) if s["service"] == self.id]
        ready = [s for s in servers if s["ready"]]
        return {"available": bool(servers), "ready": bool(ready),
                "reason": None if ready else (servers[0]["reason"] if servers else
                                              "MCP ile bağlan: kendi sunucunu Bağlantılar sayfasında ekle"),
                "connect_hint": "/baglantilar" if not servers else None,
                "mcp_servers": [{"id": s["id"], "name": s["name"], "ready": s["ready"], "reason": s["reason"]}
                                for s in servers]}

    async def plan(self, ctx: Ctx, options: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        text = _require_text(ctx)
        title = one_line(options.get("title") or ctx.title, 200) or ctx.stem
        values = {"title": title, "subject": title, "body": text,
                  "channel": one_line(options.get("channel"), 120) or None,
                  "parent": one_line(options.get("parent"), 200) or None}
        call = mcp_call_plan(ctx.studio, self.id, options.get("server"), values)
        opts = {"server": call["server"], "title": title, "channel": values["channel"], "parent": values["parent"]}
        return opts, {**call, "title": title, "content": text,
                      "summary": f"{call['server_name']} üzerinde `{call['tool']}` çağrılır"}

    async def send(self, ctx: Ctx, options: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        res = await mcp_call_send(ctx.studio, payload)
        return {**res, "label": self.label["tr"]}


ADAPTERS: dict[str, Adapter] = {a.id: a for a in (
    FolderAdapter(), EmailDraftAdapter(), GithubPrAdapter(), GithubIssueAdapter(),
    McpTargetAdapter("notion", {"tr": "Notion", "en": "Notion"}),
    McpTargetAdapter("gdocs", {"tr": "Google Docs", "en": "Google Docs"}),
    McpTargetAdapter("slack", {"tr": "Slack", "en": "Slack"}),
    ClipboardAdapter(), DownloadAdapter(),
)}
ALIASES = {"docs": "gdocs", "google_docs": "gdocs", "email": "email_draft", "github": "github_pr"}
