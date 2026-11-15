"""Skill kütüphanesi (Ekip S14): üç kaynağı tek listede birleştirir, VoxCrew skill'lerini yönetir.

Kaynaklar:
- `hermes`  — Hermes profillerindeki `skills/**/SKILL.md` (studio.hermes.caps üzerinden, SALT OKUNUR)
- `claude`  — Claude Code skill klasörleri: `~/.claude/skills/*/SKILL.md` ve proje `.claude/skills` (SALT OKUNUR)
- `voxcrew` — veri dizini `skills/<id>/SKILL.md` + `skill.json` (düzenlenebilir; pazar yeri paket biçimi README.md'de)

Kimlikler:
- `id`  kütüphane kimliği (URL'de kullanılır): `vox:<id>` · `hermes:<yükleme-adı>` · `claude:<kapsam>/<klasör>`
- `key` ajana atanan ad (`agents.skills` içinde saklanan): VoxCrew → `<id>`, Hermes → yükleme adı (-s ile aynı),
  Claude → `claude:<ad>`. Hermes adları değişmeden kalır; böylece mevcut `-s` yolu bozulmaz.

Güvenlik: salt okunur kaynaklara hiçbir koşulda yazılmaz. İçe aktarmada zip slip (mutlak yol, `..`, sürücü harfi,
sembolik bağ) reddedilir; boyut ve dosya sayısı sınırlıdır; çalıştırılabilir ikililer alınmaz; betikler kopyalanır
ama ASLA çalıştırılmaz.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import threading
import time
import uuid
import weakref
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

import yaml

from studio.config import ROOT, atomic_write_text
from studio.hermes.caps import (
    EXCLUDED_DIRS, HermesCaps, caps_for, clean_name_list, fold, mtime_iso, parse_frontmatter, read_text, str_list,
    walk_skill_files,
)

SOURCES: tuple[str, ...] = ("voxcrew", "hermes", "claude")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
PERMISSIONS: tuple[str, ...] = ("files:read", "files:write", "shell", "network", "browser", "mcp")

MAX_SKILL_MD = 400_000            # karakter; daha uzun SKILL.md reddedilir
MAX_ZIP_BYTES = 3 * 1024 * 1024   # sıkıştırılmış (gövde sınırı 4 MiB'in altında kalsın)
MAX_UNPACKED_BYTES = 12 * 1024 * 1024
MAX_FILES = 200
MAX_FILE_BYTES = 4 * 1024 * 1024
BLOCKED_EXT = frozenset({".exe", ".dll", ".msi", ".scr", ".com", ".bat", ".cmd", ".vbs", ".jar", ".so", ".dylib",
                         ".pif", ".cpl", ".hta"})
SCRIPT_EXT = frozenset({".py", ".sh", ".ps1", ".js", ".mjs", ".ts", ".rb", ".pl", ".php"})
CACHE_TTL = 5.0


class SkillError(ValueError):
    """Geçersiz istek (400)."""


class ReadOnlyError(SkillError):
    """Salt okunur kaynağa yazma denemesi (403)."""


def slugify(text: str) -> str:
    table = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    s = re.sub(r"[^a-z0-9]+", "-", str(text or "").translate(table).lower()).strip("-")
    return s[:64].rstrip("-") or "skill"


def check_id(value: str) -> str:
    sid = str(value or "").strip()
    if not ID_RE.match(sid):
        raise SkillError("Skill kimliği küçük harf, rakam, '-' veya '_' içermeli, harf/rakamla başlamalı (en çok 64)")
    return sid


def strip_prefix(key: str) -> str:
    return key[4:] if key.startswith("vox:") else key


def _first_paragraph(body: str) -> str:
    for block in re.split(r"\n\s*\n", body.strip()):
        line = " ".join(ln.strip() for ln in block.strip().splitlines())
        if line and not line.startswith(("#", "---", "```", "<")):
            return line[:300]
    return ""


def parse_skill_md(content: str, fallback_name: str = "") -> dict[str, Any]:
    """Toleranslı SKILL.md okuması: frontmatter yoksa / bozuksa ad klasörden, açıklama ilk paragraftan gelir."""
    content = (content or "").replace("\r\n", "\n")
    fm, body = parse_frontmatter(content)
    meta = fm.get("metadata") if isinstance(fm.get("metadata"), dict) else {}
    vmeta = meta.get("voxcrew") if isinstance(meta.get("voxcrew"), dict) else {}
    hmeta = meta.get("hermes") if isinstance(meta.get("hermes"), dict) else {}
    name = str(fm.get("name") or fallback_name or "").strip().strip('"').strip("'")
    description = str(fm.get("description") or "").strip() or _first_paragraph(body)
    tags = str_list(fm.get("tags") or hmeta.get("tags") or vmeta.get("tags"))
    category = fm.get("category") or hmeta.get("category") or vmeta.get("category")
    return {
        "frontmatter": fm, "body": body, "name": name, "description": description,
        "version": str(fm["version"]) if fm.get("version") not in (None, "") else None,
        "author": str(fm["author"]) if fm.get("author") else None,
        "license": str(fm["license"]) if fm.get("license") else None,
        "tags": tags, "category": str(category) if category else None,
        "permissions": [p for p in str_list(vmeta.get("permissions") or fm.get("permissions")) if p],
    }


def render_skill_md(meta: dict[str, Any], body: str) -> str:
    """Frontmatter + gövde. Alan sırası sabit; boş alanlar yazılmaz."""
    fm: dict[str, Any] = {"name": meta.get("name") or meta.get("id")}
    for k in ("description", "version", "author", "license"):
        if meta.get(k):
            fm[k] = meta[k]
    if meta.get("tags"):
        fm["tags"] = list(meta["tags"])
    if meta.get("category"):
        fm["category"] = meta["category"]
    if meta.get("permissions"):
        fm["metadata"] = {"voxcrew": {"permissions": list(meta["permissions"])}}
    head = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False, default_flow_style=False).strip()
    return f"---\n{head}\n---\n\n{(body or '').strip()}\n"


def _safe_member(name: str) -> PurePosixPath | None:
    """Zip/klasör girdisi için güvenli göreli yol; tehlikeliyse None."""
    raw = (name or "").replace("\\", "/")
    if not raw or raw.startswith("/") or re.match(r"^[A-Za-z]:", raw) or "\x00" in raw:
        return None
    p = PurePosixPath(raw)
    if p.is_absolute() or not p.parts or any(part in ("..", ".") for part in p.parts):
        return None
    return p


def _blocked(path: PurePosixPath | Path) -> bool:
    return path.suffix.lower() in BLOCKED_EXT


def _is_script(path: PurePosixPath | Path) -> bool:
    return path.suffix.lower() in SCRIPT_EXT


def list_files(skill_dir: Path, limit: int = MAX_FILES) -> list[str]:
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(skill_dir):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d not in EXCLUDED_DIRS)
        for f in sorted(filenames):
            rel = (Path(dirpath) / f).relative_to(skill_dir).as_posix()
            if rel not in ("SKILL.md", "skill.json") and not f.startswith("."):
                out.append(rel)
                if len(out) >= limit:
                    return out
    return out


def package_manifest(entry: dict[str, Any], *, source: dict[str, Any] | None = None) -> dict[str, Any]:
    """`skill.json` — pazar yerine hazır paket biçimi (bkz. README.md)."""
    return {
        "format": "voxcrew-skill/1",
        "id": strip_prefix(entry["key"]) if entry.get("source") == "voxcrew" else slugify(entry.get("name") or entry["key"]),
        "name": entry.get("name") or entry["key"],
        "version": entry.get("version") or "0.1.0",
        "author": entry.get("author") or "",
        "license": entry.get("license") or "",
        "tags": list(entry.get("tags") or []),
        "description": (entry.get("description") or "")[:1024],
        "permissions": list(entry.get("permissions") or []),
        "source": source or {"kind": entry.get("source") or "voxcrew", "ref": entry.get("id") or ""},
    }


class SkillLibrary:
    def __init__(self, settings: Any, store: Any, data_dir: Path, caps: HermesCaps | None = None,
                 claude_dirs: list[Path] | None = None, agents: Any = None):
        self.settings = settings
        self.store = store
        self.root = Path(data_dir) / "skills"
        self.caps = caps or caps_for(settings)
        self.agents = agents
        self._claude_dirs = [Path(p) for p in claude_dirs] if claude_dirs is not None else None
        self._lock = threading.RLock()
        self._cache: dict[str, tuple[float, Any]] = {}
        # G1-D: sürüm kopyaları, bağlamalar ve içe aktarma planları (hepsi veri dizininde; kaynaklar salt okunur)
        from .binding import BindingStore  # noqa: PLC0415 — döngüsel içe aktarmayı önler
        from .importplan import ImportPlanService  # noqa: PLC0415
        from .snapshot import SnapshotStore  # noqa: PLC0415

        self.snapshots = SnapshotStore(self.root)
        self.bindings = BindingStore(self.root)
        self.imports = ImportPlanService(self)

    def ensure_migrated(self) -> dict[str, Any]:
        """G1-D göçü (bir kez): bugünkü atamalar `always` + bugünkü canlı sha ile kaydedilir; istem değişmez."""
        from .binding import migrate  # noqa: PLC0415

        if self.bindings.active:
            return {"migrated": False, "bound": 0}
        agents = self.agents.list() if self.agents is not None else []
        return migrate(self.bindings, self.snapshots, self, agents)

    # ------------------------------------------------------------------ yardımcılar
    def invalidate(self) -> None:
        with self._lock:
            self._cache.clear()

    def _cached(self, key: str, fn: Any) -> Any:
        now = time.monotonic()
        with self._lock:
            hit = self._cache.get(key)
            if hit and now - hit[0] < CACHE_TTL:
                return hit[1]
        value = fn()
        with self._lock:
            self._cache[key] = (now, value)
        return value

    def claude_roots(self) -> list[tuple[str, Path]]:
        """(kapsam, klasör) çiftleri. Ayar `skills.claude_dirs` doluysa yalnızca o klasörler (kapsam: user)."""
        if self._claude_dirs is not None:
            return [("user" if i == 0 else "project", p) for i, p in enumerate(self._claude_dirs)]
        configured = [str(x) for x in (self.settings.get("skills.claude_dirs") or []) if str(x).strip()]
        if configured:
            return [("user", Path(os.path.expandvars(os.path.expanduser(x)))) for x in configured]
        roots: list[tuple[str, Path]] = [("user", Path.home() / ".claude" / "skills"),
                                         ("project", ROOT / ".claude" / "skills")]
        try:
            workdir = Path(str(self.settings.get("workdir")))
            roots.append(("project", workdir / ".claude" / "skills"))
        except (TypeError, ValueError):
            pass
        seen: set[str] = set()
        out: list[tuple[str, Path]] = []
        for scope, p in roots:
            k = str(p.resolve()) if p.exists() else str(p)
            if k not in seen:
                seen.add(k)
                out.append((scope, p))
        return out

    # ------------------------------------------------------------------ tarama
    def _entry_base(self, *, source: str, sid: str, key: str, skill_md: Path, parsed: dict[str, Any],
                    text: str, readonly: bool) -> dict[str, Any]:
        files = list_files(skill_md.parent)
        return {
            "id": sid, "key": key, "source": source, "readonly": readonly,
            "name": parsed["name"] or skill_md.parent.name, "description": parsed["description"],
            "version": parsed["version"], "author": parsed["author"], "license": parsed["license"],
            "tags": parsed["tags"], "category": parsed["category"], "permissions": parsed["permissions"],
            "path": str(skill_md), "dir": str(skill_md.parent),
            "size_chars": len(text), "body_chars": len(parsed["body"]), "tokens": (len(text) + 3) // 4,
            "updated_at": mtime_iso(skill_md),
            "files_count": len(files), "has_scripts": any(_is_script(PurePosixPath(f)) for f in files),
            "loadable": True, "reason": None,
        }

    def _scan_voxcrew(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        if not self.root.is_dir():
            return out
        for d in sorted(self.root.iterdir(), key=lambda p: p.name):
            if not d.is_dir() or d.name.startswith(".") or not ID_RE.match(d.name):
                continue
            skill_md = d / "SKILL.md"
            text = read_text(skill_md)
            if text is None:
                continue
            parsed = parse_skill_md(text, d.name)
            manifest = self._read_manifest(d)
            e = self._entry_base(source="voxcrew", sid=f"vox:{d.name}", key=d.name, skill_md=skill_md, parsed=parsed,
                                 text=text, readonly=False)
            # skill.json eksik alanları tamamlar (izinler yalnızca orada tutulabilir)
            for k in ("version", "author", "license"):
                if not e[k] and manifest.get(k):
                    e[k] = str(manifest[k])
            if not e["tags"] and manifest.get("tags"):
                e["tags"] = str_list(manifest.get("tags"))
            if not e["permissions"] and manifest.get("permissions"):
                e["permissions"] = str_list(manifest.get("permissions"))
            if not e["description"] and manifest.get("description"):
                e["description"] = str(manifest["description"])
            e["origin"] = manifest.get("source") if isinstance(manifest.get("source"), dict) else None
            out.append(e)
        return out

    def _scan_claude(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for scope, root in self.claude_roots():
            for skill_md in walk_skill_files(root, max_depth=2)[:1000]:
                text = read_text(skill_md)
                if text is None:
                    continue
                folder = skill_md.parent.name
                parsed = parse_skill_md(text, folder)
                name = parsed["name"] or folder
                try:
                    rel = skill_md.parent.relative_to(root).as_posix()
                except ValueError:
                    rel = folder
                e = self._entry_base(source="claude", sid=f"claude:{scope}/{rel}", key=f"claude:{name}", skill_md=skill_md,
                                     parsed=parsed, text=text, readonly=True)
                e["scope"] = scope
                e["root"] = str(root)
                out.append(e)
        return out

    def _scan_hermes(self) -> list[dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        try:
            profiles = list(self.caps.profile_dirs())
        except Exception:  # noqa: BLE001 — bozuk Hermes kurulumu kütüphaneyi kırmasın
            return []
        for profile in profiles:
            try:
                skills = self.caps.skills(profile)
            except Exception:  # noqa: BLE001
                continue
            for s in skills:
                if s["state"] == "archived":
                    continue
                load = s["load_name"]
                reason = self.caps.skill_reason(s)
                if load in out:
                    e = out[load]
                    e["profiles"].append(profile)
                    if reason is None and not e["loadable"]:
                        e["loadable"], e["reason"], e["profile"] = True, None, profile
                    continue
                out[load] = {
                    "id": f"hermes:{load}", "key": load, "source": "hermes", "readonly": True,
                    "name": s["name"], "description": s["description"], "version": s["version"], "author": s["author"],
                    "license": s["license"], "tags": list(s["tags"]), "category": s["category"], "permissions": [],
                    "path": s["path"], "dir": str(Path(s["path"]).parent), "size_chars": s["size_chars"],
                    "body_chars": s["body_chars"], "tokens": s["tokens"], "updated_at": s["updated_at"],
                    "files_count": None, "has_scripts": None, "loadable": reason is None, "reason": reason,
                    "profile": profile, "profiles": [profile], "load_name": load, "rel_path": s["rel_path"],
                    "hermes_source": s["source"], "trust": s["trust"], "state": s["state"],
                }
        return list(out.values())

    def all(self) -> list[dict[str, Any]]:
        def scan() -> list[dict[str, Any]]:
            items = self._scan_voxcrew() + self._scan_hermes() + self._scan_claude()
            items.sort(key=lambda e: (SOURCES.index(e["source"]), fold(e["name"]), e["id"]))
            return items
        return self._cached("all", scan)

    def _index(self) -> dict[str, dict[str, Any]]:
        def build() -> dict[str, dict[str, Any]]:
            items = self.all()
            idx: dict[str, dict[str, Any]] = {"by_id": {}, "vox": {}, "hermes": {}, "claude_key": {}, "claude_name": {}}
            for e in items:
                idx["by_id"][e["id"]] = e
                if e["source"] == "voxcrew":
                    idx["vox"][e["key"]] = e
                elif e["source"] == "hermes":
                    idx["hermes"][e["key"]] = e
                else:
                    # proje kapsamı kullanıcı kapsamının önüne geçer (Claude Code öncelik sırası)
                    cur = idx["claude_key"].get(e["key"])
                    if cur is None or (cur.get("scope") != "project" and e.get("scope") == "project"):
                        idx["claude_key"][e["key"]] = e
                        idx["claude_name"][e["name"]] = e
            return idx
        return self._cached("index", build)

    # ------------------------------------------------------------------ okuma
    def list(self, source: str | None = None, q: str = "", tag: str | None = None,
             agent: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        items = self.all()
        if source:
            if source not in SOURCES:
                raise SkillError(f"Bilinmeyen kaynak: {source}. Geçerli değerler: {', '.join(SOURCES)}")
            items = [e for e in items if e["source"] == source]
        if tag:
            t = fold(tag)
            items = [e for e in items if any(fold(x) == t for x in e["tags"]) or fold(e["category"] or "") == t]
        if q.strip():
            needle = fold(q.strip())
            items = [e for e in items if needle in fold(" ".join(
                [e["name"], e["key"], e["description"], e["category"] or "", " ".join(e["tags"])]))]
        if agent is not None:
            keys = {r["entry"]["id"] for r in self.resolve_assigned(agent) if r["entry"]}
            items = [e for e in items if e["id"] in keys]
        return items

    def get(self, sid: str) -> dict[str, Any]:
        e = self._index()["by_id"].get(sid)
        if e is None:
            raise KeyError(f"Skill bulunamadı: {sid}")
        return e

    def detail(self, sid: str) -> dict[str, Any]:
        e = dict(self.get(sid))
        path = Path(e["path"])
        text = read_text(path) or ""
        parsed = parse_skill_md(text, e["name"])
        files = list_files(path.parent)
        e.update({
            "content": text[:MAX_SKILL_MD], "truncated": len(text) > MAX_SKILL_MD, "body": parsed["body"][:MAX_SKILL_MD],
            "frontmatter": json.loads(json.dumps(parsed["frontmatter"], ensure_ascii=False, default=str)),
            "files": files, "scripts": [f for f in files if _is_script(PurePosixPath(f))],
            "manifest": self._read_manifest(path.parent) if e["source"] == "voxcrew" else package_manifest(e),
        })
        return e

    def tags(self) -> list[dict[str, Any]]:
        counts: dict[str, int] = {}
        for e in self.all():
            for t in e["tags"]:
                counts[t] = counts.get(t, 0) + 1
        return [{"tag": t, "count": n} for t, n in sorted(counts.items(), key=lambda kv: (-kv[1], fold(kv[0])))]

    def summary(self) -> dict[str, Any]:
        items = self.all()
        home = str(Path.home())

        def mask(p: Path | str) -> str:
            s = str(p)
            return "~" + s[len(home):] if s.startswith(home) else s

        return {
            "counts": {s: sum(1 for e in items if e["source"] == s) for s in SOURCES},
            "total": len(items),
            "roots": {"voxcrew": mask(self.root), "claude": [mask(p) for _s, p in self.claude_roots()],
                      "hermes": mask(self.caps.home)},
            "writable": ["voxcrew"],
            "inject": bool(self.settings.get("skills.inject", True)),
            "max_chars": int(self.settings.get("skills.max_chars", 6000) or 6000),
            "permissions": list(PERMISSIONS),
            "tags": self.tags()[:60],
        }

    # ------------------------------------------------------------------ çözümleme (ajan → skill)
    def resolve_key(self, key: str, *, hermes_agent: bool = False, profile: str | None = None) -> dict[str, Any] | None:
        idx = self._index()
        key = str(key or "").strip()
        if not key:
            return None
        if key.startswith("claude:"):
            return idx["claude_key"].get(key) or idx["claude_name"].get(key[7:])
        if key.startswith("vox:"):
            return idx["vox"].get(key[4:])
        if key.startswith("hermes:"):
            return idx["hermes"].get(key[7:])
        if hermes_agent:
            h = idx["hermes"].get(key)
            if h and (profile or "default") in h.get("profiles", []):
                return h
            return idx["vox"].get(key) or h or idx["claude_name"].get(key)
        return idx["vox"].get(key) or idx["hermes"].get(key) or idx["claude_name"].get(key)

    def resolve_assigned(self, agent: dict[str, Any]) -> list[dict[str, Any]]:
        """Ajanın `skills` listesi → [{key, entry|None, how}]; how: hermes_flag (-s) | prompt | missing."""
        props = agent.get("props", agent)
        is_hermes = props.get("runtime") == "hermes"
        profile = props.get("hermes_profile") or "default"
        out: list[dict[str, Any]] = []
        for key in clean_name_list(props.get("skills")):
            entry = self.resolve_key(key, hermes_agent=is_hermes, profile=profile)
            if entry is None:
                how = "missing"
            elif is_hermes and entry["source"] == "hermes" and profile in entry.get("profiles", []) and entry["loadable"]:
                how = "hermes_flag"
            else:
                how = "prompt"
            out.append({"key": key, "entry": entry, "how": how})
        return out

    def users(self) -> dict[str, list[dict[str, Any]]]:
        """Kütüphane kimliği → kullanan ajanlar (slug, name, color, runtime)."""
        out: dict[str, list[dict[str, Any]]] = {}
        if self.agents is None:
            return out
        for a in self.agents.list():
            for r in self.resolve_assigned(a):
                if r["entry"]:
                    out.setdefault(r["entry"]["id"], []).append(
                        {"slug": a["slug"], "name": a.get("name"), "color": a.get("color"), "runtime": a.get("runtime"),
                         "how": r["how"], "hidden": bool(a.get("hidden"))})
        return out

    # ------------------------------------------------------------------ VoxCrew yazma işlemleri
    def _dir_for(self, sid: str) -> Path:
        d = (self.root / sid).resolve()
        if self.root.resolve() not in d.parents:
            raise SkillError("Geçersiz skill dizini")
        return d

    def _read_manifest(self, d: Path) -> dict[str, Any]:
        text = read_text(d / "skill.json")
        if not text:
            return {}
        try:
            data = json.loads(text)
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    def _write_manifest(self, d: Path, entry: dict[str, Any], source: dict[str, Any] | None = None) -> dict[str, Any]:
        prev = self._read_manifest(d)
        manifest = package_manifest(entry, source=source or (prev.get("source") if isinstance(prev.get("source"), dict) else None))
        atomic_write_text(d / "skill.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        return manifest

    def _require_voxcrew(self, sid: str) -> tuple[dict[str, Any], Path]:
        e = self.get(sid)
        if e["source"] != "voxcrew":
            raise ReadOnlyError("Bu kaynak salt okunur; yalnızca VoxCrew skill'leri düzenlenebilir. "
                                "Önce 'VoxCrew'a kopyala' ile kopya oluştur.")
        return e, self._dir_for(e["key"])

    def _finish_write(self, sid: str) -> dict[str, Any]:
        self.invalidate()
        entry = self.get(f"vox:{sid}")
        self.sync_graph(entry)
        return entry

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        content = data.get("content")
        parsed = parse_skill_md(str(content), "") if isinstance(content, str) and content.strip() else None
        name = str(data.get("name") or (parsed["name"] if parsed else "") or "").strip()
        sid = check_id(data.get("id") or slugify(name))
        if not name:
            name = sid
        if (self.root / sid).exists():
            raise SkillError(f"'{sid}' kimliğiyle bir VoxCrew skill'i zaten var")
        meta = self._meta_from(data, parsed, sid, name)
        body = str(data.get("body") if data.get("body") is not None else (parsed["body"] if parsed else "")).strip()
        if len(body) + 400 > MAX_SKILL_MD:
            raise SkillError("SKILL.md çok uzun")
        d = self._dir_for(sid)
        d.mkdir(parents=True, exist_ok=False)
        atomic_write_text(d / "SKILL.md", render_skill_md(meta, body))
        self._write_manifest(d, {**meta, "key": sid, "source": "voxcrew", "id": f"vox:{sid}"},
                             source={"kind": "voxcrew", "ref": ""})
        return self._finish_write(sid)

    def _meta_from(self, data: dict[str, Any], parsed: dict[str, Any] | None, sid: str, name: str) -> dict[str, Any]:
        def pick(k: str) -> Any:
            if k in data and data[k] is not None:
                return data[k]
            return parsed[k] if parsed else None
        perms = [p for p in str_list(pick("permissions")) if p]
        bad = [p for p in perms if p not in PERMISSIONS]
        if bad:
            raise SkillError(f"Bilinmeyen izin: {', '.join(bad)}. Geçerli değerler: {', '.join(PERMISSIONS)}")
        return {
            "id": sid, "name": name[:120],
            "description": str(pick("description") or "")[:1024],
            "version": str(pick("version") or "").strip() or None,
            "author": str(pick("author") or "").strip()[:120] or None,
            "license": str(pick("license") or "").strip()[:80] or None,
            "tags": [t[:40] for t in str_list(pick("tags"))][:20],
            "category": (str(pick("category") or "").strip()[:60] or None),
            "permissions": perms,
        }

    def update(self, sid: str, data: dict[str, Any]) -> dict[str, Any]:
        e, d = self._require_voxcrew(sid)
        content = data.get("content")
        fields = ("name", "description", "tags", "version", "author", "license", "permissions", "category")
        if isinstance(content, str) and content.strip():
            # Tam SKILL.md verildi: alan değerleri frontmatter'dan türetilir; açık alan da geldiyse yeniden kurulur
            if len(content) > MAX_SKILL_MD:
                raise SkillError("SKILL.md çok uzun")
            parsed = parse_skill_md(content, e["key"])
            meta = self._meta_from({k: v for k, v in data.items() if k != "content"}, parsed, e["key"],
                                   str(data.get("name") or parsed["name"] or e["name"]))
            text = render_skill_md(meta, parsed["body"]) if any(k in data for k in fields) else content
        else:
            cur = parse_skill_md(read_text(d / "SKILL.md") or "", e["key"])
            cur["permissions"] = cur["permissions"] or e["permissions"]
            meta = self._meta_from(data, cur, e["key"], str(data.get("name") or e["name"]))
            body = str(data["body"]) if data.get("body") is not None else cur["body"]
            if len(body) + 400 > MAX_SKILL_MD:
                raise SkillError("SKILL.md çok uzun")
            text = render_skill_md(meta, body)
        atomic_write_text(d / "SKILL.md", text if text.endswith("\n") else text + "\n")
        self._write_manifest(d, {**meta, "key": e["key"], "source": "voxcrew", "id": e["id"]})
        return self._finish_write(e["key"])

    def delete(self, sid: str) -> dict[str, Any]:
        e, d = self._require_voxcrew(sid)
        shutil.rmtree(d, ignore_errors=False)
        self.invalidate()
        affected: list[str] = []
        if self.agents is not None:
            for a in self.agents.list():
                skills = clean_name_list(a.get("skills"))
                if e["key"] in skills or f"vox:{e['key']}" in skills:
                    try:
                        self.agents.update(a["slug"], {"skills": [k for k in skills if k not in (e["key"], f"vox:{e['key']}")]})
                        affected.append(a["slug"])
                    except (ValueError, KeyError):
                        continue
        node = self.store.find("Skill", e["key"]) if self.store is not None else None
        if node and not self.store.neighbors(node["id"], ["HAS_SKILL"], "in"):
            self.store.delete_node(node["id"])
        return {"ok": True, "id": sid, "unassigned": affected}

    # ------------------------------------------------------------------ içe aktarma
    def import_paste(self, content: str, sid: str | None = None) -> dict[str, Any]:
        if not isinstance(content, str) or not content.strip():
            raise SkillError("SKILL.md içeriği boş")
        if len(content) > MAX_SKILL_MD:
            raise SkillError("SKILL.md çok uzun")
        parsed = parse_skill_md(content, "")
        data: dict[str, Any] = {"content": content, "id": sid or slugify(parsed["name"] or "skill")}
        return self.create(data)

    def _copy_tree(self, src: Path, dst: Path, *, source: dict[str, Any]) -> dict[str, Any]:
        """Bir skill klasörünü filtreleyerek kopyalar (gizli dizinler ve çalıştırılabilir ikililer hariç)."""
        skill_md = src / "SKILL.md"
        if not skill_md.is_file():
            raise SkillError("Klasörde SKILL.md yok")
        total, count = 0, 0
        plan: list[tuple[Path, PurePosixPath]] = []
        for dirpath, dirnames, filenames in os.walk(src, followlinks=False):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d not in EXCLUDED_DIRS)
            for f in sorted(filenames):
                p = Path(dirpath) / f
                if p.is_symlink():
                    raise SkillError(f"Sembolik bağ kabul edilmez: {f}")
                rel = _safe_member(p.relative_to(src).as_posix())
                if rel is None:
                    raise SkillError(f"Geçersiz dosya yolu: {f}")
                if _blocked(rel):
                    raise SkillError(f"Çalıştırılabilir ikili dosya kabul edilmez: {rel}")
                size = p.stat().st_size
                if size > MAX_FILE_BYTES:
                    raise SkillError(f"Dosya çok büyük: {rel}")
                total += size
                count += 1
                if total > MAX_UNPACKED_BYTES or count > MAX_FILES:
                    raise SkillError("Skill klasörü çok büyük (boyut ya da dosya sayısı sınırı)")
                plan.append((p, rel))
        text = read_text(skill_md) or ""
        if len(text) > MAX_SKILL_MD:
            raise SkillError("SKILL.md çok uzun")
        dst.mkdir(parents=True, exist_ok=False)
        for p, rel in plan:
            target = dst / Path(*rel.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(p, target)
        parsed = parse_skill_md(text, dst.name)
        entry = {"key": dst.name, "id": f"vox:{dst.name}", "source": "voxcrew", **{k: parsed[k] for k in (
            "name", "description", "version", "author", "license", "tags", "permissions")}}
        if not entry["name"]:
            entry["name"] = dst.name
        prev = self._read_manifest(dst)
        for k in ("version", "author", "license", "description"):
            if not entry.get(k) and prev.get(k):
                entry[k] = prev[k]
        if not entry["tags"] and prev.get("tags"):
            entry["tags"] = str_list(prev.get("tags"))
        if not entry["permissions"] and prev.get("permissions"):
            entry["permissions"] = [p for p in str_list(prev.get("permissions")) if p in PERMISSIONS]
        self._write_manifest(dst, entry, source=source)
        return entry

    def _new_id(self, wanted: str | None, fallback: str) -> str:
        sid = check_id(wanted or slugify(fallback))
        if (self.root / sid).exists():
            raise SkillError(f"'{sid}' kimliğiyle bir VoxCrew skill'i zaten var")
        return sid

    def import_folder(self, path: str, sid: str | None = None) -> dict[str, Any]:
        src = Path(os.path.expandvars(os.path.expanduser(str(path or "").strip())))
        if not src.is_dir():
            raise SkillError("Klasör bulunamadı")
        if src.resolve() == self.root.resolve() or self.root.resolve() in src.resolve().parents:
            raise SkillError("Kütüphanenin kendi klasörü içe aktarılamaz")
        text = read_text(src / "SKILL.md")
        if text is None:
            raise SkillError("Klasörde SKILL.md yok")
        parsed = parse_skill_md(text, src.name)
        new_id = self._new_id(sid, parsed["name"] or src.name)
        self.root.mkdir(parents=True, exist_ok=True)
        self._copy_tree(src, self._dir_for(new_id), source={"kind": "import", "ref": "folder"})
        return self._finish_write(new_id)

    def import_zip(self, data: bytes, sid: str | None = None) -> dict[str, Any]:
        if not data:
            raise SkillError("Zip dosyası boş")
        if len(data) > MAX_ZIP_BYTES:
            raise SkillError(f"Zip çok büyük (sınır {MAX_ZIP_BYTES // (1024 * 1024)} MB)")
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile as exc:
            raise SkillError("Geçerli bir zip dosyası değil") from exc
        with zf:
            members: list[tuple[zipfile.ZipInfo, PurePosixPath]] = []
            total = 0
            for info in zf.infolist():
                if info.is_dir():
                    continue
                rel = _safe_member(info.filename)
                if rel is None:
                    raise SkillError(f"Zip içinde güvensiz yol: {info.filename}")
                if (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise SkillError(f"Zip içinde sembolik bağ kabul edilmez: {info.filename}")
                if rel.name.startswith(".") or any(part.startswith(".") or part in EXCLUDED_DIRS for part in rel.parts[:-1]):
                    continue
                if _blocked(rel):
                    raise SkillError(f"Çalıştırılabilir ikili dosya kabul edilmez: {rel}")
                if info.file_size > MAX_FILE_BYTES:
                    raise SkillError(f"Dosya çok büyük: {rel}")
                total += info.file_size
                members.append((info, rel))
                if total > MAX_UNPACKED_BYTES or len(members) > MAX_FILES:
                    raise SkillError("Zip çok büyük (açılmış boyut ya da dosya sayısı sınırı)")
            candidates = sorted((rel for _i, rel in members if rel.name == "SKILL.md" and len(rel.parts) <= 2),
                                key=lambda r: len(r.parts))
            if not candidates:
                raise SkillError("Zip içinde SKILL.md yok (kökte ya da tek bir üst klasörde olmalı)")
            base = candidates[0].parent
            selected = [(i, r.relative_to(base)) for i, r in members if base == PurePosixPath(".") or base in r.parents]
            md_info = next(i for i, r in selected if str(r) == "SKILL.md")
            raw = zf.read(md_info)
            if len(raw) > MAX_SKILL_MD * 4:
                raise SkillError("SKILL.md çok uzun")
            text = raw.decode("utf-8-sig", "replace")
            parsed = parse_skill_md(text, "")
            new_id = self._new_id(sid, parsed["name"] or (base.name if str(base) != "." else "skill"))
            self.root.mkdir(parents=True, exist_ok=True)
            tmp = self.root / f".tmp-{uuid.uuid4().hex[:10]}"
            tmp.mkdir(parents=True)
            try:
                written = 0
                for info, rel in selected:
                    target = tmp / Path(*rel.parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(info) as src, open(target, "wb") as out:
                        while True:
                            chunk = src.read(65536)
                            if not chunk:
                                break
                            written += len(chunk)
                            if written > MAX_UNPACKED_BYTES:
                                raise SkillError("Zip açılınca sınırı aştı")
                            out.write(chunk)
                dst = self._dir_for(new_id)
                self._copy_tree(tmp, dst, source={"kind": "import", "ref": "zip"})
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        return self._finish_write(new_id)

    def copy_to_voxcrew(self, sid: str, new_id: str | None = None) -> dict[str, Any]:
        e = self.get(sid)
        if e["source"] == "voxcrew":
            raise SkillError("Bu skill zaten VoxCrew kaynağında")
        src = Path(e["dir"])
        if not (src / "SKILL.md").is_file():
            raise SkillError("Kaynak SKILL.md okunamadı")
        target_id = self._new_id(new_id, e["name"] or src.name)
        self.root.mkdir(parents=True, exist_ok=True)
        self._copy_tree(src, self._dir_for(target_id), source={"kind": e["source"], "ref": e["id"]})
        return self._finish_write(target_id)

    # ------------------------------------------------------------------ graf
    def sync_graph(self, entry: dict[str, Any]) -> dict[str, Any] | None:
        if self.store is None:
            return None
        props: dict[str, Any] = {"name": entry["key"], "source": entry["source"], "path": entry["path"]}
        if entry.get("description"):
            props["description"] = entry["description"][:1000]
        if entry.get("category"):
            props["category"] = entry["category"]
        return self.store.upsert_node("Skill", props)

    def enrich_graph(self, keys: Iterable[str], agent: dict[str, Any] | None = None) -> None:
        """Atama sonrası Skill düğümlerine kaynak/açıklama bilgisini işler (HAS_SKILL kenarları agents.py'de)."""
        props = (agent or {}).get("props", agent or {})
        is_hermes = props.get("runtime") == "hermes"
        for key in keys:
            e = self.resolve_key(key, hermes_agent=is_hermes, profile=props.get("hermes_profile"))
            if e:
                self.sync_graph({**e, "key": key})


# =====================================================================================================
# paylaşılan örnek (Studio nesnesi başına bir tane)
# =====================================================================================================
_LIBS: "weakref.WeakKeyDictionary[Any, SkillLibrary]" = weakref.WeakKeyDictionary()
_LIBS_LOCK = threading.Lock()


def library_for(studio: Any, *, claude_dirs: list[Path] | None = None, reset: bool = False) -> SkillLibrary:
    with _LIBS_LOCK:
        lib = None if reset else _LIBS.get(studio)
        if lib is None:
            lib = SkillLibrary(studio.settings, studio.store, Path(studio.changes.data_dir),
                               caps=getattr(studio.agents, "caps", None), claude_dirs=claude_dirs, agents=studio.agents)
            _LIBS[studio] = lib
        return lib
