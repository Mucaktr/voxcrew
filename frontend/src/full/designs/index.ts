// FREE fallback for full/designs.ts (the full aggregator shadows this file; keep export names/types identical).
import type { CityDesign } from "../../voxel/citymap/design";

export const withFullDesigns = (k: Readonly<Record<string, CityDesign>>): Record<string, CityDesign> => ({ ...k });
