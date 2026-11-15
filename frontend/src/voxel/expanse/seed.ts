/**
 * EXP-GEN (E1a) — çevre arazisi tohumları.
 *
 * `worldSeed`: yerleşik sahnede `hash32("scene:" + kimlik + ":" + tuz)`, kullanıcı dünyasında dosyadaki `expanse.seed`.
 * `chunkSeed(worldSeed, cx, cz)`: parsel tohumu; mevcut `rng(seed)` (scenes.ts, mulberry32) ile kullanılır.
 * Saf modül: React/three yok; aynı girdi → aynı çıktı.
*/
export { rng, type Rng } from "../scenes";

/** Yerleşik sahne çevre tohumu tuzu. Değişirse bütün yerleşik çevreler değişir (v1 sabit). */
export const EXPANSE_SALT = "expanse-v1";

/** FNV-1a 32 bit (metin). */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < text.length; k++) {
    h ^= text.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Tam sayı karıştırıcı (murmur3 fmix32 tabanlı): sıra duyarlı, negatif koordinatla çalışır. */
export function mix32(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) {
    let k = Math.imul(x | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Yerleşik sahnenin çevre tohumu. */
export const worldSeed = (sceneId: string, salt = EXPANSE_SALT) => hash32(`scene:${sceneId}:${salt}`);

/** `scenes.ts rng` ile aynı mulberry32 dizisi, `state` alıcısı olmadan (öğe başına çağrılır; `defineProperty` maliyeti yok). */
export function prng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Parsel tohumu: `hash32(dünya tohumu, cx, cz)` (plan §6.2). */
export const chunkSeed = (seed: number, cx: number, cz: number) => mix32(seed, cx, cz);
