// DASH-MVP — metre (bullet bar) eşikleri, saf: %80'de uyarı, %100'de aşım (DailyBudgetBar'ın eski mantığıyla aynı).
// Node testi: frontend/scripts/board_logic.test.mjs.
export type MeterLevel = "ok" | "warn" | "bad";
export const METER_WARN = 0.8;

export function meterLevel(ratio: number): MeterLevel {
  if (!Number.isFinite(ratio)) return "bad";
  return ratio >= 1 ? "bad" : ratio >= METER_WARN ? "warn" : "ok";
}

/** 0–100 arası tam sayı (çubuk genişliği ve aria-valuenow); taşma 100'de kesilir, gerçek oran metinde yazılır. */
export function meterPct(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.min(100, Math.round(ratio * 100));
}
