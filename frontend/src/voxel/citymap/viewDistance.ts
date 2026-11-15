/**
 * TOUR-VIEW ( F1) — gezi modunda **görüş mesafesi, sis ve akış yarıçapının tek
 * kaynağı** (saf modül; React/three yok → tour_check doğrudan yükler).
 *
 * Oyunlardaki gibi üç kat (yakından uzağa), her biri bir öncekinin üstüne titreşimli (0,4 sn) çapraz geçişle biner — hiçbir yapı
 * ani bir kenarda, açık havada "belirmez":
 * 1. **Silüet / ufuk katmanı** (`horizon.ts`, `HorizonLayer.tsx`): şehrin BÜTÜN parsellerinin uzak LOD'u + doğal sınır (su,
 * tepe, mesa, sur, ufuk silüeti). Her pozdan görünür; sis katkısı `max` ile sınırlı (soluk hava perspektifi).
 * 2. **Uzak halka** (`CITY_STREAM.far`, öne kayan): parselin uzak LOD'u kuyrukta; silüet aynı bloklardır → geçiş görünmez.
 * 3. **Yakın halka** (`CITY_STREAM.near`, öne kayan): tam ayrıntı + çarpışma; uzak LOD ile çapraz geçer.
 *
 * Ön yükleme: avatar yürürken akış halkaları avatarın ve `leadPoint` noktasının çevresinin birleşimidir (expanse/stream.ts
 * `update(…, lead)`) — yeni parsel yürüyüş yönünde en az `reach.ahead` uzakta yazılır. Sisin başlangıcı bu uzaklığı geçmez
 * (`cityFog`): uzak halkanın yoğunlaşması daima pusun içinde olur. POP-IN-001 (scripts/tour_check.mjs) bunu yürüyüş
 * benzetimiyle denetler.
*/
import { CITY_PD, CITY_PW } from "./format";
import { withFullViewDistance } from "../../full/viewDistance";

/** Çapraz geçiş süresi (sn; expanse/tail.ts `TAIL_FADE_S` ile aynı). */
export const VIEW_FADE_S = 0.4;
/** Akış yarıçapları (parsel): source.ts `CITY_STREAM` ile aynı (city_check eşliği denetler). */
export const VIEW_NEAR = 1, VIEW_FAR = 2;

/** Hıza göre öndeki nokta uzaklığı (birim): yürüyüş ≈ 12, koşu ≈ 17, taşıt ≤ 22; durunca yok. */
export function leadDistance(speed: number): number {
  return speed > 0.4 ? Math.min(22, 6 + speed * 2.5) : 0;
}
/** Yürüyüş öndeki noktası (dünya; hız vektörü yönünde). Durunca null. */
export function leadPoint(x: number, z: number, vx: number, vz: number): [number, number] | null {
  const sp = Math.hypot(vx, vz), L = leadDistance(sp);
  return L > 0 ? [x + (vx / sp) * L, z + (vz / sp) * L] : null;
}

/** Öndeki nokta durumu: önceki konum ve yumuşatılmış hız (CityRig `Run` ile aynı alanlar; tour_check aynı işlevi sürer). */
export interface LeadState { px: number; pz: number; vx: number; vz: number }
/**
 * Bir kare: yumuşatılmış hızı (≈ 1/6 sn zaman sabiti) günceller. Işınlanma sıçraması (> 6 birim/kare) hız sayılmaz.
 * CityRig her karede çağırır; ardından `leadPoint(x, z, st.vx, st.vz)`.
 */
export function stepLeadState(st: LeadState, x: number, z: number, dt: number): void {
  if (dt > 0 && Number.isFinite(st.px)) {
    const ix = (x - st.px) / dt, iz = (z - st.pz) / dt, k = Math.min(1, dt * 6);
    if (Math.hypot(x - st.px, z - st.pz) < 6) { st.vx += (ix - st.vx) * k; st.vz += (iz - st.vz) * k; } else { st.vx = 0; st.vz = 0; }
  }
  st.px = x; st.pz = z;
}

/** Yükleme erişimi (birim): yan (uzak halka sınırı) ve ileri (öndeki nokta + halka) — yeni yazılan parselin avatara en yakın kenarı. */
export function loadReach(speed = 2.6): { side: number; ahead: number; near: number } {
  const cell = Math.min(CITY_PW, CITY_PD);
  return { side: VIEW_FAR * cell, ahead: VIEW_FAR * cell + leadDistance(speed), near: VIEW_NEAR * cell + leadDistance(speed) };
}

/** Şehrin havası: sis başlangıcı/bitişi (birim) ve silüet pus sınırı (0…1). Kuru bozkır berrak, nemli kıyı ve tropik puslu. */
export interface CityHaze { near: number; far: number; max: number }
export const HAZE_DEFAULT: Readonly<CityHaze> = { near: 30, far: 165, max: 0.8 };
export const CITY_HAZE: Readonly<Record<string, Partial<CityHaze>>> = withFullViewDistance({
  istanbul: { near: 32, far: 175, max: 0.78 }, // deniz pusu, uzak kıyılar seçilir
  londra: { near: 26, far: 140, max: 0.85 }, // nemli, gri ufuk
  kapadokya: { near: 34, far: 230, max: 0.68 }, // kuru bozkır havası: uzak mesalar ve volkan net
});
/** Gece: sis biraz daha yakın (karanlık hava), sınır aynı. */
export const NIGHT_FOG_K = 0.82;
/** Sis başlangıcı uzak halka yan erişimini bu kadar aşabilir (birim). */
export const FOG_SLACK = 4;

/**
 * Şehrin sisi: [başlangıç, bitiş] ve silüet pus sınırı. Başlangıç uzak halkanın yan erişimini (`loadReach().side` = 2 parsel) en
 * çok 4 birim aşar — uzak halkanın yeni parıltısı (silüette olmayan tek öğe) sis başlangıcından önce belirmez (tour_check
 * POP-IN-001: koni içinde en yakın uzak yazım ≥ 28 ölçülür); bitiş en az yüklü halkanın en uzak köşesinin (≈ 3 parsel + öndeki nokta)
 * 1,6 katı. smoothstep başlangıçta çok yavaş yükselir (40 birimde ≈ %4): yakın görüntü berrak kalır.
 */
export function cityFog(mapId: string, night = false): { near: number; far: number; max: number } {
  const h = { ...HAZE_DEFAULT, ...(CITY_HAZE[mapId] ?? {}) };
  const reach = loadReach();
  const near = Math.min(h.near, reach.side + FOG_SLACK);
  const loadedMax = (VIEW_FAR + 1) * Math.max(CITY_PW, CITY_PD) + leadDistance(2.6);
  const far = Math.max(h.far, loadedMax * 1.6);
  return night ? { near: +(near * NIGHT_FOG_K).toFixed(2), far: +(far * NIGHT_FOG_K).toFixed(2), max: h.max } : { near, far, max: h.max };
}

/** three doğrusal sisi (`smoothstep(near, far, d)`) — denetimler ve canlı ölçüm aynı eğriyi kullanır. */
export function fogFactor(d: number, near: number, far: number): number {
  const t = Math.min(1, Math.max(0, (d - near) / Math.max(1e-6, far - near)));
  return t * t * (3 - 2 * t);
}
