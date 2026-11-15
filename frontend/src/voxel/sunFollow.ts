/**
 * şehir kipinde güneş gölgesi kutusu kamerayı izler (texel'e oturtulmuş).
 *
 * Sorun: şehir haritasında `World.tsx` güneşi varış meydanının (`gateBuilt`, ≈ 12 × 16) sınır kutusuna göre kuruyordu; gölge
 * kamerası ±14 birimlik kutuydu → meydan dışındaki bütün şehirde (uzak semtlerde) hiç gölge yoktu.
 * Çözüm: şehir kipinde (iç mekân dışı) yönlü ışığın gölge kamerası kamera hedefini (`live.camTarget`: yürüyüşte avatarın bakış
 * noktası, yörüngede yörünge hedefi) izler; kutu yarı genişliği `SUN_FOLLOW_HALF` (40), bakış yönünde `SUN_FOLLOW_LEAD` kadar öne
 * kaydırılır (ekranda görünen alan önde). Işığın yönü sahne tanımından (`def.sun.pos`) aynen kalır; yalnız konum taşınır.
 *
 * Titreşim (shimmer) önlemi — texel'e oturtma: gölge kamerasının yönü sabit olduğundan, kutu merkezi ışık uzayının sağ/yukarı
 * eksenlerinde gölge haritası texel boyunun (2 · yarı / harita) tam katına yuvarlanır. Böylece kutu yürürken yalnız tam texel
 * adımlarıyla kayar; gölge kenarları dünyada yerinde durur (her karede yeniden örneklenen "kayan merdiven" yok). Eksenler
 * three.js `Matrix4.lookAt` ile aynı kurulur (z = ışık − hedef, x = yukarı × z, y = z × x), bu yüzden yuvarlama gölge
 * kamerasının gerçek texel ızgarasına denk gelir.
 *
 * Çizim çağrısı: değişmez. Sahne blokları `frustumCulled={false}` örneklenmiş ağlardır; gölge geçişi kutu büyüse de aynı ağları
 * aynı sayıda çizer. Gece: ışık rengi/şiddeti `World.tsx`'te kalır (UXF-G gece tabanı ve 0,14 ay ışığı değişmez).
 *
 * Saf modül (three/React yok) → Node testinde yüklenir (scripts/render2.test.mjs).
*/
import { sunNormalBias } from "./zfight";

type V3 = readonly [number, number, number];

/** gölge kutusunun yarı genişliği (birim) */
export const SUN_FOLLOW_HALF = 40;
/** kutu merkezinin kamera bakış yönünde öne kayması (birim; görünen alan avatarın önünde) */
export const SUN_FOLLOW_LEAD = 12;
/** ışığın hedeften uzaklığı (güneş yönünde; yüksek kule tepeleri yakın düzlemin arkasında kalmasın) */
export const SUN_FOLLOW_DIST = 90;
/** gölge kamerası derinliği: uzak düzlem = uzaklık + bu (hedefin altındaki zemin ve su da içeride) */
export const SUN_FOLLOW_DEPTH = 70;
export const SUN_FOLLOW_NEAR = 1;
/** gölge haritası boyu (World.tsx `shadow-mapSize` ile aynı) */
export const SUN_MAP_SIZE = 2048;
/** derinlik kayması dünya biriminde: eski varış meydanı kurgusunun (−0,0004 × (88 − 1)) karşılığı korunur */
export const SUN_BIAS_WORLD = 0.035;

export const sunTexel = (half = SUN_FOLLOW_HALF, mapSize = SUN_MAP_SIZE) => (2 * half) / mapSize;

export interface SunShadowParams { half: number; near: number; far: number; bias: number; normalBias: number }

/** İzleyen gölge kamerasının sabit ayarları (kutu, derinlik, kaymalar). */
export function sunFollowShadow(half = SUN_FOLLOW_HALF, mapSize = SUN_MAP_SIZE): SunShadowParams {
  const near = SUN_FOLLOW_NEAR, far = SUN_FOLLOW_DIST + SUN_FOLLOW_DEPTH;
  return { half, near, far, bias: -SUN_BIAS_WORLD / (far - near), normalBias: sunNormalBias(half, mapSize) };
}

export interface SunBasis { dir: [number, number, number]; right: [number, number, number]; up: [number, number, number] }

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Gölge kamerasının eksenleri (three.js `Matrix4.lookAt(ışık, hedef, (0, 1, 0))` ile aynı). `sun`: hedeften güneşe göreli konum. */
export function sunBasis(sun: V3): SunBasis {
  let z = norm([sun[0], sun[1], sun[2]]);
  let x = cross([0, 1, 0], z);
  if (Math.hypot(x[0], x[1], x[2]) < 1e-9) { // tam tepeden güneş: three.js aynı küçük sapmayı uygular
    z = norm([z[0], z[1], z[2] + 1e-4]); // yukarı (0, 1, 0): up.z ≠ ±1 → three z.z += 0,0001
    x = cross([0, 1, 0], z);
  }
  x = norm(x);
  return { dir: z, right: x, up: cross(z, x) };
}

export interface SunFollowPose {
  /** gölge kamerasının baktığı nokta (ışık hedefi) */
  target: [number, number, number];
  /** ışık konumu = hedef + yön × uzaklık */
  light: [number, number, number];
  /** kutu merkezinin ışık uzayındaki sağ/yukarı koordinatları (texel katı) */
  sx: number;
  sy: number;
  texel: number;
}

/**
 * Saf: odak noktasından (kamera hedefi, y = 0 düzlemi) texel'e oturtulmuş ışık hedefi ve konumu. `forward` kameranın yatay bakış
 * yönü (birim olmak zorunda değil; sıfırsa öne kayma yok).
 */
export function sunFollowPose(focus: { x: number; z: number }, sun: V3,
  opts: { forward?: readonly [number, number]; half?: number; mapSize?: number; lead?: number; dist?: number } = {}): SunFollowPose {
  const half = opts.half ?? SUN_FOLLOW_HALF, texel = sunTexel(half, opts.mapSize ?? SUN_MAP_SIZE);
  const lead = opts.lead ?? SUN_FOLLOW_LEAD, dist = opts.dist ?? SUN_FOLLOW_DIST;
  let fx = 0, fz = 0;
  if (opts.forward) { const l = Math.hypot(opts.forward[0], opts.forward[1]); if (l > 1e-6) { fx = opts.forward[0] / l; fz = opts.forward[1] / l; } }
  const p: V3 = [focus.x + fx * lead, 0, focus.z + fz * lead];
  const b = sunBasis(sun);
  const sx = Math.round(dot(p, b.right) / texel) * texel, sy = Math.round(dot(p, b.up) / texel) * texel, sz = dot(p, b.dir);
  const target: [number, number, number] = [0, 1, 2].map((k) => b.right[k] * sx + b.up[k] * sy + b.dir[k] * sz) as [number, number, number];
  const light: [number, number, number] = [target[0] + b.dir[0] * dist, target[1] + b.dir[1] * dist, target[2] + b.dir[2] * dist];
  return { target, light, sx, sy, texel };
}
