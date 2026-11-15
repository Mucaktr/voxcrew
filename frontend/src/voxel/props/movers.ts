/**
 * SP-W0 — hareketli set parçaları ( `mover`): vapur, tramvay, zeplin, balon, otobüs,
 * tekne, felucca, teleferik, denizaltı, tren; W2-INT: vatoz, balık sürüsü; W2b-INT: taksi; W3a-INT: dron, kayaklı uçak. Her biri birkaç kutudan oluşan özgün, logosuz şekildir (livre, amblem,
 * yazı yok). Yol boyunca döngü ya da gidip-gelme; yönü yol parçasından. Çizim `props/SceneFx.tsx` (tek InstancedMesh,
 * hava durumuyla ortak → +1 çizim çağrısı). Hareket azaltmada `phase` konumunda durağan; gece pencereler yanar, `dayOnly`
 * olanlar (balon) gizlenir.
*/
import type { Mover, MoverShape } from "../scenes";
import { dezfightParts } from "../zfight";

/** Yerel kutu: [x, y, z, w, h, d, renk] — ileri yön +x, taban y = 0. Renk: "body" | "accent" | "lit" (gece yanan pencere) | hex. */
export type Part = [number, number, number, number, number, number, string];

const WIN = "lit";
function row(n: number, x0: number, dx: number, y: number, z: number, w = 0.22, h = 0.2): Part[] {
  return Array.from({ length: n }, (_, k) => [x0 + k * dx, y, z, w, h, 0.04, WIN] as Part);
}

/**
 * CORE-CITYMAP — Londra iki katlı otobüsü (sahne hareketlisi): alt kat + kat arası kuşak + üst kat (iki yanda iki kat pencere sırası),
 * ön camlar, arka sahanlık direği, tekerlekler; kabuk gövde (içi boş). Toplam yükseklik eski kutuyla aynı (1,49; walk/scale.ts
 * yürüme uyumu 2,5 × insan) — parçalar bu boya ölçeklenir. Yazı/işaret yok.
 */
function busShell(): Part[] {
  const parts: Part[] = [
    [0, 0.62, 0.47, 2.6, 0.88, 0.06, "body"], [0, 0.62, -0.47, 2.6, 0.88, 0.06, "body"],
    [1.27, 0.62, 0, 0.06, 0.88, 1.0, "body"], [-1.27, 0.5, 0, 0.06, 0.64, 1.0, "body"],
    [0, 1.1, 0, 2.62, 0.1, 1.02, "accent"],
    [0, 1.44, 0.47, 2.5, 0.6, 0.06, "body"], [0, 1.44, -0.47, 2.5, 0.6, 0.06, "body"],
    [1.22, 1.44, 0, 0.06, 0.6, 1.0, "body"], [-1.22, 1.44, 0, 0.06, 0.6, 1.0, "body"], [0, 1.78, 0, 2.5, 0.08, 1.0, "body"],
    ...row(5, -0.96, 0.48, 0.66, 0.51, 0.34, 0.3), ...row(5, -0.96, 0.48, 0.66, -0.51, 0.34, 0.3),
    ...row(5, -0.96, 0.48, 1.44, 0.51, 0.34, 0.28), ...row(5, -0.96, 0.48, 1.44, -0.51, 0.34, 0.28),
    [1.31, 0.72, 0, 0.04, 0.32, 0.7, WIN], [1.26, 1.44, 0, 0.04, 0.28, 0.7, WIN], [-1.24, 0.5, 0.3, 0.04, 0.8, 0.04, "#C9CED4"],
  ];
  const f = 1.49 / 1.82;
  return [
    [0, 0.12, 0, 2.6, 0.12, 1.0, "#2F3640"],
    ...parts.map(([x, y, z, w, h, d, c]) => [x, y * f, z, w, h * f, d, c] as Part),
    [-0.8, 0.12, 0.45, 0.36, 0.36, 0.14, "#1F2937"], [0.8, 0.12, 0.45, 0.36, 0.36, 0.14, "#1F2937"],
    [-0.8, 0.12, -0.45, 0.36, 0.36, 0.14, "#1F2937"], [0.8, 0.12, -0.45, 0.36, 0.36, 0.14, "#1F2937"],
    // VEHICLE-DETAIL: iki far (gece yanar)
    [1.305, 0.3, 0.3, 0.01, 0.08, 0.14, WIN], [1.305, 0.3, -0.3, 0.01, 0.08, 0.14, WIN],
  ];
}

/** Şekil kütüphanesi (yerel ölçü; 1 ≈ 1 karo). Bütçe: şekil başına ≤ 40 kutu, sahne başına ≤ 400 (SCENE-MOVER-001). VEHICLE-DETAIL:
 * araç şekilleri ayrıntılandı (kapı, far/stop, tampon, boji, korkuluk, filika, lateen yelken…); kutu sayıları arka uç
 * `worlds/validate.py MOVER_BOXES` ile eşlik. Ayrıntı düzeyi yok: tek örneklenmiş dizinin kapasitesi beyan edilen kutu sayısıdır
 * (uzakta kutu gizlemek sahne bütçesini düşürmez); en kalabalık sahne (<city>) 207 kutu.*/
export const SHAPES_RAW: Record<MoverShape, Part[]> = {
  // VEHICLE-DETAIL: vapur — gövde + su hattı koyu bandı, sürtünme kuşağı, kamara (iki yanda pencere sırası, yan kapı), üstte kaptan
  // köşkü (ön cam), baca, can filikaları, direk, pruva/kıç korkulukları, pruva feneri (32 kutu; sınır kutusu aynı)
  ferry: [
    [0, 0.25, 0, 3.6, 0.5, 1.2, "body"], [1.85, 0.25, 0, 0.3, 0.4, 0.8, "body"], [-1.85, 0.25, 0, 0.3, 0.4, 0.8, "body"],
    [0, 0.08, 0, 3.7, 0.12, 1.24, "#2F3A45"], [0, 0.48, 0, 3.62, 0.04, 1.22, "#2F3A45"],
    [0, 0.75, 0, 2.6, 0.5, 1.0, "#F4F4F0"], ...row(6, -1.05, 0.42, 0.78, 0.51), ...row(6, -1.05, 0.42, 0.78, -0.51),
    [1.05, 0.68, 0.505, 0.16, 0.34, 0.02, "#2F3A45"], [1.05, 0.68, -0.505, 0.16, 0.34, 0.02, "#2F3A45"],
    [0, 1.04, 0, 2.0, 0.08, 1.05, "#2F3A45"], [0.2, 1.36, 0, 0.36, 0.55, 0.36, "accent"], [0.2, 1.68, 0, 0.4, 0.1, 0.4, "#2F3A45"],
    [0.8, 1.2, 0, 0.5, 0.24, 0.8, "#F4F4F0"], [1.06, 1.22, 0, 0.02, 0.12, 0.64, WIN], [0.8, 1.48, 0, 0.04, 0.32, 0.04, "#2F3A45"],
    [-0.55, 1.15, 0.38, 0.5, 0.14, 0.16, "#E8702A"], [-0.55, 1.15, -0.38, 0.5, 0.14, 0.16, "#E8702A"],
    [1.55, 0.6, 0.57, 0.5, 0.2, 0.03, "#C9CED4"], [1.55, 0.6, -0.57, 0.5, 0.2, 0.03, "#C9CED4"],
    [-1.55, 0.6, 0.57, 0.5, 0.2, 0.03, "#C9CED4"], [-1.55, 0.6, -0.57, 0.5, 0.2, 0.03, "#C9CED4"], [1.98, 0.5, 0, 0.04, 0.06, 0.06, WIN],
  ],
  // CORE-CITYMAP: yolcu taşıtları kabuk gövde (döşeme, iki yan duvar, uç duvarları, tavan) — içi dolu tek kutu değil. VEHICLE-DETAIL:
  // iki yanda iki alt kapı paneli, iki boji, iki far, hedef tabelası, stop (32 kutu)
  tram: [
    [0, 0.12, 0, 2.4, 0.16, 0.7, "#2F3640"], [0, 0.22, 0, 2.6, 0.06, 0.9, "body"],
    [0, 0.65, 0.42, 2.6, 0.9, 0.06, "body"], [0, 0.65, -0.42, 2.6, 0.9, 0.06, "body"],
    [1.27, 0.65, 0, 0.06, 0.9, 0.9, "body"], [-1.27, 0.65, 0, 0.06, 0.9, 0.9, "body"],
    [0, 1.13, 0, 2.6, 0.06, 0.9, "body"], [0, 1.2, 0, 2.5, 0.1, 0.8, "accent"],
    ...row(5, -0.96, 0.48, 0.82, 0.46, 0.34, 0.34), ...row(5, -0.96, 0.48, 0.82, -0.46, 0.34, 0.34),
    [1.31, 0.82, 0, 0.04, 0.34, 0.6, WIN], [-1.31, 0.82, 0, 0.04, 0.34, 0.6, WIN],
    [0, 1.45, 0, 0.06, 0.4, 0.06, "#2F3640"], [0, 1.66, 0, 0.7, 0.04, 0.06, "#2F3640"],
    [-0.72, 0.43, 0.455, 0.3, 0.36, 0.02, "accent"], [0.72, 0.43, 0.455, 0.3, 0.36, 0.02, "accent"],
    [-0.72, 0.43, -0.455, 0.3, 0.36, 0.02, "accent"], [0.72, 0.43, -0.455, 0.3, 0.36, 0.02, "accent"],
    [-0.8, 0.1, 0, 0.6, 0.12, 0.74, "#2F3640"], [0.8, 0.1, 0, 0.6, 0.12, 0.74, "#2F3640"],
    [1.31, 0.4, 0.25, 0.04, 0.08, 0.1, WIN], [1.31, 0.4, -0.25, 0.04, 0.08, 0.1, WIN], [1.31, 1.04, 0, 0.03, 0.08, 0.4, WIN],
    [-1.31, 0.4, 0, 0.04, 0.06, 0.4, "#C0392B"],
  ],
  // Londra iki katlı otobüsü: alt kat + kat arası kuşak + üst kat (iki yanda iki kat pencere sırası), ön camlar, arka sahanlık
  // direği, tekerlekler; yazı/işaret yok. VEHICLE-DETAIL: iki far (40 kutu: 10 otobüs = 400, sahne tavanı)
  bus: busShell(),
  // VEHICLE-DETAIL: zeplin — iki motor gondolu + pervane, gondol ön camı (23 kutu)
  airship: [
    [0, 2.6, 0, 4.2, 1.3, 1.3, "body"], [0, 2.6, 0, 3.4, 1.6, 1.6, "body"], [0, 2.6, 0, 2.4, 1.8, 1.8, "body"],
    [2.3, 2.6, 0, 0.5, 0.8, 0.8, "body"], [-2.2, 2.6, 0, 0.4, 0.9, 0.9, "body"],
    [-2.3, 2.6, 0, 0.6, 1.6, 0.08, "accent"], [-2.3, 2.6, 0, 0.6, 0.08, 1.6, "accent"],
    [0, 1.5, 0, 1.4, 0.45, 0.55, "accent"], ...row(3, -0.4, 0.4, 1.52, 0.28, 0.24, 0.18), ...row(3, -0.4, 0.4, 1.52, -0.28, 0.24, 0.18),
    [0.5, 1.85, 0, 0.06, 0.4, 0.06, "#5B4A3A"], [-0.5, 1.85, 0, 0.06, 0.4, 0.06, "#5B4A3A"],
    [-0.9, 1.5, 0.45, 0.3, 0.3, 0.06, "#5B4A3A"], [-0.9, 1.5, -0.45, 0.3, 0.3, 0.06, "#5B4A3A"],
    [0.71, 1.52, 0, 0.02, 0.16, 0.36, WIN],
    [-0.9, 1.5, 0.56, 0.36, 0.16, 0.16, "#5B4A3A"], [-0.9, 1.5, -0.56, 0.36, 0.16, 0.16, "#5B4A3A"],
    [-1.1, 1.5, 0.56, 0.02, 0.26, 0.05, "#2F3640"], [-1.1, 1.5, -0.56, 0.02, 0.26, 0.05, "#2F3640"],
  ],
  // VEHICLE-DETAIL: balon — zarfta ara kademe ve iki dikey dilim şeridi, dört halat, deri sepet ağzı (16 kutu; sepet ölçüsü aynı)
  balloon: [
    [0, 2.7, 0, 1.6, 1.4, 1.6, "body"], [0, 2.7, 0, 1.9, 1.0, 1.9, "body"], [0, 3.55, 0, 1.1, 0.4, 1.1, "body"],
    [0, 1.95, 0, 1.0, 0.3, 1.0, "accent"], [0, 2.7, 0, 1.92, 0.3, 0.3, "accent"], [0, 2.7, 0, 0.3, 0.3, 1.92, "accent"],
    [0, 1.25, 0, 0.6, 0.45, 0.6, "#8B5A2B"], [0.25, 1.62, 0.25, 0.04, 0.5, 0.04, "#5B4A3A"], [-0.25, 1.62, -0.25, 0.04, 0.5, 0.04, "#5B4A3A"],
    [0, 1.55, 0, 0.14, 0.14, 0.14, WIN],
    [0.25, 1.62, -0.25, 0.04, 0.5, 0.04, "#5B4A3A"], [-0.25, 1.62, 0.25, 0.04, 0.5, 0.04, "#5B4A3A"],
    [0, 3.25, 0, 1.4, 0.3, 1.4, "body"], [0, 2.75, 0, 1.92, 1.1, 0.3, "accent"], [0, 2.75, 0, 0.3, 1.1, 1.92, "accent"],
    [0, 1.49, 0, 0.64, 0.04, 0.64, "#5B3A22"],
  ],
  // VEHICLE-DETAIL: tekne — su hattı bandı ve sürtünme kuşağı, iki yanda + önde cam, kamara tavanı, ön güverte korkuluğu, kıçta
  // motor, babalar, oturak (16 kutu; sınır kutusu aynı)
  boat: [
    [0, 0.2, 0, 1.8, 0.4, 0.76, "body"], [0.95, 0.22, 0, 0.3, 0.3, 0.5, "body"], [0, 0.42, 0, 1.6, 0.06, 0.7, "#A0805A"],
    [-0.3, 0.65, 0, 0.6, 0.4, 0.6, "accent"], [-0.3, 0.67, 0.31, 0.4, 0.18, 0.02, WIN],
    [0, 0.07, 0, 1.78, 0.1, 0.8, "#2F3640"], [0, 0.37, 0, 1.8, 0.05, 0.8, "#2F3640"],
    [-0.3, 0.67, -0.31, 0.4, 0.18, 0.02, WIN], [0.005, 0.7, 0, 0.02, 0.16, 0.44, WIN], [-0.3, 0.83, 0, 0.66, 0.04, 0.66, "#F4F4F0"],
    [0.55, 0.52, 0.37, 0.7, 0.14, 0.02, "#C9CED4"], [0.55, 0.52, -0.37, 0.7, 0.14, 0.02, "#C9CED4"],
    [-0.84, 0.5, 0, 0.12, 0.3, 0.16, "#2F3640"], [0.75, 0.47, 0.25, 0.06, 0.04, 0.06, "#2F3640"], [0.75, 0.47, -0.25, 0.06, 0.04, 0.06, "#2F3640"],
    [0.4, 0.49, 0, 0.12, 0.08, 0.5, "#A0805A"],
  ],
  // VEHICLE-DETAIL: felucca — kademeli üçgen lateen yelken (yukarı ve kıça doğru daralır), alt seren, mavi kuşak, pruva bodoslaması,
  // dümen, iki yanda minder (15 kutu; sınır kutusu aynı)
  felucca: [
    [0, 0.2, 0, 2.2, 0.36, 0.76, "body"], [1.2, 0.26, 0, 0.3, 0.3, 0.4, "body"], [0, 0.4, 0, 2.0, 0.05, 0.7, "#A0805A"],
    [0.2, 1.4, 0, 0.08, 2.2, 0.08, "#5B4A3A"], [0, 0.36, 0, 2.2, 0.05, 0.8, "#2F5D8A"],
    [1.33, 0.5, 0, 0.04, 0.3, 0.06, "#A0805A"], [-1.08, 0.3, 0, 0.04, 0.36, 0.06, "#5B4A3A"],
    [-0.15, 0.62, 0, 1.7, 0.04, 0.04, "#A0805A"],
    [-0.15, 0.85, 0, 1.6, 0.42, 0.04, "accent"], [-0.3, 1.3, 0, 1.3, 0.48, 0.04, "accent"], [-0.45, 1.78, 0, 0.95, 0.48, 0.04, "accent"],
    [-0.6, 2.2, 0, 0.6, 0.36, 0.04, "accent"], [-0.72, 2.51, 0, 0.3, 0.28, 0.04, "accent"],
    [-0.4, 0.46, 0.26, 0.8, 0.06, 0.16, "#C0392B"], [-0.4, 0.46, -0.26, 0.8, 0.06, 0.16, "#C0392B"],
  ],
  // VEHICLE-DETAIL: teleferik kabini — kabuk (döşeme, köşe dikmeleri, alt panel), dört yanda geniş cam, tavan, askı + iki makaralı
  // tutucu (19 kutu)
  cablecar: [
    [0, -1.0, 0, 1.2, 0.1, 1.0, "body"],
    [0.55, -0.6, 0.45, 0.1, 0.8, 0.1, "body"], [-0.55, -0.6, 0.45, 0.1, 0.8, 0.1, "body"], [0.55, -0.6, -0.45, 0.1, 0.8, 0.1, "body"], [-0.55, -0.6, -0.45, 0.1, 0.8, 0.1, "body"],
    [0, -0.85, 0.48, 1.2, 0.3, 0.04, "body"], [0, -0.85, -0.48, 1.2, 0.3, 0.04, "body"], [0.58, -0.85, 0, 0.04, 0.3, 1.0, "body"], [-0.58, -0.85, 0, 0.04, 0.3, 1.0, "body"],
    // pencere şeritleri yalnız tavan altında (gövde hizası açık: binen avatar yandan görünür; eskiden dolu cam paneli onu örtüyordu)
    [0, -0.3, 0.51, 1.0, 0.12, 0.04, WIN], [0, -0.3, -0.51, 1.0, 0.12, 0.04, WIN], [0.59, -0.3, 0, 0.02, 0.12, 0.8, WIN], [-0.59, -0.3, 0, 0.02, 0.12, 0.8, WIN],
    [0, -0.18, 0, 1.2, 0.06, 1.0, "body"], [0, -0.1, 0, 1.25, 0.1, 1.05, "accent"],
    [0, 0.2, 0, 0.08, 0.5, 0.08, "#2F3640"], [0, 0.45, 0, 0.5, 0.1, 0.14, "#2F3640"],
    [0.18, 0.45, 0, 0.12, 0.1, 0.16, "#5B6670"], [-0.18, 0.45, 0, 0.12, 0.1, 0.16, "#5B6670"],
  ],
  // VEHICLE-DETAIL: denizaltı — iki yatay dümen, kulede iki pencere, burun feneri (17 kutu)
  submarine: [
    [0, 0, 0, 2.8, 0.8, 0.8, "body"], [0, 0, 0, 2.0, 1.0, 1.0, "body"], [0.2, 0.65, 0, 0.7, 0.5, 0.4, "body"],
    [1.45, 0, 0, 0.2, 0.5, 0.5, "#C9D6DF"], [-1.5, 0, 0, 0.2, 0.9, 0.08, "accent"], [-1.5, 0, 0, 0.2, 0.08, 0.9, "accent"],
    ...row(3, -0.5, 0.5, 0.05, 0.51, 0.2, 0.2), ...row(3, -0.5, 0.5, 0.05, -0.51, 0.2, 0.2),
    [0.9, 0.1, 0.45, 0.3, 0.04, 0.1, "accent"], [0.9, 0.1, -0.45, 0.3, 0.04, 0.1, "accent"],
    [0.2, 0.72, 0.205, 0.3, 0.1, 0.02, WIN], [0.2, 0.72, -0.205, 0.3, 0.1, 0.02, WIN], [1.54, 0, 0, 0.02, 0.12, 0.12, WIN],
  ],
  // VEHICLE-DETAIL: tren — iki yanda iki alt kapı paneli, pencere üstü livre şeridi, iki boji, iki far, iki stop (34 kutu)
  train: [
    [0, 0.2, 0, 3.4, 0.1, 0.9, "body"], [0, 0.62, 0.42, 3.4, 0.86, 0.06, "body"], [0, 0.62, -0.42, 3.4, 0.86, 0.06, "body"],
    [-1.67, 0.62, 0, 0.06, 0.86, 0.9, "body"], [0, 1.02, 0, 3.4, 0.06, 0.9, "body"],
    [1.85, 0.5, 0, 0.5, 0.7, 0.8, "body"], [2.2, 0.4, 0, 0.3, 0.45, 0.6, "body"],
    [0, 0.12, 0, 3.2, 0.16, 0.7, "#2F3640"], [0, 1.08, 0, 3.4, 0.06, 0.92, "accent"],
    ...row(6, -1.3, 0.5, 0.7, 0.46, 0.34, 0.3), ...row(6, -1.3, 0.5, 0.7, -0.46, 0.34, 0.3),
    [2.05, 0.75, 0, 0.3, 0.26, 0.6, WIN],
    [-1.05, 0.42, 0.455, 0.3, 0.26, 0.02, "#2F3640"], [0.95, 0.42, 0.455, 0.3, 0.26, 0.02, "#2F3640"],
    [-1.05, 0.42, -0.455, 0.3, 0.26, 0.02, "#2F3640"], [0.95, 0.42, -0.455, 0.3, 0.26, 0.02, "#2F3640"],
    [0, 0.93, 0.455, 3.3, 0.05, 0.02, "accent"], [0, 0.93, -0.455, 3.3, 0.05, 0.02, "accent"],
    [-1.1, 0.1, 0, 0.7, 0.12, 0.76, "#2F3640"], [1.1, 0.1, 0, 0.7, 0.12, 0.76, "#2F3640"],
    [2.34, 0.42, 0.18, 0.02, 0.08, 0.1, WIN], [2.34, 0.42, -0.18, 0.02, 0.08, 0.1, WIN],
    [-1.69, 0.4, 0.25, 0.02, 0.08, 0.1, "#C0392B"], [-1.69, 0.4, -0.25, 0.02, 0.08, 0.1, "#C0392B"],
  ],
  // W2b-INT (<city>): sarı taksi — gövde, kabin, iki yan pencere bandı, tavan lambası kutusu, koyu şerit, 4 teker; yazı/dama yok.
  // VEHICLE-DETAIL: ön ve arka cam, iki far, iki stop, ön/arka tampon, ızgara, iki dikiz aynası (21 kutu; sınır kutusu aynı)
  taxi: [
    [0, 0.38, 0, 1.9, 0.42, 0.86, "body"], [-0.1, 0.74, 0, 1.0, 0.32, 0.8, "body"],
    [-0.1, 0.76, 0.41, 0.86, 0.2, 0.02, WIN], [-0.1, 0.76, -0.41, 0.86, 0.2, 0.02, WIN], [-0.1, 0.95, 0, 0.3, 0.1, 0.18, WIN],
    [0, 0.3, 0, 1.92, 0.06, 0.88, "accent"],
    [-0.6, 0.14, 0.4, 0.28, 0.28, 0.1, "#1F2937"], [0.6, 0.14, 0.4, 0.28, 0.28, 0.1, "#1F2937"],
    [-0.6, 0.14, -0.4, 0.28, 0.28, 0.1, "#1F2937"], [0.6, 0.14, -0.4, 0.28, 0.28, 0.1, "#1F2937"],
    [0.41, 0.76, 0, 0.02, 0.2, 0.7, WIN], [-0.61, 0.76, 0, 0.02, 0.2, 0.7, WIN],
    [0.955, 0.44, 0.3, 0.01, 0.08, 0.14, "#FFE7A3"], [0.955, 0.44, -0.3, 0.01, 0.08, 0.14, "#FFE7A3"],
    [-0.955, 0.44, 0.3, 0.01, 0.08, 0.14, "#E04848"], [-0.955, 0.44, -0.3, 0.01, 0.08, 0.14, "#E04848"],
    [0.94, 0.2, 0, 0.04, 0.1, 0.84, "#2F3640"], [-0.94, 0.2, 0, 0.04, 0.1, 0.84, "#2F3640"], [0.955, 0.33, 0, 0.01, 0.08, 0.3, "#2F3640"],
    [0.3, 0.66, 0.43, 0.06, 0.06, 0.04, "body"], [0.3, 0.66, -0.43, 0.06, 0.06, 0.04, "body"],
  ],
  // W3a-INT (neon): teslimat dronu — gövde, 4 pervane kolu ucu, altta parlak ışık (6 kutu); yazı/amblem yok
  drone: [
    [0, 0, 0, 0.42, 0.12, 0.42, "body"],
    [0.3, 0.06, 0.3, 0.24, 0.03, 0.24, "body"], [-0.3, 0.06, 0.3, 0.24, 0.03, 0.24, "body"],
    [0.3, 0.06, -0.3, 0.24, 0.03, 0.24, "body"], [-0.3, 0.06, -0.3, 0.24, 0.03, 0.24, "body"],
    [0, -0.09, 0, 0.14, 0.06, 0.14, "accent"],
  ],
  // W3a-INT (aurora): kayaklı küçük uçak — gövde, üst kanat, dikey + yatay kuyruk, burun, pervane diski, 2 dikme + 2 kayak,
  // 2 kabin penceresi (14 kutu); livre/işaret yok
  skiplane: [
    [0, 0.55, 0, 2.2, 0.45, 0.5, "body"], [-1.35, 0.6, 0, 0.6, 0.28, 0.3, "body"], [1.2, 0.55, 0, 0.25, 0.38, 0.42, "#2F3640"],
    [1.34, 0.55, 0, 0.03, 0.9, 0.12, "#2F3640"], [0.25, 0.86, 0, 0.6, 0.06, 3.2, "accent"],
    [-1.6, 0.92, 0, 0.32, 0.5, 0.05, "accent"], [-1.6, 0.66, 0, 0.3, 0.05, 1.1, "accent"],
    [0.35, 0.72, 0.26, 0.4, 0.18, 0.02, WIN], [0.35, 0.72, -0.26, 0.4, 0.18, 0.02, WIN],
    [0.25, 0.2, 0.3, 0.05, 0.36, 0.05, "#2F3640"], [0.25, 0.2, -0.3, 0.05, 0.36, 0.05, "#2F3640"],
    [0.25, 0.02, 0.3, 1.1, 0.05, 0.14, "#C9D2DB"], [0.25, 0.02, -0.3, 1.1, 0.05, 0.14, "#C9D2DB"],
    [0.85, 0.06, 0, 0.05, 0.05, 0.62, "#2F3640"],
  ],
  // W2-INT (reef): vatoz — yassı baklava gövde, kanat uçları, kuyruk (8 kutu)
  manta: [
    [0, 0, 0, 1.4, 0.14, 1.0, "body"], [0, 0, 0, 0.9, 0.16, 1.9, "body"], [0.15, 0.02, 0, 0.5, 0.12, 2.6, "body"],
    [0.3, 0.06, 1.35, 0.3, 0.06, 0.25, "accent"], [0.3, 0.06, -1.35, 0.3, 0.06, 0.25, "accent"],
    [0.78, 0, 0.18, 0.18, 0.08, 0.1, "body"], [0.78, 0, -0.18, 0.18, 0.08, 0.1, "body"], [-1.25, 0, 0, 1.1, 0.05, 0.05, "accent"],
  ],
  // W2-INT (reef): balık sürüsü — 12 küçük kutu, iki renk, sürü gibi dağınık
  fish_school: [
    [0, 0, 0, 0.26, 0.12, 0.08, "body"], [-0.4, 0.18, 0.3, 0.26, 0.12, 0.08, "accent"], [-0.35, -0.16, -0.32, 0.26, 0.12, 0.08, "body"],
    [-0.8, 0.05, 0.05, 0.26, 0.12, 0.08, "accent"], [-0.75, 0.32, -0.25, 0.26, 0.12, 0.08, "body"], [-0.7, -0.3, 0.4, 0.26, 0.12, 0.08, "body"],
    [-1.15, 0.2, 0.42, 0.26, 0.12, 0.08, "accent"], [-1.2, -0.12, -0.1, 0.26, 0.12, 0.08, "body"], [-1.1, 0.38, 0.12, 0.26, 0.12, 0.08, "body"],
    [-1.55, 0.02, 0.25, 0.26, 0.12, 0.08, "accent"], [-1.6, 0.26, -0.3, 0.26, 0.12, 0.08, "body"], [-1.95, 0.12, 0.05, 0.26, 0.12, 0.08, "body"],
  ],
};
/** RENDER-FIX (REAL-ZFIGHT-001): çizilen şekiller — aynı düzlemde örtüşen farklı renkli yüzler çözülmüş (`zfight.ts dezfight`: ayrıntı
 *  öne, kaybeden yüz 0,01 içeri; sınır kutusu ve kutu sayısı aynı → `worlds/validate.py MOVER_BOXES` eşliği değişmez). */
export const SHAPES = Object.fromEntries(Object.entries(SHAPES_RAW).map(([k, v]) => [k, dezfightParts(v)])) as Record<MoverShape, Part[]>;

export const DEFAULT_COLORS: Record<MoverShape, [string, string]> = {
  ferry: ["#F4F4F0", "#E8B530"], tram: ["#B8322B", "#F4EFE6"], bus: ["#B8322B", "#F4EFE6"], airship: ["#EADBC0", "#B87333"],
  balloon: ["#E5584E", "#F2B33D"], boat: ["#F4F4F0", "#2F7FC4"], felucca: ["#8B5A2B", "#F4EFE6"], cablecar: ["#C8553D", "#2F3640"],
  submarine: ["#F2B33D", "#2F3640"], train: ["#E9EEF2", "#2F7FC4"],
  manta: ["#3E5C76", "#E8EEF2"], fish_school: ["#FFA94D", "#7DD3FC"],
  taxi: ["#F2C230", "#2F3640"],
  drone: ["#2F3640", "#3EF0FF"], skiplane: ["#FF7A3D", "#F4F7FB"],
};

export const MAX_MOVERS = 12;
export const MAX_MOVER_BOXES = 400;
export const moverBoxes = (m: Mover) => SHAPES[m.shape]?.length ?? 0;

/** `MOVER-SEP-001`: iki hareketlinin merkezleri arasında en az bu kadar mesafe (dünya birimi)*/
export const MOVER_MIN_SEP = 1;

/**
 * hareketlilerin bir döngü boyunca en yakın çift uzaklığı (3B, merkezler). `horizon` sn boyunca `dt` adımla örnekler
 * (varsayılan: en uzun sürenin 6 katı, en az 240 sn; süreler ortak katsız olsa da yeterli kapsama). Dönüş: en kötü çift.
 * Aynı gidip-gelme yolunu paylaşan iki taşıt (karşılaşma) ve kavşakta kesişen yollar burada yakalanır.
*/
export function moverSeparation(movers: readonly Mover[], opts: { dt?: number; horizon?: number } = {}): { min: number; a: number; b: number; t: number } {
  const res = { min: Infinity, a: -1, b: -1, t: 0 };
  if (movers.length < 2) return res;
  const dt = opts.dt ?? 0.05;
  const horizon = opts.horizon ?? Math.max(240, 6 * Math.max(...movers.map((m) => m.period || 1)));
  const sam = movers.map(samplePath);
  const pos = movers.map(() => ({ x: 0, y: 0, z: 0, yaw: 0 }));
  for (let t = 0; t <= horizon; t += dt) {
    for (let k = 0; k < sam.length; k++) sam[k].at(t, pos[k]);
    for (let a = 0; a < pos.length; a++) for (let b = a + 1; b < pos.length; b++) {
      const d = Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y, pos[a].z - pos[b].z);
      if (d < res.min) { res.min = d; res.a = a; res.b = b; res.t = Math.round(t * 100) / 100; }
    }
  }
  return res;
}

/** Yol örnekleyici: önceden hesaplanmış parça uzunlukları; t (sn) → konum + yön (y ekseni açısı). */
export interface PathSampler { at(t: number, out: { x: number; y: number; z: number; yaw: number }): void }
export function samplePath(m: Mover): PathSampler {
  const pts = m.path.length ? m.path : [[0, 0, 0]] as [number, number, number][];
  const loop = (m.mode ?? "loop") === "loop" && pts.length > 2;
  const segs: { a: [number, number, number]; b: [number, number, number]; len: number; yaw: number }[] = [];
  const n = loop ? pts.length : pts.length - 1;
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    segs.push({ a, b, len: Math.hypot(dx, b[1] - a[1], dz) || 1e-6, yaw: Math.atan2(-dz, dx) });
  }
  const total = segs.reduce((s, x) => s + x.len, 0);
  const period = Math.max(1, m.period), phase = m.phase ?? 0;
  const pingpong = !loop;
  return {
    at(t, out) {
      if (!segs.length) { out.x = pts[0][0]; out.y = pts[0][1]; out.z = pts[0][2]; out.yaw = 0; return; }
      let u = ((t / period + phase) % 1 + 1) % 1;
      let back = false;
      if (pingpong) { u *= 2; if (u > 1) { u = 2 - u; back = true; } }
      let d = u * total;
      for (const s of segs) {
        if (d <= s.len || s === segs[segs.length - 1]) {
          const f = Math.min(1, d / s.len);
          out.x = s.a[0] + (s.b[0] - s.a[0]) * f; out.y = s.a[1] + (s.b[1] - s.a[1]) * f; out.z = s.a[2] + (s.b[2] - s.a[2]) * f;
          out.yaw = back ? s.yaw + Math.PI : s.yaw;
          return;
        }
        d -= s.len;
      }
    },
  };
}
