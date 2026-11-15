/**
 * HERO-PACKS — "Efsane Ekibi" / Legend Squad (özgün süper kahraman takımı; büyük set: 6 kostüm, 2 masa yoldaşı, 1 kutlama).
 *
 * Arketipler özgün: pelerinli uçucu, gölge dedektifi, zırhlı mucit, rüzgâr koşucusu, biçim değiştiren, kozmik muhafız. Bilinçli olarak ikonik OLMAYAN renk ve
 * motif: kırmızı/mavi + ağ, siyah + sivri kulak + yarasa, kırmızı pelerin + harfli kalkan, kırmızı/altın zırh + göğüs diski,
 * kırmızı/sarı + şimşek, yeşil yüzük yok. Amblemler özgün soyut gliflerdir; yazı ya da harf yok. Kulüp renk çiftlerinden
 * (sarı-kırmızı, sarı-lacivert, siyah-beyaz, bordo-mavi) kaçınıldı.
 */
import { backCape, eyeBand, glyph, suit } from "../kit";
import type { CosmeticSet, SceneBox } from "../registry";

// Gök Muhafızı: deniz yeşili + bakır + krem (kuyruklu yıldız glifi; harf yok)
const SKY = "#0F766E", SKY_D = "#0B5A54", COPPER = "#C2703D", CREAM = "#F3E6CF";
const COMET = ["...XX", "..XXX", ".XX..", "XX...", "X...."];
// Gölge Dedektifi: mürdüm palto + arduvaz şapka + hardal atkı (pelerin yok, kulak yok, amblem yok)
const PLUM = "#4A2545", PLUM_D = "#361A33", SLATE = "#334155", MUSTARD = "#C9A227";
// Çark Mucidi: nane + grafit zırh, sırt aleti, altıgen göğüs paneli (disk yok)
const MINT = "#5FD3B0", GRAPH = "#2F3A40", GRAPH_L = "#4B5A62", HEXGLOW = "#A7F3D0";
// Rüzgâr Koşucusu: menekşe + beyaz rüzgâr çizgileri + limon iz (şimşek yok, başta kanat yok)
const VIOLET = "#6D28D9", VIOLET_D = "#4C1D95", WHITE = "#F8FAFC", LIME = "#BEF264";
// Biçim Değiştiren: mercan → krem yatay geçiş bantları (karo/elmas harlequin deseni yok, mavi ten yok)
const CORAL = "#E76F51", CORAL_L = "#F4A261", SAND = "#F6E7D0", STONE = "#475569";
// Kozmik Muhafız: gece moru + kutup yeşili ışık çizgileri, beş noktalı yörünge glifi (gümüş beden, yıldız göğüs yok)
const NIGHT = "#2A1F45", NIGHT_D = "#1C1530", AURORA = "#5EEAD4", STARDOT = "#E9D5FF";
const ORBIT = ["X...X", ".....", "..X..", ".....", "X...X"];

/** Kuyruklu yıldız geçişi: krem çekirdek ve bakır kuyruk yay çizerek geçer; statik hâl: gökte duran yıldız + kuyruk + üç nokta. */
function cometPass(t: number, calm: boolean): SceneBox[] {
  const out: SceneBox[] = [];
  const u = calm ? 0.5 : t;
  const x = -30 + u * 60, y = 14 + Math.sin(u * Math.PI) * 14;
  out.push({ p: [x, y, 0], s: [3, 3, 3], c: CREAM, glow: true });
  for (let k = 1; k <= 7; k++) {
    const s = 2.6 - k * 0.3;
    out.push({ p: [x - k * 2.4, y - k * 0.6 * Math.cos(u * Math.PI), 0], s: [s, s, s], c: k % 2 ? COPPER : SKY, glow: k < 4 });
  }
  for (const [sx, sy] of [[-18, 30], [6, 34], [22, 26]] as const) out.push({ p: [sx, sy, -4], s: [1, 1, 1], c: "#FEF3C7", glow: true });
  return out;
}

export const LEGEND_SQUAD: CosmeticSet = {
  id: "legend-squad", bucket: "large", ip_risk: 1, culture_risk: 0, signature: "legend-squad-sky-warden", free_after_months: 12,
  tint: "#0F766E", group: "costume",
  items: [
    {
      id: "legend-squad-sky-warden", slot: "outfit", surfaces: ["avatar", "me", "collection"],
      wear: (_a, box) => {
        suit(box, { body: SKY, sleeve: SKY, glove: COPPER, leg: SKY_D, boot: COPPER, trim: CREAM });
        box("body", [0, 6.4, 3.0], [3, 1.2, 0.3], COPPER);           // kemer tokası (düz plaka; harf yok)
        glyph(box, COMET, CREAM, true);
        backCape(box, CREAM, "#E5D3B3", true);
        for (const x of [-3.6, 3.6]) box("body", [x, 13.7, 2.4], [1.4, 1.4, 0.5], COPPER); // omuz tokaları
        eyeBand(box, SKY_D);
      },
    },
    {
      id: "legend-squad-shadow-sleuth", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true,
      wear: (_a, box) => {
        suit(box, { body: PLUM, sleeve: PLUM, glove: SLATE, leg: PLUM_D, boot: SLATE }, true);
        box("body", [0, 9.9, 3.0], [0.6, 8.2, 0.2], PLUM_D);          // palto önü
        for (const x of [-1.8, 1.8]) box("body", [x, 12.6, 3.0], [1.6, 3.2, 0.3], PLUM_D, { r: [0, 0, x < 0 ? 0.3 : -0.3] }); // yaka
        box("body", [0, 14.4, 0.4], [9.4, 1.6, 6.6], MUSTARD);        // atkı
        box("body", [2.6, 12, 3.1], [1.6, 4.2, 0.4], MUSTARD);        // atkı ucu
        for (const y of [10.2, 8.4]) box("body", [-1.1, y, 3.05], [0.7, 0.7, 0.25], MUSTARD); // düğmeler
        // geniş kenarlı şapka (yuvarlak tepe; sivri kulak yok) + göz bandı
        box("head", [0, 10.4, 0], [14, 0.8, 14], SLATE, { lod: 0 });
        box("head", [0, 12.1, 0], [10, 3, 10], SLATE, { lod: 0 });
        box("head", [0, 11, 0], [10.3, 0.9, 10.3], "#0E7490");
        eyeBand(box, PLUM_D);
      },
    },
    {
      id: "legend-squad-gearwright", slot: "outfit", surfaces: ["avatar", "me", "collection"], eyes: true,
      wear: (_a, box) => {
        suit(box, { body: GRAPH, sleeve: GRAPH_L, glove: MINT, leg: GRAPH, boot: MINT, trim: GRAPH_L });
        // altıgen göğüs ızgarası (petek; disk ya da halka yok)
        for (const [x, y] of [[-1.7, 12.2], [0, 12.2], [1.7, 12.2], [-0.85, 10.8], [0.85, 10.8], [-1.7, 9.4], [0, 9.4], [1.7, 9.4]] as const)
          box("body", [x, y, 3.02], [1.3, 1.1, 0.3], (x + y) % 2 ? MINT : HEXGLOW, (x === 0 && y === 12.2) ? { glow: true } : {});
        for (const x of [-4.9, 4.9]) box("body", [x, 13.4, 0], [2.6, 2.2, 6.2], MINT);      // omuz plakaları
        box("body", [0, 10.4, -4.2], [6.4, 6.4, 2.4], GRAPH_L);                          // sırt alet çantası
        for (const x of [-2, 0, 2]) box("body", [x, 12, -5.5], [1, 1, 0.3], HEXGLOW, { glow: true }); // havalandırma
        box("body", [3.4, 15.4, -4.6], [0.5, 3, 0.5], GRAPH_L);                          // anten
        // gözlük vizörü (yüzü örtmez)
        box("head", [0, 6.3, 5.25], [10.4, 1.8, 0.4], GRAPH);
        for (const x of [-2.3, 2.3]) box("head", [x, 6.3, 5.5], [2.8, 1.4, 0.3], MINT, { o: 0.82 });
      },
    },
    {
      id: "legend-squad-gale-runner", slot: "outfit", surfaces: ["avatar", "me", "collection"], head: true,
      wear: (_a, box) => {
        suit(box, { body: VIOLET, sleeve: VIOLET, glove: WHITE, leg: VIOLET_D, boot: WHITE, trim: LIME });
        // çapraz rüzgâr çizgileri (gövde ve bacak; şimşek değil, paralel şerit)
        for (const [y, w] of [[12.6, 6], [10.8, 7], [9, 5]] as const) box("body", [0.6, y, 3.02], [w, 0.6, 0.3], WHITE, { r: [0, 0, 0.32] });
        for (const bone of ["legL", "legR"] as const) for (const y of [-1.2, -2.6]) box(bone, [0, y, 1.7], [2.4, 0.5, 0.2], LIME);
        // akış kaskı: tepe yüzgeci ARKAYA doğru (yanlarda kanat yok), yüz açık
        box("head", [0, 10.6, -0.4], [10.8, 1.4, 10.6], VIOLET_D, { lod: 0 });
        for (const x of [-5.3, 5.3]) box("head", [x, 7.4, -1.4], [0.6, 5.4, 7.8], VIOLET_D);
        box("head", [0, 12, -2.4], [1, 1.8, 6.4], WHITE);
        box("head", [0, 11.6, -6], [1, 1.2, 2], LIME, { glow: true });
      },
    },
    {
      id: "legend-squad-shapeshifter", slot: "outfit", surfaces: ["avatar", "me", "collection"],
      wear: (_a, box) => {
        // biçim değiştiren: yukarıdan aşağı mercan → kayısı → kum geçişli bantlar, arduvaz göz bandı, iki renkli eldiven
        suit(box, { body: CORAL, sleeve: CORAL_L, glove: SAND, leg: CORAL, boot: STONE, trim: SAND });
        for (const [y, c] of [[12.6, CORAL_L], [10.2, SAND], [7.8, CORAL_L]] as const) box("body", [0, y, 0], [9.1, 1.2, 6.1], c);
        box("armL", [0, -4.2, 0], [3.2, 1.2, 3.2], SAND);
        box("armR", [0, -4.2, 0], [3.2, 1.2, 3.2], CORAL);
        for (const bone of ["legL", "legR"] as const) box(bone, [0, -1.6, 0], [3.4, 1, 3.4], SAND);
        eyeBand(box, STONE);
      },
    },
    {
      id: "legend-squad-cosmic-guardian", slot: "outfit", surfaces: ["avatar", "me", "collection"],
      wear: (_a, box) => {
        // kozmik muhafız: gece moru tulum, kutup yeşili ışık çizgileri, yıldız noktalı uzun pelerin, omuzlarda yörünge küreleri
        suit(box, { body: NIGHT, sleeve: NIGHT, glove: NIGHT_D, leg: NIGHT_D, boot: NIGHT_D, trim: AURORA });
        glyph(box, ORBIT, AURORA, true);
        for (const x of [-3.6, 3.6]) box("body", [x, 10, 3.02], [0.4, 7.4, 0.2], AURORA, { glow: true });
        backCape(box, NIGHT_D, "#3B2A63", true);
        for (const [x, y] of [[-2.4, 12], [1.8, 9.4], [-1, 6.8], [2.6, 5]] as const) box("body", [x, y, -3.6], [0.6, 0.6, 0.2], STARDOT, { glow: true });
        for (const x of [-4.8, 4.8]) box("body", [x, 14.6, 0], [1.4, 1.4, 1.4], AURORA, { glow: true });
      },
    },
    {
      id: "legend-squad-hq-model", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // ekip karargâhı maketi: kademeli kule, ışıklı pencereler, tepede iniş pisti (logo ya da harf yok)
        const b: SceneBox[] = [{ p: [0, 0.5, 0], s: [12, 1, 7], c: STONE }];
        b.push({ p: [0, 4, 0], s: [7, 6, 4.6], c: SKY_D });
        b.push({ p: [0, 9, 0], s: [5, 4, 3.6], c: SKY });
        b.push({ p: [0, 11.4, 0], s: [7.6, 0.6, 5], c: CREAM });
        for (const x of [-2.2, 0, 2.2]) for (const y of [3, 5.4]) b.push({ p: [x, y, 2.35], s: [1.2, 1, 0.2], c: "#FDE68A", glow: true });
        for (const x of [-1.2, 1.2]) b.push({ p: [x, 9.2, 1.85], s: [1, 1.2, 0.2], c: AURORA, glow: true });
        b.push({ p: [4.8, 2.4, 1.6], s: [2, 3.8, 2], c: COPPER });
        b.push({ p: [-4.8, 1.6, -1.6], s: [2, 2.2, 2], c: GRAPH_L });
        return b;
      },
    },
    {
      id: "legend-squad-helper-drone", slot: "desk", surfaces: ["desk", "collection"],
      boxes: () => {
        // yardımcı dron: kaide üstünde süzülen küçük gövde, tek ışıklı göz, dört pervane kolu
        const b: SceneBox[] = [{ p: [0, 0.4, 0], s: [6, 0.8, 5], c: GRAPH }];
        b.push({ p: [0, 1.4, 0], s: [1, 1.2, 1], c: GRAPH_L });
        b.push({ p: [0, 5, 0], s: [4.4, 2.6, 3.6], c: "#E2E8F0" });
        b.push({ p: [0, 5.2, 1.85], s: [1.6, 1, 0.2], c: MINT, glow: true });
        for (const [dx, dz] of [[3.4, 2.2], [-3.4, 2.2], [3.4, -2.2], [-3.4, -2.2]] as const) {
          b.push({ p: [dx * 0.6, 6, dz * 0.6], s: [Math.abs(dx) * 0.8, 0.4, 0.4], c: GRAPH_L, r: [0, Math.atan2(dz, dx), 0] });
          b.push({ p: [dx, 6.6, dz], s: [2.4, 0.2, 0.6], c: COPPER });
        }
        return b;
      },
    },
    { id: "legend-squad-comet-pass", slot: "celebration", surfaces: ["celebration", "collection"], durationMs: 2400, frame: cometPass },
  ],
};
