/**
 * semt üreteci: bir semti (tipik 48 × 48 karo) tohumundan belirlenimci olarak karo türlerine, parsel başına voxel
 * bloklarına (yakın + uzak ayrıntı) ve çarpışma verisine çevirir.
 *
 * - **Karo türleri:** sokak/meydan/park/ray/durak/kapı/seyir (yürünebilir) ve bina/landmark/su/çit (katı). Semt 12 × 12'lik
 * hücrelere bölünür; hücre kenarı (1 karo) her zaman sokaktır → semt kenarları ve hücreler arası 2 karoluk sokaklar bağlı bir
 * ağ kurar. Hücre içi tohumla park, meydan ya da 2/4 parsellik bina adası olur.
 * - **Ayrılmış karolar** (önce): landmark ayak izi + 1 karo meydan halkası, kapı, durak (3 × 3 meydan), giriş ve seyir noktaları,
 * hat rotası (ray). Bina adası ayrılmış karoya değerse adanın o parseli meydan olur.
 * - **Onarım:** girişlerden ulaşılamayan yürünebilir karo çit olur (sıkışma yok; CITY-MAP-REACH-001).
 * - **Çizim:** parsel (12 × 16; expanse/grid.ts PW × PD) penceresinde zemin dikdörtgen birleştirmesi, bina/landmark/durak blokları
 * (merkez karosunun parseline), uzak LOD (zemin + gövdeler). Bütçe CITY_SLOT (stream.ts) yuvalarına sığar; aşan blok
 * belirlenimci olarak düşer ve sayılır (`dropped`; denetim 0 ister).
 * - **Çarpışma:** katı karo tam karo kutusu (dünya), yürünebilir karonun üst yüzü (`top`); physics/world.ts çevre ızgarası.
 *
 * Yalnız durağan gruplar (`solid/water/glass/glow`) — +0 çizim çağrısı. Yazı, logo, bayrak, dinî simge yok (yer tutucu siluet).
 * Saf modül: React/three yok; aynı (harita, semt) → aynı çıktı.
*/
import type { Block, Group } from "../scenes";
import { mix32, prng, hash32 } from "../expanse/seed";
import { cityX, cityZ, lineRoute } from "../transit/model";
import { CITY_PD, CITY_PW, toCity, type CityDistrict, type CityMapFile, type CityTile, type DistrictTheme, type LandmarkShape, type VehicleKind } from "./format";
import type { CityRect, LandmarkCtx } from "./design";
import { designOf, landmarkModel } from "./designs";
import { assignFacadeVariants, facadeBlocks, facadeStyle, fitFacades, roofTone, type FacadeTier } from "./facade";
import { cableways, stationHouse, supportBlocks } from "./cableway";
import { gardenTiles } from "./garden";
import { hiresMapEntry, isHiResManaged, markHiResManaged } from "../hires/registry"; // LANDMARK-HIRES
import { exitPose, stopPose } from "./arrivalPoses"; // HQA-FIX-C: ölçülmüş varış/çıkış pozu karosu katılaşmaz
import { courtyardOf, rectTiles } from "../interiors/courtyards"; // COURTYARD-PORTAL
import { doorDir, ENTRY_DOOR_OWNED, ENTRY_DOOR_SLIM, entryDoorBlocks, entryGateBlocks, entryStyle, probeEntry, type EntryProbe } from "./entryDoor"; // ENTRY-DOOR-001
// LANDMARK-WALK: simge ayak izinde görünen model ile çarpışma uzlaşması (walk/landmarkWalk.ts)
import { BlockIndex, isMapGate, landmarkVisual, LW_FLOOR_MAX_CITY, LW_FOOT_CITY, LW_STEP, openLandmarkTiles, probeTile, wallBetween } from "../walk/landmarkWalk";
import { mapGates } from "../walk/landmarkGates"; // COURTYARD-PORTAL
import { INTRUDE_HARD, isObstacle, obstacleTiles } from "../walk/obstacle"; // CITYFIX1
import { KERB_AT, kerbPoles, laneBeside, LANE_MIN, streetPlugs, type KerbGrid } from "../city/kerbPoles";
import { FULL_LAMP_CORNER, FULL_VP_TREE_OFF } from "../../full/district";

// ------------------------------------------------------------------------------------------ karo türleri
export const T_STREET = 0, T_PLAZA = 1, T_PARK = 2, T_RAIL = 3, T_STOP = 4, T_DOOR = 5, T_VIEW = 6;
export const T_BUILDING = 10, T_LANDMARK = 11, T_WATER = 12, T_TREE = 13, T_HEDGE = 14;
/** tasarım katmanının katı süs karosu (avlu revakı, sur, köprü kenarı): çarpışma var, süs blokları çizer.*/
export const T_WALL = 15;
/** LANDMARK-WALK: simge ayak izinin görünen modelce boş, dışarıdan ulaşılan karosu — yürünür; zemini model çizer (sokak rengi
 *  altlık, eski `T_LANDMARK` ile aynı), yüzeyi `top` (kaide/arena döşemesi). Figüran ve sürü konmaz (simge alanı sakin kalır). */
export const T_GROUNDS = 7;
/** Ray karosu ayıran araçlar (vapur/kayık rotası suyu, teleferik havayı değiştirmez). */
const RAIL_KINDS: ReadonlySet<VehicleKind> = new Set(["tramvay", "funikuler", "metro"]);
/** CITY-POLISH (CITY-MAP-TRANSIT-001): yerde giden araçlar (ray + otobüs). Gövdeleri karodan geniş (1,3–1,4): rotanın iki yanı
 *  (8 komşu; dönüş köşelerinde 5 × 5) boş sokak koridoru olarak ayrılır — bina, ağaç, çit, lamba yok; otobüs rotası ray değil
 *  sokak karosudur. Koridora değen bina parselleri kırpılır (kalan en büyük parça). */
const GROUND_KINDS: ReadonlySet<VehicleKind> = new Set([...RAIL_KINDS, "otobus"]);
export const walkableKind = (k: number) => k < 10;
/** (WALK-BODY-001): avatar gövdesi yarıçapı ve yürüme bandı (zemine göre ayak ≤ WB_FOOT, baş ≥ WB_TOP); gövdeye sayılan
 * katı blok en az WB_MIN_H yüksek, WB_MIN_SIDE kalın, WB_MIN_AREA taban alanlı (ince direk, tezgâh levhası, düşük kenar değil).
 * scripts/ceo_eye_walk.mjs aynı ölçüyü bağımsız tutar.*/
export const WB_R = 0.28, WB_FOOT = 0.5, WB_TOP = 0.6, WB_MIN_H = 0.3, WB_MIN_SIDE = 0.2, WB_MIN_AREA = 0.2;

/** Parsel yuvası bütçesi (stream.ts CITY_LAYOUT ile aynı): yakın / uzak, grup başına. */
export const CITY_NEAR_BUDGET: Readonly<Record<"solid" | "water" | "glass" | "glow", number>> = { solid: 192, water: 24, glass: 12, glow: 12 };
export const CITY_FAR_BUDGET: Readonly<Record<"solid" | "water" | "glass" | "glow", number>> = { solid: 40, water: 8, glass: 4, glow: 4 };
/** parselin uzak LOD'unun (parıltı hariç) ortalama silüet payı — HorizonLayer parsel başına bu kadar yer ayırır; şehir toplamı buna sığar (AERIAL-LOD-003).*/
export const CITY_FAR_FILL = 24;

interface Palette { street: string; plaza: string; park: string; rail: string; hedge: string; water: string; walls: string[]; roofs: string[]; glass: string; lamp: string }
const PALETTES: Record<DistrictTheme, Palette> = {
  generic: { street: "#8C8780", plaza: "#CDBFA8", park: "#7C9F5A", rail: "#6B665F", hedge: "#4F7A3A", water: "#3E8DB5",
    walls: ["#E7D9C2", "#D9B99B", "#C9D3D8", "#E8C9A0", "#BFC7B4", "#E2D3E0"], roofs: ["#9C4A3A", "#6E5A4E", "#55606B", "#8A5A3C"], glass: "#A9CFE0", lamp: "#FFE3A3" },
  historic: { street: "#9A8F80", plaza: "#D8C7A6", park: "#7A9B58", rail: "#6B665F", hedge: "#4D7339", water: "#3C86AE",
    walls: ["#E9DCC4", "#D7BE98", "#CDB28E", "#E3D2B4"], roofs: ["#8F4636", "#7A3F31", "#6D5847"], glass: "#B7D3DE", lamp: "#FFDDA0" },
  harbor: { street: "#8A8A86", plaza: "#C4BBAA", park: "#76985A", rail: "#63605B", hedge: "#4A7036", water: "#2F7EA8",
    walls: ["#F1EDE4", "#D8E2E8", "#E6D3B8", "#C9D9CF"], roofs: ["#4E6A80", "#7C5A44", "#5A5F66"], glass: "#9FCBE3", lamp: "#FFE6AE" },
  modern: { street: "#7E8187", plaza: "#C7C9CC", park: "#6E9A55", rail: "#5D6066", hedge: "#466F35", water: "#3A88B0",
    walls: ["#DDE3E8", "#C3CDD6", "#E8E4DC", "#B9C4CC"], roofs: ["#5A6470", "#3F4852", "#6C7680"], glass: "#8EC3E6", lamp: "#F5F0D8" },
  garden: { street: "#958C7C", plaza: "#D2C6A8", park: "#6F9F4F", rail: "#6B665F", hedge: "#3F6E31", water: "#3E8DB5",
    walls: ["#EDE3CF", "#DCCFB2", "#E6D8C8"], roofs: ["#7E5139", "#5E6B44", "#8C5B3E"], glass: "#B5D8D0", lamp: "#FFE3A3" },
  bazaar: { street: "#A08D72", plaza: "#D9C29A", park: "#7C9A57", rail: "#6B665F", hedge: "#4F7338", water: "#3E8DB5",
    walls: ["#E4C79D", "#D7A878", "#E9D5B0", "#C99A6E"], roofs: ["#9A5135", "#7E4A30", "#A86A3A"], glass: "#C7DCDF", lamp: "#FFD58A" },
  hill: { street: "#8E8576", plaza: "#CDBB9C", park: "#719552", rail: "#665F57", hedge: "#476C35", water: "#3E8DB5",
    walls: ["#E6D6BC", "#D4B48E", "#C7B79E", "#E9CDA9"], roofs: ["#8C4A37", "#6F5847", "#7A4A39"], glass: "#B2D0DC", lamp: "#FFE0A0" },
};

export interface DistrictBuilding { i0: number; j0: number; w: number; d: number; h: number; wall: string; roof: string; /** kaya kütlesi (penceresiz)*/ rock?: boolean; /** cephe çeşidi (komşudan farklı)*/ fv?: number }
export interface DistrictLandmark {
  id: string; shape: LandmarkShape; i0: number; j0: number; w: number; d: number; h: number; door: CityTile | null; enterable: boolean;
  /** landmark kütüphanesinde modeli var (yakın/uzak ayrıntı; yer tutucu siluet çizilmez)*/
  model: boolean;
}

/** Bir parselin üretim çıktısı (stream.ts `StreamParcel` ile uyumlu: `near.blocks`, `far.blocks`). */
export interface CityParcel {
  cx: number; cz: number;
  district: string;
  near: { blocks: Block[]; solid: Uint8Array; box: Float32Array; walk: Uint8Array; top: Float32Array };
  far: { blocks: Block[] };
  /** bütçeye sığmayıp düşen blok (denetim 0 ister) */
  dropped: number;
  /** CORE-CITYMAP: parseldeki binaların cephe ayrıntı kademesi sayısı [−1, 0, 1, 2] (citymap/facade.ts; cephe testi) */
  facade: [number, number, number, number];
}

export interface DistrictOut {
  id: string;
  /** harita kimliği (tasarım katmanı ve landmark modelleri) */
  mapId: string;
  i0: number; j0: number; w: number; d: number;
  theme: DistrictTheme;
  /** karo türü (lj · w + li) */
  kind: Uint8Array;
  /** yürünebilir karonun zemin üst yüzü */
  top: Float32Array;
  /** yürünür yükselti (tasarım `terraces`): karonun zemin sütunu ve üstündeki işaretlerin kaldırması (0: düz)*/
  lift: Float32Array;
  /** yükselti sütununun renk dizini (`liftColors`; −1: tema rengi)*/
  liftColor: Int16Array;
  liftColors: string[];
  buildings: DistrictBuilding[];
  landmarks: DistrictLandmark[];
  /** şehir karosu */
  doors: { landmark: string; tile: CityTile }[];
  stops: { id: string; tile: CityTile; kind: VehicleKind; board?: CityTile }[];
  entries: CityTile[];
  viewpoints: CityTile[];
  /** CITY-POLISH: yerde giden aracın koridoru (rota + iki yanı; 1: lamba ve süs dikilmez) */
  corridor: Uint8Array;
  /** onarımda çite çevrilen karo */
  sealed: number;
  /** gizli köşeler (şehir karosu; sıra = gz kimliği)*/
  hidden: CityTile[];
  /** CORE-CITYMAP: semte düşen asılı hat blokları (halat, direk, istasyon; citymap/cableway.ts) — dünya koordinatı */
  cables: Block[];
  /** LANDMARK-WALK: açılan simge karosu, görünen parçası yüzünden katılaşan yürünür karo, ulaşılamadığı için geri kapanan karo */
  refusedObstacles?: { li: number; lj: number }[]; // CITYFIX1: yürünür bırakılan (koridoru keseceği için katılaştırılmayan) tezgâh/gövde karosu (kural: boş)
  droppedSolids?: { li: number; lj: number; kind: number }[]; // CITYFIX1: işlevli karoda düşen tasarım katıları (kural: boş)
  /** FIXPACK-D: 4b tezgâh / gövde kuralıyla katılaşan karo (1); `clearStopProps` ve `solidWithoutBlock` denetimi okur*/
  propWall?: Uint8Array;
  /** FIXPACK-D: kapı/durak/seyir karosunu koparan gövde duvarlarından geri alınanlar (yalnız kesen duvar; kural: boş) */
  bodyReverts?: { li: number; lj: number }[];
  /** REVFIX1: durak totemi karoları (plan dizini) — tür yürünür kalır (görüş), parsel çarpışmasında katı */
  markSolid?: ReadonlySet<number>;
  /** sokak tıkacı olduğu için geri açılan süs karosu (1); o karoda merkezi olan tasarım süsü çizilmez*/
  plugDrop?: Uint8Array;
  lwalk?: { opened: number; walled: number; reverted: number; terrain: Float32Array };
}

const groundY = 0;
const STOREY = 1.6;

/** Rota çoklu çizgisinin karoları (şehir karosu; eksen hizalı ya da Bresenham). */
function rasterRoute(route: readonly CityTile[]): CityTile[] {
  const out: CityTile[] = [];
  for (let k = 0; k + 1 < route.length; k++) {
    let [x0, y0] = route[k];
    const [x1, y1] = route[k + 1];
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      out.push([x0, y0]);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  return out;
}

const districtCache = new Map<string, DistrictOut>();
/** Denetim (belirlenimcilik) için önbelleği boşaltır. */
export function clearDistrictCache() { districtCache.clear(); districtGen++; }
let districtGen = 0;
/** semt planı önbelleğinin kuşağı (boşaltma/çıkarmada artar) — plan/parsel türevini önbelleğe alan (camera/world.ts parsel halkası) eskimeyi bununla anlar.*/
export const districtCacheGen = () => districtGen;

/** Semt karo planı (önbellekli). */
export function districtPlan(map: CityMapFile, dist: CityDistrict): DistrictOut {
  const ck = `${map.id}:${dist.id}:${dist.seed}`;
  const hit = districtCache.get(ck);
  if (hit) return hit;
  const out = planDistrict(map, dist);
  applyCables(map, dist, out);
  if (districtCache.size > 16) { districtCache.delete(districtCache.keys().next().value as string); districtGen++; }
  districtCache.set(ck, out);
  return out;
}

/**
 * CORE-CITYMAP: asılı hatlar (citymap/cableway.ts) — semte düşen halat parçaları, direkler ve istasyon gövdeleri `cables`'a. Direk
 * karosunun türü DEĞİŞMEZ (CITY-PASS-BCN: önceden yürünebilir direk karosu `T_WALL` olup halat altındaki yolu/patikayı kesiyordu);
 * yürünebilir karodaki direk ince çizilir (`supportBlocks(…, narrow)`). Test: scripts/cable_path.test.mjs.
 * Semt dışına (semtler arası boşluk) düşen blok en yakın semte gider.
 */
/** Asılı hatlar uygulanmadan önceki plan (önbelleksiz; denetim: halat/direk yürünebilir karo yemez). */
export function districtPlanBase(map: CityMapFile, dist: CityDistrict): DistrictOut { return planDistrict(map, dist); }

function applyCables(map: CityMapFile, dist: CityDistrict, out: DistrictOut) {
  out.cables = [];
  const ways = cableways(map);
  if (!ways.length) return;
  const [i0, j0, w, d] = dist.bounds;
  const tileOf = (x: number, z: number): CityTile => [Math.floor(x + 12), Math.floor(z + 8)];
  const gap = (b: readonly number[], I: number, J: number) => Math.max(b[0] - I, 0, I - (b[0] + b[2] - 1)) + Math.max(b[1] - J, 0, J - (b[1] + b[3] - 1));
  const home = (x: number, z: number) => {
    const [I, J] = tileOf(x, z);
    let best = map.districts[0], bg = Infinity;
    for (const o of map.districts) { const g = gap(o.bounds, I, J); if (g < bg) { bg = g; best = o; } }
    return best.id === dist.id;
  };
  for (const cw of ways) {
    for (const b of cw.rope) if (home(b.p[0], b.p[2])) out.cables.push(b);
    for (const sp of cw.supports) {
      if (!home(sp.x, sp.z)) continue;
      const [I, J] = tileOf(sp.x, sp.z), li = I - i0, lj = J - j0;
      let ground = 0, narrow = false;
      if (li >= 0 && lj >= 0 && li < w && lj < d) {
        const k = lj * w + li, kd = out.kind[k];
        ground = kd === T_WATER ? -0.25 : out.lift[k];
        // CITY-PASS-BCN: direk yürünebilir karoyu (yol, meydan, rampa) KATILAŞTIRMAZ — yol/patika kesilmez (ürün sahibi: "teleferiğin altındaki
        // yoldan geçemiyor"); yürünebilir karoda direk ince gövdeyle çizilir (karo ortası açık kalır, ince çarpıştırıcı)
        narrow = walkableKind(kd);
      }
      let at = sp;
      if (narrow) {
        // (WALK-CLEAR): ince direk koridoru < 2 şeride indiriyorsa karo içinde yürünmez komşunun kenarına (kaldırım) alınır
        const wk = (a: number, c: number) => a < 0 || c < 0 || a >= w || c >= d || walkableKind(out.kind[c * w + a]);
        if ((laneBeside(wk, li, lj) ?? LANE_MIN) < LANE_MIN) {
          const cx = I - 12, cz = J - 8, fx = sp.x - cx, fz = sp.z - cz;
          let best: [number, number] | null = null, bd = Infinity;
          for (const [a, c, px, pz] of [[-1, 0, KERB_AT, fz], [1, 0, 1 - KERB_AT, fz], [0, -1, fx, KERB_AT], [0, 1, fx, 1 - KERB_AT]] as const) {
            if (wk(li + a, lj + c)) continue;
            const dd = Math.hypot(px - fx, pz - fz);
            if (dd < bd) { bd = dd; best = [px, pz]; }
          }
          if (best) at = { ...sp, x: cx + best[0], z: cz + best[1] };
        }
      }
      out.cables.push(...supportBlocks(at, ground, narrow));
    }
    for (const end of [0, 1]) {
      const st = cw.supports.filter((q) => q.kind === "station");
      const pick = st.filter((q, _k, all) => (end === 0 ? q === all[0] : q === all[all.length - 1]))[0];
      if (pick && home(pick.rx, pick.rz)) out.cables.push(...stationHouse(pick.rx, pick.ry, pick.rz));
    }
  }
}

function planDistrict(map: CityMapFile, dist: CityDistrict): DistrictOut {
  const [i0, j0, w, d] = dist.bounds;
  const r = prng(mix32(dist.seed, hash32(dist.id)));
  const kind = new Uint8Array(w * d).fill(T_STREET);
  const top = new Float32Array(w * d).fill(groundY);
  const reserved = new Uint8Array(w * d);
  const at = (li: number, lj: number) => lj * w + li;
  const inside = (li: number, lj: number) => li >= 0 && lj >= 0 && li < w && lj < d;
  const reserve = (li: number, lj: number, k: number) => { if (inside(li, lj)) { kind[at(li, lj)] = k; reserved[at(li, lj)] = 1; } };
  const ring = (li: number, lj: number, rr: number, k: number, keepSys = false) => {
    for (let b = -rr; b <= rr; b++) for (let a = -rr; a <= rr; a++) {
      const x = li + a, z = lj + b;
      // METRO1: durak/giriş/seyir halkası ray ve durak/kapı/seyir karosunu ezmez (ray süreksizliği: ürün sahibi "raylar kesintiye uğruyor")
      if (inside(x, z) && kind[at(x, z)] !== T_LANDMARK && !(keepSys && (kind[at(x, z)] === T_RAIL || kind[at(x, z)] === T_STOP || kind[at(x, z)] === T_DOOR || kind[at(x, z)] === T_VIEW))) reserve(x, z, k);
    }
  };

  // 1) landmarklar: ayak izi + meydan halkası + kapı
  const landmarks: DistrictLandmark[] = [];
  // LANDMARK-WALK: açılan/katılaşan simge karoları; zemin yüksekliği (tasarım `terraces`, adım 6 ile aynı geometri) — yamaçtaki
  // simgenin görünen modeli zemine göre yoklanır
  const lwOpen = new Uint8Array(w * d), lwWall = new Uint8Array(w * d), lwStat = { opened: 0, walled: 0, reverted: 0 };
  const terrain = new Float32Array(w * d);
  for (const t of designOf(map.id)?.districts[dist.id]?.terraces ?? []) {
    const [x0, z0, rw, rd] = t.rect, dir = t.dir ?? "+j", y1 = t.y1 ?? t.y, n = dir === "+i" || dir === "-i" ? rw : rd;
    for (let z = z0; z < z0 + rd; z++) for (let x = x0; x < x0 + rw; x++) {
      if (!inside(x, z)) continue;
      const st = dir === "+i" ? x - x0 : dir === "-i" ? x0 + rw - 1 - x : dir === "+j" ? z - z0 : z0 + rd - 1 - z;
      terrain[at(x, z)] = n > 1 ? +(t.y + ((y1 - t.y) * st) / (n - 1)).toFixed(3) : t.y;
    }
  }
  for (const lm of dist.landmarks) {
    const [a0, b0] = lm.tile;
    for (let b = -1; b <= lm.d; b++) for (let a = -1; a <= lm.w; a++) {
      const x = a0 + a, z = b0 + b;
      if (!inside(x, z)) continue;
      const foot = a >= 0 && b >= 0 && a < lm.w && b < lm.d;
      reserve(x, z, foot ? T_LANDMARK : T_PLAZA);
    }
    if (lm.door) { ring(lm.door[0], lm.door[1], 1, T_PLAZA); reserve(lm.door[0], lm.door[1], T_DOOR); }
    // TOUR-VIEW (LANDMARK-GARDEN-001): bahçe / avlu / sur içi — modelin boş bıraktığı aday karolar ve kapılar yürünür (garden.ts)
    const gm = landmarkModel(map.id, lm.id);
    // LANDMARK-WALK: bahçe ve ayak izi YAKINDA görünen modelle (hi kayıtlıysa hi) ölçülür — orta modelle değil
    const gx = cityX(i0) - 0.5 + a0, gz = cityZ(j0) - 0.5 + b0;
    const gctx = { x0: gx, z0: gz, w: lm.w, d: lm.d, h: lm.h, cx: gx + lm.w / 2, cz: gz + lm.d / 2 };
    const gvis = gm ? landmarkVisual(map.id, lm.id, gm, gctx) : null;
    if (gm?.garden) {
      const gt = gardenTiles(gm, gctx, gvis!);
      for (const [a, b] of gt.walk) reserve(a0 + a, b0 + b, gm.garden.floor === "plaza" ? T_PLAZA : T_PARK);
    }
    // LANDMARK-WALK: ayak izinin görünen modelce boş (yürüme bandında ±0,3) ve dışarıdaki yürünür karodan basamakla (≤ 0,35)
    // ulaşılan karoları yürünür — görünmez duvar yok. Kapalı cep (kapısız avlu, kule içi) ve kutsal simgenin tavanlı karosu katı.
    if (gm && gvis) {
      const gidx = new BlockIndex(gvis), probes = [];
      for (let b = 0; b < lm.d; b++) for (let a = 0; a < lm.w; a++) {
        const tb = inside(a0 + a, b0 + b) ? terrain[at(a0 + a, b0 + b)] : 0;
        probes.push(probeTile(gidx, gx + a + 0.5, gz + b + 0.5, { base: tb, foot: LW_FOOT_CITY, floorMax: LW_FLOOR_MAX_CITY }));
      }
      const surf = (x: number, z: number) => (inside(x, z) && walkableKind(kind[at(x, z)]) ? Math.max(top[at(x, z)], terrain[at(x, z)]) : NaN);
      for (const t of openLandmarkTiles(probes, lm.w, lm.d, !!gm.sacred, (a, b) => surf(a0 + a, b0 + b), (a, b) => surf(a0 + a, b0 + b), (a, b) => isMapGate(map.id, lm.id, a, b))) {
        const x = a0 + t.a, z = b0 + t.b;
        if (!inside(x, z) || kind[at(x, z)] !== T_LANDMARK) continue;
        reserve(x, z, T_GROUNDS); top[at(x, z)] = t.floor; lwOpen[at(x, z)] = 1; lwStat.opened++;
      }
    }
    landmarks.push({ id: lm.id, shape: lm.shape, i0: a0, j0: b0, w: lm.w, d: lm.d, h: lm.h, door: lm.door ?? null, enterable: !!lm.interior,
      model: !!landmarkModel(map.id, lm.id) });
  }
  // 2) hat rotaları (ray; otobüste sokak) — semt içinde kalan karolar; CITY-POLISH: iki yanda boş koridor (araç gövdesi taşar)
  const corridor = new Uint8Array(w * d);
  for (const line of map.lines) {
    if (!GROUND_KINDS.has(line.kind)) continue;
    const tiles = rasterRoute(lineRoute(map, line));
    for (const [I, J] of tiles) {
      const li = I - i0, lj = J - j0;
      if (inside(li, lj) && kind[at(li, lj)] !== T_LANDMARK && !(kind[at(li, lj)] === T_RAIL && !RAIL_KINDS.has(line.kind))) reserve(li, lj, RAIL_KINDS.has(line.kind) ? T_RAIL : T_STREET); // METRO1: otobüs geçidi rayı ezmez
    }
    // yan açıklık ±1; dönüş köşelerinde ±2 (köşeye varan gövdenin burnu yarı boy kadar ileri taşar)
    const clear = (I: number, J: number, rr: number) => {
      for (let b = -rr; b <= rr; b++) for (let a = -rr; a <= rr; a++) {
        const li = I - i0 + a, lj = J - j0 + b;
        if (!inside(li, lj)) continue;
        corridor[at(li, lj)] = 1;
        if (!reserved[at(li, lj)]) reserve(li, lj, T_STREET);
      }
    };
    for (const [I, J] of tiles) clear(I, J, 1);
    for (const [I, J] of lineRoute(map, line)) clear(I, J, 2);
  }
  /** CITY-POLISH: dikdörtgenden ulaşım koridoru dışında kalan en büyük kenar parçası (sol/sağ/üst/alt; bina koridora girmez). */
  const trimToCorridor = <T extends { i0: number; j0: number; w: number; d: number }>(r: T): T => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let z = r.j0; z < r.j0 + r.d; z++) for (let x = r.i0; x < r.i0 + r.w; x++) if (inside(x, z) && corridor[at(x, z)]) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    if (x0 === Infinity) return r;
    const parts = [
      { ...r, w: x0 - r.i0 }, { ...r, i0: x1 + 1, w: r.i0 + r.w - 1 - x1 },
      { ...r, d: z0 - r.j0 }, { ...r, j0: z1 + 1, d: r.j0 + r.d - 1 - z1 },
    ];
    return parts.reduce((best, q) => (Math.max(0, q.w) * Math.max(0, q.d) > Math.max(0, best.w) * Math.max(0, best.d) ? q : best));
  };

  // 3) duraklar, girişler, seyir noktaları
  const stops = map.stops.filter((s) => s.district === dist.id);
  // (ürün sahibi 2026-10-31, <city> seyir noktası: "merdivenden düşülüyor, duvarın içinden geçiliyor"): durak/giriş/seyir halkası tasarım
  // `solid` duvarını DELMEZ — halka meydanı yalnız boş karoya serilir (soft); eskiden halka duvar karosunu açık bırakıp çizilen duvarın
  // içinden ve yükselti basamağından boşluğa geçit açıyordu (ceo_eye_walk.mjs)
  const soft = new Uint8Array(w * d);
  const softRing = (li: number, lj: number, k: number) => {
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if ((a || b) && inside(li + a, lj + b) && kind[at(li + a, lj + b)] !== T_LANDMARK && !reserved[at(li + a, lj + b)]) soft[at(li + a, lj + b)] = 1;
    ring(li, lj, 1, k, true);
  };
  for (const s of stops) { softRing(s.tile[0], s.tile[1], T_PLAZA); reserve(s.tile[0], s.tile[1], T_STOP); top[at(s.tile[0], s.tile[1])] = 0; } // durak karosu yerle aynı hizada (eskiden 0,1 m kaide)
  for (const s of stops) if (s.board) softRing(s.board[0], s.board[1], T_PLAZA); // CABLEVP1: biniş platformu meydan halkası
  for (const e of dist.entries) softRing(e[0], e[1], T_PLAZA);
  for (const v of dist.viewpoints ?? []) { softRing(v[0], v[1], T_PLAZA); reserve(v[0], v[1], T_VIEW); }
  // rotanın üstüne gelen meydan/durak karoları ray rengini değil kendi türünü korur (yukarıdaki sıra)
  // LANDMARK-WALK: simgenin görünen parçası (ayak izi dışına taşan kemer ayağı, merdiven, kanat) yürünür bir karonun ortasını yürüme
  // bandında kesiyorsa karo katı süs olur (`T_WALL`; içinden geçilmez). Kapı, durak, giriş, seyir ve ray karosu değişmez.
  // HQA-FIX-C: ölçülmüş durak varış / kapı çıkış pozunun karosu (yerel) gövde/simge katılaştırmasından korunur
  const poseT = new Set<string>();
  for (const s of stops) { const f = stopPose(map.id, toCity(dist, s.tile)); if (f) poseT.add(`${f.tile[0] - i0},${f.tile[1] - j0}`); }
  for (const lm of dist.landmarks) if (lm.door) { const f = exitPose(map.id, toCity(dist, lm.door)); if (f) poseT.add(`${f.out[0] - i0},${f.out[1] - j0}`); }
  {
    const keepT = new Set<string>([...dist.entries.map((e) => `${e[0]},${e[1]}`), ...poseT]);
    for (const lm of dist.landmarks) {
      const gm = landmarkModel(map.id, lm.id);
      if (!gm) continue;
      const [a0, b0] = lm.tile, gx = cityX(i0) - 0.5 + a0, gz = cityZ(j0) - 0.5 + b0;
      const vctx = { x0: gx, z0: gz, w: lm.w, d: lm.d, h: lm.h, cx: gx + lm.w / 2, cz: gz + lm.d / 2 }, vis = landmarkVisual(map.id, lm.id, gm, vctx);
      const vidx = new BlockIndex(vis);
      for (let b = -2; b < lm.d + 2; b++) for (let a = -2; a < lm.w + 2; a++) {
        const x = a0 + a, z = b0 + b;
        if (!inside(x, z)) continue;
        const k = at(x, z), kd = kind[k];
        if (!walkableKind(kd) || kd === T_DOOR || kd === T_STOP || kd === T_VIEW || kd === T_RAIL || keepT.has(`${x},${z}`)) continue;
        // kapı önü (iç mekândan çıkış karosu, citymap/doorExit.ts) katılaşmaz
        if ([[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]].some(([p, q]) => inside(x + p, z + q) && kind[at(x + p, z + q)] === T_DOOR)) continue;
        if (probeTile(vidx, gx + a + 0.5, gz + b + 0.5, { base: Math.max(top[k], terrain[k]), foot: LW_FOOT_CITY, floorMax: LW_STEP }).center) {
          kind[k] = T_WALL; reserved[k] = 1; lwOpen[k] = 0; lwWall[k] = 1; lwStat.walled++;
        }
      }
      // COURTYARD-PORTAL (WALK-LANDMARK-WALL-001): duvarlı alanda (avlu/sur içi bahçe, oyulmuş kapı, avlu portalı) iki yürünür karo
      // arasındaki adım görünen duvarı (karo kenarına oturan ince duvar, sütun) kesiyorsa ikinci karo katılaşır — duvarın içinden geçilmez
      if (gm.garden?.kind === "court" || gm.garden?.kind === "bailey" || mapGates(map.id, lm.id) || courtyardOf(map.id, lm.id)) {
        const gardenK = new Set(gm.garden ? gardenTiles(gm, vctx, vis).walk.map(([ga, gb]) => `${ga},${gb}`) : []);
        const free = (x: number, z: number) => {
          if (!inside(x, z)) return false;
          const kd = kind[at(x, z)];
          return walkableKind(kd) && kd !== T_DOOR && kd !== T_STOP && kd !== T_VIEW && kd !== T_RAIL && !keepT.has(`${x},${z}`);
        };
        for (let b = -3; b < lm.d + 3; b++) for (let a = -8; a < lm.w + 3; a++) {
          const x = a0 + a, z = b0 + b;
          if (!free(x, z)) continue;
          for (const [da, db] of [[1, 0], [0, 1]] as const) {
            if (!free(x + da, z + db)) continue;
            const k1 = at(x, z), k2 = at(x + da, z + db);
            if (!wallBetween(vidx, gx + a + 0.5, gz + b + 0.5, Math.max(top[k1], terrain[k1]), gx + a + da + 0.5, gz + b + db + 0.5, Math.max(top[k2], terrain[k2]), LW_FOOT_CITY)) continue;
            // bahçe/avlu karosu (garden.ts) açık kalır: duvarın öbür yanı katılaşır
            const k = gardenK.has(`${a + da},${b + db}`) && !gardenK.has(`${a},${b}`) ? k1 : k2;
            kind[k] = T_WALL; reserved[k] = 1; lwOpen[k] = 0; lwWall[k] = 1; lwStat.walled++;
          }
        }
      }
    }
  }

  // COURTYARD-PORTAL: duvarlı avlu (interiors/courtyards.ts) dışarıdan yürünmez — duvar, kapı açıklığı ve avlu içi katı (model çizer);
  // avluya landmark kapısındaki portaldan (`interior: "courtyard"`) ayrı sahneye geçilir. Kapı önü muafiyeti burada yok.
  for (const lm of dist.landmarks) {
    const cy = courtyardOf(map.id, lm.id)?.map;
    if (!cy) continue;
    for (const [a, b] of rectTiles(cy.rect)) {
      const x = lm.tile[0] + a, z = lm.tile[1] + b;
      if (!inside(x, z) || kind[at(x, z)] === T_DOOR) continue;
      kind[at(x, z)] = T_WALL; reserved[at(x, z)] = 1; lwOpen[at(x, z)] = 0;
    }
  }

  // 3b) tasarım katmanı (şehre özgü coğrafya): su → kaplama/meydan/park → katı süs → açık binalar → gizli köşeler.
  //     `reserved` 1: sistem (landmark, ray, durak, giriş, seyir; tasarım ezmez), 2: tasarım (hücreler ezmez).
  const design = designOf(map.id)?.districts[dist.id] ?? null;
  const hidden: CityTile[] = [];
  const droppedSolids: { li: number; lj: number; kind: number }[] = [];
  const refusedObstacles: { li: number; lj: number }[] = [];
  const buildings: DistrictBuilding[] = [];
  if (design) {
    const each = (rects: readonly CityRect[] | undefined, fn: (li: number, lj: number, k: number) => void) => {
      for (const [x0, z0, rw, rd] of rects ?? []) for (let z = z0; z < z0 + rd; z++) for (let x = x0; x < x0 + rw; x++) if (inside(x, z)) fn(x, z, at(x, z));
    };
    each(design.water, (_x, _z, k) => { if (!reserved[k]) { kind[k] = T_WATER; reserved[k] = 2; } });
    const open = (k: number) => !reserved[k] || (reserved[k] === 2 && kind[k] === T_WATER);
    each(design.pave, (_x, _z, k) => { if (open(k)) { kind[k] = T_STREET; reserved[k] = 2; } });
    each(design.plaza, (_x, _z, k) => { if (open(k)) { kind[k] = T_PLAZA; reserved[k] = 2; } });
    each(design.park, (x, z, k) => {
      if (!open(k)) return;
      // belirlenimci ağaçlar: 3 × 3 kafeste, tohumla kaydırılmış; aralarında yol kalır
      const tree = x % 3 === 1 && z % 3 === 1 && ((x * 7 + z * 13 + dist.seed) % 5) !== 0;
      kind[k] = tree ? T_TREE : T_PARK; reserved[k] = 2;
    });
    // CITYFIX1 (sessiz düşen katı yok): sistem karosu (landmark/ray/durak/giriş/seyir/kapı) üstündeki katı eskiden SESSİZCE düşüyordu
    //   (<city> kahvehane tezgâhı yürünüyordu). Artık işlevsiz sistem karosu (halka meydanı, düz sokak) katı olur; işlevli karo
    //   (kapı/durak/seyir/ray/landmark ayak izi) korunur ama `droppedSolids`a yazılır — kalıcı kural boş olmasını ister.
    each(design.solid, (x, z, k) => {
      if (reserved[k] !== 1 || (soft[k] && kind[k] === T_PLAZA)) { kind[k] = T_WALL; reserved[k] = 2; return; }
      const kd = kind[k];
      if (kd === T_PLAZA || kd === T_STREET || kd === T_PARK) {
        const entry = dist.entries.some((e) => e[0] === x && e[1] === z);
        if (!entry) { kind[k] = T_WALL; reserved[k] = 2; return; }
      }
      if (walkableKind(kd)) droppedSolids.push({ li: x, lj: z, kind: kd });
    }); // yumuşak halka duvarı delmez
    for (const bd0 of design.buildings ?? []) {
      const bd = trimToCorridor(bd0);
      let clash = bd.w < 1 || bd.d < 1;
      for (let z = bd.j0; z < bd.j0 + bd.d && !clash; z++) for (let x = bd.i0; x < bd.i0 + bd.w; x++) if (!inside(x, z) || reserved[at(x, z)] === 1) { clash = true; break; }
      if (clash) continue;
      for (let z = bd.j0; z < bd.j0 + bd.d; z++) for (let x = bd.i0; x < bd.i0 + bd.w; x++) { kind[at(x, z)] = T_BUILDING; reserved[at(x, z)] = 2; }
      // tasarım binasının çatısı da bina başına ton alır (konumdan; tohum dizisi değişmez)
      buildings.push({ i0: bd.i0, j0: bd.j0, w: bd.w, d: bd.d, h: bd.h, wall: bd.wall, roof: bd.rock ? bd.roof : roofTone(bd.roof, (((bd.i0 * 7 + bd.j0 * 13) % 3) + 3) % 3 / 3), ...(bd.rock ? { rock: true } : {}) });
    }
    for (const t of design.hidden ?? []) {
      if (!inside(t[0], t[1])) continue;
      const k = at(t[0], t[1]);
      if (!walkableKind(kind[k]) || reserved[k] !== 1) { if (!walkableKind(kind[k])) kind[k] = T_STREET; reserved[k] = 1; }
      hidden.push(toCity(dist, t));
    }
  }

  // 4) hücreler: kenar sokak, içi park / meydan / bina adası
  const harbor = dist.theme === "harbor" && !design?.water;
  const cellStart = buildings.length; // bundan sonrakiler hücre (4. adım) binası
  const fstyle = facadeStyle(map.id, dist.theme);
  for (let cj = 0; cj * 12 < d; cj++) for (let ci = 0; ci * 12 < w; ci++) {
    const x0 = ci * 12 + 1, z0 = cj * 12 + 1, x1 = Math.min(w - 1, ci * 12 + 11), z1 = Math.min(d - 1, cj * 12 + 11);
    if (x1 - x0 < 4 || z1 - z0 < 4) continue;
    const p = r();
    // liman: güney (+z) kenar hücre sırası iskele suyu (kenar sokağı kalır)
    if (harbor && z1 >= d - 1 - 1 && cj * 12 + 12 >= d) {
      for (let z = Math.max(z0, d - 7); z < z1; z++) for (let x = x0; x < x1; x++) if (!reserved[at(x, z)]) kind[at(x, z)] = T_WATER;
      continue;
    }
    if (p < 0.14) {
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (!reserved[at(x, z)]) kind[at(x, z)] = T_PARK;
      for (let n = 0; n < 4; n++) {
        const x = x0 + 1 + Math.floor(r() * (x1 - x0 - 2)), z = z0 + 1 + Math.floor(r() * (z1 - z0 - 2));
        if (!reserved[at(x, z)] && kind[at(x, z)] === T_PARK) kind[at(x, z)] = T_TREE;
      }
      continue;
    }
    if (p < 0.3) {
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (!reserved[at(x, z)]) kind[at(x, z)] = T_PLAZA;
      continue;
    }
    // bina adası: 2 (yatay) ya da 4 parsel; parseller arası 2 karoluk geçit
    const four = p > 0.65;
    const W0 = x1 - x0, D0 = z1 - z0;
    const lots: [number, number, number, number][] = four
      ? [[x0, z0, Math.floor((W0 - 2) / 2), Math.floor((D0 - 2) / 2)], [x0 + Math.floor((W0 - 2) / 2) + 2, z0, W0 - Math.floor((W0 - 2) / 2) - 2, Math.floor((D0 - 2) / 2)],
        [x0, z0 + Math.floor((D0 - 2) / 2) + 2, Math.floor((W0 - 2) / 2), D0 - Math.floor((D0 - 2) / 2) - 2], [x0 + Math.floor((W0 - 2) / 2) + 2, z0 + Math.floor((D0 - 2) / 2) + 2, W0 - Math.floor((W0 - 2) / 2) - 2, D0 - Math.floor((D0 - 2) / 2) - 2]]
      : [[x0, z0, W0, Math.floor((D0 - 2) / 2)], [x0, z0 + Math.floor((D0 - 2) / 2) + 2, W0, D0 - Math.floor((D0 - 2) / 2) - 2]];
    for (const [lx0, lz0, lw0, ld0] of lots) {
      if (lw0 < 2 || ld0 < 2) continue;
      // CITY-POLISH: ulaşım koridoru parselin kenarına değiyorsa kenar sırası/sütunu kırpılır (bina koridora girmez, ada boşalmaz)
      const { i0: lx, j0: lz, w: lw, d: ld } = trimToCorridor({ i0: lx0, j0: lz0, w: lw0, d: ld0 });
      let clash = lw < 2 || ld < 2;
      for (let z = lz; z < lz + ld && !clash; z++) for (let x = lx; x < lx + lw; x++) if (reserved[at(x, z)]) { clash = true; break; }
      const storeys = 1 + Math.floor(r() * 3);
      // CORE-CITYMAP: cephe ve çatı rengi şehrin stilinden (citymap/facade.ts); r() çağrı sayısı aynı → yerleşim değişmez
      const wall = fstyle.walls[Math.floor(r() * fstyle.walls.length)];
      const roof = roofTone(fstyle.roof, r()); // çatı tonu bina başına (eski çatı rengi seçiminin sayısı; tohum dizisi korunur)
      for (let z = lz0; z < lz0 + ld0; z++) for (let x = lx0; x < lx0 + lw0; x++) {
        const inLot = !clash && x >= lx && z >= lz && x < lx + lw && z < lz + ld;
        if (!reserved[at(x, z)]) kind[at(x, z)] = inLot ? T_BUILDING : T_PLAZA;
      }
      if (!clash) buildings.push({ i0: lx, j0: lz, w: lw, d: ld, h: +(storeys * STOREY + 0.4).toFixed(2), wall, roof });
    }
  }

  // seyir kadrajının orta bandındaki plan ağacı karosu serbest zemine çevrilir (karo da çizim de kalkar: görünmez engel kalmaz).
  // Liste scripts/vp_near_check.mjs `scanVpTrees` (VP-NEAR-002 ağaç) ile doğrulanır; yeni ağaç girerse tarama kırmızı olur.
  for (const [ti, tj] of VP_TREE_OFF[map.id] ?? []) if (inside(ti - i0, tj - j0) && kind[at(ti - i0, tj - j0)] === T_TREE) kind[at(ti - i0, tj - j0)] = T_PARK;

  // (ürün sahibi 2026-10-31 "merdivenden düşülüyor"): iki yürünür komşu karonun zemini merdivensiz bir adımdan (STEP_H 0,35) fazla
  // ayrılırsa oyuncu uçurumdan düşer ya da çıkamaz. Yüksek karo (durak/kapı/seyir değilse; yoksa alçak karo) istinat duvarı olur: katı
  // (`T_WALL`), yükselti sütunu çizilmeye devam eder (`ledge`). Basamak ≤ 0,35 olan rampalar etkilenmez. Sonra 5. adım ulaşılamayan
  // cepleri çite çevirir. Denetim: scripts/ceo_eye_walk.mjs (WALK-STEP-001).
  const ledge = new Uint8Array(w * d);
  {
    const h = (k: number) => (lwOpen[k] ? top[k] : terrain[k] > 0 ? terrain[k] : top[k]);
    const keep = new Set((design?.hidden ?? []).filter((t) => inside(t[0], t[1])).map((t) => at(t[0], t[1])));
    const prot = (k: number) => kind[k] === T_STOP || kind[k] === T_DOOR || kind[k] === T_VIEW || keep.has(k);
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (let lj = 0; lj < d; lj++) for (let li = 0; li < w; li++) {
        const k = at(li, lj);
        if (!walkableKind(kind[k])) continue;
        for (const [a, b] of [[1, 0], [0, 1]] as const) {
          if (!inside(li + a, lj + b)) continue;
          const k2 = at(li + a, lj + b);
          if (!walkableKind(kind[k2]) || Math.abs(h(k) - h(k2)) <= 0.35 + 1e-6) continue;
          const hi = h(k) > h(k2) ? k : k2, lo = hi === k ? k2 : k;
          const pick = !prot(hi) ? hi : !prot(lo) ? lo : -1;
          if (pick < 0) continue;
          kind[pick] = T_WALL; lwOpen[pick] = 0; if (pick === hi) ledge[pick] = 1; changed = true;
        }
      }
      if (!changed) break;
    }
  }

  // FIXPACK-D: durak çevresinde çizimden kaldırılacak sokak eşyası (`clearStopProps`, aynı kural) karoyu katılaştırmaz: eskiden eşya çizilmiyor ama
  // 4b / gövde kuralıyla katılaşmış karo kalıyordu (iskele durağında boş görünen karoya çarpma). Anahtar: blok geometrisi.
  const bkey = (b: Block) => `${b.p.map((v) => v.toFixed(3))}|${b.s.map((v) => v.toFixed(3))}`;
  const stopClear = new Set<string>();
  if (design && stops.length) {
    const ox = cityX(i0) - 0.5, oz = cityZ(j0) - 0.5, all: Block[] = [...(design.decor?.({ ox, oz }) ?? [])], eyes: [number, number, number][] = [];
    for (const lm of dist.landmarks) {
      const gm = landmarkModel(map.id, lm.id);
      if (!gm) continue;
      const gx = ox + lm.tile[0], gz = oz + lm.tile[1], vc = { x0: gx, z0: gz, w: lm.w, d: lm.d, h: lm.h, cx: gx + lm.w / 2, cz: gz + lm.d / 2 };
      all.push(...gm.near(vc), ...landmarkVisual(map.id, lm.id, gm, vc));
    }
    for (const st of stops) for (const t of st.board ? [st.tile, st.board] : [st.tile]) if (inside(t[0], t[1])) eyes.push(...stopEyes(ox, oz, t[0], t[1], terrain[at(t[0], t[1])])); // CABLEVP1: biniş platformu da
    // yapıya değen eşya yapının parçasıdır (çizimde kalır): bina ayak izi ve plan ağaçları bağlayıcı sayılır
    for (const bd of buildings) all.push({ p: [ox + bd.i0 + bd.w / 2, bd.h / 2, oz + bd.j0 + bd.d / 2], s: [bd.w, bd.h, bd.d], c: "#000", g: "solid", j: 0 });
    for (let k = 0; k < w * d; k++) if (kind[k] === T_TREE) {
      const x = ox + (k % w) + 0.5, z = oz + Math.floor(k / w) + 0.5;
      all.push(planTree({ p: [x, 0.7, z], s: [0.22, 1.4, 0.22], c: "#000", g: "solid", j: 0 }), planTree({ p: [x, 2.05, z], s: [1, 1.3, 1], c: "#000", g: "solid", j: 0 }));
    }
    for (const b of stopClearDrops(all, eyes)) stopClear.add(bkey(b));
  }

  const decorWall = new Uint8Array(w * d); // merkezi bu karoda olan tasarım süsü (simge değil) yüzünden katılaşan karo
  // 4b) CITYFIX1 (B9 tezgâh katılığı, tüm şehirler): tezgâh biçimli dolu nesne (yerden yükselen, üstü 0,7–1,6, ayak izi iki yönde ≥ 0,35;
  //     pazar/baharat tezgâhı, kiosk) yürünür karoya taşıyorsa o karo katı süs olur — alçak olduğu için `LW_STEP` basamağı sanılıp
  //     içinden geçilmesin (İstanbul baharat tezgâhları, <city> meyve suyu kiosku, <city> kahve tezgâhı). Kapı/durak/seyir/ray/giriş korunur.
  if (design) {
    const ox = cityX(i0) - 0.5, oz = cityZ(j0) - 0.5;
    const keep = new Set<string>([...[...dist.entries, ...(design.hidden ?? [])].map((e) => `${e[0]},${e[1]}`), ...poseT]); // giriş, gizli köşe ve ölçülmüş durak varış / kapı çıkış pozu karosu korunur (FIXPACK-D: poseT eksikti)
    const src: Block[] = [...(design.decor?.({ ox, oz }) ?? [])];
    const decorN = src.length; // src[0..decorN) tasarım süsü (simge görünen modeli değil)
    for (const lm of dist.landmarks) {
      const gm = landmarkModel(map.id, lm.id);
      if (!gm) continue;
      const gx = ox + lm.tile[0], gz = oz + lm.tile[1];
      const vctx2 = { x0: gx, z0: gz, w: lm.w, d: lm.d, h: lm.h, cx: gx + lm.w / 2, cz: gz + lm.d / 2 }, vis2 = landmarkVisual(map.id, lm.id, gm, vctx2);
      src.push(...vis2);
      if (gm.garden) for (const [ga, gb] of gardenTiles(gm, vctx2, vis2).walk) keep.add(`${lm.tile[0] + ga},${lm.tile[1] + gb}`); // bahçe karoları yürünür kalır
    }
    // bağlantı bekçisi (FIXPACK-D): karo, girişlerden ulaşılan KAPI/DURAK/SEYİR karosunun hiçbirini ulaşılamaz bırakıyorsa katılaşmaz
    // (eskiden ulaşılan karo SAYISINA bakıyordu: giriş ile durak arasındaki kopukluğu — sayı değişmeden — kaçırıyordu); `refusedObstacles`a
    // yazılır — kalıcı kural boş olmasını ister
    const specials: number[] = [];
    for (let k = 0; k < w * d; k++) if (kind[k] === T_STOP || kind[k] === T_DOOR || kind[k] === T_VIEW) specials.push(k);
    const entrySeeds: number[] = [];
    for (const e of dist.entries) if (inside(e[0], e[1])) entrySeeds.push(at(e[0], e[1]));
    const reachSpecials = (): Uint8Array => {
      const seen = new Uint8Array(w * d), qq: number[] = [];
      for (const k of entrySeeds) if (walkableKind(kind[k]) && !seen[k]) { seen[k] = 1; qq.push(k); }
      for (let h = 0; h < qq.length; h++) {
        const k = qq[h], li = k % w, lj = (k - li) / w;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = li + a, z = lj + b;
          if (!inside(x, z)) continue;
          const n = at(x, z);
          if (!seen[n] && walkableKind(kind[n])) { seen[n] = 1; qq.push(n); }
        }
      }
      return seen;
    };
    const baseSeen = reachSpecials();
    const done = new Set<number>();
    for (const [bn, bl] of src.entries()) {
      if (!isObstacle(bl) || stopClear.has(bkey(bl))) continue;
      for (const [x, z, depth] of obstacleTiles(bl, ox, oz)) {
        if (!inside(x, z) || keep.has(`${x},${z}`)) continue;
        const k = at(x, z), kd = kind[k];
        if (done.has(k) || !walkableKind(kd) || kd === T_DOOR || kd === T_STOP || kd === T_VIEW || kd === T_RAIL || lwOpen[k]) continue; // açılan simge/bahçe karosu (yoklanmış) korunur
        const was = [kind[k], reserved[k], lwWall[k]] as const;
        kind[k] = T_WALL; reserved[k] = 1; lwWall[k] = 1; if (bn < decorN && Math.floor(bl.p[0] - ox) === x && Math.floor(bl.p[2] - oz) === z) decorWall[k] = 1;
        const now = reachSpecials();
        if (specials.some((q) => baseSeen[q] && !now[q])) { kind[k] = was[0]; reserved[k] = was[1]; lwWall[k] = was[2]; if (depth > INTRUDE_HARD) refusedObstacles.push({ li: x, lj: z }); continue; } // hafif taşma (≤ 0,4) koridoru keserse yürünür kalır
        done.add(k);
      }
    }
  }

  // (WALK-BODY-001): yürünür karonun ortasında duran avatarın GÖVDESİNE (yarıçap BODY_R) yürüme bandında
  // giren görünür katı tasarım süsü (bank, saksı, peri bacası kaidesi, korkuluk) ya da simge modeli parçası (ayak izi dışına taşan
  // köprü korkuluğu, sütun, cephe dişi) varsa karo katı süs olur (`T_WALL`; içinden geçilmez, model çizer). Eskiden yalnız simgenin
  // karo ORTASINI kesen parçası katılaşıyordu (yukarıda `.center`); kenara oturan duvar gövdeye giriyordu. Bütün şehirler.
  // Kapı, durak, giriş, seyir, ray ve gizli köşe karosu değişmez (sistem karosu; denetim listesinde kalır). Simge ayak izi içi
  // LANDMARK-WALK'ın (yüksek çözünürlüklü model, karo ortası) işidir; burada değişmez. Bu kuralla kapanan cep 5. adımda çit değil katı süs.
  const bodyWall = new Uint8Array(w * d), bodyPrev = new Uint8Array(w * d), bodyPrevOpen = new Uint8Array(w * d); // HQA-FIX-C: geri alma için önceki hal
  {
    const ox = cityX(i0) - 0.5, oz = cityZ(j0) - 0.5, solids: Block[] = [];
    const body = (b: Block) => b.g === "solid" && !stopClear.has(bkey(b)) && b.s[1] >= WB_MIN_H && Math.min(b.s[0], b.s[2]) >= WB_MIN_SIDE && b.s[0] * b.s[2] >= WB_MIN_AREA;
    for (const b of design?.decor?.({ ox, oz }) ?? []) if (body(b)) solids.push(b);
    const decorSolids = new Set(solids);
    for (const lm of landmarks) {
      const gm = landmarkModel(map.id, lm.id);
      if (!gm) continue;
      const ctx = { x0: ox + lm.i0, z0: oz + lm.j0, w: lm.w, d: lm.d, h: lm.h, cx: ox + lm.i0 + lm.w / 2, cz: oz + lm.j0 + lm.d / 2 };
      for (const b of gm.near(ctx)) if (body(b)) solids.push(b);
      for (const b of landmarkVisual(map.id, lm.id, gm, ctx)) if (body(b)) solids.push(b);
    }
    if (solids.length) {
      const idx = new BlockIndex(solids);
      const keepT = new Set([...[...dist.entries, ...(design?.hidden ?? [])].map((e) => `${e[0]},${e[1]}`), ...poseT]);
      for (let lj = 0; lj < d; lj++) for (let li = 0; li < w; li++) {
        const k = at(li, lj), kd = kind[k];
        if (!walkableKind(kd) || kd === T_DOOR || kd === T_STOP || kd === T_VIEW || kd === T_RAIL || keepT.has(`${li},${lj}`)) continue;
        if (landmarks.some((l) => li >= l.i0 && lj >= l.j0 && li < l.i0 + l.w && lj < l.j0 + l.d)) continue;
        const x = ox + li + 0.5, z = oz + lj + 0.5, g = lwOpen[k] ? top[k] : Math.max(top[k], terrain[k]);
        const hitB = idx.near(x, z).filter((b) => Math.abs(b.p[0] - x) < b.s[0] / 2 + WB_R && Math.abs(b.p[2] - z) < b.s[2] / 2 + WB_R
          && b.p[1] + b.s[1] / 2 >= g + WB_TOP && b.p[1] - b.s[1] / 2 <= g + WB_FOOT);
        if (hitB.length) {
          if (hitB.every((b) => decorSolids.has(b) && Math.floor(b.p[0] - ox) === li && Math.floor(b.p[2] - oz) === lj)) decorWall[k] = 1;
          bodyPrev[k] = kind[k]; bodyPrevOpen[k] = lwOpen[k]; kind[k] = T_WALL; lwOpen[k] = 0; lwWall[k] = 1; bodyWall[k] = 1; lwStat.walled++;
        }
      }
    }
  }

  // (STREET-BLOCKED-001, ürün sahibi 2026-11-02 "bir sokak başka bir yapının duvarıyla kapanıyor; iç içe geçiyorlar"): sokak kanalını
  // bütün eninden tıkayan hücre binası (4. adım: tasarım sokağının üstüne düşen parsel binası) kurulmaz (karo meydan), tasarım süsü
  // (peri bacası, kaya) yüzünden katılaşan tıkaç karosu sokak kalır ve o karodaki süs çizilmez (`plugDrop`). Tasarım binası, simge ve
  // tasarım `solid` dikdörtgeni dokunulmaz (kasıtlı cephe). Denetim: scripts/walkflow_check.mjs.
  const plugDrop = new Uint8Array(w * d);
  for (let pass = 0; pass < 3; pass++) {
    const cellAt = (li: number, lj: number) => buildings.findIndex((bd, n) => n >= cellStart && li >= bd.i0 && lj >= bd.j0 && li < bd.i0 + bd.w && lj < bd.j0 + bd.d);
    const removable = (li: number, lj: number) => inside(li, lj) && ((kind[at(li, lj)] === T_WALL && !!decorWall[at(li, lj)]) || (kind[at(li, lj)] === T_BUILDING && cellAt(li, lj) >= 0));
    let fixed = 0;
    for (const tiles of streetPlugs(w, d, (i, j) => inside(i, j) && walkableKind(kind[at(i, j)]), removable)) {
      if (!tiles.every(([i, j]) => removable(i, j))) continue;
      for (const [i, j] of tiles) {
        const k = at(i, j);
        if (kind[k] === T_BUILDING) {
          const n = cellAt(i, j), bd = buildings[n];
          for (let z = bd.j0; z < bd.j0 + bd.d; z++) for (let x = bd.i0; x < bd.i0 + bd.w; x++) kind[at(x, z)] = T_PLAZA;
          buildings.splice(n, 1);
        } else if (kind[k] === T_WALL) { kind[k] = T_STREET; lwWall[k] = 0; bodyWall[k] = 0; decorWall[k] = 0; plugDrop[k] = 1; }
        fixed++;
      }
    }
    if (!fixed) break;
  }

  // 5) onarım: girişlerden (ve kapı/durak/seyir) ulaşılamayan yürünebilir karo çit olur
  const seen = new Uint8Array(w * d);
  const q: number[] = [];
  const flood = () => {
    seen.fill(0); q.length = 0;
    for (const e of dist.entries) { const k = at(e[0], e[1]); if (walkableKind(kind[k]) && !seen[k]) { seen[k] = 1; q.push(k); } }
    for (let h = 0; h < q.length; h++) {
      const k = q[h], li = k % w, lj = (k - li) / w;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = li + a, z = lj + b;
        if (!inside(x, z)) continue;
        const n = at(x, z);
        if (!seen[n] && walkableKind(kind[n])) { seen[n] = 1; q.push(n); }
      }
    }
  };
  flood();
  // HQA-FIX-C / FIXPACK-D: gövde duvarı bir kapı/durak/seyir karosunu girişlerden koparıyorsa YALNIZ kesen duvar(lar) geri alınır
  // (eskiden bölgedeki bütün gövde duvarları sessizce geri alınıyordu): duvarlar sırayla geri alınır, kopukluk bitince gereksiz geri alınanlar
  // yeniden konur (en küçük küme). Geri alınanlar `bodyReverts`a yazılır — kalıcı kural boş olmasını ister.
  const bodyReverts: { li: number; lj: number }[] = [];
  const unreached = () => { let n = 0; for (let k = 0; k < kind.length; k++) if ((kind[k] === T_DOOR || kind[k] === T_STOP || kind[k] === T_VIEW) && !seen[k]) n++; return n; };
  if (unreached() && bodyWall.some((v) => v)) {
    const undo = (k: number) => { kind[k] = bodyPrev[k]; lwOpen[k] = bodyPrevOpen[k]; lwWall[k] = 0; bodyWall[k] = 0; lwStat.walled--; };
    const order: number[] = [];
    for (let k = 0; k < kind.length; k++) if (bodyWall[k]) order.push(k);
    // hepsi geri alınınca kalan kopukluk gövde duvarından değildir (taban); duvarlar yeniden konurken bu tabanı aşmayanlar kalır
    for (const k of order) undo(k);
    flood();
    const floor = unreached(), reverted = new Set<number>(order);
    for (const k of [...order].reverse()) {
      const was = [kind[k], lwOpen[k], lwWall[k]] as const;
      kind[k] = T_WALL; lwOpen[k] = 0; lwWall[k] = 1; bodyWall[k] = 1; lwStat.walled++;
      flood();
      if (unreached() > floor) { kind[k] = was[0]; lwOpen[k] = was[1]; lwWall[k] = was[2]; bodyWall[k] = 0; lwStat.walled--; } else reverted.delete(k);
    }
    flood();
    for (const k of reverted) bodyReverts.push({ li: k % w, lj: (k - (k % w)) / w });
  }
  // gövde kuralıyla katılaşan karonun arkasında kapanan cep (köprü ayağı ile su arası şerit) bütünüyle katı süs
  const pocket = new Uint8Array(w * d), pq: number[] = [];
  for (let k = 0; k < kind.length; k++) if (bodyWall[k]) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const li = k % w + a, lj = (k - (k % w)) / w + b, n = at(li, lj);
    if (inside(li, lj) && walkableKind(kind[n]) && !seen[n] && !lwOpen[n] && !pocket[n]) { pocket[n] = 1; pq.push(n); }
  }
  for (let h = 0; h < pq.length; h++) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const li = pq[h] % w + a, lj = (pq[h] - (pq[h] % w)) / w + b, n = at(li, lj);
    if (inside(li, lj) && walkableKind(kind[n]) && !seen[n] && !lwOpen[n] && !pocket[n]) { pocket[n] = 1; pq.push(n); }
  }
  let sealed = 0;
  for (let k = 0; k < kind.length; k++) if (walkableKind(kind[k]) && !seen[k]) {
    // LANDMARK-WALK: ulaşılamayan açılmış simge karosu çit değil, yine simge (katı; model çizer)
    if (lwOpen[k]) { kind[k] = T_LANDMARK; top[k] = groundY; lwOpen[k] = 0; lwStat.reverted++; lwStat.opened--; continue; }
    // LANDMARK-WALK: simgenin görünen parçaları arasında kapanan tek karoluk aralık çit değil, aynı katı süs (model çizer)
    const li = k % w, lj = (k - li) / w;
    if (pocket[k] || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => inside(li + a, lj + b) && lwWall[at(li + a, lj + b)])) { kind[k] = T_WALL; lwStat.walled++; continue; }
    kind[k] = T_HEDGE; sealed++;
  }

  // 6) yürünür yükselti (tasarım `terraces`): yürünebilir karoların üst yüzü + çizim kaldırması (`lift`) ve basamak rengi
  const lift = new Float32Array(w * d);
  const liftColor = new Int16Array(w * d).fill(-1);
  const liftColors: string[] = [];
  for (const t of design?.terraces ?? []) {
    const [x0, z0, rw, rd] = t.rect, dir = t.dir ?? "+j", y1 = t.y1 ?? t.y;
    const n = dir === "+i" || dir === "-i" ? rw : rd;
    for (let z = z0; z < z0 + rd; z++) for (let x = x0; x < x0 + rw; x++) {
      if (!inside(x, z)) continue;
      const k = at(x, z);
      if (!walkableKind(kind[k]) && !ledge[k]) continue;
      if (lwOpen[k]) { lift[k] = terrain[k]; continue; } // LANDMARK-WALK: açılan simge karosunun yüzeyi modelin zemini (top), sütun zemin hizası
      const s = dir === "+i" ? x - x0 : dir === "-i" ? x0 + rw - 1 - x : dir === "+j" ? z - z0 : z0 + rd - 1 - z;
      const y = n > 1 ? +(t.y + ((y1 - t.y) * s) / (n - 1)).toFixed(3) : t.y;
      lift[k] = y;
      top[k] = y;
      if (t.colors?.length) {
        const c = t.colors[s % t.colors.length];
        let ci = liftColors.indexOf(c);
        if (ci < 0) { ci = liftColors.length; liftColors.push(c); }
        liftColor[k] = ci;
      }
    }
  }

  const city = (t: CityTile) => toCity(dist, t);
  assignFacadeVariants(buildings); // komşu binalar farklı cephe çeşidi
  const out: DistrictOut = {
    id: dist.id, mapId: map.id, i0, j0, w, d, theme: dist.theme, kind, top, lift, liftColor, liftColors, buildings, landmarks, hidden,
    doors: landmarks.filter((l) => l.door && l.enterable).map((l) => ({ landmark: l.id, tile: city(l.door!) })),
    stops: stops.map((s) => ({ id: s.id, tile: city(s.tile), ...(s.board ? { board: city(s.board) } : {}), kind: map.lines.find((l) => l.stops.includes(s.id))?.kind ?? "metro" })), // işaret rengi hattın türünden
    entries: dist.entries.map(city), viewpoints: (dist.viewpoints ?? []).map(city), corridor, sealed, cables: [],
    lwalk: { ...lwStat, terrain }, // LANDMARK-WALK
    droppedSolids, refusedObstacles, propWall: lwWall, bodyReverts, plugDrop,
  };
  // REVFIX1: durak totemi yürüme çarpışmasında katı (parsel `solid`; içinden yürünmez). Karo TÜRÜ değişmez: ince direk görüşü kesmez
  // (`T_WALL` yapılınca görüş ızgarası onu duvar sayıp <city>/<city>/<city> varış bakışlarını kaydırıyordu: arrival_check 47 yeni bulgu).
  out.markSolid = new Set(stops.flatMap((s) => { const mk = stopMarkSpot(out, s.tile[0], s.tile[1]); return mk ? [at(mk.li, mk.lj)] : []; }));
  return out;
}

// ------------------------------------------------------------------------------------------ parsel çizimi
type TailG = "solid" | "water" | "glass" | "glow";

/** Satır öncelikli açgözlü dikdörtgen birleştirme (anahtar ≥ 0). */
function mergeRects(keys: Int16Array, W: number, D: number): [number, number, number, number, number][] {
  const used = new Uint8Array(W * D), out: [number, number, number, number, number][] = [];
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const k0 = z * W + x, key = keys[k0];
    if (used[k0] || key < 0) continue;
    let ww = 1;
    while (x + ww < W && !used[k0 + ww] && keys[k0 + ww] === key) ww++;
    let dd = 1;
    grow: while (z + dd < D) {
      const row = (z + dd) * W + x;
      for (let a = 0; a < ww; a++) if (used[row + a] || keys[row + a] !== key) break grow;
      dd++;
    }
    for (let b = 0; b < dd; b++) used.fill(1, (z + b) * W + x, (z + b) * W + x + ww);
    out.push([x, z, ww, dd, key]);
  }
  return out;
}


// ------------------------------------------------------------------------------------------ durak işareti
/** Hat türünün işaret rengi (tek ton; şerit/gökkuşağı yok). Kit sadeleşince durak uzaktan okunmuyordu (yerde 0,1 m plaka + turnike ışığı). */
export const STOP_MARK_COLOR: Readonly<Record<VehicleKind, string>> = {
  tramvay: "#E2552D", metro: "#2A7DE1", funikuler: "#8A5A3C", monoray: "#2E9E6B", vapur: "#14909F", kayik: "#14909F", otobus: "#F0A202", teleferik: "#7A5BB5", balon: "#D6457A",
};
/** İşaret yüksekliği (tabela tepesi, birim) — 20+ karodan okunur (≈ 9° görünür yükseklik). */
export const STOP_MARK_H = 3.42;
/**
 * Durak işareti (yerde duran totem): duraktan 6 (yoksa 7, 5) karo ötede (INTEGQ: FX-VIEW-002 durak çevresi ±2,5 m içindeki donatıyı sayar; F paneli rota kadrajı ve komşu durak halkası ≤ 4 karo işaretsiz) açık sokak/meydan karosu; cepheye yaslı tercih edilir (bina duvarına doğru 0,32 kayık),
 * yoksa dış köşeye. Yürüme ve varış çizgisi ile birinci şahıs yakın bölgesi dışında (turnike kitinin ayak izi dışı; FX-VIEW-002 kit saymaz). Yer yok → null.
 * Koridor (ray/otobüs yolu), yükselti farkı, kapı/durak/seyir/ray karosu komşuluğu elenir. Saf (plan): parsel çiziminden bağımsız belirlenimci.
 */
type MarkPlan = Pick<DistrictOut, "w" | "d" | "kind" | "lift" | "corridor" | "landmarks"> & Partial<Pick<DistrictOut, "i0" | "j0" | "stops">>;
type MarkSpot = { li: number; lj: number; dx: number; dz: number } | null;
const markCache = new WeakMap<object, Map<string, MarkSpot>>();
/** REVFIX1: plan başına önbellekli (eskiden her parsel çiziminde durak başına ~18 ms yeniden aranıyordu). `planDistrict` doldurur
 *  (totem karoları `markSolid`); sonraki çağrılar (çizim, denetimler) aynı nesneyi alır. */
export function stopMarkSpot(plan: MarkPlan, li: number, lj: number): MarkSpot {
  let c = markCache.get(plan);
  if (!c) { c = new Map(); markCache.set(plan, c); }
  const key = `${li},${lj}`;
  let r = c.get(key);
  if (r === undefined) { r = findStopMark(plan, li, lj); c.set(key, r); }
  return r;
}
function findStopMark(plan: MarkPlan, li: number, lj: number): MarkSpot {
  const kd = (a: number, b: number) => (a >= 0 && b >= 0 && a < plan.w && b < plan.d ? plan.kind[b * plan.w + a] : -1);
  const lift = (a: number, b: number) => plan.lift[b * plan.w + a];
  const trig = (k: number) => k === T_STOP || k === T_DOOR || k === T_VIEW || k === T_RAIL;
  // varış kamerası/bakışı açık hatlar boyunca kurulur (arrivalHeading: açık yön; burada ≥ 3 karo): o ışınların 1,3 karo yanı işaretsiz (kare ve orta pencere dolmasın)
  const rays: [number, number][] = [];
  for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    let n = 0;
    while (n < 8 && ((q) => q < 10)(kd(li + ux * (n + 1), lj + uz * (n + 1)))) n++; // semt dışı (−1) açık sayılır: görüş ızgarası komşu semte sürer
    if (n >= 3) rays.push([ux / Math.hypot(ux, uz), uz / Math.hypot(ux, uz)]);
  }
  // INTEGQ: başka bir durağın varış/rota halkası (≤ 4 karo) işaretsiz — komşu durağın totemi bu durağın F paneli yürüyüşünün kadrajına giriyordu (arrival_check rota çıtası kayıyordu)
  const others = (plan.stops ?? []).map((s) => [s.tile[0] - (plan.i0 ?? 0), s.tile[1] - (plan.j0 ?? 0)]).filter(([a, b]) => a !== li || b !== lj);
  // INTEGQ: seyir noktasından semt simgelerine giden bakış doğruları (≥ 2 karo, ±24° koni) işaretsiz — totem seyir karesinde hedefi örtüyordu (VIEW-FRAME-001 istanbul/bogaz portre)
  const vts: [number, number][] = [];
  for (let b = 0; b < plan.d; b++) for (let a = 0; a < plan.w; a++) if (plan.kind[b * plan.w + a] === T_VIEW) vts.push([a, b]);
  const onSight = (a: number, b: number, kf: number) => vts.some(([vx, vz]) => plan.landmarks.some((l) => {
    const cx = l.i0 + l.w / 2 - vx, cz = l.j0 + l.d / 2 - vz, len2 = cx * cx + cz * cz, u = len2 ? ((a + 0.5 - vx - 0.5) * cx + (b - vz) * cz) / len2 : 0;
    return u > 0 && u < 1 && Math.hypot(a - vx - u * cx, b - vz - u * cz) < Math.max(2, kf * u * Math.sqrt(len2)); // yan pay = bakış ucunun yaklaşık ±24° konisi (dar portre kadrajı dahil)
  }));
  const onRay = (di: number, dj: number) => rays.some(([ux, uz]) => { const al = di * ux + dj * uz; return al > -1 && al < 10 && Math.abs(di * uz - dj * ux) < 1.3; });
  for (const kf of [0.45, 0.2, 0]) { // koni daralan geçişler: dar koni ile yer yoksa daha dar (en sonda yalnız 2 karo yan pay)
  for (const [vr, lmg, r, openMin] of ([[10, 3, 7], [7, 3, 7], [3, 3, 7], [3, 0, 7], [3, 0, 6]] as const).flatMap(([v, g, o]) => [6, 7, 5, 8, 9, 10].map((r) => [v, g, r, o] as const))) { // geçişler: seyir noktasından ≥ 10 karo uzak + simge 3 karo dışı → seyir 3 → simge payı 0
    let best: { li: number; lj: number; dx: number; dz: number } | null = null, bs = -1;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const a = li + di, b = lj + dj, k = kd(a, b);
      if ((k !== T_STREET && k !== T_PLAZA && k !== T_PARK) || plan.corridor[b * plan.w + a] || Math.abs(lift(a, b) - lift(li, lj)) > 1e-6 || onRay(di, dj) || onSight(a, b, kf) || others.some(([oa, ob]) => Math.max(Math.abs(a - oa), Math.abs(b - ob)) <= 4)) continue;
      const nb: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      if (nb.some(([x, z]) => trig(kd(a + x, b + z)) || (kd(a + x, b + z) >= 0 && kd(a + x, b + z) < 10 && Math.abs(lift(a + x, b + z) - lift(a, b)) > 1e-6))) continue;
      const walls = nb.filter(([x, z]) => kd(a + x, b + z) >= 10);
      if (walls.length > 1) continue; // dar cep / dar iskele (iki yan kapalı): işaret yürüyüşü ve varış kamerasını daraltmasın
      // (WALK-CLEAR): cepheye yaslanamayan (köşe kayık) totem koridoru < LANE_MIN şeride indirmesin (totem karosu çarpışmada katı)
      if (!walls.length && (laneBeside((x, z) => { const q = kd(x, z); return q >= 0 && q < 10; }, a, b) ?? LANE_MIN) < LANE_MIN) continue;
      let open = 0;
      for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) { const q = kd(a + x, b + y); if (q >= 0 && q < 10) open++; }
      if (open < openMin) continue; // geniş meydan/sokak: 3 × 3'ün en çok 2'si kapalı
      let near = false; // seyir noktası (vr karo) / kapı (3 karo) çevresi işaretsiz: bakış kadrajı (vpAim) ve giriş karesi temiz kalır
      for (let y = -vr; y <= vr && !near; y++) for (let x = -vr; x <= vr; x++) { const q = kd(a + x, b + y); if (q === T_VIEW || (q === T_DOOR && Math.abs(x) <= 7 && Math.abs(y) <= 7)) { near = true; break; } }
      if (near) continue;
      // simge ayak izinin `lmg` karo çevresi işaretsiz: işaret simgenin cephesini/seyir kadrajını kapatmaz
      if (plan.landmarks.some((l) => a >= l.i0 - lmg && a < l.i0 + l.w + lmg && b >= l.j0 - lmg && b < l.j0 + l.d + lmg)) continue;
      // INTEGQ: eşit duvar puanında seyir noktasından en uzak aday (seyir karesi/hedef görünürlüğü: VIEW-FRAME-001 istanbul/bogaz portre)
      let dv = 12; for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) if (kd(a + x, b + y) === T_VIEW) dv = Math.min(dv, Math.max(Math.abs(x), Math.abs(y)));
      const sc = walls.length * 100 + dv;
      if (sc > bs) { bs = sc; best = walls.length ? { li: a, lj: b, dx: walls[0][0] * 0.32, dz: walls[0][1] * 0.32 } : { li: a, lj: b, dx: Math.sign(di) * 0.32, dz: Math.sign(dj) * 0.32 }; }
    }
    if (best) return best;
  }
  }
  return null;
}
/** İşaretin blokları (merkez x, z; zemin y 0): yerden 2,4 m gövde, hat rengi bant, tepede çapraz iki tabela (hat rengi). Hepsi yerden/altındakine değerek destekli; 4 yakın + 2 uzak blok (parsel bütçesi). */
export function stopMarkBlocks(x: number, z: number, color: string, low = false, wall?: readonly [number, number] | null): { near: Block[]; far: Block[] } {
  const B = (p: [number, number, number], s: [number, number, number], c: string): Block => ({ p, s, c, g: "solid", j: 0 });
  const top = low ? 1.4 : 2.4, bl = low ? 0.7 : 0.9; // low: havai hat (teleferik/balon) durağı — kabin yolu 2,4 m'den geçer, tabela altında kalır
  // (ürün sahibi "binaların önünde direkli bej panolar"): cepheye yaslı totemde çapraz tabelanın biri cepheye paralel 0,18 önünde
  // pano gibi duruyor (pencereleri örtüyor), öteki duvara 0,27 giriyordu. Cepheye yaslı totem: tek bayrak
  // tabela cepheye dik, direkten sokağa (duvara 0,02 kalır). Köşe kayıklı (çapraz) totem çapraz tabelada kalır.
  if (wall) {
    const [wx, wz] = wall, ax = wx !== 0, bx = x - wx * (bl / 2 - 0.16), bz = z - wz * (bl / 2 - 0.16); // tabela direkten sokağa
    return {
      near: [
        B([x, top / 2, z], [0.32, top, 0.32], "#3F4650"), B([x, top - 0.45, z], [0.38, 0.5, 0.38], color),
        B([bx, top + bl / 2, bz], ax ? [bl, bl, 0.08] : [0.08, bl, bl], color),
        B([x, top + bl / 2, z], [0.12, bl, 0.12], "#3F4650"), // direk tabelanın tepesine kadar (tabela havada değil)
      ],
      far: [B([x, top / 2 + 0.1, z], [0.3, top + 0.2, 0.3], "#3F4650"), B([bx, top + bl / 2, bz], ax ? [bl, bl, 0.3] : [0.3, bl, bl], color)],
    };
  }
  return {
    near: [
      B([x, top / 2, z], [0.32, top, 0.32], "#3F4650"), B([x, top - 0.45, z], [0.38, 0.5, 0.38], color),
      B([x, top + bl / 2, z], [bl, bl, 0.08], color), B([x, top + bl / 2 - 0.02, z], [0.08, bl - 0.04, bl], color),
    ],
    far: [B([x, top / 2 + 0.1, z], [0.3, top + 0.2, 0.3], "#3F4650"), B([x, top + bl / 2, z], [bl, bl, bl], color)],
  };

}

const GROUND_KEYS = [T_STREET, T_PLAZA, T_PARK, T_RAIL, T_STOP, T_DOOR, T_VIEW];
function groundColor(pal: Palette, k: number): string {
  switch (k) {
    case T_PLAZA: case T_STOP: case T_DOOR: case T_VIEW: return pal.plaza;
    case T_PARK: return pal.park;
    case T_RAIL: return pal.rail;
    default: return pal.street;
  }
}

/** Landmark yer tutucu silueti (yerel → dünya; ≤ 18 blok). */
function landmarkBlocks(lm: DistrictLandmark, ox: number, oz: number, add: (b: Block) => void) {
  const cx = ox + lm.i0 + lm.w / 2, cz = oz + lm.j0 + lm.d / 2;
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, g: Group = "solid") => add({ p: [x, y, z], s: [w, h, d], c, g, j: 0 });
  const stone = "#D9CDB6", dark = "#A8987C", accent = "#7A8FA6";
  switch (lm.shape) {
    case "tower": {
      const bw = Math.max(2, lm.w - 2), bd = Math.max(2, lm.d - 2), body = lm.h * 0.78;
      box(cx, 0.5, cz, lm.w, 1, lm.d, dark);
      box(cx, 1 + (body - 1) / 2, cz, bw, body - 1, bd, stone);
      for (let k = 1; k <= 3; k++) box(cx, (body * k) / 4, cz + bd / 2 + 0.02, 0.5, 0.6, 0.04, "#3A4A5A");
      box(cx, body + 0.15, cz, bw + 0.8, 0.3, bd + 0.8, dark);
      box(cx, body + 0.75, cz, bw - 0.2, 0.9, bd - 0.2, stone);
      box(cx, body + 0.75, cz, bw - 0.1, 0.35, bd - 0.1, "#9CC3D9", "glass");
      const cone = lm.h - body - 1.2;
      for (let k = 0; k < 3; k++) box(cx, body + 1.2 + (cone * (k + 0.5)) / 3, cz, (bw - 0.2) * (1 - (k + 1) / 4), cone / 3, (bd - 0.2) * (1 - (k + 1) / 4), accent);
      box(cx, lm.h + 0.15, cz, 0.18, 0.3, 0.18, "#FFE3A3", "glow");
      break;
    }
    case "dome": case "hall": {
      const body = Math.max(1.6, lm.h * 0.5);
      box(cx, body / 2, cz, lm.w, body, lm.d, stone);
      box(cx, body + 0.1, cz, lm.w + 0.2, 0.2, lm.d + 0.2, dark);
      if (lm.shape === "dome") {
        const rest = lm.h - body - 0.2;
        for (let k = 0; k < 4; k++) { const f = 1 - k / 4.5; box(cx, body + 0.2 + (rest * (k + 0.5)) / 4, cz, (lm.w - 1.5) * f, rest / 4, (lm.d - 1.5) * f, k === 3 ? accent : "#C9C2B2"); }
      } else box(cx, body + 0.6, cz, lm.w - 1, 0.8, lm.d - 1, dark);
      for (let k = 0; k < Math.min(4, Math.floor(lm.w / 2)); k++) box(ox + lm.i0 + 1 + k * 2, body * 0.55, oz + lm.j0 + lm.d + 0.02, 0.5, body * 0.5, 0.04, "#9CC3D9", "glass");
      break;
    }
    case "arch": {
      box(ox + lm.i0 + 0.75, lm.h / 2, cz, 1.5, lm.h, lm.d, stone);
      box(ox + lm.i0 + lm.w - 0.75, lm.h / 2, cz, 1.5, lm.h, lm.d, stone);
      box(cx, lm.h - 0.6, cz, lm.w, 1.2, lm.d, dark);
      break;
    }
    case "obelisk":
      box(cx, 0.3, cz, lm.w, 0.6, lm.d, dark);
      box(cx, 0.6 + (lm.h - 1.2) / 2, cz, Math.max(0.6, lm.w * 0.35), lm.h - 1.2, Math.max(0.6, lm.d * 0.35), stone);
      box(cx, lm.h - 0.3, cz, Math.max(0.4, lm.w * 0.2), 0.6, Math.max(0.4, lm.d * 0.2), accent);
      break;
  }
}

const parcelCache = new WeakMap<DistrictOut, Map<number, CityParcel>>();

/**
 * landmark modellerinin yakın ayrıntısı ve tasarım süsleri, blok merkezinin şehir karosuna göre parsellere dağıtılır
 * (semt sınırına kıstırılır: köprü açıklığı gibi semt dışına taşan bloklar kenar parselinde). Uzak LOD landmark merkezinin
 * parselinde. Semt başına bir kez (önbellek).
*/
/** semt karo ızgarası (kaldırım = yürünmez komşu: bina, duvar, su, simge; direk kapı/durak/seyir karosuna, durak çevresine
 * (FIXPACK-A) ve araç koridoruna konmaz).*/
function kerbGrid(plan: DistrictOut): KerbGrid {
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < plan.w && j < plan.d;
  const kd = (i: number, j: number) => plan.kind[j * plan.w + i];
  return {
    ox: cityX(plan.i0) - 0.5, oz: cityZ(plan.j0) - 0.5,
    walk: (i, j) => inside(i, j) && walkableKind(kd(i, j)),
    edge: (i, j) => inside(i, j) && !walkableKind(kd(i, j)),
    ground: (i, j) => (inside(i, j) ? plan.lift[j * plan.w + i] : 0),
    avoid: (i, j) => !inside(i, j) || kd(i, j) === T_DOOR || kd(i, j) === T_STOP || kd(i, j) === T_VIEW || !!plan.corridor[j * plan.w + i] || nearStop(plan.kind, plan.w, plan.d, i, j),
  };
}
/** sokak lambası kaldırımda — kavşak karosu ya da 8 komşusunda, yürünmez komşusu olan karonun o kenarında (`KERB_AT`); yoksa
 * eski yerinde (karo köşesi) yalnız yanında ≥ 2 şerit kalıyorsa (açık meydan/geniş kavşak), değilse lamba yok (eskiden iki şeritli sokağın
 * orta çizgisindeydi). Dönüş: semt yerel karo ve dünya konumu.*/
function lampSpot(plan: DistrictOut, li: number, lj: number): { li: number; lj: number; x: number; z: number } | null {
  const g = kerbGrid(plan);
  for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1]] as const) {
    const i = li + a, j = lj + b;
    if (!g.walk(i, j) || g.avoid!(i, j) || plan.kind[j * plan.w + i] !== T_STREET) continue;
    for (const [p, q] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      if (!g.edge(i + p, j + q)) continue;
      // kaldırım boyunca kavşak köşesine (eski lamba yeri) yakın durur: ortadaki direk arka bakış kolunu (rota kamerası) daraltmasın
      const fx = p > 0 ? 1 - KERB_AT : p < 0 ? KERB_AT : Math.max(0.2, Math.min(0.8, li - i + 0.2)), fz = q > 0 ? 1 - KERB_AT : q < 0 ? KERB_AT : Math.max(0.2, Math.min(0.8, lj - j + 0.2));
      return { li: i, lj: j, x: g.ox + i + fx, z: g.oz + j + fz };
    }
  }
  if ((laneBeside(g.walk, li, lj) ?? LANE_MIN) >= LANE_MIN) {
    const c = LAMP_CORNER[`${plan.mapId}:${plan.id}:${li},${lj}`] ?? [0.1, 0.1];
    return { li, lj, x: g.ox + li + c[0], z: g.oz + lj + c[1] };
  }
  return null;
}

/**
 * ENTRY-DOOR-001: girilebilir simgenin giriş karosunun önündeki kapıyı ölçer; okunmuyorsa yapının üslubuna uyan standart kapıyı üretir
 * (yakın model GÖRÜNEN modeldir: hi varsa hi). Denetim (scripts/entry_door_check.mjs) aynı işlevi çağırır.
 */
export function landmarkEntryDoor(plan: DistrictOut, lm: DistrictLandmark, vis: readonly Block[]): { probe: EntryProbe; blocks: Block[]; cx: number; cz: number; dir: readonly [number, number] } | null {
  if (!lm.door || !lm.enterable) return null;
  const ox = cityX(plan.i0) - 0.5, oz = cityZ(plan.j0) - 0.5;
  const cx = ox + lm.door[0] + 0.5, cz = oz + lm.door[1] + 0.5, dir = doorDir(lm.door, [lm.i0, lm.j0, lm.w, lm.d]);
  const y0 = plan.lift[lm.door[1] * plan.w + lm.door[0]] || 0;
  const probe = probeEntry(vis, cx, cz, dir, y0);
  const style = entryStyle(plan.mapId, lm.shape === "hall" ? "lobby" : lm.shape);
  const blocks = ENTRY_DOOR_OWNED[`${plan.mapId}/${lm.id}`] ? [] : probe.wall === null ? (probe.ok ? [] : entryGateBlocks(cx, cz, dir, style, y0)) : probe.ok ? [] : entryDoorBlocks(probe, cx, cz, dir, style, y0).slice(0, ENTRY_DOOR_SLIM.has(`${plan.mapId}/${lm.id}`) ? 1 : 9);
  return { probe, blocks, cx, cz, dir };
}

const extraCache = new WeakMap<DistrictOut, Map<string, { near: Block[]; far: Block[] }>>();
function extrasOf(plan: DistrictOut): Map<string, { near: Block[]; far: Block[] }> {
  const hit = extraCache.get(plan);
  if (hit) return hit;
  const m = new Map<string, { near: Block[]; far: Block[] }>();
  const design = designOf(plan.mapId);
  const ox = cityX(plan.i0) - 0.5, oz = cityZ(plan.j0) - 0.5;
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const bucket = (x: number, z: number) => {
    const I = clamp(Math.floor(x + 12), plan.i0, plan.i0 + plan.w - 1), J = clamp(Math.floor(z + 8), plan.j0, plan.j0 + plan.d - 1);
    return `${Math.floor(I / CITY_PW)},${Math.floor(J / CITY_PD)}`;
  };
  const get = (k: string) => { let e = m.get(k); if (!e) { e = { near: [], far: [] }; m.set(k, e); } return e; };
  if (design) {
    for (const lm of plan.landmarks) {
      const model = design.landmarks[lm.id];
      if (!model) continue;
      const ctx: LandmarkCtx = { x0: ox + lm.i0, z0: oz + lm.j0, w: lm.w, d: lm.d, h: lm.h, cx: ox + lm.i0 + lm.w / 2, cz: oz + lm.j0 + lm.d / 2 };
      const mid = model.near(ctx);
      if (hiresMapEntry(plan.mapId, lm.id)) markHiResManaged(mid); // LANDMARK-HIRES: veri katmanında kalır, çizimi HiResLayer'da
      for (const b of mid) { b.fix = 1; get(bucket(b.p[0], b.p[2])).near.push(b); } // simge modeli yapıdır (yan kesit açmaz)
      const ed = landmarkEntryDoor(plan, lm, landmarkVisual(plan.mapId, lm.id, model, ctx, mid)); // ENTRY-DOOR-001
      if (ed) for (const b of ed.blocks) get(bucket(b.p[0], b.p[2])).near.push(b);
      const home = get(bucket(ctx.cx, ctx.cz));
      for (const b of model.far(ctx)) home.far.push(b);
    }
    const dd = design.districts[plan.id];
    // (WALK-CLEAR-001): yürünür karodaki serbest direk takımı (fener, babası, tabela) kaldırım çizgisine; kaldırım yoksa çizilmez
    const pd = plan.plugDrop, dropAt = (b: Block) => { const i = Math.floor(b.p[0] - ox), j = Math.floor(b.p[2] - oz); return !!pd && i >= 0 && j >= 0 && i < plan.w && j < plan.d && !!pd[j * plan.w + i]; };
    if (dd?.decor) for (const b of kerbPoles(dd.decor({ ox, oz }).filter((b) => !dropAt(b)), kerbGrid(plan)).blocks) get(bucket(b.p[0], b.p[2])).near.push(b);
  }
  // CORE-CITYMAP: asılı hat halatı, direkleri ve istasyonları (citymap/cableway.ts)
  for (const b of plan.cables) { b.fix = 1; get(bucket(b.p[0], b.p[2])).near.push(b); }
  extraCache.set(plan, m);
  return m;
}

// ------------------------------------------------------------------------------------------ su meta (olta)
/** Bundan ince su bloğu (süs birikintisi) olta suyu değildir (ambient/habitat.ts FILM ile aynı). */
export const WATER_FILM = 0.1;
/** Süs suyunun (katı karo üstünde nehir) altındaki yatak: zemin levhası (üst yüz 0) suyu örtmesin diye su tabanına iner. */
const BED_KEY = 900;
const BED_COLOR = "#5E4B3C";

interface Bed { key: Int16Array; y: number[] }
const bedCache = new WeakMap<DistrictOut, Bed>();
/**
 * tasarım süsü olarak çizilen zemin seviyesindeki su (Kapadokya Avanos'un kızıl nehri gibi; karo katı) zemin levhasının
 * (üst yüz 0) altında kalıyordu. Böyle karolarda (yürünmez, `T_WATER` değil, karo ortası en az film kalınlığında ve üst yüzü
 * zeminin altında bir su bloğuyla örtülü) zemin levhası suyun tabanına iner — su görünür ve olta suyu olur. Yürünür karo ve
 * `T_WATER` değişmez.
*/
function bedOf(plan: DistrictOut): Bed {
  const hit = bedCache.get(plan);
  if (hit) return hit;
  const key = new Int16Array(plan.w * plan.d).fill(-1), levels: number[] = [];
  const low = new Float32Array(plan.w * plan.d).fill(NaN);
  for (const e of extrasOf(plan).values()) for (const b of e.near) {
    if (b.g !== "water" || b.s[1] < WATER_FILM || b.p[1] + b.s[1] / 2 > 0.05) continue;
    const bottom = b.p[1] - b.s[1] / 2;
    // karo ortası bloğun içinde (şehir karosu I'nın ortası x = I − 11,5)
    const I0 = Math.ceil(b.p[0] - b.s[0] / 2 + 11.5 - 1e-6), I1 = Math.floor(b.p[0] + b.s[0] / 2 + 11.5 + 1e-6);
    const J0 = Math.ceil(b.p[2] - b.s[2] / 2 + 7.5 - 1e-6), J1 = Math.floor(b.p[2] + b.s[2] / 2 + 7.5 + 1e-6);
    for (let J = Math.max(J0, plan.j0); J <= Math.min(J1, plan.j0 + plan.d - 1); J++) for (let I = Math.max(I0, plan.i0); I <= Math.min(I1, plan.i0 + plan.w - 1); I++) {
      const k = (J - plan.j0) * plan.w + (I - plan.i0);
      if (walkableKind(plan.kind[k]) || plan.kind[k] === T_WATER) continue;
      if (!(low[k] <= bottom)) low[k] = bottom;
    }
  }
  for (let k = 0; k < low.length; k++) {
    if (Number.isNaN(low[k])) continue;
    const y = +low[k].toFixed(3);
    let n = levels.indexOf(y);
    if (n < 0) { n = levels.length; levels.push(y); }
    key[k] = n;
  }
  const out: Bed = { key, y: levels };
  bedCache.set(plan, out);
  return out;
}

/**
 * semtin olta suyu (semt yerel, `lj · w + li`): çizilen yakın blokların (bütçe sonrası, gerçekten çizilen) su yüzü.
 * - `y`: karonun ortasını örten, film kalınlığından kalın en yüksek su bloğunun üst yüzü (yoksa −9; köprü altı dahil).
 * - `open`: olta atılabilir — karo ortasını su yüzünden yüksek bir blok (köprü güvertesi, ayak, ada, zemin) örtmüyor.
 * Semt başına bir kez (önbellek; parseller zaten önbellekte).
*/
export interface DistrictWater { y: Float32Array; open: Uint8Array }
const waterCache = new WeakMap<DistrictOut, DistrictWater>();
export function districtWater(map: CityMapFile, dist: CityDistrict): DistrictWater {
  const plan = districtPlan(map, dist);
  const hit = waterCache.get(plan);
  if (hit) return hit;
  const n = plan.w * plan.d;
  const y = new Float32Array(n).fill(-9), cover = new Float32Array(n).fill(-9);
  for (let cz = plan.j0 / CITY_PD; cz < (plan.j0 + plan.d) / CITY_PD; cz++) for (let cx = plan.i0 / CITY_PW; cx < (plan.i0 + plan.w) / CITY_PW; cx++) {
    const p = districtParcel(map, dist, cx, cz);
    if (!p) continue;
    for (const b of p.near.blocks) {
      const t = b.p[1] + b.s[1] / 2, wat = b.g === "water";
      if (wat && b.s[1] < WATER_FILM) continue;
      // karo ortası bloğun içinde mi: şehir karosu I'nın ortası x = I − 11,5
      const I0 = Math.ceil(b.p[0] - b.s[0] / 2 + 11.5 - 1e-6), I1 = Math.floor(b.p[0] + b.s[0] / 2 + 11.5 + 1e-6);
      const J0 = Math.ceil(b.p[2] - b.s[2] / 2 + 7.5 - 1e-6), J1 = Math.floor(b.p[2] + b.s[2] / 2 + 7.5 + 1e-6);
      for (let J = Math.max(J0, plan.j0); J <= Math.min(J1, plan.j0 + plan.d - 1); J++) for (let I = Math.max(I0, plan.i0); I <= Math.min(I1, plan.i0 + plan.w - 1); I++) {
        const k = (J - plan.j0) * plan.w + (I - plan.i0);
        if (wat) { if (t > y[k]) y[k] = t; } else if (t > cover[k]) cover[k] = t;
      }
    }
  }
  const open = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (y[k] > -9 && cover[k] < y[k] + 0.05) open[k] = 1;
  const out: DistrictWater = { y, open };
  waterCache.set(plan, out);
  return out;
}

/**
 * FIXPACK-A (FX-VIEW-002 yakın donatı): durak karosu (`T_STOP`) çevresi donatıdan arınık. Durakta 1. şahıs göz diski (yarıçap
 * STOP_EYE_R, göz STOP_EYE_Y) — fx_view_check `measureKit` ile aynı — göze STOP_CLEAR_M'den yakın, donatı ölçekli (yatay kenar ≤ 1) her
 * blok ekranın dibinde kalıyordu (iskele bankı, fener, ağaç, masa). Durağın Chebyshev ≤ 2 halkasına sokak lambası konmaz (`nearStop`; plan ağacı karosu geçilmez, kalır); landmark/süs eşyası (`clearStopProps`) BÜTÜN parçasıyla (birbirine değen serbest bloklar) çizilmez. Bir yapıya (bina,
 * simge gövdesi, istasyon kirişi) değen parça yapının kendisidir — dokunulmaz (fx_view_check onu ayrıca bildirir).
*/
export const STOP_EYE_R = 1, STOP_EYE_Y = 0.91, STOP_CLEAR_M = 1.5;
// plan ağacı (T_TREE karosu geçilmez): çizimi kaldırmak görünmez engel bırakır, taç da arkadaki figüranı örtüyordu (<city> nehir_iskele) — dokunulmaz
const planTrees = new WeakSet<Block>();
const VP_TREE_OFF: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  londra: [[-83, 60]], ...FULL_VP_TREE_OFF,
};
const planTree = (b: Block): Block => { planTrees.add(b); return b; };
/** CABLEVP1 (VP-NEAR-001): kavşak lambasının karo içi köşesi (yalnız listelenen kavşak; varsayılan (0,1; 0,1)). <city> eixample seyir karosu:
  * lamba 3,5 m'den kadrajın %25,3'ü — karşı köşede kadraj dışı (lamba sayısı ve çarpıştırıcı aynı: gezi akışı/POP-IN değişmez; lambayı kaldırmak ya da
  * seyir karosunu taşımak <city> POP-IN-001'i 12,3 → 9,2 birime düşürüyordu).*/
const LAMP_CORNER: Readonly<Record<string, readonly [number, number]>> = { ...FULL_LAMP_CORNER };
function nearStop(kind: ArrayLike<number>, w: number, d: number, li: number, lj: number): boolean {
  for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
    const x = li + a, z = lj + b;
    if (x >= 0 && z >= 0 && x < w && z < d && kind[z * w + x] === T_STOP) return true;
  }
  return false;
}
/** Durak karosunun (yerel li, lj; zemin y) göz diski örnekleri (dünya) — fx_view_check `measureKit` ile aynı. */
function stopEyes(ox: number, oz: number, li: number, lj: number, y: number): [number, number, number][] {
  const eyes: [number, number, number][] = [];
  for (const dx of [-1, -0.5, 0, 0.5, 1]) for (const dz of [-1, -0.5, 0, 0.5, 1]) if (Math.hypot(dx, dz) <= STOP_EYE_R + 1e-9) eyes.push([ox + li + 0.5 + dx, y + STOP_EYE_Y, oz + lj + 0.5 + dz]);
  return eyes;
}
/** Durak göz diskinden temizlenecek blok kümesi (`all` içinden). Çizim (`clearStopProps`) ve plan (4b / gövde katılaştırma: temizlenecek eşya karoyu
 *  katılaştırmaz — FIXPACK-D "görünmez duvar") AYNI kuralı kullanır. */
function stopClearDrops(all: readonly Block[], eyes: readonly (readonly number[])[], clearM = STOP_CLEAR_M, poleOnly = false): Set<Block> {
  const drop = new Set<Block>();
  if (!eyes.length) return drop;
  const gap = (b: Block, e: readonly number[]) => Math.hypot(...[0, 1, 2].map((k) => Math.max(0, Math.abs(e[k] - b.p[k]) - b.s[k] / 2)));
  const R = STOP_EYE_R + clearM + 2;
  const cand = all.filter((b) => eyes.some((e) => Math.abs(b.p[0] - e[0]) <= R + b.s[0] / 2 && Math.abs(b.p[2] - e[2]) <= R + b.s[2] / 2));
  const floorOf = (b: Block) => Math.min(...eyes.filter((e) => Math.abs(b.p[0] - e[0]) <= R && Math.abs(b.p[2] - e[2]) <= R).map((e) => e[1] - STOP_EYE_Y));
  // serbest eşya bloğu: zeminin üstünde duran (alt yüzü zeminden aşağı inmeyen), tepesi zeminden yüksek, eşya ölçeğinde
  const loose = (b: Block) => { const f = floorOf(b); return b.p[1] - b.s[1] / 2 >= f - 0.05 && b.p[1] + b.s[1] / 2 > f + 0.15 && Math.max(b.s[0], b.s[2]) <= 1.6 && b.s[1] <= 6; };
  const touch = (a: Block, b: Block) => [0, 1, 2].every((k) => Math.abs(a.p[k] - b.p[k]) <= (a.s[k] + b.s[k]) / 2 + 0.02);
  const seen = new Set<Block>();
  for (const b of cand) {
    if (seen.has(b) || planTrees.has(b) || b.g !== "solid" || Math.max(b.s[0], b.s[2]) > (poleOnly ? VIEW_POLE_W : 1) || !loose(b) || isHiResManaged(b)) continue;
    if (b.p[1] + b.s[1] / 2 <= floorOf(b) + 0.45 || !eyes.some((e) => gap(b, e) < clearM)) continue;
    const comp = [b]; seen.add(b);
    let anchored = false;
    for (let k = 0; k < comp.length && comp.length <= 40; k++) for (const o of cand) {
      if (o === comp[k] || comp.includes(o) || !touch(comp[k], o)) continue;
      if (loose(o) && !isHiResManaged(o) && !planTrees.has(o)) { comp.push(o); seen.add(o); }
      else if (o.p[1] + o.s[1] / 2 > floorOf(o) + 0.15 && o.p[1] - o.s[1] / 2 > floorOf(o) - 0.05) anchored = true; // yapıya değiyor
    }
    // yalnız yerde duran sokak eşyası: tabanı zeminde, toplam boyu ≤ 3,6 (lamba, bank, masa, büfe); ağaç tacı (≥ 1 × 1 yaprak kütlesi),
    // sarkan dal ve teleferik dikmesi (5 m+) eşya değildir — kaldırılmaz (yolculuk kamerasının yaw seçimi de değişmez)
    const lo = Math.min(...comp.map((q) => q.p[1] - q.s[1] / 2)), hi = Math.max(...comp.map((q) => q.p[1] + q.s[1] / 2));
    const street = lo <= floorOf(b) + 0.05 && hi - lo <= 3.6 && !comp.some((q) => Math.min(q.s[0], q.s[2]) >= 1 && q.s[1] >= 0.5);
    // seyir temizliğinde yalnız direk biçimli eşya (gövde ince; ışık başı ≤ 0,5) — bank, tezgâh, sütunlu yapı kalır
    const pole = !poleOnly || comp.every((q) => Math.max(q.s[0], q.s[2]) <= (q.g === "glow" ? 0.5 : VIEW_POLE_W));
    // 6–14 m halkasında yalnız boylu direk (fener, tabela: gövde bloğu ≥ VIEW_FAR_H); alçak kazık simge modelinin (çizim dışı blok) dayanağı olabilir (<city> taş köprü: 'havada')
    const farOk = !poleOnly || comp.some((q) => q.s[1] >= VIEW_FAR_H) || eyes.some((e) => comp.some((q) => gap(q, e) < VIEW_NEAR_M));
    if (!anchored && street && pole && farOk && comp.length <= 40) for (const q of comp) drop.add(q);
  }
  return drop;
}
/**
 * seyir karosunun (`T_VIEW`) göz noktasından VIEW_CLEAR_M içinde yerde duran serbest DİREK (sokak feneri, tabela
 * direği; gövde ≤ VIEW_POLE_W) çizilmez — otomatik bakışın kadraj ortasında ince direk kalıyordu (<city> meydanı feneri 5,2 m, <city>,
 * <city>, Kapadokya, <city>). Mesafe vpAim `VP_CLUTTER_N` (6 m) ile aynı. Yalnız yakın
 * halkada (uzak LOD ve cephe bütçesi değişmez: lambayı üretimde atlamak cephe kademesini ve akış sırasını kaydırıp gezi POP-IN-001'i bozuyordu).
*/
export const VIEW_CLEAR_M = 14, VIEW_POLE_W = 0.4, VIEW_NEAR_M = 6, VIEW_FAR_H = 1.0; // 6 → 14 m — Haliç ve benzeri seyirlerde hedefin önündeki lamba 6,6–11 m'deydi (vp_near merkez bandı bunu ölçer)
function clearViewPoles(plan: DistrictOut, near: Record<TailG, Block[]>, li0: number, lj0: number, ox: number, oz: number): void {
  const eyes: [number, number, number][] = [], m = VIEW_CLEAR_M + 2;
  for (let lj = Math.max(0, lj0 - m); lj < Math.min(plan.d, lj0 + CITY_PD + m); lj++) for (let li = Math.max(0, li0 - m); li < Math.min(plan.w, li0 + CITY_PW + m); li++) {
    if (plan.kind[lj * plan.w + li] === T_VIEW) eyes.push([ox + li + 0.5, plan.lift[lj * plan.w + li] + STOP_EYE_Y, oz + lj + 0.5]);
  }
  const drop = stopClearDrops([...near.solid, ...near.glow], eyes, VIEW_CLEAR_M, true);
  if (!drop.size) return;
  near.solid = near.solid.filter((b) => !drop.has(b));
  near.glow = near.glow.filter((b) => !drop.has(b));
}
function clearStopProps(plan: DistrictOut, near: Record<TailG, Block[]>, li0: number, lj0: number, ox: number, oz: number): void {
  const eyes: [number, number, number][] = [];
  for (let lj = Math.max(0, lj0 - 4); lj < Math.min(plan.d, lj0 + CITY_PD + 4); lj++) for (let li = Math.max(0, li0 - 4); li < Math.min(plan.w, li0 + CITY_PW + 4); li++) {
    if (plan.kind[lj * plan.w + li] === T_STOP) eyes.push(...stopEyes(ox, oz, li, lj, plan.lift[lj * plan.w + li]));
  }
  for (const s of plan.stops) if (s.board) { const li = s.board[0] - plan.i0, lj = s.board[1] - plan.j0; if (li >= 0 && lj >= 0 && li < plan.w && lj < plan.d) eyes.push(...stopEyes(ox, oz, li, lj, plan.lift[lj * plan.w + li])); } // CABLEVP1: biniş platformu
  const drop = stopClearDrops([...near.solid, ...near.glow], eyes);
  if (!drop.size) return;
  near.solid = near.solid.filter((b) => !drop.has(b));
  near.glow = near.glow.filter((b) => !drop.has(b));
}

/**
 * Semtin bir parseli (şehir parsel koordinatı cx, cz; parsel = şehir karosu [12·cx, +12) × [16·cz, +16)). Parsel semtin içinde
 * değilse null. Önbellekli (semt başına).
 */
export function districtParcel(map: CityMapFile, dist: CityDistrict, cx: number, cz: number): CityParcel | null {
  const plan = districtPlan(map, dist);
  const I0 = cx * CITY_PW, J0 = cz * CITY_PD;
  if (I0 < plan.i0 || J0 < plan.j0 || I0 + CITY_PW > plan.i0 + plan.w || J0 + CITY_PD > plan.j0 + plan.d) return null;
  let cache = parcelCache.get(plan);
  if (!cache) { cache = new Map(); parcelCache.set(plan, cache); }
  const key = (cx + 32768) * 65536 + (cz + 32768); // sayısal anahtar (sıcak yol: parsel sorgusu dize kurmaz)
  const hit = cache.get(key);
  if (hit) return hit;
  const p = drawParcel(plan, cx, cz);
  cache.set(key, p);
  return p;
}

/**
 * CORE-CITYMAP: semt düzeyinde cephe bütçe dağıtımı. Her parselin zorunlu katı blok sayısı (binalar hariç) ölçülür; binalar kendi
 * parselinin kalan yuvasına `fitFacades` ile sığdırılır. Yoğun landmark parselinde yalnız gövde + çatıya (−1) düşen bina, komşu
 * (8 komşu, aynı semt) parselin boş yuvasına taşınır (bloklar dünya koordinatında; yakın halka komşuyu birlikte yükler). Dönüş:
 * bina → çizildiği parsel ve kademesi. Semt başına bir kez (önbellek).
 */
/** `far`: uzak LOD kademesi (`facadeBlocks` far: 2 kat bantları + ayaklar, 1 tek cam kuşak + uzun eksen ayakları, 0 gövde + çatı + tek bant) — binanın merkez parselinde çizilir.*/
interface FacadeSlot { cx: number; cz: number; tier: FacadeTier; far: 0 | 1 | 2 }
const allocCache = new WeakMap<DistrictOut, Map<DistrictBuilding, FacadeSlot>>();
function facadeAlloc(plan: DistrictOut): Map<DistrictBuilding, FacadeSlot> {
  const hit = allocCache.get(plan);
  if (hit) return hit;
  const out = new Map<DistrictBuilding, FacadeSlot>();
  const st = facadeStyle(plan.mapId, plan.theme);
  const ox = cityX(plan.i0) - 0.5, oz = cityZ(plan.j0) - 0.5;
  const cx0 = plan.i0 / CITY_PW, cz0 = plan.j0 / CITY_PD, nx = plan.w / CITY_PW, nz = plan.d / CITY_PD;
  const spare: number[] = [], farSolid: number[] = [];
  const homeless: { bd: DistrictBuilding; p: number }[] = [];
  for (let b = 0; b < nz; b++) for (let a = 0; a < nx; a++) {
    const cx = cx0 + a, cz = cz0 + b, li0 = a * CITY_PW, lj0 = b * CITY_PD;
    const owned = plan.buildings.filter((bd) => {
      const x = Math.floor(bd.i0 + bd.w / 2), z = Math.floor(bd.j0 + bd.d / 2);
      return x >= li0 && z >= lj0 && x < li0 + CITY_PW && z < lj0 + CITY_PD;
    });
    const cp = drawParcel(plan, cx, cz, true);
    const room = CITY_NEAR_BUDGET.solid - cp.near.blocks.filter((q) => q.g === "solid").length;
    farSolid.push(cp.far.blocks.filter((q) => q.g === "solid").length);
    const fit = fitFacades(owned, st, ox, oz, room);
    let used = 0;
    owned.forEach((bd, k) => {
      if (fit.tiers[k] < 0) homeless.push({ bd, p: spare.length });
      else { out.set(bd, { cx, cz, tier: fit.tiers[k], far: 2 }); used += fit.blocks[k].length; }
    });
    spare.push(room - used);
  }
  for (const { bd, p } of homeless) {
    const a0 = p % nx, b0 = (p - a0) / nx;
    let best = -1;
    for (let b = Math.max(0, b0 - 1); b <= Math.min(nz - 1, b0 + 1); b++) for (let a = Math.max(0, a0 - 1); a <= Math.min(nx - 1, a0 + 1); a++) {
      const q = b * nx + a;
      if (q !== p && (best < 0 || spare[q] > spare[best])) best = q;
    }
    const tier = ([2, 1, 0] as FacadeTier[]).find((t) => best >= 0 && facadeBlocks(bd, st, ox, oz, t).length <= spare[best]);
    if (tier === undefined) {
      // komşuda da yer yok: kendi parselinde yalnız gövde + çatı (denetim sayar)
      out.set(bd, { cx: cx0 + a0, cz: cz0 + b0, tier: -1, far: 2 });
      spare[p] -= 2;
      continue;
    }
    spare[best] -= facadeBlocks(bd, st, ox, oz, tier).length;
    out.set(bd, { cx: cx0 + (best % nx), cz: cz0 + Math.floor(best / nx), tier, far: 2 });
  }
  // uzak LOD kademeleri — parselin uzak katı yuvası (< CITY_FAR_BUDGET.solid, düşen yok) aşılırken parseldeki en yüksek
  // kademeli, en çok bloklu bina bir kademe iner. Şehir toplamı silüet payına (parsel × CITY_FAR_FILL) sığar: AERIAL-LOD-003.
  const items = plan.buildings.map((bd) => {
    const p = Math.floor(Math.floor(bd.j0 + bd.d / 2) / CITY_PD) * nx + Math.floor(Math.floor(bd.i0 + bd.w / 2) / CITY_PW);
    return { bd, p, n: facadeBlocks(bd, st, ox, oz, 0, 2).length };
  });
  for (const it of items) farSolid[it.p] += it.n;
  for (;;) {
    const hot = farSolid.findIndex((v) => v >= CITY_FAR_BUDGET.solid);
    if (hot < 0) break;
    let k = -1;
    items.forEach((it, q) => {
      const a = out.get(it.bd)!.far, b = k < 0 ? -1 : out.get(items[k].bd)!.far;
      if (a > 0 && it.p === hot && (k < 0 || a > b || (a === b && it.n > items[k].n))) k = q;
    });
    if (k < 0) break;
    const it = items[k], sl = out.get(it.bd)!;
    sl.far = (sl.far - 1) as 0 | 1;
    const n = facadeBlocks(it.bd, st, ox, oz, sl.far ? 0 : -1, 1).length;
    farSolid[it.p] += n - it.n; it.n = n;
  }
  allocCache.set(plan, out);
  return out;
}

function drawParcel(plan: DistrictOut, cx: number, cz: number, core = false): CityParcel {
  const pal = PALETTES[plan.theme];
  const PW = CITY_PW, PD = CITY_PD, N = PW * PD;
  const I0 = cx * PW, J0 = cz * PD;
  const li0 = I0 - plan.i0, lj0 = J0 - plan.j0;
  const kindAt = (li: number, lj: number) => plan.kind[lj * plan.w + li];
  // şehir karosu I → dünya x merkezi: cityX(I); karo [I − 12, I − 11]
  const ox = cityX(plan.i0) - 0.5, oz = cityZ(plan.j0) - 0.5; // semt yerel (0, 0) karosunun sol-arka köşesi (dünya)
  const near: Record<TailG, Block[]> = { solid: [], water: [], glass: [], glow: [] };
  const far: Record<TailG, Block[]> = { solid: [], water: [], glass: [], glow: [] };
  let dropped = 0;
  const addN = (b: Block) => { const g = b.g as TailG; if (near[g].length < CITY_NEAR_BUDGET[g]) near[g].push(b); else dropped++; };
  const addF = (b: Block) => { const g = b.g as TailG; if (far[g].length < CITY_FAR_BUDGET[g]) far[g].push(b); };
  const owns = (li: number, lj: number) => li >= li0 && lj >= lj0 && li < li0 + PW && lj < lj0 + PD;

  // zemin (yakın): yürünebilir türler ve katıların altı sokak; su ayrı
  const keys = new Int16Array(N).fill(-1), wkeys = new Int16Array(N).fill(-1);
  const bed = bedOf(plan);
  for (let b = 0; b < PD; b++) for (let a = 0; a < PW; a++) {
    const k = kindAt(li0 + a, lj0 + b);
    if (k === T_WATER) wkeys[b * PW + a] = 0;
    // süs suyunun (katı karo üstünde nehir) altı sokak değil, suyun altında yatak (su zemin levhasının altında kalmasın)
    else if (bed.key[(lj0 + b) * plan.w + li0 + a] >= 0) keys[b * PW + a] = BED_KEY + bed.key[(lj0 + b) * plan.w + li0 + a];
    else keys[b * PW + a] = GROUND_KEYS.includes(k) ? (k === T_STOP || k === T_DOOR || k === T_VIEW ? T_PLAZA : k) : k === T_TREE || k === T_HEDGE ? T_PARK : T_STREET;
  }
  // yürünür yükselti karoları (sahanlık, basamak, rampa): yükseklik + renk başına ayrı anahtar (≥ 1000), sütun olarak çizilir
  const liftKeys = new Map<string, number>(), liftOf: { y: number; c: string }[] = [];
  for (let b = 0; b < PD; b++) for (let a = 0; a < PW; a++) {
    const t = (lj0 + b) * plan.w + li0 + a, y = plan.lift[t];
    // CORE-CITYMAP: yamaçta katılaşan direk karosu (T_WALL) yükselti sütununu korur
    if (!(y > 0.001) || !(walkableKind(plan.kind[t]) || plan.kind[t] === T_WALL)) continue;
    const ci = plan.liftColor[t], c = ci >= 0 ? plan.liftColors[ci] : groundColor(pal, keys[b * PW + a]);
    const lk = `${y}|${c}`;
    let key = liftKeys.get(lk);
    if (key === undefined) { key = 1000 + liftOf.length; liftKeys.set(lk, key); liftOf.push({ y, c }); }
    keys[b * PW + a] = key;
  }
  for (const [a, b, ww, dd, key] of mergeRects(keys, PW, PD)) {
    if (key >= 1000) {
      const { y, c } = liftOf[key - 1000];
      addN({ p: [ox + li0 + a + ww / 2, (y - 0.3) / 2, oz + lj0 + b + dd / 2], s: [ww, y + 0.3, dd], c, g: "solid", j: 0.04 });
      if (y >= 1) addF({ p: [ox + li0 + a + ww / 2, (y - 0.3) / 2, oz + lj0 + b + dd / 2], s: [ww, y + 0.3, dd], c, g: "solid", j: 0 });
      continue;
    }
    if (key >= BED_KEY) {
      addN({ p: [ox + li0 + a + ww / 2, bed.y[key - BED_KEY] - 0.15, oz + lj0 + b + dd / 2], s: [ww, 0.3, dd], c: BED_COLOR, g: "solid", j: 0.04 });
      continue;
    }
    addN({ p: [ox + li0 + a + ww / 2, groundY - 0.15, oz + lj0 + b + dd / 2], s: [ww, 0.3, dd], c: groundColor(pal, key), g: "solid", j: 0.04 });
    if (key === T_RAIL) {
      const along = ww >= dd;
      for (const off of [-0.22, 0.22]) addN({ p: along ? [ox + li0 + a + ww / 2, 0.02, oz + lj0 + b + dd / 2 + off] : [ox + li0 + a + ww / 2 + off, 0.02, oz + lj0 + b + dd / 2],
        s: along ? [ww, 0.04, 0.06] : [0.06, 0.04, dd], c: "#4A4744", g: "solid", j: 0 });
    }
  }
  for (const [a, b, ww, dd] of mergeRects(wkeys, PW, PD)) {
    addN({ p: [ox + li0 + a + ww / 2, -0.32, oz + lj0 + b + dd / 2], s: [ww, 0.2, dd], c: pal.water, g: "water", j: 0.03 });
    addF({ p: [ox + li0 + a + ww / 2, -0.32, oz + lj0 + b + dd / 2], s: [ww, 0.2, dd], c: pal.water, g: "water", j: 0 });
  }
  // çit (onarım karoları): birleştirilmiş alçak kutular
  const hkeys = new Int16Array(N).fill(-1);
  for (let b = 0; b < PD; b++) for (let a = 0; a < PW; a++) if (kindAt(li0 + a, lj0 + b) === T_HEDGE) hkeys[b * PW + a] = 0;
  for (const [a, b, ww, dd] of mergeRects(hkeys, PW, PD)) addN({ p: [ox + li0 + a + ww / 2, 0.35, oz + lj0 + b + dd / 2], s: [ww, 0.7, dd], c: pal.hedge, g: "solid", j: 0.06 });
  // uzak zemin: su hariç karoların birleşik dikdörtgenleri — parselin baskın rengi. eskiden tek parsel döşemesi suyun da
  // üstünü (su üst yüzü −0,22, döşeme 0) örtüyordu → uzak/silüet su sokak taşı gibi görünüp yaklaşınca suya dönüyordu (WATER-FAR-001)
  const lkeys = new Int16Array(N).fill(-1);
  for (let k = 0; k < N; k++) if (wkeys[k] < 0) lkeys[k] = 0;
  for (const [a, b, ww, dd] of mergeRects(lkeys, PW, PD)) addF({ p: [ox + li0 + a + ww / 2, groundY - 0.15, oz + lj0 + b + dd / 2], s: [ww, 0.3, dd], c: pal.street, g: "solid", j: 0 });

  // landmark modelleri (yakın ayrıntı, konuma göre parsel; uzak LOD merkez parselinde) ve tasarım süsleri — bütçe önceliği
  const ex = extrasOf(plan).get(`${cx},${cz}`);
  if (ex) { for (const b of ex.near) addN(b); for (const b of ex.far) addF(b); }
  // landmarklar (merkez karosunun parseli): önce, bütçe önceliği
  for (const lm of plan.landmarks) {
    if (!owns(Math.floor(lm.i0 + lm.w / 2), Math.floor(lm.j0 + lm.d / 2))) continue;
    if (!lm.model) {
      landmarkBlocks(lm, ox, oz, (b) => addN({ ...b, fix: 1 }));
      // uzak: gövde + tepe
      const cx0 = ox + lm.i0 + lm.w / 2, cz0 = oz + lm.j0 + lm.d / 2;
      addF({ p: [cx0, lm.h * 0.4, cz0], s: [Math.max(1, lm.w - 1), lm.h * 0.8, Math.max(1, lm.d - 1)], c: "#D2C6AE", g: "solid", j: 0 });
      addF({ p: [cx0, lm.h * 0.9, cz0], s: [Math.max(0.6, lm.w * 0.4), lm.h * 0.2, Math.max(0.6, lm.d * 0.4)], c: "#7A8FA6", g: "solid", j: 0 });
    }
    if (lm.door && lm.enterable) {
      const [dx, dz] = lm.door;
      addN({ p: [ox + dx + 0.5, 0.02 + plan.lift[dz * plan.w + dx], oz + dz + 0.5], s: [0.7, 0.04, 0.7], c: "#FDE68A", g: "glow", j: 0 });
    }
  }
  // ağaçlar, duraklar, seyir noktaları, kapı çerçevesi
  for (let b = 0; b < PD; b++) for (let a = 0; a < PW; a++) {
    const li = li0 + a, lj = lj0 + b, k = kindAt(li, lj);
    const x = ox + li + 0.5, z = oz + lj + 0.5;
    // yükselti karosunda işaretler (durak, seyir, lamba) sütunun üstünde
    const ly = plan.lift[lj * plan.w + li];
    const addL = (bk: Block) => addN(ly ? { ...bk, p: [bk.p[0], bk.p[1] + ly, bk.p[2]] } : bk);
    const addLF = (bk: Block) => addF(ly ? { ...bk, p: [bk.p[0], bk.p[1] + ly, bk.p[2]] } : bk);
    if (k === T_TREE) {
      // gerçek oran (ağaç 2,5–6 × yürüme insanı; walk/scaleStandard.ts) — gövde 1,4, taç 1,4–2,7; blok sayısı aynı
      addN(planTree({ p: [x, 0.7, z], s: [0.22, 1.4, 0.22], c: "#7A5638", g: "solid", j: 0.05 }));
      addN(planTree({ p: [x, 2.05, z], s: [1.0, 1.3, 1.0], c: "#5F8F45", g: "solid", j: 0.08 }));
    } else if (k === T_STOP) {
      // köşe direği + saçak + tabela kaldırıldı — direk 1. şahısta biniş karosunun 0,6 m'sinde ekranın ~%7'sini örtüyordu;
      // direği kesitle gizlemek saçağı/tabelayı havada bırakır (FX-VIEW-002 destek denetimi). Durak turnike ışığı + paspasla (DoorFxLayer) okunur.
      // 1 × 0,1 × 1 beyaz kaide kaldırıldı — avatar durakta ~10 cm yüksek bir plakanın üstünde "heykel gibi" duruyordu;
      // karo zaten plaza rengi (groundColor) + turnike ışığı + paspas + hat totemi ile okunur, yükselti yok
      // uzaktan okunan hat renkli totem — durağın 2 karo yanında yerde durur (turnike/varış/1. şahıs yakın bölgesi dışında)
      const mk = stopMarkSpot(plan, li, lj);
      if (mk) {
        const sk = plan.stops.find((q) => q.tile[0] === I0 + a && q.tile[1] === J0 + b)?.kind ?? "metro";
        const wx = Math.sign(mk.dx), wz = Math.sign(mk.dz), wi = mk.li + wx, wj = mk.lj + wz, wk = wi >= 0 && wj >= 0 && wi < plan.w && wj < plan.d ? plan.kind[wj * plan.w + wi] : -1; // cepheye yaslı mı
        const wb = wk >= 10 && (wx === 0) !== (wz === 0), mb = stopMarkBlocks(ox + mk.li + 0.5 + mk.dx, oz + mk.lj + 0.5 + mk.dz, STOP_MARK_COLOR[sk], sk === "teleferik" || sk === "balon", wb ? [wx, wz] : null);
        for (const bk of mb.near) addL(bk);
        for (const bk of mb.far) addLF(bk);
      }
    } else if (k === T_VIEW) {
      addL({ p: [x, 0.02, z], s: [0.8, 0.04, 0.8], c: "#A7F3D0", g: "glow", j: 0 });
    } else if (k === T_STREET && li % 12 === 0 && lj % 12 === 0 && !plan.corridor[lj * plan.w + li] && !nearStop(plan.kind, plan.w, plan.d, li, lj)) { // FIXPACK-A
      // sokak lambası (hücre köşesi kavşağı): gece semt okunur kalır. direk kavşağın ortasında değil, bitişik karonun
      // kaldırım çizgisinde (yürünmez komşunun kenarı; `lampSpot`) — kaldırım yoksa lamba yok. direk 2,3, fener üstü 2,46
      const at = lampSpot(plan, li, lj);
      if (at) {
        const ly2 = plan.lift[at.lj * plan.w + at.li];
        addN({ p: [at.x, 1.15 + ly2, at.z], s: [0.08, 2.3, 0.08], c: "#3F4650", g: "solid", j: 0 });
        addN({ p: [at.x, 2.38 + ly2, at.z], s: [0.26, 0.16, 0.26], c: pal.lamp, g: "glow", j: 0 });
        addF({ p: [at.x, 1.15 + ly2, at.z], s: [0.08, 2.3, 0.08], c: "#3F4650", g: "solid", j: 0 }); // uzak fener direksiz havada durmaz (AERIAL-LOD-002)
        addF({ p: [at.x, 2.38 + ly2, at.z], s: [0.26, 0.16, 0.26], c: pal.lamp, g: "glow", j: 0 });
      }
    }
  }

  // CORE-CITYMAP: binalar en sonda — şehre özgü cephe (citymap/facade.ts): kat kat pencere, kapı, korniş/balkon/çatı türü. Kademe
  // ve parsel semt düzeyindeki bütçe dağıtımından (`facadeAlloc`): zorunlu bloklardan (zemin, landmark, süs, ağaç, durak, lamba) kalan
  // katı yuvaya sığar; uzak LOD gövdesi binanın kendi parselinde.
  const facade: [number, number, number, number] = [0, 0, 0, 0];
  if (!core && plan.buildings.length) {
    const alloc = facadeAlloc(plan), st = facadeStyle(plan.mapId, plan.theme);
    for (const bd of plan.buildings) {
      const slot = alloc.get(bd);
      if (slot && slot.cx === cx && slot.cz === cz) { facade[slot.tier + 1]++; for (const bk of facadeBlocks(bd, st, ox, oz, slot.tier)) { bk.fix = 1; addN(bk); } }
      // uzak LOD gövdesi artık çıplak kutu değil — kat bandı, seyrek ayak (pencere ritmi), tipin çatısı; kademe `facadeAlloc`'tan
      const fl = slot?.far ?? 2;
      if (owns(Math.floor(bd.i0 + bd.w / 2), Math.floor(bd.j0 + bd.d / 2))) for (const bk of facadeBlocks(bd, st, ox, oz, fl ? 0 : -1, fl || 1)) addF(bk);
    }
  }

  // çarpışma: katı karo tam kutu; üst yüz
  const solid = new Uint8Array(N), walk = new Uint8Array(N), box = new Float32Array(N * 4), topArr = new Float32Array(N).fill(NaN);
  for (let b = 0; b < PD; b++) for (let a = 0; a < PW; a++) {
    const k = b * PW + a, kd = kindAt(li0 + a, lj0 + b);
    const I = I0 + a, J = J0 + b;
    box[k * 4] = I - 12; box[k * 4 + 1] = J - 8; box[k * 4 + 2] = I - 11; box[k * 4 + 3] = J - 7;
    if (walkableKind(kd) && !plan.markSolid?.has((lj0 + b) * plan.w + li0 + a)) { walk[k] = 1; topArr[k] = plan.top[(lj0 + b) * plan.w + li0 + a]; } // REVFIX1: totem
    else solid[k] = 1;
  }
  if (!core) { clearStopProps(plan, near, li0, lj0, ox, oz); clearViewPoles(plan, near, li0, lj0, ox, oz); } // core (cephe bütçe sayımı) main ile aynı kalır: boşalan yuva cephe kademesini değiştirmez
  const blocks = [...near.solid, ...near.water, ...near.glass, ...near.glow];
  const fblocks = [...far.solid, ...far.water, ...far.glass, ...far.glow];
  return { cx, cz, district: plan.id, near: { blocks, solid, box, walk, top: topArr }, far: { blocks: fblocks }, dropped, facade };
}

/**
 * FIXPACK-D kalıcı kural: "görünür blok olmadan katı karo yok". Gövde / tezgâh kuralıyla katılaşan (`propWall`) her karonun üstünde, çizilen
 * (yakın halka) bir katı blok bulunmalı; yoksa oyuncu boş görünen karoya çarpar. Dönüş: görünmez duvar karoları (kural: boş).
 */
/** GATEFIX3: `world` verilirse (çizilen dünya: hi-res simgeler dahil) görünür blok oradan aranır — hi-res kademesi orta modelin bloğunu değiştirir. */
export function solidWithoutBlock(map: CityMapFile, dist: CityDistrict, world?: readonly Block[]): { li: number; lj: number }[] {
  const plan = districtPlan(map, dist), out: { li: number; lj: number }[] = [];
  const pw = plan.propWall;
  if (!pw) return out;
  const ox = cityX(plan.i0) - 0.5, oz = cityZ(plan.j0) - 0.5;
  const px0 = Math.floor(plan.i0 / CITY_PW), px1 = Math.floor((plan.i0 + plan.w - 1) / CITY_PW), pz0 = Math.floor(plan.j0 / CITY_PD), pz1 = Math.floor((plan.j0 + plan.d - 1) / CITY_PD);
  const blocks: Block[] = [];
  if (world) { for (const b of world) if (b.p[0] + b.s[0] / 2 >= ox - 1 && b.p[0] - b.s[0] / 2 <= ox + plan.w + 1 && b.p[2] + b.s[2] / 2 >= oz - 1 && b.p[2] - b.s[2] / 2 <= oz + plan.d + 1) blocks.push(b); }
  else for (let cz = pz0; cz <= pz1; cz++) for (let cx = px0; cx <= px1; cx++) { const pc = districtParcel(map, dist, cx, cz); if (pc) blocks.push(...pc.near.blocks); }
  for (let k = 0; k < pw.length; k++) {
    if (!pw[k] || plan.kind[k] !== T_WALL) continue;
    const li = k % plan.w, lj = (k - li) / plan.w, x0 = ox + li, z0 = oz + lj;
    const seen = blocks.some((b) => b.g === "solid" && b.p[1] + b.s[1] / 2 >= WB_MIN_H
      && Math.min(b.p[0] + b.s[0] / 2, x0 + 1) - Math.max(b.p[0] - b.s[0] / 2, x0) > -0.1 && Math.min(b.p[2] + b.s[2] / 2, z0 + 1) - Math.max(b.p[2] - b.s[2] / 2, z0) > -0.1);  // kenara oturan korkuluk (köprü) bitişik karoyu katılaştırır: ≤ 0,1 aralık "görünür"
    if (!seen) out.push({ li, lj });
  }
  return out;
}

/** Parsel karması (belirlenimcilik denetimi). */
export function cityParcelHash(p: CityParcel): string {
  const bs = (list: readonly Block[]) => list.map((b) => `${b.p.map((v) => v.toFixed(3)).join(",")}|${b.s.map((v) => v.toFixed(3)).join(",")}|${b.c}|${b.g}|${b.j}`).join(";");
  return `${bs(p.near.blocks)}#${bs(p.far.blocks)}#${Array.from(p.near.solid).join("")}`;
}
