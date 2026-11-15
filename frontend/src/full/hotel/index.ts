// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { HotelSpec } from "../../voxel/districts/hotel";

export const fullHotelSpecs = (_LIT: string): Record<string, HotelSpec> => ({});
export const fullLodgeSpecs = (_LIT: string): Record<string, HotelSpec> => ({});
