/**
 * ACTIVITY-FEEL (B6) — yol işareti: şehir rehberinin "Yol göster"i hedefe bir **işaret** (ışıklı sütun) ve avatardan oraya kısa
 * aralıklı **yol noktaları** koyar. Hedefe yürümek ve oradaki işi yapmak oyuncudadır (rehber işi kendisi yapmaz; rota planlanır,
 * avatar yürütülmez). Avatar hedefe varınca işaret kalkar.
 *
 * Çizim Crowd'un var olan eşya havuzunda (`propPool`, ışıklı yuvalar; +0 çizim çağrısı). Hareket azaltmada işaret durağan (nabız
 * yok). Rota yarım saniyede bir yeniden planlanır (`planRoute`; tıkla-git ile aynı).
 */
import { create } from "zustand";
import { pbox, type PropPool } from "../fun/propPool";
import { C } from "../fun/fx";
import { planRoute, tileAt } from "./controller";
import { tx, tz, type Built, type Tile } from "../scenes";
import { walkRuntime } from "./walkStore";

export interface Waypoint { x: number; z: number; /** gösterilen ad (keşfedilmediyse "gizli yer") */ name: string; world: string }
export type WaypointEnd = "arrived" | "cleared" | "left" | null;
export const useWaypoint = create<{ wp: Waypoint | null; ended: WaypointEnd }>(() => ({ wp: null, ended: null }));

/** Hedefe bu kadar yaklaşınca varılmış sayılır (birim). */
export const WAYPOINT_ARRIVE = 1.6;
/** Yol noktası aralığı (karo) ve en çok nokta. */
export const WAYPOINT_STEP = 2;
export const WAYPOINT_DOTS = 14;

export function setWaypoint(wp: Waypoint): void { useWaypoint.setState({ wp, ended: null }); cache.key = ""; }
export function clearWaypoint(why: Exclude<WaypointEnd, null> = "cleared"): void {
  if (useWaypoint.getState().wp) useWaypoint.setState({ wp: null, ended: why });
}

const cache: { key: string; at: number; path: Tile[] } = { key: "", at: 0, path: [] };

/** Avatar hedefe vardı mı (saf; test). */
export const waypointReached = (wp: Pick<Waypoint, "x" | "z">, a: { x: number; z: number }) => Math.hypot(wp.x - a.x, wp.z - a.z) <= WAYPOINT_ARRIVE;

/** Rota noktaları: rotanın her `WAYPOINT_STEP`. karosu (ilk ve son hariç), en çok `WAYPOINT_DOTS`. Saf (test). */
export function waypointDots(path: readonly Tile[]): Tile[] {
  const out: Tile[] = [];
  for (let k = WAYPOINT_STEP; k < path.length - 1 && out.length < WAYPOINT_DOTS; k += WAYPOINT_STEP) out.push(path[k]);
  return out;
}

/**
 * Kare başı: varışı denetler, rotayı tazeler ve işareti + noktaları havuza yazar. `world`: geçerli yürüme dünyası (değişince işaret
 * kalkar). Yürüme kapalıyken çağrılmaz.
 */
export function drawWaypoint(pp: PropPool, built: Built, world: string | null, t: number, calm: boolean, now = performance.now()): void {
  const wp = useWaypoint.getState().wp;
  if (!wp) return;
  if (world !== wp.world) { clearWaypoint("left"); return; }
  const a = walkRuntime.avatar;
  if (waypointReached(wp, a)) { clearWaypoint("arrived"); return; }
  const at = tileAt(a.x, a.z), goal = tileAt(wp.x, wp.z), k = `${at[0]},${at[1]}>${goal[0]},${goal[1]}`;
  if (k !== cache.key || now - cache.at > 1500) {
    cache.key = k; cache.at = now;
    cache.path = planRoute(built, a, goal)?.path ?? [];
  }
  const y0 = walkRuntime.drawY;
  for (const d of waypointDots(cache.path)) pbox(pp, true, tx(d[0]), y0 + 0.04, tz(d[1]), 0.16, 0.04, 0.16, Math.PI / 4, 0, 0, C.yellow);
  // işaret: ince ışıklı sütun + tepede elmas (hareket azaltmada durağan)
  const bob = calm ? 0 : Math.sin(t * 2.4) * 0.12;
  pbox(pp, true, wp.x, 1.1, wp.z, 0.08, 2.2, 0.08, 0, 0, 0, C.yellow);
  pbox(pp, true, wp.x, 2.55 + bob, wp.z, 0.3, 0.3, 0.3, calm ? 0 : t * 1.5, Math.PI / 4, 0, C.gold);
  pbox(pp, true, wp.x, 0.03, wp.z, 0.7, 0.04, 0.7, Math.PI / 4, 0, 0, C.gold);
}
