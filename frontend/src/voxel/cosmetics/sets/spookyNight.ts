/**
 * HERO-PACKS — "Cadılar Gecesi" / Spooky Night (mevsimlik; yetişkinlerin en çok seçtiği genel kostümler: cadı, korsan).
 *
 * Genel kostüm arketipleri kimsenin değildir; kaçınılanlar: yeşil tenli cadı + siyah elbise (müzikal), kırmızı bandana +
 * örgülü saç + boncuk (film korsanı), kırmızı ceket + kanca el (masal uyarlaması), kafatası + çapraz kemik bayrağı.
 * Kabak feneri ve hayaletler geneldir. Kıtlık yok: mevsimlik olsa da set süresizdir, geri sayım ya da "son gün" yok.
 */
import { ring } from "../kit";
import type { CosmeticSet, SceneBox } from "../registry";

const PLUM = "#5B2A6E", PLUM_D = "#3F1D4D", AMBER = "#F59E0B", MOSS = "#3F6212";
const TEAL = "#115E59", TEAL_D = "#0B403C", BRASS = "#C08A2E", OCHRE = "#B7791F", SHIRT = "#F5F0E6";

/** Hayalet dansı: beş küçük hayalet dairede döner ve yükselir; statik hâl: yerde duran üç hayalet ve kabak ışığı. */
function ghostDance(t: number, calm: boolean): SceneBox[] {
  const out: SceneBox[] = [];
  const ghosts = calm ? ring(3, 9, 0.5) : ring(5, 10 + Math.sin(t * Math.PI) * 4, t * 4);
  ghosts.forEach(([x, z], i) => {
    const y = calm ? 3 : 3 + Math.sin(t * Math.PI) * 14 + Math.sin(t * 12 + i) * 1.2;
    out.push({ p: [x, y + 2, z], s: [3.4, 4, 3.4], c: "#F8FAFC", glow: true });
    out.push({ p: [x, y + 4.6, z], s: [2.6, 1.4, 2.6], c: "#F8FAFC", glow: true });
    for (const dx of [-1, 0, 1]) out.push({ p: [x + dx * 1.1, y - 0.4, z], s: [1, 1, 3.2], c: "#E2E8F0" });
    for (const dx of [-0.7, 0.7]) out.push({ p: [x + dx, y + 3, z + 1.75], s: [0.6, 0.8, 0.2], c: "#1F2937" });
  });
  out.push({ p: [0, 1.6, 0], s: [3.2, 3.2, 3.2], c: AMBER, glow: true });
  return out;
}

export const SPOOKY_NIGHT: CosmeticSet = {
  id: "spooky-night", bucket: "small", ip_risk: 0, culture_risk: 0, signature: "spooky-night-pumpkin-lantern", free_after_months: 12,
  tint: "#5B2A6E", group: "costume", seasonal: "halloween",
  items: [
    {
      id: "spooky-night-night-witch", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true,
      wear: (_a, box) => {
        // gece cadısı: mürdüm elbise + kehribar kuşak, omuzda kısa pelerin, ay evresi tokası, sivri şapka (yosun bant)
        box("body", [0, 9.9, 0], [8.9, 8.6, 5.9], PLUM, { lod: 0 });
        box("body", [0, 5.4, 0], [10.4, 4.2, 6.8], PLUM, { lod: 0 });
        box("body", [0, 7.6, 0], [9.2, 0.8, 6.2], AMBER);
        box("body", [0, 7.6, 3.15], [1.4, 1.4, 0.2], "#FDE68A", { glow: true });
        box("body", [0.5, 7.6, 3.25], [0.8, 1.2, 0.2], PLUM);                 // hilal biçimi
        box("body", [0, 11, -3.3], [9.4, 8, 0.5], PLUM_D, { r: [0.08, 0, 0] });
        for (const bone of ["armL", "armR"] as const) {
          box(bone, [0, -2.75, 0], [3, 5.6, 3], PLUM, { lod: 0 });
          box(bone, [0, -5.6, 0], [3.8, 1.6, 3.8], PLUM_D);
        }
        for (const bone of ["legL", "legR"] as const) {
          box(bone, [0, -2.4, 0], [3.2, 4.6, 3.2], "#1F2937", { lod: 0 });
          box(bone, [0, -5.3, 0.6], [3.4, 1.4, 4.4], "#3F2A1D", { lod: 0 });
        }
        box("head", [0, 10.4, 0], [15, 0.8, 15], PLUM_D, { lod: 0 });
        box("head", [0, 12.4, 0], [8, 3.4, 8], PLUM_D, { lod: 0 });
        box("head", [0, 11.2, 0], [8.2, 0.8, 8.2], MOSS);
        box("head", [0, 15, -0.4], [5, 2.4, 5], PLUM_D, { r: [-0.15, 0, 0] });
        box("head", [0, 17, -1.2], [2.6, 2.2, 2.6], PLUM_D, { r: [-0.35, 0, 0] });
      },
    },
    {
      id: "spooky-night-storm-pirate", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true,
      wear: (_a, box) => {
        // fırtına korsanı: deniz yeşili uzun ceket + pirinç düğmeler, aşı boyası kuşak, krem gömlek yakası, üç köşeli şapka
        box("body", [0, 9.9, 0], [8.9, 8.6, 5.9], TEAL, { lod: 0 });
        box("body", [0, 5.0, 0], [9.2, 3.6, 6.2], TEAL, { lod: 0 });
        box("body", [0, 11.6, 3.0], [2.6, 4.6, 0.2], SHIRT);
        box("body", [0, 7.6, 0], [9.2, 1.2, 6.2], OCHRE);
        box("body", [2.6, 6.4, 3.15], [1.2, 2.4, 0.3], OCHRE);
        for (const y of [12.6, 10.8, 9]) for (const x of [-2.2, 2.2]) box("body", [x, y, 3.1], [0.6, 0.6, 0.2], BRASS);
        for (const bone of ["armL", "armR"] as const) {
          box(bone, [0, -2.75, 0], [3, 5.6, 3], TEAL, { lod: 0 });
          box(bone, [0, -5.2, 0], [3.4, 1.4, 3.4], TEAL_D);
          box(bone, [0, -6.2, 0], [2.8, 0.8, 2.8], SHIRT);
        }
        for (const bone of ["legL", "legR"] as const) {
          box(bone, [0, -2.4, 0], [3.3, 4.6, 3.3], "#44403C", { lod: 0 });
          box(bone, [0, -4.4, 0.2], [3.8, 3.4, 4], "#1C1917", { lod: 0 });
          box(bone, [0, -2.8, 0.2], [4, 0.6, 4.2], BRASS);
        }
        box("head", [0, 10.8, 0], [10.6, 2, 10.6], TEAL_D, { lod: 0 });
        box("head", [0, 10.4, 4.6], [12, 2, 1], TEAL_D, { r: [-0.3, 0, 0] });
        for (const s of [-1, 1]) box("head", [s * 4.8, 10.4, -2], [1, 2, 9], TEAL_D, { r: [0, s * 0.5, 0] });
        box("head", [0, 11.6, 5.1], [12, 0.4, 0.4], BRASS);
      },
    },
    {
      id: "spooky-night-pumpkin-lantern", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // kabak feneri: oyulmuş üçgen gözler ve dişli ağız içten parlar, sap ve tek yaprak
        const P = "#EA580C", P_D = "#C2410C", LIGHT = "#FDE68A";
        const b: SceneBox[] = [];
        b.push({ p: [0, 3.4, 0], s: [8, 6.8, 7], c: P });
        for (const x of [-2.6, 0, 2.6]) b.push({ p: [x, 3.4, 0], s: [0.3, 6.6, 7.2], c: P_D });
        for (const x of [-1.8, 1.8]) b.push({ p: [x, 4.8, 3.55], s: [1.6, 1.4, 0.2], c: LIGHT, glow: true, r: [0, 0, 0.785] });
        b.push({ p: [0, 3.6, 3.55], s: [0.8, 0.8, 0.2], c: LIGHT, glow: true, r: [0, 0, 0.785] });
        b.push({ p: [0, 2, 3.55], s: [4.6, 0.9, 0.2], c: LIGHT, glow: true });
        for (const x of [-1.2, 1.2]) b.push({ p: [x, 2.6, 3.6], s: [0.8, 0.6, 0.2], c: P });
        b.push({ p: [0, 7.4, 0], s: [1, 1.6, 1], c: "#4D7C0F" });
        b.push({ p: [1.2, 7.2, 0.6], s: [2, 0.4, 1.4], c: "#65A30D", r: [0, 0.4, 0.3] });
        return b;
      },
    },
    { id: "spooky-night-ghost-dance", slot: "celebration", surfaces: ["celebration", "collection"], durationMs: 2800, frame: ghostDance },
  ],
};
