/**
 * WORLD-TOUCH — dokunma tepkilerinin saf dağıtımı (S48 davranışı; yalnızca tablo ve kural, three/React yok):
 *  işaretçi isabeti (hangi katman) → tepki kimliği (duyuru anahtarı) → ses (sfx) + hareket izni.
 * Ambient.tsx bu tabloları kullanır; `scripts/touch_reactions.test.mjs` aynı tabloları ve tıklama yolunu (gölgelenme, engelleme)
 * Node'da denetler. Geliştirme derlemesinde son tepkiler `window.__voxcrewTouch` altında okunur (üretimde yok).
 */
import type { world as M } from "../../locales/world";
import type { Sfx } from "../sfx/sfx";
import type { Kind } from "./kinds";

export type TouchMsg = keyof typeof M.tr;
export type HotKind = "tree" | "flower" | "lamp" | "coffee" | "water" | "aquarium";

/** R3F isabet katmanlarının adları (Ambient.tsx / Crowd.tsx `name`). Durağan nesne hedefi bu ikisine yol verir. */
export const PICK_ANIMAL = "ambient:solid";
export const PICK_HOT = "ambient:hotspots";
export const PICK_AGENT = "crowd:hit";

/** Durağan nesne hedefi (bilerek cömert kutular) aynı ışında hayvan ya da ajan varsa tepki vermez: onlar kazanır. */
export function hotYields(hitNames: readonly string[]): boolean {
  return hitNames.some((n) => n === PICK_ANIMAL || n === PICK_AGENT);
}

/** Dokunuşun izinleri: sakin bölgede (ibadet yeri tamponu, `quiet`) şaka yok — hayvanda yalnız ad etiketi, nesnede hiçbir şey;
 *  hareket azaltmada hareket/parçacık yok ama ses ve etiket var. Ses ayrıca genel ses ayarına bağlıdır (`playSfx`). */
export interface TouchGate { quiet: boolean; reduced: boolean }
export interface TouchPlan { react: boolean; motion: boolean; sound: boolean; label: boolean; nameOnly: boolean }
export function touchPlan(target: "animal" | "hot", g: TouchGate): TouchPlan {
  if (g.quiet) return target === "animal"
    ? { react: false, motion: false, sound: false, label: true, nameOnly: true }
    : { react: false, motion: false, sound: false, label: false, nameOnly: false };
  return { react: true, motion: !g.reduced, sound: true, label: true, nameOnly: false };
}

/** Hayvan türü + ardışık dokunuş sayısı (bu dokunuş dahil) → [duyuru, ses]. Ambient.tsx `react()` hareketi ayrıca kurar. */
export function animalCue(kind: Kind, taps: number, inAquarium = false): [TouchMsg, Sfx | null] {
  switch (kind) {
    case "cat": return taps >= 3 ? ["amb_r_leave", "meowLow"] : taps === 2 ? ["amb_r_roll", "purr"] : ["amb_r_purr", "meow"];
    case "dog": return taps >= 3 ? ["amb_r_dog_run", "bark"] : ["amb_r_dog", "bark"];
    case "bird": return ["amb_r_bird", "chirp"];
    case "gull": return ["amb_r_gull", "squawk"];
    case "pigeon": return ["amb_r_pigeon", "coo"];
    case "duck": return ["amb_r_duck", "quack"];
    case "fish": return inAquarium ? ["amb_r_aquarium", "bubble"] : ["amb_r_fish", "bubble"];
    case "squirrel": return ["amb_r_squirrel", "chitter"];
    case "rabbit": return ["amb_r_rabbit", null];
    case "penguin": return ["amb_r_penguin", null];
    case "deer": return ["amb_r_deer", "rustle"];
    case "owl": return ["amb_r_owl", "hoot"];
    case "firefly": return ["amb_r_firefly", "chime"];
    case "dolphin": return ["amb_r_dolphin", "chitter"];
    case "crab": return ["amb_r_crab", "click"];
    case "vacuum": return ["amb_r_vacuum", "beep"];
    case "robot": return ["amb_r_robot", "beep"];
    case "satellite": return ["amb_r_satellite", "boop"];
    case "shuttle": return ["amb_r_shuttle", "boop"];
  }
}

/** ritüel çekmesinde gelen türler (`fun/rituals` `LureKind` ile aynı adlar).*/
export type LureCueKind = "gull" | "pigeon" | "duck" | "fish" | "cat" | "squirrel";
/** Çekilen hayvan yerine varınca (ya da hareket azaltmada yanına konunca) bir kez çalan ses; `animalCue` (dokunuş) ayrıdır. */
const LURE_CUE: Readonly<Record<LureCueKind, Sfx>> = {
  gull: "squawk", pigeon: "coo", duck: "quack", fish: "bubble", cat: "purr", squirrel: "chitter",
};
/** Tür → çekme sesi; çekilemeyen tür → null. */
export function lureCue(kind: string): Sfx | null {
  return (LURE_CUE as Readonly<Record<string, Sfx>>)[kind] ?? null;
}

/** Nesne parçacığı (fun/fx.ts `burst`); lamba parçacık yerine ampulü karartır. */
export type HotFx = "leaves" | "petals" | "steam" | "splash" | "bubbles" | null;
const HOT: Record<Exclude<HotKind, "lamp">, [TouchMsg, Sfx, HotFx]> = {
  tree: ["amb_r_tree", "rustle", "leaves"],
  flower: ["amb_r_flower", "chime", "petals"],
  coffee: ["amb_r_coffee", "hiss", "steam"],
  water: ["amb_r_water", "splash", "splash"],
  aquarium: ["amb_r_aquarium", "bubble", "bubbles"],
};
/** Durağan nesne → [duyuru, ses, parçacık]. Lambada `turnOff`: bu dokunuş lambayı söndürüyor mu. */
export function hotCue(kind: HotKind, turnOff = false): [TouchMsg, Sfx, HotFx] {
  if (kind === "lamp") return [turnOff ? "amb_r_lamp_off" : "amb_r_lamp_on", "click", null];
  return HOT[kind];
}

// ------------------------------------------------------------------ geliştirme kancası (canlı denetim: tepki gerçekten çalıştı mı)
export interface TouchRecord { at: number; target: "animal" | "hot"; kind: string; msg: TouchMsg | null; sfx: Sfx | null; motion: boolean; quiet: boolean }
const DEV = !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;
const LOG: TouchRecord[] = [];
/** Yalnızca geliştirme derlemesinde: son 50 tepki `window.__voxcrewTouch.log()` / `.last()` ile okunur. */
export function noteTouch(r: Omit<TouchRecord, "at">): void {
  if (!DEV || typeof window === "undefined") return;
  LOG.push({ ...r, at: Math.round(performance.now()) });
  if (LOG.length > 50) LOG.shift();
  const w = window as unknown as { __voxcrewTouch?: { log: () => TouchRecord[]; last: () => TouchRecord | null; clear: () => void } };
  w.__voxcrewTouch ??= { log: () => LOG.slice(), last: () => LOG[LOG.length - 1] ?? null, clear: () => { LOG.length = 0; } };
}
