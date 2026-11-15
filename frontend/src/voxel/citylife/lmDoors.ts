/**
 * CITYLIFE (B1) — şehir haritasındaki iç mekânlı landmark kapıları **etkileşimli**: Yakındakiler girdisi (`citylm:<şehir>:<semt>:<simge>`;
 * avatara `LM_DOOR_REACH` karo içindeki açık semtlerde), F istemi "İçeri gir — <simge>", F ya da listeden seçince avatar kapı karosuna
 * yürür; karoya basınca CityRig `onTile` iç mekâna kararmalı geçişle sokar (`interiors/store.ts transition`). Kapıda geçit perdesi
 * (`doorFx.ts districtFx`).
 *
 * Saf çekirdek (`cityLmRows`, `parseCityLmId`) React/three/depo olmadan test edilir; `cityLmEntities` depoyu okur (4 Hz; aynı dizi
 * ve nesneler yeniden kullanılır).
 */
import { tx, tz, type Tile } from "../scenes";
import type { ProxEntity } from "../walk/controller";
import { walkRuntime } from "../walk/walkStore";
import { goPortal } from "../citymap/doorEntity"; // PORTAL-INTENT-001
import { interiorRuntime } from "../interiors/runtime";
import { districtPlan } from "../citymap/district";
import type { CityMapFile } from "../citymap/format";
import { isDistrictLocked, useCity } from "../citymap/store";

export const CITY_LM_PREFIX = "citylm:";
export const isCityLmId = (id: string) => id.startsWith(CITY_LM_PREFIX);
/** Yakındakiler'de listelendiği en büyük uzaklık (karo, Chebyshev). */
export const LM_DOOR_REACH = 16;

export interface CityLmRow { id: string; city: string; district: string; lm: string; tile: Tile }

/** `citylm:<şehir>:<semt>:<simge>` → parçalar; değilse null. */
export function parseCityLmId(id: string): { city: string; district: string; lm: string } | null {
  if (!isCityLmId(id)) return null;
  const p = id.slice(CITY_LM_PREFIX.length).split(":");
  return p.length === 3 && p.every(Boolean) ? { city: p[0], district: p[1], lm: p[2] } : null;
}

const rowCache = new WeakMap<CityMapFile, CityLmRow[]>();
/** Haritanın iç mekânlı landmark kapıları (şehir karosu). */
export function cityLmRows(map: CityMapFile): CityLmRow[] {
  let rows = rowCache.get(map);
  if (rows) return rows;
  rows = [];
  for (const d of map.districts) {
    const plan = districtPlan(map, d);
    for (const door of plan.doors) {
      const spec = d.landmarks.find((l) => l.id === door.landmark);
      if (!spec?.interior) continue;
      rows.push({ id: `${CITY_LM_PREFIX}${map.id}:${d.id}:${door.landmark}`, city: map.id, district: d.id, lm: door.landmark, tile: door.tile });
    }
  }
  rowCache.set(map, rows);
  return rows;
}

const buf: ProxEntity[] = [];
const pool = new Map<string, ProxEntity>();
const NONE: readonly ProxEntity[] = [];
/** Yakındakiler girdileri (şehir haritasında, iç mekân dışında; kilitli semt hariç). */
export function cityLmEntities(): readonly ProxEntity[] {
  const map = useCity.getState().view?.map;
  if (!map || interiorRuntime.inside) return NONE;
  const a = walkRuntime.avatar, I = Math.floor(a.x + 12), J = Math.floor(a.z + 8);
  buf.length = 0;
  for (const r of cityLmRows(map)) {
    if (Math.max(Math.abs(r.tile[0] - I), Math.abs(r.tile[1] - J)) > LM_DOOR_REACH || isDistrictLocked(map.id, r.district)) continue;
    let e = pool.get(r.id);
    if (!e) { e = { id: r.id, kind: "prop", x: tx(r.tile[0]), z: tz(r.tile[1]) }; pool.set(r.id, e); }
    buf.push(e);
  }
  return buf;
}

/** Avatarı landmark kapısına yürüt (karoya basınca CityRig içeri alır). Kapı yoksa false. */
export function goCityLm(id: string): boolean {
  const map = useCity.getState().view?.map;
  const row = map ? cityLmRows(map).find((r) => r.id === id) : null;
  if (!row || interiorRuntime.inside) return false;
  goPortal(row.tile, `city:${map!.id}`); // PORTAL-INTENT-001: karosundaysa F doğrudan girer
  return true;
}
