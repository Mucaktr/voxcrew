// Ekip S1: /api/hermes türleri ve istemcisi. lib/api.ts'ye dokunmaz.
import { hermesMsg } from "../locales/hermes";
import type { ChangePlan } from "./changes";
import { currentLocale, fmtNumber, intlTag, tx } from "./i18n";
import { bodyText } from "./api";

export type SkillSource = "bundled" | "hub" | "agent" | "local" | "external";
export type SkillState = "active" | "stale" | "archived";

export interface AgentRef { slug: string; name: string; color?: string }

export interface SkillInfo {
  name: string;
  load_name: string;
  profile: string;
  rel_path: string;
  path: string;
  description: string;
  category: string | null;
  source: SkillSource;
  trust: string | null;
  version: string | null;
  author: string | null;
  license: string | null;
  tags: string[];
  related: string[];
  platforms: string[];
  platform_ok: boolean;
  environments: string[];
  env_ok: boolean;
  requires_toolsets: string[];
  missing_toolsets: string[];
  required_env: string[];
  disabled: boolean;
  state: SkillState;
  pinned: boolean;
  use_count: number;
  last_used_at?: string | null;
  size_chars: number;
  tokens: number;
  body_chars: number;
  updated_at: string | null;
  loadable: boolean;
  listed: boolean;
  duplicate: boolean;
  agents?: AgentRef[];
  reason?: string | null;
}

export interface SkillDetail extends SkillInfo {
  content: string;
  body: string;
  truncated: boolean;
  frontmatter: Record<string, unknown>;
  files: string[];
}

export interface ToolsetInfo {
  name: string;
  label: string;
  emoji: string | null;
  description: string;
  summary: string;
  tools: string[];
  default: boolean;
  api_default: boolean;
  profile_disabled: boolean;
  default_off: boolean;
  risky: boolean;
  config_only: boolean;
  kind: "toolset" | "mcp";
  platforms: string[];
  cli_allowed: boolean;
}

export interface HermesProfile {
  name: string;
  path: string;
  is_default: boolean;
  model: string;
  provider: string;
  base_url: string;
  reasoning_effort?: string | null;
  has_soul: boolean;
  soul_chars: number;
  soul_preview: string;
  skills: number;
  skills_total: number;
  toolsets_cli: string[];
  sessions: number | null;
  has_env: boolean;
  agents?: AgentRef[];
}

export interface HermesOverview {
  version: string | null;
  home: string;
  exists: boolean;
  registry: string | null;
  profiles: HermesProfile[];
  toolsets: ToolsetInfo[];
  reasoning_levels: string[];
  transports: string[];
}

export interface SoulInfo {
  profile: string;
  path: string;
  content: string;
  exists: boolean;
  updated_at: string | null;
  sha: string | null;
  chars: number;
  agents: { slug: string; name: string; color?: string }[];
}

export interface MemoryFile {
  path: string;
  content: string;
  exists: boolean;
  entries: string[];
  chars: number;
  limit: number;
  sha: string | null;
  updated_at: string | null;
}

export interface MemoryInfo {
  profile: string;
  enabled: { memory: boolean; user: boolean };
  delimiter: string;
  memory: MemoryFile;
  user: MemoryFile;
}

export interface SessionInfo {
  id: string;
  title: string | null;
  source: string | null;
  model: string | null;
  started_at: string | null;
  updated_at: string | null;
  ended_at: string | null;
  messages: number | null;
  tool_calls: number | null;
  hidden: boolean;
  archived: boolean;
  parent_id: string | null;
  end_reason: string | null;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  state?: string | null;
  next_run?: string | null;
  last_run?: string | null;
  last_status?: string | null;
  prompt?: string;
  skills: string[];
  model?: string | null;
}

export type SoulPlan = ChangePlan & { profile: string; affected_agents: string[]; note: string };
export type MemoryPlan = ChangePlan & { profile: string; which: "memory" | "user"; chars: number; limit: number; note: string };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    // X-Studio-Lang: sunucu hata iletilerini bu dilde üretir (S19 i18n)
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

const q = (params: Record<string, string | number | boolean | undefined>) => {
  const s = Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return s ? `?${s}` : "";
};

export const hermesApi = {
  overview: () => call<HermesOverview>("GET", "/api/hermes/overview"),
  profiles: () => call<HermesProfile[]>("GET", "/api/hermes/profiles"),
  skills: (profile = "default", query = "") => call<SkillInfo[]>("GET", `/api/hermes/skills${q({ profile, q: query })}`),
  skill: (name: string, profile = "default") =>
    call<SkillDetail>("GET", `/api/hermes/skills/${name.split("/").map(encodeURIComponent).join("/")}${q({ profile })}`),
  toolsets: (profile = "default") => call<ToolsetInfo[]>("GET", `/api/hermes/toolsets${q({ profile })}`),
  soul: (profile: string) => call<SoulInfo>("GET", `/api/hermes/profiles/${encodeURIComponent(profile)}/soul`),
  planSoul: (profile: string, content: string, base_sha: string | null) =>
    call<SoulPlan>("PUT", `/api/hermes/profiles/${encodeURIComponent(profile)}/soul`, { content, base_sha, confirm: true }),
  memory: (profile: string) => call<MemoryInfo>("GET", `/api/hermes/profiles/${encodeURIComponent(profile)}/memory`),
  planMemory: (profile: string, which: "memory" | "user", entries: string[], base_sha: string | null) =>
    call<MemoryPlan>("PUT", `/api/hermes/profiles/${encodeURIComponent(profile)}/memory`, { which, entries, base_sha, confirm: true }),
  sessions: (profile: string, limit = 50) =>
    call<SessionInfo[]>("GET", `/api/hermes/profiles/${encodeURIComponent(profile)}/sessions${q({ limit })}`),
  cron: (profile: string) => call<CronJob[]>("GET", `/api/hermes/profiles/${encodeURIComponent(profile)}/cron`),
  createProfile: (name: string, clone_from: string) =>
    call<{ ok: boolean; name: string; clone_from: string; output: string; argv: string[] }>(
      "POST", "/api/hermes/profiles", { name, clone_from, confirm: true }),
};

// ------------------------------------------------------------------ ortak sabitler ve yardımcılar
export const MEMORY_DELIM = "\n§\n";
export const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Etiket sözlüğü: her okuma şu anki dilde (getter); modül düzeyinde sabit metin üretmez. */
function labelMap<K extends string>(keys: readonly K[], key: (k: K) => keyof typeof hermesMsg.tr): Record<K, string> {
  return Object.defineProperties({} as Record<K, string>, Object.fromEntries(
    keys.map((k) => [k, { enumerable: true, get: () => tx(hermesMsg, key(k)) }]),
  )) as Record<K, string>;
}

export const REASONING_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
export const REASONING_LABELS: Record<string, string> = labelMap(REASONING_ORDER, (k) => `reason_${k}` as keyof typeof hermesMsg.tr);

export const SOURCE_LABELS: Record<SkillSource, string> = labelMap(
  ["bundled", "hub", "agent", "local", "external"] as const, (k) => `src_${k}` as const);

export const STATE_LABELS: Record<SkillState, string> = labelMap(
  ["active", "stale", "archived"] as const, (k) => `state_${k}` as const);

const CATEGORY_KEYS = [
  "autonomous-ai-agents", "creative", "devops", "email", "media", "note-taking", "productivity", "research", "social-media",
  "software-development", "web", "apple", "mlops", "gaming", "data-science", "desktop", "github", "leisure", "smart-home",
] as const;
export const CATEGORY_LABELS: Record<string, string> = labelMap(CATEGORY_KEYS, (k) => `cat_${k}` as const);

const TOOLSET_KEYS = [
  "web", "search", "browser", "terminal", "file", "code_execution", "vision", "video", "image_gen", "video_gen", "x_search",
  "tts", "stt", "skills", "todo", "kanban", "memory", "context_engine", "session_search", "connections", "clarify",
  "delegation", "cronjob", "computer_use", "discord", "discord_admin", "yuanbao",
] as const;
/** Araç seti kısa açıklamaları (ad tarihsel: artık şu anki dilde döner). */
export const TOOLSET_TR: Record<string, string> = labelMap(TOOLSET_KEYS, (k) => `ts_${k}` as const);

/** Türkçe duyarlı, büyük/küçük harf duyarsız arama anahtarı (İ/i ve I/ı eşleşir).
 *  Arayüz biçimlendirmesi değil: yalnızca arama eşleştirmesi için Türkçe harf katlaması ("tr" yerel ayarı bilinçli). */
export function fold(s: string | null | undefined): string {
  return (s ?? "").replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr").replace(/ı/g, "i");
}

export function categoryLabel(c: string | null | undefined): string {
  if (!c) return tx(hermesMsg, "uncategorized");
  return CATEGORY_LABELS[c] ?? c.replace(/-/g, " ").replace(/^./, (x) => x.toLocaleUpperCase(intlTag()));
}

export function tokensLabel(n: number): string {
  return n >= 1000
    ? tx(hermesMsg, "tokens_k", { n: fmtNumber(n / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
    : tx(hermesMsg, "tokens", { n });
}

export function joinMemory(entries: string[]): string {
  return entries.map((e) => e.trim()).filter(Boolean).join(MEMORY_DELIM);
}

/** Ajan için CLI'ye gerçekte gidecek taşıma (ARCH: auto → skill/araç seti varsa CLI). */
export function effectiveTransport(t: string | null | undefined, hasCaps: boolean): "cli" | "api" | "auto" {
  if (t === "cli" || t === "api") return t;
  return hasCaps ? "cli" : "auto";
}
