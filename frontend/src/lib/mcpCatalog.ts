// CG2 — MCP bağlayıcı kataloğu (/api/mcp-catalog): türler ve istemci. Hiçbir şey kendiliğinden kurulmaz; yapılandırma
// değişiklik servisinden (plan → onay → yedek → geri al) geçer.
import type { ChangePlan } from "./changes";
import { currentLocale } from "./i18n";
import type { McpServerInput } from "./tools";
import { bodyText } from "./api";

export type Reliability = "resmi" | "topluluk" | "deneysel";
export type Verification = "verified" | "partial" | "unverified";
export type CatalogBrain = "claude" | "codex";

export interface CatalogEntry {
  id: string;
  category: string;
  name: string;
  purpose: string;
  reliability: Reliability;
  transport: "stdio" | "http";
  launch: { command?: string; args?: string[]; url?: string };
  env: string[];
  env_optional: string[];
  params: Record<string, string>;
  verification: { status: Verification; source: string | null; checked_at: string; note: string | null };
  unlocks: { delivery: string[]; triggers: string[]; recipes: string[] };
  notes: string | null;
  commands: Record<CatalogBrain, string>;
  voxcrew_server: (McpServerInput & { id: string }) | null;
  configured: string[];
  /** Karar 1: yalnızca "tanımlı mı" (değer asla gelmez) ve değersiz, işletim sistemine göre tanımlama ipucu */
  env_status: { name: string; set: boolean }[];
  env_hint: { platform: "windows" | "macos" | "linux"; rc: string | null; lines: string[] } | null;
}

export interface CatalogList { items: CatalogEntry[]; checked_at: string; reliability: Reliability[] }
export interface CatalogPlan { plan: ChangePlan; target: string; action: "add" | "keep"; command: string; notes: string[] }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = bodyText(res.status, j); } catch { /* boş */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const mcpCatalogApi = {
  list: () => req<CatalogList>("GET", `/api/mcp-catalog?lang=${currentLocale()}`),
  plan: (id: string, brain: CatalogBrain, opts: { project_dir?: string; params?: Record<string, string> }) =>
    req<CatalogPlan>("POST", `/api/mcp-catalog/${encodeURIComponent(id)}/plan`, { brain, ...opts }),
};
