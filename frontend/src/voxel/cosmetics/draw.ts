/**
 * COS-B — kozmetik kutularının örneklenmiş çizimi. Üç malzeme grubu (opak Lambert · parlak Basic · cam %45) → en çok
 * 3 çizim çağrısı; kutlama ayrı bir parlak dizide (+1, yalnız oynarken). Hiçbir şey sahiplenilmemişken bileşenler hiç
 * bağlanmaz (+0). Renk örnek rengidir (`instanceColor`), malzeme paylaşılır.
 */
import * as THREE from "three";
import type { V3 } from "../parts";
import type { SceneBox } from "./registry";

export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
export type Group = "solid" | "glow" | "glass";
export const groupOf = (b: SceneBox): Group => (b.glow ? "glow" : b.glass ? "glass" : "solid");

export function makeMaterial(g: Group): THREE.Material {
  if (g === "glow") return new THREE.MeshBasicMaterial({ toneMapped: false });
  if (g === "glass") return new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
  return new THREE.MeshLambertMaterial();
}

/** Yerleştirme: kutular px cinsindendir; `scale` px → dünya birimi, `rotY` y dönüşü, `pos` dünya konumu. */
export interface Placement { pos: V3; rotY?: number; scale: number | V3 }

const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion();
const _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color(), _y = new THREE.Vector3(0, 1, 0);

/** `boxes`'ı dizinin `start` yuvasından itibaren yazar; yazılan son yuva + 1'i döner (kapasiteyi aşmaz). */
export function writeBoxes(mesh: THREE.InstancedMesh, boxes: readonly SceneBox[], at: Placement, start = 0, cap = mesh.instanceMatrix.count): number {
  _w.compose(_p.set(...at.pos), _q.setFromAxisAngle(_y, at.rotY ?? 0), typeof at.scale === "number" ? _s.setScalar(at.scale) : _s.set(...at.scale));
  let n = start;
  for (const b of boxes) {
    if (n >= cap) break;
    _e.set(b.r?.[0] ?? 0, b.r?.[1] ?? 0, b.r?.[2] ?? 0);
    _m.compose(_p.set(...b.p), _q.setFromEuler(_e), _s.set(...b.s));
    mesh.setMatrixAt(n, _m.premultiply(_w));
    mesh.setColorAt(n, _c.set(b.c));
    n++;
  }
  return n;
}

export function finish(mesh: THREE.InstancedMesh, count: number) {
  mesh.count = count;
  mesh.visible = count > 0;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

/** Kutuları malzeme grubuna ayırır. */
export function split(boxes: readonly SceneBox[]): Record<Group, SceneBox[]> {
  const out: Record<Group, SceneBox[]> = { solid: [], glow: [], glass: [] };
  for (const b of boxes) out[groupOf(b)].push(b);
  return out;
}
