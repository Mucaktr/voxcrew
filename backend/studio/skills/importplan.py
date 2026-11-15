"""Skill içe aktarma planı (G1-D; AUDIT §3.2 akış adımları 2–4): plan → önizleme → onay → değişmez sürüm.

`studio.changes` deseninin veri dizinine uygulanmış hâlidir (AUDIT §3.2 kural 1):
- `plan(ref)` hiçbir şey yazmaz. Kaynağı (Claude, Hermes ya da VoxCrew klasörü) YALNIZCA okur ve önizleme döner:
  ad, açıklama, dosya listesi, guard bulguları (gövde + `references/*`), katalog ve gövde token'ı (`est_tokens`),
  önceki onaylı sürüme göre fark. Plan kimliği onay jetonudur; 15 dakika geçerlidir.
- `confirm(plan_id, confirm=True, …)` yalnız kullanıcıdan gelir (`clients/tracker.py` USER_ONLY_RE: MCP 403).
  Kaynak önizlemeden sonra değiştiyse reddeder; guard bulgusu varsa `accept_risk: true` ister; sonra veri dizinine
  değişmez kopya yazar (`snapshot.py`) ve sürümü onaylı olarak kaydeder (`bindings.json`). İstenirse bu skill'i
  zaten atanmış ajanları yeni sürüme bağlar. Onaylanmamış hiçbir içerik isteme girmez.
- Geri alma: bağlama eski sha'ya `/api/skills/bind` ile döner; sürüm kopyaları silinmez (değişmez).
"""

from __future__ import annotations

import difflib
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from studio.tokens import est_tokens
from studio.guard import injection

from .binding import DEFAULT_NEW_MODE, MODES, BindingError, snapshot_entry
from .snapshot import SnapshotError, collect, digest

PLAN_TTL_S = 15 * 60
MAX_DIFF_LINES = 400
DESC_CHARS = 180

# Skill'e özgü ek aile: içeriğin kendini kalıcı kural / bellek / ayar dosyası olarak yerleştirmeye çalışması (AW-T05).
PERSISTENCE = [
    re.compile(r"\b(?:kalıcı|daimi|sürekli\s+geçerli)\s+(?:bir\s+)?(?:kural|talimat|yönerge)", re.I),
    re.compile(r"\b(?:make|save|store|add|keep)\s+(?:this|these|the\s+following)\s+(?:instructions?|rules?)\s+"
               r"(?:as\s+)?(?:a\s+)?(?:permanent|persistent|standing|global)", re.I),
    re.compile(r"\b(?:permanent|persistent|standing)\s+(?:system\s+)?(?:rules?|instructions?)\b", re.I),
    re.compile(r"\b(?:belleğe|hafızaya|ortak\s+belleğe)\s+(?:kalıcı\s+olarak\s+)?(?:kaydet|yaz|ekle)", re.I),
    re.compile(r"\b(?:update|modify|edit|overwrite|append\s+to)\s+(?:your|the)\s+(?:system\s+prompt|CLAUDE\.md|"
               r"AGENTS\.md|settings(?:\.json)?|memory)\b", re.I),
    re.compile(r"(?:CLAUDE|AGENTS)\.md\S*\s+(?:dosyasına\s+)?(?:yaz|ekle|güncelle)", re.I),
]


class ImportPlanError(ValueError):
    pass


def scan_text(text: str) -> list[str]:
    hits = injection.scan(text)
    if any(p.search(text or "") for p in PERSISTENCE):
        hits.append("persistence")
    return hits


def findings_for(files: dict[str, str]) -> list[dict[str, Any]]:
    out = []
    for rel in sorted(files):
        fams = scan_text(files[rel])
        if fams:
            out.append({"file": rel, "patterns": fams})
    return out


META_TEXT_KEYS = ("name", "name_en", "description", "description_en")


def meta_findings(meta: dict[str, Any], where: str = "voxcrew-pack.json") -> list[dict[str, Any]]:
    """paket manifestinin ad/açıklama metinleri de isteme (katalog satırı) girebilir → aynı guard taraması."""
    out = []
    for k in META_TEXT_KEYS:
        fams = scan_text(str(meta.get(k) or ""))
        if fams:
            out.append({"file": f"{where}:{k}", "patterns": fams})
    return out


def _desc(text: str | None) -> str:
    d = " ".join((text or "").split())
    return (d[:DESC_CHARS] + "…") if len(d) > DESC_CHARS else d


def token_cost(key: str, name: str | None, description: str | None, body: str) -> dict[str, int]:
    """Katalog satırı her adımda; gövde yalnız `always` ya da seçici seçince."""
    return {"catalog": est_tokens(f"- {key}: {_desc(description)}"), "body": est_tokens(body)}


def diff_files(before: dict[str, str] | None, after: dict[str, str]) -> list[str]:
    lines: list[str] = []
    before = before or {}
    for rel in sorted(set(before) | set(after)):
        a, b = before.get(rel), after.get(rel)
        if a == b:
            continue
        lines += list(difflib.unified_diff((a or "").splitlines(), (b or "").splitlines(),
                                           fromfile=f"{rel} (onaylı)" if a is not None else "/dev/null",
                                           tofile=f"{rel} (yeni)" if b is not None else "/dev/null", lineterm="", n=2))
        if len(lines) > MAX_DIFF_LINES:
            return lines[:MAX_DIFF_LINES] + ["… (fark kısaltıldı)"]
    return lines


@dataclass
class ImportPlan:
    id: str
    key: str
    entry: dict[str, Any]
    sha: str
    findings: list[dict[str, Any]]
    preview: dict[str, Any]
    created: float = field(default_factory=time.time)

    def public(self) -> dict[str, Any]:
        return {**self.preview, "plan_id": self.id,
                "expires_in_s": max(0, int(PLAN_TTL_S - (time.time() - self.created)))}


class ImportPlanService:
    def __init__(self, library: Any):
        self.lib = library
        self.pending: dict[str, ImportPlan] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ çözümleme
    def _entry(self, ref: str) -> dict[str, Any]:
        ref = str(ref or "").strip()
        if not ref:
            raise ImportPlanError("id (kütüphane kimliği ya da atama anahtarı) gerekli")
        try:
            return self.lib.get(ref)
        except KeyError:
            entry = self.lib.resolve_key(ref)
            if entry is None:
                raise KeyError(f"Skill bulunamadı: {ref}") from None
            return entry

    @staticmethod
    def _source_files(entry: dict[str, Any]) -> dict[str, str]:
        reader = entry.get("_reader")
        if callable(reader):                     # `store`: paket içeriğinden yeniden okunur (bütünlük denetimli)
            return reader()
        md = Path(entry["path"])
        return collect(md.parent, md)            # yalnız okur

    # ------------------------------------------------------------------ mağaza kaynağı (yazmaz)
    def plan_store(self, key: str, files: dict[str, str], meta: dict[str, Any], reader: Any) -> dict[str, Any]:
        """`store` kaynağı: dosyalar (SKILL.md + references/*) market paketinden gelir. Aynı guard taraması, token ve
        önceki onaylı sürüme göre fark; onay yalnız mağaza akışından (`confirm(..., via_store=True)`)."""
        from .library import _is_script, parse_skill_md  # noqa: PLC0415

        if "SKILL.md" not in files:
            raise ImportPlanError("SKILL.md okunamadı")
        sha = digest(files)
        store, snaps = self.lib.bindings, self.lib.snapshots
        prev_sha = store.latest(key)
        prev = snaps.read(key, prev_sha) if prev_sha else None
        from .stage import one_line  # noqa: PLC0415 — döngüsel içe aktarmayı önler

        body = parse_skill_md(files["SKILL.md"], meta.get("name") or key)["body"]
        findings = findings_for(files) + meta_findings(meta)  # manifest ad/açıklaması da taranır
        # manifest metni isteme/katalog satırına tek satır, denetim karakteri olmadan girer
        name, description = one_line(meta.get("name"), 120) or None, one_line(meta.get("description"), 2000) or None
        tokens = token_cost(key, name, description, body)
        if prev is not None:
            tokens["previous_body"] = est_tokens(parse_skill_md(prev["SKILL.md"], key)["body"])
        other = [str(p) for p in (meta.get("other_files") or []) if str(p) not in files]  # paketin geri kalanı
        entry = {"id": f"store:{meta.get('pack') or key}", "key": key, "source": "store", "readonly": True,
                 "name": name, "description": description, "version": meta.get("version"),
                 "tags": [one_line(t, 60) for t in (meta.get("tags") or [])], "_reader": reader}
        preview = {
            "id": entry["id"], "key": key, "source": "store", "name": entry["name"], "description": entry["description"],
            "version": entry["version"], "tags": entry["tags"], "sha": sha, "previous_sha": prev_sha,
            "already_approved": store.is_approved(key, sha), "files": sorted(files), "other_files": sorted(other)[:100],
            "has_scripts": any(_is_script(PurePosixPath(p)) for p in other),
            "findings": findings, "risk": "high" if findings else "none", "tokens": tokens,
            "diff": diff_files(prev, files) if prev_sha != sha else [],
            "agents": [a["slug"] for a in self._assigned(key)], "readonly_source": True,
        }
        plan = ImportPlan(f"skp_{uuid.uuid4().hex[:12]}", key, entry, sha, findings, preview)
        with self._lock:
            self._gc()
            self.pending[plan.id] = plan
        return plan.public()

    # ------------------------------------------------------------------ plan (yazmaz)
    def plan(self, ref: str) -> dict[str, Any]:
        from .library import list_files, parse_skill_md  # noqa: PLC0415 — döngüsel içe aktarmayı önler

        entry = self._entry(ref)
        key = entry["key"]
        try:
            files = self._source_files(entry)
        except SnapshotError as exc:
            raise ImportPlanError(str(exc)) from None
        sha = digest(files)
        store, snaps = self.lib.bindings, self.lib.snapshots
        prev_sha = store.latest(key)
        prev = snaps.read(key, prev_sha) if prev_sha else None
        body = parse_skill_md(files["SKILL.md"], entry.get("name") or key)["body"]
        prev_body = parse_skill_md(prev["SKILL.md"], key)["body"] if prev else None
        findings = findings_for(files)
        try:
            extra = [f for f in list_files(Path(entry["path"]).parent) if f not in files]
        except OSError:
            extra = []
        tokens = token_cost(key, entry.get("name"), entry.get("description"), body)
        if prev_body is not None:
            tokens["previous_body"] = est_tokens(prev_body)
        preview = {
            "id": entry["id"], "key": key, "source": entry["source"], "name": entry.get("name"),
            "description": entry.get("description"), "version": entry.get("version"), "tags": entry.get("tags") or [],
            "sha": sha, "previous_sha": prev_sha, "already_approved": store.is_approved(key, sha),
            "files": sorted(files), "other_files": extra[:100],
            "has_scripts": bool(entry.get("has_scripts")),
            "findings": findings, "risk": "high" if findings else "none",
            "tokens": tokens,
            "diff": diff_files(prev, files) if prev_sha != sha else [],
            "agents": [a["slug"] for a in self._assigned(key)],
            "readonly_source": bool(entry.get("readonly")),
        }
        plan = ImportPlan(f"skp_{uuid.uuid4().hex[:12]}", key, entry, sha, findings, preview)
        with self._lock:
            self._gc()
            self.pending[plan.id] = plan
        return plan.public()

    def _assigned(self, key: str) -> list[dict[str, Any]]:
        agents = getattr(self.lib, "agents", None)
        if agents is None:
            return []
        from studio.hermes.caps import clean_name_list  # noqa: PLC0415

        return [a for a in agents.list() if key in clean_name_list(a.get("skills"))]

    # ------------------------------------------------------------------ onay (yalnız kullanıcı)
    def confirm(self, plan_id: str, *, confirm: Any, accept_risk: Any = False, agents: list[str] | None = None,
                mode: str | None = None, via_store: bool = False) -> dict[str, Any]:
        if confirm is not True:
            raise ImportPlanError("Onaylamak için açık onay (confirm: true) gerekli")
        if mode is not None and mode not in MODES:
            raise ImportPlanError(f"mode: {', '.join(MODES)} olmalı")
        with self._lock:
            plan = self.pending.get(plan_id)
            if plan is None or time.time() - plan.created > PLAN_TTL_S:
                self.pending.pop(plan_id, None)
                raise ImportPlanError("Plan bulunamadı veya süresi doldu; önizlemeyi yenile")
        is_store = plan.entry.get("source") == "store"
        if is_store != bool(via_store):   # mağaza planı lisans/imza yeniden denetimiyle yalnız mağaza akışından
            raise ImportPlanError("Bu plan yalnız kendi akışından onaylanabilir")
        if plan.findings and accept_risk is not True:
            raise ImportPlanError("Önizlemede güvenlik bulgusu var; onaylamak için bulguları gördüğünü belirt "
                                  "(accept_risk: true)")
        with self._lock:  # plan tek kullanımlık — eşzamanlı ikinci onay burada durur
            if self.pending.pop(plan_id, None) is None:
                raise ImportPlanError("Plan bulunamadı veya süresi doldu; önizlemeyi yenile")
        try:
            current = digest(self._source_files(plan.entry))
        except SnapshotError:
            current = None
        if current != plan.sha:
            with self._lock:
                self.pending.pop(plan_id, None)
            raise ImportPlanError("Kaynak önizlemeden sonra değişti; önizlemeyi yenile")
        try:
            if is_store:
                meta = {k: plan.entry.get(k) for k in ("id", "source", "name", "description", "tags", "version")}
                sha = self.lib.snapshots.write(plan.key, self._source_files(plan.entry), meta)
            else:
                sha = snapshot_entry(self.lib.snapshots, plan.key, plan.entry)
        except SnapshotError as exc:
            raise ImportPlanError(str(exc)) from None
        if sha != plan.sha:            # okuma ile kopya arasında değişti
            raise ImportPlanError("Kaynak önizlemeden sonra değişti; önizlemeyi yenile")
        self.lib.ensure_migrated()      # ilk yazımdan önce bugünkü atamalar `always` olarak korunur
        store = self.lib.bindings
        try:
            store.add_version(plan.key, sha, origin="store" if is_store else "import", name=plan.entry.get("name"))
        except BindingError as exc:
            raise ImportPlanError(str(exc)) from None
        assigned = {a["slug"] for a in self._assigned(plan.key)}
        rebound, skipped = [], []
        for slug in agents or []:
            if slug not in assigned:
                skipped.append(slug)
                continue
            cur = store.binding(slug, plan.key) or {}
            m = mode or cur.get("mode") or DEFAULT_NEW_MODE
            store.bind(slug, plan.key, mode=m, sha=sha, origin="user")
            rebound.append(slug)
        with self._lock:
            self.pending.pop(plan_id, None)
        return {"ok": True, "key": plan.key, "id": plan.entry["id"], "sha": sha, "findings": plan.findings,
                "rebound": rebound, "skipped": skipped}

    def _gc(self) -> None:
        now = time.time()
        for pid in [p for p, plan in self.pending.items() if now - plan.created > PLAN_TTL_S]:
            self.pending.pop(pid, None)
