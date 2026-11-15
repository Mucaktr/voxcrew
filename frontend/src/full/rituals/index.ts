// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { RitualDef } from "../../voxel/fun/rituals/index";

export const FULL_RITUAL_CITIES = ["istanbul", "londra", "kapadokya"] as const;
export const FULL_RITUAL_IDS = {} as const;
export const FULL_RITUALS_BY_CITY: Record<never, readonly RitualDef[]> = {};
