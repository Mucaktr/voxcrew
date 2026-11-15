import { create } from "zustand";
import { api } from "./api";
import type { StepInvocation, ToolApprovalRecord, ToolApprovalRequest } from "./gateway";
import { play } from "./sound";
import type { Agent, AgentState, ConnectionInfo, GraphStats, Handoff, OllamaModel, Run, SceneId, StepRun, StudioEvent } from "./types";
import type { ConnectionExtras } from "./connections";
import { tp, tx } from "./i18n";
import { feedMsg } from "../locales/feed";
import { eventsMsg } from "../locales/events";
import { keepLiveOutput, mergeDelta, SeenSeq } from "./streamText";
import { presentAvatar } from "./presentation";
import { shareEvents, SSE_CHANNEL, type SseMsg } from "./sseShare";

/** GIFTS-GENDER: ajanın görünümü adına uydurulur (kayıtlı veri değişmez; açık `avatar.presentation` kazanır). */
const present = (a: Agent): Agent => {
  const av = presentAvatar(a.avatar, a.name);
  return av === a.avatar ? a : { ...a, avatar: av as Agent["avatar"] };
};

export interface FeedItem {
  id: number;
  ts: number;
  agent?: string;
  run_id?: string;
  kind: "start" | "tool" | "done" | "error" | "memory" | "approval" | "run";
  text: string;
  /** UXF-G: satır anahtar + değişkenle de saklanır; çizimde güncel dille çevrilir (dil değişince eski satırlar Türkçe kalmaz)*/
  msg?: { key: string; vars?: Record<string, string>; n?: number };
}

/** Akış satırı: anahtar + değişken (`@anahtar` değeri çizimde çevrilir) → { text (şimdiki dil), msg (yeniden çeviri için) }. */
const fm = (key: string, vars?: Record<string, string>, n?: number): Pick<FeedItem, "text" | "msg"> => ({ text: feedLine(key, vars, n), msg: { key, vars, n } });
function feedLine(key: string, vars?: Record<string, string>, n?: number): string {
  const v: Record<string, string> | undefined = vars && Object.fromEntries(Object.entries(vars).map(([k, x]) => [k, x.startsWith("@") ? tx(feedMsg, x.slice(1) as never) : x]));
  return n === undefined ? tx(feedMsg, key as never, v) : tp(feedMsg, key, n, v);
}
/** Gösterilecek metin: anahtarlı satırlar güncel dille, diğerleri olduğu gibi. */
export const feedText = (f: FeedItem): string => (f.msg ? feedLine(f.msg.key, f.msg.vars, f.msg.n) : f.text);

interface StudioStore {
  agents: Agent[];
  states: Record<string, AgentState>;
  /** S29: eski alanlar + tek bağlantı modelinin alanları (state_version, ready, problems…); eski türler için geriye uyumlu */
  connections: (ConnectionInfo & Partial<ConnectionExtras>)[];
  models: OllamaModel[];
  stats: GraphStats | null;
  runList: Run[];
  runs: Record<string, Run>;
  feed: FeedItem[];
  handoffs: Handoff[];
  scene: SceneId;
  connected: boolean;
  selectedAgent: string | null;
  /** W3: `prompt` — isteğe bağlı ön dolu görev metni (yürüme modunda çıktı teslimi) */
  /** FIX-UX: `onStarted` — koşu başlayınca çağrılır (yürüme modu `kafeden_gorev` olayı; gönderim yine kullanıcının tıklaması) */
  composer: { open: boolean; agent?: string; prompt?: string; onStarted?: (runId: string) => void };
  loaded: boolean;
  /** son tam yenileme (sunucu `resync_required` gönderdi); bileşenler küçük bir bildirim için kullanabilir*/
  resync: { at: number; reason: string } | null;

  load: () => Promise<void>;
  refreshAgents: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  refreshModels: () => Promise<OllamaModel[]>;
  refreshConnections: (force?: boolean) => Promise<void>;
  loadRun: (id: string) => Promise<Run | null>;
  setScene: (scene: SceneId) => Promise<void>;
  selectAgent: (slug: string | null) => void;
  openComposer: (agent?: string, opts?: { prompt?: string; onStarted?: (runId: string) => void }) => void;
  closeComposer: () => void;
  upsertAgent: (agent: Agent) => void;
  applyEvent: (ev: StudioEvent) => void;
}

let feedSeq = 0;
/** UXF-G: bilinen durum kodları çevrilir (`@rs_failed`), bilinmeyen olduğu gibi kalır*/
const runStatusRef = (st: string): string => (["failed", "interrupted", "cancelled", "paused", "timeout"].includes(st) ? `@rs_${st}` : st);

/** Sekme arka plandayken masaüstü bildirimi (izin verildiyse). İş olayları içindir (onay, koşu sonu, zamanlayıcı);
 *  Ç-6 yalnız oyun bildirimini ve "geri gel" çağrısını yasaklar. Teslim bildirimi ayrıca DeliverableNotifier'dadır. */
export function notify(title: string, body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted" && document.hidden)
      new Notification(title, { body, tag: "voxcrew" });
  } catch { /* desteklenmiyor */ }
}

/** olay teslim tekilliği (seq) — sunucu yeniden başlayıp sırayı baştan alırsa (resync) temizlenir.*/
const seen = new SeenSeq();

/** koşu ayrıntısı uçuştayken gelen parçalar kaybolmasın: çalışan adımın canlı çıktısı anlık görüntüden
 * ilerideyse korunur (anlık görüntü önekiyse).*/
function withLiveOutput(prev: Run | undefined, next: Run): Run {
  if (!prev?.steps?.length || !next?.steps?.length) return next;
  let changed = false;
  const steps = next.steps.map((s) => {
    if (s.status !== "running") return s;
    const p = prev.steps.find((x) => x.id === s.id);
    // aynı deneme olmalı: önceki denemenin canlı metni yeni denemenin anlık görüntüsüne taşınmaz
    if (!p || p.status !== "running" || typeof s.attempt !== "number" || p.attempt !== s.attempt) return s;
    const output = keepLiveOutput(p.output, s.output);
    if (output === (s.output || "")) return s;
    changed = true;
    return { ...s, output };
  });
  return changed ? { ...next, steps } : next;
}

function patchStep(run: Run, stepId: string | undefined, fn: (s: StepRun) => StepRun): Run {
  if (!stepId) return run;
  return { ...run, steps: run.steps.map((s) => (s.id === stepId ? fn(s) : s)) };
}

// S39 (denetim C-08): akan çıktı (step.delta / step.thought) her belirteçte depoyu değiştirip Dünya sayfasını baştan
// çizdiriyordu. Parçalar koşu/adım başına biriktirilir ve ~8 kez/sn tek `set` ile uygulanır; başka bir olay gelince
// sıra bozulmasın diye önce bekleyen parçalar boşaltılır.
// çıktı parçaları konumlarıyla (`at`) birlikte tutulur ve `mergeDelta` ile yerine konur (bkz. lib/streamText.ts).
const pendingText = new Map<string, Map<string, { out: { text: string; at?: number }[]; th: string }>>();
let flushTimer: number | undefined;
const FLUSH_MS = 120;
function queueText(runId: string | undefined, stepId: string | undefined, kind: "out" | "th", text: string, at?: unknown) {
  if (!runId || !stepId || !text) return;
  let steps = pendingText.get(runId);
  if (!steps) { steps = new Map(); pendingText.set(runId, steps); }
  const cur = steps.get(stepId) ?? { out: [], th: "" };
  if (kind === "th") cur.th += text;
  else cur.out.push({ text, ...(typeof at === "number" ? { at } : {}) });
  steps.set(stepId, cur);
  if (flushTimer === undefined) flushTimer = window.setTimeout(flushText, FLUSH_MS);
}
function flushText() {
  if (flushTimer !== undefined) { window.clearTimeout(flushTimer); flushTimer = undefined; }
  if (!pendingText.size) return;
  const batch = new Map(pendingText);
  pendingText.clear();
  useStudio.setState((st) => {
    let runs = st.runs;
    let runList = st.runList;
    for (const [runId, steps] of batch) {
      const apply = (r: Run) => {
        let out = r;
        for (const [stepId, d] of steps) {
          out = patchStep(out, stepId, (x) => ({ ...x,
            output: d.out.length ? d.out.reduce((acc, c) => mergeDelta(acc, c.text, c.at), x.output || "") : x.output,
            thought: d.th ? ((x.thought || "") + d.th).slice(-1500) : x.thought }));
        }
        return out;
      };
      if (runs[runId]) runs = { ...runs, [runId]: apply(runs[runId]) };
      const idx = runList.findIndex((r) => r.id === runId);
      if (idx >= 0) { runList = [...runList]; runList[idx] = apply(runList[idx]); }
    }
    return { runs, runList };
  });
}

export const useStudio = create<StudioStore>((set, get) => ({
  agents: [],
  states: {},
  connections: [],
  models: [],
  stats: null,
  runList: [],
  runs: {},
  feed: [],
  handoffs: [],
  scene: "office",
  connected: false,
  selectedAgent: null,
  composer: { open: false },
  loaded: false,
  resync: null,

  load: async () => {
    const ov = await api.overview();
    const states: Record<string, AgentState> = {};
    ov.agents.forEach((a) => (states[a.slug] = a.state));
    set({ agents: ov.agents.map(present), states, connections: ov.connections, stats: ov.stats,
          scene: (ov.scene as SceneId) || "office", loaded: true });
    get().refreshRuns();
    get().refreshModels().catch(() => undefined);
  },
  refreshAgents: async () => {
    const agents = (await api.agents()).map(present);
    set({ agents });
  },
  refreshRuns: async () => {
    const runList = await api.runs(80);
    set({ runList });
  },
  refreshModels: async () => {
    const models = await api.models();
    set({ models });
    return models;
  },
  refreshConnections: async (force = false) => {
    const connections = await api.connections(force);
    set({ connections });
  },
  loadRun: async (id) => {
    try {
      const run = await api.run(id);
      set((s) => ({ runs: { ...s.runs, [id]: withLiveOutput(s.runs[id], run) } }));
      return run;
    } catch {
      return null;
    }
  },
  setScene: async (scene) => {
    set({ scene });
    await api.saveSettings({ scene });
  },
  selectAgent: (slug) => set({ selectedAgent: slug }),
  openComposer: (agent, opts) => set({ composer: { open: true, agent, ...(opts?.prompt ? { prompt: opts.prompt } : {}),
    ...(opts?.onStarted ? { onStarted: opts.onStarted } : {}) } }),
  closeComposer: () => set({ composer: { open: false } }),
  upsertAgent: (agent0) => {
    const agent = present(agent0);
    set((s) => ({ agents: s.agents.some((a) => a.slug === agent.slug)
      ? s.agents.map((a) => (a.slug === agent.slug ? { ...agent, state: a.state } : a))
      : [...s.agents, agent] }));
  },

  applyEvent: (ev) => {
    if (!seen.first(ev.seq)) return;  // aynı olay (aynı seq) ikinci kez teslim edildiyse uygulanmaz
    if (ev.type === "step.delta") { queueText(ev.run_id, ev.step as string | undefined, "out", ev.text as string, ev.at); return; }
    if (ev.type === "step.thought") { queueText(ev.run_id, ev.step as string | undefined, "th", ev.text as string); return; }
    flushText(); // sonraki olay (adım bitti, araç …) birikmiş metnin ÜSTÜNE uygulanır
    const s = get();
    const agentName = (slug?: string) => s.agents.find((a) => a.slug === slug)?.name ?? slug ?? tx(feedMsg, "agent_fallback");
    const pushFeed = (item: Omit<FeedItem, "id" | "ts">) =>
      set((st) => ({ feed: [{ ...item, id: ++feedSeq, ts: ev.ts * 1000 }, ...st.feed].slice(0, 80) }));
    const runId = ev.run_id;
    const updateRun = (fn: (r: Run) => Run) => {
      if (!runId) return;
      set((st) => {
        const next: Partial<StudioStore> = {};
        if (st.runs[runId]) next.runs = { ...st.runs, [runId]: fn(st.runs[runId]) };
        const idx = st.runList.findIndex((r) => r.id === runId);
        if (idx >= 0) {
          const list = [...st.runList];
          list[idx] = fn(list[idx]);
          next.runList = list;
        }
        return next;
      });
    };
    const stepOwner = () => {
      const r = runId ? s.runs[runId] ?? s.runList.find((x) => x.id === runId) : undefined;
      return r?.steps.find((x) => x.id === ev.step)?.agent ?? undefined;
    };
    // AUDIT P1: gizli sistem koşusu (ör. kalite denetçisi) koşu listesine ve akışa girmez; izi koşu ayrıntısından okunur
    if (ev.hidden) return;

    switch (ev.type) {
      case "hello":
        set((st) => ({ states: { ...st.states, ...(ev.states as Record<string, AgentState>) } }));
        break;
      case "resync_required": {
        // sunucu kaçan olayları imleçten yeniden gönderemedi (pencere dışı, sınır aşıldı, yavaş bağlantı
        // taşması, sunucu yeniden başladı) → tam yenileme; ardından aynı akışta yeni "hello" gelir.
        const reason = String(ev.reason ?? "");
        if (RESTART_REASONS.has(reason)) seen.clear();  // yeni sunucu sırası eski numaraları yeniden kullanabilir
        set({ resync: { at: Date.now(), reason } });
        pushFeed({ kind: "run", text: tx(eventsMsg, RESTART_REASONS.has(reason) ? "resync_restart" : "resync_notice") });
        resyncAll(ev);
        break;
      }
      case "agent.state":
        set((st) => ({ states: { ...st.states, [ev.agent as string]: ev as unknown as AgentState } }));
        break;
      case "agent.updated":
        get().upsertAgent(ev.agent as unknown as Agent);
        break;
      case "agent.removed":
        get().refreshAgents();
        break;
      case "scene.changed":
        set({ scene: ev.scene as SceneId });
        break;
      case "step.added": {
        // S6 devretme: çalışma zamanında eklenen adım (alt görev, işe alım onayı, sentez)
        const added = ev.step as StepRun | undefined;
        if (added) updateRun((r) => (r.steps.some((s) => s.id === added.id) ? r : { ...r, steps: [...r.steps, added] }));
        break;
      }
      case "agent.hired":
        get().refreshAgents();
        pushFeed({ kind: "run", agent: ev.by as string | undefined, run_id: runId,
                   ...fm("hired", { by: agentName(ev.by as string | undefined), name: String(ev.name ?? ev.agent ?? "") }) });
        break;
      case "office.changed":
        // Ekip adı/renk/lider değişiklikleri diğer sekmelerde de anında görünsün.
        void import("./office").then((m) => m.useOffice.getState().refresh());
        get().refreshAgents();
        break;
      case "run.started": {
        const detail = ev.detail as Run;
        set((st) => ({ runList: [detail, ...st.runList.filter((r) => r.id !== detail.id)],
                       runs: { ...st.runs, [detail.id]: { ...detail, events: [] } } }));
        pushFeed({ kind: "run", run_id: detail.id, ...fm(detail.kind === "task" ? "new_task" : "new_workflow", { title: detail.title }) });
        break;
      }
      case "step.started":
        updateRun((r) => ({ ...patchStep(r, ev.step, (st) => ({ ...st, status: "running", output: "", thought: "",
          ...(typeof ev.attempt === "number" ? { attempt: ev.attempt } : {}),  // canlı/anlık görüntü eşleşmesi
          error: null, route: ev.route as StepRun["route"], started_at: new Date(ev.ts * 1000).toISOString() })) }));
        pushFeed({ kind: "start", agent: ev.agent as string, run_id: runId,
                   ...fm("started", { agent: agentName(ev.agent as string) }) });
        break;
      // step.delta / step.thought: yukarıda toplu uygulanır (queueText → flushText)
      case "step.tool":
        updateRun((r) => patchStep(r, ev.step, (st) => ({ ...st, tools: [...(st.tools || []), { name: ev.name as string, input: ev.input as string, ok: null,
          // yöneticinin önceki denemesinden tekrar kullanılan çağrı canlı izde de işaretli
          ...(ev.replayed ? { replayed: true } : {}), ...(ev.reused ? { reused: true } : {}) }] })));
        pushFeed({ kind: "tool", agent: stepOwner(), run_id: runId, text: `${agentName(stepOwner())} → ${ev.name}` });
        break;
      case "step.tool_result":
        updateRun((r) => patchStep(r, ev.step, (st) => {
          const tools = [...(st.tools || [])];
          for (let i = tools.length - 1; i >= 0; i--) {
            if (tools[i].name === ev.name && tools[i].ok == null) {
              tools[i] = { ...tools[i], ok: ev.ok as boolean, output: ev.output as string };
              break;
            }
          }
          return { ...st, tools };
        }));
        break;
      case "budget.unrecorded_possible":  // olası kaydedilmemiş istek (harcama değil; adım çipi + bütçe notu)
        updateRun((r) => {
          const max = Number(ev.tokens_max ?? 0);
          const next = patchStep(r, ev.step, (st) => ({ ...st, unrecorded_possible: {
            count: Number(st.unrecorded_possible?.count ?? 0) + 1,
            tokens_max: Math.max(Number(st.unrecorded_possible?.tokens_max ?? 0), max),
            attempt: ev.attempt as number | undefined } }));
          return { ...next, unrecorded_possible: { requests: Number(r.unrecorded_possible?.requests ?? 0) + 1,
            tokens_max: Math.max(Number(r.unrecorded_possible?.tokens_max ?? 0), max) } };
        });
        break;
      case "budget.runaway":  // engellemeyen "bu adım beklenenden çok harcıyor" uyarısı (canlı çip)
        updateRun((r) => patchStep(r, ev.step, (st) => ({ ...st, runaway: { spent: Number(ev.spent ?? 0),
          would_be: Number(ev.would_be ?? 0), attempt: ev.attempt as number | undefined } })));
        break;
      case "step.recalled":
        updateRun((r) => patchStep(r, ev.step, (st) => ({ ...st, recalled: ev.items as StepRun["recalled"] })));
        pushFeed({ kind: "memory", agent: stepOwner(), run_id: runId,
                   ...fm("recalled", { agent: agentName(stepOwner()) }, (ev.items as unknown[]).length) });
        break;
      case "handoff": {
        const h: Handoff = { id: ev.seq, from: ev.from as string, to: ev.to as string, run_id: runId, ts: Date.now() };
        set((st) => ({ handoffs: [...st.handoffs.filter((x) => Date.now() - x.ts < 20000), h] }));
        pushFeed({ kind: "run", agent: h.from, run_id: runId, ...fm("handoff", { from: agentName(h.from), to: agentName(h.to) }) });
        play("handoff");
        break;
      }
      case "step.artifacts":
        updateRun((r) => patchStep(r, ev.step, (st) => ({ ...st, artifacts: ev.files as StepRun["artifacts"] })));
        pushFeed({ kind: "done", agent: stepOwner(), run_id: runId,
                   ...fm("artifacts", { agent: agentName(stepOwner()) }, (ev.files as unknown[]).length) });
        break;
      case "step.awaiting":
        updateRun((r) => patchStep(r, ev.step, (st) => ({ ...st, status: "awaiting_approval", awaiting_message: ev.message as string })));
        pushFeed({ kind: "approval", run_id: runId, ...fm("awaiting", { message: String(ev.message) }) });
        notify(tx(feedMsg, "notify_awaiting"), String(ev.message ?? ""));
        play("approval");
        break;
      // ---- S2: Hermes API araç onayları, gönderilen çağrı özeti, revise tur sınırı uyarısı
      case "step.tool_approval": {
        const req: ToolApprovalRequest = {
          approval_id: ev.approval_id as string, tool: (ev.tool as string | null) ?? null, command: (ev.command as string) ?? "",
          description: (ev.description as string) ?? "", summary: ev.summary as string | undefined,
          choices: (ev.choices as ToolApprovalRequest["choices"]) ?? ["once", "deny"],
          allow_session: !!ev.allow_session, allow_permanent: !!ev.allow_permanent,
          requested_at: ev.requested_at as string | undefined, timeout_s: ev.timeout_s as number | undefined,
          expires_at: ev.expires_at as number | undefined,
        };
        updateRun((r) => patchStep(r, ev.step, (st) => ({ ...st, status: "awaiting_tool_approval", pending_approval: req }) as StepRun));
        const who = (ev.agent as string | undefined) ?? stepOwner();
        pushFeed({ kind: "approval", agent: who, run_id: runId,
                   ...fm("tool_approval", { agent: agentName(who), what: req.command.slice(0, 70) || req.description.slice(0, 70) }) });
        notify(tx(feedMsg, "notify_tool_approval"), `${agentName(who)}: ${req.command.slice(0, 120)}`);
        play("approval");
        break;
      }
      case "step.tool_approval_resolved":
        updateRun((r) => patchStep(r, ev.step, (st) => {
          const g = st as StepRun & { pending_approval?: ToolApprovalRequest | null; approvals?: ToolApprovalRecord[] };
          const prev = g.pending_approval;
          const rec: ToolApprovalRecord = {
            approval_id: ev.approval_id as string, choice: ev.choice as ToolApprovalRecord["choice"],
            note: (ev.note as string | null) ?? null, timed_out: !!ev.timed_out, error: (ev.error as string | null) ?? null,
            tool: prev?.tool ?? null, command: prev?.command ?? "", description: prev?.description ?? "",
            decided_at: new Date(ev.ts * 1000).toISOString(),
          };
          return { ...st, status: st.status === "awaiting_tool_approval" ? "running" : st.status, pending_approval: null,
                   approvals: [...(g.approvals ?? []).filter((a) => a.approval_id !== rec.approval_id), rec] } as StepRun;
        }));
        pushFeed({ kind: ev.choice === "deny" ? "error" : "approval", agent: (ev.agent as string | undefined) ?? stepOwner(), run_id: runId,
                   ...fm(ev.timed_out ? "tool_timed_out" : ev.choice === "deny" ? "tool_denied" : "tool_allowed") });
        break;
      case "step.invocation":
        updateRun((r) => patchStep(r, ev.step, (st) => ({ ...st, invocation: ev.invocation as StepInvocation }) as StepRun));
        break;
      case "step.warning":
        updateRun((r) => patchStep(r, ev.step, (st) => ({ ...st, warning: ev.message as string }) as StepRun));
        pushFeed({ kind: "approval", agent: stepOwner(), run_id: runId, text: String(ev.message ?? tx(feedMsg, "warning")) });
        break;
      case "step.round":
        updateRun((r) => patchStep(r, ev.step, (st) => ({ ...st, rounds: ev.round as number })));
        pushFeed({ kind: "tool", run_id: runId, ...fm("review_round", { round: String(ev.round), target: String(ev.target) }) });
        break;
      case "step.finished":
        updateRun((r) => patchStep(r, ev.step, (st) => ({ ...st, status: ev.status as string, error: ev.error as string | null,
          error_class: (ev.error_class as string | undefined) ?? null,
          output: (ev.output as string) || st.output, tokens: (ev.tokens as Record<string, number>) || st.tokens,
          model: (ev.model as string) || st.model, finished_at: new Date(ev.ts * 1000).toISOString() })));
        if (ev.status === "done" || ev.status === "failed") {
          const owner = stepOwner();
          pushFeed({ kind: ev.status === "done" ? "done" : "error", agent: owner, run_id: runId,
                     ...(ev.status === "done" ? fm("step_done", { agent: agentName(owner) }) : { text: `${agentName(owner)}: ${String(ev.error ?? tx(feedMsg, "error_fallback")).slice(0, 90)}` }) });
        }
        break;
      case "memory.updated": {
        const res = ev.result as { skipped?: boolean; concepts?: number; facts?: number; extractor?: string };
        set({ stats: ev.stats as GraphStats });
        updateRun((r) => patchStep(r, ev.step, (st) => ({ ...st, memory: res as Record<string, unknown> })));
        if (!res?.skipped)
          pushFeed({ kind: "memory", agent: ev.agent as string, run_id: runId,
                     ...fm("memory_updated", { concepts: String(res.concepts), facts: String(res.facts),
                       extractor: res.extractor === "llm" ? "LLM" : "@extractor_heuristic" }) });
        break;
      }
      // onay rozeti yalnız çalışan koşuların kartlarını sayar — duraklat/devam liste durumuna da yansır
      case "run.pausing":  // zarif duraklatma sürüyor (uçuştaki turlar bitiyor): "Duraklatılıyor…"
        updateRun((r) => ({ ...r, pausing: true }));
        break;
      case "run.paused":
        updateRun((r) => ({ ...r, status: (ev.status as string) || "paused", pause_reason: (ev.reason as string) ?? null,
                            pausing: false }));
        break;
      case "run.resumed":
        updateRun((r) => ({ ...r, status: "running", pause_reason: null, pausing: false }));
        break;
      case "run.finished":
        updateRun((r) => ({ ...r, status: ev.status as string, error: ev.error as string | null, pausing: false,
                            error_class: (ev.error_class as string | undefined) ?? null,
                            output: (ev.output as string) || r.output, finished_at: new Date(ev.ts * 1000).toISOString() }));
        pushFeed({ kind: ev.status === "done" ? "done" : "error", run_id: runId,
                   ...(ev.status === "done" ? fm("run_done") : fm("run_status", { status: runStatusRef(String(ev.status)) })) });
        play(ev.status === "done" ? "done" : "error");
        notify(ev.status === "done" ? tx(feedMsg, "notify_done") : tx(feedMsg, "notify_failed"),
               (s.runList.find((r) => r.id === runId)?.title ?? "") + (ev.error ? ` — ${ev.error}` : ""));
        break;
    }
  },
}));

// AUDIT-FIX #4: sekmeler tek SSE akışını paylaşır (lib/sseShare.ts); yalnız lider sekme EventSource açar.
let share: ReturnType<typeof shareEvents> | null = null;
// son kalıcı olay imleci. Sunucu yalnızca kalıcı (kritik) olaylarda `id:` gönderir; EventSource kendi
// yeniden bağlanmasında bunu Last-Event-ID başlığı olarak yollar ve sunucu kaçanları yeniden gönderir. Tarayıcı
// bağlantıyı tamamen kapatırsa (HTTP hatası) aynı imleçle ?since= üzerinden biz yeniden açarız. Her sekme imleci
// paylaşılan olaylardan izler: lider kapanınca yeni lider kaldığı yerden açar.
let lastEventId = "";
const RESTART_REASONS = new Set(["cursor_ahead", "cursor_invalid", "no_log"]);

/** resync_required → tam yenileme: koşu listesi, ajanlar, genel bakış, açık koşular; özellik modüllerine
 *  `resync.full` sentetik olayı (registerEventHandler("resync.", …)) ile kendi verilerini yeniden yüklemeleri söylenir. */
function resyncAll(ev: StudioEvent) {
  const st = useStudio.getState();
  st.load().catch(() => undefined); // genel bakış: ajanlar + durumlar, bağlantılar, istatistik, sahne, koşu listesi
  Object.keys(st.runs).forEach((id) => { void st.loadRun(id); });
  const synthetic: StudioEvent = { seq: 0, type: "resync.full", ts: Date.now() / 1000, reason: ev.reason,
                                   from: ev.from, latest: ev.latest };
  for (const h of handlers) {
    if (synthetic.type.startsWith(h.prefix)) {
      try { h.fn(synthetic); } catch { /* yok say */ }
    }
  }
}

// ------------------------------------------------------------------ özellik modülleri için olay kaydı
// Faz 3–4 modülleri (lib/game.ts "game.", lib/external.ts "ext.", lib/goals.ts "goal.") store.ts'yi
// düzenlemeden kendi depolarını olaylara bağlar. İşleyici hatası diğer işleyicileri etkilemez.
type EventHandler = (ev: StudioEvent) => void;
const handlers: { prefix: string; fn: EventHandler }[] = [];

export function registerEventHandler(prefix: string, fn: EventHandler): () => void {
  const entry = { prefix, fn };
  handlers.push(entry);
  return () => {
    const i = handlers.indexOf(entry);
    if (i >= 0) handlers.splice(i, 1);
  };
}

let everConnected = false;
export function connectEvents() {
  if (share) return;
  let channel: BroadcastChannel | null = null;
  try { channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(SSE_CHANNEL) : null; } catch { channel = null; }
  const locks = typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
  share = shareEvents({ locks, channel, open: openSource, deliver: deliverShared });
}

/** Lider (ya da solo) sekmede akışı açar; olaylar ve durum `emit` ile bu sekmeye ve öbür sekmelere gider. */
function openSource(emit: (m: SseMsg) => void): () => void {
  let es: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 2000;
  let closed = false;
  const start = () => {
    const url = lastEventId ? `/api/events?since=${encodeURIComponent(lastEventId)}` : "/api/events";
    const cur = new EventSource(url);
    es = cur;
    cur.onopen = () => { retryDelay = 2000; emit({ t: "open", url }); };
    cur.onerror = () => {
      emit({ t: "down" });
      // Tarayıcı yeniden denemeyi bıraktıysa (CLOSED) son imleçle biz açarız; açık kalıyorsa kendisi dener.
      if (cur.readyState === EventSource.CLOSED && es === cur && !retryTimer && !closed) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (es === cur && !closed) start();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      }
    };
    cur.onmessage = (msg) => emit({ t: "ev", data: msg.data, id: msg.lastEventId });
  };
  start();
  return () => { closed = true; if (retryTimer) clearTimeout(retryTimer); es?.close(); es = null; };
}

/** Paylaşılan akış mesajını bu sekmede uygular (lider, takipçi ve solo sekmede aynı yol). */
function deliverShared(m: SseMsg) {
  if (m.t === "state") {
    useStudio.setState({ connected: m.connected });
    if (m.connected) everConnected = true;
  } else if (m.t === "down") {
    useStudio.setState({ connected: false });
  } else if (m.t === "open") {
    useStudio.setState({ connected: true });
    // QA-M3: kopma sırasında kaçan olaylar (ör. araç onayı isteği) için yeniden bağlanınca durumu tazele;
    // kritik olaylar ayrıca Last-Event-ID ile yeniden gelir, kalıcı olmayan bildirimler için bu yenileme kalır.
    if (everConnected || m.url !== "/api/events") {
      const st = useStudio.getState();
      st.refreshRuns().catch(() => undefined);
      st.refreshAgents().catch(() => undefined);
      Object.keys(st.runs).forEach((id) => { void st.loadRun(id); });
    }
    everConnected = true;
  } else if (m.t === "ev") {
    if (m.id) lastEventId = m.id;
    let ev: StudioEvent;
    try {
      ev = JSON.parse(m.data) as StudioEvent;
    } catch { return; /* bozuk olay */ }
    try { useStudio.getState().applyEvent(ev); } catch { /* yok say */ }
    for (const h of handlers) {
      if (ev.type.startsWith(h.prefix)) {
        try { h.fn(ev); } catch { /* yok say */ }
      }
    }
  }
}
