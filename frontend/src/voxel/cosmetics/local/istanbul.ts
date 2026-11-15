/**
 * İstanbul yerel kostümleri. Gündelik, iş ve seküler festival; cinsiyetten bağımsız.
 * Ten, göz ve yüz değişmez; yazı, logo, bayrak/kulüp renk çifti yok. Bilerek kaçınılan: fes, yeniçeri (askerî), sema giysisi
 * (dinî), kırmızı-beyaz yan yana bant ve kulüp renk çiftleri.
*/
import type { LocalCostume } from "./index";

const ARMS = ["armL", "armR"] as const;

const NAVY = "#22344F", CREAM = "#EFE6D2", SEA = "#3F7F7A", BRASS = "#C9A227";
const APRON = "#F4F1EA", APRON_D = "#D6D0C4", TRAY = "#9A6B3F", TRAY_D = "#7A5230", SIMIT = "#B5773A", CLOTH = "#8C8C7A";
const JACKET = "#3A4250", JACKET_D = "#2B313C";
/** Kıyı şenliği yamaları: karışık sırada, eşit olmayan boy ve dağınık yerleşim (sıralı bant oluşturmaz; K-10). */
const PATCH = ["#E0A526", "#2A9D8F", "#E76F51", "#8E7CC3", "#4F9DDE"];

export const ISTANBUL: readonly LocalCostume[] = [
  {
    id: "local-istanbul-vapur", slot: "outfit", surfaces: ["avatar", "me"], city: "istanbul", kind: "gunluk", weight: 4,
    ip_risk: 0, culture_risk: 0,
    culture_note: "Vapur yolcusu: lacivert yelek, krem gömlek, tek renk ince atkı. Fes, askerî ve dinî giysi yok; kırmızı-beyaz bant yok.",
    wear: (_a, box) => {
      // krem gömlek (gövde ve kollar), lacivert yelek kabuğu, önde gömlek şeridi, pirinç düğmeler, deniz yeşili ince atkı
      box("body", [0, 10, 0], [8.5, 8.3, 5.5], CREAM, { lod: 0 });
      for (const b of ARMS) box(b, [0, -2.6, 0], [2.9, 5.4, 2.9], CREAM, { lod: 0 });
      box("body", [0, 9.6, 0], [9, 7.4, 6], NAVY, { lod: 0 });
      box("body", [0, 9.8, 3.02], [2, 7.6, 0.2], CREAM);
      for (const y of [8, 10, 12]) box("body", [1.25, y, 3.08], [0.6, 0.6, 0.2], BRASS);
      box("body", [0, 14.2, 0], [8.2, 1.1, 5.8], SEA, { lod: 0 });
      box("body", [-1.7, 11.7, 3.18], [1.1, 4, 0.3], SEA);
      box("body", [-1.7, 9.5, 3.22], [1.3, 0.5, 0.32], "#2F625E");
    },
  },
  {
    id: "local-istanbul-simitci", slot: "outfit", surfaces: ["avatar", "me"], city: "istanbul", kind: "is", weight: 4,
    ip_risk: 0, culture_risk: 0, head: true,
    culture_note: "Simit ustası: beyaz önlük ve başta yuvarlak simit tablası (kumaş simit yastığı üstünde). Meslek onurlu gösterilir; yazı yok.",
    wear: (_a, box) => {
      // önlük: ön panel, boyun askısı, bel bağı
      box("body", [0, 9.4, 2.85], [7, 8.6, 0.3], APRON, { lod: 0 });
      box("body", [0, 14.1, 0], [8.4, 0.6, 5.6], APRON);
      box("body", [0, 10.3, 0], [8.6, 0.6, 5.7], APRON_D);
      box("body", [2.2, 8, 3.05], [2.4, 1.8, 0.2], APRON_D);
      // başta tabla: kumaş halka yastık, iki kat tahta tabla, beş simit
      box("head", [0, 10.4, 0], [5, 0.8, 5], CLOTH, { lod: 0 });
      box("head", [0, 11.1, 0], [12, 0.6, 9], TRAY, { lod: 0 });
      box("head", [0, 11.1, 0], [9, 0.6, 12], TRAY, { lod: 0 });
      box("head", [0, 11.3, 0], [10.4, 0.5, 10.4], TRAY_D);
      for (const [x, z] of [[-3, -2.6], [2.8, -2.8], [0, 0.2], [-2.9, 3], [3, 2.8]] as const)
        box("head", [x, 11.9, z], [2.4, 0.8, 2.4], SIMIT, { lod: x === 0 ? 0 : 1 });
    },
  },
  {
    id: "local-istanbul-fener", slot: "outfit", surfaces: ["avatar", "me"], city: "istanbul", kind: "festival", weight: 1,
    ip_risk: 0, culture_risk: 0,
    culture_note: "Seküler kıyı şenliği: koyu ceket üstüne karışık sıralı yamalar ve elde kâğıt fener. Bayrak renk sırası yok, dinî simge yok.",
    wear: (_a, box) => {
      box("body", [0, 9.9, 0], [8.8, 8.5, 5.8], JACKET, { lod: 0 });
      for (const b of ARMS) box(b, [0, -2.7, 0], [3, 5.6, 3], JACKET, { lod: 0 });
      box("body", [0, 14, -0.1], [8.4, 1, 6], JACKET_D);
      // yamalar (göğüs, karın, sırt ve kollarda dağınık; boyları farklı)
      box("body", [-2.3, 12.1, 2.95], [2.2, 1.8, 0.2], PATCH[0]);
      box("body", [1.9, 10.6, 2.95], [1.6, 2.4, 0.2], PATCH[1]);
      box("body", [-1.2, 7.9, 2.95], [2.8, 1.4, 0.2], PATCH[2]);
      box("body", [2.6, 7.4, 2.95], [1.4, 1.4, 0.2], PATCH[3]);
      box("body", [1.4, 11.8, -2.95], [2.6, 2, 0.2], PATCH[4]);
      box("body", [-2.1, 8.6, -2.95], [1.8, 1.6, 0.2], PATCH[2]);
      box("armL", [-1.55, -2, 0], [0.2, 1.8, 1.6], PATCH[1]);
      box("armR", [1.55, -3.4, 0], [0.2, 1.4, 2], PATCH[0]);
      // elde kâğıt fener (sap + gövde + sıcak ışık; durağan, yanıp sönmez)
      box("armR", [0, -7.3, 1.4], [0.3, 1.2, 0.3], "#5B4636");
      box("armR", [0, -8.9, 1.4], [2, 2.2, 2], "#F6C453", { glow: true });
      box("armR", [0, -10.1, 1.4], [1.4, 0.3, 1.4], "#5B4636");
    },
  },
];
