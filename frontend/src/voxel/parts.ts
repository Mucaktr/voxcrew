/**
 * Karakterin parça listesi (S13). Tek karakter (`Character.tsx`) ve kalabalık çizici (`Crowd.tsx`) aynı
 * listeyi kullanır; görünüm bire bir aynı kalır. Ölçüler "piksel" (16 px = 1 blok), kök ayak tabanı, +z'ye bakış.
 *
 * Kemikler: root (zıplama/uyku) → legL/legR · root → body (sallanma) → armL/armR, head.
 * `lod: 0` parçalar uzaktan da çizilir (bacak, gövde, kol, kafa, yüz, saç tabanı, şapka tabanı); `lod: 1` yalnızca yakında.
 */
import type { Avatar } from "../lib/types";
import type { Accessory, Motion } from "./Character";
import { EMBLEM_GLYPHS, hasAura, hasSkirt, pantsColor, shade, shortSleeves, skirtColor } from "./avatar";
import { wearOf } from "./cosmetics/registry";

export type V3 = [number, number, number];
export type Bone = "root" | "body" | "head" | "armL" | "armR" | "legL" | "legR";
export const BONES: Bone[] = ["root", "body", "head", "armL", "armR", "legL", "legR"];
/** Kemik pivotları (ebeveyne göre, piksel). */
export const BONE_PIVOT: Record<Bone, V3> = {
  root: [0, 0, 0], body: [0, 0, 0], head: [0, 14, 0], armL: [-5.25, 13.5, 0], armR: [5.25, 13.5, 0], legL: [-1.6, 6, 0], legR: [1.6, 6, 0],
};
export const BONE_PARENT: Record<Bone, Bone | null> = {
  root: null, body: "root", head: "body", armL: "body", armR: "body", legL: "root", legR: "root",
};

export type Quad = "face" | "snout" | "body";

export interface BoxPart {
  kind: "box";
  bone: Bone;
  p: V3;
  s: V3;
  c: string;
  /** saydamlık (yoksa 1) */
  o?: number;
  /** döndürme (yalnızca bere) */
  r?: V3;
  /** tonlanmamış parlak malzeme */
  glow?: boolean;
  lod: 0 | 1;
  /** yalnızca teslim taşırken (parşömen) */
  carry?: boolean;
  /** S43: yalnızca bu cihazla çalışırken görünür (kucakta dizüstü, elde tablet) */
  device?: HeldDevice;
}
/** S43 — elde/kucakta çizilen cihaz (masadaki ekran sahneye pişmiştir; bu yalnızca bank/zemin/şezlong ve ayakta tablet). */
export type HeldDevice = "laptop" | "tablet";
export interface QuadPart {
  kind: "quad";
  bone: Bone;
  quad: Quad;
  p: V3;
  w: number;
  h: number;
  lod: 0 | 1;
}
export type Part = BoxPart | QuadPart;

const SNOUT_SPECIES = new Set(["dog", "fox", "bear"]);

/** W5: "Ben" avatarının yaka kartı rengi (walk/me.ts ME_COLOR ile aynı; ajanlardan ilk bakışta ayırt eder). */
export const ME_BADGE_COLOR = "#FFB547";

/**
 * Parça listesi. `badge` (W5): yürüme modu "Ben" avatarının yaka kartı (boyun askısı + göğüste kart); yalnızca avatar için
 * (Crowd `makeMeCh`), ajanlarda hiç yok. Kart uzak LOD'da da çizilir (ayırt edici), askı yalnız yakında.
 */
export function characterParts(a: Avatar, accessory: Accessory | null = null, badge = false): Part[] {
  const out: Part[] = [];
  const box = (bone: Bone, p: V3, s: V3, c: string, extra: Partial<BoxPart> = {}) =>
    out.push({ kind: "box", bone, p, s, c, lod: 1, ...extra });
  const skin = a.skin;
  const pants = pantsColor(a);
  const sleeve = a.outfit === "overalls" ? a.accent : a.outfitColor;
  const short = shortSleeves(a);

  // bacaklar
  for (const bone of ["legL", "legR"] as Bone[]) {
    box(bone, [0, -3, 0], [3, 6, 3], pants, { lod: 0 });
    box(bone, [0, -5.3, 0.2], [3.2, 1.4, 3.4], "#2B2B2B", { lod: 0 });
  }
  // gövde (ön yüz dokulu dörtgen)
  box("body", [0, 10, 0], [8, 8, 5], a.outfitColor, { lod: 0 });
  out.push({ kind: "quad", bone: "body", quad: "body", p: [0, 10, 2.52], w: 8, h: 8, lod: 1 });
  if (a.outfit === "dress") box("body", [0, 6.5, 0], [10, 4, 6.4], a.outfitColor, { lod: 0 });
  // GIFTS-GENDER: kadın kesimi — etek (mağaza kıyafeti/yerel kostüm giyilmediyse; yerel kostümün kendi kadın kesimi var)
  if (hasSkirt(a) && !wearOf(a.wear)) box("body", [0, 5.6, 0], [9.4, 3.8, 6.2], skirtColor(a), { lod: 0 });
  if (a.outfit === "labcoat") box("body", [0, 5.4, 0], [8.4, 3.4, 5.4], a.outfitColor, { lod: 0 });
  if (a.outfit === "hoodie") box("body", [0, 13.6, -3.3], [8.6, 3, 2.4], shade(a.outfitColor, -0.15));
  // S34: ceketin etek payı (gömlek ve ceketin ön ayrıntıları gövde dokusunda: pixels.ts drawBody)
  if (a.outfit === "blazer") box("body", [0, 6.6, 0], [8.5, 1.6, 5.5], a.outfitColor, { lod: 0 });
  // kollar
  for (const bone of ["armL", "armR"] as Bone[]) {
    if (short) {
      box(bone, [0, -1.25, 0], [2.6, 2.5, 2.6], sleeve, { lod: 0 });
      box(bone, [0, -4.75, 0], [2.4, 4.5, 2.4], skin, { lod: 0 });
    } else {
      box(bone, [0, -2.75, 0], [2.6, 5.5, 2.6], sleeve, { lod: 0 });
      box(bone, [0, -6.25, 0], [2.4, 1.5, 2.4], skin, { lod: 0 });
    }
  }
  // kafa + yüz
  box("head", [0, 5, 0], [10, 10, 10], skin, { lod: 0 });
  out.push({ kind: "quad", bone: "head", quad: "face", p: [0, 5, 5.02], w: 10, h: 10, lod: 0 });
  ears(a, box);
  snout(a, box, out);
  // COS-B: mağaza kıyafeti başlık/gözlük taşıyorsa saç şapka altı gibi kısalır, kendi şapka/gözlük yuvası çizilmez
  const wear = wearOf(a.wear);
  if (a.mask !== "cowl") hair(a, (a.hat !== "none" && a.hat !== "headphones") || !!wear?.head, box);
  beard(a, box);
  if (accessory !== "visor" && !wear?.eyes) glasses(a, box);
  if (!(accessory === "headset" && a.hat === "headphones") && !wear?.head) hat(a, box);
  if (accessory) accessoryParts(accessory, a, box);
  heroGear(a, box); // S44: pelerin, maske, amblem, bot/eldiven, parıltı
  if (wear) wear.wear(a, box); // COS-B: kozmetik set kıyafeti (voxel/cosmetics/sets/*; Crowd toplu gruplarıyla uyumlu)
  if (badge) { const b0 = out.length; meBadge(box); liftBadge(out, b0); } // W5: "Ben" yaka kartı (hep önde)
  // teslim parşömeni (elde; yalnızca taşırken görünür)
  // W3: biraz büyütüldü (takip kamerasında okunur kalsın; çizim çağrısı aynı)
  box("body", [5, 9.9, 3.6], [2.3, 7.2, 2.3], "#F5E6C8", { r: [0, 0, 0.35], carry: true });
  box("body", [5, 9.9, 3.6], [2.6, 1.3, 2.6], "#D9453B", { r: [0, 0, 0.35], carry: true });
  // S43: kucakta dizüstü (gövde: oturunca uyluk üstü y≈7,5) ve elde tablet; yalnızca o cihazla çalışırken görünür
  box("body", [0, 8, 4.4], [6.4, 0.6, 4.4], "#A8B0BC", { device: "laptop" });
  box("body", [0, 10.1, 6.5], [6.4, 4.2, 0.4], "#3F4652", { r: [0.28, 0, 0], device: "laptop" });
  box("body", [0, 10.08, 6.24], [5.6, 3.5, 0.14], "#9CC8FF", { r: [0.28, 0, 0], glow: true, device: "laptop" });
  box("body", [0, 9.6, 6.2], [5.4, 0.5, 4], "#7FD4F0", { r: [-0.8, 0, 0], glow: true, device: "tablet" });
  // S44: süzülme — bacaklar ve gövde (baş/kollar gövdeye bağlı) hafifçe yükselir; parıltı halkası ayak altında kalır
  if (a.hover) {
    for (const p of out) if (p.bone === "legL" || p.bone === "legR" || p.bone === "body") p.p = [p.p[0], p.p[1] + HOVER_LIFT, p.p[2]];
  }
  return out;
}

// ------------------------------------------------------------------ W5: "Ben" yaka kartı (lanyard)
/** Boyundan inen iki askı, kıskaç ve göğüste beyaz kart (üst şeridi turuncu, köşede küçük foto). Gövde önü z = 2,5. */
function meBadge(box: BoxFn) {
  const strap = ME_BADGE_COLOR;
  box("body", [-1.35, 12.2, 2.62], [0.55, 3.4, 0.16], strap);
  box("body", [1.35, 12.2, 2.62], [0.55, 3.4, 0.16], strap);
  box("body", [0, 10.65, 2.68], [0.9, 0.55, 0.3], "#6B7280");
  box("body", [0, 9.05, 2.72], [3.2, 3.5, 0.26], "#FFFFFF", { lod: 0 });
  box("body", [0, 10.45, 2.76], [3.2, 0.75, 0.28], strap, { lod: 0 });
  box("body", [-0.75, 8.85, 2.78], [1.1, 1.2, 0.26], "#475569");
  box("body", [0.75, 9.15, 2.78], [1.2, 0.3, 0.26], "#94A3B8");
  box("body", [0.75, 8.6, 2.78], [1.2, 0.3, 0.26], "#94A3B8");
}

/** kartın arka yüzü ile önündeki kıyafet yüzeyi arasındaki en az boşluk (px).*/
export const BADGE_GAP = 0.02;

/** Döndürülmüş kutunun eksen hizalı yarı boyutları (three Euler "XYZ": R = Rx·Ry·Rz). */
function halfExtent(b: BoxPart): V3 {
  const h: V3 = [b.s[0] / 2, b.s[1] / 2, b.s[2] / 2];
  if (!b.r) return h;
  const [a, bb, c, d, e, f] = [Math.cos(b.r[0]), Math.sin(b.r[0]), Math.cos(b.r[1]), Math.sin(b.r[1]), Math.cos(b.r[2]), Math.sin(b.r[2])];
  const R = [[c * e, -c * f, d], [a * f + bb * e * d, a * e - bb * f * d, -bb * c], [bb * f - a * e * d, bb * e + a * f * d, a * c]];
  return R.map((row) => Math.abs(row[0]) * h[0] + Math.abs(row[1]) * h[1] + Math.abs(row[2]) * h[2]) as V3;
}

/**
 * yaka kartı her kıyafetin (yerel kostüm, mağaza seti, kahraman donanımı, etek/ceket payı) önünde kalır. Kartın xy
 * izdüşümüyle örtüşen gövde kutularının (taşıma/cihaz hariç) en öndeki yüzü bulunur; kartın tüm parçaları birlikte (iç düzeni bozulmadan) en az `BADGE_GAP`
 * öne itilir. Yalnız konum değişir: yeni kutu, örgü ya da çizim çağrısı yok. Kıyafetsiz avatarda kayma 0.
*/
function liftBadge(out: Part[], badgeAt: number) {
  let dz = 0;
  for (let i = badgeAt; i < out.length; i++) {
    const b = out[i] as BoxPart, hb = halfExtent(b);
    for (let j = 0; j < badgeAt; j++) {
      const o = out[j];
      if (o.kind !== "box" || o.bone !== "body" || o.carry || o.device) continue;
      const ho = halfExtent(o);
      if (Math.abs(o.p[0] - b.p[0]) >= ho[0] + hb[0] || Math.abs(o.p[1] - b.p[1]) >= ho[1] + hb[1]) continue;
      dz = Math.max(dz, o.p[2] + ho[2] + BADGE_GAP - (b.p[2] - hb[2]));
    }
  }
  if (dz > 0) for (let i = badgeAt; i < out.length; i++) { const p = out[i].p; out[i].p = [p[0], p[1], p[2] + dz]; }
}

// ------------------------------------------------------------------ S44: kahraman donanımı
/** Süzülme yüksekliği (px). Küçük tutulur: oturan/yatan duruşlarda karakter mobilyadan kopmuş görünmesin. */
export const HOVER_LIFT = 1.5;

/** Kahraman donanımı. Yalnızca kutu parçaları kullanır (saydamlık 0,45 ve parlak malzeme: Crowd.tsx toplu çizim
 *  gruplarıyla uyumlu), böylece tek karakter ve kalabalık aynı görünür. Pelerin gövdeye bağlıdır (sallanmaz). */
function heroGear(a: Avatar, box: BoxFn) {
  const gear = a.capeColor ?? shade(a.outfitColor, -0.3);
  const aura = hasAura(a) ? a.aura! : null;
  const trim = aura ?? a.accent;
  // pelerin + yaka + omuz tokaları
  if (a.cape === "long" || a.cape === "short") {
    const long = a.cape === "long";
    box("body", long ? [0, 7.6, -2.95] : [0, 10.6, -2.9], long ? [8.4, 12.4, 0.5] : [8.4, 6.6, 0.5], gear,
      { r: [long ? 0.1 : 0.08, 0, 0], lod: 0 });
    box("body", long ? [0, 7.6, -2.62] : [0, 10.6, -2.6], long ? [7.8, 11.6, 0.2] : [7.8, 6, 0.2], shade(gear, -0.25),
      { r: [long ? 0.1 : 0.08, 0, 0] });
    box("body", [0, 13.95, -1.9], [8.8, 0.8, 1.6], gear);
    for (const x of [-3.3, 3.3]) box("body", [x, 13.35, 2.62], [1, 1, 0.3], trim, aura ? { glow: true } : {});
  }
  // göğüs amblemi (5×5 glif + zemin plakası)
  if (a.emblem && a.emblem !== "none") {
    const glyph = EMBLEM_GLYPHS[a.emblem];
    box("body", [0, 11.2, 2.58], [5, 5, 0.15], shade(gear, -0.2));
    glyph.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch === "X") box("body", [(c - 2) * 0.85, 11.2 + (2 - r) * 0.85, 2.72], [0.8, 0.8, 0.3], trim, aura ? { glow: true } : {});
    }));
  }
  // maske
  const mc = shade(gear, -0.15);
  if (a.mask === "domino") {
    box("head", [0, 6.8, 5.12], [10.2, 0.8, 0.22], mc, { lod: 0 });
    box("head", [0, 5.6, 5.12], [1.8, 1.6, 0.22], mc);
    for (const x of [-4.3, 4.3]) box("head", [x, 5.6, 5.12], [1.8, 1.6, 0.22], mc);
    for (const x of [-2.15, 2.15]) box("head", [x, 4.55, 5.12], [2.5, 0.5, 0.22], mc);
    for (const x of [-5.1, 5.1]) box("head", [x, 6.2, 1], [0.25, 1, 8], mc);
  } else if (a.mask === "visor") {
    box("head", [0, 5.4, 5.25], [10.6, 2.4, 0.4], aura ?? "#7DD3FC", { o: 0.45, lod: 0 });
    box("head", [0, 6.75, 5.25], [10.8, 0.4, 0.5], mc);
    for (const x of [-5.4, 5.4]) box("head", [x, 5.6, 2.6], [0.4, 1.6, 5.4], mc);
  } else if (a.mask === "cowl") {
    box("head", [0, 10.4, -0.3], [10.8, 1.2, 10.8], mc, { lod: 0 });
    box("head", [0, 5.5, -5.35], [10.8, 10, 0.8], mc, { lod: 0 });
    for (const x of [-5.35, 5.35]) box("head", [x, 5.5, -0.3], [0.8, 10, 10.2], mc, { lod: 0 });
    box("head", [0, 9.0, 5.15], [10.8, 1.8, 0.4], mc);
    box("head", [0, 11.2, 0], [1.2, 0.6, 9], trim, aura ? { glow: true } : {});
  }
  // botlar ve eldivenler
  if (a.boots) {
    for (const bone of ["legL", "legR"] as Bone[]) {
      box(bone, [0, -4.2, 0.2], [3.4, 3.6, 3.6], gear, { lod: 0 });
      box(bone, [0, -2.3, 0.1], [3.6, 0.6, 3.7], trim, aura ? { glow: true } : {});
    }
  }
  if (a.gloves) {
    for (const bone of ["armL", "armR"] as Bone[]) {
      box(bone, [0, -6.05, 0], [2.7, 2.2, 2.7], gear);
      box(bone, [0, -4.8, 0], [2.9, 0.6, 2.9], trim, aura ? { glow: true } : {});
    }
  }
  // parıltı halkası (ayak altı)
  if (aura) {
    const y = a.hover ? 0.2 - HOVER_LIFT : 0.2; // süzülmede halka yerde kalır
    box("body", [0, y, 4.4], [9, 0.3, 0.8], aura, { glow: true });
    box("body", [0, y, -4.4], [9, 0.3, 0.8], aura, { glow: true });
    for (const x of [-4.4, 4.4]) box("body", [x, y, 0], [0.8, 0.3, 8], aura, { glow: true });
  }
}

export type BoxFn = (bone: Bone, p: V3, s: V3, c: string, extra?: Partial<BoxPart>) => void;

function ears(a: Avatar, box: BoxFn) {
  const f = a.skin;
  switch (a.species) {
    case "cat":
      for (const x of [-3.3, 3.3]) {
        box("head", [x, 11.4, -0.5], [3, 3, 1.6], f, { lod: 0 });
        box("head", [x, 11.2, 0.35], [1.6, 1.8, 0.2], "#F9A8D4");
      }
      break;
    case "fox":
      for (const x of [-3.4, 3.4]) {
        box("head", [x, 11.8, -0.5], [3, 3.6, 1.2], f, { lod: 0 });
        box("head", [x, 13.1, -0.5], [3.02, 1, 1.22], "#2B2B2B");
        box("head", [x, 11.5, 0.15], [1.6, 2, 0.15], "#FFF1E6");
      }
      break;
    case "bear":
    case "panda": {
      const c = a.species === "panda" ? "#1F1F1F" : f;
      for (const x of [-4, 4]) {
        box("head", [x, 10.8, -0.5], [3, 3, 1.6], c, { lod: 0 });
        if (a.species === "bear") box("head", [x, 10.6, 0.35], [1.6, 1.6, 0.2], shade(f, 0.3));
      }
      break;
    }
    case "rabbit":
      for (const x of [-2.2, 2.2]) {
        box("head", [x, 13.5, -0.5], [2.4, 7, 1.4], f, { lod: 0 });
        box("head", [x, 13.2, 0.25], [1.2, 5.6, 0.2], "#F9A8D4");
      }
      break;
    case "dog":
      for (const x of [-5.6, 5.6]) box("head", [x, 6.5, -0.5], [1.4, 5.5, 4], shade(f, -0.25), { lod: 0 });
      break;
  }
}

function snout(a: Avatar, box: BoxFn, out: Part[]) {
  const f = a.skin;
  if (a.species === "penguin") { box("head", [0, 3.2, 6], [3, 1.5, 2], "#F59E0B", { lod: 0 }); return; }
  if (!SNOUT_SPECIES.has(a.species)) return;
  const fox = a.species === "fox";
  const depth = fox ? 2.8 : a.species === "dog" ? 2.4 : 1.8;
  const light = fox ? "#FFF7ED" : shade(f, 0.35);
  const front = 5 + depth;
  if (fox) {
    box("head", [0, 3.2, 5 + depth / 2], [4, 1.6, depth], f, { lod: 0 });
    box("head", [0, 1.9, 5 + depth / 2], [4, 1.2, depth], light, { lod: 0 });
  } else {
    box("head", [0, 2.6, 5 + depth / 2], [4.6, 3.2, depth], light, { lod: 0 });
  }
  box("head", [0, 3.6, front + 0.15], [1.6, 1, 0.3], "#1F1A17");
  out.push({ kind: "quad", bone: "head", quad: "snout", p: [0, 1.9, front + 0.02], w: 4, h: 3, lod: 1 });
}

function hair(a: Avatar, hat: boolean, box: BoxFn) {
  const h = a.hairColor;
  if (a.species !== "human" || a.hair === "none" || a.hair === "bald") return;
  const add = (p: V3, s: V3, c = h, lod: 0 | 1 = 1) => box("head", p, s, c, { lod });
  if (a.hair !== "mohawk") {
    add([0, 9.6, 0], [10.8, 1.6, 10.8], h, 0);
    add([0, 6, -5.2], [10.8, 8, 0.8], h, 0);
    add([5.2, 7.5, -0.5], [0.8, 5, 9.8], h, 0);
    add([-5.2, 7.5, -0.5], [0.8, 5, 9.8], h, 0);
  }
  switch (a.hair) {
    case "short":
      add([0, 8.7, 5.15], [10.8, 1.6, 0.6]);
      break;
    case "long":
      add([0, 8.7, 5.15], [10.8, 1.6, 0.6]);
      add([0, 3, -5.4], [10.8, 12, 1], h, 0);
      add([5.3, 4, -1], [0.8, 9, 8]);
      add([-5.3, 4, -1], [0.8, 9, 8]);
      break;
    case "bob":
      add([0, 8.6, 5.15], [10.8, 1.8, 0.6]);
      add([5.3, 5.5, 0], [0.9, 7, 10.4]);
      add([-5.3, 5.5, 0], [0.9, 7, 10.4]);
      add([0, 5, -5.3], [10.8, 8, 1]);
      break;
    case "bun":
      add([0, 8.7, 5.15], [10.8, 1.2, 0.6]);
      if (!hat) add([0, 11.6, -2.6], [4, 4, 4]);
      break;
    case "ponytail":
      add([0, 8.7, 5.15], [10.8, 1.2, 0.6]);
      add([0, 6.6, -5.9], [2.2, 2.2, 1.2], a.accent);
      add([0, 2.6, -6.6], [2.8, 7, 2.6]);
      break;
    case "curly":
      for (const x of [-3.8, 0, 3.8]) for (const z of [-3.8, 0, 3.8]) add([x, 10.4, z], [3.6, 2.4, 3.6]);
      for (const x of [-3.5, 0, 3.5]) add([x, 8.8, 5.25], [3.4, 2.2, 1.2]);
      break;
    case "spiky":
      if (!hat) for (const [x, z] of [[-3, -2], [0, 1], [3, -1], [-1, -4], [2, 3]]) add([x, 11.4, z], [2, 2.6, 2]);
      for (const x of [-3, 0, 3]) add([x, 9, 5.25], [2, 2, 1]);
      break;
    case "mohawk":
      if (!hat) add([0, 11, 0], [2.2, 3, 11], h, 0);
      add([0, 6, -5.2], [3, 8, 0.8]);
      break;
  }
}

function beard(a: Avatar, box: BoxFn) {
  if (a.species !== "human" || a.beard === "none") return;
  const h = a.hairColor;
  switch (a.beard) {
    case "stubble":
      box("head", [0, 1.6, 5.08], [9.6, 3.2, 0.2], h, { o: 0.32 });
      break;
    case "goatee":
      box("head", [0, 1, 5.4], [3, 2.2, 1.2], h);
      break;
    case "mustache":
      box("head", [0, 3.9, 5.35], [5, 0.9, 0.9], h);
      break;
    case "full":
      box("head", [0, 1, 5.3], [10.4, 2.2, 1.2], h, { lod: 0 });
      box("head", [4.9, 2.4, 3], [1.2, 4.8, 4.6], h);
      box("head", [-4.9, 2.4, 3], [1.2, 4.8, 4.6], h);
      box("head", [3.4, 2.9, 5.3], [2.6, 1.2, 1], h);
      box("head", [-3.4, 2.9, 5.3], [2.6, 1.2, 1], h);
      box("head", [0, 3.9, 5.35], [5, 0.9, 0.9], h);
      break;
  }
}

function glasses(a: Avatar, box: BoxFn) {
  if (a.glasses === "none") return;
  const rim = { round: "#D4A017", square: "#1F2937", sun: "#111827", star: "#EC4899" }[a.glasses];
  const lens = { round: "#BFE3FF", square: "#E5F3FF", sun: "#0B0F19", star: "#FFD166" }[a.glasses];
  const z = SNOUT_SPECIES.has(a.species) ? 5.25 : 5.2;
  for (const x of [-2.2, 2.2]) {
    box("head", [x, 5.25, z], [3.8, 3.2, 0.25], rim);
    box("head", [x, 5.25, z + 0.06], [3, 2.4, 0.25], lens, { o: a.glasses === "sun" ? 0.95 : 0.45 });
    if (a.glasses === "star") box("head", [x, 7, z], [1, 1, 0.25], rim);
  }
  box("head", [0, 5.7, z], [0.8, 0.5, 0.3], rim);
  box("head", [5.15, 5.7, 2.6], [0.3, 0.5, 5], rim);
  box("head", [-5.15, 5.7, 2.6], [0.3, 0.5, 5], rim);
}

function hat(a: Avatar, box: BoxFn) {
  const hc = a.outfitColor;
  switch (a.hat) {
    case "cap":
      box("head", [0, 11.3, -0.3], [10.8, 2.8, 10.8], hc, { lod: 0 });
      box("head", [0, 10.2, 7.2], [10.8, 0.7, 4.8], shade(hc, -0.25));
      box("head", [0, 12.9, -0.3], [1.2, 0.6, 1.2], a.accent);
      break;
    case "beanie":
      box("head", [0, 11.5, 0], [11, 3.4, 11], a.accent, { lod: 0 });
      box("head", [0, 10.1, 0], [11.4, 1.4, 11.4], shade(a.accent, -0.25));
      box("head", [0, 14, 0], [2.6, 2.6, 2.6], "#FFFFFF");
      break;
    case "tophat":
      box("head", [0, 10.3, 0], [14, 0.7, 14], "#1F2937");
      box("head", [0, 14.3, 0], [9, 7.4, 9], "#1F2937", { lod: 0 });
      box("head", [0, 11.5, 0], [9.2, 1.3, 9.2], a.accent);
      break;
    case "straw":
      box("head", [0, 10.3, 0], [17, 0.6, 17], "#E9C46A", { lod: 0 });
      box("head", [0, 12.2, 0], [9.5, 3.4, 9.5], "#E9C46A", { lod: 0 });
      box("head", [0, 11, 0], [9.7, 1, 9.7], "#E63946");
      break;
    case "headphones":
      box("head", [0, 10.9, 0], [11.8, 1, 2.2], "#1F2937");
      box("head", [5.9, 8, 0], [1, 5, 2.2], "#1F2937");
      box("head", [-5.9, 8, 0], [1, 5, 2.2], "#1F2937");
      box("head", [6.2, 5, 0], [1.8, 3.6, 3.6], a.accent, { lod: 0 });
      box("head", [-6.2, 5, 0], [1.8, 3.6, 3.6], a.accent, { lod: 0 });
      break;
    case "beret":
      box("head", [0.7, 10.8, 0], [11.4, 1.8, 11.4], shade(hc, -0.2), { r: [0, 0, -0.16], lod: 0 });
      box("head", [0.6, 12, 0], [1, 1.2, 1], shade(hc, -0.2));
      break;
    case "crown":
      box("head", [0, 10.9, 0], [10.4, 1.8, 10.4], "#F2C14E", { lod: 0 });
      for (const [x, z] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5], [0, 4.5], [0, -4.5], [4.5, 0], [-4.5, 0]])
        box("head", [x, 12.6, z], [1.4, 1.8, 1.4], "#F2C14E");
      box("head", [0, 10.9, 5.25], [1.4, 1, 0.4], "#E11D48");
      break;
    case "party":
      [8, 6, 4, 2].forEach((w, i) => box("head", [0, 11 + i * 2, 0], [w, 2, w], i % 2 ? a.accent : hc, { lod: i < 2 ? 0 : 1 }));
      box("head", [0, 18.6, 0], [1.8, 1.8, 1.8], "#FFFFFF");
      break;
  }
}

/** Harici ajan aksesuarı: Claude Code "kulaklık" (mikrofonlu), Codex "vizör". */
function accessoryParts(kind: Accessory, a: Avatar, box: BoxFn) {
  if (kind === "headset") {
    const c = "#D97757";
    box("head", [0, 10.9, 0], [11.8, 1, 2.2], "#2B2B2B");
    box("head", [5.9, 8, 0], [1, 5, 2.2], "#2B2B2B");
    box("head", [-5.9, 8, 0], [1, 5, 2.2], "#2B2B2B");
    box("head", [6.2, 5, 0], [1.8, 3.8, 3.8], c, { lod: 0 });
    box("head", [-6.2, 5, 0], [1.8, 3.8, 3.8], c, { lod: 0 });
    box("head", [-6.3, 3.2, 2.6], [0.7, 0.7, 4], "#2B2B2B");
    box("head", [-5.2, 2.6, 4.9], [2.2, 0.7, 0.7], "#2B2B2B");
    box("head", [-3.9, 2.6, 5.15], [1.2, 1.1, 1.1], "#FFB59A", { glow: true });
    return;
  }
  const z = a.species === "fox" || a.species === "dog" || a.species === "bear" ? 5.45 : 5.3;
  box("head", [0, 5.3, z], [11.2, 2.8, 0.7], "#1E3A5F", { o: 0.82, lod: 0 });
  box("head", [0, 5.3, z + 0.4], [9.6, 0.5, 0.15], "#7DD3FC", { glow: true });
  box("head", [5.6, 5.3, z / 2], [0.8, 2.4, z + 0.4], "#334155");
  box("head", [-5.6, 5.3, z / 2], [0.8, 2.4, z + 0.4], "#334155");
  box("head", [0, 5.3, -5.2], [11.2, 1.4, 0.6], "#334155");
}

// ------------------------------------------------------------------ duruş (animasyon)
/** Kemik hedefleri: kol x/z, bacak x, kafa x/y/z, gövde y (konum), kök y (konum), x (dönüş) ve z (konum: oturunca
 *  masaya doğru öne kayma, S33). */
export interface Pose { la: number; ra: number; laz: number; raz: number; ll: number; rl: number; hx: number; hy: number; hz: number; by: number; ry: number; rx: number; fz: number }

export const newPose = (): Pose => ({ la: 0, ra: 0, laz: 0, raz: 0, ll: 0, rl: 0, hx: 0, hy: 0, hz: 0, by: 0, ry: 0, rx: 0, fz: 0 });

/** S43 — oturağın türü (istasyonun `pose` alanından): sandalye (masaya doğru öne kayar), bank/kütük, zemin (minder,
 *  çimen, kum), şezlong/hamak (arkaya yaslanır), kanepe (dinlenme karosundan geriye, oturak yüksekliğine). */
export type Seat = "chair" | "bench" | "ground" | "lounge" | "sofa";
/** S43 — ek duruş girdileri: oturak ve ajan başına tohum (0–1; uyuklama ritmi ajanlar arasında eşzamanlı olmasın). */
export interface PoseOpts { seat?: Seat; seed?: number; phase?: number }

/** Oturan hareketler (S33): bacaklar kalça pivotunda öne döner, kök sandalye oturağına göre hafif yükselir ve öne kayar.
 *  S43: masada/bankta uyuklama (`sitDoze`) ve oturduğu yerde uyuyakalma (`slump`) da oturan hareketlerdir. */
export const SEATED: ReadonlySet<Motion> = new Set<Motion>(["sit", "sitType", "sitThink", "lounge", "sitDoze", "slump", "spin", "board", "sitEat"]);

/**
 * ACTIVITY-FEEL (B3) — yemek yeme kolu: sağ el yiyeceği ağza götürür (ısırık), indirip çiğner; ≈ 2,2 sn döngü. Baş ısırıkta
 * hafif öne, çiğnerken küçük sallanır. Hareket azaltmada el göğüs önünde, yiyecek elde (durağan).
 */
export function eatArms(out: Pose, t: number, calm: boolean, seed = 0): void {
  if (calm) { out.ra = -1.45; out.raz = 0.22; out.hx = 0.05; return; }
  const u = ((t + seed * 1.7) % 2.2) / 2.2;
  // 0–0,18 kaldır · 0,18–0,42 ağızda (ısırık) · 0,42–0,6 indir · 0,6–1 göğüs önünde çiğne
  const lift = u < 0.18 ? u / 0.18 : u < 0.42 ? 1 : u < 0.6 ? 1 - (u - 0.42) / 0.18 : 0;
  const k = lift * lift * (3 - 2 * lift);
  out.ra = -1.15 - k * 1.05; out.raz = 0.16 + k * 0.16;
  out.hx = 0.04 + (u >= 0.2 && u < 0.4 ? 0.08 : 0);
  if (u >= 0.42) out.hz = Math.sin(t * 14) * 0.035; // çiğneme
  out.la = -0.35; out.laz = 0.08;
}
/** S43 — yatarak/yaslanarak uyuma (uyku yeri: yatak, ranza, şilte → `sleep`; hamak, şezlong, kanepe → `sleepLounge`). */
export const LYING: ReadonlySet<Motion> = new Set<Motion>(["sleep", "sleepLounge"]);
const SIT_LEG = -Math.PI / 2;
const SIT_RY = 0.6;
const SIT_FZ = 3;
/** kalça pivotunun kökten yüksekliği (px): bacak pivotu 6 + oturma payı */
const HIP = 6.6;

const frac = (x: number) => x - Math.floor(x);
const hash = (n: number) => frac(Math.sin(n * 12.9898 + 4.1) * 43758.5453);

/** Kalçayı yerinde tutarak gövdeyi `a` radyan arkaya yaslar (şezlong, hamak); bacaklar öne uzanır. */
function recline(out: Pose, a: number) {
  out.rx = -a; out.ry = SIT_RY + HIP * (1 - Math.cos(a)); out.fz = HIP * Math.sin(a);
  out.ll = SIT_LEG + a - 0.12; out.rl = SIT_LEG + a - 0.08;
}

/**
 * S43 — gerçekçi uyuklama: baş yavaşça öne düşer (giderek hızlanır), sonra küçük bir silkinmeyle geri kalkar; ara sıra
 * yana hafif salınır, omuzlar başla birlikte çöker. Periyot ve genlik ajan tohumuyla değişir (eşzamanlı sallanmazlar).
 * Hareket azaltmada durağan: baş öne eğik.
 */
function nod(out: Pose, t: number, seed: number, calm: boolean, base: number) {
  if (calm) { out.hx = base + 0.34; out.hz = (seed - 0.5) * 0.12; return; }
  const period = 4.3 + seed * 2.7;
  const cyc = (t + seed * 31) / period;
  const n = Math.floor(cyc), u = cyc - n;
  const amp = 0.36 + 0.34 * hash(n + seed * 97);
  let h: number;
  if (u < 0.88) { const v = u / 0.88; h = amp * v * v * (0.35 + 0.65 * v); }
  else h = -0.07; // silkinme: lerpPose (k ≈ dt·10) bunu ~0,15 sn'lik hızlı bir kalkışa çevirir
  out.hx = base + h;
  out.hz = Math.sin(t * 0.29 + seed * 6.3) * 0.07 + (h > 0 ? h * 0.18 * (seed > 0.5 ? 1 : -1) : 0);
  out.hy = Math.sin(t * 0.17 + seed * 4) * 0.05;
  out.by = -Math.max(0, h) * 0.55;
}

/** Hareket türüne göre anlık duruş hedefi. `calm`: hareket azaltma — zıplama, sallanma, el sallama ve jest yok;
 *  oturma/uyuma gibi işlevsel duruşlar korunur (durağan). S43: `opts.seat` oturan duruşu istasyonun oturağına uyarlar
 *  (bank/zemin/şezlong: dizüstü kucakta), `opts.seed` uyuklama ritmini ajana göre değiştirir. */
export function poseTargets(m: Motion, t: number, calm: boolean, out: Pose, opts?: PoseOpts): Pose {
  out.la = 0; out.ra = 0; out.laz = 0; out.raz = 0; out.ll = 0; out.rl = 0; out.hx = 0; out.hy = 0; out.hz = 0; out.by = 0; out.ry = 0; out.rx = 0; out.fz = 0;
  const seed = opts?.seed ?? 0;
  if (SEATED.has(m)) {
    const seat: Seat = m === "lounge" ? "sofa" : opts?.seat ?? "chair";
    out.ll = SIT_LEG; out.rl = SIT_LEG; out.ry = SIT_RY; out.fz = SIT_FZ;
    if (seat === "sofa") { out.ry = 5; out.fz = -15; }
    else if (seat === "bench" || seat === "ground") out.fz = 0.8;
    else if (seat === "lounge") recline(out, 0.72);
    const lap = seat === "bench" || seat === "ground" || seat === "lounge";
    if (m === "sitType") {
      if (lap) {
        // kucaktaki dizüstüne yazıyor: eller aşağıda ve içe dönük, baş ekrana eğik
        const base = seat === "lounge" ? -0.5 : -0.8;
        out.la = base + (calm ? 0 : Math.sin(t * 17) * 0.1); out.ra = base + (calm ? 0 : Math.cos(t * 17) * 0.1);
        out.laz = 0.16; out.raz = -0.16;
        out.hx = (seat === "lounge" ? 0.62 : 0.42) + (calm ? 0 : Math.sin(t * 3) * 0.04);
      } else {
        out.la = -1.2 + (calm ? 0 : Math.sin(t * 17) * 0.12); out.ra = -1.2 + (calm ? 0 : Math.cos(t * 17) * 0.12);
        out.hx = 0.2 + (calm ? 0 : Math.sin(t * 3) * 0.04);
      }
    } else if (m === "sitThink") {
      out.ra = -2.2; out.raz = 0.35; out.hz = 0.12; out.hx = -0.1 + (seat === "lounge" ? 0.4 : 0); out.la = -0.55 + (calm ? 0 : Math.sin(t * 1.5) * 0.05);
    } else if (m === "sitDoze") {
      // masada/bankta uyukluyor: eller kucakta (şezlongda karında), baş düşüp kalkıyor
      out.la = seat === "lounge" ? -0.35 : -0.5; out.ra = out.la; out.laz = 0.1; out.raz = -0.1;
      nod(out, t, seed, calm, seat === "lounge" ? 0.25 : 0.04);
      if (seat !== "lounge" && seat !== "sofa") out.ry += out.by * 0.4;
    } else if (m === "spin") {
      // S48: sandalyede dönme — kollar açık, ayaklar havada, baş geride (dönüşü Crowd yüz yönüyle yapar)
      out.laz = -1.25; out.raz = 1.25; out.la = -0.3; out.ra = -0.3; out.hx = -0.22; out.ll = SIT_LEG - 0.35; out.rl = SIT_LEG - 0.35;
    } else if (m === "board") {
      // W2-INT: masa oyunu — öne eğik, sol el masada; sırası gelince (evre < 0,5) sağ el taşı sürer, değilse rakibi izler
      const ph = opts?.phase ?? 0, mine = ph < 0.5, u = (ph % 0.5) / 0.5;
      out.la = -1.15; out.laz = 0.2; out.hx = 0.32; out.ry = SIT_RY - 0.2;
      if (calm) { out.ra = -1.1; out.raz = -0.15; }
      else if (mine && u > 0.08 && u < 0.7) { const k = Math.sin(Math.PI * (u - 0.08) / 0.62); out.ra = -1.15 - 0.35 * k; out.raz = -0.2 + 0.15 * k; out.hx = 0.42; }
      else { out.ra = -0.75; out.raz = -0.1; out.hx = mine ? 0.36 : 0.26 + Math.sin(t * 0.7 + seed * 5) * 0.04; out.hy = mine ? 0 : Math.sin(t * 0.4 + seed) * 0.1; }
    } else if (m === "sitEat") {
      // ACTIVITY-FEEL (B3): oturarak yemek (bankta/taburede/minderde)
      eatArms(out, t, calm, seed);
    } else if (m === "slump") {
      // oturduğu yerde uyuyakaldı: sandalyede başı masaya düşmüş, kollar masada; bank/kanepede baş yana/öne düşük
      const breath = calm ? 0 : Math.sin(t * 1.25 + seed * 5) * 0.14;
      if (seat === "chair") { out.la = -1.3; out.ra = -1.22; out.laz = 0.22; out.raz = -0.22; out.hx = 0.92; out.hz = (seed - 0.5) * 0.3; out.by = -0.5 + breath; }
      else { out.la = -0.2; out.ra = -0.3; out.laz = 0.08; out.raz = -0.06; out.hx = seat === "lounge" ? 0.3 : 0.62; out.hz = seed > 0.5 ? 0.32 : -0.32; out.by = -0.5 + breath; }
    } else {
      // boşta oturan: eller dizde; ara sıra gerinir ya da kahvesinden yudum alır (hareket azaltmada durağan)
      out.la = -0.55; out.ra = -0.55;
      if (seat === "lounge") { out.la = -0.35; out.ra = -0.35; out.hx = 0.3; }
      if (!calm) {
        const stretch = t % 23, sip = (t + 9) % 15;
        if (stretch < 1.9) { out.la = -2.95; out.ra = -2.95; out.hx = -0.18; out.by = 0.4; }
        else if (sip < 2.6 && seat !== "lounge") { out.ra = -2.1; out.raz = 0.28; out.hx = -0.12; }
        else { out.hy = Math.sin(t * 0.45) * 0.16; out.by = Math.sin(t * 2) * 0.1; }
      }
    }
    return out;
  }
  // S43: yatarak uyuma — kalça pivotu kökte kalır; gövde ortalanır (karonun ortasında yatar), baş yana dönük, nefes alır
  if (m === "sleep") {
    out.rx = -Math.PI / 2; out.ry = 2.6; out.fz = 14;
    out.la = -0.12; out.ra = -0.12; out.laz = 0.12; out.raz = -0.12; out.hy = seed > 0.5 ? 0.35 : -0.35;
    if (!calm) out.by = Math.sin(t * 1.1 + seed * 5) * 0.16;
    return out;
  }
  if (m === "sleepLounge") {
    recline(out, 1.02);
    out.la = -0.35; out.ra = -0.42; out.laz = 0.2; out.raz = -0.2; out.hz = seed > 0.5 ? 0.36 : -0.36; out.hx = -0.05;
    if (!calm) out.by = Math.sin(t * 1.1 + seed * 5) * 0.14;
    return out;
  }
  if (m === "doze") {
    // ayakta uyukluyor: kollar sarkık, baş düşüp silkinerek kalkıyor, gövde hafifçe salınıyor
    out.la = 0.04; out.ra = -0.04; out.laz = -0.05; out.raz = 0.05;
    nod(out, t, seed, calm, 0.02);
    return out;
  }
  if (m === "umbrella") {
    // W2-INT: şemsiye — sağ el başın yanında sapı tutar, sol el yanda; baş hafif yukarı (yağmuru izler)
    out.ra = -0.468; out.raz = 1.064; out.la = -0.15; out.laz = -0.06; out.hx = -0.08; // CEOGOZU: UMB_ARM (umbrella.ts; ceo_eye eşitliği sınar) — el sapı başın sağında tutar
    if (!calm) { out.hy = Math.sin(t * 0.5 + seed * 7) * 0.14; out.by = Math.sin(t * 1.6 + seed) * 0.05; }
    return out;
  }
  if (m === "tablet") {
    // ayakta tablet: iki elle göğüs hizasında tutar, sağ el ara sıra dokunur
    out.la = -1.0; out.ra = -1.06; out.laz = 0.32; out.raz = -0.32; out.hx = 0.36;
    if (!calm) { out.ra += Math.sin(t * 6.5 + seed * 9) > 0.55 ? -0.16 : 0; out.hx += Math.sin(t * 0.7) * 0.03; out.hy = Math.sin(t * 0.4 + seed) * 0.08; }
    return out;
  }
  if (FUN.has(m)) return funPose(m, t, calm, out, seed, opts?.phase ?? 0);
  switch (calm && m !== "walk" ? "calm" : m) {
    case "calm":
      if (m === "type") { out.la = -1.1; out.ra = -1.1; out.hx = 0.15; }
      else if (m === "think") { out.ra = -2.2; out.raz = 0.35; out.hz = 0.1; }
      else if (m === "wave") { out.raz = 2.4; }
      else if (m === "read") { out.la = -1.3; out.ra = -1.3; out.laz = 0.3; out.raz = -0.3; out.hx = 0.28; }
      else if (m === "sip") { out.ra = -2.1; out.raz = 0.28; }
      else if (m === "eat") eatArms(out, t, true);
      else if (m === "cheer") { out.raz = 2.6; }
      break;
    case "walk": {
      const s = Math.sin(t * 9);
      out.ll = s * 0.7; out.rl = -s * 0.7; out.la = -s * 0.6; out.ra = s * 0.6; out.by = Math.abs(s) * 0.6;
      break;
    }
    case "type":
      out.la = -1.15 + Math.sin(t * 17) * 0.14; out.ra = -1.15 + Math.cos(t * 17) * 0.14; out.hx = 0.18 + Math.sin(t * 3) * 0.04;
      break;
    case "think":
      out.ra = -2.2; out.raz = 0.35; out.hz = 0.14; out.hx = -0.12; out.la = Math.sin(t * 1.5) * 0.05;
      break;
    case "read":
      // kitaplık/pencere önünde okuyor: iki elle kitap, baş eğik, ara sıra sayfa çevirir
      out.la = -1.3; out.ra = -1.3 + ((t % 6) < 0.5 ? -0.5 : 0); out.laz = 0.3; out.raz = -0.3; out.hx = 0.28 + Math.sin(t * 0.8) * 0.04;
      out.hy = Math.sin(t * 0.6) * 0.12;
      break;
    case "talk":
      out.la = -0.45 + Math.sin(t * 5) * 0.32; out.ra = -0.3 + Math.sin(t * 4 + 1) * 0.42; out.laz = -0.1; out.raz = 0.12;
      out.hx = Math.sin(t * 6) * 0.07; out.hz = Math.sin(t * 2.2) * 0.06;
      break;
    case "listen":
      out.hx = 0.06 + Math.max(0, Math.sin(t * 3.2)) * 0.14; out.hz = 0.08; out.la = 0.05; out.ra = -0.05;
      break;
    case "sip":
      out.ra = -2.1 + Math.sin(t * 1.2) * 0.08; out.raz = 0.28; out.hx = -0.1; out.la = Math.sin(t * 1.6) * 0.05; out.by = Math.sin(t * 2) * 0.1;
      break;
    case "eat":
      // ACTIVITY-FEEL (B3): ayakta yemek — gövde hafif salınır
      eatArms(out, t, false, seed); out.by = Math.sin(t * 2) * 0.08;
      break;
    case "cheer":
      // ✓ bitti: tek kol havada, küçük sekme
      out.raz = 2.75 + Math.sin(t * 9) * 0.15; out.ry = Math.abs(Math.sin(t * 8)) * 2.2; out.la = -0.25; out.hz = -0.1;
      break;
    case "jump":
      out.ry = Math.abs(Math.sin(t * 7)) * 6; out.la = -2.9 + Math.sin(t * 14) * 0.2; out.ra = -2.9 - Math.sin(t * 14) * 0.2;
      break;
    case "wave":
      out.raz = 2.5 + Math.sin(t * 8) * 0.35; out.hz = -0.08;
      break;
    case "shake":
      out.hy = Math.sin(t * 16) * 0.35; out.la = 0.2; out.ra = 0.2; out.laz = -0.2; out.raz = 0.2;
      break;
    default:
      out.la = Math.sin(t * 1.6) * 0.06; out.ra = -out.la; out.hy = Math.sin(t * 0.45) * 0.18; out.by = Math.sin(t * 2) * 0.12;
  }
  return out;
}

// ------------------------------------------------------------------ S48: eğlenceli hareketler ve şakşak
const FUN: ReadonlySet<Motion> = new Set<Motion>(["dance", "fish", "reel", "paddle", "toss", "bowl", "snowball", "juggle", "kick", "yoga", "highfive",
  "victory", "stagger", "fall", "clap", "give"]);
const TAU = Math.PI * 2;
/** pürüzsüz tepe: u ∈ [a, b] aralığında 0 → 1 → 0 */
const bump = (u: number, a: number, b: number) => (u <= a || u >= b ? 0 : Math.sin(((u - a) / (b - a)) * Math.PI));

/**
 * S48 — eğlence duruşları. `phase` (0–1) karşılıklı oyunlarda vuruş/atış anını topla eşler: 0'da vurur/atar, 0,5'te
 * karşıdan gelen topu karşılar. Hareket azaltmada her hareket durağan bir duruşa iner (zıplama, sallanma yok).
 */
function funPose(m: Motion, t: number, calm: boolean, out: Pose, seed: number, ph: number): Pose {
  switch (m) {
    case "dance": {
      if (calm) { out.laz = -0.5; out.raz = 0.5; break; }
      const b = t * 2 * TAU * (0.9 + seed * 0.25); // ≈ 110–130 vuruş/dk
      if (seed < 0.5) {
        // "disko": sağ kol yukarı-aşağı çapraz, sol kol belde; kalça sekmesi, baş sallama
        out.raz = 1.2 + Math.sin(b * 0.5) * 1.1; out.ra = -0.6 - Math.sin(b * 0.5) * 0.6; out.la = -0.3; out.laz = -0.5;
        out.ll = Math.max(0, Math.sin(b)) * -0.35; out.rl = Math.max(0, -Math.sin(b)) * -0.35;
      } else {
        // "kanat çırpma": iki kol yanlarda inip kalkar, dizler sekiyor
        out.laz = -0.7 - Math.sin(b) * 0.55; out.raz = 0.7 + Math.sin(b) * 0.55; out.la = -0.3; out.ra = -0.3;
        out.ll = Math.sin(b) * 0.25; out.rl = -Math.sin(b) * 0.25;
      }
      out.by = -Math.abs(Math.sin(b)) * 0.6; out.ry = Math.abs(Math.cos(b)) * 0.9;
      out.hx = Math.sin(b) * 0.1; out.hz = Math.sin(b * 0.5) * 0.14; out.hy = Math.sin(b * 0.25) * 0.25;
      break;
    }
    case "fish":
      // olta: iki el önde birlikte, baş hafif eğik, sabırla bekler
      out.la = -0.95; out.ra = -0.95; out.laz = 0.24; out.raz = -0.24; out.hx = 0.14;
      if (!calm) { out.by = Math.sin(t * 1.2 + seed * 4) * 0.08; out.hy = Math.sin(t * 0.35 + seed * 3) * 0.18; }
      break;
    case "reel":
      // çekiş: olta yukarı, geriye yaslanır
      out.la = -2.0; out.ra = -2.0; out.laz = 0.2; out.raz = -0.2; out.hx = -0.2; out.rx = calm ? 0 : -0.08;
      if (!calm) out.by = Math.sin(t * 14) * 0.2;
      break;
    case "paddle": {
      // masa tenisi: hafif çömelik, sağ kol vuruşta ileri savrulur (phase 0), sol kol dengede
      out.by = -0.45; out.ry = -0.4; out.la = -0.5; out.laz = -0.25; out.raz = 0.45; out.hx = 0.12;
      if (calm) { out.ra = -0.9; break; }
      const hit = bump(ph, 0.88, 1) + bump(ph, 0, 0.12);
      out.ra = -0.6 - hit * 1.1 + bump(ph, 0.6, 0.88) * 0.7; // geri çekiş → vuruş
      out.hy = Math.sin(ph * TAU) * 0.18; out.by += Math.sin(ph * TAU * 2) * 0.12;
      break;
    }
    case "toss": {
      // at-tut (frizbi, kâğıt uçak, top): 0'da atış, 0,5'te karşılama
      if (calm) { out.ra = -1.1; out.la = -1.1; break; }
      const wind = bump(ph, 0.8, 1), thr = bump(ph, 0, 0.18), cat = bump(ph, 0.38, 0.62);
      out.ra = -0.25 + wind * 1.1 - thr * 1.9 - cat * 1.0; out.raz = 0.15 + thr * 0.3;
      out.la = -0.25 - cat * 1.15 - wind * 0.4; out.laz = -0.15;
      out.hx = -cat * 0.12; out.ry = thr * 0.8; out.by = -wind * 0.3;
      break;
    }
    case "bowl": {
      // W2b-INT pétanque: 0'da alttan bırakış — kol geriye salınır (0,78–1), öne-aşağıdan bırakır (0–0,16), hafif çömelme ve
      // öne adım; arada ayakta izler (kollar yanda). Raket yok, sıçrama yok.
      if (calm) { out.ra = -0.35; out.la = -0.1; break; }
      const wind = bump(ph, 0.78, 1), thr = bump(ph, 0, 0.16), watch = bump(ph, 0.2, 0.7);
      out.ra = -0.1 + wind * 0.9 - thr * 1.05; out.raz = 0.12;
      out.la = -0.15 - (wind + thr) * 0.35; out.laz = -0.2;
      out.by = -(wind + thr) * 0.55; out.rl = -thr * 0.35 - wind * 0.2; out.hx = 0.1 + (wind + thr) * 0.08 - watch * 0.05;
      break;
    }
    case "snowball": {
      // kartopu: 0'da atar; 0,5'te karşıdan gelen top çarpar (sarsılır), sonra eğilip yenisini yapar, geri çekip atar
      if (calm) { out.ra = -1.2; out.raz = 0.3; break; }
      const thr = bump(ph, 0, 0.16), hit = bump(ph, 0.5, 0.62), scoop = bump(ph, 0.62, 0.84), wind = bump(ph, 0.84, 1);
      out.ra = -0.3 - thr * 2.2 + wind * 1.3 - scoop * 0.9; out.la = -0.3 - scoop * 0.9 + hit * 0.4;
      out.laz = -hit * 0.9; out.raz = hit * 0.9 + thr * 0.25;
      out.rx = hit * -0.18; out.hy = hit * Math.sin(t * 24) * 0.3; out.by = -scoop * 1.6; out.hx = scoop * 0.5;
      out.ry = -scoop * 1.4; out.ll = -scoop * 0.5; out.rl = -scoop * 0.5;
      break;
    }
    case "juggle": {
      // hokkabazlık: eller önde dönüşümlü, baş toplara bakar
      const w = calm ? 0 : Math.sin(t * TAU * 1.5);
      out.la = -1.15 + w * 0.22; out.ra = -1.15 - w * 0.22; out.laz = 0.15; out.raz = -0.15; out.hx = -0.28;
      if (!calm) out.by = Math.abs(w) * 0.12;
      break;
    }
    case "kick": {
      // top: 0'da sağ ayakla vuruş (sektirme/pas), 0,5 civarında sol ayakla karşılama
      if (calm) break;
      const k = bump(ph, 0, 0.18), trap = bump(ph, 0.42, 0.6);
      out.rl = -k * 1.05 + bump(ph, 0.85, 1) * 0.45; out.ll = -trap * 0.45;
      out.la = 0.35 * k - 0.15; out.ra = -0.35 * k - 0.1; out.laz = -0.4; out.raz = 0.4;
      out.hx = 0.25; out.ry = trap * 0.4; out.rx = -k * 0.05;
      break;
    }
    case "yoga": {
      // üç duruş döngüsü (phase 0–1, ~8 sn): gerinme → yana esneme → savaşçı
      const u = calm ? 0 : ph;
      if (u < 0.33) { out.la = -3.0; out.ra = -3.0; out.hx = -0.25; out.by = 0.45; out.ry = 0.6 * bump(u, 0, 0.33); }
      else if (u < 0.66) {
        const s = Math.sin(((u - 0.33) / 0.33) * TAU);
        out.la = -3.0; out.ra = -3.0; out.laz = s * 0.45; out.raz = s * 0.45; out.hz = s * 0.22; out.hx = -0.1;
      } else {
        out.laz = -1.5; out.raz = 1.5; out.ll = 0.42; out.rl = -0.5; out.hy = 0.8; out.by = -0.5; out.ry = -0.6;
      }
      if (!calm) out.by += Math.sin(t * 1.3) * 0.08; // nefes
      break;
    }
    case "highfive": {
      // çak bir beşlik: sağ el kalkar, 0,45'te el ele (küçük sekme), sonra iner
      const up = ph < 0.8 ? Math.min(1, ph / 0.3) : Math.max(0, 1 - (ph - 0.8) / 0.2);
      out.raz = up * 2.2; out.ra = -up * 0.75; out.la = -0.2; out.hx = -0.1;
      if (!calm) { out.ry = bump(ph, 0.42, 0.72) * 3; out.by = bump(ph, 0.42, 0.72) * 0.5; }
      break;
    }
    case "clap": {
      // W3: alkış — iki el göğüs önünde birleşip ayrılır (hareket azaltmada eller birleşik, durağan)
      out.la = -1.25; out.ra = -1.25; out.hx = -0.08;
      const k = calm ? 0 : Math.max(0, Math.sin(t * 15));
      out.laz = 0.55 - k * 0.4; out.raz = -0.55 + k * 0.4;
      if (!calm) out.by = Math.abs(Math.sin(t * 7.5)) * 0.25;
      break;
    }
    case "give": {
      // W3: hediye uzatma — sağ kol öne (eşya elde), baş hafif öne
      out.ra = -1.45; out.raz = 0.05; out.la = -0.15; out.hx = 0.12;
      break;
    }
    case "victory": {
      // zafer dansı: iki kol havada, zıplar, omuz sallar
      if (calm) { out.laz = -2.6; out.raz = 2.6; break; }
      const j = Math.sin(t * 8.5 + seed * 3);
      out.laz = -2.55 + j * 0.3; out.raz = 2.55 + j * 0.3; out.la = -0.25; out.ra = -0.25;
      out.ry = Math.abs(j) * 5; out.hx = -0.18; out.hz = j * 0.12; out.ll = -Math.abs(j) * 0.4; out.rl = -Math.abs(j) * 0.4;
      break;
    }
    case "stagger":
      // çarpışma: geriye sendeler, kollar savrulur, baş sallanır
      out.rx = -0.22; out.laz = -1.2; out.raz = 1.2; out.la = 0.3; out.ra = 0.3;
      if (!calm) { out.laz += Math.sin(t * 19) * 0.45; out.raz += Math.cos(t * 17) * 0.45; out.hy = Math.sin(t * 22) * 0.3; out.ry = Math.abs(Math.sin(t * 11)) * 0.8; }
      break;
    case "fall":
      // popo üstü düşme: bacaklar önde yerde, eller arkada destek, baş sersem döner
      out.ll = SIT_LEG + 0.12; out.rl = SIT_LEG + 0.05; out.ry = -5.2; out.la = 0.75; out.ra = 0.75; out.laz = -0.25; out.raz = 0.25;
      out.hx = -0.08;
      if (!calm) { out.hz = Math.sin(t * 5.5) * 0.25; out.hy = Math.cos(t * 5.5) * 0.25; }
      break;
  }
  return out;
}

const POSE_KEYS = Object.keys(newPose()) as (keyof Pose)[];
/** Mevcut duruşu hedefe yumuşakça yaklaştırır (k = min(1, dt·10)). */
export function lerpPose(cur: Pose, target: Pose, k: number) {
  for (const key of POSE_KEYS) cur[key] += (target[key] - cur[key]) * k;
}
