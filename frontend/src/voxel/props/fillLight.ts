/**
 * dolgu ışığı. Güneşe sırtı dönük ve aşağı bakan yüzler (kiosk/pano/bina arkası, durak çatısının alt
 * yüzü) yalnız hemisfer ışığı alıyordu; koyu boyalı bir yüzde bu simsiyah bir dikdörtgen olarak okunuyordu (<city>, <city>,
 * <city> doğma karelerinde "anlamsız kiosk", durak çatısı altında siyah üçgen). Dolgu: güneşin TERSİ yönden ve biraz alttan gelen,
 * gölgesiz, güneş şiddetinin `FILL_K`'sı kadar bir yön ışığı — yalnız güneşe sırtı dönük yan yüzleri ve alt yüzleri aydınlatır;
 * güneş yüzü ve gölgeler değişmez. Gece (nightLit) ve gece sahneleri (def.night) kendi tabanlarını kullanır → dolgu yok.
 * Güneş hedefinin çocuğu olarak konur (SunFollow hedefi kaydırınca yön sabit kalır). Saf: node testi uxfix5_light.test.mjs.
*/
export const FILL_K = 0.3;
/** Opak blok malzemesinin ışıktan bağımsız taban parlaklığı (doğrusal, `emissive`): 0,016 ≈ sRGB 0,14. Albedoya çarpılmaz — koyu
 *  boyalı gölge yüz (albedo ≈ 0,05 × ~0,3 ışık ≈ sRGB 0,13) simsiyah okunuyordu; taban yalnız onu "koyu gri/slate" yapar. */
export const AMBIENT_FLOOR = 0.016;
/** alt yönde eğim: güneş yüksekliğinin bu kesri kadar AŞAĞIDAN (alt yüzler de ışık alsın). */
export const FILL_DROP = 0.3;

export interface FillLight { pos: [number, number, number]; intensity: number }

/** `sun`: gündüz güneş konumu (hedefe göre), `intensity`: güneş şiddeti. Gece ya da güneşsiz ise null. */
export function fillLight(sun: readonly [number, number, number], intensity: number, night: boolean): FillLight | null {
  if (night || !(intensity > 0)) return null;
  return { pos: [-sun[0], -Math.abs(sun[1]) * FILL_DROP, -sun[2]], intensity: intensity * FILL_K };
}

/** Yön ışığı vektörü (ışığa doğru) `n` yüz normalinde ne kadar ışık verir (Lambert, 0–1). */
export function fillLambert(pos: readonly [number, number, number], n: readonly [number, number, number]): number {
  const l = Math.hypot(pos[0], pos[1], pos[2]) || 1;
  return Math.max(0, (pos[0] * n[0] + pos[1] * n[1] + pos[2] * n[2]) / l);
}
