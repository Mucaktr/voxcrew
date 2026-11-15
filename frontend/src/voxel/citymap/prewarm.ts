/**
 * şehir kurulumunun saf, önbellekli hesaplarını tabanda BOŞTA önceden ısıt.
 *
 * Portal girişinde şehir ilk çizimi tek görevde ~200 ms JS yapıyordu: semt planları (districtPlan), varış bakışı (cityArrivalView →
 * citySight), canlı kadro (liveRoster), su dokunma hedefleri (cityWaterTaps), kapı kabuğu (gateBuilt). Hepsi saf ve harita başına
 * önbellekli → tabanda şehir kapısı varken her biri ayrı boşta geri çağrısında hesaplanır; girişte önbellekten gelir. Sonuç birebir
 * aynıdır (aynı işlev, aynı girdi), görüntü değişmez. Saf modül (React/three yok).
*/
import { cityArrivalView } from "./arrivalView";
import { districtPlan } from "./district";
import type { CityMapFile } from "./format";
import { liveRoster } from "./live";
import { gateBuilt } from "./shell";
import { cityWaterTaps } from "./waterTaps";

/** district.ts önbellek sınırı (`districtCache.size > 16`): daha çok semtli haritada ısıtma önbelleği çalkalardı → semtler atlanır. */
const DISTRICT_CACHE = 16;

/** Isıtma adımları (her biri ayrı boşta görevde). Semtler önce: varış bakışı ve su hedefleri onları kullanır. */
export function prewarmSteps(map: CityMapFile): (() => unknown)[] {
  const steps: (() => unknown)[] = [() => gateBuilt(map)];
  if (map.districts.length <= DISTRICT_CACHE) for (const d of map.districts) steps.push(() => districtPlan(map, d));
  steps.push(() => cityArrivalView(map), () => liveRoster(map), () => cityWaterTaps(map));
  return steps;
}

type Idle = (cb: () => void) => number;
/** Adımları sırayla boşta çalıştırır; döner: iptal. */
export function prewarmCity(map: CityMapFile, idle: Idle = defaultIdle, cancelIdle: (h: number) => void = defaultCancel): () => void {
  const steps = prewarmSteps(map);
  let i = 0, h = 0, live = true;
  const next = () => {
    if (!live || i >= steps.length) return;
    try { steps[i++](); } catch { /* ısıtma isteğe bağlı: hata girişte aynen tekrar eder */ }
    h = idle(next);
  };
  h = idle(next);
  return () => { live = false; cancelIdle(h); };
}

const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
const cic = (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
function defaultIdle(cb: () => void): number { return ric ? ric(cb, { timeout: 4000 }) : (setTimeout(cb, 200) as unknown as number); }
function defaultCancel(h: number) { if (cic) cic(h); else clearTimeout(h); }
