/**
 * E3 (BUILD-UX) — yapı modu seçimi: kamera ışını parselin **mantıksal hacmine** (12 × 8 × 16 küp ızgarası) karşı DDA ile atılır
 * ( "Seçim"; Amanatides–Woo). Instanced mesh'e karşı atılmaz: maliyet O(adım), örnek dizisinden
 * bağımsız. Saf modül (three yok).
 *
 * Sonuç: vurulan hücre (`hit`: blok ya da prefab sütunu) ve yerleştirme hücresi (`place`: vurulan yüzün önündeki boş hücre ya da
 * ışının zemine (y = 0 tabanı) değdiği hücre). Hacmin dışından gelen ışının ilk vurduğu yüzün önü hacim dışındaysa `place` null.
*/
import { PLOT_D, PLOT_H, PLOT_W } from "./catalog";

export type Cell = [number, number, number];
export interface RayHit {
  /** ışının vurduğu dolu hücre (kır) */
  hit: Cell | null;
  hitKind: "block" | "prefab" | null;
  /** yerleştirme hücresi (koy) */
  place: Cell | null;
  /** `place` zemin (y = 0 tabanı) üzerinde mi */
  ground: boolean;
  /** ışın parametresi (dünya birimi) */
  t: number;
}

/**
 * @param o ışın kökeni (dünya)
 * @param d ışın yönü (birim)
 * @param min hacmin (0, 0, 0) hücresinin alt köşesi (dünya)
 * @param solid (li, y, lj) dolu mu
 */
export function raycastVolume(
  o: readonly [number, number, number], d: readonly [number, number, number], min: readonly [number, number, number],
  solid: (li: number, y: number, lj: number) => "block" | "prefab" | null, maxT = 40,
): RayHit | null {
  const size = [PLOT_W, PLOT_H, PLOT_D];
  // yerel koordinat (hücre birimi)
  const p = [o[0] - min[0], o[1] - min[1], o[2] - min[2]];
  // hacme giriş/çıkış (slab)
  let t0 = 0, t1 = maxT;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (p[a] < 0 || p[a] > size[a]) return null; continue; }
    let ta = (0 - p[a]) / d[a], tb = (size[a] - p[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  const eps = 1e-6;
  const q = [p[0] + d[0] * (t0 + eps), p[1] + d[1] * (t0 + eps), p[2] + d[2] * (t0 + eps)];
  const c = [0, 1, 2].map((a) => Math.min(size[a] - 1, Math.max(0, Math.floor(q[a]))));
  const step = d.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
  const tMax = [0, 1, 2].map((a) => (step[a] === 0 ? Infinity : t0 + ((c[a] + (step[a] > 0 ? 1 : 0)) - q[a]) / d[a] + eps));
  const tDelta = d.map((v) => (v === 0 ? Infinity : Math.abs(1 / v)));
  let prev: Cell | null = null;
  // ışın hacmin dışından girdiyse ilk hücrenin önü hacim dışıdır; içinden başladıysa önceki hücre yok
  let t = t0;
  for (let guard = 0; guard < 64; guard++) {
    const cell: Cell = [c[0], c[1], c[2]];
    const kind = solid(cell[0], cell[1], cell[2]);
    if (kind) return { hit: cell, hitKind: kind, place: prev, ground: false, t };
    // sonraki sınır
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    t = tMax[a];
    if (t > t1 + 1e-4 || t > maxT) {
      // hacimden çıkış: tabandan çıktıysa zemine değdi
      if (a === 1 && step[1] < 0 && c[1] === 0) return { hit: null, hitKind: null, place: cell, ground: true, t };
      return null;
    }
    if (a === 1 && step[1] < 0 && c[1] === 0) return { hit: null, hitKind: null, place: cell, ground: true, t };
    prev = cell;
    c[a] += step[a];
    if (c[a] < 0 || c[a] >= size[a]) return null;
    tMax[a] += tDelta[a];
  }
  return null;
}
