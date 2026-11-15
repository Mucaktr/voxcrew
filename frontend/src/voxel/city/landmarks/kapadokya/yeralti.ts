/**
 * Kapadokya şehir haritası: **Yer altı şehri** (Derinkuyu/Kaymaklı'yı andıran köy) landmarkları ve semt tasarımı.
 *
 * Yerüstünde sade bir köy: taş evler, köy meydanında çeşme, yer altı şehrinin giriş yapısı (kesme taş, tonozlu giriş; girilebilir)
 * ve tarlada yer altına hava veren havalandırma bacasının ağzı. İçeride (iç mekân, `descend`): giriş katı (ahır, sürgü taşı kapı)
 * → rampa ve basamaklarla aşağı mutfak ve depolar → en alt kat toplantı salonu ve kuyu. Dinî oda (şapel) bilerek konmadı. Yazı yok.
*/
import type { Block } from "../../../scenes";
import { sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel, type Sink } from "../../../citymap/design";
import { at, boxFar, chimney, HOLE, KAP } from "./kit";

const STONE = "#CDB79A", STONE2 = "#BFA184";

// ------------------------------------------------------------------------------------------ giriş yapısı (10 × 6; giriş güneyde)
/** Dikine duran sürgü taşı (yuvarlak; yerdeki oyma oluğun içinde, kenarı üstünde; ortası delik): 3 kutu ile daire. */
function rollingStone(b: Sink, x: number, z: number, r: number, t: number) {
  b(x, r, z, t, 2 * r * 0.72, 2 * r * 0.72, "#A8977C", "solid", 0.04);
  b(x, r, z, t, 2 * r, 2 * r * 0.42, "#A8977C", "solid", 0.04);
  b(x, r, z, t, 2 * r * 0.42, 2 * r, "#A8977C", "solid", 0.04);
  b(x, r, z, t + 0.04, 0.22, 0.22, "#5A4436", "solid", 0);
  b(x, 0.06, z, t + 0.16, 0.12, 2 * r * 0.8, "#8A7A62", "solid", 0.03); // oluk kenarı
}
function giris(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, Z = c.cz;
  // alçak kesme taş yapı (doğu 6,8 karo; yüzü −z, ayak izinin ön kenarında): kademeli düz dam, köşe taşları. Batıda açık
  // sergi avlusu: oluğunda dik duran yuvarlak sürgü taşı (yer altı kapısının örneği) ve alçak taş sınır.
  const zf = z0 + 0.02, DX = x0 + 4.5, PX0 = x0 + 3.2, PW = w - 3.2, PX = PX0 + PW / 2; // kapı karosu (22, 19) ekseni
  b(PX, 1.3, Z + 0.01, PW, 2.6, d - 0.02, STONE, "solid", 0.05);
  b(PX, 2.75, Z, PW + 0.2, 0.3, d + 0.1, STONE2, "solid", 0.03);
  for (let k = 0; k < 3; k++) b(PX, 3.0 + k * 0.25, Z, 3.6 - k * 1.0, 0.25, d - 1.4 - k * 0.8, STONE2, "solid", 0.03);
  for (const x of [PX0 + 0.15, x0 + w - 0.15]) for (let k = 0; k < 4; k++) b(x, 0.32 + k * 0.62, zf - 0.03, 0.3, 0.3, 0.06, STONE2, "solid", 0);
  // tonozlu iniş ağzı: karanlık açıklık, kesme taş kemer ve sövesi (cepheye yapışık)
  b(DX, 0.95, zf - 0.03, 1.6, 1.9, 0.05, HOLE, "solid", 0);
  for (let k = 0; k < 7; k++) { const a = (k / 6) * Math.PI; b(DX - Math.cos(a) * 0.95, 1.9 + Math.sin(a) * 0.38, zf - 0.05, 0.3, 0.24, 0.1, KAP.trim, "solid", 0); }
  for (const s2 of [-1, 1]) b(DX + s2 * 0.92, 0.95, zf - 0.05, 0.2, 1.9, 0.1, KAP.trim, "solid", 0);
  // bekçi/bilet penceresi (yazısız) ve tezgâhı, cam pencere, duvar feneri (konsola oturur)
  b(x0 + 7.4, 1.25, zf - 0.03, 0.8, 0.7, 0.05, "#A9CFE0", "glass", 0);
  b(x0 + 7.4, 0.86, zf - 0.08, 0.9, 0.06, 0.16, STONE2, "solid", 0);
  b(x0 + 9.2, 1.4, zf - 0.03, 0.6, 0.6, 0.05, "#A9CFE0", "glass", 0);
  b(DX + 1.3, 2.05, zf - 0.08, 0.06, 0.06, 0.16, "#3F3A33", "solid", 0);
  b(DX + 1.3, 1.9, zf - 0.15, 0.16, 0.24, 0.16, "#FFD08A", "glow", 0);
  // sergi avlusu: taş döşeme, alçak sınır, sürgü taşı
  b(x0 + 1.6, 0.03, Z, 3.0, 0.06, d - 0.4, "#C8B59A", "solid", 0.03);
  b(x0 + 1.6, 0.2, z0 + 0.25, 3.0, 0.4, 0.3, STONE2, "solid", 0.04);
  rollingStone(b, x0 + 1.6, Z, 0.7, 0.32);
  return out;
}

// ------------------------------------------------------------------------------------------ havalandırma bacası ağzı (2 × 2)
function havalandirma(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz;
  // kare taş bilezik, içi derin karanlık kuyu; üstte ahşap kapak çerçevesi ve demir ızgara
  b(X, 0.35, Z, 1.9, 0.7, 1.9, STONE, "solid", 0.05);
  b(X, 0.72, Z, 1.2, 0.06, 1.2, "#2A221C", "solid", 0);
  for (const s of [-0.3, 0, 0.3]) b(X + s, 0.78, Z, 0.05, 0.05, 1.2, "#3A3A3A", "solid", 0);
  for (const s of [-0.85, 0.85]) b(X + s, 1.3, Z, 0.12, 1.2, 0.12, "#6B4A2E", "solid", 0);
  b(X, 1.95, Z, 1.9, 0.12, 0.12, "#6B4A2E", "solid", 0);
  b(X, 1.6, Z, 0.04, 0.7, 0.04, "#4A3A2E", "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ köy çeşmesi (2 × 2)
function cesme(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz;
  b(X, 0.25, Z + 0.3, 1.8, 0.5, 1.0, STONE2, "solid", 0.04);
  b(X, 0.47, Z + 0.3, 1.5, 0.06, 0.7, "#5E8FA6", "water", 0.02);
  b(X, 1.0, Z - 0.5, 1.6, 2.0, 0.6, STONE, "solid", 0.04);
  b(X, 2.1, Z - 0.5, 1.8, 0.2, 0.7, STONE2, "solid", 0.03);
  b(X, 1.2, Z - 0.18, 0.5, 0.5, 0.05, "#B98670", "solid", 0);
  b(X, 0.95, Z - 0.1, 0.08, 0.08, 0.2, "#8A8F96", "solid", 0);
  return out;
}

export const YERALTI_LANDMARKS: Record<string, LandmarkModel> = {
  yeralti_sehri: { near: giris, far: boxFar(STONE, 0.8), ip_risk: 0, culture_risk: 0,
    note: "Yer altı şehri girişi (Derinkuyu/Kaymaklı'yı andırır): kesme taş yapı, tonozlu iniş, sürgü taşı örneği. İçeride üç kat aşağı: ahır, mutfak/depo, toplantı salonu ve kuyu; şapel bilerek konmadı." },
  havalandirma: { near: havalandirma, far: boxFar(STONE, 0.5), ip_risk: 0, culture_risk: 0,
    note: "Havalandırma bacası ağzı: yer altı katlarına hava ve su sağlayan dikey bacanın yerüstündeki taş bileziği." },
  koy_cesmesi: { near: cesme, far: boxFar(STONE, 0.9), ip_risk: 0, culture_risk: 0,
    note: "Köy çeşmesi: kesme taş ayna ve yalak; kitabe/yazı yok." },
};

// ------------------------------------------------------------------------------------------ semt tasarımı
function yeraltiDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  // köy kenarında tarlalar (alçak ekin şeritleri) ve tek tük baca
  for (let k = 0; k < 5; k++) b(p.x(36), 0.18, p.z(36 + k * 2), 14, 0.3, 0.8, k % 2 ? "#C9B26A" : "#B8A45C", "solid", 0.08);
  for (const [li, lj] of [[4, 44], [44, 12]] as const) chimney(b, p.x(li), p.z(lj), 4.6, 1.3, KAP.cream);
  // gizli köşeler: eski güvercin taşı ve kapı önünde kurutulan biber dizisi
  b(p.x(2), 0.3, p.z(2) - 0.6, 0.6, 0.6, 0.6, "#A8977C"); b(p.x(2), 0.42, p.z(2) - 0.91, 0.2, 0.2, 0.04, HOLE); // gizli köşe süsü karonun kenarında (avatar gövdesi süse girmez)
  b(p.x(46), 0.8, p.z(46) + 0.4, 0.06, 1.6, 0.06, "#6B4A2E"); for (let k = 0; k < 4; k++) b(p.x(46), 1.4 - k * 0.18, p.z(46) + 0.44, 0.12, 0.14, 0.04, "#B91C1C");
  return out;
}

/**
 * Yer altı şehri köyü (48 × 48; şehir karosu [72, −80]). Yalnız minibüsle. Durak (24, 4); giriş yapısı [18, 20] (kapı (22, 19)),
 * havalandırma bacası [34, 26], köy çeşmesi [10, 30], seyir noktası (40, 44; bozkır ve uzak dağ manzarası).
 */
export const YERALTI_DESIGN: DistrictDesign = {
  pave: [[22, 0, 3, 20], [0, 14, 48, 3]],
  plaza: [[14, 26, 12, 8], [25, 45, 10, 2]], // CITY-PASS-KAP: kuzey kenar yolunun yanı meydana açıldı (tek karoluk yol değil)
  solid: [[35, 35, 14, 10], [4, 44, 1, 1], [44, 12, 1, 1]],
  buildings: [
    { i0: 4, j0: 20, w: 6, d: 5, h: 2.4, wall: STONE, roof: STONE2 }, { i0: 30, j0: 18, w: 6, d: 4, h: 2.8, wall: "#D9C7A6", roof: STONE2 },
    { i0: 4, j0: 4, w: 7, d: 5, h: 2.6, wall: "#E3D2B4", roof: STONE2 }, { i0: 30, j0: 4, w: 5, d: 5, h: 2.2, wall: STONE, roof: STONE2 },
  ],
  hidden: [[2, 2], [46, 46]],
  decor: yeraltiDecor,
};
