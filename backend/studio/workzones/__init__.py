"""WORK-ZONES (ürün sahibi 2026-10-28, plan §5 C2) — görev başına çalışma bölgesi.

"Agentlara çalışacakları alanlar görev verilirken belirlenebilir. Bölge olarak. … Şehirlerde de ofis alanları ve binaları
olabilir. Agentlar işe gider gibi buralara da gidebilirler."

Kaynak: `frontend/src/voxel/workzones/zones.json` (ön yüz AYNI dosyayı okur; kimlikler iki yanda aynı doğrulanır). Bölge kimliği
`office` (taban ofis / çalışma alanı = bugünkü davranış) ya da `<sahne>:<ofis>` (ör. `istanbul:levent`); ofis binaları yalnız
13 şehir sahnesinde. Dosya yoksa (yalnız arka uç kurulu paket) tek bölge `office`'tir: davranış bugünküyle aynı.

Graf: `Run.work_zone` (görevin bölgesi; görev uç noktası koşu düğümüne `GraphStore.patch_node` ile yazar) ve
`Agent.work_zone` (ajanın varsayılanı; yalnız `PUT /api/agents/{slug}/work-zone`). İkisi de ontolojide (`studio.ontology.yaml`).
Bağımlılık yok; saf JSON okuma.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from studio._edition import EDITION

ROOT = Path(__file__).resolve().parents[3]
ZONES_FILE = ROOT / "frontend" / "src" / "voxel" / "workzones" / "zones.json"
BASE_ZONE = "office"
OFFICE_DESKS = 8  # offices.ts OFFICE_SEATS (iki ada × dört masa)
_ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,23}:[a-z][a-z0-9]{1,23}$")


@lru_cache(maxsize=1)
def _load() -> dict[str, Any]:
    try:
        data = json.loads(ZONES_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"base": {"id": BASE_ZONE, "tr": "Ofis", "en": "Office"}, "cities": {}}
    if not isinstance(data, dict) or not isinstance(data.get("cities"), dict):
        return {"base": {"id": BASE_ZONE, "tr": "Ofis", "en": "Office"}, "cities": {}}
    if EDITION == "full":  # EDITION1: tam sürüm şehirlerinin ofisleri ayrı dosyada (frontend/src/full/zones.full.json)
        from studio.full.workzones import merge_zones

        data = merge_zones(data)
    return data


def scenes() -> list[str]:
    """Ofis binası olan sahneler (kayıt sırası)."""
    return list(_load()["cities"].keys())


def zones_for(scene: str | None) -> list[dict[str, Any]]:
    """Sahnenin seçilebilir bölgeleri: önce taban ofis, sonra (şehirse) ofis binaları."""
    base = _load()["base"]
    out: list[dict[str, Any]] = [{"id": BASE_ZONE, "tr": base.get("tr", "Ofis"), "en": base.get("en", "Office"),
                                  "scene": None, "office": None, "look": None, "desks": None}]
    for o in _load()["cities"].get(scene or "", []) or []:
        if isinstance(o, dict) and isinstance(o.get("id"), str):
            out.append({"id": f"{scene}:{o['id']}", "tr": o.get("tr") or o["id"], "en": o.get("en") or o.get("tr") or o["id"],
                        "scene": scene, "office": o["id"], "look": o.get("look"), "desks": OFFICE_DESKS})
    return out


def is_known(zone: str) -> bool:
    """Kayıtta olan bölge mi (`office` dahil; sahneden bağımsız)."""
    if zone == BASE_ZONE:
        return True
    if not _ID_RE.match(zone):
        return False
    scene, office = zone.split(":", 1)
    return any(isinstance(o, dict) and o.get("id") == office for o in _load()["cities"].get(scene, []) or [])


def name_of(zone: str | None, lang: str = "tr") -> str:
    """Bölgenin adı (bilinmeyende taban ofis adı; ham kimlik gösterilmez)."""
    for z in zones_for(zone.split(":", 1)[0] if zone and ":" in zone else None):
        if z["id"] == (zone or BASE_ZONE):
            return str(z["en" if lang == "en" else "tr"])
    base = _load()["base"]
    return str(base.get("en" if lang == "en" else "tr", "Office"))


class ZoneError(ValueError):
    """Geçersiz çalışma bölgesi (400)."""


def normalize(zone: Any, scene: str | None) -> str | None:
    """İstekteki bölgeyi doğrular: boş / `office` → None (bugünkü davranış: graf alanı yazılmaz), geçerli ofis → kimlik.
    Biçimsiz ya da kayıtta olmayan → ZoneError; başka sahnenin ofisi → ZoneError (sahnede yok)."""
    if zone is None:
        return None
    if not isinstance(zone, str):
        raise ZoneError("Çalışma bölgesi metin olmalı")
    z = zone.strip()
    if not z or z == BASE_ZONE:
        return None
    if len(z) > 64 or not is_known(z):
        raise ZoneError(f"Bilinmeyen çalışma bölgesi: {z[:64]}")
    if z.split(":", 1)[0] != (scene or ""):
        raise ZoneError(f"Bu çalışma bölgesi geçerli sahnede yok: {z}")
    return z
