// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { Adjacency, SceneProfile } from "../../voxel/rules/catalog";
import type { WorldSceneId } from "../../voxel/scenes";

export const FULL_SCENE_PROFILES = {} satisfies Record<string, SceneProfile>;
export const FULL_ADJ: [WorldSceneId, WorldSceneId, Adjacency][] = [];
