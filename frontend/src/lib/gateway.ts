// Ekip S2: /api/gateway (Hermes API sunucusu) + araç onayları — türler ve istemci
import { currentLocale } from "./i18n";
import type { ChangePlan } from "./changes";
import type { StepRun } from "./types";
import { bodyText } from "./api";

export type GatewayState = "stopped" | "starting" | "running" | "external" | "error";
export type ProfileGatewayState = "unconfigured" | "configured" | "starting" | "running" | "external" | "error";

export interface GatewayInfo {
  port: number;
  url: string;
  state: GatewayState;
  busy: string | null;
  running: boolean;
  healthy: boolean;
  managed: boolean;
  external: boolean;
  version?: string | null;
  pid?: number | null;
  started_at?: string | null;
  exit_code?: number | null;
  error?: string | null;
  hermes_found: boolean;
  can_start: boolean;
  start_blocker: string | null;
  can_stop: boolean;
  log_path: string;
  command: string;
}

export interface GatewayProfileStatus {
  profile: string;
  port: number;
  key_present: boolean;
  enabled_in_env: boolean;
  running: boolean;
  pid?: number | null;
  healthy: boolean;
  managed: boolean;
  url: string;
  env_path: string;
  env_exists: boolean;
  state: ProfileGatewayState;
  adapters: string[];
}

export interface GatewayOverview {
  gateway: GatewayInfo;
  profiles: GatewayProfileStatus[];
}

export interface EnvChange {
  key: string;
  action: "add" | "update" | "keep";
  value_preview: string;
}

export interface GatewayPlan extends ChangePlan {
  profile: string;
  root: boolean;
  changes: EnvChange[];
  backup_pattern: string | null;
}

export interface GatewayPreview {
  plans: GatewayPlan[];
  warnings: string[];
  profiles: string[];
  port: number;
}

export interface EnableResult {
  ok: boolean;
  applied: { id: string; profile: string; path: string; summary: string; backup: string | null; skipped: boolean }[];
  failed: { plan_id: string; profile: string; error: string } | null;
  status: GatewayOverview;
}

// ------------------------------------------------------------------ araç onayları (adım alanları)
export type ApprovalChoice = "once" | "session" | "always" | "deny";

export interface ToolApprovalRequest {
  approval_id: string;
  tool?: string | null;
  command: string;
  description: string;
  summary?: string;
  choices: ApprovalChoice[];
  allow_session: boolean;
  allow_permanent: boolean;
  requested_at?: string;
  timeout_s?: number;
  expires_at?: number; // epoch saniye (sunucu)
}

export interface ToolApprovalRecord {
  approval_id: string;
  tool?: string | null;
  command?: string;
  description?: string;
  choice: ApprovalChoice;
  note?: string | null;
  timed_out?: boolean;
  error?: string | null;
  decided_at?: string;
}

/** Adıma gerçekte ne gönderildi (Step.invocation) — istem metni içermez. */
export interface StepInvocation {
  transport?: "cli" | "api" | string;
  mode?: string;
  reason?: string;
  profile?: string;
  provider?: string | null;
  model?: string | null;
  skills?: string[];
  toolsets?: string[];
  reasoning?: string | null;
  argv_flags?: string[];
  endpoint?: string;
  hermes_run_id?: string;
  session_id?: string | null;
  warnings?: string[];
  skipped_skills?: string[];
}

// TODO(teknik lider): bu alanlar types.ts → StepRun'a taşınabilir; S2 sahibi olmadığı için burada genişletiyor.
export interface GatewayStepFields {
  invocation?: StepInvocation | null;
  pending_approval?: ToolApprovalRequest | null;
  approvals?: ToolApprovalRecord[];
  warning?: string | null;
}
export type StepWithGateway = StepRun & GatewayStepFields;

export const CHOICE_LABEL: Record<ApprovalChoice, string> = {
  once: "Bir kez izin verildi",
  session: "Bu oturumda izin verildi",
  always: "Her zaman izin verildi",
  deny: "Reddedildi",
};

/** Kullanıcının kararını bekleyen araç onayı sayısı (ör. kenar çubuğu rozeti için — TODO(S4): App.tsx'te göster). */
export function countPendingToolApprovals(runs: { steps: StepRun[] }[]): number {
  return runs.reduce((n, r) => n + r.steps.filter((s) => s.status === "awaiting_tool_approval").length, 0);
}

/** "CLI · -s a,b · -t web · --reasoning high" ya da "API · POST /p/x/v1/runs · reasoning high" */
export function invocationLine(inv?: StepInvocation | null): string | null {
  if (!inv || !inv.transport) return null;
  const parts: string[] = [];
  if (inv.transport === "api") {
    parts.push("Hermes API");
    if (inv.endpoint) parts.push(inv.endpoint);
    if (inv.provider) parts.push(`provider ${inv.provider}`);
    if (inv.model) parts.push(`model ${inv.model}`);
    if (inv.reasoning) parts.push(`reasoning ${inv.reasoning}`);
  } else {
    parts.push("CLI");
    if (inv.provider) parts.push(`--provider ${inv.provider}`);
    if (inv.model) parts.push(`-m ${inv.model}`);
    if (inv.argv_flags?.length) {
      for (let i = 0; i < inv.argv_flags.length; i += 2) parts.push(inv.argv_flags.slice(i, i + 2).join(" "));
    } else {
      if (inv.skills?.length) parts.push(`-s ${inv.skills.join(",")}`);
      if (inv.toolsets?.length) parts.push(`-t ${inv.toolsets.join(",")}`);
      if (inv.reasoning) parts.push(`--reasoning ${inv.reasoning}`);
    }
  }
  return parts.join(" · ");
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
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
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const gatewayApi = {
  overview: (force = false) => call<GatewayOverview>("GET", `/api/gateway${force ? "?force=true" : ""}`),
  status: () => call<GatewayProfileStatus[]>("GET", "/api/gateway/status"),
  preview: (profiles: string[]) =>
    call<GatewayPreview>("GET", `/api/gateway/preview?profiles=${encodeURIComponent(profiles.join(","))}`),
  enable: (planIds: string[]) => call<EnableResult>("POST", "/api/gateway/enable", { plan_ids: planIds, confirm: true }),
  start: () => call<GatewayOverview>("POST", "/api/gateway/start", { confirm: true }),
  stop: () => call<GatewayOverview>("POST", "/api/gateway/stop"),
  logs: (lines = 200) => call<{ path: string; lines: string[] }>("GET", `/api/gateway/logs?lines=${lines}`),
  /** Araç onayı kararı — yalnızca kullanıcının açık tıklamasıyla çağrılır. */
  decideTool: (runId: string, approvalId: string, choice: ApprovalChoice) =>
    call<{ ok: boolean }>("POST", `/api/runs/${runId}/approvals/${encodeURIComponent(approvalId)}`, { choice }),
};
