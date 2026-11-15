/**
 * İstanbul şehir haritası: **Boğaz – Avrupa** landmarkları ve semt tasarımı.
 *
 * Avrupa yakası kıyı şeridi (li 0–29) ve Boğaz suyu (li 30+): Dolmabahçe Sarayı (yalnız dış cephe: deniz cephesi sütunları,
 * orta tören salonu kubbesi) ve saat kulesi (rakamsız kadranlar), Ortaköy camisi (yalnız dış görünüm; iç mekân kapalı, kutsal
 * bölge) ve Boğaz Köprüsü (Avrupa ayağı karada; açıklık ve Anadolu ayağı suyun üstünde, vapurlar altından geçer), Rumeli
 * Hisarı (üç büyük kule, surlar; iç mekânda yürünür sur yolu). Bayrak, tuğra, kitabe ve marka yok.
*/
import type { Block } from "../../../scenes";
import { ISTANBUL_LANDMARKS as L } from "../../styles/istanbul";
import { cable, dome, oct, sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkGarden, type LandmarkModel } from "../../../citymap/design";
import type { CityTile } from "../../../citymap/format";
import { minaretN, plane, windowDrum } from "./tarihi";
import { walkBenchAt, walkMarketStallAt } from "../../kit";
import { placeVenue, venueSolidTiles } from "../../venues";
import { genFar } from "./farLod.gen";

const OPEN = L.opening, WHITE = "#EEE8DC", TRIM = "#D8CDB6", LEAD = "#8E98A1", GLASS_C = "#5D7A93";
/** CITY-PASS-IST: Rumeli Hisarı çay bahçesinin tezgâh karosu (semt yerel); sipariş karosu bir doğuda (26, 80). */
export const RUMELI_VENUE: [number, number] = [25, 80];

// ------------------------------------------------------------------------------------------ Dolmabahçe Sarayı (8 × 16; deniz cephesi doğuda)
/** LANDMARK-FIDELITY (istanbul.md §7): uzun, simetrik, beyaz mermer görünümlü üç katlı deniz cephesi (barok/neoklasik + Osmanlı):
 *  kat silmeleri, her bölmede çift sütun/pilastr ve üç kat pencere, uçlarda ve ortada öne çıkan alınlıklı köşkler, çatı
 *  korkuluğu; ortada yüksek tören salonu kütlesi ve kurşun kubbesi; kara yanında saltanat kapısı. Arma, tuğra, yazı yok. */
function dolmabahce(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, X = c.cx, Z = c.cz, fx = x0 + w;
  b(X, 2.2, Z, w - 0.4, 4.4, d - 0.4, WHITE);
  b(X, 4.5, Z, w - 0.1, 0.2, d - 0.1, TRIM, "solid", 0.02);
  b(X, 4.75, Z, w - 0.8, 0.3, d - 0.8, LEAD, "solid", 0.02);
  b(fx - 0.2, 4.72, Z, 0.12, 0.24, d - 0.6, TRIM, "solid", 0.02); // çatı korkuluğu (deniz yanı)
  // orta tören salonu: yüksek kütle + pencereli kasnak + kubbe
  b(X, 3.2, Z, w - 2, 6.4, 5, WHITE);
  b(X, 6.5, Z, w - 1.7, 0.2, 5.3, TRIM, "solid", 0.02);
  for (const o of [-1.4, 0, 1.4]) b(X + (w - 2) / 2 + 0.02, 5.4, Z + o, 0.04, 1.0, 0.6, GLASS_C, "solid", 0);
  windowDrum(b, X, 6.6, Z, 3.8, 0.5, 12, WHITE, "#5E4630");
  dome(b, X, 7.22, Z, 2.0, 1.2, LEAD, 3);
  // deniz cephesi: kat silmeleri, bölme başına çift sütun, üç kat pencere
  const bays = 9, bw = (d - 0.6) / bays;
  for (const y of [1.45, 2.95]) b(fx - 0.22, y, Z, 0.08, 0.12, d - 0.4, TRIM, "solid", 0.02);
  for (let q = 0; q <= bays; q++) for (const o of [-0.13, 0.13]) b(fx - 0.14, 2.2, z0 + 0.3 + q * bw + o, 0.16, 4.4, 0.14, TRIM, "solid", 0.02);
  for (let q = 0; q < bays; q++) for (const y of [0.8, 2.2, 3.7]) b(fx - 0.2, y, z0 + 0.3 + (q + 0.5) * bw, 0.04, 0.85, bw * 0.5, GLASS_C, "solid", 0);
  // öne çıkan köşkler (iki uç + orta) ve alınlıklar
  for (const zc of [z0 + 1.2, Z, z0 + d - 1.2]) {
    b(fx - 0.15, 2.3, zc, 0.3, 4.6, 1.8, WHITE);
    for (const [y, ww] of [[4.85, 1.9], [5.1, 1.3], [5.32, 0.7]] as const) b(fx - 0.15, y, zc, 0.3, 0.25, ww, TRIM, "solid", 0.02);
  }
  // kara yanı (batı) saltanat kapısı: iki yanda sütun, üstte kemer ve taç
  b(x0 - 0.3, 2.2, z0 + 2.5, 0.6, 4.4, 2.4, TRIM);
  b(x0 - 0.62, 1.4, z0 + 2.5, 0.04, 2.4, 1.2, OPEN, "solid", 0);
  for (const o of [-0.95, 0.95]) b(x0 - 0.66, 2.0, z0 + 2.5 + o, 0.14, 4.0, 0.16, WHITE, "solid", 0.02);
  b(x0 - 0.3, 4.6, z0 + 2.5, 0.5, 0.4, 1.4, TRIM, "solid", 0.02);
  return out;
}

// ------------------------------------------------------------------------------------------ Dolmabahçe saat kulesi (2 × 2, h 10,5)
/** (K2 simge eğrisi): kule bütün ayrıntısıyla ×`SAAT_K` büyütülür (eski tepe 8,9 → 10,5; eğri 27 m → 10,0). Şehir içi sıra:
 * gerçekte Kız Kulesi'nden ×1,17 uzun → modelde de uzun. Yatayda 2 × 2 ayak izi taşmasın diye en ×`SAAT_KXZ`, en çok 2.*/
const SAAT_K = 1.18, SAAT_KXZ = 1.05;
function saatKulesi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b0 = sink(out);
  const X = c.cx, Z = c.cz;
  const b: typeof b0 = (x, y, z, w, h, d, col, g, j) =>
    b0(X + (x - X) * SAAT_KXZ, y * SAAT_K, Z + (z - Z) * SAAT_KXZ, Math.min(c.w, w * SAAT_KXZ), h * SAAT_K, Math.min(c.d, d * SAAT_KXZ), col, g, j);
  b(X, 1.2, Z, 1.9, 2.4, 1.9, WHITE);
  b(X, 2.45, Z, 2.0, 0.1, 2.0, TRIM, "solid", 0.02);
  b(X, 3.5, Z, 1.6, 2.0, 1.6, WHITE);
  b(X, 4.55, Z, 1.7, 0.1, 1.7, TRIM, "solid", 0.02);
  b(X, 5.4, Z, 1.4, 1.6, 1.4, WHITE);
  // rakamsız kadranlar ve ibreler (dört yüz)
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    b(X + dx * 0.71, 5.45, Z + dz * 0.71, dx ? 0.04 : 0.9, 0.9, dz ? 0.04 : 0.9, "#BBAE86", "glow", 0); // LANDMARK-FIDELITY: gece içten aydınlık kadran
    b(X + dx * 0.74, 5.55, Z + dz * 0.74, dx ? 0.03 : 0.06, 0.36, dz ? 0.03 : 0.06, "#2F2A25", "solid", 0);
  }
  // LANDMARK-FIDELITY (istanbul.md §7): dört katlı neo-barok kule — alt iki katta köşe pilastrları ve kemerli pencereler, kat
  // köşelerinde taş babalar (pinakl), kadran katının üstünde pencereli fener katı
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b(X + sx * 0.88, 1.2, Z + sz * 0.88, 0.22, 2.4, 0.22, TRIM, "solid", 0.02);
    b(X + sx * 0.74, 3.5, Z + sz * 0.74, 0.2, 2.0, 0.2, TRIM, "solid", 0.02);
    for (const [y, r] of [[2.68, 0.88], [4.76, 0.74]] as const) b(X + sx * r, y, Z + sz * r, 0.18, 0.36, 0.18, TRIM, "solid", 0.02);
  }
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    b(X + dx * 0.96, 1.3, Z + dz * 0.96, dx ? 0.04 : 0.4, 1.0, dz ? 0.04 : 0.4, OPEN, "solid", 0);
    b(X + dx * 0.81, 3.6, Z + dz * 0.81, dx ? 0.04 : 0.36, 0.9, dz ? 0.04 : 0.36, OPEN, "solid", 0);
    b(X + dx * 0.51, 6.6, Z + dz * 0.51, dx ? 0.04 : 0.3, 0.5, dz ? 0.04 : 0.3, OPEN, "solid", 0);
  }
  b(X, 6.6, Z, 1.0, 0.8, 1.0, WHITE);
  dome(b, X, 7.0, Z, 0.55, 0.7, LEAD, 2);
  b(X, 8.3, Z, 0.1, 1.2, 0.1, L.finial, "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ Ortaköy camisi (4 × 4; kutsal)
/** LANDMARK-FIDELITY (istanbul.md §8): kıyıda kare ibadet bölümü (19. yy eklektik/neo-barok): köşelerde kalın pilastr kuleleri,
 *  her yüzde iki katlı iri kemerli cam pencereler, korniş, pencereli kasnak (gece içten ışık), kurşun kubbe; kara yanında iki katlı
 *  hünkâr kasrı ve iki yanında korint başlığını andıran tek şerefeli iki ince minare. Alem, yazı yok; iç mekân kapalı. */
function ortakoy(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0 } = c, X = c.cx + 0.25, Z = c.cz, GL = "#7FA9C2";
  b(c.cx, 0.25, Z, 4, 0.5, 4, "#CFC6B4");
  b(X, 2.0, Z, 3.0, 3.0, 3.0, WHITE);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b(X + sx * 1.42, 2.2, Z + sz * 1.42, 0.44, 3.4, 0.44, TRIM);
    b(X + sx * 1.42, 4.0, Z + sz * 1.42, 0.3, 0.2, 0.3, TRIM, "solid", 0.02);
  }
  // iri kemerli pencereler: üç yüzde (deniz + iki yan) iki kat; kemer başı ayrı küçük kutu
  for (const [dx, dz] of [[1, 0], [0, 1], [0, -1]]) for (const o of [-0.62, 0.62]) {
    const px = X + dx * 1.52 + (dz ? o : 0), pz = Z + dz * 1.52 + (dx ? o : 0);
    b(px, 1.55, pz, dz ? 0.62 : 0.04, 1.3, dz ? 0.04 : 0.62, GL, "solid", 0);
    b(px, 2.3, pz, dz ? 0.4 : 0.04, 0.2, dz ? 0.04 : 0.4, GL, "solid", 0);
    b(px, 2.95, pz, dz ? 0.44 : 0.04, 0.7, dz ? 0.04 : 0.44, GL, "solid", 0);
  }
  b(X, 3.58, Z, 3.3, 0.16, 3.3, TRIM, "solid", 0.02);
  windowDrum(b, X, 3.66, Z, 2.5, 0.6, 12, WHITE);
  dome(b, X, 4.38, Z, 1.3, 1.3, LEAD, 3);
  b(X, 5.7, Z, 0.3, 0.06, 0.3, LEAD);
  // hünkâr kasrı (kara yanı) + çatısı
  b(x0 + 0.55, 1.4, Z, 1.0, 1.8, 2.2, WHITE);
  b(x0 + 0.55, 2.38, Z, 1.15, 0.16, 2.35, LEAD, "solid", 0.02);
  for (const o of [-0.5, 0.5]) b(x0 + 0.04, 1.5, Z + o, 0.04, 0.8, 0.36, GL, "solid", 0);
  for (const z of [z0 + 0.35, z0 + c.d - 0.35]) minaretN(b, x0 + 0.35, z, 6.3, 1, WHITE, LEAD, 0.3);
  return out;
}

// ------------------------------------------------------------------------------------------ Boğaz Köprüsü (Avrupa ayağı 3 × 3)
const SPAN = 38, TOWER_H = 20, DECK_Y = 7.4;
function bogazKoprusu(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, zs = [c.z0 + 0.5, c.z0 + c.d - 0.5], xe = X + SPAN, C = "#C9CED4", K = "#D3D8DE";
  // güverte (Ortaköy üstünden yaklaşım viyadüğü → açıklık → Anadolu yakası), korkuluklar
  b(X + (SPAN - 14) / 2 + 4, DECK_Y, Z, SPAN + 22, 0.3, 2.2, "#99A2AC", "solid", 0.02);
  for (const z of zs) b(X + (SPAN - 14) / 2 + 4, DECK_Y + 0.3, z, SPAN + 22, 0.3, 0.08, C, "solid", 0);
  b(X - 14, DECK_Y / 2, Z, 1.0, DECK_Y, 1.6, C);
  b(X - 7, DECK_Y / 2, Z, 0.8, DECK_Y, 1.2, C);
  // LANDMARK-FIDELITY (istanbul.md §6): portal kuleler — iki kutu ayak (yukarı doğru incelir) + üç yatay kutu kiriş; kule tepesinde
  // kablo eyer başlığı. Güverte altında koyu kutu kiriş kuşağı.
  for (const x of [X, xe]) {
    for (const z of zs) {
      b(x, DECK_Y / 2, z, 0.9, DECK_Y, 0.9, C, "solid", 0.02);
      b(x, (DECK_Y + TOWER_H) / 2, z, 0.7, TOWER_H - DECK_Y, 0.7, C, "solid", 0.02);
      b(x, TOWER_H + 0.12, z, 0.9, 0.24, 0.5, "#AEB5BD", "solid", 0.02);
    }
    for (const y of [DECK_Y - 0.3, 14, TOWER_H - 0.3]) b(x, y, Z, 0.7, 0.6, c.d, C, "solid", 0.02);
  }
  b(X + (SPAN - 14) / 2 + 4, DECK_Y - 0.28, Z, SPAN + 22, 0.26, 1.8, "#7D8690", "solid", 0.02);
  // ana kablolar (sarkık, sık kademe: kesintisiz eğri), yan açıklık kabloları, DÜŞEY askılar (eğik askılar sonradan değişti)
  const NH = 13;
  for (const z of zs) {
    cable(b, X, TOWER_H, xe, TOWER_H, TOWER_H - DECK_Y - 1.0, 40, z, K, 0.1);
    cable(b, X - 12, DECK_Y + 1, X, TOWER_H, 1.0, 12, z, K, 0.1);
    cable(b, xe, TOWER_H, xe + 8, 2.0, 1.0, 10, z, K, 0.1);
    for (let q = 1; q < NH; q++) {
      const u = q / NH, yc = TOWER_H - (TOWER_H - DECK_Y - 1.0) * 4 * u * (1 - u);
      b(X + SPAN * u, (DECK_Y + yc) / 2, z, 0.05, yc - DECK_Y, 0.05, K, "solid", 0);
    }
    // gece: korkuluk üstünde durağan sıcak yol lambaları (ışık gösterisi yok)
    for (let q = 1; q < 6; q++) b(X + SPAN * (q / 6), DECK_Y + 0.5, z, 0.12, 0.12, 0.12, "#FFE2A0", "glow", 0);
  }
  // Anadolu yakası ayağının kıyı şeridi (görsel)
  b(xe + 6, -0.1, Z, 14, 0.5, 18, "#7C9F5A", "solid", 0.05);
  b(xe + 9, 1.0, Z - 4, 3, 2.0, 2.5, "#E6D3B8"); b(xe + 9, 1.0, Z + 4, 3, 2.4, 2.5, "#C9D9CF");
  return out;
}
function bogazFar(c: LandmarkCtx): Block[] {
  const C = "#C9CED4";
  return [
    { p: [c.cx, TOWER_H / 2, c.cz], s: [0.8, TOWER_H, c.d], c: C, g: "solid", j: 0 },
    { p: [c.cx + SPAN, TOWER_H / 2, c.cz], s: [0.8, TOWER_H, c.d], c: C, g: "solid", j: 0 },
    { p: [c.cx + (SPAN - 14) / 2 + 4, DECK_Y, c.cz], s: [SPAN + 22, 0.3, 2.2], c: "#99A2AC", g: "solid", j: 0 },
  ];
}

// ------------------------------------------------------------------------------------------ Rumeli Hisarı (16 × 14)
/** TOUR-VIEW (LANDMARK-GARDEN-001): sur içi — doğu kıyı kapısından girilen yeşil iç avlu; kuleler ve surlar katı. */
const RUMELI_GATE: CityTile = [15, 5];
const RUMELI_GARDEN: LandmarkGarden = { kind: "bailey", rects: [[1, 1, 14, 12]], gates: [RUMELI_GATE], floor: "park" };
function rumeliHisari(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, X = c.cx, Z = c.cz, ST = "#C4B59A", ST2 = "#A89A80", CAP = "#6E7A86";
  b(X, 0.05, Z, w - 1.4, 0.1, d - 1.4, "#7C9F5A", "solid", 0.06);
  // TOUR-VIEW: doğu (kıyı) surunda yürünür kapı — yerel karo (w − 1, 5); sur içi (iç avlu) bahçe olarak gezilir (RUMELI_GARDEN)
  const gate0 = z0 + RUMELI_GATE[1], gate1 = gate0 + 1;
  for (const [x, z, ww, dd] of [[X, z0 + 0.4, w, 0.8], [X, z0 + d - 0.4, w, 0.8], [x0 + 0.4, Z, 0.8, d],
    [x0 + w - 0.4, (z0 + gate0) / 2, 0.8, gate0 - z0], [x0 + w - 0.4, (gate1 + z0 + d) / 2, 0.8, z0 + d - gate1]] as const) {
    b(x, 1.7, z, ww, 3.4, dd, ST, "solid", 0.05);
    b(x, 3.55, z, ww === 0.8 ? 0.5 : ww, 0.3, dd === 0.8 ? 0.5 : dd, ST2, "solid", 0.05);
  }
  // kapı kemeri (yürüme bandının üstünde) ve kapı eşiği
  b(x0 + w - 0.4, 2.85, gate0 + 0.5, 1.0, 1.1, 1.0, ST2, "solid", 0.04);
  b(x0 + w - 0.4, 0.03, gate0 + 0.5, 1.0, 0.06, 1.0, "#9A8C74", "solid", 0);
  // üç büyük kule (Saruca: kuzeybatı tepe, Halil: kuzeydoğu kıyı, Zağanos: güney) — konik kurşun külahlar
  // LANDMARK-FIDELITY (istanbul.md §9): kaynak — Sarıca Paşa (kuzey, tepede) 28 m en yüksek, Halil Paşa (kıyı) 22 m, Zağanos Paşa
  // (güney) 21 m ama en geniş (26,7 m çap). Özgün konik kurşun külahlar bugün yok: tepe mazgallı, gövdede dar mazgal pencereler.
  const tower = (x: number, z: number, r: number, h: number) => {
    oct(b, x, h / 2, z, r, h, ST, 0.05);
    oct(b, x, h + 0.1, z, r + 0.2, 0.2, ST2);
    for (let q = 0; q < 12; q++) {
      const a = (q / 12) * Math.PI * 2;
      b(x + Math.cos(a) * (r / 2 - 0.05), h + 0.45, z + Math.sin(a) * (r / 2 - 0.05), 0.42, 0.5, 0.42, ST2, "solid", 0.04);
    }
    for (const y of [h * 0.35, h * 0.65]) for (const [dx, dz] of [[0, -1], [1, 0], [-1, 0]]) b(x + dx * (r / 2 + 0.01), y, z + dz * (r / 2 + 0.01), dx ? 0.04 : 0.24, 0.6, dz ? 0.04 : 0.24, OPEN, "solid", 0);
  };
  tower(x0 + 2.6, z0 + d - 2.6, 3.8, 10.4);
  tower(x0 + w - 2.8, z0 + d - 3.0, 3.8, 8.6);
  tower(x0 + 8.5, z0 + 2.2, 4.4, 8.3);
  // küçük sur kuleleri
  for (const [x, z] of [[x0 + 0.6, z0 + 0.6], [x0 + w - 0.6, z0 + 0.6], [x0 + 0.6, Z], [x0 + w - 0.6, Z], [X - 3, z0 + d - 0.6]]) {
    b(x, 2.3, z, 1.5, 4.6, 1.5, ST, "solid", 0.05);
    b(x, 4.75, z, 1.2, 0.3, 1.2, CAP);
  }
  // LANDMARK-FIDELITY: gece üç büyük kuleyi tabandan aydınlatan durağan projektör armatürleri (ışık gösterisi yok)
  for (const [x, z] of [[x0 + 2.6, z0 + d - 4.7], [x0 + w - 2.8, z0 + d - 5.1], [x0 + 8.5, z0 + 4.6]] as const) b(x, 0.15, z, 0.4, 0.1, 0.4, "#FFE2A0", "glow", 0);
  // güney kapısı (kapı karosu [li0 + 7, lj0 − 1])
  b(x0 + 7.5, 2.0, z0 + 0.45, 2.2, 4.0, 1.1, ST2);
  b(x0 + 7.5, 1.1, z0 - 0.12, 1.0, 1.8, 0.04, OPEN, "solid", 0);
  return out;
}
function rumeliFar(c: LandmarkCtx): Block[] {
  return [
    { p: [c.cx, 1.7, c.cz], s: [c.w, 3.4, c.d], c: "#C4B59A", g: "solid", j: 0 },
    { p: [c.x0 + c.w - 2.8, 4.45, c.z0 + c.d - 3.0], s: [3.4, 8.9, 3.4], c: "#C4B59A", g: "solid", j: 0 },
    { p: [c.x0 + 2.6, 5.35, c.z0 + c.d - 2.6], s: [3.4, 10.7, 3.4], c: "#C4B59A", g: "solid", j: 0 },
    { p: [c.x0 + 8.5, 4.3, c.z0 + 2.2], s: [4.0, 8.6, 4.0], c: "#C4B59A", g: "solid", j: 0 },
  ];
}

const boxFar = (color: string) => (c: LandmarkCtx): Block[] => [{ p: [c.cx, c.h / 2, c.cz], s: [c.w, c.h, c.d], c: color, g: "solid", j: 0 }];

export const BOGAZ_LANDMARKS: Record<string, LandmarkModel> = {
  dolmabahce: { near: dolmabahce, far: genFar("dolmabahce"), // uzak LOD Blender'dan (farLod.gen.ts)
    ip_risk: 0, culture_risk: 0,
    note: "Dolmabahçe Sarayı: yalnız dış cephe (deniz cephesi çift sütunları, orta tören salonu kubbesi, saltanat kapısı) stilize; arma, tuğra ve yazı yok." },
  dolmabahce_saat: { near: saatKulesi, far: boxFar(WHITE), ip_risk: 0, culture_risk: 0,
    note: "Dolmabahçe saat kulesi: kademeli beyaz taş kule, rakamsız kadranlar; yazı ve arma yok." },
  ortakoy: { near: ortakoy, far: boxFar(WHITE), ip_risk: 0, culture_risk: 1, sacred: true,
    note: "Ortaköy camisi benzeri: tek kubbe, iri kemerli pencereler, iki ince minare; alem ve yazı yok. İbadet yeri: yalnız dış görünüm, iç mekân kapalı, kutsal bölge." },
  bogaz_koprusu: { near: bogazKoprusu, far: bogazFar, ip_risk: 0, culture_risk: 0,
    note: "Boğaz Köprüsü: genel asma köprü tipolojisi (iki kule, sarkık kablolar, askılar); ışık gösterisi ve işletme işareti yok. Yürünmez (görsel); vapurlar altından geçer." },
  rumeli_hisari: { near: rumeliHisari, far: rumeliFar, ip_risk: 0, culture_risk: 0, garden: RUMELI_GARDEN,
    note: "Rumeli Hisarı: üç büyük kule, surlar ve küçük kuleler stilize; içeride yürünür sur yolu ve iç avlu. Kitabe yok." },
};

// ------------------------------------------------------------------------------------------ semt tasarımı
const at = (c: DecorCtx) => ({ x: (li: number) => c.ox + li + 0.5, z: (lj: number) => c.oz + lj + 0.5 });

function bogazDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  // kıyı korkuluğu (rıhtım boyunca) ve alçak taş bordür
  b(c.ox + 29.94, 0.45, c.oz + 48, 0.06, 0.08, 96, "#3F4650", "solid", 0);
  b(c.ox + 29.94, 0.22, c.oz + 48, 0.04, 0.44, 96, "#8E98A1", "solid", 0);
  // Dolmabahçe bahçe parmaklığı (sarayın deniz önü)
  b(p.x(25), 0.4, p.z(15) + 0.5, 0.12, 0.8, 16, "#E6E1D6", "solid", 0.02);
  // Ortaköy meydanı: tezgâhlar ve banklar
  // yürüme oranı (tezgâh 0,52, tente 1,40; bank oturağı 0,315, sırt 0,55)
  for (const [li, col] of [[19, "#C8553D"], [21, "#3F7D6E"], [23, "#4A6FA5"]] as const)
    walkMarketStallAt(b, p.x(li), p.z(44), "+z", ["#E5484D", "#F59E0B", "#84CC16", "#D9A35B"], col);
  for (const li of [18, 22]) walkBenchAt(b, p.x(li), p.z(53), "-z", 1.4, "#8B6B4A", "#3F3A33");
  for (const [li, lj] of [[12, 30], [14, 46], [3, 60], [26, 66]]) plane(b, p.x(li), p.z(lj), 0.9);
  // gizli köşeler: çeşme yalağı, sur dibinde kedi
  b(p.x(10) - 0.42, 0.5, p.z(40), 0.12, 1.0, 0.8, "#D7CDBB"); b(p.x(10) - 0.3, 0.1, p.z(40), 0.34, 0.2, 0.66, "#BFB4A0");
  b(p.x(10) - 0.3, 0.22, p.z(40), 0.28, 0.04, 0.58, "#3E86AE", "water", 0); // CITY-PASS-IST: yalak taş tekne üstünde (eski: havada)
  b(p.x(4), 0.12, p.z(92) + 0.3, 0.32, 0.18, 0.16, "#E8E2D6"); b(p.x(4) + 0.14, 0.24, p.z(92) + 0.3, 0.12, 0.12, 0.12, "#E8E2D6");
  // CITY-PASS-IST (ritüel mekânı, CORE-WALK `city/venues.ts`): Rumeli Hisarı iskelesinin yanında Boğaz kıyısı çay bahçesi —
  // semaver tezgâhı (li 25, lj 79–81) hisara sırtını verir, önde tabureler, kıyıda alçak masa (27, 80). `cay_bogaz` sipariş
  // karosu (26, 80); eski ritüel bankı (28, 80) kaldırıldı.
  placeVenue(b, "tea_garden", p.x(RUMELI_VENUE[0]), p.z(RUMELI_VENUE[1]), "+x", "walk");
  return out;
}

/**
 * Boğaz – Avrupa (48 × 96; şehir karosu [36, 48]). Kara li 0–29 (rıhtım yolu li 26–29), Boğaz suyu li 30–47. Batı kenarı
 * (li 0, lj 0–47) Beyoğlu'na yürüyerek bağlı. Kabataş (T1 son durağı, (6, 6)), saat kulesi [20, 2], Dolmabahçe [16, 8], Beşiktaş
 * iskelesi (29, 28), Ortaköy [24, 48] ve iskelesi (29, 44), Boğaz Köprüsü Avrupa ayağı [20, 55], Rumeli Hisarı [6, 72]
 * (kapı [13, 71]) ve iskelesi (29, 80).
 */
export const BOGAZ_DESIGN: DistrictDesign = {
  water: [[30, 0, 18, 96]],
  pave: [[26, 0, 4, 96]],
  // CITY-PASS-IST (REAL-PATH): Dolmabahçe'nin kuzeyi (lj 24–25) ve Ortaköy camisinin batısı (li 22–23) iki karo açık yol
  plaza: [[17, 42, 9, 4], [26, 52, 3, 4], [13, 24, 12, 2], [22, 47, 2, 6]],
  park: [[8, 8, 6, 16], [2, 62, 22, 8]],
  solid: venueSolidTiles("tea_garden", "+x").map(([di, dj]): [number, number, number, number] => [RUMELI_VENUE[0] + di, RUMELI_VENUE[1] + dj, 1, 1]),
  hidden: [[10, 40], [4, 92]],
  decor: bogazDecor,
};
