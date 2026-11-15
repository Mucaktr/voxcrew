/**
 * Kapadokya yerel kostümleri. İki iş kıyafeti: balon pilotu ve çömlekçi.
 * Gerçek şirket üniforması, logo ya da yazı yok; ten, göz ve yüz değişmez.
*/
import type { LocalCostume } from "./index";

const ARMS = ["armL", "armR"] as const;

const SAND = "#C8A97E", SAND_D = "#A88B62", LEATHER = "#6B4423", STRAP = "#5A4632", METAL = "#9CA3AF";
const CLAY_APRON = "#8B5E3C", CLAY_D = "#6F4A2F", SMUDGE = "#B98A62", POT = "#B5653A", POT_D = "#8E4A28", BAND = "#A3876A";

export const KAPADOKYA: readonly LocalCostume[] = [
  {
    id: "local-kapadokya-balon", slot: "outfit", surfaces: ["avatar", "me"], city: "kapadokya", kind: "is", weight: 4,
    ip_risk: 0, culture_risk: 0,
    culture_note: "Balon pilotu: kum rengi saha ceketi, deri eldiven, göğüste telsiz kemeri. Şirket logosu ve gerçek üniforma yok.",
    wear: (_a, box) => {
      box("body", [0, 9.9, 0], [8.9, 8.5, 5.9], SAND, { lod: 0 });
      for (const b of ARMS) {
        box(b, [0, -2.8, 0], [3.1, 5.8, 3.1], SAND, { lod: 0 });
        box(b, [0, -6.6, 0], [2.8, 1.7, 2.8], LEATHER, { lod: 0 });
        box(b, [0, -5.6, 0], [3.2, 0.5, 3.2], SAND_D);
      }
      box("body", [0, 14.1, -0.2], [9.2, 1.4, 6.4], SAND_D);
      box("body", [0, 9.9, 3], [0.5, 8, 0.2], SAND_D);
      for (const x of [-2.3, 2.3]) box("body", [x, 11.6, 3.02], [2.2, 1.9, 0.25], SAND_D);
      // çapraz kayış ve küçük telsiz (yazısız)
      box("body", [0, 10.6, 3.12], [0.7, 9.6, 0.2], STRAP, { r: [0, 0, 0.62] });
      box("body", [2.6, 7.9, 3.25], [1.4, 2, 0.6], "#374151");
      box("body", [2.9, 9.2, 3.25], [0.25, 1, 0.25], METAL);
      box("body", [0, 6.4, 0], [9, 0.8, 6.1], STRAP);
    },
  },
  {
    id: "local-kapadokya-comlek", slot: "outfit", surfaces: ["avatar", "me"], city: "kapadokya", kind: "is", weight: 4,
    ip_risk: 0, culture_risk: 0,
    culture_note: "Çömlekçi: toprak rengi iş önlüğü, kil lekeleri, kumaş saç bandı ve elde küçük çanak. Yoksulluk estetiği yok; zanaat onurlu.",
    wear: (_a, box) => {
      box("body", [0, 9.2, 2.85], [7.2, 9, 0.3], CLAY_APRON, { lod: 0 });
      box("body", [0, 14.1, 0], [8.4, 0.6, 5.6], CLAY_D);
      box("body", [0, 10.4, 0], [8.6, 0.7, 5.7], CLAY_D);
      box("body", [0, 7.4, 3.05], [5, 2, 0.2], CLAY_D);
      for (const [x, y] of [[-2, 12.2], [1.6, 9.2], [-0.8, 6.2]] as const) box("body", [x, y, 3.05], [1.2, 0.8, 0.2], SMUDGE);
      for (const b of ARMS) box(b, [0, -2.9, 0], [2.8, 0.7, 2.8], SMUDGE);
      // saç bandı (alında değil, saç çizgisinde)
      box("head", [0, 10.2, 0], [10.7, 1, 10.7], BAND, { lod: 0 });
      // elde küçük kil çanak
      box("armR", [0, -8.2, 1.3], [2.4, 2, 2.4], POT, { lod: 0 });
      box("armR", [0, -7.1, 1.3], [2.8, 0.5, 2.8], POT_D);
    },
  },
];
