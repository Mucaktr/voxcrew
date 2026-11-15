/**
 * W3 (WALK-UX) — WALK-FUN modüllerine isteğe bağlı köprü (voxel/fun/gifts.ts, minigames.ts; MinigameHud).
 *
 * Modüller henüz yoksa ya da bir dışa aktarım eksikse çağrı sessizce `false` döner; derleme her iki durumda da geçer
 * (`import.meta.glob` eşleşmeyen dosyada boş nesne verir). Sözleşme (WALK-FUN ile anlaşılan):
 *  - `playGift(slug, kind)` · `playMeal(slugs)` · `playReaction(slug, "wave" | "clap" | "highfive")` · `playSelf("coffee")`
 *  - `startMinigame("fishing" | "board" | "toss", { id, x, z, tile })` · `isMinigameActive()`
 *  - `ambientEntities()` (hayvanlar `animal:<n>`, nesneler `hot:<n>`) · `pokeEntity(id)` (mevcut Ambient dokunma tepkileri)
 * Hepsi kozmetiktir: hiçbir koşuyu, tokenı ya da kuyruğu etkilemez.
 */
import type { ComponentType } from "react";
import { tx } from "../../../lib/i18n";
import { walk as WM } from "../../../locales/walk";
import type { ProxEntity } from "../../../voxel/walk/controller";

type Fn = (...args: never[]) => unknown;
type Mod = Record<string, unknown>;

const funMods = import.meta.glob<Mod>("../../../voxel/fun/{gifts,minigames,avatarActs}.ts", { eager: true });
const hudMods = import.meta.glob<Mod>("./minigame/MinigameHud.tsx", { eager: true });

function pick(name: string): Fn | null {
  for (const m of Object.values(funMods)) {
    const f = m?.[name];
    if (typeof f === "function") return f as Fn;
  }
  return null;
}

function call(name: string, ...args: unknown[]): boolean {
  const f = pick(name);
  if (!f) return false;
  try {
    const r = (f as unknown as (...a: unknown[]) => unknown)(...args);
    return r !== false;
  } catch {
    return false;
  }
}

export type ReactionKind = "wave" | "clap" | "highfive";
export type MinigameKind = "fishing" | "board" | "toss";
export interface MinigameSpot { id: string; x: number; z: number; tile: [number, number]; /** HQA-FIX: açılışta olta hemen atılır*/ go?: boolean }

export const fun = {
  gift: (slug: string, kind: string) => call("playGift", slug, kind),
  meal: (slugs: readonly string[]) => call("playMeal", slugs),
  reaction: (slug: string, kind: ReactionKind) => call("playReaction", slug, kind),
  self: (kind: "coffee") => call("playSelf", kind),
  startMinigame: (kind: MinigameKind, spot: MinigameSpot) => call("startMinigame", kind, spot),
  minigameActive: (): boolean => {
    const f = pick("isMinigameActive");
    try { return !!f && !!(f as unknown as () => unknown)(); } catch { return false; }
  },
};

/** `type`: dokunulabilir nesnenin cinsi (tree, flower, lamp, water, aquarium; FIX-UX "nesne, nesne" yerine ad)*/
export interface AmbientEntityLike extends ProxEntity { label?: string; type?: string }
const NO_AMBIENT: readonly AmbientEntityLike[] = Object.freeze([]) as readonly AmbientEntityLike[];
/** Ortam canlıları ve dokunulabilir nesneler (WALK-FUN; konumlar yerinde güncellenir). */
export function ambientEntities(): readonly AmbientEntityLike[] {
  const f = pick("ambientEntities");
  try { return (f ? ((f as unknown as () => readonly AmbientEntityLike[])() ?? NO_AMBIENT) : NO_AMBIENT); } catch { return NO_AMBIENT; }
}
export const isAmbientId = (id: string) => id.startsWith("animal:") || id.startsWith("hot:");
export const pokeAmbient = (id: string) => call("pokeEntity", id);
const HOT_TYPES = new Set(["tree", "flower", "lamp", "water", "aquarium"]);
export function ambientLabel(id: string): string {
  const e = ambientEntities().find((x) => x.id === id);
  if (!e) return "";
  if (e.label) return e.label;
  return e.type && HOT_TYPES.has(e.type) ? tx(WM, `hot_${e.type}` as "hot_tree") : "";
}

/** WALK-FUN mini oyun HUD'u (yoksa null). FISH-FIX: `onFocusWorld` — oyun kapanınca odak dünyaya döner (yürüme tuşları). */
export const MinigameHudBridge: ComponentType<{ onFocusWorld?: () => void }> | null = (() => {
  for (const m of Object.values(hudMods)) {
    const c = m?.MinigameHud;
    if (typeof c === "function") return c as ComponentType<{ onFocusWorld?: () => void }>;
  }
  return null;
})();
