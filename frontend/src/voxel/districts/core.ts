/**
 * S38 — anlamlı büyüme: ajan sayısı taban sahnenin istasyonlarını aşınca dünya, sahnenin kendi temasında ve amacı olan
 * BÖLGELERLE büyür (eskiden: aynı 6×3 masa ızgarası tekrar tekrar).
 *
 *  - Izgara: 24×16'lık hücreler; taban sahne (MERKEZ) hep sol-arka köşede (0,0) kalır ve hiç kaymaz. Dünya kutusu sabit,
 *    sayıdan bağımsız bir sırayla (L halkaları: genişlik/derinlik ≈ 1,3) büyür; S46: bölgeler kutuya YILAN sırasıyla dizilir
 *    (bkz. `planDistricts`: ekip tek parça, komşuluk matrisi, kopya avlu yok).
 *    RING-INT: simge çekirdekli sahnelerde (`SceneDef.core`, şehirler) taban dünyanın ORTASINDA kalır ve bölgeler dört yandan
 *    sarmal halkalarla eklenir (`ringPlan`, `shiftBase`); çekirdeksiz sahnelerde yukarıdaki düzen birebir aynıdır.
 *  - Her hücre iki 12×16 BÖLGEDEN (bay) oluşur. Bölge türleri: ekip alanı (team), ortak çalışma (guest: ekipsiz ajanlar ve
 *    harici oturumlar MERKEZ'e sığmayınca), paylaşılan olanak (amenity: mutfak/toplantı/kütüphane/sunucu… sahneye göre) ve
 *    avlu (yard: hücrenin boş kalan yarısı ya da sınır kutusundaki boşluklar).
 *  - Olanak oranı: ilk çalışma çiftinden sonra her 2 çalışma bölgesine bir olanak (her olanakta kahve noktası ve dinlenme
 *    yeri vardır); S46'dan beri olanaklar ekiplerin ARASINA girer, bir ekibi bölmez.
 *  - Ekip alanı: 4 "pod" yuvası × 4 koltuk = 16 koltuk. Pod'lar tembel kurulur (ekip kaç kişiyse o kadar pod); boş yuvalar
 *    ekibin toplantı/oturma köşesi olur. Ekip büyürken yeni pod boş yuvaya kurulur: kimse yer değiştirmez.
 *  - Bölge iç düzeni (yerel karo li 0–11, lj 0–15): lj 0 satırı ve li 0 sütunu yol (bütün dünyada sürekli sokak ağı),
 *    lj 1 arka duvar/sınır (li 6'da kapı), li 1 sol bölme (lj 2/7/12'de geçit), pod yuvaları (2,3) (7,3) (2,8) (7,8),
 *    koridorlar lj 2/7/12 ve li 6/11, ekip köşesi lj 13–14, ön kenar lj 15.
 *
 * Döngüsel içe aktarma: yalnızca fonksiyon gövdelerinde scenes.ts değerleri kullanılır (bkz. parts.ts notu).
 */
import { Builder, D, key, PLAY_BOARD, tx, tz, W, type Built, type DistrictKind, type ModuleCell, type SpotKind, type Station, type Tile } from "../scenes";
import { isInSacredBuffer } from "../city/sacred";
import { DOWN, slab, UP } from "./parts";
import { theme, type Bay, type Theme } from "./themes";
import { NEW_CITIES } from "../cities/index";
import { FULL_BOARD_THEMES, FULL_NOISY_LABELS, FULL_SLEEP_LABELS } from "../../full/districtCore";
import { stool } from "../city/furniture";
import { resolveStationSeats } from "../fun/seats";
// WORK-ZONES (plan §5 C2): şehir ofis binası şablonu (kendi modülünde; burada yalnız plan/kurulum kancası)
import { OFFICE_TPL, officeAmenity } from "../workzones/offices";

export const BAY = 12;
/** Bölge başına pod yuvası (sol-arka karo, yerel) ve pod başına koltuk. */
export const POD_SLOTS: readonly [number, number][] = [[2, 3], [7, 3], [2, 8], [7, 8]];
export const POD_SEATS = 4;
export const BAY_SEATS = POD_SLOTS.length * POD_SEATS;
/** Sabit kapı/geçit karoları (yerel). Temalar sınırlarını bunlara göre çizer; yol bulma bu geçitlere güvenir. */
export const GATES = { back: [6] as readonly number[], left: [2, 7, 12] as readonly number[], front: [5, 6, 7, 11] as readonly number[] };

/** Bir ekibin talebi (ekip sırasıyla) + ekipsiz/harici karakter sayısı. */
export interface Demand {
  teams: { slug: string; n: number; color: string }[]; guests: number;
  /** WORK-ZONES: kullanılan şehir ofis binaları (zones.json ofis kimlikleri, sıralı). Yoksa/boşsa plan birebir eskisi. */
  offices?: string[];
}

export interface BayPlan {
  kind: DistrictKind; team?: string; color?: string; pods: number; variant: number;
  /** S46: bölge yuvası (12 karoluk sütun, 16 karoluk satır) — sol-arka dünya karosu (col·12, row·16) */
  at: [number, number];
  /** S46: olanak/avlu şablonu (tema `amenities` dizini; -1 = tema avlusu, -2 = kıyı şeridi, -3 = otel `HOTEL_TPL`,
   *  -4 = ofis binası `OFFICE_TPL`) */
  tpl?: number;
  /** WORK-ZONES: ofis binası kimliği (`tpl` = OFFICE_TPL) */
  office?: string;
}
export interface DistrictPlan {
  bays: BayPlan[]; cells: [number, number][]; holes: [number, number][]; width: number; depth: number; sig: string;
  /** RING-INT — halka büyüme (`SceneDef.core`): taban sahnenin bölge yuvası (sütun, satır; 12×16 bölge birimi). Taban
   *  `buildDistricts`'te (sütun·12, satır·16) karo ötelenir; yoksa taban sol-arka köşede kalır (eski davranış). */
  core?: [number, number];
  /** CITY-B — kıyı halkası (`SceneDef.core` + tema `coast`, ör. <city>): taban dünyanın ARKA kenarında (x'te ortalı) durur, deniz
   * dünyanın arkasındaki ufuk bandıdır; bölgeler yalnız sol, sağ ve önden eklenir; taban satırının yan yuvaları kıyı şerididir.*/
  shore?: boolean;
}

/** S46 — bölge rolü (komşuluk matrisi): uyku bölgesi gürültülü bir bölgeye kapı komşusu olmaz.*/
export type DistrictRole = "work" | "sleep" | "noisy" | "calm";
const SLEEP_LABELS = new Set(["dist_hotel", ...FULL_SLEEP_LABELS, "dist_quietroom", "dist_hammocks", "dist_bedrooms", "dist_beachhuts", "dist_backroom", "dist_tents", "dist_restlounge",
  "dist_dorm", "dist_barracks", "dist_stilthuts", "dist_houseboats", "dist_crewquarters", "dist_bunkhouse"]);
/** Gece gürültüsü / ticari-endüstriyel: mutfak, yemek katı, bar-kulüp, kavurma, sunucu uğultusu, atölye, otopark, rampa,
 *  depo, büyük ateş, konferans salonu. Gündüz oyun alanları (spor sahası, voleybol, pist, oyun bahçesi) gürültülü sayılmaz. */
const NOISY_LABELS = new Set([...FULL_NOISY_LABELS, "dist_kitchen", "dist_beachclub", "dist_cafe_terrace", "dist_roastery", "dist_bonfire", "dist_foodcourt",
  "dist_auditorium", "dist_mess", "dist_dockcafe", "dist_marinaclub", "dist_messhall", "dist_launchpad", "dist_workshop", "dist_parking",
  "dist_depot", "dist_server"]);
export function districtRole(kind: DistrictKind | undefined, label?: string): DistrictRole {
  if (!kind || kind === "hq" || kind === "team" || kind === "guest") return "work";
  if (label && SLEEP_LABELS.has(label)) return "sleep";
  if (label && NOISY_LABELS.has(label)) return "noisy";
  return "calm";
}
/** İki rol kapı komşusu olabilir mi? (uyku ↔ gürültü yasak) */
export const rolesCompatible = (a: DistrictRole, b: DistrictRole) => !((a === "sleep" && b === "noisy") || (a === "noisy" && b === "sleep"));

// ------------------------------------------------------------------ dünya boyutu (sabit, sayıdan bağımsız sıra)
let order: [number, number][] | null = null;
/** (sütun, satır) hücreleri: eklenen hücrenin sınır kutusu küçük olan önce; eşitlikte sütun artan, satır azalan.
 *  S46: yalnız DÜNYA BOYUTUNU seçer (önekin sınır kutusu); bölgeler kutunun içine yılan sırasıyla yerleşir. */
function cellOrder(): [number, number][] {
  if (order) return order;
  const out: [number, number][] = [];
  for (let c = 0; c < 14; c++) for (let r = 0; r < 14; r++) if (c || r) out.push([c, r]);
  const k = ([c, r]: [number, number]) => Math.max(((c + 1) * W) / 1.3, (r + 1) * D);
  out.sort((a, b) => k(a) - k(b) || a[0] - b[0] || b[1] - a[1]);
  order = out;
  return out;
}

/** Planlayıcının bildiği tema şablonları (adlar; kurulum `buildDistricts`'te). GROWTH: `hotel` varsa (şehir temaları,
 *  districts/hotel.ts) uyku açık hava yatakları yerine OTEL bölgelerindedir: her `hotelEvery` çalışma bölgesine bir otel. */
export interface PlanKit { amenities: { label: string }[]; yard: { label: string }; coast?: { label: string }; hotel?: { label: string }; hotelEvery?: number }
/** GROWTH — otel bölgesinin şablon kimliği (tema `hotel`). Planlayıcı yerleştirir; şablon dağıtımı ve takas dokunmaz. */
export const HOTEL_TPL = -3;

/**
 * Talep → bölge planı. Ajanlar MERKEZ'e sığıyorsa null (dünya büyümez; taban sahne aynen).
 *
 * S46: eskiden bölgeler sabit hücre sırasına tek tek dizilir, her 3. konum olanak olurdu → bir
 * ekibin bölgeleri dünyanın iki ucuna dağılır (ekip okunmaz), sınır kutusu boşlukları aynı avlunun kopyalarıyla dolar, aynı
 * olanak yan yana gelirdi. Şimdi:
 * 1. Dünya boyutu: `cellOrder` önekinin sınır kutusu, yeterli yuva olana dek (kıyı şeridi satırı yuva sayılmaz).
 * 2. Yuvalar YILAN sırasıyla (satır 0 MERKEZ'in sağından soldan sağa, satır 1 sağdan sola…): ardışık iki yuva hep komşu.
 * 3. Dizi: her ekibin bölgeleri ARDIŞIK (→ ekip tek parça, `TEAM-CONTIG-001`), olanaklar yalnız ekipler arasına, en sonda
 * ortak çalışma; olanak sayısı eskisiyle aynı: ⌊(çalışma − 1) / 2⌋ (`GROW-INFRA-001`).
 * 4. Artan yuvalar: önce henüz kullanılmamış olanaklar, sonra avlu ve olanak dönüşümü — aynı şablon komşu olmaz
 * (`DIST-CLONE-001`), uyku bölgesi gürültülü bölgeye komşu olmaz (`DIST-ADJ-001`).
 * Aynı talep → aynı plan. Bir ajan eklemek bölge dizisini değiştirmiyorsa kimse yer değiştirmez; yeni bir bölge gerektiğinde
 * (ekip 16'nın katını aşınca / yeni ekip / dünya kutusu büyüyünce) sonraki bölgeler yeniden akar (belgeli istisna).
*/
export function planDistricts(baseSeats: number, demand: Demand, kit?: PlanKit, ring = false, baseB: BaseBays = BASE_2x1): DistrictPlan | null {
  const total = demand.teams.reduce((s, t) => s + t.n, 0) + demand.guests;
  // WORK-ZONES: ajanlar MERKEZ'e sığsa da kullanılan ofis binası için dünya büyür (yalnız ofis bölgeleri; koltuklar tabanda kalır)
  const offices = demand.offices ?? [];
  if (total <= baseSeats && !offices.length) return null;
  const officeOnly = total <= baseSeats;
  type Item = Omit<BayPlan, "at">;
  const seq: Item[] = [];
  let work = 0, amen = 0, hotels = 0;
  const owe = () => { for (const need = Math.floor(Math.max(0, work - 1) / 2); amen < need; amen++) seq.push({ kind: "amenity", pods: 0, variant: amen }); };
  // GROWTH (ürün sahibi 2026-10-28): otel temalı sahnede her `hotelEvery` çalışma bölgesine bir otel; ekip dizisinin hemen ardından
  // (ekibe yakın, ekibi bölmez — TEAM-CONTIG-001). Otelsiz temada dizi ve imza birebir eskisi.
  const every = kit?.hotel ? Math.max(1, kit.hotelEvery ?? 3) : 0;
  const oweHotel = () => { if (every) for (const need = Math.ceil(work / every); hotels < need; hotels++) seq.push({ kind: "amenity", pods: 0, variant: hotels, tpl: HOTEL_TPL }); };
  for (const t of officeOnly ? [] : demand.teams) {
    for (let left = t.n, k = 0; left > 0; left -= BAY_SEATS, k++) {
      seq.push({ kind: "team", team: t.slug, color: t.color, pods: Math.ceil(Math.min(BAY_SEATS, left) / POD_SEATS), variant: k });
      work++;
    }
    oweHotel();
    owe();
  }
  for (let left = demand.guests - Math.min(demand.guests, baseSeats), k = 0; left > 0; left -= BAY_SEATS, k++) {
    seq.push({ kind: "guest", pods: Math.ceil(Math.min(BAY_SEATS, left) / POD_SEATS), variant: k });
    work++;
  }
  oweHotel();
  owe();
  // WORK-ZONES: kullanılan ofis binaları dizinin sonunda (ofis yoksa dizi ve imza birebir eskisi)
  offices.forEach((office, k) => seq.push({ kind: "amenity", pods: 0, variant: k, tpl: OFFICE_TPL, office }));
  if (!seq.length) seq.push({ kind: "yard", pods: 0, variant: 0 });
  if (ring) return kit?.coast ? shorePlan(seq, kit, baseB) : ringPlan(seq, kit, baseB);
  if (baseB[0] !== 2 || baseB[1] !== 1) throw new Error("köşe düzeni yalnız 2×1 bölgelik taban içindir (büyük taban çekirdekli olmalı)");
  const coast = !!kit?.coast;
  // 1. dünya boyutu
  let mc = 0, mr = 0;
  for (const [c, r] of cellOrder()) {
    mc = Math.max(mc, c); mr = Math.max(mr, r);
    if (2 * (mc + 1) * (mr + 1) - 2 - (coast ? 2 * mc : 0) >= seq.length) break;
  }
  const SC = 2 * (mc + 1), R = mr + 1;
  // 2. yılan sırası
  const snake: [number, number][] = [];
  for (let r = coast ? 1 : 0, k = 0; r < R; r++, k++) {
    const row: [number, number][] = [];
    for (let c = 0; c < SC; c++) if (r > 0 || c >= 2) row.push([c, r]);
    if (k % 2) row.reverse();
    snake.push(...row);
  }
  const bays: BayPlan[] = seq.map((it, k) => ({ ...it, at: snake[k] }));
  // kıyı şeridi (satır 0, MERKEZ'in sağı): deniz kesintisiz sürer
  if (coast) for (let c = 2; c < SC; c++) bays.push({ kind: "yard", pods: 0, variant: c, at: [c, 0], tpl: -2 });
  // 4. artan yuvalar
  for (let k = seq.length; k < snake.length; k++) bays.push({ kind: "yard", pods: 0, variant: k - seq.length, at: snake[k] });
  if (kit) assignTemplates(bays, kit, SC, R);
  const cells: [number, number][] = [];
  for (let c = 0; c <= mc; c++) for (let r = 0; r <= mr; r++) if (c || r) cells.push([c, r]);
  const sig = bays.map((b) => `${b.kind[0]}${b.team ?? ""}${b.color ?? ""}.${b.pods}.${b.variant}.${b.tpl ?? ""}${b.office ? `~${b.office}` : ""}@${b.at}`).join("|");
  return { bays, cells, holes: [], width: SC * BAY, depth: R * D, sig };
}

// ------------------------------------------------------------------ RING-INT: simge çekirdeği çevresinde halka büyüme
/**
 * Şehir sahneleri (`SceneDef.core`): taban (2×1 bölge) dünyanın ORTASINDA kalır, bölgeler dört yandan halka halinde eklenir.
 * - Dünya kutusu her zaman tabana göre simetriktir: her yanda `a` bölge sütunu, önde ve arkada `b` bölge satırı
 * (sütun 2 + 2a, satır 1 + 2b) → çekirdeğin ağırlık merkezi her ölçekte dünya merkezindedir (`CITY-CORE-001`).
 * Kutular sırayla: (1,0) (1,1) (2,1) (2,2) (3,2) (3,3)…; talebe yeten ilk kutu seçilir.
 * - Yuvalar SARMAL sırayla dolar: halka k sağ-ortadan başlar, öne (aşağı), sola, arkaya döner; bir sonraki halka bir öncekinin
 * bittiği köşenin sağından sürer → ardışık iki yuva hep kenar komşusu (ekip tek parça, `TEAM-CONTIG-001`). Kırpılmış
 * halkada (a > b) sağ ve sol sütun iki ayrı parçadır; bir ekip ya da ortak çalışma dizisi parçaya sığmazsa parçanın kalanı
 * avlu olur ve dizi sonraki parçada başlar; hiç sığmazsa bir büyük kutu denenir.
 * - Artan yuvalar, olanak/avlu şablonu ve komşuluk kısıtları S46 ile aynı (`assignTemplates`).
 * Kıyı temalı çekirdekli sahne (<city>) bunun yerine `shorePlan` kullanır (taban arka kenarda, halkalar U biçiminde).
*/
/** CITY-BIG — taban boyutu (bölge birimi: sütun × satır). Varsayılan 2×1 (24×16 karo); şehir tabanı ör. 3×2 (36×32). */
export type BaseBays = readonly [number, number];
export const BASE_2x1: BaseBays = [2, 1];
const RING_BOXES: readonly [number, number][] = Array.from({ length: 16 }, (_, k) => [Math.floor(k / 2) + 1, Math.floor(k / 2) + (k % 2)] as [number, number]);

/** (a, b) kutusunun sarmal yuva yolu: kenar komşuluğuyla kesintisiz parçalar (bölge birimi [sütun, satır]). */
export function ringPath(a: number, b: number, [bx, by]: BaseBays = BASE_2x1): [number, number][][] {
  const segs: [number, number][][] = [];
  let cur: [number, number][] = [];
  const R = 2 * b + by;
  for (let k = 1; k <= a; k++) {
    const cR = a + bx - 1 + k, cL = a - k;
    if (k <= b) {
      const rT = b - k, rB = b + by - 1 + k;
      for (let r = rT + 1; r <= rB; r++) cur.push([cR, r]);
      for (let c = cR - 1; c >= cL; c--) cur.push([c, rB]);
      for (let r = rB - 1; r >= rT; r--) cur.push([cL, r]);
      for (let c = cL + 1; c <= cR; c++) cur.push([c, rT]);
    } else {
      for (let r = 0; r < R; r++) cur.push([cR, r]);
      segs.push(cur); cur = [];
      for (let r = R - 1; r >= 0; r--) cur.push([cL, r]);
      segs.push(cur); cur = [];
    }
  }
  if (cur.length) segs.push(cur);
  return segs;
}

/** Ek hücre listesi (24×16 = iki bölge birimi; mini bilgi çipi ve ölçek kademesi `scaleTier`). 2×1 tabanda eskisiyle birebir;
 *  büyük tabanda (ör. 3×2) tabanın dışındaki bölge sayısının yarısı kadar (yukarı yuvarlanmış) hücre. */
function cellsOf(SC: number, R: number, bx: number, by: number): [number, number][] {
  const cells: [number, number][] = [];
  if (bx === 2 && by === 1) { for (let c = 0; c < SC / 2; c++) for (let r = 0; r < R; r++) if (c || r) cells.push([c, r]); return cells; }
  const n = Math.ceil((SC * R - bx * by) / 2);
  for (let k = 0; k < n; k++) cells.push([k % Math.ceil(SC / 2), Math.floor(k / Math.ceil(SC / 2))]);
  return cells;
}

const runKey = (it: Omit<BayPlan, "at">) => (it.kind === "team" ? `t:${it.team}` : it.kind === "guest" ? "g" : null);

/** Diziyi parçalara yerleştirir (ekip/ortak çalışma dizisi bir parçada; sığmazsa parçanın kalanı avlu). Sığmazsa null. */
function placeRuns(seq: Omit<BayPlan, "at">[], segs: [number, number][][]): BayPlan[] | null {
  const bays: BayPlan[] = [];
  let s = 0, p = 0;
  for (let k = 0; k < seq.length;) {
    const rk = runKey(seq[k]);
    let L = 1;
    if (rk) while (k + L < seq.length && runKey(seq[k + L]) === rk) L++;
    if (s >= segs.length) return null;
    if (segs[s].length - p < L) {
      if (p > 0) { s++; p = 0; continue; }
      return null;
    }
    for (let q = 0; q < L; q++) bays.push({ ...seq[k + q], at: segs[s][p++] });
    if (p >= segs[s].length) { s++; p = 0; }
    k += L;
  }
  return bays;
}

/** CITY-B — kıyı halkası kutuları (a yan sütun, b ön satır): (1,1) (2,1) (2,2) (3,2) (3,3)… */
const SHORE_BOXES: readonly [number, number][] = Array.from({ length: 16 }, (_, k) => [Math.floor((k + 1) / 2) + 1, Math.floor(k / 2) + 1] as [number, number]);

/** CITY-B — kıyı halkasının yuva yolu (taban satır 0'da, sütun a…a+1). Halka k (k ≤ b) U biçimindedir: sağ sütun satır 1…k,
 *  ön satır k, sol sütun satır k…1; tek halkalar saat yönünde, çiftler ters → bir halkanın sonu sonrakinin başına kenar komşusu
 *  (tek parça). k > b (kırpılmış) halkada sağ ve sol sütun (satır 1…b) ayrı parçadır. Satır 0 yuvaları kıyı şerididir (yol dışı). */
export function shorePath(a: number, b: number, [bx, by]: BaseBays = BASE_2x1): [number, number][][] {
  const segs: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let k = 1; k <= a; k++) {
    const cR = a + bx - 1 + k, cL = a - k, rF = by - 1 + k;
    if (k <= b) {
      const u: [number, number][] = [];
      for (let r = 1; r <= rF; r++) u.push([cR, r]);
      for (let c = cR - 1; c > cL; c--) u.push([c, rF]);
      for (let r = rF; r >= 1; r--) u.push([cL, r]);
      cur.push(...(k % 2 ? u : u.reverse()));
    } else {
      if (cur.length) { segs.push(cur); cur = []; }
      const right: [number, number][] = [], left: [number, number][] = [];
      for (let r = 1; r <= by - 1 + b; r++) { right.push([cR, r]); left.push([cL, r]); }
      segs.push(right, left);
    }
  }
  if (cur.length) segs.push(cur);
  return segs;
}

function shorePlan(seq: Omit<BayPlan, "at">[], kit: PlanKit, bays0: BaseBays): DistrictPlan {
  const [bx, by] = bays0, big = bx !== 2 || by !== 1;
  for (const [a, b] of SHORE_BOXES) {
    const segs = shorePath(a, b, bays0);
    const bays = placeRuns(seq, segs);
    if (!bays) continue;
    const used = new Set(bays.map((x) => `${x.at}`));
    let v = 0;
    for (const at of segs.flat()) if (!used.has(`${at}`)) bays.push({ kind: "yard", pods: 0, variant: v++, at });
    const SC = bx + 2 * a, R = by + b;
    // kıyı şeridi: taban satırının (0) iki yanı — tabanın denizi ve kumsalı kesintisiz sürer (büyük tabanda yalnız bölge satırı 0)
    for (let c = 0; c < SC; c++) if (c < a || c >= a + bx) bays.push({ kind: "yard", pods: 0, variant: c, at: [c, 0], tpl: -2 });
    assignTemplates(bays, kit, SC, R);
    const cells = cellsOf(SC, R, bx, by);
    const sig = `shore${a}x${b}${big ? `b${bx}x${by}` : ""}|` + bays.map((x) => `${x.kind[0]}${x.team ?? ""}${x.color ?? ""}.${x.pods}.${x.variant}.${x.tpl ?? ""}${x.office ? `~${x.office}` : ""}@${x.at}`).join("|");
    return { bays, cells, holes: [], width: SC * BAY, depth: R * D, sig, core: [a, 0], shore: true };
  }
  throw new Error(`shore plan: ${seq.length} bölge en büyük kıyı kutusuna sığmıyor`);
}

function ringPlan(seq: Omit<BayPlan, "at">[], kit: PlanKit | undefined, bays0: BaseBays): DistrictPlan {
  const run = runKey;
  const [bx, by] = bays0, big = bx !== 2 || by !== 1;
  for (const [a, b] of RING_BOXES) {
    const segs = ringPath(a, b, bays0);
    const bays: BayPlan[] = [];
    let s = 0, p = 0, ok = true;
    for (let k = 0; k < seq.length && ok;) {
      const rk = run(seq[k]);
      let L = 1;
      if (rk) while (k + L < seq.length && run(seq[k + L]) === rk) L++;
      if (s >= segs.length) { ok = false; break; }
      if (segs[s].length - p < L) {
        if (p > 0) { s++; p = 0; continue; } // parçanın kalanı avlu; dizi sonraki parçada
        ok = false; break;
      }
      for (let q = 0; q < L; q++) bays.push({ ...seq[k + q], at: segs[s][p++] });
      if (p >= segs[s].length) { s++; p = 0; }
      k += L;
    }
    if (!ok) continue;
    const used = new Set(bays.map((x) => `${x.at}`));
    let v = 0;
    for (const at of segs.flat()) if (!used.has(`${at}`)) bays.push({ kind: "yard", pods: 0, variant: v++, at });
    const SC = bx + 2 * a, R = by + 2 * b;
    if (kit) assignTemplates(bays, kit, SC, R);
    const cells = cellsOf(SC, R, bx, by);
    const sig = `ring${a}x${b}${big ? `b${bx}x${by}` : ""}|` + bays.map((x) => `${x.kind[0]}${x.team ?? ""}${x.color ?? ""}.${x.pods}.${x.variant}.${x.tpl ?? ""}${x.office ? `~${x.office}` : ""}@${x.at}`).join("|");
    return { bays, cells, holes: [], width: SC * BAY, depth: R * D, sig, core: [a, b] };
  }
  throw new Error(`ring plan: ${seq.length} bölge en büyük halka kutusuna sığmıyor`);
}

/** RING-INT — taban sahneyi büyümüş dünyanın ortasına öteler (yeni nesneler; önbellekteki taban değişmez). Izgara katmanı (blok,
 *  karo, istasyon, nokta, kanca, işaret, ızgara içi bölge) (di, dj) kayar. Izgara DIŞINDAKİ ufuk blokları, ızgara dışı simge
 *  bölgeleri, ışıklar ve ızgara dışı hareketliler "esnetilir": tabanın arkasında/solunda olan yerinde kalır (dünyanın arka/sol
 *  kenarı tabanın eski kenarıyla aynı), önünde/sağında olan dünyanın ön/sağ kenarına taşınır, ortadaki tabanla birlikte kayar →
 *  ufuk bandı büyüyen bölgelerle hiç çakışmaz ve dünyanın arkasında ortalı kalır. */
function shiftBase(base: Built, di: number, dj: number, width: number, depth: number): Built {
  const BW = base.width, BD = base.depth;
  const minX = tx(0) - 0.5, maxX = tx(BW - 1) + 0.5, minZ = tz(0) - 0.5, maxZ = tz(BD - 1) + 0.5;
  const ox = (x: number) => (x < minX ? 0 : x > maxX ? width - BW : di);
  const oz = (z: number) => (z < minZ ? 0 : z > maxZ ? depth - BD : dj);
  const t = (q: Tile): Tile => [q[0] + di, q[1] + dj];
  const st = (s: Station): Station => ({ ...s, tile: t(s.tile) });
  const inGrid = (z: { i0: number; j0: number; w: number; d: number }) => z.i0 >= 0 && z.j0 >= 0 && z.i0 + z.w <= BW && z.j0 + z.d <= BD;
  const spots: Built["spots"] = {};
  for (const [k, l] of Object.entries(base.spots) as [SpotKind, Station[] | undefined][]) if (l) spots[k] = l.map(st);
  const blocked = new Set<string>();
  for (const k of base.blocked) { const [i, j] = k.split(",").map(Number); blocked.add(key(i + di, j + dj)); }
  const m0 = base.modules[0];
  return {
    ...base,
    // ( düzeltmesi): dönen bloğun pivotu ve kabin askısı da tabanla birlikte kayar (yoksa büyümüş dünyada kanat/kabin
    // eski pivot çevresinde, dünyanın öbür ucunda döner)
    blocks: base.blocks.map((q) => ({ ...q, p: [q.p[0] + di, q.p[1], q.p[2] + dj], ...(q.r ? { r: { ...q.r, o: [q.r.o[0] + di, q.r.o[1], q.r.o[2] + dj],
      ...(q.r.k ? { k: [q.r.k[0] + di, q.r.k[1], q.r.k[2] + dj] } : {}) } } : {}) })),
    blocked, stations: base.stations.map(st), spots, rest: base.rest.map(t),
    ...(base.keepOut ? { keepOut: base.keepOut.map(t) } : {}),
    lights: base.lights.map((l) => ({ ...l, pos: [l.pos[0] + ox(l.pos[0]), l.pos[1], l.pos[2] + oz(l.pos[2])] })),
    ...(base.ambient ? { ambient: base.ambient.map((h) => ({ ...h, tile: t(h.tile) })) } : {}),
    ...(base.props ? { props: base.props.map((q) => ({ ...q, p: [q.p[0] + di, q.p[1], q.p[2] + dj], ...(q.tile ? { tile: t(q.tile) } : {}) })) } : {}),
    modules: [{ ...m0, i0: m0.i0 + di, j0: m0.j0 + dj }, ...base.modules.slice(1)],
    ...(base.zones ? { zones: base.zones.map((z) => {
      if (inGrid(z)) return { ...z, i0: z.i0 + di, j0: z.j0 + dj };
      const cx = tx(z.i0) - 0.5 + z.w / 2, cz = tz(z.j0) - 0.5 + z.d / 2;
      return { ...z, i0: z.i0 + ox(cx), j0: z.j0 + oz(cz) };
    }) } : {}),
    // CITY-BIG: tabanın ARKASINDAKİ kara ufku (su değil) bütünüyle tabanla birlikte kayar (di) → şerit kesintisiz, çekirdeğin (dünya
    // merkezi) arkasında ortalı kalır; eskiden yan parçalar dünya kenarlarına esnetildiğinden halka büyümede üç parçaya bölünürdü.
    // Su/dalga ufku (<city> denizi; kıyı yuvaları kendi deniz şeridini ekler) ve yan/ön dekor eskisi gibi esnetilir.
    ...(base.backdrop ? { backdrop: base.backdrop.map((q) => {
      const behind = q.p[2] + q.s[2] / 2 < minZ && q.g !== "water" && q.g !== "wave";
      return { ...q, p: [q.p[0] + (behind ? di : ox(q.p[0])), q.p[1], q.p[2] + oz(q.p[2])] };
    }) } : {}),
    ...(base.movers ? { movers: base.movers.map((mv) => {
      const n = mv.path.length || 1;
      const cx = mv.path.reduce((s, q) => s + q[0], 0) / n, cz = mv.path.reduce((s, q) => s + q[2], 0) / n;
      const dx = ox(cx), dz = oz(cz);
      return { ...mv, path: mv.path.map((q) => [q[0] + dx, q[1], q[2] + dz] as [number, number, number]) };
    }) } : {}),
  };
}

/** Olanak/avlu şablonlarını yuvalara dağıtır (belirlenimci): zorunlu olanaklar dönüşümle, artan yuvalar önce kullanılmamış
 *  olanaklar; her seçimde komşu kısıtları (aynı şablon yan yana değil, uyku ↔ gürültü değil). */
function assignTemplates(bays: BayPlan[], kit: PlanKit, SC: number, R: number) {
  const grid: (BayPlan | null)[][] = Array.from({ length: R }, () => Array<BayPlan | null>(SC).fill(null));
  for (const b of bays) grid[b.at[1]][b.at[0]] = b;
  const label = (t: number) => (t === -1 ? kit.yard.label : t === -2 ? kit.coast!.label : t === HOTEL_TPL ? kit.hotel!.label : t === OFFICE_TPL ? "dist_office" : kit.amenities[t].label);
  const role = (t: number) => districtRole(t === -1 ? "yard" : "amenity", label(t));
  /** komşu kısıt ihlali puanı: uyku ↔ gürültü 2, aynı şablon 1 (0 = uygun) */
  const cost = (b: BayPlan, t: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].reduce((sum, [dc, dr]) => {
    const q = grid[b.at[1] + dr]?.[b.at[0] + dc];
    if (!q || q.tpl === undefined || q.kind === "team" || q.kind === "guest") return sum;
    return sum + (q.tpl === t ? 1 : 0) + (rolesCompatible(role(t), role(q.tpl)) ? 0 : 2);
  }, 0);
  const ok = (b: BayPlan, t: number) => cost(b, t) === 0;
  /** uygun aday yoksa en az ihlalli (eşitlikte ilk) */
  const least = (b: BayPlan, cands: number[]) => cands.reduce((best, t) => (cost(b, t) < cost(b, best) ? t : best), cands[0]);
  const A = kit.amenities.length;
  const used = new Set<number>();
  const count = new Map<number, number>();
  // zorunlu olanaklar: dönüşüm sırası (variant) korunur; kısıt tutmazsa sıradaki
  for (const b of bays) if (b.kind === "amenity" && b.tpl !== HOTEL_TPL && b.tpl !== OFFICE_TPL) {
    // en az kullanılan şablon önce (eşitlikte dönüşüm sırası): aynı olanak dünyada üst üste yığılmasın
    const cands = Array.from({ length: A }, (_, s) => (b.variant + s) % A).sort((p, q) => (count.get(p) ?? 0) - (count.get(q) ?? 0));
    const pick = cands.find((t) => ok(b, t)) ?? least(b, cands);
    b.tpl = pick; used.add(pick); count.set(pick, (count.get(pick) ?? 0) + 1);
  }
  // artan yuvalar: kullanılmamış olanaklar → avlu → olanak dönüşümü → (son çare) avlu
  let rot = 0;
  for (const b of bays) if (b.kind === "yard" && b.tpl === undefined) {
    const fresh = Array.from({ length: A }, (_, k) => k).filter((k) => !used.has(k));
    const cands = [...fresh, -1, ...Array.from({ length: A }, (_, k) => (rot + k) % A).sort((p, q) => (count.get(p) ?? 0) - (count.get(q) ?? 0))];
    const t = cands.find((c) => ok(b, c)) ?? least(b, cands);
    if (t === -1) { b.tpl = -1; continue; }
    b.tpl = t; b.kind = "amenity"; used.add(t); rot = t + 1; count.set(t, (count.get(t) ?? 0) + 1);
  }
  // onarım: hâlâ ihlalli bir yuva varsa başka bir olanakla şablon takası (ikisi de uygun olursa)
  const am = bays.filter((b) => (b.kind === "amenity" && b.tpl !== HOTEL_TPL && b.tpl !== OFFICE_TPL) || (b.kind === "yard" && b.tpl === -1));
  for (const b of am) {
    if (ok(b, b.tpl!)) continue;
    for (const c of am) {
      if (c === b || c.tpl === b.tpl || (b.kind !== c.kind)) continue;
      [b.tpl, c.tpl] = [c.tpl, b.tpl];
      if (ok(b, b.tpl!) && ok(c, c.tpl!)) break;
      [b.tpl, c.tpl] = [c.tpl, b.tpl];
    }
  }
}

// ------------------------------------------------------------------ kurulum
function plankTile(b: Builder, i: number, j: number, [c1, c2, post, drop]: readonly [string, string, string, number]) {
  for (const o of [-0.33, 0, 0.33]) b.box(tx(i), -0.03, tz(j) + o, 0.96, 0.1, 0.28, (i + j) % 2 ? c1 : c2, "solid", 0.05);
  if ((i + j) % 2 === 0) b.box(tx(i) - 0.42, -0.08 - drop / 2, tz(j) - 0.42, 0.12, drop, 0.12, post);
}

function makeBay(b: Builder, plan: BayPlan, i0: number, j0: number, row0: boolean, th: Theme, keep?: Bay["keep"]): Bay {
  return {
    b, i0, j0, row0, kind: plan.kind, pods: plan.pods, variant: plan.variant,
    // GROWTH: şehir temalarında ekip alanı ekip rengine boyanmaz (tente, halı, çerçeve şehrin paletinden; `teamTint`);
    // ekip rengi yalnız tabela levhasında (`teamColor`) ve arayüz etiketinde kalır
    color: plan.kind === "team" && th.teamTint ? th.teamTint(plan.team ?? "", plan.variant) : plan.color ?? th.trim,
    teamColor: plan.color ?? th.trim, team: plan.team ?? null,
    I: (li) => i0 + li, J: (lj) => j0 + lj,
    sign: [tx(i0 + 6), 2.75, tz(j0 + 1) + 0.6],
    ...(keep ? { keep } : {}),
  };
}

/** Zemin: yol (lj 0 / li 0), ekip çerçevesi, bölge zemini. `floor` boş dize döndürürse o karoya zemin çizilmez (su: göl,
 *  havuz, tekne kanalı — bölge kendi su bloğunu koyar). */
function paint(th: Theme, x: Bay, floor: (li: number, lj: number) => string, trim: boolean, street?: (li: number, lj: number) => boolean) {
  const { b } = x;
  if (th.deck) {
    const wet = (li: number, lj: number) => li > 0 && lj > 0 && floor(li, lj) === "";
    for (let li = 0; li < BAY; li++) for (let lj = 0; lj < D; lj++) {
      if (!wet(li, lj)) { plankTile(b, x.I(li), x.J(lj), th.deck); continue; }
      if (!th.marina) continue;
      // S41: marina suyu — yürünmez; seyrek köpük şeritleri (dalga grubu, hareket azaltmada durağan)
      b.block(x.I(li), x.J(lj));
      if ((li * 5 + lj * 3 + x.i0) % 7 === 0) b.box(tx(x.I(li)) + 0.15, th.marina.surface + 0.03, tz(x.J(lj)), 0.55, 0.04, 0.16, "#F0F9FF", "wave");
    }
    // marina su yüzeyi: satır başına birleşik kutular (iskele boyunda; okyanus düzlemi derinde kalsa bile)
    if (th.marina) for (let lj = 1; lj < D; lj++) for (let li = 1; li < BAY;) {
      if (!wet(li, lj)) { li++; continue; }
      let e = li; while (e + 1 < BAY && wet(e + 1, lj)) e++;
      b.box((tx(x.I(li)) + tx(x.I(e))) / 2, th.marina.surface - 0.3, tz(x.J(lj)), e - li + 1, 0.6, 1, th.marina.water, "water", 0);
      li = e + 1;
    }
    if (trim && !th.marina) {
      // ekip rengi çerçeve: tahtaların üstünde ince şerit
      const y = 0.03, c = x.color;
      b.box((tx(x.I(2)) + tx(x.I(11))) / 2, y, tz(x.J(2)), 10, 0.03, 0.3, c);
      b.box((tx(x.I(2)) + tx(x.I(11))) / 2, y, tz(x.J(14)), 10, 0.03, 0.3, c);
      b.box(tx(x.I(2)), y, (tz(x.J(2)) + tz(x.J(14))) / 2, 0.3, 0.03, 13, c);
      b.box(tx(x.I(11)), y, (tz(x.J(2)) + tz(x.J(14))) / 2, 0.3, 0.03, 13, c);
    }
    return;
  }
  for (let li = 0; li < BAY; li++) for (let lj = 0; lj < D; lj++) {
    const ring = trim && li >= 2 && lj >= 2 && lj <= 14 && (li === 2 || li === 11 || lj === 2 || lj === 14);
    // S41: çalışma bölgesinde koridorlar patika/halı yolu (düz boş alan değil, amaçlı yürüyüş yolu)
    // (olanak/avluda da: zemini su "" olmayan koridor karoları)
    const f = floor(li, lj);
    const aisle = th.aisle && f !== "" && li >= 2 && lj >= 2 && lj <= 14 && (lj === 7 || lj === 12 || li === 6);
    const c = (li === 0 || lj === 0) && (!street || street(li, lj)) ? th.path(li, lj) : ring ? th.curb ?? x.color : aisle ? th.aisle!(li, lj) : f;
    if (c) b.cube(x.I(li), x.J(lj), -1, c, 1, "solid", ring ? 0.02 : 0.05);
  }
  slab(b, x.i0, x.j0, BAY, D, th.under);
}

/** S41 — çalışma bölgesinin ön şeridindeki uyku karoları (yerel): ön kenar li 2–4 / 8–10 (lj 15) + ekip köşesi li 7–9 (lj 13).
 *  S45 (SLEEP-BODY-001): ekip köşesi üçlüsü lj 14'ten 13'e — yatan ajan ~1,5 karo; (8,14)/(9,14) yatakları ön sıradaki
 *  (8,15)/(9,15) ile baş-ayak çakışıyordu. Aradaki lj 14 boş kalır (ön kapılara yürüyüş). */
export const SLEEP_ROW: readonly [number, number][] = [[2, 15], [3, 15], [4, 15], [8, 15], [9, 15], [10, 15], [7, 13], [8, 13], [9, 13]];

/** Çalışma bölgesi: zemin + tema sınırı/köşesi + pod'lar (istasyonlar) + boş yuvalar + ön şeritte uyku yerleri. */
function workBay(th: Theme, x: Bay, seatNo: { n: number }) {
  paint(th, x, th.floor, true);
  th.work(x);
  const { b } = x;
  POD_SLOTS.forEach(([pi, pj], s) => {
    if (s >= x.pods) { th.spare(x, pi, pj, s); return; }
    th.pod?.(x, pi, pj);
    for (const row of [0, 1]) for (const col of [0, 2]) {
      const i = x.I(pi + col), j = x.J(pj + 1 + row);
      th.seat(b, i, j, row ? "-z" : "+z", seatNo.n++, x);
      // S41: duruş/cihaz ipucu; `faceOut` temalarında (bank, şezlong) ajan pod'un dışına bakar, sırtı ortadaki tabloya
      const out = !!th.faceOut;
      b.station(i, row ? j + 1 : j - 1, row ? (out ? UP : DOWN) : out ? DOWN : UP, th.pose, th.device, th.seatY);
    }
  });
  if (!th.sleeper) return;
  if (!sacredQuiet) { SLEEP_ROW.forEach(([li, lj], k) => { if (!b.blocked.has(key(x.I(li), x.J(lj)))) th.sleeper!(b, x.I(li), x.J(lj), k, x); }); return; }
  // CITY-B: tabanın sacred tamponu bu bölgeye taşıyorsa (kenara değen simge alanı) tampondaki uyku karoları yerine ekip köşesindeki
  // yedek karolar kullanılır → bölge uyku kapasitesini korur (SLEEP-CAP-001), tamponda çapa olmaz (SACRED-ANCHOR-001).
  const quiet = sacredQuiet;
  const fits = (li: number, lj: number) => !b.blocked.has(key(x.I(li), x.J(lj))) && !quiet([x.I(li), x.J(lj)]);
  const row = SLEEP_ROW.map(([li, lj], k) => [li, lj, k] as const).filter(([li, lj]) => fits(li, lj));
  const lost = SLEEP_ROW.filter(([li, lj]) => !b.blocked.has(key(x.I(li), x.J(lj)))).length - row.length;
  const taken = new Set(row.map(([li]) => li));
  const alt: (readonly [number, number, number])[] = [];
  for (const [li, lj] of SLEEP_ALT) {
    if (alt.length >= lost) break;
    // yatan ajan ~1,5 karo (z boyunca): aynı sütunda lj 13 ve 14 birlikte kullanılmaz (SLEEP-BODY-001)
    if (taken.has(li) && row.some(([ri, rj]) => ri === li && Math.abs(rj - lj) < 2)) continue;
    if (!fits(li, lj) || alt.some(([ai]) => ai === li)) continue;
    alt.push([li, lj, SLEEP_ROW.length + alt.length]);
  }
  for (const [li, lj, k] of [...row, ...alt]) th.sleeper(b, x.I(li), x.J(lj), k, x);
}

/** CITY-B — tampona düşen ön şerit uyku karolarının yedekleri (yerel; ekip köşesi `teamCorner` terminal (2,13), kabuk (3,13),
 *  dinlenme (4,14), bayrak (10,14) ile çakışmaz; koridor li 6/11 açık kalır; istasyonlar en çok lj 11'de → bitişik değil). */
const SLEEP_ALT: readonly [number, number][] = [[4, 13], [5, 13], [10, 13], [2, 14], [3, 14], [5, 14]];
/** buildDistricts süresince: tabanın sacred tamponu (çapa payı) — yalnız çekirdekli dünyada sacred bölge varsa */
let sacredQuiet: ((t: Tile) => boolean) | null = null;

/** S46 — S48 eğlence kancaları: bölgede suya bakan yürünebilir kıyı/iskele karolarına en çok iki
 * `fish` kancası (r = bakış yönü dizini) ve uyku dışı olanak/avlularda (dama düzeninde) bir masa tenisi masası (`play`):
 * koridor (li 6, lj 2/7/12) ve çapa karolarından uzak, üç karoluk boş sırada ortadaki karo masa olur (engelli), iki uç oyuncu.*/
/** W2b-INT — temalı şehir ve premium sahneler: olanak/avlu oyun masası masa tenisi değil sessiz masa oyunu (PLAY_BOARD). */
const BOARD_THEMES = new Set(["istanbul", "kapadokya", "londra", ...FULL_BOARD_THEMES,
  ...NEW_CITIES.filter((m) => m.board !== false).map((m) => m.catalog.id)]);

function funHooks(x: Bay, blk0: number, table: boolean, board = false) {
  const { b, I, J } = x;
  const anchors = new Set<string>();
  const mark = (t: readonly number[]) => { if (t[0] >= x.i0 && t[0] < x.i0 + BAY && t[1] >= x.j0 && t[1] < x.j0 + D) anchors.add(key(t[0], t[1])); };
  for (const st of b.stations) mark(st.tile);
  for (const t of b.rest) mark(t);
  for (const l of Object.values(b.spots)) for (const st of l ?? []) mark(st.tile);
  for (const pr of b.props) if (pr.tile) mark(pr.tile);
  // açık su: su bloğu örten, üstünde tekne/iskele (yürünebilir yüzey bandında katı blok) olmayan karolar (rules/facts.ts ile aynı ölçüt)
  const water = new Set<string>(), solid = new Set<string>();
  for (let k = blk0; k < b.blocks.length; k++) {
    const q = b.blocks[k], top = q.p[1] + q.s[1] / 2;
    const isWater = q.g === "water" && top <= 0.35, isDeck = q.g === "solid" && top >= -0.35 && top <= 0.75 && q.s[0] * q.s[2] >= 0.25;
    if (!isWater && !isDeck) continue;
    for (let i = Math.ceil(q.p[0] - q.s[0] / 2 - tx(0) - 1e-6); i <= Math.floor(q.p[0] + q.s[0] / 2 - tx(0) + 1e-6); i++)
      for (let j = Math.ceil(q.p[2] - q.s[2] / 2 - tz(0) - 1e-6); j <= Math.floor(q.p[2] + q.s[2] / 2 - tz(0) + 1e-6); j++) (isWater ? water : solid).add(key(i, j));
  }
  for (const t of solid) water.delete(t);
  const free = (i: number, j: number) => !b.blocked.has(key(i, j)) && !anchors.has(key(i, j)) && !water.has(key(i, j));
  const DIRS: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  const fish = b.ambient.filter((h) => h.kind === "fish" && h.tile[0] >= x.i0 && h.tile[0] < x.i0 + BAY && h.tile[1] >= x.j0 && h.tile[1] < x.j0 + D);
  for (let lj = 1; lj < D && fish.length < 2; lj++) for (let li = 0; li < BAY && fish.length < 2; li++) {
    const i = I(li), j = J(lj);
    if (!free(i, j) || fish.some((h) => Math.abs(h.tile[0] - i) + Math.abs(h.tile[1] - j) < 5)) continue;
    const d = DIRS.findIndex(([dx, dz]) => water.has(key(i + dx, j + dz)));
    if (d < 0) continue;
    b.hook("fish", i, j, d);
    fish.push(b.ambient[b.ambient.length - 1]);
  }
  if (!table) return;
  for (const [li, lj] of [[4, 10], [8, 10], [4, 5], [8, 5], [3, 13], [9, 13], [4, 14], [8, 14], [3, 9], [9, 9]] as [number, number][]) {
    const i = I(li), j = J(lj);
    if (![[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]].every(([a, c]) => free(i + a, j + c))) continue;
    // masa tenisi masası (x boyunca): yeşil üst, beyaz orta çizgi, file, dört ayak
    const cx = tx(i), cz = tz(j);
    if (board) {
      // W2b-INT: alçak masa + oyun tahtası (iki renkli kareler) + iki tabure (x boyunca; engellemez)
      b.box(cx, 0.6, cz, 0.8, 0.05, 0.7, "#8B5A2B", "solid", 0.02);
      b.box(cx, 0.3, cz, 0.08, 0.6, 0.08, "#3A3F47");
      b.box(cx, 0.64, cz, 0.5, 0.03, 0.5, "#E9E1D0");
      for (const [qx, qz] of [[-0.125, -0.125], [0.125, 0.125]]) b.box(cx + qx, 0.66, cz + qz, 0.25, 0.012, 0.25, "#3F3A33");
      // CORE-WALK (REAL-SEAT): tabureler yere basar (orta ayak + taban); oturak üstü 0,385 (Crowd BOARD_STOOL_Y ≈ 0,4)
      for (const dx of [-1, 1]) stool(b.box.bind(b), tx(i + dx), cz, 0.385, 0.36, "#3F7D6E");
      b.block(i, j);
      b.hook("play", i, j, PLAY_BOARD);
      return;
    }
    b.box(cx, 0.7, cz, 1.5, 0.06, 0.82, "#15803D", "solid", 0.02);
    b.box(cx, 0.735, cz, 1.5, 0.012, 0.04, "#F8FAFC");
    b.box(cx, 0.82, cz, 0.03, 0.16, 0.9, "#E5E7EB", "glass");
    for (const dx of [-0.6, 0.6]) for (const dz of [-0.32, 0.32]) b.box(cx + dx, 0.34, cz + dz, 0.06, 0.68, 0.06, "#374151");
    b.block(i, j);
    b.hook("play", i, j);
    return;
  }
}

/** CITY-BIG — ufuktaki deniz kutuları (taban bandı + kıyı yuvalarının şeritleri) x boyunca uç uca değiyorsa tek kutuda birleşir:
 *  yarı saydam su kutularının birbirine değen yan yüzleri ufukta ince dikey dikiş çizgisi bırakıyordu. Yalnız aynı y/z/yükseklik/
 *  derinlik/renkli "water" kutuları; sıra korunur (birleşen ilk kutunun yerinde). Su ufku olmayan dünyada dizi aynen döner. */
function mergeWater(bd: Built["backdrop"] & object): NonNullable<Built["backdrop"]> {
  const out: NonNullable<Built["backdrop"]> = [];
  const runs = new Map<string, number[]>();
  for (const q of bd) {
    if (q.g !== "water") { out.push(q); continue; }
    const k = `${q.p[1]}|${q.p[2]}|${q.s[1]}|${q.s[2]}|${q.c}`;
    (runs.get(k) ?? runs.set(k, []).get(k)!).push(out.length);
    out.push(q);
  }
  const drop = new Set<number>();
  for (const idx of runs.values()) {
    if (idx.length < 2) continue;
    const xs = idx.map((k) => ({ k, a: out[k].p[0] - out[k].s[0] / 2, b: out[k].p[0] + out[k].s[0] / 2 })).sort((u, v) => u.a - v.a);
    let cur = xs[0];
    const flush = () => { const q = out[cur.k]; out[cur.k] = { ...q, p: [(cur.a + cur.b) / 2, q.p[1], q.p[2]], s: [cur.b - cur.a, q.s[1], q.s[2]] }; };
    for (const nx of xs.slice(1)) {
      if (nx.a <= cur.b + 1e-3) { cur = { k: cur.k, a: cur.a, b: Math.max(cur.b, nx.b) }; drop.add(nx.k); continue; }
      flush(); cur = nx;
    }
    flush();
  }
  return drop.size ? out.filter((_, k) => !drop.has(k)) : out;
}

/** Taban sahne + plan → büyümüş dünya. Taban hiç kaydırılmaz (tx/tz ve karo dizinleri aynı kalır). */
export function buildDistricts(base0: Built, themeId: string, plan: DistrictPlan): Built {
  const th = theme(themeId);
  const b = new Builder(97 + plan.bays.length);
  // RING-INT: halka düzeninde taban dünyanın ortasına ötelenir (yoksa yerinde; di = dj = 0)
  const di = plan.core ? plan.core[0] * BAY : 0, dj = plan.core ? plan.core[1] * D : 0;
  const base = plan.core ? shiftBase(base0, di, dj, plan.width, plan.depth) : base0;
  const baseN = base.stations.length;
  const modules: ModuleCell[] = [{ ...base.modules[0], kind: "hq", label: th.hq, sign: [tx(base0.width / 2 + di), 3.2, tz(dj) + 1] }];
  const seats = { teams: {} as Record<string, number[]>, guests: Array.from({ length: baseN }, (_, k) => k) };
  const seatNo = { n: 0 };
  // halka düzeninde taban dikdörtgeni (temalar taşan parçaları çekirdekten uzak tutar; Bay.keep)
  const keep = plan.core ? { i0: di, j0: dj, w: base0.width, d: base0.depth } : undefined;
  const put = (p: BayPlan, i0: number, j0: number) => {
    const x = makeBay(b, p, i0, j0, j0 === 0, th, keep);
    const blk0 = b.blocks.length;
    const from = baseN + b.stations.length;
    let label: string | undefined;
    if (p.kind === "team" || p.kind === "guest") { workBay(th, x, seatNo); label = p.kind === "guest" ? "dist_cowork" : undefined; }
    else {
      const t = p.tpl ?? (p.kind === "amenity" ? p.variant % th.amenities.length : -1);
      const am = t === OFFICE_TPL && p.office ? officeAmenity(themeId, p.office) : t === HOTEL_TPL && th.hotel ? th.hotel : t === -2 && th.coast ? th.coast : t >= 0 ? th.amenities[t % th.amenities.length] : th.yard;
      paint(th, x, am.floor ?? th.floor, false, am.street);
      am.build(x);
      label = am.label;
    }
    if (x.row0) th.row0?.(x);
    funHooks(x, blk0, (p.kind === "amenity" || p.kind === "yard") && p.tpl !== OFFICE_TPL ? districtRole(p.kind, label) !== "sleep" && !th.deck && (p.at[0] + p.at[1]) % 2 === 0 : false,
      BOARD_THEMES.has(themeId));
    const to = baseN + b.stations.length;
    const list = p.kind === "team" ? (seats.teams[p.team!] ??= []) : p.kind === "guest" ? seats.guests : null;
    if (list) for (let k = from; k < to; k++) list.push(k);
    modules.push({ i0, j0, w: BAY, d: D, base: false, slots: [from, to], kind: p.kind, team: p.team, color: p.color, label, sign: x.sign, ...(x.venue ? { venue: x.venue } : {}) });
  };
  sacredQuiet = plan.core && base.zones?.some((z) => z.kind === "sacred") ? (t: Tile) => isInSacredBuffer(t, base, "anchor") : null;
  try { for (const p of plan.bays) put(p, p.at[0] * BAY, p.at[1] * D); } finally { sacredQuiet = null; }
  // RING-INT: halka düzeninde bölgeler tabanın dört kenarına değer → tabanın sacred bölgesinin tamponu/eğlence payı komşu bölgeye
  // taşabilir. Orada bölgenin uyku/dinlenme/araç noktası, kahve işareti ve ortam kancası, eğlence payında oyun/olta kancası
  // kurulmaz (masa dekor olarak kalır). Köşe düzeninde (çekirdeksiz) hiçbir şey değişmez.
  if (plan.core && base.zones?.some((z) => z.kind === "sacred")) {
    const anchorQuiet = (t: Tile) => isInSacredBuffer(t, base, "anchor");
    for (const k of Object.keys(b.spots) as SpotKind[]) b.spots[k] = b.spots[k]!.filter((s) => !anchorQuiet(s.tile));
    b.rest = b.rest.filter((t) => !anchorQuiet(t));
    b.props = b.props.filter((q) => !(q.k === "coffee" && q.tile && anchorQuiet(q.tile)));
    b.ambient = b.ambient.filter((h) => !((h.kind === "play" || h.kind === "fish") ? isInSacredBuffer(h.tile, base) : anchorQuiet(h.tile)));
  }

  const blocked = new Set(base.blocked);
  if (th.gangway) {
    const { col, rows: [from, to] } = th.gangway;
    for (let j = from + dj; j <= to + dj; j++) { blocked.delete(key(col + di, j)); plankTile(b, col + di, j, th.deck ?? ["#A0805A", "#94744F", "#6B4F35", 1.2]); }
  }
  for (const k of b.blocked) blocked.add(k);
  // CORE-WALK (REAL-SEAT): bölge istasyonları da altındaki gerçek oturağa oturur (Builder.done ile aynı kural)
  resolveStationSeats(b.blocks, b.stations, tx, tz);
  const spots: Partial<Record<SpotKind, Station[]>> = {};
  for (const src of [base.spots, b.spots]) for (const [k, list] of Object.entries(src) as [SpotKind, Station[] | undefined][]) {
    if (list?.length) (spots[k] ??= []).push(...list);
  }
  return {
    ambient: [...(base.ambient ?? []), ...b.ambient],
    blocks: [...base.blocks, ...b.blocks], blocked, stations: [...base.stations, ...b.stations], rest: [...base.rest, ...b.rest as Tile[]],
    ...(base.keepOut ? { keepOut: base.keepOut } : {}),
    props: [...(base.props ?? []), ...b.props], lights: [...base.lights, ...b.lights], spots,
    width: plan.width, depth: plan.depth, modules, seats,
    // SP-W0: tabanın sacred bölgeleri, ufuk silüeti ve hareketli set parçaları (+ temanın eklediği hareketliler) korunur
    ...(base.zones?.length || b.zones.length ? { zones: [...(base.zones ?? []), ...b.zones] } : {}),
    // CITY-B: tema da ufuk bloğu ekleyebilir (<city> kıyı yuvası: arkasındaki açık deniz şeridi → kıyı halkasında deniz her genişlikte kesintisiz)
    ...(base.backdrop?.length || b.backdrop.length ? { backdrop: mergeWater([...(base.backdrop ?? []), ...b.backdrop]) } : {}),
    ...(base.movers?.length || b.movers.length ? { movers: [...(base.movers ?? []), ...b.movers] } : {}),
  };
}
