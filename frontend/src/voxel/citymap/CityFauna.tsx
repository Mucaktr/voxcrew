/**
 * CITY-FAUNA — şehre özgü hayvanların çizimi (citymap/fauna.ts): tek örneklenmiş kutu dizisi, tek malzeme, gölgesiz → görünür
 * hayvan varken +1 çizim çağrısı, yokken dizi gizli (+0). CityRig bağlar; yürüme kapalı, iç mekân (`paused`) ya da yükleme yokken
 * gizli. Yüklü parsel kümesi akıştan saniyede iki kez okunur.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { reducedMotion } from "../motion";
import { useWalkStore, walkRuntime } from "../walk/walkStore";
import { FAUNA_MAX_BOXES, faunaFrame, faunaRoster, type FaunaFrame } from "./fauna";
import type { CityMapFile } from "./format";
import type { CityStream } from "./source";
import { pkey } from "../expanse/grid";

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, "YXZ"), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const colors = new Map<string, THREE.Color>();
const color = (c: string) => { let x = colors.get(c); if (!x) { x = new THREE.Color(c); colors.set(c, x); } return x; };

export function CityFauna({ map, night, paused, stream }: { map: CityMapFile; night: boolean; paused: boolean; stream: () => CityStream | null }) {
  const roster = useMemo(() => faunaRoster(map), [map]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => new THREE.MeshLambertMaterial(), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const st = useRef({ t: 0, wall: 0, loaded: null as Set<string> | null, at: -1, last: null as FaunaFrame | null });
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FAUNA_MAX_BOXES * 3), 3);
    mesh.count = 0;
  }, []);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewFauna?: unknown };
    w.__voxcrewFauna = { state: () => ({ city: map.id, roster: roster.animals.length, ...(st.current.last ?? { active: 0, boxes: 0, ids: [] }),
      animals: roster.animals.filter((a) => a.ok).map((a) => ({ id: a.id, x: +a.x.toFixed(2), y: +a.y.toFixed(2), z: +a.z.toFixed(2), hidden: a.hidden })) }) };
    return () => { delete w.__voxcrewFauna; };
  }, [map, roster]);
  useFrame((_, dt) => {
    const mesh = ref.current, s = stream(), r = st.current;
    if (!mesh || !mesh.instanceColor) return;
    if (!useWalkStore.getState().active || paused || !s || !roster.animals.length) { if (mesh.visible) { mesh.visible = false; mesh.count = 0; } return; }
    const reduced = reducedMotion();
    r.t += reduced ? 0 : Math.min(dt, 0.1);
    // parsel kümesi yenilemesi gerçek süreyle (`wall`) — hareket azaltmada `t` donuk kalır, küme donmasın
    r.wall += Math.min(dt, 0.1);
    if (!r.loaded || r.wall - r.at > 0.5) { r.loaded = new Set(s.loadedList().map((l) => l.key)); r.at = r.wall; }
    const loaded = r.loaded, av = walkRuntime.avatar, col = mesh.instanceColor.array as Float32Array;
    let k = 0;
    r.last = faunaFrame(map, roster, { dt, t: r.t, ax: av.x, az: av.z, night, reduced, loaded: (cx, cz) => loaded.has(pkey(cx, cz)) },
      (x, y, z, w, h, d, yaw, pitch, roll, c) => {
        if (k >= FAUNA_MAX_BOXES) return;
        _q.setFromEuler(_e.set(pitch, yaw, roll, "YXZ"));
        mesh.setMatrixAt(k, _m.compose(_v.set(x, y, z), _q, _s.set(w, h, d)));
        color(c).toArray(col, k * 3);
        k++;
      });
    mesh.count = k;
    mesh.visible = k > 0;
    // yalnız kullanılan örnekler GPU'ya (tam kapasite tamponu her kare yükleniyordu; count = k ötesi çizilmez)
    if (k) { mesh.instanceMatrix.addUpdateRange(0, k * 16); mesh.instanceColor.addUpdateRange(0, k * 3); mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
  });
  return <instancedMesh ref={ref} args={[UNIT, mat, FAUNA_MAX_BOXES]} frustumCulled={false} castShadow={false} receiveShadow={false} visible={false} />;
}
