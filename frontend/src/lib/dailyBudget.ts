// Karar 13 — günlük toplam bütçe tavanı istemcisi (backend: studio/workflow/daily_api.py, /api/budget/daily).
// Okuma herkese açık; yazma (tavan ve "bugün için yükselt") kullanıcıya aittir: arayüz jetonu lib/presence.ts
// sarmalayıcısıyla otomatik eklenir, MCP 403 alır.
import { ApiError, bodyText } from "./api";
import { currentLocale } from "./i18n";

export interface DailyCap { cost_usd: number | null; tokens: number | null }

export interface DailyBudgetStatus {
  enabled: boolean;
  day: string;
  cap: DailyCap;
  effective: DailyCap;
  raised: DailyCap | null;
  spent: { cost_usd: number; tokens: number };
  reached: boolean;
  metric: "cost_usd" | "tokens" | null;
  resets_at: number;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = bodyText(res.status, null);
    try {
      const j = await res.json();
      msg = bodyText(res.status, j);
    } catch { /* gövde yok */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const dailyBudgetApi = {
  status: () => req<DailyBudgetStatus>("GET", "/api/budget/daily"),
  save: (cap: DailyCap) => req<DailyBudgetStatus>("PUT", "/api/budget/daily", cap),
  raiseToday: (cap?: Partial<DailyCap>) => req<DailyBudgetStatus>("POST", "/api/budget/daily/raise", cap ?? {}),
};

/** Metrik başına kullanım oranı (tavan yoksa null). */
export function dailyRatio(s: DailyBudgetStatus, metric: "cost_usd" | "tokens"): number | null {
  const lim = s.effective[metric];
  if (lim == null) return null;
  const used = s.spent[metric] ?? 0;
  return lim > 0 ? used / lim : used > 0 ? 2 : 0;
}
