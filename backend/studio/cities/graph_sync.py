"""FAZB2 — dünya/oyun kataloğunun graf projeksiyonu.

Şehir, semt, simge, ulaşım hattı, ritüel, pasaport damgası tanımı ve açılım kuralları grafa düğüm + kenar olarak yazılır;
"bu simgeye en çok hangi ajan iş yaptı" türü sorular graf üzerinden sorulabilsin. Kaynaklar YALNIZ OKUNUR:

- `walk/explore.py CITY_CATALOG` (semt → simge, damgalar, duraklar, semt kilitleri; yeni şehirler catalog.json'dan),
- `walk/rituals.py CATALOG` (ritüeller), `game/catalog.py SCENE_PACKS` (şehir paketleri),
- ön yüz harita dosyaları (`voxel/citymap/cities/<şehir>.ts`, `voxel/cities/<şehir>/map.ts`: duraklar + hatlar) ve ritüel
  dosyaları (`voxel/fun/rituals/<şehir>.ts`, `voxel/cities/<şehir>/rituals.ts`: ritüelin semt/simgesi). Dosya yoksa (yalnız
  arka uç kurulu paket) hat ve ritüel yeri boş kalır; geri kalanı aynen kurulur.
- Ajan → şehir (`VISITED`): `Run.work_zone` (`<şehir>:<ofis>`) taşıyan koşuların adım ajanları.

Oyun defteri (game.sqlite, walk_city, walk_rituals) DEĞİŞMEZ; ilerleme nasıl saklanıyorsa öyle kalır. Projeksiyon
**idempotent**tir (ikinci koşu hiçbir graf değişikliği yazmaz: aynı özellik → günlük satırı yok) ve **yeniden kurulabilir**:
katalogdan düşen düğüm/kenar silinir, `purge` hepsini kaldırır. Kendiliğinden çalışmaz (açılışta değil): yalnız
`POST /api/world-graph/sync` (kullanıcı-yalnız) ya da `sync(store)` çağrısı yazar — kullanıcının grafına 1 400 düğüm
eklemek kullanıcının kararıdır (FAZB2 muhafazakâr seçim).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable

from fastapi import APIRouter, HTTPException, Request  # modül düzeyinde: rota imzası `Request` çözülebilsin

from studio.cities import ROOT

if TYPE_CHECKING:
    from studio.api import Studio
    from studio.graph.store import GraphStore

ACTOR = "system:world-sync"
WORLD_TYPES = ("City", "District", "Landmark", "RideLine", "Activity", "PassportStamp", "Unlock")
WORLD_RELS = ("HAS_DISTRICT", "HAS_LANDMARK", "HAS_LINE", "SERVES", "HAS_ACTIVITY", "AT", "STAMP_FOR", "GRANTS",
              "REQUIRES", "VISITED")
VOXEL = ROOT / "frontend" / "src" / "voxel"

# shortcut: TS dosyaları düz ifadeyle okunur (bağımlılık yok); biçim `{ id: "x", district: "y" … }` / `{ id, kind, stops: [..] }`
# sözleşmesi bozulursa hat/ritüel yeri boş kalır (test_world_graph.py yeni şehirlerin hatlarını sabitler)
_STOP_RE = re.compile(r'\{\s*id:\s*"([a-z][a-z0-9_]*)",\s*district:\s*"([a-z][a-z0-9_]*)"')
_LINE_RE = re.compile(r'\{\s*id:\s*"([a-z][a-z0-9_]*)",\s*kind:\s*"([a-z]+)",\s*stops:\s*\[([^\]]*)\]')
_RITUAL_RE = re.compile(r'\bid:\s*"([a-z][a-z0-9_]*)",\s*city:')
_ANCHOR_RE = re.compile(r'district:\s*"([a-z][a-z0-9_]*)"(?:,\s*landmark:\s*"([a-z][a-z0-9_]*)")?')


def _read(paths: Iterable[Path]) -> str:
    for p in paths:
        try:
            return p.read_text("utf-8")
        except OSError:
            continue
    return ""


def map_source(city: str, voxel: Path = VOXEL) -> str:
    return _read([voxel / "citymap" / "cities" / f"{city}.ts", voxel / "cities" / city / "map.ts"])


def ritual_source(city: str, voxel: Path = VOXEL) -> str:
    return _read([voxel / "fun" / "rituals" / f"{city}.ts", voxel / "cities" / city / "rituals.ts"])


def parse_lines(text: str) -> tuple[dict[str, str], list[dict[str, Any]]]:
    """Harita kaynağından (durak → semt, hatlar)."""
    from studio.worlds.citymap import VEHICLES  # noqa: PLC0415

    stops = {sid: dist for sid, dist in _STOP_RE.findall(text)}
    lines = []
    for lid, kind, raw in _LINE_RE.findall(text):
        ids = re.findall(r'"([a-z][a-z0-9_]*)"', raw)
        if kind in VEHICLES and len(ids) >= 2 and all(s in stops for s in ids):
            lines.append({"id": lid, "kind": kind, "stops": ids})
    return stops, lines


def parse_ritual_anchors(text: str) -> dict[str, list[tuple[str, str | None]]]:
    """Ritüel kaynağından ritüel → [(semt, simge|None)] (harita kapsamındaki `map:` girdileri)."""
    out: dict[str, list[tuple[str, str | None]]] = {}
    marks = list(_RITUAL_RE.finditer(text))
    for i, m in enumerate(marks):
        seg = text[m.end(): marks[i + 1].start() if i + 1 < len(marks) else len(text)]
        at = seg.find("map:")
        if at < 0:
            continue
        seg = seg[at:]
        end = seg.find("act:")
        out[m.group(1)] = [(d, lm or None) for d, lm in _ANCHOR_RE.findall(seg[:end] if end > 0 else seg)]
    return out


def build(work_zones: dict[str, set[str]] | None = None, voxel: Path = VOXEL) -> dict[str, Any]:
    """Beklenen projeksiyon: {"nodes": {(tür, anahtar): özellikler}, "edges": {(ilişki, (tür, anahtar), (tür, anahtar))}}.
    `work_zones`: {ajan slug: {şehir}} (VISITED)."""
    from studio.game.catalog import SCENE_PACKS  # noqa: PLC0415
    from studio.walk import explore as EX  # noqa: PLC0415
    from studio.walk import rituals as RT  # noqa: PLC0415
    from studio.cities import NEW_CITY_CATALOGS  # noqa: PLC0415

    nodes: dict[tuple[str, str], dict[str, Any]] = {}
    edges: set[tuple[str, tuple[str, str], tuple[str, str]]] = set()

    def node(t: str, key: str, **props: Any) -> tuple[str, str]:
        nodes[(t, key)] = {"id": key, **{k: v for k, v in props.items() if v is not None}}
        return (t, key)

    cities = {c: v for c, v in EX.CITY_CATALOG["cities"].items() if not v.get("test")}
    packs = {c: p.id for p in SCENE_PACKS.values() if p.tier == "city" for c in p.scenes}
    for city, spec in cities.items():
        new = NEW_CITY_CATALOGS.get(city) or {}
        cn = node("City", city, label=(new.get("shop") or {}).get("label_tr"), region=new.get("region"),
                  order=new.get("order"), pack=packs.get(city))
        stop_district, lines = parse_lines(map_source(city, voxel))
        for d, ds in spec["districts"].items():
            dn = node("District", f"{city}:{d}", city=city, vp=int(ds.get("vp", 0)), gz=int(ds.get("gz", 0)))
            edges.add(("HAS_DISTRICT", cn, dn))
            for lm, inner in ds["landmarks"].items():
                ln = node("Landmark", f"{city}:{lm}", city=city, district=d, interior=bool(inner))
                edges.add(("HAS_LANDMARK", dn, ln))
        for ln_ in lines:
            rn = node("RideLine", f"{city}:{ln_['id']}", city=city, kind=ln_["kind"], stops=ln_["stops"])
            edges.add(("HAS_LINE", cn, rn))
            for s in ln_["stops"]:
                if (d := stop_district.get(s)) in spec["districts"]:
                    edges.add(("SERVES", rn, ("District", f"{city}:{d}")))
        for sid in EX.city_ids(city):
            p = EX.city_parse(sid) or {}
            kind = p.get("kind")
            sn = node("PassportStamp", sid, city=city, kind=kind)
            dist = p.get("district") or (stop_district.get(p.get("target") or "") if kind == "stop" else None)
            if kind in ("lm", "in") and ("Landmark", f"{city}:{p.get('target')}") in nodes:
                edges.add(("STAMP_FOR", sn, ("Landmark", f"{city}:{p['target']}")))
            elif dist in spec["districts"]:
                edges.add(("STAMP_FOR", sn, ("District", f"{city}:{dist}")))
            else:
                edges.add(("STAMP_FOR", sn, cn))
        for d, rule in (spec.get("unlock") or {}).items():
            if d not in spec["districts"]:
                continue
            un = node("Unlock", f"unlock:{city}:{d}", kind="district", level=int(rule.get("level") or 0) or None)
            edges.add(("GRANTS", un, ("District", f"{city}:{d}")))
            if rule.get("after") in spec["districts"]:
                edges.add(("REQUIRES", un, ("District", f"{city}:{rule['after']}")))
        anchors = parse_ritual_anchors(ritual_source(city, voxel))
        for r in RT.CATALOG.get(city, ()):
            an = node("Activity", RT.memory_id(city, r), city=city, kind="ritual")
            edges.add(("HAS_ACTIVITY", cn, an))
            for d, lm in anchors.get(r, []):
                if lm and ("Landmark", f"{city}:{lm}") in nodes:
                    edges.add(("AT", an, ("Landmark", f"{city}:{lm}")))
                elif d in spec["districts"]:
                    edges.add(("AT", an, ("District", f"{city}:{d}")))
    for pid in sorted(set(packs.values())):
        granted = [c for c, p in packs.items() if p == pid and c in cities]
        if granted:
            pn = node("Unlock", f"pack:{pid}", kind="pack")
            edges.update(("GRANTS", pn, ("City", c)) for c in granted)
    for slug, visited in sorted((work_zones or {}).items()):
        for c in visited:
            if c in cities:
                edges.add(("VISITED", ("Agent", slug), ("City", c)))
    return {"nodes": nodes, "edges": edges}


def work_zone_visits(store: "GraphStore", limit: int = 20000) -> dict[str, set[str]]:
    """{ajan slug: {şehir}}: şehir bölgesinde (`<şehir>:<ofis>`) çalışmış koşuların adım ajanları."""
    runs = [r for r in store.nodes("Run", limit=limit, exclude={"work_zone": "office"})
            if isinstance(r["props"].get("work_zone"), str) and ":" in r["props"]["work_zone"]]
    out: dict[str, set[str]] = {}
    steps = store.neighbors_many([r["id"] for r in runs], ["HAS_STEP"], "out")
    for r in runs:
        city = r["props"]["work_zone"].split(":", 1)[0]
        for _e, st, _d in steps.get(r["id"], []):
            agent = st["props"].get("agent")
            if isinstance(agent, str) and agent:
                out.setdefault(agent, set()).add(city)
    return out


def _all(store: "GraphStore", t: str) -> list[dict[str, Any]]:
    return store.nodes(t, limit=1_000_000, order="created_at ASC")


def sync(store: "GraphStore", voxel: Path = VOXEL) -> dict[str, Any]:
    """Projeksiyonu kurar/eşitler. Dönüş: tür başına düğüm sayısı, kenar sayısı, eklenen/silinen ve yazılan günlük satırı."""
    from studio.graph import cdc  # noqa: PLC0415

    head0 = int(store.changes(after=0, limit=1)["head"])
    visits = work_zone_visits(store)
    plan = build(visits, voxel)
    agents = {slug: store.find("Agent", slug) for slug in visits}
    removed = 0
    with cdc.context(actor=ACTOR), store.bulk():
        ids: dict[tuple[str, str], str] = {("Agent", s): a["id"] for s, a in agents.items() if a}
        for t in WORLD_TYPES:
            for n in _all(store, t):
                if (t, n["key"]) not in plan["nodes"]:
                    store.delete_node(n["id"])
                    removed += 1
        for (t, key), props in plan["nodes"].items():
            ids[(t, key)] = store.upsert_node(t, props, replace=True)["id"]
        want = {(rel, ids[a], ids[b]) for rel, a, b in plan["edges"] if a in ids and b in ids}
        world_ids = [v for (t, _k), v in ids.items() if t in WORLD_TYPES]
        have: dict[tuple[str, str, str], str] = {}
        for _nid, items in store.neighbors_many(world_ids, WORLD_RELS, "both").items():
            for e, _n, _d in items:
                have[(e["type"], e["src"], e["dst"])] = e["id"]
        stale = [eid for k, eid in have.items() if k not in want]
        if stale:
            removed += store.delete_edges(stale)
        for rel, a, b in sorted(want - set(have)):
            store.link(rel, a, b)
    counts = {t: store.count(t) for t in WORLD_TYPES}
    head1 = int(store.changes(after=0, limit=1)["head"])
    return {"nodes": counts, "edges": len(want), "removed": removed, "journal_rows": head1 - head0}


def purge(store: "GraphStore") -> int:
    """Projeksiyonu tümüyle kaldırır (kenarlar düğümle birlikte gider). Silinen düğüm sayısı."""
    from studio.graph import cdc  # noqa: PLC0415

    n = 0
    with cdc.context(actor=ACTOR), store.bulk():
        for t in WORLD_TYPES:
            for node in _all(store, t):
                store.delete_node(node["id"])
                n += 1
    return n


def build_router(studio: "Studio") -> APIRouter:
    import asyncio  # noqa: PLC0415

    from studio.clients.tracker import mcp_client  # noqa: PLC0415

    r = APIRouter(prefix="/api/world-graph", tags=["world-graph"])

    def _local(request: Request) -> None:
        if mcp_client(request):
            raise HTTPException(403, "Dünya grafı yalnız stüdyonun kendi arayüzünden eşitlenir")

    @r.get("")
    def status() -> dict[str, Any]:
        return {"nodes": {t: studio.store.count(t) for t in WORLD_TYPES}}

    @r.post("/sync")
    async def run_sync(request: Request) -> dict[str, Any]:
        _local(request)
        return await asyncio.to_thread(sync, studio.store)

    @r.post("/purge")
    async def run_purge(request: Request) -> dict[str, Any]:
        _local(request)
        return {"removed": await asyncio.to_thread(purge, studio.store)}

    return r
