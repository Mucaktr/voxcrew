/**
 * CITY-PACKS — kaydedilmeyen 3D paket önizlemesi: paketin öğeleri küçük bir meydanda yan yana (ya da seçili tek öğe).
 * Çizim dünyanın kendi `Blocks` bileşeniyle yapılır (grup başına tek örneklenmiş dizi; canlı malzemeler dünyadakiyle aynı
 * hareket eder, hareket azaltmada durağandır) → çizim çağrısı ≈ grup sayısı + zemin. Gölge yok. Hiçbir şey kaydedilmez.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { Blocks } from "../Blocks";
import { useReducedMotion } from "../motion";
import type { Block } from "../scenes";
import type { PackItem } from "./catalog";

const GAP = 1;
const ROW_W = 14;

/** Öğeleri satırlara dizer; dünya koordinatında bloklar ve sınırlar. */
export function layoutItems(items: readonly PackItem[]): { blocks: Block[]; w: number; d: number; h: number } {
  const blocks: Block[] = [];
  let x = 0, z = 0, rowD = 0, maxW = 0, h = 1;
  for (const it of items) {
    if (x > 0 && x + it.w > ROW_W) { z += rowD + GAP; x = 0; rowD = 0; }
    for (const [dx, y, dz, w, hh, d, c, g] of it.boxes()) {
      blocks.push({ p: [x + 0.5 + dx, y, z + 0.5 + dz], s: [w, hh, d], c, g, j: 0.03 });
      h = Math.max(h, y + hh / 2);
    }
    x += it.w + GAP; rowD = Math.max(rowD, it.d); maxW = Math.max(maxW, x - GAP);
  }
  const w = Math.max(1, maxW), d = Math.max(1, z + rowD);
  // ortala + zemin plakası
  for (const b of blocks) { b.p[0] -= w / 2; b.p[2] -= d / 2; }
  blocks.push({ p: [0, -0.06, 0], s: [w + 2, 0.12, d + 2], c: "#CDBFA8", g: "solid", j: 0 });
  return { blocks, w, d, h };
}

export function PackStage({ items, night = false, height = 260, label }: { items: readonly PackItem[]; night?: boolean; height?: number; label: string }) {
  const calm = useReducedMotion();
  const lay = useMemo(() => layoutItems(items), [items]);
  // kamera: yerleşimin sınır küresini 40° görüş açısına sığdır (yukarıdan ~35°, yandan ~25°)
  const radius = Math.max(2, Math.hypot(lay.w / 2 + 1, lay.d / 2 + 1, lay.h / 2));
  const dist = (radius / Math.sin((20 * Math.PI) / 180)) * 0.74;
  const span = dist;
  const cy = Math.min(lay.h * 0.4, 3);
  const cam: [number, number, number] = [dist * Math.sin(0.45) * Math.cos(0.6), cy + dist * Math.sin(0.6), dist * Math.cos(0.45) * Math.cos(0.6)];
  return (
    <div style={{ height }} className="preview-canvas" role="img" aria-label={label}>
      <Canvas dpr={[1, 2]} camera={{ position: cam, fov: 40 }} key={`${span}`}>
        <color attach="background" args={[night ? "#16203A" : "#BFE3F7"]} />
        <hemisphereLight args={[night ? "#8EA0D8" : "#FFFFFF", night ? "#1E2433" : "#9CA3AF", night ? 0.55 : 1.15]} />
        <directionalLight position={[4, 8, 5]} intensity={night ? 0.35 : 1.4} />
        <Blocks blocks={lay.blocks} />
        <OrbitControls target={[0, cy, 0]} enablePan={false} enableZoom autoRotate={false}
          minDistance={2} maxDistance={span * 2} minPolarAngle={0.5} maxPolarAngle={1.45} enableDamping={!calm} />
      </Canvas>
    </div>
  );
}

export default PackStage;
