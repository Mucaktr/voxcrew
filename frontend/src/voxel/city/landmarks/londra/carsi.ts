/**
 * Londra şehir haritası: **Çarşı ve meydan** ( "tipik çarşı").
 *
 * Neoklasik kapalı çarşı salonu (sütunlu cephe, cam tavanlı iç sokaklar; girilebilir → INTERIOR-VIEW kapalı çarşı tarifi:
 * tezgâhlı sokaklar ve renkli mallar), önünde taş meydan ve sokak çiçekçileri; kuzeyde sütunlu revaklı ve kubbeli galeri
 * cephesi ve önünde iki havuzlu çeşme meydanı. Aslan heykelleri ve figürlü anıt sütunu (gerçek kişi) konmadı. Sokak bilgi
 * köşkleri özgündür (FREE-MAP-IP: korunan kırmızı kabin biçimi yok). Dükkân adı, marka, yazı yok.
*/
import type { Block } from "../../../scenes";
import { dome, sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel } from "../../../citymap/design";
import { at, L, lamp, infoKiosk, tree } from "./kit";
import { walkBenchAt, walkPlanterAt } from "../../kit";
import { placeVenue, venueSolidTiles } from "../../venues";
import { genFar } from "./farLod.gen";

/** CITY-PASS-LON: çarşı meydanındaki çay salonu (ritüel `ikindi_cayi`, `cafe` mekânı): köken = tezgâh karosu (semt yerel), müşteri
 *  yönü +z (salona sırtı çarşıya dönük değil, meydana bakar); engelli karolar `solid`'de. */
const TEA_O: [number, number] = [28, 11];
const TEA_SOLID: [number, number, number, number][] = venueSolidTiles("cafe", "+z").map(([di, dj]) => [TEA_O[0] + di, TEA_O[1] + dj, 1, 1]);

// ------------------------------------------------------------------------------------------ kapalı çarşı salonu (14 × 8, h 5; giriş güneyde)
function kapaliCarsi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, X = c.cx, Z = c.cz, ST = "#E6DDCB", ST2 = "#CFC4AE";
  b(X, 1.6, Z + 0.35, w, 3.2, d - 0.7, ST, "solid", 0.02);
  b(X, 3.26, Z, w + 0.1, 0.12, d + 0.1, ST2);
  // üç cam tavanlı iç sokak (doğu–batı), aralarında arduvaz çatılar
  for (const dz of [-2.4, 0, 2.4]) b(X, 3.8, Z + dz, w - 0.8, 0.9, 1.2, "#BFD3DE", "glass", 0);
  for (const dz of [-1.2, 1.2]) b(X, 3.6, Z + dz, w - 0.6, 0.6, 1.0, L.slate, "solid", 0.02);
  for (let q = 0; q < 6; q++) b(x0 + 1.4 + q * 2.24, 4.3, Z, 0.12, 0.1, d - 1.2, "#3F4650", "solid", 0);
  // güney cephesi: sütunlu revak, üç kemerli giriş; batı ucunda alınlıklı revak
  for (let q = 0; q < 8; q++) b(x0 + 0.9 + q * 1.75, 1.4, z0 + 0.14, 0.26, 2.8, 0.26, "#F2EADB");
  b(X, 2.95, z0 + 0.1, w, 0.3, 0.4, ST2);
  for (const dx of [-3, 0, 3]) b(X + dx, 1.0, z0 + 0.68, 1.2, 2.0, 0.04, "#5A4A3A", "solid", 0);
  b(x0 + 0.4, 3.6, Z, 0.8, 0.8, 4.2, ST2, "solid", 0.02);
  b(x0 + 0.4, 4.2, Z, 0.8, 0.4, 2.4, ST2, "solid", 0.02);
  return out;
}

// ------------------------------------------------------------------------------------------ galeri (16 × 5, h 5,5; cephe güneye)
function galeri(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { z0, w, d } = c, X = c.cx, Z = c.cz, ST = "#E2D8C4", ST2 = "#C9BEA6";
  b(X, 1.8, Z, w, 3.6, d - 0.4, ST, "solid", 0.02);
  b(X, 3.66, Z, w + 0.1, 0.12, d - 0.3, ST2);
  b(X, 3.95, Z, w - 0.4, 0.5, d - 1.0, "#9AA3AD", "solid", 0.02);
  // orta revak: altı sütun, alınlık (kabartmasız), kubbe; iki yanda küçük kubbecikler
  for (let q = 0; q < 6; q++) b(X - 2.5 + q, 1.7, z0 + 0.16, 0.28, 3.0, 0.28, "#F2EADB");
  b(X, 3.35, z0 + 0.2, 6.2, 0.3, 0.4, ST2);
  b(X, 3.75, z0 + 0.3, 4.4, 0.5, 0.6, ST);
  b(X, 4.1, Z, 2.4, 0.9, 2.4, ST);
  dome(b, X, 4.55, Z, 1.1, 0.9, "#7F8A94", 2);
  for (const s of [-1, 1]) { b(X + s * 6, 4.3, Z, 1.0, 0.6, 1.0, ST); dome(b, X + s * 6, 4.6, Z, 0.5, 0.5, "#7F8A94", 1); }
  // pencereler (iki yanda, kör kemerli)
  for (let q = 0; q < 6; q++) for (const s of [-1, 1]) b(X + s * (4 + q * 0.7), 2.0, z0 + 0.18, 0.3, 1.4, 0.04, L.winD, "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ çeşme meydanı (3 × 2, h 2,2)
function meydanCesmesi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz, ST = "#C9BFAE";
  b(X, 0.25, Z, 3, 0.5, 2, ST, "solid", 0.02);
  b(X, 0.52, Z, 2.7, 0.06, 1.7, "#5E9DB8", "water", 0);
  b(X, 0.8, Z, 0.6, 0.6, 0.6, ST);
  b(X, 1.15, Z, 1.2, 0.1, 1.2, ST);
  // orta fıskiye ve iki yan jet su (eskiden katı sütun: damla yok)
  b(X, 1.65, Z, 0.12, 0.9, 0.12, "#CFE8F5", "water", 0);
  for (const s of [-1, 1]) b(X + s * 0.95, 0.8, Z, 0.1, 0.5, 0.1, "#CFE8F5", "water", 0);
  return out;
}

const boxFar = (color: string) => (c: LandmarkCtx): Block[] => [{ p: [c.cx, c.h / 2, c.cz], s: [c.w, c.h, c.d], c: color, g: "solid", j: 0 }];

export const CARSI_LANDMARKS: Record<string, LandmarkModel> = {
  kapali_carsi: { near: kapaliCarsi, far: genFar("kapali_carsi"), ip_risk: 0, culture_risk: 0, // uzak LOD Blender'dan (farLod.gen.ts)
    note: "Neoklasik kapalı çarşı salonu: sütunlu revak, cam tavanlı iç sokaklar. Girilebilir: INTERIOR-VIEW kapalı çarşı tarifi (tezgâhlı sokaklar, renkli mallar). Dükkân adı, marka ve yazı yok." },
  galeri: { near: galeri, far: boxFar("#E2D8C4"), ip_risk: 0, culture_risk: 0,
    note: "Galeri cephesi: altı sütunlu revak, kabartmasız alınlık, kubbe ve kubbecikler; yalnız dış görünüm, kurum adı yok." },
  meydan_cesmesi: { near: meydanCesmesi, far: boxFar("#C9BFAE"), ip_risk: 0, culture_risk: 0,
    note: "Meydan çeşmesi: taş havuz ve fıskiye. Aslan heykelleri ve figürlü anıt sütunu (gerçek kişi) bilerek konmadı." },
};

// ------------------------------------------------------------------------------------------ semt süsleri
function carsiDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  // çiçekçi arabaları ve sokak sanatçısı sahnesi (boş kasa), bilgi köşkleri, fenerler
  for (const [li, lj, col] of [[12, 14, "#E5484D"], [32, 14, "#F2D16B"]] as const) {
    b(p.x(li), 0.4, p.z(lj), 1.2, 0.5, 0.6, "#3F6B4E"); b(p.x(li), 0.75, p.z(lj), 1.0, 0.2, 0.5, col, "solid", 0.1);
    for (const s of [-0.42, 0.42]) b(p.x(li) + s, 0.12, p.z(lj), 0.26, 0.24, 0.66, "#2F3640", "solid", 0); // tekerlekler (yere basar)
  }
  b(p.x(22), 0.15, p.z(13), 1.6, 0.3, 1.0, "#6B4A2E");
  infoKiosk(b, p.x(8), p.z(30)); infoKiosk(b, p.x(9), p.z(30));
  for (const [li, lj] of [[12, 12], [34, 12], [12, 36], [34, 36]] as const) lamp(b, p.x(li), p.z(lj));
  // meydanda ikinci havuz ve iki çınar
  b(p.x(28), 0.25, p.z(33), 3, 0.5, 2, "#C9BFAE", "solid", 0.02); b(p.x(28), 0.52, p.z(33), 2.7, 0.06, 1.7, "#5E9DB8", "water", 0);
  for (const s of [-1, 1]) b(p.x(28) + s * 0.7, 0.85, p.z(33), 0.1, 0.7, 0.1, "#CFE8F5", "water", 0); // ikinci havuzun jetleri
  tree(b, p.x(14), p.z(34), 0.9); tree(b, p.x(32), p.z(30), 0.9);
  // gizli köşeler: arka sokakta kitap tezgâhı; kuzeydoğu avlusunda saksı çiçekleri
  b(p.x(2), 0.45, p.z(2) - 0.6, 0.9, 0.9, 0.5, "#6B4A2E"); b(p.x(2), 0.95, p.z(2) - 0.6, 0.8, 0.12, 0.4, "#8C2F39", "solid", 0.06); // gizli köşe süsü karonun kenarında (avatar gövdesi süse girmez)
  for (const dx of [-0.25, 0.25]) walkPlanterAt(b, p.x(45) + dx, p.z(45), 0.36, 0.3, "#C27A4E", "#E5484D");
  // durak bankı (covent (20, 4)); ön yüzü durağa bakar
  walkBenchAt(b, p.x(20), p.z(5), "-z", 1.4, "#2E4A3A", L.iron);
  // CITY-PASS-LON: çay salonu (ikindi çayı): tezgâh, tabureler, masa + sandalyeler; yanında saksılar ve bir bank
  placeVenue(b, "cafe", p.x(TEA_O[0]), p.z(TEA_O[1]), "+z", "walk");
  for (const dx of [-1.9, 1.9]) walkPlanterAt(b, p.x(TEA_O[0]) + dx, p.z(TEA_O[1]) - 0.2, 0.5, 0.4, "#C27A4E", "#E5484D");
  return out;
}

/**
 * Çarşı ve meydan (48 × 48; şehir karosu [−48, 48]). Çarşı meydanı li 10–35 × lj 10–16, çarşı salonu [16, 18] (kapı [22, 17]),
 * çeşme meydanı li 12–35 × lj 28–36 (çeşme [20, 32]), galeri [14, 38]. Metro (li 20 ve lj 4) durağı [20, 4]; otobüs (li 36)
 * durağı [36, 30].
 */
export const CARSI_DESIGN: DistrictDesign = {
  // CITY-PASS-LON (REAL-PATH): semt kenar sokakları iki karo (doğu ve güney kenar şeridi, batı kenarda kısa şerit)
  plaza: [[10, 10, 26, 7], [12, 28, 24, 9], [46, 0, 2, 12], [40, 0, 8, 2], [0, 18, 2, 6]],
  solid: TEA_SOLID,
  hidden: [[2, 2], [45, 45]],
  decor: carsiDecor,
};
