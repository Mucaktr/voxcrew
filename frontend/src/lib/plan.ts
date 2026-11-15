// paket (hak motoru) istemcisi: /api/plan/*, kadro değişimi ve sınır kartı deposu.
// Ödeme, giriş ve ağ yok: satın alma düğmeleri "Yakında" (purchase.available=false).
import { create } from "zustand";
import { TEST_PLAN_URL } from "../full/planIds";
import { ApiError, bodyDetail, bodyText } from "./api";
import { currentLocale } from "./i18n";
import { asDecision, emptyMemo, openCard, shouldOpen, type CardModel, type PlanDecision, type SessionMemo } from "./planLimit";
import { registerEventHandler, useStudio } from "./store";

export type { PlanDecision } from "./planLimit";

export interface PlanSnapshot {
  plan: string;
  source: "default" | "test" | "founder" | "token" | "admin";
  base: string;
  seats: { limit: number | null; used: number; benched: number; free: number | null };
  limits: Record<string, number | null>;
  usage: Record<string, number>;
  features: {
    delegate: boolean; season_premium: boolean; scene_packs: string; hero_packs: string;
    /** 2026-10-19: etkin özellik paketleri ve sandık hakkının katmanı */
    packs?: string[]; chests?: string;
  };
  license: { state: string; exp?: number | null; grace_days_left?: number | null };
  trial: boolean;
  founder: { founder: boolean; seats: number | null; decided_at?: string };
  admin: { available: boolean; active: boolean };
  test_plan: { available: boolean; value: string | null; options: string[]; env: string };
  checkpoints: { id: string; feature: string; spec: string; enforced: boolean; note: string }[];
  never_gated: string[];
  purchase: { available: boolean; via?: string };
}

export interface CompareTable {
  version: number;
  plans: { id: string; seats: number; price_month: number; price_year: number; tagline: string }[]; // fiyat alanları yalnız tam sürümde gelir; free sürümde okunmaz
  rows: { key: string; label: string; values: Record<string, string> }[];
  never_gated: string[];
  source_note: string;
  /** 2026-10-19 özellik paketleri ("kurgular") ve üyelik sandıkları; jeton satılmaz */
  feature_packs?: { id: string; kind: "content" | "tool"; label: string; description: string; enforced: boolean;
    plans: string[]; addon: boolean }[];
  chests?: Record<string, { monthly: number; tier_up: boolean }>;
  coins_for_sale?: false;
}

export interface RosterAgent {
  slug: string;
  name: string;
  title: string;
  color?: string;
  avatar?: unknown;
  hero?: string | null;
  team?: string | null;
  busy: boolean;
  last_used?: string | null;
}

export interface Roster {
  plan: string;
  source: string;
  limit: number | null;
  used: number;
  free: number | null;
  active: RosterAgent[];
  bench: RosterAgent[];
  locked: boolean;
}

/** Hata gövdesini (detail) taşıyan ApiError: sınır kartı kararı buradan okur. */
export class PlanApiError extends ApiError {
  constructor(status: number, message: string, detail: unknown) {
    super(status, message, detail);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = bodyText(res.status, null);
    let detail: unknown = null;
    try {
      const j = await res.json();
      detail = bodyDetail(j);
      msg = bodyText(res.status, j);  // detail.message ya da bilinen kod; asla ham JSON
    } catch { /* gövde yok */ }
    throw new PlanApiError(res.status, msg, detail);
  }
  return res.json() as Promise<T>;
}

export const planApi = {
  get: () => req<PlanSnapshot>("GET", "/api/plan"),
  compare: () => req<CompareTable>("GET", "/api/plan/compare"),
  roster: () => req<Roster>("GET", "/api/plan/roster"),
  check: (feature: string) => req<PlanDecision>("GET", `/api/plan/check?feature=${encodeURIComponent(feature)}`),
  bench: (slug: string) => req<Roster>("POST", "/api/plan/seats/bench", { slug }),
  activate: (slug: string) => req<Roster>("POST", "/api/plan/seats/activate", { slug }),
  swap: (activate: string, bench: string) => req<Roster>("POST", "/api/plan/seats/swap", { activate, bench }),
  // EDITION1: test paketi ucu yalnız tam sürümde (free sürümde plan Ücretsiz'e sabit; anlık görüntüde test_plan.available hep false)
  setTestPlan: (plan: string | null) => (TEST_PLAN_URL ? req<PlanSnapshot>("POST", TEST_PLAN_URL, { plan }) : Promise.reject(new Error("test plan unavailable"))),
};

/** Herhangi bir hatadan paket kararı (ApiError.detail ya da eski JSON ileti). */
export function decisionOf(err: unknown): PlanDecision | null {
  if (err instanceof ApiError && err.detail && typeof err.detail === "object") return asDecision(err.detail);
  if (err instanceof Error) {
    try {
      return asDecision(JSON.parse(err.message));
    } catch {
      return null;
    }
  }
  return null;
}

// ------------------------------------------------------------------ sınır kartı deposu (oturum belleği)
const MEMO_KEY = "vc-plan-limit-memo";

function readMemo(): SessionMemo {
  try {
    const raw = sessionStorage.getItem(MEMO_KEY);
    const j = raw ? (JSON.parse(raw) as SessionMemo) : null;
    if (j && Array.isArray(j.seen)) return { seen: j.seen, upsellShown: Boolean(j.upsellShown) };
  } catch { /* gizli pencere vb. */ }
  return emptyMemo();
}

function writeMemo(memo: SessionMemo): void {
  try { sessionStorage.setItem(MEMO_KEY, JSON.stringify(memo)); } catch { /* yok say */ }
}

interface LimitStore {
  decision: PlanDecision | null;
  card: CardModel | null;
  /** Kullanıcı eyleminden doğan sınır: oturumda bir kez kendiliğinden açılır (`explicit` her zaman açar). */
  notify: (d: PlanDecision, explicit?: boolean) => boolean;
  dismiss: () => void;
}

function anyRunning(): boolean {
  try {
    return Object.values(useStudio.getState().runs).some((r) => r.status === "running");
  } catch {
    return false;
  }
}

export const useLimitCard = create<LimitStore>((set) => ({
  decision: null,
  card: null,
  notify: (d, explicit = false) => {
    const memo = readMemo();
    if (!shouldOpen(d, memo, explicit)) return false;
    const out = openCard(d, memo, { running: anyRunning() });
    writeMemo(out.memo);
    set({ decision: d, card: out.card });
    return true;
  },
  dismiss: () => set({ decision: null, card: null }),
}));

/** Kolaylık: hata bir paket kararıysa kartı açar ve true döner (çağıran kendi hata metnini göstermez). */
export function notifyLimitFromError(err: unknown): boolean {
  const d = decisionOf(err);
  if (!d) return false;
  useLimitCard.getState().notify(d);
  return true;
}

// ------------------------------------------------------------------ paket özeti deposu
interface PlanStore {
  snapshot: PlanSnapshot | null;
  roster: Roster | null;
  error: string | null;
  refresh: () => Promise<void>;
  setRoster: (r: Roster) => void;
}

export const usePlan = create<PlanStore>((set) => ({
  snapshot: null,
  roster: null,
  error: null,
  refresh: async () => {
    try {
      const [snapshot, roster] = await Promise.all([planApi.get(), planApi.roster()]);
      set({ snapshot, roster, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
  setRoster: (roster) => set({ roster }),
}));

let wired = false;
/** SSE: kadro ya da paket değişince özet tazelenir (tek kez bağlanır). */
export function wirePlanEvents(): void {
  if (wired) return;
  wired = true;
  const again = () => { if (usePlan.getState().snapshot || usePlan.getState().roster) void usePlan.getState().refresh(); };
  registerEventHandler("seat.", again);
  registerEventHandler("plan.", again);
}

/** Yeni ajan yedekte doğdu (E1): koltuk kararı sınır kartına (oturumda bir kez) ve kadro tazelenir. */
export async function notifyBenched(_name: string): Promise<void> {
  try {
    const d = await planApi.check("seats");
    if (!d.allowed) useLimitCard.getState().notify({ ...d, code: "plan_limit" });
  } catch { /* kart gösterilemezse kadro paneli yine yedeği gösterir */ }
  void usePlan.getState().refresh();
}
