/**
 * W2-KAP / RB-KAP — Kapadokya şehir stili ve simge silüetleri ( Kapadokya kartı + kullanıcı kararı
 * 2026-10-18: simgeler sahnenin ortasında, ilk bakışta tanınır stilize voxel yorum). Palet özgündür: tüf tozu bej-pembe zemin,
 * bal rengi tüf, kırmızı-pembe vadi taşı, koyu bazalt şapka, kuru zeytin yeşili çimen, çömlek kırmızısı ve kilim renkleri.
 * bayrak, logo, livre, yazı yok. Kaya kiliseleri yalnız oyma dış cephedir (haç, ikon, fresk, iç mekân yok —).
 *
 * CITY-PASS-KAP (kalite seferberliği, kaynaklar): simgeler gerçeğe göre baştan.
 * - `chimney` peri bacası: yedi kademe daralan tüf koni, açık renk erozyon bandı, hafif eğim (karo başına belirlenimci), ince
 * boyun ve iki katlı koyu bazalt şapka (mantar). `trio` üçlü, `pasabag` ortak gövdeden ayrılan çok başlı baca.
 * - `castleRock` Uçhisar'ı andıran kale kayası (6 × 4 karo): moloz eteği üstünde düzensiz, geriye yaslanan beş tüf kademesi ve
 * tepe topuzu; kademelerde dikey erozyon oluğu, iki sıra bal peteği oyuk (bir kısmı beyaz çerçeveli güvercinlik, birkaçı gece
 * yanar), yan yüzlerde oyuklar; ön yüzde kayaya oyulmuş, korkuluk duvarlı ZİKZAK MERDİVEN (beş kol, her kol bir kademe çıkar;
 * kollar arasında sahanlık) zirvedeki korkuluklu seyir düzlüğüne çıkar; tabanda kemerli tünel girişi ve ahşap kapı.
 * - `rockChurches` Göreme açık hava müzesini andıran kaya kiliseleri: geride kaya kütlesi ve kapılı/pencereli koniler, solda
 * 6–7 katlı oyma manastır kütlesi (kat kat pencere ve kapı), önde sığ oyma cephe: at nalı kemerli iki kapı, kör kemer dizisi,
 * başlıklı plastırlar, silme, kademeli alınlık (haç yok); sağda üst kattaki kilise kapısına çıkan metal ziyaretçi merdiveni
 * (kapalı rıhtlı basamaklar, korkuluk, sahanlık). `sacredZone` çağıranın işidir.
 * - `chapelCone`, `caveHouse`, `ruinCone` (Zelve), `pasabag` ve küçük simgeler.
 * Balonlar, çömlek çarkı ve usta: `city/landmarks/kapadokya/kit.ts` (taban sahne, büyüme ve harita ortak).
*/
import { noteObject } from "../../rules/hooks";
import { tx, tz, type Builder } from "../../scenes";
import type { Layer } from "../kit";
import type { CityStyle } from "../style";

export const KAPADOKYA_STYLE: CityStyle = {
  id: "kapadokya",
  ground: {
    street: ["#CDB08C", "#C4A682"],   // vadi patikası (sıkıştırılmış tüf tozu)
    sidewalk: ["#DCC4A2", "#D3BA97"], // açık toprak
    plaza: ["#D8C3A6", "#CDB79A"],    // kesme tüf taş döşeme
    grass: ["#A6A55E", "#9B9C56"],    // kuru vadi çimeni
    quay: ["#BFA184", "#B49678"],     // kaya sekisi
    under: "#9C7E62",
  },
  water: "#B0674C",                // Kızılırmak'ı andıran kızıl nehir (kil yüklü)
  facade: "row",
  walls: ["#E8CFA8", "#E3BFA0", "#EAD7B8", "#D9B08E", "#E9C9B4"],
  trim: "#F2E6D0",
  roof: "flat",
  roofColor: "#C9A27E",
  window: "#4A3A30",
  windowLit: "#FFC978",
  door: "#6B4228",
  tree: "plane",
  lamp: { post: "#4A3A2E", glow: "#FFD08A" },
  awnings: ["#B9574A", "#3F7D6E", "#D9A441", "#7A5C99"],
  far: ["#D9B79A", "#CFA88C", "#E2C3A6"],
};

/** Simge paleti: kale tüfü (bal-krem), kilise tüfü (pembe), bazalt şapka, oyuk, güvercinlik çerçevesi. CITY-PASS-KAP: koyu
 *  bazalt (`capDark`), tüfün açık erozyon bandı (`band`), metal ziyaretçi merdiveni (`metal`). */
export const KAP = {
  tuff: "#E6CCA6", honey: "#DDB894", rose: "#D9A18C", cream: "#E9D3B0", cap: "#6E5A4C", hole: "#5A4436",
  castle: "#E4C8A0", castle2: "#D9B78F", castle3: "#EBD5B4", church: "#DDAE95", church2: "#CF9C84", trim: "#F2E6D0", wood: "#7A4E2A",
  capDark: "#5B4A40", band: "#F0DFC2", metal: "#4A4F55", gully: "#C9A47C",
} as const;

/** Katmana göre kutu: "grid" sahne bloğu, "backdrop" ufuk silüeti (Built.backdrop; +0 çizim çağrısı). */
export function P(b: Builder, layer: Layer, x: number, y: number, z: number, w: number, h: number, d: number, c: string, j = 0.04) {
  if (layer === "grid") b.box(x, y, z, w, h, d, c, "solid", j);
  else b.backdrop.push({ p: [x, y, z], s: [w, h, d], c, g: "solid", j });
}

/**
 * Peri bacası (dünya koordinatı; 13 kutu): dokuz kademe yumuşakça daralan tüf koni (dördüncü kademe açık erozyon bandı; pagoda
 * değil kesintisiz koni okunur), kademeler (x, z)'ye göre belirlenimci hafif eğimle kayar (dimdik sütun değil), ince boyun ve iki
 * katlı koyu bazalt şapka. Uç ≈ y0 + h + 0,54w.
 */
export function chimney(b: Builder, layer: Layer, x: number, z: number, h: number, w: number, tone: string, cap: string = KAP.cap, y0 = 0) {
  const seed = Math.abs(Math.round(x * 7.3 + z * 13.1)) % 5;
  const lx = (seed - 2) * 0.012 * w, lz = ((seed * 3) % 5 - 2) * 0.01 * w;
  let y = y0, k = 0;
  for (const [f, hf] of [[1, 0.15], [0.9, 0.13], [0.81, 0.12], [0.72, 0.11], [0.64, 0.11], [0.56, 0.1], [0.49, 0.1], [0.42, 0.09], [0.36, 0.09]] as const) {
    P(b, layer, x + lx * k, y + (h * hf) / 2, z + lz * k, w * f, h * hf, w * f, k === 3 ? KAP.band : tone);
    y += h * hf; k++;
  }
  const cx = x + lx * 8, cz = z + lz * 8;
  P(b, layer, cx, y + 0.09 * w, cz, w * 0.24, 0.18 * w, w * 0.24, tone);
  P(b, layer, cx, y + 0.25 * w, cz, w * 0.78, 0.14 * w, w * 0.78, KAP.capDark, 0.03);
  P(b, layer, cx, y + 0.38 * w, cz, w * 0.58, 0.12 * w, w * 0.58, cap, 0.03);
  P(b, layer, cx, y + 0.48 * w, cz, w * 0.3, 0.08 * w, w * 0.3, cap, 0.03);
}

/** Üçlü peri bacası (tek karo, engelli): ortak tüf kaide üstünde farklı boyda üç ince baca. */
export function trio(b: Builder, i: number, j: number, h: number, tone: string) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.3, z, 1.0, 0.6, 0.9, tone, "solid", 0.04);
  chimney(b, "grid", x - 0.28, z + 0.1, h, 0.5, tone, KAP.cap, 0.6);
  chimney(b, "grid", x + 0.08, z - 0.18, h * 0.82, 0.46, KAP.cream, KAP.cap, 0.6);
  chimney(b, "grid", x + 0.32, z + 0.2, h * 0.64, 0.42, tone, KAP.cap, 0.6);
  b.block(i, j);
}

/** Yuvarlatılmış kademe (3 kutu: çekirdek + iki çapraz şerit → sekizgenimsi taban). y taban. */
function tier(b: Builder, x: number, y: number, z: number, w: number, h: number, d: number, c: string, c2: string) {
  b.box(x, y + h / 2, z, w - 0.5, h, d - 0.5, c, "solid", 0.04);
  b.box(x, y + h / 2 - 0.05, z, w, h - 0.1, Math.max(0.3, d - 1.1), c2, "solid", 0.05);
  b.box(x, y + h / 2 - 0.05, z, Math.max(0.3, w - 1.1), h - 0.1, d, c2, "solid", 0.05);
}
/** Oyuk (yüzü +z): koyu açıklık; `rim` true ise beyaz badanalı güvercinlik çerçevesi; `lit` gece sabit yanan pencere. */
function hole(b: Builder, x: number, y: number, z: number, w: number, h: number, rim = false, lit = false) {
  if (rim) b.box(x, y, z - 0.01, w + 0.12, h + 0.12, 0.04, KAP.trim);
  b.box(x, y, z + 0.01, w, h, 0.04, KAP.hole);
  if (lit) b.props.push({ k: "window", p: [x, y, z + 0.05], r: 0, s: [w * 0.9, h * 0.9], c: KAPADOKYA_STYLE.windowLit });
}
/** Yan yüzde oyuk (yüzü ±x; `x` yüz düzlemi). */
function sideHole(b: Builder, x: number, y: number, z: number, sx: number, w = 0.26, h = 0.34) {
  b.box(x + sx * 0.01, y, z, 0.04, h, w, KAP.hole);
}

/**
 * Uçhisar'ı andıran kale kayası: (i0, j0) sol-arka köşe, 6 × 4 karo, ayak izi engelli. Moloz eteği (0,35) üstünde beş kademe
 * (her biri bir öncekinin içinde, geriye yaslı) + tepe topuzu; uç ≈ 10,4 (seyir korkuluğu). Merdiven kolları kademe
 * sahanlıklarına oturur, her basamak alttaki kayaya kadar dolu (kayaya oyulmuş), dış kenarında korkuluk duvarı.
 */
export function castleRock(b: Builder, i0: number, j0: number) {
  const w = 6, d = 4, X = (tx(i0) + tx(i0 + w - 1)) / 2, Z = (tz(j0) + tz(j0 + d - 1)) / 2;
  noteObject(b, "tower", [i0, j0], { w, d, floors: 1, y: 10.4, enclosed: true });
  // moloz eteği (ayak izi), kademeler: [genişlik, derinlik, yükseklik, dx, dz, renk, renk2]
  const BASE = 0.35;
  b.box(X, BASE / 2, Z, w, BASE, d, KAP.castle2, "solid", 0.06);
  const T: [number, number, number, number, number, string, string][] = [
    [5.6, 3.2, 2.2, 0, -0.4, KAP.castle, KAP.castle2], [4.8, 2.6, 2.0, -0.15, -0.65, KAP.castle3, KAP.castle],
    [4.0, 2.1, 1.9, 0.1, -0.85, KAP.castle, KAP.castle2], [3.2, 1.7, 1.6, -0.05, -1.0, KAP.castle3, KAP.castle],
    [2.4, 1.3, 1.3, 0.05, -1.1, KAP.castle, KAP.castle3],
  ];
  const tops: number[] = [];
  let y = BASE, n = 0;
  for (const [tw, td, th, dx, dz, c, c2] of T) {
    const cx = X + dx, cz = Z + dz, fz = cz + td / 2;
    tier(b, cx, y, cz, tw, th, td, c, c2);
    // pembe tüf damarı, dikey erozyon olukları (yüze yapışık)
    b.box(cx, y + th * 0.84, fz + 0.01, tw - 1.3, 0.1, 0.04, KAP.rose);
    for (const gx of [-0.32, 0.12, 0.38]) b.box(cx + gx * (tw - 1.2), y + th * 0.45, fz + 0.01, 0.14, th * 0.7, 0.04, KAP.gully);
    // bal peteği oyuklar: ön yüz (iki sıra; bir kısmı güvercinlik çerçeveli, birkaçı gece yanar)
    const cols = Math.max(2, Math.floor((tw - 1.4) / 0.5));
    for (const [ry, row] of [[0.32, 0], [0.64, 1]] as const) {
      for (let k = 0; k < cols; k++) {
        if ((k * 7 + row * 3 + n * 5) % 4 === 0) continue;
        const hx = cx - ((cols - 1) * 0.5) / 2 + k * 0.5 + (row ? 0.12 : 0);
        hole(b, hx, y + th * ry, fz, 0.22, 0.3, (k + n) % 3 === 0, (k * 5 + n + row) % 6 === 2);
      }
    }
    // yan yüzler (±x; ön-arka ortadaki tam genişlikli şeritte)
    for (const sx of [-1, 1]) {
      const zs = Math.max(0.15, (td - 1.1) / 2 - 0.15);
      for (const dzz of [-zs, zs]) sideHole(b, cx + sx * (tw / 2), y + th * (dzz > 0 ? 0.42 : 0.62), cz + dzz, sx);
    }
    y += th; n++;
    tops.push(y);
  }
  // tepe topuzu (arka) ve zirve seyir düzlüğü: döşeme + korkuluk (bayrak yok)
  const [tw4, td4, , dx4, dz4] = T[4];
  const top = tops[4], sx0 = X + dx4, sz0 = Z + dz4;
  b.box(sx0 + 0.1, top + 0.3, sz0 - 0.3, 1.4, 0.6, 0.6, KAP.castle3, "solid", 0.05);
  b.box(sx0 + 0.1, top + 0.68, sz0 - 0.32, 0.9, 0.16, 0.4, KAP.castle, "solid", 0.05);
  b.box(sx0, top + 0.03, sz0 + 0.26, tw4 - 0.5, 0.06, td4 - 0.62, KAP.cream, "solid", 0.02);
  const rx0 = sx0 - (tw4 - 0.5) / 2 + 0.04, rx1 = sx0 + (tw4 - 0.5) / 2 - 0.04, rz1 = sz0 + td4 / 2 - 0.05;
  for (let x = rx0; x <= rx1 + 1e-6; x += (rx1 - rx0) / 4) b.box(x, top + 0.29, rz1, 0.05, 0.5, 0.05, KAP.metal);
  b.box(sx0, top + 0.52, rz1, rx1 - rx0 + 0.05, 0.04, 0.05, KAP.metal);
  b.box(sx0, top + 0.32, rz1, rx1 - rx0 + 0.05, 0.03, 0.04, KAP.metal);
  for (const x of [rx0, rx1]) { b.box(x, top + 0.29, rz1 - 0.3, 0.05, 0.5, 0.05, KAP.metal); b.box(x, top + 0.52, rz1 - 0.15, 0.05, 0.04, 0.32, KAP.metal); }
  // zikzak merdiven: kollar (taban y, başlangıç x, yön, basamak sayısı, koşu, ön/arka z) — her kol bir kademenin önündeki
  // sahanlıkta, kademe yüzüne yaslı; basamak alttaki yüzeye kadar dolu; dış kenarda korkuluk duvarı ve küçük fener
  const FL: [number, number, number, number, number, number, number][] = [
    [BASE, X - 2.2, 1, 8, 0.34, Z + 1.2, Z + 1.62], [tops[0], X + 1.6, -1, 7, 0.34, Z + 0.65, Z + 1.05],
    [tops[1], X - 1.5, 1, 7, 0.34, Z + 0.2, Z + 0.6], [tops[2], X + 1.2, -1, 6, 0.34, Z - 0.15, Z + 0.18],
    [tops[3], X - 0.9, 1, 5, 0.3, Z - 0.45, Z - 0.17],
  ];
  FL.forEach(([y0, x0, dir, steps, run, zb, zf], f) => {
    const rise = ((f === 0 ? tops[0] : tops[f]) - y0) / steps, zc = (zb + zf) / 2, zd = zf - zb;
    for (let k = 0; k < steps; k++) {
      const sx = x0 + dir * (k + 0.5) * run, ty = y0 + (k + 1) * rise;
      b.box(sx, (y0 + ty) / 2, zc, run, ty - y0, zd, k % 2 ? KAP.cream : KAP.castle3, "solid", 0.03);
      b.box(sx, ty + 0.15, zf - 0.04, run, 0.3, 0.08, KAP.castle2, "solid", 0.03); // korkuluk duvarı
      if (k === steps - 1 && f % 2 === 0) b.box(sx, ty + 0.36, zf - 0.04, 0.1, 0.12, 0.1, "#FFD08A", "glow"); // basamak feneri
    }
  });
  // tabanda kemerli tünel girişi (ahşap kapı) ve kenarında küçük oyma pencere
  const fz0 = Z + 1.2;
  b.box(X + 1.75, BASE + 0.62, fz0 + 0.01, 0.56, 1.24, 0.04, KAP.hole);
  b.box(X + 1.75, BASE + 0.55, fz0 + 0.03, 0.44, 1.06, 0.03, "#6B4228");
  for (const [w0, yy] of [[0.7, 1.3], [0.52, 1.42]] as const) b.box(X + 1.75, BASE + yy, fz0 + 0.02, w0, 0.12, 0.05, KAP.rose);
  b.box(X + 1.3, BASE + 1.0, fz0 + 0.04, 0.1, 0.14, 0.08, "#FFD08A", "glow");
  // kademelerde küçük peri bacaları (kayanın üstünden yükselen kuleler)
  chimney(b, "grid", X + 2.52, Z - 1.0, 1.5, 0.5, KAP.rose, KAP.cap, tops[0]);
  chimney(b, "grid", X - 2.56, Z - 0.7, 1.8, 0.48, KAP.honey, KAP.cap, tops[0]);
  chimney(b, "grid", X + 2.0, Z - 1.4, 1.1, 0.4, KAP.rose, KAP.cap, tops[1]);
  for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) b.block(i, j);
  b.zones.push({ kind: "landmark", tag: "castle", i0, j0, w, d });
}

/** At nalı kemer oyuğu (yüzü +z, yüz düzlemi zf): dikdörtgen gövde + kademeli yay; `frame` söve rengi. */
function archHole(b: Builder, x: number, y0: number, zf: number, w: number, h: number, c: string, frame?: string) {
  const r = w / 2;
  if (frame) {
    b.box(x, y0 + (h - r) / 2, zf, w + 0.14, h - r, 0.03, frame);
    for (const [ww, yy] of [[w + 0.14, 0], [w * 0.84 + 0.12, 0.33], [w * 0.5 + 0.1, 0.66]] as const) b.box(x, y0 + h - r + yy * r + r * 0.17, zf, ww, r * 0.34 + 0.06, 0.03, frame);
  }
  b.box(x, y0 + (h - r) / 2, zf + 0.015, w, h - r, 0.035, c);
  for (const [ww, yy] of [[w, 0], [w * 0.84, 0.33], [w * 0.5, 0.66]] as const) b.box(x, y0 + h - r + yy * r + r * 0.17, zf + 0.015, ww, r * 0.34, 0.035, c);
}

/** Göreme açık hava müzesini andıran kaya kiliseleri: cephe karoları (i0…i0+w−1, j0) engelli, önündeki satır (j0+1) yürünür
 *  taş avlu; arkada (j0−2…j0−1, i0−1…i0+w−1) kaya kütlesi, kapılı/pencereli kaya konileri ve solda çok katlı manastır kütlesi.
 *  Cephe karonun arka 0,6'sında (önünde 0,4'lük ön basamak ve ziyaretçi merdiveni). Dinî simge, fresk, yazı yok. */
export function rockChurches(b: Builder, i0: number, j0: number, w: number) {
  const x0 = tx(i0) - 0.5, x1 = tx(i0 + w - 1) + 0.5, X = (x0 + x1) / 2, fz = tz(j0) + 0.1, H = 3.2;
  noteObject(b, "tower", [i0, j0], { w, d: 1, floors: 1, y: H, enclosed: true });
  // arka kaya kütlesi (iki satır, bir karo sola taşar) + yuvarlak sırt
  const bx0 = tx(i0 - 1) - 0.5, bX = (bx0 + x1) / 2, bw = x1 - bx0;
  b.box(bX, 2.3, tz(j0 - 1), bw, 4.6, 2 - 0.02, KAP.church2, "solid", 0.03);
  b.box(bX + 0.4, 4.9, tz(j0 - 1) - 0.2, bw - 2.2, 0.6, 1.4, KAP.church2, "solid", 0.05);
  for (let i = i0 - 1; i < i0 + w; i++) for (const j of [j0 - 2, j0 - 1]) b.block(i, j);
  // manastır kütlesi (Kızlar Manastırı'nı andırır; 6–7 kat): solda, kat kat pencere/kapı ve oyma sekiler (ön ve sol yüz)
  const mx = tx(i0 - 1), mz = tz(j0 - 1) - 0.45, MH = 6.6;
  b.box(mx, MH / 2, mz, 0.98, MH, 1.9, KAP.church, "solid", 0.04);
  b.box(mx + 0.05, MH + 0.25, mz - 0.1, 0.7, 0.5, 1.3, KAP.church, "solid", 0.05);
  for (let f = 0; f < 6; f++) {
    const yy = 0.7 + f * 0.95;
    b.box(mx, yy + 0.3, mz + 0.96, 0.98, 0.06, 0.06, KAP.church2); // kat silmesi (ön)
    archHole(b, mx + (f % 2 ? 0.18 : -0.18), yy - 0.05, mz + 0.95, 0.2, 0.34, KAP.hole);
    sideHole(b, mx - 0.49, yy, mz + (f % 2 ? 0.45 : -0.35), -1, 0.24, 0.3);
    sideHole(b, mx - 0.49, yy + 0.05, mz + (f % 2 ? -0.5 : 0.55), -1, 0.18, 0.24);
  }
  // kaya konileri (şapkasız, yuvarlak uçlu; kapı + pencere)
  for (const [cx, cz, h, cw] of [[X + 0.4, tz(j0 - 2) + 0.4, 7.2, 1.7], [x1 - 0.3, tz(j0 - 1) + 0.2, 5.8, 1.4]] as const) {
    let y = 0;
    for (const [f, hf] of [[1, 0.3], [0.82, 0.26], [0.62, 0.22], [0.4, 0.22]]) { b.box(cx, y + (h * hf) / 2, cz, cw * f, h * hf, cw * f, KAP.church, "solid", 0.04); y += h * hf; }
    b.box(cx, y + 0.1, cz, cw * 0.24, 0.2, cw * 0.24, KAP.church);
    b.box(cx, h * 0.72, cz + cw * 0.31 + 0.02, 0.22, 0.3, 0.04, KAP.hole);
    b.box(cx - 0.12, h * 0.5, cz + cw * 0.41 + 0.02, 0.2, 0.26, 0.04, KAP.hole);
  }
  // oyma cephe kütlesi (karonun arka 0,6'sı)
  const fd = 0.6, fc = fz - fd / 2;
  b.box(X, H / 2, fc, x1 - x0, H, fd, KAP.church, "solid", 0.03);
  // kademeli alınlık (üçgenimsi tepe; haç yok)
  for (const [k, ww] of [[0, 2.6], [1, 1.8], [2, 1.0]] as const) b.box(X, H + 0.15 + k * 0.3, fc, ww, 0.3, fd, KAP.church, "solid", 0.03);
  b.box(X, H + 0.62, fz + 0.01, 0.18, 0.22, 0.04, KAP.hole); // alınlıkta küçük yuvarlak pencere
  // silme, ön basamak, başlıklı plastırlar, at nalı kemerli iki kapı ve kör kemerler, üst pencereler
  b.box(X, 2.42, fz + 0.03, x1 - x0 - 0.1, 0.12, 0.06, KAP.trim);
  b.box(X, 3.12, fz + 0.03, x1 - x0, 0.1, 0.06, KAP.church2);
  b.box(X, 0.06, fz + 0.12, x1 - x0, 0.12, 0.24, KAP.church2, "solid", 0.03); // oyma ön basamak
  const bays = w * 2, bw2 = (x1 - x0 - 0.2) / bays;
  for (let k = 0; k <= bays; k += 2) {
    const px = x0 + 0.1 + k * bw2;
    b.box(px, 1.15, fz + 0.03, 0.12, 2.1, 0.05, KAP.trim);
    b.box(px, 2.25, fz + 0.04, 0.2, 0.12, 0.07, KAP.trim); // başlık
    b.box(px, 0.17, fz + 0.04, 0.18, 0.1, 0.07, KAP.trim); // kaide
  }
  for (let k = 0; k < bays; k++) {
    const bx = x0 + 0.1 + (k + 0.5) * bw2, door = k === 2 || k === 6;
    if (door) archHole(b, bx, 0.12, fz + 0.01, 0.42, 1.42, KAP.hole, KAP.church2);
    else archHole(b, bx, 1.05, fz + 0.005, 0.26, 0.86, KAP.church2);
    if (k % 2 === 0) b.box(bx, 2.78, fz + 0.03, 0.16, 0.26, 0.04, KAP.hole);
  }
  // sağda üst kattaki kilise kapısına metal ziyaretçi merdiveni (kapalı rıhtlı basamaklar, korkuluk, sahanlık; cepheye yaslı,
  // sağ uçtan sola doğru yükselir; zemin kapıları solda kalır)
  const sx0 = x1 - 0.1, run = 0.24, rise = 0.25, n = 8, zf = fz + 0.4, zc = fz + 0.2;
  for (let k = 0; k < n; k++) {
    const sx = sx0 - (k + 0.5) * run, ty = (k + 1) * rise;
    b.box(sx, ty - 0.03, zc, run, 0.06, 0.4, KAP.metal, "solid", 0.01); // basamak
    b.box(sx + run / 2 - 0.02, ty - rise / 2 - 0.01, zc, 0.04, rise + 0.05, 0.4, KAP.metal, "solid", 0); // rıht
    b.box(sx, ty + 0.3, zf - 0.02, 0.03, 0.6, 0.03, KAP.metal); // korkuluk dikmesi
    b.box(sx, ty + 0.58, zf - 0.02, run + 0.02, 0.03, 0.03, KAP.metal); // küpeşte parçası
  }
  const lx = sx0 - n * run - 0.3, ly = n * rise;
  b.box(lx, ly - 0.03, zc, 0.6, 0.06, 0.4, KAP.metal, "solid", 0.01); // sahanlık
  b.box(lx, ly / 2, fz + 0.03, 0.05, ly, 0.05, KAP.metal); // sahanlık dikmesi (cepheye yaslı)
  b.box(lx, ly + 0.58, zf - 0.02, 0.62, 0.03, 0.03, KAP.metal);
  b.box(lx - 0.29, ly + 0.3, zf - 0.02, 0.03, 0.6, 0.03, KAP.metal);
  archHole(b, lx, ly, fz + 0.035, 0.36, 0.78, KAP.hole, KAP.church2); // üst kilise kapısı
  for (let i = i0; i < i0 + w; i++) b.block(i, j0);
}

/** Şapkasız oyma şapel konisi (müze; tek karo, engelli): dört kademe, yuvarlak uç, kemerli kapı + iki pencere. Dinî simge yok. */
export function chapelCone(b: Builder, i: number, j: number, h: number, w = 1.0) {
  const x = tx(i), z = tz(j);
  let y = 0;
  for (const [f, hf] of [[1, 0.32], [0.8, 0.26], [0.6, 0.22], [0.38, 0.2]]) { b.box(x, y + (h * hf) / 2, z, w * f, h * hf, w * f, KAP.church, "solid", 0.04); y += h * hf; }
  b.box(x, y + 0.08, z, w * 0.22, 0.16, w * 0.22, KAP.church);
  archHole(b, x, 0.02, z + w / 2 + 0.005, 0.3, h * 0.26, KAP.hole, KAP.church2);
  b.box(x - 0.1, h * 0.46, z + w * 0.4 + 0.01, 0.16, 0.22, 0.04, KAP.hole);
  b.box(x + 0.08, h * 0.66, z + w * 0.3 + 0.01, 0.14, 0.18, 0.04, KAP.hole);
}

/** Kale köyünün mağara evi (i0…i0+w−1, j satırı, engelli; yüzü +z): iki kademeli yuvarlatılmış tüf kütle, kemerli ahşap kapı,
 *  beyaz çerçeveli pencereler (bir kısmı gece yanar), damda küçük peri bacası. */
export function caveHouse(b: Builder, i0: number, j: number, w: number, h: number, tone: string, lit = true) {
  const x = (tx(i0) + tx(i0 + w - 1)) / 2, z = tz(j), fz = z + 0.48;
  b.box(x, h * 0.36, z, w - 0.06, h * 0.72, 0.96, tone, "solid", 0.04);
  b.box(x, h * 0.86, z - 0.06, w - 0.42, h * 0.28, 0.76, tone, "solid", 0.05);
  b.box(x, h + 0.06, z - 0.08, Math.max(0.5, w * 0.46), 0.14, 0.46, tone, "solid", 0.04);
  b.box(x, h * 0.72 - 0.04, fz + 0.01, w - 0.2, 0.1, 0.04, KAP.rose);
  const dx = w > 1 ? -0.42 : -0.16;
  archHole(b, x + dx, 0.0, fz + 0.005, 0.36, 1.0, "#6B4228", KAP.rose);
  for (let k = 0; k < w; k++) hole(b, tx(i0 + k) + (w > 1 ? 0.22 : 0.18), Math.min(h * 0.5, 1.5), fz, 0.24, 0.3, true, lit && (i0 + k + j) % 2 === 0);
  if (h > 2.4) chimney(b, "grid", x + 0.22 * w - 0.2, z - 0.15, 0.9, 0.5, tone, KAP.cap, h * 0.72);
  for (let i = i0; i < i0 + w; i++) b.block(i, j);
}

/** Zelve'yi andıran terk edilmiş oyma koni (tek karo, engelli): şapkasız, aşınmış dört kademe; ön yüzü kısmen çökmüş (açık renk
 *  yara), çerçevesiz koyu oyuklar, dibinde moloz. Işık yok (terk edilmiş). */
export function ruinCone(b: Builder, i: number, j: number, h: number, tone: string, w = 1.0) {
  const x = tx(i), z = tz(j);
  let y = 0;
  for (const [f, hf] of [[1, 0.32], [0.8, 0.26], [0.6, 0.22], [0.38, 0.2]]) { b.box(x, y + (h * hf) / 2, z, w * f, h * hf, w * f, tone, "solid", 0.07); y += h * hf; }
  b.box(x + 0.06, y + 0.06, z, w * 0.18, 0.12, w * 0.18, tone);
  b.box(x + 0.2, h * 0.47, z + w * 0.4 + 0.01, 0.34, h * 0.24, 0.04, KAP.cream); // çökmüş yüz
  b.box(x + 0.2, h * 0.47, z + w * 0.4 + 0.03, 0.2, h * 0.14, 0.04, KAP.hole);
  b.box(x - 0.18, h * 0.16, z + w / 2 + 0.01, 0.26, h * 0.2, 0.04, KAP.hole);
  b.box(x - 0.12, h * 0.68, z + w * 0.3 + 0.01, 0.16, 0.2, 0.04, KAP.hole);
  b.box(x + w * 0.4 + 0.01, h * 0.3, z - 0.1, 0.04, 0.26, 0.2, KAP.hole);
  b.box(x + 0.3, 0.1, z + 0.45, 0.32, 0.2, 0.22, tone, "solid", 0.08);
  b.box(x - 0.36, 0.07, z + 0.42, 0.2, 0.14, 0.18, KAP.cream, "solid", 0.08);
  b.block(i, j);
}

/** Paşabağ'ı andıran çok şapkalı baca (tek karo, engelli): kalın ortak tüf gövde, üstünde farklı boyda üç boyun ve bazalt şapka. */
export function pasabag(b: Builder, i: number, j: number, h: number, tone: string) {
  const x = tx(i), z = tz(j), s = h * 0.4;
  b.box(x, s * 0.3, z, 0.98, s * 0.6, 0.94, tone, "solid", 0.04);
  b.box(x, s * 0.8, z, 0.8, s * 0.4, 0.76, KAP.band, "solid", 0.05);
  chimney(b, "grid", x - 0.2, z + 0.12, h * 0.56, 0.46, tone, KAP.cap, s);
  chimney(b, "grid", x + 0.22, z - 0.12, h * 0.44, 0.42, KAP.cream, KAP.cap, s);
  chimney(b, "grid", x + 0.12, z + 0.26, h * 0.3, 0.34, tone, KAP.cap, s);
  b.block(i, j);
}
