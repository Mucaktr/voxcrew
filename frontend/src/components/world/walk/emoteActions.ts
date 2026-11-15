/**
 * W5 (WALK-W5) — emote eylemi (G çarkı, 1–6, dokunmatikte uzun basma): avatar duruşu (`voxel/walk/emotes.ts`), yakındaki
 * boştaki ajanların kozmetik karşılığı (`playReaction`, WALK-FUN köprüsü; çalışan ajan yalnızca başını kaldırır) ve ekran
 * okuyucu duyurusu. Kutsal ve sessiz bölgede emote yoktur (§3.4, `inQuietZone`); fotoğraf modunda da yoktur.
 * Hiçbir koşuyu, tokenı, kuyruğu ya da ödülü etkilemez.
 */
import { tx } from "../../../lib/i18n";
import { walk as WM } from "../../../locales/walk";
import { inQuietZone } from "../../../voxel/fun/brain";
import { reactionPlan } from "../../../voxel/fun/giftPlan";
import { EMOTE_SPEC, EMOTES, reactors, startEmote, type EmoteKind } from "../../../voxel/walk/emotes";
import { useWalkStore, walkRuntime } from "../../../voxel/walk/walkStore";
import { announceWalk } from "./announce";
import { fun } from "./funBridge";

export type EmoteResult = "ok" | "quiet" | "off";

/** Emote'u oynatır (sıra numarası 0–5 ya da tür). */
export function doEmote(which: number | EmoteKind): EmoteResult {
  const kind: EmoteKind | undefined = typeof which === "number" ? EMOTES[which] : which;
  const st = useWalkStore.getState();
  if (!kind || !st.active || st.photo) return "off";
  const a = walkRuntime.avatar;
  if (inQuietZone(a.x, a.z)) { announceWalk(tx(WM, "emote_quiet")); return "quiet"; }
  // W5: oturur ya da mini oyundayken Crowd emote'u çizmez → duyurulmaz da
  if (fun.minigameActive() || (walkRuntime.sit && kind !== "sit")) { announceWalk(tx(WM, "emote_busy")); return "off"; }
  // tıkla-git sürüyorsa durur (emote yerinde oynar)
  if (st.target) st.setTarget(null);
  a.route = null;
  startEmote(kind, performance.now());
  st.setEmote(kind);
  const react = EMOTE_SPEC[kind].react;
  let n = 0;
  // W5: hepsine gönderilir (çalışan ajan başını kaldırır) ama yalnız gerçekten karşılık veren (boştaki) sayılır
  const moods = walkRuntime.moods;
  if (react) for (const slug of reactors(st.nearby, kind)) {
    if (!fun.reaction(slug, react)) continue;
    const plan = reactionPlan(react, moods?.get(slug) ?? "idle");
    if (plan && plan.motion !== "glance") n++;
  }
  announceWalk(n ? tx(WM, "emote_done_react", { emote: tx(WM, `emote_${kind}` as const), n }) : tx(WM, "emote_done", { emote: tx(WM, `emote_${kind}` as const) }));
  return "ok";
}
