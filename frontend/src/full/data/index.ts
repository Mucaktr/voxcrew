// FREE fallback of full/data.ts (the full-edition aggregator is deleted from the free export): same names, empty values.
import { create } from "zustand";
import { useStudio } from "../../lib/store";
import type { ExternalAgent, ResumeView } from "../../lib/seamTypes";

export type { ExternalAgent, ExternalSource, ExternalStatus, ResumeAsk, ResumeView, EstimateSpec, BudgetCap, CapState, Shelf, ShelfItem } from "../../lib/seamTypes";

const NO_AGENTS: ExternalAgent[] = [];
export const useExternalAgents = (): ExternalAgent[] => NO_AGENTS;

// Karar kuyruğu yalnız koşu listesinden kurulur; boş görünüm sabit kalır (iskelet sonsuza dek beklemesin).
const EMPTY_VIEW: ResumeView = { acceptances: { items: [], total: 0 }, asks: { items: [], total: 0 }, deliverables: { items: [], total: 0 } };
export const useResumeFeed = create<{ data: ResumeView | null; error: string | null; loading: boolean; at: number; load: () => Promise<void> }>(() => ({
  data: EMPTY_VIEW, error: null, loading: false, at: 0, load: async () => undefined,
}));
export function wireResumeFeed(): void { /* no-op */ }
// PANO-FIX koşu listesinin ilk (boş) dizisi; depodan ayrılınca koşular yüklenmiştir.
const RUNS_INITIAL = useStudio.getState().runList;
export const selectRunsLoaded = (s: { runList: unknown }): boolean => s.runList !== RUNS_INITIAL;

export const dueDigest = async (): Promise<{ count: number; as_of: string; titles: string[] } | null> => null;
export const useNotifyPref = create<{ freq: "off" | "immediate" | "daily"; loaded: boolean; load: () => Promise<void> }>(() => ({
  freq: "immediate", loaded: true, load: async () => undefined,
}));
export const digestTitle = (_n: number): string => "";

export const scheduleAcademyLoad = (_delay?: number): void => undefined;
export const useAcademy = create<{ setTip: (t: { id: string }) => void }>(() => ({ setTip: () => undefined }));
// İlk oturum kapısı yok: oyun olayları hiç bekletilmez.
export const useIntroGate = create<{ open: boolean; ready: boolean }>(() => ({ open: true, ready: true }));
export const refreshIntroGate = (_force?: boolean): void => undefined;
