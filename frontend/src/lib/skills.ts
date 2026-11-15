// Faz 5 — Ekip S14: /api/skills türleri, istemci ve küçük depo ( "S14 Skill'ler").
// Kütüphane kimliği (`id`): vox:<id> · hermes:<yükleme adı> · claude:<kapsam>/<klasör>.
// Atama anahtarı (`key`): agents.skills içinde saklanan ad (VoxCrew → id, Hermes → -s adı, Claude → claude:<ad>).
import { create } from "zustand";
import { currentLocale } from "./i18n";
import { registerEventHandler } from "./store";
import { bodyText } from "./api";

export type SkillSource = "voxcrew" | "hermes" | "claude";
export type SkillHow = "hermes_flag" | "prompt" | "missing";
export type AssignMode = "add" | "remove" | "set";

export interface SkillUser { slug: string; name: string; color?: string; runtime?: string; how: SkillHow; hidden?: boolean }

export interface SkillEntry {
  id: string;
  key: string;
  source: SkillSource;
  readonly: boolean;
  name: string;
  description: string;
  version: string | null;
  author: string | null;
  license: string | null;
  tags: string[];
  category: string | null;
  permissions: string[];
  size_chars: number;
  body_chars: number;
  tokens: number;
  updated_at: string | null;
  files_count: number | null;
  has_scripts: boolean | null;
  loadable: boolean;
  reason: string | null;
  /** yalnızca hermes */
  profile?: string;
  profiles?: string[];
  trust?: string | null;
  state?: string;
  /** yalnızca claude */
  scope?: "user" | "project";
  agents?: SkillUser[];
}

export interface SkillManifest {
  format: string;
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  tags: string[];
  description: string;
  permissions: string[];
  source: { kind: string; ref: string };
}

export interface SkillDetail extends SkillEntry {
  path?: string;
  dir?: string;
  content: string;
  body: string;
  truncated: boolean;
  frontmatter: Record<string, unknown>;
  files: string[];
  scripts: string[];
  manifest: SkillManifest;
  agents: SkillUser[];
}

export interface SkillList { items: SkillEntry[]; total: number; offset: number; limit: number }

export interface SkillSources {
  counts: Record<SkillSource, number>;
  total: number;
  roots: { voxcrew: string; claude: string[]; hermes: string };
  writable: SkillSource[];
  inject: boolean;
  max_chars: number;
  permissions: string[];
  tags: { tag: string; count: number }[];
}

// ---- G1-D: sabitleme (sürüm + kip + onay)
export type BindMode = "catalog" | "always" | "never";
/** legacy: kayıt etkin değil · ok · pending: onaylı sürüm yok · off: never · blocked: kopya sha ile uyuşmuyor */
export type PinState = "legacy" | "ok" | "pending" | "off" | "blocked";

export interface SkillPin {
  mode: BindMode;
  sha: string | null;
  status: PinState;
  origin: string | null;
  reason: string | null;
  live_sha: string | null;
  latest_sha: string | null;
  versions: number;
  update_available: boolean;
  tokens?: { catalog: number; body: number };
}

export interface ImportFinding { file: string; patterns: string[] }

export interface ImportPlanPreview {
  plan_id: string;
  expires_in_s: number;
  id: string;
  key: string;
  source: SkillSource;
  name: string | null;
  description: string | null;
  version: string | null;
  tags: string[];
  sha: string;
  previous_sha: string | null;
  already_approved: boolean;
  files: string[];
  other_files: string[];
  has_scripts: boolean;
  findings: ImportFinding[];
  risk: "none" | "high";
  tokens: { catalog: number; body: number; previous_body?: number };
  diff: string[];
  agents: string[];
  readonly_source: boolean;
}

export interface ImportConfirmResult { ok: boolean; key: string; id: string; sha: string; findings: ImportFinding[]; rebound: string[]; skipped: string[] }

export interface BindResult { agent: string; key: string; binding: { sha: string | null; mode: BindMode; bound_at: number; origin: string }; pin: SkillPin | null }

export interface AgentSkillItem {
  key: string;
  how: SkillHow;
  entry: SkillEntry | null;
  in_prompt: boolean;
  truncated: boolean;
  /** G1-D: yalnız istemle giden atamalarda */
  pin?: SkillPin | null;
}

export interface AgentSkillView {
  slug: string;
  runtime: "hermes" | "direct";
  connection: string;
  profile: string | null;
  items: AgentSkillItem[];
  /** G1-D: bağlama kaydı etkin mi (göç yapıldı) */
  pinning?: boolean;
  budget: {
    max_chars: number; chars: number; injected: string[]; truncated: string[]; omitted: string[];
    via_flags: string[]; missing: string[]; inject: boolean;
    blocked?: string[]; pending?: string[]; disabled?: string[]; catalog_only?: string[];
    tokens?: { catalog: number; bodies: number };
  };
}

export interface AssignResult {
  mode: AssignMode;
  skills: string[];
  ok: number;
  failed: number;
  results: { agent: string; ok: boolean; error?: string; skills?: string[]; changed?: boolean }[];
}

export interface SkillDraft {
  id?: string;
  name?: string;
  description?: string;
  body?: string;
  content?: string;
  tags?: string[];
  version?: string | null;
  author?: string | null;
  license?: string | null;
  category?: string | null;
  permissions?: string[];
}

async function req<T>(method: string, url: string, body?: unknown, raw?: { data: BodyInit; type: string }): Promise<T> {
  const headers: Record<string, string> = { "X-Studio-Lang": currentLocale() };
  if (raw) headers["Content-Type"] = raw.type;
  else if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: raw ? raw.data : body !== undefined ? JSON.stringify(body) : undefined });
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

const q = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return s ? `?${s}` : "";
};

/** Kimlikteki `/` korunur (rota `{id:path}`); diğer karakterler kodlanır. */
export const encodeSkillId = (id: string) => id.split("/").map(encodeURIComponent).join("/");

export const skillsApi = {
  list: (params: { source?: SkillSource | ""; q?: string; tag?: string; agent?: string; limit?: number; offset?: number } = {}) =>
    req<SkillList>("GET", `/api/skills${q(params)}`),
  sources: () => req<SkillSources>("GET", "/api/skills/sources"),
  get: (id: string) => req<SkillDetail>("GET", `/api/skills/${encodeSkillId(id)}`),
  create: (draft: SkillDraft) => req<SkillEntry>("POST", "/api/skills", draft),
  update: (id: string, draft: SkillDraft) => req<SkillEntry>("PUT", `/api/skills/${encodeSkillId(id)}`, draft),
  remove: (id: string) => req<{ ok: boolean; id: string; unassigned: string[] }>("DELETE", `/api/skills/${encodeSkillId(id)}`),
  copy: (id: string, newId?: string) => req<SkillEntry>("POST", `/api/skills/${encodeSkillId(id)}/copy`, newId ? { id: newId } : {}),
  importPaste: (content: string, id?: string) => req<SkillEntry>("POST", "/api/skills/import", { kind: "paste", content, id: id || undefined }),
  importFolder: (path: string, id?: string) => req<SkillEntry>("POST", "/api/skills/import", { kind: "folder", path, id: id || undefined }),
  importZip: (file: Blob, id?: string) =>
    req<SkillEntry>("POST", `/api/skills/import/zip${q({ id })}`, undefined, { data: file, type: "application/zip" }),
  assign: (agents: string[], skills: string[], mode: AssignMode = "add") =>
    req<AssignResult>("POST", "/api/skills/assign", { agents, skills, mode }),
  agent: (slug: string) => req<AgentSkillView>("GET", `/api/skills/agents/${encodeURIComponent(slug)}`),
  // G1-D: önizleme herkese açık; onay ve bağlama yalnız kullanıcı (sunucu USER_ONLY_RE, MCP 403)
  importPlan: (id: string) => req<ImportPlanPreview>("POST", "/api/skills/import/plan", { id }),
  importConfirm: (body: { plan_id: string; confirm: true; accept_risk?: boolean; agents?: string[]; mode?: BindMode }) =>
    req<ImportConfirmResult>("POST", "/api/skills/import/confirm", body),
  bind: (body: { agent: string; key: string; mode?: BindMode; sha?: string; latest?: boolean }) =>
    req<BindResult>("POST", "/api/skills/bind", body),
};

export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 10) : "—");

// ------------------------------------------------------------------ depo
interface SkillsStore {
  items: SkillEntry[];
  sources: SkillSources | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** Kütüphaneyi ve kaynak özetini yeniden okur. */
  refresh: () => Promise<void>;
  /** Tek bir girdiyi listede günceller ya da ekler (oluştur/düzenle sonrası). */
  upsert: (entry: SkillEntry) => void;
  drop: (id: string) => void;
}

const EMPTY_ITEMS: SkillEntry[] = [];

export const useSkills = create<SkillsStore>((set, get) => ({
  items: EMPTY_ITEMS,
  sources: null,
  loaded: false,
  loading: false,
  error: null,
  refresh: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const [list, sources] = await Promise.all([skillsApi.list({ limit: 5000 }), skillsApi.sources()]);
      set({ items: list.items, sources, loaded: true, loading: false, error: null });
    } catch (e) {
      set({ loading: false, loaded: true, error: e instanceof Error ? e.message : String(e) });
    }
  },
  upsert: (entry) => set((s) => ({
    items: s.items.some((x) => x.id === entry.id) ? s.items.map((x) => (x.id === entry.id ? { ...x, ...entry } : x)) : [...s.items, entry],
  })),
  drop: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}));

let wired = false;
/** Olay bağlantısı: skills.* ve agent.updated olaylarında liste tazelenir (bir kez bağlanır). */
export function wireSkillsEvents() {
  if (wired) return;
  wired = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const bump = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void useSkills.getState().refresh(); }, 400);
  };
  registerEventHandler("skills.", bump);
  registerEventHandler("agent.updated", bump);
  registerEventHandler("agent.removed", bump);
}

// ------------------------------------------------------------------ yardımcılar
/** Türkçe duyarlı, büyük/küçük harf duyarsız arama anahtarı (İ/i ve I/ı eşleşir). */
export function foldText(s: string | null | undefined): string {
  return (s ?? "").replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr-TR").replace(/ı/g, "i");
}

export function matchesSkill(e: SkillEntry, needle: string): boolean {
  if (!needle) return true;
  return foldText(`${e.name} ${e.key} ${e.description} ${e.category ?? ""} ${e.tags.join(" ")}`).includes(needle);
}

/** Yaklaşık token: SKILL.md boyutu / 4 (Hermes keşfiyle aynı kestirim). */
export function approxTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

export const SKILL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function slugifySkill(text: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u" };
  return text.replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c] ?? c).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "";
}
