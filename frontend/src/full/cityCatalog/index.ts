// FREE fallback of ../cityCatalog.ts (the full-only aggregator is deleted in the free edition): no removed cities.
import type { CityCatalogEntry } from "../../voxel/citymap/catalog";
import type { CityMapFile } from "../../voxel/citymap/format";

export const FULL_CITY_CATALOG: Record<string, CityCatalogEntry> = {};
export const orderCityCatalog = (kept: Record<string, CityCatalogEntry>): Record<string, CityCatalogEntry> => kept;
export const orderCityMaps = (kept: Record<string, CityMapFile>): Record<string, CityMapFile> => kept;
