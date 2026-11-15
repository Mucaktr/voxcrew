// FREE fallback for full/arrivalKit.ts (the full aggregator shadows this file; keep export names/types identical).
import type { ArrivalKit, ItemDef } from "../../voxel/citymap/arrivalKit";

export type ArrivalKitHelpers = Pick<typeof import("../../voxel/citymap/arrivalKit"), "tree" | "palm" | "stall" | "half" | "taper" | "IRON" | "DGREEN" | "DWOOD" | "LEAF" | "DLEAF" | "GLOW_W">;
export const withFullArrivalKitItems = (k: Readonly<Record<string, ItemDef>>, _h: ArrivalKitHelpers): Record<string, ItemDef> => ({ ...k });
export const withFullArrivalKits = (k: Readonly<Record<string, ArrivalKit>>): Record<string, ArrivalKit> => ({ ...k });
