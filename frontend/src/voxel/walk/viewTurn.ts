/**
 * (karar 2026-10-31): TÜM şehirlerdeki TÜM seyir noktalarında (şehir haritası seyir karosu ve iç mekân dürbün karosu)
 * oyuncu karoya gelince karakter bakılacak hedefe YUMUŞAK döner ve kamera hedefi kadrajlar; hareket azaltmada anında.
 *
 * Saf çekirdek + tek küçük durum (`viewTurn`): tetikleyici (CityRig seyir karosu, explore/actions.ts dürbün karosu) `startViewTurn`
 * çağırır; WalkRig her karede `stepViewTurn` ile yaw/eğimi hedefe yaklaştırır. Kullanıcı fareyle çevirirse ya da karodan çıkarsa
 * (`cancelViewTurn`) döndürme biter — oyuncunun kontrolü asla elinden alınmaz.
 *
 * Hedef: şehir haritasında semtin en belirgin simgesi (`citymap/vpAim.ts`); iç mekân dürbününde dürbünün baktığı hedef
 * (`interiors/lookout.ts lookoutTarget` — VIEW-RING-001 / ile AYNI). Denetim: scripts/ceo_eye_walk.mjs, ceo_eye.test.mjs.
*/

export interface Vec3 { x: number; y: number; z: number }
/** kamera eğimi sınırları (rad; + yukarı): birinci şahıs bakışı (WalkRig clampLook) içinde, yer/gökyüzü kadrajı bozulmaz */
export const VT_PITCH_MIN = -0.3;
export const VT_PITCH_MAX = 0.45;
/** dönüş hızı (1/sn; üstel yaklaşma — ~0,5 sn'de %90) ve bitiş eşiği (rad) */
export const VT_RATE = 4.5;
export const VT_EPS = 0.012;
/** perdesiz kamera yön isteği bundan küçükse anında oturur (kesme fark edilmez), büyükse `viewTurn` ile yumuşak döner.*/
export const AIM_TURN_MIN = 0.2;
/** WalkRig `walkCamera.aim` yumuşak dönüşünün anahtarı (seyir noktası dönüşlerinden ayrı).*/
export const AIM_TURN_KEY = "aim";

export interface ViewTurn { on: boolean; yaw: number; pitch: number; t0: number; set: number | null; key: string }
export const viewTurn: ViewTurn = { on: false, yaw: 0, pitch: 0, t0: 0, set: null, key: "" };

export const angDiff = (a: number, b: number): number => {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/** Gözden hedefe bakış: yaw (ileri = (sin, cos)), eğim (+ yukarı; sınırlı). */
export function gazeAngles(eye: Vec3, to: Vec3): { yaw: number; pitch: number } {
  const dx = to.x - eye.x, dz = to.z - eye.z, h = Math.hypot(dx, dz);
  const p = Math.atan2(to.y - eye.y, Math.max(h, 0.5));
  return { yaw: Math.atan2(dx, dz), pitch: Math.max(VT_PITCH_MIN, Math.min(VT_PITCH_MAX, p)) };
}

/** Bir adım: `calm` (hareket azaltma) → doğrudan hedef; değilse üstel yaklaşma. */
export function stepViewTurn(cur: { yaw: number; pitch: number }, goal: { yaw: number; pitch: number }, dt: number, calm: boolean): { yaw: number; pitch: number; done: boolean } {
  if (calm) return { yaw: goal.yaw, pitch: goal.pitch, done: true };
  const k = 1 - Math.exp(-Math.max(0, dt) * VT_RATE);
  const yaw = cur.yaw + angDiff(goal.yaw, cur.yaw) * k, pitch = cur.pitch + (goal.pitch - cur.pitch) * k;
  const done = Math.abs(angDiff(goal.yaw, yaw)) < VT_EPS && Math.abs(goal.pitch - pitch) < VT_EPS;
  return done ? { yaw: goal.yaw, pitch: goal.pitch, done: true } : { yaw, pitch, done: false };
}

export function startViewTurn(yaw: number, pitch: number, key: string): void {
  viewTurn.on = true; viewTurn.yaw = yaw; viewTurn.pitch = pitch; viewTurn.key = key; viewTurn.t0 = typeof performance !== "undefined" ? performance.now() : 0; viewTurn.set = null;
}
/** `keep` verilirse o anahtarlı dönüş iptal edilmez (CityRig seyir/semt iptalleri durak yön dönüşünü — AIM_TURN_KEY — yarıda kesmez).*/
export function cancelViewTurn(keep?: string): void { if (keep !== undefined && viewTurn.on && viewTurn.key === keep) return; viewTurn.on = false; viewTurn.set = null; }

// geliştirme kancası (yalnız DEV): canlı denetim — durum ve hedef
if (typeof window !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as { __voxcrewViewTurn?: ViewTurn }).__voxcrewViewTurn = viewTurn;
