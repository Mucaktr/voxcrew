/**
 * UXF-D — ofis mini haritasının coğrafya katmanı: su, yürünebilir yol ve simgeler. Şehir sahnelerinde bölge (modül)
 * yok; harita eskiden siyah zemin + noktalardan ibaretti. Saf, React/three yok; `Built` başına bir kez (WeakMap) hesaplanır.
 * - `cells`: karo başına 0 yürünebilir (yol/meydan) · 1 dolu (bina, duvar) · 2 su (yüzeyi zeminde olan `water`/`wave` blok);
 * - `landmarks`: `landmark` bölgelerinin merkezleri (dünya x, z) — ufuktaki simgeler ızgara dışında olabilir.
 * Çizim mini haritanın 2B tuvalinde (karo başına 1 piksellik ara tuval, ölçekli; 3B görünümde ek çizim çağrısı yok).
*/
import { tx, tz, type Built } from "../../voxel/scenes";

export const GEO_OPEN = 0, GEO_SOLID = 1, GEO_WATER = 2;
export interface MiniGeo { width: number; depth: number; cells: Uint8Array; landmarks: [number, number][] }

/** Su yüzeyi bu yükseklikten alçaksa karo su sayılır (köprü, iskele ve tekne gövdesi değil). */
const WATER_TOP = 0.6;
const cache = new WeakMap<Built, MiniGeo>();

export function miniGeo(built: Built): MiniGeo {
  const hit = cache.get(built);
  if (hit) return hit;
  const { width, depth } = built;
  const cells = new Uint8Array(width * depth);
  for (const k of built.blocked) {
    const c = k.indexOf(","), i = +k.slice(0, c), j = +k.slice(c + 1);
    if (i >= 0 && j >= 0 && i < width && j < depth) cells[j * width + i] = GEO_SOLID;
  }
  // su: blok ayak izinin örttüğü karo merkezleri (karo i'nin merkezi tx(0) + i)
  const i0 = tx(0), j0 = tz(0);
  for (const b of built.blocks) {
    if ((b.g !== "water" && b.g !== "wave") || b.p[1] + b.s[1] / 2 > WATER_TOP) continue;
    const a0 = Math.max(0, Math.ceil(b.p[0] - b.s[0] / 2 - i0)), a1 = Math.min(width - 1, Math.floor(b.p[0] + b.s[0] / 2 - i0));
    const c0 = Math.max(0, Math.ceil(b.p[2] - b.s[2] / 2 - j0)), c1 = Math.min(depth - 1, Math.floor(b.p[2] + b.s[2] / 2 - j0));
    for (let j = c0; j <= c1; j++) for (let i = a0; i <= a1; i++) cells[j * width + i] = GEO_WATER;
  }
  const landmarks = (built.zones ?? []).filter((z) => z.kind === "landmark")
    .map((z) => [tx(z.i0) + (z.w - 1) / 2, tz(z.j0) + (z.d - 1) / 2] as [number, number]);
  const out = { width, depth, cells, landmarks };
  cache.set(built, out);
  return out;
}

/** Bir satırdaki aynı türden ardışık karoları tek dikdörtgene birleştirir (çizim çağrısı az): [i, j, uzunluk, tür]. */
export function geoRuns(g: MiniGeo): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let j = 0; j < g.depth; j++) {
    let i = 0;
    while (i < g.width) {
      const v = g.cells[j * g.width + i];
      let n = 1;
      while (i + n < g.width && g.cells[j * g.width + i + n] === v) n++;
      out.push([i, j, n, v]);
      i += n;
    }
  }
  return out;
}
