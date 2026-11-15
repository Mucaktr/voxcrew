/**
 * S47 — Dünya "Görünüm" ayarları (tek kaynak). Görünüm açılır panelindeki bütün geçişler buradan okunur/yazılır:
 * - etiketler (Minimal / Üzerine gelince / Hepsi) → `voxel/props/daynight` `useLabelMode` (anahtar değişmedi)
 * - ışık (Otomatik / Gündüz / Gece) → `voxel/props/daynight` `useLightMode` (anahtar değişmedi)
 * - ortam canlılığı (açık/kapalı) → `voxel/ambient/settings` `useAmbientLife` (anahtar değişmedi)
 * - eğlenceli hareketler (Açık / Az / Kapalı) → bu dosyadaki `useFunMoments` (S48 okur)
 * - yürüme görüş açısı (50–75°, Sıfırla) → bu dosyadaki `useWalkFov` (WalkRig okur)
 * Eski anahtarlar aynen okunur; yalnızca yeni ayar yeni anahtar alır. Depolama okunamaz/yazılamazsa varsayılan kullanılır.
*/
import { create } from "zustand";
import { useAmbientLife } from "../../voxel/ambient/settings";
import { LABEL_MODES, LIGHT_MODES, useLabelMode, useLightMode, type LabelMode, type LightMode } from "../../voxel/props/daynight";
import { useWeatherFx, useWeatherMoments } from "../../voxel/props/weather";
import { clampWalkFov, WALK_FOV_DEFAULT, WALK_FOV_MAX, WALK_FOV_MIN, WALK_FOV_STEP } from "../../voxel/walk/scale";

/** SP-W0: hava durumu (açık/kapalı) → `voxel/props/weather` `useWeatherFx` (anahtar `voxcrew.world.weather`). */
export { LABEL_MODES, LIGHT_MODES, useAmbientLife, useLabelMode, useLightMode, useWeatherFx, type LabelMode, type LightMode };
/** (A5): hava anları (açık/kapalı, varsayılan açık) → `voxel/props/weather` `useWeatherMoments` (anahtar `voxcrew.world.weatherMoments`).*/
export { useWeatherMoments };

/** Eğlenceli hareketler (S48 okur): "on" = tam, "few" = seyrek/kısa, "off" = hiç. Varsayılan "on". */
export type FunLevel = "on" | "few" | "off";
export const FUN_LEVELS: FunLevel[] = ["on", "few", "off"];
const FUN_KEY = "voxcrew.world.fun";

function loadFun(): FunLevel {
  try {
    const v = window.localStorage.getItem(FUN_KEY);
    if (v === "on" || v === "few" || v === "off") return v;
    if (v === "low") return "few";
  } catch { /* gizli pencere / engelli depolama */ }
  return "on";
}

/** `useAmbientLife` ile aynı biçim: `useFunMoments((s) => s.level)`; React dışında `useFunMoments.getState().level`. */
export const useFunMoments = create<{ level: FunLevel; setLevel: (level: FunLevel) => void }>((set) => ({
  level: typeof window === "undefined" ? "on" : loadFun(),
  setLevel: (level) => {
    try { window.localStorage.setItem(FUN_KEY, level); } catch { /* yoksay */ }
    set({ level });
  },
}));

/** (K3): yürüme kamerasının görüş açısı (dikey derece, 50–75; `voxel/walk/scale.ts` `walkFov` Hor+ tabanını ekler).
 * WalkRig her karede `useWalkFov.getState.fov` okur: değişiklik yürürken anında uygulanır. Sıfırla → varsayılan (55).*/
export { WALK_FOV_DEFAULT, WALK_FOV_MAX, WALK_FOV_MIN, WALK_FOV_STEP };
const FOV_KEY = "voxcrew.world.walkFov";

function loadFov(): number {
  try {
    const v = window.localStorage.getItem(FOV_KEY);
    if (v !== null) return clampWalkFov(v);
  } catch { /* gizli pencere / engelli depolama */ }
  return WALK_FOV_DEFAULT;
}

export const useWalkFov = create<{ fov: number; setFov: (fov: number) => void; reset: () => void }>((set) => ({
  fov: typeof window === "undefined" ? WALK_FOV_DEFAULT : loadFov(),
  setFov: (fov) => {
    const v = clampWalkFov(fov);
    try { window.localStorage.setItem(FOV_KEY, String(v)); } catch { /* yoksay */ }
    set({ fov: v });
  },
  reset: () => {
    try { window.localStorage.removeItem(FOV_KEY); } catch { /* yoksay */ }
    set({ fov: WALK_FOV_DEFAULT });
  },
}));
