/**
 * İstanbul şehir haritası: **Galata – Karaköy – Beyoğlu** landmarkları ve semt tasarımı.
 *
 * Galata Kulesi gerçek oranına yakın (gövde çapı : yükseklik ≈ 1 : 4, konik kurşun külah, seyir galerisi); iç mekânı
 * INTERIOR-VIEW'un gerçekçi Galata tarifidir (spiral merdiven, sergi katı, seyir galerisi). Karaköy rıhtımı, Tünel istasyonu,
 * İstiklal Caddesi (nostaljik tramvay rayı ortada, eklektik cepheler, pasaj) ve Taksim (maksem yapısı, meydan, Gezi ağaçları).
 * Anıt heykelleri, tabelalar, marka ve bayrak yok.
*/
import type { Block } from "../../../scenes";
import { ISTANBUL_LANDMARKS as L } from "../../styles/istanbul";
import { dome, oct, sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel } from "../../../citymap/design";
import { plane, walkFishBoatAt } from "./tarihi";
import { walkBenchAt } from "../../kit";
import { placeVenue, venueSolidTiles } from "../../venues";

const OPEN = L.opening;
/** CITY-PASS-IST: Karaköy balık-ekmek mekânının tezgâh karosu (semt yerel); sipariş karosu bir kuzeyde (40, 1). */
export const KARAKOY_VENUE: [number, number] = [40, 0];

// ------------------------------------------------------------------------------------------ Galata Kulesi (5 × 5, h 15)
/** (K2 simge eğrisi): kule kaidenin üstünden (y 0,6) bütün ayrıntısıyla orantılı ×`GALATA_K` küçültülür (eski tepe 20,1 →
 * ≈ 15; eğri 67 m → 13,8 ±%25; şehir içi sıra: camilerden uzun, köprü kulesinden kısa). Kapı insan ölçüsünde kalır.*/
const GALATA_K = 0.74, GALATA_Y0 = 0.6;
const scaledSink = (b: ReturnType<typeof sink>, X: number, Z: number, k: number, y0: number): ReturnType<typeof sink> =>
  (x, y, z, w, h, d, col, g, j) => b(X + (x - X) * k, y0 + (y - y0) * k, Z + (z - Z) * k, w * k, h * k, d * k, col, g, j);
function galataKulesi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b0 = sink(out);
  const X = c.cx, Z = c.cz, b = scaledSink(b0, X, Z, GALATA_K, GALATA_Y0);
  b0(X, 0.3, Z, 5, 0.6, 5, L.hillStone, "solid", 0.05);
  oct(b, X, 7.2, Z, 4.3, 13.2, L.galata);
  oct(b, X, 1.2, Z, 4.5, 1.2, L.galata2); // CITY-PASS-IST: kalın taş taban kuşağı
  for (const y of [4.6, 9.4]) oct(b, X, y, Z, 4.38, 0.16, L.galata2);
  // dar mazgal pencereler (dört yüz × üç kat) ve güneydeki kapı
  for (const y of [3.2, 6.8, 11.0]) for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    if (dz === -1 && y < 4) continue;
    b(X + dx * 2.16, y, Z + dz * 2.16, dx ? 0.04 : 0.32, 0.8, dz ? 0.04 : 0.32, OPEN, "solid", 0);
  }
  // kapı insan ölçüsünde (küçültülmez), küçülen gövdenin yüzünde
  b0(X, 1.3, Z - 2.25 * GALATA_K - 0.02, 0.8, 1.4, 0.04, OPEN, "solid", 0); // taban kuşağının yüzünde
  // seyir galerisi: konsollu bilezik, korkuluk, kemerli üst gövde (CITY-PASS-IST: 8 taş konsol + 8 korkuluk dikmesi)
  for (let q = 0; q < 8; q++) { const a = (q / 8) * Math.PI * 2; b(X + Math.cos(a) * 2.2, 13.6, Z + Math.sin(a) * 2.2, 0.36, 0.42, 0.36, L.galata2, "solid", 0.02); }
  oct(b, X, 13.95, Z, 4.9, 0.3, L.galata2);
  for (let q = 0; q < 8; q++) { const a = ((q + 0.5) / 8) * Math.PI * 2; b(X + Math.cos(a) * 2.3, 14.3, Z + Math.sin(a) * 2.3, 0.08, 0.42, 0.08, "#3A3F47", "solid", 0); }
  oct(b, X, 14.55, Z, 4.85, 0.08, "#3A3F47", 0);
  oct(b, X, 14.9, Z, 3.7, 1.5, L.galataTop);
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) for (const o of [-0.55, 0.55]) {
    b(X + dx * 1.86 + (dz ? o : 0), 14.95, Z + dz * 1.86 + (dx ? o : 0), dz ? 0.34 : 0.04, 0.9, dz ? 0.04 : 0.34, OPEN, "solid", 0);
  }
  // LANDMARK-FIDELITY (istanbul.md §4): gece kemerli üst katın dört yüzünde sıcak pencere ışığı
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) b(X + dx * 1.9, 14.95, Z + dz * 1.9, dz ? 0.5 : 0.06, 0.4, dz ? 0.06 : 0.5, "#FFE2A0", "glow", 0);
  // konik kurşun külah + tepe — CITY-PASS-IST (REAL-SUPPORT): külah kemerli katın üstüne (15,65) oturur (eski: 0,2 havada)
  [4.0, 3.2, 2.4, 1.6, 0.85].forEach((w, q) => oct(b, X, 15.65 + q * 0.75 + 0.375, Z, w, 0.76, L.galataCap, 0.02));
  // külahta dört ana yönde çatı penceresi (kaynak: konide 4 pencere) + yaldız tepe + gece kırmızı ikaz ışığı
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    b(X + dx * 1.62, 16.6, Z + dz * 1.62, 0.5, 0.55, 0.5, L.galataCap, "solid", 0.02);
    b(X + dx * 1.88, 16.55, Z + dz * 1.88, dz ? 0.26 : 0.04, 0.32, dz ? 0.04 : 0.26, "#E9D9A8", "solid", 0);
  }
  b(X, 19.65, Z, 0.12, 0.5, 0.12, L.finial, "solid", 0);
  b(X, 19.98, Z, 0.16, 0.16, 0.16, "#D7263D", "glow", 0);
  return out;
}
function galataFar(c: LandmarkCtx): Block[] {
  const k = GALATA_K, y = (v: number) => GALATA_Y0 + (v - GALATA_Y0) * k;
  return [
    { p: [c.cx, y(7.2), c.cz], s: [3.8 * k, 13.2 * k, 3.8 * k], c: L.galata, g: "solid", j: 0 },
    { p: [c.cx, y(14.9), c.cz], s: [4.2 * k, 1.6 * k, 4.2 * k], c: L.galataTop, g: "solid", j: 0 },
    { p: [c.cx, y(17.5), c.cz], s: [2.0 * k, 3.7 * k, 2.0 * k], c: L.galataCap, g: "solid", j: 0 },
  ];
}

// ------------------------------------------------------------------------------------------ Karaköy rıhtım binası (8 × 3)
function karakoy(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, WALL = "#E8DCC6";
  b(X, 1.3, Z, c.w, 2.6, c.d, WALL);
  b(X, 2.7, Z, c.w + 0.4, 0.2, c.d + 0.4, "#6E7A86", "solid", 0.02);
  b(X, 3.05, Z, c.w - 1.2, 0.5, c.d - 0.8, "#6E7A86", "solid", 0.02);
  for (let q = 0; q < 6; q++) b(c.x0 + 0.9 + q * 1.24, 1.3, c.z0 - 0.02, 0.7, 1.4, 0.04, OPEN, "solid", 0);
  for (const s of [-1, 1]) { b(X + s * 3.2, 3.4, Z, 0.9, 1.4, 0.9, WALL); b(X + s * 3.2, 4.2, Z, 1.1, 0.2, 1.1, "#6E7A86"); }
  // rıhtıma uzanan saçak ve direkleri (güney)
  b(X, 2.2, c.z0 - 0.9, c.w - 1, 0.1, 1.4, "#3F6E74", "solid", 0.02);
  for (const s of [-1, 0, 1]) b(X + s * 3.2, 1.1, c.z0 - 1.5, 0.1, 2.2, 0.1, "#2F3640", "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ Tünel üst istasyonu (5 × 4)
function tunel(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, WALL = "#D9C7A6";
  b(X, 1.4, Z, c.w, 2.8, c.d, WALL);
  b(X, 2.9, Z, c.w + 0.2, 0.2, c.d + 0.2, "#A88F6A", "solid", 0.02);
  b(X, 3.25, Z, c.w - 0.6, 0.5, c.d - 0.6, "#556270", "solid", 0.02);
  for (let q = 0; q < 3; q++) b(c.x0 + 1 + q * 1.5, 1.6, c.z0 + c.d + 0.02, 0.6, 1.0, 0.04, OPEN, "solid", 0);
  b(c.x0 + c.w + 0.02, 1.0, c.z0 + c.d - 0.6, 0.04, 1.8, 0.9, OPEN, "solid", 0);
  b(c.x0 + 0.6, 3.7, c.z0 + 0.6, 0.4, 0.6, 0.4, "#8A7A62");
  return out;
}

// ------------------------------------------------------------------------------------------ İstiklal pasajı (5 × 6; cephe batıya, caddeye)
function istiklal(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, WALL = "#E9D8C0", TRIM = "#C9B08A";
  b(X, 3.0, Z, c.w, 6.0, c.d, WALL);
  b(X, 6.1, Z, c.w + 0.2, 0.2, c.d + 0.2, TRIM, "solid", 0.02);
  b(X, 6.5, Z, c.w - 0.8, 0.6, c.d - 0.8, "#5F6B78", "solid", 0.02);
  // pasaj kemeri (zemin) ve cumbalar (üst katlar), pencere ızgarası
  b(c.x0 + 0.2, 1.6, Z, 0.5, 3.2, 2.0, TRIM);
  b(c.x0 - 0.02, 1.2, Z, 0.04, 2.2, 1.4, OPEN, "solid", 0);
  for (const dz of [-2, 2]) {
    b(c.x0 - 0.3, 3.9, Z + dz, 0.6, 2.4, 1.3, WALL);
    b(c.x0 - 0.62, 3.9, Z + dz, 0.04, 1.6, 0.9, OPEN, "solid", 0);
  }
  for (const y of [2.6, 3.9, 5.2]) for (const dz of [-0.9, 0.9]) b(c.x0 - 0.02, y, Z + dz, 0.04, 0.8, 0.5, OPEN, "solid", 0);
  // köşe kulesi kubbeciği
  oct(b, c.x0 + 0.8, 6.9, c.z0 + c.d - 0.8, 1.2, 1.2, WALL);
  dome(b, c.x0 + 0.8, 7.5, c.z0 + c.d - 0.8, 0.6, 0.6, "#5F6B78", 2);
  return out;
}

// ------------------------------------------------------------------------------------------ Taksim maksemi (3 × 3)
function taksim(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, ST = "#D2C6B0";
  oct(b, X, 1.2, Z, 2.8, 2.4, ST);
  oct(b, X, 2.5, Z, 3.0, 0.2, "#B9AC94");
  dome(b, X, 2.6, Z, 1.2, 0.9, L.hsLead, 2);
  b(X, 0.8, c.z0 + 0.08, 0.8, 1.2, 0.04, OPEN, "solid", 0); // CITY-PASS-IST: kapı maksem duvarının yüzünde (eski: 0,1 önünde)
  // CITY-PASS-IST (REAL-SUPPORT): çeşme teknesi zeminde, su teknenin içinde (eski: tekne 0,1 havada)
  b(X, 0.2, c.z0 - 0.6, 1.4, 0.4, 0.8, "#BFB4A0");
  b(X, 0.42, c.z0 - 0.6, 1.1, 0.05, 0.55, "#3E86AE", "water", 0);
  return out;
}

const boxFar = (color: string) => (c: LandmarkCtx): Block[] => [{ p: [c.cx, c.h / 2, c.cz], s: [c.w, c.h, c.d], c: color, g: "solid", j: 0 }];

export const BEYOGLU_LANDMARKS: Record<string, LandmarkModel> = {
  galata_kulesi: { near: galataKulesi, far: galataFar, ip_risk: 0, culture_risk: 0,
    note: "Galata Kulesi: taş silindir gövde, kuşaklar, seyir galerisi ve konik külah; gerçek orana yakın (çap : yükseklik ≈ 1 : 4). İçeride INTERIOR-VIEW Galata tarifi." },
  karakoy_rihtim: { near: karakoy, far: boxFar("#E8DCC6"), ip_risk: 0, culture_risk: 0,
    note: "Karaköy rıhtımı: genel tarihî iskele/gümrük binası tipolojisi, saçak ve babalar; işletme adı ve tabela yok." },
  tunel: { near: tunel, far: boxFar("#D9C7A6"), ip_risk: 0, culture_risk: 0,
    note: "Tünel üst istasyonu: 19. yüzyıl taş istasyon tipolojisi; füniküler kısa yer üstü hat olarak gösterilir. İşletme logosu yok." },
  istiklal: { near: istiklal, far: boxFar("#E9D8C0"), ip_risk: 0, culture_risk: 0,
    note: "İstiklal Caddesi: eklektik cepheli pasaj (cumbalar, kemer), ortada nostaljik tramvay rayı; mağaza tabelası, marka ve yazı yok." },
  taksim: { near: taksim, far: boxFar("#D2C6B0"), ip_risk: 0, culture_risk: 0,
    note: "Taksim: sekizgen taş maksem (su dağıtım yapısı) ve meydan. Cumhuriyet Anıtı figürlü olduğu için konmadı (gerçek kişi tasviri yok); bayrak yok." },
};

// ------------------------------------------------------------------------------------------ semt tasarımı
const at = (c: DecorCtx) => ({ x: (li: number) => c.ox + li + 0.5, z: (lj: number) => c.oz + lj + 0.5 });

function beyogluDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  // Karaköy rıhtımı: güney kenar taş bordür ve babalar, banklar
  b(c.ox + 54, -0.2, c.oz + 0.06, 36, 0.5, 0.12, "#9E988D", "solid", 0.02);
  for (let li = 38; li < 72; li += 4) b(p.x(li), 0.18, c.oz + 0.25, 0.22, 0.36, 0.22, "#3F4650", "solid", 0);
  for (const li of [58, 66]) walkBenchAt(b, p.x(li), p.z(2), "-z", 1.4, "#8B6B4A", "#3F3A33");
  // Galata basamakları (Yüksek Kaldırım benzeri şeritler)
  for (let lj = 7; lj <= 12; lj++) b(p.x(36), 0.02, c.oz + lj + 0.15, 3, 0.04, 0.12, "#B9AC94", "solid", 0);
  // İstiklal: tramvay katener direkleri ve fenerler (iki yanda, 6 karoda bir)
  for (let lj = 24; lj <= 40; lj += 6) for (const s of [-1, 1]) {
    b(p.x(26) + s * 2.9, 1.3, p.z(lj), 0.08, 2.6, 0.08, "#2F3640", "solid", 0);
    if (s < 0) b(p.x(26), 2.55, p.z(lj), 5.8, 0.04, 0.04, "#2F3640", "solid", 0);
  }
  for (const lj of [30, 36]) b(p.x(26) - 2.9, 2.2, p.z(lj), 0.26, 0.18, 0.26, "#FFE2A0", "glow", 0); // CITY-PASS-IST: fener direğe asılı
  // Taksim meydanı: yuvarlak çiçek tarhı ve çınarlar
  oct(b, p.x(20), 0.15, p.z(44), 3.2, 0.3, "#7C9F5A");
  for (const [li, lj] of [[14, 46], [40, 46], [16, 41]]) plane(b, p.x(li), p.z(lj), 0.9);
  // gizli köşeler: merdiven altında kedi, Gezi'de kuş evi
  b(p.x(8) + 0.3, 0.1, p.z(12), 0.3, 0.16, 0.14, "#4B4B4B"); b(p.x(8) + 0.42, 0.22, p.z(12), 0.12, 0.12, 0.12, "#4B4B4B");
  b(p.x(52) + 0.38, 0.6, p.z(44), 0.06, 1.2, 0.06, "#6B4A2E", "solid", 0); b(p.x(52) + 0.38, 1.3, p.z(44), 0.3, 0.3, 0.3, "#C9A27C");
  // iskele bankı (eski ritüel bankı; balık-ekmek artık iskelenin batısındaki teknede)
  walkBenchAt(b, p.x(44), p.z(1), "-z", 1.4, "#8B6B4A", "#3F3A33");
  // CITY-PASS-IST (ritüel mekânı, CORE-WALK `city/venues.ts`): Karaköy rıhtımında balık-ekmek — tezgâh (li 39–41, lj 0) denize
  // sırtını verir, arkasında rıhtıma bağlı ızgara teknesi; önde tabureler, arkada masa. `balik_ekmek` sipariş karosu (40, 1).
  placeVenue(b, "food_stand", p.x(KARAKOY_VENUE[0]), p.z(KARAKOY_VENUE[1]), "+z", "walk");
  walkFishBoatAt(b, p.x(40), c.oz - 0.75, "x", 1);
  return out;
}

const B = (i0: number, j0: number, w: number, d: number, h: number, wall: string, roof = "#5F6B78") => ({ i0, j0, w, d, h, wall, roof });

/**
 * Galata – Karaköy – Beyoğlu (72 × 48; şehir karosu [−36, 48]). Güney kenarı (li 36+) denize bakan Karaköy rıhtımı; batı
 * yarısı (li < 36) Haliç semtinin kuzey kıyısına bağlı (Galata Köprüsü varışı li 28–34). Galata Kulesi [34, 14] (kapı [36, 13],
 * basamaklar li 35–37), Tünel alt durağı (26, 10) → üst durağı (26, 22), İstiklal (li 23–29, lj 22–41) → Taksim (lj 40–47).
 */
export const BEYOGLU_DESIGN: DistrictDesign = {
  pave: [[23, 22, 7, 20], [35, 7, 3, 6]],
  plaza: [[36, 0, 36, 4], [12, 40, 30, 8], [19, 22, 4, 2]],
  park: [[42, 34, 18, 14]],
  buildings: [
    B(18, 24, 5, 3, 5.2, "#E7BBA8"), B(18, 28, 5, 3, 6.4, "#C9DCCB"), B(18, 32, 5, 3, 5.6, "#F0D9B5"), B(18, 36, 5, 3, 4.8, "#BACBDD"),
    B(30, 24, 5, 4, 5.8, "#E9D9C4"), B(30, 38, 5, 2, 5.0, "#D8B4A0"),
  ],
  // CITY-PASS-IST: balık-ekmek tezgâhı + masası
  solid: venueSolidTiles("food_stand", "+z").map(([di, dj]): [number, number, number, number] => [KARAKOY_VENUE[0] + di, KARAKOY_VENUE[1] + dj, 1, 1]),
  hidden: [[8, 12], [52, 44]],
  decor: beyogluDecor,
};
