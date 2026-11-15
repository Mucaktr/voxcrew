/**
 * E3 (BUILD-UX) — geri al / yinele (`lib/builder.ts` deseni: değişmez anlık görüntüler).
 * Gövdeler değişmez olduğundan anlık görüntü ucuzdur (iç diziler paylaşılır). Yığın ≤ 200 adım. Saf modül.
*/
import { MAX_HISTORY, type PlotBody } from "./catalog";

export interface History {
  past: readonly PlotBody[];
  future: readonly PlotBody[];
}
export const EMPTY_HISTORY: History = { past: [], future: [] };

/** `cur`'dan `next`'e geçiş: geçmişe ekle, ileriyi sil. */
export function commit(h: History, cur: PlotBody): History {
  const past = h.past.length >= MAX_HISTORY ? h.past.slice(h.past.length - MAX_HISTORY + 1) : h.past;
  return { past: [...past, cur], future: [] };
}

export function undo(h: History, cur: PlotBody): { h: History; body: PlotBody } | null {
  if (!h.past.length) return null;
  const body = h.past[h.past.length - 1];
  return { h: { past: h.past.slice(0, -1), future: [cur, ...h.future] }, body };
}

export function redo(h: History, cur: PlotBody): { h: History; body: PlotBody } | null {
  if (!h.future.length) return null;
  const [body, ...rest] = h.future;
  return { h: { past: [...h.past, cur], future: rest }, body };
}

/** İki gövde aynı mı (kaydedilmemiş değişiklik denetimi; sıra önemli değil). */
export function sameBody(a: PlotBody, b: PlotBody): boolean {
  if (a === b) return true;
  if (a.edits.length !== b.edits.length || a.prefabs.length !== b.prefabs.length) return false;
  const ka = a.edits.map((e) => e.join(",")).sort(), kb = b.edits.map((e) => e.join(",")).sort();
  if (ka.some((k, n) => k !== kb[n])) return false;
  const pa = a.prefabs.map((p) => JSON.stringify(p)).sort(), pb = b.prefabs.map((p) => JSON.stringify(p)).sort();
  return pa.every((k, n) => k === pb[n]);
}
