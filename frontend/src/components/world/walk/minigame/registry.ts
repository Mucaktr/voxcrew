/**
 * mini oyun kaydının arayüz sütunu (simgeler). Tablonun kendisi `voxel/fun/minigames.ts MINIGAMES` (tür, defter, havuz,
 * jeton aralığı, varlık, kart, locale, saf mantık); HUD bileşeni `MinigameHud.tsx GAMES`. İkisi de `Record<MinigameKind, …>`:
 * yeni bir oyun (..28) simgesi ve HUD'u olmadan derlenmez.
*/
import { Dices, Fish, Grid3x3, Target, type LucideIcon } from "lucide-react";
import type { MinigameKind } from "../../../../voxel/fun/minigames";

/** `hud`: HUD başlığı · `start`: Yakındakiler paneli "başlat" düğmesi */
export const MINIGAME_ICONS: Readonly<Record<MinigameKind, { hud: LucideIcon; start: LucideIcon }>> = {
  fishing: { hud: Fish, start: Fish },
  board: { hud: Grid3x3, start: Dices },
  toss: { hud: Target, start: Target },
};
