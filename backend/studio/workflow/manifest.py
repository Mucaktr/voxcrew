"""Koşu sürüm manifesti (Rehber AW-R26, §13.3).

Her koşu, sonucunu üreten sürümleri tek yerde kaydeder: `Run.manifest` (graf özelliği; iz görünümünde gösterilir).

- Koşu açılırken: `studio_version`, `workflow` (slug), `workflow_sha` (akış/tarif tanımının kanonik JSON sha256'sı =
  `recipe_version`), `spec_version` (kontrol noktası şema sürümü), `prompt_layout_version` (istem katman düzeninin
  özeti), `task_family`.
- Her ajan adımında, model turu gerçekten gönderilirken: bağlayıcı/model, kararlı istem öneki `prefix_hash`,
  kullanılan skill'lerin sha'ları ( USED_SKILL), MCP sunucu sürümü ve araç şeması özeti.
- `models`: koşuda kullanılan `bağlayıcı/model` listesi (sıralı, tekil).

- G4-REST: başlangıçta ayrıca `agents` (adımların ajanı → beyin/bağlantı/model/profil), `skills` (ajan → sabitlenmiş
  skill sha'ları), `limits` (ayar sınırları) ve `source` ("library": akış tanımı kütüphanedekiyle aynı) yazılır.
  Duraklatılmış, kesilmiş, başarısız ya da yeniden denenen koşu sürerken `current` aynı alanları bugünkü hâliyle
  hesaplar, `compare` farkları çıkarır. Önemli fark (beyin/model, akış sha'sı, skill sha'sı) devamdan önce kullanıcı
  onayı ister; diğerleri yalnız uyarıdır.

Manifest içerik taşımaz (istem, çıktı, girdi yok): yalnız kimlik, sürüm ve özet.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import asdict
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover
    from studio.workflow.engine import Engine, RunState, StepState

log = logging.getLogger("studio.workflow.manifest")

MANIFEST_VERSION = 1
MAX_STEPS = 200


def _sha(obj: Any) -> str:
    raw = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def task_family(slug: str | None, kind: str | None) -> str:
    """`metrics.service.task_family` ile aynı kural (iş akışı katmanı ölçüm modülünü içe aktarmaz)."""
    slug = str(slug or "")
    if slug.startswith("recipe-"):
        return f"recipe:{slug[len('recipe-'):]}"
    if slug == "gorev" or kind == "task":
        return "gorev"
    return f"workflow:{slug or 'unknown'}"


def prompt_layout_version() -> str:
    from studio.workflow import prompting  # noqa: PLC0415
    layout = {"layers": dict(sorted(prompting.SECTION_LAYERS.items())), "key": prompting.LAYOUT_KEY,
              "stable": prompting.LAYER_STABLE, "run": prompting.LAYER_RUN, "volatile": prompting.LAYER_VOLATILE}
    return _sha(layout)[:12]


def base(run: "RunState") -> dict[str, Any]:
    from studio import __version__  # noqa: PLC0415
    from studio.workflow import checkpoint as ckpt  # noqa: PLC0415
    spec = asdict(run.spec)
    return {"version": MANIFEST_VERSION, "studio_version": str(__version__), "workflow": run.spec.slug,
            "workflow_sha": _sha(spec)[:16], "spec_version": ckpt.VERSION,
            "prompt_layout_version": prompt_layout_version(),
            "task_family": task_family(run.spec.slug, run.kind), "models": [], "steps": {}}


def _tool_versions(engine: "Engine", agent: dict[str, Any]) -> dict[str, Any]:
    try:
        from studio.tools.bridge import get_bridge  # noqa: PLC0415
        bridge = get_bridge(engine.settings)
        servers = list(bridge.policy_for(agent).servers)
    except Exception:  # noqa: BLE001 - araç köprüsü yoksa sürüm yok
        return {}
    out: dict[str, Any] = {}
    for sid in sorted(servers)[:20]:
        entry = (getattr(bridge, "cache", {}) or {}).get(sid) or {}
        info = entry.get("server_info") if isinstance(entry.get("server_info"), dict) else {}
        tools = entry.get("tools") or []
        out[sid] = {"version": str(info.get("version") or "") or None,
                    "protocol": entry.get("protocol_version") or None,
                    "schema_sha": _sha([[t.get("name"), t.get("inputSchema")] for t in tools
                                        if isinstance(t, dict)])[:12] if tools else None}
    return out


def note_step(engine: "Engine", run: "RunState", st: "StepState", pctx: Any, route: Any,
              agent: dict[str, Any] | None = None) -> None:
    """Model turu gönderilirken adımın sürümlerini manifeste ekler ve `Run.manifest`i yazar. Hata koşuyu bozmaz."""
    try:
        man = run.manifest or base(run)
        layout = (getattr(pctx, "extra", None) or {}).get("prompt_layout") or {}
        conn = getattr(route, "connector", None)
        model = getattr(route, "model", None)
        entry = {"connector": conn, "connection": getattr(route, "connection", None), "model": model,
                 "prefix_hash": layout.get("prefix_hash"), "attempt": st.attempt,
                 "skills": [{"key": s.get("key"), "sha": s.get("sha")} for s in (st.skills_used or [])][:20],
                 "tools": _tool_versions(engine, agent or {})}
        steps = dict(man.get("steps") or {})
        if st.spec.id in steps or len(steps) < MAX_STEPS:
            steps[st.spec.id] = entry
        label = f"{conn or '?'}/{model or 'default'}"
        man = {**man, "steps": steps, "models": sorted({*(man.get("models") or []), label})}
        run.manifest = man
        if run.node_id:
            engine.store.patch_node(run.node_id, {"manifest": man})
    except Exception as exc:  # noqa: BLE001
        log.warning("koşu manifesti yazılamadı: %s", exc)


AGENT_KEYS = ("runtime", "connection", "model", "profile", "permissions", "persona")
# ajan alanlarından onay İSTEMEYEN (yalnız uyarı) olanlar; persona metin olarak değil özetiyle (sha16) tutulur
AGENT_NON_MATERIAL = frozenset({"persona"})
LIMIT_KEYS = ("step_tokens", "run_deadline_min", "default_budget", "daily_budget")
MAX_AGENTS = 50
MAX_CHANGES = 60
# Önemli (onay isteyen) alanlar: beyin/model, akış tanımı sha'sı, sabitlenmiş skill sha'sı
MATERIAL_FIELDS = frozenset({"workflow_sha", "agent", "skill"})


def _agent_slugs(run: "RunState") -> list[str]:
    out: list[str] = []
    for s in run.spec.steps:
        if s.agent and s.agent not in out:
            out.append(s.agent)
    return out[:MAX_AGENTS]


def agents_of(engine: "Engine", slugs: list[str]) -> dict[str, Any]:
    """Ajanın yapılandırılmış beyni: çalışma zamanı, bağlantı, model, Hermes profili. Yoksa `{"missing": True}`."""
    out: dict[str, Any] = {}
    for slug in slugs:
        try:
            node = engine.agents.node(slug)
        except Exception:  # noqa: BLE001
            node = None
        if not node:
            out[slug] = {"missing": True}
            continue
        p = node.get("props") or {}
        out[slug] = {"runtime": p.get("runtime") or None, "connection": p.get("connection") or None,
                     "model": p.get("model") or None, "profile": p.get("hermes_profile") or None,
                     "permissions": p.get("permissions") or None,  # yetki (önemli)
                     "persona": _sha(str(p.get("persona") or ""))[:16] if p.get("persona") else None}
    return out


def skill_pins(engine: "Engine", slugs: list[str]) -> dict[str, dict[str, str]]:
    """Ajan → {skill anahtarı: sabitlenmiş sha (16)} (G1-D bağlama kaydı; `never` hariç). Kayıt yoksa boş."""
    try:
        from studio.workflow import prompting  # noqa: PLC0415
        stage = prompting._STAGES.get("skills")
        store = getattr(getattr(stage, "library", None), "bindings", None)
        if store is None or not store.active:
            return {}
        out: dict[str, dict[str, str]] = {}
        for slug in slugs:
            pins = {str(k): str(v.get("sha"))[:16] for k, v in store.agent(slug).items()
                    if v.get("sha") and v.get("mode") != "never"}
            if pins:
                out[slug] = dict(sorted(pins.items())[:40])
        return out
    except Exception as exc:  # noqa: BLE001 - skill kaydı okunamazsa manifest yine yazılır
        log.debug("skill sabitleri okunamadı: %s", exc)
        return {}


def limits_of(engine: "Engine") -> dict[str, Any]:
    settings = getattr(engine, "settings", None)
    out: dict[str, Any] = {}
    for k in LIMIT_KEYS:
        try:
            out[k] = settings.get(f"limits.{k}") if settings is not None else None
        except Exception:  # noqa: BLE001
            out[k] = None
    return json.loads(json.dumps(out, default=str))


def library_sha(engine: "Engine", run: "RunState") -> str | None:
    """Akışın kütüphanedeki BUGÜNKÜ tanımının sha'sı (koşu açılışıyla aynı kural: rol → ajan çözülür)."""
    lib = getattr(engine, "workflow_library", None)
    slug = run.spec.slug
    if lib is None or not slug or run.kind != "workflow":
        return None
    try:
        if not lib.exists(slug):
            return None
        spec = lib.get(slug)
    except Exception:  # noqa: BLE001 - bozuk/silinmiş tanım: karşılaştırılamaz
        return None
    for st in spec.steps:
        if st.role and not st.agent:
            try:
                st.agent = engine.resolve_role(st.role)
            except Exception:  # noqa: BLE001
                st.agent = None
    return _sha(asdict(spec))[:16]


def start(engine: "Engine", run: "RunState") -> dict[str, Any]:
    man = base(run)
    try:
        slugs = _agent_slugs(run)
        man["agents"] = agents_of(engine, slugs)
        man["skills"] = skill_pins(engine, slugs)
        man["limits"] = limits_of(engine)
        lib = library_sha(engine, run)
        man["source"] = "library" if lib is not None and lib == man["workflow_sha"] else None
    except Exception as exc:  # noqa: BLE001 - ek alanlar yazılamazsa çekirdek manifest kalır
        log.warning("manifest ek alanları yazılamadı: %s", exc)
    run.manifest = man
    return run.manifest


def current(engine: "Engine", run: "RunState") -> dict[str, Any]:
    """Kayıtlı manifestle aynı alanların bugünkü hâli (devamda karşılaştırma için; adım ayrıntısı yok)."""
    from studio import __version__  # noqa: PLC0415
    from studio.workflow import checkpoint as ckpt  # noqa: PLC0415
    old = run.manifest or {}
    slugs = list((old.get("agents") or {}).keys()) or _agent_slugs(run)
    out: dict[str, Any] = {"studio_version": str(__version__), "spec_version": ckpt.VERSION,
                           "prompt_layout_version": prompt_layout_version(),
                           "workflow_sha": old.get("workflow_sha")}
    if old.get("source") == "library":
        lib = library_sha(engine, run)
        out["workflow_sha"] = lib if lib is not None else "deleted"
    out["agents"] = agents_of(engine, slugs)
    out["skills"] = skill_pins(engine, slugs)
    out["limits"] = limits_of(engine)
    return out


def compare(old: dict[str, Any] | None, new: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Kayıtlı (başlangıç) ve bugünkü manifest arasındaki farklar: `{field, key?, attr?, from, to, material}`.
    Eski manifestte olmayan alan karşılaştırılmaz (G4-REST öncesi koşular yalnız sürüm alanlarıyla)."""
    old, new = old or {}, new or {}
    out: list[dict[str, Any]] = []

    def add(field_: str, a: Any, b: Any, **kw: Any) -> None:
        material = field_ in MATERIAL_FIELDS and not (field_ == "agent" and kw.get("attr") in AGENT_NON_MATERIAL)
        out.append({"field": field_, **kw, "from": a, "to": b, "material": material})

    for k in ("studio_version", "prompt_layout_version", "spec_version", "workflow_sha"):
        if k in old and old.get(k) != new.get(k):
            add(k, old.get(k), new.get(k))
    if isinstance(old.get("agents"), dict):
        cur = new.get("agents") or {}
        for slug, a in old["agents"].items():
            a = a or {}
            b = cur.get(slug) or {"missing": True}
            if a.get("missing") or b.get("missing"):
                if bool(a.get("missing")) != bool(b.get("missing")):
                    add("agent", "missing" if a.get("missing") else "present",
                        "missing" if b.get("missing") else "present", key=slug, attr="agent")
                continue
            for attr in AGENT_KEYS:
                if attr in AGENT_NON_MATERIAL | {"permissions"} and attr not in a:
                    continue  # öncesi manifest bu alanı kaydetmedi: fark sayılmaz
                if a.get(attr) != b.get(attr):
                    add("agent", a.get(attr), b.get(attr), key=slug, attr=attr)
    if isinstance(old.get("skills"), dict):
        cur_sk = new.get("skills") or {}
        for slug in sorted(set(old["skills"]) | set(cur_sk)):
            a, b = old["skills"].get(slug) or {}, cur_sk.get(slug) or {}
            for key in sorted(set(a) | set(b)):
                if a.get(key) != b.get(key):
                    add("skill", a.get(key), b.get(key), key=f"{slug}/{key}", attr=key)
    if isinstance(old.get("limits"), dict):
        cur_l = new.get("limits") or {}
        for k in LIMIT_KEYS:
            if k in old["limits"] and old["limits"].get(k) != cur_l.get(k):
                add("limits", old["limits"].get(k), cur_l.get(k), key=k)
    return out[:MAX_CHANGES]


def signature(changes: list[dict[str, Any]]) -> str:
    """Önemli farkların özeti: aynı farklar bir kez onaylanınca sonraki devamda yeniden sorulmaz."""
    mat = [{k: c.get(k) for k in ("field", "key", "attr", "from", "to")} for c in changes if c.get("material")]
    return _sha(mat)[:16]


_NAMES = {"tr": {"studio_version": "uygulama sürümü", "prompt_layout_version": "istem düzeni",
                 "spec_version": "kontrol noktası şeması", "workflow_sha": "iş akışı tanımı", "agent": "ajan",
                 "skill": "skill", "limits": "sınır"},
          "en": {"studio_version": "studio version", "prompt_layout_version": "prompt layout",
                 "spec_version": "checkpoint schema", "workflow_sha": "workflow definition", "agent": "agent",
                 "skill": "skill", "limits": "limit"}}


def describe(changes: list[dict[str, Any]], lang: str = "tr") -> str:
    """Tek satırlık insan okunur özet (kart iletisi için; içerik yok, yalnız alan ve sürüm)."""
    names = _NAMES.get(lang, _NAMES["tr"])
    bits: list[str] = []
    for c in changes[:12]:
        label = names.get(c["field"], c["field"])
        if c.get("key"):
            label += f" {c['key']}"
            if c.get("attr") and c["field"] == "agent":
                label += f".{c['attr']}"
        a = "—" if c.get("from") in (None, "") else str(c.get("from"))[:24]
        b = "—" if c.get("to") in (None, "") else str(c.get("to"))[:24]
        bits.append(f"{label}: {a} → {b}")
    if len(changes) > len(bits):
        bits.append(f"+{len(changes) - len(bits)}")
    return "; ".join(bits)


def diff(old: dict[str, Any] | None, new: dict[str, Any] | None) -> list[str]:
    """Devamda bilgi için: koşu düzeyi sürüm alanlarından değişenler."""
    keys = ("studio_version", "workflow_sha", "spec_version", "prompt_layout_version")
    return [k for k in keys if (old or {}).get(k) != (new or {}).get(k)]
