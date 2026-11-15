/**
 * HERO-PACKS — "Element Bekçileri" / Element Wardens (özgün element kahramanları; büyük set: 6 kostüm, 2 masa yoldaşı,
 * 1 kutlama). Kırağı ve koru bekçileri dört klasik elementin yanına doğal mevsim elementleri olarak eklendi.
 *
 * Dört element fikri antik ve kamu malıdır; tasarım özgündür: insan figürü zırhlı tulum giyer (alevden ya da sudan beden
 * yok), ulus/kabile simgesi, dövme, Uzak Doğu kıyafeti ya da bilinen bir dizinin element amblemleri yok. Her bekçinin omuz
 * tepesi ve göğüs glifi kendi elementini soyut biçimle anlatır.
 */
import type { BoxFn } from "../../parts";
import { glyph, ring, suit } from "../kit";
import type { CosmeticSet, SceneBox } from "../registry";

interface Warden { body: string; dark: string; accent: string; glow: string; crest: "spike" | "wave" | "slab" | "fin" | "crystal" | "leaf"; mark: string[] }

const EMBER: Warden = { body: "#3B3030", dark: "#241D1D", accent: "#EA7A2E", glow: "#FDBA74", crest: "spike",
  mark: ["..X..", ".XXX.", ".X.X.", "XX.XX", ".XXX."] };
const TIDE: Warden = { body: "#0E5E6F", dark: "#0A4552", accent: "#7DD3C7", glow: "#CCFBF1", crest: "wave",
  mark: [".....", "XX..X", "X.XX.", ".....", "XXXXX"] };
const STONE: Warden = { body: "#55624A", dark: "#3E4836", accent: "#94A3B8", glow: "#E2E8F0", crest: "slab",
  mark: ["XX.XX", "X...X", ".....", "X...X", "XX.XX"] };
const BREEZE: Warden = { body: "#BFD7EA", dark: "#8FB3CF", accent: "#E2E8F0", glow: "#FFFFFF", crest: "fin",
  mark: ["XXX..", "...X.", ".XX..", "X....", ".XXXX"] };

const FROST: Warden = { body: "#DCEFF7", dark: "#7FA9C2", accent: "#BAE6FD", glow: "#F0F9FF", crest: "crystal",
  mark: ["..X..", "X.X.X", ".XXX.", "X.X.X", "..X.."] };
const GROVE: Warden = { body: "#3F5E2B", dark: "#5B4636", accent: "#84CC16", glow: "#D9F99D", crest: "leaf",
  mark: ["...XX", "..XX.", ".XX..", "XX.X.", "X..X."] };
const ORBS = [EMBER.accent, TIDE.accent, STONE.accent, BREEZE.body, FROST.accent, GROVE.accent];

/** Element sarmalı: altı element küresi yükselen bir sarmalda döner; statik hâl: yerde altı küre halkası ve ortada ışık. */
function elementSpiral(t: number, calm: boolean): SceneBox[] {
  const out: SceneBox[] = ring(6, calm ? 10 : 6 + t * 8, calm ? 0 : t * 7).map(([x, z], i) => ({
    p: [x, calm ? 2 : 2 + t * 18 + i * 1.2, z], s: [2.4, 2.4, 2.4], c: ORBS[i], glow: true,
  }));
  out.push({ p: [0, 1, 0], s: [3, 2, 3], c: "#FEF3C7", glow: true });
  return out;
}

/** Bekçi tulumu: taban + omuz tepesi + bilekte element halkası + göğüs glifi + yüz açık başlık bandı. */
function warden(w: Warden, box: BoxFn) {
  suit(box, { body: w.body, sleeve: w.body, glove: w.dark, leg: w.dark, boot: w.dark, trim: w.accent });
  glyph(box, w.mark, w.glow, true);
  for (const bone of ["armL", "armR"] as const) box(bone, [0, -4.8, 0], [3.2, 0.7, 3.2], w.accent, { glow: true });
  for (const x of [-4.6, 4.6]) {
    if (w.crest === "spike") for (const k of [0, 1, 2]) box("body", [x, 14.4 + k * 0.9, -1 + k], [1.6 - k * 0.4, 1.4, 1.2], k ? w.glow : w.accent, k ? { glow: true } : {});
    if (w.crest === "wave") for (const k of [0, 1, 2]) box("body", [x, 14.2 + (k % 2) * 0.8, -1.6 + k * 1.6], [2.2, 0.9, 1.4], k === 1 ? w.glow : w.accent);
    if (w.crest === "slab") box("body", [x, 14.2, 0], [3, 2, 6.4], w.accent, { r: [0, 0, x < 0 ? 0.2 : -0.2] });
    if (w.crest === "fin") box("body", [x, 14.6, -1.2], [0.6, 2.6, 4], w.glow, { r: [0.4, 0, 0] });
    if (w.crest === "crystal") for (const k of [-1, 0, 1]) box("body", [x + k * 0.6, 15 + (k ? 0 : 0.8), k], [0.8, 2.4 - Math.abs(k) * 0.6, 0.8], w.glow, { glow: true, r: [0, 0.785, 0] });
    if (w.crest === "leaf") for (const k of [0, 1]) box("body", [x, 14.6 + k * 0.6, -0.6 + k * 1.6], [2.4, 0.5, 1.6], k ? w.glow : w.accent, { r: [0.3, 0, x < 0 ? 0.4 : -0.4] });
  }
  box("head", [0, 9.6, 0], [10.6, 1.2, 10.6], w.dark, { lod: 0 });
  box("head", [0, 10.3, 5.2], [3, 1.4, 0.4], w.accent, { glow: true });
}

export const ELEMENT_WARDENS: CosmeticSet = {
  id: "element-wardens", bucket: "large", ip_risk: 1, culture_risk: 0, signature: "element-wardens-ember", free_after_months: 12,
  tint: "#7C4A2E", group: "costume",
  items: [
    { id: "element-wardens-ember", slot: "outfit", surfaces: ["avatar", "me", "collection"], wear: (_a, box) => warden(EMBER, box) },
    { id: "element-wardens-tide", slot: "outfit", surfaces: ["avatar", "me", "collection"], wear: (_a, box) => warden(TIDE, box) },
    { id: "element-wardens-stone", slot: "outfit", surfaces: ["avatar", "me", "collection"], wear: (_a, box) => warden(STONE, box) },
    { id: "element-wardens-breeze", slot: "outfit", surfaces: ["avatar", "me", "collection"], wear: (_a, box) => warden(BREEZE, box) },
    { id: "element-wardens-frost", slot: "outfit", surfaces: ["avatar", "me", "collection"], wear: (_a, box) => warden(FROST, box) },
    { id: "element-wardens-grove", slot: "outfit", surfaces: ["avatar", "me", "collection"], wear: (_a, box) => warden(GROVE, box) },
    {
      id: "element-wardens-element-orbs", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // element küreleri: taş kaide üstünde altı küçük ışıklı küre ve ortada sütun (simge ya da yazı yok)
        const b: SceneBox[] = [{ p: [0, 0.5, 0], s: [12, 1, 6], c: "#57534E" }];
        b.push({ p: [0, 3, 0], s: [1.6, 4, 1.6], c: "#A8A29E" });
        ORBS.forEach((c, i) => {
          const x = -5 + i * 2;
          b.push({ p: [x, 1.6, 1.6], s: [1, 1.2, 1], c: "#78716C" });
          b.push({ p: [x, 2.9, 1.6], s: [1.6, 1.6, 1.6], c, glow: true });
        });
        b.push({ p: [0, 5.6, 0], s: [2.2, 2.2, 2.2], c: "#FEF3C7", glow: true });
        return b;
      },
    },
    {
      id: "element-wardens-ember-salamander", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // kor semenderi (eski doğa felsefesinin ateş yaratığı): kömür taşı üstünde turuncu benekli küçük kertenkele
        const BODY = "#C2410C", SPOT = "#FDBA74";
        const b: SceneBox[] = [{ p: [0, 0.8, 0], s: [10, 1.6, 5], c: EMBER.dark }];
        for (const x of [-3, 1, 3.6]) b.push({ p: [x, 1.7, 1.6], s: [1, 0.3, 1], c: EMBER.accent, glow: true });
        b.push({ p: [0, 2.6, 0], s: [5, 1.4, 2], c: BODY });
        b.push({ p: [3.4, 2.8, 0], s: [2, 1.4, 1.8], c: BODY });
        for (const z of [-0.6, 0.6]) b.push({ p: [4.2, 3.3, z], s: [0.4, 0.4, 0.2], c: "#1F2937" });
        b.push({ p: [-3.4, 2.4, 0], s: [2.4, 0.8, 0.8], c: BODY, r: [0, 0.3, 0] });
        b.push({ p: [-5, 2.2, -0.6], s: [1.4, 0.6, 0.6], c: BODY, r: [0, 0.7, 0] });
        for (const [x, z] of [[-1.6, 1.2], [-1.6, -1.2], [1.6, 1.2], [1.6, -1.2]] as const) b.push({ p: [x, 2.1, z], s: [0.8, 0.6, 0.8], c: BODY });
        for (const x of [-1.2, 0.4, 2]) b.push({ p: [x, 3.35, 0], s: [0.6, 0.2, 0.6], c: SPOT, glow: true });
        return b;
      },
    },
    { id: "element-wardens-element-spiral", slot: "celebration", surfaces: ["celebration", "collection"], durationMs: 2600, frame: elementSpiral },
  ],
};
