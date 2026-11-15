/**
 * PORTAL1 · PORTAL-APPROACH-001 (ürün sahibi 2026-11-02 "bazı portallar çok dar yerde, yürürken birden geçiyorum") — geçidin yaklaşma ölçüsü.
 * Bir geçit (sahne kapısı, "Şehre çık", otel, şehir landmark kapısı, "Ofise dön") önünde düz `APPROACH_DEEP` karo yürünür yaklaşma
 * alanı ister ve bir geçiş boğazında durmaz (karo kapatılınca yürünür komşuları `CHOKE_R` penceresinde birbirine bağlı kalır — kimse
 * başka yere gitmek için geçidin üstünden geçmek zorunda değil). Yerleştirme (`interiors/placement.ts`, `citymap/door.ts`) ve denetim
 * (`scripts/portal_approach.mjs`) aynı işlevi kullanır. Saf modül: React/three yok.
*/
export type WalkFn = (i: number, j: number) => boolean;
type T2 = readonly [number, number];

/** yaklaşma alanı derinliği (karo) ve boğaz denetimi penceresi (Chebyshev yarıçapı) */
export const APPROACH_DEEP = 2, CHOKE_R = 6;
const D4: readonly T2[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Geçidin önünde (`front`: geçitten dışarı birim adım) `deep` karo düz yürünür mü. */
export function approachClear(P: T2, front: T2, walk: WalkFn, deep = APPROACH_DEEP): boolean {
  for (let k = 1; k <= deep; k++) if (!walk(P[0] + front[0] * k, P[1] + front[1] * k)) return false;
  return true;
}

/** Geçit karosu bir geçiş boğazı mı: karo kapatılınca yürünür 4-komşularından biri ötekilerden yerel pencerede kopuyor. */
export function chokepoint(P: T2, walk: WalkFn, r = CHOKE_R): boolean {
  const nb = D4.map((d) => [P[0] + d[0], P[1] + d[1]] as T2).filter((t) => walk(t[0], t[1]));
  if (nb.length < 2) return false;
  const k = (t: T2) => `${t[0]},${t[1]}`;
  const seen = new Set([k(nb[0])]), q: T2[] = [nb[0]];
  while (q.length) {
    const t = q.pop()!;
    for (const d of D4) {
      const n: T2 = [t[0] + d[0], t[1] + d[1]];
      if ((n[0] === P[0] && n[1] === P[1]) || Math.max(Math.abs(n[0] - P[0]), Math.abs(n[1] - P[1])) > r || seen.has(k(n)) || !walk(n[0], n[1])) continue;
      seen.add(k(n)); q.push(n);
    }
  }
  return nb.some((t) => !seen.has(k(t)));
}

/** PORTAL-APPROACH-001 ihlali: yaklaşma alanı dar ya da geçit bir boğazda. */
export const portalNarrow = (P: T2, front: T2, walk: WalkFn): boolean => !approachClear(P, front, walk) || chokepoint(P, walk);
