// TRUST — güvenli mod ön ayarı ve yerel 18+ beyanı istemcisi (backend: studio/safemode.py, /api/safe-mode).
// Yazma uçları kullanıcıya aittir (arayüz jetonu lib/presence.ts sarmalayıcısıyla otomatik eklenir; MCP yazamaz).
// Beyan yalnız yerel settings.json'a yazılır: hiçbir yere gönderilmez, kimlik istenmez.
import { create } from "zustand";
import { ApiError, bodyText } from "./api";
import { currentLocale } from "./i18n";
import { registerEventHandler } from "./store";
import type { AgeRecord } from "./trust";

export { fmtValue, needsAgeDialog, type AgeRecord, type ValueWords } from "./trust";

export type SafeItemId =
  | "models_local_only" | "models_consent" | "agents_read_only" | "no_shell" | "approve_every_tool" | "approve_every_step" | "no_hiring"
  | "schedule_pause" | "mcp_no_decisions" | "quality_on" | "external_gate_block" | "transcripts_claude"
  | "transcripts_codex" | "prompts_claude" | "prompts_codex" | "otlp_no_prompts" | "injection_block" | "run_budget"
  | "daily_budget";
export type SafeGroup = "models" | "agents" | "approvals" | "delivery" | "privacy" | "budget";
export type SafeNote = "delivery_always_asks" | "tool_approval_scope" | "codex_hermes_not_enforced" | "budget_subscription" | "triggers_paused_by_approvals" | "daily_cap_scope" | "not_a_lock";

export interface SafeItem {
  id: SafeItemId;
  key: string;
  group: SafeGroup;
  current: unknown;
  safe: unknown;
  changed: boolean;
  kind: "bool" | "value";
  applied: boolean;
}

export interface SafeModeStatus {
  enabled: boolean;
  since: string | null;
  source: "user" | "age" | null;
  items: SafeItem[];
  pending: number;
  notes: SafeNote[];
  age: AgeRecord | null;
  changed?: SafeItemId[];
  restored?: SafeItemId[];
  kept?: SafeItemId[];
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
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const safeModeApi = {
  status: () => req<SafeModeStatus>("GET", "/api/safe-mode"),
  enable: () => req<SafeModeStatus>("POST", "/api/safe-mode/enable", {}),
  disable: () => req<SafeModeStatus>("POST", "/api/safe-mode/disable", {}),
  setItem: (id: SafeItemId, value: boolean) => req<SafeModeStatus>("PUT", `/api/safe-mode/items/${id}`, { value }),
  age: (adult: boolean) => req<SafeModeStatus>("POST", "/api/safe-mode/age", { adult }),
};

interface SafeModeStore {
  status: SafeModeStatus | null;
  load: () => Promise<SafeModeStatus | null>;
  set: (s: SafeModeStatus) => void;
}

export const useSafeMode = create<SafeModeStore>((set) => ({
  status: null,
  load: async () => {
    try {
      const s = await safeModeApi.status();
      set({ status: s });
      return s;
    } catch {
      return null; // sunucu yok: rozet ve diyalog hiçbir şey göstermez
    }
  },
  set: (s) => set({ status: s }),
}));

let wired = false;
/** Bir kez: başka sekmede ya da yaş beyanıyla açılınca rozet güncel kalsın. */
export function wireSafeMode(): void {
  if (wired) return;
  wired = true;
  void useSafeMode.getState().load();
  registerEventHandler("safe_mode.", () => { void useSafeMode.getState().load(); });
}
