/**
 * şehir kipinde güneş gölgesi kutusunu kamera hedefine taşıyan kare kancası (hesap: `sunFollow.ts`).
 * Yalnız `World.tsx` şehir haritasında (iç mekân dışı) bağlanır; ayrılınca ışığın eski konumu, hedefi ve gölge kamerası geri yazılır.
 * Ek çizim çağrısı yok (ışık ve hedef zaten sahnede; yalnız konum ve gölge kamerası ayarı değişir).
*/
import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sunFollowPose, sunFollowShadow } from "./sunFollow";

const _fwd = new THREE.Vector3();

interface Saved { pos: THREE.Vector3; tgt: THREE.Vector3; l: number; r: number; t: number; b: number; n: number; f: number; bias: number; nb: number }

export function SunFollow({ light, target, sun, focus }: {
  light: RefObject<THREE.DirectionalLight | null>;
  target: THREE.Object3D;
  /** hedeften güneşe göreli konum (`def.sun.pos`) */
  sun: readonly [number, number, number];
  /** kamera hedefi (`live.camTarget`; WalkRig ve yörünge denetimi her kare yazar) */
  focus: { x: number; z: number };
}) {
  const saved = useRef<{ light: THREE.DirectionalLight; s: Saved } | null>(null);
  useFrame(({ camera }) => {
    const l = light.current;
    if (!l) return;
    const cam = l.shadow.camera;
    if (saved.current?.light !== l) {
      saved.current = { light: l, s: { pos: l.position.clone(), tgt: target.position.clone(), l: cam.left, r: cam.right, t: cam.top, b: cam.bottom,
        n: cam.near, f: cam.far, bias: l.shadow.bias, nb: l.shadow.normalBias } };
    }
    const sh = sunFollowShadow();
    if (cam.left !== -sh.half || cam.top !== sh.half || cam.far !== sh.far || cam.near !== sh.near) {
      cam.left = -sh.half; cam.right = sh.half; cam.top = sh.half; cam.bottom = -sh.half; cam.near = sh.near; cam.far = sh.far;
      cam.updateProjectionMatrix();
    }
    l.shadow.bias = sh.bias;
    l.shadow.normalBias = sh.normalBias;
    camera.getWorldDirection(_fwd);
    const p = sunFollowPose(focus, sun, { forward: [_fwd.x, _fwd.z] });
    l.position.set(p.light[0], p.light[1], p.light[2]);
    target.position.set(p.target[0], p.target[1], p.target[2]);
    target.updateMatrixWorld();
  });
  useEffect(() => () => {
    const sv = saved.current;
    if (!sv) return;
    const { light: l, s } = sv, cam = l.shadow.camera;
    l.position.copy(s.pos); target.position.copy(s.tgt); target.updateMatrixWorld();
    cam.left = s.l; cam.right = s.r; cam.top = s.t; cam.bottom = s.b; cam.near = s.n; cam.far = s.f; cam.updateProjectionMatrix();
    l.shadow.bias = s.bias; l.shadow.normalBias = s.nb;
    saved.current = null;
  }, [target]);
  return null;
}
