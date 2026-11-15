/**
 * AVM (alışveriş merkezi) — S42 yeniden kurulum (S34 sahnesinin yerine). Gerçek bir AVM'nin okunur parçaları, marka yok:
 *
 * - Arka: İKİ KATLI mağaza cephesi. Zemin katta süpermarket, giyim, elektronik, kitapçı (vitrin, manken, ürünler, tezgâh +
 * yazar kasa); asma katta (galeri, cam korkuluk) sinema girişi, oyuncakçı, spor, ev dekorasyonu ve kafe-teras vitrinleri.
 * Üstte cam çatılı atriyum (çelik kirişler + yükseltilmiş fener). Galeriye iki yürüyen merdiven (çıkış/iniş) ve cam asansör.
 * - Sol-arka: ÇOK KATLI OTOPARK (zemin + kat + çatı katı, park çizgileri, arabalar, sütunlar, rampa, merdiven kulesi, P).
 * - Sol-ön: sokak: taksi durağı, otobüs durağı, yaya kaldırımı; cam cepheli ana giriş (otomatik kapı + saçak).
 * - Ortada atriyum: fıskiye, banklar, danışma masası (+ dijital yön totemi), ortak çalışma salonu (uzun masa + kanepe).
 * - Sağda kafe masaları, sağ-önde yemek katı (büfeler, menü panoları, masalar), önde personel odası (portatif yataklar),
 * sağ kenarda masaj koltukları köşesi; girişte güvenlik masası, alışveriş arabaları.
 *
 * Mantık: istasyonlar yerinde iş — mağaza tezgâhı (ayakta, tablet/POS), danışma (ayakta, masaüstü),
 * güvenlik (sandalye, masaüstü), kafe masası ve ortak çalışma (sandalye, dizüstü), büfe (ayakta, tablet). Uyku: personel odası
 * portatif yatakları + masaj koltukları. Araç noktaları: yön totemi ve elektronik vitrini = web, kitapçı = okuma, elektronik
 * deneme terminali + güvenlik = kabuk, beyaz tahta ve yemek katı masaları = plan.
 *
 * Yürünebilirlik (a): üst kat yalnızca görseldir (voxel/buildings.ts). Bütün istasyon ve noktalar zemin katta.
 *
 * Kayıt notu (worldRecord.ts): kurucu yardımcıları üst düzeyden çağrılır; `ground` ilk çağrıdır. Bu modül scenes.ts ile
 * döngüsel içe aktarılır — yalnızca fonksiyon bildirimleri dışa aktarılır.
 *
 * Büyüme (`mallTheme`): ekip başına mağaza kanadı (iki dükkân, personel dinlenme köşesi), olanaklar yemek katı uzantısı ve
 * galeri katı (asma kat + yürüyen merdiven + fıskiye + dinlenme koltukları), boş parseller İKİ KATLI otopark (rampa + kat).
*/
import { Builder, tx, tz, type Built, type Dir } from "../scenes";
import { aquarium, fenceX, fenceZ, planter, rug as rugM, wallSign, type Fence } from "../districts/parts";
import { breakSpot, teamCorner, type Amenity, type Bay, type Theme } from "../districts/themes";
import { placeHotel } from "../districts/hotel";
import { car, column, elevator, escalator, litWindow, parkingDeck, pixelIcon, railing, ramp, slab, tower } from "../buildings";

const UP = 0, DOWN = Math.PI, LEFT = -Math.PI / 2, RIGHT = Math.PI / 2;

const FLOOR_A = "#F1ECE3";
const FLOOR_B = "#E3DCD0";
const TEAL = "#4FA3A5";
const STONE = "#D6CCBC";
const UNDER = "#A79F93";
const FACADE = "#EDE6DA";
const STRIPE = "#FFFFFF";
const WARM = "#FFD98A";
/** Galeri (1. kat) döşeme üstü. */
const L1 = 3;
/** Cephe tepesi ve cam çatı yüksekliği. */
const TOP = 6.6, ROOF = 7.25;

type ShopKind = "market" | "cloth" | "tech" | "book" | "cinema" | "toy" | "sport" | "deco" | "cafe" | "flower";
interface Shop { i: number; w: number; kind: ShopKind; facade: string; accent: string }

/** Zemin kat (j 0 cephesi, j 1 mağaza içi, j 2 tezgâh; en sağ karo giriş boşluğu). */
const GROUND: Shop[] = [
  { i: 7, w: 4, kind: "market", facade: "#E4F2E1", accent: "#2F855A" },
  { i: 11, w: 3, kind: "cloth", facade: "#F7E4EC", accent: "#C73E72" },
  { i: 14, w: 3, kind: "tech", facade: "#E2E7ED", accent: "#3B4A5E" },
  { i: 17, w: 2, kind: "book", facade: "#E3ECF6", accent: "#2F6FB3" },
];
/** Asma kat vitrinleri (yalnız görsel). */
const UPPER: Shop[] = [
  { i: 7, w: 5, kind: "cinema", facade: "#2B2F3A", accent: "#E11D48" },
  { i: 12, w: 3, kind: "toy", facade: "#FFF2D1", accent: "#D9920F" },
  { i: 15, w: 2, kind: "sport", facade: "#E0F2FE", accent: "#0369A1" },
  { i: 17, w: 2, kind: "deco", facade: "#F3E8FF", accent: "#7C3AED" },
  { i: 19, w: 4, kind: "cafe", facade: "#F3E3CF", accent: "#B5543C" },
];

/** 5×5 tabela simgeleri ('#' = piksel). */
const ICONS: Record<ShopKind, string[]> = {
  market: ["#....", "#####", "#####", ".###.", ".#.#."],
  cloth: ["..#..", "...#.", "..#..", ".#.#.", "#####"],
  tech: ["..##.", ".##..", "#####", "..##.", ".##.."],
  book: ["#...#", "##.##", "##.##", "##.##", "#####"],
  cinema: ["#####", "#.#.#", "#####", "#...#", "#####"],
  toy: ["..#..", "#####", ".###.", ".#.#.", "#...#"],
  sport: [".###.", "#.#.#", "##.##", "#.#.#", ".###."],
  deco: [".###.", "#####", "..#..", "..#..", ".###."],
  cafe: ["..#..", "####.", "#####", "####.", ".##.."],
  flower: [".#.#.", "#####", ".#.#.", "..#..", ".##.."],
};
const P_SIGN = ["###.", "#..#", "###.", "#...", "#..."];
const INFO = [".#.", "...", "##.", ".#.", "###"];
const BAG = [".#.#.", "#####", "#####", "#####", "#####"];
const FORK = ["#.#.#", "#.#.#", "#####", "..#..", "..#.."];
const STAFF = ["..#..", ".###.", "..#..", ".#.#.", "#...#"];
const WC_M = [".#.", "###", ".#.", ".#.", "#.#"];
const WC_F = [".#.", "###", "###", ".#.", "#.#"];
const TAXI = [".....", ".###.", "#####", "#####", ".#.#."];
const BUS = ["#####", "#.#.#", "#####", "#####", ".#.#."];

// ------------------------------------------------------------------------------------------ zemin bölgeleri
const garage = (i: number, j: number) => i <= 5 && j <= 7;
const road = (i: number, j: number) => i <= 5 && (j === 12 || j === 13);
const street = (i: number, j: number) => i <= 5 && j >= 8;
const foodcourt = (i: number, j: number) => i >= 15 && j >= 11;
const staffRoom = (i: number, j: number) => i >= 10 && i <= 14 && j >= 12;
const atriumRing = (i: number, j: number) => i >= 11 && i <= 16 && j >= 4 && j <= 9;

// ------------------------------------------------------------------------------------------ mağaza cephesi
/** Vitrin camının arkasındaki teşhir: cephe yüzüyle cam arasında (z0 + 0,08…0,4), `x0`–`x1` genişliğinde, taban y0. */
function windowDisplay(b: Builder, kind: ShopKind, x0: number, x1: number, y0: number, z0: number, accent: string) {
  const w = x1 - x0, cx = (x0 + x1) / 2, z = z0 + 0.24;
  switch (kind) {
    case "market": {
      // meyve-sebze kasaları + indirim afişi
      const fruit = ["#DC2626", "#F59E0B", "#65A30D", "#FACC15", "#EA580C", "#16A34A"];
      for (let k = 0; k < Math.floor(w / 0.6); k++) {
        const x = x0 + 0.35 + k * 0.6;
        b.box(x, y0 + 0.2, z, 0.5, 0.4, 0.3, "#A16207");
        b.box(x, y0 + 0.44, z, 0.44, 0.1, 0.26, fruit[k % fruit.length], "solid", 0.12);
      }
      b.box(cx + w / 4, y0 + 1.35, z0 + 0.12, 0.9, 0.7, 0.04, "#DC2626");
      pixelIcon(b, ["#..#", "..#.", ".#..", "#..#"], cx + w / 4, y0 + 1.35, z0 + 0.15, "#FFFFFF", 0.12, "glow");
      break;
    }
    case "cloth":
      for (let k = 0; k < 3; k++) {
        const x = x0 + w * (k + 1) / 4, c = ["#C73E72", "#60A5FA", "#FDE68A"][k];
        b.box(x, y0 + 0.04, z, 0.4, 0.08, 0.3, "#9CA3AF");
        b.box(x, y0 + 0.45, z, 0.06, 0.8, 0.06, "#6B7280");
        b.box(x, y0 + 1.15, z, 0.46, 0.62, 0.24, c);
        b.box(x, y0 + 0.82, z, 0.56, 0.12, 0.28, c);
        b.box(x, y0 + 1.62, z, 0.24, 0.26, 0.24, "#E5E7EB");
      }
      break;
    case "tech":
      for (let r = 0; r < 2; r++) for (let k = 0; k < Math.floor(w / 0.8); k++) {
        const x = x0 + 0.42 + k * 0.8, y = y0 + 0.75 + r * 0.62;
        b.box(x, y, z0 + 0.1, 0.7, 0.48, 0.05, "#111827");
        b.box(x, y, z0 + 0.13, 0.62, 0.4, 0.02, ["#38BDF8", "#A78BFA", "#34D399", "#F472B6"][(k + r) % 4], "glow");
      }
      b.box(cx, y0 + 0.3, z, w - 0.3, 0.6, 0.3, "#E5E7EB");
      for (let k = 0; k < 4; k++) b.box(x0 + 0.4 + k * (w - 0.8) / 3, y0 + 0.68, z, 0.14, 0.22, 0.03, "#1F2937");
      break;
    case "book":
      for (const y of [0.45, 1.05, 1.65]) {
        b.box(cx, y0 + y - 0.05, z0 + 0.18, w - 0.2, 0.05, 0.32, "#7B5236");
        for (let k = 0; k < Math.floor((w - 0.3) / 0.13); k++) {
          b.box(x0 + 0.2 + k * 0.13, y0 + y + 0.14, z0 + 0.2, 0.1, 0.3 - (k % 3) * 0.04, 0.24,
            ["#EF4444", "#3B82F6", "#F59E0B", "#10B981", "#8B5CF6"][(k + Math.round(y * 10)) % 5]);
        }
      }
      break;
    case "cinema": {
      // afiş panoları (parlak) + gişe camı + ışıklı saçak ampulleri
      for (const [dx, c] of [[-1.5, "#F472B6"], [-0.5, "#38BDF8"], [1.5, "#FBBF24"]] as [number, string][]) {
        b.box(cx + dx, y0 + 1.3, z0 + 0.08, 0.7, 1.05, 0.05, "#F8FAFC");
        b.box(cx + dx, y0 + 1.3, z0 + 0.11, 0.58, 0.92, 0.02, c, "glow");
      }
      b.box(cx + 0.5, y0 + 0.9, z0 + 0.06, 0.8, 1.6, 0.05, "#111827"); // REAL-SUPPORT: gişe cepheye yaslanır (eskiden 0,2 önünde havada)
      b.box(cx + 0.5, y0 + 1.2, z0 + 0.09, 0.6, 0.5, 0.02, "#FDE68A", "glow");
      for (let k = 0; k < Math.floor(w / 0.32); k++) b.box(x0 + 0.16 + k * 0.32, y0 + 2.25, z0 + 0.5, 0.1, 0.1, 0.1, "#FFF3C4", "glow");
      b.box(cx, y0 + 2.25, z0 + 0.42, w, 0.16, 0.14, "#111827");
      // patlamış mısır arabası
      b.box(cx - 1.5, y0 + 0.35, z, 0.5, 0.5, 0.3, "#E11D48");
      b.box(cx - 1.5, y0 + 0.75, z, 0.44, 0.3, 0.26, "#FEF3C7", "solid", 0.1);
      break;
    }
    case "toy":
      b.box(x0 + 0.5, y0 + 0.35, z, 0.5, 0.6, 0.3, "#B07D48");
      b.box(x0 + 0.5, y0 + 0.85, z, 0.42, 0.4, 0.28, "#B07D48");
      for (const dx of [-0.16, 0.16]) b.box(x0 + 0.5 + dx, y0 + 1.1, z, 0.12, 0.12, 0.1, "#8B5E3C");
      for (const [dx, dy, c] of [[1.2, 0.15, "#EF4444"], [1.5, 0.15, "#3B82F6"], [1.35, 0.45, "#FACC15"], [1.8, 0.15, "#22C55E"]] as [number, number, string][]) {
        b.box(x0 + dx, y0 + dy, z, 0.28, 0.28, 0.28, c);
      }
      b.box(x1 - 0.5, y0 + 0.7, z, 0.22, 1.1, 0.22, "#F8FAFC");
      b.box(x1 - 0.5, y0 + 1.35, z, 0.14, 0.24, 0.14, "#EF4444");
      for (const dx of [-0.16, 0.16]) b.box(x1 - 0.5 + dx, y0 + 0.3, z, 0.1, 0.3, 0.22, "#EF4444");
      break;
    case "sport":
      b.box(x0 + 0.5, y0 + 0.3, z, 0.42, 0.42, 0.3, "#EA580C");
      b.box(x0 + 0.5, y0 + 0.3, z + 0.01, 0.44, 0.04, 0.3, "#1F2937");
      b.box(x1 - 0.55, y0 + 1.15, z0 + 0.12, 0.6, 0.7, 0.05, accent);
      b.box(x1 - 0.55, y0 + 1.2, z0 + 0.15, 0.16, 0.24, 0.02, "#FFFFFF");
      b.box(x0 + 0.6, y0 + 0.8, z0 + 0.17, 0.9, 0.04, 0.3, "#9CA3AF"); // REAL-SUPPORT: ayakkabı rafı cepheye yaslı
      for (let k = 0; k < 2; k++) b.box(x0 + 0.4 + k * 0.4, y0 + 0.9, z, 0.32, 0.14, 0.18, ["#F8FAFC", "#22C55E"][k]);
      break;
    case "deco":
      b.box(x0 + 0.45, y0 + 0.3, z, 0.3, 0.6, 0.3, "#0D9488");
      b.box(x0 + 0.45, y0 + 0.75, z, 0.4, 0.3, 0.4, "#2F855A", "solid", 0.12);
      b.box(x1 - 0.5, y0 + 0.6, z, 0.06, 1.2, 0.06, "#78716C");
      b.box(x1 - 0.5, y0 + 1.3, z, 0.4, 0.3, 0.4, "#FDE68A", "glow");
      b.box(cx, y0 + 0.2, z, 0.5, 0.4, 0.3, "#E11D48");
      break;
    case "cafe":
    case "flower":
      for (let k = 0; k < Math.floor(w / 0.9); k++) {
        const x = x0 + 0.5 + k * 0.9;
        b.box(x, y0 + 0.45, z, 0.8, 0.9, 0.3, "#8B5E3C", "solid", 0.03);
        b.box(x, y0 + 1.1, z, 0.76, 0.4, 0.28, "#CFEFFF", "glass");
        for (const [dx, c] of [[-0.22, "#F472B6"], [0, "#FDE68A"], [0.22, "#A16207"]] as [number, string][]) b.box(x + dx, y0 + 0.98, z, 0.16, 0.12, 0.16, c);
      }
      break;
  }
}

/** Cephedeki dükkân: kaplama, pilastrlar, vitrin camı (gece yanar), teşhir, kapı. `sign`: tabelanın konumu (z, y). */
function storefront(b: Builder, s: Shop, y0: number, sign: { y: number; z: number }, z0 = tz(0) + 0.5) {
  const x0 = tx(s.i) - 0.5, x1 = tx(s.i + s.w - 1) + 0.5, cx = (x0 + x1) / 2;
  const h = 2.72;
  b.box(cx, y0 + h / 2, z0 + 0.03, s.w - 0.04, h, 0.06, s.facade, "solid", 0.02);
  for (const x of [x0 + 0.08, x1 - 0.08]) b.box(x, y0 + h / 2, z0 + 0.12, 0.16, h, 0.24, s.accent, "solid", 0.02);
  // vitrin: sol kısım (dükkân genişliği − kapı), kapı en sağ karoda
  const doorX = tx(s.i + s.w - 1);
  const wx0 = x0 + 0.18, wx1 = s.w > 2 ? doorX - 0.5 : x1 - 0.18;
  b.box((wx0 + wx1) / 2, y0 + 1.25, z0 + 0.07, wx1 - wx0, 2.1, 0.02, s.kind === "cinema" ? "#1F2937" : "#FFF8EE");
  windowDisplay(b, s.kind, wx0, wx1, y0 + 0.12, z0, s.accent);
  b.box((wx0 + wx1) / 2, y0 + 1.25, z0 + 0.44, wx1 - wx0, 2.1, 0.04, "#CFEFFF", "glass");
  b.box((wx0 + wx1) / 2, y0 + 0.1, z0 + 0.42, wx1 - wx0, 0.2, 0.1, s.accent); // REAL-SUPPORT: etek şeridi cama kadar (eskiden cam 0,08 havada)
  litWindow(b, (wx0 + wx1) / 2, y0 + 1.25, z0 + 0.47, "+z", wx1 - wx0 - 0.06, 2.0, WARM);
  if (s.w > 2) {
    b.box(doorX, y0 + 1.1, z0 + 0.1, 0.84, 2.2, 0.04, "#334155");
    b.box(doorX - 0.2, y0 + 1.05, z0 + 0.13, 0.38, 2.0, 0.02, "#CFEFFF", "glass");
    b.box(doorX + 0.2, y0 + 1.05, z0 + 0.13, 0.38, 2.0, 0.02, "#CFEFFF", "glass");
    b.box(doorX, y0 + 2.35, z0 + 0.14, 0.84, 0.14, 0.04, s.accent);
  }
  // tabela: renkli pano + beyaz parlak simge + "yazı" çubukları (metin yok, dile bağlı değil)
  const sw = Math.min(s.w - 0.3, 3.2);
  b.box(cx, sign.y, sign.z, sw, 0.44, 0.06, s.accent, "solid", 0.02);
  pixelIcon(b, ICONS[s.kind], cx - sw / 2 + 0.32, sign.y, sign.z + 0.04, "#FFFFFF", 0.07, "glow");
  b.box(cx + 0.2, sign.y + 0.06, sign.z + 0.04, sw - 0.95, 0.08, 0.02, "#FFFFFF", "glow");
  b.box(cx + 0.1, sign.y - 0.08, sign.z + 0.04, sw - 1.15, 0.06, 0.02, "#FFFFFF", "glow");
}

/** Tezgâh (ajan arkasında ayakta, kameraya bakar): (i, j)…(i+w-1, j); sağ ucunda yazar kasa / tablet (POS). */
function counter(b: Builder, i: number, j: number, w: number, body: string, stripe: string) {
  const x = tx(i) + (w - 1) / 2, z = tz(j);
  b.box(x, 0.45, z, w, 0.9, 0.8, body, "solid", 0.03);
  b.box(x, 0.93, z, w + 0.08, 0.06, 0.9, "#F8FAFC", "solid", 0.02);
  b.box(x, 0.55, z + 0.41, w - 0.3, 0.14, 0.03, stripe);
  for (let k = 0; k < w; k++) b.block(i + k, j);
  // POS: eğik tablet + kart okuyucu (ekran ajana, −z'ye bakar)
  const px = tx(i);
  b.box(px, 1.0, z, 0.08, 0.1, 0.08, "#374151");
  b.box(px, 1.12, z - 0.04, 0.44, 0.3, 0.05, "#1F2937");
  b.box(px, 1.12, z - 0.07, 0.38, 0.24, 0.02, "#7DD3FC", "glow");
  b.box(px + 0.35, 1.02, z + 0.15, 0.14, 0.08, 0.2, "#111827");
  b.box(px + 0.35, 1.07, z + 0.15, 0.08, 0.02, 0.06, "#34D399", "glow");
}

/** Alışveriş arabası (x, z dünya; burnu +z). */
function trolley(b: Builder, x: number, z: number, y = 0) {
  b.box(x, y + 0.62, z, 0.46, 0.34, 0.62, "#CBD5E1", "glass");
  b.box(x, y + 0.8, z, 0.5, 0.04, 0.66, "#94A3B8");
  b.box(x, y + 0.46, z, 0.44, 0.03, 0.6, "#94A3B8");
  b.box(x, y + 0.98, z - 0.36, 0.46, 0.06, 0.06, "#DC2626");
  for (const dx of [-0.2, 0.2]) b.box(x + dx, y + 0.9, z - 0.34, 0.04, 0.2, 0.04, "#DC2626"); // REAL-SUPPORT: tutamak sepete dikmelerle bağlı
  for (const dx of [-0.18, 0.18]) for (const dz of [-0.24, 0.24]) b.box(x + dx, y + 0.08, z + dz, 0.06, 0.16, 0.08, "#1F2937");
  // CORE-WALK (REAL-SUPPORT): tekerleklerden sepete dikmeler (sepet havada değil)
  for (const dx of [-0.18, 0.18]) for (const dz of [-0.24, 0.24]) b.box(x + dx, y + 0.3, z + dz, 0.03, 0.3, 0.03, "#94A3B8");
}

/** Atriyum fıskiyesi: 4×4 havuz, iki kademeli taş çanak ve su sütunu. */
function fountain(b: Builder, i0: number, j0: number) {
  for (let i = i0; i < i0 + 4; i++) for (let j = j0; j < j0 + 4; j++) {
    const rim = i === i0 || j === j0 || i === i0 + 3 || j === j0 + 3;
    if (rim) b.cube(i, j, 0, STONE, 0.5, "solid", 0.03);
    b.block(i, j);
  }
  const cx = tx(i0) + 1.5, cz = tz(j0) + 1.5;
  b.box(cx, 0.2, cz, 2, 0.3, 2, "#4FC3E8", "water", 0.03);
  b.box(cx, 0.75, cz, 0.5, 1.1, 0.5, "#E5DED2");
  b.box(cx, 1.38, cz, 1.2, 0.16, 1.2, STONE);
  b.box(cx, 1.48, cz, 1, 0.06, 1, "#7DD3FC", "water");
  b.box(cx, 1.95, cz, 0.18, 0.9, 0.18, "#CFF3FF", "glass");
  b.box(cx, 2.42, cz, 0.36, 0.1, 0.36, "#E0F7FF", "glass");
  for (const [dx, dz] of [[0.62, 0], [-0.62, 0], [0, 0.62], [0, -0.62]]) b.box(cx + dx, 0.85, cz + dz, dx ? 0.05 : 0.5, 1.05, dz ? 0.05 : 0.5, "#A5E3F7", "glass");
}

/** Bank (dinlenme): (i, j)–(i+1, j), sırtlık +z tarafında. */
function bench(b: Builder, i: number, j: number) {
  const x = tx(i) + 0.5, z = tz(j);
  for (const dx of [-0.8, 0.8]) b.box(x + dx, 0.2, z, 0.2, 0.4, 0.5, "#9CA3AF");
  b.box(x, 0.44, z, 2, 0.1, 0.55, "#B07D48", "solid", 0.03);
  b.box(x, 0.74, z + 0.26, 2, 0.5, 0.08, "#B07D48", "solid", 0.03); // REAL-SUPPORT: sırtlık oturağın üstünden başlar
  b.block(i, j); b.block(i + 1, j);
}

/** Yemek alanı masası: tabureler, tepsi; `parasol` yalnız açık havada. */
function foodTable(b: Builder, i: number, j: number, c: string, parasol = false) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.36, z, 0.14, 0.72, 0.14, "#6B7280");
  b.box(x, 0.75, z, 0.95, 0.06, 0.95, "#F8FAFC", "solid", 0.02);
  b.box(x - 0.18, 0.8, z, 0.34, 0.04, 0.26, "#F59E0B");
  b.box(x - 0.18, 0.86, z, 0.2, 0.1, 0.16, "#A16207");
  b.box(x + 0.22, 0.88, z + 0.1, 0.14, 0.2, 0.14, c);
  for (const dx of [-0.72, 0.72]) b.box(x + dx, 0.23, z, 0.34, 0.46, 0.34, c, "solid", 0.03);
  if (parasol) {
    b.box(x, 1.55, z, 0.07, 1.5, 0.07, "#E5E7EB");
    b.box(x, 2.3, z, 1.9, 0.12, 1.9, c, "solid", 0.02);
    b.box(x, 2.42, z, 1.2, 0.12, 1.2, STRIPE);
  }
  b.block(i, j);
}

/** Tavan sarkıt lambası (cam çatıdan inen kablo). */
function pendant(b: Builder, i: number, j: number, top = ROOF, post = false) {
  // REAL-SUPPORT: `post` (büyüme: cam çatı yok) kabloyu yerden yükselen kavisli dikmeye asar; çatılı tabanda kablo çatıdan iner
  if (post) b.armLamp(tx(i), tz(j) + 0.45, 0, tx(i), tz(j), 4.85, top, "#475569");
  else b.box(tx(i), (top + 4.85) / 2, tz(j), 0.04, top - 4.85, 0.04, "#475569");
  b.box(tx(i), 4.72, tz(j), 0.55, 0.26, 0.55, "#334155");
  b.box(tx(i), 4.56, tz(j), 0.36, 0.08, 0.36, "#FFF3C4", "glow");
}

/** Masaj koltuğu (uzanık dinlenme): sırtı +x tarafında, oturan −x'e bakar; engellemez. */
function massageChair(b: Builder, i: number, j: number) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.2, z, 0.8, 0.4, 0.7, "#1F2937", "solid", 0.02);
  b.box(x - 0.05, 0.44, z, 0.7, 0.1, 0.62, "#7C2D12", "solid", 0.03);
  for (let k = 0; k < 3; k++) b.box(x + 0.22 + k * 0.08, 0.62 + k * 0.2, z, 0.12, 0.24, 0.6, "#7C2D12", "solid", 0.03);
  for (const dz of [-0.36, 0.36]) b.box(x, 0.6, z + dz, 0.72, 0.18, 0.1, "#111827");
  b.box(x - 0.38, 0.22, z, 0.1, 0.4, 0.5, "#111827");
  b.box(x - 0.2, 0.71, z + 0.36, 0.14, 0.02, 0.08, "#34D399", "glow");
}

// ------------------------------------------------------------------------------------------ sahne
export function buildMall(): Built {
  const b = new Builder(23);
  b.ground((i, j) => {
    if (garage(i, j)) return (i + j) % 2 ? "#8B95A3" : "#838D9B";
    if (road(i, j)) return (i + j) % 2 ? "#3F4652" : "#434A57";
    if (street(i, j)) return (i + j) % 2 ? "#CFC8BC" : "#C4BCAF";
    if (i === 6) return "#B8AFA3";
    if (j <= 2) return (i + j) % 2 ? "#E8E1D5" : "#F4EFE7";
    if (staffRoom(i, j)) return (i + j) % 2 ? "#CBD5E1" : "#C3CCD8";
    if (foodcourt(i, j)) return (i + j) % 2 ? "#E9D3BF" : "#DDBFA5";
    if (atriumRing(i, j) && (i === 11 || i === 16 || j === 4 || j === 9)) return TEAL;
    return ((i >> 1) + (j >> 1)) % 2 ? FLOOR_A : FLOOR_B;
  }, UNDER, 0.03);

  // ---- arka cephe (iki kat + tabela bandı) ve sol duvar (otoparkla ortak)
  b.box((tx(6) + tx(23)) / 2, TOP / 2, tz(0), 18, TOP, 1, FACADE, "solid", 0.02);
  for (let i = 6; i <= 23; i++) b.block(i, 0);
  b.box(tx(6), TOP / 2, (tz(0) + tz(7)) / 2, 1, TOP, 8, "#E2DACB", "solid", 0.02);
  for (let j = 1; j <= 7; j++) b.block(6, j);
  b.box((tx(6) + tx(23)) / 2, TOP + 0.25, tz(0) + 0.1, 18.1, 0.5, 1.2, TEAL, "solid", 0.02);
  b.box((tx(6) + tx(23)) / 2, TOP + 0.25, tz(0) + 0.71, 17.6, 0.06, 0.02, "#FFF7E0", "glow");
  pixelIcon(b, BAG, tx(14.5), TOP - 0.45, tz(0) + 0.56, TEAL, 0.12);
  // otopark → galeri kapısı (1. kat), sol duvarda
  b.box(tx(6) + 0.52, L1 + 1.1, tz(1), 0.04, 2.1, 0.9, "#334155");
  b.box(tx(6) + 0.55, L1 + 1.05, tz(1), 0.02, 1.9, 0.76, "#CFEFFF", "glass");
  pixelIcon(b, P_SIGN, tx(6) + 0.56, L1 + 2.45, tz(1), "#2563EB", 0.08, "solid", "z");

  // ---- zemin kat mağazaları: cephe, tezgâh (istasyon: ayakta + tablet), vitrin
  for (const s of GROUND) {
    storefront(b, s, 0, { y: 2.88, z: tz(1) + 0.6 });
    const ci = s.i + (s.kind === "market" ? 1 : 0);
    counter(b, ci, 2, s.w >= 3 ? 2 : 1, s.facade, s.accent);
    b.station(ci, 1, UP, "stand", "tablet");
  }
  // süpermarket: manav tezgâhı + kasa bandı; önde alışveriş arabaları
  b.box(tx(7), 0.4, tz(2), 0.9, 0.8, 0.8, "#7C5A3A", "solid", 0.03);
  for (const [dx, dz, c] of [[-0.22, -0.2, "#DC2626"], [0.2, -0.2, "#65A30D"], [-0.22, 0.2, "#F59E0B"], [0.2, 0.2, "#FACC15"]] as [number, number, string][]) {
    b.box(tx(7) + dx, 0.88, tz(2) + dz, 0.36, 0.16, 0.34, c, "solid", 0.12);
  }
  b.block(7, 2);
  b.box(tx(8.5), 0.97, tz(2) + 0.1, 1.2, 0.03, 0.4, "#111827");
  for (const z of [tz(3) - 0.15, tz(3) + 0.15, tz(4)]) trolley(b, tx(7), z);
  b.block(7, 3); b.block(7, 4);
  // giyim: podyumda manken çifti
  b.box(tx(11), 0.08, tz(3), 0.9, 0.16, 0.9, "#F8FAFC", "solid", 0.02);
  for (const [dx, c] of [[-0.2, "#C73E72"], [0.2, "#0EA5E9"]] as [number, string][]) {
    b.box(tx(11) + dx, 0.6, tz(3), 0.06, 0.9, 0.06, "#6B7280");
    b.box(tx(11) + dx, 1.25, tz(3), 0.34, 0.55, 0.2, c);
    b.box(tx(11) + dx, 1.68, tz(3), 0.2, 0.22, 0.2, "#E5E7EB");
  }
  b.block(11, 3);
  // elektronik: duvarda TV duvarı zaten vitrinde; önde deneme terminali (kabuk)
  b.terminal(16, 3, "+z");
  // kitapçı: indirim masası (okuma)
  b.box(tx(17), 0.4, tz(3), 0.9, 0.8, 0.8, "#7B5236", "solid", 0.03);
  for (let k = 0; k < 6; k++) b.box(tx(17) - 0.3 + (k % 3) * 0.3, 0.84, tz(3) - 0.12 + Math.floor(k / 3) * 0.24, 0.24, 0.07, 0.18, // REAL-SUPPORT: kitaplar masa yüzeyinde (eskiden 2. sıra 0,1 havada)
    ["#EF4444", "#3B82F6", "#F59E0B", "#10B981", "#8B5CF6", "#F472B6"][k]);
  b.block(17, 3);

  // ---- 1. kat (galeri): döşeme, cam korkuluk, vitrinler, tabelalar
  slab(b, 7, 0, 16, 2, L1, "#E9E2D7", { lip: "#D6CCBC", glowLip: "#FFF3C4" });
  railing(b, "x", tz(1) + 0.46, tx(7) - 0.5, tx(18) + 0.5, L1);
  for (const s of UPPER) storefront(b, s, L1, { y: L1 + 2.45, z: tz(0) + 0.6 });
  // galerideki saksılar ve bir kafe-teras masası (görsel)
  for (const i of [9, 13, 16]) {
    b.box(tx(i), L1 + 0.22, tz(1) + 0.15, 0.6, 0.44, 0.5, "#E5DED2");
    b.box(tx(i), L1 + 0.6, tz(1) + 0.15, 0.55, 0.4, 0.45, "#3F8F4E", "solid", 0.12);
  }
  b.box(tx(20.5), L1 + 0.74, tz(1), 0.9, 0.06, 0.6, "#F8FAFC");
  b.box(tx(20.5), L1 + 0.37, tz(1), 0.1, 0.72, 0.1, "#6B7280");
  // yürüyen merdivenler (çıkış yeşil ok, iniş kehribar) + cam asansör
  escalator(b, 19, 2, 6, L1, "up");
  escalator(b, 21, 2, 6, L1, "down");
  elevator(b, 23, 1, 2, L1, { face: "+z", cabAt: 1 });
  // tuvaletler: galerinin ön kenarında asılı WC tabelası, merdivenlerin arkasında kapılar
  b.box(tx(21.5), 2.9, tz(1) + 0.58, 1.4, 0.44, 0.06, "#1E3A5F");
  pixelIcon(b, WC_M, tx(21.5) - 0.3, 2.9, tz(1) + 0.62, "#FFFFFF", 0.07, "glow");
  pixelIcon(b, WC_F, tx(21.5) + 0.05, 2.9, tz(1) + 0.62, "#FFFFFF", 0.07, "glow");
  b.box(tx(21.5) + 0.45, 2.9, tz(1) + 0.62, 0.2, 0.06, 0.02, "#FFFFFF", "glow");
  for (const i of [19, 22]) {
    b.box(tx(i), 1.1, tz(0) + 0.53, 0.8, 2.2, 0.05, "#64748B");
    pixelIcon(b, i === 19 ? WC_M : WC_F, tx(i), 1.75, tz(0) + 0.57, "#FFFFFF", 0.06);
  }

  // ---- cam çatı (atriyum): çevre kirişi, çelik kaburgalar, cam ve yükseltilmiş fener
  const rx0 = tx(6) - 0.5, rx1 = tx(23) + 0.5, rz0 = tz(0), rz1 = tz(6) + 0.5;
  const rxc = (rx0 + rx1) / 2, rzc = (rz0 + rz1) / 2;
  b.box(rxc, ROOF, rz1, rx1 - rx0, 0.2, 0.2, "#64748B");
  b.box(rx1, ROOF, rzc, 0.2, 0.2, rz1 - rz0, "#64748B");
  for (let x = rx0 + 1.5; x < rx1; x += 3) b.box(x, ROOF + 0.05, rzc, 0.1, 0.1, rz1 - rz0, "#94A3B8");
  b.box(rxc, ROOF, rzc, rx1 - rx0, 0.05, rz1 - rz0, "#CFEFFF", "glass");
  const lz0 = tz(1.5), lz1 = tz(4.5);
  b.box(rxc, ROOF + 0.9, (lz0 + lz1) / 2, rx1 - rx0 - 2, 0.05, lz1 - lz0, "#CFEFFF", "glass");
  for (const z of [lz0, lz1]) {
    b.box(rxc, ROOF + 0.45, z, rx1 - rx0 - 2, 0.9, 0.04, "#CFEFFF", "glass");
    b.box(rxc, ROOF + 0.92, z, rx1 - rx0 - 2, 0.08, 0.1, "#64748B");
  }
  b.box(rx1 - 0.15, ROOF / 2, rz1 - 0.15, 0.3, ROOF, 0.3, "#94A3B8", "solid", 0.02); // köşe dikmesi (karo kenarında, engellemez)
  for (const [i, j] of [[13, 3], [17, 5]] as [number, number][]) pendant(b, i, j);

  // ---- çok katlı otopark (sol-arka): zemin + 1. kat + çatı katı, merdiven kulesi, rampa
  for (let i = 0; i <= 5; i++) for (let j = 0; j <= 7; j++) b.block(i, j);
  const deckY = [L1, 5.6];
  for (const [ci, cj] of [[2, 3], [5, 3], [2, 7], [5, 7], [0, 7], [0, 3]] as [number, number][]) column(b, ci, cj, deckY[1], "#C9CED6", false, 0.34);
  parkingDeck(b, 0, 0, 6, 8, deckY[0], { rows: [1, 4] });
  parkingDeck(b, 0, 0, 6, 8, deckY[1], { rows: [1, 4], c: "#98A1AE" });
  for (const y of deckY) b.box(tx(2.5), y - 0.33, tz(7) + 0.4, 5.8, 0.04, 0.08, "#FFF3C4", "glow");
  for (const i of [1, 2, 3, 4, 5]) b.box(tx(i) - 0.5, 0.01, tz(1) + 0.5, 0.05, 0.02, 1.9, "#F8FAFC");
  for (const i of [1, 2, 3, 4, 5]) b.box(tx(i) - 0.5, 0.01, tz(4) + 0.5, 0.05, 0.02, 1.9, "#F8FAFC");
  const CARS = ["#E85D75", "#2F6FB3", "#F2B33D", "#3F8F4E", "#F8FAFC", "#8E6CEF", "#1F2937", "#DC2626"];
  for (const [i, j, k] of [[2, 1, 0], [3, 1, 1], [5, 1, 2], [0, 4, 3], [1, 4, 4], [3, 4, 5], [4, 4, 6]] as [number, number, number][]) car(b, i, j, CARS[k], 0, "-z");
  for (const [i, j, k] of [[2, 1, 7], [4, 1, 4], [5, 1, 1], [0, 4, 2], [2, 4, 0], [3, 4, 6], [5, 4, 3]] as [number, number, number][]) car(b, i, j, CARS[k], deckY[0], "-z");
  for (const [i, j, k] of [[3, 1, 5], [4, 1, 0], [1, 4, 1], [4, 4, 7]] as [number, number, number][]) car(b, i, j, CARS[k], deckY[1], "-z");
  tower(b, { i0: 0, j0: 0, w: 2, d: 1, floors: 2, h: 3.3, wall: "#C9CED6", trim: "#64748B", glass: "#A8D8F0", lit: WARM, door: 1, roof: "none" });
  // çatıda P tabelası ve aydınlatma direği
  b.box(tx(0.5), 7.6, tz(0), 0.14, 1.2, 0.14, "#64748B");
  b.box(tx(0.5), 8.3, tz(0) + 0.1, 1.1, 1.1, 0.1, "#2563EB");
  pixelIcon(b, P_SIGN, tx(0.5) + 0.05, 8.3, tz(0) + 0.17, "#FFFFFF", 0.16, "glow");
  b.box(tx(5), deckY[1] + 1.1, tz(7), 0.08, 2.2, 0.08, "#475569");
  b.box(tx(5), deckY[1] + 2.25, tz(7), 0.4, 0.14, 0.3, "#FFF3C4", "glow");
  b.hook("roof", 3, 6);
  // rampa: sokaktan 1. kata
  ramp(b, 0, 8, 11, deckY[0], 2);
  // zemin kat girişi: bilet makinesi + açık bariyer (dikey kol)
  b.box(tx(5), 0.6, tz(8), 0.6, 1.2, 0.5, "#F2B33D", "solid", 0.03);
  b.box(tx(5), 0.85, tz(8) + 0.26, 0.3, 0.2, 0.02, "#111827");
  b.box(tx(5), 0.86, tz(8) + 0.27, 0.22, 0.12, 0.02, "#34D399", "glow");
  for (let k = 0; k < 5; k++) b.box(tx(5) - 0.38, 1.35 + k * 0.4, tz(8), 0.1, 0.4, 0.1, k % 2 ? "#FFFFFF" : "#E11D48");
  b.block(5, 8);

  // ---- sokak: yol çizgisi, yaya geçidi, taksi durağı, otobüs durağı
  for (let i = 0; i <= 5; i++) b.box(tx(i), 0.012, tz(12) + 0.5, 0.5, 0.02, 0.08, "#F8FAFC");
  for (let k = 0; k < 4; k++) b.box(tx(5), 0.012, tz(12) - 0.35 + k * 0.45 + 0.1, 0.8, 0.02, 0.22, "#F8FAFC");
  car(b, 1, 12, "#FACC15", 0, "+x", true);
  b.block(1, 12); b.block(2, 12);
  // taksi tabelası: direk yürüme girişi kamera hattından uzakta, kaldırımın doğu ucunda
  b.box(tx(5), 1.1, tz(14), 0.08, 2.2, 0.08, "#64748B");
  b.box(tx(5), 2.15, tz(14) + 0.06, 0.6, 0.6, 0.06, "#FACC15");
  pixelIcon(b, TAXI, tx(5), 2.15, tz(14) + 0.1, "#111827", 0.09);
  b.block(5, 14);
  // otobüs durağı: cam arka, çatı, bank (dinlenme), ışıklı reklam panosu; direkte otobüs simgesi
  const sx = (tx(1) + tx(2)) / 2, sz = tz(15);
  b.box(sx, 1.05, sz + 0.38, 2, 2.1, 0.05, "#CFEFFF", "glass");
  b.box(sx, 2.15, sz, 2.2, 0.1, 1.0, "#334155");
  b.box(sx - 0.98, 1.05, sz + 0.38, 0.08, 2.1, 0.08, "#334155");
  b.box(sx, 0.42, sz + 0.2, 1.8, 0.08, 0.35, "#94A3B8");
  // doğu yan panel: çatıya kadar (direk yerine; yürüme girişi (3, 15) karesinde avatarın yanında dikey direk görünmesin —)
  b.box(sx + 0.98, 1.05, sz, 0.06, 2.1, 0.9, "#F8FAFC");
  b.box(sx + 1.0, 1.0, sz, 0.02, 1.0, 0.56, "#38BDF8", "glow");
  b.block(1, 15); b.block(2, 15);
  b.rest.push([1, 14], [2, 14]);
  b.box(tx(0), 1.25, tz(15), 0.08, 2.5, 0.08, "#64748B");
  b.box(tx(0), 2.3, tz(15) - 0.06, 0.6, 0.6, 0.06, "#16A34A");
  pixelIcon(b, BUS, tx(0), 2.3, tz(15) - 0.1, "#FFFFFF", 0.09);
  b.block(0, 15);

  // ---- ana giriş: cam cephe (i 6, j 8–15), otomatik kapı (j 10–11), saçak, tabela
  for (const [a, c] of [[8, 9], [12, 15]] as [number, number][]) {
    b.box(tx(6), 1.6, (tz(a) + tz(c)) / 2, 0.12, 3.2, c - a + 1, "#CFEFFF", "glass");
    for (let j = a; j <= c; j++) b.block(6, j);
  }
  for (let j = 8; j <= 16; j++) b.box(tx(6), 1.6, tz(j) - 0.5, 0.16, 3.2, 0.12, "#94A3B8");
  b.box(tx(6), 3.3, (tz(8) + tz(15)) / 2, 0.3, 0.2, 8, "#94A3B8");
  for (const z of [tz(10) - 0.32, tz(11) + 0.32]) b.box(tx(6), 1.1, z, 0.06, 2.2, 0.36, "#CFEFFF", "glass");
  slab(b, 4, 10, 2, 2, 3.5, TEAL, { t: 0.14, glowLip: "#FFF3C4" });
  for (const z of [tz(10) - 0.4, tz(11) + 0.4]) b.box(tx(4) - 0.4, 1.7, z, 0.08, 3.4, 0.08, "#94A3B8");
  b.box(tx(6) - 0.2, 3.8, tz(10.5), 0.1, 0.8, 1.6, TEAL); // REAL-SUPPORT: tabela saçak kirişine oturur
  pixelIcon(b, BAG, tx(6) - 0.26, 3.9, tz(10.5), "#FFFFFF", 0.1, "glow", "z");
  for (const [i, j] of [[5, 9], [5, 14], [4, 15]] as [number, number][]) planter(b, i, j, "#E5DED2", "#3F8F4E");

  // ---- atriyum: fıskiye, banklar (dinlenme), danışma masası, yön totemi
  fountain(b, 12, 5);
  bench(b, 12, 10); bench(b, 14, 10);
  b.rest.push([12, 9], [13, 9], [14, 9], [15, 9]);
  b.lights.push({ pos: [tx(13.5), 1.6, tz(6.5)], color: "#7DD3FC", intensity: 3, distance: 7 });
  // danışma: kavisli masa (iki istasyon: ayakta + masaüstü), "i" tabelalı direk
  const dx0 = (tx(9) + tx(10)) / 2, dz = tz(5);
  b.box(dx0, 0.5, dz, 2, 1.0, 0.8, "#F8FAFC", "solid", 0.03);
  b.box(dx0, 1.03, dz, 2.15, 0.06, 0.95, TEAL, "solid", 0.02);
  b.box(dx0, 0.5, dz + 0.42, 1.9, 0.2, 0.02, TEAL);
  for (const i of [9, 10]) b.monitor(i, 5, "-z", 0, -0.1, 1.06);
  b.block(9, 5); b.block(10, 5);
  b.station(9, 4, UP, "stand", "desktop"); b.station(10, 4, UP, "stand", "desktop");
  b.box(dx0 + 0.9, 1.9, dz + 0.3, 0.1, 1.8, 0.1, "#94A3B8");
  b.box(dx0 + 0.9, 2.9, dz + 0.3, 0.7, 0.7, 0.08, "#2563EB");
  pixelIcon(b, INFO, dx0 + 0.9, 2.9, dz + 0.36, "#FFFFFF", 0.12, "glow");
  // dijital yön totemi (web): ekranı −z'ye (ajana) bakar
  b.box(tx(11), 1.0, tz(5), 0.6, 2.0, 0.3, "#1F2937", "solid", 0.02);
  b.box(tx(11), 1.15, tz(5) - 0.16, 0.48, 1.3, 0.02, "#7DD3FC", "glow");
  b.box(tx(11), 2.05, tz(5), 0.6, 0.1, 0.32, TEAL);
  b.block(11, 5);

  // ---- ortak çalışma salonu: uzun masa (4 istasyon: sandalye + dizüstü), kanepe, tekerlekli beyaz tahta (plan)
  b.box((tx(7) + tx(10)) / 2, 0.74, tz(8), 4, 0.1, 0.9, "#C8A97E", "solid", 0.03);
  for (const x of [tx(7) - 0.35, tx(10) + 0.35]) b.box(x, 0.35, tz(8), 0.1, 0.7, 0.7, "#4B5563");
  for (let i = 7; i <= 10; i++) {
    b.block(i, 8);
    b.laptop(tx(i), 0.79, tz(8), "-z");
    b.station(i, 7, UP, "sit_chair", "laptop");
    b.chair(i, 7, "+z", "#334155");
  }
  b.box((tx(7) + tx(10)) / 2, 0.8, tz(8) + 0.3, 2.6, 0.03, 0.06, "#F2B33D", "glow");
  b.sofa(8, 10, "#5B7DB1", "#4A6A9C");
  b.rest.push([8, 9], [9, 9], [10, 9]);
  b.box(tx(11), 1.3, tz(8), 1.0, 1.0, 0.06, "#F8FAFC");
  for (const [c, w, y] of [["#3B82F6", 0.6, 1.5], ["#10B981", 0.4, 1.3], ["#EF4444", 0.5, 1.1]] as [string, number, number][]) b.box(tx(11) - 0.15 + w / 4, y, tz(8) + 0.04, w, 0.06, 0.02, c);
  b.box(tx(11), 0.4, tz(8), 0.06, 0.8, 0.06, "#64748B");
  b.box(tx(11), 0.05, tz(8), 0.7, 0.06, 0.4, "#64748B");
  b.block(11, 8);
  b.deskLamp(10, 8, "#FDE68A", 0.3, 0.25);

  // ---- kafe (atriyum sağı): masalar (3 istasyon), kahve barı (kahve molası noktası)
  for (const i of [17, 19, 21]) {
    b.box(tx(i), 0.35, tz(9), 0.15, 0.7, 0.15, "#3F3F46");
    b.box(tx(i), 0.74, tz(9), 0.95, 0.08, 0.95, "#8B5E3C", "solid", 0.03);
    b.block(i, 9);
    b.laptop(tx(i), 0.78, tz(9), "-z");
    b.box(tx(i) + 0.32, 0.86, tz(9) + 0.2, 0.14, 0.16, 0.14, "#FFFFFF");
    b.station(i, 8, UP, "sit_chair", "laptop");
    b.box(tx(i), 0.45, tz(10), 0.45, 0.08, 0.45, "#B45309"); b.box(tx(i), 0.22, tz(10), 0.08, 0.44, 0.08, "#3F3F46");
  }
  b.box(tx(23), 0.45, (tz(8) + tz(9)) / 2, 0.8, 0.9, 1.9, "#5B3A29", "solid", 0.03);
  b.box(tx(23), 0.93, (tz(8) + tz(9)) / 2, 0.9, 0.06, 2.0, "#2F2F2F");
  b.block(23, 8);
  b.coffeeMachine(23, 9, "-x", true);
  b.block(23, 9);
  b.box(tx(23) + 0.4, 2.2, (tz(8) + tz(9)) / 2, 0.06, 0.9, 1.8, "#1F3B2D");
  for (const dz of [-0.8, 0.8]) b.box(tx(23) + 0.4, 0.9, (tz(8) + tz(9)) / 2 + dz, 0.06, 1.8, 0.06, "#475569"); // REAL-SUPPORT: menü panosu ayaklı
  pixelIcon(b, ICONS.cafe, tx(23) + 0.36, 2.2, (tz(8) + tz(9)) / 2, "#FDE68A", 0.12, "solid", "z");

  // ---- masaj koltukları köşesi (dinlenme; HOTEL-SYS: uyku dinlenme odası geçidinde), asansörün önünde
  for (const j of [4, 5, 6]) massageChair(b, 23, j);

  // ---- yemek katı: iki büfe (istasyon: ayakta + tablet), menü panoları, masalar (plan)
  const KIOSK: [number, string, string][] = [[11, "#E85D3A", "#FDE68A"], [13, "#2E9E8F", "#86EFAC"]];
  for (const [j0, c, menu] of KIOSK) {
    const z = (tz(j0) + tz(j0 + 1)) / 2;
    b.box(tx(22), 0.45, z, 0.8, 0.9, 2, c, "solid", 0.03);
    b.box(tx(22), 0.93, z, 0.9, 0.06, 2.08, "#F8FAFC");
    b.box(tx(22) - 0.41, 0.55, z, 0.03, 0.14, 1.7, "#FFFFFF");
    b.box(tx(23) + 0.42, 1.5, z, 0.12, 3.0, 2, "#F4EFE7", "solid", 0.02);
    b.box(tx(23) + 0.35, 2.3, z, 0.04, 0.8, 1.8, "#111827");
    for (let k = 0; k < 3; k++) b.box(tx(23) + 0.32, 2.3, z - 0.6 + k * 0.6, 0.02, 0.6, 0.5, [menu, "#F87171", "#FFFFFF"][k], "glow");
    b.box((tx(22) + tx(23)) / 2, 3.05, z, 2.1, 0.14, 2.1, c, "solid", 0.02);
    pixelIcon(b, FORK, tx(22) - 0.56, 3.05, z, "#FFFFFF", 0.05, "solid", "z");
    b.box(tx(22), 1.12, tz(j0), 0.3, 0.3, 0.05, "#1F2937"); b.box(tx(22) - 0.03, 1.12, tz(j0), 0.02, 0.24, 0.04, "#7DD3FC", "glow");
    b.block(22, j0); b.block(22, j0 + 1);
    b.station(23, j0, LEFT, "stand", "tablet");
  }
  const TABLES: [number, number, string][] = [[16, 13, "#E85D3A"], [18, 13, "#2E9E8F"], [20, 13, "#D9920F"], [16, 15, "#2E9E8F"], [18, 15, "#D9920F"], [20, 15, "#E85D3A"]];
  for (const [i, j, c] of TABLES) foodTable(b, i, j, c);
  b.box(tx(15), 1.3, tz(14), 0.14, 2.6, 0.14, "#94A3B8");
  b.box(tx(15), 2.7, tz(14), 0.8, 0.8, 0.12, "#E85D3A");
  pixelIcon(b, FORK, tx(15), 2.7, tz(14) + 0.07, "#FFFFFF", 0.12, "glow");
  b.block(15, 14);
  b.lights.push({ pos: [tx(19), 3.4, tz(13)], color: "#FFD9A8", intensity: 4, distance: 10 });

  // ---- personel odası (alçak bölmeler, kapı j 12 / i 12): dolaplar (HOTEL-SYS: portatif yataklar kalktı)
  const wallC: Fence = { c: "#E2E8F0", h: 1.2, t: 0.16, cap: "#94A3B8" };
  fenceX(b, 12, 10, 14, [12], wallC);
  fenceZ(b, 10, 13, 15, [14], wallC); // (EXIT-FACE-001): batı bölmede ikinci geçit (j 14) — dinlenme kapısından çıkışın önü bölmeydi
  // doğu bölme kaldırıldı — personel odası yemek alanına açık; otel çıkışı açık yöne (doğu) bakar (kapı bölmeye bakınca kare %21 doluydu)
  b.box(tx(11), 1.0, tz(12) + 0.1, 0.9, 0.5, 0.04, "#475569");
  pixelIcon(b, STAFF, tx(11), 1.0, tz(12) + 0.13, "#FFFFFF", 0.07);
  // HOTEL-SYS (E1): görünür yatak yok — AVM'nin dinlenme odası kapısı (personel odasında, geçit (12, 14); içerisi ayrı dinlenme salonu)
  placeHotel(b, "mall", { at: [13, 14], w: 1, d: 2, door: [12, 14] });
  b.box(tx(12), 0.9, tz(15) + 0.1, 0.9, 1.8, 0.7, "#94A3B8", "solid", 0.02);
  for (const dx of [-0.22, 0.22]) b.box(tx(12) + dx, 0.9, tz(15) - 0.26, 0.4, 1.7, 0.02, "#64748B");
  b.block(12, 15);

  // ---- güvenlik masası (girişte): CCTV monitörleri (istasyon: sandalye + masaüstü), kabuk noktası
  b.desk(7, 13, 2, "#334155", "#1F2937", true);
  b.monitor(7, 13, "-z", 0, 0.12); b.monitor(8, 13, "-z", 0, 0.12);
  b.station(8, 12, UP, "sit_chair", "desktop");
  b.chair(8, 12, "+z");
  for (const dx of [-0.6, 0.6]) b.box(tx(7.5) + dx, 1.045, tz(13) + 0.38, 0.05, 0.51, 0.05, "#475569"); // REAL-SUPPORT: tabela masadan yükselen dikmelerde
  b.box(tx(7.5), 1.45, tz(13) + 0.38, 1.4, 0.3, 0.05, "#1E3A5F");
  b.box(tx(7.5), 1.45, tz(13) + 0.41, 1.2, 0.08, 0.02, "#FFFFFF", "glow");
  for (const i of [7, 8, 9]) trolley(b, tx(i), tz(15));
  b.block(7, 15); b.block(8, 15); b.block(9, 15);

  // ---- saksılar, lambalar
  for (const [i, j] of [[16, 6], [16, 11], [20, 11]] as [number, number][]) b.plant(i, j);

  // ---- araç noktaları
  b.spot("web", 11, 4, UP); b.spot("web", 15, 3, DOWN);
  b.spot("read", 18, 1, DOWN); b.spot("read", 17, 4, DOWN);
  b.spot("shell", 16, 4, DOWN); b.spot("shell", 7, 12, UP);
  b.spot("plan", 11, 9, DOWN); b.spot("plan", 16, 12, UP); b.spot("plan", 18, 12, UP);
  // yazma: girişte ayakta yazı masası (form/ziyaretçi defteri)
  b.box(tx(7), 0.55, tz(14), 0.12, 1.1, 0.12, "#64748B");
  b.box(tx(7), 1.1, tz(14), 0.6, 0.06, 0.8, "#C8A97E", "solid", 0.03);
  b.box(tx(7) + 0.05, 1.15, tz(14), 0.22, 0.02, 0.3, "#F8FAFC");
  b.block(7, 14);
  b.spot("write", 8, 14, LEFT);
  b.hook("window", 14, 0);

  b.lights.push({ pos: [tx(14), 6.2, tz(3)], color: "#FFF1DC", intensity: 6, distance: 18 });
  aquarium(b, 0, 13, "#334155"); // S45: yemek katı yanında akvaryum (AQUA-PREF-001)
  return b.done();
}

// ------------------------------------------------------------------ büyüme (S38/S42): mağaza kanatları, yemek katı, galeri, otopark
/** Mağaza kanadı cephe paleti (marka yok): cephe, vitrin içi. Tente ve tabela ekip renginde. */
const WING_FACADES: [string, string][] = [["#F3E3CF", "#FFF7E0"], ["#E3ECF6", "#EEF5FB"], ["#F7E4EC", "#FDF2F6"], ["#E4F2E1", "#F1F8EF"], ["#FFF2D1", "#FFF9E8"]];
const WING_KINDS: ShopKind[] = ["cloth", "book", "tech", "flower", "toy", "cafe", "sport", "deco"];
const KIT_COLORS = ["#B5543C", "#2F6FB3", "#C73E72", "#3F8F4E", "#D9920F", "#8E6CEF"];

/** Bölge arka cephesi (lj 1): iki dükkân (li 1–5, 7–11), ortada giriş (li 6); vitrin (web), kitap rafları (okuma), kampanya
 *  ekranı (plan); dükkânların üstünde ekip renginde tente ve piksel simgeli tabela; vitrinler gece yanar. */
function shopWing(x: Bay, awningC: string) {
  const { b, I, J } = x;
  const j = J(1), h = 3.2;
  const [fa, fb] = WING_FACADES[(x.variant + (x.i0 >> 3) + (x.j0 >> 4)) % WING_FACADES.length];
  const k0 = x.i0 + x.j0 + x.variant;
  const kinds = [WING_KINDS[k0 % WING_KINDS.length], WING_KINDS[(k0 + 3) % WING_KINDS.length]];
  fenceX(b, j, x.I(1), x.I(11), [2, 3, 4, 6, 8, 9, 10].map(I), { c: fa, h, t: 1 });
  // dükkân A: vitrin camı + teşhir (web)
  const ax = (tx(I(2)) + tx(I(4))) / 2;
  b.box(ax, 0.35, tz(j), 3, 0.7, 1, fa, "solid", 0.03);
  b.box(ax, 1.55, tz(j) - 0.1, 3, 1.7, 0.6, fb);
  windowDisplay(b, kinds[0], tx(I(2)) - 0.4, tx(I(4)) + 0.4, 0.7, tz(j) - 0.1, awningC);
  b.box(ax, 1.55, tz(j) + 0.42, 3, 1.7, 0.06, "#CFEFFF", "glass");
  litWindow(b, ax, 1.55, tz(j) + 0.46, "+z", 2.9, 1.6, WARM);
  b.box(ax, h - 0.25, tz(j), 3, 0.5, 1, fa, "solid", 0.03);
  for (const li of [2, 3, 4]) b.block(I(li), j);
  b.spot("web", I(3), J(2), DOWN); b.spot("web", I(4), J(2), DOWN);
  // giriş + tabela
  b.box(tx(I(6)), h - 0.3, tz(j), 1, 0.6, 1, fa, "solid", 0.03);
  wallSign(b, I(6), j, awningC, h - 0.05, 2.0);
  // dükkân B: raflar (okuma) + kampanya ekranı (plan)
  for (const li of [8, 9]) {
    b.box(tx(I(li)), 1.1, tz(j), 1, 2.2, 1, fb, "solid", 0.03);
    for (let k = 0; k < 3; k++) b.box(tx(I(li)) - 0.25 + k * 0.25, 0.6 + k * 0.5, tz(j) + 0.52, 0.18, 0.35, 0.04, ["#EF4444", "#3B82F6", "#F59E0B"][k]);
    b.block(I(li), j);
  }
  b.box((tx(I(8)) + tx(I(9))) / 2, h - 0.5, tz(j), 2, 1, 1, fa, "solid", 0.03);
  b.spot("read", I(8), J(2), DOWN); b.spot("read", I(9), J(2), DOWN);
  for (const dx of [-0.3, 0.3]) b.box(tx(I(10)) + dx, 0.475, tz(j) + 0.55, 0.05, 0.95, 0.05, "#475569"); // REAL-SUPPORT: kampanya ekranı ayaklı
  b.box(tx(I(10)), 1.5, tz(j) + 0.55, 0.85, 1.1, 0.06, "#111827"); b.box(tx(I(10)), 1.5, tz(j) + 0.59, 0.7, 0.9, 0.02, awningC, "glow");
  b.block(I(10), j); b.spot("plan", I(10), J(2), DOWN);
  // tenteler (ekip rengi / beyaz şerit) ve simgeli tabelalar
  for (const [a, c, kind] of [[1, 5, kinds[0]], [7, 11, kinds[1]]] as [number, number, ShopKind][]) {
    const n = (c - a + 1) * 2;
    for (let k = 0; k < n; k++) {
      const xx = tx(I(a)) - 0.25 + k * 0.5, cc = k % 2 ? STRIPE : awningC;
      b.box(xx, 2.5, tz(j) + 0.74, 0.5, 0.1, 0.48, cc, "solid", 0.02);
      b.box(xx, 2.38, tz(j) + 1.0, 0.5, k % 2 ? 0.14 : 0.2, 0.05, cc);
    }
    const sx = (tx(I(a)) + tx(I(c))) / 2 - 0.9;
    b.box(sx, h + 0.35, tz(j) + 0.5, 0.8, 0.75, 0.06, "#FFFFFF");
    pixelIcon(b, ICONS[kind], sx, h + 0.35, tz(j) + 0.55, awningC, 0.13);
  }
  x.sign = [tx(I(6)), h + 0.75, tz(j) + 0.6];
}

/** Kiosk tezgâhı (pod koltuğu): ajan tarafına bakan dizüstü + yazar kasa; tezgâh şeridi sırayla mağaza renklerinden. */
function mallSeat(b: Builder, i: number, j: number, face: "+z" | "-z", n: number) {
  const user = face === "+z" ? "-z" : "+z", dz = face === "+z" ? -1 : 1;
  const x = tx(i) + 0.5, z = tz(j);
  b.box(x, 0.45, z, 2, 0.9, 0.8, "#F4EFE7", "solid", 0.03);
  b.box(x, 0.93, z, 2.1, 0.06, 0.92, "#F8FAFC", "solid", 0.02);
  b.box(x, 0.55, z + dz * 0.41, 1.7, 0.14, 0.03, KIT_COLORS[n % KIT_COLORS.length]);
  b.block(i, j); b.block(i + 1, j);
  b.laptop(tx(i), 0.96, z, user);
  b.box(tx(i + 1), 1.08, z, 0.3, 0.22, 0.24, "#374151");
  b.box(tx(i + 1), 1.13, z + dz * 0.13, 0.2, 0.08, 0.02, "#34D399", "glow");
}

/** Bank + önündeki dinlenme karoları. */
function seatBench(b: Builder, i: number, j: number) {
  bench(b, i, j);
  b.rest.push([i, j - 1], [i + 1, j - 1]);
}

/** Dinlenme şezlongu (yer minderi + yastık): karoyu engellemez; uyku noktası. Başı `head` yönünde. */
function lounger(b: Builder, i: number, j: number, c: string, head: Dir = "-z") {
  const x = tx(i), z = tz(j), alongZ = head[1] === "z", s = head[0] === "-" ? -1 : 1;
  b.box(x, 0.1, z, alongZ ? 0.7 : 0.9, 0.2, alongZ ? 0.9 : 0.7, c, "solid", 0.03);
  b.box(x + (alongZ ? 0 : s * 0.3), 0.25, z + (alongZ ? s * 0.3 : 0), alongZ ? 0.6 : 0.24, 0.12, alongZ ? 0.24 : 0.6, "#F8FAFC");
}

/** Personel dinlenme köşesi (ekip kanadı, lj 13–14 li 6–9): 8 minder (uyku noktası, başları −z). */
function staffLounge(x: Bay) {
  const { b, I, J } = x;
  const cs = ["#93C5FD", "#F9A8D4", "#86EFAC", "#FDE68A"];
  for (const lj of [13, 14]) for (let li = 6; li <= 9; li++) {
    lounger(b, I(li), J(lj), cs[(li + lj) % cs.length]); // HOTEL-SYS: oturma minderi (uyku otel geçidinde)
  }
}

export function mallTheme(): Theme {
  const side: Fence = { c: "#CFEFFF", h: 1.6, t: 0.08, g: "glass", cap: TEAL };
  const sides = (x: Bay, front = true) => {
    const { b, I, J } = x;
    fenceZ(b, I(1), J(2), J(15), [2, 7, 12].map(J), side);
    if (front) for (const li of [2, 3, 4, 8, 9, 10]) planter(b, I(li), J(15), "#E5DED2", "#3F8F4E");
  };
  const foodcourtAm: Amenity = {
    label: "dist_foodcourt",
    floor: (li, lj) => (lj <= 3 ? ((li + lj) % 2 ? "#E8E1D5" : "#F4EFE7") : lj === 8 || lj === 12 ? "#E85D3A" : ((li >> 1) + (lj >> 1)) % 2 ? "#E9D3BF" : "#DDBFA5"),
    build: (x) => {
      const { b, I, J } = x;
      fenceX(b, J(1), I(1), I(11), [I(6)], { c: "#F3E3CF", h: 3.2, t: 1 });
      for (const [li, lj] of [[2, 5], [7, 5], [2, 9], [7, 9]] as [number, number][]) rugM(b, I(li), J(lj), 3, 3, "#F6E1C8");
      for (const li of [2, 10]) planter(b, I(li), J(11), "#E5DED2", "#3F8F4E");
      b.box(tx(I(6)), 2.9, tz(J(1)), 1, 0.6, 1, "#F3E3CF");
      for (const [li, c] of [[2, "#E85D3A"], [8, "#2E9E8F"]] as [number, string][]) {
        b.box(tx(I(li)) + 1, 2.4, tz(J(1)) + 0.53, 3, 0.9, 0.06, c);
        for (let k = 0; k < 3; k++) b.box(tx(I(li)) + k, 2.4, tz(J(1)) + 0.58, 0.6, 0.5, 0.02, ["#FDE68A", "#F87171", "#86EFAC"][k], "glow");
        counter(b, I(li), J(2), 2, "#F8FAFC", c);
      }
      b.coffeeMachine(I(3), J(2), "+z", true);
      b.coffeeMachine(I(9), J(2), "+z", true);
      wallSign(b, I(6), J(1), "#E85D3A", 3.15, 2.0);
      x.sign = [tx(I(6)), 3.9, tz(J(1)) + 0.6];
      for (const [li, lj, c] of [[3, 6, "#E85D3A"], [6, 6, "#2E9E8F"], [9, 6, "#D9920F"], [3, 10, "#2E9E8F"], [9, 10, "#E85D3A"]] as [number, number, string][]) foodTable(b, I(li), J(lj), c);
      b.spot("plan", I(6), J(10), DOWN);
      sides(x, false);
      // dinlenme: masaj koltukları (oturma; HOTEL-SYS: uyku geçitte) — ön sırada
      for (const li of [3, 4, 8, 9]) massageChair(b, I(li), J(13));
      seatBench(b, I(4), J(15)); seatBench(b, I(6), J(15));
      planter(b, I(9), J(15), "#E5DED2", "#3F8F4E"); planter(b, I(10), J(15), "#E5DED2", "#3F8F4E");
      for (const [li, lj] of [[4, 8], [8, 8]] as [number, number][]) pendant(b, I(li), J(lj), 5.0, true);
    },
  };
  const gallery: Amenity = {
    label: "dist_gallery",
    floor: (li, lj) => (lj <= 3 ? ((li + lj) % 2 ? "#DCD3C6" : "#E9E2D7") : ((li >> 1) + (lj >> 1)) % 2 ? FLOOR_A : FLOOR_B),
    build: (x) => {
      const { b, I, J } = x;
      // asma kat (galeri): arka boyunca döşeme + cam korkuluk + üst vitrinler (yanan); altından yürünür (yalnız sütunlar engeller)
      const cx = (tx(I(1)) + tx(I(11))) / 2;
      fenceX(b, J(1), I(1), I(11), [], { c: "#E2DCD1", h: 5.6, t: 1 });
      slab(b, I(1), J(1), 11, 2, L1, "#E9E2D7", { lip: "#D6CCBC", glowLip: "#FFF3C4" });
      railing(b, "x", tz(J(2)) + 0.46, tx(I(1)) - 0.5, tx(I(8)) + 0.5, L1);
      const ups: ShopKind[] = ["cinema", "toy", "deco"];
      [[1, 4], [5, 3], [8, 4]].forEach(([li, w], k) => {
        const s: Shop = { i: I(li), w, kind: ups[(k + x.variant) % ups.length], facade: WING_FACADES[k][0], accent: KIT_COLORS[(k + x.variant) % KIT_COLORS.length] };
        storefront(b, s, L1, { y: L1 + 2.45, z: tz(J(1)) + 0.6 }, tz(J(1)) + 0.5);
        storefront(b, { ...s, kind: WING_KINDS[(k * 3 + x.variant + 1) % WING_KINDS.length], facade: WING_FACADES[(k + 2) % WING_FACADES.length][0] },
          0, { y: 2.88, z: tz(J(2)) + 0.6 }, tz(J(1)) + 0.5);
      });
      for (const li of [4, 8]) column(b, I(li), J(2), L1 - 0.25, "#E2E8F0");
      b.spot("web", I(5), J(2), DOWN); b.spot("read", I(7), J(2), DOWN);
      escalator(b, I(9), J(3), J(7), L1, "up");
      elevator(b, I(11), J(2), 2, L1, { face: "-x", cabAt: 0 });
      fountain(b, I(3), J(7));
      rugM(b, I(2), J(11), 8, 1, "#B9DCD8"); rugM(b, I(7), J(7), 2, 4, "#E3DCD0");
      seatBench(b, I(3), J(12)); seatBench(b, I(6), J(12));
      cartKiosk(b, I(7), J(14), "#8E6CEF");
      b.props.push({ k: "coffee", p: [tx(I(7)), 0, tz(J(14))], r: Math.PI, tile: [I(7), J(13)] });
      // dinlenme kanepeleri (oturma; HOTEL-SYS: uyku geçitte)
      for (const li of [2, 3, 4, 5]) lounger(b, I(li), J(14), "#93C5FD", "-x");
      sides(x, false);
      x.sign = [cx, L1 + 3.6, tz(J(1)) + 0.8];
    },
  };
  // dinlenme salonu (yatakhane olanağı): 16 uyku kapsülü + masaj koltukları + çay/kahve
  const restLounge: Amenity = {
    label: "dist_restlounge",
    floor: (li, lj) => (lj <= 1 ? "#E3DCD0" : lj === 5 || lj === 11 ? "#A5B4FC" : ((li + lj) % 2 ? "#CBD5E1" : "#C3CCD8")),
    build: (x) => {
      const { b, I, J } = x;
      fenceX(b, J(1), I(1), I(11), [I(6)], { c: "#E2E8F0", h: 3.2, t: 1 });
      // sessiz halılar (kapsül sıralarının önü) + bitki şeridi
      for (const lj of [2, 4, 8, 10]) { rugM(b, I(2), J(lj), 4, 1, "#C7D2FE"); rugM(b, I(7), J(lj), 4, 1, "#C7D2FE"); }
      for (const li of [2, 3, 4, 5, 7, 8, 9, 10]) planter(b, I(li), J(6), "#E5DED2", "#3F8F4E");
      rugM(b, I(2), J(14), 3, 2, "#DDD6FE");
      b.box(tx(I(6)), 2.9, tz(J(1)), 1, 0.6, 1, "#E2E8F0");
      wallSign(b, I(6), J(1), "#6366F1", 2.55, 2.0);
      x.sign = [tx(I(6)), 3.6, tz(J(1)) + 0.6];
      sides(x, false);
      const cs = ["#93C5FD", "#C4B5FD", "#99F6E4", "#FBCFE8"];
      for (const lj of [3, 9]) for (const li of [2, 3, 4, 5, 7, 8, 9, 10]) {
        const i = I(li), j = J(lj), xx = tx(i), zz = tz(j);
        b.box(xx, 0.2, zz, 0.86, 0.4, 0.96, "#F8FAFC", "solid", 0.02);
        b.box(xx, 0.44, zz + 0.1, 0.8, 0.06, 0.7, cs[(li + lj + x.variant) % cs.length], "solid", 0.03);
        b.box(xx, 0.46, zz - 0.33, 0.5, 0.08, 0.2, "#FFFFFF");
        b.box(xx, 1.0, zz, 0.9, 0.06, 1.0, "#E2E8F0", "solid", 0.02);
        for (const dx of [-0.43, 0.43]) b.box(xx + dx, 0.72, zz, 0.04, 0.56, 0.96, "#CFEFFF", "glass");
        b.box(xx, 0.9, zz - 0.4, 0.2, 0.06, 0.06, "#FFF3C4", "glow");
        b.sleep(i, j, DOWN, "bed", 0.48);
      }
      for (const li of [2, 3, 9, 10]) { massageChair(b, I(li), J(13)); b.sleep(I(li), J(13), RIGHT, "lounger", 0.5); }
      b.coffeeMachine(I(5), J(14), "+z");
      planter(b, I(4), J(14), "#E5DED2", "#3F8F4E");
      b.lamp(I(7), J(14), "#C7D2FE");
    },
  };
  return {
    hq: "dist_mall_hq", trim: TEAL, under: UNDER,
    // pod koltuğu = kiosk tezgâhı: ayakta, dizüstü
    pose: "stand", device: "laptop",
    // koridorlar (lj 7/12, li 6): turkuaz damarlı taş şerit
    aisle: (li, lj) => ((li + lj) % 3 ? "#CFE6E3" : "#B9DCD8"),
    path: (li, lj) => (li === 0 && lj % 4 === 0 ? TEAL : (li + lj) % 2 ? "#E8E1D5" : "#F4EFE7"),
    floor: (li, lj) => (((li >> 1) + (lj >> 1)) % 2 ? FLOOR_A : FLOOR_B),
    work: (x) => {
      shopWing(x, x.color);
      sides(x);
      teamCorner(x, (bb, i, j) => seatBench(bb, i, j));
      staffLounge(x);
    },
    seat: mallSeat,
    pod: (x, pi, pj) => {
      const { b } = x;
      rugM(b, x.I(pi), x.J(pj + 1), 4, 2, "#E3DCD0", 0.006);
      const cx = (tx(x.I(pi)) + tx(x.I(pi + 3))) / 2, cz = (tz(x.J(pj + 1)) + tz(x.J(pj + 2))) / 2;
      for (let k = 0; k < 8; k++) b.box(cx - 1.75 + k * 0.5, 2.6, cz, 0.5, 0.1, 1.2, k % 2 ? STRIPE : x.color, "solid", 0.02);
      for (const dx of [-1.9, 1.9]) b.box(cx + dx, 1.8, cz, 0.08, 1.6, 0.08, "#94A3B8");
    },
    spare: (x, pi, pj, slot) => {
      const { b } = x;
      const i = x.I(pi), j = x.J(pj);
      if (slot % 2 === 0) {
        // pop-up vitrin: platform + mankenler
        b.box((tx(i + 1) + tx(i + 2)) / 2, 0.1, (tz(j + 1) + tz(j + 2)) / 2, 1.9, 0.2, 1.9, "#F8FAFC", "solid", 0.02);
        for (const [di, dj, c] of [[1, 1, x.color], [2, 2, "#60A5FA"], [2, 1, "#FDE68A"]] as [number, number, string][]) {
          b.box(tx(i + di), 0.75, tz(j + dj), 0.08, 1.1, 0.08, "#6B7280"); b.box(tx(i + di), 1.3, tz(j + dj), 0.5, 0.55, 0.3, c);
          b.box(tx(i + di), 1.75, tz(j + dj), 0.28, 0.28, 0.28, "#E5E7EB");
        }
        for (const di of [1, 2]) for (const dj of [1, 2]) b.block(i + di, j + dj);
        b.spot("web", i + 1, j + 3, UP);
      } else {
        seatBench(b, i + 1, j + 2);
        planter(b, i, j + 3, "#E5DED2", "#3F8F4E"); planter(b, i + 3, j + 3, "#E5DED2", "#3F8F4E");
        for (const [di, k] of [[1, 0], [2, 1]] as [number, number][]) trolley(b, tx(i + di), tz(j) + 0.1 * k);
        b.block(i + 1, j); b.block(i + 2, j);
      }
    },
    amenities: [foodcourtAm, gallery, restLounge],
    yard: {
      label: "dist_parking",
      floor: (li, lj) => (lj >= 12 ? ((li + lj) % 2 ? "#3F4652" : "#434A57") : (li + lj) % 2 ? "#8B95A3" : "#838D9B"),
      build: (x) => {
        // İKİ KATLI otopark: zemin sıraları + üstte park katı (sütunlu) + sokaktan rampa; önde yol ve ödeme makinesi
        const { b, I, J } = x;
        const cars = ["#E85D75", "#2F6FB3", "#F2B33D", "#3F8F4E", "#F8FAFC", "#8E6CEF", "#1F2937"];
        const deck = 3;
        for (let li = 3; li <= 11; li++) for (let lj = 2; lj <= 10; lj++) b.block(I(li), J(lj));
        for (const li of [3, 7, 11]) for (const lj of [2, 6, 10]) column(b, I(li), J(lj), deck, "#C9CED6", false, 0.32);
        parkingDeck(b, I(3), J(2), 9, 9, deck, { rows: [1, 5] });
        b.box((tx(I(3)) + tx(I(11))) / 2, deck - 0.33, tz(J(10)) + 0.4, 8.8, 0.04, 0.08, "#FFF3C4", "glow");
        for (let li = 4; li <= 11; li++) for (const lj of [3, 7]) {
          b.box(tx(I(li)) - 0.5, 0.01, tz(J(lj)) + 0.5, 0.05, 0.02, 1.9, "#F8FAFC");
          if ((li + lj + x.i0 + x.variant) % 3) car(b, I(li), J(lj), cars[(li * 2 + lj + x.j0) % cars.length], 0, "-z");
          if ((li + lj + x.j0) % 4) car(b, I(li), J(lj), cars[(li + lj * 3 + x.i0) % cars.length], deck, "-z");
        }
        ramp(b, I(1), J(3), J(10), deck, 2);
        for (let li = 1; li <= 11; li++) b.box(tx(I(li)), 0.012, tz(J(13)), 0.5, 0.02, 0.08, "#F8FAFC");
        b.box(tx(I(10)), 1.3, tz(J(11)), 0.12, 2.6, 0.12, "#94A3B8");
        b.box(tx(I(10)), 2.75, tz(J(11)) + 0.08, 0.9, 0.9, 0.08, "#2563EB");
        pixelIcon(b, P_SIGN, tx(I(10)), 2.75, tz(J(11)) + 0.13, "#FFFFFF", 0.15, "glow");
        b.block(I(10), J(11));
        breakSpot(b, I(5), J(11)); b.box(tx(I(5)), 0.9, tz(J(11)), 0.8, 1.8, 0.6, "#E85D3A", "solid", 0.03);
        b.box(tx(I(5)), 1.2, tz(J(11)) + 0.31, 0.5, 0.8, 0.02, "#CFEFFF", "glass"); b.block(I(5), J(11));
        x.sign = [tx(I(10)), 3.5, tz(J(11))];
      },
    },
    row0: (x) => {
      const { b, I, J } = x;
      fenceX(b, J(0), I(0), I(11), [], { c: "#E3DCD0", h: 4, t: 1 });
      b.box((tx(I(0)) + tx(I(11))) / 2, 4.06, tz(J(0)) + 0.3, 12, 0.12, 0.4, "#FFF7E0", "glow");
    },
  };
}

/** Pasaj arabası (galeri olanağı): tekerlekli tezgâh + çizgili kanopi; kahve noktası. */
function cartKiosk(b: Builder, i: number, j: number, color: string) {
  const x = tx(i) + 0.5, z = tz(j);
  b.box(x, 0.5, z, 1.9, 0.8, 0.8, color, "solid", 0.03);
  b.box(x, 0.93, z, 2, 0.06, 0.9, "#F8FAFC", "solid", 0.02);
  for (const dx of [-0.75, 0.75]) b.box(x + dx, 0.07, z + 0.3, 0.18, 0.14, 0.14, "#1F2937");
  for (const dx of [-0.95, 0.95]) b.box(x + dx, 1.6, z + 0.35, 0.07, 1.4, 0.07, "#94A3B8");
  for (let k = 0; k < 4; k++) b.box(x - 0.75 + k * 0.5, 2.33, z - 0.05, 0.5, 0.1, 1.2, k % 2 ? STRIPE : color, "solid", 0.02);
  b.block(i, j); b.block(i + 1, j);
}
