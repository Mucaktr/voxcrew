/**
 * Londra yerel kostümleri. Yağmurlu gün (gündelik) ve pazar tezgâhçısı (iş).
 * Bilerek kaçınılan: ayı postu başlıklı muhafız, kule bekçisi, polis kaskı (gerçek üniforma), bayrak ve kulüp renkleri.
*/
import type { LocalCostume } from "./index";

const ARMS = ["armL", "armR"] as const;

const RAIN = "#1F4D3A", RAIN_D = "#173A2C", TOGGLE = "#C8B48A", UMB = "#2B3442", UMB_D = "#1C222C", HOOK = "#6B4F3A";
const TWEED = "#6B5A48", TWEED_D = "#54463A", SHIRT = "#E5E3DC", CAP = "#4B4F57", CAP_D = "#393C42", CANVAS = "#B8AE9C";

export const LONDRA: readonly LocalCostume[] = [
  {
    id: "local-londra-yagmur", slot: "outfit", surfaces: ["avatar", "me"], city: "londra", kind: "gunluk", weight: 4,
    ip_risk: 0, culture_risk: 0,
    culture_note: "Yağmurlu gün: koyu yeşil yağmurluk, sırtta katlı kapüşon, elde kapalı şemsiye. Gerçek üniforma, bayrak ve yazı yok.",
    wear: (_a, box) => {
      box("body", [0, 9.9, 0], [9, 8.6, 6], RAIN, { lod: 0 });
      box("body", [0, 5.4, 0], [9.4, 2.8, 6.3], RAIN, { lod: 0 });
      for (const b of ARMS) {
        box(b, [0, -2.8, 0], [3.1, 5.8, 3.1], RAIN, { lod: 0 });
        box(b, [0, -5.3, 0], [3.25, 0.6, 3.25], RAIN_D);
      }
      box("body", [0, 13.8, -3.3], [6.4, 2.4, 1.4], RAIN_D, { lod: 0 });
      box("body", [0, 14.2, 0], [8.8, 1, 6.2], RAIN_D);
      for (const y of [12, 9.8, 7.6]) box("body", [0.4, y, 3.08], [1.5, 0.5, 0.25], TOGGLE);
      for (const x of [-2.4, 2.4]) box("body", [x, 7.4, 3.06], [2.2, 0.6, 0.2], RAIN_D);
      // elde kapalı şemsiye (baston gibi; açık kubbe yok → başla çakışmaz, hareketsiz)
      box("armR", [0, -7.2, 1.6], [0.5, 0.5, 1.6], HOOK);
      box("armR", [0, -9.4, 2.2], [1.2, 4.2, 1.2], UMB, { lod: 0 });
      box("armR", [0, -9.4, 2.2], [1.35, 0.4, 1.35], UMB_D);
      box("armR", [0, -12.1, 2.2], [0.35, 1.4, 0.35], HOOK);
    },
  },
  {
    id: "local-londra-pazar", slot: "outfit", surfaces: ["avatar", "me"], city: "londra", kind: "is", weight: 4,
    ip_risk: 0, culture_risk: 0, head: true,
    culture_note: "Pazar tezgâhçısı: düz kasket, tüvit yelek, açık gömlek kolları, kanvas önlük. Yazı, logo ve gerçek üniforma yok.",
    wear: (_a, box) => {
      box("body", [0, 10, 0], [8.5, 8.3, 5.5], SHIRT, { lod: 0 });
      for (const b of ARMS) box(b, [0, -2.6, 0], [2.9, 5.4, 2.9], SHIRT, { lod: 0 });
      box("body", [0, 9.7, 0], [9, 7.6, 6], TWEED, { lod: 0 });
      box("body", [0, 10.4, 3.02], [1.8, 7, 0.2], SHIRT);
      for (const y of [8.4, 10.2, 12]) box("body", [1.2, y, 3.08], [0.5, 0.5, 0.2], TWEED_D);
      box("body", [0, 7, 3.05], [7.2, 4.6, 0.3], CANVAS, { lod: 0 });
      box("body", [0, 9.2, 0], [9.2, 0.5, 6.2], CANVAS);
      box("body", [-1.8, 6.5, 3.25], [2.4, 1.6, 0.2], TWEED_D);
      // düz kasket: tepe + kısa siper
      box("head", [0, 10.9, -0.3], [10.9, 2, 10.9], CAP, { lod: 0 });
      box("head", [0, 10.2, 6.1], [9.6, 0.6, 2.6], CAP_D);
    },
  },
];
