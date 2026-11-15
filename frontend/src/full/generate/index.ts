// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { GardenCourtSpec, GalleryTheme, Recipe, SkyTheme } from "../../voxel/interiors/generate";
import type { SiteKind } from "../../voxel/interiors/catalog";
import type { TerraceAccess } from "../../voxel/interiors/generate";

type Entry = { kind: SiteKind; recipe: Recipe };
/** Recipes defined inside interiors/generate.ts, passed in lazily (they are consts there; importing them here would be a module-init cycle). */
export interface FullRecipeLib {
  r: Record<string, Recipe>;
  museum(wall: string, floor: [string, string]): Recipe;
  marbleFloor: [string, string];
}
export interface FullCourtLib { gardenCourt(s: GardenCourtSpec, body: never): Recipe; CM: number }

export const fullCityRecipes = (_L: FullRecipeLib): { cityin1: Record<string, Entry>; city: Record<string, Entry> } => ({ cityin1: {}, city: {} });
export const fullCourtRecipes = (_L: FullCourtLib): Record<string, Recipe> => ({});
export const fullSceneTower = (_scene: string): Recipe | null => null;
export const fullLattice: ((c: { iron: string; trim: string; switchback?: boolean }) => Recipe) | null = null;
export const fullHotelLobbies = (): Record<string, Recipe> => ({});
export const FULL_GALLERY_CITY: Record<string, Pick<GalleryTheme, "wall" | "stone" | "wood" | "ring" | "trim" | "accent">> = {};
export const FULL_GALLERY_ORDER: readonly string[] = ["istanbul/galata_kulesi"];
export const FULL_MODERN_THEMES: Record<string, SkyTheme> = {};
export const FULL_TERRACE_ACCESS: Record<string, TerraceAccess> = {};
export const fullRecipeDefs = (): Record<string, Recipe> => ({});
