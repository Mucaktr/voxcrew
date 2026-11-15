/**
 * "Odak görünümü" ( karar K4).
 *
 * Yürüme modu açıkken (sahne ya da şehir haritası) sayfa başlığı, yan paneller (Ekip, Canlı akış) ve bantlar (Akademi
 * bandı, İlk mesai kartı, haftalık kartlar, akademi balonları) gizlenir; geniş ekranda (lg ≥ 1024 px) dünya bölümü
 * tüm pencereyi kaplar. Kullanıcı ayarı "Yürürken sayfa panellerini gizle" (varsayılan açık) diğer Görünüm ayarlarıyla aynı
 * biçimde saklanır (localStorage, `voxcrew.world.*` anahtarı; depolama okunamaz/yazılamazsa varsayılan).
 *
 * Bu dosya saf kuralları ve ayar deposunu tutar (node testi: frontend/scripts/walk_focus.test.mjs). Bağlantı:
 * `useWalkFocus.ts` (sayfa kancası), `FocusViewRow.tsx` (Görünüm menüsü satırı), `FocusFullscreenButton.tsx` (HUD).
*/
import { create } from "zustand";

export const FOCUS_KEY = "voxcrew.world.walkFocus";
export const FOCUS_DEFAULT = true;

/** Kayıtlı değer: "0" kapalı, "1" açık; başka her şey (yok, bozuk) varsayılan. */
export function parseFocusPref(v: string | null | undefined): boolean {
  if (v === "0") return false;
  if (v === "1") return true;
  return FOCUS_DEFAULT;
}

function loadFocus(): boolean {
  try { return parseFocusPref(window.localStorage.getItem(FOCUS_KEY)); } catch { /* gizli pencere / engelli depolama */ }
  return FOCUS_DEFAULT;
}

/** `useAmbientLife` ile aynı biçim: `useWalkFocusPref((s) => s.on)`; React dışında `useWalkFocusPref.getState().on`. */
export const useWalkFocusPref = create<{ on: boolean; setOn: (on: boolean) => void }>((set) => ({
  on: typeof window === "undefined" ? FOCUS_DEFAULT : loadFocus(),
  setOn: (on) => {
    try { window.localStorage.setItem(FOCUS_KEY, on ? "1" : "0"); } catch { /* yoksay */ }
    set({ on });
  },
}));

/** Görünürlük kuralı (saf): odak görünümü yalnız yürürken ve ayar açıkken. */
export function focusActive(walkOn: boolean, pref: boolean): boolean {
  return walkOn && pref;
}

/** Sayfada neyin gizlendiği (saf; WorldPage bu tabloyu uygular). `overlay`: lg ve üstünde bölüm pencereyi kaplar. */
export interface FocusRules { header: boolean; banners: boolean; sidePanels: boolean; belowCards: boolean; overlay: boolean; sidebarInert: boolean }
export function focusRules(walkOn: boolean, pref: boolean, wide: boolean): FocusRules {
  const on = focusActive(walkOn, pref);
  return { header: on, banners: on, sidePanels: on, belowCards: on, overlay: on && wide, sidebarInert: on && wide };
}

/**
 * Esc önceliği (saf). Sıra: başka bir işleyici olayı işlediyse (preventDefault: dünya kabının yürüme klavyesi, panel,
 * Kısayollar kartı, fotoğraf modu, bilgi kartı) hiçbir şey; yazı alanı; açık kipli pencere (ritüel kitabı, Görev ver,
 * Görünüm menüsü dışı her `aria-modal`); açık bilgi kartı; şehir pasaportu / hızlı seyahat; tarayıcı tam ekranı (Esc'yi
 * tarayıcı kullanır) → hiçbir şey. Sonra yürüme deposunun kendi sırası: fotoğraf / emote çarkı / panel açıksa "close"
 * (yalnız onu kapatır), yoksa "exit" (moddan çık, odak dünyaya döner).
 */
export interface EscContext {
  key: string; repeat: boolean; defaultPrevented: boolean; walkActive: boolean; typing: boolean; modalOpen: boolean;
  infoOpen: boolean; cityOverlay: boolean; fullscreen: boolean; photo: boolean; emoteWheel: boolean; panel: boolean;
}
export type EscAction = "none" | "close" | "exit";
export function focusEscape(c: EscContext): EscAction {
  if (c.key !== "Escape" || c.repeat || c.defaultPrevented || !c.walkActive) return "none";
  if (c.typing || c.modalOpen || c.infoOpen || c.cityOverlay || c.fullscreen) return "none";
  if (c.photo || c.emoteWheel || c.panel) return "close";
  return "exit";
}
