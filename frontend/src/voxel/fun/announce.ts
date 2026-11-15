/**
 * S48 — ortam tepkisi duyurusu: ekranda tıklanan öğenin üstünde kısa bir etiket ("Kedi mırladı") ve ekran okuyucu için
 * görünmez, kibar (polite) bir canlı bölge. Canlı bölge en çok 1,2 sn'de bir güncellenir (aradaki duyurulardan yalnızca son
 * kalan okunur); odak almaz, klavye sırasını değiştirmez.
 */
import { create } from "zustand";

export interface Said { text: string; x: number; y: number; z: number; at: number }

/** Görünür etiket (Ambient.tsx `ReactionTag` okur). */
export const useSaid = create<{ said: Said | null }>(() => ({ said: null }));

let region: HTMLDivElement | null = null;
let lastAt = 0;
let pending: string | null = null;
let timer: number | null = null;
let clearTimer: number | null = null;
/** okunmuş ritüel/tepki cümlesi canlı bölgede dakikalarca kalmasın; araya yeni cümle girmediyse bu süre sonra bölge boşalır.*/
export const SAID_CLEAR_MS = 8000;

function liveRegion(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  if (region && region.isConnected) return region;
  region = document.createElement("div");
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  region.dataset.voxcrew = "ambient-live";
  Object.assign(region.style, { position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: "0", overflow: "hidden",
    clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: "0" });
  document.body.appendChild(region);
  return region;
}

function flush() {
  timer = null;
  const r = liveRegion();
  if (!r || pending == null) return;
  r.textContent = pending;
  pending = null;
  lastAt = performance.now();
  if (clearTimer != null) window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    clearTimer = null;
    if (pending == null && region && region.isConnected) region.textContent = "";
  }, SAID_CLEAR_MS);
}

/** UXF-E: sahne değişince / yürüme kapanınca eski ritüel ve tepki cümlesi canlı bölgede kalmaz (yeniden okunmasın).*/
export function clearSaid() {
  if (timer != null) { window.clearTimeout(timer); timer = null; }
  if (clearTimer != null) { window.clearTimeout(clearTimer); clearTimer = null; }
  pending = null;
  if (region && region.isConnected) region.textContent = "";
  useSaid.setState({ said: null });
}

/** Tepkiyi duyurur: etiketi dünyadaki konuma koyar, canlı bölgeyi (sınırlı hızla) günceller. */
export function say(text: string, x: number, y: number, z: number) {
  useSaid.setState({ said: { text, x, y, z, at: Date.now() } });
  pending = text;
  const wait = 1200 - (performance.now() - lastAt);
  if (wait <= 0) flush();
  else if (timer == null) timer = window.setTimeout(flush, wait);
}
