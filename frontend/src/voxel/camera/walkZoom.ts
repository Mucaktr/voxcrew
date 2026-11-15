/**
 * WALK-ZOOM (CEO 31 Ekim: "Yürüme modunda zoom out yapıp şehre yukarıdan bakabilmek") — takip kamerasından kuş bakışına
 * uzaklaşma. Saf modül (three/React yok; Node testinde yüklenir).
 *
 * Yakınlaştırma tek bir "sanal mesafe" eksenidir (logaritmik): profilin `distMin … distMax` aralığında bugünkü takip mesafesi
 * (değişmedi), `distMax`'ın ötesinde kuş bakışı payı `air` (0…1). `air` > 0 iken WalkRig takip pozunu (çarpışmalı yaylı kol,
 * kesit) kurar, sonra kamerayı `airPose` noktasına doğru kaydırır: avatarın arkasında `AIR_BACK`, üstünde `AIR_H`, bakış avatara.
 * Yalnız açık havada (sokak, meydan, seyir terası profili); iç mekân, salon, koridor, avlu iç mekânı (oda/salon kuralı), taşıt ve
 * etkinlik kadrajında kuş bakışı yok — oralarda yakınlaştırma profil sınırında (tavanın altında: camera/ceiling.ts) kalır.
 *
 * Sis (`airFog`): kamera yükseldikçe sis başlangıcı kamera yüksekliğinin `AIR_FOG_NEAR` katına, bitişi ek kol boyu kadar ileri
 * kayar — yerdeki görüntü yürüyüşteki gibi berrak, ufuk yine pus. Başlangıç, yükleme halkası kenarındaki (yan erişim) en yakın
 * zemin noktasının kameraya uzaklığını geçmez: uzak halkanın yeni parıltısı kuş bakışında da pusun içinde belirir
 * (tour_check POP-IN-001 kuş bakışı geçişi).
 */

/** Kuş bakışı tam açıkken kameranın avatarın göğüs pivotundan yüksekliği ve arkaya uzaklığı (birim; 1 birim ≈ 1,75 m). */
export const AIR_H = 62;
export const AIR_BACK = 17;
/** Kuş bakışı kol boyu (pivot → kamera). */
export const AIR_DIST = Math.hypot(AIR_H, AIR_BACK);
/** +/− tuşunun ve tekerlek çentiğinin adımı (bugünkü 1,15 çarpanı). */
export const ZOOM_STEP = 1.15;
/** Kuş bakışı payının yumuşatma zaman sabiti (sn); hareket azaltmada anında. */
export const AIR_TAU = 0.35;
/** Kuş bakışına izin veren kamera profilleri (camera/profiles.ts). */
export const AIR_SPACES: ReadonlySet<string> = new Set(["street", "plaza", "terrace"]);
/** Sis başlangıcı: kamera yüksekliğinin bu katı (kuş bakışında). */
export const AIR_FOG_NEAR = 0.65;

export const airAllowed = (profileId: string, indoorRule: boolean) => !indoorRule && AIR_SPACES.has(profileId);

/**
 * Yakınlaştırma girdisi (`lz` = ln çarpan; + uzaklaş): sanal mesafe D, `[lo, hi]` takip aralığında mesafe, `hi`'nin ötesinde
 * (izin varsa) `AIR_DIST`'e kadar kuş bakışı. Dönüş: yeni mesafe (≤ hi) ve kuş bakışı payı (0…1).
 */
export function applyZoom(dist: number, air: number, lz: number, lo: number, hi: number, allowed: boolean): { dist: number; air: number } {
  const top = Math.max(hi, AIR_DIST);
  const span = Math.log(top / hi);
  const a = allowed ? Math.min(1, Math.max(0, air)) : 0;
  let D = a > 0 ? hi * Math.exp(a * span) : Math.min(hi, Math.max(lo, dist));
  D *= Math.exp(Number.isFinite(lz) ? lz : 0);
  D = Math.min(allowed ? top : hi, Math.max(lo, D));
  return D > hi ? { dist: hi, air: span > 0 ? Math.min(1, Math.log(D / hi) / span) : 0 } : { dist: D, air: 0 };
}

/** Z tuşu / HUD düğmesi: kuş bakışı açıkken takip mesafesine (`base`) döner, değilse tam kuş bakışına çıkar. */
export function toggleAir(air: number, hi: number, base: number, allowed: boolean): { dist: number; air: number } {
  return air > 0.5 || !allowed ? { dist: base, air: 0 } : { dist: hi, air: 1 };
}

/** Kuş bakışı payının bir karesi (üstel yaklaşım; hareket azaltmada anında). */
export function stepAir(k: number, target: number, dt: number, calm: boolean): number {
  if (calm) return target;
  const n = k + (target - k) * (1 - Math.exp(-Math.max(0, dt) / AIR_TAU));
  return Math.abs(n - target) < 1e-3 ? target : n;
}

/** Geçiş eğrisi (smoothstep): takip pozundan kuş bakışı pozuna. */
export const airEase = (k: number) => { const t = Math.min(1, Math.max(0, k)); return t * t * (3 - 2 * t); };

type P3 = { x: number; y: number; z: number };
/** Tam kuş bakışı kamera noktası (yerinde `out`): pivotun `yaw` arkasında `AIR_BACK`, `AIR_H` yukarıda (walk/scale.ts ekseni). */
export function airPose(pivot: P3, yaw: number, out: P3): P3 {
  out.x = pivot.x - Math.sin(yaw) * AIR_BACK; out.y = pivot.y + AIR_H; out.z = pivot.z - Math.cos(yaw) * AIR_BACK;
  return out;
}

/**
 * Kuş bakışında sis: [başlangıç, bitiş]. `camH` kameranın avatar zemininden yüksekliği, `extra` takip kolunun ötesindeki ek kol
 * boyu. Yerde (camH küçük) taban sis aynen. Başlangıç `camH · AIR_FOG_NEAR`'dan büyük olmaz → yükleme halkasının kenarındaki parıltı
 * kameradan bu uzaklıktan yakında olamaz (uzak halka avatarın en az bir parsel ötesinde, kamera avatarın üstünde).
 */
export function airFog(near: number, far: number, camH: number, extra: number): { near: number; far: number } {
  const e = Math.max(0, extra);
  if (e <= 0) return { near, far };
  return { near: Math.max(near, camH * AIR_FOG_NEAR), far: far + e };
}

/** Çalışma zamanı (WalkRig yazar; AirFog, HUD düğmesi ve denetim okur). `toggle`: Z / düğme isteği (WalkRig tüketir). */
export const walkZoom = { toggle: false, on: false, allowed: false, k: 0, camH: 0, extra: 0 };
const listeners = new Set<() => void>();
/** HUD düğmesinin durumunu (açık / izinli) yayar; WalkRig yalnız değişince çağırır. */
export function emitWalkZoom(): void { for (const f of listeners) f(); }
export function subscribeWalkZoom(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }

/**
 * Sahnenin sisine kuş bakışı payını uygular (WalkRig kare sonu; `fog` THREE.Fog ya da benzeri). Taban değer her karede geri
 * çıkarılır: başka bir yazar (hava anı, World.tsx sis yenilemesi) mutlak değer yazdıysa o değer yeni taban olur — pay birikmez.
 */
const fogMark = new WeakMap<object, { near: number; far: number; bn: number; bf: number }>();
export function applyAirFog(fog: { near: number; far: number } | null | undefined, camH: number, extra: number): void {
  if (!fog || !Number.isFinite(fog.near) || !Number.isFinite(fog.far)) return;
  const m = fogMark.get(fog);
  const own = !!m && Math.abs(fog.near - m.near) < 1e-4 && Math.abs(fog.far - m.far) < 1e-4;
  const bn = own ? m!.bn : fog.near, bf = own ? m!.bf : fog.far;
  const f = airFog(bn, bf, camH, extra);
  if (!m && f.near === bn && f.far === bf) return;
  fog.near = f.near; fog.far = f.far;
  fogMark.set(fog, { near: f.near, far: f.far, bn, bf });
}
