/**
 * Dünya göstergeleri (S7) için türetilmiş veri: ajanın iş aşaması (Bellek → Düşünme → Araç → Yazma → Belleğe kayıt),
 * adım x/y, geçen süre, son araç, onay durumu; seviye atlama / bellek kaydı olayları; harici ajan avatarları.
 * Veri kaynağı yalnızca mevcut olaylardır (useStudio states/runs/runList + "memory." ve "game.level" olayları);
 * store.ts düzenlenmez, olaylar `registerEventHandler` ile dinlenir.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";
import type { ExternalAgent } from "../../lib/seamTypes";
import { fmtNumber, tx } from "../../lib/i18n";
import { registerEventHandler, useStudio } from "../../lib/store";
import type { AgentState, Avatar, Mood, Run, StudioEvent } from "../../lib/types";
import { world as M } from "../../locales/world";
import { toolKind } from "../../voxel/toolKind";

// ------------------------------------------------------------------ aşamalar
export type PhaseId = "memory" | "think" | "tool" | "write" | "save";
export type PhaseState = "done" | "active" | "todo" | "skip";

/** Aşamalar; `label` dile duyarlı getter'dır (locales/world.ts). */
export const PHASES: { id: PhaseId; label: string }[] = (["memory", "think", "tool", "write", "save"] as PhaseId[]).map((id) => ({
  id, get label() { return tx(M, `phase_${id}`); },
}));
export const phaseShort = (id: PhaseId) => tx(M, `phase_short_${id}`);
export const phaseStateLabel = (s: PhaseState) => tx(M, `phase_state_${s}`);

export interface WorkInfo {
  runId: string | null;
  stepId: string | null;
  runTitle: string;
  stepTitle: string;
  /** vurgulanan aşama; adım bitti ve kayıt yoksa null */
  phase: PhaseId | null;
  /** PHASES sırasıyla beş aşamanın durumu */
  states: PhaseState[];
  /** kısa durum metni: "Araç: web_search", "Düşünüyor", "Sırada (ollama)" … */
  label: string;
  /** şu anki ya da son kullanılan araç */
  tool: string | null;
  toolCount: number;
  /** iş akışında adım sırası (1 tabanlı) ve toplam; tek adımlı görevde null */
  step: number | null;
  steps: number | null;
  /** adımın başladığı an (ms) */
  since: number | null;
  awaiting: boolean;
  route: string | null;
  tokens: number | null;
  origin: string | null;
  goal: string | null;
  /** adım bitti (kutlama / kayıt anı) */
  finished: boolean;
}

interface Saving { run?: string; step?: string; ts: number }

interface WorldFx {
  /** slug → seviye atlama anı (ms) */
  levelUps: Record<string, number>;
  /** slug → belleğe kayıt sürüyor */
  saving: Record<string, Saving>;
}

export const useWorldFx = create<WorldFx>(() => ({ levelUps: {}, saving: {} }));

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function onLevel(ev: StudioEvent) {
  if (ev.type !== "game.levelup" && ev.type !== "game.level_up") return;
  const subjectType = str(ev.subject_type) ?? str(ev.subjectType);
  if (subjectType && subjectType !== "agent") return; // ofis/yönetici seviyesi dünyada ajan efekti üretmez
  const slug = str(ev.agent) ?? str(ev.slug) ?? str(ev.subject) ?? str(ev.subject_id);
  if (!slug) return;
  useWorldFx.setState((s) => ({ levelUps: { ...s.levelUps, [slug]: Date.now() } }));
}

function onMemory(ev: StudioEvent) {
  const slug = str(ev.agent);
  if (!slug) return;
  if (ev.type === "memory.processing") {
    useWorldFx.setState((s) => ({ saving: { ...s.saving, [slug]: { run: ev.run_id, step: ev.step, ts: Date.now() } } }));
  } else if (ev.type === "memory.updated") {
    useWorldFx.setState((s) => {
      if (!s.saving[slug]) return s;
      const saving = { ...s.saving };
      delete saving[slug];
      return { saving };
    });
  }
}

const offs = [
  registerEventHandler("game.level", onLevel),
  registerEventHandler("memory.", onMemory),
];
if (import.meta.hot) import.meta.hot.dispose(() => offs.forEach((off) => off()));

// ------------------------------------------------------------------ türetme
const SAVE_TTL = 120_000;

function tokenTotal(t?: Record<string, number> | null): number | null {
  if (!t) return null;
  if (typeof t.total === "number" && t.total > 0) return t.total;
  const sum = (t.input ?? 0) + (t.output ?? 0);
  return sum > 0 ? sum : null;
}

export function findRun(runId: string | null | undefined, runs: Record<string, Run>, runList: Run[]): Run | undefined {
  if (!runId) return undefined;
  return runs[runId] ?? runList.find((r) => r.id === runId);
}

/** Ajanın canlı durumundan aşama hattını türetir; çalışmıyorsa (ve kayıt/kutlama yoksa) null. */
export function deriveWork(st: AgentState | undefined, run: Run | undefined, saving: Saving | undefined, now = Date.now()): WorkInfo | null {
  const state = st?.state;
  const busy = state === "thinking" || state === "working" || state === "waiting";
  const savingNow = !!saving && now - saving.ts < SAVE_TTL;
  const done = state === "done";
  if (!busy && !savingNow && !done) return null;

  const runId = (busy || done ? st?.run_id : null) ?? saving?.run ?? st?.run_id ?? null;
  const stepId = (busy || done ? st?.step_id : null) ?? saving?.step ?? st?.step_id ?? null;
  const step = run?.steps.find((s) => s.id === stepId);
  const act = (st?.activity ?? "").trim();
  const tools = step?.tools ?? [];
  const toolCount = tools.length;
  const lastTool = st?.tool || (toolCount ? tools[toolCount - 1].name : null) || null;
  const awaiting = state === "waiting" || step?.status === "awaiting_tool_approval";

  let phase: PhaseId | null;
  let label: string;
  if (!busy && savingNow) { phase = "save"; label = tx(M, "work_saving"); }
  else if (done) { phase = null; label = tx(M, "work_done"); }
  else if (state === "waiting") { phase = "tool"; label = lastTool ? tx(M, "work_approval_tool", { tool: lastTool }) : tx(M, "work_awaiting"); }
  else if (state === "thinking") {
    // sunucu etkinlik metinleri (TR ya da EN) desenle tanınır
    if (/^(belleğe|checking memory|recall)/i.test(act)) { phase = "memory"; label = tx(M, "work_memory_look"); }
    else if (/^(sırada|queued)/i.test(act)) { phase = "memory"; label = act.replace(/…$/, ""); }
    else { phase = "think"; label = tx(M, "work_thinking"); }
  } else if (st?.tool) { phase = "tool"; label = tx(M, "work_tool", { tool: st.tool }); }
  else if (/^(yazıyor|writing)/i.test(act)) { phase = "write"; label = tx(M, "work_writing"); }
  else if (/inceliyor|reviewing/i.test(act)) { phase = "think"; label = tx(M, "work_review"); }
  else if (/onay alındı|reddedildi|approved|rejected/i.test(act)) { phase = "tool"; label = act; }
  else { phase = step?.output ? "write" : "think"; label = act.replace(/…$/, "") || tx(M, "work_working"); }

  const order = PHASES.map((p) => p.id);
  const idx = phase ? order.indexOf(phase) : order.length - 1;
  const mem = step?.memory as { skipped?: boolean } | null | undefined;
  const states: PhaseState[] = order.map((p, k) => {
    if (p === phase) return "active";
    if (p === "tool") return toolCount > 0 ? "done" : idx > 2 ? "skip" : "todo";
    if (p === "save") return mem ? (mem.skipped ? "skip" : "done") : "todo";
    if (!phase) return "done";
    return k < idx ? "done" : "todo";
  });

  const index = run && stepId ? run.steps.findIndex((s) => s.id === stepId) : -1;
  const multi = !!run && run.steps.length > 1 && index >= 0;
  const started = step?.started_at ? Date.parse(step.started_at) : st?.since ? st.since * 1000 : NaN;
  return {
    runId, stepId,
    runTitle: run?.title ?? "",
    stepTitle: step?.title ?? "",
    phase, states, label,
    tool: lastTool, toolCount,
    step: multi ? index + 1 : null,
    steps: multi ? run!.steps.length : null,
    since: Number.isFinite(started) ? started : null,
    awaiting,
    route: step?.route?.label ?? null,
    tokens: tokenTotal(step?.tokens),
    origin: run?.origin ?? null,
    goal: run?.goal ?? null,
    finished: done || (!busy && savingNow),
  };
}

export function sameWork(a: WorkInfo | null | undefined, b: WorkInfo | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.runId === b.runId && a.stepId === b.stepId && a.runTitle === b.runTitle && a.stepTitle === b.stepTitle &&
    a.phase === b.phase && a.states.join() === b.states.join() && a.label === b.label && a.tool === b.tool &&
    a.toolCount === b.toolCount && a.step === b.step && a.steps === b.steps && a.since === b.since &&
    a.awaiting === b.awaiting && a.route === b.route && a.tokens === b.tokens && a.origin === b.origin &&
    a.goal === b.goal && a.finished === b.finished;
}

// ------------------------------------------------------------------ biçim
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return tx(M, "elapsed_sec", { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(s % 60).padStart(2, "0")}`;
  return tx(M, "elapsed_hm", { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") });
}

export function fmtTokens(n: number | null | undefined): string {
  return n == null ? "" : fmtNumber(n);
}

/**
 * Geçen süre metinleri React yeniden çizimi olmadan saniyede bir güncellenir:
 * `data-since="<ms>"` taşıyan öğelerin metni doğrudan yazılır (30+ ajanda bile tek zamanlayıcı).
 */
let tickUsers = 0;
let tickTimer: number | undefined;
function tick() {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>("[data-since]").forEach((el) => {
    const since = Number(el.dataset.since);
    if (Number.isFinite(since)) {
      const text = fmtElapsed(now - since);
      if (el.textContent !== text) el.textContent = text;
    }
  });
}
export function useElapsedTicker() {
  useEffect(() => {
    tickUsers++;
    if (tickUsers === 1) tickTimer = window.setInterval(tick, 1000);
    return () => {
      tickUsers--;
      if (!tickUsers && tickTimer !== undefined) { window.clearInterval(tickTimer); tickTimer = undefined; }
    };
  }, []);
}

// ------------------------------------------------------------------ kararlı liste
/** Önceki çizimdeki eşit öğeleri aynı referansla döndürür (React.memo'lu karakterler gereksiz çizilmesin). */
export function useStableList<T>(items: T[], keyOf: (t: T) => string, same: (a: T, b: T) => boolean): T[] {
  const prev = useRef(new Map<string, T>());
  const out = items.map((it) => {
    const old = prev.current.get(keyOf(it));
    return old !== undefined && same(old, it) ? old : it;
  });
  prev.current = new Map(out.map((it) => [keyOf(it), it]));
  return out;
}

// ------------------------------------------------------------------ harici ajanlar
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const EXT_SPECIES: Avatar["species"][] = ["human", "human", "cat", "fox", "bear", "rabbit", "panda", "penguin", "dog"];
const EXT_SKIN = ["#FCE3CF", "#F5D0B5", "#E0AC69", "#C68642", "#8D5524"];
const EXT_FUR: Partial<Record<Avatar["species"], string>> = {
  cat: "#A39A92", fox: "#E8833A", bear: "#8D6E63", rabbit: "#F3F4F6", panda: "#F5F5F4", penguin: "#2B2D42", dog: "#C68B59",
};
const EXT_HAIR: Avatar["hair"][] = ["short", "bob", "curly", "spiky", "ponytail", "bun"];
const EXT_HAIR_COLORS = ["#1F1A17", "#4A2F1D", "#8B5A2B", "#D4A55C", "#B23A48", "#6C5CE7"];
const EXT_OUTFITS: Avatar["outfit"][] = ["hoodie", "tshirt", "sweater", "overalls", "labcoat"];
const EXT_OUTFIT_COLORS = ["#2D6CDF", "#E85D75", "#334155", "#10B981", "#F59E0B", "#8E6CEF", "#0EA5E9", "#EF4444"];
const EXT_ACCENTS = ["#FFD166", "#22C55E", "#38BDF8", "#F472B6", "#FB923C"];

const avatarCache = new Map<string, Avatar>();

/** Proje anahtarından kararlı (her açılışta aynı) sevimli avatar; aksesuar karakter bileşeninde eklenir. */
export function externalAvatar(projectKey: string): Avatar {
  const cached = avatarCache.get(projectKey);
  if (cached) return cached;
  const h = hash(projectKey || "?");
  const pick = <T,>(xs: T[], shift: number) => xs[(h >>> shift) % xs.length];
  const species = pick(EXT_SPECIES, 0);
  const human = species === "human";
  const avatar: Avatar = {
    species,
    skin: human ? pick(EXT_SKIN, 3) : EXT_FUR[species] ?? "#A39A92",
    hair: human ? pick(EXT_HAIR, 6) : "none",
    hairColor: pick(EXT_HAIR_COLORS, 9),
    beard: "none",
    outfit: pick(EXT_OUTFITS, 12),
    outfitColor: pick(EXT_OUTFIT_COLORS, 15),
    accent: pick(EXT_ACCENTS, 18),
    glasses: "none",
    hat: "none",
  };
  avatarCache.set(projectKey, avatar);
  return avatar;
}

export const EXT_META: Record<ExternalAgent["source"], { label: string; color: string; accessory: "headset" | "visor" }> = {
  "claude-code": { label: "Claude Code", color: "#D97757", accessory: "headset" },
  codex: { label: "Codex", color: "#3E8ED0", accessory: "visor" },
};

export const extStatusLabel = (s: ExternalAgent["status"]) => tx(M, `ext_${s}`);

/** Dünyadaki karakter kimliği (kararlı referans: memo'lu karakter gereksiz çizilmesin). */
export interface ExternalIdentity { slug: string; name: string; color: string; avatar: Avatar; title: null; team: null }
const identityCache = new Map<string, { sig: string; value: ExternalIdentity }>();

export function externalIdentity(e: ExternalAgent): ExternalIdentity {
  const slug = `ext:${e.id}`;
  const sig = `${e.source}|${e.projectKey}|${e.projectName}`;
  const hit = identityCache.get(slug);
  if (hit && hit.sig === sig) return hit.value;
  const value: ExternalIdentity = {
    slug, name: e.projectName || e.projectKey || tx(M, "ext_project"), color: EXT_META[e.source]?.color ?? "#94A3B8",
    avatar: externalAvatar(e.projectKey), title: null, team: null,
  };
  identityCache.set(slug, { sig, value });
  return value;
}

export function externalMood(e: ExternalAgent): Mood {
  if (e.status === "waiting") return "waiting";
  if (e.status === "active") return e.tool ? "working" : "thinking";
  return "idle";
}

/** Harici oturumun HUD bilgisi: aşama hattı yok (aşamalar bilinmiyor), etkinlik + araç + süre + onay. */
export function externalWork(e: ExternalAgent): WorkInfo | null {
  if (e.status !== "active" && e.status !== "waiting") return null;
  const waiting = e.status === "waiting";
  const started = e.startedAt ? Date.parse(e.startedAt) : NaN;
  return {
    runId: null, stepId: null, runTitle: e.title || "", stepTitle: "",
    phase: e.tool ? "tool" : "think", states: [],
    label: waiting ? (e.tool ? tx(M, "work_approval_tool", { tool: e.tool }) : tx(M, "work_awaiting"))
      : e.activity || (e.tool ? tx(M, "work_tool", { tool: e.tool }) : tx(M, "work_working")),
    tool: e.tool ?? null, toolCount: e.tool ? 1 : 0, step: null, steps: null,
    since: Number.isFinite(started) ? started : null, awaiting: waiting,
    route: null, tokens: null, origin: null, goal: null, finished: false,
  };
}

// ------------------------------------------------------------------ S33: baş üstü etkinlik etiketi
/** Ajanın şu anki eylemi, kısa fiil olarak ("kod yazıyor", "web'de arıyor", "seni bekliyor"…); boştaysa "". */
export function worldCaption(mood: Mood, tool: string | null | undefined, activity = "", extra: { talking?: boolean; onBreak?: boolean; meal?: boolean } = {}): string {
  if (extra.talking) return tx(M, "cap_talk");
  switch (mood) {
    case "waiting": return tx(M, "cap_wait");
    case "done": return tx(M, "cap_done");
    case "error": return tx(M, "cap_error");
    case "offline": return tx(M, "cap_sleep");
    case "idle": return extra.meal ? tx(M, "cap_meal") : extra.onBreak ? tx(M, "cap_break") : ""; // ACTIVITY-FEEL: mekânda yemek
    default: break;
  }
  const kind = toolKind(tool);
  if (kind === "web") return tx(M, "cap_web");
  if (kind === "read") return tx(M, "cap_read");
  if (kind === "shell") return tx(M, "cap_shell");
  if (kind === "plan") return tx(M, "cap_plan");
  if (kind === "write") return /edit|patch|code|replace|apply/i.test(tool ?? "") ? tx(M, "cap_code") : tx(M, "cap_write");
  if (mood === "thinking") return /^(belleğe|checking memory|recall)/i.test(activity.trim()) ? tx(M, "cap_memory") : tx(M, "cap_think");
  return /^(yazıyor|writing)/i.test(activity.trim()) ? tx(M, "cap_write") : tx(M, "cap_work");
}

/** Bağlayıcı türü (simge için): Claude, Codex, Ollama, Hermes profili, OpenAI uyumlu. */
export type ConnKind = "claude" | "codex" | "ollama" | "profile" | "openai";
export function connKind(route: { connection?: string | null; connector?: string | null } | null | undefined, externalLabel?: string | null): ConnKind | null {
  if (externalLabel) return /codex/i.test(externalLabel) ? "codex" : "claude";
  if (!route) return null;
  if (/openai|compat|lmstudio|vllm|groq|openrouter/i.test(route.connector ?? "")) return "openai";
  const c = route.connection ?? "";
  return c === "claude" || c === "codex" || c === "ollama" || c === "profile" ? c : null;
}

// ------------------------------------------------------------------ S33: ajanlar arası konuşmalar
/**
 * Yalnızca GERÇEK olaylardan (handoff, devretme, Faz 6 `message.*`) üretilir; uydurma sohbet yoktur. Balon metni olayın
 * kısa başlığı/konusudur (gövde ve tam istem asla gösterilmez), sırlara benzeyen parçalar ve bağlantılar ayıklanır.
 */
export interface Talk { key: string; from: string; to: string; text: string; ts: number }
export const useWorldTalk = create<{ talks: Talk[] }>(() => ({ talks: [] }));

const TALK_TTL = 30_000;
const SECRETISH = /\b(?:sk|pk|rk|ghp|gho|ghs|xox[abprs]|AKIA|AIza|hf)[-_A-Za-z0-9]{6,}|[A-Za-z0-9+/_=-]{28,}/g;

/** Balon için güvenli kısa metin: tek satır, bağlantı/e-posta/jeton benzeri parçalar çıkarılmış, en çok `max` karakter. */
export function safeSnippet(raw: unknown, max = 46): string {
  if (typeof raw !== "string") return "";
  let s = raw.replace(/```[\s\S]*?```/g, " ").replace(/[\r\n\t]+/g, " ");
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "").replace(/\S+@\S+\.\S+/g, "").replace(SECRETISH, "…");
  s = s.replace(/\s{2,}/g, " ").trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function stepTitle(runId: unknown, stepId: unknown): string {
  if (typeof runId !== "string" || typeof stepId !== "string") return "";
  const st = useStudio.getState();
  const run = st.runs[runId] ?? st.runList.find((r) => r.id === runId);
  return run?.steps.find((x) => x.id === stepId)?.title ?? "";
}

function talkText(kind: string, subject: unknown, runId: unknown, stepId: unknown): string {
  const direct = safeSnippet(subject);
  if (direct) return direct;
  const title = safeSnippet(stepTitle(runId, stepId), 30);
  if (kind === "ask") return tx(M, "talk_ask");
  if (kind === "answer") return tx(M, "talk_answer");
  if (kind === "note") return tx(M, "talk_note");
  if (kind === "assign") return title ? tx(M, "talk_handoff", { step: title }) : tx(M, "talk_assign");
  return title ? tx(M, "talk_handoff", { step: title }) : tx(M, "talk_handoff_plain");
}

function pushTalk(t: Talk) {
  useWorldTalk.setState((s) => {
    const now = Date.now();
    // aynı mesajın handoff + message.* çifti tek konuşmadır
    if (s.talks.some((x) => x.key === t.key || (x.from === t.from && x.to === t.to && Math.abs(x.ts - t.ts) < 1500))) return s;
    return { talks: [...s.talks.filter((x) => now - x.ts < TALK_TTL), t].slice(-24) };
  });
}

function onTalkEvent(ev: StudioEvent) {
  const e = ev as StudioEvent & Record<string, unknown>;
  const msg = (e.message && typeof e.message === "object" ? e.message : e) as Record<string, unknown>;
  const from = str(msg.from_agent) ?? str(msg.from) ?? str(e.from);
  const to = str(msg.to_agent) ?? str(msg.to) ?? str(e.to);
  if (!from || !to || from === to) return;
  if (ev.type.startsWith("message.") && !/(created|sent|new|posted)$/.test(ev.type)) return; // okundu vb. değil
  const kind = str(msg.kind) ?? (ev.type === "handoff" ? "handoff" : "note");
  if (kind === "system") return;
  const id = str(msg.id) ?? str(e.message_id) ?? String(ev.seq ?? Date.now());
  pushTalk({ key: `m:${id}`, from, to, ts: Date.now(),
    text: talkText(kind, msg.subject ?? msg.summary ?? e.subject ?? e.summary, msg.run_id ?? e.run_id, msg.step_id ?? e.step) });
}

// ------------------------------------------------------------------ S33: +XP baloncukları (oyun katmanı açıksa)
export interface XpPop { slug: string; amount: number; ts: number }
/** Kalabalık çizici bu kuyruğu okur ve 2B etiket tuvalinde yükselen "+N XP" çizer (React yeniden çizimi yok). */
export const xpPops: XpPop[] = [];
function onXp(ev: StudioEvent) {
  const e = ev as StudioEvent & Record<string, unknown>;
  if (e.subject_type !== "agent") return;
  const slug = str(e.subject), amount = Number(e.amount ?? 0);
  if (!slug || !(amount > 0)) return;
  const now = Date.now();
  const prev = xpPops.find((p) => p.slug === slug && now - p.ts < 1200);
  if (prev) { prev.amount += amount; return; } // ajan başına birleştir
  xpPops.push({ slug, amount: Math.round(amount), ts: now });
  if (xpPops.length > 40) xpPops.splice(0, xpPops.length - 40);
}

const s33offs = [
  registerEventHandler("handoff", onTalkEvent),
  registerEventHandler("message.", onTalkEvent),
  registerEventHandler("game.xp", onXp),
];
if (import.meta.hot) import.meta.hot.dispose(() => s33offs.forEach((off) => off()));
