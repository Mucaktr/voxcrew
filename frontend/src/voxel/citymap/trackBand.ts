/**
 * raylı hatların (metro, tramvay, füniküler) gövde bandı. Durak varışında avatar rayın/aracın üstünde
 * (<city> saray_metro, <city> kanal_tram, Londra Çarşı) ve figüran trenin önünde durmasın diye tek kaynak: ray karosu (`T_RAIL`)
 * ya da karo merkezi rota çizgisine `TRACK_BAND` birimden yakınsa karo "ray bandı"ndadır. Gövde yarı eni 0,7 + avatar 0,28 = 0,98
 * (karşı komşu karo tam 1,0 uzaktır: dik komşu serbest, çapraz basamak karoları bantta). Saf; harita başına önbellekli.
*/
import type { CityMapFile } from "./format";
import { districtPlan, T_RAIL } from "./district";
import { lineRoute } from "../transit/model";

export const TRACK_BAND = 0.98;
const RAIL = new Set(["tramvay", "funikuler", "metro"]);
const cache = new WeakMap<CityMapFile, Set<string>>();

/** Raylı hat rotalarının çoklu çizgileri (şehir karosu). */
export function railPolylines(map: CityMapFile): [number, number][][] {
  return map.lines.filter((l) => RAIL.has(l.kind)).map((l) => lineRoute(map, l).map(([I, J]) => [I, J] as [number, number]));
}
function distToPoly(poly: readonly [number, number][], x: number, z: number): number {
  let best = Infinity;
  for (let k = 0; k + 1 < poly.length; k++) {
    const [ax, az] = poly[k], [bx, bz] = poly[k + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const u = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + dx * u), z - (az + dz * u)));
  }
  return best;
}
/** Ray bandındaki karolar ("I,J", şehir karosu). */
export function trackTiles(map: CityMapFile): Set<string> {
  let s = cache.get(map);
  if (s) return s;
  s = new Set<string>();
  for (const poly of railPolylines(map)) {
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let J = Math.min(...zs) - 1; J <= Math.max(...zs) + 1; J++) for (let I = Math.min(...xs) - 1; I <= Math.max(...xs) + 1; I++) {
      if (distToPoly(poly, I, J) < TRACK_BAND) s.add(`${I},${J}`);
    }
  }
  for (const d of map.districts) {
    const p = districtPlan(map, d);
    for (let lj = 0; lj < p.d; lj++) for (let li = 0; li < p.w; li++) if (p.kind[lj * p.w + li] === T_RAIL) s.add(`${p.i0 + li},${p.j0 + lj}`);
  }
  cache.set(map, s);
  return s;
}
export const onTrack = (map: CityMapFile, I: number, J: number) => trackTiles(map).has(`${I},${J}`);
