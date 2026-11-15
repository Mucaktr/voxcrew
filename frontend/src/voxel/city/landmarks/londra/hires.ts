/**
 * HIRES-LON (LANDMARK-HIRES I2,) — Londra
 * simgelerinin yüksek çözünürlük kurucuları ( "Yüksek çözünürlük" bölümü).
 *
 * - `saat_kulesi`: Dikey Gotik gövde (köşe payandaları, dört kat kuşağı, yüz başına 3 bölme × 5 kat sivri pencere, panel kaburgaları),
 * kadran katı (yaldız kare çerçeve + köşe süsleri, Prusya mavisi halka, opal kadran ve demir kayıt noktaları, 12 işaret, akrep ve
 * yelkovan; rakam ve yazıt yok), köşe pinaklleri, çan katı (sivri açıklık + panjur), demir külah (dört çatı penceresi, köşe
 * pinaklleri, fener katı, tığ süslü kademeler, yaldız tepe; haç ve arma yok).
 * - `parlamento`: nehir cephesi bölme ritmi (14 payanda + tığlı pinakl, iki kat sivri pencere, üst kat gece ışıklı), kesik siper,
 * dik arduvaz çatı + çatı pencereleri + demir sırt süsü + iki havalandırma kulecik, dört köşk, sekizgen merkez kulesi (8 pencere,
 * 8 pinakl, tığlı külah), doğu ucunda büyük kare kule (sekizgen köşe kuleleri, 4 kat pencere, kemerli tören girişi, boş nişler,
 * piramit demir çatı). Bayrak, bayrak direği, arma ve heykel yok.
 * - `kule_koprusu`: granit ayak + mahmuz, iki Gotik kule (açıklığı açık bırakan ayaklar + sivri kemer, sekizgen köşe kuleleri ve külahlar,
 * üç kat pencere, çatı pencereli dik çatı), yüksek geçitler (mavi başlık + beyaz kafes, cam taban), açılır kanat kirişleri ve derzleri,
 * asma zincirler (üst + alt başlık, kafes, askı çubukları), korkuluk dikmeleri ve fenerler. Güverte yürüme bandı boş kalır.
 * - `kubbeli_katedral`: iki katlı yan cepheler (pilastr, alınlıklı pencere, üst perde duvar nişleri, korkuluk), batı cephesinde çift
 * sütunlu iki katlı revak + alınlık (kabartmasız), iki batı kulesi (sütunlu çan katı, sütunlu kasnak, kurşun soğanımsı başlık, yaldız
 * tepe), sütunlu kasnak (32 sütun, 8 dolu ara), taş galeri korkuluğu, pilastrlı üst kasnak, kaburgalı kurşun kubbe, altın galeri,
 * fener, yaldız top. İbadet yeri: yalnız dış görünüm; haç, heykel, kabartma yok.
 * Yazı, logo, bayrak, kraliyet işareti yok. Saf modül; yalnız `hires/kit`, `hires/types`, `citymap/design` içe aktarılır.
*/
import type { Block } from "../../../scenes";
import type { HiResMapEntry, HiResSceneEntry } from "../../../hires/types";
import { around, cone, disc, halfDisc, ribbedDome, semiDome } from "../../../hires/kit";
import { sink, type LandmarkCtx, type Sink } from "../../../citymap/design";

type G = Block["g"];

// Londra paleti (city/landmarks/londra/kit.ts `L` ile aynı değerler; döngü olmasın diye burada)
const SAND = "#D9C08A", SAND_D = "#BFA26B", SAND_L = "#E8D6A8", SPIRE = "#5B6670", SPIRE2 = "#4C5661", GOLD = "#C9A23A",
  GOLD_D = "#A9822A", INK = "#2F2A25", DIAL = "#F3E9C6", WIN = "#3E4652", PRUSSIA = "#24395A", IRON = "#3B4250",
  WARM = "#6B5536", DOOR = "#3A2E26", SLATE = "#5E6873", NICHE = "#B9A57A";

// ------------------------------------------------------------------------------------------ yüzey yardımcıları
/** Duvar düzlemi: `ax` boyunca uzanır (x: düzlem z = at; z: düzlem x = at), `out` dışa yön. */
interface Face { ax: "x" | "z"; at: number; out: 1 | -1 }

/** Duvar yüzüne oturan kutu: u yüz boyunca (mutlak), t dışa taşma; 0,01 duvara gömülür (değme zinciri). */
function fb(b: Sink, f: Face, u: number, y: number, lu: number, h: number, t: number, c: string, g: G = "solid") {
  const d = t + 0.01, m = f.at + f.out * (t - 0.01) / 2;
  if (f.ax === "x") b(u, y, m, lu, h, d, c, g, 0); else b(m, y, u, d, h, lu, c, g, 0);
}

/** Kare gövdenin dört yüzü (merkez X, Z; yarı genişlik `half`) → [yüz, yüz boyunca köken]. */
function faces4(X: number, Z: number, half: number): [Face, number][] {
  return [[{ ax: "x", at: Z + half, out: 1 }, X], [{ ax: "x", at: Z - half, out: -1 }, X],
    [{ ax: "z", at: X + half, out: 1 }, Z], [{ ax: "z", at: X - half, out: -1 }, Z]];
}

/** Sivri (Gotik) pencere: açıklık + iki kademe sivri baş + damla silmesi + denizlik (+ orta dikme ve kayıt). Kutu 5 (+2). */
function gwin(b: Sink, f: Face, u: number, y: number, w: number, h: number, glass: string, stone: string, o: { mull?: boolean; g?: G } = {}) {
  const g = o.g ?? "solid", top = y + h / 2;
  fb(b, f, u, y, w, h, 0.03, glass, g);
  fb(b, f, u, top + w * 0.13, w * 0.66, w * 0.26, 0.03, glass, g);
  fb(b, f, u, top + w * 0.31, Math.max(0.045, w * 0.3), Math.max(0.045, w * 0.14), 0.03, glass, g);
  fb(b, f, u, top + w * 0.42, w * 0.56, 0.05, 0.06, stone);
  fb(b, f, u, y - h / 2 - 0.03, w + 0.1, 0.06, 0.07, stone);
  if (o.mull) { fb(b, f, u, y, 0.045, h, 0.045, stone); fb(b, f, u, y + h * 0.12, w, 0.045, 0.045, stone); }
}

/** Tığ süslü kare pinakl: gövde, küçük alın kuşağı, 4 kademe sivri uç, köşe tığları, uç. Taban y0, tepe y0 + h + 0,08. Kutu 11. */
function pinnacle(b: Sink, x: number, y0: number, z: number, s: number, h: number, c: string, tip: string) {
  const sh = h * 0.45, ph = h - sh - 0.06;
  b(x, y0 + sh / 2, z, s, sh, s, c, "solid", 0.02);
  b(x, y0 + sh + 0.03, z, s * 1.25, 0.06, s * 1.25, c, "solid", 0.02);
  for (let q = 0; q < 4; q++) {
    const w = Math.max(0.04, s * 0.95 * (1 - (q + 0.5) / 4)), yy = y0 + sh + 0.06 + (q + 0.5) * ph / 4;
    b(x, yy, z, w, ph / 4 + 0.01, w, c, "solid", 0.02);
    if (q === 1) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b(x + sx * w * 0.5, yy, z + sz * w * 0.5, 0.04, 0.04, 0.04, tip, "solid", 0);
  }
  b(x, y0 + h + 0.04, z, 0.04, 0.08, 0.04, tip, "solid", 0);
}

/** Basit sivri uç (gövde + iki kademe + uç; arka cephe ve küçük kuleler). Kutu 3. */
function spike(b: Sink, x: number, y0: number, z: number, s: number, h: number, c: string) {
  b(x, y0 + h * 0.25, z, s, h * 0.5, s, c, "solid", 0.02);
  b(x, y0 + h * 0.65, z, s * 0.6, h * 0.3, s * 0.6, c, "solid", 0.02);
  b(x, y0 + h * 0.9, z, Math.max(0.04, s * 0.3), h * 0.2, Math.max(0.04, s * 0.3), c, "solid", 0);
}

// ------------------------------------------------------------------------------------------ saat kulesi (3 × 3; mid ×0,627)
/** Orta model (westminster.ts saatKulesi) ile aynı ölçek dönüşümü: kaide üstü (y 0,8) bütün ayrıntı ×SK. Tasarım ölçeksiz birimde. */
const SK = 0.627, SY0 = 0.8;
function saatHi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b0 = sink(out), X = c.cx, Z = c.cz;
  // kaide (ölçeksiz; ayak izi): taş kaide, üst silme, güney yüzde kapı (kapı karosu güneyde) ve söveler
  b0(X, 0.36, Z, 3, 0.72, 3, SAND_D, "solid", 0.03);
  b0(X, 0.76, Z, 2.96, 0.08, 2.96, SAND_L, "solid", 0.02);
  b0(X, 0.36, Z + 1.495, 0.46, 0.6, 0.02, DOOR, "solid", 0);
  for (const s of [-1, 1]) b0(X + s * 0.29, 0.36, Z + 1.49, 0.08, 0.64, 0.03, SAND_L, "solid", 0);
  const b: Sink = (x, y, z, w, h, d, col, g, j) =>
    b0(X + (x - X) * SK, SY0 + (y - SY0) * SK, Z + (z - Z) * SK, w * SK, h * SK, d * SK, col, g, j);

  // gövde (0,8–12,0): çekirdek, taban silmesi, köşe payandaları (kenet), dört kat kuşağı
  b(X, 6.4, Z, 2.5, 11.2, 2.5, SAND, "solid", 0.02);
  b(X, 1.0, Z, 2.8, 0.4, 2.8, SAND_D, "solid", 0.02);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b(X + sx * 1.2, 6.5, Z + sz * 1.2, 0.42, 11.4, 0.3, SAND_L, "solid", 0.01);
    b(X + sx * 1.2, 6.5, Z + sz * 1.2, 0.3, 11.4, 0.42, SAND_L, "solid", 0.01);
  }
  for (const y of [2.6, 5.2, 8.6, 11.4]) b(X, y, Z, 2.62, 0.1, 2.62, SAND_L, "solid", 0.01);
  // yüz başına: 4 panel kaburgası, 3 bölme × 5 kat sivri pencere (Dikey Gotik panel düzeni)
  const tiers: [number, number][] = [[1.95, 0.8], [3.9, 1.6], [6.2, 1.15], [7.75, 1.15], [10.0, 1.7]];
  for (const [F, o] of faces4(X, Z, 1.25)) {
    for (const u of [-0.85, -0.28, 0.28, 0.85]) fb(b, F, o + u, 6.3, 0.07, 10.2, 0.05, SAND_L);
    for (const [y, h] of tiers) for (const u of [-0.565, 0, 0.565]) gwin(b, F, o + u, y, 0.24, h, WIN, SAND_L);
  }

  // kadran katı (12,0–14,7): gövde, köşe kuleleri + pinakller
  b(X, 13.35, Z, 2.9, 2.7, 2.9, SAND_L, "solid", 0.02);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b(X + sx * 1.38, 13.6, Z + sz * 1.38, 0.36, 3.4, 0.36, SAND_L, "solid", 0.01);
    pinnacle(b, X + sx * 1.38, 15.3, Z + sz * 1.38, 0.3, 1.5, SAND_L, GOLD);
  }
  const CY = 13.3;
  for (const [F, o] of faces4(X, Z, 1.45)) {
    fb(b, F, o, CY, 2.4, 2.4, 0.04, GOLD);                                               // yaldız kare çerçeve
    for (const [su, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {                        // köşe süsleri (kabartmasız kayıt)
      fb(b, F, o + su * 0.95, CY + sy * 0.95, 0.3, 0.3, 0.07, GOLD_D);
      fb(b, F, o + su * 0.95, CY + sy * 0.95, 0.12, 0.12, 0.09, PRUSSIA);
    }
    // Prusya mavisi dış halka, opal kadran, demir iç halka (kayıt dairesi), opal iç kadran — her daire 4 kutu (16 köşe)
    for (const [r, t, col, g] of [[1.08, 0.07, PRUSSIA, "solid"], [0.92, 0.09, DIAL, "glow"], [0.6, 0.095, IRON, "solid"], [0.54, 0.1, DIAL, "glow"]] as const)
      for (let i = 0; i < 4; i++) { const a = ((i + 0.5) / 4) * (Math.PI / 2); fb(b, F, o, CY, 2 * r * Math.cos(a), 2 * r * Math.sin(a), t, col, g); }
    for (let k = 0; k < 12; k++) {                                                         // 12 işaret (rakam yok)
      const a = (k * Math.PI) / 6, su = Math.sin(a), sy = Math.cos(a);
      const [w, h] = k % 3 ? [0.06, 0.06] : k % 6 ? [0.16, 0.07] : [0.07, 0.16];
      fb(b, F, o + su * 0.76, CY + sy * 0.76, w, h, 0.11, INK);
    }
    fb(b, F, o, CY + 0.33, 0.06, 0.66, 0.12, INK);                                         // yelkovan
    fb(b, F, o + 0.22, CY, 0.44, 0.07, 0.12, INK);                                         // akrep
    fb(b, F, o, CY, 0.14, 0.14, 0.13, GOLD);                                               // göbek
    fb(b, F, o, 12.2, 2.0, 0.14, 0.05, GOLD);                                              // yazıtsız yaldız kuşak
    fb(b, F, o, 14.62, 2.6, 0.14, 0.06, SAND_L);                                           // saçak
    for (const u of [-1, -0.5, 0, 0.5, 1]) fb(b, F, o + u, 14.82, 0.07, 0.26, 0.06, SAND_L);
    fb(b, F, o, 14.85, 0.6, 0.2, 0.05, SAND_L); fb(b, F, o, 15.02, 0.3, 0.14, 0.05, SAND_L); // orta alın
  }

  // çan katı (14,75–16,25): koyu çekirdek, yüz başına 3 taş ayak + sivri baş + panjur; siper
  b(X, 14.76, Z, 3.0, 0.12, 3.0, GOLD, "solid", 0);
  b(X, 15.5, Z, 2.2, 1.5, 2.2, "#3A3F47", "solid", 0);
  for (const [F, o] of faces4(X, Z, 1.1)) {
    for (const u of [-1.0, 0, 1.0]) fb(b, F, o + u, 15.5, 0.2, 1.5, 0.12, SAND_L);
    for (const u of [-0.5, 0.5]) {
      fb(b, F, o + u, 16.08, 0.8, 0.2, 0.12, SAND_L);
      fb(b, F, o + u, 15.9, 0.46, 0.16, 0.12, SAND_L);
      for (const y of [14.98, 15.28, 15.58]) fb(b, F, o + u, y, 0.66, 0.05, 0.06, "#565D66");
    }
  }
  b(X, 16.3, Z, 2.7, 0.14, 2.7, SAND_L, "solid", 0.01);
  for (const [F, o] of faces4(X, Z, 1.35)) for (const u of [-0.9, -0.3, 0.3, 0.9]) fb(b, F, o + u, 16.45, 0.18, 0.16, 0.04, SAND_L);

  // demir külah: taban katı + dört çatı penceresi + köşe pinaklleri, fener katı (gece ışık), tığlı kademeler, yaldız tepe
  b(X, 16.75, Z, 2.3, 0.76, 2.3, SPIRE, "solid", 0.02);
  for (const [F, o] of faces4(X, Z, 1.15)) {
    fb(b, F, o, 16.85, 0.7, 0.5, 0.12, SPIRE2);
    fb(b, F, o, 16.8, 0.3, 0.34, 0.14, WIN);
    fb(b, F, o, 17.2, 0.46, 0.2, 0.12, SPIRE2);
    fb(b, F, o, 17.36, 0.22, 0.14, 0.12, SPIRE2);
    fb(b, F, o, 17.47, 0.05, 0.1, 0.12, GOLD);
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pinnacle(b, X + sx * 1.05, 17.13, Z + sz * 1.05, 0.22, 1.1, SPIRE, GOLD);
  b(X, 17.56, Z, 1.5, 0.86, 1.5, "#F6E7B0", "glow", 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b(X + sx * 0.75, 17.56, Z + sz * 0.75, 0.14, 0.9, 0.14, SPIRE, "solid", 0);
  for (const [F, o] of faces4(X, Z, 0.75)) for (const u of [-0.25, 0.25]) fb(b, F, o + u, 17.56, 0.06, 0.86, 0.04, SPIRE);
  b(X, 18.04, Z, 1.8, 0.1, 1.8, SPIRE, "solid", 0.01);
  const ws = [1.5, 1.3, 1.1, 0.92, 0.76, 0.62, 0.5, 0.39, 0.29, 0.2];
  ws.forEach((w, q) => {
    const y = 18.09 + (q + 0.5) * 0.36;
    b(X, y, Z, w, 0.37, w, SPIRE, "solid", 0.02);
    if (q < 8) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b(X + sx * w / 2, y, Z + sz * w / 2, 0.07, 0.07, 0.07, GOLD, "solid", 0);
    if (q === 2) for (const [F, o] of faces4(X, Z, w / 2)) { fb(b, F, o, y, 0.22, 0.24, 0.08, SPIRE2); fb(b, F, o, y + 0.17, 0.1, 0.1, 0.08, SPIRE2); }
  });
  b(X, 21.77, Z, 0.16, 0.16, 0.16, GOLD, "solid", 0);
  b(X, 21.92, Z, 0.06, 0.14, 0.06, GOLD, "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ meclis (16 × 5; nehir cephesi −z)
function parlamentoHi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0, z0 } = c, Z = c.cz;
  const RX0 = x0 + 0.1, RX1 = x0 + 13.1, FZ = z0 + 0.35, BZ = z0 + 4.65, RC = (RX0 + RX1) / 2, RL = RX1 - RX0;
  b(c.cx, 0.15, Z, 16, 0.3, 5, SAND_D, "solid", 0.02);                                     // rıhtım terası
  b(RC, 1.85, (FZ + BZ) / 2, RL, 3.1, BZ - FZ, SAND, "solid", 0.02);                        // ana kütle (0,3–3,4)
  b(RC, 0.45, (FZ + BZ) / 2, RL + 0.1, 0.3, BZ - FZ + 0.1, SAND_D, "solid", 0.02);          // taban silmesi
  for (const y of [1.85, 3.42]) b(RC, y, (FZ + BZ) / 2, RL + 0.08, 0.08, BZ - FZ + 0.08, SAND_L, "solid", 0.01);
  const front: Face = { ax: "x", at: FZ, out: -1 }, back: Face = { ax: "x", at: BZ, out: 1 };
  const PAV = new Set([0, 4, 8, 12]);
  // payandalar (14): nehir yüzünde iki kademe + tığlı pinakl; arka yüzde tek kademe + sivri uç
  for (let k = 0; k <= 13; k++) {
    const x = RX0 + k;
    fb(b, front, x, 1.1, 0.16, 1.6, 0.26, SAND_L);
    fb(b, front, x, 2.65, 0.14, 1.5, 0.16, SAND_L);
    pinnacle(b, x, 3.4, FZ - 0.08, 0.13, 1.0, SAND_L, SAND_L);
    fb(b, back, x, 1.85, 0.14, 3.1, 0.16, SAND_L);
    spike(b, x, 3.4, BZ + 0.07, 0.12, 0.7, SAND_L);
  }
  // bölmeler: nehir yüzünde iki kat çift dikmeli sivri pencere (üst kat gece ışıklı), kör panel, siper dişleri; arka yüzde iki kat
  b(RC, 3.56, FZ - 0.03, RL, 0.2, 0.08, SAND, "solid", 0.01);
  b(RC, 3.56, BZ + 0.03, RL, 0.2, 0.08, SAND, "solid", 0.01);
  for (let k = 0; k < 13; k++) {
    const x = RX0 + k + 0.5;
    if (!PAV.has(k)) {
      gwin(b, front, x, 1.12, 0.42, 0.95, WIN, SAND_L, { mull: true });
      gwin(b, front, x, 2.52, 0.42, 0.85, WARM, SAND_L, { mull: true, g: "glow" });
      fb(b, front, x, 3.22, 0.5, 0.16, 0.02, SAND_L);
      for (const u of [-0.22, 0.22]) fb(b, front, x + u, 3.72, 0.14, 0.14, 0.04, SAND_L);
    }
    gwin(b, back, x, 1.15, 0.36, 0.9, WIN, SAND_L);
    gwin(b, back, x, 2.55, 0.36, 0.8, WARM, SAND_L, { g: "glow" });
  }
  // batı ucu (saat kulesine bakan yüz)
  const west: Face = { ax: "z", at: RX0, out: -1 };
  for (const u of [-1.3, 0, 1.3]) { gwin(b, west, Z + u, 1.15, 0.34, 0.9, WIN, SAND_L); gwin(b, west, Z + u, 2.55, 0.34, 0.8, WARM, SAND_L, { g: "glow" }); }
  // dik arduvaz çatı (5 kademe), demir sırt süsü, çatı pencereleri, iki havalandırma kulecik
  [4.0, 3.2, 2.4, 1.6, 0.8].forEach((d, q) => b(RC, 3.52 + q * 0.24, (FZ + BZ) / 2, RL - 0.1, 0.25, d, SLATE, "solid", 0.02));
  for (let q = 0; q < 25; q++) b(RX0 + 0.5 + q * 0.5, 4.68, (FZ + BZ) / 2, 0.04, 0.16, 0.04, IRON, "solid", 0);
  for (const k of [2, 6, 10]) for (const [zz, s] of [[FZ + 0.75, -1], [BZ - 0.75, 1]] as const) {
    const x = RX0 + k + 0.5;
    b(x, 3.82, zz, 0.3, 0.36, 0.3, SAND_L, "solid", 0.01);
    b(x, 3.82, zz + s * 0.15, 0.16, 0.2, 0.02, WIN, "solid", 0);
    b(x, 4.06, zz, 0.2, 0.14, 0.24, SLATE, "solid", 0.01);
  }
  for (const k of [3, 10]) {
    const x = RX0 + k, z = (FZ + BZ) / 2;
    disc(b, x, 4.85, z, 0.16, 0.5, SAND_L, 2);
    cone(b, x, 5.1, z, 0.18, 0.6, SPIRE, 4, 2);
  }
  // dört köşk (bölme 0, 4, 8, 12): öne çıkan gövde, üç kat pencere, iki köşe kulecik + pinakl, piramit demir başlık
  for (const k of PAV) {
    const px = RX0 + k + 0.5, z1 = z0 + 0.02, pz = (z1 + FZ + 0.3) / 2;
    b(px, 2.25, pz, 0.86, 3.9, FZ + 0.3 - z1, SAND, "solid", 0.02);
    const pf: Face = { ax: "x", at: z1, out: -1 };
    gwin(b, pf, px, 1.15, 0.32, 0.9, WIN, SAND_L, { mull: true });
    gwin(b, pf, px, 2.45, 0.32, 0.85, WARM, SAND_L, { mull: true, g: "glow" });
    gwin(b, pf, px, 3.5, 0.26, 0.5, WIN, SAND_L);
    fb(b, pf, px, 4.1, 0.9, 0.08, 0.04, SAND_L);
    for (const s of [-1, 1]) {
      b(px + s * 0.45, 2.4, z1 + 0.12, 0.14, 4.2, 0.14, SAND_L, "solid", 0.01);
      pinnacle(b, px + s * 0.45, 4.5, z1 + 0.12, 0.12, 0.7, SAND_L, GOLD);
    }
    [0.8, 0.6, 0.4, 0.2].forEach((w, q) => b(px, 4.31 + q * 0.22, pz, w, 0.23, Math.min(w + 0.1, FZ + 0.3 - z1), SPIRE, "solid", 0.02));
    b(px, 5.16, pz, 0.04, 0.16, 0.04, GOLD, "solid", 0);
  }
  // sekizgen merkez kulesi: kare taban + 4 pinakl, sekizgen fener (8 ışıklı pencere, 8 payanda + uç), tığlı sekizgen külah
  const mx = RX0 + 6.5, mz = Z + 0.2;
  b(mx, 4.7, mz, 1.3, 1.4, 1.3, SAND_L, "solid", 0.02);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pinnacle(b, mx + sx * 0.6, 5.4, mz + sz * 0.6, 0.14, 0.8, SAND_L, GOLD);
  disc(b, mx, 6.3, mz, 0.6, 1.8, SAND, 3);
  for (const [px, pz] of around(8, 0.58, 0)) {
    b(mx + px, 6.3, mz + pz, 0.16, 1.1, 0.16, WARM, "glow", 0);
    b(mx + px, 6.93, mz + pz, 0.1, 0.16, 0.1, WARM, "glow", 0);
  }
  for (const [px, pz] of around(8, 0.6, 0.5)) {
    b(mx + px, 6.3, mz + pz, 0.1, 1.8, 0.1, SAND_L, "solid", 0.01);
    b(mx + px, 7.45, mz + pz, 0.08, 0.5, 0.08, SAND_L, "solid", 0.01);
    b(mx + px, 7.75, mz + pz, 0.04, 0.1, 0.04, GOLD, "solid", 0);
  }
  disc(b, mx, 7.25, mz, 0.66, 0.1, SAND_L, 3);
  for (let q = 0; q < 10; q++) {
    const r = 0.55 * (1 - (q + 0.3) / 10.5), y = 7.3 + (q + 0.5) * 0.56;
    disc(b, mx, y, mz, Math.max(0.04, r), 0.57, SPIRE, 2);
    if (q % 2 === 1 && q < 9) for (const [px, pz] of around(8, r, 0.5)) b(mx + px, y, mz + pz, 0.05, 0.05, 0.05, GOLD, "solid", 0);
  }
  b(mx, 12.98, mz, 0.06, 0.16, 0.06, GOLD, "solid", 0);
  // doğu ucunda büyük kare kule (bayraksız)
  const vx = x0 + 14.5;
  b(vx, 6.0, Z, 2.6, 11.8, 2.6, SAND, "solid", 0.02);
  b(vx, 0.55, Z, 2.8, 0.5, 2.8, SAND_D, "solid", 0.02);
  for (const y of [3.3, 5.5, 7.7, 9.9, 11.85]) b(vx, y, Z, 2.7, 0.1, 2.7, SAND_L, "solid", 0.01);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = vx + sx * 1.3, pz = Z + sz * 1.3;
    disc(b, px, 6.4, pz, 0.27, 12.6, SAND_L, 2);
    for (const y of [3.3, 5.5, 7.7, 9.9, 11.9]) disc(b, px, y, pz, 0.31, 0.1, SAND_L, 2);
    pinnacle(b, px, 12.7, pz, 0.36, 1.3, SAND_L, GOLD);
  }
  for (const [F, o] of faces4(vx, Z, 1.3)) {
    const entrance = F.ax === "x" && F.out === -1;
    for (const u of [-0.45, 0.45]) fb(b, F, o + u, 7.55, 0.07, 8.5, 0.05, SAND_L);
    for (const [y, h, g] of [[4.4, 1.0, "solid"], [6.6, 1.0, "solid"], [8.8, 1.0, "solid"], [10.9, 0.9, "glow"]] as const)
      for (const u of [-0.875, 0, 0.875]) gwin(b, F, o + u, y, 0.3, h, g === "glow" ? WARM : WIN, SAND_L, { g });
    if (!entrance) for (const u of [-0.875, 0, 0.875]) { fb(b, F, o + u, 1.9, 0.22, 0.7, 0.04, NICHE); fb(b, F, o + u, 2.36, 0.3, 0.12, 0.07, SAND_L); }
    for (const u of [-1.0, -0.5, 0, 0.5, 1.0]) fb(b, F, o + u, 12.12, 0.18, 0.26, 0.06, SAND_L);
  }
  {
    // tören girişi: kemerli kapı, yaldız ızgara, sövele, iki kat kemer alnı, yanlarda boş nişler (heykelsiz)
    const F: Face = { ax: "x", at: Z - 1.3, out: -1 };
    fb(b, F, vx, 1.45, 1.1, 2.3, 0.03, DOOR);
    fb(b, F, vx, 2.75, 0.8, 0.3, 0.03, DOOR);
    fb(b, F, vx, 2.98, 0.45, 0.18, 0.03, DOOR);
    for (const u of [-0.36, -0.18, 0, 0.18, 0.36]) fb(b, F, vx + u, 1.25, 0.04, 1.8, 0.05, GOLD);
    for (const s of [-1, 1]) {
      fb(b, F, vx + s * 0.62, 1.45, 0.12, 2.3, 0.08, SAND_L);
      fb(b, F, vx + s * 1.0, 1.7, 0.2, 0.8, 0.04, NICHE);
      fb(b, F, vx + s * 1.0, 2.16, 0.28, 0.12, 0.07, SAND_L);
    }
    fb(b, F, vx, 2.95, 1.3, 0.12, 0.08, SAND_L);
    fb(b, F, vx, 3.14, 0.8, 0.1, 0.08, SAND_L);
  }
  b(vx, 11.95, Z, 2.9, 0.12, 2.9, SAND_L, "solid", 0.01);
  [2.3, 1.8, 1.3, 0.8, 0.4].forEach((w, q) => b(vx, 12.0 + (q + 0.5) * 0.38, Z, w, 0.39, w, SPIRE, "solid", 0.02));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b(vx + sx * 0.18, 14.0, Z + sz * 0.18, 0.05, 0.2, 0.05, GOLD, "solid", 0);
  b(vx, 14.1, Z, 0.08, 0.4, 0.08, GOLD, "solid", 0);
  return out;
}

// ------------------------------------------------------------------------------------------ açılır köprü (ayak izi doğu ayağı 1 × 2)
const STONE = "#C9BFAE", STONE_L = "#DCD3C0", GRANITE = "#8E8A80", BLUE = "#5C8FB8", BLUE_D = "#3F6E96", WHITE = "#EEF1F3";
function kopruHi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const DX = c.x0 - 1.5, Zs = c.z0 + 1, Zn = c.z0 + 8, oz = c.z0 - 14, DZ = oz + 18;
  // güverte: kenar kirişleri, korkuluk + dikmeler, alt enine kirişler, açılır kanat kirişleri ve derzleri, fenerler
  for (const s of [-1.55, 1.55]) {
    b(DX + s, -0.25, DZ, 0.2, 0.5, 13.6, BLUE, "solid", 0);
    b(DX + s * 0.97, 0.35, DZ, 0.08, 0.7, 13.6, WHITE, "solid", 0);
    b(DX + s * 0.97, 0.72, DZ, 0.1, 0.05, 13.6, BLUE_D, "solid", 0);
    for (let q = 0; q < 17; q++) b(DX + s * 0.97, 0.4, oz + 11.6 + q * 0.8, 0.1, 0.8, 0.1, BLUE_D, "solid", 0);
    for (const z of [oz + 12.6, oz + 16.0, DZ, oz + 20.0, oz + 23.4]) {
      b(DX + s * 0.97, 1.0, z, 0.07, 1.3, 0.07, IRON, "solid", 0);
      b(DX + s * 0.97, 1.72, z, 0.14, 0.16, 0.14, "#FFDDA0", "glow", 0);
    }
  }
  for (let q = 0; q < 19; q++) b(DX, -0.3, oz + 11.5 + q * 0.72, 3.0, 0.12, 0.1, BLUE_D, "solid", 0);
  for (const u of [-1.1, -0.37, 0.37, 1.1]) b(DX + u, -0.42, (Zs + Zn) / 2, 0.12, 0.3, 4.4, BLUE, "solid", 0);
  for (const z of [Zs + 1.32, (Zs + Zn) / 2, Zn - 1.32]) b(DX, 0.02, z, 2.8, 0.03, 0.06, "#8A939E", "solid", 0);
  for (const Z of [Zs, Zn]) {
    // granit ayak + iki yanda mahmuz (akıntı burnu), su hattında silme
    b(DX, -0.5, Z, 5.4, 0.9, 3.0, GRANITE, "solid", 0.03);
    for (const s of [-1, 1]) { b(DX + s * 2.95, -0.5, Z, 0.5, 0.9, 2.0, GRANITE, "solid", 0.03); b(DX + s * 3.3, -0.5, Z, 0.2, 0.9, 1.0, GRANITE, "solid", 0.03); }
    b(DX, -0.03, Z, 5.5, 0.08, 3.1, "#A8A397", "solid", 0.02);
    // ayaklar (güverteyi açık bırakır): taban kuşağı, iç yüzde asansör/merdiven kapısı, dış yüzde iki pencere
    for (const s of [-2, 2]) {
      b(DX + s, 1.7, Z, 1.0, 3.4, 2.4, STONE, "solid", 0.02);
      b(DX + s, 0.25, Z, 1.06, 0.5, 2.46, GRANITE, "solid", 0.02);
      fb(b, { ax: "z", at: DX + s * 0.75, out: s > 0 ? -1 : 1 }, Z, 0.75, 0.5, 1.1, 0.03, DOOR);
      const of: Face = { ax: "z", at: DX + s * 1.25, out: s > 0 ? 1 : -1 };
      for (const y of [1.4, 2.6]) gwin(b, of, Z, y, 0.26, 0.6, WIN, STONE_L);
    }
    // sivri kemer (5 kademe) — açıklığın üstü 2,35'ten yukarıda
    [1.45, 1.35, 1.15, 0.85, 0.4].forEach((hw, q) => {
      for (const s of [-1, 1]) b(DX + s * (hw + (1.5 - hw) / 2), 2.45 + q * 0.2, Z, 1.5 - hw, 0.2, 2.4, STONE_L, "solid", 0.01);
    });
    b(DX, 3.55, Z, 5.0, 0.4, 2.6, STONE_L, "solid", 0);
    // kule gövdesi: pencere katları (orta kat gece ışıklı), kat silmeleri, siper
    b(DX, 6.0, Z, 4.6, 4.5, 2.5, STONE, "solid", 0.02);
    for (const y of [5.4, 6.85]) b(DX, y, Z, 4.7, 0.08, 2.6, STONE_L, "solid", 0.01);
    for (const sz of [-1, 1]) {
      const F: Face = { ax: "x", at: Z + sz * 1.25, out: sz as 1 | -1 };
      for (const u of [-1.3, -0.45, 0.45, 1.3]) {
        gwin(b, F, DX + u, 4.65, 0.26, 0.7, WIN, STONE_L);
        gwin(b, F, DX + u, 6.1, 0.34, 0.95, WARM, STONE_L, { mull: true, g: "glow" });
        gwin(b, F, DX + u, 7.55, 0.26, 0.6, WIN, STONE_L);
      }
      for (let q = 0; q < 6; q++) fb(b, { ...F, at: Z + sz * 1.4 }, DX - 1.875 + q * 0.75, 8.55, 0.22, 0.2, 0.05, STONE_L);
    }
    for (const sx of [-1, 1]) {
      const F: Face = { ax: "z", at: DX + sx * 2.3, out: sx as 1 | -1 };
      for (const u of [-0.42, 0.42]) for (const [y, h] of [[4.65, 0.7], [6.1, 0.9], [7.55, 0.6]] as const) gwin(b, F, Z + u, y, 0.24, h, WIN, STONE_L);
    }
    b(DX, 8.35, Z, 5.2, 0.2, 2.8, STONE_L, "solid", 0);
    // sekizgen köşe kuleleri: kuşaklar, kurşun külah, yaldız uç
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const px = DX + sx * 2.35, pz = Z + sz * 1.2;
      disc(b, px, 5.0, pz, 0.32, 10.0, STONE_L, 2);
      for (const y of [3.4, 5.4, 6.85, 8.35]) disc(b, px, y, pz, 0.36, 0.1, STONE_L, 2);
      cone(b, px, 10.0, pz, 0.36, 1.0, SPIRE, 5, 2);
      b(px, 11.1, pz, 0.06, 0.2, 0.06, GOLD, "solid", 0);
    }
    // dik çatı (8 kademe), çatı pencereleri, sırt süsü, fener + yaldız çubuk
    for (let q = 0; q < 8; q++) {
      const f = 1 - q / 8, y = 8.45 + (q + 0.5) * 0.35;
      b(DX, y, Z, 0.4 + 3.8 * f, 0.36, 0.3 + 2.0 * f, SPIRE, "solid", 0.02);
    }
    for (const sz of [-1, 1]) for (const u of [-0.9, 0, 0.9]) {
      b(DX + u, 9.0, Z + sz * 0.95, 0.3, 0.4, 0.26, STONE_L, "solid", 0.01);
      b(DX + u, 9.0, Z + sz * 1.08, 0.14, 0.22, 0.02, WIN, "solid", 0);
      b(DX + u, 9.26, Z + sz * 0.95, 0.18, 0.14, 0.2, SPIRE, "solid", 0.01);
    }
    for (const sx of [-1, 1]) { b(DX + sx * 1.55, 9.0, Z, 0.26, 0.4, 0.3, STONE_L, "solid", 0.01); b(DX + sx * 1.55, 9.26, Z, 0.2, 0.14, 0.18, SPIRE, "solid", 0.01); }
    for (const u of [-0.15, 0.15]) b(DX + u, 11.33, Z, 0.04, 0.16, 0.04, IRON, "solid", 0);
    b(DX, 11.45, Z, 0.3, 0.4, 0.3, SPIRE, "solid", 0.02);
    b(DX, 11.7, Z, 0.16, 0.12, 0.16, GOLD, "solid", 0);
    b(DX, 12.4, Z, 0.1, 1.5, 0.1, GOLD, "solid", 0);
  }
  // yüksek geçitler: mavi alt/üst başlık, cam taban, camlı iç kabuk, çatı; iki yüzde beyaz kafes (dikme + X örgü)
  const wz = (Zs + Zn) / 2, wl = Zn - Zs - 2.5, wa = wz - wl / 2, NP = 8, pl = wl / NP;
  for (const s of [-1, 1]) {
    const x = DX + s * 1.4;
    b(x, 8.5, wz, 0.5, 0.2, wl, BLUE, "solid", 0);
    b(x, 9.2, wz, 0.5, 0.2, wl, BLUE, "solid", 0);
    b(x, 8.62, wz, 0.4, 0.04, wl, "#BFD9E6", "glass", 0);
    b(x, 8.85, wz, 0.46, 0.5, wl, "#9CC3D6", "glass", 0);
    b(x, 9.33, wz, 0.56, 0.06, wl, BLUE_D, "solid", 0);
    for (const fx of [-0.25, 0.25]) {
      for (let q = 0; q <= NP; q++) b(x + fx, 8.85, wa + q * pl, 0.05, 0.5, 0.06, WHITE, "solid", 0);
      for (let q = 0; q < NP; q++) for (const f of [0.25, 0.5, 0.75]) {
        b(x + fx, 8.6 + f * 0.5, wa + (q + f) * pl, 0.05, 0.12, 0.14, WHITE, "solid", 0);
        if (f !== 0.5) b(x + fx, 9.1 - f * 0.5, wa + (q + f) * pl, 0.05, 0.12, 0.14, WHITE, "solid", 0);
      }
    }
  }
  // asma zincirler: kuleden kıyı ayak kulesine üst başlık (mavi), kule yanında alt başlık + beyaz kafes, askı çubukları güverte kirişine
  const N = 16;
  for (const [Z, dir, end] of [[Zs, -1, oz + 11.5], [Zn, 1, oz + 24.5]] as const) for (const s of [-1, 1]) {
    const x = DX + s * 1.9, z0c = Z + dir * 1.2, len = Math.abs(end - z0c) / N;
    const yAt = (f: number) => 1.7 + 6.2 * Math.pow(1 - f, 1.6);
    for (let k = 0; k < N; k++) {
      const f0 = k / N, f1 = (k + 1) / N, z = z0c + (end - z0c) * ((k + 0.5) / N);
      b(x, (yAt(f0) + yAt(f1)) / 2, z, 0.16, Math.abs(yAt(f0) - yAt(f1)) + 0.16, len + 0.06, BLUE, "solid", 0);
      const fm = (k + 0.5) / N;
      if (fm < 0.6) {
        const dep = 0.5 * (1 - fm / 0.6), yl = (yAt(f0) + yAt(f1)) / 2 - dep;
        b(x, yl, z, 0.12, Math.abs(yAt(f0) - yAt(f1)) + 0.12, len + 0.06, BLUE_D, "solid", 0);
        if (k % 2 === 0) b(x, yl + dep / 2, z, 0.06, dep, 0.06, WHITE, "solid", 0);
      }
      const yh = yAt(fm) - (fm < 0.6 ? 0.5 * (1 - fm / 0.6) : 0) - 0.08;
      if (k % 2 === 1 && yh > 2.0) {
        b(DX + s * 1.6, yh / 2, z, 0.05, yh, 0.05, WHITE, "solid", 0);
        b(DX + s * 1.75, yh, z, 0.32, 0.06, 0.06, WHITE, "solid", 0);
      }
    }
    b(x, 0.9, end, 0.6, 1.8, 0.6, STONE, "solid", 0.02);
    b(x, 1.2, end, 0.66, 0.08, 0.66, STONE_L, "solid", 0.01);
    b(x, 1.95, end, 0.36, 0.3, 0.36, SPIRE, "solid", 0.02);
    b(x, 2.17, end, 0.2, 0.14, 0.2, SPIRE, "solid", 0.02);
    b(x, 2.3, end, 0.05, 0.12, 0.05, GOLD, "solid", 0);
  }
  return out;
}

// ------------------------------------------------------------------------------------------ kubbeli katedral (16 × 10; batı cephesi −x)
const PORT = "#E4DED0", PORT2 = "#C9C1AE", LEAD = "#7F8A94", COL = "#F4F1EA";
/** Yuvarlak kemerli pencere + alınlıklı çerçeve (aedikül). Kutu 7. */
function rwin(b: Sink, f: Face, u: number, y: number, w: number, h: number, glass: string, stone: string) {
  fb(b, f, u, y, w, h, 0.03, glass);
  fb(b, f, u, y + h / 2 + w * 0.1, w * 0.7, w * 0.2, 0.03, glass);
  for (const s of [-1, 1]) fb(b, f, u + s * (w / 2 + 0.04), y + 0.05, 0.06, h + 0.2, 0.05, stone);
  fb(b, f, u, y + h / 2 + w * 0.35, w + 0.2, 0.07, 0.06, stone);
  fb(b, f, u, y + h / 2 + w * 0.35 + 0.07, w * 0.6, 0.07, 0.06, stone);
  fb(b, f, u, y - h / 2 - 0.04, w + 0.16, 0.06, 0.07, stone);
}

function katedralHi(c: LandmarkCtx): Block[] {
  const out: Block[] = [], b = sink(out);
  const { x0 } = c, Z = c.cz, Xd = x0 + 9, NX = x0 + 7.75, NL = 13.5;
  b(c.cx, 0.05, Z, 16, 0.1, 10, PORT2, "solid", 0.02);                                     // kilise avlusu taşı (yürünür)
  b(NX, 2.2, Z, NL, 4.4, 4, PORT, "solid", 0.02);                                           // nef
  b(Xd, 2.2, Z, 4, 4.4, 9.4, PORT, "solid", 0.02);                                          // transept
  b(NX, 0.25, Z, NL + 0.1, 0.3, 4.1, PORT2, "solid", 0.02); b(Xd, 0.25, Z, 4.1, 0.3, 9.5, PORT2, "solid", 0.02);
  for (const y of [2.2, 4.45]) { b(NX, y, Z, NL + 0.12, 0.12, 4.12, PORT2, "solid", 0.01); b(Xd, y, Z, 4.12, 0.12, 9.52, PORT2, "solid", 0.01); }
  b(NX, 4.75, Z, NL - 0.1, 0.5, 3.4, LEAD, "solid", 0.02); b(Xd, 4.75, Z, 3.4, 0.5, 9.0, LEAD, "solid", 0.02);
  // iki katlı yan cepheler: alt düzen pilastr + alınlıklı pencere, üst perde duvar pilastr + kör niş + çelenk paneli
  const bay = (F: Face, u: number) => {
    rwin(b, F, u, 1.15, 0.38, 0.85, WIN, PORT2);
    fb(b, F, u, 3.2, 0.34, 0.9, 0.02, PORT2); fb(b, F, u, 3.72, 0.22, 0.12, 0.02, PORT2); fb(b, F, u, 3.98, 0.5, 0.12, 0.03, PORT2);
  };
  const pil = (F: Face, u: number) => {
    fb(b, F, u, 1.25, 0.18, 1.85, 0.08, COL); fb(b, F, u, 2.08, 0.24, 0.08, 0.1, PORT2); fb(b, F, u, 3.3, 0.14, 2.0, 0.06, PORT2);
  };
  for (const sz of [-1, 1] as const) {
    const F: Face = { ax: "x", at: Z + sz * 2, out: sz };
    for (const u of [2.3, 3.4, 4.5, 5.6, 11.6, 12.7, 13.8]) bay(F, x0 + u);
    for (const u of [1.85, 2.85, 3.95, 5.05, 6.15, 11.05, 12.15, 13.25, 14.35]) pil(F, x0 + u);
    // korkuluk: kaide, babalar (0,5 aralık), küpeşte
    for (const [a, e] of [[x0 + 1.8, x0 + 7], [x0 + 11, x0 + 14.4]] as const) {
      b((a + e) / 2, 4.56, Z + sz * 1.95, e - a, 0.1, 0.12, PORT2, "solid", 0.01);
      for (let x = a + 0.25; x < e - 0.1; x += 0.5) b(x, 4.71, Z + sz * 1.95, 0.07, 0.2, 0.07, PORT2, "solid", 0);
      b((a + e) / 2, 4.84, Z + sz * 1.95, e - a, 0.06, 0.12, PORT2, "solid", 0.01);
    }
  }
  for (const sx of [-1, 1] as const) {
    const F: Face = { ax: "z", at: Xd + sx * 2, out: sx };
    for (const u of [-3.9, -2.8, 2.8, 3.9]) bay(F, Z + u);
    for (const u of [-4.45, -3.35, -2.25, 2.25, 3.35, 4.45]) pil(F, Z + u);
    for (const [a, e] of [[Z - 4.6, Z - 2.1], [Z + 2.1, Z + 4.6]] as const) {
      b(Xd + sx * 1.95, 4.56, (a + e) / 2, 0.12, 0.1, e - a, PORT2, "solid", 0.01);
      for (let z = a + 0.25; z < e - 0.1; z += 0.5) b(Xd + sx * 1.95, 4.71, z, 0.07, 0.2, 0.07, PORT2, "solid", 0);
      b(Xd + sx * 1.95, 4.84, (a + e) / 2, 0.12, 0.06, e - a, PORT2, "solid", 0.01);
    }
  }
  // transept uçları: altı sütunlu sığ revak, saçak, kapı, üst pencere, kademeli alınlık (kabartmasız)
  for (const sz of [-1, 1] as const) {
    const F: Face = { ax: "x", at: Z + sz * 4.7, out: sz };
    for (let q = 0; q < 6; q++) {
      const x = Xd - 1.5 + q * 0.6;
      fb(b, F, x, 0.2, 0.22, 0.12, 0.22, PORT2);
      fb(b, F, x, 1.25, 0.14, 2.0, 0.2, COL);
      fb(b, F, x, 2.28, 0.22, 0.08, 0.22, PORT2);
    }
    fb(b, F, Xd, 2.4, 3.6, 0.18, 0.24, PORT2);
    fb(b, F, Xd, 0.9, 0.6, 1.4, 0.03, DOOR);
    rwin(b, F, Xd, 3.35, 0.5, 1.0, WIN, PORT2);
    [3.8, 2.8, 1.8, 0.8].forEach((w, q) => fb(b, F, Xd, 4.62 + q * 0.22, w, 0.23, 0.05, PORT2));
  }
  // batı cephesi: basamak, alt düzen 6 çift sütun, saçaklık, üst düzen 4 çift sütun, saçaklık, kademeli alınlık, üç kapı, iki pencere
  b(x0 + 0.42, 0.15, Z, 0.84, 0.1, 3.9, PORT2, "solid", 0.02);
  for (const zc of [-1.5, -0.9, -0.3, 0.3, 0.9, 1.5]) {
    for (const s of [-1, 1]) b(x0 + 0.3, 1.21, Z + zc + s * 0.09, 0.14, 1.9, 0.12, COL, "solid", 0.01);
    b(x0 + 0.3, 0.24, Z + zc, 0.2, 0.08, 0.36, PORT2, "solid", 0);
    b(x0 + 0.3, 2.2, Z + zc, 0.2, 0.08, 0.36, PORT2, "solid", 0);
  }
  b(x0 + 0.5, 2.34, Z, 1.0, 0.2, 3.8, PORT2, "solid", 0.02);
  for (const zc of [-0.9, -0.3, 0.3, 0.9]) {
    for (const s of [-1, 1]) b(x0 + 0.45, 3.3, Z + zc + s * 0.08, 0.12, 1.72, 0.1, COL, "solid", 0.01);
    b(x0 + 0.45, 4.19, Z + zc, 0.18, 0.06, 0.32, PORT2, "solid", 0);
  }
  b(x0 + 0.62, 4.27, Z, 0.76, 0.12, 2.8, PORT2, "solid", 0.02);
  [3.0, 2.3, 1.6, 0.9, 0.35].forEach((w, q) => b(x0 + 0.62, 4.43 + q * 0.2, Z, 0.5, 0.21, w, PORT2, "solid", 0.02));
  const wf: Face = { ax: "z", at: x0 + 1, out: -1 };
  fb(b, wf, Z, 0.9, 0.7, 1.4, 0.03, DOOR);
  for (const s of [-1, 1]) { fb(b, wf, Z + s * 1.2, 0.8, 0.45, 1.1, 0.03, DOOR); rwin(b, wf, Z + s * 0.6, 3.3, 0.32, 0.8, WIN, PORT2); }
  // iki batı kulesi: alt gövde + pencereler, sütun kümeli çan katı, sütunlu kasnak, kurşun soğanımsı başlık, yaldız tepe
  for (const s of [-1, 1] as const) {
    const tx = x0 + 1.0, tz = Z + s * 2.6;
    b(tx, 2.2, tz, 1.6, 4.4, 1.6, PORT, "solid", 0.02);
    b(tx, 4.47, tz, 1.7, 0.12, 1.7, PORT2, "solid", 0.01);
    const of: Face = { ax: "x", at: tz + s * 0.8, out: s }, wfa: Face = { ax: "z", at: tx - 0.8, out: -1 };
    for (const y of [1.3, 3.2]) { rwin(b, of, tx, y, 0.32, 0.75, WIN, PORT2); rwin(b, wfa, tz, y, 0.32, 0.75, WIN, PORT2); }
    b(tx, 5.45, tz, 1.1, 1.9, 1.1, PORT, "solid", 0.02);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b(tx + sx * 0.62, 5.42, tz + sz * 0.5, 0.1, 1.84, 0.1, COL, "solid", 0.01);
      b(tx + sx * 0.5, 5.42, tz + sz * 0.62, 0.1, 1.84, 0.1, COL, "solid", 0.01);
    }
    for (const [F, o] of faces4(tx, tz, 0.55)) { fb(b, F, o, 5.3, 0.36, 0.95, 0.03, WIN); fb(b, F, o, 5.84, 0.24, 0.1, 0.03, WIN); }
    b(tx, 6.4, tz, 1.45, 0.14, 1.45, PORT2, "solid", 0.01);
    disc(b, tx, 6.95, tz, 0.48, 0.96, PORT, 2);
    for (const [px, pz] of around(8, 0.52, 0.5)) b(tx + px, 6.95, tz + pz, 0.07, 0.94, 0.07, COL, "solid", 0);
    disc(b, tx, 7.48, tz, 0.56, 0.1, PORT2, 2);
    [0.45, 0.4, 0.3, 0.22, 0.17, 0.12].forEach((r, q) => disc(b, tx, 7.59 + q * 0.12, tz, r, 0.13, LEAD, 2));
    b(tx, 8.35, tz, 0.14, 0.2, 0.14, GOLD, "solid", 0);
    b(tx, 8.5, tz, 0.06, 0.1, 0.06, GOLD, "solid", 0);
  }
  // kubbe: kaide kasnağı, sütun halkası (32 sütun, her dördüncü ara dolu), saçaklık, taş galeri korkuluğu, pilastrlı üst kasnak
  // (gece ışıklı 8 pencere), kaburgalı kurşun kubbe, altın galeri, sütunlu fener, yaldız top ve uç (haç yok)
  disc(b, Xd, 5.15, Z, 2.6, 1.5, PORT, 3);
  disc(b, Xd, 5.96, Z, 3.0, 0.12, PORT2, 12); // COLUMN-CONT-001: k 6 → 12 — basamak çentiğinde 2,78'deki sütunlar havadaydı
  disc(b, Xd, 6.7, Z, 2.35, 1.4, PORT, 3);
  for (const [px, pz] of around(32, 2.78, 0.5)) {
    b(Xd + px, 6.67, Z + pz, 0.13, 1.3, 0.13, COL, "solid", 0.01);
    b(Xd + px, 7.3, Z + pz, 0.18, 0.06, 0.18, PORT2, "solid", 0);
  }
  for (const [px, pz] of around(8, 2.62, 0)) b(Xd + px, 6.67, Z + pz, 0.34, 1.3, 0.34, PORT, "solid", 0.01);
  disc(b, Xd, 7.4, Z, 3.0, 0.14, PORT2, 6);
  for (const [px, pz] of around(24, 2.86, 0.5)) b(Xd + px, 7.58, Z + pz, 0.06, 0.22, 0.06, PORT2, "solid", 0);
  disc(b, Xd, 7.95, Z, 2.2, 1.0, PORT, 3);
  for (const [px, pz] of around(16, 2.2, 0.5)) b(Xd + px, 7.95, Z + pz, 0.12, 0.95, 0.12, PORT2, "solid", 0);
  for (const [px, pz] of around(8, 2.16, 0.25)) b(Xd + px, 7.95, Z + pz, 0.2, 0.5, 0.2, WARM, "glow", 0);
  disc(b, Xd, 8.48, Z, 2.3, 0.1, PORT2, 3);
  ribbedDome(b, Xd, 8.5, Z, 2.2, 3.3, LEAD, { steps: 8, k: 6, ribs: 16, ribColor: "#8E99A3" });
  disc(b, Xd, 11.86, Z, 0.7, 0.08, PORT2, 2);
  for (const [px, pz] of around(8, 0.66, 0.5)) b(Xd + px, 12.0, Z + pz, 0.05, 0.2, 0.05, PORT2, "solid", 0);
  b(Xd, 12.4, Z, 0.6, 1.0, 0.6, PORT, "solid", 0.02);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b(Xd + sx * 0.36, 12.42, Z + sz * 0.36, 0.14, 0.84, 0.14, COL, "solid", 0.01);
  for (const [F, o] of faces4(Xd, Z, 0.3)) fb(b, F, o, 12.45, 0.2, 0.5, 0.03, WIN);
  b(Xd, 12.94, Z, 0.85, 0.1, 0.85, PORT2, "solid", 0.01);
  ribbedDome(b, Xd, 12.99, Z, 0.4, 0.45, LEAD, { steps: 3, k: 2 });
  b(Xd, 13.52, Z, 0.12, 0.16, 0.12, GOLD, "solid", 0);
  b(Xd, 13.72, Z, 0.28, 0.26, 0.28, GOLD, "solid", 0);
  b(Xd, 14.2, Z, 0.07, 0.7, 0.07, GOLD, "solid", 0);
  // doğu apsisi: yarım daire gövde, pilastrlar, pencereler, saçak, kurşun yarım kubbe
  const AX = x0 + 14.5;
  halfDisc(b, AX, 2.0, Z, 1.5, 4.0, 1, 0, PORT, 3);
  for (const a of [-60, -30, 0, 30, 60]) { const r = (a * Math.PI) / 180; b(AX + Math.cos(r) * 1.45, 2.0, Z + Math.sin(r) * 1.45, 0.14, 3.8, 0.14, COL, "solid", 0.01); }
  for (const a of [-45, -15, 15, 45]) { const r = (a * Math.PI) / 180; b(AX + Math.cos(r) * 1.42, 1.5, Z + Math.sin(r) * 1.42, 0.16, 0.9, 0.16, WIN, "solid", 0); }
  halfDisc(b, AX, 4.05, Z, 1.56, 0.12, 1, 0, PORT2, 3);
  semiDome(b, AX, 4.1, Z, 1.4, 0.9, 1, 0, LEAD, { steps: 3, k: 2 });
  return out;
}

// ------------------------------------------------------------------------------------------ kayıt
export const LONDRA_HIRES_MAP: HiResMapEntry[] = [
  { map: "londra", landmark: "saat_kulesi", hi: saatHi },
  { map: "londra", landmark: "parlamento", hi: parlamentoHi },
  // köprü: ayak izi doğu ayağı (1 × 2); izinli bölge güverte, kuleler, mahmuzlar ve kıyı ayak kuleleri (yerel karo)
  { map: "londra", landmark: "kule_koprusu", hi: kopruHi, zone: [[-5, -3, 7, 14]] },
  { map: "londra", landmark: "kubbeli_katedral", hi: katedralHi },
];
/** Taban sahne (`scenes/londra.ts`) simge bölgeleri henüz işaretli değil (zones → landmark yok); sahne kademesi sonraki iş. */
export const LONDRA_HIRES_SCENE: HiResSceneEntry[] = [];
