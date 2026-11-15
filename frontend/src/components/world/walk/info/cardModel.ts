/**
 * bilgi kartının içerik bağlaması (saf; React ve depo yok): hedeften hangi metin anahtarlarının, ölçek notunun,
 * damga kimliğinin, kutsal alan notunun, seyir noktasının ve ritüellerin gösterileceği. Veri `voxel/citymap/landmarkInfo.ts`
 * — burada kopya yok, yalnız seçim. Kartı olmayan simgede "otomatik kart": ad + ritüeller + damga (§4.7).
 * `frontend/scripts/walk_info.test.mjs` esbuild ile paketleyip Galata, Ayasofya ve kartsız simgede denetler.
*/
import { CITY_MAPS, landmarkId } from "../../../../voxel/citymap/catalog";
import { landmarkModel } from "../../../../voxel/citymap/designs";
import {
  infoFactKey, infoForDistrict, infoInspiredKey, infoKindKey, infoRituals, infoSacred, infoScaleM, infoStampId, infoTextRef, infoViewpoint, INFO_RITUALS_MAX,
} from "../../../../voxel/citymap/landmarkInfo";
import { isRitualCity, RITUALS_BY_CITY } from "../../../../voxel/fun/rituals";
import type { InfoTarget } from "./infoTargets";
import type { Tile } from "./infoLogic";
import { FULL_SCENE_TAG_DISTRICT } from "../../../../full/cardModel";

export interface CardModel {
  /** `locales/landmarkInfo.ts` anahtarları (kartsızda null) */
  kindKey: string | null;
  inspiredKey: string | null;
  /** kısa metin: hangi yerel dosya, hangi anahtar (kartsızda null → "ayrıntı henüz yazılmadı") */
  text: { ns: "explore" | "landmarkInfo"; key: string } | null;
  factKey: string | null;
  /** ölçek notu (m; yalnız gerçek yapı) */
  scaleM: number | null;
  sacred: boolean;
  /** pasaport: şehirde damga kimliği (`useCity.found`), sahnede vize kimliği (`useWalkProgress.visas`) */
  stamp: { kind: "city" | "visa"; id: string } | null;
  /** en iyi görünüm: seyir noktası karosu (yalnız şehir haritası; sahnede null → "Manzara" ipucuyla kapalı) */
  viewpoint: Tile | null;
  /** o yerin ritüelleri (en çok 3; kutsal alanda yok) */
  rituals: string[];
  auto: boolean;
}

/**
 * kartsız simge "ayrıntılı bilgi henüz yazılmadı" göstermez; içinde bulunduğu semtin kart metni gösterilir (harita: hedef semti;
 * sahne bölgesi: etiketi aynı kimlikli simgeyi taşıyan semt). Semt bulunamazsa metin boş kalır (kart ad + ritüel + damga).
*/
function fallbackText(t: InfoTarget): CardModel["text"] {
  const dist = t.district ?? CITY_MAPS[t.city]?.districts.find((d) => d.landmarks.some((l) => l.id === t.tag))?.id
    ?? (t.tag ? SCENE_TAG_DISTRICT[`${t.city}:${t.tag}`] : undefined) ?? null;
  const dc = dist ? infoForDistrict(t.city, dist) : null;
  if (dc) return infoTextRef(dc);
  return t.scope === "scene" && t.tag ? { ns: "explore", key: `scene_note_${t.scene ?? t.city}_${t.tag}` } : null;
}

/**
 * sahne etiketi haritadaki simge kimliğiyle eşleşmeyen taban sahne simgeleri (Londra "Sütun" boş kart açıyordu) → semti.
 * interaction_audit "F-CARD-001" her F bilgi hedefinin metni/ritüeli/kapısı olduğunu bütün sahne ve şehirlerde denetler.
*/
const SCENE_TAG_DISTRICT: Readonly<Record<string, string>> = {
  "kapadokya:zelve": "vadiler",
  "londra:palace": "park", "londra:memorial": "park", "londra:column": "carsi",
  ...FULL_SCENE_TAG_DISTRICT,
};

export function cardModel(t: InfoTarget): CardModel {
  const c = t.card;
  const sacred = c ? infoSacred(c) : !!(t.landmark && landmarkModel(t.city, t.landmark)?.sacred);
  let stamp: CardModel["stamp"] = null;
  if (t.scope === "map") {
    if (c) stamp = { kind: "city", id: infoStampId(c) };
    else if (t.district && t.landmark) stamp = { kind: "city", id: landmarkId(t.city, t.district, t.landmark) };
  } else if (t.tag) stamp = { kind: "visa", id: `${t.scene ?? t.city}:${t.tag}` };
  let viewpoint: Tile | null = null;
  if (t.scope === "map") {
    if (c) viewpoint = infoViewpoint(c)?.tile ?? null;
    else {
      const d = CITY_MAPS[t.city]?.districts.find((x) => x.id === t.district);
      const vp = d?.viewpoints?.[0];
      viewpoint = d && vp ? [d.bounds[0] + vp[0], d.bounds[1] + vp[1]] : null;
    }
  }
  const rituals = c
    ? infoRituals(c)
    : sacred || !isRitualCity(t.city) ? []
      : (RITUALS_BY_CITY[t.city] ?? []).filter((r) => r.at.map?.some((a) => a.district === t.district)).map((r) => r.id as string).slice(0, INFO_RITUALS_MAX);
  return {
    kindKey: c ? infoKindKey(c) : null,
    inspiredKey: c ? infoInspiredKey(c) : null,
    text: c ? infoTextRef(c) : fallbackText(t),
    factKey: c ? infoFactKey(c) : null,
    scaleM: c ? infoScaleM(c) : null,
    sacred,
    stamp,
    viewpoint,
    rituals,
    auto: !c,
  };
}
