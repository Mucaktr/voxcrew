""""Her yerde çizili" kapısı (dersi).

Bir set, iddia ettiği HER yüzeyde gerçekten çizilmeden satılamaz. Arka uç çizimi kendisi bilemez: arayüzdeki çizim kayıt
defteri (`frontend/src/voxel/cosmetics/registry.ts`) her parça ve yüzey için çiziciyi bildirir ve
`frontend/scripts/cosmetic_coverage.mjs` bundan `cosmetic_coverage.json` üretir. Bu modül o dosyayı OKUR (yazmaz).

## Dosya biçimi (COS-A ↔ COS-B sözleşmesi, `schema: 1`)

```json
{
  "schema": 1,
  "generated_at": "2026-10-19T12:00:00Z",
  "sets": {
    "polar-team": {
      "items": {
        "store:polar-team-parka": {"surfaces": {"avatar": true, "me": true, "collection": true}},
        "store:polar-team-pole-star": {"surfaces": {"celebration": true, "collection": true},
                                       "reduced_motion_static": true}
      },
      "preview_375": {"checked": true, "overflow": false}
    }
  }
}
```

- `sets` anahtarı set kimliğidir (`polar-team`; `store:` önekiyle de kabul edilir).
- `items[<parça>].surfaces[<yüzey>]`: `true` = o yüzeyde kayıtlı bir çizici var. Yüzey nesne de olabilir
  (`{"drawn": true, "live": true, "renderer": "...", "contexts": [...]}`). Eksik ya da `false` = çizilmiyor.
  `live: false` = çizici yalnız 3D denemede/önizlemede çalışıyor, sahip olunca canlı ofiste/dünyada çizilmiyor: bu da
  "çizilmiyor" sayılır ( tam olarak buydu: envanterde var, dünyada yok). `live` yoksa `drawn` yeterlidir.
- `reduced_motion_static`: kutlama yüzeyi olan parçada `prefers-reduced-motion` için statik hâl var mı (zorunlu).
- `preview_375`: önizleme 375 px'te ölçüldü mü (`checked`) ve yatay taşma var mı (`overflow`). Ölçülmemiş = satılamaz.
  Kısa biçim `"fits_375": true` da kabul edilir.

Kapı şunlardan biri varsa seti `sellable: false` yapar ve nedenleri sıralar (fail-closed; "yakında çizilecek" yok):
dosya yok/okunamıyor · set dosyada yok · parça dosyada yok · iddia edilen bir yüzey çizilmiyor ya da yalnız önizlemede
çiziliyor · kutlamanın statik hâli
yok · 375 px ölçülmedi ya da taşıyor · `ip_risk`/`culture_risk` > 1. Satılabilirlik yalnız bir durumdur: bayrak kapalıyken
ya da fiyat yokken hiçbir şey satışa açılmaz.

Dosya yolu: `STUDIO_COSMETIC_COVERAGE` ortam değişkeni, yoksa sırayla `frontend/cosmetic_coverage.json`,
`frontend/src/voxel/cosmetics/cosmetic_coverage.json`, `frontend/dist/cosmetic_coverage.json`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Mapping

from studio.cosmetics import catalog as K

SCHEMA_VERSION = 1
ENV_VAR = "STUDIO_COSMETIC_COVERAGE"
MAX_BYTES = 2_000_000


def _root() -> Path:
    return Path(__file__).resolve().parents[3]


def candidate_paths() -> list[Path]:
    env = os.environ.get(ENV_VAR, "").strip()
    if env:
        return [Path(env)]
    fe = _root() / "frontend"
    return [fe / "cosmetic_coverage.json", fe / "src" / "voxel" / "cosmetics" / "cosmetic_coverage.json",
            fe / "dist" / "cosmetic_coverage.json"]


def load(path: Path | str | None = None) -> tuple[dict[str, Any] | None, str | None]:
    """(kapsam, hata). Hata varsa kapsam None'dır ve her set satılamaz."""
    paths = [Path(path)] if path is not None else candidate_paths()
    found = next((p for p in paths if p.is_file()), None)
    if found is None:
        return None, "missing_file"
    try:
        if found.stat().st_size > MAX_BYTES:
            return None, "file_too_large"
        data = json.loads(found.read_text("utf-8"))
    except (OSError, ValueError):
        return None, "unreadable_file"
    if not isinstance(data, dict) or data.get("schema") != SCHEMA_VERSION or not isinstance(data.get("sets"), dict):
        return None, "bad_schema"
    return data, None


def _drawn(v: Any) -> bool:
    if isinstance(v, Mapping):
        return v.get("drawn") is True
    return v is True


def _live(v: Any) -> bool:
    """Canlı yüzeyde çiziliyor mu (`live` alanı yoksa çizim yeterli)."""
    return _drawn(v) and not (isinstance(v, Mapping) and v.get("live") is False)


def _fits_375(entry: Mapping[str, Any]) -> bool | None:
    pv = entry.get("preview_375")
    if isinstance(pv, Mapping):
        if pv.get("checked") is not True:
            return None
        return pv.get("overflow") is False
    fits = entry.get("fits_375")
    return fits if isinstance(fits, bool) else None


def _set_entry(data: Mapping[str, Any], set_id: str) -> Mapping[str, Any] | None:
    sets = data.get("sets") or {}
    e = sets.get(set_id, sets.get(f"{K.STORE_PREFIX}{set_id}"))
    return e if isinstance(e, Mapping) else None


def check_set(cs: K.CosmeticSet, data: Mapping[str, Any] | None, error: str | None = None) -> dict[str, Any]:
    """Tek setin kapı sonucu: {set, sellable, reasons[], items{parça: {surfaces{yüzey: bool}, static?}}, fits_375}."""
    reasons: list[dict[str, Any]] = []
    items: dict[str, Any] = {}
    risk = K.risk_state(cs)
    if risk != "ok":
        reasons.append({"code": "risk_review" if risk == "review" else "risk_rejected",
                        "ip_risk": cs.ip_risk, "culture_risk": cs.culture_risk})
    if cs.is_collection:   # koleksiyon: her üye set satılabilir olmalı
        for sid in cs.sets:
            member = K.SET_BY_ID.get(sid)
            sub = check_set(member, data, error) if member else {"sellable": False}
            if not sub["sellable"]:
                reasons.append({"code": "member_not_sellable", "set": sid})
        return {"set": cs.id, "sellable": not reasons, "reasons": reasons, "items": {}, "fits_375": None}
    if data is None:
        reasons.append({"code": error or "missing_file"})
        entry = None
    else:
        entry = _set_entry(data, cs.id)
        if entry is None:
            reasons.append({"code": "set_missing"})
    raw_items = (entry or {}).get("items") if entry else None
    raw_items = raw_items if isinstance(raw_items, Mapping) else {}
    for p in cs.pieces:
        it = raw_items.get(p.id)
        it = it if isinstance(it, Mapping) else None
        surf_raw = (it or {}).get("surfaces")
        surf_raw = surf_raw if isinstance(surf_raw, Mapping) else {}
        surfaces = {s: _live(surf_raw.get(s)) for s in p.surfaces}
        preview_only = sorted(s for s in p.surfaces if _drawn(surf_raw.get(s)) and not surfaces[s])
        row: dict[str, Any] = {"surfaces": surfaces, "preview_only": preview_only}
        if entry is not None and it is None:
            reasons.append({"code": "item_missing", "item": p.id})
        elif entry is not None:
            for s, ok in surfaces.items():
                if not ok:
                    code = "surface_preview_only" if s in preview_only else "surface_not_drawn"
                    reasons.append({"code": code, "item": p.id, "surface": s})
        if "celebration" in p.surfaces:
            static = (it or {}).get("reduced_motion_static") is True
            row["reduced_motion_static"] = static
            if entry is not None and it is not None and not static:
                reasons.append({"code": "no_static_celebration", "item": p.id})
        items[p.id] = row
    fits = _fits_375(entry) if entry is not None else None
    if entry is not None:
        if fits is None:
            reasons.append({"code": "preview_375_unchecked"})
        elif fits is False:
            reasons.append({"code": "preview_375_overflow"})
    return {"set": cs.id, "sellable": not reasons, "reasons": reasons, "items": items, "fits_375": fits}


def report(path: Path | str | None = None) -> dict[str, Any]:
    data, err = load(path)
    sets = {cs.id: check_set(cs, data, err) for cs in K.SETS}
    return {"schema": SCHEMA_VERSION, "source_ok": err is None, "error": err,
            "generated_at": (data or {}).get("generated_at"), "sets": sets,
            "sellable": sorted(k for k, v in sets.items() if v["sellable"])}


def piece_drawn(rep: Mapping[str, Any], piece_id: str) -> dict[str, bool]:
    """Koleksiyon görünümü için: parçanın yüzey başına çizim durumu (kapsam yoksa hepsi False)."""
    sid = K.PIECE_SET.get(piece_id)
    row = ((rep.get("sets") or {}).get(sid) or {}).get("items", {}).get(piece_id) if sid else None
    if not row:
        p = K.PIECE_BY_ID.get(piece_id)
        return {s: False for s in (p.surfaces if p else ())}
    return dict(row["surfaces"])
