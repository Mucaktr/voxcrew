// Ekip S5 (Oyunlaştırma): türler, istemci ve depo
// SÖZLEŞME — S7 (dünya) ve S12 (ajan profili) bu imzaları kullanır; imzaları değiştirme, yalnızca içini doldur.
// Hook'lar kararlı referans döndürmeli (zustand seçicisi her çağrıda yeni nesne/dizi üretmemeli).
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { game as m } from "../locales/game";
import { refreshIntroGate, useIntroGate } from "../full/data";
import { achievementText, holdForIntro, xpReason } from "./gameEventText";
import { currentLocale, tx } from "./i18n";
import type { StudioEvent } from "./types";
import { bodyText } from "./api";
import { useWalkPresence } from "./walkPresence";

export interface GameAgent {
  level: number;
  xp: number;
  /** bir sonraki seviyeye kalan XP */
  xpToNext: number;
  /** bu seviyedeki ilerleme 0–1 */
  progress: number;
  /** kıdem unvanı (ör. "Stajyer", "Kıdemli") */
  title: string;
  rank?: string | null;
  /** org şemasındaki rütbenin istek dilindeki adı (ör. "Müdür") */
  rankLabel?: string | null;
  /** bugünkü etkin XP (günlük azalma şeffaflığı) */
  today?: number;
}

// ------------------------------------------------------------------ sunucu türleri
export type Rarity = "common" | "rare" | "epic" | "legendary";
const RARITIES: Rarity[] = ["common", "rare", "epic", "legendary"];
/** Nadirlik etiketi, şu anki dilde (getter). */
export const RARITY_LABEL: Record<Rarity, string> = Object.defineProperties({} as Record<Rarity, string>, Object.fromEntries(
  RARITIES.map((r) => [r, { enumerable: true, get: () => tx(m, `rarity_${r}`) }]),
)) as Record<Rarity, string>;

export interface LevelView {
  level: number; xp: number; into: number; need: number; xp_to_next: number; progress: number; max: boolean; title: string;
}
export interface ProfileAgent extends LevelView {
  slug: string; name: string; rank: string | null; rank_label: string | null; hidden?: boolean; team?: string | null;
  today: { raw: number; xp: number; full_until: number };
}
export interface LockedItem {
  id: string; kind: string; label: string; price: number; min_level: number; unlock_level: number; achievement: string | null;
}
/** S35 ofis dekoru: ofis seviyesiyle açılan dünya yapıcı eşyası (`id` = lib/builder.ts PALETTE kimliği). */
export interface DecorItem { id: string; label: string; unlock_level: number; unlocked: boolean }
export interface GameProfile {
  enabled: boolean; celebrations: boolean; sounds: boolean; show_world_badges: boolean; creative: boolean;
  /** S35 odak modu: oyun katmanları gizlenir, iş KPI'ları kalır */
  focus?: boolean; decor?: DecorItem[];
  /** S40 yönetici / test modu: kilitler geçici olarak açık (hiçbir şey verilmez; kapanınca kilitler döner) */
  admin?: boolean;
  coins: number; office: LevelView; manager: LevelView; agents: ProfileAgent[];
  external: (Omit<LevelView, "title"> & { id: string })[];
  unlocked: string[]; locked: LockedItem[]; free: string[];
  achievements: { earned: number; total: number }; quests_ready: number; unseen: number;
}
export interface LedgerRow { ts: number; rule: string; raw: number; amount: number; explain: string; run_id?: string | null; step_id?: string | null }
export interface EarnedView {
  id: string; tier: number; name: string; icon: string; rarity: Rarity; category: string; description: string;
  subject_type: "agent" | "human" | "office"; subject: string; who: string; unlocked_at: number; seen: boolean;
}
export interface PromotionHint { band: number; seniority: string; suggested_rank: string; suggested_label: string; current_label: string }
export interface GameAgentDetail extends LevelView {
  slug: string; name: string; rank: string | null; rank_label: string | null;
  today: { raw: number; xp: number; full_until: number };
  ledger: LedgerRow[]; achievements: EarnedView[]; promotion: PromotionHint | null; stats: Record<string, number>;
}
export interface AchievementTier { tier: number; threshold: number; rarity: Rarity; name: string; coins: number; xp: number }
export interface AchievementItem {
  id: string; name: string; description: string; condition: string; subject: "agent" | "human" | "office";
  category: string; category_label: string; icon: string; hidden: boolean; secret: boolean; special: boolean;
  reward_item: string | null; tiers: AchievementTier[]; best_tier: number; rarity: Rarity;
  progress: { value: number; next: number | null } | null; earned: EarnedView[]; ownership: number | null;
}
export interface AchievementsData {
  summary: { earned: number; total: number; by_rarity: Record<Rarity, number>; kinds_earned: number; kinds_total: number };
  categories: Record<string, string>; items: AchievementItem[]; recent: EarnedView[];
}
export interface Quest {
  id: string; template: string; kind: "daily" | "weekly"; slot: number; title: string; why: string; go: string;
  progress: number; target: number; status: "active" | "done" | "claimed"; reward: { coins: number; xp: number };
  created_at: number; done_at: number | null; claimed_at: number | null;
}
export interface QuestsData { items: Quest[]; refill: { daily: string; day_start_hour: number }; ready: number }
export interface ShopItem {
  id: string; kind: "cosmetic" | "celebration" | "scene" | "consumable"; label: string; price: number; rarity: Rarity;
  description: string; min_level: number; unlock_level: number; achievement: string | null; achievement_name: string | null;
  owned: boolean; level_ok: boolean; can_buy: boolean;
}
export interface ShopData { balance: number; office_level: number; creative: boolean; admin?: boolean; items: ShopItem[]; free_scenes: string[] }
export interface FeedEntry { id: number; ts: number; kind: string; subject_type: string | null; subject: string | null; text: string; amount: number | null; data?: Record<string, unknown> }
export type GameSettingsPatch = Partial<Pick<GameProfile, "enabled" | "celebrations" | "sounds" | "show_world_badges" | "creative" | "focus">>;
/** GET /api/game/scoreboard (S35): iş KPI'ları run_events'ten (oyundan bağımsız) + ekip seviyesi*/
export interface ScoreboardData {
  tasks_today: number; hourly: number[]; active_agents: number; day_start: string; hours_from: string;
  level: number; progress: number; xp_today: number; week_active_days: number;
}
export interface RecapData {
  week: string; current: boolean; from: string; to: string; shipped: number; titles: string[]; xp: number;
  /** XP sıralaması yok (C-02); yalnızca kullanıcının kendi seçtiği haftanın çalışanı.*/
  weekly_pick?: { slug: string; name: string; reason: string } | null;
  achievements: number; quests: number; active_days: number; dismissed: boolean;
}
/** Ekip katkısı satırı — sıra numarası yok (kullanıcı kararı C-02): ajanlar ada göre listelenir. */
export interface ContributionRow { slug: string; name: string; xp: number; steps: number; first_try: number; level: number; title: string }
export interface ContributionData {
  period: "week" | "all"; since: string | null;
  team: { xp: number; steps: number; first_try: number; agents: number };
  items: ContributionRow[];
}

// ------------------------------------------------------------------ istemci
export class GameApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    // X-Studio-Lang: sunucu katalog adlarını ve hata iletilerini bu dilde döner (Faz 5 i18n)
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = bodyText(res.status, null);
    try {
      const j = await res.json();
      msg = bodyText(res.status, j);
    } catch { /* gövde yok */ }
    throw new GameApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;
function requestId() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export const gameApi = {
  profile: () => req<GameProfile>("GET", "/api/game/profile"),
  agent: (slug: string) => req<GameAgentDetail>("GET", `/api/game/agents/${enc(slug)}`),
  dismissPromotion: (slug: string) => req<{ ok: boolean }>("POST", `/api/game/agents/${enc(slug)}/promotion/dismiss`),
  achievements: () => req<AchievementsData>("GET", "/api/game/achievements"),
  markSeen: () => req<{ ok: boolean }>("POST", "/api/game/achievements/seen"),
  quests: () => req<QuestsData>("GET", "/api/game/quests"),
  claim: (id: string) => req<{ ok: boolean; balance: number; coins?: number; xp?: number; already?: boolean }>(
    "POST", `/api/game/quests/${enc(id)}/claim`),
  swap: (id: string) => req<{ ok: boolean; quest: string }>("POST", `/api/game/quests/${enc(id)}/swap`),
  shop: () => req<ShopData>("GET", "/api/game/shop"),
  /** Açık onaylı satın alma (yalnızca kullanıcının onay penceresindeki tıklamasıyla çağrılır). */
  buy: (item: string) => req<{ ok: boolean; balance: number; already?: boolean }>(
    "POST", `/api/game/shop/${enc(item)}/buy`, { confirm: true, client_request_id: requestId() }),
  /** SP-W1: pasaport damgasıyla şehir açma (açık onay; yalnızca kullanıcının onay penceresindeki tıklamasıyla). */
  redeemStamp: (scene: string) => req<{ ok: boolean; item?: string; already?: boolean }>(
    "POST", "/api/game/passport/redeem", { scene, confirm: true }),
  feed: (limit = 30) => req<FeedEntry[]>("GET", `/api/game/feed?limit=${limit}`),
  settings: (patch: GameSettingsPatch) => req<GameProfile>("PUT", "/api/game/settings", patch),
  scoreboard: () => req<ScoreboardData>("GET", "/api/game/scoreboard"),
  recap: (week?: string) => req<RecapData>("GET", `/api/game/recap${week ? `?week=${enc(week)}` : ""}`),
  dismissRecap: (week: string) => req<{ ok: boolean }>("POST", `/api/game/recap/${enc(week)}/dismiss`),
  contribution: (period: "week" | "all" = "week") => req<ContributionData>("GET", `/api/game/contribution?period=${period}`),
  signal: (type: "context.opened" | "species.previewed", data: Record<string, unknown>) =>
    req<{ ok: boolean }>("POST", "/api/game/signal", { type, data }),
};

/** Arayüz sinyali (ör. bağlam açıldı); hata sessizce yutulur. Diğer ekipler `context.opened` için kullanabilir. */
export function sendGameSignal(type: "context.opened" | "species.previewed", data: Record<string, unknown> = {}) {
  gameApi.signal(type, data).catch(() => undefined);
}

// ------------------------------------------------------------------ bildirim ve kutlama türleri
export type ToastKind = "xp" | "levelup" | "achievement" | "quest" | "unlock" | "info";
export interface GameToast {
  id: number; kind: ToastKind; title: string; text?: string; icon?: string; rarity?: Rarity; count: number;
  ts: number; amount?: number; key: string;
}
export interface Celebration {
  id: number; kind: "achievement" | "office" | "levelup" | "treat"; title: string; text: string; icon?: string;
  rarity?: Rarity; coins?: number; level?: number;
}

// ------------------------------------------------------------------ depo
interface GameStore {
  profile: GameProfile | null;
  loaded: boolean;
  error: string | null;
  /** ajan slug → özet (yalnızca profil yenilenince yeni nesneler) */
  agents: Record<string, GameAgent>;
  locked: Record<string, LockedItem>;
  toasts: GameToast[];
  celebrations: Celebration[];
  /** kutlama patlaması (konfeti) sayacı — her artışta GameLayer bir patlama çizer */
  burst: { n: number; style: string; big: boolean };
  /** sayfaların yeniden yüklemesi için olay sayacı */
  pulse: number;
  announce: string;
  refresh: () => Promise<void>;
  saveSettings: (patch: GameSettingsPatch) => Promise<void>;
  pushToast: (t: Omit<GameToast, "id" | "count" | "ts">) => void;
  dismissToast: (id: number) => void;
  popCelebration: () => void;
}

let toastSeq = 0;
let celebrationSeq = 0;

function toAgents(p: GameProfile): Record<string, GameAgent> {
  const out: Record<string, GameAgent> = {};
  for (const a of p.agents) {
    out[a.slug] = { level: a.level, xp: a.xp, xpToNext: a.xp_to_next, progress: a.progress, title: a.title,
                    rank: a.rank, rankLabel: a.rank_label, today: a.today?.xp ?? 0 };
  }
  return out;
}

export const useGame = create<GameStore>((set) => ({
  profile: null,
  loaded: false,
  error: null,
  agents: {},
  locked: {},
  toasts: [],
  celebrations: [],
  burst: { n: 0, style: "confetti", big: false },
  pulse: 0,
  announce: "",

  refresh: async () => {
    try {
      const p = await gameApi.profile();
      const locked: Record<string, LockedItem> = {};
      p.locked.forEach((l) => { locked[l.id] = l; });
      set({ profile: p, agents: toAgents(p), locked, loaded: true, error: null });
    } catch (e) {
      set({ loaded: true, error: String((e as Error).message ?? e) });
    }
  },
  saveSettings: async (patch) => {
    const p = await gameApi.settings(patch);
    const locked: Record<string, LockedItem> = {};
    p.locked.forEach((l) => { locked[l.id] = l; });
    set({ profile: p, agents: toAgents(p), locked });
  },
  pushToast: (t) => {
    const now = Date.now();
    set((s) => {
      // Gruplama (C.6): aynı anahtar 3 sn içinde (XP için 1,5 sn) birleşir
      const window = t.kind === "xp" ? 1500 : 3000;
      const idx = s.toasts.findIndex((x) => x.key === t.key && now - x.ts < window);
      if (idx >= 0) {
        const prev = s.toasts[idx];
        const merged: GameToast = { ...prev, ...t, id: prev.id, ts: now, count: prev.count + 1,
          amount: t.amount != null ? (prev.amount ?? 0) + t.amount : prev.amount };
        const toasts = [...s.toasts];
        toasts[idx] = merged;
        return { toasts };
      }
      return { toasts: [{ ...t, id: ++toastSeq, count: 1, ts: now }, ...s.toasts].slice(0, 12) };
    });
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  popCelebration: () => set((s) => ({ celebrations: s.celebrations.slice(1) })),
}));

let loading: Promise<void> | null = null;
/** Profil bir kez yüklenir (birden çok bileşen çağırabilir). */
export function ensureGameLoaded(): Promise<void> {
  if (useGame.getState().loaded) return Promise.resolve();
  loading ??= useGame.getState().refresh().finally(() => { loading = null; });
  return loading;
}

let refreshTimer: number | undefined;
/** Olay seli sırasında profili en fazla 800 ms'de bir yenile. */
export function scheduleGameRefresh(delay = 800) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => { void useGame.getState().refresh(); }, delay);
}

// ------------------------------------------------------------------ sözleşme hook'ları
/** Ajanın oyun özeti; oyunlaştırma kapalıysa veya veri yoksa null. */
export function useGameAgent(slug: string | null | undefined): GameAgent | null {
  useEffect(() => { void ensureGameLoaded(); }, []);
  return useGame((s) => (slug && s.profile?.enabled ? s.agents[slug] ?? null : null));
}

/** Oyunlaştırmanın görsel katmanları açık mı (ayar: game.enabled). */
export function useGameEnabled(): boolean {
  useEffect(() => { void ensureGameLoaded(); }, []);
  return useGame((s) => !!s.profile?.enabled);
}

/** Dünya üstü rozetler gösterilsin mi (game.enabled && game.show_world_badges && odak modu kapalı). */
export function useWorldBadges(): boolean {
  return useGame((s) => !!s.profile?.enabled && !!s.profile?.show_world_badges && !s.profile?.focus);
}

/** S35: oyun katmanları (bildirim, kutlama, dünya kaplaması, rozet, +XP) görünsün mü: game.enabled && !odak modu. */
export function isGameVisible(): boolean {
  const p = useGame.getState().profile;
  return !!p?.enabled && !p.focus;
}
export function useGameVisible(): boolean {
  useEffect(() => { void ensureGameLoaded(); }, []);
  return useGame((s) => !!s.profile?.enabled && !s.profile?.focus);
}
/** S35: odak modu açık mı (oyun katmanları gizli, iş KPI'ları görünür). */
export function useFocusMode(): boolean {
  return useGame((s) => !!s.profile?.enabled && !!s.profile?.focus);
}

// ------------------------------------------------------------------ S35 SÖZLEŞME — S33 (yaşayan dünya) kullanır
/** Dünya içi başlık hapı için ajan seviyesi. */
export interface AgentLevel { level: number; progress: number; title: string }
/** Ajan seviyesi (dünya içi): oyun kapalı, odak modu, dünya rozetleri kapalı ya da bilinmeyen ajanda null.
 *  Kararlı referans: yalnızca o ajanın game.xp olayında ya da profil yenilenince değişir. */
export function useAgentLevel(slug: string | null | undefined): AgentLevel | null {
  useEffect(() => { void ensureGameLoaded(); }, []);
  return useGame((s) => (slug && s.profile?.enabled && !s.profile.focus && s.profile.show_world_badges ? s.agents[slug] ?? null : null));
}
/** Listeler ve profil için ajan seviyesi: oyun kapalı ya da odak modunda null (dünya rozeti ayarından bağımsız). */
export function useAgentLevelBadge(slug: string | null | undefined): AgentLevel | null {
  useEffect(() => { void ensureGameLoaded(); }, []);
  return useGame((s) => (slug && s.profile?.enabled && !s.profile.focus ? s.agents[slug] ?? null : null));
}

/** Ekip skoru (S33 duvar panosu). İş alanları (tasksToday, hourly, activeAgents) oyundan bağımsızdır ve her zaman
 *  geçerlidir; level/progress/xpToday oyun alanlarıdır — `useGameVisible()` false iken gizlenmelidir. */
export interface TeamScore {
  /** bugün (04:00'ten beri) "done" biten koşu (görev + iş akışı) sayısı; Akademi alıştırmaları hariç */
  tasksToday: number;
  /** son 8 saat, eskiden yeniye; son çubuk içinde bulunulan saat */
  hourly: number[];
  /** ofis (ekip) seviyesi */
  level: number;
  /** seviye içi ilerleme 0–1 */
  progress: number;
  /** bugünkü etkin ekip XP'si (ajanlar + sen) */
  xpToday?: number;
  /** şu an çalışan bir adımı olan farklı ajan sayısı */
  activeAgents?: number;
}
interface ScoreStore { score: TeamScore | null; weekActiveDays: number }
const useScore = create<ScoreStore>(() => ({ score: null, weekActiveDays: 0 }));
let scoreUsers = 0;
let scoreTimer: number | undefined;
let scoreTick: number | undefined;
let scoreLast = 0;
let scoreOff: (() => void) | null = null;
let scoreSource: ((onEvent: () => void) => () => void) | null = null;

async function loadScore() {
  scoreLast = Date.now();
  try {
    const d = await gameApi.scoreboard();
    const next: TeamScore = { tasksToday: d.tasks_today, hourly: d.hourly, level: d.level, progress: d.progress,
                              xpToday: d.xp_today, activeAgents: d.active_agents };
    const prev = useScore.getState();
    if (JSON.stringify(prev.score) !== JSON.stringify(next)) useScore.setState({ score: next });
    if (prev.weekActiveDays !== d.week_active_days) useScore.setState({ weekActiveDays: d.week_active_days });
  } catch { /* sunucu yok: son değer kalır */ }
}
/** Skoru en çok 2 sn'de bir yenile (olay seli sırasında). */
export function scheduleScoreRefresh() {
  if (scoreTimer !== undefined || scoreUsers <= 0) return;
  const wait = Math.max(150, 2000 - (Date.now() - scoreLast));
  scoreTimer = window.setTimeout(() => { scoreTimer = undefined; void loadScore(); }, wait);
}
/** İş olayı kaynağı (GameLayer bağlar: run.finished, step.started, step.finished → skor yenile). */
export function setScoreEventSource(fn: ((onEvent: () => void) => () => void) | null) {
  scoreOff?.();
  scoreOff = null;
  scoreSource = fn;
  if (scoreUsers > 0 && fn) scoreOff = fn(scheduleScoreRefresh);
}
function scoreAcquire() {
  if (scoreUsers++ > 0) return;
  void loadScore();
  if (scoreSource) scoreOff = scoreSource(scheduleScoreRefresh);
  scoreTick = window.setInterval(() => { void loadScore(); }, 60_000); // saat çubukları kaysın
}
function scoreRelease() {
  if (--scoreUsers > 0) return;
  scoreOff?.();
  scoreOff = null;
  window.clearInterval(scoreTick);
}
/** Ekip skoru; ilk yüklemeye kadar null. Kararlı referans (yalnızca veri değişince yeni nesne). */
export function useTeamScore(): TeamScore | null {
  useEffect(() => { scoreAcquire(); return scoreRelease; }, []);
  return useScore((s) => s.score);
}
/** Bu haftaki aktif gün sayısı (seri yerine; kaçırılan gün bir şey kaybettirmez, araştırma Y1). */
export function useWeekActiveDays(): number {
  useEffect(() => { scoreAcquire(); return scoreRelease; }, []);
  return useScore((s) => s.weekActiveDays);
}

/** Kilitler devre dışı mı: profil yok, oyun kapalı, yaratıcı mod ya da S40 yönetici/test modu. Tüm kilit seçicileri bunu kullanır. */
function locksOff(p: GameProfile | null): boolean {
  return !p || !p.enabled || p.creative || p.admin === true;
}

/** Kilitli dekorların tablosu (palet kimliği → kilit); profil değişmedikçe aynı referans. Oyun kapalı/yaratıcı/yönetici modda boş. */
export function useDecorLocks(): Record<string, DecorItem> {
  useEffect(() => { void ensureGameLoaded(); }, []);
  const profile = useGame((s) => s.profile);
  return useMemo(() => {
    if (locksOff(profile)) return NO_LOCKS;
    return Object.fromEntries((profile?.decor ?? []).filter((d) => !d.unlocked).map((d) => [d.id, d]));
  }, [profile]);
}
const NO_LOCKS: Record<string, DecorItem> = {};

/** S35 ofis dekoru kilidi (dünya yapıcı paleti): açıksa, bilinmiyorsa, oyun kapalıysa ya da yaratıcı modda null. */
export function usePropLock(paletteId: string): DecorItem | null {
  return useGame((s) => (locksOff(s.profile) ? null
    : s.profile?.decor?.find((d) => d.id === paletteId && !d.unlocked) ?? null));
}

function lockOf(id: string, locked: Record<string, LockedItem>): LockedItem | undefined {
  if (locked[id]) return locked[id];
  if (!id.includes(":")) {
    // "battlefield" gibi önek siz kimlik: önce sahne, sonra herhangi bir tür
    return locked[`scene:${id}`] ?? Object.values(locked).find((l) => l.id.endsWith(`:${id}`));
  }
  return undefined;
}

/** Kozmetik öğe ya da sahne kilidi açık mı. Bilinmeyen kimlikler açık sayılır. */
export function isUnlocked(id: string): boolean {
  const s = useGame.getState();
  const p = s.profile;
  if (locksOff(p)) return true; // kapalı, yaratıcı ya da yönetici/test modunda her şey açık
  return !lockOf(id, s.locked);
}

/** `isUnlocked`'ın tepkisel sürümü (kilit açılınca yeniden çizer). */
export function useUnlocked(id: string): boolean {
  return useGame((s) => (locksOff(s.profile) ? true : !lockOf(id, s.locked)));
}

/** Kilit bilgisi (fiyat, seviye şartı) — açık ya da bilinmeyen kimlikte null. */
export function useLockInfo(id: string): LockedItem | null {
  return useGame((s) => (locksOff(s.profile) ? null : lockOf(id, s.locked) ?? null));
}

/** Kilit tablosu (kararlı referans; profil yenilenince değişir) — sahne seçici gibi listeler için.
 *  S40: yönetici/test modunda boş (sabit referans) — avatar düzenleyici ve sahne seçici kilit göstermez. */
export function useGameLocks(): Record<string, LockedItem> {
  return useGame((s) => (s.profile?.admin === true ? NO_ITEM_LOCKS : s.locked));
}
const NO_ITEM_LOCKS: Record<string, LockedItem> = {};

// ------------------------------------------------------------------ hareket ve kutlama stili
export function prefersReducedMotion(): boolean {
  try { return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

const STYLE_KEY = "hs-celebration-style";
/** Kutlama stilleri; `label` şu anki dilde (getter). */
export const CELEBRATION_STYLES: { id: string; label: string; item?: string }[] = (
  [["confetti", undefined], ["hearts", "celebration:hearts"], ["balloons", "celebration:balloons"], ["fireworks", "celebration:fireworks"]] as const
).map(([id, item]) => ({ id, item, get label() { return tx(m, `style_${id}`); } }));
export function celebrationStyle(): string {
  try {
    const v = localStorage.getItem(STYLE_KEY) ?? "confetti";
    const def = CELEBRATION_STYLES.find((c) => c.id === v);
    return def && (!def.item || isUnlocked(def.item)) ? v : "confetti";
  } catch { return "confetti"; }
}
export function setCelebrationStyle(id: string) {
  try { localStorage.setItem(STYLE_KEY, id); } catch { /* yok say */ }
  useGame.setState((s) => ({ burst: { ...s.burst } }));
}

// ------------------------------------------------------------------ olay işleme (store.ts → registerEventHandler("game.", …))
function agentName(slug?: string | null): string {
  return (slug && useGame.getState().profile?.agents.find((a) => a.slug === slug)?.name) || slug || tx(m, "agent_fallback");
}

// S35 hız sınırı: küçük patlama en sık 6 sn'de bir, büyük 2 sn'de bir; aynı ses 1,5 sn içinde tekrar çalmaz
let lastBurst = 0;
function burst(big: boolean) {
  const s = useGame.getState();
  if (!s.profile?.celebrations) return;
  const now = Date.now();
  if (now - lastBurst < (big ? 2000 : 6000)) return;
  lastBurst = now;
  useGame.setState({ burst: { n: s.burst.n + 1, style: celebrationStyle(), big } });
}

function celebrate(c: Omit<Celebration, "id">) {
  const s = useGame.getState();
  if (!s.profile?.celebrations) return;
  useGame.setState({ celebrations: [...s.celebrations, { ...c, id: ++celebrationSeq }].slice(-5) });
}

export type GameCue = "levelup" | "achievement" | "coin";
let cueHandler: ((cue: GameCue) => void) | null = null;
/** GameLayer ses çalıcısını kaydeder (game.sounds + genel ses ayarına uyar). */
export function setGameCueHandler(fn: ((cue: GameCue) => void) | null) { cueHandler = fn; }
const lastCue: Partial<Record<GameCue, number>> = {};
function cue(c: GameCue) {
  if (!useGame.getState().profile?.sounds) return;
  const now = Date.now();
  if (now - (lastCue[c] ?? 0) < 1500) return;
  lastCue[c] = now;
  cueHandler?.(c);
}

/** İyimser güncelleme: ajan rozeti ve çubuğu hemen ilerlesin (odak modunda da; rozetler yine gizli kalır). */
function applyAgentXp(ev: StudioEvent) {
  const subject = String(ev.subject ?? "");
  if (Number(ev.amount ?? 0) <= 0 || !useGame.getState().agents[subject]) return;
  useGame.setState((s) => ({ agents: { ...s.agents, [subject]: { ...s.agents[subject], xp: Number(ev.total ?? 0),
    level: Number(ev.level ?? s.agents[subject].level), progress: Number(ev.progress ?? s.agents[subject].progress),
    xpToNext: Number(ev.xp_to_next ?? s.agents[subject].xpToNext) } } }));
}

/** S35 dünya kaplaması için son an: XP artışı ve seviye atlaması (kaplama "+N XP" ve halka parıltısı çizer). */
export interface SpotlightMoment { n: number; xp: number; levelUp: { who: string; level: number; office: boolean } | null }
export const useSpotlight = create<SpotlightMoment>(() => ({ n: 0, xp: 0, levelUp: null }));
function noteSpotlight(ev: StudioEvent) {
  const s = useSpotlight.getState();
  if (ev.type === "game.xp") {
    const amount = Number(ev.amount ?? 0);
    if (amount > 0) useSpotlight.setState({ n: s.n + 1, xp: amount, levelUp: null });
  } else if (ev.type === "game.levelup") {
    const office = ev.subject_type === "office";
    useSpotlight.setState({ n: s.n + 1, xp: 0, levelUp: { office, level: Number(ev.level ?? 0),
      who: office ? tx(m, "office") : ev.subject_type === "human" ? tx(m, "you") : String(ev.name ?? agentName(ev.agent as string)) } });
  }
}

/** `game.*` olaylarını depoya uygular. Oyunlaştırma kapalıyken hesap sürer ama görünür bir şey üretilmez. */
export function handleGameEvent(ev: StudioEvent) {
  const st = useGame.getState();
  useGame.setState({ pulse: st.pulse + 1 });
  scheduleGameRefresh();
  const p = st.profile;
  if (ev.type === "game.settings" || ev.type === "game.sync") return;
  scheduleScoreRefresh();
  if (!p?.enabled) return;
  if (ev.type === "game.xp" && ev.subject_type === "agent") applyAgentXp(ev);
  if (p.focus) return; // odak modu: hesap ve rozet verisi güncellenir, görünür kutlama/ses yok
  // DECB-FIX (karar 5): Akademi ders ödülünün XP/başarım bildirimi tanıtım kapısı açılana dek bekler (ödül zaten verildi)
  if (holdForIntro(ev, useIntroGate.getState().open)) { holdIntroEvent(ev); return; }
  if (ev.type === "game.xp" || ev.type === "game.levelup") noteSpotlight(ev);
  showGameEvent(ev);
}

// ------------------------------------------------------------------ tanıtım kapısı bekletmesi (karar 5)
const INTRO_HELD_MAX = 12;
const introHeld: StudioEvent[] = [];
let introWatch: (() => void) | null = null;
function holdIntroEvent(ev: StudioEvent) {
  if (introHeld.length < INTRO_HELD_MAX) introHeld.push(ev);
  introWatch ??= useIntroGate.subscribe((g) => { if (g.open) flushIntroEvents(); });
  refreshIntroGate(); // kapı henüz hesaplanmadıysa hesapla (zamanlayıcıyı kurar)
}
/** Kapı açılınca bekleyen akademi bildirimleri bir kez gösterilir (oyun kapalı ya da odak modundaysa atlanır). */
function flushIntroEvents() {
  introWatch?.();
  introWatch = null;
  // yürürken bekletme sürer (kutlama/bildirim yürüme bitince); kapı açıkken yürüme bitince bir kez boşaltılır
  if (useWalkPresence.getState().walking) {
    introWatch = useWalkPresence.subscribe((w) => { if (!w.walking) flushIntroEvents(); });
    return;
  }
  const held = introHeld.splice(0);
  if (!isGameVisible()) return;
  held.forEach((ev) => showGameEvent(ev));
}

/** Olayın görünür bildirimi/kutlaması (oyun açık, odak kapalı ve tanıtım kapısı denetimi yapılmış olmalı). */
function showGameEvent(ev: StudioEvent) {
  const lang = currentLocale();
  const push = useGame.getState().pushToast;
  switch (ev.type) {
    case "game.xp": {
      const amount = Number(ev.amount ?? 0);
      if (amount <= 0) break;
      const subject = String(ev.subject ?? "");
      const who = ev.subject_type === "human" ? tx(m, "you") : ev.subject_type === "agent" ? agentName(subject) : subject;
      push({ kind: "xp", key: `xp:${ev.subject_type}:${subject}`, title: `${who} +${amount} XP`, amount,
             text: xpReason(ev, lang) });
      break;
    }
    case "game.levelup": {
      const level = Number(ev.level ?? 0);
      if (ev.subject_type === "office") {
        celebrate({ kind: "office", title: tx(m, "office_levelup_title", { level }), text: tx(m, "office_levelup_text", { coins: Number(ev.coins ?? 0) }),
                    icon: "building-2", level, coins: Number(ev.coins ?? 0) });
        burst(true);
      } else {
        const who = ev.subject_type === "human" ? tx(m, "you") : String(ev.name ?? agentName(ev.agent as string));
        const title = String(ev.title ?? "");
        push({ kind: "levelup", key: `lv:${ev.subject_type}:${ev.subject}`, icon: "star",
               title: ev.subject_type === "human" ? tx(m, "levelup_you_title", { level }) : tx(m, "levelup_other_title", { who, level }),
               text: ev.subject_type === "human" ? tx(m, "levelup_you_text", { title })
                 : `${tx(m, "levelup_other_text", { title })}${ev.coins ? tx(m, "plus_coins", { n: Number(ev.coins) }) : ""}` });
        burst(false);
      }
      cue("levelup");
      break;
    }
    case "game.achievement": {
      const rarity = (ev.rarity as Rarity) ?? "common";
      const loc = achievementText(ev, lang);
      const title = loc.name || tx(m, "achievement_fallback");
      // "Sen"/"Ofis" sunucuda Türkçe; arayüz dilinde yazılır
      const who = ev.subject_type === "human" ? tx(m, "you") : ev.subject_type === "office" ? tx(m, "office") : String(ev.who ?? "");
      if (rarity === "epic" || rarity === "legendary") {
        celebrate({ kind: "achievement", title, text: loc.description, icon: String(ev.icon ?? "trophy"),
                    rarity, coins: Number(ev.coins ?? 0) });
        burst(true);
      } else {
        push({ kind: "achievement", key: `ach:${String(ev.achievement ?? title)}:${who}`, icon: String(ev.icon ?? "trophy"), rarity,
               title: tx(m, "achievement_toast_title", { title }),
               text: `${who ? `${who} · ` : ""}${RARITY_LABEL[rarity]}${ev.coins ? tx(m, "plus_coins", { n: Number(ev.coins) }) : ""}` });
      }
      cue("achievement");
      break;
    }
    case "game.quest":
      if (ev.status === "done") {
        push({ kind: "quest", key: "quest", icon: "scroll-text", title: tx(m, "quest_done_title"),
               text: tx(m, "quest_done_text", { title: String(ev.title ?? "") }) });
        cue("coin");
      }
      break;
    case "game.unlock": {
      // iki dilde ad (sunucu `store:*` kimliği yerine parça adını yollar); ham kimlik yalnız son çare
      const unlockLabel = String((currentLocale() === "en" ? ev.label_en : ev.label_tr) ?? ev.label ?? ev.item);
      if (ev.kind === "consumable") {
        celebrate({ kind: "treat", title: String(ev.label ?? tx(m, "treat_fallback")), text: tx(m, "treat_text"), icon: "party-popper" });
        burst(true);
      } else {
        push({ kind: "unlock", key: `unlock:${ev.item}`, icon: "lock-open", title: tx(m, "unlock_title", { label: unlockLabel }),
               text: ev.source === "level" ? tx(m, "unlock_by_level") : ev.source === "achievement" ? tx(m, "unlock_by_achievement") : undefined });
      }
      cue("coin");
      break;
    }
  }
}
