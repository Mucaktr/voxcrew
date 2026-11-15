// ÜRETİLDİ — elle düzenleme. `node scripts/cities.mjs --write` (saf manifestler; sahne/kit içe aktarılmaz).
// EDITION1: free sürüm eşi (şehir yok). Tam sürümde üst klasördeki aynı adlı .ts önce çözülür.

import type { CityManifest } from "../../voxel/cities/types";

export const NEW_CITIES: readonly CityManifest[] = [];
export type NewCityId = never;
export const NEW_CITY_IDS: readonly NewCityId[] = [];
