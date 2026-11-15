// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { LocalCostume } from "../../voxel/cosmetics/local/index";
import { ISTANBUL } from "../../voxel/cosmetics/local/istanbul";
import { KAPADOKYA } from "../../voxel/cosmetics/local/kapadokya";
import { LONDRA } from "../../voxel/cosmetics/local/londra";

export const FULL_LOCAL_RAW: readonly (readonly LocalCostume[])[] = [ISTANBUL, KAPADOKYA, LONDRA];
