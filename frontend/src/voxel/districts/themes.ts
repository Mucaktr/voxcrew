/**
 * S38 — bölge temaları: her sahnenin büyürken kullandığı palet (yol, zemin, alt, çerçeve), çalışma alanı sınırı, koltuk
 * (pod masası), boş pod yuvası içeriği, paylaşılan olanaklar (dönüşümlü) ve avlu. Kayıt tembel kurulur (döngüsel içe aktarma).
 *
 * Ortak kurallar (yol bulma bunlara güvenir; scripts doğrulaması: bütün istasyon/nokta/mola karoları erişilebilir):
 *  - lj 0 / li 0 yol karoları engellenmez (yalnız ilk satırda `row0` dış duvar çizebilir);
 *  - arka sınır lj 1'de, kapı li 6; sol sınır li 1'de, geçitler lj 2/7/12; ön kenar lj 15'te en çok li 2–4 ve 8–10 dolu;
 *  - pod yuvaları (2,3) (7,3) (2,8) (7,8) — 4×4 — ve koridorlar lj 2/7/12, li 6/11 boş kalır.
 */
import { DIR_ANGLE, DIR_VEC, tx, tz, type Builder, type Device, type Dir, type DistrictKind, type Pose } from "../scenes";
import { mallTheme } from "../scenes/mall";
import { schoolTheme } from "../scenes/school";
import { DEFAULT_CITY } from "../city/style";
import { cityTheme, groundRest } from "./city";
import { istanbulTheme } from "./istanbul";
import { kapadokyaTheme } from "./kapadokya";
import { londraTheme } from "./londra";
import { NEW_CITIES } from "../cities/index";
import { NEW_CITY_PARTS } from "../cities/parts";
import { indoorThemes } from "./indoor";
import { marinaThemes } from "./marina";
import { outdoorThemes } from "./outdoor";
import { withHotel, withLodge } from "./hotel";
import { fullPilotThemes } from "../../full/themes";
import { ISTANBUL_STYLE } from "../city/styles/istanbul";
import { KAPADOKYA_STYLE } from "../city/styles/kapadokya";
import { LONDRA_STYLE } from "../city/styles/londra";
import { bookshelf, DOWN, fenceX, fenceZ, LEFT, postSign, wallSign, whiteboard, type Fence } from "./parts";

/** Kurulmakta olan bölge (12×16). `I`/`J`: yerel → dünya karosu. */
export interface Bay {
  b: Builder;
  i0: number; j0: number;
  /** ızgaranın ilk satırında (taban sahnenin yanında) */
  row0: boolean;
  kind: DistrictKind;
  /** kurulacak pod sayısı (ekip/ortak çalışma) */
  pods: number;
  /** aynı türden kaçıncı (olanak dönüşümü; ekipte kaçıncı bölge) */
  variant: number;
  /** ekip rengi (ortak çalışmada temanın çerçeve rengi). GROWTH: `teamTint`li temada şehrin paletinden seçilmiş ton */
  color: string;
  /** GROWTH: ekibin gerçek rengi (yalnız tabela levhası; `color` şehir tonuna çevrildiğinde de korunur) */
  teamColor?: string;
  team: string | null;
  I: (li: number) => number;
  J: (lj: number) => number;
  /** etiket çapası (dünya koordinatı); tema değiştirebilir */
  sign: [number, number, number];
  /** halka düzeninde (çekirdekli şehir) taban dikdörtgeni, dünya karosu (çekirdek ⊆ taban). Tema, taşan parçaları
   * (geniş ağaç tacı) buna göre yerleştirir: CITY-CORE-001 0,4 kenar payını aşan blok çekirdeğe girmez. Köşe düzeninde yok.*/
  keep?: { i0: number; j0: number; w: number; d: number };
  /** tema çalışma bölgesini bir mekân olarak kurduysa mekân kimliği (workzones/venues.ts)*/
  venue?: string;
}

/** (i, j)–(i+1, j) masası; ajan "+z"de (i, j-1)'de kameraya bakar, "-z"de (i, j+1)'de sırtı kameraya dönük oturur. */
export type Seat = (b: Builder, i: number, j: number, face: "+z" | "-z", n: number, x: Bay) => void;
export interface Amenity {
  label: string; floor?: (li: number, lj: number) => string; build: (x: Bay) => void;
  /** S46: yol karosu (lj 0 / li 0) çizilsin mi (yoksa `floor`); kıyı şeridinde deniz yolun yerini alır. Yürünebilirlik kuralı
   *  (GROW-ROAD-001) yalnız ilk satırın lj 0'ını muaf tutar: li 0 sütunu iskeleyle yürünebilir kalmalı. */
  street?: (li: number, lj: number) => boolean;
}

export interface Theme {
  /** taban sahnenin bölge adı (locale anahtarı) */
  hq: string;
  /** ortak çalışma çerçevesi / yedek vurgu */
  trim: string;
  under: string;
  path: (li: number, lj: number) => string;
  floor: (li: number, lj: number) => string;
  /** zemin bloğu yerine su üstünde tahta: [renk 1, renk 2, direk, direğin boyu] */
  deck?: readonly [string, string, string, number];
  /** taban sahnenin ön kenarı yürünemiyorsa (yat) aşağı inen iskele */
  gangway?: { col: number; rows: [number, number] };
  work: (x: Bay) => void;
  seat: Seat;
  /** pod başına bir kez (kamp ateşi, kiosk kanopisi…) */
  pod?: (x: Bay, pi: number, pj: number) => void;
  spare: (x: Bay, pi: number, pj: number, slot: number) => void;
  amenities: Amenity[];
  yard: Amenity;
  /** S46: kıyı şeridi — tabanın ilk satırında deniz varsa (sahil), MERKEZ'in sağındaki ilk satır yuvaları bu şablonla
   *  kurulur (deniz lj 0–4 kesintisiz sürer; core.ts `planDistricts`). Çalışma bölgeleri ikinci satırdan başlar. */
  coast?: Amenity;
  row0?: (x: Bay) => void;
  // ---- S41 sahne mantığı (hepsi isteğe bağlı; yoksa eski davranış)
  /** istasyon duruşu/cihazı/oturak yüksekliği*/
  pose?: Pose; device?: Device; seatY?: number;
  /** ajan pod'un dışına bakar (bank/şezlong: sırtlık ortada) */
  faceOut?: boolean;
  /** çalışma bölgesi koridorlarının zemini (patika, halı yolu) */
  aisle?: (li: number, lj: number) => string;
  /** ön şeritte bir uyku yeri çizer ve `b.sleep` ekler (core.ts SLEEP_ROW) */
  sleeper?: (b: Builder, i: number, j: number, k: number, x: Bay) => void;
  /** GROWTH (ürün sahibi 2026-10-28, districts/hotel.ts) — uyku OTEL bölgesinde: şehrin mimarisinde otel binası, yataklar içeride.
   * Varsa planlayıcı her `hotelEvery` çalışma bölgesine bir otel koyar; `sleeper` (açık hava yatağı) kullanılmaz.*/
  hotel?: Amenity;
  hotelEvery?: number;
  /** GROWTH: ekip alanının dünya içi tonu (tente, halı) — ekip renginin yerine şehrin paletinden (bayrak/renkli alan yok) */
  teamTint?: (team: string, variant: number) => string;
  /** GROWTH: çalışma bölgesi çerçevesinin zemin rengi (yoksa ekip rengi `color`) */
  curb?: string;
  /** S41 su üstü marina (yat/deniz): `floor` "" dönen karolar SU olur (engellenir, köpük çizilir; okyanus düzlemi görünür),
   *  ekip çerçevesi çizilmez (ekip rengi tekne tentesinde ve bayrakta). `waterY`: sahnenin okyanus yüksekliği, `surface`:
   *  marina su yüzeyi (iskeleye yakın; satır başına birleşik "water" kutusu), `water`: rengi. */
  marina?: { waterY: number; surface: number; water: string };
}

/** SP-W0: `city` = şehir teması tabanı (varsayılan stil; sahne değil — rules.mjs `city-theme:*` vakaları ve şehir sahneleri
 *  kendi stilleriyle `cityTheme(style)` kaydeder). */
let REG: Record<string, Theme> | null = null;
/** SP-W1 — pilot sahnelerin büyüme temaları (kendi dosyalarında; kayıt W1-INT). */
function pilotThemes(): Record<string, Theme> {
  // GROWTH (ürün sahibi 2026-10-28): bütün şehir temaları `withHotel` ile — uyku şehre özgü OTEL binasında (açık hava yatağı yok),
  // ekip alanı şehrin paletinde (bayrak/ekip renkli tente yok), şehre uygun ek olanak (districts/hotel.ts)
  return {
    istanbul: withHotel("istanbul", istanbulTheme(), ISTANBUL_STYLE),
    kapadokya: withHotel("kapadokya", kapadokyaTheme(), KAPADOKYA_STYLE),
    londra: withHotel("londra", londraTheme(), LONDRA_STYLE),
    ...fullPilotThemes({ withHotel, groundRest }),
    // yeni şehirler kendi stilleriyle şehir teması (genel merkez etiketi `dist_<id>_hq` varsa o)
    ...Object.fromEntries(NEW_CITIES.map((m) => {
      const id = m.catalog.id, hq = `dist_${id}_hq`, s = NEW_CITY_PARTS[id].style;
      // CITY-REDO: şehrin kendi teması (`<id>/theme.ts`) varsa o; yoksa genel şehir teması
      return [id, withHotel(id, NEW_CITY_PARTS[id].theme?.() ?? cityTheme(s, m.locale.world?.tr[hq] ? hq : undefined), s)];
    })),
  };
}
function registry(): Record<string, Theme> {
  const all: Record<string, Theme> = { ...indoorThemes(), ...outdoorThemes(), ...marinaThemes(), mall: mallTheme(), school: schoolTheme(),
    city: withHotel("city", cityTheme(DEFAULT_CITY), DEFAULT_CITY), ...pilotThemes() };
  // HOTEL-SYS (E1): şehir olmayan temalarda da açık hava yatak şeridi ve uyku olanağı yok — uyku tabandaki konağın geçidinde
  for (const [id, th] of Object.entries(all)) if (!th.hotel) all[id] = withLodge(th);
  return all;
}
export function theme(id: string): Theme {
  REG ??= registry();
  return REG[id] ?? REG.office;
}
export function hasTheme(id: string): boolean {
  REG ??= registry();
  return id in REG;
}

// ------------------------------------------------------------------ ortak yardımcılar
/** Koltuk işareti: istasyonda kendi oturağı olan temalarda (bank, kütük, şezlong) ikinci sandalye çizilmesin (Props.tsx). */
export function seatMark(b: Builder, i: number, j: number, face: Dir = "+z"): void {
  b.props.push({ k: "chair", p: [tx(i), 0, tz(j)], r: DIR_ANGLE[face] });
}

/** Kahve/mola noktası (canlı dekor işareti) — makine yerine temaya özgü görünüm (çaydanlık, bar, araba) çizildiğinde. */
export function breakSpot(b: Builder, i: number, j: number, face: Dir = "+z"): void {
  const [fx, fz] = DIR_VEC[face];
  b.props.push({ k: "coffee", p: [tx(i), 0, tz(j)], r: DIR_ANGLE[face], tile: [i + fx, j + fz] });
}

/** Masaya göre ajan karosu ve dizüstünün kullanıcı tarafı. */
export function seatSide(j: number, face: "+z" | "-z") {
  const agentJ = face === "+z" ? j - 1 : j + 1;
  return { agentJ, user: (face === "+z" ? "-z" : "+z") as "-z" | "+z", dz: face === "+z" ? -1 : 1 };
}

export interface IndoorStyle {
  wall: string;
  /** süpürgelik / duvar dibi şeridi */
  base: string;
  /** duvar yüksekliği (arka) */
  h: number;
  shelf: string;
  books?: readonly string[];
  /** sol bölme */
  side: Fence;
  /** ön kenar süsü (li 2–4 ve 8–10, lj 15) */
  front?: (b: Builder, i: number, j: number) => void;
  /** pencere camı rengi */
  glass?: string;
}

/** İç mekân arka duvarı (lj 1): li 3–4 kitaplık (okuma), li 6 kapı + üstünde tabela, li 7–8 pencere (web), li 9–10 duvara
 *  asılı beyaz tahta (plan). `door=false`: kapısız (olanak bölgelerinde). */
export function indoorBack(x: Bay, s: IndoorStyle, o: { shelves?: boolean; window?: boolean; board?: boolean; door?: boolean; signColor?: string } = {}): void {
  const { b, I, J } = x;
  const shelves = o.shelves !== false, win = o.window !== false, board = o.board !== false, door = o.door !== false;
  const gaps = [...(shelves ? [3, 4] : []), ...(door ? [6] : []), ...(win ? [7, 8] : [])].map(I);
  const j = J(1);
  fenceX(b, j, I(1), I(11), gaps, { c: s.wall, h: s.h, t: 1 });
  b.box((tx(I(1)) + tx(I(11))) / 2, 0.12, tz(j) + 0.505, 11, 0.24, 0.02, s.base);
  if (door) {
    b.box(tx(I(6)), s.h - 0.3, tz(j), 1, 0.6, 1, s.wall, "solid", 0.03);
    b.box(tx(I(6)), 0.01, tz(j), 0.9, 0.02, 0.9, s.base);
  }
  if (shelves) for (const li of [3, 4]) { bookshelf(b, I(li), j, s.shelf, Math.min(2.2, s.h), "+z", s.books); b.spot("read", I(li), J(2), DOWN); }
  if (win) {
    const xw = (tx(I(7)) + tx(I(8))) / 2;
    b.box(xw, 0.4, tz(j), 2, 0.8, 1, s.wall, "solid", 0.03);
    b.box(xw, (0.8 + s.h - 0.25) / 2, tz(j), 2, s.h - 1.05, 0.2, s.glass ?? "#A8D8F0", "glass");
    b.box(xw, s.h - 0.12, tz(j), 2, 0.24, 1, s.wall, "solid", 0.03);
    b.box(xw, (0.8 + s.h - 0.25) / 2, tz(j) + 0.12, 0.08, s.h - 1.05, 0.06, s.base);
    b.block(I(7), j); b.block(I(8), j);
    b.spot("web", I(7), J(2), DOWN); b.spot("web", I(8), J(2), DOWN);
  }
  if (board) { whiteboard(b, I(9), j, 2); b.spot("plan", I(9), J(2), DOWN); b.spot("plan", I(10), J(2), DOWN); }
  if (o.signColor) wallSign(b, I(6), j, o.signColor, s.h - 0.05, 2.2);
  x.sign = [tx(I(6)), s.h + 0.55, tz(j) + 0.6];
}

/** Sol bölme (li 1) geçitli + ön kenar süsleri. */
export function indoorSides(x: Bay, s: IndoorStyle): void {
  const { b, I, J } = x;
  fenceZ(b, I(1), J(2), J(15), [2, 7, 12].map(J), s.side);
  if (s.front) for (const li of [2, 3, 4, 8, 9, 10]) s.front(b, I(li), J(15));
}

/** Açık hava arka sınırı (lj 1, kapı li 6) + ayaklı tabela (li 5) + okuma/web/plan noktaları (li 3, 8, 10 önünde). */
export function outdoorBack(x: Bay, fence: Fence, props: { read: (i: number, j: number) => void; web: (i: number, j: number) => void;
  plan: (i: number, j: number) => void }, signColor: string, wood?: string): void {
  const { b, I, J } = x;
  const j = J(1);
  fenceX(b, j, I(1), I(11), [3, 5, 6, 8, 10].map(I), fence);
  props.read(I(3), j); b.spot("read", I(3), J(2), DOWN);
  props.web(I(8), j); b.spot("web", I(8), J(2), DOWN);
  props.plan(I(10), j); b.spot("plan", I(10), J(2), DOWN);
  postSign(b, I(5), j, signColor, wood);
  x.sign = [tx(I(5)), 2.15, tz(j)];
}

/** Ekip köşesi (lj 13–14): kabuk terminali (2,13 → nokta 3,13), dinlenme mobilyası. ekip bayrağı hiçbir temada yok
 * (ekip kimliği tabela/tente/etiket; ürün sahibi 2026-11-02 "bayraklı alanlar").*/
export function teamCorner(x: Bay, rest: (b: Builder, i: number, j: number) => void): void {
  const { b, I, J } = x;
  b.terminal(I(2), J(13), "+x");
  b.spot("shell", I(3), J(13), LEFT);
  rest(b, I(4), J(14));
}
