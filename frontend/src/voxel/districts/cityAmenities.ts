/**
 * GROWTH (ürün sahibi 2026-10-28: "bu genişleme alanları şehirle uyumlu olmalı") — otel mantığına geçen şehir temalarına uyku olanağının
 * (pansiyon avlusu, kapsül otel, pousada) yerine eklenen, şehre uygun birer olanak (districts/hotel.ts `withHotel`):
 * - İstanbul `dist_cesme` çeşme meydanı: taş sebil-çeşme (kemerli niş, bakır musluk, yalak), çınarlar, çay masaları, simitçi
 * - Londra `dist_londra_square` demir parmaklıklı bahçe meydanı (kapılar li 6 / lj 7), çınarlar, banklar, yeşil çay kulübesi
 * - <city> `dist_<city>_pocket` cep parkı: otomat köşesi, bambu saksıları, çakıl bahçesi, bisiklet parkı, banklar
 * - <city> `dist_<city>_praca` dalga desenli mozaik meydan, hindistancevizi büfesi, ağaçlar, tropik çiçek tarhları
 * - Kapadokya `dist_kapadokya_court` kilim avlusu: kilim askıları, küpler, alçak taş duvarlar, asma çardağı, çay masaları
 * - diğer şehirler `dist_pocketgarden` şehrin stiliyle küçük bahçe: havuzlu çeşme, çiçek tarhları, ağaçlar, banklar, büfe
 * Sözleşme (themes.ts başı): lj 0 / li 0 yolları boş; li 6 ve lj 7 geçitleri yürünebilir; mola + dinlenme noktası var. Bayrak,
 * yazı, logo, dinî/siyasi simge, gökkuşağı şeridi yok.
*/
import { cityBench, cityTree, kiosk, streetLamp } from "../city/kit";
import { pick2, type CityStyle } from "../city/style";
import { stool } from "../city/furniture";
import { tx, tz, type Builder } from "../scenes";
import { keepTree } from "./city";
import { fenceX, fenceZ, flowerBed, planter, scatter } from "./parts";
import type { Amenity, Bay } from "./themes";
import { fullCityAmenity } from "../../full/cityAmenities";

export const lane = (li: number, lj: number) => li === 6 || lj === 7;

/** Taş süsleri (engellemez): düz zemini kırar (DIST-DENSITY-001). */
export function inlays(x: Bay, n: number, seed: number, c: readonly [string, string]) {
  scatter(x.b, x.i0, x.j0, n, seed, (px, pz, k) => x.b.box(px, 0.02, pz, k % 2 ? 0.44 : 0.3, 0.04, k % 2 ? 0.3 : 0.44, c[k % 2], "solid", 0.04),
    (li, lj) => lane(li, lj) || lj === 12);
}
/** Çay masası (engelli) + iki tabure (z boyunca); dinlenme karoları masanın iki yanında, ZEMİNDE (REAL-SEAT-001: tabure ya da
 *  bank karosunda dinlenme yok — ajan y=0'da çöker). */
function teaTable(b: Builder, i: number, j: number, top: string, stoolC: readonly [string, string]) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.28, z, 0.08, 0.56, 0.08, "#3A3F47");
  b.box(x, 0.58, z, 0.66, 0.05, 0.66, top, "solid", 0.02);
  b.box(x + 0.12, 0.66, z, 0.06, 0.1, 0.06, "#B5462E", "glass");
  for (const dj of [-1, 1]) stool(b.box.bind(b), x, tz(j + dj), 0.405, 0.4, dj < 0 ? stoolC[0] : stoolC[1]);
  b.block(i, j);
  b.rest.push([i - 1, j], [i + 1, j]);
}
/** Bank + arkasındaki zemin karosunda dinlenme (<city> teması gibi; REAL-SEAT-001).*/
export function benchRest(b: Builder, i: number, j: number, face: "+z" | "-z") {
  cityBench(b, i, j, face);
  b.rest.push([i, face === "+z" ? j - 1 : j + 1]);
}

function cesme(s: CityStyle): Amenity {
  const STONE = "#D9CCB0", COPPER = "#C47A3A";
  return {
    label: "dist_cesme",
    floor: (li, lj) => (lane(li, lj) ? pick2(s.ground.sidewalk, li, lj) : pick2(s.ground.plaza, li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      // çeşme (li 8–10, lj 2): kemerli niş, saçaklı kornişli taş gövde, bakır musluk, yalak
      const cx = tx(I(9)), cz = tz(J(2));
      b.box(cx, 1.15, cz - 0.1, 2.8, 2.3, 0.8, STONE, "solid", 0.02);
      b.box(cx, 2.42, cz - 0.05, 3.3, 0.18, 1.1, "#B9A684", "solid", 0.02);
      b.box(cx, 2.62, cz - 0.1, 2.9, 0.24, 0.9, s.roofColor, "solid", 0.02);
      b.box(cx, 1.1, cz + 0.31, 1.1, 1.5, 0.04, "#B9A684");
      b.box(cx, 1.92, cz + 0.31, 0.7, 0.2, 0.04, "#B9A684");
      b.box(cx, 1.0, cz + 0.38, 0.08, 0.08, 0.16, COPPER);
      b.box(cx, 0.22, cz + 0.42, 1.4, 0.44, 0.36, STONE, "solid", 0.02);
      b.box(cx, 0.42, cz + 0.42, 1.2, 0.04, 0.26, s.water, "water");
      for (const li of [8, 9, 10]) b.block(I(li), J(2));
      // çınarlar, çay masaları, simitçi (mola), banklar, fenerler
      for (const [li, lj] of [[2, 4], [10, 11], [3, 13]] as const) cityTree(b, I(li), J(lj), "plane");
      teaTable(b, I(3), J(9), "#E9E1D0", ["#3F7D6E", "#C8553D"]);
      teaTable(b, I(9), J(5), "#E9E1D0", ["#C8553D", "#3F7D6E"]);
      kiosk(b, s, I(9), J(13), "#7A4E2A"); // simit/çay büfesi: mola (9, 14)
      benchRest(b, I(4), J(5), "+z"); benchRest(b, I(8), J(9), "-z");
      streetLamp(b, s, I(5), J(3)); streetLamp(b, s, I(7), J(13));
      flowerBed(b, I(2), J(2), 2, 1, ["#C8553D", "#D9A441", "#F4EFE6"]);
      inlays(x, 26, x.variant + 13, s.ground.quay);
      b.hook("roof", I(9), J(2));
      x.sign = [cx, 3.1, cz];
    },
  };
}

function gardenSquare(s: CityStyle): Amenity {
  const IRON = "#22282E";
  return {
    label: "dist_londra_square",
    floor: (li, lj) => (li >= 3 && li <= 9 && lj >= 4 && lj <= 11 && !lane(li, lj) ? pick2(s.ground.grass, li, lj) : pick2(s.ground.sidewalk, li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      // demir parmaklık (bahçe çevresi, kapılar li 6 ve lj 7): engelli ince çit, dikmeli, sivri başlıklı
      const rail = { c: IRON, h: 0.85, t: 0.06, post: IRON, every: 1, cap: IRON };
      fenceX(b, J(3), I(2), I(10), [I(6)], rail);
      fenceX(b, J(12), I(2), I(10), [I(6)], rail);
      fenceZ(b, I(2), J(4), J(11), [J(7)], rail);
      fenceZ(b, I(10), J(4), J(11), [J(7)], rail);
      for (const [li, lj] of [[4, 5], [8, 5], [4, 10], [8, 10]] as const) keepTree(x, li, lj, s.tree);
      flowerBed(b, I(5), J(9), 1, 1, s.awnings); flowerBed(b, I(7), J(5), 1, 1, s.awnings);
      benchRest(b, I(5), J(6), "+z"); benchRest(b, I(7), J(9), "-z"); benchRest(b, I(3), J(8), "-z");
      // yeşil çay kulübesi (mola), fenerler, varil saksılar
      kiosk(b, s, I(10), J(14), "#2E5E4E"); // mola (10, 15)
      streetLamp(b, s, I(5), J(2)); streetLamp(b, s, I(7), J(13)); streetLamp(b, s, I(1), J(8));
      planter(b, I(3), J(14), "#7A5534"); planter(b, I(11), J(5), "#7A5534");
      inlays(x, 18, x.variant + 17, s.ground.quay);
      b.hook("grass", I(4), J(8), 2);
      x.sign = [tx(I(6)), 1.6, tz(J(3))];
    },
  };
}

function kilimCourt(s: CityStyle): Amenity {
  const TUFF = "#E3C49E", WOOD = "#7A4E2A";
  const KILIM = ["#B9574A", "#3F7D6E", "#D9A441", "#7A3F3A"];
  return {
    label: "dist_kapadokya_court",
    floor: (li, lj) => (lane(li, lj) ? pick2(s.ground.sidewalk, li, lj) : pick2(s.ground.plaza, li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      // kilim askıları (li 2–4, lj 2): iki dikme + üst kiriş, asılı desenli kilimler
      b.box((tx(I(2)) + tx(I(4))) / 2, 1.9, tz(J(2)), 3.1, 0.1, 0.1, WOOD);
      for (const li of [2, 4]) b.box(tx(I(li)) + (li === 2 ? -0.45 : 0.45), 0.95, tz(J(2)), 0.1, 1.9, 0.1, WOOD);
      for (const [k, li] of [2, 3, 4].entries()) {
        b.box(tx(I(li)), 1.15, tz(J(2)), 0.86, 1.4, 0.04, KILIM[(k + x.variant) % KILIM.length]);
        for (const y of [0.7, 1.15, 1.6]) b.box(tx(I(li)), y, tz(J(2)) + 0.03, 0.6, 0.08, 0.02, "#F2E6D0");
        b.block(I(li), J(2));
      }
      // küpler (toprak kaplar), alçak tüf duvar parçaları
      for (const li of [9, 10]) { b.box(tx(I(li)), 0.4, tz(J(2)), 0.6, 0.8, 0.6, "#B4673E", "solid", 0.05); b.box(tx(I(li)), 0.84, tz(J(2)), 0.36, 0.08, 0.36, "#8E4E2E"); b.block(I(li), J(2)); }
      for (const [a, c] of [[2, 4], [8, 10]] as const) {
        b.box((tx(I(a)) + tx(I(c))) / 2, 0.35, tz(J(4)), c - a + 1, 0.7, 0.5, TUFF, "solid", 0.05);
        for (let li = a; li <= c; li++) b.block(I(li), J(4));
      }
      // asma çardağı (yeşil örtü) altında çay masaları; çay ocağı (mola)
      b.canopy(I(7), I(10), J(9), J(11), "#5E8A3A", 2.3, WOOD);
      teaTable(b, I(8), J(10), "#E9E1D0", ["#B9574A", "#3F7D6E"]);
      teaTable(b, I(3), J(10), "#E9E1D0", ["#D9A441", "#3F7D6E"]);
      kiosk(b, s, I(10), J(13), "#7A4E2A"); // mola (10, 14)
      benchRest(b, I(4), J(13), "-z");
      streetLamp(b, s, I(5), J(5)); streetLamp(b, s, I(7), J(13));
      inlays(x, 22, x.variant + 29, s.ground.quay);
      x.sign = [tx(I(3)), 2.4, tz(J(2))];
    },
  };
}

function pocketGarden(s: CityStyle): Amenity {
  return {
    label: "dist_pocketgarden",
    floor: (li, lj) => (lane(li, lj) ? pick2(s.ground.sidewalk, li, lj) : li >= 2 && li <= 10 && lj >= 3 && lj <= 11 ? pick2(s.ground.grass, li, lj) : pick2(s.ground.plaza, li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      // havuzlu çeşme (li 8–9, lj 9–10)
      for (const [li, lj] of [[8, 9], [9, 9], [8, 10], [9, 10]] as const) { b.box(tx(I(li)), -0.25, tz(J(lj)), 1, 0.5, 1, s.water, "water"); b.block(I(li), J(lj)); }
      const cx = (tx(I(8)) + tx(I(9))) / 2, cz = (tz(J(9)) + tz(J(10))) / 2;
      b.box(cx, 0.15, cz, 2.2, 0.3, 2.2, s.ground.quay[0], "solid", 0.03);
      b.box(cx, 0.1, cz, 1.8, 0.24, 1.8, s.water, "water");
      b.box(cx, 0.6, cz, 0.3, 0.9, 0.3, s.trim, "solid", 0.03);
      b.hook("pond", I(8), J(9), 1);
      for (const [li, lj] of [[3, 4], [9, 4], [3, 11]] as const) keepTree(x, li, lj, s.tree === "palm" ? "plane" : s.tree);
      flowerBed(b, I(2), J(8), 2, 1, s.awnings); flowerBed(b, I(4), J(13), 1, 1, s.awnings);
      benchRest(b, I(4), J(5), "+z"); benchRest(b, I(7), J(11), "-z");
      kiosk(b, s, I(10), J(13)); // mola (10, 14)
      streetLamp(b, s, I(5), J(2)); streetLamp(b, s, I(2), J(13));
      inlays(x, 18, x.variant + 31, s.ground.quay);
      x.sign = [tx(I(6)), 1.6, tz(J(7))];
    },
  };
}

/** Şehre uygun ek olanak(lar): uyku olanağı kalkınca dönüşüm çeşitliliği korunur. */
export function cityAmenities(id: string, s: CityStyle): Amenity[] {
  switch (id) {
    case "istanbul": return [cesme(s)];
    case "londra": return [gardenSquare(s)];
    case "kapadokya": return [kilimCourt(s)];
    default: return fullCityAmenity(id, s) ?? [pocketGarden(s)];
  }
}
