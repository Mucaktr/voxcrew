import "@xyflow/react/dist/style.css";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import {
  AlertTriangle, BookOpen, Bot, Copy, Hand, ListChecks, Play, Plus, Repeat, Save, Search, ShieldCheck, Split, Trash2, UserCog, Workflow as WorkflowIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PixelFace } from "../components/PixelFace";
import { ConfirmDialog, Note } from "../components/hermes/common";
import { deliverableIds, deliverableValue, deliverableWarning, weakWriterWarnings } from "../components/workflows/deliverable";
import {
  DELEGATE_DEFAULTS, ensureHierarchySync, holderMap, stepAgent, useHierarchy, type FlowStep, type RoleInfo,
} from "../components/office/hierarchy";
import { Badge, Button, Empty, Field, Modal, NotFound, PageHeader, Panel, Segmented, Spinner, Toggle } from "../components/ui";
import { ShareButtons } from "../components/share/ShareButtons";
import { OutputTemplatesButton } from "../components/share/OutputTemplates";
import { ORCHESTRATE_DEFAULTS, OrchestrateEditor, type OrchestrateStep } from "../components/workflows/OrchestrateEditor";
import { clearApprovalUnlessAgent, setStepApproval, stepApproval, type StepApproval } from "../components/workflows/stepApproval";
import { byName } from "../lib/agents";
import { api } from "../lib/api";
import { fold } from "../lib/hermes";
import { tx, useT } from "../lib/i18n";
import { useStudio } from "../lib/store";
import type { Agent, Workflow, WorkflowStep, WorkflowWarning } from "../lib/types";
import { workflowsMsg as m } from "../locales/workflows";
import { ScheduleButton } from "../components/schedule/ScheduleButton";
import { EstimatePanel, type CapState } from "../full/composer";
import type { EstimateSpec } from "../full/data";

type WorkflowX = Workflow & { example?: boolean };
/** Bu sayıdan çok ajanda atanan seçicide arama kutusu görünür ve liste kısaltılır. */
const PICKER_SEARCH_AT = 12;
const PICKER_MAX = 24;

/** Rol adımı olup sahibi olmayanlar (sunucu doğrulaması rolleri bilmiyorsa da arayüz uyarır): "X rolünde ajan yok". */
function roleErrors(wf: Workflow, roles: RoleInfo[]): string[] {
  const out: string[] = [];
  for (const s of wf.steps as FlowStep[]) {
    if (s.type === "approval" || s.agent || !s.role) continue;
    const r = roles.find((x) => x.id === s.role);
    if (!r?.holder) out.push(tx(m, "role_no_agent", { id: s.id, role: s.role }));
  }
  return out;
}

function layers(wf: Workflow): Record<string, number> {
  const depth: Record<string, number> = {};
  const visit = (id: string, seen: Set<string>): number => {
    if (depth[id] != null) return depth[id];
    if (seen.has(id)) return 0;
    seen.add(id);
    const s = wf.steps.find((x) => x.id === id);
    const d = s?.depends_on?.length ? Math.max(...s.depends_on.map((p) => visit(p, seen) + 1)) : 0;
    depth[id] = d;
    return d;
  };
  wf.steps.forEach((s) => visit(s.id, new Set()));
  return depth;
}

type StepNodeData = { step: FlowStep; agent?: Agent; roleName?: string; selected: boolean };

function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const t = useT(m);
  const { step, agent, roleName, selected } = data;
  const approval = step.type === "approval";
  const delegate = step.type === "delegate";
  const who = agent?.name ?? (step.role ? t("node_no_role_agent") : `? ${step.agent ?? ""}`);
  const gate = stepApproval(step);
  return (
    <div className={clsx("rounded-xl border-2 border-line px-3 py-2.5 w-[220px] shadow-[0_4px_0_var(--shadow)]",
      approval ? "bg-[var(--warn-bg)]" : "bg-panel", selected && "outline-3 outline-amethyst outline-offset-2")}>
      <Handle type="target" position={Position.Left} className="!bg-ink !w-2.5 !h-2.5 !rounded-[3px]" />
      <div className="flex items-center gap-2">
        {approval ? <span className="h-9 w-9 rounded-lg grid place-items-center bg-gold border-2 border-line"><ShieldCheck size={17} /></span>
          : <PixelFace avatar={agent?.avatar} size={36} ring={agent?.color} />}
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{step.title || step.id}</div>
          <div className="text-xs text-muted truncate">
            {approval ? t("node_human_approval") : step.role ? `${roleName ?? step.role} · ${who}` : who}
          </div>
        </div>
      </div>
      {delegate && <div className="mt-1.5 chip tone-info"><Split size={12} /> {t("node_delegates", { n: step.depth ?? DELEGATE_DEFAULTS.depth })}</div>}
      {step.type === "orchestrate" && <div className="mt-1.5 chip tone-info"><ListChecks size={12} /> {t("node_orchestrates", { n: (step as OrchestrateStep).max_replans ?? ORCHESTRATE_DEFAULTS.max_replans })}</div>}
      {step.revise && <div className="mt-1.5 chip tone-warn"><Repeat size={12} /> {t("node_reviews", { target: step.revise.target })}</div>}
      {gate !== "none" && (
        <div className="mt-1.5 chip tone-warn" title={t(gate === "after" ? "gate_after_hint" : "gate_before_hint")}>
          <ShieldCheck size={12} aria-hidden /> {t(gate === "after" ? "node_gate_after" : "node_gate_before")}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-ink !w-2.5 !h-2.5 !rounded-[3px]" />
    </div>
  );
}
const nodeTypes = { step: StepNode };

const blankWorkflow = (n: number): Workflow => {
  const topic = tx(m, "input_topic");
  return {
    slug: tx(m, "new_slug", { n }), name: tx(m, "new_name"), description: "", icon: "workflow",
    inputs: [{ name: topic, label: tx(m, "input_topic_label"), type: "text", required: true }],
    steps: [{ id: "adim-1", type: "agent", title: tx(m, "first_step"), agent: "", prompt: tx(m, "first_prompt"), depends_on: [] }],
  };
};

export default function WorkflowsPage() {
  const t = useT(m);
  const { slug } = useParams();
  const navigate = useNavigate();
  const agents = useStudio((s) => s.agents);
  const roles = useHierarchy((s) => s.roles);
  const holders = useMemo(() => holderMap(roles), [roles]);
  const [list, setList] = useState<WorkflowX[] | null>(null);
  const [draft, setDraft] = useState<Workflow | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [serverErrors, setErrors] = useState<string[]>([]);
  // sunucunun zayıf yazar uyarıları (adında boyut olmayan yerel model: Ollama ayrıntısı ya da "küçük olabilir")
  const [serverWarnings, setServerWarnings] = useState<WorkflowWarning[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // QA-m11: liste hatası yakalanır ve gösterilir
  const reload = () => api.workflows().then((ws) => setList(ws as WorkflowX[]))
    .catch((e: unknown) => { setList((l) => l ?? []); setMsg(e instanceof Error ? e.message : String(e)); });
  useEffect(() => {
    void reload();
    ensureHierarchySync();
    void useHierarchy.getState().refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const errors = useMemo(() => {
    if (!draft) return serverErrors;
    const extra = roleErrors(draft, roles).filter((e) => !serverErrors.includes(e));
    return [...serverErrors, ...extra];
  }, [serverErrors, draft, roles]);
  useEffect(() => {
    if (!list) return;
    const wf = list.find((w) => w.slug === slug) ?? (!slug ? list[0] : undefined);
    if (wf && wf.slug !== draft?.slug) {
      setDraft(structuredClone(wf));
      setSelected(wf.steps[0]?.id ?? null);
      setDirty(false);
    }
  }, [list, slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!draft) return;
    const id = window.setTimeout(() => api.validateWorkflow(draft).then((r) => {
      setErrors(r.errors);
      setServerWarnings(Array.isArray(r.warnings) ? r.warnings : null);
    }).catch(() => undefined), 350);
    return () => window.clearTimeout(id);
  }, [draft]);

  const deliverWarn = useMemo(() => (draft ? deliverableWarning(draft, agents) : null), [draft, agents]);
  // PROC2-FIX doğrulanmış olgulara sadakat isteyen adım küçük yerel modelde → uyarı (beyin otomatik değişmez)
  // sunucu kuralı esastır (kaydet/doğrula, API ve MCP aynı uyarıyı görür); yanıt gelene dek istemci tahmini
  const localWeak = useMemo(() => (draft ? weakWriterWarnings(draft, agents) : []), [draft, agents]);
  const weakWriters = useMemo(() => serverWarnings
    ? serverWarnings.filter((w) => w.code === "weak_local_writer" || w.code === "weak_local_writer_unknown")
      .map((w) => ({ step: w.step, model: w.model, size: w.size_b, unknown: w.code === "weak_local_writer_unknown" }))
    : localWeak.map((w) => ({ ...w, unknown: false })), [serverWarnings, localWeak]);
  const setDeliverable = (w: Workflow, ids: string[]) => {
    const v = deliverableValue(w, ids);
    if (v === undefined) delete w.deliverable; else w.deliverable = v;
  };
  const stepTitle = (id: string) => draft?.steps.find((s) => s.id === id)?.title || id;
  const update = (fn: (w: Workflow) => void) => {
    setDraft((d) => { if (!d) return d; const c = structuredClone(d); fn(c); return c; });
    setDirty(true);
  };

  const { nodes, edges } = useMemo(() => {
    if (!draft) return { nodes: [], edges: [] };
    const depth = layers(draft);
    const rows: Record<number, number> = {};
    const nodes: Node<StepNodeData>[] = draft.steps.map((s) => {
      const d = depth[s.id] ?? 0;
      const r = (rows[d] = (rows[d] ?? -1) + 1);
      const fs = s as FlowStep;
      const who = stepAgent(fs, holders);
      return { id: s.id, type: "step", position: { x: d * 290, y: r * 130 },
        data: { step: fs, agent: agents.find((a) => a.slug === who), selected: s.id === selected,
                roleName: fs.role ? roles.find((x) => x.id === fs.role)?.name : undefined } };
    });
    const edges: Edge[] = draft.steps.flatMap((s) => (s.depends_on ?? []).map((d) => ({
      id: `${d}->${s.id}`, source: d, target: s.id, type: "smoothstep", animated: true,
      markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 2.5, stroke: "var(--ink-2)" },
    })));
    draft.steps.filter((s) => s.revise?.target).forEach((s) => edges.push({
      id: `rev-${s.id}`, source: s.id, target: s.revise!.target, type: "smoothstep", label: `${t("node_reviews", { target: "" }).replace(/:\s*$/, "")} ↺`,
      style: { stroke: "var(--red)", strokeDasharray: "6 4", strokeWidth: 2 }, labelStyle: { fontSize: 12, fontWeight: 600, fill: "var(--bad-fg)" },
      labelBgStyle: { fill: "var(--panel)" },
    }));
    return { nodes, edges };
  }, [draft, agents, selected, holders, roles, t]);

  const save = async () => {
    if (!draft) return;
    try {
      const saved = await api.saveWorkflow(draft);
      setDirty(false);
      setMsg(t("saved"));
      await reload();
      navigate(`/akislar/${saved.slug}`, { replace: true });
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };

  const step = draft?.steps.find((s) => s.id === selected);
  const visibleAgents = useMemo(() => agents.filter((a) => !a.hidden), [agents]);

  return (
    <div className="p-3 sm:p-5 flex flex-col gap-4 max-w-[1680px] mx-auto">
      <PageHeader title={t("page_title")} subtitle={t("page_subtitle")}
        actions={<>
          <ShareButtons kinds={["job", "output"]} onImported={() => void reload()} />
          {/* karar 12: açık taslak aynı akışsa kalite bloğu güncellenir (eski taslağın kaydı şablonu ezmesin) */}
          <OutputTemplatesButton onApplied={(applied, quality) => {
            setDraft((d) => (d && d.slug === applied ? { ...d, quality } as Workflow : d));
            void reload();
          }} />
          <Button icon={<Plus size={16} />} onClick={() => {
            const wf = blankWorkflow((list?.length ?? 0) + 1);
            wf.steps[0].agent = visibleAgents[0]?.slug ?? "";
            setDraft(wf); setSelected(wf.steps[0].id); setDirty(true);
          }}>{t("new")}</Button>
        </>} />
      {/* S39: tek sütunda da ızgara izi minmax(0,1fr) — 375 px'te içerik sağdan kesilmesin */}
      <div className="grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3 min-w-0">
        {!list ? <Spinner /> : list.map((w) => (
          <button key={w.slug} type="button" onClick={() => navigate(`/akislar/${w.slug}`)} aria-pressed={draft?.slug === w.slug}
            className="card-select p-3 flex flex-col gap-1.5">
            <span className="font-semibold text-sm flex items-center gap-2 min-w-0">
              <WorkflowIcon size={15} className="shrink-0" /><span className="truncate">{w.name}</span>
              {w.example && <Badge tone="muted" className="ml-auto shrink-0" title={t("example_title")}><BookOpen size={12} />{t("example")}</Badge>}
            </span>
            {w.description && <span className="text-xs text-muted line-clamp-2">{w.description}</span>}
            <span className="flex items-center gap-1 flex-wrap">
              {w.steps.map((s) => s.type === "approval"
                ? <Hand key={s.id} size={14} className="text-warn" />
                : <PixelFace key={s.id} avatar={agents.find((a) => a.slug === stepAgent(s as FlowStep, holders))?.avatar} size={20} />)}
              {w.steps.some((s) => s.type === "delegate") && <Badge tone="info"><Split size={12} />{t("delegation")}</Badge>}
              {w.steps.some((s) => s.type === "orchestrate") && <Badge tone="info"><ListChecks size={12} />{t("orchestration")}</Badge>}
              {w.error && <Badge tone="bad">{t("invalid")}</Badge>}
            </span>
          </button>
        ))}
      </div>

      {!draft && slug && list && !list.some((w) => w.slug === slug)
        // geçersiz adres sessiz kalmaz
        ? <Panel><NotFound title={t("not_found")} text={t("not_found_text", { slug })} backTo="/akislar" backLabel={t("back_to_list")} /></Panel>
        : !draft ? <Panel><Empty icon={<WorkflowIcon size={28} />} title={t("pick_or_new")} /></Panel> : (
        <div className="flex flex-col gap-4 min-w-0">
          <div className="panel p-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 items-start">
              <div className="flex-1 min-w-[min(100%,20rem)] flex flex-col gap-2">
                <input className="input font-display !text-lg !font-semibold" aria-label={t("name_label")} value={draft.name} onChange={(e) => update((w) => { w.name = e.target.value; })} />
                <input className="input" placeholder={t("description_placeholder")} aria-label={t("description_placeholder")} value={draft.description ?? ""} onChange={(e) => update((w) => { w.description = e.target.value; })} />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button icon={<Save size={16} />} disabled={!dirty || errors.length > 0} onClick={save}>{t("save")}</Button>
                <Button variant="primary" icon={<Play size={16} />} disabled={dirty || errors.length > 0} onClick={() => setRunOpen(true)}
                  title={dirty ? t("save_first") : undefined}>{t("run")}</Button>
                {!dirty && !errors.length && list?.some((w) => w.slug === draft.slug) && (
                  <ScheduleButton target={{ type: "workflow", workflow: draft.slug }} title={draft.name} />
                )}
                <Button variant="ghost" icon={<Copy size={15} />} title={t("duplicate_title")} onClick={() => {
                  update((w) => { w.slug = `${w.slug}${t("copy_suffix")}`; w.name = t("copy_name", { name: w.name }); });
                }} aria-label={t("duplicate")} />
                {/* S39: tarayıcının confirm() penceresi yerine uygulama içi onay; örnek akışlar silinemez → düğme kapalı */}
                <Button variant="ghost" icon={<Trash2 size={15} />} aria-label={t("delete")}
                  disabled={!!list?.find((w) => w.slug === draft.slug)?.example}
                  title={list?.find((w) => w.slug === draft.slug)?.example ? t("example_title") : t("delete")}
                  onClick={() => setConfirmDelete(true)} />
                <ConfirmDialog open={confirmDelete} danger title={t("delete_q", { name: draft.name })} confirmLabel={t("delete")}
                  onClose={() => setConfirmDelete(false)}
                  onConfirm={async () => {
                    setConfirmDelete(false);
                    try {
                      await api.deleteWorkflow(draft.slug);
                    } catch (e) {  // ör. örnek akışlar silinemez
                      setMsg(e instanceof Error ? e.message : String(e));
                      return;
                    }
                    setDraft(null); await reload(); navigate("/akislar");
                  }}>
                  <p>{t("delete_text")}</p>
                </ConfirmDialog>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-muted">{t("slug", { slug: draft.slug })}</span>
              {msg && <Badge tone={msg === t("saved") ? "ok" : "bad"}>{msg}</Badge>}
              {errors.map((e) => <Badge key={e} tone="bad"><AlertTriangle size={12} />{e}</Badge>)}
              {!errors.length && <Badge tone="ok">{t("dag_ok")}</Badge>}
            </div>
            {/* PROC-FIX teslim adımı — kabul, kalite kapısı, sergi ve revizyon bunu hedefler*/}
            {/* PROC2-FIX birden çok teslim adımı seçilebilir (sırayla, başlıklı birleşim); hiçbiri = otomatik*/}
            <fieldset className="flex flex-col gap-1.5 min-w-0">
              <legend className="text-sm font-semibold">{t("deliverable_label")}</legend>
              <p className="text-xs text-muted">{t("deliverable_hint")}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {draft.steps.filter((s) => s.type !== "approval").map((s) => {
                  const ids = deliverableIds(draft);
                  return (
                    <label key={s.id} className="flex items-center gap-1.5 text-sm min-w-0">
                      <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--grass)]" aria-label={s.title || s.id} checked={ids.includes(s.id)}
                        onChange={(e) => update((w) => setDeliverable(w, e.target.checked
                          ? [...deliverableIds(w), s.id] : deliverableIds(w).filter((x) => x !== s.id)))} />
                      <span className="break-words min-w-0">{s.title || s.id}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-muted">{deliverableIds(draft).length ? t("deliverable_combined", { n: deliverableIds(draft).length }) : t("deliverable_auto")}</p>
            </fieldset>
            {deliverWarn && (
              <Note tone="warn">
                <span className="break-words">{t("deliverable_warn", { step: stepTitle(deliverWarn.step) })}</span>
                {deliverWarn.suggestAll.length > 0 && (
                  <Button size="sm" className="mt-1.5" onClick={() => update((w) => setDeliverable(w, deliverWarn.suggestAll))}>
                    {t("deliverable_use", { step: deliverWarn.suggestAll.map(stepTitle).join(" + ") })}
                  </Button>
                )}
              </Note>
            )}
            {weakWriters.map((w) => (
              <Note key={w.step} tone="warn">
                <span className="break-words">{t(w.unknown ? "weak_writer_unknown" : "weak_writer", { step: stepTitle(w.step), model: w.model })}</span>
              </Note>
            ))}
          </div>

          <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_400px]">
            <section className="panel h-[460px] overflow-hidden">
              <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.25 }}
                onNodeClick={(_, n) => setSelected(n.id)} nodesDraggable={false} proOptions={{ hideAttribution: true }}>
                <Background gap={22} color="var(--line-soft)" />
                <Controls showInteractive={false} />
              </ReactFlow>
            </section>

            <Panel title={step ? t("step_title", { title: step.title || step.id }) : t("step")} actions={
              <Button size="sm" icon={<Plus size={14} />} onClick={() => update((w) => {
                const id = `adim-${w.steps.length + 1}-${Math.random().toString(36).slice(2, 5)}`;
                w.steps.push({ id, type: "agent", title: t("new_step"), agent: visibleAgents[0]?.slug ?? "", prompt: "",
                  depends_on: selected ? [selected] : [] });
                setSelected(id);
              })}>{t("add_step")}</Button>}>
              {!step ? <Empty title={t("click_node")} /> : (
                <StepEditor key={step.id} wf={draft} step={step} agents={visibleAgents} roles={roles}
                  onChange={(fn) => update((w) => { const s = w.steps.find((x) => x.id === step.id); if (s) fn(s); })}
                  onDelete={() => { update((w) => {
                    w.steps = w.steps.filter((x) => x.id !== step.id);
                    w.steps.forEach((x) => { x.depends_on = (x.depends_on ?? []).filter((d) => d !== step.id); if (x.revise?.target === step.id) x.revise = null; });
                  }); setSelected(null); }} />
              )}
            </Panel>
          </div>

          <Panel title={t("inputs")} actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => update((w) => { w.inputs.push({ name: t("input_prefix", { n: w.inputs.length + 1 }), label: t("new_input"), type: "text", required: true }); })}>{t("add")}</Button>}>
            {!draft.inputs.length ? <p className="text-sm text-muted">{t("no_inputs", { token: "{{input.ad}}" })}</p> : (
              <div className="flex flex-col gap-2">
                {draft.inputs.map((inp, i) => (
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1.4fr_auto_auto] gap-2 items-center">
                    <input className="input font-mono" aria-label={t("input_name_aria", { n: i + 1 })} value={inp.name} onChange={(e) => update((w) => { w.inputs[i].name = e.target.value.replace(/[^\w-]/g, ""); })} />
                    <input className="input" aria-label={t("input_label_aria", { n: i + 1 })} value={inp.label ?? ""} onChange={(e) => update((w) => { w.inputs[i].label = e.target.value; })} />
                    <Segmented value={inp.type === "textarea" ? "textarea" : "text"} onChange={(v) => update((w) => { w.inputs[i].type = v; })}
                      options={[{ value: "text", label: t("type_line") }, { value: "textarea", label: t("type_text") }]} />
                    <Button size="sm" variant="ghost" className="justify-self-end" icon={<Trash2 size={14} />} aria-label={t("delete_input")} onClick={() => update((w) => { w.inputs.splice(i, 1); })} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}
      </div>
      {draft && <RunDialog open={runOpen} onClose={() => setRunOpen(false)} wf={draft} />}
    </div>
  );
}

/** Ajan / rol seçici: adım bir ajana ya da bir role (QA-M1) bağlanır; rol sahibi çalışma anında çözülür.
 *  S20: çok ajanda arama kutusu; seçili ajan her zaman listede kalır. */
function AssigneePicker({ step, agents, roles, onChange, label }:
  { step: FlowStep; agents: Agent[]; roles: RoleInfo[]; onChange: (fn: (s: WorkflowStep) => void) => void; label: string }) {
  const t = useT(m);
  const mode: "agent" | "role" = step.role && !step.agent ? "role" : "agent";
  const role = roles.find((r) => r.id === step.role);
  const holder = agents.find((a) => a.slug === role?.holder);
  const [q, setQ] = useState("");
  const needle = fold(q.trim());
  const sorted = useMemo(() => [...agents].sort(byName), [agents]);
  const shown = useMemo(() => {
    const list = needle ? sorted.filter((a) => fold(`${a.name} ${a.title ?? ""} ${a.slug}`).includes(needle)) : sorted;
    const cut = list.slice(0, PICKER_MAX);
    const cur = agents.find((a) => a.slug === step.agent);
    if (cur && !cut.some((a) => a.slug === cur.slug)) cut.unshift(cur);
    return { cut, hidden: Math.max(0, list.length - cut.length) };
  }, [sorted, needle, agents, step.agent]);
  return (
    <Field label={label} hint={mode === "role" ? t("role_change_hint") : undefined}>
      <Segmented value={mode} onChange={(v) => onChange((s) => {
        const f = s as FlowStep;
        if (v === "role") { f.role = f.role || roles[0]?.id || ""; f.agent = undefined; }
        else { f.agent = f.agent || agents[0]?.slug || ""; f.role = undefined; }
      })} options={[
        { value: "agent", label: <span className="flex items-center gap-1"><Bot size={13} />{t("agent")}</span> },
        { value: "role", label: <span className="flex items-center gap-1"><UserCog size={13} />{t("role")}</span>, disabled: !roles.length,
          title: roles.length ? undefined : t("no_roles_title") },
      ]} />
      {mode === "agent" ? (
        <>
          {agents.length > PICKER_SEARCH_AT && (
            <label className="relative block">
              <span className="sr-only">{t("agent_search")}</span>
              <Search size={14} aria-hidden className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input className="input !pl-8 !py-1.5 !text-sm" type="search" value={q} placeholder={t("agent_search")} onChange={(e) => setQ(e.target.value)} />
            </label>
          )}
          <div className="grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
            {shown.cut.length === 0 && <span className="text-sm text-muted col-span-2">{t("agent_search_none")}</span>}
            {shown.cut.map((a) => (
              <button key={a.slug} type="button" aria-pressed={step.agent === a.slug} onClick={() => onChange((s) => { s.agent = a.slug; })}
                className="card-select p-1.5 flex items-center gap-2 text-sm font-semibold min-w-0">
                <PixelFace avatar={a.avatar} size={28} /><span className="truncate">{a.name}</span>
              </button>
            ))}
          </div>
          {shown.hidden > 0 && <span className="text-xs text-muted">{t("agent_more", { n: shown.hidden })}</span>}
        </>
      ) : (
        <>
          <select className="select" aria-label={t("role")} value={step.role ?? ""}
            onChange={(e) => onChange((s) => { (s as FlowStep).role = e.target.value; })}>
            {!role && <option value={step.role ?? ""}>{step.role ? t("role_missing", { role: step.role }) : t("pick_role")}</option>}
            {roles.map((r) => {
              const h = agents.find((a) => a.slug === r.holder);
              return <option key={r.id} value={r.id}>{r.name} — {h ? h.name : t("no_holder")}</option>;
            })}
          </select>
          {holder ? (
            <span className="flex items-center gap-2 text-xs text-ink-2"><PixelFace avatar={holder.avatar} size={22} />{t("current_holder", { name: holder.name })}{holder.title ? ` (${holder.title})` : ""}</span>
          ) : (
            <span className="text-xs font-semibold text-warn flex items-center gap-1"><AlertTriangle size={13} />{t("role_empty_warn")}</span>
          )}
        </>
      )}
    </Field>
  );
}

/** `delegate` adımı ayarları ( sınırları: derinlik ≤3, alt görev ≤8, işe alım bütçesi ≤3).*/
function DelegateEditor({ step, onChange }: { step: FlowStep; onChange: (fn: (s: WorkflowStep) => void) => void }) {
  const t = useT(m);
  const set = (fn: (f: FlowStep) => void) => onChange((s) => fn(s as FlowStep));
  const allow = step.allow_hiring ?? DELEGATE_DEFAULTS.allow_hiring;
  return (
    <div className="flex flex-col gap-3 panel-soft p-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("depth")} hint={t("depth_hint")}>
          <select className="select" value={step.depth ?? DELEGATE_DEFAULTS.depth} onChange={(e) => set((f) => { f.depth = Number(e.target.value); })}>
            {[1, 2, 3].map((n) => <option key={n} value={n}>{t("n_levels", { n })}</option>)}
          </select>
        </Field>
        <Field label={t("max_subtasks")}>
          <select className="select" value={step.max_subtasks ?? DELEGATE_DEFAULTS.max_subtasks}
            onChange={(e) => set((f) => { f.max_subtasks = Number(e.target.value); })}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      </div>
      <Toggle checked={allow} onChange={(v) => set((f) => { f.allow_hiring = v; })} label={t("allow_hiring")} hint={t("allow_hiring_hint")} />
      {allow && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("hiring_approval")}>
            <Segmented value={step.hiring_approval ?? DELEGATE_DEFAULTS.hiring_approval}
              onChange={(v) => set((f) => { f.hiring_approval = v; })}
              options={[{ value: "ask", label: t("ask_me") }, { value: "auto", label: t("auto") }]} />
          </Field>
          <Field label={t("hire_budget")}>
            <select className="select" value={step.hire_budget ?? DELEGATE_DEFAULTS.hire_budget}
              onChange={(e) => set((f) => { f.hire_budget = Number(e.target.value); })}>
              {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{t("n_people", { n })}</option>)}
            </select>
          </Field>
        </div>
      )}
      <p className="text-xs text-ink-2">{t("delegate_note")}</p>
    </div>
  );
}

function StepEditor({ wf, step: raw, agents, roles, onChange, onDelete }:
  { wf: Workflow; step: WorkflowStep; agents: Agent[]; roles: RoleInfo[]; onChange: (fn: (s: WorkflowStep) => void) => void; onDelete: () => void }) {
  const t = useT(m);
  const step = raw as FlowStep;
  const others = wf.steps.filter((s) => s.id !== step.id);
  const insert = (token: string) => onChange((s) => { s.prompt = `${s.prompt ?? ""}${s.prompt ? " " : ""}${token}`; });
  const setType = (v: WorkflowStep["type"]) => onChange((s) => {
    s.type = v;
    if (v !== "agent") s.revise = null;
    clearApprovalUnlessAgent(s);  // WF-APPROVAL: adım başı onay yalnız ajan adımında geçerli (şema başka türde reddeder)
    if (v !== "orchestrate") {  // yalnızca orchestrate adımında geçerli alanlar (şema başka türde reddeder)
      const o = s as OrchestrateStep;
      delete o.plan_approval; delete o.max_replans; delete o.monitor_every_s;
    }
    if (v !== "approval" && !s.agent && !(s as FlowStep).role) s.agent = agents[0]?.slug ?? "";
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label={t("title")}><input className="input" value={step.title ?? ""} onChange={(e) => onChange((s) => { s.title = e.target.value; })} /></Field>
        <Field label={t("type")}>
          <Segmented value={step.type} onChange={setType}
            options={[{ value: "agent", label: <span className="flex items-center gap-1"><Bot size={13} />{t("type_agent")}</span> },
                      { value: "delegate", label: <span className="flex items-center gap-1"><Split size={13} />{t("type_delegate")}</span> },
                      { value: "orchestrate", label: <span className="flex items-center gap-1"><ListChecks size={13} />{t("type_orchestrate")}</span> },
                      { value: "approval", label: <span className="flex items-center gap-1"><Hand size={13} />{t("type_approval")}</span> }]} />
        </Field>
      </div>
      {step.type !== "approval" ? (
        <>
          <AssigneePicker step={step} agents={agents} roles={roles} onChange={onChange}
            label={step.type === "delegate" || step.type === "orchestrate" ? t("root_manager") : t("who")} />
          <Field label={step.type === "delegate" || step.type === "orchestrate" ? t("goal") : t("task_text")}
            hint={step.type === "delegate" || step.type === "orchestrate" ? t("goal_hint") : t("task_hint")}>
            <textarea className="textarea font-mono" rows={7} value={step.prompt ?? ""} onChange={(e) => onChange((s) => { s.prompt = e.target.value; })} />
            <div className="flex flex-wrap gap-1">
              {wf.inputs.map((i) => <button key={i.name} type="button" className="chip hover:border-ink-2" onClick={() => insert(`{{input.${i.name}}}`)}>+ input.{i.name}</button>)}
              {(step.depends_on ?? []).map((d) => <button key={d} type="button" className="chip hover:border-ink-2" onClick={() => insert(`{{steps.${d}.output}}`)}>+ {d}.output</button>)}
            </div>
          </Field>
          {step.type === "orchestrate" && <OrchestrateEditor step={step} onChange={onChange} />}
          {(step.type === "delegate" || step.type === "orchestrate") && <DelegateEditor step={step} onChange={onChange} />}
          {step.type === "agent" && (
            <>
              <Field label={t("gate_label")} hint={t(({ none: "gate_none_hint", before: "gate_before_hint", after: "gate_after_hint" } as const)[stepApproval(step)])}>
                <Segmented value={stepApproval(step)} onChange={(v: StepApproval) => onChange((s) => { setStepApproval(s, v); })}
                  options={[{ value: "none", label: t("gate_none") },
                            { value: "before", label: <span className="flex items-center gap-1"><ShieldCheck size={13} aria-hidden />{t("gate_before")}</span> },
                            { value: "after", label: <span className="flex items-center gap-1"><ShieldCheck size={13} aria-hidden />{t("gate_after")}</span> }]} />
              </Field>
              <div className="flex flex-col gap-2">
                <Toggle checked={step.memory !== false} onChange={(v) => onChange((s) => { s.memory = v; })} label={t("recall")} />
                <Toggle checked={step.remember !== false} onChange={(v) => onChange((s) => { s.remember = v; })} label={t("remember")} />
                {/* PROC-FIX*/}
                <Toggle checked={step.kind === "review"} label={t("step_review")} hint={t("step_review_hint")}
                  onChange={(v) => onChange((s) => { if (v) s.kind = "review"; else delete s.kind; })} />
                <Toggle checked={step.web_search === true} label={t("step_web")} hint={t("step_web_hint")}
                  onChange={(v) => onChange((s) => { if (v) s.web_search = true; else delete s.web_search; })} />
              </div>
              <Field label={t("revise")} hint={t("revise_hint")}>
                <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_80px] gap-2">
                  <select className="select col-span-2 sm:col-span-1" aria-label={t("revise")} value={step.revise?.target ?? ""} onChange={(e) => onChange((s) => {
                    s.revise = e.target.value ? { target: e.target.value, until: s.revise?.until ?? t("revise_until_default"), max_rounds: s.revise?.max_rounds ?? 2 } : null; })}>
                    <option value="">{t("off")}</option>
                    {others.filter((o) => o.type === "agent").map((o) => <option key={o.id} value={o.id}>{o.title || o.id}</option>)}
                  </select>
                  <input className="input" disabled={!step.revise} value={step.revise?.until ?? ""} placeholder={t("revise_until_default")} aria-label={t("approve_keyword")}
                    onChange={(e) => onChange((s) => { if (s.revise) s.revise.until = e.target.value; })} />
                  <input className="input" type="number" min={1} max={5} disabled={!step.revise} value={step.revise?.max_rounds ?? 2} aria-label={t("max_rounds")}
                    onChange={(e) => onChange((s) => { if (s.revise) s.revise.max_rounds = Number(e.target.value); })} />
                </div>
              </Field>
            </>
          )}
        </>
      ) : (
        <Field label={t("approval_message")}><textarea className="textarea" rows={2} value={step.message ?? ""} onChange={(e) => onChange((s) => { s.message = e.target.value; })} /></Field>
      )}
      <Field label={t("deps")}>
        <div className="flex flex-wrap gap-1.5">
          {others.length === 0 && <span className="text-xs text-muted">{t("no_other_steps")}</span>}
          {others.map((o) => {
            const on = (step.depends_on ?? []).includes(o.id);
            return (
              <button key={o.id} type="button" aria-pressed={on} className={clsx("chip", on && "tone-info")}
                onClick={() => onChange((s) => { const d = new Set(s.depends_on ?? []); if (on) d.delete(o.id); else d.add(o.id); s.depends_on = [...d]; })}>
                {on ? "✓ " : ""}{o.title || o.id}
              </button>
            );
          })}
        </div>
      </Field>
      <div><Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={onDelete}>{t("delete_step")}</Button></div>
    </div>
  );
}

function RunDialog({ open, onClose, wf }: { open: boolean; onClose: () => void; wf: Workflow }) {
  const t = useT(m);
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
  const [expected, setExpected] = useState("");   // PROC-FIX P2: beklenen çıktı (kabul ölçütü)
  const [deadline, setDeadline] = useState("");   // PROC-FIX P2: süre sınırı (dakika)
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // CG-COST: başlatmadan önce öngörü + isteğe bağlı bütçe tavanı (öngörü üst sınırı ×1,5)
  const [cap, setCap] = useState<CapState>({ enabled: false, cap: { tokens: null, cost_usd: null, on_exceeded: "ask" } });
  const estSpec = useMemo<EstimateSpec | null>(() => (open ? { kind: "workflow", workflow_id: wf.slug, inputs: values } : null), [open, wf.slug, values]);
  useEffect(() => { if (open) { setValues(Object.fromEntries(wf.inputs.map((i) => [i.name, i.default ?? ""]))); setError(null); setExpected(""); setDeadline(""); } }, [open, wf]);
  const deadlineMin = deadline.trim() ? Number(deadline) : null;
  const deadlineBad = deadlineMin != null && (!Number.isFinite(deadlineMin) || deadlineMin <= 0);
  const run = async () => {
    setBusy(true);
    try {
      // FOLLOWUP (CG-COST): tavan koşuyla birlikte verilir (koşu ilk jetondan önce sınırlı; sonradan PATCH yarışı yok)
      const budget = cap.enabled && (cap.cap.tokens || cap.cap.cost_usd) ? {
        on_exceeded: cap.cap.on_exceeded,
        ...(cap.cap.tokens ? { tokens: cap.cap.tokens } : {}), ...(cap.cap.cost_usd ? { cost_usd: cap.cap.cost_usd } : {}),
      } : undefined;
      const r = await api.runWorkflow(wf.slug, values, budget, {
        ...(expected.trim() ? { expected_output: expected.trim().slice(0, 1000) } : {}),
        ...(deadlineMin != null && !deadlineBad ? { deadline_min: deadlineMin } : {}),
      });
      onClose();
      navigate(`/gorevler/${r.run_id}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={t("run_title", { name: wf.name })}
      footer={<><Button variant="ghost" onClick={onClose}>{t("cancel")}</Button><Button variant="primary" icon={<Play size={16} />} disabled={busy || deadlineBad} onClick={run}>{t("start")}</Button></>}>
      <div className="flex flex-col gap-4">
        {wf.inputs.length === 0 && <p className="text-sm text-muted">{t("no_inputs_needed")}</p>}
        {wf.inputs.map((i) => (
          <Field key={i.name} label={i.label || i.name}>
            {i.type === "textarea"
              ? <textarea className="textarea" rows={6} value={values[i.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [i.name]: e.target.value }))} />
              : <input className="input" value={values[i.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [i.name]: e.target.value }))} />}
          </Field>
        ))}
        <Field label={t("run_expected_label")} hint={t("run_expected_hint")}>
          <textarea className="textarea min-h-[64px]" maxLength={1000} value={expected} onChange={(e) => setExpected(e.target.value)} />
        </Field>
        <Field label={t("run_deadline_label")} hint={t("run_deadline_hint")}>
          <input className="input max-w-[12rem]" type="number" min={1} step={1} inputMode="numeric" value={deadline}
            aria-invalid={deadlineBad || undefined} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
        <EstimatePanel spec={estSpec} cap={cap} onCap={setCap} />
        {error && <div className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-3 text-sm">{error}</div>}
      </div>
    </Modal>
  );
}
