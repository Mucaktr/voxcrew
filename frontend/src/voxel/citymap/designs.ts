/**
 * şehir tasarımı kaydı (harita kimliği → tasarım katmanı; design.ts). Londra ve diğer şehirler kendi
 * `cities/<şehir>.ts` dosyalarından buraya eklenir. Saf modül.
*/
import type { CityDesign, LandmarkModel } from "./design";
import { ISTANBUL_DESIGN } from "./cities/istanbul";
import { LONDRA_DESIGN } from "./cities/londra";
import { KAPADOKYA_DESIGN } from "./cities/kapadokya";
import { withFullDesigns } from "../../full/designs";
import { cityPackDesign } from "../citypacks/cityOverlay";
import { NEW_CITY_IDS } from "../cities/index";
import { NEW_CITY_PARTS } from "../cities/parts";
import { carveGates, GATE_TOP_CITY, mapGates } from "../walk/landmarkGates"; // LANDMARK-WALK

const RAW_DESIGNS: Readonly<Record<string, CityDesign>> = { ...withFullDesigns({ istanbul: ISTANBUL_DESIGN, londra: LONDRA_DESIGN, kapadokya: KAPADOKYA_DESIGN }),
  ...Object.fromEntries(NEW_CITY_IDS.map((id) => [id, NEW_CITY_PARTS[id].design])) };
/** LANDMARK-WALK: avlu/bahçe girişi tanımlı simgenin yakın modeli kapı karolarında oyulur (walk/landmarkGates.ts; uzak LOD aynen). */
const withGates = (mapId: string, d: CityDesign): CityDesign => {
  const lms = Object.entries(d.landmarks);
  if (!lms.some(([id]) => mapGates(mapId, id))) return d;
  return { ...d, landmarks: Object.fromEntries(lms.map(([id, md]): [string, LandmarkModel] => {
    const g = mapGates(mapId, id);
    return [id, g ? { ...md, near: (c) => carveGates(md.near(c), c.x0, c.z0, g, GATE_TOP_CITY) } : md];
  })) };
};
export const CITY_DESIGNS: Readonly<Record<string, CityDesign>> = Object.fromEntries(Object.entries(RAW_DESIGNS).map(([id, d]) => [id, withGates(id, d)])); // LANDMARK-WALK

/** CITY-PACKS: etkin şehir paketlerinin süs ve katı karoları tasarıma eklenir (etkin paket yoksa tasarım aynen döner). */
export const designOf = (mapId: string): CityDesign | null => cityPackDesign(mapId, CITY_DESIGNS[mapId] ?? null);

/** Landmark modeli (yoksa null: yer tutucu siluet çizilir).*/
export const landmarkModel = (mapId: string, lm: string): LandmarkModel | null => CITY_DESIGNS[mapId]?.landmarks[lm] ?? null;
