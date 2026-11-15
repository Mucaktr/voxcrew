/**
 * HERO-PACKS — "Yaratık Atölyesi" / Creature Workshop (genel yaratıklar: dinozor tulumu, ejder yavrusu, özgün dev).
 *
 * Kaçınılanlar: siyah gövde + iri yeşil gözlü ejder (animasyon filmi), mor ejder (oyun maskotu), koyu gri sırt plakalı ve
 * mavi nefesli dev kertenkele (tescilli film canavarı), dev goril. Dev canavar özgündür: kabuklu, kristal dikenli, dört
 * gözlü bir mercan devi; şehir yıkmaz, masada oturur.
 */
import { ring } from "../kit";
import type { CosmeticSet, SceneBox } from "../registry";

const DINO = "#65A30D", DINO_D = "#4D7C0F", BELLY = "#ECFCCB", SPIKE = "#F59E0B";
const SAGE = "#7FA37A", SAGE_D = "#5E8159", GOLD = "#E8C26B";

/** Yumurta çatlaması: benekli yumurta sallanır, çatlar, kabuk parçaları dışa açılır ve yavru başını çıkarır; statik hâl:
 *  açılmış yumurta + kabuk halkası + yavru başı (zamandan bağımsız). */
function eggHatch(t: number, calm: boolean): SceneBox[] {
  const out: SceneBox[] = [];
  const open = calm ? 1 : Math.min(1, Math.max(0, (t - 0.35) / 0.4));
  const wobble = calm ? 0 : Math.sin(t * 40) * 0.12 * (1 - open);
  out.push({ p: [0, 4, 0], s: [8, 8, 8], c: "#F5F5F4", r: [0, 0, wobble] });
  for (const [x, y, z] of [[-2, 6, 4.1], [2.4, 3, 4.1], [0, 1.6, -4.1], [4.1, 5, 0]] as const) out.push({ p: [x, y, z], s: [1.4, 1.4, 0.2], c: "#A3E635" });
  ring(8, 3 + open * 9, 0.3).forEach(([x, z], i) => {
    const lift = calm ? 0.6 : 8 + Math.sin(open * Math.PI) * 6 - open * 7.4;
    out.push({ p: [x, Math.max(0.6, lift), z], s: [2.6, 1, 2.6], c: i % 2 ? "#F5F5F4" : "#E7E5E4", r: [0.4, i, 0] });
  });
  if (open > 0.2) {
    const up = 7 + open * 3;
    out.push({ p: [0, up, 0.6], s: [4.2, 3.6, 4.2], c: SAGE });
    for (const x of [-1, 1]) out.push({ p: [x, up + 0.6, 2.75], s: [0.8, 0.8, 0.2], c: "#1F2937" });
    out.push({ p: [0, up + 2.4, 0.6], s: [1, 1.2, 1], c: GOLD });
  }
  return out;
}

export const CREATURE_WORKSHOP: CosmeticSet = {
  id: "creature-workshop", bucket: "small", ip_risk: 1, culture_risk: 0, signature: "creature-workshop-dragon-hatchling", free_after_months: 12,
  tint: "#4D7C0F", group: "costume",
  items: [
    {
      id: "creature-workshop-dino-suit", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true,
      wear: (_a, box) => {
        // dinozor tulumu: yeşil tulum, açık karın, sırtta turuncu dikenler ve kuyruk, dişli kapüşon (yüz açık), pençe eldiven
        box("body", [0, 9.9, 0], [8.9, 8.6, 5.9], DINO, { lod: 0 });
        box("body", [0, 9.6, 3.0], [5.6, 7.4, 0.3], BELLY);
        for (let k = 0; k < 4; k++) box("body", [0, 13 - k * 2.2, -3.4], [1, 1.8, 1.6], SPIKE, { r: [0.785, 0, 0] });
        box("body", [0, 5.6, -4.6], [3.4, 2.6, 4], DINO, { lod: 0 });
        box("body", [0, 4.4, -7.4], [2.2, 1.8, 3], DINO_D);
        for (const bone of ["armL", "armR"] as const) {
          box(bone, [0, -2.75, 0], [3, 5.6, 3], DINO, { lod: 0 });
          box(bone, [0, -6.2, 0], [3, 2, 3], DINO_D, { lod: 0 });
          for (const x of [-0.8, 0.8]) box(bone, [x, -7.4, 1.2], [0.5, 0.8, 0.6], "#FEF9C3");
        }
        for (const bone of ["legL", "legR"] as const) {
          box(bone, [0, -2.6, 0], [3.3, 5, 3.3], DINO, { lod: 0 });
          box(bone, [0, -5.3, 0.8], [3.8, 1.4, 4.6], DINO_D, { lod: 0 });
        }
        box("head", [0, 11, -0.6], [11, 3, 11.4], DINO, { lod: 0 });
        box("head", [0, 10.2, 5.4], [10, 1.2, 1.4], DINO_D);
        for (const x of [-3.6, -1.2, 1.2, 3.6]) box("head", [x, 9.2, 5.9], [0.9, 0.9, 0.4], "#FFFFFF", { r: [0, 0, 0.785] });
        for (const x of [-2.4, 2.4]) box("head", [x, 12.8, 3.2], [1.6, 1.2, 1.4], "#FFFFFF");
        for (const x of [-2.4, 2.4]) box("head", [x, 12.8, 3.95], [0.7, 0.7, 0.2], "#1F2937");
        for (let k = 0; k < 3; k++) box("head", [0, 12.8 - k * 0.4, -1 - k * 2.4], [1, 1.6, 1.4], SPIKE, { r: [0.785, 0, 0] });
      },
    },
    {
      id: "creature-workshop-dragon-hatchling", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // ejder yavrusu: adaçayı yeşili pullu gövde, altın karın, küçük kanatlar, yumurta kabuğu üstünde oturuyor
        const b: SceneBox[] = [{ p: [0, 0.6, 0], s: [7, 1.2, 5], c: "#F5F5F4" }];
        for (const x of [-3, 3]) b.push({ p: [x, 1.8, 0], s: [1, 1.6, 4], c: "#E7E5E4" });
        b.push({ p: [0, 3.6, 0], s: [4.6, 4, 3.6], c: SAGE });
        b.push({ p: [0, 3.6, 1.85], s: [2.6, 3, 0.2], c: GOLD });
        b.push({ p: [0, 7, 0.6], s: [3.8, 3, 3.4], c: SAGE });
        b.push({ p: [0, 6.4, 2.6], s: [2.2, 1.4, 1.2], c: SAGE_D });
        for (const x of [-0.9, 0.9]) b.push({ p: [x, 7.6, 2.35], s: [0.7, 0.7, 0.2], c: "#FDE68A", glow: true });
        for (const x of [-1.2, 1.2]) b.push({ p: [x, 9, -0.2], s: [0.6, 1.4, 0.6], c: GOLD, r: [-0.4, 0, x * 0.2] });
        for (const s of [-1, 1]) b.push({ p: [s * 3.6, 5.6, -0.8], s: [3, 2.4, 0.4], c: SAGE_D, r: [0, s * 0.4, s * 0.5] });
        b.push({ p: [3.2, 1.8, -2], s: [3.6, 1, 1], c: SAGE, r: [0, 0.5, 0] });
        return b;
      },
    },
    {
      id: "creature-workshop-coral-giant", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // mercan devi: yuvarlak kabuk, sırtta kristal dikenler, sapı üstünde dört göz, iki kısa kıskaç (özgün dev canavar)
        const SHELL = "#0F766E", SHELL_L = "#14B8A6", CRYSTAL = "#F0ABFC";
        const b: SceneBox[] = [{ p: [0, 0.5, 0], s: [12, 1, 7], c: "#A8A29E" }];
        for (const x of [-3.6, -1.2, 1.2, 3.6]) b.push({ p: [x, 1.8, 2], s: [1, 1.8, 1], c: SHELL });
        b.push({ p: [0, 4.6, 0], s: [9, 4.4, 6], c: SHELL });
        b.push({ p: [0, 7, 0], s: [7, 1.2, 5], c: SHELL_L });
        for (const [x, z, h] of [[-2.4, -1, 3], [0, -1.4, 4], [2.4, -1, 3], [-1.2, 0.8, 2.4], [1.2, 0.8, 2.4]] as const)
          b.push({ p: [x, 7.6 + h / 2, z], s: [1, h, 1], c: CRYSTAL, glow: true, r: [0, 0.785, 0] });
        for (const x of [-2.4, -0.8, 0.8, 2.4]) {
          b.push({ p: [x, 8.2, 2.6], s: [0.4, 1.6, 0.4], c: SHELL_L });
          b.push({ p: [x, 9.2, 2.6], s: [1, 1, 1], c: "#FFFFFF" });
          b.push({ p: [x, 9.2, 3.15], s: [0.5, 0.5, 0.2], c: "#1F2937" });
        }
        for (const s of [-1, 1]) {
          b.push({ p: [s * 5.6, 4, 1.4], s: [2.4, 2, 2], c: SHELL_L });
          b.push({ p: [s * 6.4, 5.2, 2.4], s: [1.2, 1.6, 1.2], c: SHELL_L, r: [0, 0, s * 0.3] });
        }
        return b;
      },
    },
    { id: "creature-workshop-egg-hatch", slot: "celebration", surfaces: ["celebration", "collection"], durationMs: 2800, frame: eggHatch },
  ],
};
