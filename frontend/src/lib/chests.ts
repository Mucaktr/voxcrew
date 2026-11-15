// 2026-10-19 — üyelik sandıkları istemcisi (backend/studio/game/chests.py). İçerik AÇMADAN ÖNCE bellidir (aylık "3'ten 1 seç",
// yükselme sandığı sabit set). Satın alma, jetonla açma ve yeniden çekme yolu yoktur: tek yazma çağrısı `open`.
import { GameApiError } from "./game";
import { currentLocale } from "./i18n";
import { bodyText } from "./api";

export type ChestItemKind = "decor" | "skin" | "variant" | "material" | "celebration" | "plaque";
export interface ChestOption { item: string; kind: ChestItemKind; label: string; owned: boolean }
export interface Chest {
  id: string;
  kind: "monthly" | "tier_up";
  tier: string;
  period: string;
  mode: "choose" | "fixed";
  granted_at: number | null;
  options: ChestOption[];
  opened_at: number | null;
  chosen: string | null;
  items: ChestOption[];
  preview: boolean;
}
export interface ChestData {
  month: string;
  membership: { plan: string; source: string; tier: string; monthly: number; tier_up: boolean; persist: boolean };
  chests: Chest[];
  unopened: number;
  preview: Chest[];
  next_month: { month: string; sets: ChestOption[][] };
  tier_up_sets: Record<string, ChestOption[]>;
  rules: {
    contents_known: true; purchasable: false; coin_open: false; reroll: false; random: false; duplicates: false;
    expires: false; cosmetic_only: true;
  };
  free_alternative: "surprise_box";
}

async function req<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Studio-Lang": currentLocale() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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

export const chestApi = {
  get: () => req<ChestData>("GET", "/api/game/chests"),
  /** Sandığı açar; aylık sandıkta `choice` gösterilen üç öğeden biridir. Bedel, jeton ya da yeniden çekme parametresi yok. */
  open: (id: string, choice?: string) =>
    req<{ ok: boolean; already?: boolean; chest: Chest }>("POST", `/api/game/chests/${encodeURIComponent(id)}/open`,
      choice ? { choice } : {}),
};

/** "2026-10" → "Ekim 2026" (yerel). */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString(currentLocale() === "en" ? "en-GB" : "tr-TR",
    { month: "long", year: "numeric" });
}
