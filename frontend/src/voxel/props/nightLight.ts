/**
 * UXF-G — gece ışığı tabanı. Akşam saatinde (≥ 19.00) Londra, <city>, <city>, <city> ve <city>'da zemin ve avatar
 * siyaha yakındı: eski gece hemisfer ışığı `def.hemi[2] × 0,32` ve MAVİ gök rengi (#8EA2FF) turuncu/kahverengi yüzeyleri yutuyordu
 * (avatar ≈ %1 parlaklık, gündüzün 1/25'i). Yeni taban: nötre yakın soğuk gök rengi, yan yüzler için daha açık zemin rengi ve
 * en az `NIGHT_HEMI_MIN` şiddet; gündüz ışığı (ve `def.night` sahneleri: kamp, uzay) değişmez.
 * Saf: node testi frontend/scripts/uxfg_night.test.mjs. Ölçüt (WCAG göreli parlaklık): avatar gömleği/zemin gecede gündüzün
 * en az %12'si ve zeminle ≥ 1,5 : 1; gece saf siyah zemin bile ≥ 3 : 1 değil ama okunur (bkz. `NIGHT_TARGET`).
*/
export const NIGHT_HEMI_SKY = "#B4C2F0";
export const NIGHT_HEMI_GROUND = "#4A5578";
/** Eski çarpan (gündüz şiddetinin payı) ve en düşük şiddet. */
export const NIGHT_HEMI_K = 0.32;
export const NIGHT_HEMI_MIN = 1.0;
/** Hedef: gece/gündüz parlaklık oranı alt sınırı (Lambert modeli, yukarı bakan yüzey). */
export const NIGHT_TARGET = { minRatioToDay: 0.12, minAvatarLuminance: 0.05 } as const;

export type HemiArgs = [sky: string, ground: string, intensity: number];

/** Gece hemisfer ışığının argümanları; `base` sahnenin gündüz hemisfer şiddeti (`def.hemi[2]`). Kapalı mekânlar (ofis, ev, kafe, AVM,
 *  uzay, iç mekân) eski loş ışığı korur: orada masa/ayaklı lambalar odayı aydınlatır (voxel/props/Props.tsx). */
export function nightHemiArgs(base: number, indoor = false): HemiArgs {
  if (indoor) return ["#8EA2FF", "#1A1F33", base * NIGHT_HEMI_K];
  return [NIGHT_HEMI_SKY, NIGHT_HEMI_GROUND, Math.max(base * NIGHT_HEMI_K, NIGHT_HEMI_MIN)];
}

const lin = (c: number): number => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** WCAG göreli parlaklık (0–1) */
export function relLuminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/**
 * Lambert yaklaşımı: yukarı bakan yüzeyin hemisfer ışığı altındaki doğrusal RGB'si × göreli parlaklığı.
 * `up` 1 = tam yukarı (zemin), 0 = yan (avatar gövdesi), kanal başına albedo · (zemin + (gök − zemin) · (0,5 + 0,5 up)) · şiddet.
 * Kesin render değil; gün/gece ve sahneler arası KARŞILAŞTIRMA içindir.
 */
export function litLuminance(albedo: string, sky: string, ground: string, intensity: number, up = 0.5): number {
  const a = rgb(albedo).map(lin), s = rgb(sky).map(lin), g = rgb(ground).map(lin);
  const w = 0.5 + 0.5 * up;
  const c = a.map((al, i) => Math.min(1, al * (g[i] + (s[i] - g[i]) * w) * intensity));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const contrastRatio = (l1: number, l2: number): number => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
