/**
 * `spin` blok grubunun saf matematiği (three yok → Blocks.tsx, kesit taraması, geçilebilirlik ve node testleri aynı kodu
 * kullanır).
 *
 * Model: her `spin` bloğu `Block.r` (eksen x/y/z, pivot `o`, açısal hız `w` rad/sn, faz `ph`, isteğe bağlı kabin askısı `k`, ışık
 * `e`) taşır. Açı `ph + w·t`; yazılan konum açı 0 pozudur. Katı gövde (`k` yok): blok pivot çevresinde döner ve kendisi de döner.
 * Kabin (`k` var): yalnız askı noktası döner, blok dik kalır (askıya göre sabit ofset).
 * Kesit: gölgelendirici bütün blok kararını örnek matrisinden (döndürülmüş kutunun eksen hizalı sarmalayanı) verir →
 * `posedBlock` aynı sarmalayanı üretir; kamera taraması (walk/opaqueCheck.ts) canlı pozu ≥ 4 açıda dener.
 * Çarpışma: dönen bloklar çarpıştırıcı üretmez (mover gibi; physics/world.ts yalnız solid/glass/glow); süpürme zarfı
 * (`spinEnvelope`) gövde bandına giren karo kaba ızgarada engelli olmalı (walk/passability.ts SPIN-SWEEP).
*/
import type { Block, Spin, SpinAxis } from "./scenes";

export type V3 = [number, number, number];
export const SPIN_AXES: readonly SpinAxis[] = ["x", "y", "z"];
/** Dünya başına en çok dönen blok (CPU'da kare başına matris; backend `worlds/validate.py` aynı). */
export const MAX_SPIN_BLOCKS = 600;
/** |w| üst sınırı (rad/sn; ≈ 0,5 tur/sn) ve |ph| üst sınırı */
export const MAX_SPIN_SPEED = 3;
export const MAX_SPIN_PHASE = 7;
/** blok merkezinin pivota uzaklığı üst sınırı (süpürme zarfı sınırlı kalsın) */
export const MAX_SPIN_RADIUS = 16;
/** Hareket azaltmada açı: taban poz (durağan). */
export const SPIN_REST = 0;

const AX: Record<SpinAxis, number> = { x: 0, y: 1, z: 2 };
/** eksene dik iki bileşen (sağ el: x → (y, z), y → (z, x), z → (x, y)) */
const PERP: Record<SpinAxis, [number, number]> = { x: [1, 2], y: [2, 0], z: [0, 1] };

export const spinAngle = (r: Spin, t: number) => (r.ph ?? 0) + r.w * t;

/** `v`'yi eksen çevresinde `ang` kadar döndürür (sağ el kuralı) ve `out`'a yazar. */
export function rotateAbout(a: SpinAxis, v: readonly number[], ang: number, out: number[] = [0, 0, 0]): number[] {
  const c = Math.cos(ang), s = Math.sin(ang);
  const [u, w] = PERP[a], k = AX[a];
  const vu = v[u], vw = v[w];
  out[k] = v[k];
  out[u] = c * vu - s * vw;
  out[w] = s * vu + c * vw;
  return out;
}

/** Eksen-açı dördeyi [x, y, z, w] (`out`'a). Kabinde birim. */
export function spinQuat(b: Block, ang: number, out: number[] = [0, 0, 0, 1]): number[] {
  out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1;
  if (!b.r || b.r.k) return out;
  const h = ang / 2;
  out[AX[b.r.a]] = Math.sin(h);
  out[3] = Math.cos(h);
  return out;
}

const tmp: number[] = [0, 0, 0];
/** Bloğun `ang` açısındaki merkezi (`out`'a; ayırma yok — Blocks.tsx kare döngüsü). */
export function spinCenter(b: Block, ang: number, out: number[] = [0, 0, 0]): number[] {
  const r = b.r;
  if (!r) { out[0] = b.p[0]; out[1] = b.p[1]; out[2] = b.p[2]; return out; }
  const piv = r.k ?? b.p;
  tmp[0] = piv[0] - r.o[0]; tmp[1] = piv[1] - r.o[1]; tmp[2] = piv[2] - r.o[2];
  rotateAbout(r.a, tmp, ang, out);
  out[0] += r.o[0] + b.p[0] - piv[0];
  out[1] += r.o[1] + b.p[1] - piv[1];
  out[2] += r.o[2] + b.p[2] - piv[2];
  return out;
}

/** `ang` pozunda bloğun eksen hizalı sarmalayanı (gölgelendirici kesitinin gördüğü kutu: |R|·yarı boy) — yeni Block. */
export function posedBlock(b: Block, ang: number): Block {
  const p = spinCenter(b, ang) as V3;
  if (!b.r || b.r.k) return { ...b, p };
  const [u, w] = PERP[b.r.a];
  const c = Math.abs(Math.cos(ang)), s = Math.abs(Math.sin(ang));
  const sz = [...b.s] as V3;
  sz[u] = c * b.s[u] + s * b.s[w];
  sz[w] = s * b.s[u] + c * b.s[w];
  return { ...b, p, s: sz };
}

/** Bütün dönüş boyunca bloğun süpürdüğü hacmin eksen hizalı sarmalayanı [alt, üst]. */
export function spinEnvelope(b: Block): [V3, V3] {
  const lo: V3 = [b.p[0] - b.s[0] / 2, b.p[1] - b.s[1] / 2, b.p[2] - b.s[2] / 2];
  const hi: V3 = [b.p[0] + b.s[0] / 2, b.p[1] + b.s[1] / 2, b.p[2] + b.s[2] / 2];
  const r = b.r;
  if (!r) return [lo, hi];
  const [u, w] = PERP[r.a];
  if (r.k) {
    // askı çemberi + sabit ofsetli kutu
    const R = Math.hypot(r.k[u] - r.o[u], r.k[w] - r.o[w]);
    for (const q of [u, w]) {
      const off = b.p[q] - r.k[q];
      lo[q] = r.o[q] - R + off - b.s[q] / 2;
      hi[q] = r.o[q] + R + off + b.s[q] / 2;
    }
    return [lo, hi];
  }
  // katı gövde: pivota en uzak köşenin yarıçapı
  const fu = Math.max(Math.abs(lo[u] - r.o[u]), Math.abs(hi[u] - r.o[u]));
  const fw = Math.max(Math.abs(lo[w] - r.o[w]), Math.abs(hi[w] - r.o[w]));
  const R = Math.hypot(fu, fw);
  lo[u] = r.o[u] - R; hi[u] = r.o[u] + R;
  lo[w] = r.o[w] - R; hi[w] = r.o[w] + R;
  return [lo, hi];
}

/** Kamera/kesit taramasının denediği canlı pozlar (≥ 4 açı, tam turda eşit aralık; 0 = taban). */
export const SPIN_CHECK_ANGLES = [0, 1, 2, 3, 4, 5].map((k) => (k * Math.PI) / 3);

/** Bütün `spin` bloklarını `ang` açısındaki sarmalayanlarıyla değiştirir (diğerleri aynı nesne). */
export const posedBlocks = (blocks: readonly Block[], ang: number): Block[] => blocks.map((b) => (b.g === "spin" && b.r ? posedBlock(b, ang) : b));

/** Dünya dosyasındaki görece dönüş tanımı (decor parçasının 10. alanı): `o`/`k` çapa karonun merkezine göre (dx, y, dz). */
export interface SpinPart { a: SpinAxis; o: V3; w: number; ph?: number; k?: V3; e?: boolean }
export const SPIN_PART_KEYS = ["a", "o", "w", "ph", "k", "e"];

/** Görece → mutlak (bakePrefab decor). */
export function spinFromPart(sp: SpinPart, x0: number, z0: number): Spin {
  const r: Spin = { a: sp.a, o: [x0 + sp.o[0], sp.o[1], z0 + sp.o[2]], w: sp.w };
  if (sp.ph) r.ph = sp.ph;
  if (sp.k) r.k = [x0 + sp.k[0], sp.k[1], z0 + sp.k[2]];
  if (sp.e) r.e = true;
  return r;
}

/** Mutlak → görece (worldRecord partOf); `round` dosyadaki yuvarlama. */
export function spinToPart(r: Spin, x0: number, z0: number, round: (n: number) => number): SpinPart {
  const sp: SpinPart = { a: r.a, o: [round(r.o[0] - x0), round(r.o[1]), round(r.o[2] - z0)], w: round(r.w) };
  if (r.ph) sp.ph = round(r.ph);
  if (r.k) sp.k = [round(r.k[0] - x0), round(r.k[1]), round(r.k[2] - z0)];
  if (r.e) sp.e = true;
  return sp;
}

/** Prefab'ı yukarıdan saat yönünde 90° döndürmek ((dx, dz) → (−dz, dx)): x ekseni z olur, z ekseni −x (hız işaret değiştirir). */
export function rotateSpinPart(sp: SpinPart, round: (n: number) => number): SpinPart {
  const rot = (v: V3): V3 => [round(-v[2]), v[1], round(v[0])];
  const out: SpinPart = { ...sp, a: sp.a === "x" ? "z" : sp.a === "z" ? "x" : "y", o: rot(sp.o), w: sp.a === "z" ? round(-sp.w) : sp.w };
  if (sp.k) out.k = rot(sp.k);
  return out;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isV3 = (v: unknown, xz: number, y: number) => Array.isArray(v) && v.length === 3 && v.every(isNum)
  && Math.abs(v[0]) <= xz && Math.abs(v[2]) <= xz && Math.abs(v[1]) <= y;

/** Decor parçasının dönüş tanımı geçerli mi? `pos`: parçanın (dx, y, dz) merkezi (yarıçap sınırı için). Backend aynı. */
export function isSpinPart(v: unknown, pos: readonly number[]): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (!Object.keys(o).every((k) => SPIN_PART_KEYS.includes(k))) return false;
  if (!(SPIN_AXES as readonly unknown[]).includes(o.a) || !isV3(o.o, 64, 40) || !isNum(o.w) || Math.abs(o.w) > MAX_SPIN_SPEED) return false;
  if (o.ph !== undefined && !(isNum(o.ph) && Math.abs(o.ph) <= MAX_SPIN_PHASE)) return false;
  if (o.k !== undefined && !isV3(o.k, 64, 40)) return false;
  if (o.e !== undefined && o.e !== true) return false;
  const piv = o.o as number[];
  return Math.hypot(pos[0] - piv[0], pos[1] - piv[1], pos[2] - piv[2]) <= MAX_SPIN_RADIUS;
}
