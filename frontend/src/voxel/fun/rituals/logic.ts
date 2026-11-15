/**
 * ritüellerin saf mantığı: görünürlük kuralı, adım planı (hareket azaltmada
 * durağan), görsel soğuma ve konum çözümü. three, React ve depo yok; çalışma zamanı `fun/ritualRuntime.ts`.
*/
import type { CityMapFile } from "../../citymap/format";
import type { HeldItem, LureKind, LureMode, RitualBurst, RitualDef, RitualMotion, RitualSit } from "./index";
import type { Sfx } from "../../sfx/sfx";

/** Aynı ritüel bu süre içinde yinelenemez (yalnız görsel: hayvanlar sürekli çekilmesin). */
export const RITUAL_COOLDOWN_MS = 20_000;
/** Dönme ve oturma payı (ms; hareket azaltmada 0). */
export const RITUAL_SETTLE_MS = 450;
/** Hayvana bağlı ritüelin görünme menzili (birim; avatar ile hayvan arası). */
export const RITUAL_ANIMAL_RANGE = 2.5;
/** ACTIVITY-FEEL (B3): yemek bitince sevinç süresi (ms; ritüel süresinin sonu; küçük sekme + mutlu yüz; hareket azaltmada durağan
 *  kol ve mutlu yüz). */
export const RITUAL_JOY_MS = 1400;
/** Yiyecek sayılan elde nesneler (`sip` + bunlar → yemek hareketi). Çay kâsesi gibi istisnalar `act.eat: false`. */
export const FOOD_ITEMS: ReadonlySet<HeldItem> = new Set<HeldItem>(["simit", "crepe", "sandwich", "paper_cone", "hotdog", "bento", "bowl", "snack", "meal"]);
/** Ritüel bir yeme anı mı (yemek hareketi ve bitince sevinç). */
export function isEatAct(def: Pick<RitualDef, "act">): boolean {
  const a = def.act;
  if (a.eat !== undefined) return a.eat;
  return a.motion === "eat" || (a.motion === "sip" && !!a.held && FOOD_ITEMS.has(a.held));
}

// ------------------------------------------------------------------ görünürlük
export interface RitualCtx {
  /** etkin gece (ışık kipi ya da otomatikte yerel saat) */
  night: boolean;
  /** var olan gün batımı kuralı (`citymap/store.ts sunsetNow`: akşam saatleri ya da Gece ışığı) */
  dusk: boolean;
  /** konum (ya da fotoğraf ritüelinde fotoğraf odağı) sessiz/kutsal bölgede */
  quiet: boolean;
  /** yolculuk sürüyor (`walkRuntime.ride`: çark, araç) */
  riding: boolean;
  /** mini oyun açık */
  minigame: boolean;
}
export type RitualBlock = "quiet" | "ride" | "minigame" | "time";

/** Girdiyi kapatan ilk neden (null → görünür). Sessiz bölge her şeyden önce gelir (`touchPlan(quiet)` kuralı). */
export function ritualBlock(def: Pick<RitualDef, "when">, ctx: RitualCtx): RitualBlock | null {
  if (ctx.quiet) return "quiet";
  if (ctx.riding) return "ride";
  if (ctx.minigame) return "minigame";
  const w = def.when ?? "any";
  if (w === "day" && ctx.night) return "time";
  if (w === "night" && !ctx.night) return "time";
  if (w === "dusk" && !ctx.dusk) return "time";
  return null;
}
export const ritualAvailable = (def: Pick<RitualDef, "when">, ctx: RitualCtx): boolean => ritualBlock(def, ctx) === null;

// ------------------------------------------------------------------ soğuma
/** Kalan soğuma (ms; 0 → yeniden yapılabilir). `lastAt`: son bitişin zamanı (aynı saat, ör. performance.now()). */
export function cooldownLeft(lastAt: number | null | undefined, now: number, cooldown = RITUAL_COOLDOWN_MS): number {
  if (lastAt == null || !Number.isFinite(lastAt)) return 0;
  return Math.max(0, lastAt + cooldown - now);
}

// ------------------------------------------------------------------ plan
export type RitualPhase = "settle" | "act" | "joy" | "done";
export interface RitualStep { phase: RitualPhase; /** başlangıçtan ms */ at: number }
export interface RitualLurePlan { kinds: readonly LureKind[]; n: number; mode: LureMode; /** hareket azaltma: yönlendirme yok, anında dinlenme pozu */ still: boolean }
export interface RitualPlan {
  calm: boolean;
  settleMs: number;
  actMs: number;
  totalMs: number;
  /** avatarın oynattığı hareket; null → durağan poz (hareket azaltma) */
  motion: RitualMotion | null;
  sit: RitualSit | null;
  held: HeldItem | null;
  lure: RitualLurePlan | null;
  /** parçacık patlaması; hareket azaltmada yok */
  burst: RitualBurst | null;
  /** ses ve metin hareket azaltmada aynen kalır */
  sfx: Sfx | null;
  /** ACTIVITY-FEEL (B3): yeme anı — avatar yemek hareketi oynatır, bitince `joyMs` boyunca sevinç (`joy` evresi) */
  eat: boolean;
  joyMs: number;
  steps: readonly RitualStep[];
}

/** Adımlar: dön/otur (`settle`) → hareket ve tepki (`act`) → (yemekte, sürenin sonunda) sevinç (`joy`) → bitiş duyurusu (`done`). */
export function ritualPlan(def: Pick<RitualDef, "act" | "react">, reduced: boolean): RitualPlan {
  const settleMs = reduced ? 0 : RITUAL_SETTLE_MS;
  const actMs = Math.round(Math.max(0, def.act.secs) * 1000);
  const lure = def.react?.lure;
  // sevinç ritüel süresinin içindedir (son `RITUAL_JOY_MS`, en çok yarısı): toplam süre veri süresiyle aynı kalır
  const eat = isEatAct(def), joyMs = eat ? Math.min(RITUAL_JOY_MS, Math.round(actMs / 2)) : 0;
  const steps: RitualStep[] = [{ phase: "settle", at: 0 }, { phase: "act", at: settleMs }];
  if (joyMs) steps.push({ phase: "joy", at: settleMs + actMs - joyMs });
  steps.push({ phase: "done", at: settleMs + actMs });
  return {
    calm: reduced,
    settleMs, actMs, totalMs: settleMs + actMs,
    // `motion` veri hareketidir (sözleşme); yemek hareketi `eat` bayrağından (Crowd `sip` yerine yemek oynatır)
    motion: reduced ? null : def.act.motion,
    sit: def.act.sit ?? null,
    held: def.act.held ?? null,
    lure: lure ? { kinds: lure.kinds, n: lure.n, mode: lure.mode, still: reduced } : null,
    burst: reduced ? null : def.react?.burst ?? null,
    sfx: def.react?.sfx ?? null,
    eat, joyMs,
    steps,
  };
}
/** Plandaki evre (`t`: başlangıçtan ms). */
export function ritualPhaseAt(plan: RitualPlan, t: number): RitualPhase {
  let p: RitualPhase = "settle";
  for (const s of plan.steps) if (t >= s.at) p = s.phase;
  return p;
}

// ------------------------------------------------------------------ konum
export interface RitualAnchor {
  /** bağlantı sırası (Yakındakiler kimliğindeki `n`) */
  n: number;
  x: number;
  z: number;
  /** avatar bakışı (rad); null → avatar konuma doğru döner */
  face: number | null;
  /** HQA-FIX: satış arabasının yönü (rad; satıcı figüranı arabanın ardında) — mekânsız "al" ritüelleri*/
  cart?: number;
}
type ToWorld = (i: number, j: number) => readonly [number, number];
export interface AnimalLike { x: number; z: number; type?: string }
export type AnchorSource =
  | { kind: "scene"; toWorld: ToWorld; animals?: readonly AnimalLike[]; near?: { x: number; z: number } }
  | { kind: "map"; map: Pick<CityMapFile, "districts" | "stops">; toWorld: ToWorld; animals?: readonly AnimalLike[]; near?: { x: number; z: number } };

/**
 * Ritüelin dünyadaki konumları. Sahne: `at.scene` karoları (taban kayması `toWorld` içinde). Harita: `at.map` bağlantıları —
 * durak karosu, landmark kapısı (yoksa ayak izinin ortası) ya da semt girişi (yoksa semt ortası); bulunamayan bağlantı atlanır.
 * Hayvana bağlı ritüel: `near` noktasına `RITUAL_ANIMAL_RANGE` içindeki o türden hayvanlar (sıra = liste sırası).
 */
export function anchorsOf(def: Pick<RitualDef, "at">, src: AnchorSource): RitualAnchor[] {
  const out: RitualAnchor[] = [];
  if (def.at.animal) {
    const near = src.near;
    (src.animals ?? []).forEach((a, k) => {
      if (a.type !== def.at.animal || !near) return;
      if (Math.hypot(a.x - near.x, a.z - near.z) <= RITUAL_ANIMAL_RANGE) out.push({ n: k, x: a.x, z: a.z, face: null });
    });
    return out;
  }
  if (src.kind === "scene") {
    (def.at.scene ?? []).forEach((s, n) => {
      const [x, z] = src.toWorld(s.tile[0], s.tile[1]);
      out.push({ n, x, z, face: s.face, ...(s.cart !== undefined ? { cart: s.cart } : {}) }); // HQA-FIX: cart
    });
    return out;
  }
  (def.at.map ?? []).forEach((m, n) => {
    const d = src.map.districts.find((q) => q.id === m.district);
    if (!d) return;
    let t: [number, number] | null = null;
    if (m.tile) t = [d.bounds[0] + m.tile[0], d.bounds[1] + m.tile[1]];
    else if (m.stop) {
      const s = src.map.stops.find((q) => q.id === m.stop && q.district === m.district);
      if (s) t = [d.bounds[0] + s.tile[0], d.bounds[1] + s.tile[1]];
    } else if (m.landmark) {
      const l = d.landmarks.find((q) => q.id === m.landmark);
      if (l) t = l.door ? [d.bounds[0] + l.door[0], d.bounds[1] + l.door[1]] : [d.bounds[0] + l.tile[0] + (l.w - 1) / 2, d.bounds[1] + l.tile[1] + (l.d - 1) / 2];
    } else {
      const e = d.entries[0];
      t = e ? [d.bounds[0] + e[0], d.bounds[1] + e[1]] : [d.bounds[0] + (d.bounds[2] - 1) / 2, d.bounds[1] + (d.bounds[3] - 1) / 2];
    }
    if (!t) return;
    const [x, z] = src.toWorld(t[0], t[1]);
    out.push({ n, x, z, face: null, ...(m.cart !== undefined ? { cart: m.cart } : {}) }); // HQA-FIX: cart
  });
  return out;
}
