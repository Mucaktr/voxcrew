// DASH-MVP Pano karar listesi ve canlı görev verisinin SAF modeli (içe aktarma yalnız tür; node testleri doğrudan
// okur: frontend/scripts/board_logic.test.mjs). Metin üretmez: tür, neden ve maliyet KODLARI döner, bileşen çevirir.
// Kaynaklar: karar özeti (asks + acceptances; full/data)  + useStudio koşu listesi (adım, ajan, bütçe,
// kullanım). Yeni onay yolu yok: her karar mevcut karar adımına derin bağlantıdır (K1 tek onay yolu).
// PANO-FIX: sıra sunucuda (`order=oldest`); bağlantı kararın kartına iner (`deep_link`); tür, araç ve komut
// sunucudan da gelir ki satır koşu ayrıntısı yüklenmeden doğru çizilsin; akış kapısı plan onayı sayılmaz ( `gate`).
import type { ResumeAsk, ResumeView } from "../../full/data";
import type { CostBasis, Run, StepRun } from "../../lib/types";

export type DecisionKind = "approval" | "step" | "budget" | "tool_approval" | "message" | "paused" | "acceptance";
/** Görevi durduran türler: listede önce, "Görev durdu" işareti ve sol dikkat çubuğu yalnız bunlarda. */
export const STOP_KINDS: readonly DecisionKind[] = ["approval", "step", "budget", "tool_approval"];
const GROUP: Record<DecisionKind, number> = { approval: 0, step: 0, budget: 0, tool_approval: 0, message: 1, paused: 2, acceptance: 3 };

export type WhyCode =
  | { key: "plan" | "gate" | "step" | "budget_plain" | "tool_plain" | "unknown" | "message" }
  | { key: "budget" | "budget_over"; metric: "cost_usd" | "tokens"; used: number; cap: number; pct: number }
  | { key: "tool"; tool: string }
  | { key: "accept"; status: "passed" | "failed" | "not_run" }
  | { key: "paused"; reason: "user" | "budget" | "approval" | "manifest" | "interrupted" | "other" };

export type CostCode =
  | { key: "sub" | "local" | "unknown" }
  | { key: "spent" | "est" | "mixed"; usd: number };

export interface Decision {
  key: string;
  kind: DecisionKind;
  stops: boolean;
  title: string;
  /** başlık bir komut (araç onayı): eşaralıklı yazılır */
  mono: boolean;
  /** istenen metin (başlık komut ya da adım adıysa önizlemede ayrıca gösterilir) */
  asked: string | null;
  runId: string | null;
  runTitle: string;
  stepId: string | null;
  stepTitle: string | null;
  /** 1 tabanlı adım sırası ve toplam (çok adımlı koşu) */
  stepIndex: number | null;
  stepCount: number | null;
  link: string;
  /** ms; bilinmiyorsa null (listede en sona) */
  since: number | null;
  agent: string | null;
  brain: string | null;
  why: WhyCode;
  cost: CostCode;
}

type RunLike = Pick<Run, "id" | "title" | "steps" | "budget" | "usage" | "status"> & { pause_reason?: string | null };
type StepLike = Pick<StepRun, "id" | "title" | "type" | "agent" | "status"> & {
  ask?: { kind?: string } | null;
  pending_approval?: { tool?: string; command?: string; description?: string } | null;
  route?: { label?: string; connector?: string; connection?: string } | null;
};

const ts = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Maliyet tabanı: sunucunun `usage.cost_basis`'i; henüz bilinmiyorsa (ilk tur bitmeden) adım rotalarından çıkarım —
 *  hepsi Ollama ise yerel, hepsi Claude Code / Codex oturumu ise abonelik. */
export function basisOf(run: Pick<RunLike, "usage"> & { steps?: readonly unknown[] } | null | undefined): CostBasis {
  const b = run?.usage?.cost_basis as CostBasis | undefined;
  if (b && b !== "unknown") return b;
  const routes = ((run?.steps ?? []) as StepLike[]).map((s) => s.route).filter((r): r is NonNullable<StepLike["route"]> => !!r);
  if (!routes.length) return "unknown";
  const kinds = new Set(routes.map((r) => (r.connection === "ollama" || r.connector === "ollama" ? "local"
    : r.connection === "claude" || r.connection === "codex" || r.connector === "codex" || r.connector === "claude" ? "subscription" : "other")));
  return kinds.size === 1 && kinds.has("local") ? "local" : kinds.size === 1 && kinds.has("subscription") ? "subscription" : "unknown";
}

/** Koşunun maliyet tabanı (asla yanıltıcı "$0": abonelik ve yerel ayrı yazılır). */
export function costOf(run: Pick<RunLike, "usage"> & { steps?: readonly unknown[] } | null | undefined): CostCode {
  const u = run?.usage;
  const basis = basisOf(run);
  if (basis === "subscription") return { key: "sub" };
  if (basis === "local") return { key: "local" };
  if (!u) return { key: "unknown" };
  const spent = u.spent?.cost_usd ?? u.cost_usd;
  if (spent == null) return { key: "unknown" };
  const usd = Number(spent) + (u.spent?.cost_usd == null ? Number(u.replayed?.cost_usd ?? 0) : 0);
  if (basis === "estimated") return { key: "est", usd };
  if (basis === "mixed") return { key: "mixed", usd };
  if (basis === "measured") return { key: "spent", usd };
  return { key: "unknown" };
}

/** Bütçe dolumu: önce dolar (yerel/abonelik değilse), yoksa jeton. Tavan yoksa null. */
export function budgetFill(run: Pick<RunLike, "budget" | "usage"> & { steps?: readonly unknown[] } | null | undefined):
  { metric: "cost_usd" | "tokens"; used: number; cap: number; pct: number } | null {
  const b = run?.budget;
  const u = run?.usage;
  if (!b) return null;
  const basis = basisOf(run);
  const free = basis === "local" || basis === "subscription";
  const pick = (metric: "cost_usd" | "tokens") => {
    const cap = b[metric];
    if (cap == null || !(Number(cap) > 0)) return null;
    const used = metric === "cost_usd"
      ? Number(u?.spent?.cost_usd ?? u?.cost_usd ?? 0)
      : Number(u?.spent?.tokens ?? u?.tokens ?? 0);
    return { metric, used, cap: Number(cap), pct: Math.round((used / Number(cap)) * 100) };
  };
  return (!free && pick("cost_usd")) || pick("tokens");
}

function findRun(runs: readonly RunLike[], id: string | null | undefined): RunLike | undefined {
  return id ? runs.find((r) => r.id === id) : undefined;
}

function lastAgent(run: RunLike | undefined): string | null {
  if (!run) return null;
  for (let i = run.steps.length - 1; i >= 0; i--) if (run.steps[i].agent) return run.steps[i].agent ?? null;
  return null;
}

/** Duraklatma nedeni kodu → okunur neden kodu (bilinmeyen kod gösterilmez). */
export function pauseReason(raw: string | null | undefined): "user" | "budget" | "approval" | "manifest" | "interrupted" | "other" {
  const r = (raw ?? "").trim();
  return r === "user" || r === "budget" || r === "approval" || r === "manifest" || r === "interrupted" ? r : "other";
}

function fromAsk(a: ResumeAsk, runs: readonly RunLike[]): Decision {
  const run = findRun(runs, a.run_id);
  const idx = run && a.step_id ? run.steps.findIndex((s) => s.id === a.step_id) : -1;
  const step = (idx >= 0 ? run!.steps[idx] : undefined) as StepLike | undefined;
  // adım onayı kartı (`<adım>.onay-1`) asıl adıma bağlıdır: ajan ve adım adı oradan
  const baseId = step?.ask && (step.ask as { step?: string }).step ? (step.ask as { step?: string }).step! : null;
  const base = (baseId && run ? run.steps.find((s) => s.id === baseId) : undefined) as StepLike | undefined;
  const target = base ?? step;
  const askKind = a.ask_kind ?? step?.ask?.kind ?? null;
  const stepKind = a.step_kind ?? (step as { kind?: string } | undefined)?.kind ?? null;
  let kind: DecisionKind;
  let why: WhyCode;
  let title = a.text || a.run_title;
  let mono = false;
  if (a.kind === "tool_approval") {
    kind = "tool_approval";
    const tool = a.tool ?? step?.pending_approval?.tool ?? null;
    why = tool ? { key: "tool", tool } : { key: "tool_plain" };
    const cmd = a.command ?? step?.pending_approval?.command;
    if (cmd) { title = cmd; mono = true; }
  } else if (a.kind === "approval") {
    if (askKind === "budget") {
      kind = "budget";
      const fill = budgetFill(run);
      why = fill ? { key: fill.pct >= 100 ? "budget_over" : "budget", ...fill } : { key: "budget_plain" };
    } else if (askKind === "step_approval") {
      kind = "step";
      why = { key: "step" };
      title = target?.title ? target.title : title;
    } else {
      kind = "approval";
      // "plan" yalnız gerçek plan onayında; akışın onay adımı bir kapıdır ("Akış bu adımda onayını istiyor")
      why = { key: stepKind === "plan_approval" || stepKind === "replan_gate" ? "plan"
        : step?.type === "approval" || a.step_id ? "gate" : "unknown" };
    }
  } else if (a.kind === "message") {
    kind = "message";
    why = { key: "message" };
  } else {
    kind = "paused";
    why = { key: "paused", reason: pauseReason(a.text) };
    title = a.run_title;
  }
  const order = run && target ? run.steps.findIndex((s) => s.id === target.id) : -1;
  const multi = !!run && order >= 0 && run.steps.filter((s) => !s.id.includes(".onay-")).length > 1;
  return {
    key: `${a.kind}:${a.run_id ?? ""}:${a.step_id ?? ""}:${a.link}`,
    kind, stops: STOP_KINDS.includes(kind), title: title || a.run_title, mono,
    asked: a.text && a.text !== (title || a.run_title) ? a.text : null,
    runId: a.run_id, runTitle: a.kind === "message" ? "" : a.run_title,
    stepId: a.step_id, stepTitle: target?.title ?? null,
    stepIndex: multi ? order + 1 : null,
    stepCount: multi ? run!.steps.filter((s) => !s.id.includes(".onay-")).length : null,
    link: a.deep_link ?? a.link, since: ts(a.since),
    agent: a.kind === "message" ? (a.run_title || null) : (target?.agent ?? (a.kind === "paused" ? lastAgent(run) : null)),
    brain: target?.route?.label ?? null,
    why, cost: costOf(run),
  };
}

/** Karar listesi: asks + kabuller; aynı koşunun "duraklatıldı" kaydı, o koşunun açık bir adım kararı varsa gösterilmez.
 *  Sıra: görevi durduranlar (en eski üstte) → sorular → duraklatılanlar → kabuller (en eski üstte). */
export function buildDecisions(view: ResumeView | null | undefined, runs: readonly RunLike[]): Decision[] {
  if (!view) return [];
  const asks = view.asks.items.map((a) => fromAsk(a, runs));
  const withStep = new Set(asks.filter((d) => d.kind !== "paused" && d.runId).map((d) => d.runId));
  const kept = asks.filter((d) => !(d.kind === "paused" && d.runId && withStep.has(d.runId)));
  const acc: Decision[] = view.acceptances.items.map((a) => {
    const run = findRun(runs, a.run_id);
    const status = a.verification_status === "passed" || a.verification_status === "failed" ? a.verification_status : "not_run";
    return {
      key: `acceptance:${a.id}`, kind: "acceptance", stops: false, title: a.title, mono: false, asked: null,
      runId: a.run_id, runTitle: run?.title ?? a.title, stepId: null, stepTitle: null, stepIndex: null, stepCount: null,
      link: a.deep_link ?? a.link, since: ts(a.created_at), agent: lastAgent(run), brain: null,
      why: { key: "accept", status }, cost: costOf(run),
    };
  });
  return orderDecisions([...kept, ...acc]);
}

export function orderDecisions(list: Decision[]): Decision[] {
  return [...list].sort((a, b) => {
    const g = GROUP[a.kind] - GROUP[b.kind];
    if (g) return g;
    const sa = a.since ?? Number.POSITIVE_INFINITY, sb = b.since ?? Number.POSITIVE_INFINITY;
    return sa === sb ? a.key.localeCompare(b.key) : sa - sb;
  });
}

/** en eski bekleyen kararın zamanı (ms) — sunucunun kırpılmamış kümeden verdiği `oldest` değerleri ve listede
 * gösterilenler; hiçbiri yoksa null. Özet cümlesi ve "Seni bekleyen" kutusu bunu kullanır.*/
export function decisionOldest(view: ResumeView | null | undefined, decisions: readonly Pick<Decision, "since">[]): number | null {
  const all = [ts(view?.asks.oldest), ts(view?.acceptances.oldest), ...decisions.map((d) => d.since)].filter((x): x is number => x != null);
  return all.length ? Math.min(...all) : null;
}

/** Toplam bekleyen (kırpılmamış): sunucu sayıları — listede gösterilen ilk 10'dan fazlası olabilir. */
export function decisionTotal(view: ResumeView | null | undefined, shown: number): number {
  if (!view) return 0;
  const hidden = Math.max(0, view.asks.total - view.asks.items.length) + Math.max(0, view.acceptances.total - view.acceptances.items.length);
  return shown + hidden;
}

// ------------------------------------------------------------------ klavye (yalnız liste odaktayken; WCAG 2.1.4)
/** Karar listesinde gezinme tuşu → yeni satır sırası; gezinme tuşu değilse null. Alt/Ctrl/Meta ile hiçbiri çalışmaz.
 *  Onay, ret ya da iptal için tuş YOKTUR (K1: karar her zaman görünür düğmeyle, mevcut karar adımında verilir). */
export function queueMove(key: string, current: number, count: number, mods: { alt?: boolean; ctrl?: boolean; meta?: boolean } = {}): number | null {
  if (count <= 0 || mods.alt || mods.ctrl || mods.meta) return null;
  const last = count - 1;
  const cur = Math.min(Math.max(current, 0), last);
  switch (key) {
    case "ArrowDown": case "j": case "J": return Math.min(cur + 1, last);
    case "ArrowUp": case "k": case "K": return Math.max(cur - 1, 0);
    case "Home": return 0;
    case "End": return last;
    default: return null;
  }
}

// ------------------------------------------------------------------ süre
export type WaitParts = { unit: "now" } | { unit: "min"; n: number } | { unit: "hm"; h: number; m: number } | { unit: "h"; h: number } | { unit: "d"; d: number };
export function waitParts(ms: number): WaitParts {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 1) return { unit: "now" };
  if (min < 60) return { unit: "min", n: min };
  const h = Math.floor(min / 60), m = min % 60;
  if (h >= 24) return { unit: "d", d: Math.floor(h / 24) };
  return m ? { unit: "hm", h, m } : { unit: "h", h };
}

// ------------------------------------------------------------------ canlı görevler
export type RunState = "running" | "waiting" | "tool" | "budget" | "paused";
export interface RunProgress { state: RunState; step: number; steps: number; done: number }

/** Görünür adımlar (adım onayı kartları sayılmaz) üzerinden ilerleme ve durum. */
export function runProgress(run: Pick<Run, "status" | "steps">): RunProgress {
  const steps = run.steps.filter((s) => !s.id.includes(".onay-"));
  const done = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const curIdx = steps.findIndex((s) => s.status === "running" || s.status.startsWith("awaiting"));
  const cards = run.steps.filter((s) => s.status === "awaiting_approval" || s.status === "awaiting_tool_approval") as StepLike[];
  let state: RunState = "running";
  if (run.status === "paused" || run.status === "interrupted") state = "paused";
  else if (cards.some((s) => s.status === "awaiting_tool_approval")) state = "tool";
  else if (cards.some((s) => s.ask?.kind === "budget")) state = "budget";
  else if (cards.length) state = "waiting";
  const step = curIdx >= 0 ? curIdx + 1 : Math.min(done + 1, Math.max(steps.length, 1));
  return { state, step, steps: Math.max(steps.length, 1), done };
}

export interface LiveSplit<T> {
  /** canlı bölümün kartları: gerçekten çalışanlar (en yeni üstte), sonra duraklatılan/kesilenler */
  cards: T[];
  /** gerçekten çalışan (kararını beklemeyen) görev sayısı — KPI ve özet cümlesi */
  running: number;
  /** kararını bekleyen (onay, araç, bütçe) açık görev sayısı — kartları kuyruğa ait, canlı bölümde tek satır */
  waiting: number;
  paused: number;
}

/** "Şu an çalışanlar" yalnız çalışanları gösterir; kararını bekleyen görevler karar kuyruğundadır (aynı iş iki kez
 * gösterilmez, "çalışan" sayısı onları saymaz). Sıra: çalışan → duraklatılan/kesilen; her grupta en yeni üstte.*/
export function liveSplit<T extends Pick<Run, "status" | "steps" | "started_at">>(runs: readonly T[]): LiveSplit<T> {
  const live = runs.filter((r) => r.status === "running" || r.status === "paused" || r.status === "interrupted");
  const state = new Map(live.map((r) => [r, runProgress(r).state]));
  const newest = (a: T, b: T) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? ""));
  const running = live.filter((r) => state.get(r) === "running").sort(newest);
  const paused = live.filter((r) => state.get(r) === "paused").sort(newest);
  const waiting = live.length - running.length - paused.length;
  return { cards: [...running, ...paused], running: running.length, waiting, paused: paused.length };
}

/** Geriye uyum: canlı bölümün kartları. */
export function liveRuns<T extends Pick<Run, "status" | "steps" | "started_at">>(runs: readonly T[]): T[] {
  return liveSplit(runs).cards;
}

// ------------------------------------------------------------------ harcama
/** Yerel takvim günü (YYYY-MM-DD). */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Son `days` günün dolar harcaması (bugün en sonda), koşu listesinden: koşu başladığı güne yazılır. Abonelik ve yerel
 *  koşular dolar harcamaz (0). `paidRuns`: dolarla ölçülen koşu sayısı (0 ise "ek ücret yok" yazılır, sahte $0 değil). */
export function dailySpend(runs: readonly (Pick<Run, "started_at" | "usage"> & { steps?: readonly unknown[] })[], now: number, days = 7): { values: number[]; paidRuns: number } {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(now - i * 86400000));
  const values = keys.map(() => 0);
  let paidRuns = 0;
  for (const r of runs) {
    const t = ts(r.started_at);
    if (t === null) continue;
    const i = keys.indexOf(dayKey(t));
    if (i < 0) continue;
    const c = costOf(r);
    if (c.key === "spent" || c.key === "est" || c.key === "mixed") { values[i] += c.usd; paidRuns++; }
  }
  return { values, paidRuns };
}
