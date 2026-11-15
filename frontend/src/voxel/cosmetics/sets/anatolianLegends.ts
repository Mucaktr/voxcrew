/**
 * HERO-PACKS — "Anadolu Efsaneleri" / Anatolian Legends (kamu malı halk anlatıları; yalnız yaratık ve özgün gezgin).
 *
 * Kaynak: halk anlatıları ve Dede Korkut Kitabı (Tepegöz boyu), Kaf Dağı ve Zümrüdüanka anlatıları. Hiçbir dizi, film ya
 * da çizgi romanın tasarımı kullanılmadı. Kural: kültürel ya da yöresel kıyafet
 * SATILMAZ — bu yüzden kostüm yöresel giysi değil, özgün bir fantastik gezgin pelerinidir; halk kahramanları (Keloğlan,
 * Nasreddin Hoca, Dede Korkut beyleri) kostüm olarak yapılmadı. Yazı, dinî simge ya da bayrak yok.
*/
import { ring } from "../kit";
import type { CosmeticSet, SceneBox } from "../registry";

const EMERALD = "#047857", EMERALD_D = "#065F46", GOLD = "#D9A441", RUST = "#B45309", SAND = "#E9D8B4";
const FEATHER = ["#10B981", "#D9A441", "#0EA5E9", "#F59E0B"];

/** Tüy yağmuru: zümrüt ve altın tüyler süzülür; statik hâl: yere konmuş tüy halkası ve ortada küçük tüy demeti. */
function featherRain(t: number, calm: boolean): SceneBox[] {
  const out: SceneBox[] = [];
  ring(18, 14).forEach(([x, z], i) => {
    const c = FEATHER[i % FEATHER.length];
    if (calm) {
      out.push({ p: [x, 0.5, z], s: [1, 0.6, 3], c, r: [0, (i / 18) * Math.PI * 2, 0] });
      return;
    }
    const drop = 36 - t * 34 - (i % 4) * 2;
    const sway = Math.sin(t * 8 + i) * 2.4;
    out.push({ p: [x + sway, Math.max(0.6, drop), z], s: [1, 0.5, 3], c, r: [0.4 * Math.sin(t * 6 + i), (i / 18) * Math.PI * 2, 0.3] });
    out.push({ p: [x + sway, Math.max(0.9, drop + 1.6), z], s: [0.4, 0.4, 1.4], c: "#FEF3C7", glow: true });
  });
  for (const [dx, h, c] of [[-1.2, 6, FEATHER[0]], [0, 7.5, FEATHER[1]], [1.2, 6, FEATHER[2]]] as const)
    out.push({ p: [dx, h / 2, 0], s: [0.8, h, 0.8], c, r: [0, 0, dx * 0.2] });
  return out;
}

export const ANATOLIAN_LEGENDS: CosmeticSet = {
  id: "anatolian-legends", bucket: "small", ip_risk: 0, culture_risk: 1, signature: "anatolian-legends-simurgh", free_after_months: 12,
  tint: "#065F46", group: "costume",
  items: [
    {
      id: "anatolian-legends-kaf-wanderer", slot: "outfit", surfaces: ["avatar", "me", "collection"],
      wear: (_a, box) => {
        // özgün gezgin: uzun yolculuk pelerini (tüy deseni), kum rengi iç giysi, pas rengi kuşak, çizme
        box("body", [0, 9.9, 0], [8.9, 8.6, 5.9], SAND, { lod: 0 });
        box("body", [0, 6.6, 0], [9.1, 1, 6.1], RUST);
        box("body", [0, 8.6, -3.2], [9.4, 12, 0.6], EMERALD, { r: [0.08, 0, 0], lod: 0 });
        for (const [x, y] of [[-2.6, 11], [0, 9.4], [2.6, 11], [-2.6, 7], [2.6, 7], [0, 5]] as const)
          box("body", [x, y, -3.6], [1.6, 2.4, 0.3], GOLD, { r: [0.08, 0, x * 0.15] });
        box("body", [0, 14.2, -0.6], [9.8, 1.6, 6.8], EMERALD_D);          // yaka
        box("body", [0, 14.2, 3.2], [1.4, 1.4, 0.4], GOLD, { glow: true });  // tüy biçimli toka
        for (const bone of ["armL", "armR"] as const) {
          box(bone, [0, -2.75, 0], [3, 5.6, 3], EMERALD, { lod: 0 });
          box(bone, [0, -5.4, 0], [3.2, 0.7, 3.2], GOLD);
        }
        for (const bone of ["legL", "legR"] as const) {
          box(bone, [0, -2.4, 0], [3.3, 4.6, 3.3], "#6B5B45", { lod: 0 });
          box(bone, [0, -4.6, 0.2], [3.7, 3, 3.9], RUST, { lod: 0 });
        }
      },
    },
    {
      id: "anatolian-legends-simurgh", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // Zümrüdüanka: kaide üstünde kanatlarını açmış dev kuş figürü (zümrüt, altın, gök mavisi tüyler)
        const b: SceneBox[] = [{ p: [0, 0.5, 0], s: [9, 1, 5], c: "#5B4636" }];
        b.push({ p: [0, 4, 0], s: [3.4, 5, 3], c: EMERALD });
        b.push({ p: [0, 7.6, 0.8], s: [2.4, 2.4, 2.4], c: EMERALD_D });
        b.push({ p: [0, 7.4, 2.4], s: [0.8, 0.8, 1.4], c: GOLD });
        for (const x of [-0.6, 0.6]) b.push({ p: [x, 8.2, 2.05], s: [0.4, 0.4, 0.2], c: "#FEF3C7", glow: true });
        for (const k of [0, 1, 2]) b.push({ p: [0, 9.2 + k * 0.9, 0.2 - k * 0.6], s: [0.5, 1.2, 0.5], c: FEATHER[k] });
        for (const side of [-1, 1]) {
          for (let k = 0; k < 4; k++) b.push({ p: [side * (3 + k * 1.6), 5.6 + k * 0.9, -0.4], s: [1.8, 3.6 - k * 0.5, 0.8], c: FEATHER[(k + (side > 0 ? 1 : 0)) % 4], r: [0, 0, side * 0.35] });
        }
        for (let k = 0; k < 3; k++) b.push({ p: [(k - 1) * 1.2, 2.6, -2.2], s: [1, 1, 3], c: FEATHER[k], r: [0.5, 0, 0] });
        return b;
      },
    },
    {
      id: "anatolian-legends-tepegoz", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // Tepegöz: alnında tek göz olan, bağdaş kurmuş iri dev figürü (Dede Korkut boyu); silah yok, sakin duruş
        const SKIN = "#C9A27E", HIDE = "#7C5B3B";
        const b: SceneBox[] = [{ p: [0, 0.5, 0], s: [10, 1, 6], c: "#78716C" }];
        b.push({ p: [0, 2.4, 0.4], s: [8, 2.8, 5], c: HIDE });            // bağdaş
        b.push({ p: [0, 6.2, 0], s: [6.4, 5.2, 4.4], c: HIDE });          // gövde (post giysi)
        for (const x of [-4.2, 4.2]) b.push({ p: [x, 5.6, 0.6], s: [2, 4.6, 2], c: SKIN });
        b.push({ p: [0, 10.6, 0], s: [5, 4.4, 4.4], c: SKIN });           // kafa
        b.push({ p: [0, 11.6, 2.25], s: [2.2, 2, 0.2], c: "#FFFFFF" });  // tek göz
        b.push({ p: [0, 11.6, 2.4], s: [1, 1, 0.2], c: "#1F2937" });
        b.push({ p: [0, 9.4, 2.25], s: [2.4, 0.4, 0.2], c: "#5B3A29" });
        b.push({ p: [0, 13.1, 0], s: [5.2, 0.8, 4.6], c: "#3F2A1D" });   // saç
        return b;
      },
    },
    { id: "anatolian-legends-feather-rain", slot: "celebration", surfaces: ["celebration", "collection"], durationMs: 2600, frame: featherRain },
  ],
};
