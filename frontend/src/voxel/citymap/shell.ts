/**
 * şehir haritasının çizim ve yürüme tabanı: **varış meydanı** (gate, 12 × 16 karo; şehrin iskelesi ya da meydanı) ve
 * şehrin sahne tanımı.
 *
 * - World.tsx şehir kipinde ofis dünyasının yerine bu `Built`'i çizer (iç mekân sahne modeliyle aynı desen): ajanlar ofiste
 * kalır (D5 A), ofis tabanı ve onun kuralları değişmez. Semtler bu tabanın kapasite kuyruğuna akar (`source.ts`, +0 çizim).
 * - Taban dört durağan grubu (`solid/water/glass/glow`) içerir: kuyruk yalnız tabanda var olan gruplara yazılabilir.
 * - "Ofise dön" kapısı iskelenin ucunda (`GATE_RETURN`); varış karosu meydanın ortası, avatar −z'ye (semte) bakar.
 * - Sahne tanımı ofis sahnesinden türer (gökyüzü, ışık, saat, hava aynı — gündüz/gece ve hava şehirde de çalışır); sis uzar,
 * çekirdek/katman yok; kıyı şehirlerinde deniz düzlemi semtlerin altındadır.
 *
 * Saf modül: React/three yok.
*/
import { packCache } from "../citypacks/cityOverlay";
import type { Block, Built, SceneDef, Tile } from "../scenes";
import { tx, tz } from "../scenes";
import { habitat } from "../ambient/habitat";
import { zoneDistance } from "../city/sacred";
import type { FishSpot } from "../fun/sites";
import { SCENE_BIOME } from "../fun/minigameLogic";
import { lineRoute, vehicleHalfLength } from "../transit/model";
import { districtAt, GATE_D, GATE_W, stopTile, type CityMapFile, type VehicleKind } from "./format";
import { designOf } from "./designs";
import { districtPlan, districtWater, T_DOOR, T_RAIL, T_STOP, T_VIEW, walkableKind } from "./district";
import { portalFrameBlocks } from "./door";
import { cityFog } from "./viewDistance";
import { ARRIVAL_KITS, arrivalKitBuild, type ArchSpec } from "./arrivalKit";

/** Varış karosu (gate yerel = şehir karosu) ve "Ofise dön" kapısı. */
export const GATE_ARRIVE: Tile = [6, 7];
export const GATE_RETURN: Tile = [6, 14];

const shellCache = packCache(() => new Map<string, Built>());

/** haritadaki ibadet yeri landmarklarının kutsal bölgeleri (tasarım katmanı `sacred`; tampon 1 karo).*/
export function sacredZonesOf(map: CityMapFile): Built["zones"] {
  const design = designOf(map.id);
  const out: NonNullable<Built["zones"]> = [];
  if (!design) return out;
  for (const d of map.districts) for (const lm of d.landmarks) {
    if (!design.landmarks[lm.id]?.sacred) continue;
    out.push({ kind: "sacred", i0: d.bounds[0] + lm.tile[0], j0: d.bounds[1] + lm.tile[1], w: lm.w, d: lm.d, buffer: 1, tag: lm.id });
  }
  return out;
}
const gates = new WeakMap<object, CityMapFile>();
/** Şehir haritasının varış meydanı mı (Yakındakiler'de ofis nesneleri, hatıralar ve keşif öğeleri aranmaz). */
export const isGateBuilt = (b: object) => gates.has(b);
/** varış meydanının şehir haritası (Yakındakiler'in şehir olta noktaları); meydan değilse null.*/
export const gateMapOf = (b: object): CityMapFile | null => gates.get(b) ?? null;

/** Varış meydanı (önbellekli; aynı harita → aynı nesne: navGrid/staticWorld önbelleği kararlı kalır). */
export function gateBuilt(map: CityMapFile): Built {
  const hit = shellCache().get(map.id);
  if (hit) return hit;
  const blocks: Block[] = [];
  const blocked = new Set<string>();
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, g: Block["g"] = "solid", j = 0) =>
    blocks.push({ p: [x, y, z], s: [w, h, d], c, g, j });
  const pier = map.gate.kind === "pier";
  const landD = pier ? 12 : GATE_D;
  // ARRIVAL-ORIGIN: şehre özgü varış kompozisyonu (zemin dokusu, sokak öğeleri, kemer biçimi); kiti olmayan harita genel şablonda
  const spec = ARRIVAL_KITS[map.id];
  const kit = spec ? arrivalKitBuild(map.id, GATE_ARRIVE, GATE_RETURN, landD, GATE_W) : null;
  // zemin: meydan taşı (+ iskele uzantısı)
  box((tx(0) + tx(GATE_W - 1)) / 2, -0.15, (tz(0) + tz(landD - 1)) / 2, GATE_W, 0.3, landD, spec?.ground.base ?? "#CDBFA8", "solid", 0.04);
  if (pier) {
    box((tx(5) + tx(6)) / 2, -0.12, (tz(12) + tz(15)) / 2, 2, 0.24, 4, "#9C7A55", "solid", 0.05);
    for (let j = 12; j < GATE_D; j++) for (let i = 0; i < GATE_W; i++) if (i < 5 || i > 6) blocked.add(`${i},${j}`);
    box((tx(0) + tx(4)) / 2, -0.32, (tz(12) + tz(15)) / 2, 5, 0.2, 4, "#3E8DB5", "water", 0.03);
    box((tx(7) + tx(11)) / 2, -0.32, (tz(12) + tz(15)) / 2, 5, 0.2, 4, "#3E8DB5", "water", 0.03);
    // iskele babaları
    for (const j of [12, 15]) for (const i of [5, 6]) box(tx(i) + (i === 5 ? -0.4 : 0.4), 0.15, tz(j), 0.14, 0.3, 0.14, "#5B4636");
  } else if (!kit?.items.some((it) => it.blocks.some((b) => b.g === "water"))) {
    // meydan: su yerine küçük süs havuzu (su grubu tabanda bulunsun)
    box(tx(2), -0.05, tz(13), 1.6, 0.12, 1.6, "#3E8DB5", "water", 0.03);
    blocked.add("2,13");
  }
  // "Ofise dön" kapısı: kemer (direkler komşu engelli karolarda; lento gövde bandının üstünde) + parlayan zemin
  const [ri, rj] = GATE_RETURN;
  box(tx(ri) - 1.05, 0.9, tz(rj), 0.18, 1.8, 0.18, spec?.arch.post ?? "#6B5B4A");
  box(tx(ri) + 1.05, 0.9, tz(rj), 0.18, 1.8, 0.18, spec?.arch.post ?? "#6B5B4A");
  box(tx(ri), 1.85, tz(rj), 2.3, 0.18, 0.22, spec?.arch.lintel ?? "#6B5B4A");
  if (spec) blocks.push(...archCrown(tx(ri), tz(rj), spec.arch));
  box(tx(ri), 0.02, tz(rj), 0.8, 0.04, 0.8, "#FDE68A", "glow");
  // CORE-WALK (REAL-PORTAL): kemerin ortasında geri dönüş geçidinin ışık çerçevesi (ışınlanma halkası CityRig'de)
  blocks.push(...portalFrameBlocks(tx(ri), tz(rj), true, "#FDE68A", "#5EEAD4"));
  if (!pier) { blocked.add(`${ri - 1},${rj}`); blocked.add(`${ri + 1},${rj}`); }
  if (kit) {
    for (const it of kit.items) {
      blocks.push(...it.blocks);
      for (const [i, j] of it.cells) blocked.add(`${i},${j}`);
    }
    blocks.push(...kit.ground);
    // durağan dört grup tabanda bulunsun (kuyruk yalnız var olan gruba yazılır): kitte cam yoksa kemer alnına cam levha
    if (!blocks.some((b) => b.g === "glass")) box(tx(ri), 1.62, tz(rj) - 0.14, 0.7, 0.2, 0.03, "#A9CFE0", "glass");
  } else {
    // bilgi köşkü (cam) ve fenerler (parıltı)
    box(tx(1), 0.7, tz(2), 0.9, 1.4, 0.9, "#55606B");
    box(tx(1), 0.95, tz(2) + 0.46, 0.7, 0.5, 0.04, "#A9CFE0", "glass");
    blocked.add("1,2");
    for (const [i, j] of [[0, 8], [11, 8]] as Tile[]) {
      box(tx(i), 0.8, tz(j), 0.12, 1.6, 0.12, "#3F4650");
      box(tx(i), 1.68, tz(j), 0.3, 0.2, 0.3, "#FFE3A3", "glow");
      blocked.add(`${i},${j}`);
    }
  }
  const built: Built = {
    blocks, blocked, stations: [], rest: [], lights: [], spots: {}, props: [], ambient: [],
    width: GATE_W, depth: GATE_D,
    modules: [{ i0: 0, j0: 0, w: GATE_W, d: GATE_D, base: true, slots: [0, 0], kind: "hq" }],
    // şehirdeki ibadet yerlerinin kutsal bölgeleri (şehir karosu = bu tabanın karosu): sessizlik, emote/mini oyun/şaka yok
    zones: sacredZonesOf(map),
  };
  shellCache().set(map.id, built);
  gates.set(built, map);
  return built;
}

/** ARRIVAL-ORIGIN: dönüş kemerinin şehre özgü tacı (lento üstü 1,94; kuşak 1,94–2,00, taç 2,00'dan). */
function archCrown(cx: number, cz: number, a: ArchSpec): Block[] {
  const out: Block[] = [];
  const box = (x: number, y0: number, w: number, h: number, d: number, c: string) => out.push({ p: [cx + x, y0 + h / 2, cz], s: [w, h, d], c, g: "solid", j: 0 });
  box(0, 1.94, 2.36, 0.06, 0.26, a.trim);
  if (a.crown === "beam") { box(0, 2.0, 0.24, 0.2, 0.16, a.lintel); box(0, 2.2, 3.0, 0.14, 0.3, a.post); box(0, 2.34, 3.2, 0.08, 0.34, a.lintel); }
  else if (a.crown === "dome") { box(0, 2.0, 0.9, 0.12, 0.2, a.lintel); box(0, 2.12, 0.62, 0.16, 0.18, a.post); box(0, 2.28, 0.36, 0.12, 0.14, a.post); box(0, 2.4, 0.06, 0.16, 0.06, a.trim); }
  else if (a.crown === "pediment") { box(0, 2.0, 2.0, 0.12, 0.2, a.lintel); box(0, 2.12, 1.4, 0.12, 0.18, a.lintel); box(0, 2.24, 0.8, 0.12, 0.16, a.post); }
  else if (a.crown === "horseshoe") {
    for (const s of [-1, 1]) { out.push({ p: [cx + s * 0.84, 1.62, cz], s: [0.24, 0.28, 0.16], c: a.post, g: "solid", j: 0 }); }
    box(0, 2.0, 2.2, 0.14, 0.2, a.post); box(0, 2.14, 2.2, 0.06, 0.24, a.trim);
  }
  return out;
}

const defCache = new WeakMap<SceneDef, Map<string, SceneDef>>();
/** Şehrin sahne tanımı: ofis sahnesinin gökyüzü/ışık/saat/havası; çekirdek ve katman yok; deniz düzlemi kıyı şehirlerinde. */
export function cityDef(base: SceneDef, map: CityMapFile): SceneDef {
  let m = defCache.get(base);
  if (!m) { m = new Map(); defCache.set(base, m); }
  const hit = m.get(map.id);
  if (hit) return hit;
  const def: SceneDef = {
    ...base, core: undefined, tier: undefined, annex: base.annex ?? base.id,
    // TOUR-VIEW: sis akış yarıçapına bağlı (viewDistance.ts cityFog): başlangıç ileri yükleme erişimini geçmez, bitiş şehrin
    // havasına göre (silüet katmanı pus sınırıyla her uzaklıkta görünür kalır)
    fog: ((f) => [f.near, f.far] as [number, number])(cityFog(map.id)),
    ocean: map.sea ? { color: "#2F7EA8", y: CITY_SEA_Y } : undefined,
  };
  m.set(map.id, def);
  return def;
}

// ------------------------------------------------------------------------------------------ şehir haritasında olta
/** Kıyı şehirlerinde semtlerin altındaki ve ötesindeki deniz düzleminin yüzü (sahne tanımı `ocean.y`). */
export const CITY_SEA_Y = -0.42;
/** Aynı su gövdesinde iki olta noktası arasında en az bu kadar karo (Chebyshev; Yakındakiler kalabalıklaşmaz). */
export const CITY_FISH_SPACING = 5;
/** Durak karosundan (biniş karosu ve 3 × 3 durak meydanı) en az bu kadar karo uzak (Chebyshev > değer). */
export const CITY_FISH_STOP_CLEAR = 2;
/** Su hattı (vapur, kayık) rotasından — rıhtımda bekleyen ve geçen gövde — karo ortası ve şamandıra en az bu kadar uzak. */
export const CITY_FISH_ROUTE_CLEAR = 2.5;
/** köşe taşması (gövde yarı boyu kadar uzatılan parça) için açıklık: gövde yarı eni (≤ 1) + olta payı (0,3) + pay.*/
export const CITY_FISH_OVERHANG_CLEAR = 1.6;
/** Kutsal bölge tamponu (karo): ile aynı 3 karo (bölgenin kendi tamponu daha büyükse o).*/
export const CITY_FISH_SACRED_CLEAR = 3;
/** Denize bağlı olmayan ve bundan küçük su gövdesi gölettir (göl türleri; habitat.ts POND_MAX ile aynı). */
const CITY_POND_MAX = 60;
const CITY_MAX_SPOTS = 400;
/** Su üstünde giden hatlar ( canlı katmanı ve binilen yolculuk aynı rotayı izler).*/
const WATER_LINES: ReadonlySet<VehicleKind> = new Set<VehicleKind>(["vapur", "kayik"]);

export interface CityFishSpot extends FishSpot {
  /** su gövdesi (`CityFishing.bodies` dizini) */
  body: number;
  /** semt kimliği; varış meydanında null */
  district: string | null;
  /** kararlı kimlik sırası (Yakındakiler `fish:c<n>`) */
  n: number;
}
export interface CityWaterBody {
  tiles: number; open: number; y: number;
  /** semt dışı açık denize (deniz düzlemi) bağlı */
  sea: boolean;
  /** kapalı su (küçük; deniz biyomlu şehirde her boyda): olta göl türleri (`fishWater` "pond") */
  pond: boolean;
  /** gövdenin semtleri (varış meydanı "gate", semt dışı deniz "sea") */
  where: string[];
}
export interface CityFishing { spots: CityFishSpot[]; bodies: CityWaterBody[] }

const fishCache = new WeakMap<CityMapFile, { sig: readonly object[]; out: CityFishing }>();

/** Nokta → çoklu çizgi uzaklığı (karo). */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

/**
 * şehir haritasının olta noktaları (harita başına bir kez; semt planı değişirse — şehir paketi — yeniden).
 *
 * - **Su:** semtlerde gerçekten çizilen su blokları (`districtWater`: açık, film değil, köprü/ada altı değil), varış meydanının
 * iskele suyu (`habitat`) ve kıyı şehirlerinde semt dışındaki deniz düzlemi (`CITY_SEA_Y`). 4-komşu aynı seviyeli kümeler su
 * gövdesidir; semt dışı denize bağlı gövde denizdir, kapalı küçük gövde gölettir (göl türleri), gerisi sahnenin açık su biyomu.
 * - **Nokta:** yürünür, düz (yükseltisiz) karo; önünde (1 karo ya da alçak bir engelin ardında 2 karo) açık su ve onun ardında
 * da su. Şamandıra o karonun su yüzünde. Ray, durak, kapı, seyir karosu ve araç koridoru nokta olmaz.
 * - **Kurallar:** kutsal bölgenin 3 karo tamponu dışında; durak karosundan `CITY_FISH_STOP_CLEAR` karodan uzak; vapur/kayık
 * rotasından ( canlı aracının rıhtım bekleyişi ve geçişi dahil) karo ortası ve şamandıra `CITY_FISH_ROUTE_CLEAR` uzak;
 * varış/dönüş kapısının yanında değil. Önce her su gövdesine bir nokta, sonra gövde başına `CITY_FISH_SPACING` aralıkla.
 * - **Akış:** liste bütün haritanındır; Yakındakiler yalnız yüklü (yakın halkadaki) parsellerin noktalarını gösterir
 * (components/world/walk/entities.ts).
*/
export function cityFishing(map: CityMapFile): CityFishing {
  const sig = map.districts.map((d) => districtPlan(map, d));
  const hit = fishCache.get(map);
  if (hit && hit.sig.length === sig.length && hit.sig.every((p, k) => p === sig[k])) return hit.out;

  // sınır kutusu: varış meydanı ∪ semtler, 2 karo pay (payın ötesi semt dışı denizdir)
  let i0 = 0, j0 = 0, i1 = GATE_W, j1 = GATE_D;
  for (const d of map.districts) { i0 = Math.min(i0, d.bounds[0]); j0 = Math.min(j0, d.bounds[1]); i1 = Math.max(i1, d.bounds[0] + d.bounds[2]); j1 = Math.max(j1, d.bounds[1] + d.bounds[3]); }
  i0 -= 2; j0 -= 2; i1 += 2; j1 += 2;
  const w = i1 - i0, h = j1 - j0, n = w * h;
  const at = (I: number, J: number) => (J - j0) * w + (I - i0);
  const inBox = (I: number, J: number) => I >= i0 && J >= j0 && I < i1 && J < j1;
  const wy = new Float32Array(n).fill(-9), open = new Uint8Array(n), walk = new Uint8Array(n), spotOk = new Uint8Array(n);
  /** 0 semt dışı, 1 varış meydanı, 2 + semt dizini */
  const area = new Int16Array(n);

  const gate = gateBuilt(map), gh = habitat(gate);
  for (let J = 0; J < GATE_D; J++) for (let I = 0; I < GATE_W; I++) {
    const k = at(I, J), g = J * gate.width + I;
    area[k] = 1;
    wy[k] = gh.waterY[g]; open[k] = gh.open[g];
    if (gh.walk[g]) { walk[k] = 1; spotOk[k] = 1; }
  }
  // varış karosu ve "Ofise dön" kapısının çevresi nokta olmaz
  for (const [ti, tj, r] of [[GATE_ARRIVE[0], GATE_ARRIVE[1], 0], [GATE_RETURN[0], GATE_RETURN[1], 1]] as const)
    for (let J = tj - r; J <= tj + r; J++) for (let I = ti - r; I <= ti + r; I++) if (inBox(I, J)) spotOk[at(I, J)] = 0;
  map.districts.forEach((d, di) => {
    const plan = districtPlan(map, d), dw = districtWater(map, d);
    for (let lj = 0; lj < plan.d; lj++) for (let li = 0; li < plan.w; li++) {
      const l = lj * plan.w + li, k = at(plan.i0 + li, plan.j0 + lj), kd = plan.kind[l];
      area[k] = 2 + di;
      wy[k] = dw.y[l]; open[k] = dw.open[l];
      if (!walkableKind(kd)) continue;
      walk[k] = 1;
      if (kd !== T_RAIL && kd !== T_STOP && kd !== T_DOOR && kd !== T_VIEW && !plan.corridor[l] && Math.abs(plan.top[l]) < 0.05) spotOk[k] = 1;
    }
  });
  if (map.sea) for (let k = 0; k < n; k++) if (area[k] === 0) { wy[k] = CITY_SEA_Y; open[k] = 1; }

  // su gövdeleri (4-komşu, aynı seviye; kutunun kenarındaki su semt dışı denize açılır)
  const bodyOf = new Int32Array(n).fill(-1);
  const bodies: CityWaterBody[] = [];
  const seaCity = (SCENE_BIOME[map.id] ?? "sea") === "sea";
  for (let s = 0; s < n; s++) {
    if (wy[s] <= -9 || bodyOf[s] >= 0) continue;
    const id = bodies.length, q = [s], where = new Set<string>();
    bodyOf[s] = id;
    let tiles = 0, nOpen = 0, ySum = 0, sea = false;
    for (let p = 0; p < q.length; p++) {
      const c = q[p], ci = c % w, cj = (c - ci) / w;
      tiles++;
      if (open[c]) { nOpen++; ySum += wy[c]; }
      const a = area[c];
      if (a === 0) sea = true;
      where.add(a === 0 ? "sea" : a === 1 ? "gate" : map.districts[a - 2].id);
      if (ci === 0 || cj === 0 || ci === w - 1 || cj === h - 1) sea = true;
      for (const [x, z] of [[ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]]) {
        if (x < 0 || z < 0 || x >= w || z >= h) continue;
        const nk = z * w + x;
        if (wy[nk] > -9 && bodyOf[nk] < 0 && Math.abs(wy[nk] - wy[c]) < 0.3) { bodyOf[nk] = id; q.push(nk); }
      }
    }
    // denize bağlı değilse: küçükse gölet; deniz biyomlu şehirde (İstanbul, <city>, <city>, <city>) kapalı su deniz olamaz → göl
    // türleri; nehir biyomlu şehirde (<city>, Londra) büyük kapalı su nehir kesitidir (sahnenin açık su biyomu)
    const pond = !sea && (tiles <= CITY_POND_MAX || seaCity);
    bodies.push({ tiles, open: nOpen, y: nOpen ? +(ySum / nOpen).toFixed(3) : wy[s], sea, pond, where: [...where].sort() });
  }

  // yasak alanlar: kutsal bölge, duraklar, su hattı rotaları
  const sacred = sacredZonesOf(map) ?? [];
  const stops = map.stops.map((s) => stopTile(map, s)).filter((t): t is [number, number] => !!t);
  // rota köşesinde gövde (yönü 90°'ye yuvarlanır) köşeden yarı boyu kadar ileri (gelen yönde) ve geri (giden yönün
  // tersine) taşar → köşe noktası iki yöne yarı boy kadar uzatılan parçalar da rotadır (uzun vapurun burnu oltaya değmesin);
  // bu parçalarda açıklık gövdenin yarı enine göredir (`CITY_FISH_OVERHANG_CLEAR`), rota çizgisinin 2,5'i değil
  const routes = map.lines.filter((l) => WATER_LINES.has(l.kind)).map((l) => {
    const r = lineRoute(map, l), h = vehicleHalfLength(l.kind), segs: [number, number, number, number, number][] = [];
    for (let k = 0; k + 1 < r.length; k++) segs.push([r[k][0], r[k][1], r[k + 1][0], r[k + 1][1], CITY_FISH_ROUTE_CLEAR]);
    for (let k = 1; k + 1 < r.length; k++) {
      const [ax, az] = r[k - 1], [cx, cz] = r[k], [bx, bz] = r[k + 1];
      const li = Math.hypot(cx - ax, cz - az) || 1, lo = Math.hypot(bx - cx, bz - cz) || 1;
      segs.push([cx, cz, cx + ((cx - ax) / li) * h, cz + ((cz - az) / li) * h, CITY_FISH_OVERHANG_CLEAR], [cx, cz, cx - ((bx - cx) / lo) * h, cz - ((bz - cz) / lo) * h, CITY_FISH_OVERHANG_CLEAR]);
    }
    return segs;
  });
  const nearRoute = (I: number, J: number) => routes.some((r) => r.some(([ax, az, bx, bz, c]) => segDist(I, J, ax, az, bx, bz) < c));
  const allowed = (I: number, J: number) => !sacred.some((z) => zoneDistance([I, J], z) <= Math.max(CITY_FISH_SACRED_CLEAR, z.buffer ?? 0))
    && !stops.some((s) => Math.max(Math.abs(s[0] - I), Math.abs(s[1] - J)) <= CITY_FISH_STOP_CLEAR);

  // adaylar (satır sırası): suya bakan yürünür karo
  const DIRS: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  const waterAt = (I: number, J: number) => (inBox(I, J) ? wy[at(I, J)] : map.sea ? CITY_SEA_Y : -9);
  const openAt = (I: number, J: number) => (inBox(I, J) ? open[at(I, J)] === 1 : !!map.sea);
  const cands: { I: number; J: number; s: FishSpot; body: number }[] = [];
  for (let J = j0; J < j1; J++) for (let I = i0; I < i1; I++) {
    const k = at(I, J);
    if (!spotOk[k] || !allowed(I, J)) continue;
    for (const [dx, dz] of DIRS) {
      let reach = 0;
      for (const r of [1, 2]) {
        const ni = I + dx * r, nj = J + dz * r;
        if (openAt(ni, nj) && waterAt(ni, nj) > -9) {
          if (waterAt(ni + dx, nj + dz) <= -9) break; // tek karoluk oluk/havuz kenarı değil
          reach = r;
          break;
        }
        if (r === 1 && inBox(ni, nj) && walk[at(ni, nj)]) break; // önü yürünür kara: kıyı değil
      }
      if (!reach) continue;
      const ni = I + dx * reach, nj = J + dz * reach, y = waterAt(ni, nj);
      if (y > -0.05) continue; // su ayak altında (yükseltilmiş havuz/fıskiye değil)
      const off = reach + 0.35;
      const bxT = I + dx * off, bzT = J + dz * off;
      if (nearRoute(I, J) || nearRoute(bxT, bzT) || !allowed(ni, nj)) continue;
      const body = inBox(ni, nj) ? bodyOf[at(ni, nj)] : bodies.findIndex((b) => b.sea);
      if (body < 0) continue;
      const s: FishSpot = { tile: [I, J], face: Math.atan2(dx, dz), bx: tx(I) + dx * off, by: y, bz: tz(J) + dz * off };
      if (bodies[body].pond) s.pond = true;
      cands.push({ I, J, s, body });
      break;
    }
  }
  // önce her gövdeye bir nokta, sonra gövde başına aralıklı
  const taken: typeof cands = [], served = new Set<number>();
  const far = (c: (typeof cands)[number]) => taken.every((t) => t.body !== c.body || Math.max(Math.abs(t.I - c.I), Math.abs(t.J - c.J)) >= CITY_FISH_SPACING);
  for (const c of cands) if (!served.has(c.body) && taken.length < CITY_MAX_SPOTS) { served.add(c.body); taken.push(c); }
  const chosen = new Set(taken);
  for (const c of cands) if (taken.length < CITY_MAX_SPOTS && !chosen.has(c) && far(c)) { chosen.add(c); taken.push(c); }
  taken.sort((a, b) => a.J - b.J || a.I - b.I);
  const spots: CityFishSpot[] = taken.map((c, k) => {
    const d = districtAt(map, c.I, c.J);
    return { ...c.s, body: c.body, district: d ? d.id : null, n: k };
  });
  const out: CityFishing = { spots, bodies };
  fishCache.set(map, { sig, out });
  return out;
}
