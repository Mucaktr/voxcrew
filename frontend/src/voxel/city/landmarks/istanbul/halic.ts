/**
 * İstanbul şehir haritası: **Haliç** landmarkları ve semt tasarımı.
 *
 * Haliç suyu semtin ortasından doğu-batı akar (lj 12–35); Galata Köprüsü (li 88–94) güney kıyıyı (Eminönü/Tarihi Yarımada
 * tarafı) kuzey kıyıya (Karaköy/Beyoğlu) bağlar: yürünür üst güverte, ortada tramvay rayı, iki yanda korkuluk boyunca olta
 * tutanlar ve fenerler, iki yanda alçakta alt kat lokanta sırası (girilebilir alt kat yürüyüş yolu: köprü başındaki merdiven
 * köşkünden). Batıda Balat'ın renkli, cumbalı ev sırası. İşletme adı, tabela ve marka yok.
*/
import type { Block } from "../../../scenes";
import { sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel } from "../../../citymap/design";
import { walkBenchAt } from "../../kit";

const OPEN = "#4E3E33";

// ------------------------------------------------------------------------------------------ köprü başı merdiven köşkü (2 × 3)
function koprubasi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const X = c.cx, Z = c.cz;
  b(X, 1.1, Z, c.w, 2.2, c.d, "#C9CED4");
  b(X, 2.3, Z, c.w + 0.3, 0.2, c.d + 0.3, "#5F6B78", "solid", 0.02);
  b(c.x0 - 0.02, 0.8, c.z0 + 1.5, 0.04, 1.4, 1.0, OPEN, "solid", 0);
  // aşağı inen merdivenin korkuluğu (batı yüz)
  b(c.x0 - 0.3, 0.45, c.z0 + 0.5, 0.06, 0.9, 0.9, "#3F4650", "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ Balat renkli evleri (14 × 3; ön yüz kuzeye)
const BALAT = ["#E77A6C", "#F2C14E", "#7FB7A4", "#9C7BC4", "#F29E4C", "#5FA8D3", "#E6A0B5"];
function balat(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const fz = c.z0 + c.d;
  for (let q = 0; q < 7; q++) {
    const x = c.x0 + 1 + q * 2, h = 3.6 + ((q * 5) % 3) * 0.7, col = BALAT[q];
    b(x, h / 2, c.cz, 1.94, h, c.d, col, "solid", 0.04);
    b(x, h * 0.66, fz + 0.25, 1.3, 1.2, 0.5, col, "solid", 0.04);
    b(x, h * 0.66, fz + 0.52, 0.9, 0.7, 0.04, OPEN, "solid", 0);
    b(x, h + 0.15, c.cz, 2.04, 0.3, c.d + 0.2, "#B4583F", "solid", 0.03);
    b(x - 0.45, 0.6, fz + 0.02, 0.5, 1.1, 0.04, OPEN, "solid", 0);
    b(x + 0.45, 1.7, fz + 0.02, 0.4, 0.6, 0.04, OPEN, "solid", 0);
  }
  return out;
}
const boxFar = (color: string) => (c: LandmarkCtx): Block[] => [{ p: [c.cx, c.h / 2, c.cz], s: [c.w, c.h, c.d], c: color, g: "solid", j: 0 }];

export const HALIC_LANDMARKS: Record<string, LandmarkModel> = {
  galata_koprusu: { near: koprubasi, far: boxFar("#C9CED4"), ip_risk: 0, culture_risk: 0,
    note: "Galata Köprüsü: yürünür üst güverte (ortada tramvay), olta tutan genel figürler, iki yanda alt kat lokanta sırası; köprü başı köşkünden girilen alt kat yürüyüş yolu. İşletme adı ve tabela yok." },
  balat: { near: balat, far: boxFar("#E77A6C"), ip_risk: 0, culture_risk: 0,
    note: "Balat: renkli, cumbalı dar ev sırası ve Arnavut kaldırımlı sokaklar; dinî yapı konmadı, yazı yok." },
};

// ------------------------------------------------------------------------------------------ semt tasarımı
// semt batıya 24 karo büyüdü (yukarı Haliç); eski yerel karolar +24 (şehir karosu aynı)
const UP = 24;
const BX0 = 64 + UP, BW = 7, BJ0 = 12, BJ1 = 36;

function halicDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const xW = c.ox + BX0, xE = c.ox + BX0 + BW, zS = c.oz + BJ0, zN = c.oz + BJ1, zc = (zS + zN) / 2, len = zN - zS;
  // korkuluklar, köprü ayakları, alt kat lokanta sıraları (iki yanda, suyun hemen üstünde)
  for (const [x, s] of [[xW, -1], [xE, 1]] as const) {
    b(x - s * 0.06, 0.5, zc, 0.08, 0.08, len, "#5F6B78", "solid", 0);
    b(x - s * 0.06, 0.25, zc, 0.05, 0.5, len, "#8E98A1", "solid", 0);
    b(x + s * 0.5, -0.12, zc, 1.0, 0.16, len - 2, "#B9AC94", "solid", 0.02);
    b(x + s * 0.5, -0.02, zc, 0.8, 0.2, len - 3, "#F2C46B", "solid", 0.04);
    b(x + s * 0.62, 0.16, zc, 0.9, 0.06, len - 2, s < 0 ? "#3F7D6E" : "#C8553D", "solid", 0.02);
    for (const z of [zS + 4, zc, zN - 4]) b(x + s * 0.5, -0.6, z, 0.9, 0.9, 1.4, "#9E988D", "solid", 0.02);
  }
  // fenerler (her iki yanda direk; batı yanda ışık başı)
  for (let z = zS + 1.5; z < zN; z += 4) for (const [x, s] of [[xW, -1], [xE, 1]] as const) {
    b(x - s * 0.25, 1.0, z, 0.08, 2.0, 0.08, "#2F3640", "solid", 0);
    if (s < 0) b(x - s * 0.25, 2.05, z, 0.24, 0.16, 0.24, "#FFE2A0", "glow", 0);
  }
  // ortadaki açılır bölüm kumanda köşkleri
  for (const [x, s] of [[xW, -1], [xE, 1]] as const) {
    b(x - s * 0.55, 1.1, zc, 0.9, 2.2, 1.6, "#C9CED4");
    b(x - s * 0.55, 2.3, zc, 1.1, 0.2, 1.8, "#5F6B78");
  }
  // olta tutanlar: korkuluğa yaslı, kamış suya uzanır, misina aşağı
  const COATS = ["#3F4650", "#6B4A2E", "#2F5D7C", "#5B6B3A", "#7A3E3E", "#4B4B5B"];
  for (let k = 0; k < 10; k++) {
    const s = k % 2 ? 1 : -1, x = s < 0 ? xW + 0.45 : xE - 0.45, z = zS + 2.2 + k * 2.2;
    if (Math.abs(z - zc) < 1.4) continue;
    b(x, 0.45, z, 0.32, 0.9, 0.26, COATS[k % COATS.length], "solid", 0.05);
    b(x, 1.0, z, 0.22, 0.22, 0.22, "#D9A57B", "solid", 0.05);
    b(x + s * 1.05, 1.25, z, 1.6, 0.03, 0.03, "#4A3A2A", "solid", 0);
    b(x + s * 1.85, 0.5, z, 0.02, 1.5, 0.02, "#D6D3CD", "solid", 0);
  }
  return out;
}

const B = (i0: number, j0: number, w: number, d: number, h: number, wall: string, roof = "#B4583F") => ({ i0: i0 + UP, j0, w, d, h, wall, roof });
/** yukarı Haliç (yeni batı şeridi li 0–23; semt yerel, kaydırılmaz) için bina.*/
const BU = (i0: number, j0: number, w: number, d: number, h: number, wall: string, roof = "#A65B3F") => ({ i0, j0, w, d, h, wall, roof });

// ------------------------------------------------------------------------------------------ yukarı Haliç (batı şerit)
/** Tepe kahvesi teraslı yamacı (kuzey kıyı): 6 sıra rampa +j yükselir (adım 0,3), sırtta 3 sıra düz kahve terası; iki yanı ve
 *  sırtı alçak taş duvar (katı; rampanın ağzı güneyde açık). */
const HILL: [number, number, number, number] = [4, 37, 12, 9];
const RAMP = 6, HILL_Y = 2.1;
const hillY = (k: number) => (k < RAMP ? 0.3 + k * 0.3 : HILL_Y);

function upstreamDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const x = (li: number) => c.ox + li, z = (lj: number) => c.oz + lj;
  // rıhtım: taş kenar şeridi ve banklar (güney kıyı, su lj 15'ten başlar)
  b(x(12), -0.1, z(14.9), 24, 0.2, 0.2, "#B9AC94", "solid", 0.02);
  for (const li of [2.5, 7.5, 16.5, 21.5]) {
    walkBenchAt(b, x(li), z(13.4), "+z", 1.4, "#7A5638", "#3F4650");
  }
  // ahşap kayık iskelesi (pave li 10–11, lj 15–19) ve yanına bağlı kayıklar
  for (const lj of [15.5, 17.5, 19.5]) for (const s of [-0.95, 0.95]) b(x(11) + s, -0.35, z(lj), 0.16, 0.7, 0.16, "#5B4636", "solid", 0);
  const BOATS = ["#C8553D", "#2F5D7C", "#F2C14E"];
  BOATS.forEach((col, k) => {
    const bx = k === 1 ? x(13.3) : x(8.7), bz = z(16.4 + k * 1.6);
    b(bx, -0.3, bz, 0.9, 0.3, 1.9, col, "solid", 0.03);
    b(bx, -0.18, bz, 0.7, 0.12, 1.5, "#E9DCC4", "solid", 0.02);
  });
  // tepe kahvesi: yamacın sırtında çardak, masalar, selvi sırası; ışık zinciri (gece)
  const [h0, j0, hw, hd] = HILL, top = j0 + hd - 1, yT = HILL_Y;
  b(x(h0 + hw / 2), yT + 2.0, z(top + 0.5), hw - 1, 0.18, 1.6, "#7A4A39", "solid", 0.02);
  for (const li of [h0 + 0.6, h0 + hw - 0.6]) b(x(li), yT + 1.0, z(top + 0.5), 0.14, 2.0, 0.14, "#5B4636", "solid", 0);
  for (let k = 0; k < 4; k++) {
    const tx = x(h0 + 1.8 + k * 2.6), tz = z(top - 1.2);
    b(tx, yT + 0.45, tz, 0.9, 0.08, 0.9, "#E9DCC4", "solid", 0.02);
    b(tx, yT + 0.22, tz, 0.12, 0.44, 0.12, "#3F4650", "solid", 0);
    b(tx, yT + 0.52, tz, 0.16, 0.06, 0.16, "#C8553D", "solid", 0);
  }
  for (let k = 0; k < 6; k++) b(x(h0 + 1 + k * 2), yT + 1.85, z(top + 1.25), 0.16, 0.12, 0.16, "#FFE2A0", "glow", 0);
  // yamaç duvarı: iki yan ve sırt (taş; zemin + 0,8, rampa boyunca yükselir); duvarın üstünde selviler
  for (let k = 0; k < hd; k++) {
    const t = hillY(k) + 0.8;
    for (const li of [h0 - 0.5, h0 + hw + 0.5]) b(x(li), (t - 0.3) / 2, z(j0 + k + 0.5), 1, t + 0.3, 1, "#B7A88E", "solid", 0.03);
  }
  b(x(h0 + hw / 2), (yT + 0.5) / 2, z(j0 + hd + 0.5), hw + 2, yT + 1.1, 1, "#B7A88E", "solid", 0.03);
  for (const li of [h0 - 0.5, h0 + hw + 0.5]) for (const k of [1, 4, 7]) {
    const y0 = hillY(k) + 0.8;
    b(x(li), y0 + 1.1, z(j0 + k + 0.5), 0.7, 2.2, 0.7, "#2F5B3A", "solid", 0.06);
    b(x(li), y0 + 2.6, z(j0 + k + 0.5), 0.4, 0.8, 0.4, "#2F5B3A", "solid", 0.06);
  }
  return out;
}

/**
 * Haliç (96 × 48; şehir karosu [−96, 0]). Güney kıyı (lj 0–11) varış meydanına (doğu kenarı) ve Tarihi Yarımada'ya bağlı;
 * Haliç suyu lj 12–35; Galata Köprüsü li 88–94 (ray li 92); kuzey kıyı (lj 36–47) Beyoğlu'na bağlı. Balat [30, 3], köprü başı
 * köşkü [85, 8] (kapı [84, 9]), Balat iskelesi (44, 11), Kasımpaşa iskelesi (64, 36), köprü ortasında seyir noktası.
 * yukarı Haliç (li 0–23, yeni): su daralır (lj 15–32); güneyde rıhtım, kayık iskelesi ve renkli ev sırasının devamı,
 * kuzeyde teraslı yamaçta tepe kahvesi (rampa, duvar, selviler, gece ışık zinciri). Yalnız süs: yeni landmark/kimlik yok.
*/
export const HALIC_DESIGN: DistrictDesign = {
  water: [[UP, 12, 72, 24], [0, 15, UP, 18]],
  pave: [[BX0, BJ0, BW, BJ1 - BJ0], [10, 15, 2, 5]],
  // CITY-PASS-IST (REAL-PATH): kuzey kıyı yolu (lj 36–37, li 72–89) iki karo; bina parselleri bir sıra geri çekilir
  plaza: [[80, 0, 16, 3], [0, 12, UP, 3], HILL, [72, 36, 18, 2]],
  // köprünün kenar şeritleri (korkuluk + olta tutanlar): katı; yürünür güverte li 89–93
  solid: [[BX0, BJ0, 1, BJ1 - BJ0], [BX0 + BW - 1, BJ0, 1, BJ1 - BJ0],
    // yamaç duvarı (iki yan + sırt; rampanın ağzı güneyde açık)
    [HILL[0] - 1, HILL[1], 1, HILL[3]], [HILL[0] + HILL[2], HILL[1], 1, HILL[3]], [HILL[0] - 1, HILL[1] + HILL[3], HILL[2] + 2, 1]],
  terraces: [{ rect: [HILL[0], HILL[1], HILL[2], RAMP], y: 0.3, y1: hillY(RAMP - 1), dir: "+j" },
    { rect: [HILL[0], HILL[1] + RAMP, HILL[2], HILL[3] - RAMP], y: HILL_Y }],
  buildings: [
    B(22, 2, 3, 3, 4.6, "#E6A0B5"), B(26, 2, 3, 3, 5.2, "#F2C14E"), B(30, 7, 3, 3, 4.2, "#7FB7A4"),
    B(22, 7, 3, 3, 5.0, "#5FA8D3"), B(26, 7, 3, 3, 4.4, "#F29E4C"), B(2, 7, 3, 3, 4.8, "#9C7BC4"),
    // Balat'ın batısında renkli ev sırasının devamı (cephe kuzeye, rıhtıma)
    BU(2, 2, 3, 3, 4.4, "#E77A6C"), BU(6, 2, 3, 3, 5.0, "#7FB7A4"), BU(10, 2, 3, 3, 4.6, "#F2C14E"), BU(14, 2, 3, 3, 5.4, "#5FA8D3"),
    BU(18, 2, 3, 3, 4.2, "#E6A0B5"), BU(2, 7, 3, 3, 5.2, "#F29E4C"), BU(14, 7, 3, 3, 4.8, "#9C7BC4"), BU(18, 7, 3, 3, 4.4, "#C9DCCB"),
  ],
  hidden: [[33 + UP, 5], [50 + UP, 44]],
  decor: (c) => [...halicDecor(c), ...upstreamDecor(c)],
};
