// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { Anchor } from "../../voxel/interiors/placement";

export const FULL_ANCHORS: Record<string, Record<string, Anchor>> = {};
export const FULL_POI_NEAR: Record<string, string[]> = {};
