// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { PanoPalette, PanoRecipe, SideSpec } from "../../voxel/interiors/cityPano";

export const fullCityPano = (_CITY: SideSpec): { palettes: Record<string, PanoPalette>; defaults: Record<string, PanoRecipe>; recipes: Record<string, PanoRecipe> } => ({ palettes: {}, defaults: {}, recipes: {} });
