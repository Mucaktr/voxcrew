/**
 * EXP-INT (E1b) — çevre arazisini yürüme modunda akıtır, çizer ve çarpıştırır.
 *
 * - Yalnız yürüme modunda (walk-only): mod açılınca bağlam bir kez kurulur (`expanseContext(sceneDef, built, { radius, base:
 * buildWorld(id, 1) })`), her karede `ExpanseStream.update(avatar)`; mod kapanınca bütün yuvalar boşalır, kuyruk `count`u
 * tabana döner, çarpışma ızgarası söker. Yörünge kamerasında çevre görünmez (kadraj, `fitView`, ufuk değişmez).
 * - Çizim: yuva yazımları `tail.ts` ile mevcut durağan grup mesh'lerinin kuyruğuna (+0 çizim çağrısı; yeni mesh/ışık yok).
 * - Çarpışma: yakın sınıftaki parseller `physics/world.ts` çevre ızgarasına, ızgara `navGrid(built).outer`'a (controller sınırı
 * ve tıkla-git birleşimi). Ajanlar görmez: yapılı dünyada kalırlar.
 * - Dünya büyürse (ajan sayısı) yeni bağlam kurulur ve avatarın yakın halkası **aynı karede** doldurulur (WalkRig'in kaydırma ve
 * `unstick` etkisinden önce; bu bileşen World.tsx'te WalkRig'den önce bağlanır), avatar çevredeyse yerinde kalır.
 * - HUD: `hud.ts` (çevrede mi, biyom, "Ofise dön" → doğma karosu). Hareket azaltma: akışta animasyon yok (ışınlama anlık).
 * - E2 parseller (`plots.ts`, `plotStore.ts`): sahiplenilmiş parseller akışta yabani parselin yerine düzleştirilmiş parsel olarak
 * çizilir (aynı kuyruk yuvası, +0 çizim). Keşif yarıçapı depodan (D2 A, seviye). Avatarın girdiği parsel keşif kümesine
 * işlenir; sınır halkasında "Keşif sınırı" bildirimi (`hud.edge`). "Parselime git" isteği (`goto`) akış hazır olunca ışınlar.
 * Yerleşim (dünya karosu dikdörtgenleri) mini harita katmanı olarak yayımlanır (yürüme kapalıyken de).
 * - E3 yapı modu (`voxel/build/*`): yüklü (yakın ya da uzak yuvadaki) sahiplenilmiş parsellerin inşası kapasite kuyruğunun
 * **inşa bölgesine** yazılır (+0 çizim çağrısı; `build/tailLayout.ts`), gövde katmanı (y < 2) ve prefab ayak izleri parselin
 * çarpışma ızgarasına katı karo olarak işlenir (avatar giremez, tıkla-git dolaşır). Girdi, seçim ve hayalet `BuildLayer`'da.
 *
 * Hiçbir şey çizmez (null döner).
*/
import { useFrame } from "@react-three/fiber";
import { ensureBodies } from "../../lib/build";
import { BuildLayer, type BuildBridge } from "../build/BuildLayer";
import type { PlotBody } from "../build/catalog";
import { buildPhysics, plotBuildBlocks } from "../build/mesh";
import { renderBody, useBuildStore } from "../build/store";
import { buildEnd, buildOffset, buildTail } from "../build/tailLayout";
import { useEffect, useMemo, useRef } from "react";
import type { WorldLive } from "../live";
import { OutskirtsWater } from "./OutskirtsWater";
import { outerGrid, setOuterParcels, type OuterGrid } from "../physics/world";
import { outerParcelTops } from "../physics/height";
import { buildWorld, tx, tz, type Block, type Built, type SceneCore } from "../scenes";
import { navGrid, tileAt } from "../walk/controller";
import { spawnPose } from "../walk/WalkRig";
import { useWalkStore, walkRuntime } from "../walk/walkStore";
import { expanseContext, openParcels, parcelState, type ExpanseSceneDef } from "./context";
import { generateParcel } from "./generate";
import { PD, pkey, PW, ringOf } from "./grid";
import { usePlotRadius, usePlotsFor, usePlotStore, type PlotLayer } from "./plotStore";
import { exploredParcels, placePlots, plotDecorMap, plotEntry, plotRing, type PlacedPlot } from "./plots";
import { useExpanseHud } from "./hud";
import { ExpanseStream, SLOT_SIZE, slotOffset, TAIL_GROUPS, tailEnd, type SlotWrite, type TailGroup } from "./stream";
import { hasTail, setTailEnd, tailSize, tailVersion, writeTail } from "./tail";

export interface OutskirtsProps {
  built: Built;
  def: ExpanseSceneDef;
  core?: SceneCore | null;
  /** keşif yarıçapı (D2 A: seviyeyle 4 → 12); verilmezse parsel deposundan (sunucu ofis seviyesinden hesaplar) */
  radius?: number;
  /** WATER-ALL: verilirse çevre arazisindeki suya dokununca şapırtı (World.tsx canlı durumu geçer) */
  live?: WorldLive;
}

interface Run {
  stream: ExpanseStream | null;
  /** çevre ızgarasının bağlı olduğu dünya */
  built: Built | null;
  grid: OuterGrid | null;
  nearV: number;
  tailV: number;
  /** akış + yazım süresi (ms/kare, üstel ortalama) */
  ms: number;
  outside: boolean;
  /** yazılamayan blok (sahnede olmayan grup, yuva taşması) */
  dropped: number;
  /** E3: inşa bölgesinin yazıldığı imza (gövde sürümü + yüklü parseller + kuyruk sürümü + köken) */
  buildSig: string;
  /** E3: çarpışmaya işlenmiş gövde sürümü */
  buildV: number;
}

/** E3: parsel inşasının dünya blokları (gövde kimliği + çerçeve başına önbellek). */
const meshCache = new WeakMap<PlotBody, { sig: string; blocks: Block[] }>();

const coarse = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

export function Outskirts({ built, def, core = null, radius: radiusProp, live }: OutskirtsProps) {
  const run = useRef<Run>({ stream: null, built: null, grid: null, nearV: -1, tailV: -1, ms: 0, outside: false, dropped: 0, buildSig: "", buildV: -1 });
  // E2: parseller ve yarıçap (depo); yerleşim yalnız sahiplenilmiş parsel varken hesaplanır (taban yarıçaplı bağlam, önbellekli)
  const storeRadius = usePlotRadius(def.id);
  const radius = radiusProp ?? storeRadius;
  const plots = usePlotsFor(def.id);
  const placed = useMemo<PlacedPlot[]>(() => (plots.length ? placePlots(plotRing(def, built), plots) : []), [def, built, plots]);
  const decor = useMemo(() => plotDecorMap(placed), [placed]);
  const explored = usePlotStore((st) => (st.world === def.id ? st.explored : null));
  const props = useRef({ built, def, core, radius, decor, placed });
  props.current = { built, def, core, radius, decor, placed };
  const lastParcel = useRef<string>("");

  const apply = (writes: readonly SlotWrite[]) => {
    const r = run.current;
    for (const w of writes) for (const g of TAIL_GROUPS) {
      r.dropped += writeTail(g, slotOffset(w.cls, w.slot, g), SLOT_SIZE[w.cls][g], w.groups ? w.groups[g] : []);
    }
  };
  const ends = () => {
    const s = run.current.stream;
    const high = s ? s.high() : { near: 0, far: 0 };
    for (const g of TAIL_GROUPS) setTailEnd(g, Math.max(tailEnd(high, g), buildEnd(g)));
  };
  const syncGrid = () => {
    const r = run.current;
    const bv = useBuildStore.getState().version;
    if (!r.stream || !r.grid || (r.stream.nearVersion === r.nearV && bv === r.buildV)) return;
    r.nearV = r.stream.nearVersion;
    r.buildV = bv;
    // E3: sahiplenilmiş parselin inşası (gövde katmanı + prefab ayak izi) katı karo
    const st = useBuildStore.getState(), placed = props.current.placed;
    // WALK-PHYS: karo üst yüzleri (arazi yüksekliği, alçak öğeler, inşa yığınları) — avatar basamak/zıplama/tırmanma
    const ctx = r.stream.ctx;
    setOuterParcels(r.grid, r.stream.nearParcels().filter((p) => p.near).map((p) => {
      const pl = placed.find((q) => !q.unplaced && q.cx === p.cx && q.cz === p.cz);
      const body = pl ? renderBody(st, pl.id) : null;
      const wi0 = p.cx * PW + ctx.origin[0], wj0 = p.cz * PD + ctx.origin[1];
      if (body && (body.edits.length || body.prefabs.length)) {
        const phys = buildPhysics(p, p.near!.solid, p.near!.box, body);
        const blocks = plotBuildBlocks(body, { cx: p.cx, cz: p.cz, h0: ctx.h0, origin: ctx.origin }, ctx.groups);
        return { cx: p.cx, cz: p.cz, ...phys, top: outerParcelTops(p, phys.solid, PW, PD, ctx.h0, blocks, wi0, wj0) };
      }
      return { cx: p.cx, cz: p.cz, solid: p.near!.solid, box: p.near!.box, top: outerParcelTops(p, p.near!.solid, PW, PD, ctx.h0, [], wi0, wj0) };
    }));
  };
  /** E3: inşa bölgesi — yüklü sahiplenilmiş parsellerin inşa blokları grup başına paketlenip yazılır (yalnız imza değişince). */
  const writeBuild = (force = false) => {
    const r = run.current, s = r.stream;
    const st = useBuildStore.getState(), placed = props.current.placed;
    const loaded = s ? placed.filter((pl) => !pl.unplaced && s.loadedClass(pkey(pl.cx, pl.cz))) : [];
    const sig = s ? `${st.version}|${tailVersion()}|${s.ctx.origin.join()}|${loaded.map((pl) => `${pl.id}@${pl.cx},${pl.cz}`).join(";")}` : "";
    if (!force && sig === r.buildSig) return false;
    r.buildSig = sig;
    const lists: Record<TailGroup, Block[]> = { solid: [], water: [], glass: [], glow: [] };
    if (s) for (const pl of loaded) {
      const body = renderBody(st, pl.id);
      if (!body.edits.length && !body.prefabs.length) continue;
      const key = `${pl.cx},${pl.cz},${s.ctx.origin.join()},${s.ctx.h0}`;
      let hit = meshCache.get(body);
      if (!hit || hit.sig !== key) {
        hit = { sig: key, blocks: plotBuildBlocks(body, { cx: pl.cx, cz: pl.cz, h0: s.ctx.h0, origin: s.ctx.origin }, s.ctx.groups) };
        meshCache.set(body, hit);
      }
      for (const b of hit.blocks) {
        const g = (b.g === "glass" || b.g === "glow") && hasTail(b.g) ? b.g : "solid";
        lists[g].push(g === b.g ? b : { ...b, g });
      }
    }
    for (const g of TAIL_GROUPS) {
      const size = Math.max(0, tailSize(g) - buildOffset(g));
      const list = lists[g], prev = buildTail.used[g];
      if (size <= 0) { buildTail.used[g] = 0; buildTail.dropped += list.length; continue; }
      const span = Math.min(size, Math.max(prev, list.length));
      if (span > 0) buildTail.dropped += writeTail(g, buildOffset(g), span, list);
      buildTail.used[g] = Math.min(list.length, size);
    }
    return true;
  };
  const teardown = () => {
    const r = run.current;
    if (r.stream) { apply(r.stream.clear()); r.stream = null; writeBuild(true); ends(); }
    if (r.built) { const nav = navGrid(r.built); if (nav.outer === r.grid) nav.outer = null; }
    r.built = null; r.grid = null; r.nearV = -1;
    if (r.outside) r.outside = false;
    const hud = useExpanseHud.getState();
    if (hud.outside || hud.home || hud.biome || hud.edge) hud.set({ outside: false, home: null, biome: null, edge: false });
    lastParcel.current = "";
  };
  const start = () => {
    const r = run.current, { built: b, def: d, radius: rad } = props.current;
    const ctx = expanseContext(d, b, { radius: rad, base: buildWorld(d.id, 1) });
    r.stream = new ExpanseStream(ctx, { far: coarse() ? 2 : 3, plots: props.current.decor });
    r.grid = outerGrid(PW, PD, ctx.origin);
    r.built = b;
    navGrid(b).outer = r.grid;
    r.nearV = -1;
    r.tailV = tailVersion();
    useExpanseHud.getState().set({ biome: ctx.biome, home: goHome });
  };
  /** Avatarı dünya karosuna ışınlar ve yakın halkayı hemen doldurur (geliştirme `goOut` ve "Parselime git"). */
  const teleport = (i: number, j: number) => {
    const s = run.current.stream;
    if (!s) return;
    const a = walkRuntime.avatar;
    a.x = tx(i); a.z = tz(j); a.route = null;
    useWalkStore.getState().setTarget(null);
    apply(s.update(a.x, a.z, { gen: 9, writes: 64 }));
    ends();
    syncGrid();
  };
  const goHome = () => {
    const { built: b, core: c } = props.current;
    const p = spawnPose(b, c);
    const a = walkRuntime.avatar;
    a.x = p.x; a.z = p.z; a.heading = p.heading; a.route = null;
    useWalkStore.getState().setTarget(null);
  };

  // dünya / sahne / yarıçap değişti: eski yuvalar boşalır; yürüme açıksa yeni bağlam ve avatarın yakın halkası hemen dolar
  useEffect(() => {
    const r = run.current;
    if (!r.stream) return;
    const old = r.stream.ctx.origin, a = walkRuntime.avatar;
    teardown();
    if (!useWalkStore.getState().active) return;
    start();
    const s = r.stream!;
    // WalkRig avatarı taban kaymasıyla birlikte kaydıracak: taban çerçevesi konumu korunur
    const x = a.x - old[0] + s.ctx.origin[0], z = a.z - old[1] + s.ctx.origin[1];
    apply(s.update(x, z, { gen: 9, writes: 64 }));
    ends();
    syncGrid();
  }, [built, def, radius, decor]); // eslint-disable-line react-hooks/exhaustive-deps

  // E2: mini harita katmanı (dünya karosu): sahiplenilmiş parseller + keşfedilmiş parseller (yürüme kapalıyken de)
  useEffect(() => {
    const m0 = built.modules.find((m) => m.base) ?? built.modules[0];
    const [di, dj] = m0 ? [m0.i0, m0.j0] : [0, 0];
    const layer: PlotLayer = {
      plots: placed.filter((p) => !p.unplaced).map((p) => ({ ...p.tiles, color: p.color, slot: p.slot })),
      explored: (explored ? exploredParcels(explored) : []).map(([cx, cz]) => ({ i0: cx * PW + di, j0: cz * PD + dj, i1: cx * PW + di + PW, j1: cz * PD + dj + PD })),
    };
    usePlotStore.getState().set({ layer: layer.plots.length || layer.explored.length ? layer : null, layerWorld: def.id });
  }, [placed, explored, built, def.id]);

  useEffect(() => () => teardown(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // E3: inşası olan parsellerin gövdeleri (bir kez) ve kuyruk kapasitesi eki (parsel listesi değişince)
  useEffect(() => { void ensureBodies(def.id, plots); }, [def.id, plots]);

  // E3: yapı modu köprüsü (BuildLayer akışı, yerleşimi ve kuyruk ucunu buradan okur)
  const bridge = useRef<BuildBridge>(null as unknown as BuildBridge);
  if (!bridge.current) {
    bridge.current = { world: def.id, get stream() { return run.current.stream; }, placed, groups: null, swatch: def.swatch?.[0] ?? null, ends: () => ends() } as BuildBridge;
  }
  bridge.current.world = def.id;
  bridge.current.placed = placed;
  bridge.current.swatch = def.swatch?.[0] ?? null;

  useFrame(() => {
    const r = run.current;
    if (!useWalkStore.getState().active) { if (r.stream || r.built) teardown(); return; }
    const t0 = performance.now();
    if (!r.stream) start();
    const s = r.stream!;
    if (tailVersion() !== r.tailV) { r.tailV = tailVersion(); apply(s.rewriteAll()); ends(); }
    // E2: "Parselime git" (akış hazır ve WalkRig giriş pozunu yazdıktan sonra — `walkRuntime.live`; yuva yoksa istek düşer)
    const ps = usePlotStore.getState();
    if (ps.goto !== null && walkRuntime.live) {
      const target = props.current.placed.find((p) => p.slot === ps.goto && !p.unplaced);
      const at = target ? plotEntry(s.ctx, target) : null;
      ps.set({ goto: null });
      if (at) teleport(at[0], at[1]);
    }
    const a = walkRuntime.avatar;
    const writes = s.update(a.x, a.z);
    if (writes.length) { apply(writes); ends(); }
    syncGrid();
    if (writeBuild()) ends(); // E3: inşa bölgesi (gövde ya da yüklü parsel değişince)
    // E2: keşif kümesi + sınır bildirimi (yalnız parsel değişince)
    if (s.center) {
      const [pcx, pcz] = s.center, key = `${pcx},${pcz}`;
      if (key !== lastParcel.current) {
        lastParcel.current = key;
        const open = parcelState(s.ctx, pcx, pcz) === "open";
        if (open) usePlotStore.getState().markExplored(props.current.def.id, pcx, pcz);
        const edge = open && ringOf(s.ctx.box, pcx, pcz) >= s.ctx.radius;
        if (edge !== useExpanseHud.getState().edge) useExpanseHud.getState().set({ edge });
      }
    }
    const b = props.current.built, [i, j] = tileAt(a.x, a.z);
    const out = i < 0 || j < 0 || i >= b.width || j >= b.depth;
    if (out !== r.outside) { r.outside = out; useExpanseHud.getState().set({ outside: out }); }
    r.ms = r.ms * 0.95 + (performance.now() - t0) * 0.05;
  });

  // geliştirme kancası (ekran görüntüsü ve walk_perf --expand); üretim derlemesinde yok
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewExpanse?: unknown };
    w.__voxcrewExpanse = {
      state: () => {
        const r = run.current, s = r.stream;
        return {
          active: !!s, biome: s?.ctx.biome ?? null, center: s?.center ?? null, counts: s?.counts() ?? null, high: s?.high() ?? null,
          pending: s?.pending ?? 0, stats: s ? { ...s.stats } : null, ms: +r.ms.toFixed(3), outside: r.outside, dropped: r.dropped,
          grid: r.grid?.parcels.size ?? 0,
          build: { used: { ...buildTail.used }, dropped: buildTail.dropped, ghost: buildTail.ghost, cap: Object.fromEntries(TAIL_GROUPS.map((g) => [g, tailSize(g)])),
            active: useBuildStore.getState().active, plot: useBuildStore.getState().plotId, version: useBuildStore.getState().version },
        };
      },
      /** avatarı `ring`. halkadaki ulaşılabilir bir parselin yürünebilir karosuna ışınlar (yakın halkayı hemen doldurur) */
      goOut: (ring = 3) => {
        const r = run.current, s = r.stream;
        if (!s) return null;
        const ctx = s.ctx, want = Math.min(ring, ctx.radius);
        const list = openParcels(ctx).filter((p) => p.ring === want && ctx.reach.has(pkey(p.cx, p.cz)));
        for (const c of list) {
          const p = generateParcel(ctx, c.cx, c.cz);
          if (!p?.near) continue;
          let best = -1, bd = Infinity;
          for (let k = 0; k < p.near.walk.length; k++) {
            if (!p.near.walk[k]) continue;
            const d = ((k % PW) - 5.5) ** 2 + (Math.floor(k / PW) - 7.5) ** 2;
            if (d < bd) { bd = d; best = k; }
          }
          if (best < 0) continue;
          const i = c.cx * PW + (best % PW) + ctx.origin[0], j = c.cz * PD + Math.floor(best / PW) + ctx.origin[1];
          teleport(i, j);
          return { i, j, cx: c.cx, cz: c.cz };
        }
        return null;
      },
      home: () => goHome(),
      /** E2: sahiplenilmiş parsel yuvasına ışınla ("Parselime git" ile aynı yol; bir sonraki karede) */
      goPlot: (slot: number) => { usePlotStore.getState().set({ goto: slot }); return props.current.placed.find((p) => p.slot === slot) ?? null; },
    };
    return () => { delete w.__voxcrewExpanse; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <BuildLayer bridge={bridge} />
      {live && <OutskirtsWater stream={() => run.current.stream} live={live} />}
    </>
  );
}
