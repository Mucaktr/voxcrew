// S44 — Kahramanlar API istemcisi (/api/heroes). İşe alma iki adımlıdır: confirm'süz çağrı yalnızca plan döner.
import { ApiError, bodyText } from "./api";
import { currentLocale } from "./i18n";
import type { Agent, Avatar } from "./types";

export type BrainKind = "hermes" | "codex" | "claude" | "openai_compat" | "ollama";

export interface HeroBrain { chain: BrainKind[]; pick: BrainKind; ready: boolean; available: BrainKind[]; blocked: BrainKind[] }
export interface HeroTool { id: string; label: string; kind: string; access: "read" | "write"; why: string; suggested: true; enabled: false }
export interface Hero {
  id: string;
  preset_id: string;
  archetype: string;
  name: string;
  title: string;
  problem: string;
  origin: string;
  catchphrase: string;
  color: string;
  avatar: Avatar;
  ip_risk: number;
  license: string;
  skills: { id: string; name: string }[];
  memory_size: number;
  brain: HeroBrain;
  boosters: Record<string, boolean>;
  permissions: "read" | "write";
  permissions_note: string;
  tools: HeroTool[];
  workflow: { name: string; description: string; steps: number; approvals: number };
  starter_tasks: { title: string; prompt: string }[];
  recruited: string[];
}
export interface HeroPlan {
  hero: string;
  lang: string;
  agent_name: string;
  brain: HeroBrain;
  permissions: "read" | "write";
  skills: { id: string; action: "install" | "reuse" }[];
  boosters: Record<string, boolean>;
  memory_nodes: number;
  workflow: string;
  tools_suggested: string[];
  tools_enabled: string[];
  network: false;
  xp: 0;
}
export interface RecruitResult {
  agent: Agent;
  hero: string;
  workflow: string | null;
  memory: { facts: number; concepts: number; concepts_created: number; episode: string; source: string };
  skills: { id: string; action: string }[];
  boosters: { on: string[]; off: string[] };
  confirmed: true;
}
export interface RemoveResult { ok: boolean; agent: string; hero: string; workflow: string | null; skills_removed: string[]; memory_removed: number }

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

export const heroesApi = {
  list: () => req<Hero[]>("GET", `/api/heroes?lang=${currentLocale()}`),
  plan: (id: string, name?: string) =>
    req<{ plan: HeroPlan; confirmed: false }>("POST", `/api/heroes/${encodeURIComponent(id)}/recruit`, { lang: currentLocale(), ...(name ? { name } : {}) }),
  recruit: (id: string, name?: string) =>
    req<RecruitResult>("POST", `/api/heroes/${encodeURIComponent(id)}/recruit`, { confirm: true, lang: currentLocale(), ...(name ? { name } : {}) }),
  remove: (slug: string, memory: boolean) =>
    req<RemoveResult>("DELETE", `/api/heroes/agents/${encodeURIComponent(slug)}?memory=${memory ? "true" : "false"}`),
  memory: (slug: string) =>
    req<{ slug: string; count: number; facts: { id: string; statement: string; source: string }[] }>("GET", `/api/heroes/agents/${encodeURIComponent(slug)}/memory`),
};

/** Beyin kimliği → okunur ad (bağlantı adları markadan bağımsız, ürün adlarıdır). */
export const BRAIN_LABEL: Record<BrainKind, string> = {
  hermes: "Hermes", codex: "Codex", claude: "Claude Code", openai_compat: "API", ollama: "Ollama",
};
