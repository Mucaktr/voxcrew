// FREE fallback of full/ambient.ts (the full edition resolves full/ambient.ts first).
import type { Kind } from "../../voxel/ambient/kinds";
import type { SkyShow } from "../../voxel/fun/fx";

type Profile = Partial<Record<Kind, number>>;
export const FULL_AMBIENT_DAY: Record<string, Profile> = {};
export const FULL_AMBIENT_NIGHT: Record<string, Profile> = {};
export const FULL_SKY_SHOWS: readonly { kit: string; show: SkyShow & { tag: string; i0: number; j0: number; w: number; d: number } }[] = [];
