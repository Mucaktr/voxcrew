// Ekip S27 — /api/tools istemcisi ve türleri (MCP araç köprüsü + guardrail). Bkz. backend/studio/tools/api.py.
// `guard.flagged` olaylarını store.ts'ye dokunmadan canlı akışa uyarı olarak ekler (registerEventHandler).
import { currentLocale, tx } from "./i18n";
import { registerEventHandler, useStudio } from "./store";
import type { StudioEvent } from "./types";
import { toolsMsg } from "../locales/tools";
import { bodyText } from "./api";

export type Transport = "stdio" | "http";
export type ServerStatus = "ok" | "error" | "unknown" | "running" | "probing" | "disabled" | "invalid";
export type InjectionMode = "off" | "warn" | "block";
/** aracın yan etki sınıfı (yürütme defteri yan etkili aracı baştan çalışmada yeniden yürütmez)*/
export type ToolClass = "read" | "idempotent" | "effect";

export interface McpServerInput {
  id: string;
  name?: string;
  transport: Transport;
  command?: string;
  args?: string[];
  url?: string;
  enabled?: boolean;
  /** Karar 1: alt sürece aktarılacak ortam değişkeni ADLARI (değer asla) */
  env_refs?: string[];
  /** `env_refs` eklenir/değişirse: kullanıcının onayladığı adlar (yeni kümeyle birebir) */
  confirm_env?: string[];
}

export interface McpServer extends McpServerInput {
  status: ServerStatus;
  active_sessions: number;
  /** `class` = etkin yan etki sınıfı; `user_class` = kullanıcının işareti; `hints` = MCP açıklamaları*/
  tools: { name: string; description: string; class?: ToolClass; user_class?: ToolClass | null;
           hints?: { readOnlyHint?: boolean; idempotentHint?: boolean; destructiveHint?: boolean } | null;
           /** sunucu beyanından çıkan sınıf (çelişkide yan etkili) ve sunucu bir şey beyan etti mi*/
           declared?: ToolClass; declared_by_server?: boolean }[];
  probed_at: number | null;
  error: string | null;
  invalid?: string;
  protocol_version?: string | null;
  stateless?: boolean | null;
  server_info?: { name?: string; version?: string } | null;
  /** yalnızca "tanımlı mı" (değer asla gelmez) */
  env_status?: { name: string; set: boolean }[];
}

export interface Enforcement { enforced: boolean; how: string }

export interface ToolsOverview {
  servers: McpServer[];
  settings: { allow: string[]; deny: string[]; max_rounds: number; call_timeout_s: number };
  guard: { injection: InjectionMode; output_schema_retries: number };
  enforcement: Record<string, Enforcement>;
  agents: { slug: string; name?: string; connector: string | null; servers: string[]; allow: string[]; deny: string[]; enforced: boolean }[];
}

export interface AgentToolPolicy {
  allow: string[];
  deny: string[];
  servers: string[];
  auto_approve: string[];
  agent: { allow: string[]; deny: string[]; mcp: string[]; auto_approve: string[] };
  unknown_servers: string[];
}

export interface AgentToolsView {
  slug: string;
  route: { connector: string | null; connection: string | null; model: string | null };
  enforcement: Enforcement;
  notes: string[];
  policy: AgentToolPolicy;
  servers: { id: string; listed: boolean; count: number }[];
  tools: { name: string; server: string; tool: string; description: string; allowed: boolean; needs_approval: boolean }[];
  available_servers: string[];
}

export interface ProbeResult {
  server: string;
  ok: boolean;
  ms: number;
  error: string | null;
  protocol_version?: string | null;
  stateless?: boolean | null;
  tools: { name: string; description: string }[];
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
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const toolsApi = {
  overview: () => req<ToolsOverview>("GET", "/api/tools"),
  saveSettings: (patch: Partial<{ allow: string[]; deny: string[]; max_rounds: number; call_timeout_s: number; injection: InjectionMode }>) =>
    req<ToolsOverview>("PUT", "/api/tools/settings", patch),
  addServer: (s: McpServerInput) => req<ToolsOverview>("POST", "/api/tools/servers", s),
  updateServer: (id: string, s: Partial<McpServerInput>) => req<ToolsOverview>("PUT", `/api/tools/servers/${encodeURIComponent(id)}`, s),
  deleteServer: (id: string) => req<ToolsOverview>("DELETE", `/api/tools/servers/${encodeURIComponent(id)}`),
  probe: (id: string) => req<ProbeResult>("POST", `/api/tools/servers/${encodeURIComponent(id)}/probe`),
  setToolClass: (tool: string, cls: ToolClass | null) => req<ToolsOverview>("PUT", "/api/tools/classes", { tool, class: cls }),
  agent: (slug: string) => req<AgentToolsView>("GET", `/api/tools/agents/${encodeURIComponent(slug)}`),
  saveAgent: (slug: string, patch: Partial<{ allow: string[]; deny: string[]; mcp: string[]; auto_approve: string[] }>) =>
    req<AgentToolsView>("PUT", `/api/tools/agents/${encodeURIComponent(slug)}`, patch),
};

/** Kalıp girdisi istemci tarafında hızlı denetim (sunucu yine doğrular). */
export const PATTERN_RE = /^[A-Za-z0-9_.:*?[\]/-]{1,120}$/;

// ------------------------------------------------------------------ guard.flagged → canlı akış uyarısı
let flagSeq = 0;
const SECTION_KEYS: Record<string, "section_upstream" | "section_memory" | "section_tool_output"> = {
  upstream: "section_upstream", memory: "section_memory", tool_output: "section_tool_output",
};

function onGuardFlagged(ev: StudioEvent) {
  if (ev.type !== "guard.flagged") return;
  const raw = String(ev.section ?? "");
  const key = SECTION_KEYS[raw];
  const section = key ? tx(toolsMsg, key) : raw.includes("mesaj") || raw.includes("inbox") ? tx(toolsMsg, "section_inbox") : raw;
  const action = tx(toolsMsg, ev.mode === "block" ? "feed_flag_block" : "feed_flag_warn");
  const patterns = Array.isArray(ev.patterns) ? (ev.patterns as string[]).join(", ") : "";
  // Akış öğe kimlikleri store'un sayacından ayrışsın diye negatif (yalnızca React anahtarı olarak kullanılır)
  const item = { id: -(++flagSeq), ts: ev.ts * 1000, agent: ev.agent as string | undefined, run_id: ev.run_id,
                 kind: "error" as const, text: tx(toolsMsg, "feed_flagged", { section, action }) + (patterns ? ` · ${patterns}` : "") };
  useStudio.setState((s) => ({ feed: [item, ...s.feed].slice(0, 80) }));
}

registerEventHandler("guard.", onGuardFlagged);
