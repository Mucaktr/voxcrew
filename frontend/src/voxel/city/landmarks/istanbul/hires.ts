/**
 * LANDMARK-HIRES (I2) — İstanbul simgelerinin yüksek çözünürlük (yakın) kademesi: Ayasofya, Süleymaniye, Sultanahmet, Ortaköy ve
 * Galata Kulesi (şehir haritası) + taban sahnede Ayasofya, Sultanahmet ve Galata. Kaynak ve puanlar
 *; motor ve kurallar.
 *
 * Orta kademe (bugünkü model: `tarihi.ts`, `beyoglu.ts`, `bogaz.ts`, `scenes/istanbul.ts`) veri katmanında kalır; bu dosya yalnız
 * yakın ayrıntıyı üretir: kaburgalı kubbeler ve pencereli kasnaklar, yarım kubbe çağlayanı ve eksedralar, payandalar, şerefe
 * sayısı doğru kalem minareler (mukarnas konsol, korkuluk, ince kurşun külah), revaklı avlu ve kubbecikler, şadırvan, mihrap
 * çıkıntısı, taş bantlar; Galata'da karışık moloz + tuğla kuşaklı gövde, konsollu galeri, kemerli üst kat ve konik külah.
 * Yazı, hat, figür, bayrak ve dinî simge yok (alem yok; tepe yalnız düz kurşun uç); camilerde yalnız mimari dış görünüm.
 *
 * Taban sahne: harita kurucuları sahte bir ayak izinde kurulur ve sahne bölgesine dönüştürülür (`toScene`: yatay `s`, düşey
 * `sy` ölçek; sahnede +z güney, haritada +z kuzey → ayna). İçe aktarma kuralı: yalnız hires/kit, hires/types, citymap/design,
 * stil sabitleri (döngü yok).
*/
import type { Block } from "../../../scenes";
import { sink, type LandmarkCtx, type Sink } from "../../../citymap/design";
import { arcade, band, corbels, cone, disc, discEdge, hiMinaret, ribbedDome, sadirvan, semiDome, halfDisc, windowDrum, windows, around } from "../../../hires/kit";
import { HIRES_MIN_EDGE, type HiResBuild, type HiResMapEntry, type HiResSceneEntry } from "../../../hires/types";
import { ISTANBUL_LANDMARKS as L } from "../../styles/istanbul";

const OPEN = L.opening, LIT = "#6B4423", FLOOR = "#D9CDB8";

// ------------------------------------------------------------------------------------------ ortak
/** Kemerli pencere halkalı yarım kasnak (yarım kubbe tabanı): koyu ışıklı yarım halka + `n` taş payanda. Üst yüz y + h. */
function halfDrum(b: Sink, x: number, y: number, z: number, r: number, h: number, dx: number, dz: number, n: number, stone: string) {
  halfDisc(b, x, y + h / 2, z, r - 0.05, h, dx, dz, LIT, 3, "glow", 0);
  for (let q = 0; q <= n; q++) {
    const a = (q / n) * Math.PI - Math.PI / 2, al = Math.cos(a) * (r - 0.08), ac = Math.sin(a) * (r - 0.08);
    b(x + dx * al + dz * ac, y + h / 2, z + dz * al + dx * ac, 0.16, h, 0.16, stone, "solid", 0.02);
  }
}
/** Küçük ağırlık kulesi / fener: çokgen gövde, bant, pencereli fener, kaburgalı kubbecik ve düz uç. Taban y0, gövde boyu h. */
function turret(b: Sink, x: number, z: number, y0: number, h: number, r: number, stone: string, lead: string) {
  disc(b, x, y0 + h / 2, z, r, h, stone, 3);
  disc(b, x, y0 + h + 0.03, z, r * 1.12, 0.06, stone, 2, "solid", 0.02);
  disc(b, x, y0 + h + 0.2, z, r * 0.78, 0.28, LIT, 2, "glow", 0);
  for (const [px, pz] of around(6, r * 0.8, 0)) b(x + px, y0 + h + 0.2, z + pz, 0.06, 0.28, 0.06, stone, "solid", 0.01);
  disc(b, x, y0 + h + 0.37, z, r * 0.9, 0.06, stone, 2, "solid", 0.02);
  ribbedDome(b, x, y0 + h + 0.4, z, r * 0.82, r * 0.75, lead, { steps: 3, k: 2, tip: 0.1 });
}

// ------------------------------------------------------------------------------------------ Ayasofya (14 × 10)
/** istanbul.md §1: E–W eksen, batıda iki katlı narteks; 40 pencereli kasnak + 40 kaburgalı basık kubbe; doğu/batı büyük yarım
 *  kubbeler (taban pencereleri) + dört eksedra; doğuda apsis; kuzey/güney timpan pencereleri; dört büyük payanda kulesi + uçan
 *  kemerler + Osmanlı payandaları; dört FARKLI minare (batı çifti kalın iki şerefe, KD ince bir şerefe, GD kırmızı tuğla). */
function ayasofyaHi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, x0 = c.x0, W1 = L.hsWall, W2 = L.hsWall2, LEAD = L.hsLead, LEAD2 = L.hsLead2;
  b(X + 0.4, 0.06, Z, 12.6, 0.12, 8.8, FLOOR, "solid", 0.02);
  // gövde (yan nefler + galeriler): kaide bandı, galeri silmesi, saçak; iki kademeli kurşun yan çatı
  b(X + 0.5, 2.56, Z, 10.0, 4.88, 7.8, W1);
  band(b, X + 0.5, 0.26, Z, 10.0, 7.8, W2, 0.28);
  band(b, X + 0.5, 2.3, Z, 10.0, 7.8, W2);
  band(b, X + 0.5, 4.94, Z, 10.0, 7.8, W2, 0.12);
  b(X + 0.5, 5.08, Z, 10.2, 0.16, 8.0, LEAD2, "solid", 0.02);
  b(X + 0.5, 5.22, Z, 9.2, 0.12, 6.6, LEAD2, "solid", 0.02);
  // kuzey/güney cephe: alt sıra ve galeri sırası kemerli pencereler (galeri katında kafesli)
  for (const sz of [-1, 1] as const) {
    windows(b, "x", Z + sz * 3.9, sz, X - 4.2, X + 5.2, 1.3, 10, 0.36, 0.8, OPEN, W2);
    windows(b, "x", Z + sz * 3.9, sz, X - 4.2, X + 5.2, 3.3, 10, 0.42, 1.0, OPEN, W2, true);
  }
  // doğu cephe (apsis iki yanı)
  for (const [a0, a1] of [[Z - 3.6, Z - 1.6], [Z + 1.6, Z + 3.6]] as const) for (const y of [1.3, 3.3]) windows(b, "z", X + 5.5, 1, a0, a1, y, 2, 0.4, 0.9, OPEN, W2);
  // batı: iç narteks (iki kat) + dış narteks (pilastrlar, beş kapı), kurşun çatılar, üst kat pencere dizisi
  b(x0 + 2.4, 2.1, Z, 1.4, 4.2, 7.4, W2);
  band(b, x0 + 2.4, 2.9, Z, 1.4, 7.4, W1);
  b(x0 + 2.4, 4.28, Z, 1.6, 0.16, 7.6, LEAD2, "solid", 0.02);
  b(x0 + 1.35, 1.3, Z, 0.7, 2.6, 6.2, W2);
  b(x0 + 1.35, 2.68, Z, 0.84, 0.16, 6.4, LEAD2, "solid", 0.02);
  for (let q = 0; q < 9; q++) b(x0 + 0.96, 1.2, Z - 3.0 + q * 0.75, 0.12, 2.4, 0.18, W1, "solid", 0.02);
  windows(b, "z", x0 + 1.0, -1, Z - 1.9, Z + 1.9, 1.0, 5, 0.4, 1.3, OPEN, W1);
  windows(b, "z", x0 + 1.7, -1, Z - 3.3, Z + 3.3, 3.45, 9, 0.28, 0.7, OPEN, W1);
  // merkez kare kütle: timpan duvarlarında iki sıra pencere (gece ışık), saçak, köşe pandantif kademeleri
  b(X, 6.9, Z, 6.2, 3.6, 6.2, W1);
  for (const sz of [-1, 1] as const) {
    windows(b, "x", Z + sz * 3.1, sz, X - 2.4, X + 2.4, 6.15, 7, 0.32, 0.75, LIT, W2, false, "glow");
    windows(b, "x", Z + sz * 3.1, sz, X - 1.6, X + 1.6, 7.6, 5, 0.38, 0.75, LIT, W2, false, "glow");
  }
  b(X, 8.75, Z, 6.5, 0.14, 6.5, LEAD2, "solid", 0.02);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b(X + sx * 2.75, 8.95, Z + sz * 2.75, 0.7, 0.26, 0.7, W2, "solid", 0.02);
  // dört büyük payanda kulesi (kademeli tepe, kurşun başlık, bantlar) + uçan kemer; Osmanlı payandaları (kuzey/güney + doğu)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = X + sx * 2.5, pz = Z + sz * 4.4;
    b(px, 3.9, pz, 1.2, 7.8, 1.0, W2);
    for (const y of [2.3, 4.9]) band(b, px, y, pz, 1.2, 1.0, W1);
    b(px, 8.1, pz - sz * 0.1, 0.9, 0.6, 0.7, W2);
    b(px, 8.45, pz - sz * 0.1, 1.0, 0.1, 0.8, LEAD, "solid", 0.02);
    b(px, 7.55, Z + sz * 3.5, 0.7, 0.5, 0.9, W2);                     // uçan kemer
    b(px, 7.12, Z + sz * 3.62, 0.5, 0.36, 0.66, W2);                   // kemer karnı (kademe)
  }
  for (const sz of [-1, 1]) for (const dx of [-4.6, -1.0, 1.0, 4.7]) {
    b(X + dx, 1.9, Z + sz * 4.04, 0.46, 3.8, 0.28, W2, "solid", 0.02);
    b(X + dx, 4.3, Z + sz * 3.98, 0.36, 1.0, 0.16, W2, "solid", 0.02);
  }
  for (const dz of [-3.3, 3.3]) { b(X + 5.62, 2.2, Z + dz, 0.24, 4.4, 0.5, W2, "solid", 0.02); b(X + 5.58, 4.6, Z + dz, 0.16, 0.4, 0.4, W2, "solid", 0.02); }
  // 40 pencereli kasnak + 40 kaburgalı basık ana kubbe
  windowDrum(b, X, 8.82, Z, 2.9, 0.66, 40, W1);
  ribbedDome(b, X, 9.56, Z, 2.95, 1.82, LEAD, { steps: 6, ribs: 40, ribColor: LEAD2, tip: 0.1 });
  // doğu ve batı büyük yarım kubbeleri: taşıyıcı kütle, pencereli yarım kasnak, kaburgalı yarım kubbe; eksedralar; doğu apsisi
  for (const sx of [-1, 1]) {
    b(X + sx * 4.3, 6.0, Z, 2.4, 1.84, 5.6, W1);
    halfDrum(b, X + sx * 3.1, 6.92, Z, 2.8, 0.24, sx, 0, 7, W1);
    semiDome(b, X + sx * 3.1, 7.16, Z, 2.85, 1.8, sx, 0, LEAD, { steps: 5, ribs: 9, ribColor: LEAD2 });
    for (const sz of [-1, 1]) {
      b(X + sx * 5.1, 5.55, Z + sz * 1.9, 1.2, 0.95, 1.8, W1);
      semiDome(b, X + sx * 4.5, 6.03, Z + sz * 1.9, 1.05, 0.9, sx, 0, LEAD2, { steps: 3, k: 2 });
    }
  }
  b(X + 5.9, 2.6, Z, 1.2, 5.2, 2.8, W2);
  windows(b, "z", X + 6.5, 1, Z - 1.0, Z + 1.0, 2.0, 3, 0.36, 1.0, OPEN, W1);
  windows(b, "z", X + 6.5, 1, Z - 1.0, Z + 1.0, 3.9, 3, 0.3, 0.7, OPEN, W1, true);
  semiDome(b, X + 5.3, 5.2, Z, 1.3, 0.9, 1, 0, LEAD2, { steps: 3, k: 2 });
  // dört farklı minare
  const zs = c.z0 + 0.75, zn = c.z0 + c.d - 0.75, xe = x0 + c.w - 0.75, xw = x0 + 0.75;
  for (const z of [zs, zn]) hiMinaret(b, xw, z, 0, 10.4, 2, { shaft: 0.6, c: L.hsMinaret, cap: LEAD });
  hiMinaret(b, xe, zn, 0, 10.0, 1, { shaft: 0.44, c: L.hsMinaret, cap: LEAD });
  hiMinaret(b, xe, zs, 0, 9.6, 1, { shaft: 0.56, c: "#A9573F", cap: LEAD, rail: "#C9B9A6" });
  return out;
}

// ------------------------------------------------------------------------------------------ Süleymaniye (9 × 13)
/** istanbul.md §10: güneyde kare harim (ana kubbe 32 pencereli kasnakta, kıble ekseninde pencere tabanlı iki yarım kubbe, dört
 *  ağırlık kulesi, yan cephelerde iki katlı revaklı galeriler + payandalar, yan nef kubbecikleri büyük-küçük), güney mihrap
 *  çıkıntısı; kuzeyde avlu (üç yanda revak + harim önünde son cemaat revakı, taç kapı, dikdörtgen şadırvan). Dört minare,
 *  10 şerefe: harim-avlu köşelerinde iki yüksek (3), avlunun kuzey köşelerinde iki alçak (2). */
const SUL = "#DCD3C2", SUL2 = "#C9BFAC";
function suleymaniyeHi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w } = c, X = c.cx, Zh = z0 + 4.0, LEAD = L.hsLead, LEAD2 = L.hsLead2, hw = w / 2 - 0.5;
  b(X, 0.06, z0 + 6.5, w - 0.2, 0.12, 12.8, FLOOR, "solid", 0.02);
  // harim kütlesi + bantlar + kurşun çatı
  b(X, 2.56, Zh, 2 * hw, 4.88, 7.8, SUL);
  band(b, X, 0.26, Zh, 2 * hw, 7.8, SUL2, 0.28);
  band(b, X, 2.4, Zh, 2 * hw, 7.8, SUL2);
  band(b, X, 4.94, Zh, 2 * hw, 7.8, SUL2, 0.12);
  b(X, 5.08, Zh, 2 * hw + 0.2, 0.16, 8.0, LEAD2, "solid", 0.02);
  // yan cepheler: iki katlı revaklı galeri + payandalar; galerilerin üstünde pencere sırası
  for (const sx of [-1, 1] as const) {
    arcade(b, "z", Zh - 3.6, Zh + 3.6, X + sx * hw, 0.12, 2.1, 5, { col: SUL2, stone: SUL, lead: LEAD2, depth: 0.32, domes: false, inward: sx });
    arcade(b, "z", Zh - 3.6, Zh + 3.6, X + sx * hw, 2.32, 1.7, 5, { col: SUL2, stone: SUL, lead: LEAD2, depth: 0.32, domes: false, inward: sx });
    for (const dz of [-3.6, -0.72 * 2, 0.72 * 2, 3.6]) b(X + sx * (hw + 0.25), 2.6, Zh + dz, 0.5, 5.2, 0.34, SUL2, "solid", 0.02);
    windows(b, "z", X + sx * hw, sx, Zh - 3.0, Zh + 3.0, 4.45, 6, 0.3, 0.6, OPEN, SUL2);
    // yan nef kubbecikleri: büyük-küçük dizisi
    [-2.7, -1.35, 0, 1.35, 2.7].forEach((dz, q) => {
      const r = q % 2 ? 0.42 : 0.62;
      disc(b, X + sx * (hw - 0.8), 5.24, Zh + dz, r * 1.05, 0.16, SUL, 2);
      ribbedDome(b, X + sx * (hw - 0.8), 5.32, Zh + dz, r, r * 0.8, LEAD, { steps: 3, k: 2 });
    });
  }
  // güney (kıble) cephesi: üç sıra pencere, ortada çokgen mihrap çıkıntısı (yarım kubbe başlıklı)
  windows(b, "x", z0 + 0.1, -1, X - hw + 0.3, X + hw - 0.3, 1.2, 8, 0.32, 0.8, OPEN, SUL2, true);
  windows(b, "x", z0 + 0.1, -1, X - hw + 0.3, X + hw - 0.3, 3.0, 8, 0.32, 0.9, OPEN, SUL2);
  b(X, 2.2, z0 + 0.04, 1.6, 4.0, 0.2, SUL2);
  for (const dx of [-0.56, 0, 0.56]) b(X + dx, 2.0, z0 - 0.03, 0.3, 1.0, 0.04, OPEN, "solid", 0);
  semiDome(b, X, 4.2, z0 + 0.62, 0.56, 0.45, 0, -1, LEAD, { steps: 3, k: 2 });
  // merkez kütle: doğu/batı timpan pencereleri (gece ışık), saçak
  b(X, 6.3, Zh, 4.8, 2.6, 4.8, SUL);
  for (const sx of [-1, 1] as const) {
    windows(b, "z", X + sx * 2.4, sx, Zh - 1.8, Zh + 1.8, 5.75, 5, 0.3, 0.7, LIT, SUL2, false, "glow");
    windows(b, "z", X + sx * 2.4, sx, Zh - 1.1, Zh + 1.1, 6.9, 3, 0.38, 0.8, LIT, SUL2, false, "glow");
  }
  band(b, X, 7.56, Zh, 4.8, 4.8, SUL2);
  // dört ağırlık kulesi (fenerli, kubbecikli)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) turret(b, X + sx * 2.3, Zh + sz * 2.3, 5.0, 3.0, 0.48, SUL2, LEAD);
  // kıble ekseninde iki yarım kubbe (pencereli yarım kasnak) + kasnak (32 pencere) + kaburgalı ana kubbe
  for (const sz of [-1, 1]) {
    halfDrum(b, X, 5.16, Zh + sz * 2.25, 2.15, 0.26, 0, sz, 7, SUL);
    semiDome(b, X, 5.42, Zh + sz * 2.25, 2.2, 2.05, 0, sz, LEAD, { steps: 5, ribs: 9, ribColor: LEAD2 });
  }
  windowDrum(b, X, 7.6, Zh, 2.3, 0.62, 32, SUL);
  ribbedDome(b, X, 8.3, Zh, 2.3, 2.2, LEAD, { steps: 7, ribs: 32, ribColor: LEAD2, tip: 0.12 });
  // avlu: döşeme, üç yanda revak (kubbecikli), harim önünde son cemaat revakı (büyük kubbeler), taç kapı, şadırvan
  const ax0 = x0 + 0.3, ax1 = x0 + w - 0.3, az0 = z0 + 8.1, az1 = z0 + 12.7, Zc = (az0 + az1) / 2;
  b(X, 0.15, Zc, ax1 - ax0, 0.06, az1 - az0, "#E4DCCB", "solid", 0.02);
  arcade(b, "z", az0 + 0.5, az1 - 0.6, ax0 + 0.15, 0.18, 1.7, 3, { col: SUL2, stone: SUL, lead: LEAD, depth: 0.7, inward: 1 });
  arcade(b, "z", az0 + 0.5, az1 - 0.6, ax1 - 0.15, 0.18, 1.7, 3, { col: SUL2, stone: SUL, lead: LEAD, depth: 0.7, inward: -1 });
  // LANDMARK-WALK: kuzey revak sığ (0,45): taç kapıdan girilen avlu geçidi revak sütunlarına takılmaz (walk/landmarkGates.ts kapı 4,12)
  arcade(b, "x", ax0 + 0.6, X - 1.0, az1 - 0.15, 0.18, 1.7, 3, { col: SUL2, stone: SUL, lead: LEAD, depth: 0.45, inward: -1 });
  arcade(b, "x", X + 1.0, ax1 - 0.6, az1 - 0.15, 0.18, 1.7, 3, { col: SUL2, stone: SUL, lead: LEAD, depth: 0.45, inward: -1 });
  arcade(b, "x", ax0 + 0.7, ax1 - 0.7, z0 + 7.95, 0.18, 2.3, 5, { col: SUL2, stone: SUL, lead: LEAD, depth: 0.8, inward: 1 });
  // taç kapı: yüksek taş kütle, mukarnas kavsara (kademeli), kapı açıklığı, kubbecik
  b(X, 1.75, az1 - 0.35, 2.0, 3.5, 0.7, SUL2);
  for (let q = 0; q < 3; q++) b(X, 2.05 + q * 0.28, az1 - 0.72 + q * 0.06, 1.2 - q * 0.3, 0.28, 0.06, SUL, "solid", 0.02);
  b(X, 0.95, az1 - 0.72, 0.8, 1.7, 0.04, OPEN, "solid", 0);
  disc(b, X, 3.56, az1 - 0.35, 0.5, 0.12, SUL, 2);
  ribbedDome(b, X, 3.62, az1 - 0.35, 0.48, 0.4, LEAD, { steps: 3, k: 2 });
  // dikdörtgen şadırvan: taş tekne, su, dikmeler, kurşun çatı
  b(X, 0.35, Zc, 1.4, 0.4, 0.9, SUL2);
  b(X, 0.57, Zc, 1.2, 0.04, 0.7, "#6FA9C4", "solid", 0);
  for (const [dx, dz] of [[-0.66, -0.4], [0.66, -0.4], [-0.66, 0.4], [0.66, 0.4]]) b(X + dx, 1.05, Zc + dz, 0.08, 1.0, 0.08, SUL2, "solid", 0.01);
  b(X, 1.6, Zc, 1.6, 0.1, 1.1, LEAD2, "solid", 0.02);
  b(X, 1.72, Zc, 1.1, 0.14, 0.7, LEAD, "solid", 0.02);
  // dört minare, 10 şerefe
  for (const x of [x0 + 0.45, x0 + w - 0.45]) {
    hiMinaret(b, x, az0, 0, 12.1, 3, { shaft: 0.46, c: L.hsMinaret, cap: LEAD, posts: 4 });
    hiMinaret(b, x, az1 - 0.25, 0, 10.6, 2, { shaft: 0.42, c: L.hsMinaret, cap: LEAD, posts: 4 });
  }
  return out;
}

// ------------------------------------------------------------------------------------------ Sultanahmet (10 × 12 + batı avlusu)
/** istanbul.md §2: kare harim (iki sıra pencere, üst sıra gece ışık), kıble (doğu) cephesinde mihrap çıkıntısı; çağlayan: dört
 *  köşe kubbesi, dört yarım kubbe (her biri iki eksedra), dört sekizgen ağırlık kulesi (fenerli), 28 pencereli kasnak, ana kubbe;
 *  altı minare (harim köşelerinde dört × 3 şerefe, avlu köşelerinde iki × 2 şerefe; yivli gövde); batı avlusu: üç yanda kubbeli
 *  revak, harim önünde son cemaat revakı, taç kapı (yürünür açıklık korunur), sekizgen şadırvan. */
const COURT_W = 6;
function sultanahmetHi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, S1 = L.bmStone, S2 = L.bmStone2, DOME = L.bmDome;
  // harim + bantlar + saçak + pandantif kütle
  b(X, 1.5, Z, 9, 3.0, 11, S1);
  band(b, X, 0.14, Z, 9, 11, S2, 0.28);
  band(b, X, 1.62, Z, 9, 11, S2);
  b(X, 3.07, Z, 9.1, 0.14, 11.1, S2, "solid", 0.02);
  b(X, 3.57, Z, 6.6, 0.86, 6.6, S2);
  // pencereler: kuzey/güney ve doğu/batı yüzlerde iki sıra (alt kafesli, üst ışıklı)
  for (const sz of [-1, 1] as const) {
    windows(b, "x", Z + sz * 5.5, sz, X - 3.6, X + 3.6, 0.85, 6, 0.4, 0.8, OPEN, S2, true);
    windows(b, "x", Z + sz * 5.5, sz, X - 3.6, X + 3.6, 2.3, 6, 0.36, 0.7, LIT, S2, false, "glow");
  }
  for (const [a0, a1] of [[Z - 4.6, Z - 1.0], [Z + 1.0, Z + 4.6]] as const) {
    windows(b, "z", X + 4.5, 1, a0, a1, 0.85, 3, 0.4, 0.8, OPEN, S2, true);
    windows(b, "z", X + 4.5, 1, a0, a1, 2.3, 3, 0.36, 0.7, LIT, S2, false, "glow");
  }
  // kıble cephesi: mihrap çıkıntısı + yarım kubbe başlık
  b(X + 4.62, 1.45, Z, 0.24, 2.9, 1.5, S2);
  semiDome(b, X + 4.3, 3.14, Z, 0.62, 0.5, 1, 0, DOME, { steps: 3, k: 2 });
  // batı yüz: taç kapı (harim) + son cemaat revakı (ayak izinin batı şeridinde)
  b(X - 4.62, 1.9, Z, 0.24, 3.8, 1.7, S2);
  for (let q = 0; q < 3; q++) b(X - 4.78, 2.4 + q * 0.3, Z, 0.08, 0.3, 1.2 - q * 0.3, S1, "solid", 0.02);
  b(X - 4.76, 1.0, Z, 0.04, 1.6, 0.7, OPEN, "solid", 0);
  arcade(b, "z", c.z0 + 1.2, c.z0 + c.d - 1.2, X - 4.5, 0, 1.8, 5, { col: S2, stone: S1, lead: DOME, depth: 0.36, inward: -1 });
  // çağlayan: köşe kubbeleri, yarım kubbeler + eksedralar, ağırlık kuleleri
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ribbedDome(b, X + sx * 3.3, 3.14, Z + sz * 4.2, 0.9, 0.7, DOME, { steps: 4 });
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) semiDome(b, X + dx * 2.0, 4.0, Z + dz * 2.0, 2.1, 1.3, dx, dz, DOME, { steps: 5 });
  for (const s of [-1, 1]) for (const o of [-1, 1]) {
    semiDome(b, X + s * 3.3, 3.14, Z + o * 1.75, 0.75, 0.6, s, 0, DOME, { steps: 3, k: 2 });
    semiDome(b, X + o * 1.75, 3.14, Z + s * 3.3, 0.75, 0.6, 0, s, DOME, { steps: 3, k: 2 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) turret(b, X + sx * 2.3, Z + sz * 2.3, 4.0, 1.25, 0.36, S1, DOME);
  // kasnak kaidesi + 28 pencereli kasnak + ana kubbe
  disc(b, X, 4.5, Z, 2.35, 1.0, S1, 3);
  windowDrum(b, X, 5.0, Z, 2.3, 0.66, 28, S1);
  ribbedDome(b, X, 5.74, Z, 2.4, 2.2, DOME, { steps: 6, ribs: 16, tip: 0.12 });
  // dört harim minaresi (3 şerefe, yivli)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx < 0 ? c.x0 + 0.6 : c.x0 + c.w - 0.6, z = sz < 0 ? c.z0 + 0.6 : c.z0 + c.d - 0.6;
    hiMinaret(b, x, z, 0, 11.2, 3, { shaft: 0.48, c: L.bmMinaret, cap: DOME, fluted: true, flutes: 6, posts: 4 });
  }
  // avlu (batı; ayak izinin dışında, izinli bölge): döşeme, revaklar (avlu duvar şeridinde kalır), taç kapı, şadırvan, iki minare
  const ax0 = c.x0 - COURT_W, ax1 = c.x0, az0 = c.z0, az1 = c.z0 + c.d, acx = (ax0 + ax1) / 2, acz = (az0 + az1) / 2;
  b(acx + 0.5, 0.03, acz, COURT_W - 1, 0.06, c.d - 2, "#DAD4C9", "solid", 0.02);
  const AO = { col: S2, stone: S1, lead: DOME, depth: 0.6 };
  arcade(b, "z", az0 + 1.0, acz - 1.0, ax0 + 0.2, 0, 1.5, 2, { ...AO, inward: 1 });
  arcade(b, "z", acz + 1.0, az1 - 1.0, ax0 + 0.2, 0, 1.5, 2, { ...AO, inward: 1 });
  arcade(b, "x", ax0 + 1.0, ax1, az0 + 0.2, 0, 1.5, 4, { ...AO, inward: 1 });
  arcade(b, "x", ax0 + 1.0, ax1, az1 - 0.2, 0, 1.5, 4, { ...AO, inward: -1 });
  // taç kapı: iki yüksek ayak (duvar karolarında), yürüme bandının üstünde mukarnas kavsara + lento + kubbecik
  for (const s of [-1, 1]) b(ax0 + 0.5, 1.5, acz + s * 1.25, 1.0, 3.0, 0.5, S2);
  b(ax0 + 0.5, 2.6, acz, 1.0, 0.8, 2.0, S2);
  for (let q = 0; q < 3; q++) b(ax0 + 0.5, 2.14 - q * 0.12, acz, 0.8 - q * 0.2, 0.12, 1.8 - q * 0.3, S1, "solid", 0.02);
  disc(b, ax0 + 0.5, 3.06, acz, 0.5, 0.12, S1, 2);
  ribbedDome(b, ax0 + 0.5, 3.12, acz, 0.46, 0.4, DOME, { steps: 3, k: 2 });
  sadirvan(b, acx, acz, 0.55, S2, DOME, "#6FA9C4", "solid"); // su yüzü katı renk: katmanda su ağı yok (−1 çizim çağrısı)
  for (const z of [az0 + 0.5, az1 - 0.5]) hiMinaret(b, ax0 + 0.5, z, 0, 11.2, 2, { shaft: 0.46, c: L.bmMinaret, cap: DOME, fluted: true, flutes: 6, posts: 4 });
  return out;
}

// ------------------------------------------------------------------------------------------ Ortaköy (4 × 4)
/** istanbul.md §8: kıyıda kare harim; köşelerde bağlı pilastr ayaklar (başlık + tepe süsü), iki katlı iri kemerli pencereler
 *  (kayıtlı), korniş dişleri, her yüzde korniş üstüne yükselen büyük kemerli timpan; 16 pencereli kasnak + kaburgalı kubbe;
 *  kara yanında iki katlı hünkâr kasrı; iki ince minare (tek şerefe, başlığa benzer konsol). */
const WHITE = "#EEE8DC", TRIM = "#D8CDB6", OLEAD = "#8E98A1", GL = "#7FA9C2";
function ortakoyHi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0 } = c, X = c.cx + 0.25, Z = c.cz;
  b(c.cx, 0.25, Z, 4, 0.5, 4, "#CFC6B4", "solid", 0.03);
  band(b, c.cx, 0.47, Z, 4, 4, "#BDB3A0", 0.06);
  b(X, 2.0, Z, 3.0, 3.0, 3.0, WHITE);
  band(b, X, 0.62, Z, 3.0, 3.0, TRIM, 0.24);
  band(b, X, 2.18, Z, 3.0, 3.0, TRIM, 0.08);
  b(X, 3.58, Z, 3.3, 0.16, 3.3, TRIM, "solid", 0.02);
  corbels(b, X, 3.46, Z, 1.6, 24, 0.08, 0.08, TRIM, 0.5);
  // köşe ayakları: bağlı pilastrlar + başlık + tepe süsü (vazo biçimi; dinî değil)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = X + sx * 1.42, pz = Z + sz * 1.42;
    b(px, 2.2, pz, 0.44, 3.4, 0.44, TRIM);
    b(px + sx * 0.12, 2.2, pz, 0.2, 3.4, 0.5, TRIM, "solid", 0.02);
    b(px, 2.2, pz + sz * 0.12, 0.5, 3.4, 0.2, TRIM, "solid", 0.02);
    b(px, 3.95, pz, 0.6, 0.1, 0.6, TRIM, "solid", 0.02);
    disc(b, px, 4.12, pz, 0.14, 0.24, WHITE, 2);
    disc(b, px, 4.32, pz, 0.2, 0.16, TRIM, 2);
    disc(b, px, 4.46, pz, 0.08, 0.14, OLEAD, 1);
  }
  // iri kemerli pencereler (deniz + iki yan; iki kat, kayıtlı), korniş üstünde büyük kemerli timpanlar
  for (const [dx, dz] of [[1, 0], [0, 1], [0, -1]] as const) {
    const axis = dx ? "z" : "x", face = dx ? X + 1.5 : Z + dz * 1.5, out1 = (dx || dz) as 1 | -1, a0 = (dx ? Z : X) - 1.0, a1 = (dx ? Z : X) + 1.0;
    windows(b, axis, face, out1, a0, a1, 1.45, 2, 0.6, 1.3, GL, TRIM, true);
    windows(b, axis, face, out1, a0, a1, 2.9, 2, 0.46, 0.8, GL, TRIM, true);
    const tx = dx ? X + 1.38 : X, tz = dx ? Z : Z + dz * 1.38;
    const P = (y: number, l: number, h: number, c2: string, g: Block["g"] = "solid") => dx ? b(tx, y, tz, 0.22, h, l, c2, g, 0.02) : b(tx, y, tz, l, h, 0.22, c2, g, 0.02);
    P(3.98, 2.3, 0.64, WHITE); P(4.38, 1.7, 0.16, WHITE); P(4.53, 1.1, 0.14, TRIM);
    const gx = dx ? X + 1.5 : X, gz = dx ? Z : Z + dz * 1.5;
    if (dx) b(gx + 0.0, 4.02, gz, 0.04, 0.5, 1.1, GL, "solid", 0); else b(gx, 4.02, gz, 1.1, 0.5, 0.04, GL, "solid", 0);
  }
  windowDrum(b, X, 3.66, Z, 1.25, 0.62, 16, WHITE);
  ribbedDome(b, X, 4.36, Z, 1.3, 1.26, OLEAD, { steps: 6, ribs: 16, tip: 0.1 });
  // hünkâr kasrı (kara yanı): iki kat pencere, silme, kırma kurşun çatı
  b(x0 + 0.55, 1.4, Z, 1.0, 1.8, 2.2, WHITE);
  band(b, x0 + 0.55, 1.45, Z, 1.0, 2.2, TRIM, 0.06);
  windows(b, "z", x0 + 0.05, -1, Z - 0.9, Z + 0.9, 1.05, 3, 0.26, 0.5, GL, TRIM);
  windows(b, "z", x0 + 0.05, -1, Z - 0.9, Z + 0.9, 1.9, 3, 0.26, 0.5, GL, TRIM);
  b(x0 + 0.55, 2.38, Z, 1.15, 0.16, 2.35, OLEAD, "solid", 0.02);
  b(x0 + 0.55, 2.52, Z, 0.8, 0.12, 1.9, OLEAD, "solid", 0.02);
  for (const z of [z0 + 0.35, z0 + c.d - 0.35]) hiMinaret(b, x0 + 0.35, z, 0.5, 6.15, 1, { shaft: 0.3, c: WHITE, cap: OLEAD, at: [0.82] });
  return out;
}

// ------------------------------------------------------------------------------------------ Galata Kulesi (5 × 5, h 15)
/**
 * (ürün sahibi 2026-11-05 "Galata kulesinin kapı girişi yok, nasıl girecek belli değil"): güney yüzde okunur kemerli taş kapı. Açıklık
 * 1,1 × 1,85 (üstte iki kademe kemer 2,15'e), iki yanda 0,26'lık açık taş söve, üstünde lento + kilit taşı, önünde basamak; açıklık
 * yüzden 0,18 geride (oyuk). `zf`: girdap kuşağının güney yüzü (dış), `y0`: zemin. Sövenin arkası gövdenin içinde (havada yama yok).
 * Ölçüler insan ölçeğinde (kule ölçeğiyle küçültülmez; haritada kapı karosunun önünde, sahnede kule ile birlikte ölçeklenir).
*/
export const GALATA_DOOR = { w: 1.1, h: 1.85, arch: 2.15 } as const;
const DOOR_STONE = "#E4D8BF", DOOR_STONE2 = "#D2C5A8";
function galataPortal(b: Sink, X: number, zf: number, y0: number) {
  const { w, h, arch } = GALATA_DOOR, jw = 0.26, top = y0 + 1.95;
  const dz = zf - 0.02; // açıklık düzlemi (yüzün hemen önü)
  for (const sg of [-1, 1]) b(X + sg * (w / 2 + jw / 2), y0 + (top - y0 + 0.5) / 2, zf + 0.05, jw, top - y0 + 0.5, 0.5, DOOR_STONE, "solid", 0);          // söveler
  b(X, y0 + h / 2, dz, w, h, 0.04, OPEN, "solid", 0);                                                                                                  // açıklık (oyuk)
  b(X, y0 + h + 0.075, dz, 0.8, 0.15, 0.04, OPEN, "solid", 0);                                                                                         // kemer kademeleri
  b(X, y0 + h + 0.225, dz, 0.5, 0.15, 0.04, OPEN, "solid", 0);
  for (const sg of [-1, 1]) {                                                                                                                         // kemer omuzları
    b(X + sg * 0.46, y0 + h + 0.075, zf + 0.05, 0.19, 0.15, 0.5, DOOR_STONE, "solid", 0);
    b(X + sg * 0.34, y0 + h + 0.225, zf + 0.05, 0.19, 0.15, 0.5, DOOR_STONE, "solid", 0);
  }
  b(X, y0 + arch + 0.2, zf + 0.05, w + 2 * jw, 0.4, 0.5, DOOR_STONE, "solid", 0);                                                                       // lento
  b(X, y0 + arch + 0.5, zf - 0.04, 0.3, 0.22, 0.5, DOOR_STONE2, "solid", 0);                                                                          // kilit taşı
  b(X, y0 + 0.04, zf - 0.1, w + 0.5, 0.08, 0.5, DOOR_STONE2, "solid", 0);                                                                              // basamak
}
/** istanbul.md §4: karışık moloz taş (koyu sarı, açık kahve, gri) + tuğla kuşaklı silindir gövde (16 köşe), spiral merdiveni izleyen
 *  kemerli mazgal pencereler, iki sıra konsollu galeri, 16 dikmeli korkuluk, 16 kemerli üst kat (gece ışık), konik kurşun külah,
 *  dört çatı penceresi, yaldız tepe + durağan kırmızı ikaz ışığı. Ölçeklenmemiş kule çerçevesi (taban y 0,6; harita ×0,74). */
const GALATA_K = 0.74, GALATA_Y0 = 0.6, STONES = ["#C8B69A", "#BBAA8D", "#CDBB9F", "#B4A78F"];
function galataTower(b: Sink, X: number, Z: number, door: boolean, frontSlit = !door) {
  const R = 2.15;
  disc(b, X, 1.2, Z, 2.27, 1.2, L.galata2, 4);                          // taban kuşağı (0,6–1,8)
  band(b, X, 1.82, Z, 4.4, 0.4, L.galata2, 0.06);
  // (ürün sahibi "gövdede rastgele koyu yarıklar, kırmızı benekler"): taş kuşaklar düz (tuğla kuşak diski gövdeden yalnız
  // 16-gen köşelerinde 0,02 taşıp kırmızı benek gibi okunuyordu: kaldırıldı); pencereler dört yüzde kat kat aynı hizada (eski spiral dizilim
  // ve gövde içine gömülü çapraz pencereler rastgele yarık gibiydi).
  for (let q = 0; q < 8; q++) {                                         // moloz taş kuşaklar
    const y0 = 1.8 + q * 1.5;
    disc(b, X, y0 + 0.75, Z, R, 1.5, STONES[q % 4], 4, "solid", 0.06);
  }
  // kemerli mazgal pencereler: 7 kat × 4 yüz, kat ortasında, üst üste aynı hizada
  const face = R * Math.cos(Math.PI / 16);
  for (let r = 0; r < 7; r++) for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    if (!frontSlit && r === 0 && dz === -1) continue; // güney yüzde kapı var: kapı üstünde mazgal yok
    const y = 2.55 + r * 1.5;
    b(X + dx * (face + 0.02), y, Z + dz * (face + 0.02), dx ? 0.04 : 0.24, 0.6, dx ? 0.24 : 0.04, OPEN, "solid", 0);
    b(X + dx * (face + 0.02), y + 0.36, Z + dz * (face + 0.02), dx ? 0.04 : 0.14, 0.12, dx ? 0.14 : 0.04, OPEN, "solid", 0);
  }
  if (door) galataPortal(b, X, Z - 2.27, GALATA_Y0);                 // güney (−z) kapısı: kemerli taş kapı
  // galeri: iki sıra konsol, döşeme, 16 dikme + küpeşte
  corbels(b, X, 13.25, Z, R, 16, 0.24, 0.3, L.galata2, 0, "solid", 4);
  corbels(b, X, 13.6, Z, R, 16, 0.32, 0.4, L.galata2, 0, "solid", 4);
  disc(b, X, 13.92, Z, 2.55, 0.24, L.galata2, 4, "solid", 0.02);
  for (const [, , a] of around(32, 1, 0.5)) {
    const e = discEdge(2.55, 4, a) - 0.05;
    b(X + Math.cos(a) * e, 14.25, Z + Math.sin(a) * e, 0.06, 0.42, 0.06, "#3A3F47", "solid", 0);
  }
  for (const [, , a] of around(32, 1, 0.5)) {
    const e = discEdge(2.55, 4, a) - 0.05, tx = Math.abs(Math.sin(a)) > Math.abs(Math.cos(a));
    b(X + Math.cos(a) * e, 14.48, Z + Math.sin(a) * e, tx ? 0.5 : 0.06, 0.06, tx ? 0.06 : 0.5, "#3A3F47", "solid", 0);
  }
  // kemerli üst kat (16 pencere; gece ışık) + saçak + konik külah + çatı pencereleri + tepe
  windowDrum(b, X, 14.04, Z, 1.85, 1.5, 16, L.galataTop);
  disc(b, X, 15.66, Z, 2.05, 0.08, L.galata2, 4, "solid", 0.02);
  cone(b, X, 15.7, Z, 2.0, 3.75, L.galataCap, 16, 4);
  for (const [, , a] of around(16, 1, 0)) {                              // külah dikiş çizgileri (kurşun levha bindirmeleri)
    for (let q = 0; q < 3; q++) {
      const y = 15.95 + q * 0.75, ql = Math.floor((y - 15.7) / (3.75 / 16)), e = discEdge(2.0 * (1 - (ql + 0.3) / 16), 4, a) - 0.03;
      b(X + Math.cos(a) * e, y, Z + Math.sin(a) * e, 0.05, 0.5, 0.05, "#4B5560", "solid", 0);
    }
  }
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    b(X + dx * 1.58, 16.6, Z + dz * 1.58, 0.5, 0.55, 0.5, L.galataCap, "solid", 0.02);
    b(X + dx * 1.58, 16.95, Z + dz * 1.58, 0.36, 0.16, 0.36, L.galataCap, "solid", 0.02);
    b(X + dx * 1.84, 16.55, Z + dz * 1.84, dz ? 0.26 : 0.04, 0.32, dz ? 0.04 : 0.26, "#E9D9A8", "solid", 0);
  }
  b(X, 19.6, Z, 0.12, 0.5, 0.12, L.finial, "solid", 0);
  b(X, 19.93, Z, 0.16, 0.16, 0.16, "#D7263D", "glow", 0);
}
function galataHi(c: LandmarkCtx, mid: readonly Block[]): Block[] {
  const raw: Block[] = [], out: Block[] = [];
  galataTower(sink(raw), c.cx, c.cz, false, false);
  const X = c.cx, Z = c.cz, k = GALATA_K;
  for (const q of raw) out.push({ ...q, p: [X + (q.p[0] - X) * k, GALATA_Y0 + (q.p[1] - GALATA_Y0) * k, Z + (q.p[2] - Z) * k], s: q.s.map((v) => Math.max(HIRES_MIN_EDGE, v * k)) as Block["s"] });
  // kaide (orta modelden) + insan ölçüsünde kapı (küçültülmez; iç mekân girişi aynı yerde)
  for (const q of mid) if (q.p[1] + q.s[1] / 2 <= 0.61) out.push(q);
  const b0 = sink(out);
  galataPortal(b0, X, Z - 2.27 * k, GALATA_Y0);
  return out;
}

// ------------------------------------------------------------------------------------------ taban sahne dönüşümü
export interface SceneXf { src: LandmarkCtx; s: number; sy: number; swap?: boolean; fz?: 1 | -1; uc?: number; y0?: number; dy?: number }
/** Harita çerçevesinde kurulan blokları sahne bölgesine taşır: merkez → bölge merkezi, yatay `s`, düşey `sy`, isteğe bağlı
 *  eksen değişimi (`swap`) ve z aynası (`fz`); kenar ≥ HIRES_MIN_EDGE. */
export function toScene(list: readonly Block[], c: LandmarkCtx, x: SceneXf): Block[] {
  const y0 = x.y0 ?? 0, dy = x.dy ?? 0;
  return list.map((q) => {
    let u = q.p[0] - x.src.cx - (x.uc ?? 0), v = q.p[2] - x.src.cz, su = q.s[0], sv = q.s[2];
    if (x.swap) { [u, v] = [v, u]; [su, sv] = [sv, su]; }
    v *= x.fz ?? 1;
    return { ...q, p: [c.cx + u * x.s, dy + (q.p[1] - y0) * x.sy, c.cz + v * x.s],
      s: [Math.max(HIRES_MIN_EDGE, su * x.s), Math.max(HIRES_MIN_EDGE, q.s[1] * x.sy), Math.max(HIRES_MIN_EDGE, sv * x.s)] };
  });
}
const SRC_AYA: LandmarkCtx = { x0: -7, z0: -5, w: 14, d: 10, h: 12, cx: 0, cz: 0 };
const SRC_SULTAN: LandmarkCtx = { x0: -5, z0: -6, w: 10, d: 12, h: 13.5, cx: 0, cz: 0 };
const sceneAyasofya: HiResBuild = (c) => toScene(ayasofyaHi(SRC_AYA), c, { src: SRC_AYA, s: 0.5, sy: 0.62, fz: -1 });
/** Sahnede avlu önde (+z, güney), harim arkada: harita −x (avlu) → sahne +z. Bütün külliye (u −11…5) bölgeye ortalanır. */
const sceneSultanahmet: HiResBuild = (c) => toScene(sultanahmetHi(SRC_SULTAN), c, { src: SRC_SULTAN, s: 0.5, sy: 0.65, swap: true, fz: -1, uc: -3 });
/** Galata: sahne kaidesi (orta modelden, tepe ≤ 0,86) korunur; kule ×0,46 ile kaidenin üstüne (y 0,85) oturur, kapı güneye (+z). */
const sceneGalata: HiResBuild = (c, mid) => {
  const raw: Block[] = [];
  galataTower(sink(raw), 0, 0, true);
  const src: LandmarkCtx = { x0: -2.5, z0: -2.5, w: 5, d: 5, h: 20, cx: 0, cz: 0 };
  const cx = c.cx, cz = c.cz;
  const tower = toScene(raw, { ...c, cx, cz }, { src, s: 0.46, sy: 0.46, fz: -1, y0: GALATA_Y0, dy: 0.85 });
  return [...mid.filter((q) => q.p[1] + q.s[1] / 2 <= 0.86), ...tower];
};

// ------------------------------------------------------------------------------------------ kayıt
export const ISTANBUL_HIRES_MAP: HiResMapEntry[] = [
  { map: "istanbul", landmark: "ayasofya", hi: (c) => ayasofyaHi(c) },
  { map: "istanbul", landmark: "suleymaniye", hi: (c) => suleymaniyeHi(c) },
  // avlu ayak izinin batısında (yerel karo li −6…−1): izinli bölge
  { map: "istanbul", landmark: "sultanahmet", hi: (c) => sultanahmetHi(c), zone: [[-COURT_W, 0, COURT_W, 12]] },
  { map: "istanbul", landmark: "ortakoy", hi: (c) => ortakoyHi(c) },
  { map: "istanbul", landmark: "galata_kulesi", hi: galataHi },
];

export const ISTANBUL_HIRES_SCENE: HiResSceneEntry[] = [
  { scene: "istanbul", tag: "ayasofya", hi: sceneAyasofya },
  { scene: "istanbul", tag: "sultanahmet", hi: sceneSultanahmet },
  { scene: "istanbul", tag: "galata", hi: sceneGalata, margin: 1.2 },
];
