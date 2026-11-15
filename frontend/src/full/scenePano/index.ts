// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { HorizonSpec, S as SFn, COUNTRY as CountryT } from "../../voxel/interiors/scenePano";

export const FULL_CITY_SCENES: readonly string[] = [];
export const fullHorizons = (_S: typeof SFn, _COUNTRY: typeof CountryT): Record<string, HorizonSpec> => ({});
