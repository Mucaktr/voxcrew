/**
 * Dünya efektleri (S7): seviye atlama parıltısı + taç, hedef bayrağı.
 * Hareket azaltmada parçacık, dönme ve yükselme yoktur; yalnızca durağan altın halka ve taç görünür.
 * Parlama saniyede 3'ü geçmez, doygun kırmızı kullanılmaz (WCAG 2.3.1).
 */
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import * as THREE from "three";
import { tx } from "../lib/i18n";
import { world as M } from "../locales/world";
import { reducedMotion } from "./motion";

export const LEVELUP_MS = 2600;
const GOLD = "#F2B33D";
const unit = new THREE.BoxGeometry(1, 1, 1);
const SPARKS = 22;

/** Seviye atlama: yerde genişleyen altın halka, başın üstünde dönen voxel taç, yükselen altın kıvılcımlar. */
export function LevelUpFx({ start, height = 1.62 }: { start: number; height?: number }) {
  const ring = useRef<THREE.Group>(null);
  const crown = useRef<THREE.Group>(null);
  const sparks = useRef<THREE.InstancedMesh>(null);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: GOLD, toneMapped: false, transparent: true }), []);
  const sparkMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true }), []);
  const seeds = useMemo(() => Array.from({ length: SPARKS }, (_, i) => ({
    a: (i / SPARKS) * Math.PI * 2, r: 0.35 + ((i * 37) % 10) / 30, v: 0.8 + ((i * 53) % 10) / 12, d: ((i * 17) % 10) / 25,
  })), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), c: new THREE.Color() }), []);
  const colored = useRef(false);
  useEffect(() => () => { ringMat.dispose(); sparkMat.dispose(); }, [ringMat, sparkMat]);

  useFrame((_, dt) => {
    const k = Math.min(1, (Date.now() - start) / LEVELUP_MS);
    const calm = reducedMotion();
    const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    if (ring.current) {
      ring.current.scale.setScalar(calm ? 1.1 : 0.6 + Math.min(1, k * 2.2) * 0.9);
      ringMat.opacity = 0.85 * fade;
    }
    if (crown.current) {
      crown.current.position.y = height + (calm ? 0.12 : Math.min(1, k * 4) * 0.22 + Math.sin(k * 12) * 0.02);
      if (!calm) crown.current.rotation.y += dt * 2.4;
      crown.current.scale.setScalar((calm ? 1 : Math.min(1, k * 5)) * (0.55 + 0.45 * fade) / 16);
    }
    const mesh = sparks.current;
    if (!mesh) return;
    mesh.visible = !calm;
    if (calm) return;
    const { m, p, q, s, c } = tmp;
    for (let i = 0; i < SPARKS; i++) {
      const sd = seeds[i];
      const t = Math.max(0, k - sd.d);
      const ang = sd.a + t * 5;
      p.set(Math.cos(ang) * sd.r * (1 + t), 0.2 + t * 2.4 * sd.v, Math.sin(ang) * sd.r * (1 + t));
      s.setScalar(t > 0 ? 0.08 * (1 - t) + 0.02 : 0);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      if (!colored.current) mesh.setColorAt(i, c.set(i % 3 ? GOLD : "#FFF3C4"));
    }
    colored.current = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    sparkMat.opacity = fade;
  });

  return (
    <group>
      <group ref={ring} position={[0, 0.03, 0]}>
        {[[0, 0.55, 1.2, 0.09], [0, -0.55, 1.2, 0.09], [0.55, 0, 0.09, 1.2], [-0.55, 0, 0.09, 1.2]].map(([x, z, w, d], i) => (
          <mesh key={i} position={[x, 0, z]} scale={[w, 0.03, d]} geometry={unit} material={ringMat} />
        ))}
      </group>
      <group ref={crown} position={[0, height, 0]} scale={1 / 16}>
        <mesh position={[0, 0.9, 0]} scale={[8.4, 1.8, 8.4]} geometry={unit}>
          <meshLambertMaterial color={GOLD} emissive="#7A5A10" />
        </mesh>
        {[[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5], [0, 3.5], [0, -3.5], [3.5, 0], [-3.5, 0]].map(([x, z], i) => (
          <mesh key={i} position={[x, 2.6, z]} scale={[1.4, 1.8, 1.4]} geometry={unit}>
            <meshLambertMaterial color={GOLD} emissive="#7A5A10" />
          </mesh>
        ))}
        <mesh position={[0, 0.9, 4.25]} scale={[1.4, 1, 0.4]} geometry={unit}>
          <meshBasicMaterial color="#7C5CE0" toneMapped={false} />
        </mesh>
      </group>
      <instancedMesh ref={sparks} args={[unit, sparkMat, SPARKS]} frustumCulled={false} />
    </group>
  );
}

/** Hedef çalışması sürerken ekip bölgesinin üstünde altın hedef etiketi. (ürün sahibi 2026-11-02 "bayraklı alanlar"): direkli
 * bayrak yok — yalnız etiket (dünyada yürüyüşü kesen ya da şehir dokusunu bozan yapı yok).*/
export function GoalFlag({ position, label, overlay, distanceFactor }:
  { position: [number, number, number]; label: string; overlay: RefObject<HTMLDivElement | null>; distanceFactor: number }) {
  return (
    <group position={position}>
      <Html position={[0, 2.2, 0]} center distanceFactor={distanceFactor} zIndexRange={[25, 0]} style={{ pointerEvents: "none" }}
        portal={overlay as MutableRefObject<HTMLElement>}>
        <div className="world-name whud-goal" style={{ ["--c" as string]: GOLD }}>{label ? tx(M, "goal_flag", { label: label.replace(/^(Hedef|Goal):\s*/i, "") }) : tx(M, "goal_flag_active")}</div>
      </Html>
    </group>
  );
}
