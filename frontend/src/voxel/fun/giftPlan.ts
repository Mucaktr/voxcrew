/**
 * W3 (WALK-FUN) — hediye koreografisi ve kozmetik keyif eşlemesi: SAF işlevler (three/React yok; testler esbuild ile yükler).
 *
 * Koreografi bir adım listesidir (`giftSteps`); `giftAt(steps, geçen)` o anki adımı verir. Boştaki ajan eşyayı alır, kullanır
 * (okur, yudumlar, yer, masaya koyar) ve kısa bir tepki verir. Çalışan ajanda iş kazanır (§7.1 P2): eşya masaya bırakılır,
 * ajan yalnızca başını kaldırıp ≤ 1 sn el sallar; tüketim sonra, boşta kalınca oynar (`deferred`).
 *
 * Keyif (§7.3): üç kademe (0 nötr · 1 keyifli · 2 çok keyifli), hiçbir zaman nötrün altında değil. Gerçek ruh hâli (çalışıyor,
 * hata, onay bekliyor…) her zaman kazanır: gösterge yalnızca boşta ya da "✓ bitti" durumunu süsler. Odak modunda gizli;
 * hareket azaltmada statik rozet, parıltı ve hızlı yürüme yok. Yalnızca görseldir.
 */

export type GiftKind = "note" | "coffee" | "tea" | "snack" | "meal" | "dessert" | "plant" | "trophy";
export const GIFT_KINDS: readonly GiftKind[] = ["note", "coffee", "tea", "snack", "meal", "dessert", "plant", "trophy"];
export type ReactionKind = "wave" | "clap" | "highfive";

/** Bilinmeyen tür (`thanks`, `cosmetic:*`, …) kart uzatma (`note`) sayılır. */
export function normalizeGiftKind(kind: unknown): GiftKind {
  if (kind === "thanks") return "note";
  return typeof kind === "string" && (GIFT_KINDS as readonly string[]).includes(kind) ? (kind as GiftKind) : "note";
}

export const isConsumable = (k: GiftKind) => k === "coffee" || k === "tea" || k === "snack" || k === "meal" || k === "dessert";
export const isKeepsake = (k: GiftKind) => k === "plant" || k === "trophy";
/** "enerjik" görsel veren içecekler (20 dk) */
export const isCaffeine = (k: GiftKind) => k === "coffee" || k === "tea";

/** Eşyanın konumu: verende, uçuşta (verenden alana), alanın elinde, ağız hizasında, masada, yok. */
export type ItemAt = "giver" | "flying" | "hand" | "mouth" | "desk" | "none";
export type GiftPhase = "deliver" | "receive" | "use" | "place" | "react" | "glance";
/** Ajan hareketi (Character `Motion` alt kümesi; `glance` oturduğu yerde başını kaldırıp el sallama, `clap` alkış). */
export type GiftMotion = "idle" | "read" | "sip" | "cheer" | "clap" | "wave" | "glance" | "highfive";

export interface GiftStep { phase: GiftPhase; dur: number; motion: GiftMotion; item: ItemAt }

export interface GiftOpts {
  /** ajan çalışıyor / düşünüyor: iş kazanır */
  busy: boolean;
  /** veren: avatar yakındaysa avatar, değilse kurye (kutu masaya iner) */
  giver: "avatar" | "courier";
}

/** ≤ 1 sn: çalışan ajanın bakıp el sallaması (§5.1) */
export const GLANCE_S = 0.9;

/** Adım listesi. Toplam süre boşta ≤ 8 sn (yemek ≤ 12 sn), çalışanda ≤ 2 sn. */
export function giftSteps(kind: GiftKind, o: GiftOpts): GiftStep[] {
  const fly = o.giver === "avatar" ? 0.8 : 1.1;
  if (o.busy) {
    // iş kazanır: eşya masaya iner, ajan yalnızca başını kaldırır (≤ 1 sn); tüketim sonra (deferred)
    return [
      { phase: "deliver", dur: fly, motion: "idle", item: "flying" },
      { phase: "glance", dur: GLANCE_S, motion: "glance", item: "desk" },
    ];
  }
  const out: GiftStep[] = [
    { phase: "deliver", dur: fly, motion: "idle", item: "flying" },
    { phase: "receive", dur: 0.4, motion: "idle", item: "hand" },
  ];
  switch (kind) {
    case "note":
      out.push({ phase: "use", dur: 1.6, motion: "read", item: "hand" }, { phase: "react", dur: 1.2, motion: "cheer", item: "none" });
      break;
    case "coffee": case "tea":
      out.push({ phase: "use", dur: 3.0, motion: "sip", item: "mouth" }, { phase: "react", dur: 0.8, motion: "idle", item: "hand" });
      break;
    case "snack":
      out.push({ phase: "use", dur: 2.4, motion: "sip", item: "mouth" }, { phase: "react", dur: 1.0, motion: "cheer", item: "none" });
      break;
    case "dessert":
      out.push({ phase: "use", dur: 2.4, motion: "sip", item: "mouth" }, { phase: "react", dur: 1.4, motion: "clap", item: "none" });
      break;
    case "meal":
      out.push({ phase: "use", dur: 8, motion: "sip", item: "mouth" }, { phase: "react", dur: 1.0, motion: "cheer", item: "none" });
      break;
    case "plant": case "trophy":
      out.push({ phase: "place", dur: 1.0, motion: "idle", item: "desk" }, { phase: "react", dur: 1.3, motion: kind === "trophy" ? "cheer" : "clap", item: "desk" });
      break;
  }
  return out;
}

/** Çalışan ajana verilen tüketim: masada bekler ve ajan boşta kalınca kullanılır. */
export const deferredUse = (kind: GiftKind, busy: boolean) => busy && isConsumable(kind);

export const stepsTotal = (steps: readonly GiftStep[]) => steps.reduce((s, x) => s + x.dur, 0);

/** Geçen süreye göre adım; bitince null. `u`: adım içi ilerleme (0–1). */
export function giftAt(steps: readonly GiftStep[], elapsed: number): { i: number; step: GiftStep; u: number } | null {
  if (!(elapsed >= 0)) elapsed = 0;
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    const d = steps[i].dur;
    if (elapsed < acc + d) return { i, step: steps[i], u: d > 0 ? (elapsed - acc) / d : 1 };
    acc += d;
  }
  return null;
}

// ------------------------------------------------------------------ tepkiler
export interface ReactionPlan { motion: GiftMotion; dur: number }
/** Boştaki ajan tam tepki; çalışan yalnızca ≤ 1 sn bakıp el sallar; hata / onay / çevrimdışı: tepki yok (gerçek durum kazanır). */
export function reactionPlan(kind: ReactionKind, mood: string): ReactionPlan | null {
  if (mood === "error" || mood === "waiting" || mood === "offline") return null;
  if (mood === "working" || mood === "thinking") return { motion: "glance", dur: GLANCE_S };
  if (kind === "wave") return { motion: "wave", dur: 1.8 };
  if (kind === "clap") return { motion: "clap", dur: 1.8 };
  return { motion: "highfive", dur: 1.5 };
}

// ------------------------------------------------------------------ keyif
export type MoraleLevel = 0 | 1 | 2;
/** Ham keyif değeri → 0/1/2. Bilinmeyen, negatif ya da bozuk → 0 (nötr); asla nötrün altı yok. */
export function moraleOf(v: unknown): MoraleLevel {
  const l = typeof v === "object" && v !== null ? (v as { level?: unknown }).level : v;
  if (l === "delighted" || l === 2) return 2;
  if (l === "pleased" || l === 1) return 1;
  if (typeof l === "number" && Number.isFinite(l)) return l >= 2 ? 2 : l >= 1 ? 1 : 0;
  return 0;
}

/** Gerçek ruh hâlleri: yalnızca bunlarda keyif katmanı görünür (boşta, "✓ bitti"). */
const DECORATES = new Set(["idle", "done"]);

export interface MoodVisualIn {
  /** sunucu keyfi*/
  morale: unknown;
  /** gerçek ruh hâli (`live` deposu: idle, working, thinking, waiting, error, done, offline) */
  realMood: string;
  /** enerjik süresinin bitişi (ms, Date.now ekseni) */
  pepUntil: number;
  now: number;
  /** yürüme modu açık */
  walk: boolean;
  /** odak modu (`game.focus`) */
  focus: boolean;
  /** hareket azaltma */
  calm: boolean;
}
export interface MoodVisual {
  /** baş üstü rozet: 0 yok (nötr), 1 keyifli, 2 çok keyifli */
  badge: MoraleLevel;
  /** enerjik işareti (rozetin yanında; hareket azaltmada da statik gösterilir) */
  energized: boolean;
  /** rozet salınımı ve masadaki parıltı (hareket azaltmada yok) */
  animate: boolean;
  /** yürüme animasyonu hız çarpanı (enerjik ve hareket serbestken 1,12; aksi 1) */
  walkScale: number;
}
export const NO_MOOD: MoodVisual = Object.freeze({ badge: 0, energized: false, animate: false, walkScale: 1 }) as MoodVisual;
/** "enerjik" süresi (§7.1 kahve/çay: 20 dk) */
export const PEP_MS = 20 * 60 * 1000;
export const PEP_WALK = 1.12;

export function moodVisual(i: MoodVisualIn): MoodVisual {
  if (i.focus || !i.walk || !DECORATES.has(i.realMood)) return NO_MOOD;
  const pep = i.pepUntil > i.now;
  const lvl = moraleOf(i.morale);
  // enerjik ama sunucu henüz nötr (olay gecikmesi): en az "keyifli"
  const badge: MoraleLevel = pep && lvl === 0 ? 1 : lvl;
  if (!badge && !pep) return NO_MOOD;
  return { badge, energized: pep, animate: !i.calm, walkScale: pep && !i.calm ? PEP_WALK : 1 };
}

/** Yürüme hız çarpanı: yalnızca boşta/bitti ve enerjikken, hareket serbestken (iş yürüyüşü de aynı hızda kalır: kozmetik). */
export function pepWalkScale(pepUntil: number, now: number, calm: boolean, focus: boolean): number {
  return pepUntil > now && !calm && !focus ? PEP_WALK : 1;
}

// ------------------------------------------------------------------ yineleme süzgeci
/** Aynı ajan + tür `windowS` içinde bir kez oynar (WALK-UX çağrısı ve SSE olayı ikisi de gelir). */
export class Dedupe {
  private seen = new Map<string, number>();
  constructor(private windowS = 8) {}
  accept(key: string, t: number): boolean {
    for (const [k, at] of this.seen) if (t - at > this.windowS) this.seen.delete(k);
    const at = this.seen.get(key);
    if (at !== undefined && t - at <= this.windowS) return false;
    this.seen.set(key, t);
    return true;
  }
}
