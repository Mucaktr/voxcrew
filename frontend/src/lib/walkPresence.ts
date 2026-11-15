/**
 * "yürüme modu açık mı" için hafif, bağımlılıksız işaret (oyun katmanı ve tanıtım bekletmesi okur).
 *
 * `voxel/walk/walkStore.ts` dünya demetine (controller, sahneler) bağlı; `lib/game.ts` ve `GameLayer` her sayfada yüklenir ve
 * onu içe aktarmamalı. Yazan tek yer WalkRig'dir (`useWalkStore.active` değişince ve sökülürken false).
*/
import { create } from "zustand";

export const useWalkPresence = create<{ walking: boolean }>(() => ({ walking: false }));

/** WalkRig yazar (değişmediyse depo yazılmaz). */
export function setWalkPresence(walking: boolean): void {
  if (useWalkPresence.getState().walking !== walking) useWalkPresence.setState({ walking });
}

/**
 * Kutlama penceresi şimdi açılmamalı mı (saf; GameLayer `blocked()` ve test aynı kuralı kullanır): kullanıcı son 2 sn içinde
 * yazdıysa, başka bir modal pencere açıksa ya da yürüme modu açıksa (pencere odağı dünyadan çalar, klavye girdisi kesilir;
 * kutlama kuyrukta yürüme bitene dek bekler).
 */
export function celebrationBlocked(o: { now: number; lastTyping: number; otherModal: boolean; walking: boolean }): boolean {
  return o.now - o.lastTyping < 2000 || o.otherModal || o.walking;
}
