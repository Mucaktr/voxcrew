// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { Theme } from "../../voxel/districts/themes";
import type { withHotel } from "../../voxel/districts/hotel";
import type { groundRest } from "../../voxel/districts/city";

export interface FullThemeLib { withHotel: typeof withHotel; groundRest: typeof groundRest }
export function fullPilotThemes(_lib: FullThemeLib): Record<string, Theme> { return {}; }
