/**
 * gözlem çarkı: tanım ve binişin saf matematiği. React/three yok; sahne
 * (`city/styles/londra.ts obsWheel`), biniş çalışma zamanı (`transit/wheelRide.ts`) ve node testleri aynı sayıları kullanır.
 *
 * - Çark `spin` grubunda döner (voxel/spin.ts): jant/kollar katı gövde, kabinler askı noktasıyla (`Spin.k`) dik kalır. Askı
 * açısı = taban açı + `w · t` (Blocks.tsx saati: R3F `clock.elapsedTime`). Hareket azaltmada çark taban pozda durur.
 * - Biniş (durum makinesi `wheelRidePlan` → `wheelRidePose`): `wait` (en alttan geçecek ilk kabin beklenir, ≤ 2π / (n·|w|))
 * → `ride` (kabinle bir tam tur, 2π / |w|; avatar kabin tabanında, girdi yok) → `done` (iniş: biniş karosu). Hareket
 * azaltmada bekleme ve tur yok: durağan çarkın en üstteki kabininde `CALM_VIEW_S` saniye seyir, sonra iniş.
 * - Konumlar taban sahne karosundadır; büyümüş dünyada `off` (walkRuntime.baseOffset, karo) eklenir.
*/
import { tx, tz } from "../scenes";
import { RIDE_SPEED_FACTOR } from "./speedFactor";

/** Çark tanımı (karo koordinatı): merkez sütunu `ci` (yarım karo olabilir), rıhtım satırı `cj`, jant düzleminin karo merkezine
 *  göre kayması `dz` (− arkaya/nehre), göbek yüksekliği `hub`, kabin askı çemberi yarıçapı `R`, kabin sayısı `n` (çift), açısal
 *  hız `w` (rad/sn; + önden bakışta saat yönünün tersi), biniş karosu `station` (çarkın önündeki yürünebilir karo). */
export interface WheelSpec { ci: number; cj: number; dz: number; hub: number; R: number; n: number; w: number; station: [number, number] }

/** Londra sahnesindeki çark (CITY-PASS-LON: gerçek çarktan esinli konsol çark —). Jant düzlemi
 * güney rıhtımının hemen önünde, nehrin son su satırının (j 8) üstündedir (gerçekte çark nehre doğru eğik durur ve kabinler
 * biniş iskelesinin yanından geçer); A çerçeve tek yanda, karada (güneyde). 16 kabin jantın **dışında** asılı değil, kabin
 * merkezinden döner (askı = kabin merkezi; `CABIN_DROP` merkezden taban üstüne iniş). Tepe ≈ 9,6 ( sahne hedefi 135 m →
 * 10,0 ±%25). Tam tur 2π / 0,13 ≈ 48 sn (gerçekte 30 dk; oyun içi seyir). Süpürme zarfı i 19–27 (su karoları); biniş rıhtım
 * karosundan (23, 9): en alttaki kabin tam önünde, iskele hizasında. 16 kabin: komşu iki kabinin merkez aralığı
 * 2R·sin(π/n) ≈ 1,56 > kabin köşegeni → hiçbir açıda üst üste binmez.*/
// R 3,999 (4 değil): 22,5°'deki askı x'i 15,19552 → dünya dosyası 4 basamağa yuvarlarken 15,1955 sınırına düşüp pişirme ≠ kurma
// (worlds.mjs `spinSig` toFixed(3)) farkı veriyordu
export const LONDRA_WHEEL: WheelSpec = { ci: 23, cj: 8, dz: -0.25, hub: 5.0, R: 3.999, n: 16, w: 0.13 * RIDE_SPEED_FACTOR, station: [23, 9] };
/** Binilebilir çarklar (yerleşik sahne kimliği → tanım). Yalnız sahnenin kendi tabanında (şehir haritası ve iç mekân değil). */
export const WHEELS: Readonly<Record<string, WheelSpec>> = { londra: LONDRA_WHEEL };

/** Kabin ölçüleri: askıdan (kabin merkezi) kabin tabanının üst yüzüne iniş (avatarın ayak yüksekliği = askı y − `CABIN_DROP`),
 *  en (x), yükseklik ve derinlik (z; kabin uzun ekseni mil yönünde, gerçek kapsül gibi). */
export const CABIN_DROP = 0.5, CABIN_W = 0.9, CABIN_H = 1.16, CABIN_D = 1.2;
/** Hareket azaltmada seyir süresi (sn). */
export const CALM_VIEW_S = 8;

/** Kabin `c`'nin taban pozdaki (açı 0) askı açısı: kabin 0 en altta (biniş), sayı arttıkça saat yönünün tersine. */
export const cabinAngle = (spec: WheelSpec, c: number) => -Math.PI / 2 + (c * 2 * Math.PI) / spec.n;
/** Süpürme zarfının (askı çemberi + kabin yarı eni) indiği sütunlar [i0, i1] — engellenecek karolar. */
export const wheelSpan = (spec: WheelSpec): [number, number] =>
  [Math.round(spec.ci - spec.R - CABIN_W / 2), Math.round(spec.ci + spec.R + CABIN_W / 2)];
/** Bir tam turun süresi (sn). */
export const loopSeconds = (spec: WheelSpec) => (2 * Math.PI) / Math.abs(spec.w);

const TAU = Math.PI * 2;
const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Kabin `c`'nin `t` anındaki askı açısı (Blocks.tsx ile aynı: taban açı + w·t); hareket azaltmada taban açı. */
export const cabinAngleAt = (spec: WheelSpec, c: number, t: number, calm: boolean) => cabinAngle(spec, c) + (calm ? 0 : spec.w * t);

export interface WheelRidePlan {
  /** binilen kabin */
  cabin: number;
  /** binme isteği, kabine giriş ve iniş anları (sahne saati, sn) */
  tBoard: number;
  tIn: number;
  tOut: number;
  /** hareket azaltmalı biniş (durağan seyir) */
  calm: boolean;
}

/** `t` anında binen için plan: en alttan (−π/2) geçecek ilk kabin; bir tam tur. Hareket azaltmada en üstteki kabin, bekleme yok. */
export function wheelRidePlan(spec: WheelSpec, t: number, calm: boolean): WheelRidePlan {
  if (calm) {
    const top = Math.round(spec.n / 2) % spec.n;
    return { cabin: top, tBoard: t, tIn: t, tOut: t + CALM_VIEW_S, calm: true };
  }
  const sg = Math.sign(spec.w) || 1, speed = Math.abs(spec.w);
  let cabin = 0, wait = Infinity;
  for (let c = 0; c < spec.n; c++) {
    const d = mod(sg * (-Math.PI / 2 - cabinAngleAt(spec, c, t, false)), TAU) / speed;
    if (d < wait - 1e-9) { wait = d; cabin = c; }
  }
  const tIn = t + wait;
  return { cabin, tBoard: t, tIn, tOut: tIn + loopSeconds(spec), calm: false };
}

export type WheelPhase = "wait" | "ride" | "done";
export interface WheelPose { phase: WheelPhase; x: number; y: number; z: number; heading: number }

/** Biniş karosunun dünya merkezi (büyümüş dünyada `off` karo kayması). */
export function stationXZ(spec: WheelSpec, off: readonly [number, number] = [0, 0]): [number, number] {
  return [tx(spec.station[0] + off[0]), tz(spec.station[1] + off[1])];
}

/** Kabin `c`'nin askı noktası (dünya) `ang` açısında. */
export function anchorAt(spec: WheelSpec, ang: number, off: readonly [number, number] = [0, 0]): [number, number, number] {
  return [tx(spec.ci + off[0]) + spec.R * Math.cos(ang), spec.hub + spec.R * Math.sin(ang), tz(spec.cj + off[1]) + spec.dz];
}

/** Avatarın `t` anındaki pozu. `calm`: o anki hareket azaltma (çark taban pozda çizilir → kabin taban pozunda). Yön π: kuzeye,
 *  nehre ve karşı kıyıya bakar (biniş karosunda da çarka döner). */
export function wheelRidePose(spec: WheelSpec, plan: WheelRidePlan, t: number, calm: boolean, off: readonly [number, number] = [0, 0]): WheelPose {
  const [sx, sz] = stationXZ(spec, off);
  if (t >= plan.tOut) return { phase: "done", x: sx, y: 0, z: sz, heading: Math.PI };
  if (t < plan.tIn) return { phase: "wait", x: sx, y: 0, z: sz, heading: Math.PI };
  const [ax, ay, az] = anchorAt(spec, cabinAngleAt(spec, plan.cabin, t, calm || plan.calm), off);
  return { phase: "ride", x: ax, y: ay - CABIN_DROP, z: az, heading: Math.PI };
}
