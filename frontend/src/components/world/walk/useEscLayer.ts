/**
 * UXF-G — Esc yığınına React bağlantısı (`escStack.ts`). Açıkken (`active`) katman yığının en üstüne girer; kapanınca çıkar.
 * useEscLayer(open, close) // Keşif izleyicisi
 * useEscLayer(true, onClose, { modal: true }) // Şehir rehberi (kendisi kipli pencere)
*/
import { useEffect, useRef } from "react";
import { useCity } from "../../../voxel/citymap/store";
import { isTypingTarget } from "../../../voxel/walk/input";
import { landmarkView } from "../../../voxel/walk/landmarkView";
import { useWalkStore } from "../../../voxel/walk/walkStore";
import { fun } from "./funBridge";
import { useInfo } from "./info/infoStore";
import { pushEscLayer, setEscContext } from "./escStack";

setEscContext(() => {
  const w = useWalkStore.getState();
  const city = useCity.getState();
  return {
    typing: typeof document !== "undefined" && isTypingTarget(document.activeElement),
    otherOwner: !!(w.panel || w.photo || w.emoteWheel || useInfo.getState().open || city.passport || city.fast || fun.minigameActive()
      || landmarkView.active || landmarkView.request),
    // gizli (display:none / görünmez / boyutsuz) aria-modal pencere sayılmaz — yoksa Yakındakiler'i kapatan Esc yürümeden çıkarırdı
    modalOpen: typeof document !== "undefined" && [...document.querySelectorAll('[aria-modal="true"]')].some((e) => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
    }),
  };
});

let seq = 0;
export function useEscLayer(active: boolean, close: () => void, opts: { modal?: boolean; id?: string } = {}): void {
  const ref = useRef(close);
  ref.current = close;
  const modal = !!opts.modal;
  const id = opts.id;
  useEffect(() => {
    if (!active) return;
    return pushEscLayer({ id: id ?? `layer-${++seq}`, modal, close: () => ref.current() });
  }, [active, modal, id]);
}
