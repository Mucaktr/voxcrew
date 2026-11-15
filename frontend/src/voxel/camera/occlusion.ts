/**
 * CAMERA — örtücü açma: görüş konisi titreşimi (screen-door / dithered see-through) ve çatı kesitinin yumuşak geçişi.
 * Saf modül (three/React yok). Gölgelendirici metni walk/cover.ts köşe/parça yamasına buradan girer (tek kaynak).
 *
 * Eski kural (WORLD-FIX, 2026-10-26): kameradan avatara giden doğruyu kesen her blok BÜTÜN olarak atılıyordu. Şehirde bir cephe
 * çoğu zaman tek büyük kutu olduğu için kameranın önündeki bina tümüyle kayboluyor, içi boş kutular görünüyordu (ürün sahibi 2026-10-28:
 * "şeffaflaşmalar acemice"). Yeni kural, oyunlardaki "see-through" yöntemi (Super Mario Odyssey, Animal Crossing; Unity/Needle
 * "SeeThrough" alpha-hash): yalnız ÖRTÜCÜ blokta ve yalnız kamera → avatar görüş konisinin içinde, 4 × 4 Bayer titreşimiyle
 * delik açılır. Koni kamerada `LOS_R0`, avatarda `LOS_R` yarıçaplıdır (gövde + baş); çekirdekte (`LOS_CORE`) tam açık, kenarda
 * titreşimli geçiş. Avatarın arkasında kalan parçalar (t ≥ 1) hiç açılmaz. Saydam malzeme/sıralama yok (katı, derinlik yazar):
 * +0 çizim çağrısı, program anahtarı sabit.
 *
 * Çatı/üst kat kesiti (avatar örtülü karodayken; The Sims "walls down", şehir kurucularda "cutaway") bütün blok kalır ama
 * `ROOF_FADE_S` saniyede titreşimle gelir/gider (`stepRoofFade`); hareket azaltmada anında.
*/

import { THIN } from "./collide";

/** Görüş konisinin avatar ucundaki yarıçapı (yürüme ölçeği: göğüs 0,77, baş +0,3, omuz ±0,22; ~0,4 pay). */
export const LOS_R = 0.8;
/** Kamera ucundaki yarıçap (yakın düzlem köşesi ~0,25). */
export const LOS_R0 = 0.3;
/** Çekirdek oranı: yarıçapın bu katına dek tam açık, sonrası titreşimle kapanır. */
export const LOS_CORE = 0.55;
/** Çatı kesitinin geliş/gidiş süresi (sn). */
export const ROOF_FADE_S = 0.3;

type V3 = readonly [number, number, number];

/**
 * Büyük blok (duvar, cephe, tente): kamera çarpışmasına giren boyut (camera/collide.ts `collidable` boyut ölçütü). Yürümede kamera
 * kabarcığı böyle bir bloğu BÜTÜN atmaz, yalnız kameranın çevresini açar (yakın düzlem); küçük/ince bloğu (lamba başı, direk,
 * yaprak) bütün atar. Gölgelendiricideki `cutBig` ikizi (`s` tam boy).
 */
export const bigBlock = (s: readonly number[]) => Math.min(s[0], s[2]) > THIN || s[0] * s[1] * s[2] >= 0.6;
/** Köşe gölgelendiricisine eklenen `cutBig(yarı boy)` (THIN ve hacim eşiği tek kaynaktan). */
export const BIG_GLSL = /* glsl */ `
float cutBig(vec3 h) { return (2.0 * min(h.x, h.z) > ${THIN.toFixed(3)} || 8.0 * h.x * h.y * h.z >= 0.6) ? 1.0 : 0.0; }`;

/** Parça (dünya noktası) koninin içinde mi: 0 = açılmaz, 1 = tam açık, arası titreşim yoğunluğu. Gölgelendiricideki `cutLos` ikizi. */
export function losHole(w: V3, cam: V3, chest: V3, r = LOS_R): number {
  if (r === 0) return 1;
  const hard = r < 0; // keskin koni (yolculuk; gölgelendiricide `uCutLos.w` < 0)
  r = Math.abs(r);
  const ab = [chest[0] - cam[0], chest[1] - cam[1], chest[2] - cam[2]];
  const L2 = Math.max(ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2], 1e-4);
  let t = ((w[0] - cam[0]) * ab[0] + (w[1] - cam[1]) * ab[1] + (w[2] - cam[2]) * ab[2]) / L2;
  if (t >= 1) return 0;
  t = Math.max(0, t);
  const rr = LOS_R0 + (r - LOS_R0) * t;
  const d = Math.hypot(w[0] - (cam[0] + ab[0] * t), w[1] - (cam[1] + ab[1] * t), w[2] - (cam[2] + ab[2] * t));
  if (hard) return d < rr ? 1 : 0;
  const e0 = rr * LOS_CORE, e1 = rr;
  if (d <= e0) return 1;
  if (d >= e1) return 0;
  const x = (d - e0) / (e1 - e0);
  return 1 - x * x * (3 - 2 * x);
}

/** 4 × 4 Bayer eşiği (0–1), gölgelendiricideki `cutBayer` ikizi (piksel x, y). */
export function bayer4(x: number, y: number): number {
  const b2 = (a: number, b: number) => { const v = Math.floor(a) / 2 + Math.floor(b) * Math.floor(b) * 0.75; return v - Math.floor(v); };
  return b2(x / 2, y / 2) * 0.25 + b2(x, y) + 1 / 32;
}

/** Parça başına yamaya eklenen GLSL (bildirim): Bayer eşiği ve görüş konisi. `uCutStreet.xyz` kamera, `uCutLos` avatar göğsü + yarıçap. */
export const LOS_GLSL = /* glsl */ `
uniform vec4 uCutStreet;
uniform vec4 uCutNear;
uniform vec4 uCutLos;
uniform float uCutFade;
float cutB2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float cutBayer(vec2 p) { return cutB2(0.5 * p) * 0.25 + cutB2(p) + ${(1 / 32).toFixed(5)}; }
float cutLos(vec3 w) {
  if (uCutLos.w == 0.0) return 1.0;
  vec3 a = uCutStreet.xyz;
  vec3 ab = uCutLos.xyz - a;
  float t = dot(w - a, ab) / max(dot(ab, ab), 1e-4);
  if (t >= 1.0) return 0.0;
  t = max(t, 0.0);
  float r = mix(${LOS_R0.toFixed(3)}, abs(uCutLos.w), t);
  float d = distance(w, a + ab * t);
  // w < 0 → keskin kenarlı koni (yolculuk: titreşimsiz, yalnız görüş doğrusundaki pencere; araç bütün kalır)
  if (uCutLos.w < 0.0) return d < r ? 1.0 : 0.0;
  return 1.0 - smoothstep(r * ${LOS_CORE.toFixed(3)}, r, d);
}`;

export interface RoofFade<T> { k: number; last: T | null }
export const createRoofFade = <T>(): RoofFade<T> => ({ k: 0, last: null });

/**
 * Çatı kesitinin yumuşak geçişi: plan açıkken yoğunluk 1'e, kapanınca 0'a `ROOF_FADE_S`'de yürür; kapanırken son çatı yazılmaya
 * devam eder (blok birden "pat" diye geri gelmez). Dönüş: bu karede yazılacak çatı (null → kapalı) — yoğunluk `f.k`.
 */
export function stepRoofFade<T>(f: RoofFade<T>, roof: T | null, dt: number, calm: boolean): T | null {
  const step = calm ? 1 : Math.max(0, dt) / ROOF_FADE_S;
  if (roof) { f.last = roof; f.k = Math.min(1, f.k + step); return roof; }
  f.k = Math.max(0, f.k - step);
  if (f.k <= 0) { f.last = null; return null; }
  return f.last;
}
