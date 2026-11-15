/**
 * WALK-EXPLORE — iç mekân örneği ("interior instance") üretimi: kapıdan girilen, dış modelden AYRI küçük voxel uzayı.
 *
 * Dış model oyulmaz (dış çizim ve perf değişmez); girişte bu modülün ürettiği kat (`InteriorLevel.built`) sahnenin `built`'inin
 * yerine geçer (World.tsx), çıkışta dış dünya geri gelir. Açık hava katları (seyir galerisi, platform, çatı, iskele) dış taban
 * dünyasını aşağıda "panorama" olarak gösterir (`withPanorama`).
 *
 * INTERIOR-VIEW (gerçekçi iç mekân + yürünebilir merdiven):
 *  - **Üst üste katlar.** Bir yerin bütün katları aynı ayak izini (w × d karo, aynı dünya x/z) paylaşır; her kat kendi sahnesidir
 *    (zemin y = 0). Katlar arasında **merdiven hacmi** vardır: alt katta `stairUp` basamakları gerçek, tırmanılabilir kolonlardır
 *    (her basamak bir karo, yükseliş = kat yüksekliği / basamak sayısı ≤ STEP_H 0,35; physics/height.ts basamak kuralı) ve son
 *    basamak üst katın zeminine (`storey`) varır. Üst katta aynı karolarda merdiven boşluğu (`stairHole`: zemin yok, inen basamaklar
 *    görünür, korkuluk) vardır. Avatar son basamağa çıkınca (ya da üst katta boşluğun ağzına adım atınca) sahne aynı x/z'de,
 *    y ± kat yüksekliği kaydırılarak öteki kata geçer (`StairLink`; kararma ve ışınlama yok, kamera aynı kayma ile sürer).
 *  - **Gerçek oran** (yürüme ölçeği insan boyu 1): kat yüksekliği `STOREY` 1,6, kapı 1,2, korkuluk 0,55, tezgâh 0,55, masa 0,45;
 *    salonlar (müze, art deco lobi) daha yüksek. Kalın taş duvarlar iki karo (`drawWalls(h, 2)`).
 *  - **Mimari tipoloji** (biçim gerçeğe yakın, eşya genel): Galata — yuvarlak taş kule, kalın duvar, ortada asansör çekirdeği,
 *    duvar boyunca dönen merdiven, küçük kemerli pencereler, tepede dış seyir galerisi halkası ve konik çatı; kafes kuleler
 *    (tam sürüm, full/generate.ts) — dört ayak, çapraz kafes kirişler, asansör holü, ortası boş platform, zirve; saat kulesi — saat mekanizması
 *    odası ve açık kemerli çan katı; müze sarayı — yüksek tavanlı, tepe ışıklı uzun galeriler (enfilad); art deco gökdelen lobisi —
 *    bronz asansör sırası, basamaklı süsler, yangın merdiveni, seyir terası.
 *  - Telif/kültür: yazı, logo, bayrak, gerçek eser kopyası, dinî simge yok; tablolar soyut renk alanları. İbadet yeri iç mekânı
 *    kilitli kalır (catalog `review`).
 *
 * Belirlenimci: aynı (sahne, yer) → aynı katlar (`rng(sceneSeed("<sahne>:<yer>"))`). Saf modül (React/three yok);
 * `walk_check.mjs` WALK-INTERIOR kuralı katları ve merdiven erişimini doğrudan denetler.
 */
import { sceneSeed } from "../walk/controller";
import { rng, SCENES, tx, tz, type Block, type Built, type Group, type Light, type ModuleCell, type SceneDef, type Station, type Tile } from "../scenes";
import { kesifId, vpId, type SiteKind } from "./catalog";
import { fullCityRecipes, fullCourtRecipes, fullHotelLobbies, fullLattice, fullRecipeDefs, fullSceneTower, FULL_GALLERY_CITY, FULL_GALLERY_ORDER, FULL_MODERN_THEMES, FULL_TERRACE_ACCESS, type FullRecipeLib } from "../../full/generate";
import { baseWorld, clearPlaceCaches, scenePlaces, shift, topGrid, type DoorPlace } from "./placement";
import { interiorRecord, recordDef } from "./sceneModel";
import { cityPanoFor, ridgeRing, type CityPano } from "./cityPano";
import { sceneSurround } from "./scenePano"; // NONCITY-QA: şehir dışı açık hava katının çevresi

// ------------------------------------------------------------------------------------------ tipler
export type PortalKind = "exit";
export interface Portal {
  id: string;
  kind: PortalKind;
  /** basınca geçilen karo */
  tile: Tile;
  /** dış dünya */
  to: "out";
  /** bu kata BU portaldan gelinince inilen karo (portalın içeri komşusu) */
  arrive: Tile;
}
/**
 * INTERIOR-VIEW — merdiven bağı: bu kattaki tetik karosu ve öteki kattaki karşılığı. Alt katta (`up`) tetik son basamaktır
 * (engelli, tırmanılabilir, üstü = kat yüksekliği); üst katta (`down`) boşluğun ağzı (yürünebilir, sondan bir önceki basamak).
 */
export interface StairLink {
  id: string;
  dir: "up" | "down";
  /** hedef kat dizini */
  to: number;
  /** bu kattaki tetik karosu (avatar bu karoya girince kat değişir) */
  tile: Tile;
  /** geçişten hemen sonra hedef katta ayak y'si */
  y: number;
  /** dünya kayması (hedef kat y = bu kat y + dy): kamera ve çizim yüksekliği aynı kadar kayar */
  dy: number;
  /** bu katta merdivene yaklaşma karosu: up → ilk basamağın önü (ayak), down → üst sahanlık; kat seçici varışı */
  stand: Tile;
  /** merdiven karoları (alt kat sırası: ilk basamak → son basamak) ve yükseliş */
  run: Tile[];
  rise: number;
}
/**
 * asansör durağı (ürün sahibi 2026-10-31 "asansöre binilmiyor"): asansör kapısının önündeki yürünebilir karo (`tile`, F ile
 * binilir), kapının bulunduğu duvar/çekirdek karosu (`door`) ve yolculuğun hedefi: `to` katındaki karşılık gelen durağın önü
 * (`toTile`) ve çıkış yönü (`heading`: kapıdan dışarı). En alt duraklı kattan en üste, en üstten en alta; aradaki kattan en üste.
 * Kapısı olup karşı katında durağı olmayan asansör (tek katlı lobi) süs kalır, durak kurulmaz.
*/
export interface LiftStop { id: string; tile: Tile; door: Tile; to: number; toTile: Tile; heading: number }
export type SpotKind = "vp" | "k";
export interface LevelSpot { id: string; kind: SpotKind; tile: Tile; model?: KesifModel;
  /** HORIZON: keşif kaydı yazmayan seyir noktası (şehir haritası landmark iç mekânı; pasaport damgası haritada) — F dürbünle bakar */
  free?: true }
export interface LevelRoom { i0: number; j0: number; w: number; d: number; name: string }
export type KesifModel = "map" | "key" | "compass" | "gear" | "shell";
export const KESIF_MODELS: readonly KesifModel[] = ["map", "key", "compass", "gear", "shell"];

export interface InteriorLevel {
  key: string;
  scene: string;
  site: string;
  kind: SiteKind;
  index: number;
  count: number;
  /** kat adı anahtarı (locales/explore.ts `lvl_*` / `room_*`) */
  name: string;
  outdoor: boolean;
  /** sessiz bölge (ibadet yeri): emote / mini oyun / şaka kapalı */
  quiet: boolean;
  /** kat yüksekliği (zemin → üst katın zemini) */
  storey: number;
  /** panorama: dış taban bloklarının kayması (dünya birimi) ve kesim (yalnız açık hava) */
  pano: Panorama | null;
  /** WORLD-PANO: şehir landmarkı katının ucuz dış panoraması (cityPano.ts; pencereden/güverteden şehir silüeti) */
  cityPano?: CityPano | null;
  rooms: LevelRoom[];
  portals: Portal[];
  /** INTERIOR-VIEW: merdiven bağları (yukarı / aşağı) */
  stairs: StairLink[];
  /** binilebilir asansör durakları (yoksa boş)*/
  lifts: LiftStop[];
  spots: LevelSpot[];
  /** tezgâh karoları ve durağan figüranların dünya konumu (denetim)*/
  counters?: Tile[];
  /** GATEFIX3: [x, z, bakış yaw, oturuyor 0/1] — INTERIOR-STAFF-001 görevliyi (ayakta, tezgâha dönük) konuktan ayırır */
  people?: [number, number, number, number][];
  /** her figüranın kendi blokları (denetim: eşya figürün bedenine girmez)*/
  figs?: Block[][];
  /** yazarın varış ipucu — asansör/kapı varışında avatar tam bu karoya bırakılır, kamera bu yöne bakar (kule: asansör F menzilinde / seyir galerisinde manzaraya)*/
  arrive?: { tile: Tile; heading: number };
  /** sergi karosu (eşya; şehir landmarkı iç mekânında önünde F → simgenin bilgi kartı, walk/info/infoTargets.ts)*/
  exhibit?: Tile;
  /** keşif parçaları HARİÇ kat (walk_check ve çizim tabanı); parça blokları `itemBlocks` ile eklenir */
  built: Built;
  /** UX-AUDIT: kabuk (duvar) karoları — engelli ve eşya/su/merdiven değil (1); oda içi 0. Kesit kabuğu bunun dışını açar
   *  (walk/cover.ts `roomShape`); sarnıçta su ve sütunlar, merdiven ve boşluk odanın içindedir. Dizin j · eni + i. */
  shell?: Uint8Array;
}
export interface Panorama {
  /** taban dünya → kat: x/z kayması ve aşağı iniş (y) */
  dx: number;
  dz: number;
  drop: number;
  /** kesim dikdörtgeni (dış dünya koordinatı) ve kesim yüksekliği: içindeki, üstü `cutY`'yi aşan bloklar çizilmez */
  cut: { x0: number; x1: number; z0: number; z1: number; y: number } | null;
  /** iskele: deniz yüzeyi (kat koordinatı) */
  sea: number | null;
  /**
   * PANO-FOOT-001 (ürün sahibi 2026-10-31 "teras köprüyle iç içe"): kesim dikdörtgenine DEĞEN her yapı kırpılır (yalnız merkezi içeride ve
   * üstü kesimi aşan değil) — dikdörtgenin içinde kalan parçası çizilmez, dönen parça (dönme dolap) bütün düşer. İskele hariç.
*/
  clip?: true;
}
/** LOOKOUT-CAM-001: kule güvertesinin çevresinde komşusu döşemenin altında kalan halka (karo) ve güverte inişinin tavanı. */
export const DECK_CLEAR = 3;
const DECK_DROP_MAX = 24;
/** Taban zemini: üstü bunu aşmayan levha (yol, meydan, çim) zemin sayılır; ayak izi kırpması ve gövde ona dokunmaz. */
export const PANO_GROUND_TOP = 0.36;
/** Bloğun dönüşle süpürdüğü kutu dahil XZ/Y kapsamı [x0, x1, y0, y1, z0, z1] (dönme dolap kabini çember boyunca). */
export function sweptBox(b: Pick<Block, "p" | "s" | "r">): [number, number, number, number, number, number] {
  if (!b.r) return [b.p[0] - b.s[0] / 2, b.p[0] + b.s[0] / 2, b.p[1] - b.s[1] / 2, b.p[1] + b.s[1] / 2, b.p[2] - b.s[2] / 2, b.p[2] + b.s[2] / 2];
  const o = b.r.o, h = Math.hypot(b.s[0], b.s[1], b.s[2]) / 2, R = (u: number, v: number) => Math.hypot(u, v) + h;
  if (b.r.a === "y") { const r = R(b.p[0] - o[0], b.p[2] - o[2]); return [o[0] - r, o[0] + r, b.p[1] - h, b.p[1] + h, o[2] - r, o[2] + r]; }
  if (b.r.a === "z") { const r = R(b.p[0] - o[0], b.p[1] - o[1]); return [o[0] - r, o[0] + r, o[1] - r, o[1] + r, b.p[2] - h, b.p[2] + h]; }
  const r = R(b.p[1] - o[1], b.p[2] - o[2]); return [b.p[0] - h, b.p[0] + h, o[1] - r, o[1] + r, o[2] - r, o[2] + r];
}
export interface InteriorPlan { scene: string; site: string; kind: SiteKind; door: DoorPlace; levels: InteriorLevel[] }

// ------------------------------------------------------------------------------------------ ölçüler (yürüme ölçeği, insan = 1)
/** kat yüksekliği (insan boyunun ~1,6 katı; walk/scale.ts CITY_STOREY_H aralığı) */
export const STOREY = 1.6;
/**
 * (ürün sahibi 2026-10-31 "galata kulesi tavanlar çok alçak") — kule tipi simge katlarının (Galata, kafes kule, saat kulesi, Kız
 * Kulesi, kaya kalesi, stadyum) kat yüksekliği: göz hizasının (lookout.ts LOOK_EYE_Y 0,91) en az 2,6 katı (2,37) serbest yükseklik
 * (INTERIOR-CEILING-002). Merdiven kolları 8 karo (yükseliş 0,3 ≤ STEP_H).
*/
export const TOWER_H = 2.4;
/**
 * CEIL (ürün sahibi 2026-10-31 "oranlar abartı olmayacak, mantıklı ve gerçeğe uygun"): kule dışı iç mekân katlarının (ofis, kafe, AVM üst katı,
 * teras, köprü altı, atölye, yer altı şehri) varsayılan kat yüksekliği — kulelerle aynı ölçek (göz 0,91 × 2,6 ≈ 2,37). Merdiven kolları 8 karo.
*/
export const INDOOR_H = TOWER_H;
/** kapı yüksekliği (~1,2 × insan) */
export const DOOR_H = 1.2;
/** korkuluk yüksekliği */
export const RAIL_H = 0.55;
/**
 * (lead 2026-10-31: "korkuluk karenin %60'ını kaplıyor, şehir ince bir şerit"): seyir güvertelerinde (kule, kale, gökdelen,
 * stadyum) korkuluğun dolu kısmı göz hizasının (0,91) yarısının altında kalır (`DECK_SOLID` ≤ 0,45); üstünde güvenli yüksekliğe
 * (`DECK_SAFE`) kadar cam — birinci şahısta şehir ve su karenin çoğunu doldurur.
 * `DECK_SAFE` gerçek korkuluk yüksekliği (1,1–1,2 m; insan 1,75 m = 1,0) → 0,7, göz hizasının (0,91) altında: yatay bakış
 * camın üstünden geçer. Eskiden 1,1 (insan boyunun üstü, cam duvar): bütün manzara %40 saydam mavi camın arkasında soluk kalıyordu.
*/
export const DECK_SOLID = 0.4;
export const DECK_SAFE = 0.7;

// ------------------------------------------------------------------------------------------ kat kurucu
interface StairSpec { tiles: Tile[]; foot: Tile; storey: number; rise: number }

export class LevelBuilder {
  blocks: Block[] = [];
  blocked = new Set<string>();
  lights: Light[] = [];
  rooms: LevelRoom[] = [];
  portals: Portal[] = [];
  spots: LevelSpot[] = [];
  /** tezgâh karoları ve durağan figüran (görevli/konuk) dünya konumları — denetim "her tezgâhın görevlisi var" ve "kafe dolu" kuralı için*/
  counters: Tile[] = [];
  people: [number, number, number, number][] = [];
  /** figüran başına blok listesi (`figuran`)*/
  figs: Block[][] = [];
  /** bu kattan yukarı merdiven ve alttan gelen merdivenin boşluğu */
  up: StairSpec | null = null;
  hole: StairSpec | null = null;
  /** asansör kapıları (kapı karosu → önündeki yaklaşma karosu, +z); makePlan karşı katta kapı varsa durak kurar*/
  lifts: { door: Tile; tile: Tile }[] = [];
  /**
   * (ürün sahibi 2026-10-31 "kulelerde merdiven çıkış portalı yok; en alt kattan hedef kata asansör"): çok katlı kule/teras planında
   * merdiven çizilmez ve kat bağı kurulmaz; merdivenin yeri asansör kuyusunun adayıdır (`shaft`, makePlan katın kendi asansörü yoksa kurar).
*/
  liftOnly = false;
  shaft: { door: Tile; tile: Tile } | null = null;
  /** çizilmeyen yukarı merdivenin ölçüsü (üst kat tarifi `ctx.below` ile aynı karoları bilir)*/
  liftUp: StairSpec | null = null;
  /** COURTYARD-PORTAL: oturma yerleri (avlu sekileri; Yakındakiler "otur" — components/world/walk/entities.ts) */
  stations: Station[] = [];
  constructor(readonly w: number, readonly d: number, readonly r: () => number, public h = STOREY) {}
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: string, g: Group = "solid", j = 0.03) {
    this.blocks.push({ p: [x, y, z], s: [w, h, d], c, g, j });
  }
  block(i: number, j: number) { this.blocked.add(`${i},${j}`); }
  isBlocked(i: number, j: number) { return this.blocked.has(`${i},${j}`); }
  free(i: number, j: number) { return i >= 0 && j >= 0 && i < this.w && j < this.d && !this.blocked.has(`${i},${j}`); }
  floor(i0: number, j0: number, w: number, d: number, c1: string, c2: string) {
    for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++)
      this.box(tx(i), -0.5, tz(j), 1, 1, 1, (i + j) % 2 ? c1 : c2, "solid", 0.02);
  }
  floorTile(i: number, j: number, c: string) { this.box(tx(i), -0.5, tz(j), 1, 1, 1, c, "solid", 0.02); }
  /** Karolardaki zemin bloklarını kaldırır (merdiven boşluğu). */
  unfloor(tiles: readonly Tile[]) {
    const ks = new Set(tiles.map((t) => `${tx(t[0])},${tz(t[1])}`));
    this.blocks = this.blocks.filter((b) => !(b.p[1] === -0.5 && b.s[1] === 1 && ks.has(`${b.p[0]},${b.p[2]}`)));
  }
  /** Bütün ızgarayı duvarla doldurur (oda dışı); sonra odalar oyulur. */
  solidFill(c: string) {
    for (let i = 0; i < this.w; i++) for (let j = 0; j < this.d; j++) this.block(i, j);
    this.fillColor = c;
  }
  fillColor = "#6B5B4B";
  carve(i0: number, j0: number, w: number, d: number) {
    for (let i = i0; i < i0 + w; i++) for (let j = j0; j < j0 + d; j++) this.blocked.delete(`${i},${j}`);
  }
  carveTile(i: number, j: number) { this.blocked.delete(`${i},${j}`); }
  /**
   * Oyulmamış (engelli) ve oyulmuş bir karoya `thick` karo (Chebyshev) yakın karolara duvar çizer (içi boş kalan dolgu çizilmez).
   * Bütün duvarlar tam boy (`h`); kamerayla avatar arasındaki duvarı oda/salon kesiti saydamlaştırır (walk/cover.ts).
   */
  drawWalls(h = this.h, thick = 1, cap = "#D8CFC0") {
    const skip = new Set<string>(this.portals.map((p) => `${p.tile[0]},${p.tile[1]}`));
    // ARRIVAL-QA: çıkış kapısının üstü (lento → duvar tepesi) duvarla kapanır — eskiden kapı üstünden dışarısı kara boşluk görünüyordu.
    // Duvar karonun dış yarısında (kapı perdesi karo ortasında, içeriden önünde görünür kalır)
    for (const p of this.portals) if (h > DOOR_H + 0.25) {
      const ox = Math.sign(p.tile[0] - p.arrive[0]) * 0.275, oz = Math.sign(p.tile[1] - p.arrive[1]) * 0.275;
      const sx = ox ? 0.45 : 1, sz = oz ? 0.45 : 1;
      this.box(tx(p.tile[0]) + ox, (DOOR_H + 0.1 + h) / 2, tz(p.tile[1]) + oz, sx, h - DOOR_H - 0.1, sz, this.fillColor, "solid", 0.04);
      this.box(tx(p.tile[0]) + ox, h + 0.03, tz(p.tile[1]) + oz, sx, 0.06, sz, cap, "solid", 0.02);
    }
    for (let i = 0; i < this.w; i++) for (let j = 0; j < this.d; j++) {
      if (!this.blocked.has(`${i},${j}`) || skip.has(`${i},${j}`) || this.decor.has(`${i},${j}`)) continue;
      let edge = false;
      for (let di = -thick; di <= thick && !edge; di++) for (let dj = -thick; dj <= thick; dj++) {
        const ni = i + di, nj = j + dj;
        if (ni >= 0 && nj >= 0 && ni < this.w && nj < this.d && !this.blocked.has(`${ni},${nj}`)) { edge = true; break; }
      }
      if (!edge) continue;
      // WORLD-PANO: pencerenin arkasındaki duvar karoları (şehir iç mekânı) gerçek açıklıkla çizilir → dış silüet halkası görünür
      const o = this.openingAt(i, j, thick);
      if (o) this.wallWithOpening(i, j, h, o);
      else this.box(tx(i), h / 2, tz(j), 1, h, 1, this.fillColor, "solid", 0.04);
      this.box(tx(i), h + 0.03, tz(j), 1.0, 0.06, 1.0, cap, "solid", 0.02);
    }
  }
  /**
   * WORLD-PANO: duvar açıklıkları (yalnız `seeThrough` kurucuda; şehir landmarkı iç mekânı). (i, j) iç yüzü odaya (fx, fz)
   * bakan duvar karosu; açıklık duvar kalınlığı boyunca dışa (−fx, −fz) uzanır. Karo engelli kalır (gezinme, örtü değişmez).
   */
  seeThrough = false;
  openings: { i: number; j: number; fx: number; fz: number; y0: number; y1: number; w: number }[] = [];
  opening(i: number, j: number, fx: number, fz: number, y0: number, y1: number, w: number) {
    if (this.seeThrough) this.openings.push({ i, j, fx, fz, y0, y1, w });
  }
  private openingAt(i: number, j: number, thick: number) {
    for (const o of this.openings) for (let k = 0; k <= thick + 1; k++) if (o.i - k * o.fx === i && o.j - k * o.fz === j) return o;
    return null;
  }
  private wallWithOpening(i: number, j: number, h: number, o: { fx: number; y0: number; y1: number; w: number }) {
    const X = tx(i), Z = tz(j), c = this.fillColor, sw = (1 - o.w) / 2, ym = (o.y0 + o.y1) / 2, hm = o.y1 - o.y0;
    this.box(X, o.y0 / 2, Z, 1, o.y0, 1, c, "solid", 0.04);
    this.box(X, (o.y1 + h) / 2, Z, 1, h - o.y1, 1, c, "solid", 0.04);
    const off = o.w / 2 + sw / 2;
    if (o.fx === 0) { this.box(X - off, ym, Z, sw, hm, 1, c, "solid", 0.04); this.box(X + off, ym, Z, sw, hm, 1, c, "solid", 0.04); }
    else { this.box(X, ym, Z - off, 1, hm, sw, c, "solid", 0.04); this.box(X, ym, Z + off, 1, hm, sw, c, "solid", 0.04); }
  }
  /** mobilya karoları: engelli ama duvar çizilmez */
  decor = new Set<string>();
  furn(i: number, j: number) { this.block(i, j); this.decor.add(`${i},${j}`); }
  light(i: number, j: number, color = "#FFD9A0", intensity = 1.6, y = this.h - 0.2, distance = 9) {
    if (this.lights.length >= 3) return;
    this.lights.push({ pos: [tx(i), y, tz(j)], color, intensity, distance });
  }
  room(i0: number, j0: number, w: number, d: number, name: string) { this.rooms.push({ i0, j0, w, d, name }); }
  build(): Built {
    const modules: ModuleCell[] = this.rooms.map((r) => ({ i0: r.i0, j0: r.j0, w: r.w, d: r.d, base: false, slots: [0, 0], kind: "amenity", label: r.name }));
    if (!modules.length) modules.push({ i0: 0, j0: 0, w: this.w, d: this.d, base: false, slots: [0, 0], kind: "amenity" });
    return { blocks: this.blocks, blocked: this.blocked, stations: this.stations, rest: [], lights: this.lights, spots: {}, props: [], ambient: [],
      width: this.w, depth: this.d, modules, zones: [] };
  }
}

// ------------------------------------------------------------------------------------------ merdiven
/**
 * Alt kat: `tiles` boyunca yükselen basamaklar (her biri karo kadar katı kolon; üst = (k + 1) · yükseliş; son basamak = `storey`,
 * üst katın zemini). Karolar engelli ama tırmanılabilir (physics/height.ts): avatar basamak kuralıyla kendiliğinden çıkar.
 * `foot`: ilk basamağın önündeki yürünebilir karo. Basamakların üstünde lamba ya da tavan olmamalı (baş payı).
 */
export function stairUp(b: LevelBuilder, tiles: Tile[], foot: Tile, storey = b.h, c: [string, string] = ["#8E7A63", "#7F6C56"]): StairSpec {
  const rise = storey / tiles.length;
  // asansörlü planda basamak yok — ilk basamağın yeri kuyu, ayak karosu kapının önü (üst katın karşılığı aynı karoda)
  if (b.liftOnly) { b.shaft ??= { door: tiles[0], tile: foot }; return (b.liftUp = { tiles, foot, storey, rise }); }
  tiles.forEach(([i, j], k) => {
    const top = (k + 1) * rise;
    b.box(tx(i), top / 2, tz(j), 1, top, 1, c[k % 2], "solid", 0.02);
    b.furn(i, j);
  });
  const spec = { tiles, foot, storey, rise };
  b.up = spec;
  return spec;
}

/**
 * Üst kat: aynı karolarda merdiven boşluğu. Son karo sahanlıktır (zemin, yürünebilir); sondan bir önceki boşluğun ağzıdır
 * (zemin yok, yürünebilir: adım atınca alt kata geçilir); öncekiler engelli boşluk (korkuluklu). İnen basamaklar görünür.
 */
export function stairHole(b: LevelBuilder, s: StairSpec, c: [string, string] = ["#8E7A63", "#7F6C56"]) {
  const n = s.tiles.length;
  // boşluk yok (zemin kalır); alttaki kuyunun üstü bu katta da kuyu — kapı ikinci karoya (eski boşluğun ağzı) açılır
  if (b.liftOnly) { b.shaft = { door: s.tiles[0], tile: n > 1 ? s.tiles[1] : s.foot }; return; }
  b.unfloor(s.tiles.slice(0, n - 1));
  const hole = new Set(s.tiles.slice(0, n - 1).map((t) => `${t[0]},${t[1]}`));
  s.tiles.slice(0, n - 1).forEach(([i, j], k) => {
    const h = (k + 1) * s.rise;
    b.box(tx(i), -s.storey + h / 2, tz(j), 1, h, 1, c[k % 2], "solid", 0.02);
    if (k >= n - 2) return;
    b.furn(i, j);
    // korkuluk: boşluk karosunun boşluk olmayan komşu kenarlarında (karonun içinde kalır)
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (hole.has(`${i + di},${j + dj}`) || b.isBlocked(i + di, j + dj) && !b.decor.has(`${i + di},${j + dj}`)) continue;
      const x = tx(i) + di * 0.46, z = tz(j) + dj * 0.46;
      b.box(x, RAIL_H, z, di ? 0.06 : 1, 0.06, dj ? 0.06 : 1, "#3A2E26");
      b.box(x, RAIL_H / 2, z, 0.05, RAIL_H, 0.05, "#3A2E26");
    }
  });
  b.hole = s;
}

// ------------------------------------------------------------------------------------------ eşya (özgün, genel; gerçek oran)
export const DARK = "#1F1A17";
export function bench(b: LevelBuilder, i: number, j: number, c = "#8B6B4A") {
  b.box(tx(i), 0.25, tz(j), 0.9, 0.08, 0.36, c); b.box(tx(i) - 0.36, 0.12, tz(j), 0.08, 0.22, 0.3, DARK); b.box(tx(i) + 0.36, 0.12, tz(j), 0.08, 0.22, 0.3, DARK);
  b.furn(i, j);
}
export function plant(b: LevelBuilder, i: number, j: number) {
  b.box(tx(i), 0.18, tz(j), 0.36, 0.36, 0.36, "#B45F3C"); b.box(tx(i), 0.6, tz(j), 0.5, 0.5, 0.5, "#3F7D3A"); b.box(tx(i) + 0.08, 0.92, tz(j) - 0.04, 0.3, 0.26, 0.3, "#4E9A46");
  b.furn(i, j);
}
/** Kaide + soyut nesne (yığılmış küpler; gerçek bir eserin kopyası değil) */
export function plinth(b: LevelBuilder, i: number, j: number, c: string) {
  b.box(tx(i), 0.28, tz(j), 0.5, 0.56, 0.5, "#E7E2D6");
  const s1 = 0.18 + b.r() * 0.1;
  b.box(tx(i), 0.56 + s1 / 2, tz(j), s1, s1, s1, c);
  b.box(tx(i) + 0.05, 0.56 + s1 + 0.07, tz(j) - 0.03, 0.12, 0.14, 0.12, c);
  b.furn(i, j);
}
/** soyut mermer figür (kaide + gövde + baş + iki kol; gerçek bir eserin kopyası değil).*/
function statue(b: LevelBuilder, i: number, j: number, c: string) {
  b.box(tx(i), 0.18, tz(j), 0.62, 0.36, 0.62, "#E7E2D6");
  b.box(tx(i), 0.64, tz(j), 0.26, 0.56, 0.16, c);
  b.box(tx(i), 1.02, tz(j), 0.16, 0.2, 0.16, c);
  for (const sx of [-1, 1]) b.box(tx(i) + sx * 0.17, 0.61, tz(j), 0.1, 0.5, 0.12, c);
  b.furn(i, j);
}
export function vitrine(b: LevelBuilder, i: number, j: number, c: string) {
  b.box(tx(i), 0.27, tz(j), 0.8, 0.54, 0.56, "#4B3B2E");
  b.box(tx(i), 0.66, tz(j), 0.74, 0.24, 0.5, "#BFE3F0", "glass");
  b.box(tx(i), 0.59, tz(j), 0.26, 0.08, 0.18, c);
  b.furn(i, j);
}
/** Duvardaki soyut panel (renk alanları; yazı/figür yok). Yüz yönü (fx, fz) duvardan odaya. */
export function panel(b: LevelBuilder, i: number, j: number, colors: string[], fx = 0, fz = 1, y = 0.95) {
  const x = tx(i) + fx * 0.51, z = tz(j) + fz * 0.51;
  const along = fz !== 0;
  b.box(x, y, z, along ? 0.7 : 0.03, 0.56, along ? 0.03 : 0.7, "#3A2A1E");
  const n = colors.length;
  for (let k = 0; k < n; k++) {
    const o = -0.29 + (0.58 / n) * (k + 0.5);
    b.box(x + (along ? o : fx * 0.02), y + (k % 2 ? 0.06 : -0.04), z + (along ? fz * 0.02 : o), along ? 0.58 / n - 0.03 : 0.02, 0.38 - (k % 2) * 0.12, along ? 0.02 : 0.58 / n - 0.03, colors[k]);
  }
}
/** Pencere (cam + denizlik); `arch`: küçük kemerli taş pencere (kemer taşı üstte). Yüz yönü (fx, fz) duvardan odaya. */
export function windowAt(b: LevelBuilder, i: number, j: number, fx = 0, fz = 1, arch = false, y = 0.95) {
  const x = tx(i) + fx * 0.52, z = tz(j) + fz * 0.52;
  const along = fz !== 0;
  const w = arch ? 0.34 : 0.62, h = arch ? 0.5 : 0.56;
  b.box(x, y, z, along ? w : 0.04, h, along ? 0.04 : w, "#9FD3EA", "glass");
  b.opening(i, j, fx, fz, y - h / 2 + 0.02, y + h / 2 - 0.02, w - 0.04);
  b.box(x, y - h / 2 - 0.03, z, along ? w + 0.1 : 0.08, 0.05, along ? 0.08 : w + 0.1, "#D8D2C4");
  if (arch) {
    b.box(x, y + h / 2 + 0.04, z, along ? w + 0.06 : 0.06, 0.08, along ? 0.06 : w + 0.06, "#CBBFA8");
    b.box(x, y + h / 2 + 0.11, z, along ? w * 0.5 : 0.06, 0.06, along ? 0.06 : w * 0.5, "#CBBFA8");
  }
}
export function hangingLamp(b: LevelBuilder, i: number, j: number, glow = "#FFD27A") {
  // CORE-CITYMAP (REAL-SUPPORT): iç mekânda tavan bloğu yok — lamba katı boydan boya geçen tavan kirişine asılı (kiriş iki dış
  // duvara dayanır; aynı sıradaki lambalar tek kirişi paylaşır)
  const beams = beamRows.get(b) ?? new Set<number>();
  beamRows.set(b, beams);
  if (!beams.has(j)) { beams.add(j); b.box(tx(0) + (b.w - 1) / 2, b.h - 0.05, tz(j), b.w, 0.1, 0.12, DARK); }
  b.box(tx(i), b.h - 0.19, tz(j), 0.03, 0.2, 0.03, DARK);
  b.box(tx(i), b.h - 0.3, tz(j), 0.26, 0.12, 0.26, glow, "glow");
}
const beamRows = new WeakMap<LevelBuilder, Set<number>>();
export function counter(b: LevelBuilder, i0: number, j: number, w: number, c = "#7A5233", top = "#D8CFC0") {
  for (let i = i0; i < i0 + w; i++) { b.box(tx(i), 0.26, tz(j), 1, 0.52, 0.6, c); b.box(tx(i), 0.55, tz(j), 1, 0.05, 0.66, top); b.furn(i, j); b.counters.push([i, j]); }
}
export function shelf(b: LevelBuilder, i: number, j: number, c = "#6B4A2F") {
  b.box(tx(i), 0.62, tz(j) - 0.25, 0.92, 1.24, 0.4, c);
  const cols = ["#C2410C", "#1D4ED8", "#15803D", "#A16207", "#7E22CE"];
  for (let row = 0; row < 3; row++) for (let k = 0; k < 4; k++)
    b.box(tx(i) - 0.32 + k * 0.21, 0.25 + row * 0.38, tz(j) - 0.12, 0.13, 0.24, 0.2, cols[(row * 4 + k + i) % cols.length]);
  b.furn(i, j);
}
export function table(b: LevelBuilder, i: number, j: number, c = "#8A6A4A") {
  b.box(tx(i), 0.44, tz(j), 0.8, 0.05, 0.8, c); b.box(tx(i), 0.21, tz(j), 0.08, 0.42, 0.08, DARK);
  b.furn(i, j);
}
export function sacks(b: LevelBuilder, i: number, j: number) {
  b.box(tx(i) - 0.16, 0.2, tz(j), 0.36, 0.4, 0.42, "#C9B48A"); b.box(tx(i) + 0.2, 0.17, tz(j) + 0.08, 0.32, 0.34, 0.38, "#B8A27A");
  b.furn(i, j);
}
/** Düşey dişli (soyut saat mekanizması parçası): x ekseninde disk + dişler. */
export function gear(b: LevelBuilder, x: number, y: number, z: number, r: number, c = "#8A6A2A", faceX = false) {
  b.box(x, y, z, faceX ? 0.08 : r * 1.8, r * 1.8, faceX ? r * 1.8 : 0.08, c); // CORE-CITYMAP: dişler diske değer
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2, ox = Math.cos(a) * r, oy = Math.sin(a) * r;
    b.box(faceX ? x : x + ox, y + oy, faceX ? z + ox : z, faceX ? 0.08 : 0.1, 0.1, faceX ? 0.1 : 0.08, c);
  }
  b.box(x, y, z, 0.1, 0.1, 0.1, DARK);
}
/** Katın yürünebilir karolarının dış kenarına korkuluk (açık hava katları): komşusu ızgara dışı ya da engelli boşluk olan kenar. */
export function edgeRail(b: LevelBuilder, c = "#3A3A3A", skip?: (i: number, j: number) => boolean, glass = false) {
  for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) {
    if (b.isBlocked(i, j) || skip?.(i, j)) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di, nj = j + dj;
      const out = ni < 0 || nj < 0 || ni >= b.w || nj >= b.d || (b.isBlocked(ni, nj) && !b.decor.has(`${ni},${nj}`));
      if (!out) continue;
      const x = tx(i) + di * 0.46, z = tz(j) + dj * 0.46;
      // güverte korkuluğu — alçak tırabzan (DECK_SOLID) + üstünde cam (DECK_SAFE'e kadar)
      const h = glass ? DECK_SOLID : RAIL_H;
      b.box(x, h, z, di ? 0.06 : 1, 0.06, dj ? 0.06 : 1, c);
      b.box(x, h / 2, z, 0.05, h, 0.05, c);
      if (glass) b.box(x, (h + 0.03 + DECK_SAFE) / 2, z, di ? 0.04 : 1, DECK_SAFE - h - 0.03, dj ? 0.04 : 1, "#9FD3EA", "glass", 0);
    }
  }
}
/** Dürbün (seyir noktası işareti) — karonun dış kenarında; karo yürünebilir kalır. Göz hizasında (0,75). */
export function binocular(b: LevelBuilder, i: number, j: number, dirZ: number, dx = 0.38) {
  const x = tx(i) + dx, z = tz(j) + dirZ * 0.3;
  b.box(x, 0.35, z, 0.08, 0.7, 0.08, "#4B5563");
  b.box(x, 0.76, z, 0.2, 0.16, 0.34, "#1E3A5F");
  b.box(x, 0.76, z + dirZ * 0.13 - 0.09, 0.1, 0.1, 0.1, "#0F172A");
  b.box(x, 0.76, z + dirZ * 0.13 + 0.09, 0.1, 0.1, 0.1, "#0F172A");
}
/** Çıkış kapısı (portal karosu): 1,2 yüksekliğinde çerçeve, dış ışık ve paspas; yüz yönü +z. */
function exitDoor(b: LevelBuilder, i: number, j: number, c = "#D6C7A8") {
  const z = tz(j) + 0.35;
  b.box(tx(i) - 0.44, DOOR_H / 2, z, 0.1, DOOR_H, 0.3, c); b.box(tx(i) + 0.44, DOOR_H / 2, z, 0.1, DOOR_H, 0.3, c);
  b.box(tx(i), DOOR_H + 0.05, z, 1.0, 0.1, 0.3, c);
  b.box(tx(i), DOOR_H / 2, z + 0.14, 0.78, DOOR_H - 0.06, 0.02, "#F3E3B5", "glow");
  b.box(tx(i), 0.012, tz(j) - 0.1, 0.8, 0.025, 0.6, "#8C2F2F");
}
export function exitAt(b: LevelBuilder, i: number, j: number, c?: string) {
  b.carveTile(i, j);
  b.floorTile(i, j, "#6B5A48");
  b.portals.push({ id: "exit", kind: "exit", tile: [i, j], to: "out", arrive: [i, j - 1] });
  exitDoor(b, i, j, c);
}
/** Asansör kapısı (bronz çerçeve, kapalı kanatlar, üstte kat göstergesi ışığı); duvara yaslı, yüz yönü +z. */
export function liftDoor(b: LevelBuilder, i: number, jWall: number, frame = "#B08D57") { liftDoorAt(b, [i, jWall], [i, jWall + 1], frame); }
/** kapı `door` karosunun `tile`a bakan yüzünde (4 yön).*/
function liftDoorAt(b: LevelBuilder, door: Tile, tile: Tile, frame = "#B08D57") {
  b.lifts.push({ door, tile }); // binilebilir durak adayı
  const fx = Math.sign(tile[0] - door[0]), fz = Math.sign(tile[1] - door[1]);
  const at = (o: number, k: number): [number, number] => [tx(door[0]) + fx * (0.53 + o) + fz * k, tz(door[1]) + fz * (0.53 + o) - fx * k];
  const box = (o: number, k: number, y: number, w: number, h: number, t: number, c: string, g: Group = "solid") => {
    const [x, z] = at(o, k);
    b.box(x, y, z, fx ? t : w, h, fx ? w : t, c, g);
  };
  box(0, 0, DOOR_H / 2, 0.74, DOOR_H, 0.05, frame);
  box(0.03, -0.15, DOOR_H / 2 - 0.02, 0.28, DOOR_H - 0.12, 0.02, "#6B5A45");
  box(0.03, 0.15, DOOR_H / 2 - 0.02, 0.28, DOOR_H - 0.12, 0.02, "#6B5A45");
  box(0.02, 0, DOOR_H + 0.12, 0.3, 0.06, 0.02, "#FCD34D", "glow");
}
/** merdivenin yerindeki asansör kuyusu (katı, kat boyu; tavanla çakışmasın diye 1 cm kısa) ve önündeki kapı.*/
function liftShaft(b: LevelBuilder, s: { door: Tile; tile: Tile }, outdoor = false) {
  const [i, j] = s.door;
  b.furn(i, j);
  if (outdoor) liftKiosk(b, i, j, [Math.sign(s.tile[0] - i), Math.sign(s.tile[1] - j)]);
  else b.box(tx(i), (b.h - 0.01) / 2, tz(j), 1, b.h - 0.01, 1, "#7C7F86", "solid", 0.02);
  liftDoorAt(b, s.door, s.tile);
}
/**
 * açık hava katında (teras, güverte, zirve) asansör kuyusu camlı kabin köşkü — dört ince dikme, cam yüzler, ince
 * çatı. Eskiden kat boyu (2,4) opak gri kolon: varış karosu kapının önünde olduğu için dönünce kolon kadrajın yarısını kaplıyordu.
*/
export const KIOSK_FRAME = "#5B6470";
function liftKiosk(b: LevelBuilder, i: number, j: number, door: [number, number]) {
  const x = tx(i), z = tz(j), h = b.h - 0.01;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(x + sx * 0.46, (h - 0.12) / 2, z + sz * 0.46, 0.08, h - 0.12, 0.08, KIOSK_FRAME, "solid", 0);
  for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    // kapı yüzü: kat göstergesi ışığının arkasında küçük dolu levha ( havada ışık yok; varışta avatarı örtmeyecek kadar küçük)
    if (fx === door[0] && fz === door[1]) b.box(x + fx * 0.49, DOOR_H + 0.075, z + fz * 0.49, fx ? 0.03 : 0.4, 0.25, fx ? 0.4 : 0.03, KIOSK_FRAME, "solid", 0);
    b.box(x + fx * 0.46, (h - 0.12) / 2, z + fz * 0.46, fx ? 0.03 : 0.8, h - 0.12, fx ? 0.8 : 0.03, "#BFE3F0", "glass", 0);
  }
  b.box(x, h - 0.05, z, 1.04, 0.08, 1.04, KIOSK_FRAME, "solid", 0);
}

/** CORE-CITYMAP (REAL-SUPPORT): ışık dizisinin teli ve iki ucundaki direkler (ampuller havada durmaz). */
export function lightString(b: LevelBuilder, j: number, i0 = 1, i1 = b.w - 2) {
  // (INTERIOR-STRING-001): tel yalnız `i0..i1` karoları arasında (ait olduğu odada) durur; eskiden bütün genişlik (duvar ve fırından geçerdi)
  b.box((tx(i0) + tx(i1)) / 2, 1.5, tz(j), i1 - i0 + 1, 0.03, 0.03, DARK);
  for (const x of [tx(i0) - 0.47, tx(i1) + 0.47]) b.box(x, 0.77, tz(j), 0.06, 1.54, 0.06, DARK);
}

// ------------------------------------------------------------------------------------------ oda dizisi (genel tarifler)
interface RoomDef { w: number; d: number; name: string; floor: [string, string] }
interface RowOpts { wall: string; exit?: number }
/**
 * Yan yana odalar: x = 0 ve sonda duvar, odalar arasında 1 karoluk duvar ve kapı aralığı; z = 0 arka duvar, en derin odanın
 * önünde ön duvar. Çıkış kapısı `exit` odasının ön duvarı ortasında.
 */
export function rowLevel(b: LevelBuilder, defs: RoomDef[], o: RowOpts): LevelRoom[] {
  b.solidFill(o.wall);
  let x = 1;
  const rooms: LevelRoom[] = [];
  for (const r of defs) {
    b.carve(x, 1, r.w, r.d);
    b.floor(x, 1, r.w, r.d, r.floor[0], r.floor[1]);
    b.room(x, 1, r.w, r.d, r.name);
    rooms.push({ i0: x, j0: 1, w: r.w, d: r.d, name: r.name });
    x += r.w + 1;
  }
  for (let k = 0; k + 1 < rooms.length; k++) {
    const a = rooms[k], c = rooms[k + 1];
    const md = Math.min(a.d, c.d);
    const gi = a.i0 + a.w;
    const gj = 1 + Math.floor(md / 2);
    for (const j of md >= 5 ? [gj - 1, gj] : [gj]) { b.carve(gi, j, 1, 1); b.floor(gi, j, 1, 1, defs[k].floor[0], defs[k].floor[1]); }
  }
  if (o.exit !== undefined) {
    const r = rooms[o.exit];
    exitAt(b, r.i0 + Math.floor(r.w / 2), r.j0 + r.d);
  }
  return rooms;
}

/** Bütün ayak izi açık çatı/teras (açık hava): zemin, kenar korkuluğu, alttan gelen merdivenin boşluğu. */
export function openRoof(b: LevelBuilder, floor: [string, string], name: string, below: StairSpec | null, glass = false) {
  b.floor(0, 0, b.w, b.d, floor[0], floor[1]);
  if (below) stairHole(b, below);
  edgeRail(b, undefined, undefined, glass);
  b.room(0, 0, b.w, b.d, name);
}

// ------------------------------------------------------------------------------------------ paletler
export const PAL = {
  stone: { wall: "#8D8070", floor: ["#B9AD98", "#A99D88"] as [string, string] },
  marble: { wall: "#C9C2B4", floor: ["#E4DED2", "#D3CCBE"] as [string, string] },
  wood: { wall: "#7A5A40", floor: ["#A57A52", "#956C47"] as [string, string] },
  rock: { wall: "#B88A62", floor: ["#C9A27C", "#BC946E"] as [string, string] },
  concrete: { wall: "#8A8F96", floor: ["#B5B9BE", "#A7ACB2"] as [string, string] },
  carpet: { wall: "#D8CCB4", floor: ["#7C2D2D", "#742929"] as [string, string] },
  deck: ["#9C7B5A", "#8E6F50"] as [string, string],
  tile: ["#C8BFAF", "#BAB1A1"] as [string, string],
};
const ART = [["#C2410C", "#F5D0A9", "#1E3A8A"], ["#0F766E", "#FDE68A", "#7C2D12"], ["#6D28D9", "#F9A8D4"], ["#1D4ED8", "#FCD34D", "#DC2626"], ["#15803D", "#E5E7EB"]];

// ------------------------------------------------------------------------------------------ tarifler
interface LevelMeta { name: string; outdoor: boolean; quiet?: boolean; vp?: Tile; vpDir?: number; kTiles?: Tile[]; /** sergi karosu (F: bilgi kartı)*/ exhibit?: Tile; /** yazarın varış ipucu (InteriorRig `interiorArrival` yerine bunu kullanır)*/ arrive?: { tile: Tile; heading: number } }
interface Ctx { scene: string; site: string; kind: SiteKind; door: DoorPlace; art: () => string[]; /** önceki katın yukarı merdiveni */ below: StairSpec | null }
type LevelFn = (b: LevelBuilder, ctx: Ctx) => LevelMeta;
export interface Recipe {
  size: [number, number]; levels: LevelFn[]; /** kat başına duvar/kat yüksekliği (yoksa STOREY) */ heights?: number[];
  /**
   * yer altı (yer altı şehri): katlar girişten AŞAĞI doğru sıralıdır (dizin 0 = giriş, en üstte). Kurulum en derin kattan
   * başlar (her kat yukarıdaki kata `stairUp` kurar, üstteki kat onu `stairHole` ile karşılar); bağlar fiziksel yöne göre
   * (yukarı → dizin − 1, aşağı → dizin + 1). Merdiven geometrisi ve kurallar aynıdır.
*/
  descend?: boolean;
}

// ---- Galata tipi: yuvarlak taş kule (15 × 15; iç çap ~9, duvar ~2 karo)
const RC = 7;
const rd = (i: number, j: number) => Math.hypot(i - RC, j - RC);
const ROUND_IN = 4.6, ROUND_OUT = 6.8;
/** iç halka (duvar boyu) karoları saat yönünde: ön ortadan sola, arkaya, sağa */
const RING: Tile[] = [[7, 11], [6, 11], [5, 11], [5, 10], [4, 10], [4, 9], [3, 9], [3, 8], [3, 7], [3, 6], [3, 5], [4, 5], [4, 4], [5, 4], [5, 3], [6, 3],
  [7, 3], [8, 3], [9, 3], [9, 4], [10, 4], [10, 5], [11, 5], [11, 6], [11, 7], [11, 8], [11, 9], [10, 9], [10, 10], [9, 10], [9, 11], [8, 11]];
const ringRun = (from: number, n: number) => RING.slice(from, from + n);
/** sol yay: 1. kat merdiveni (ayak [4,10]); sağ yay: 2. kat merdiveni (ayak [9,3]) — duvar boyunca dönen merdiven.
 * kat yüksekliği TOWER_H (2,4) → kollar 8 basamak (yükseliş 0,3); sahanlıklar [4,4] ve [11,9].*/
const GALATA_A = { tiles: ringRun(5, 8), foot: RING[4] };
const GALATA_B = { tiles: ringRun(19, 8), foot: RING[18] };

function roundShell(b: LevelBuilder, floor: [string, string], wall: string) {
  b.solidFill(wall);
  for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) if (rd(i, j) <= ROUND_IN) { b.carveTile(i, j); b.floorTile(i, j, (i + j) % 2 ? floor[0] : floor[1]); }
  // ortadaki asansör çekirdeği (taş kolon, önde asansör kapısı)
  galataCore(b);
  // küçük kemerli pencereler: arka, sol, sağ ve çaprazlar (duvarın iç yüzünde)
  windowAt(b, 7, 2, 0, 1, true); windowAt(b, 2, 7, 1, 0, true); windowAt(b, 12, 7, -1, 0, true);
  windowAt(b, 4, 3, 0, 1, true); windowAt(b, 10, 3, 0, 1, true);
}

/**
 * GALATA-FIX H3: seyir halkası duvarları. Dış kenar alçak taş korkuluk (RAIL_H) + üstünde ince cam levha (kenara komşu karolarda);
 * dört eksenin ağzında (±1 karo) cam yok: dürbün korkuluğun üstünden açık havaya bakar.
 * (ürün sahibi 2026-10-31 "seyir terasından hiç bir yer görünmüyor"): iç oda ile halka arasındaki duvar bandı (rd ≤ ROUND_IN + 1)
 * artık dolu taş değil — çaprazlarda konik çatıyı taşıyan tam boy taş ayaklar, aralarında alçak taş denizlik + boydan cam + taş
 * lento (merdivenden ya da asansörden çıkınca odadan her yöne şehir görünür); dört eksende kemerli kapı açıklığı.
*/
/**
 * seyir galerisi geometrisi kule başına ayrışır (<city>/<city> birebir aynı geometri, yalnız palet farklıydı). `GalleryStyle`: `win` pencere biçimi
 * (0 boydan cam, 1 kemerli üst, 2 orta denkli çift, 3 boydan cam + pervaz denizliği), `post` korkuluk direği ritmi (0 yok, 1 her karoda, 2 her 2 karoda çift, 3 her karoda köşe sütunu),
 * `rail` korkuluk tepesi (0 düz, 1 mazgal dişli, 2 küpeşte + alt çıta, 3 taş top). Yapısal taşıyıcılar (ayaklar, parapet) aynı; fark üstte ve camdadır (destekli).
*/
interface GalleryStyle { win: number; post: number; rail: number; /** ayak süsü: 0 düz, 1 kaide + başlık, 2 üç kabartma kanal, 3 dış payanda */ col: number }
const GALLERY_DEFAULT: GalleryStyle = { win: 0, post: 0, rail: 0, col: 0 };
function galataRingWalls(b: LevelBuilder, gs: GalleryStyle = GALLERY_DEFAULT) {
  const skip = new Set(b.portals.map((p) => `${p.tile[0]},${p.tile[1]}`));
  const gap = (i: number, j: number) => (Math.abs(i - RC) <= 1 && (j === 0 || j === b.d - 1)) || (Math.abs(j - RC) <= 1 && (i === 0 || i === b.w - 1));
  const SILL = 0.45, LINTEL = 0.22;
  for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) {
    const k = `${i},${j}`;
    if (!b.blocked.has(k) || skip.has(k) || b.decor.has(k)) continue;
    let edge = false;
    for (let di = -1; di <= 1 && !edge; di++) for (let dj = -1; dj <= 1; dj++) if (b.free(i + di, j + dj)) { edge = true; break; }
    if (!edge) continue;
    if (rd(i, j) <= ROUND_IN + 1) {
      // çapraz karolar (|di| = 3, |dj| = 4 ya da tersi) ayak; ötekiler camlı pencere
      const pier = Math.min(Math.abs(i - RC), Math.abs(j - RC)) >= 3;
      if (pier) {
        b.box(tx(i), b.h / 2, tz(j), 1, b.h, 1, b.fillColor, "solid", 0.04);
        if (gs.col === 1) { b.box(tx(i), 0.1, tz(j), 1.1, 0.2, 1.1, "#D8CFC0", "solid", 0.02); b.box(tx(i), b.h - 0.12, tz(j), 1.1, 0.24, 1.1, "#D8CFC0", "solid", 0.02); }
        else if (gs.col === 2) for (const sx of [-0.3, 0, 0.3]) b.box(tx(i) + sx, b.h / 2 - 0.1, tz(j) + (i < RC ? 0.52 : -0.52), 0.12, b.h - 0.5, 0.06, "#D8CFC0", "solid", 0.02);
        else if (gs.col === 3) b.box(tx(i) + (i < RC ? -0.55 : 0.55), 0.5, tz(j), 0.12, 1.0, 0.5, "#D8CFC0", "solid", 0.02);
      }
      else {
        b.box(tx(i), SILL / 2, tz(j), 1, SILL, 1, b.fillColor, "solid", 0.04);
        const gh = b.h - LINTEL - SILL;
        if (gs.win === 0) b.box(tx(i), (SILL + b.h - LINTEL) / 2, tz(j), 0.84, gh, 0.84, "#9FD3EA", "glass", 0);
        else if (gs.win === 1) { // kemerli: cam alçalır, üstte taş yay bloğu
          b.box(tx(i), SILL + (gh - 0.3) / 2, tz(j), 0.84, gh - 0.3, 0.84, "#9FD3EA", "glass", 0);
          b.box(tx(i), b.h - LINTEL - 0.15, tz(j), 1, 0.3, 1, b.fillColor, "solid", 0.04);
        } else if (gs.win === 2) { // orta denkli çift
          for (const sx of [-1, 1]) b.box(tx(i) + sx * 0.22, (SILL + b.h - LINTEL) / 2, tz(j) + sx * 0.22, 0.38, gh, 0.38, "#9FD3EA", "glass", 0);
          b.box(tx(i), SILL + 0.3, tz(j), 0.12, 0.6, 0.12, b.fillColor, "solid", 0.04); // GALLERY1: denk yalnız alt 0,6 (tam boy denk dürbün varışında görüşü %25 altına indiriyordu)
        } else { // boydan cam + dışa taşan pervaz denizliği (INTEGQ: dikey denkler ışınları kesip varış görüşünü %9,9 altına indiriyordu; denizlik yalnız aşağı ışınları kısmen keser)
          b.box(tx(i), (SILL + b.h - LINTEL) / 2, tz(j), 0.84, gh, 0.84, "#9FD3EA", "glass", 0);
          b.box(tx(i), SILL + 0.03, tz(j), 1.08, 0.06, 1.08, "#D8CFC0", "solid", 0.02);
        }
        b.box(tx(i), b.h - LINTEL / 2, tz(j), 1, LINTEL, 1, b.fillColor, "solid", 0.04);
      }
      b.box(tx(i), b.h + 0.03, tz(j), 1.0, 0.06, 1.0, "#D8CFC0", "solid", 0.02);
      continue;
    }
    // dış korkuluk ince alçak taş parapet (DECK_SOLID; eskiden karo boyu 0,55 taş blok birinci şahısta karenin
    // %60'ını kaplıyordu) + üstünde cam (DECK_SAFE'e kadar); karonun halkaya bakan kenarında, ötesi açık (aşağıda şehir)
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!b.free(i + di, j + dj)) continue;
      const x = tx(i) + di * 0.36, z = tz(j) + dj * 0.36, along = dj !== 0;
      b.box(x, (DECK_SOLID - 0.05) / 2, z, along ? 1 : 0.28, DECK_SOLID - 0.05, along ? 0.28 : 1, b.fillColor, "solid", 0.04);
      b.box(x, DECK_SOLID - 0.025, z, along ? 1.04 : 0.34, 0.05, along ? 0.34 : 1.04, "#D8CFC0", "solid", 0.02);
      if (!gap(i, j)) b.box(tx(i) + di * 0.46, (DECK_SOLID + DECK_SAFE) / 2, tz(j) + dj * 0.46, di ? 0.05 : 1, DECK_SAFE - DECK_SOLID, dj ? 0.05 : 1, "#9FD3EA", "glass");
      // korkuluk tepesi + direk ritmi (parapet kepinin ÜSTÜNE oturur; cam ve kolizyon aynı)
      const cap = DECK_SOLID;
      if (gs.rail === 1) for (const t of [-0.3, 0.3]) b.box(x + (along ? t : 0), cap + 0.07, z + (along ? 0 : t), along ? 0.2 : 0.2, 0.14, along ? 0.2 : 0.2, "#D8CFC0", "solid", 0.02);
      else if (gs.rail === 2) b.box(x, cap + 0.09, z, along ? 1 : 0.1, 0.05, along ? 0.1 : 1, "#CFC4B2", "solid", 0.02);
      else if (gs.rail === 3 && !gap(i, j)) b.box(x, cap + 0.07, z, 0.18, 0.14, 0.18, "#D8CFC0", "solid", 0.02);
      if (gs.post === 1 && !gap(i, j)) b.box(x, cap + 0.2, z, 0.1, 0.4, 0.1, "#CFC4B2", "solid", 0.02);
      else if (gs.post === 2 && !gap(i, j)) for (const t of [-0.35, 0.35]) b.box(x + (along ? t : 0), cap + 0.15, z + (along ? 0 : t), 0.08, 0.3, 0.08, "#CFC4B2", "solid", 0.02);
      else if (gs.post === 3 && (i + j) % 2 === 0 && !gap(i, j)) b.box(x, cap + 0.15, z, 0.16, 0.3, 0.16, "#C7BBA6", "solid", 0.02);
    }
  }
}

/** asansör çekirdeği (taş, çapraz; furn karoları rd ≤ 1) ve ön yüzünde asansör kapısı — her katta aynı yerde (binilir).*/
function galataCore(b: LevelBuilder) {
  for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) if (rd(i, j) <= 1.0) b.furn(i, j);
  // GALATA-FIX H1: çekirdek karo sınırında biter (3,0 × 1,0 çapraz) → kapı ön yüzde, (7, 9) yaklaşma karosuna açılır
  b.box(tx(RC), b.h / 2, tz(RC), 3.0, b.h, 1.0, "#7E7262"); b.box(tx(RC), b.h / 2, tz(RC), 1.0, b.h, 3.0, "#7E7262");
  liftDoor(b, RC, RC + 1, "#9C8A6A");
}

/**
 * seyir kulesi şablonu kule başına ayrışır (<city> ve <city> birebir aynıydı; 16 kule `galata` kullanıyordu).
 * `GalleryTheme`: şehrin paleti (duvar, zemin, süs) + süs düzeni `deco` (0 bank, 1 kaide, 2 saksı, 3 bank + saksı). Seyir galerisinde
 * merkez masalar kalktı (kamera karşıdaki masaya bakıyordu); süs yalnız çapraz köşelerde, bakış eksenleri açık.
*/
export interface GalleryTheme { wall: string; stone: [string, string]; wood: [string, string]; ring: [string, string]; trim: string; accent: string; deco: number; gallery?: GalleryStyle; /** alt kat eşya düzeni (0 Galata, 1, 2)*/ lay?: number }
const GALATA_THEME: GalleryTheme = { wall: "#9A8B76", stone: PAL.stone.floor, wood: PAL.wood.floor, ring: ["#B9AD98", "#A99D88"], trim: "#CBBFA8", accent: "#B45309", deco: 0 };
function galataRecipe(t: GalleryTheme): Recipe { return {
  size: [15, 15],
  heights: [TOWER_H, TOWER_H, TOWER_H],
  levels: [
    (b, ctx) => {
      roundShell(b, t.stone, t.wall);
      exitAt(b, 7, 12, t.trim);
      stairUp(b, GALATA_A.tiles, GALATA_A.foot);
      // alt katların eşya düzeni kuleden (`lay`; 0 Galata) — taş kuleler renksiz imzada yalnız palette ayrışıyordu (Jaccard 0,92)
      if (t.lay === 1) { counter(b, 10, 6, 1, "#5B4636", "#E7DFC9"); counter(b, 10, 7, 1, "#5B4636", "#E7DFC9"); bench(b, 9, 9); vitrine(b, 8, 4, t.accent); plant(b, 10, 10); panel(b, 12, 6, ctx.art(), -1, 0); }
      else if (t.lay === 2) { counter(b, 9, 9, 2, "#5B4636", "#E7DFC9"); bench(b, 10, 5); bench(b, 10, 6); vitrine(b, 8, 4, t.accent); plant(b, 11, 9); panel(b, 7, 2, ctx.art(), 0, 1); }
      else {
        counter(b, 10, 7, 1, "#5B4636", "#E7DFC9"); counter(b, 10, 8, 1, "#5B4636", "#E7DFC9");
        bench(b, 9, 10); vitrine(b, 9, 5, t.accent); plant(b, 8, 4);
        panel(b, 12, 8, ctx.art(), -1, 0);
      }
      b.light(5, 7, "#FFD9A0", 1.5, b.h - 0.15); b.light(9, 8, "#FFD9A0", 1.4, b.h - 0.15);
      b.drawWalls(b.h, 2);
      b.room(3, 3, 9, 9, "room_entry_hall");
      return { name: "room_entry_hall", outdoor: false, arrive: { tile: [7, 10], heading: Math.PI } }; // doğuş asansör kapısının önünde, kapıya dönük (F istemi hemen)
    },
    (b, ctx) => {
      roundShell(b, t.wood, t.wall);
      stairHole(b, ctx.below!);
      stairUp(b, GALATA_B.tiles, GALATA_B.foot);
      if (t.lay === 1) { plinth(b, 6, 5, t.accent); plinth(b, 8, 5, "#0E7490"); vitrine(b, 5, 9, "#7C3AED"); panel(b, 7, 2, ctx.art(), 0, 1); panel(b, 2, 8, ctx.art(), 1, 0); }
      else if (t.lay === 2) { plinth(b, 5, 6, t.accent); plinth(b, 9, 10, "#0E7490"); vitrine(b, 8, 4, "#7C3AED"); panel(b, 2, 7, ctx.art(), 1, 0); panel(b, 8, 12, ctx.art(), 0, -1); panel(b, 12, 7, ctx.art(), -1, 0); }
      else {
        plinth(b, 5, 8, t.accent); plinth(b, 9, 8, "#0E7490"); vitrine(b, 7, 10, "#7C3AED");
        panel(b, 2, 6, ctx.art(), 1, 0); panel(b, 12, 9, ctx.art(), -1, 0); panel(b, 6, 12, ctx.art(), 0, -1);
      }
      b.light(5, 6, "#FFE2B0", 1.5, b.h - 0.15); b.light(8, 9, "#FFE2B0", 1.4, b.h - 0.15);
      b.drawWalls(b.h, 2);
      b.room(3, 3, 9, 9, "room_exhibit");
      return { name: "room_exhibit", outdoor: false, kTiles: [[6, 10]] };
    },
    (b, ctx) => {
      // tepe: iç yuvarlak oda (konik çatı altında, camlı duvar bandı) + duvarın dışında seyir galerisi halkası (korkuluklu); dört kemerli çıkış
      b.solidFill(t.wall);
      for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) {
        const d = rd(i, j);
        if (d <= ROUND_IN || (d > 5.6 && d <= ROUND_OUT)) { b.carveTile(i, j); b.floorTile(i, j, d <= ROUND_IN ? ((i + j) % 2 ? t.wood[0] : t.wood[1]) : ((i + j) % 2 ? t.ring[0] : t.ring[1])); }
      }
      for (const [i, j] of [[7, 13], [7, 12], [7, 2], [7, 1], [1, 7], [2, 7], [12, 7], [13, 7]] as Tile[]) { b.carveTile(i, j); b.floorTile(i, j, t.ring[1]); }
      // asansör çekirdeği tepe katta da (eskiden 1,0 × 1,6 sütun, kapısız) — asansör buraya çıkar
      galataCore(b);
      stairHole(b, ctx.below!);
      galataRingWalls(b, t.gallery);
      // konik çatı: iç oda + duvar bandının üstünde (kat yüksekliğinden başlar; halkanın üstü açık gök), kademeli daralan halkalar
      for (let k = 0; k < 7; k++) {
        const r = 5.9 - k * 0.8, y = b.h + 0.15 + k * 0.3;
        b.box(tx(RC), y, tz(RC), r * 2 * 0.71, 0.3, r * 2 * 0.71, k % 2 ? "#5B6670" : "#66717B");
        b.box(tx(RC), y, tz(RC), r * 2, 0.3, r * 0.6, k % 2 ? "#5B6670" : "#66717B"); b.box(tx(RC), y, tz(RC), r * 0.6, 0.3, r * 2, k % 2 ? "#5B6670" : "#66717B");
      }
      // süs: yalnız çapraz köşelerde (bakış eksenleri ve (7, 10) varış karesinin önü açık; eski merkez masalar kamerayı kapatıyordu)
      if (t.deco === 0 || t.deco === 3) bench(b, 4, 9, t.trim);
      if (t.deco === 0) bench(b, 10, 5, t.trim);
      if (t.deco === 1) { plinth(b, 4, 5, t.accent); plinth(b, 10, 9, t.accent); }
      if (t.deco === 2) for (const [i, j] of [[4, 5], [10, 5], [4, 9], [10, 9]] as Tile[]) plant(b, i, j);
      if (t.deco === 3) plant(b, 10, 5);
      b.light(6, 9, "#FFE2B0", 1.3, b.h - 0.2);
      b.room(0, 0, b.w, b.d, "room_gallery_ring");
      const vp: Tile = [7, 13];
      binocular(b, vp[0], vp[1], 1, 0);
      // GALLERY1: varış halkanın üstünde, dürbün karosunda ((7, 13), dışa/güneye bakış); eski (7, 10) tek karoluk kemere bakıyordu (görüş payı %10)
      return { name: "room_gallery_ring", outdoor: true, vp, vpDir: 1, kTiles: [[1, 8]], arrive: { tile: vp, heading: 0 } };
    },
  ],
}; }
const galata = galataRecipe(GALATA_THEME);

/** Şehrin seyir kulesi paleti (şehir paleti: duvar/zemin/süs) ve süs düzeni kule kimliğinden (aynı şehirde bile farklı). */
const GALLERY_CITY: Record<string, Pick<GalleryTheme, "wall" | "stone" | "wood" | "ring" | "trim" | "accent">> = {
  ...FULL_GALLERY_CITY,
  istanbul: { wall: "#9A8B76", stone: PAL.stone.floor, wood: PAL.wood.floor, ring: ["#B9AD98", "#A99D88"], trim: "#CBBFA8", accent: "#B45309" },
};
const hashStr = (v: string) => { let h = 2166136261; for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 16777619); return h >>> 0; };
/** Şehir + simge kimliğinden seyir kulesi tarifi (şehir paleti yoksa varsayılan palet; süs yine kimlikten). */
/** Kayıtlı seyir kuleleri: sıra → süs düzeni (4) × süs rengi (4) birleşimi 16 kuleye benzersiz düşer (INTERIOR-TOWER-CLONE-001). Yeni kule listede yoksa kimlik özetinden. */
const GALLERY_ORDER = FULL_GALLERY_ORDER;
/**
 * cam/çelik modern seyir kuleleri taş seyir kulesi şablonunun yuvarlak taş gövdesini ve konik külahını almaz — güverteleri
 * gökdelen seyir terası (düz döşeme, cam korkuluk, asansör sırası); altında kulenin kendi modeli (towerDeck.ts). Taş kule (taş seyir kulesi,
 * fener, sur kulesi) ve geleneksel kule (davul kulesi, kapı kulesi) taş şablonda kalır.
*/
const MODERN_THEMES: Record<string, SkyTheme> = {
  ...FULL_MODERN_THEMES,
};
export const MODERN_TOWERS: ReadonlySet<string> = new Set(Object.keys(MODERN_THEMES));
function galataFor(city: string, landmark: string): Recipe {
  const mt = MODERN_THEMES[`${city}/${landmark}`];
  if (mt) return skyscraperRecipe(mt);
  const base = GALLERY_CITY[city] ?? GALATA_THEME, k0 = GALLERY_ORDER.indexOf(`${city}/${landmark}`), k = k0 >= 0 ? k0 : hashStr(`${city}/${landmark}`);
  // geometri de kuleden (k = 0..15 → pencere, direk, korkuluk üçlüsü her kuleye benzersiz; palet/süs ayrıca)
  const gallery: GalleryStyle = { win: k % 4, post: Math.floor(k / 4) % 4, rail: (k + Math.floor(k / 4)) % 4, col: (k * 3 + Math.floor(k / 4)) % 4 };
  return galataRecipe({ ...GALATA_THEME, ...base, deco: k % 4, accent: [base.accent, "#0E7490", "#7C3AED", "#B45309"][Math.floor(k / 4) % 4], gallery, lay: k % 3 });
}

// ---- saat kulesi (Londra): 11 × 11 kare kule, iki karo duvar; giriş · saat mekanizması · çan katı
// kat yüksekliği TOWER_H → duvar boyu dönen 8 basamaklı kollar (yükseliş 0,3); sahanlıklar [4,2] ve [7,8]
const CLOCK_A = { tiles: [[2, 7], [2, 6], [2, 5], [2, 4], [2, 3], [2, 2], [3, 2], [4, 2]] as Tile[], foot: [2, 8] as Tile };
const CLOCK_B = { tiles: [[8, 2], [8, 3], [8, 4], [8, 5], [8, 6], [8, 7], [8, 8], [7, 8]] as Tile[], foot: [7, 2] as Tile };
const clocktower: Recipe = {
  size: [11, 11],
  heights: [TOWER_H, TOWER_H, TOWER_H],
  levels: [
    (b, ctx) => {
      b.solidFill(PAL.stone.wall);
      b.carve(2, 2, 7, 7); b.floor(2, 2, 7, 7, PAL.stone.floor[0], PAL.stone.floor[1]);
      exitAt(b, 5, 9);
      stairUp(b, CLOCK_A.tiles, CLOCK_A.foot);
      bench(b, 7, 8); vitrine(b, 6, 4, "#B45309"); panel(b, 8, 1, ctx.art());
      windowAt(b, 5, 1, 0, 1, true); windowAt(b, 9, 5, -1, 0, true);
      b.light(5, 5, "#FFD9A0", 1.5);
      b.drawWalls(b.h, 2);
      b.room(2, 2, 7, 7, "room_entry_hall");
      return { name: "room_entry_hall", outdoor: false, arrive: { tile: [3, 6], heading: -Math.PI / 2 } }; // doğuş asansör kapısının yanında, kapıya dönük
    },
    (b, ctx) => {
      b.solidFill(PAL.stone.wall);
      b.carve(2, 2, 7, 7); b.floor(2, 2, 7, 7, PAL.wood.floor[0], PAL.wood.floor[1]);
      stairHole(b, ctx.below!);
      stairUp(b, CLOCK_B.tiles, CLOCK_B.foot);
      // saat mekanizması: ortada çerçeve ve dişliler (engelli), dört yüzden saat kadranlarına uzanan miller
      for (let i = 4; i <= 6; i++) for (let j = 4; j <= 6; j++) b.furn(i, j);
      b.box(tx(5), 0.3, tz(5), 2.6, 0.6, 2.6, "#4B3B2E");
      for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) b.box(tx(5) + x, 0.8, tz(5) + z, 0.12, 1.0, 0.12, "#2F2A25");
      b.box(tx(5), 1.3, tz(5), 2.6, 0.1, 2.6, "#2F2A25");
      gear(b, tx(5) - 0.6, 0.85, tz(5), 0.35); gear(b, tx(5) + 0.4, 0.9, tz(5) + 0.3, 0.25, "#A47B3A"); gear(b, tx(5), 0.95, tz(5) - 0.5, 0.3, "#8A6A2A", true);
      b.box(tx(5), 1.22, tz(5) - 2.35, 0.06, 0.06, 2.3, "#2F2A25");
      // saat kadranı (arkadan aydınlatılmış, rakamsız): arka duvarın iç yüzünde yuvarlak cam ve iki ibre
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; b.box(tx(5) + Math.cos(a) * 0.55, 0.95 + Math.sin(a) * 0.55, tz(1) + 0.53, 0.18, 0.18, 0.03, "#F3E9C6", "glow"); }
      b.box(tx(5), 0.95, tz(1) + 0.53, 0.9, 0.9, 0.03, "#E9DDB4", "glow");
      b.box(tx(5) + 0.15, 1.05, tz(1) + 0.56, 0.36, 0.05, 0.02, DARK); b.box(tx(5), 1.15, tz(1) + 0.56, 0.05, 0.45, 0.02, DARK);
      b.light(3, 6, "#FFE2B0", 1.4); b.light(7, 8, "#FFE2B0", 1.3);
      b.drawWalls(b.h, 2);
      b.room(2, 2, 7, 7, "room_mechanism");
      return { name: "room_mechanism", outdoor: false, kTiles: [[3, 8]] };
    },
    (b, ctx) => {
      // çan katı: köşe ve orta ayaklar, aralarında açık kemerler (manzara), ortada asılı soyut çan; üstte kademeli sivri çatı
      b.solidFill(PAL.stone.wall);
      b.carve(1, 1, 9, 9); b.floor(1, 1, 9, 9, PAL.stone.floor[0], PAL.stone.floor[1]);
      // ayaklar ve sivri çatı kat yüksekliğinde (eskiden 1,8 / 1,7: baş üstünde alçak tavan)
      const top = b.h;
      for (const [i, j] of [[1, 1], [9, 1], [1, 9], [9, 9], [5, 1], [1, 5]] as Tile[]) { b.furn(i, j); b.box(tx(i), top / 2, tz(j), 1, top, 1, "#9A8B76"); }
      for (let i = 4; i <= 6; i++) for (let j = 4; j <= 6; j++) b.furn(i, j);
      b.box(tx(5), top - 0.1, tz(5), 3.0, 0.12, 0.2, "#3A2E26");
      for (let k = 0; k < 4; k++) b.box(tx(5), top - 0.28 - k * 0.22, tz(5), 0.5 + k * 0.28, 0.24, 0.5 + k * 0.28, "#8C6A2E");
      for (const dx of [-1.3, 1.3]) b.box(tx(5) + dx, (top - 0.16) / 2, tz(5), 0.12, top - 0.16, 0.12, "#3A2E26"); // çan kirişinin dikmeleri
      b.box(tx(5), top - 1.14, tz(5), 0.16, 0.16, 0.16, "#5B4325");
      stairHole(b, ctx.below!);
      for (let k = 0; k < 5; k++) b.box(tx(5), top + 0.16 + k * 0.32, tz(5), 9.4 - k * 2, 0.32, 9.4 - k * 2, k % 2 ? "#5B6670" : "#4E5862");
      edgeRail(b, "#2F2A25", undefined, true);
      b.room(1, 1, 9, 9, "room_belfry");
      const vp: Tile = [5, 9];
      b.carveTile(5, 9); b.floorTile(5, 9, PAL.stone.floor[0]);
      binocular(b, vp[0], vp[1], 1);
      return { name: "room_belfry", outdoor: true, vp, vpDir: 1, kTiles: [[2, 8]], arrive: { tile: [9, 8], heading: -Math.PI / 4 } }; // GALLERY1: dürbün karosu (5, 9) çan kolonuna yakın (%21); INTEGG3: (9, 4) 180° 16:10 %37 ama dikeyde %21 (eğim etkisiz, çatı) — (9, 8) 315° %40 / dikey %33
    },
  ],
};

// ---- seyir teraslı art deco gökdelen (özgün; FREE-MAP-IP): 15 × 11; yüksek lobi + asansör sırası + yangın merdiveni; üst kat seyir terası
export const DECO_H = 2.4;
/** gökdelen tarifi palet parametreli (modern seyir kuleleri birbirinin klonu olmasın; INTERIOR-TOWER-CLONE-001).*/
export type SkyTheme = { wall: string; floor: [string, string]; deck: [string, string]; metal: string; staff?: string; lounge?: boolean;
  /** güverte ayak izi — sol, sağ, arka kenardan geri çekilen karo sırası (her kule kendi korkuluk/döşeme geometrisi)*/
  form?: [number, number, number];
  /** kulenin ızgara ölçüsü (W × D; lobi, salon, güverte) — simgenin galerisine göre küçük, her kulede ayrı*/
  size?: [number, number];
  /** camlı salonun cam bandı — 0 ön + sol, 1 iki yan cephe, 2 yalnız ön (oturma orta hatta)*/
  band?: 0 | 1 | 2;
  /** gökdelen olmayan seyir kulesi — dağ yayın kulesi (yayın holü + kapsül salonu) ya da teleferik kulesi (istasyon holü +
   * makine dairesi); giriş ve orta kat kendi adını ve donatısını alır, art deco altın şeritler/zigurat yalnız gökdelende*/
  variant?: "broadcast" | "cable" };
/** kule tipine göre giriş ve orta kat adları (kat seçici, rozet).*/
const SKY_NAMES: Record<NonNullable<SkyTheme["variant"]>, [string, string]> = { broadcast: ["room_broadcast_hall", "room_capsule"], cable: ["room_cable_station", "room_cable_machine"] };
const SKY_DEFAULT: SkyTheme = { wall: "#B7AE9C", floor: PAL.marble.floor as [string, string], deck: ["#9AA3AD", "#8C959F"], metal: "#B08D57" };
/**
 * modern seyir kulesinin camlı seyir salonu (lobi ile açık güverte arası; asansör sırası, iki cephe boyunca cam bant).
 * Gerçek kulelerde açık terasın altındaki kapalı camlı seyir katı.
*/
const skyLounge = (t: SkyTheme): LevelFn => (b, ctx) => {
  const W = b.w, D = b.d, run = skyRun(W, D);
  b.solidFill(t.wall);
  b.carve(1, 1, W - 2, D - 2); b.floor(1, 1, W - 2, D - 2, t.deck[0], t.floor[1]);
  stairHole(b, ctx.below!, ["#9A9184", "#8C8478"]);
  stairUp(b, run.tiles, run.foot, TOWER_H, ["#9A9184", "#8C8478"]);
  for (const i of skyLifts(W)) liftDoor(b, i, 0, t.metal);
  // cam bant kuleye göre ön cephe (+z) ya da iki yan cephe; oturma sırası ön ya da orta hatta
  const band = t.band ?? 0;
  if (band !== 1) for (let i = 1; i <= W - 3; i++) windowAt(b, i, D - 1, 0, -1, false, 1.0);
  if (band !== 2) for (let j = 2; j <= D - 3; j += band === 1 ? 1 : 2) windowAt(b, 0, j, 1, 0, false, 1.0);
  if (band === 1) for (let j = 2; j <= D - 3; j++) if (!run.tiles.some(([i, jj]) => i === W - 2 && jj === j)) windowAt(b, W - 1, j, -1, 0, false, 1.0);
  const row = band === 2 ? Math.floor(D / 2) : D - 3;
  if (t.variant === "cable") {
    // teleferik makine dairesi — ortada korkuluklu yatay halat kasnağı (mil + bel hizasında jant; 3 × 3 karo dolu,
    // tavan serbest yüksekliği INTERIOR-CEILING-002 korunur), yanda motor gövdesi
    const ci = Math.floor(W / 2) - 1, cj = Math.floor(D / 2), x = tx(ci), z = tz(cj), R = 1.05;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) b.furn(ci + di, cj + dj);
    b.box(x, 0.45, z, 0.3, 0.9, 0.3, "#3F3A33");
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; b.box(x + Math.cos(a) * R, 0.8, z + Math.sin(a) * R, 0.56, 0.14, 0.56, t.metal, "solid", 0); }
    b.box(x, 0.8, z, 2 * R, 0.08, 0.16, "#5B5650"); b.box(x, 0.8, z, 0.16, 0.08, 2 * R, "#5B5650");
    b.box(tx(1) + 0.1, 0.45, tz(row), 0.9, 0.9, 0.8, "#4B5563"); b.box(tx(1) + 0.1, 0.95, tz(row), 0.5, 0.1, 0.5, "#9CA3AF"); b.furn(1, row);
    bench(b, W - 5, row, t.metal);
  } else {
    for (let i = 3; i <= W - 5; i += 3) bench(b, i, row, t.metal);
    // yayın kulesinin kapsül salonu — tavanda yuvarlak ışık halkası
    if (t.variant === "broadcast") for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; b.box(tx(Math.floor(W / 2)) + Math.cos(a) * 1.8, TOWER_H - 0.015, tz(Math.floor(D / 2)) + Math.sin(a) * 1.8, 0.5, 0.01, 0.5, "#E0F2FE", "glow", 0); } // tavana gömülü (serbest yükseklik)
  }
  plant(b, 1, D - 2); plant(b, W - 4, 1);
  b.light(Math.floor(W / 2) - 1, Math.floor(D / 2) - 1, "#F4F7FB", 1.6, TOWER_H - 0.2, 11);
  b.drawWalls();
  const name = t.variant ? SKY_NAMES[t.variant][1] : "room_lounge";
  b.room(1, 1, W - 2, D - 2, name);
  return { name, outdoor: false, kTiles: [[2, Math.floor(D / 2)]] };
};
/** merdiven kolu (asansörlü planda kuyunun yeri) sağ duvar boyunca, ön duvardan arkaya.*/
const skyRun = (W: number, D: number) => ({ tiles: Array.from({ length: D - 2 }, (_, k) => [W - 2, D - 2 - k] as Tile), foot: [W - 3, D - 2] as Tile });
/** asansör sırası arka duvarda, kuyu kolonundan uzak (W 15 → 3, 5, 7, 9 eskisi gibi).*/
const skyLifts = (W: number) => Array.from({ length: Math.max(2, Math.floor((W - 6) / 2)) }, (_, k) => 3 + 2 * k);
const skyscraperRecipe = (t: SkyTheme): Recipe => {
  const [W, D] = t.size ?? [15, 11], cx = Math.floor((W - 1) / 2);
  return {
  size: [W, D],
  heights: t.lounge ? [DECO_H, TOWER_H, STOREY] : [DECO_H, STOREY],
  levels: [
    (b) => {
      const run = skyRun(W, D), lifts = skyLifts(W), ex = cx - 1;
      b.solidFill(t.wall);
      b.carve(1, 1, W - 2, D - 2); b.floor(1, 1, W - 2, D - 2, t.floor[0], t.floor[1]);
      // koyu mermer şerit (art deco zemin deseni)
      for (let i = 2; i <= W - 4; i++) b.box(tx(i), 0.005, tz(Math.floor(D / 2)), 1, 0.01, 0.3, "#3F3A33");
      exitAt(b, ex, D - 1, t.metal);
      stairUp(b, run.tiles, run.foot, DECO_H, ["#9A9184", "#8C8478"]);
      // asansör sırası (arka duvar): bronz kapılar, aralarında oluklu altın şeritler, üstte basamaklı (zigurat) süs
      for (const i of lifts) liftDoor(b, i, 0, t.metal);
      if (!t.variant) { // altın şeritler ve zigurat yalnız gökdelen lobisinde
        for (const i of [...lifts.map((i) => i - 1), lifts[lifts.length - 1] + 1]) b.box(tx(i), DECO_H / 2, tz(0) + 0.53, 0.12, DECO_H - 0.1, 0.04, "#C9A35A");
        const zc = tx(lifts[0]) + (lifts[lifts.length - 1] - lifts[0]) / 2;
        for (let k = 0; k < 4; k++) b.box(zc, DECO_H - 0.55 + k * 0.14, tz(0) + 0.54, 3.2 - k * 0.8, 0.12, 0.04, k % 2 ? "#C9A35A" : "#8A6A3A");
      } else if (t.variant === "broadcast") {
        // yayın holü: sol duvarda ekran duvarı, köşede kule maketi (kaide + direk + kırmızı/beyaz anten)
        for (const j of [2, 3, 4]) b.box(tx(0) + 0.53, 1.3, tz(j), 0.04, 0.78, 0.9, "#7DD3FC", "glow");
        const mi = W - 4; // maket asansör sırasının ucunda (sol köşe bank/bitki arasında geçidi kapatmaz: CITY-MAP-LM-001)
        b.box(tx(mi), 0.3, tz(1), 0.6, 0.6, 0.6, "#E7E2D6"); b.box(tx(mi), 1.0, tz(1), 0.12, 0.8, 0.12, "#9CA3AF");
        for (let k = 0; k < 3; k++) b.box(tx(mi), 1.48 + k * 0.12, tz(1), 0.06, 0.12, 0.06, k % 2 ? "#F5F5F4" : "#DC2626");
        b.furn(mi, 1);
      } else {
        // teleferik istasyon holü: tavanda halat, holün köşesinde asılı kabin (gövde bandının üstünde), duvarda hat panosu
        b.box(tx(Math.floor(W / 2)), DECO_H - 0.15, tz(2), W - 2, 0.05, 0.05, "#3F3A33");
        b.box(tx(2), DECO_H - 0.45, tz(2), 0.08, 0.6, 0.08, "#3F3A33");
        b.box(tx(2), 1.5, tz(2), 0.9, 0.9, 0.9, t.metal); b.box(tx(2), 1.62, tz(2), 0.92, 0.36, 0.92, "#BFE3F0", "glass"); b.furn(2, 2);
        panel(b, 1, D - 1, ["#C2410C", "#1E3A5F", "#E7DFC9"], 0, -1, 1.3);
      }
      // resepsiyon (yarım daire tezgâh), yan duvar lambaları, bekleme — tezgâh kulenin ölçüsüne göre ortada
      const ci = cx - 2, cj = D - 5;
      counter(b, ci, cj, 3, "#3F3A33", "#E7DFC9");
      if (t.staff) staffAt(b, ci, cj, 3, 1, t.staff, 1); // modern kule resepsiyonunda görevli (INTERIOR-STAFF-001)
      b.box(tx(ci - 1) + 0.3, 0.26, tz(cj) + 0.3, 0.5, 0.52, 0.5, "#3F3A33"); b.box(tx(ci + 3) - 0.3, 0.26, tz(cj) + 0.3, 0.5, 0.52, 0.5, "#3F3A33");
      for (const j of [3, D - 4]) b.box(tx(0) + 0.53, 1.4, tz(j), 0.04, 0.5, 0.24, "#FFF1C1", "glow");
      bench(b, 2, D - 3, "#7C2D2D"); bench(b, 3, D - 3, "#7C2D2D"); plant(b, 1, D - 2); plant(b, W - 4, D - 2);
      b.light(cx - 1, 3, "#FFF1D6", 1.8, DECO_H - 0.2, 11); b.light(W - 6, D - 4, "#FFE6C0", 1.4, DECO_H - 0.2);
      b.drawWalls();
      const name = t.variant ? SKY_NAMES[t.variant][0] : "room_lobby";
      b.room(1, 1, W - 2, D - 2, name);
      return { name, outdoor: false, kTiles: [[W - 5, D - 3]], arrive: { tile: [cx - 1, 2], heading: Math.PI } }; // doğuş asansör sırasının önünde
    },
    ...(t.lounge ? [skyLounge(t)] : []),
    (b, ctx) => {
      // seyir terası: kapalı çekirdek (asansör) çevresinde halka, kenarda yüksek korkuluk
      b.floor(0, 0, b.w, b.d, t.deck[0], t.deck[1]);
      // kuleye özgü güverte ayak izi — geri çekilen kenar sıraları döşemesiz/kapalı, korkuluk yeni kenarda
      const [fl, fr, fb] = t.form ?? [0, 0, 0], cut: Tile[] = [];
      for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) if (i < fl || i >= b.w - fr || j < fb) cut.push([i, j]);
      b.unfloor(cut); for (const [i, j] of cut) b.block(i, j);
      // çekirdek güvertenin ölçüsüne göre (15 × 11 → 7 × 5 eskisi gibi), en az 3 × 3
      const i0 = 4, i1 = Math.max(i0 + 2, W - 5), j0 = 3, j1 = Math.max(j0 + 2, D - 4);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) b.furn(i, j);
      const ccx = (tx(i0) + tx(i1)) / 2, ccz = (tz(j0) + tz(j1)) / 2, cw = i1 - i0 + 1, cd = j1 - j0 + 1;
      b.box(ccx, 1.0, ccz, cw, 2.0, cd, t.wall); b.box(ccx, 2.06, ccz, cw + 0.2, 0.12, cd + 0.2, "#8A8F96");
      // asansör çekirdeğinin kapısız üç yüzünde pencere sırası (eskiden güvertede penceresiz beyaz kutu)
      // (çekirdeğin boyunda, içinden geçen cam şeritler: kule silüetine sığmayan çekirdekle birlikte düşer, havada pencere kalmaz)
      for (let j = j0; j <= j1; j++) b.box(ccx, 1.0, tz(j), cw + 0.05, 1.96, 0.62, "#41627A");
      for (let i = i0; i <= i1; i++) b.box(tx(i), 1.0, ccz - 0.0625, 0.62, 1.96, cd - 0.075, "#41627A"); // kapı yüzüne çıkmaz (asansör kapısı gömülmez)
      for (let i = i0 + 1; i <= i1 - 1; i += 2) liftDoor(b, i, j1, t.metal); // lobiden buraya binilir (eskiden yalnız kapı levhası)
      stairHole(b, ctx.below!, ["#9A9184", "#8C8478"]);
      edgeRail(b, "#E5E7EB", undefined, true);
      b.room(0, 0, b.w, b.d, "lvl_deck");
      const vp: Tile = [cx, b.d - 1];
      binocular(b, vp[0], vp[1], 1);
      // asansörden çıkınca dürbün yönüne (+z, manzara) bakılır; eskiden yan köşe (2,8)/(12,8) çekirdek duvarına bakıyordu (%23)
      return { name: "lvl_deck", outdoor: true, vp, vpDir: 1, kTiles: [[Math.max(1, fl), Math.max(1, fb)]], arrive: { tile: [Math.max(2, fl), D - 2], heading: 0 } };
    },
  ],
  };
};
const skyscraper = skyscraperRecipe(SKY_DEFAULT);

// ---- müze sarayı: 26 × 9, yüksek tavanlı ve tepe ışıklı uzun galeriler (enfilad) + çatı terası
export const HALL_H = 2.6;
const MUSEUM_RUN = { tiles: [[18, 1], [19, 1], [20, 1], [21, 1], [22, 1], [23, 1], [24, 1], [24, 2], [24, 3]] as Tile[], foot: [18, 2] as Tile };
/**
 * müze galerileri dolu: eskiden galeri 8 × 7 odada yalnız dört küçük pano, iki bank ve iki vitrin vardı ("galeri
 * boş"). Üç odanın her duvarına tablolar, orta kaideler/vitrinler, mermer figürler, halılar; asansörlü planda boşalan merdiven yeri de
 * (heykel odasının arka duvarı) donatılır. Geçit karoları (oda arası kapı 3–4. sıralar) ve kuyu önü açık kalır.
*/
function museumExhibits(b: LevelBuilder, art: () => string[], h: LevelRoom, g: LevelRoom, s: LevelRoom) {
  const rug = (cx: number, cz: number, w: number, d: number, c: string) => b.box(tx(cx), 0.012, tz(cz), w, 0.02, d, c, "solid", 0);
  for (const i of [h.i0 + 1, h.i0 + 3, h.i0 + 5]) panel(b, i, h.j0 - 1, art(), 0, 1, 1.2);
  for (const j of [h.j0 + 1, h.j0 + 5]) panel(b, h.i0 - 1, j, art(), 1, 0, 1.2);
  plant(b, h.i0, h.j0);
  rug(h.i0 + 3, h.j0 + 4.5, 3, 1.6, "#8C2F2F");
  for (let k = 0; k < 4; k++) panel(b, g.i0 + 1 + k * 2, g.j0 + g.d, art(), 0, -1, 1.2);
  plinth(b, g.i0 + 2, g.j0 + 1, "#7C3AED"); plinth(b, g.i0 + 5, g.j0 + 1, "#0F766E");
  vitrine(b, g.i0, g.j0 + 1, "#6D28D9"); vitrine(b, g.i0 + g.w - 1, g.j0, "#0F766E");
  rug(g.i0 + 3.5, g.j0 + 4, 4.4, 2.6, "#7C2D2D");
  for (const i of [s.i0 + 1, s.i0 + 3, s.i0 + 5]) panel(b, i, s.j0 + s.d, art(), 0, -1, 1.2);
  for (const j of [s.j0 + 4, s.j0 + 6]) panel(b, s.i0 + s.w, j, art(), -1, 0, 1.2);
  statue(b, s.i0 + 4, s.j0 + 2, "#E4DED2"); statue(b, s.i0 + 5, s.j0 + 5, "#D3CCBE");
  plant(b, s.i0 + s.w - 1, s.j0 + s.d - 1); vitrine(b, s.i0 + 1, s.j0 + 6, "#1D4ED8");
  if (b.liftOnly) for (const i of [s.i0 + 2, s.i0 + 4]) panel(b, i, s.j0 - 1, art(), 0, 1, 1.2);
}
function museum(wall: string, floor: [string, string]): Recipe {
  return {
    size: [26, 9],
    heights: [HALL_H, STOREY],
    levels: [
      (b, ctx) => {
        const [h, g, s] = rowLevel(b, [
          { w: 7, d: 7, name: "room_entry_hall", floor },
          { w: 8, d: 7, name: "room_gallery", floor: PAL.wood.floor },
          { w: 7, d: 7, name: "room_sculpture", floor: PAL.stone.floor },
        ], { wall, exit: 0 });
        stairUp(b, MUSEUM_RUN.tiles, MUSEUM_RUN.foot, HALL_H);
        counter(b, h.i0 + 2, h.j0 + 2, 3, "#5B4636", "#E7DFC9"); bench(b, h.i0, h.j0 + 5); plant(b, h.i0 + h.w - 1, h.j0 + h.d - 1);
        for (let k = 0; k < 4; k++) panel(b, g.i0 + 1 + k * 2, 0, ctx.art(), 0, 1, 1.2);
        bench(b, g.i0 + 3, g.j0 + 4); bench(b, g.i0 + 4, g.j0 + 4);
        vitrine(b, g.i0 + 1, g.j0 + 5, "#B45309"); vitrine(b, g.i0 + g.w - 2, g.j0 + 5, "#1D4ED8");
        plinth(b, s.i0 + 1, s.j0 + 4, "#9CA3AF"); plinth(b, s.i0 + 3, s.j0 + 5, "#B45309");
        museumExhibits(b, ctx.art, h, g, s);
        // tepe ışıkları: galerilerin üstünde cam fenerler (tavan çizgisinde; avatarın üstü kesitle açılır)
        for (const r of [h, g]) for (let i = r.i0 + 1; i < r.i0 + r.w - 1; i += 2) {
          b.box(tx(i) + 0.5, HALL_H + 0.02, tz(r.j0 + 3), 1.6, 0.04, 2.4, "#BFE3F0", "glass");
          b.box(tx(i) + 0.5, HALL_H, (tz(r.j0) + tz(r.j0 + r.d - 1)) / 2, 0.12, 0.12, r.d - 1, "#CFC6B4");
        }
        for (const r of [h, g, s]) { b.box(tx(r.i0) + r.w / 2 - 0.5, HALL_H, tz(r.j0) + 0.5, r.w, 0.12, 0.12, "#CFC6B4"); b.box(tx(r.i0) + r.w / 2 - 0.5, HALL_H, tz(r.j0 + r.d - 1) - 0.5, r.w, 0.12, 0.12, "#CFC6B4"); }
        b.light(h.i0 + 3, h.j0 + 4, "#FFF1D6", 1.6, HALL_H - 0.2, 10); b.light(g.i0 + 4, g.j0 + 3, "#FFE6C0", 1.6, HALL_H - 0.2, 10); b.light(s.i0 + 3, s.j0 + 5, "#FFE6C0", 1.4, HALL_H - 0.2, 10);
        b.drawWalls();
        return { name: "lvl_museum", outdoor: false, kTiles: [[g.i0 + 6, g.j0 + 1]] };
      },
      (b, ctx) => {
        openRoof(b, PAL.tile, "room_roof", ctx.below);
        // çatıda tepe ışığı fenerleri (engelli) ve bank
        for (const i of [4, 12]) { b.furn(i, 4); b.furn(i + 1, 4); b.box(tx(i) + 0.5, 0.3, tz(4), 1.8, 0.6, 0.9, "#BFE3F0", "glass"); }
        plant(b, 3, 2); plant(b, 8, 2); bench(b, 6, 6);
        const vp: Tile = [Math.floor(b.w / 2), b.d - 1];
        binocular(b, vp[0], vp[1], 1);
        return { name: "room_roof", outdoor: true, vp, vpDir: 1, kTiles: [[b.w - 2, b.d - 2]] };
      },
    ],
  };
}

// ---- genel tarifler (aynı ayak izinde iki kat: kapalı kat + açık çatı); merdiven arka duvar boyunca
export const runAlong = (i0: number, j: number, n: number): Tile[] => Array.from({ length: n }, (_, k) => [i0 + k, j] as Tile);

/**
 * CORE-CITYMAP (kalite seferberliği, kök neden N5) — seyir terası giriş kütüphanesi. Eskiden bütün teraslar (Zafer takı, Shibuya
 * kafesi, yedi şehrin sahne terası) aynı 6 basamaklı düz merdiveni kullanıyordu. Şimdi her seyir yerinin gerçek giriş türü:
 * - `straight` iç merdiven (kapıdan girilen dar merdiven evi; İstanbul terası),
 * - `spiral` döner merdiven (ortada dikme; Zafer takı benzeri anıtın dar döner merdiveni),
 * - `switchback` iki kollu (U) merdiven (<city> apartman terası), `L` köşe dönen merdiven (Londra çatı terası),
 * - `ramp` / `ramp_back` uzun, alçak eğimli rampa (Kapadokya kaya oyma yolu; <city> yamaç terası ters yönde),
 * - `escalator` yürüyen merdiven görünümlü çelik kol + korkuluk (<city> kafe ve terası),
 * - `lift` asansör kapıları (kabin ışığı) ve arka duvarda servis merdiveni (<city> terası).
 * Her tür 9 × 7 terasın 7 × 5 odasına sığar; son karo üst katın sahanlığıdır (çatı eşyası merdiven boşluğuna konmaz).
*/
export type TerraceAccess = "straight" | "spiral" | "switchback" | "L" | "ramp" | "ramp_back" | "escalator" | "lift";
export const TERRACE_ACCESS: Readonly<Record<string, TerraceAccess>> = {
  "istanbul:teras": "straight", "kapadokya:teras": "ramp", "londra:teras": "L",
  ...FULL_TERRACE_ACCESS,
};
const ACCESS_ORDER: readonly TerraceAccess[] = ["switchback", "L", "spiral", "ramp", "lift", "ramp_back", "escalator", "straight"];
/** Yerin giriş türü: tabloda yoksa (şehir:landmark ya da sahne:yer) karmasından belirlenimci. */
export function terraceAccess(scene: string, site: string): TerraceAccess {
  const cm = CITY_SITE.exec(site);
  const key = cm ? `${cm[1]}:${cm[2]}` : `${scene}:${site}`;
  return TERRACE_ACCESS[key] ?? ACCESS_ORDER[(sceneSeed(key) >>> 0) % ACCESS_ORDER.length];
}
/** Giriş türünün basamak karoları (alt kat sırası) ve ayak karosu (9 × 7 teras, oda x 1–7, z 1–5). */
export function terraceRun(a: TerraceAccess): { tiles: Tile[]; foot: Tile; core?: Tile } {
  switch (a) {
    // döner ve iki kollu merdiven giriş ekseninin (x 4; kapı 4,6 → varış 4,5) dışında — eskiden göbeği girişin tam önündeydi,
    // avatar içeri girince 1 karo ötedeki merdivene bakıyordu (<city> terası, Zafer takı)
    case "spiral": return { tiles: [[1, 2], [2, 2], [3, 2], [3, 3], [3, 4], [2, 4], [1, 4], [1, 3]], foot: [1, 1], core: [2, 3] };
    case "switchback": return { tiles: [[1, 3], [2, 3], [3, 3], [3, 2], [2, 2], [1, 2]], foot: [1, 4] };
    case "L": return { tiles: [[2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [6, 2], [6, 3]], foot: [1, 1] };
    case "ramp": return { tiles: [[2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [7, 2], [7, 3], [7, 4]], foot: [1, 1] };
    case "ramp_back": return { tiles: [[7, 4], [7, 3], [7, 2], [7, 1], [6, 1], [5, 1], [4, 1], [3, 1], [2, 1]], foot: [7, 5] };
    case "escalator": return { tiles: runAlong(2, 3, 6), foot: [1, 3] };
    case "lift": return { tiles: runAlong(2, 2, 5), foot: [1, 2] };
    default: return { tiles: runAlong(2, 1, 6), foot: [1, 1] };
  }
}
/** Giriş türünün alt kat çizimi: basamaklar + türe özgü ayrıntı (döner dikme, yürüyen merdiven korkuluğu, asansör kapısı). */
export function terraceAccessUp(b: LevelBuilder, a: TerraceAccess, run = terraceRun(a)): StairSpec {
  const col: [string, string] = a === "escalator" ? ["#6B7280", "#4B5563"] : a === "ramp" || a === "ramp_back" ? ["#B88A62", "#A97C56"] : ["#9CA3AF", "#8B95A1"];
  const spec = stairUp(b, run.tiles, run.foot, b.h, col);
  if (b.liftOnly) return spec; // basamak süsü yok (asansör kuyusu makePlan'da)
  if (run.core) { b.furn(run.core[0], run.core[1]); b.box(tx(run.core[0]), b.h / 2, tz(run.core[1]), 0.36, b.h, 0.36, "#6B7280"); }
  if (a === "escalator") {
    // iki yanda kademeli korkuluk bandı (yürüyen merdiven görünümü)
    // yan korkuluk paneli basamağın üstüne oturur (havada bant değil)
    run.tiles.forEach(([i, j], k) => { for (const dz of [-0.46, 0.46]) b.box(tx(i), (k + 1) * spec.rise + 0.285, tz(j) + dz, 1, 0.57, 0.06, "#1F2937"); });
  }
  if (a === "lift") { liftDoor(b, 4, 0); liftDoor(b, 6, 0); }
  return spec;
}
/**
 * asansörlü terasın giriş holü: merdiveni çizmeyince 7 × 5 odanın yarısı boş gri kalıyordu ("boş
 * merdiven boşluğu", yalnız bir asansör kapısı). Boşalan basamak karolarına bank, bitki, masa, duvar panoları ve halı konur; kuyunun
 * kapı önü, ayak karosu ve çıkış yolu açık kalır (.test.mjs "boş oda yok").
*/
function liftLobby(b: LevelBuilder, r: LevelRoom, run: { tiles: Tile[]; foot: Tile }, art: () => string[]) {
  const keep = new Set<string>();
  const around = (t: Tile | undefined) => { if (t) for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) keep.add(`${t[0] + di},${t[1] + dj}`); };
  around(run.tiles[0]); around(run.tiles[1]); around(run.foot);
  const ex = r.i0 + (r.w >> 1);
  for (let j = r.j0 + r.d - 2; j <= r.j0 + r.d; j++) for (let i = ex - 1; i <= ex + 1; i++) keep.add(`${i},${j}`);
  const put: [number, number, "bench" | "plant" | "table"][] = [[7, 1, "plant"], [6, 1, "bench"], [5, 1, "bench"], [7, 3, "table"], [7, 4, "plant"], [1, 5, "plant"], [2, 5, "bench"], [1, 3, "table"]];
  for (const [i, j, k] of put) {
    if (keep.has(`${i},${j}`) || !b.free(i, j)) continue;
    if (k === "bench") bench(b, i, j); else if (k === "plant") plant(b, i, j); else table(b, i, j, "#E5E7EB");
  }
  for (const i of [3, 5]) panel(b, i, r.j0 - 1, art(), 0, 1, 1.2);
  panel(b, r.i0 - 1, 3, art(), 1, 0, 1.2);
  b.box(tx(4), 0.012, (tz(2) + tz(3)) / 2, 3, 0.02, 1.8, "#7C2D2D", "solid", 0);
}
const inRun = (s: StairSpec | null, i: number, j: number) => !!s && s.tiles.some((t) => t[0] === i && t[1] === j);

// ------------------------------------------------------------------------------------------ HOTEL-SYS (E1) otel lobileri
/**
 * HOTEL-SYS (ürün sahibi 2026-10-29, E1) — şehrin tek otelinin İÇ MEKÂNI: küçük dış kabuğun kapısından
 * ışınlanılan ayrı ve çok daha büyük sahne. Yalnız ortak alanlar (lobi, salon, kafe/bar, avlu, merdiven holü); oda ve yatak YOK
 * (ajanların "görünmeyen odaları" sanaldır, districts/hotel.ts). Her şehir simge otelinden yalnız ESİNLİDİR: ad, logo, yazı,
 * amblem yok; mimari dil genel ( "HOTEL-SYS" satırları). Tarif kimliği = sahnenin `hotel` bölgesinin `tag`'i.
 * Tek kat, oda dizisi (`rowLevel`; geçitler 3–4. sıralarda, çıkış lobinin ön duvarında); kamera INTERIOR-CAM iç mekân profili.
*/
type LobbyRoom = "lobby" | "lounge" | "cafe" | "court" | "stairs";
export interface LobbyTheme {
  wall: string; wood: string; top: string; metal: string; glow: string; rug: string; accent: string;
  floor: [string, string]; rooms: { kind: LobbyRoom; w: number; floor?: [string, string] }[];
  h?: number;
  /** imza ayrıntısı (ör. kafes asansör, cam tavanlı palmiye avlusu) */
  feature?: (b: LevelBuilder, rooms: LevelRoom[], t: LobbyTheme) => void;
}
const ROOM_NAME: Record<LobbyRoom, string> = { lobby: "room_hotel_lobby", lounge: "room_hotel_lounge", cafe: "room_hotel_cafe", court: "room_hotel_court", stairs: "room_hotel_stairs" };
export const cxOf = (r: LevelRoom) => r.i0 + Math.floor(r.w / 2);

/** Arka duvar yüzüne yaslı panel/ayna (duvara dokunur; REAL-SUPPORT). */
function wallPanel(b: LevelBuilder, i: number, w: number, y: number, h: number, c: string, g: Group = "solid") {
  b.box(tx(i) + (w - 1) / 2, y, tz(0) + 0.52, w - 0.1, h, 0.04, c, g);
}
/** Koltuk (oturak + sırt); tek karo engelli. `fz` sırtın yönü (+1 arkada). */
function armchair(b: LevelBuilder, i: number, j: number, c: string, fz = -1) {
  b.box(tx(i), 0.22, tz(j), 0.78, 0.2, 0.7, c); b.box(tx(i), 0.5, tz(j) - fz * 0.3, 0.78, 0.5, 0.12, c);
  for (const s of [-1, 1]) b.box(tx(i) + s * 0.36, 0.36, tz(j), 0.08, 0.3, 0.66, c);
  b.box(tx(i), 0.06, tz(j), 0.7, 0.12, 0.6, DARK);
  b.furn(i, j);
}
/**
 * tezgâh görevlisi — `counter(b, i0, j, w)` tezgâhının arkasında (`side` −1: duvar daha küçük j'de, bakış +z; +1: duvar daha büyük j'de, bakış −z),
 * koşunun ortasında; ayakta konuk (`guestAt`) ve koltukta oturan konuk (`seatGuest`: koltuk + figüran). Hepsi `b.people`e yazılır (INTERIOR-STAFF-001).
*/
export function staffAt(b: LevelBuilder, i0: number, j: number, w: number, side: -1 | 1, wear: string, k = 0) {
  figuran(b, tx(i0) + (w - 1) / 2, tz(j) + side * 0.41, side < 0 ? 0 : Math.PI, wear, DARK, FIG_SKIN[k % FIG_SKIN.length]);
}
/**
 * GALLERY1: tarif görevli koymadıysa her tezgâh koşusunun arkasına (servis yanı = duvara yakın yan) görevli. Ortak kök neden:
 * `counter` görevsiz tezgâh kuruyordu, `staffAt` yalnız yeme-içme tariflerinde elle çağrılıyordu (Galata giriş masası, müze/lobi/kafes
 * kule bilet masaları boştu). Koşu ve yan kuralı INTERIOR-STAFF-001 ile aynı (dikey koşu: yatay komşusu yok, dikey komşusu var).
 * Görevli tezgâhın kendi karosunda durur (±0,41) — yeni karo kapatmaz.
*/
function staffCounters(b: LevelBuilder) {
  const set = new Set(b.counters.map(([i, j]) => `${i},${j}`)), has = (i: number, j: number) => set.has(`${i},${j}`);
  const reach = (i: number, j: number, di: number, dj: number) => { let k = 1; while (b.free(i + di * k, j + dj * k) && !has(i + di * k, j + dj * k)) k++; return k; };
  let n = 0;
  for (const [i, j] of b.counters) {
    const vert = !has(i - 1, j) && !has(i + 1, j) && (has(i, j - 1) || has(i, j + 1));
    if (vert ? has(i, j - 1) : has(i - 1, j)) continue;
    let w = 1; while (vert ? has(i, j + w) : has(i + w, j)) w++;
    const mid = (vert ? j : i) + Math.floor((w - 1) / 2);
    const back = vert ? -Math.sign(reach(i, mid, 1, 0) - reach(i, mid, -1, 0)) : -Math.sign(reach(mid, j, 0, 1) - reach(mid, j, 0, -1));
    const a0 = vert ? tz(j) : tx(i), a1 = vert ? tz(j + w - 1) : tx(i + w - 1), n0 = vert ? tx(i) : tz(j);
    if (b.people.some(([x, z]) => { const [a, m] = vert ? [z, x] : [x, z]; return a >= a0 - 0.6 && a <= a1 + 0.6 && Math.abs(m - n0) >= 0.3 && Math.abs(m - n0) <= 0.6 && (back === 0 || Math.sign(m - n0) === back); })) continue;
    // ada tezgâh (iki yan eşit): görevli boş komşu karosu olan yanda
    const s = back !== 0 ? back : (vert ? b.free(i - 1, mid) : b.free(mid, j - 1)) ? -1 : 1, ac = (a0 + a1) / 2, nx = n0 + s * 0.41;
    figuran(b, vert ? nx : ac, vert ? ac : nx, vert ? (s < 0 ? Math.PI / 2 : -Math.PI / 2) : s < 0 ? 0 : Math.PI, FIG_WEAR[n % FIG_WEAR.length], DARK, FIG_SKIN[n % FIG_SKIN.length]);
    n++;
  }
}
export function guestAt(b: LevelBuilder, i: number, j: number, face: number, k: number) {
  if (!b.free(i, j)) return;
  figuran(b, tx(i), tz(j), face, FIG_WEAR[k % FIG_WEAR.length], "#2B2B33", FIG_SKIN[(k + 1) % FIG_SKIN.length]);
  b.furn(i, j);
}
export function seatGuest(b: LevelBuilder, i: number, j: number, face: number, k: number, chair = "#7A5233") {
  if (!b.free(i, j)) return;
  armchair(b, i, j, chair, -Math.cos(face) >= 0 ? -1 : 1);
  figuran(b, tx(i), tz(j), face, FIG_WEAR[k % FIG_WEAR.length], "#3A3530", FIG_SKIN[(k + 2) % FIG_SKIN.length], 0.32);
}
/** Palmiye saksısı (yüksek gövde + yaprak kümesi). */
export function palm(b: LevelBuilder, i: number, j: number) {
  b.box(tx(i), 0.22, tz(j), 0.5, 0.44, 0.5, "#B98A62");
  b.box(tx(i), 1.0, tz(j), 0.12, 1.2, 0.12, "#7A5A3A");
  for (const [dx, dz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) b.box(tx(i) + dx, 1.62, tz(j) + dz, dx ? 0.56 : 0.2, 0.08, dz ? 0.56 : 0.2, "#3F7D3A");
  b.box(tx(i), 1.7, tz(j), 0.3, 0.12, 0.3, "#4E9A46");
  b.furn(i, j);
}
/** Avize: tavan kirişine asılı katmanlı ışık (hangingLamp kirişini paylaşır). */
function chandelier(b: LevelBuilder, i: number, j: number, glow: string, metal: string) {
  hangingLamp(b, i, j, glow);
  b.box(tx(i), b.h - 0.48, tz(j), 0.6, 0.06, 0.6, metal);
  for (const [dx, dz] of [[0.26, 0], [-0.26, 0], [0, 0.26], [0, -0.26]]) b.box(tx(i) + dx, b.h - 0.42, tz(j) + dz, 0.08, 0.1, 0.08, glow, "glow");
}

/**
 * (ürün sahibi 2026-10-29 "her şey kusursuz olsun"; otel lobileri boştu) — durağan figüran: blok insan (resepsiyon görevlisi, bellboy,
 * konuklar). Ajan değil: adı, konuşması, Yakındakiler girdisi yok; yazı, logo, üniforma arması yok. `face` bakış (0 → +z), `seat` oturak
 * üstü (yoksa ayakta). Ölçü lobi eşyasıyla aynı (tezgâh üstü 0,55, koltuk oturağı 0,32; boy ≈ 1,2).
*/
export const FIG_SKIN = ["#E8C4A0", "#C68E62", "#8D5A3B", "#F1D3B6"] as const;
export const FIG_WEAR = ["#3E5A7A", "#7A2E32", "#2E5E4E", "#B79B74", "#5B4636", "#4A4A58"] as const;
export function figuran(b: LevelBuilder, x: number, z: number, face: number, wear: string, legs: string, skin: string, seat: number | null = null) {
  const fx = Math.round(Math.sin(face)), fz = Math.round(Math.cos(face)), rx = fz, rz = -fx;
  const box = (side: number, fwd: number, y: number, w: number, h: number, d: number, c: string) =>
    b.box(x + rx * side + fx * fwd, y, z + rz * side + fz * fwd, Math.abs(rx) * w + Math.abs(fx) * d, h, Math.abs(rz) * w + Math.abs(fz) * d, c, "solid", 0.02);
  const hip = seat ?? 0.5, n0 = b.blocks.length;
  b.people.push([x, z, face, seat === null ? 0 : 1]);
  if (seat === null) for (const s of [-1, 1]) box(s * 0.09, 0, 0.25, 0.13, 0.5, 0.15, legs);
  // baldır koltuk/minder ön kenarından ÇIKAR (eskiden 0,3'te koltuğun içindeydi): uyluk 0,44 uzun, baldır 0,4 önde
  else for (const s of [-1, 1]) { box(s * 0.09, 0.19, hip + 0.06, 0.13, 0.12, 0.44, legs); box(s * 0.09, 0.4, (hip + 0.12) / 2, 0.12, hip + 0.12, 0.13, legs); }
  box(0, 0, hip + 0.21, 0.36, 0.42, 0.2, wear);
  for (const s of [-1, 1]) box(s * 0.23, seat === null ? 0 : 0.06, hip + 0.2, 0.09, 0.38, 0.12, wear);
  box(0, 0, hip + 0.55, 0.22, 0.22, 0.22, skin);
  box(0, -0.02, hip + 0.68, 0.24, 0.06, 0.22, DARK);
  b.figs.push(b.blocks.slice(n0));
}
/** lobinin figüranları — tezgâh ardında görevli, bavul arabasının yanında bellboy, tezgâh önünde konuk; salonda/kafede oturan konuk.*/
function lobbyFiguranlar(b: LevelBuilder, rooms: LevelRoom[], t: LobbyTheme) {
  const pick = (k: number) => [FIG_WEAR[k % FIG_WEAR.length], FIG_SKIN[k % FIG_SKIN.length]] as const;
  rooms.forEach((r, k) => {
    const kind = t.rooms[k].kind, cx = cxOf(r);
    if (kind === "lobby") {
      // görevli tezgâhın ardında (arka duvar ile tezgâh arası; bacaklar tezgâhın arkasında kalır), bakış odaya
      figuran(b, tx(cx), tz(1) - 0.41, 0, t.accent, DARK, FIG_SKIN[(r.i0 + 1) % FIG_SKIN.length]);
      // bellboy: bavul arabasının önünde, odaya dönük
      if (b.free(r.i0 + r.w - 1, 2)) { figuran(b, tx(r.i0 + r.w - 1), tz(2), 0, t.wood, DARK, FIG_SKIN[(r.i0 + 2) % FIG_SKIN.length]); b.furn(r.i0 + r.w - 1, 2); }
      // konuk tezgâh önünde (orta şeridin solunda; yol açık kalır), görevliye dönük
      if (b.free(cx - 1, 2)) { const [w, s] = pick(r.i0 + 3); figuran(b, tx(cx - 1), tz(2), Math.PI, w, "#2B2B33", s); b.furn(cx - 1, 2); }
    } else if (kind === "lounge") {
      const [w, s] = pick(r.i0 + 4); figuran(b, tx(cx + 1), tz(4), -Math.PI / 2, w, "#3A3530", s, 0.32); // sehpanın yanındaki koltukta (giriş şeridinden uzak)
    } else if (kind === "cafe") {
      const [w, s] = pick(r.i0 + 5); figuran(b, tx(r.i0 + 1), tz(2) - 0.15, Math.PI, w, "#2B2B33", s, 0.37); // bar taburesinde
    } else if (kind === "court") {
      const [w, s] = pick(r.i0 + 6); if (b.free(r.i0 + 1, 3)) { figuran(b, tx(r.i0 + 1), tz(3), Math.PI / 2, w, "#3A3530", s); b.furn(r.i0 + 1, 3); }
    }
  });
}

function furnishLobby(b: LevelBuilder, r: LevelRoom, t: LobbyTheme) {
  const cx = cxOf(r), w = Math.min(3, r.w - 2), c0 = r.i0 + Math.floor((r.w - w) / 2);
  counter(b, c0, 1, w, t.wood, t.top); // resepsiyon (arka duvar önünde)
  // anahtar dolabı / posta gözleri (duvar yüzünde; yazı yok)
  wallPanel(b, c0, w, 1.25, 0.6, t.wood);
  for (let k = 0; k < w * 3; k++) b.box(tx(c0) - 0.33 + k * 0.33, 1.25 + ((k % 2) - 0.5) * 0.2, tz(0) + 0.55, 0.12, 0.1, 0.02, t.metal);
  b.box(tx(c0 + w - 1), 0.63, tz(1), 0.14, 0.12, 0.14, t.glow, "glow"); // masa lambası
  // orta halı ve iki koltuk + sehpa (orta şerit açık)
  b.box(tx(cx), 0.012, tz(5), Math.min(5, r.w - 2), 0.02, 2.4, t.rug, "solid", 0);
  armchair(b, r.i0 + 1, 5, t.accent, 0); armchair(b, r.i0 + r.w - 2, 5, t.accent, 0);
  plant(b, r.i0, 7); plant(b, r.i0 + r.w - 1, 7);
  // bavul arabası (köşe)
  b.box(tx(r.i0 + r.w - 1), 0.05, tz(1), 0.7, 0.06, 0.5, t.metal);
  b.box(tx(r.i0 + r.w - 1), 0.32, tz(1), 0.5, 0.46, 0.34, "#7A4E2A"); b.box(tx(r.i0 + r.w - 1), 0.68, tz(1), 0.4, 0.26, 0.3, "#3E5A7A");
  b.furn(r.i0 + r.w - 1, 1);
  chandelier(b, cx, 4, t.glow, t.metal);
}
function furnishLounge(b: LevelBuilder, r: LevelRoom, t: LobbyTheme) {
  const cx = cxOf(r);
  b.box(tx(cx), 0.012, tz(4), Math.min(4, r.w - 2), 0.02, 3, t.rug, "solid", 0);
  table(b, cx, 4, t.wood);
  armchair(b, cx - 1, 4, t.accent, 0); armchair(b, cx + 1, 4, t.accent, 0);
  armchair(b, cx, 6, t.accent, 1);
  // şömine (arka duvarda, ateş ışığı) ve kitaplık
  b.box(tx(cx), 0.5, tz(1) - 0.2, 1.2, 1.0, 0.5, t.top); b.box(tx(cx), 0.3, tz(1) - 0.02, 0.6, 0.4, 0.1, "#FF8C42", "glow"); b.furn(cx, 1);
  shelf(b, r.i0, 1, t.wood);
  if (r.w > 5) shelf(b, r.i0 + r.w - 1, 1, t.wood);
  plant(b, r.i0 + r.w - 1, 7);
  hangingLamp(b, cx, 5, t.glow);
}
function furnishCafe(b: LevelBuilder, r: LevelRoom, t: LobbyTheme) {
  counter(b, r.i0 + 1, 1, r.w - 2, t.wood, t.top); // bar tezgâhı
  // arka duvarda şişe/fincan rafları (renkli kutular, yazısız) ve ayna
  wallPanel(b, r.i0 + 1, r.w - 2, 1.45, 0.5, "#CFE3EA", "glass");
  for (let k = 0; k < (r.w - 2) * 3; k++) b.box(tx(r.i0 + 1) - 0.33 + k * 0.33, 1.05, tz(0) + 0.58, 0.1, 0.22, 0.08, ["#7A2E32", "#2F5D4E", "#C98A3E", "#E9E2D4"][k % 4]);
  b.box(tx(r.i0) + r.w / 2 - 0.5, 0.93, tz(0) + 0.58, r.w - 2.1, 0.04, 0.14, t.wood);
  // bar tabureleri (tezgâh önünde, alçak — yol kapanmaz) ve iki küçük masa
  for (let i = r.i0 + 1; i < r.i0 + r.w - 1; i += 2) { b.box(tx(i), 0.34, tz(2) - 0.15, 0.3, 0.06, 0.3, t.accent); b.box(tx(i), 0.16, tz(2) - 0.15, 0.06, 0.32, 0.06, DARK); }
  for (const i of [r.i0 + 1, r.i0 + r.w - 2]) { table(b, i, 6, t.top); b.box(tx(i), 0.46, tz(6), 0.16, 0.06, 0.16, t.glow, "glow"); }
  hangingLamp(b, cxOf(r), 3, t.glow);
}
function furnishCourt(b: LevelBuilder, r: LevelRoom, t: LobbyTheme) {
  const cx = cxOf(r);
  // orta havuz/çeşme (taş kenar + su yüzeyi) ve köşelerde palmiyeler, cam tavan (tepe ışığı)
  for (const j of [4, 5]) {
    b.box(tx(cx), 0.2, tz(j), 1, 0.4, 1, t.top); b.box(tx(cx), 0.41, tz(j), 0.8, 0.02, 0.8, "#7EC8E3", "glass"); b.furn(cx, j);
  }
  b.box(tx(cx), 0.7, (tz(4) + tz(5)) / 2, 0.16, 0.6, 0.16, t.top); b.box(tx(cx), 1.04, (tz(4) + tz(5)) / 2, 0.36, 0.08, 0.36, t.top);
  palm(b, r.i0, 1); palm(b, r.i0 + r.w - 1, 1); palm(b, r.i0 + r.w - 1, 7);
  for (const i of [r.i0 + 1, r.i0 + r.w - 2]) { table(b, i, 6, t.top); }
  b.box(tx(r.i0) + r.w / 2 - 0.5, b.h + 0.02, tz(4), r.w - 0.4, 0.04, 5.6, "#CFE8F5", "glass");
  b.box(tx(r.i0) + r.w / 2 - 0.5, b.h, tz(4), 0.1, 0.1, 5.6, t.metal);
}
function furnishStairs(b: LevelBuilder, r: LevelRoom, t: LobbyTheme) {
  // büyük merdiven (görsel; arka duvara yaslı, katlara çıkmaz — oda yok): basamaklar sol yandan yükselir, korkuluk, sahanlık
  const n = Math.min(r.w - 1, 5), rise = Math.min(0.32, (b.h - 0.3) / (n + 1));
  for (let k = 0; k < n; k++) {
    const i = r.i0 + k, top = rise * (k + 1);
    b.box(tx(i), top / 2, tz(1), 1, top, 1, k % 2 ? t.top : t.floor[0], "solid", 0.02); b.furn(i, 1);
    b.box(tx(i), top + 0.3, tz(1) + 0.46, 0.06, 0.6, 0.06, t.metal);
  }
  b.box(tx(r.i0) + (n - 1) / 2, rise * n + 0.62, tz(1) + 0.46, n, 0.05, 0.06, t.wood);
  b.box(tx(r.i0 + n - 1) + 0.5, rise * n / 2, tz(1), 0.06, rise * n, 0.9, t.wood);
  b.box(tx(cxOf(r)), 0.012, tz(4), 1.2, 0.02, 4, t.rug, "solid", 0); // yol halısı
  plant(b, r.i0 + r.w - 1, 7); plant(b, r.i0, 7);
  chandelier(b, cxOf(r), 4, t.glow, t.metal);
}
const FURNISH: Record<LobbyRoom, (b: LevelBuilder, r: LevelRoom, t: LobbyTheme) => void> = {
  lobby: furnishLobby, lounge: furnishLounge, cafe: furnishCafe, court: furnishCourt, stairs: furnishStairs,
};

export function lobbyRecipe(t: LobbyTheme): Recipe {
  const w = 1 + t.rooms.reduce((s, r) => s + r.w + 1, 0);
  return {
    size: [w, 9], heights: [t.h ?? HOTEL_LOBBY_H],
    levels: [
      (b) => {
        const rooms = rowLevel(b, t.rooms.map((r) => ({ w: r.w, d: 7, name: ROOM_NAME[r.kind], floor: r.floor ?? t.floor })), { wall: t.wall, exit: 0 });
        rooms.forEach((r, k) => FURNISH[t.rooms[k].kind](b, r, t));
        t.feature?.(b, rooms, t);
        lobbyFiguranlar(b, rooms, t);
        // varış kapının yanından 2 karo içeri (eskiden kapının dibi: arkada ön duvar, takip kamerası yana kaçıp yan duvara
        // yaslanıyordu); bakış yine odaya (exitHeading baskın eksen)
        const ex = b.portals.find((p) => p.to === "out");
        if (ex) for (const di of [-1, 1]) { const a: Tile = [ex.tile[0] + di, ex.tile[1] - 2]; if (b.free(a[0], a[1]) && b.free(a[0], a[1] + 1)) { ex.arrive = a; break; } }
        b.light(cxOf(rooms[0]), 4, t.glow, 1.7, b.h - 0.2, 11);
        if (rooms[1]) b.light(cxOf(rooms[1]), 4, t.glow, 1.5, b.h - 0.2, 10);
        if (rooms[2]) b.light(cxOf(rooms[rooms.length - 1]), 4, t.glow, 1.5, b.h - 0.2, 10);
        b.drawWalls(b.h, 1, t.top);
        return { name: "lvl_hotel", outdoor: false };
      },
    ],
  };
}
const HOTEL_LOBBY_H = 2.8;

/** Şehir simge otelinden esinli lobiler (yalnız mimari dil; ad/logo/yazı yok). */
const HOTEL_LOBBIES: Record<string, Recipe> = {
  // İstanbul — 19. yy. oryantalist otel lobisi: desenli mermer, oyma ahşap, renkli cam fenerler, dökme demir KAFES ASANSÖR,
  // çay salonu, demir korkuluklu merdiven holü
  oryantal: lobbyRecipe({ wall: "#C9B79A", wood: "#6B3F24", top: "#E9DFC9", metal: "#3A3A36", glow: "#FFD27A", rug: "#8E2F2A", accent: "#7A2E32",
    floor: ["#E4DCCB", "#B9A27E"], rooms: [{ kind: "lobby", w: 8 }, { kind: "cafe", w: 6 }, { kind: "stairs", w: 6 }],
    feature: (b, [lobby, cafe], t) => {
      // kafes asansör: lobinin sol arka köşesinde demir çubuklu kabin, içinde ışıklı kabin
      const i = lobby.i0, j = 2;
      for (const [dx, dz] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) b.box(tx(i) + dx, b.h / 2, tz(j) + dz, 0.06, b.h, 0.06, t.metal);
      for (let k = -2; k <= 2; k++) { b.box(tx(i) + k * 0.17, 1.0, tz(j) + 0.42, 0.025, 2.0, 0.025, t.metal); b.box(tx(i) + 0.42, 1.0, tz(j) + k * 0.17, 0.025, 2.0, 0.025, t.metal); }
      for (const y of [0.05, 2.0, b.h - 0.08]) b.box(tx(i), y, tz(j), 0.9, 0.06, 0.9, t.metal);
      b.box(tx(i), 1.0, tz(j), 0.66, 1.0, 0.66, "#B08D57"); b.box(tx(i), 1.82, tz(j), 0.4, 0.08, 0.4, t.glow, "glow");
      b.furn(i, j);
      // renkli cam fenerler (çay salonu)
      ["#C2410C", "#1D4ED8", "#15803D"].forEach((c, k) => b.box(tx(cafe.i0 + 1 + k * 2), 1.85, tz(5), 0.18, 0.22, 0.18, c, "glow"));
      b.box(tx(cafe.i0) + (cafe.w - 1) / 2, 2.0, tz(5), cafe.w - 0.6, 0.03, 0.03, DARK);
      for (const x of [tx(cafe.i0) - 0.47, tx(cafe.i0 + cafe.w - 1) + 0.47]) b.box(x, 1.0, tz(5), 0.05, 2.0, 0.05, DARK);
      // oyma ahşap duvar bandı (lobi)
      for (let k = 0; k < lobby.w; k++) b.box(tx(lobby.i0 + k), 2.2, tz(0) + 0.53, 0.8, 0.14, 0.04, k % 2 ? t.wood : "#8A5A35");
    } }),
  // Londra — Art Deco otel: siyah-beyaz dama zemin, krom/altın şeritler, basamaklı deco aplikler, aynalı bar
  artdeco: lobbyRecipe({ wall: "#E8E1D2", wood: "#2B2622", top: "#F2EEE4", metal: "#C9A44C", glow: "#FFE7B8", rug: "#1F2A33", accent: "#2E5E4E",
    floor: ["#F2EEE4", "#22262B"], rooms: [{ kind: "lobby", w: 8 }, { kind: "lounge", w: 6 }, { kind: "cafe", w: 6 }],
    feature: (b, rooms, t) => {
      for (const r of rooms) for (let k = 0; k < r.w; k += 2) {
        // basamaklı deco aplik (duvarda) ve altın şerit
        b.box(tx(r.i0 + k), 1.6, tz(0) + 0.53, 0.3, 0.12, 0.04, t.metal); b.box(tx(r.i0 + k), 1.74, tz(0) + 0.53, 0.18, 0.16, 0.04, t.glow, "glow");
      }
      b.box(tx(0) + (b.w - 1) / 2, 2.3, tz(0) + 0.54, b.w - 2, 0.05, 0.03, t.metal);
    } }),
  ...fullHotelLobbies(), // kaldırılan şehirlerin otel lobileri (full/generate.ts; free sürümde boş)
  // Kapadokya — mağara oteli lobisi: oyma kaya tonozları, nişler, kandiller, kilimler, avlu
  magara: lobbyRecipe({ wall: "#C9A27C", wood: "#7A4E2A", top: "#E3C49E", metal: "#5B4636", glow: "#FFB65C", rug: "#9C4A3A", accent: "#B9574A",
    floor: ["#C9A27C", "#BC946E"], rooms: [{ kind: "lobby", w: 8 }, { kind: "lounge", w: 6 }, { kind: "court", w: 6, floor: ["#D9B08E", "#CBA27E"] }],
    feature: (b, rooms) => {
      for (const r of rooms) { for (let k = 1; k < r.w - 1; k += 2) niche(b, r.i0 + k, 1); kilimRug(b, r.i0 + 1, 6, Math.min(3, r.w - 2), 1); }
      oilLamp(b, rooms[0].i0 + rooms[0].w - 2, 1); jar(b, rooms[2].i0 + 1, 7);
    } }),
  // Genel tarihî otel (henüz kendi lobisini seçmemiş şehirler)
  grand: lobbyRecipe({ wall: "#E2D8C4", wood: "#6B4A32", top: "#F2EEE4", metal: "#B08D57", glow: "#FFE2A8", rug: "#7A2E32", accent: "#3E5A4E",
    floor: ["#E4DED2", "#D3CCBE"], rooms: [{ kind: "lobby", w: 8 }, { kind: "lounge", w: 6 }, { kind: "cafe", w: 6 }] }),
  // Şehir dışı sahnelerin dinlenme konağı: sıcak salon + çay köşesi (yatak yok; "görünmeyen odalar")
  konak: lobbyRecipe({ wall: "#D8CCB4", wood: "#7A5233", top: "#EFE6D6", metal: "#5B4636", glow: "#FFD9A0", rug: "#3E5A7A", accent: "#8C5A2B",
    floor: ["#A57A52", "#956C47"], rooms: [{ kind: "lounge", w: 7 }, { kind: "cafe", w: 6 }], h: 2.4 }),
};
/** HOTEL-SYS: lobi tarifi (bilinmeyen kimlik → genel). Şehir ekipleri yeni lobi eklerken buraya bir girdi yazar. */
export function hotelLobby(id: string | undefined): Recipe { return HOTEL_LOBBIES[id ?? "grand"] ?? HOTEL_LOBBIES.grand; }
export const HOTEL_LOBBY_IDS: readonly string[] = Object.keys(HOTEL_LOBBIES);

const RECIPES: Record<SiteKind, Recipe> = {
  // COURTYARD-PORTAL: kayıtsız avlu (COURT_RECIPES'te yoksa) — Sultanahmet ölçüsünde genel cami avlusu
  get courtyard(): Recipe { return COURT_RECIPES["istanbul:sultanahmet"]; },
  hotel: HOTEL_LOBBIES.grand, // HOTEL-SYS: sahnenin otel bölgesinin etiketi makePlan'da seçilir
  tower: galata,
  skyscraper,
  lobby: {
    size: [17, 9],
    levels: [
      (b, ctx) => {
        const [a, c] = rowLevel(b, [{ w: 8, d: 7, name: "room_lobby", floor: PAL.marble.floor }, { w: 6, d: 7, name: "room_gallery", floor: PAL.wood.floor }],
          { wall: "#A99E8C", exit: 0 });
        counter(b, a.i0 + 2, a.j0 + 2, 3, "#3F3A33", "#E7DFC9");
        plant(b, a.i0, a.j0); plant(b, a.i0 + a.w - 1, a.j0);
        bench(b, a.i0 + 1, a.j0 + 5); bench(b, a.i0 + 6, a.j0 + 5);
        for (const i of [a.i0 + 2, a.i0 + 4]) liftDoor(b, i, 0);
        panel(b, c.i0 + 1, 0, ctx.art()); panel(b, c.i0 + 3, 0, ctx.art()); panel(b, c.i0 + 5, 0, ctx.art());
        plinth(b, c.i0 + 2, c.j0 + 3, "#0E7490"); plinth(b, c.i0 + 4, c.j0 + 3, "#B45309");
        // (boş oda sınıfı): galeriye oturma yeri, vitrin ve bitki; geçit karoları (3–4. sıra) açık
        bench(b, c.i0 + 1, c.j0 + 5); vitrine(b, c.i0, c.j0 + 1, "#1D4ED8"); plant(b, c.i0 + c.w - 1, c.j0);
        hangingLamp(b, a.i0 + 4, a.j0 + 3); hangingLamp(b, c.i0 + 3, c.j0 + 2);
        b.light(a.i0 + 4, a.j0 + 3); b.light(c.i0 + 3, c.j0 + 2, "#FFE6C0");
        b.drawWalls();
        return { name: "room_lobby", outdoor: false, kTiles: [[c.i0 + c.w - 1, c.j0 + c.d - 1]] };
      },
    ],
  },
  museum: museum("#CFC6B4", PAL.marble.floor),
  castle: {
    size: [21, 9],
    heights: [TOWER_H, TOWER_H],
    levels: [
      (b, ctx) => {
        const [t, k, o] = rowLevel(b, [
          { w: 5, d: 7, name: "room_tunnel", floor: PAL.rock.floor },
          { w: 6, d: 6, name: "room_cellar", floor: PAL.rock.floor },
          { w: 6, d: 7, name: "room_chamber", floor: PAL.rock.floor },
        ], { wall: PAL.rock.wall, exit: 0 });
        stairUp(b, [...runAlong(o.i0, 1, 6), [o.i0 + 5, 2], [o.i0 + 5, 3]], [o.i0, 2], b.h, ["#B88A62", "#A97C56"]); // 8 basamak (L)
        for (let j = t.j0; j < t.j0 + t.d; j += 2) b.box(tx(t.i0) - 0.48, 0.95, tz(j), 0.06, 0.24, 0.16, "#FFB65C", "glow");
        sacks(b, k.i0, k.j0); sacks(b, k.i0 + 1, k.j0); sacks(b, k.i0 + k.w - 1, k.j0 + k.d - 1);
        table(b, k.i0 + 3, k.j0 + 3, "#7A5233");
        bench(b, o.i0 + 1, o.j0 + 5, "#7A5233"); table(b, o.i0 + 3, o.j0 + 4); panel(b, o.i0 + o.w, 4, ctx.art(), -1, 0);
        b.light(t.i0 + 2, t.j0 + 3, "#FFB65C", 1.4); b.light(k.i0 + 3, k.j0 + 2, "#FFC67A", 1.4); b.light(o.i0 + 3, o.j0 + 5, "#FFC67A", 1.5);
        b.drawWalls(b.h, 2);
        return { name: "lvl_rock", outdoor: false, kTiles: [[k.i0 + k.w - 1, k.j0]] };
      },
      (b, ctx) => {
        openRoof(b, ["#C9A27C", "#BC946E"], "lvl_deck", ctx.below, true);
        bench(b, 4, 4); plant(b, 2, 2);
        const vp: Tile = [Math.floor(b.w / 2), b.d - 1];
        binocular(b, vp[0], vp[1], 1);
        return { name: "lvl_deck", outdoor: true, vp, vpDir: 1, kTiles: [[b.w - 1, 1]] };
      },
    ],
  },
  stadium: {
    size: [17, 7],
    heights: [TOWER_H, TOWER_H],
    levels: [
      (b) => {
        const [c] = rowLevel(b, [{ w: 15, d: 5, name: "room_concourse", floor: PAL.concrete.floor }], { wall: "#6B7280", exit: 0 });
        stairUp(b, [...runAlong(9, 1, 7), [15, 2]], [8, 1], b.h, ["#9CA3AF", "#8B95A1"]); // 8 basamak (L)
        counter(b, c.i0 + 1, c.j0, 2, "#B91C1C", "#F3F4F6"); counter(b, c.i0 + 4, c.j0, 2, "#1D4ED8", "#F3F4F6");
        staffAt(b, c.i0 + 1, c.j0, 2, -1, "#B91C1C", 0); staffAt(b, c.i0 + 4, c.j0, 2, -1, "#1D4ED8", 1); guestAt(b, c.i0 + 1, c.j0 + 1, Math.PI, 2); guestAt(b, c.i0 + 5, c.j0 + 1, Math.PI, 3); // büfe satıcıları + müşteriler
        bench(b, c.i0 + 4, c.j0 + 3, "#6B7280"); bench(b, c.i0 + 10, c.j0 + 3, "#6B7280");
        b.light(c.i0 + 4, c.j0 + 2, "#F1F5F9", 1.6, b.h - 0.2, 10); b.light(c.i0 + 11, c.j0 + 3, "#F1F5F9", 1.6, b.h - 0.2, 10);
        b.drawWalls();
        return { name: "room_concourse", outdoor: false, kTiles: [[c.i0 + c.w - 2, c.j0 + c.d - 1]] };
      },
      (b, ctx) => {
        // tribün: sol yarıda basamaklı sıralar (engelli), sağda merdivenin çıktığı düzlük; önde yürüme yolu ve korkuluk
        b.floor(0, 0, b.w, b.d, "#9CA3AF", "#94A3B8");
        for (let j = 0; j < b.d - 2; j++) for (let i = 1; i <= 7; i++) {
          b.furn(i, j);
          const h = 0.25 + (b.d - 3 - j) * 0.3;
          b.box(tx(i), h / 2, tz(j), 1, h, 1, j % 2 ? "#64748B" : "#475569", "solid", 0.02);
          b.box(tx(i), h + 0.1, tz(j) + 0.2, 0.6, 0.2, 0.26, (i + j) % 3 ? "#0EA5E9" : "#FACC15");
        }
        stairHole(b, ctx.below!, ["#9CA3AF", "#8B95A1"]);
        edgeRail(b, "#E5E7EB", undefined, true);
        b.room(0, 0, b.w, b.d, "room_stands");
        const vp: Tile = [Math.floor(b.w / 2), b.d - 1];
        binocular(b, vp[0], vp[1], 1);
        return { name: "room_stands", outdoor: true, vp, vpDir: 1, kTiles: [[b.w - 1, b.d - 2]] };
      },
    ],
  },
  terrace: {
    size: [9, 7],
    levels: [
      (b, ctx) => {
        // asansörlü planda oda "Merdiven boşluğu" değil giriş holü (etiket ile yapı tutarlı: "Asansör: Giriş holü")
        const nm = b.liftOnly ? "room_ground_hall" : "room_stairwell";
        const [r] = rowLevel(b, [{ w: 7, d: 5, name: nm, floor: PAL.concrete.floor }], { wall: "#9CA3AF", exit: 0 });
        const access = terraceAccess(ctx.scene, ctx.site);
        const up = terraceAccessUp(b, access);
        const pi = r.i0 + r.w - 1, pj = r.j0 + r.d - 1;
        if (!inRun(up, pi, pj) && !(up.foot[0] === pi && up.foot[1] === pj)) plant(b, pi, pj);
        if (b.liftOnly) liftLobby(b, r, terraceRun(access), ctx.art);
        b.light(r.i0 + 2, r.j0 + 3, "#FFF1D6", 1.4, b.h - 0.2, 7);
        b.drawWalls();
        return { name: nm, outdoor: false };
      },
      (b, ctx) => {
        openRoof(b, PAL.deck, "room_roof", ctx.below);
        const fr = (i: number, j: number) => !inRun(ctx.below, i, j);
        if (fr(3, 3)) bench(b, 3, 3);
        if (fr(4, 3)) bench(b, 4, 3);
        if (fr(6, 4)) table(b, 6, 4, "#E5E7EB");
        if (fr(1, 4)) { b.box(tx(1), 0.7, tz(4), 0.9, 1.4, 0.9, "#7C8A96"); b.furn(1, 4); }
        for (let i = 1; i < b.w - 1; i++) b.box(tx(i), 1.5, tz(b.d - 2), 0.1, 0.1, 0.1, i % 2 ? "#FDE68A" : "#FCA5A5", "glow");
        lightString(b, b.d - 2);
        const vp: Tile = [Math.floor(b.w / 2), b.d - 1];
        binocular(b, vp[0], vp[1], 1);
        return { name: "room_roof", outdoor: true, vp, vpDir: 1, kTiles: [[1, b.d - 1]] };
      },
    ],
  },
  pier: {
    size: [7, 14],
    levels: [
      (b) => {
        for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) b.block(i, j);
        const walk = (i: number, j: number) => {
          b.blocked.delete(`${i},${j}`);
          b.box(tx(i), -0.06, tz(j), 1, 0.12, 1, (j % 2) ? PAL.deck[0] : PAL.deck[1], "solid", 0.04);
          if ((i + j) % 3 === 0) b.box(tx(i), -0.55, tz(j), 0.16, 0.9, 0.16, "#4A3A2A");
        };
        for (let j = 0; j < b.d; j++) for (let i = 2; i <= 4; i++) walk(i, j);
        for (let j = b.d - 4; j < b.d; j++) for (let i = 0; i < b.w; i++) if (b.blocked.has(`${i},${j}`)) walk(i, j);
        edgeRail(b, "#E5E7EB", (_i, j) => j === 0);
        for (const j of [3, 7]) { b.box(tx(2) - 0.38, 0.75, tz(j), 0.07, 1.5, 0.07, "#374151"); b.box(tx(2) - 0.38, 1.55, tz(j), 0.2, 0.2, 0.2, "#FDE68A", "glow"); }
        bench(b, 0, b.d - 3, "#A47148"); bench(b, b.w - 1, b.d - 3, "#A47148");
        b.room(2, 0, 3, b.d - 4, "room_pier"); b.room(0, b.d - 4, b.w, 4, "room_pier_end");
        b.portals.push({ id: "exit", kind: "exit", tile: [3, 0], to: "out", arrive: [3, 1] });
        b.box(tx(3), 0.02, tz(0), 0.9, 0.03, 0.9, "#8C2F2F");
        const vp: Tile = [3, b.d - 1];
        binocular(b, vp[0], vp[1], 1);
        return { name: "room_pier", outdoor: true, vp, vpDir: 1, kTiles: [[b.w - 1, b.d - 1]] };
      },
    ],
  },
  office_upper: {
    size: [24, 9],
    levels: [
      (b, ctx) => {
        const [m, a, l] = rowLevel(b, [
          { w: 7, d: 7, name: "room_meeting", floor: PAL.carpet.floor },
          { w: 6, d: 7, name: "room_archive", floor: PAL.wood.floor },
          { w: 7, d: 7, name: "room_lounge", floor: PAL.tile },
        ], { wall: "#D6CFC2", exit: 1 });
        stairUp(b, runAlong(l.i0, 1, 6), [l.i0, 2], b.h, ["#B5B9BE", "#A7ACB2"]);
        for (let i = m.i0 + 2; i < m.i0 + 5; i++) table(b, i, m.j0 + 3, "#E5E7EB");
        panel(b, m.i0 + 3, 0, ctx.art()); plant(b, m.i0, m.j0);
        for (let i = a.i0; i < a.i0 + a.w; i += 2) shelf(b, i, a.j0);
        table(b, a.i0 + 2, a.j0 + 4, "#8A6A4A");
        bench(b, l.i0 + 2, l.j0 + 4, "#2563EB"); bench(b, l.i0 + 3, l.j0 + 4, "#2563EB"); plant(b, l.i0 + l.w - 1, l.j0 + l.d - 1);
        b.light(m.i0 + 3, m.j0 + 2, "#FFF6E0"); b.light(a.i0 + 3, a.j0 + 3, "#FFE6C0"); b.light(l.i0 + 3, l.j0 + 4, "#FFF6E0");
        hangingLamp(b, m.i0 + 3, m.j0 + 2); hangingLamp(b, l.i0 + 3, l.j0 + 4);
        b.drawWalls();
        return { name: "lvl_upper", outdoor: false, kTiles: [[a.i0 + a.w - 1, a.j0 + a.d - 1]] };
      },
      roofGarden("room_roof"),
    ],
  },
  mall_upper: {
    size: [22, 9],
    levels: [
      (b, ctx) => {
        const [c, f] = rowLevel(b, [
          { w: 9, d: 7, name: "room_cinema", floor: PAL.carpet.floor },
          { w: 10, d: 7, name: "room_foodcourt", floor: PAL.tile },
        ], { wall: "#CBD5E1", exit: 0 });
        stairUp(b, runAlong(f.i0 + 4, 1, 6), [f.i0 + 4, 2], b.h, ["#CBD5E1", "#B8C2CF"]);
        for (let k = 0; k < 3; k++) panel(b, c.i0 + 1 + k * 3, 0, ctx.art());
        counter(b, c.i0 + 3, c.j0 + 3, 3, "#B91C1C", "#FDE68A");
        bench(b, c.i0, c.j0 + 5, "#7C2D2D"); bench(b, c.i0 + c.w - 1, c.j0 + 5, "#7C2D2D");
        for (const [di, dj] of [[2, 3], [5, 3], [2, 5], [5, 5]]) table(b, f.i0 + di, f.j0 + dj, "#F3F4F6");
        counter(b, f.i0, f.j0, 3, "#0F766E", "#F3F4F6");
        b.light(c.i0 + 4, c.j0 + 2, "#FFD9A0"); b.light(f.i0 + 4, f.j0 + 4, "#FFF6E0", 1.8, b.h - 0.2, 11);
        hangingLamp(b, f.i0 + 4, f.j0 + 4, "#FFF6E0");
        b.drawWalls();
        return { name: "lvl_upper", outdoor: false, kTiles: [[f.i0 + f.w - 1, f.j0 + f.d - 1]] };
      },
      roofGarden("room_roof_garden"),
    ],
  },
  cafe_loft: {
    size: [15, 8],
    levels: [
      (b) => {
        const [r, l] = rowLevel(b, [
          { w: 6, d: 6, name: "room_roastery", floor: PAL.wood.floor },
          { w: 6, d: 6, name: "room_reading", floor: PAL.carpet.floor },
        ], { wall: "#6B4A35", exit: 0 });
        stairUp(b, runAlong(l.i0, 1, 6), [l.i0, 2], b.h, ["#8B6B4A", "#7A5C3F"]);
        b.box(tx(r.i0 + 2), 0.5, tz(r.j0) + 0.1, 1.2, 1.0, 0.9, "#334155"); b.box(tx(r.i0 + 2), 1.1, tz(r.j0) + 0.1, 0.36, 0.3, 0.36, "#94A3B8");
        b.furn(r.i0 + 2, r.j0); b.furn(r.i0 + 1, r.j0);
        sacks(b, r.i0 + r.w - 1, r.j0); sacks(b, r.i0 + r.w - 1, r.j0 + 1); sacks(b, r.i0, r.j0 + r.d - 1);
        shelf(b, l.i0 + l.w - 1, l.j0 + 3); shelf(b, l.i0 + l.w - 1, l.j0 + 5);
        bench(b, l.i0 + 1, l.j0 + 4, "#9A3412"); table(b, l.i0 + 2, l.j0 + 4, "#7A5233");
        b.light(r.i0 + 3, r.j0 + 3, "#FFC67A", 1.5); b.light(l.i0 + 3, l.j0 + 4, "#FFD9A0", 1.5);
        hangingLamp(b, l.i0 + 3, l.j0 + 4, "#FFC67A");
        b.drawWalls();
        return { name: "lvl_loft", outdoor: false, kTiles: [[l.i0 + l.w - 2, l.j0 + l.d - 1]] };
      },
      (b, ctx) => {
        openRoof(b, PAL.deck, "room_balcony", ctx.below);
        plant(b, b.w - 1, 0); table(b, 3, 3, "#E5E7EB");
        const vp: Tile = [Math.floor(b.w / 2), b.d - 1];
        binocular(b, vp[0], vp[1], 1);
        return { name: "room_balcony", outdoor: true, vp, vpDir: 1 };
      },
    ],
  },
  sacred: {
    size: [14, 11],
    heights: [3.0],
    levels: [
      (b) => {
        // sessiz salon: halı, sütunlar, asma ışık halkası, pencereler. Figür, yazı, sembol yok.
        const [r] = rowLevel(b, [{ w: 12, d: 9, name: "room_quiet_hall", floor: ["#3E5C76", "#3A5670"] }], { wall: "#E8E0CF", exit: 0 });
        for (const [di, dj] of [[2, 2], [9, 2], [2, 6], [9, 6]]) { b.box(tx(r.i0 + di), 1.5, tz(r.j0 + dj), 0.5, 3.0, 0.5, "#D9CFB8"); b.furn(r.i0 + di, r.j0 + dj); }
        for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; b.box(tx(r.i0 + 5) + 0.5 + Math.cos(a) * 1.6, 2.2, tz(r.j0 + 4) + Math.sin(a) * 1.6, 0.14, 0.14, 0.14, "#FFE7A8", "glow"); }
        for (const i of [r.i0 + 3, r.i0 + 6, r.i0 + 9]) windowAt(b, i, 0, 0, 1, true, 1.4);
        b.light(r.i0 + 6, r.j0 + 4, "#FFF1D6", 1.4, 2.6, 12);
        b.drawWalls();
        return { name: "room_quiet_hall", outdoor: false, quiet: true };
      },
    ],
  },
};

// ------------------------------------------------------------------------------------------ COURTYARD-PORTAL: gerçek ölçekli avlular
/**
 * COURTYARD-PORTAL (ürün sahibi 2026-10-31: "Geçiş yapılınca bahçe avlusu ve karakter boyutu gerçeğe yakın olmalı. Cami ile karakter
 * boyutları çok orantısız.") — duvarlı simge avlusu, yürüme ölçeğinde (insan 1,0 ≈ 1,75 m; `CM` = 1 / 1,75 birim/metre). Izgaranın
 * arka (−z) kısmı harimin (ibadet bölümü) ayak izidir: engelli; cephe, çağlayan kubbeler ve minareler oraya kurulur (iç mekân
 * kapalı). Önü avludur: üç yanda kubbeli revak (sekilerde oturulur), harim önünde son cemaat revakı, ortada şadırvan, mermer
 * döşeme. Çıkış portalı ön (+z) duvarın ortasında (avlunun taç kapısı); varışta avatar cepheye bakar. Kutsal: sessiz bölge; ışık
 * gösterisi, alem/hilal, bayrak, yazı ve figür yok (minare külahı ve kubbe tepesi düz).
*/
export interface MosqueCourtSpec {
  /** avlu eni (karo; tek sayı → orta eksen bir karo), avlu derinliği (son cemaat revakı + revak + duvar dahil), harim derinliği */
  w: number; court: number; hall: number;
  /** avlu duvarı (revak arkası) yüksekliği, revak örtüsü yüksekliği */
  wallH: number; arcH: number;
  /** harim cephe yüksekliği, ana kubbe yarıçapı, kasnak tabanı, kubbe tepe yüksekliği */
  facadeH: number; domeR: number; domeY: number; domeTop: number;
  /** yarım kubbe sayısı: 4 (Sultanahmet: dört yön), 2 (Süleymaniye: kıble ekseni) */
  halfDomes: 2 | 4;
  /** minare çiftleri: harim köşeleri (`hall`) ya da avlu köşeleri (`court`); ön/arka; yükseklik (birim) ve şerefe sayısı */
  minarets: { at: "hall" | "court"; side: "front" | "back"; h: number; serefe: number; dx?: number }[];
  stone: string; stone2: string; lead: string; paving: [string, string];
  /** bakış noktasının şadırvana göre kayması (karo; varsayılan +4, 0) */
  vpDx?: number; vpDj?: number;
}
/** Avlu katında şehir silüeti halkası avlu duvarının (~ 5 birim) üstünden görünsün diye yükseltilir (eksi iniş = yükselme; şehir
 *  tepeleri gibi): duvarın ötesindeki kubbe ve çatılar ufukta kalır, halka zemini duvarın arkasında gizli. */
const COURT_PANO_ELEV = -3.2;
/** Metre → yürüme birimi (insan 1,75 m = 1). */
export const CM = 1 / 1.75;
/** Sekizgen prizma (kare + iki dikdörtgen → sekizgen ayak izi). */
export function oct(b: LevelBuilder, x: number, y: number, z: number, r: number, h: number, c: string) {
  b.box(x, y, z, 1.66 * r, h, 1.66 * r, c, "solid", 0.02);
  b.box(x, y, z, 2 * r, h, 0.83 * r, c, "solid", 0.02);
  b.box(x, y, z, 0.83 * r, h, 2 * r, c, "solid", 0.02);
}
/** Kubbe: `y0` tabanından `rise` yüksekliğe sekizgen halkalar (çeyrek daire profili). */
export function dome(b: LevelBuilder, x: number, y0: number, z: number, r: number, rise: number, c: string, steps = 8) {
  for (let k = 0; k < steps; k++) {
    const t1 = (k + 1) / steps, rr = r * Math.cos(Math.asin(Math.min(0.98, t1)));
    oct(b, x, y0 + rise * (k + 0.5) / steps, z, Math.max(0.12, rr), rise / steps + 0.02, c);
  }
}
/** Yarım kubbe: (dx, dz) yönüne açılan yarım (kutular merkezden o yöne uzanır). */
function halfDome(b: LevelBuilder, x: number, y0: number, z: number, r: number, rise: number, dx: number, dz: number, c: string, steps = 6) {
  for (let k = 0; k < steps; k++) {
    const t1 = (k + 1) / steps, rr = Math.max(0.15, r * Math.cos(Math.asin(Math.min(0.98, t1)))), y = y0 + rise * (k + 0.5) / steps, h = rise / steps + 0.02;
    if (dz) b.box(x, y, z + dz * rr / 2, 2 * rr, h, rr, c, "solid", 0.02);
    else b.box(x + dx * rr / 2, y, z, rr, h, 2 * rr, c, "solid", 0.02);
  }
}
/** Minare: kaide, sekizgen gövde, şerefeler (çıkıntılı halka + korkuluk), kurşun külah (tepede alem yok). */
export function minaret(b: LevelBuilder, x: number, z: number, h: number, serefe: number, s: Pick<MosqueCourtSpec, "stone" | "stone2" | "lead">, r = 0.62) {
  const capY = h * 0.84;
  oct(b, x, 0.9, z, r * 1.5, 1.8, s.stone2);
  oct(b, x, (1.8 + capY) / 2, z, r, capY - 1.8, s.stone);
  for (let k = 0; k < serefe; k++) {
    const y = 1.8 + (capY - 1.8) * (serefe > 1 ? 0.6 + 0.36 * (k / (serefe - 1)) : 0.8);
    oct(b, x, y, z, r * 1.75, 0.22, s.stone2);
    oct(b, x, y + 0.42, z, r * 1.7, 0.08, s.stone2);
  }
  for (let k = 0; k < 7; k++) oct(b, x, capY + (k + 0.5) * (h - capY) / 7, z, r * (1 - k / 7) + 0.04, (h - capY) / 7 + 0.02, s.lead);
}
/** Avlu sekisi (taş bank) + oturma noktası: karo yürünür kalır, bank karonun duvar yarısında; avatar (fx, fz) yönüne bakar. */
export function seki(b: LevelBuilder, i: number, j: number, fx: number, fz: number, c: string) {
  const x = tx(i) - fx * 0.22, z = tz(j) - fz * 0.22;
  b.box(x, 0.21, z, fx ? 0.5 : 0.94, 0.42, fz ? 0.5 : 0.94, c, "solid", 0.02);
  b.stations.push({ tile: [i, j], face: Math.atan2(fx, fz), pose: "sit_bench", device: "none", y: 0.44 });
}
function mosqueCourt(s: MosqueCourtSpec): Recipe {
  const W = s.w, D = s.hall + s.court, H0 = s.hall; // H0: avlunun ilk karosu (son cemaat revakı)
  return {
    size: [W, D],
    heights: [s.wallH],
    levels: [
      (b) => {
        b.solidFill(s.stone);
        // avlu (revaklar dahil) oyulur; dış duvar (i 0, i W−1, j D−1) ve harim (j < H0) engelli kalır
        b.carve(1, H0, W - 2, s.court - 1);
        // döşeme: büyük mermer levha şeritleri (karo başına kutu yerine; blok tasarrufu)
        for (let j = H0; j < D - 1; j += 3) {
          const dd = Math.min(3, D - 1 - j);
          b.box((tx(1) + tx(W - 2)) / 2, -0.5, (tz(j) + tz(j + dd - 1)) / 2, W - 2, 1, dd, ((j - H0) / 3) % 2 ? s.paving[0] : s.paving[1], "solid", 0.02);
        }
        const cx = (tx(0) + tx(W - 1)) / 2, ci = Math.round((W - 1) / 2);
        // ---- revaklar: batı/doğu (i 1–3) ve güney (j D−4 … D−2); sütunlar iç kenarda (i 3 / W−4, j D−4), her 3 karoda bir
        const A = 3, roofY = s.arcH;
        const colAt = (i: number, j: number) => { b.furn(i, j); oct(b, tx(i), roofY / 2, tz(j), 0.24, roofY, s.stone2); };
        for (let j = H0 + 3; j <= D - 4; j += A) { colAt(3, j); colAt(W - 4, j); }
        for (let i = 6; i <= W - 7; i += A) if (Math.abs(i - ci) > 1) colAt(i, D - 4);
        const zA = tz(H0 + 2) - 0.5, zB = tz(D - 2) + 0.5;
        for (const [x0, x1] of [[tx(1) - 0.5, tx(3) + 0.5], [tx(W - 4) - 0.5, tx(W - 2) + 0.5]]) {
          b.box((x0 + x1) / 2, roofY + 0.2, (zA + zB) / 2, x1 - x0, 0.4, zB - zA, s.stone, "solid", 0.02);
          for (let z = zA + 1.5; z < zB - 1; z += A) dome(b, (x0 + x1) / 2, roofY + 0.4, z, 1.1, 0.9, s.lead, 4);
        }
        {
          const z0 = tz(D - 4) - 0.5, z1 = tz(D - 2) + 0.5, x0 = tx(4) - 0.5, x1 = tx(W - 5) + 0.5;
          // güney revakı taç kapı ekseninde açık (± 2,5): kapı geçidi revak örtüsünün altında değil — varışta kamera cepheyi görür
          for (const [xa, xb] of [[x0, cx - 2.5], [cx + 2.5, x1]]) {
            b.box((xa + xb) / 2, roofY + 0.2, (z0 + z1) / 2, xb - xa, 0.4, z1 - z0, s.stone, "solid", 0.02);
            for (let x = xa + 1.5; x < xb - 1; x += A) dome(b, x, roofY + 0.4, (z0 + z1) / 2, 1.1, 0.9, s.lead, 4);
          }
          // taç kapı (avlunun güney girişi): iki yüksek ayak + kemer + kubbecik (geçit açık)
          for (const sx of [-1, 1]) for (let j = D - 4; j <= D - 2; j++) b.furn(ci + sx * 2, j);
          for (const sx of [-1, 1]) b.box(cx + sx * 2.1, (roofY + 1.6) / 2, (z0 + z1) / 2, 0.8, roofY + 1.6, z1 - z0, s.stone2, "solid", 0.02);
          b.box(cx, roofY + 1.2, (z0 + z1) / 2, 5.0, 0.8, z1 - z0, s.stone2, "solid", 0.02);
          dome(b, cx, roofY + 1.6, (z0 + z1) / 2, 1.6, 1.3, s.lead, 5);
        }
        // ---- son cemaat revakı (j H0 … H0+1): yüksek sütunlar, büyük kubbecikler; harim cephesine dayalı
        const pY = s.arcH + 1.2;
        for (let i = 2; i <= W - 3; i += A) if (Math.abs(i - ci) > 2) colAt(i, H0 + 1);
        b.box(cx, pY + 0.25, (tz(H0) + tz(H0 + 1)) / 2, W - 2, 0.5, 2, s.stone, "solid", 0.02);
        for (let i = 2; i <= W - 3; i += A) dome(b, tx(i), pY + 0.5, (tz(H0) + tz(H0 + 1)) / 2, 1.0, 1.0, s.lead, 4);
        // ---- harim cephesi (z = tz(H0) − 0,5): iki sıra pencere (koyu; ışık yok), korniş, ortada taç kapı (kapalı)
        const fz = tz(H0) - 0.5, hz = tz(0) - 0.5, fx0 = tx(0) - 0.5, fx1 = tx(W - 1) + 0.5;
        b.box(cx, s.facadeH / 2, fz - 2, fx1 - fx0, s.facadeH, 4, s.stone, "solid", 0.02);
        b.box(cx, s.facadeH + 0.15, fz - 2, fx1 - fx0 + 0.3, 0.3, 4.3, s.stone2, "solid", 0.02);
        for (const [y, hh] of [[2.6, 1.7], [6.2, 1.4]] as const) for (let x = fx0 + 2.5; x < fx1 - 2; x += 3) {
          if (Math.abs(x - cx) < 3.2) continue;
          b.box(x, y, fz + 0.03, 0.9, hh, 0.06, "#2A2F38", "solid", 0);
          b.box(x, y + hh / 2 + 0.2, fz + 0.05, 1.1, 0.4, 0.1, s.stone2, "solid", 0.02);
        }
        b.box(cx, 4.6, fz + 0.35, 4.4, 9.2, 0.7, s.stone2, "solid", 0.02);
        for (let q = 0; q < 6; q++) b.box(cx, 7.9 - q * 0.42, fz + 0.72 + q * 0.05, 2.8 - q * 0.36, 0.42, 0.1, q % 2 ? s.stone : s.stone2, "solid", 0.02);
        b.box(cx, 1.5, fz + 0.73, 1.7, 3.0, 0.08, "#5B3A22", "solid", 0.02);
        // ---- harim kütlesi + çağlayan (yarım kubbeler, ağırlık kuleleri) + kasnak + ana kubbe (tepe = domeTop)
        const mz = (hz + fz) / 2;
        b.box(cx, s.facadeH / 2, mz, fx1 - fx0, s.facadeH, fz - hz - 4, s.stone, "solid", 0.02);
        const hr = s.domeR * 0.92;
        for (const [dx, dz] of (s.halfDomes === 4 ? [[0, 1], [0, -1], [1, 0], [-1, 0]] : [[0, 1], [0, -1]]) as [number, number][]) {
          const hx = cx + dx * s.domeR, hzz = mz + dz * s.domeR;
          b.box(hx, (s.facadeH + s.domeY) / 2, hzz, dx ? 1.2 : 2 * hr, s.domeY - s.facadeH, dz ? 1.2 : 2 * hr, s.stone, "solid", 0.02);
          halfDome(b, hx, s.domeY - 2.2, hzz, hr, hr * 0.62, dx, dz, s.lead);
        }
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const x = cx + sx * s.domeR, z = mz + sz * s.domeR;
          oct(b, x, (s.facadeH + s.domeY + 2.5) / 2, z, 1.0, s.domeY + 2.5 - s.facadeH, s.stone2);
          dome(b, x, s.domeY + 2.5, z, 1.0, 1.0, s.lead, 4);
        }
        oct(b, cx, s.domeY + 0.8, mz, s.domeR * 0.98, 1.6, s.stone);
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          b.box(cx + Math.cos(a) * s.domeR * 0.99, s.domeY + 0.8, mz + Math.sin(a) * s.domeR * 0.99, 0.5, 0.9, 0.5, "#2A2F38", "solid", 0);
        }
        dome(b, cx, s.domeY + 1.6, mz, s.domeR, s.domeTop - s.domeY - 1.6, s.lead, 10);
        // ---- minareler (çiftler)
        for (const m of s.minarets) {
          const front = m.side === "front";
          const zc = m.at === "court" ? (front ? tz(D - 1) : tz(H0) - 0.2) : (front ? fz - 1.2 : hz + 1.2);
          for (const xs of [-1, 1]) minaret(b, m.at === "court" ? (xs < 0 ? tx(0) : tx(W - 1)) : cx + xs * (m.dx ?? s.domeR + 3.4), zc, m.h, m.serefe, s);
        }
        // ---- şadırvan (avlunun ortası): sekizgen havuz, sekiz sütun, saçak, kubbe; 3 × 3 karo eşya (engelli)
        const sj = H0 + 2 + Math.floor((s.court - 6) / 2);
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) b.furn(ci + di, sj + dj);
        const sxw = tx(ci), szw = tz(sj);
        oct(b, sxw, 0.3, szw, 1.35, 0.6, s.stone2);
        oct(b, sxw, 0.58, szw, 1.1, 0.06, "#6FA9C4");
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; b.box(sxw + Math.cos(a) * 1.3, 1.6, szw + Math.sin(a) * 1.3, 0.18, 2.0, 0.18, s.stone); }
        oct(b, sxw, 2.75, szw, 1.75, 0.3, s.stone2);
        dome(b, sxw, 2.9, szw, 1.3, 1.1, s.lead, 5);
        // ---- sekiler: batı/doğu revakta duvar dibinde, avluya bakar
        for (let j = H0 + 5; j <= D - 6; j += 6) { seki(b, 1, j, 1, 0, s.stone2); seki(b, W - 2, j, -1, 0, s.stone2); }
        // ---- çıkış: güney duvarının ortası (avlunun taç kapısı) — portal
        exitAt(b, ci, D - 1, s.stone2);
        // varış avlunun içinde (kapıdan 7 karo): takip kamerası (4,6) avatarın arkasında, cepheye bakar. (INT-SPAWN-AXIS-001):
        // eksenin 3 karo doğusunda — eksende şadırvan köşkü tam avatarın ardına düşüp sütunlar/saçak onu çevreliyor ("köşkün içinde doğdum")
        b.portals[b.portals.length - 1].arrive = [ci + 3, D - 8];
        b.drawWalls(s.wallH, 1, s.stone2);
        b.room(1, H0, W - 2, s.court - 1, "room_courtyard");
        // bakış noktası (F: cepheye bak; dürbün modeli yok — kutsal avlu): şadırvanın doğusu, önü son cemaat revakına dek açık
        return { name: "room_courtyard", outdoor: true, quiet: true, vp: [ci + (s.vpDx ?? 4), sj + (s.vpDj ?? 0)], vpDir: -1 };
      },
    ],
  };
}
/**
 * duvarlı bahçe avlusu (çarbağ bahçesi, havuzlu / narenciye ağaçlı bahçe) — `mosqueCourt` ile aynı yerleşim
 * (arka −z `hall` karosu yapının ayak izi: engelli; önü bahçe; çıkış portalı ön duvarın ortasında, varış cepheye dönük),
 * yapı `body` geri çağrısıyla arka bölgeye çizilir. Merkezde eksen yolu (7 karo), orta bantta çapraz yol; ortada havuz,
 * çarbağda kanal ve çapraz kanal (geçit köprüleri açık). Sessiz bölge; ışık, alem, bayrak, yazı, figür yok.
*/
export interface GardenCourtSpec {
  /** bahçe eni (tek sayı), bahçe derinliği, yapı bölgesi derinliği (karo) */
  w: number; court: number; hall: number;
  wallH: number; gateH: number;
  wall: string; wallCap: string; marble: string; marble2: string; roof: string;
  grass: [string, string]; path: string; water: string;
  tree: "cypress" | "orange";
  channels: boolean; pool: number;
}
export interface GardenCtx { cx: number; fz: number; hz: number; W: number; D: number; H0: number; ci: number }
function gardenCourt(s: GardenCourtSpec, body: (b: LevelBuilder, g: GardenCtx, s: GardenCourtSpec) => void): Recipe {
  const W = s.w, D = s.hall + s.court, H0 = s.hall, ci = (W - 1) >> 1;
  return {
    size: [W, D],
    heights: [s.wallH],
    levels: [
      (b) => {
        b.solidFill(s.wall);
        b.carve(1, H0, W - 2, s.court - 1);
        const k0 = Math.floor(s.court / 6), jc = H0 + 3 * k0; // orta bant (çapraz yol: jc … jc + 2)
        const pathAlt = (() => { const n = parseInt(s.path.slice(1), 16), f = (sft: number) => Math.round(((n >> sft) & 255) * 0.93); return `#${((f(16) << 16) | (f(8) << 8) | f(0)).toString(16).padStart(6, "0")}`; })();
        const seg = (i0: number, i1: number, j: number, dd: number, c: string) => {
          if (i1 >= i0) b.box((tx(i0) + tx(i1)) / 2, -0.5, (tz(j) + tz(j + dd - 1)) / 2, i1 - i0 + 1, 1, dd, c, "solid", 0.02);
        };
        for (let j = H0; j < D - 1; j += 3) {
          const dd = Math.min(3, D - 1 - j), gc = s.grass[((j - H0) / 3) % 2];
          if (j === jc) seg(1, W - 2, j, dd, s.path);
          // yol dönüşümlü iki ton döşeme şeridi (düz bej zemin değil; ek blok yüksekliği yok)
          // havuzdan girişe yol 3 karo (≈ 5 m, gerçek çarbağ yürüyüş yolu); yanında su yolu + çiçek şeridi + çim. Havuzun arkası 7 karo kalır (kanal + iki yürüyüş yolu)
          else {
            const fg = j > jc, pw = fg ? 1 : 3;
            seg(1, ci - pw - 1, j, dd, gc);
            for (let r = 0; r < (fg ? dd : 1); r++) for (let i = ci - pw; i <= ci + pw; i++) seg(i, i, j + r, fg ? 1 : dd, (fg ? i + j + r : i) % 2 ? s.path : pathAlt); // girişe yakın yol: dama döşeme (tek düz bej alan değil)
            seg(ci + pw + 1, W - 2, j, dd, gc);
          }
        }
        // ---- zemin çıplak toprak görünmesin — yol taşı derzleri, yol kenar taşları, çiçek tarhları
        const jointC = "#B8A57E", flowerC = ["#D7263D", "#F2C14E", "#E8E1F0", "#F28C1A"];
        for (const [a, e, i0, i1] of [[H0, jc - 1, ci - 2, ci + 3], [jc + 3, D - 2, ci, ci + 1]] as const) if (e >= a) for (let i = i0; i <= i1; i++)
          b.box(tx(i) - 0.5, 0.012, (tz(a) + tz(e)) / 2, 0.06, 0.024, e - a + 1, jointC, "solid", 0);
        for (let j = H0; j < D - 1; j += 3) if (j !== jc) b.box(tx(ci), 0.012, tz(j) - 0.5, j > jc ? 3 : 7, 0.024, 0.06, jointC, "solid", 0);
        for (const [a, e, pw] of [[H0, jc - 1, 3], [jc + 3, D - 3, 1]] as const) if (e >= a) for (const x of [tx(ci - pw) - 0.5, tx(ci + pw) + 0.5])
          b.box(x, 0.08, (tz(a) + tz(e)) / 2, 0.16, 0.16, e - a + 1, s.marble2, "solid", 0.01);
        for (let j = H0 + 1; j <= D - 4; j += 3) {
          if (j >= jc - 1 && j <= jc + 3) continue;
          for (const i of [ci - 7, ci - 5, ci + 5, ci + 7]) {
            b.box(tx(i), 0.04, tz(j), 0.56, 0.08, 0.56, "#3E7D3A", "solid", 0.01);
            b.box(tx(i), 0.13, tz(j), 0.36, 0.1, 0.36, flowerC[(i + j) % 4], "solid", 0.01);
          }
        }
        const cx = (tx(0) + tx(W - 1)) / 2, fz = tz(H0) - 0.5, hz = tz(0) - 0.5;
        // ---- yapı (arka bölge)
        body(b, { cx, fz, hz, W, D, H0, ci }, s);
        // ---- su: havuz (orta bantta), çarbağda eksen kanalı + çapraz kanal (iki geçit köprüsü açık)
        const jm = jc + 1, ph = (s.pool - 1) >> 1, water = (i0: number, i1: number, j0: number, j1: number) => {
          for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) b.furn(i, j);
          b.box((tx(i0) + tx(i1)) / 2, 0.06, (tz(j0) + tz(j1)) / 2, i1 - i0 + 1, 0.12, j1 - j0 + 1, s.water, "solid", 0.01);
        };
        if (s.channels) {
          water(ci - 1, ci + 1, H0 + 4, jm - ph - 1); water(ci - 1, ci + 1, jm + ph + 1, D - 12);
          for (const [a, c] of [[2, 5], [8, ci - ph - 1], [ci + ph + 1, W - 9], [W - 6, W - 3]]) if (c >= a) water(a, c, jm - 1, jm + 1);
          // girişe doğru yol boyunca iki yan su yolu (varış karesinde ön plan çıplak yol değil)
          // yol 3 karo → su yolu yola bitişik (ci ± 2), yanında çiçek şeridi (ci ± 3)
          if (D - 3 >= jm + ph + 2) for (const sx of [-1, 1]) {
            water(ci + sx * 2, ci + sx * 2, jm + ph + 2, D - 3);
            for (let j = jm + ph + 2; j <= D - 3; j++) { const i = ci + sx * 3; b.box(tx(i), 0.04, tz(j), 0.8, 0.08, 0.8, "#3E7D3A", "solid", 0.01); b.box(tx(i), 0.13, tz(j), 0.6, 0.1, 0.6, flowerC[(i + j) % 4], "solid", 0.01); }
          }
        }
        b.box(cx, 0.12, tz(jm), s.pool + 0.7, 0.24, s.pool + 0.7, s.marble2, "solid", 0.02);
        for (let i = ci - ph; i <= ci + ph; i++) for (let j = jm - ph; j <= jm + ph; j++) b.furn(i, j);
        b.box(cx, 0.115, tz(jm), s.pool - 0.1, 0.23, s.pool - 0.1, s.water, "solid", 0.01);
        b.box(cx, 0.27, tz(jm), 1.1, 0.5, 1.1, s.marble, "solid", 0.02); // havuzun ortasında alçak çeşme tabanı
        // ---- ağaçlar: kanal/yol kenarında servi sıraları ya da yan parterlerde narenciye ızgarası
        const near = (j: number) => j >= jc - 3 && j <= jc + 5;
        const tree = (i: number, j: number) => {
          b.furn(i, j);
          const x = tx(i), z = tz(j);
          if (s.tree === "cypress") {
            b.box(x, 0.5, z, 0.3, 1.0, 0.3, "#5A4632");
            oct(b, x, 1.9, z, 0.62, 2.0, "#2F5A3A"); oct(b, x, 3.4, z, 0.5, 1.6, "#2B5236"); oct(b, x, 4.5, z, 0.32, 1.2, "#274C32");
          } else {
            b.box(x, 0.55, z, 0.22, 1.1, 0.22, "#6A4A32");
            oct(b, x, 1.7, z, 0.95, 1.3, "#4E7A3A"); oct(b, x, 2.45, z, 0.6, 0.5, "#5A8A44");
          }
        };
        if (s.tree === "cypress") { for (let j = H0 + 6; j <= D - 13; j += 4) if (!near(j)) { tree(ci - 6, j); tree(ci + 6, j); } }
        else { for (let j = H0 + 6; j <= D - 9; j += 5) if (!near(j)) for (const i of [4, 8, W - 5, W - 9]) tree(i, j); }
        // ---- sekiler (kenar duvar dibinde, bahçeye bakar)
        for (let j = H0 + 6; j <= D - 8; j += 7) { seki(b, 1, j, 1, 0, s.marble2); seki(b, W - 2, j, -1, 0, s.marble2); }
        // ---- ön kapı (bahçenin girişi): çıkış portalı ön duvarın ortasında, iki yanda yüksek kapı kütlesi + kapı üstü lento
        exitAt(b, ci, D - 1, s.marble2);
        b.portals[b.portals.length - 1].arrive = [ci, D - 8];
        b.drawWalls(s.wallH, 1, s.wallCap);
        for (const sx of [-1, 1]) b.box(tx(ci + sx * 2), s.gateH / 2, tz(D - 1), 3.06, s.gateH, 1.1, s.wall, "solid", 0.03);
        b.box(tx(ci), (DOOR_H + 0.3 + s.gateH) / 2, tz(D - 1), 1.06, s.gateH - DOOR_H - 0.3, 1.1, s.wall, "solid", 0.03);
        b.box(cx, s.gateH + 0.1, tz(D - 1), 7.2, 0.2, 1.3, s.wallCap, "solid", 0.02);
        b.room(1, H0, W - 2, s.court - 1, "room_courtyard");
        return { name: "room_courtyard", outdoor: true, quiet: true, vp: [ci + 3, jc - 3], vpDir: -1 };
      },
    ],
  };
}
/** Simgeye özgü avlular (`<şehir>:<simge>`; taban sahnede `<sahne>:<etiket>`). Ölçüler gerçek metreden (× `CM`). */
export const COURT_RECIPES: Record<string, Recipe> = {
  ...fullCourtRecipes({ gardenCourt, CM }),
  // Sultanahmet: avlu ~ 64 × 72 m, harim ~ 53 × 51 m, kubbe ⌀ 23,4 m / tepe 43 m, altı minare (harim köşelerinde 4 × üç şerefe 64 m,
  // avlu köşelerinde 2 × iki şerefe), revak örtüsü ~ 7 m, avlu duvarı ~ 9 m
  "istanbul:sultanahmet": mosqueCourt({ w: 35, court: 39, hall: 30, wallH: 9 * CM, arcH: 7 * CM, facadeH: 22 * CM, domeR: 11.7 * CM,
    domeY: 30 * CM, domeTop: 43 * CM, halfDomes: 4,
    minarets: [{ at: "hall", side: "back", h: 64 * CM, serefe: 3 }, { at: "hall", side: "front", h: 64 * CM, serefe: 3 }, { at: "court", side: "front", h: 54 * CM, serefe: 2 }],
    stone: "#D8D2C6", stone2: "#C9C1B2", lead: "#7E8A96", paving: ["#E4DFD5", "#D9D3C8"] }),
  // Süleymaniye: avlu ~ 58 × 46 m, harim ~ 58 × 57 m, kubbe ⌀ 26,5 m / tepe 53 m, iki yarım kubbe (kıble ekseni); dört minare avlu
  // köşelerinde (harim yanı 2 × 76 m üç şerefe, ön 2 × 56 m iki şerefe)
  "istanbul:suleymaniye": mosqueCourt({ w: 33, court: 28, hall: 33, wallH: 8.5 * CM, arcH: 7 * CM, facadeH: 24 * CM, domeR: 13.2 * CM,
    domeY: 36 * CM, domeTop: 53 * CM, halfDomes: 2,
    minarets: [{ at: "court", side: "back", h: 76 * CM, serefe: 3 }, { at: "court", side: "front", h: 56 * CM, serefe: 2 }],
    stone: "#DCD5C7", stone2: "#CBC2B1", lead: "#7A8691", paving: ["#E2DDD2", "#D6D0C4"] }),
  // Ayasofya: batı bahçesi ~ 50 m, yapı ~ 73 × 70 m (sığ ana kubbe ⌀ 31 m / tepe 55 m, iki yarım kubbe), dört minare
  // yapının köşelerinde (~ 60 m, tek şerefe); bahçe duvarı ~ 8 m, ortada şadırvan; ibadet iç mekânı kapalı
  "istanbul:ayasofya": mosqueCourt({ w: 41, court: 28, hall: 40, wallH: 8 * CM, arcH: 7 * CM, facadeH: 30 * CM, domeR: 15.5 * CM,
    domeY: 42 * CM, domeTop: 55 * CM, halfDomes: 2,
    minarets: [{ at: "hall", side: "back", h: 60 * CM, serefe: 1, dx: 17.5 }, { at: "hall", side: "front", h: 56 * CM, serefe: 1, dx: 17.5 }],
    stone: "#CDB08C", stone2: "#B98F6D", lead: "#7E8A96", paving: ["#E2DDD2", "#D6D0C4"], vpDx: 0, vpDj: 6 }),
};
/** Avlu tarifi: şehir haritası yeri (`city_<şehir>__<semt>__<simge>`) ya da taban sahne yeri (`<sahne>:<etiket>`). */
function courtRecipeFor(scene: string, site: string): Recipe {
  const cm = CITY_SITE.exec(site);
  return COURT_RECIPES[cm ? `${cm[1]}:${cm[2]}` : `${scene}:${site}`] ?? COURT_RECIPES["istanbul:sultanahmet"];
}

// ------------------------------------------------------------------------------------------ İstanbul şehir haritası iç mekânları
// Landmark kimliğine özgü tarifler (`city_<şehir>__<semt>__<landmark>` yer kimliği; recipeFor). Galata Kulesi `galata` tarifini
// kullanır. Figür, yazı, dinî simge yok; ibadet yeri iç mekânı şehirde de kapalıdır.

/**
 * Açık hava katından görünen deniz ve uzak kıyılar (yalnız görsel; şehir iç mekânında dış şehir çizilmez): katın altında geniş
 * su düzlemi ve dört yönde alçak, sade kıyı siluetleri. `shore`: kat tek kıyıda (sur yolu) — arkada yakın yamaç.
 */
export function seaView(b: LevelBuilder, y: number, size: number, shore = false) {
  const cx = (tx(0) + tx(b.w - 1)) / 2, cz = (tz(0) + tz(b.d - 1)) / 2, far = size / 2;
  b.box(cx, y, cz, size, 0.1, size, "#2F7EA8", "water", 0.02);
  const SIL = ["#9DB0C2", "#A8B9C8", "#92A6B8", "#B5C2CE"];
  for (let k = 0; k < 4; k++) {
    const along = k % 2 === 0, s = k < 2 ? -1 : 1;
    for (let q = -2; q <= 2; q++) {
      const h = 1.2 + ((q + 3) * (k + 2)) % 4 * 0.6;
      const x = along ? cx + q * 9 : cx + s * far, z = along ? cz + s * far : cz + q * 9;
      b.box(x, y + h / 2, z, along ? 8 : 2, h, along ? 2 : 8, SIL[(q + 2 + k) % SIL.length], "solid", 0.02);
    }
  }
  if (shore) b.box(cx - far * 0.45, y + 1.2, cz, far * 0.6, 2.4, size * 0.9, "#7C9F5A", "solid", 0.04);
}

/** Yerebatan Sarnıcı: sütunlu yer altı salonu (salon kamerası), sığ su, ahşap yürüme yolları ve korkuluk, taban ışıkları. */
const CISTERN_H = 2.6;
const cistern: Recipe = {
  size: [23, 13],
  heights: [CISTERN_H],
  levels: [
    (b) => {
      b.solidFill("#6E6253");
      b.carve(1, 1, 21, 11);
      const walk = (i: number, j: number) => j === 6 || i === 4 || i === 11 || i === 18;
      for (let j = 1; j <= 11; j++) {
        let run = -1;
        for (let i = 1; i <= 22; i++) {
          const w = i <= 21 && walk(i, j);
          if (i <= 21 && w) b.floorTile(i, j, (i + j) % 2 ? "#7A5A40" : "#6E5139");
          if (i <= 21 && !w) {
            b.furn(i, j);
            b.box(tx(i), -0.75, tz(j), 1, 0.5, 1, "#2B2622", "solid", 0.02);
            if (run < 0) run = i;
          }
          if ((i > 21 || w) && run >= 0) {
            const n = i - run;
            b.box((tx(run) + tx(i - 1)) / 2, -0.17, tz(j), n, 0.1, 1, "#2F6F7E", "water", 0.03);
            run = -1;
          }
        }
      }
      // sütunlar (çift karolarda; yürüme yolunda değil), başlıklar, taban ışıkları; bir sütun "gözyaşı" desenli
      let n = 0;
      for (let j = 2; j <= 10; j += 2) for (let i = 2; i <= 20; i += 2) {
        if (walk(i, j)) continue;
        const tear = i === 14 && j === 8;
        b.box(tx(i), CISTERN_H / 2 - 0.2, tz(j), 0.42, CISTERN_H + 0.4, 0.42, tear ? "#7E8A7A" : n % 3 ? "#B9A88E" : "#A8977C", "solid", 0.03);
        b.box(tx(i), CISTERN_H - 0.14, tz(j), 0.62, 0.22, 0.62, "#C9BBA2", "solid", 0.02);
        if (tear) for (let k = 0; k < 4; k++) b.box(tx(i), 0.4 + k * 0.5, tz(j) + 0.22, 0.12, 0.12, 0.03, "#5E6B5E");
        if (n % 3 === 0) b.box(tx(i) + 0.26, -0.08, tz(j), 0.12, 0.1, 0.12, "#FFB65C", "glow", 0);
        n++;
      }
      // yürüme yolu korkuluğu (suya bakan kenarlar)
      for (let j = 1; j <= 11; j++) for (let i = 1; i <= 21; i++) {
        if (!walk(i, j)) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ni = i + di, nj = j + dj;
          if (ni < 1 || nj < 1 || ni > 21 || nj > 11 || walk(ni, nj)) continue;
          b.box(tx(i) + di * 0.46, RAIL_H, tz(j) + dj * 0.46, di ? 0.05 : 1, 0.05, dj ? 0.05 : 1, "#3A2E26", "solid", 0);
        }
      }
      exitAt(b, 11, 12, "#9C8A6A");
      // çevre duvarları (tam boy; su karoları mobilya sayıldığından elle)
      for (let i = 0; i < b.w; i++) for (const j of [0, b.d - 1]) if (!(i === 11 && j === b.d - 1)) b.box(tx(i), CISTERN_H / 2, tz(j), 1, CISTERN_H, 1, b.fillColor, "solid", 0.04);
      for (let j = 1; j < b.d - 1; j++) for (const i of [0, b.w - 1]) b.box(tx(i), CISTERN_H / 2, tz(j), 1, CISTERN_H, 1, b.fillColor, "solid", 0.04);
      // kapı üstü (lento → tavan) duvar, karonun dış yarısında (drawWalls ile aynı) — elle çizilen çevre duvarı kapı karosunu
      // atlıyordu; içeriden kapının üstünden dışarının kara boşluğu görünüyordu
      b.box(tx(11), (DOOR_H + 0.1 + CISTERN_H) / 2, tz(b.d - 1) + 0.275, 1, CISTERN_H - DOOR_H - 0.1, 0.45, b.fillColor, "solid", 0.04);
      b.light(4, 6, "#FFB65C", 1.3, CISTERN_H - 0.3, 10); b.light(11, 3, "#FFC67A", 1.2, CISTERN_H - 0.3, 10); b.light(18, 8, "#FFB65C", 1.3, CISTERN_H - 0.3, 10);
      b.room(1, 1, 21, 11, "room_cistern");
      // ana yoldaki "gözyaşı" sütununun karşısında bilgi levhası (sergi karosu (14, 6); F: Yerebatan kartı) — eskiden salonda yalnız Çıkış vardı
      b.box(tx(14), 0.5, tz(6) + 0.34, 0.5, 0.3, 0.05, "#C9A24A", "solid", 0.01);
      b.box(tx(14), 0.25, tz(6) + 0.34, 0.06, 0.5, 0.06, "#3A2E26", "solid", 0);
      b.light(14, 6, "#FFC67A", 1.1, CISTERN_H - 0.6, 6);
      return { name: "room_cistern", outdoor: false, exhibit: [14, 6] };
    },
  ],
};

/** Kapalıçarşı: bir ana cadde ve üç ara sokak; duvar yüzlerinde renkli dükkân mallar ve tenteler, asma fenerler. */
const BAZAAR_H = 2.4;
const bazaar: Recipe = {
  size: [25, 13],
  heights: [BAZAAR_H],
  levels: [
    (b) => {
      b.solidFill("#B9A27E");
      const streets: [number, number, number, number][] = [[1, 5, 23, 3], [5, 1, 2, 11], [12, 1, 2, 11], [19, 1, 2, 11]];
      for (const [i0, j0, w, d] of streets) { b.carve(i0, j0, w, d); b.floor(i0, j0, w, d, "#CDBB9C", "#C2AF8E"); }
      b.room(1, 1, 23, 11, "room_bazaar");
      exitAt(b, 12, 12, "#D2C2A3");
      const GOODS = ["#C2410C", "#D97706", "#A16207", "#7C2D12", "#65A30D", "#B91C1C", "#0E7490", "#7E22CE", "#E9D8A6"];
      let k = 0;
      for (let j = 1; j <= 11; j++) for (let i = 1; i <= 23; i++) {
        if (b.isBlocked(i, j)) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ni = i + di, nj = j + dj;
          if (!b.isBlocked(ni, nj) || (ni === 12 && nj === 12) || (i + j + di * 3 + dj * 5) % 2) continue;
          const x = tx(i) + di * 0.38, z = tz(j) + dj * 0.38, along = dj !== 0;
          b.box(x, 0.32, z, along ? 0.8 : 0.24, 0.64, along ? 0.24 : 0.8, "#6B4A2F");
          for (let q = 0; q < 3; q++) b.box(x + (along ? -0.26 + q * 0.26 : 0), 0.72, z + (along ? 0 : -0.26 + q * 0.26), 0.2, 0.16, 0.2, GOODS[(k + q) % GOODS.length], "solid", 0.06);
          b.box(tx(i) + di * 0.44, 1.55, tz(j) + dj * 0.44, along ? 0.9 : 0.14, 0.06, along ? 0.14 : 0.9, GOODS[k % GOODS.length], "solid", 0.02);
          k++;
        }
      }
      for (const i of [3, 9, 16, 22]) hangingLamp(b, i, 6, ["#FFB86B", "#7FD1C7", "#F28FAD", "#FFD27A"][i % 4]);
      b.light(6, 6, "#FFD9A0", 1.5, BAZAAR_H - 0.2, 10); b.light(13, 6, "#FFC67A", 1.5, BAZAAR_H - 0.2, 10); b.light(20, 6, "#FFD9A0", 1.5, BAZAAR_H - 0.2, 10);
      b.drawWalls();
      return { name: "room_bazaar", outdoor: false };
    },
  ],
};

/** Galata Köprüsü alt katı: suya bakan pencereli uzun yürüyüş yolu, lokanta masaları ve tezgâhlar. */
const lowerDeck: Recipe = {
  size: [25, 7],
  levels: [
    (b) => {
      const [r] = rowLevel(b, [{ w: 23, d: 5, name: "room_lower_deck", floor: PAL.deck }], { wall: "#8E98A1", exit: 0 });
      for (let i = r.i0 + 1; i < r.i0 + r.w - 1; i += 2) windowAt(b, i, 0, 0, 1);
      for (let i = r.i0 + 1; i < r.i0 + r.w - 1; i += 3) if (Math.abs(i - 12) > 1) table(b, i, r.j0 + 1, "#E5E7EB");
      counter(b, r.i0, r.j0 + 3, 2, "#3F6E74", "#E7DFC9"); counter(b, r.i0 + r.w - 2, r.j0 + 3, 2, "#C8553D", "#E7DFC9");
      bench(b, r.i0 + 5, r.j0 + 1, "#A47148"); bench(b, r.i0 + 17, r.j0 + 1, "#A47148");
      for (const i of [5, 12, 19]) hangingLamp(b, i, 3, "#FFD27A");
      b.light(6, 3, "#FFE2B0", 1.4); b.light(12, 3, "#FFE2B0", 1.4); b.light(18, 3, "#FFE2B0", 1.4);
      b.drawWalls();
      return { name: "room_lower_deck", outdoor: false };
    },
  ],
};

/** Kız Kulesi: ada kafesi (zemin) + kule terası (açık hava; fener odası, dürbün). */
const maiden: Recipe = {
  size: [11, 11],
  heights: [TOWER_H, TOWER_H],
  levels: [
    (b, ctx) => {
      b.solidFill("#D8CFC0");
      b.carve(2, 2, 7, 7); b.floor(2, 2, 7, 7, PAL.marble.floor[0], PAL.marble.floor[1]);
      exitAt(b, 5, 9, "#CBBFA8");
      stairUp(b, CLOCK_A.tiles, CLOCK_A.foot);
      counter(b, 5, 2, 3, "#5B4636", "#E7DFC9");
      table(b, 5, 5, "#E5E7EB"); table(b, 7, 5, "#E5E7EB"); table(b, 7, 7, "#E5E7EB");
      plant(b, 8, 2); panel(b, 9, 5, ctx.art(), -1, 0);
      staffAt(b, 5, 2, 3, -1, "#3E5A7A", 1); guestAt(b, 6, 3, Math.PI, 2); seatGuest(b, 5, 6, Math.PI, 3); seatGuest(b, 7, 6, Math.PI, 4); // kafe görevlisi + konuklar
      windowAt(b, 9, 7, -1, 0, true); windowAt(b, 4, 1, 0, 1, true);
      b.light(5, 5, "#FFD9A0", 1.5); b.light(7, 7, "#FFE2B0", 1.3);
      b.drawWalls(b.h, 2);
      b.room(2, 2, 7, 7, "room_cafe");
      return { name: "room_cafe", outdoor: false, arrive: { tile: [3, 6], heading: -Math.PI / 2 } }; // doğuş asansör kapısının yanında
    },
    (b, ctx) => {
      b.solidFill("#D8CFC0");
      b.carve(1, 1, 9, 9); b.floor(1, 1, 9, 9, PAL.stone.floor[0], PAL.stone.floor[1]);
      stairHole(b, ctx.below!);
      for (let i = 4; i <= 6; i++) for (let j = 4; j <= 6; j++) b.furn(i, j);
      b.box(tx(5), 0.6, tz(5), 2.6, 1.2, 2.6, "#EFE7DA");
      b.box(tx(5), 1.7, tz(5), 1.6, 1.0, 1.6, "#CFE6F0", "glass", 0);
      b.box(tx(5), 1.7, tz(5), 0.5, 0.5, 0.5, "#FFE7A3", "glow", 0);
      for (let k = 0; k < 3; k++) b.box(tx(5), 2.35 + k * 0.3, tz(5), 1.8 - k * 0.55, 0.3, 1.8 - k * 0.55, "#7F8A94");
      edgeRail(b, "#3A3F47", undefined, true);
      binocular(b, 5, 9, 1);
      seaView(b, -8.2, 70);
      b.room(1, 1, 9, 9, "room_tower_top");
      return { name: "room_tower_top", outdoor: true, vp: [5, 9], vpDir: 1 }; // dürbün F ile bakar (eskiden seyir noktası yoktu)
    },
  ],
};

/** Topkapı avluları: Alay Meydanı (çınarlar) → Babüsselam'ın ikiz kuleli kapısı → Divan Meydanı (Divan, Adalet Kulesi). */
const COURT_H = 2.4;
const courtyards: Recipe = {
  size: [27, 13],
  heights: [COURT_H],
  levels: [
    (b) => {
      b.solidFill("#D8CDB6");
      b.carve(1, 1, 25, 11); b.floor(1, 1, 25, 11, "#86AD62", "#7FA65A");
      for (let i = 1; i <= 25; i++) b.box(tx(i), 0.012, tz(6), 1, 0.02, 1.2, "#CFC3AE", "solid", 0);
      for (let j = 7; j <= 11; j++) b.box(tx(6), 0.012, tz(j), 1.2, 0.02, 1, "#CFC3AE", "solid", 0);
      // Babüsselam duvarı (i 13; kapı aralığı j 5–7) ve sekizgen ikiz kuleler
      for (let j = 1; j <= 11; j++) if (j < 5 || j > 7) b.block(13, j);
      for (const j of [4, 8]) {
        b.box(tx(13), 2.0, tz(j), 1.3, 4.0, 1.3, "#EEE6D6"); b.box(tx(13), 2.0, tz(j), 0.9, 4.0, 1.5, "#EEE6D6");
        for (let k = 0; k < 3; k++) b.box(tx(13), 4.25 + k * 0.5, tz(j), 1.1 - k * 0.32, 0.5, 1.1 - k * 0.32, "#7F8A94");
      }
      b.box(tx(13), COURT_H + 0.25, tz(6), 1.2, 0.5, 3.2, "#7F8A94");
      // çınarlar (Alay Meydanı), Divan ve Adalet Kulesi (Divan Meydanı)
      for (const [i, j] of [[3, 3], [9, 3], [3, 9], [9, 9], [16, 9], [23, 9]] as Tile[]) {
        b.furn(i, j);
        b.box(tx(i), 0.7, tz(j), 0.3, 1.4, 0.3, "#6B4A2E"); b.box(tx(i), 1.9, tz(j), 1.7, 1.1, 1.7, "#4F7F3A", "solid", 0.1);
      }
      for (let i = 17; i <= 22; i++) for (let j = 1; j <= 2; j++) b.furn(i, j);
      b.box((tx(17) + tx(21)) / 2, 1.1, (tz(1) + tz(2)) / 2, 5, 2.2, 2, "#EEE6D6");
      b.box((tx(17) + tx(21)) / 2, 2.35, (tz(1) + tz(2)) / 2, 5.6, 0.3, 2.6, "#7F8A94");
      b.box(tx(22), 3.4, (tz(1) + tz(2)) / 2, 1.2, 6.8, 1.2, "#D8CDB6");
      for (let k = 0; k < 3; k++) b.box(tx(22), 7.0 + k * 0.5, (tz(1) + tz(2)) / 2, 1.3 - k * 0.4, 0.5, 1.3 - k * 0.4, "#7F8A94");
      exitAt(b, 6, 12, "#D8CDB6");
      b.drawWalls(COURT_H);
      b.room(1, 1, 12, 11, "room_first_court"); b.room(14, 1, 12, 11, "room_second_court");
      return { name: "room_first_court", outdoor: true };
    },
  ],
};

/** Rumeli Hisarı: iç avlu (zemin; amfi basamakları, çınarlar) → merdiven → surların üstünde yürünür sur yolu (mazgallar). */
const KEEP_A = { tiles: [[3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [10, 2]] as Tile[], foot: [2, 2] as Tile };
const ramparts: Recipe = {
  size: [21, 15],
  heights: [COURT_H, STOREY],
  levels: [
    (b) => {
      b.solidFill("#C4B59A");
      b.carve(1, 1, 19, 13); b.floor(1, 1, 19, 13, "#86AD62", "#7FA65A");
      exitAt(b, 10, 14, "#A89A80");
      stairUp(b, KEEP_A.tiles, KEEP_A.foot, COURT_H, ["#B9AC94", "#A89A80"]);
      for (let i = 13; i <= 17; i++) for (let j = 9; j <= 11; j++) { b.furn(i, j); b.box(tx(i), 0.15 + (j - 9) * 0.18, tz(j), 1, 0.3 + (j - 9) * 0.36, 1, "#B9AC94", "solid", 0.04); }
      for (const [i, j] of [[4, 8], [7, 11], [16, 4]] as Tile[]) {
        b.furn(i, j); b.box(tx(i), 0.7, tz(j), 0.3, 1.4, 0.3, "#6B4A2E"); b.box(tx(i), 1.9, tz(j), 1.7, 1.1, 1.7, "#4F7F3A", "solid", 0.1);
      }
      b.drawWalls(COURT_H);
      b.room(1, 1, 19, 13, "room_bailey");
      return { name: "room_bailey", outdoor: true };
    },
    (b, ctx) => {
      b.solidFill("#C4B59A");
      for (const [i0, j0, w, d] of [[1, 1, 19, 2], [1, 12, 19, 2], [1, 1, 2, 13], [18, 1, 2, 13]] as const) { b.carve(i0, j0, w, d); b.floor(i0, j0, w, d, "#B9AC94", "#A99D88"); }
      stairHole(b, ctx.below!, ["#B9AC94", "#A89A80"]);
      // dış kenar mazgalları (her iki karoda bir), köşe kulelerinin tepeleri (ızgaranın dışında), aşağıda avlu
      for (let i = 1; i <= 19; i += 2) for (const [j, s] of [[1, -1], [13, 1]] as const) b.box(tx(i), 0.45, tz(j) + s * 0.4, 0.6, 0.9, 0.2, "#B0A288");
      for (let j = 3; j <= 11; j += 2) for (const [i, s] of [[1, -1], [19, 1]] as const) b.box(tx(i) + s * 0.4, 0.45, tz(j), 0.2, 0.9, 0.6, "#B0A288");
      for (const [x, z] of [[tx(0) - 0.6, tz(0) - 0.6], [tx(20) + 0.6, tz(0) - 0.6], [tx(0) - 0.6, tz(14) + 0.6], [tx(20) + 0.6, tz(14) + 0.6]]) {
        b.box(x, 0.6, z, 2.6, 1.2, 2.6, "#C4B59A");
        for (let k = 0; k < 3; k++) b.box(x, 1.45 + k * 0.5, z, 2.4 - k * 0.75, 0.5, 2.4 - k * 0.75, "#6E7A86");
      }
      b.box((tx(3) + tx(17)) / 2, -COURT_H - 0.05, (tz(3) + tz(11)) / 2, 15, 0.1, 9, "#7FA65A");
      seaView(b, -COURT_H - 0.6, 80, true);
      edgeRail(b, "#5B5246");
      binocular(b, 10, 13, 1);
      b.room(1, 1, 19, 13, "room_ramparts");
      return { name: "room_ramparts", outdoor: true };
    },
  ],
};

// ------------------------------------------------------------------------------------------ Kapadokya ve <city> şehir iç mekânları
// Figür, yazı, logo, marka, dinî simge yok; şapel/kilise iç mekânı konmadı (kaya kiliseleri dışarıdan; iç kapalı).

const TUFF_WALL = "#B88A62", TUFF_FLOOR: [string, string] = ["#C9A27C", "#BC946E"], SOOT = "#3A2E26";
/** Kaya duvarına oyulmuş niş (duvar karosunun oda yüzünde karanlık oyuk); yüz yönü (fx, fz) duvardan odaya. */
export function niche(b: LevelBuilder, i: number, j: number, fx = 0, fz = 1, y = 0.75) {
  const x = tx(i) + fx * 0.51, z = tz(j) + fz * 0.51, along = fz !== 0;
  b.box(x, y, z, along ? 0.5 : 0.04, 0.45, along ? 0.04 : 0.5, "#4A3A2E");
  b.box(x, y - 0.25, z, along ? 0.6 : 0.06, 0.05, along ? 0.06 : 0.6, "#D9B894");
}
/** Kandil (duvar dibinde küçük alev; parıltı). */
export function oilLamp(b: LevelBuilder, i: number, j: number, fx = 0, fz = 1) {
  const x = tx(i) + fx * 0.42, z = tz(j) + fz * 0.42;
  b.box(x, 0.95, z, 0.16, 0.06, 0.16, "#8E5A3A"); b.box(x, 1.03, z, 0.07, 0.1, 0.07, "#FFB65C", "glow");
  // CORE-CITYMAP (REAL-SUPPORT): kandil ayaklı sehpada (duvar her yerde kandilin arkasında değil; havada durmaz)
  b.box(x, 0.46, z, 0.05, 0.92, 0.05, "#5B4636"); b.box(x, 0.02, z, 0.22, 0.04, 0.22, "#5B4636");
}
/** Küp/testi (kil): depo ve atölye. */
export function jar(b: LevelBuilder, i: number, j: number, c = "#B5562F") {
  b.box(tx(i), 0.28, tz(j), 0.46, 0.56, 0.46, c); b.box(tx(i), 0.62, tz(j), 0.3, 0.14, 0.3, c); b.box(tx(i), 0.74, tz(j), 0.16, 0.12, 0.16, "#8E3B22");
  b.furn(i, j);
}
/** Ayakla dönen çömlek çarkı: oturak, gövde, tabla ve üstünde biçimlenen çamur. */
function wheel(b: LevelBuilder, i: number, j: number) {
  b.box(tx(i), 0.22, tz(j), 0.7, 0.44, 0.7, "#7A5233"); b.box(tx(i), 0.47, tz(j), 0.5, 0.06, 0.5, "#9C7A55");
  b.box(tx(i), 0.6, tz(j), 0.24, 0.2, 0.24, "#B5562F"); b.box(tx(i) - 0.42, 0.25, tz(j), 0.16, 0.5, 0.4, "#6B4A2E");
  b.furn(i, j);
}
/** Kilim (yerde, renk kuşaklı; soyut desen). */
export function kilimRug(b: LevelBuilder, i0: number, j0: number, w: number, d: number) {
  const C = ["#B9574A", "#F2E6D0", "#2F4A6E", "#D9A441"];
  for (let k = 0; k < d * 2; k++) b.box(tx(i0) + (w - 1) / 2, 0.012, tz(j0) - 0.25 + k * 0.5, w - 0.2, 0.02, 0.48, C[k % C.length], "solid", 0);
}

/** Uçhisar kaya kalesi: oyma odalar (kandil, niş, güvercinlik) → kaya merdiveni → üst oyma odalar → zirve terası (seyir). */
// kat yüksekliği TOWER_H → 8 basamaklı kollar (yükseliş 0,3)
const ROCK_A = { tiles: [[11, 1], [12, 1], [13, 1], [14, 1], [15, 1], [16, 1], [17, 1], [18, 1]] as Tile[], foot: [10, 1] as Tile };
const ROCK_B = { tiles: [[16, 6], [15, 6], [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6]] as Tile[], foot: [16, 5] as Tile }; // [17..18, 6] açık: alt sıra bağlı
function valleyView(b: LevelBuilder, y: number) {
  // aşağıda vadi: kuru toprak düzlüğü, peri bacası silüetleri, uzakta balonlar (yalnız görsel)
  const cx = (tx(0) + tx(b.w - 1)) / 2, cz = (tz(0) + tz(b.d - 1)) / 2;
  b.box(cx, y, cz, 70, 0.1, 70, "#CDB08C", "solid", 0.02);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2, r = 12 + (k % 4) * 5, h = 2.4 + (k % 3) * 1.2;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    b.box(x, y + h / 2, z, 1.2, h, 1.2, k % 2 ? "#E6CCA6" : "#D9A18C"); b.box(x, y + h + 0.15, z, 1.0, 0.3, 1.0, "#6E5A4C");
  }
  for (const [dx, dz, c] of [[-10, 18, "#D9573B"], [14, 24, "#2F6D8C"], [4, -22, "#F2C14E"]] as const) {
    b.box(cx + dx, y + 9, cz + dz, 2.4, 2.6, 2.4, c); b.box(cx + dx, y + 7.2, cz + dz, 0.6, 0.5, 0.6, "#8B5A2B");
  }
}
/** (boş oda sınıfı): kaya merdiveni odası — asansörlü planda boşalan basamak yeri küp/çuval/masa/bank ile donatılır (kuyu önü, ayak karosu ve oda arası geçit açık).*/
function rockStairRoom(b: LevelBuilder, s: LevelRoom, runs: { tiles: Tile[]; foot: Tile }[]) {
  const keep = new Set<string>();
  for (const r of runs) for (const t of [r.tiles[0], r.tiles[1], r.foot]) for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) keep.add(`${t[0] + di},${t[1] + dj}`);
  const put: [number, number, "sacks" | "jar" | "table" | "bench"][] = [[s.i0 + s.w - 1, s.j0 + s.d - 1, "sacks"], [s.i0 + s.w - 1, s.j0 + 4, "jar"], [s.i0 + 3, s.j0 + 4, "table"],
    [s.i0 + 1, s.j0 + s.d - 1, "jar"], [s.i0 + s.w - 1, s.j0 + 2, "sacks"], [s.i0 + 1, s.j0 + 5, "bench"]];
  for (const [i, j, k] of put) {
    if (keep.has(`${i},${j}`) || !b.free(i, j)) continue;
    if (k === "sacks") sacks(b, i, j); else if (k === "jar") jar(b, i, j); else if (k === "table") table(b, i, j, "#7A5233"); else bench(b, i, j, "#8E6A48");
  }
}
const rockCastle: Recipe = {
  size: [19, 9],
  heights: [TOWER_H, TOWER_H, TOWER_H],
  levels: [
    (b, ctx) => {
      const [h, d, s] = rowLevel(b, [
        { w: 5, d: 7, name: "room_rock_hall", floor: TUFF_FLOOR },
        { w: 4, d: 7, name: "room_dovecote", floor: TUFF_FLOOR },
        { w: 7, d: 7, name: "room_rock_stair", floor: TUFF_FLOOR },
      ], { wall: TUFF_WALL, exit: 0 });
      stairUp(b, ROCK_A.tiles, ROCK_A.foot, b.h, ["#B88A62", "#A97C56"]);
      niche(b, h.i0 + 1, 0); niche(b, h.i0 + 3, 0); oilLamp(b, h.i0, h.j0 + 2, -1, 0);
      bench(b, h.i0 + h.w - 1, h.j0 + 4, "#8E6A48"); table(b, h.i0 + 2, h.j0 + 3, "#7A5233");
      // güvercinlik: arka duvar yüzünde sıra sıra küçük yuva oyukları, beyaz çerçeveler
      for (let q = 0; q < 4; q++) for (const y of [0.6, 1.0, 1.4]) b.box(tx(d.i0) + q * 0.9 - 0.2, y, tz(0) + 0.53, 0.2, 0.2, 0.04, q % 2 ? "#4A3A2E" : "#F2E6D0");
      sacks(b, d.i0 + d.w - 1, d.j0 + d.d - 1); jar(b, d.i0, d.j0 + d.d - 1);
      // (boş oda sınıfı): kaya salonu ve güvercinlik donatılır
      jar(b, h.i0 + h.w - 1, h.j0); sacks(b, h.i0, h.j0 + 5); table(b, d.i0 + 2, d.j0 + 4, "#7A5233"); jar(b, d.i0 + 1, d.j0);
      rockStairRoom(b, s, [ROCK_A]);
      panel(b, s.i0 - 1, 6, ctx.art(), 1, 0); // CITY-PASS-KAP: batı duvarında (eskiden seviye dışındaki doğu karosunda havadaydı)
      b.light(h.i0 + 2, h.j0 + 3, "#FFB65C", 1.4); b.light(s.i0 + 3, s.j0 + 4, "#FFC67A", 1.4);
      b.drawWalls(b.h, 2);
      return { name: "room_rock_hall", outdoor: false, exhibit: [h.i0 + 2, h.j0 + 3] }; // salon masası sergi (F: bilgi kartı)
    },
    (b, ctx) => {
      const [h, d2, s] = rowLevel(b, [
        { w: 5, d: 7, name: "room_carved_rooms", floor: TUFF_FLOOR },
        { w: 4, d: 7, name: "room_carved_rooms", floor: TUFF_FLOOR },
        { w: 7, d: 7, name: "room_rock_stair", floor: TUFF_FLOOR },
      ], { wall: TUFF_WALL });
      stairHole(b, ctx.below!, ["#B88A62", "#A97C56"]);
      stairUp(b, ROCK_B.tiles, ROCK_B.foot, b.h, ["#B88A62", "#A97C56"]);
      for (const i of [h.i0, h.i0 + 2, h.i0 + 4]) niche(b, i, 0);
      kilimRug(b, h.i0 + 1, h.j0 + 3, 3, 2);
      // (boş oda sınıfı): oyma odalara küp, çuval, masa ve bank
      jar(b, h.i0 + h.w - 1, h.j0); sacks(b, h.i0, h.j0 + 6); table(b, h.i0 + 3, h.j0 + 5, "#7A5233"); bench(b, d2.i0 + 2, d2.j0 + 5, "#8E6A48"); jar(b, d2.i0 + d2.w - 1, d2.j0); sacks(b, d2.i0, d2.j0 + 6);
      oilLamp(b, s.i0, s.j0 + 3, -1, 0);
      rockStairRoom(b, s, [ROCK_A, ROCK_B]);
      b.light(h.i0 + 2, h.j0 + 2, "#FFB65C", 1.3); b.light(s.i0 + 2, s.j0 + 3, "#FFC67A", 1.3);
      b.drawWalls(b.h, 2);
      return { name: "room_carved_rooms", outdoor: false };
    },
    (b, ctx) => {
      openRoof(b, ["#D9B894", "#CDAA86"], "room_castle_summit", ctx.below, true);
      bench(b, 3, 3, "#8E6A48"); bench(b, 4, 3, "#8E6A48");
      valleyView(b, -2 * TOWER_H - 6);
      const vp: Tile = [Math.floor(b.w / 2), b.d - 1];
      binocular(b, vp[0], vp[1], 1);
      return { name: "room_castle_summit", outdoor: true, vp, vpDir: 1 };
    },
  ],
};

/**
 * Yer altı şehri (descend): giriş katı (ahır, sürgü taşı) → uzun rampa ile aşağı mutfak ve depolar (isli tavan, şarap işliği,
 * küpler) → basamaklarla en alt kat toplantı salonu, havalandırma bacası ışığı ve kuyu. Katlar girişten aşağı sıralıdır.
 */
const UG_H = INDOOR_H;
/** L1 → L0 rampası (L1'de kurulur; +i yönünde yükselir, 8 karo, 0,25) ve L2 → L1 basamakları (L2'de; −i yönünde). */
const UG_RAMP = { tiles: [[12, 9], [13, 9], [14, 9], [15, 9], [16, 9], [17, 9], [18, 9], [19, 9]] as Tile[], foot: [11, 9] as Tile };
const UG_STEPS = { tiles: [[8, 3], [7, 3], [6, 3], [5, 3], [4, 3], [3, 3], [2, 3], [1, 3]] as Tile[], foot: [9, 3] as Tile };
function rollingStone(b: LevelBuilder, i: number, j: number) {
  b.box(tx(i), 0.75, tz(j), 0.34, 1.5, 1.5, "#A8977C"); b.box(tx(i), 0.75, tz(j), 0.36, 1.1, 1.1, "#9C8A6E"); b.box(tx(i), 0.75, tz(j), 0.38, 0.4, 0.4, "#6E6253");
  b.furn(i, j);
}
const undergroundCity: Recipe = {
  size: [21, 13],
  heights: [UG_H, UG_H, UG_H],
  descend: true,
  levels: [
    // 0: giriş katı (en üst)
    (b, ctx) => {
      b.solidFill(TUFF_WALL);
      for (const [i0, j0, w, d] of [[9, 8, 3, 4], [2, 2, 7, 6], [9, 2, 3, 3], [12, 2, 8, 9], [10, 5, 1, 3]] as const) { b.carve(i0, j0, w, d); b.floor(i0, j0, w, d, TUFF_FLOOR[0], TUFF_FLOOR[1]); }
      exitAt(b, 10, 12, "#9C7E62");
      stairHole(b, ctx.below!, ["#BC946E", "#BC946E"]);
      rollingStone(b, 11, 3);
      // ahır: yemlikler (oyma taş), halka bağları
      counter(b, 2, 2, 4, "#A8977C", "#8E7A63");
      // CITY-PASS-KAP: duvardaki bağlama halkaları kaldırıldı (duvar yüzünden ayrık, havadaydı)
      niche(b, 12, 1); niche(b, 15, 1); niche(b, 18, 1); oilLamp(b, 19, 5, 1, 0);
      jar(b, 19, 2); jar(b, 18, 2);
      b.room(2, 2, 7, 6, "room_ug_stable"); b.room(12, 2, 8, 9, "room_ug_entry");
      b.light(10, 9, "#FFB65C", 1.3, UG_H - 0.2, 8); b.light(5, 4, "#FFB65C", 1.2, UG_H - 0.2, 8); b.light(15, 5, "#FFC67A", 1.2, UG_H - 0.2, 8);
      b.drawWalls(UG_H, 1);
      return { name: "room_ug_entry", outdoor: false };
    },
    // 1: mutfak ve depolar (orta)
    (b, ctx) => {
      b.solidFill("#A87E58");
      for (const [i0, j0, w, d] of [[1, 2, 9, 6], [10, 5, 1, 1], [11, 2, 9, 9]] as const) { b.carve(i0, j0, w, d); b.floor(i0, j0, w, d, TUFF_FLOOR[0], TUFF_FLOOR[1]); }
      stairHole(b, ctx.below!, ["#B88A62", "#A97C56"]);
      stairUp(b, UG_RAMP.tiles, UG_RAMP.foot, UG_H, ["#BC946E", "#BC946E"]);
      // mutfak: isli tavan lekesi, ocak çukuru; depo: küpler; şarap işliği (oyma havuz)
      b.box(tx(5), 1.45, tz(1) + 0.52, 3, 0.9, 0.04, SOOT); // CITY-PASS-KAP: is lekesi arka duvarda (tavansız odada havadaydı)
      b.furn(5, 6); b.box(tx(5), 0.2, tz(6), 0.9, 0.4, 0.9, "#6E5A4C"); b.box(tx(5), 0.42, tz(6), 0.4, 0.05, 0.4, "#FF8C42", "glow");
      for (const i of [7, 8, 9]) jar(b, i, 7);
      for (const j of [5, 6]) jar(b, 1, j);
      for (let i = 13; i <= 16; i++) for (let j = 3; j <= 4; j++) b.furn(i, j);
      b.box((tx(13) + tx(16)) / 2, 0.3, (tz(3) + tz(4)) / 2, 3.8, 0.6, 1.8, "#9C7E62");
      b.box((tx(13) + tx(16)) / 2, 0.58, (tz(3) + tz(4)) / 2, 3.4, 0.04, 1.4, "#5B2333");
      for (const i of [18, 19]) jar(b, i, 3);
      niche(b, 12, 1); niche(b, 6, 1); oilLamp(b, 9, 5, 0, -1);
      b.room(1, 2, 9, 6, "room_ug_kitchen"); b.room(11, 2, 9, 9, "room_ug_storage");
      b.light(5, 4, "#FFB65C", 1.3, UG_H - 0.2, 8); b.light(15, 6, "#FFC67A", 1.2, UG_H - 0.2, 8);
      b.drawWalls(UG_H, 1);
      return { name: "room_ug_kitchen", outdoor: false };
    },
    // 2: toplantı salonu ve kuyu (en alt)
    (b) => {
      b.solidFill("#9C7452");
      for (const [i0, j0, w, d] of [[1, 2, 9, 9], [10, 6, 1, 1], [11, 4, 8, 6]] as const) { b.carve(i0, j0, w, d); b.floor(i0, j0, w, d, TUFF_FLOOR[0], TUFF_FLOOR[1]); }
      stairUp(b, UG_STEPS.tiles, UG_STEPS.foot, UG_H, ["#B88A62", "#A97C56"]);
      // toplantı salonu: kayadan bırakılmış iki sütun, oyma seki; havalandırma bacası ışık sütunu; kuyu
      for (const [i, j] of [[4, 7], [7, 7]] as Tile[]) { b.furn(i, j); b.box(tx(i), UG_H / 2, tz(j), 0.7, UG_H, 0.7, "#A87E58"); }
      counter(b, 2, 10, 6, "#A87E58", "#BC946E");
      b.box(tx(15), 1.2, tz(6), 0.5, 2.4, 0.5, "#FFF1C1", "glow", 0); b.furn(15, 6);
      b.furn(15, 8); b.box(tx(15), 0.3, tz(8), 0.9, 0.6, 0.9, "#A8977C"); b.box(tx(15), 0.58, tz(8), 0.5, 0.04, 0.5, "#2B4A55", "water");
      for (const i of [12, 17]) jar(b, i, 9);
      niche(b, 3, 1); niche(b, 6, 1); oilLamp(b, 1, 6, -1, 0);
      b.room(1, 2, 9, 9, "room_ug_hall"); b.room(11, 4, 8, 6, "room_ug_well");
      b.light(5, 6, "#FFB65C", 1.3, UG_H - 0.2, 8); b.light(15, 7, "#FFF1C1", 1.1, UG_H - 0.2, 8);
      b.drawWalls(UG_H, 1);
      return { name: "room_ug_hall", outdoor: false };
    },
  ],
};

/** Avanos çömlek atölyesi: çark atölyesi (ayak çarkları, çamur yığını) → fırın odası → satış odası (raflarda çömlekler). */
function shelfPots(b: LevelBuilder, i: number, j: number) {
  b.box(tx(i) + 0.25, 0.62, tz(j), 0.4, 1.24, 0.92, "#6B4A2F");
  const C = ["#B5562F", "#2F6D8C", "#C46A3C", "#3F7D6E", "#D08A5C"];
  for (let row = 0; row < 3; row++) for (let k = 0; k < 3; k++) b.box(tx(i) + 0.12, 0.28 + row * 0.38, tz(j) - 0.3 + k * 0.3, 0.2, 0.22, 0.2, C[(row + k + j) % C.length]);
  b.furn(i, j);
}
const potteryWorkshop: Recipe = {
  size: [21, 9],
  levels: [
    (b) => {
      const [w, k, s] = rowLevel(b, [
        { w: 8, d: 7, name: "room_pottery", floor: TUFF_FLOOR },
        { w: 5, d: 7, name: "room_kiln", floor: PAL.stone.floor },
        { w: 5, d: 7, name: "room_pottery_shop", floor: PAL.wood.floor },
      ], { wall: "#C9A27C", exit: 0 });
      wheel(b, w.i0 + 1, w.j0 + 1); wheel(b, w.i0 + 4, w.j0 + 1); wheel(b, w.i0 + 6, w.j0 + 4);
      sacks(b, w.i0, w.j0 + 5); b.furn(w.i0 + 7, w.j0 + 6); b.box(tx(w.i0 + 7), 0.25, tz(w.j0 + 6), 0.8, 0.5, 0.8, "#8E3B22");
      for (let i = w.i0; i < w.i0 + w.w; i += 2) { b.box(tx(i), 1.3, tz(0) + 0.6, 0.9, 0.06, 0.3, "#6B4A2F"); b.box(tx(i), 1.42, tz(0) + 0.6, 0.24, 0.18, 0.2, "#C46A3C"); }
      // fırın: kubbeli taş fırın, ağzında kor, odun istifi
      for (let i = k.i0 + 1; i <= k.i0 + 3; i++) for (let j = k.j0; j <= k.j0 + 2; j++) b.furn(i, j);
      b.box(tx(k.i0 + 2), 0.7, tz(k.j0 + 1), 2.6, 1.4, 2.6, "#B98670"); b.box(tx(k.i0 + 2), 1.55, tz(k.j0 + 1), 1.8, 0.4, 1.8, "#B98670");
      b.box(tx(k.i0 + 2), 0.45, tz(k.j0 + 2) + 0.36, 0.6, 0.4, 0.04, "#FF8C42", "glow");
      b.furn(k.i0, k.j0 + 6); b.box(tx(k.i0), 0.3, tz(k.j0 + 6), 0.9, 0.6, 0.6, "#7A5233");
      for (let j = s.j0; j < s.j0 + s.d; j += 2) shelfPots(b, s.i0 + s.w - 1, j);
      counter(b, s.i0, s.j0 + 4, 2, "#7A5233", "#E9D3B0");
      jar(b, s.i0, s.j0); jar(b, s.i0 + 1, s.j0, "#C46A3C");
      b.light(w.i0 + 3, w.j0 + 3, "#FFE2B0", 1.4); b.light(k.i0 + 2, k.j0 + 4, "#FFB65C", 1.3); b.light(s.i0 + 2, s.j0 + 3, "#FFE2B0", 1.3);
      b.drawWalls();
      return { name: "room_pottery", outdoor: false };
    },
  ],
};
/** Sütun (taban + gövde + başlık; tek karo engelli). */
export function ciColumn(b: LevelBuilder, i: number, j: number, c: string, h = 2.2) {
  b.box(tx(i), 0.07, tz(j), 0.52, 0.14, 0.52, c); b.box(tx(i), 0.14 + (h - 0.3) / 2, tz(j), 0.34, h - 0.3, 0.34, c); b.box(tx(i), h - 0.08, tz(j), 0.52, 0.16, 0.52, c);
  b.furn(i, j);
}

/**
 * Londra kalesi (beyaz taş burç): eskiden <city> saray müzesiyle aynı galeri kalıbı (yalnız taş renkleri farklı).
 * Şimdi açık Caen taşı duvarlar: büyük salon (uzun meşe masa ve sıralar, ocak, duvar halıları) → yuvarlak sütunlu Roman şapeli
 * (kemerli pencereler, sıralar) → mor kadifeli hazine odası (taç ve küre vitrinleri, loş ışık); üstte mazgallı burç yürüyüşü,
 * köşe kuleleri, kuzgunlar, dürbün. Silah/zırh yok. Etkileşim: kat asansörü, burç dürbünü (F), iki keşif parçası.
*/
const KEEP_RUN = { tiles: [[2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [9, 2]] as Tile[], foot: [2, 2] as Tile }; // 9 basamak (yükseliş 0,29; 6 basamakta tırmanılamıyordu)
const KEEP_WALL = "#D6D0C2";
function crown(b: LevelBuilder, i: number, j: number) {
  b.box(tx(i), 0.45, tz(j), 0.56, 0.9, 0.56, "#3B2A4A"); b.box(tx(i), 0.92, tz(j), 0.5, 0.04, 0.5, "#5B2A6E");
  b.box(tx(i), 1.03, tz(j), 0.26, 0.14, 0.26, "#D4A72C");
  for (const [dx, dz] of [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11]] as const) b.box(tx(i) + dx, 1.15, tz(j) + dz, 0.05, 0.1, 0.05, "#E8C04A");
  b.box(tx(i), 1.04, tz(j) + 0.135, 0.06, 0.06, 0.02, "#B91C1C");
  b.box(tx(i), 1.17, tz(j), 0.54, 0.44, 0.54, "#CFE6F2", "glass", 0);
  b.furn(i, j);
}
const londraKeep: Recipe = {
  // ( imzası): beyaz burç kareye yakın kütle — 24 × 13 ayak izi, derinliği farklı üç oda (11 / 9 / 7); <city>'nın
  // 27 × 9 sıra düzeniyle aynı karo ızgarasını paylaşmaz
  size: [24, 13], heights: [HALL_H, STOREY],
  levels: [
    (b) => {
      const [g, ch, vt] = rowLevel(b, [
        { w: 9, d: 11, name: "room_keep_hall", floor: ["#9C8F7C", "#8E826F"] },
        { w: 5, d: 9, name: "room_keep_chapel", floor: ["#E4DED2", "#D6D0C2"] },
        { w: 6, d: 7, name: "room_keep_jewels", floor: ["#4A3456", "#402D4B"] },
      ], { wall: KEEP_WALL, exit: 0 });
      stairUp(b, KEEP_RUN.tiles, KEEP_RUN.foot, HALL_H, ["#B9B2A4", "#ABA495"]);
      // büyük salon: uzun meşe masa (3–7, j 6), iki yanında sıralar, ön duvarda ocak (arka duvar boyunca merdiven), duvar halıları
      const tj = 6, fj = g.j0 + g.d - 1;
      b.box((tx(g.i0 + 2) + tx(g.i0 + 6)) / 2, 0.72, tz(tj), 5, 0.08, 0.9, "#6B4A2F");
      for (const i of [g.i0 + 2, g.i0 + 6]) for (const dz of [-0.35, 0.35]) b.box(tx(i), 0.34, tz(tj) + dz, 0.1, 0.68, 0.1, DARK);
      for (let i = g.i0 + 2; i <= g.i0 + 6; i++) { b.furn(i, tj); bench(b, i, tj - 1, "#5B4636"); bench(b, i, tj + 1, "#5B4636"); }
      b.box(tx(g.i0 + 7), 0.55, tz(fj) + 0.2, 1.1, 1.1, 0.5, "#8D8070"); b.box(tx(g.i0 + 7), 0.28, tz(fj) + 0.05, 0.6, 0.36, 0.3, "#1F1A17");
      b.box(tx(g.i0 + 7), 0.22, tz(fj) - 0.02, 0.4, 0.16, 0.16, "#FF8C42", "glow"); b.box(tx(g.i0 + 7), 1.6, tz(fj) + 0.3, 0.8, 1.0, 0.3, "#9C8F7C"); b.furn(g.i0 + 7, fj);
      panel(b, g.i0 + 1, fj + 1, ["#7A1F2B", "#C9A227", "#1E3A5F"], 0, -1, 1.35);
      for (const j of [4, 7, 10]) panel(b, g.i0 - 1, j, ["#1E3A5F", "#C9A227", "#7A1F2B"], 1, 0, 1.35);
      for (const i of [g.i0 + 3, g.i0 + 5]) hangingLamp(b, i, tj, "#FFC27A");
      // şapel: dört yuvarlak beyaz sütun, kemerli pencereler, sıralar
      for (const i of [ch.i0 + 1, ch.i0 + 3]) for (const j of [2, 8]) ciColumn(b, i, j, "#ECE8DE", HALL_H - 0.1);
      for (const i of [ch.i0 + 1, ch.i0 + 3]) windowAt(b, i, 0, 0, 1, true, 1.6);
      for (const i of [ch.i0 + 1, ch.i0 + 2, ch.i0 + 3]) bench(b, i, 6, "#7A5A40");
      // hazine odası: arka sırada üç taç vitrini, ortada küre vitrini, yan duvarda mor perdeler
      for (const i of [vt.i0 + 1, vt.i0 + 3, vt.i0 + 5]) crown(b, i, 2);
      for (const i of [vt.i0 + 1, vt.i0 + 5]) vitrine(b, i, 6, "#D4A72C"); // altın tabak ve kadeh vitrinleri
      const ox = tx(vt.i0 + 3);
      b.box(ox, 0.45, tz(5), 0.7, 0.9, 0.7, "#3B2A4A"); b.box(ox, 1.06, tz(5), 0.24, 0.24, 0.24, "#D4A72C");
      b.box(ox, 1.22, tz(5), 0.06, 0.14, 0.06, "#E8C04A"); b.box(ox, 1.2, tz(5), 0.6, 0.5, 0.6, "#CFE6F2", "glass", 0); b.furn(vt.i0 + 3, 5);
      for (const j of [2, 5]) { b.box(tx(vt.i0 + vt.w - 1) + 0.47, 1.2, tz(j), 0.04, 2.0, 0.9, "#5B2A6E"); }
      b.light(g.i0 + 4, tj, "#FFD9A0", 1.6, HALL_H - 0.2, 12); b.light(ch.i0 + 2, 5, "#F4F1EA", 1.3, HALL_H - 0.2, 9); b.light(vt.i0 + 3, 4, "#C7B8FF", 1.1, HALL_H - 0.2, 9);
      b.drawWalls();
      return { name: "room_keep_hall", outdoor: false, kTiles: [[vt.i0 + vt.w - 1, 7]] };
    },
    (b, ctx) => {
      // burç yürüyüşü: çevrede 3 karoluk taş yol; ortası kurşun kaplı kırma çatı (engelli, döşemesiz; temelden yükselen tek kütle)
      const R0: Tile = [4, 4], RW = b.w - 8, RD = b.d - 8;
      for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) {
        if (i >= R0[0] && i < R0[0] + RW && j >= R0[1] && j < R0[1] + RD) { b.block(i, j); continue; }
        b.floorTile(i, j, (i + j) % 2 ? "#B7B0A2" : "#ABA495");
      }
      const rcx = tx(R0[0]) + (RW - 1) / 2, rcz = tz(R0[1]) + (RD - 1) / 2;
      b.box(rcx, -0.3, rcz, RW, 1.4, RD, "#6B7280"); b.box(rcx, 0.55, rcz, RW - 1.2, 0.3, RD - 1.2, "#7B8390"); b.box(rcx, 0.8, rcz, RW - 3, 0.2, 1, "#8A929E");
      if (ctx.below) stairHole(b, ctx.below, ["#B9B2A4", "#ABA495"]);
      // köşe kuleleri (2 × 2, engelli)
      for (const [i0, j0] of [[0, 0], [b.w - 2, 0], [0, b.d - 2], [b.w - 2, b.d - 2]] as const) {
        b.box(tx(i0) + 0.5, 0.9, tz(j0) + 0.5, 2, 1.8, 2, KEEP_WALL); b.box(tx(i0) + 0.5, 1.84, tz(j0) + 0.5, 2.2, 0.08, 2.2, "#8D8070");
        for (let i = i0; i < i0 + 2; i++) for (let j = j0; j < j0 + 2; j++) b.furn(i, j);
      }
      // mazgallı korkuluk: kenar karosunun dış yarısında alçak duvar + iki karoda bir dişli (dürbün karosunda dişsiz)
      const vp: Tile = [Math.floor(b.w / 2), b.d - 1];
      for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) {
        if (b.isBlocked(i, j)) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ni = i + di, nj = j + dj;
          if (ni >= 0 && nj >= 0 && ni < b.w && nj < b.d) continue;
          const x = tx(i) + di * 0.43, z = tz(j) + dj * 0.43, sx = di ? 0.14 : 1, sz = dj ? 0.14 : 1;
          b.box(x, 0.25, z, sx, 0.5, sz, KEEP_WALL);
          // dişler: dürbünün iki yanında 3 karo açık (varış bakışı: INTERIOR-ARRIVAL-VIEW-001)
          if ((i + j) % 2 === 0 && !(j === vp[1] && Math.abs(i - vp[0]) <= 3)) b.box(x, 0.75, z, sx, 0.5, sz, KEEP_WALL);
        }
      }
      // kuzgunlar (siyah kuşlar, iç korkuluk dibinde)
      for (const [i, j] of [[10, 1], [21, 7], [21, 2]] as const) { b.box(tx(i), 0.12, tz(j), 0.16, 0.18, 0.3, "#111827"); b.box(tx(i), 0.24, tz(j) + 0.15, 0.1, 0.1, 0.12, "#111827"); b.box(tx(i), 0.24, tz(j) + 0.24, 0.04, 0.03, 0.08, "#4B5563"); b.furn(i, j); }
      bench(b, 8, b.d - 3, "#5B4636"); bench(b, 16, b.d - 3, "#5B4636");
      b.room(0, 0, b.w, b.d, "room_battlements");
      binocular(b, vp[0], vp[1], 1);
      return { name: "room_battlements", outdoor: true, vp, vpDir: 1, kTiles: [[b.w - 3, 1]] };
    },
  ],
};

/** Aggregator (full/generate.ts) recipe library: the full edition's removed-city recipes are defined above in this file. */
const FULL_RECIPE_LIB = (): FullRecipeLib => ({
  r: { ...fullRecipeDefs(), skyscraper },
  museum, marbleFloor: PAL.marble.floor,
});
/** kaldırılabilir şehirlerin landmark tarifleri (recipeFor, CITY_RECIPES'ten sonra bakar); tarif listesi full/ ekleyicisinden.*/
const CITYIN1_RECIPES: Record<string, { kind: SiteKind; recipe: Recipe }> = fullCityRecipes(FULL_RECIPE_LIB()).cityin1;

/** Şehir landmarkına özgü tarifler: `<şehir>:<landmark>` → tür + tarif (tür eşleşmezse genel tarif). */
const CITY_RECIPES: Record<string, { kind: SiteKind; recipe: Recipe }> = {
  ...fullCityRecipes(FULL_RECIPE_LIB()).city,
  "istanbul:yerebatan": { kind: "museum", recipe: cistern },
  "istanbul:topkapi": { kind: "museum", recipe: courtyards },
  "istanbul:kapalicarsi": { kind: "lobby", recipe: bazaar },
  "istanbul:galata_koprusu": { kind: "lobby", recipe: lowerDeck },
  "istanbul:kiz_kulesi": { kind: "tower", recipe: maiden },
  "istanbul:rumeli_hisari": { kind: "castle", recipe: ramparts },
  // Londra: saat kulesi (giriş → saat mekanizması → çan katı), kale burcu (taş müze), kapalı çarşı sokakları
  "londra:saat_kulesi": { kind: "tower", recipe: clocktower },
  "londra:kale": { kind: "museum", recipe: londraKeep }, // kendi burç tarifi (eskiden <city> galerisinin taş renklisi)
  "londra:kapali_carsi": { kind: "lobby", recipe: bazaar },
  // Kapadokya: kaya kalesi (oyma odalar → kaya merdiveni → zirve terası), yer altı şehri (girişten aşağı üç kat), çömlek
  // atölyesi; <city>: stadyum (iç koridor → alt tribün)
  "kapadokya:uchisar_kalesi": { kind: "castle", recipe: rockCastle },
  "kapadokya:yeralti_sehri": { kind: "museum", recipe: undergroundCity },
  "kapadokya:comlek_atolyesi": { kind: "lobby", recipe: potteryWorkshop },
};
const CITY_SITE = /^city_([a-z0-9_]+?)__[a-z0-9_]+?__([a-z0-9_]+)$/;

/** Yere özgü tarif: simgenin mimari tipolojisi (tür tarifinin üstüne). */
function recipeFor(scene: string, site: string, kind: SiteKind): Recipe {
  if (kind === "courtyard") return courtRecipeFor(scene, site); // COURTYARD-PORTAL
  // şehir haritası landmarkı (`city_<şehir>__<semt>__<landmark>`): landmarka özgü tarif
  const cm = CITY_SITE.exec(site);
  const cr = cm ? CITY_RECIPES[`${cm[1]}:${cm[2]}`] ?? CITYIN1_RECIPES[`${cm[1]}:${cm[2]}`] : undefined;
  if (cr && cr.kind === kind) return cr.recipe;
  if (kind === "tower") {
    if (site === "lattice" && fullLattice) return fullLattice({ iron: "#5E4B3A", trim: "#8A6E52", switchback: true });
    const st = fullSceneTower(scene);
    if (st) return st;
    if (site === "clocktower") return clocktower;
    return cm ? galataFor(cm[1], cm[2]) : galata;
  }
  if (kind === "museum" && site === "keep") return londraKeep; // taban sahnenin burcu da aynı kale
  return RECIPES[kind];
}

function roofGarden(name: string): LevelFn {
  return (b, ctx) => {
    openRoof(b, ["#6E8B4E", "#668247"], name, ctx.below);
    plant(b, 2, 4); plant(b, 4, 4); plant(b, b.w - 1, 4); bench(b, 3, 5); bench(b, 4, 6); table(b, 6, 5, "#E5E7EB");
    for (let i = 1; i < b.w - 1; i++) b.box(tx(i), 1.5, tz(b.d - 2), 0.1, 0.1, 0.1, i % 2 ? "#FDE68A" : "#A7F3D0", "glow");
    lightString(b, b.d - 2);
    const vp: Tile = [Math.floor(b.w / 2), b.d - 1];
    binocular(b, vp[0], vp[1], 1);
    return { name, outdoor: true, vp, vpDir: 1, kTiles: [[1, b.d - 1]] };
  };
}

// ------------------------------------------------------------------------------------------ plan
const planCache = new Map<string, InteriorPlan | null>();
/** Denetim (walk_check belirlenimcilik) için önbellekleri boşaltır. */
export function clearExploreCaches() { planCache.clear(); clearPlaceCaches(); }

/** Sahnedeki yerin iç mekân planı (kapı yerleşimi gerekir; yoksa null). Belirlenimci ve önbellekli. */
export function interiorPlan(scene: string, site: string): InteriorPlan | null {
  const ck = `${scene}:${site}`;
  if (planCache.has(ck)) return planCache.get(ck)!;
  const door = scenePlaces(scene).doors.find((d) => d.site === site) ?? null;
  const plan = door ? makePlan(scene, site, door) : null;
  planCache.set(ck, plan);
  return plan;
}

/**
 * şehir haritası landmarkının iç mekân planı (aynı iç mekân sahne modeli ve tarifler).
 * Kapı şehir karosundadır (yer kimliği `city_…`; keşif kataloğuna girmez, keşif parçası yok — şehir pasaportu damgası
 * `citymap/store.ts`). HORIZON: dürbün modeli olan katta kayıtsız seyir noktası (`free`) var: F dürbünle bakar, keşif yazılmaz. Ofis tabanının pişmiş panoraması (`pano`) taşınmaz; WORLD-PANO: her kat yerine şehrin ucuz
 * silüet halkasını taşır (`cityPano`, `exterior: backdrop`; `h` landmark yüksekliği → kule katlarının sokaktan yüksekliği).
 * Belirlenimci, önbellekli.
*/
export function cityInteriorPlan(scene: string, site: string, kind: SiteKind, door: { tile: Tile; out: Tile; dir: [number, number] }, h?: number): InteriorPlan {
  const ck = `${scene}:${site}:city:${h ?? ""}`;
  const hit = planCache.get(ck);
  if (hit) return hit;
  const place: DoorPlace = { scene, site, spec: { kind, vp: 0, k: 0 }, kind, tile: door.tile, dir: door.dir, out: door.out, zone: null, open: true, height: 0 };
  const plan = makePlan(scene, site, place, true);
  for (const lv of plan.levels) {
    lv.pano = null;
    lv.cityPano = cityPanoFor(site, lv.index, lv.count, lv.built.width, lv.built.depth, h);
    if (kind === "courtyard" && lv.cityPano) lv.cityPano = { ...lv.cityPano, elev: COURT_PANO_ELEV }; // COURTYARD-PORTAL
  }
  planCache.set(ck, plan);
  return plan;
}

/**
 * merdiven fiziği denetim fikstürü — aynı tarif, asansöre çevrilmeden (merdiven + kat bağı). Oyunda yalnız yer altı şehri
 * merdivenlidir; walk/stuckCheck.ts basamak/düşüş/gömülme kurallarını bu fikstürlerle de tarar (merdiven kodu sınanmadan kalmasın).
*/
export function stairFixturePlan(scene: string, site: string): InteriorPlan | null {
  const door = scenePlaces(scene).doors.find((d) => d.site === site);
  return door ? makePlan(scene, site, door, false, true) : null;
}

function makePlan(scene: string, site: string, door: DoorPlace, see = false, stairs = false): InteriorPlan {
  // HOTEL-SYS: otel kapısı → bölge etiketindeki lobi tarifi (districts/hotel.ts)
  const recipe = door.kind === "hotel" ? hotelLobby(door.zone?.tag) : recipeFor(scene, site, door.kind);
  const seed = sceneSeed(`${scene}:${site}`);
  const r = rng(seed);
  let artK = Math.floor(r() * ART.length);
  const ctx: Ctx = { scene, site, kind: door.kind, door, art: () => ART[artK++ % ART.length], below: null };
  const levels: InteriorLevel[] = [];
  const count = recipe.levels.length;
  // çok katlı plan (kule, teras, seyir katlı müze) asansörle. ( ürün sahibi "merdiven çıkışlarını kullanmayalım"):
  // yer altı şehri (aşağı inen oyma kat) de asansörlü — merdiven/rampa yerine kuyu; merdivenli plan yalnız fizik fikstürü (`stairs`)
  const liftOnly = count > 1 && !stairs;
  const fixture = stairs;
  const [w, d] = recipe.size;
  let kLeft = door.spec.k;
  let kNum = 0;
  const built0: InteriorLevel[] = [];
  const rawLifts: { door: Tile; tile: Tile }[][] = []; // kat dizini → asansör kapıları (yaklaşma karosu yürünebilir olanlar)
  // yer altı tarifinde kurulum en derin kattan girişe doğru (fiziksel alttan üste); dizin girişten aşağı
  const order = recipe.levels.map((_, k) => (recipe.descend ? count - 1 - k : k));
  order.forEach((index) => {
    const make = recipe.levels[index];
    const upTo = recipe.descend ? index - 1 : index + 1, downTo = recipe.descend ? index + 1 : index - 1;
    // CEIL: alçak kat yok (CEIL_LOW_KNOWN boş). Yalnız merdiven fiziği fikstürü (`stairs`, oyunda yok) eski 1,6'da kalır: 6 karoluk kollar 2,4'te STEP_H'yi aşar
    const storey = recipe.heights?.[index] ?? (fixture ? STOREY : INDOOR_H);
    const b = new LevelBuilder(w, d, rng(seed + index * 7919), storey);
    b.seeThrough = see;
    b.liftOnly = liftOnly;
    const meta = make(b, ctx);
    // katın binilebilir asansörü yoksa merdivenin yerine kuyu + kapı (kapının önü dürbün/keşif/çıkış karosu olmaz)
    if (liftOnly && b.shaft && !b.lifts.some((l) => b.free(l.tile[0], l.tile[1]))) {
      const busy = new Set([...(meta.kTiles ?? []), ...(meta.vp ? [meta.vp] : []), ...b.portals.flatMap((p) => [p.tile, p.arrive])].map((t) => `${t[0]},${t[1]}`));
      const [di, dj] = b.shaft.door;
      // kapının önü: boş ve dışa bakışı açık (asansörden çıkan duvara bakmaz: önünde en az 2 boş karo yeğlenir)
      const open = (t: Tile) => { let n = 0; const fx = t[0] - di, fz = t[1] - dj; while (n < 2 && b.free(t[0] + fx * (n + 1), t[1] + fz * (n + 1))) n++; return n; };
      const tile = ([b.shaft.tile, [di, dj + 1], [di, dj - 1], [di + 1, dj], [di - 1, dj]] as Tile[])
        .filter((t) => b.free(t[0], t[1]) && !busy.has(`${t[0]},${t[1]}`)).sort((x, y) => open(y) - open(x))[0];
      if (tile && !busy.has(`${di},${dj}`)) liftShaft(b, { door: b.shaft.door, tile }, meta.outdoor);
    }
    // INTERIOR-CAM: kapalı katın tavanı (çatı/tavan kaldırılmaz; kamera tavanın altında kalır — camera/ceiling.ts)
    if (!meta.outdoor) addCeiling(b);
    staffCounters(b); // GALLERY1: görevsiz tezgâh kalmaz (INTERIOR-STAFF-001)
    // GALLERY1: ipucusuz üst seyir katında asansör varışı dürbün karosunda, dürbünün baktığı yöne (vpDir) — asansör yönlü
    // `interiorArrival` güvertenin ortasına, binaya/çekirdeğe bakan kareye düşüyordu (müze, kafes kule, teras, gökdelen, kafe, AVM, ofis)
    const arrive = meta.arrive ?? (index > 0 && meta.outdoor && meta.vp ? { tile: meta.vp, heading: (meta.vpDir ?? 1) < 0 ? Math.PI : 0 } : undefined);
    const stairs: StairLink[] = [];
    // INTERIOR-VIEW: merdiven bağları — alt kat son basamağı (yukarı), üst kat boşluğun ağzı (aşağı); aynı x/z, y ± kat yüksekliği
    if (b.up) {
      const s = b.up, n = s.tiles.length;
      stairs.push({ id: "up", dir: "up", to: upTo, tile: s.tiles[n - 1], y: 0, dy: -s.storey, stand: s.foot, run: s.tiles, rise: s.rise });
    }
    if (b.hole) {
      const s = b.hole, n = s.tiles.length;
      stairs.push({ id: "down", dir: "down", to: downTo, tile: s.tiles[n - 2], y: s.storey - s.rise, dy: s.storey, stand: s.tiles[n - 1], run: s.tiles, rise: s.rise });
    }
    ctx.below = b.up ?? b.liftUp;
    const spots: LevelSpot[] = [];
    // HORIZON: şehir haritası iç mekânında (`see`, katalog `vp: 0`) dürbün modeli olan katta da dürbün çalışır — kayıtsız seyir noktası
    if (meta.vp && door.spec.vp) spots.push({ id: vpId(scene, site), kind: "vp", tile: meta.vp });
    else if (meta.vp && see) spots.push({ id: vpId(scene, site), kind: "vp", tile: meta.vp, free: true });
    for (const t of meta.kTiles ?? []) {
      if (kLeft <= 0) break;
      kLeft--; kNum++;
      spots.push({ id: kesifId(scene, site, kNum), kind: "k", tile: t, model: KESIF_MODELS[(seed + kNum) % KESIF_MODELS.length] });
    }
    const built = b.build();
    if (meta.quiet) built.zones = [{ kind: "sacred", i0: 0, j0: 0, w, d, buffer: 0 }];
    rawLifts[index] = b.lifts.filter((l) => b.free(l.tile[0], l.tile[1]));
    const shell = new Uint8Array(w * d);
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) shell[j * w + i] = b.isBlocked(i, j) && !b.decor.has(`${i},${j}`) ? 1 : 0;
    built0[index] = { key: `${scene}:${site}:${index}`, scene, site, kind: door.kind, index, count, name: meta.name, outdoor: meta.outdoor,
      quiet: !!meta.quiet, storey, pano: null, rooms: b.rooms, portals: b.portals, stairs, lifts: [], spots, built, shell, counters: b.counters, people: b.people, figs: b.figs, ...(arrive ? { arrive } : {}), ...(meta.exhibit ? { exhibit: meta.exhibit } : {}) };
  });
  levels.push(...built0);
  linkLifts(levels, rawLifts);
  // keşif parçası artarsa (tarif eksik yer verdiyse) ilk kattaki ilk boş karoya
  for (let n = kNum + 1; n <= door.spec.k; n++) {
    const lv = levels[0];
    const t = firstFree(lv);
    if (t) lv.spots.push({ id: kesifId(scene, site, n), kind: "k", tile: t, model: KESIF_MODELS[(seed + n) % KESIF_MODELS.length] });
  }
  for (const lv of levels) lv.pano = lv.outdoor && door.kind !== "courtyard" ? panoramaFor(scene, door, lv) : null;
  // COURTYARD-PORTAL: avlu katı (taban sahne) dış şehri ucuz silüet halkasıyla görür (şehir haritasında cityInteriorPlan kurar)
  if (door.kind === "courtyard" && !see) for (const lv of levels) {
    const cp = cityPanoFor(`city_${scene}__avlu__${site}`, lv.index, lv.count, lv.built.width, lv.built.depth);
    lv.cityPano = cp ? { ...cp, elev: COURT_PANO_ELEV } : null;
  }
  return { scene, site, kind: door.kind, door, levels };
}

/**
 * asansör durakları: en az iki katta binilebilir kapı varsa her kapı bir duraktır. her kapıdan öteki bütün
 * duraklı katlara binilir (`lift<k>-<kat>`; Yakındakiler hedef katı adıyla listeler); hedef kattaki aynı sıradaki kapının önüne (yoksa
 * sonuncusuna) varılır, kapıya sırtı dönük. Tek katta kapısı olan (lobi) asansör süs kalır.
*/
function linkLifts(levels: InteriorLevel[], raw: readonly ({ door: Tile; tile: Tile }[] | undefined)[]) {
  const served = levels.filter((lv) => raw[lv.index]?.length).map((lv) => lv.index);
  if (served.length < 2) return;
  // her kapı öteki bütün duraklı katlara gider (kat seçimi; en alt kattan doğrudan hedef kata) — en üst durak önce
  const order = [...served].sort((a, b) => b - a);
  for (const lv of levels) {
    const own = raw[lv.index];
    if (!own?.length) continue;
    // her çizili asansör kapısı çalışır kalır (veride tekilleştirme ikinci kapıyı ölü bırakıyordu); "×2" tekilleştirmesi yalnız
    // Yakındakiler listesinde (interiors/entities.ts)
    lv.lifts = own.flatMap((l, k) => order.filter((to) => to !== lv.index).map((to) => {
      const dest = raw[to]!, d = dest[Math.min(k, dest.length - 1)];
      return { id: `lift${k}-${to}`, tile: l.tile, door: l.door, to, toTile: d.tile, heading: Math.atan2(d.tile[0] - d.door[0], d.tile[1] - d.door[1]) };
    }));
  }
}

// ------------------------------------------------------------------------------------------ tavan (INTERIOR-CAM)
/** Tavan levhası kalınlığı ve rengi (sıcak sıva; yazı/desen yok). Tavan `glow` grubunda (ışıksız, gölge düşürmez): aşağı bakan yüz
 *  yarıküre ışığının koyu yer rengini alıp "boşluk" gibi görünmesin, pencere ışığını da gölgelemesin — dolaylı aydınlanmış sıva
 *  tonu; grup katta zaten var (çıkış kapısı paneli, lambalar) → +0 çizim çağrısı. */
export const CEIL_T = 0.1;
export const CEIL_COLOR = "#857A6C";
/**
 * INTERIOR-CAM (ürün sahibi 2026-10-29: "iç mekâna girince çatı kaybolmamalı"): kapalı katın oda karolarının (duvar olmayan, oyulmuş ya da
 * eşyalı) üstüne kat yüksekliğinde (`b.h`) tavan levhası. Satır başına kesintisiz karo dizileri tek blok (`glow` grubu, CEIL_COLOR notu → +0
 * çizim çağrısı). Boş bırakılan: bu kattan yukarı çıkan merdivenin karoları (merdiven boşluğu; basamakta baş tavana değmez) ve
 * tavan çizgisinde zaten örtü bulunan karolar (tonoz; müze tepe ışığı fenerinin üstüne cam tavan). Blok `ceil: 1` taşır (örtü ızgarası: çatı).
*/
function addCeiling(b: LevelBuilder) {
  const stair = new Set((b.up?.tiles ?? []).map((t) => `${t[0]},${t[1]}`));
  // tavan çizgisinde karo merkezini örten blok: katı (tonoz, kiriş levhası) → tavan yok; cam (tepe ışığı feneri) → cam tavan
  const roofAt = (i: number, j: number): "solid" | "glass" | null => {
    const x = tx(i), z = tz(j);
    let kind: "solid" | "glass" | null = null;
    for (const q of b.blocks) {
      if (q.p[1] - q.s[1] / 2 < b.h - 0.35 || q.s[0] < 0.9 || q.s[2] < 0.9) continue;
      if (Math.abs(q.p[0] - x) > q.s[0] / 2 + 1e-6 || Math.abs(q.p[2] - z) > q.s[2] / 2 + 1e-6) continue;
      if (q.g === "solid" || q.g === "glow") return "solid";
      if (q.g === "glass") kind = "glass";
    }
    return kind;
  };
  const kindAt = (i: number, j: number): 0 | 1 | 2 => {
    if ((b.isBlocked(i, j) && !b.decor.has(`${i},${j}`)) || stair.has(`${i},${j}`)) return 0;
    const r = roofAt(i, j);
    return r === "solid" ? 0 : r === "glass" ? 2 : 1;
  };
  for (let j = 0; j < b.d; j++) {
    let i = 0;
    while (i < b.w) {
      const k = kindAt(i, j);
      if (!k) { i++; continue; }
      let n = 1;
      while (i + n < b.w && kindAt(i + n, j) === k) n++;
      // cam tavan fenerin üstünde (yüzler çakışmasın): ışık içeri düşer, gök görünür
      if (k === 1) b.box(tx(i) + (n - 1) / 2, b.h + CEIL_T / 2, tz(j), n, CEIL_T, 1, CEIL_COLOR, "glow", 0.02);
      else b.box(tx(i) + (n - 1) / 2, b.h + 0.07, tz(j), n, 0.06, 1, "#BFE3F0", "glass", 0);
      b.blocks[b.blocks.length - 1].ceil = 1;
      i += n;
    }
  }
}

function firstFree(lv: InteriorLevel): Tile | null {
  const busy = new Set([...lv.portals.flatMap((p) => [`${p.tile[0]},${p.tile[1]}`, `${p.arrive[0]},${p.arrive[1]}`]), ...lv.spots.map((s) => `${s.tile[0]},${s.tile[1]}`),
    ...lv.stairs.flatMap((s) => [...s.run, s.stand].map((t) => `${t[0]},${t[1]}`))]);
  for (let j = 1; j < lv.built.depth; j++) for (let i = 1; i < lv.built.width; i++)
    if (!lv.built.blocked.has(`${i},${j}`) && !busy.has(`${i},${j}`)) return [i, j];
  return null;
}

// ------------------------------------------------------------------------------------------ panorama
/**
 * Açık hava katının dış taban dünyasına göre yeri: kat çapası (kule/kale/gökdelen güvertesi: simge merkezi; tribün: stadyumun
 * ön kenarı; çatı/teras: kapının arkasındaki yapı; iskele: kapı karosu, dışarı uzanır), iniş yüksekliği ve kesim kutusu.
 */
function panoramaFor(scene: string, door: DoorPlace, lv: InteriorLevel): Panorama | null {
  const base = baseWorld(scene);
  if (!base) return null;
  const w = lv.built.width, d = lv.built.depth;
  const lcx = (tx(0) + tx(w - 1)) / 2, lcz = (tz(0) + tz(d - 1)) / 2;
  let ax: number, az: number, lx = lcx, lz = lcz, drop: number;
  const z = door.zone;
  const zTop = door.height;
  switch (door.kind) {
    case "tower": case "skyscraper": case "castle":
      ax = z ? tx(z.i0) + (z.w - 1) / 2 : tx(door.tile[0]); az = z ? tz(z.j0) + (z.d - 1) / 2 : tz(door.tile[1]);
      drop = Math.max(4, Math.min(16, zTop * 0.8));
      break;
    case "museum":
      ax = z ? tx(z.i0) + (z.w - 1) / 2 : tx(door.tile[0]); az = z ? tz(z.j0) + (z.d - 1) / 2 : tz(door.tile[1]);
      drop = Math.max(3.5, Math.min(10, zTop * 0.9));
      break;
    case "stadium":
      ax = z ? tx(z.i0) + (z.w - 1) / 2 : tx(door.tile[0]); az = z ? tz(z.j0 + z.d) : tz(door.tile[1]);
      lz = tz(d - 1);
      drop = Math.max(3.5, zTop + 1.4);
      break;
    case "pier":
      ax = tx(door.tile[0]); az = tz(door.tile[1]);
      lx = tx(3); lz = tz(0);
      drop = 0;
      break;
    default: {
      // teras / çatı / balkon: kapının arkasındaki yapının üstü (iç sahnelerde dış duvarın ötesi)
      const depth = d / 2 + 0.5;
      ax = tx(door.tile[0]) + door.dir[0] * depth; az = tz(door.tile[1]) + door.dir[1] * depth;
      drop = Math.max(3.2, door.height + 0.4);
      // PANO-FOOT-001 (ürün sahibi 2026-10-31 "teras köprüyle birleşik, iç içe"): teras kendi yapısının üstünde — ayak izi (+ 1 karo pay)
      // başka bir yapıya (köprü, komşu bina) DEĞMEYEN en yakın yere kayar; içinde kalan küçük parça (saksı, kulübe) gövdeye gömülür,
      // simge bölgesi hiç örtülmez. Yer yoksa kayma en az değen yerde kalır ve kırpma (`clip`) değeni keser.
      const [sx, sz] = footSlide(base, lcx - ax, lcz - az, w, d);
      ax += sx; az += sz;
    }
  }
  const dx = lx - ax, dz = lz - az;
  // NONCITY-QA (VIEW-BLOCK-001): teras/çatı/balkon dürbünü (+z kenarı) komşu yapının çatısına dayanmasın — güvertenin önündeki 6 karoluk
  // bakış koridorunda tabanın en yüksek bloğu göz hizasını (güverte + 0,9) kesiyorsa güverte onun üstüne çıkar (yalnız panorama)
  if (!["tower", "skyscraper", "castle", "museum", "stadium", "pier"].includes(door.kind)) {
    const x0 = tx(0) - 0.5 - dx, x1 = tx(w - 1) + 0.5 - dx, z0 = tz(d - 1) + 0.5 - dz, z1 = z0 + 6;
    let top = -Infinity;
    for (const b of base.blocks) {
      if (b.p[0] + b.s[0] / 2 > x0 && b.p[0] - b.s[0] / 2 < x1 && b.p[2] + b.s[2] / 2 > z0 && b.p[2] - b.s[2] / 2 < z1) top = Math.max(top, b.p[1] + b.s[1] / 2);
    }
    if (top - 0.5 > drop) drop = +(top - 0.5).toFixed(3);
  }
  // LOOKOUT-CAM-001 (ürün sahibi 2026-10-31 "çan katında kamera binaların içinden geçiyor"): kule/kale/gökdelen güvertesinin çevresindeki
  // `DECK_CLEAR` karoluk halkada kırpmadan kalan komşu (dönme dolap, saray kanadı) güverte döşemesinin altında kalır — güverte yükselir
  if (["tower", "castle", "skyscraper"].includes(door.kind)) {
    const fx0 = tx(0) - 0.5 - dx, fx1 = tx(w - 1) + 0.5 - dx, fz0 = tz(0) - 0.5 - dz, fz1 = tz(d - 1) + 0.5 - dz;
    let ring = -Infinity;
    for (const b of [...base.blocks, ...(base.backdrop ?? [])]) {
      if (b.g === "cloud" || b.g === "snow" || b.g === "water") continue;
      const [x0, x1, , y1, z0, z1] = sweptBox({ p: b.p, s: b.s });
      if (y1 <= PANO_GROUND_TOP || x1 <= fx0 - DECK_CLEAR || x0 >= fx1 + DECK_CLEAR || z1 <= fz0 - DECK_CLEAR || z0 >= fz1 + DECK_CLEAR) continue;
      if (x0 >= fx0 && x1 <= fx1 && z0 >= fz0 && z1 <= fz1) continue; // ayak izinin içinde: gövdeye gömülür
      ring = Math.max(ring, y1);
    }
    if (ring + 1 > drop) drop = +Math.min(DECK_DROP_MAX, ring + 1).toFixed(3);
  }
  const pad = door.kind === "pier" ? 1 : 0.05;
  const cut = { x0: tx(0) - 0.5 - dx - pad, x1: tx(w - 1) + 0.5 - dx + pad, z0: tz(0) - 0.5 - dz - pad, z1: tz(d - 1) + 0.5 - dz + pad,
    y: door.kind === "pier" ? -1.5 : drop - 1.2 };
  return { dx, dz, drop, cut, sea: door.kind === "pier" ? -0.38 : null, ...(door.kind === "pier" ? {} : { clip: true as const }) };
}

type Rect = { x0: number; x1: number; z0: number; z1: number };
const overlaps = (a: Rect, x0: number, x1: number, z0: number, z1: number, e = 1e-3) => x1 > a.x0 + e && x0 < a.x1 - e && z1 > a.z0 + e && z0 < a.z1 - e;
/**
 * PANO-FOOT-001: teras ayak izinin değmediği en yakın kayma (karo; ±8). `dx0/dz0`: kayma öncesi taban → kat ötelemesi. Değen = zemin
 * levhası olmayan blok, ayak izi + 1 karo payına girip ayak izinin içinde kalmayan; ya da simge bölgesine değen ayak izi.
 */
function footSlide(base: NonNullable<ReturnType<typeof baseWorld>>, dx0: number, dz0: number, w: number, d: number): [number, number] {
  const fx0 = tx(0) - 0.5 - dx0, fx1 = tx(w - 1) + 0.5 - dx0, fz0 = tz(0) - 0.5 - dz0, fz1 = tz(d - 1) + 0.5 - dz0;
  const solids = [...base.blocks, ...(base.backdrop ?? [])].filter((b) => b.g !== "cloud" && b.g !== "snow" && b.g !== "water" && b.p[1] + b.s[1] / 2 > PANO_GROUND_TOP).map((b) => sweptBox({ p: b.p, s: b.s }));
  // su üstüne teras binası kurulmaz (nehir, göl, deniz): ayak izinde zemini (üstü 0 civarı levha) olmayan karo da değmedir
  const dry = new Set<string>();
  for (const b of base.blocks) {
    const top = b.p[1] + b.s[1] / 2;
    if (b.g === "water" || top < -0.1 || top > PANO_GROUND_TOP + 0.05) continue;
    for (let x = Math.floor(b.p[0] - b.s[0] / 2 + 0.01); x < b.p[0] + b.s[0] / 2 - 0.01; x++) for (let z = Math.floor(b.p[2] - b.s[2] / 2 + 0.01); z < b.p[2] + b.s[2] / 2 - 0.01; z++) dry.add(`${x},${z}`);
  }
  const marks = (base.zones ?? []).filter((z) => z.kind === "landmark" && z.w > 0 && z.d > 0).map((z) => ({ x0: tx(z.i0) - 0.5, x1: tx(z.i0 + z.w - 1) + 0.5, z0: tz(z.j0) - 0.5, z1: tz(z.j0 + z.d - 1) + 0.5 }));
  const hits = (ox: number, oz: number) => {
    const f = { x0: fx0 + ox, x1: fx1 + ox, z0: fz0 + oz, z1: fz1 + oz }, pad = { x0: f.x0 - 1, x1: f.x1 + 1, z0: f.z0 - 1, z1: f.z1 + 1 };
    let n = 0;
    for (const m of marks) if (overlaps(f, m.x0, m.x1, m.z0, m.z1)) n += 100;
    for (let x = f.x0 + 0.5; x < f.x1; x++) for (let z = f.z0 + 0.5; z < f.z1; z++) if (!dry.has(`${Math.floor(x)},${Math.floor(z)}`)) n += 5;
    for (const s of solids) if (overlaps(pad, s[0], s[1], s[4], s[5]) && !(s[0] >= f.x0 && s[1] <= f.x1 && s[4] >= f.z0 && s[5] <= f.z1)) n++;
    return n;
  };
  let best: [number, number] = [0, 0], bestN = hits(0, 0);
  if (!bestN) return best;
  const offs: [number, number][] = [];
  for (let ox = -8; ox <= 8; ox++) for (let oz = -8; oz <= 8; oz++) offs.push([ox, oz]);
  offs.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
  for (const [ox, oz] of offs) {
    const n = hits(ox, oz);
    if (n < bestN) { best = [ox, oz]; bestN = n; if (!n) break; }
  }
  return best;
}

/** PANO-FOOT-001: kutunun dikdörtgen dışında kalan parçaları (en çok 4). */
function clipOut(b: Block, r: Rect): Block[] {
  const x0 = b.p[0] - b.s[0] / 2, x1 = b.p[0] + b.s[0] / 2, z0 = b.p[2] - b.s[2] / 2, z1 = b.p[2] + b.s[2] / 2;
  const out: Block[] = [];
  const part = (a0: number, a1: number, c0: number, c1: number) => {
    if (a1 - a0 > 0.02 && c1 - c0 > 0.02) out.push({ ...b, p: [(a0 + a1) / 2, b.p[1], (c0 + c1) / 2], s: [a1 - a0, b.s[1], c1 - c0] });
  };
  part(x0, Math.min(x1, r.x0), z0, z1);
  part(Math.max(x0, r.x1), x1, z0, z1);
  const mx0 = Math.max(x0, r.x0), mx1 = Math.min(x1, r.x1);
  part(mx0, mx1, z0, Math.min(z1, r.z0));
  part(mx0, mx1, Math.max(z0, r.z1), z1);
  return out;
}

/**
 * TOWER-GROUND-001 (ürün sahibi 2026-10-31 "saat kulesinin altı yok, havada"): açık hava katının (seyir güvertesi, teras, çan katı) altında
 * kendi gövdesi — ayak izi boyunca zeminden (panorama inişi ya da şehir panoramasının sokak yüksekliği) kat döşemesinin altına (y −1)
 * tek katı blok + her yüzde iki sıra koyu pencere. İskele ve avlu hariç. +0 çizim çağrısı (`solid`).
*/
export function levelSupport(lv: Pick<InteriorLevel, "outdoor" | "kind" | "pano" | "cityPano" | "built">): Block[] {
  if (!lv.outdoor || lv.kind === "pier" || lv.kind === "courtyard") return [];
  const ground = lv.pano ? -lv.pano.drop : lv.cityPano ? -lv.cityPano.elev : null;
  if (ground === null || ground > -1.05) return [];
  const w = lv.built.width, d = lv.built.depth, cx = (tx(0) + tx(w - 1)) / 2, cz = (tz(0) + tz(d - 1)) / 2, top = -1, h = top - ground;
  // gövde rengi: katın en sık duvar/ayak rengi (kat boyunca dikilen katı bloklar); yoksa taş
  const tally = new Map<string, number>();
  for (const b of lv.built.blocks) if (b.g === "solid" && b.s[1] >= 1.2 && !b.r) tally.set(b.c, (tally.get(b.c) ?? 0) + b.s[0] * b.s[2]);
  const c = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "#A49A8A";
  const out: Block[] = [{ p: [cx, ground + h / 2, cz], s: [w, h, d], c, g: "solid", j: 0.03 }];
  const rows = h > 3 ? [ground + h * 0.45, ground + h * 0.78] : h > 1.6 ? [ground + h * 0.6] : [];
  for (const y of rows) {
    for (let k = 1; k < w - 1; k += 2) for (const sz of [-1, 1]) out.push({ p: [tx(k), y, cz + sz * (d / 2 + 0.02)], s: [0.42, 0.7, 0.04], c: "#2E3440", g: "solid", j: 0 });
    for (let k = 1; k < d - 1; k += 2) for (const sx of [-1, 1]) out.push({ p: [cx + sx * (w / 2 + 0.02), y, tz(k)], s: [0.04, 0.7, 0.42], c: "#2E3440", g: "solid", j: 0 });
  }
  return out;
}

const panoCache = new WeakMap<object, Block[]>();
/** Panorama blokları (taban dünya + ufuk silüeti; kaydırılmış ve kesilmiş). Kat başına önbellekli. */
export function panoramaBlocks(lv: InteriorLevel): Block[] {
  if (!lv.pano) return [];
  const hit = panoCache.get(lv);
  if (hit) return hit;
  const base = baseWorld(lv.scene);
  const out: Block[] = [];
  if (base) {
    const { dx, dz, drop, cut, clip } = lv.pano;
    const put = (b: Block) => out.push({ p: [b.p[0] + dx, b.p[1] - drop, b.p[2] + dz], s: b.s, c: b.c, g: b.g, j: b.j });
    const add = (b: Block) => {
      if (cut) {
        const x = b.p[0], zz = b.p[2], top = b.p[1] + b.s[1] / 2;
        if (x > cut.x0 && x < cut.x1 && zz > cut.z0 && zz < cut.z1 && top > cut.y) return;
        // PANO-FOOT-001: ayak izine değen yapı kırpılır (zemin levhası gövdenin altında kalır; dönen parça bütün düşer)
        if (clip && top > PANO_GROUND_TOP && b.g !== "water") {
          const s = sweptBox({ p: b.p, s: b.s }); // panorama durağan (dönme dolap dönmez): duran kutu
          if (overlaps(cut, s[0], s[1], s[4], s[5])) { clipOut(b, cut).forEach(put); return; }
        }
      }
      put(b);
    };
    for (const b of base.blocks) add(b);
    for (const b of base.backdrop ?? []) add(b);
    // NONCITY-QA: şehir dışı sahnede tabanın ötesi boş gök değil — çevre arazisinin ilk iki halkası + ufuk bandı (scenePano.ts)
    for (const b of sceneSurround(lv.scene, base)) add(b);
    // (VIEW-RING-001): kule/kale/gökdelen güvertesinin çevresinde uzak sırt — yüksek güverteden her yönde ufuk bandı dolu
    if (["tower", "castle", "skyscraper"].includes(lv.kind)) {
      const w = lv.built.width, d = lv.built.depth;
      ridgeRing(out, (tx(0) + tx(w - 1)) / 2, (tz(0) + tz(d - 1)) / 2, 74, -drop, 0.91, base.blocks.find((b) => b.p[1] < 0.1 && b.s[0] >= 4)?.c ?? "#8C8780", sceneSeed(lv.key));
    }
  }
  out.push(...levelSupport(lv)); // TOWER-GROUND-001: güverte kendi gövdesinin üstünde
  panoCache.set(lv, out);
  return out;
}

// ------------------------------------------------------------------------------------------ keşif parçası çizimi
/** Görünür (alınmamış) keşif parçalarının blokları: süzülen nesne + parıltı. Karo yürünebilir kalır. */
export function itemBlocks(lv: InteriorLevel, taken: ReadonlySet<string>): Block[] {
  const out: Block[] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, g: Group = "solid") => out.push({ p: [x, y, z], s: [w, h, d], c, g, j: 0 });
  for (const s of lv.spots) {
    if (s.kind !== "k" || taken.has(s.id)) continue;
    const x = tx(s.tile[0]), z = tz(s.tile[1]), y = 0.42;
    box(x, 0.02, z, 0.5, 0.03, 0.5, "#FDE68A", "glow");
    switch (s.model) {
      case "map": box(x, y, z, 0.42, 0.03, 0.3, "#E8D9B0"); box(x + 0.08, y + 0.02, z - 0.04, 0.06, 0.02, 0.06, "#B91C1C"); break;
      case "key": box(x, y, z, 0.34, 0.06, 0.06, "#D4A72C"); box(x - 0.18, y, z, 0.12, 0.12, 0.06, "#D4A72C"); box(x + 0.14, y - 0.05, z, 0.04, 0.08, 0.06, "#D4A72C"); break;
      case "compass": box(x, y, z, 0.3, 0.06, 0.3, "#B08D57"); box(x, y + 0.04, z, 0.04, 0.02, 0.22, "#DC2626"); break;
      case "gear": box(x, y, z, 0.3, 0.3, 0.06, "#9A7B4F"); box(x, y, z, 0.42, 0.1, 0.06, "#9A7B4F"); box(x, y, z, 0.1, 0.42, 0.06, "#9A7B4F"); break;
      default: box(x, y, z, 0.28, 0.16, 0.22, "#F5D0C5"); box(x, y + 0.06, z + 0.02, 0.18, 0.08, 0.14, "#FBE3DA"); break;
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------ ışık / gökyüzü
/** İç mekân ya da açık hava katı için sahne tanımı (gökyüzü, sis, ışık); yalnız çizim. INTERIOR-VIEW: sahne kaydından (sceneModel.ts). */
export function levelDef(base: SceneDef, lv: InteriorLevel, outsideNight = false): SceneDef {
  return recordDef(interiorRecord(lv, base, outsideNight), base);
}

/** Sahne kimliği iç mekân içerebilir mi (katalogda açık yeri olan sahne). */
export const sceneHasInteriors = (scene: string) => !!(SCENES as Record<string, unknown>)[scene] && scenePlaces(scene).doors.some((d) => d.open);

export { shift, topGrid };
