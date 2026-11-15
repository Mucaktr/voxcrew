/**
 * şehir haritası varışının bakış yönü.
 *
 * Varış karosundan (`GATE_ARRIVE`) 8 yöne görüş ışını atılır (`walk/spawnView.ts` `chooseView`). Görüş ızgarası şehrin
 * birleşik karosudur: varış meydanı blokları (örtü ızgarası, göz hizası) ∪ semt planları (sokak, meydan, park, durak, kapı,
 * seyir, su, çit açık; bina, simge, ağaç, sur kapalı) ∪ kıyı şehrinde deniz. Tercih edilen hedef: varıştan `ARRIVAL_LANDMARK_RADIUS` içindeki simgeler.
 *
 * Saf modül: React/three yok. Sonuç harita başına önbellekli (aynı harita → aynı yön).
*/
import { packCache } from "../citypacks/cityOverlay";
import type { Tile } from "../scenes";
import { chooseView, sceneSight, type SightFn, type ViewChoice } from "../walk/spawnView";
import { districtPlan, T_DOOR, T_HEDGE, T_PARK, T_PLAZA, T_RAIL, T_STOP, T_STREET, T_VIEW, T_WATER } from "./district";
import { GATE_D, GATE_W, inGate, type CityMapFile } from "./format";
import { arrivalFocus } from "./arrivalKit";
import { walkFov, WALK_FOV_DEFAULT } from "../walk/scale";
import { GATE_ARRIVE, GATE_RETURN, gateBuilt } from "./shell";
import { FULL_ARRIVAL_LEAN } from "../../full/arrivalView";

const OPEN_KINDS: ReadonlySet<number> = new Set([T_STREET, T_PLAZA, T_PARK, T_RAIL, T_STOP, T_DOOR, T_VIEW, T_WATER, T_HEDGE]);

/** Şehrin görüş ızgarası (şehir karosu). */
export function citySight(map: CityMapFile, from: Tile = GATE_ARRIVE): SightFn {
  const gate = sceneSight(gateBuilt(map), from);
  const plans = map.districts.map((d) => districtPlan(map, d));
  return (I, J) => {
    if (inGate(I, J)) return gate(I, J);
    for (const p of plans) {
      const li = I - p.i0, lj = J - p.j0;
      if (li >= 0 && lj >= 0 && li < p.w && lj < p.d) return OPEN_KINDS.has(p.kind[lj * p.w + li]);
    }
    return map.sea ? true : null;
  };
}

/** Varış karosundan `radius` içindeki simgelerin merkezleri (şehir karosu). */
export function nearLandmarks(map: CityMapFile, from: Tile = GATE_ARRIVE, radius = ARRIVAL_LANDMARK_RADIUS): [number, number][] {
  const out: [number, number][] = [];
  for (const d of map.districts) for (const lm of d.landmarks) {
    const c: [number, number] = [d.bounds[0] + lm.tile[0] + (lm.w - 1) / 2, d.bounds[1] + lm.tile[1] + (lm.d - 1) / 2];
    if (Math.hypot(c[0] - from[0], c[1] - from[1]) <= radius) out.push(c);
  }
  return out;
}
/** Varıştan görülebilecek simge uzaklığı (karo; şehir sisi ve yakın halka). */
export const ARRIVAL_LANDMARK_RADIUS = 28;

/** ARRE: varış simgesi kadrajda en dar desteklenen ekranda (375 × 812) bile iç kısımda kalsın: yatay yarı açının bu oranı (kenarda yarım simge kırpılmasın). */
export const ARRIVAL_FIT_ASPECT = 375 / 812, ARRIVAL_FIT_FRAC = 0.4;
export const arrivalFitHalf = (aspect = ARRIVAL_FIT_ASPECT) => Math.atan(Math.tan((walkFov(WALK_FOV_DEFAULT, aspect) * Math.PI) / 360) * aspect) * ARRIVAL_FIT_FRAC;

/**
 * (kalan 8 anahtardan kapadokya dahil): `chooseView` simgeye dönüşü yalnız `FIT_ROT_MAX` (0,45 rad) içinde ve açık ışınlarla yapar;
 * bu iki şehirde gereken dönüş sınırı aşıyor ya da (kapadokya) simgeye tam dönmek karenin ortasını kapatıyor. Bakış ızgara yönünden bu kadar
 * (rad) ek döner — `FIT_ROT_MAX`'ı küresel yükseltmek 5 yeni city-entry bulgusu açıyordu. Değerler ölçülmüştür (arrival_check city-entry 0 bulgu +
 * arrival_landmark 375 × 812 0 bulgu penceresinin içi: kapadokya 0,2…0,4); ızgara yönü (kit yönü) değişmez. Test:.test.mjs.
*/
export const ARRIVAL_LEAN: Readonly<Record<string, number>> = { kapadokya: 0.3, ...FULL_ARRIVAL_LEAN };

/**
 * ( kalanı): varış bakışı geri dönüş halkasına (`GATE_RETURN`, varışın 7 karo +z'si) dönükse (kit yönü 0) halka ve tabelası ilk karenin ortasında duruyordu. Bu şehirlerde CityRig halkayı varış meydanında avatar `RING_HOLD_D` birim
 * yürüyene dek çizmez (kemer görünür; "Ofise dön" düğmesi her zaman var). Sınır: bakış ile halka yönü arasındaki açı < `RING_HOLD_ANGLE`.
*/
export const RING_HOLD_ANGLE = Math.PI / 3, RING_HOLD_D = 1.5;
export function arrivalHidesRing(map: CityMapFile): boolean {
  const v = cityArrivalView(map), h = v.heading ?? v.yaw;
  const b = Math.atan2(GATE_RETURN[0] - GATE_ARRIVE[0], GATE_RETURN[1] - GATE_ARRIVE[1]);
  return Math.abs(Math.atan2(Math.sin(h - b), Math.cos(h - b))) < RING_HOLD_ANGLE;
}

const cache = packCache(() => new Map<string, ViewChoice>());
/** Şehir varışının bakışı (harita başına önbellekli). */
export function cityArrivalView(map: CityMapFile): ViewChoice {
  const hit = cache().get(map.id);
  if (hit) return hit;
  const focus = arrivalFocus(map.id, GATE_ARRIVE, GATE_RETURN, map.gate.kind === "pier" ? 12 : GATE_D, GATE_W); // kitin simgesi de hedef
  const v = chooseView(citySight(map), GATE_ARRIVE, focus ? [...nearLandmarks(map), focus] : nearLandmarks(map), { half: arrivalFitHalf(), prefer: focus ?? undefined });
  const lean = ARRIVAL_LEAN[map.id];
  if (lean !== undefined && focus && v.heading === v.yaw) {
    v.heading = v.yaw + lean;
    v.side = Math.sin(v.heading - Math.atan2(focus[0] - GATE_ARRIVE[0], focus[1] - GATE_ARRIVE[1])) >= 0 ? 1 : -1;
  }
  cache().set(map.id, v);
  return v;
}
