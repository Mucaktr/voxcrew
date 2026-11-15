/**
 * W1-IST — İstanbul büyüme teması: `city` tabanı (districts/city.ts `cityTheme`) + İstanbul stili + şehre özgü olanaklar.
 * Büyüyen dünya "aynı şehrin devamı"dır: ekip pod'ları kafe terası adaları (taban tema), olanaklar dönüşümlü olarak
 * kemerli çarşı, çay bahçesi, çınarlı şehir parkı, rıhtım, mahalle (ahşap konaklar) ve pansiyon (`dist_dorm`, 18 yatak);
 * avlu meydan. Sözleşme (themes.ts başı): lj 0 / li 0 yolları ve li 6 / lj 7 koridorları boş; dinlenme + mola noktası var.
 * Dinî yapı yok (sacred yalnız taban sahnede); bayrak, logo, yazı yok.
*/
import { CITY_STOREY, cityBench, cityTree, kiosk, marketStall, rowHouse, streetLamp, type StallKind } from "../city/kit";
import { pick2 } from "../city/style";
import { ISTANBUL_STYLE as S } from "../city/styles/istanbul";
import { PLAY_BOARD, tx, tz, type Builder } from "../scenes";
import { cityTheme } from "./city";
import { flowerBed, planter, scatter } from "./parts";
import { breakSpot, type Amenity, type Bay, type Theme } from "./themes";
import { stool } from "../city/furniture";

const STONE = "#CDBB9A", WOOD = "#7A4E2A", TEA = "#B5462E", COPPER = "#C47A3A";
const side = (li: number, lj: number) => pick2(S.ground.sidewalk, li, lj);
const plaza = (li: number, lj: number) => pick2(S.ground.plaza, li, lj);
const corridor = (li: number, lj: number) => li === 6 || lj === 7;

/** Arnavut kaldırımı taş süsleri (engellemez): düz zemini kırar (DIST-DENSITY-001). */
function cobbles(x: Bay, n: number, seed: number) {
  scatter(x.b, x.i0, x.j0, n, seed, (px, pz, k) => x.b.box(px, 0.02, pz, k % 2 ? 0.44 : 0.3, 0.04, k % 2 ? 0.3 : 0.44, S.ground.quay[k % 2], "solid", 0.04),
    (li, lj) => corridor(li, lj) || lj === 12);
}
/** Taş kemer (iki ayak engelli, kemer altı yürünebilir): `li` sütununu, `lj` satırında örter. */
function stoneArch(b: Builder, i: number, j: number) {
  for (const di of [-1, 1]) { b.box(tx(i + di), 1.2, tz(j), 0.7, 2.4, 0.7, STONE, "solid", 0.03); b.block(i + di, j); }
  b.box(tx(i), 2.6, tz(j), 3.1, 0.5, 0.8, STONE, "solid", 0.03);
  b.box(tx(i), 2.36, tz(j), 1.3, 0.12, 0.72, "#B0694A");
}
/** Çay masası (engelli) + iki tabure; tabure karoları dinlenme noktası. */
function teaRest(b: Builder, i: number, j: number) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.28, z, 0.08, 0.56, 0.08, "#3A3F47");
  b.box(x, 0.58, z, 0.66, 0.05, 0.66, "#E9E1D0", "solid", 0.02);
  for (const dz of [-0.14, 0.14]) b.box(x + 0.1, 0.67, z + dz, 0.06, 0.11, 0.06, TEA, "glass");
  for (const dj of [-1, 1]) stool(b.box.bind(b), x, tz(j + dj), 0.405, 0.4, dj < 0 ? "#3F7D6E" : "#C8553D"); // CORE-WALK: yere basan tabure
  b.block(i, j);
  b.rest.push([i, j - 1], [i, j + 1]);
}

/** CITY-PASS-IST (REAL-FACADE): kit `rowHouse` yalnız ön cepheye pencere koyar; konağın yan ve arka yüzlerine her katta pencere
 *  (camlı, duvara yapışık; gece ön cephe yanar). */
function konak(b: Builder, i0: number, j0: number, w: number, d: number, floors: number, wall: string, shop?: string) {
  rowHouse(b, S, i0, j0, w, d, { floors, wall, ...(shop ? { shop } : {}) });
  const x0 = tx(i0) - 0.5, x1 = tx(i0 + w - 1) + 0.5, z0 = tz(j0) - 0.5, zc = (tz(j0) + tz(j0 + d - 1)) / 2;
  for (let f = 0; f < floors; f++) {
    const wy = f * CITY_STOREY + CITY_STOREY * 0.55, wh = CITY_STOREY * 0.5;
    for (const x of [x0 - 0.02, x1 + 0.02]) b.box(x, wy, zc, 0.05, wh, 0.44, S.window, "glass");
    for (let k = 0; k < w; k++) b.box(tx(i0 + k), wy, z0 - 0.02, 0.44, wh, 0.05, S.window, "glass");
  }
}

const bazaar: Amenity = {
  label: "dist_bazaar",
  floor: (li, lj) => (corridor(li, lj) ? side(li, lj) : plaza(li, lj)),
  build: (x) => {
    const { b, I, J } = x;
    const kinds: StallKind[] = ["crafts", "tea", "fruit", "flowers", "bread", "books"];
    let k = x.variant;
    for (const lj of [4, 10]) for (const li of [2, 3, 4, 8, 9, 10]) marketStall(b, S, I(li), J(lj), kinds[k++ % kinds.length]);
    // tezgâh üstü renkli fenerler (gece yanar; ışık havuzu yok) ve asılı kilimler
    // CITY-PASS-IST (REAL-SUPPORT): fenerler tente altına kısa iple asılı (eski: tezgâh üstünde havada)
    for (const lj of [4, 10]) for (const li of [3, 9]) for (const dx of [-0.6, 0, 0.6]) {
      b.box(tx(I(li)) + dx, 1.75, tz(J(lj)) + 0.35, 0.16, 0.2, 0.16, ["#FFB86B", "#7FD1C7", "#F28FAD"][(li + lj + Math.round(dx * 5)) % 3], "glow");
      b.box(tx(I(li)) + dx, 1.93, tz(J(lj)) + 0.35, 0.02, 0.16, 0.02, "#3A3F47");
    }
    for (const li of [2, 10]) b.box(tx(I(li)), 1.5, tz(J(li === 2 ? 4 : 10)) - 0.36, 0.8, 1.0, 0.04, li === 2 ? "#9C3D2E" : "#3F5B7A", "solid", 0.05);
    stoneArch(b, I(6), J(1));
    for (const lj of [5, 11]) for (const li of [3, 9]) b.rest.push([I(li), J(lj)]);
    kiosk(b, S, I(10), J(13), "#3F7D6E"); // mola (10,14)
    streetLamp(b, S, I(5), J(13));
    cityBench(b, I(3), J(14), "-z"); b.rest.push([I(3), J(14)]);
    planter(b, I(1), J(9)); planter(b, I(11), J(5));
    for (const lj of [3, 9]) for (const li of [2, 4, 8, 10]) b.crate(tx(I(li)) + 0.25, 0, tz(J(lj)) - 0.2, 0.42, "#9A7442");
    cobbles(x, 28, x.variant + 3);
    b.hook("roof", I(9), J(4));
    x.sign = [tx(I(6)), 3.1, tz(J(1))];
  },
};
const teaGarden: Amenity = {
  label: "dist_teagarden",
  floor: (li, lj) => (corridor(li, lj) ? side(li, lj) : pick2(S.ground.grass, li, lj)),
  build: (x) => {
    const { b, I, J } = x;
    for (const [li, lj] of [[3, 4], [9, 4], [3, 10], [9, 10]] as [number, number][]) teaRest(b, I(li), J(lj));
    // çay ocağı: semaver + demlik (mola noktası önünde)
    const sx = tx(I(10)), sz = tz(J(13));
    b.box(sx, 0.45, sz, 0.9, 0.9, 0.8, WOOD, "solid", 0.04);
    b.box(sx, 1.08, sz, 0.3, 0.26, 0.3, COPPER, "solid", 0.03); b.box(sx, 1.32, sz, 0.38, 0.24, 0.38, COPPER, "solid", 0.03);
    b.box(sx, 1.5, sz, 0.2, 0.12, 0.2, "#F8FAFC");
    b.block(I(10), J(13)); breakSpot(b, I(10), J(13), "-x");
    // tavla masaları (S48 `play`; iki ucu x boyunca yürünebilir)
    for (const [li, lj] of [[3, 13], [9, 2]] as [number, number][]) {
      const i = I(li), j = J(lj);
      b.box(tx(i), 0.6, tz(j), 0.8, 0.05, 0.7, "#E9E1D0", "solid", 0.02);
      b.box(tx(i), 0.3, tz(j), 0.08, 0.6, 0.08, "#3A3F47");
      b.box(tx(i), 0.65, tz(j), 0.62, 0.05, 0.44, "#8B5A2B");
      for (const dx of [-1, 1]) stool(b.box.bind(b), tx(i + dx), tz(j), 0.385, 0.36, "#3F7D6E"); // tabureler (engellemez; yere basar)
      b.block(i, j); b.hook("play", i, j, PLAY_BOARD); // W2-INT: tavla — sessiz masa oyunu
    }
    for (const [li, lj] of [[1, 3], [11, 8], [1, 11], [5, 14], [11, 15]] as [number, number][]) cityTree(b, I(li), J(lj), "plane");
    // CITY-PASS-IST (REAL-SUPPORT): fener dizileri iki direğe gerili telde (eski: tel/direk yok, fenerler havada)
    for (const lj of [5, 11]) for (const [li, n] of [[2, 6], [8, 4]] as [number, number][]) {
      const x0 = tx(I(li)), z = tz(J(lj)) + 0.5, len = (n - 1) * 0.95 + 0.6;
      for (let k = 0; k < n; k++) {
        b.box(x0 + k * 0.95, k % 2 ? 2.29 : 2.37, z, 0.12, 0.14, 0.12, "#FFD98A", "glow");
        if (k % 2) b.box(x0 + k * 0.95, 2.4, z, 0.02, 0.08, 0.02, "#3A3F47");
      }
      b.box(x0 - 0.3 + len / 2, 2.45, z, len, 0.02, 0.02, "#3A3F47");
      for (const px of [x0 - 0.3, x0 - 0.3 + len]) b.box(px, 1.23, z, 0.07, 2.46, 0.07, WOOD);
    }
    flowerBed(b, I(4), J(1), 2, 1, S.awnings); flowerBed(b, I(8), J(15), 2, 1, S.awnings);
    streetLamp(b, S, I(5), J(9));
    b.hook("grass", I(4), J(8), 3);
    x.sign = [tx(I(6)), 1.6, tz(J(7))];
  },
};

const mahalle: Amenity = {
  label: "dist_mahalle",
  floor: (li, lj) => (corridor(li, lj) || lj === 3 ? side(li, lj) : pick2(S.ground.street, li, lj)),
  build: (x) => {
    const { b, I, J } = x;
    const v = x.variant;
    // arka sıra: ahşap konaklar (cumba), biri bakkal tenteli
    konak(b, I(1), J(1), 2, 2, 3, S.walls[(v + 0) % 5]);
    konak(b, I(3), J(1), 2, 2, 2, S.walls[(v + 1) % 5], S.awnings[0]);
    konak(b, I(7), J(1), 2, 2, 3, S.walls[(v + 2) % 5]);
    konak(b, I(9), J(1), 2, 2, 2, S.walls[(v + 3) % 5]);
    // basamaklar (kedilerin güneşlendiği taşlar) ve çamaşır ipi
    for (const li of [1.5, 3.5, 7.5, 9.5]) b.box(tx(I(0)) + li, 0.06, tz(J(3)) - 0.3, 1.4, 0.12, 0.4, "#BFB4A0", "solid", 0.03);
    b.box((tx(I(4)) + tx(I(7))) / 2, 3.0, tz(J(2)) + 0.6, 3.2, 0.02, 0.02, "#3A3F47");
    for (let k = 0; k < 5; k++) b.box(tx(I(4)) + 0.2 + k * 0.6, 2.8, tz(J(2)) + 0.6, 0.34, 0.36, 0.03, S.awnings[k % 4], "solid", 0.05);
    // ön sıra: alçak konaklar (iki kat; arkayı az örter) ve aralarında çeşme
    konak(b, I(1), J(9), 2, 2, 2, S.walls[(v + 4) % 5]);
    konak(b, I(9), J(9), 2, 2, 2, S.walls[(v + 1) % 5]);
    b.box(tx(I(4)), 0.6, tz(J(10)), 0.9, 1.2, 0.6, STONE, "solid", 0.03);
    b.box(tx(I(4)), 1.3, tz(J(10)), 1.0, 0.18, 0.7, "#B9A684");
    b.box(tx(I(4)), 0.12, tz(J(10)) + 0.45, 0.6, 0.12, 0.3, S.water, "water"); b.block(I(4), J(10));
    // mahalle bahçesi: çınar, banklar, kahvehane büfesi
    cityTree(b, I(8), J(5), "plane"); cityTree(b, I(3), J(13), "plane"); cityTree(b, I(10), J(14), "plane");
    cityBench(b, I(2), J(5), "+z"); cityBench(b, I(9), J(13), "-z"); b.rest.push([I(2), J(5)], [I(9), J(13)], [I(4), J(11)], [I(8), J(11)]);
    kiosk(b, S, I(5), J(13), "#3F7D6E"); // mola (5,14)
    flowerBed(b, I(1), J(14), 1, 1, S.awnings); planter(b, I(11), J(5)); planter(b, I(7), J(11));
    streetLamp(b, S, I(5), J(4)); streetLamp(b, S, I(10), J(8));
    cobbles(x, 14, v + 9);
    b.hook("roof", I(2), J(1)); b.hook("window", I(8), J(2)); b.hook("roof", I(10), J(9));
    x.sign = [tx(I(6)), 2.0, tz(J(4))];
  },
};

/** İstanbul büyüme teması (themes.ts kaydı: `istanbul: istanbulTheme()`). */
export function istanbulTheme(): Theme {
  const base = cityTheme(S, "dist_istanbul_hq");
  const [, park, waterfront, dorm] = base.amenities;
  return { ...base, amenities: [bazaar, teaGarden, park, waterfront, mahalle, dorm] };
}
