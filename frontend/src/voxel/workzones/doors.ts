/**
 * WORK-ZONES — şehir ofis binası kapıları yürüme modunda ETKİLEŞİMLİ (CITYLIFE landmark kapısı deseni, `citylife/lmDoors.ts`):
 * Yakındakiler girdisi `wzdoor:<bölge>` (avatara `WZ_DOOR_REACH` karo içindeki kapılar), adı "<ofis> · giriş", F istemi
 * "İçeri gir — <ofis>" (citylife `f_enter`; ham kimlik yok), F ya da listeden seçince avatar kapıdan salonun içine yürür; çatı
 * kesiti (walk/cover.ts) cam çatıyı açar → masalarda çalışan ajanlar görünür. Kapıda geçit perdesi (`world.ts officeDoorFx`).
 *
 * Saf çekirdek (`parseWorkZoneDoorId`, `officeDoorRows`) React/three olmadan sınanır; `workZoneDoorEntities` yürüme deposunu okur
 * (4 Hz; aynı dizi ve nesneler yeniden kullanılır).
 */
import { tx as msg, currentLocale } from "../../lib/i18n";
import { citylife } from "../../locales/citylife";
import { interiorRuntime } from "../interiors/runtime";
import { tx, tz, type Built, type Tile } from "../scenes";
import type { ProxEntity } from "../walk/controller";
import { useWalkStore, walkRuntime } from "../walk/walkStore";
import { parseZone, zoneName } from "./registry";
import { officeSites } from "./world";

export const WZ_DOOR_PREFIX = "wzdoor:";
export const WZ_DOOR_REACH = 16;
export const isWorkZoneDoorId = (id: string) => id.startsWith(WZ_DOOR_PREFIX);
/** `wzdoor:<sahne>:<ofis>` → bölge kimliği (kayıtta yoksa null). */
export function parseWorkZoneDoorId(id: string): string | null {
  if (!isWorkZoneDoorId(id)) return null;
  const zone = id.slice(WZ_DOOR_PREFIX.length);
  return parseZone(zone) ? zone : null;
}

export interface OfficeDoorRow { id: string; zone: string; door: Tile; inside: Tile }
const rowCache = new WeakMap<Built, OfficeDoorRow[]>();
export function officeDoorRows(built: Built): OfficeDoorRow[] {
  let rows = rowCache.get(built);
  if (!rows) {
    rows = officeSites(built).map((s) => ({ id: `${WZ_DOOR_PREFIX}${s.zone}`, zone: s.zone, door: s.door, inside: s.inside }));
    rowCache.set(built, rows);
  }
  return rows;
}

let last: Built | null = null;
const buf: ProxEntity[] = [];
const pool = new Map<string, ProxEntity>();
const NONE: readonly ProxEntity[] = [];
/** Yakındakiler girdileri (dış dünyada; iç mekânda yok). */
export function workZoneDoorEntities(built: Built): readonly ProxEntity[] {
  last = built;
  const rows = officeDoorRows(built);
  if (!rows.length || interiorRuntime.inside) return NONE;
  const a = walkRuntime.avatar, I = Math.floor(a.x + 12), J = Math.floor(a.z + 8);
  buf.length = 0;
  for (const r of rows) {
    if (Math.max(Math.abs(r.door[0] - I), Math.abs(r.door[1] - J)) > WZ_DOOR_REACH) continue;
    let e = pool.get(r.id);
    if (!e) { e = { id: r.id, kind: "prop", x: tx(r.door[0]), z: tz(r.door[1]) }; pool.set(r.id, e); }
    e.x = tx(r.door[0]); e.z = tz(r.door[1]);
    buf.push(e);
  }
  return buf;
}

const lang = () => (currentLocale() === "en" ? "en" : "tr");
/** F istemi: "İçeri gir — <ofis>"; kapı değilse null. */
export function workZoneDoorPrompt(id: string): string | null {
  const zone = parseWorkZoneDoorId(id);
  return zone ? msg(citylife, "f_enter", { name: zoneName(zone, lang()) }) : null;
}
/** Yakındakiler adı: "<ofis> · giriş"; kapı değilse null. */
export function workZoneDoorName(id: string): string | null {
  const zone = parseWorkZoneDoorId(id);
  return zone ? msg(citylife, "lm_door", { name: zoneName(zone, lang()) }) : null;
}
/** Avatarı kapıdan salonun içine yürüt. Kapı yoksa false. */
export function goWorkZoneDoor(id: string): boolean {
  const zone = parseWorkZoneDoorId(id);
  const row = zone && last ? officeDoorRows(last).find((r) => r.zone === zone) : null;
  if (!row || interiorRuntime.inside) return false;
  useWalkStore.getState().setTarget(row.inside);
  return true;
}
