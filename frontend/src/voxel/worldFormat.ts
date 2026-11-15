/**
 * Faz 7a (S30) — `voxcrew-world.json` v1: iki katman — düzenlenebilir semantik
 * katman (zemin ızgarası + prefab listesi + navigasyon) ve ondan belirlenimci olarak pişen voxel katmanı (`bakeWorld`).
 * 11 yerleşik sahne `voxel/worlds/*.json` olarak bu biçimde depodadır; `frontend/scripts/worlds.mjs` her birinin
 * `bakeWorld(json)` çıktısının `SCENES[id].build` ile birebir aynı olduğunu denetler.
 *
 * Doğrulama (`validateWorld`) hem içe aktarılan bilinmeyen JSON'u hem editör taslağını denetler: şema (tür, renk, grup,
 * sınırlar, güvensiz metin) + navigasyon (istasyon/dinlenme yürünebilir ve tek bağlı bileşende, blok bütçesi).
 * Backend `studio/worlds/validate.py` aynı kodları üretir (TR ileti + EN katalog).
*/
import { blockCounters, Builder, CITY_SCENE_IDS, D as BASE_D, key, tx, tz, W as BASE_W, type AmbientHook, type Built, type Light, type Mover, type SceneDef, type SceneTime, type SceneZone, type Station, type Tile, type ToolKind, type WeatherKind, type WorldSceneId } from "./scenes";
import { ATMOSPHERE, bakePrefab, footprint, GROUPS, PREFAB_TYPES, STATIC_GROUPS, type Part, type Prefab } from "./prefabs";
import { isSpinPart, MAX_SPIN_BLOCKS } from "./spin";
import { MAX_MOVER_BOXES, MAX_MOVERS, SHAPES as MOVER_SHAPES } from "./props/movers";
import { BLOCK_BY_ID, BLOCK_ID_RE, isBuildPrefab, MAX_EDITS, MAX_EDITS_TOTAL, MAX_PREFABS as MAX_PLOT_PREFABS, PLOT_D, PLOT_H, PLOT_W, type PlotBody } from "./build/catalog";
import { validateBody } from "./build/volume";
import { cityMapIssues, type CityMapFile } from "./citymap/format";
import { carveGates, GATE_TOP_SCENE, sceneGates } from "./walk/landmarkGates"; // LANDMARK-WALK
import { NEW_CITY_IDS } from "./cities/index";
import { FULL_ANNEX_IDS } from "../full/worldFormat";

export const WORLD_FORMAT = "voxcrew-world";
export const WORLD_VERSION = 1;
/** SP-W1 — biçim v1.1 (geriye uyumlu ek): `env.weather` (liste), `env.time`, `zones` (sacred/quiet/landmark), `layers.backdrop`
 *  (ufuk silüeti, mutlak dünya koordinatlı `Part`), `layers.movers`. Bu alanlardan biri doluysa `version` 1.1 olmalı; yoksa
 *  dosya v1 olarak kalır (13 çekirdek dünya değişmez). Bütçeler kurallarla aynı: backdrop ≤ 1200 blok (SCENE-BACKDROP-001),
 *  mover ≤ 12 nesne / ≤ 400 kutu (SCENE-MOVER-001). Backend `worlds/validate.py` aynı sınırları uygular. */
export const WORLD_VERSION_11 = 1.1;
/** E3 — biçim v1.2: `expanse` (tohum, biyom, keşif yarıçapı, parsel gövdeleri, blok paleti).
 * v1.1'in üst kümesi; `expanse` doluysa sürüm 1.2 olmalı. Parsel gövdesi parsel PUT'uyla aynı kurallarla (`build/volume.ts
 * validateBody`) doğrulanır. Backend `worlds/validate.py` + `expanse/build.py expanse_issues` aynı.*/
export const WORLD_VERSION_12 = 1.2;
/** biçim v1.3: `city_map` (şehir haritası: varış meydanı, semtler — tohum, sınır, tema,
 * landmark yerleşimleri, giriş/seyir noktaları — duraklar ve ulaşım hatları). v1.2'nin üst kümesi; `city_map` doluysa sürüm 1.3
 * olmalı. Kurallar `citymap/format.ts cityMapIssues`; backend `worlds/validate.py city_map_issues` aynı. v1/v1.1/v1.2 değişmez.*/
export const WORLD_VERSION_13 = 1.3;
export const MAX_BACKDROP = 1200;
export const MAX_ZONES = 16;
/** W2-INT — biçim v1.1 ek alanı `layers.glows`: şehir kitinin gece parıltı işaretleri (yanan pencere `window`, sokak lambası
 *  havuzu `lamp`) prefab'tan türemediği için ayrı yazılır; yoksa kullanıcı kopyalarında gece ışıltısı kaybolurdu. Biçim:
 *  [tür, x, y, z, r, w, h, renk] (mutlak dünya koordinatı). ≤ 512 işaret; backend `worlds/validate.py` aynı sınır. */
export const MAX_GLOWS = 512;
export const GLOW_KINDS = ["window", "lamp"] as const;
export type GlowMark = [(typeof GLOW_KINDS)[number], number, number, number, number, number, number, string];
export const WEATHER: readonly WeatherKind[] = ["rain", "snow", "mist", "bubbles", "embers", "aurora", "petals"];
export const SCENE_TIMES: readonly SceneTime[] = ["auto", "day", "night"];
export const MAX_BLOCKS = 6000;
/** CITY-BIG — çekirdekli (`grid.core`) büyük şehir tabanı (24×16'dan büyük, bölge katı: genişlik 12'nin katı ≤ 48, derinlik 16
 *  ya da 32): blok ve ufuk tavanı kurallarla aynı (CORE-BUDGET-001 `bigBase`, SCENE-BACKDROP-001 `bigMax`). Backend aynı. */
export const MAX_BLOCKS_BIG = 12000;
export const MAX_BACKDROP_BIG = 1600;
export const MAX_GRID_W_BIG = 48;
/** Izgara boyutu büyük şehir tabanı mı (çekirdekli; 24×16'dan büyük bölge katı)? */
export const isBigGrid = (g: { w: number; d: number; core?: unknown }) => g.core !== undefined && g.w * g.d > BASE_W * BASE_D;
export const MAX_PREFABS = 4000;
export const MAX_LIGHTS = 8;
export const TOOL_KINDS: readonly ToolKind[] = ["web", "read", "plan", "shell", "write"];
export const ANNEX_IDS: readonly WorldSceneId[] = [...FULL_ANNEX_IDS, ...NEW_CITY_IDS];
/** Lisans etiketi (ARCH §4.4); "MIT" yalnızca depodaki yerleşik dünyalar için (depo lisansı). */
export const LICENSES = ["CC-BY-4.0", "CC-BY-NC-4.0", "CC0-1.0", "VoxCrew-Pack-1.0", "All-Rights-Reserved", "MIT", "LicenseRef-PolyForm-Shield-1.0.0"] as const;

export interface WorldEnv {
  swatch: [string, string];
  sky: string;
  fog: [number, number];
  hemi: [string, string, number];
  sun: { color: string; intensity: number; pos: [number, number, number] };
  night: boolean;
  ocean: { color: string; y: number } | null;
  /** SP-W0: sahne hava katmanları (SceneDef.weather). Dünya biçimi v1 ve backend `worlds/validate.py` henüz yalnız `null`
   *  kabul eder; yerleşik dünyalar `null` yazar (Dalga 1: SP-INT biçim v1.1 ile `weather`/`time`/`zones`/`backdrop`/`movers`). */
  weather: WeatherKind[] | null;
  /** W3a-INT (v1.1): `weather` içinden yalnız gece görünen türler (tekrarsız alt küme, ≤ 3) */
  weather_night?: WeatherKind[];
  /** v1.1: sahne saati (yoksa "auto") */
  time?: SceneTime;
}

export interface WorldMeta {
  name: string;
  description: string;
  author: { name: string; id: string | null };
  license: (typeof LICENSES)[number];
  created: string;
  updated: string;
  tags: string[];
  ip_risk: number;
  basedOn: { id: string; sha256: string } | null;
  sha256?: string;
}

export interface WorldFile {
  format: typeof WORLD_FORMAT;
  version: typeof WORLD_VERSION | typeof WORLD_VERSION_11 | typeof WORLD_VERSION_12 | typeof WORLD_VERSION_13;
  id: string;
  meta: WorldMeta;
  /** RING-INT (v1.1): `core` — simge çekirdeği [i0, j0, w, d] (taban karosu; `SceneDef.core`): kopya dünya da halka halinde büyür */
  grid: { w: number; d: number; annex: WorldSceneId | "none"; core?: [number, number, number, number] };
  env: WorldEnv;
  layers: {
    /** d satır × w sütun zemin rengi; null karo boş (su/boşluk). Tüm katman null olabilir (yat). */
    ground: (string | null)[][] | null;
    under: string | null;
    groundJit: number;
    prefabs: Prefab[];
    lights: Light[];
    /** v1.1: ufuk silüeti — mutlak dünya koordinatlı kutular [x, y, z, w, h, d, renk, grup?, titreşim?] */
    backdrop?: Part[];
    /** v1.1: hareketli set parçaları */
    movers?: Mover[];
    /** v1.1 (W2-INT): prefab dışı gece parıltı işaretleri (pencere, lamba) */
    glows?: GlowMark[];
  };
  nav: {
    stations: Station[]; rest: Tile[]; spots: Partial<Record<ToolKind, Station[]>>;
    /** S41: uyku noktaları (isteğe bağlı; eski dosyalarda yok) */
    sleep?: Station[];
    /** S41: canlı ortam kancaları (isteğe bağlı) */
    ambient?: AmbientHook[];
    /** v1.1: pişirmeden sonra yürünebilir açılan karolar (ör. su üstündeki köprü: `archBridge` engeli kaldırır) */
    open?: Tile[];
  };
  /** v1: boş · v1.1: sahne bölgeleri (sacred/quiet/landmark) */
  zones: SceneZone[];
  elements: string[];
  baked: null;
  /** v1.2 (E3): çevre ve parseller — yalnız kullanıcı dosyasında / dışa aktarımda; yerleşik dünyalar yazmaz */
  expanse?: ExpanseFile;
  /** v1.3: şehir haritası — ofis tabanından ayrı, yalnız yürüme modunda yüklenen semtli yürüme dünyası*/
  city_map?: CityMapFile;
}

/** v1.2 `expanse` bloğu (plan §9.1). Parsel konumu saklanmaz: yalnız yuva sırası (dünya büyüyünce halkada kayar). */
export interface ExpanseFile {
  seed: number;
  biome?: WorldSceneId | null;
  radius?: number;
  plots: ({ slot: number; name?: string; color?: string } & Partial<PlotBody>)[];
  /** dosyadaki blok paletini sabitler (kimlik → grup, renk); nadir blok `elem:block.*` alıcıda hak yoksa yer tutucu renkle açılır */
  blocks?: Record<string, { group: "solid" | "glass" | "glow"; color: string }>;
}

// ------------------------------------------------------------------------------------------ bake
/** Dünyayı voxel katmanına pişirir: zemin (i dış, j iç döngü — Builder.ground ile aynı sıra), prefab'lar, navigasyon. */
export function bakeWorld(w: WorldFile): Built {
  const { w: gw, d: gd } = w.grid;
  // CITY-BIG: Builder ızgara boyutu dosyadaki gibi (çiçek serpme vb. bu boyutta örnekler → sahne kurulumuyla birebir)
  const b = new Builder(0, gw, gd);
  const g = w.layers.ground;
  if (g || w.layers.under) {
    for (let i = 0; i < gw; i++) for (let j = 0; j < gd; j++) {
      const c = g?.[j]?.[i];
      if (c) b.cube(i, j, -1, c, 1, "solid", w.layers.groundJit);
      if (w.layers.under) b.cube(i, j, -2, w.layers.under, 1, "solid", 0.08);
    }
  }
  for (const p of w.layers.prefabs) bakePrefab(b, p);
  // S41: duruş/cihaz/yükseklik alanları korunur (eski dosyalarda yok → varsayılanlar)
  for (const s of w.nav.stations) b.stations.push(copyStation(s));
  for (const k of TOOL_KINDS) for (const s of w.nav.spots[k] ?? []) b.spot(k, s.tile[0], s.tile[1], s.face);
  if (w.nav.sleep?.length) b.spots.sleep = w.nav.sleep.map(copyStation);
  if (w.nav.ambient) b.ambient = w.nav.ambient.map((h) => ({ ...h, tile: [h.tile[0], h.tile[1]] as Tile }));
  b.rest.push(...w.nav.rest.map((t) => [t[0], t[1]] as Tile));
  for (const t of w.nav.open ?? []) b.blocked.delete(key(t[0], t[1]));
  b.lights.push(...w.layers.lights.map((l) => ({ ...l, pos: [...l.pos] as [number, number, number] })));
  // v1.1: bölgeler, ufuk silüeti, hareketli set parçaları (Builder.done yalnız doluysa yazar)
  if (Array.isArray(w.zones)) b.zones = w.zones.map((z) => ({ ...z }));
  if (w.layers.backdrop) b.backdrop = w.layers.backdrop.map((pt) => ({ p: [pt[0], pt[1], pt[2]], s: [pt[3], pt[4], pt[5]], c: pt[6], g: pt[7] ?? "solid", j: pt[8] ?? 0 }));
  if (w.layers.movers) b.movers = w.layers.movers.map((m) => ({ ...m, path: m.path.map((q) => [q[0], q[1], q[2]] as [number, number, number]) }));
  for (const g of w.layers.glows ?? []) b.props.push({ k: g[0], p: [g[1], g[2], g[3]], r: g[4], s: [g[5], g[6]], c: g[7] });
  const built = b.done();
  // LANDMARK-WALK: taban sahne avlu/simge kapıları kayıttan sonra oyulur (scenes.ts sahne kurulumuyla aynı; kayıt ham blokları tutar)
  for (const z of built.zones ?? []) {
    const gt = z.kind === "landmark" && z.tag ? sceneGates(w.id, z.tag) : null;
    if (gt) built.blocks = carveGates(built.blocks, tx(z.i0) - 0.5, tz(z.j0) - 0.5, gt, GATE_TOP_SCENE);
  }
  if (CITY_SCENE_IDS.has(w.id)) blockCounters(built); // CITYFIX1: sahne kurulumuyla aynı (tezgâh katılığı; scenes.ts `scene()`)
  return { ...built, width: gw, depth: gd, modules: [{ i0: 0, j0: 0, w: gw, d: gd, base: true, slots: [0, built.stations.length] }] };
}

const POSES = new Set(["sit_chair", "sit_bench", "sit_ground", "lounge", "stand", "lie"]);
const DEVICES = new Set(["laptop", "desktop", "tablet", "console", "none"]);
const BEDS = new Set(["bed", "bunk", "hammock", "lounger", "cot", "tent", "mat", "sofa", "hotel"]); // HOTEL-SYS: otel kapısı geçidi
/** Gezinme kaydının kopyası: yalnızca bilinen alanlar (bilinmeyen duruş/cihaz atılır → varsayılan). */
function copyStation(s: Station): Station {
  const out: Station = { tile: [s.tile[0], s.tile[1]], face: s.face };
  if (s.pose && POSES.has(s.pose)) out.pose = s.pose;
  if (s.device && DEVICES.has(s.device)) out.device = s.device;
  if (typeof s.y === "number" && Number.isFinite(s.y)) out.y = Math.max(0, Math.min(3, s.y));
  if (s.bed && BEDS.has(s.bed)) out.bed = s.bed;
  return out;
}

/** Kullanıcı dünyasından sahne tanımı (World.tsx / buildWorld bunu yerleşik sahne gibi çizer). */
export function worldSceneDef(w: WorldFile): SceneDef {
  let cache: Built | null = null;
  return {
    id: w.id as WorldSceneId,
    label: w.meta.name,
    hint: w.meta.description,
    swatch: w.env.swatch,
    sky: w.env.sky,
    fog: w.env.fog,
    hemi: w.env.hemi,
    sun: w.env.sun,
    night: w.env.night || undefined,
    ocean: w.env.ocean ?? undefined,
    annex: w.grid.annex === "none" ? null : w.grid.annex,
    ...(Array.isArray(w.env.weather) && w.env.weather.length ? { weather: w.env.weather } : {}),
    ...(Array.isArray(w.env.weather_night) && w.env.weather_night.length ? { weatherNightOnly: w.env.weather_night } : {}),
    ...(w.env.time && w.env.time !== "auto" ? { time: w.env.time } : {}),
    ...(Array.isArray(w.grid.core) && w.grid.core.length === 4 ? { core: { i0: w.grid.core[0], j0: w.grid.core[1], w: w.grid.core[2], d: w.grid.core[3] } } : {}),
    build: () => (cache ??= bakeWorld(w)),
  };
}

/** Yerleşik sahnenin ortamı (SceneDef → env). */
export function envOf(def: SceneDef): WorldEnv {
  return {
    swatch: [...def.swatch], sky: def.sky, fog: [...def.fog], hemi: [...def.hemi],
    sun: { color: def.sun.color, intensity: def.sun.intensity, pos: [...def.sun.pos] },
    night: !!def.night, ocean: def.ocean ? { ...def.ocean } : null, weather: def.weather?.length ? [...def.weather] : null,
    ...(def.weather?.length && def.weatherNightOnly?.length ? { weather_night: def.weatherNightOnly.filter((k) => def.weather!.includes(k)) } : {}),
    ...(def.time && def.time !== "auto" ? { time: def.time } : {}),
  };
}

// ------------------------------------------------------------------------------------------ kanonik JSON
/** Anahtarları sıralı, boşluksuz JSON (sha256 için; `meta.sha256` ve `baked` hariç). Backend `canonical_json` ile aynı. */
export function canonicalJson(world: unknown): string {
  const w = JSON.parse(JSON.stringify(world)) as Record<string, unknown>;
  delete w.baked;
  if (w.meta && typeof w.meta === "object") delete (w.meta as Record<string, unknown>).sha256;
  const ser = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(ser).join(",")}]`;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${ser(o[k])}`).join(",")}}`;
    }
    return JSON.stringify(v);
  };
  return ser(w);
}

// ------------------------------------------------------------------------------------------ doğrulama
export type IssueCode =
  | "format" | "version" | "id" | "grid" | "meta" | "unsafe_text" | "color" | "number" | "ground_shape"
  | "prefab_type" | "prefab_field" | "out_of_bounds" | "too_many_prefabs" | "too_many_blocks" | "too_many_lights"
  | "no_station" | "station_outside" | "station_blocked" | "station_unreachable"
  | "no_rest" | "rest_outside" | "rest_blocked" | "rest_unreachable"
  | "spot_outside" | "spot_unreachable" | "missing_spot" | "expanse" | "city_map";

export interface Issue {
  level: "error" | "warning";
  code: IssueCode;
  /** sorunlu karo (editör vurgular) */
  tile?: Tile;
  /** sorunlu prefab'ın `layers.prefabs` dizinindeki sırası */
  prefab?: number;
  /** ileti parametreleri: alan adı, sayı, araç türü… */
  params?: Record<string, string | number>;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
const ID_RE = /^(w_[a-z0-9]{6,32}|[a-z][a-z0-9_-]{1,31})$/;
/** Metin alanlarında betik/URL yok (zararlı JS/URL kabul edilmez).*/
const UNSAFE = /<|>|\b(?:javascript|data|vbscript):|:\/\//i;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);

/** Prefab alan şeması: alan → denetim. "?" ile biten alan isteğe bağlı. */
type Check = "int" | "num" | "color" | "group" | "bool" | "axis" | "glow" | "dir" | "parts" | "cells" | "colors" | "win" | "mask" | "str";
const FIELDS: Record<string, Record<string, Check>> = {
  cube: { i: "int", j: "int", y: "num", "h?": "num", c: "color", "g?": "group", "jit?": "num", "solid?": "bool" },
  decor: { i: "int", j: "int", parts: "parts", "cells?": "cells", "free?": "bool" },
  block: { i: "int", j: "int" },
  desk: { i: "int", j: "int", w: "int", top: "color", legs: "color", "bare?": "bool" },
  plant: { i: "int", j: "int" }, pine: { i: "int", j: "int" }, palm: { i: "int", j: "int" },
  snowyPine: { i: "int", j: "int" }, snowman: { i: "int", j: "int" }, campfire: { i: "int", j: "int" },
  tree: { i: "int", j: "int", h: "int" },
  lantern: { i: "int", j: "int", glow: "color", post: "color" },
  terminal: { i: "int", j: "int", glow: "glow" },
  flag: { i: "int", j: "int", c: "color", h: "num", "emblem?": "color" },
  wall: { i: "int", j: "int", len: "int", h: "int", axis: "axis", "c?": "color", "colors?": "colors", "win?": "win" },
  sandbags: { i: "int", j: "int", len: "int", axis: "axis", layers: "int" },
  sea: { i: "int", j: "int", c: "color", top: "num", blocking: "bool" },
  crate: { i: "int", j: "int", c: "color", s: "num" },
  table: { i: "int", j: "int", top: "color" },
  bookshelf: { i: "int", j: "int", c: "color" },
  sofa: { i: "int", j: "int", c: "color", back: "color" },
  lamp: { i: "int", j: "int", glow: "color", "desk?": "bool", "dx?": "num", "dz?": "num" },
  rock: { i: "int", j: "int", c: "color" },
  cloud: { x: "num", y: "num", z: "num", seed: "int" },
  flowers: { n: "int", seed: "int", mask: "mask" },
  snowfall: { n: "int", seed: "int" },
  // S33 canlı dekor
  monitor: { i: "int", j: "int", face: "dir", "dx?": "num", "dz?": "num", "y?": "num" },
  chair: { i: "int", j: "int", face: "dir", "c?": "color" },
  server_rack: { i: "int", j: "int", face: "dir" },
  coffee_machine: { i: "int", j: "int", "face?": "dir", "counter?": "bool" },
  scoreboard: { i: "int", j: "int", w: "int" },
};
/** Sayısal üst sınırlar (kötü niyetli/bozuk dosyada bellek ve çizim bütçesi). */
const RANGE: Record<string, [number, number]> = {
  w: [1, 4], h: [0.01, 8], len: [1, 32], layers: [1, 4], n: [0, 400], y: [-4, 12], s: [0.1, 1.5], top: [-3, 1], jit: [0, 0.5],
  dx: [-0.5, 0.5], dz: [-0.5, 0.5],
};

function checkValue(kind: Check, v: unknown, grid: { w: number; d: number }): boolean {
  switch (kind) {
    case "int": return isInt(v);
    case "num": return isNum(v);
    case "color": return typeof v === "string" && HEX.test(v);
    // `spin` yalnız decor parçasında (dönüş tanımıyla); cube tanım taşımaz
    case "group": return typeof v === "string" && (STATIC_GROUPS as readonly string[]).includes(v);
    case "bool": return typeof v === "boolean";
    case "axis": return v === "x" || v === "z";
    case "glow": return v === "+z" || v === "+x" || v === "-x";
    case "dir": return v === "+z" || v === "-z" || v === "+x" || v === "-x";
    case "str": return typeof v === "string";
    case "mask": return typeof v === "string" && v.length === grid.w * grid.d && /^[01]*$/.test(v);
    case "cells": return Array.isArray(v) && v.length <= 256 && v.every((c) => Array.isArray(c) && c.length === 2 && isInt(c[0]) && isInt(c[1]));
    case "win": return Array.isArray(v) && v.length <= 32 && v.every((c) => Array.isArray(c) && c.length === 2 && isInt(c[0]) && isInt(c[1]));
    case "colors": return Array.isArray(v) && v.length <= 32 && v.every((col) => Array.isArray(col) && col.length <= 8 && col.every((c) => typeof c === "string" && HEX.test(c)));
    case "parts": return Array.isArray(v) && v.length >= 1 && v.length <= 400 && v.every((pt) => Array.isArray(pt) && pt.length >= 7 && pt.length <= 10
      && pt.slice(0, 6).every(isNum) && pt.slice(3, 6).every((s) => (s as number) > 0 && (s as number) <= Math.max(grid.w, grid.d) + 16)
      && Math.abs(pt[0] as number) <= 64 && Math.abs(pt[2] as number) <= 64 && Math.abs(pt[1] as number) <= 40
      && typeof pt[6] === "string" && HEX.test(pt[6]) && (pt[7] == null || (GROUPS as readonly string[]).includes(pt[7] as string))
      && (pt[8] == null || (isNum(pt[8]) && pt[8] >= 0 && pt[8] <= 0.5))
      // `spin` parçası 10. alanda dönüş tanımı taşır (zorunlu); başka grup taşıyamaz
      && (pt[7] === "spin" ? pt.length === 10 && isSpinPart(pt[9], pt as number[]) : pt.length <= 9));
  }
}

function walkStrings(v: unknown, out: string[], depth = 0): void {
  if (depth > 12) return;
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => walkStrings(x, out, depth + 1));
  else if (isObj(v)) Object.entries(v).forEach(([k, x]) => { out.push(k); walkStrings(x, out, depth + 1); });
}

/**
 * Dünyayı doğrular. Hatalar kaydetmeyi engeller; uyarılar engellemez. Yapı bozuksa navigasyon denetimine geçilmez.
 * `bake` verilirse (editör zaten pişirdiyse) yeniden pişirilmez.
 */
export function validateWorld(raw: unknown, baked?: Built): Issue[] {
  const out: Issue[] = [];
  const err = (code: IssueCode, extra: Omit<Issue, "level" | "code"> = {}) => out.push({ level: "error", code, ...extra });
  const warn = (code: IssueCode, extra: Omit<Issue, "level" | "code"> = {}) => out.push({ level: "warning", code, ...extra });
  if (!isObj(raw)) { err("format"); return out; }
  if (raw.format !== WORLD_FORMAT) err("format");
  if (raw.version !== WORLD_VERSION && raw.version !== WORLD_VERSION_11 && raw.version !== WORLD_VERSION_12 && raw.version !== WORLD_VERSION_13) err("version");
  // v1.2 (E3): `expanse` doluysa sürüm 1.2 (v1.3 üst kümesi de taşıyabilir); kapalı şema + parsel gövdesi kuralları
  if (raw.expanse !== undefined) {
    if (raw.version !== WORLD_VERSION_12 && raw.version !== WORLD_VERSION_13) err("version");
    const bad = expanseIssues(raw.expanse);
    if (bad.length) err("expanse", { params: { field: bad.slice(0, 6).join(", ") } });
  }
  // v1.3: `city_map` doluysa sürüm 1.3; kapalı şema (semt sınırı parsel ızgarasına hizalı, kesişmez; kimlikler tekil)
  if (raw.city_map !== undefined) {
    if (raw.version !== WORLD_VERSION_13) err("version");
    const bad = cityMapIssues(raw.city_map);
    if (bad.length) err("city_map", { params: { field: bad.slice(0, 6).join(", ") } });
  }
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) err("id");
  const strings: string[] = [];
  walkStrings(raw, strings);
  if (strings.some((s) => UNSAFE.test(s))) err("unsafe_text");
  const meta = raw.meta;
  if (!isObj(meta) || typeof meta.name !== "string" || !meta.name.trim() || meta.name.length > 80
    || typeof meta.description !== "string" || meta.description.length > 500
    || !(LICENSES as readonly string[]).includes(meta.license as string)) err("meta");
  const grid = raw.grid;
  // CITY-BIG: genişlik 24; çekirdekli (`grid.core`) büyük şehir tabanında 12'nin katı (24–48) ve derinlik 16'nın katı
  const bigOk = isObj(grid) && grid.core !== undefined && isInt(grid.w) && (grid.w as number) % 12 === 0 && (grid.w as number) >= BASE_W
    && (grid.w as number) <= MAX_GRID_W_BIG && isInt(grid.d) && (grid.d as number) % BASE_D === 0;
  if (!isObj(grid) || !(grid.w === BASE_W || bigOk) || !isInt(grid.d) || grid.d < BASE_D || grid.d > 32
    || !(grid.annex === "none" || (ANNEX_IDS as readonly unknown[]).includes(grid.annex))) {
    err("grid");
    return out;
  }
  const gw = grid.w as number, gd = grid.d as number;
  const big = isBigGrid({ w: gw, d: gd, core: grid.core });
  const maxBlocks = big ? MAX_BLOCKS_BIG : MAX_BLOCKS, maxBackdrop = big ? MAX_BACKDROP_BIG : MAX_BACKDROP;
  const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < gw && j < gd;
  const env = raw.env;
  const envOk = isObj(env) && Array.isArray(env.swatch) && env.swatch.length === 2 && env.swatch.every((c) => typeof c === "string" && HEX.test(c))
    && typeof env.sky === "string" && HEX.test(env.sky) && Array.isArray(env.fog) && env.fog.length === 2 && env.fog.every(isNum)
    && Array.isArray(env.hemi) && env.hemi.length === 3 && HEX.test(String(env.hemi[0])) && HEX.test(String(env.hemi[1])) && isNum(env.hemi[2])
    && isObj(env.sun) && HEX.test(String(env.sun.color)) && isNum(env.sun.intensity) && Array.isArray(env.sun.pos) && env.sun.pos.length === 3 && env.sun.pos.every(isNum)
    && (env.ocean == null || (isObj(env.ocean) && HEX.test(String(env.ocean.color)) && isNum(env.ocean.y)));
  if (!envOk) err("color", { params: { field: "env" } });
  // v1.1 alanları (hava, saat, bölgeler, ufuk, hareketli): biri doluysa sürüm 1.1 olmalı
  if (uses11(raw) && raw.version === WORLD_VERSION) err("version");
  if (isObj(env) && !(env.weather == null || (Array.isArray(env.weather) && env.weather.length <= 3
    && new Set(env.weather).size === env.weather.length && env.weather.every((k) => (WEATHER as readonly unknown[]).includes(k))))) err("number", { params: { field: "env.weather" } });
  if (isObj(env) && env.weather_night !== undefined && !(Array.isArray(env.weather_night) && env.weather_night.length > 0 && env.weather_night.length <= 3
    && new Set(env.weather_night).size === env.weather_night.length
    && env.weather_night.every((k) => Array.isArray(env.weather) && (env.weather as unknown[]).includes(k)))) err("number", { params: { field: "env.weather_night" } });
  if (isObj(env) && env.time !== undefined && !(SCENE_TIMES as readonly unknown[]).includes(env.time)) err("number", { params: { field: "env.time" } });
  // RING-INT: simge çekirdeği — 4 tam sayı, en az 1×1, ızgaranın içinde
  const core = grid.core;
  if (core !== undefined && !(Array.isArray(core) && core.length === 4 && core.every(isInt) && core[0] >= 0 && core[1] >= 0 && core[2] >= 1 && core[3] >= 1
    && core[0] + core[2] <= gw && core[1] + core[3] <= gd)) err("number", { params: { field: "grid.core" } });
  if (Array.isArray(raw.zones) && !(raw.zones.length <= MAX_ZONES && raw.zones.every(isZone))) err("number", { params: { field: "zones" } });
  const layers = raw.layers;
  if (!isObj(layers) || !Array.isArray(layers.prefabs) || !Array.isArray(layers.lights)) { err("format"); return out; }
  const ground = layers.ground;
  if (ground !== null && !(Array.isArray(ground) && ground.length === gd
    && ground.every((row) => Array.isArray(row) && row.length === gw && row.every((c) => c === null || (typeof c === "string" && HEX.test(c)))))) {
    err("ground_shape");
  }
  if (!(layers.under === null || (typeof layers.under === "string" && HEX.test(layers.under)))) err("color", { params: { field: "under" } });
  if (!isNum(layers.groundJit) || layers.groundJit < 0 || layers.groundJit > 0.5) err("number", { params: { field: "groundJit" } });
  const prefabs = layers.prefabs as unknown[];
  if (prefabs.length > MAX_PREFABS) { err("too_many_prefabs", { params: { n: prefabs.length, max: MAX_PREFABS } }); return out; }
  prefabs.forEach((p, idx) => {
    if (!isObj(p) || typeof p.t !== "string" || !(PREFAB_TYPES as readonly string[]).includes(p.t)) { err("prefab_type", { prefab: idx }); return; }
    const spec = FIELDS[p.t];
    for (const [rawName, kind] of Object.entries(spec)) {
      const opt = rawName.endsWith("?");
      const name = opt ? rawName.slice(0, -1) : rawName;
      const v = p[name];
      if (v === undefined && opt) continue;
      const range = RANGE[name];
      if (!checkValue(kind, v, { w: gw, d: gd }) || (range && isNum(v) && (v < range[0] || v > range[1]))) {
        err("prefab_field", { prefab: idx, params: { field: name, type: p.t }, tile: isInt(p.i) && isInt(p.j) ? [p.i, p.j] : undefined });
        return;
      }
    }
    const pf = p as unknown as Prefab;
    if (ATMOSPHERE.has(pf.t) || (pf.t === "decor" && pf.free)) return;
    const at = pf as { i: number; j: number };
    const cells = footprint(pf);
    const outside = [[at.i, at.j] as Tile, ...cells].find(([i, j]) => !inGrid(i, j));
    if (outside) err("out_of_bounds", { prefab: idx, tile: outside });
  });
  if (layers.backdrop !== undefined && !(Array.isArray(layers.backdrop) && layers.backdrop.length <= maxBackdrop && layers.backdrop.every(isBackdropPart)))
    err("number", { params: { field: "layers.backdrop" } });
  if (layers.movers !== undefined && !validMovers(layers.movers)) err("number", { params: { field: "layers.movers" } });
  if (layers.glows !== undefined && !(Array.isArray(layers.glows) && layers.glows.length <= MAX_GLOWS && layers.glows.every(isGlow)))
    err("number", { params: { field: "layers.glows" } });
  const lights = layers.lights as unknown[];
  if (lights.length > MAX_LIGHTS) err("too_many_lights", { params: { n: lights.length, max: MAX_LIGHTS } });
  if (!lights.every((l) => isObj(l) && Array.isArray(l.pos) && l.pos.length === 3 && l.pos.every(isNum) && typeof l.color === "string" && HEX.test(l.color)
    && isNum(l.intensity) && l.intensity >= 0 && l.intensity <= 30 && isNum(l.distance) && l.distance > 0 && l.distance <= 40
    && (l.flicker === undefined || typeof l.flicker === "boolean"))) err("number", { params: { field: "lights" } });
  const nav = raw.nav;
  const isStation = (s: unknown): s is Station => isObj(s) && Array.isArray(s.tile) && s.tile.length === 2 && isInt(s.tile[0]) && isInt(s.tile[1]) && isNum(s.face);
  const isTile = (t: unknown): t is Tile => Array.isArray(t) && t.length === 2 && isInt(t[0]) && isInt(t[1]);
  if (!isObj(nav) || !Array.isArray(nav.stations) || !nav.stations.every(isStation) || !Array.isArray(nav.rest) || !nav.rest.every(isTile)
    || !isObj(nav.spots) || !Object.entries(nav.spots).every(([k, list]) => (TOOL_KINDS as readonly string[]).includes(k) && Array.isArray(list) && list.every(isStation))
    || (nav.sleep !== undefined && !(Array.isArray(nav.sleep) && nav.sleep.length <= 512 && nav.sleep.every(isStation)))
    || (nav.open !== undefined && !(Array.isArray(nav.open) && nav.open.length <= 256 && nav.open.every((t) => isTile(t) && inGrid(t[0], t[1]))))
    || (nav.ambient !== undefined && !(Array.isArray(nav.ambient) && nav.ambient.length <= 512
      && nav.ambient.every((h) => isObj(h) && typeof h.kind === "string" && isTile(h.tile))))) {
    err("format");
    return out;
  }
  if (!Array.isArray(raw.zones) || !Array.isArray(raw.elements)) err("format");
  if (out.some((i) => i.level === "error")) return out;

  // ---- navigasyon (yapı geçerli; pişir)
  const w = raw as unknown as WorldFile;
  const built = baked ?? bakeWorld(w);
  if (built.blocks.length > maxBlocks) err("too_many_blocks", { params: { n: built.blocks.length, max: maxBlocks } });
  // dönen bloklar kare başına CPU'da konumlanır → dünya başına üst sınır
  const spins = built.blocks.reduce((n, b) => n + (b.g === "spin" ? 1 : 0), 0);
  if (spins > MAX_SPIN_BLOCKS) err("number", { params: { field: "spin", n: spins, max: MAX_SPIN_BLOCKS } });
  const stations = w.nav.stations, rest = w.nav.rest;
  if (!stations.length) err("no_station");
  if (!rest.length) err("no_rest");
  const blocked = built.blocked;
  for (const s of stations) {
    if (!inGrid(...s.tile)) err("station_outside", { tile: s.tile });
    else if (blocked.has(key(...s.tile))) err("station_blocked", { tile: s.tile });
  }
  for (const t of rest) {
    if (!inGrid(...t)) err("rest_outside", { tile: t });
    else if (blocked.has(key(...t))) err("rest_blocked", { tile: t });
  }
  for (const k of TOOL_KINDS) {
    const list = w.nav.spots[k] ?? [];
    if (!list.length) warn("missing_spot", { params: { kind: k } });
    for (const s of list) if (!inGrid(...s.tile)) err("spot_outside", { tile: s.tile, params: { kind: k } });
  }
  if (out.some((i) => i.level === "error")) return out;
  // tek bağlı bileşen: ilk istasyondan BFS (findPath ile aynı 4-komşu kuralı; hedef karo engelli olabilir)
  const reach = reachable(stations[0].tile, built);
  for (const s of stations) if (!reach.has(key(...s.tile))) err("station_unreachable", { tile: s.tile });
  for (const t of rest) if (!reach.has(key(...t))) err("rest_unreachable", { tile: t });
  for (const k of TOOL_KINDS) for (const s of w.nav.spots[k] ?? []) {
    const [i, j] = s.tile;
    const ok = reach.has(key(i, j)) || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => reach.has(key(i + a, j + c)));
    if (!ok) warn("spot_unreachable", { tile: s.tile, params: { kind: k } });
  }
  return out;
}

const PLOT_COLOR_SET = ["#E5484D", "#F59E0B", "#22C55E", "#06B6D4", "#3B82F6", "#8B5CF6", "#EC4899", "#F5F5F4"];
const EXPANSE_KEYS = ["seed", "biome", "radius", "plots", "blocks"];

/** v1.2 `expanse` bloğunun sorunlu alan yolları (boş → geçerli). Backend `expanse/build.py expanse_issues` ile aynı. */
export function expanseIssues(exp: unknown): string[] {
  if (!isObj(exp)) return ["expanse"];
  const out: string[] = Object.keys(exp).filter((k) => !EXPANSE_KEYS.includes(k)).map((k) => `expanse.${k}`);
  if (!(isInt(exp.seed) && exp.seed >= 0 && exp.seed < 2 ** 32)) out.push("expanse.seed");
  if (exp.biome != null && !(ANNEX_IDS as readonly unknown[]).includes(exp.biome)) out.push("expanse.biome");
  if (exp.radius !== undefined && !(isInt(exp.radius) && exp.radius >= 2 && exp.radius <= 12)) out.push("expanse.radius");
  if (exp.blocks !== undefined) {
    const b = exp.blocks;
    const ok = isObj(b) && Object.keys(b).length <= 64 && Object.entries(b).every(([k, v]) => (BLOCK_BY_ID.has(k) || /^elem:block\.[a-z0-9_]{1,32}$/.test(k))
      && isObj(v) && Object.keys(v).length === 2 && (v.group === "solid" || v.group === "glass" || v.group === "glow")
      && typeof v.color === "string" && HEX.test(v.color));
    if (!ok) out.push("expanse.blocks");
  }
  const plots = exp.plots;
  if (!Array.isArray(plots) || plots.length > 12) { out.push("expanse.plots"); return out; }
  const slots = new Set<number>();
  let total = 0;
  plots.forEach((p, n) => {
    const path = `expanse.plots[${n}]`;
    if (!isObj(p) || Object.keys(p).some((k) => !["slot", "name", "color", "edits", "prefabs"].includes(k))) { out.push(path); return; }
    if (!(isInt(p.slot) && p.slot >= 0 && p.slot < 12) || slots.has(p.slot as number)) out.push(`${path}.slot`);
    else slots.add(p.slot as number);
    if (p.color !== undefined && !(typeof p.color === "string" && PLOT_COLOR_SET.includes(p.color.toUpperCase()))) out.push(`${path}.color`);
    if (p.name !== undefined && !(typeof p.name === "string" && p.name.length <= 40 && !/[<>]/.test(p.name))) out.push(`${path}.name`);
    const body = plotBodyShape(p.edits ?? [], p.prefabs ?? []);
    if (!body || validateBody(body).length) { out.push(`${path}.body`); return; }
    total += body.edits.length;
  });
  if (total > MAX_EDITS_TOTAL) out.push("expanse.plots");
  return out;
}

/** Parsel gövdesinin biçimi (tür, sınır, prefab alanları; parsel ızgarası) — kurallar `validateBody`'de. */
function plotBodyShape(edits: unknown, prefabs: unknown): PlotBody | null {
  if (!Array.isArray(edits) || edits.length > MAX_EDITS || !Array.isArray(prefabs) || prefabs.length > MAX_PLOT_PREFABS) return null;
  for (const e of edits) {
    if (!(Array.isArray(e) && e.length === 5 && isInt(e[0]) && e[0] >= 0 && e[0] < PLOT_W && isInt(e[1]) && e[1] >= 0 && e[1] < PLOT_H
      && isInt(e[2]) && e[2] >= 0 && e[2] < PLOT_D && typeof e[3] === "string" && BLOCK_ID_RE.test(e[3]) && isInt(e[4]) && e[4] >= 0 && e[4] < 4)) return null;
  }
  for (const p of prefabs) {
    if (!isObj(p) || typeof p.t !== "string" || !isBuildPrefab(p.t)) return null;
    const spec = FIELDS[p.t];
    if (Object.keys(p).some((k) => k !== "t" && !(k in spec) && !(`${k}?` in spec))) return null;
    for (const [rawName, kind] of Object.entries(spec)) {
      const opt = rawName.endsWith("?"), name = opt ? rawName.slice(0, -1) : rawName, v = p[name];
      if (v === undefined && opt) continue;
      const range = RANGE[name];
      if (!checkValue(kind, v, { w: PLOT_W, d: PLOT_D }) || (range && isNum(v) && (v < range[0] || v > range[1]))) return null;
    }
    if (!isInt(p.i) || !isInt(p.j) || p.i < 0 || p.j < 0 || p.i >= PLOT_W || p.j >= PLOT_D) return null;
  }
  return { edits: edits as PlotBody["edits"], prefabs: prefabs as PlotBody["prefabs"] };
}

/** v1.1 alanlarından biri dolu mu (hava listesi, saat, bölge, ufuk, hareketli)? */
export function uses11(raw: unknown): boolean {
  if (!isObj(raw)) return false;
  const env = isObj(raw.env) ? raw.env : {}, layers = isObj(raw.layers) ? raw.layers : {};
  return (Array.isArray(env.weather) && env.weather.length > 0) || env.time !== undefined || env.weather_night !== undefined
    || (Array.isArray(raw.zones) && raw.zones.length > 0) || layers.backdrop !== undefined || layers.movers !== undefined
    || layers.glows !== undefined
    || (isObj(raw.nav) && raw.nav.open !== undefined)
    || (isObj(raw.grid) && raw.grid.core !== undefined);
}

const ZONE_KEYS = ["kind", "i0", "j0", "w", "d", "buffer", "tag"];
/** Sahne bölgesi: sacred/quiet ızgarada, landmark ızgara dışında olabilir (−64…64 karo, ≤ 32×32). */
function isZone(z: unknown): boolean {
  return isObj(z) && (z.kind === "sacred" || z.kind === "quiet" || z.kind === "landmark" || z.kind === "hotel") && Object.keys(z).every((k) => ZONE_KEYS.includes(k))
    && [z.i0, z.j0, z.w, z.d].every(isInt) && [z.i0, z.j0].every((v) => (v as number) >= -64 && (v as number) <= 64)
    && [z.w, z.d].every((v) => (v as number) >= 1 && (v as number) <= 32)
    && (z.buffer === undefined || (isInt(z.buffer) && z.buffer >= 0 && z.buffer <= 4))
    && (z.tag === undefined || (typeof z.tag === "string" && /^[a-z][a-z0-9_]{0,23}$/.test(z.tag)));
}

/** Ufuk kutusu: [x, y, z, w, h, d, renk, grup?, titreşim?] — mutlak dünya koordinatı, sınırlı. */
function isBackdropPart(pt: unknown): boolean {
  return Array.isArray(pt) && pt.length >= 7 && pt.length <= 9 && pt.slice(0, 6).every(isNum)
    && Math.abs(pt[0] as number) <= 120 && Math.abs(pt[2] as number) <= 120 && (pt[1] as number) >= -4 && (pt[1] as number) <= 60
    && pt.slice(3, 6).every((v) => (v as number) > 0 && (v as number) <= 40)
    && typeof pt[6] === "string" && HEX.test(pt[6]) && (pt[7] == null || (STATIC_GROUPS as readonly string[]).includes(pt[7] as string))
    && (pt[8] == null || (isNum(pt[8]) && pt[8] >= 0 && pt[8] <= 0.5));
}

/** Gece parıltı işareti: [tür, x, y, z, r, w, h, renk] — mutlak dünya koordinatı, sınırlı (W2-INT). */
function isGlow(g: unknown): boolean {
  return Array.isArray(g) && g.length === 8 && (GLOW_KINDS as readonly unknown[]).includes(g[0]) && g.slice(1, 7).every(isNum)
    && Math.abs(g[1] as number) <= 120 && Math.abs(g[3] as number) <= 120 && (g[2] as number) >= -4 && (g[2] as number) <= 60
    && Math.abs(g[4] as number) <= 7 && [g[5], g[6]].every((v) => (v as number) >= 0 && (v as number) <= 8)
    && typeof g[7] === "string" && HEX.test(g[7]);
}

const MOVER_KEYS = ["shape", "path", "period", "phase", "mode", "color", "accent", "scale", "dayOnly"];
/** Hareketli set parçaları: ≤ 12 nesne, ≤ 400 kutu (SCENE-MOVER-001), sonlu yol (≤ 32 nokta), olumlu süre. */
function validMovers(v: unknown): boolean {
  if (!Array.isArray(v) || v.length > MAX_MOVERS) return false;
  let boxes = 0;
  for (const m of v) {
    if (!isObj(m) || typeof m.shape !== "string" || !Object.hasOwn(MOVER_SHAPES, m.shape) || !Object.keys(m).every((k) => MOVER_KEYS.includes(k))) return false;
    boxes += MOVER_SHAPES[m.shape as Mover["shape"]].length;
    if (!Array.isArray(m.path) || m.path.length < 1 || m.path.length > 32
      || !m.path.every((q) => Array.isArray(q) && q.length === 3 && q.every(isNum) && Math.abs(q[0]) <= 120 && Math.abs(q[2]) <= 120 && q[1] >= -10 && q[1] <= 60)) return false;
    if (!isNum(m.period) || m.period <= 0 || m.period > 600) return false;
    if (m.phase !== undefined && !(isNum(m.phase) && m.phase >= 0 && m.phase <= 1)) return false;
    if (m.mode !== undefined && m.mode !== "loop" && m.mode !== "pingpong") return false;
    if ((m.color !== undefined && !(typeof m.color === "string" && HEX.test(m.color))) || (m.accent !== undefined && !(typeof m.accent === "string" && HEX.test(m.accent)))) return false;
    if (m.scale !== undefined && !(isNum(m.scale) && m.scale >= 0.2 && m.scale <= 4)) return false;
    if (m.dayOnly !== undefined && typeof m.dayOnly !== "boolean") return false;
  }
  return boxes <= MAX_MOVER_BOXES;
}

/** Başlangıç karosundan yürünebilir karolar (engelli karo bileşene girmez). */
export function reachable(from: Tile, built: Pick<Built, "width" | "depth" | "blocked">): Set<string> {
  const seen = new Set<string>([key(...from)]);
  const queue: Tile[] = [from];
  while (queue.length) {
    const [i, j] = queue.shift()!;
    for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + a, nj = j + c, k = key(ni, nj);
      if (ni < 0 || nj < 0 || ni >= built.width || nj >= built.depth || seen.has(k) || built.blocked.has(k)) continue;
      seen.add(k);
      queue.push([ni, nj]);
    }
  }
  return seen;
}
