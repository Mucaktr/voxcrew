/**
 * CITYLIFE (B1) — geçitlerin F istemi hedefi söyler: "İçeri gir — Galata Kulesi", "Dışarı çık — Beyoğlu", "Yukarı çık — 2. kat",
 * "Turnikeden geç — Karaköy". WorldPage `walkAction` önce buna bakar; geçit değilse null (eski istem).
 */
import { tx } from "../../../../lib/i18n";
import { citylife as LM } from "../../../../locales/citylife";
import { explore as XM } from "../../../../locales/explore"; // NONCITY-QA: dürbün istemi
import { parseCityLmId } from "../../../../voxel/citylife/lmDoors";
import { workZoneDoorPrompt } from "../../../../voxel/workzones/doors";
import { parseCityStopId } from "../../../../voxel/citymap/stopEntity";
import { parseCityVpId } from "../../../../voxel/citymap/vpEntity";
import { cityName, districtName, landmarkName, stopName, useCity } from "../../../../voxel/citymap/store";
import { isCitySite } from "../../../../voxel/citymap/runtime";
import { CITY_MAPS } from "../../../../voxel/citymap/catalog";
import { exploreEntity } from "../../../../voxel/interiors/entities";
import { useInterior } from "../../../../voxel/interiors/store";
import { liftNeedsPicker } from "../../../../voxel/interiors/liftPick"; // LIFTFLOOR
import { useWalkStore } from "../../../../voxel/walk/walkStore";
import { sceneLabel } from "../progress/actions";
import { roomName, siteName } from "./actions";

/** İç mekândan çıkınca varılan yerin adı: şehir landmarkı → semt (yoksa şehir), sahne → sahne adı. */
export function outsideName(scene: string, site: string): string {
  if (isCitySite(site)) {
    // `city_<şehir>__<semt>__<simge>`
    const [c, d] = site.replace(/^city_/, "").split("__");
    const v = useCity.getState().view;
    if (c && d) return districtName(c, d);
    return v ? cityName(v.city) : sceneLabel(scene);
  }
  return sceneLabel(scene);
}

/** Kat adı: 0 → zemin kat, n → "n. kat". */
const floorText = (dir: "up" | "down", to: number) => (dir === "down" && to === 0 ? tx(LM, "f_down_ground") : tx(LM, dir === "up" ? "f_up" : "f_down", { n: to }));

/** Geçidin F istemi (hedefli); geçit değilse null. */
export function doorAction(id: string): string | null {
  const lm = parseCityLmId(id);
  if (lm) return tx(LM, courtOnly(lm) ? "f_enter_court" : "f_enter", { name: landmarkName(lm.city, lm.lm) });
  const wz = workZoneDoorPrompt(id); // WORK-ZONES: "İçeri gir — <ofis>"
  if (wz) return wz;
  const cs = parseCityStopId(id);
  if (cs) return tx(LM, "f_stop", { stop: stopName(cs[0], cs[1]) });
  if (parseCityVpId(id)) return tx(XM, "vp_look"); // "F: Dürbünle bak"
  const e = exploreEntity(id);
  if (!e) return null;
  const scene = useWalkStore.getState().world ?? "";
  if (e.type === "lift") { // LIFTFLOOR: birden çok kata hizmet eden kapı → "kat seç"
    const here = useInterior.getState().view?.level, stop = here?.lifts.find((x) => x.id === e.id);
    if (here && stop && liftNeedsPicker(here, stop)) return tx(XM, "f_lift_pick");
  }
  switch (e.type) {
    case "door": return tx(LM, "f_enter", { name: siteName(scene, e.site) });
    case "portal": {
      const site = useInterior.getState().site ?? "";
      return tx(LM, "f_exit", { name: outsideName(scene, site) });
    }
    case "stair": return floorText(e.dir, e.to);
    case "lift": { // hedef kat adıyla ("Asansörle çık — Seyir galerisi")
      const st = useInterior.getState(), to = st.plan?.levels[e.to];
      return to ? tx(LM, e.to > st.index ? "f_lift_up" : "f_lift_down", { room: roomName(to.name, e.to) }) : null;
    }
    case "vp": return tx(XM, "vp_look"); // NONCITY-QA: "F: Dürbünle bak" (eskiden yalnız ad: "Seyir noktası")
    default: return null;
  }
}

/** Yakındakiler adı (landmark kapısı); değilse null. */
export function lmDoorName(id: string): string | null {
  const lm = parseCityLmId(id);
  return lm ? tx(LM, courtOnly(lm) ? "lm_door_court" : "lm_door", { name: landmarkName(lm.city, lm.lm) }) : null;
}

/** simgenin iç mekânı yalnız avlu mu (Ayasofya: "içeri gir" deyip avluya çıkarıyordu → istem "Avluya gir").*/
function courtOnly(lm: { city: string; district: string; lm: string }): boolean {
  return CITY_MAPS[lm.city]?.districts.find((d) => d.id === lm.district)?.landmarks.find((l) => l.id === lm.lm)?.interior === "courtyard";
}
