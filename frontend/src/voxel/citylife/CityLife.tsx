/**
 * CITYLIFE — tek bağlama noktası (World.tsx): o an çizilen dünyaya göre
 *  - geçit efektleri (`DoorFxLayer`): taban sahnede açık iç mekân kapıları; iç katta çıkış kapısı, merdiven/asansör ve seyir noktası;
 *    şehir haritasında iç mekânlı landmark kapıları, durak turnikeleri ve seyir noktaları (şehir kapısı ve "Ofise dön" halkası zaten
 *    `PortalRing`);
 *  - figüranlar ve satıcılar (`Figurans`): şehir haritasında semt figüranları + mekân satıcıları; taban sahnede mekân satıcıları.
 * Görünürken en çok +2 çizim çağrısı (efekt dizisi + figüran dizisi).
 */
import { useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { baseOffset } from "../walk/controller";
import { scenePlaces } from "../interiors/placement";
import type { InteriorLevel } from "../interiors/generate";
import { districtPlan } from "../citymap/district";
import type { CityView } from "../citymap/store";
import { momentNow, rainLevel } from "../props/weather";
import type { Built } from "../scenes";
import { districtFx, levelFx, sceneDoorFx, type DoorFx } from "./doorFx";
import { DoorFxLayer } from "./DoorFxLayer";
import { Figurans } from "./FiguransLayer";
import { officeDoorFx } from "../workzones/world";

export interface CityLifeProps {
  scene: string;
  /** taban dünya (büyümüş; kapılar ve satıcılar) */
  worldBuilt: Built;
  /** iç kat (varsa) */
  level: InteriorLevel | null;
  cityView: CityView | null;
  night: boolean;
  /** sahnenin yağmurlu hava katmanı açık mı */
  rainy: boolean;
  /** mevsim/hava anı yer kimliği (SceneFx `place`) */
  place: string | null;
}

export function CityLife({ scene, worldBuilt, level, cityView, night, rainy, place }: CityLifeProps) {
  const clock = useThree((s) => s.clock);
  const map = cityView?.map ?? null;
  const off = useMemo(() => baseOffset(worldBuilt), [worldBuilt]);
  const fx = useMemo<readonly DoorFx[]>(() => {
    if (level) return levelFx(level);
    if (map) return map.districts.flatMap((d) => districtFx(map.id, d, districtPlan(map, d)));
    // WORK-ZONES: şehir ofis binalarının kapıları da geçit perdesi taşır (ofis yoksa liste aynen)
    const doors = sceneDoorFx(scenePlaces(scene).doors, baseOffset(worldBuilt)), offices = officeDoorFx(worldBuilt);
    return offices.length ? [...doors, ...offices] : doors;
  }, [level, map, scene, worldBuilt]);
  // yağmur: sahne katmanı (aralıklı döngü) ya da yerin sağanak anı (saniyede bir yoklanır)
  const wet = useRef({ at: -1, moment: false });
  const rain = useMemo(() => () => {
    const t = clock.elapsedTime;
    if (t - wet.current.at > 1) { wet.current.at = t; wet.current.moment = momentNow(place)?.kind === "shower"; }
    return wet.current.moment || (rainy && rainLevel(t) > 0.15);
  }, [clock, place, rainy]);
  return (
    <>
      <DoorFxLayer list={fx} night={night} />
      {!level && map && <Figurans mode="city" map={map} costumeScene={cityView!.scene} night={night} rain={rain} paused={false} />}
      {!level && !map && <Figurans mode="scene" blocks={worldBuilt.blocks} offset={off} costumeScene={scene} night={night} rain={rain} paused={false} />}
    </>
  );
}
