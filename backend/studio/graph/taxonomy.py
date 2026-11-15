"""FAZB2 — kavram taksonomisi (SKOS benzeri;, voxcrew-mimari/03-arastirma.md §1).

`Concept` düğümleri artık yalnız `RELATED_TO` (birlikte geçme) ile değil, hiyerarşiyle de bağlanır:

- **broader / narrower**: `BROADER` kenarı dar → geniş (skos:broader). "narrower" ayrı kenar değildir; aynı kenarın tersidir
  (tek doğruluk kaynağı; iki kenarın birbirinden kayması imkânsız).
- **Döngü yok**: bir kavram kendi atasının altına konamaz (SKOS döngüyü yasaklamaz ama kontrollü sözlükte anlamsızdır).
- **altLabel**: `Concept.alt_labels` eş anlamlıları (normalleştirilmiş); `resolve` ad ya da eş anlamlıdan kavramı bulur.

Yazım yolu tektir: buradaki işlevler `GraphStore` üzerinden yazar (ontoloji doğrulaması + CDC günlüğü aynen geçerli).
HTTP: `GET /api/taxonomy/concepts/{id}` (okuma), `POST /api/taxonomy/broader` ve `DELETE /api/taxonomy/broader`,
`POST /api/taxonomy/alt-labels` (yazma kullanıcı-yalnız; MCP 403).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, HTTPException, Request  # modül düzeyinde: rota imzası `Request` çözülebilsin

from studio.ontology import OntologyError, normalize_key

if TYPE_CHECKING:
    from studio.api import Studio
    from studio.graph.store import GraphStore

REL = "BROADER"
MAX_DEPTH = 64  # hiyerarşi derinliği tavanı (bozuk veride sonsuz yürüyüş olmasın)


class TaxonomyError(ValueError):
    pass


def _concept(store: "GraphStore", node_id: str) -> dict[str, Any]:
    try:
        n = store.get_node(node_id)
    except KeyError:
        raise TaxonomyError(f"kavram yok: {node_id}") from None
    if n["type"] != "Concept":
        raise TaxonomyError(f"{node_id} bir kavram değil ({n['type']})")
    return n


def broader(store: "GraphStore", node_id: str) -> list[dict[str, Any]]:
    return [n for _e, n, _d in store.neighbors(node_id, [REL], "out")]


def narrower(store: "GraphStore", node_id: str) -> list[dict[str, Any]]:
    return [n for _e, n, _d in store.neighbors(node_id, [REL], "in")]


def _walk(store: "GraphStore", node_id: str, direction: str) -> list[dict[str, Any]]:
    """Geçişli kapanış (skos:broaderTransitive / narrowerTransitive), yakından uzağa; döngüye dayanıklı."""
    seen: dict[str, dict[str, Any]] = {}
    frontier = [node_id]
    for _ in range(MAX_DEPTH):
        nxt = []
        for items in store.neighbors_many(frontier, [REL], direction).values():
            for _e, n, _d in items:
                if n["id"] != node_id and n["id"] not in seen:
                    seen[n["id"]] = n
                    nxt.append(n["id"])
        if not nxt:
            break
        frontier = nxt
    return list(seen.values())


def ancestors(store: "GraphStore", node_id: str) -> list[dict[str, Any]]:
    return _walk(store, node_id, "out")


def descendants(store: "GraphStore", node_id: str) -> list[dict[str, Any]]:
    return _walk(store, node_id, "in")


def set_broader(store: "GraphStore", narrow_id: str, broad_id: str) -> dict[str, Any]:
    """`narrow` → `broad` kenarı (idempotent). Kendine ya da kendi alt kavramına bağlama reddedilir."""
    _concept(store, narrow_id)
    _concept(store, broad_id)
    if narrow_id == broad_id or any(n["id"] == narrow_id for n in ancestors(store, broad_id)):
        raise TaxonomyError("döngü: kavram kendi alt kavramının altına konamaz")
    return store.link(REL, narrow_id, broad_id)


def remove_broader(store: "GraphStore", narrow_id: str, broad_id: str) -> None:
    store.unlink(REL, narrow_id, broad_id)


def add_alt_label(store: "GraphStore", node_id: str, label: str) -> dict[str, Any]:
    n = _concept(store, node_id)
    key = normalize_key(label)
    if not key or key == n["key"]:
        raise TaxonomyError("eş anlamlı boş ya da kavramın kendi adı")
    owner = resolve(store, key)
    if owner is not None and owner["id"] != node_id:
        raise TaxonomyError(f"'{key}' zaten başka bir kavramın adı ya da eş anlamlısı")
    labels = list(n["props"].get("alt_labels") or [])
    if key in labels:
        return n
    return store.patch_node(node_id, {"alt_labels": [*labels, key]})


def resolve(store: "GraphStore", text: str) -> dict[str, Any] | None:
    """Ad (kanonik anahtar) ya da eş anlamlıdan kavram."""
    key = normalize_key(text)
    if not key:
        return None
    hit = store.find("Concept", key)
    if hit is not None:
        return hit
    with store._read() as conn:  # noqa: SLF001 - json_each ile liste öğesi araması (store'da düz değer süzgeci yok)
        row = conn.execute("SELECT nodes.id FROM nodes, json_each(nodes.props, '$.alt_labels') "
                           "WHERE nodes.type='Concept' AND json_each.value=? LIMIT 1", (key,)).fetchone()
    return store.get_node(row[0]) if row else None


def view(store: "GraphStore", node_id: str) -> dict[str, Any]:
    n = _concept(store, node_id)
    short = lambda x: {"id": x["id"], "key": x["key"], "label": x["label"]}  # noqa: E731
    return {"concept": short(n), "alt_labels": list(n["props"].get("alt_labels") or []),
            "broader": [short(x) for x in broader(store, node_id)],
            "narrower": [short(x) for x in narrower(store, node_id)],
            "ancestors": [short(x) for x in ancestors(store, node_id)]}


def build_router(studio: "Studio") -> APIRouter:
    from studio.clients.tracker import mcp_client  # noqa: PLC0415

    r = APIRouter(prefix="/api/taxonomy", tags=["taxonomy"])

    def _local(request: Request) -> None:
        if mcp_client(request):
            raise HTTPException(403, "Taksonomi yalnız stüdyonun kendi arayüzünden düzenlenir")

    def _run(fn: Any, *a: Any) -> Any:
        try:
            return fn(studio.store, *a)
        except (TaxonomyError, OntologyError) as exc:
            raise HTTPException(400, str(exc)) from None

    @r.get("/concepts/{node_id}")
    def get_concept(node_id: str) -> dict[str, Any]:
        return _run(view, node_id)

    @r.post("/broader")
    def post_broader(body: dict[str, str], request: Request) -> dict[str, Any]:
        _local(request)
        _run(set_broader, str(body.get("narrower", "")), str(body.get("broader", "")))
        return _run(view, str(body["narrower"]))

    @r.delete("/broader")
    def delete_broader(narrower_id: str, broader_id: str, request: Request) -> dict[str, Any]:
        _local(request)
        _run(remove_broader, narrower_id, broader_id)
        return {"ok": True}

    @r.post("/alt-labels")
    def post_alt_label(body: dict[str, str], request: Request) -> dict[str, Any]:
        _local(request)
        _run(add_alt_label, str(body.get("concept", "")), str(body.get("label", "")))
        return _run(view, str(body["concept"]))

    return r
