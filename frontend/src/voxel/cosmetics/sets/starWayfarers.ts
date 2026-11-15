/**
 * HERO-PACKS — "Yıldız Gezginleri" / Star Wayfarers (genel uzay arketipleri; özgün).
 *
 * Kaçınılanlar: uzay ajansı amblemleri ve bayraklar, turuncu pilot tulumu + beyaz yelek (bilinen bir film serisinin pilotu),
 * üç gözlü yeşil oyuncak uzaylı, tek gözlü yeşil canavar, beyaz zırhlı asker. Üyelik sandığındaki "Astronot görünüşü"
 * (chest:skin-astronaut) ile karışmasın diye tulum değil jet çantalı halka pilotu ve takımyıldız haritacısı.
 * Lacivert + sarı (kulüp rengi) kullanılmadı.
 */
import { suit } from "../kit";
import type { CosmeticSet, SceneBox } from "../registry";

const MINT = "#6EE7B7", CHAR = "#2F3640", CHAR_L = "#4A5562", VISOR = "#A5F3FC";
const INDIGO = "#3730A3", INDIGO_D = "#272278", LILAC = "#C4B5FD", STAR = "#EDE9FE";

export const STAR_WAYFARERS: CosmeticSet = {
  id: "star-wayfarers", bucket: "small", ip_risk: 1, culture_risk: 0, signature: "star-wayfarers-rover", free_after_months: 12,
  tint: "#272278", group: "costume",
  items: [
    {
      id: "star-wayfarers-ring-pilot", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true, eyes: true,
      wear: (_a, box) => {
        // halka pilotu: kömür tulum + nane paneller, sırtta jet çantası (iki lüle), saydam kabarcık kask
        suit(box, { body: CHAR, sleeve: CHAR, glove: MINT, leg: CHAR_L, boot: MINT, trim: MINT });
        box("body", [0, 11.6, 3.02], [5.6, 3, 0.3], CHAR_L);
        for (const x of [-1.6, 0, 1.6]) box("body", [x, 11.6, 3.2], [0.8, 0.8, 0.2], x ? MINT : "#FDE68A", { glow: true });
        box("body", [0, 10.6, -4], [6.4, 7, 2.4], CHAR_L, { lod: 0 });
        for (const x of [-1.8, 1.8]) {
          box("body", [x, 6.4, -4], [1.6, 1.6, 1.6], CHAR);
          box("body", [x, 5.4, -4], [1, 0.6, 1], "#7DD3FC", { glow: true });
        }
        box("head", [0, 5.2, 0], [12, 12, 12], VISOR, { o: 0.32, lod: 0 });
        box("head", [0, -0.6, 0], [12.2, 1, 12.2], CHAR_L);
        box("head", [5.8, 8, 0], [0.6, 4, 0.6], CHAR_L);
        box("head", [5.8, 10.2, 0], [0.9, 0.9, 0.9], MINT, { glow: true });
      },
    },
    {
      id: "star-wayfarers-star-cartographer", slot: "outfit", surfaces: ["avatar", "me", "collection"],
      wear: (_a, box) => {
        // takımyıldız haritacısı: çivit uzun ceket üzerinde parlayan yıldız noktaları, eflatun şerit, bel çantasında rulo harita
        suit(box, { body: INDIGO, sleeve: INDIGO, glove: INDIGO_D, leg: INDIGO_D, boot: "#1E1B4B", trim: LILAC }, true);
        for (const [x, y] of [[-3, 12.6], [-1.6, 11.4], [0.4, 12], [2.6, 10.6], [-2.4, 8.6], [1.2, 7.8], [3, 5.2], [-1, 5.4]] as const)
          box("body", [x, y, 3.08], [0.6, 0.6, 0.2], STAR, { glow: true });
        for (const [x, y, r] of [[-2.3, 12, 0.7], [-0.6, 11.7, -0.3], [1.5, 11.3, 0.55]] as const)
          box("body", [x, y, 3.04], [1.8, 0.2, 0.15], LILAC, { r: [0, 0, r] });
        box("body", [3.6, 7, 0], [1.6, 4.4, 1.6], "#F5E6C8", { r: [0, 0, 0.3] });
        box("body", [0, 14.3, 0], [9.4, 1, 6.4], LILAC);
        for (const bone of ["armL", "armR"] as const) box(bone, [0, -5.2, 0], [3.2, 0.6, 3.2], LILAC);
      },
    },
    {
      id: "star-wayfarers-rover", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // altı tekerlekli mini keşif aracı: güneş paneli, kamera direği, ışıklı göz
        const b: SceneBox[] = [];
        for (const x of [-4, 0, 4]) for (const z of [-2.6, 2.6]) b.push({ p: [x, 1.2, z], s: [2.2, 2.4, 1.2], c: "#1F2937" });
        b.push({ p: [0, 3.2, 0], s: [11, 2, 4.4], c: "#CBD5E1" });
        b.push({ p: [0, 4.4, 0], s: [9, 0.4, 6], c: "#1E3A8A" });
        for (const x of [-3, 0, 3]) b.push({ p: [x, 4.7, 0], s: [0.2, 0.2, 5.8], c: "#93C5FD" });
        b.push({ p: [4, 6.6, 0], s: [0.6, 4, 0.6], c: "#94A3B8" });
        b.push({ p: [4, 9, 0], s: [2.4, 1.6, 1.6], c: "#E2E8F0" });
        b.push({ p: [4, 9, 0.85], s: [1, 1, 0.2], c: MINT, glow: true });
        b.push({ p: [-4.4, 6, -1.6], s: [0.3, 3, 0.3], c: "#94A3B8" });
        return b;
      },
    },
    {
      id: "star-wayfarers-four-eyed-friend", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // dört gözlü dost: mercan rengi yumuşak jöle yaratık, yan yana dört küçük göz, iki kısa duyarga
        const BODY = "#FB7185", BODY_D = "#E11D48";
        const b: SceneBox[] = [{ p: [0, 0.4, 0], s: [8, 0.8, 5], c: "#334155" }];
        b.push({ p: [0, 3.4, 0], s: [6.4, 5.2, 4.4], c: BODY });
        b.push({ p: [0, 6.6, 0], s: [5.2, 1.6, 3.6], c: BODY });
        for (const x of [-2.1, -0.7, 0.7, 2.1]) {
          b.push({ p: [x, 5, 2.25], s: [1, 1.2, 0.2], c: "#FFFFFF" });
          b.push({ p: [x, 4.9, 2.4], s: [0.5, 0.6, 0.2], c: "#1F2937" });
        }
        b.push({ p: [0, 2.6, 2.25], s: [2.4, 0.4, 0.2], c: BODY_D });
        for (const x of [-1.6, 1.6]) {
          b.push({ p: [x, 8.6, 0], s: [0.4, 2.4, 0.4], c: BODY_D });
          b.push({ p: [x, 10, 0], s: [1, 1, 1], c: "#FDE68A", glow: true });
        }
        for (const x of [-3.6, 3.6]) b.push({ p: [x, 3, 0], s: [1.2, 2.4, 1.2], c: BODY_D });
        return b;
      },
    },
  ],
};
