/**
 * W5 (WALK-W5) — "Ben" avatarının emote'ları.
 *
 * Altı emote (hepsi ücretsiz, kozmetik): el salla, dans, sevinç, otur, gül, düşün. Mevcut karakter hareketleri kullanılır
 * (`Motion`: wave, dance, victory, clap, think; oturma W3'ün `walkRuntime.sit` yolu). Crowd avatar duruşunu `emoteMotion` ile
 * alır; avatar yürümeye başlayınca WalkRig `cancelEmote` çağırır. Hareket azaltmada duruş durağandır (Crowd zamanı dondurur).
 *
 * Saf modül: React, three ve WALK-FUN içe aktarılmaz (Node testinde yüklenir). Yakındaki ajanların karşılık vermesi
 * (`playReaction`, kozmetik) HUD katmanında yapılır; kutsal/sessiz bölge denetimi de orada (`inQuietZone`).
*/
import type { Motion } from "../Character";
import { EMOTES, walkRuntime, type EmoteKind } from "./walkStore";

export { EMOTES, type EmoteKind };

export interface EmoteSpec {
  motion: Motion;
  /** süre (ms); 0 = avatar hareket edene dek (otur) */
  ms: number;
  /** gülen yüz */
  happy: boolean;
  /** yakındaki boştaki ajanların karşılığı (kozmetik; null = yok) */
  react: "wave" | "clap" | null;
}

export const EMOTE_SPEC: Readonly<Record<EmoteKind, EmoteSpec>> = Object.freeze({
  wave: { motion: "wave", ms: 2600, happy: true, react: "wave" },
  dance: { motion: "dance", ms: 6000, happy: true, react: "clap" },
  cheer: { motion: "victory", ms: 2800, happy: true, react: "clap" },
  sit: { motion: "sit", ms: 0, happy: false, react: null },
  laugh: { motion: "clap", ms: 2600, happy: true, react: null },
  think: { motion: "think", ms: 4000, happy: false, react: null },
});

/** Karşılık verecek ajanların en büyük uzaklığı (birim) ve sayısı. */
export const REACT_RADIUS = 5;
export const REACT_MAX = 3;

/**
 * Emote'u başlatır (avatar duruşu). `now` = performance.now() ms. Oturma, W3'ün oturma yolunu kullanır (zemin oturuşu,
 * avatarın olduğu yerde); avatar yürüyünce Crowd oturuşu bitirir. Dönüş: başlatılan kayıt.
 */
export function startEmote(kind: EmoteKind, now: number): { kind: EmoteKind; t0: number; until: number } {
  const spec = EMOTE_SPEC[kind];
  const rec = { kind, t0: now, until: spec.ms ? now + spec.ms : Infinity };
  walkRuntime.emote = rec;
  if (kind === "sit") {
    const a = walkRuntime.avatar;
    walkRuntime.sit = { pose: "sit_ground", x: a.x, z: a.z, heading: a.heading };
  }
  return rec;
}

/** Emote'u bitirir (yürüme girdisi, moddan çıkış). Emote'un başlattığı oturuşu da kaldırır. */
export function cancelEmote(): void {
  const e = walkRuntime.emote;
  if (!e) return;
  walkRuntime.emote = null;
  if (e.kind === "sit" && walkRuntime.sit?.pose === "sit_ground") walkRuntime.sit = null;
}

/** Kare başı (Crowd): oynayan emote'un hareketi, fazı ve yüzü; bittiyse kaydı temizler. Oturma `walkRuntime.sit` ile çizilir. */
export function emoteMotion(now: number): { motion: Motion; happy: boolean; elapsed: number } | null {
  const e = walkRuntime.emote;
  if (!e) return null;
  if (now >= e.until) { walkRuntime.emote = null; return null; }
  if (e.kind === "sit") return null;
  const spec = EMOTE_SPEC[e.kind];
  return { motion: spec.motion, happy: spec.happy, elapsed: (now - e.t0) / 1000 };
}

/** Yakındakiler listesinden karşılık verecek ajan kimlikleri (en yakın `REACT_MAX`, `REACT_RADIUS` içinde). */
export function reactors(nearby: readonly { id: string; kind: string; dist: number }[], kind: EmoteKind): string[] {
  if (!EMOTE_SPEC[kind].react) return [];
  const out: string[] = [];
  for (const n of nearby) {
    if (n.kind !== "agent" || n.dist > REACT_RADIUS || n.id.startsWith("ext:")) continue;
    out.push(n.id);
    if (out.length >= REACT_MAX) break;
  }
  return out;
}
