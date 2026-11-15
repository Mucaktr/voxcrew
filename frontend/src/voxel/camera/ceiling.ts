/**
 * INTERIOR-CAM — tavan sıkıştırması (ceiling clamp). Saf modül (three/React yok; Node testinde yüklenir).
 *
 * Eski yol: avatar örtülü karodayken çatı/üst kat kesiti (The Sims "walls down") çatıyı siliyor, kamera dışarıdan bakıyordu.
 * Yeni yol (ürün sahibi 2026-10-29: "iç mekâna girince çatı kaybolmamalı"): çatı hiç kaldırılmaz; avatarın üstünde tavan varsa kamera
 * TAVANIN ALTINDA kalır — gerçek bir operatörün iç mekânda yaptığı gibi yükselmez, alçalır ve yaklaşır. Yörünge yükselişi
 * tavanın altına sığacak kadar düşürülür (bakış avatara döner: kadraj korunur), sonra yaylı kol (collide.ts) duvarlarla kısaltır.
 *
 * Tavan: çarpışmaya giren (collide.ts `collidable`) ve tabanı göğüs + `HEAD_CLEAR` üstünde kalan blok. Avatarın tepesinde böyle
 * bir blok yoksa (açık hava) hiçbir şey değişmez: dış dünya takip kamerası aynen kalır.
*/
import { collidable, type Box, type BoxSource } from "./collide";

/** Göğüs pivotunun bu kadar üstünden aşağıda başlayan bloklar tavan değil gövde bandıdır (baş üstü ≈ ayak + 1,0; göğüs 0,77). */
export const HEAD_CLEAR = 0.3;
/** Kamera küresi ile tavan arasında bırakılan pay (birim). */
export const CEIL_MARGIN = 0.06;
/** Kameranın göğüs pivotuna göre en alçak yükselişi (rad; walk/scale.ts ORBIT_MIN ile aynı). */
const ELEV_MIN = -0.12;

const _q: Box[] = [];

/** (x, z) noktasının (yarıçap `r` genişletilmiş izdüşümü) üstündeki en alçak tavan tabanı (`fromY` ve üstü); yoksa Infinity. */
export function ceilingOver(src: BoxSource, x: number, z: number, fromY: number, r = 0, floorTop = 0.2): number {
  _q.length = 0;
  src(x - r - 0.5, z - r - 0.5, x + r + 0.5, z + r + 0.5, _q);
  let c = Infinity;
  for (const b of _q) {
    const bottom = b.p[1] - b.s[1] / 2;
    if (bottom < fromY || bottom >= c || !collidable(b, floorTop)) continue;
    if (Math.abs(x - b.p[0]) <= b.s[0] / 2 + r && Math.abs(z - b.p[2]) <= b.s[2] / 2 + r) c = bottom;
  }
  return c;
}

/** Yatay doğru parçası (a → b) eksen hizalı dikdörtgeni (merkez c, yarı boy h) kesiyor mu (2B slab). */
function segHitsRect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, hx: number, hz: number): boolean {
  let t0 = 0, t1 = 1;
  for (const [a, d, c, h] of [[ax, bx - ax, cx, hx], [az, bz - az, cz, hz]] as const) {
    if (Math.abs(d) < 1e-9) { if (a < c - h || a > c + h) return false; continue; }
    let ta = (c - h - a) / d, tb = (c + h - a) / d;
    if (ta > tb) { const x = ta; ta = tb; tb = x; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** Pivot → kamera yatay izdüşümünün (yarıçapla genişletilmiş) üstündeki en alçak tavan (`fromY` ve üstü); yoksa Infinity. */
export function ceilingAlong(src: BoxSource, pivot: readonly number[], cam: readonly number[], fromY: number, r: number, floorTop = 0.2): number {
  _q.length = 0;
  src(Math.min(pivot[0], cam[0]) - r - 0.5, Math.min(pivot[2], cam[2]) - r - 0.5, Math.max(pivot[0], cam[0]) + r + 0.5, Math.max(pivot[2], cam[2]) + r + 0.5, _q);
  let c = Infinity;
  for (const b of _q) {
    const bottom = b.p[1] - b.s[1] / 2;
    if (bottom < fromY || bottom >= c || !collidable(b, floorTop)) continue;
    if (segHitsRect(pivot[0], pivot[2], cam[0], cam[2], b.p[0], b.p[2], b.s[0] / 2 + r, b.s[2] / 2 + r)) c = bottom;
  }
  return c;
}

export interface CeilingFit {
  /** avatarın tepesindeki tavan tabanı (yoksa Infinity → açık hava, hiçbir şey değişmedi) */
  over: number;
  /** kolun yolundaki en alçak tavan (Infinity → yok) */
  along: number;
  /** kamera merkezinin en yüksek y'si (tavan − küre yarıçapı − pay) */
  maxY: number;
  /** sıkıştırıldı mı ve etkin bakış eğimi (rad; yörünge anlamı: −yükseliş) */
  clamped: boolean;
  pitch: number;
}

/**
 * Yörünge pozunu tavanın altına sığdırır (`cam` yerinde). `pivot` göğüs, `dist` kol boyu, `pitch` kullanıcı eğimi, `radius` kamera
 * küresi (collide.ts `probeRadius`). Avatarın üstünde tavan yoksa dokunmaz (`over` = Infinity). Tavan varsa kolun yolundaki en
 * alçak tavan bulunur; kamera onun `radius + CEIL_MARGIN` altına iner: yükseliş asin((maxY − pivot.y) / dist) olur (yatay mesafe
 * korunur, bakış avatara döner → etkin eğim). Tavan göğse çok yakınsa yükseliş `ELEV_MIN`'e iner ve y doğrudan kırpılır.
 */
export function fitUnderCeiling(src: BoxSource, pivot: { x: number; y: number; z: number }, cam: { x: number; y: number; z: number },
  o: { dist: number; pitch: number; radius: number; floorTop: number; footY: number; camFloor?: number; reach?: number }): CeilingFit {
  const from = pivot.y + HEAD_CLEAR;
  // `reach`: iç mekân katında avatarın yanındaki tavan da sayılır (merdiven boşluğunun ağzında kamera yine tavanın altında kalır)
  const over = ceilingOver(src, pivot.x, pivot.z, from, o.reach ?? 0, o.floorTop);
  const fit: CeilingFit = { over, along: Infinity, maxY: Infinity, clamped: false, pitch: o.pitch };
  if (!Number.isFinite(over)) return fit;
  const P = [pivot.x, pivot.y, pivot.z], C = [cam.x, cam.y, cam.z];
  fit.along = Math.min(over, ceilingAlong(src, P, C, from, o.radius, o.floorTop));
  fit.maxY = Math.max(o.footY + (o.camFloor ?? 0.3), fit.along - o.radius - CEIL_MARGIN);
  if (cam.y <= fit.maxY) return fit;
  fit.clamped = true;
  const hx = cam.x - pivot.x, hz = cam.z - pivot.z, hl = Math.hypot(hx, hz);
  const s = Math.max(Math.sin(ELEV_MIN), Math.min(1, (fit.maxY - pivot.y) / Math.max(1e-3, o.dist)));
  const elev = Math.asin(s), ce = Math.cos(elev);
  if (hl > 1e-4) { cam.x = pivot.x + (hx / hl) * ce * o.dist; cam.z = pivot.z + (hz / hl) * ce * o.dist; }
  cam.y = Math.min(fit.maxY, pivot.y + s * o.dist);
  // yörünge anlamı (walk/scale.ts orbitPose): aşağı bakışta eğim = −yükseliş; kullanıcı yukarı bakıyorsa (eğim > −yükseliş) korunur
  fit.pitch = Math.max(o.pitch, -elev);
  return fit;
}

/** Yedek pozların (kaldırma, omuz üstü) en dik yükselişi: profil sınırı ve tavanın altı (kol `dist` boyunda kamera `maxY`'yi aşmaz). */
export function elevCap(fit: Pick<CeilingFit, "maxY">, pivotY: number, dist: number, profileMax: number): number {
  if (!Number.isFinite(fit.maxY) || dist <= 1e-3) return profileMax;
  return Math.min(profileMax, Math.asin(Math.max(-1, Math.min(1, (fit.maxY - pivotY) / dist))));
}
