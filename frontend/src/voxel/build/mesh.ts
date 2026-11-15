/**
 * E3 (BUILD-UX) — inşa çizimi ve çarpışması. Saf modül (three yok).
 *
 * - `plotBuildBlocks`: gövde → dünya çerçevesinde `Block[]`. Bloklar kat başına, aynı kimlikli karolar açgözlü dikdörtgen
 * birleştirmeyle tek kutuya iner (plan §4.2 "Perf"); prefab'lar dünya yapıcının `bakePrefab`'ıyla pişer (aynı görünüm). Grup
 * yalnız sahnede var olan durağan gruplardan (`solid/glass/glow`); yoksa `solid` (üreteçle aynı kural → +0 çizim çağrısı).
 * Aynı gövde + çerçeve → aynı blok dizisi (BUILD-DET-001).
 * - `buildPhysics`: parselin çevre çarpışma ızgarasına (FREE/SOLID + karo AABB; `physics/world.ts` biçimi) gövde katmanındaki
 * (y < 2) blokları ve prefab ayak izlerini katı karo olarak işler. Avatar bu karolara giremez; tıkla-git onları dolaşır.
 * - `ghostBars`: hayalet çerçeve (12 kenar çubuğu; koyu dış + açık iç → açık/koyu zeminde AA kontrast). Kuyruğun ayrılmış
 * hayalet yuvasına yazılır (+0 çizim çağrısı; ayrı mesh yok).
*/
import { bakePrefab } from "../prefabs";
import { Builder, type Block, type Group } from "../scenes";
import { bx, bz, PD, PW } from "../expanse/grid";
import { ALL_BLOCKS, BLOCK_BY_ID, cellKey, PLOT_D, PLOT_H, PLOT_N, PLOT_W, tileKey, type PlotBody } from "./catalog";
import { BODY_LAYERS, prefabTiles } from "./volume";

/** Parsel çerçevesi: taban çerçevesinde parsel (cx, cz), zemin yüksekliği ve dünya kökeni (karo). */
export interface PlotFrame {
  cx: number;
  cz: number;
  h0: number;
  origin: readonly [number, number];
}

/** Hücrenin (li, y, lj) dünya çerçevesinde alt köşesi. */
export function cellMin(f: PlotFrame, li: number, y: number, lj: number): [number, number, number] {
  return [bx(f.cx * PW + li) - 0.5 + f.origin[0], f.h0 + y, bz(f.cz * PD + lj) - 0.5 + f.origin[1]];
}

const BUILD_GROUPS: ReadonlySet<Group> = new Set<Group>(["solid", "glass", "glow"]);
const BLOCK_INDEX = new Map(ALL_BLOCKS.map((b, k) => [b.id, k]));
const r3 = (n: number) => +n.toFixed(3);

/** Kat başına aynı anahtarlı karoları dikdörtgenlere birleştirir: [li, lj, w, d, anahtar]. */
function mergeLayer(keys: Int32Array): [number, number, number, number, number][] {
  const used = new Uint8Array(PLOT_N), out: [number, number, number, number, number][] = [];
  for (let lj = 0; lj < PLOT_D; lj++) for (let li = 0; li < PLOT_W; li++) {
    const k0 = lj * PLOT_W + li, key = keys[k0];
    if (used[k0] || key < 0) continue;
    let w = 1;
    while (li + w < PLOT_W && !used[k0 + w] && keys[k0 + w] === key) w++;
    let d = 1;
    grow: while (lj + d < PLOT_D) {
      const row = (lj + d) * PLOT_W + li;
      for (let q = 0; q < w; q++) if (used[row + q] || keys[row + q] !== key) break grow;
      d++;
    }
    for (let a = 0; a < d; a++) used.fill(1, (lj + a) * PLOT_W + li, (lj + a) * PLOT_W + li + w);
    out.push([li, lj, w, d, key]);
  }
  return out;
}

/**
 * Gövde → dünya çerçevesi blokları. `groups`: sahnede var olan gruplar (yoksa her şey `solid`). Prefab'ın canlı/ışık grupları
 * (alev vb.) `solid`'e düşer; beyaz listede yoklar zaten.
 */
export function plotBuildBlocks(body: PlotBody, f: PlotFrame, groups?: ReadonlySet<Group> | null): Block[] {
  const grp = (g: Group): Group => (BUILD_GROUPS.has(g) && (!groups || groups.has(g)) ? g : "solid");
  const out: Block[] = [];
  const [di, dj] = f.origin;
  // bloklar: kat kat, kimlik dizini anahtar
  const layers: Int32Array[] = [];
  for (const e of body.edits) {
    const [li, y, lj, id] = e;
    if (y < 0 || y >= PLOT_H || li < 0 || li >= PLOT_W || lj < 0 || lj >= PLOT_D) continue;
    const k = BLOCK_INDEX.get(id);
    if (k === undefined) continue;
    (layers[y] ??= new Int32Array(PLOT_N).fill(-1))[tileKey(li, lj)] = k;
  }
  for (let y = 0; y < PLOT_H; y++) {
    const keys = layers[y];
    if (!keys) continue;
    for (const [li, lj, w, d, k] of mergeLayer(keys)) {
      const def = ALL_BLOCKS[k];
      out.push({
        p: [r3(bx(f.cx * PW + li) + (w - 1) / 2 + di), r3(f.h0 + y + 0.5), r3(bz(f.cz * PD + lj) + (d - 1) / 2 + dj)],
        s: [w, 1, d], c: def.color, g: grp(def.group), j: def.jit,
      });
    }
  }
  // prefab'lar: dünya yapıcı pişirmesi parsel yerel karosunda (renk/tohum konumdan bağımsız → dünya büyürken aynı; negatif
  // taban karosunda dizi indisi taşmaz), sonra parsel ötelemesi + zemin yüksekliği + köken
  const ox = f.cx * PW + di, oz = f.cz * PD + dj;
  body.prefabs.forEach((p, n) => {
    const b = new Builder(0x5eed ^ (n * 2654435761) ^ (p.i * 73856093) ^ (p.j * 19349663));
    bakePrefab(b, p);
    for (const q of b.blocks) {
      out.push({ p: [r3(q.p[0] + ox), r3(q.p[1] + f.h0), r3(q.p[2] + oz)], s: [q.s[0], q.s[1], q.s[2]], c: q.c, g: grp(q.g), j: q.j });
    }
  });
  return out;
}

/** Grup başına örnek sayısı (kuyruk kapasitesi için). */
export function countGroups(blocks: readonly Block[]): Record<"solid" | "glass" | "glow", number> {
  const n = { solid: 0, glass: 0, glow: 0 };
  for (const b of blocks) if (b.g === "glass" || b.g === "glow") n[b.g]++; else n.solid++;
  return n;
}

/** Üst sınır (çizim öncesi, birleştirmesiz): bloklar + prefab pişirme sayısı. Grup dağılımı varsayımsız (hepsi `solid`'e düşebilir). */
export function boundOf(body: PlotBody): { all: number; glass: number; glow: number } {
  let glass = 0, glow = 0;
  for (const e of body.edits) { const g = BLOCK_BY_ID.get(e[3])?.group; if (g === "glass") glass++; else if (g === "glow") glow++; }
  let all = body.edits.length;
  for (const p of body.prefabs) {
    const b = new Builder(1);
    bakePrefab(b, p);
    all += b.blocks.length;
    for (const q of b.blocks) if (q.g === "glow") glow++; else if (q.g === "glass") glass++;
  }
  return { all, glass, glow };
}

/**
 * Çarpışma: parselin üreteç ızgarasına (taban çerçevesi; `ParcelNear.solid` / `.box`) inşanın gövde katmanını ekler. Yeni dizi döner
 * (üretim önbelleği bozulmaz).
 */
export function buildPhysics(f: Pick<PlotFrame, "cx" | "cz">, solid: Uint8Array, box: Float32Array, body: PlotBody): { solid: Uint8Array; box: Float32Array } {
  const s = solid.slice(), b = box.slice();
  const mark = (li: number, lj: number) => {
    if (li < 0 || lj < 0 || li >= PW || lj >= PD) return;
    const k = lj * PW + li;
    s[k] = 1;
    const x0 = bx(f.cx * PW + li) - 0.5, z0 = bz(f.cz * PD + lj) - 0.5;
    b.set([x0, z0, x0 + 1, z0 + 1], k * 4);
  };
  for (const e of body.edits) if (e[1] < BODY_LAYERS) mark(e[0], e[2]);
  for (const p of body.prefabs) for (const [li, lj] of prefabTiles(p)) mark(li, lj);
  return { solid: s, box: b };
}

/** Yürünebilirlik (yerel): taban yürünebilirliği − gövde katmanı dolu karolar. */
export function buildWalk(walk: Uint8Array, body: PlotBody): Uint8Array {
  const w = walk.slice();
  for (const e of body.edits) if (e[1] < BODY_LAYERS && e[0] >= 0 && e[0] < PW && e[2] >= 0 && e[2] < PD) w[e[2] * PW + e[0]] = 0;
  for (const p of body.prefabs) for (const [li, lj] of prefabTiles(p)) if (li >= 0 && li < PW && lj >= 0 && lj < PD) w[lj * PW + li] = 0;
  return w;
}

/** Hayalet çerçevenin çubukları (dünya çerçevesi): `min` köşesi, boyut. Dış (koyu) ve iç (açık) iki katman. */
export const GHOST_BARS = 12;
export function ghostBars(min: readonly [number, number, number], size: readonly [number, number, number], t: number): Block[] {
  const [x0, y0, z0] = min, [w, h, d] = size;
  const out: Block[] = [];
  const e = 0.02; // yüzlerin hafif dışında (z-kavgası yok)
  const xs = [x0 - e, x0 + w + e], ys = [y0 - e, y0 + h + e], zs = [z0 - e, z0 + d + e];
  const cx = x0 + w / 2, cy = y0 + h / 2, cz = z0 + d / 2;
  for (const y of ys) for (const z of zs) out.push({ p: [cx, y, z], s: [w + 2 * e + t, t, t], c: "", g: "solid", j: 0 });
  for (const x of xs) for (const z of zs) out.push({ p: [x, cy, z], s: [t, h + 2 * e + t, t], c: "", g: "solid", j: 0 });
  for (const x of xs) for (const y of ys) out.push({ p: [x, y, cz], s: [t, t, d + 2 * e + t], c: "", g: "solid", j: 0 });
  return out;
}

/** Hücre doluluğu (ışın için): blok hücresi ya da prefab sütunu (y < 2). */
export function solidCell(cells: ReadonlyMap<number, number>, prefab: Int16Array, li: number, y: number, lj: number): "block" | "prefab" | null {
  if (cells.has(cellKey(li, y, lj))) return "block";
  if (y < BODY_LAYERS && prefab[tileKey(li, lj)] >= 0) return "prefab";
  return null;
}
