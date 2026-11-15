/**
 * bilgi kartı durumu: açık kart (tam kart, yan panel / alt sayfa) ve yaklaşma/bakış çipi. Hiçbir tetik kendiliğinden
 * kart açmaz: çip yalnız öneri, kartı `I`, çip, dokunma, Yakındakiler ya da mini harita açar. Kapanınca odak açana döner.
*/
import { create } from "zustand";
import { useWalkStore } from "../../../../voxel/walk/walkStore";
import { landmarkViewSources, useLandmarkView } from "../../../../voxel/walk/landmarkView";
import { panelJumped } from "../../../../voxel/walk/panelGuard";
import type { InfoTarget } from "./infoTargets";

export interface InfoChip { target: InfoTarget; via: "near" | "look"; at: number }
interface InfoState { open: InfoTarget | null; chip: InfoChip | null }
export const useInfo = create<InfoState>(() => ({ open: null, chip: null }));
export const useInfoOpen = () => useInfo((s) => s.open);
export const useInfoChip = () => useInfo((s) => s.chip);

let returnTo: HTMLElement | null = null;
/** Odak dünyaya dönsün (WalkHud bağlar). */
export const infoFocus: { world: (() => void) | null } = { world: null };

/** Kartı aç (aynı kart açıksa dokunmaz). Odak dönüşü için o anki odak saklanır. */
export function openInfo(target: InfoTarget): void {
  const cur = useInfo.getState().open;
  if (cur?.key === target.key) return;
  if (!cur) {
    const a = typeof document !== "undefined" ? document.activeElement : null;
    returnTo = a instanceof HTMLElement && a !== document.body ? a : null;
  }
  useInfo.setState({ open: target });
}

/** Kartı kapat; odak açana (yoksa dünya kabına) döner. `restore: false` odağı olduğu yerde bırakır. */
export function closeInfo(restore = true): void {
  if (!useInfo.getState().open) return;
  useInfo.setState({ open: null });
  const el = returnTo;
  returnTo = null;
  if (!restore) return;
  // açan öğe kartın içindeyse ya da söküldüyse dünyaya
  if (el && el.isConnected && !el.closest("[data-walk-info]")) el.focus({ preventScroll: true });
  else infoFocus.world?.();
}

// açık kartın hedefi `L`'de önceliklidir; manzara kipi başlayınca kart kapanır (görüntüyü örtmesin), odak dünyaya
landmarkViewSources.card = () => useInfo.getState().open;

// yürüme modu kapanınca kart ve çip gider; fotoğraf modunda kart kapanır
if (typeof window !== "undefined") {
  useLandmarkView.subscribe((s, prev) => {
    if (s.active && !prev.active && useInfo.getState().open) { closeInfo(false); infoFocus.world?.(); }
  });
  useWalkStore.subscribe((s, prev) => {
    if ((!s.active && prev.active) || (s.world !== prev.world)) useInfo.setState({ open: null, chip: null });
    // ışınlanma / kapı / iç mekân (panelGuard sıçraması) — kart eski yerin kartıdır, kapanır (<city> telefonda kat seçiciyi örtüyordu)
    else if (s.pose !== prev.pose && useInfo.getState().open && panelJumped(prev.pose && { tile: prev.pose.tile, world: prev.world }, s.pose && { tile: s.pose.tile, world: s.world })) closeInfo(false);
    else if (s.photo && !prev.photo && useInfo.getState().open) useInfo.setState({ open: null });
  });
}
