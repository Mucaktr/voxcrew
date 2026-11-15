"""Teslim kayıtları ve teslim ayarları.

D7 (DELIV-P0): teslim kayıtları artık grafta `Delivery` düğümleridir (`DELIVERY_OF → Deliverable`; yazım `GraphStore`
üzerinden, ontoloji doğrulamalı). Eski `deliveries.json` ilk açılışta BİR KEZ içe aktarılır (kayıt kimliğine göre
idempotent) ve yedek olarak bırakılır (silinmez; yalnız `mailto:` bağlantıları şemaya indirilir, QA34b-03); içe aktarma `deliveries.migrated.json`
işaretiyle kaydedilir. Graf verilmezse (eski çağrılar) JSON modu çalışır.

Kayıt içeriği taşımaz: hedef, önizleme özeti (sha256), onay ve teslim zamanı, sonuç, bağlantı ve (varsa) kalite kapısını
aşma gerekçesi. Ayar (`delivery_settings.json`): `redact_pii` (kişisel veri maskeleme) ve son kullanılan klasör/depo.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from studio.graph.store import now_iso

log = logging.getLogger("studio.delivery")

RECORDS_FILE = "deliveries.json"
MIGRATED_FILE = "deliveries.migrated.json"
SETTINGS_FILE = "delivery_settings.json"
MAX_RECORDS = 2000
LIST_SCAN = 5000
DEFAULT_SETTINGS: dict[str, Any] = {"redact_pii": False, "last_folder": None, "last_repo": None}
# API'ye dönen kayıtta her zaman bulunan anahtarlar (eski JSON biçimiyle aynı şekil)
RECORD_KEYS = ("deliverable_id", "run_id", "target", "preview_hash", "approved_at", "external", "options", "recipients",
               "quality", "override_reason", "delivered_at", "ok")
INTERNAL_KEYS = ("status", "seq", "created_at")


def _atomic_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:6]}.tmp")
    try:
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return default


def _epoch_us(stamp: Any) -> int | None:
    try:
        return int(datetime.fromisoformat(str(stamp)).timestamp() * 1_000_000)
    except (TypeError, ValueError):
        return None


def safe_link(link: Any) -> Any:
    """kayıtta saklanan bağlantı. `mailto:` bağlantısı alıcı adresleri ve URL-kodlu çıktı metni taşır: kayda YALNIZ
    şema yazılır (içerik / alıcı kaydı yok; alıcı SAYISI `recipients` alanında). Diğer bağlantılar aynen."""
    if isinstance(link, str) and link[:7].lower() == "mailto:":
        return "mailto:"
    return link


def scrub_legacy_file(data_dir: Path) -> int:
    """QA34b-03: göç sonrası yedek olarak kalan `deliveries.json` kayıtlarındaki `mailto:` bağlantıları (alıcı + URL-kodlu
    gövde) yalnız şemaya indirilir; kalan her alan aynen kalır (içerik de, sıra da). İdempotent; dosya yoksa ya da okunamazsa
    dokunmaz. Düzeltilen kayıt sayısını döner. Açılışta ve unutma uygulamasında çağrılır (unutma, stüdyonun teslim servisi
    açılmamış olsa da yedeğe ulaşır)."""
    path = Path(data_dir) / RECORDS_FILE
    data = _read(path, None)
    items = data.get("records") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return 0
    n = 0
    for rec in items:
        if isinstance(rec, dict) and safe_link(rec.get("link")) != rec.get("link"):
            rec["link"] = safe_link(rec["link"])
            n += 1
    if n:
        _atomic_json(path, data)
    return n


class DeliveryStore:
    def __init__(self, data_dir: Path, graph: Any = None):
        self.dir = Path(data_dir)
        self._lock = threading.Lock()
        self.graph = graph
        self._allowed: set[str] = set()
        if graph is not None:
            self._allowed = set(graph.ontology.entity("Delivery").properties) - {"id"}
            try:
                self.migrate_json()
            except Exception:  # noqa: BLE001 - göç hatası açılışı bozmaz; JSON yedeği yerinde kalır
                log.exception("deliveries.json grafa taşınamadı")
            try:
                self.scrub_mailto_links()
            except Exception:  # noqa: BLE001
                log.exception("eski mailto bağlantıları temizlenemedi")
            try:
                scrub_legacy_file(self.dir)  # QA34b-03: yedek `deliveries.json` da alıcı/gövde taşımaz
            except Exception:  # noqa: BLE001
                log.exception("deliveries.json yedeğindeki mailto bağlantıları temizlenemedi")

    # ------------------------------------------------------------ JSON (eski biçim / yedek)
    def _legacy(self) -> list[dict[str, Any]]:
        data = _read(self.dir / RECORDS_FILE, {})
        items = data.get("records") if isinstance(data, dict) else None
        return [r for r in items or [] if isinstance(r, dict)]

    def _records(self) -> list[dict[str, Any]]:  # geri uyum (testler/araçlar JSON modunda)
        return self._legacy()

    # ------------------------------------------------------------ graf
    def migrate_json(self) -> int:
        """`deliveries.json` → `Delivery` düğümleri. İdempotent (kayıt kimliği anahtar); JSON yedek olarak kalır.
        Dönüş: bu çağrıda yazılan kayıt sayısı (işaret varsa 0)."""
        if self.graph is None or not (self.dir / RECORDS_FILE).exists() or (self.dir / MIGRATED_FILE).exists():
            return 0
        records = [r for r in self._legacy() if r.get("id")]
        with self.graph.bulk():
            for i, rec in enumerate(records):
                self._to_graph(rec, seq=(_epoch_us(rec.get("delivered_at")) or 0) + i)
        _atomic_json(self.dir / MIGRATED_FILE, {"count": len(records), "at": now_iso(), "source": RECORDS_FILE})
        return len(records)

    def scrub_mailto_links(self) -> int:
        """eski kayıtlardaki `mailto:` bağlantıları (alıcı + URL-kodlu gövde) yalnız şemaya indirilir. İdempotent."""
        if self.graph is None:
            return 0
        n = 0
        for node in self.graph.nodes("Delivery", limit=LIST_SCAN):
            link = node["props"].get("link")
            if safe_link(link) != link:
                self.graph.patch_node(node["id"], {"link": safe_link(link)})
                n += 1
        return n

    def _to_graph(self, rec: dict[str, Any], *, seq: int | None = None) -> None:
        rec = {**rec, "link": safe_link(rec.get("link"))}
        props = {k: self._coerce(k, v) for k, v in rec.items() if k in self._allowed and v is not None}
        props = {k: v for k, v in props.items() if v is not None}
        props["id"] = str(rec["id"])
        props["status"] = "done" if rec.get("ok") else "failed"
        props["seq"] = int(seq if seq is not None else time.time_ns() // 1000)
        props["created_at"] = str(rec.get("delivered_at") or now_iso())
        props.setdefault("label", f"{rec.get('target') or 'teslim'} · {rec.get('deliverable_id') or ''}"[:160])
        node = self.graph.upsert_node("Delivery", props, replace=True)
        did = rec.get("deliverable_id")
        target = self.graph.find("Deliverable", str(did)) if did else None
        if target is not None:
            self.graph.link("DELIVERY_OF", node["id"], target["id"])

    def _coerce(self, key: str, value: Any) -> Any:
        """Eski JSON kayıtları gevşek tipli olabilir (ör. `ref` sayı): ontoloji tipine yumuşakça çevrilir; olmazsa atlanır."""
        kind = self.graph.ontology.entity("Delivery").properties[key].type
        if kind in ("string", "text"):
            return value if isinstance(value, str) else str(value)
        if kind == "int":
            try:
                return None if isinstance(value, bool) else int(value)
            except (TypeError, ValueError):
                return None
        if kind == "bool":
            return value if isinstance(value, bool) else None
        if kind == "object":
            return value if isinstance(value, dict) else None
        return value

    def _from_graph(self, node: dict[str, Any]) -> dict[str, Any]:
        p = node["props"]
        rec = {k: v for k, v in p.items() if k not in INTERNAL_KEYS}
        for k in RECORD_KEYS:
            rec.setdefault(k, None)
        return rec

    def _graph_rows(self, **props: Any) -> list[dict[str, Any]]:
        rows = self.graph.nodes("Delivery", limit=LIST_SCAN, order="created_at DESC", props=props or None)
        rows.sort(key=lambda n: (int(n["props"].get("seq") or 0), str(n["props"].get("created_at") or "")))
        return rows

    # ------------------------------------------------------------ kayıtlar
    def add(self, record: dict[str, Any]) -> dict[str, Any]:
        rec = {"id": f"dlr_{uuid.uuid4().hex[:12]}", **record}
        if self.graph is not None:
            self._to_graph(rec)
            return rec
        with self._lock:
            items = self._legacy()
            items.append({**rec, "link": safe_link(rec.get("link"))})
            _atomic_json(self.dir / RECORDS_FILE, {"records": items[-MAX_RECORDS:]})
        return rec

    def for_deliverable(self, did: str, limit: int = 50) -> list[dict[str, Any]]:
        if self.graph is not None:
            rows = self._graph_rows(deliverable_id=did)
            return [self._from_graph(n) for n in reversed(rows)][:limit]
        with self._lock:
            items = [r for r in self._legacy() if r.get("deliverable_id") == did]
        return list(reversed(items))[:limit]

    def latest_by_deliverable(self) -> dict[str, dict[str, Any]]:
        """Her çıktının son başarılı teslimi (liste rozetleri için)."""
        out: dict[str, dict[str, Any]] = {}
        if self.graph is not None:
            for n in self._graph_rows(ok=True):
                r = self._from_graph(n)
                if r.get("target") not in ("clipboard", "download"):
                    out[str(r.get("deliverable_id"))] = r
            return out
        with self._lock:
            for r in self._legacy():
                if r.get("ok") and r.get("target") not in ("clipboard", "download"):
                    out[str(r.get("deliverable_id"))] = r
        return out

    # ------------------------------------------------------------ ayarlar
    def settings(self) -> dict[str, Any]:
        data = _read(self.dir / SETTINGS_FILE, {})
        out = dict(DEFAULT_SETTINGS)
        if isinstance(data, dict):
            out.update({k: data[k] for k in DEFAULT_SETTINGS if k in data})
        out["redact_pii"] = bool(out.get("redact_pii"))
        return out

    def update_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            cur = self.settings()
            for k, v in patch.items():
                if k == "redact_pii":
                    if not isinstance(v, bool):
                        raise ValueError("redact_pii true/false olmalı")
                    cur[k] = v
                elif k in ("last_folder", "last_repo"):
                    cur[k] = str(v)[:1024] if v else None
            _atomic_json(self.dir / SETTINGS_FILE, cur)
        return cur
