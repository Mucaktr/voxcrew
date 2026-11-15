/**
 * bilgi kartı hedefleri (yürüme modunda): sahnede simge bölgeleri (`zone.kind === "landmark"`, kart `sceneTags` ile),
 * şehir haritasında semt planlarındaki landmark ayak izleri (kart `infoForLandmark`) ve semt kartları. Kartı olmayan simge de
 * hedeftir: kart "ad + ritüeller + damga" ile kendiliğinden kurulur (§4.7).
 *
 * Yakındakiler'e `info:<anahtar>` girdileri (tür `landmark`; konum avatara en yakın ayak izi noktası) buradan girer; Nearby,
 * F ve "git ve aç" bu kimliği WalkHud'da karta çevirir (WorldPage'e gitmez). Veri `voxel/citymap/landmarkInfo.ts`'ten okunur
 * (salt okunur; kopya yok). İç mekânda yalnız katın sergi karosu (`exhibit`) simgenin kartını açar.
*/
import type { Built } from "../../../../voxel/scenes";
import { coverGrid, heightAt, NEARBY_RADIUS, type ProxEntity } from "../../../../voxel/walk/controller";
import { useWalkStore, walkRuntime } from "../../../../voxel/walk/walkStore";
import { isInteriorBuilt, useInterior } from "../../../../voxel/interiors/store";
import { parseCitySite } from "../../../../voxel/interiors/cityPano";
import { isGateBuilt } from "../../../../voxel/citymap/shell";
import { districtPlan } from "../../../../voxel/citymap/district";
import { districtName, landmarkName, useCity } from "../../../../voxel/citymap/store";
import { infoForDistrict, infoForLandmark, infoForSceneZone, LANDMARK_INFO, type LandmarkInfo } from "../../../../voxel/citymap/landmarkInfo";
import { landmarkZones } from "../progress/logic";
import { landmarkLabel } from "../progress/actions";
import { nearestPoint, rectDist, tileOfX, tileOfZ, type Rect, type Tile } from "./infoLogic";

export interface InfoTarget {
  /** kart anahtarı ("istanbul/galata_kulesi", "istanbul/@beyoglu"); kartı yoksa "auto:<kapsam>:<…>" */
  key: string;
  scope: "scene" | "map";
  /** şehir kimliği (ritüel ve ad); sahnede sahne kimliği */
  city: string;
  district: string | null;
  landmark: string | null;
  /** sahne simge bölgesi etiketi (vize kimliği `<sahne>:<etiket>`) */
  tag: string | null;
  /** sahne kimliği (yalnız sahne hedefi) */
  scene: string | null;
  card: LandmarkInfo | null;
  rect: Rect;
  /** gövde yüksekliği (birim; dokunma ışını) */
  h: number;
  /** şehir: girilebilir simgenin kapısı (karo) */
  door: Tile | null;
  /** iç mekân sergi karosu (kart şehir görünümü/yürüyüş düğmesi göstermez)*/
  inside?: true;
}

export const INFO_PREFIX = "info:";
export const isInfoId = (id: string) => id.startsWith(INFO_PREFIX);

/** WalkHud'un dünyası (entities.ts `useWalkEntities` yazar). */
export const infoWorld: { built: Built | null } = { built: null };

let cacheKey: unknown = null;
let cache: InfoTarget[] = [];
const byKey = new Map<string, InfoTarget>();

function sceneTargets(built: Built, scene: string): InfoTarget[] {
  const zones = landmarkZones(scene, built.zones, built.width, built.depth);
  if (!zones.length) return [];
  let cover: ReturnType<typeof coverGrid> | null = null;
  try { cover = coverGrid(built); } catch { cover = null; }
  return zones.map((z) => {
    const card = infoForSceneZone(scene, z.tag);
    let h = 0;
    if (cover) for (let j = z.j0; j <= z.j1; j++) for (let i = z.i0; i <= z.i1; i++) h = Math.max(h, heightAt(cover, i, j));
    return {
      key: card?.key ?? `auto:scene:${scene}:${z.tag}`, scope: "scene", city: card?.city ?? scene, district: card?.district ?? null,
      landmark: card?.landmark ?? null, tag: z.tag, scene, card, rect: { i0: z.i0, j0: z.j0, i1: z.i1, j1: z.j1 }, h: h || 3, door: null,
    } satisfies InfoTarget;
  });
}

function mapTargets(): InfoTarget[] {
  const v = useCity.getState().view;
  if (!v) return [];
  const out: InfoTarget[] = [];
  for (const d of v.map.districts) {
    const plan = districtPlan(v.map, d);
    for (const lm of plan.landmarks) {
      const card = infoForLandmark(v.city, lm.id);
      const I0 = plan.i0 + lm.i0, J0 = plan.j0 + lm.j0;
      out.push({
        key: card?.key ?? `auto:map:${v.city}:${d.id}:${lm.id}`, scope: "map", city: v.city, district: d.id, landmark: lm.id, tag: null, scene: null, card,
        // kapı semt planı koordinatında — şehir karosuna çevrilir (eskiden ham: Galata kartı "Kapı: 95 adım", liste 7 adım)
        rect: { i0: I0, j0: J0, i1: I0 + lm.w - 1, j1: J0 + lm.d - 1 }, h: lm.h, door: lm.door ? [plan.i0 + lm.door[0], plan.j0 + lm.door[1]] : null,
      });
    }
  }
  return out;
}

/** şehir landmarkı iç mekânında katın sergi karosu → simgenin kartı (tek karo; geniş dikdörtgen asansör/merdiven F'sini gölgelerdi).*/
function interiorTargets(): InfoTarget[] {
  const lv = useInterior.getState().view?.level, id = lv?.exhibit ? parseCitySite(lv.site) : null;
  if (!lv?.exhibit || !id) return [];
  const card = infoForLandmark(id.city, id.landmark), [i, j] = lv.exhibit;
  return [{ key: card?.key ?? `auto:map:${id.city}:in:${id.landmark}`, scope: "map", city: id.city, district: card?.district ?? null, landmark: id.landmark, tag: null, scene: null, card,
    rect: { i0: i, j0: j, i1: i, j1: j }, h: 1, door: null, inside: true }];
}

/** Geçerli dünyanın simge hedefleri (dünya ya da şehir değişince yeniden kurulur; aynı dizi). */
export function infoTargets(): readonly InfoTarget[] {
  const built = infoWorld.built;
  const st = useWalkStore.getState();
  const view = useCity.getState().view;
  const inside = !built || isInteriorBuilt(built);
  const key = inside ? useInterior.getState().view?.level ?? null : view && isGateBuilt(built) ? view : built;
  if (key === cacheKey) return cache;
  cacheKey = key;
  cache = inside ? interiorTargets() : !key ? [] : view && key === view ? mapTargets() : st.world ? sceneTargets(built!, st.world) : [];
  byKey.clear();
  for (const t of cache) byKey.set(t.key, t);
  return cache;
}

/** Şehirde avatarın semt kartı (simge dışında `I` için); yoksa null. */
export function districtTarget(): InfoTarget | null {
  const s = useCity.getState();
  const v = s.view;
  if (!v || !s.district) return null;
  const d = v.map.districts.find((x) => x.id === s.district);
  if (!d) return null;
  const card = infoForDistrict(v.city, d.id);
  const [i0, j0, w, dd] = d.bounds;
  const t: InfoTarget = { key: card?.key ?? `auto:map:${v.city}:@${d.id}`, scope: "map", city: v.city, district: d.id, landmark: null, tag: null, scene: null, card,
    rect: { i0, j0, i1: i0 + w - 1, j1: j0 + dd - 1 }, h: 0, door: null };
  byKey.set(t.key, t);
  return t;
}

export const infoTargetByKey = (key: string): InfoTarget | null => { infoTargets(); return byKey.get(key) ?? null; };
export const infoTargetOf = (id: string): InfoTarget | null => (isInfoId(id) ? infoTargetByKey(id.slice(INFO_PREFIX.length)) : null);

/** Görünen ad: kartın şehir adı (`lm_*` / `d_*`), kartsız sahne simgesinde sahne etiketi adı. */
export function infoName(t: InfoTarget): string {
  if (t.card?.landmark) return landmarkName(t.card.city, t.card.landmark);
  if (t.card) return districtName(t.card.city, t.card.district);
  if (t.scope === "scene" && t.tag) return landmarkLabel(`${t.city}:${t.tag}`);
  if (t.landmark) return landmarkName(t.city, t.landmark);
  return t.district ? districtName(t.city, t.district) : t.key;
}
export const infoNameOf = (id: string): string | null => { const t = infoTargetOf(id); return t ? infoName(t) : null; };

/** Avatarın karosu. */
export const avatarTile = (): Tile => [tileOfX(walkRuntime.avatar.x), tileOfZ(walkRuntime.avatar.z)];

// ------------------------------------------------------------------ Yakındakiler girdileri
const pool = new Map<string, ProxEntity>();
const buf: ProxEntity[] = [];
const NONE: readonly ProxEntity[] = Object.freeze([]) as readonly ProxEntity[];
/** Yakındakiler'e `info:` girdileri: ayak izi `NEARBY_RADIUS` içindeki simgeler (konum: izin avatara en yakın noktası). */
export function infoEntities(): readonly ProxEntity[] {
  const list = infoTargets();
  if (!list.length) return NONE;
  const a = walkRuntime.avatar, t = avatarTile();
  buf.length = 0;
  for (const it of list) {
    if (rectDist(t, it.rect) > NEARBY_RADIUS + 1) continue;
    const id = INFO_PREFIX + it.key;
    let e = pool.get(id);
    if (!e) pool.set(id, (e = { id, kind: "landmark", x: 0, z: 0 }));
    const p = nearestPoint(a.x, a.z, it.rect);
    e.x = p.x; e.z = p.z;
    buf.push(e);
  }
  return buf.length ? buf : NONE;
}

/** Sahne bilgi noktasının (`poi:<n>`) kartı aynı zamanda bir simge kartıysa o kartın anahtarı: Yakındakiler'de ikisi tek satır. */
export function infoKeyForPoi(scene: string | null, id: string): string | null {
  if (!scene || !id.startsWith("poi:")) return null;
  const n = Number(id.slice(4));
  return LANDMARK_INFO.find((c) => c.poi?.scene === scene && c.poi.n === n)?.key ?? null;
}
