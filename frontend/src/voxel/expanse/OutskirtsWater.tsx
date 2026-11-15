/**
 * WATER-ALL — çevre arazisindeki (Outskirts) suya dokununca şapırtı. Yüklü yakın parsellerin su karoları tek görünmez örnekli kutu
 * dizisi (+0 çizim çağrısı); yalnız akış yakın parsel kümesi değişince yeniden yazılır. Olay zincirini kesmez: yürüme modunda
 * tıkla-git (kıyıya yürü) bozulmaz.
 */
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { tapWater } from "../ambient/tap";
import { hotYields } from "../ambient/touch";
import type { WorldLive } from "../live";
import type { ExpanseStream } from "./stream";
import { WATER_SPOT_MAX, waterSpots, type WaterSpot } from "./waterSpots";

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion();
const HUGE = new THREE.Sphere(new THREE.Vector3(), 1e6);

export function OutskirtsWater({ stream, live }: { stream: () => ExpanseStream | null; live: WorldLive }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const spots = useRef<WaterSpot[]>([]);
  const ver = useRef(-1);
  useFrame(() => {
    const m = mesh.current, s = stream();
    if (!m) return;
    if (!s) { if (m.count) { m.count = 0; spots.current = []; ver.current = -1; } return; }
    if (s.nearVersion === ver.current) return;
    ver.current = s.nearVersion;
    const list = waterSpots(s.nearParcels(), s.ctx.origin);
    spots.current = list;
    list.forEach((w, i) => { _m.compose(_v.set(w.x, w.top - 0.1, w.z), _q, _s.set(w.w, 0.3, 1)); m.setMatrixAt(i, _m); });
    m.count = list.length;
    m.instanceMatrix.needsUpdate = true;
    m.boundingSphere = HUGE;
  });
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (hotYields(e.intersections.map((x) => x.object.name))) return; // ajan/hayvan önce
    const w = spots.current[e.instanceId ?? -1];
    if (!w) return;
    tapWater(live, e.point.x, w.top, e.point.z);
  };
  return (
    <instancedMesh ref={mesh} args={[unitBox, undefined, WATER_SPOT_MAX]} count={0} visible={false} frustumCulled={false} onClick={click} name="outskirts:water">
      <meshBasicMaterial colorWrite={false} depthWrite={false} />
    </instancedMesh>
  );
}
