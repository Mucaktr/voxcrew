/**
 * S33 — gündüz/gece ışık modu. "Otomatik" yerel saati izler (19.00–07.00 gece); kullanıcı Dünya araçlarından gündüz ya
 * da geceye sabitleyebilir. Tercih yalnızca bu tarayıcıda (localStorage) tutulur; okunamazsa "otomatik" kabul edilir.
 * Gece: ortam ışığı kısılır, masa/ayaklı lambalar ve çalışan ekranlar odayı aydınlatır (voxel/props/Props.tsx).
 */
import { useEffect, useState } from "react";
import { create } from "zustand";

export type LightMode = "auto" | "day" | "night";
export const LIGHT_MODES: LightMode[] = ["auto", "day", "night"];
const KEY = "voxcrew.world.light";

function load(): LightMode {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "auto" || v === "day" || v === "night") return v;
  } catch { /* gizli pencere / engelli depolama */ }
  return "auto";
}

export const useLightMode = create<{ mode: LightMode; setMode: (m: LightMode) => void }>((set) => ({
  mode: typeof window === "undefined" ? "auto" : load(),
  setMode: (mode) => {
    try { window.localStorage.setItem(KEY, mode); } catch { /* yoksay */ }
    set({ mode });
  },
}));

export const isNightHour = (d = new Date()) => { const h = d.getHours(); return h >= 19 || h < 7; };

/** Etkin gece mi: mod + (otomatikte) yerel saat; dakikada bir yeniden bakılır. */
export function useNight(): boolean {
  const mode = useLightMode((s) => s.mode);
  const [hourNight, setHourNight] = useState(isNightHour);
  useEffect(() => {
    if (mode !== "auto") return;
    setHourNight(isNightHour());
    const id = window.setInterval(() => setHourNight(isNightHour()), 60_000);
    return () => window.clearInterval(id);
  }, [mode]);
  return mode === "night" || (mode === "auto" && hourNight);
}

// ------------------------------------------------------------------ etiket yoğunluğu (S33, kullanıcı geri bildirimi)
/** minimal: yalnızca durum rozetleri (seçili, seni bekleyen ve odaktaki ekip yine tam etiket alır) ·
 *  hover: minimal + üzerine gelinen ajan (varsayılan) · all: herkes, ekran alanında çakışmasız yerleşimle. */
export type LabelMode = "minimal" | "hover" | "all";
export const LABEL_MODES: LabelMode[] = ["minimal", "hover", "all"];
const LABEL_KEY = "voxcrew.world.labels";

function loadLabels(): LabelMode {
  try {
    const v = window.localStorage.getItem(LABEL_KEY);
    if (v === "minimal" || v === "hover" || v === "all") return v;
  } catch { /* gizli pencere / engelli depolama */ }
  return "hover";
}

export const useLabelMode = create<{ mode: LabelMode; setMode: (m: LabelMode) => void }>((set) => ({
  mode: typeof window === "undefined" ? "hover" : loadLabels(),
  setMode: (mode) => {
    try { window.localStorage.setItem(LABEL_KEY, mode); } catch { /* yoksay */ }
    set({ mode });
  },
}));
