/**
 * W2-KAP — Kapadokya büyüme teması: `city` tabanı (districts/city.ts `cityTheme`) + Kapadokya stili + vadiye özgü olanaklar.
 * Büyüyen dünya "aynı vadinin devamı"dır: ekip pod'ları kafe terası adaları (taban tema; ön şeritte teras minderi), olanaklar
 * dönüşümlü olarak üzüm bağı ve vadi patikası, çömlek atölyesi sırası, mağara otel kanadı (`dist_dorm`, 18 yatak) ve balon
 * kalkış alanı; avlu köy meydanı (`dist_village`). Sözleşme (themes.ts başı): lj 0 / li 0 yolları ve li 6 / lj 7 koridorları
 * boş; her olanakta dinlenme + mola noktası. Dinî yapı yok (sacred yalnız taban sahnede); bayrak, logo, yazı yok.
 */
import { cityBench, kiosk, rowHouse } from "../city/kit";
import { pick2 } from "../city/style";
import { KAPADOKYA_STYLE as S } from "../city/styles/kapadokya";
import { CLAY, cushion, dryingRack, envelope, gridChimney, HONEY, KILIM, kilimRack, kiln, lanternPost, potteryStall, potteryWheel,
  reedCanopy, ROSE, TUFF, vineRow, vTree, WOOD } from "../scenes/kapadokya";
import { uprightBalloon } from "../city/landmarks/kapadokya/kit";
import { tx, tz, type Builder } from "../scenes";
import { cityTheme } from "./city";
import { DOWN, scatter } from "./parts";
import { breakSpot, type Amenity, type Bay, type Theme } from "./themes";

const side = (li: number, lj: number) => pick2(S.ground.sidewalk, li, lj);
const plaza = (li: number, lj: number) => pick2(S.ground.plaza, li, lj);
const grass = (li: number, lj: number) => pick2(S.ground.grass, li, lj);
const corridor = (li: number, lj: number) => li === 6 || lj === 7;

/** Tüf taşı ve testi kırığı süsleri (engellemez): düz zemini kırar (DIST-DENSITY-001). */
function pebbles(x: Bay, n: number, seed: number, colors: readonly string[] = [TUFF, ROSE]) {
  scatter(x.b, x.i0, x.j0, n, seed, (px, pz, k) => x.b.box(px, 0.04, pz, k % 2 ? 0.34 : 0.24, 0.08, k % 2 ? 0.24 : 0.34, colors[k % colors.length], "solid", 0.05),
    (li, lj) => corridor(li, lj));
}
/** Sazlı çardak (açık; seyrek çıtalar altındakileri örtmez): köşe direkleri karo kenarında (engellemez). CITY-PASS-KAP: çıtalar
 *  direklerin üstündeki iki kirişe oturur (taban sahne `reedCanopy`; eskiden çıtalar kirişsiz havadaydı). */
const reedPergola = (b: Builder, i0: number, i1: number, j0: number, j1: number) => reedCanopy(b, i0, i1, j0, j1);
/** Tüf kaya sırası (arka; i0…i1, j satırı; engelli): oyma pencereler (gece yanar) ve tepede küçük peri bacaları. */
function tuffRow(b: Builder, i0: number, i1: number, j: number, h: number, v: number) {
  const x = (tx(i0) + tx(i1)) / 2, w = i1 - i0 + 1;
  b.box(x, h / 2, tz(j), w, h, 1, v % 2 ? TUFF : HONEY, "solid", 0.03);
  b.box(x, h * 0.72, tz(j) + 0.51, w, 0.14, 0.04, ROSE);
  for (let i = i0; i <= i1; i++) {
    b.block(i, j);
    if ((i + v) % 2) continue;
    b.box(tx(i), h * 0.45, tz(j) + 0.51, 0.34, 0.5, 0.04, S.window);
    b.props.push({ k: "window", p: [tx(i), h * 0.45, tz(j) + 0.54], r: 0, s: [0.3, 0.46], c: S.windowLit });
  }
  b.box(tx(i0 + 1), h + 0.5, tz(j), 0.9, 1.0, 0.9, ROSE, "solid", 0.05);
  b.box(tx(i0 + 1), h + 1.12, tz(j), 0.62, 0.24, 0.62, "#6E5A4C", "solid", 0.03);
}

const vineyard: Amenity = {
  label: "dist_vineyard",
  floor: (li, lj) => (corridor(li, lj) ? pick2(S.ground.street, li, lj) : li === 1 || li === 11 || lj === 15 ? side(li, lj) : grass(li, lj)),
  build: (x) => {
    const { b, I, J } = x;
    for (const lj of [3, 5, 9, 11, 13]) { vineRow(b, I(2), I(5), J(lj)); vineRow(b, I(7), I(10), J(lj)); }
    vTree(b, I(1), J(1), "poplar"); vTree(b, I(11), J(9), "poplar"); vTree(b, I(1), J(12), "apricot");
    // hasat sepetleri (engellemez) ve şıra tezgâhı (mola)
    for (const [li, lj] of [[3, 4], [8, 10], [4, 12], [9, 6]] as [number, number][]) b.box(tx(I(li)) + 0.2, 0.18, tz(J(lj)), 0.5, 0.36, 0.4, "#B07D48", "solid", 0.05);
    kiosk(b, S, I(10), J(14), KILIM[0]); // mola (10,15)
    cityBench(b, I(3), J(15), "-z", "#8B5A2B", "#4A3A2E"); cityBench(b, I(8), J(15), "-z", "#8B5A2B", "#4A3A2E");
    b.rest.push([I(4), J(14)], [I(9), J(14)], [I(4), J(8)]); // bankın önündeki zemin (bank karosunda değil)
    lanternPost(b, I(5), J(1));
    pebbles(x, 12, x.variant + 2);
    b.hook("grass", I(4), J(8), 3);
    x.sign = [tx(I(6)), 1.6, tz(J(7))];
  },
};

const pottery: Amenity = {
  label: "dist_pottery",
  floor: (li, lj) => (corridor(li, lj) ? side(li, lj) : plaza(li, lj)),
  build: (x) => {
    const { b, I, J } = x;
    // iki atölye çardağı: çark gösterisi (S48 `play`), fırın, kurutma rafı
    reedPergola(b, I(2), I(4), J(2), J(5)); reedPergola(b, I(8), I(10), J(2), J(5));
    potteryWheel(b, I(3), J(4)); potteryWheel(b, I(9), J(4));
    kiln(b, I(2), J(2)); dryingRack(b, I(8), J(2), 2); kiln(b, I(10), J(2));
    // çömlek tezgâhı sırası (olanak: satıcı istasyonu yok, önü müşteri dinlenmesi)
    for (const li of [2, 3, 4, 8, 9, 10]) potteryStall(b, I(li), J(10), false);
    b.rest.push([I(3), J(11)], [I(9), J(11)], [I(5), J(4)]);
    kilimRack(b, I(2), J(14), 2, x.variant);
    kiosk(b, S, I(10), J(13), KILIM[1]); // çay ocağı: mola (10,14)
    cityBench(b, I(8), J(14), "-z", "#8B5A2B", "#4A3A2E"); b.rest.push([I(8), J(13)]);
    lanternPost(b, I(5), J(13)); lanternPost(b, I(11), J(8));
    for (let k = 0; k < 8; k++) b.box(tx(I(2)) + k * 0.36, 0.14, tz(J(12)) + (k % 2) * 0.2, 0.2, 0.28, 0.2, k % 3 ? CLAY : "#C9774E"); // testi sırası
    pebbles(x, 14, x.variant + 5, [CLAY, TUFF]);
    b.hook("roof", I(9), J(2));
    x.sign = [tx(I(6)), 2.4, tz(J(4))];
  },
};

/** Mağara otel kanadı (yatakhane, 18 yatak): arkada oyma tüf sırası, avluda kaya kemerleri altında yatak sıraları. */
const caveHotel: Amenity = {
  label: "dist_dorm",
  floor: (li, lj) => (corridor(li, lj) || lj === 12 ? side(li, lj) : plaza(li, lj)),
  build: (x) => {
    const { b, I, J } = x;
    tuffRow(b, I(1), I(5), J(1), 3.2, x.variant); tuffRow(b, I(7), I(11), J(1), 3.6, x.variant + 1);
    let k = 0;
    for (const lj of [4, 9, 13]) {
      for (const [a, c] of [[2, 4], [8, 10]]) {
        b.canopy(I(a), I(c), J(lj), J(lj), lj === 9 ? ROSE : TUFF, 1.9, HONEY, "#E9D3B0");
        for (let li = a; li <= c; li++) { b.bed(I(li), J(lj), KILIM[k++ % 4], "#8B5E3C", "#F2E6D0"); b.sleep(I(li), J(lj), DOWN, "bed", 0.5); }
      }
    }
    kiosk(b, S, I(1), J(10), KILIM[2]); // mola (1,11)
    b.rest.push([I(5), J(10)], [I(7), J(10)]);
    lanternPost(b, I(5), J(6)); lanternPost(b, I(11), J(6)); lanternPost(b, I(11), J(14));
    for (let li = 2; li <= 10; li++) if (li !== 6) b.rug1(I(li), J(15), KILIM[li % 4]);
    pebbles(x, 8, x.variant + 11);
    b.hook("window", I(4), J(1)); b.hook("perch", I(2), J(1));
    x.sign = [tx(I(6)), 3.0, tz(J(2))];
  },
};

/** Balon kalkış alanı: yere serili zarflar + sepetler, şişmekte olan bağlı balon (durağan), gaz tüpleri, izleme bankları. */
const balloonField: Amenity = {
  label: "dist_balloonfield",
  floor: (li, lj) => (corridor(li, lj) ? pick2(S.ground.street, li, lj) : grass(li, lj)),
  build: (x) => {
    const { b, I, J } = x;
    const v = x.variant;
    envelope(b, I(1), J(3), 4, ["#E5584E", "#4FA3A5"][v % 2], "#F2E6D0");
    envelope(b, I(7), J(3), 3, "#7A5C99", "#F2B33D");
    envelope(b, I(1), J(10), 4, "#F08A4B", "#3F6E8C");
    // CITY-PASS-KAP: yerde şişmiş, kalkmaya hazır balon (2×2): sepet zeminde, brülör çerçevesi, çelik halatlar, dilimli zarf
    uprightBalloon(b.box.bind(b), (tx(I(8)) + tx(I(9))) / 2, (tz(J(10)) + tz(J(11))) / 2, 0.95, v % 2 ? 4 : 1);
    for (const li of [8, 9]) for (const lj of [10, 11]) b.block(I(li), J(lj));
    // gaz tüpleri, rüzgâr tulumu
    for (const lj of [13, 14]) { for (const dz of [-0.2, 0.2]) b.box(tx(I(11)), 0.4, tz(J(lj)) + dz, 0.24, 0.8, 0.24, "#5B6470"); b.block(I(11), J(lj)); }
    b.box(tx(I(10)), 1.4, tz(J(1)), 0.08, 2.8, 0.08, "#5B4A3A"); b.box(tx(I(10)) + 0.35, 2.6, tz(J(1)), 0.6, 0.2, 0.2, "#F08A4B"); b.block(I(10), J(1));
    // balon izleme: banklar (göğe/kalkışa bakar) + örtü; çay ocağı (mola)
    for (const li of [2, 3, 4]) cityBench(b, I(li), J(14), "-z", "#8B5A2B", "#4A3A2E");
    b.rest.push([I(2), J(13)], [I(3), J(13)], [I(4), J(13)], [I(8), J(14)], [I(9), J(14)]);
    b.blanket(I(8), J(14), 2, 1, KILIM[(v + 1) % 4], "#F2E6D0");
    kiosk(b, S, I(5), J(12), KILIM[3]); // mola (5,13)
    lanternPost(b, I(5), J(5)); lanternPost(b, I(11), J(8));
    pebbles(x, 26, v + 7, [TUFF, "#9B9C56"]);
    b.hook("grass", I(4), J(8), 3);
    x.sign = [tx(I(6)), 1.6, tz(J(7))];
  },
};

/** Köy meydanı (avlu): tüf evler (düz damlı), taş kuyu, kayısı ağaçları, kilim asan tezgâhlar, banklar, çay ocağı. */
const village: Amenity = {
  label: "dist_village",
  floor: (li, lj) => ((li + lj) % 4 === 0 ? pick2(S.ground.quay, li, lj) : plaza(li, lj)),
  build: (x) => {
    const { b, I, J } = x;
    const v = x.variant;
    rowHouse(b, S, I(1), J(1), 2, 2, { floors: 2, wall: S.walls[(v + 0) % 5] });
    rowHouse(b, S, I(3), J(1), 2, 2, { floors: 1, wall: S.walls[(v + 1) % 5], shop: S.awnings[0] });
    rowHouse(b, S, I(8), J(1), 2, 2, { floors: 2, wall: S.walls[(v + 2) % 5] });
    rowHouse(b, S, I(10), J(1), 2, 2, { floors: 1, wall: S.walls[(v + 3) % 5] });
    gridChimney(b, I(5), J(1), 3.0, ROSE, true);
    // taş kuyu (su yok: bilezik + çıkrık)
    const wx = tx(I(5)), wz = tz(J(11));
    b.box(wx, 0.35, wz, 0.9, 0.7, 0.9, TUFF, "solid", 0.04); b.box(wx, 0.72, wz, 0.6, 0.04, 0.6, "#3A2A22");
    for (const dx of [-0.42, 0.42]) b.box(wx + dx, 1.1, wz, 0.08, 0.8, 0.08, WOOD);
    b.box(wx, 1.5, wz, 1.0, 0.08, 0.1, WOOD); b.block(I(5), J(11));
    for (const [li, lj] of [[2, 5], [10, 5], [2, 12], [10, 12]] as [number, number][]) vTree(b, I(li), J(lj), "apricot");
    kilimRack(b, I(3), J(9), 2, v + 1); kilimRack(b, I(8), J(9), 2, v + 2);
    for (const [li, lj, f] of [[4, 4, "+z"], [8, 4, "+z"], [4, 14, "-z"], [8, 14, "-z"]] as [number, number, "+z" | "-z"][]) {
      cityBench(b, I(li), J(lj), f, "#8B5A2B", "#4A3A2E"); b.rest.push([I(li), J(lj + (f === "+z" ? 1 : -1))]);
    }
    lanternPost(b, I(3), J(8)); lanternPost(b, I(9), J(13));
    breakSpot(b, I(10), J(14), "-z"); b.box(tx(I(10)), 0.5, tz(J(14)), 0.9, 0.9, 0.7, HONEY, "solid", 0.03);
    b.box(tx(I(10)), 1.04, tz(J(14)), 0.26, 0.18, 0.26, "#C47A3A"); b.block(I(10), J(14));
    for (let li = 2; li <= 10; li++) if (li !== 6 && li !== 5) b.rug1(I(li), J(11), KILIM[(li + v) % 4]);
    pebbles(x, 16, v + 13);
    b.hook("roof", I(2), J(1)); b.hook("roof", I(9), J(1));
    x.sign = [tx(I(6)), 2.1, tz(J(7))];
  },
};

/** Kapadokya büyüme teması (themes.ts kaydı: `kapadokya: kapadokyaTheme()`). */
export function kapadokyaTheme(): Theme {
  const base = cityTheme(S, "dist_kapadokya_hq");
  return {
    ...base,
    sleeper: (b, i, j, k) => cushion(b, i, j, k),
    amenities: [vineyard, pottery, caveHotel, balloonField],
    yard: village,
  };
}
