/**
 * LANDMARK-HIRES — şehir başına yüksek çözünürlük kurucularının listesi. Yeni şehir: kendi `…/landmarks/hires.ts` dosyasında
 * `HiResMapEntry[]` / `HiResSceneEntry[]` dışa aktar, buraya bir satır ekle.
 * Kurucu dosyalar yalnız `hires/kit.ts`, `hires/types.ts` ve `citymap/design.ts` ilkellerini içe aktarır (döngü yok:
 * `citymap/district.ts` bu kataloğu okur).
*/
import type { HiResMapEntry, HiResSceneEntry } from "./types";
import { withFullHiresMap, withFullHiresScene } from "../../full/hiresCatalog";
import { ISTANBUL_HIRES_MAP, ISTANBUL_HIRES_SCENE } from "../city/landmarks/istanbul/hires";
import { LONDRA_HIRES_MAP, LONDRA_HIRES_SCENE } from "../city/landmarks/londra/hires"; // HIRES-LON
import { KAPADOKYA_HIRES_MAP, KAPADOKYA_HIRES_SCENE } from "../city/landmarks/kapadokya/hires"; // HIRES-KAP

export const HIRES_MAP: readonly HiResMapEntry[] = withFullHiresMap({ istanbul: ISTANBUL_HIRES_MAP, londra: LONDRA_HIRES_MAP, kapadokya: KAPADOKYA_HIRES_MAP }); // HIRES-KAP

export const HIRES_SCENE: readonly HiResSceneEntry[] = withFullHiresScene({ istanbul: ISTANBUL_HIRES_SCENE, londra: LONDRA_HIRES_SCENE, kapadokya: KAPADOKYA_HIRES_SCENE });
