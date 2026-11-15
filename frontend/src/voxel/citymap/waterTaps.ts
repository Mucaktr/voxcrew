/**
 * CORE-CITYMAP (kalite seferberliği, REAL-WATER-001) — şehir haritasının su dokunma hedefleri. Sahnelerde her su gövdesi
 * `ambient/hotspots.ts` ile dokunulabilir (sıçrama + halka); şehir haritasında yalnız varış meydanının iskele suyu öyleydi, semt
 * suları (Boğaz, Seine, Thames, kanallar…) ve semt dışı deniz dokunulamıyordu. Burada harita başına bir kez:
 *  - semt suyu: `districtWater` (gerçekten çizilen, film/köprü altı değil, açık su yüzü) karoları, aynı yükseklikteki karolar
 *    satır öncelikli dikdörtgenlere birleşir (`top` su yüzü);
 *  - deniz: kıyı şehirlerinde (`map.sea`) semtlerin ve varış meydanının dışında kalan, sınır kutusunun `SEA_PAD` karo payına dek
 *    deniz düzlemi (`CITY_SEA_Y`);
 *  - varış meydanının suyu Ambient'in (meydan `Built`'i) işidir, burada tekrar edilmez.
 * Dikdörtgenler görünmez hedef kutusudur (CityWaterTaps.tsx): dokununca sıçrama + halka (fun/fx `splash`, `ripple`); tıkla-git
 * olayı sürer (büyük su gibi). Saf modül: React/three yok; aynı harita → aynı çıktı.
 */
import { packCache } from "../citypacks/cityOverlay";
import { CITY_PD, CITY_PW, GATE_D, GATE_W, type CityMapFile } from "./format";
import { districtPlan, districtWater } from "./district";
import { CITY_SEA_Y } from "./shell";
import { cityX, cityZ } from "../transit/model";

export interface WaterTap { x: number; z: number; w: number; d: number; top: number; sea: boolean; district: string | null }
/** Semt dışı denizin sınır kutusu payı (karo). */
export const SEA_PAD = 24;
/** Tavan (hedef sayısı; tek görünmez örneklenmiş dizi). */
export const WATER_TAP_MAX = 2000;

/** Anahtar ızgarasını (≥ 0) satır öncelikli dikdörtgenlere birleştirir: [i, j, w, d, anahtar]. */
function merge(keys: Int32Array, W: number, D: number): [number, number, number, number, number][] {
  const used = new Uint8Array(W * D), out: [number, number, number, number, number][] = [];
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    const k0 = j * W + i, key = keys[k0];
    if (used[k0] || key < 0) continue;
    let w = 1;
    while (i + w < W && !used[k0 + w] && keys[k0 + w] === key) w++;
    let d = 1;
    grow: while (j + d < D) {
      for (let a = 0; a < w; a++) if (used[(j + d) * W + i + a] || keys[(j + d) * W + i + a] !== key) break grow;
      d++;
    }
    for (let b = 0; b < d; b++) used.fill(1, (j + b) * W + i, (j + b) * W + i + w);
    out.push([i, j, w, d, key]);
  }
  return out;
}

const cache = packCache(() => new WeakMap<CityMapFile, WaterTap[]>());
/** Haritanın su dokunma hedefleri (önbellekli). */
export function cityWaterTaps(map: CityMapFile): WaterTap[] {
  const hit = cache().get(map);
  if (hit) return hit;
  const out: WaterTap[] = [];
  for (const d of map.districts) {
    const plan = districtPlan(map, d), dw = districtWater(map, d);
    const keys = new Int32Array(plan.w * plan.d).fill(-1);
    for (let k = 0; k < keys.length; k++) if (dw.open[k] && dw.y[k] > -9) keys[k] = Math.round(dw.y[k] * 20) + 10000;
    for (const [i, j, w, dd, key] of merge(keys, plan.w, plan.d)) {
      out.push({ x: cityX(plan.i0 + i) - 0.5 + w / 2, z: cityZ(plan.j0 + j) - 0.5 + dd / 2, w, d: dd, top: (key - 10000) / 20, sea: false, district: d.id });
    }
  }
  if (map.sea) {
    let i0 = 0, j0 = 0, i1 = GATE_W, j1 = GATE_D;
    for (const d of map.districts) { i0 = Math.min(i0, d.bounds[0]); j0 = Math.min(j0, d.bounds[1]); i1 = Math.max(i1, d.bounds[0] + d.bounds[2]); j1 = Math.max(j1, d.bounds[1] + d.bounds[3]); }
    // parsel ızgarası çözünürlüğünde (semt sınırları 12 × 16'ya hizalı): semt ve meydan dışı hücreler deniz
    i0 -= SEA_PAD; j0 -= SEA_PAD; i1 += SEA_PAD; j1 += SEA_PAD;
    const ci0 = Math.floor(i0 / CITY_PW), cj0 = Math.floor(j0 / CITY_PD), ci1 = Math.ceil(i1 / CITY_PW), cj1 = Math.ceil(j1 / CITY_PD);
    const W = ci1 - ci0, D = cj1 - cj0, keys = new Int32Array(W * D).fill(0);
    for (let cj = 0; cj < D; cj++) for (let ci = 0; ci < W; ci++) {
      const I = (ci0 + ci) * CITY_PW, J = (cj0 + cj) * CITY_PD;
      const land = (I < GATE_W && J < GATE_D && I + CITY_PW > 0 && J + CITY_PD > 0)
        || map.districts.some((d) => I < d.bounds[0] + d.bounds[2] && I + CITY_PW > d.bounds[0] && J < d.bounds[1] + d.bounds[3] && J + CITY_PD > d.bounds[1]);
      if (land) keys[cj * W + ci] = -1;
    }
    for (const [i, j, w, d] of merge(keys, W, D)) {
      out.push({ x: cityX((ci0 + i) * CITY_PW) - 0.5 + (w * CITY_PW) / 2, z: cityZ((cj0 + j) * CITY_PD) - 0.5 + (d * CITY_PD) / 2,
        w: w * CITY_PW, d: d * CITY_PD, top: CITY_SEA_Y, sea: true, district: null });
    }
  }
  const res = out.slice(0, WATER_TAP_MAX);
  cache().set(map, res);
  return res;
}

/** Şehir koordinatı (dünya x, z) bir su hedefinin içinde mi (dokunma testi; denetim). */
export function waterTapAt(taps: readonly WaterTap[], x: number, z: number): WaterTap | null {
  for (const t of taps) if (Math.abs(x - t.x) <= t.w / 2 && Math.abs(z - t.z) <= t.d / 2) return t;
  return null;
}
