/**
 * Kapadokya şehir haritası ortak çizim kiti (sink tabanlı; dünya koordinatı). Palet `city/styles/kapadokya.ts` KAP ile
 * aynı tonlardır: tüf (bal-krem, pembe), bazalt şapka, oyuk. Yazı, logo, bayrak, dinî simge yok. Saf modül.
 *
 * CITY-PASS-KAP (kalite seferberliği): taban sahne (`Builder.box`), büyüme teması ve şehir haritası (`Sink`) AYNI ayrıntılı
 * yapı taşlarını kullanır — hepsi `Box` imzalı kutu yazıcısıyla çizer, ölçek `s` ile (sahne chibi ≈ 1, harita insan ölçeği):
 * - `uprightBalloon` yerde, şişmiş, kalkmaya hazır balon: hasır sepet zeminde (ayrılmış bölmeli, kenarı deri), köşelerde yakıt
 * tüpleri, dört direkli brülör çerçevesi ve brülör (pilot alevi), sepet köşelerinden etek ağzına çelik halatlar, ateşe
 * dayanıklı koyu etek, dilimli (gore) armut zarf, tepede paraşüt valfi halkası; sepet yerdeki kazığa bağlı.
 * - `coldInflation` soğuk şişirme: yere yatmış, yarı dolu zarf (ağız tarafı alçak, tepe tarafı sivrilir), ağızda etek çerçevesi,
 * önünde benzinli şişirme fanı, yanına yatırılmış sepet ve ağza bakan brülör, tepe ipi yerdeki kazığa.
 * - `stagedBasket` sırada bekleyen sepet: brülör çerçevesi takılı, yanında katlanmış zarf torbası.
 * - `kickWheel` ayakla dönen çömlek çarkı (yerde volan, mil, tabla, çamur testi, sıçrama teknesi, ahşap çerçeve) ve başında
 * oturan `potter` usta figürü (ellerinde çamur; önlüğü kil lekeli).
 * Kaynaklar ve ölçüler:.
*/
import type { Block } from "../../../scenes";
import { KAP } from "../../styles/kapadokya";
import type { DecorCtx, LandmarkCtx, Sink } from "../../../citymap/design";

export { KAP };
export const HOLE = KAP.hole, CAP = KAP.cap;
export const VINE = "#7E8F4A", DUST = "#CDB08C";

/** Kutu yazıcısı (Builder.box ve Sink ile aynı imza). */
export type Box = Sink;

/** Peri bacası (13 kutu): dokuz kademe yumuşakça daralan, açık renk erozyon bantlı tüf koni + boyun + iki kat bazalt şapka. Uç ≈
 *  y0 + h + 0,5w. Kademe oranları taban sahne `styles/kapadokya.ts chimney` ile aynı (kesintisiz koni okunur, pagoda değil). */
export const CHIMNEY_TIERS: readonly (readonly [number, number])[] = [[1, 0.15], [0.9, 0.13], [0.81, 0.12], [0.72, 0.11], [0.64, 0.11],
  [0.56, 0.1], [0.49, 0.1], [0.42, 0.09], [0.36, 0.09]];
export function chimney(b: Sink, x: number, z: number, h: number, w: number, tone: string = KAP.tuff, cap: string = CAP, y0 = 0) {
  let y = y0;
  const band = KAP.cream;
  CHIMNEY_TIERS.forEach(([f, hf], k) => {
    b(x, y + (h * hf) / 2, z, w * f, h * hf, w * f, k === 3 ? band : tone, "solid", 0.05); y += h * hf;
  });
  b(x, y + 0.08 * w, z, w * 0.26, 0.16 * w, w * 0.26, tone, "solid", 0.04);
  b(x, y + 0.22 * w, z, w * 0.76, 0.14 * w, w * 0.76, KAP.capDark, "solid", 0.04);
  b(x, y + 0.35 * w, z, w * 0.56, 0.12 * w, w * 0.56, cap, "solid", 0.04);
  b(x, y + 0.45 * w, z, w * 0.3, 0.08 * w, w * 0.3, cap, "solid", 0.03);
}

/** Şapkasız oyma koni (5 kutu) + kapı/pencere oyukları (yüz yönü −z). */
export function cone(b: Sink, x: number, z: number, h: number, w: number, tone: string = KAP.rose, holes = 2) {
  let y = 0;
  for (const [f, hf] of [[1, 0.34], [0.78, 0.28], [0.54, 0.22], [0.3, 0.16]] as const) {
    b(x, y + (h * hf) / 2, z, w * f, h * hf, w * f, tone, "solid", 0.05); y += h * hf;
  }
  b(x, h * 0.15, z - w * 0.5 - 0.01, w * 0.2, h * 0.24, 0.04, HOLE, "solid", 0);
  for (let k = 1; k < holes; k++) b(x + (k % 2 ? -1 : 1) * w * 0.18, h * (0.36 + k * 0.12), z - w * 0.39 - 0.01, w * 0.14, w * 0.14, 0.04, HOLE, "solid", 0);
}

/** Kaya yüzüne oyulmuş kapı/pencere (yüz düzlemi z = zf). Çerçeve ve oyuk yüze yapışıktır (yüzden en çok 0,03 öne). */
export function holeZ(b: Sink, x: number, y: number, zf: number, w: number, h: number, frame?: string) {
  if (frame) b(x, y, zf, w + 0.16, h + 0.16, 0.04, frame, "solid", 0);
  b(x, y, zf, w, h, 0.06, HOLE, "solid", 0);
}

/** Uzak LOD: tek kutu. */
export const boxFar = (color: string, hf = 1) => (c: LandmarkCtx): Block[] => [{ p: [c.cx, (c.h * hf) / 2, c.cz], s: [c.w, c.h * hf, c.d], c: color, g: "solid", j: 0 }];

/** Semt yerel karo merkezi (dünya). */
export const at = (c: DecorCtx) => ({ x: (li: number) => c.ox + li + 0.5, z: (lj: number) => c.oz + lj + 0.5 });

/** Asma/üzüm bağı sırası (alçak yeşil şeritler) — x yönünde. */
export function vineRow(b: Sink, x0: number, x1: number, z: number) {
  b((x0 + x1) / 2, 0.3, z, x1 - x0, 0.5, 0.36, VINE, "solid", 0.1);
}

// ------------------------------------------------------------------------------------------ yerel eksen yardımcısı
export type Face = "+z" | "-z" | "+x" | "-x";
const DIRS: Record<Face, [number, number]> = { "+z": [0, 1], "-z": [0, -1], "+x": [1, 0], "-x": [-1, 0] };
/** (x, z) kökenli, `face` yönüne bakan yerel çizim: u ileri (face), v sağ; ölçüler yerel (wu ileri, wv yan). */
export function local(b: Box, x: number, z: number, face: Face) {
  const [fx, fz] = DIRS[face], rx = -fz, rz = fx;
  return (u: number, y: number, v: number, wu: number, h: number, wv: number, c: string, g: Block["g"] = "solid", j = 0.02) =>
    b(x + fx * u + rx * v, y, z + fz * u + rz * v, Math.abs(fx) * wu + Math.abs(rx) * wv, h, Math.abs(fz) * wu + Math.abs(rz) * wv, c, g, j);
}

// ------------------------------------------------------------------------------------------ sıcak hava balonu (yerde)
export const BALLOON_ENV = [
  ["#D9573B", "#F2C14E", "#2F6D8C"], ["#3F7D6E", "#F2E6D0", "#B9574A"], ["#7A5C99", "#F2C14E", "#D9573B"], ["#2F6D8C", "#E8892E", "#F2E6D0"],
  ["#E98AA8", "#F8E7C8", "#5E9E5A"], ["#F08A4B", "#3F6E8C", "#F2E6D0"],
] as const;
const WICKER = "#A0703E", WICKER2 = "#7E5530", SUEDE = "#5A3A26", STEEL = "#8A8F96", TANK = "#C9CED3", NOMEX = "#2E2A28";

/** Hasır sepet (yerde, tabanı `y0`): bölme çizgileri, deri kenar, köşelerde yakıt tüpleri. Dönüş: kenar üstü y. */
function basket(b: Box, x: number, z: number, s: number, y0 = 0): number {
  const W = 1.0 * s, D = 0.8 * s, H = 0.62 * s;
  b(x, y0 + H / 2, z, W, H, D, WICKER, "solid", 0.05);
  for (const t of [-0.17, 0.17]) b(x + t * s, y0 + H / 2, z + D / 2 + 0.005, 0.04 * s, H * 0.9, 0.02, WICKER2, "solid", 0); // bölme dikişleri
  b(x, y0 + H * 0.5, z - D / 2 - 0.005, W * 0.9, 0.04 * s, 0.02, WICKER2, "solid", 0); // örgü kuşağı
  b(x, y0 + H + 0.035 * s, z, W + 0.06 * s, 0.07 * s, D + 0.06 * s, SUEDE, "solid", 0.02);
  for (const [dx, dz] of [[-0.36, -0.26], [0.36, 0.26]] as const) b(x + dx * s, y0 + H + 0.05 * s, z + dz * s, 0.14 * s, 0.24 * s, 0.14 * s, TANK, "solid", 0.02);
  return y0 + H + 0.07 * s;
}
/** Brülör çerçevesi: kenardan dört dikme, üst çerçeve, ortada ikiz brülör + pilot alevi. Dönüş: brülör üstü y. */
function burnerFrame(b: Box, x: number, z: number, s: number, rim: number, flame = false): number {
  const top = rim + 0.64 * s;
  for (const dx of [-0.36, 0.36]) for (const dz of [-0.26, 0.26]) b(x + dx * s, (rim + top) / 2, z + dz * s, 0.035 * s, top - rim, 0.035 * s, STEEL, "solid", 0);
  for (const dz of [-0.26, 0, 0.26]) b(x, top + 0.02 * s, z + dz * s, 0.76 * s, 0.04 * s, 0.035 * s, STEEL, "solid", 0);
  for (const dx of [-0.36, 0.36]) b(x + dx * s, top + 0.02 * s, z, 0.035 * s, 0.04 * s, 0.56 * s, STEEL, "solid", 0);
  b(x, top + 0.13 * s, z, 0.42 * s, 0.18 * s, 0.3 * s, "#B8BDC4", "solid", 0.02);
  for (const dx of [-0.1, 0.1]) b(x + dx * s, top + 0.25 * s, z, 0.16 * s, 0.06 * s, 0.16 * s, "#6E747C", "solid", 0);
  b(x, top + 0.3 * s, z, 0.06 * s, 0.04 * s, 0.06 * s, "#FDBA74", "glow", 0); // pilot
  if (flame) b(x, top + 0.48 * s, z, 0.16 * s, 0.32 * s, 0.16 * s, "#FF9A3C", "flame", 0);
  return top + 0.22 * s;
}

/**
 * Yerde, şişmiş, kalkmaya hazır balon (`x, z` sepet ortası, zemin 0). Sepet zeminde; etek ağzı ≈ rim + 0,7s + 0,5e, zarf tepesi
 * ≈ 6,6 (s = e = 1). `s` sepet/brülör ölçeği, `e` zarf ölçeği (harita: sepet insan oranında, zarf büyük). `k` renk takımı;
 * `flame` brülör yanıyor (sıcak şişirme anı). Bütün parçalar birbirine değer (çelik halatlar sepet kenarından eteğe çıkar).
 */
export function uprightBalloon(b: Box, x: number, z: number, s: number, k: number, e = s, flame = false) {
  const C = BALLOON_ENV[k % BALLOON_ENV.length];
  const rim = basket(b, x, z, s);
  burnerFrame(b, x, z, s, rim, flame);
  const skirt0 = rim + 0.7 * s + 0.5 * e;
  // çelik halatlar (sepet kenarı köşelerinden eteğe)
  for (const dx of [-0.48, 0.48]) for (const dz of [-0.38, 0.38]) b(x + dx * s, (rim + skirt0) / 2, z + dz * s, 0.025 * s, skirt0 - rim, 0.025 * s, "#4A4A4A", "solid", 0);
  // etek (Nomex; ağız)
  b(x, skirt0 + 0.22 * e, z, Math.max(1.1 * s, 1.1 * e), 0.44 * e, Math.max(0.9 * s, 0.9 * e), NOMEX, "solid", 0.02);
  // zarf: armut kesit (dilimli üç renk; ortada en geniş), üstte paraşüt valfi
  const D = [1.3, 1.85, 2.3, 2.62, 2.78, 2.78, 2.62, 2.32, 1.86, 1.2];
  let y = skirt0 + 0.44 * e;
  const H = 0.42 * e;
  D.forEach((d0, q) => {
    const d = d0 * e;
    b(x, y + H / 2, z, d * 0.86, H, d * 0.86, C[0], "solid", 0.02);
    b(x, y + H / 2, z, d, H, d * 0.58, C[2], "solid", 0.02);
    b(x, y + H / 2, z, d * 0.58, H, d, C[1], "solid", 0.02);
    if (q === 4) b(x, y + H * 0.15, z, d * 0.9, H * 0.3, d * 0.9, "#F2E6D0", "solid", 0.02); // ekvator kuşağı
    y += H;
  });
  b(x, y + 0.04 * e, z, 0.62 * e, 0.08 * e, 0.62 * e, "#F2E6D0", "solid", 0.02);
  b(x, y + 0.1 * e, z, 0.3 * e, 0.04 * e, 0.3 * e, "#C9CED3", "solid", 0);
  // sepet yerdeki kazığa bağlı (kısa bağlama ipi zeminde)
  b(x - 0.5 * s - 0.2 * s, 0.07 * s, z, 0.4 * s, 0.03 * s, 0.03 * s, "#C8B48A", "solid", 0);
  b(x - 0.93 * s, 0.12 * s, z, 0.07 * s, 0.24 * s, 0.07 * s, "#5B4A3A", "solid", 0);
}

/**
 * Soğuk şişirme: yere yatmış, yarı dolu zarf. Ağız `x0`'da (−x'e açılır), tepe `x0 + len`'de; zarf zeminde. Ağız önünde fan
 * (z − 1,05s'de, ağıza dönük), ağzın önünde yan yatmış sepet ve ağza bakan brülör, tepe ipi kazığa.
 */
export function coldInflation(b: Box, x0: number, z: number, len: number, s: number, k: number, rs = s) {
  const C = BALLOON_ENV[k % BALLOON_ENV.length];
  const n = Math.max(4, Math.round(len / 0.5)), step = len / n;
  for (let q = 0; q < n; q++) {
    // zarf kesiti: genişlik 2r, yükseklik 1,6r (yarı dolu kumaş yukarı kabarır); ağızdan tepeye önce genişler sonra sivrilir
    const t = (q + 0.5) / n, r = (0.5 + 0.62 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.92) - 0.15 * t) * rs, h = 1.6 * r;
    const xc = x0 + step * (q + 0.5);
    b(xc, h / 2, z, step, h, 2 * r * 0.95, C[0], "solid", 0.02);
    b(xc, h + 0.04 * s, z, step, 0.08 * s, 1.1 * r, C[1], "solid", 0.02);
    b(xc, h * 0.55, z + r * 0.95 + 0.01, step, h * 0.3, 0.02, C[2], "solid", 0);
  }
  // ağız: etek çerçevesi (koyu, zarfa yapışık)
  b(x0 - 0.04 * s, 0.45 * rs * 1.6, z, 0.08 * s, 0.9 * rs * 1.6, 0.95 * rs * 2, NOMEX, "solid", 0.02);
  // şişirme fanı: kafes çerçeve + pervane göbeği + motor + tekerler (zeminde, ağza dönük)
  const fx = x0 - 0.75 * s, fz = z - 0.75 * s;
  b(fx, 0.5 * s, fz, 0.2 * s, 0.9 * s, 0.9 * s, "#3A3F47", "solid", 0.02);
  b(fx + 0.11 * s, 0.5 * s, fz, 0.02, 0.74 * s, 0.74 * s, "#9CA3AF", "solid", 0);
  b(fx + 0.13 * s, 0.5 * s, fz, 0.03, 0.16 * s, 0.16 * s, "#E5584E", "solid", 0);
  b(fx - 0.22 * s, 0.22 * s, fz, 0.26 * s, 0.24 * s, 0.3 * s, "#B91C1C", "solid", 0.02);
  for (const dz of [-0.4, 0.4]) b(fx - 0.06 * s, 0.08 * s, fz + dz * s, 0.16 * s, 0.16 * s, 0.06 * s, "#2B2B2B", "solid", 0);
  // yan yatmış sepet (tabanı −x, ağzı +x) ve ağza bakan brülör
  const bx = x0 - 1.15 * s, bz = z;
  b(bx, 0.4 * s, bz, 0.62 * s, 0.8 * s, 1.0 * s, WICKER, "solid", 0.05);
  b(bx + 0.34 * s, 0.4 * s, bz, 0.07 * s, 0.86 * s, 1.06 * s, SUEDE, "solid", 0.02);
  for (const dy of [0.16, 0.64]) for (const dz of [-0.26, 0.26]) b(bx + 0.37 * s + 0.2 * s, dy * s, bz + dz * s, 0.4 * s, 0.035 * s, 0.035 * s, STEEL, "solid", 0);
  b(bx + 0.37 * s + 0.4 * s + 0.08 * s, 0.4 * s, bz, 0.16 * s, 0.56 * s, 0.6 * s, "#B8BDC4", "solid", 0.02);
  // tepe ipi (zeminde) ve kazık
  b(x0 + len + 0.45 * s, 0.03 * s, z, 0.9 * s, 0.03 * s, 0.03 * s, "#C8B48A", "solid", 0);
  b(x0 + len + 0.92 * s, 0.12 * s, z, 0.07 * s, 0.24 * s, 0.07 * s, "#5B4A3A", "solid", 0);
}

/** Sırada bekleyen sepet: zeminde, brülör çerçevesi takılı; `bag` yönünde (varsayılan +z) katlanmış zarf torbası. */
export function stagedBasket(b: Box, x: number, z: number, s: number, k: number, bag: Face = "+z") {
  const rim = basket(b, x, z, s);
  burnerFrame(b, x, z, s, rim);
  const [dx, dz] = DIRS[bag], bx = x + dx * 0.75 * s, bz = z + dz * 0.75 * s;
  b(bx, 0.25 * s, bz, (dx ? 0.6 : 0.9) * s, 0.5 * s, (dx ? 0.9 : 0.6) * s, "#6B5A4A", "solid", 0.05);
  b(bx, 0.53 * s, bz, (dx ? 0.4 : 0.5) * s, 0.06 * s, (dx ? 0.5 : 0.4) * s, BALLOON_ENV[k % BALLOON_ENV.length][0], "solid", 0.02);
}

// ------------------------------------------------------------------------------------------ çömlek çarkı ve usta
const CLAY_WET = "#9C5A3C", WOOD = "#7A4E2A", WOOD2 = "#5E3C22";

/**
 * Ayakla dönen çömlek çarkı (yerde; `face` ustadan çarka). Köken (x, z) ustanın oturduğu taburenin ortası; çark u = 0,5s
 * ileride. Ahşap çerçeve, yerde taş volan (ayağın bastığı), mil, tabla, üstünde çamur testi, sıçrama teknesi. `potter` true ise
 * usta figürü oturur (ölçek: `human` insan oranı, değilse sahne chibi oranı).
 */
export function kickWheel(b: Box, x: number, z: number, face: Face, s = 1, potterKind: "chibi" | "human" | null = "chibi") {
  const L = local(b, x, z, face);
  const W = 0.5 * s; // çark ekseni (ileri)
  // volan: yatak taşı + taş disk (zeminde)
  L(W, 0.025 * s, 0, 0.14 * s, 0.05 * s, 0.14 * s, "#6B6158", "solid", 0);
  L(W, 0.11 * s, 0, 0.56 * s, 0.12 * s, 0.56 * s, "#8A7F72", "solid", 0.03);
  // mil, tabla, çamur testi
  L(W, 0.41 * s, 0, 0.05 * s, 0.48 * s, 0.05 * s, "#4A4E55", "solid", 0);
  L(W, 0.67 * s, 0, 0.34 * s, 0.04 * s, 0.34 * s, "#7A6E62", "solid", 0.02);
  L(W, 0.79 * s, 0, 0.18 * s, 0.2 * s, 0.18 * s, CLAY_WET, "solid", 0.03);
  L(W, 0.92 * s, 0, 0.13 * s, 0.06 * s, 0.13 * s, CLAY_WET, "solid", 0.03);
  L(W, 0.965 * s, 0, 0.16 * s, 0.03 * s, 0.16 * s, "#B5603F", "solid", 0.02);
  // ahşap çerçeve: dört ayak, iki yan ray, sıçrama teknesinin ön/arka tahtası
  for (const du of [0.22, 0.78]) for (const dv of [-0.3, 0.3]) L(du * s, 0.3 * s, dv * s, 0.05 * s, 0.6 * s, 0.05 * s, WOOD2, "solid", 0);
  for (const dv of [-0.3, 0.3]) L(W, 0.62 * s, dv * s, 0.62 * s, 0.05 * s, 0.06 * s, WOOD, "solid", 0.02);
  for (const du of [0.24, 0.76]) L(du * s, 0.64 * s, 0, 0.04 * s, 0.1 * s, 0.6 * s, WOOD, "solid", 0.02);
  // usta taburesi (dört ayaklı)
  L(0, 0.445 * s, 0, 0.28 * s, 0.05 * s, 0.4 * s, WOOD, "solid", 0.02);
  for (const du of [-0.1, 0.1]) for (const dv of [-0.15, 0.15]) L(du * s, 0.21 * s, dv * s, 0.04 * s, 0.42 * s, 0.04 * s, WOOD2, "solid", 0);
  // tezgâh yanında kil topakları ve su kovası
  L(W, 0.05 * s, 0.48 * s, 0.22 * s, 0.1 * s, 0.18 * s, "#B5603F", "solid", 0.08);
  L(0.12 * s, 0.09 * s, -0.42 * s, 0.16 * s, 0.18 * s, 0.16 * s, "#5B6470", "solid", 0.02);
  if (potterKind) potter(b, x, z, face, s, potterKind);
}

/**
 * Oturan çömlek ustası (taburede, `face` yönüne bakar; elleri çarktaki çamurda). Durağan figür: gömlek, kil lekeli önlük,
 * şalvar, kasket. `chibi` sahne oranı (iri baş), `human` harita insan oranı.
 */
export function potter(b: Box, x: number, z: number, face: Face, s = 1, kind: "chibi" | "human" = "chibi") {
  const L = local(b, x, z, face);
  const SKIN = "#C68B59", SHIRT = "#E9E1D0", APRON = "#8B5A3C", PANTS = "#4A4E5A", HAIR = "#3B2A20";
  const seat = 0.47 * s;
  // uyluklar (oturaktan çarka doğru) ve baldırlar (ayaklar volanın üstünde)
  L(0.16 * s, seat + 0.07 * s, 0, 0.34 * s, 0.14 * s, 0.3 * s, PANTS, "solid", 0.02);
  const f0 = 0.2 * s, k1 = seat + 0.1 * s;
  for (const dv of [-0.08, 0.08]) {
    L(0.33 * s, (f0 + k1) / 2, dv * s, 0.1 * s, k1 - f0, 0.1 * s, PANTS, "solid", 0.02);
    L(0.37 * s, 0.2 * s, dv * s, 0.16 * s, 0.06 * s, 0.1 * s, "#3A2A20", "solid", 0.02);
  }
  const tall = kind === "human" ? 0.5 : 0.36, head = kind === "human" ? 0.22 : 0.4;
  const t0 = seat + 0.14 * s, t1 = t0 + tall * s;
  // gövde (hafif öne eğik), önlük, kollar, eller çamurda
  L(0.02 * s, (t0 + t1) / 2, 0, 0.22 * s, t1 - t0, 0.34 * s, SHIRT, "solid", 0.02);
  L(0.145 * s, t0 + (t1 - t0) * 0.42, 0, 0.03 * s, (t1 - t0) * 0.84, 0.3 * s, APRON, "solid", 0.02);
  L(0.165 * s, t0 + (t1 - t0) * 0.3, 0.05 * s, 0.01, 0.08 * s, 0.1 * s, "#B5603F", "solid", 0);
  const sh = t1 - 0.07 * s, hy = 0.81 * s;
  for (const dv of [-1, 1]) {
    L(0.12 * s, sh, dv * 0.2 * s, 0.22 * s, 0.11 * s, 0.1 * s, SHIRT, "solid", 0.02);
    L(0.3 * s, (sh + hy) / 2, dv * 0.15 * s, 0.16 * s, Math.max(0.1 * s, sh - hy + 0.08 * s), 0.09 * s, SHIRT, "solid", 0.02);
    L(0.42 * s, hy, dv * 0.1 * s, 0.1 * s, 0.1 * s, 0.09 * s, SKIN, "solid", 0.02);
  }
  // baş ve kasket
  L(0.0, t1 + (head * s) / 2, 0, head * s, head * s, head * s, SKIN, "solid", 0.02);
  L(-0.01 * s, t1 + head * s + 0.03 * s, 0, head * 1.05 * s, 0.06 * s, head * 1.05 * s, HAIR, "solid", 0.02);
  L((head / 2 + 0.03) * s, t1 + head * s + 0.015 * s, 0, 0.08 * s, 0.03 * s, head * 0.7 * s, HAIR, "solid", 0); // siper
  L((head / 2 + 0.005) * s, t1 + head * 0.38 * s, 0, 0.01, 0.03 * s, head * 0.42 * s, "#4A3528", "solid", 0); // bıyık
}

// ------------------------------------------------------------------------------------------ fener
/** Asılı bakır fener (tepe noktası `y`, askı yukarıda yapışık; gece yanar). */
export function hangLantern(b: Box, x: number, y: number, z: number, s = 1) {
  b(x, y - 0.06 * s, z, 0.02, 0.12 * s, 0.02, "#4A3A2E", "solid", 0);
  b(x, y - 0.14 * s, z, 0.14 * s, 0.05 * s, 0.14 * s, "#8A5A32", "solid", 0);
  b(x, y - 0.25 * s, z, 0.12 * s, 0.17 * s, 0.12 * s, "#FFD08A", "glow", 0);
  b(x, y - 0.355 * s, z, 0.14 * s, 0.04 * s, 0.14 * s, "#8A5A32", "solid", 0);
}
