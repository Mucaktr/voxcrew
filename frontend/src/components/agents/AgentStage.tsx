// Ekip S12: tam profildeki büyük voxel avatar. S7'nin Character bileşenini yalnızca içe aktarır (salt okunur).
// Hareket azaltma tercihinde kendiliğinden dönme ve sürekli animasyon kapanır (frameloop="demand").
// WebGL yoksa ya da sahne çökerse 2B PixelFace'e düşer.
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Component, useEffect, useState, type ReactNode } from "react";
import type { Avatar, Mood } from "../../lib/types";
import { Character, type Motion } from "../../voxel/Character";
import { PixelFace } from "../PixelFace";

const PEDESTAL: [number, number, string][] = [];
for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) PEDESTAL.push([x, z, (x + z) % 2 ? "#6DBE45" : "#62B03E"]);

const MOTION: Record<Mood, Motion> = {
  idle: "idle", thinking: "think", working: "type", waiting: "idle", done: "wave", error: "shake", offline: "sleep",
};

/** `prefers-reduced-motion: reduce` canlı takibi. */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const h = () => setReduced(mq.matches);
    mq.addEventListener?.("change", h);
    return () => mq.removeEventListener?.("change", h);
  }, []);
  return reduced;
}

let webglCache: boolean | null = null;
/** Bir kez denenir; deneme bağlamı hemen bırakılır (tarayıcının bağlam sınırını harcamaz). */
function hasWebGL(): boolean {
  if (webglCache !== null) return webglCache;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    webglCache = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglCache = false;
  }
  return webglCache;
}

class StageBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* 3B sahne çizilemedi; 2B yedek gösterilir */ }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function AgentStage({ avatar, mood, color, height = 240, label }:
  { avatar: Avatar; mood: Mood; color?: string; height?: number; label: string }) {
  const reduced = useReducedMotion();
  const [webgl] = useState(hasWebGL);
  const fallback = (
    <div style={{ height }} className="preview-canvas grid place-items-center" role="img" aria-label={label}>
      <PixelFace avatar={avatar} mood={mood} size={Math.min(160, height - 40)} ring={color} />
    </div>
  );
  if (!webgl) return fallback;
  return (
    <StageBoundary fallback={fallback}>
      <div style={{ height }} className="preview-canvas" role="img" aria-label={label}>
        <Canvas shadows dpr={[1, 2]} frameloop={reduced ? "demand" : "always"} camera={{ position: [0, 1.9, 4.3], fov: 34 }}>
          <hemisphereLight args={["#ffffff", "#6DBE45", 1.2]} />
          <directionalLight position={[3, 6, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
          <group position={[0, -0.05, 0]}>
            {PEDESTAL.map(([x, z, c]) => (
              <group key={`${x}${z}`}>
                <mesh position={[x * 0.6, -0.15, z * 0.6]} receiveShadow>
                  <boxGeometry args={[0.6, 0.3, 0.6]} />
                  <meshLambertMaterial color={c} />
                </mesh>
                <mesh position={[x * 0.6, -0.45, z * 0.6]}>
                  <boxGeometry args={[0.6, 0.3, 0.6]} />
                  <meshLambertMaterial color="#8B5A2B" />
                </mesh>
              </group>
            ))}
            <Character avatar={avatar} mood={mood} motion={reduced ? "idle" : MOTION[mood]} />
          </group>
          <OrbitControls target={[0, 0.95, 0]} enablePan={false} enableZoom={false} autoRotate={!reduced} autoRotateSpeed={1.4}
            minPolarAngle={0.9} maxPolarAngle={1.65} />
        </Canvas>
      </div>
    </StageBoundary>
  );
}
