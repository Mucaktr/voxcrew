/**
 * şehir haritası seyir karosunun dürbünü. Karoya gelince otomatik dönüş (vpAim.ts `aimAtViewpoint`)
 * vardı ama F ipucu yoktu, telefonda Etkileşim soluktu; su kenarındaki karoda (Londra [37,10]) F en yakın olta yerini açıyordu.
 * Her seyir karosu bir Yakındakiler girdisidir (`cityvp:<şehir>:<semt>:<n>`, öncelik katmanı 0: oltanın önünde); F → manzara kipi
 * (iç mekân dürbünüyle aynı: `startLandmarkView`) seyir karosunun simgesine (`vpLookTarget`); açıksa F kapatır. Karoda değilse karoya yürür.
*/
import type { ProxEntity } from "../walk/controller";
import { useWalkStore, walkRuntime } from "../walk/walkStore";
import { landmarkView, startLandmarkView, stopLandmarkView } from "../walk/landmarkView";
import { cityX, cityZ } from "../transit/model";
import { districtPlan } from "./district";
import type { CityMapFile, CityTile } from "./format";
import { isDistrictLocked, useCity } from "./store";
import { vpLookTarget } from "./vpAim";

export const CITY_VP_PREFIX = "cityvp:";
export const cityVpId = (city: string, district: string, n: number) => `${CITY_VP_PREFIX}${city}:${district}:${n}`;
export function parseCityVpId(id: string): { city: string; district: string; n: number } | null {
  if (!id.startsWith(CITY_VP_PREFIX)) return null;
  const [city, district, n] = id.slice(CITY_VP_PREFIX.length).split(":");
  return city && district && Number(n) > 0 ? { city, district, n: Number(n) } : null;
}

export interface VpRow { id: string; district: string; n: number; tile: CityTile; lift: number }
const rowsCache = new WeakMap<CityMapFile, VpRow[]>();
/** Şehrin bütün seyir karoları (semt sırası, semt içinde 1'den). Saf; harita başına önbellekli. */
export function cityVpRows(map: CityMapFile): VpRow[] {
  let rows = rowsCache.get(map);
  if (rows) return rows;
  rows = [];
  for (const d of map.districts) {
    const p = districtPlan(map, d);
    p.viewpoints.forEach((t, k) => rows!.push({ id: cityVpId(map.id, d.id, k + 1), district: d.id, n: k + 1, tile: [t[0], t[1]], lift: p.lift[(t[1] - p.j0) * p.w + (t[0] - p.i0)] ?? 0 }));
  }
  rowsCache.set(map, rows);
  return rows;
}

let pool: { map: CityMapFile; lockSig: string; ents: ProxEntity[] } | null = null;
const NONE: readonly ProxEntity[] = Object.freeze([]) as readonly ProxEntity[];
/** Yakındakiler girdileri (şehir haritası yokken boş; kilitli semtin seyir karosu yok). */
export function cityVpEntities(): readonly ProxEntity[] {
  const st = useCity.getState(), v = st.view;
  if (!v) { pool = null; return NONE; }
  const lockSig = [...st.locked].filter((k) => k.startsWith(`${v.city}:`)).sort().join("|");
  if (!pool || pool.map !== v.map || pool.lockSig !== lockSig)
    pool = { map: v.map, lockSig, ents: cityVpRows(v.map).filter((r) => !isDistrictLocked(v.city, r.district)).map((r) => ({ id: r.id, kind: "prop", x: cityX(r.tile[0]), z: cityZ(r.tile[1]) })) };
  return pool.ents.length ? pool.ents : NONE;
}

/** F / Etkileşim / Yakındakiler: seyir karosundaysa dürbün (manzara kipi) açılır/kapanır, değilse karoya yürünür. */
export function lookThroughCityVp(id: string, announceNone?: () => void): boolean {
  const p = parseCityVpId(id), v = useCity.getState().view;
  if (!p || !v || p.city !== v.city) return false;
  const row = cityVpRows(v.map).find((r) => r.id === id);
  if (!row) return false;
  if (landmarkView.active || landmarkView.request) { stopLandmarkView(); return true; }
  const a = walkRuntime.avatar;
  if (Math.hypot(a.x - cityX(row.tile[0]), a.z - cityZ(row.tile[1])) > 0.75) { useWalkStore.getState().setTarget(row.tile); return true; }
  const target = vpLookTarget(v.map, row.tile, row.lift); // dürbün semtin simgesine (varış dönüşünün kadraj hedefi değil)
  if (target && startLandmarkView(target)) return true;
  announceNone?.();
  return true;
}
