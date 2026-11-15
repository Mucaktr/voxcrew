/**
 * W4 (WALK-GAME-UI) — hatıra toplama ve simge keşfi eylemleri: F (WorldPage `walkInteract`), üstünden yürüme ve bölgeye giriş
 * (`WalkProgress`). Toplama animasyonu `souvenirLayer.pops` (hareket azaltmada yok; yalnız durağan tost).
 */
import { prefersReducedMotion } from "../../../../lib/game";
import { tx } from "../../../../lib/i18n";
import { collectSouvenir, discoverLandmark, isViewOnly, pushWalkToast, useWalkProgress } from "../../../../lib/walk";
import { walk as WM } from "../../../../locales/walk";
import { SCENES, sceneDef, tx as tileX, tz as tileZ } from "../../../../voxel/scenes";
import { layerOffset, souvenirLayer } from "./layer";
import { albumRow, parseSouvenirId, souvenirModel, SOUVENIRS_PER_SCENE } from "./logic";

/** W5: sunucu hız sınırı (429) — geçici; yeniden denenebilir. */
const isRateLimited = (e: unknown) => (e as { status?: unknown } | null)?.status === 429;

/** Bu oturumda sunucunun reddettiği hatıralar: üstünden yürümek yeniden denemez (F dener). */
const refused = new Set<string>();

// CORE-WALK: ad yoksa ham sahne kimliği değil (özel dünyanın adı sceneDef'te; o da yoksa genel ad)
export const sceneLabel = (scene: string) => (SCENES as Record<string, { label?: string } | undefined>)[scene]?.label
  ?? (sceneDef(scene).id === scene ? sceneDef(scene).label : tx(WM, "world_unknown"));
export const souvenirLabel = (n: number) => tx(WM, `sv_${souvenirModel(n)}` as "sv_lantern");
export const landmarkLabel = (id: string) => {
  const key = `lm_${id.replace(":", "_")}`;
  const v = tx(WM, key as "sv_lantern");
  return v === key ? tx(WM, "lm_unknown") : v; // CORE-WALK: ham kimlik değil, genel ad
};

/** Hatırayı toplar; `auto` üstünden yürümede true (reddedilmiş hatıra yeniden denenmez). */
export function pickupSouvenir(item: string, auto = false): boolean {
  const scene = souvenirLayer.scene;
  const p = parseSouvenirId(item);
  if (!scene || !p || p.scene !== scene) return false;
  if (auto && refused.has(item)) return false;
  const it = souvenirLayer.items.find((x) => x.id === item);
  if (!it) return false;
  const started = collectSouvenir(scene, item, {
    onDone: (r) => {
      refused.delete(item);
      const found = albumRow(scene, useWalkProgress.getState().pickup.found).found;
      const name = souvenirLabel(p.n);
      const extra = r.admin ? tx(WM, "sv_admin") : r.reason === "creative" ? tx(WM, "sv_creative")
        : r.reason === "daily_cap" ? tx(WM, "sv_daily_cap") : r.coins > 0 ? tx(WM, "sv_coins", { n: r.coins }) : "";
      pushWalkToast({ kind: "souvenir", title: tx(WM, "sv_found_title", { name }),
        text: [tx(WM, "sv_found_text", { scene: sceneLabel(scene), n: found, total: SOUVENIRS_PER_SCENE }), extra].filter(Boolean).join(" · ") });
      if (r.albumComplete) pushWalkToast({ kind: "souvenir", title: tx(WM, "sv_album_done", { scene: sceneLabel(scene) }) });
    },
    onFail: (e) => {
      // W5: hız sınırı (429) geçicidir — hatıra reddedilmiş sayılmaz, kısa ve duyurulan bir uyarı yeter
      if (isRateLimited(e)) { pushWalkToast({ kind: "info", title: tx(WM, "ann_rate") }); return; }
      refused.add(item);
      pushWalkToast({ kind: "info", title: tx(WM, "sv_fail", { msg: e instanceof Error ? e.message : String(e) }) });
    },
  });
  if (started && !prefersReducedMotion()) {
    const [oi, oj] = layerOffset(souvenirLayer.built);
    souvenirLayer.pops.push({ x: tileX(it.bi + oi), z: tileZ(it.bj + oj), model: it.model, t0: performance.now() });
  }
  return started;
}

/** Simge bölgesine giriş: vize kaydı ve "Keşfedildi" tostu. */
const refusedVisa = new Set<string>();
export function discover(world: string, landmark: string): boolean {
  if (refusedVisa.has(landmark)) return false;
  return discoverLandmark(world, landmark, {
    onDone: (r) => {
      if (r.already) return;
      const name = landmarkLabel(landmark);
      // W5: görüntüleme (yönetici / yaratıcı) vize eklemez; tost bunu söyler ve bu oturumda yeniden istenmez
      const viewOnly = isViewOnly(r);
      if (viewOnly) refusedVisa.add(landmark);
      pushWalkToast({ kind: "visa", title: tx(WM, "lm_found_title", { name }),
        text: !viewOnly ? tx(WM, "lm_found_text") : r.admin ? tx(WM, "sv_admin") : tx(WM, "sv_creative") });
    },
    onFail: (e) => {
      if (isRateLimited(e)) { pushWalkToast({ kind: "info", title: tx(WM, "ann_rate") }); return; }
      refusedVisa.add(landmark);
      pushWalkToast({ kind: "info", title: tx(WM, "lm_fail", { msg: e instanceof Error ? e.message : String(e) }) });
    },
  });
}
