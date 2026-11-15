/** Mini harita sınır yardımcıları (saf; `MiniMap.tsx` ve `scripts/walk_w5.test.mjs` kullanır). */
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * W5 (E1b açığı): yürüme modunda avatar harita sınırının dışındaysa (çevre arazisi) sınır avatarı `AVATAR_PAD` payıyla
 * kapsayacak kadar, `AVATAR_STEP` birimlik adımlarla genişler. Adımlı olduğu için durağan katman her karede değil, yalnız
 * avatar yeni bir adıma geçince yeniden çizilir. İçerideyse aynı nesne döner.
 */
const AVATAR_PAD = 3, AVATAR_STEP = 8;
export function withAvatar<B extends Bounds>(b: B, me: { x: number; z: number } | null): B {
  if (!me || !Number.isFinite(me.x) || !Number.isFinite(me.z)) return b;
  const P = AVATAR_PAD, Q = AVATAR_STEP;
  if (me.x - P >= b.minX && me.x + P <= b.maxX && me.z - P >= b.minZ && me.z + P <= b.maxZ) return b;
  return {
    ...b,
    minX: Math.min(b.minX, Math.floor((me.x - P) / Q) * Q), maxX: Math.max(b.maxX, Math.ceil((me.x + P) / Q) * Q),
    minZ: Math.min(b.minZ, Math.floor((me.z - P) / Q) * Q), maxZ: Math.max(b.maxZ, Math.ceil((me.z + P) / Q) * Q),
  };
}
