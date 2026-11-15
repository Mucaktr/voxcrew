"""Koşu kontrol noktası: adım sınırında JSON anlık görüntü ve geri yükleme.

`snapshot(run)` → `Run.props.checkpoint` (yalnızca JSON; pickle yasak). İçerik: akış tanımı (dinamik adımlar dahil),
adım durumları/çıktıları/turları/denemeleri, devretme planı ve işe alım bütçesi, bütçe/kullanım, etkiler, bekleyen
onay bilgisi. `restore(engine, run_id)` graftaki kontrol noktasından `RunState` kurar: `running`/`awaiting_*` adımlar
`pending`e döner (devamda adım baştan çalışır), onay adımları yeniden onay bekler, bekleyen etkiler `unknown` olur.
"""

from __future__ import annotations

import copy
import time
from dataclasses import asdict
from typing import TYPE_CHECKING, Any

from studio.workflow.budget import Budget, StepUsage, Usage
from studio.workflow.effects import EffectLog
from studio.workflow.spec import InputSpec, StepSpec, WorkflowSpec
from studio.workflow.states import STEP_RESETTABLE, STEP_TERMINAL

if TYPE_CHECKING:  # pragma: no cover
    from studio.workflow.engine import RunState, StepState

VERSION = 1
OUTPUT_CAP = 20000
THOUGHT_CAP = 1200
_STEP_FIELDS = ("status", "output", "error", "route", "model", "tokens", "rounds", "started_at", "finished_at",
                "warning", "parent", "level", "kind", "assignee_hired", "hire", "plan", "options", "dlevel",
                "attempt", "last_error", "policy", "soft_fail", "synthesis_hint", "route_override", "ask",
                "resume_ask", "gate",  # adım başı onay durumu {mode, phase, outcome, card}
                "cap",  # G4-REST: etkin adım jeton tavanı ve kaynağı
                "error_class",  # hata taksonomisi sınıfı
                "overrun", "copied",  # PROC-FIX: korunan çıktılı aşım, çatala kopyalanan adım
                "tries",  # model turu gönderen deneme sayısı (arayüz etiketi)
                "partial",  # PROC2-FIX P1: tur arası durdurulan denemenin korunan çıktısı
                "prior", "enforcement",  # adımın önceki denemelerinin harcaması (adım tavanı tümünü sayar)
                # araç yürütme defteri, devam kaydı, kısmi kabul (çökmede korunur)
                "tool_ledger", "continued", "accepted_partial",
                "ledger_key",  # defter devralma anahtarı (alt görev kimliği)
                "budget_stopped",  # bütçe kararıyla atlandı (tüketen sentez eksik sayar)
                "last_try",  # önceki denemenin harcaması (yeniden başlayan işin önerisi)
                "runaway",  # "bu adım beklenenden çok harcıyor" uyarısı (adım başına bir kez)
                "unrecorded",  # olası kaydedilmemiş istek (harcama değil; ayrı alan)
                "ledger_gen")  # defterin günlük kuşağı (asıl kayıtlar koşu iç günlüğünde, `LEDGER_JOURNAL`)
# araç yürütme defterinin asıl (yan etkili, başarılı) kayıtları kontrol noktasında DEĞİL, koşunun yalnız ekleme
# yapılan iç günlüğündedir (`GraphStore.add_run_journal`): kontrol noktası yazımı yeni kayıt sayısıyla orantılı kalır.
# Günlüğe yazılan kayıt `JOURNAL_MARK` (kuşak) taşır; kontrol noktasında yalnız günlüğe girmemiş kayıtlar ("kuyruk") durur.
LEDGER_JOURNAL = "ledger.journal"
JOURNAL_MARK = "j"


def compatible(data: Any) -> bool:
    """Kontrol noktası bu sürümle kurulabilir mi (sürüm alanı olmayan eski kayıtlar 1 sayılır)."""
    return isinstance(data, dict) and int(data.get("version") or 1) == VERSION


def spec_to_dict(spec: WorkflowSpec) -> dict[str, Any]:
    return asdict(spec)


def spec_from_dict(d: dict[str, Any]) -> WorkflowSpec:
    steps = [StepSpec(**{k: v for k, v in s.items() if k in StepSpec.__dataclass_fields__}) for s in d.get("steps") or []]
    inputs = [InputSpec(**{k: v for k, v in i.items() if k in InputSpec.__dataclass_fields__}) for i in d.get("inputs") or []]
    return WorkflowSpec(slug=str(d.get("slug") or ""), name=str(d.get("name") or ""), description=d.get("description", ""),
                        icon=d.get("icon", "workflow"), inputs=inputs, steps=steps, defaults=dict(d.get("defaults") or {}),
                        budget=d.get("budget"), acceptance=d.get("acceptance"), quality=d.get("quality"),
                        deliverable=d.get("deliverable"))  # PROC-FIX


def snapshot(run: "RunState") -> dict[str, Any]:
    """Koşunun JSON anlık görüntüsü (adım sınırında çağrılır)."""
    steps: list[dict[str, Any]] = []
    for st in run.steps.values():
        item: dict[str, Any] = {"spec": asdict(st.spec)}
        for f in _STEP_FIELDS:
            if f == "tool_ledger":  # yalnız günlüğe girmemiş kayıtlar (asıl kayıtlar koşu iç günlüğünde)
                led = getattr(st, f, None)
                item[f] = (copy.deepcopy([e for e in led if not (isinstance(e, dict) and JOURNAL_MARK in e)])
                           if isinstance(led, list) else copy.deepcopy(led))
                continue
            item[f] = copy.deepcopy(getattr(st, f, None))
        item["output"] = (st.output or "")[:OUTPUT_CAP]
        item["thought"] = (st.thought or "")[-THOUGHT_CAP:]
        item["tools"] = [{"name": t.get("name"), "ok": t.get("ok"),  # tekrar kullanım işareti korunur
                          **({"reused": True} if t.get("reused") else {}),
                          **({"replayed": True} if t.get("replayed") else {})} for t in st.tools[-40:]]
        item["approvals"] = list(st.approvals)
        item["artifacts"] = [{"name": a.get("name"), "id": a.get("id")} for a in st.artifacts]
        item["usage"] = st.usage.to_dict() if st.usage else None
        item["limits"] = st.limits.to_dict() if st.limits else None
        # işe alım bütçesi kök devretme adımına aittir; iç içe adımlar aynı nesneyi paylaşır (owner ile yeniden bağlanır)
        if st.budget is not None:
            owner = _budget_owner(run, st)
            item["hire_budget"] = {"owner": owner, "left": st.budget.left, "hired": list(st.budget.hired)}
        steps.append(item)
    return {
        "version": VERSION, "saved_at": time.time(),
        "run": {"id": run.id, "title": run.title, "kind": run.kind, "inputs": run.inputs, "status": run.status,
                "started_at": run.started_at, "finished_at": run.finished_at, "origin": run.origin, "goal": run.goal,
                "output": (run.output or "")[:OUTPUT_CAP], "error": run.error, "attempts": run.attempts,
                "resumed_at": run.resumed_at, "forked_from": run.forked_from, "pause_reason": run.pause_reason,
                "lang": run.lang, "project": run.project,
                "error_class": run.error_class,
                "overruns": run.overruns,  # PROC-FIX
                "deadline_at": run.deadline_at, "deadline_min": run.deadline_min,  # PROC2-FIX
                "ledger_stash": copy.deepcopy(run.ledger_stash) or None,
                "ledger_pool": copy.deepcopy(run.ledger_pool) or None,  # devretme düzeyi yürütme havuzu
                "pool_off": sorted(run.pool_off) or None,  # havuzsuz ("baştan çalıştır") yeniden denemeler
                "pool_full": sorted(run.pool_full) or None,  # havuzu dolan yöneticiler (fail safe)
                "card_seq": int(getattr(run, "card_seq", 0) or 0),  # koşu düzeyi bütçe kartı sayacı
                "budget_auto": copy.deepcopy(run.budget_auto),  # otomatik koşu bütçesi
                "cap_ref": run.cap_ref,  # başlangıç beklentisi (koşu kartı önerisinin canlı izdüşümü)
                "ud_cap": copy.deepcopy(getattr(run, "ud_cap", None)),  # "bitene kadar" yazılan tavanı
                "crash": copy.deepcopy(getattr(run, "crash", None)),  # motor hatasıyla failed bitti
                "cap_stop": sorted(run.cap_stop) or None,  # "bitenlerle devam" kararı (çalışanlar durur)
                # karar bekleyen korunan adım aşımı (çökmede de yeniden sorulur)
                "kept_overrun": copy.deepcopy(run.kept_overrun) if run.kept_overrun else None,
                "elapsed_s": round(time.monotonic() - run.t0, 3)},
        "spec": spec_to_dict(run.spec),
        "budget": run.budget.to_dict(), "usage": run.usage.to_dict(),
        "effects": run.effects.to_list(),
        "steps": steps,
    }


def _budget_owner(run: "RunState", st: "StepState") -> str:
    """Aynı `_Budget` nesnesini taşıyan en üstteki (ebeveyn zincirinde ilk) adımın kimliği."""
    owner = st
    cur = st
    seen: set[str] = set()
    while cur.parent and cur.parent in run.steps and cur.parent not in seen:
        seen.add(cur.parent)
        parent = run.steps[cur.parent]
        if parent.budget is st.budget:
            owner = parent
        cur = parent
    return owner.spec.id


def restore(engine: Any, node: dict[str, Any]) -> "RunState":
    """Graftaki Run düğümünün `checkpoint` özelliğinden canlı RunState kurar (başlatmaz)."""
    from studio.workflow.engine import RunState, StepState, _Budget  # döngüsel içe aktarma

    p = node["props"]
    data = p.get("checkpoint")
    if not isinstance(data, dict) or not data.get("steps"):
        raise ValueError("Koşunun kontrol noktası yok; devam edilemez")
    if not compatible(data):  # başka sürümün kontrol noktası yanlış kurulmasın ( "aynı sürümde"; AUDIT A-10)
        raise ValueError(f"Kontrol noktası sürümü uyumsuz ({data.get('version')}); devam edilemez, çatallayarak yeniden başlat")
    rd = data.get("run") or {}
    spec = spec_from_dict(data.get("spec") or {})
    run = RunState(id=str(rd.get("id") or p.get("id")), title=str(rd.get("title") or p.get("title") or ""),
                   kind=str(rd.get("kind") or p.get("kind") or "task"), spec=spec, inputs=dict(rd.get("inputs") or {}),
                   steps={}, status=str(p.get("status") or rd.get("status") or "interrupted"),
                   started_at=str(rd.get("started_at") or p.get("started_at") or ""), finished_at=None,
                   origin=rd.get("origin") or p.get("origin"), goal=rd.get("goal") or p.get("goal"))
    run.node_id = node["id"]
    run.output, run.error = str(rd.get("output") or ""), rd.get("error")
    run.attempts = int(rd.get("attempts") or 0)
    run.resumed_at, run.forked_from = rd.get("resumed_at"), rd.get("forked_from") or p.get("forked_from")
    run.lang = rd.get("lang") or None
    run.error_class = rd.get("error_class") or p.get("error_class") or None
    run.overruns = int(rd.get("overruns") or p.get("budget_overruns") or 0)  # PROC-FIX
    run.project = rd.get("project") or p.get("project") or None  # devam/çatal aynı bellek ad alanında
    if run.deadline_at is None:  # PROC2-FIX süre sınırı ve dakikası (çatal aynı sınırı taşır)
        run.deadline_at = rd.get("deadline_at") or p.get("deadline_at") or None
    dm = rd.get("deadline_min") if rd.get("deadline_min") is not None else p.get("deadline_min")
    run.deadline_min = float(dm) if isinstance(dm, (int, float)) and not isinstance(dm, bool) and dm > 0 else None
    run.t0 = time.monotonic() - float(rd.get("elapsed_s") or 0.0)
    stash = rd.get("ledger_stash")  # düşürülen adımların yürütme defteri
    run.ledger_stash = {str(k): list(v) for k, v in stash.items() if isinstance(v, list)} if isinstance(stash, dict) else {}
    pool = rd.get("ledger_pool")
    run.ledger_pool = ({str(k): [dict(e) for e in v if isinstance(e, dict)] for k, v in pool.items() if isinstance(v, list)}
                       if isinstance(pool, dict) else {})
    run.pool_off = {str(x) for x in rd.get("pool_off") or [] if isinstance(x, str)}
    run.pool_full = {str(x) for x in rd.get("pool_full") or [] if isinstance(x, str)}
    try:  # kart kimlikleri hiçbir zaman yeniden verilmez (devamda da)
        run.card_seq = max(0, int(rd.get("card_seq") or 0))
    except (TypeError, ValueError):
        run.card_seq = 0
    run.cap_stop = {str(x) for x in rd.get("cap_stop") or [] if isinstance(x, str)}
    ba = rd.get("budget_auto") if isinstance(rd.get("budget_auto"), dict) else p.get("budget_auto")
    run.budget_auto = dict(ba) if isinstance(ba, dict) else None
    cr = rd.get("cap_ref")
    run.cap_ref = float(cr) if isinstance(cr, (int, float)) and not isinstance(cr, bool) and cr > 0 else None
    uc = rd.get("ud_cap")
    run.ud_cap = ({"metric": str(uc.get("metric") or "tokens"), "value": float(uc["value"])}
                  if isinstance(uc, dict) and isinstance(uc.get("value"), (int, float)) else None)
    cr2 = rd.get("crash")
    run.crash = dict(cr2) if isinstance(cr2, dict) else None
    ko = rd.get("kept_overrun")  # kararı verilmemiş korunan aşım devamda yeniden sorulur
    run.kept_overrun = {**ko, "asked": False} if isinstance(ko, dict) else None
    try:
        run.budget = Budget.parse(p.get("budget") if isinstance(p.get("budget"), dict) else data.get("budget"))
    except Exception:  # noqa: BLE001 - bozuk bütçe: sınırsız
        run.budget = Budget()
    u = data.get("usage") or {}
    run.usage = Usage(tokens=float(u.get("tokens") or 0), cost_usd=u.get("cost_usd"), minutes=float(u.get("minutes") or 0),
                      steps=int(u.get("steps") or 0), cost_basis=str(u.get("cost_basis") or "unknown"),
                      replayed={k: float(v or 0) for k, v in (u.get("replayed") or {}).items()} or
                      {"tokens": 0.0, "cost_usd": 0.0, "minutes": 0.0},
                      inherited={k: float(v or 0) for k, v in (u.get("inherited") or {}).items()} or
                      {"tokens": 0.0, "cost_usd": 0.0, "minutes": 0.0},
                      # öldürülen uçuştaki turun işaretli tahmini (zaten `replayed` içinde)
                      estimated={k: float(v or 0) for k, v in (u.get("estimated_unrecorded") or {}).items()} or
                      {"tokens": 0.0, "cost_usd": 0.0})
    # kontrol noktasından SONRA ödenen turlar (motor kullanımı her tur sınırında yalnız `usage` alanına yazar):
    # aradaki fark `replayed`e eklenir; kayıtlı harcama gerçeğin en çok bir tur gerisinde kalır
    try:
        live = (p.get("usage") or {}).get("spent") or {}
        snap = u.get("spent") or {}
        for k in ("tokens", "cost_usd", "minutes"):
            gap = float(live.get(k) or 0) - float(snap.get(k) or 0)
            if gap > 0:
                run.usage.replayed[k] = float(run.usage.replayed.get(k) or 0) + gap
    except (TypeError, ValueError, AttributeError):
        pass
    run.effects = EffectLog(data.get("effects") or [])
    run.effects.mark_unknown()  # kesinti anında bekleyen etkiler belirsiz
    fly = (p.get("usage") or {}).get("inflight_est") if p.get("status") in ("running", "interrupted") else None

    budgets: dict[str, _Budget] = {}
    for item in data["steps"]:
        sd = item.get("spec") or {}
        sspec = StepSpec(**{k: v for k, v in sd.items() if k in StepSpec.__dataclass_fields__})
        st = StepState(sspec)
        for f in _STEP_FIELDS:
            if f in item and item[f] is not None:
                setattr(st, f, item[f])
        st.output, st.thought = str(item.get("output") or ""), str(item.get("thought") or "")
        st.tools = [{"name": t.get("name"), "input": None, "ok": t.get("ok")} for t in item.get("tools") or []]
        st.approvals = list(item.get("approvals") or [])
        st.artifacts = list(item.get("artifacts") or [])
        st.tokens = dict(item.get("tokens") or {})
        st.rounds = int(item.get("rounds") or 0)
        st.level, st.dlevel = int(item.get("level") or 0), int(item.get("dlevel") or 1)
        st.attempt = int(item.get("attempt") or 0)
        st.assignee_hired = bool(item.get("assignee_hired"))
        st.soft_fail = bool(item.get("soft_fail"))
        if item.get("usage"):
            uu = item["usage"]
            st.usage = StepUsage(tokens=float(uu.get("tokens") or 0), cost_usd=uu.get("cost_usd"),
                                 minutes=float(uu.get("minutes") or 0), cost_basis=str(uu.get("cost_basis") or "unknown"))
        if item.get("limits"):
            try:
                st.limits = Budget.parse(item["limits"])
            except Exception:  # noqa: BLE001
                st.limits = None
        hb = item.get("hire_budget")
        if isinstance(hb, dict):
            owner = str(hb.get("owner") or sspec.id)
            if owner not in budgets:
                budgets[owner] = _Budget(left=int(hb.get("left") or 0), hired=list(hb.get("hired") or []))
            st.budget = budgets[owner]
        fe = fly.get(sspec.id) if isinstance(fly, dict) else None
        # kullanım belgesi kontrol noktasından YENİ olabilir (deneme kontrol noktasından sonra başladı): uçuştaki
        # turun denemesi kayıttakiyle aynı ya da ondan yeniyse tahmin eklenir (önceden yalnız aynı deneme: tahmin düşüyordu)
        if isinstance(fe, dict) and int(fe.get("attempt") or -1) >= st.attempt and st.status not in STEP_TERMINAL:
            # süreç çöktüğünde CLI'nin uçuştaki turu hiç bildirilmedi: tur tahmini işaretli olarak eklenir
            tok = max(0.0, float(fe.get("tokens") or 0))
            run.usage.replayed["tokens"] = float(run.usage.replayed.get("tokens") or 0) + tok
            run.usage.estimated["tokens"] = float(run.usage.estimated.get("tokens") or 0) + tok
        # Devam kuralı: yarıda kalan adım baştan çalışır; onay adımı yeniden onay bekler; on_fail kararı beklenen
        # (failed + resume_ask) adım yeniden çalışmaz, karar kartı yeniden açılır
        if st.resume_ask and st.status == "failed":
            st.status, st.finished_at = "pending", None
        elif st.status in STEP_RESETTABLE or st.status not in STEP_TERMINAL and st.status != "pending":
            st.status = "pending"
            st.decision, st.pending_approval, st.finished_at = None, None, None
        step_node = engine.store.find("Step", f"{run.id}:{sspec.id}")
        st.node_id = step_node["id"] if step_node else None
        run.steps[sspec.id] = st
    attach_journal(engine, run)
    return run


def journal_rows(run: "RunState") -> list[tuple[str, dict[str, Any]]]:
    """kontrol noktasından önce günlüğe eklenecek satırlar: her adımın günlüğe girmemiş ASIL kayıtları (adım
    başına bir satır). Kayıtlar `JOURNAL_MARK` (adımın kuşağı) ile işaretlenir; işaret yalnız satırlar yazılınca kalıcıdır
    (yazım başarısızsa `unmark`)."""
    from studio.tools.loop import ledger_original  # noqa: PLC0415
    import uuid  # noqa: PLC0415
    rows: list[tuple[str, dict[str, Any]]] = []
    for st in run.steps.values():
        led = st.tool_ledger if isinstance(st.tool_ledger, list) else None
        if not led:
            continue
        # yeni kayıtlar sondadır: sondan geriye, günlüğe girmiş ilk asıl kayda dek taranır (O(yeni + kuyruk))
        new = []
        for e in reversed(led):
            if not isinstance(e, dict):
                continue
            if JOURNAL_MARK in e:
                break
            if ledger_original(e):
                new.append(e)
        new.reverse()
        if not new:
            continue
        if not st.ledger_gen:
            st.ledger_gen = uuid.uuid4().hex[:12]
        for e in new:
            e[JOURNAL_MARK] = st.ledger_gen
        rows.append((LEDGER_JOURNAL, {"step": st.spec.id, "gen": st.ledger_gen, "entries": copy.deepcopy(new)}))
    return rows


def unmark(rows: list[tuple[str, dict[str, Any]]], run: "RunState") -> None:
    """Günlük yazılamadı: kayıtların işareti kalkar (bir sonraki kontrol noktası onları yine kuyrukta yazar)."""
    for _t, data in rows:
        st = run.steps.get(str(data.get("step")))
        if st is None:
            continue
        keys = {e.get("key") for e in data.get("entries") or []}
        for e in st.tool_ledger:
            if isinstance(e, dict) and e.get(JOURNAL_MARK) == data.get("gen") and e.get("key") in keys:
                e.pop(JOURNAL_MARK, None)


def op_row(st: "StepState", op: str) -> tuple[str, dict[str, Any]] | None:
    """günlüğe girmiş kayıtları değiştiren işlem (ör. "baştan çalıştır" → `void`): kayıtlar yerinde
    değiştirilmez, işlem satırı eklenir; geri yüklemede o ana kadar günlüğe girmiş kayıtlara uygulanır."""
    if not st.ledger_gen or not any(isinstance(e, dict) and e.get(JOURNAL_MARK) == st.ledger_gen
                                    for e in st.tool_ledger):
        return None
    return (LEDGER_JOURNAL, {"step": st.spec.id, "gen": st.ledger_gen, "op": op})


def attach_journal(engine: Any, run: "RunState") -> None:
    """geri yüklemede adımların günlükteki asıl kayıtları (aynı kuşak) deftere geri eklenir; işlem satırları
    (`void`, `pooled`) sırayla uygulanır. Kontrol noktası kuyruğunda aynı kayıt (çökme: günlük yazıldı, kontrol noktası
    yazılmadı) varsa günlükteki kalır. Günlük okunamazsa defter yalnız kontrol noktasındakidir."""
    reader = getattr(getattr(engine, "store", None), "run_journal", None)
    if reader is None:
        return
    try:
        rows = reader(run.id, LEDGER_JOURNAL)
    except Exception:  # noqa: BLE001 - eski depo / okuma hatası: yalnız kontrol noktası
        return
    got: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        st = run.steps.get(str(r.get("step")))
        if st is None or not st.ledger_gen or r.get("gen") != st.ledger_gen:
            continue
        lst = got.setdefault(st.spec.id, [])
        if r.get("op") == "void":
            for e in lst:
                e["void"] = True
        elif r.get("op") == "pooled":
            for e in lst:
                if not e.get("replay_of") and not e.get("pooled_from"):
                    e["pooled"] = True
        else:
            lst.extend(dict(e) for e in r.get("entries") or [] if isinstance(e, dict))
    for sid, lst in got.items():
        st = run.steps[sid]
        have = {e.get("key") for e in lst}
        tail = [e for e in st.tool_ledger if not (isinstance(e, dict) and e.get("key") in have)]
        st.tool_ledger = [*lst, *tail]
