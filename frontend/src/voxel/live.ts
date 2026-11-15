/**
 * Dünyanın canlı durumu (S13): React yeniden çizimi olmadan her karede güncellenen, değiştirilebilir tek nesne.
 * Kalabalık çizici (Crowd.tsx) yazar; HUD çapaları, seçim halkası, mini harita ve "ajan bul" okur.
 */
import type * as THREE from "three";
import type { Handoff, Mood } from "../lib/types";
import { createFx, type FxState } from "./fun/fx";
import type { ModuleCell } from "./scenes";

export interface LiveZone { i: number; j: number; color: string; team: string; lead: boolean }

export interface WorldLive {
  /** slug → dünya konumu (aynı Vector3 nesnesi; kopyalamadan okunur) */
  positions: Map<string, THREE.Vector3>;
  moods: Map<string, Mood>;
  teamOf: Map<string, string | null>;
  /** slug → taşınan teslim (parşömen) */
  carry: Map<string, Handoff>;
  /** S33: slug → şu an söylediği (gerçek olayın kısa özeti); HUD ve tuval balonu okur */
  talking: Map<string, string>;
  /** S33: şu an konuşmada olanlar (konuşan + dinleyen): HUD'un iş paneli bu sırada gizlenir, balon okunur kalır */
  meeting: Set<string>;
  /** slug → karakter ekranda yakın mı (etiket/HUD kararı için) */
  near: Set<string>;
  /** tam HUD'ların ölçülen ekran kutusu [sol, üst, sağ, alt] (dünya katmanına göre px; World.tsx HudDeclutter yazar).
   *  Tuval etiketleri bu kutulardan kaçar; ölçülmemiş HUD için kaba tahmin kullanılır. */
  hudRects: Map<string, [number, number, number, number]>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  modules: ModuleCell[];
  zones: LiveZone[];
  /** kamera hedefi ve konumu (mini harita görüş işareti) */
  camTarget: { x: number; z: number };
  camPos: { x: number; y: number; z: number };
  /** durağan veri (sınırlar, bölgeler, ekip) değişince artar */
  version: number;
  /** karakter sayısı (bench raporu) */
  count: number;
  /** kalabalık döngüsünün kare başına CPU süresi (ms, üstel ortalama) */
  crowdMs: number;
  /** S43: ortam canlıları döngüsünün kare başına CPU süresi (ms, üstel ortalama) */
  ambientMs: number;
  /** S48: eğlence efektleri (kalp, yıldız, toz, olta…): ortam ve kalabalık yazar, Crowd.tsx kare sonunda çizer */
  fx: FxState;
  /** S48: şu an süren eğlenceli hareket ve çarpışma sayısı (ölçüm/inceleme) */
  funCount: number;
}

export function createLive(): WorldLive {
  return {
    positions: new Map(), moods: new Map(), teamOf: new Map(), carry: new Map(), talking: new Map(), meeting: new Set(), near: new Set(), hudRects: new Map(),
    bounds: { minX: -12, maxX: 12, minZ: -8, maxZ: 8 }, modules: [], zones: [],
    camTarget: { x: 0, z: 0 }, camPos: { x: 0, y: 12, z: 16 }, version: 0, count: 0, crowdMs: 0, ambientMs: 0, fx: createFx(), funCount: 0,
  };
}
