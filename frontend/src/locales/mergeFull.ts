// Generic helper (kept in the free edition): merges the full-edition-only message keys (src/full/locale*.ts) into a dictionary.
import type { Messages } from "../lib/i18n";

export interface FullMessages { tr: Record<string, string>; en: Record<string, string> }

/** Adds keys without overwriting existing ones (same rule as voxel/cities/locales.ts mergeCityLocales). */
export function mergeFull<T extends Record<string, string>>(base: Messages<T>, add: FullMessages): Messages<T> {
  for (const lang of ["tr", "en"] as const) {
    const into = base[lang] as Record<string, string>;
    for (const [k, v] of Object.entries(add[lang])) if (!(k in into)) into[k] = v;
  }
  return base;
}
