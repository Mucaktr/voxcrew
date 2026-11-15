"""değerlendirme geçicilerini okuma görünümlerinden ayıklama.

Klasik değerlendirme, değerlendirme matrisi ve booster kabul kapısı
 denemelerini geçici, gizli ajanlarla ve `eval:<id>` kökenli
koşularla yürütür; iş bitince silinir. Silinene dek bunlar MCP'nin ajan listesine (`/api/agents`, `/api/overview`) ve
bellek grafı arayüzüne (`/api/graph`) çıkmamalıdır.

tanıma YALNIZ iç işarete bakar — ad, slug, başlık, karma ya da ad alanı ÖNEKİNE asla bakılmaz (kullanıcının
`eval-2026-1021` adlı ajanı, `[eval]` başlıklı görevi ya da `eval-gate_…` adlı projesi görünür kalır). İşaretler yalnız iç
koddan yazılır, olağan API'ler yazamaz:

- ajan: `eval_matrix` (matris/kapı kimliği) ya da `eval_temp` (klasik değerlendirme kimliği);
- koşu: `origin` `eval:` ile başlar (API ile verilemez);
- adım: işaretli koşunun ya da işaretli ajanın adımı; görev: işaretli koşunun yürüttüğü (`EXECUTES`) ya da işaretli
  ajana atanmış (`ASSIGNED_TO`) görev; iş akışı: YALNIZ işaretli koşularca yürütülen;
- bilgi: `eval_matrix` ya da `eval_temp` işaretli tohum bilgi;
- koşu listesi (`/api/runs`): MCP `eval:` kökenli koşuları görmez.
Kabul edilen sınır: işaretten önceki sürümle oluşmuş işaretsiz kalıntılar görünür (kullanıcı silebilir/unutabilir).
"""

from __future__ import annotations

from typing import Any

EVAL_ORIGIN = "eval:"
MARKERS = ("eval_matrix", "eval_temp")


def _props(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        return {}
    p = item.get("props")
    return p if isinstance(p, dict) else item


def is_temp_agent(agent: Any) -> bool:
    """İç işaretli geçici ajan (düğüm ya da serileştirilmiş ajan). Slug/ad metni tek başına ASLA geçici sayılmaz."""
    p = _props(agent)
    return any(bool(p.get(k)) for k in MARKERS)


def is_eval_origin(origin: Any) -> bool:
    return str(origin or "").startswith(EVAL_ORIGIN)


def runs(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Koşu özetleri → `eval:` kökenli (değerlendirme, matris, kapı; süren dahil) koşular olmadan."""
    return [r for r in items if not is_eval_origin(r.get("origin"))]


def is_temp_fact(p: dict[str, Any]) -> bool:
    """iç işaretli (`eval_matrix`, `eval_temp`) tohum bilgi. Karma önekine ve ad alanı adına
    bakılmaz: `eval-…` adlı kullanıcı projesinin bilgileri görünür kalır."""
    return any(bool(p.get(k)) for k in MARKERS)


def agents(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ajan listesi (serileştirilmiş) → iç işaretli geçici değerlendirme ajanları olmadan."""
    return [a for a in items if not is_temp_agent(a)]


def graph(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Graf dökümü → değerlendirme geçicileri (işaretli ajan, `eval:` kökenli koşu, onların adım/görevleri, yalnız
    onlarca yürütülen iş akışı, işaretli tohum bilgi) ve kenarları olmadan."""
    drop: set[str] = set()
    run_ids: set[str] = set()
    temp_slugs: set[str] = set()
    for n in nodes:
        p = n.get("props") or {}
        t = n.get("type")
        if t == "Agent" and is_temp_agent(p):
            drop.add(n["id"])
            temp_slugs.add(str(p.get("slug") or ""))
        elif t == "Run" and is_eval_origin(p.get("origin")):
            drop.add(n["id"])
            run_ids.add(str(p.get("id") or ""))
        elif t == "Fact" and is_temp_fact(p):
            drop.add(n["id"])
    temp_slugs.discard("")
    run_ids.discard("")
    for n in nodes:
        p = n.get("props") or {}
        if n.get("type") == "Step" and (str(p.get("run_id") or "") in run_ids or str(p.get("agent") or "") in temp_slugs):
            drop.add(n["id"])
    types = {n["id"]: n.get("type") for n in nodes}
    executes: dict[str, list[str]] = {}
    for e in edges:
        src, dst = e.get("src"), e.get("dst")
        if types.get(dst) == "Task" and types.get(src) == "Run" and src in drop:
            drop.add(dst)  # işaretli koşunun yürüttüğü görev
        if types.get(src) == "Task" and dst in drop and types.get(dst) == "Agent":
            drop.add(src)  # işaretli geçici ajana atanmış görev (başlığı ne olursa olsun)
        if types.get(dst) == "Workflow" and types.get(src) == "Run":
            executes.setdefault(dst, []).append(src)
    for wf, srcs in executes.items():  # yalnız işaretli koşularca yürütülen iş akışı
        if srcs and all(s in drop for s in srcs):
            drop.add(wf)
    if not drop:
        return nodes, edges
    return ([n for n in nodes if n["id"] not in drop],
            [e for e in edges if e.get("src") not in drop and e.get("dst") not in drop])
