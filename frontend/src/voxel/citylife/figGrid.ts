/**
 * figüran yaya ızgarası: `pedGrid` + avatarın varış/çıkış karosu çevresi (3 × 3) yürünmez/durulmaz.
 * Kök neden: figüran yalnız avatarın ANLIK konumundan kaçınıyordu (`AVATAR_CLEAR` 0,55 / `YIELD_R` 1,2). Hatla bir durağa inince ya da
 * iç mekândan çıkınca avatar figüranın yürüdüğü kaldırıma düşüyor, figüran avatarın hemen önünde/içinde kalıyordu (<city>, Marakeş,
 * <city>, Londra, <city>, <city>). Varış karoları (durak: `stopArrival`; kapı çıkışı: `landmarkExit`) ve 8 komşusu `obst` olur:
 * oradan rota geçmez, orada doğmaz, oraya ilgi noktası/oturak konmaz. Saf (store/citysight yalnız hesap için).
*/
import type { CityMapFile, CityTile } from "../citymap/format";
import { stopTile } from "../citymap/format";
import { citySight } from "../citymap/arrivalView";
import { landmarkExit } from "../citymap/doorExit";
import { rideEndHeading, stopArrival } from "../citymap/store";
import { travelPlan } from "../transit/model";
import { vpAvoidAims } from "../citymap/vpAim";
import type { CityDistrict } from "../citymap/format";
import { FRONT_PREFIX, pedGrid, stopCamAvoid, vpViewAvoid, type PedGrid } from "./figurans";

type PlanArg = Parameters<typeof pedGrid>[1] & {
  mapId?: string; landmarks: readonly { id: string; i0: number; j0: number; w: number; d: number }[];
  doors: readonly { landmark: string; tile: CityTile }[]; stops: readonly { id: string; tile: CityTile }[];
  kind: Uint8Array; viewpoints: readonly CityTile[];
};

const stopArrivalCache = new WeakMap<CityMapFile, CityTile[]>();
/**
 * Şehrin HER durağının avatar varış karoları (hızlı seyahat + hatla iniş). ( b): eskiden yalnız semtin kendi durakları
 * sayılıyordu; varış karosu komşu semtteyse (İstanbul eminönü, <city> hamamatsucho, <city> cadde_23: 10 varış) o semtin ızgarasında
 * 3 × 3 yoktu, figüran varış karosunun dibinde yürüyüp duruyordu.
*/
export function stopArrivals(map: CityMapFile): CityTile[] {
  let out = stopArrivalCache.get(map);
  if (out) return out;
  out = [];
  for (const t of map.stops) {
    const st = stopTile(map, t);
    if (!st) continue;
    out.push(stopArrival(map, st).tile);
    // hatla iniş (store.ts boardLine): aracın geliş yönü varış karosunu değiştirebilir
    for (const line of map.lines) {
      if (!line.stops.includes(t.id)) continue;
      for (const o of line.stops) {
        const p = o === t.id ? null : travelPlan(map, line.id, o, t.id);
        if (p) out.push(stopArrival(map, p.arrive, rideEndHeading(p)).tile);
      }
    }
  }
  stopArrivalCache.set(map, out);
  return out;
}

/** Semtin avatar varış/çıkış karoları (şehir karosu): durak varışı (`stopArrival`, şehrin tüm durakları) ve her landmark kapısının çıkışı (`landmarkExit`). */
export function arrivalTiles(map: CityMapFile, plan: PlanArg): CityTile[] {
  const out: CityTile[] = [...stopArrivals(map)];
  let sight: ReturnType<typeof citySight> | null = null;
  for (const dr of plan.doors) {
    const lm = plan.landmarks.find((x) => x.id === dr.landmark);
    if (!lm) continue;
    sight ??= citySight(map);
    out.push(landmarkExit(plan as never, dr.tile, lm, sight).out);
  }
  return out;
}

/**
 * ( c): iç mekân/landmark kapısı çıkışında avatar kapının dışında durur, kamera `aim` yaw'ının tersinde (3-4 birim arkada,
 * kapıya doğru) — çıkış şeridi (`exitLane`) yalnız kapıdan dışarıyı kapsıyordu; Galata çıkışında figüran kameranın dibindeydi. Çıkış
 * kamera kolu da durak varış kamerası gibi (`stopCamAvoid`) kaplanır; yalnız `f` önekli anahtarlar (eler, hiçbir nokta kaymaz).
*/
export function exitCams(map: CityMapFile, plan: PlanArg): { tile: CityTile; heading: number }[] {
  const out: { tile: CityTile; heading: number }[] = [];
  let sight: ReturnType<typeof citySight> | null = null;
  for (const dr of plan.doors) {
    const lm = plan.landmarks.find((x) => x.id === dr.landmark);
    if (!lm) continue;
    const e = landmarkExit(plan as never, dr.tile, lm, (sight ??= citySight(map)));
    out.push({ tile: e.out, heading: e.aim });
  }
  return out;
}

/**
 * FiguransLayer ve testlerin ortak kaçınma kümesi ("i,j" şerit / `f` önekli yalnız-ele): durak varış kamerası (stopCamAvoid), seyir bakışı
 * (vpViewAvoid, GATEFIX2/) ve kapı çıkışı kamera kolu. `plan.lift` seyir karosu yüksekliği için.
*/
export function figAvoid(map: CityMapFile, d: CityDistrict, plan: PlanArg & { lift: ArrayLike<number>; w: number; i0: number; j0: number }): Set<string> {
  const avoid = stopCamAvoid(map.stops.filter((x) => x.district === d.id).map((x) => stopTile(map, x)).filter((t): t is CityTile => !!t).map((t) => stopArrival(map, t)));
  // GATEFIX2: seyir noktasının bakış koridoru da boş (figüran 1. şahıs seyir karesinin önünde durmaz); + telefon bakışı (yalnız eler)
  for (const k of vpViewAvoid(plan.viewpoints.flatMap((t) => vpAvoidAims(map, t, plan.lift[(t[1] - plan.j0) * plan.w + t[0] - plan.i0] ?? 0)))) avoid.add(k);
  for (const k of stopCamAvoid(exitCams(map, plan))) if (k.startsWith(FRONT_PREFIX)) avoid.add(k); // ( c)
  return avoid;
}

/** FiguransLayer'ın kullandığı ızgara. */
export function figGrid(map: CityMapFile, plan: PlanArg): PedGrid {
  const g = pedGrid(map, plan);
  for (const [I, J] of arrivalTiles(map, plan)) {
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const li = I + a - g.i0, lj = J + b - g.j0;
      if (li >= 0 && lj >= 0 && li < g.w && lj < g.d) g.obst[lj * g.w + li] = 1;
    }
  }
  return g;
}
