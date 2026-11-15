/**
 * W3 (WALK-UX) — Konuş panelinin yanına yerleşeceği ajanın ekran konumu (tuval içinde, +0 çizim çağrısı).
 * Panel açıkken her karede ajanın baş hizasını kameraya izdüşürür ve `walkRuntime.anchor`'a yazar (React yeniden çizimi yok);
 * TalkPanel kendi rAF döngüsünde okur. Panel kapalıyken iş yapmaz.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { WorldLive } from "../../../voxel/live";
import { parsePanel, useWalkStore, walkRuntime } from "../../../voxel/walk/walkStore";
import { walkEntity } from "./entities";

const HEAD_Y = 1.7;

export function WalkPanelAnchor({ live }: { live: WorldLive }) {
  const { camera, size } = useThree();
  const v = useRef(new THREE.Vector3());
  useFrame(() => {
    const a = walkRuntime.anchor;
    const st = useWalkStore.getState();
    const p = st.active ? parsePanel(st.panel) : null;
    if (!p) { a.ok = false; return; }
    let x: number, z: number;
    if (p.kind === "talk") {
      const pos = live.positions.get(p.id);
      if (!pos) { a.ok = false; return; }
      x = pos.x; z = pos.z;
    } else {
      const e = walkEntity(p.id);
      if (!e) { a.ok = false; return; }
      x = e.x; z = e.z;
    }
    v.current.set(x, HEAD_Y, z).project(camera);
    const inView = v.current.z < 1 && Math.abs(v.current.x) <= 1.05 && Math.abs(v.current.y) <= 1.05;
    a.x = ((v.current.x + 1) / 2) * size.width;
    a.y = ((1 - v.current.y) / 2) * size.height;
    a.ok = inView;
  });
  return null;
}
