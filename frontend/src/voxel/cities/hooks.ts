/**
 * tek seferlik bağlama yardımcısı: `cityRecord(f)` şehir kimliği → değer kaydı (`Record<NewCityId, T>`; sıra
 * `NEW_CITIES`). Tam tipli kayıtlarda (`SCENES`, `SCENE_PROFILES`, `RITUAL_IDS` …) yayılır; şehir yokken boş nesne.
 * Saf modül: yalnız saf manifestleri okur.
*/
import { NEW_CITIES, type NewCityId } from "./index";
import type { CityManifest } from "./types";

export function cityRecord<T>(f: (m: CityManifest) => T): Record<NewCityId, T> {
  return Object.fromEntries(NEW_CITIES.map((m) => [m.catalog.id, f(m)])) as unknown as Record<NewCityId, T>;
}
