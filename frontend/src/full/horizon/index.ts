// FREE fallback for full/horizon.ts (the full aggregator shadows this file; keep export names/types identical).
import type { CityBoundary } from "../../voxel/citymap/horizon";
export const withFullHorizon = (k: Readonly<Record<string, CityBoundary>>, _h: { G: string[]; R: string[]; T: string[] }): Record<string, CityBoundary> => ({ ...k });
