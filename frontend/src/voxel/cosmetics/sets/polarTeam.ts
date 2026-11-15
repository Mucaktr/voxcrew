/**
 * COS-B — "Kutup Araştırma Ekibi" (özgün; kıyafet + masa + kutlama + dünya teması).
 * Kurgusal bir buz istasyonu ekibi: turuncu saha montu, örgü bere, kar gözlüğü; masada buz karotu rafı ve küçük rüzgâr
 * ölçer; kar tanesi patlaması ve buz kristali yelpazesi kutlaması; kutup ışıklı gece dünya teması. Bayrak, kurum arması, yazı ya da harita yok.
 */
import type { CosmeticSet, SceneBox } from "../registry";

const PARKA = "#E26D2C", PARKA_D = "#B8521C", FUR = "#F1F5F9", KNIT = "#2F5D7C", KNIT_D = "#22465E", BOOT = "#4B3B2F";

/** Kar patlaması: 28 voxel kar tanesi dışa açılıp süzülür; statik hâl: yere konmuş kar halkası + küçük buz kristali yelpazesi
 *  (kar küresi YOK: sezon `season:s1-snowglobe` ile karışmasın). */
function snowburst(t: number, calm: boolean): SceneBox[] {
  const out: SceneBox[] = [];
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, r0 = 6 + (i % 4) * 2;
    if (calm) {
      out.push({ p: [Math.cos(a) * (r0 + 6), 1 + (i % 3), Math.sin(a) * (r0 + 6)], s: [1.4, 1.4, 1.4], c: i % 3 ? "#E0F2FE" : "#FFFFFF", glow: true });
      continue;
    }
    const rise = Math.sin(Math.min(1, t * 1.6) * Math.PI / 2);
    const fall = Math.max(0, t - 0.55) / 0.45;
    const r = r0 + rise * (10 + (i % 5) * 2);
    const y = 18 + rise * (10 + (i % 3) * 3) - fall * fall * 26 + Math.sin(t * 9 + i) * 0.8;
    const s = 1.6 * (1 - Math.max(0, t - 0.8) / 0.2);
    out.push({ p: [Math.cos(a + t * 0.8) * r, Math.max(0.6, y), Math.sin(a + t * 0.8) * r], s: [s, s, s], c: i % 3 ? "#E0F2FE" : "#FFFFFF", glow: true });
  }
  // buz kristali yelpazesi (her iki hâlde; statik hâlin odağı): yerden açılan beş ince buz çubuğu + uçlarında kristal
  for (let k = 0; k < 5; k++) {
    const a = -0.9 + k * 0.45;
    out.push({ p: [12 + Math.sin(a) * 4, 4.5, 6], s: [0.8, 9, 0.8], c: "#BAE6FD", r: [0, 0, -a] });
    out.push({ p: [12 + Math.sin(a) * 8.6, 1 + Math.cos(a) * 8.6, 6], s: [1.6, 1.6, 1.6], c: "#E0F2FE", glow: true, r: [0, 0, 0.785] });
  }
  out.push({ p: [12, 0.6, 6], s: [5, 1.2, 3], c: "#94A3B8" });
  return out;
}

export const POLAR_TEAM: CosmeticSet = {
  id: "polar-team", bucket: "small", ip_risk: 0, culture_risk: 0, signature: "polar-team-core-rack", free_after_months: 12,
  tint: "#2F5D7C",
  items: [
    {
      id: "polar-team-parka", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true, eyes: true,
      wear: (_a, box) => {
        // saha montu: gövde kabuğu, fermuar şeridi, yansıtıcı bant, kürklü yaka, cepler
        box("body", [0, 9.9, 0], [8.9, 8.6, 5.9], PARKA, { lod: 0 });
        box("body", [0, 9.9, 2.98], [0.7, 8.2, 0.2], PARKA_D);
        box("body", [0, 8.1, 0], [9.1, 0.9, 6.1], "#E2E8F0");
        box("body", [0, 14.2, -0.2], [9.6, 1.8, 6.6], FUR);
        for (const x of [-2.4, 2.4]) box("body", [x, 7.8, 3.02], [2.4, 1.8, 0.3], PARKA_D);
        for (const bone of ["armL", "armR"] as const) {
          box(bone, [0, -2.8, 0], [3.1, 5.8, 3.1], PARKA, { lod: 0 });
          box(bone, [0, -0.9, 0], [3.25, 0.7, 3.25], "#E2E8F0");
          box(bone, [0, -5.9, 0], [3.3, 1, 3.3], FUR);
          box(bone, [0, -6.7, 0], [2.7, 1.6, 2.7], KNIT_D); // eldiven
        }
        for (const bone of ["legL", "legR"] as const) {
          box(bone, [0, -4.6, 0.2], [3.7, 3, 3.9], BOOT, { lod: 0 });
          box(bone, [0, -3.05, 0.2], [3.8, 0.7, 4], FUR);
        }
        // örgü bere + ponpon, kar gözlüğü (alında, yüzü kapatmaz)
        box("head", [0, 11.4, 0], [10.9, 3.4, 10.9], KNIT, { lod: 0 });
        box("head", [0, 10, 0], [11.3, 1.3, 11.3], KNIT_D);
        for (const x of [-3.3, 0, 3.3]) box("head", [x, 11.6, 5.5], [1, 2.6, 0.2], KNIT_D);
        box("head", [0, 13.9, 0], [2.6, 2.6, 2.6], FUR);
        box("head", [0, 10.1, 5.75], [9.6, 1.1, 0.4], "#1F2937");
        for (const x of [-2.3, 2.3]) box("head", [x, 10.1, 5.95], [3.2, 1.8, 0.5], "#F59E0B", { o: 0.82 });
      },
    },
    {
      id: "polar-team-core-rack", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        const b: SceneBox[] = [];
        // ahşap raf + 3 buz karotu (saydam mavi, katmanlı) + küçük rüzgâr ölçer (kepçeler)
        b.push({ p: [-3, 0.6, 0], s: [12, 1.2, 4], c: "#8B5A2B" });
        for (const x of [-7, 1]) b.push({ p: [x, 3, -1.4], s: [1, 4.8, 1], c: "#6B4423" });
        b.push({ p: [-3, 5.6, -1.4], s: [10, 0.8, 1.2], c: "#8B5A2B" });
        [-6.5, -3, 0.5].forEach((x, i) => {
          b.push({ p: [x, 4.2, 0.4], s: [2.2, 6, 2.2], c: "#BAE6FD", glass: true });
          b.push({ p: [x, 2.4 + i * 0.8, 0.4], s: [1.6, 0.6, 1.6], c: "#7DD3FC" });
          b.push({ p: [x, 4.8 + (i % 2), 0.4], s: [1.6, 0.4, 1.6], c: "#E0F2FE" });
        });
        b.push({ p: [7, 0.4, 0.5], s: [3, 0.8, 3], c: "#334155" });
        b.push({ p: [7, 4, 0.5], s: [0.5, 6.4, 0.5], c: "#94A3B8" });
        b.push({ p: [7, 7.4, 0.5], s: [5.6, 0.4, 0.4], c: "#94A3B8" });
        b.push({ p: [7, 7.4, 0.5], s: [0.4, 0.4, 5.6], c: "#94A3B8" });
        for (const [dx, dz] of [[2.8, 0], [-2.8, 0], [0, 2.8], [0, -2.8]]) b.push({ p: [7 + dx, 7.4, 0.5 + dz], s: [1.2, 1.2, 1.2], c: PARKA });
        return b;
      },
    },
    { id: "polar-team-snowburst", slot: "celebration", surfaces: ["celebration", "collection"], durationMs: 2600, frame: snowburst },
    {
      id: "polar-team-aurora", slot: "world", surfaces: ["world", "collection"],
      theme: {
        sky: "#14213D", hemiSky: "#C7E3FF", hemiGround: "#9FB7CC", sun: "#DCEBFF", sunIntensity: 1.1,
        floor: ["#EEF4F8", "#E2EBF2"], wall: "#2B3F5C", lamp: "#7DF0C8",
        boxes: () => {
          const b: SceneBox[] = [];
          // kutup ışığı şeritleri (doğal ışık; desen yok), buz blokları, kar yığınları
          for (let i = 0; i < 14; i++) {
            const x = -52 + i * 8, y = 44 + Math.sin(i * 0.9) * 5;
            b.push({ p: [x, y, -46], s: [8, 3, 0.6], c: i % 3 === 0 ? "#A7F3D0" : "#5EEAD4", glow: true });
            b.push({ p: [x, y + 4, -46.2], s: [8, 2, 0.6], c: "#C4B5FD", glow: true });
          }
          for (const [x, z, h] of [[-44, -20, 10], [-38, -28, 6], [42, -24, 12], [36, -30, 7], [46, 6, 5]] as const)
            b.push({ p: [x, h / 2, z], s: [7, h, 7], c: "#CFE8F7" });
          for (const [x, z] of [[-46, 14], [46, 16], [-48, 0]] as const) b.push({ p: [x, 1.5, z], s: [10, 3, 8], c: "#FFFFFF" });
          // istasyon direği ve sıcak pencere ışığı (yazısız)
          b.push({ p: [40, 14, -36], s: [1.2, 28, 1.2], c: "#94A3B8" });
          b.push({ p: [40, 28.6, -36], s: [2.4, 2.4, 2.4], c: "#7DF0C8", glow: true });
          return b;
        },
      },
    },
  ],
};
