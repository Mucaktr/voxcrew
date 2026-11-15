/**
 * program kapısının (programGate.tsx) durumu; React'siz modül: geçiş mağazaları (citymap/store, interiors/store) kararmayı
 * kapı açılana dek tutar, yoksa örtü kalkınca bir an ESKİ kare görünürdü (kapı çizimi atlarken tuval son kareyi gösterir).
*/
/** Derleme bu süreyi aşarsa çizim yine başlar (kalan programlar eskisi gibi ilk çizimde eşzamanlı bağlanır). */
export const HOLD_MAX_MS = 2000;

/** busy: çizim tutuluyor; n / lastMs / capped: ölçüm (perf_probe `__voxcrewGate`). */
export const gateStats = { busy: false, n: 0, lastMs: 0, capped: 0 };

/**
 * PORTAL1 · PORTAL-ARRIVAL-COMPLETE-001: varış görünümünde henüz yazılmamış parsel sayısı (CityRig şehir akışının `pending`'ini bağlar;
 * şehir dışında 0). Örtü yalnız programlar hazır VE görüş yarıçapındaki (uzak halka dahil) bütün parseller çizildiğinde kalkar —
 * eskiden örtü 420 ms + program kapısından sonra kalkıyor, karede 1 parsel üretilen akış henüz dolmadığından yapılar örtü kalktıktan
 * sonra beliriyordu (<city>: varışta yarım semt).
*/
export const arrivalHold: { pending: () => number } = { pending: () => 0 };
const held = () => gateStats.busy || arrivalHold.pending() > 0;

/** Kapı açıksa ve varış görünümü tamamsa hemen, değilse olunca (en geç HOLD_MAX_MS) `fn`. */
export function afterGate(fn: () => void): void {
  if (!held()) { fn(); return; }
  const t0 = Date.now();
  const id = setInterval(() => {
    if (held() && Date.now() - t0 < HOLD_MAX_MS) return;
    clearInterval(id);
    fn();
  }, 16);
}

/** Programın kapının kullandığı yüzü (three WebGLProgram). */
export interface GateProgram { getUniforms(): unknown }

/**
 * Bir görev dilimi: `pending` programlarının ilk kullanımını (`getUniforms`: bağlama sonucu + uniform konumları, eşzamanlı GPU
 * gidiş-dönüşü — derleme bitmediyse onu bekler) yapar ve listeden çıkarır; dilim `sliceMs`'i aşınca durur (en az bir program).
 * Döner: kalan sayısı. Saf (saat dışarıdan) — node testi: scripts/perf_guard.test.mjs.
 */
export function drainPrograms(pending: (GateProgram | null | undefined)[], now: () => number, sliceMs: number): number {
  const ts = now();
  let did = 0;
  while (pending.length) {
    if (did && now() - ts >= sliceMs) break;
    pending.pop()?.getUniforms();
    did++;
  }
  return pending.length;
}
