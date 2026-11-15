"""Teslim servisi: hedef listesi → önizleme (birebir yük + özet) → açık onayla teslim → kayıt.

Akış kuralları:
- `preview` hiçbir şey yazmaz/göndermez; yükün sha256 özetini (`preview_hash`) döner.
- `deliver` yalnızca `approved: true` ve aynı `preview_hash` ile çalışır: yük yeniden hesaplanır; içerik, hedef ya da
  hedefteki durum (ör. dosya oluştu) değiştiyse 409 döner ve önizleme yenilenmelidir.
- Dış hedeflerde kalite kapısı `block` derse teslim ancak "yine de teslim et" + gerekçe ile yapılır.
- Kayıt içerik taşımaz; olay: `delivery.done {deliverable_id, target, ok, label, link}`.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any

from studio.delivery import quality_gate
from studio.delivery.adapters import ADAPTERS, ALIASES, Ctx, DeliveryError
from studio.delivery.records import DeliveryStore, safe_link
from studio.delivery.safety import redact
from studio.graph.store import now_iso

log = logging.getLogger("studio.delivery")

_SUGGESTIONS: dict[str, list[dict[str, Any]]] = {}
MAX_SUGGESTED_RUNS = 500


def suggest(run_id: str, targets: list[dict[str, Any]]) -> None:
    clean = []
    for t in targets or []:
        if not isinstance(t, dict):
            continue
        tid = ALIASES.get(str(t.get("kind") or t.get("target") or ""), str(t.get("kind") or t.get("target") or ""))
        if tid in ADAPTERS:
            clean.append({"target": tid, "options": t.get("options") if isinstance(t.get("options"), dict) else {},
                          "label": t.get("label")})
    if clean:
        _SUGGESTIONS[str(run_id)] = clean
        while len(_SUGGESTIONS) > MAX_SUGGESTED_RUNS:
            _SUGGESTIONS.pop(next(iter(_SUGGESTIONS)))


def resolve_target(target: Any) -> str:
    tid = ALIASES.get(str(target or ""), str(target or ""))
    if tid not in ADAPTERS:
        raise DeliveryError(f"Bilinmeyen teslim hedefi: {target}", 400, "unknown_target")
    return tid


def preview_hash(target: str, options: dict[str, Any], payload: dict[str, Any]) -> str:
    stable = {k: v for k, v in payload.items() if k not in ("warnings",)}
    blob = json.dumps({"target": target, "options": options, "payload": stable}, sort_keys=True, ensure_ascii=False,
                      default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


class DeliveryService:
    def __init__(self, studio: Any):
        self.studio = studio
        self.store = DeliveryStore(Path(studio.changes.data_dir), graph=getattr(studio, "store", None))  # D7: kayıtlar grafta

    # ------------------------------------------------------------ yardımcılar
    def _deliverables(self) -> Any:
        from studio.deliverables.api import get_service
        return get_service(self.studio)

    def _ctx(self, did: str) -> Ctx:
        svc = self._deliverables()
        item = svc.get(did)  # KeyError → 404
        pii = self.store.settings()["redact_pii"]
        try:
            text, stem = svc.export_text(did)
            text = redact(text, pii=pii)
        except ValueError:
            text, stem = None, Path(str(item.get("name") or "cikti")).stem
        raw = None
        if text is None:
            try:
                raw = svc.raw_file(did)
            except (PermissionError, FileNotFoundError, KeyError):
                try:  # docx/xlsx/pptx/zip/mp4… orijinali de klasöre kopyalanabilir (kullanıcı onayıyla)
                    raw = svc.original_file(did)[0]
                except (PermissionError, FileNotFoundError, KeyError):
                    raw = None
        return Ctx(self.studio, item, text, redact(item.get("title"), pii=pii) or stem, stem or "cikti", raw)

    # ------------------------------------------------------------ hedefler
    async def targets(self, *, deliverable_id: str | None = None, check: bool = False) -> dict[str, Any]:
        out = []
        for tid, a in ADAPTERS.items():
            try:
                r = await a.readiness(self.studio, check=check)
            except Exception as exc:  # noqa: BLE001 - bir hedefin yoklaması listeyi bozmasın
                r = {"available": False, "ready": False, "reason": str(exc)[:200]}
            out.append({"id": tid, "label": a.label, "external": a.external, **r})
        suggested: list[dict[str, Any]] = []
        if deliverable_id:
            try:
                run_id = self._deliverables().get(deliverable_id).get("run_id")
                suggested = list(_SUGGESTIONS.get(str(run_id), []))
            except KeyError:
                pass
        settings = self.store.settings()
        return {"targets": out, "suggested": suggested, "settings": settings}

    # ------------------------------------------------------------ önizleme
    async def _plan(self, did: str, target: str, options: dict[str, Any]) -> tuple[Ctx, dict, dict, str]:
        tid = resolve_target(target)
        if not isinstance(options, dict):
            raise DeliveryError("options bir nesne olmalı")
        ctx = self._ctx(did)
        opts, payload = await ADAPTERS[tid].plan(ctx, options)
        return ctx, opts, payload, preview_hash(tid, opts, payload)

    async def preview(self, did: str, target: str, options: dict[str, Any]) -> dict[str, Any]:
        tid = resolve_target(target)
        ctx, opts, payload, h = await self._plan(did, tid, options)
        adapter = ADAPTERS[tid]
        quality = await quality_gate.check(self.studio, ctx.item, ctx.text, external=True) \
            if adapter.external else None
        return {"deliverable_id": did, "target": tid, "label": adapter.label, "external": adapter.external,
                "options": opts, "payload": payload, "preview_hash": h, "quality": quality,
                "pii_redacted": self.store.settings()["redact_pii"]}

    # ------------------------------------------------------------ teslim (yalnızca kullanıcı onayıyla)
    async def deliver(self, did: str, target: str, options: dict[str, Any], *, preview_hash_: str,
                      approved: bool, override_reason: str | None = None) -> dict[str, Any]:
        if approved is not True:
            raise DeliveryError("Teslim için açık onay (approved: true) gerekli", 400, "approval_required")
        if not preview_hash_:
            raise DeliveryError("Önce önizle: preview_hash gerekli", 400, "approval_required")
        tid = resolve_target(target)
        ctx, opts, payload, h = await self._plan(did, tid, options)
        if h != preview_hash_:
            raise DeliveryError("İçerik ya da hedef önizlemeden sonra değişti; önizlemeyi yenile", 409, "stale_preview")
        adapter = ADAPTERS[tid]
        approved_at = now_iso()
        quality = None
        reason = (override_reason or "").strip()[:500]
        if adapter.external:
            quality = await quality_gate.check(self.studio, ctx.item, ctx.text, external=True)
            if quality and quality["action"] == "block":
                if len(reason) < 3:
                    raise DeliveryError("Kalite kapısı bu çıktıyı durdurdu. Yine de teslim etmek için gerekçe yaz.",
                                        409, "quality_blocked")
                await quality_gate.accept_anyway(self.studio, did, reason)
        base = {"deliverable_id": did, "run_id": ctx.item.get("run_id"), "target": tid, "preview_hash": h,
                "approved_at": approved_at, "external": adapter.external,
                "options": {k: v for k, v in opts.items() if k not in ("to", "cc")},
                "recipients": len(opts.get("to") or []) + len(opts.get("cc") or []) if tid == "email_draft" else None,
                "quality": {k: quality.get(k) for k in ("action", "score", "status")} if quality else None,
                "override_reason": reason if quality and quality["action"] == "block" else None}
        try:
            result = await adapter.send(ctx, opts, payload)
        except DeliveryError as exc:
            rec = self.store.add({**base, "delivered_at": now_iso(), "ok": False, "error": str(exc)[:500]})
            self._publish(rec)
            raise
        except Exception as exc:  # noqa: BLE001
            log.exception("teslim başarısız")
            rec = self.store.add({**base, "delivered_at": now_iso(), "ok": False, "error": str(exc)[:500]})
            self._publish(rec)
            raise DeliveryError(f"Teslim başarısız: {str(exc)[:300]}", 500, "delivery_failed") from None
        rec = self.store.add({**base, "delivered_at": now_iso(), "ok": True,
                              "result": str(result.get("result") or "")[:300], "link": result.get("link"),
                              "ref": result.get("ref"), "path": result.get("path"),
                              "label": result.get("label") or adapter.label["tr"]})
        self._remember(tid, opts)
        self._publish(rec)
        client = {k: result[k] for k in ("client_action", "content", "format", "link") if k in result}
        return {"ok": True, "record": rec, **client}

    def _remember(self, tid: str, opts: dict[str, Any]) -> None:
        try:
            if tid in ("folder",) or (tid == "email_draft" and opts.get("folder")):
                self.store.update_settings({"last_folder": opts.get("folder")})
            elif tid.startswith("github_"):
                self.store.update_settings({"last_repo": opts.get("repo")})
        except (OSError, ValueError):
            pass

    def _publish(self, rec: dict[str, Any]) -> None:
        try:
            self.studio.bus.publish("delivery.done", deliverable_id=rec.get("deliverable_id"), target=rec.get("target"),
                                    ok=rec.get("ok"), label=rec.get("label"), link=safe_link(rec.get("link")),
                                    ref=rec.get("ref"), record_id=rec.get("id"))
        except Exception:  # noqa: BLE001
            log.debug("delivery.done yayınlanamadı", exc_info=True)

    def records(self, did: str) -> list[dict[str, Any]]:
        return self.store.for_deliverable(did)
