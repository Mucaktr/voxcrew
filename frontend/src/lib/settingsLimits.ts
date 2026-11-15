// Ayarlar sayısal alan sınırları. Sunucu aynı değerleri uygular (backend/studio/settings_limits.py); burası
// yazarken uyarır ve geçersizken Kaydet'i durdurur. Saf modül (içe aktarma yok): node --test sınar.

export type NumKey = "num_ctx" | "max_turns" | "step_timeout_min" | "concurrency";

export const NUM_LIMITS: Record<NumKey, { min: number; max: number }> = {
  num_ctx: { min: 512, max: 1_048_576 },
  max_turns: { min: 1, max: 500 },
  step_timeout_min: { min: 1, max: 1440 },
  concurrency: { min: 1, max: 8 },
};

/** Değer sınırlar içinde bir tam sayı mı? (NaN, ondalık, -5, 99999999999 değil) */
export function numOk(key: NumKey, v: unknown): boolean {
  const { min, max } = NUM_LIMITS[key];
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/** Giriş kutusu metni → sayı; boş ya da sayı olmayan metin NaN (0'a düşmez). */
export function parseNum(raw: string): number {
  return raw.trim() === "" ? NaN : Number(raw);
}
