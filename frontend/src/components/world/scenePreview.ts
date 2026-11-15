/**
 * SP-W0 — kilitli sahne önizlemesi ( "Kilitli önizleme"): sahne seçicideki "Önizle"
 * kilitli sahneyi 20 sn gösterir (kamera yavaşça döner; hareket azaltmada durağan). Sahne ayarı DEĞİŞMEZ ve kaydedilmez,
 * oyun sayaçları (sahneye bağlı ödüller) önizlemeyi görmez — yalnız World.tsx'in çizdiği sahne geçici olarak değişir.
*/
import { create } from "zustand";

export const PREVIEW_MS = 20_000;

interface PreviewState {
  id: string | null;
  until: number;
  start: (id: string) => void;
  stop: () => void;
}

let timer: number | undefined;
export const useScenePreview = create<PreviewState>((set) => ({
  id: null,
  until: 0,
  start: (id) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => set({ id: null, until: 0 }), PREVIEW_MS);
    set({ id, until: Date.now() + PREVIEW_MS });
  },
  stop: () => { window.clearTimeout(timer); set({ id: null, until: 0 }); },
}));
