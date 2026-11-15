/**
 * Kapadokya şehir haritası: **Uçhisar** (kaya kalesi) landmarkları ve semt tasarımı.
 *
 * Bölgenin en yüksek noktası olan kaya kalesi (Uçhisar'ı andırır; gerçekte ≈ 60 m'lik doğal kaya, eteğinde eski köy): moloz
 * eteği üstünde, kuzeye (arkaya) yaslanan altı tüf kademesi ve zirve topuzu; kademelerde dikey erozyon olukları, sıra sıra bal
 * peteği oyuklar (bir kısmı beyaz çerçeveli güvercinlik, birkaçı gece yanar), yan yüzlerde oyuk sütunları, sahanlıklarda küçük
 * peri bacaları. Güney yüzünde kayaya oyulmuş ZİKZAK MERDİVEN: altı kol, her kol bir kademenin önündeki sahanlıkta bir kademe
 * yükselir; basamaklar alttaki kayaya kadar dolu, dış kenarda alçak korkuluk duvarı, kol uçlarında fenerler. Zirvede döşemeli,
 * dört yanı korkuluklu seyir düzlüğü. Tabanda (kapı karosunun önünde) kemerli tünel girişi ve ahşap kapı; etekte kaleye yaslı taş
 * köy evi. İçeride (iç mekân `castle`): oyma odalar → kaya içinden dönen merdiven → zirve terası (seyir). Kuzeyde Güvercinlik
 * vadisine bakan seyir noktası ve balon seyir çay bahçesi (`tea_garden`). Bayrak (kalede gerçekte olan) bilerek konmadı; yazı yok.
*/
import type { Block } from "../../../scenes";
import { sink, type DecorCtx, type DistrictDesign, type LandmarkCtx, type LandmarkModel, type Sink } from "../../../citymap/design";
import { placeVenue, venueSolidTiles } from "../../venues";
import { at, boxFar, chimney, cone, HOLE, holeZ, KAP } from "./kit";

/** Yuvarlatılmış kademe (3 kutu; sekizgenimsi taban). y taban; (x, z) merkez. */
function tier(b: Sink, x: number, y: number, z: number, w: number, h: number, d: number, c: string, c2: string) {
  b(x, y + h / 2, z, w - 0.8, h, d - 0.8, c, "solid", 0.05);
  b(x, y + h / 2 - 0.05, z, w, h - 0.1, Math.max(0.4, d - 1.8), c2, "solid", 0.06);
  b(x, y + h / 2 - 0.05, z, Math.max(0.4, w - 1.8), h - 0.1, d, c2, "solid", 0.06);
}

// ------------------------------------------------------------------------------------------ kaya kalesi (14 × 12, h 22)
/** Kademeler: [genişlik, derinlik, yükseklik, dx, dz] (merkez = ayak izi ortası + (dx, dz)); her biri bir öncekinin içinde. */
const TIERS: readonly [number, number, number, number, number][] = [
  [13.4, 11.0, 4.0, 0, 0.4], [11.6, 9.4, 3.6, -0.2, 1.1], [9.8, 7.8, 3.4, 0.2, 1.7], [8.0, 6.4, 3.2, 0, 2.2], [6.2, 5.0, 3.0, 0.1, 2.6],
  [4.4, 3.8, 2.4, 0, 2.9],
];
const APRON = 0.6;

function kale(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0 } = c, X = c.cx, Z = c.cz;
  const DX = x0 + 7.5; // kapı karosu (23, 21) ekseni
  // moloz eteği: kapı önü açık (ön orta), iki yan ve arka
  // TOUR-VIEW (LANDMARK-GARDEN-001): etek önünde kalenin dibinde yürünür taş patika (yerel lj 0, li 5–10): merdiven kolunun ve köy
  // evinin altında etek tam, aradaki ön şerit açık
  b(x0 + 2.6, APRON / 2, Z, 5.2, APRON, 12, KAP.castle2, "solid", 0.06);
  b(x0 + 6.0, APRON / 2, Z + 0.5, 1.6, APRON, 11, KAP.castle2, "solid", 0.06);
  b(x0 + 9.6, APRON / 2, Z + 0.5, 2.8, APRON, 11, KAP.castle2, "solid", 0.06);
  b(x0 + 12.5, APRON / 2, Z, 3.0, APRON, 12, KAP.castle2, "solid", 0.06);
  b(x0 + 8.0, 0.03, z0 + 0.5, 6.0, 0.06, 1.0, KAP.cream, "solid", 0.04);
  b(DX, APRON / 2, Z + 0.45, 1.4, APRON, 11.1, KAP.castle2, "solid", 0.06);
  // kademeler, olukları, oyukları
  const fronts: number[] = [], tops: number[] = [];
  let y = APRON;
  TIERS.forEach(([tw, td, th, dx, dz], n) => {
    const cx = X + dx, cz = Z + dz, fz = cz - td / 2;
    tier(b, cx, y, cz, tw, th, td, n % 2 ? KAP.castle3 : KAP.castle, n % 2 ? KAP.castle : KAP.castle2);
    b(cx, y + th * 0.86, fz - 0.01, tw - 2.2, 0.14, 0.04, KAP.rose, "solid", 0); // pembe tüf damarı
    b(cx + (n % 2 ? 0.3 : -0.32) * (tw - 2), y + th * 0.45, fz - 0.01, 0.22, th * 0.72, 0.04, KAP.gully, "solid", 0); // erozyon oluğu
    // bal peteği oyuklar (parsel bütçesi: kademe başına bir sıra; bir kısmı güvercinlik çerçeveli, birkaçı gece yanar)
    const cols = Math.max(2, Math.floor((tw - 2.2) / 1.2));
    for (let k = 0; k < cols; k++) {
      const hx = cx - ((cols - 1) * 1.2) / 2 + k * 1.2 + (n % 2 ? 0.35 : 0), hy = y + th * (k % 2 ? 0.58 : 0.34);
      holeZ(b, hx, hy, fz - 0.02, 0.3, 0.42, (k + n) % 3 === 0 ? KAP.trim : undefined);
      if (n < 4 && k === 1 + (n % 2)) b(hx, hy, fz - 0.06, 0.24, 0.34, 0.02, "#FFC978", "glow", 0);
    }
    // yan yüz oyuğu (tam genişlikli şeritte; kademe başına bir yan)
    { const sx = n % 2 ? 1 : -1; b(cx + sx * (tw / 2 + 0.01), y + th * 0.5, cz, 0.04, 0.42, 0.3, HOLE, "solid", 0); }
    // yan şişkinlikler (düzensiz siluet): alttaki kademenin sahanlığına oturan, kademeye yaslı kaya kabarıkları (n ≥ 1)
    if (n >= 1) for (const sx of [-1, 1]) {
      const lw = 0.9 + ((n + (sx > 0 ? 1 : 0)) % 3) * 0.2, lh = th * (0.55 + ((n * 3 + (sx > 0 ? 2 : 0)) % 4) * 0.1), lz = cz + (sx > 0 ? -0.6 : 0.4) * (td * 0.25);
      b(cx + sx * (tw / 2 + lw / 2 - 0.35), y + lh / 2, lz, lw, lh, td * 0.55, n % 2 ? KAP.castle2 : KAP.castle3, "solid", 0.06);
    }
    fronts.push(fz); y += th; tops.push(y);
  });
  // zirve topuzu (arkada) ve seyir düzlüğü: döşeme + dört yanda korkuluk (bayrak yok)
  const [tw5, td5, , dx5, dz5] = TIERS[5], top = tops[5], sx0 = X + dx5, sz0 = Z + dz5;
  b(sx0, top + 0.6, sz0 + td5 / 2 - 0.8, 2.6, 1.2, 1.6, KAP.castle3, "solid", 0.05);
  b(sx0, top + 1.3, sz0 + td5 / 2 - 0.8, 1.6, 0.2, 1.0, KAP.castle, "solid", 0.05);
  const pz0 = fronts[5] + 0.1, pz1 = sz0 + td5 / 2 - 1.6, px0 = sx0 - tw5 / 2 + 0.95, px1 = sx0 + tw5 / 2 - 0.95;
  b((px0 + px1) / 2, top + 0.04, (pz0 + pz1) / 2, px1 - px0, 0.08, pz1 - pz0, KAP.cream, "solid", 0.02);
  for (let k = 0; k <= 4; k++) { const x = px0 + (k * (px1 - px0)) / 4; b(x, top + 0.42, pz0 + 0.03, 0.06, 0.7, 0.06, KAP.metal, "solid", 0); }
  b((px0 + px1) / 2, top + 0.74, pz0 + 0.03, px1 - px0 + 0.06, 0.05, 0.06, KAP.metal, "solid", 0);
  b((px0 + px1) / 2, top + 0.44, pz0 + 0.03, px1 - px0 + 0.06, 0.04, 0.05, KAP.metal, "solid", 0);
  for (const x of [px0, px1]) {
    b(x, top + 0.42, pz1 - 0.03, 0.06, 0.7, 0.06, KAP.metal, "solid", 0);
    b(x, top + 0.74, (pz0 + pz1) / 2, 0.06, 0.05, pz1 - pz0, KAP.metal, "solid", 0);
  }
  b(px1 - 0.2, top + 0.9, pz0 + 0.3, 0.14, 0.2, 0.14, "#FFD08A", "glow", 0); // zirve feneri (direğe oturur)
  b(px1 - 0.2, top + 0.42, pz0 + 0.3, 0.05, 0.7, 0.05, KAP.metal, "solid", 0);
  // zikzak merdiven: kol n, kademe n'in önündeki sahanlıkta, kademe n+1'in yüzüne yaslı (ilk kol eteğin üstünde, T0 yüzüne);
  // [başlangıç x, yön, basamak sayısı, koşu]
  const FL: [number, number, number, number][] = [[x0 + 1.0, 1, 8, 0.5], [x0 + 5.9, 1, 8, 0.5], [x0 + 9.8, -1, 7, 0.5],
    [x0 + 6.2, 1, 7, 0.5], [x0 + 9.3, -1, 6, 0.5], [x0 + 5.6, 1, 5, 0.5]];
  FL.forEach(([sx, dir, n, run], f) => {
    const y0 = f === 0 ? APRON : tops[f - 1], y1 = tops[f], rise = (y1 - y0) / n;
    const zb = fronts[f], zf = zb - 0.6, zc = (zb + zf) / 2;
    for (let k = 0; k < n; k++) {
      const x = sx + dir * (k + 0.5) * run, ty = y0 + (k + 1) * rise;
      b(x, (y0 + ty) / 2, zc, run, ty - y0, 0.6, k % 2 ? KAP.cream : KAP.castle3, "solid", 0.03);
      // korkuluk duvarı: iki basamakta bir parça (alttaki basamağın üstünden üstteki basamağın 0,3 yukarısına)
      if (k % 2 === 0) {
        const k2 = Math.min(n - 1, k + 1), x2 = sx + dir * (k2 + 0.5) * run, ty2 = y0 + (k2 + 1) * rise;
        b((x + x2) / 2, (ty + ty2 + 0.3) / 2, zf + 0.05, run * (k2 - k + 1), ty2 + 0.3 - ty, 0.1, KAP.castle2, "solid", 0.03);
      }
    }
    if (f % 2 === 1) { // kol ucu feneri (korkuluk üstünde)
      const ex = sx + dir * n * run;
      b(ex - dir * 0.15, y1 + 0.4, zf + 0.05, 0.12, 0.2, 0.12, "#FFD08A", "glow", 0);
    }
  });
  // tünel girişi (kapı karosunun önünde, T0 yüzünde): kemer, söve, ahşap kapı, aplik
  const fz0 = fronts[0];
  holeZ(b, DX, 1.0, fz0 - 0.02, 1.0, 2.0, KAP.trim);
  for (const [ww, yy] of [[0.8, 2.1], [0.5, 2.22]] as const) b(DX, yy, fz0 - 0.02, ww, 0.12, 0.06, HOLE, "solid", 0);
  b(DX, 1.0, fz0 - 0.06, 0.86, 1.9, 0.03, "#6B4228", "solid", 0);
  for (const s of [-1, 1]) b(DX + s * 0.75, 1.9, fz0 - 0.05, 0.12, 0.18, 0.08, "#FFD08A", "glow", 0);
  // etekte kaleye yaslı taş köy evi (sağ ön; eteğin üstünde)
  const hx = x0 + 12.4, hz = z0 + 0.55;
  b(hx, APRON + 1.2, hz, 2.0, 2.4, 0.9, "#EAD7B8", "solid", 0.04);
  b(hx, APRON + 2.45, hz, 2.2, 0.1, 1.0, "#C9A27E", "solid", 0.02);
  holeZ(b, hx - 0.5, APRON + 0.6, hz - 0.46, 0.5, 1.1, "#B98670");
  holeZ(b, hx + 0.5, APRON + 1.5, hz - 0.46, 0.4, 0.42);
  // sahanlıklarda küçük peri bacaları (yanlarda)
  chimney(b, x0 + 2.2, z0 + 1.65, 2.4, 0.9, KAP.rose, KAP.cap, tops[0]);
  chimney(b, x0 + 11.6, z0 + 1.65, 2.0, 0.8, KAP.honey, KAP.cap, tops[0]);
  return out;
}
function kaleFar(c: LandmarkCtx): Block[] {
  const box = (y0: number, y1: number, k: number): Block => ({ p: [c.cx + TIERS[k][3], (y0 + y1) / 2, c.cz + TIERS[k][4]], s: [TIERS[k][0] - 0.4, y1 - y0, TIERS[k][1] - 0.4], c: k % 2 ? KAP.castle : KAP.castle2, g: "solid", j: 0 });
  return [box(0, 8.2, 0), box(8.2, 14.8, 2), box(14.8, 20.2, 4), box(20.2, 21.4, 5)];
}

// ------------------------------------------------------------------------------------------ mağara köy evleri (8 × 4)
function koyEvleri(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0, w, d } = c;
  // kayaya yaslanmış kesme taş cepheli evler: iki kat, kemerli kapılar, ahşap balkon (konsollu), çatıda kuruyan kayısı
  b(c.cx, 2.2, z0 + d - 1.0, w, 4.4, 2.0, KAP.honey, "solid", 0.06);
  for (const [k, ww, hh, tone] of [[0, 3.6, 2.6, "#EAD7B8"], [1, 3.8, 3.2, "#E3BFA0"]] as const) {
    const x = x0 + 0.3 + ww / 2 + k * (w - ww - 0.6);
    b(x, hh / 2, z0 + 1.4, ww, hh, 2.0, tone, "solid", 0.04);
    b(x, hh + 0.08, z0 + 1.4, ww + 0.2, 0.16, 2.2, "#C9A27E", "solid", 0.02);
    holeZ(b, x - 0.8, 0.6, z0 + 0.38, 0.5, 1.1, "#B98670");
    holeZ(b, x + 0.7, 1.7, z0 + 0.38, 0.4, 0.45);
    b(x, hh + 0.19, z0 + 1.4, ww * 0.6, 0.06, 1.2, "#E8892E", "solid", 0.08);
  }
  // ahşap balkon: döşeme duvara yaslı, iki konsol, korkuluk
  const bx = x0 + w - 2.2;
  b(bx, 1.65, z0 + 0.15, 2.0, 0.08, 0.5, "#6B4A2E", "solid", 0);
  for (const dx of [-0.8, 0.8]) b(bx + dx, 1.45, z0 + 0.32, 0.08, 0.32, 0.16, "#6B4A2E", "solid", 0);
  b(bx, 1.98, z0 - 0.07, 2.0, 0.05, 0.05, "#6B4A2E", "solid", 0);
  for (const dx of [-0.95, 0, 0.95]) b(bx + dx, 1.84, z0 - 0.07, 0.05, 0.3, 0.05, "#6B4A2E", "solid", 0);
  return out;
}

export const UCHISAR_LANDMARKS: Record<string, LandmarkModel> = {
  uchisar_kalesi: { garden: { kind: "grounds", rects: [[0, 0, 14, 1]], gates: [], floor: "plaza" }, near: kale, far: kaleFar, ip_risk: 0, culture_risk: 0,
    note: "Kaya kalesi (Uçhisar'ı andırır): arkaya yaslanan tüf kademeleri, bal peteği oyuklar ve beyaz çerçeveli güvercinlikler, güney yüzünde kayaya oyulmuş zikzak merdiven, zirvede korkuluklu seyir düzlüğü, tabanda tünel girişi. Bayrak yok; içeride oyma odalar, kaya merdiveni ve zirve terası." },
  magara_evleri: { near: koyEvleri, far: boxFar(KAP.honey, 0.9), ip_risk: 0, culture_risk: 0,
    note: "Kale eteğinde mağara köy evleri: kesme taş cephe, kemerli kapılar, ahşap balkon, çatıda kuruyan kayısı; işletme adı yok." },
};

// ------------------------------------------------------------------------------------------ semt tasarımı
/** Balon seyir çay bahçesi (seyir noktasının yanında; tezgâh li 27–29 × lj 49, sipariş (28, 48), masa (28, 47)). */
export const UCHISAR_TEA: [number, number] = [28, 49];

function uchisarDecor(c: DecorCtx): Block[] {
  const out: Block[] = [], b = sink(out), p = at(c);
  // (STREET-BLOCKED-001): (40, 18) bacası iki parsel arasındaki 2 karoluk sokağı bütün eninden kapatıyordu → (31, 14) meydan köşesi
  for (const [li, lj, h] of [[6, 14, 5.4], [31, 14, 6.0], [42, 44, 4.8], [10, 56, 5.8], [34, 58, 5.0]] as const) chimney(b, p.x(li), p.z(lj), h, 1.4, KAP.tuff);
  for (const [li, lj] of [[4, 30], [44, 30]] as const) cone(b, p.x(li), p.z(lj), 4.4, 2.0, KAP.castle2, 3);
  // seyir noktası korkuluğu (Güvercinlik vadisine bakan teras kenarı): dikmeler zeminde, küpeşte dikmelere oturur
  for (let k = 0; k <= 5; k++) b(p.x(21) + k * 1.4, 0.3, p.z(50) + 0.45, 0.06, 0.6, 0.06, "#6B4A2E", "solid", 0);
  b(p.x(24.5), 0.58, p.z(50) + 0.45, 7.06, 0.05, 0.06, "#6B4A2E", "solid", 0);
  // balon seyir çay bahçesi (yürüme ölçeği; ocakçı tezgâhın ardında)
  placeVenue(b, "tea_garden", p.x(UCHISAR_TEA[0]), p.z(UCHISAR_TEA[1]), "-z", "walk");
  // gizli köşeler: eski fırın oyuğu ve kurutmalık kayısı sergisi (yere serili tepsi)
  b(p.x(2), 0.35, p.z(2) - 0.5, 0.9, 0.7, 0.3, "#9C7E62"); b(p.x(2), 0.3, p.z(2) - 0.34, 0.4, 0.4, 0.04, HOLE); // gizli köşe süsü karonun kenarında (avatar gövdesi süse girmez)
  b(p.x(45), 0.03, p.z(60), 0.9, 0.06, 0.9, "#8E6A48"); b(p.x(45), 0.09, p.z(60), 0.7, 0.06, 0.7, "#E8892E", "solid", 0.1);
  return out;
}

/**
 * Uçhisar (48 × 64; şehir karosu [−48, −80]). Kuzey kenar (lj 63) Vadiler'e yürünür patika. Kale [16, 22] (kapı (23, 21)),
 * köy evleri [4, 40], minibüs durağı (36, 10), Güvercinlik vadisine bakan seyir noktası (24, 49) ve yanında çay bahçesi.
 * CITY-PASS-KAP: kalenin doğusunda 3 karoluk meydan şeridi (li 30–32; eskiden tek karoluk koridordu).
 */
export const UCHISAR_DESIGN: DistrictDesign = {
  pave: [[22, 34, 3, 30], [0, 18, 16, 2], [30, 8, 18, 3]],
  plaza: [[18, 46, 12, 6], [14, 12, 18, 9], [30, 21, 3, 14]],
  solid: [[6, 14, 1, 1], [31, 14, 1, 1], [42, 44, 1, 1], [10, 56, 1, 1], [34, 58, 1, 1], [3, 29, 3, 3], [43, 29, 3, 3],
    ...venueSolidTiles("tea_garden", "-z").map(([di, dj]): [number, number, number, number] => [UCHISAR_TEA[0] + di, UCHISAR_TEA[1] + dj, 1, 1])],
  buildings: [
    { i0: 36, j0: 24, w: 6, d: 4, h: 3.2, wall: "#E3BFA0", roof: "#C9A27E" },
    { i0: 4, j0: 22, w: 6, d: 5, h: 2.8, wall: "#D9B08E", roof: "#BFA184" },
  ],
  hidden: [[2, 2], [45, 60]],
  decor: uchisarDecor,
};
