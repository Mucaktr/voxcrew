/**
 * W3 (WALK-UX) — yürüme modunda Yakındakiler'e giren dünya nesneleri:
 * çıktı panosu, kahve makinesi, oturma yerleri (serbest bank/minder/şezlong istasyonları), olta yerleri, masa oyunu ve atış
 * masaları. Her biri kendi işleyicisine (EntityPanel) gider; hiçbiri yakınlıkla kendiliğinden tetiklenmez.
 *
 * Kimlikler: `board:0` · `coffee:<n>` · `bench:<n>` · `fish:<n>` · `table:<n>` · `toss:<n>` (WALK-FUN ile anlaşılan).
 * Liste sahne (built) başına bir kez kurulur; WalkRig'e verilen işlev aynı (ya da yeniden doldurulan) diziyi döndürür (4 Hz).
 * WALK-FUN'un hayvan ve dokunulabilir nesneleri (`animal:<n>`, `hot:<n>`) eklenir; F onlarda `pokeEntity` çağırır (panel yok).
 *
 * şehir haritasında (`fish:c<n>`, voxel/citymap/shell.ts `cityFishing`) ve çevre arazisinde (`fish:x<cx>_<cz>_<k>`,
 * voxel/expanse/generate.ts `parcelFishOf`) olta noktaları — yalnız yakın halkadaki yüklü parsellerin noktaları (akış güvenli:
 * karo çevre ızgarasında yürünür). Mini oyun çözücüsü (`walkFun.resolveMinigame`) dünyanın `sites.fishing` listesini okur: bu
 * noktalar o listenin tabanından sonraki kuyruğuna yazılır (varış meydanında taban boştur: meydanın ızgara dışı "ufuk denizi"
 * şehir çerçevesinde semttir), yüklenmeyen parselinki çıkar.
 *
 * öncelik kancası (`controller.nearbyPolicy` ← `selectLogic.nearbyTier`; 12 sınırı ritüel ve bilgi noktasını
 * korur, F önce ritüel/bilgi/simgeyi seçer) burada kurulur; sahne ve şehir haritasında simge bilgi kartı girdileri
 * (`info:<anahtar>`, info/infoTargets.ts) eklenir.
*/
import { useMemo } from "react";
import { sites, type FishSpot } from "../../../voxel/fun/sites";
import { tx, tz, type Built, type SceneCore, type Tile } from "../../../voxel/scenes";
import { boardSpot, navGrid, nearbyPolicy, spawnTile, type ProxEntity } from "../../../voxel/walk/controller";
import { FREE, outerKind } from "../../../voxel/physics/world";
import { parcelFishOf } from "../../../voxel/expanse/generate";
import { districtWater } from "../../../voxel/citymap/district";
import { ambientEntities } from "./funBridge";
import { layerOffset, souvenirLayer } from "./progress/layer";
import { SOUVENIR_PREFIX } from "./progress/logic";
import { exploreEntities } from "../../../voxel/interiors/entities";
import { interiorRuntime } from "../../../voxel/interiors/runtime";
import { isInteriorBuilt } from "../../../voxel/interiors/store";
import { cityFishing, gateMapOf, isGateBuilt, type CityFishSpot } from "../../../voxel/citymap/shell";
import type { CityMapFile } from "../../../voxel/citymap/format";
import { fixedReach, isFixedTarget, nearbyTier } from "./selectLogic";
import { infoEntities, infoWorld } from "./info/infoTargets";
import { walkFishSpots } from "../../../voxel/fun/walkSpots";
import { cityDoorEntities, cityGateEntities } from "../../../voxel/citymap/doorEntity";
import { cityStopEntities } from "../../../voxel/citymap/stopEntity";
import { cityVpEntities } from "../../../voxel/citymap/vpEntity";
import { cityLmEntities } from "../../../voxel/citylife/lmDoors";
import { workZoneDoorEntities } from "../../../voxel/workzones/doors"; // WORK-ZONES: şehir ofis binası kapıları

// Yakındakiler ve F önceliği (yürüme HUD'u yüklenince bir kez)
nearbyPolicy.rank = nearbyTier;
nearbyPolicy.reach = fixedReach;
nearbyPolicy.fixed = isFixedTarget; // durak/kapı/asansör figüran-satıcı ritüelinin önünde

export type WalkEntityType = "board" | "coffee" | "bench" | "fish" | "table" | "toss";
export interface WalkEntity extends ProxEntity {
  type: WalkEntityType;
  tile: Tile;
  /** oturma: bakış açısı (rad) ve poz */
  face?: number;
  pose?: "sit_bench" | "sit_ground" | "lounge";
  seatY?: number;
}

const SEAT_POSES = new Set(["sit_bench", "sit_ground", "lounge"]);
const NONE: readonly ProxEntity[] = Object.freeze([]) as readonly ProxEntity[];

/** Son kurulan sahnenin nesneleri (tek World bağlı). Panel kimlikten bilgiye buradan ulaşır. */
const registry = new Map<string, WalkEntity>();
/** akışla gelen olta noktaları (şehir haritası, çevre arazisi) — yüklü parseller değiştikçe güncellenir.*/
const streamed = new Map<string, WalkEntity>();
export const walkEntity = (id: string): WalkEntity | null => registry.get(id) ?? streamed.get(id) ?? null;
/** FIX-UX: belirli türdeki nesneler (ör. kahve noktaları: `kafeden_gorev`). */
export function walkEntitiesOf(type: WalkEntityType): WalkEntity[] {
  const out: WalkEntity[] = [];
  for (const e of registry.values()) if (e.type === type) out.push(e);
  for (const e of streamed.values()) if (e.type === type) out.push(e);
  return out;
}

// ------------------------------------------------------------------ akışla gelen olta noktaları
/** Kuyruğa yazılan (dünyanın kendi taramasından gelmeyen) olta noktaları: `buildWalkEntities` bunları taban sanmaz. */
const injected = new WeakSet<FishSpot>();
const baseLen = new WeakMap<object, number>();
/** `sites(built).fishing` = taban + `extra` (değişmediyse dokunmaz). `replace`: taban boş (varış meydanı). */
function syncSiteFishing(built: Built, oceanY: number | null, extra: readonly FishSpot[], replace: boolean) {
  let s;
  try { s = sites(built, oceanY); } catch { return; }
  let n = baseLen.get(s);
  if (n === undefined) { n = replace ? 0 : s.fishing.length; baseLen.set(s, n); }
  const f = s.fishing, base = n;
  if (f.length === base + extra.length && extra.every((e, k) => f[base + k] === e)) return;
  f.length = base;
  for (const e of extra) { injected.add(e); f.push(e); }
}
const fishEntity = (id: string, s: FishSpot): WalkEntity =>
  ({ id, kind: "prop", type: "fish", tile: s.tile, x: tx(s.tile[0]), z: tz(s.tile[1]), face: s.face });

/** Şehir haritası: semtlerin su metası dilim dilim (çağrı başına bir semt) ısınır, sonra bütün harita bir kez kurulur. */
const warm = new WeakMap<CityMapFile, number>();
function cityFishReady(map: CityMapFile): readonly CityFishSpot[] | null {
  const w = warm.get(map) ?? 0;
  if (w < map.districts.length) { districtWater(map, map.districts[w]); warm.set(map, w + 1); return null; }
  return cityFishing(map).spots;
}
const cityEnt = new WeakMap<CityFishSpot, WalkEntity>();
/** Yüklü (çevre ızgarasında yürünür ya da varış meydanında) şehir olta noktaları. */
function cityFishLoaded(built: Built, map: CityMapFile, outSpots: FishSpot[], outEnt: WalkEntity[]) {
  const all = cityFishReady(map);
  if (!all) return;
  const og = navGrid(built).outer;
  for (const s of all) {
    const [i, j] = s.tile;
    const inGrid = i >= 0 && j >= 0 && i < built.width && j < built.depth;
    if (!inGrid && !(og && outerKind(og, i, j) === FREE)) continue;
    let e = cityEnt.get(s);
    if (!e) { e = fishEntity(`fish:c${s.n}`, s); cityEnt.set(s, e); }
    outSpots.push(s); outEnt.push(e);
  }
}
/** Çevre arazisi: çevre ızgarasındaki yüklü parsellerin olta noktaları (dünya çerçevesine çevrilmiş; parsel başına önbellek). */
const parcelSpots = new WeakMap<object, { oi: number; oj: number; spots: FishSpot[]; ents: WalkEntity[] }>();
function expanseFishLoaded(built: Built, outSpots: FishSpot[], outEnt: WalkEntity[]) {
  const og = navGrid(built).outer;
  if (!og?.parcels.size) return;
  for (const p of og.parcels.values()) {
    const list = parcelFishOf(p.kind);
    if (!list?.length) continue;
    let c = parcelSpots.get(list);
    if (!c || c.oi !== og.oi || c.oj !== og.oj) {
      const spots: FishSpot[] = [], ents: WalkEntity[] = [];
      list.forEach((f, k) => {
        const s: FishSpot = { tile: [p.cx * og.pw + f.li + og.oi, p.cz * og.pd + f.lj + og.oj], face: f.face, bx: f.bx + og.oi, by: f.by, bz: f.bz + og.oj };
        if (f.pond) s.pond = true;
        spots.push(s); ents.push(fishEntity(`fish:x${p.cx}_${p.cz}_${k}`, s));
      });
      c = { oi: og.oi, oj: og.oj, spots, ents };
      parcelSpots.set(list, c);
    }
    for (const s of c.spots) outSpots.push(s);
    for (const e of c.ents) outEnt.push(e);
  }
}
/** Yakındakiler kuyruğu: akışla gelen olta noktaları + kayıt (değişmeyen listede ayırma yok). */
function syncStreamed(built: Built, oceanY: number | null, city: CityMapFile | null, spotsBuf: FishSpot[], entBuf: WalkEntity[]) {
  spotsBuf.length = 0; entBuf.length = 0;
  if (city) cityFishLoaded(built, city, spotsBuf, entBuf);
  else expanseFishLoaded(built, spotsBuf, entBuf);
  syncSiteFishing(built, oceanY, spotsBuf, !!city);
  if (streamed.size !== entBuf.length || entBuf.some((e) => streamed.get(e.id) !== e)) {
    streamed.clear();
    for (const e of entBuf) streamed.set(e.id, e);
  }
}
export const entityTypeOf = (id: string): WalkEntityType | null => {
  const k = id.slice(0, id.indexOf(":"));
  return k === "board" || k === "coffee" || k === "bench" || k === "fish" || k === "table" || k === "toss" ? k : null;
};

export function buildWalkEntities(built: Built, oceanY: number | null): WalkEntity[] {
  const out: WalkEntity[] = [];
  const at = (t: Tile) => ({ x: tx(t[0]), z: tz(t[1]) });
  try {
    const spot = boardSpot(built);
    if (spot) out.push({ id: "board:0", kind: "board", type: "board", tile: spot.tile, ...at(spot.tile) });
  } catch { /* pano yoksa yok */ }
  let n = 0;
  for (const p of built.props ?? []) {
    if (p.k !== "coffee") continue;
    const tile = (p as { tile?: Tile }).tile;
    if (tile) out.push({ id: `coffee:${n}`, kind: "prop", type: "coffee", tile, ...at(tile) });
    else out.push({ id: `coffee:${n}`, kind: "prop", type: "coffee", tile: [0, 0], x: p.p[0], z: p.p[2] });
    n++;
  }
  n = 0;
  for (const s of built.stations) {
    if (!s.pose || !SEAT_POSES.has(s.pose)) continue;
    out.push({ id: `bench:${n++}`, kind: "prop", type: "bench", tile: s.tile, ...at(s.tile), face: s.face,
      pose: s.pose as WalkEntity["pose"], seatY: s.y });
  }
  try {
    const st = sites(built, oceanY);
    let f = 0, b = 0, g = 0;
    for (const s of st.fishing) {
      if (s.feedOnly || injected.has(s)) continue;
      out.push({ id: `fish:${f++}`, kind: "prop", type: "fish", tile: s.tile, ...at(s.tile), face: s.face });
    }
    for (const tb of st.tables) {
      // masa oyunu: PLAY_BOARD masaları ve atış oyunu olmayan sıradan masalar (WALK-FUN çözücüsü ikisini de kabul eder)
      if (tb.board || !tb.game) out.push({ id: `table:${b++}`, kind: "prop", type: "table", tile: tb.a, x: tb.x, z: tb.z });
      else if (tb.game) out.push({ id: `toss:${g++}`, kind: "prop", type: "toss", tile: tb.a, x: tb.x, z: tb.z });
    }
  } catch { /* sahnede oyun yeri yok */ }
  return out;
}

/**
 * UXF-B: avatarın Yakındakiler/F listesine giren nesneler — olta yerleri suya gerçekten bakan ve aynı su
 * gövdesinde `WALK_FISH_SPACING` karo aralıklı olanlarla sınırlı (`fun/walkSpots.ts`). Kayıt (`walkEntity`), `buildWalkEntities`
 * ve `sites.fishing` değişmez: kimlikler ve canlı envanter aynı kalır, yalnız sunum seyrekleşir.
*/
export function walkVisibleEntities(built: Built, oceanY: number | null, list: readonly WalkEntity[], core: SceneCore | null = null): WalkEntity[] {
  let st;
  try { st = sites(built, oceanY); } catch { return [...list]; }
  // `buildWalkEntities` ile aynı sıra: besleme ve akışla gelen noktalar dışı → `fish:<n>`
  const base = st.fishing.filter((s) => !s.feedOnly && !injected.has(s));
  const keep = walkFishSpots(built, base, oceanY);
  const ok = new Set<string>();
  base.forEach((s, k) => { if (keep.has(s)) ok.add(`fish:${k}`); });
  const out = list.filter((e) => e.type !== "fish" || ok.has(e.id));
  guideFishing(built, out, core);
  return out;
}

/** UXF-E: girişe en yakın olta yeri bu uzaklıktan (karo) yakınsa Yakındakiler'de yarıçaptan bağımsız listelenir.*/
export const GUIDE_FISH_MAX = 30;
/**
 * UXF-E: <city> girişinde en yakın geçerli olta yeri 13 karo uzakta (hendekteki yakın yerler tekne şeridinde) ve
 * Yakındakiler yarıçapı 8 — "ilk dakikada oltaya git" listede yoktu. Girişe en yakın sunulan olta yeri `far` (şehir kapısı gibi)
 * işaretlenir: listede "Olta yeri · N adım" olarak durur, seçince yürür. Yalnız bir yer (olta listeyi doldurmaz).
*/
function guideFishing(built: Built, list: readonly WalkEntity[], core: SceneCore | null): void {
  const fish = list.filter((e) => e.type === "fish");
  for (const e of fish) e.far = false;
  if (!fish.length) return;
  const sp = spawnTile(built, { core })?.tile;
  if (!sp) return;
  const [sx, sz] = [tx(sp[0]), tz(sp[1])];
  let best: WalkEntity | null = null, bd = Infinity;
  for (const e of fish) { const d = Math.hypot(e.x - sx, e.z - sz); if (d < bd) { bd = d; best = e; } }
  if (best && bd <= GUIDE_FISH_MAX) best.far = true;
}

/** World.tsx Scene: WalkRig `entities` işlevi (kararlı; aynı dizi). */
export function useWalkEntities(built: Built, oceanY: number | null, core: SceneCore | null = null): () => readonly ProxEntity[] {
  return useMemo(() => {
    // WALK-EXPLORE: iç mekân katında dış dünya nesneleri (pano, kahve, oturma, olta, masa) yok; keşif öğeleri eklenir
    // şehir haritasında (varış meydanı + semtler) ofis nesneleri, hatıraları ve keşif öğeleri yok
    const city = isGateBuilt(built);
    const interior = isInteriorBuilt(built);
    // COURTYARD-PORTAL: iç mekân katında yalnız oturma yerleri (avlu sekileri: `built.stations` sit_bench) — diğer dış nesneler yok
    const list = city ? [] : interior ? (built.stations.length ? buildWalkEntities(built, oceanY).filter((e) => e.type === "bench") : []) : buildWalkEntities(built, oceanY);
    registry.clear();
    streamed.clear();
    for (const e of list) registry.set(e.id, e);
    const shown: readonly WalkEntity[] = list.length ? walkVisibleEntities(built, oceanY, list, core) : list;
    // şehir haritasının ve çevre arazisinin olta noktaları (iç mekânda yok)
    const cityMap = city ? gateMapOf(built) : null;
    const fishSpots: FishSpot[] = [], fishEnts: WalkEntity[] = [];
    // geliştirme kancası (§10.3): ekran görüntüsü betikleri nesnelerin konumunu okur; üretim derlemesinde yok
    if (import.meta.env.DEV) (window as unknown as { __voxcrewWalkEntities?: () => WalkEntity[] }).__voxcrewWalkEntities = () => [...registry.values(), ...streamed.values()];
    // WALK-FUN ortam öğeleri (hayvan, ağaç, su…) her çağrıda eklenir; tampon dizi yeniden kullanılır (+0 ayırma)
    const buf: ProxEntity[] = [];
    // W4 (WALK-GAME-UI): hatıralar (`souvenir:<scene>:hN`) — konumları geçerli dünyaya kaydırılır; nesneler yeniden kullanılır
    souvenirLayer.built = built;
    // bilgi kartı hedefleri bu dünyadan kurulur
    infoWorld.built = built;
    const souv: ProxEntity[] = [];
    const [oi, oj] = layerOffset(built);
    return () => {
      if (!interior) syncStreamed(built, oceanY, cityMap, fishSpots, fishEnts);
      if (city) {
        // şehir haritasında da ortam öğeleri (ritüeller `hot:rt:`, çark) olta noktalarının ardından eklenir; Ambient
        // haritada bağlı değildir (hayvan/nesne listesi boş), olta girdileri ve sırası değişmez
        const amb = ambientEntities();
        const inf = infoEntities();
        // UXF-E: ulaşım durakları
        const stp = cityStopEntities();
        // CORE-WALK: geri dönüş geçidi (ışınlanma halkası)
        const gt = cityGateEntities();
        // CITYLIFE (B1): iç mekânlı landmark kapıları ("İçeri gir — …")
        const lmd = cityLmEntities();
        // seyir karoları (dürbün)
        const vps = cityVpEntities();
        if (!fishEnts.length && !amb.length && !inf.length && !stp.length && !gt.length && !lmd.length && !vps.length) return NONE;
        buf.length = 0;
        for (const e of fishEnts) buf.push(e);
        for (const e of amb) buf.push(e);
        for (const e of inf) buf.push(e);
        for (const e of stp) buf.push(e);
        for (const e of gt) buf.push(e);
        for (const e of lmd) buf.push(e);
        for (const e of vps) buf.push(e);
        return buf;
      }
      const amb = ambientEntities();
      // WALK-EXPLORE: içeride hatıra yok (iç kat ayrı uzaydır); kapı/POI ya da portal/seyir/keşif parçası eklenir
      const items = souvenirLayer.scene && !interiorRuntime.inside ? souvenirLayer.items : [];
      const ex = exploreEntities();
      const inf = infoEntities(); // iç mekânda yalnız katın sergi karosu (infoTargets)
      // UXF-B: ofis tabanındaki "Şehre çık" kapısı (şehir haritası olan sahnede; iç mekânda yok)
      const door = interior ? NONE : cityDoorEntities();
      const wzd = interior ? NONE : workZoneDoorEntities(built);
      if (!amb.length && !items.length && !ex.length && !fishEnts.length && !inf.length && !door.length && !wzd.length) return shown.length ? shown : NONE;
      buf.length = 0;
      for (const e of shown) buf.push(e);
      for (const e of door) buf.push(e);
      for (const e of wzd) buf.push(e);
      for (const e of fishEnts) buf.push(e);
      for (const e of amb) buf.push(e);
      for (const e of ex) buf.push(e);
      for (const e of inf) buf.push(e);
      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        const e = souv[k] ??= { id: "", kind: "souvenir", x: 0, z: 0 };
        e.id = SOUVENIR_PREFIX + it.id; e.x = tx(it.bi + oi); e.z = tz(it.bj + oj);
        buf.push(e);
      }
      return buf;
    };
  }, [built, oceanY, core]);
}
