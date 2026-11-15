/**
 * UIUX-OVERLAP — yürüme HUD'unun yerleşim bölgeleri (ayrılmış alanlar).
 *
 * WalkHud dünya bölümünü üç satırlık bir ızgaraya böler (üst · orta · alt) ve her satırda adlandırılmış yuvalar açar.
 * HUD'un başka yerlerde çizilen parçaları (görev izleyici, keşif izleyicisi, yapı düğmesi/paneli, tostlar, POI notu)
 * kendi mutlak konumlarını tutmak yerine `InHudZone` ile bu yuvalara portallanır: aynı akışta (flex) dizildikleri için
 * üst çubuk iki satıra sarılsa, bir panel açılsa ya da bölüm daralsa da birbirlerinin üstüne binemezler.
 *
 * top üst çubuk (sol: Çık + konum çipleri; sağ: eylemler) · ipucu satırı · alt-üst satır
 * under üst çubuğun altındaki satır, başlangıç tarafı (görev izleyici, bilgi kartı çipi); bitiş tarafını
 * Yakındakiler kullanır
 * actions eylem yuvası: ince işaretçide üst çubuğun sağ bölgesi (kamera, Ben, emote …), dokunmatikte sağ alttaki eylem
 * kümesi (Zıpla, emote, Etkileşim). Fotoğraf düğmesi buradadır; dar dokunmatikte üst çubuk kısa kalır.
 * middle orta alan, üste yaslı ve ortalı (tostlar, keşif notu; UX-P2: avatar 3B görünümün ortasında açık kalır — dar
 * bölümde tek bildirim boyu). CITY-HUD: en çok `--hud-mid-max` yüksekliğinde; içerik
 * sığmazsa yuva kendi içinde kayar (kırpmaz) ve en yeni bildirim görünür kalır; içerik varken ızgara satırı
 * en az bir tost yüksekliği ayırır (kapatma düğmeleri hep erişilebilir).
 * dock alt satırın üstünde, mini harita sütunu dışında (yapı paneli)
 * corner alt satır, sol (keşif izleyicisi)
 * cornerEnd alt satır, sol, köşenin hemen altında (İnşa düğmesi ve notu)
 *
 * Yuvalar DOM sırasıyla görsel sırayı korur (odak sırası = görünüm). Yuva yoksa (fotoğraf modu, yürüme kapalı) içerik
 * çizilmez: HUD gizliyken bu parçalar da gizlidir.
*/
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { walkRuntime } from "../../../voxel/walk/walkStore";

export type HudZone = "under" | "middle" | "dock" | "corner" | "cornerEnd" | "actions";

const zones = new Map<HudZone, HTMLElement>();
const subs = new Set<() => void>();
const refs = new Map<HudZone, (el: HTMLElement | null) => void>();

/** Kararlı ref geri çağrısı: yuva öğesini kaydeder (söküldüğünde siler) ve dinleyenleri uyandırır. */
export function hudZoneRef(zone: HudZone): (el: HTMLElement | null) => void {
  let r = refs.get(zone);
  if (!r) {
    r = (el) => {
      if (el) zones.set(zone, el);
      else zones.delete(zone);
      for (const f of subs) f();
    };
    refs.set(zone, r);
  }
  return r;
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function useHudZone(zone: HudZone): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => zones.get(zone) ?? null, () => null);
}

/** Çocukları adlandırılmış HUD yuvasına portallar; yuva yoksa hiçbir şey çizmez. */
export function InHudZone({ zone, children }: { zone: HudZone; children: ReactNode }) {
  const el = useHudZone(zone);
  return el ? createPortal(children, el) : null;
}

/**
 * CITY-HUD: kayan yuvada en yeni içerik (sona eklenen tost/not) görünür kalsın — yuvaya öğe eklenip çıkınca ya da yuva
 * boyutu değişince sona kaydırır. Animasyon yok (hareket azaltmaya uygun).
 */
export function useHudZoneFollowEnd(zone: HudZone) {
  const el = useHudZone(zone);
  useEffect(() => {
    if (!el) return;
    const pin = () => { el.scrollTop = el.scrollHeight; };
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(pin);
    mo?.observe(el, { childList: true, subtree: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(pin);
    ro?.observe(el);
    pin();
    return () => { mo?.disconnect(); ro?.disconnect(); };
  }, [el]);
}

/** CITY-HUD: yuvada görünür içerik var mı (yükseklik > 0)? Izgara, dolu orta yuvaya en az bir tost yüksekliği ayırır.
 * `ignore` seçicisine uyan doğrudan çocuklar (ör. tek satır durak çipi `[data-dock-chip]`) sayılmaz.*/
export function useHudZoneFilled(zone: HudZone, ignore?: string): boolean {
  const el = useHudZone(zone);
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (!el) { setFilled(false); return; }
    const check = () => setFilled(el.scrollHeight > 0 && [...el.children].some((c) => c.getBoundingClientRect().height > 0 && !(ignore && c.matches(ignore))));
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(check);
    mo?.observe(el, { childList: true, subtree: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    ro?.observe(el);
    check();
    return () => { mo?.disconnect(); ro?.disconnect(); };
  }, [el, ignore]);
  return filled;
}

/** ( ikinci yarı): sabit toast, avatarın "Ben" etiketini örtmesin. Önce dikey: yuvanın alt kenarı etiketin üstünde kalsın diye
 * `--hud-mid-cap` (px) yazılır (yuva zaten kayar; en yeni bildirim görünür). Etiketin üstünde `min` px yer yoksa (yatay telefon, uzun
 * görev paneli) yuva etiketin yanına daralır: sola ya da sağa, en az `SIDE_MIN` px kalan yana. Etiket yoksa her şey kaldırılır.*/
const SIDE_MIN = 224;
export function useHudZoneAvoidLabel(zone: HudZone, min = 56) {
  const el = useHudZone(zone);
  useEffect(() => {
    if (!el) return;
    const reset = () => { el.style.removeProperty("--hud-mid-cap"); el.style.width = ""; el.style.justifySelf = ""; };
    const tick = () => {
      const l = walkRuntime.meLabel, cv = el.closest("section")?.querySelector("canvas"), g = el.parentElement;
      if (!l || !cv || !g || !el.firstElementChild) { reset(); return; }
      const c = cv.getBoundingClientRect(), z = el.getBoundingClientRect(), gr = g.getBoundingClientRect(), gs = getComputedStyle(g);
      const free = Math.floor(l[1] + c.top - z.top - 6);
      if (free >= min) { el.style.setProperty("--hud-mid-cap", `${free}px`); el.style.width = ""; el.style.justifySelf = ""; return; }
      el.style.removeProperty("--hud-mid-cap");
      const left = gr.left + parseFloat(gs.paddingLeft), right = gr.right - parseFloat(gs.paddingRight);
      const lw = Math.floor(l[0] + c.left - left - 8), rw = Math.floor(right - (l[2] + c.left) - 8);
      if (Math.max(lw, rw) < SIDE_MIN) { el.style.width = ""; el.style.justifySelf = ""; return; }
      el.style.width = `${Math.max(lw, rw)}px`; el.style.justifySelf = lw >= rw ? "start" : "end";
    };
    const id = window.setInterval(tick, 100);
    tick();
    return () => { window.clearInterval(id); reset(); };
  }, [el, min]);
}
