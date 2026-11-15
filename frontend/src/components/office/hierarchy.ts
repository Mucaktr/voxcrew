// Ekip S6 (Faz 3) — rütbeler, roller, işe alınanlar, beyin stratejisi ve devretme türleri + /api/office ek istemcisi.
// lib/office.ts (Faz 2) dokunulmadan genişletilir; temel türler oradan içe aktarılır.
import { create } from "zustand";
import { currentLocale, tx } from "../../lib/i18n";
import { registerEventHandler } from "../../lib/store";
import type { Agent, StepRun, Workflow, WorkflowStep } from "../../lib/types";
import type { InstantiateResult, OfficeMember, OfficeTemplate, TemplateRole } from "../../lib/office";
import { officeMsg } from "../../locales/office";
import { bodyText } from "../../lib/api";

type OfficeKey = keyof typeof officeMsg.tr;
/** Anahtar listesinden dil duyarlı (getter) etiket tablosu: `TABLE[k]` şu anki dilde döner (Faz 5 i18n). */
function i18nTable<K extends string>(keys: readonly K[], prefix: string): Record<K, string> {
  return Object.defineProperties({} as Record<K, string>, Object.fromEntries(
    keys.map((k) => [k, { enumerable: true, get: () => tx(officeMsg, `${prefix}${k}` as OfficeKey) }]),
  )) as Record<K, string>;
}

// ---------------------------------------------------------------- rütbeler
export type Rank = "ceo" | "deputy" | "director" | "manager" | "lead" | "senior" | "specialist" | "analyst" | "intern";
export const RANKS: Rank[] = ["ceo", "deputy", "director", "manager", "lead", "senior", "specialist", "analyst", "intern"];
/** Rütbe etiketleri (şu anki dilde; sunucunun `rank_label` alanıyla aynı sözlük). */
export const RANK_LABELS: Record<Rank, string> = i18nTable(RANKS, "rank_");
/** Dar alanlar (org şeması kartı) için kısa etiketler. */
export const RANK_SHORT: Record<Rank, string> = i18nTable(RANKS, "short_");

export function isRank(v: unknown): v is Rank {
  return typeof v === "string" && (RANKS as string[]).includes(v);
}
export function rankIndex(r: string | null | undefined): number {
  return isRank(r) ? RANKS.indexOf(r) : -1;
}
export function rankLabel(r: string | null | undefined): string | null {
  return isRank(r) ? RANK_LABELS[r] : null;
}
/** Rozet tonu: üst yönetim altın, yönetim mavi, liderler yeşil, diğerleri sade. */
export function rankTone(r: string | null | undefined): "warn" | "info" | "ok" | "muted" {
  const i = rankIndex(r);
  if (i < 0) return "muted";
  if (i <= 1) return "warn";
  if (i <= 3) return "info";
  if (i <= 5) return "ok";
  return "muted";
}
/** Raporlama hattı rütbe sırasına uyuyor mu? (sunucu yalnızca uyarır; burada da engellemiyoruz) */
export function rankConflict(member: Agent | undefined, boss: Agent | undefined): boolean {
  const m = rankIndex(member?.rank), b = rankIndex(boss?.rank);
  return m >= 0 && b >= 0 && b >= m;
}

// ---------------------------------------------------------------- roller
export interface RoleInfo {
  id: string;
  name: string;
  description: string;
  team: string | null;
  rank: Rank | null;
  rank_label: string | null;
  skills_hint: string[];
  brain_hint: "light" | "standard" | "heavy" | null;
  template?: string | null;
  created_at?: string;
  holder: string | null;
  holders: string[];
}

export type MemberX = OfficeMember & {
  rank?: Rank | null;
  rank_label?: string | null;
  hired_by?: string | null;
  hired_in_run?: string | null;
  role_id?: string | null;
  role_name?: string | null;
};

// ---------------------------------------------------------------- şablon önizleme + strateji
export type Strategy = "economy" | "balanced" | "quality";
export const STRATEGIES: { id: Strategy; title: string; text: string }[] = (["economy", "balanced", "quality"] as Strategy[]).map((id) =>
  Object.defineProperties({ id } as { id: Strategy; title: string; text: string }, {
    title: { enumerable: true, get: () => tx(officeMsg, `strat_${id}` as OfficeKey) },
    text: { enumerable: true, get: () => tx(officeMsg, `strat_${id}_text` as OfficeKey) },
  }));

export type TemplateRoleX = TemplateRole & { rank?: Rank | null; rank_label?: string | null; brain_hint?: string };
export type OfficeTemplateX = Omit<OfficeTemplate, "roles" | "workflow_steps"> & {
  roles: TemplateRoleX[];
  levels?: number;
  category?: string;
  workflow_steps?: { id: string; type: "agent" | "approval" | "delegate"; title: string; agent?: string | null;
                     role?: string | null; depends_on: string[] }[];
};

export interface BrainChoice {
  brain: "codex" | "ollama" | "claude" | "profile";
  runtime: "hermes" | "direct";
  hermes_profile: string | null;
  model: string | null;
  label: string;
}
export interface PreviewRole {
  key: string;
  slug: string;
  exists: boolean;
  name: string;
  title: string;
  team: string;
  rank: Rank | null;
  rank_label: string | null;
  brain_hint: string;
  brain: BrainChoice;
  skills: { name: string; installed: boolean }[];
}
export interface TemplatePreview {
  template: string;
  prefix: string;
  strategy: Strategy | null;
  strategy_label: string | null;
  profile: string | null;
  profiles: string[];
  available: Record<"hermes" | "codex" | "claude" | "ollama", boolean> | null;
  skills_source: string | null;
  roles: PreviewRole[];
  brain_counts: Record<string, number>;
  step_counts: Record<string, number>;
  step_summary: string;
  counts: { new: number; existing: number };
  warnings: string[];
  workflow_exists: boolean;
}
export interface StrategyRequest {
  strategy: Strategy;
  hermes_profile?: string;
  model?: string;
  prefix?: string;
  assign_skills?: boolean;
}
export type InstantiateResultX = InstantiateResult & {
  strategy?: Strategy | null;
  warnings?: string[];
  roles?: { created: string[]; skipped: string[] };
  brains?: Record<string, BrainChoice>;
};

// ---------------------------------------------------------------- iş akışı ve koşu türleri (types.ts'yi genişletir)
export type FlowStep = WorkflowStep & {
  role?: string | null;
  depth?: number;
  max_subtasks?: number;
  allow_hiring?: boolean;
  hiring_approval?: "ask" | "auto";
  hire_budget?: number;
};
export const DELEGATE_DEFAULTS = { depth: 2, max_subtasks: 6, allow_hiring: true, hiring_approval: "ask" as const, hire_budget: 2 };

export interface HireInfo {
  title: string;
  role: string;
  rank: Rank;
  rank_label: string;
  skills_hint: string[];
  persona: string;
  by: string;
  by_name: string;
  team?: string | null;
  team_name?: string | null;
  subtask?: string;
}
export interface PlanItem {
  id: string;
  step: string;
  title: string;
  assignee: string;
  assignee_name: string;
  assignee_title?: string | null;
  hired: boolean;
  hire_rejected: boolean;
  nested: boolean;
  depends_on: string[];
}
export type DynStep = StepRun & {
  role?: string | null;
  kind?: "subtask" | "hire" | "synthesis" | null;
  hire?: HireInfo | null;
  plan?: PlanItem[] | null;
  delegate?: { depth: number; max_subtasks: number; allow_hiring: boolean; hiring_approval: "ask" | "auto";
               hire_budget: number; level: number; hires_left: number } | null;
};

/** Rol id → taşıyıcı ajan slug'ı. */
export function holderMap(roles: RoleInfo[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of roles) if (r.holder) m.set(r.id, r.holder);
  return m;
}

/** Adımın (ajan ya da rol) çalışacağı ajan. */
export function stepAgent(step: { agent?: string | null; role?: string | null }, holders: Map<string, string>): string | undefined {
  if (step.agent) return step.agent;
  return step.role ? holders.get(step.role) : undefined;
}

/** Org şeması teslim çizgileri ve ofis görünümü için rol adımlarını sahiplerine çözülmüş akış kopyası. */
export function resolveWorkflow(wf: Workflow | null | undefined, holders: Map<string, string>): Workflow | null {
  if (!wf) return null;
  return { ...wf, steps: wf.steps.map((s) => {
    const fs = s as FlowStep;
    return fs.role && !fs.agent ? { ...s, agent: holders.get(fs.role) ?? "" } : s;
  }) };
}

// ---------------------------------------------------------------- istemci
async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    // X-Studio-Lang: rütbe etiketleri, şablon önizlemesi ve hata iletileri istek dilinde döner (Faz 5 i18n)
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = bodyText(res.status, null);
    try {
      const j = await res.json();
      msg = bodyText(res.status, j);
    } catch { /* gövde yok */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;

export const hierarchyApi = {
  members: () => req<{ members: MemberX[]; roles: RoleInfo[] }>("GET", "/api/office"),
  roles: () => req<RoleInfo[]>("GET", "/api/office/roles"),
  createRole: (data: { name: string; description?: string; team?: string | null; rank?: Rank | null; holder?: string | null }) =>
    req<RoleInfo>("POST", "/api/office/roles", data),
  updateRole: (id: string, data: Partial<Pick<RoleInfo, "name" | "description" | "team" | "rank" | "skills_hint">> & { holder?: string | null }) =>
    req<RoleInfo>("PATCH", `/api/office/roles/${enc(id)}`, data),
  deleteRole: (id: string) => req<{ ok: boolean }>("DELETE", `/api/office/roles/${enc(id)}`),
  setRank: (slug: string, rank: Rank | null) =>
    req<Agent & { warnings?: string[] }>("PATCH", `/api/office/members/${enc(slug)}`, { rank }),
  assignX: (slug: string, data: { team?: string | null; title?: string | null; reports_to?: string | null; rank?: Rank | null; role_id?: string | null }) =>
    req<Agent & { warnings?: string[] }>("PATCH", `/api/office/members/${enc(slug)}`, data),
  fire: (slug: string, mode: "hide" | "delete") =>
    req<{ ok: boolean; mode: string; reassigned: string[]; new_manager: string | null }>("POST", `/api/office/members/${enc(slug)}/fire`, { mode }),
  preview: (id: string, data: StrategyRequest) => req<TemplatePreview>("POST", `/api/office/templates/${enc(id)}/preview`, data),
  instantiate: (id: string, data: StrategyRequest) =>
    req<InstantiateResultX>("POST", `/api/office/templates/${enc(id)}/instantiate`, data),
};

// ---------------------------------------------------------------- roller + üye ayrıntıları deposu
interface HierarchyStore {
  roles: RoleInfo[];
  members: MemberX[];
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useHierarchy = create<HierarchyStore>((set) => ({
  roles: [],
  members: [],
  loaded: false,
  error: null,
  refresh: () => {
    if (inflight) return inflight;
    inflight = hierarchyApi.members()
      .then((ov) => set({ roles: ov.roles ?? [], members: ov.members ?? [], loaded: true, error: null }))
      .catch((e: unknown) => set({ loaded: true, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => { inflight = null; });
    return inflight;
  },
}));

let synced = false;
/** Ofis değişikliği ve işe alım olaylarında roller/üyeler deposunu tazeler (bir kez bağlanır). */
export function ensureHierarchySync(): void {
  if (synced) return;
  synced = true;
  // Ardışık olayları birleştir ve store.ts'nin kendi yenilemelerinden sonra çalış (eşzamanlı okumaları azaltır)
  let timer: number | undefined;
  const refresh = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { void useHierarchy.getState().refresh(); }, 400);
  };
  registerEventHandler("office.", refresh);
  registerEventHandler("agent.hired", refresh);
  registerEventHandler("agent.removed", refresh);
}
