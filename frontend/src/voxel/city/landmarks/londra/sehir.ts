/**
 * Londra şehir haritası: **Eski şehir (City)**.
 *
 * Kubbeli büyük katedral (yalnız dış görünüm: iki batı kulesi, sütunlu revak, kasnaklı ve sütun halkalı kubbe, fener; tepede
 * haç yok; iç kapalı, kutsal bölge), büyük yangın anıtı sütunu (kaide, yivli gövde, seyir kafesi, yaldız alevli vazo; figür ve
 * kitabe yok) ve borsa revakı (sekiz sütun, kabartmasız alınlık). Yazı, arma, banka/kurum adı yok.
*/
import type { Block } from "../../../scenes";
import { dome, oct, sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel } from "../../../citymap/design";
import { at, L, lamp, infoKiosk, tree } from "./kit";
import { walkBenchAt } from "../../kit";

const PORT = "#E4DED0", PORT2 = "#C9C1AE", LEAD = "#7F8A94";

// ------------------------------------------------------------------------------------------ kubbeli katedral (16 × 10, h 15; batı cephesi −x)
function kubbeliKatedral(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0 } = c, Z = c.cz, Xd = x0 + 9;
  // TOUR-VIEW: kilise avlusu taşı ince (yürünür) — nef ile transept arasındaki dört köşe avlusu gezilir (kutsal bölge, sessiz)
  b(c.cx, 0.05, Z, 16, 0.1, 10, PORT2, "solid", 0.02);
  // nef (doğu–batı) ve transept (kuzey–güney); iki kat korniş
  b(x0 + 8, 2.2, Z, 14, 4.4, 4, PORT, "solid", 0.02);
  b(Xd, 2.2, Z, 4, 4.4, 9.4, PORT, "solid", 0.02);
  for (const y of [2.2, 4.45]) { b(x0 + 8, y, Z, 14.1, 0.12, 4.1, PORT2); b(Xd, y, Z, 4.1, 0.12, 9.5, PORT2); }
  b(x0 + 8, 4.7, Z, 13.6, 0.4, 3.0, LEAD, "solid", 0.02);
  b(Xd, 4.7, Z, 3.0, 0.4, 9.0, LEAD, "solid", 0.02);
  // batı cephesi: iki kat sütunlu revak, alınlık (kabartmasız), iki batı kulesi (fener başlıklı)
  for (let q = 0; q < 6; q++) b(x0 + 0.25, 1.1, Z - 1.5 + q * 0.6, 0.22, 2.0, 0.22, "#F4F1EA");
  for (let q = 0; q < 4; q++) b(x0 + 0.25, 3.2, Z - 0.9 + q * 0.6, 0.2, 1.8, 0.2, "#F4F1EA");
  b(x0 + 0.3, 4.4, Z, 0.5, 0.5, 2.6, PORT2);
  // CITY-PASS-LON: iki katlı revakı nefe bağlayan saçaklıklar (alt kat üstü ve üst kat üstü; eskiden üst revak havadaydı)
  b(x0 + 0.5, 2.2, Z, 1.0, 0.2, 3.8, PORT2, "solid", 0.02);
  b(x0 + 0.62, 4.15, Z, 0.76, 0.12, 2.8, PORT2, "solid", 0.02);
  b(x0 + 0.5, 0.9, Z, 0.04, 1.6, 0.8, "#3A3028", "solid", 0);
  for (const s of [-1, 1]) {
    b(x0 + 1.0, 3.2, Z + s * 2.6, 1.6, 6.4, 1.6, PORT, "solid", 0.02);
    oct(b, x0 + 1.0, 7.0, Z + s * 2.6, 1.1, 1.2, PORT);
    dome(b, x0 + 1.0, 7.6, Z + s * 2.6, 0.5, 0.7, LEAD, 2);
    b(x0 + 1.0, 8.45, Z + s * 2.6, 0.1, 0.3, 0.1, L.gold, "solid", 0);
  }
  // kesişimde kubbe: iki kademeli kasnak, sütun halkası, kurşun kubbe, fener, yaldız top (haç yok)
  oct(b, Xd, 5.4, Z, 5.2, 1.4, PORT);
  oct(b, Xd, 5.96, Z, 6.4, 0.12, PORT2); // COLUMN-CONT-001: sütun halkası taş kuşağa basar (2,75'teki sütunlar kasnak dışında havadaydı)
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; b(Xd + Math.cos(a) * 2.75, 6.6, Z + Math.sin(a) * 2.75, 0.2, 1.4, 0.2, "#F4F1EA"); }
  b(Xd, 7.36, Z, 5.4, 0.12, 5.4, PORT2);
  oct(b, Xd, 7.9, Z, 4.2, 1.0, PORT);
  dome(b, Xd, 8.4, Z, 2.2, 3.4, LEAD, 3);
  oct(b, Xd, 12.4, Z, 0.9, 1.4, PORT);
  dome(b, Xd, 13.1, Z, 0.45, 0.7, LEAD, 2);
  b(Xd, 13.93, Z, 0.26, 0.26, 0.26, L.gold, "solid", 0);
  b(Xd, 14.3, Z, 0.08, 0.5, 0.08, L.gold, "solid", 0);
  // apsis (doğu) ve kuzey/güney cephe pencereleri
  b(x0 + 15.2, 1.8, Z, 1.6, 3.6, 3.0, PORT, "solid", 0.02);
  for (const px of [3, 4.6, 12, 13.6]) for (const s of [-1, 1]) b(x0 + px, 2.8, Z + s * 2.02, 0.4, 1.0, 0.04, L.winD, "solid", 0);
  return out;
}
const katedralFar = (c: LandmarkCtx): Block[] => [
  { p: [c.x0 + 8, 2.4, c.cz], s: [14, 4.8, 4], c: PORT, g: "solid", j: 0 },
  { p: [c.x0 + 9, 2.4, c.cz], s: [4, 4.8, 9.4], c: PORT, g: "solid", j: 0 },
  { p: [c.x0 + 9, 7.0, c.cz], s: [5, 4.0, 5], c: PORT, g: "solid", j: 0 },
  { p: [c.x0 + 9, 10.4, c.cz], s: [3.6, 3.0, 3.6], c: LEAD, g: "solid", j: 0 },
  { p: [c.x0 + 9, 13.2, c.cz], s: [0.8, 2.4, 0.8], c: PORT, g: "solid", j: 0 },
];

// ------------------------------------------------------------------------------------------ anıt sütun (2 × 2, h 9)
/** (K2 simge eğrisi): sütun bütün ayrıntısıyla düşeyde ×`ANIT_KY` (tepe 9 → 11,5; eğri 61,6 m → 13,4 ±%25; saat
 * kulesinden kısa); yatayda ×`ANIT_KXZ`, 2 × 2 ayak izini aşmaz.*/
const ANIT_KY = 1.28, ANIT_KXZ = 1.1;
function anitSutun(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b0 = sink(out);
  const X = c.cx, Z = c.cz;
  const b: typeof b0 = (x, y, z, w, h, d, col, g, j) =>
    b0(X + (x - X) * ANIT_KXZ, y * ANIT_KY, Z + (z - Z) * ANIT_KXZ, Math.min(c.w, w * ANIT_KXZ), h * ANIT_KY, Math.min(c.d, d * ANIT_KXZ), col, g, j);
  b(X, 0.9, Z, 1.8, 1.8, 1.8, PORT2, "solid", 0.02);
  b(X, 1.9, Z, 1.9, 0.2, 1.9, PORT, "solid", 0);
  oct(b, X, 4.6, Z, 1.0, 5.2, PORT);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; b(X + Math.cos(a) * 0.5, 4.6, Z + Math.sin(a) * 0.5, 0.06, 5.2, 0.06, PORT2, "solid", 0); }
  b(X, 7.3, Z, 1.4, 0.2, 1.4, PORT2);
  b(X, 7.6, Z, 1.2, 0.4, 1.2, "#1F2226", "solid", 0);
  b(X, 8.0, Z, 0.5, 0.4, 0.5, PORT);
  b(X, 8.45, Z, 0.6, 0.5, 0.6, L.gold, "solid", 0.04);
  b(X, 8.85, Z, 0.36, 0.3, 0.36, L.gold, "solid", 0.06);
  return out;
}

// ------------------------------------------------------------------------------------------ borsa revakı (8 × 6, h 5; cephe batıya)
function borsa(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0 } = c, X = c.cx, Z = c.cz;
  b(X + 0.6, 2.0, Z, 6.8, 4.0, c.d, PORT, "solid", 0.02);
  b(X + 0.6, 4.1, Z, 6.9, 0.2, c.d + 0.1, PORT2);
  b(X + 0.6, 4.4, Z, 6.4, 0.4, c.d - 0.6, LEAD, "solid", 0.02);
  for (let q = 0; q < 8; q++) b(x0 + 0.5, 1.7, Z - 2.45 + q * 0.7, 0.3, 3.4, 0.3, "#F4F1EA");
  b(x0 + 0.6, 3.6, Z, 1.2, 0.4, 5.6, PORT2);
  b(x0 + 0.6, 4.1, Z, 1.0, 0.6, 4.4, PORT, "solid", 0.02);
  b(x0 + 0.6, 4.55, Z, 0.8, 0.3, 2.4, PORT2);
  b(x0 + 1.25, 1.2, Z, 0.04, 2.2, 1.2, "#3A3028", "solid", 0);
  return out;
}

const boxFar = (color: string) => (c: LandmarkCtx): Block[] => [{ p: [c.cx, c.h / 2, c.cz], s: [c.w, c.h, c.d], c: color, g: "solid", j: 0 }];

export const SEHIR_LANDMARKS: Record<string, LandmarkModel> = {
  kubbeli_katedral: { near: kubbeliKatedral, far: katedralFar, ip_risk: 0, culture_risk: 1, sacred: true,
    garden: { kind: "grounds", rects: [[0, 0, 16, 10]], gates: [], floor: "plaza" },
    note: "Kubbeli büyük katedral: iki batı kulesi, iki kat sütunlu revak, sütun halkalı kasnak, kurşun kubbe ve fener. İbadet yeri: yalnız dış görünüm; iç kapalı, kutsal bölge. Tepede haç yok; heykel, kabartma ve yazı yok." },
  anit_sutun: { near: anitSutun, far: boxFar(PORT), ip_risk: 0, culture_risk: 0,
    note: "Büyük yangın anıt sütunu: kaide, yivli gövde, seyir kafesi ve yaldız alevli vazo; kaide kabartması ve kitabe yok." },
  borsa: { near: borsa, far: boxFar(PORT), ip_risk: 0, culture_risk: 0,
    note: "Borsa revakı: sekiz sütun, kabartmasız alınlık; banka/kurum adı, arma ve yazı yok." },
};

// ------------------------------------------------------------------------------------------ semt süsleri
function sehirDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  for (const [li, lj] of [[6, 16], [26, 16], [6, 31], [26, 31], [30, 12], [38, 24]] as const) lamp(b, p.x(li), p.z(lj));
  for (const [li, lj] of [[4, 22], [4, 26], [28, 22]] as const) tree(b, p.x(li), p.z(lj), 0.9);
  infoKiosk(b, p.x(31), p.z(25));
  // katedral avlusunda banklar
  for (const lj of [17, 30]) walkBenchAt(b, p.x(16), p.z(lj), lj === 17 ? "+z" : "-z", 1.4, "#6B4A2E", L.iron);
  // gizli köşeler: dar geçitte eski su pompası; kuzeydoğu avlusunda kedi
  b(p.x(2), 0.7, p.z(46), 0.3, 1.4, 0.3, "#1F2226", "solid", 0); b(p.x(2) + 0.2, 1.1, p.z(46), 0.3, 0.08, 0.08, "#1F2226", "solid", 0);
  b(p.x(46) + 0.3, 0.1, p.z(46), 0.3, 0.16, 0.14, "#C9792E"); b(p.x(46) + 0.42, 0.22, p.z(46), 0.12, 0.12, 0.12, "#C9792E");
  return out;
}

/**
 * Eski şehir (48 × 48; şehir karosu [0, 48]). Katedral [8, 18] (16 × 10) ve avlusu, anıt sütun [34, 10], borsa [32, 26].
 * Metro (lj 4, li 40) durağı [24, 4]; otobüs (lj 36) durağı [24, 36].
 */
export const SEHIR_DESIGN: DistrictDesign = {
  // CITY-PASS-LON (REAL-PATH): semt kenar sokakları iki karo (güney ve batı kenar şeritleri)
  plaza: [[6, 15, 22, 2], [6, 29, 22, 3], [30, 8, 8, 6], [0, 0, 24, 2], [0, 0, 2, 12]],
  hidden: [[2, 46], [46, 46]],
  decor: sehirDecor,
};
