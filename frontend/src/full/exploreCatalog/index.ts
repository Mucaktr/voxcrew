// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { SceneExplore } from "../../voxel/interiors/catalog";

export const FULL_EXPLORE_SCENES: Record<string, SceneExplore> = {};
export const FULL_EXPLORE_ORDER: readonly string[] = [];
