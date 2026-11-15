/**
 * S43 — "Ortam canlılığı" tercihi (Dünya araçları): kuşlar, kediler, martılar, yunuslar… açık/kapalı. Varsayılan açık;
 * tercih yalnızca bu tarayıcıda (localStorage) tutulur; okunamazsa/yazılamazsa varsayılan kullanılır.
 */
import { create } from "zustand";

const KEY = "voxcrew.world.ambient";

function load(): boolean {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "off") return false;
  } catch { /* gizli pencere / engelli depolama */ }
  return true;
}

export const useAmbientLife = create<{ on: boolean; setOn: (on: boolean) => void }>((set) => ({
  on: typeof window === "undefined" ? true : load(),
  setOn: (on) => {
    try { window.localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* yoksay */ }
    set({ on });
  },
}));
