/**
 * COS-B — "Bahçe Laboratuvarı" (özgün; kıyafet + masa süsü + kutlama).
 * Bitki deneyleri yapan bir sera ekibi: yaprak desenli laboratuvar önlüğü ve toprak eldiveni; masada cam filiz kuvözü ve
 * fide tepsisi; tohum yağmuru kutlaması. Yazı, marka ya da kurum simgesi yok.
 */
import type { CosmeticSet, SceneBox } from "../registry";

const COAT = "#EEF3E8", COAT_D = "#D5DECB", SAGE = "#5E8C4E", GLOVE = "#C2884D", LEAF = "#4CAF50", LIME = "#A3E635", SOIL = "#5B4636";
const PETALS = ["#F9A8D4", "#FDE68A", "#C4B5FD", "#FDBA74"];

/** Tohum yağmuru: tohumlar düşer, yere değince filizlenip açar; statik hâl: açmış filiz halkası ve yerde tohumlar. */
function seedShower(t: number, calm: boolean): SceneBox[] {
  const out: SceneBox[] = [];
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, r = 14 + (i % 2) * 3;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const land = 0.35 + (i % 5) * 0.05;
    if (!calm && t < land) {
      const y = 40 * (1 - t / land) + 1;
      out.push({ p: [x, y, z], s: [1, 1.4, 1], c: "#A16207" });
      continue;
    }
    const g = calm ? 1 : Math.min(1, (t - land) * 3);
    const stem = 1 + g * 5;
    out.push({ p: [x, stem / 2, z], s: [0.8, stem, 0.8], c: LEAF });
    out.push({ p: [x + 1, stem * 0.5, z], s: [1.6, 0.6, 1], c: LEAF });
    const ps = 0.6 + g * 1.4;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push({ p: [x + dx * ps, stem + 0.6, z + dz * ps], s: [ps, ps * 0.6, ps], c: PETALS[i % PETALS.length] });
    out.push({ p: [x, stem + 0.9, z], s: [1, 1, 1], c: "#FACC15", glow: true });
    out.push({ p: [x * 0.8, 0.4, z * 0.8], s: [1, 0.8, 1.4], c: "#A16207" });
  }
  return out;
}

export const GARDEN_LAB: CosmeticSet = {
  id: "garden-lab", bucket: "small", ip_risk: 0, culture_risk: 0, signature: "garden-lab-sprout-box", free_after_months: 12,
  tint: "#3F7A4A",
  items: [
    {
      id: "garden-lab-lab-coat", slot: "outfit", surfaces: ["avatar", "me", "collection"],
      wear: (_a, box) => {
        // uzun önlük: gövde kabuğu + etek, yeşil yaka, yaprak deseni (soyut), göğüs cebi ve filiz; toprak eldiveni
        box("body", [0, 9.9, 0], [8.7, 8.4, 5.7], COAT, { lod: 0 });
        box("body", [0, 5.2, 0], [8.9, 3.4, 5.9], COAT, { lod: 0 });
        for (const x of [-1.6, 1.6]) box("body", [x, 12.4, 2.9], [1.4, 3.6, 0.3], SAGE, { r: [0, 0, x < 0 ? 0.35 : -0.35] });
        box("body", [0, 8.6, 2.92], [0.4, 7.6, 0.2], COAT_D);
        for (const [x, y] of [[-3, 10.4], [-2.2, 7.8], [-3.2, 5.2], [2.6, 8.6], [3.2, 5.8], [2.2, 4.4]] as const) {
          box("body", [x, y, 2.95], [1.2, 0.6, 0.2], LEAF);
          box("body", [x + 0.5, y + 0.5, 2.95], [0.6, 0.6, 0.2], LIME);
        }
        box("body", [2.6, 11.2, 2.98], [2.2, 1.8, 0.3], COAT_D);
        box("body", [2.6, 12.6, 2.98], [0.4, 1.4, 0.3], LEAF);
        box("body", [3.1, 13.2, 2.98], [1, 0.4, 0.3], LIME);
        for (const bone of ["armL", "armR"] as const) {
          box(bone, [0, -2.75, 0], [3, 5.6, 3], COAT, { lod: 0 });
          box(bone, [0, -1.6, 1.52], [1, 0.6, 0.2], LEAF);
          box(bone, [0, -6.2, 0], [2.8, 2.3, 2.8], GLOVE, { lod: 0 });
          box(bone, [0, -4.9, 0], [3.1, 0.6, 3.1], "#9A6A3A");
        }
      },
    },
    {
      id: "garden-lab-sprout-box", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        const b: SceneBox[] = [];
        // cam filiz kuvözü: taban, toprak, filizler, cam kabuk, kapak ve sıcak büyüme lambası
        b.push({ p: [-5, 0.4, 0], s: [9, 0.8, 7], c: "#334155" });
        b.push({ p: [-5, 1.6, 0], s: [8.4, 1.6, 6.4], c: SOIL });
        b.push({ p: [-7, 4, -1], s: [0.6, 4, 0.6], c: LEAF });
        for (const [dx, dy] of [[-1.2, 4.4], [1.2, 5.2], [-1.2, 6]]) b.push({ p: [-7 + dx, dy, -1], s: [2, 0.5, 1.2], c: LEAF });
        b.push({ p: [-3, 3, 1], s: [2.4, 1.8, 2.4], c: "#86EFAC" });
        b.push({ p: [-3, 4.2, 1], s: [1, 0.8, 1], c: "#F9A8D4" });
        b.push({ p: [-5, 5, 0], s: [9, 7, 7], c: "#D1FAE5", glass: true });
        b.push({ p: [-5, 8.8, 0], s: [9.4, 0.6, 7.4], c: "#94A3B8" });
        b.push({ p: [-5, 8.3, 0], s: [5, 0.3, 1], c: "#FDE68A", glow: true });
        // fide tepsisi (2×3 göz, filizler) + büyüteç
        b.push({ p: [6, 0.8, 1], s: [8, 1.6, 5.4], c: "#1F2937" });
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
          b.push({ p: [3.6 + i * 2.4, 1.7, -0.2 + j * 2.4], s: [2, 0.4, 2], c: SOIL });
          b.push({ p: [3.6 + i * 2.4, 2.6 + ((i + j) % 2) * 0.6, -0.2 + j * 2.4], s: [0.4, 1.6, 0.4], c: LEAF });
          b.push({ p: [3.9 + i * 2.4, 3.4 + ((i + j) % 2) * 0.6, -0.2 + j * 2.4], s: [1, 0.3, 0.6], c: LIME });
        }
        b.push({ p: [10.5, 0.3, -3.5], s: [3, 0.4, 3], c: "#BAE6FD", glass: true });
        b.push({ p: [12.4, 0.3, -2], s: [3, 0.6, 0.8], c: "#7C5A3C", r: [0, -0.5, 0] });
        return b;
      },
    },
    { id: "garden-lab-seed-shower", slot: "celebration", surfaces: ["celebration", "collection"], durationMs: 2600, frame: seedShower },
  ],
};
