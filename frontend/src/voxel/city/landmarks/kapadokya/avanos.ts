/**
 * Kapadokya şehir haritası: **Avanos** (çömlekçi kasabası) landmarkları ve semt tasarımı.
 *
 * Kızılırmak'ı andıran kil yüklü kızıl nehir doğu–batı akar; üstünde yaya asma köprüsü (yürünür güverte). Güney kıyıda çömlek
 * atölyesi (girilebilir: çark, fırın, kurutma rafları) ve çömlekçiler sokağı (kapı önlerinde testi, küp, tabak). Kuzey kıyıda
 * nehir manzaralı seyir noktası. Dükkân adı, marka, yazı yok. Nehir suyu kızıl tondadır (tasarım süsü; karo katı).
 *
 * CITY-PASS-KAP (kaynaklar Avanos çömlekçiliği Hitit dönemine uzanır, kil Kızılırmak'ın kızıl
 * alüvyonundan): atölyenin batı yarısında sundurma altında ayakla dönen çarkın başında oturan usta (elleri çamurda; kit
 * `kickWheel`), kurutma rafı ve odun fırını; saçak altındaki çömlek rafı konsollara oturur. Asma köprü baştan: iki kıyıda portal
 * kuleler, kuleden kuleye sarkan kesintisiz taşıyıcı halatlar (parça parça, her parça bir sonrakine değer), halattan güverte
 * korkuluğuna dikey askılar, iki kıyıya oturan ahşap güverte ve korkuluk. Ana caddede **testi kebabı tezgâhı** (`food_stand`;
 * satıcı tezgâhın ardında, masada testi).
*/
import type { Block } from "../../../scenes";
import { sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel, type Sink } from "../../../citymap/design";
import { placeVenue, venueSolidTiles } from "../../venues";
import { at, boxFar, hangLantern, kickWheel, KAP } from "./kit";
import { genFar } from "./farLod.gen";

const CLAY = ["#B5562F", "#C46A3C", "#A0472A", "#D08A5C", "#8E3B22"];
const RIVER = "#A4583F", WOODC = "#6B4A2E";

/** Çömlek (testi/küp): gövde + omuz + boyun; `k` renk ve boy çeşidi. */
export function pot(b: Sink, x: number, z: number, k: number, y = 0) {
  const s = 0.6 + (k % 3) * 0.18, c = CLAY[k % CLAY.length];
  b(x, y + s * 0.3, z, s * 0.6, s * 0.6, s * 0.6, c, "solid", 0.05);
  b(x, y + s * 0.68, z, s * 0.42, s * 0.18, s * 0.42, c, "solid", 0.05);
  b(x, y + s * 0.84, z, s * 0.2, s * 0.16, s * 0.2, k % 2 ? "#E9D3B0" : c, "solid", 0.03);
}

// ------------------------------------------------------------------------------------------ çömlek atölyesi (8 × 6; kapı kuzeyde)
function atolye(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c;
  const zf = z0 + d, PW = 3.2, PZ = z0 + 4.4; // sundurma: batı yarısı (x0 … x0+3,2), ön derinlik 1,6
  // kayaya oyulmuş atölye: doğu gövde tam derinlik, batı gövde sundurmanın arkasında; tonoz damlar, damda kubbeli odun fırını
  b(x0 + PW + (w - PW) / 2, 1.5, z0 + d / 2, w - PW, 3.0, d, "#E3BFA0", "solid", 0.05);
  b(x0 + PW / 2, 1.5, z0 + (PZ - z0) / 2, PW, 3.0, PZ - z0, "#DDB894", "solid", 0.05);
  b(x0 + w / 2, 3.15, z0 + 2.2, w + 0.2, 0.3, 4.6, "#C9A27E", "solid", 0.03);
  b(x0 + PW + (w - PW) / 2, 3.15, z0 + 5.2, w - PW + 0.2, 0.3, 1.6, "#C9A27E", "solid", 0.03);
  b(x0 + w - 1.4, 3.75, z0 + 1.4, 1.8, 0.9, 1.8, "#B98670", "solid", 0.04);
  b(x0 + w - 1.4, 4.45, z0 + 1.4, 0.4, 0.5, 0.4, "#6E5A4C", "solid", 0);
  // kuzey cephe (doğu gövde): kemerli kapı (kapı karosuna bakar), pencere, saçak altında konsollu çömlek rafı
  const dx = x0 + 4.5;
  b(dx, 0.7, zf + 0.02, 1.0, 1.4, 0.06, KAP.hole, "solid", 0);
  b(dx, 1.48, zf + 0.02, 1.3, 0.16, 0.08, KAP.trim, "solid", 0);
  b(x0 + 6.8, 1.4, zf + 0.02, 0.6, 0.6, 0.05, "#A9CFE0", "glass", 0);
  b(x0 + 1.6, 1.4, PZ + 0.02, 0.6, 0.6, 0.05, "#A9CFE0", "glass", 0);
  b(x0 + PW + (w - PW) / 2, 2.35, zf + 0.25, w - PW - 0.4, 0.08, 0.5, WOODC, "solid", 0);
  for (const sx of [-1.8, 0, 1.8]) b(x0 + PW + (w - PW) / 2 + sx, 2.18, zf + 0.06, 0.08, 0.26, 0.12, WOODC, "solid", 0); // konsollar
  for (let q = 0; q < 4; q++) pot(b, x0 + PW + 0.6 + q * 1.1, zf + 0.25, q, 2.39);
  // sundurma: duvara yaslı kiriş, iki direk, sazlı örtü; altında çark başında usta (yüzü caddeye), kurutma rafı, fener
  b(x0 + PW / 2, 2.45, zf - 0.08, PW, 0.1, 0.12, WOODC, "solid", 0);
  for (const px of [x0 + 0.1, x0 + PW - 0.1]) b(px, 1.2, zf - 0.08, 0.1, 2.4, 0.1, WOODC, "solid", 0);
  for (let x = x0 + 0.2; x < x0 + PW; x += 0.5) b(x, 2.55, (PZ + zf) / 2, 0.1, 0.06, zf - PZ + 0.1, "#C9A86A", "solid", 0);
  hangLantern(b, x0 + 1.0, 2.4, zf - 0.08, 1);
  kickWheel(b, x0 + 1.9, PZ + 0.45, "+z", 0.85, "human");
  b(x0 + 0.5, 0.75, PZ + 0.35, 0.6, 0.05, 0.5, WOODC, "solid", 0);
  b(x0 + 0.5, 1.35, PZ + 0.35, 0.6, 0.05, 0.5, WOODC, "solid", 0);
  b(x0 + 0.5, 0.75, PZ + 0.06, 0.6, 1.5, 0.06, WOODC, "solid", 0); // raf sırtı (duvara yaslı)
  for (const [y, k] of [[0.78, 0], [0.78, 1], [1.38, 2]] as const) b(x0 + 0.32 + (k % 2) * 0.3, y + 0.14, PZ + 0.35, 0.2, 0.24, 0.2, k ? "#D9B08E" : "#C9A27E", "solid", 0.03);
  return out;
}

// ------------------------------------------------------------------------------------------ çömlekçiler sokağı (12 × 4)
function sokak(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, d } = c;
  // dört küçük dükkân (renkli kapılar), önlerinde sıra sıra çömlek ve tabak sergisi, duvara oturan tente
  const DOOR = ["#2F6D8C", "#3F7D6E", "#B9574A", "#7A5C99"];
  for (let q = 0; q < 4; q++) {
    const x = x0 + 1.5 + q * 3.0;
    b(x, 1.4, z0 + d - 1.4, 2.8, 2.8, 2.6, q % 2 ? "#EAD7B8" : "#E8CFA8", "solid", 0.05);
    b(x, 2.9, z0 + d - 1.4, 3.0, 0.2, 2.8, "#C9A27E", "solid", 0.02);
    b(x, 0.65, z0 + d - 2.72, 0.7, 1.3, 0.06, DOOR[q], "solid", 0);
    b(x, 1.9, z0 + d - 3.0, 2.6, 0.08, 0.9, DOOR[(q + 1) % 4], "solid", 0.02);
    for (let k = 0; k < 3; k++) pot(b, x - 0.9 + k * 0.9, z0 + 0.5, q * 3 + k);
    b(x, 0.35, z0 + 1.0, 2.2, 0.7, 0.4, "#8B6A47", "solid", 0.04);
    for (let k = 0; k < 3; k++) b(x - 0.7 + k * 0.7, 0.73, z0 + 1.0, 0.5, 0.06, 0.34, ["#2F6D8C", "#F2E6D0", "#C46A3C"][k], "solid", 0);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ yaya asma köprüsü
/** Köprü ekseni ve kıyılar (semt yerel): güverte li 22–24 (x ekseni li 23,5), güney kıyı lj 23, kuzey kıyı lj 30. */
const BRIDGE = { li: 23.5, s: 23.5, n: 30.5 } as const;
function kopru(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  // landmark ayak izi (li 21–22, lj 21–22) köprü başı: taş kaide, fener direği; asıl köprü dünya koordinatında (semt kökeni)
  const ox = c.x0 - 21, oz = c.z0 - 21, X = ox + BRIDGE.li, zs = oz + BRIDGE.s, zn = oz + BRIDGE.n, HW = 1.45, TOP = 4.0;
  b(c.cx, 0.3, c.cz, 1.6, 0.6, 1.6, "#B49678", "solid", 0.05);
  b(c.cx, 0.62, c.cz, 1.7, 0.06, 1.7, "#9C7E62", "solid", 0.02);
  b(c.cx, 1.6, c.cz, 0.1, 2.0, 0.1, "#4A3A2E", "solid", 0);
  b(c.cx, 2.7, c.cz, 0.28, 0.2, 0.28, "#8A5A32", "solid", 0);
  b(c.cx, 2.68 - 0.18, c.cz, 0.22, 0.2, 0.22, "#FFD08A", "glow", 0);
  // güverte (iki kıyıda zemine oturur) ve korkuluk
  b(X, 0.04, (zs + zn) / 2, HW * 2, 0.08, zn - zs + 1.0, "#9C7A55", "solid", 0.04);
  for (const sx of [-1, 1]) {
    b(X + sx * HW, 0.9, (zs + zn) / 2, 0.05, 0.05, zn - zs + 1.0, "#8E3B22", "solid", 0);
    for (let z = zs - 0.45; z <= zn + 0.46; z += 0.5) b(X + sx * HW, 0.49, z, 0.05, 0.82, 0.05, "#8E3B22", "solid", 0);
  }
  // portal kuleler (iki kıyıda; iki ayak + kiriş)
  for (const zz of [zs, zn]) {
    for (const sx of [-1, 1]) b(X + sx * HW, TOP / 2, zz, 0.26, TOP, 0.26, "#8E3B22", "solid", 0);
    b(X, TOP + 0.13, zz, HW * 2 + 0.26, 0.26, 0.3, "#8E3B22", "solid", 0);
  }
  // taşıyıcı halatlar: kuleden kuleye sarkık zincir (parça parça; komşu parçalar y aralığında örtüşür) ve dikey askılar
  const zm = (zs + zn) / 2, half = (zn - zs) / 2, sag = (z: number) => 1.15 + (TOP - 1.15) * ((z - zm) / half) ** 2;
  const N = 14;
  for (const sx of [-1, 1]) {
    for (let k = 0; k < N; k++) {
      const za = zs + ((zn - zs) * k) / N, zb = zs + ((zn - zs) * (k + 1)) / N;
      const ya = sag(za), yb = sag(zb), y0 = Math.min(ya, yb) - 0.04, y1 = Math.max(ya, yb) + 0.04;
      b(X + sx * HW, (y0 + y1) / 2, (za + zb) / 2, 0.06, y1 - y0, zb - za, "#5B5246", "solid", 0);
      if (k > 0) b(X + sx * HW, (0.92 + ya) / 2, za, 0.025, ya - 0.92, 0.025, "#5B5246", "solid", 0);
    }
  }
  return out;
}

export const AVANOS_LANDMARKS: Record<string, LandmarkModel> = {
  comlek_atolyesi: { near: atolye, far: genFar("comlek_atolyesi"), ip_risk: 0, culture_risk: 0, // uzak LOD Blender'dan (farLod.gen.ts)
    note: "Çömlek atölyesi: kayaya oyulmuş atölye, sundurma altında ayakla dönen çark başında usta, kurutma rafı, odun fırını, saçak altında çömlek rafı; içeride çarklar ve fırın. Atölye adı yok." },
  comlekci_sokagi: { near: sokak, far: boxFar("#EAD7B8", 0.9), ip_risk: 0, culture_risk: 0,
    note: "Çömlekçiler sokağı: kil kırmızısı testiler, küpler ve sırlı tabaklar; dükkân tabelası ve marka yok." },
  asma_kopru: { near: kopru, far: (c) => [{ p: [c.x0 - 21 + BRIDGE.li, 2, c.z0 - 21 + BRIDGE.s], s: [3.2, 4, 0.4], c: "#8E3B22", g: "solid", j: 0 }],
    ip_risk: 0, culture_risk: 0, note: "Yaya asma köprüsü: iki kıyıda kızıl çelik portal kuleler, sarkık taşıyıcı halatlar ve dikey askılar, ahşap güverte (genel tipoloji); güverte yürünür." },
};

// ------------------------------------------------------------------------------------------ semt tasarımı
/** Kızıl nehir: lj 24–29 (köprü güvertesi li 22–24 yürünür). */
const RIVER_W: [number, number, number, number] = [0, 24, 22, 6];
const RIVER_E: [number, number, number, number] = [25, 24, 23, 6];
/** Testi kebabı tezgâhı (ana caddenin kuzeyi; tezgâh li 42–44 × lj 13, sipariş (43, 14), masa (43, 15)). */
export const AVANOS_FOOD: [number, number] = [43, 13];

function avanosDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  // nehir yüzeyi: parsel sınırlarında bölünmüş kızıl su levhaları (su grubu)
  for (const [x0, , w] of [RIVER_W, RIVER_E]) for (let s = x0; s < x0 + w; s += 12) {
    const ww = Math.min(12 - (s % 12), x0 + w - s);
    b(c.ox + s + ww / 2, -0.3, c.oz + 27, ww, 0.2, 6, RIVER, "water", 0.03);
  }
  // kıyı taşları, sazlık, köprü güvertesinin altındaki su (güverte köprü modelinde)
  b(c.ox + 11, 0.12, c.oz + 24.05, 22, 0.24, 0.1, "#B49678", "solid", 0);
  b(c.ox + 36.5, 0.12, c.oz + 24.05, 23, 0.24, 0.1, "#B49678", "solid", 0);
  b(c.ox + 23.5, -0.3, c.oz + 27, 3, 0.2, 6, RIVER, "water", 0.03);
  for (const li of [4, 9, 30, 41]) b(p.x(li), 0.4, p.z(30), 0.9, 0.8, 0.4, "#7E8F4A", "solid", 0.12);
  // sokak boyunca çömlek kümeleri
  for (let k = 0; k < 6; k++) pot(b, p.x(30 + k * 2), p.z(17) + 0.3, k + 2);
  // testi kebabı tezgâhı (yürüme ölçeği; satıcı tezgâhın ardında) + tezgâh üstünde ağzı hamurla kapalı testiler
  const v = placeVenue(b, "food_stand", p.x(AVANOS_FOOD[0]), p.z(AVANOS_FOOD[1]), "+z", "walk");
  const ct = v.counter!;
  for (const [dx, k] of [[1.02, 0], [1.25, 1]] as const) {
    b(ct.x - dx, ct.top + 0.09, ct.z + 0.02, 0.14, 0.18, 0.14, CLAY[k], "solid", 0.03);
    b(ct.x - dx, ct.top + 0.21, ct.z + 0.02, 0.08, 0.06, 0.08, CLAY[k], "solid", 0);
    b(ct.x - dx, ct.top + 0.255, ct.z + 0.02, 0.1, 0.03, 0.1, "#E9D3B0", "solid", 0);
  }
  // gizli köşeler: kırık çömlek parçaları yığını (eski fırın), kıyıda kil çıkarma çukuru
  for (let k = 0; k < 4; k++) b(p.x(2) + (k % 2) * 0.25 - 0.1, 0.03 + k * 0.05, p.z(46) - (k >> 1) * 0.2, 0.3, 0.06, 0.22, CLAY[k], "solid", 0.1);
  b(p.x(46), 0.03, p.z(2), 0.8, 0.06, 0.8, "#8E3B22"); b(p.x(46) + 0.3, 0.16, p.z(2) - 0.3, 0.2, 0.2, 0.2, "#B5562F");
  return out;
}

/**
 * Avanos (48 × 48; şehir karosu [0, 48]). Yalnız minibüsle (Göreme'den). Minibüs durağı (24, 4); çömlek atölyesi [6, 8] (kapı
 * (10, 14)), çömlekçiler sokağı [28, 12], köprü başı [21, 21], kızıl nehir lj 24–29 (köprü güvertesi li 22–24), testi kebabı
 * tezgâhı [42–44, 13], seyir noktası kuzey kıyıda (24, 40).
 */
export const AVANOS_DESIGN: DistrictDesign = {
  solid: [RIVER_W, RIVER_E,
    ...venueSolidTiles("food_stand", "+z").map(([di, dj]): [number, number, number, number] => [AVANOS_FOOD[0] + di, AVANOS_FOOD[1] + dj, 1, 1])],
  pave: [[22, 24, 3, 6], [0, 16, 48, 3], [22, 30, 3, 18]],
  plaza: [[16, 36, 16, 8]],
  buildings: [
    { i0: 30, j0: 32, w: 6, d: 4, h: 3.0, wall: "#E8CFA8", roof: "#C9A27E" }, { i0: 38, j0: 32, w: 6, d: 4, h: 2.4, wall: "#EAD7B8", roof: "#B49678" },
    { i0: 4, j0: 34, w: 7, d: 5, h: 3.4, wall: "#E3BFA0", roof: "#C9A27E" }, { i0: 40, j0: 4, w: 6, d: 6, h: 2.8, wall: "#D9B08E", roof: "#C9A27E" },
  ],
  hidden: [[2, 46], [46, 2]],
  decor: avanosDecor,
};
