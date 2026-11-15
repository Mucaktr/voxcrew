// FREE fallback for full/viewDistance.ts (the full aggregator shadows this file; keep export names/types identical).
import type { CityHaze } from "../../voxel/citymap/viewDistance";
export const withFullViewDistance = (k: Readonly<Record<string, Partial<CityHaze>>>): Record<string, Partial<CityHaze>> => ({ ...k });
