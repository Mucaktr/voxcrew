/**
 * EXP-GEN (E1a) — çevre arazisi üreteci ( sonuçları). Saf TypeScript; React/three yok.
 *
 * const ctx = expanseContext(sceneDef(id), buildWorld(id, n, demand), { radius, base: buildWorld(id, 0) });
 * for (const { cx, cz } of openParcels(ctx)) generateParcel(ctx, cx, cz); // taban çerçevesi; dünya = + ctx.origin
 *
 * Akış (halkalar, histerezis, LRU, kuyruk yuvaları): `stream.ts` (E1b, EXP-STREAM). Çizim (`tail.ts`, `Outskirts.tsx`) three/React
 * kullandığı için buradan dışa verilmez.
*/
export * from "./biomes";
export * from "./context";
export * from "./generate";
export * from "./grid";
export * from "./stream";
export { chunkSeed, EXPANSE_SALT, hash32, worldSeed } from "./seed";
