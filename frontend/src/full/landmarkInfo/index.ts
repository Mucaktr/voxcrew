// FREE fallback for full/landmarkInfo.ts (the full aggregator shadows this file; keep export names/types identical).
import type { InfoCity, LandmarkInfo } from "../../voxel/citymap/landmarkInfo";

type InfoRest<K extends string> = Omit<LandmarkInfo, K>;
type LmFn = (city: InfoCity, district: string, landmark: string, rest: InfoRest<"key" | "city" | "district" | "landmark">) => LandmarkInfo;
type DistFn = (city: InfoCity, district: string, rest: InfoRest<"key" | "city" | "district" | "landmark" | "kind" | "inspired">) => LandmarkInfo;

export const withFullFirstWave = (k: Readonly<Record<string, readonly string[]>>): Record<string, readonly string[]> => ({ ...k });
export const fullLandmarkInfo = (_lm: LmFn, _dist: DistFn): readonly (readonly LandmarkInfo[])[] => [[], [], []];
