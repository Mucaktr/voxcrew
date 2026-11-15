// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { BiomeId, FeatureKind } from "../../voxel/expanse/biomes";
import type { CityStyle } from "../../voxel/city/style";

export const FULL_SCENE_BIOME: Record<string, BiomeId> = {};
export const FULL_CITY_STYLES: Record<string, CityStyle> = {};
export const FULL_SCENE_COAST: Record<string, { sea: number; sand: number }> = {};
export const FULL_SCENE_WEIGHTS: Record<string, Partial<Record<FeatureKind, number>>> = {};
