/**
 * ACTIVITY-CAM — etkinlikte görünür keyif (ürün sahibi 2026-10-29: "çay içerken, balık ekmek yerken karakterin bunu NASIL yaptığı ve
 * keyif aldığı, yüzündeki mutluluk görünmeli").
 *
 * - İfade durum makinesi (saf): başla (nötr) → ye (çiğneme: ağız açılır-kapanır) / iç (yudum: gözler yarı kapalı) → mutlu
 * (^ ^ kapalı mutlu gözler + gülümseme). Yemekte ritüelin `joy` evresi, içecekte hareket evresinin son `SAVOR_MS`'si mutlu
 * evredir; ritüel bittikten sonra avatar yürümedikçe `LINGER_MS` boyunca mutlu yüz kalır (kamera da kadrajda bekler).
 * - Yudum döngüsü (`sipArms`): bardak göğüs önünden ağza kalkar ve eğilir (`tilt`), yudum, iner; hareket azaltmada durağan.
 * - Bitiş beden işareti (`savorPose`): bardak göğüse iner, omuzlar kalkar, küçük baş sallama ("ohh"); hareket azaltmada durağan.
 * - Yüzler `pixels.ts` içinde 2 × 2 yüz pikseli (= 1 voksel pikseli) bloklarla çizilir: takip kadrajı uzaklığında okunur.
 * three/React/depo yok; Crowd (avatar ve mekânda yiyen ajanlar) okur. Test: scripts/activity_cam.test.mjs.
*/
import type { Pose } from "../parts";
import type { Face } from "../pixels";

/** `parts.ts eatArms` ısırık döngüsü (sn) ve evreleri: 0–0,18 kaldır · 0,18–0,42 ağızda · 0,42–0,6 indir · 0,6–1 çiğne. */
export const EAT_CYCLE = 2.2;
/** Yudum döngüsü (sn): 0–0,18 kaldır · 0,18–0,55 ağızda (yudum) · 0,55–0,72 indir · 0,72–1 göğüs önünde. */
export const SIP_CYCLE = 3.0;
/** İçecekte "keyif" (mutlu) evresi: hareket evresinin son bu kadarı (ms; yemekteki `RITUAL_JOY_MS` ile aynı, en çok yarısı). */
export const SAVOR_MS = 1400;
/** Etkinlik bittikten sonra mutlu yüzün ve kadrajın kalma süresi (ms; avatar yürürse hemen biter). */
export const LINGER_MS = 1200;
/** Bardağın ağızdaki eğimi (rad; üst kenar ağza doğru). */
export const SIP_TILT = 0.95;

export type ExprStage = "none" | "start" | "eat" | "sip" | "happy";
export interface ExprInput {
  /** etkinlik sürüyor (ritüel etkin) */
  active: boolean;
  /** yeme anı (`ritualFeel.eat`) */
  eat: boolean;
  /** içme anı (`ritualFeel.drink`) */
  drink: boolean;
  /** ritüelin sevinç evresi (`ritualFeel.joy`; yalnız yemek) */
  joy: boolean;
  /** asıl başlangıçtan beri (ms) */
  sinceMs: number;
  settleMs: number;
  totalMs: number;
  /** son yeme/içme bitişinden beri (ms); null → yok */
  doneAgoMs: number | null;
  /** avatar yürüyor */
  moving: boolean;
}

/** İfade evresi: etkinlik yoksa nötr; yerleşmede nötr (başla); yeme/içme; sonda ve bitişin ardından mutlu. */
export function exprStage(i: ExprInput): ExprStage {
  if (!i.active) return i.doneAgoMs !== null && i.doneAgoMs >= 0 && i.doneAgoMs < LINGER_MS && !i.moving ? "happy" : "none";
  if (!i.eat && !i.drink) return "none";
  if (i.sinceMs < i.settleMs) return "start";
  if (i.joy) return "happy";
  if (i.drink && i.sinceMs >= i.totalMs - savorMs(i.totalMs - i.settleMs)) return "happy";
  return i.eat ? "eat" : "sip";
}
/** İçecekte keyif evresinin süresi (hareket süresinin en çok yarısı). */
export const savorMs = (actMs: number) => Math.min(SAVOR_MS, Math.round(Math.max(0, actMs) / 2));

const cyc = (t: number, period: number, seed: number) => (((t + seed * 1.7) % period) + period) % period / period;

/**
 * Evrenin yüzü (`pixels.ts Face`). Yemek: yiyecek ağza gelirken ağız açılır (ısırık), kapanır, sonra çiğnerken açılıp kapanır
 * (~3,5 Hz). İçecek: bardak ağızdayken gözler yarı kapalı (yudum), göğüs önünde gülümseme. Hareket azaltmada ağız oynamaz.
 */
export function stageFace(stage: ExprStage, t: number, calm: boolean, seed = 0): Face {
  switch (stage) {
    case "happy": return "joy";
    case "eat": {
      if (calm) return "munch";
      const u = cyc(t, EAT_CYCLE, seed);
      if (u >= 0.12 && u < 0.3) return "chew"; // ısırık: ağız açık
      if (u < 0.42) return "munch";
      return Math.floor((t + seed) * 7) % 2 === 0 ? "chew" : "munch"; // çiğneme
    }
    case "sip": {
      if (calm) return "sip";
      const u = cyc(t, SIP_CYCLE, seed * 0.76);
      return u >= 0.16 && u < 0.6 ? "sip" : "smile";
    }
    default: return "smile";
  }
}

const smooth = (k: number) => k * k * (3 - 2 * k);

/**
 * İçme kolu (sağ el): bardak göğüs önünden ağza kalkar, eğilir, yudum, iner. Dönüş: bardağın eğimi (rad, 0 dik). Hareket
 * azaltmada el göğüs üstünde, bardak hafif eğik (durağan).
 */
const sipLift = (u: number) => smooth(u < 0.18 ? u / 0.18 : u < 0.55 ? 1 : u < 0.72 ? 1 - (u - 0.55) / 0.17 : 0);
/** Bardağın o anki eğimi (rad, 0 dik; + ağza doğru) — çizim (`propPool.drawHeld` eğimi bunun eksisi). */
export function sipTiltAt(t: number, calm: boolean, seed = 0): number {
  if (calm) return SIP_TILT * 0.3;
  const u = cyc(t, SIP_CYCLE, seed * 0.76);
  return sipLift(u) * SIP_TILT + (u >= 0.18 && u < 0.55 ? Math.sin(((u - 0.18) / 0.37) * Math.PI) * 0.18 : 0);
}
export function sipArms(out: Pose, t: number, calm: boolean, seed = 0): number {
  if (calm) { out.ra = -1.6; out.raz = 0.22; out.hx = 0; return sipTiltAt(t, true); }
  const k = sipLift(cyc(t, SIP_CYCLE, seed * 0.76));
  out.ra = -1.2 - k * 0.95; out.raz = 0.2 + k * 0.1;
  // yudumda baş hafif geriye, göğüs önünde hafif öne (bardağa bakar)
  out.hx = k > 0.6 ? -0.1 * k : 0.06;
  out.la = -0.3; out.laz = 0.06;
  return sipTiltAt(t, false, seed);
}

/**
 * İçecek bitti — keyif işareti (`k`: evrenin başından beri sn): bardak göğüs önüne iner, omuzlar kalkıp iner, baş iki kez
 * hafifçe sallanır ("ohh"). Hareket azaltmada omuzlar hafif kalkık, durağan.
 */
export function savorPose(out: Pose, k: number, calm: boolean): void {
  out.ra = -1.15; out.raz = 0.24; out.la = -0.4; out.laz = 0.1;
  if (calm) { out.by = 0.35; out.hx = -0.06; return; }
  const sh = k < 0.5 ? Math.sin((k / 0.5) * Math.PI) : 0; // omuz kalkışı
  out.by = sh * 0.7;
  out.hx = -0.08 + (k > 0.3 && k < 1.3 ? Math.sin(((k - 0.3) / 1.0) * Math.PI * 2) * 0.12 : 0); // baş sallama
  out.hz = Math.sin(k * 3) * 0.04;
}

/** Elde yiyeceğin kalan payı (ısırıklarla küçülür; 1 → 0,65). `p`: hareket evresindeki ilerleme 0–1. */
export const biteLeft = (p: number) => 1 - 0.35 * Math.min(1, Math.max(0, p));

/** Avatarın etkinlik ifadesi girdisi (`ritualRuntime.ritualFeel` + ritüel saati). Crowd her karede çağırır. */
export function feelStage(feel: { eat: boolean; drink: boolean; joy: boolean; t0: number; settleMs: number; totalMs: number; doneAt: number },
  active: boolean, now: number, moving: boolean): ExprStage {
  return exprStage({
    active, eat: feel.eat, drink: feel.drink, joy: feel.joy, sinceMs: now - feel.t0, settleMs: feel.settleMs, totalMs: feel.totalMs,
    doneAgoMs: feel.doneAt ? now - feel.doneAt : null, moving,
  });
}
