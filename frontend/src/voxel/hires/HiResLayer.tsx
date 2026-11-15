/**
 * LANDMARK-HIRES — simge katmanı: etkin simgelerin (mid ya da hi kademesi) bütün blokları malzeme grubu başına TEK örneklenmiş
 * ağda. Çizim çağrısı ≤ `HIRES_MAX_DRAW` (4; boş grup gizli → 0), katı grup gölge atar (+1 gölge geçişi). Kademe değişince
 * örnek tamponu yeniden yazılır (olay; kare başına değil). Malzeme `Blocks.tsx` ile aynı tablo (`GROUP_ALPHA`), yürüme kesiti
 * (`installCutaway`) ve mevsim tonu (`tintHex`) aynı.
 *
 *  - `HiResCityLayer`: şehir haritası — simge ev parseli akışın yakın halkasındayken çizilir (uzak halkada parselin uzak LOD'u
 *    görünür; ikisi aynı anda çizilmez); avatar ayak izine ≤ `HIRES_NEAR_TILES` karo ise hi, değilse mid.
 *  - `HiResSceneLayer`: taban sahne — simge bölgesinin blokları `hiresSceneSplit` ile Blocks'tan ayrılır; kamera ≤
 *    `HIRES_SCENE_NEAR` ise hi, değilse mid.
 * Geliştirme kancası `window.__voxcrewHiRes`: `stats()`, `force("hi" | "mid" | "off" | null)` (FPS önce/sonra ölçümü).
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Block } from "../scenes";
import { GROUP_ALPHA } from "../blockAlpha";
import { cutawayUniforms, installCutaway } from "../walk/cover";
import { blockColor } from "../expanse/tail";
import { drawnBlocks } from "../zfight";
import { installWaterFlow, tickWaterFlow } from "../waterFlow";
import { reducedMotion } from "../motion";
import { walkRuntime } from "../walk/walkStore";
import { cityLifeRuntime } from "../citylife/runtime";
import type { CityMapFile } from "../citymap/format";
import { hiresMapItems, type HiResSceneItem } from "./items";
import { HIRES_ENABLED, HIRES_GROUPS, HIRES_HYST, HIRES_MAX_ACTIVE, HIRES_NEAR_TILES, HIRES_SCENE_NEAR, rectDistance, type HiResGroup, type HiResItem, type HiResLevel } from "./types";

const unit = new THREE.BoxGeometry(1, 1, 1);
// kademe yazımının geçicileri (yazım başına yeni Matrix4/Color yok)
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _col = new THREE.Color();
const bySize = (a: Block, b: Block) => a.s[0] * a.s[1] * a.s[2] - b.s[0] * b.s[1] * b.s[2];
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function makeMaterial(g: HiResGroup): THREE.Material {
  const a = GROUP_ALPHA[g];
  const m = a.basic ? new THREE.MeshBasicMaterial({ toneMapped: false })
    : a.transparent ? new THREE.MeshLambertMaterial({ transparent: true, opacity: a.opacity, depthWrite: a.depthWrite }) : new THREE.MeshLambertMaterial();
  if (g === "water") installWaterFlow(m); // CEOGOZU
  // simge yapıdır — yan kesit bu malzemede hep kapalı (öteki kesit birimleri ortak)
  installCutaway(m, { ...cutawayUniforms, uCutSide: { value: 0 } });
  return m;
}

/** Çalışma zamanı özeti (geliştirme kancası, bench). */
export const hiresRuntime: { force: HiResLevel | null; meshes: Set<THREE.InstancedMesh>; stats: { active: number; hi: number; mid: number; instances: Record<HiResGroup, number>; writes: number; ms: number } } = {
  force: null, meshes: new Set(), stats: { active: 0, hi: 0, mid: 0, instances: { solid: 0, glow: 0, glass: 0, water: 0 }, writes: 0, ms: 0 },
};

type Picker = (items: readonly HiResItem[], prev: readonly HiResLevel[]) => HiResLevel[];

/** Ortak çekirdek: öğeler + kademe seçici → grup başına örneklenmiş ağ. */
function HiResMeshes({ items, pick, visible }: { items: readonly HiResItem[]; pick: Picker; visible: boolean }) {
  const refs = useRef<Partial<Record<HiResGroup, THREE.InstancedMesh | null>>>({});
  const levels = useRef<HiResLevel[]>([]);
  const clock = useRef(0);
  // kapasite: öğe başına max(mid, hi), grup başına; en çok HIRES_MAX_ACTIVE öğe aynı anda etkin varsayılır (toplam tavanı yine de doğru)
  const cap = useMemo(() => {
    const c: Record<HiResGroup, number> = { solid: 0, glow: 0, glass: 0, water: 0 };
    const per = items.map((it) => {
      const n: Record<HiResGroup, number> = { solid: 0, glow: 0, glass: 0, water: 0 };
      for (const lv of [it.mid, it.hi()]) {
        const k: Record<HiResGroup, number> = { solid: 0, glow: 0, glass: 0, water: 0 };
        for (const b of lv) k[b.g as HiResGroup]++;
        for (const g of HIRES_GROUPS) n[g] = Math.max(n[g], k[g]);
      }
      return n;
    });
    for (const g of HIRES_GROUPS) c[g] = per.map((n) => n[g]).sort((a, b) => b - a).slice(0, HIRES_MAX_ACTIVE).reduce((a, b) => a + b, 0);
    return c;
  }, [items]);
  const mats = useMemo(() => Object.fromEntries(HIRES_GROUPS.map((g) => [g, makeMaterial(g)])) as Record<HiResGroup, THREE.Material>, []);
  useEffect(() => () => { for (const m of Object.values(mats)) m.dispose(); }, [mats]);

  const write = (next: HiResLevel[]) => {
    const t0 = performance.now();
    const m = _m, q = _q, p = _p, s = _s, col = _col;
    const n: Record<HiResGroup, number> = { solid: 0, glow: 0, glass: 0, water: 0 };
    let hi = 0, mid = 0, active = 0;
    // örnekler küçükten büyüğe: önde duran ince ayrıntı (pencere, kaburga, korkuluk) önce çizilir, arkasındaki büyük kütlenin
    // örtülen parçaları erken derinlik testinde elenir (aşırı çizim / doldurma maliyeti düşer; sıra yeniden yazımda bir kez)
    const lists: Record<HiResGroup, Block[]> = { solid: [], glow: [], glass: [], water: [] };
    next.forEach((lv, i) => {
      if (lv === "off" || active >= HIRES_MAX_ACTIVE) return;
      active++;
      if (lv === "hi") hi++; else mid++;
      // simge kademesi çizimden önce z-fighting'den arındırılır (kademe başına bir kez, önbellekli; katmanda su durağan)
      const list: readonly Block[] = drawnBlocks(lv === "hi" ? items[i].hi() : items[i].mid, { waterMoves: false });
      for (const b of list) lists[b.g as HiResGroup]?.push(b);
    });
    for (const g of HIRES_GROUPS) {
      const mesh = refs.current[g], list = lists[g];
      if (!mesh) continue;
      list.sort(bySize);
      for (const b of list) {
        if (n[g] >= cap[g]) break;
        m.compose(p.set(b.p[0], b.p[1], b.p[2]), q, s.set(b.s[0], b.s[1], b.s[2]));
        mesh.setMatrixAt(n[g], m);
        blockColor(b.c, col); // renk dizesi hex başına bir kez ayrıştırılır (tintHex dahil, aynı sonuç)
        if (b.j) col.offsetHSL(0, 0, (hash(b.p[0] * 13.1 + b.p[1] * 5.3 + b.p[2] * 7.7) - 0.5) * b.j * 2);
        mesh.setColorAt(n[g], col);
        n[g]++;
      }
    }
    for (const g of HIRES_GROUPS) {
      const mesh = refs.current[g];
      if (!mesh) continue;
      mesh.count = n[g];
      mesh.visible = n[g] > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    levels.current = next;
    const st = hiresRuntime.stats;
    st.active = active; st.hi = hi; st.mid = mid; st.instances = n; st.writes++; st.ms = performance.now() - t0;
  };

  // simgeye yaklaşınca kademe değişimi aynı karede z-fighting çözümünü (drawnBlocks, kademe başına bir kez) koşuyordu →
  // takılma. Boşta (requestIdleCallback) öğe öğe önceden çözülür; sonuç önbellekte aynı dizi (çizim değişmez).
  useEffect(() => {
    let i = 0, id = 0;
    const idle = (cb: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(cb, { timeout: 2000 }) : window.setTimeout(cb, 50));
    const stop = (h: number) => (typeof cancelIdleCallback === "function" ? cancelIdleCallback(h) : window.clearTimeout(h));
    const step = () => {
      if (i >= items.length) return;
      const it = items[i++];
      drawnBlocks(it.mid, { waterMoves: false, anchors: false });
      drawnBlocks(it.hi(), { waterMoves: false, anchors: false });
      id = idle(step);
    };
    id = idle(step);
    return () => stop(id);
  }, [items]);

  useLayoutEffect(() => {
    levels.current = items.map(() => "off");
    for (const g of HIRES_GROUPS) { const mesh = refs.current[g]; if (mesh) { mesh.count = 0; mesh.visible = false; } }
  }, [items, cap]);

  useFrame(({ clock: ck }, dt) => {
    tickWaterFlow(ck.elapsedTime, reducedMotion()); // CEOGOZU: simge katmanı suyu da akar
    clock.current += dt;
    if (clock.current < 0.2) return; // 5 Hz kademe denetimi
    clock.current = 0;
    const want = !visible ? items.map((): HiResLevel => "off") : pick(items, levels.current);
    if (hiresRuntime.force && visible) for (let i = 0; i < want.length; i++) if (want[i] !== "off" || hiresRuntime.force === "off") want[i] = hiresRuntime.force;
    const prev = levels.current;
    if (want.length === prev.length && want.every((v, i) => v === prev[i])) return;
    write(want);
  });

  return (
    <>
      {HIRES_GROUPS.map((g) => cap[g] > 0 && (
        <instancedMesh key={`${g}:${cap[g]}`} ref={(el) => { const old = refs.current[g]; if (old) hiresRuntime.meshes.delete(old); refs.current[g] = el; if (el) hiresRuntime.meshes.add(el); }} args={[unit, mats[g], cap[g]]} visible={false}
          renderOrder={GROUP_ALPHA[g].order} castShadow={g === "solid"} receiveShadow={g !== "glow"} frustumCulled={false} />
      ))}
    </>
  );
}

function useDevHook() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewHiRes?: unknown };
    w.__voxcrewHiRes = {
      stats: () => ({ ...hiresRuntime.stats, instances: { ...hiresRuntime.stats.instances }, enabled: HIRES_ENABLED, force: hiresRuntime.force }),
      force: (lv: HiResLevel | null) => { hiresRuntime.force = lv; },
      /** ölçüm deneyi: katman ağlarının gölge/görünürlük ayarı (yalnız geliştirme) */
      tweak: (o: { shadow?: boolean; visible?: boolean }) => { for (const m of hiresRuntime.meshes) { if (o.shadow !== undefined) m.castShadow = o.shadow && m.material instanceof THREE.MeshLambertMaterial && !m.material.transparent; if (o.visible !== undefined) m.visible = o.visible && m.count > 0; } return hiresRuntime.meshes.size; },
    };
    return () => { delete w.__voxcrewHiRes; };
  }, []);
}

/** Şehir haritası katmanı (CityRig içinde; iç mekândayken `visible` false). */
export function HiResCityLayer({ map, visible }: { map: CityMapFile; visible: boolean }) {
  const items = useMemo(() => (HIRES_ENABLED ? hiresMapItems(map) : []), [map]);
  const near = useRef<{ v: number; set: Set<string> }>({ v: -1, set: new Set() });
  useDevHook();
  const pick: Picker = (list, prev) => {
    const s = cityLifeRuntime.stream, a = walkRuntime.avatar;
    if (!s) return list.map(() => "off");
    if (near.current.v !== s.nearVersion) near.current = { v: s.nearVersion, set: new Set(s.nearParcels().map((p) => `${p.cx},${p.cz}`)) };
    return list.map((it, i) => {
      if (!it.home || !near.current.set.has(`${it.home[0]},${it.home[1]}`)) return "off";
      const d = rectDistance(it.rect, a.x, a.z);
      return d <= HIRES_NEAR_TILES + (prev[i] === "hi" ? HIRES_HYST : 0) ? "hi" : "mid";
    });
  };
  if (!items.length) return null;
  return <HiResMeshes items={items} pick={pick} visible={visible} />;
}

/** Taban sahne katmanı (World.tsx; `items` = `hiresSceneSplit(...).items`): kamera simge merkezine (yarı yükseklik) ≤
 *  `HIRES_SCENE_NEAR` ise hi, değilse mid. */
export function HiResSceneLayer({ items }: { items: readonly HiResSceneItem[] }) {
  useDevHook();
  const camera = useThree((st) => st.camera);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const pick: Picker = (list, prev) => list.map((it, i) => {
    const c = (it as HiResSceneItem).ctx;
    const d = camera.position.distanceTo(tmp.set(c.cx, c.h / 2, c.cz));
    return d <= HIRES_SCENE_NEAR + (prev[i] === "hi" ? HIRES_HYST : 0) ? "hi" : "mid";
  });
  return <HiResMeshes items={items} pick={pick} visible />;
}
