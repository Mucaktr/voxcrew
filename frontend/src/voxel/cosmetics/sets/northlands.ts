/**
 * HERO-PACKS — "Kuzey Diyarı" / Northlands (kamu malı İskandinav sagaları ve halk anlatıları; tanrı yok).
 *
 * Sagalardaki insan arketipleri (kalkan bekçisi, ozan) ve yaratıklar (buz kurdu, kuzgun çifti). Kaçınılanlar: kanatlı
 * miğfer + kırmızı pelerin + çekiç (bilinen çizgi roman/film tasarımı), boynuzlu miğfer klişesi, gerçek rün yazısı ve
 * dinî semboller (düğüm sembolleri, çekiç kolyesi vb.). Kalkan boyası düz geometrik dilimdir.
 */
import type { CosmeticSet, SceneBox } from "../registry";

const WOOL = "#3F6B4A", WOOL_D = "#2F513A", OAT = "#D8CBA8", IRON = "#6B7280", IRON_D = "#4B5563", FUR = "#E7E2D6", RUST = "#9A4A24";
const SKALD = "#3E5368", SKALD_D = "#2C3D4F";

export const NORTHLANDS: CosmeticSet = {
  id: "northlands", bucket: "small", ip_risk: 1, culture_risk: 1, signature: "northlands-frost-wolf", free_after_months: 12,
  tint: "#2F513A", group: "costume",
  items: [
    {
      id: "northlands-shieldbearer", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true,
      wear: (_a, box) => {
        // yün tunik + deri kemer + sarmalı baldır bağı, yuvarlak demir başlık (boynuz/kanat yok), sırtta dilimli kalkan
        box("body", [0, 9.6, 0], [8.9, 9.2, 5.9], WOOL, { lod: 0 });
        box("body", [0, 5.4, 0], [9.2, 2.6, 6.2], WOOL_D, { lod: 0 });
        box("body", [0, 7.2, 0], [9.2, 0.9, 6.2], "#5B3A29");
        box("body", [0, 7.2, 3.15], [1.4, 1.2, 0.2], IRON);
        box("body", [0, 14.2, 0], [9.4, 1.2, 6.4], OAT);
        // kalkan (z arkada): dört dilim, ortada demir topuz
        box("body", [0, 9.8, -3.6], [8.4, 8.4, 0.6], OAT, { lod: 0 });
        box("body", [-2.1, 11.9, -3.95], [4.2, 4.2, 0.2], RUST);
        box("body", [2.1, 7.7, -3.95], [4.2, 4.2, 0.2], RUST);
        box("body", [0, 9.8, -4.1], [1.8, 1.8, 0.4], IRON);
        for (const bone of ["armL", "armR"] as const) {
          box(bone, [0, -2.75, 0], [3, 5.6, 3], WOOL, { lod: 0 });
          box(bone, [0, -5.6, 0], [3.2, 1.2, 3.2], "#5B3A29");
        }
        for (const bone of ["legL", "legR"] as const) {
          box(bone, [0, -2.4, 0], [3.3, 4.6, 3.3], OAT, { lod: 0 });
          for (const y of [-1.4, -2.6, -3.8]) box(bone, [0, y, 0], [3.4, 0.4, 3.4], "#8B6B4A", { r: [0, 0, 0.2] });
          box(bone, [0, -5.2, 0.2], [3.6, 1.6, 3.8], "#5B3A29", { lod: 0 });
        }
        box("head", [0, 10.2, 0], [10.6, 2.2, 10.6], IRON, { lod: 0 });
        box("head", [0, 11.6, 0], [7, 1, 7], IRON_D);
        box("head", [0, 7.6, 5.25], [1, 3.4, 0.4], IRON);                    // burunluk
      },
    },
    {
      id: "northlands-skald", slot: "outfit", surfaces: ["avatar", "me", "collection"],
      wear: (_a, box) => {
        // ozan: arduvaz tunik, kürk omuz pelerini, pas rengi atkı, bel çantası, dize kadar çizme
        box("body", [0, 9.9, 0], [8.9, 8.6, 5.9], SKALD, { lod: 0 });
        box("body", [0, 5.2, 0], [9.2, 3, 6.2], SKALD_D, { lod: 0 });
        box("body", [0, 13.6, -0.2], [10.4, 2.4, 7], FUR, { lod: 0 });
        box("body", [0, 10, -3.3], [9.6, 9, 0.6], FUR, { r: [0.06, 0, 0] });
        box("body", [-2.6, 12.4, 3.05], [1.4, 4.4, 0.3], RUST);
        box("body", [3, 6.6, 3.2], [2.2, 1.8, 0.6], "#7C5B3B");
        for (const bone of ["armL", "armR"] as const) {
          box(bone, [0, -2.75, 0], [3, 5.6, 3], SKALD, { lod: 0 });
          box(bone, [0, -5.4, 0], [3.2, 0.7, 3.2], FUR);
        }
        for (const bone of ["legL", "legR"] as const) {
          box(bone, [0, -2.4, 0], [3.3, 4.6, 3.3], "#57534E", { lod: 0 });
          box(bone, [0, -4.4, 0.2], [3.7, 3.4, 3.9], "#3F2A1D", { lod: 0 });
          box(bone, [0, -2.7, 0.2], [3.8, 0.7, 4], FUR);
        }
      },
    },
    {
      id: "northlands-frost-wolf", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // buz kurdu yavrusu: oturan, buz mavisi gözler, kaide kar tabakası
        const W = "#E5E7EB", W_D = "#CBD5E1";
        const b: SceneBox[] = [{ p: [0, 0.5, 0], s: [10, 1, 6], c: "#F8FAFC" }];
        b.push({ p: [0, 3, -0.6], s: [4.6, 4, 4.2], c: W });
        b.push({ p: [0, 5.8, 1], s: [3.6, 3.6, 2.6], c: W });
        b.push({ p: [0, 7.8, 0.8], s: [3.4, 2.8, 3], c: W });
        b.push({ p: [0, 7.2, 2.8], s: [1.6, 1.4, 1.4], c: W_D });
        b.push({ p: [0, 7.6, 3.55], s: [0.6, 0.5, 0.2], c: "#1F2937" });
        for (const x of [-0.9, 0.9]) b.push({ p: [x, 8.4, 2.35], s: [0.5, 0.5, 0.2], c: "#7DD3FC", glow: true });
        for (const x of [-1.1, 1.1]) b.push({ p: [x, 9.8, 0.6], s: [0.9, 1.6, 0.6], c: W_D });
        for (const x of [-1, 1]) b.push({ p: [x, 1.6, 2], s: [1, 2, 1], c: W });
        b.push({ p: [3, 2, -1.6], s: [3.6, 1.2, 1.2], c: W_D, r: [0, 0.4, 0.3] });
        return b;
      },
    },
    {
      id: "northlands-raven-pair", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // iki kuzgun dallı tünekte (simge ya da yazı yok)
        const R = "#1F2433", R_L = "#2F3747";
        const b: SceneBox[] = [{ p: [0, 0.5, 0], s: [10, 1, 5], c: "#5B4636" }];
        for (const x of [-4, 4]) b.push({ p: [x, 3.4, 0], s: [0.8, 5, 0.8], c: "#7C5B3B" });
        b.push({ p: [0, 6, 0], s: [10, 0.8, 0.8], c: "#7C5B3B" });
        for (const [x, dir] of [[-2.4, 1], [2.4, -1]] as const) {
          b.push({ p: [x, 8, 0], s: [2.6, 2.6, 3.2], c: R });
          b.push({ p: [x + dir * 0.6, 10, 0.8], s: [2, 2, 2], c: R });
          b.push({ p: [x + dir * 0.6, 9.8, 2.2], s: [0.7, 0.6, 1.2], c: "#4B5563" });
          b.push({ p: [x + dir * 0.6 + 0.6, 10.4, 1.85], s: [0.3, 0.3, 0.2], c: "#E5E7EB" });
          b.push({ p: [x, 7.6, -2.2], s: [1.8, 0.6, 1.6], c: R_L, r: [0.4, 0, 0] });
        }
        return b;
      },
    },
  ],
};
