// G1-A — yerel ölçüm defteri ve kuzey yıldızı (/api/metrics). Hesaplar yalnız bu bilgisayarda; ağ çağrısı yok.
// Payda 0 olduğunda değer `null` ve etiket "undefined" gelir: arayüz bunu SIFIR gibi göstermez.
import { currentLocale } from "./i18n";
import { bodyText } from "./api";
import type { StripData } from "./usageStrip";

export type MetricsWindow = "7d" | "28d" | "all";
export type Undefinable = "undefined" | "subscription_local" | null;

export interface MetricsSummary {
  window: { key: MetricsWindow; start: string | null; end: string; day_start_hour: number };
  /** WAD: G1-C sonucu `accepted` olan, yerine yenisi gelmemiş son sürüm. `partial` ayrı sayılır. */
  north_star: { wad: number; week: string; valuable_weeks_total: number; partial_week: number; partial_window: number };
  accepted: number;
  tpa: {
    value: number | null;
    label: Undefinable;
    tokens: number;
    breakdown: { input: number; output: number; cache_read: number; cache_write: number };
    cache_split: "measured" | "partial" | "unknown";
    contributors: Record<string, number>;
    /** Σ önbellekten okunan / Σ girdi; sağlayıcı bildirmediyse `ratio: null`, `label: "not_measured"`.*/
    cache_hit?: { ratio: number | null; label: "not_measured" | null; measured: number };
  };
  cpa: { value: number | null; label: Undefinable; cost_usd: number; basis: Record<string, number> };
  task_success: {
    started: number; mature: number; maturing: number; accepted: number; rate: number | null; label: Undefinable;
    not_accepted: { cancelled: number; budget_stop: number; technical_failure: number; other: number };
  };
  correction_load: { revisions: number; per_accept: number | null; label: Undefinable };
  personal_windows: { first_accept_at: string | null; repeat_14d: boolean | null; w1: boolean | null; w4: boolean | null };
  reliability: { interrupted: number; missing_artifacts: number; unknown_effects: number };
  budget: { overruns: number };
  privacy: { local_only: true; network: false; retention_days: number; events: number };
}

export interface Dist { n: number; p50: number | null; p95: number | null; p99: number | null; max: number | null; top5_share: number | null }
export interface CostDistribution { window: MetricsWindow; families: { family: string; tokens: Dist; cost_usd: Dist }[] }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = bodyText(res.status, j); } catch { /* boş */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const metricsApi = {
  /** ana ekran şeridi; kaynağı olmayan alan null gelir (sıfır uydurulmaz).*/
  strip: (window: MetricsWindow = "7d") => req<StripData>("GET", `/api/metrics/strip?window=${window}`),
  summary: (window: MetricsWindow = "7d") => req<MetricsSummary>("GET", `/api/metrics/summary?window=${window}`),
  costDistribution: (window: MetricsWindow = "all") =>
    req<CostDistribution>("GET", `/api/metrics/cost-distribution?window=${window}`),
  setRetention: (days: number) => req<{ retention_days: number }>("PUT", "/api/metrics/retention", { days }),
  /** Kullanıcıya ait: MCP ve jetonsuz yerel süreçler 403 alır. */
  erase: () => req<{ ok: boolean; deleted: number }>("DELETE", "/api/metrics"),
};

/** Token sayısını kısa biçimde yazar (1 250 → "1,3 B" / "1.3K"). */
export function compactTokens(n: number): string {
  const loc = currentLocale() === "en" ? "en-US" : "tr-TR";
  return new Intl.NumberFormat(loc, { notation: "compact", maximumFractionDigits: 1 }).format(Math.round(n));
}

export function usd(n: number): string {
  const loc = currentLocale() === "en" ? "en-US" : "tr-TR";
  const digits = n > 0 && n < 0.1 ? 4 : 2;
  return new Intl.NumberFormat(loc, { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(n);
}
