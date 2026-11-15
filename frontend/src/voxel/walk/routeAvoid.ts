/**
 * HQA-FIX — tıkla-git rotasının geçmediği TETİK karoları. Avatar bu karolara basınca başka bir yere geçer (iç mekân,
 * kat, şehir haritası, ofis). <city>'ta "Heykelle fotoğraf çek" rotası "Çatı terası · giriş" kapı karosundan geçiyor, avatar
 * heykele varmadan merdiven boşluğuna ışınlanıyordu: rota yalnız "Şehre çık" kapısından kaçınıyordu.
 *
 * - iç katta: portallar (çıkış, kat kapısı) ve merdiven tetikleri
 * - şehir haritasında: geri dönüş geçidi ve iç mekânlı landmark kapıları
 * - sahnede: açık iç mekân kapıları ve "Şehre çık" kapısı (`walkGates`; doğma kuralı da bunu kullanır)
 *
 * Hedef karonun kendisi (kapıya yürü) `planRoute` içinde kaçınılmaz. Saf modül: React/three yok.
*/
import type { Built, Tile } from "../scenes";
import { baseOffset } from "./controller";
import { doorsInWorld, useInterior } from "../interiors/store";
import { officeDoor } from "../citymap/door";
import { cityForScene, CITY_MAPS } from "../citymap/catalog";
import { toCity } from "../citymap/format";
import { GATE_RETURN } from "../citymap/shell";
import { cityRuntime } from "../citymap/runtime";
import { cityGateRuntime } from "../citymap/doorEntity";

/** HQA-FIX: sahnenin geçit karoları — şehir haritası kapısı (sahnenin haritası varsa) ve açık iç mekân kapıları.*/
export function walkGates(world: string, built: Built): Tile[] {
  const out: Tile[] = doorsInWorld(world, baseOffset(built)).map((d) => d.tile);
  const door = cityForScene(world) ? officeDoor(built) : null;
  if (door) out.push(door.tile);
  return out;
}

const cityCache = new Map<string, Tile[]>();
/** Şehir haritasının tetik karoları: geri dönüş geçidi + iç mekânı olan landmark kapıları (semt planı gerekmez; kapı veride). */
export function cityTriggerTiles(mapId: string): Tile[] {
  let out = cityCache.get(mapId);
  if (out) return out;
  const map = CITY_MAPS[mapId];
  out = [[GATE_RETURN[0], GATE_RETURN[1]]];
  for (const d of map?.districts ?? []) for (const l of d.landmarks ?? []) if (l.door && l.interior) out.push(toCity(d, l.door) as Tile);
  cityCache.set(mapId, out);
  return out;
}

/** İç katın tetik karoları: portallar ve merdiven tetikleri. */
export function levelTriggerTiles(lv: { portals: readonly { tile: Tile }[]; stairs: readonly { tile: Tile }[] }): Tile[] {
  return [...lv.portals.map((p) => p.tile), ...lv.stairs.map((s) => s.tile)];
}

/** Yürünen dünyanın tetik karoları (iç kat › şehir haritası › sahne); `WalkRig` tıkla-git rotasına `avoid` olarak verir. */
export function routeAvoid(world: string | null, built: Built): Tile[] {
  const lv = useInterior.getState().view?.level;
  if (lv) return levelTriggerTiles(lv);
  if (cityRuntime.active) { const id = cityGateRuntime.src?.city(); return id ? cityTriggerTiles(id) : [[GATE_RETURN[0], GATE_RETURN[1]]]; }
  return world ? walkGates(world, built) : [];
}
