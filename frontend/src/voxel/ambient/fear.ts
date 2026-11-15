/**
 * FEAR — avatarın yaklaşmasına ortam hayvanlarının tepkisi (saf TypeScript; three/React yok). Ambient.tsx her karede `setFear` ile
 * avatarın konumunu yazar; hayvanlar `fearAt` ile "korkutucu yakında mı" diye sorar (ajanların doluluk ızgarası ayrıdır).
 * Hareket azaltmada döngü durağan olduğundan hiç yazılmaz (kapalı kalır). `scripts/interact_all.test.mjs` türlere göre denetler:
 * güvercin kısa bir yay çizip uçar ve başka yere konar, ördek/balık sudan uzaklaşır, kuş/martı havalanır, sincap ağaca çıkar,
 * kedi/köpek kenara çekilir.
 */

export interface Fear { on: boolean; x: number; z: number; r: number }
export const FEAR: Fear = { on: false, x: 0, z: 0, r: 1.8 };

/** Korku yarıçapı (dünya birimi): yürüme ölçeğinde (insan küçülünce) orantılı, ama 1,1 altına inmez. */
export function fearRadius(humanScale: number): number {
  return 2.0 * Math.max(0.55, Math.min(1, humanScale));
}

/** Avatar konumu (null: yok / gizli / hareket azaltma) → bu karenin korkutucusu. */
export function setFear(p: { x: number; z: number } | null, humanScale = 1): void {
  if (!p) { FEAR.on = false; return; }
  FEAR.on = true; FEAR.x = p.x; FEAR.z = p.z; FEAR.r = fearRadius(humanScale);
}

/** (x, z) korkutucunun `k` × yarıçapı içinde mi? Evetse korkutucunun konumu. */
export function fearAt(x: number, z: number, k = 1): [number, number] | null {
  if (!FEAR.on) return null;
  return Math.hypot(x - FEAR.x, z - FEAR.z) < FEAR.r * k ? [FEAR.x, FEAR.z] : null;
}

/** Yayın süresi (sn): `d` birimlik atlayış. */
export const hopDuration = (d: number) => 0.4 + d / 4.5;
/** Yay yüksekliği (birim): u ∈ [0, 1]. */
export const hopLift = (u: number) => 1.35 * Math.sin(Math.PI * Math.max(0, Math.min(1, u)));

/**
 * Kaçış hedefi: korkutucudan uzağa 3 – 6 birim, ±0,9 rad sapmalı; `ok(x, z)` yürünebilir/boş mu. Bulunamazsa null.
 * `rnd` [0, 1) üreteci (testte belirlenimci).
 */
export function hopTarget(x: number, z: number, fx: number, fz: number, ok: (x: number, z: number) => boolean, rnd: () => number = Math.random): [number, number] | null {
  const base = Math.atan2(x - fx, z - fz);
  for (const dist of [5.5, 4.2, 3.2]) {
    for (let k = 0; k < 6; k++) {
      const ang = base + (rnd() - 0.5) * 1.8, d = dist * (0.85 + rnd() * 0.3);
      const gx = x + Math.sin(ang) * d, gz = z + Math.cos(ang) * d;
      if (ok(gx, gz) && Math.hypot(gx - fx, gz - fz) > FEAR.r + 1) return [gx, gz];
    }
  }
  return null;
}

/** Su üstünde kaçış: `tiles` (dünya x/z) içinden korkutucudan en uzak, ≤ `maxD` yakınlıktaki nokta. */
export function paddleTarget(x: number, z: number, fx: number, fz: number, tiles: readonly [number, number][], maxD: number, rnd: () => number = Math.random): [number, number] | null {
  let best: [number, number] | null = null, bd = Math.hypot(x - fx, z - fz);
  for (let k = 0; k < 10 && tiles.length; k++) {
    const t = tiles[Math.floor(rnd() * tiles.length)];
    if (Math.hypot(t[0] - x, t[1] - z) > maxD) continue;
    const d = Math.hypot(t[0] - fx, t[1] - fz);
    if (d > bd + 0.5) { bd = d; best = t; }
  }
  return best;
}
