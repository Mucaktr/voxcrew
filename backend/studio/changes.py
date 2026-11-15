"""Kullanıcı onaylı yapılandırma değişiklikleri: önizle → onayla → yedekle → kilitli atomik yaz → geri al.

Hermes (ve ileride Claude Code) dosyalarına stüdyodan yapılan HER yazım bu servisten geçer:
- `plan_*` hiçbir şey yazmaz; maskelenmiş bir diff ve plan kimliği döner.
- `apply(plan_id, confirm=True)` yalnızca kullanıcı arayüzde onayladığında çağrılır; dosya planlandığından
  beri değiştiyse reddeder, yanına benzersiz `<ad>.bak-<zaman>[-n]` yedeği alır, Hermes'in kilit desenine uyar
  (`<dosya>.lock`; kilit dosyası yoksa oluşturmaz; kilit tutuluyorsa birkaç saniye dener, sonra anlaşılır
  hatayla reddeder) ve atomik yazar. Satır sonları bayt bayt korunur (CRLF/LF çevirisi yok).
- `undo(change_id, confirm=True)` yedeği bayt bayt geri yükler.
Gizli değerler diff'te, günlükte ve yanıtlarda asla açık görünmez: `.env` türü planlarda — yorum satırları
dahil — her değer maskelenir (yalnızca bilinen zararsız anahtarlar açık kalır).
"""

from __future__ import annotations

import difflib
import glob
import hashlib
import json
import os
import re
import shutil
import sys
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

SECRET_KEY_RE = re.compile(r"(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|CREDENTIALS?|JSON|PRIVATE)", re.I)
ENV_LINE_RE = re.compile(r"^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")
ENV_COMMENT_RE = re.compile(r"^(\s*#\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")
# .env diff'lerinde değeri açık gösterilebilecek, sır içermeyen anahtarlar
SAFE_ENV_KEYS = {"API_SERVER_ENABLED", "API_SERVER_PORT", "API_SERVER_HOST"}
PLAN_TTL_S = 15 * 60
LOCK_WAIT_S = 3.0


class ChangeError(ValueError):
    pass


def mask_value(value: str) -> str:
    v = value.strip().strip('"').strip("'")
    return "••••" + v[-4:] if len(v) > 8 else "••••"


# Metin içindeki sır görünümlü değerler (sağlayıcı hata gövdeleri anahtarı geri yansıtabilir — denetim B-03)
_BEARER_RE = re.compile(r"(Bearer\s+)[A-Za-z0-9._~+/=-]+", re.I)
_TOKEN_RE = re.compile(r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}")
# GitHub, Slack, AWS erişim anahtarı kimliği, JWT
_TOKEN_EXTRA_RE = re.compile(r"\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}"
                             r"|xox[abposre]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}"
                             r"|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})")
_URL_USERINFO_RE = re.compile(r"(\b[A-Za-z][A-Za-z0-9+.-]*://)[^\s/@:]+:[^\s/@]+@")  # user:pass@host
# gizli yol taşıyan webhook adresleri (Slack, Discord) — yol bölümü sırdır
_WEBHOOK_RE = re.compile(r"(https://(?:hooks\.slack\.com/services|(?:canary\.|ptb\.)?discord(?:app)?\.com/api/webhooks)/)"
                         r"[A-Za-z0-9/_-]+")
_ASSIGN_RE = re.compile(r"""\b([A-Za-z0-9_-]*(?:key|token|secret|password|passwd))(["']?\s*[=:]\s*)(["']?)"""
                        r"""([^\s"',;}]+)""", re.I)


def redact_text(text: str, secrets: tuple[str | None, ...] | list[str | None] = ()) -> str:
    """Hata/istisna metnindeki sırları maskeler: bilinen değerler (ör. uç noktanın anahtarı), `Bearer …`,
    `sk-…` biçimli jetonlar ve `api_key=…` / `x-api-key: …` atamaları. Olaylara, SSE'ye ve günlüklere yazmadan önce."""
    out = str(text or "")
    for value in secrets:
        v = str(value or "").strip()
        if len(v) >= 6 and v in out:
            out = out.replace(v, mask_value(v))
    from studio.tools.mcp_client import mask_secrets  # noqa: PLC0415 - karar 1: MCP'ye aktarılan ortam değerleri
    out = mask_secrets(out)
    out = _BEARER_RE.sub(r"\1••••", out)
    out = _TOKEN_RE.sub("••••", out)
    out = _TOKEN_EXTRA_RE.sub("••••", out)
    out = _URL_USERINFO_RE.sub(r"\1••••@", out)
    out = _WEBHOOK_RE.sub(r"\1••••", out)
    return _ASSIGN_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}••••"
                          if not m.group(4).startswith("••••") else m.group(0), out)


def mask_line(line: str, env: bool = True) -> str:
    """Gizli görünen değerleri maskeler. `env=True` iken (`.env` dosyaları) zararsız anahtarlar dışındaki
    TÜM değerleri ve yorum satırlarındaki değerleri maskeler; aksi hâlde yalnızca sır adlı anahtarları."""
    m = ENV_LINE_RE.match(line)
    if m:
        key = m.group(2)
        secret = SECRET_KEY_RE.search(key) is not None
        if (env and key not in SAFE_ENV_KEYS) or secret:
            return f"{m.group(1) or ''}{key}={mask_value(m.group(3))}" if m.group(3).strip() else line
        return line
    c = ENV_COMMENT_RE.match(line)
    if c and c.group(3).strip() and (env or SECRET_KEY_RE.search(c.group(2))):
        return f"{c.group(1)}{c.group(2)}={mask_value(c.group(3))}"
    return line


def _sha(text: str | None) -> str | None:
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text is not None else None


def _newline_of(text: str | None) -> str:
    return "\r\n" if text and "\r\n" in text else "\n"


def read_exact(path: Path) -> str | None:
    """Dosyayı satır sonu çevirisi olmadan okur (CRLF korunur)."""
    if not path.is_file():
        return None
    with open(path, encoding="utf-8", newline="") as fh:
        return fh.read()


def write_exact(path: Path, text: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)


def env_merge(current: str | None, updates: dict[str, str]) -> str:
    """Var olan satırları korur; aynı anahtar varsa değerini günceller, yoksa sona ekler.
    Dosyanın satır sonu biçimi (CRLF/LF) korunur."""
    nl = _newline_of(current)
    lines = (current or "").splitlines()
    pending = dict(updates)
    out: list[str] = []
    for line in lines:
        m = ENV_LINE_RE.match(line)
        if m and m.group(2) in pending:
            out.append(f"{m.group(1) or ''}{m.group(2)}={pending.pop(m.group(2))}")
        else:
            out.append(line)
    if pending:
        if out and out[-1].strip():
            out.append("")
        out.append("# VoxCrew tarafından eklendi (kullanıcı onayıyla)")
        out.extend(f"{k}={v}" for k, v in pending.items())
    return nl.join(out) + nl


def env_get(text: str | None, key: str) -> str | None:
    for line in (text or "").splitlines():
        m = ENV_LINE_RE.match(line)
        if m and m.group(2) == key:
            return m.group(3).strip().strip('"').strip("'")
    return None


@contextmanager
def hermes_file_lock(path: Path, wait_s: float = LOCK_WAIT_S) -> Iterator[None]:
    """Hermes'in `<dosya>.lock` desenine uyar. Kilit dosyası yoksa yenisini oluşturmaz (kullanıcı dizinine
    gereksiz dosya yazmamak için). Kilit tutuluyorsa `wait_s` boyunca bloklamadan dener, sonra ChangeError."""
    lock_path = path.with_name(path.name + ".lock")
    if not lock_path.exists():
        yield
        return
    with open(lock_path, "r+", encoding="utf-8") as fd:
        deadline = time.monotonic() + wait_s
        if sys.platform == "win32":
            import msvcrt
            while True:
                try:
                    fd.seek(0)
                    msvcrt.locking(fd.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise ChangeError("Hermes bu dosyayı şu an kullanıyor (kilitli); birkaç saniye sonra "
                                          "tekrar dene") from None
                    time.sleep(0.15)
            try:
                yield
            finally:
                try:
                    fd.seek(0)
                    msvcrt.locking(fd.fileno(), msvcrt.LK_UNLCK, 1)
                except OSError:
                    pass
        else:
            import fcntl
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise ChangeError("Hermes bu dosyayı şu an kullanıyor (kilitli); birkaç saniye sonra "
                                          "tekrar dene") from None
                    time.sleep(0.15)
            try:
                yield
            finally:
                fcntl.flock(fd, fcntl.LOCK_UN)


def _unique_backup(path: Path) -> Path:
    base = path.with_name(f"{path.name}.bak-{datetime.now():%Y%m%d-%H%M%S}")
    candidate, n = base, 2
    while candidate.exists():
        candidate = base.with_name(f"{base.name}-{n}")
        n += 1
    return candidate


BACKUP_KEEP = 20       # dosya başına tutulan .bak-* sayısı (.env yedekleri sır içerebilir; sonsuz birikmesin)
LOG_MAX_LINES = 2000   # changes.jsonl bu satırı aşarsa son LOG_KEEP_LINES satıra indirilir
LOG_KEEP_LINES = 1000


def _prune_backups(path: Path, keep: int) -> None:
    """`<ad>.bak-*` yedeklerinden en yeni `keep` tanesi kalır (ada gömülü zaman damgasına göre)."""
    try:
        baks = sorted(path.parent.glob(glob.escape(path.name) + ".bak-*"), key=lambda p: p.name)
        for old in baks[:-keep] if keep > 0 else baks:
            old.unlink(missing_ok=True)
    except OSError:
        pass


def _keep_mode(source: Path, tmp: Path) -> None:
    """POSIX: yerine konacak geçici dosya hedefin izinlerini alır (0600 `.env` 0644 olmasın — denetim B-09).
    Windows'ta izin biti yalnızca salt-okunurluktur; orada dokunulmaz (salt okunur geçici dosya temizlenemezdi)."""
    if os.name != "nt" and source.exists():
        shutil.copymode(source, tmp)


def _atomic_write(path: Path, text: str) -> None:
    """Geçici dosyaya yazıp yerine koyar; başarısızlıkta geçici dosyayı temizler ve ChangeError fırlatır."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:6]}.studio-tmp")
    try:
        write_exact(tmp, text)
        _keep_mode(path, tmp)
        os.replace(tmp, path)
    except OSError as exc:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise ChangeError(f"Dosya yazılamadı (başka bir süreç kullanıyor olabilir): {exc.strerror or exc}") from None


@dataclass
class ChangePlan:
    id: str
    path: Path
    before: str | None
    after: str
    summary: str
    kind: str
    created: float = field(default_factory=time.time)

    def public(self) -> dict[str, Any]:
        env = self.kind == "env"
        before = [mask_line(l, env) for l in (self.before or "").splitlines()]
        after = [mask_line(l, env) for l in self.after.splitlines()]
        diff = list(difflib.unified_diff(before, after, fromfile=f"{self.path.name} (şimdiki)",
                                         tofile=f"{self.path.name} (sonra)", lineterm="", n=2))
        return {"id": self.id, "path": str(self.path), "exists": self.before is not None, "kind": self.kind,
                "summary": self.summary, "diff": diff, "no_change": self.before == self.after,
                "expires_in_s": max(0, int(PLAN_TTL_S - (time.time() - self.created)))}


class ChangeService:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.log_path = self.data_dir / "changes.jsonl"
        self.pending: dict[str, ChangePlan] = {}

    # ---------------------------------------------------------------- planlama (yazmaz)
    def plan_text(self, path: Path, new_text: str, summary: str, kind: str = "text") -> dict[str, Any]:
        path = Path(path)
        plan = ChangePlan(f"chg_{uuid.uuid4().hex[:10]}", path, read_exact(path), new_text, summary, kind)
        self._gc()
        self.pending[plan.id] = plan
        return plan.public()

    def plan_env(self, path: Path, updates: dict[str, str], summary: str) -> dict[str, Any]:
        path = Path(path)
        return self.plan_text(path, env_merge(read_exact(path), updates), summary, kind="env")

    # ---------------------------------------------------------------- uygulama
    def apply(self, plan_id: str, confirm: bool) -> dict[str, Any]:
        if confirm is not True:
            raise ChangeError("Uygulamak için açık onay (confirm: true) gerekli")
        plan = self.pending.get(plan_id)
        if plan is None or time.time() - plan.created > PLAN_TTL_S:
            self.pending.pop(plan_id, None)
            raise ChangeError("Plan bulunamadı veya süresi doldu; önizlemeyi yenile")
        backup = None
        with hermes_file_lock(plan.path):
            # AUDIT-FIX #7: denetim kilit İÇİNDE — denetimle yazma arasında Hermes'in yazdığı sessizce ezilmesin
            current = read_exact(plan.path)
            if _sha(current) != _sha(plan.before):
                self.pending.pop(plan_id, None)
                raise ChangeError("Dosya önizlemeden sonra değişti; önizlemeyi yenile")
            if current is not None:
                backup = _unique_backup(plan.path)
                shutil.copy2(plan.path, backup)  # bayt bayt + izinler (yedek de 0600 kalır)
                _prune_backups(plan.path, keep=BACKUP_KEEP)
            _atomic_write(plan.path, plan.after)
        self.pending.pop(plan_id, None)
        entry = {"id": plan.id, "path": str(plan.path), "kind": plan.kind, "summary": plan.summary,
                 "backup": str(backup) if backup else None, "ts": time.time(),
                 "sha_before": _sha(plan.before), "sha_after": _sha(plan.after), "undone": False}
        self._log(entry)
        return entry

    def undo(self, change_id: str, confirm: bool) -> dict[str, Any]:
        if confirm is not True:
            raise ChangeError("Geri almak için açık onay (confirm: true) gerekli")
        entry = next((e for e in reversed(self.history(500)) if e["id"] == change_id), None)
        if not entry:
            raise ChangeError("Değişiklik kaydı yok")
        path = Path(entry["path"])
        with hermes_file_lock(path):
            if _sha(read_exact(path)) != entry["sha_after"]:     # AUDIT-FIX #7: kilit içinde
                raise ChangeError("Dosya bu değişiklikten sonra yeniden değişmiş; elle geri al")
            if entry["backup"]:
                try:
                    original = Path(entry["backup"]).read_bytes()
                except OSError:
                    raise ChangeError("Yedek dosya artık yok (eski yedekler temizlenir); geri alınamıyor") from None
                tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:6]}.studio-tmp")
                try:
                    tmp.write_bytes(original)
                    _keep_mode(path if path.exists() else Path(entry["backup"]), tmp)
                    os.replace(tmp, path)
                except OSError as exc:
                    tmp.unlink(missing_ok=True)
                    raise ChangeError(f"Geri alınamadı: {exc.strerror or exc}") from None
            else:
                path.unlink(missing_ok=True)
        undo_entry = {**entry, "id": f"{change_id}:undo", "undone": True, "ts": time.time(),
                      "summary": f"Geri alındı: {entry['summary']}"}
        self._log(undo_entry)
        return undo_entry

    def history(self, limit: int = 50) -> list[dict[str, Any]]:
        if not self.log_path.is_file():
            return []
        out: list[dict[str, Any]] = []
        try:
            lines = self.log_path.read_text("utf-8", errors="replace").splitlines()
        except OSError:
            return []
        for l in lines[-limit:]:  # bozuk satır (yarım yazım) tüm geçmişi/geri almayı düşürmesin
            try:
                e = json.loads(l)
            except ValueError:
                continue
            if isinstance(e, dict):
                out.append(e)
        return out

    # ---------------------------------------------------------------- iç
    def _log(self, entry: dict[str, Any]) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        with self.log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        try:
            lines = self.log_path.read_text("utf-8", errors="replace").splitlines()
            if len(lines) > LOG_MAX_LINES:
                _atomic_write(self.log_path, "\n".join(lines[-LOG_KEEP_LINES:]) + "\n")
        except (OSError, ChangeError):
            pass

    def _gc(self) -> None:
        now = time.time()
        for pid in [p for p, plan in self.pending.items() if now - plan.created > PLAN_TTL_S]:
            self.pending.pop(pid, None)
