/**
 * CORE-CITYMAP (REAL-WATER-001) — şehir haritasında semt suyuna ve denize dokunma: görünmez hedef kutuları (tek örneklenmiş dizi,
 * renk/derinlik yazmaz → +0 görünür çizim), dokununca sıçrama (splash) + su sesi + kısa etiket (ambient/tap.ts `tapWater`: sahne ve
 * çevre suyuyla aynı tepki) ve halka (ripple). Tıkla-git olayı sürer (büyük su gibi: kıyıya yürü bozulmaz);
 * ajan/hayvan aynı ışındaysa o kazanır. Hareket azaltmada parçacık yok (fx.calm), ses ve etiket var. Hedefler `waterTaps.ts`.
 */
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { WorldLive } from "../live";
import { burst } from "../fun/fx";
import { reducedMotion } from "../motion";
import { hotYields } from "../ambient/touch";
import { tapWater } from "../ambient/tap";
import { cityWaterTaps } from "./waterTaps";
import type { CityMapFile } from "./format";

const UNIT = new THREE.BoxGeometry(1, 1, 1);
const MAT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
export const PICK_CITY_WATER = "citymap:water";

export function CityWaterTaps({ map, live }: { map: CityMapFile; live: WorldLive }) {
  const taps = useMemo(() => cityWaterTaps(map), [map]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new THREE.Object3D();
    taps.forEach((t, i) => { o.position.set(t.x, t.top - 0.1, t.z); o.scale.set(t.w, 0.24, t.d); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [taps]);
  if (!taps.length) return null;
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (hotYields(e.intersections.map((x) => x.object.name))) return; // ajan/hayvan önce
    const t = taps[e.instanceId ?? -1];
    if (!t) return;
    // tıkla-git sürer (olay yayılımı kesilmez); sahne ve çevre suyuyla aynı tepki (ambient/tap.ts) + halka
    if (tapWater(live, e.point.x, t.top, e.point.z) && !reducedMotion()) burst(live.fx, "ripple", e.point.x, t.top + 0.01, e.point.z);
  };
  return (
    <instancedMesh key={`cw${taps.length}`} ref={mesh} args={[UNIT, MAT, taps.length]} visible={false} frustumCulled={false}
      onClick={click} name={PICK_CITY_WATER} />
  );
}
