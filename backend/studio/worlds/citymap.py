"""dünya biçimi v1.3 `city_map` bloğunun doğrulaması ( "Biçim").

Arayüz eşi `frontend/src/voxel/citymap/format.ts cityMapIssues`: aynı kurallar, aynı alan yolları ve aynı sıra (eşlik testi:
`backend/tests/test_city_map.py`). Kapalı şema; kimlikler `^[a-z][a-z0-9_]{0,23}$` ve tekil. Semt sınırı parsel ızgarasına
hizalı (i0, w 12'nin; j0, d 16'nın katı; 24 ≤ w ≤ 96, 32 ≤ d ≤ 96), varış meydanıyla ([0, 12) × [0, 16)) ve birbiriyle kesişmez.
Landmark ayak izi semtin 1 karoluk kenar halkasının içinde (semt kenarları yürünebilir kalır); kapı ayak izinin dışında ve
semtin içinde; kapı ↔ iç mekân türü birlikte. Duraklar var olan semtte; hatlar ≥ 2 var olan, tekrarsız durak.
"""

from __future__ import annotations

import math
import re
from typing import Any

PW, PD = 12, 16
GATE_W, GATE_D = 12, 16
DISTRICT_MIN_W, DISTRICT_MIN_D, DISTRICT_MAX = 24, 32, 96
MAX_DISTRICTS, MAX_LANDMARKS, MAX_ENTRIES, MAX_VIEWPOINTS = 8, 8, 6, 4
MAX_STOPS, MAX_LINES, MAX_ROUTE = 24, 8, 64
COORD_MAX = 1024
LANDMARK_MAX_W, LANDMARK_MAX_H = 20, 24  # format.ts ile eş (aslan gövdeli heykel gerçek oranı)
THEMES = ("generic", "historic", "harbor", "modern", "garden", "bazaar", "hill")
VEHICLES = ("vapur", "tramvay", "funikuler", "kayik", "metro", "teleferik", "otobus", "monoray", "balon")
SHAPES = ("tower", "hall", "dome", "arch", "obelisk")
INTERIORS = ("tower", "museum", "castle", "terrace", "lobby", "courtyard")  # COURTYARD-PORTAL: duvarlı avlu (ayrı sahne)
GATE_KINDS = ("pier", "plaza")

_ID = re.compile(r"^[a-z][a-z0-9_]{0,23}$")
MAP_KEYS = ("id", "gate", "sea", "districts", "stops", "lines")
DISTRICT_KEYS = ("id", "seed", "bounds", "theme", "landmarks", "entries", "viewpoints")
LANDMARK_KEYS = ("id", "shape", "tile", "w", "d", "h", "door", "interior")
STOP_KEYS = ("id", "district", "tile", "board")  # CABLEVP1: board isteğe bağlı (biniş platformu)
LINE_KEYS = ("id", "kind", "stops", "route")


def _int(v: Any) -> bool:
    return (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer())


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _tile(v: Any) -> bool:
    return isinstance(v, list) and len(v) == 2 and all(_int(x) for x in v)


def _keys_ok(o: dict[str, Any], allowed: tuple[str, ...]) -> bool:
    return all(k in allowed for k in o)


def _in_local(t: list[Any], w: int, d: int) -> bool:
    return 0 <= t[0] < w and 0 <= t[1] < d


def _overlap(a: list[int], b: list[int]) -> bool:
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def _id_ok(v: Any) -> bool:
    return isinstance(v, str) and bool(_ID.match(v))


def city_map_issues(raw: Any) -> list[str]:  # noqa: C901, PLR0912, PLR0915 (arayüz eşiyle birebir sıra)
    """v1.3 `city_map` bloğunun sorunlu alan yolları (boş liste → geçerli)."""
    if not isinstance(raw, dict):
        return ["city_map"]
    out = [f"city_map.{k}" for k in raw if k not in MAP_KEYS]
    if not _id_ok(raw.get("id")):
        out.append("city_map.id")
    gate = raw.get("gate")
    if not isinstance(gate, dict) or not _keys_ok(gate, ("kind",)) or gate.get("kind") not in GATE_KINDS:
        out.append("city_map.gate")
    if "sea" in raw and not isinstance(raw["sea"], bool):
        out.append("city_map.sea")
    districts = raw.get("districts")
    dist: dict[str, list[int]] = {}
    if not isinstance(districts, list) or not 1 <= len(districts) <= MAX_DISTRICTS:
        out.append("city_map.districts")
    else:
        for n, d in enumerate(districts):
            p = f"city_map.districts[{n}]"
            if not isinstance(d, dict) or not _keys_ok(d, DISTRICT_KEYS):
                out.append(p)
                continue
            if not _id_ok(d.get("id")) or d.get("id") in dist:
                out.append(f"{p}.id")
            seed = d.get("seed")
            if not (_int(seed) and 0 <= seed < 2 ** 32):
                out.append(f"{p}.seed")
            if d.get("theme") not in THEMES:
                out.append(f"{p}.theme")
            b = d.get("bounds")
            ok_b = (isinstance(b, list) and len(b) == 4 and all(_int(x) for x in b))
            if ok_b:
                b = [int(x) for x in b]
                ok_b = (b[0] % PW == 0 and b[1] % PD == 0 and b[2] % PW == 0 and b[3] % PD == 0
                        and DISTRICT_MIN_W <= b[2] <= DISTRICT_MAX and DISTRICT_MIN_D <= b[3] <= DISTRICT_MAX
                        and abs(b[0]) <= COORD_MAX and abs(b[1]) <= COORD_MAX
                        and abs(b[0] + b[2]) <= COORD_MAX and abs(b[1] + b[3]) <= COORD_MAX
                        and not _overlap(b, [0, 0, GATE_W, GATE_D])
                        and not any(_overlap(o, b) for o in dist.values()))
            if not ok_b:
                out.append(f"{p}.bounds")
                continue
            w, dd = b[2], b[3]
            if isinstance(d.get("id"), str):
                dist[d["id"]] = b
            lms = d.get("landmarks")
            lm_ids: set[str] = set()
            if not isinstance(lms, list) or len(lms) > MAX_LANDMARKS:
                out.append(f"{p}.landmarks")
            else:
                for k, lm in enumerate(lms):
                    q = f"{p}.landmarks[{k}]"
                    if not isinstance(lm, dict) or not _keys_ok(lm, LANDMARK_KEYS):
                        out.append(q)
                        continue
                    if not _id_ok(lm.get("id")) or lm.get("id") in lm_ids:
                        out.append(f"{q}.id")
                    else:
                        lm_ids.add(lm["id"])
                    if lm.get("shape") not in SHAPES:
                        out.append(f"{q}.shape")
                    lw, ld = lm.get("w"), lm.get("d")
                    size = _int(lw) and _int(ld) and 1 <= lw <= LANDMARK_MAX_W and 1 <= ld <= LANDMARK_MAX_W
                    if not size:
                        out.append(f"{q}.size")
                    h = lm.get("h")
                    if not (_num(h) and 0.5 <= h <= LANDMARK_MAX_H):
                        out.append(f"{q}.h")
                    t = lm.get("tile")
                    if not _tile(t) or not size or not (t[0] >= 1 and t[1] >= 1 and t[0] + lw <= w - 1 and t[1] + ld <= dd - 1):
                        out.append(f"{q}.tile")
                    has_door, has_in = "door" in lm, "interior" in lm
                    if has_door != has_in:
                        out.append(f"{q}.door")
                    if has_in and lm.get("interior") not in INTERIORS:
                        out.append(f"{q}.interior")
                    if has_door:
                        dt = lm.get("door")
                        inside = (_tile(dt) and _tile(t) and size and t[0] <= dt[0] < t[0] + lw and t[1] <= dt[1] < t[1] + ld)
                        if not _tile(dt) or not _in_local(dt, w, dd) or inside:
                            out.append(f"{q}.door")
            entries = d.get("entries")
            if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_ENTRIES \
                    or not all(_tile(t) and _in_local(t, w, dd) for t in entries):
                out.append(f"{p}.entries")
            if "viewpoints" in d:
                vp = d["viewpoints"]
                if not (isinstance(vp, list) and len(vp) <= MAX_VIEWPOINTS and all(_tile(t) and _in_local(t, w, dd) for t in vp)):
                    out.append(f"{p}.viewpoints")
    stops = raw.get("stops")
    stop_ids: set[str] = set()
    if not isinstance(stops, list) or len(stops) > MAX_STOPS:
        out.append("city_map.stops")
    else:
        for n, s in enumerate(stops):
            p = f"city_map.stops[{n}]"
            if not isinstance(s, dict) or not _keys_ok(s, STOP_KEYS):
                out.append(p)
                continue
            if not _id_ok(s.get("id")) or s.get("id") in stop_ids:
                out.append(f"{p}.id")
            else:
                stop_ids.add(s["id"])
            b2 = dist.get(s["district"]) if isinstance(s.get("district"), str) else None
            if b2 is None:
                out.append(f"{p}.district")
            elif not _tile(s.get("tile")) or not _in_local(s["tile"], b2[2], b2[3]):
                out.append(f"{p}.tile")
            if b2 is not None and "board" in s and (not _tile(s["board"]) or not _in_local(s["board"], b2[2], b2[3])):
                out.append(f"{p}.board")
    lines = raw.get("lines")
    line_ids: set[str] = set()
    if not isinstance(lines, list) or len(lines) > MAX_LINES:
        out.append("city_map.lines")
    else:
        for n, ln in enumerate(lines):
            p = f"city_map.lines[{n}]"
            if not isinstance(ln, dict) or not _keys_ok(ln, LINE_KEYS):
                out.append(p)
                continue
            if not _id_ok(ln.get("id")) or ln.get("id") in line_ids:
                out.append(f"{p}.id")
            else:
                line_ids.add(ln["id"])
            if ln.get("kind") not in VEHICLES:
                out.append(f"{p}.kind")
            st = ln.get("stops")
            if not isinstance(st, list) or not 2 <= len(st) <= MAX_STOPS \
                    or not all(isinstance(x, str) and x in stop_ids for x in st) or len(set(map(str, st))) != len(st):
                out.append(f"{p}.stops")
            if "route" in ln:
                r = ln["route"]
                if not (isinstance(r, list) and 2 <= len(r) <= MAX_ROUTE
                        and all(_tile(t) and abs(t[0]) <= COORD_MAX and abs(t[1]) <= COORD_MAX for t in r)):
                    out.append(f"{p}.route")
    return out
