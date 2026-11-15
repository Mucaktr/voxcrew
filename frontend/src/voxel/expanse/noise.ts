/**
 * EXP-GEN (E1a) — bağımlılıksız, tohumlu 2B değer gürültüsü (plan §6.2: biyom öğe yoğunluğu ve zemin lekeleri parseller
 * arasında yumuşak geçsin). Koordinat taban karosudur (mutlak), bu yüzden komşu parseller kenarda aynı değeri görür.
 */
import { mix32 } from "./seed";

const lattice = (seed: number, x: number, z: number) => mix32(seed, x, z) / 4294967296;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** [0, 1) değer gürültüsü; `scale` karo cinsinden hücre boyu. */
export function valueNoise(seed: number, x: number, z: number, scale: number): number {
  const fx = x / scale, fz = z / scale;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = smooth(fx - x0), tz = smooth(fz - z0);
  const a = lattice(seed, x0, z0), b = lattice(seed, x0 + 1, z0);
  const c = lattice(seed, x0, z0 + 1), d = lattice(seed, x0 + 1, z0 + 1);
  return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
}

/** İki oktav (ana + 1/2 ölçek, 2/3 + 1/3 ağırlık); [0, 1). */
export function fbm(seed: number, x: number, z: number, scale: number): number {
  return valueNoise(seed, x, z, scale) * 0.667 + valueNoise(seed ^ 0x5bd1e995, x, z, scale / 2) * 0.333;
}
