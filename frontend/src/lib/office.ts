// Ekip S3: /api/office türleri, istemcisi ve küçük ofis deposu ( "S3 — /api/office")
import { create } from "zustand";
import { currentLocale } from "./i18n";
import type { Avatar } from "./types";
import { bodyText } from "./api";

export interface TeamInfo {
  slug: string;
  name: string;
  mission: string;
  color: string;
  icon: string;
  lead: string | null;
  order: number;
  template?: string | null;
  created_at?: string;
  members: string[];
}

export interface OfficeMember {
  slug: string;
  name: string;
  title: string | null;
  team: string | null;
  reports_to: string | null;
  avatar: Partial<Avatar>;
  color: string;
  role?: string;
  hidden?: boolean;
  created_by?: string;
}

export interface TemplateTeam { key: string; name: string; mission: string; color: string; icon: string; lead: string | null }
export interface TemplateRole {
  key: string;
  name: string;
  title: string;
  team: string;
  reports_to: string | null;
  color: string;
  role: string;
  persona: string;
  skills_hint: string[];
  toolsets_hint: string[];
  avatar: Partial<Avatar>;
  permissions?: "read" | "write";
}
export interface OfficeTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  teams: TemplateTeam[];
  roles: TemplateRole[];
  workflow: string;
  workflow_name?: string;
  workflow_description?: string;
  workflow_steps?: { id: string; type: "agent" | "approval" | "delegate"; title: string; agent?: string | null; role?: string | null; depends_on: string[] }[];
}

export interface OfficeOverview { teams: TeamInfo[]; members: OfficeMember[]; templates: OfficeTemplate[] }

export type Brain = "codex" | "ollama" | "claude" | "profile";
export interface InstantiateRequest {
  brain: Brain;
  runtime?: "hermes" | "direct";
  hermes_profile?: string;
  model?: string;
  prefix?: string;
}
export interface InstantiateResult {
  template: string;
  prefix: string;
  message: string;
  brain: { brain: Brain; runtime: "hermes" | "direct"; hermes_profile: string | null; model: string | null };
  teams: { created: string[]; skipped: string[] };
  agents: { created: string[]; skipped: string[] };
  workflow: { slug: string; name: string; created: boolean; skipped: boolean };
}

export interface TeamPatch { name?: string; mission?: string; color?: string; icon?: string; order?: number; lead?: string | null }
export interface MemberPatch { team?: string | null; title?: string | null; reports_to?: string | null }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    // X-Studio-Lang: şablon adları/unvanları ve hata iletileri istek dilinde gelir (Faz 5 i18n)
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

export const officeApi = {
  overview: () => req<OfficeOverview>("GET", "/api/office"),
  templates: () => req<OfficeTemplate[]>("GET", "/api/office/templates"),
  instantiate: (id: string, data: InstantiateRequest) =>
    req<InstantiateResult>("POST", `/api/office/templates/${encodeURIComponent(id)}/instantiate`, data),
  teams: () => req<TeamInfo[]>("GET", "/api/office/teams"),
  createTeam: (data: { name: string; mission?: string; color?: string; icon?: string; lead?: string | null }) =>
    req<TeamInfo>("POST", "/api/office/teams", data),
  updateTeam: (slug: string, data: TeamPatch) => req<TeamInfo>("PATCH", `/api/office/teams/${encodeURIComponent(slug)}`, data),
  deleteTeam: (slug: string) => req<{ ok: boolean; released: string[] }>("DELETE", `/api/office/teams/${encodeURIComponent(slug)}`),
  assign: (slug: string, data: MemberPatch) => req<Record<string, unknown>>("PATCH", `/api/office/members/${encodeURIComponent(slug)}`, data),
};

// ---------------------------------------------------------------- paylaşılan depo (Ofis sayfası + dünya)
interface OfficeStore {
  teams: TeamInfo[];
  templates: OfficeTemplate[];
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useOffice = create<OfficeStore>((set) => ({
  teams: [],
  templates: [],
  loaded: false,
  error: null,
  refresh: () => {
    if (inflight) return inflight;
    inflight = officeApi.overview()
      .then((ov) => set({ teams: ov.teams, templates: ov.templates, loaded: true, error: null }))
      .catch((e: unknown) => set({ loaded: true, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => { inflight = null; });
    return inflight;
  },
}));

// ---------------------------------------------------------------- yardımcılar
export const TEAM_COLORS = ["#7C5CFF", "#3B82F6", "#EF4444", "#F59E0B", "#10B981", "#EC4899", "#14B8A6", "#64748B"];

/** Ekip bilinmiyorsa slug'dan kararlı bir renk üretir. */
export function teamColor(slug: string | null | undefined, teams: TeamInfo[]): string {
  if (!slug) return "#94A3B8";
  const t = teams.find((x) => x.slug === slug);
  if (t?.color) return t.color;
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_COLORS[h % TEAM_COLORS.length];
}

/** Renkli zemin üzerinde okunaklı yazı rengi (WCAG göreli parlaklık). */
export function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#1E1B2E";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // beyaz (L=1) ve koyu mürekkep (#1E1B2E, L≈0.012) için kontrastı karşılaştır
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.062) ? "#FFFFFF" : "#1E1B2E";
}

const SHORT: Record<string, string> = {
  "product owner": "PO",
  "teknik lider": "Tek. Lider",
  "backend geliştirici": "Backend",
  "frontend geliştirici": "Frontend",
  "qa mühendisi": "QA",
  "ui/ux tasarımcı": "UI/UX",
  "araştırma direktörü": "Direktör",
  "sosyal medya editörü": "Sosyal Medya",
  "içerik stratejisti": "Strateji",
};

/** Dünya etiketleri için kısa unvan: "Product Owner" → "PO". */
export function shortTitle(title?: string | null): string {
  if (!title) return "";
  const t = title.trim();
  const known = SHORT[t.toLocaleLowerCase("tr")];
  if (known) return known;
  if (t.length <= 14) return t;
  const words = t.split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.map((w) => w[0]!.toLocaleUpperCase("tr")).join("") : `${t.slice(0, 12)}…`;
}

/** Ajan slug'ı önizlemesi (backend slugify ile aynı kurallar). */
export function slugifyTr(text: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u" };
  return text.replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c] ?? c).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function prefixSlug(prefix: string): string {
  return slugifyTr(prefix).slice(0, 16).replace(/^-+|-+$/g, "");
}
