// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { Courtyard } from "../../voxel/interiors/courtyards";

export const FULL_COURTYARDS: Readonly<Record<string, Courtyard & { sceneTag?: string }>> = {};
