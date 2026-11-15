/**
 * tema tercihi tek yerde: Sistem / Açık / Koyu. Kaynak `<html data-theme>` (yok = sistem) ve `hs-theme`
 * yerel kaydı (`main.tsx` açılışta okur). Yan menü anahtarı (`App.tsx ThemeToggle`) ve Ayarlar › Görünüm aynı işlevleri kullanır;
 * ikisi de `data-theme` değişimini izler, biri değişince öbürü güncellenir.
*/
import { useSyncExternalStore } from "react";

export type ThemePref = "system" | "light" | "dark";
export const THEME_KEY = "hs-theme";
export const THEME_PREFS: readonly ThemePref[] = ["system", "light", "dark"];

export function readTheme(): ThemePref {
  const v = typeof document === "undefined" ? undefined : document.documentElement.dataset.theme;
  return v === "light" || v === "dark" ? v : "system";
}

/** Yan menü anahtarının döngüsü: sistem → açık → koyu → sistem. */
export const nextTheme = (cur: ThemePref): ThemePref => (cur === "system" ? "light" : cur === "light" ? "dark" : "system");

export function applyTheme(pref: ThemePref): void {
  if (typeof document === "undefined") return;
  if (pref === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* özel pencere: yalnız oturumda */ }
}

function subscribe(cb: () => void): () => void {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
/** Geçerli tema tercihi; `data-theme` değişince yeniden çizer. */
export const useThemePref = (): ThemePref => useSyncExternalStore(subscribe, readTheme, () => "system" as ThemePref);
