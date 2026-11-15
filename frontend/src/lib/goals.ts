// Ekip S10 (Hedefler): türler, istemci, toplu metin ayrıştırıcı ve canlı depo
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { goalsMsg } from "../locales/goals";
import { bodyText, IDEMPOTENCY_HEADER, idempotencyKey } from "./api";
import { currentLocale, fmtDate, tx } from "./i18n";
import { registerEventHandler } from "./store";

type GoalKey = keyof typeof goalsMsg.tr;
/** Dil duyarlı etiket tablosu: `{ label, ... }` alanları getter'dır; `META[x].label` kullanımı korunur. */
function i18nMeta<K extends string, E extends Record<string, unknown>>(keys: readonly K[], labelKey: (k: K) => GoalKey,
  extra: (k: K) => E, groupKey?: (k: K) => GoalKey): Record<K, E & { label: string; group: string }> {
  return Object.fromEntries(keys.map((k) => [k, Object.defineProperties({ ...extra(k) }, {
    label: { enumerable: true, get: () => tx(goalsMsg, labelKey(k)) },
    group: { enumerable: true, get: () => (groupKey ? tx(goalsMsg, groupKey(k)) : "") },
  })])) as Record<K, E & { label: string; group: string }>;
}

// ---------------------------------------------------------------- türler
export type GoalLevel = "company" | "team" | "agent";
export type GoalStatus = "draft" | "active" | "in_progress" | "done" | "blocked" | "cancelled";
export type GoalPriority = "low" | "medium" | "high" | "critical";

export interface KeyResult {
  id: string;
  title: string;
  target: number | null;
  current: number;
  unit: string | null;
  done: boolean;
  /** 0..1 (sunucu hesaplar) */
  progress: number;
}

export interface GoalRun {
  id: string;
  title?: string | null;
  kind?: string | null;
  status?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  root_agent?: string | null;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  level: GoalLevel;
  owner_team: string | null;
  owner_agent: string | null;
  parent: string | null;
  key_results: KeyResult[];
  status: GoalStatus;
  /** 0..1: KR ortalaması ya da alt hedef ortalaması */
  progress: number;
  due: string | null;
  priority: GoalPriority;
  created_at: string;
  completed_at: string | null;
  updated_at?: string | null;
  /** "Başlat" için varsayılan kök ajan (sahip ekibin lideri ya da sahip ajan); yoksa null */
  default_root: string | null;
  runs?: GoalRun[];
  children?: Goal[];
  ancestors?: { id: string; title: string; level: GoalLevel }[];
}

export interface KeyResultInput { id?: string; title: string; target?: number | null; current?: number; unit?: string | null; done?: boolean }

export interface GoalInput {
  title?: string;
  description?: string | null;
  level?: GoalLevel;
  owner_team?: string | null;
  owner_agent?: string | null;
  parent?: string | null;
  key_results?: (string | KeyResultInput)[];
  status?: GoalStatus;
  due?: string | null;
  priority?: GoalPriority;
  progress?: number;
}

export interface LaunchOptions {
  depth: number;
  max_subtasks: number;
  allow_hiring: boolean;
  hiring_approval: "ask" | "auto";
  hire_budget: number;
}
export const LAUNCH_DEFAULTS: LaunchOptions = { depth: 2, max_subtasks: 6, allow_hiring: true, hiring_approval: "ask", hire_budget: 2 };

export interface BulkRequest {
  text?: string;
  items?: unknown[];
  level?: GoalLevel;
  owner_team?: string | null;
  owner_agent?: string | null;
  parent?: string | null;
  dry_run?: boolean;
}
export interface BulkResult { count: number; created: string[]; goals: Goal[] }
export interface LaunchResult { run_id: string; root_agent: string; options: LaunchOptions; goal: Goal }

/** Satır (toplu metin) ya da yol (items[]) bazlı hata. */
export interface LineError { line?: number; path?: string; message: string }

// ---------------------------------------------------------------- istemci
export class GoalApiError extends Error {
  status: number;
  errors: LineError[];
  constructor(status: number, message: string, errors: LineError[] = []) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

async function req<T>(method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method,
    // X-Studio-Lang: sunucu hata iletilerini istek dilinde döner (Faz 5 i18n)
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(extraHeaders ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = bodyText(res.status, null);
    let errors: LineError[] = [];
    try {
      const j = await res.json();
      const d = j?.detail;
      if (typeof d === "string") msg = d;
      else if (d && typeof d === "object" && typeof d.message === "string") {
        msg = d.message;
        errors = Array.isArray(d.errors) ? d.errors : [];
      } else if (d) msg = bodyText(res.status, j);  // asla ham JSON
    } catch { /* gövde yok */ }
    throw new GoalApiError(res.status, msg, errors);
  }
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;

export const goalsApi = {
  list: (filter: { level?: GoalLevel; owner?: string } = {}) => {
    const q = new URLSearchParams();
    if (filter.level) q.set("level", filter.level);
    if (filter.owner) q.set("owner", filter.owner);
    const qs = q.toString();
    return req<Goal[]>("GET", `/api/goals${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => req<Goal>("GET", `/api/goals/${enc(id)}`),
  create: (data: GoalInput) => req<Goal>("POST", "/api/goals", data),
  bulk: (data: BulkRequest) => req<BulkResult>("POST", "/api/goals/bulk", data),
  update: (id: string, data: GoalInput) => req<Goal>("PATCH", `/api/goals/${enc(id)}`, data),
  remove: (id: string) => req<{ ok: boolean; id: string; parent: string | null; reparented: string[] }>("DELETE", `/api/goals/${enc(id)}`),
  launch: (id: string, data: { root_agent?: string; options?: Partial<LaunchOptions>; title?: string } = {}) =>
    // çift tıklama aynı anahtarı taşır → sunucu ikinci koşuyu açmaz
    req<LaunchResult>("POST", `/api/goals/${enc(id)}/launch`, data,
      { [IDEMPOTENCY_HEADER]: idempotencyKey(`goal:${id}`, data) }),
  updateKr: (id: string, krId: string, data: { current?: number; done?: boolean; title?: string; target?: number | null; unit?: string | null }) =>
    req<Goal>("POST", `/api/goals/${enc(id)}/kr/${enc(krId)}`, data),
};

// ---------------------------------------------------------------- görünüm yardımcıları
export const LEVELS: GoalLevel[] = ["company", "team", "agent"];
export const LEVEL_META: Record<GoalLevel, { label: string; group: string }> =
  i18nMeta(LEVELS, (k) => `level_${k}` as GoalKey, () => ({}), (k) => `group_${k}` as GoalKey);
export const GOAL_STATUSES: GoalStatus[] = ["draft", "active", "in_progress", "blocked", "done", "cancelled"];
const STATUS_TONE: Record<GoalStatus, string> = { draft: "muted", active: "muted", in_progress: "info", done: "ok", blocked: "bad", cancelled: "muted" };
export const GOAL_STATUS_META: Record<GoalStatus, { label: string; tone: string }> =
  i18nMeta(GOAL_STATUSES, (k) => `status_${k}` as GoalKey, (k) => ({ tone: STATUS_TONE[k] }));
export const PRIORITIES: GoalPriority[] = ["low", "medium", "high", "critical"];
const PRIORITY_TONE: Record<GoalPriority, string> = { low: "muted", medium: "info", high: "warn", critical: "bad" };
export const PRIORITY_META: Record<GoalPriority, { label: string; tone: string }> =
  i18nMeta(PRIORITIES, (k) => `prio_${k}` as GoalKey, (k) => ({ tone: PRIORITY_TONE[k] }));

export const pct = (v: number | null | undefined) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 100);

function localDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Dil duyarlı kısa tarih (yalnızca gün; saat yok). */
export function formatDate(iso?: string | null): string {
  const d = iso ? localDate(iso) : null;
  return d ? fmtDate(d, { day: "numeric", month: "short", year: "numeric" }) : "";
}

/** Son tarih rozeti: gecikti (kırmızı), 7 gün içinde (sarı), uzak (gri). */
export function dueInfo(due: string | null | undefined, status?: GoalStatus):
  { label: string; tone: string; title: string; date: string } | null {
  const d = due ? localDate(due) : null;
  if (!d) return null;
  const date = formatDate(due);
  const out = (label: string, tone: string) => ({ label, tone, title: tx(goalsMsg, "due_title", { date }), date });
  if (status === "done" || status === "cancelled") return out(date, "muted");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return out(tx(goalsMsg, "due_late", { n: -days }), "bad");
  if (days === 0) return out(tx(goalsMsg, "due_today"), "warn");
  if (days <= 7) return out(tx(goalsMsg, "due_left", { n: days }), "warn");
  return out(date, "muted");
}

export function isOverdue(g: Pick<Goal, "due" | "status">): boolean {
  return dueInfo(g.due, g.status)?.tone === "bad";
}

export function walkGoals(goals: Goal[], fn: (g: Goal, depth: number) => void, depth = 0): void {
  for (const g of goals) {
    fn(g, depth);
    if (g.children?.length) walkGoals(g.children, fn, depth + 1);
  }
}

/** Ağacı derinlik bilgisiyle düz listeye çevirir (üst hedef seçicisi vb.). */
export function flattenGoals(goals: Goal[]): { goal: Goal; depth: number }[] {
  const out: { goal: Goal; depth: number }[] = [];
  walkGoals(goals, (goal, depth) => out.push({ goal, depth }));
  return out;
}

/** Sunucudaki `?level=&owner=` süzgeciyle aynı kural: elenen üst hedefin altındakiler en yakın uyan ataya bağlanır. */
export function filterTree(roots: Goal[], level: GoalLevel | "all", owner: string): Goal[] {
  if (level === "all" && !owner) return roots;
  const all = new Map<string, Goal>();
  walkGoals(roots, (g) => all.set(g.id, g));
  const match = (g: Goal) => (level === "all" || g.level === level) && (!owner || g.owner_team === owner || g.owner_agent === owner);
  const picked = new Map<string, Goal>();
  for (const g of all.values()) if (match(g)) picked.set(g.id, { ...g, children: [] });
  const out: Goal[] = [];
  for (const id of [...picked.keys()].sort()) {
    const g = picked.get(id)!;
    let anc = g.parent;
    const seen = new Set<string>();
    while (anc && !picked.has(anc) && all.has(anc) && !seen.has(anc)) {
      seen.add(anc);
      anc = all.get(anc)!.parent;
    }
    if (anc && picked.has(anc) && anc !== id) picked.get(anc)!.children!.push(g);
    else out.push(g);
  }
  return out.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------- toplu metin ayrıştırıcı
// backend/studio/goals/parser.py ile birebir aynı kurallar (canlı önizleme; son söz sunucunundur).
export const MAX_GOALS = 200;
export const MAX_KRS = 20;
export const MAX_TITLE = 200;
const MAX_TEXT = 50_000;

const PRIORITY_ALIASES: Record<string, GoalPriority> = {
  "düşük": "low", dusuk: "low", low: "low",
  orta: "medium", normal: "medium", medium: "medium",
  "yüksek": "high", yuksek: "high", high: "high",
  kritik: "critical", acil: "critical", critical: "critical",
};

const BULLET = /^(?:[-*•]|\d{1,3}[.)])\s+/;
const KR_RE = /^KR\d{0,2}\s*:\s*/i;
const KR_TARGET = /^(.+?)\s*(?:=|→|->)\s*(%)?\s*(\d+(?:[.,]\d+)?)\s*(.*)$/;
const TOK_PRIORITY = /^!(\S+)$/;
const TOK_DUE = /^(?:son|due|bitiş|bitis):(\S+)$/i;
const TOK_AGENT = /^@([A-Za-z0-9_.-]+)$/;
const TOK_TEAM = /^#([A-Za-z][A-Za-z0-9_.-]*)$/;

export interface ParsedKr { title: string; target: number | null; unit: string | null; line: number }
export interface ParsedGoal {
  title: string;
  line: number;
  indent: number;
  priority: GoalPriority | null;
  due: string | null;
  owner_agent: string | null;
  owner_team: string | null;
  key_results: ParsedKr[];
  children: ParsedGoal[];
  /** resolveBulk doldurur (sahiplerden ya da üstten miras) */
  level?: GoalLevel;
}
export interface ParseResult { goals: ParsedGoal[]; errors: LineError[]; count: number; krCount: number }

export function normalizePriority(value: string): GoalPriority {
  const key = value.trim().replace(/İ/g, "i").toLowerCase();
  const p = PRIORITY_ALIASES[key];
  if (!p) throw new Error(tx(goalsMsg, "err_priority", { value }));
  return p;
}

function validDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (y < 1 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** `YYYY-MM-DD`, `GG.AA.YYYY`, `GG/AA/YYYY` → `YYYY-MM-DD`; geçersizse hata fırlatır. */
export function normalizeDue(value: string): string {
  const s = value.trim();
  let out: string | null = null;
  const tr = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (tr) out = validDate(Number(tr[3]), Number(tr[2]), Number(tr[1]));
  else if (iso) out = validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  if (!out) throw new Error(tx(goalsMsg, "err_date", { value: s }));
  return out;
}

function toNumber(text: string): number {
  return Number(text.replace(",", "."));
}

/** `Başlık = 3 adet` → {title, target, unit}; hedef değeri yoksa target=null. */
export function parseKr(text: string): { title: string; target: number | null; unit: string | null } {
  const t = text.trim();
  const m = KR_TARGET.exec(t);
  if (m && m[1].trim()) {
    const unit = m[2] ? "%" : (m[4] ?? "").trim() || null;
    return { title: m[1].trim(), target: toNumber(m[3]), unit };
  }
  return { title: t, target: null, unit: null };
}

function indentOf(raw: string): [number, string] {
  let n = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 4;
    else return [n, raw.slice(i)];
  }
  return [n, ""];
}

function splitTokens(text: string, line: number, agents: Set<string> | null, teams: Set<string> | null, errors: LineError[]) {
  const words = text.split(/\s+/).filter(Boolean);
  const meta: Pick<ParsedGoal, "priority" | "due" | "owner_agent" | "owner_team"> = { priority: null, due: null, owner_agent: null, owner_team: null };
  const seen = new Set<string>();
  while (words.length) {
    const w = words[words.length - 1];
    let m: RegExpExecArray | null;
    if ((m = TOK_PRIORITY.exec(w)) && !seen.has("priority")) {
      seen.add("priority");
      try { meta.priority = normalizePriority(m[1]); } catch (e) { errors.push({ line, message: (e as Error).message }); }
    } else if ((m = TOK_DUE.exec(w)) && !seen.has("due")) {
      seen.add("due");
      try { meta.due = normalizeDue(m[1]); } catch (e) { errors.push({ line, message: (e as Error).message }); }
    } else if ((m = TOK_AGENT.exec(w)) && !seen.has("agent")) {
      seen.add("agent");
      if (agents && !agents.has(m[1])) errors.push({ line, message: tx(goalsMsg, "err_agent", { name: m[1] }) });
      meta.owner_agent = m[1];
    } else if ((m = TOK_TEAM.exec(w)) && !seen.has("team")) {
      seen.add("team");
      if (teams && !teams.has(m[1])) errors.push({ line, message: tx(goalsMsg, "err_team", { name: m[1] }) });
      meta.owner_team = m[1];
    } else break;
    words.pop();
  }
  return { title: words.join(" "), meta };
}

/** Çok satırlı metni hedef ağacına çevirir (bkz. dosya başı ve parser.py). */
export function parseBulk(text: string, ctx: { agents?: Iterable<string>; teams?: Iterable<string> } = {}): ParseResult {
  const agents = ctx.agents ? new Set(ctx.agents) : null;
  const teams = ctx.teams ? new Set(ctx.teams) : null;
  const errors: LineError[] = [];
  const msg = (k: GoalKey, vars?: Record<string, string | number>) => tx(goalsMsg, k, vars);
  if (text.length > MAX_TEXT) return { goals: [], errors: [{ line: 0, message: msg("err_too_long", { n: MAX_TEXT }) }], count: 0, krCount: 0 };
  const roots: ParsedGoal[] = [];
  const stack: ParsedGoal[] = [];
  let count = 0;
  let krCount = 0;
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const no = i + 1;
    const raw = lines[i];
    if (!raw.trim()) continue;
    const [indent, rest] = indentOf(raw.replace(/\s+$/, ""));
    const body = rest.replace(BULLET, "").trim();
    if (!body) continue;
    const kr = KR_RE.exec(body);
    if (kr) {
      let owner: ParsedGoal | undefined;
      for (let j = stack.length - 1; j >= 0; j--) if (stack[j].indent < indent) { owner = stack[j]; break; }
      if (!owner) for (let j = stack.length - 1; j >= 0; j--) if (stack[j].indent <= indent) { owner = stack[j]; break; }
      const content = body.slice(kr[0].length).trim();
      if (!owner) errors.push({ line: no, message: msg("err_kr_no_goal") });
      else if (!content) errors.push({ line: no, message: msg("err_kr_empty") });
      else if (owner.key_results.length >= MAX_KRS) errors.push({ line: no, message: msg("err_kr_max", { n: MAX_KRS }) });
      else {
        const item = parseKr(content);
        if (item.title.length > MAX_TITLE) errors.push({ line: no, message: msg("err_kr_title_len", { n: MAX_TITLE }) });
        else if (item.target !== null && item.target <= 0) errors.push({ line: no, message: msg("err_kr_target") });
        else { owner.key_results.push({ ...item, line: no }); krCount++; }
      }
      continue;
    }
    const { title, meta } = splitTokens(body, no, agents, teams, errors);
    if (!title) { errors.push({ line: no, message: msg("err_title_empty") }); continue; }
    if (title.length > MAX_TITLE) { errors.push({ line: no, message: msg("err_title_len", { n: MAX_TITLE }) }); continue; }
    count++;
    if (count > MAX_GOALS) { errors.push({ line: no, message: msg("err_max_goals", { n: MAX_GOALS }) }); count--; break; }
    const goal: ParsedGoal = { title, line: no, indent, ...meta, key_results: [], children: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(goal);
    stack.push(goal);
  }
  if (!roots.length && !errors.length) errors.push({ line: 0, message: msg("err_no_goals") });
  return { goals: roots, errors, count, krCount };
}

/** Düzey ve sahipleri çözer (sunucudaki `_resolve_spec` ile aynı): etiket yoksa üstten miras, ajanın ekibi sahip ekip olur. */
export function resolveBulk(goals: ParsedGoal[], base: { level?: GoalLevel | null; owner_team?: string | null; owner_agent?: string | null },
  agentTeam: Record<string, string | null | undefined>, teams: Set<string>): LineError[] {
  const errors: LineError[] = [];
  const visit = (g: ParsedGoal, inh: { level?: GoalLevel | null; owner_team?: string | null; owner_agent?: string | null }) => {
    let owner_agent: string | null, owner_team: string | null, level: GoalLevel | null;
    if (g.owner_agent || g.owner_team) {
      owner_agent = g.owner_agent; owner_team = g.owner_team; level = null;
    } else {
      owner_agent = inh.owner_agent ?? null; owner_team = inh.owner_team ?? null; level = inh.level ?? null;
    }
    if (owner_agent && !owner_team) {
      const t = agentTeam[owner_agent];
      owner_team = t && teams.has(t) ? t : null;
    }
    const lvl: GoalLevel = level ?? (owner_agent ? "agent" : owner_team ? "team" : "company");
    if (lvl === "agent" && !owner_agent) errors.push({ line: g.line, message: tx(goalsMsg, "err_agent_owner") });
    if (lvl === "team" && !owner_team) errors.push({ line: g.line, message: tx(goalsMsg, "err_team_owner") });
    g.level = lvl;
    g.owner_agent = owner_agent;
    g.owner_team = owner_team;
    g.children.forEach((c) => visit(c, { level: lvl, owner_team, owner_agent }));
  };
  goals.forEach((g) => visit(g, base));
  return errors;
}

/** Toplu ekleme penceresindeki örnek metin; varsa gerçek bir ekip ve ajanla. */
export function sampleBulkText(team?: string | null, agent?: string | null): string {
  const s = (n: number) => tx(goalsMsg, `sample_${n}` as GoalKey);
  return [
    s(1), s(2), s(3),
    `${s(4)}${team ? ` #${team}` : ""}`,
    s(5),
    `${s(6)}${agent ? ` @${agent}` : ""}`,
    s(7), s(8), s(9), s(10), s(11),
  ].join("\n");
}

// ---------------------------------------------------------------- canlı depo
interface GoalsStore {
  goals: Goal[];
  loaded: boolean;
  error: string | null;
  /** her goal.* olayında artar; ayrıntı görünümleri yeniden yüklemek için izler */
  version: number;
  refresh: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useGoals = create<GoalsStore>((set) => ({
  goals: [],
  loaded: false,
  error: null,
  version: 0,
  refresh: () => {
    if (inflight) return inflight;
    inflight = goalsApi.list()
      .then((goals) => set({ goals, loaded: true, error: null }))
      .catch((e: unknown) => set({ loaded: true, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => { inflight = null; });
    return inflight;
  },
}));

let timer: ReturnType<typeof setTimeout> | null = null;
const offGoalEvents = registerEventHandler("goal.", () => {
  useGoals.setState((s) => ({ version: s.version + 1 }));
  if (!useGoals.getState().loaded) return; // kimse görüntülemiyorsa ağaç yüklenmez
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void useGoals.getState().refresh(); }, 250);
});
if (import.meta.hot) import.meta.hot.dispose(() => offGoalEvents());

/** Sürmekte olan hedefi bulunan ekipler (dünyada ekip bölgesine bayrak için; S7 kullanabilir). */
export function useActiveGoalTeams(): string[] {
  const goals = useGoals((s) => s.goals);
  const loaded = useGoals((s) => s.loaded);
  useEffect(() => { if (!loaded) void useGoals.getState().refresh(); }, [loaded]);
  return useMemo(() => {
    const teams = new Set<string>();
    walkGoals(goals, (g) => { if (g.status === "in_progress" && g.owner_team) teams.add(g.owner_team); });
    return [...teams].sort();
  }, [goals]);
}
