// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { PlaceClimate } from "../../voxel/props/weather";

export const FULL_PLACE_CLIMATE: Readonly<Record<string, PlaceClimate>> = {};
export const FULL_SNOW_GROUND: readonly string[] = [];
