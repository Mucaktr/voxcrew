// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
import type { Rule } from "../../voxel/rules/registry";
import type { WorldSceneId } from "../../voxel/scenes";

export const FULL_RULE_CITY_SCENES: WorldSceneId[] = ["istanbul", "londra", "kapadokya"];
export const FULL_PREMIUM_SCENES: WorldSceneId[] = [];
export const FULL_NO_FLAME_SCENES: WorldSceneId[] = [];
export const FULL_OUTDOOR_DEVICE_SCENES: WorldSceneId[] = [];
export const FULL_CITY_WORK_OWN: readonly string[] = [];
export const fullRules = (_R: (r: Omit<Rule, "version" | "origin"> & Partial<Pick<Rule, "version" | "origin">>) => Rule, _SUITE: string[]): { a: Rule[]; b: Rule[] } => ({ a: [], b: [] });
