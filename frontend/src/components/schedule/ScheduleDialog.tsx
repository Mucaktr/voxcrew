// Ekip S25 — zamanlama oluştur/düzenle: her tür (cron, aralık, tek sefer, webhook, dosya izleme, heartbeat), hedef
// (görev / iş akışı / hedef), gözetimsiz onay (yalnızca duraklat | reddet), eşzamanlılık, kaçan tetik, bütçe.
// CG2: klasör (mutlak klasör + durulma), e-posta etiketi ve toplantı bitişi (MCP) tetikleyicileri ve tarif hedefi.
import { CalendarClock, Info, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { recipesApi, type RecipeCard, type RecipeInput } from "../../full/more";
import { EDITION } from "../../edition";
import { triggersMsg } from "../../locales/triggers";
import { EMPTY_TRIGGER, FolderExtra, McpTriggerFields, TriggerInputSelect, triggerMissing, type TriggerDraft } from "./TriggerFields";
import { goalsApi, walkGoals, type Goal } from "../../lib/goals";
import { useT } from "../../lib/i18n";
import {
  CRON_EXAMPLES, DEFAULT_POLICY, SCHEDULE_KINDS, UNIT_SECONDS, cronLooksValid, scheduleApi, splitInterval, useSchedules,
  TRIGGER_KINDS, type ApprovalPolicy, type CatchUpPolicy, type ConcurrencyPolicy, type Schedule, type ScheduleInput,
  type ScheduleKind, type ScheduleTarget,
} from "../../lib/schedule";
import { useStudio } from "../../lib/store";
import type { Workflow } from "../../lib/types";
import { scheduleMsg as m } from "../../locales/schedule";
import { Button, Field, Modal, OptionGrid, Segmented, Toggle } from "../ui";
import { TokenReveal } from "./TokenReveal";

type TargetType = "task" | "workflow" | "recipe" | "goal" | "none";
type Unit = "m" | "h" | "d";

interface Draft {
  title: string;
  kind: ScheduleKind;
  cron: string;
  every: number;
  unit: Unit;
  at: string;
  path: string;
  glob: string;
  stuckMin: number;
  targetType: TargetType;
  agent: string;
  prompt: string;
  workflow: string;
  inputs: Record<string, string>;
  goalId: string;
  recipe: string;
  triggerInput: string;
  trig: TriggerDraft;
  approvals: ApprovalPolicy;
  concurrency: ConcurrencyPolicy;
  catchUp: CatchUpPolicy;
  budgetTokens: string;
  budgetMinutes: string;
  enabled: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO → `<input type="datetime-local">` değeri (yerel saat). */
function toLocalInput(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3600_000);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyDraft(): Draft {
  return {
    title: "", kind: "interval", cron: "0 9 * * 1-5", every: 1, unit: "h", at: toLocalInput(), path: ".", glob: "*",
    stuckMin: 60, targetType: "task", agent: "", prompt: "", workflow: "", inputs: {}, goalId: "", recipe: "",
    triggerInput: "", trig: { ...EMPTY_TRIGGER },
    approvals: DEFAULT_POLICY.approvals, concurrency: DEFAULT_POLICY.concurrency, catchUp: DEFAULT_POLICY.catch_up,
    budgetTokens: "", budgetMinutes: "", enabled: true,
  };
}

function withTarget(d: Draft, target: ScheduleTarget | null | undefined): Draft {
  if (!target) return { ...d, targetType: d.kind === "heartbeat" ? "none" : d.targetType };
  if (target.type === "task") return { ...d, targetType: "task", agent: target.agent, prompt: target.prompt };
  if (target.type === "workflow") return { ...d, targetType: "workflow", workflow: target.workflow, inputs: { ...(target.inputs ?? {}) }, triggerInput: target.trigger_input ?? "" };
  if (target.type === "recipe") return { ...d, targetType: "recipe", recipe: target.recipe, inputs: { ...(target.inputs ?? {}) }, triggerInput: target.trigger_input ?? "" };
  return { ...d, targetType: "goal", goalId: target.goal_id };
}

function fromSchedule(s: Schedule): Draft {
  const base = emptyDraft();
  const iv = splitInterval(s.spec.every_s ?? (s.kind === "heartbeat" ? 900 : 3600));
  const d: Draft = {
    ...base, title: s.title, kind: s.kind, cron: s.spec.cron ?? base.cron, every: iv.value, unit: iv.unit,
    at: toLocalInput(s.spec.at), path: s.spec.path ?? ".", glob: s.spec.glob ?? "*", stuckMin: s.spec.stuck_min ?? 60,
    approvals: s.policy?.approvals ?? "pause", concurrency: s.policy?.concurrency ?? "skip_if_running",
    catchUp: s.policy?.catch_up ?? "once", budgetTokens: s.policy?.budget?.tokens != null ? String(s.policy.budget.tokens) : "",
    budgetMinutes: s.policy?.budget?.minutes != null ? String(s.policy.budget.minutes) : "", enabled: s.enabled,
    trig: {
      debounce: s.spec.debounce_s ?? 0, server: s.spec.server ?? "", label: s.spec.label ?? "",
      everyMin: Math.max(2, Math.round((s.spec.every_s ?? 300) / 60)), match: s.spec.match ?? "keyword",
      keyword: s.spec.keyword ?? "", eventId: s.spec.event_id ?? "", eventTitle: s.spec.event_title ?? "",
    },
  };
  return withTarget(d, s.target);
}

function toInput(d: Draft): ScheduleInput {
  const every_s = Math.max(1, Math.round(d.every || 0)) * UNIT_SECONDS[d.unit];
  const spec = d.kind === "cron" ? { cron: d.cron.trim() }
    : d.kind === "interval" ? { every_s }
    : d.kind === "heartbeat" ? { every_s, stuck_min: d.stuckMin }
    : d.kind === "once" ? { at: d.at ? new Date(d.at).toISOString() : "" }
    : d.kind === "file_watch" ? { path: d.path.trim() || ".", glob: d.glob.trim() || "*", debounce_s: d.trig.debounce }
    : d.kind === "email_label" ? { server: d.trig.server, label: d.trig.label.trim(), every_s: d.trig.everyMin * 60 }
    : d.kind === "meeting_end" ? {
      server: d.trig.server, every_s: d.trig.everyMin * 60, match: d.trig.match,
      ...(d.trig.match === "keyword" ? { keyword: d.trig.keyword.trim() } : { event_id: d.trig.eventId, event_title: d.trig.eventTitle }),
    }
    : {};
  const trig = TRIGGER_KINDS.includes(d.kind) && d.triggerInput ? { trigger_input: d.triggerInput } : {};
  const target: ScheduleTarget | null = d.targetType === "task" ? { type: "task", agent: d.agent, prompt: d.prompt }
    : d.targetType === "workflow" ? { type: "workflow", workflow: d.workflow, inputs: d.inputs, ...trig }
    : d.targetType === "recipe" ? { type: "recipe", recipe: d.recipe, inputs: d.inputs, ...trig }
    : d.targetType === "goal" ? { type: "goal", goal_id: d.goalId }
    : null;
  const budget: Record<string, number> = {};
  if (d.budgetTokens.trim()) budget.tokens = Number(d.budgetTokens);
  if (d.budgetMinutes.trim()) budget.minutes = Number(d.budgetMinutes);
  return {
    title: d.title.trim(), kind: d.kind, spec, target, enabled: d.enabled,
    policy: { approvals: d.approvals, concurrency: d.concurrency, catch_up: d.catchUp, budget: Object.keys(budget).length ? budget : undefined },
  };
}

export function ScheduleDialog({ open, onClose, schedule, prefill, onSaved }: {
  open: boolean;
  onClose: () => void;
  /** düzenlenecek zamanlama; yoksa oluşturma */
  schedule?: Schedule | null;
  /** oluşturmada önceden doldurulan hedef (ScheduleButton) */
  prefill?: { target?: ScheduleTarget; title?: string; kind?: ScheduleKind; cron?: string };
  onSaved?: (s: Schedule) => void;
}) {
  const t = useT(m);
  const tt = useT(triggersMsg);
  const allAgents = useStudio((s) => s.agents);
  const agents = useMemo(() => allAgents.filter((a) => !a.hidden).sort((a, b) => a.name.localeCompare(b.name)), [allAgents]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [goals, setGoals] = useState<{ id: string; title: string; depth: number }[]>([]);
  const [recipes, setRecipes] = useState<RecipeCard[]>([]);
  const [recipeInputs, setRecipeInputs] = useState<RecipeInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ schedule: Schedule; token?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaved(null);
    const base = emptyDraft();
    const kind = prefill?.kind ?? base.kind;
    setDraft(schedule ? fromSchedule(schedule) : withTarget({
      ...base, title: prefill?.title ?? "", kind, cron: prefill?.cron ?? base.cron,
      concurrency: TRIGGER_KINDS.includes(kind) ? "queue" : base.concurrency,
    }, prefill?.target));
    let alive = true;
    api.workflows().then((w) => { if (alive) setWorkflows(w.filter((x) => !x.error)); }).catch(() => undefined);
    recipesApi.list().then((r) => { if (alive) setRecipes(r.items); }).catch(() => undefined);
    goalsApi.list().then((roots: Goal[]) => {
      if (!alive) return;
      const flat: { id: string; title: string; depth: number }[] = [];
      walkGoals(roots, (g, depth) => flat.push({ id: g.id, title: g.title, depth }));
      setGoals(flat);
    }).catch(() => undefined);
    return () => { alive = false; };
    // yalnızca açılışta / başka zamanlama seçilince sıfırlanır (canlı güncelleme taslağı ezmesin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schedule?.id]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setTrig = (p: Partial<TriggerDraft>) => setDraft((d) => ({ ...d, trig: { ...d.trig, ...p } }));
  const wf = workflows.find((w) => w.slug === draft.workflow);
  const editing = !!schedule;
  const eventKind = TRIGGER_KINDS.includes(draft.kind);
  // CG2: tarif seçilince girdileri (ayrıntıdan) getir
  useEffect(() => {
    if (!open || draft.targetType !== "recipe" || !draft.recipe) { setRecipeInputs([]); return; }
    let alive = true;
    recipesApi.detail(draft.recipe).then((d) => { if (alive) setRecipeInputs(d.inputs); }).catch(() => undefined);
    return () => { alive = false; };
  }, [open, draft.targetType, draft.recipe]);
  const recipeHint = recipes.find((r) => r.id === draft.recipe)?.schedule?.trigger_input ?? "";
  const triggerSlot = draft.triggerInput || (draft.targetType === "recipe" ? recipeHint : "");

  const missing = (() => {
    if (draft.kind === "cron" && !cronLooksValid(draft.cron)) return t("err_cron");
    if (draft.kind === "once" && !draft.at) return t("err_at");
    if (draft.targetType === "task" && (!draft.agent || !draft.prompt.trim())) return t("err_task");
    if (draft.targetType === "workflow" && !draft.workflow) return t("err_workflow");
    if (draft.targetType === "goal" && !draft.goalId) return t("err_goal");
    if (draft.targetType === "recipe" && !draft.recipe) return tt("err_recipe");
    const trigErr = triggerMissing(draft.kind, draft.trig, tt);
    if (trigErr) return trigErr;
    if (draft.targetType === "none" && draft.kind !== "heartbeat") return t("err_target");
    return null;
  })();

  const save = async () => {
    if (missing) { setError(missing); return; }
    setBusy(true);
    setError(null);
    try {
      const res = schedule ? await scheduleApi.update(schedule.id, toInput(draft)) : await scheduleApi.create(toInput(draft));
      const { token, ...plain } = res;
      useSchedules.getState().upsert(plain);
      onSaved?.(plain);
      if (token || (!schedule && plain.kind === "webhook")) setSaved({ schedule: plain, token });
      else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (!schedule) return;
    setBusy(true);
    try {
      const res = await scheduleApi.regenerateToken(schedule.id);
      const { token, ...plain } = res;
      useSchedules.getState().upsert(plain);
      setSaved({ schedule: plain, token });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const kindOptions = SCHEDULE_KINDS.map((k) => ({ id: k, label: t(`kind_${k}`) }));
  const targetOptions: { value: TargetType; label: string }[] = [
    { value: "task", label: t("target_task") }, { value: "workflow", label: t("target_workflow") },
    ...((EDITION as string) === "free" ? [] : [{ value: "recipe" as TargetType, label: tt("target_recipe") }]), { value: "goal", label: t("target_goal") },
    ...(draft.kind === "heartbeat" ? [{ value: "none" as TargetType, label: t("target_none") }] : []),
  ];

  return (
    <Modal open={open} onClose={onClose} width={680}
      title={saved ? t("saved_title") : editing ? t("edit_title") : t("create_title")}
      footer={saved ? (
        <Button variant="primary" onClick={onClose}>{t("done")}</Button>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
          <Button variant="primary" icon={<Save size={16} />} disabled={busy} onClick={save}>
            {busy ? t("saving") : editing ? t("save") : t("create")}
          </Button>
        </>
      )}>
      {saved ? (
        <TokenReveal id={saved.schedule.id} token={saved.token} />
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <p className="text-xs text-ink-2 flex items-start gap-1.5">
            <Info size={14} className="shrink-0 mt-0.5" aria-hidden="true" />{t("only_while_running")}
          </p>
          <Field label={t("title")} hint={t("title_hint")}>
            <input className="input" value={draft.title} maxLength={120} aria-label={t("title")}
              onChange={(e) => set("title", e.target.value)} placeholder={t("title_ph")} />
          </Field>

          <Field label={t("kind")}>
            <OptionGrid cols={3} options={kindOptions} value={draft.kind}
              onChange={(k) => setDraft((d) => ({
                ...d, kind: k, targetType: k !== "heartbeat" && d.targetType === "none" ? "task" : d.targetType,
                // CG2: olay tetikleyicisinde aynı anda birkaç olay gelebilir: yeni zamanlamada varsayılan "sıraya al"
                concurrency: !editing && TRIGGER_KINDS.includes(k) ? "queue" : d.concurrency,
              }))} />
          </Field>

          {/* ---- türe göre zaman/tetik ayarı */}
          {draft.kind === "cron" && (
            <Field label={t("cron_expr")} hint={t("cron_help")}>
              <input className="input font-mono" value={draft.cron} aria-label={t("cron_expr")} spellCheck={false}
                aria-invalid={!cronLooksValid(draft.cron)} onChange={(e) => set("cron", e.target.value)} placeholder="0 9 * * 1-5" />
              <div className="flex flex-wrap gap-1.5 mt-1" role="group" aria-label={t("cron_examples")}>
                {CRON_EXAMPLES.map((ex) => (
                  <Button key={ex.expr} size="sm" variant={draft.cron === ex.expr ? "primary" : "default"}
                    aria-pressed={draft.cron === ex.expr} onClick={() => set("cron", ex.expr)}>
                    {t(ex.key)}
                  </Button>
                ))}
              </div>
            </Field>
          )}
          {(draft.kind === "interval" || draft.kind === "heartbeat") && (
            <div className="flex flex-wrap gap-3">
              <Field label={draft.kind === "heartbeat" ? t("check_every") : t("every")} className="basis-40">
                <div className="flex gap-2">
                  <input type="number" min={1} className="input !w-24" value={draft.every} aria-label={t("every")}
                    onChange={(e) => set("every", Number(e.target.value))} />
                  <select className="select !w-auto" value={draft.unit} aria-label={t("unit")}
                    onChange={(e) => set("unit", e.target.value as Unit)}>
                    <option value="m">{t("unit_m")}</option>
                    <option value="h">{t("unit_h")}</option>
                    <option value="d">{t("unit_d")}</option>
                  </select>
                </div>
              </Field>
              {draft.kind === "heartbeat" && (
                <Field label={t("stuck_min")} hint={t("stuck_min_hint")} className="basis-40">
                  <input type="number" min={1} className="input !w-28" value={draft.stuckMin} aria-label={t("stuck_min")}
                    onChange={(e) => set("stuckMin", Number(e.target.value))} />
                </Field>
              )}
            </div>
          )}
          {draft.kind === "heartbeat" && <p className="text-xs text-ink-2">{t("heartbeat_help")}</p>}
          {draft.kind === "interval" && <p className="text-xs text-muted">{t("interval_min")}</p>}
          {draft.kind === "once" && (
            <Field label={t("at")}>
              <input type="datetime-local" className="input !w-auto" value={draft.at} aria-label={t("at")}
                onChange={(e) => set("at", e.target.value)} />
            </Field>
          )}
          {draft.kind === "webhook" && (
            editing ? (
              <div className="panel-soft p-3 flex flex-col gap-2">
                <TokenReveal id={schedule!.id} />
                <div>
                  <Button size="sm" icon={<RefreshCw size={14} />} disabled={busy} onClick={regenerate}>{t("regenerate_token")}</Button>
                </div>
              </div>
            ) : <p className="text-xs text-ink-2">{t("webhook_help")}</p>
          )}
          {draft.kind === "file_watch" && (
            <div className="flex flex-wrap gap-3">
              <Field label={t("watch_path")} hint={tt("watch_path_hint")} className="flex-1 min-w-[12rem]">
                <input className="input font-mono" value={draft.path} aria-label={t("watch_path")} spellCheck={false}
                  onChange={(e) => set("path", e.target.value)} placeholder="." />
              </Field>
              <Field label={t("watch_glob")} hint={t("watch_glob_hint")} className="basis-40">
                <input className="input font-mono" value={draft.glob} aria-label={t("watch_glob")} spellCheck={false}
                  onChange={(e) => set("glob", e.target.value)} placeholder="*.md" />
              </Field>
            </div>
          )}
          {draft.kind === "file_watch" && <FolderExtra value={draft.trig} onChange={setTrig} />}
          {(draft.kind === "email_label" || draft.kind === "meeting_end") && (
            <McpTriggerFields kind={draft.kind} value={draft.trig} onChange={setTrig} />
          )}

          {/* ---- hedef */}
          <Field label={t("target")}>
            <Segmented value={draft.targetType} onChange={(v) => set("targetType", v)} options={targetOptions} className="flex-wrap" />
          </Field>
          {draft.targetType === "task" && (
            <>
              <Field label={t("agent")}>
                <select className="select" value={draft.agent} aria-label={t("agent")} onChange={(e) => set("agent", e.target.value)}>
                  <option value="">{t("pick_agent")}</option>
                  {agents.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                </select>
              </Field>
              <Field label={t("prompt")} hint={t("prompt_hint")}>
                <textarea className="textarea" rows={4} maxLength={8000} value={draft.prompt} aria-label={t("prompt")}
                  onChange={(e) => set("prompt", e.target.value)} placeholder={t("prompt_ph")} />
              </Field>
            </>
          )}
          {draft.targetType === "workflow" && (
            <>
              <Field label={t("workflow")}>
                <select className="select" value={draft.workflow} aria-label={t("workflow")}
                  onChange={(e) => setDraft((d) => ({ ...d, workflow: e.target.value, inputs: {} }))}>
                  <option value="">{t("pick_workflow")}</option>
                  {workflows.map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}
                </select>
              </Field>
              {eventKind && wf && (
                <TriggerInputSelect names={wf.inputs.map((i) => ({ name: i.name, label: i.label || i.name }))}
                  value={draft.triggerInput} onChange={(v) => set("triggerInput", v)} />
              )}
              {wf?.inputs?.map((inp) => (
                <Field key={inp.name} label={inp.label || inp.name}
                  hint={eventKind && inp.name === draft.triggerInput ? tt("trigger_fills") : inp.required === false ? t("optional") : undefined}>
                  <input className="input" value={draft.inputs[inp.name] ?? inp.default ?? ""} aria-label={inp.label || inp.name}
                    disabled={eventKind && inp.name === draft.triggerInput}
                    onChange={(e) => setDraft((d) => ({ ...d, inputs: { ...d.inputs, [inp.name]: e.target.value } }))} />
                </Field>
              ))}
            </>
          )}
          {draft.targetType === "recipe" && (
            <>
              <Field label={tt("recipe")} hint={tt("recipe_no_hire")}>
                <select className="select" value={draft.recipe} aria-label={tt("recipe")}
                  onChange={(e) => setDraft((d) => ({ ...d, recipe: e.target.value, inputs: {}, triggerInput: "" }))}>
                  <option value="">{tt("pick_recipe")}</option>
                  {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </Field>
              {eventKind && recipeInputs.length > 0 && (
                <TriggerInputSelect names={recipeInputs.map((i) => ({ name: i.name, label: i.label }))}
                  value={draft.triggerInput} onChange={(v) => set("triggerInput", v)} />
              )}
              {recipeInputs.map((inp) => {
                const fills = eventKind && inp.name === triggerSlot;
                return (
                  <Field key={inp.name} label={inp.label} hint={fills ? tt("trigger_fills") : inp.required ? undefined : t("optional")}>
                    {inp.type === "select" && inp.options ? (
                      <select className="select" value={draft.inputs[inp.name] ?? inp.default} aria-label={inp.label} disabled={fills}
                        onChange={(e) => setDraft((d) => ({ ...d, inputs: { ...d.inputs, [inp.name]: e.target.value } }))}>
                        {inp.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : inp.type === "textarea" ? (
                      <textarea className="textarea" rows={3} maxLength={4000} value={draft.inputs[inp.name] ?? inp.default}
                        aria-label={inp.label} disabled={fills} placeholder={inp.example}
                        onChange={(e) => setDraft((d) => ({ ...d, inputs: { ...d.inputs, [inp.name]: e.target.value } }))} />
                    ) : (
                      <input className="input" value={draft.inputs[inp.name] ?? inp.default} aria-label={inp.label}
                        disabled={fills} placeholder={inp.example}
                        onChange={(e) => setDraft((d) => ({ ...d, inputs: { ...d.inputs, [inp.name]: e.target.value } }))} />
                    )}
                  </Field>
                );
              })}
            </>
          )}
          {draft.targetType === "goal" && (
            <Field label={t("goal")} hint={t("goal_hint")}>
              <select className="select" value={draft.goalId} aria-label={t("goal")} onChange={(e) => set("goalId", e.target.value)}>
                <option value="">{t("pick_goal")}</option>
                {goals.map((g) => <option key={g.id} value={g.id}>{"  ".repeat(g.depth)}{g.title}</option>)}
              </select>
            </Field>
          )}

          {/* ---- politika */}
          <div className="panel-soft p-3 flex flex-col gap-3">
            <Field label={t("approvals")} hint={draft.approvals === "pause" ? t("approvals_pause_hint") : t("approvals_deny_hint")}>
              <Segmented value={draft.approvals} onChange={(v) => set("approvals", v)}
                options={[{ value: "pause", label: t("approvals_pause") }, { value: "deny", label: t("approvals_deny") }]} />
            </Field>
            <Field label={t("concurrency")} hint={TRIGGER_KINDS.includes(draft.kind) ? tt("event_queue_note") : draft.concurrency === "queue" ? t("concurrency_queue_hint") : t("concurrency_skip_hint")}>
              <Segmented value={draft.concurrency} onChange={(v) => set("concurrency", v)}
                options={[{ value: "skip_if_running", label: t("concurrency_skip") }, { value: "queue", label: t("concurrency_queue") }]} />
            </Field>
            <Field label={t("catch_up")} hint={TRIGGER_KINDS.includes(draft.kind) ? tt("catch_up_event_hint") : t("catch_up_hint")}>
              <Segmented value={draft.catchUp} onChange={(v) => set("catchUp", v)}
                options={[{ value: "once", label: t("catch_up_once") }, { value: "skip", label: t("catch_up_skip") }]} />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Field label={t("budget_tokens")} className="basis-36">
                <input type="number" min={0} className="input" value={draft.budgetTokens} aria-label={t("budget_tokens")}
                  placeholder={t("no_limit")} onChange={(e) => set("budgetTokens", e.target.value)} />
              </Field>
              <Field label={t("budget_minutes")} className="basis-36">
                <input type="number" min={0} className="input" value={draft.budgetMinutes} aria-label={t("budget_minutes")}
                  placeholder={t("no_limit")} onChange={(e) => set("budgetMinutes", e.target.value)} />
              </Field>
            </div>
          </div>

          <Toggle checked={draft.enabled} onChange={(v) => set("enabled", v)} aria-label={t("enabled")}
            label={<span className="inline-flex items-center gap-1.5"><CalendarClock size={15} aria-hidden="true" />{t("enabled")}</span>}
            hint={t("enabled_hint")} />

          {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
