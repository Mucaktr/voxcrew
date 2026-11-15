/**
 * CEOGOZU — çeşme ve şelalede sıçrayan su damlaları (ürün sahibi: "suya akış efekti"). Kaynaklar `waterAnchors.ts` (çizilen listelerden);
 * kameraya ≤ `FX_R` olanlardan en çok `MAX_ANCHORS` tanesi damla salar. TEK örneklenmiş kutu ağı (+1 çizim çağrısı, gölgesiz), en çok
 * `POOL` damla; yakında kaynak yoksa ağ gizli ve kare başına iş yok. Hareket azaltmada damla yok (su durağan; yüzey kayması da donuk).
*/
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { reducedMotion } from "./motion";
import { BASIN_RATE, bumpWaterEpoch, FALL_RATE, JET_RATE, jetReach, waterAnchors, type WaterAnchor } from "./waterAnchors";

const POOL = 360, MAX_ANCHORS = 20, FX_R = 34, G = 7;
const unit = new THREE.BoxGeometry(1, 1, 1);
interface Drop { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number }
const RATE: Record<WaterAnchor["kind"], number> = { jet: JET_RATE, basin: BASIN_RATE, fall: FALL_RATE };
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function WaterFx() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useMemo(() => { bumpWaterEpoch(); }, []); // yeni sahne/şehir: eski kaynaklar silinir (Blocks aynı anahtarla yeniden kurulur)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#D6F0FF", transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  const st = useMemo(() => ({
    drops: Array.from({ length: POOL }, (): Drop => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 9, life: 0, size: 0.04 })),
    near: [] as WaterAnchor[], acc: new Map<WaterAnchor, number>(), scanAt: 0, live: 0, cursor: 0,
    m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(),
  }), []);

  useFrame(({ camera, clock }, dtRaw) => {
    const im = mesh.current;
    if (!im) return;
    const dt = Math.min(dtRaw, 0.05), t = clock.elapsedTime;
    if (reducedMotion()) { im.count = 0; im.visible = false; return; }
    if (t >= st.scanAt) { // 2 Hz: yakındaki kaynaklar
      st.scanAt = t + 0.5;
      const cp = camera.position, cand: { a: WaterAnchor; d: number }[] = [];
      for (const a of waterAnchors()) { const d = Math.hypot(a.x - cp.x, a.z - cp.z); if (d <= FX_R && Math.abs(a.y - cp.y) < 30) cand.push({ a, d }); }
      cand.sort((u, v) => u.d - v.d);
      st.near = cand.slice(0, MAX_ANCHORS).map((c) => c.a);
    }
    if (!st.near.length && st.live === 0) { im.count = 0; im.visible = false; return; }
    for (const a of st.near) { // salım
      const rate = a.kind === "fall" ? Math.min(30, RATE.fall * Math.max(1, a.w)) : RATE[a.kind];
      let acc = (st.acc.get(a) ?? 0) + rate * dt;
      while (acc >= 1) {
        acc -= 1;
        const d = st.drops[st.cursor]; st.cursor = (st.cursor + 1) % POOL;
        const r1 = hash(t * 91 + st.cursor * 3.1 + a.x), r2 = hash(t * 57 + st.cursor * 1.7 + a.z), r3 = hash(t * 33 + st.cursor * 5.3 + a.y);
        d.age = 0; d.size = 0.028 + r3 * 0.03;
        if (a.kind === "jet") { d.x = a.x; d.y = a.y; d.z = a.z; d.vx = (r1 - 0.5) * 0.6; d.vz = (r2 - 0.5) * 0.6; d.vy = Math.sqrt(2 * G * jetReach(a.h)) * (0.85 + r3 * 0.3); d.life = (2 * d.vy) / G + 0.1; d.size = 0.04 + r3 * 0.04 + Math.min(0.04, a.h * 0.05); } // fışkırma yüksekliği sütun boyundan
        else if (a.kind === "basin") { const ang = r1 * 6.283, rad = r2 * a.w * 0.4; d.x = a.x + Math.cos(ang) * rad; d.z = a.z + Math.sin(ang) * rad; d.y = a.y; d.vx = Math.cos(ang) * 0.25; d.vz = Math.sin(ang) * 0.25; d.vy = 0.7 + r3 * 0.6; d.life = 0.6; }
        else {
          const along = (r1 - 0.5) * a.w;
          d.x = a.x + (a.axis === 0 ? along : 0); d.z = a.z + (a.axis === 1 ? along : 0); d.y = a.y + 0.03;
          const side = (r2 - 0.5) * 0.7;
          d.vx = a.axis === 1 ? side : (r2 - 0.5) * 0.15; d.vz = a.axis === 0 ? side : (r2 - 0.5) * 0.15; d.vy = 0.6 + r3 * 0.7; d.life = 0.55;
        }
      }
      st.acc.set(a, acc);
    }
    if (st.acc.size > 64) st.acc.clear();
    let n = 0; // ilerlet + yaz
    for (const d of st.drops) {
      if (d.age >= d.life) continue;
      d.age += dt; d.vy -= G * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.age >= d.life) continue;
      st.m.compose(st.p.set(d.x, d.y, d.z), st.q, st.s.setScalar(d.size * (0.5 + 0.5 * (1 - d.age / d.life))));
      im.setMatrixAt(n++, st.m);
    }
    st.live = n;
    im.count = n; im.visible = n > 0;
    if (n) { im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, n * 16); im.instanceMatrix.needsUpdate = true; } // yalnız canlı damlalar
  });

  return <instancedMesh ref={mesh} args={[unit, mat, POOL]} frustumCulled={false} renderOrder={6} visible={false} />;
}
