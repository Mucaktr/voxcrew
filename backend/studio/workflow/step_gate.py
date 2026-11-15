""" (AW-R23, AUDIT P2): adım başı insan onayı ve `USED_SKILL` iz kenarı.

Ajan adımı `approval:` alanı (spec.py):
- `before`: istem kurulduktan sonra, **model çağrısından ve bütçe rezervasyonundan önce** kart açılır. Kart gönderilecek
  istemi (ve sistem istemini) gösterir. Ret → adım `rejected`, koşu var olan ret yolunu izler (bağımlılar atlanır,
  koşu `failed`). Aynı istem bu adımda zaten onaylandıysa (geçici hata sonrası yeniden deneme) yeniden sorulmaz;
  istem değişirse (revize turu, devamda yeni bağlam) yeniden sorulur.
- `after`: model çıktısı **tutulur**: adım `done` olmaz (bağımlılar başlamaz, bellek yazılmaz), kaynak kilidi ve
  rezervasyon bırakılır, kart çıktıyı gösterir. Onay → `done` (+ bellek); ret → `rejected`. Kart beklenirken
  duraklatılırsa çıktı korunur (`resume_ask = "after"`): devamda model yeniden çağrılmaz, aynı kart yeniden açılır.
- Güvenli modun "her adım onay istesin" maddesi (`runs.approve_every_step`) her ajan adımını `before` yapar.
- Gizli `system:` koşuları hiçbir zaman sormaz. Kararı yalnız kullanıcı verir: MCP istemcisi bu kartı onaylayamaz
  (`api.py` karar ucu), başlıksız istek kullanıcı varlığı kapısında düşer. Duraklatılmış / iptal edilmiş koşuda karar
  var olan kurallarla ( "önce sürdür", iptal kazanır) reddedilir.

`USED_SKILL {sha, how}`: istem aşaması (`skills/stage.py`) isteme giren her skill'i `used` olarak raporlar; motor,
model çağrısı yapılacağı kesinleşince Step → Skill kenarını yazar. how: `always` (gövde her adımda) · `catalog`
(yalnız katalog satırı) · `selected` (catalog gövdesini seçici yükledi). sha = sabitlenmiş anlık görüntü (göçten önceki
eski davranışta `None`).

HERMES-SKILL-EDGE: Hermes beyni profildeki skill'leri isteme değil `hermes chat -s` bayrağına koyar; bu yol yukarıdaki
istem raporunda görünmez. Bağlayıcının `meta.invocation`ı (`transport: cli`, `skill_refs`) geldiğinde motor
`link_flag_skills` ile aynı kenarı yazar: how = `hermes_flag`, sha = Hermes'in okuyacağı canlı içeriğin özeti (sabitleme
ile aynı algoritma), `pinned_sha` + `binding` = bağlama kaydında bu ajan/anahtar için ne varsa (yoksa None), `run_id`,
`step_id`, `attempt`. Hermes hangi skill'i yüklediğini bildirmez: kenar `status: offered` ile yazılır; ajan skill'i
`skill_view` aracıyla açtıysa (bağlayıcının `skills_reported`ı) `status: used` olur. İstem yolundaki kenarlar
(always/selected = gövde isteme girdi) `status` taşımaz ve `used` sayılır; `catalog` yalnız sunulmuştur.

araç döngülü beyinlerde model `studio__skill_load(key)` ile bağlı bir skill'in sabitlenmiş gövdesini yüklerse
bağlayıcı `invocation.skills_loaded` bildirir; `link_tool_skills` aynı kenarı how = `tool`, `status: used`, sha =
yüklenen sabit sürüm, `binding` + `pinned_sha` (Hermes yolundaki gibi), `prompt_how` = aynı adımda istem yolunun
biçimi (çoğunlukla `catalog`) ile yazar.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from studio.workflow.spec import StepSpec

if TYPE_CHECKING:  # pragma: no cover
    from studio.workflow.engine import Engine, RunState, StepState
    from studio.workflow.prompting import PromptContext

log = logging.getLogger("studio.workflow.step_gate")

PREVIEW = 6000          # kartta gösterilen istem / çıktı (karakter); tamamı adımın bağlam görünümünde
SYSTEM_PREVIEW = 2000
SETTING = "runs.approve_every_step"  # güvenli mod maddesi `approve_every_step`
CARD_KIND = "gate"


def wants(engine: "Engine", run: "RunState", st: "StepState", phase: str) -> bool:
    """Bu adım `phase` (before | after) onayı istiyor mu."""
    if run.hidden or st.spec.type != "agent":
        return False
    if st.spec.approval == phase:
        return True
    if phase != "before":
        return False
    try:
        return engine.settings.get(SETTING, False) is True
    except Exception:  # noqa: BLE001 - ayar okunamazsa güvenli taraf: sor
        return True


def _digest(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8", "replace")).hexdigest()


ROUTE_KEYS = ("connector", "connection", "model", "provider", "profile", "endpoint_label")


def _policy_view(engine: "Engine", route: dict[str, Any]) -> dict[str, Any]:
    """Rotanın model erişim politikası kararı (uzak mı, izinli mi, hangi sağlayıcı/uç). Okunamazsa bilinmiyor."""
    from types import SimpleNamespace  # noqa: PLC0415

    try:
        from studio.connections.policy import check_route  # noqa: PLC0415

        d = check_route(engine.settings, SimpleNamespace(**{k: route.get(k) for k in ROUTE_KEYS}), check_consent=False)
        return {"allowed": d.allowed, "remote": d.remote, "provider": d.provider, "host": d.host, "ref": d.ref}
    except Exception:  # noqa: BLE001
        return {"unknown": True}


def binding(engine: "Engine", st: "StepState", system: str) -> tuple[str, dict[str, Any]]:
    """`before` onayı istemin YANINDA rotaya bağlıdır: bağlayıcı, bağlantı, model, sağlayıcı/profil/uç, sistem
    istemi ve politika kararı. Bunlardan biri değişirse (ör. on_fail kartında `route:` seçimi) özet değişir → yeniden
    sorulur; başka bir beyne giden istem, onaylanan rotanın onayını taşımaz."""
    route = {k: (st.route or {}).get(k) for k in ROUTE_KEYS}
    policy = _policy_view(engine, route)
    raw = json.dumps({"prompt": st.prompt or "", "system": system or "", "route": route, "policy": policy},
                     ensure_ascii=False, sort_keys=True, default=str)
    return _digest(raw), {"route": route, "policy": policy}


def _shift_start(st: "StepState", waited_s: float) -> None:
    """İnsan bekleyişi adımın süresine (dakika bütçesi) yazılmaz: başlangıç bekleme kadar ileri alınır."""
    if not st.started_at or waited_s <= 0:
        return
    try:
        st.started_at = (datetime.fromisoformat(st.started_at) + timedelta(seconds=waited_s)).isoformat(timespec="seconds")
    except ValueError:
        pass


async def _card(engine: "Engine", run: "RunState", st: "StepState", phase: str, info: dict[str, Any],
                message: str) -> bool:
    """Adımın açık onay kartını (yoksa yenisini) açar ve kararı bekler. Dönüş: onaylandı mı."""
    from studio.workflow.engine import StepState as _StepState  # döngüsel içe aktarma

    title = (st.spec.title or st.spec.id)[:60]

    def build(n: int) -> "StepState":
        # kart kimliği deneme başına eşsiz; yeniden açılan adımda eski kimliğe verilen (bayat) karar yeni
        # kartı karara bağlayamaz. İlk denemede eski biçim (`a.onay-1`) korunur.
        attempt = int(getattr(st, "attempt", 0) or 0)
        cid = f"{st.spec.id}.onay-{n}" if attempt <= 1 else f"{st.spec.id}.onay-{attempt}.{n}"
        aspec = StepSpec(id=cid, type="approval",
                         title=engine._t(run, "Adım onayı · {}", title), message=message)
        return _StepState(aspec, parent=st.spec.id, level=st.level + 1, kind=CARD_KIND, ask=info)

    card = engine._card(run, st, CARD_KIND, build)
    card.ask, card.spec.message = info, message  # yeniden açılan kart güncel istemi / çıktıyı gösterir
    st.gate = {"phase": phase, "outcome": "pending", "card": card.spec.id,
               **({"digest": info["digest"]} if info.get("digest") else {})}
    engine._persist_step(run, st)
    engine._agent_state(st.spec.agent, "waiting_turn", "Onay bekliyor…", run.id, st.spec.id)
    t0 = time.monotonic()
    await engine._approval(run, card)
    _shift_start(st, time.monotonic() - t0)
    approved = card.status == "done"
    cancelled = getattr(run, "cancel_requested_at", None) is not None or card.status == "cancelled"
    # iptalle yarışan kararda sonuç "rejected" değil "cancelled"; onay iptali geçmez (model çağrılmaz)
    outcome = "cancelled" if cancelled else ("approved" if approved else "rejected")
    st.gate = {**st.gate, "outcome": outcome,
               "note": (card.output or "")[:300] if card.output not in ("Onaylandı", "Reddedildi") else None}
    engine._emit(run, "step.gate", step=st.spec.id, phase=phase, outcome=st.gate["outcome"], card=card.spec.id)
    if cancelled:
        engine._persist_step(run, st)
        engine._fence_check(run, "step_gate", st.spec.id)  # iptal: motorun olağan iptal yolu (CancelledError)
        return False
    return approved


async def before(engine: "Engine", run: "RunState", st: "StepState", pctx: "PromptContext") -> bool:
    """Model çağrısı ve rezervasyon öncesi kapı. Dönüş: adım sürsün mü (False → adım `rejected` bitti)."""
    if not wants(engine, run, st, "before"):
        return True
    system = ""
    try:
        system = pctx.render_system()
    except Exception:  # noqa: BLE001 - önizleme yalnız kolaylık
        system = ""
    digest, bound = binding(engine, st, system)
    g = st.gate or {}
    if g.get("phase") == "before" and g.get("outcome") == "approved" and g.get("digest") == digest:
        return True  # aynı istem + aynı rota bu adımda zaten onaylandı (geçici hata sonrası yeniden deneme)
    route = st.route or {}
    info = {"kind": "step_approval", "phase": "before", "step": st.spec.id, "agent": st.spec.agent,
            "route": route.get("label"), "connector": route.get("connector"), "model": st.model,
            "attempt": st.attempt, "chars": len(st.prompt), "prompt": st.prompt[:PREVIEW],
            "prompt_truncated": len(st.prompt) > PREVIEW, "system": system[:SYSTEM_PREVIEW] or None,
            "skills": [u.get("key") for u in used_skills(pctx)], "digest": digest, "choices": ["approve", "reject"],
            "connection": bound["route"].get("connection"), "provider": bound["route"].get("provider"),
            "remote": bound["policy"].get("remote")}
    title = (st.spec.title or st.spec.id)[:60]
    message = engine._t(run, "'{}' adımı çalışmadan önce onayını bekliyor: model çağrılmadı, bütçe ayrılmadı. "
                             "Gönderilecek istemi incele — onayla / reddet?", title)
    if await _card(engine, run, st, "before", info, message):
        return True
    engine._finish_step(run, st, "rejected", error=engine._t(run, "Kullanıcı adımı çalışmadan önce reddetti"),
                        cause="gate.rejected_before")
    engine._agent_state(st.spec.agent, "idle", "", None, None)
    return False


def hold(engine: "Engine", run: "RunState", st: "StepState") -> bool:
    """`_consume` başarılı bitişte çağırır: `after` ise çıktı tutulur (adım bitmez). Dönüş: tutuldu mu."""
    if not wants(engine, run, st, "after"):
        return False
    st.resume_ask = "after"
    engine._persist_step(run, st)
    engine._checkpoint(run)
    return True


async def after(engine: "Engine", run: "RunState", st: "StepState", agent: dict[str, Any]) -> None:
    """Tutulan çıktının kartı (kaynak kilidi ve rezervasyon bırakıldıktan sonra). Onay → `done` (+ bellek)."""
    title = (st.spec.title or st.spec.id)[:60]
    info = {"kind": "step_approval", "phase": "after", "step": st.spec.id, "agent": st.spec.agent,
            "route": (st.route or {}).get("label"), "model": st.model, "attempt": st.attempt,
            "chars": len(st.output), "output": st.output[:PREVIEW], "output_truncated": len(st.output) > PREVIEW,
            "artifacts": [a.get("name") for a in st.artifacts][:20], "choices": ["approve", "reject"]}
    message = engine._t(run, "'{}' adımının çıktısı onayını bekliyor; onaylanmadan sonraki adımlar başlamaz. "
                             "Onayla / reddet?", title)
    approved = await _card(engine, run, st, "after", info, message)
    st.resume_ask = None
    if not approved:
        engine._finish_step(run, st, "rejected", error=engine._t(run, "Kullanıcı adımın çıktısını reddetti"),
                            cause="review.rejected")
        engine._agent_state(st.spec.agent, "idle", "", None, None)
        return
    engine._finish_step(run, st, "done", error=st.error)
    if st.status == "done" and st.spec.remember and agent.get("memory_enabled", True) and st.output.strip():
        engine._background(engine._consolidate(run, st, agent))


def resume_held(st: "StepState") -> bool:
    """Devam: `after` kartı beklenirken duraklatılan adımın çıktısı korunmuş mu (model yeniden çağrılmaz)."""
    return st.resume_ask == "after" and bool((st.output or "").strip())


def reopen(st: "StepState") -> None:
    """Bilinçli yeniden açma (`retry_step` / `resume(from_step)`): eski onay ve tutulan çıktı geçersiz."""
    st.gate = None
    if st.resume_ask == "after":
        st.resume_ask = None


# ------------------------------------------------------------------ USED_SKILL
def used_skills(pctx: "PromptContext") -> list[dict[str, Any]]:
    for r in reversed(pctx.report or []):
        if r.get("stage") == "skills" and isinstance(r.get("used"), list):
            return [u for u in r["used"] if isinstance(u, dict) and u.get("key")]
    return []


def link_skills(engine: "Engine", run: "RunState", st: "StepState", pctx: "PromptContext") -> None:
    """Step -USED_SKILL{sha, how}-> Skill kenarları (model çağrısı yapılacağı kesinleşince). Hata koşuyu bozmaz."""
    used = used_skills(pctx)
    st.skills_used = [{"key": u["key"], "sha": u.get("sha"), "how": u.get("how")} for u in used]
    if not st.node_id:
        return
    try:  # önceki denemelerin kenarları kalkar; soğuk okuma yalnız bu denemeyi gösterir
        engine.store.unlink("USED_SKILL", st.node_id)
    except Exception:  # noqa: BLE001
        log.warning("eski USED_SKILL kenarları kaldırılamadı: %s", st.spec.id)
    for u in used:
        try:
            node = engine.store.find("Skill", str(u["key"])) or engine.store.upsert_node("Skill", {"name": str(u["key"])})
            engine.store.link("USED_SKILL", st.node_id, node["id"],
                              {"sha": u.get("sha"), "how": u.get("how"), "attempt": st.attempt, "run_id": run.id})
        except Exception as exc:  # noqa: BLE001 - iz kenarı yazılamazsa adım sürer
            log.warning("USED_SKILL yazılamadı (%s): %s", u.get("key"), exc)


FLAG_HOW = "hermes_flag"
FLAG_STATUS = ("offered", "used")
_SHA_LEN = 64


def _sha_or_none(v: Any) -> str | None:
    v = v if isinstance(v, str) else None
    return v if v and len(v) == _SHA_LEN and all(c in "0123456789abcdef" for c in v) else None


def _binding_for(slug: str | None, key: str) -> tuple[str | None, str | None]:
    """Bağlama kaydında (G1-D) bu ajan + anahtar için (mod, sabitlenmiş sha). Kayıt yok / etkin değil → (None, None)."""
    if not slug:
        return None, None
    try:
        from studio.workflow import prompting  # noqa: PLC0415 - döngüsel içe aktarmayı önler

        stage = next((x for x in prompting.stages() if getattr(x, "name", None) == "skills"), None)
        store = getattr(getattr(stage, "library", None), "bindings", None)
        if store is None or not store.active:
            return None, None
        b = store.binding(slug, key) or {}
        mode = b.get("mode") if isinstance(b.get("mode"), str) else None
        return mode, _sha_or_none(b.get("sha"))
    except Exception:  # noqa: BLE001 - bağlama okunamazsa kenar yine yazılır (binding bilinmiyor)
        return None, None


def flag_skill_uses(invocation: dict[str, Any] | None, slug: str | None) -> list[dict[str, Any]]:
    """Bağlayıcı `invocation`ı → -s ile gerçekten gönderilen skill'lerin USED_SKILL kayıtları (CLI değilse [])."""
    inv = invocation or {}
    refs = inv.get("skill_refs")
    if inv.get("transport") != "cli" or not isinstance(refs, list):
        return []
    sent = {str(x) for x in inv.get("skills") or [] if isinstance(x, str)}
    reported = {str(x) for x in inv.get("skills_reported") or [] if isinstance(x, str)}
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for r in refs[:40]:
        if not isinstance(r, dict):
            continue
        key = str(r.get("key") or "").strip()[:200]
        load = str(r.get("load_name") or key).strip()[:200]
        if not key or key in seen or (sent and load not in sent):
            continue  # yalnız argv'ye gerçekten giren adlar
        seen.add(key)
        mode, pinned = _binding_for(slug, key)
        out.append({"key": key, "sha": _sha_or_none(r.get("sha")), "how": FLAG_HOW,
                    "status": "used" if load in reported else "offered", "load_name": load,
                    "binding": mode, "pinned_sha": pinned})
    return out


def link_flag_skills(engine: "Engine", run: "RunState", st: "StepState") -> None:
    """HERMES-SKILL-EDGE: `hermes -s` ile gönderilen skill'ler → Step -USED_SKILL-> Skill (meta olayında; idempotent).

    İstem yolundaki kenarlara (link_skills) dokunmaz; aynı denemede yeniden çağrılırsa (ör. sonda `skills_reported`)
    kenar özellikleri birleşir ve `offered` → `used` yükselir. Hata koşuyu bozmaz."""
    try:
        uses = flag_skill_uses(st.invocation, st.spec.agent)
    except Exception as exc:  # noqa: BLE001
        log.warning("Hermes skill izi çözülemedi (%s): %s", st.spec.id, exc)
        return
    if not uses:
        return
    keys = {u["key"] for u in uses}
    st.skills_used = [u for u in (st.skills_used or []) if not (u.get("how") == FLAG_HOW and u.get("key") in keys)]
    st.skills_used += [{k: u[k] for k in ("key", "sha", "how", "status", "binding", "pinned_sha")} for u in uses]
    _manifest_skills(engine, run, st)
    if not st.node_id:
        return
    for u in uses:
        try:
            node = engine.store.find("Skill", u["key"]) or engine.store.upsert_node("Skill", {"name": u["key"]})
            engine.store.link("USED_SKILL", st.node_id, node["id"],
                              {"sha": u["sha"], "how": FLAG_HOW, "status": u["status"], "binding": u["binding"],
                               "pinned_sha": u["pinned_sha"], "load_name": u["load_name"], "attempt": st.attempt,
                               "run_id": run.id, "step_id": st.spec.id})
        except Exception as exc:  # noqa: BLE001 - iz kenarı yazılamazsa adım sürer
            log.warning("USED_SKILL (hermes -s) yazılamadı (%s): %s", u.get("key"), exc)


TOOL_HOW = "tool"  # `studio__skill_load` aracıyla yüklenen gövde (tools/builtin_skill.py)


def tool_skill_uses(invocation: dict[str, Any] | None, slug: str | None) -> list[dict[str, Any]]:
    """Bağlayıcı `invocation.skills_loaded` → araçla gerçekten yüklenen skill'lerin USED_SKILL kayıtları."""
    raw = (invocation or {}).get("skills_loaded")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for r in raw[:40]:
        if not isinstance(r, dict):
            continue
        key = str(r.get("key") or "").strip()[:200]
        if not key or key in seen:
            continue
        seen.add(key)
        mode, pinned = _binding_for(slug, key)
        out.append({"key": key, "sha": _sha_or_none(r.get("sha")), "how": TOOL_HOW, "status": "used",
                    "binding": mode, "pinned_sha": pinned})
    return out


def link_tool_skills(engine: "Engine", run: "RunState", st: "StepState") -> None:
    """`skill_load` ile yüklenen skill'ler → Step -USED_SKILL{how: tool, status: used}-> Skill (meta olayında;
    idempotent). İstem yolunun kenarı (ör. `catalog`) aynı Step → Skill kenarıdır: özellikler birleşir, önceki istem
    yolu `prompt_how` olarak korunur. Hata koşuyu bozmaz."""
    try:
        uses = tool_skill_uses(st.invocation, st.spec.agent)
    except Exception as exc:  # noqa: BLE001
        log.warning("skill_load izi çözülemedi (%s): %s", st.spec.id, exc)
        return
    if not uses:
        return
    prev = {u.get("key"): u for u in (st.skills_used or []) if isinstance(u, dict)}
    keys = {u["key"] for u in uses}
    for u in uses:
        p = prev.get(u["key"]) or {}
        u["prompt_how"] = p.get("prompt_how") if p.get("how") == TOOL_HOW else p.get("how")
    st.skills_used = [u for u in (st.skills_used or []) if u.get("key") not in keys]
    st.skills_used += [{k: u[k] for k in ("key", "sha", "how", "status", "binding", "pinned_sha", "prompt_how")}
                       for u in uses]
    _manifest_skills(engine, run, st)
    if not st.node_id:
        return
    for u in uses:
        try:
            node = engine.store.find("Skill", u["key"]) or engine.store.upsert_node("Skill", {"name": u["key"]})
            engine.store.link("USED_SKILL", st.node_id, node["id"],
                              {"sha": u["sha"], "how": TOOL_HOW, "status": "used", "binding": u["binding"],
                               "pinned_sha": u["pinned_sha"], "prompt_how": u["prompt_how"], "attempt": st.attempt,
                               "run_id": run.id, "step_id": st.spec.id})
        except Exception as exc:  # noqa: BLE001 - iz kenarı yazılamazsa adım sürer
            log.warning("USED_SKILL (skill_load) yazılamadı (%s): %s", u.get("key"), exc)


def _manifest_skills(engine: "Engine", run: "RunState", st: "StepState") -> None:
    """Koşu manifestindeki adım girdisinin skill listesini -s skill'leriyle tamamlar."""
    try:
        man = run.manifest or {}
        steps = dict(man.get("steps") or {})
        entry = steps.get(st.spec.id)
        if not isinstance(entry, dict):
            return
        steps[st.spec.id] = {**entry, "skills": [{"key": s.get("key"), "sha": s.get("sha")}
                                                 for s in (st.skills_used or [])][:20]}
        run.manifest = {**man, "steps": steps}
        if run.node_id:
            engine.store.patch_node(run.node_id, {"manifest": run.manifest})
    except Exception as exc:  # noqa: BLE001
        log.warning("koşu manifesti (hermes -s) güncellenemedi: %s", exc)


def cold_skills(store: Any, run_id: str, step_id: Any) -> list[dict[str, Any]] | None:
    """Soğuk okuma: adımın USED_SKILL kenarları → [{key, sha, how}] (+ Hermes -s kenarında status/binding; yoksa None)."""
    try:
        node = store.find("Step", f"{run_id}:{step_id}")
        if not node:
            return None
        out: list[dict[str, Any]] = []
        for e, nb, _d in store.neighbors(node["id"], ["USED_SKILL"], "out"):
            p = e["props"]
            item = {"key": nb["props"].get("name"), "sha": p.get("sha"), "how": p.get("how")}
            if p.get("how") == FLAG_HOW:
                item.update({k: p.get(k) for k in ("status", "binding", "pinned_sha")})
            elif p.get("how") == TOOL_HOW:
                item.update({k: p.get(k) for k in ("status", "binding", "pinned_sha", "prompt_how")})
            out.append(item)
        return out or None
    except Exception:  # noqa: BLE001
        return None
