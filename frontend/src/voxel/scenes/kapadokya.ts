/**
 * RB-KAP / BIG-KAP — Kapadokya şehir sahnesi (ücretsiz, `city` katmanı, `world_tour_turkey`). Kullanıcı kararları 2026-10-18
 * ( sonu): simgeler sahnenin ORTASINDA, ilk bakışta tanınır stilize voxel yorumlar; büyüme simge
 * çekirdeğinin (bütün taban) etrafında halka. CITY-BIG: şehir tabanı normal sahneden büyük — **36 × 32 karo (3 × 2 bölge)**;
 * simgeler daha yükseğe değil, yana yayılır (kamera kaldırma sınırı 6; en yüksek öğe yine kale kayası, uç ≈ 10,4).
 *
 * CITY-PASS-KAP (kalite seferberliği; kaynaklar ve puanlar): simgeler gerçeğe göre baştan,
 * açık yatak sırası yok (uyku MAĞARA OTELİNİN İÇİNDE), havada eşya yok, yürüyüş yolları ≥ 2 karo, etkinlikler gerçek mekânda
 * (`city/venues.ts placeVenue`; satıcı CITYLIFE `vendorsFrom` ile tezgâhın ardında):
 *
 * Yerleşim (sütun A i 0–11, B i 12–23, C i 24–35; arka j 0–12, orta j 13–22, nehir j 24–25, ön j 27–31):
 * - A arka: Göreme'yi andıran açık hava müzesi — oyma kilise cephesi (i 3–8, j 4; at nalı kemerli kapılar, kör kemerler, üst
 * kattaki kapıya metal ziyaretçi merdiveni), solda çok katlı oyma manastır kütlesi, şapel konileri, taş avlu `sacredZone`
 * (i 2–9, j 4–6, tampon 1), giriş kapısı (j 9), j 7'den ön kenara dek düz yaklaşma yolu (i 5–6), bilet/çay kulübesi.
 * - B arka: Uçhisar'ı andıran kale kayası (i 15–20, j 2–5; kayaya oyulmuş zikzak merdiven, zirvede korkuluklu seyir düzlüğü);
 * arkasında 2 karoluk patika (j 0–1), eteğinde mağara ev köyü; köy meydanında asma çardak altında **testi kebabı lokantası**
 * (`food_stand`, tezgâh i 16–18 × j 8, sipariş (17, 9)), iki kafe masası (4 istasyon), çay ocağı (kahve), kuyu, banklar.
 * - C arka: **mağara oteli** (HOTEL-SYS E1: şehrin tek oteli) — küçük tüf mağara cephesi (i 28–30 × j 0–1), kemerli kapı (29, 2)
 * geçit (içerisi ayrı sahne: mağara oteli lobisi), "OTEL" tabelası; iki yanda alçak tüf yamaçları, avlu. Görünür yatak yok.
 * Önünde balon seyir **çay bahçesi** (`tea_garden`, tezgâh i 29–31 × j 8, sipariş (30, 9)) ve
 * asma çardaklı teras kafesi (6 istasyon), çay ocağı (kahve).
 * - A orta: üzüm bağları (üç sıra çifti), yer minderleri (4) ve nehre bakan banklar (4) — dizüstü.
 * - B orta: halı/kilim avlusu — iki dokuma tezgâhı (yazma), kilim askıları, halı sergisi ve kilim yığını, iki zanaat tezgâhı.
 * - C orta: KAHRAMAN peri bacası vadisi — Love Valley'yi andıran uzun ince bacalar, Paşabağ'ı andıran çok şapkalı kümeler,
 * üçlü ve oyuklu bacalar; patikalar j 16 / j 19 / i 30 (`landmark` `fairy_chimneys`).
 * - j 24–25: Kızılırmak'ı andıran kızıl nehir (i 1–34; uçlarda kaya eşiği → su kenara değmez), üç yaya köprüsü (i 5–6,
 * 17–18, 29–30), kıyı bordürleri, iki olta noktası, ördek kancası. Kıyı (j 26) ve ön sıranın ilk satırı (j 27) açık: 2 karoluk yol.
 * - A ön: Zelve'yi andıran terk edilmiş mağara köyü (yüzü çökmüş koniler) ve girişinde **gözleme tezgâhı** (`food_stand`).
 * - B ön: Avanos çömlekçileri — sazlı çardak altında ayakla dönen çark başında oturan usta (çamur testi elinde), kurutma
 * rafı, odun fırınları, 3 satış tezgâhı (istasyon); nehir kıyısında **testi kebabı tezgâhı** (`food_stand`).
 * - C ön: balon kalkış alanı (şafak) — yerde şişmiş, kalkmaya hazır balon (sepet zeminde, brülör çerçevesi, çelik halatlar),
 * soğuk şişirmede yere yatmış zarf + fan + yan yatmış sepet, sırada bekleyen sepet, rüzgâr panosu (web), uçuş otomatı
 * (kabuk), uçuş planı (plan), 2 izleme bankı (`landmark` `balloon_field`).
 * - Gökte 12 sıcak hava balonu (`mover`, `dayOnly`; 3'ü kıyıdan kalkıp iner); gece iner, fenerler yanar.
 *
 * Mantık (-WORK-001): 27 istasyon (kafe `sit_chair`, bank `sit_bench`, bağ minderi `sit_ground`, tezgâh
 * `stand`; hepsi dizüstü/tablet), uyku otel geçidinde (sanal kapasite), araçlar web/kabuk/plan/yazma/okuma, 3 kahve noktası. Canlı ortam: kuş
 * (`tree`, `perch`), çimen, ördek (`pond`). Kenar sözleşmesi (CITY-BIG, 36 × 32): arka/ön kenarda i 5–7, 17–19, 29–31'de ≥ 2
 * açık karo; sol/sağ kenarda j 0/2/7/12/16/18/23/28 açık; su kenara değmez; hareketli yolları ızgara içinde (x −12…24, z −8…24).
 * IP/kültür: logo, bayrak, harita, gerçek kişi ve dinî ses/simge yok (otel tabelası genel sözcük); kale ve vadi doğal oluşum
 * yorumudur; kiliseler yalnız oyma dış cephedir → `culture_risk` 1 (kültür okuru notu). Kayıt notu: scenes.ts ile döngüsel içe
 * aktarılır — yalnız fonksiyon/sabit bildirimleri dışa aktarılır.
*/
import { addMover, archBridge, cafeSet, cafeStations, cityBench, kiosk, marketStall, marketStation, paintCity, quay, sacredZone,
  type Surface } from "../city/kit";
import { fillSpotReach } from "../city/kit";
import { placeHotel } from "../districts/hotel";
import { placeVenue, venueSolidTiles, type VenueFace } from "../city/venues";
import { caveHouse, castleRock, chapelCone, chimney, KAP, KAPADOKYA_STYLE as S, P, pasabag, rockChurches, ruinCone,
  trio } from "../city/styles/kapadokya";
import { coldInflation, hangLantern, kickWheel, stagedBasket, uprightBalloon, type Face } from "../city/landmarks/kapadokya/kit";
import { Builder, rng, tx, tz, type Built, type SceneDef } from "../scenes";

const UP = 0, DOWN = Math.PI;
export const TUFF = KAP.tuff, HONEY = KAP.honey, ROSE = KAP.rose, CAP = KAP.cap, WOOD = KAP.wood, CLAY = "#B5603F";
export const KILIM = ["#B9574A", "#3F6E8C", "#D9A441", "#5E7E4A", "#F2E6D0"] as const;
const HOLE = KAP.hole;
/** `Builder.box` kutu yazıcısı (kit ve mekân yerleşimi için). */
const boxOf = (b: Builder) => b.box.bind(b);

/** Izgarada peri bacası (karoyu engeller); `holes`: oyma kapı + pencereler (eski güvercinlik/ev, beyaz çerçeveli). */
export function gridChimney(b: Builder, i: number, j: number, h: number, tone: string, holes = false, w = 0.96) {
  chimney(b, "grid", tx(i), tz(j), h, w, tone);
  if (holes) {
    b.box(tx(i), 0.42, tz(j) + w / 2 + 0.01, 0.3, 0.6, 0.04, HOLE);
    for (const [dx, f] of [[-0.16, 0.42], [0.14, 0.6]]) {
      // kademe yüzleri (chimney: 1 / 0,86 / 0,74 … × w); oyuk o kademenin ön yüzüne yapışık
      const y = h * f, zf = tz(j) + w * (f < 0.5 ? 0.37 : 0.31) + 0.02;
      b.box(tx(i) + dx, y, zf - 0.01, 0.24, 0.26, 0.04, KAP.trim);
      b.box(tx(i) + dx, y, zf + 0.01, 0.14, 0.16, 0.04, HOLE);
    }
  }
  b.block(i, j);
}

/** Kavak (ince uzun sütun) ya da kayısı ağacı (yuvarlak taç); gövde karosu engelli, `tree` kancası (kuş). */
export function vTree(b: Builder, i: number, j: number, kind: "poplar" | "apricot") {
  const x = tx(i), z = tz(j);
  if (kind === "poplar") {
    b.box(x, 0.6, z, 0.2, 1.2, 0.2, "#8A7A62", "solid", 0.05);
    [[0.8, 1.6, 1.2], [0.7, 2.6, 1.0], [0.5, 3.4, 0.8], [0.28, 4.0, 0.5]].forEach(([w, y, h], k) =>
      b.box(x, y, z, w, h, w, k % 2 ? "#8FAE4E" : "#7FA046", "solid", 0.1));
  } else {
    b.box(x, 0.7, z, 0.24, 1.4, 0.24, "#6B4A36", "solid", 0.05);
    b.box(x, 1.75, z, 1.6, 0.8, 1.6, "#7FA046", "solid", 0.12);
    b.box(x, 2.3, z, 1.1, 0.45, 1.1, "#8FAE4E", "solid", 0.12);
    for (const [dx, dz] of [[-0.5, 0.6], [0.55, 0.3], [0.1, 0.72], [-0.3, -0.6]]) b.box(x + dx, 1.6, z + dz, 0.12, 0.12, 0.12, "#F2A33D");
  }
  b.block(i, j);
  b.hook("tree", i, j);
}

/** Fener direği (ahşap direk + bakır fener + gece ışık havuzu); karoyu engeller. */
export function lanternPost(b: Builder, i: number, j: number) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.1, z, 0.32, 0.2, 0.32, HONEY, "solid", 0.04);
  b.box(x, 1.0, z, 0.1, 1.8, 0.1, WOOD);
  b.box(x, 1.95, z, 0.3, 0.32, 0.3, S.lamp.glow, "glow");
  b.box(x, 2.15, z, 0.38, 0.08, 0.38, "#8A5A32");
  b.props.push({ k: "lamp", p: [x, 1.95, z], r: 0, s: [2.4, 0], c: S.lamp.glow });
  b.block(i, j);
}
/** Asılı fener dizisi (x boyunca; engellemez): çardak kirişinin ALTINA yapışık ip + kısa askılı bakır fenerler. `y` kiriş altı. */
export function lanternString(b: Builder, x0: number, x1: number, y: number, z: number) {
  b.box((x0 + x1) / 2, y - 0.01, z, x1 - x0, 0.02, 0.02, "#4A3A2E");
  for (let x = x0 + 0.4, k = 0; x < x1 - 0.1; x += 0.9, k++) hangLantern(boxOf(b), x, y - 0.02, z, k % 2 ? 0.8 : 0.7);
}

/** Üzüm bağı sırası (x boyunca, karolar engelli): direkler + tel + asma yaprakları + mor/yeşil salkımlar. */
export function vineRow(b: Builder, i0: number, i1: number, j: number) {
  const x = (tx(i0) + tx(i1)) / 2, z = tz(j), w = i1 - i0 + 1;
  for (let i = i0; i <= i1; i += 2) b.box(tx(i) - 0.45, 0.55, z, 0.07, 1.1, 0.07, "#6B4A36");
  b.box(x, 1.02, z, w - 0.1, 0.02, 0.02, "#5B5148");
  for (let i = i0; i <= i1; i++) {
    b.box(tx(i), 0.72, z, 0.82, 0.5, 0.5, (i + j) % 2 ? "#6E9A3E" : "#78A443", "solid", 0.14);
    b.box(tx(i) - 0.08, 0.98, z, 0.56, 0.18, 0.36, "#82AE4A", "solid", 0.14);
  }
  for (let i = i0; i <= i1; i++) b.box(tx(i) + 0.15, 0.5, z + 0.24, 0.14, 0.2, 0.08, (i + j) % 3 ? "#6B3F78" : "#9BB04A");
  for (let i = i0; i <= i1; i++) b.block(i, j);
}

/** Ayakla dönen çömlek çarkı ve başında oturan usta (engelli; iki yanı yürünebilir kalmalı → S48 `play` gösterisi). `face`
 *  ustanın baktığı yön: usta karonun arka yarısında taburede, çark ön yarısında (kit `kickWheel`, ölçek 0,9). */
export function potteryWheel(b: Builder, i: number, j: number, face: Face = "-z") {
  const [fx, fz] = face === "+z" ? [0, 1] : face === "-z" ? [0, -1] : face === "+x" ? [1, 0] : [-1, 0];
  kickWheel(boxOf(b), tx(i) - fx * 0.2, tz(j) - fz * 0.2, face, 0.9, "chibi");
  b.block(i, j);
  b.hook("play", i, j);
}
/** Çömlek tezgâhı (engelli): tezgâh + testiler, arka rafta çanaklar; satıcı (i, j−1) ayakta, tablet, tezgâha bakar. */
export function potteryStall(b: Builder, i: number, j: number, station = true) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.45, z, 0.92, 0.9, 0.62, "#8B6A47", "solid", 0.04);
  b.box(x, 0.92, z, 0.98, 0.06, 0.7, "#A47148");
  [[CLAY, 0.24, 0.3], ["#C9774E", 0.18, 0.22], ["#3F6E8C", 0.2, 0.26], ["#E9DCC6", 0.16, 0.2]].forEach(([c, w, h], k) =>
    b.box(x - 0.33 + k * 0.22, 0.95 + (h as number) / 2, z + (k % 2 ? 0.12 : -0.08), w as number, h as number, w as number, c as string));
  for (const dx of [-0.46, 0.46]) b.box(x + dx, 0.95, z + 0.3, 0.06, 1.9, 0.06, "#5B4A3A");
  b.box(x, 1.5, z + 0.26, 0.98, 0.05, 0.22, "#8B6A47");
  for (let k = 0; k < 4; k++) b.box(x - 0.33 + k * 0.22, 1.615, z + 0.26, 0.15, 0.18, 0.15, k % 2 ? CLAY : "#D9A441");
  b.block(i, j);
  if (station) b.station(i, j - 1, UP, "stand", "tablet");
}
/** Çömlek fırını: tüf kubbe (kademeli), koyu ağız, içte kor ışığı (glow; alev grubu yok), bacası tepeye oturur. Karoyu engeller. */
export function kiln(b: Builder, i: number, j: number) {
  const x = tx(i), z = tz(j);
  [[0.96, 0.5, 0.25], [0.8, 0.4, 0.7], [0.56, 0.3, 1.05], [0.3, 0.2, 1.3]].forEach(([w, h, y]) => b.box(x, y, z, w, h, w, ROSE, "solid", 0.05));
  b.box(x, 0.32, z + 0.47, 0.36, 0.4, 0.04, "#3A2A22");
  b.box(x, 0.28, z + 0.49, 0.24, 0.16, 0.04, "#FF9A4D", "glow");
  b.box(x + 0.05, 1.6, z - 0.02, 0.14, 0.4, 0.14, "#8A7060");
  for (let k = 0; k < 3; k++) b.box(x - 0.3 + k * 0.16, 0.08, z - 0.44, 0.14, 0.16, 0.12, "#8B6A47"); // odun
  b.block(i, j);
}
/** Kurutma rafı (x boyunca w karo, engelli): iki raf, sıra sıra pişmemiş çanaklar. */
export function dryingRack(b: Builder, i0: number, j: number, w: number) {
  const x = (tx(i0) + tx(i0 + w - 1)) / 2, z = tz(j);
  for (const y of [0.5, 1.1]) {
    b.box(x, y, z, w - 0.1, 0.05, 0.5, "#8B6A47");
    for (let k = 0; k < w * 3; k++) b.box(tx(i0) - 0.3 + k * 0.33, y + 0.125, z, 0.18, 0.2, 0.18, k % 2 ? "#D9B08E" : "#C9A27E");
  }
  for (const dx of [-w / 2 + 0.1, w / 2 - 0.1]) b.box(x + dx, 0.7, z, 0.06, 1.4, 0.5, "#5B4A3A");
  for (let i = i0; i < i0 + w; i++) b.block(i, j);
}
/** Halı tezgâhı (dikey dokuma tezgâhı, yüzü +z): direkler, kirişler, çözgü ipleri, geometrik kilim deseni, dört ayaklı
 *  dokuyucu peykesi. Engelli. */
export function loom(b: Builder, i: number, j: number) {
  const x = tx(i), z = tz(j);
  for (const dx of [-0.42, 0.42]) b.box(x + dx, 0.95, z, 0.08, 1.9, 0.12, WOOD);
  for (const y of [0.3, 1.8]) b.box(x, y, z, 0.96, 0.08, 0.14, WOOD);
  b.box(x, 1.4, z, 0.76, 0.72, 0.02, "#F2E6D0");
  b.box(x, 0.72, z + 0.02, 0.76, 0.66, 0.03, KILIM[0]);
  for (const [dy, c, w] of [[0.22, KILIM[2], 0.6], [0, KILIM[1], 0.3], [-0.22, KILIM[2], 0.6]] as [number, string, number][]) b.box(x, 0.72 + dy, z + 0.04, w, 0.08, 0.02, c);
  b.box(x, 0.72, z + 0.05, 0.1, 0.1, 0.02, KILIM[4]);
  b.box(x, 0.27, z + 0.4, 0.6, 0.06, 0.24, WOOD); // dokuyucu peykesi
  for (const dx of [-0.26, 0.26]) for (const dz of [-0.09, 0.09]) b.box(x + dx, 0.12, z + 0.4 + dz, 0.05, 0.24, 0.05, "#5B3A22");
  b.block(i, j);
}
/** Kilim askısı (x boyunca w karo, engelli): üst kiriş, asılı kilimler (çizgili, özgün geometrik desen; yazı yok). */
export function kilimRack(b: Builder, i0: number, j: number, w: number, seed = 0) {
  const x = (tx(i0) + tx(i0 + w - 1)) / 2, z = tz(j);
  for (const dx of [-w / 2 + 0.08, w / 2 - 0.08]) b.box(x + dx, 1.0, z, 0.08, 2.0, 0.08, WOOD);
  b.box(x, 1.95, z, w, 0.08, 0.08, WOOD);
  for (let k = 0; k < w * 2; k++) {
    const kx = tx(i0) - 0.25 + k * 0.5, c = KILIM[(k + seed) % 4];
    b.box(kx, 1.3, z, 0.44, 1.22, 0.03, c);
    for (const dy of [-0.3, 0.3]) b.box(kx, 1.3 + dy, z + 0.02, 0.44, 0.08, 0.02, KILIM[4]);
  }
  for (let i = i0; i < i0 + w; i++) b.block(i, j);
}
/** Kilim yığını (engelli): alçak ahşap seki üstünde katlanmış kilimler (renk kuşakları), yanında rulo halılar. */
function kilimPile(b: Builder, i: number, j: number) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.12, z, 0.9, 0.24, 0.7, "#8B6A47", "solid", 0.03);
  for (let k = 0; k < 5; k++) b.box(x - 0.08, 0.28 + k * 0.08, z, 0.62 - (k % 2) * 0.04, 0.08, 0.5, KILIM[(k + 1) % 4], "solid", 0.02);
  for (const [dx, c] of [[0.34, KILIM[1]], [0.34, KILIM[0]]] as const) b.box(x + dx, 0.36 + (c === KILIM[0] ? 0.16 : 0), z, 0.16, 0.16, 0.64, c, "solid", 0.02);
  b.block(i, j);
}
/** Ayaklı pano (yüzü +z): `glow` true ise ışıklı (rüzgâr/hava panosu → web), değilse kâğıt (uçuş planı → plan). */
export function board(b: Builder, i: number, j: number, lit: boolean) {
  b.box(tx(i), 0.8, tz(j), 0.1, 1.6, 0.1, WOOD);
  b.box(tx(i), 1.5, tz(j), 0.8, 0.56, 0.08, WOOD, "solid", 0.02);
  b.box(tx(i), 1.5, tz(j) + 0.05, 0.66, 0.42, 0.02, lit ? "#93C5FD" : "#E9D8A6", lit ? "glow" : "solid");
  for (const dx of [-0.18, 0.12]) b.box(tx(i) + dx, 1.52, tz(j) + 0.07, 0.16, 0.16, 0.01, lit ? "#F8FAFC" : "#B9574A"); // piktogram (balon/güneş), yazı yok
  b.block(i, j);
}
/** Teras minderi (uyku: yarı uzanık `sofa`): kilim minder + arkalık, başı −z. Büyüme teması ön şeridi için korunur (taban
 *  sahnede uyku yalnız otelde). */
export function cushion(b: Builder, i: number, j: number, k: number) {
  b.daybed(i, j, KILIM[k % 4], "#E9D9C4", "-z");
  b.sleep(i, j, DOWN, "sofa", 0.36);
}
/** Yere serili (henüz şişmemiş) balon zarfı (x boyunca w karo, engelli; zeminde alçak, kıvrımlı kumaş) + `basket` true ise
 *  ucunda sırada bekleyen sepet (zeminde, brülör çerçevesi takılı; kit `stagedBasket`). */
export function envelope(b: Builder, i0: number, j: number, w: number, c1: string, c2: string, basket = true) {
  const z = tz(j);
  for (let k = 0; k < w; k++) {
    const h = 0.16 + ((k * 3) % 4) * 0.04;
    b.box(tx(i0 + k), h / 2, z, 1.0, h, 0.9 - (k === 0 ? 0.3 : 0), k % 2 ? c2 : c1, "solid", 0.04);
    b.box(tx(i0 + k) + 0.1, h + 0.03, z - 0.1, 0.5, 0.06, 0.4, k % 2 ? c1 : c2, "solid", 0.03); // kıvrım
    b.block(i0 + k, j);
  }
  if (!basket) return;
  stagedBasket(boxOf(b), tx(i0 + w), z - 0.2, 0.7, (i0 + j) % 6);
  b.block(i0 + w, j);
}

/** Sazlı çardak (açık; köşe direkleri karo kenarında, engellemez): direklerin üstünde iki kiriş, çıtalar kirişlere oturur. */
export function reedCanopy(b: Builder, i0: number, i1: number, j0: number, j1: number, h = 2.4) {
  const x0 = tx(i0) - 0.45, x1 = tx(i1) + 0.45, z0 = tz(j0) - 0.45, z1 = tz(j1) + 0.45;
  for (const px of [x0, x1]) for (const pz of [z0, z1]) b.box(px, h / 2, pz, 0.1, h, 0.1, WOOD);
  for (const pz of [z0, z1]) b.box((x0 + x1) / 2, h + 0.05, pz, x1 - x0 + 0.1, 0.1, 0.12, WOOD);
  for (let x = x0 + 0.15; x < x1; x += 0.55) b.box(x, h + 0.13, (z0 + z1) / 2, 0.1, 0.06, z1 - z0 + 0.2, "#C9A86A");
}

/** Yöresel yemek tezgâhı (`food_stand` mekânı: tezgâh, tabureler, bank-masa; satıcı tezgâhın ardında). `dish` tezgâh üstü:
 *  testi kebabı (ağzı hamurla kapalı testiler, odun fırını) ya da gözleme (sac + katlanmış gözlemeler, oklava). */
function foodStand(b: Builder, i: number, j: number, face: VenueFace, dish: "testi" | "gozleme") {
  const v = placeVenue(boxOf(b), "food_stand", tx(i), tz(j), face, "scene");
  for (const [di, dj] of venueSolidTiles("food_stand", face)) b.block(i + di, j + dj);
  const c = v.counter!;
  const [fx, fz] = face === "+z" ? [0, 1] : face === "-z" ? [0, -1] : face === "+x" ? [1, 0] : [-1, 0];
  const rx = fz, rz = -fx;
  reedRoof(b, c.x - fx * 0.22, c.z - fz * 0.22, fx, fz);
  const at = (u: number, vv: number): [number, number] => [c.x + rx * u + fx * vv, c.z + rz * u + fz * vv];
  if (dish === "testi") {
    for (const [u, k] of [[0.75, 0], [0.98, 1], [1.2, 2]] as const) {
      const [x, z] = at(u, 0.05);
      b.box(x, c.top + 0.1, z, 0.16, 0.2, 0.16, k === 1 ? "#A0472A" : CLAY, "solid", 0.03);
      b.box(x, c.top + 0.23, z, 0.08, 0.06, 0.08, CLAY);
      b.box(x, c.top + 0.27, z, 0.1, 0.03, 0.1, "#E9D3B0"); // ağzı hamurla kapalı
    }
    const [x, z] = at(0.4, 0.15);
    b.box(x, c.top + 0.02, z, 0.24, 0.04, 0.24, "#8B5A3C"); // tahta servis tabağı
    b.box(x, c.top + 0.07, z, 0.12, 0.06, 0.12, CLAY);
  } else {
    const [sx, sz] = at(-0.6, -0.05);
    b.box(sx, c.top + 0.335, sz, 0.42, 0.03, 0.42, "#2B2B2B"); // sac (ocağın üstünde)
    b.box(sx, c.top + 0.36, sz, 0.26, 0.02, 0.18, "#E8C07A");
    for (let k = 0; k < 4; k++) { const [x, z] = at(1.0, 0.05); b.box(x, c.top + 0.015 + k * 0.03, z, 0.26, 0.03, 0.16, k % 2 ? "#E3B866" : "#D9A35B"); }
    const [ox, oz] = at(0.7, 0.12);
    b.box(ox, c.top + 0.03, oz, 0.04, 0.04, 0.34, "#C9A27E"); // oklava
  }
}

/** Mekân kioskunun düz çatısının üstüne yöresel sazlı çatı (kiosk çatısı 2,25–2,35; üstüne oturur) ve arka duvarının dışına
 *  kesme tüf kaplama + asılı kilim (arka yüz yola/vadiye bakar; satıcı imzasına dokunmaz). (x, z) kiosk ortası, (fx, fz) müşteri yönü. */
function reedRoof(b: Builder, x: number, z: number, fx: number, fz: number) {
  const alongZ = fx !== 0, [w, d] = alongZ ? [1.06, 3.1] : [3.1, 1.06];
  b.box(x, 2.39, z, w, 0.08, d, "#C9A86A", "solid", 0.04);
  b.box(x, 2.47, z, alongZ ? 0.7 : w - 0.3, 0.08, alongZ ? d - 0.3 : 0.7, "#B8955A", "solid", 0.04);
  b.box(x, 2.54, z, alongZ ? 0.3 : w - 0.6, 0.06, alongZ ? d - 0.6 : 0.3, "#A5824C", "solid", 0.03);
  // arka duvar dış yüzü: kiosk arka duvarı v −0,48…−0,36 → kaplama v −0,51
  const bx = x - fx * 0.49, bz = z - fz * 0.49, ww = alongZ ? 0.04 : 2.9, dd = alongZ ? 2.9 : 0.04;
  b.box(bx, 1.1, bz, ww, 2.2, dd, KAP.castle3, "solid", 0.04);
  b.box(bx - fx * 0.02, 1.25, bz - fz * 0.02, alongZ ? 0.03 : 1.1, 1.3, alongZ ? 1.1 : 0.03, KILIM[(Math.round(x * 3 + z) % 4 + 4) % 4], "solid", 0);
  b.box(bx - fx * 0.035, 1.25, bz - fz * 0.035, alongZ ? 0.02 : 0.7, 0.24, alongZ ? 0.7 : 0.02, KILIM[4], "solid", 0);
}

/** Çay bahçesi (`tea_garden` mekânı: semaver tezgâhı, tabureler, alçak masa; ocakçı tezgâhın ardında). */
function teaGarden(b: Builder, i: number, j: number, face: VenueFace) {
  const fz = face === "+z" ? 1 : face === "-z" ? -1 : 0, fx = face === "+x" ? 1 : face === "-x" ? -1 : 0;
  placeVenue(boxOf(b), "tea_garden", tx(i), tz(j), face, "scene");
  reedRoof(b, tx(i) - fx * 0.02, tz(j) - fz * 0.02, fx, fz);
  for (const [di, dj] of venueSolidTiles("tea_garden", face)) b.block(i + di, j + dj);
}

// ------------------------------------------------------------------------------------------ mağara oteli (HOTEL-SYS)
/** HOTEL-SYS (E1): şehrin tek oteli — küçük tüf mağara cephesi (i 28–30 × j 0–1, 3,1 ≤ Zelve 5,32 × 0,6; kapı (29, 2) geçit,
 *  içerisi mağara oteli lobisi: tonozlar, nişler, kilimler). Eski iki kanatlı mağara oteli (11 açık yatak, kesitten görünür)
 *  kalktı; yerinde alçak tüf kaya yamaçları, saksılı sardunyalar ve avlu. Görünür yatak yok. */
function caveInn(b: Builder) {
  placeHotel(b, "kapadokya", { at: [28, 0], w: 3, d: 2, door: [29, 2] }, S);
  // iki yanda alçak tüf yamaçları (otelden alçak, ≤ 2,2; arka sıra j 0)
  for (const [i0, i1, h] of [[24, 27, 2.0], [31, 34, 1.8]] as const) for (let i = i0; i <= i1; i++) {
    const hh = h - ((i + 1) % 2) * 0.35;
    b.box(tx(i), hh / 2, tz(0), 1, hh, 1, i % 2 ? S.walls[0] : S.walls[1], "solid", 0.06);
    b.block(i, 0);
  }
  b.hook("perch", 24, 0); b.hook("perch", 34, 0);
  // avlu: taş döşeme kenarında saksılı sardunyalar (yolu daraltmaz)
  for (const [x, z] of [[tx(27) + 0.3, tz(2)], [tx(31) - 0.3, tz(2)], [tx(26), tz(4)], [tx(32), tz(4)]] as [number, number][]) {
    b.box(x, 0.18, z, 0.22, 0.36, 0.3, "#B5603F", "solid", 0.03);
    b.box(x, 0.44, z, 0.2, 0.16, 0.28, "#5E7E4A", "solid", 0.1);
    b.box(x, 0.54, z, 0.1, 0.06, 0.1, "#E5484D");
  }
}

/** Kızıl nehir (Kızılırmak'ı andıran; x boyunca j0…j1, i0…i1; karolar engelli). Kenar sözleşmesi: su taban kenarına değmez
 *  (uçlarda kaya eşiği). Köpük yerine alçak çamur sığlıkları (tek su grubu). */
function redRiver(b: Builder, i0: number, i1: number, j0: number, j1: number) {
  for (let j = j0; j <= j1; j++) {
    b.box((tx(i0) + tx(i1)) / 2, -0.6, tz(j), i1 - i0 + 1, 0.8, 1, S.water, "water", 0);
    for (let i = i0; i <= i1; i++) b.block(i, j);
  }
  for (let i = i0 + 2; i < i1; i += 5) b.box(tx(i) + 0.3, -0.24, tz(i % 2 ? j0 : j1) + (i % 2 ? -0.3 : 0.3), 1.2, 0.08, 0.3, "#C98A6A", "solid", 0.04);
  for (const i of [i0 - 1, i1 + 1]) for (let j = j0; j <= j1; j++) {
    b.box(tx(i), 0.18, tz(j), 0.96, 0.36, 0.96, ROSE, "solid", 0.06);
    b.box(tx(i) + 0.1, 0.46, tz(j) - 0.1, 0.5, 0.2, 0.5, TUFF, "solid", 0.06);
    b.block(i, j);
  }
  b.hook("pond", Math.round((i0 + i1) / 2) + 3, j0, 3);
}

/** Ufuk: vadi tabanı, uzak peri bacası ormanı, pembe katmanlı sırtlar (Güvercinlik/Kızılçukur), uzak karlı volkan (genel).
 *  36 × 32 tabanın arkasında (z < −8), x = 6 çevresinde ortalı. */
function valleyBackdrop(b: Builder) {
  for (const x of [-33, -3, 27, 57]) {
    P(b, "backdrop", x, -0.5, -13.1, 30, 1, 10, "#D3BA97", 0.02);
    P(b, "backdrop", x, -0.5, -24.1, 30, 1, 12, "#CDB08C", 0.02);
  }
  const r = rng(1907), tones = [TUFF, HONEY, ROSE, KAP.cream];
  for (let n = 0; n < 96; n++) {
    const x = -42 + r() * 96, z = -10.2 - r() * 15, h = 2.6 + r() * 4.4, w = 1 + r() * 0.9;
    if (Math.abs(x - 6.5) < 7 && z > -19) continue; // kale kayasının arkası açık kalır (silüet ufka karışmaz)
    chimney(b, "backdrop", x, z, h, w, tones[Math.floor(r() * tones.length)]);
  }
  for (let x = -48, k = 0; x < 60; x += 10, k++) {
    const h = 3 + ((k * 7) % 5) * 0.6;
    P(b, "backdrop", x + 5, h / 2, -29, 10.4, h, 4, k % 2 ? ROSE : "#E2C3A6", 0.02);
    P(b, "backdrop", x + 5, h + 0.2, -29.4, 9, 0.4, 3, k % 2 ? "#E2C3A6" : ROSE, 0.02);
    P(b, "backdrop", x + 5, h * 0.55, -26.95, 10.4, 0.25, 0.1, KAP.cream, 0.02);
  }
  [[36, 0], [28, 1], [20, 2], [13, 3], [7, 4], [3.6, 5]].forEach(([w, k]) =>
    P(b, "backdrop", -20, 1.2 + k * 2.2, -46, w, 2.2, w * 0.5, k >= 4 ? "#F4F1EE" : "#BBA6B0", 0.02));
}

/** Taban 36 × 32 (3 × 2 bölge). Sütunlar: A i 0–11, B i 12–23, C i 24–35; arka j 0–12, orta j 13–22, nehir j 24–25, ön j 27–31. */
export const KAP_W = 36, KAP_D = 32;
const PATH_I = (i: number) => i === 5 || i === 6;

function surface(i: number, j: number): Surface {
  if (j === 24 || j === 25) return i >= 1 && i <= 34 ? "water" : "quay";
  if (j === 23 || j === 26) return "quay";
  if (PATH_I(i) && j >= 7) return "plaza";
  if (j >= 27) return i <= 11 ? "sidewalk" : i <= 23 ? "plaza" : "grass";
  if (i <= 11) return j <= 3 ? "quay" : j <= 12 ? "plaza" : "grass";
  if (i <= 23) {
    if (j <= 12) return i === 14 || i === 21 || j <= 1 || j === 6 ? "street" : "plaza";
    return j === 16 || j === 22 || i === 12 + ((j * 5) % 3) ? "street" : "sidewalk";
  }
  if (j <= 11) return j <= 6 ? "quay" : "plaza";
  return j === 16 || j === 19 || i === 30 ? "street" : "sidewalk";
}

/** Asma çardağı (açık; ince çıtalar, köşe direkleri karo kenarında, engellemez) — köy lokantası ve otel terası. Kirişler
 *  direklerin üstünde (2,5–2,6), çıtalar kirişlere oturur, yapraklar çıtaların üstünde. */
function vinePergola(b: Builder, i0: number, i1: number, j0: number, j1: number, slat = "#C9A86A") {
  const x0 = tx(i0) - 0.45, x1 = tx(i1) + 0.45, z0 = tz(j0) - 0.45, z1 = tz(j1) + 0.45;
  for (const px of [x0, x1]) for (const pz of [z0, z1]) b.box(px, 1.25, pz, 0.12, 2.5, 0.12, WOOD);
  for (const z of [z0, z1]) b.box((x0 + x1) / 2, 2.55, z, x1 - x0 + 0.1, 0.1, 0.12, WOOD);
  for (let x = x0 + 0.15; x < x1; x += 0.9) b.box(x, 2.6, (z0 + z1) / 2, 0.08, 0.06, z1 - z0 + 0.1, slat);
  for (let x = x0 + 0.6, k = 0; x < x1; x += 1.8, k++) b.box(x, 2.68, (z0 + z1) / 2 + (k % 2 ? 0.6 : -0.6), 1.1, 0.1, 1.4, "#7FA046", "solid", 0.14);
  for (const z of [z0, z1]) lanternString(b, x0 + 0.1, x1 - 0.1, 2.5, z);
}

/** Love Valley'yi andıran uzun ince baca (tek karo, engelli; şapka küçük). */
const tallChimney = (b: Builder, i: number, j: number, h: number, tone: string) => gridChimney(b, i, j, h, tone, false, 0.72);

export function buildKapadokya(): Built {
  const b = new Builder(1907, KAP_W, KAP_D);
  paintCity(b, S, surface);

  // ==== B arka: kale köyü meydanı — İLK istasyonlar (az ajanda önce simgenin önü dolar): iki kafe masası (4 istasyon), asma
  //      çardak altında testi kebabı lokantası (food_stand: tezgâh i 13–15 × j 8, sipariş (14, 9), masa (14, 10)), çay ocağı
  for (const i of [17, 19]) { cafeSet(b, i, 9, "#F2E6D0"); cafeStations(b, i, 9); }
  foodStand(b, 14, 8, "+z", "testi");
  vinePergola(b, 13, 20, 8, 10);
  b.box(tx(12), 0.55, tz(9), 0.9, 1.1, 0.9, HONEY, "solid", 0.04); b.box(tx(12), 1.14, tz(9), 0.96, 0.08, 0.96, "#C9A27E");
  b.box(tx(12), 1.3, tz(9), 0.22, 0.24, 0.22, "#C47A3A"); b.block(12, 9);
  b.props.push({ k: "coffee", p: [tx(12), 0, tz(9)], r: 0, tile: [12, 10] }); // çay ocağı
  const wx = tx(18), wz = tz(12); // köy kuyusu (su yok: bilezik + çıkrık)
  b.box(wx, 0.35, wz, 0.9, 0.7, 0.9, TUFF, "solid", 0.04); b.box(wx, 0.72, wz, 0.6, 0.04, 0.6, "#3A2A22");
  for (const dx of [-0.42, 0.42]) b.box(wx + dx, 1.1, wz, 0.08, 0.8, 0.08, WOOD);
  b.box(wx, 1.5, wz, 1.0, 0.08, 0.1, WOOD); b.block(18, 12);
  for (const i of [16, 20]) cityBench(b, i, 12, "-z", "#8B5A2B", "#4A3A2E");
  b.rest.push([17, 11], [19, 11]);

  // ==== C arka: mağara oteli (HOTEL-SYS: tek otel, geçit kapısı; görünür yatak yok) + önünde balon seyir çay bahçesi (tea_garden: tezgâh i 29–31 × j 8, sipariş
  //      (30, 9); tezgâh güneyde → müşteri balon alanına bakar) ve asma çardaklı teras kafesi (6 istasyon) + çay ocağı (kahve)
  caveInn(b);
  teaGarden(b, 30, 10, "-z");
  for (const i of [25, 27, 33]) { cafeSet(b, i, 9, "#F2E6D0"); cafeStations(b, i, 9); }
  vinePergola(b, 24, 28, 8, 10); vinePergola(b, 32, 34, 8, 10);
  b.box(tx(35), 0.55, tz(9), 0.9, 1.1, 0.9, HONEY, "solid", 0.04); b.box(tx(35), 1.14, tz(9), 0.96, 0.08, 0.96, "#C9A27E");
  b.box(tx(35), 1.3, tz(9), 0.22, 0.24, 0.22, "#C47A3A"); b.block(35, 9);
  b.props.push({ k: "coffee", p: [tx(35), 0, tz(9)], r: -Math.PI / 2, tile: [34, 9] });
  cafeSet(b, 32, 12, "#F2E6D0"); cafeStations(b, 32, 12);
  gridChimney(b, 35, 11, 4.6, HONEY, true); gridChimney(b, 24, 11, 3.6, ROSE);
  b.rest.push([29, 3], [30, 5]);

  // ==== A orta: üzüm bağları (üç sıra çifti; arada yer minderleri), nehre bakan banklar — müzenin önü alçak kalır
  for (const j of [14, 17, 20]) { vineRow(b, 1, 4, j); vineRow(b, 7, 10, j); }
  for (const [i, j, k] of [[2, 15, 2], [9, 15, 1], [3, 18, 3], [8, 18, 0]] as [number, number, number][]) {
    b.rug1(i, j, KILIM[k]); b.station(i, j, DOWN, "sit_ground", "laptop", 0.06);
  }
  for (const i of [1, 3, 8, 10]) { cityBench(b, i, 22, "-z", "#8B5A2B", "#4A3A2E"); b.station(i, 22, DOWN, "sit_bench", "laptop", 0.46); }
  for (const [x, z] of [[tx(4) + 0.3, tz(16)], [tx(9) - 0.2, tz(19)], [tx(2), tz(21)]] as [number, number][])
    b.box(x, 0.18, z, 0.5, 0.36, 0.4, "#B07D48", "solid", 0.05); // hasat sepetleri (engellemez)
  vTree(b, 11, 13, "apricot"); vTree(b, 11, 21, "poplar"); vTree(b, 0, 21, "apricot");
  b.hook("grass", 3, 16, 2); b.hook("grass", 8, 19, 2);

  // ==== B ön: Avanos çömlekçileri (nehir kıyısı; j 27 açık yol). Sazlı çardak (i 12–14 × j 28–29) altında ayakla dönen çark ve
  //      başında usta (yüzü kıyı yoluna), arkada kurutma rafı; 3 satış tezgâhı = 3 istasyon; odun fırınları; kıyıda testi kebabı
  //      tezgâhı (food_stand: tezgâh i 20–22 × j 31, sipariş (21, 30), masa (21, 29)).
  reedCanopy(b, 12, 14, 28, 29);
  potteryWheel(b, 13, 28, "-z");
  dryingRack(b, 12, 29, 2);
  for (const i of [12, 14, 16]) potteryStall(b, i, 31);
  kiln(b, 22, 28); kiln(b, 23, 28);
  foodStand(b, 21, 31, "-z", "testi");
  for (let k = 0; k < 4; k++) b.box(tx(23) - 0.25 + (k % 2) * 0.45, 0.2, tz(30) - 0.2 + Math.floor(k / 2) * 0.4, 0.34, 0.4, 0.34, k % 2 ? CLAY : "#A0472A", "solid", 0.04);
  b.block(23, 30);
  lanternPost(b, 19, 28);
  b.rest.push([17, 29], [18, 30]);

  // ==== B orta: halı/kilim avlusu — iki dokuma tezgâhı (yazma), kilim askıları, halı sergisi, kilim yığını, iki zanaat tezgâhı
  loom(b, 15, 15); b.spot("write", 15, 16, DOWN);
  loom(b, 17, 15);
  kilimRack(b, 19, 14, 2, 1); kilimRack(b, 13, 13, 2, 3);
  for (const [i, k] of [[16, 0], [17, 1], [18, 2], [19, 3]] as [number, number][]) b.rug1(i, 18, KILIM[k]);
  kilimPile(b, 18, 20);
  for (const i of [15, 20]) { marketStall(b, S, i, 20, "crafts", KILIM[i % 4]); marketStation(b, i, 20); }
  for (const i of [16, 19]) cityBench(b, i, 22, "-z", "#8B5A2B", "#4A3A2E");
  b.rest.push([17, 22], [18, 22]);

  // ==== C ön: balon kalkış alanı (şafak) — yerde şişmiş, kalkmaya hazır balon (25–26 × 29–30), soğuk şişirmede yatan zarf
  //      (ağız 29, tepe 33; fan ve yan yatmış sepet 27–28), sırada bekleyen sepet, rüzgâr panosu (web), uçuş otomatı (kabuk),
  //      uçuş planı (plan), 2 izleme bankı (2 istasyon); j 27 açık yol
  uprightBalloon(boxOf(b), (tx(25) + tx(26)) / 2, (tz(29) + tz(30)) / 2, 1, 0);
  for (const i of [25, 26]) for (const j of [29, 30]) b.block(i, j);
  coldInflation(boxOf(b), tx(29) - 0.2, tz(30), 4.6, 1, 2, 0.46);
  for (const [i, j] of [[27, 30], [28, 29], [28, 30], [29, 30], [30, 30], [31, 30], [32, 30], [33, 30], [34, 30]] as [number, number][]) b.block(i, j);
  stagedBasket(boxOf(b), tx(35), tz(31) - 0.1, 0.9, 3, "-z"); b.block(35, 31); b.block(35, 30);
  board(b, 24, 28, true); b.spot("web", 24, 29, DOWN);
  b.terminal(34, 28, "+z"); b.spot("shell", 34, 29, DOWN);
  board(b, 33, 28, false); b.spot("plan", 33, 29, DOWN);
  for (const i of [30, 32]) { cityBench(b, i, 28, "+z", "#8B5A2B", "#4A3A2E"); b.station(i, 28, UP, "sit_bench", "laptop", 0.46); }
  for (const dz of [-0.22, 0.02, 0.26]) b.box(tx(35) + (dz > 0.1 ? 0.2 : -0.1), 0.4, tz(29) + dz, 0.22, 0.8, 0.22, "#C9CED3"); b.block(35, 29); // yakıt tüpleri
  b.box(tx(35), 1.4, tz(26), 0.08, 2.8, 0.08, "#5B4A3A"); b.box(tx(35) - 0.35, 2.6, tz(26), 0.6, 0.2, 0.2, "#F08A4B"); b.block(35, 26); // rüzgâr tulumu
  b.rest.push([28, 31], [32, 31]);
  b.zones.push({ kind: "landmark", tag: "balloon_field", i0: 24, j0: 27, w: 12, d: 5 });

  // ==== B arka: Uçhisar'ı andıran kale kayası (en yüksek öğe; i 15–20 × j 2–5, arkasında j 0–1 iki karoluk patika) + eteğinde
  //      mağara ev köyü; köy patikaları i 14 ve i 21
  castleRock(b, 15, 2);
  caveHouse(b, 12, 1, 2, 3.6, HONEY); caveHouse(b, 12, 3, 2, 2.8, ROSE); caveHouse(b, 13, 5, 1, 2.2, TUFF);
  caveHouse(b, 22, 1, 2, 3.8, ROSE); caveHouse(b, 22, 3, 2, 2.6, HONEY); caveHouse(b, 22, 5, 1, 2.4, TUFF);
  caveHouse(b, 12, 7, 2, 2.6, TUFF); caveHouse(b, 22, 7, 2, 2.8, ROSE); caveHouse(b, 12, 11, 2, 2.2, HONEY);
  caveHouse(b, 22, 10, 2, 2.4, TUFF, false);
  b.hook("perch", 22, 1); b.hook("perch", 12, 1);
  lanternPost(b, 15, 7); lanternPost(b, 20, 7); lanternPost(b, 21, 13);

  // ==== A arka: Göreme'yi andıran açık hava müzesi — kaya kiliseleri (sacred: cephe + avlu), manastır kütlesi, şapel konileri,
  //      giriş kapısı ve j 7–31 boyunca düz yaklaşma yolu (i 5–6). Önü alçak bağ → taban kamerasından görünür.
  rockChurches(b, 3, 4, 6);
  sacredZone(b, 2, 4, 8, 3, 1);
  chapelCone(b, 1, 3, 4.6); chapelCone(b, 10, 3, 5.4, 1.1); chapelCone(b, 9, 1, 4.0);
  for (const i of [4, 7]) {
    b.box(tx(i), 1.3, tz(9), 0.8, 2.6, 0.8, KAP.church, "solid", 0.04);
    b.box(tx(i), 2.75, tz(9), 0.6, 0.3, 0.6, KAP.church2, "solid", 0.04);
    b.block(i, 9);
  }
  b.box((tx(4) + tx(7)) / 2, 2.95, tz(9), 3.6, 0.3, 0.5, KAP.church2, "solid", 0.03); // kapı lentosu (üstten geçilir)
  for (let j = 10; j <= 22; j += 2) for (const x of [tx(5) - 0.46, tx(6) + 0.46]) b.box(x, 0.08, tz(j), 0.12, 0.16, 0.7, KAP.cream, "solid", 0.04);
  kiosk(b, S, 9, 10, KILIM[1]); // bilet ve çay: kahve/mola (9,11)
  b.box(tx(2), 0.7, tz(10), 0.7, 1.4, 0.4, "#8B6A47", "solid", 0.04); // rehber kitapçığı/kartpostal rafı (okuma)
  for (let k = 0; k < 6; k++) b.box(tx(2) - 0.2 + (k % 3) * 0.2, 0.7 + Math.floor(k / 3) * 0.45, tz(10) + 0.21, 0.16, 0.3, 0.02, KILIM[k % 4]);
  b.block(2, 10); b.spot("read", 2, 11, DOWN);
  for (const i of [3, 8]) cityBench(b, i, 12, "-z", "#8B5A2B", "#4A3A2E");
  b.rest.push([3, 11], [8, 11]);
  vTree(b, 0, 9, "poplar"); vTree(b, 11, 9, "poplar"); vTree(b, 0, 11, "poplar"); vTree(b, 11, 11, "poplar");
  lanternPost(b, 4, 12); lanternPost(b, 7, 12);
  b.zones.push({ kind: "landmark", tag: "open_air_museum", i0: 1, j0: 1, w: 10, d: 6 });

  // ==== C orta: KAHRAMAN peri bacası vadisi — Love Valley'yi andıran uzun ince bacalar (sağ), Paşabağ'ı andıran çok şapkalı
  //      kümeler, klasik oyuklu bacalar; patikalar j 16 / j 19 / i 30 boydan boya. B'nin iki yanında vadi uçları.
  for (const [i, j, h, t] of [[33, 13, 7.6, TUFF], [34, 15, 8.2, HONEY], [33, 18, 7.0, ROSE], [32, 21, 6.4, TUFF], [34, 21, 7.4, KAP.cream]] as [number, number, number, string][])
    tallChimney(b, i, j, h, t);
  for (const [i, j, h, t] of [[25, 14, 5.4, TUFF], [27, 17, 6.0, HONEY], [26, 21, 4.8, ROSE], [29, 13, 5.0, KAP.cream]] as [number, number, number, string][])
    pasabag(b, i, j, h, t);
  for (const [i, j, h, t, holes, w] of [[28, 21, 5.2, ROSE, true, 1.1], [24, 18, 4.6, HONEY, true, 1.0], [31, 14, 4.2, ROSE, false, 0.95],
    [28, 15, 3.4, TUFF, false, 0.9], [12, 15, 5.0, ROSE, true, 1.1], [12, 19, 4.4, HONEY, false, 1.0], [23, 15, 5.6, TUFF, true, 1.15],
    [22, 19, 3.8, ROSE, false, 0.9]] as [number, number, number, string, boolean, number][]) gridChimney(b, i, j, h, t, holes, w);
  trio(b, 31, 17, 5.2, TUFF); trio(b, 25, 20, 4.4, HONEY);
  for (const [i, j] of [[34, 15], [27, 17], [33, 18], [23, 15]] as [number, number][]) b.hook("perch", i, j);
  for (const [x, z, s] of [[tx(26) + 0.3, tz(16), 0.36], [tx(29) - 0.2, tz(18) + 0.3, 0.3], [tx(32) - 0.3, tz(20) + 0.2, 0.28], [tx(24), tz(13), 0.3]] as [number, number, number][])
    b.box(x, s / 2, z, s * 1.4, s, s, ROSE, "solid", 0.06);
  b.rest.push([26, 19], [32, 16]);
  b.zones.push({ kind: "landmark", tag: "fairy_chimneys", i0: 22, j0: 13, w: 14, d: 10 });

  // ==== kızıl nehir (j 24–25) + üç yaya köprüsü (müze yolu, orta, balon alanı) + kıyı bordürleri + olta noktaları
  redRiver(b, 1, 34, 24, 25);
  for (const [i0, i1] of [[5, 6], [17, 18], [29, 30]]) archBridge(b, S, i0, i1, 24, 25, "#D3B08E");
  for (const [i0, i1] of [[1, 4], [7, 16], [19, 28], [31, 34]]) { quay(b, S, i0, i1, 23, "+z"); quay(b, S, i0, i1, 26, "-z"); }
  b.hook("fish", 14, 23, 0); b.hook("fish", 26, 26, 1);
  lanternPost(b, 7, 23); lanternPost(b, 28, 23);

  // ==== A ön: Zelve'yi andıran terk edilmiş mağara köyü (aşınmış, yüzleri çökmüş koniler; ışık yok) ve girişinde gözleme tezgâhı
  //      (food_stand: tezgâh i 8–10 × j 31, sipariş (9, 30), masa (9, 29))
  for (const [i, j, h, t] of [[1, 27, 4.4, ROSE], [3, 28, 5.2, HONEY], [2, 30, 3.4, TUFF], [8, 27, 4.8, ROSE], [11, 29, 5.0, HONEY],
    [7, 29, 3.0, TUFF], [4, 30, 2.6, ROSE], [11, 27, 3.2, TUFF]] as [number, number, number, string][]) ruinCone(b, i, j, h, t);
  foodStand(b, 9, 31, "-z", "gozleme");
  for (const [x, z] of [[tx(3) - 0.3, tz(28) + 0.33], [tx(8) + 0.28, tz(27) + 0.33], [tx(4) + 0.28, tz(30) + 0.33]] as [number, number][])
    b.box(x, 0.12, z, 0.3, 0.24, 0.24, KAP.cream, "solid", 0.08); // moloz (koni dibinde, kendi karosunda)
  b.hook("perch", 3, 28); b.hook("perch", 11, 29);
  b.rest.push([6, 28], [1, 29]);
  b.zones.push({ kind: "landmark", tag: "zelve", i0: 0, j0: 27, w: 12, d: 4 });

  valleyBackdrop(b);

  // ---- gökte 12 sıcak hava balonu (yalnız gündüz; yollar ızgara içinde: x −12…24, z −8…24; kale sütununun önünde yok;
  //      üçü kıyıdan kalkıp iner — pingpong). Logo/yazı yok.
  const balloons: [string, string, number, number, number, [number, number, number][]][] = [
    ["#E5584E", "#F8E7C8", 150, 0, 0.6, [[16.5, 1.2, 22.5], [16, 5.5, 19], [13.5, 11, 11]]],
    ["#F2B33D", "#B9574A", 170, 0.45, 0.6, [[20.5, 1.2, 22.5], [20, 6, 19.5], [18, 11.5, 12]]],
    ["#5E9E5A", "#F2E6D0", 160, 0.8, 0.55, [[18.5, 1.2, 23.5], [18.5, 6, 20], [16, 12, 9]]],
    ["#4FA3A5", "#F2E6D0", 140, 0.6, 0.62, [[-10.5, 8.5, -5], [-8, 10, 1]]],
    ["#7A5C99", "#F2B33D", 160, 0.2, 0.58, [[-5, 11.5, 3], [-2, 12, 9]]],
    ["#E98AA8", "#FFFFFF", 150, 0.5, 0.62, [[13, 10.5, -6.5], [16.5, 11.5, -2]]],
    ["#3F6E8C", "#F08A4B", 120, 0.1, 0.5, [[20.5, 11, -5.5], [23, 10, 0]]],
    ["#F08A4B", "#3F6E8C", 130, 0.35, 0.48, [[-0.5, 12.5, -7.2], [1.5, 13, -4.5]]],
    ["#B9574A", "#F2E6D0", 125, 0.85, 0.55, [[-11, 8, 10], [-9, 9.5, 16]]],
    ["#F8E7C8", "#E5584E", 145, 0.65, 0.5, [[22.5, 11, 4], [20.5, 12, 9]]],
    ["#9BB04A", "#3F6E8C", 115, 0.3, 0.45, [[11, 13, -7.5], [12.5, 12.5, -4]]],
    ["#D9A441", "#7A5C99", 135, 0.9, 0.5, [[4, 12.5, 12], [7.5, 12, 17]]],
  ];
  for (const [color, accent, period, phase, scale, path] of balloons)
    addMover(b, { shape: "balloon", color, accent, period, phase, scale, path, mode: "pingpong", dayOnly: true });
  fillSpotReach(b); // her istasyona ölçeklenmiş yarıçapta araç noktası
  return b.done();
}

/** Sahne tanımı alanları (scenes.ts kaydı: `scene({ id: "kapadokya", core: CITY_CORE, ...KAPADOKYA_ENV, build: buildKapadokya })`;
 *  buradaki `core` bütün 36 × 32 tabandır ve varsayılanı ezer). Şafak: şeftali gökyüzü, alçak ve sıcak güneş; Görünüm → Işık
 *  "Gece" seçilince balonlar iner, fenerler ve oyuk pencereler yanar. */
export const KAPADOKYA_ENV: Omit<SceneDef, "id" | "label" | "hint" | "build"> = {
  swatch: ["#DCC4A2", "#F6CDB4"], sky: "#F6CDB4", fog: [44, 110],
  hemi: ["#FFE9D6", "#C9A27E", 1.12], sun: { color: "#FFC890", intensity: 1.75, pos: [13, 10, 9] },
  tier: "city", pack: "world_tour_turkey", time: "auto", ip_risk: 0, culture_risk: 1, // §3.4 — oyma kaya kiliseleri (sacred, yalnız dış cephe) → kültür okuru notu
  core: { i0: 0, j0: 0, w: KAP_W, d: KAP_D },
};
