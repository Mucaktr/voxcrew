/**
 * UXF-G — yürüme modunda Esc yığını. Esc önce EN ÜSTTEKİ açık paneli kapatır; yalnız hiçbir panel açık değilken
 * (ikinci Esc) yürüme modundan çıkar (C5 kuralı). Keşif izleyicisi (K) ve Şehir rehberi gibi depoya (`walkStore.panel`) bağlı
 * olmayan yüzeyler `useEscLayer` ile buraya kaydolur; Bilgi kartı, Konuş paneli, fotoğraf modu, emote çarkı, şehir pasaportu /
 * hızlı seyahat ve mini oyun kendi Esc'lerini korur (bunlar açıkken yığın geri durur).
 *
 * Bu dosya saf kuralları (`escDecision`) ve yığını tutar (node testi: frontend/scripts/uxg_esc_stack.test.mjs); React bağlantısı
 * `useEscLayer.ts`. Dinleyici pencere yakalama evresindedir: dünya kabının yürüme klavyesinden (`input.ts`, `exit`) ve
 * `useWalkFocus` karar zamanlayıcısından ÖNCE çalışır; işlediği olayda `preventDefault` + `stopImmediatePropagation` verir.
*/
export interface EscLayer { id: string; close: () => void; /** katman kendisi kipli bir pencere (`aria-modal`) */ modal?: boolean }
export interface EscCtx {
  layers: number;
  typing: boolean;
  /** başka bir yüzey Esc'yi kendine alır: panel, fotoğraf, emote çarkı, bilgi kartı, şehir pasaportu / hızlı seyahat, mini oyun, manzara */
  otherOwner: boolean;
  /** açık bir `aria-modal` pencere var */
  modalOpen: boolean;
  topModal: boolean;
}
export interface EscKeyInfo { key: string; repeat?: boolean; defaultPrevented?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }
export type EscDecision = "close" | "pass";

/** Saf: bu Esc'yi yığının en üstündeki katman mı alır? */
export function escDecision(e: EscKeyInfo, c: EscCtx): EscDecision {
  if (e.key !== "Escape" || e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return "pass";
  if (c.layers <= 0 || c.typing || c.otherOwner) return "pass";
  if (c.modalOpen && !c.topModal) return "pass"; // üstte başka bir kipli pencere var: onu o kapatır
  return "close";
}

const stack: EscLayer[] = [];
let provider: (() => Omit<EscCtx, "layers" | "topModal">) | null = null;
let attached = false;

export const escLayerCount = (): number => stack.length;
export const escLayerIds = (): string[] => stack.map((l) => l.id);

/** En üstteki katmanı kapatır (kaldırmayı katmanın kendi kapanışı yapar); kapattıysa true. */
export function closeTopEscLayer(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

/** Bağlam sağlayıcısı (useEscLayer.ts yazar: depolar ve DOM). */
export function setEscContext(fn: (() => Omit<EscCtx, "layers" | "topModal">) | null): void { provider = fn; }

function onKey(e: KeyboardEvent): void {
  const base = provider?.() ?? { typing: false, otherOwner: false, modalOpen: false };
  const top = stack[stack.length - 1];
  const d = escDecision(e, { ...base, layers: stack.length, topModal: !!top?.modal });
  if (d !== "close") return;
  e.preventDefault();
  e.stopImmediatePropagation();
  closeTopEscLayer();
}

function sync(): void {
  if (typeof window === "undefined") return;
  if (stack.length && !attached) { window.addEventListener("keydown", onKey, true); attached = true; }
  else if (!stack.length && attached) { window.removeEventListener("keydown", onKey, true); attached = false; }
}

/** Katmanı yığına koyar; dönen işlev kaldırır (aynı katmanı iki kez kaldırmak zararsız). */
export function pushEscLayer(layer: EscLayer): () => void {
  stack.push(layer);
  sync();
  return () => {
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
    sync();
  };
}
