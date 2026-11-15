/**
 * ARRIVAL-ORIGIN (ürün sahibi 2026-10-31 "Portal geçişlerinden sonraki şehir gezi başlangıç noktaları birbirine çok benziyor. Bunları da
 * şehirlere özgü hale getirmelisin.") — şehir haritası varış meydanının (gate, 12 × 16 karo) şehre özgü kompozisyonu.
 *
 * Kök neden: `shell.ts gateBuilt` 21 şehrin hepsine aynı şablonu çiziyordu (aynı bej taş zemin, (1,2)'de bilgi köşkü, (0,8)/(11,8)
 * fenerleri, (2,13) süs havuzu, kahverengi "Ofise dön" kemeri); yalnız iskele/meydan ayrımı vardı. Varışın ilk karesi (avatarın önü,
 * zeminin yarısı) her şehirde birebir aynıydı. Bu modül her şehre: zemin dokusu (Copacabana dalgası, sampietrini, Panot, tuğla …),
 * dönüş kemerinin renk/taç biçimi ve varış yönüne göre yerleşen şehre özgü sokak öğeleri (çeşme, simitçi, metro girişi, arabacı
 * kulübesi, torii, peribacası …) verir. Yalnız kamusal/tarihî öğeler: siyasi/ideolojik/askeri simge, bayrak, marka yok.
 *
 * Yerleşim varış yönüne göre yerel çerçevededir: (a ileri, s sağ) → karo = varış + a·ileri + s·sağ. Yön `facing` veridir ve
 * `cityArrivalView` kuralıyla aynı olmak zorundadır (scripts/arrival_origin_check.mjs ARRIVAL-ORIGIN-001 denetler). Öğeler kameraya
 * (−ileri) bakar. Denetim: ilk karede şehre özgü ≥ 4 öğe tür + ≥ 1 simge öğesi, iki şehrin ilk kare imzası benzer değil, varış
 * karosu ve dönüş yolu açık, z-titreşimi yok (ARRIVAL-ORIGIN-001…003).
 *
 * Saf modül: React/three yok.
*/
import type { Block, Group, Tile } from "../scenes";
import { tx, tz } from "../scenes";
import { Kit, rotateBoxes } from "../citypacks/kit";
import { withFullArrivalKitItems, withFullArrivalKits } from "../../full/arrivalKit";



/** Varış yönü (derece; `yaw` = atan2(di, dj), ileri = (sin, cos)): 180 = −z, 0 = +z, 270 = −x, 90 = +x. */
export type Facing = 0 | 90 | 180 | 270;
/** Zemin dokusu. `flags` döşeme taşları (aralık = derz), `bricks` balıksırtı tuğla, `wave` Copacabana dalgası, `zebra` yaya geçidi
 * bandı (+ taşlar), `dots` Panot/Peranakan: taş + ortada desen, `setts` karo başına 2 × 2 küçük küp taş (sampietrini).*/
export type GroundKind = "flags" | "bricks" | "wave" | "zebra" | "dots" | "setts";
export interface GroundSpec { kind: GroundKind; base: string; tones: readonly string[]; inset?: number; accent?: string }
/** "Ofise dön" kemerinin şehre özgü biçimi. */
export interface ArchSpec { post: string; lintel: string; crown: "beam" | "dome" | "pediment" | "horseshoe" | "none"; trim: string }
/** Yerleşim: [öğe türü, ileri a, sağ s]. Çok karolu öğede (a, s) ayak izinin ortası. */
export type Place = readonly [string, number, number];
export interface ArrivalKit { facing: Facing; ground: GroundSpec; arch: ArchSpec; items: readonly Place[] }

export interface ItemDef {
  /** ayak izi (karo; ön yüz +z) */
  w: number; d: number;
  /** engelli hücreler (varsayılan: hepsi) — torii/kemer ortası yürünür */
  cells?: readonly (readonly [number, number])[];
  /** şehre özgü mü (genel sokak eşyası değil) */
  local: boolean;
  /** şehrin simge öğesi (ilk karede ilk bakışta tanınır) */
  icon?: boolean;
  build: (k: Kit) => void;
}

// ------------------------------------------------------------------------------------------ renkler
export const IRON = "#2E3338", DGREEN = "#1F4D3A", WOOD = "#7A5536", DWOOD = "#5B3E28", LEAF = "#3E7D3A", DLEAF = "#2F6230";
export const GLOW_W = "#FFE8B0";

// ------------------------------------------------------------------------------------------ ortak yardımcılar
/** gövde + taç ağacı (taç yaprak kademeleri). */
export function tree(k: Kit, trunk: string, leaf: string, h = 1.6, r = 0.75) {
  k.c(0.5, 0, 0.5, 0.16, h, 0.16, trunk);
  k.c(0.5, h - 0.15, 0.5, r * 1.3, 0.5, r * 1.3, leaf);
  k.c(0.5, h + 0.35, 0.5, r, 0.4, r, leaf);
}
function lampPost(k: Kit, post: string, head: string, h = 2.1, glow = GLOW_W) {
  k.c(0.5, 0, 0.5, 0.26, 0.16, 0.26, post);
  k.c(0.5, 0.16, 0.5, 0.1, h - 0.16, 0.1, post);
  k.c(0.5, h, 0.5, 0.3, 0.06, 0.3, head);
  k.c(0.5, h + 0.06, 0.5, 0.22, 0.24, 0.22, glow, "glow");
  k.c(0.5, h + 0.3, 0.5, 0.32, 0.07, 0.32, head);
}
export function palm(k: Kit, trunk = "#8A6A45", leaf = "#4C8C3A", h = 2.4) {
  k.c(0.5, 0, 0.5, 0.2, h * 0.5, 0.2, trunk);
  k.c(0.55, h * 0.5, 0.5, 0.17, h * 0.5, 0.17, trunk);
  k.c(0.55, h, 0.5, 1.3, 0.1, 0.3, leaf);
  k.c(0.55, h, 0.5, 0.3, 0.1, 1.3, leaf);
  k.c(0.55, h - 0.1, 0.5, 0.9, 0.1, 0.9, leaf);
}
/** tezgâh: iki direk + tente, önde masa (tente direklere oturur). */
export function stall(k: Kit, table: string, canopy: string, goods: (k: Kit) => void) {
  k.c(0.5, 0, 0.5, 0.86, 0.72, 0.5, table);
  for (const x of [0.1, 0.9]) for (const z of [0.2, 0.8]) k.c(x, 0, z, 0.06, 1.7, 0.06, DWOOD);
  k.c(0.5, 1.7, 0.5, 0.98, 0.07, 0.86, canopy);
  goods(k);
}

/** 2 × 2 çizilmiş siluet 3 × 3 ayak izine oturur (kitte yalnız tek sayılı ayak izi; merkez karo ortası): çizim 0,5 kaydırılır.*/
export function half(k: Kit): Kit {
  const s = Object.create(k) as Kit;
  s.c = (cx, y0, cz, ...r: [number, number, number, string, Group?]) => k.c(cx + 0.5, y0, cz + 0.5, ...r);
  s.oct = (cx, y0, cz, ...r: [number, number, string, Group?]) => k.oct(cx + 0.5, y0, cz + 0.5, ...r);
  s.dome = (cx, y0, cz, ...r: [number, number, string, number?, Group?]) => k.dome(cx + 0.5, y0, cz + 0.5, ...r);
  return s;
}

/** kademeli daralan gövde (kule, piramit, koni): `n` kat, taban `w0` → tepe `w1`, toplam yükseklik `h`.*/
export function taper(k: Kit, cx: number, cz: number, y0: number, w0: number, w1: number, h: number, c: string, n = 4) {
  for (let i = 0; i < n; i++) { const w = w0 + ((w1 - w0) * (i + 0.5)) / n; k.c(cx, y0 + (h * i) / n, cz, w, h / n + 0.02, w, c); }
}

// ------------------------------------------------------------------------------------------ öğe kütüphanesi
const ITEMS: Record<string, ItemDef> = withFullArrivalKitItems({
  // ---- genel (birden çok şehirde; yerel sayılmaz)
  bench: { w: 1, d: 1, local: false, build: (k) => { k.c(0.5, 0, 0.5, 0.9, 0.3, 0.12, IRON); k.c(0.5, 0.3, 0.5, 0.9, 0.06, 0.4, WOOD); k.c(0.5, 0.36, 0.33, 0.9, 0.34, 0.06, WOOD); } },

  // ---- İstanbul
  cesme: { w: 1, d: 1, local: true, icon: true, build: (k) => { // Osmanlı sokak çeşmesi: mermer gövde, kemerli niş, saçak, kubbecik, yalak
    k.c(0.5, 0, 0.45, 0.92, 1.25, 0.6, "#ECE6DA");
    k.c(0.5, 0.35, 0.77, 0.5, 0.65, 0.04, "#C9BFAE");
    k.c(0.5, 0.82, 0.8, 0.12, 0.08, 0.06, "#B08D57");
    k.c(0.5, 0, 0.84, 0.7, 0.22, 0.2, "#D9D1C2");
    k.c(0.5, 0.22, 0.84, 0.56, 0.03, 0.14, "#4FA3C7", "water");
    k.c(0.5, 1.25, 0.47, 1.0, 0.08, 0.74, "#B9AE9C");
    k.dome(0.5, 1.33, 0.45, 0.32, 0.4, "#9FA7AE");
  } },
  simitci: { w: 1, d: 1, local: true, build: (k) => { // simit arabası: kırmızı kasa, camlı vitrin, simitler, tekerlek
    for (const x of [0.2, 0.8]) k.c(x, 0, 0.5, 0.08, 0.4, 0.4, IRON);
    k.c(0.5, 0.4, 0.5, 0.86, 0.5, 0.5, "#C62828");
    k.c(0.5, 0.9, 0.5, 0.86, 0.4, 0.5, "#D9EEF5", "glass");
    k.c(0.5, 1.3, 0.5, 0.94, 0.06, 0.58, "#C62828");
    for (const x of [0.28, 0.5, 0.72]) k.c(x, 0.92, 0.5, 0.18, 0.07, 0.3, "#B5763A");
  } },
  lale: { w: 1, d: 1, local: true, build: (k) => { // lale tarhı
    k.c(0.5, 0, 0.5, 0.9, 0.3, 0.9, "#8C7B66");
    k.c(0.5, 0.3, 0.5, 0.8, 0.06, 0.8, "#4A3A2A");
    for (const [x, z, c] of [[0.25, 0.25, "#D7263D"], [0.5, 0.3, "#F2C14E"], [0.75, 0.25, "#D7263D"], [0.3, 0.7, "#F2C14E"], [0.55, 0.65, "#D7263D"], [0.78, 0.72, "#E8E1F0"]] as const) {
      k.c(x, 0.36, z, 0.04, 0.22, 0.04, LEAF);
      k.c(x, 0.58, z, 0.11, 0.13, 0.11, c);
    }
  } },
  cay_masa: { w: 1, d: 1, local: true, build: (k) => { // çay bahçesi: alçak masa, iki tabure, ince belli bardaklar
    k.c(0.5, 0, 0.5, 0.08, 0.42, 0.08, IRON);
    k.c(0.5, 0.42, 0.5, 0.5, 0.05, 0.5, "#E6DFD2");
    for (const x of [0.38, 0.62]) { k.c(x, 0.47, 0.5, 0.06, 0.1, 0.06, "#B5432F"); k.c(x, 0.57, 0.5, 0.07, 0.02, 0.07, "#E8E1D0"); }
    for (const x of [0.1, 0.9]) k.c(x, 0, 0.5, 0.18, 0.28, 0.18, WOOD);
  } },
  fener_osm: { w: 1, d: 1, local: true, build: (k) => lampPost(k, "#1E2B24", "#2C4A3A", 2.0) },

  // ---- Londra
  cab_shelter: { w: 1, d: 1, local: true, icon: true, build: (k) => { // Viktorya dönemi yeşil arabacı kulübesi (ahşap, kırma çatı)
    const G = "#24563A";
    k.c(0.5, 0, 0.5, 0.9, 0.12, 0.9, "#3B3B3B");
    k.c(0.5, 0.12, 0.5, 0.86, 1.2, 0.86, G);
    for (const x of [0.28, 0.72]) k.c(x, 0.62, 0.94, 0.26, 0.4, 0.02, "#DCEBE6", "glass");
    k.c(0.5, 0.5, 0.94, 0.06, 0.6, 0.02, "#1A3F2A");
    k.c(0.5, 1.32, 0.5, 1.0, 0.1, 1.0, "#1A3F2A");
    k.c(0.5, 1.42, 0.5, 0.7, 0.14, 0.7, "#1A3F2A");
    k.c(0.5, 1.56, 0.5, 0.36, 0.14, 0.36, "#1A3F2A");
    k.c(0.5, 1.7, 0.5, 0.12, 0.2, 0.12, "#8C8C88");
  } },
  postbox: { w: 1, d: 1, local: true, build: (k) => { // kırmızı sütun posta kutusu (arma yok)
    k.oct(0.5, 0, 0.5, 0.42, 0.12, "#2B2B2B");
    k.oct(0.5, 0.12, 0.5, 0.36, 0.9, "#C8102E");
    k.c(0.5, 0.78, 0.69, 0.18, 0.04, 0.03, IRON);
    k.dome(0.5, 1.02, 0.5, 0.2, 0.16, "#C8102E", 2);
  } },
  lamp_dolphin: { w: 1, d: 1, local: true, build: (k) => { // rıhtım balık kaideli lamba
    k.c(0.5, 0, 0.5, 0.36, 0.5, 0.36, "#28332E");
    k.c(0.5, 0.5, 0.5, 0.24, 0.28, 0.24, "#33473D");
    k.c(0.5, 0.78, 0.5, 0.09, 1.3, 0.09, "#28332E");
    k.c(0.5, 2.08, 0.5, 0.26, 0.3, 0.26, GLOW_W, "glow");
    k.c(0.5, 2.38, 0.5, 0.32, 0.08, 0.32, "#28332E");
  } },
  embank: { w: 1, d: 1, local: true, build: (k) => { // granit rıhtım korkuluğu (balüstrad)
    k.c(0.5, 0, 0.5, 1.0, 0.18, 0.36, "#9A958A");
    for (const x of [0.15, 0.38, 0.62, 0.85]) k.c(x, 0.18, 0.5, 0.1, 0.48, 0.12, "#B3AEA2");
    k.c(0.5, 0.66, 0.5, 1.0, 0.12, 0.4, "#9A958A");
  } },

  // ---- Kapadokya
  peribaca: { w: 1, d: 1, local: true, icon: true, build: (k) => { // peribacası: tüf koni, koyu bazalt şapka
    k.oct(0.5, 0, 0.5, 0.95, 0.7, "#D9B98C");
    k.oct(0.5, 0.7, 0.5, 0.72, 0.7, "#DDBF95");
    k.oct(0.5, 1.4, 0.5, 0.5, 0.6, "#E2C7A0");
    k.oct(0.5, 2.0, 0.5, 0.34, 0.25, "#D2B38A");
    k.oct(0.5, 2.25, 0.5, 0.6, 0.22, "#6B5A4A");
    k.c(0.5, 0.5, 0.95, 0.2, 0.3, 0.04, "#5A4636");
  } },
  balon: { w: 1, d: 1, local: true, build: (k) => { // yere inmiş balon sepeti, brülör çerçevesi, katlı zarf
    k.c(0.5, 0, 0.5, 0.6, 0.6, 0.6, "#A97B4A");
    k.c(0.5, 0.6, 0.5, 0.64, 0.06, 0.64, "#6B4A2E");
    for (const x of [0.22, 0.78]) for (const z of [0.22, 0.78]) k.c(x, 0.66, z, 0.04, 0.5, 0.04, IRON);
    k.c(0.5, 1.16, 0.5, 0.6, 0.06, 0.6, IRON);
    k.c(0.5, 1.22, 0.5, 0.22, 0.14, 0.22, "#FF9A3C", "glow");
    k.c(0.5, 0, 0.9, 1.0, 0.16, 0.2, "#D7263D");
    k.c(0.5, 0.16, 0.9, 0.9, 0.1, 0.2, "#F2C14E");
  } },
  testi: { w: 1, d: 1, local: true, build: (k) => { // Avanos çömlekleri, küpte su
    for (const [x, z, h] of [[0.28, 0.3, 0.55], [0.7, 0.32, 0.42], [0.45, 0.72, 0.7]] as const) {
      k.oct(x, 0, z, 0.3, h, "#B5643A");
      k.oct(x, h, z, 0.18, 0.08, "#9A5232");
    }
    k.c(0.45, 0.78, 0.72, 0.1, 0.01, 0.1, "#4FA3C7", "water");
  } },

  // ---- varış karesinde okunur şehir simgesi (genel, isimsiz, ince yorum; yazı/logo yok)
  // ---- her şehrin varış meydanında landmark ölçeğinde (≥ 3,5 karo) tek parça siluet; isimsiz, yazı/bayrak/alem yok
  taskule: { w: 3, d: 3, local: true, icon: true, build: (k0) => { const k = half(k0); // İstanbul: sivri başlıklı yuvarlak taş gözetleme kulesi (galeri + konik çatı)
    k.c(1, 0, 1, 1.7, 0.6, 1.7, "#CFC4B0"); taper(k, 1, 1, 0.6, 1.3, 1.0, 2.6, "#D9D0BD", 4);
    k.c(1, 1.7, 1.62, 0.14, 0.5, 0.06, "#3A3F46"); k.c(1, 3.2, 1, 1.5, 0.2, 1.5, "#B9AE9C"); k.c(1, 3.4, 1, 1.0, 0.5, 1.0, "#D9D0BD");
    taper(k, 1, 1, 3.9, 1.3, 0.12, 1.6, "#8A949C", 4);
  } },
  saatkule: { w: 3, d: 3, local: true, icon: true, build: (k0) => { const k = half(k0); // Londra: dört yüzü saatli kare kule, sivri kurşun çatı (yazı yok)
    k.c(1, 0, 1, 1.1, 3.0, 1.1, "#CDB88E"); k.c(1, 1.2, 1, 1.18, 0.1, 1.18, "#B8A27A"); k.c(1, 3.0, 1, 1.4, 0.25, 1.4, "#B8A27A"); k.c(1, 3.25, 1, 1.2, 1.1, 1.2, "#D6C29A");
    for (const [x, z, w, d, hw, hd] of [[1, 1.63, 0.8, 0.04, 0.1, 0.09], [1, 0.37, 0.8, 0.04, 0.1, 0.09], [1.63, 1, 0.04, 0.8, 0.09, 0.1], [0.37, 1, 0.04, 0.8, 0.09, 0.1]] as const) { k.c(x, 3.4, z, w, 0.8, d, "#F2EEDC"); k.c(x, 3.72, z, hw, 0.34, hd, "#2B2B2B"); }
    taper(k, 1, 1, 4.35, 1.3, 0.12, 1.5, "#5E6F6A", 4); k.c(1, 5.85, 1, 0.08, 0.3, 0.08, "#D9A93C");
  } },
  peri_kume: { w: 3, d: 3, local: true, icon: true, build: (k) => { // Kapadokya: üç uzun konik peribacası + koyu taş başlık
    for (const [x, z, h] of [[0.8, 0.8, 3.2], [2.2, 1.0, 4.4], [1.4, 2.2, 3.6]] as const) { taper(k, x, z, 0, 1.15, 0.4, h, "#D9BC96", 5); k.c(x, h, z, 0.62, 0.36, 0.62, "#7A5C45"); k.c(x, 0.1, z + 0.5, 0.2, 0.5, 0.05, "#4A3626"); }
  } },
}, { tree, palm, stall, half, taper, IRON, DGREEN, DWOOD, LEAF, DLEAF, GLOW_W });

// ------------------------------------------------------------------------------------------ şehir kitleri
/**
 * Yerleşimler (ileri a, sağ s). Kurallar (ARRIVAL-ORIGIN-001…003 denetler): varış karosu ve 8 komşusu boş; kameranın oturduğu arka
 * şerit (a < 0, |s| ≤ 2) boş; ortadaki görüş koridoru (a 1…5, |s| ≤ 1) boş; dönüş kemerine giden yol açık.
 */
export const ARRIVAL_KITS: Readonly<Record<string, ArrivalKit>> = withFullArrivalKits({
  istanbul: {
    facing: 180,
    ground: { kind: "flags", base: "#BFB4A2", tones: ["#E4DDD0", "#D6CDBE", "#CFC4B2"], inset: 0.9 },
    arch: { post: "#E8E2D6", lintel: "#B9AE9C", crown: "dome", trim: "#2F7F7A" },
    items: [["cesme", 4, -3], ["simitci", 2, 3], ["lale", 6, -5], ["cay_masa", 4, 3], ["fener_osm", 2, -2], ["fener_osm", 6, 2], ["bench", 1, -4], ["taskule", 6, 4]],
  },
  londra: {
    facing: 270,
    ground: { kind: "flags", base: "#7F7A70", tones: ["#B9B2A2", "#AFA898", "#C2BBAB"], inset: 0.92 },
    arch: { post: "#28332E", lintel: "#9A958A", crown: "pediment", trim: "#C8102E" },
    items: [["cab_shelter", 3, 3], ["postbox", 2, 2], ["embank", 2, -4], ["embank", 3, -4], ["embank", 4, -4], ["embank", 5, -4], ["lamp_dolphin", 1, -4], ["lamp_dolphin", 6, -4], ["bench", 4, -2], ["saatkule", 5, 3]],
  },
  kapadokya: {
    facing: 90,
    ground: { kind: "flags", base: "#B89A74", tones: ["#D9C2A0", "#CFB693", "#E0CBAA"], inset: 0.9 },
    arch: { post: "#D9B98C", lintel: "#A8835A", crown: "dome", trim: "#6B5A4A" },
    items: [["peribaca", 5, 3], ["balon", 3, 3], ["testi", 4, 2], ["fener_osm", 1, -4], ["peri_kume", 4, -3]],
  },
});

// ------------------------------------------------------------------------------------------ yerleşim
const yawDir = (f: Facing): [number, number] => [Math.round(Math.sin((f * Math.PI) / 180)), Math.round(Math.cos((f * Math.PI) / 180))];
/** Yerel (ileri a, sağ s) → gate karosu. Sağ = (−ileri.z, ileri.x) (−z'ye bakarken +x sağdadır). */
export function localTile(arrive: Tile, f: Facing, a: number, s: number): Tile {
  const [fx, fz] = yawDir(f);
  return [arrive[0] + a * fx - s * fz, arrive[1] + a * fz + s * fx];
}
/** Öğe ön yüzünü (+z) kameraya (−ileri) çeviren çeyrek tur sayısı (`rotateBoxes`). */
const ROT: Record<Facing, number> = { 180: 0, 0: 2, 90: 1, 270: 3 };

export interface KitPlaced { kind: string; tile: Tile; cells: Tile[]; local: boolean; icon: boolean; blocks: Block[] }
export interface KitBuild { items: KitPlaced[]; ground: Block[] }

// ------------------------------------------------------------------------------------------ (KIT-PINCH-001)
/** Görünür boşluk bundan genişse (avatar çapı, yürüme ölçeği 2 × 0,18) geçilebilir okunur. */
export const PINCH_GAP = 0.36;
/** Uzun öğe (kule, bina, simge): üstü bu yükseklikten yüksek. */
const PINCH_TALL = 1.5;
const lowBlocks = (it: KitPlaced) => it.blocks.filter((b) => b.p[1] - b.s[1] / 2 < 1.2);
/** İnce direk: tek hücre, alt gövdesi ≤ 0,4 (fener, lamba, palmiye gövdesi, testi…). */
export const kitThin = (it: KitPlaced) => it.cells.length === 1 && Math.max(...lowBlocks(it).map((b) => Math.max(b.s[0], b.s[2]))) <= 0.4;
const kitTall = (it: KitPlaced) => !kitThin(it) && Math.max(...it.blocks.map((b) => b.p[1] + b.s[1] / 2)) >= PINCH_TALL;
/** İki öğenin alt gövdeleri arasındaki en dar yatay boşluk (dünya birimi). */
export function kitGap(a: KitPlaced, b: KitPlaced): number {
  let gap = Infinity;
  for (const p of lowBlocks(a)) for (const q of lowBlocks(b)) {
    const gx = Math.max(0, Math.abs(p.p[0] - q.p[0]) - (p.s[0] + q.s[0]) / 2), gz = Math.max(0, Math.abs(p.p[2] - q.p[2]) - (p.s[2] + q.s[2]) / 2);
    gap = Math.min(gap, Math.hypot(gx, gz));
  }
  return gap;
}
/**
 * Yanıltıcı dar geçit: ince direk uzun bir öğenin (kule/bina) 8-komşu hücresinde; ikisi de engelli hücre olduğu için arada yürünemez,
 * ama görünür boşluk avatar çapından geniş → oyuncu geçecek sanıp W ile takılır, kayma yok (ürün sahibi: İstanbul İskele kule + fener).
*/
export function kitPinches(items: readonly KitPlaced[]): { thin: KitPlaced; tall: KitPlaced; gap: number }[] {
  const out: { thin: KitPlaced; tall: KitPlaced; gap: number }[] = [];
  for (const t of items) {
    if (!kitThin(t)) continue;
    const [i, j] = t.cells[0];
    for (const o of items) {
      if (o === t || !kitTall(o) || !o.cells.some(([ci, cj]) => Math.abs(ci - i) <= 1 && Math.abs(cj - j) <= 1)) continue;
      const gap = kitGap(t, o);
      if (gap >= PINCH_GAP) out.push({ thin: t, tall: o, gap });
    }
  }
  return out;
}
/** yanıltıcı dar geçitteki ince direk uzun öğeden bir (gerekirse iki) karo uzağa, boş ve kimseye bitişik olmayan hücreye taşınır.*/
function relievePinches(items: KitPlaced[], arrive: Tile, ret: Tile, land: number, width: number, facing: Facing): void {
  // varış çevresi, kamera şeridi ve görüş koridoru boş kalır (ARRIVAL-ORIGIN-003 ile aynı bölge)
  const keep = new Set<string>();
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) keep.add(`${arrive[0] + di},${arrive[1] + dj}`);
  for (let a = -5; a <= -1; a++) for (let s = -2; s <= 2; s++) { const t = localTile(arrive, facing, a, s); keep.add(`${t[0]},${t[1]}`); }
  for (let a = 1; a <= 5; a++) for (let s = -1; s <= 1; s++) { const t = localTile(arrive, facing, a, s); keep.add(`${t[0]},${t[1]}`); }
  for (const { thin, tall } of kitPinches(items)) {
    if (!kitPinches(items).some((p) => p.thin === thin)) continue; // önceki taşıma çözdü
    const [i, j] = thin.cells[0];
    const tc = tall.cells.reduce((s, c) => [s[0] + c[0] / tall.cells.length, s[1] + c[1] / tall.cells.length], [0, 0]);
    const ax = Math.sign(i - tc[0]), az = Math.sign(j - tc[1]);
    const taken = new Set(items.filter((it) => it !== thin).flatMap((it) => it.cells.map((c) => `${c[0]},${c[1]}`)));
    const near = (ci: number, cj: number) => items.some((it) => it !== thin && !kitThin(it) && it.cells.some(([a, b]) => Math.abs(a - ci) <= 1 && Math.abs(b - cj) <= 1));
    const free = (ci: number, cj: number) => ci >= 0 && cj >= 0 && ci < width && cj < land && !taken.has(`${ci},${cj}`) && !near(ci, cj)
      && !keep.has(`${ci},${cj}`) && !(Math.abs(ci - ret[0]) <= 1 && cj === ret[1]);
    // önce uzun öğeden uzaklaşan yönler, sonra 3 karoya dek en yakın boş hücre
    const ring: [number, number][] = [];
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) ring.push([dx, dz]);
    ring.sort((p, q) => Math.max(Math.abs(p[0]), Math.abs(p[1])) - Math.max(Math.abs(q[0]), Math.abs(q[1])) || Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]));
    for (const [dx, dz] of [[ax, az], [ax, 0], [0, az], [2 * ax, 2 * az], [2 * ax, 0], [0, 2 * az], ...ring] as const) {
      if ((!dx && !dz) || !free(i + dx, j + dz)) continue;
      for (const b of thin.blocks) b.p = [b.p[0] + dx, b.p[1], b.p[2] + dz];
      thin.cells = [[i + dx, j + dz]];
      thin.tile = [thin.tile[0] + dx, thin.tile[1] + dz];
      break;
    }
  }
}

const buildCache = new Map<string, KitBuild>();
/**
 * Kitin blokları (öğeler + zemin dokusu). `gate`: gate'in yürünmez karoları (iskele suyu vb.; zemin dokusu oraya yazılmaz),
 * `land`: zemin taşının uzandığı derinlik (iskelede 12). Bilinmeyen şehir → null (genel şablon kalır).
 */
export function arrivalKitBuild(mapId: string, arrive: Tile, ret: Tile, land: number, width: number): KitBuild | null {
  const kit = ARRIVAL_KITS[mapId];
  if (!kit) return null;
  const hit = buildCache.get(mapId);
  if (hit) return hit;
  const items: KitPlaced[] = [];
  const rot = ROT[kit.facing];
  for (const [kind, a, s] of kit.items) {
    const def = ITEMS[kind];
    if (!def) throw new Error(`arrivalKit: bilinmeyen öğe ${kind}`);
    const k = new Kit(def.w, def.d);
    def.build(k);
    const r = rotateBoxes(k.done(), def.w, def.d, rot);
    const c = localTile(arrive, kit.facing, a, s);
    const i0 = c[0] - (r.w - 1) / 2, j0 = c[1] - (r.d - 1) / 2;
    const blocks: Block[] = r.boxes.map(([dx, y, dz, w, h, d, col, g]) => ({ p: [tx(i0) + dx, y, tz(j0) + dz], s: [w, h, d], c: col, g: g as Group, j: 0 }));
    // engelli hücreler: ayak izi hücreleri (döndürülmüş) — tanımdaki `cells` dönüşle aynı eşlenir
    const cellsLocal = def.cells ?? Array.from({ length: def.w * def.d }, (_, n) => [n % def.w, Math.floor(n / def.w)] as const);
    const cells: Tile[] = cellsLocal.map(([ci, cj]) => {
      let x = ci + 0.5, z = cj + 0.5, W = def.w, D = def.d;
      for (let q = 0; q < rot; q++) { const nx = D - z, nz = x; x = nx; z = nz; [W, D] = [D, W]; }
      return [i0 + Math.floor(x), j0 + Math.floor(z)];
    });
    items.push({ kind, tile: c, cells, local: def.local, icon: !!def.icon, blocks });
  }
  relievePinches(items, arrive, ret, land, width, kit.facing);
  const ground = groundBlocks(kit.ground, items, ret, land, width);
  const out = { items, ground };
  buildCache.set(mapId, out);
  return out;
}

/**
 * varış bakışının odağı = kitin en uzun simge öğesi (şehir simgesi). `cityArrivalView` bunu da simge hedefi sayar
 * (±30° kadrajda tam puan): simge görüş ışınını kısıtlasa da bakış simgeye dönük kalır. Kitsiz şehir → null.
*/
export function arrivalFocus(mapId: string, arrive: Tile, ret: Tile, land: number, width: number): Tile | null {
  const top = (it: KitPlaced) => Math.max(...it.blocks.map((b) => b.p[1] + b.s[1] / 2));
  let best: KitPlaced | null = null;
  for (const it of arrivalKitBuild(mapId, arrive, ret, land, width)?.items ?? []) if (it.icon && (!best || top(it) > top(best))) best = it;
  return best ? [best.tile[0], best.tile[1]] : null;
}

/** Zemin dokusu: karo başına ince taş (üst 0,02; ana zemin üstü 0 ile eş düzlem değil), öğe ve dönüş karosunda yok. */
function groundBlocks(g: GroundSpec, items: readonly KitPlaced[], ret: Tile, land: number, width: number): Block[] {
  const out: Block[] = [];
  const skip = new Set<string>([`${ret[0]},${ret[1]}`]);
  for (const it of items) for (const [i, j] of it.cells) skip.add(`${i},${j}`);
  const Y = 0.005, H = 0.03, YA = 0.0125, HA = 0.045; // taş üstü 0,02; desen üstü 0,035
  const hash = (i: number, j: number) => ((i * 73856093) ^ (j * 19349663)) >>> 0;
  const stone = (x: number, z: number, w: number, d: number, c: string) => out.push({ p: [x, Y, z], s: [w, H, d], c, g: "solid", j: 0 });
  const accent = (x: number, z: number, w: number, d: number, c: string) => out.push({ p: [x, YA, z], s: [w, HA, d], c, g: "solid", j: 0 });
  for (let j = 0; j < land; j++) for (let i = 0; i < width; i++) {
    if (skip.has(`${i},${j}`)) continue;
    const x = tx(i), z = tz(j);
    if (g.kind === "wave") {
      // Copacabana: kıyıya paralel dalga şeritleri (karo içinde 3 × 3 alt hücre; ince şerit sin ile kayar; basamak ve karşıtlık azaltıldı)
      for (const u of [-1 / 3, 0, 1 / 3]) for (const v of [-1 / 3, 0, 1 / 3]) {
        const X = i + u + 0.5, Z = j + v + 0.5;
        const band = (((Z + 0.6 * Math.sin(X * 0.9)) / 2) % 1 + 1) % 1;
        if (band < 0.3) stone(x + u, z + v, 1 / 3, 1 / 3, g.accent ?? "#BDB5A0");
      }
      continue;
    }
    if (g.kind === "setts") {
      for (const u of [-0.25, 0.25]) for (const v of [-0.25, 0.25]) stone(x + u, z + v, 0.46, 0.46, g.tones[hash(i * 2 + (u > 0 ? 1 : 0), j * 2 + (v > 0 ? 1 : 0)) % g.tones.length]);
      continue;
    }
    if (g.kind === "bricks") {
      // balıksırtı izlenimi: karo başına iki tuğla, karo paritesiyle yön değişir (derz = taban rengi)
      const c0 = g.tones[hash(i, j) % g.tones.length], c1 = g.tones[(hash(i, j) + 1) % g.tones.length];
      if ((i + j) % 2) { stone(x, z - 0.24, 0.92, 0.44, c0); stone(x, z + 0.24, 0.92, 0.44, c1); }
      else { stone(x - 0.24, z, 0.44, 0.92, c0); stone(x + 0.24, z, 0.44, 0.92, c1); }
      continue;
    }
    const ins = g.inset ?? 0.92;
    const zebra = g.kind === "zebra" && j >= 2 && j <= 4 && (i % 2 === 0);
    if (zebra) { stone(x, z, 0.98, 0.5, g.accent ?? "#ECECEA"); stone(x, z + 0.37, 0.98, 0.24, g.tones[0]); stone(x, z - 0.37, 0.98, 0.24, g.tones[0]); continue; }
    stone(x, z, ins, ins, g.tones[hash(i, j) % g.tones.length]);
    if (g.kind === "dots") accent(x, z, 0.26, 0.26, g.accent ?? "#7E7D78");
  }
  return out;
}

/** Bütün öğe türleri ve yerellik/simge bilgisi (denetim). */
export const arrivalItemDefs = (): Readonly<Record<string, { local: boolean; icon: boolean; w: number; d: number }>> =>
  Object.fromEntries(Object.entries(ITEMS).map(([k, d]) => [k, { local: d.local, icon: !!d.icon, w: d.w, d: d.d }]));
