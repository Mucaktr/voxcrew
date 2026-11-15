/**
 * TOUR-VIEW (§8 F1) — şehrin silüet + ufuk katmanı: tek örneklenmiş dizi (gölgesiz, +1 çizim çağrısı), CityRig içinde bağlanır.
 *
 *  - Doğal sınır (`horizon.ts cityBoundary`) bağlanınca yazılır; parsel silüetleri (uzak LOD, uzaktan yakına) kare başına ≈ 3 ms
 *    bütçeyle doldurulur (ilk parsel semt planını da kurar; akış sonradan aynı önbellekten okur).
 *  - Akışın yüklü parselleri (yakın ya da uzak halka) silüette gizlenir, bırakılanlar geri gelir: ikisi de `TAIL_FADE_S` titreşimli
 *    geçişle (fadeShader.ts) — kuyruktaki yazım/bırakmayla aynı karede, tümleyen desen → çapraz geçiş.
 *  - Sis katkısı `cityFog(map).max` ile sınırlı: silüet ve sınır her uzaklıkta soluk bir siluet olarak kalır.
 *  - Geliştirme kancası `window.__voxcrewTour` (yalnız DEV): sis, katman doluluğu, öndeki nokta; tour_check'in canlı karşılığı.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { CityMapFile } from "./format";
import type { CityStream } from "./source";
import { cityBoundary, cityFiller, parcelSilhouette, silhouetteOrder } from "./horizon";
import { CITY_FAR_BUDGET, CITY_FAR_FILL } from "./district";
import { farWaterMaterial, splitSilhouette } from "./farWater";
import { tickWaterFlow } from "../waterFlow";
import { reducedMotion } from "../motion";
import { cityFog } from "./viewDistance";
import { fadeNow, TAIL_FADE_S } from "../expanse/tail";
import { installHazeCap, installTailFade } from "../fadeShader";
import { walkRuntime } from "../walk/walkStore";

/** CityRig yazar: etkin şehir akışı ve öndeki nokta (yoksa null). */
export const tourRuntime: { stream: CityStream | null; lead: [number, number] | null; fadeWrites: number; hardWrites: number } = { stream: null, lead: null, fadeWrites: 0, hardWrites: 0 };

/** Parsel başına ayrılan ortalama yer (uzak LOD ≤ 18 blok; taşan parsel çizilmez, sayılır). */
const PER_PARCEL = CITY_FAR_FILL;
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();

/** su blokları ayrı dizide (uzak su malzemesi); parsel başına su yeri.*/
const PER_PARCEL_WATER = CITY_FAR_BUDGET.water;

interface Run { start: number; count: number }
interface Slot { key: string; start: number; count: number; w: Run; hidden: boolean }
type Blk = { p: readonly number[]; s: readonly number[]; c: string };

export function HorizonLayer({ map, visible }: { map: CityMapFile; visible: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const wref = useRef<THREE.InstancedMesh>(null);
  const boundary = useMemo(() => [...cityBoundary(map), ...cityFiller(map)], [map]); // semtsiz kenarda şehir dokusu
  const order = useMemo(() => silhouetteOrder(map, walkRuntime.avatar.x, walkRuntime.avatar.z), [map]);
  const cap = boundary.length + order.length * PER_PARCEL;
  const wcap = Math.max(1, order.length * PER_PARCEL_WATER);
  const haze = useMemo(() => ({ value: cityFog(map.id).max }), [map]);
  const geometry = useMemo(() => {
    const g = UNIT.clone();
    g.setAttribute("tailFade", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, [cap]);
  const material = useMemo(() => {
    const m = new THREE.MeshLambertMaterial();
    installTailFade(m);
    installHazeCap(m, haze);
    return m;
  }, [haze]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  // uzak su opak silüet malzemesinde değil, yakın suyla aynı saydam + akan malzemede (WATER-FAR-001)
  const wgeometry = useMemo(() => {
    const g = UNIT.clone();
    g.setAttribute("tailFade", new THREE.InstancedBufferAttribute(new Float32Array(wcap), 1).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, [wcap]);
  const wmaterial = useMemo(() => {
    const m = farWaterMaterial();
    installTailFade(m);
    installHazeCap(m, haze);
    return m;
  }, [haze]);
  useEffect(() => () => { wgeometry.dispose(); wmaterial.dispose(); }, [wgeometry, wmaterial]);
  const st = useRef({ next: 0, used: 0, wused: 0, slots: new Map<string, Slot>(), ver: -1, overflow: 0, built: 0, ms: 0 });
  const { scene } = useThree();

  const write = (start: number, blocks: readonly Blk[], fade: number, mesh = ref.current!) => {
    const fa = mesh.geometry.getAttribute("tailFade") as THREE.InstancedBufferAttribute, arr = fa.array as Float32Array;
    blocks.forEach((b, k) => {
      _m.compose(_p.set(b.p[0], b.p[1], b.p[2]), _q.identity(), _s.set(b.s[0], b.s[1], b.s[2]));
      mesh.setMatrixAt(start + k, _m);
      mesh.setColorAt(start + k, _c.set(b.c));
      arr[start + k] = fade;
    });
    mesh.instanceMatrix.addUpdateRange(start * 16, blocks.length * 16);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) { mesh.instanceColor.addUpdateRange(start * 3, blocks.length * 3); mesh.instanceColor.needsUpdate = true; }
    fa.addUpdateRange(start, blocks.length);
    fa.needsUpdate = true;
  };
  const setFade = (sl: Slot, v: number) => {
    for (const [mesh, r] of [[ref.current, sl], [wref.current, sl.w]] as const) {
      if (!mesh || !r.count) continue;
      const fa = mesh.geometry.getAttribute("tailFade") as THREE.InstancedBufferAttribute;
      (fa.array as Float32Array).fill(v, r.start, r.start + r.count);
      fa.addUpdateRange(r.start, r.count);
      fa.needsUpdate = true;
    }
  };

  useLayoutEffect(() => {
    const mesh = ref.current, wmesh = wref.current;
    if (!mesh || !wmesh) return;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    (mesh.instanceMatrix.array as Float32Array).fill(0);
    wmesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(wcap * 3), 3);
    (wmesh.instanceMatrix.array as Float32Array).fill(0);
    const s = st.current;
    s.next = 0; s.used = 0; s.wused = 0; s.slots.clear(); s.ver = -1; s.overflow = 0; s.built = 0;
    write(0, boundary, fadeNow());
    s.used = boundary.length;
    mesh.count = s.used;
    wmesh.count = 0;
  }, [boundary, cap, wcap]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock }) => {
    const mesh = ref.current, wmesh = wref.current, s = st.current;
    if (!mesh || !wmesh) return;
    tickWaterFlow(clock.elapsedTime, reducedMotion()); // akış saati (yakın su grubuyla aynı paylaşılan teker)
    const stream = tourRuntime.stream;
    // 1) silüetleri bütçeyle doldur
    if (s.next < order.length) {
      const t0 = performance.now();
      const loaded = stream ? new Set(stream.loadedList().map((l) => l.key)) : null;
      while (s.next < order.length && performance.now() - t0 < 3) {
        const o = order[s.next++];
        const all = parcelSilhouette(map, o.cx, o.cz);
        if (!all.length) continue;
        const { solid: blocks, water } = splitSilhouette(all);
        if (s.used + blocks.length > cap || s.wused + water.length > wcap) { s.overflow++; continue; }
        const hidden = !!loaded?.has(o.key);
        // gizli doğan silüet: silinme çoktan bitti (−1 → tam gizli); görünür doğan: belirerek
        const f = hidden ? -1 : fadeNow();
        write(s.used, blocks, f);
        if (water.length) write(s.wused, water, f, wmesh);
        s.slots.set(o.key, { key: o.key, start: s.used, count: blocks.length, w: { start: s.wused, count: water.length }, hidden });
        s.used += blocks.length;
        s.wused += water.length;
        s.built++;
      }
      mesh.count = s.used;
      wmesh.count = s.wused;
      s.ms = performance.now() - t0;
      s.ver = -1; // doldurma sırasında yüklü küme yeniden denetlenir
    }
    // 2) akışın yüklü parselleri gizli, bırakılanlar görünür (titreşimli geçiş)
    if (stream) {
      const v = stream.stats.writes + stream.stats.releases * 7919;
      if (v !== s.ver) {
        s.ver = v;
        const loaded = new Set(stream.loadedList().map((l) => l.key)), now = fadeNow();
        for (const sl of s.slots.values()) {
          const want = loaded.has(sl.key);
          if (want === sl.hidden) continue;
          sl.hidden = want;
          setFade(sl, want ? -now : now);
        }
      }
    }
  });

  // geliştirme kancası (canlı denetim): sis, katman doluluğu, akış
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewTour?: unknown };
    w.__voxcrewTour = {
      state: () => {
        const s = st.current, f = scene.fog as THREE.Fog | null, stream = tourRuntime.stream;
        let hidden = 0;
        for (const sl of s.slots.values()) if (sl.hidden) hidden++;
        return {
          city: map.id, fog: f ? { near: +f.near.toFixed(2), far: +f.far.toFixed(2), color: `#${f.color.getHexString()}` } : null, haze: haze.value,
          horizon: { cap, used: s.used, wcap, wused: s.wused, boundary: boundary.length, parcels: order.length, built: s.built, hidden, overflow: s.overflow, ms: +s.ms.toFixed(2) },
          lead: tourRuntime.lead, center: stream?.center ?? null, streamLead: stream?.lead ?? null, counts: stream?.counts() ?? null,
          fade: TAIL_FADE_S, fadeWrites: tourRuntime.fadeWrites, hardWrites: tourRuntime.hardWrites,
        };
      },
    };
    return () => { delete w.__voxcrewTour; };
  }, [map, cap, wcap, boundary, order, haze, scene]);

  return <>
    <instancedMesh key={`hz${cap}`} ref={ref} args={[geometry, material, cap]} frustumCulled={false} castShadow={false} receiveShadow={false} visible={visible} />
    <instancedMesh key={`hzw${wcap}`} ref={wref} args={[wgeometry, wmaterial, wcap]} frustumCulled={false} castShadow={false} receiveShadow={false} visible={visible} />
  </>;
}
