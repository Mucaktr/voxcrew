/**
 * STUCK-FIX (WALK-STUCK-001) — güvenlik ağının çalışma zamanı yapıştırıcısı (saf mantık `safeSpot.ts`'te).
 *
 *  - `safeStep`: WalkRig her karede avatar adımından sonra çağırır: kat/dünya anahtarı, tetik karoları (merdiven, boşluk ağzı, kapı)
 *    ve kat girişi buradan gelir; kurtarma gerekiyorsa kapı/portal geçişiyle aynı kararma (interiors/store.ts `transition`; hareket
 *    azaltmada anlık) altında avatar son güvenli karoya konur ve ekran okuyucuya duyurulur.
 *  - `requestRescue`: "Takıldım" (U tuşu → `UNSTUCK_EVENT`, HUD düğmesi) — bir sonraki adımda her zaman son güvenli karoya ışınlar.
 *  - Geliştirme kancası `window.__voxcrewStuck` (yalnız DEV): durum, gömme (canlı deneme) ve kurtarma isteği.
 */
import { tx as tr } from "../../lib/i18n";
import { walk as WM } from "../../locales/walk";
import { announceWalk } from "../../components/world/walk/announce";
import type { Built, Tile } from "../scenes";
import { spawnTile, type AvatarState, type ExtraBlock, type MoveInput, type NavGrid } from "./controller";
import { createSafeState, placeAvatar, safeTick, type RescueTarget } from "./safeSpot";
import { useWalkStore, walkRuntime } from "./walkStore";
import { arrivalFor } from "../interiors/sceneModel";
import { doorsInWorld, transition, useInterior } from "../interiors/store";

export const safeRuntime = createSafeState();

/** "Takıldım": bir sonraki karede son güvenli karoya (yoksa kat girişine). */
export function requestRescue() { safeRuntime.request = true; }

const avoidCache = new WeakMap<object, Set<string>>();
function avoidSet(owner: object, tiles: () => Tile[]): Set<string> {
  let s = avoidCache.get(owner);
  if (!s) { s = new Set(tiles().map((t) => `${t[0]},${t[1]}`)); avoidCache.set(owner, s); }
  return s;
}

export interface SafeStepOptions { dt: number; input: MoveInput; radius: number; extra?: ExtraBlock }

/** Kare başı (WalkRig, avatar adımından sonra; fotoğraf/binme dışında). */
export function safeStep(nav: NavGrid, built: Built, a: AvatarState, o: SafeStepOptions) {
  const iv = useInterior.getState();
  if (iv.busy) return;
  const lv = iv.view?.level ?? null;
  const ws = useWalkStore.getState();
  const off = walkRuntime.baseOffset;
  const key = lv ? `in:${lv.key}` : `out:${ws.world ?? ""}:${off[0]},${off[1]}:${built.width}x${built.depth}`;
  const avoid = lv
    ? avoidSet(lv, () => [...lv.stairs.map((s) => s.tile), ...lv.portals.map((p) => p.tile)])
    : ws.world ? avoidSet(built, () => doorsInWorld(ws.world!, off).map((d) => d.tile)) : null;
  const t = safeTick(safeRuntime, {
    nav, a, dt: o.dt, input: o.input, radius: o.radius, extra: o.extra, key,
    avoid: avoid ? (i, j) => avoid.has(`${i},${j}`) : undefined,
    entry: () => (lv && iv.plan ? arrivalFor(iv.plan.levels, lv.index, lv.index) : spawnTile(built)?.tile ?? null),
    // oturuş/binme sırasında kendiliğinden itme ve otomatik kurtarma yok ("Takıldım" çalışır)
    auto: !walkRuntime.sit && !walkRuntime.ride,
  });
  if (t) applyRescue(a, t);
}

function applyRescue(a: AvatarState, t: RescueTarget) {
  const put = () => {
    placeAvatar(a, t);
    walkRuntime.drawY = t.y;
    useWalkStore.getState().setTarget(null);
  };
  // kapı/portal kararmasıyla aynı (hareket azaltmada anlık); başka geçiş sürüyorsa hemen konur
  if (useInterior.getState().busy) put();
  else transition(put);
  announceWalk(tr(WM, t.reason === "manual" ? "stuck_ann" : "stuck_auto_ann"));
}

// geliştirme kancası (ekran görüntüsü / canlı deneme betikleri); üretim derlemesinde yok
if (import.meta.env?.DEV && typeof window !== "undefined") {
  (window as unknown as { __voxcrewStuck?: unknown }).__voxcrewStuck = {
    state: () => ({ ...safeRuntime, avatar: { x: walkRuntime.avatar.x, z: walkRuntime.avatar.z, y: walkRuntime.avatar.y, grounded: walkRuntime.avatar.grounded } }),
    rescue: () => requestRescue(),
    /** canlı deneme: avatarı (x, z, y) noktasına koyar (gömme senaryosu) */
    put: (x: number, z: number, y = 0) => { placeAvatar(walkRuntime.avatar, { x, z, y }); walkRuntime.drawY = y; },
  };
}
