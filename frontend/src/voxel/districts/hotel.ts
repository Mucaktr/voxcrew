/**
 * HOTEL-SYS (ürün sahibi 2026-10-29, E1) — şehir başına TEK, küçük, şehre özgü otel.
 *
 * "Her şehirde tek otel olsun. Dış görünüm hiçbir zaman landmarklardan büyük olmasın. İç kapasite içeri girince genişleyebilir.
 * Portal mantığı olabilir." · "Görünür yatak ≠ gereken yatak: hiçbir yerde görünür yatak yok."
 *
 * Model (eski 11 × 11, 3–4 katlı, 32 yataklı büyüme oteli kaldırıldı):
 * - **Dış kabuk küçük ve kapalı**: ayak izi karoları engelli, içi dışarıdan görünmez; yükseklik ve taban HOTEL-SCALE-001'e göre
 * (anıtsal simgelerin en alçağının %60'ı ve onun tabanı; kapı ≥ 1,2 × ajan boyu → alt sınır `HOTEL_FLOOR_H`). Şehre özgü cephe
 * (İstanbul ahşap konak, Londra Georgian sıra ev, <city> Haussmann köşe, <city> ryokan, <city> kahverengi taş, <city> pastel
 * kolonyal, <city> modernist köşe evi, Kapadokya mağara cephesi, <city> dükkân-ev…), genel "OTEL"/"HOTEL" sözcüğü (marka,
 * ad, logo yok) ve ışıklı GEÇİT kapısı.
 * - **Kapı = geçit**: kapı karosunda tek uyku noktası `bed: "hotel"` (görünür yatak yok). Uyuyacak ajan kapıya yürür, kapı
 * efektiyle "görünmeyen odalara" geçer (Crowd.tsx gizler, bedenini kapıdan çeker), uyanınca kapıda belirir. Kapasite sanaldır
 * (ajan sayısıyla ölçeklenir; SLEEP-CAP-001 geçidi sınırsız sayar).
 * - **İçerisi ayrı sahne**: yürüme modunda kapı karosu (interiors/placement.ts otomatik `otel` yeri, keşif kimliği değil) ayrı ve
 * çok daha büyük bir iç mekâna ışınlar: şehrin simge otelinden ESİNLİ lobi ve ortak alanlar (lobi, salon, kafe/bar, avlu,
 * merdiven holü; oda yok) — interiors/generate.ts `HOTEL_LOBBIES` (HOTEL-SYS bölümü). Kamera: INTERIOR-CAM iç mekân profili.
 *
 * Şehir ekibi için TEK SATIR (sahne kurucusunda, `b` Builder):
 * placeHotel(b, "<city>", { at: [i0, j0], w: 2, d: 2, door: [i, j] }); // dış kabuk + geçit + bölge
 * hotelPortal(b, { at: [i0, j0], w, d, door: [i, j], lobby: "grand" }); // kendi kabuğunu çizen sahne için
 * `door` ayak izinin bir kenarına bitişik yürünebilir karo; `lobby` (isteğe bağlı) iç mekân tarifi (yoksa şehrin `HOTEL_SPECS`
 * girdisi, o da yoksa "grand"). Başka hiçbir dosya gerekmez (katalog/arka uç değişmez). Kurallar: HOTEL-ONE-001, HOTEL-SCALE-001,
 * SLEEP-OPEN-001 (scripts/realism_check.mjs), SLEEP-CAP-001 / SLEEP-HOTEL-001 (rules/engine.ts).
 *
 * Büyüme: tabanında otel olan şehirde büyüme otel EKLEMEZ (`hotelPlanKit`); tabanı henüz otelsiz şehirde (duraklatılmış geçişler)
 * büyüme dünyasına TEK küçük otel girer (`hotelAmenity`, aynı kabuk + geçit). Açık hava yatak sırası ve uyku olanakları kalkar.
 * Şehir olmayan sahneler aynı geçidi sahneye uygun bir "konak" ile kullanır (`LODGE_SPECS`: dinlenme odası, kulübe, kapsül…; iç mekân "konak").
 *
 * Döngüsel içe aktarma: scenes.ts değerleri yalnız fonksiyon gövdelerinde kullanılır (bkz. core.ts notu).
*/
import { cityBench, kiosk, streetLamp } from "../city/kit";
import { pick2, type CityStyle } from "../city/style";
import { noteObject } from "../rules/hooks";
import { tx, tz, type Builder, type Built, type Tile } from "../scenes";
import { cityAmenities } from "./cityAmenities";
import { groundRest } from "./city";
import { districtRole } from "./core";
import { flowerBed, planter } from "./parts";
import type { Amenity, Bay, Theme } from "./themes";
import { fullHotelSpecs, fullLodgeSpecs } from "../../full/hotel";

export const HOTEL_LABEL = "dist_hotel";
/** Büyüme: tek otel (planlayıcı ⌈çalışma / HOTEL_EVERY⌉ = 1). */
export const HOTEL_EVERY = 1_000_000;
/** Yürüme modunda otel kapısının iç mekân yeri (interiors/placement.ts; keşif kataloğunda değil). */
export const HOTEL_SITE = "otel";
/** Geçit kapısı yüksekliği: ≥ 1,2 × ajan boyu (1,6) — HOTEL-SCALE-001 alt sınırı. */
export const HOTEL_DOOR_H = 1.92;
/** Dış kabuk yüksekliğinin alt sınırı (kapı + lento + saçak); simge tavanı bunun altındaysa alt sınır geçerli (uyarı). */
export const HOTEL_FLOOR_H = 2.4;

export type HotelLook = "konak" | "georgian" | "haussmann" | "ryokan" | "brownstone" | "colonial" | "modernista" | "cave"
  | "shophouse" | "canal" | "hanok" | "riad" | "teak" | "mashrabiya" | "windtower" | "siheyuan" | "shikumen" | "haveli" | "rockcut"
  // şehir olmayan sahnelerin konakları
  | "room" | "cabin" | "hut" | "pod" | "deckhouse";

export interface HotelSpec {
  look: HotelLook;
  /** tabela sözcüğü (genel; marka değil) — konaklarda yok */
  word?: "HOTEL" | "OTEL";
  /** varsayılan ayak izi (karo) ve dış yükseklik (en üst blok), saçak (duvar üstü) */
  w: number; d: number; h: number; wall: number;
  walls: string; trim: string; roof: string; door: string; glow: string; window: string;
  accent?: string;
  /** iç mekân tarifi (interiors/generate.ts HOTEL_LOBBIES) */
  lobby: string;
  /** şehir haritasında AYNI otelin dış görünümü (landmark kimliği): HOTEL-ONE-001 ikinci otel saymaz (ölçeği yine denetlenir) */
  mapLandmark?: string;
}

const LIT = "#FFD98A";
/** Şehir başına otel (genel mimari dil; belirli bir otelin birebiri ya da adı değil). Yükseklikler HOTEL-SCALE-001 tavanına göre. */
export const HOTEL_SPECS: Readonly<Record<string, HotelSpec>> = {
  ...fullHotelSpecs(LIT),
  // İstanbul: en alçak anıtsal simge Kız Kulesi (4,97; 1 × 2) → ≤ 2,98, ≤ 2 karo: tek katlı ahşap konak, kafesli pencere, geniş saçak
  istanbul: { look: "konak", word: "OTEL", w: 2, d: 1, h: 2.86, wall: 2.24, walls: "#E7C9A0", trim: "#7A4E2A", roof: "#A4472F",
    door: "#5B3A24", glow: LIT, window: "#3B4A52", accent: "#F3E6CF", lobby: "oryantal" },
  // Londra: saray cephesi (4,15) → ≤ 2,49: Georgian sıra ev (tuğla, beyaz sürgülü pencere, yelpaze camlı kapı, taş parapet, parmaklık)
  londra: { look: "georgian", word: "HOTEL", w: 3, d: 2, h: 2.46, wall: 2.3, walls: "#9C4A36", trim: "#F2EEE4", roof: "#C9C2B4",
    door: "#1F2A33", glow: "#FFE2A8", window: "#2E3A44", accent: "#22282E", lobby: "artdeco" },
  // Kapadokya: Zelve (5,32) → ≤ 3,19: tüfe oyulmuş mağara oteli cephesi (yuvarlak kütle, kemerli kapı, küçük kemerli pencereler)
  kapadokya: { look: "cave", word: "OTEL", w: 3, d: 2, h: 3.1, wall: 2.4, walls: "#E3C49E", trim: "#B98A62", roof: "#D9B08E",
    door: "#7A4E2A", glow: "#FFD08A", window: "#4A3A2E", accent: "#9C4A3A", lobby: "magara", mapLandmark: "magara_otel" },
};

/** Şehir olmayan sahnelerin konakları (aynı geçit; sahneye uygun dış kabuk, iç mekân "konak"). */
export const LODGE_SPECS: Readonly<Record<string, HotelSpec>> = {
  ...fullLodgeSpecs(LIT),
  office: { look: "room", w: 2, d: 1, h: 2.4, wall: 2.4, walls: "#D9DEE5", trim: "#5B6573", roof: "#C9CED6", door: "#3F4A5A", glow: "#CFE8FF", window: "#A8C8E0", lobby: "konak" },
  home: { look: "room", w: 2, d: 1, h: 2.4, wall: 2.4, walls: "#E8D9C0", trim: "#8B5E3C", roof: "#D8C8AC", door: "#6B4226", glow: LIT, window: "#A8C8E0", lobby: "konak" },
  cafe: { look: "room", w: 2, d: 1, h: 2.4, wall: 2.4, walls: "#E6CFB0", trim: "#6B4226", roof: "#D6BC98", door: "#5B3A24", glow: LIT, window: "#A8C8E0", lobby: "konak" },
  mall: { look: "room", w: 2, d: 1, h: 2.4, wall: 2.4, walls: "#E2E8F0", trim: "#64748B", roof: "#CBD5E1", door: "#475569", glow: "#E0F2FE", window: "#A8D8F0", lobby: "konak" },
  school: { look: "room", w: 2, d: 1, h: 2.4, wall: 2.4, walls: "#F2E8D5", trim: "#2F6E8F", roof: "#D9CBB0", door: "#2F6E8F", glow: LIT, window: "#A8D8F0", lobby: "konak" },
  park: { look: "cabin", w: 2, d: 2, h: 2.6, wall: 2.0, walls: "#8B5E3C", trim: "#5B3A24", roof: "#4E6B3A", door: "#5B3A24", glow: LIT, window: "#3B4A52", lobby: "konak" },
  camp: { look: "cabin", w: 2, d: 2, h: 2.6, wall: 2.0, walls: "#8B5E3C", trim: "#5B3A24", roof: "#6B4A32", door: "#4A2E1C", glow: "#FFB65C", window: "#3B4A52", lobby: "konak" },
  snow: { look: "cabin", w: 2, d: 2, h: 2.6, wall: 2.0, walls: "#7A5233", trim: "#F8FAFC", roof: "#F1F5F9", door: "#5B3A24", glow: "#FFD08A", window: "#3B4A52", lobby: "konak" },
  battlefield: { look: "cabin", w: 2, d: 2, h: 2.5, wall: 1.95, walls: "#6E7A4E", trim: "#4A5234", roof: "#5E6B3A", door: "#3F472C", glow: "#FFD08A", window: "#2F3A2A", lobby: "konak" },
  beach: { look: "hut", w: 2, d: 2, h: 2.6, wall: 1.95, walls: "#E8D5B5", trim: "#9C7B5A", roof: "#C9A66B", door: "#8C5A2B", glow: LIT, window: "#3B4A52", lobby: "konak" },
  sea: { look: "hut", w: 2, d: 2, h: 2.6, wall: 1.95, walls: "#E8D5B5", trim: "#9C7B5A", roof: "#C9A66B", door: "#8C5A2B", glow: LIT, window: "#3B4A52", lobby: "konak" },
  yacht: { look: "deckhouse", w: 2, d: 1, h: 2.4, wall: 2.3, walls: "#F8FAFC", trim: "#9C7B5A", roof: "#E5E7EB", door: "#1E3A5F", glow: "#E0F2FE", window: "#1E3A5F", lobby: "konak" },
  space: { look: "pod", w: 2, d: 2, h: 2.5, wall: 2.1, walls: "#CBD5E1", trim: "#64748B", roof: "#E2E8F0", door: "#334155", glow: "#7DD3FC", window: "#0F172A", lobby: "konak" },
};

/** Tablosuz sahne/şehir için genel otel (stilden türetilir). */
function genericSpec(s: CityStyle | null): HotelSpec {
  return { look: "georgian", word: "HOTEL", w: 3, d: 2, h: 2.4, wall: 2.3, walls: s?.walls[0] ?? "#E8D9C0", trim: s?.trim ?? "#F4EFE6",
    roof: s?.roofColor ?? "#B5543C", door: s?.door ?? "#5B3A24", glow: s?.lamp.glow ?? LIT, window: s?.window ?? "#3B4A52", lobby: "grand" };
}
export function hotelSpec(id: string, s: CityStyle | null = null): HotelSpec { return HOTEL_SPECS[id] ?? LODGE_SPECS[id] ?? genericSpec(s); }

// ------------------------------------------------------------------------------------------ piksel tabela (genel sözcük)
/** 3×5 piksel harfler (yalnız tabela sözcükleri). */
const GLYPHS: Record<string, readonly string[]> = {
  H: ["101", "101", "111", "101", "101"],
  O: ["111", "101", "101", "101", "111"],
  T: ["111", "010", "010", "010", "010"],
  E: ["111", "100", "110", "100", "111"],
  L: ["100", "100", "100", "100", "111"],
};
/** Sözcüğü (x, y) merkezli, z düzleminde (+z'ye bakan) piksel ışık kutularıyla yazar; satır başına bitişik pikseller tek kutu. */
export function pixelWord(b: Builder, word: string, x: number, y: number, z: number, px: number, c: string): number {
  const cols = word.length * 4 - 1, x0 = x - (cols * px) / 2;
  [...word].forEach((ch, k) => {
    const g = GLYPHS[ch];
    if (!g) return;
    g.forEach((row, r) => {
      for (let c0 = 0; c0 < 3;) {
        if (row[c0] !== "1") { c0++; continue; }
        let c1 = c0; while (c1 + 1 < 3 && row[c1 + 1] === "1") c1++;
        const w = (c1 - c0 + 1) * px;
        b.box(x0 + (k * 4 + c0) * px + w / 2, y + (2 - r) * px, z, w, px, 0.04, c, "glow");
        c0 = c1 + 1;
      }
    });
  });
  return cols * px;
}

// ------------------------------------------------------------------------------------------ yer ve geçit (tek satırlık API)
export interface HotelSite {
  /** ayak izinin sol-arka karosu ve boyutu (karo) */
  at: Tile; w?: number; d?: number;
  /** geçit kapısı: ayak izinin bir kenarına bitişik yürünebilir karo */
  door: Tile;
  /** iç mekân tarifi (yoksa şehrin girdisi) */
  lobby?: string;
  /** dış yükseklik (yoksa şehrin girdisi) */
  h?: number;
}

/** Kapının ayak izine göre yönü: kapıdan binaya doğru birim adım. */
function doorDir(i0: number, j0: number, w: number, d: number, door: Tile): [number, number] {
  const [i, j] = door;
  if (j === j0 + d && i >= i0 && i < i0 + w) return [0, -1];
  if (j === j0 - 1 && i >= i0 && i < i0 + w) return [0, 1];
  if (i === i0 + w && j >= j0 && j < j0 + d) return [-1, 0];
  if (i === i0 - 1 && j >= j0 && j < j0 + d) return [1, 0];
  throw new Error(`otel kapısı (${i}, ${j}) ayak izine (${i0}, ${j0}, ${w}×${d}) bitişik değil`);
}

/**
 * Yalnız geçit ve bölge (kendi dış kabuğunu çizen sahne için): ayak izi engellenir, `hotel` bölgesi (etiket = lobi tarifi) ve kapı
 * karosunda sanal kapasiteli uyku geçidi (`bed: "hotel"`). Görünür yatak yok.
 */
export function hotelPortal(b: Builder, site: HotelSite & { lobby: string }): void {
  const [i0, j0] = site.at, w = site.w ?? 2, d = site.d ?? 2;
  const [di, dj] = doorDir(i0, j0, w, d, site.door);
  for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) b.block(i, j);
  b.zones.push({ kind: "hotel", i0, j0, w, d, tag: site.lobby });
  // yüz: ajan kapıya dönük (geçide girer)
  b.sleep(site.door[0], site.door[1], Math.atan2(di, dj), "hotel", 0);
  noteObject(b, "tower", [i0, j0], { w, d, floors: 1, enclosed: true });
}

/** Şehrin (ya da sahnenin) tek oteli: şehre özgü küçük dış kabuk + geçit + bölge. */
export function placeHotel(b: Builder, id: string, site: HotelSite, s: CityStyle | null = null): void {
  const spec = hotelSpec(id, s);
  const w = site.w ?? spec.w, d = site.d ?? spec.d;
  hotelPortal(b, { ...site, w, d, lobby: site.lobby ?? spec.lobby });
  hotelShell(b, spec, site.at, w, d, site.door, site.h ?? spec.h);
}

/** Dünyada geçit (otel kapısı) var mı — uyku yalnız geçitte (fun/sleep.ts `sleepPool`). */
export const hasHotelPortal = (built: Pick<Built, "spots">): boolean => (built.spots.sleep ?? []).some((s) => s.bed === "hotel");
/** Taban sahnede otel bölgesi var mı (büyüme ikinci otel eklemez). */
export const hasHotelZone = (built: Pick<Built, "zones">): boolean => (built.zones ?? []).some((z) => z.kind === "hotel");

// ------------------------------------------------------------------------------------------ dış kabuk
/**
 * Yerel çerçeve: `u` cephe boyunca (ayak izinin ortası 0), `v` cepheden içeri (0 = kapı kenarı), y yukarı. Dört kapı yönü için
 * dünya kutusuna çevirir; böylece her tipoloji tek kez yazılır.
 */
function frame(b: Builder, i0: number, j0: number, w: number, d: number, door: Tile) {
  const [di, dj] = doorDir(i0, j0, w, d, door);
  const x0 = tx(i0) - 0.5, x1 = tx(i0 + w - 1) + 0.5, z0 = tz(j0) - 0.5, z1 = tz(j0 + d - 1) + 0.5;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const alongX = dj !== 0;
  const W = alongX ? w : d, D = alongX ? d : w;
  // kapının cephe üzerindeki yeri (u)
  const ud = alongX ? (dj < 0 ? tx(door[0]) - cx : cx - tx(door[0])) : (di < 0 ? cz - tz(door[1]) : tz(door[1]) - cz);
  const map = (u: number, v: number): [number, number] => {
    if (dj < 0) return [cx + u, z1 - v];
    if (dj > 0) return [cx - u, z0 + v];
    if (di < 0) return [x1 - v, cz - u];
    return [x0 + v, cz + u];
  };
  const box = (u: number, y: number, v: number, su: number, sy: number, sv: number, c: string, g: "solid" | "glass" | "glow" = "solid", j = 0.02) => {
    if (su < 0.01 || sy < 0.01 || sv < 0.01) return; // dar ayak izinde (d = 1) eksi/sıfır boylu ayrıntı çizilmez (dünya biçimi: boy > 0)
    const [x, z] = map(u, v);
    if (alongX) b.box(x, y, z, su, sy, sv, c, g, j); else b.box(x, y, z, sv, sy, su, c, g, j);
  };
  /** cephedeki karo sütunlarının u merkezleri */
  const cols = Array.from({ length: W }, (_, k) => -W / 2 + 0.5 + k);
  return { box, W, D, ud, cols };
}

/** Cephe sözcüğü (u-y düzleminde, dışarı bakan). */
function word(box: ReturnType<typeof frame>["box"], text: string, u: number, y: number, v: number, px: number, c: string) {
  const cols = text.length * 4 - 1, u0 = u - (cols * px) / 2;
  [...text].forEach((ch, k) => {
    const g = GLYPHS[ch];
    if (!g) return;
    g.forEach((row, r) => {
      for (let c0 = 0; c0 < 3;) {
        if (row[c0] !== "1") { c0++; continue; }
        let c1 = c0; while (c1 + 1 < 3 && row[c1 + 1] === "1") c1++;
        const w = (c1 - c0 + 1) * px;
        // u ekseni dışarıdan bakınca soldan sağa okunur (ayna değil)
        box(u0 + (k * 4 + c0) * px + w / 2, y + (2 - r) * px, v, w, px, 0.03, c, "glow");
        c0 = c1 + 1;
      }
    });
  });
}

/** Küçük, kapalı dış kabuk (ayak izi engelli; içi görünmez). Üst sınır `h` (HOTEL-SCALE-001). */
export function hotelShell(b: Builder, spec: HotelSpec, at: Tile, w: number, d: number, door: Tile, h = spec.h): void {
  const { box, W, D, ud, cols } = frame(b, at[0], at[1], w, d, door);
  const wall = Math.min(spec.wall, h - 0.06), R = 0.26; // cephe kapı kenarından R içeride (giriş girintisi)
  const roofH = h - wall;
  const L = spec.look;
  // ---- gövde (kapalı; içi dolu) ve cephe
  box(0, wall / 2, (R + D) / 2, W, wall, D - R, spec.walls, "solid", 0.03);
  // giriş girintisinin iki yan duvarı ve tavanı (kapı nişi)
  for (const s of [-1, 1]) box(ud + s * 0.7, wall / 2, R / 2, 0.12, wall, R, spec.walls, "solid", 0.03);
  if (wall - HOTEL_DOOR_H - 0.12 > 0.03) box(ud, (HOTEL_DOOR_H + 0.12 + wall) / 2, R / 2, 1.52, wall - HOTEL_DOOR_H - 0.12, R, spec.walls, "solid", 0.03);
  // kapı: söve, lento, ışıklı geçit yüzeyi (≥ 1,2 × ajan boyu), eşik
  for (const s of [-1, 1]) box(ud + s * 0.6, HOTEL_DOOR_H / 2, R - 0.03, 0.1, HOTEL_DOOR_H, 0.08, spec.trim);
  box(ud, HOTEL_DOOR_H + 0.06, R - 0.03, 1.3, 0.12, 0.1, spec.trim);
  box(ud, HOTEL_DOOR_H / 2, R + 0.01, 1.1, HOTEL_DOOR_H - 0.02, 0.03, spec.glow, "glow"); // ENTRY-DOOR-001: açıklık ≥ 1 m (eski 0,84)
  box(ud, 0.03, R / 2 - 0.02, 1.3, 0.06, R + 0.04, spec.trim);
  // fenerler (kapının iki yanında, cepheye bağlı)
  for (const s of [-1, 1]) {
    box(ud + s * 0.82, 1.55, R - 0.06, 0.06, 0.06, 0.12, spec.trim);
    box(ud + s * 0.82, 1.45, R - 0.14, 0.12, 0.18, 0.12, spec.glow, "glow");
  }
  // pencereler: kapı dışındaki cephe sütunları (zemin), gerekirse üst kat
  const winCols = cols.filter((u) => Math.abs(u - ud) > 0.95);
  const two = wall >= 3.4;
  const storeys = two ? [[0.75, 1.75], [2.55, 3.45]] : [[0.8, Math.min(1.8, wall - 0.3)]];
  for (const u of winCols) for (const [y0, y1] of storeys) {
    box(u, (y0 + y1) / 2, R - 0.01, 0.56, y1 - y0, 0.04, spec.window, "glass");
    box(u, y0 - 0.04, R - 0.06, 0.7, 0.08, 0.14, spec.trim); // denizlik
    windowDetail(box, L, spec, u, y0, y1, R);
  }
  if (two) for (const [y0, y1] of [[2.55, 3.45]]) {
    box(ud, (y0 + y1) / 2, R - 0.01, 0.56, y1 - y0, 0.04, spec.window, "glass");
    box(ud, y0 - 0.04, R - 0.06, 0.7, 0.08, 0.14, spec.trim);
  }
  // yan cephelerde birer pencere (REAL-FACADE-001: görünen her yüzde pencere)
  sideWindows(box, W, D, spec, R, two);
  // ---- tabela: kapı üstünde ya da yanında (genel sözcük; marka yok)
  if (spec.word) {
    const px = 0.05, sw = (spec.word.length * 4 - 1) * px;
    const top = wall - 0.08, y = Math.min(top - 5 * px - 0.04, HOTEL_DOOR_H + 0.16);
    if (y >= HOTEL_DOOR_H + 0.12) {
      box(ud, y + 2.5 * px - px / 2, R - 0.05, sw + 0.16, 5 * px + 0.1, 0.04, spec.door);
      word(box, spec.word, ud, y, R - 0.08, px, spec.glow);
    } else {
      // alçak kabuk: kapının yanında dikey levha (cephe sütununa)
      const u = winCols.length ? winCols[winCols.length - 1] : ud + 0.9;
      box(u, 2.0 - 0.01, R - 0.05, sw + 0.16, 5 * px + 0.1, 0.04, spec.door);
      word(box, spec.word, u, 2.0 - 2 * px - 0.02, R - 0.08, px, spec.glow);
    }
  }
  // ---- tipolojiye özgü ayrıntı ve çatı (her şey h'nin altında)
  roofAndDetail(box, spec, W, D, ud, wall, roofH, R, h);
}

type BoxFn = ReturnType<typeof frame>["box"];

function windowDetail(box: BoxFn, L: HotelLook, spec: HotelSpec, u: number, y0: number, y1: number, R: number) {
  const m = (y0 + y1) / 2, hh = y1 - y0;
  switch (L) {
    case "konak": case "mashrabiya": case "haveli":
      // ahşap kafes (ızgara)
      for (const k of [-0.16, 0, 0.16]) box(u + k, m, R - 0.04, 0.03, hh, 0.03, spec.trim);
      for (const k of [-0.25, 0, 0.25]) box(u, m + k * hh, R - 0.04, 0.56, 0.03, 0.03, spec.trim);
      break;
    case "colonial": case "shophouse": case "teak":
      // kepenkler
      for (const s of [-1, 1]) box(u + s * 0.38, m, R - 0.04, 0.18, hh, 0.03, spec.door);
      break;
    case "georgian": case "brownstone": case "haussmann": case "shikumen":
      // sürgülü pencere kayıtları + lento
      box(u, m, R - 0.035, 0.56, 0.03, 0.03, spec.trim);
      box(u, m, R - 0.035, 0.03, hh, 0.03, spec.trim);
      box(u, y1 + 0.06, R - 0.05, 0.68, 0.1, 0.1, spec.accent ?? spec.trim);
      break;
    case "ryokan": case "hanok": case "siheyuan":
      // kâğıt panel ızgarası
      for (const k of [-0.14, 0.14]) box(u + k, m, R - 0.035, 0.025, hh, 0.025, spec.trim);
      box(u, m, R - 0.035, 0.56, 0.025, 0.025, spec.trim);
      break;
    case "cave": case "rockcut": case "riad":
      // kemer alınlığı
      box(u, y1 + 0.05, R - 0.04, 0.4, 0.1, 0.06, spec.trim);
      box(u, y1 + 0.13, R - 0.04, 0.2, 0.07, 0.06, spec.trim);
      break;
    case "modernista":
      // kıvrık demir balkon parmaklığı
      box(u, y0 + 0.18, R - 0.12, 0.66, 0.04, 0.2, spec.trim);
      for (const k of [-0.28, 0, 0.28]) box(u + k, y0 + 0.08, R - 0.2, 0.03, 0.2, 0.03, spec.trim);
      break;
    case "canal":
      box(u, m, R - 0.035, 0.56, 0.03, 0.03, spec.trim);
      box(u, m, R - 0.035, 0.03, hh, 0.03, spec.trim);
      break;
    case "pod":
      box(u, m, R - 0.04, 0.6, 0.04, 0.03, spec.glow, "glow");
      break;
    default:
      box(u, m, R - 0.035, 0.03, hh, 0.03, spec.trim);
  }
}

function sideWindows(box: BoxFn, W: number, D: number, spec: HotelSpec, R: number, two: boolean) {
  const v = (R + D) / 2, ys = two ? [[0.9, 1.7], [2.6, 3.4]] : [[0.95, 1.65]];
  for (const s of [-1, 1]) for (const [y0, y1] of ys) {
    box(s * (W / 2 + 0.01), (y0 + y1) / 2, v, 0.04, y1 - y0, Math.min(0.5, D - R - 0.3), spec.window, "glass");
  }
}

function roofAndDetail(box: BoxFn, spec: HotelSpec, W: number, D: number, ud: number, wall: number, roofH: number, R: number, h: number) {
  const vc = (R + D) / 2, dv = D - R;
  const tiers = (n: number, eave: number, shrinkU: boolean, shrinkV: boolean, c: string) => {
    if (roofH <= 0.05) return;
    const th = roofH / n;
    for (let k = 0; k < n; k++) {
      const f = 1 - k / n;
      box(0, wall + th * (k + 0.5), vc, shrinkU ? Math.max(0.2, (W + 2 * eave) * f) : W + 2 * eave, th, shrinkV ? Math.max(0.2, (dv + 2 * eave) * f) : dv + 2 * eave, c, "solid", 0.04);
    }
  };
  switch (spec.look) {
    case "konak":
      // ahşap bindirme bantları, saçak altı konsolları, geniş saçaklı kırma kiremit çatı
      for (const y of [0.55, 1.1, 1.65]) box(0, y, R - 0.03, W, 0.04, 0.04, spec.trim);
      for (const u of [-W / 2 + 0.1, W / 2 - 0.1]) box(u, wall / 2, R - 0.02, 0.1, wall, 0.06, spec.trim);
      for (let k = 0; k <= 4; k++) box(-W / 2 + k * (W / 4), wall - 0.08, R - 0.18, 0.06, 0.12, 0.3, spec.trim);
      tiers(3, 0.3, true, true, spec.roof);
      break;
    case "georgian":
      // taş taban, parapet (düz çatı arkasında), cephe önünde siyah demir parmaklık (girinti içinde, kapı açık)
      box(0, 0.12, R - 0.02, W, 0.24, 0.05, "#B9B2A4");
      box(0, wall + roofH / 2, vc, W + 0.04, roofH, dv + 0.04, spec.roof, "solid", 0.02);
      box(0, wall - 0.02, R - 0.04, W + 0.06, 0.08, 0.1, spec.trim);
      // yelpaze camlı kapı üstü (lento içinde)
      box(ud, HOTEL_DOOR_H + 0.2, R - 0.01, 0.6, 0.12, 0.03, spec.glow, "glow");
      for (const s of [-1, 1]) {
        const u0 = s < 0 ? -W / 2 + 0.05 : ud + 0.62, u1 = s < 0 ? ud - 0.62 : W / 2 - 0.05;
        if (u1 - u0 < 0.2) continue;
        box((u0 + u1) / 2, 0.62, 0.08, u1 - u0, 0.04, 0.04, spec.accent ?? "#22282E");
        for (let u = u0 + 0.05; u <= u1; u += 0.22) box(u, 0.32, 0.08, 0.03, 0.62, 0.03, spec.accent ?? "#22282E");
      }
      break;
    case "haussmann":
      // derzli taş zemin kat, dökme demir balkon, çinko mansart + çatı penceresi + baca
      for (const y of [0.6, 1.2, 1.8]) box(0, y, R - 0.02, W, 0.03, 0.03, spec.accent ?? "#D6C9B0");
      box(0, wall - 0.05, R - 0.12, W, 0.06, 0.26, spec.trim);
      box(0, wall + 0.2, R - 0.24, W, 0.04, 0.03, spec.trim);
      for (let u = -W / 2 + 0.1; u <= W / 2; u += 0.3) box(u, wall + 0.1, R - 0.24, 0.025, 0.2, 0.025, spec.trim);
      box(0, wall + 0.05, vc, W + 0.08, 0.1, dv + 0.08, spec.accent ?? "#D6C9B0");
      box(0, wall + 0.1 + (roofH - 0.1) * 0.35, vc + 0.12, W - 0.1, (roofH - 0.1) * 0.7, dv - 0.24, spec.roof, "solid", 0.03);
      box(0, wall + 0.1 + (roofH - 0.1) * 0.85, vc + 0.3, W - 0.6, (roofH - 0.1) * 0.3, dv - 0.8, "#6C7A88", "solid", 0.03);
      box(ud, wall + 0.42, R + 0.22, 0.42, 0.42, 0.06, spec.window, "glass");
      box(ud, wall + 0.66, R + 0.22, 0.52, 0.08, 0.14, spec.trim);
      box(W / 2 - 0.35, h - 0.2, D - 0.5, 0.3, 0.4, 0.3, "#B9A68D", "solid", 0.04);
      break;
    case "ryokan":
      // koyu ahşap dikmeler, derin saçaklı kırma çatı, mahya; kapıda çivit noren, iki yanda kâğıt fener ve bambu çit
      for (const u of [-W / 2 + 0.06, -0.62 + ud, 0.62 + ud, W / 2 - 0.06]) box(u, wall / 2, R - 0.03, 0.12, wall, 0.08, spec.trim);
      box(0, wall - 0.06, R - 0.03, W, 0.1, 0.08, spec.trim);
      box(0, 0.25, R - 0.03, W, 0.5, 0.05, "#B8B0A0");
      for (const k of [-0.22, 0.22]) box(ud + k, HOTEL_DOOR_H - 0.2, R - 0.06, 0.4, 0.42, 0.02, spec.accent ?? "#2F4A7A");
      tiers(3, 0.45, true, true, spec.roof);
      box(0, h - 0.05, vc, Math.max(0.4, W * 0.3), 0.1, 0.16, "#3A3F47");
      for (const s of [-1, 1]) {
        box(ud + s * 1.05, 0.62, R - 0.1, 0.08, 1.24, 0.08, spec.trim);
        box(ud + s * 1.05, 1.32, R - 0.1, 0.26, 0.34, 0.26, "#FFF1D6", "glow");
      }
      break;
    case "brownstone":
      // ağır korniş, kat bandı, kapı saçağı (girinti içinde), taş söveler
      box(0, 2.36, R - 0.04, W, 0.1, 0.08, spec.trim);
      box(0, wall + roofH / 2, vc - 0.06, W + 0.24, roofH, dv + 0.12, spec.roof, "solid", 0.02);
      for (let u = -W / 2 + 0.25; u < W / 2; u += 0.5) box(u, wall - 0.04, R - 0.12, 0.08, 0.12, 0.16, spec.roof);
      box(ud, HOTEL_DOOR_H + 0.2, R - 0.12, 1.1, 0.06, 0.24, spec.accent ?? "#2A3A34");
      break;
    case "colonial":
      // beyaz köşe pilastrları ve korniş, alçak kiremit kırma çatı
      for (const u of [-W / 2 + 0.08, W / 2 - 0.08]) box(u, wall / 2, R - 0.03, 0.16, wall, 0.06, spec.trim);
      box(0, wall - 0.05, R - 0.06, W + 0.06, 0.1, 0.12, spec.trim);
      tiers(2, 0.18, true, true, spec.roof);
      break;
    case "modernista":
      // kırık çini şeridi, dalgalı parapet (dönüşümlü yükseklik), cephe kıvrımları
      { const tile = ["#3F7D6E", "#C47A35", "#4A6FA5", "#E9D8A6", "#9C4F3E"];
        for (let k = 0; k < W * 4; k++) box(-W / 2 + 0.125 + k * 0.25, 2.1, R - 0.03, 0.22, 0.14, 0.04, tile[k % tile.length]);
        for (let k = 0; k < W * 2; k++) {
          const hh = Math.max(0.1, roofH * (k % 2 ? 0.55 : 1));
          box(-W / 2 + 0.25 + k * 0.5, wall + hh / 2, R + 0.05, 0.5, hh, 0.12, spec.walls, "solid", 0.04);
        }
        box(0, wall + 0.05, vc, W, 0.1, dv, spec.roof); }
      break;
    case "cave":
      // tüf kütle: yuvarlatılmış kademeli tepe, kemerli kapı alınlığı, tepede küçük peri bacası
      tiers(3, 0.05, true, true, spec.walls);
      box(ud, HOTEL_DOOR_H + 0.18, R - 0.04, 0.8, 0.12, 0.06, spec.trim);
      box(ud, HOTEL_DOOR_H + 0.28, R - 0.04, 0.44, 0.08, 0.06, spec.trim);
      box(-W / 2 + 0.4, 0.15, R - 0.08, 0.5, 0.3, 0.16, spec.trim); // taş seki
      break;
    case "shophouse":
      // beş ayak yolu dikmeleri, süslü korniş, kiremit
      for (const u of [-W / 2 + 0.08, W / 2 - 0.08]) box(u, wall / 2, R - 0.06, 0.14, wall, 0.12, spec.trim);
      box(0, wall - 0.06, R - 0.08, W + 0.04, 0.12, 0.16, spec.trim);
      tiers(2, 0.16, false, true, spec.roof);
      break;
    case "canal":
      // kademeli alınlık (tepe), beyaz söveler, vinç kirişi
      box(0, wall + roofH * 0.25, R + 0.2, W, roofH * 0.5, 0.4, spec.walls, "solid", 0.03);
      box(0, wall + roofH * 0.75, R + 0.2, W * 0.5, roofH * 0.5, 0.4, spec.walls, "solid", 0.03);
      box(0, h - 0.05, R + 0.05, 0.12, 0.1, 0.5, spec.trim);
      box(0, wall + 0.06, vc + 0.2, W, 0.12, dv - 0.4, spec.roof);
      break;
    case "hanok":
      // taş taban, ahşap çerçeve, uçları kalkık kavisli kiremit çatı
      box(0, 0.22, R - 0.03, W, 0.44, 0.05, "#9C978C");
      for (const u of [-W / 2 + 0.06, W / 2 - 0.06]) box(u, wall / 2, R - 0.03, 0.12, wall, 0.08, spec.trim);
      tiers(2, 0.4, false, true, spec.roof);
      for (const s of [-1, 1]) box(s * (W / 2 + 0.36), h - 0.1, R - 0.3, 0.2, 0.12, 0.2, spec.roof);
      break;
    case "riad":
      // zellij şeridi, anahtar deliği kemer alınlığı, mazgallı parapet
      { const z = ["#2F6F73", "#E9D9C0", "#C98A3A", "#1F4E5A"];
        for (let k = 0; k < W * 4; k++) { const u = -W / 2 + 0.125 + k * 0.25; if (Math.abs(u - ud) < 0.6) continue; box(u, 0.5, R - 0.03, 0.22, 0.2, 0.04, z[k % z.length]); }
        box(ud, HOTEL_DOOR_H + 0.2, R - 0.04, 0.7, 0.14, 0.06, spec.trim);
        for (let k = 0; k < W * 2; k += 2) box(-W / 2 + 0.25 + k * 0.5, wall + roofH / 2, R + 0.08, 0.5, roofH, 0.16, spec.walls, "solid", 0.03);
        box(0, wall + 0.05, vc, W, 0.1, dv, spec.roof); }
      break;
    case "teak":
      // koyu tik, dik beşik çatı, uçlarda kıvrık süs
      for (const u of [-W / 2 + 0.06, W / 2 - 0.06]) box(u, wall / 2, R - 0.03, 0.12, wall, 0.08, spec.trim);
      tiers(4, 0.25, false, true, spec.roof);
      for (const s of [-1, 1]) box(s * (W / 2 + 0.2), h - 0.15, vc, 0.08, 0.3, 0.08, "#C9A44C");
      break;
    case "mashrabiya":
      // düz teras, ahşap kafesli çıkma
      box(0, wall + roofH / 2, vc, W + 0.06, roofH, dv + 0.06, spec.walls, "solid", 0.02);
      box(0, wall - 0.04, R - 0.06, W + 0.08, 0.08, 0.12, spec.trim);
      break;
    case "windtower":
      // düz çatı + rüzgâr kulesi (alçak)
      box(0, wall + Math.min(0.12, roofH) / 2, vc, W + 0.06, Math.min(0.12, roofH), dv + 0.06, spec.roof);
      if (roofH > 0.2) box(W / 2 - 0.4, wall + roofH / 2, D - 0.5, 0.5, roofH, 0.5, spec.walls, "solid", 0.03);
      break;
    case "siheyuan":
      // gri tuğla, kırmızı kapı, kavisli gri kiremit
      tiers(2, 0.3, false, true, spec.roof);
      break;
    case "shikumen":
      // taş kapı çerçevesi ve alınlık
      box(ud, HOTEL_DOOR_H + 0.2, R - 0.06, 1.1, 0.16, 0.1, spec.trim);
      box(0, wall + roofH / 2, vc, W + 0.06, roofH, dv + 0.06, spec.roof, "solid", 0.02);
      break;
    case "haveli":
      // kumtaşı, çıkma pencere saçağı, mazgallı korniş
      box(0, wall - 0.04, R - 0.08, W + 0.06, 0.08, 0.16, spec.trim);
      box(0, wall + roofH / 2, vc, W + 0.06, roofH, dv + 0.06, spec.roof, "solid", 0.02);
      break;
    case "rockcut":
      // kayaya oyulmuş cephe: sütun dikmeleri ve üçgen alınlık
      for (const u of [-W / 2 + 0.15, W / 2 - 0.15]) box(u, wall / 2, R - 0.06, 0.2, wall, 0.12, spec.trim);
      box(0, wall + roofH / 2, vc, W + 0.04, roofH, dv + 0.04, spec.walls, "solid", 0.04);
      break;
    case "room":
      // iç mekân dinlenme odası: düz kutu, üst bant, kapı yanında küçük ışık
      box(0, wall - 0.05, R - 0.03, W, 0.1, 0.06, spec.trim);
      break;
    case "cabin":
      // kütük duvar bantları, beşik çatı, baca
      for (let y = 0.3; y < wall; y += 0.32) box(0, y, R - 0.03, W, 0.05, 0.05, spec.trim);
      tiers(3, 0.22, false, true, spec.roof);
      box(W / 2 - 0.4, h - 0.2, D - 0.6, 0.24, 0.4, 0.24, "#6B6B6B", "solid", 0.04);
      break;
    case "hut":
      // bambu dikmeler, saz kırma çatı
      for (const u of [-W / 2 + 0.06, W / 2 - 0.06]) box(u, wall / 2, R - 0.03, 0.1, wall, 0.1, spec.trim);
      tiers(3, 0.3, true, true, spec.roof);
      break;
    case "deckhouse":
      // beyaz güverte evi, tik pervaz, lombozlar
      box(0, 0.08, R - 0.03, W, 0.16, 0.05, spec.trim);
      box(0, wall - 0.05, R - 0.03, W, 0.1, 0.05, spec.trim);
      break;
    case "pod":
      // yuvarlatılmış kapsül: kademeli tepe, ışık şeridi
      tiers(3, 0, true, true, spec.roof);
      box(0, 0.25, R - 0.02, W, 0.05, 0.04, spec.glow, "glow");
      break;
  }
}

// ------------------------------------------------------------------------------------------ büyüme (tabanı otelsiz şehir)
/** Büyüme bölgesi oteli (tabanında otel olmayan şehir; duraklatılmış geçişler): bölge ortasında küçük kabuk + geçit, önünde
 *  bahçeli meydan (banklar, fenerler, büfe). Yerel karo: kabuk li 4–(4+w−1) × lj 6–(6+d−1), kapı ön ortada. */
export function hotelAmenity(id: string, spec: HotelSpec, s: CityStyle): Amenity {
  const w = Math.min(4, spec.w), d = Math.min(3, spec.d), li0 = 6 - Math.floor(w / 2), lj0 = 6, doorLi = li0 + Math.floor((w - 1) / 2);
  return {
    label: HOTEL_LABEL,
    floor: (li, lj) => (lj >= 1 && lj <= 14 && li >= 1 && li <= 11 ? pick2(s.ground.plaza, li, lj) : pick2(s.ground.sidewalk, li, lj)),
    build: (x: Bay) => {
      const { b, I, J } = x;
      placeHotel(b, id, { at: [I(li0), J(lj0)], w, d, door: [I(doorLi), J(lj0 + d)] }, s);
      // ön meydan: saksılar, fenerler, banklar (dinlenme zeminde: REAL-SEAT-001), büfe, çiçek tarhları
      planter(b, I(2), J(4)); planter(b, I(10), J(4));
      streetLamp(b, s, I(3), J(12)); streetLamp(b, s, I(9), J(12));
      cityBench(b, I(2), J(14), "+z"); cityBench(b, I(4), J(14), "+z");
      b.rest.push([I(3), J(14)], [I(1), J(14)]);
      kiosk(b, s, I(10), J(14), spec.door);
      flowerBed(b, I(8), J(15), 1, 1, s.awnings); flowerBed(b, I(2), J(15), 2, 1, s.awnings);
      flowerBed(b, I(2), J(7), 1, 2, s.awnings); flowerBed(b, I(10), J(7), 1, 2, s.awnings);
      b.hook("window", I(2), J(10));
      x.sign = [tx(I(6)), spec.h + 0.9, tz(J(lj0 + d)) - 0.5];
    },
  };
}

// ------------------------------------------------------------------------------------------ tema sarmalayıcıları
const hash = (t: string) => { let h = 7; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const TONES: Record<string, readonly string[]> = {};

/** Şehir büyüme temasını otel mantığına çevirir: açık hava yatak sırası ve uyku olanakları yok; büyümeye en çok TEK otel (yalnız
 *  tabanı otelsizse — `hotelPlanKit`); ekip alanı şehrin paletinde. Saf; aynı girdi → aynı tema. */
export function withHotel(id: string, th: Theme, s: CityStyle): Theme {
  const spec = hotelSpec(id, s);
  const tones = TONES[id] ?? [s.trim, "#E6DCC8", "#D8CCB4", spec.walls];
  const keep = th.amenities.filter((a) => districtRole("amenity", a.label) !== "sleep");
  return groundRest({
    ...th,
    sleeper: undefined,
    amenities: [...keep, ...cityAmenities(id, s)],
    hotel: hotelAmenity(id, spec, s),
    hotelEvery: HOTEL_EVERY,
    teamTint: (team) => tones[hash(team) % tones.length],
    curb: pick2(s.ground.quay, 0, 0),
  }); // REAL-SEAT-001: bütün büyüme temalarında dinlenme karoları zeminde (bank/kutu üstünde değil)
}

/** Şehir olmayan sahnenin büyüme teması: açık hava yatak şeridi ve uyku olanakları yok (uyku tabandaki konağın geçidinde). */
export function withLodge(th: Theme): Theme {
  const keep = th.amenities.filter((a) => districtRole("amenity", a.label) !== "sleep");
  return { ...th, sleeper: undefined, amenities: keep.length ? keep : th.amenities };
}

/** Planlayıcı kiti: tabanında otel bölgesi olan sahnede büyüme otel eklemez (HOTEL-ONE-001). */
export function hotelPlanKit<T extends { hotel?: unknown; hotelEvery?: number }>(kit: T, base: Pick<Built, "zones">): T {
  return kit.hotel && hasHotelZone(base) ? { ...kit, hotel: undefined, hotelEvery: undefined } : kit;
}
