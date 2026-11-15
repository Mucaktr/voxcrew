// kullanıcının işi sayılmayan koşular: değerlendirme (`eval:`), hakem (`review:`), sistem (`system:`),
// gizli ya da mühürlü koşu. Dünya'daki "Son çalıştırmalar" ve iş sayaçları bunları göstermez/saymaz
// (sunucu tarafı eşi: `studio.game.spotlight.is_system_run`). Saf modül: `node --test scripts/qa19_fix.test.mjs`.

export const SYSTEM_ORIGINS = ["eval:", "review:", "system:"] as const;

export interface RunLike {
  origin?: string | null;
  hidden?: boolean | null;
  sealed?: boolean | null;
}

export function isSystemRun(r: RunLike | null | undefined): boolean {
  if (!r) return false;
  if (r.hidden || r.sealed) return true;
  const o = typeof r.origin === "string" ? r.origin : "";
  return SYSTEM_ORIGINS.some((p) => o.startsWith(p));
}

/** Yalnız kullanıcının işleri (sıra korunur). */
export function userRuns<T extends RunLike>(runs: readonly T[]): T[] {
  return runs.filter((r) => !isSystemRun(r));
}
