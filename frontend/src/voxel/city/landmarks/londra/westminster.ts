/**
 * Londra şehir haritası: **Westminster ve nehir kıyısı** (başlangıç semti; Londra satırı).
 *
 * Thames doğu–batı akar (lj 12–23). Kuzey yakada saat kulesi (gerçek orana yakın: genişlik : yükseklik ≈ 1 : 7,5; dört yüzde
 * rakamsız kadran, çan katı, kademeli sivri külah) ve nehir boyunca Gotik meclis binası (payandalar, köşkler, orta fener
 * kulesi, doğu ucunda büyük kare kule; bayrak direği ve bayrak YOK). Saat kulesine girilir → INTERIOR-VIEW saat kulesi tarifi
 * (giriş holü → saat mekanizması → çan katı). Batıda yeşil korkuluklu köprü (ortası seyir noktası: gün batımı anı), güney
 * yakada kendi kendini taşıyan genel gözlem çarkı (marka renk düzeni yok) ve kıyı bahçesi; çarkın güneyinde geniş meydan.
 * Arma, taç, yazı, ulaşım simgesi yok.
*/
import type { Block } from "../../../scenes";
import { sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel, type Sink } from "../../../citymap/design";
import { at, deckchair, L, lamp, infoKiosk, tree } from "./kit";
import { walkBenchAt } from "../../kit";
import { placeVenue, venueSolidTiles } from "../../venues";

/** CORE-WALK: Westminster balık-patates dükkânının kökeni (semt yerel tezgâh karosu) ve engelli karoları. */
const VENUE_O: [number, number] = [40, 25];
const VENUE_SOLID: [number, number, number, number][] = venueSolidTiles("chip_shop", "-z").map(([di, dj]) => [VENUE_O[0] + di, VENUE_O[1] + dj, 1, 1]);
function venueBlocks(x: number, z: number): Block[] {
  const out: Block[] = [];
  placeVenue(sink(out), "chip_shop", x, z, "-z", "walk");
  return out;
}

const FACES: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
/** Kare gövdenin yüzüne levha: n yüz, u yüz boyunca kayma, t yüzden dışarı. */
function onFace(b: Sink, x: number, z: number, half: number, n: number, u: number, y: number, t: number, w: number, h: number, c: string, g: Block["g"] = "solid") {
  const [nx, nz] = FACES[n], o = half + t + 0.02;
  if (nz) b(x + u * nz, y, z + nz * o, w, h, 0.04, c, g, 0);
  else b(x + nx * o, y, z - u * nx, 0.04, h, w, c, g, 0);
}
function spire(b: Sink, x: number, z: number, y0: number, steps: [number, number][], c: string) {
  let y = y0;
  for (const [w, h] of steps) { b(x, y + h / 2, z, w, h, w, c, "solid", 0.02); y += h; }
}

// ------------------------------------------------------------------------------------------ saat kulesi (3 × 3, h 14)
/** (K2 simge eğrisi): kule kaidenin üstünden (y 0,8) bütün ayrıntısıyla orantılı ×`SAAT_K` küçülür (tepe 22 → 14,1; eğri
 * 96 m → 15,3 ±%25). Şehir içi sıra: gözlem çarkından ve kubbeli katedralden kısa, açılır köprüden ve anıt sütundan uzun.*/
const SAAT_K = 0.627, SAAT_Y0 = 0.8;
function saatKulesi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b0 = sink(out);
  const X = c.cx, Z = c.cz, CY = 13.3;
  b0(X, 0.4, Z, 3, 0.8, 3, L.sandD, "solid", 0.03);
  const b: Sink = (x, y, z, w, h, d, col, g, j) =>
    b0(X + (x - X) * SAAT_K, SAAT_Y0 + (y - SAAT_Y0) * SAAT_K, Z + (z - Z) * SAAT_K, w * SAAT_K, h * SAAT_K, d * SAAT_K, col, g, j);
  b(X, 6.4, Z, 2.6, 11.2, 2.6, L.sand, "solid", 0.02);
  for (let n = 0; n < 4; n++) {
    for (const u of [-0.5, 0.5]) onFace(b, X, Z, 1.3, n, u, 6.4, 0, 0.12, 11.2, L.sandL);
    for (const y of [3.2, 6.6, 10.0]) onFace(b, X, Z, 1.3, n, 0, y, 0.01, 0.3, 1.4, L.winD);
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b(X + sx * 1.3, 6.6, Z + sz * 1.3, 0.32, 11.6, 0.32, L.sandL, "solid", 0);
  // saat katı: dört yüzde yaldız çerçeve, koyu halka, aydınlık kadran (rakamsız), dört ana işaret, akrep ve yelkovan
  b(X, CY, Z, 3.0, 2.6, 3.0, L.sandL, "solid", 0.02);
  for (let n = 0; n < 4; n++) {
    onFace(b, X, Z, 1.5, n, 0, CY, 0, 2.3, 2.3, L.gold);
    onFace(b, X, Z, 1.5, n, 0, CY, 0.04, 2.0, 2.0, L.ink);
    onFace(b, X, Z, 1.5, n, 0, CY, 0.08, 1.78, 1.78, L.dial, "glow");
    for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2; onFace(b, X, Z, 1.5, n, Math.sin(a) * 0.7, CY + Math.cos(a) * 0.7, 0.12, 0.12, 0.24, L.ink); }
    onFace(b, X, Z, 1.5, n, 0, CY + 0.26, 0.13, 0.07, 0.56, L.ink);
    onFace(b, X, Z, 1.5, n, 0.18, CY, 0.13, 0.4, 0.07, L.ink);
    onFace(b, X, Z, 1.5, n, 0, 14.85, 0, 1.6, 0.3, L.sandL);
  }
  b(X, 14.7, Z, 3.12, 0.14, 3.12, L.gold, "solid", 0);
  // çan katı ve köşe pinaklleri
  b(X, 15.5, Z, 2.4, 1.4, 2.4, "#3A3F47", "solid", 0);
  for (let n = 0; n < 4; n++) for (const u of [-0.55, 0.55]) onFace(b, X, Z, 1.2, n, u, 15.5, 0, 0.14, 1.4, L.sandL);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b(X + sx * 1.25, 15.8, Z + sz * 1.25, 0.32, 2.0, 0.32, L.sandL, "solid", 0);
    b(X + sx * 1.25, 17.0, Z + sz * 1.25, 0.12, 0.4, 0.12, L.gold, "solid", 0);
  }
  b(X, 16.3, Z, 2.7, 0.16, 2.7, L.sandL, "solid", 0);
  spire(b, X, Z, 16.38, [[2.3, 0.9], [1.9, 0.9], [1.5, 0.9], [1.1, 0.9], [0.75, 0.9], [0.45, 0.8]], L.spire);
  b(X, 21.85, Z, 0.16, 0.3, 0.16, L.gold, "solid", 0);
  return out;
}
const saatFar = (c: LandmarkCtx): Block[] => {
  const k = SAAT_K, y = (v: number) => SAAT_Y0 + (v - SAAT_Y0) * k;
  return [
    { p: [c.cx, y(7.4), c.cz], s: [2.8 * k, 14.8 * k, 2.8 * k], c: L.sand, g: "solid", j: 0 },
    { p: [c.cx, y(13.3), c.cz], s: [3.1 * k, 2.4 * k, 3.1 * k], c: L.dial, g: "glow", j: 0 },
    { p: [c.cx, y(19.0), c.cz], s: [1.4 * k, 5.4 * k, 1.4 * k], c: L.spire, g: "solid", j: 0 },
  ];
};

// ------------------------------------------------------------------------------------------ meclis binası (16 × 5, h 7; cephe güneye, nehre)
function parlamento(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0 } = c, Z = c.cz, front = z0 - 0.02;
  b(c.cx, 0.15, Z, 16, 0.3, 5, L.sandD, "solid", 0.02);
  b(x0 + 6.5, 1.8, Z, 13, 3.0, 4.6, L.sand, "solid", 0.02);
  b(x0 + 6.5, 3.36, Z, 13.1, 0.12, 4.7, L.sandL, "solid", 0);
  b(x0 + 6.5, 3.75, Z + 0.2, 12.8, 0.66, 3.6, "#5E6873", "solid", 0.02);
  b(x0 + 6.5, 4.2, Z + 0.2, 12.4, 0.24, 1.6, "#4E5864", "solid", 0.02);
  // nehir cephesi: sivri pencereler, kat bandı, payanda pinaklleri
  for (let k = 0; k < 13; k++) b(x0 + 0.5 + k, 1.8, front, 0.34, 2.2, 0.04, L.winD, "solid", 0);
  b(x0 + 6.5, 1.75, front - 0.02, 13, 0.08, 0.04, L.sandL, "solid", 0);
  for (let k = 1; k < 13; k += 1.3) b(x0 + k, 3.75, front + 0.1, 0.12, 0.6, 0.12, L.sandL, "solid", 0);
  // dört köşk (öne çıkan, piramit başlıklı)
  for (const px of [1, 4.5, 8.5, 12]) {
    b(x0 + px, 2.2, z0 + 0.5, 1.0, 3.8, 1.2, L.sand, "solid", 0.02);
    b(x0 + px, 4.3, z0 + 0.5, 0.8, 0.4, 1.0, L.spire, "solid", 0.02);
    b(x0 + px, 4.7, z0 + 0.5, 0.4, 0.4, 0.5, L.spire, "solid", 0.02);
  }
  // CITY-PASS-LON ( "Meclis"): sekizgen merkez kulesi — gerçekte 91 m (saat kulesinin %95'i);
  // sekizgen fener kasnağı (artı kesit) + ince sivri külah
  const mx = x0 + 6.5, mz = Z + 0.2;
  b(mx, 4.6, mz, 1.3, 1.2, 1.3, L.sandL, "solid", 0.02);
  b(mx, 6.1, mz, 1.1, 1.8, 0.7, L.sand, "solid", 0.02); b(mx, 6.1, mz, 0.7, 1.8, 1.1, L.sand, "solid", 0.02);
  for (const u of [-0.2, 0.2]) b(mx + u, 6.2, mz - 0.56, 0.12, 1.0, 0.04, L.winD, "solid", 0);
  spire(b, mx, mz, 7.0, [[1.0, 1.0], [0.78, 1.3], [0.56, 1.3], [0.36, 1.1], [0.18, 1.0]], L.spire);
  b(mx, 12.9, mz, 0.08, 0.3, 0.08, L.gold, "solid", 0);
  // doğu ucunda büyük kare kule (gerçekte 98,5 m, saat kulesinden yüksek ve çok daha kalın; bayraksız): sekizgen köşe kuleleri ve
  // pinakller, tabanda kemerli tören girişi, katlar boyunca sivri pencere sıraları, piramit demir çatı
  const vx = x0 + 14.5;
  b(vx, 5.95, Z, 2.8, 11.9, 2.8, L.sand, "solid", 0.02);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b(vx + sx * 1.3, 6.35, Z + sz * 1.3, 0.5, 12.7, 0.36, L.sandL, "solid", 0);
    b(vx + sx * 1.3, 6.35, Z + sz * 1.3, 0.36, 12.7, 0.5, L.sandL, "solid", 0);
    b(vx + sx * 1.3, 12.95, Z + sz * 1.3, 0.3, 0.5, 0.3, L.spire, "solid", 0.02);
    b(vx + sx * 1.3, 13.35, Z + sz * 1.3, 0.08, 0.3, 0.08, L.gold, "solid", 0);
  }
  b(vx, 1.4, Z - 1.42, 1.2, 2.6, 0.04, "#3A2E26", "solid", 0); // tören girişi kemeri
  b(vx, 2.9, Z - 1.42, 1.6, 0.3, 0.06, L.gold, "solid", 0);
  for (const y of [4.4, 6.6, 8.8]) for (const u of [-0.5, 0, 0.5]) for (const fz of [Z - 1.42, Z + 1.42]) b(vx + u, y, fz, 0.24, 1.4, 0.04, L.winD, "solid", 0);
  b(vx, 11.96, Z, 2.9, 0.12, 2.9, L.sandL, "solid", 0);
  for (const [w, y] of [[2.4, 12.25], [1.8, 12.75], [1.2, 13.25], [0.6, 13.75]] as const) b(vx, y, Z, w, 0.5, w, L.spire, "solid", 0.02);
  b(vx, 14.15, Z, 0.12, 0.3, 0.12, L.gold, "solid", 0);
  return out;
}
const parlamentoFar = (c: LandmarkCtx): Block[] => [
  { p: [c.x0 + 6.5, 2.0, c.cz], s: [13, 4.0, 4.6], c: L.sand, g: "solid", j: 0 },
  { p: [c.x0 + 14.5, 6.6, c.cz], s: [2.8, 13.2, 2.8], c: L.sand, g: "solid", j: 0 },
  { p: [c.x0 + 6.5, 8.5, c.cz], s: [0.8, 9.0, 0.8], c: L.spire, g: "solid", j: 0 },
];

// ------------------------------------------------------------------------------------------ gözlem çarkı (14 × 2, h 16; jant x–y düzleminde)
/** CITY-PASS-LON ( "Gözlem çarkı"): gerçek konsol çarktan esinli — sürekli jant (birbirine değen
 * küpler), göbekten janta gergin tel kollar (yatay/dikey tek parça, çaprazlar değen küp zinciri), jantın **dışında** 32 köşeli
 * cam kabin (yumurta/oval değil), sabit göbek mili, **tek yanlı** A çerçeve karada (güneyde; ayaklar semt `solid` karolarında),
 * nehre bakan yanda alçak biniş iskelesi. Parsel bütçesi (CITY_NEAR_BUDGET katı 192, cam 12) yüzünden ≈ 210 blok; cam kabin
 * rengi katı grupta. Marka renk düzeni, ad, yazı, ışık gösterisi yok.*/
const CARK_HUB = 8.6, CARK_R = 6.8;
function cark(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, HUB = CARK_HUB, R = CARK_R, LEGC = "#DCE1E6";
  // jant: değen küp halkası (küp 0,46 ≥ aralık), derin kesit (iki yüz arası kafes)
  const n = Math.ceil((2 * Math.PI * R) / 0.45), sz = (2 * Math.PI * R) / n + 0.02;
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; b(X + R * Math.cos(a), HUB + R * Math.sin(a), Z, sz, sz, 1.0, k % 4 ? L.white : "#E1E6EA", "solid", 0); }
  // tel kollar: yatay + dikey tek parça; dört çapraz değen küp zinciri
  b(X, HUB, Z, 2 * R - 0.3, 0.12, 0.12, "#C3CAD2", "solid", 0);
  b(X, HUB, Z, 0.12, 2 * R - 0.3, 0.12, "#C3CAD2", "solid", 0);
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    for (let r = 0.75; r <= R - 0.2; r += 0.26 / Math.SQRT1_2) b(X + r * Math.cos(a), HUB + r * Math.sin(a), Z, 0.22, 0.22, 0.12, "#C3CAD2", "solid", 0);
  }
  // göbek + mil (A çerçeve tepesine, güneye)
  b(X, HUB, Z, 1.0, 1.0, 1.3, "#8A939E", "solid", 0.02);
  b(X, HUB, Z - 1.2, 0.4, 0.4, 2.0, "#B8C0C8", "solid", 0);
  // kabinler: jantın dışında, mil yönünde uzun köşeli cam kabin (açık mavi cam + beyaz tavan çizgisi tek blokta)
  for (let k = 0; k < 32; k++) {
    const a = ((k + 0.5) / 32) * Math.PI * 2, r = R + 0.47;
    b(X + r * Math.cos(a), HUB + r * Math.sin(a), Z, 0.5, 0.5, 1.15, "#D3E4EE", "solid", 0.02);
  }
  // tek yanlı A çerçeve: tepeden (göbek arkası) güneydeki iki kaideye ≈ 70° eğik ayaklar, bağ kirişi
  const apZ = Z - 2.1, ftZ = Z - 3.5, FX = 2.5;
  for (const sx of [-1, 1]) {
    for (let q = 0; q <= 9; q++) {
      const f = q / 9;
      b(X + sx * (0.25 + (FX - 0.25) * f), HUB - 0.2 + (0.45 - HUB + 0.2) * f, apZ + (ftZ - apZ) * f, 0.36, 1.0, 0.36, LEGC, "solid", 0);
    }
    b(X + sx * FX, 0.2, ftZ, 0.9, 0.4, 0.9, "#A39E94", "solid", 0.03);
  }
  b(X, HUB * 0.45, apZ + (ftZ - apZ) * 0.55, 2 * (0.25 + (FX - 0.25) * 0.55), 0.22, 0.22, LEGC, "solid", 0);
  // biniş iskelesi (nehir yanında, en alttaki kabinin altında)
  b(X, 0.5, Z + 0.2, 3.4, 1.0, 1.4, "#9AA3AD", "solid", 0.02);
  return out;
}
const carkFar = (c: LandmarkCtx): Block[] => [
  { p: [c.cx, CARK_HUB, c.cz], s: [2 * CARK_R + 0.8, 0.5, 1.0], c: L.white, g: "solid", j: 0 },
  { p: [c.cx, CARK_HUB, c.cz], s: [0.5, 2 * CARK_R + 0.8, 1.0], c: L.white, g: "solid", j: 0 },
  { p: [c.cx, CARK_HUB, c.cz], s: [9.6, 9.6, 0.3], c: "#D5DAE0", g: "solid", j: 0 },
  { p: [c.cx, CARK_HUB / 2, c.cz - 2.8], s: [4.6, CARK_HUB, 0.4], c: "#DCE1E6", g: "solid", j: 0 },
];

export const WESTMINSTER_LANDMARKS: Record<string, LandmarkModel> = {
  saat_kulesi: { near: saatKulesi, far: saatFar, ip_risk: 0, culture_risk: 0,
    note: "Saat kulesi: altın kumtaşı Gotik gövde, dört yüzde rakamsız kadran (dört ana işaret), çan katı, köşe pinaklleri ve kademeli sivri külah; gerçek orana yakın (≈ 1 : 7,5). İçeride INTERIOR-VIEW saat kulesi tarifi (saat mekanizması, çan katı). Arma ve yazı yok." },
  parlamento: { near: parlamento, far: parlamentoFar, ip_risk: 0, culture_risk: 0,
    note: "Nehir kıyısı Gotik meclis binası: payandalar, köşkler, orta fener kulesi ve doğu ucunda büyük kare kule. Bayrak direği, bayrak, kraliyet arması ve yazı yok." },
  cark: { near: cark, far: carkFar, ip_risk: 1, culture_risk: 0,
    note: "Gözlem çarkı (gerçek konsol çarktan esinli): sürekli beyaz jant, gergin tel kollar, jantın dışında 32 köşeli cam kabin (oval kapsül değil), tek yandan A ayak; işletme renk düzeni, marka, ad ve gece ışık gösterisi yok (IP 1: tanınır siluet)." },
};

// ------------------------------------------------------------------------------------------ semt süsleri
// semt güneye 16 karo büyüdü (çark meydanı); eski süslerin yerel karoları +SOUTH (şehir karosu aynı)
const SOUTH = 16;
function westminsterDecor(c0: DecorCtx): Block[] {
  const c: DecorCtx = { ox: c0.ox, oz: c0.oz + SOUTH };
  const out: Block[] = [], b = sink(out), p = at(c);
  const ST = "#A39E94", GREEN = "#3F6B4E";
  // rıhtım korkulukları (köprü ağzı açık)
  for (const [a, e] of [[0, 8], [11, 48]] as const) {
    b(c.ox + (a + e) / 2, 0.35, c.oz + 11.94, e - a, 0.7, 0.12, ST, "solid", 0.03);
    b(c.ox + (a + e) / 2, 0.35, c.oz + 24.06, e - a, 0.7, 0.12, ST, "solid", 0.03);
  }
  // köprü: yeşil korkuluk, fenerler, su içinde kemer ayakları
  for (const s of [0.06, 2.94]) b(c.ox + 8 + s, 0.4, c.oz + 18, 0.1, 0.8, 13, GREEN, "solid", 0);
  for (const lj of [13, 17, 21]) b(c.ox + 9.5, -0.45, c.oz + lj, 3.2, 0.5, 0.9, "#8E8A80", "solid", 0.04);
  for (const lj of [14, 22]) for (const s of [0.1, 2.9]) lamp(b, c.ox + 8 + s, c.oz + lj, 2.2);
  // rıhtım fenerleri ve kuzey yakada çınarlar
  for (const li of [16, 28, 40]) lamp(b, p.x(li), c.oz + 11.6);
  for (const li of [32, 44]) lamp(b, p.x(li), c.oz + 24.4);
  for (let li = 2; li <= 6; li += 4) tree(b, p.x(li), p.z(30), 0.9);
  // kıyı bahçesinde şezlonglar; meclis yanında bilgi köşkü
  for (const [li, lj, col] of [[14, 4, "#2E6B4F"], [17, 6, "#C9962E"], [20, 3, "#1F3A5F"]] as const) deckchair(b, p.x(li), p.z(lj), col);
  infoKiosk(b, p.x(6), p.z(33));
  // nehirde demirli gezi teknesi (iskele önü)
  b(p.x(40), -0.15, c.oz + 13.2, 5, 0.4, 1.3, "#F2F2EE", "solid", 0.02);
  b(p.x(40), 0.35, c.oz + 13.2, 3.6, 0.6, 1.0, "#BFD9E6", "glass", 0);
  // gizli köşeler: kıyı köşesinde martı; kuzeydoğu arka sokağında şemsiye askısı
  b(p.x(2) + 0.2, 0.12, p.z(2), 0.24, 0.14, 0.12, "#F5F5F4", "solid", 0);
  b(p.x(46) + 0.3, 0.6, p.z(44), 0.06, 1.2, 0.06, L.iron, "solid", 0); b(p.x(46) + 0.3, 1.0, p.z(44), 0.5, 0.06, 0.06, "#1F3A5F", "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ çark meydanı (yeni, lj 0–15)
/** Meydanın ortasındaki sığ süs havuzu (katı; semt yerel) — fıskiye sırası ve taş kenar. */
const POOL: [number, number, number, number] = [28, 6, 10, 3];

function wheelSquareDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  const ST = "#A39E94";
  // havuz: taş kenar, su, fıskiye sırası (ince; gece hafif ışıklı ağızlar)
  const [q0, r0, qw, qd] = POOL, X = c.ox + q0 + qw / 2, Z = c.oz + r0 + qd / 2;
  b(X, 0.15, Z, qw, 0.3, qd, ST, "solid", 0.02);
  b(X, 0.32, Z, qw - 0.4, 0.06, qd - 0.4, "#5E9DB8", "water", 0);
  for (let k = 0; k < 5; k++) {
    b(c.ox + q0 + 1 + k * 2, 0.75, Z, 0.12, 0.8, 0.12, "#DCEBF4", "solid", 0);
    b(c.ox + q0 + 1 + k * 2, 0.36, Z, 0.3, 0.06, 0.3, "#CFE8F5", "glow", 0);
  }
  // çarka bakan bank sırası, fenerler ve ağaç dizisi (meydanın iki yanı)
  for (let li = 22; li <= 44; li += 4) walkBenchAt(b, p.x(li), p.z(12), "+z", 1.4, "#2E4A3A", L.iron);
  for (const li of [20, 30, 40]) lamp(b, p.x(li), p.z(14));
  for (const lj of [3, 7, 11]) { tree(b, p.x(20), p.z(lj), 0.95); tree(b, p.x(46), p.z(lj), 0.9); }
  // bilet köşkü ve dondurma arabası (yazısız)
  infoKiosk(b, p.x(24), p.z(4));
  b(p.x(42), 0.45, p.z(4), 1.2, 0.7, 0.7, "#F2E3C6", "solid", 0.02);
  b(p.x(42), 1.15, p.z(4), 1.5, 0.08, 1.0, "#C8553D", "solid", 0.02);
  for (const s of [-0.4, 0.4]) b(p.x(42) + s, 0.1, p.z(4) + 0.4, 0.2, 0.2, 0.06, L.iron, "solid", 0);
  b(p.x(42) - 0.55, 0.95, p.z(4) - 0.2, 0.05, 0.38, 0.05, L.iron, "solid", 0); // tente direği (araba gövdesinden tenteye)
  b(p.x(42) + 0.55, 0.95, p.z(4) - 0.2, 0.05, 0.38, 0.05, L.iron, "solid", 0);
  // batıdaki kıyı bahçesinde şezlonglar
  for (const [li, lj, col] of [[6, 6, "#2E6B4F"], [10, 9, "#C9962E"], [13, 5, "#1F3A5F"]] as const) deckchair(b, p.x(li), p.z(lj), col);
  // CORE-WALK: balık-patates dükkânı (ritüel `balik_patates`; eski rıhtım bankının yerine) — iskelenin doğusunda kıyı yolunda,
  // tezgâh li 39–41 lj 25 (arkası nehre), sipariş karosu (40, 24), pub bankı + masa lj 23. Engelli karolar `solid`'de (VENUE_SOLID).
  out.push(...venueBlocks(p.x(40), p.z(25)));
  return out;
}

/**
 * Westminster (48 × 64; şehir karosu [−48, −16]). çark meydanı (yeni, lj 0–15): çarkın güneyinde geniş meydan, süs havuzu ve
 * fıskiyeler, banklar, bilet köşkü; batıda kıyı bahçesinin devamı. Güney yaka lj 16–27 (varış meydanının batı kenarına bağlı; kıyı
 * bahçesi, çark [26, 20], nehir iskelesi [36, 26]); Thames lj 28–39 (köprü li 8–10; ortası seyir noktası [9, 34]); kuzey yaka: saat
 * kulesi [10, 42] (kapı [11, 45]), meclis [14, 41], meclis bahçesi; metro (li 20, kuzey kenar) ve otobüs (lj 52, li 36). Yalnız
 * süs: yeni landmark/kimlik yok (Westminster toplamı 9 korunur).
*/
const S = (r: [number, number, number, number]): [number, number, number, number] => [r[0], r[1] + SOUTH, r[2], r[3]];
export const WESTMINSTER_DESIGN: DistrictDesign = {
  water: [S([0, 12, 48, 12])],
  pave: [S([8, 11, 3, 14])],
  plaza: [S([0, 10, 48, 2]), S([0, 24, 48, 1]), [20, 1, 27, 15]],
  park: [S([12, 1, 12, 8]), S([32, 31, 12, 4]), [2, 2, 16, 13]],
  solid: [POOL, ...VENUE_SOLID, [30, 17, 1, 1], [35, 17, 1, 1]], // CITY-PASS-LON: çark A çerçeve kaideleri
  hidden: [[2, 2 + SOUTH], [46, 44 + SOUTH]],
  decor: (c) => [...westminsterDecor(c), ...wheelSquareDecor(c)],
};
