// EDITION1 — free sürüm eşi: tam sürüme özgü sahne yok. Tam sürümde üst klasördeki full/scenes.ts önce çözülür.
import type { SceneCore, SceneDef, Built } from "../../voxel/scenes";
import type { CityStyle } from "../../voxel/city/style";

export type FullSceneId = never;
export interface SceneKit {
  scene: (d: Omit<SceneDef, "label" | "hint">) => SceneDef;
  grounded: (build: () => Built, style: () => CityStyle, sky: string, dusty?: boolean) => () => Built;
  groundedAs: (build: () => Built, land: string, under: string, sky: string) => () => Built;
  core: SceneCore;
}
export const FULL_SCENE_KEYS: readonly string[] = [];
export const FULL_PICKER_ORDER: readonly string[] = [];
export const FULL_CITY_SCENES: readonly string[] = [];
export function fullScenes(_k: SceneKit): Record<FullSceneId, SceneDef> {
  return {};
}
