/**
 * HQA-FIX — taşıt şeritleri: yürüme modundaki taşıtların (vapur, tekne, tramvay, otobüs, taksi…) yol boyunca süpürdüğü
 * hacim. Kamera kadrajı (`activityFraming.ts`) bu hacmin içine kamera koymaz ve kamera → yüz doğrusunu şeritten geçirmez: eskiden
 * etkinlik kadrajı yalnız durağan blokları görüyordu; İstanbul'da olta kamerası iki vapur şeridinin arasında, su üstünde, göz
 * hizasında duruyordu ve vapur geçince kare vapur gövdesinin İÇİNDE kalıyordu ("Çek!" anında ekran gri/lacivert düz yüzey).
 *
 * Ölçü: gövde kutusu (`props/movers.ts SHAPES`, `scale.ts shapeDim`) × sahne ölçeği × yürüme çarpanı (`moverFit.ts`: fx boy, fy
 * yükseklik, fz en); yol yürüme yolu (uçları kısaltılmış). Gidip-gelen/açık yolda uçlar gövde yarı boyu kadar uzar (durakta bekleyen
 * taşıt). Saf modül (React/three yok); dünya başına önbellekli. Test:.
*/
import { SHAPES } from "../props/movers";
import type { Built } from "../scenes";
import { moverFits } from "./moverFit";
import { shapeDim } from "./scale";

export interface MoverLane {
  ax: number; az: number; bx: number; bz: number;
  /** gövde yarı eni (yürüme ölçeği) */
  hw: number;
  /** hacmin alt ve üst yüksekliği (mutlak) */
  y0: number; y1: number;
  shape: string;
}

const cache = new WeakMap<object, MoverLane[]>();

/** Dünyanın taşıt şeritleri (yürüme ölçeğinde). */
export function moverLanes(built: Pick<Built, "movers" | "blocks" | "backdrop">): MoverLane[] {
  const hit = cache.get(built);
  if (hit) return hit;
  const out: MoverLane[] = [];
  const movers = built.movers ?? [];
  const fits = movers.length ? moverFits(built) : null;
  for (const m0 of movers) {
    const parts = SHAPES[m0.shape];
    if (!parts?.length || m0.path.length < 1) continue;
    const fit = fits?.get(m0) ?? null, m = fit?.mover ?? m0;
    const sc = m0.scale ?? 1;
    const hl = (shapeDim(parts, "length") / 2) * sc * (fit?.fx ?? 1);
    const hw = (shapeDim(parts, "width") / 2) * sc * (fit?.fz ?? 1);
    const top = shapeDim(parts, "top") * sc * (fit?.fy ?? 1);
    const ys = m.path.map((p) => p[1]);
    const y0 = Math.min(...ys) - 0.1, y1 = Math.max(...ys) + top + (fit?.shift?.[1] ?? 0);
    const pts = m.path.map((p) => [p[0] + (fit?.shift?.[0] ?? 0), p[2] + (fit?.shift?.[2] ?? 0)] as [number, number]);
    if (pts.length === 1) { out.push({ ax: pts[0][0], az: pts[0][1], bx: pts[0][0], bz: pts[0][1], hw: hw + hl, y0, y1, shape: m0.shape }); continue; }
    const loop = m.mode === "loop" && pts.length > 2;
    pts.forEach((p, k) => {
      if (k === 0) return;
      const [ax, az] = pts[k - 1], [bx, bz] = p;
      const l = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / l, uz = (bz - az) / l;
      const ea = !loop && k === 1 ? hl : 0, eb = !loop && k === pts.length - 1 ? hl : 0;
      out.push({ ax: ax - ux * ea, az: az - uz * ea, bx: bx + ux * eb, bz: bz + uz * eb, hw, y0, y1, shape: m0.shape });
    });
    if (loop) {
      const [ax, az] = pts[pts.length - 1], [bx, bz] = pts[0];
      out.push({ ax, az, bx, bz, hw, y0, y1, shape: m0.shape });
    }
  }
  cache.set(built, out);
  return out;
}

/** Noktanın şerit eksenine yatay uzaklığı. */
export function laneDist(l: MoverLane, x: number, z: number): number {
  const vx = l.bx - l.ax, vz = l.bz - l.az, l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - l.ax) * vx + (z - l.az) * vz) / l2)) : 0;
  return Math.hypot(x - (l.ax + vx * t), z - (l.az + vz * t));
}

/** Nokta bir taşıt şeridinin hacminde mi (`pad`: yatay ve dikey pay). */
export function inLane(lanes: readonly MoverLane[], p: { x: number; y: number; z: number }, pad = 0.35): MoverLane | null {
  for (const l of lanes) if (p.y >= l.y0 - pad && p.y <= l.y1 + pad && laneDist(l, p.x, p.z) < l.hw + pad) return l;
  return null;
}

/** a → b doğru parçasının geçtiği taşıt şeridi sayısı (uçlardan 0,3 içeride, 12 örnek). */
export function laneSegHits(lanes: readonly MoverLane[], a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, pad = 0.05): number {
  if (!lanes.length) return 0;
  const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1, hit = new Set<MoverLane>();
  for (let k = 0; k <= 12; k++) {
    const u = 0.3 / L + (k / 12) * Math.max(0, 1 - 0.6 / L);
    const p = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
    const l = inLane(lanes, p, pad);
    if (l) hit.add(l);
  }
  return hit.size;
}
