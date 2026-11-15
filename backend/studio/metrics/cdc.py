"""Ölçüm defterinin ilk CDC tüketicisi (Faz B-1).

Eski yol (`MetricsService.sync`): her uyandırmada Run/Acceptance/SystemCall düğümlerini `updated_at` filigranından
yeniden tarar. Yeni yol: `graph_changes` günlüğünden yalnız DEĞİŞEN bu türdeki düğümleri okur ve aynı türetme
işlevleriyle (`events_for_*`) deftere yazar. Olay kimlikleri deterministik + `INSERT OR IGNORE` → aynı sayfanın
yeniden işlenmesi (en az bir kez) çift kayıt üretmez. Eski yol yedek olarak kalır: imleç yokken ya da geçersizken
(`rebuild`) ve CDC bağlı olmayan stüdyolarda (`MetricsService.refresh`).
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from studio.metrics.service import MetricsService

log = logging.getLogger("studio.metrics.cdc")

NAME = "metrics"
TYPES = ("Run", "Acceptance", "SystemCall")


class MetricsCdcConsumer:
    name = NAME

    def __init__(self, svc: "MetricsService"):
        self.svc = svc

    def rebuild(self) -> None:
        self.svc.sync()

    def handle(self, changes: list[dict[str, Any]]) -> None:
        ids = {c["id"] for c in changes
               if c.get("kind") == "node" and c.get("type") in TYPES and c.get("op") != "delete"}
        if ids:
            self.apply(ids)

    def apply(self, node_ids: set[str]) -> int:
        """Düğümleri eski yolla aynı sırada (updated_at, id) türetir; eklenen defter satırı sayısı."""
        svc = self.svc
        if not svc._sync_lock.acquire(blocking=True, timeout=30):
            raise TimeoutError("metrics: eşitleme kilidi alınamadı")  # imleç ilerlemez, sayfa yeniden gelir
        try:
            svc._run_cache.clear()
            svc._demo_cache.clear()
            epoch = svc.ledger.epoch()
            env = svc._environment()
            fns = {"Run": svc.events_for_run, "Acceptance": svc.events_for_acceptance,
                   "SystemCall": svc.events_for_system_call}
            nodes = svc.store.get_nodes(sorted(node_ids))
            batch: list[dict[str, Any]] = []
            for n in sorted(nodes.values(), key=lambda x: (str(x.get("updated_at") or ""), str(x["id"]))):
                fn = fns.get(n.get("type"))
                if fn is None:
                    continue
                try:
                    evs = fn(n, env)
                except Exception:  # noqa: BLE001 - tek kayıt hatası sayfayı durdurmaz (eski yolla aynı)
                    log.exception("metrics: %s %s işlenemedi", n.get("type"), n.get("id"))
                    evs = []
                batch += [e for e in evs if e["occurred_at"] >= epoch]
            added = svc.ledger.insert(batch)
            svc.ledger.purge_before(time.time() - svc.retention_days() * 86400)
            return added
        finally:
            svc._sync_lock.release()


__all__ = ["MetricsCdcConsumer", "NAME", "TYPES"]
