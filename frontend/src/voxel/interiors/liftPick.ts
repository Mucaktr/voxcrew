/**
 * LIFTFLOOR (ürün sahibi 2026-11-01 "en üst seyir katına asansör çıksın; birkaç kat varsa binince katı seçelim") — çok katlı asansörde kat seçici.
 * Saf mantık + küçük durum: hangi kapı hangi katlara gider (`liftChoices`), seçici gerekir mi (`liftNeedsPicker`), seyir katına
 * varışta bakış yönü (`liftArrivalHeading`). Veri `InteriorLevel.lifts` (generate.ts `linkLifts`) olduğu gibi okunur: kapı başına
 * duraklar `door` karosuna göre gruplanır, böylece Yakındakiler'deki yinelenen girişlerin sayısı seçiciyi etkilemez (her çizili
 * kapı kendi katlarını gösterir). React yok; çizim `components/world/walk/explore/LiftPicker.tsx`.
*/
import { create } from "zustand";
import type { InteriorLevel, InteriorPlan, LiftStop } from "./generate";
import { vpFacing } from "./lookout";

export interface LiftChoice {
  /** kat dizini */
  index: number;
  /** kat adı anahtarı (locales/explore.ts `lvl_*` / `room_*`) */
  name: string;
  /** bulunulan kat (seçilemez) */
  here: boolean;
  /** o kata giden durak (bulunulan katta null) */
  stop: LiftStop | null;
}

const sameTile = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];

/** Aynı asansör kapısının (kapı karosu) bütün durakları. */
export const liftDoorStops = (lv: Pick<InteriorLevel, "lifts">, stop: Pick<LiftStop, "door">): LiftStop[] =>
  lv.lifts.filter((x) => sameTile(x.door, stop.door));

/** Seçici listesi: bu kapının hizmet verdiği katlar (+ bulunulan kat), en üst kat önce (asansör paneli gibi). */
export function liftChoices(plan: Pick<InteriorPlan, "levels">, lv: Pick<InteriorLevel, "lifts" | "index">, stop: Pick<LiftStop, "door">): LiftChoice[] {
  const stops = liftDoorStops(lv, stop);
  return plan.levels
    .map((l): LiftChoice => ({ index: l.index, name: l.name, here: l.index === lv.index, stop: stops.find((s) => s.to === l.index) ?? null }))
    .filter((c) => c.here || c.stop)
    .sort((a, b) => b.index - a.index);
}

/** Tek hedefli asansör doğrudan gider; birden çok kata hizmet eden kapı seçici açar. */
export const liftNeedsPicker = (lv: Pick<InteriorLevel, "lifts">, stop: Pick<LiftStop, "door">) => liftDoorStops(lv, stop).length > 1;

/** Varış bakışı: seyir katında (açık hava + dürbün) manzaraya (dürbünün yönü), değilse kapıya sırtı dönük (durağın kendi yönü). */
export function liftArrivalHeading(lv: Pick<InteriorLevel, "outdoor" | "spots" | "built" | "kind">, stop: Pick<LiftStop, "heading">): number {
  const vp = lv.outdoor ? lv.spots.find((s) => s.kind === "vp") : undefined;
  if (!vp) return stop.heading;
  const [dx, dz] = vpFacing(lv, vp.tile);
  return Math.atan2(dx, dz);
}

/** Açık seçici: hangi kat ve hangi kapının (durağı) için açıldığı. */
export interface LiftPickerState { open: { levelKey: string; stop: LiftStop } | null }
export const useLiftPicker = create<LiftPickerState>(() => ({ open: null }));
export const openLiftPicker = (levelKey: string, stop: LiftStop) => useLiftPicker.setState({ open: { levelKey, stop } });
export const closeLiftPicker = () => useLiftPicker.setState({ open: null });
