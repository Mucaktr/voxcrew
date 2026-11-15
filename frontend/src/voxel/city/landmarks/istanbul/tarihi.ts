/**
 * İstanbul şehir haritası: **Tarihi Yarımada** landmarkları ve semt tasarımı.
 *
 * Ölçek: yürüme ölçeği (insan 1,0), landmarklar gerçek oranlarına yakın (en/boy/yükseklik oranı), mesafeler sıkıştırılmış.
 * Yön: +z kuzey (Haliç ağzı, iskele), +x doğu (Boğaz). Ofis sahnesindeki Ayasofya benzeri ve Sultanahmet benzeri yapıların
 * (scenes/istanbul.ts) tipolojisi ve paleti yeniden kullanılır, şehir ölçeğine büyütülür (ayrıntı aynı, blok bütçesi parsel başına).
 *
 * İçerik kuralları: yazı, logo, bayrak, dinî simge yok (minare ve kubbelerde alem yok); camiler yalnız dış görünüm + avlu,
 * iç mekân kapalı (SK-K3) ve kutsal bölge. Topkapı'nın kapı kitabeleri ve tuğraları konmaz; Hipodrom anıtlarında kabartma yok.
*/
import type { Block } from "../../../scenes";
import { ISTANBUL_LANDMARKS as L } from "../../styles/istanbul";
import { dome, oct, sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkGarden, type LandmarkModel, type Sink } from "../../../citymap/design";
import type { CityTile } from "../../../citymap/format";
import { walkBenchAt } from "../../kit";
import { placeVenue, venueSolidTiles } from "../../venues";
import { genFar } from "./farLod.gen";

const OPEN = L.opening;
/** CITY-PASS-IST: Eminönü balık-ekmek mekânının tezgâh karosu (semt yerel); sipariş karosu bir güneyde (55, 42). */
export const EMIN_VENUE: [number, number] = [55, 43];
const STONE = "#CFC3AE", STONE2 = "#B9AC94", GRASS = "#7FA65A", TRUNK = "#6B4A2E", LEAF = "#4F7F3A";

/** Yarım kubbe: (x, z) düz kenarın ortası, (dx, dz) açıldığı yön; kademe başına 2 kutu. */
export function halfDome(b: Sink, x: number, y: number, z: number, r: number, h: number, dx: number, dz: number, c: string, steps = 2) {
  const hh = h / steps;
  for (let k = 0; k < steps; k++) {
    const t = (k + 0.35) / steps, w = 2 * r * Math.sqrt(1 - t * t), yc = y + k * hh + hh / 2;
    for (const [len, across] of [[w / 2 * 0.82, w], [w / 2, w * 0.6]]) {
      const cx = x + dx * len / 2, cz = z + dz * len / 2;
      if (dx) b(cx, yc, cz, len, hh + 0.02, across, c);
      else b(cx, yc, cz, across, hh + 0.02, len, c);
    }
  }
}
/** Küçük revak kubbeciği (2 kutu). */
export function domelet(b: Sink, x: number, y: number, z: number, r: number, c: string) {
  b(x, y + 0.1, z, 2 * r, 0.2, 2 * r, c, "solid", 0.02);
  b(x, y + 0.28, z, 1.2 * r, 0.18, 1.2 * r, c, "solid", 0.02);
}
/** Çınar (gövde + iki taç kutusu). */
export function plane(b: Sink, x: number, z: number, s = 1) {
  b(x, 0.7 * s, z, 0.3 * s, 1.4 * s, 0.3 * s, TRUNK, "solid", 0.05);
  b(x, 1.9 * s, z, 1.7 * s, 1.1 * s, 1.7 * s, LEAF, "solid", 0.1);
  b(x + 0.2 * s, 2.6 * s, z - 0.1 * s, 1.1 * s, 0.6 * s, 1.1 * s, "#5E8F44", "solid", 0.1);
}

// ------------------------------------------------------------------------------------------ ortak: şerefeli minare, kasnak
/**
 * LANDMARK-FIDELITY — şerefe sayısı ayarlanabilir kalem minare (alem yok: harita kuralı): kaide, gövde (üstte incelir), `n` şerefe
 * (konsol bileziği + taşkın balkon + korkuluk), şerefe üstü gövde, dört kademeli sivri kurşun külah. Tepe = h + 1,4.
 */
export function minaretN(b: Sink, x: number, z: number, h: number, n: number, c: string, cap: string, shaft = 0.5) {
  b(x, 0.6, z, shaft * 1.6, 1.2, shaft * 1.6, c);
  const fs = n === 1 ? [0.74] : n === 2 ? [0.6, 0.8] : [0.5, 0.66, 0.82];
  const top = h * fs[fs.length - 1];
  b(x, (1.2 + top) / 2, z, shaft, top - 1.2, shaft, c);
  for (const f of fs) {
    const y = h * f;
    b(x, y - 0.16, z, shaft * 1.35, 0.22, shaft * 1.35, c, "solid", 0.02);        // konsol (mukarnas) bileziği
    b(x, y + 0.06, z, shaft * 2.0, 0.24, shaft * 2.0, "#D9D2C4", "solid", 0.02);  // taşkın balkon + taş korkuluk
  }
  b(x, (top + h) / 2 + 0.1, z, shaft * 0.86, h - top + 0.2, shaft * 0.86, c);
  [0.95, 0.62, 0.3].forEach((f, k) => b(x, h + 0.2 + 0.235 + k * 0.46, z, shaft * f + 0.04, 0.47, shaft * f + 0.04, cap, "solid", 0.02));
}
/**
 * LANDMARK-FIDELITY — pencereli kubbe kasnağı: koyu (gece parlayan) iç halka + çevresinde `n` taş payanda; uzaktan pencere-payanda
 * dizisi (Ayasofya 40, Sultanahmet 28 pencere; stilize). İç halka `glow`: gündüz koyu kehribar cam, gece sıcak ışık (durağan).
 */
export function windowDrum(b: Sink, x: number, y: number, z: number, w: number, h: number, n: number, stone: string, lit = "#6B4423") {
  for (let q = 0; q < 3; q++) b(x, y + h / 2, z, [w * 0.92, w * 0.38, w * 0.66][q], h, [w * 0.38, w * 0.92, w * 0.66][q], lit, "glow", 0);
  const r = w * 0.5 - 0.1, pw = Math.max(0.16, (Math.PI * w) / n * 0.45);
  for (let q = 0; q < n; q++) {
    const a = ((q + 0.5) / n) * Math.PI * 2;
    b(x + Math.cos(a) * r, y + h / 2, z + Math.sin(a) * r, pw, h + 0.02, pw, stone, "solid", 0.02);
  }
  oct(b, x, y + h + 0.06, z, w + 0.1, 0.12, stone, 0.02); // kasnak saçağı (kubbe buna oturur)
}

// ------------------------------------------------------------------------------------------ Ayasofya benzeri (14 × 10)
/**
 * LANDMARK-FIDELITY: doğu-batı eksenli gövde, batıda iki katlı narteks; kare merkez kütle,
 * kuzey ve güneyde dört büyük payanda kulesi (uçan kemerle merkeze bağlı) + cephe payandaları; 40 pencereli kasnağı andıran
 * pencere-payanda halkası (gece içten ışık), geniş BASIK ana kubbe (taç 55,6 m → ≈ 11,4); doğu ve batıda ana kubbe eninde iki
 * büyük yarım kubbe, her birinin iki yanında eksedra yarım kubbecikleri (çağlayan), doğuda apsis. Dört FARKLI minare: batıda iki
 * özdeş kalın beyaz taş (en yüksek, iki şerefe), kuzeydoğuda ince beyaz (tek şerefe), güneydoğuda kırmızı tuğla (tek şerefe).
 * Alem, hat levhası, mozaik, figür yok; iç mekân kapalı.
*/
function ayasofya(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, x0 = c.x0, W = L.hsWall, W2 = L.hsWall2, LEAD = L.hsLead, LEAD2 = L.hsLead2;
  // taş zemin + gövde (yan nefler ve galeriler) + kurşun yan çatı
  b(X + 0.4, 0.06, Z, 12.6, 0.12, 8.8, "#D9CDB8", "solid", 0.02);
  b(X + 0.5, 2.5, Z, 10.0, 5.0, 7.8, W);
  b(X + 0.5, 5.08, Z, 10.2, 0.16, 8.0, LEAD2, "solid", 0.02);
  // batı: iç ve dış narteks (alçak, kurşun çatılı) + üç kapı
  b(x0 + 2.4, 2.1, Z, 1.4, 4.2, 7.4, W2);
  b(x0 + 2.4, 4.28, Z, 1.6, 0.16, 7.6, LEAD2, "solid", 0.02);
  b(x0 + 1.35, 1.3, Z, 0.7, 2.6, 6.2, W2);
  b(x0 + 1.35, 2.68, Z, 0.84, 0.16, 6.4, LEAD2, "solid", 0.02);
  for (const dz of [-1.4, 0, 1.4]) b(x0 + 0.98, 0.75, Z + dz, 0.04, 1.3, 0.7, OPEN, "solid", 0);
  // merkez kare kütle (pandantif katı) + saçak
  b(X, 6.9, Z, 6.2, 3.6, 6.2, W);
  b(X, 8.75, Z, 6.5, 0.14, 6.5, LEAD2, "solid", 0.02);
  // kuzey/güney: dört büyük payanda kulesi + uçan kemer, aralarında cephe payandaları
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = X + sx * 2.5, pz = Z + sz * 4.4;
    b(px, 3.9, pz, 1.2, 7.8, 1.0, W2);
    b(px, 8.0, pz - sz * 0.15, 0.9, 0.4, 0.7, W2);
    b(px, 8.26, pz - sz * 0.15, 1.0, 0.12, 0.8, LEAD, "solid", 0.02);
    b(px, 7.4, Z + sz * 3.5, 0.7, 0.7, 0.9, W2);                     // uçan kemer: payanda → merkez kütle
    b(X + sx * 4.7, 2.6, Z + sz * 4.15, 0.6, 5.2, 0.5, W2);
  }
  // pencereli kasnak + basık ana kubbe (geniş, alçak taç)
  windowDrum(b, X, 8.82, Z, 5.8, 0.66, 20, W);
  dome(b, X, 9.6, Z, 2.95, 1.8, LEAD, 5);
  b(X, 11.44, Z, 0.5, 0.08, 0.5, LEAD);
  // doğu ve batı büyük yarım kubbeleri (altlarında taşıyıcı kütle) + eksedralar + doğu apsisi
  for (const sx of [-1, 1]) {
    b(X + sx * 4.3, 6.0, Z, 2.4, 1.84, 5.6, W);
    halfDome(b, X + sx * 3.1, 6.9, Z, 2.9, 1.9, sx, 0, LEAD, 3);
    for (const sz of [-1, 1]) {
      b(X + sx * 5.1, 5.55, Z + sz * 1.9, 1.2, 0.95, 1.8, W);
      halfDome(b, X + sx * 4.5, 6.0, Z + sz * 1.9, 1.05, 0.9, sx, 0, LEAD2, 2);
    }
  }
  b(X + 5.9, 2.6, Z, 1.2, 5.2, 2.8, W2);
  halfDome(b, X + 6.0, 5.2, Z, 1.3, 0.9, 1, 0, LEAD2, 2);
  // kuzey ve güney cephe: iki sıra kemerli pencere; galeri katında üçlü pencere
  for (const sz of [-1, 1]) {
    for (const y of [1.3, 3.0]) for (let q = -2; q <= 3; q++) if (q !== 0) b(X + q * 1.55 - 0.6, y, Z + sz * 3.92, 0.38, 0.8, 0.04, OPEN, "solid", 0);
    for (const dx of [-0.7, 0, 0.7]) b(X + dx, 7.0, Z + sz * 3.12, 0.4, 1.0, 0.04, OPEN, "solid", 0);
  }
  // minareler (şerefe sayısı ve malzeme farklı)
  const zs = c.z0 + 0.75, zn = c.z0 + c.d - 0.75, xe = x0 + c.w - 0.75, xw = x0 + 0.75;
  minaretN(b, xw, zs, 10.9, 2, L.hsMinaret, LEAD, 0.6);
  minaretN(b, xw, zn, 10.9, 2, L.hsMinaret, LEAD, 0.6);
  minaretN(b, xe, zn, 10.5, 1, L.hsMinaret, LEAD, 0.44);
  minaretN(b, xe, zs, 10.1, 1, "#A9573F", LEAD, 0.56);
  return out;
}
function ayasofyaFar(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  b(c.cx + 0.5, 2.5, c.cz, 10, 5, 7.8, L.hsWall, "solid", 0);
  b(c.cx, 7.2, c.cz, 6.2, 4.4, 6.2, L.hsWall, "solid", 0);
  b(c.cx, 10.4, c.cz, 5.2, 2.0, 5.2, L.hsLead, "solid", 0);
  b(c.cx, 7.8, c.cz, 11, 1.4, 3.4, L.hsLead, "solid", 0);
  for (const [x, z] of [[c.x0 + 0.75, c.z0 + 0.75], [c.x0 + 0.75, c.z0 + c.d - 0.75]])
    b(x, 6.0, z, 0.6, 12, 0.6, L.hsMinaret, "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ Sultanahmet benzeri (10 × 12 + batı avlusu)
/** İbadet bölümü (ayak izi) + batıda revaklı avlu (ayak izinin dışında; avlu duvarları tasarımda katı karo), 6 minare. */
const COURT_W = 6;
function sultanahmet(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz;
  b(X, 1.5, Z, 9, 3.0, 11, L.bmStone);
  b(X, 3.07, Z, 9.1, 0.14, 11.1, L.bmStone2, "solid", 0.02);
  b(X, 3.55, Z, 6.6, 0.9, 6.6, L.bmStone2);
  // LANDMARK-FIDELITY (istanbul.md §2): çağlayan — dört köşe kubbesi, dört yarım kubbe (her birinin iki yanında eksedra
  // yarım kubbecikleri), dört sekizgen ağırlık kulesi, 28 pencereli kasnak (gece içten ışık), ana kubbe
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) dome(b, X + sx * 3.3, 3.14, Z + sz * 4.2, 0.9, 0.7, L.bmDome, 2);
  halfDome(b, X + 2.0, 4.0, Z, 2.1, 1.3, 1, 0, L.bmDome);
  halfDome(b, X - 2.0, 4.0, Z, 2.1, 1.3, -1, 0, L.bmDome);
  halfDome(b, X, 4.0, Z + 2.0, 2.1, 1.3, 0, 1, L.bmDome);
  halfDome(b, X, 4.0, Z - 2.0, 2.1, 1.3, 0, -1, L.bmDome);
  for (const s of [-1, 1]) for (const o of [-1, 1]) {
    halfDome(b, X + s * 3.3, 3.14, Z + o * 1.75, 0.75, 0.6, s, 0, L.bmDome, 1);
    halfDome(b, X + o * 1.75, 3.14, Z + s * 3.3, 0.75, 0.6, 0, s, L.bmDome, 1);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    oct(b, X + sx * 2.3, 4.6, Z + sz * 2.3, 0.7, 1.4, L.bmStone);
    b(X + sx * 2.3, 5.45, Z + sz * 2.3, 0.45, 0.3, 0.45, L.bmDome);
    b(X + sx * 2.3, 5.75, Z + sz * 2.3, 0.18, 0.3, 0.18, L.bmDome);
  }
  // kasnak yarım kubbelerin (tepe 5,3) üstüne çıkar: pencere halkası uzaktan ve gece görünür
  oct(b, X, 4.5, Z, 4.6, 1.0, L.bmStone);
  windowDrum(b, X, 5.0, Z, 4.6, 0.55, 12, L.bmStone);
  dome(b, X, 5.67, Z, 2.4, 2.1, L.bmDome, 4);
  // CITY-PASS-IST (REAL-SUPPORT P0): doğu pencereleri duvar yüzünde (X + 4,5; eski: ayak izi kenarında, duvardan 0,5 ayrık)
  for (let q = -2; q <= 2; q++) b(X + 4.52, 1.6, Z + q * 2, 0.04, 0.9, 0.5, OPEN, "solid", 0);
  for (const sz of [-1, 1]) for (let q = -1; q <= 1; q++) b(X + q * 2.4, 1.6, Z + sz * 5.52, 0.6, 0.9, 0.04, OPEN, "solid", 0);
  // dört minare (üç şerefe): ibadet bölümünün köşelerinde
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx < 0 ? c.x0 + 0.6 : c.x0 + c.w - 0.6, z = sz < 0 ? c.z0 + 0.6 : c.z0 + c.d - 0.6;
    minaretN(b, x, z, 11.8, 3, L.bmMinaret, L.bmDome, 0.48);
  }
  // avlu (batı, ayak izinin dışında): revak duvarları, kubbecikler, taç kapı, şadırvan, iki minare
  const ax0 = c.x0 - COURT_W, ax1 = c.x0, az0 = c.z0, az1 = c.z0 + c.d;
  const acx = (ax0 + ax1) / 2, acz = (az0 + az1) / 2;
  b(ax0 + 0.5, 0.75, acz, 1.0, 1.5, c.d, L.bmStone);
  b(acx, 0.75, az0 + 0.5, COURT_W, 1.5, 1.0, L.bmStone);
  b(acx, 0.75, az1 - 0.5, COURT_W, 1.5, 1.0, L.bmStone);
  // LANDMARK-FIDELITY: revak üç yanda kubbecik dizisi (gerçekte 30 kubbe; burada 15)
  for (let q = 0; q < 5; q++) {
    domelet(b, ax0 + 0.5, 1.5, az0 + 1.6 + q * ((c.d - 3.2) / 4), 0.42, L.bmDome);
    domelet(b, ax0 + 1.4 + q * 1.0, 1.5, az0 + 0.5, 0.42, L.bmDome);
    domelet(b, ax0 + 1.4 + q * 1.0, 1.5, az1 - 0.5, 0.42, L.bmDome);
  }
  // taç kapı (batı duvarı ortasında; kapı aralığı tasarımda yürünür)
  b(ax0 + 0.5, 2.2, acz - 1.35, 1.1, 1.4, 0.6, L.bmStone2);
  b(ax0 + 0.5, 2.2, acz + 1.35, 1.1, 1.4, 0.6, L.bmStone2);
  b(ax0 + 0.5, 2.7, acz, 1.1, 0.6, 2.2, L.bmStone2);
  oct(b, acx, 0.35, acz, 1.4, 0.7, L.bmStone2);
  dome(b, acx, 0.7, acz, 0.75, 0.6, L.bmDome, 2);
  for (const z of [az0 + 0.5, az1 - 0.5]) {
    minaretN(b, ax0 + 0.5, z, 11.0, 2, L.bmMinaret, L.bmDome, 0.46);
  }
  return out;
}
function sultanahmetFar(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  b(c.cx, 2.4, c.cz, 9, 4.8, 11, L.bmStone, "solid", 0);
  b(c.cx, 6.2, c.cz, 4.4, 2.8, 4.4, L.bmDome, "solid", 0);
  b(c.x0 - COURT_W / 2, 0.75, c.cz, COURT_W, 1.5, c.d, L.bmStone, "solid", 0);
  for (const [x, z] of [[c.x0 + 0.6, c.z0 + 0.6], [c.x0 + c.w - 0.6, c.z0 + c.d - 0.6], [c.x0 - COURT_W + 0.5, c.z0 + 0.5]])
    b(x, 6, z, 0.5, 12, 0.5, L.bmMinaret, "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ Süleymaniye benzeri (9 × 13)
/**
 * LANDMARK-HIRES (istanbul.md §10): Haliç'e bakan tepede Sinan'ın külliye camisi — güneyde harim (kare; ortada ana kubbe, kıble
 * ekseninde iki yarım kubbe, köşelerde dört ağırlık kulesi, yan cephelerde payandalar ve kubbecikli yan nefler), kuzeyde revaklı
 * avlu (kubbecikler, taç kapı, dikdörtgen şadırvan). Dört minare, toplam 10 şerefe: harim-avlu birleşimindeki iki yüksek minare
 * üçer, avlunun kuzey köşelerindeki iki alçak minare ikişer şerefeli. Bu ORTA model parsel bütçesindedir (≈ 110 kutu); ayrıntı
 * `istanbul/hires.ts` (yakın kademe). Alem, yazı, hat yok; iç mekân kapalı, kutsal bölge.
 */
export const SULEYMANIYE_STONE = "#DCD3C2", SULEYMANIYE_STONE2 = "#C9BFAC";
export function suleymaniye(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w } = c, X = c.cx, Zh = z0 + 4.0, Zc = z0 + 10.5, S = SULEYMANIYE_STONE, S2 = SULEYMANIYE_STONE2, LEAD = L.hsLead, LEAD2 = L.hsLead2, hw = w / 2 - 0.3;
  b(X, 0.06, z0 + 6.5, w - 0.2, 0.12, 12.8, "#D9CDB8", "solid", 0.02);
  // harim: yan nefler + kurşun çatı, yan cephelerde payandalar, iki yanda kubbecikli yan nefler
  b(X, 2.5, Zh, 2 * hw, 5.0, 7.8, S);
  b(X, 5.08, Zh, 2 * hw + 0.1, 0.16, 7.9, LEAD2, "solid", 0.02);
  for (const sx of [-1, 1]) {
    for (const dz of [-2.6, -0.9, 0.9, 2.6]) b(X + sx * (hw + 0.08), 2.4, Zh + dz, 0.2, 4.8, 0.45, S2);
    for (const dz of [-1.8, 0, 1.8]) domelet(b, X + sx * (hw - 0.95), 5.16, Zh + dz, 0.62, LEAD);
  }
  // merkez kütle (pandantif katı), dört ağırlık kulesi, pencereli kasnak + ana kubbe, kıble ekseninde iki yarım kubbe
  b(X, 6.3, Zh, 4.8, 2.6, 4.8, S);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    oct(b, X + sx * 2.3, 6.6, Zh + sz * 2.3, 0.9, 3.2, S2);
    dome(b, X + sx * 2.3, 8.2, Zh + sz * 2.3, 0.42, 0.45, LEAD, 1);
  }
  for (const sz of [-1, 1]) halfDome(b, X, 5.16, Zh + sz * 2.25, 2.2, 2.3, 0, sz, LEAD, 3);
  windowDrum(b, X, 7.6, Zh, 4.6, 0.62, 16, S);
  dome(b, X, 8.36, Zh, 2.3, 2.2, LEAD, 4);
  b(X, 10.6, Zh, 0.4, 0.08, 0.4, LEAD);
  // güney (kıble) cephesi: mihrap çıkıntısı
  b(X, 2.2, z0 + 0.08, 1.6, 4.0, 0.3, S2);
  // avlu: üç yanda revak duvarı + kurşun saçak, kubbecikler, kuzeyde taç kapı, ortada dikdörtgen şadırvan
  const ax0 = x0 + 0.3, ax1 = x0 + w - 0.3, az0 = z0 + 8.1, az1 = z0 + 12.7;
  for (const [x, z, ww, dd] of [[ax0 + 0.3, (az0 + az1) / 2, 0.6, az1 - az0], [ax1 - 0.3, (az0 + az1) / 2, 0.6, az1 - az0], [X, az1 - 0.3, ax1 - ax0, 0.6]] as const) {
    b(x, 0.9, z, ww, 1.8, dd, S);
    b(x, 1.86, z, ww + 0.1, 0.12, dd + 0.1, LEAD2, "solid", 0.02);
  }
  for (let q = 0; q < 4; q++) domelet(b, ax0 + 1.3 + q * (ax1 - ax0 - 2.6) / 3, 1.92, az1 - 0.3, 0.42, LEAD);
  for (const x of [ax0 + 0.3, ax1 - 0.3]) for (const z of [az0 + 1.2, az0 + 3.0]) domelet(b, x, 1.92, z, 0.42, LEAD);
  b(X, 1.6, az1 - 0.3, 1.8, 3.2, 0.8, S2);
  domelet(b, X, 3.2, az1 - 0.3, 0.6, LEAD);
  b(X, 0.35, Zc, 1.4, 0.7, 0.9, S2);
  // dört minare (toplam 10 şerefe): harim-avlu birleşiminde iki yüksek (3), avlunun kuzey köşelerinde iki alçak (2)
  for (const x of [x0 + 0.45, x0 + w - 0.45]) {
    minaretN(b, x, az0, 12.7, 3, L.hsMinaret, LEAD, 0.46);
    minaretN(b, x, az1 - 0.25, 11.0, 2, L.hsMinaret, LEAD, 0.42);
  }
  return out;
}
function suleymaniyeFar(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out), Zh = c.z0 + 4.0;
  b(c.cx, 2.6, Zh, c.w - 0.6, 5.2, 7.8, SULEYMANIYE_STONE, "solid", 0);
  b(c.cx, 7.2, Zh, 4.8, 4.2, 4.8, SULEYMANIYE_STONE, "solid", 0);
  b(c.cx, 9.6, Zh, 4.0, 2.0, 4.0, L.hsLead, "solid", 0);
  b(c.cx, 0.9, c.z0 + 10.4, c.w - 0.6, 1.8, 4.6, SULEYMANIYE_STONE, "solid", 0);
  for (const x of [c.x0 + 0.45, c.x0 + c.w - 0.45]) b(x, 7.0, c.z0 + 8.1, 0.46, 14, 0.46, L.hsMinaret, "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ Topkapı (14 × 14)
/** Sur, Bab-ı Hümayun (batı kapısı; girilebilir: avlular), Babüsselam'ın sekizgen ikiz kuleleri, Adalet Kulesi, Divan,
 *  mutfak bacaları, Harem çatıları, çınarlar. Kitabe ve tuğra yok. */
/** TOUR-VIEW (LANDMARK-GARDEN-001): saray avluları — kuzey (Gülhane) kapısından; Divan, Harem, köşkler, mutfaklar katı. */
const TOPKAPI_GATE: CityTile = [2, 13];
const TOPKAPI_GARDEN: LandmarkGarden = { kind: "court", rects: [[1, 1, 12, 12]], gates: [TOPKAPI_GATE], floor: "park" };
/** TOUR-VIEW: Ayasofya kutsal alanı — minareler arasında yapının çevresi (duvarsız; sessiz kutsal bölge). */
function topkapi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, X = c.cx, Z = c.cz;
  const WALL = "#D8CDB6", LEAD = "#7F8A94", PAV = "#EEE6D6";
  b(X, 0.05, Z, w - 1, 0.1, d - 1, GRASS, "solid", 0.05);
  // TOUR-VIEW: kuzey surunda (Gülhane yönü) yürünür kapı — yerel karo (2, d − 1); birinci avlu ve çınarlar gezilir (TOPKAPI_GARDEN)
  const ng0 = x0 + TOPKAPI_GATE[0], ng1 = ng0 + 1;
  for (const [x, z, ww, dd] of [[X, z0 + 0.3, w, 0.6], [(x0 + ng0) / 2, z0 + d - 0.3, ng0 - x0, 0.6], [(ng1 + x0 + w) / 2, z0 + d - 0.3, x0 + w - ng1, 0.6],
    [x0 + 0.3, Z, 0.6, d], [x0 + w - 0.3, Z, 0.6, d]] as const) {
    b(x, 1.1, z, ww, 2.2, dd, WALL);
    b(x, 2.32, z, ww === 0.6 ? 0.7 : ww, 0.24, dd === 0.6 ? 0.7 : dd, STONE2, "solid", 0.02);
  }
  b(ng0 + 0.5, 2.15, z0 + d - 0.3, 1.2, 0.5, 0.8, WALL); // kapı kemeri (yürüme bandının üstünde)
  b(ng0 + 0.5, 2.5, z0 + d - 0.3, 1.4, 0.2, 1.0, LEAD);
  // Bab-ı Hümayun (batı; kapı karosu [li0 − 1, lj0 + 5])
  const gz = z0 + 5.5;
  b(x0 + 0.6, 2.0, gz, 1.5, 4.0, 3.2, WALL);
  b(x0 - 0.17, 1.2, gz, 0.04, 2.0, 1.3, OPEN, "solid", 0);
  b(x0 + 0.6, 4.15, gz, 1.7, 0.3, 3.4, LEAD);
  // Babüsselam: sekizgen ikiz kuleler, sivri kurşun külahlar, aradaki kapı
  for (const s of [-1, 1]) {
    oct(b, x0 + 5, 2.0, gz + s * 1.3, 1.2, 4.0, PAV);
    // sivri sekizgen kurşun külahlar (beş kademe)
    for (let k = 0; k < 5; k++) oct(b, x0 + 5, 4.0 + k * 0.42 + 0.21, gz + s * 1.3, 1.25 - k * 0.24, 0.43, LEAD, 0.02);
    b(x0 + 5, 6.2, gz + s * 1.3, 0.06, 0.24, 0.06, LEAD, "solid", 0);
  }
  b(x0 + 5, 1.4, gz, 1.0, 2.8, 1.5, PAV);
  b(x0 + 5, 3.0, gz, 1.6, 0.3, 2.0, LEAD);
  // Divan (geniş saçaklı kurşun çatı) + Adalet Kulesi — LANDMARK-FIDELITY (istanbul.md §3): sarayın en yüksek yapısı; taş gövde,
  // üstte sivri pencereli köşk katı ve fener, kurşun kaplı sivri konik külah (Boğaz'dan görünen en belirgin parça)
  b(x0 + 8.5, 1.2, z0 + 3.2, 3.4, 2.4, 2.4, PAV);
  b(x0 + 8.5, 2.5, z0 + 3.2, 4.4, 0.2, 3.2, LEAD, "solid", 0.02);
  b(x0 + 8.5, 2.75, z0 + 3.2, 3.0, 0.3, 2.0, LEAD, "solid", 0.02);
  const tx0 = x0 + 10.4, tz0 = z0 + 3.2;
  b(tx0, 3.0, tz0, 1.5, 6.0, 1.5, WALL);
  b(tx0, 6.08, tz0, 1.66, 0.16, 1.66, STONE2, "solid", 0.02);
  b(tx0, 6.75, tz0, 1.36, 1.2, 1.36, PAV);
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) for (const o of [-0.35, 0.35])
    b(tx0 + dx * 0.69 + (dz ? o : 0), 6.8, tz0 + dz * 0.69 + (dx ? o : 0), dz ? 0.22 : 0.04, 0.7, dz ? 0.04 : 0.22, "#6B4423", "glow", 0); // gece köşk pencereleri
  b(tx0, 7.42, tz0, 1.7, 0.14, 1.7, LEAD, "solid", 0.02);
  oct(b, tx0, 7.75, tz0, 0.9, 0.5, PAV);
  for (let k = 0; k < 4; k++) oct(b, tx0, 8.0 + k * 0.45 + 0.225, tz0, 1.0 - k * 0.22, 0.46, LEAD, 0.02);
  b(tx0, 9.95, tz0, 0.08, 0.3, 0.08, LEAD, "solid", 0);
  // mutfaklar (Sinan): güney sur boyunca on kubbeli mutfak, çatıda iki sıra geniş baca
  b(X + 1.0, 1.0, z0 + 1.2, 10, 2.0, 1.4, PAV); // CITY-PASS-IST: ilk baca da mutfak çatısında (eski: 0,2 dışarıda, havada)
  for (let q = 0; q < 10; q++) {
    const x = x0 + 2.45 + q * 1.0;
    dome(b, x, 2.0, z0 + 1.2, 0.42, 0.32, LEAD, 1);
    for (const dz of [-0.5, 0.5]) { b(x, 2.4, z0 + 1.2 + dz, 0.3, 0.8, 0.26, WALL); b(x, 2.84, z0 + 1.2 + dz, 0.36, 0.08, 0.32, LEAD); }
  }
  // Harem (kuzeydoğu) ve köşkler; kubbecikler
  b(x0 + 10.5, 1.6, z0 + 9.5, 4.0, 3.2, 5.0, PAV);
  b(x0 + 10.5, 3.3, z0 + 9.5, 4.3, 0.2, 5.3, LEAD);
  for (const [dx, dz] of [[-1, -1.5], [1, -1.5], [0, 1.2]]) domelet(b, x0 + 10.5 + dx, 3.4, z0 + 9.5 + dz, 0.55, LEAD);
  for (const [x, z] of [[x0 + 6.5, z0 + 11.5], [x0 + 12.4, z0 + 4.2]]) {
    b(x, 1.0, z, 1.8, 2.0, 1.8, PAV);
    b(x, 2.15, z, 2.8, 0.18, 2.8, LEAD);
    b(x, 2.45, z, 1.2, 0.4, 1.2, LEAD);
  }
  for (const [x, z] of [[x0 + 3, z0 + 9], [x0 + 7, z0 + 8], [x0 + 3, z0 + 3], [x0 + 7.5, z0 + 11.8]]) plane(b, x, z, 0.9);
  return out;
}
function topkapiFar(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  b(c.cx, 1.1, c.cz, c.w, 2.2, c.d, "#D8CDB6", "solid", 0);
  b(c.x0 + 10.4, 4.5, c.z0 + 3.2, 1.4, 9, 1.4, "#D8CDB6", "solid", 0);
  b(c.x0 + 10.5, 1.8, c.z0 + 9.5, 4.2, 3.6, 5.2, "#7F8A94", "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ Yerebatan girişi (3 × 3)
function yerebatan(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz;
  b(X, 1.0, Z, 2.8, 2.0, 2.8, STONE);
  b(X, 2.1, Z, 3.0, 0.2, 3.0, L.hsLead2, "solid", 0.02);
  dome(b, X, 2.2, Z, 0.95, 0.65, L.hsLead, 2);
  b(X, 0.7, c.z0 - 0.02, 0.9, 1.3, 0.04, OPEN, "solid", 0);
  for (const s of [-1, 1]) {
    b(X + s * 0.75, 0.75, c.z0 - 0.15, 0.24, 1.5, 0.24, "#E4DCCB");
    b(X + s * 0.75, 1.55, c.z0 - 0.15, 0.36, 0.14, 0.36, "#CBBFA8");
  }
  // inen basamak izi (kapının önünde koyu şerit)
  b(X, 0.02, c.z0 - 0.75, 0.9, 0.04, 0.5, "#6E6253", "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ Hipodrom: Dikilitaş (2 × 2)
function dikilitas(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, G = "#C49A7A";
  b(X, 0.55, Z, 1.9, 1.1, 1.9, "#D9D1C2");
  b(X, 1.2, Z, 1.5, 0.2, 1.5, "#A88F5C");
  for (let q = 0; q < 6; q++) { const w = 0.95 - q * 0.07; b(X, 1.3 + q * 1.15 + 0.575, Z, w, 1.17, w, G, "solid", 0.02); }
  b(X, 8.35, Z, 0.5, 0.4, 0.5, G); b(X, 8.65, Z, 0.24, 0.2, 0.24, G);
  return out;
}
const tallFar = (color: string, wr = 0.6) => (c: LandmarkCtx): Block[] => [{ p: [c.cx, c.h / 2, c.cz], s: [c.w * wr, c.h, c.d * wr], c: color, g: "solid", j: 0 }];

// ------------------------------------------------------------------------------------------ Kapalıçarşı (16 × 12)
function kapalicarsi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, X = c.cx, Z = c.cz;
  b(X, 1.4, Z, w, 2.8, d, L.bazaarStone);
  b(X, 2.86, Z, w + 0.1, 0.12, d + 0.1, L.bazaarRib, "solid", 0.02);
  b(X, 3.0, Z, w - 0.4, 0.2, d - 0.4, L.bazaarVault, "solid", 0.02);
  for (let qi = 0; qi < 5; qi++) for (let qj = 0; qj < 4; qj++) {
    if ((qi === 1 || qi === 3) && (qj === 1 || qj === 2)) continue;
    domelet(b, x0 + 1.8 + qi * 3.1, 3.05, z0 + 1.6 + qj * 2.9, 0.62, L.bazaarVault);
  }
  for (const qi of [1, 3]) dome(b, x0 + 1.8 + qi * 3.1, 3.05, Z, 1.3, 0.9, L.hsLead, 2);
  // doğu kapısı (Nuruosmaniye yönü; kapı karosu [li0 + w, lj0 + 5]) + kuzey ve batı kapıları
  const gz = z0 + 5.5;
  b(x0 + w - 0.3, 1.9, gz, 0.7, 3.8, 2.2, L.bazaarRib);
  b(x0 + w + 0.02, 1.2, gz, 0.04, 2.0, 1.1, OPEN, "solid", 0);
  b(x0 + 0.3, 1.9, gz, 0.7, 3.8, 2.2, L.bazaarRib);
  b(X, 1.9, z0 + d - 0.3, 2.2, 3.8, 0.7, L.bazaarRib);
  b(X, 1.2, z0 + d + 0.02, 1.1, 2.0, 0.04, OPEN, "solid", 0);
  // güney ve kuzey cephelerde dükkân tenteleri (renkli, yazısız)
  for (let q = 0; q < 6; q++) {
    const x = x0 + 1.5 + q * 2.6;
    b(x, 1.5, z0 - 0.3, 1.8, 0.1, 0.6, L.spices[q % 6], "solid", 0.02);
    if (q !== 2 && q !== 3) b(x, 1.5, z0 + d + 0.3, 1.8, 0.1, 0.6, L.spices[(q + 3) % 6], "solid", 0.02);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ Mısır Çarşısı (12 × 6)
function misirCarsisi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, X = c.cx, Z = c.cz;
  // CITY-POLISH: doğu cephesi 0,5 içeride — doğu kenar karosundan T1 tramvayı geçer (gövde karodan geniş; CITY-MAP-TRANSIT-001)
  b(X - 0.25, 1.3, Z, w - 0.5, 2.6, d, L.spiceHall);
  b(X - 0.25, 2.66, Z, w - 0.4, 0.12, d + 0.1, L.bazaarRib, "solid", 0.02);
  b(X, 2.8, Z, w - 0.6, 0.2, d - 1.2, L.spiceDome, "solid", 0.02);
  for (let q = 0; q < 6; q++) domelet(b, x0 + 1.2 + q * 1.92, 2.85, Z, 0.55, L.spiceDome);
  for (const s of [-1, 1]) dome(b, X + s * 4.6, 2.7, Z, 1.1, 0.8, L.spiceDome, 2);
  // güney cephe: kemerli bölmeler, ortada taç kapı; önde baharat tezgâhları
  for (let q = 0; q < 6; q++) b(x0 + 1 + q * 2, 1.1, z0 - 0.02, 0.9, 1.4, 0.04, OPEN, "solid", 0);
  b(X, 1.6, z0 + 0.2, 2.0, 3.2, 0.6, L.bazaarRib);
  for (let q = 0; q < 5; q++) {
    const x = x0 + 1.4 + q * 2.3;
    b(x, 0.35, z0 - 0.8, 1.2, 0.7, 0.6, "#8B6A47");
    b(x, 0.78, z0 - 0.8, 1.0, 0.16, 0.45, L.spices[q % 6], "solid", 0.05);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ kayıt
export const TARIHI_LANDMARKS: Record<string, LandmarkModel> = {
  ayasofya: { near: ayasofya, far: ayasofyaFar, ip_risk: 0, culture_risk: 1, sacred: true,
    note: "Ayasofya benzeri: kubbe, yarım kubbeler, payandalar ve dört minare stilize; alem, hat levhası, mozaik ve figür yok. İbadet yeri: dış görünüm + çevre meydanı; güney girişteki avlu portalı şadırvanlı bahçeye açılır (COURTYARD-2); iç mekân kültür incelemesine kadar kapalı, kutsal bölge." },
  sultanahmet: { near: sultanahmet, far: sultanahmetFar, ip_risk: 0, culture_risk: 1, sacred: true,
    note: "Sultanahmet benzeri: çağlayan kubbeler, altı minare ve batı avlusu (revak, şadırvan) stilize; alem ve yazı yok. Avlu gezilebilir, iç mekân kapalı, kutsal bölge (sessiz; emote ve mini oyun yok)." },
  suleymaniye: { near: suleymaniye, far: suleymaniyeFar, ip_risk: 0, culture_risk: 1, sacred: true,
    note: "Süleymaniye benzeri: ana kubbe, kıble ekseninde iki yarım kubbe, dört ağırlık kulesi, payandalar, revaklı avlu (kubbecikler, şadırvan) ve 10 şerefeli dört minare stilize; alem, yazı ve hat yok. İbadet yeri: yalnız dış görünüm; iç mekân kapalı, kutsal bölge." },
  topkapi: { near: topkapi, far: topkapiFar, ip_risk: 0, culture_risk: 0, garden: TOPKAPI_GARDEN,
    note: "Topkapı Sarayı: sur, Bab-ı Hümayun, Babüsselam'ın ikiz kuleleri, Adalet Kulesi, mutfak bacaları ve Harem çatıları stilize; kitabe ve tuğra yok. Avlular girilebilir (Harem yolu dışı)." },
  yerebatan: { near: yerebatan, far: tallFar(STONE, 0.9), ip_risk: 0, culture_risk: 0,
    note: "Yerebatan Sarnıcı: küçük taş giriş köşkü; içeride sütunlu yer altı salonu, sığ su ve yürüme yolu. Mitolojik baş kabartmaları konmadı (figür yok)." },
  hipodrom: { near: dikilitas, far: tallFar("#C49A7A", 0.4), ip_risk: 0, culture_risk: 0,
    note: "Hipodrom ve Dikilitaş: yazısız ve kabartmasız granit dikilitaş; çevrede örme dikilitaş ve burmalı sütun (başsız), spina çizgisi." },
  kapalicarsi: { near: kapalicarsi, far: genFar("kapalicarsi"), // uzak LOD Blender'dan (farLod.gen.ts)
    ip_risk: 0, culture_risk: 0,
    note: "Kapalıçarşı: kubbecikli çatı, taş kapılar, renkli tenteler; dükkân tabelası ve marka yok. İçeride yürünür kapalı sokaklar." },
  misir_carsisi: { near: misirCarsisi, far: genFar("misir_carsisi"), // uzak LOD Blender'dan (farLod.gen.ts)
    ip_risk: 0, culture_risk: 0,
    note: "Mısır Çarşısı: kemerli uzun salon, kubbecikler ve baharat tezgâhları; yazı yok." },
};

// ------------------------------------------------------------------------------------------ CITY-PASS-IST sokak eşyası
/**
 * Yürüme ölçeğinde simit arabası (özgün, yazısız): iki tekerlek, şasi, ahşap dolap, vitrin (opak açık mavi: parsel cam bütçesi),
 * içinde simit halkaları, saçak, itme kolu ve dayanak ayağı. Uzun eksen x; (x, z) karo ortası. 11 kutu.
 */
export function walkSimitCartAt(b: Sink, x: number, z: number) {
  // ACTIVITY-FEEL (B5): tekerlekler şasinin altında (eski: şasinin kenarında, 0,005 değiyordu — yandan bakınca havada)
  for (const s of [-1, 1]) b(x + 0.12, 0.17, z + s * 0.19, 0.34, 0.34, 0.06, "#2F3640", "solid", 0);
  b(x, 0.38, z, 0.8, 0.1, 0.45, "#3F4650", "solid", 0.02);
  b(x - 0.36, 0.165, z, 0.05, 0.33, 0.05, "#3F4650", "solid", 0);
  b(x, 0.58, z, 0.8, 0.3, 0.45, "#B5462E", "solid", 0.03);
  b(x, 0.88, z, 0.74, 0.3, 0.4, "#CFE6F0", "solid", 0.02);
  for (const dx of [-0.2, 0.05, 0.28]) b(x + dx, 0.76, z, 0.2, 0.06, 0.2, "#C68A3E", "solid", 0.04);
  b(x, 1.05, z, 0.86, 0.04, 0.5, "#E9D8A6", "solid", 0.02);
  b(x + 0.43, 0.6, z, 0.1, 0.05, 0.45, "#3F4650", "solid", 0); // itme kolu kasaya geçer
}
/**
 * Yürüme ölçeğinde balık-ekmek teknesi (Eminönü tipi, özgün; yazı/işletme adı yok): su yüzünün altına inen ahşap gövde, yaldız
 * küpeşte, güverte, kor ızgarası (durağan `glow`) ve balıklar, dört dikmeli kırmızı-beyaz tente, kıç süsü, rıhtıma halat.
 * (x, z) gövde ortası; `axis` boy ekseni (3,6); `quaySide` rıhtımın gövdeye göre yanı (−1: −z/−x). 17 kutu.
 */
export function walkFishBoatAt(b: Sink, x: number, z: number, axis: "x" | "z", quaySide: 1 | -1 = -1) {
  const L = 3.6, W = 1.3, HULL = "#7A3B2E", GOLD = "#C9A44C";
  const B = (u: number, y: number, v: number, lu: number, h: number, lv: number, c: string, g: "solid" | "glow" = "solid", j = 0.03) =>
    axis === "x" ? b(x + u, y, z + v, lu, h, lv, c, g, j) : b(x + v, y, z + u, lv, h, lu, c, g, j);
  B(0, -0.25, 0, L - 0.6, 0.5, W, HULL, "solid", 0.04);
  for (const s of [-1, 1]) B(s * (L / 2 - 0.3), -0.22, 0, 0.6, 0.44, W * 0.62, HULL, "solid", 0.04);
  B(0, 0.03, 0, L - 0.5, 0.06, W + 0.06, GOLD, "solid", 0.02);
  B(0, 0.09, 0, L - 0.8, 0.06, W - 0.2, "#B98A5A", "solid", 0.03);
  B(-(L / 2 - 0.15), 0.27, 0, 0.08, 0.5, 0.5, GOLD, "solid", 0.02);
  // ızgara
  B(0.3, 0.37, 0, 1.2, 0.5, 0.6, "#3A3F47", "solid", 0.02);
  B(0.3, 0.635, 0, 1.1, 0.03, 0.5, "#F2793B", "glow", 0);
  for (const du of [-0.15, 0.25, 0.65]) B(du, 0.67, 0, 0.3, 0.04, 0.12, "#B7C3CC", "solid", 0.03);
  // tente
  for (const su of [-1, 1]) for (const sv of [-1, 1]) B(su * 1.1, 0.87, sv * 0.5, 0.06, 1.5, 0.06, "#5B3A29", "solid", 0);
  B(0, 1.65, 0, 2.6, 0.06, 1.3, "#B91C1C", "solid", 0.02);
  B(0, 1.71, 0, 1.6, 0.06, 1.2, "#F8FAFC", "solid", 0.02);
  // rıhtıma halat (küpeşteden rıhtım kenarına)
  B(-0.6, 0.06, quaySide * (W / 2 + 0.15), 0.06, 0.03, 0.3, "#C8B48A", "solid", 0);
}

// ------------------------------------------------------------------------------------------ semt tasarımı
/** Semt yerel karo merkezi (dünya). */
const at = (c: DecorCtx) => ({ x: (li: number) => c.ox + li + 0.5, z: (lj: number) => c.oz + lj + 0.5 });

function tarihiDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  // Hipodrom: spina (alçak taş şerit), örme dikilitaş ve burmalı sütun (katı karolar tasarımda), oval pist kenarı
  b(p.x(23) + 0.5, 0.08, p.z(12), 1.2, 0.16, 13, "#BFB4A0", "solid", 0.04);
  for (let q = 0; q < 6; q++) { const w = 0.9 - q * 0.08; b(p.x(23) + 0.5, 0.45 + q * 0.95, p.z(6), w, 0.96, w, q % 2 ? "#958873" : "#A99C88", "solid", 0.08); }
  b(p.x(23) + 0.5, 5.98, p.z(6), 0.3, 0.6, 0.3, "#958873"); // CITY-PASS-IST: tepe taşı gövdeye oturur (eski: 0,22 havada)
  for (let q = 0; q < 4; q++) b(p.x(23) + 0.5 + (q % 2 ? 0.06 : -0.06), 0.5 + q * 0.6, p.z(17), 0.42, 0.6, 0.42, "#6F5A3A", "solid", 0.05);
  for (const s of [-1, 1]) b(p.x(23) + 0.5 + s * 5.6, 0.06, p.z(12), 0.2, 0.12, 15, "#A89C86", "solid", 0);
  // Sultanahmet Meydanı: sekizgen çeşme köşkü (süs; dinî değil) + banklar + simit arabası
  const fx = p.x(41), fz = p.z(21);
  for (let q = 0; q < 8; q++) { const a = (q / 8) * Math.PI * 2; b(fx + Math.cos(a) * 0.62, 0.8, fz + Math.sin(a) * 0.62, 0.1, 1.6, 0.1, "#E9E1D0"); }
  oct(b, fx, 1.68, fz, 1.6, 0.16, "#5F7F6E");
  dome(b, fx, 1.76, fz, 0.6, 0.5, "#5F7F6E", 2);
  oct(b, fx, 0.3, fz, 0.6, 0.6, "#D7CDBB");
  for (const x of [36, 46]) walkBenchAt(b, p.x(x), p.z(24), "-z", 1.4, "#8B6B4A", "#3F3A33");
  walkSimitCartAt(b, p.x(31), p.z(19)); // CITY-PASS-IST: tekerlekli simit arabası (eski: havada iki kutu)
  // Sarayburnu sahil korkuluğu (kuzeydoğu; Topkapı surunun önü): dikmeli (CITY-PASS-IST: eski korkuluk havadaydı), balık-ekmek
  // tezgâhının arkasında (li 53–56) açıklık
  for (const [a, e] of [[50, 53], [57, 66]] as const) {
    b((c.ox + a + c.ox + e) / 2, 0.45, p.z(43) + 0.45, e - a, 0.08, 0.06, "#3F4650", "solid", 0);
    for (let li = a; li <= e; li += 2) b(c.ox + li, 0.22, p.z(43) + 0.45, 0.06, 0.44, 0.06, "#3F4650", "solid", 0);
  }
  // gizli köşeler: duvar çeşmesi (yalak) ve basamakta güneşlenen kedi
  b(p.x(8) - 0.42, 0.5, p.z(40), 0.12, 1.0, 0.8, "#D7CDBB"); b(p.x(8) - 0.3, 0.1, p.z(40), 0.34, 0.2, 0.66, "#BFB4A0");
  b(p.x(8) - 0.3, 0.22, p.z(40), 0.28, 0.04, 0.58, "#3E86AE", "water", 0); // CITY-PASS-IST: yalak taş tekne üstünde (eski: havada)
  b(p.x(60), 0.12, p.z(6) + 0.3, 0.32, 0.18, 0.16, "#D9822B"); b(p.x(60) + 0.14, 0.24, p.z(6) + 0.3, 0.12, 0.12, 0.12, "#D9822B");
  // tramvay durağı bankı (eski ritüel bankı; balık-ekmek artık iskeledeki teknede)
  walkBenchAt(b, p.x(32), p.z(46), "-z", 1.4, "#8B6B4A", "#3F3A33");
  // CITY-PASS-IST (ritüel mekânı, CORE-WALK `city/venues.ts`): Eminönü rıhtımında balık-ekmek — tezgâh (li 54–56, lj 43) suya
  // sırtını verir, arkasında rıhtıma bağlı ızgara teknesi; önde tabureler, arkada masa. `balik_ekmek` sipariş karosu (55, 42).
  placeVenue(b, "food_stand", p.x(EMIN_VENUE[0]), p.z(EMIN_VENUE[1]), "-z", "walk");
  walkFishBoatAt(b, p.x(55), c.oz + 44.75, "x");
  // simit arabası iskele başında (48, 41). ACTIVITY-FEEL (B5): `simit_marti` arabanın önündeki karoya (48, 42) bağlı; eskiden
  // iskele durağına (50, 43) bağlıydı, araba (47, 41) 3,6 karo uzaktaydı — arabanın yanındaki oyuncu menzil dışında, simit alamıyordu.
  // (Durağın 1 karoluk halkası meydan olarak açık kalır: araba halkanın dışında.)
  walkSimitCartAt(b, p.x(48), p.z(41));
  return out;
}

/**
 * Tarihi Yarımada (72 × 48; şehir karosu [−36, −48]). Yerel yerleşim (li batı → doğu, lj güney → kuzey):
 *  Kapalıçarşı [3, 20], Mısır Çarşısı [20, 38], Yerebatan [26, 30], Hipodrom/Dikilitaş [23, 11] (meydan li 16–31, lj 4–19),
 *  Sultanahmet [38, 4] + batı avlusu (li 32–37), Ayasofya [33, 28], Topkapı [52, 22]; doğuda Marmara/Boğaz suyu (li 66+),
 *  kuzeydoğuda Sarayburnu kıyısı (lj 44+), kuzey kenarı (lj 47, li 36–47) varış iskelesine bağlı.
 */
export const TARIHI_DESIGN: DistrictDesign = {
  water: [[66, 0, 6, 48], [48, 44, 18, 4]],
  // CITY-PASS-IST (REAL-PATH): kuzey kenarı (lj 46–47, li 36–41) iki karo açık kalır (eski: bina parseli tek karoluk geçit bırakıyordu)
  plaza: [[16, 4, 16, 16], [32, 17, 18, 10], [33, 5, 5, 10], [47, 38, 17, 5], [36, 46, 6, 2]],
  solid: [
    // Sultanahmet avlu duvarları (kapı aralığı lj 9–10), Hipodrom anıtları, meydan çeşme köşkü
    [32, 4, 1, 5], [32, 11, 1, 5], [33, 4, 5, 1], [33, 15, 5, 1],
    [23, 6, 2, 1], [23, 17, 2, 1], [41, 21, 1, 1],
    // CITY-PASS-IST: balık-ekmek tezgâhı + masası (mekân), simit arabaları
    ...venueSolidTiles("food_stand", "-z").map(([di, dj]): [number, number, number, number] => [EMIN_VENUE[0] + di, EMIN_VENUE[1] + dj, 1, 1]),
    [31, 19, 1, 1], [48, 41, 1, 1],
  ],
  hidden: [[8, 40], [60, 6]],
  decor: tarihiDecor,
};
