/** Görünüm düzenleyicideki canlı 3B önizleme: çimen kaidesinde dönen karakter. */
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import type { Avatar, Mood } from "../lib/types";
import { Character, type Motion } from "./Character";

const PEDESTAL: [number, number, string][] = [];
for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) PEDESTAL.push([x, z, (x + z) % 2 ? "#6DBE45" : "#62B03E"]);

export function AvatarPreview({ avatar, mood = "idle", motion = "idle", height = 260 }:
  { avatar: Avatar; mood?: Mood; motion?: Motion; height?: number }) {
  return (
    <div style={{ height }} className="preview-canvas">
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 1.9, 4.3], fov: 34 }}>
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
          <group position={[0, 0, 0]} scale={1}>
            <Character avatar={avatar} mood={mood} motion={motion} />
          </group>
        </group>
        <OrbitControls target={[0, 0.95, 0]} enablePan={false} enableZoom={false} autoRotate autoRotateSpeed={1.6}
          minPolarAngle={0.9} maxPolarAngle={1.65} />
      </Canvas>
    </div>
  );
}
