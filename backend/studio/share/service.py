"""Paylaşım servisi: dışa aktarma (önizleme + paket), içe aktarma (önizleme + fark + uygulama), çıktı şablonları.

İçe aktarma kuralları (paket güvenilmeyen veridir; önizlemeye güvenilmez, uygulama her şeyi yeniden doğrular):
- Çakışan ad/kimlik varsayılan olarak sonek alır (`-2`, " (2)"); var olanın üzerine yazmak ("replace") yalnızca öğe
  başına açık seçim + `confirm: true` ile ve ajanlar dışında mümkündür. Hiçbir şey onaysız yazılmaz.
- İçe aktarılan ajan dosya ne derse desin SALT OKUMA (`permissions: read`) ve kendi (özel) belleğiyle başlar; beyin
  tercihi model politikasına uymuyorsa ya da Hermes profiliyse kurulu varsayılan beyne düşer. Yazma izni kullanıcı
  tarafından sonradan verilir (Ajanlar sayfası; MCP veremez: api.py `mcp_permissions_gate`).
- İstemler (adım görevi, onay iletisi, ajan rolü/kişiliği) önizlemede TAM gösterilir ve `guard.injection.scan` ile
  işaretlenir; içe aktarılan her öğe `share/imported.json` kaydında "imported" olarak (bayraklarıyla) saklanır.
- İş akışı mevcut doğrulayıcıdan (`workflow.spec.parse`) geçer ve kullanıcının politikasının ötesine geçemez: komut
  çalıştıran kabul ölçütü / kalite `check` komutu yok, adım beyni model politikasına uymalı, Güvenli mod işe alımı
  kapattıysa işe alan adım yok; otomatik işe alım / plan onayı "ask"e çekilir. "workflows" kapısı geçerlidir.
"""

from __future__ import annotations

import json
import logging
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from studio._edition import EDITION

from studio.share import bundle as B

if TYPE_CHECKING:
    from studio.api import Studio

log = logging.getLogger("studio.share")
CHOICES = ("add", "replace", "skip")
EXCLUDED = ("secrets", "memory", "transcripts", "local_paths", "hermes_profile", "mcp_tools", "skills")


class ShareError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _section_title(s: Any) -> str:
    if isinstance(s, dict):
        t = s.get("title")
        if isinstance(t, dict):
            return str(t.get("tr") or t.get("en") or s.get("id") or "")
        return str(t or s.get("id") or "")
    return str(s or "")


class ShareService:
    def __init__(self, studio: "Studio"):
        self.studio = studio
        self._lock = threading.Lock()

    # ------------------------------------------------------------ depolar
    @property
    def dir(self) -> Path:
        base = getattr(getattr(self.studio, "changes", None), "data_dir", None)
        if base is None:
            from studio.config import DATA_DIR  # noqa: PLC0415
            base = DATA_DIR
        return Path(base) / "share"

    def _read(self, name: str) -> dict[str, Any]:
        try:
            data = json.loads((self.dir / name).read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _write(self, name: str, data: dict[str, Any]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        path = self.dir / name
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(path)

    def outputs(self) -> list[dict[str, Any]]:
        items = self._read("output_templates.json").get("items")
        return [i for i in items if isinstance(i, dict) and B.ID_RE.match(str(i.get("id") or ""))] \
            if isinstance(items, list) else []

    def output(self, oid: str) -> dict[str, Any]:
        for o in self.outputs():
            if o["id"] == oid:
                return o
        raise KeyError(f"Çıktı şablonu yok: {oid}")

    def _put_output(self, item: dict[str, Any]) -> None:
        with self._lock:
            items = [o for o in self.outputs() if o["id"] != item["id"]]
            self._write("output_templates.json", {"items": [*items, item]})

    def delete_output(self, oid: str) -> None:
        with self._lock:
            items = self.outputs()
            if not any(o["id"] == oid for o in items):
                raise KeyError(f"Çıktı şablonu yok: {oid}")
            self._write("output_templates.json", {"items": [o for o in items if o["id"] != oid]})
            reg = self.imported()
            reg.pop(f"output:{oid}", None)
            self._write("imported.json", {"items": reg})

    def imported(self) -> dict[str, dict[str, Any]]:
        items = self._read("imported.json").get("items")
        return {k: v for k, v in items.items() if isinstance(v, dict)} if isinstance(items, dict) else {}

    def _mark_imported(self, key: str, info: dict[str, Any]) -> None:
        with self._lock:
            reg = self.imported()
            reg[key] = info
            self._write("imported.json", {"items": reg})

    def apply_output(self, oid: str, workflow: str) -> dict[str, Any]:
        """Çıktı şablonunu bir iş akışının `quality` bloğuna uygular (bölümler, biçim, kurallar; diğer alanlar kalır)."""
        tpl = self.output(oid)
        spec = self.studio.library.get(workflow)
        data = spec.to_dict()
        q = dict(data.get("quality") or {})
        q.update(required_sections=list(tpl.get("sections") or []), file_type=tpl.get("format") or "md",
                 rules=list(tpl.get("rules") or []))
        q.pop("sections", None)
        data["quality"] = q
        saved = self.studio.library.save(data)
        return saved.to_dict()

    # ------------------------------------------------------------ dışa aktarma
    def _scrubber(self) -> B.Scrubber:
        try:
            work = str(self.studio.settings.workdir.resolve())
        except Exception:  # noqa: BLE001
            work = ""
        return B.Scrubber(workdir=work)

    def exportable(self) -> dict[str, list[dict[str, Any]]]:
        lib = self.studio.library.list()
        jobs = [{"id": w["slug"], "name": w.get("name") or w["slug"], "example": bool(w.get("example"))}
                for w in lib if not w.get("error")]
        agents = [{"id": a["slug"], "name": a.get("name") or a["slug"], "permissions": a.get("permissions") or "read"}
                  for a in self.studio.agents.list(include_hidden=False) if not a.get("demo")]
        outputs = [{"id": o["id"], "name": o.get("name") or o["id"], "source": "template"} for o in self.outputs()]
        outputs += [{"id": f"workflow:{w['slug']}", "name": w.get("name") or w["slug"], "source": "workflow"}
                    for w in lib if not w.get("error") and (w.get("quality") or {}).get("required_sections")]
        if EDITION == "full":
            from studio.full.recipes import RECIPES, tr_en  # noqa: PLC0415
            outputs += [{"id": f"recipe:{r['id']}", "name": tr_en(r.get("title"), "tr"), "source": "recipe"}
                        for r in RECIPES if (r.get("output") or {}).get("sections")]
        return {"jobs": jobs, "agents": agents, "outputs": outputs}

    def _export_job(self, slug: str, sc: B.Scrubber) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            spec = self.studio.library.get(slug)
        except KeyError:
            raise ShareError(f"İş akışı yok: {slug}", 404) from None
        wf = spec.to_dict()
        dropped: list[str] = []
        acc = wf.get("acceptance")
        if isinstance(acc, dict) and isinstance(acc.get("criteria"), list):
            keep = [c for c in acc["criteria"] if not (isinstance(c, dict) and c.get("kind") == "command")]
            if len(keep) != len(acc["criteria"]):
                dropped.append("acceptance.command")
            wf["acceptance"] = {**acc, "criteria": keep}
        q = wf.get("quality")
        if isinstance(q, dict) and "check" in q:
            q = {k: v for k, v in q.items() if k != "check"}
            dropped.append("quality.check")
            wf["quality"] = q
        where = f"job:{slug}"
        wf = sc.tree(wf, f"{where}.workflow", B.WORKFLOW_STRUCT_KEYS)
        base = None
        if EDITION == "full":
            from studio.full.timesaved import TimeSavedService  # noqa: PLC0415
            base = TimeSavedService(self.studio).user_baselines().get(f"workflow:{slug}")
        item = {"kind": "job", "id": slug, "name": sc.text(spec.name or slug, f"{where}.name")[:B.LIMITS["name"]],
                "workflow": wf, "baseline": dict(base) if base else None}
        prompts = [{"field": f"{s['id']}", "text": s.get("prompt") or s.get("message") or ""}
                   for s in wf.get("steps") or [] if s.get("prompt") or s.get("message")]
        agents = sorted({s["agent"] for s in wf.get("steps") or [] if s.get("agent")})
        return item, {"dropped": dropped, "prompts": prompts, "agents": agents,
                      "fields": ["workflow", "quality" if wf.get("quality") else "", "baseline" if base else ""]}

    def _export_agent(self, slug: str, sc: B.Scrubber) -> tuple[dict[str, Any], dict[str, Any]]:
        node = self.studio.agents.node(slug)
        if not node:
            raise ShareError(f"Ajan yok: {slug}", 404)
        p = node["props"]
        where = f"agent:{slug}"
        hermes = p.get("runtime") == "hermes"
        av = p.get("avatar") if isinstance(p.get("avatar"), dict) else {}
        avatar = {k: str(v)[:40] for k, v in av.items()
                  if B.AVATAR_KEY_RE.match(str(k)) and isinstance(v, (str, int, float)) and not isinstance(v, bool)}
        item = {"kind": "agent", "id": slug, "name": sc.text(p.get("name") or slug, f"{where}.name")[:B.LIMITS["name"]],
                "title": sc.text(p.get("title") or "", f"{where}.title")[:B.LIMITS["title"]],
                "role": sc.text(p.get("role") or "", f"{where}.role")[:B.LIMITS["role"]],
                "persona": sc.text(p.get("persona") or "", f"{where}.persona")[:B.LIMITS["persona"]],
                "rank": p.get("rank") if p.get("rank") in B.RANKS else None,
                "color": p.get("color") if isinstance(p.get("color"), str) and B.HEX_RE.match(p["color"]) else None,
                "avatar": dict(list(avatar.items())[:B.MAX_AVATAR_KEYS]) or None,
                "brain": {"connection": "hermes" if hermes else (p.get("connection") or "ollama"),
                          "model": "" if hermes else str(p.get("model") or "")[:120]},
                "permissions": p.get("permissions") if p.get("permissions") in B.PERMISSIONS else "read"}
        if not B.MODEL_RE.match(item["brain"]["model"]):
            item["brain"]["model"] = ""
        item = {k: v for k, v in item.items() if v is not None}
        prompts = [{"field": "role", "text": item.get("role", "")}, {"field": "persona", "text": item.get("persona", "")}]
        return item, {"dropped": [], "prompts": [x for x in prompts if x["text"]], "agents": [],
                      "fields": ["name", "title", "role", "persona", "rank", "color", "avatar", "brain", "permissions"]}

    def _export_output(self, oid: str, sc: B.Scrubber) -> tuple[dict[str, Any], dict[str, Any]]:
        if oid.startswith("workflow:"):
            slug = oid[len("workflow:"):]
            try:
                spec = self.studio.library.get(slug)
            except KeyError:
                raise ShareError(f"İş akışı yok: {slug}", 404) from None
            q = spec.quality or {}
            src = {"id": f"{slug}-cikti"[:41], "name": spec.name or slug, "description": spec.description or "",
                   "format": q.get("file_type") or "md",
                   "sections": [_section_title(s) for s in q.get("required_sections") or q.get("sections") or []],
                   "rules": [str(r) for r in (q.get("rules") or []) if isinstance(r, str)]}
        elif EDITION == "full" and oid.startswith("recipe:"):
            from studio.full.recipes import RECIPES, tr_en  # noqa: PLC0415
            rid = oid[len("recipe:"):]
            r = next((x for x in RECIPES if x["id"] == rid), None)
            if r is None:
                raise ShareError(f"Tarif yok: {rid}", 404)
            src = {"id": f"{rid}-cikti"[:41], "name": tr_en(r.get("title"), "tr"), "description": tr_en(r.get("outcome"), "tr"),
                   "format": (r.get("output") or {}).get("format") or "md",
                   "sections": [_section_title(s) for s in (r.get("output") or {}).get("sections") or []],
                   "rules": list((r.get("quality") or {}).get("rules") or [])}
        else:
            try:
                src = self.output(oid)
            except KeyError:
                raise ShareError(f"Çıktı şablonu yok: {oid}", 404) from None
        where = f"output:{src['id']}"
        item = {"kind": "output", "id": re.sub(r"[^a-z0-9_-]", "-", str(src["id"]).lower())[:41].strip("-") or "cikti",
                "name": sc.text(src.get("name") or src["id"], f"{where}.name")[:B.LIMITS["name"]],
                "description": sc.text(src.get("description") or "", f"{where}.description")[:B.LIMITS["description"]],
                "format": src.get("format") if src.get("format") in B.OUTPUT_FORMATS else "md",
                "sections": [sc.text(s, f"{where}.sections")[:B.LIMITS["section"]]
                             for s in src.get("sections") or [] if str(s).strip()][:B.MAX_SECTIONS],
                "rules": [r for r in src.get("rules") or [] if B.RULE_RE.match(str(r))][:B.MAX_RULES]}
        return item, {"dropped": [], "prompts": [], "agents": [], "fields": ["format", "sections", "rules"]}

    def export(self, selection: Any) -> dict[str, Any]:
        """Seçilen öğeler → {bundle, preview, filename, bytes}. Hiçbir şey yazılmaz (okuma)."""
        if not isinstance(selection, list) or not selection or len(selection) > B.MAX_ITEMS:
            raise ShareError(f"Dışa aktarılacak 1–{B.MAX_ITEMS} öğe seç")
        sc = self._scrubber()
        items: list[dict[str, Any]] = []
        preview: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for sel in selection:
            if not isinstance(sel, dict):
                raise ShareError("Seçim {kind, id} biçiminde olmalı")
            kind, iid = str(sel.get("kind") or ""), str(sel.get("id") or "")
            if kind not in B.KINDS or not iid or len(iid) > 80:
                raise ShareError("Seçim {kind: job|agent|output, id} biçiminde olmalı")
            before = len(sc.hits)
            item, info = {"job": self._export_job, "agent": self._export_agent,
                          "output": self._export_output}[kind](iid, sc)
            if (kind, item["id"]) in seen:
                continue
            seen.add((kind, item["id"]))
            items.append(item)
            preview.append({"kind": kind, "id": item["id"], "name": item["name"],
                            "fields": [f for f in info["fields"] if f], "prompts": info["prompts"],
                            "agents": info["agents"], "dropped": info["dropped"],
                            "redacted": sorted(set(sc.hits[before:]))[:30], "excluded": list(EXCLUDED)})
        bundle = {"format": B.FORMAT, "version": B.VERSION, "exported_at": _now(), "items": items}
        text = json.dumps(bundle, ensure_ascii=False, indent=1)
        size = len(text.encode("utf-8"))
        if size > B.MAX_BUNDLE_BYTES:
            raise ShareError(f"Paket çok büyük ({size // 1024} KB; en fazla {B.MAX_BUNDLE_BYTES // 1024} KB): daha az öğe seç",
                             413)
        B.check_bundle(bundle)  # kendi ürettiğimiz paket de içe aktarma şemasına uymalı
        stamp = datetime.now().strftime("%Y%m%d-%H%M")
        return {"bundle": bundle, "preview": preview, "bytes": size, "filename": f"paylasim-{stamp}.voxcrew-share.json"}

    # ------------------------------------------------------------ içe aktarma: plan
    def _plan(self) -> Any:
        """Studio'ya bağlı hak motoru (: motor içe aktarılmaz; tarif servisi gibi bağlı nesne okunur).
        Bağlı değilse None → kontrol pas geçer (motor yalnız create_app'te bağlanır)."""
        ent = getattr(self.studio, "entitlements", None)
        return ent if callable(getattr(ent, "check", None)) and callable(getattr(ent, "require", None)) else None

    def _brain(self, requested: dict[str, Any] | None) -> dict[str, Any]:
        from studio.connections.policy import allowed_brain  # noqa: PLC0415
        req = dict(requested or {})
        conn = str(req.get("connection") or "")
        model = str(req.get("model") or "")
        brains = self.studio.agents.available_brains()
        note = None
        ok = conn in B.IMPORT_BRAINS and bool(brains.get(conn))
        if ok:
            try:
                ok = allowed_brain(self.studio.settings, conn, model or None)
            except Exception:  # noqa: BLE001
                ok = False
            if not ok:
                note = "policy"
        elif conn:
            note = "unavailable"
        if not ok:
            conn, model = self.studio.agents.default_connection(brains), ""
        return {"requested": {"connection": req.get("connection"), "model": req.get("model")},
                "applied": {"connection": conn, "model": model}, "note": note}

    def _job_payload(self, item: dict[str, Any], warnings: list[str]) -> tuple[dict[str, Any], str | None]:
        """İş akışını kullanıcı politikasına göre denetler; (kaydedilecek veri, engel nedeni)."""
        from studio.connections.policy import allowed_brain  # noqa: PLC0415
        from studio.workflow.spec import WorkflowError, parse  # noqa: PLC0415
        wf = json.loads(json.dumps(item["workflow"]))
        wf["slug"] = item["id"]
        acc = wf.get("acceptance")
        if isinstance(acc, dict) and any(isinstance(c, dict) and c.get("kind") == "command"
                                         for c in acc.get("criteria") or []):
            return wf, "Komut çalıştıran kabul ölçütü içe aktarılamaz"
        if isinstance(wf.get("quality"), dict) and wf["quality"].get("check") not in (None, "", []):
            return wf, "Komut çalıştıran kalite denetimi (quality.check) içe aktarılamaz"
        from studio.guard.regex_safe import pattern_problem  # noqa: PLC0415
        from studio.workflow.spec import internal_step_problem  # noqa: PLC0415
        problem = internal_step_problem(wf)  # system_llm gibi iç türler yalnız motorun gizli koşularında
        if problem:
            return wf, problem
        if isinstance(acc, dict):  # felaket geri izleme yapan ya da çok uzun kalıp içe aktarılmaz
            for c in acc.get("criteria") or []:
                if isinstance(c, dict) and c.get("kind") == "regex":
                    problem = pattern_problem(c.get("pattern"))
                    if problem:
                        return wf, f"{str(c.get('id'))[:40]}: {problem}"
        no_hiring = self.studio.settings.get("goals.allow_hiring", True) is False
        for s in wf.get("steps") or []:
            if not isinstance(s, dict):
                continue
            if s.get("hiring_approval") == "auto":
                s["hiring_approval"] = "ask"
                warnings.append(f"{s.get('id')}: otomatik işe alım onayı 'sor' yapıldı")
            if s.get("plan_approval") == "auto":
                s["plan_approval"] = "ask"
                warnings.append(f"{s.get('id')}: otomatik plan onayı 'sor' yapıldı")
            if s.get("allow_hiring") and no_hiring:
                return wf, f"{s.get('id')}: işe alım Güvenli mod'da kapalı; işe alan adım içe aktarılamaz"
            conn = s.get("connection")
            if conn:
                if conn not in B.IMPORT_BRAINS:
                    return wf, f"{s.get('id')}: bilinmeyen ya da yerel beyin ({str(conn)[:30]})"
                try:
                    allowed = allowed_brain(self.studio.settings, str(conn), str(s.get("model") or "") or None)
                except Exception:  # noqa: BLE001
                    allowed = False
                if not allowed:
                    return wf, f"{s.get('id')}: model politikası bu beyne/modele izin vermiyor"
        try:
            parse(wf)
        except WorkflowError as exc:
            return wf, f"İş akışı doğrulanamadı: {str(exc)[:300]}"
        return wf, None

    def _free(self, base: str, taken: Any) -> str:
        n = 2
        while True:
            suffix = f"-{n}"
            cand = base[:41 - len(suffix)].rstrip("-_") + suffix
            if not taken(cand):
                return cand
            n += 1

    def _plans(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        from studio.guard.injection import scan  # noqa: PLC0415
        lib = self.studio.library
        agents = {a["slug"]: a for a in self.studio.agents.list()}
        names = {str(a.get("name") or "").casefold() for a in agents.values()}
        outputs = {o["id"]: o for o in self.outputs()}
        bundle_agents = {i["id"] for i in items if i["kind"] == "agent"}
        ent = self._plan()
        plans = []
        for item in items:
            kind, iid = item["kind"], item["id"]
            warnings: list[str] = []
            blocked = None
            prompts: list[dict[str, str]] = []
            payload: Any = item
            existing: Any = None
            if kind == "job":
                payload, blocked = self._job_payload(item, warnings)
                collision = lib.exists(iid)
                if collision:
                    try:
                        existing = {"workflow": lib.get(iid).to_dict(), "name": lib.get(iid).name}
                    except Exception:  # noqa: BLE001
                        existing = {}
                for s in payload.get("steps") or []:
                    if isinstance(s, dict):
                        text = s.get("prompt") or s.get("message") or ""
                        if text:
                            prompts.append({"field": f"{s.get('id')}", "text": str(text)})
                prompts += self._rule_texts(payload)  # kabul ölçütleri ve kalite kuralları da görünür + taranır
                # içe aktarılan iş SENİN yazma izinli ajanını sürebilir — adıyla uyar ve işaretle
                writers = []
                for s in payload.get("steps") or []:
                    if not isinstance(s, dict):
                        continue
                    slug = s.get("agent")
                    if not slug and s.get("role"):
                        try:
                            slug = self.studio.engine.resolve_role(str(s["role"]))
                        except Exception:  # noqa: BLE001
                            slug = None
                    a = agents.get(str(slug)) if slug else None
                    if a and str(a.get("permissions") or "read") == "write" and slug not in writers:
                        writers.append(str(slug))
                if writers:
                    warnings.append("Bu iş senin yazma izinli ajanlarını çalıştırır (dosya yazabilir/silebilir): "
                                    + ", ".join(writers) + " — istemleri dikkatle oku")
                refs = sorted({str(s.get("agent")) for s in payload.get("steps") or []
                               if isinstance(s, dict) and s.get("agent")})
                missing = [r for r in refs if r not in agents and r not in bundle_agents]
                if missing:
                    warnings.append("Bu ajanlar sende yok; akışı çalıştırmadan önce adımlara ajan seç: "
                                    + ", ".join(missing))
                if not blocked and ent is not None:
                    d = ent.check("workflows")
                    if not d.allowed:
                        warnings.append(str(d.message or "Paket sınırı: yeni iş akışı eklenemez"))
                target_id = self._free(iid, lib.exists) if collision else iid
            elif kind == "agent":
                collision = iid in agents or str(item.get("name") or "").casefold() in names
                if collision:
                    ex = agents.get(iid) or next((a for a in agents.values()
                                                  if str(a.get("name") or "").casefold() == str(item["name"]).casefold()), {})
                    existing = {k: ex.get(k) for k in ("name", "title", "role", "persona", "rank", "color",
                                                       "connection", "model", "permissions")}
                target_id = self._free(iid, lambda s: s in agents) if iid in agents else iid
                for f in ("role", "persona"):
                    if item.get(f):
                        prompts.append({"field": f, "text": str(item[f])})
            else:
                collision = iid in outputs
                existing = self._comparable("output", None, outputs[iid]) if collision else None
                target_id = self._free(iid, lambda s: s in outputs) if collision else iid
                # şablon bölümleri ve kuralları önizlemede görünür ve enjeksiyon taramasından geçer
                for i, sec in enumerate(item.get("sections") or []):
                    prompts.append({"field": f"sections[{i}]", "text": str(sec)})
                if item.get("rules"):
                    prompts.append({"field": "rules", "text": ", ".join(str(r) for r in item["rules"])})
            name = str(item.get("name") or iid)
            target_name = name
            if collision:
                n = target_id.rsplit("-", 1)[-1] if target_id != iid else "2"
                target_name = f"{name} ({n})"
            flags = []
            for p in prompts:
                fam = scan(p["text"])
                if fam:
                    flags.append({"field": p["field"], "patterns": fam})
            for f in ("name", "title", "description"):
                fam = scan(str(item.get(f) or ""))
                if fam:
                    flags.append({"field": f, "patterns": fam})
            if kind == "job" and any(w.startswith("Bu iş senin yazma izinli") for w in warnings):
                flags.append({"field": "agents", "patterns": ["write_agent"]})
            prompts = [{**p, "text": B.visible(p["text"])} for p in prompts]  # görünmez karakter görünür
            pub: dict[str, Any] = {
                "key": f"{kind}:{iid}", "kind": kind, "id": iid, "name": name, "target_id": target_id,
                "target_name": target_name, "collision": collision, "blocked": blocked, "warnings": warnings,
                "prompts": prompts, "flags": flags,
                "choices": ["skip"] if blocked else (["add", "replace", "skip"] if collision and kind != "agent"
                                                     else ["add", "skip"]),
                "diff": B.flat_diff(existing, self._comparable(kind, payload, item)) if collision else []}
            if kind == "agent":
                pub["permissions"] = {"declared": item.get("permissions") or "read", "applied": "read"}
                pub["brain"] = self._brain(item.get("brain"))
            if kind == "job":
                pub["baseline"] = item.get("baseline")
                pub["steps"] = len(payload.get("steps") or [])
            plans.append({"public": pub, "payload": payload, "item": item})
        return plans

    @staticmethod
    def _rule_texts(wf: dict[str, Any]) -> list[dict[str, str]]:
        """İş akışının kabul ölçütleri ve kalite bloğu → önizleme metinleri."""
        out: list[dict[str, str]] = []
        acc = wf.get("acceptance")
        for c in (acc.get("criteria") or []) if isinstance(acc, dict) else []:
            if not isinstance(c, dict):
                continue
            body = c.get("text") or c.get("pattern") or ", ".join(str(k) for k in c.get("keywords") or [])                 or (json.dumps(c.get("schema"), ensure_ascii=False)[:2000] if c.get("schema") else "")
            out.append({"field": f"acceptance.{str(c.get('id'))[:40]} ({c.get('kind') or 'manual'})",
                        "text": str(body or "")})
        if isinstance(acc, dict) and acc.get("reviewer"):
            out.append({"field": "acceptance.reviewer", "text": str(acc["reviewer"])})
        q = wf.get("quality")
        if isinstance(q, dict) and q:
            out.append({"field": "quality", "text": json.dumps(q, ensure_ascii=False)[:4000]})
        return out

    @staticmethod
    def _comparable(kind: str, payload: Any, item: dict[str, Any]) -> Any:
        if kind == "job":
            return {"workflow": payload, "name": item.get("name")}
        if kind == "agent":
            brain = item.get("brain") or {}
            return {"name": item.get("name"), "title": item.get("title"), "role": item.get("role"),
                    "persona": item.get("persona"), "rank": item.get("rank"), "color": item.get("color"),
                    "connection": brain.get("connection"), "model": brain.get("model"), "permissions": "read"}
        return {k: item.get(k) for k in ("id", "name", "description", "format", "sections", "rules")}

    def preview(self, data: Any) -> dict[str, Any]:
        items = B.check_bundle(data)
        plans = self._plans(items)
        return {"ok": True, "format": B.FORMAT, "version": B.VERSION, "exported_at": data.get("exported_at"),
                "items": [p["public"] for p in plans]}

    # ------------------------------------------------------------ içe aktarma: uygula
    def apply(self, data: Any, choices: Any, confirm: Any) -> dict[str, Any]:
        if confirm is not True:
            raise ShareError("İçe aktarmak için önizlemeyi onayla (confirm: true)")
        items = B.check_bundle(data)
        choices = choices if isinstance(choices, dict) else {}
        plans = self._plans(items)
        keys = {p["public"]["key"] for p in plans}
        for k, v in choices.items():
            if k not in keys or v not in CHOICES:
                raise ShareError(f"Geçersiz seçim: {str(k)[:60]}")
        for p in plans:
            pub = p["public"]
            ch = choices.get(pub["key"], pub["choices"][0])  # engellenen öğenin varsayılanı "skip"
            if ch not in pub["choices"]:
                raise ShareError(f"{pub['name']}: bu öğe için '{ch}' seçilemez")
        order = {"agent": 0, "output": 1, "job": 2}
        results: list[dict[str, Any]] = []
        mapping: dict[str, str] = {}
        stamp = _now()
        for p in sorted(plans, key=lambda x: order[x["public"]["kind"]]):
            pub, item = p["public"], p["item"]
            ch = choices.get(pub["key"], pub["choices"][0])
            res = {"key": pub["key"], "kind": pub["kind"], "name": pub["name"]}
            if pub["blocked"] or ch == "skip":
                results.append({**res, "status": "skipped", "reason": pub["blocked"] or "user"})
                continue
            target = pub["id"] if ch == "replace" else pub["target_id"]
            name = pub["name"] if ch == "replace" else pub["target_name"]
            try:
                if pub["kind"] == "agent":
                    target = self._apply_agent(item, pub, target, name)
                    mapping[pub["id"]] = target
                elif pub["kind"] == "output":
                    self._put_output({"id": target, "name": name, "description": item.get("description") or "",
                                      "format": item.get("format") or "md", "sections": list(item["sections"]),
                                      "rules": list(item.get("rules") or []), "imported": True, "created_at": stamp})
                else:
                    target = self._apply_job(p["payload"], item, target, name, mapping, replace=ch == "replace")
            except Exception as exc:  # noqa: BLE001 - bir öğenin hatası diğerlerini durdurmaz; dürüstçe raporlanır
                msg = getattr(getattr(exc, "decision", None), "message", None) or str(exc).strip("'\"")
                results.append({**res, "status": "error", "error": str(msg)[:300]})
                continue
            info = {"imported_at": stamp, "source_id": pub["id"], "source_exported_at": data.get("exported_at"),
                    "flags": pub["flags"], "replaced": ch == "replace"}
            if pub["kind"] == "agent":
                info["declared_permissions"] = pub["permissions"]["declared"]
            self._mark_imported(f"{pub['kind']}:{target}", info)
            results.append({**res, "status": "replaced" if ch == "replace" else "added", "id": target,
                            "read_only": pub["kind"] == "agent", "flagged": bool(pub["flags"])})
        try:
            self.studio.bus.publish("share.imported", items=[{"kind": r["kind"], "id": r.get("id"),
                                                              "status": r["status"]} for r in results])
        except Exception:  # noqa: BLE001
            pass
        return {"ok": all(r["status"] != "error" for r in results), "results": results}

    def _apply_agent(self, item: dict[str, Any], pub: dict[str, Any], slug: str, name: str) -> str:
        brain = pub["brain"]["applied"]
        data: dict[str, Any] = {"name": name, "slug": slug, "role": item.get("role") or "",
                                "persona": item.get("persona") or "", "runtime": "direct",
                                "connection": brain["connection"], "model": brain["model"] or "",
                                "permissions": "read",        # dosya ne derse desin: salt okuma
                                "memory_scope": "private"}    # kullanıcının ortak belleğini okumaz
        for k in ("title", "rank", "color", "avatar"):
            if item.get(k):
                data[k] = item[k]
        created = self.studio.agents.create(data)
        if created.get("permissions") != "read":  # savunma: yaratıcı başka bir değer yazdıysa
            self.studio.agents.update(created["slug"], {"permissions": "read"})
        return str(created["slug"])

    def _apply_job(self, payload: dict[str, Any], item: dict[str, Any], slug: str, name: str,
                   mapping: dict[str, str], *, replace: bool) -> str:
        lib = self.studio.library
        wf = json.loads(json.dumps(payload))
        wf["slug"] = slug
        if not replace and slug != item["id"]:  # çakışma: ad da sonek alır ("Ad (2)")
            wf["name"] = f"{wf.get('name') or name} ({slug.rsplit('-', 1)[-1]})"
        for s in wf.get("steps") or []:
            if isinstance(s, dict) and s.get("agent") in mapping:
                s["agent"] = mapping[s["agent"]]
        if not lib.exists(slug) and (ent := self._plan()) is not None:  # E7: yalnız yeni akış sayılır
            ent.require("workflows")
        spec = lib.save(wf)
        self.studio.store.upsert_node("Workflow", {"slug": spec.slug, "name": spec.name,
                                                   "description": spec.description})
        if item.get("baseline") and EDITION == "full":
            from studio.full.timesaved import TimeSavedService  # noqa: PLC0415
            TimeSavedService(self.studio).set_baselines({f"workflow:{spec.slug}": dict(item["baseline"])})
        return spec.slug


def service_for(studio: "Studio") -> ShareService:
    svc = getattr(studio, "_share_service", None)
    if svc is None:
        svc = ShareService(studio)
        setattr(studio, "_share_service", svc)
    return svc
