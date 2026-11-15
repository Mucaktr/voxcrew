// sezon yolu ve sürpriz teslim kutusu istemcisi (backend/studio/game/{season,surprise}.py).
// Para yolu yok: premium "pakete dahil" ya da "yakında"; kutu yalnız ücretsiz açılır (yeniden çekme yok).
import { GameApiError, type Rarity } from "./game";
import { currentLocale, fmtDate } from "./i18n";
import { bodyText } from "./api";

export type SeasonRewardKind = "coins" | "badge" | "desk" | "outfit" | "celebration" | "sign" | "scene";
export interface SeasonReward {
  tier: number; kind: SeasonRewardKind; label: string; item: string | null; coins: number | null;
  granted: boolean; owned: boolean;
}
export interface SeasonTier { tier: number; reached: boolean; free: SeasonReward | null; premium: SeasonReward | null }
export interface SeasonInfo {
  id: string; number: number; name: string; theme: string; starts_on: string; ends_on: string; weeks: number; week?: number;
}
export interface SeasonPremium {
  active: boolean; source: string | null; view_only: boolean; included_in: string; purchase: { available: false };
}
export interface SeasonData {
  status: "active" | "ended" | "upcoming";
  season: SeasonInfo;
  tiers: number; tier_sp: number;
  sp?: number; tier?: number; next_tier_sp?: number | null;
  track?: SeasonTier[];
  weekly: { cap: number; week: string; used: number };
  sources: { source: string; sp: number; daily_cap: number | null; label: string }[];
  premium: SeasonPremium;
  archive: { season: string; name: string; items: { item: string; label: string; kind: SeasonRewardKind; tier: number; owned: boolean }[] }[];
  latecomer: { item: string; season: string; tier: number; label: string; progress: number; target: number; status: "pending" | "active" | "done" }[];
  recent: { ts: number; source: string; amount: number; raw: number; label: string }[];
}

export type BoxRarity = Extract<Rarity, "common" | "rare" | "epic">;
export interface SurpriseBoxItem {
  id: string; quest: string; earned_at: number; opened_at: number | null; item: string | null; label: string | null;
  rarity: BoxRarity | null; odds_at_open: Record<BoxRarity, number> | null;
}
export interface SurpriseData {
  base_odds: Record<BoxRarity, number>;
  odds: Record<BoxRarity, number>;
  pool: Record<BoxRarity, number>;
  pool_empty: boolean;
  boxes: SurpriseBoxItem[];
  unopened: number;
  rules: { free: true; purchasable: false; coin_open: false; reroll: false; duplicates: false };
}

async function req<T>(method: "GET" | "POST", url: string): Promise<T> {
  const res = await fetch(url, { method, headers: { "X-Studio-Lang": currentLocale() } });
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

/** kazanılan sezon öğeleri ve kutu masa süsleri (dünyada henüz çizilmiyor; `rendered: false`).*/
export interface CollectionItem {
  id: string; label: string; kind: string; rarity: BoxRarity | null; origin: "season" | "surprise";
  season: string | null; track: "free" | "premium" | null; source: string; acquired_at: number; rendered: boolean;
}
export interface CollectionData { items: CollectionItem[]; count: number }

export const seasonApi = {
  season: () => req<SeasonData>("GET", "/api/game/season"),
  collection: () => req<CollectionData>("GET", "/api/game/collection"),
  surprise: () => req<SurpriseData>("GET", "/api/game/surprise"),
  /** Kazanılmış ücretsiz kutuyu açar; gövde yok (bedel, jeton, yeniden çekme parametresi yok). */
  open: (box: string) => req<{ ok: boolean; already?: boolean; box: SurpriseBoxItem }>(
    "POST", `/api/game/surprise/${encodeURIComponent(box)}/open`),
};

/** "2026-12-13" → yerel tarih (UTC kayması olmadan). */
export function seasonDate(iso: string): string {
  const [y, mo, d] = iso.split("-").map(Number);
  return fmtDate(new Date(y, (mo || 1) - 1, d || 1), { day: "numeric", month: "long", year: "numeric" });
}
