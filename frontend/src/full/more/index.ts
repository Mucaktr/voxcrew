// FREE fallback of full/more.ts (the full-edition aggregator is deleted from the free export): same names, empty values.
import { create } from "zustand";
import type { BrainRow } from "../../lib/types";
import type { Shelf } from "../../lib/seamTypes";

export type { Shelf, ShelfItem } from "../../lib/seamTypes";

export const estimateBrains = async (): Promise<{ brains: BrainRow[] }> => ({ brains: [] });
export const formatMinutes = (_r: unknown, _lang?: string): string => "";
export const formatMoney = (_r: unknown, _lang?: string): string => "";
export const savedHoursThisWeek = (): Promise<number> => Promise.reject(new Error("unavailable"));
export const exhibitLabels = (): { desk: string; forgotten: string } => ({ desk: "", forgotten: "" });

export const useRecognition = create<{
  byAgent: Record<string, { today?: { plants?: number; trophies?: number } }>;
  moods: Record<string, number>;
  weekly: { agent: string } | null;
  weeklyLoaded: boolean;
  load: (slug: string) => Promise<void>;
  loadWeekly: () => Promise<void>;
}>(() => ({ byAgent: {}, moods: {}, weekly: null, weeklyLoaded: true, load: async () => undefined, loadWeekly: async () => undefined }));
export const ensureMoods = (_force?: boolean): void => undefined;

const NO_SHELVES: Record<string, Shelf> = Object.freeze({});
export const useShelves = (_enabled?: boolean): Record<string, Shelf> => NO_SHELVES;

export interface RecipeCard { id: string; title: string; schedule?: { trigger_input?: string | null } | null }
export interface RecipeInput { name: string; type: "text" | "textarea" | "select" | "url"; required: boolean; label: string; example: string; default: string; max: number; options?: { value: string; label: string }[] }
export const recipesApi = {
  list: async (): Promise<{ items: RecipeCard[] }> => ({ items: [] }),
  detail: async (_id: string): Promise<{ inputs: RecipeInput[] }> => ({ inputs: [] }),
};
