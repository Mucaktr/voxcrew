/**
 * Kapadokya şehir haritası: **Balon kalkış alanı** landmarkları ve semt tasarımı.
 *
 * Göreme'nin güneyinde geniş, düz kalkış alanı (şafak): yerde şişmiş, kalkmaya hazır balon (hasır sepet zeminde, brülör çerçevesi,
 * çelik halatlar, dilimli zarf), soğuk şişirmede yere yatmış zarf + benzinli fan + yan yatmış sepet, sırada bekleyen sepetler, yakıt
 * tüpü rafı, römorklu takip aracı; sabah kahvesi çadırı ve yanında balon seyir çay bahçesi (`tea_garden`). Gökteki balon hattın
 * hareketli aracıdır (`transit/model.ts` balon; havada duran durağan balon yok). Balon hattının kalkış durağı burada; balonla
 * vadilerin üstünden geçilir. Zarflarda şirket adı, logo, bayrak YOK; desen dilimdir.
 * CITY-PASS-KAP: balonlar ortak kitle (`kit.ts uprightBalloon / coldInflation / stagedBasket`) gerçek düzende; eski gökte asılı
 * duran üç durağan balon kaldırıldı (desteksizdi).
*/
import type { Block } from "../../../scenes";
import { sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel, type Sink } from "../../../citymap/design";
import { placeVenue, venueSolidTiles } from "../../venues";
import { at, boxFar, chimney, coldInflation, KAP, stagedBasket, uprightBalloon } from "./kit";
import { walkBenchAt } from "../../kit";
import { genFar } from "./farLod.gen";

/** Harita ölçeği: sepet insan oranında (1), zarf büyük (yükseklik ≈ 11). */
const S = 1, E = 2.1;

/** Yakıt tüpü rafı (zeminde): çerçeve + altı tüp. */
function tankRack(b: Sink, x: number, z: number) {
  b(x, 0.05, z, 1.4, 0.1, 0.6, "#5B6470", "solid", 0.02);
  for (const dx of [-0.66, 0.66]) b(x + dx, 0.5, z - 0.26, 0.06, 1.0, 0.06, "#5B6470", "solid", 0);
  b(x, 0.98, z - 0.26, 1.4, 0.05, 0.06, "#5B6470", "solid", 0);
  for (let k = 0; k < 6; k++) b(x - 0.55 + (k % 3) * 0.55, 0.42, z + (k < 3 ? -0.12 : 0.14), 0.22, 0.64, 0.22, "#C9CED3", "solid", 0.02);
}
/** Römorklu takip aracı (yerde; x boyunca): kamyonet (kabin + kasa + tekerler) ve üstünde sepet taşıyan römork. */
function chaseTruck(b: Sink, x: number, z: number) {
  b(x, 0.55, z, 2.4, 0.6, 1.2, "#E8E4DA", "solid", 0.02);
  b(x + 0.6, 1.05, z, 1.0, 0.5, 1.12, "#E8E4DA", "solid", 0.02);
  b(x + 0.6, 1.05, z - 0.57, 0.8, 0.34, 0.03, "#7FA6B8", "glass", 0);
  for (const dx of [-0.8, 0.8]) for (const dz of [-0.5, 0.5]) b(x + dx, 0.2, z + dz, 0.44, 0.4, 0.2, "#2B2B2B", "solid", 0);
  const tx = x - 2.2;
  b(tx, 0.45, z, 1.6, 0.1, 1.1, "#5B6470", "solid", 0.02);
  for (const dz of [-0.5, 0.5]) b(tx, 0.2, z + dz, 0.4, 0.4, 0.16, "#2B2B2B", "solid", 0);
  b(tx + 1.0, 0.45, z, 0.5, 0.06, 0.06, "#5B6470", "solid", 0); // çeki demiri (kamyonete bağlı)
  b(tx, 0.81, z, 1.0, 0.62, 0.8, "#A0703E", "solid", 0.05); // römorkta sepet
  b(tx, 1.15, z, 1.06, 0.07, 0.86, "#5A3A26", "solid", 0.02);
}

// ------------------------------------------------------------------------------------------ kalkış alanı (14 × 10)
function kalkis(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0 } = c;
  // yer örtüsü (soğuk şişirme zarfının altında)
  b(x0 + 5.0, 0.01, z0 + 2.4, 7.0, 0.02, 3.2, "#D9CBB0", "solid", 0.02);
  // 1) soğuk şişirme: yere yatmış zarf (ağız batıda), fan, yan yatmış sepet, tepe ipi
  coldInflation(b, x0 + 2.0, z0 + 2.4, 6.0, S, 1, 1.25);
  // 2) yerde şişmiş, kalkmaya hazır balon
  uprightBalloon(b, x0 + 11.0, z0 + 5.2, S, 0, E);
  // 3) sırada bekleyen sepetler, yakıt tüpleri, römorklu takip aracı
  for (let q = 0; q < 3; q++) stagedBasket(b, x0 + 1.4 + q * 2.0, z0 + 8.5, S, q + 2);
  tankRack(b, x0 + 7.4, z0 + 8.8);
  chaseTruck(b, x0 + 11.8, z0 + 9.0);
  return out;
}

// ------------------------------------------------------------------------------------------ sabah kahvesi çadırı (4 × 3)
function kahve(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c, X = c.cx, Z = c.cz;
  for (const [dx, dz] of [[0.2, 0.2], [w - 0.2, 0.2], [0.2, d - 0.2], [w - 0.2, d - 0.2]]) b(x0 + dx, 1.1, z0 + dz, 0.1, 2.2, 0.1, "#6B4A2E", "solid", 0);
  b(X, 2.25, Z, w + 0.3, 0.12, d + 0.3, "#F2E6D0", "solid", 0.02);
  b(X, 2.45, Z, w * 0.6, 0.3, d * 0.6, "#B9574A", "solid", 0.02);
  b(X, 0.45, z0 + 0.6, w - 0.6, 0.9, 0.6, "#8B6A47", "solid", 0.04);
  for (let q = 0; q < 4; q++) b(x0 + 0.8 + q * 0.8, 0.97, z0 + 0.6, 0.18, 0.14, 0.18, q % 2 ? "#F2E6D0" : "#7C2D12", "solid", 0);
  b(x0 + w - 0.6, 1.05, z0 + 0.6, 0.3, 0.3, 0.3, "#B87333", "solid", 0);
  return out;
}

export const BALON_LANDMARKS: Record<string, LandmarkModel> = {
  kalkis_alani: { near: kalkis, far: genFar("kalkis_alani"), ip_risk: 0, culture_risk: 0, // uzak LOD Blender'dan (farLod.gen.ts)
    note: "Balon kalkış alanı (şafak): yerde şişmiş kalkmaya hazır balon (sepet zeminde, brülör, çelik halatlar), soğuk şişirmede yatan zarf ve fan, sırada bekleyen sepetler, yakıt tüpleri, römorklu takip aracı. Zarflar yalnız renk dilimli; şirket adı/logo/bayrak yok." },
  sabah_kahvesi: { near: kahve, far: boxFar("#F2E6D0", 0.9), ip_risk: 0, culture_risk: 0,
    note: "Sabah kahvesi çadırı: bakır cezve, fincanlar, tezgâh; yanında balon seyir çay bahçesi. Marka yok." },
};

// ------------------------------------------------------------------------------------------ semt tasarımı
// semt güneye 16 karo büyüdü (vadi kenarı ve kalkış alanının güney uzantısı); eski süslerin yerel karoları +SOUTH (şehir
// karosu aynı)
const SOUTH = 16;
/** Balon seyir çay bahçesi (sabah kahvesi çadırının güneyi; tezgâh li 30–32 × lj 54, sipariş (31, 53), masa (31, 52)). */
export const BALON_TEA: [number, number] = [31, 54];
function balonDecor(c0: DecorCtx): Block[] {
  const c: DecorCtx = { ox: c0.ox, oz: c0.oz + SOUTH };
  const out: Block[] = [], b = sink(out), p = at(c);
  // alan kenarında peri bacaları (katı karolar)
  for (const [li, lj, h] of [[2, 40, 5.6], [44, 50, 6.2], [46, 26, 5.0], [2, 10, 4.8]] as const) chimney(b, p.x(li), p.z(lj), h, 1.5, KAP.tuff);
  // gizli köşeler: pilotun not panosu (boş, yazısız) ve rüzgâr flaması (renk şerit; bayrak değil; direğe yapışık)
  b(p.x(2) + 0.3, 0.7, p.z(60), 0.06, 1.4, 0.06, "#6B4A2E"); b(p.x(2) + 0.3, 1.3, p.z(60) - 0.05, 0.6, 0.5, 0.04, "#E5E7EB");
  b(p.x(46) + 0.35, 1.0, p.z(2), 0.06, 2.0, 0.06, "#3F3A33"); b(p.x(46) + 0.35, 1.85, p.z(2) + 0.38, 0.04, 0.24, 0.7, "#E8892E", "solid", 0);
  // balon seyir çay bahçesi (yürüme ölçeği; ocakçı tezgâhın ardında) — semt yerel karo (SOUTH kaydırması yok)
  const q = at(c0);
  placeVenue(b, "tea_garden", q.x(BALON_TEA[0]), q.z(BALON_TEA[1]), "-z", "walk");
  return out;
}

// ------------------------------------------------------------------------------------------ vadi kenarı (yeni, lj 0–15)
/** Vadi kenarındaki peri bacaları (semt yerel karo, boy). Karoları katıdır (`solid`). */
const RIM: readonly (readonly [number, number, number])[] = [[3, 3, 5.2], [8, 6, 4.4], [37, 2, 6.0], [44, 5, 4.8]];

function rimDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  // vadi kenarı: peri bacaları, kayalık yamaç (güney kenar boyunca alçak tüf kademeleri), kayısı bahçesinin çevresinde taş duvar
  for (const [li, lj, h] of RIM) chimney(b, p.x(li), p.z(lj), h, 1.5, KAP.tuff);
  for (const [x0, len, h] of [[0, 14, 0.7], [34, 14, 0.9]] as const) b(c.ox + x0 + len / 2, h / 2, c.oz + 0.3, len, h, 0.6, KAP.tuff, "solid", 0.08);
  b(c.ox + 24, 0.2, c.oz + 0.9, 20, 0.4, 0.3, "#B9A88C", "solid", 0.06);
  // kalkış alanının güney uzantısı (lj 12–19): kalkmaya hazır ikinci balon, soğuk şişirmedeki zarf, sepet sırası, yakıt tüpleri,
  // takip aracı
  uprightBalloon(b, p.x(12), p.z(16), S, 3, E);
  coldInflation(b, c.ox + 24.6, p.z(15), 6.0, S, 3, 1.2);
  for (let q = 0; q < 3; q++) stagedBasket(b, p.x(36) + q * 1.6, p.z(18), S, q, "-z");
  tankRack(b, p.x(6) + 0.6, p.z(13));
  chaseTruck(b, p.x(40), p.z(13));
  // ritüel bankı — sabah kahvesi (31,5, 57): çadıra dönük; ön yüzü durağa bakar (oturan avatar oturağın üstünde)
  walkBenchAt(b, p.x(31), p.z(59), "-z", 1.4, "#8B5A2B", "#4A3A2E");
  // ritüel bankı — balon alanı durağı (18, 50); ön yüzü durağa bakar
  walkBenchAt(b, p.x(18), p.z(51), "-z", 1.4, "#8B5A2B", "#4A3A2E");
  return out;
}

/**
 * Balon alanı (48 × 80; şehir karosu [12, −96]). güneye 16 karo büyüdü — vadi kenarı lj 0–7 (peri bacaları, kayısı bahçesi
 * li 14–33 × lj 1–6), güney minibüs yolu lj 10 (`minibus_guney` rotası şehir karosu j −86; eskiden semt dışından geçiyordu) ve
 * kalkış alanının güney uzantısı li 4–43 × lj 12–19 (kalkmaya hazır ikinci balon, soğuk şişirme, takip aracı). Eski alan (+16)
 * yerinde: kuzey kenar (lj 79) Göreme'ye yürünür; kalkış alanı [10, 36], balon durağı (18, 50), kahve çadırı [30, 56] ve önünde
 * çay bahçesi (tezgâh lj 54), kalkışları izleme noktası (40, 28). Alan kuru çimen renginde düz meydan.
 * CITY-PASS-KAP: kuzey kenar yolunun (lj 79) yanındaki ev sırası meydana açıldı (li 25–34 × lj 77–78; eskiden tek karoluk yoldu).
*/
const SH = (r: [number, number, number, number]): [number, number, number, number] => [r[0], r[1] + SOUTH, r[2], r[3]];
const GRASS = ["#B9B07A", "#B4AA74", "#BDB37E"];
export const BALON_DESIGN: DistrictDesign = {
  plaza: [SH([4, 4, 40, 34]), SH([14, 38, 22, 10]), [4, 12, 40, 8], [25, 77, 10, 2]],
  pave: [SH([22, 48, 3, 16])],
  park: [[14, 1, 20, 6]],
  solid: [SH([2, 40, 1, 1]), SH([44, 50, 1, 1]), SH([46, 26, 1, 1]), SH([2, 10, 1, 1]), ...RIM.map(([li, lj]) => [li, lj, 1, 1] as [number, number, number, number]),
    // güney uzantısındaki balon ekipmanı (yürünmez): şişmiş balon, yatan zarf + fan, sepet sırası, yakıt rafı, takip aracı
    [11, 15, 2, 2], [21, 13, 11, 4], [36, 17, 5, 2], [5, 12, 3, 2], [36, 12, 7, 3],
    ...venueSolidTiles("tea_garden", "-z").map(([di, dj]): [number, number, number, number] => [BALON_TEA[0] + di, BALON_TEA[1] + dj, 1, 1])],
  terraces: [
    { rect: SH([4, 4, 40, 34]), y: 0.02, dir: "+j", colors: GRASS },
    // yeni uzantı: renk sırası eski alanın ilk sırasına (lj 20) kesintisiz bağlanır
    { rect: [4, 12, 40, 8], y: 0.02, dir: "+j", colors: [GRASS[1], GRASS[2], GRASS[0]] },
  ],
  hidden: [[2, 60 + SOUTH], [46, 2 + SOUTH]],
  decor: (c) => [...balonDecor(c), ...rimDecor(c)],
};
