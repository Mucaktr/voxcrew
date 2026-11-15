// "Oyun döngüsü 2" (PK2-LOOP): /api/game/loop istemcisi — ilk oturum, İkili ofis, açılım yolu, ofis sağlığı,
// sprint boss'u. Yazma uçları sunucuda kullanıcı-yalnızdır (MCP 403).
import { currentLocale } from "./i18n";
import { bodyText } from "./api";

export type FsStepId = "age" | "connection" | "office" | "task" | "working" | "delivered" | "accepted" | "reward";
export interface FirstSession {
  steps: { id: FsStepId; done: boolean; at: number | null }[];
  current: FsStepId | null;
  complete: boolean;
  started_at: number;
  office: string | null;
  accepted_at: number | null;
  pending_run: string | null;
  minutes_to_accept: number | null;
  bucket: "le10" | "le60" | "gt60" | null;
  target_min: number;
  within_target: boolean | null;
  rewards: { achievement: string | null; quest_slots: number };
  templates: string[];
  /** bağlantı adımı açıkken "local_model" = politika (güvenli mod) yalnız yerel modele izin veriyor*/
  connection_hint?: "local_model" | null;
}

export interface IkiliRole { key: string; name: string; title: string; role: string; color?: string; avatar?: Record<string, string> }
export interface IkiliTemplate {
  id: string; name: string; description: string; icon: string; workflow: string; workflow_name: string;
  roles: IkiliRole[];
}
export interface FirstOfficeResult {
  template: string; active: string[]; bench: string[]; swapped: { in: string; out: string }[];
  workflow?: string; message?: string | null; warnings?: string[];
}
/** kurulmadan önce yedeğe gidecek ajanlar (önizleme); `safe` = hiç çalışmamış başlangıç/İkili ajanı*/
export interface BenchCandidate { slug: string; name: string; origin: "starter" | "duo" | "user"; used: boolean; safe: boolean }
export interface FirstOfficePreview {
  template: string; preview: true; bench_plan: BenchCandidate[]; needs_confirm: boolean; blocked: boolean;
}

export type UnlockId = "workflows" | "goals" | "scheduler" | "triggers" | "delivery" | "quality" | "walk" | "builder";
export interface UnlockCard {
  id: UnlockId; level: number; to: string; state: "tried" | "spotlight" | "later"; usable: true;
  plan_limit: number | null; next?: boolean;
}
export interface UnlockPathData { level: number; cards: UnlockCard[]; next: UnlockId | null; done: number; total: number }

export type HealthId = "approvals" | "failures" | "stuck" | "budget" | "quality" | "bench";
export type HealthStatus = "ok" | "watch" | "act" | "none";
export interface HealthSignal {
  id: HealthId; status: HealthStatus; action: { key: string; to: string };
  [k: string]: unknown;
}
export interface OfficeHealthData { wad: number; week: string; window_days: number; signals: HealthSignal[]; attention: number }

export interface BossRow {
  week: string; kind: "workflow" | "goal"; ref: string; title: string; target: number;
  status: "active" | "defeated" | "resting"; created_at: number; defeated_at: number | null; reward: string | null;
}
export interface BossData {
  week: string; ends_at: number; current: (BossRow & { progress: number; accepted: number }) | null;
  history: BossRow[]; defeated: number; title: string | null; next_title: { need: number; title: string } | null;
}
export interface BossCandidates {
  workflows: { kind: "workflow"; ref: string; title: string; steps: number }[];
  goals: { kind: "goal"; ref: string; title: string }[];
  targets: Record<"workflow" | "goal", { min: number; max: number; default: number }>;
}

export class LoopApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

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
    throw new LoopApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

const B = "/api/game/loop";
export const loopApi = {
  firstSession: () => req<FirstSession>("GET", `${B}/first-session`),
  ikili: () => req<IkiliTemplate[]>("GET", `${B}/ikili`),
  firstOffice: (template: string, confirm = false) =>
    req<FirstOfficeResult>("POST", `${B}/first-office`, { template, confirm }),
  firstOfficePreview: (template: string) =>
    req<FirstOfficePreview>("POST", `${B}/first-office`, { template, dry_run: true }),
  unlockPath: () => req<UnlockPathData>("GET", `${B}/unlock-path`),
  health: () => req<OfficeHealthData>("GET", `${B}/health`),
  boss: () => req<BossData>("GET", `${B}/boss`),
  bossCandidates: () => req<BossCandidates>("GET", `${B}/boss/candidates`),
  pickBoss: (kind: "workflow" | "goal", ref: string, target?: number) =>
    req<BossData>("POST", `${B}/boss`, { kind, ref, target }),
  restBoss: () => req<BossData>("POST", `${B}/boss/rest`),
};
