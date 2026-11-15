/**
 * "Hoş geldin" kartının üç önerisi : bir baş simge, yakında yapılacak
 * bir ritüel, bir seyir noktası. Veri kopyalanmaz:
 * - simge: `FIRST_WAVE[şehir][0]` + `infoForLandmark` (tür etiketi `locales/landmarkInfo.ts`), ad `locales/city.ts`;
 * - ritüel: ritüel kataloğu (`fun/rituals`): haritada varışa en yakın bağlantılı ritüel, sahnede sahne bağlantılı ilk ritüel;
 * ad `<locale>_label` (`ritualText`);
 * - seyir noktası: simge kartının `infoViewpoint`'i (yoksa varışa en yakın semtin ilk seyir noktası), ad semt adından.
 * Haritada her önerinin hedef karosu vardır ("Git": yürüme hedefi, şehir karosu); sahnede seyir noktası şehir haritasındadır.
 *
 * Saf işlev (yalnız okuma); dil o anki yerelden.
*/
import { tx } from "../../lib/i18n";
import { city as CM } from "../../locales/city";
import { landmarkInfo as LIM } from "../../locales/landmarkInfo";
import { welcome as WM } from "../../locales/welcome";
import { CITY_MAPS } from "../../voxel/citymap/catalog";
import { districtPlan, walkableKind } from "../../voxel/citymap/district";
import { districtAt, stopTile, toCity, type CityMapFile, type CityTile } from "../../voxel/citymap/format";
import { FIRST_WAVE, infoForLandmark, infoViewpoint, infoKindKey } from "../../voxel/citymap/landmarkInfo";
import { GATE_ARRIVE } from "../../voxel/citymap/shell";
import { cityName, districtName, landmarkName } from "../../voxel/citymap/store";
import { RITUALS_BY_CITY, type MapAnchor, type RitualCity, type RitualDef } from "../../voxel/fun/rituals";
import { ritualText } from "../../voxel/fun/ritualRuntime";
import type { WelcomeScope } from "./welcomeStore";

export type WelcomeRowKind = "landmark" | "ritual" | "view";
export interface WelcomeRow {
  kind: WelcomeRowKind;
  /** satır başlığı ("Simge", "Yakında yapılacak bir şey", "Seyir noktası") */
  label: string;
  /** önerinin adı */
  name: string;
  /** kısa ek (tür, semt ya da nerede olduğu); yoksa boş */
  hint: string;
  /** haritada yürüme hedefi (şehir karosu); sahnede null */
  target: CityTile | null;
  /** UXF-B: sahnede seyir noktası satırı — "Git" ofis tabanındaki "Şehre çık" kapısına yürütür*/
  door?: boolean;
  /** sahnede hedef karosu yokken satırın eylemi — simge: bilgi kartı (sahnede bölgesi yoksa "Şehre çık" kapısına yürü),
   * ritüel: ritüel konumuna yürü. Haritada boş (hedef karo yeter).*/
  act?: WelcomeAct;
}
export type WelcomeAct = { kind: "landmark"; key: string } | { kind: "ritual"; id: string };
export interface WelcomeModel { city: RitualCity; title: string; rows: WelcomeRow[] }

const dist2 = (a: CityTile, b: CityTile) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Semt karosu yürünebilir mi (semt planı; varış meydanı dışı). */
function walkableAt(map: CityMapFile, t: CityTile): boolean {
  const d = districtAt(map, t[0], t[1]);
  if (!d) return false;
  const p = districtPlan(map, d), li = t[0] - p.i0, lj = t[1] - p.j0;
  return li >= 0 && lj >= 0 && li < p.w && lj < p.d && walkableKind(p.kind[lj * p.w + li]);
}
/** En yakın yürünebilir semt karosu (simge ayak izinin ortası yürünmez; "Git" hedefi önüne düşer). */
export function walkableNear(map: CityMapFile, t: CityTile, maxR = 8): CityTile {
  if (walkableAt(map, t)) return t;
  for (let r = 1; r <= maxR; r++) {
    let best: CityTile | null = null, bd = Infinity;
    for (let j = t[1] - r; j <= t[1] + r; j++) for (let i = t[0] - r; i <= t[0] + r; i++) {
      if (Math.max(Math.abs(i - t[0]), Math.abs(j - t[1])) !== r || !walkableAt(map, [i, j])) continue;
      const d = dist2([i, j], GATE_ARRIVE);
      if (d < bd) { bd = d; best = [i, j]; }
    }
    if (best) return best;
  }
  return t;
}

/** Ritüel harita bağlantısının şehir karosu: simge kapısı ya da önü, durak, yoksa semtin ilk girişi/ortası (yürünebilir). */
export function anchorTile(map: CityMapFile, a: MapAnchor): CityTile | null {
  const t = anchorRaw(map, a);
  return t ? walkableNear(map, t) : null;
}
function anchorRaw(map: CityMapFile, a: MapAnchor): CityTile | null {
  const d = map.districts.find((x) => x.id === a.district);
  if (!d) return null;
  if (a.landmark) {
    const lm = d.landmarks.find((x) => x.id === a.landmark);
    if (lm) return toCity(d, lm.door ?? [lm.tile[0] + Math.floor(lm.w / 2), lm.tile[1] + Math.floor(lm.d / 2)]);
  }
  if (a.stop) {
    const s = map.stops.find((x) => x.id === a.stop);
    const t = s ? stopTile(map, s) : null;
    if (t) return t;
  }
  return toCity(d, d.entries[0] ?? [Math.floor(d.bounds[2] / 2), Math.floor(d.bounds[3] / 2)]);
}

/** Haritada varışa en yakın ritüel (hayvana bağlı olanlar dahil değil: kedi her yerde değil). */
function mapRitual(city: RitualCity, map: CityMapFile): { def: RitualDef; tile: CityTile; district: string } | null {
  let best: { def: RitualDef; tile: CityTile; district: string } | null = null, bd = Infinity;
  for (const def of RITUALS_BY_CITY[city] ?? []) {
    if (def.at.animal) continue;
    for (const a of def.at.map ?? []) {
      const t = anchorTile(map, a);
      if (!t) continue;
      // "her zaman" ritüelleri öne: akşam/gece ritüeli eşit uzaklıkta geride kalır
      const d = dist2(t, GATE_ARRIVE) + (def.when && def.when !== "any" ? 400 : 0);
      if (d < bd) { bd = d; best = { def, tile: t, district: a.district }; }
    }
  }
  return best;
}

/** Sahnede: sahne bağlantılı ilk "her zaman" ritüeli (yoksa ilk sahne ritüeli). */
function sceneRitual(city: RitualCity): RitualDef | null {
  const defs = (RITUALS_BY_CITY[city] ?? []).filter((d) => d.at.scene?.length && !d.at.animal);
  return defs.find((d) => !d.when || d.when === "any") ?? defs[0] ?? null;
}

/** Kartın içeriği; şehrin haritası ya da baş simgesi yoksa null (kart açılmaz). */
export function welcomeModel(city: RitualCity, scope: WelcomeScope): WelcomeModel | null {
  const map = CITY_MAPS[city];
  const lmId = FIRST_WAVE[city]?.[0];
  if (!map || !lmId) return null;
  const rows: WelcomeRow[] = [];
  const info = infoForLandmark(city, lmId);
  const lmDistrict = map.districts.find((d) => d.landmarks.some((l) => l.id === lmId));
  const lmTile = lmDistrict ? anchorTile(map, { district: lmDistrict.id, landmark: lmId }) : null;
  const kindKey = info ? infoKindKey(info) : "";
  rows.push({
    kind: "landmark", label: tx(WM, "row_landmark"), name: landmarkName(city, lmId),
    hint: kindKey && kindKey in LIM.tr ? tx(LIM, kindKey as "lmi_kind_tower") : "",
    target: scope === "map" ? lmTile : null,
    ...(scope === "scene" && info ? { act: { kind: "landmark", key: info.key } as WelcomeAct } : {}),
  });
  if (scope === "map") {
    const r = mapRitual(city, map);
    rows.push(r
      ? { kind: "ritual", label: tx(WM, "row_ritual"), name: ritualText(r.def, "label"), hint: districtName(city, r.district), target: r.tile }
      : { kind: "ritual", label: tx(WM, "row_ritual"), name: tx(WM, "ritual_none"), hint: "", target: null });
  } else {
    const r = sceneRitual(city);
    rows.push({
      kind: "ritual", label: tx(WM, "row_ritual"), name: r ? ritualText(r, "label") : tx(WM, "ritual_none"), hint: "", target: null,
      ...(r ? { act: { kind: "ritual", id: r.id } as WelcomeAct } : {}),
    });
  }
  // seyir noktası: simge kartınınki, yoksa varışa en yakın seyir noktası
  let vp = info ? infoViewpoint(info) : null, vpDistrict = info?.district ?? "";
  if (!vp) {
    let bd = Infinity;
    for (const d of map.districts) for (const v of d.viewpoints ?? []) {
      const t = toCity(d, v), dd = dist2(t, GATE_ARRIVE);
      if (dd < bd) { bd = dd; vp = { id: "", tile: t }; vpDistrict = d.id; }
    }
  }
  if (vp) {
    rows.push({
      kind: "view", label: tx(WM, "row_view"), name: tx(WM, "view_name", { district: districtName(city, vpDistrict) }),
      hint: scope === "map" ? "" : tx(WM, "view_in_map", { door: tx(CM, "door") }), target: scope === "map" ? walkableNear(map, vp.tile) : null,
      ...(scope === "scene" ? { door: true } : {}),
    });
  }
  return { city, title: tx(WM, "title", { city: cityName(city) }), rows };
}
