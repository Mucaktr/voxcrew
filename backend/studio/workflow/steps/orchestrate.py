"""`orchestrate` adım türü — Orkestratör (Faz 6 Ekip S24).

`delegate` + döngü: hedef → **plan** (ayrı plan adımı; `plan_approval: ask` ise dinamik onay kartı) → **dağıtım**
(işe alım, çocuk adımlar; her çocuk başlarken motor `assign` mesajı yazar) → **izleme** (çocuk durumları, koşu bütçesi,
süre; `monitor_every_s` aralıkla `orchestrate.monitor`) → **yeniden plan** (başarısız/eksik çocuklar için en fazla
`max_replans` ≤ 2 tur; yeni çocuklar dinamik adım; aşımda insan kapısı) → **sentez** (çocuk yanıt mesajlarından).

Motorun devretme makinesi yeniden kullanılır (`_request_plan`, `_normalize_plan`, `_handle_hire`, `_spawn_children`,
`_add_synthesis`, `_run_dag`, `_card`, `_approval`); bu dosya yalnızca döngüyü ve durumunu yönetir.

Durum `StepState.options` içinde (kontrol noktasına girer; devam/yeniden başlatmada sürer):
`_phase` (plan | approve | dispatch | run | gate | synth), `_round` (yapılan plan turu), `_replans` (kullanılan yeniden
plan), `_pending` (onay/dağıtım bekleyen alt görevler), `_ctx` (yeniden planlanan çocuklar), `_handled` (yerine yenisi
planlanmış çocuklar — sentezde yer almaz).

İz (trace): her plan turu `<adım>.plan-N` / `<adım>.yeniden-plan-N` kimlikli ayrı bir dinamik adımdır (`kind` plan |
replan; `step.started`/`step.finished`) — iz görünümünde orkestratör adımının altında ayrı span olarak görünür.
Plan artefaktı: çalışma klasöründe `.studio/runs/<koşu>/<adım>/plan.json` (gizli klasör; ajan dosya farkına girmez).
Olaylar (kalıcı): `orchestrate.plan {step, plan_step, round, kind, subtasks, synthesis}`, `orchestrate.replan {step,
round, replans, max_replans, failed}`, `orchestrate.gate {step, replans, max_replans, failed}`; canlı:
`orchestrate.monitor {step, round, children, usage, budget, elapsed_s}`.
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from studio.agents import RouteError
from studio.graph.store import now_iso
from studio.i18n import agent_lang
from studio.messaging.service import summarize
from studio.workflow.budget import check as budget_check
from studio.workflow.engine import StepState, _Budget, _Suspend
from studio.workflow.spec import StepSpec, orchestrate_options, render
from studio.workflow.states import STEP_TERMINAL

if TYPE_CHECKING:  # pragma: no cover
    from studio.workflow.engine import Engine, RunState

TYPE = "orchestrate"
DELEGATE_KEYS = ("depth", "max_subtasks", "allow_hiring", "hiring_approval", "hire_budget")
PLAN_DIR = ".studio/runs"
PRIVATE_DEFAULTS: dict[str, Any] = {"_phase": "plan", "_round": 0, "_replans": 0, "_pending": None, "_ctx": [],
                                    "_handled": []}
PLAN_KINDS = ("plan", "replan")

# Ajana giden istem metinleri (koşunun ajan diline göre; kullanıcı iletileri motorun `_t` kataloğundadır)
TEXTS: dict[str, dict[str, str]] = {
    "tr": {
        "plan.title": "Plan · {name}",
        "replan.title": "Yeniden plan {n} · {name}",
        "replan.context": "# DURUM — YENİDEN PLAN (tur {replan}/{max})\nÖnceki planın bazı alt görevleri tamamlanamadı "
                          "ya da hiç çalışmadı. Yalnızca bunları tamamlamak için YENİ alt görevler planla; biten "
                          "işleri tekrarlama. Başarısız olan yaklaşımı aynen tekrarlama: görevi böl, başka birine ver "
                          "ya da talimatı netleştir.\n\n## Tamamlananlar\n{done}\n\n## Tamamlanamayanlar\n{failed}",
        "replan.none": "(yok)",
        "line.done": "- {title} · {who}: {summary}",
        "line.failed": "- {title} · {who} — {status}: {error}",
        "plan.head": "**Plan · tur {round} · {n} alt görev**",
        "plan.line": "{i}. **{title}** → {who}",
        "no_reason": "neden yok",
    },
    "en": {
        "plan.title": "Plan · {name}",
        "replan.title": "Replan {n} · {name}",
        "replan.context": "# STATUS — REPLAN (round {replan}/{max})\nSome subtasks of the previous plan failed or never "
                          "ran. Plan NEW subtasks only to complete them; do not repeat finished work. Do not repeat the "
                          "approach that failed: split the task, assign it to someone else or clarify the "
                          "instructions.\n\n## Completed\n{done}\n\n## Not completed\n{failed}",
        "replan.none": "(none)",
        "line.done": "- {title} · {who}: {summary}",
        "line.failed": "- {title} · {who} — {status}: {error}",
        "plan.head": "**Plan · round {round} · {n} subtasks**",
        "plan.line": "{i}. **{title}** → {who}",
        "no_reason": "no reason",
    },
}


def _texts(lang: str) -> dict[str, str]:
    return TEXTS["en" if lang == "en" else "tr"]


def validate_step(step: StepSpec) -> list[str]:
    """Şema doğrulaması `spec.validate` içinde (orchestrate yerleşik tür); eklenti sözleşmesi için boş liste."""
    return []


def register(engine: "Engine") -> None:
    async def handler(run: "RunState", st: StepState) -> None:
        await run_orchestrate(engine, run, st)

    engine.register_step_type(TYPE, handler, validate_step)


# ---------------------------------------------------------------------------- yardımcılar
def _kids(run: "RunState", st: StepState, kinds: tuple[str, ...] = ("subtask",)) -> list[StepState]:
    return [c for c in run.steps.values() if c.parent == st.spec.id and c.kind in kinds]


def _names(engine: "Engine") -> dict[str, str]:
    return {n["props"]["slug"]: n["props"].get("name") or n["props"]["slug"]
            for n in engine.store.nodes("Agent", limit=5000)}


def _compact(subtasks: list[dict[str, Any]], names: dict[str, str]) -> list[dict[str, Any]]:
    return [{"id": s["id"], "title": s["title"], "assignee": s["assignee"],
             "assignee_name": names.get(s["assignee"], s["assignee"]), "depends_on": list(s.get("depends_on") or []),
             "hire": s["assignee"] == "HIRE"} for s in subtasks]


def _failure(c: StepState) -> dict[str, Any]:
    return {"step": c.spec.id, "title": c.spec.title or c.spec.id, "agent": c.spec.agent, "status": c.status,
            "error": (c.error or c.last_error or "")[:300] or None}


def _unresolved(run: "RunState", st: StepState, opts: dict[str, Any]) -> list[StepState]:
    """Tamamlanmamış (başarısız, atlanmış, iptal) ve henüz yerine yenisi planlanmamış çocuklar. `on_fail: skip`
    ile bilerek atlanan çocuk eksik sayılmaz."""
    handled = set(opts.get("_handled") or [])
    return [c for c in _kids(run, st) if c.status != "done" and c.spec.id not in handled
            and not (c.status == "skipped" and c.soft_fail)]


def _unique_ids(run: "RunState", st: StepState, subtasks: list[dict[str, Any]], rnd: int) -> list[dict[str, Any]]:
    """Yeniden plan turunun alt görev kimlikleri önceki çocuklarla çakışmasın (`r<tur>-<id>`)."""
    taken = {sid for sid in run.steps}
    mapping: dict[str, str] = {}
    out: list[dict[str, Any]] = []
    for s in subtasks:
        sid = s["id"]
        new = sid
        if f"{st.spec.id}.{sid}" in taken:
            base, n = f"r{rnd}-{sid}"[:30], 2
            new = base
            while f"{st.spec.id}.{new}" in taken:
                new, n = f"{base}-{n}", n + 1
        taken.add(f"{st.spec.id}.{new}")
        mapping[sid] = new
        out.append({**s, "id": new})
    for s in out:
        s["depends_on"] = [mapping.get(d, d) for d in s.get("depends_on") or []]
    return out


def _resumable_plan_round(run: "RunState", parent: str) -> StepState | None:
    """bütçe kartında durdurulmuş (bitmemiş, en az bir deneme yapmış) en son plan turu."""
    rounds = [x for x in run.steps.values() if x.parent == parent and x.kind in PLAN_KINDS
              and x.status not in STEP_TERMINAL and x.attempt > 0]
    return rounds[-1] if rounds else None


def _reset(st: StepState, opts: dict[str, Any]) -> None:
    for k, v in PRIVATE_DEFAULTS.items():
        opts[k] = list(v) if isinstance(v, list) else v
    st.plan, st.synthesis_hint = None, None


# ---------------------------------------------------------------------------- ana döngü
async def run_orchestrate(engine: "Engine", run: "RunState", st: StepState) -> None:
    spec = st.spec
    manager = engine._resolve_step_agent(run, st)
    if not manager:
        return
    mp = manager["props"]
    boss = mp["slug"]
    lang = agent_lang(engine.settings)
    if not st.options or "plan_approval" not in st.options:
        st.options = {**orchestrate_options(spec), **{k: (list(v) if isinstance(v, list) else v)
                                                      for k, v in PRIVATE_DEFAULTS.items()}}
    opts = st.options
    # Yarıda kalan plan turları yeniden istenir; bitmemiş işe alım kartı dağıtımda yeniden açılır.
    # bütçe kartıyla durdurulan (yarıda kalan) plan turu DÜŞMEZ: aynı adım yeniden çalışır (deneme sayısı ve
    # önceki denemelerin harcaması korunur), böylece kart ajan adımıyla aynı tam deneme kuralıyla boyutlanır ve aynı
    # turdaki onay sayısı birikir (2 onaydan sonra birincil eylem "kısmi çıktıyla devam"). Yalnız en son tur korunur.
    keep = _resumable_plan_round(run, spec.id) if opts.get("_phase", "plan") == "plan" else None
    for c in [x for x in run.steps.values() if x.parent == spec.id and x.status not in STEP_TERMINAL
              and (x.kind in PLAN_KINDS or (x.kind == "hire" and opts.get("_phase") == "dispatch"))
              and x is not keep]:
        engine._drop_steps(run, [c.spec.id])  # yarıda kalan plan turunun ödenen kullanımı koşuda kalır
    # Adım yeniden açıldıysa (retry/çatal: dinamik alt ağaç düştü) baştan planlanır
    has_plan = any(x.status == "done" for x in _kids(run, st, PLAN_KINDS))
    if (opts.get("_round") and not has_plan) or (opts.get("_phase") in ("run", "gate", "synth") and not _kids(run, st)):
        _reset(st, opts)
    if st.budget is None:
        st.budget = _Budget(left=int(opts["hire_budget"]))
    goal = render(spec.prompt, engine._ctx(run))
    try:
        route = engine.agents.route(manager, spec.connection, spec.model)
    except RouteError as exc:
        engine._finish_step(run, st, "failed", error=str(exc), cause="route.error")
        return
    resumed = bool(opts.get("_round")) or opts.get("_phase") != "plan"
    st.status, st.error, st.finished_at = "running", None, None
    if not resumed:
        st.started_at, st.output, st.warning, st.plan = now_iso(), "", None, None
    elif not st.started_at:
        st.started_at = now_iso()
    st.route, st.model = route.to_dict(), route.model
    engine._begin_attempt(run, st)
    engine._emit(run, "step.started", step=spec.id, agent=boss, route=st.route, attempt=st.attempt,
                 **({"resumed": True} if resumed else {}))

    while True:
        if engine._cap_stopped(run, st):
            # "kalan işleri durdur" kararı bu (iç içe) orkestratörü durdurdu: yeni plan / sentez turu ödenmez;
            # biten alt görevlerin çıktısıyla eksik olarak işaretli biter
            engine._close_container_partial(run, st)
            await _write_plan_artifact(engine, run, st, goal, opts)
            return
        phase = opts.get("_phase") or "plan"
        if phase == "plan":
            replan = int(opts.get("_round") or 0) > 0
            engine._agent_state(boss, "thinking", "Planı yeniden yapıyor…" if replan else "Plan yapıyor…",
                                run.id, spec.id)
            result = await _plan_round(engine, run, st, manager, route, goal, opts, lang, replan=replan)
            if result is None:
                if not replan:
                    return  # ilk plan yok: adım başarısız bitti
                opts["_phase"] = "gate"  # yeniden plan kullanılamadı → insan kapısı
                engine._checkpoint(run)
                continue
            opts["_round"] = int(opts.get("_round") or 0) + 1
            opts["_pending"] = result["subtasks"]
            if result.get("synthesis"):
                st.synthesis_hint = result["synthesis"]
            opts["_phase"] = "approve"
            engine._checkpoint(run)
        elif phase == "approve":
            if opts.get("plan_approval") == "ask" and not await _approve_plan(engine, run, st, manager, opts):
                engine._finish_step(run, st, "rejected", error=engine._t(run, "Plan reddedildi"), cause="plan.rejected")
                await _write_plan_artifact(engine, run, st, goal, opts)
                return
            opts["_phase"] = "dispatch"
            engine._checkpoint(run)
        elif phase == "dispatch":
            await _dispatch(engine, run, st, manager, goal, opts, lang)
            opts["_phase"] = "run"
            engine._checkpoint(run)
        elif phase == "run":
            await _monitor(engine, run, st, opts)
            open_ = _unresolved(run, st, opts)
            if not open_:
                opts["_phase"] = "synth"
            elif int(opts.get("_replans") or 0) < int(opts["max_replans"]):
                opts["_replans"] = int(opts.get("_replans") or 0) + 1
                opts["_ctx"] = [c.spec.id for c in open_]
                # yerine yenisi planlanan çocukların yan etkili yürütmeleri yöneticinin havuzuna girer: yeni
                # plan aynı çağrıyı (ad + argüman) isterse yeniden yürütülmez, önceki sonuç tekrar kullanılır.
                # biten çocukların yürütmeleri de (yeni plan biten işi yinelerse yeniden yürütülmez)
                done_ = [c.spec.id for c in _kids(run, st) if c.status == "done"]
                engine._pool_retire(run, st, [c.spec.id for c in open_] + done_)
                opts["_phase"] = "plan"
                engine._emit(run, "orchestrate.replan", step=spec.id, round=int(opts["_round"]) + 1,
                             replans=opts["_replans"], max_replans=opts["max_replans"],
                             failed=[_failure(c) for c in open_])
            else:
                opts["_ctx"] = [c.spec.id for c in open_]
                opts["_phase"] = "gate"
            engine._checkpoint(run)
        elif phase == "gate":
            if not await _gate(engine, run, st, opts):
                engine._finish_step(run, st, "failed", error=engine._t(run, "Yeniden plan sınırı aşıldı; kullanıcı durdurdu"),
                                    cause="replan.limit")
                await _write_plan_artifact(engine, run, st, goal, opts)
                return
            opts["_phase"] = "synth"
            engine._checkpoint(run)
        else:  # synth
            await _synthesize(engine, run, st, manager, goal, opts, lang)
            return


# ---------------------------------------------------------------------------- plan turu
def _replan_context(engine: "Engine", run: "RunState", st: StepState, opts: dict[str, Any], lang: str) -> str:
    T = _texts(lang)
    names = _names(engine)
    ctx = set(opts.get("_ctx") or [])
    handled = set(opts.get("_handled") or [])
    done = [c for c in _kids(run, st) if c.status == "done" and c.spec.id not in handled]
    failed = [c for c in _kids(run, st) if c.spec.id in ctx]
    done_lines = [T["line.done"].format(title=c.spec.title or c.spec.id, who=names.get(c.spec.agent or "", c.spec.agent),
                                        summary=summarize(c.output, 400).replace("\n", " ")) for c in done]
    failed_lines = [T["line.failed"].format(title=c.spec.title or c.spec.id, who=names.get(c.spec.agent or "", c.spec.agent),
                                            status=c.status, error=(c.error or c.last_error or T["no_reason"])[:300])
                    for c in failed]
    return T["replan.context"].format(replan=opts.get("_replans"), max=opts.get("max_replans"),
                                      done="\n".join(done_lines) or T["replan.none"],
                                      failed="\n".join(failed_lines) or T["replan.none"])


def _plan_text(subtasks: list[dict[str, Any]], names: dict[str, str], rnd: int, lang: str) -> str:
    T = _texts(lang)
    lines = [T["plan.head"].format(round=rnd, n=len(subtasks)), ""]
    for i, s in enumerate(subtasks, 1):
        lines.append(T["plan.line"].format(i=i, title=s["title"], who=names.get(s["assignee"], s["assignee"])))
    return "\n".join(lines)


async def _plan_round(engine: "Engine", run: "RunState", st: StepState, manager: dict[str, Any], route: Any,
                      goal: str, opts: dict[str, Any], lang: str, *, replan: bool) -> dict[str, Any] | None:
    """Tek plan turu ayrı bir dinamik adım olarak (iz görünümünde ayrı span). Başarısızlıkta None; ilk planda
    orkestratör adımı da başarısız biter."""
    mp = manager["props"]
    boss = mp["slug"]
    T = _texts(lang)
    kind = "replan" if replan else "plan"
    reuse = _resumable_plan_round(run, st.spec.id)
    if reuse is not None and reuse.kind != kind:
        reuse = None
    n = 1 + sum(1 for x in run.steps.values() if x.parent == st.spec.id and x.kind == kind and x is not reuse)
    pid = reuse.spec.id if reuse is not None else f"{st.spec.id}.{'yeniden-plan' if replan else 'plan'}-{n}"
    reports = engine._direct_reports(boss)
    budget = st.budget or _Budget(left=0)
    can_hire = bool(opts["allow_hiring"]) and budget.left > 0 and engine._agent_count() < engine._agent_cap()
    goal_text = goal + ("\n\n" + _replan_context(engine, run, st, opts, lang) if replan else "")
    prompt = engine._plan_prompt(goal_text, reports, can_hire=can_hire, hires_left=budget.left,
                                 max_subtasks=int(opts["max_subtasks"]), lang=lang)
    title = T["replan.title" if replan else "plan.title"].format(n=n, name=mp.get("name") or boss)
    if reuse is not None:
        # aynı plan turu yeniden (baştan) çalışır; önceki denemelerin harcaması `prior`da kalır
        pst = reuse
        pst.spec.prompt = prompt
        pst.output, pst.thought, pst.tools, pst.error = "", "", [], None
        pst.policy, pst.limits = st.policy, st.limits
    else:
        pst = StepState(StepSpec(id=pid, type="agent", title=title, agent=boss, prompt=prompt, memory=False,
                                 remember=False), parent=st.spec.id, level=st.level + 1, kind=kind)
        pst.policy, pst.limits = st.policy, st.limits
        engine._add_step(run, pst)
    pst.status, pst.started_at = "running", now_iso()
    pst.route, pst.model, pst.prompt = route.to_dict(), route.model, prompt
    engine._begin_attempt(run, pst)
    engine._persist_step(run, pst, prompt=prompt)
    engine._emit(run, "step.started", step=pid, agent=boss, route=pst.route, attempt=pst.attempt)
    try:
        plan = await engine._request_plan(run, pst, manager, route, prompt)
    except RouteError as exc:
        engine._finish_step(run, pst, "failed", error=str(exc), cause="route.error")
        if not replan:
            engine._finish_step(run, st, "failed", error=str(exc), cause="route.error")
        return None
    if plan is None:
        msg = engine._t(run, "Yönetici geçerli bir JSON plan üretemedi (bir kez yeniden denendi)")
        engine._finish_step(run, pst, "failed", error=msg, cause="plan.invalid")
        if not replan:
            engine._finish_step(run, st, "failed", error=msg, cause="plan.invalid")
        return None
    subtasks = engine._normalize_plan(run, st, plan, opts, reports, boss)
    subtasks = _unique_ids(run, st, subtasks, int(opts.get("_round") or 0) + 1)
    hint = plan.get("synthesis") if isinstance(plan.get("synthesis"), str) else None
    names = _names(engine)
    pst.output = _plan_text(subtasks, names, int(opts.get("_round") or 0) + 1, lang)
    engine._finish_step(run, pst, "done")
    engine._emit(run, "orchestrate.plan", step=st.spec.id, plan_step=pid, round=int(opts.get("_round") or 0) + 1,
                 kind=kind, subtasks=_compact(subtasks, names), synthesis=hint)
    return {"subtasks": subtasks, "synthesis": hint}


async def _approve_plan(engine: "Engine", run: "RunState", st: StepState, manager: dict[str, Any],
                        opts: dict[str, Any]) -> bool:
    mp = manager["props"]
    names = _names(engine)
    subs = list(opts.get("_pending") or [])
    summary = "; ".join(f"{i}. {s['title']} → {names.get(s['assignee'], s['assignee'])}"
                        for i, s in enumerate(subs, 1))[:900]
    title = (st.spec.title or st.spec.id)[:60]
    rnd = int(opts.get("_round") or 1)

    def build(n: int) -> StepState:
        info = {"kind": "plan_approval", "step": st.spec.id, "round": rnd, "plan": _compact(subs, names),
                "synthesis": st.synthesis_hint, "choices": ["approve", "reject"]}
        aspec = StepSpec(id=f"{st.spec.id}.plan-onay-{n}", type="approval",
                         title=engine._t(run, "Plan onayı · {}", title),
                         message=engine._t(run, "{} şu planı öneriyor (tur {}, {} alt görev): {} — onaylansın mı? "
                                                "Reddedilirse koşu biter.", mp.get("name") or mp["slug"], rnd,
                                           len(subs), summary))
        return StepState(aspec, parent=st.spec.id, level=st.level + 1, kind="plan_approval", ask=info)

    card = engine._card(run, st, "plan_approval", build)
    engine._agent_state(mp["slug"], "waiting", "Plan onayı bekliyor", run.id, st.spec.id)
    await engine._approval(run, card)
    return card.status == "done"


async def _dispatch(engine: "Engine", run: "RunState", st: StepState, manager: dict[str, Any], goal: str,
                    opts: dict[str, Any], lang: str) -> None:
    """İşe alım + çocuk adımlar (motorun devretme makinesi). Plan birikir (`st.plan` tüm turlar), plan.json yazılır."""
    boss = manager["props"]["slug"]
    dopts = {k: opts[k] for k in DELEGATE_KEYS}
    subs = [dict(s) for s in opts.get("_pending") or []]
    for sub in subs:  # işe alımlar sırayla: aynı anda birden çok onay kartı açılmaz
        if sub["assignee"] == "HIRE":
            await engine._handle_hire(run, st, manager, sub, dopts)
    previous = list(st.plan or [])
    engine._spawn_children(run, st, manager, goal, subs, dopts, lang=lang)
    rnd = int(opts.get("_round") or 1)
    for p in st.plan or []:
        p["round"] = rnd
    st.plan = previous + list(st.plan or [])
    opts["_handled"] = list(opts.get("_handled") or []) + list(opts.get("_ctx") or [])
    opts["_ctx"], opts["_pending"] = [], None
    st.output = engine._plan_summary(st.plan, st.synthesis_hint, lang=lang)
    engine._persist_step(run, st)
    data = st.to_dict()
    engine._emit(run, "step.plan", step=st.spec.id, plan=st.plan, delegate=data.get("delegate"),
                 orchestrate=data.get("orchestrate"))
    engine._emit(run, "step.delta", step=st.spec.id, text=st.output)
    await _write_plan_artifact(engine, run, st, goal, opts)
    engine._agent_state(boss, "waiting", "Ekibini izliyor", run.id, st.spec.id)


# ---------------------------------------------------------------------------- izleme
def _reset_running_children(engine: "Engine", run: "RunState", st: StepState) -> None:
    """İzleme kesildi (bütçe kararı vb.): yarıda kalan çocuklar devamda yeniden çalışmak üzere `pending`."""
    for c in _kids(run, st):
        if c.status in ("running", "awaiting_tool_approval"):
            for e in run.effects.mark_unknown(c.spec.id):
                engine._emit(run, "step.effect", step=c.spec.id, effect=e.to_dict())
            c.status, c.finished_at, c.pending_approval = "pending", None, None
            engine._persist_step(run, c)


def _tick(engine: "Engine", run: "RunState", st: StepState, opts: dict[str, Any]) -> None:
    """Periyodik izleme: çocuk durumları + kullanım/bütçe (canlı olay). Koşu bütçesi aşıldıysa askıya alır."""
    counts: dict[str, int] = {}
    for c in _kids(run, st):
        counts[c.status] = counts.get(c.status, 0) + 1
    engine._recompute_usage(run)
    engine.bus.publish("orchestrate.monitor", run_id=run.id, step=st.spec.id, round=int(opts.get("_round") or 0),
                       children=counts, usage=run.usage.to_dict(), budget=run.budget.to_dict(),
                       elapsed_s=round(time.monotonic() - run.t0, 1))
    if any(c.status not in STEP_TERMINAL for c in _kids(run, st)):
        # bitmemiş çocuk koşu tavanını kendisi denetler — çalışırken tur sınırında (kart O ÇOCUĞUN harcamasıyla,
        # tam deneme kuralıyla), başlarken rezervasyonda, kartı açıksa kullanıcı karar verir. İzleme turu burada askıya
        # alsaydı çalışan çocuk tur ortasında kesilip baştan çalışır, açık kartı yanıtsız kalır, kart orkestratörün
        # "sıradaki adım" tahminiyle boyutlanır ve aynı aşım her izleme turunda yinelenirdi ( MC: 30M+ jeton).
        return
    for b in budget_check(run.usage.spent_view(), run.budget, "run"):  # gerçek harcama
        if b.exceeded:
            action = engine._breach_action(run, st, b)  # otomatik token ağı (süre / adım sınırı yanında) sorar
            engine._emit(run, "budget.exceeded", step=st.spec.id, action=action, **b.to_dict())
            raise _Suspend(action, engine._t(run, "Bütçe aşıldı: {} {} {} / {}", b.scope, b.metric,
                                             engine._amt(run, b.metric, b.used), engine._amt(run, b.metric, b.limit)), b, st.spec.id)


async def _monitor(engine: "Engine", run: "RunState", st: StepState, opts: dict[str, Any]) -> None:
    """Çocuk DAG'ını yürütür; `monitor_every_s` aralıkla izler. Askıya alma/iptal çocukları durdurur."""
    _reset_running_children(engine, run, st)
    ids = [c.spec.id for c in _kids(run, st) if c.status == "pending"]
    if not ids:
        return
    every = max(0.05, float(opts.get("monitor_every_s") or 30))
    dag = asyncio.ensure_future(engine._run_dag(run, ids))
    try:
        while True:
            done, _ = await asyncio.wait({dag}, timeout=every)
            if done:
                break
            _tick(engine, run, st, opts)
        dag.result()
    except BaseException:
        if not dag.done():
            dag.cancel()
            await asyncio.gather(dag, return_exceptions=True)
            _reset_running_children(engine, run, st)
        raise


# ---------------------------------------------------------------------------- insan kapısı ve sentez
async def _gate(engine: "Engine", run: "RunState", st: StepState, opts: dict[str, Any]) -> bool:
    """`max_replans` doldu (ya da yeniden plan üretilemedi) ve eksik iş var: eldeki sonuçla sentez / durdur."""
    ctx = set(opts.get("_ctx") or [])
    failed = [c for c in _kids(run, st) if c.spec.id in ctx] or _unresolved(run, st, opts)
    title = (st.spec.title or st.spec.id)[:60]
    names = ", ".join((c.spec.title or c.spec.id) for c in failed)[:400]
    payload = [_failure(c) for c in failed]

    def build(n: int) -> StepState:
        info = {"kind": "replan_gate", "step": st.spec.id, "replans": int(opts.get("_replans") or 0),
                "max_replans": int(opts["max_replans"]), "failed": payload, "choices": ["approve", "reject"]}
        aspec = StepSpec(id=f"{st.spec.id}.kapi-{n}", type="approval",
                         title=engine._t(run, "Yeniden plan sınırı · {}", title),
                         message=engine._t(run, "En fazla {} yeniden plan turu kullanıldı; {} alt görev hâlâ "
                                                "tamamlanamadı ({}). Eldeki sonuçlarla sentezlensin mi? Reddedilirse "
                                                "koşu başarısız biter.", int(opts["max_replans"]), len(failed), names))
        return StepState(aspec, parent=st.spec.id, level=st.level + 1, kind="replan_gate", ask=info)

    engine._emit(run, "orchestrate.gate", step=st.spec.id, replans=int(opts.get("_replans") or 0),
                 max_replans=int(opts["max_replans"]), failed=payload)
    card = engine._card(run, st, "replan_gate", build)
    if st.spec.agent:
        engine._agent_state(st.spec.agent, "waiting", "Karar bekliyor", run.id, st.spec.id)
    await engine._approval(run, card)
    return card.status == "done"


async def _synthesize(engine: "Engine", run: "RunState", st: StepState, manager: dict[str, Any], goal: str,
                      opts: dict[str, Any], lang: str) -> None:
    handled = set(opts.get("_handled") or [])
    kids = [c for c in _kids(run, st) if c.spec.id not in handled]
    done = [c for c in kids if c.status == "done"]
    if not done:
        engine._finish_step(run, st, "failed", error=engine._t(run, "Alt görevlerin hiçbiri tamamlanamadı: {}", " · ".join(
            f"{c.spec.title}: {c.error or c.status}" for c in kids)[:1200]), cause="delegate.children")
        await _write_plan_artifact(engine, run, st, goal, opts)
        return
    old = run.steps.get(f"{st.spec.id}.sentez")
    if old is not None and old.parent == st.spec.id and (old.status == "done" or (
            old.status not in STEP_TERMINAL and old.attempt > 0)):
        # devamda bitmiş sentez yeniden çalışmaz; bütçe kartında durdurulan sentez DÜŞMEZ, aynı adım yeniden
        # çalışır (önceki denemelerin harcaması korunur; kart ajan adımıyla aynı tam deneme kuralıyla boyutlanır)
        synth = old
    else:
        synth = engine._add_synthesis(run, st, manager, goal, st.synthesis_hint, kids, lang=lang)
    engine._agent_state(manager["props"]["slug"], "thinking", "Sonuçları birleştiriyor…", run.id, st.spec.id)
    try:
        await engine._run_step(run, synth)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - sentez hatası orkestratör adımında görünür
        if synth.status not in STEP_TERMINAL:
            engine._finish_step(run, synth, "failed", error=f"{type(exc).__name__}: {exc}",
                                cause=synth.fail_cause or engine._exc_cause(synth, exc))
    if synth.status != "done":
        engine._finish_step(run, st, "failed", error=engine._t(run, "Sentez tamamlanamadı: {}", synth.error or synth.status),
                            cause="delegate.synthesis")
        await _write_plan_artifact(engine, run, st, goal, opts)
        return
    st.output = synth.output
    failed = [c for c in kids if c.status != "done" and not (c.status == "skipped" and c.soft_fail)]
    if failed:
        st.error = engine._t(run, "{} alt görev tamamlanamadı: {}", len(failed),
                             ", ".join(c.spec.title or c.spec.id for c in failed))
    engine._mark_nested_incomplete(run, st, [*kids, synth])  # EKSİK yukarı taşınır
    engine._finish_step(run, st, "done", cause="delegate.partial" if failed else None)  # kısmi
    await _write_plan_artifact(engine, run, st, goal, opts)


# ---------------------------------------------------------------------------- plan.json artefaktı
def _write_json(path: Path, data: dict[str, Any]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(raw)
    tmp.replace(path)
    return len(raw)


async def _write_plan_artifact(engine: "Engine", run: "RunState", st: StepState, goal: str,
                               opts: dict[str, Any]) -> None:
    """Planı (tüm turlar, çocuk durumları) `plan.json` Artifact olarak yazar: PRODUCED kenarı + `step.artifacts`.
    Hata koşuyu bozmaz."""
    try:
        rel = f"{PLAN_DIR}/{run.id}/{st.spec.id}/plan.json"
        path = Path(engine.settings.workdir) / rel
        subtasks = []
        for p in st.plan or []:
            child = run.steps.get(str(p.get("step")))
            subtasks.append({**p, "status": child.status if child else None,
                             "error": (child.error if child and child.status != "done" else None)})
        rounds = [{"step": c.spec.id, "kind": c.kind, "status": c.status, "started_at": c.started_at,
                   "finished_at": c.finished_at} for c in _kids(run, st, PLAN_KINDS)]
        data = {"version": 1, "run_id": run.id, "step": st.spec.id, "agent": st.spec.agent, "goal": goal,
                "status": st.status, "plan_approval": opts.get("plan_approval"),
                "max_replans": opts.get("max_replans"), "round": int(opts.get("_round") or 0),
                "replans": int(opts.get("_replans") or 0), "synthesis": st.synthesis_hint, "rounds": rounds,
                "subtasks": subtasks, "pending": opts.get("_pending"), "updated_at": now_iso()}
        existed = path.is_file()
        size = await asyncio.to_thread(_write_json, path, data)
        node = engine.store.upsert_node("Artifact", {"path": str(path), "name": rel})
        if st.node_id:
            engine.store.link("PRODUCED", st.node_id, node["id"])
        entry = {"name": rel, "size": size, "new": not existed, "id": node["id"], "kind": "plan"}
        st.artifacts = [a for a in st.artifacts if a.get("name") != rel] + [entry]
        engine._emit(run, "step.artifacts", step=st.spec.id, files=st.artifacts)
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger("studio.orchestrate").exception("plan.json yazılamadı: %s", run.id)
