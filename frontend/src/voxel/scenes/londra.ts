/**
 * Londra — BIG-LON büyük taban (36 × 32 karo, 3 × 2 bölge; çekirdek = bütün taban). CITY-PASS-LON (kalite seferberliği,
 * 2026-10-28): rıhtımlar ve otobüs yolu genişledi, simgeler gerçeğe göre yeniden kuruldu.
 * Kartpostal bakışı: kamera güney kıyıdan nehrin karşısına bakar (+z güney, +x doğu = Thames'in aşağı akışı).
 *
 * Yerleşim (j satır, i sütun):
 * - Kuzey kıyı (j 0–3): batıda kule bahçesi (i 0–4, çim), meclisi andıran Gotik yapı (i 5–14; batı ucunda kemerli geçitli
 * büyük kare kule i 5–7 — orta sütun i 6 arka kenardan rıhtıma yürünür), saat kulesi (i 15–16), doğuda teraslı evler, nehir
 * kafesi ve kahve kioskü. **Kuzey rıhtımı iki karo** (j 2–3; eskiden tek karoluk koridordu): j 3 nehir kenarı (banklar,
 * olta, ördek ritüeli), j 2 yürüyüş yolu.
 * - Thames (j 4–8, i 0–30; 5 karo) uzun ve geniş; sağda (i 26–30) güneye kıvrılıp ön kenara iner. Saat kulesinin yanında yeşil
 * taş kemer köprü (i 17–18). Sol kenarda iki karoluk yaya köprüsü (i 0–1), ön kenarda iki karoluk yaya köprüsü (j 30–31).
 * - Gözlem çarkı güney rıhtımının önünde, son su satırının üstünde (merkez i 23; transit/wheel.ts): kabinler nehrin üstünden
 * geçer, biniş rıhtım karosundan (23, 9); tek yanlı A çerçeve (65°) karada, ayakları bahçede (21 / 25, 13), gergi halatları
 * arkada ankraja (23, 14) iner.
 * - Güney rıhtımı (j 9–10; **iki karo**): nehre bakan çalışma yerleri (j 9), olta, fenerler, otobüs durağı (j 10). Nehir yolu
 * **iki şerit** (j 11–12; soldan akış: doğuya j 11, batıya j 12), güneyinde kaldırım (j 13). Kıvrım yolu iki şerit (i 19–20,
 * j 11–18), açılır köprü (j 16–19: kuzey yaya yolu, iki şerit, güney yaya yolu) doğu kıyısına. İki kırmızı çift katlı otobüs
 * aynı halka hatta (nehir yolu → kıvrım → köprü → geri) yarım tur arayla, şeritten şeride ≥ 1,1 aralıkla geçer.
 * - Çark bahçesi (i 21–25, j 9–15): A çerçeve ayakları ve ankraj (engelli), kahve kioskü (22, 15), bilgi köşkü, çarka bakan iki
 * bank (j 10), içme çeşmesi.
 * - Batı (i 0–5): kitapçı (i 0–2) ve köşe pubu (i 3–5) j 14–15, önlerinde iki karoluk yaya şeridi (j 16–17), okuma masaları ve
 * pub bahçe masaları (j 18; istasyonlar j 17 / 19), güneyde park (j 20–31: çalgı köşkü, ördek göleti + besleme, banklar).
 * - Orta (i 6–12): sarayı andıran neoklasik cephe (j 14–15), parmaklık (j 16; kapılar i 8–10), iki karoluk avlu (j 17–18), anıt
 * döner kavşağı (i 8–10, j 18–20) iki çeşmeyle (j 19–20), kırmızı bulvar (i 8–10, j 21–31) çift sıra çınar.
 * - Pazar ve çay salonu (i 13–18): kabuk terminali, kapalı pazar (i 14–18, j 14–16), **çay salonu** (ikindi çayı mekânı,
 * `cafe`: tezgâh j 19, sipariş karosu (16, 18), masa ve sandalyeler j 17).
 * - Sütunlu meydan (i 12–23, j 20–31): galeri cephesi (i 13–23, j 20–21), uzun sütun + aslanlar (i 17–18, j 25–26), iki çeşme,
 * banklar, güneyde balık-patates dükkânı (CORE-WALK `chip_shop`; tezgâh 16–18 × 30, sipariş (17, 29)).
 * - Doğu kıyı (i 31–35): HOTEL-SYS (E1) — şehrin tek oteli: küçük Georgian sıra ev oteli (i 33–34 × j 4–5, 2,46 yükseklik ≤ saray
 * cephesi 4,15 × 0,6; kapı (33, 6) geçit, içerisi Art Deco lobi). Eski açık B&B oda sıraları (15 yatak) yerine parmaklıklı
 * küçük bahçe (ağaçlar, çiçek tarhları, banklar); taş kale burcu (i 31–34, j 21–24), bilgi köşkü.
 *
 * IP / kültür: simgeler stilize "andıran" yorumlardır (kullanıcı kararı); logo, yazı, bayrak, kraliyet arması/monogramı, ulaşım
 * yuvarlak simgesi, adı konmuş heykel ya da gerçek kişi yok. Saat kadranında rakam yok. Korunan kırmızı kabin biçimi yok (yerine
 * bilgi köşkü). İbadet yapısı yok → sacred bölge gerekmez.
 *
 * Mantık (-WORK-001): istasyonlar dizüstü/tablet — rıhtım (sit_ground), bank (sit_bench), pub ve kafe
 * masası, okuma masası (sit_chair), pazar tezgâhı (stand + tablet). Uyku: doğu kıyısında beş oda sırası (15 yatak).
 * Araçlar: durak panosu = web, kitapçı = okuma, pub A tahtası = plan, pazar köşesindeki terminal = kabuk, saat kulesi önündeki
 * rıhtım = yazma. Eğlence: ördek göleti besleme (`feed`, FEED_ONLY), rıhtım oltaları (`fish`), yağmurda şemsiye.
 * Kenar sözleşmesi (36 × 32; büyüme koridorları li 6 / lj 2, 7, 12): arka kenarda i 6 (kule geçidi), 17–19, 29–31 açık; ön
 * kenarda i 5–7, 17–19, 29–31; sol/sağ kenarda j 0/2/7/12/16/18/23/28 yürünebilir; nehir sol ve ön kenarda yaya köprüsü
 * güvertesi altında kalır, kenarda açık su yok.
 *
 * Kayıt notu (scenes.ts ile döngüsel içe aktarma): yalnız fonksiyon ve sabit bildirimleri dışa aktarılır.
*/
import { addMover, archBridge, cafeSet, cafeStations, cityBench, cityTree, kiosk, marketStall, marketStation, quay, rowHouse,
  streetLamp } from "../city/kit";
import { fillSpotReach } from "../city/kit";
import { placeHotel } from "../districts/hotel";
import { flowerBed } from "../districts/parts";
import { pick2 } from "../city/style";
import {
  aBoard, bandstand, barrelPlanter, bookshopFront, busShelter, clockTower, gallery, LONDRA_QUILTS, LONDRA_STYLE, memorial,
  obsWheel, palace, palaceRail, parliament, infoKiosk, pillarBox, pubFront, pubTable, readingDesk, reeds,
  squareColumn, squareFountain, stoneKeep, teaRoomDecor, terraceRow, towerBridge,
} from "../city/styles/londra";
import { placeVenue, venueSolidTiles } from "../city/venues";
import { LONDRA_WHEEL } from "../transit/wheel";
import { Builder, FEED_ONLY, key, tx, tz, type Built, type SceneDef } from "../scenes";

const UP = 0, DOWN = Math.PI, RIGHT = Math.PI / 2;
const IRON = "#22282E", GREEN = "#2E5E4E";
/** Taban boyutu (3 × 2 bölge). */
const W = 36, D = 32;

/** Sahne ortamı (SCENES girdisine yayılır): şehir kademesi, Avrupa paketi, otomatik saat, aralıklı yağmur, IP 1 / kültür 0,
 *  BIG-LON çekirdeği = bütün 36 × 32 taban. */
export const LONDRA_ENV: Omit<SceneDef, "id" | "label" | "hint" | "build"> = {
  swatch: ["#D2B271", "#C8312B"],
  sky: "#B9C8D4", fog: [46, 100],
  hemi: ["#F4F6F8", "#B9AE9C", 1.2],
  sun: { color: "#F4EEE2", intensity: 1.5, pos: [14, 16, 18] },
  weather: ["rain"],
  tier: "city", pack: "world_tour_europe", time: "auto", ip_risk: 1, culture_risk: 0,
  core: { i0: 0, j0: 0, w: W, d: D },
};

/** Nehir: uzun kol (j 4–8, i 0–30) + sağda öne kıvrılan kol (i 26–30, j 9–31). Yollar: nehir yolu j 11–12, kıvrım yolu
 *  i 19–20 (j 11–18), köprü j 16–19 (şeritler 17–18). */
const RJ0 = 4, RJ1 = 8, ARM0 = 26, ARM1 = 30, BRIDGE_J = 16, ROAD_J = 11, CURVE_I = 19, SKY_Z = -22;
const isWater = (i: number, j: number) => (j >= RJ0 && j <= RJ1 && i <= ARM1) || (i >= ARM0 && i <= ARM1 && j > RJ1);
const isLane = (i: number, j: number) =>
  (j >= ROAD_J && j <= ROAD_J + 1 && i <= CURVE_I + 1) || (i >= CURVE_I && i <= CURVE_I + 1 && j >= ROAD_J && j <= BRIDGE_J + 2)
  || (j >= BRIDGE_J + 1 && j <= BRIDGE_J + 2 && i >= CURVE_I);

type Ground = "street" | "sidewalk" | "plaza" | "grass" | "quay" | "water" | "mall";
const MALL = ["#9E4F45", "#96483F"] as const;

function surface(i: number, j: number): Ground {
  if (isWater(i, j) || (i >= 2 && i <= 4 && j >= 26 && j <= 27)) return "water"; // nehir + ördek göleti
  if (isLane(i, j)) return "street";
  if (j <= 1) return i <= 4 ? "grass" : i >= 17 && i <= 30 ? "plaza" : "sidewalk";
  if (j === 2) return i >= 17 && i <= 30 ? "plaza" : "sidewalk";
  if (j === 3) return i <= ARM1 ? "quay" : "sidewalk";
  if (i >= 31) return j === BRIDGE_J || j === BRIDGE_J + 3 ? "plaza" : i === 31 ? "quay" : "sidewalk";
  if (j <= 10 && i <= 25) return "quay"; // güney rıhtımı (Queen's Walk benzeri)
  if (i >= 24 && i <= 25) return j === BRIDGE_J || j === BRIDGE_J + 3 ? "plaza" : "quay"; // kol rıhtımı
  if (i >= 21 && i <= 23 && j <= 15) return "grass"; // çark bahçesi
  if (i >= 21 && j >= BRIDGE_J && j <= BRIDGE_J + 3) return "plaza"; // köprü yaklaşımı (yaya yolları)
  if (j === 13 && i <= 18) return "sidewalk";
  if (i <= 5) return j >= 20 ? "grass" : j >= 16 ? "plaza" : "sidewalk";
  if (i >= 8 && i <= 10 && j >= 18) return "mall";
  if (i >= 6 && i <= 12 && j <= 19) return "plaza";
  if ((i === 6 || i === 7 || i === 11) && j >= 20) return "sidewalk";
  return "plaza";
}

/** Zemin: şehir paleti + bulvarın kırmızımsı asfaltı; su karoları zemin küpü almaz. */
function paint(b: Builder): void {
  const s = LONDRA_STYLE;
  b.ground((i, j) => {
    const k = surface(i, j);
    if (k === "water") return null;
    return k === "mall" ? pick2(MALL, i, j) : pick2(s.ground[k], i, j);
  }, s.ground.under, 0.04);
}

/** Şerit çizgileri (yazısız): orta kesik çizgi + yaya geçitleri (zebra) — iki şeritli yolların okunurluğu. */
function roadMarks(b: Builder): void {
  const zMid = (tz(ROAD_J) + tz(ROAD_J + 1)) / 2;
  for (let i = 0; i <= CURVE_I - 1; i++) b.box(tx(i), 0.045, zMid, 0.5, 0.01, 0.06, "#E8E4DA");
  const xMid = (tx(CURVE_I) + tx(CURVE_I + 1)) / 2;
  for (let j = ROAD_J + 2; j <= BRIDGE_J; j++) b.box(xMid, 0.045, tz(j), 0.06, 0.01, 0.5, "#E8E4DA");
  // zebra geçitleri: rıhtımdan kaldırıma (i 7 ve 15) ve bahçeden meydana (j 14, kıvrım yolu)
  for (const zi of [7, 15]) for (let k = 0; k < 5; k++) b.box(tx(zi) - 0.36 + k * 0.18, 0.046, zMid, 0.1, 0.01, 1.7, "#F2EEE4");
  for (let k = 0; k < 5; k++) b.box(xMid, 0.046, tz(14) - 0.36 + k * 0.18, 1.7, 0.01, 0.1, "#F2EEE4");
}

/** Ördek göleti (i0…i0+w−1 × j0…j0+d−1): su, taş kenar, sazlık, yüzen ördek evi; `pond` kancası. */
function duckPond(b: Builder, i0: number, j0: number, w: number, d: number): void {
  const s = LONDRA_STYLE, x = (tx(i0) + tx(i0 + w - 1)) / 2, z = (tz(j0) + tz(j0 + d - 1)) / 2;
  for (let j = j0; j < j0 + d; j++) {
    b.box(x, -0.3, tz(j), w, 0.6, 1, s.water, "water");
    for (let i = i0; i < i0 + w; i++) b.block(i, j);
  }
  for (const sz of [-1, 1]) b.box(x, 0.04, z + sz * (d / 2 + 0.02), w + 0.2, 0.1, 0.12, s.ground.quay[0], "solid", 0.04);
  for (const sx of [-1, 1]) b.box(x + sx * (w / 2 + 0.02), 0.04, z, 0.12, 0.1, d + 0.2, s.ground.quay[0], "solid", 0.04);
  reeds(b, x - w / 2 + 0.3, z - d / 2 + 0.3, 0); reeds(b, x + w / 2 - 0.3, z + d / 2 - 0.35, 1);
  b.box(x + 0.4, -0.05, z, 0.6, 0.1, 0.5, "#8B6A47");
  b.box(x + 0.4, 0.18, z, 0.4, 0.34, 0.36, "#B07D48", "solid", 0.03);
  b.box(x + 0.4, 0.4, z, 0.5, 0.1, 0.44, "#8C2F39");
  b.hook("pond", i0 + Math.floor(w / 2), j0, 1);
}

/** Kapalı pazar (i0…i1 × j0…j1): dört döküm direk, cam sırtlı demir çatı, orta sırada tezgâhlar (satıcı j0'da). */
function coveredMarket(b: Builder, i0: number, i1: number, j0: number, j1: number): number {
  // CITY-PASS-LON: çatı ve direkler doğuda 0,5 içeride (yanındaki kıvrım yolunda yürüme ölçeğindeki otobüs saçağa değmez)
  const s = LONDRA_STYLE, x = (tx(i0) + tx(i1)) / 2 - 0.25, z = (tz(j0) + tz(j1)) / 2, w = i1 - i0 + 0.5, d = j1 - j0 + 1, H = 2.7;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(x + sx * (w / 2 - 0.08), H / 2, z + sz * (d / 2 - 0.08), 0.14, H, 0.14, GREEN);
    b.box(x + sx * (w / 2 - 0.08), 0.1, z + sz * (d / 2 - 0.08), 0.3, 0.2, 0.3, GREEN);
  }
  for (const sz of [-1, 1]) b.box(x, H, z + sz * (d / 2 - 0.08), w, 0.16, 0.14, GREEN);
  for (const sx of [-1, 1]) b.box(x + sx * (w / 2 - 0.08), H, z, 0.14, 0.16, d, GREEN);
  for (const sz of [-1, 1]) b.box(x, H + 0.12, z + sz * (d / 2 - 0.1), w + 0.3, 0.1, 0.5, s.roofColor, "solid", 0.02);
  b.box(x, H + 0.2, z, w - 0.2, 0.06, d - 0.9, "#CFEAF7", "glass"); // cam sırt (çatı saçaklarına oturur)
  for (let k = 0; k <= w; k += 2) b.box(x - w / 2 + 0.1 + k, H + 0.26, z, 0.08, 0.08, d - 0.8, GREEN);
  const kinds = ["flowers", "fruit", "bread"] as const;
  const cols = [i0 + 1, i0 + 3, i0 + 5].filter((i) => i < i1);
  cols.forEach((i, k) => {
    marketStall(b, s, i, j0 + 1, kinds[k % kinds.length], s.awnings[k % s.awnings.length]);
    marketStation(b, i, j0 + 1);
  });
  return cols.length;
}

/** z boyunca rıhtım duvarı (x sabit; j0…j1). */
function wallZ(b: Builder, x: number, j0: number, j1: number): void {
  b.box(x, 0.06, (tz(j0) + tz(j1)) / 2, 0.12, 0.12, j1 - j0 + 1, LONDRA_STYLE.ground.quay[1], "solid", 0.03);
}

/** Kenar yaya köprüsü güvertesi: su üstünde yürünebilir taş güverte (`line0…line1` iki karo eninde) + demir korkuluk (yalnız
 *  dış kenarlarda); nehir ızgara kenarında açık kalmaz. */
function footDeck(b: Builder, axis: "x" | "z", line0: number, line1: number, a0: number, a1: number): void {
  const s = LONDRA_STYLE, len = a1 - a0 + 1, n = line1 - line0 + 1;
  for (let a = a0; a <= a1; a++) for (let l = line0; l <= line1; l++) b.blocked.delete(axis === "x" ? key(a, l) : key(l, a));
  if (axis === "x") {
    const x = (tx(a0) + tx(a1)) / 2, z = (tz(line0) + tz(line1)) / 2;
    b.box(x, -0.05, z, len, 0.14, n, s.ground.plaza[0], "solid", 0.03);
    b.box(x, -0.3, z, len, 0.3, n - 0.3, GREEN);
    for (const sz of [-1, 1]) {
      b.box(x, 0.34, z + sz * (n / 2 - 0.04), len, 0.06, 0.06, IRON);
      for (let k = 0; k <= len * 2; k++) b.box(x - len / 2 + 0.05 + k * ((len - 0.1) / (len * 2)), 0.17, z + sz * (n / 2 - 0.04), 0.04, 0.3, 0.04, IRON);
    }
  } else {
    const x = (tx(line0) + tx(line1)) / 2, z = (tz(a0) + tz(a1)) / 2;
    b.box(x, -0.05, z, n, 0.14, len, s.ground.plaza[0], "solid", 0.03);
    b.box(x, -0.3, z, n - 0.3, 0.3, len, GREEN);
    for (const sx of [-1, 1]) {
      b.box(x + sx * (n / 2 - 0.04), 0.34, z, 0.06, 0.06, len, IRON);
      for (let k = 0; k <= len * 2; k++) b.box(x + sx * (n / 2 - 0.04), 0.17, z - len / 2 + 0.05 + k * ((len - 0.1) / (len * 2)), 0.04, 0.3, 0.04, IRON);
    }
  }
}

/** Nehir: su kutuları (satır başına), engelli karolar, köpük şeritleri, rıhtım duvarları ve oltalar, kenar güverteleri. */
function river(b: Builder): void {
  const s = LONDRA_STYLE;
  for (let j = RJ0; j <= RJ1; j++) b.box((tx(0) + tx(ARM1)) / 2, -0.6, tz(j), ARM1 + 1, 0.8, 1, s.water, "water");
  for (let j = RJ1 + 1; j < D; j++) b.box((tx(ARM0) + tx(ARM1)) / 2, -0.6, tz(j), ARM1 - ARM0 + 1, 0.8, 1, s.water, "water");
  for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) if (isWater(i, j)) b.block(i, j);
  for (const [i, j] of [[3, 5], [9, 7], [13, 4], [20, 5], [16, 6], [27, 7], [28, 12], [27, 23], [29, 26], [8, 5]] as const) {
    b.box(tx(i) + 0.2, -0.17, tz(j), 0.6, 0.04, 0.14, "#E6F4FB", "wave");
  }
  quay(b, s, 0, 16, 3, "+z", [6, 10]); quay(b, s, 19, ARM1, 3, "+z", [28]);
  quay(b, s, 0, 16, RJ1 + 1, "-z", [7, 11, 16]); quay(b, s, 19, 25, RJ1 + 1, "-z", [], [20, 24]);
  wallZ(b, tx(25) + 0.44, RJ1 + 1, BRIDGE_J - 2); wallZ(b, tx(25) + 0.44, BRIDGE_J + 5, D - 3);
  wallZ(b, tx(31) - 0.44, RJ0, BRIDGE_J - 2); wallZ(b, tx(31) - 0.44, BRIDGE_J + 5, D - 3);
  b.hook("fish", 25, 23, 2); b.hook("fish", 25, 27, 2); b.hook("fish", 31, 12, 3); b.hook("fish", 31, 27, 3);
  b.hook("pond", 8, 6, 1); b.hook("pond", 14, 6, 1); b.hook("pond", 28, 25, 1);
  footDeck(b, "z", 0, 1, RJ0, RJ1); // sol kenar yaya köprüsü (iki karo)
  footDeck(b, "x", D - 2, D - 1, ARM0, ARM1); // ön kenar yaya köprüsü (iki karo)
}

export function buildLondra(): Built {
  const s = LONDRA_STYLE;
  const b = new Builder(1894, W, D);
  paint(b);
  river(b);
  roadMarks(b);

  // ---- kuzey kıyı (j 0–3): kule bahçesi, meclis + kemerli büyük kule, saat kulesi, kemer köprü; teraslı evler, nehir kafesi
  cityTree(b, 1, 0, s.tree); cityTree(b, 3, 1, s.tree); cityTree(b, 4, 0, s.tree);
  parliament(b, 5, 14, 0);
  clockTower(b, 15, 0);
  archBridge(b, s, 17, 18, RJ0, RJ1, "#4E7F63");
  for (const i of [4, 8, 12]) { cityBench(b, i, 3, "+z", GREEN, IRON); b.station(i, 3, UP, "sit_bench", "laptop", 0.45); }
  for (const i of [2, 14]) streetLamp(b, s, i, 2);
  b.spot("write", 16, 3, UP); // saat kulesi önünde rıhtım defteri
  terraceRow(b, s, 20, 0, 7, 1, { floors: 2, door: 3, lit: false });
  for (const i of [21, 23, 25]) { cafeSet(b, i, 2, "#F4EFE6"); cafeStations(b, i, 2); }
  b.canopy(21, 25, 2, 2, "#8C2F39", 2.3, IRON, "#F2EEE4");
  kiosk(b, s, 28, 1, GREEN); // kahve/mola: (28,2)
  kiosk(b, s, 19, 1, GREEN); // köprü başında kahve/mola: (19,2)
  barrelPlanter(b, 17, 1, "#A78BFA");
  cityTree(b, 30, 1, s.tree); cityTree(b, 33, 1, s.tree);
  b.rest.push([18, 2], [27, 2], [20, 3], [0, 2], [3, 2]);
  b.hook("roof", 9, 0); b.hook("perch", 16, 0); b.hook("window", 22, 0);

  // ---- güney rıhtımı (j 9–10): nehre bakan çalışma yerleri, fenerler, otobüs durağı; gözlem çarkı nehrin üstünde
  for (const i of [2, 5, 9, 13]) b.station(i, RJ1 + 1, DOWN, "sit_ground", "laptop", 0.06);
  for (const i of [3, 11, 17]) streetLamp(b, s, i, RJ1 + 2);
  busShelter(b, 15, RJ1 + 2); b.spot("web", 14, RJ1 + 2, RIGHT); // durak panosu (web)
  pillarBox(b, 7, RJ1 + 2, 1);
  obsWheel(b, LONDRA_WHEEL);
  b.rest.push([18, 9], [0, 10], [8, 10]);
  b.hook("perch", 11, 9);

  // ---- çark bahçesi (i 21–25, j 9–15): kahve kioskü, bilgi köşkü, içme çeşmesi, çarka bakan banklar, çınarlar
  kiosk(b, s, 22, 15, GREEN); // kahve/mola: (22,16)
  infoKiosk(b, 23, 15);
  b.box(tx(24), 0.3, tz(14), 0.6, 0.6, 0.6, "#A39E94", "solid", 0.03); // içme çeşmesi (iki kurna + hayvan suluğu)
  b.box(tx(24), 0.63, tz(14), 0.44, 0.06, 0.44, s.water, "water");
  b.box(tx(24), 0.86, tz(14), 0.12, 0.4, 0.12, "#A39E94", "solid", 0.02);
  b.box(tx(24), 1.08, tz(14), 0.34, 0.06, 0.34, "#A39E94", "solid", 0.02);
  b.box(tx(24), 1.12, tz(14), 0.26, 0.04, 0.26, s.water, "water");
  b.box(tx(24) + 0.4, 0.1, tz(14), 0.18, 0.2, 0.42, "#A39E94", "solid", 0.03);
  b.box(tx(24) + 0.4, 0.21, tz(14), 0.12, 0.03, 0.34, s.water, "water");
  b.block(24, 14);
  for (const i of [21, 25]) { cityBench(b, i, 10, "-z", GREEN, IRON); b.station(i, 10, DOWN, "sit_bench", "laptop", 0.45); }
  b.rest.push([22, 11], [21, 14], [24, 15], [23, 10]);
  b.hook("grass", 22, 13, 2);

  // ---- nehir yolu (j 11–12) + kıvrım yolu (i 19–20) + açılır köprü (j 16–19): iki kırmızı çift katlı otobüs, aynı halka hat
  towerBridge(b, ARM0, ARM1, BRIDGE_J);
  // Soldan akış: doğuya giden j 11'de, batıya j 12'de; güneye i 20, kuzeye i 19; köprüde doğuya j 17, batıya j 18. Şerit
  // ortasından 0,05 dışa kaydırılmış izler karşılıklı iki otobüsü ≥ 1,1 ayırır (MOVER-SEP-001 ≥ 1).
  const E = 0.05, y = 0.04;
  const xa = tx(CURVE_I) - E, xb = tx(CURVE_I + 1) + E, za = tz(ROAD_J) - E, zb = tz(ROAD_J + 1) + E;
  const zc = tz(BRIDGE_J + 1) - E, zd = tz(BRIDGE_J + 2) + E, xL = tx(0), xR = tx(W - 1);
  const loop: [number, number, number][] = [[xL, y, za], [xb, y, za], [xb, y, zc], [xR, y, zc], [xR, y, zd], [xa, y, zd], [xa, y, zb], [xL, y, zb]];
  addMover(b, { shape: "bus", period: 60, mode: "loop", scale: 0.85, color: "#C8312B", accent: "#F2EEE4", path: loop });
  addMover(b, { shape: "bus", period: 60, mode: "loop", scale: 0.85, color: "#C8312B", accent: "#F2EEE4",
    path: [...loop.slice(4), ...loop.slice(0, 4)] });

  // ---- batı (i 0–5): kitapçı + köşe pubu (j 14–15), okuma masaları ve pub bahçesi (j 16–18)
  rowHouse(b, s, 0, 14, 3, 2, { floors: 2, wall: "#C9A877", shop: "#1F3A5F", door: 1, lit: false });
  bookshopFront(b, 0, 3, 15);
  for (const i of [0, 2]) { readingDesk(b, i, 18, "+z"); b.station(i, 19, DOWN, "sit_chair", "laptop"); }
  b.spot("read", 1, 18, DOWN);
  rowHouse(b, s, 3, 14, 3, 2, { floors: 2, wall: "#A9543E", shop: "#2E4A3A", door: 1 });
  pubFront(b, 3, 3, 15);
  pubTable(b, 3, 18); pubTable(b, 5, 18);
  aBoard(b, 4, 18); b.spot("plan", 4, 19, DOWN);
  pillarBox(b, 5, 13, -1);
  b.hook("roof", 1, 14); b.hook("window", 4, 14);
  b.rest.push([1, 16], [4, 16], [1, 17]);

  // ---- park (i 0–5, j 20–31): çalgı köşkü, ördek göleti + besleme, banklar, çınarlar
  bandstand(b, 1, 21);
  duckPond(b, 2, 26, 3, 2);
  b.hook("fish", 3, 25, FEED_ONLY); // gölete bakan besleme noktası (+z)
  for (const [dx, dz] of [[-0.2, 0.3], [0.15, 0.35], [0.3, 0.25]]) b.box(tx(3) + dx, 0.02, tz(25) + dz, 0.06, 0.04, 0.06, "#E8C07A");
  for (const [i, j] of [[1, 30], [4, 30], [5, 24]] as const) { b.parkBench(i, j, 1, "+z", GREEN, IRON); b.station(i, j, UP, "sit_bench", "laptop", 0.45); }
  for (const [i, j] of [[5, 21], [0, 25], [5, 28], [2, 31], [0, 21]] as const) cityTree(b, i, j, s.tree);
  b.rest.push([3, 20], [1, 24], [3, 29], [5, 26]);
  b.hook("grass", 2, 29, 2);

  // ---- saray (i 6–12): cephe (j 14–15), parmaklık (j 16), avlu (j 17), anıt kavşağı (j 18–20), bulvar (i 8–10, j 21–31)
  palace(b, 6, 12, 14);
  palaceRail(b, 6, 12, 16, [8, 10]);
  memorial(b, 9, 19);
  squareFountain(b, 6, 19); squareFountain(b, 11, 19);
  for (let j = 22; j <= 30; j += 2) { cityTree(b, 7, j, s.tree); cityTree(b, 11, j, s.tree); }
  b.rest.push([8, 17], [10, 17], [7, 18], [9, 31]);
  b.hook("perch", 9, 17);

  // ---- pazar ve çay salonu (i 13–18): kabuk terminali, kapalı pazar, çay salonu (ikindi çayı; `cafe` mekânı)
  b.terminal(13, 14, "+z"); b.spot("shell", 13, 15, DOWN);
  coveredMarket(b, 14, 18, 14, 16);
  placeVenue(b.box.bind(b), "cafe", tx(16), tz(19), "-z", "scene");
  for (const [di, dj] of venueSolidTiles("cafe", "-z")) b.block(16 + di, 19 + dj);
  teaRoomDecor(b, tx(16), tz(19), -1);
  b.rest.push([18, 18], [13, 18]);
  b.hook("window", 16, 14);

  // ---- sütunlu meydan (i 12–23, j 20–31): galeri cephesi, uzun sütun + aslanlar, iki çeşme, banklar, güvercinler
  gallery(b, 13, 23, 20);
  squareColumn(b, 17, 25);
  squareFountain(b, 14, 25); squareFountain(b, 21, 25);
  for (const i of [13, 22]) { cityBench(b, i, 28, "-z", GREEN, IRON); b.station(i, 28, DOWN, "sit_bench", "laptop", 0.45); }
  for (const [i, j] of [[12, 23], [23, 23]] as const) streetLamp(b, s, i, j);
  b.rest.push([18, 23], [15, 28], [20, 28], [13, 31], [12, 22]);
  b.hook("perch", 12, 23);
  // CORE-WALK: balık-patates dükkânı (ritüel `balik_patates` mekânı; city/venues.ts) — meydanın güney ucunda, meydana bakar:
  // tezgâh (16–18, 30), sipariş karosu (17, 29) iki tabureyle, pub bankı + masa (16–18, 28). Ön kenar sözleşmesi korunur.
  placeVenue(b.box.bind(b), "chip_shop", tx(17), tz(30), "-z", "scene");
  b.keepOut.push([17, 29]); // geçit dükkânın taburesinin dibine kurulmaz
  for (const [di, dj] of venueSolidTiles("chip_shop", "-z")) b.block(17 + di, 30 + dj);
  // CITY-PASS-LON: yerdeki kıpırdamayan süs güvercinleri kaldırıldı (ürün sahibi: "güvercinler hiç hareket etmiyor"); meydanda canlı ortam
  // güvercinleri (Ambient; oyuncu yaklaşınca kaçar/havalanır) var

  // ---- doğu kıyı (i 31–35): B&B oda sıraları (15 yatak), taş kale burcu, bilgi köşkü
  // HOTEL-SYS (E1): tek otel (Georgian sıra ev; kapı güneyde) + eski oda sıralarının yerinde küçük bahçe — görünür yatak yok
  placeHotel(b, "londra", { at: [33, 4], w: 2, d: 2, door: [33, 6] }, s); // i 31–32 iki karoluk yol açık kalır (REAL-PATH-001)
  for (const j of [9, 12]) { cityTree(b, 32, j, s.tree); cityTree(b, 34, j, s.tree); }
  flowerBed(b, 33, 9, 1, 1, LONDRA_QUILTS); flowerBed(b, 33, 13, 1, 1, LONDRA_QUILTS); flowerBed(b, 32, 27, 3, 1, LONDRA_QUILTS);
  cityBench(b, 33, 11, "+z"); cityBench(b, 33, 28, "+z");
  stoneKeep(b, 31, 21);
  infoKiosk(b, 33, 30);
  cityTree(b, 34, 25, s.tree);
  b.rest.push([33, 25], [34, 29], [31, 30], [33, 20]);
  b.hook("roof", 33, 4); b.hook("perch", 33, 15);

  // ---- nehir tekneleri (ızgara içinde; köprü güvertelerinin ve çarkın altından geçmez)
  addMover(b, { shape: "boat", period: 30, mode: "pingpong", scale: 1.05 /* SCALE-FIX 0.55 */, color: "#F2EEE4", accent: GREEN,
    path: [[tx(2) + 0.7 /* SCALE-FIX 0.2 (ölçek 1,05: tekne yarı boyu bordüre girmesin) */, -0.25, tz(5.6)], [tx(15), -0.25, tz(5.6)]] }); // WATER-CLEAR: batı uç rıhtım bordürüne girmez
  addMover(b, { shape: "boat", period: 26, mode: "pingpong", phase: 0.3, scale: 1.05 /* SCALE-FIX 0.5 */, color: "#E9E1D0", accent: "#8C2F39",
    path: [[tx(20), -0.25, tz(4.8)], [tx(29), -0.25, tz(4.8)]] });
  addMover(b, { shape: "boat", period: 24, mode: "pingpong", phase: 0.6, scale: 1.05 /* SCALE-FIX 0.5 */, color: "#F2EEE4", accent: "#1F3A5F",
    path: [[tx(28), -0.25, tz(21.6)], [tx(28), -0.25, tz(28.4)]] });

  // ---- ufuk: alçak, seyrek genel şehir blokları, tabanın arkasında x ≈ 6'ya ortalı (simgeleri bastırmaz)
  for (let x = -30, k = 0; x < 42; k++) {
    const w = 1.8 + ((k * 7) % 5) * 0.5, h = 1.0 + ((k * 5) % 7) * 0.28;
    b.backdrop.push({ p: [x + w / 2, h / 2, SKY_Z - (k % 3) * 1.4], s: [w, h, 2.2], c: s.far[k % s.far.length], g: "solid", j: 0.03 });
    x += w + 0.35;
  }
  fillSpotReach(b); // her istasyona ölçeklenmiş yarıçapta araç noktası
  return b.done();
}
