// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
type Gates = Readonly<Record<string, readonly (readonly [number, number])[]>>;
export const FULL_MAP_GATES: Gates = {};
export const FULL_SCENE_GATES: Gates = {};
