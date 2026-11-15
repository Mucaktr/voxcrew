/**
 * COURTYARD-PORTAL (ürün sahibi 2026-10-31: "Sultanahmet bahçesine kapıdan giremiyorsun. Duvarın içinden geçerek giriyorsun … bahçeye
 * giriş portal şeklinde olmalı. Geçiş yapılınca bahçe avlusu ve karakter boyutu gerçeğe yakın olmalı.") — duvarla çevrili simge
 * avlularının (cami, saray, kale, tapınak alanı) kaydı. Saf veri (React/three yok).
 *
 * Dışarıda avlu AYRI bir yer değil artık kapalıdır: avlu dikdörtgeni (`rect`, duvarlar dahil) yürünmez (şehirde `T_WALL`, taban
 * sahnede engelli), avlu kapısının önündeki karo bir PORTALDIR (şehirde landmark `door` + `interior: "courtyard"`, taban sahnede keşif
 * kataloğunda `kind: "courtyard"` yeri). Portaldan iç mekân sistemiyle (interiors/generate.ts `COURT_RECIPES`) gerçek ölçekli avlu
 * sahnesine geçilir; çıkışta kapının önüne, dışarı bakarak dönülür. Kutsal yerde yalnız dış cephe + avlu: sessiz bölge, gece ışık
 * gösterisi, sembol, bayrak ve yazı yok.
 *
 * Ölçek: yürüme ölçeği insan boyu 1,0 ≈ 1,75 m. Avlu sahnesinde cephenin (kubbe/çatı tepesi) avatar boyuna oranı türün gerçekçi
 * alt sınırını (`FACADE_MIN`) geçmelidir (denetim `scripts/courtyard_check.mjs` COURT-SCALE-001).
*/
import { FULL_COURTYARDS } from "../../full/courtyards";

export type PrecinctType = "mosque" | "palace" | "castle" | "temple" | "garden";

/** Cephe yüksekliği / avatar boyu alt sınırı (gerçek: Sultanahmet kubbesi 43 m ≈ 24,6; Topkapı Babüsselam kuleleri ~ 15 m ≈ 8,6). */
export const FACADE_MIN: Readonly<Record<PrecinctType, number>> = { mosque: 15, palace: 6, castle: 6, temple: 6, garden: 15 };
/** Gerçek metre → yürüme birimi. */
export const M = 1 / 1.75;

export interface CourtyardMap {
  /** avlu dikdörtgeni (landmark yerel [a, b, w, d]; duvarlar dahil; ayak izi dışına taşabilir) — dışarıdan yürünmez */
  rect: readonly [number, number, number, number];
}
export interface CourtyardScene {
  /** avlu dikdörtgeni (simge bölgesi yerel [a, b, w, d]) — dışarıdan yürünmez */
  rect: readonly [number, number, number, number];
}
export interface Courtyard {
  type: PrecinctType;
  sacred: boolean;
  /** şehir haritası simgesi (`<şehir>/<simge>`) */
  map?: CourtyardMap;
  /** taban sahne simge bölgesi (`<sahne>:<etiket>`) */
  scene?: CourtyardScene;
}

/** Anahtar `<şehir>:<simge>` (şehir haritası simge kimliği; taban sahnede aynı şehir sahnesinin etiketi `sceneTag`). */
export const COURTYARDS: Readonly<Record<string, Courtyard & { sceneTag?: string }>> = {
  ...FULL_COURTYARDS,
  // Sultanahmet: şehirde batı avlusu ayak izinin dışında (hires zone [-6, 0, 6, 12]; taç kapı a −6, b 5–6 → portal (−7, 5));
  // taban sahnede avlu önde (bölge 6 × 8, avlu j 5–7)
  "istanbul:sultanahmet": { type: "mosque", sacred: true, map: { rect: [-6, 0, 6, 12] }, scene: { rect: [0, 5, 6, 3] }, sceneTag: "sultanahmet" },
  // Süleymaniye: avlu ayak izinin kuzeyinde (a 2–6, b 9–12; kuzey taç kapı (4, 12) → portal (4, 13))
  "istanbul:suleymaniye": { type: "mosque", sacred: true, map: { rect: [2, 9, 5, 4] } },
  // duvarsız anıtlar (cami ayak izi, kaide, minare kulesi): dikdörtgen yapının kendi ayak izi (görsel katı); portal güney kenarda
  "istanbul:ayasofya": { type: "mosque", sacred: true, map: { rect: [0, 0, 14, 10] } },
};

export const courtyardOf = (city: string, lm: string) => COURTYARDS[`${city}:${lm}`] ?? null;
/** Taban sahne etiketi → kayıt (`<sahne>:<etiket>`). */
export function sceneCourtyard(scene: string, tag: string): Courtyard | null {
  for (const [k, v] of Object.entries(COURTYARDS)) if (k.startsWith(`${scene}:`) && v.sceneTag === tag && v.scene) return v;
  return null;
}
/** Avlu dikdörtgeninin karoları (yerel). */
export function rectTiles(r: readonly [number, number, number, number]): [number, number][] {
  const out: [number, number][] = [];
  for (let b = r[1]; b < r[1] + r[3]; b++) for (let a = r[0]; a < r[0] + r[2]; a++) out.push([a, b]);
  return out;
}
