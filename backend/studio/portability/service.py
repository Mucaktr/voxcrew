""""Hepsini dışa aktar" paketi ( "iptal geçmiş çıktıyı rehin bırakmaz").

Tek yerel zip (`voxcrew-export`, sürüm 1). Yalnız OKUR: hiçbir kayıt silinmez, değiştirilmez, ağa çıkılmaz.

İçerik (her biri ayrı klasör; sayılar ve sha256 `manifest.json`da):
- `agents/<slug>.json` ajanlar (yedekteki/gizli olanlar dahil; beyin yalnız bağlantı + model adı, sır yok)
- `workflows/<slug>.json` kullanıcının iş akışları (depodaki örnekler hariç; onlar zaten herkeste var)
- `tam sürüm` kullanılan tarifler (iş akışı ya da koşu geçmişinde adı geçenler)
- `deliverables/index.json` + `deliverables/files/*` çıktılar: metin çıktılar maskeli, görsel/PDF olduğu gibi
- `memory/nodes.jsonl`, `memory/edges.jsonl` graf belleği (Episode / Fact / Concept, tüm ad alanları)
- `runs/history.jsonl` koşu geçmişi özeti (istem / çıktı metni yok; süre, jeton, maliyet, adım sayısı)
- `worlds/<id>.json`, `game/ledger.json`, `metrics/ledger.json` dünyalar, oyun defteri, ölçüm defteri (varsa)
- `manifest.json` biçim, sürüm, bölümler, dosya başına bayt + sha256, atlananlar ve nedenleri

ASLA girmeyenler (`EXCLUDED`): ayar dosyası, `secrets.json`, `.env`, lisans, oturum/jeton, bağlantı uç noktaları,
MCP ortam değerleri, ham istem dökümleri. Metin alanları `ExportScrubber`dan geçer: bilinen sır değerleri (gizli
depo, sır adlı ortam değişkenleri, MCP'ye aktarılan değerler) tümüyle maskelenir, sonra `changes.redact_text`
(Bearer, `sk-…`, `api_key=` atamaları), ardından yerel mutlak yollar (`<DATA>`, `<WORKDIR>`, `~`, `<PATH>`).
Kişisel veri maskesi uygulanmaz: paket kullanıcının KENDİ verisidir (paylaşım paketinden farkı budur).

Boyut güvenliği: zip akış hâlinde üretilir (bellekte tümü tutulmaz; `zipfile` aranamaz akışta veri tanımlayıcısı
yazar). Dosya başına `MAX_FILE_BYTES`, toplam sıkıştırılmamış `MAX_TOTAL_BYTES`; aşan öğe atlanır ve manifestte
nedeniyle listelenir (sessizce düşmez). Zip içi adlar `safe_part` ile tek bileşene indirgenir (yol kaçışı yok).
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable, Iterator

from studio._edition import EDITION

from studio.share import bundle as B

if TYPE_CHECKING:
    from studio.api import Studio

log = logging.getLogger("studio.portability")

FORMAT = "voxcrew-export"
VERSION = 1
MAX_FILE_BYTES = 25 * 1024 * 1024          # tek çıktı dosyası
MAX_TOTAL_BYTES = 1024 * 1024 * 1024       # tüm paket (sıkıştırılmamış)
PAGE = 500                                 # graf sayfa boyu (bellek sınırlı okuma)
CHUNK = 256 * 1024
MEMORY_TYPES = ("Episode", "Fact", "Concept")
REASONS = ("cancel", "downgrade", "manual")
EXCLUDED = ("settings.json", "secrets.json", ".env", "license", "session_tokens", "connection_endpoints",
            "mcp_env_values", "raw_prompts")
SECTIONS = ("agents", "workflows", "recipes", "deliverables", "memory", "runs", "worlds", "game", "metrics")
# bu sürümde pakete girmeyen (ama sır olmayan) bölümler — sessiz eksik yerine manifestte açıkça listelenir
NOT_INCLUDED = ("goals", "schedules", "skills", "preferences", "mcp_server_configs")
_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_part(value: Any, fallback: str = "item", limit: int = 80) -> str:
    """Zip içi tek yol bileşeni: yalnız [A-Za-z0-9._-]; baştaki noktalar atılır (`..`, gizli dosya, mutlak yol yok)."""
    s = _SAFE.sub("-", str(value or "")).strip("-.")[:limit].strip("-.")
    return s or fallback


class ExportScrubber(B.Scrubber):
    """Paylaşım temizleyicisinin kişisel-veri maskesi olmayan hâli + bilinen sır değerleri + veri dizini kökü."""

    def __init__(self, *, workdir: str = "", data_dir: str = "", secrets: Iterable[str] = ()):
        super().__init__(workdir=workdir)
        self.data_dir = data_dir
        self.secrets = sorted({s for s in secrets if isinstance(s, str) and len(s.strip()) >= 6}, key=len, reverse=True)

    def text(self, value: Any, where: str = "") -> str:
        from studio.changes import redact_text  # noqa: PLC0415 - döngüsel içe aktarmadan kaçın
        raw = "" if value is None else str(value)
        out = raw
        for s in self.secrets:
            if s in out:
                out = out.replace(s, "••••")
        out = redact_text(out)
        out = self._replace_root(out, self.data_dir, "<DATA>")
        out = self._replace_root(out, self.workdir, "<WORKDIR>")
        out = self._replace_root(out, self.home, "~")
        out = B._FILE_URL.sub("<PATH>", out)  # noqa: SLF001 - file:///C:/… da yerel yoldur
        out = B._ABS_PATH.sub("<PATH>", out)  # noqa: SLF001 - paylaşım paketiyle aynı mutlak yol deseni
        out = _PREFIXED_DRIVE.sub("<PATH>", out)  # `workflow:C:\…` (önekli sürücü yolu) da yerel yoldur
        if out != raw and where:
            self.hits.append(where)
        return out


# `ad:C:\…` biçimi (görev ailesi, köken) — `_ABS_PATH` iki nokta sonrası sürücü yolunu yakalamaz
_PREFIXED_DRIVE = re.compile(r"(?<=[A-Za-z0-9_-]:)[A-Za-z]:[\\/][^\s\"'<>|`)\]]*")
# dışa aktarmada yalnız gerçek kimlik/enum alanları maskelenmez; `role` ve `rules` serbest metindir
EXPORT_STRUCT_KEYS = B.WORKFLOW_STRUCT_KEYS - {"role", "rules"}


class _Pipe:
    """Aranamaz yazma hedefi: zipfile buraya yazar, üreteç biriken baytları parça parça verir."""

    def __init__(self) -> None:
        self.buf = bytearray()

    def write(self, b: bytes) -> int:
        self.buf += b
        return len(b)

    def flush(self) -> None:
        pass

    def drain(self) -> bytes:
        out = bytes(self.buf)
        self.buf.clear()
        return out


class PortabilityService:
    def __init__(self, studio: "Studio"):
        self.studio = studio

    # ------------------------------------------------------------ ortam
    @property
    def data_dir(self) -> Path:
        base = getattr(getattr(self.studio, "changes", None), "data_dir", None)
        if base is None:
            from studio.config import DATA_DIR  # noqa: PLC0415
            base = DATA_DIR
        return Path(base)

    def _known_secrets(self) -> list[str]:
        """Metinde görülürse tümüyle maskelenecek değerler: gizli depo + sır adlı ortam değişkenleri."""
        from studio.changes import SECRET_KEY_RE  # noqa: PLC0415
        out: list[str] = []
        try:
            from studio.connections.secrets import SecretStore  # noqa: PLC0415
            out += [v for v in SecretStore(self.data_dir)._read().values() if v]  # noqa: SLF001 - salt okuma
        except Exception:  # noqa: BLE001 - depo okunamazsa yalnız desen maskesi kalır
            pass
        out += [v for k, v in os.environ.items() if SECRET_KEY_RE.search(k) and v and len(v) >= 8]
        try:  # MCP sunucularına aktarılan ortam değişkenlerinin GÜNCEL değerleri (adı sır gibi görünmese de)
            from studio.tools.mcp_client import _environ_lookup  # noqa: PLC0415
            tools = self.studio.settings.get("tools", None) or {}
            for srv in (tools.get("mcp_servers") or []) if isinstance(tools, dict) else []:
                for name in (srv.get("env_refs") or []) if isinstance(srv, dict) else []:
                    v = _environ_lookup(str(name)) if isinstance(name, str) else None
                    if v:
                        out.append(v)
        except Exception:  # noqa: BLE001 - ayar okunamazsa desen maskesi kalır
            pass
        return out

    def scrubber(self) -> ExportScrubber:
        try:
            work = str(self.studio.settings.workdir.resolve())
        except Exception:  # noqa: BLE001
            work = ""
        try:
            data = str(self.data_dir.resolve())
        except OSError:
            data = ""
        return ExportScrubber(workdir=work, data_dir=data, secrets=self._known_secrets())

    def _deliverables(self) -> Any:
        from studio.deliverables.service import DeliverableService  # noqa: PLC0415
        return DeliverableService(store=self.studio.store, settings=self.studio.settings, agents=self.studio.agents)

    # ------------------------------------------------------------ kaynaklar (salt okuma)
    def _agent_slugs(self) -> list[str]:
        return [a["slug"] for a in self.studio.agents.list(include_hidden=True) if not a.get("demo")]

    def _workflow_slugs(self) -> list[str]:
        return [w["slug"] for w in self.studio.library.list() if not w.get("error") and not w.get("example")]

    def _iter_nodes(self, type_name: str, order: str = "created_at ASC") -> Iterator[dict[str, Any]]:
        offset = 0
        while True:
            page = self.studio.store.nodes(type_name, limit=PAGE, order=order, offset=offset)
            yield from page
            if len(page) < PAGE:
                return
            offset += PAGE

    def _iter_memory_edges(self) -> Iterator[dict[str, Any]]:
        from studio.graph.store import _edge  # noqa: PLC0415 - graf paketi içi satır dönüştürücü
        marks = ",".join("?" * len(MEMORY_TYPES))
        sql = (f"SELECT e.*, s.type AS s_type, s.key AS s_key, d.type AS d_type, d.key AS d_key FROM edges e "
               f"JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst "
               f"WHERE s.type IN ({marks}) OR d.type IN ({marks}) ORDER BY e.rowid LIMIT ? OFFSET ?")
        offset = 0
        while True:
            with self.studio.store._read() as conn:  # noqa: SLF001 - bellek gezgini (`GraphMemory.dump`) ile aynı yol
                rows = conn.execute(sql, (*MEMORY_TYPES, *MEMORY_TYPES, PAGE, offset)).fetchall()
            for r in rows:
                yield {**_edge(r), "src_ref": {"type": r["s_type"], "key": r["s_key"]},
                       "dst_ref": {"type": r["d_type"], "key": r["d_key"]}}
            if len(rows) < PAGE:
                return
            offset += PAGE

    def _recipes_in_use(self) -> list[str]:
        if EDITION != "full":
            return []
        from studio.full.recipes import recipe_id_of  # noqa: PLC0415
        ids = {recipe_id_of(s) for s in self._workflow_slugs()}
        for n in self._iter_nodes("Run"):
            ids.add(recipe_id_of(n["props"].get("workflow")))
        return sorted(i for i in ids if i)

    # ------------------------------------------------------------ manifest önizlemesi
    def manifest(self) -> dict[str, Any]:
        """Paket indirilmeden ÖNCE ne gireceği: bölüm başına sayılar, hariç tutulanlar, sınırlar (içerik yok)."""
        store = self.studio.store
        counts = {
            "agents": len(self._agent_slugs()),
            "workflows": len(self._workflow_slugs()),
            "recipes": len(self._recipes_in_use()),
            "deliverables": store.count("Deliverable"),
            "memory": sum(store.count(t) for t in MEMORY_TYPES),
            "runs": store.count("Run"),
            "worlds": self._world_count(),
        }
        return {"format": FORMAT, "version": VERSION, "sections": list(SECTIONS), "counts": counts,
                "excluded": list(EXCLUDED), "not_included": list(NOT_INCLUDED),
                "redaction": {"secrets": True, "local_paths": True, "pii": False},
                "limits": {"file_bytes": MAX_FILE_BYTES, "total_bytes": MAX_TOTAL_BYTES},
                "deletes_nothing": True}

    def _world_count(self) -> int:
        try:
            from studio.worlds.service import get_store  # noqa: PLC0415
            return get_store(self.studio).count()
        except Exception:  # noqa: BLE001
            return 0

    # ------------------------------------------------------------ zip üretimi
    def filename(self) -> str:
        return f"voxcrew-hepsi-{datetime.now().strftime('%Y%m%d-%H%M')}.zip"

    def stream(self, reason: str = "manual") -> Iterator[bytes]:
        """Zip baytları (parça parça). Senkron üreteç: StreamingResponse onu iş parçacığında yürütür."""
        reason = reason if reason in REASONS else "manual"
        pipe = _Pipe()
        sc = self.scrubber()
        files: list[dict[str, Any]] = []
        skipped: list[dict[str, Any]] = []
        sections: dict[str, int] = {s: 0 for s in SECTIONS}
        total = [0]
        with zipfile.ZipFile(pipe, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zf:

            def put(arc: str, chunks: Iterable[bytes], section: str | None, size_hint: int | None = None
                    ) -> Iterator[bytes]:
                """Bir zip öğesi. Boyutu önceden bilinen öğe toplam sınırı aşacaksa hiç açılmaz (atlanır); akan öğe
                (JSONL) sınırda kesilir ve manifestte `truncated` olarak işaretlenir. Sessiz düşme yok."""
                if size_hint is not None and total[0] + size_hint > MAX_TOTAL_BYTES:
                    skipped.append({"path": arc, "reason": "total_limit", "bytes": size_hint})
                    return
                h = hashlib.sha256()
                size, truncated = 0, False
                with zf.open(arc, "w", force_zip64=True) as w:
                    for chunk in chunks:
                        if not chunk:
                            continue
                        if total[0] + len(chunk) > MAX_TOTAL_BYTES:
                            truncated = True
                            break
                        w.write(chunk)
                        h.update(chunk)
                        size += len(chunk)
                        total[0] += len(chunk)
                        if len(pipe.buf) >= CHUNK:
                            yield pipe.drain()
                files.append({"path": arc, "bytes": size, "sha256": h.hexdigest(), "section": section,
                              **({"truncated": True} if truncated else {})})
                if truncated:
                    skipped.append({"path": arc, "reason": "total_limit_truncated"})
                if section:
                    sections[section] += 1
                yield pipe.drain()

            def js(obj: Any) -> list[bytes]:
                return [json.dumps(obj, ensure_ascii=False, indent=1).encode("utf-8")]

            yield from put("README.txt", [_README.encode("utf-8")], None)
            # ajanlar
            from studio.share.service import ShareService  # noqa: PLC0415
            share = ShareService(self.studio)
            for slug in self._agent_slugs():
                try:
                    item, _info = share._export_agent(slug, sc)  # noqa: SLF001 - aynı beyaz liste alanları (sır yok)
                    node = self.studio.agents.node(slug) or {"props": {}}
                    item["benched"] = bool(node["props"].get("benched"))  # yedek kadro: yine dahil
                    item["hidden"] = bool(node["props"].get("hidden"))
                    item["team"] = sc.text(node["props"].get("team") or "") or None
                    for f in ("name", "title", "role", "persona"):  # tam metin (paylaşım sınırı yok)
                        if node["props"].get(f):
                            item[f] = sc.text(node["props"][f], f"agent:{slug}.{f}")
                except Exception as exc:  # noqa: BLE001
                    skipped.append({"path": f"agents/{safe_part(slug)}.json", "reason": f"error: {type(exc).__name__}"})
                    continue
                yield from put(f"agents/{safe_part(slug)}.json", js(item), "agents")
            # iş akışları (kabul komutları dahil: bu paket kullanıcının kendi yedeğidir; metin yine maskeli)
            for slug in self._workflow_slugs():
                try:
                    wf = sc.tree(self.studio.library.get(slug).to_dict(), f"workflow:{slug}", EXPORT_STRUCT_KEYS)
                except Exception as exc:  # noqa: BLE001
                    skipped.append({"path": f"workflows/{safe_part(slug)}.json", "reason": f"error: {type(exc).__name__}"})
                    continue
                yield from put(f"workflows/{safe_part(slug)}.json", js(wf), "workflows")
            # tarifler
            by_id: dict[str, Any] = {}
            if EDITION == "full":
                from studio.full.recipes import RECIPES  # noqa: PLC0415
                by_id = {r["id"]: r for r in RECIPES}
            for rid in self._recipes_in_use():
                r = by_id.get(rid)
                if r is None:
                    skipped.append({"path": f"recipes/{safe_part(rid)}.json", "reason": "not_in_catalog"})
                    continue
                yield from put(f"recipes/{safe_part(rid)}.json", js(sc.tree(r, f"recipe:{rid}")), "recipes")
            # çıktılar
            yield from self._deliverable_entries(put, js, sc, skipped)
            # bellek
            yield from put("memory/nodes.jsonl", self._jsonl(
                (self._memory_node(n, sc) for t in MEMORY_TYPES for n in self._iter_nodes(t)), sections, "memory"),
                None)
            yield from put("memory/edges.jsonl", self._jsonl(
                (sc.tree(e, "memory.edge") for e in self._iter_memory_edges()), None, None), None)
            # koşu geçmişi özeti
            yield from put("runs/history.jsonl", self._jsonl(
                (self._run_summary(n, sc) for n in self._iter_nodes("Run")),  # gizliler `hidden: true`
                sections, "runs"), None)
            # dünyalar, oyun, ölçüm (varsa; okunamazsa nedeniyle atlanır)
            yield from self._optional_entries(put, js, sc, skipped)
            manifest = {"format": FORMAT, "version": VERSION, "app_version": _app_version(), "exported_at": _now(),
                        "reason": reason, "deletes_nothing": True, "sections": sections, "files": files,
                        "skipped": skipped, "excluded": list(EXCLUDED), "not_included": list(NOT_INCLUDED),
                        "redaction": {"secrets": True, "local_paths": True, "pii": False,
                                      "masked_fields": len(set(sc.hits))},
                        "limits": {"file_bytes": MAX_FILE_BYTES, "total_bytes": MAX_TOTAL_BYTES}}
            body = json.dumps(manifest, ensure_ascii=False, indent=1).encode("utf-8")
            zf.writestr("manifest.json", body)  # sınır dışı: manifest her zaman yazılır
        yield pipe.drain()

    # ------------------------------------------------------------ bölüm yardımcıları
    @staticmethod
    def _jsonl(rows: Iterable[dict[str, Any]], sections: dict[str, int] | None, key: str | None) -> Iterator[bytes]:
        buf: list[bytes] = []
        size = 0
        for row in rows:
            line = (json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8")
            if sections is not None and key:
                sections[key] += 1
            buf.append(line)
            size += len(line)
            if size >= CHUNK:
                yield b"".join(buf)
                buf, size = [], 0
        if buf:
            yield b"".join(buf)

    @staticmethod
    def _memory_node(n: dict[str, Any], sc: ExportScrubber) -> dict[str, Any]:
        return {"id": n["id"], "type": n["type"], "key": sc.text(n["key"]), "label": sc.text(n["label"]),
                "namespace": sc.text(n["props"].get("namespace") or "global"),
                "props": sc.tree(n["props"], f"memory:{n['type']}"),
                "created_at": n["created_at"], "updated_at": n["updated_at"]}

    @staticmethod
    def _run_summary(n: dict[str, Any], sc: ExportScrubber) -> dict[str, Any]:
        p = n["props"]
        steps = p.get("steps") if isinstance(p.get("steps"), list) else []
        usage = p.get("usage") if isinstance(p.get("usage"), dict) else {}
        from studio.workflow.system_calls import is_system_origin  # noqa: PLC0415
        row = {"id": p.get("id"), "title": p.get("title") or "", "kind": p.get("kind"),
               "workflow": p.get("workflow"), "origin": p.get("origin") or None,
               "project": p.get("project") or "global", "goal": p.get("goal"), "status": p.get("status"),
               "started_at": p.get("started_at"), "finished_at": p.get("finished_at"),
               "duration_ms": p.get("duration_ms"), "tokens": p.get("tokens"),
               "usage": {k: usage.get(k) for k in ("tokens", "cost_usd", "minutes", "steps", "cost_basis")},
               "steps": len(steps),
               "agents": sorted({str(s.get("agent")) for s in steps if isinstance(s, dict) and s.get("agent")}),
               "hidden": bool(p.get("hidden") or is_system_origin(p.get("origin"))),
               "created_at": n.get("created_at")}
        return sc.tree(row, f"run:{p.get('id')}")  # tüm satır (workflow/project/goal dahil) maskeli

    def _deliverable_entries(self, put: Any, js: Any, sc: ExportScrubber,
                             skipped: list[dict[str, Any]]) -> Iterator[bytes]:
        from studio.deliverables.service import RAW_EXT, DeliverableService  # noqa: PLC0415
        svc = self._deliverables()
        index: list[dict[str, Any]] = []
        for node in self._iter_nodes("Deliverable"):
            item = DeliverableService.public(node)
            did = str(item.get("id") or "")
            name = Path(str(item.get("name") or "")).name
            suffix = Path(name).suffix.lower()
            stem = safe_part(f"{did}-{Path(name).stem or item.get('title') or 'cikti'}", "cikti", 100)
            row = sc.tree(dict(item), f"deliverable:{did}")  # iç içe alanlar (quality.note) da maskeli
            row["file"] = None
            try:
                if item.get("source") == "file" and suffix == ".svg":  # SVG metindir → maskelenir
                    path = svc.raw_file(did)
                    data = sc.text(path.read_bytes().decode("utf-8", "replace"), f"deliverable:{did}").encode("utf-8")
                    if len(data) > MAX_FILE_BYTES:
                        skipped.append({"path": f"deliverables/files/{stem}.svg", "reason": "file_limit",
                                        "bytes": len(data)})
                        index.append(row)
                        continue
                    arc = f"deliverables/files/{stem}.svg"
                    row["file"], row["redacted"] = arc, True
                    yield from put(arc, [data], "deliverables", len(data))
                elif item.get("source") == "file" and suffix in RAW_EXT:
                    path = svc.raw_file(did)
                    size = path.stat().st_size
                    if size > MAX_FILE_BYTES:
                        skipped.append({"path": f"deliverables/files/{stem}{suffix}", "reason": "file_limit",
                                        "bytes": size})
                        index.append(row)
                        continue
                    arc = f"deliverables/files/{stem}.{safe_part(suffix.lstrip('.'), 'bin', 8)}"
                    row["file"], row["redacted"] = arc, False  # görsel/PDF: indirme ucuyla aynı (ham)
                    yield from put(arc, _read_file(path), "deliverables", size)
                else:
                    text, _stem = svc.export_text(did)
                    data = sc.text(text, f"deliverable:{did}").encode("utf-8")
                    if len(data) > MAX_FILE_BYTES:
                        skipped.append({"path": f"deliverables/files/{stem}", "reason": "file_limit",
                                        "bytes": len(data)})
                        index.append(row)
                        continue
                    ext = ".md" if item.get("source") == "output" or suffix in ("", ".md", ".markdown") else \
                        ("." + safe_part(suffix.lstrip("."), "txt", 8))
                    arc = f"deliverables/files/{stem}{ext}"
                    row["file"], row["redacted"] = arc, True
                    yield from put(arc, [data], "deliverables", len(data))
            except (FileNotFoundError, PermissionError, ValueError, KeyError, OSError) as exc:
                skipped.append({"path": f"deliverables/{safe_part(did)}", "reason": f"unavailable: {type(exc).__name__}"})
            index.append(row)
        yield from put("deliverables/index.json", js(index), None)

    def _optional_entries(self, put: Any, js: Any, sc: ExportScrubber,
                          skipped: list[dict[str, Any]]) -> Iterator[bytes]:
        try:
            from studio.worlds.service import get_store  # noqa: PLC0415
            store = get_store(self.studio)
            worlds = store.list()
        except Exception as exc:  # noqa: BLE001
            worlds = []
            skipped.append({"path": "worlds/", "reason": f"unavailable: {type(exc).__name__}"})
        for w in worlds:
            wid = str(w.get("id") or "")
            try:
                doc = store.export(wid)
            except Exception as exc:  # noqa: BLE001
                skipped.append({"path": f"worlds/{safe_part(wid)}.json", "reason": f"error: {type(exc).__name__}"})
                continue
            yield from put(f"worlds/{safe_part(wid)}.json", js(sc.tree(doc, f"world:{wid}")), "worlds")
        try:
            from studio.game.api import get_service as game_service  # noqa: PLC0415
            game = game_service(self.studio).export()
        except Exception as exc:  # noqa: BLE001
            game = None
            skipped.append({"path": "game/ledger.json", "reason": f"unavailable: {type(exc).__name__}"})
        if game is not None:
            yield from put("game/ledger.json", js(sc.tree(game, "game")), "game")
        try:
            from studio.metrics.service import service_for as metrics_service  # noqa: PLC0415
            msvc = metrics_service(self.studio)
            msvc.sync()
            metrics = msvc.ledger.export()
        except Exception as exc:  # noqa: BLE001
            metrics = None
            skipped.append({"path": "metrics/ledger.json", "reason": f"unavailable: {type(exc).__name__}"})
        if metrics is not None:
            yield from put("metrics/ledger.json", js(sc.tree(metrics, "metrics")), "metrics")


def _read_file(path: Path) -> Iterator[bytes]:
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(CHUNK)
            if not chunk:
                return
            yield chunk


def _app_version() -> str:
    try:
        from studio import __version__  # noqa: PLC0415
        return str(__version__)
    except Exception:  # noqa: BLE001
        return "?"


def build_zip(studio: "Studio", reason: str = "manual") -> bytes:
    """Testler ve betikler için: tüm zip bellekte (arayüz ucu akış kullanır)."""
    out = io.BytesIO()
    for chunk in service_for(studio).stream(reason):
        out.write(chunk)
    return out.getvalue()


def service_for(studio: "Studio") -> PortabilityService:
    svc = getattr(studio, "_portability", None)
    if svc is None:
        svc = PortabilityService(studio)
        studio._portability = svc  # type: ignore[attr-defined]
    return svc


_README = """VoxCrew — tüm verilerinin dışa aktarımı / full export of your data

TR: Bu paket uygulamandaki ajanları, iş akışlarını, kullanılan tarifleri, çıktıları, graf belleğini, koşu geçmişi
özetini, dünyaları, oyun ve ölçüm defterlerini içerir. Uygulamada hiçbir şey silinmedi. Sırlar (API anahtarları,
erişim anahtarları, ortam değerleri, lisans) ve yerel mutlak yollar pakete girmez ya da maskelenir. Dosya listesi, boyutlar,
sha256 özetleri ve atlanan öğeler manifest.json içindedir.

EN: This bundle holds your agents, workflows, recipes in use, outputs, graph memory, a run-history summary, worlds,
and the game and metrics ledgers. Nothing was deleted from the studio. Secrets (API keys, tokens, env values,
license) and local absolute paths are left out or masked. manifest.json lists every file with its size and sha256,
and anything that was skipped and why.
"""
