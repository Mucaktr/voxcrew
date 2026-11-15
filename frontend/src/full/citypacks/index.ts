// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { Box } from "../../voxel/citypacks/kit";
import type { PackMeta } from "../../voxel/citypacks/catalog";

export const FULL_PACKS_AFTER = "";
export const FULL_PACKS: PackMeta[] = [];
export const FULL_PACK_DRAW: Record<string, () => Box[]> = {};
