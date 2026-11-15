/**
 * W3 (WALK-FUN) — kalabalığın VAR OLAN örnek dizilerinde ayrılmış küçük nesne yuvaları (+0 çizim çağrısı, §9).
 *
 * `fx` dizisi boşken gizlidir (+0) ama dolunca +1 çağrı olur; masa süsleri (bitki, kupa) ve keyif rozeti sürekli göründüğü
 * için onları kalabalığın her zaman çizilen `solid` ve `glow` dizilerinin sonundaki sabit yuvalara yazarız. Kare başı
 * doldurulur (`pbox` / `pseg`), Crowd kare sonunda matris ve renkleri yazar, kullanılmayan yuvaları sıfırlar.
 * Hediye eşyaları (fincan, bardak, tabak, pasta, saksı, kupa, not, kurye kutusu), olta takımı, parşömen dışı el eşyaları burada.
 */
import { C, paletteIndex } from "./fx";
import type { HeldItem } from "./rituals";

export const PROP_SOLID = 112;
export const PROP_GLOW = 72;
const STRIDE = 10;

export interface PropPool {
  solid: Float32Array; ns: number;
  glow: Float32Array; ng: number;
  /** önceki karede yazılan sayılar (fazlası sıfırlanır) */
  prevS: number; prevG: number;
}

export function createPropPool(): PropPool {
  return { solid: new Float32Array(PROP_SOLID * STRIDE), ns: 0, glow: new Float32Array(PROP_GLOW * STRIDE), ng: 0, prevS: 0, prevG: 0 };
}

/** Kutu: merkez, boyut, yaw/pitch/roll ("YXZ"), fx paleti rengi. Tavan dolduysa sessizce atlanır. */
export function pbox(pp: PropPool, glow: boolean, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, pitch: number, roll: number, col: number) {
  const n = glow ? pp.ng : pp.ns;
  if (n >= (glow ? PROP_GLOW : PROP_SOLID)) return;
  if (TILT.on) {
    // ACTIVITY-CAM: elde eğik eşya (bardak ağza eğilir) — kutu tabana göre yan eksen çevresinde döner
    const fx = Math.sin(TILT.yaw), fz = Math.cos(TILT.yaw), dx = x - TILT.x, dy = y - TILT.y, dz = z - TILT.z;
    const lf = dx * fx + dz * fz, ls = dx * fz - dz * fx, c = Math.cos(TILT.a), s = Math.sin(TILT.a);
    const ly2 = dy * c - lf * s, lf2 = dy * s + lf * c;
    x = TILT.x + fx * lf2 + fz * ls; y = TILT.y + ly2; z = TILT.z + fz * lf2 - fx * ls;
    pitch += TILT.a;
  }
  const a = glow ? pp.glow : pp.solid, o = n * STRIDE;
  a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = sx; a[o + 4] = sy; a[o + 5] = sz; a[o + 6] = yaw; a[o + 7] = pitch; a[o + 8] = roll; a[o + 9] = col;
  if (glow) pp.ng++; else pp.ns++;
}

/** İki nokta arası ince çubuk (olta, misina). */
export function pseg(pp: PropPool, glow: boolean, ax: number, ay: number, az: number, bx: number, by: number, bz: number, thick: number, col: number) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  pbox(pp, glow, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, thick, thick, len, Math.atan2(dx, dz), -Math.atan2(dy, Math.hypot(dx, dz)), 0, col);
}

/** Kalan yuva (öncelik: elde tutulanlar önce yazılır, masa süsleri sonra). */
export const solidLeft = (pp: PropPool) => PROP_SOLID - pp.ns;

// ------------------------------------------------------------------ eşya modelleri (dünya birimi; (x, y, z) tabanın ortası)
/** voxel ölçeği: eşyalar karaktere göre biraz abartılı (uzak takip kamerasında okunur kalsın) */
const ITEM_SCALE = 1.6;
/** Var olan eşyalar (W3 hediyeleri) + elde tüketilebilirler. Liste testte sayılır.*/
export const ITEM_MODELS = [
  "note", "coffee", "tea", "snack", "meal", "dessert", "plant", "trophy", "parcel", "cup",
  "simit", "tea_glass", "crepe", "sandwich", "paper_cone", "hotdog", "coconut", "bento", "bowl", "hammer", "peas",
] as const;
export type ItemModel = (typeof ITEM_MODELS)[number];
/** elde tüketilebilir modelin kutu tavanı (yuva bütçesi; `held_items.test.mjs`).*/
export const HELD_MAX_BOXES = 6;

/** ACTIVITY-CAM: `drawItem` eğimi (rad; + üst kenar ileri, − kendine doğru). Yalnız çizim süresince açık. */
const TILT = { on: false, x: 0, y: 0, z: 0, yaw: 0, a: 0 };

/** Bir eşyayı tabanı (x, y, z) olacak biçimde çizer; `s` ölçek, `yaw` yön. Kutu sayısı 1–4 ( elde eşyaları ≤ 6).
 * ACTIVITY-CAM: `tilt` ≠ 0 → eşya tabanı çevresinde yan eksende eğilir (bardak ağza).*/
export function drawItem(pp: PropPool, m: ItemModel, x: number, y: number, z: number, yaw: number, s = 1, tilt = 0) {
  if (tilt) {
    TILT.on = true; TILT.x = x; TILT.y = y; TILT.z = z; TILT.yaw = yaw; TILT.a = tilt;
    try { drawItem(pp, m, x, y, z, yaw, s, 0); } finally { TILT.on = false; }
    return;
  }
  s *= ITEM_SCALE;
  switch (m) {
    case "note":
      pbox(pp, false, x, y + 0.01 * s, z, 0.13 * s, 0.015 * s, 0.17 * s, yaw, 0, 0, C.paper);
      pbox(pp, false, x, y + 0.02 * s, z, 0.09 * s, 0.006 * s, 0.02 * s, yaw, 0, 0, C.red);
      break;
    case "coffee": case "cup":
      pbox(pp, false, x, y + 0.05 * s, z, 0.085 * s, 0.1 * s, 0.085 * s, yaw, 0, 0, C.white);
      pbox(pp, false, x, y + 0.101 * s, z, 0.07 * s, 0.006 * s, 0.07 * s, yaw, 0, 0, C.coffee);
      pbox(pp, false, x + Math.cos(yaw) * 0.055 * s, y + 0.055 * s, z - Math.sin(yaw) * 0.055 * s, 0.025 * s, 0.05 * s, 0.02 * s, yaw, 0, 0, C.white);
      break;
    case "tea":
      // ince belli bardak + tabak
      pbox(pp, false, x, y + 0.006 * s, z, 0.11 * s, 0.012 * s, 0.11 * s, yaw, 0, 0, C.white);
      pbox(pp, false, x, y + 0.06 * s, z, 0.055 * s, 0.1 * s, 0.055 * s, yaw, 0, 0, C.tea);
      pbox(pp, false, x, y + 0.115 * s, z, 0.065 * s, 0.012 * s, 0.065 * s, yaw, 0, 0, C.white);
      break;
    case "snack":
      pbox(pp, false, x, y + 0.015 * s, z, 0.1 * s, 0.03 * s, 0.1 * s, yaw + 0.4, 0, 0, C.brown);
      pbox(pp, false, x, y + 0.032 * s, z, 0.03 * s, 0.006 * s, 0.03 * s, yaw, 0, 0, C.coffee);
      break;
    case "dessert":
      pbox(pp, false, x, y + 0.006 * s, z, 0.13 * s, 0.012 * s, 0.13 * s, yaw, 0, 0, C.white);
      pbox(pp, false, x, y + 0.045 * s, z, 0.1 * s, 0.065 * s, 0.08 * s, yaw, 0, 0, C.cream);
      pbox(pp, false, x, y + 0.085 * s, z, 0.1 * s, 0.018 * s, 0.08 * s, yaw, 0, 0, C.cake);
      pbox(pp, false, x, y + 0.105 * s, z, 0.025 * s, 0.025 * s, 0.025 * s, yaw, 0, 0, C.red);
      break;
    case "meal":
      pbox(pp, false, x, y + 0.01 * s, z, 0.28 * s, 0.02 * s, 0.19 * s, yaw, 0, 0, C.tray);
      pbox(pp, false, x, y + 0.03 * s, z, 0.15 * s, 0.015 * s, 0.15 * s, yaw, 0, 0, C.white);
      pbox(pp, false, x - 0.02 * s, y + 0.05 * s, z, 0.06 * s, 0.03 * s, 0.07 * s, yaw, 0, 0, C.orange);
      pbox(pp, false, x + 0.035 * s, y + 0.048 * s, z + 0.02 * s, 0.05 * s, 0.025 * s, 0.05 * s, yaw, 0, 0, C.green);
      break;
    case "plant":
      pbox(pp, false, x, y + 0.06 * s, z, 0.12 * s, 0.12 * s, 0.12 * s, yaw, 0, 0, C.clay);
      pbox(pp, false, x, y + 0.17 * s, z, 0.14 * s, 0.12 * s, 0.1 * s, yaw + 0.5, 0, 0, C.green);
      pbox(pp, false, x, y + 0.25 * s, z, 0.08 * s, 0.1 * s, 0.08 * s, yaw, 0, 0.3, C.leaf);
      break;
    case "trophy":
      pbox(pp, false, x, y + 0.02 * s, z, 0.12 * s, 0.04 * s, 0.1 * s, yaw, 0, 0, C.dark);
      pbox(pp, false, x, y + 0.08 * s, z, 0.03 * s, 0.08 * s, 0.03 * s, yaw, 0, 0, C.gold);
      pbox(pp, false, x, y + 0.16 * s, z, 0.11 * s, 0.09 * s, 0.09 * s, yaw, 0, 0, C.gold);
      pbox(pp, false, x, y + 0.17 * s, z, 0.17 * s, 0.03 * s, 0.03 * s, yaw, 0, 0, C.yellow);
      break;
    case "parcel":
      pbox(pp, false, x, y + 0.11 * s, z, 0.22 * s, 0.22 * s, 0.22 * s, yaw, 0, 0, C.parcel);
      pbox(pp, false, x, y + 0.11 * s, z, 0.24 * s, 0.05 * s, 0.24 * s, yaw, 0, 0, C.yellow);
      pbox(pp, false, x, y + 0.11 * s, z, 0.05 * s, 0.24 * s, 0.24 * s, yaw, 0, 0, C.yellow);
      break;
    default:
      drawConsumable(pp, m, x, y, z, yaw, s);
  }
}

// ------------------------------------------------------------------ elde tüketilebilirler (§3.3; her biri ≤ 6 kutu)
// Renkler fx paletinden; yoksa `paletteIndex` ile palete eklenir (yalnız yuva rengi; malzeme ve çizim çağrısı değişmez).
const K = {
  crust: paletteIndex("#C98A3D"), bread: paletteIndex("#D9A35B"), crepe: paletteIndex("#E7B868"), fish: paletteIndex("#8C8273"),
  sausage: paletteIndex("#B4532A"), glaze: paletteIndex("#3F6B4A"), matcha: paletteIndex("#9CC25A"), kraft: paletteIndex("#C9A46A"),
  kraftDark: paletteIndex("#A9824C"),
};

/** Yerel ofsetli kutu: (lx, ly, lz) eşyanın kendi ekseninde (lx sağ, lz ileri; `yaw` ile döner). Değerler ölçeksiz. */
function lb(pp: PropPool, x: number, y: number, z: number, yaw: number, s: number, lx: number, ly: number, lz: number,
  sx: number, sy: number, sz: number, col: number, dyaw = 0, roll = 0) {
  const c = Math.cos(yaw), n = Math.sin(yaw);
  pbox(pp, false, x + (lx * c + lz * n) * s, y + ly * s, z + (-lx * n + lz * c) * s, sx * s, sy * s, sz * s, yaw + dyaw, 0, roll, col);
}

function drawConsumable(pp: PropPool, m: ItemModel, x: number, y: number, z: number, yaw: number, s: number) {
  switch (m) {
    case "simit": {
      // susamlı halka: dört çubuklu kare halka + iki susam (yukarıdan bakan takip kamerasında delik okunur)
      const R = 0.075, w = 0.032, e = R - w / 2;
      lb(pp, x, y, z, yaw, s, 0, 0.015, e, 2 * R, 0.03, w, K.crust);
      lb(pp, x, y, z, yaw, s, 0, 0.015, -e, 2 * R, 0.03, w, K.crust);
      lb(pp, x, y, z, yaw, s, e, 0.015, 0, w, 0.03, 2 * R - 2 * w, K.crust);
      lb(pp, x, y, z, yaw, s, -e, 0.015, 0, w, 0.03, 2 * R - 2 * w, K.crust);
      lb(pp, x, y, z, yaw, s, 0.03, 0.032, e, 0.02, 0.008, 0.012, C.cream);
      lb(pp, x, y, z, yaw, s, -e, 0.032, -0.02, 0.012, 0.008, 0.02, C.cream);
      break;
    }
    case "tea_glass":
      // ince belli bardak ve tabak: tabak, şişkin alt, ince bel, açılan üst, ağız
      lb(pp, x, y, z, yaw, s, 0, 0.006, 0, 0.12, 0.012, 0.12, C.white);
      lb(pp, x, y, z, yaw, s, 0, 0.032, 0, 0.062, 0.04, 0.062, C.tea);
      lb(pp, x, y, z, yaw, s, 0, 0.064, 0, 0.044, 0.025, 0.044, C.tea);
      lb(pp, x, y, z, yaw, s, 0, 0.099, 0, 0.068, 0.045, 0.068, C.tea);
      lb(pp, x, y, z, yaw, s, 0, 0.125, 0, 0.072, 0.008, 0.072, C.white);
      break;
    case "crepe":
      // katlanmış krep kâğıt kılıfta: kılıf, gövde, üçgen uç (45° kutu), çikolata çizgisi
      lb(pp, x, y, z, yaw, s, 0, 0.035, 0, 0.1, 0.07, 0.035, C.paper);
      lb(pp, x, y, z, yaw, s, 0, 0.095, 0, 0.11, 0.05, 0.03, K.crepe);
      lb(pp, x, y, z, yaw, s, 0, 0.118, 0, 0.065, 0.065, 0.03, K.crepe, 0, Math.PI / 4);
      lb(pp, x, y, z, yaw, s, 0, 0.1, 0, 0.1, 0.012, 0.033, C.coffee);
      break;
    case "sandwich":
      // balık ekmek: alt ekmek, marul, balık, üst ekmek
      lb(pp, x, y, z, yaw, s, 0, 0.02, 0, 0.22, 0.04, 0.08, K.bread);
      lb(pp, x, y, z, yaw, s, 0, 0.046, 0, 0.2, 0.012, 0.09, C.green);
      lb(pp, x, y, z, yaw, s, 0, 0.066, 0, 0.18, 0.028, 0.07, K.fish);
      lb(pp, x, y, z, yaw, s, 0, 0.1, 0, 0.22, 0.045, 0.08, K.bread);
      break;
    case "paper_cone":
      // kâğıt külah (tane yem, balık-patates): daralan üç kat + dolgu + çıkıntı
      lb(pp, x, y, z, yaw, s, 0, 0.02, 0, 0.03, 0.04, 0.03, C.paper);
      lb(pp, x, y, z, yaw, s, 0, 0.06, 0, 0.055, 0.045, 0.055, C.paper);
      lb(pp, x, y, z, yaw, s, 0, 0.105, 0, 0.08, 0.045, 0.08, C.paper);
      lb(pp, x, y, z, yaw, s, 0, 0.135, 0, 0.07, 0.02, 0.07, C.yellow);
      lb(pp, x, y, z, yaw, s, 0.015, 0.155, 0, 0.018, 0.05, 0.018, C.yellow);
      break;
    case "hotdog":
      // sosisli: ekmek tabanı, iki yan, sosis, hardal
      lb(pp, x, y, z, yaw, s, 0, 0.015, 0, 0.22, 0.03, 0.085, K.bread);
      lb(pp, x, y, z, yaw, s, 0, 0.045, 0.032, 0.22, 0.04, 0.025, K.bread);
      lb(pp, x, y, z, yaw, s, 0, 0.045, -0.032, 0.22, 0.04, 0.025, K.bread);
      lb(pp, x, y, z, yaw, s, 0, 0.05, 0, 0.26, 0.04, 0.04, K.sausage);
      lb(pp, x, y, z, yaw, s, 0, 0.072, 0, 0.2, 0.01, 0.016, C.yellow);
      break;
    case "coconut":
      // yeşil hindistan cevizi: iki çapraz gövde (sekizgen), kesik üst, pipet ve dirseği
      lb(pp, x, y, z, yaw, s, 0, 0.06, 0, 0.13, 0.12, 0.13, C.leaf);
      lb(pp, x, y, z, yaw, s, 0, 0.06, 0, 0.13, 0.1, 0.13, C.leaf, Math.PI / 4);
      lb(pp, x, y, z, yaw, s, 0, 0.122, 0, 0.08, 0.012, 0.08, C.cream);
      lb(pp, x, y, z, yaw, s, 0.025, 0.17, 0, 0.014, 0.11, 0.014, C.pink, 0, -0.25);
      lb(pp, x, y, z, yaw, s, 0.05, 0.224, 0, 0.04, 0.014, 0.014, C.pink);
      break;
    case "bento":
      // bento: kırmızı kutu, pilav, somon, yeşillik, yemek çubukları
      lb(pp, x, y, z, yaw, s, 0, 0.0225, 0, 0.2, 0.045, 0.14, C.paddle);
      lb(pp, x, y, z, yaw, s, -0.045, 0.05, 0, 0.085, 0.012, 0.12, C.white);
      lb(pp, x, y, z, yaw, s, 0.045, 0.052, -0.03, 0.05, 0.022, 0.05, C.orange);
      lb(pp, x, y, z, yaw, s, 0.045, 0.052, 0.03, 0.05, 0.022, 0.05, C.green);
      lb(pp, x, y, z, yaw, s, 0.09, 0.064, 0, 0.012, 0.012, 0.2, C.rod);
      break;
    case "bowl":
      // yeşil kâse (matcha; mama kabı da bu): ayak, gövde, ağız, içerik
      lb(pp, x, y, z, yaw, s, 0, 0.0075, 0, 0.06, 0.015, 0.06, K.glaze);
      lb(pp, x, y, z, yaw, s, 0, 0.04, 0, 0.11, 0.05, 0.11, K.glaze);
      lb(pp, x, y, z, yaw, s, 0, 0.07, 0, 0.13, 0.016, 0.13, K.glaze);
      lb(pp, x, y, z, yaw, s, 0, 0.079, 0, 0.11, 0.008, 0.11, K.matcha);
      break;
    case "hammer":
      // küçük tahta tokmak (testi): sap, baş, bilezik
      lb(pp, x, y, z, yaw, s, 0, 0.1, 0, 0.024, 0.2, 0.024, C.rod);
      lb(pp, x, y, z, yaw, s, 0, 0.2, 0, 0.13, 0.055, 0.055, C.brown);
      lb(pp, x, y, z, yaw, s, 0, 0.2, 0, 0.028, 0.06, 0.06, C.dark);
      break;
    case "peas":
      // bezelye kesesi: kese, kıvrık ağız, üç bezelye
      lb(pp, x, y, z, yaw, s, 0, 0.04, 0, 0.085, 0.08, 0.06, K.kraft);
      lb(pp, x, y, z, yaw, s, 0, 0.085, 0, 0.09, 0.018, 0.065, K.kraftDark);
      lb(pp, x, y, z, yaw, s, -0.02, 0.1, 0, 0.026, 0.026, 0.026, C.lime);
      lb(pp, x, y, z, yaw, s, 0.015, 0.102, 0.01, 0.026, 0.026, 0.026, C.lime);
      lb(pp, x, y, z, yaw, s, 0, 0.108, -0.012, 0.026, 0.026, 0.026, C.lime);
      break;
  }
}

// ------------------------------------------------------------------ avatarın elinde (ritualFx.held)
/** Elde çizim: ölçek ve el hizasına göre taban kayması (fincan `walkRuntime.sip` yolu ayrı: s 1, dy −0,03). Her `HeldItem` burada. */
export const HELD_DRAW: Readonly<Record<HeldItem, { s: number; dy: number }>> = {
  simit: { s: 1, dy: -0.02 }, tea_glass: { s: 0.85, dy: -0.03 }, crepe: { s: 1, dy: -0.06 }, sandwich: { s: 0.9, dy: -0.03 },
  paper_cone: { s: 1, dy: -0.05 }, hotdog: { s: 0.9, dy: -0.03 }, coconut: { s: 0.9, dy: -0.05 }, bento: { s: 0.75, dy: -0.04 },
  bowl: { s: 0.9, dy: -0.03 }, hammer: { s: 1, dy: -0.09 }, peas: { s: 1, dy: -0.03 },
  tea: { s: 1, dy: -0.03 }, snack: { s: 0.9, dy: -0.02 }, meal: { s: 0.55, dy: -0.03 }, note: { s: 0.8, dy: -0.02 }, cup: { s: 1, dy: -0.03 },
};
export const HELD_ITEMS = Object.keys(HELD_DRAW) as HeldItem[];
// derleme denetimi: her elde nesne bir eşya modelidir
const heldIsModel: (h: HeldItem) => ItemModel = (h) => h;
void heldIsModel;

/** Avatarın elindeki ritüel nesnesi; (x, y, z) el konumu. ACTIVITY-CAM: `tilt` içecek eğimi (rad, − ağza doğru), `amount` yiyeceğin
 *  kalan payı (ısırıkla küçülür; 0,5–1). */
export function drawHeld(pp: PropPool, item: HeldItem, x: number, y: number, z: number, yaw: number, tilt = 0, amount = 1) {
  const d = HELD_DRAW[item];
  if (d) drawItem(pp, item, x, y + d.dy, z, yaw, d.s * Math.min(1, Math.max(0.5, amount)), tilt);
}

/** Atma ritüelinde elden uçan parça (fx kutusu; `updateFeed` yayı): adet, boy, renk. Nesnesi atılmayanlarda (tokmak, kâse) yok; boş elde avuçtan tane. */
export interface TossBits { n: number; size: number; col: number }
const TOSS_BITS: Partial<Record<HeldItem, TossBits>> = {
  simit: { n: 1, size: 0.05, col: K.crust }, peas: { n: 3, size: 0.028, col: C.lime }, paper_cone: { n: 3, size: 0.03, col: C.yellow },
  snack: { n: 1, size: 0.04, col: C.brown },
};
/** Elde nesne yoksa avuçtan tane yem (ajanların `updateFeed` kırıntısı gibi üç sarı tane). */
const PALM_BITS: TossBits = { n: 3, size: 0.03, col: C.yellow };
export const tossBits = (item: HeldItem | null): TossBits | null => (item ? TOSS_BITS[item] ?? null : PALM_BITS);
