/**
 * Hareket azaltma tercihi (`prefers-reduced-motion`). three.js döngüleri (useFrame) her karede
 * `reducedMotion()` ile ucuzca okur; React bileşenleri `useReducedMotion()` ile değişime abone olur.
 */
import { useSyncExternalStore } from "react";

const query = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
let reduced = query?.matches ?? false;
const subs = new Set<() => void>();

query?.addEventListener?.("change", (e) => {
  reduced = e.matches;
  subs.forEach((fn) => fn());
});

/** useFrame içinde kullanılır: abonelik yok, yalnızca güncel değer. */
export function reducedMotion(): boolean {
  return reduced;
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reduced, () => false);
}
