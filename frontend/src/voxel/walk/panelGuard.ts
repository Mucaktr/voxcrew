/**
 * açık panel ışınlanmada / dünya değişiminde kapanır. Londra'da olta yeri kartı ("Oltayı at") başka durağa ışınlanınca,
 * kule lobisinde ve müzede ekranda kalıyor, asansör kat seçimini etkisiz bırakıyordu. Kural: avatarın karosu tek güncellemede
 * `PANEL_JUMP` karodan fazla sıçrarsa (hızlı seyahat, durak, kapı, kat, iç mekân) ya da yürüme dünyası değişirse nesne/konuş paneli
 * ve mini oyun kapanır (durak paneli kendi kuralıyla: durak değişince kapanır; sıçramalı durak açılışını bozmasın diye burada yok). Yürüyerek uzaklaşma (karo karo) paneli kapatmaz ("git ve kullan" akışı korunur).
*/
import type { Tile } from "../scenes";
import { useWalkStore } from "./walkStore";
import { stopMinigame, useMinigame } from "../fun/minigames";

/** Tek pose güncellemesinde bundan uzun karo sıçraması ışınlanmadır (yürüyüş karo karo güncellenir). */
export const PANEL_JUMP = 3; // düşük kare hızında koşu bir güncellemede ≤ 2 karo atlar

/** Saf: önceki → yeni konum/dünya bir ışınlanma ya da dünya değişimi mi. */
export function panelJumped(prev: { tile: Tile; world: string | null } | null, cur: { tile: Tile; world: string | null } | null): boolean {
  if (!prev || !cur) return false;
  if (prev.world !== cur.world) return true;
  return Math.max(Math.abs(cur.tile[0] - prev.tile[0]), Math.abs(cur.tile[1] - prev.tile[1])) > PANEL_JUMP;
}

/** Bağla (WalkHud): sıçramada açık paneller kapanır. Dönüş: aboneliği bırak. */
export function bindPanelGuard(): () => void {
  return useWalkStore.subscribe((s, prev) => {
    if (s.pose === prev.pose && s.world === prev.world) return;
    const a = prev.pose ? { tile: prev.pose.tile, world: prev.world } : null, b = s.pose ? { tile: s.pose.tile, world: s.world } : null;
    if (!panelJumped(a, b)) return;
    if (s.panel) useWalkStore.getState().setPanel(null);
    if (useMinigame.getState().kind) stopMinigame();
  });
}
