import { agentsMsg } from "../locales/agents";
import { moodOf } from "./format";
import { currentLocale, intlTag, tx } from "./i18n";
import type { Agent, AgentState, ConnectionInfo, Mood, Run } from "./types";

export function agentAvailability(a: Agent, conns: ConnectionInfo[]): { ok: boolean; reason?: string } {
  if (a.route_error) return { ok: false, reason: a.route_error };
  const r = a.route;
  if (!r) return { ok: false, reason: tx(agentsMsg, "no_brain") };
  const need: string[] = [];
  if (r.connector === "hermes") need.push("hermes");
  if (r.connection === "ollama") need.push("ollama");
  if (r.connector === "codex") need.push("codex");
  if (r.connection === "claude") need.push("claude");
  if (r.connection === "openai_compat") need.push("openai_compat"); // S39 (C-12): uç nokta kapalıysa "uygun" görünmesin
  for (const k of need) {
    const c = conns.find((x) => x.kind === k);
    if (c && !c.available) return { ok: false, reason: tx(agentsMsg, "conn_unreachable", { name: c.name }) };
  }
  return { ok: true };
}

export function agentMood(a: Agent, states: Record<string, AgentState>, conns: ConnectionInfo[]): Mood {
  const st = states[a.slug] ?? a.state;
  const busy = st && st.state !== "idle";
  return moodOf(st?.state, busy || agentAvailability(a, conns).ok);
}

// ---------------------------------------------------------------------------------------------
// S12 (Ajan profilleri): rütbe etiketleri ve ajan listesi / tam profil için saf yardımcılar.
// Hepsi saf fonksiyondur; zustand seçicisi olarak DEĞİL, useMemo içinde kullanılmalıdır.

export type Rank = NonNullable<Agent["rank"]>;

/** Yukarıdan aşağıya rütbe sırası.*/
export const RANKS: readonly Rank[] = ["ceo", "deputy", "director", "manager", "lead", "senior", "specialist", "analyst", "intern"];

/** Rütbe etiketleri; şu anki dilde (getter — Faz 5 i18n). `RANK_LABEL[r]` kullanımı korunur. */
export const RANK_LABEL = Object.defineProperties({} as Record<Rank, string>, Object.fromEntries(
  RANKS.map((k) => [k, { enumerable: true, get: () => tx(agentsMsg, `rank_${k}` as keyof typeof agentsMsg.tr) }]),
)) as Record<Rank, string>;

export function isRank(r: unknown): r is Rank {
  return typeof r === "string" && (RANKS as readonly string[]).includes(r);
}

/** Dil duyarlı rütbe etiketi; rütbesizse boş dize. */
export function rankLabel(r?: string | null): string {
  return isRank(r) ? RANK_LABEL[r] : "";
}

/** 0 = en üst (Genel Müdür). Rütbesiz ajanlar en sona sıralanır. */
export function rankIndex(r?: string | null): number {
  return isRank(r) ? RANKS.indexOf(r) : RANKS.length;
}

/** Rütbe rozeti tonu (ui.tsx Badge `tone`). */
export function rankTone(r?: string | null): "warn" | "info" | "ok" | "muted" {
  const i = rankIndex(r);
  if (i <= 1) return "warn";
  if (i <= 3) return "info";
  if (i <= 5) return "ok";
  return "muted";
}

/** Yönetici, astından düşük ya da aynı rütbedeyse true (ARCH: uyarı verilir, engellenmez). */
export function rankConflict(agentRank?: string | null, managerRank?: string | null): boolean {
  return isRank(agentRank) && isRank(managerRank) && rankIndex(managerRank) >= rankIndex(agentRank);
}

/** Dil duyarlı ad karşılaştırması (sıralamalar için). */
export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, intlTag());
}

/** Liste filtresi için kaba durum grubu. */
export type StatusGroup = "busy" | "idle" | "unavailable";

export function statusGroup(mood: Mood): StatusGroup {
  if (mood === "thinking" || mood === "working" || mood === "waiting") return "busy";
  if (mood === "error" || mood === "offline") return "unavailable";
  return "idle";
}

/** Ajanın kullandığı bağlantılar: Hermes üzerinden çalışıyorsa "hermes" + beyin bağlantısı. */
export function agentConnectionKinds(a: Agent): string[] {
  const out: string[] = [];
  if (a.runtime === "hermes" || a.route?.connector === "hermes") out.push("hermes");
  const c = a.route?.connection ?? a.connection;
  if (c && !out.includes(c)) out.push(c);
  return out;
}

/** Ajanın bir adımında yer aldığı koşular (runList sırası korunur: yeniden eskiye). */
export function agentRuns(runs: Run[], slug: string): Run[] {
  return runs.filter((r) => r.steps?.some((s) => s.agent === slug));
}

/** Ajanın organizasyondaki yeri: yöneticisi ve doğrudan astları (gizliler dahil, sıralı). */
export function orgOf(agents: Agent[], slug: string): { manager: Agent | null; reports: Agent[] } {
  const me = agents.find((a) => a.slug === slug);
  const manager = me?.reports_to ? agents.find((a) => a.slug === me.reports_to) ?? null : null;
  const reports = agents.filter((a) => a.reports_to === slug)
    .sort((x, y) => rankIndex(x.rank) - rankIndex(y.rank) || byName(x, y));
  return { manager, reports };
}

/** `slug`'ın yöneticisi `boss` olursa raporlama döngüsü oluşur mu? (sunucu da reddeder; seçenek baştan kapatılır) */
export function managerWouldCycle(agents: Agent[], slug: string, boss: string): boolean {
  const bySlug = new Map(agents.map((a) => [a.slug, a]));
  const seen = new Set<string>();
  let cur: string | null | undefined = boss;
  while (cur) {
    if (cur === slug || seen.has(cur)) return true;
    seen.add(cur);
    cur = bySlug.get(cur)?.reports_to;
  }
  return false;
}

/** Bir koşudaki bu ajana ait adımların özeti. */
export function agentStepStats(runs: Run[], slug: string): { runs: number; done: number; failed: number; last: string | null } {
  let done = 0, failed = 0;
  let last: string | null = null;
  const mine = agentRuns(runs, slug);
  for (const r of mine) {
    for (const s of r.steps) {
      if (s.agent !== slug) continue;
      if (s.status === "done") done++;
      else if (s.status === "failed") failed++;
      // koşu listesindeki adım özetlerinde zaman damgası olmayabilir; koşunun zamanına düş
      const t = s.finished_at ?? s.started_at ?? r.finished_at ?? r.started_at ?? null;
      if (t && (!last || Date.parse(t) > Date.parse(last))) last = t;
    }
  }
  return { runs: mine.length, done, failed, last };
}

// ---------------------------------------------------------------------------------------------
// S20 (100+ ajan): sunucu tarafı arama — /api/agents?q=&team=&limit=&offset= (S15 ekledi; parametresiz davranış aynı).

export interface AgentSearch { q?: string; team?: string; limit?: number; offset?: number; includeHidden?: boolean }
export interface AgentSearchResult { items: Agent[]; total: number }

/** Sunucuda süzülmüş ajan sayfası. Toplam sayı `X-Total-Count` başlığından okunur. */
export async function searchAgents(p: AgentSearch, signal?: AbortSignal): Promise<AgentSearchResult> {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.team) qs.set("team", p.team);
  if (p.limit != null) qs.set("limit", String(p.limit));
  if (p.offset) qs.set("offset", String(p.offset));
  if (p.includeHidden === false) qs.set("include_hidden", "false");
  const s = qs.toString();
  const res = await fetch(`/api/agents${s ? `?${s}` : ""}`, { headers: { "X-Studio-Lang": currentLocale() }, signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const items = (await res.json()) as Agent[];
  const total = Number(res.headers.get("X-Total-Count") ?? items.length) || items.length;
  return { items, total };
}
