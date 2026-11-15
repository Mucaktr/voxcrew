/**
 * W4 (WALK-GAME-UI) — yürüme modunda ilerleme katmanı (WalkHud içinde):
 * - sahnenin 5 hatırasını (taban sahnede `souvenirSpots`, büyümüş dünyaya kaydırılır) `souvenirLayer`'a yazar; bulunanlar gizli
 * - üstünden yürününce hatırayı toplar (F ile toplama WorldPage'de); simge bölgesine girince vize kaydeder
 * - tostlar (aria-live) ve görev izleyici
 * Yalnızca yerleşik sahnelerde hatıra ve vize vardır (sunucu kataloğu); kullanıcı dünyalarında katman boş kalır.
*/
import clsx from "clsx";
import { Award, Compass, Info, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useT } from "../../../../lib/i18n";
import { dismissWalkToast, ensureWalkProgress, loadWalkProgress, pushWalkToast, useWalkProgress, useWalkToasts, type WalkToast } from "../../../../lib/walk";
import { walk as WM } from "../../../../locales/walk";
import { buildWorld, SCENES } from "../../../../voxel/scenes";
import { souvenirSpots } from "../../../../voxel/walk/controller";
import { useWalkPose, useWalkStore } from "../../../../voxel/walk/walkStore";
import { discover, pickupSouvenir } from "./actions";
import { layerOffset, souvenirLayer } from "./layer";
import { hiddenSet, landmarkZones, souvenirAtTile, souvenirModel, visaTrigger, visibleSouvenirs, type Tile } from "./logic";
import { QuestTracker } from "./QuestTracker";
import { RitualBook } from "./RitualBook";
import { CityGuide } from "../guide/CityGuide";
import { InHudZone } from "../hudZones";
import { useInterior } from "../../../../voxel/interiors/store";
import { useCityActive } from "../../../../voxel/citymap/store";

/** Taban sahne hatıra karoları (sahne başına bir kez; walk_check ile aynı taban: 0 ajan, 1 misafir). */
const baseTiles = new Map<string, Tile[]>();
function souvenirBase(scene: string): Tile[] {
  let t = baseTiles.get(scene);
  if (!t) {
    t = (SCENES as Record<string, unknown>)[scene] ? souvenirSpots(buildWorld(scene, 0, { teams: [], guests: 1 }), scene) as Tile[] : [];
    baseTiles.set(scene, t);
  }
  return t;
}

export function WalkProgress() {
  const scene = useWalkStore((s) => s.world);
  const pickup = useWalkProgress((s) => s.pickup);
  const visas = useWalkProgress((s) => s.visas);
  const visaPending = useWalkProgress((s) => s.visaPending);
  const pose = useWalkPose();
  // WALK-EXPLORE: iç mekândayken hatıra çizilmez/toplanmaz ve vize tetiklenmez (iç kat ayrı uzaydır, taban karoları geçersiz)
  // şehir haritasında da ofis sahnesinin hatıraları ve simge vizeleri yok (şehrin kendi pasaportu var)
  const inCity = useCityActive();
  const indoors = useInterior((s) => !!s.view) || inCity;

  useEffect(() => { if (scene) void loadWalkProgress(scene); void ensureWalkProgress(); }, [scene]);
  // UX-P2: yalnız geliştirmede tost kancası — 375 px HUD denetimi (overlap_check `avatar`) bildirimi kendisi açar
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewWalkToast?: typeof pushWalkToast };
    w.__voxcrewWalkToast = pushWalkToast;
    return () => { delete w.__voxcrewWalkToast; };
  }, []);

  // görünür hatıralar → kare başı katman
  const tiles = useMemo(() => (scene ? souvenirBase(scene) : []), [scene]);
  const visible = useMemo(() => (scene ? visibleSouvenirs(scene, tiles, hiddenSet(pickup)) : []), [scene, tiles, pickup]);
  useEffect(() => {
    souvenirLayer.scene = scene && tiles.length && !indoors ? scene : null;
    souvenirLayer.items = visible.map((s) => ({ id: s.id, n: s.n, model: souvenirModel(s.n), bi: s.tile[0], bj: s.tile[1] }));
  }, [scene, tiles, visible, indoors]);
  useEffect(() => {
    // geliştirme kancası (§10.3): ekran görüntüsü betikleri hatıra karolarını (geçerli dünya) okur; üretim derlemesinde yok
    const w = window as unknown as { __voxcrewSouvenirs?: () => { id: string; tile: Tile }[]; __voxcrewLandmarks?: () => unknown };
    if (import.meta.env.DEV) w.__voxcrewSouvenirs = () => {
      const [oi, oj] = layerOffset(souvenirLayer.built);
      return souvenirLayer.items.map((it) => ({ id: it.id, tile: [it.bi + oi, it.bj + oj] as Tile }));
    };
    if (import.meta.env.DEV) w.__voxcrewLandmarks = () => zonesKey.current.zones;
    return () => { souvenirLayer.scene = null; souvenirLayer.items = []; delete w.__voxcrewSouvenirs; delete w.__voxcrewLandmarks; };
  }, []);

  // üstünden yürüme ve simge bölgesine giriş (avatar karosu değişince)
  const inside = useRef<Set<string>>(new Set());
  const zonesKey = useRef<{ built: unknown; scene: string | null; zones: ReturnType<typeof landmarkZones> }>({ built: null, scene: null, zones: [] });
  useEffect(() => {
    if (!scene || !pose || indoors) return;
    const built = souvenirLayer.built;
    const [oi, oj] = layerOffset(built);
    const here: Tile = [pose.tile[0] - oi, pose.tile[1] - oj];
    const hit = souvenirAtTile(visible, here);
    if (hit) pickupSouvenir(hit.id, true);
    if (!built) return;
    const zk = zonesKey.current;
    if (zk.built !== built || zk.scene !== scene) {
      zonesKey.current = { built, scene, zones: (SCENES as Record<string, unknown>)[scene] ? landmarkZones(scene, built.zones, built.width, built.depth) : [] };
    }
    const r = visaTrigger(pose.tile as Tile, zonesKey.current.zones, inside.current, visas, visaPending);
    inside.current = r.inside;
    for (const id of r.discover) discover(scene, id);
  }, [scene, pose, visible, visas, visaPending, indoors]);

  return (
    <>
      <WalkToasts />
      <QuestTracker />
      <RitualBook />
      <CityGuide />
    </>
  );
}

const ICON = { souvenir: Award, visa: Compass, info: Info } as const;

/** Tostlar: HUD ızgarasının orta yuvasında alta yaslı (UIUX-OVERLAP), aria-live; hareket azaltmada geçiş yok (`motion-safe`). */
function WalkToasts() {
  const t = useT(WM);
  const toasts = useWalkToasts((s) => s.toasts);
  return (
    <InHudZone zone="middle">
      <div className="flex flex-col items-center gap-1.5 w-[min(22rem,100%)] shrink-0 pointer-events-none" role="status" aria-live="polite">
        {toasts.map((x) => <ToastRow key={x.id} toast={x} closeLabel={t("talk_close")} />)}
      </div>
    </InHudZone>
  );
}

function ToastRow({ toast, closeLabel }: { toast: WalkToast; closeLabel: string }) {
  const Icon = ICON[toast.kind];
  return (
    <div className={clsx("panel !rounded-xl shadow-lg w-full flex items-start gap-2 @md:gap-2.5 px-2.5 py-1 @md:px-3 @md:py-2 pointer-events-auto motion-safe:animate-[rise_.2s_ease-out]")}>
      <Icon size={18} aria-hidden="true" className={clsx("shrink-0 mt-0.5", toast.kind === "info" ? "text-ink-2" : toast.kind === "visa" ? "text-info" : "text-warn")} />
      <div className="min-w-0 flex-1">
        {/* dar (telefon) ekranda ikinci satır gizli, başlık en çok 2 satır — eski 3 satırlık tost manzaranın ortasını örtüyordu*/}
        <p className="text-sm font-semibold text-ink leading-5 line-clamp-2 @md:line-clamp-none">{toast.title}</p>
        {toast.text && <p className="text-xs text-ink-2 leading-4 hidden @md:block">{toast.text}</p>}
      </div>
      {/* CITY-HUD: orta yuva kayınca kapatma düğmesi tostun görünen üst kenarına yapışır (kırpılmaz) */}
      <button type="button" className="btn btn-ghost btn-sm min-h-11 min-w-11 !p-0 grid place-items-center shrink-0 sticky top-0" aria-label={closeLabel}
        onClick={() => dismissWalkToast(toast.id)}><X size={14} aria-hidden="true" /></button>
    </div>
  );
}
