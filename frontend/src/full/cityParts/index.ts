// ÜRETİLDİ — elle düzenleme. `node scripts/cities.mjs --write` (ağır parçalar: kurucu, stil, harita).
// EDITION1: free sürüm eşi (şehir yok). Tam sürümde üst klasördeki aynı adlı .ts önce çözülür.

import type { CityParts } from "../../voxel/cities/types";

export const NEW_CITY_PARTS: Readonly<Record<string, CityParts>> = {};
