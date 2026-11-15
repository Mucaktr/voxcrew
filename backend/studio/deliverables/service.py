"""Teslim edilen çıktılar (S50): koşu bitince "rapor nerede?" sorusunun cevabı.

Sözleşme:
- Koşu `done` bitince (motor kancası `on_run_finished`) son adım çıktısı ve adımların çalışma klasörüne yazdığı
  dosyalar birer `Deliverable` düğümü olur (`DELIVERED: Run→Deliverable`, dosyada `DELIVERS: Deliverable→Artifact`).
  Kimlik kararlıdır (`dlv_<sha1(run|kaynak|ad)>`): devam/yeniden bitişte aynı düğüm güncellenir, sabitleme korunur.
- Kullanıcının gelen kutusuna tek kalem düşer: `Message{kind: deliverable, to_agent: user}` — başlık "Görev tamamlandı:
  <başlık>", maskeli ilk satırlar ve her çıktıya / koşuya referans. Başarısız koşu `kind: system` "Dikkat gerekiyor"
  kalemi yazar. Kullanıcıya yalnızca stüdyo yazar (`MessagingService.send(enforce_policy=False)`; REST/MCP 403).
- Olay: `deliverable.ready {run_id, status, title, items, message_id, primary}` (arayüz masaüstü bildirimi + liste).
- Bütün metinler (özet, arama metni, indirme) `studio.changes.redact_text` ile maskelenir; ham dosya yalnızca görsel ve
  PDF için verilir (maskelenemeyen ikili içerik).
- Açılışta son `BACKFILL_MAX` bitmiş koşu için kayıtlar geriye dönük oluşturulur (okunmuş işaretli, gelen kutusuna
  yazılmaz).
- Değerlendirme (`eval:`) ve hakem (`review:`) koşuları teslim üretmez.
- DELIV-P0: dosya çıktıları içerik adresli kasaya (`vault.py`) kopyalanır (sha256 + boyut kayıtlı; sonradan değişen çalışma
  dosyası eski çıktıyı etkilemez); aynı yolun yeni içeriği `family/version` + `SUPERSEDES` zinciri kurar; `index.html` içeren
  koşu dosyaları `kind: app` paketi (manifest) olur ve sandbox'lı iframe ile önizlenir (`api.py`, `site` ucu); ikili biçimler
  (docx/xlsx/pptx/zip/mp4…) metne çevrilmez, orijinal yalnızca arayüzden indirilir.
"""

from __future__ import annotations

import hashlib
import logging
import posixpath
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any

from studio._edition import EDITION

from studio.changes import redact_text
from studio.deliverables import compare as compare_mod  # DEPO-TESLIM
from studio.deliverables import formats
from studio.deliverables.formats import (RAW_EXT, TEXT_KINDS, WEB_EXT, is_binary, mime_for, suffix as _suffix,
                                         view_kind, view_mime)  # DEPO-TESLIM
from studio.deliverables.vault import Vault, is_sha, limits as vault_limits, sha256_file
from studio.graph.store import now_iso

log = logging.getLogger("studio.deliverables")

KINDS = ("report", "text", "code", "data", "image", "other", "document", "presentation", "sheet", "media", "archive", "app")
SOURCES = ("output", "file", "bundle")
BUNDLES_PER_RUN = 3
SITE_TOKEN_TTL_S = 2 * 3600   # uygulama önizleme oturumu ömrü (bellekte; yeniden başlatmada düşer)
SITE_TOKENS_MAX = 64
SKIP_ORIGINS = ("eval:", "review:", "system:")  # system: gizli sistem koşusu (kalite denetçisi; AUDIT P1)
BACKFILL_MAX = 200
LIST_SCAN = 3000
LIST_MAX = 500


def recipe_of_workflow(slug: Any) -> str | None:
    """FOLLOWUP: `recipe-<id>` iş akışı → tarif kimliği (tarif koşusu değilse None)."""
    if EDITION != "full":
        return None  # tarifler yalnız full sürümde
    from studio.full.recipes import recipe_id_of  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın

    return recipe_id_of(str(slug or "")) or None


def recipe_titles(ids: list[str]) -> dict[str, dict[str, str]]:
    """Tarif kimliği → {tr, en} başlık (katalogda yoksa kimliğin kendisi)."""
    RECIPES: list[Any] = []
    if EDITION == "full":
        try:
            from studio.full.recipes import RECIPES  # noqa: PLC0415
        except Exception:  # noqa: BLE001 - tarif modülü yoksa başlık kimlik olur
            RECIPES = []
    by_id = {str(r.get("id")): r.get("title") for r in RECIPES}
    out: dict[str, dict[str, str]] = {}
    for rid in ids[:100]:
        t = by_id.get(rid)
        out[rid] = ({"tr": str(t.get("tr") or rid), "en": str(t.get("en") or t.get("tr") or rid)}
                    if isinstance(t, dict) else {"tr": rid, "en": rid})
    return out
FILES_PER_RUN = 40
EXCERPT_MAX = 4000
SUMMARY_LINES = 8
SUMMARY_MAX = 600
CONTENT_MAX = 400_000
VIEW_MAX_MB_MIN = 1  # sınırın alt kıstırması (MB)
VIEW_MAX_MB_DEFAULT = 64  # DEPO-TESLIM: satır içi PDF / ses / video üst sınırı (tarayıcı belleğe alır)


class ViewError(Exception):
    """DEPO-TESLIM: satır içi görüntüleme reddi; `status` HTTP durumu (413 büyük, 409 kasa kopyası bozuk, 415 desteklenmeyen)."""

    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status
_CODE_LANG = {".py": "python", ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".ts": "typescript",
              ".tsx": "typescript", ".jsx": "javascript", ".sh": "bash", ".ps1": "powershell", ".sql": "sql",
              ".json": "json", ".jsonl": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml", ".css": "css",
              ".html": "html", ".htm": "html", ".xml": "xml", ".csv": "csv", ".go": "go", ".rs": "rust",
              ".java": "java", ".c": "c", ".cpp": "cpp", ".cs": "csharp", ".rb": "ruby", ".php": "php"}
_MD_HINT = re.compile(r"^\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>\s|```)", re.M)

_T = {
    "done_subject": {"tr": "Görev tamamlandı: {}", "en": "Task finished: {}"},
    "fail_subject": {"tr": "Dikkat gerekiyor: {}", "en": "Needs attention: {}"},
    "summary": {"tr": "Özet", "en": "Summary"},
    "outputs": {"tr": "Çıktılar", "en": "Outputs"},
    "result": {"tr": "Sonuç metni", "en": "Result text"},
    "file": {"tr": "Dosya", "en": "File"},
    "where": {"tr": "Hepsi **Çıktılar** sayfasında: aç, indir (.md, .txt, PDF, Word) ya da koşuya git.",
              "en": "All of them are on the **Outputs** page: open, download (.md, .txt, PDF, Word) or go to the run."},
    "failed": {"tr": "Koşu başarısız oldu. Hata:", "en": "The run failed. Error:"},
    "fail_hint": {"tr": "Koşuyu açıp adımı yeniden deneyebilir ya da görevi düzenleyebilirsin.",
                  "en": "Open the run to retry the step or adjust the task."},
    "no_error": {"tr": "(hata metni yok)", "en": "(no error text)"},
}


def _t(key: str, lang: str | None, *args: Any) -> str:
    text = _T[key]["en" if lang == "en" else "tr"]
    return text.format(*args) if args else text


def redact(text: str | None) -> str:
    """Dışarı çıkan her metin (özet, arama, indirme, gelen kutusu) bundan geçer."""
    return redact_text(str(text or ""))


def kind_for_name(name: str) -> str:
    return formats.kind_for_suffix(_suffix(name))


def kind_for_output(text: str) -> str:
    """Biçimli (başlık/liste/tablo) ya da uzun çıktı rapordur; kısa düz yanıt metindir."""
    return "report" if _MD_HINT.search(text or "") or len(text or "") > 600 else "text"


def code_lang(name: str) -> str | None:
    return _CODE_LANG.get(Path(str(name)).suffix.lower())


def first_lines(text: str, lines: int = SUMMARY_LINES, limit: int = SUMMARY_MAX) -> str:
    """Özet: ilk anlamlı satırlar (kod blokları ve tablo satırları atlanır), ≤ limit karakter."""
    out: list[str] = []
    fenced = False
    for raw in str(text or "").splitlines():
        line = raw.rstrip()
        if line.strip().startswith("```"):
            fenced = not fenced
            continue
        if fenced or not line.strip() or line.lstrip().startswith("|"):
            continue
        out.append(line)
        if len(out) >= lines:
            break
    s = "\n".join(out).strip()
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def regenerate_summary(props: dict[str, Any], scrub: Any, mark: str, at: str) -> dict[str, Any]:
    """ (unutma): türetilmiş özet, unutulan içerik olmadan yeniden üretilir. `scrub(metin) → (yeni, sayı)`.
    Arama metni (`excerpt`) karartılır, özet ondan yeniden çıkarılır; geriye yalnız karartma işareti kalırsa özet
    kaldırılıp işaretlenir (`summary = mark`). Değişiklik yoksa boş yama döner."""
    patch: dict[str, Any] = {}
    excerpt, n_ex = scrub(str(props.get("excerpt") or ""))
    summary, n_sum = scrub(str(props.get("summary") or ""))
    for key in ("title", "run_title"):
        text, n = scrub(str(props.get(key) or ""))
        if n:
            patch[key] = text
    if not (n_ex or n_sum or patch):
        return {}
    if n_ex:
        patch["excerpt"] = excerpt
    if n_ex or n_sum:
        fresh = first_lines(excerpt) if excerpt.strip() else summary
        left = fresh.replace(mark, " ").strip(" \n\t.,;:-…")
        patch["summary"] = fresh if left else mark
    patch["forgotten_at"] = at
    return patch


def deliverable_id(run_id: str, source: str, name: str = "") -> str:
    return "dlv_" + hashlib.sha1(f"{run_id}|{source}|{name}".encode("utf-8")).hexdigest()[:16]


def family_id(project: Any, source: str, path: str, agent: Any = None) -> str:
    """Koşular arası kararlı küme (DELIV-P0 sürüm zinciri). Dosyada ortak çalışma klasöründeki yol kimliktir (başka ajan
    aynı yolu değiştirse de aynı dosya); sonuç metninde ajan da girer (iki ajanın aynı başlıklı raporu karışmasın)."""
    raw = f"{project or 'global'}|{source}|{path}|{agent or '' if source == 'output' else ''}"
    return "fam_" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def slug_name(title: str, fallback: str = "cikti") -> str:
    """İndirme adı: Türkçe harfler sadeleştirilir, dosya sistemi için güvenli."""
    table = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", str(title or "").translate(table)).strip("-._")[:60].rstrip("-._")
    return s.lower() or fallback


# ---------------------------------------------------------------- koşu bilgisi (canlı durum ya da graf düğümü)
def info_from_state(run: Any) -> dict[str, Any]:
    """Motorun `RunState`'inden nötr koşu bilgisi."""
    steps = []
    for st in run.steps.values():
        steps.append({"id": st.spec.id, "agent": st.spec.agent, "type": st.spec.type, "parent": st.parent,
                      "status": st.status, "output": st.output or "", "title": st.spec.title or st.spec.id,
                      "files": [{"name": a.get("name"), "size": a.get("size"), "id": a.get("id")}
                                for a in (st.artifacts or []) if a.get("name")]})
    return {"id": run.id, "title": run.title, "status": run.status, "project": run.project, "goal": run.goal,
            "origin": run.origin, "lang": run.lang, "finished_at": run.finished_at, "output": run.output or "",
            "error": run.error, "node_id": run.node_id, "steps": steps,
            "deliverable": getattr(getattr(run, "spec", None), "deliverable", None)}  # PROC-FIX


def info_from_node(store: Any, node: dict[str, Any]) -> dict[str, Any]:
    """Graf `Run` düğümünden (geri doldurma) nötr koşu bilgisi; adım sırası `Run.steps` listesinden."""
    p = node["props"]
    order = [s.get("id") for s in (p.get("steps") or []) if isinstance(s, dict)]
    step_nodes = [n for _e, n, d in store.neighbors(node["id"], rels=["HAS_STEP"], direction="out")
                  if n["type"] == "Step"]
    produced = store.neighbors_many([n["id"] for n in step_nodes], rels=["PRODUCED"], direction="out")
    steps = []
    for n in step_nodes:
        sp = n["props"]
        files = [{"name": a["props"].get("name"), "size": None, "id": a["id"]}
                 for _e, a, _d in produced.get(n["id"], []) if a["type"] == "Artifact" and a["props"].get("name")]
        steps.append({"id": sp.get("step_id"), "agent": sp.get("agent"), "type": sp.get("type") or "agent",
                      "parent": sp.get("parent"), "status": sp.get("status"), "output": sp.get("output") or "",
                      "title": sp.get("title") or sp.get("step_id"),
                      "files": files})
    rank = {sid: i for i, sid in enumerate(order)}
    steps.sort(key=lambda s: rank.get(s["id"], len(rank)))
    return {"id": p.get("id"), "title": p.get("title") or p.get("id"), "status": p.get("status"),
            "project": p.get("project"), "goal": p.get("goal"), "origin": p.get("origin"), "lang": None,
            "finished_at": p.get("finished_at") or node.get("updated_at"), "output": p.get("output") or "",
            "error": p.get("error"), "node_id": node["id"], "steps": steps,
            "deliverable": (((p.get("checkpoint") or {}).get("spec") or {}).get("deliverable")  # PROC-FIX
                            if isinstance(p.get("checkpoint"), dict) else None)}


def _sink(info: dict[str, Any]) -> dict[str, Any] | None:
    """Son çıktıyı veren üst düzey ajanlı adım (motorun `_finish_run` kuralı). PROC2-FIX akış birden çok teslim
    adımı verdiyse sentetik kayıt: ilk adımın kimliği/ajanı, `ids` = hepsi, çıktı = sırayla başlıklı birleşim."""
    from studio.workflow.spec import AGENTIC_TYPES, combine_deliverable, deliverable_ids
    top = [s for s in info["steps"] if not s.get("parent")]
    ids = deliverable_ids(info.get("deliverable"))
    if ids:  # PROC-FIX akışın teslim adımı (kalite kapısı ve sergi bu kaydı kullanır)
        hits = [h for d in ids for h in top if h.get("id") == d and (h.get("output") or "").strip()]
        if len(hits) == 1:
            return hits[0]
        if hits:
            return {**hits[0], "ids": [h["id"] for h in hits],
                    "output": combine_deliverable([(str(h.get("title") or h["id"]), h["output"]) for h in hits])}
    sinks = [s for s in top if s.get("type") in AGENTIC_TYPES and (s.get("output") or "").strip()]
    return sinks[-1] if sinks else None


class DeliverableService:
    def __init__(self, *, store: Any, bus: Any = None, settings: Any = None, agents: Any = None,
                 messages: Any = None, data_dir: Path | None = None):
        self.store, self.bus, self.settings, self.agents, self.messages = store, bus, settings, agents, messages
        if data_dir is None and not getattr(store, "_memory", False) and getattr(store, "path", None):
            data_dir = Path(store.path).parent  # kasa, graf veritabanının yanında (bellek içi grafta kasa yok)
        self.data_dir = Path(data_dir) if data_dir else None
        self.vault: Vault | None = Vault(self.data_dir, settings) if self.data_dir else None
        if self.vault is not None:
            self.vault.live_shas = self.live_shas
        self._site_tokens: dict[str, tuple[str, float, bool]] = {}  # belirteç → (çıktı, bitiş, betik izni)
        self._site_lock = threading.Lock()

    @classmethod
    def for_engine(cls, engine: Any, data_dir: Path | None = None) -> "DeliverableService":
        return cls(store=engine.store, bus=engine.bus, settings=engine.settings, agents=engine.agents,
                   messages=getattr(engine, "messages", None), data_dir=data_dir)

    def attach(self, engine: Any) -> None:
        hooks = engine.hooks.on_run_finished
        if not any(getattr(h, "__self__", None) is not None and isinstance(h.__self__, DeliverableService)
                   for h in hooks):
            hooks.append(self._on_run_finished)
        try:  # CG-QUALITY: kalite kapısı teslim kaydından SONRA çalışır (kancası bundan sonra eklenir)
            from studio.quality import attach as attach_quality
            attach_quality(engine, self)
        except ImportError:
            pass

    def workdir(self) -> Path:
        return Path(self.settings.workdir)

    # ------------------------------------------------------------------ motor kancası
    def _on_run_finished(self, run: Any, status: str) -> None:
        origin = str(getattr(run, "origin", "") or "")
        if origin.startswith(SKIP_ORIGINS):
            return
        info = info_from_state(run)
        info["status"] = status
        if status == "done":
            self.deliver(info)
        elif status == "failed":
            self.attention(info)

    # ------------------------------------------------------------------ yazma
    def _team(self, agent: str | None) -> str | None:
        if not agent:
            return None
        node = self.store.find("Agent", agent)
        return (node["props"].get("team") or None) if node else None

    def _real(self, root: Path, name: str) -> Path | None:
        """Çalışma klasörü içinde çözülmüş dosya (dışarı kaçan/simge bağlantılı yol ve dizinler None)."""
        from studio import workspace
        try:
            return workspace.resolve_inside(root, str(name))
        except (PermissionError, FileNotFoundError, OSError, ValueError):
            return None

    def _vault_meta(self, path: Path | None) -> dict[str, Any]:
        """Dosyayı kasaya kopyalar; ontolojiye yazılacak {sha256, blob, vault_status}."""
        if path is None:
            return {"vault_status": "missing"}
        if self.vault is None:
            return {"vault_status": "off"}
        res = self.vault.put_file(path)
        out: dict[str, Any] = {"vault_status": res["status"]}
        if res.get("sha256"):
            out["sha256"] = res["sha256"]
        if res.get("blob"):
            out["blob"] = res["blob"]
        return out

    def record(self, info: dict[str, Any], *, backfill: bool = False) -> list[dict[str, Any]]:
        """Koşunun çıktılarını `Deliverable` düğümlerine yazar; [çıktılar] döner (önce son çıktı, sonra dosyalar).
        Canlı koşuda dosyalar kasaya kopyalanır (sha256); geri doldurmada kopya yok (dosya bugünkü hâliyle olabilir)."""
        run_id = str(info["id"])
        created = info.get("finished_at") or now_iso()
        base = {"run_id": run_id, "run_title": info.get("title") or run_id, "project": info.get("project") or "global",
                "goal": info.get("goal") or None, "origin": info.get("origin") or None,
                # FOLLOWUP: tarif koşusu (Run.workflow recipe-<id>); "" = tarif değil (eski kayıtlar listede koşudan çözülür)
                "recipe": recipe_of_workflow(info.get("workflow")) or ""}
        items: list[tuple[dict[str, Any], str | None]] = []
        sink = _sink(info)
        output = (sink or {}).get("output") or (info.get("output") or "")
        if output.strip():
            agent = (sink or {}).get("agent")
            clean = redact(output)
            oname = slug_name(info.get("title") or "", "sonuc") + ".md"
            items.append(({**base, "id": deliverable_id(run_id, "output"), "source": "output",
                           "step_id": (sink or {}).get("id"), "step_ids": (sink or {}).get("ids"),  # PROC2-FIX
                           "agent": agent, "team": self._team(agent),
                           "title": info.get("title") or run_id, "kind": kind_for_output(output),
                           "name": oname, "format": ".md", "mime": "text/markdown",
                           "sha256": hashlib.sha256(output.encode("utf-8")).hexdigest(),
                           "family": family_id(base["project"], "output", oname, agent),
                           "size": len(output.encode("utf-8")), "summary": first_lines(clean),
                           "excerpt": clean[:EXCERPT_MAX]}, None))
        root = self.workdir()
        seen: dict[str, dict[str, Any]] = {}
        for st in info["steps"]:
            for f in st.get("files") or []:
                seen[str(f["name"])] = {**f, "step": st["id"], "agent": st.get("agent")}
        names = list(seen)[:FILES_PER_RUN]
        for name in names:
            f = seen[name]
            real = self._real(root, name)
            try:
                size = real.stat().st_size if real is not None else None
            except OSError:
                size = None
            if size is None and backfill:
                continue  # geri doldurmada artık olmayan dosya kaydedilmez
            kind = kind_for_name(name)
            summary = excerpt = None
            if not is_binary(name) and size is not None:  # ikili biçim UTF-8'e çevrilmez (çöp metin yok)
                try:
                    with real.open("rb") as fh:  # type: ignore[union-attr]
                        head = redact(fh.read(EXCERPT_MAX * 2).decode("utf-8", "replace"))
                    summary, excerpt = first_lines(head), head[:EXCERPT_MAX]
                except OSError:
                    pass
            meta: dict[str, Any] = {"format": _suffix(name) or None, "mime": mime_for(name)}
            if not backfill:
                meta.update(self._vault_meta(real) if size is not None else {"vault_status": "missing"})
            items.append(({**base, "id": deliverable_id(run_id, "file", name), "source": "file", "step_id": f["step"],
                           "agent": f.get("agent"), "team": self._team(f.get("agent")),
                           "title": Path(name).name, "kind": kind, "name": Path(name).name, "path": name,
                           "family": family_id(base["project"], "file", name.replace("\\", "/")),
                           "size": size if size is not None else f.get("size"), "summary": summary,
                           "excerpt": excerpt, **meta}, f.get("id")))
        if not backfill:
            items.extend((props, None) for props in self._bundles(root, names, seen, base, run_id))
        out: list[dict[str, Any]] = []
        run_node = self.store.find("Run", run_id)
        for props, artifact_id in items:
            existing = self.store.find("Deliverable", props["id"])
            if existing:
                patch = {k: v for k, v in props.items() if v is not None and k != "id"}
                if not backfill and existing["props"].get("excerpt") != props.get("excerpt"):
                    patch["read_at"] = None  # içerik değişti (devam/yeniden bitiş): yeniden okunmamış
                node = self.store.patch_node(existing["id"], patch)
            else:
                version, prev = self._next_version(props, backfill)
                extra = {"created_at": created, "pinned": False, "version": version}
                if backfill:
                    extra.update({"read_at": created, "backfilled": True})
                node = self.store.upsert_node("Deliverable", {**{k: v for k, v in props.items() if v is not None},
                                                              **extra})
                if prev is not None and prev["id"] != node["id"]:
                    self.store.link("SUPERSEDES", node["id"], prev["id"])  # yeni sürüm → önceki
            if run_node:
                self.store.link("DELIVERED", run_node["id"], node["id"])
            if artifact_id:
                try:
                    self.store.link("DELIVERS", node["id"], str(artifact_id))
                except Exception:  # noqa: BLE001 - dosya düğümü silinmiş olabilir
                    log.debug("DELIVERS bağlanamadı: %s", artifact_id)
            out.append(self.public(node))
        return out

    def _next_version(self, props: dict[str, Any], backfill: bool) -> tuple[int, dict[str, Any] | None]:
        """Aynı `family`'nin son çıktısına göre (sürüm, SUPERSEDES hedefi). Aynı baytlar yeni sürüm sayılmaz."""
        fam = props.get("family")
        if backfill or not fam:
            return 1, None
        prev = next(iter(self.store.nodes("Deliverable", limit=1, order="created_at DESC", props={"family": fam})), None)
        if prev is None:
            return 1, None
        pv = int(prev["props"].get("version") or 1)
        psha, sha = prev["props"].get("sha256"), props.get("sha256")
        if psha and sha and psha == sha:
            return pv, None
        return pv + 1, prev

    def _bundles(self, root: Path, names: list[str], seen: dict[str, dict[str, Any]], base: dict[str, Any],
                 run_id: str) -> list[dict[str, Any]]:
        """`index.html` içeren dizin = statik web uygulaması paketi (`kind: app`, kasada manifest)."""
        if self.vault is None:
            return []
        norm = {n.replace("\\", "/"): n for n in names}
        entries = sorted((n for n in norm if posixpath.basename(n).lower() in ("index.html", "index.htm")),
                         key=lambda n: (n.count("/"), n))
        taken: list[str] = []
        out: list[dict[str, Any]] = []
        for entry in entries:
            d = posixpath.dirname(entry)
            if any(not t or d == t or d.startswith(t + "/") for t in taken):
                continue  # üst dizindeki paket bunu zaten kapsıyor
            if len(out) >= BUNDLES_PER_RUN:
                break
            prefix = d + "/" if d else ""
            manifest: list[dict[str, Any]] = []
            worst = "stored"
            for n in sorted(k for k in norm if k.startswith(prefix) and _suffix(k) in WEB_EXT):
                real = self._real(root, norm[n])
                meta = self._vault_meta(real)
                if meta.get("vault_status") != "stored":
                    worst = str(meta.get("vault_status") or "missing")
                    if n == entry:  # giriş dosyası kasaya girmediyse paket olmaz
                        manifest = []
                        break
                    continue
                manifest.append({"path": n[len(prefix):], "sha256": meta["sha256"],
                                 "size": real.stat().st_size if real is not None else 0,
                                 "role": "entry" if n == entry else "file"})
            if not any(m["role"] == "entry" for m in manifest):
                continue
            taken.append(d)
            digest = hashlib.sha256("\n".join(f"{m['path']}\0{m['sha256']}" for m in manifest).encode("utf-8")).hexdigest()
            f = seen[norm[entry]]
            title = (posixpath.basename(d) if d else "") or str(base.get("run_title") or run_id)
            entry_rel = entry[len(prefix):]
            out.append({**base, "id": deliverable_id(run_id, "bundle", d or "."), "source": "bundle", "kind": "app",
                        "step_id": f.get("step"), "agent": f.get("agent"), "team": self._team(f.get("agent")),
                        "title": title, "name": slug_name(title, "uygulama"), "path": norm[entry],
                        "format": ".html", "mime": "text/html", "sha256": digest, "entry": entry_rel,
                        "manifest": manifest, "size": sum(int(m["size"]) for m in manifest),
                        "vault_status": worst, "summary": f"{len(manifest)} dosya · {entry_rel}",
                        "family": family_id(base["project"], "bundle", d or ".")})
        return out

    def deliver(self, info: dict[str, Any]) -> dict[str, Any] | None:
        """Başarılı koşu: kayıt + gelen kutusu kalemi + `deliverable.ready`. Çıktı yoksa None."""
        try:
            items = self.record(info)
        except Exception:  # noqa: BLE001 - teslim kaydı koşuyu bozmaz
            log.exception("teslim kaydı yazılamadı: %s", info.get("id"))
            return None
        if not items:
            return None
        lang = info.get("lang") or self._lang()
        title = str(info.get("title") or info["id"])
        primary = items[0]
        summary = primary.get("summary") or ""
        lines = []
        if summary:
            lines += [f"**{_t('summary', lang)}**", "", summary, ""]
        lines.append(f"**{_t('outputs', lang)}**")
        for it in items:
            label = _t("result", lang) if it["source"] == "output" else _t("file", lang)
            lines.append(f"- {label}: {it['name'] if it['source'] == 'file' else it['title']}")
        lines += ["", _t("where", lang)]
        refs: list[dict[str, Any]] = []
        sink = next((i for i in items if i["source"] == "output"), None)
        if sink and sink.get("step_id"):
            refs.append({"type": "output", "run_id": info["id"], "step_id": sink["step_id"],
                         "ref": "{{steps." + str(sink["step_id"]) + ".output}}", "chars": sink.get("size") or 0})
        for it in items:
            refs.append({"type": "deliverable", "id": it["id"], "name": it["name"], "kind": it["kind"],
                         "source": it["source"]})
        msg = self._post(info, kind="deliverable", sender=primary.get("agent") or "system",
                         subject=_t("done_subject", lang, title)[:160], body="\n".join(lines),
                         summary=summary or title, refs=refs, suffix="deliverable")
        self._publish("deliverable.ready", run_id=info["id"], status="done", title=title,
                      subject=_t("done_subject", lang, title), message_id=(msg or {}).get("id"),
                      primary=primary["id"], kind=primary["kind"],
                      items=[{"id": i["id"], "title": i["title"], "kind": i["kind"], "source": i["source"]}
                             for i in items])
        return {"items": items, "message": msg}

    def attention(self, info: dict[str, Any]) -> dict[str, Any] | None:
        """Başarısız koşu: "Dikkat gerekiyor" kalemi (maskeli hata) + `deliverable.ready {status: failed}`."""
        lang = info.get("lang") or self._lang()
        title = str(info.get("title") or info["id"])
        err = redact(info.get("error") or "")[:1500] or _t("no_error", lang)
        body = "\n".join([_t("failed", lang), "", err, "", _t("fail_hint", lang)])
        msg = self._post(info, kind="system", sender="system", subject=_t("fail_subject", lang, title)[:160],
                         body=body, summary=err[:SUMMARY_MAX], refs=[], suffix="attention")
        self._publish("deliverable.ready", run_id=info["id"], status="failed", title=title,
                      subject=_t("fail_subject", lang, title), message_id=(msg or {}).get("id"), items=[])
        return msg

    def _post(self, info: dict[str, Any], *, kind: str, sender: str, subject: str, body: str, summary: str,
              refs: list[dict[str, Any]], suffix: str) -> dict[str, Any] | None:
        if self.messages is None:
            return None
        from studio.messaging.service import USER, message_id
        if sender != "system" and self.agents is not None and not self.agents.node(sender):
            sender = "system"
        try:
            return self.messages.send(msg_id=message_id(info["id"], suffix, USER), from_agent=sender, to_agent=USER,
                                      kind=kind, run_id=info["id"], subject=subject, body=body, summary=summary,
                                      artifacts=refs or None, enforce_policy=False, replace=True)
        except Exception:  # noqa: BLE001 - gelen kutusu yazılamasa da kayıt geçerli
            log.exception("teslim mesajı yazılamadı: %s", info.get("id"))
            return None

    def _lang(self) -> str:
        try:
            from studio.i18n import agent_lang
            return agent_lang(self.settings)
        except Exception:  # noqa: BLE001
            return "tr"

    def _publish(self, type_: str, **data: Any) -> None:
        if self.bus is not None:
            self.bus.publish(type_, **{k: v for k, v in data.items() if v is not None})

    ARTIFACT_EVENTS = ("artifact_opened", "artifact_exported")

    def artifact_event(self, type_: str, item: dict[str, Any], fmt: str | None = None) -> None:
        """G1-C (Rehber 2 olay sözleşmesi): teslim açıldı / dışa aktarıldı. Yük YALNIZ kimlik ve biçim taşır (içerik,
        başlık, yol yok). Yayın hatası isteği bozmaz."""
        if type_ not in self.ARTIFACT_EVENTS:
            raise ValueError(f"Geçersiz olay: {type_}")
        try:
            self._publish(type_, deliverable_id=item.get("id"), run_id=item.get("run_id"),
                          step_id=item.get("step_id"), source=item.get("source"), kind=item.get("kind"), format=fmt)
        except Exception:  # noqa: BLE001
            log.exception("%s yayınlanamadı", type_)

    # ------------------------------------------------------------------ geri doldurma
    def backfill(self, limit: int = BACKFILL_MAX) -> int:
        """Son `limit` bitmiş koşunun eksik kayıtları (okunmuş işaretli, gelen kutusuna yazılmaz). Eklenen koşu sayısı."""
        added = 0
        for node in self.store.nodes("Run", limit=max(1, int(limit)), order="created_at DESC",
                                     props={"status": "done"}):
            p = node["props"]
            if str(p.get("origin") or "").startswith(SKIP_ORIGINS):
                continue
            if self.store.count("Deliverable", props={"run_id": p.get("id")}):
                continue
            try:
                if self.record(info_from_node(self.store, node), backfill=True):
                    added += 1
            except Exception:  # noqa: BLE001 - tek bozuk koşu geri doldurmayı durdurmaz
                log.exception("geri doldurma başarısız: %s", p.get("id"))
        return added

    # ------------------------------------------------------------------ okuma
    @staticmethod
    def public(node: dict[str, Any], *, full: bool = False) -> dict[str, Any]:
        p = node["props"]
        out = {k: p.get(k) for k in ("id", "run_id", "step_id", "step_ids", "agent", "team", "title", "run_title", "source",
                                       "kind", "name", "path", "size", "summary", "project", "goal", "origin",
                                       "created_at")}
        out["created_at"] = out["created_at"] or node.get("created_at")
        out["pinned"] = bool(p.get("pinned"))
        out["read_at"] = p.get("read_at")
        out["unread"] = not p.get("read_at")
        out["backfilled"] = bool(p.get("backfilled"))
        out["quality"] = p.get("quality")  # CG-QUALITY rozet özeti (rapor: GET /api/quality/deliverables/{id})
        out["recipe"] = p.get("recipe") or None  # FOLLOWUP: tarif kimliği (tarif koşusundan geldiyse)
        # DELIV-P0: kasa/sürüm/biçim; `binary` = ikili orijinal (yalnızca arayüzden, maskelenmemiş indirilir)
        out["format"], out["mime"], out["sha256"] = p.get("format"), p.get("mime"), p.get("sha256")
        out["version"], out["vault_status"] = int(p.get("version") or 1), p.get("vault_status")
        out["entry"] = p.get("entry")
        out["files"] = len(p.get("manifest") or []) or None
        out["binary"] = p.get("source") == "file" and is_binary(str(p.get("name") or ""))
        if full:
            out["excerpt"] = p.get("excerpt")
        return out

    def get(self, did: str) -> dict[str, Any]:
        node = self.store.find("Deliverable", did)
        if not node:
            raise KeyError(f"Çıktı yok: {did}")
        return self.public(node)

    def list(self, *, q: str | None = None, agent: str | None = None, team: str | None = None,
             project: str | None = None, goal: str | None = None, kind: str | None = None,
             source: str | None = None, run: str | None = None, since: str | None = None, until: str | None = None,
             pinned: bool | None = None, unread: bool | None = None, limit: int = 100,
             offset: int = 0, recipe: str | None = None) -> dict[str, Any]:
        """Süzgeçli liste: sabitlenenler önce, sonra yeniden eskiye. Fasetler süzgeçsiz tüm kümeden."""
        props: dict[str, Any] = {}
        if run:
            props["run_id"] = run
        nodes = self.store.nodes("Deliverable", limit=LIST_SCAN, order="created_at DESC", props=props or None)
        facets: dict[str, dict[str, int]] = {"agent": {}, "team": {}, "project": {}, "goal": {}, "kind": {},
                                             "recipe": {}}
        run_recipes: dict[str, str | None] = {}
        unread_total = 0
        needle = " ".join(str(q or "").casefold().split())
        items: list[dict[str, Any]] = []
        for n in nodes:
            p = n["props"]
            if "recipe" not in p:  # FOLLOWUP: alan öncesi kayıtlar — tarif koşunun iş akışından (koşu başına bir okuma)
                p = n["props"] = {**p, "recipe": self._run_recipe(str(p.get("run_id") or ""), run_recipes) or ""}
            for key in facets:
                v = p.get(key)
                if v:
                    facets[key][str(v)] = facets[key].get(str(v), 0) + 1
            if not p.get("read_at"):
                unread_total += 1
            if agent and p.get("agent") != agent:
                continue
            if team and p.get("team") != team:
                continue
            if project and (p.get("project") or "global") != project:
                continue
            if goal and p.get("goal") != goal:
                continue
            if kind and p.get("kind") != kind:
                continue
            if source and p.get("source") != source:
                continue
            if recipe and (p.get("recipe") or "") != recipe and not (recipe == "*" and p.get("recipe")):
                continue
            created = str(p.get("created_at") or n.get("created_at") or "")
            if since and created[: len(since)] < since:
                continue
            if until and created[: len(until)] > until:
                continue
            if pinned and not p.get("pinned"):
                continue
            if unread and p.get("read_at"):
                continue
            if needle:
                hay = " ".join(str(p.get(k) or "") for k in ("title", "run_title", "name", "summary", "excerpt"))
                if needle not in " ".join(hay.casefold().split()):
                    continue
            items.append(self.public(n))
        # aynı koşunun kalemleri aynı anda oluşur: son çıktı (rapor metni) dosyalarından önce gelir
        items.sort(key=lambda d: (str(d.get("created_at") or ""), d.get("run_id") or "", d["source"] == "output",
                                  d["id"]), reverse=True)
        items.sort(key=lambda d: not d["pinned"])  # kararlı: sabitlenenler önce, kendi içinde yeniden eskiye
        limit = max(1, min(LIST_MAX, int(limit or 100)))
        offset = max(0, int(offset or 0))
        return {"items": items[offset:offset + limit], "total": len(items), "unread": unread_total,
                "facets": facets, "goals": self._goal_titles(list(facets["goal"])),
                "recipes": recipe_titles(list(facets["recipe"]))}

    def _run_recipe(self, run_id: str, cache: dict[str, str | None]) -> str | None:
        if not run_id:
            return None
        if run_id not in cache:
            node = self.store.find("Run", run_id)
            cache[run_id] = recipe_of_workflow((node or {}).get("props", {}).get("workflow"))
        return cache[run_id]

    def _goal_titles(self, ids: list[str]) -> dict[str, str]:
        out: dict[str, str] = {}
        for gid in ids[:100]:
            node = self.store.find("Goal", gid)
            if node:
                out[gid] = str(node["props"].get("title") or gid)
        return out

    def unread_count(self) -> int:
        return self.store.count("Deliverable", props={"read_at": None})

    def update(self, did: str, *, pinned: bool | None = None, read: bool | None = None) -> dict[str, Any]:
        node = self.store.find("Deliverable", did)
        if not node:
            raise KeyError(f"Çıktı yok: {did}")
        patch: dict[str, Any] = {}
        if pinned is not None:
            patch["pinned"] = bool(pinned)
        if read is not None:
            patch["read_at"] = (node["props"].get("read_at") or now_iso()) if read else None
        if patch:
            node = self.store.patch_node(node["id"], patch)
        item = self.public(node)
        self._publish("deliverable.updated", id=item["id"], run_id=item["run_id"], pinned=item["pinned"],
                      read_at=item["read_at"], unread=item["unread"])
        return item

    def mark_all_read(self) -> int:
        n = 0
        for node in self.store.nodes("Deliverable", limit=LIST_SCAN, props={"read_at": None}):
            self.store.patch_node(node["id"], {"read_at": now_iso()})
            n += 1
        if n:
            self._publish("deliverable.updated", all_read=True, count=n)
        return n

    # ------------------------------------------------------------------ içerik
    def content(self, did: str) -> dict[str, Any]:
        """Okunabilir içerik: {kind: markdown|text|code|image|binary|app|missing, text?, lang?, truncated, raw?, entry?}.
        ikili biçimler (docx/xlsx/pptx/zip/mp4…) asla UTF-8 metne çevrilmez → `binary` (`raw`: görsel/PDF)."""
        node = self.store.find("Deliverable", did)
        if not node:
            raise KeyError(f"Çıktı yok: {did}")
        p = node["props"]
        if p.get("vault_status") == "forgotten":  # unutma kasa kopyasını sildi; stüdyo içeriği artık sunmaz
            return {"kind": "missing", "text": None, "truncated": False, "missing": True, "forgotten": True}
        if p.get("source") == "output":
            text = self._output_text(p)
            return {"kind": "markdown" if p.get("kind") == "report" else "text", "text": redact(text),
                    "truncated": False}
        if p.get("source") == "bundle":
            ok = bool(p.get("entry")) and bool(p.get("manifest")) and self._bundle_entry_ok(p)
            return {"kind": "app" if ok else "missing", "text": None, "truncated": False, "entry": p.get("entry"),
                    "files": [{"path": m.get("path"), "size": m.get("size"), "role": m.get("role")}
                              for m in (p.get("manifest") or [])][:200]}
        path = self._file(p)
        vaulted = self._blob(p)
        if path is None and vaulted is None:
            return {"kind": "missing", "text": None, "truncated": False, "missing": True}
        suffix = _suffix(str(p.get("name") or (path.name if path else "")))
        kind = p.get("kind")
        if kind == "image":
            return {"kind": "image", "text": None, "truncated": False,
                    "raw": suffix in RAW_EXT}
        if is_binary(str(p.get("name") or "")) or kind not in TEXT_KINDS:
            return {"kind": "binary", "text": None, "truncated": False, "raw": suffix in RAW_EXT,
                    "view": view_kind(str(p.get("name") or "")) if self._blob(p) is not None else None,  # DEPO-TESLIM
                    "view_max": self.view_max_bytes()}
        src = vaulted or path
        size = src.stat().st_size  # type: ignore[union-attr]
        with src.open("rb") as fh:  # type: ignore[union-attr]
            text = fh.read(CONTENT_MAX).decode("utf-8", "replace")
        view = "markdown" if suffix in (".md", ".markdown") else "code" if kind in ("code", "data") else "text"
        return {"kind": view, "text": redact(text), "lang": code_lang(str(p.get("name") or "")),
                "truncated": size > CONTENT_MAX}

    def _bundle_entry_ok(self, p: dict[str, Any]) -> bool:
        """Paketin giriş dosyası kasada duruyor mu (unutma kasa kopyasını silmiş olabilir)."""
        if self.vault is None:
            return False
        for e in p.get("manifest") or []:
            if isinstance(e, dict) and e.get("path") == p.get("entry"):
                return is_sha(e.get("sha256")) and self.vault.has(str(e["sha256"]))
        return False

    def _output_text(self, p: dict[str, Any]) -> str:
        if len(p.get("step_ids") or []) > 1:  # PROC2-FIX çok adımlı teslim = koşunun birleşik çıktısı
            run = self.store.find("Run", str(p.get("run_id")))
            text = str((run or {}).get("props", {}).get("output") or "")
            if text:
                return text
        if p.get("step_id"):
            step = self.store.find("Step", f"{p.get('run_id')}:{p.get('step_id')}")
            if step and step["props"].get("output"):
                return str(step["props"]["output"])
        run = self.store.find("Run", str(p.get("run_id")))
        return str((run or {}).get("props", {}).get("output") or "")

    def _file(self, p: dict[str, Any]) -> Path | None:
        from studio import workspace
        rel = p.get("path")
        if not rel:
            return None
        try:
            return workspace.resolve_inside(self.workdir(), str(rel))
        except (PermissionError, FileNotFoundError, OSError):
            return None

    def export_text(self, did: str) -> tuple[str, str]:
        """(maskeli metin, önerilen ad kökü) — .md / .txt / .docx dışa aktarımın kaynağı."""
        node = self.store.find("Deliverable", did)
        if not node:
            raise KeyError(f"Çıktı yok: {did}")
        p = node["props"]
        data = self.content(did)
        if data.get("text") is None:
            raise ValueError("Bu çıktı metin olarak dışa aktarılamaz")
        stem = Path(str(p.get("name") or "cikti")).stem if p.get("source") == "file" else \
            slug_name(str(p.get("title") or ""), "sonuc")
        return str(data["text"]), stem

    def _blob(self, p: dict[str, Any]) -> Path | None:
        """Teslim anında kasaya alınmış kopya (varsa). Yol yalnızca kayıtlı sha256'dan türetilir."""
        sha = p.get("sha256")
        if self.vault is None or not p.get("blob") or not is_sha(sha) or p.get("blob") != self.vault.rel(str(sha)):
            return None
        path = self.vault.path_for(str(sha))
        return path if path.is_file() else None

    def raw_file(self, did: str) -> Path:
        """Ham dosya yalnızca görsel ve PDF için (maskelenemeyen ikili içerik; metin dosyaları maskeli verilir).
        Kasa kopyası varsa o verilir (sonradan değişen çalışma dosyası eski çıktıyı değiştirmez)."""
        node = self.store.find("Deliverable", did)
        if not node:
            raise KeyError(f"Çıktı yok: {did}")
        p = node["props"]
        path = None if p.get("vault_status") == "forgotten" else (self._blob(p) or self._file(p))
        if path is None:
            raise FileNotFoundError(did)
        if _suffix(str(p.get("name") or "")) not in RAW_EXT:
            raise PermissionError("Bu dosya türü ham olarak verilmez; metin dışa aktarımını kullan")
        return path

    def original_file(self, did: str) -> tuple[Path, str]:
        """D1: ikili orijinal (docx/xlsx/pptx/zip/mp4/görsel/PDF…) → (yol, indirme adı). Metin dosyaları maskeli verilir,
        burada PermissionError. Çağıran yalnızca arayüzden (`ui_present_strict`) ve `attachment` + `nosniff` ile verir."""
        node = self.store.find("Deliverable", did)
        if not node:
            raise KeyError(f"Çıktı yok: {did}")
        p = node["props"]
        if p.get("source") != "file":
            raise PermissionError("Bu çıktının indirilecek bir orijinal dosyası yok")
        name = Path(str(p.get("name") or "cikti")).name
        if not is_binary(name):
            raise PermissionError("Metin dosyaları maskeli indirilir; metin dışa aktarımını kullan")
        path = None if p.get("vault_status") == "forgotten" else (self._blob(p) or self._file(p))
        if path is None:
            raise FileNotFoundError(did)
        return path, name

    def reveal_target(self, did: str) -> tuple[Path, str, str]:
        """D3: "Klasörde göster" için yol SUNUCUDA graf kaydından çözülür → (yol, konum, ad). Konum: workdir | vault.
        Çalışma dosyası hâlâ varsa (ve kayıtlı sha256 ile aynıysa) o, yoksa salt okunur kasa kopyası."""
        node = self.store.find("Deliverable", did)
        if not node:
            raise KeyError(f"Çıktı yok: {did}")
        p = node["props"]
        if p.get("source") == "output":
            raise ValueError("Bu çıktı bir dosya değil (sonuç metni); klasörde gösterilemez")
        name = Path(str(p.get("name") or "cikti")).name
        live = self._file(p)
        blob = self._blob(p)
        if live is not None and p.get("source") == "file":
            sha = p.get("sha256")
            try:
                same = not (sha and blob) or sha256_file(live)[0] == sha  # kayıtla aynı baytlar mı
            except OSError:
                same = False
            if same:
                return live, "workdir", name
        if blob is not None:
            return blob, "vault", name
        if live is not None:
            return live, "workdir", name
        raise FileNotFoundError(did)

    def open_site_session(self, did: str, *, scripts: bool = False) -> dict[str, Any]:
        """D4: uygulama önizlemesi için tahmin edilemez, süreli oturum belirteci (yalnızca arayüzün kullanıcı-yalnız POST'u
        verir). Sandbox'lı iframe'in alt kaynakları (`Sec-Fetch-Site: cross-site`) çerez/jeton taşıyamaz; belirteç yolun
        içindedir (`/site/<belirteç>/<dosya>`), böylece yalnızca bu oturumu alan sayfa dosyaları okuyabilir.
        `scripts` varsayılan KAPALI (betiksiz önizleme). Betik çalıştıran uygulama `location = 'https://…'` ile
        paket içeriğini dışarı taşıyabilir (CSP gezinmeyi sınırlayamaz); bu yüzden betik yalnızca kullanıcının açık,
        oturum başına onayıyla (`scripts: true`) verilir, kalıcı değildir ve belirteçle birlikte düşer."""
        node = self.store.find("Deliverable", did)
        if not node:
            raise KeyError(f"Çıktı yok: {did}")
        p = node["props"]
        if p.get("source") != "bundle" or not p.get("entry") or self.vault is None:
            raise PermissionError("Bu çıktı bir uygulama paketi değil")
        if not self._bundle_entry_ok(p):  # kasa kopyası yok (ör. unutuldu): önizleme açılmaz
            raise FileNotFoundError(did)
        token = secrets.token_urlsafe(24)
        now = time.monotonic()
        with self._site_lock:
            self._site_tokens = {t: v for t, v in self._site_tokens.items() if v[1] > now}
            while len(self._site_tokens) >= SITE_TOKENS_MAX:
                self._site_tokens.pop(next(iter(self._site_tokens)))
            self._site_tokens[token] = (did, now + SITE_TOKEN_TTL_S, bool(scripts))
        return {"token": token, "entry": str(p["entry"]), "scripts": bool(scripts)}

    def site_token_ok(self, did: str, token: str) -> bool:
        with self._site_lock:
            hit = self._site_tokens.get(str(token))
        return bool(hit) and hit[0] == did and hit[1] > time.monotonic()

    def site_token_scripts(self, did: str, token: str) -> bool:
        """Belirtecin betik izni (geçersiz belirteç = False)."""
        with self._site_lock:
            hit = self._site_tokens.get(str(token))
        return bool(hit) and hit[0] == did and hit[1] > time.monotonic() and len(hit) > 2 and bool(hit[2])

    def site_file(self, did: str, rel: str) -> tuple[Path, str]:
        """D4: statik uygulama paketinden bir dosya → (kasa yolu, MIME). Yalnızca manifest'teki yollar sunulur
        (yol kaçışı imkânsız: istenen yol manifest sözlüğünde aranır, dosya sha256'dan türetilir)."""
        node = self.store.find("Deliverable", did)
        if not node:
            raise KeyError(f"Çıktı yok: {did}")
        p = node["props"]
        if p.get("source") != "bundle" or self.vault is None:
            raise PermissionError("Bu çıktı bir uygulama paketi değil")
        if p.get("vault_status") == "forgotten":  # unutulan paketin kalan dosyaları da sunulmaz
            raise FileNotFoundError(rel)
        rel = (rel or "").strip() or str(p.get("entry") or "")
        if not rel or "\\" in rel or "\x00" in rel or rel.startswith("/") or any(
                part in ("..", ".") or ":" in part for part in rel.split("/")):
            raise FileNotFoundError(rel)
        by_path = {str(m.get("path")): m for m in (p.get("manifest") or []) if isinstance(m, dict)}
        entry = by_path.get(rel)
        if entry is None or not is_sha(entry.get("sha256")):
            raise FileNotFoundError(rel)
        path = self.vault.path_for(str(entry["sha256"]))
        if not path.is_file():
            raise FileNotFoundError(rel)
        return path, mime_for(rel)

    def live_shas(self) -> set[str]:
        """Unutulmamış çıktıların (dosya sha256'sı + paket manifesti) kullandığı kasa özetleri."""
        live: set[str] = set()
        offset = 0
        while True:
            rows = self.store.nodes("Deliverable", limit=500, offset=offset, order="created_at ASC")
            if not rows:
                break
            for n in rows:
                p = n["props"]
                if p.get("vault_status") == "forgotten":
                    continue
                if is_sha(p.get("sha256")) and p.get("blob"):
                    live.add(str(p["sha256"]))
                live.update(str(m["sha256"]) for m in (p.get("manifest") or []) if isinstance(m, dict) and is_sha(m.get("sha256")))
            offset += len(rows)
        return live

    def vault_gc(self, *, min_age_s: float = 60.0) -> dict[str, int]:
        """Hiçbir `Deliverable` (sha256 / manifest) tarafından anılmayan kasa blob'larını siler. Unutma akışı (`graph/forget`)
        çıktı düğümlerini sildikten sonra bunu çağırır; `min_age_s`'den genç blob'lar (yazımı süren teslim) korunur."""
        if self.vault is None:
            return {"deleted": 0, "kept": 0}
        live: set[str] = set()
        offset = 0
        while True:
            rows = self.store.nodes("Deliverable", limit=500, offset=offset, order="created_at ASC")
            if not rows:
                break
            for n in rows:
                p = n["props"]
                if is_sha(p.get("sha256")) and p.get("blob"):
                    live.add(str(p["sha256"]))
                live.update(str(m["sha256"]) for m in (p.get("manifest") or []) if isinstance(m, dict) and is_sha(m.get("sha256")))
            offset += len(rows)
        now = time.time()
        deleted = sum(1 for sha, mtime in self.vault.iter_blobs()
                      if sha not in live and now - mtime >= min_age_s and self.vault.delete(sha))
        return {"deleted": deleted, "kept": len(live)}

    def versions(self, did: str) -> list[dict[str, Any]]:
        """Aynı `family`'deki sürümler (yeniden eskiye); her biri {id, version, created_at, size, sha256, current}."""
        node = self.store.find("Deliverable", did)
        if not node:
            raise KeyError(f"Çıktı yok: {did}")
        fam = node["props"].get("family")
        if not fam:
            return []
        rows = self.store.nodes("Deliverable", limit=50, order="created_at DESC", props={"family": fam})
        out = [{"id": n["props"].get("id"), "version": int(n["props"].get("version") or 1),
                "created_at": n["props"].get("created_at") or n.get("created_at"), "size": n["props"].get("size"),
                "sha256": n["props"].get("sha256"), "run_id": n["props"].get("run_id"),
                "current": n["props"].get("id") == did} for n in rows]
        out.sort(key=lambda r: (r["version"], str(r["created_at"] or "")), reverse=True)
        return out

    # ------------------------------------------------------------------ DEPO-TESLIM: satır içi görüntüleme
    def view_max_bytes(self) -> int:
        """sınır [1 MB, kasa dosya sınırı] aralığına kıstırılır; inf / nan / negatif / sayı olmayan değer ve 0 varsayılana
        döner (`inf` eskiden OverflowError, `1e-9` her dosyayı "çok büyük" yapıyordu)."""
        import math
        import os
        raw = os.environ.get("STUDIO_VIEW_MAX_MB") or (self.settings.get("deliverables.view.max_mb")
                                                       if self.settings is not None and hasattr(self.settings, "get") else None)
        try:
            mb = float(raw) if raw is not None and not isinstance(raw, bool) else float(VIEW_MAX_MB_DEFAULT)
        except (TypeError, ValueError):
            mb = float(VIEW_MAX_MB_DEFAULT)
        if not math.isfinite(mb) or mb <= 0:
            mb = float(VIEW_MAX_MB_DEFAULT)
        lo = float(VIEW_MAX_MB_MIN * 1024 * 1024)
        hi = max(lo, float(vault_limits(self.settings)[0]))  # kasada olmayan dosya zaten önizlenemez
        return int(min(max(mb * 1024 * 1024, lo), hi))

    def view_file(self, did: str) -> tuple[Path, str, str]:
        """PDF / ses / video için KASA kopyası → (yol, MIME, ad). Yalnızca `formats.VIEW_MIME` listesi; MIME tablodan gelir
        (istemciden / uzantı tahmininden değil). Çalışma klasörüne hiç bakılmaz; kasa baytlarının sha256'sı kayıtla
        karşılaştırılır. Çağıran yalnızca arayüzden (`ui_present_strict`) ve maskelenmemiş ikili olarak verir (D1 ilkesi)."""
        node = self.store.find("Deliverable", did)
        if not node:
            raise KeyError(f"Çıktı yok: {did}")
        p = node["props"]
        if p.get("source") != "file":
            raise PermissionError("Bu çıktının önizlenecek bir dosyası yok")
        name = Path(str(p.get("name") or "cikti")).name
        mime = view_mime(name)
        if mime is None:
            raise ViewError("Bu dosya türü tarayıcıda önizlenemez", 415)
        blob = None if p.get("vault_status") == "forgotten" else self._blob(p)
        if blob is None:  # `/view` çalışma klasörüne bakmaz; ileti "çalışma klasöründe yok" demesin
            raise ViewError("Kasa kopyası yok; önizleme verilemez", 404)
        size = blob.stat().st_size
        if size > self.view_max_bytes():
            raise ViewError("Dosya satır içi önizleme için çok büyük; indirerek aç", 413)
        sha = p.get("sha256")
        if is_sha(sha) and sha256_file(blob)[0] != sha:
            raise ViewError("Kasa kopyası kayıtla uyuşmuyor; önizleme verilmedi", 409)
        if view_kind(name) == "pdf":  # uzantısı .pdf olan başka içerik (HTML vb.) PDF görüntüleyiciye verilmez
            with blob.open("rb") as fh:  # sihirli bayt 0. konumda (BOM / boşluktan sonra); çokdilli dosya geçmez
                head = fh.read(1024)
            if head.startswith(b"\xef\xbb\xbf"):
                head = head[3:]
            if not head.lstrip(b" \t\r\n\x0c\x00").startswith(b"%PDF-"):
                raise ViewError("Dosya geçerli bir PDF değil; önizleme verilmedi", 415)
        return blob, mime, name

    # ------------------------------------------------------------------ DEPO-TESLIM: sürüm karşılaştırma
    def _side(self, node: dict[str, Any]) -> dict[str, Any]:
        p = node["props"]
        return {"id": p.get("id"), "version": int(p.get("version") or 1), "created_at": p.get("created_at") or node.get("created_at"),
                "size": p.get("size"), "sha256": p.get("sha256"), "name": p.get("name"), "title": p.get("title"),
                "kind": p.get("kind"), "run_id": p.get("run_id"), "vault_status": p.get("vault_status")}

    def compare(self, did: str, against: str) -> dict[str, Any]:
        """Aynı `family`'deki iki sürümün farkı. `left` = eski, `right` = yeni sürüm (sunucu sıralar).
        mode: text (maskeli satır farkı) | image (iki taraf `/raw` ile yan yana) | bundle (dosya listesi farkı) |
        binary (yalnız boyut / özet) | unavailable (bir taraf unutulmuş / kayıp ya da kasa kopyası yok: `reason: not_vaulted`)."""
        a = self.store.find("Deliverable", did)
        b = self.store.find("Deliverable", against)
        if not a:
            raise KeyError(f"Çıktı yok: {did}")
        if not b:
            raise KeyError(f"Çıktı yok: {against}")
        if did == against:
            raise ValueError("Bir sürüm kendisiyle karşılaştırılamaz")
        fam = a["props"].get("family")
        if not fam or fam != b["props"].get("family"):
            raise ValueError("Yalnızca aynı çıktının sürümleri karşılaştırılır")
        left, right = sorted((a, b), key=lambda n: (int(n["props"].get("version") or 1), str(n["props"].get("created_at") or "")))
        out: dict[str, Any] = {"left": self._side(left), "right": self._side(right), "mode": "binary", "identical": None}
        lc, rc = self.content(left["props"]["id"]), self.content(right["props"]["id"])
        if lc.get("kind") == "missing" or rc.get("kind") == "missing":
            out["mode"] = "unavailable"
            out["unavailable"] = [s for s, c in (("left", lc), ("right", rc)) if c.get("kind") == "missing"]
            out["forgotten"] = [s for s, c in (("left", lc), ("right", rc)) if c.get("forgotten")]
            return out
        ls, rs = left["props"].get("sha256"), right["props"].get("sha256")
        text_mode = lc["kind"] in ("markdown", "text", "code") and rc["kind"] in ("markdown", "text", "code")
        image_mode = lc["kind"] == "image" and rc["kind"] == "image" and lc.get("raw") and rc.get("raw")
        if text_mode or image_mode:
            # `content` / `/raw` kasa kopyası yoksa CANLI çalışma dosyasına düşer; iki sürüm de kasasızsa (too_large /
            # quota / kapalı) aynı güncel baytlar okunur ve "aynı" denir. Kasasız taraf için fark verilmez.
            unvaulted = [s for s, n in (("left", left), ("right", right))
                         if n["props"].get("source") == "file" and self._blob(n["props"]) is None]
            if unvaulted:
                out.update(mode="unavailable", unavailable=unvaulted, forgotten=[], reason="not_vaulted")
                return out
        if text_mode:
            diff = compare_mod.text_diff(str(lc.get("text") or ""), str(rc.get("text") or ""))  # maskeli metin
            out.update(mode="text", truncated=bool(lc.get("truncated") or rc.get("truncated")), lang=rc.get("lang") or lc.get("lang"),
                       **diff)
            return out
        if image_mode:
            out.update(mode="image", identical=bool(ls and ls == rs))
            return out
        if lc["kind"] == "app" and rc["kind"] == "app":
            md = compare_mod.manifest_diff(left["props"].get("manifest") or [], right["props"].get("manifest") or [])
            out.update(mode="bundle", files=md, identical=not (md["added"] or md["removed"] or md["changed"]))
            return out
        out["identical"] = bool(ls and ls == rs) if (ls and rs) else None
        return out

    def abs_path(self, did: str) -> str | None:
        node = self.store.find("Deliverable", did)
        if not node:
            raise KeyError(f"Çıktı yok: {did}")
        p = node["props"]
        return str((self.workdir() / str(p["path"])).resolve()) if p.get("path") else None
