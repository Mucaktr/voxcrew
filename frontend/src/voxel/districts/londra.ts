/**
 * Londra büyüme teması (W2-LON; RB-LON: halka büyümede çekirdeğin dört yanına yerleşir, cepheler +z'ye bakar ve hiçbir
 * olanak belirli bir kenara/komşuya dayanmaz — her yanda çalışır; parkta ve kitapçı sokağında sokak bilgi köşkleri)
 *: `city` tema tabanının (`districts/city.ts cityTheme`) Londra
 * stiliyle devamı. Ekip pod'u = kafe terası adası (taban); olanaklar dönüşümlü:
 * B&B sırası (`dist_dorm`, teraslı ev cepheleri + 18 yataklı oda sıraları), kapalı pazar (`dist_market`, tezgâh sıralarının
 * üstünde demir direkli genel çarşı çatısı), nehir rıhtımı (`dist_waterfront`, taban: gezi teknesi + olta), park
 * (`dist_citypark`: ördek göleti, çalgı köşkü, şemsiyeli masalar, çınarlar) ve kitapçı sokağı (`dist_bookshop`: kitapçı
 * vitrinleri, kitap arabaları, okuma bankları); avlu = meydan (`dist_plaza`). Bütün yapılar `voxel/city/kit.ts` +
 * `city/styles/londra.ts`.
 *
 * Sözleşme (themes.ts başı): lj 0 / li 0 yolları boş; li 6 ve lj 7 / lj 12 geçitleri yürünebilir; ön kenarda (lj 15) yalnız
 * li 2–4 / 8–10 dolu. Olanaklarda istasyon yok, mola/dinlenme noktası var. Logo, tabela yazısı, marka yok.
*/
import { cityBench, cityTree, kiosk, streetLamp } from "../city/kit";
import { pick2 } from "../city/style";
import {
  aBoard, bandstand, barrelPlanter, bookshopFront, bookTrolley, brollyTable, LONDRA_QUILTS, LONDRA_STYLE, infoKiosk,
  reeds, roomRow, terraceRow,
} from "../city/styles/londra";
import { tx, tz, type Block, type Builder, type Spin } from "../scenes";
import { cityTheme } from "./city";
import { flowerBed, scatter } from "./parts";
import { breakSpot, type Amenity, type Bay, type Theme } from "./themes";

const IRON = "#22282E", MARKET_GREEN = "#2E5E4E";

/** Döşeme taşı süsleri (engellemez): düz boş zemini kırar (DIST-DENSITY-001). CITY-PASS-LON: kıpırdamayan süs güvercinleri
 *  kaldırıldı (canlı ortam güvercinleri Ambient'te); `birds` adedi de döşeme taşı olur. */
function paving(x: Bay, n: number, seed: number, c: string, birds = 4) {
  scatter(x.b, x.i0, x.j0, n, seed, (px, pz, k) => {
    void birds;
    x.b.box(px, 0.02, pz, k % 2 ? 0.5 : 0.36, 0.04, k % 2 ? 0.36 : 0.5, c, "solid", 0.04);
  }, (li, lj) => li === 6 || lj === 7 || lj === 12);
}

/** Londra'da ekip köşesinin bayrağı yerine aynı direkte ekip renginde dönen fırıldak (`spin`, z ekseni). Taban sahnede
 * dönen çark `spin` grubunu zaten açtığından ayrı `flag` grubu (+1 çizim çağrısı ve gölge geçişi) kalkar → gece ≤ 22 korunur;
 * canlılık sürer (hareket azaltmada durağan). Fırıldak direğin karosunda kalır (yarıçap 0,42 < 0,5; karo `flag` ile engelli).*/
function teamPinwheels(b: Builder, from: number): void {
  const out: Block[] = [];
  let n = 0;
  for (const q of b.blocks.slice(from)) {
    if (q.g !== "flag") continue;
    if (q.s[0] < 0.9) continue; // amblem kutusu: fırıldakta beyaz kanatlara dönüşür
    const x = q.p[0] - 0.55, y = q.p[1] + 0.2, z = q.p[2] + 0.1;
    const r: Spin = { a: "z", o: [x, y, z], w: 1.4, ph: (n++ * 1.7) % 6 };
    const emb = b.blocks.slice(from).find((e) => e.g === "flag" && e !== q && Math.abs(e.p[0] - q.p[0]) < 1e-6 && Math.abs(e.p[2] - q.p[2]) < 1e-6);
    const two = emb?.c ?? "#FFFFFF";
    for (const [dx, dy, w, h, c] of [[0.2, 0.06, 0.4, 0.12, q.c], [-0.06, 0.2, 0.12, 0.4, two], [-0.2, -0.06, 0.4, 0.12, q.c],
      [0.06, -0.2, 0.12, 0.4, two]] as const) out.push({ p: [x + dx, y + dy, z], s: [w, h, 0.03], c, g: "spin", j: 0, r });
    out.push({ p: [x, y, z + 0.02], s: [0.08, 0.08, 0.05], c: "#F2B33D", g: "solid", j: 0 });
  }
  if (!out.length) return;
  const keep = b.blocks.slice(from).filter((q) => q.g !== "flag");
  b.blocks.length = from;
  b.blocks.push(...keep, ...out);
}

export function londraTheme(): Theme {
  const s = LONDRA_STYLE;
  const base = cityTheme(s, "dist_londra_hq");
  // cityTheme olanak sırası: çarşı, şehir parkı, rıhtım, otel
  const [market, , waterfront] = base.amenities;
  const side = (li: number, lj: number) => pick2(s.ground.sidewalk, li, lj);
  const plaza = (li: number, lj: number) => pick2(s.ground.plaza, li, lj);
  const grass = (li: number, lj: number) => pick2(s.ground.grass, li, lj);
  const lane = (li: number, lj: number) => li === 6 || lj === 7 || lj === 12;

  /** B&B sırası (yatakhane, 18 yatak): arkada iki teraslı ev cephesi (bacalar), avluda üç sıra açık önlü oda (lj 4 / 9 / 13;
   *  li 2–4 ve 8–10), kahve kioskü, fıçı saksılar. */
  const bnb: Amenity = {
    label: "dist_dorm",
    floor: (li, lj) => (lane(li, lj) ? side(li, lj) : plaza(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      terraceRow(b, s, I(1), J(1), 5, 1, { floors: 3, door: 2 });
      terraceRow(b, s, I(7), J(1), 5, 1, { floors: 3, door: 2 });
      let k = x.variant;
      for (const lj of [4, 9, 13]) for (const li of [2, 8]) {
        roomRow(b, s, I(li), I(li + 2), J(lj), LONDRA_QUILTS, k, s.walls[k % s.walls.length]);
        k += 3;
      }
      kiosk(b, s, I(1), J(10), MARKET_GREEN); // kahve/mola: (1,11)
      barrelPlanter(b, I(11), J(6), "#E5484D"); barrelPlanter(b, I(1), J(5), "#A78BFA");
      b.rest.push([I(5), J(10)], [I(7), J(10)]);
      cityTree(b, I(11), J(10), s.tree); cityTree(b, I(1), J(14), s.tree);
      streetLamp(b, s, I(5), J(6));
      paving(x, 8, x.variant + 11, s.ground.sidewalk[1], 2);
      b.hook("window", I(4), J(1)); b.hook("roof", I(9), J(1));
      x.sign = [tx(I(6)), 3.0, tz(J(2))];
    },
  };

  /** Kapalı pazar: taban çarşı (tezgâh sıraları lj 4 / 10) + her tezgâh sırasının üstünde demir direkli, cam sırtlı genel
   *  çarşı çatısı. */
  const coveredMarket: Amenity = {
    label: market.label,
    floor: market.floor,
    build: (x) => {
      market.build(x);
      const { b, I, J } = x;
      for (const lj of [4, 10]) for (const li of [2, 8]) {
        b.canopy(I(li), I(li + 2), J(lj), J(lj), s.roofColor, 2.6, MARKET_GREEN, "#BFE3F5");
      }
    },
  };

  /** Park: ördek göleti (sazlık, `pond` kancası), çalgı köşkü, şemsiyeli masalar, çınarlar (sincap/kuş), banklar (dinlenme),
   *  çiçek tarhları, kahve arabası. */
  const park: Amenity = {
    label: "dist_citypark",
    floor: (li, lj) => (li === 6 || lj === 7 ? side(li, lj) : grass(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      // ördek göleti (li 2–4, lj 9–10)
      const px = tx(I(3)), pz = (tz(J(9)) + tz(J(10))) / 2;
      for (const lj of [9, 10]) {
        b.box(px, -0.3, tz(J(lj)), 3, 0.6, 1, s.water, "water");
        for (const li of [2, 3, 4]) b.block(I(li), J(lj));
      }
      b.box(px, 0.04, pz - 1.02, 3.2, 0.1, 0.12, s.ground.quay[0], "solid", 0.04);
      b.box(px, 0.04, pz + 1.02, 3.2, 0.1, 0.12, s.ground.quay[0], "solid", 0.04);
      reeds(b, px - 1.2, pz - 0.7, x.variant); reeds(b, px + 1.2, pz + 0.6, x.variant + 1);
      b.hook("pond", I(3), J(9), 1);
      b.rest.push([I(2), J(11)], [I(4), J(11)], [I(3), J(8)]);
      bandstand(b, I(8), J(3));
      b.rest.push([I(9), J(6)], [I(11), J(4)]);
      brollyTable(b, I(9), J(10), x.variant); brollyTable(b, I(9), J(14), x.variant + 1);
      b.rest.push([I(8), J(10)], [I(10), J(14)]);
      for (const [li, lj] of [[2, 3], [4, 5], [1, 14], [11, 9], [4, 14]] as [number, number][]) cityTree(b, I(li), J(lj), s.tree);
      flowerBed(b, I(2), J(5), 1, 1, s.awnings); flowerBed(b, I(8), J(13), 1, 1, s.awnings);
      cityBench(b, I(3), J(13), "-z"); cityBench(b, I(10), J(11), "+z");
      b.rest.push([I(3), J(12)], [I(10), J(12)]); // CITY-PASS-LON: dinlenme bankın önündeki zeminde (bank üstünde değil)
      breakSpot(b, I(11), J(14), "-z");
      b.box(tx(I(11)), 0.5, tz(J(14)), 0.9, 0.9, 0.7, s.awnings[0], "solid", 0.03); b.block(I(11), J(14));
      streetLamp(b, s, I(5), J(2)); streetLamp(b, s, I(7), J(10));
      infoKiosk(b, I(1), J(10)); // özgün sokak bilgi köşkü (yazısız)
      b.hook("grass", I(4), J(3), 2);
      x.sign = [tx(I(6)), 1.4, tz(J(7))];
    },
  };

  /** Kitapçı sokağı: iki teraslı kitapçı (cumba vitrin, kitap piktogramı), kitap arabaları, okuma bankları (dinlenme), A
   *  tahtası, fıçı saksılar, lambalar, çınar. Okuma bu bölgede dinlenme olarak; araç noktası taban sahnede. */
  const bookLane: Amenity = {
    label: "dist_bookshop",
    floor: (li, lj) => (lane(li, lj) ? side(li, lj) : plaza(li, lj)),
    build: (x) => {
      const { b, I, J } = x;
      terraceRow(b, s, I(1), J(1), 5, 2, { floors: 3, shop: s.awnings[x.variant % s.awnings.length], door: 4 });
      bookshopFront(b, I(1), 4, J(2));
      terraceRow(b, s, I(7), J(1), 5, 2, { floors: 3, shop: s.awnings[(x.variant + 2) % s.awnings.length], door: 0 });
      bookshopFront(b, I(8), 4, J(2));
      for (const [li, lj] of [[2, 5], [4, 5], [8, 5], [10, 5], [2, 10], [10, 10]] as [number, number][]) bookTrolley(b, I(li), J(lj));
      for (const [li, lj] of [[3, 9], [9, 9], [3, 14], [9, 14]] as [number, number][]) { cityBench(b, I(li), J(lj), "-z"); b.rest.push([I(li), J(lj - 1)]); }
      aBoard(b, I(5), J(4)); aBoard(b, I(7), J(9));
      barrelPlanter(b, I(1), J(9), "#E5484D"); barrelPlanter(b, I(11), J(13), "#F2EEE4");
      cityTree(b, I(1), J(14), s.tree); cityTree(b, I(11), J(9), s.tree);
      streetLamp(b, s, I(5), J(8)); streetLamp(b, s, I(7), J(13));
      kiosk(b, s, I(10), J(3), MARKET_GREEN); // kahve/mola: (10,4)
      infoKiosk(b, I(5), J(10)); infoKiosk(b, I(5), J(11));
      paving(x, 12, x.variant + 3, s.ground.quay[0], 4);
      b.hook("roof", I(3), J(1)); b.hook("perch", I(5), J(8));
      // asma lamba şeridi (dekor): lj 7 üstünde, iki uçta karo sınırındaki ince döküm direklere bağlı (CITY-PASS-LON: eskiden tel
      // havadaydı); direkler karo kenarında, yürüyüşü kapatmaz
      const xa = tx(I(2)) - 0.5, xb = tx(I(10)) + 0.5;
      for (let li = 2; li <= 10; li += 2) b.box(tx(I(li)), 2.43, tz(J(7)), 0.16, 0.16, 0.16, "#FFDDA0", "glow");
      b.box((xa + xb) / 2, 2.53, tz(J(7)), xb - xa, 0.03, 0.03, IRON);
      for (const px of [xa, xb]) b.box(px, 1.3, tz(J(7)) + 0.46, 0.06, 2.6, 0.06, IRON);
      for (const px of [xa, xb]) b.box(px, 2.53, tz(J(7)) + 0.23, 0.04, 0.04, 0.5, IRON);
      x.sign = [tx(I(6)), 3.0, tz(J(3))];
    },
  };

  return {
    ...base,
    work: (x) => { const from = x.b.blocks.length; base.work(x); teamPinwheels(x.b, from); },
    amenities: [bnb, coveredMarket, waterfront, park, bookLane],
  };
}
