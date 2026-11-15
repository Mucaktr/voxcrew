// Faz 6 — Ekip S26: koşu denetimleri (duraklat / devam / yeniden dene / çatalla / bütçe) ve iz (trace) istemcisi.
// Sözleşme: (S23) ve. Canlı güncellemeler store.ts'ye dokunmadan
// `registerEventHandler` ile depodaki koşulara işlenir (store.ts mevcut olayları zaten işler; burada yalnızca yeni alanlar).
import { ApiError, bodyText } from "./api";
import { currentLocale } from "./i18n";
import { registerEventHandler, useStudio } from "./store";
import type { RunBudget, Run, RunEffect, RunUsage, StepAsk, StepRun, StudioEvent } from "./types";

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = bodyText(res.status, null);
    try {
      const j = await res.json();
      msg = bodyText(res.status, j);
    } catch { /* gövde yok */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

// ------------------------------------------------------------------ koşu denetimleri (§6 REST)
export type ForkEdit = string | { prompt?: string; output?: string };

export const runControls = {
  pause: (id: string) => req<{ ok: boolean; run_id: string; status: string; reason: string }>("POST", `/api/runs/${id}/pause`),
  resume: (id: string, fromStep?: string) =>
    req<{ ok: boolean; run_id: string; status: string; from_step: string | null; pending: string[] }>(
      "POST", `/api/runs/${id}/resume`, fromStep ? { from_step: fromStep } : {}),
  // `fresh` = "baştan çalıştır" (önceki yan etkili yürütmeler tekrar kullanılmaz; yalnız arayüzden)
  retryStep: (id: string, step: string, fresh = false) =>
    req<{ ok: boolean; run_id: string; step: string; reopened: string[] }>("POST", `/api/runs/${id}/steps/${step}/retry`,
      fresh ? { fresh: true } : {}),
  // edits: adım → yeni çıktı (metin) ya da { prompt?, output? } (istem değişirse adım ve bağımlıları yeniden koşar)
  fork: (id: string, body: { from_step?: string; edits?: Record<string, ForkEdit> }) =>
    req<{ ok: boolean; run_id: string; forked_from: string }>("POST", `/api/runs/${id}/fork`, body),
  budget: (id: string, patch: RunBudget) =>
    req<{ ok: boolean; run_id: string; budget: RunBudget; usage: RunUsage; status: string }>("PATCH", `/api/runs/${id}/budget`, patch),
};

// ------------------------------------------------------------------ iz
export type SpanKind = "span" | "agent" | "tool" | "retriever" | "guardrail" | "generation";
export interface TraceSpan {
  id: string; span_id: string; parent: string | null; name: string; kind: SpanKind; step: string | null; attempt: number | null;
  status: string; open: boolean; start_ms: number; end_ms: number; duration_ms: number;
  attrs: Record<string, unknown>; events: { name: string; offset_ms: number; attrs: Record<string, unknown> }[];
}
export interface TraceMarker { type: string; ts: number; offset_ms: number; data: Record<string, unknown> }
export interface TraceEffect extends Partial<RunEffect> { id: string; step: string; ts: number; offset_ms: number; reused?: boolean }
export interface TraceStats {
  duration_ms: number; steps: number; attempts: number; retries: number; tool_calls: number; tool_errors: number;
  approval_wait_ms: number; tokens: number; replayed_tokens: number; cost_usd: number | null; cost_basis?: string | null;
  saved_tokens_est: number; effects: Record<string, number>; error_classes: Record<string, number>; events: number;
  // O-10/O-11: zaman dökümü (her aralık bir kez sayılır); eski sunucuda yok
  ready_wait_ms?: number; backoff_ms?: number; queue_wait_ms?: number; provider_ms?: number;
}
export interface PromptStage { stage: string; kind: "booster" | "skill" | "other"; saved_chars?: number; saved_tokens_est?: number;
  injected?: string[]; truncated?: string[]; omitted?: string[]; error?: string; [k: string]: unknown }
/** koşu sürüm manifesti (içeriksiz: yalnız sürüm, özet ve kimlik).*/
export interface RunManifestStep {
  connector?: string | null; connection?: string | null; model?: string | null; prefix_hash?: string | null; attempt?: number;
  skills?: { key?: string; sha?: string | null }[];
  tools?: Record<string, { version?: string | null; protocol?: string | null; schema_sha?: string | null }>;
}
export interface RunManifest {
  version?: number; studio_version?: string; workflow?: string; workflow_sha?: string; spec_version?: number;
  prompt_layout_version?: string; task_family?: string; models?: string[]; steps?: Record<string, RunManifestStep>;
}
export interface RunTrace {
  run_id: string; trace_id: string; status: string; live: boolean; t0: number; title: string; forked_from?: string | null;
  spans: TraceSpan[]; markers: TraceMarker[]; effects: TraceEffect[]; stats: TraceStats;
  export?: { enabled: boolean; send_prompts: boolean };
  /** sürüm manifesti, mutlak bitiş zamanı (eski sunucuda yok)*/
  manifest?: RunManifest | null; deadline_at?: string | null;
}

export const fetchTrace = (id: string) => req<RunTrace>("GET", `/api/runs/${id}/trace`);

// fazb3 / Faz B §2: OTel biçimli saklı span'ler (içeriksiz öznitelikler)
export interface OtelSpan {
  trace_id: string; span_id: string; parent_span_id: string | null; name: string; kind: string;
  start_ns: number; end_ns: number; status: "OK" | "ERROR" | "UNSET"; attributes: Record<string, string | number | boolean>;
}
export interface RunSpans { run_id: string; trace_id: string | null; source: "stored" | "live"; spans: OtelSpan[] }
export const fetchSpans = (id: string) => req<RunSpans>("GET", `/api/runs/${id}/spans`);
export const spansDownloadUrl = (id: string) => `/api/runs/${encodeURIComponent(id)}/spans?format=otlp`;

// ------------------------------------------------------------------ canlı güncellemeler (yeni SSE olayları)
/** Arayüzün adım kartına eklediği canlı alanlar (sunucu ayrıntısında yok; olaylardan). */
export type LiveStep = StepRun & { retry_at?: number | null; retry_reason?: string | null };
/** Koşu başlığındaki canlı uyarılar. */
export type LiveRun = Run & {
  budget_alert?: { metric: string; ratio?: number | null; used?: number; limit?: number; exceeded: boolean } | null;
  degraded?: { kind: string; failures: number } | null;
};

function updateRun(runId: string | undefined, fn: (r: LiveRun) => LiveRun) {
  if (!runId) return;
  useStudio.setState((st) => {
    const next: { runs?: Record<string, Run>; runList?: Run[] } = {};
    if (st.runs[runId]) next.runs = { ...st.runs, [runId]: fn(st.runs[runId]) };
    const idx = st.runList.findIndex((r) => r.id === runId);
    if (idx >= 0) {
      const list = [...st.runList];
      list[idx] = fn(list[idx]);
      next.runList = list;
    }
    return next;
  });
}

function patchStep(run: LiveRun, stepId: unknown, fn: (s: LiveStep) => LiveStep): LiveRun {
  if (typeof stepId !== "string") return run;
  return { ...run, steps: run.steps.map((s) => (s.id === stepId ? fn(s as LiveStep) : s)) };
}

// Bütçe çubuğu doğru kalsın: adım bitince / bütçe olaylarında açık koşunun ayrıntısı (koşu toplam kullanımı) tazelenir.
const refreshTimers = new Map<string, number>();
function refreshSoon(runId: string | undefined) {
  if (!runId || !useStudio.getState().runs[runId] || refreshTimers.has(runId)) return;
  refreshTimers.set(runId, window.setTimeout(() => {
    refreshTimers.delete(runId);
    void useStudio.getState().loadRun(runId);
  }, 400));
}

function onEvent(ev: StudioEvent) {
  const runId = ev.run_id;
  switch (ev.type) {
    case "run.pausing":  // zarif duraklatma sürüyor: düğme "Duraklatılıyor…" (devre dışı)
      updateRun(runId, (r) => ({ ...r, pausing: true }));
      break;
    case "run.paused":
      updateRun(runId, (r) => ({ ...r, status: (ev.status as string) || "paused", pause_reason: (ev.reason as string) ?? null,
        usage: (ev.usage as RunUsage) ?? r.usage, pausing: false }));
      refreshSoon(runId);
      break;
    case "step.held":  // iş koşu sınırında durdu, kararı bekliyor (süreci yok): "Çalışan" değil
      updateRun(runId, (r) => patchStep(r, ev.step, (s) => ({ ...s, status: "pending" })));
      refreshSoon(runId);
      break;
    case "run.resumed":
      updateRun(runId, (r) => ({ ...r, status: "running", error: null, finished_at: null, budget_alert: null, pausing: false,
        attempts: (ev.attempts as number) ?? r.attempts, resumed_at: new Date(ev.ts * 1000).toISOString() }));
      refreshSoon(runId);
      break;
    case "step.started":
      // yeni deneme: önceki denemenin araç çağrıları kartta birikmesin (ayrıntılar İz sekmesinde)
      updateRun(runId, (r) => patchStep(r, ev.step, (s) => ({ ...s, attempt: (ev.attempt as number) ?? s.attempt, retry_at: null, retry_reason: null,
        ...(Number(ev.attempt ?? 1) > 1 ? { tools: [], artifacts: [] } : {}) })));
      break;
    case "step.dispatched":  // model turu gerçekten gönderildi → "N. deneme" etiketi bu sayıdan
      if (typeof ev.tries === "number") updateRun(runId, (r) => patchStep(r, ev.step, (s) => ({ ...s, tries: ev.tries as number })));
      break;
    case "step.retried":
      updateRun(runId, (r) => patchStep(r, ev.step, (s) => ({ ...s, attempt: Math.max(s.attempt ?? 0, ((ev.attempt as number) ?? 1) - 1) })));
      break;
    case "step.retry_scheduled":
      updateRun(runId, (r) => patchStep(r, ev.step, (s) => ({ ...s, status: "pending",
        retry_at: ev.ts * 1000 + Number(ev.in_s ?? 0) * 1000, retry_reason: (ev.reason as string) ?? null })));
      break;
    case "step.finished":
      updateRun(runId, (r) => patchStep(r, ev.step, (s) => ({ ...s, attempt: (ev.attempt as number) ?? s.attempt,
        usage: (ev.usage as RunUsage) ?? s.usage, last_error: ev.status === "failed" ? ((ev.error as string) ?? s.last_error) : s.last_error })));
      refreshSoon(runId);
      break;
    case "step.awaiting":
      if (ev.ask || ev.kind)
        updateRun(runId, (r) => patchStep(r, ev.step, (s) => ({ ...s, ask: (ev.ask as StepAsk) ?? s.ask,
          kind: (ev.kind as StepRun["kind"]) ?? s.kind })));
      break;
    case "step.effect": {
      const eff = ev.effect as RunEffect | undefined;
      if (eff) updateRun(runId, (r) => ({ ...r, effects: [...(r.effects ?? []).filter((e) => e.id !== eff.id), eff] }));
      break;
    }
    case "budget.warning":
    case "budget.exceeded":
      updateRun(runId, (r) => ({ ...r, budget_alert: { metric: String(ev.metric ?? ""), ratio: ev.ratio as number | null,
        used: ev.used as number, limit: ev.limit as number, exceeded: ev.type === "budget.exceeded" } }));
      refreshSoon(runId);
      break;
    case "budget.updated":
      if (ev.scope === "run")
        updateRun(runId, (r) => ({ ...r, budget: (ev.budget as RunBudget) ?? r.budget, budget_alert: null }));
      refreshSoon(runId);
      break;
    case "connection.degraded":
      updateRun(runId, (r) => ({ ...r, degraded: { kind: String(ev.kind ?? ""), failures: Number(ev.failures ?? 0) } }));
      break;
  }
}

let registered = false;
/** Olay işleyicilerini bir kez bağlar (RunsPage yüklenince). */
export function ensureRunControlEvents() {
  if (registered) return;
  registered = true;
  for (const prefix of ["run.pausing", "run.paused", "run.resumed", "step.held", "step.started", "step.retried", "step.retry_scheduled", "step.finished", "step.dispatched",
    "step.awaiting", "step.effect", "budget.", "connection.degraded"]) registerEventHandler(prefix, onEvent);
}
ensureRunControlEvents();

/** Tek görev koşusunun iç kimliği ("gorev": adım, akış ve görev ailesi) arayüzde dil-bağımsız gösterilmez. */
export const traceId = (v: string | null | undefined, task: string): string => (v === "gorev" ? task : String(v ?? ""));
