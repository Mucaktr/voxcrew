/**
 * HERO-PACKS — "Olimpos Masalları" / Olympian Myths (kamu malı Yunan mitolojisi; kaynak: antik anlatılar).
 *
 * Tanrılar kostüm olarak yapılmadı (dinî figür); bunun yerine mitlerin insan ve yaratık arketipleri: tunç zırhlı muhafız,
 * defne taçlı ozan, kanatlı tay ve Girit'i koruyan tunç dev anlatısından özgün bir otomat. Film/oyun tasarımı yok:
 * kırmızı pelerin + lambda kalkan, kırmızı dövmeli soluk ten, belirli bir animasyon filminin kahraman tuniği kullanılmadı.
 * Mavi-beyaz bayrak çağrışımından kaçınmak için palet tunç, zeytin ve krem.
 */
import type { CosmeticSet, SceneBox } from "../registry";

const BRONZE = "#B07A3A", BRONZE_D = "#8A5A26", OLIVE = "#6B7F3A", CREAM = "#F4ECD8", LAUREL = "#4D7C0F";

export const OLYMPUS_MYTHS: CosmeticSet = {
  id: "olympus-myths", bucket: "small", ip_risk: 1, culture_risk: 1, signature: "olympus-myths-winged-foal", free_after_months: 12,
  tint: "#8A5A26", group: "costume",
  items: [
    {
      id: "olympus-myths-bronze-guard", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true,
      wear: (_a, box) => {
        // tunç göğüslük + krem tunik eteği + zeytin pelerin (kısa), tolgalı miğfer (yüz açık), tunç baldırlık
        box("body", [0, 10.6, 0], [9, 7.4, 6], BRONZE, { lod: 0 });
        for (const y of [12.4, 10.6]) box("body", [0, y, 3.05], [6, 0.4, 0.2], BRONZE_D);
        box("body", [0, 6.2, 0], [9.2, 2.4, 6.2], CREAM, { lod: 0 });
        for (const x of [-3, -1, 1, 3]) box("body", [x, 5.8, 3.15], [1.4, 1.6, 0.2], BRONZE_D);
        box("body", [0, 10.2, -3.2], [8.4, 8, 0.5], OLIVE, { r: [0.08, 0, 0] });
        for (const bone of ["armL", "armR"] as const) {
          box(bone, [0, -1.2, 0], [3.1, 2.4, 3.1], CREAM, { lod: 0 });
          box(bone, [0, -5.2, 0], [2.8, 2, 2.8], BRONZE);
        }
        for (const bone of ["legL", "legR"] as const) {
          box(bone, [0, -3.6, 0.3], [3.4, 3.6, 3.6], BRONZE, { lod: 0 });
          box(bone, [0, -5.4, 0.2], [3.4, 1.2, 3.6], "#5B3A29");
        }
        box("head", [0, 10.4, 0], [10.8, 2, 10.8], BRONZE, { lod: 0 });
        for (const x of [-5.3, 5.3]) box("head", [x, 7, 0.2], [0.6, 5.2, 9.6], BRONZE);
        box("head", [0, 12.6, -0.4], [1.6, 2.8, 9.4], OLIVE);              // tolga (zeytin; kırmızı değil)
        box("head", [0, 13.6, -0.4], [1, 1, 8.6], CREAM);
      },
    },
    {
      id: "olympus-myths-laurel-bard", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true,
      wear: (_a, box) => {
        // krem dökümlü giysi + zeytin kuşak + çapraz atkı, defne tacı, göğüste küçük lir (yazı yok)
        box("body", [0, 9.9, 0], [8.9, 8.6, 5.9], CREAM, { lod: 0 });
        box("body", [0, 5.0, 0], [9.4, 3.6, 6.3], CREAM, { lod: 0 });
        box("body", [0, 10.4, 3.05], [1.4, 9, 0.2], OLIVE, { r: [0, 0, 0.5] });
        box("body", [0, 6.8, 0], [9.2, 0.8, 6.2], OLIVE);
        box("body", [-2.6, 9.6, 3.2], [2.4, 0.4, 0.3], BRONZE);            // lir
        for (const x of [-3.6, -1.6]) box("body", [x, 11, 3.2], [0.4, 2.8, 0.3], BRONZE);
        for (const x of [-3, -2.6, -2.2]) box("body", [x, 11, 3.25], [0.15, 2.4, 0.15], "#FDE68A");
        for (const bone of ["armL", "armR"] as const) box(bone, [0, -1.4, 0], [3.1, 2.8, 3.1], CREAM, { lod: 0 });
        for (const bone of ["legL", "legR"] as const) box(bone, [0, -5.3, 0.3], [3.4, 1.2, 3.6], "#7C5B3B");
        // defne tacı: başın çevresinde yaprak dizisi
        box("head", [0, 9.6, 0], [10.6, 0.6, 10.6], LAUREL);
        for (const [x, z] of [[-4.6, 3], [-2.3, 5.1], [2.3, 5.1], [4.6, 3], [-5.1, -0.5], [5.1, -0.5], [-3.6, -4.2], [3.6, -4.2]] as const)
          box("head", [x, 10.2, z], [1.6, 0.8, 1], LAUREL, { r: [0, Math.atan2(x, z), 0.4] });
      },
    },
    {
      id: "olympus-myths-winged-foal", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // kanatlı tay figürü: beyaz-krem beden, açık kanatlar, defne kaide
        const b: SceneBox[] = [{ p: [0, 0.5, 0], s: [11, 1, 6], c: OLIVE }];
        b.push({ p: [0, 4.6, 0], s: [7, 3, 3], c: CREAM });
        for (const [x, z] of [[-2.6, 1], [2.6, 1], [-2.6, -1], [2.6, -1]] as const) b.push({ p: [x, 2.1, z], s: [0.9, 2.6, 0.9], c: CREAM });
        b.push({ p: [4, 6.4, 0], s: [1.6, 3.2, 1.6], c: CREAM, r: [0, 0, -0.4] });
        b.push({ p: [5.4, 7.8, 0], s: [2.6, 1.6, 1.6], c: CREAM });
        b.push({ p: [6.2, 8, 0.85], s: [0.4, 0.4, 0.2], c: "#1F2937" });
        b.push({ p: [3.4, 7.6, 0], s: [0.8, 2.6, 0.6], c: "#D6C7A1" });     // yele
        b.push({ p: [-4, 4.8, 0], s: [1.6, 0.8, 0.8], c: "#D6C7A1", r: [0, 0, 0.5] });
        for (const z of [-1.8, 1.8]) for (let k = 0; k < 3; k++)
          b.push({ p: [-0.6 - k * 1.2, 6.8 + k * 1.2, z * (1 + k * 0.4)], s: [2.4, 0.6, 1.8], c: k % 2 ? "#FFFFFF" : "#E7E0CC", r: [z > 0 ? -0.3 : 0.3, 0, 0.2] });
        return b;
      },
    },
    {
      id: "olympus-myths-bronze-giant", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // tunç dev otomat: perçinli gövde, tek göğüs sübabı yok (ışıklı göz bandı), kollar yanda
        const b: SceneBox[] = [{ p: [0, 0.5, 0], s: [9, 1, 5], c: "#57534E" }];
        for (const x of [-1.5, 1.5]) b.push({ p: [x, 3, 0], s: [2, 4, 2], c: BRONZE_D });
        b.push({ p: [0, 7.6, 0], s: [6, 5.4, 3.6], c: BRONZE });
        for (const [x, y] of [[-2.2, 9.6], [2.2, 9.6], [-2.2, 5.6], [2.2, 5.6]] as const) b.push({ p: [x, y, 1.85], s: [0.6, 0.6, 0.2], c: BRONZE_D });
        for (const x of [-3.9, 3.9]) b.push({ p: [x, 7, 0], s: [1.8, 5, 1.8], c: BRONZE_D });
        b.push({ p: [0, 11.8, 0], s: [3.6, 3, 3], c: BRONZE });
        b.push({ p: [0, 12, 1.55], s: [2.8, 0.6, 0.2], c: "#FDBA74", glow: true });
        b.push({ p: [0, 13.6, 0], s: [1, 0.8, 2.8], c: BRONZE_D });
        return b;
      },
    },
  ],
};
