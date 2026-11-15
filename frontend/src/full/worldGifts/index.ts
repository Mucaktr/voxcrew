// EDITION1 — free sürüm eşi: takdir/hediye yok (bileşenler hiçbir şey çizmez, durum boş). Tam sürümde full/worldGifts.ts önce çözülür.
import type { Agent } from "../../lib/types";
import type { Shelf } from "../../lib/seamTypes";

export function GiftDialog(_p: { agent: Agent; open: boolean; onClose: () => void; onGiven?: (kind: string) => void }): null {
  return null;
}
export function GiftStrip(_p: { agent: Pick<Agent, "slug" | "name"> }): null {
  return null;
}
const EMPTY = {
  byAgent: {} as Record<string, { today?: { plants?: number; trophies?: number } } | undefined>,
  moods: {} as Record<string, number>,
  load: async (_slug: string): Promise<void> => {},
};
export const useRecognition = { getState: () => EMPTY };
export function ensureMoods(_force = false): void {}
export function useShelves(_enabled = true): Record<string, Shelf> {
  return {};
}
export const GIFTS_ENABLED: boolean = false;
export const teamLunchUrl = (_team: string): string | null => null;
