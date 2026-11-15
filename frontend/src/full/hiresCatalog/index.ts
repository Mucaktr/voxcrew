// FREE fallback for full/hiresCatalog.ts (the full aggregator shadows this file; keep export names/types identical).
import type { HiResMapEntry, HiResSceneEntry } from "../../voxel/hires/types";

export const withFullHiresMap = (k: { istanbul: readonly HiResMapEntry[]; londra: readonly HiResMapEntry[]; kapadokya: readonly HiResMapEntry[] }): readonly HiResMapEntry[] => [...k.istanbul, ...k.londra, ...k.kapadokya];
export const withFullHiresScene = (k: { istanbul: readonly HiResSceneEntry[]; londra: readonly HiResSceneEntry[]; kapadokya: readonly HiResSceneEntry[] }): readonly HiResSceneEntry[] => [...k.istanbul, ...k.londra, ...k.kapadokya];
