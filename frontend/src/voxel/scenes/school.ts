/**
 * Okul — S42. Ücretsiz (her zaman açık) başlangıç sahnesi. Gerçek bir okulun okunur parçaları:
 *
 * - Arka: İKİ KATLI blok (voxel/buildings.ts): zemin katta sınıf (yazı tahtası, öğretmen masası, öğrenci sıraları),
 * bilgisayar laboratuvarı (masaüstü bilgisayarlar, akıllı tahta, sunucu dolabı), kütüphane (raflar, katalog bilgisayarları,
 * armut koltuklar) ve fen laboratuvarı (deney tezgâhı, çeker ocak, periyodik tablo, iskelet modeli). Üst kat: cam korkuluklu
 * açık koridor (balkon), sınıf kapıları ve gece yanan pencereler; solda balkona çıkan merdiven; çatıda saat ve okul zili.
 * - Ortada: dolaplı koridor (renkli öğrenci dolapları, sınıf kapıları).
 * - Önde: öğretmenler odası (toplantı masası, kahve makinesi, kanepe), revir (portatif yataklar, ecza dolabı, kızılay işareti),
 * yemekhane (servis tezgâhı, uzun masalar ve banklar), spor salonu (ahşap zemin, duvar barı, minder, pota, atlama sandığı) ve
 * okul bahçesi (basketbol yarım sahası, bayrak direği, okul servisi durağı ve sarı servis otobüsü).
 *
 * Mantık: istasyonlar — sınıf sıraları ve öğretmen masası (sandalye, dizüstü), bilgisayar laboratuvarı ve
 * kütüphane katalogları (sandalye, masaüstü), öğretmenler odası masası (sandalye, dizüstü). Uyku: revir yatakları, öğretmenler
 * odası kanepesi, kütüphane armut koltukları. Araç noktaları: akıllı tahta = web, kütüphane rafları = okuma, fen tezgâhı ve
 * sunucu dolabı = kabuk, yazı tahtası ve öğretmenler masası = plan.
 *
 * Yürünebilirlik (a): üst kat yalnızca görseldir; bütün istasyon ve noktalar zemin katta.
 * Kayıt notu: `ground` ilk çağrıdır; yalnızca fonksiyon bildirimleri dışa aktarılır (scenes.ts ile döngüsel içe aktarma).
 *
 * Büyüme (`schoolTheme`): ekip başına İKİ KATLI derslik kanadı (yazı tahtası, raflar, pencereler, üst kat + balkon, dinlenme
 * minderleri), olanaklar spor sahası (çim, kale, tribün) ve konferans salonu (sahne, perde, koltuk sıraları, fuaye), boş
 * parseller oyun bahçesi (kaydırak, salıncak, kum havuzu, servis otobüsü).
*/
import { Builder, tx, tz, type Built } from "../scenes";
import { aquarium, bench, bookshelf, fenceX, fenceZ, planter, rug, type Fence } from "../districts/parts";
import { breakSpot, indoorBack, indoorSides, teamCorner, type Amenity, type Bay, type IndoorStyle, type Theme } from "../districts/themes";
import { placeHotel } from "../districts/hotel";
import { pixelIcon, railing, slab, STOREY, stairs, windows } from "../buildings";
import { noteObject } from "../rules/hooks";

const UP = 0, DOWN = Math.PI, LEFT = -Math.PI / 2;

const CREAM = "#F2E3C6";
const BRICK = "#C8553D";
const TRIM = "#8C3B2A";
const UNDER = "#8B6B4A";
const WARM = "#FFD98A";
const LOCKERS = ["#3B82F6", "#14B8A6", "#F59E0B", "#EF4444", "#8B5CF6"];
/** Üst kat balkon döşemesi. */
const L1 = STOREY;
const TOP = 6.4;

const CROSS = ["..#..", "..#..", "#####", "..#..", "..#.."];
const BUS = ["#####", "#.#.#", "#####", "#####", ".#.#."];
const NOTE = ["..##.", "..#.#", "..#..", "###..", "##..."];
const PALETTE = [".###.", "#.#.#", "#####", "##...", ".###."];
const BOOK = ["#...#", "##.##", "##.##", "##.##", "#####"];

// ------------------------------------------------------------------------------------------ zemin bölgeleri
const classroom = (i: number, j: number) => i >= 1 && i <= 7 && j >= 1 && j <= 5;
const complab = (i: number, j: number) => i >= 9 && i <= 12 && j >= 1 && j <= 5;
const library = (i: number, j: number) => i >= 14 && i <= 17 && j >= 1 && j <= 5;
const science = (i: number, j: number) => i >= 19 && j >= 1 && j <= 5;
const teachers = (i: number, j: number) => i <= 4 && j >= 8 && j <= 10;
const nurse = (i: number, j: number) => i <= 4 && j >= 12;
const cafeteria = (i: number, j: number) => i >= 6 && i <= 11 && j >= 8;
const gym = (i: number, j: number) => i >= 13 && i <= 16 && j >= 9;
const court = (i: number, j: number) => i >= 18 && j >= 8 && j <= 12;
const yard = (i: number, j: number) => i >= 18 && j >= 8;

// ------------------------------------------------------------------------------------------ parçalar
/** Öğrenci sırası (tek kişilik): metal ayak, ahşap üst, üstünde dizüstü (kullanıcı `user` tarafında) + defter. Engeller. */
function studentDesk(b: Builder, i: number, j: number, user: "+z" | "-z", laptop = true) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.68, z, 0.86, 0.06, 0.62, "#D6A86C", "solid", 0.03);
  for (const dx of [-0.36, 0.36]) b.box(x + dx, 0.33, z, 0.05, 0.66, 0.5, "#64748B");
  b.box(x, 0.45, z + (user === "+z" ? -0.22 : 0.22), 0.76, 0.2, 0.04, "#94A3B8");
  if (laptop) b.laptop(x - 0.1, 0.71, z, user);
  b.box(x + 0.3, 0.72, z + (user === "+z" ? 0.12 : -0.12), 0.18, 0.02, 0.24, "#F8FAFC");
  b.block(i, j);
}

/** Yazı tahtası (arka duvarın ön yüzünde): koyu yeşil, ahşap çerçeve, tebeşir yazıları, tebeşirlik. */
function blackboard(b: Builder, i0: number, w: number, zFace: number, y = 1.7) {
  const x = tx(i0) + (w - 1) / 2;
  b.box(x, y, zFace + 0.03, w + 0.16, 1.32, 0.05, "#8B5E3C");
  b.box(x, y, zFace + 0.06, w, 1.16, 0.03, "#1F4D3A");
  for (const [dx, dy, l] of [[-0.3, 0.35, 0.45], [-0.15, 0.15, 0.6], [-0.25, -0.05, 0.5], [0.2, -0.25, 0.35]] as [number, number, number][]) {
    b.box(x + dx * w, y + dy, zFace + 0.08, l * w * 0.5, 0.05, 0.01, "#E5E7EB");
  }
  b.box(x + w * 0.32, y + 0.2, zFace + 0.08, 0.36, 0.36, 0.01, "#E5E7EB");
  b.box(x, y - 0.64, zFace + 0.12, w, 0.05, 0.14, "#8B5E3C");
  b.box(x - w * 0.3, y - 0.59, zFace + 0.13, 0.12, 0.04, 0.03, "#F8FAFC");
  b.box(x + w * 0.2, y - 0.58, zFace + 0.13, 0.22, 0.06, 0.08, "#475569");
}

/** Öğrenci dolapları (karo başına iki dolap, ön yüz +z): havalandırma çizgileri, kulp. Engeller. */
function lockers(b: Builder, i: number, j: number, h = 1.45) {
  const x = tx(i), z = tz(j);
  b.box(x, h / 2, z, 0.98, h, 0.7, "#475569", "solid", 0.02);
  for (const [dx, k] of [[-0.245, 0], [0.245, 1]] as [number, number][]) {
    const c = LOCKERS[(i * 2 + k) % LOCKERS.length];
    b.box(x + dx, h / 2 + 0.02, z + 0.36, 0.44, h - 0.1, 0.03, c, "solid", 0.03);
    for (let v = 0; v < 3; v++) b.box(x + dx, h - 0.22 - v * 0.07, z + 0.38, 0.26, 0.025, 0.01, "#1F2937");
    b.box(x + dx + 0.14, h / 2, z + 0.385, 0.04, 0.14, 0.02, "#E5E7EB");
  }
  b.block(i, j);
}

/** Fen tezgâhı (i0…i1, j): beyaz dolap, siyah tezgâh, lavabo + musluk, renkli deney şişeleri, mikroskop, ispirto ocağı. */
function labBench(b: Builder, i0: number, i1: number, j: number) {
  const x = (tx(i0) + tx(i1)) / 2, w = i1 - i0 + 1, z = tz(j);
  b.box(x, 0.42, z, w, 0.84, 0.9, "#F1F5F9", "solid", 0.02);
  b.box(x, 0.87, z, w + 0.06, 0.06, 0.96, "#1F2937");
  b.box(x, 0.89, z, 0.5, 0.02, 0.36, "#94A3B8");
  b.box(x, 1.12, z - 0.2, 0.05, 0.44, 0.05, "#CBD5E1"); b.box(x, 1.32, z - 0.08, 0.05, 0.05, 0.26, "#CBD5E1");
  for (const [dx, c] of [[-1.1, "#22C55E"], [-0.85, "#3B82F6"], [-0.6, "#F472B6"], [0.7, "#FACC15"]] as [number, string][]) {
    b.box(x + dx, 1.0, z + 0.2, 0.14, 0.2, 0.14, "#E0F2FE", "glass");
    b.box(x + dx, 0.95, z + 0.2, 0.11, 0.1, 0.11, c, "glow");
  }
  b.box(x + 1.05, 0.98, z + 0.15, 0.16, 0.16, 0.22, "#1F2937");
  b.box(x + 1.05, 1.18, z + 0.1, 0.06, 0.3, 0.06, "#334155");
  b.box(x + 0.35, 0.95, z - 0.25, 0.08, 0.12, 0.08, "#475569"); b.box(x + 0.35, 1.06, z - 0.25, 0.05, 0.1, 0.05, "#60A5FA", "glow");
  for (let i = i0; i <= i1; i++) b.block(i, j);
}

/** Armut koltuk (yer minderi): engellemez; uyku/uzanma noktası. */
function beanbag(b: Builder, i: number, j: number, c: string) {
  const x = tx(i), z = tz(j);
  b.box(x, 0.16, z, 0.82, 0.32, 0.82, c, "solid", 0.06);
  b.box(x, 0.38, z - 0.22, 0.66, 0.3, 0.3, c, "solid", 0.06);
}

/** Basketbol potası (direk + panya + çember); panya `face` (+z) yönüne bakar. Karoyu engeller. */
function hoop(b: Builder, i: number, j: number, h = 2.8) {
  const x = tx(i), z = tz(j);
  b.box(x, h / 2, z - 0.3, 0.12, h, 0.12, "#475569");
  b.box(x, h + 0.1, z - 0.1, 0.1, 0.1, 0.5, "#475569");
  b.box(x, h + 0.2, z + 0.15, 1.1, 0.7, 0.05, "#F8FAFC");
  b.box(x, h + 0.1, z + 0.18, 0.44, 0.34, 0.02, "#EF4444");
  b.box(x, h - 0.12, z + 0.4, 0.46, 0.04, 0.46, "#F97316");
  b.block(i, j);
}

/** Sarı okul servisi (x boyunca `len` karo, burnu +x). Engeller. */
function schoolBus(b: Builder, i0: number, j: number, len = 4) {
  const x = tx(i0) + (len - 1) / 2, z = tz(j);
  b.box(x, 0.95, z, len - 0.1, 1.3, 0.95, "#FACC15", "solid", 0.03);
  b.box(x, 1.62, z, len - 0.2, 0.06, 0.9, "#EAB308");
  b.box(x, 0.62, z + 0.48, len - 0.1, 0.08, 0.02, "#111827");
  for (let k = 0; k < len * 2 - 2; k++) b.box(tx(i0) - 0.2 + k * 0.5, 1.25, z + 0.48, 0.38, 0.36, 0.02, "#1E3A5F");
  b.box(tx(i0 + len - 1) + 0.46, 1.2, z, 0.04, 0.5, 0.8, "#1E3A5F");
  for (const dx of [-(len / 2) + 0.6, len / 2 - 0.6]) for (const dz of [-0.48, 0.48]) b.box(x + dx, 0.3, z + dz, 0.5, 0.5, 0.1, "#111827");
  b.box(tx(i0 + len - 1) + 0.47, 0.6, z - 0.3, 0.04, 0.12, 0.2, "#FEF3C7", "glow");
  b.box(tx(i0) - 0.47, 0.6, z, 0.04, 0.12, 0.6, "#DC2626");
  b.box(tx(i0 + 1) - 0.1, 0.95, z + 0.52, 0.4, 0.4, 0.04, "#DC2626");
  for (let i = i0; i < i0 + len; i++) b.block(i, j);
}

/** Alçak bölme duvarı stili (sınıf araları, revir, öğretmenler odası). */
const LOW: Fence = { c: CREAM, h: 1.3, t: 0.16, cap: BRICK };

// ------------------------------------------------------------------------------------------ sahne
export function buildSchool(): Built {
  const b = new Builder(31);
  b.ground((i, j) => {
    if (classroom(i, j)) return (i + j) % 2 ? "#C99A6B" : "#BF8F60";
    if (complab(i, j)) return (i + j) % 2 ? "#CBD5E1" : "#BFC9D6";
    if (library(i, j)) return (i + j) % 2 ? "#7FB59A" : "#73A98E";
    if (science(i, j)) return (i + j) % 2 ? "#F1F5F9" : "#E2E8F0";
    if (j <= 7) return (i + j) % 2 ? "#E7E2D8" : "#DCD6CA";
    if (teachers(i, j)) return (i + j) % 2 ? "#D8C3A0" : "#CDB894";
    if (nurse(i, j)) return (i + j) % 2 ? "#D1FAE5" : "#C6F0DA";
    if (cafeteria(i, j)) return (i + j) % 2 ? "#F3E8D2" : "#E9DCC2";
    if (gym(i, j)) return j === 12 ? "#F8FAFC" : (i + j) % 2 ? "#E2B77A" : "#D9AC6E";
    if (court(i, j)) return (i === 18 || i === 23 || j === 8 || j === 12) ? "#F8FAFC" : (i >= 20 && i <= 22 && j <= 10) ? "#C2410C" : "#3E6E9E";
    if (yard(i, j)) return (i + j) % 2 ? "#6B7280" : "#737B88";
    return (i + j) % 2 ? "#E7E2D8" : "#DCD6CA";
  }, UNDER, 0.04);

  // ---- arka blok: iki katlı duvar, balkon (üst kat koridoru), pencereler (gece yanar), çatı
  b.box((tx(0) + tx(23)) / 2, TOP / 2, tz(0), 24, TOP, 1, CREAM, "solid", 0.02);
  for (let i = 0; i <= 23; i++) b.block(i, 0);
  b.box((tx(0) + tx(23)) / 2, 0.15, tz(0) + 0.52, 24, 0.3, 0.04, TRIM);
  b.box((tx(0) + tx(23)) / 2, TOP + 0.2, tz(0), 24.2, 0.4, 1.2, BRICK, "solid", 0.02);
  slab(b, 0, 0, 24, 2, L1, "#E7E2D8", { lip: BRICK, glowLip: "#FFF3C4" });
  railing(b, "x", tz(1) + 0.46, tx(1) - 0.5, tx(23) + 0.5, L1, "#CFEFFF", TRIM);
  // üst kat: sınıf kapıları (simgeli) + pencereler
  const doors: [number, string[], string][] = [[3, NOTE, "#8B5CF6"], [10, PALETTE, "#F59E0B"], [16, BOOK, "#2563EB"], [21, NOTE, "#10B981"]];
  let from = 0;
  for (const [di, icon, c] of doors) {
    if (di - 1 >= from) windows(b, "x", 0, from, di - 1, L1 + 0.75, 1.5, { frame: "#FFFFFF", lit: WARM });
    b.box(tx(di), L1 + 1.05, tz(0) + 0.52, 0.8, 2.1, 0.05, c);
    b.box(tx(di), L1 + 1.6, tz(0) + 0.555, 0.4, 0.5, 0.02, "#CFEFFF", "glass");
    pixelIcon(b, icon, tx(di), L1 + 2.42, tz(0) + 0.54, c, 0.06);
    from = di + 1;
  }
  windows(b, "x", 0, from, 23, L1 + 0.75, 1.5, { frame: "#FFFFFF", lit: WARM });
  // çatı: saat, okul zili, isim bandı (yazı yok)
  const cx = (tx(0) + tx(23)) / 2;
  b.box(cx, TOP + 0.95, tz(0) + 0.2, 1.3, 1.3, 0.2, BRICK);
  b.box(cx, TOP + 0.95, tz(0) + 0.32, 1.05, 1.05, 0.04, "#F8FAFC");
  b.box(cx, TOP + 1.1, tz(0) + 0.36, 0.06, 0.34, 0.02, "#111827");
  b.box(cx + 0.1, TOP + 0.95, tz(0) + 0.36, 0.24, 0.05, 0.02, "#111827");
  b.box(cx - 4, TOP + 0.75, tz(0), 0.7, 0.9, 0.7, BRICK);
  b.box(cx - 4, TOP + 1.3, tz(0), 0.9, 0.2, 0.9, TRIM);
  b.box(cx - 4, TOP + 0.85, tz(0) + 0.1, 0.34, 0.34, 0.34, "#F2B33D");
  for (const [dx, w] of [[3.4, 3.6], [3.2, 2.6]] as [number, number][]) b.box(cx + dx, TOP + 0.52 - (w < 3 ? 0.1 : 0), tz(0) + 0.62, w, 0.08, 0.02, "#FFFFFF", "glow"); // REAL-SUPPORT: ışık şeritleri isim bandına yaslı
  b.hook("roof", 6, 0);
  b.hook("window", 12, 0);
  // balkona çıkan merdiven (solda)
  stairs(b, 0, 2, 6, L1, "#CBD5E1", 1, TRIM);

  // ---- sınıf (i 1–7): yazı tahtası, öğretmen masası, iki sıra öğrenci sırası
  blackboard(b, 2, 5, tz(0) + 0.5);
  b.box(tx(7), 2.7, tz(0) + 0.53, 0.5, 0.5, 0.04, "#F8FAFC");
  b.box(tx(7), 2.75, tz(0) + 0.56, 0.04, 0.2, 0.02, "#111827");
  b.desk(7, 2, 1, "#8B5E3C", "#5D3A1A");
  b.station(7, 1, UP, "sit_chair", "laptop"); b.chair(7, 1, "+z", "#7B5236");
  for (const j of [2, 4]) for (const i of [2, 4, 6]) {
    studentDesk(b, i, j, "+z");
    b.station(i, j + 1, DOWN, "sit_chair", "laptop");
    b.chair(i, j + 1, "-z", "#2563EB");
  }
  b.box(tx(1), 0.35, tz(5), 0.5, 0.7, 0.5, "#8B5E3C"); b.box(tx(1), 0.95, tz(5), 0.5, 0.5, 0.5, "#38BDF8", "solid", 0.1);
  b.box(tx(1), 0.95, tz(5), 0.52, 0.12, 0.3, "#22C55E"); b.block(1, 5);
  b.spot("plan", 3, 1, DOWN); b.spot("plan", 5, 1, DOWN);
  fenceZ(b, 8, 1, 5, [], LOW);

  // ---- bilgisayar laboratuvarı (i 9–12): uzun masa + 4 masaüstü (istasyon), akıllı tahta (web), sunucu dolabı (kabuk)
  b.desk(9, 2, 3, "#E5E7EB", "#6B7280", true);
  for (let i = 9; i <= 11; i++) {
    b.monitor(i, 2, "+z", 0, -0.14);
    b.box(tx(i), 0.81, tz(2) + 0.26, 0.5, 0.03, 0.16, "#CBD5E1");
    b.station(i, 3, DOWN, "sit_chair", "desktop");
    b.chair(i, 3, "-z");
  }
  b.box((tx(10) + tx(11)) / 2, 1.75, tz(0) + 0.54, 2.0, 1.15, 0.05, "#1F2937");
  b.box((tx(10) + tx(11)) / 2, 1.75, tz(0) + 0.57, 1.85, 1.0, 0.02, "#7DD3FC", "glow");
  b.spot("web", 10, 1, DOWN); b.spot("web", 11, 1, DOWN);
  b.serverRack(9, 4, "+x");
  b.spot("shell", 10, 4, LEFT);
  // duvar kenarı masası (4. istasyon): ajan +x'e, ekrana bakar
  b.desk(12, 4, 1, "#E5E7EB", "#6B7280", true);
  b.monitor(12, 4, "-x", 0.14, 0);
  b.station(11, 4, Math.PI / 2, "sit_chair", "desktop");
  b.chair(11, 4, "+x");
  fenceZ(b, 13, 1, 5, [], LOW);

  // ---- kütüphane (i 14–17): raflar (okuma), katalog bilgisayarları (istasyon), armut koltuklar (uyku)
  for (let i = 14; i <= 17; i++) bookshelf(b, i, 1, "#7B5236", 2.2, "+z", ["#EF4444", "#3B82F6", "#F59E0B", "#10B981", "#8B5CF6"]);
  b.spot("read", 15, 2, DOWN); b.spot("read", 16, 2, DOWN);
  for (const i of [14, 15]) {
    b.desk(i, 4, 1, "#C08457", "#7C5A3A", true);
    b.monitor(i, 4, "-z", 0, 0.14);
    b.station(i, 3, UP, "sit_chair", "desktop");
    b.chair(i, 3, "+z", "#3F6E5A");
  }
  // S45: armut koltukta yarı uzanık · S46: üçüncü armut koltuk (öğretmenler odası kanepesi masanın yanından kısaldı)
  for (const [j, c] of [[2, "#A78BFA"], [3, "#F472B6"], [4, "#FBBF24"]] as [number, string][]) { beanbag(b, 17, j, c); }
  b.plant(17, 5);
  fenceZ(b, 18, 1, 5, [], LOW);

  // ---- fen laboratuvarı (i 19–23): deney tezgâhı (kabuk), çeker ocak, periyodik tablo, iskelet modeli
  labBench(b, 20, 22, 3);
  b.spot("shell", 20, 4, DOWN); b.spot("shell", 22, 4, DOWN);
  b.box((tx(19) + tx(20)) / 2, 1.0, tz(1), 1.9, 2.0, 0.8, "#E2E8F0", "solid", 0.02);
  b.box((tx(19) + tx(20)) / 2, 1.35, tz(1) + 0.41, 1.6, 0.8, 0.03, "#CFEFFF", "glass");
  b.box((tx(19) + tx(20)) / 2, 2.15, tz(1), 1.2, 0.3, 0.6, "#94A3B8");
  b.block(19, 1); b.block(20, 1);
  const PT = ["#F87171", "#FBBF24", "#34D399", "#60A5FA", "#A78BFA"];
  for (let r = 0; r < 4; r++) for (let k = 0; k < 9; k++) {
    if (r === 0 && k > 0 && k < 8) continue;
    b.box(tx(21) - 0.2 + k * 0.22, 2.2 - r * 0.22, tz(0) + 0.53, 0.18, 0.18, 0.02, PT[(k + r) % PT.length]);
  }
  b.box(tx(23), 0.06, tz(2), 0.4, 0.12, 0.4, "#475569"); b.box(tx(23), 0.6, tz(2), 0.05, 1.0, 0.05, "#94A3B8");
  b.box(tx(23), 1.25, tz(2), 0.34, 0.5, 0.16, "#F5F5F4"); b.box(tx(23), 1.62, tz(2), 0.22, 0.24, 0.2, "#F5F5F4");
  b.box(tx(23), 0.85, tz(2), 0.06, 0.4, 0.06, "#F5F5F4");
  b.block(23, 2);

  // ---- dolaplı koridor (j 6): kapı boşlukları sınıf, lab, kütüphane, fen labında
  for (let i = 1; i <= 23; i++) if (![5, 11, 15, 21].includes(i)) lockers(b, i, 6);
  for (const i of [5, 11, 15, 21]) b.box(tx(i), 1.6, tz(6), 1, 0.3, 0.7, BRICK);

  // ---- öğretmenler odası (i 0–4, j 8–10): toplantı masası (3 istasyon), kanepe (uyku), kahve makinesi, plan noktası
  fenceZ(b, 5, 8, 15, [13], LOW);
  fenceX(b, 11, 0, 4, [], LOW);
  b.desk(1, 9, 3, "#C8A97E", "#6B7280", true);
  for (const i of [1, 2, 3]) {
    b.laptop(tx(i), 0.79, tz(9), "-z");
    b.station(i, 8, UP, "sit_chair", "laptop");
    b.chair(i, 8, "+z", "#7C2D12");
  }
  b.box(tx(2) + 0.2, 0.82, tz(9) + 0.2, 0.5, 0.04, 0.34, "#F8FAFC");
  // kanepe (z boyunca, j 9–10): engellemez; yatan ajanın başı −z'de. S46 (SLEEP-ZONE-001): j 8 ucu toplantı masasındaki
  // sandalyenin (1, 8) bitişiğiydi — kanepe iki kişilik oldu, j 8 boş kaldı
  b.box(tx(0), 0.25, tz(9.5), 0.8, 0.5, 1.9, "#6C8EBF", "solid", 0.04);
  b.box(tx(0) - 0.35, 0.65, tz(9.5), 0.2, 0.7, 1.9, "#5878A8", "solid", 0.04);
  b.coffeeMachine(4, 10, "-x");
  b.spot("plan", 4, 9, LEFT);
  b.spot("write", 2, 10, DOWN); b.spot("write", 12, 3, UP);
  b.deskLamp(3, 9, "#FDE68A", 0.25, 0.25);

  // ---- revir (i 0–4, j 12–15): ecza dolabı, kızılay işareti, hemşire masası; HOTEL-SYS (E1): yataklar görünmez — revirin
  //      dinlenme odası kapısı (geçit (1, 15); içerisi ayrı dinlenme salonu)
  pixelIcon(b, CROSS, tx(2), 0.72, tz(11) + 0.1, "#DC2626", 0.1);
  b.box(tx(4), 0.95, tz(12), 0.9, 1.9, 0.6, "#F8FAFC", "solid", 0.02);
  pixelIcon(b, CROSS, tx(4), 1.4, tz(12) + 0.31, "#DC2626", 0.07);
  b.block(4, 12);
  b.desk(1, 12, 2, "#E5E7EB", "#94A3B8");
  placeHotel(b, "school", { at: [1, 14], w: 2, d: 1, door: [1, 15] });
  // (EXIT-FACE-001): çöp kovası kapının soluna (0, 15) — (3, 15) çıkışın önünü kapatıyordu
  b.box(tx(0), 0.3, tz(15), 0.5, 0.6, 0.5, "#E5E7EB", "solid", 0.02); b.box(tx(0), 0.65, tz(15), 0.14, 0.1, 0.14, "#F87171"); b.block(0, 15);

  // ---- yemekhane (i 6–11): servis tezgâhı + cam koruma, menü panosu, iki uzun masa ve banklar (dinlenme)
  b.box((tx(7) + tx(10)) / 2, 0.45, tz(8), 4, 0.9, 0.8, "#94A3B8", "solid", 0.02);
  b.box((tx(7) + tx(10)) / 2, 0.93, tz(8), 4.06, 0.06, 0.86, "#E5E7EB");
  b.box((tx(7) + tx(10)) / 2, 1.25, tz(8) + 0.2, 3.9, 0.5, 0.04, "#CFEFFF", "glass"); // REAL-SUPPORT: cam koruma tezgâh üstünde
  for (let k = 0; k < 6; k++) b.box(tx(7) - 0.2 + k * 0.62, 0.99, tz(8) - 0.1, 0.44, 0.06, 0.3, ["#F59E0B", "#22C55E", "#EF4444", "#FDE68A", "#A16207", "#F97316"][k], "solid", 0.1);
  for (let i = 7; i <= 10; i++) b.block(i, 8);
  b.box((tx(7) + tx(10)) / 2, 2.85, tz(8) - 0.3, 2.6, 0.6, 0.06, "#1F3B2D");
  for (let k = 0; k < 4; k++) b.box((tx(7) + tx(10)) / 2 - 0.9 + k * 0.6, 2.85, tz(8) - 0.26, 0.4, 0.3, 0.02, ["#FDE68A", "#86EFAC", "#FCA5A5", "#93C5FD"][k], "glow");
  for (const dx of [-1.3, 1.3]) b.box((tx(7) + tx(10)) / 2 + dx, 1.4, tz(8) - 0.3, 0.06, 2.8, 0.06, "#475569");
  for (const tj of [11, 14]) {
    b.box((tx(7) + tx(10)) / 2, 0.7, tz(tj), 4, 0.08, 0.9, "#F8FAFC", "solid", 0.02);
    for (const dx of [-1.8, 1.8]) b.box((tx(7) + tx(10)) / 2 + dx, 0.34, tz(tj), 0.1, 0.68, 0.7, "#64748B");
    for (let i = 7; i <= 10; i++) {
      b.block(i, tj);
      b.box(tx(i), 0.76, tz(tj) + (i % 2 ? 0.18 : -0.18), 0.36, 0.04, 0.26, ["#F59E0B", "#22C55E", "#38BDF8", "#F472B6"][i % 4]);
    }
    for (const dz of [-1, 1]) {
      const bj = tj + dz;
      if (bj > 15) continue;
      b.box((tx(7) + tx(10)) / 2, 0.42, tz(bj) - dz * 0.15, 4, 0.08, 0.36, "#F59E0B", "solid", 0.03);
      for (const dx of [-1.7, 1.7]) b.box((tx(7) + tx(10)) / 2 + dx, 0.2, tz(bj) - dz * 0.15, 0.08, 0.4, 0.3, "#64748B");
    }
  }
  // REAL-SEAT: dinlenme zeminde (eskiden bankların üstündeki karolardaydı: y 0,46) — tezgâh önü ve masaların iki yanı
  b.rest.push([7, 9], [8, 9], [9, 9], [10, 9], [6, 10], [6, 12], [6, 13], [6, 15], [11, 10], [11, 12]);
  b.box(tx(11), 0.95, tz(8), 0.9, 1.9, 0.8, "#E5E7EB", "solid", 0.02);
  b.box(tx(11), 1.15, tz(8) + 0.41, 0.7, 1.3, 0.02, "#CFEFFF", "glass");
  for (let k = 0; k < 3; k++) b.box(tx(11) - 0.2 + k * 0.2, 1.0 + (k % 2) * 0.35, tz(8) + 0.3, 0.14, 0.2, 0.14, ["#FFFFFF", "#F472B6", "#FFFFFF"][k]);
  b.block(11, 8);

  // ---- spor salonu (i 12–17, j 8–15): ahşap zemin, duvar barı, pota, minderler, atlama sandığı, top arabası
  fenceX(b, 8, 12, 17, [15], { c: CREAM, h: 2.0, t: 0.2, cap: BRICK });
  fenceZ(b, 12, 9, 15, [], LOW);
  fenceZ(b, 17, 9, 15, [], LOW);
  for (let k = 0; k < 7; k++) b.box(tx(13) - 0.35 + k * 0.28, 1.0, tz(8) + 0.16, 0.05, 1.9, 0.05, "#B45309");
  for (let k = 0; k < 8; k++) b.box((tx(13) + tx(14)) / 2 - 0.4, 0.2 + k * 0.24, tz(8) + 0.16, 2.0, 0.04, 0.05, "#B45309");
  b.box(tx(16), 2.45, tz(8) + 0.2, 1.0, 0.65, 0.05, "#F8FAFC");
  b.box(tx(16), 2.38, tz(8) + 0.24, 0.4, 0.3, 0.02, "#EF4444");
  b.box(tx(16), 2.12, tz(8) + 0.45, 0.44, 0.04, 0.44, "#F97316");
  for (const [i, j] of [[13, 10], [14, 10], [13, 11], [14, 11]] as [number, number][]) b.box(tx(i), 0.06, tz(j), 0.96, 0.12, 0.96, "#2563EB", "solid", 0.03);
  b.box(tx(16), 0.25, tz(13), 0.9, 0.5, 0.6, "#B45309", "solid", 0.03);
  b.box(tx(16), 0.62, tz(13), 0.9, 0.24, 0.6, "#92400E", "solid", 0.03);
  b.box(tx(16), 0.79, tz(13), 0.94, 0.1, 0.64, "#F5F5F4");
  b.block(16, 13);
  b.box(tx(13), 0.3, tz(15), 0.8, 0.6, 0.6, "#475569"); // REAL-SUPPORT: top arabası zeminde, toplar üstünde
  for (const [dx, dz, c] of [[-0.2, -0.12, "#F97316"], [0.2, -0.12, "#F8FAFC"], [0, 0.14, "#F97316"]] as [number, number, string][]) b.box(tx(13) + dx, 0.75, tz(15) + dz, 0.3, 0.3, 0.3, c);
  b.block(13, 15);
  for (const dx of [-0.75, 0.75]) b.box(tx(15) + dx, 1.45, tz(11), 0.06, 2.9, 0.06, "#C2A878"); // REAL-SUPPORT: barfiks iki direğe oturur (eskiden tek kısa direk havada)
  b.box(tx(15), 2.85, tz(11), 1.6, 0.1, 0.1, "#475569");
  b.box(tx(14.5), 0.24, tz(15), 1.8, 0.08, 0.4, "#B45309"); b.box(tx(14.5), 0.12, tz(15), 1.6, 0.24, 0.3, "#64748B");
  b.block(14, 15); b.block(15, 15);
  b.rest.unshift([15, 14], [14, 14]); // yürüme girişi (rest[0]) bahçe bankında — yemekhane önünde büyümüş okulda kamera sınıf duvarına yaslanıyordu

  // ---- okul bahçesi: basketbol yarım sahası, bayrak, servis otobüsü ve durağı, bank
  hoop(b, 21, 8);
  for (let k = 0; k < 7; k++) b.box(tx(21) + Math.cos(k * 0.52) * 2.4, 0.012, tz(8) + Math.sin(k * 0.52) * 2.4, 0.32, 0.02, 0.32, "#F8FAFC");
  b.box(tx(20) + 0.1, 0.22, tz(11), 0.42, 0.42, 0.42, "#EA580C");
  b.flag(23, 13, "#E30A17", 4.2, "#FFFFFF");
  schoolBus(b, 19, 15, 4);
  b.box(tx(18), 1.25, tz(15), 0.08, 2.5, 0.08, "#64748B");
  b.box(tx(18), 2.3, tz(15) + 0.06, 0.6, 0.6, 0.06, "#FACC15");
  pixelIcon(b, BUS, tx(18), 2.3, tz(15) + 0.1, "#111827", 0.09);
  b.block(18, 15);
  bench(b, 18, 14, "#B45309", "#475569");
  b.tree(23, 11, 3);
  b.hook("tree", 23, 11);

  // ---- ışıklar, saksılar
  b.lamp(23, 8, "#FFE8B0");
  for (const i of [14, 15]) b.deskLamp(i, 4, "#FDE68A", 0.28, 0.25);
  b.lights.push({ pos: [tx(12), 4.5, tz(4)], color: "#FFF1DC", intensity: 5, distance: 16 });
  b.lights.push({ pos: [tx(8.5), 2.6, tz(11)], color: "#FFE2B8", intensity: 3, distance: 9 });
  aquarium(b, 23, 9, "#7B5236"); // S45: koridor akvaryumu (AQUA-PREF-001)
  return b.done();
}

// ------------------------------------------------------------------ büyüme (S42): derslik kanatları, spor sahası, konferans salonu
const SCHOOL: IndoorStyle = {
  wall: CREAM, base: TRIM, h: 2.6, shelf: "#7B5236",
  books: ["#EF4444", "#3B82F6", "#F59E0B", "#10B981", "#8B5CF6"],
  side: { c: CREAM, h: 1.2, t: 0.16, cap: BRICK },
  front: (b, i, j) => planter(b, i, j, BRICK, "#3E8E3E"),
  glass: "#A8D8F0",
};

/** Derslik kanadı: arka duvar (raflar = okuma, pencere = web, kapı + ekip tabelası), duvara yazı tahtası (plan),
 *  üstünde İKİNCİ KAT (pencereler gece yanar) + balkon çıkıntısı ve korkuluk. */
function classWing(x: Bay) {
  const { b, I, J } = x;
  indoorBack(x, SCHOOL, { board: false, signColor: x.color });
  blackboard(b, I(9), 2, tz(J(1)) + 0.5, 1.55);
  b.spot("plan", I(9), J(2), DOWN); b.spot("plan", I(10), J(2), DOWN);
  // ikinci kat: duvar gövdesi, pencere şeridi, çatı bandı, balkon çıkıntısı
  const cx = (tx(I(1)) + tx(I(11))) / 2, h0 = SCHOOL.h, top = h0 + STOREY;
  // S45: kapalı ikinci kat (iç merdiven varsayılır; balkon kanadın içinden çıkılır) — rules/levels
  noteObject(b, "upper_storey", [I(1), J(1)], { w: 11, d: 1, y: h0, floors: 2, enclosed: true });
  b.box(cx, (h0 + top) / 2, tz(J(1)), 11, top - h0, 1, CREAM, "solid", 0.02);
  windows(b, "x", J(1), I(1), I(11), h0 + 1.0, 1.4, { frame: "#FFFFFF", lit: WARM });
  b.box(cx, top + 0.15, tz(J(1)), 11.2, 0.3, 1.2, BRICK, "solid", 0.02);
  b.box(cx, h0 + 0.52, tz(J(1)) + 0.75, 11, 0.24, 0.5, "#E7E2D8", "solid", 0.02);
  railing(b, "x", tz(J(1)) + 0.98, tx(I(1)) - 0.5, tx(I(11)) + 0.5, h0 + 0.64, "#CFEFFF", TRIM);
}

/** Pod koltuğu: iki tek kişilik sıra yan yana (ajanın sırasında dizüstü). */
function schoolSeat(b: Builder, i: number, j: number, face: "+z" | "-z") {
  const user = face === "+z" ? "-z" : "+z";
  studentDesk(b, i, j, user);
  studentDesk(b, i + 1, j, user, false);
  b.box(tx(i + 1) - 0.1, 0.74, tz(j), 0.3, 0.04, 0.22, "#F59E0B");
}

/** Ekip kanadı dinlenme köşesi (lj 13–14, li 6–9): 8 armut koltuk (uyku noktası). */
function restCorner(x: Bay) {
  const { b, I, J } = x;
  const cs = ["#F472B6", "#FBBF24", "#60A5FA", "#34D399"];
  for (const lj of [13, 14]) for (let li = 6; li <= 9; li++) {
    beanbag(b, I(li), J(lj), cs[(li + lj) % cs.length]); // HOTEL-SYS: oturma (uyku geçitte)
  }
}

export function schoolTheme(): Theme {
  const sportsField: Amenity = {
    label: "dist_sportsfield",
    floor: (li, lj) => {
      if (li === 2 || li === 10 || lj === 2 || lj === 13) return "#B4532A";
      if (li >= 3 && li <= 9 && lj >= 3 && lj <= 12) return lj === 8 ? "#F8FAFC" : (li + lj) % 2 ? "#4CAF50" : "#45A049";
      return (li + lj) % 2 ? "#6DBE45" : "#66B33F";
    },
    build: (x) => {
      const { b, I, J } = x;
      const chain: Fence = { c: "#94A3B8", h: 1.6, t: 0.05, g: "glass", post: "#64748B", every: 2 };
      fenceX(b, J(1), I(1), I(11), [I(6)], chain);
      fenceZ(b, I(1), J(2), J(15), [2, 7, 12].map(J), chain);
      // kaleler (iki uçta), orta daire
      for (const [lj, dz] of [[3, -0.3], [12, 0.3]] as [number, number][]) {
        const z = tz(J(lj)) + dz;
        b.box((tx(I(5)) + tx(I(7))) / 2, 1.0, z, 3, 0.1, 0.1, "#F8FAFC");
        for (const li of [5, 7]) b.box(tx(I(li)) + (li === 5 ? -0.45 : 0.45), 0.5, z, 0.1, 1.0, 0.1, "#F8FAFC");
        b.box((tx(I(5)) + tx(I(7))) / 2, 0.5, z - dz * 1.2, 3, 1.0, 0.05, "#E5E7EB", "glass");
        for (const li of [5, 6, 7]) b.block(I(li), J(lj));
      }
      for (let k = 0; k < 10; k++) b.box(tx(I(6)) + Math.cos(k * 0.63) * 1.4, 0.012, tz(J(8)) + Math.sin(k * 0.63) * 1.4, 0.24, 0.02, 0.24, "#F8FAFC");
      b.box(tx(I(4)), 0.2, tz(J(6)), 0.36, 0.36, 0.36, "#F8FAFC");
      // tribün (lj 14, li 2–5): basamaklı oturma, önü dinlenme
      for (let k = 0; k < 3; k++) b.box((tx(I(2)) + tx(I(5))) / 2, 0.2 + k * 0.3, tz(J(14)) + k * 0.25 - 0.25, 4, 0.4 + k * 0.3, 0.3, ["#2563EB", "#F8FAFC", "#DC2626"][k], "solid", 0.02);
      for (let li = 2; li <= 5; li++) { b.block(I(li), J(14)); b.rest.push([I(li), J(13)]); }
      // koç tahtası (plan) + su sebili (mola noktası)
      b.box(tx(I(10)), 1.2, tz(J(14)), 1.0, 0.8, 0.06, "#F8FAFC");
      b.box(tx(I(10)), 1.2, tz(J(14)) - 0.04, 0.8, 0.04, 0.02, "#2563EB");
      for (const dx of [-0.4, 0.4]) b.box(tx(I(10)) + dx, 0.5, tz(J(14)), 0.06, 1.0, 0.06, "#64748B");
      b.block(I(10), J(14)); b.spot("plan", I(10), J(13), UP);
      b.box(tx(I(9)), 0.5, tz(J(14)), 0.5, 1.0, 0.5, "#94A3B8"); b.box(tx(I(9)), 1.05, tz(J(14)), 0.4, 0.1, 0.4, "#7DD3FC", "water");
      b.block(I(9), J(14)); breakSpot(b, I(9), J(14), "-z");
      // kenarda çimde oturma minderleri (HOTEL-SYS: uyku geçitte)
      for (const lj of [5, 6, 9, 10]) b.box(tx(I(11)), 0.05, tz(J(lj)), 0.7, 0.1, 0.9, "#FBBF24", "solid", 0.03);
      b.spot("web", I(8), J(2), DOWN);
      x.sign = [tx(I(6)), 2.2, tz(J(1))];
      b.hook("grass", I(3), J(7));
    },
  };
  const auditorium: Amenity = {
    label: "dist_auditorium",
    floor: (li, lj) => (lj <= 4 ? "#7C2D12" : lj >= 13 ? ((li + lj) % 2 ? "#E7E2D8" : "#DCD6CA") : (li === 6 ? "#9F1239" : (li + lj) % 2 ? "#5B4636" : "#4E3B2D")),
    build: (x) => {
      const { b, I, J } = x;
      fenceX(b, J(1), I(1), I(11), [], { c: CREAM, h: 4.2, t: 1 });
      indoorSides(x, { ...SCHOOL, front: undefined });
      // sahne (lj 2–4, yükseltilmiş), perdeler, kürsü, spot ışıkları
      b.box((tx(I(2)) + tx(I(10))) / 2, 0.25, (tz(J(2)) + tz(J(4))) / 2, 9, 0.5, 3, "#8B5E3C", "solid", 0.03);
      for (let li = 2; li <= 10; li++) for (let lj = 2; lj <= 4; lj++) b.block(I(li), J(lj));
      for (const [li, w] of [[2, 2.2], [10, 2.2]] as [number, number][]) b.box(tx(I(li)) + (li === 2 ? 0.1 : -0.1), 2.3, tz(J(1)) + 0.62, w, 3.6, 0.15, "#B91C1C", "solid", 0.06);
      b.box((tx(I(2)) + tx(I(10))) / 2, 3.95, tz(J(1)) + 0.62, 9, 0.5, 0.18, "#991B1B");
      b.box(tx(I(6)), 1.8, tz(J(1)) + 0.56, 4, 2.0, 0.04, "#F8FAFC");
      b.box(tx(I(6)), 1.8, tz(J(1)) + 0.59, 3.7, 1.75, 0.02, "#93C5FD", "glow");
      b.box(tx(I(6)), 0.95, tz(J(4)), 0.6, 0.9, 0.5, "#7B5236"); b.box(tx(I(6)), 1.45, tz(J(4)) + 0.1, 0.08, 0.2, 0.08, "#111827");
      for (const li of [3, 9]) {
        b.box(tx(I(li)), 3.82, (tz(J(1)) + tz(J(5))) / 2, 0.1, 0.1, tz(J(5)) - tz(J(1)) + 0.3, "#475569"); // REAL-SUPPORT: spot kirişi arka duvardan uzanır
        b.box(tx(I(li)), 3.6, tz(J(5)), 0.35, 0.3, 0.35, "#111827"); b.box(tx(I(li)), 3.42, tz(J(5)), 0.25, 0.06, 0.25, "#FFF3C4", "glow");
      }
      b.spot("plan", I(6), J(5), DOWN);
      // koltuk sıraları (lj 7–11, li 2–5 ve 7–10; orta koridor li 6)
      for (let lj = 7; lj <= 11; lj += 2) for (const [a, c] of [[2, 5], [7, 10]] as [number, number][]) {
        const xc = (tx(I(a)) + tx(I(c))) / 2;
        b.box(xc, 0.25, tz(J(lj)), 4, 0.5, 0.6, "#9F1239", "solid", 0.04);
        b.box(xc, 0.6, tz(J(lj)) + 0.3, 4, 0.7, 0.15, "#881337", "solid", 0.04);
        for (let li = a; li <= c; li++) { b.block(I(li), J(lj)); }
      }
      for (const li of [2, 3, 4, 5, 7, 8, 9, 10]) b.rest.push([I(li), J(8)]);
      // fuaye (lj 13–15): kanepeler (oturma; HOTEL-SYS: uyku geçitte), büfe (kahve noktası), afiş
      for (const li of [2, 3, 4, 5]) b.box(tx(I(li)), 0.22, tz(J(14)), 0.95, 0.44, 0.8, "#6C8EBF", "solid", 0.04);
      b.box((tx(I(2)) + tx(I(5))) / 2, 0.6, tz(J(14)) + 0.38, 4, 0.5, 0.16, "#5878A8", "solid", 0.04);
      b.coffeeMachine(I(9), J(14), "-z");
      for (const dx of [-0.35, 0.35]) b.box(tx(I(10)) + dx, 0.425, tz(J(14)), 0.05, 0.85, 0.05, "#64748B"); // REAL-SUPPORT: afiş ayaklı
      b.box(tx(I(10)), 1.4, tz(J(14)), 0.8, 1.1, 0.06, "#F8FAFC"); b.box(tx(I(10)), 1.4, tz(J(14)) + 0.04, 0.66, 0.9, 0.02, "#F472B6", "glow");
      b.block(I(10), J(14));
      b.spot("read", I(10), J(13), UP);
      x.sign = [tx(I(6)), 4.6, tz(J(1)) + 0.6];
    },
  };
  // pansiyon yatakhanesi (yatakhane olanağı): 16 ranza (alt kat uyku noktası), dolaplar, etüt masası, pencereler
  const dorm: Amenity = {
    label: "dist_dorm",
    floor: (li, lj) => (lj <= 1 ? "#E7E2D8" : (li + lj) % 2 ? "#D8C3A0" : "#CDB894"),
    build: (x) => {
      const { b, I, J } = x;
      indoorBack(x, SCHOOL, { shelves: false, board: false, signColor: "#0EA5E9" });
      indoorSides(x, { ...SCHOOL, front: undefined });
      const cs = ["#60A5FA", "#F472B6", "#34D399", "#FBBF24"];
      // ranza sıralarının önünde halılar, aralarda komodin + saksı şeridi
      for (const lj of [4, 10]) { rug(b, I(2), J(lj), 4, 1, "#BFDBFE"); rug(b, I(7), J(lj), 4, 1, "#FBCFE8"); }
      for (const li of [2, 3, 4, 5, 7, 8, 9, 10]) { b.box(tx(I(li)), 0.3, tz(J(6)), 0.6, 0.6, 0.6, "#C08457", "solid", 0.03); b.box(tx(I(li)), 0.66, tz(J(6)), 0.16, 0.12, 0.16, "#FDE68A", "glow"); b.block(I(li), J(6)); }
      rug(b, I(7), J(12), 4, 1, "#FDE68A");
      for (const lj of [3, 9]) for (const li of [2, 3, 4, 5, 7, 8, 9, 10]) {
        const i = I(li), j = J(lj), xx = tx(i), zz = tz(j);
        for (const dx of [-0.4, 0.4]) for (const dz of [-0.44, 0.44]) b.box(xx + dx, 0.85, zz + dz, 0.06, 1.7, 0.06, "#64748B");
        for (const y of [0.32, 1.3]) {
          b.box(xx, y, zz, 0.8, 0.08, 0.9, "#94A3B8");
          b.box(xx, y + 0.08, zz + 0.1, 0.74, 0.08, 0.66, cs[(li + lj + (y > 1 ? 1 : 0)) % cs.length], "solid", 0.03);
          b.box(xx, y + 0.1, zz - 0.32, 0.5, 0.08, 0.2, "#FFFFFF");
        }
        b.box(xx + 0.42, 0.9, zz + 0.3, 0.04, 1.0, 0.04, "#475569");
        b.sleep(i, j, DOWN, "bunk", 0.42);
      }
      // dolaplar (lj 13) + etüt masası (yazma) + kahve/çay köşesi
      for (const li of [2, 3, 4]) lockers(b, I(li), J(13), 1.6);
      b.desk(I(8), J(13), 2, "#C08457", "#7C5A3A");
      b.spot("write", I(8), J(12), UP);
      b.coffeeMachine(I(10), J(14), "-z");
      x.sign = [tx(I(6)), SCHOOL.h + 0.55, tz(J(1)) + 0.6];
    },
  };
  return {
    hq: "dist_school_hq", trim: BRICK, under: UNDER,
    // pod koltuğu = öğrenci sırası: sandalye, dizüstü
    pose: "sit_chair", device: "laptop",
    // koridorlar: terrazzo şerit
    aisle: (li, lj) => ((li + lj) % 2 ? "#D6CFC2" : "#CBC3B5"),
    path: (li, lj) => (li === 0 && lj % 3 === 0 ? "#B4532A" : (li + lj) % 2 ? "#D6CFC2" : "#CBC3B5"),
    floor: (li, lj) => (lj >= 13 ? ((li + lj) % 2 ? "#E7E2D8" : "#DCD6CA") : (li + lj) % 2 ? "#C99A6B" : "#BF8F60"),
    work: (x) => {
      classWing(x);
      indoorSides(x, SCHOOL);
      teamCorner(x, (bb, i, j) => bench(bb, i, j, "#B45309", "#475569"));
      restCorner(x);
    },
    seat: schoolSeat,
    pod: (x, pi, pj) => rug(x.b, x.I(pi), x.J(pj + 1), 4, 2, "#E0E7FF", 0.006),
    spare: (x, pi, pj, slot) => {
      const { b } = x;
      const i = x.I(pi), j = x.J(pj);
      if (slot % 2 === 0) {
        // fen köşesi: deney tezgâhı (kabuk)
        labBench(b, i + 1, i + 3, j + 2);
        b.spot("shell", i + 2, j + 3, DOWN);
      } else {
        // okuma köşesi: halı, alçak raflar (okuma), armut koltuk
        rug(b, i, j, 4, 4, "#FDE68A");
        bookshelf(b, i + 1, j + 1, "#8B5E3C", 1.3); bookshelf(b, i + 2, j + 1, "#8B5E3C", 1.3);
        b.spot("read", i + 1, j + 2, DOWN); b.spot("read", i + 2, j + 2, DOWN);
        beanbag(b, i + 3, j + 3, "#60A5FA");
      }
    },
    amenities: [sportsField, auditorium, dorm],
    yard: {
      label: "dist_playground",
      floor: (li, lj) => (lj >= 12 ? ((li + lj) % 2 ? "#6B7280" : "#737B88") : li >= 7 && lj >= 3 && lj <= 7 ? "#E9C46A" : (li + lj) % 2 ? "#C2410C" : "#B4532A"),
      build: (x) => {
        const { b, I, J } = x;
        // kaydırak
        const sx = tx(I(3)), sz = tz(J(4));
        b.box(sx, 0.9, sz - 0.35, 0.8, 0.1, 0.8, "#2563EB");
        for (const dx of [-0.35, 0.35]) for (const dz of [-0.7, 0]) b.box(sx + dx, 0.45, sz + dz, 0.08, 0.9, 0.08, "#475569");
        for (let k = 0; k < 4; k++) {
          const sy = 0.8 - k * 0.24;
          b.box(sx, sy, sz + 0.25 + k * 0.3, 0.6, 0.06, 0.32, "#F59E0B");
          for (const dx of [-0.25, 0.25]) b.box(sx + dx, (sy - 0.03) / 2, sz + 0.25 + k * 0.3, 0.05, sy - 0.03, 0.05, "#475569"); // REAL-SUPPORT: basamaklar ayaklı
        }
        for (const lj of [3, 4, 5]) b.block(I(3), J(lj));
        // salıncak
        const wx = (tx(I(3)) + tx(I(5))) / 2, wz = tz(J(9));
        b.box(wx, 2.0, wz, 3, 0.1, 0.1, "#DC2626");
        for (const dx of [-1.45, 1.45]) b.box(wx + dx, 1.0, wz, 0.1, 2.0, 0.5, "#DC2626");
        for (const dx of [-0.6, 0.6]) { b.box(wx + dx, 1.3, wz, 0.03, 1.4, 0.03, "#64748B"); b.box(wx + dx, 0.55, wz, 0.5, 0.06, 0.3, "#F8FAFC"); }
        for (const li of [2, 3, 4, 5, 6]) b.block(I(li), J(9));
        // kum havuzu (li 7–10, lj 3–7)
        b.box((tx(I(7)) + tx(I(10))) / 2, 0.1, (tz(J(3)) + tz(J(7))) / 2, 4.1, 0.2, 5.1, "#8B5E3C");
        b.box(tx(I(8)), 0.25, tz(J(5)), 0.5, 0.3, 0.5, "#E9C46A");
        b.box(tx(I(9)), 0.18, tz(J(4)), 0.24, 0.16, 0.24, "#EF4444");
        // servis otobüsü (lj 13) + bank (dinlenme) + ağaç
        schoolBus(b, I(3), J(13), 4);
        bench(b, I(8), J(11), "#B45309", "#475569");
        b.tree(I(10), J(9), 2);
        b.hook("tree", I(10), J(9));
        breakSpot(b, I(2), J(11)); b.box(tx(I(2)), 0.5, tz(J(11)), 0.5, 1.0, 0.5, "#94A3B8"); b.block(I(2), J(11));
        x.sign = [tx(I(6)), 2.2, tz(J(1))];
      },
    },
    row0: (x) => {
      const { b, I, J } = x;
      fenceX(b, J(0), I(0), I(11), [], { c: CREAM, h: 2.4, t: 0.3, cap: BRICK, post: BRICK, every: 3 });
    },
  };
}
