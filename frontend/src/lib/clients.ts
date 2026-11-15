// Ekip S11 — Claude Code ve Codex içinden kullanım (MCP): /api/clients istemcisi, köken etiketleri,
// "son MCP çağrısı" canlı kaydı (clients.seen olayı).
import { create } from "zustand";
import { connect as m } from "../locales/connect";
import type { ChangePlan } from "./changes";
import { currentLocale, tx } from "./i18n";
import { registerEventHandler } from "./store";
import { bodyText } from "./api";

export type ClientId = "claude-code" | "codex";
export const CLIENT_IDS: ClientId[] = ["claude-code", "codex"];
export const CLIENT_NAMES: Record<ClientId, string> = { "claude-code": "Claude Code", codex: "Codex" };

export function isClientId(v: string | undefined | null): v is ClientId {
  return v === "claude-code" || v === "codex";
}

export interface SeenEntry {
  kind: string;
  client: string;
  first_seen: number;
  last_seen: number;
  count: number;
  last_method?: string;
  last_path?: string;
}

export interface CliInfo {
  available: boolean;
  version?: string | null;
  path?: string | null;
  logged_in?: boolean | null;
  detail?: string | null;
}

export interface ClientsStatus {
  clients: Record<ClientId, { cli: CliInfo; last_seen: SeenEntry | null }>;
  others: SeenEntry[];
  settings: { enabled: boolean; allow_decisions: boolean; agent_delete?: boolean };  // AGENT-DELETE: "Ajanlar silebilsin"
  node: { available: boolean; version: string | null; supported?: boolean | null };
  server: { exists: boolean; plugin_copy: boolean; hook: boolean };
  codex_config: {
    path: string; display: string; exists: boolean; has_server: boolean;
    notify: "none" | "ours" | "other"; error: string | null;
  };
  now: number;
}

export interface Snippets {
  shell: "powershell" | "bash";
  studio_url: string;
  custom_url: boolean;
  paths: { repo: string; server: string; plugin_dir: string; hook: string };
  exists: { server: boolean; plugin_server: boolean; plugin_mcp_json: boolean; hook: boolean; marketplace: boolean };
  claude_code: {
    plugin: string[]; plugin_github?: string[]; repo_public?: boolean; user: string; project_json: string; verify: string[];
  };
  codex: { add: string; toml: string; notify: string; agents_md: string; verify: string[] };
  examples: string[];
}

export interface NotifyInfo {
  requested: boolean;
  status: "added" | "exists_same" | "conflict" | "skipped";
  existing?: string[];
  desired?: string[];
  value?: string[];
}

export interface CodexPlanResponse {
  plan: ChangePlan;
  target: string;
  display: string;
  action: "add" | "update" | "keep";
  block: string;
  notify: NotifyInfo;
  notes: string[];
  warnings: string[];
}

export interface ClaudePlanResponse {
  plan: ChangePlan;
  target: string;
  action: "add" | "update" | "keep";
  others: string[];
  notes: string[];
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    // X-Studio-Lang: sunucu katalog adlarını ve hata iletilerini bu dilde döner (Faz 5 i18n)
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

export const clientsApi = {
  status: (force = false) => call<ClientsStatus>("GET", `/api/clients/status${force ? "?force=true" : ""}`),
  snippets: () => call<Snippets>("GET", "/api/clients/snippets"),
  codexPlan: (notify: boolean) => call<CodexPlanResponse>("POST", "/api/clients/codex/plan", { notify }),
  claudePlan: (projectDir: string) => call<ClaudePlanResponse>("POST", "/api/clients/claude/plan", { project_dir: projectDir }),
  /** clients.mcp ayarları — yalnızca kullanıcının açık tıklamasıyla çağrılır */
  saveMcpSettings: (patch: Partial<ClientsStatus["settings"]>) =>
    call<unknown>("PUT", "/api/settings", { clients: { mcp: patch } }),
  /** AGENT-DELETE: "Ajanlar silebilsin" (yalnız arayüz; açmadan önce risk onayı McpSecurity'de) */
  saveAgentDelete: (allow: boolean) =>
    call<unknown>("PUT", "/api/settings", { clients: { agents: { allow_delete: allow } } }),
};

// ------------------------------------------------------------------ koşu kökeni ("mcp:claude-code" …)
export interface OriginInfo {
  client: string;
  /** "Claude Code'dan", "Codex'ten", "<ad> üzerinden" */
  label: string;
  /** kısa ad: "Claude Code", "Codex", "<ad>" */
  short: string;
  known: ClientId | null;
}

export function originInfo(origin?: string | null): OriginInfo | null {
  if (!origin || !origin.startsWith("mcp:")) return null;
  const client = origin.slice(4).trim();
  if (!client) return null;
  if (client === "claude-code") return { client, label: tx(m, "origin_claude"), short: "Claude Code", known: "claude-code" };
  if (client === "codex") return { client, label: tx(m, "origin_codex"), short: "Codex", known: "codex" };
  return { client, label: tx(m, "origin_other", { client }), short: client, known: null };
}

// ------------------------------------------------------------------ canlı "son MCP çağrısı"
interface SeenStore {
  /** istemci → son görülme (epoch sn) — clients.seen olayından */
  seen: Record<string, number>;
}

const useSeenStore = create<SeenStore>(() => ({ seen: {} }));
let seenRegistered = false;

/** clients.seen olaylarını dinlemeye başlar (bir kez; sayfa açılınca çağrılır). */
export function ensureClientEvents(): void {
  if (seenRegistered) return;
  seenRegistered = true;
  registerEventHandler("clients.", (ev) => {
    if (ev.type !== "clients.seen" || ev.kind !== "mcp" || typeof ev.client !== "string") return;
    const ts = typeof ev.last_seen === "number" ? ev.last_seen : ev.ts;
    useSeenStore.setState((s) => ({ seen: { ...s.seen, [ev.client as string]: ts } }));
  });
}

/** Olaylardan gelen son görülme zamanı (epoch sn); yoksa undefined. Seçici sayı döndürür (kararlı). */
export function useLiveLastSeen(client: string): number | undefined {
  return useSeenStore((s) => s.seen[client]);
}
