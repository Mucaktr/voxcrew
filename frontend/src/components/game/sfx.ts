// Ekip S5 — kutlama sesleri (8-bit, WebAudio, dosya yok, her biri < 1 sn).
// Genel ses tercihine ve ses düzeyine uyar (lib/sound.ts ana çıkışı).
import type { GameCue } from "../../lib/game";
import { playNotes } from "../../lib/sound";

const NOTES: Record<GameCue, [number, number][]> = {
  levelup: [[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.22]],
  achievement: [[880, 0.08], [1175, 0.08], [1568, 0.2]],
  coin: [[988, 0.06], [1319, 0.14]],
};

export function playGameCue(cue: GameCue) {
  playNotes(NOTES[cue], 0.2);
}
