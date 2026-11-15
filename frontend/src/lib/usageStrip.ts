// ana ekran kullanım şeridi: saf biçimlendirme (içe aktarma yok; node --test doğrudan çalıştırır).
// Veri GET /api/metrics/strip'ten; kaynağı olmayan değer null gelir ve burada hiçbir zaman "0" diye yazılmaz.
export type Loc = "tr" | "en";
const tag = (l: Loc) => (l === "tr" ? "tr-TR" : "en-US");

/** "$1.879,93" / "$1,879.93"; 1 sentten küçük tutar 4 hane ("$0,0042"). */
export function fmtUsd(n: number, l: Loc = "tr"): string {
  const d = n > 0 && n < 0.01 ? 4 : 2;
  return n.toLocaleString(tag(l), { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Token: 842 · "12,4 bin" · "9041,9 Mn" · "1,2 Mr" (EN: K / M / B). Binlik ayracı yok: "9041,9 Mn". */
export function fmtTokens(n: number, l: Loc = "tr"): string {
  const f = (v: number) => v.toLocaleString(tag(l), { minimumFractionDigits: 0, maximumFractionDigits: 1, useGrouping: false });
  const u = l === "tr" ? { k: " bin", m: " Mn", b: " Mr" } : { k: "K", m: "M", b: "B" };
  if (n < 1000) return Math.round(n).toLocaleString(tag(l));
  if (n < 1e6) return f(n / 1e3) + u.k;
  if (n < 1e12) return f(n / 1e6) + u.m;
  return f(n / 1e9) + u.b;
}

/** Süre: "45 sn" · "10 dk 49 sn" · "14 sa 15 dk" · "2 gün 3 sa" (EN: 45s · 10m 49s · 14h 15m · 2d 3h). Üst iki birim. */
export function fmtDuration(seconds: number, l: Loc = "tr"): string {
  const s = Math.max(0, Math.round(seconds));
  const u = l === "tr" ? { d: "gün", h: "sa", m: "dk", s: "sn", sp: " " } : { d: "d", h: "h", m: "m", s: "s", sp: "" };
  const j = (a: number, ua: string, b: number, ub: string) => `${a}${u.sp}${ua} ${b}${u.sp}${ub}`;
  if (s < 60) return `${s}${u.sp}${u.s}`;
  if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return r ? j(m, u.m, r, u.s) : `${m}${u.sp}${u.m}`; }
  if (s < 86400) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return m ? j(h, u.h, m, u.m) : `${h}${u.sp}${u.h}`; }
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return h ? j(d, u.d, h, u.h) : `${d}${u.sp}${u.d}`;
}

/** "az önce" · "14 dk önce" · "2 sa önce" · "3 gün önce". */
export function fmtAgo(ms: number, l: Loc = "tr"): string {
  const m = Math.floor(Math.max(0, ms) / 60000);
  const tr = l === "tr";
  if (m < 1) return tr ? "az önce" : "just now";
  if (m < 60) return tr ? `${m} dk önce` : `${m} min ago`;
  if (m < 1440) return tr ? `${Math.floor(m / 60)} sa önce` : `${Math.floor(m / 60)} h ago`;
  return tr ? `${Math.floor(m / 1440)} gün önce` : `${Math.floor(m / 1440)} d ago`;
}

export interface StripData {
  window: "7d" | "28d" | "all";
  turns: number;
  cost: { basis: "metered" | "local" | "subscription" | null; usd: number | null; last_usd: number | null; avg_usd: number | null; spark: number[] };
  tokens: { total: number | null };
  agent_time: { seconds: number | null; avg_seconds: number | null; runs: number };
  tests: { status: "passed" | "warn" | "failed" | null; at: number | null };
}

/** Küçük çubuk grafiğin ekran okuyucu özeti: tur sayısı, son ve en yüksek tutar. */
export function sparkSummary(spark: number[], l: Loc = "tr"): string {
  if (!spark.length) return "";
  const last = spark[spark.length - 1], max = Math.max(...spark);
  return l === "tr"
    ? `Son ${spark.length} turun maliyeti: son tur ${fmtUsd(last, l)}, en yüksek ${fmtUsd(max, l)}`
    : `Cost of the last ${spark.length} turns: latest ${fmtUsd(last, l)}, highest ${fmtUsd(max, l)}`;
}
