// FREE fallback of the sibling full-edition aggregator (the full edition resolves <name>.ts before <name>/index.ts).
export const CABLE_PERIOD = 20; // unused without cable cars
export const FULL_CABLES: Readonly<Record<string, { board: readonly [number, number] }>> = {};
