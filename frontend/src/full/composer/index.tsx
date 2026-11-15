// FREE fallback of full/composer.tsx (the full-edition aggregator is deleted from the free export): same names, render nothing.
import type { CapState } from "../../lib/seamTypes";

export type { CapState };
type Props = Record<string, unknown>;
// Satır içi geri çağrıların parametreleri (yalnız kullanılan alanlar) kapalı kalmasın diye türlü
interface PickOption { brain: string; model: string | null }
export const EstimatePanel = (_p: Props & { onCheaper?: (c: PickOption) => void }): null => null;
export const TradeoffCard = (_p: Props & { allowed?: (o: PickOption) => boolean; onPick?: (o: PickOption) => void }): null => null;
export const ExpectedOutputField = (_p: Props): null => null;
