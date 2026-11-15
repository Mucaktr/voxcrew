// FREE fallback for full/facade.ts (the full aggregator shadows this file; keep export names/types identical).
import type { CityFacadeEntry } from "../../voxel/citymap/facade";
export const withFullFacade = (k: Readonly<Record<string, CityFacadeEntry>>): Record<string, CityFacadeEntry> => ({ ...k });
