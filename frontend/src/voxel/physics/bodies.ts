/**
 * PHYS — dairesel bedenler (ajan, "Ben" avatarı). Saf veri; çözücü (solver.ts) ve kaçınma (avoid.ts) okur/yazar.
 *
 * Kipler:
 *  - `WALK`: yolu izleyen, hızlanan/yavaşlayan dinamik beden (kütle 1)
 *  - `STATIC`: oturan, uyuyan, çalışan, yerinde duran ajan (sonsuz kütle; yürüyenler etrafından dolaşır)
 *  - `KINEMATIC`: dışarıdan sürülen beden (yürüme modu avatarı): ajanları iter, kendisi itilmez
 *  - `OFF`: dünyada değil (gizli avatar)
 */
import type { Tile } from "../scenes";

/** ajan beden yarıçapı: 1 karoluk koridorda iki ajan yan yana geçebilir (2 × 0,24 < 1) */
export const AGENT_R = 0.24;
/** yürüme modu avatarı (controller.AVATAR_RADIUS ile aynı) */
export const AVATAR_R = 0.28;

/** varsayılan kuyruk sınırı (sn): bu kadar bekleyen beden `queueOut` alır (Crowd beden başına 8–15 sn rastgele verir) */
export const QUEUE_LIMIT = 12;

export const STATIC = 0;
export const WALK = 1;
export const KINEMATIC = 2;
export const OFF = 3;
export type BodyMode = typeof STATIC | typeof WALK | typeof KINEMATIC | typeof OFF;

export interface Body {
  id: number;
  /** şimdiki ve bir önceki sabit adımdaki konum (çizim ara değeri) */
  x: number; z: number; px: number; pz: number;
  vx: number; vz: number;
  r: number;
  mode: BodyMode;
  /** izlenen yol (karo dizisi; çağıranla paylaşılır, varılan noktalar başından düşer) */
  path: Tile[] | null;
  /** en yüksek hız (birim/sn) */
  speed: number;
  /** izinli hedef karosu (j * width + i): bu karonun eşyasına (sandalye, yatak) girebilir; -1 yok */
  goal: number;
  /** çıkılan karo (oturduğu sandalyeden kalkarken): içindeyken muaf */
  leave: number;
  /** kuyrukta bekliyor (hedef dolu, önünde duran var) ve kesintisiz bekleme süresi (sn) */
  queued: boolean;
  waitT: number;
  /** kuyruk sınırı (sn) ve zaman aşımı: `waitT` sınıra ulaşınca çözücü `queueOut`u kaldırır; çağıran başka hedef ya da
   * nazik kaçış seçer, sonra `queueOut = false; waitT = 0` (sonsuz kuyruk yok)*/
  queueLimit: number;
  queueOut: boolean;
  /** ilerleyemiyor: `stuck` true olunca çağıran yeniden yol arar (findPath), sonra bayrağı indirir */
  stuckT: number;
  stuck: boolean;
  /** iç (FIX-PHYS): ilerleme bekçisi — izlenen ara nokta, ona en yakın uzaklık, ilerlemesiz geçen süre. Hız ölçütünü
   *  kandıran salınımda (itilip geri gelme) da takılma algılanır */
  wp: Tile | null;
  progD: number;
  progT: number;
  /** beyaz liste: bu ana kadar başka beyaz listedeki bedene değebilir (şakşak, çak bir beşlik) */
  contactUntil: number;
  /** uzak ajan: yalnız ayrışma + sert düzeltme (hız engeli öngörüsü yok) */
  lite: boolean;
  /** bu adımda son yol noktasına vardı */
  arrived: boolean;
  /** iç: istenen hız, adım başı konumu (geri alma), adım başı batma */
  dvx: number; dvz: number; sx: number; sz: number; pen0: number;
  /** iç: dizideki sırası (karma kurulurken) */
  ix: number;
}

export function createBody(id: number, x: number, z: number, r = AGENT_R, mode: BodyMode = STATIC): Body {
  return {
    id, x, z, px: x, pz: z, vx: 0, vz: 0, r, mode, path: null, speed: 2.1, goal: -1, leave: -1,
    queued: false, waitT: 0, queueLimit: QUEUE_LIMIT, queueOut: false, stuckT: 0, stuck: false, wp: null, progD: Infinity, progT: 0, contactUntil: 0, lite: false, arrived: false,
    dvx: 0, dvz: 0, sx: x, sz: z, pen0: 0, ix: -1,
  };
}

/** Bedeni yerinde tutar (hız sıfır, ara değer yok). */
export function hold(b: Body) {
  b.vx = 0; b.vz = 0; b.px = b.x; b.pz = b.z;
}
