/**
 * WATER-ALL — çevre arazisindeki (Outskirts) suyun tıklanabilir hedefleri. Saf TypeScript (three/React yok): yüklü yakın parsellerin
 * yürünemeyen su karoları, aynı satırda ve aynı seviyedeki karolar birleşik şeritlerde. Dünya x/z = taban çerçevesi karosu + köken.
 * `scripts/interact_all.test.mjs` bütün sahnelerde parsel suyunun hedefte olduğunu denetler.
 */
import { tx, tz } from "../scenes";
import { T_WATER, type ParcelOut } from "./generate";
import { PD, PW } from "./grid";

export interface WaterSpot { x: number; z: number; w: number; top: number }
/** Aynı anda en çok hedef (görünmez örnekli kutu dizisi kapasitesi). */
export const WATER_SPOT_MAX = 600;

type P = Pick<ParcelOut, "cx" | "cz" | "terrain" | "height" | "near">;

export function waterSpots(parcels: readonly P[], origin: readonly [number, number]): WaterSpot[] {
  const out: WaterSpot[] = [];
  for (const p of parcels) {
    if (!p.near) continue;
    const i0 = p.cx * PW + origin[0], j0 = p.cz * PD + origin[1];
    for (let lj = 0; lj < PD; lj++) {
      for (let li = 0; li < PW; li++) {
        const k = lj * PW + li;
        if (p.terrain[k] !== T_WATER || p.near.walk[k]) continue; // iskele/köprü karosu su değil
        const top = Math.round(p.height[k] * 20) / 20;
        let n = 1;
        while (li + n < PW) {
          const k2 = k + n;
          if (p.terrain[k2] !== T_WATER || p.near.walk[k2] || Math.round(p.height[k2] * 20) / 20 !== top) break;
          n++;
        }
        if (out.length < WATER_SPOT_MAX) out.push({ x: tx(i0 + li) + (n - 1) / 2, z: tz(j0 + lj), w: n, top });
        li += n - 1;
      }
    }
  }
  return out;
}
