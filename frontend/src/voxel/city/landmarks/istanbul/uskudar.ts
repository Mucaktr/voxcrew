/**
 * İstanbul şehir haritası: **Üsküdar – Kadıköy** (Anadolu yakası) landmarkları ve semt tasarımı (plan §4).
 *
 * Boğaz suyu batıda (li 0–13); **Kız Kulesi** sudaki küçük adasında (yalnız kayıkla; ada kafesi + kule terası girilebilir,
 * adada seyir noktası: gün batımı anı burada). Salacak–Üsküdar sahili, Üsküdar iskele binası, Haydarpaşa (yalnız dış cephe)
 * ve Kadıköy çarşısı (tezgâhlar). Kulede bayrak yok; fener ışığı tarihî deniz feneri işlevine gönderme. Yazı ve marka yok.
*/
import type { Block } from "../../../scenes";
import { ISTANBUL_LANDMARKS as L } from "../../styles/istanbul";
import { dome, oct, sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel } from "../../../citymap/design";
import { plane } from "./tarihi";
import { walkBenchAt } from "../../kit";
import { placeVenue, venueSolidTiles } from "../../venues";
import { walkSimitCartAt } from "./tarihi";

const OPEN = L.opening, WHITE = "#EFE7DA", LEAD = "#7F8A94";
/** CITY-PASS-IST: Salacak çay bahçesinin tezgâh karosu (semt yerel); sipariş karosu bir batıda (17, 56). */
export const SALACAK_VENUE: [number, number] = [18, 56];

// ------------------------------------------------------------------------------------------ Kız Kulesi (3 × 4; kule kuzey ucunda)
function kizKulesi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, zb = c.z0 + 1.4, zt = c.z0 + c.d - 1.0;
  // alçak ada yapısı (güney) + kurşun kırma çatı
  b(X, 1.1, zb, c.w - 0.2, 2.2, 2.6, WHITE);
  b(X, 2.3, zb, c.w + 0.1, 0.2, 2.9, LEAD, "solid", 0.02);
  b(X, 2.55, zb, c.w - 0.9, 0.3, 1.8, LEAD, "solid", 0.02);
  for (const dx of [-0.8, 0, 0.8]) b(X + dx, 1.3, c.z0 + 0.08, 0.4, 0.8, 0.04, OPEN, "solid", 0);
  // kule (kuzey): kare gövde, pencereler, galeri, camlı fener odası, külah
  b(X, 3.4, zt, 1.7, 6.8, 1.7, WHITE);
  b(X, 0.8, zt + 0.87, 0.6, 1.2, 0.04, OPEN, "solid", 0);
  for (const y of [3.0, 5.0]) for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0]]) b(X + dx * 0.86, y, zt + dz * 0.86, dx ? 0.04 : 0.4, 0.7, dz ? 0.04 : 0.4, OPEN, "solid", 0);
  b(X, 6.9, zt, 2.2, 0.16, 2.2, "#3A3F47");
  b(X, 7.15, zt, 2.1, 0.3, 2.1, "#3A3F47", "solid", 0);
  b(X, 7.7, zt, 1.2, 1.0, 1.2, "#CFE6F0", "glass", 0);
  b(X, 7.7, zt, 0.5, 0.5, 0.5, "#FFE7A3", "glow", 0);
  for (let k = 0; k < 3; k++) b(X, 8.35 + k * 0.32, zt, 1.4 - k * 0.45, 0.32, 1.4 - k * 0.45, LEAD, "solid", 0.02);
  b(X, 9.3, zt, 0.08, 0.4, 0.08, L.finial, "solid", 0);
  return out;
}
function kizFar(c: LandmarkCtx): Block[] {
  return [
    { p: [c.cx, 1.1, c.z0 + 1.4], s: [c.w, 2.2, 2.6], c: WHITE, g: "solid", j: 0 },
    { p: [c.cx, 4.6, c.z0 + c.d - 1.0], s: [1.7, 9.2, 1.7], c: WHITE, g: "solid", j: 0 },
  ];
}

// ------------------------------------------------------------------------------------------ Üsküdar iskele binası (5 × 4)
function uskudarIskele(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, W = "#E3D5BC";
  b(X, 1.3, Z, c.w, 2.6, c.d, W);
  b(X, 2.75, Z, c.w + 1.0, 0.16, c.d + 1.0, "#6E5A4E", "solid", 0.02);
  b(X, 3.1, Z, c.w - 1.0, 0.5, c.d - 1.0, "#6E5A4E", "solid", 0.02);
  for (const s of [-1, 1]) { oct(b, X + s * 2.2, 3.2, c.z0 + 0.6, 0.8, 1.2, W); b(X + s * 2.2, 3.95, c.z0 + 0.6, 0.6, 0.3, 0.6, LEAD); }
  for (let q = 0; q < 4; q++) b(c.x0 - 0.02, 1.2, c.z0 + 0.5 + q, 0.04, 1.4, 0.6, OPEN, "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ Kadıköy çarşısı (10 × 8)
function kadikoy(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, X = c.cx, Z = c.cz;
  b(X, 1.4, Z + 1, w, 2.8, d - 2, "#D9C7A6");
  b(X, 2.9, Z + 1, w + 0.3, 0.2, d - 1.7, "#8C4A37", "solid", 0.02);
  // güneye bakan tezgâh sırası: balık, meyve-sebze, baharat, simit (renkli, yazısız)
  const GOODS = ["#9FC5D8", "#C2410C", "#65A30D", "#D97706", "#B91C1C", "#E9D8A6", "#7C2D12", "#A16207"];
  for (let q = 0; q < 8; q++) {
    const x = x0 + 0.7 + q * 1.22;
    b(x, 0.4, z0 + 0.9, 1.0, 0.8, 0.8, "#8B6A47");
    b(x, 0.85, z0 + 0.9, 0.9, 0.12, 0.7, GOODS[q], "solid", 0.06);
    if (q % 2 === 0) b(x + 0.6, 1.9, z0 + 0.9, 2.3, 0.08, 1.2, q % 4 ? "#3F7D6E" : "#C8553D", "solid", 0.02);
  }
  for (const s of [-1, 1]) b(X + s * (w / 2 - 0.2), 1.0, z0 + 0.9, 0.12, 2.0, 0.12, "#2F3640", "solid", 0);
  // CITY-PASS-IST (REAL-SUPPORT): her tente kendi iki dikmesinde (eski: ortadaki iki tente havada)
  for (let q = 0; q < 8; q += 2) for (const dx of [-0.45, 1.65]) b(x0 + 0.7 + q * 1.22 + dx, 0.95, z0 + 0.36, 0.06, 1.9, 0.06, "#2F3640", "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ Haydarpaşa (12 × 5; deniz cephesi batıda)
function haydarpasa(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, X = c.cx, Z = c.cz, W = "#D8C7A8", SL = "#5A5F66";
  b(X, 3.0, Z, w - 2, 6.0, d, W);
  b(X, 6.1, Z, w - 1.8, 0.2, d + 0.2, "#B9A27E", "solid", 0.02);
  b(X, 6.6, Z, w - 2.6, 0.8, d - 0.8, SL, "solid", 0.02);
  for (const s of [-1, 1]) {
    const x = X + s * (w / 2 - 1.2);
    oct(b, x, 3.6, Z, 2.4, 7.2, W);
    [2.2, 1.5, 0.8].forEach((ww, q) => oct(b, x, 7.5 + q * 0.6, Z, ww, 0.6, SL, 0.02));
  }
  for (const y of [2.0, 4.2]) for (let q = 0; q < 6; q++) b(x0 - 0.02 + 1.0, y, z0 + 0.6 + q * 0.75, 0.04, 1.0, 0.4, OPEN, "solid", 0);
  b(x0 + 0.9, 1.4, Z, 0.3, 2.8, 1.6, "#B9A27E");
  return out;
}

const boxFar = (color: string) => (c: LandmarkCtx): Block[] => [{ p: [c.cx, c.h / 2, c.cz], s: [c.w, c.h, c.d], c: color, g: "solid", j: 0 }];

export const USKUDAR_LANDMARKS: Record<string, LandmarkModel> = {
  kiz_kulesi: { near: kizKulesi, far: kizFar, ip_risk: 0, culture_risk: 0,
    note: "Kız Kulesi: küçük ada, alçak taş yapı ve kare kule, galeri, camlı fener odası ve kurşun külah; bayrak yok, efsane anlatımı yok. Yalnız kayıkla; ada kafesi ve kule terası girilebilir, adada seyir noktası." },
  uskudar_iskele: { near: uskudarIskele, far: boxFar("#E3D5BC"), ip_risk: 0, culture_risk: 0,
    note: "Üsküdar iskelesi: geniş saçaklı tarihî iskele binası tipolojisi ve sahil; işletme adı yok. Yakındaki camiler bu fazda konmadı." },
  kadikoy_carsi: { near: kadikoy, far: boxFar("#D9C7A6"), ip_risk: 0, culture_risk: 0,
    note: "Kadıköy çarşısı: balık, meyve-sebze ve baharat tezgâhları, renkli tenteler; dükkân adı, marka ve kulüp renkleri yok." },
  haydarpasa: { near: haydarpasa, far: boxFar("#D8C7A8"), ip_risk: 0, culture_risk: 0,
    note: "Haydarpaşa: yalnız dış cephe; iki köşe kulesi ve dik çatılar stilize; demiryolu işletme işareti yok." },
};

// ------------------------------------------------------------------------------------------ semt tasarımı
const at = (c: DecorCtx) => ({ x: (li: number) => c.ox + li + 0.5, z: (lj: number) => c.oz + lj + 0.5 });

function uskudarDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  // Kız Kulesi adası: kayalar, mendirek, alçak korkuluk
  for (const [x, z, w, d] of [[1.6, 52, 1.2, 2], [1.7, 57, 1.0, 3], [10.4, 55, 1.0, 2.4], [5, 50.4, 3, 0.9], [7, 61.6, 3.4, 0.9]] as const)
    b(c.ox + x, -0.15, c.oz + z, w, 0.5, d, "#8E8579", "solid", 0.12);
  b(c.ox + 2.06, 0.3, c.oz + 56, 0.06, 0.6, 9.6, "#E5E7EB", "solid", 0);
  b(c.ox + 9.94, 0.3, c.oz + 57.5, 0.06, 0.6, 6.4, "#E5E7EB", "solid", 0);
  // Salacak–Üsküdar sahili: bordür, banklar, çay ocağı, martılar
  b(c.ox + 14.06, 0.22, c.oz + 60, 0.08, 0.44, 40, "#8E98A1", "solid", 0);
  // yürüme bankı denize bakar; biri Salacak durağının (14, 56) yanında (çay ritüeli bankta, denize dönük oturulur)
  for (const lj of [44, 52, 60, 70]) walkBenchAt(b, p.x(15), p.z(lj), "-x", 1.4, "#8B6B4A", "#3F3A33");
  // CITY-PASS-IST (ritüel mekânı, CORE-WALK `city/venues.ts`): Salacak sahilinde Kız Kulesi'ne bakan çay bahçesi — semaver tezgâhı
  // (li 18, lj 55–57) karaya, önde tabureler, kıyıda alçak masa (16, 56). `cay_bogaz` sipariş karosu (17, 56).
  placeVenue(b, "tea_garden", p.x(SALACAK_VENUE[0]), p.z(SALACAK_VENUE[1]), "-x", "walk");
  // simit arabası Üsküdar iskelesinin önünde (16, 68). ACTIVITY-FEEL (B5): `simit_marti` arabanın yanındaki karoya (16, 67) bağlı
  // (eski: durağa (14, 66) bağlı, araba (16, 67) — arabanın arkasından 3 karo). Durağın 1 karoluk halkası açık kalır.
  walkSimitCartAt(b, p.x(16), p.z(68));
  b(p.x(16), 0.6, p.z(50), 0.9, 1.2, 0.9, "#B5462E"); b(p.x(16), 1.3, p.z(50), 1.2, 0.1, 1.2, "#E9D8A6");
  for (const lj of [46, 58]) b(c.ox + 14.2, 0.52, p.z(lj), 0.2, 0.14, 0.12, "#F5F5F4", "solid", 0);
  // Üsküdar meydanı: sekizgen çeşme (meydan çeşmesi; yazısız)
  oct(b, p.x(23), 0.9, p.z(69), 1.6, 1.8, "#E6DCCB");
  dome(b, p.x(23), 1.8, p.z(69), 0.95, 0.6, LEAD, 2);
  for (const [li, lj] of [[30, 44], [36, 48], [40, 42], [20, 58]]) plane(b, p.x(li), p.z(lj), 0.9);
  // gizli köşeler: kuş yemliği ve kedi evi
  b(p.x(30) + 0.38, 0.5, p.z(80), 0.06, 1.0, 0.06, "#6B4A2E", "solid", 0); b(p.x(30) + 0.38, 1.1, p.z(80), 0.34, 0.24, 0.34, "#C9A27C");
  b(p.x(40) + 0.3, 0.2, p.z(20), 0.4, 0.4, 0.3, "#9C7B5A"); b(p.x(40) + 0.3, 0.45, p.z(20), 0.46, 0.1, 0.36, "#6B4A2E");
  return out;
}

/**
 * Üsküdar – Kadıköy (48 × 96; şehir karosu [96, −48]). Yalnız vapur ya da kayıkla ulaşılır (yürüme bağı yok). Boğaz suyu li 0–13;
 * Kız Kulesi adası li 2–9 × lj 51–60 (kule [4, 53], kapı [5, 57], kayık iskelesi (8, 52), seyir noktası (3, 59)); Salacak kayık
 * iskelesi (14, 56), Üsküdar iskelesi (14, 66) ve binası [16, 62], Haydarpaşa [16, 34], Kadıköy iskelesi (14, 24) ve çarşısı [22, 14].
 */
export const USKUDAR_DESIGN: DistrictDesign = {
  water: [[0, 0, 14, 96]],
  plaza: [[2, 51, 8, 10], [18, 66, 10, 6], [20, 22, 14, 2]],
  pave: [[14, 40, 3, 40]],
  park: [[30, 40, 14, 10]],
  solid: [...venueSolidTiles("tea_garden", "-x").map(([di, dj]): [number, number, number, number] => [SALACAK_VENUE[0] + di, SALACAK_VENUE[1] + dj, 1, 1]), [16, 68, 1, 1]],
  hidden: [[30, 80], [40, 20]],
  decor: uskudarDecor,
};
