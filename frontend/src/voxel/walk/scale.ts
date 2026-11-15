/**
 * WALK-SCALE — yürüme modunda "gerçek boy" ölçeği ve serbest bakış. Saf modül: React/three yok.
 *
 * Ölçüm (dünya birimi; 1 karo = 1):
 * - karakter (chibi, ölçek 1): ayak 0 · kalça 0,375 · omuz 0,84 · baş tepesi ≈ 1,55 (parts.ts BONE_PIVOT, 16 voksel = 1)
 * - şehir: kat 1,6 (city/kit.ts CITY_STOREY), kapı 1,2; Londra otobüsü (ölçek 0,85) 1,27 yük. × 2,2 boy × 0,85 en;
 * taksi (0,8) 0,8 yük.; köprü güvertesi 1–3 karo, yol 1–2 karo; bank oturağı ≈ 0,47; masa 0,79; sandalye 0,31
 * - gerçek: insan 1,75 m · kapı 2,1 m · kat 3 m · çift katlı otobüs 4,4 m · taksi 1,5 m · tramvay 3,5–4 m · tren 4 m
 * - şehir dışı ölçek: kapı 1,2 / 2,1 m = 0,57 birim/m; kat 1,6 / 3 m = 0,53 birim/m → insan ≈ 1,0 birim olmalı
 *
 * Karar (WALK-PHYS, devamı): yürüme modunda insan boyu `WALK_HUMAN_H` = 1,0 birim (karakter çizim ölçeği
 * `WALK_HUMAN_SCALE` = 1 / 1,55 ≈ 0,645). Böylece kapı = 1,2 × insan, kat = 1,6 × insan (gerçek 1,2 ve 1,7) kendiliğinden
 * tutar; binalara, kapılara ve simgelere dokunulmaz (çarpışma, kesit ve WALK-PASS-001 eşikleri aynı). Eski 0,72 (insan 1,12)
 * kapıyı 1,07 × insan yapıyordu. Genel bakış chibi oranını korur. İç mekân eşyası chibi boyunda
 * kalır (masa 0,79 = 0,79 × insan; gerçek 0,43): bilinçli ödünleşim, açık iş.
 * Taşıtlar: şekil başına hedef oran (`WALK_MOVER_TARGET`, insan boyuna göre) ve sahne örneğinin kendi ölçeğinden örnek başına
 * çarpan (`voxel/walk/moverFit.ts`): yükseklik hedefe tam oturur; boy/en yol açıklığına göre (yeni çarpışma yok) seçilir.
 * Çarpışma: avatar yarıçapı ölçekle küçülür (0,28 → 0,18; ulaşılabilirlik yalnız artar). Ajan bedenleri (0,24) çözücüde
 * kalır (FIX-PHYS); görsel yarıçapları 0,16'ya inse de aralık bozulmaz.
 * Geçiş: 600 ms (giriş/çıkış kaymasıyla aynı), hareket azaltmada kesme.
*/
import type { MoverShape } from "../scenes";

/** chibi karakterin baş tepesi (ölçek 1, dünya birimi) ve kalça yüksekliği (oturuş pivotu; Crowd SEAT_OFF ile aynı) */
export const CHIBI_HEIGHT = 1.55;
export const SEAT_HIP = 0.32;
/** yürüme modunda insan boyu (dünya birimi) ve karakter çizim ölçeği */
export const WALK_HUMAN_H = 1.0;
export const WALK_HUMAN_SCALE = WALK_HUMAN_H / CHIBI_HEIGHT;
/** ölçek geçişi (ms) — WalkRig TRANSITION_MS ile aynı */
export const SCALE_MS = 600;
/**
 * WALK-PHYS: taşıt hedefleri — insan boyuna oran. `dim`: hangi ölçü hedefe oturur ("top" yerden tepe, "height" gövde boyu,
 * "length" boy, "width" en, "basket" balon sepeti); `min`/`max` WALK-SCALE-002 kabul aralığı; `ref` sahnelerdeki tipik örnek
 * ölçeği (nominal çarpan için). `minLength` gemilerde boy alt sınırı (insanın kaç katı). Denizaltı, vatoz ve balık sürüsü
 * su altında, yanında insan durmaz: ölçeklenmez.
 */
export interface MoverTarget { dim: "top" | "height" | "length" | "width" | "basket"; ratio: number; min: number; max: number; ref: number; minLength?: number }
export const WALK_MOVER_TARGET: Partial<Record<MoverShape, MoverTarget>> = {
  ferry: { dim: "top", ratio: 3.0, min: 2.0, max: 4.0, ref: 0.7, minLength: 3.5 },
  boat: { dim: "top", ratio: 1.4, min: 1.1, max: 2.2, ref: 0.5, minLength: 2.0 },
  felucca: { dim: "top", ratio: 4.0, min: 3.0, max: 6.0, ref: 1, minLength: 2.4 },
  bus: { dim: "top", ratio: 2.5, min: 2.0, max: 2.8, ref: 0.85 },
  tram: { dim: "top", ratio: 2.2, min: 1.8, max: 2.6, ref: 1 },
  taxi: { dim: "top", ratio: 0.9, min: 0.8, max: 1.05, ref: 0.8 },
  train: { dim: "top", ratio: 2.3, min: 1.6, max: 2.7, ref: 0.8 },
  cablecar: { dim: "height", ratio: 2.2, min: 1.6, max: 2.8, ref: 0.75 },
  skiplane: { dim: "length", ratio: 4.0, min: 3.5, max: 5.0, ref: 1 },
  airship: { dim: "length", ratio: 6.0, min: 5.0, max: 40, ref: 1 },
  balloon: { dim: "basket", ratio: 0.6, min: 0.45, max: 0.8, ref: 0.6 },
  drone: { dim: "width", ratio: 0.7, min: 0.4, max: 1.0, ref: 1.5 },
};
/** balon sepetinin şekil içi yüksekliği (props/movers.ts balloon: [0, 1,25, 0, 0,6, 0,45, 0,6]) */
export const BALLOON_BASKET_H = 0.45;
/** Şekil kutusunun hedef ölçüsü (yerel; ölçek 1). */
export function shapeDim(parts: readonly (readonly [number, number, number, number, number, number, ...unknown[]])[], dim: MoverTarget["dim"]): number {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of parts) {
    x0 = Math.min(x0, p[0] - p[3] / 2); x1 = Math.max(x1, p[0] + p[3] / 2);
    y0 = Math.min(y0, p[1] - p[4] / 2); y1 = Math.max(y1, p[1] + p[4] / 2);
    z0 = Math.min(z0, p[2] - p[5] / 2); z1 = Math.max(z1, p[2] + p[5] / 2);
  }
  return dim === "top" ? y1 : dim === "height" ? y1 - y0 : dim === "length" ? x1 - x0 : dim === "width" ? z1 - z0 : BALLOON_BASKET_H;
}
/**
 * Nominal yürüme çarpanı (tipik sahne ölçeğindeki örnek için yükseklik çarpanı; sözleşmesi ve testler). Gerçek çizim
 * örnek başına `moverFit.ts` ile (örneğin kendi ölçeği ve yol açıklığı) hesaplanır.
*/
export const WALK_MOVER_SCALE: Partial<Record<MoverShape, number>> = {
  bus: 1.97, tram: 1.31, taxi: 1.125, ferry: 2.42, boat: 3.29, felucca: 1.52, cablecar: 1.89, train: 2.59, skiplane: 1.28,
};
/** kontrol amaçlı ölçüler (testler ve belge) */
export const CITY_DOOR_H = 1.2;
export const CITY_STOREY_H = 1.6;
export const LONDON_BUS_H = 1.49 * 0.85;
export const TAXI_H = 1.0 * 0.8;

/** Bir sonraki karedeki ölçek: hedefe `SCALE_MS`'de doğrusal; hareket azaltmada anında. */
export function approachScale(cur: number, target: number, dtSec: number, calm: boolean): number {
  if (calm || cur === target) return target;
  const step = ((1 - WALK_HUMAN_SCALE) * dtSec * 1000) / SCALE_MS;
  return cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
}

/** İlerleme 0 (genel bakış) … 1 (tam yürüme ölçeği). */
export const walkProgress = (hs: number) => Math.min(1, Math.max(0, (1 - hs) / (1 - WALK_HUMAN_SCALE)));

/** Nominal taşıt çizim çarpanı, ölçek geçişiyle birlikte (örnek başına çarpan: moverFit.ts `moverWalkFactors`). */
export function moverScale(shape: MoverShape, hs: number): number {
  const f = WALK_MOVER_SCALE[shape];
  return f ? 1 + (f - 1) * walkProgress(hs) : 1;
}

/** Oturan karakterin kalçası oturakta kalsın diye çizim kaldırması (ayak pivotlu ölçek kalçayı indirir). */
export const seatLift = (seated: boolean, hs: number) => (seated ? SEAT_HIP * (1 - hs) : 0);

// ------------------------------------------------------------------------------------------ kamera (yürüme ölçeğinde)
/** Ölçeklenmiş avatarın göz ve göğüs yüksekliği (insan boyu 1,0: göz %91, göğüs %77), takip mesafesi. */
export const EYE_Y = 0.91;
export const LOOK_Y = 0.77;
export const FOLLOW_DIST = 4.6;
export const FOLLOW_MIN = 2.2;
export const FOLLOW_MAX = 9;
/** avatar yarıçapı (controller AVATAR_RADIUS 0,28 × ölçek ≈ 0,18) */
export const WALK_AVATAR_RADIUS = 0.28 * WALK_HUMAN_SCALE;

/** Bakış eğimi (rad): + yukarı, − aşağı. −60° … +70° (kuleye, binaya yukarı bakış). Varsayılan hafif aşağı (−17°). */
export const LOOK_MIN = -Math.PI / 3;
export const LOOK_MAX = (70 * Math.PI) / 180;
export const LOOK_DEFAULT = -0.3;
/** INTEGG3: dikey ekranda (en/boy < 1) Hor+ dikey açı ≈ 77°; −0,3 eğimde güverte varış karesi gökyüzü + zemin, şehir bandı tek ışın
 * satırı (%21). Güverte varışında dikeyde kamera daha aşağı, korkuluğun üstünden şehre bakar; yatay ekranda değişiklik yok.*/
export const LOOK_DECK_TALL = -0.6;
/** İç mekân varış karesinin eğimi: güverte + dikey ekran → LOOK_DECK_TALL, aksi LOOK_DEFAULT. */
export const arrivalPitch = (space: string | null | undefined, aspect: number) => (space === "deck" && aspect < 1 ? LOOK_DECK_TALL : LOOK_DEFAULT);
/** üçüncü şahısta kameranın avatarın göğsüne göre en alçak yükselişi (rad; biraz altından bakabilir) */
export const ORBIT_MIN = -0.12;
/** kameranın yerden en az yüksekliği */
export const CAM_FLOOR = 0.3;
/** fare ve dokunma duyarlılığı (rad/px), klavye adımı (rad) */
export const MOUSE_YAW = 0.005;
export const MOUSE_PITCH = 0.004;
export const KEY_PITCH = 0.12;
/** sürükleme eşiği (px): altı tıklama (tıkla-git), üstü bakış */
export const DRAG_SLOP = 5;

export const clampLook = (p: number) => Math.min(LOOK_MAX, Math.max(LOOK_MIN, p));

// ------------------------------------------------------------------------------------------ görüş açısı (Hor+)
/**
 * (lider kararı K3): yürüme kamerasının dikey görüş açısı artık sabit 38° değil. Kullanıcı ayarı (Görünüm →
 * "Yürüme görüş açısı", dikey derece, 50–75, varsayılan 55) + alan eki (iç mekân/sokak `fovAdd`) taban alınır; tuvalin en/boy
 * oranından yatay açı hesaplanır ve yatay taban altına düşerse dikey açı büyütülür (Hor+ tabanı): yatay ekranda (en/boy ≥ 1)
 * en az 60°, dikey ekranda en az 40° (0,6–1 arasında 40→60 doğrusal; sıçrama yok). Ayar + ek en çok 75° (balık gözü olmasın);
 * taban bu tavanı aşabilir ama 80°'yi geçmez (375 × 812 tam ekran tuvalde 40° yatay için ≈ 76° gerekir).
 * Birinci şahıs en az `FP_FOV` (62°) ya da bu değer; hareket azaltmada görünüm geçişinde açı değişmez (üçüncü şahısla aynı).
*/
export const WALK_FOV_MIN = 50;
export const WALK_FOV_MAX = 75;
export const WALK_FOV_DEFAULT = 55;
export const WALK_FOV_STEP = 1;
/** yatay taban (derece): yatay ekranda / dikey ekranda; dikey açı tavanı (ayar + ek) ve tabanın mutlak tavanı */
export const HFOV_FLOOR_WIDE = 60;
export const HFOV_FLOOR_TALL = 40;
export const VFOV_CAP = 75;
export const VFOV_FLOOR_CAP = 80;
const RAD = Math.PI / 180;
/** dikey açıdan (derece) yatay açı */
export const hFovOf = (vDeg: number, aspect: number) => (2 * Math.atan(Math.tan((vDeg * RAD) / 2) * aspect)) / RAD;
/** yatay açıdan (derece) dikey açı */
export const vFovFor = (hDeg: number, aspect: number) => (2 * Math.atan(Math.tan((hDeg * RAD) / 2) / Math.max(1e-3, aspect))) / RAD;
/** en/boy oranına göre yatay taban (derece) */
export function hFovFloor(aspect: number): number {
  if (aspect >= 1) return HFOV_FLOOR_WIDE;
  const k = Math.min(1, Math.max(0, (aspect - 0.6) / 0.4));
  return HFOV_FLOOR_TALL + (HFOV_FLOOR_WIDE - HFOV_FLOOR_TALL) * k;
}
/** Ayarı geçerli aralığa ve adıma çeker (bozuk/eksik değer → varsayılan). */
export function clampWalkFov(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return WALK_FOV_DEFAULT;
  return Math.min(WALK_FOV_MAX, Math.max(WALK_FOV_MIN, Math.round(n / WALK_FOV_STEP) * WALK_FOV_STEP));
}
/** Yürüme kamerasının dikey görüş açısı (derece): ayar + alan eki, Hor+ tabanı, tavan. */
export function walkFov(setting: number, aspect: number, add = 0): number {
  const base = Math.min(VFOV_CAP, clampWalkFov(setting) + add);
  return Math.min(VFOV_FLOOR_CAP, Math.max(base, vFovFor(hFovFloor(aspect), aspect)));
}

export interface Vec3 { x: number; y: number; z: number }

/** Bakış yönü (birim vektör): yaw (ileri = (sin, cos)), eğim (+ yukarı). */
export function lookDir(yaw: number, pitch: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const c = Math.cos(pitch);
  out.x = Math.sin(yaw) * c; out.y = Math.sin(pitch); out.z = Math.cos(yaw) * c;
  return out;
}

/**
 * Üçüncü şahıs yörünge: kamera avatarın göğsü (`pivot`) çevresinde yaw/eğimle döner. Aşağı bakışta (eğim ≤ −ORBIT_MIN) kamera
 * tam karşıdan pivota bakar; yukarı bakışta kamera alçakta (ORBIT_MIN) kalır ve yukarı döner — avatar ekranın altında kalır,
 * binalar ve kuleler görünür. Dönüş: kamera konumu (`pos`). Bakış noktası `pos + lookDir · mesafe`.
 */
export function orbitPose(pivot: Vec3, yaw: number, pitch: number, dist: number, pos: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const elev = Math.max(ORBIT_MIN, -pitch);
  const c = Math.cos(elev);
  pos.x = pivot.x - Math.sin(yaw) * c * dist;
  pos.y = Math.max(CAM_FLOOR, pivot.y + Math.sin(elev) * dist);
  pos.z = pivot.z - Math.cos(yaw) * c * dist;
  return pos;
}
