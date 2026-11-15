/**
 * SP-W0 — şehir büyüme teması tabanı: şehir sahneleri (Dalga 1+) büyürken
 * "aynı şehrin devamı" olan bölgeler: ekip pod'u = kafe terası adası (masa + şemsiye tente, `sit_chair`/`laptop`),
 * olanaklar dönüşümlü çarşı, rıhtım (iç havuz + köprü + iskele kancası), şehir parkı ve otel/pansiyon (`dist_dorm`, 12+
 * yatak); avlu = meydan. Bütün yapılar `voxel/city/kit.ts` yardımcılarıyla ve şehrin `CityStyle`'ıyla çizilir.
 *
 * Kullanım (şehir dosyası): `themes.ts` kaydına `istanbul: cityTheme(ISTANBUL_STYLE, "dist_istanbul_hq")`. Sözleşme
 * (themes.ts başı): lj 0 / li 0 yolları boş, pod yuvaları ve koridorlar (lj 2/7/12, li 6/11) boş; ön şerit uyku yerleri.
 * `rules.mjs` `city-theme:<n>` vakaları bu temayı varsayılan stille 20/60/150 ajanda bütün kurallara karşı denetler.
*/
import { addMover, cityBench, cityTree, kiosk, marketStall, quay, rowHouse, streetLamp, waterBody, type StallKind } from "../city/kit";
import { pick2, type CityStyle, type TreeKind } from "../city/style";
import { Builder, key, tx, tz, type Tile } from "../scenes";
import { DOWN, fenceZ, flowerBed, planter, rug, scatter, UP } from "./parts";
import { breakSpot, seatSide, teamCorner, type Amenity, type Bay, type Theme } from "./themes";
import { venueFront, workVenue } from "../workzones/venues";

/** Döşeme taşı süsleri (engellemez, 4 cm): meydanlarda düz boş zemini kırar (DIST-DENSITY-001). */
function inlays(x: Bay, n: number, seed: number, c: string) {
  scatter(x.b, x.i0, x.j0, n, seed, (px, pz, k) => x.b.box(px, 0.02, pz, k % 2 ? 0.5 : 0.36, 0.04, k % 2 ? 0.36 : 0.5, c, "solid", 0.04),
    (li, lj) => li === 6 || lj === 7 || lj === 12);
}
/** ağaç tacı (kit `cityTree` geometrisi, karo merkezine göre blok kutuları): tür başına bir kez ölçülür. Servi dar
 * (komşu karoları örtmez), palmiye geniş (yaprakları 1–2 karo taşar); çınar/kiraz/erguvan/huş tacı ±0,85 (eskisi gibi).*/
type Box = readonly [number, number, number, number]; // x0, x1, z0, z1
const CROWNS = new Map<TreeKind, Box[]>();
function crownOf(kind: TreeKind): Box[] {
  let c = CROWNS.get(kind);
  if (!c) {
    const t = new Builder(1, 3, 3);
    cityTree(t, 1, 1, kind);
    c = t.blocks.map((k): Box => [k.p[0] - k.s[0] / 2 - tx(1), k.p[0] + k.s[0] / 2 - tx(1), k.p[2] - k.s[2] / 2 - tz(1), k.p[2] + k.s[2] / 2 - tz(1)]);
    CROWNS.set(kind, c);
  }
  return c;
}
/** CITY-CORE-001 ile aynı ölçü: çekirdek (burada taban dikdörtgeni) 0,4 kenar payı içe çekilir; taç bloğu bu kutuya girerse true. */
function crownIntrudes(keep: NonNullable<Bay["keep"]>, i: number, j: number, crown: readonly Box[]): boolean {
  const E = 0.4, X0 = tx(keep.i0) - 0.5 + E, X1 = tx(keep.i0 + keep.w - 1) + 0.5 - E;
  const Z0 = tz(keep.j0) - 0.5 + E, Z1 = tz(keep.j0 + keep.d - 1) + 0.5 - E;
  const x = tx(i), z = tz(j);
  return crown.some(([a, b, c, d]) => x + b > X0 && x + a < X1 && z + d > Z0 && z + c < Z1);
}

/** GROWTH — halka düzeninde tacı çekirdeğe 0,4'ten derin taşacak ağaç yerine saksı (CITY-CORE-001); şehir temalarının kendi
 * olanakları da kullanır (ör. <city> botanik parkı: plan değişince bölge çekirdeğe komşu olabilir).*/
export function keepTree(x: Bay, li: number, lj: number, kind: TreeKind): void {
  if (x.keep && crownIntrudes(x.keep, x.I(li), x.J(lj), crownOf(kind))) { planter(x.b, x.I(li), x.J(lj)); return; }
  cityTree(x.b, x.I(li), x.J(lj), kind);
}

/**
 * REAL-SEAT-001 — dinlenme karosu ZEMİNDE olur (ajan y = 0'da çöker; `Crowd.tsx` "slump"): bank/tabure/kutu üstündeki ya da
 * engelli karodaki dinlenme noktası en yakın temiz zemin karosuna taşınır (yoksa düşer). Bütün büyüme temaları
 * `groundRest` ile sarılır (districts/hotel.ts `withHotel`); kaynaklar da ayrıca zemine yazılmıştır, bu ağ gelecekteki
 * şehir temalarında aynı hatanın tekrarını önler. Yalnız o çağrıda eklenen dinlenme karolarına dokunur.
 */
const FLOOR_G = new Set(["solid", "glass", "water", "spin"]);
const REST_REACH = 3;
const clearOf = (blocks: Builder["blocks"], px: number, pz: number, r: number): boolean => {
  for (const q of blocks) {
    if (!FLOOR_G.has(q.g)) continue;
    const top = q.p[1] + q.s[1] / 2;
    if (top <= 0.08 || top > 1.2 || q.p[1] - q.s[1] / 2 > 1.2) continue;
    if (Math.abs(px - q.p[0]) < q.s[0] / 2 + r && Math.abs(pz - q.p[2]) < q.s[2] / 2 + r) return false;
  }
  return true;
};
export function settleRest(x: Bay, rest0: number, blk0: number): void {
  const { b } = x;
  if (b.rest.length <= rest0) return;
  const blocks = b.blocks.slice(blk0);
  if (!blocks.length) return;
  let used: Set<string> | null = null;
  const li0 = x.i0, lj0 = x.j0;
  const out: Tile[] = [];
  for (let k = rest0; k < b.rest.length; k++) {
    const [i, j] = b.rest[k];
    if (clearOf(blocks, tx(i), tz(j), 0.02) && !b.blocked.has(key(i, j))) { out.push([i, j]); continue; }
    used ??= new Set([...b.stations.map((s) => key(...s.tile)), ...Object.values(b.spots).flatMap((l) => (l ?? []).map((s) => key(...s.tile))),
      ...b.rest.slice(0, rest0).map((t) => key(...t)), ...b.rest.slice(rest0).map((t) => key(...t))]);
    let best: Tile | null = null, bc = Infinity;
    for (let di = -REST_REACH; di <= REST_REACH; di++) for (let dj = -REST_REACH; dj <= REST_REACH; dj++) {
      const ni = i + di, nj = j + dj, li = ni - li0, lj = nj - lj0;
      if (!di && !dj) continue;
      if (li < 1 || li > 11 || lj < 1 || lj > 15 || used.has(key(ni, nj)) || b.blocked.has(key(ni, nj))) continue;
      const cost = Math.abs(di) + Math.abs(dj) + (li === 6 || lj === 2 || lj === 7 || lj === 12 ? 0.5 : 0);
      if (cost >= bc || !clearOf(blocks, tx(ni), tz(nj), 0.3)) continue;
      best = [ni, nj]; bc = cost;
    }
    if (best) { used.add(key(...best)); out.push(best); }
  }
  b.rest.length = rest0;
  b.rest.push(...out);
}

/** Büyüme teması sarmalayıcı: tema işlevlerinin eklediği dinlenme karoları zemine oturtulur (`settleRest`). Saf; aynı girdi → aynı tema. */
export function groundRest(th: Theme): Theme {
  const around = <A extends unknown[]>(f: (x: Bay, ...a: A) => void) => (x: Bay, ...a: A): void => {
    const r = x.b.rest.length, k = x.b.blocks.length;
    f(x, ...a);
    settleRest(x, r, k);
  };
  const wrap = (a: Amenity): Amenity => ({ ...a, build: around(a.build) });
  return { ...th, work: around(th.work), spare: around(th.spare), amenities: th.amenities.map(wrap), yard: wrap(th.yard),
    ...(th.hotel ? { hotel: wrap(th.hotel) } : {}), ...(th.coast ? { coast: wrap(th.coast) } : {}), ...(th.row0 ? { row0: around(th.row0) } : {}) };
}

function noticeBoard(b: Builder, i: number, j: number, face: string, frame: string) {
  b.box(tx(i), 0.6, tz(j), 0.1, 1.2, 0.1, frame);
  b.box(tx(i), 1.25, tz(j), 1.0, 0.7, 0.08, frame, "solid", 0.02);
  b.box(tx(i), 1.25, tz(j) + 0.05, 0.85, 0.55, 0.02, face);
  b.block(i, j);
}
function bookCart(b: Builder, i: number, j: number, s: CityStyle) {
  b.box(tx(i), 0.5, tz(j), 0.86, 0.7, 0.6, "#3F6E5A", "solid", 0.03);
  for (let k = 0; k < 4; k++) b.box(tx(i) - 0.27 + k * 0.18, 0.95, tz(j), 0.14, 0.24, 0.4, s.awnings[k % s.awnings.length]);
  // CITY-PASS-IST (REAL-SUPPORT): saçak dört köşe dikmesinde, gövde tekerlekler üstünde (eski: saçak ve gövde havada)
  for (const dx of [-0.42, 0.42]) for (const dz of [-0.31, 0.31]) b.box(tx(i) + dx, 1.0, tz(j) + dz, 0.04, 0.4, 0.04, "#2F3640");
  for (const dx of [-0.3, 0.3]) for (const dz of [-0.31, 0.31]) b.box(tx(i) + dx, 0.08, tz(j) + dz, 0.2, 0.16, 0.04, "#2F3640");
  b.box(tx(i), 1.2, tz(j), 0.95, 0.06, 0.7, "#3F6E5A");
  b.block(i, j);
}

export function cityTheme(s: CityStyle, hq = "dist_city_hq"): Theme {
  const iron = { c: "#2F3640", h: 0.75, t: 0.1, cap: "#2F3640", post: "#2F3640", every: 2 };
  const side = (li: number, lj: number) => pick2(s.ground.sidewalk, li, lj);
  const plaza = (li: number, lj: number) => pick2(s.ground.plaza, li, lj);

  /** taban ağacı her taban boyutunda ve her türde kurallara uyar (bugünkü 7 şehirde çıktı birebir aynı):
   * - Halka düzeninde (çekirdekli şehir, `x.keep`) tacı çekirdeğe 0,4'ten derin taşacak ağaç (palmiye, çekirdeğe ≤ 2 karo) yerine
   * aynı karoyu engelleyen saksı kurulur (CITY-CORE-001; yürünebilirlik aynı).
   * - Dar taç (servi) komşu karoları örtmediği için park/meydan boş zemin payı aşar (DIST-DENSITY-001): ağacın çevresine yerde,
   * engellemeyen bir ağaç çanağı (çakıl kenar + toprak) serilir; yol satır/sütunları (li 0, 6; lj 0, 7, 12) ve bölge dışı hariç.*/
  const crown = crownOf(s.tree);
  const narrow = !(crown.some((k) => k[0] < -0.5) && crown.some((k) => k[1] > 0.5) && crown.some((k) => k[2] < -0.5) && crown.some((k) => k[3] > 0.5));
  const span = (v: number, max: number, lanes: readonly number[]): [number, number] =>
    [v - 1 >= 1 && !lanes.includes(v - 1) ? v - 1 : v, v + 1 <= max && !lanes.includes(v + 1) ? v + 1 : v];
  const tree = (x: Bay, li: number, lj: number) => {
    const { b, I, J } = x;
    if (x.keep && crownIntrudes(x.keep, I(li), J(lj), crown)) { planter(b, I(li), J(lj)); return; }
    cityTree(b, I(li), J(lj), s.tree);
    if (!narrow) return;
    const [a, c] = span(li, 11, [6]), [d, e] = span(lj, 15, [7, 12]);
    const cx = (tx(I(a)) + tx(I(c))) / 2, cz = (tz(J(d)) + tz(J(e))) / 2, w = c - a + 0.9, dd = e - d + 0.9;
    b.box(cx, 0.03, cz, w, 0.06, dd, s.ground.quay[0], "solid", 0.02);
    b.box(cx, 0.035, cz, w - 0.3, 0.07, dd - 0.3, "#6B4A32", "solid", 0.02);
  };

  /** Pod masası: (i, j)–(i+1, j) bistro masası, dizüstü + fincan; sandalyeyi canlı dekor koyar (ahşap). */
  const seat = (b: Builder, i: number, j: number, face: "+z" | "-z", n: number) => {
    const { user, dz } = seatSide(j, face);
    const x = tx(i) + 0.5, z = tz(j);
    b.box(x, 0.74, z, 1.9, 0.06, 0.78, n % 2 ? "#F4EFE6" : "#E9E1D0", "solid", 0.02);
    for (const dx of [-0.8, 0.8]) b.box(x + dx, 0.36, z, 0.08, 0.72, 0.08, "#2F3640");
    b.laptop(tx(i), 0.77, z + dz * 0.12, user);
    b.box(tx(i + 1), 0.82, z + dz * 0.1, 0.12, 0.12, 0.12, "#F8FAFC");
    b.block(i, j); b.block(i + 1, j);
  };

  // ---- olanaklar
  const market: Amenity = {
    label: "dist_market",
    floor: (li, lj) => (lj === 7 || li === 6 ? side(li, lj) : plaza(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      const kinds: StallKind[] = ["fruit", "bread", "flowers", "books", "crafts", "tea"];
      let k = x.variant;
      for (const lj of [4, 10]) for (const li of [2, 3, 4, 8, 9, 10]) marketStall(b, s, I(li), J(lj), kinds[k++ % kinds.length]);
      for (const lj of [5, 11]) for (const li of [3, 9]) b.rest.push([I(li), J(lj)]);
      kiosk(b, s, I(10), J(13)); // kahve/mola noktası (10,14)
      streetLamp(b, s, I(5), J(2)); streetLamp(b, s, I(7), J(13));
      cityBench(b, I(3), J(14), "-z"); b.rest.push([I(3), J(13)]); // REAL-SEAT-001: dinlenme bankın önündeki zeminde (bank üstünde değil)
      planter(b, I(1), J(9)); planter(b, I(11), J(5));
      // sandık ve sepetler (tezgâh arkası, engellemez)
      for (const lj of [3, 9]) for (const li of [2, 4, 8, 10]) b.crate(tx(I(li)) + 0.25, 0, tz(J(lj)) - 0.2, 0.42, "#9A7442");
      inlays(x, 30, x.variant + 3, s.ground.quay[0]);
      b.hook("roof", I(9), J(4));
      x.sign = [tx(I(6)), 2.4, tz(J(4))];
    },
  };
  const waterfront: Amenity = {
    label: "dist_waterfront",
    floor: (li, lj) => (li >= 2 && li <= 10 && lj >= 6 && lj <= 11 ? "" : lj === 5 || lj === 12 ? pick2(s.ground.quay, li, lj) : side(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      waterBody(b, s, I(2), J(6), I(10), J(11), "sea");
      // köprü (li 6 koridoru yürünebilir kalır)
      for (let lj = 6; lj <= 11; lj++) {
        b.blocked.delete(`${I(6)},${J(lj)}`);
        b.box(tx(I(6)), -0.04, tz(J(lj)), 1, 0.14, 1, s.ground.quay[0], "solid", 0.03);
      }
      for (const sx of [-0.46, 0.46]) b.box(tx(I(6)) + sx, 0.3, (tz(J(6)) + tz(J(11))) / 2, 0.08, 0.5, 6, "#2F3640");
      quay(b, s, I(2), I(5), J(5), "+z", [I(3)]);
      quay(b, s, I(7), I(10), J(12), "-z", [I(9)]);
      for (const li of [2, 4, 8, 10]) b.rest.push([I(li), J(13)]);
      cityBench(b, I(3), J(14), "-z"); cityBench(b, I(9), J(14), "-z");
      kiosk(b, s, I(10), J(3)); // kahve noktası (10,4)
      streetLamp(b, s, I(2), J(3)); streetLamp(b, s, I(7), J(14));
      tree(x, 1, 14); tree(x, 11, 14);
      inlays(x, 10, x.variant + 7, s.ground.quay[1]);
      if (x.variant === 0) addMover(b, { shape: "boat", period: 26, phase: 0.2, scale: 0.8,
        path: [[tx(I(3)), -0.2, tz(J(8))], [tx(I(5)), -0.2, tz(J(8))], [tx(I(5)), -0.2, tz(J(10))], [tx(I(3)), -0.2, tz(J(10))]] });
      b.hook("perch", I(5), J(5));
      x.sign = [tx(I(6)), 1.6, tz(J(5))];
    },
  };
  const cityPark: Amenity = {
    label: "dist_citypark",
    floor: (li, lj) => (li === 6 || lj === 7 ? side(li, lj) : pick2(s.ground.grass, li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      for (const [li, lj] of [[3, 3], [9, 3], [3, 11], [9, 11], [1, 14], [11, 9]] as [number, number][]) tree(x, li, lj);
      // çeşme (gölet kancası): 2×2 havuz + orta sütun
      for (const [li, lj] of [[7, 8], [8, 8], [7, 9], [8, 9]]) { b.box(tx(I(li)), -0.25, tz(J(lj)), 1, 0.5, 1, s.water, "water"); b.block(I(li), J(lj)); }
      b.box((tx(I(7)) + tx(I(8))) / 2, 0.15, (tz(J(8)) + tz(J(9))) / 2, 2.2, 0.3, 2.2, s.ground.quay[0], "solid", 0.03);
      b.box((tx(I(7)) + tx(I(8))) / 2, 0.1, (tz(J(8)) + tz(J(9))) / 2, 1.8, 0.24, 1.8, s.water, "water");
      b.box((tx(I(7)) + tx(I(8))) / 2, 0.7, (tz(J(8)) + tz(J(9))) / 2, 0.3, 1.0, 0.3, s.ground.quay[0], "solid", 0.03);
      b.hook("pond", I(7), J(8), 1);
      flowerBed(b, I(2), J(5), 2, 1, s.awnings); flowerBed(b, I(9), J(5), 2, 1, s.awnings); flowerBed(b, I(3), J(9), 2, 2, s.awnings);
      cityBench(b, I(4), J(13), "-z"); cityBench(b, I(8), J(13), "-z"); b.rest.push([I(4), J(12)], [I(8), J(12)], [I(5), J(6)]); // dinlenme bankın önünde (zemin)
      breakSpot(b, I(10), J(14), "-z"); b.box(tx(I(10)), 0.5, tz(J(14)), 0.9, 0.9, 0.7, s.awnings[0], "solid", 0.03); b.block(I(10), J(14));
      streetLamp(b, s, I(5), J(2)); streetLamp(b, s, I(10), J(7));
      b.hook("grass", I(4), J(8), 3);
      x.sign = [tx(I(6)), 1.4, tz(J(7))];
    },
  };
  /** Otel/pansiyon (yatakhane, 12+ yatak): arkada otel cephesi, avluda pergola altında yatak sıraları. */
  const hotel: Amenity = {
    label: "dist_dorm",
    floor: (li, lj) => (li === 6 || lj === 7 || lj === 12 ? side(li, lj) : plaza(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      rowHouse(b, s, I(2), J(1), 4, 1, { floors: 3, door: 1 });
      rowHouse(b, s, I(7), J(1), 4, 1, { floors: 3, door: 2 });
      const quilts = ["#C8553D", "#4A6FA5", "#D9A441", "#3F7D6E"];
      let k = 0;
      for (const lj of [4, 9, 13]) {
        b.canopy(I(2), I(4), J(lj), J(lj), s.awnings[k % s.awnings.length], 1.9, "#5B4A3A");
        b.canopy(I(8), I(10), J(lj), J(lj), s.awnings[(k + 1) % s.awnings.length], 1.9, "#5B4A3A");
        for (const li of [2, 3, 4, 8, 9, 10]) { b.bed(I(li), J(lj), quilts[k++ % quilts.length]); b.sleep(I(li), J(lj), DOWN, "bed", 0.5); }
      }
      kiosk(b, s, I(1), J(10)); // kahve/mola (1,11)
      planter(b, I(11), J(6)); planter(b, I(1), J(5));
      b.rest.push([I(5), J(10)], [I(7), J(10)]);
      inlays(x, 6, x.variant + 11, s.ground.sidewalk[1]);
      b.hook("window", I(4), J(1));
      x.sign = [tx(I(6)), 3.0, tz(J(2))];
    },
  };
  const square: Amenity = {
    label: "dist_plaza",
    floor: (li, lj) => ((li + lj) % 4 === 0 ? pick2(s.ground.quay, li, lj) : plaza(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      // ortada çeşme + çevresinde banklar ve ağaçlar
      for (const [li, lj] of [[5, 6], [7, 6], [5, 8], [7, 8]]) { b.box(tx(I(li)), -0.25, tz(J(lj)), 1, 0.5, 1, s.water, "water"); b.block(I(li), J(lj)); }
      b.box(tx(I(6)), 0.18, tz(J(7)), 3.2, 0.36, 3.2, s.ground.quay[0], "solid", 0.03);
      b.box(tx(I(6)), 0.12, tz(J(7)), 2.8, 0.28, 2.8, s.water, "water");
      b.box(tx(I(6)), 0.8, tz(J(7)), 0.4, 1.3, 0.4, s.trim, "solid", 0.03);
      b.box(tx(I(6)), 1.5, tz(J(7)), 0.9, 0.12, 0.9, s.trim, "solid", 0.03);
      for (const [li, lj] of [[6, 6], [6, 8], [5, 7], [6, 7], [7, 7]]) b.block(I(li), J(lj));
      b.hook("pond", I(6), J(7), 1);
      for (const [li, lj] of [[2, 3], [10, 3], [2, 12], [10, 12]] as [number, number][]) tree(x, li, lj);
      cityBench(b, I(4), J(11), "-z"); cityBench(b, I(8), J(11), "-z"); cityBench(b, I(4), J(3), "+z"); cityBench(b, I(8), J(3), "+z");
      b.rest.push([I(4), J(10)], [I(8), J(10)], [I(4), J(4)], [I(8), J(4)]); // bankların önündeki zemin (REAL-SEAT-001: bank karosunda dinlenme yok)
      streetLamp(b, s, I(3), J(7)); streetLamp(b, s, I(9), J(7)); streetLamp(b, s, I(6), J(13));
      planter(b, I(1), J(7)); planter(b, I(11), J(7));
      breakSpot(b, I(10), J(14), "-z"); b.box(tx(I(10)), 0.5, tz(J(14)), 0.9, 0.9, 0.7, s.awnings[1], "solid", 0.03); b.block(I(10), J(14));
      inlays(x, 20, x.variant + 5, s.ground.quay[1]);
      b.hook("grass", I(6), J(10), 4);
      x.sign = [tx(I(6)), 2.1, tz(J(7))];
    },
  };

  return {
    hq, trim: s.trim, under: s.ground.under,
    path: (li, lj) => pick2(s.ground.street, li, lj),
    floor: side,
    work: (x) => {
      const { b, I, J } = x;
      // (ürün sahibi 2026-11-02: "bayraklı alanlar şehir dokusunu bozuyor"): arka sınır çit + ekip renkli pano yerine mekânın
      // dükkân cephesi (kafe/atölye/ortak çalışma/pazar ofisi; tente şehrin paletinden), fener koridordan (11,2) cepheye
      const venue = workVenue(x.kind === "team" ? x.team : null, x.kind === "team" ? 0 : x.variant);
      x.venue = venue;
      venueFront(x, s, venue, {
        read: (i, j) => bookCart(b, i, j, s),
        web: (i, j) => noticeBoard(b, i, j, "#93C5FD", s.lamp.post),
        plan: (i, j) => noticeBoard(b, i, j, "#E9D8A6", s.lamp.post),
      });
      fenceZ(b, I(1), J(2), J(15), [2, 7, 12].map(J), { ...iron, h: 0.6 });
      teamCorner(x, (bb, i, j) => cityBench(bb, i, j, "-z"));
      b.hook("roof", I(11), J(1));
    },
    seat, pose: "sit_chair", device: "laptop",
    pod: (x, pi, pj) => x.b.canopy(x.I(pi), x.I(pi + 3), x.J(pj + 1), x.J(pj + 2), x.color, 2.3, "#2F3640", "#F8FAFC"),
    aisle: (li, lj) => pick2(s.ground.quay, li, lj),
    sleeper: (b, i, j, k) => { b.mat(i, j, s.awnings[k % s.awnings.length]); b.sleep(i, j, DOWN, "mat", 0.06); },
    spare: (x, pi, pj, slot) => {
      const { b } = x;
      const i = x.I(pi), j = x.J(pj);
      if (slot % 2 === 0) {
        rug(b, i, j + 1, 3, 3, x.color);
        cityBench(b, i + 1, j + 2, "+z");
        b.rest.push([i, j + 1], [i + 2, j + 1], [i + 1, j + 3]); // üçüncüsü bankın önünde (bank karosunda dinlenme yok: REAL-SEAT-001)
        b.spot("plan", i + 2, j + 3, UP);
      } else {
        flowerBed(b, i + 1, j + 1, 2, 2, s.awnings);
        planter(b, i + 3, j + 3);
      }
    },
    amenities: [market, cityPark, waterfront, hotel],
    yard: square,
  };
}
