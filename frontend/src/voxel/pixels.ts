/**
 * Piksel sanatı çizimleri: yüz (20×20 ızgara = 10 px kafa ön yüzü), gövde ön yüzü (16×16) ve
 * listelerde kullanılan 2B "kafa ikonu". Aynı çizim fonksiyonları hem three.js dokusu hem de
 * <canvas> ikonu üretir; böylece 3B karakter ile ikon her zaman birbirini tutar.
 */
import type { Avatar, Mood } from "../lib/types";
import { shade } from "./avatar";

export type Face = "smile" | "blink" | "think" | "focus" | "curious" | "happy" | "dizzy" | "sleep"
  /** ACTIVITY-CAM: etkinlik ifadeleri (fun/activityFace.ts) — çiğneme (ağız açık / kapalı), yudum (gözler yarı kapalı), keyif
   *  (^ ^ kapalı mutlu gözler + açık gülümseme). 2 × 2 yüz pikseli (= 1 voksel pikseli) bloklarla: yakın kadrajda okunur. */
  | "chew" | "munch" | "sip" | "joy";

export const MOOD_FACE: Record<Mood, Face> = {
  idle: "smile", thinking: "think", working: "focus", waiting: "curious",
  done: "happy", error: "dizzy", offline: "sleep",
};

const INK = "#1E1B2E";
const SNOUT = new Set(["dog", "fox", "bear"]);

type Px = (x: number, y: number, c: string, a?: number) => void;

export function painter(ctx: CanvasRenderingContext2D, ox = 0, oy = 0, k = 1): Px {
  return (x, y, c, a = 1) => {
    ctx.globalAlpha = a;
    ctx.fillStyle = c;
    ctx.fillRect((ox + x) * k, (oy + y) * k, k, k);
    ctx.globalAlpha = 1;
  };
}

function rect(px: Px, x0: number, y0: number, x1: number, y1: number, c: string, a = 1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, c, a);
}

/** 20×20 yüz özellikleri (zemin rengi çizilmez — kafa kutusu zaten ten/kürk rengindedir). */
export function drawFace(px: Px, a: Avatar, face: Face) {
  const sp = a.species;
  const eye = sp === "panda" ? "#FFFFFF" : INK;
  if (sp === "panda") {
    rect(px, 3, 7, 8, 12, "#1F1F1F");
    rect(px, 11, 7, 16, 12, "#1F1F1F");
  }
  if (sp === "penguin") {
    rect(px, 3, 7, 16, 19, "#F8FAFC");
    rect(px, 8, 7, 11, 8, a.skin);
  }
  if (sp === "fox") {
    rect(px, 0, 12, 5, 19, "#FFF7ED", 0.95);
    rect(px, 14, 12, 19, 19, "#FFF7ED", 0.95);
  }

  const eyes = (fn: (x: number) => void) => { fn(5); fn(13); };
  if (face === "chew" || face === "munch" || face === "sip" || face === "joy") { activityFace(px, a, face, eye); return; }
  switch (face) {
    case "blink":
    case "sleep":
      eyes((x) => { px(x - 1, 9, eye); px(x, 10, eye); px(x + 1, 10, eye); px(x + 2, 9, eye); });
      break;
    case "happy":
      eyes((x) => { px(x - 1, 10, eye); px(x, 9, eye); px(x + 1, 9, eye); px(x + 2, 10, eye); });
      break;
    case "dizzy":
      eyes((x) => { px(x - 1, 8, eye); px(x + 1, 8, eye); px(x, 9, eye); px(x - 1, 10, eye); px(x + 1, 10, eye); });
      break;
    case "focus":
      eyes((x) => { rect(px, x, 9, x + 1, 10, eye); });
      if (sp === "human") { rect(px, 4, 7, 7, 7, shade(a.hairColor, 0.1)); rect(px, 12, 7, 15, 7, shade(a.hairColor, 0.1)); }
      break;
    case "think":
      eyes((x) => { rect(px, x + 1, 7, x + 2, 9, eye); px(x + 1, 7, "#FFFFFF", sp === "panda" ? 0 : 0.9); });
      break;
    default:
      eyes((x) => { rect(px, x, 8, x + 1, 10, eye); px(x, 8, sp === "panda" ? INK : "#FFFFFF", 0.95); });
      if (face === "curious" && sp === "human") rect(px, 12, 6, 15, 6, shade(a.hairColor, 0.1));
  }

  // yanaklar
  if (face === "smile" || face === "happy" || face === "curious") {
    rect(px, 2, 12, 3, 12, "#FF7A9A", 0.55);
    rect(px, 16, 12, 17, 12, "#FF7A9A", 0.55);
  }

  if (sp === "cat" || sp === "rabbit") {
    px(9, 12, "#F472B6"); px(10, 12, "#F472B6");
  }
  if (sp === "cat") {
    for (const y of [12, 14]) { rect(px, 0, y, 2, y, "#FFFFFF", 0.7); rect(px, 17, y, 19, y, "#FFFFFF", 0.7); }
  }
  if (SNOUT.has(sp) || sp === "penguin") return; // ağız burun kutusunda / gagada

  const my = sp === "cat" || sp === "rabbit" ? 14 : 13;
  const mouth = "#7A2E3A";
  switch (face) {
    case "happy":
      rect(px, 8, my, 11, my, mouth); px(9, my + 1, "#F43F5E"); px(10, my + 1, "#F43F5E");
      break;
    case "think":
    case "sleep":
      px(9, my, mouth); px(10, my, mouth); px(9, my + 1, mouth); px(10, my + 1, mouth);
      break;
    case "focus":
      rect(px, 8, my + 1, 11, my + 1, mouth);
      break;
    case "dizzy":
      px(7, my + 1, mouth); px(8, my, mouth); px(9, my + 1, mouth); px(10, my, mouth); px(11, my + 1, mouth); px(12, my, mouth);
      break;
    default:
      px(8, my, mouth); px(9, my + 1, mouth); px(10, my + 1, mouth); px(11, my, mouth);
  }
  if (sp === "rabbit") { px(9, my + 2, "#FFFFFF"); px(10, my + 2, "#FFFFFF"); }
}

/**
 * ACTIVITY-CAM — etkinlik ifadeleri (yalnız 2 × 2 bloklar; tek piksellik çizgi yok): keyif `joy` ^ ^ gözler, kalın açık gülümseme
 * ve dil, büyük yanak; çiğneme `chew` açık ağız (kırmızı iç), `munch` kapalı ağız (küçük nokta, şişkin yanak) ve memnun yay
 * gözler; yudum `sip` yarı kapalı göz kapağı + büzük ağız.
 */
function activityFace(px: Px, a: Avatar, face: "chew" | "munch" | "sip" | "joy", eye: string) {
  const sp = a.species;
  const blk = (x: number, y: number, c: string, al = 1) => rect(px, x, y, x + 1, y + 1, c, al);
  const eyes = (fn: (x: number) => void) => { fn(5); fn(13); };
  if (face === "joy" || face === "munch") {
    // ^ ^ : iki ayak + tepe (gözün ortası x..x+1)
    eyes((x) => { blk(x - 2, 10, eye); blk(x, 8, eye); blk(x + 2, 10, eye); });
  } else if (face === "sip") {
    // yarı kapalı: göz kapağı çizgisi (2 px kalın) ve altta göz bebeği
    eyes((x) => { rect(px, x - 1, 9, x + 2, 10, eye); });
  } else {
    // çiğneme: açık, memnun göz (2 × 3) + parıltı
    eyes((x) => { rect(px, x, 8, x + 1, 10, eye); px(x, 8, sp === "panda" ? INK : "#FFFFFF", 0.95); });
  }
  // yanaklar (keyifte ve çiğnemede belirgin)
  const blush = face === "joy" || face === "munch" ? 0.75 : 0.5;
  blk(1, 12, "#FF7A9A", blush); blk(17, 12, "#FF7A9A", blush);
  if (face === "munch") { blk(15, 13, "#FF7A9A", 0.45); blk(3, 13, "#FF7A9A", 0.45); }
  if (sp === "cat" || sp === "rabbit") { px(9, 12, "#F472B6"); px(10, 12, "#F472B6"); }
  if (SNOUT.has(sp) || sp === "penguin") return;
  const my = sp === "cat" || sp === "rabbit" ? 14 : 13;
  const mouth = "#7A2E3A";
  if (face === "joy") {
    // D biçimli açık gülümseme: üst sıra geniş, alt sıra dar, içte dil
    rect(px, 6, my, 13, my + 1, mouth); rect(px, 8, my + 2, 11, my + 3, mouth); blk(9, my + 2, "#F43F5E");
  } else if (face === "chew") {
    rect(px, 8, my, 11, my + 3, mouth); blk(9, my + 2, "#F43F5E");
  } else if (face === "munch") {
    blk(9, my + 1, mouth);
  } else {
    // yudum: büzük küçük ağız
    blk(9, my + 1, mouth);
  }
}

/** Burunlu türlerde burun kutusunun ön yüzü (8×6): ağız ifadesi. */
export function drawSnout(px: Px, face: Face) {
  const c = "#5B2333";
  // ACTIVITY-CAM: etkinlik ifadeleri (2 × 2 bloklar)
  if (face === "joy") { rect(px, 1, 2, 6, 3, c); rect(px, 3, 4, 4, 5, "#F43F5E"); return; }
  if (face === "chew") { rect(px, 2, 2, 5, 5, c); rect(px, 3, 4, 4, 5, "#F43F5E"); return; }
  if (face === "munch" || face === "sip") { rect(px, 3, 3, 4, 4, c); return; }
  if (face === "happy") { rect(px, 2, 3, 5, 3, c); px(3, 4, "#F43F5E"); px(4, 4, "#F43F5E"); }
  else if (face === "dizzy") { px(1, 4, c); px(2, 3, c); px(3, 4, c); px(4, 3, c); px(5, 4, c); px(6, 3, c); }
  else if (face === "think" || face === "sleep") { px(3, 4, c); px(4, 4, c); }
  else if (face === "focus") rect(px, 2, 4, 5, 4, c);
  else { px(2, 3, c); px(3, 4, c); px(4, 4, c); px(5, 3, c); }
}

/** Gövde ön yüzü (16×16): kıyafet ayrıntıları. */
export function drawBody(px: Px, a: Avatar) {
  const base = a.outfit === "overalls" ? a.accent : a.outfitColor;
  rect(px, 0, 0, 15, 15, base);
  const dark = shade(a.outfitColor, -0.25);
  switch (a.outfit) {
    case "tshirt":
      rect(px, 6, 0, 9, 1, a.skin); rect(px, 7, 2, 8, 2, a.skin);
      break;
    case "hawaii":
      rect(px, 5, 0, 10, 0, "#FFFFFF"); rect(px, 6, 1, 9, 1, "#FFFFFF"); rect(px, 7, 1, 8, 2, a.skin);
      for (const [x, y] of [[2, 4], [11, 3], [5, 9], [12, 10], [2, 13], [9, 14]]) {
        rect(px, x, y, x + 1, y + 1, a.accent); px(x + 1, y + 1, "#FFFFFF");
      }
      for (let y = 3; y < 16; y += 3) px(8, y, dark);
      break;
    case "hoodie":
      rect(px, 0, 0, 15, 0, dark);
      for (let y = 1; y <= 5; y++) { px(6, y, "#F8FAFC"); px(9, y, "#F8FAFC"); }
      rect(px, 3, 10, 12, 14, dark);
      rect(px, 4, 11, 11, 11, shade(a.outfitColor, -0.35));
      break;
    case "suit":
      for (let y = 0; y < 10; y++) {
        const w = Math.max(0, 3 - Math.floor(y / 3));
        rect(px, 8 - w - 1, y, 8 + w, y, "#F8FAFC");
        px(8 - w - 2, y, dark); px(8 + w + 1, y, dark);
      }
      rect(px, 7, 1, 8, 9, a.accent); rect(px, 7, 1, 8, 1, shade(a.accent, -0.3));
      px(8, 11, INK); px(8, 13, INK);
      break;
    case "sweater":
      rect(px, 0, 0, 15, 0, dark);
      rect(px, 0, 4, 15, 5, a.accent); rect(px, 0, 10, 15, 11, a.accent);
      for (let x = 1; x < 16; x += 3) { px(x, 7, a.accent); px(x + 1, 13, a.accent); }
      break;
    case "labcoat":
      rect(px, 6, 0, 9, 4, a.accent); rect(px, 7, 5, 8, 5, a.accent);
      for (let y = 5; y < 16; y++) px(8, y, "#CBD5E1");
      for (const x0 of [2, 10]) { rect(px, x0, 10, x0 + 3, 10, "#CBD5E1"); rect(px, x0, 10, x0, 13, "#CBD5E1"); rect(px, x0 + 3, 10, x0 + 3, 13, "#CBD5E1"); }
      px(7, 8, "#94A3B8"); px(7, 12, "#94A3B8");
      break;
    case "dress":
      rect(px, 5, 0, 10, 1, a.skin);
      rect(px, 0, 9, 15, 10, a.accent);
      for (let x = 1; x < 16; x += 4) px(x, 4, shade(a.outfitColor, 0.25));
      break;
    case "shirt": { // S34: düğmeli yakalı gömlek + cep
      const light = a.outfitColor.toUpperCase() === "#F8FAFC";
      const line = light ? "#CBD5E1" : shade(a.outfitColor, -0.2);
      rect(px, 6, 0, 9, 1, a.skin); px(7, 2, a.skin); px(8, 2, a.skin);
      rect(px, 4, 0, 5, 1, light ? "#FFFFFF" : shade(a.outfitColor, 0.3)); rect(px, 10, 0, 11, 1, light ? "#FFFFFF" : shade(a.outfitColor, 0.3));
      px(5, 2, line); px(10, 2, line);
      for (let y = 3; y < 16; y++) px(8, y, line);
      for (const y of [5, 8, 11, 14]) px(7, y, light ? "#94A3B8" : shade(a.outfitColor, 0.4));
      rect(px, 10, 5, 12, 5, line); rect(px, 10, 5, 10, 7, line); rect(px, 12, 5, 12, 7, line); rect(px, 10, 7, 12, 7, line);
      break;
    }
    case "blazer": // S34: açık ceket, içte vurgu renginde tişört, yaka ve iki düğme
      rect(px, 5, 0, 10, 15, a.accent);
      rect(px, 6, 0, 9, 1, a.skin);
      for (let y = 0; y < 9; y++) { const w = Math.min(2, Math.floor(y / 3)); px(4 + w, y, dark); px(11 - w, y, dark); }
      rect(px, 4, 9, 5, 15, a.outfitColor); rect(px, 10, 9, 11, 15, a.outfitColor);
      px(5, 10, INK); px(5, 13, INK);
      rect(px, 1, 11, 3, 11, dark); rect(px, 12, 11, 14, 11, dark);
      break;
    case "overalls":
      rect(px, 3, 6, 12, 15, a.outfitColor);
      rect(px, 3, 0, 4, 6, a.outfitColor); rect(px, 11, 0, 12, 6, a.outfitColor);
      px(3, 6, "#FACC15"); px(12, 6, "#FACC15");
      rect(px, 6, 9, 9, 11, dark);
      break;
  }
}

// three.js dokuları ./pixelTextures.ts içindedir (BUNDLE: 2B ikonlar three'yi ana pakete çekmesin)

// ------------------------------------------------------------------ 2B kafa ikonu (28×28)
export function drawHeadIcon(ctx: CanvasRenderingContext2D, a: Avatar, face: Face, k: number) {
  const px = painter(ctx, 0, 0, k);
  const head = (x: number, y: number, c: string, al = 1) => px(x + 4, y + 6, c, al);
  const sp = a.species;
  const fur = a.skin;
  // kulaklar
  if (sp === "cat" || sp === "fox") { rect(px, 5, 2, 8, 5, fur); rect(px, 19, 2, 22, 5, fur); if (sp === "fox") { rect(px, 5, 2, 8, 2, "#2B2B2B"); rect(px, 19, 2, 22, 2, "#2B2B2B"); } else { rect(px, 6, 4, 7, 5, "#F9A8D4"); rect(px, 20, 4, 21, 5, "#F9A8D4"); } }
  if (sp === "bear" || sp === "panda") { const c = sp === "panda" ? "#1F1F1F" : fur; rect(px, 4, 3, 8, 7, c); rect(px, 19, 3, 23, 7, c); }
  if (sp === "rabbit") { rect(px, 8, 0, 10, 6, fur); rect(px, 17, 0, 19, 6, fur); rect(px, 9, 1, 9, 5, "#F9A8D4"); rect(px, 18, 1, 18, 5, "#F9A8D4"); }
  if (sp === "dog") { rect(px, 2, 8, 4, 16, shade(fur, -0.25)); rect(px, 23, 8, 25, 16, shade(fur, -0.25)); }
  // kafa
  rect(px, 4, 6, 23, 25, fur);
  rect(px, 4, 25, 23, 25, shade(fur, -0.12));
  // S44: kahraman maskesi (göz bandı yüz çiziminden önce: gözler deliklerde görünür)
  const mc = shade(a.capeColor ?? shade(a.outfitColor, -0.3), -0.15);
  if (a.mask === "domino") { rect(px, 4, 12, 23, 16, mc); rect(px, 8, 13, 11, 15, fur); rect(px, 16, 13, 19, 15, fur); }
  drawFace(head, a, face);
  if (a.mask === "visor") { rect(px, 4, 12, 23, 16, a.aura && a.aura !== "none" ? a.aura : "#7DD3FC", 0.5); rect(px, 4, 11, 23, 11, mc); }
  if (SNOUT.has(sp)) {
    const sc = sp === "fox" ? "#FFF7ED" : shade(fur, 0.35);
    rect(px, 10, 18, 17, 23, sc);
    rect(px, 12, 18, 15, 19, "#1F1A17");
    const snoutPx: Px = (x, y, c, al) => px(x + 10, y + 18, c, al);
    drawSnout(snoutPx, face);
  }
  if (sp === "penguin") rect(px, 12, 19, 15, 20, "#F59E0B");
  // saç
  if (a.mask === "cowl") { rect(px, 3, 3, 24, 9, mc); rect(px, 3, 3, 4, 25, mc); rect(px, 23, 3, 24, 25, mc); }
  else if (sp === "human" && a.hair !== "none" && a.hair !== "bald") {
    const h = a.hairColor;
    rect(px, 3, 5, 24, 8, h);
    rect(px, 3, 5, 4, a.hair === "long" || a.hair === "bob" ? 22 : 12, h);
    rect(px, 23, 5, 24, a.hair === "long" || a.hair === "bob" ? 22 : 12, h);
    if (a.hair === "curly") for (let x = 3; x < 25; x += 3) rect(px, x, 3, x + 1, 4, h);
    if (a.hair === "spiky") for (let x = 5; x < 24; x += 4) rect(px, x, 2, x + 1, 4, h);
    if (a.hair === "mohawk") rect(px, 12, 1, 15, 5, h);
    if (a.hair === "bun") rect(px, 11, 1, 16, 4, h);
    if (a.hair === "ponytail") rect(px, 24, 9, 26, 18, h);
  }
  // sakal
  if (sp === "human") {
    if (a.beard === "full") { rect(px, 4, 21, 23, 25, a.hairColor); rect(px, 4, 16, 5, 25, a.hairColor); rect(px, 22, 16, 23, 25, a.hairColor); rect(px, 11, 18, 16, 18, a.hairColor); }
    if (a.beard === "goatee") rect(px, 12, 22, 15, 25, a.hairColor);
    if (a.beard === "mustache") rect(px, 11, 18, 16, 18, a.hairColor);
    if (a.beard === "stubble") rect(px, 5, 20, 22, 25, a.hairColor, 0.3);
  }
  // gözlük
  if (a.glasses !== "none") {
    const rim = { round: "#D4A017", square: "#1F2937", sun: "#111827", star: "#EC4899" }[a.glasses];
    const lens = { round: "#BFE3FF", square: "#E5F3FF", sun: "#111827", star: "#FFD166" }[a.glasses];
    for (const x0 of [7, 15]) { rect(px, x0, 12, x0 + 5, 16, rim); rect(px, x0 + 1, 13, x0 + 4, 15, lens, a.glasses === "sun" ? 1 : 0.45); }
    rect(px, 13, 13, 14, 13, rim);
  }
  // şapka
  const hc = a.outfitColor;
  switch (a.hat) {
    case "cap": rect(px, 3, 2, 24, 6, hc); rect(px, 3, 6, 27, 7, shade(hc, -0.25)); break;
    case "beanie": rect(px, 3, 1, 24, 6, a.accent); rect(px, 3, 6, 24, 7, shade(a.accent, -0.25)); rect(px, 12, 0, 15, 1, "#FFFFFF"); break;
    case "tophat": rect(px, 7, 0, 20, 5, "#1F2937"); rect(px, 7, 4, 20, 5, a.accent); rect(px, 2, 6, 25, 7, "#1F2937"); break;
    case "straw": rect(px, 8, 1, 19, 5, "#E9C46A"); rect(px, 8, 4, 19, 5, "#E63946"); rect(px, 0, 6, 27, 7, "#E9C46A"); break;
    case "beret": rect(px, 4, 2, 25, 6, shade(hc, -0.2)); rect(px, 13, 0, 14, 1, shade(hc, -0.2)); break;
    case "crown": rect(px, 6, 4, 21, 7, "#F2C14E"); for (const x of [6, 10, 13, 17, 20]) rect(px, x, 1, x + 1, 3, "#F2C14E"); px(13, 5, "#E11D48"); break;
    case "party": for (let i = 0; i < 6; i++) rect(px, 8 + i, 6 - i, 19 - i, 6 - i, i % 2 ? a.accent : hc); rect(px, 13, 0, 14, 0, "#FFFFFF"); break;
    case "headphones": rect(px, 3, 4, 24, 5, "#1F2937"); rect(px, 1, 12, 4, 18, a.accent); rect(px, 23, 12, 26, 18, a.accent); break;
  }
}
