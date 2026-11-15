/**
 * UXF-G: "İlk görev" adımı Geri/İleri ile sökülünce yazılan görev, seçilen ajan/beyin ve son koşu kimliği kayboluyordu.
 * Durum bu küçük modülde tutulur (FirstTask tembel yüklenir; sihirbaz yalnız bunu içe aktarır); sihirbaz her açılışta sıfırlar.
*/
export type FirstTaskBrain = "agent" | "ollama" | "codex" | "claude" | "openai_compat";
export interface FirstTaskMemo { draft: string | null; agent: string; picked: FirstTaskBrain | null; runId: string | null }
const EMPTY: FirstTaskMemo = { draft: null, agent: "", picked: null, runId: null };
let memo: FirstTaskMemo = EMPTY;
export const readFirstTaskMemo = (): FirstTaskMemo => memo;
export const writeFirstTaskMemo = (m: FirstTaskMemo): void => { memo = m; };
export const resetFirstTaskMemo = (): void => { memo = EMPTY; };
