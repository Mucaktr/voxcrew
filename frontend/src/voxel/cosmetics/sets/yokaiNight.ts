/**
 * HERO-PACKS — "Yōkai Gecesi" / Yōkai Night (kamu malı Japon halk anlatıları; yalnız yaratıklar).
 *
 * Edo dönemi resimli yaratık kataloglarındaki halk varlıkları: kappa, kâğıt fener ruhu (chōchin-obake), şemsiye ruhu
 * (kasa-obake). Kimono, tapınak kapısı, dinî simge, tilki maskesi (tapınak çağrışımı) ve gerçek yazı yok. Bu varlıkları
 * kullanan dizi/oyun/anime tasarımları (cep canavarı, saat, çizgi film yorumları) kullanılmadı: biçim ve renk özgün.
 */
import type { CosmeticSet, SceneBox } from "../registry";

const KAPPA = "#4D8B57", KAPPA_D = "#3A6B42", SHELL = "#6B5B3E", BEAK = "#E0B341", DISH = "#BAE6FD";
const PAPER = "#F6E7C8", PAPER_D = "#E3CC9E", LACQUER = "#2B2D42", TONGUE = "#E26D5A";

export const YOKAI_NIGHT: CosmeticSet = {
  id: "yokai-night", bucket: "small", ip_risk: 1, culture_risk: 1, signature: "yokai-night-lantern-spirit", free_after_months: 12,
  tint: "#2B2D42", group: "costume",
  items: [
    {
      id: "yokai-night-kappa", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true,
      wear: (_a, box) => {
        // kappa tulumu: yeşil tulum, sırtta kabuk, başlıkta su çanağı ve gaga siperi (yüz açık), perdeli eldiven
        box("body", [0, 9.9, 0], [8.9, 8.6, 5.9], KAPPA, { lod: 0 });
        box("body", [0, 10, 3.0], [5.4, 6.4, 0.3], "#A3C585");               // açık karın
        box("body", [0, 9.8, -3.4], [8, 8.6, 1.6], SHELL, { lod: 0 });
        for (const [x, y] of [[-2, 11.6], [2, 11.6], [0, 9.6], [-2, 7.6], [2, 7.6]] as const) box("body", [x, y, -4.3], [2.4, 1.6, 0.3], "#8B7448");
        for (const bone of ["armL", "armR"] as const) {
          box(bone, [0, -2.75, 0], [3, 5.6, 3], KAPPA, { lod: 0 });
          box(bone, [0, -6.2, 0], [3.2, 2.2, 3.2], KAPPA_D, { lod: 0 });
        }
        for (const bone of ["legL", "legR"] as const) {
          box(bone, [0, -2.6, 0], [3.3, 5, 3.3], KAPPA, { lod: 0 });
          box(bone, [0, -5.3, 0.8], [3.8, 1.2, 4.6], KAPPA_D, { lod: 0 });
        }
        box("head", [0, 10.2, 0], [10.8, 2, 10.8], KAPPA, { lod: 0 });
        box("head", [0, 11.4, 0], [6, 0.6, 6], "#E7E5E4");
        box("head", [0, 11.6, 0], [4.8, 0.4, 4.8], DISH, { o: 0.82 });
        box("head", [0, 9.4, 5.8], [5, 1, 1.6], BEAK);
        for (const x of [-5.3, 5.3]) box("head", [x, 7.2, -0.6], [0.6, 4.4, 9], KAPPA);
      },
    },
    {
      id: "yokai-night-lantern-spirit", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // kâğıt fener ruhu: kaburgalı fener gövdesi (yazısız), tek iri göz, dışarı uzanan dil; içten sıcak ışık
        const b: SceneBox[] = [{ p: [0, 0.4, 0], s: [6, 0.8, 5], c: LACQUER }];
        b.push({ p: [0, 1.2, 0], s: [4.4, 0.8, 4.4], c: LACQUER });
        b.push({ p: [0, 5.6, 0], s: [5.6, 7.6, 5.6], c: PAPER });
        for (const y of [3, 4.6, 6.2, 7.8]) b.push({ p: [0, y, 0], s: [5.8, 0.3, 5.8], c: PAPER_D });
        b.push({ p: [0, 5.6, 0], s: [4, 6.6, 4], c: "#FCD34D", glow: true });
        b.push({ p: [0, 9.8, 0], s: [4.4, 0.8, 4.4], c: LACQUER });
        b.push({ p: [0, 10.8, 0], s: [0.6, 1.4, 0.6], c: LACQUER });
        b.push({ p: [-0.6, 6.8, 2.95], s: [2.4, 1.8, 0.2], c: "#FFFFFF" });
        b.push({ p: [-0.4, 6.7, 3.1], s: [1, 1, 0.2], c: "#1F2937" });
        b.push({ p: [0.4, 3.6, 3.4], s: [1.4, 0.4, 1.6], c: TONGUE, r: [0.5, 0, 0] });
        return b;
      },
    },
    {
      id: "yokai-night-umbrella-spirit", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // şemsiye ruhu: kapalı kâğıt şemsiye gövdesi, tek göz, tek ayak üstünde sekiyor
        const CANOPY = "#7C3AED", CANOPY_D = "#5B21B6";
        const b: SceneBox[] = [{ p: [0, 0.4, 0], s: [5, 0.8, 4], c: "#44403C" }];
        b.push({ p: [0, 1.6, 0.6], s: [1.6, 0.8, 2.4], c: "#A16207" });      // takunya
        b.push({ p: [0, 3.2, 0], s: [0.8, 2.6, 0.8], c: "#FCE3CF" });        // ayak
        for (let k = 0; k < 5; k++) {
          const w = 2 + k * 0.9;
          b.push({ p: [0, 12 - k * 1.6, 0], s: [w, 1.6, w], c: k % 2 ? CANOPY : CANOPY_D });
        }
        b.push({ p: [0, 13.4, 0], s: [0.5, 1.4, 0.5], c: "#A16207" });
        b.push({ p: [0, 8.6, 2.0], s: [2, 1.6, 0.2], c: "#FFFFFF" });
        b.push({ p: [0, 8.6, 2.15], s: [0.9, 0.9, 0.2], c: "#1F2937" });
        b.push({ p: [0, 6.4, 3.0], s: [1, 0.4, 1.2], c: TONGUE, r: [0.6, 0, 0] });
        return b;
      },
    },
  ],
};
