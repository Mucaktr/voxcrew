// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { OfficeDef } from "../../voxel/workzones/registry";

export const FULL_ZONE_CITIES: Record<string, OfficeDef[]> = {};
export const FULL_ZONE_ORDER: readonly string[] = [];
