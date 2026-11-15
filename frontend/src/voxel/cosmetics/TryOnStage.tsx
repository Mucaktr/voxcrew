/**
 * COS-B — kaydedilmeyen 3D deneme sahnesi: seçili ajan (ya da "Ben") küçük bir ofiste, masasıyla. Denenen kıyafet
 * karakterin parça listesine (`characterParts`; dünyadaki Crowd ile aynı liste), masa süsü masaya, dünya teması ışık,
 * gökyüzü, zemin, duvar ve lamba paletine, kutlama karakterin çevresine çizilir.
 *
 * Perf: her şey örneklenmiş — karakter + oda + masa + süs + tema tek opak / tek parlak / tek cam dizide, kutlama 3 dizi,
 * yüz/gövde/burun dokuları 1–3 → ≈ 8–10 çizim çağrısı (tavan 22; gölge yok). Ölçüm `gl.info.render.calls` → `onCalls`.
 * Hiçbir şey kaydedilmez; bileşen kapanınca durum kaybolur.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import type { Avatar } from "../../lib/types";
import { useReducedMotion } from "../motion";
import { BONE_PIVOT, characterParts, type Bone, type QuadPart, type V3 } from "../parts";
import { MOOD_FACE } from "../pixels";
import { bodyTexture, faceTexture, snoutTexture } from "../pixelTextures";
import { CelebrationBoxes, CosmeticBoxes, type Layer } from "./Boxes";
import type { CelebrationItem, DeskItem, SceneBox, WorldItem } from "./registry";

const S = 1 / 16;
const CHAR: V3 = [-16, 0, 8];
const CHAR_ROT = 0.35;
const DESK_TOP = 12;
const DESK_X = 16, DESK_Z = -12;

const boneOffset = (b: Bone): V3 => (b === "root" || b === "body" ? [0, 0, 0] : BONE_PIVOT[b]);

/** Karakterin durağan (ayakta) parça listesi → sahne kutuları + dokulu dörtgenler. */
function characterBoxes(a: Avatar, badge: boolean): { boxes: SceneBox[]; quads: QuadPart[] } {
  const boxes: SceneBox[] = [], quads: QuadPart[] = [];
  for (const p of characterParts(a, null, badge)) {
    const o = boneOffset(p.bone);
    if (p.kind === "quad") { quads.push({ ...p, p: [p.p[0] + o[0], p.p[1] + o[1], p.p[2] + o[2]] }); continue; }
    if (p.carry || p.device) continue;
    boxes.push({ p: [p.p[0] + o[0], p.p[1] + o[1], p.p[2] + o[2]], s: p.s, c: p.c, r: p.r, glow: p.glow, glass: p.o !== undefined && p.o < 0.9 });
  }
  return { boxes, quads };
}

const DEFAULT_THEME = { sky: "#BFE3F7", hemiSky: "#FFFFFF", hemiGround: "#9CA3AF", sun: "#FFFFFF", sunIntensity: 1.5,
  floor: ["#D6C7AE", "#CBB99C"] as [string, string], wall: "#E7E1D5", lamp: "#FFE7A8" };

function roomBoxes(t: typeof DEFAULT_THEME): SceneBox[] {
  const b: SceneBox[] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++)
    b.push({ p: [-40 + i * 16, -1, -24 + j * 16], s: [16, 2, 16], c: t.floor[(i + j) % 2] });
  b.push({ p: [0, 10, -33], s: [96, 22, 2], c: t.wall });
  b.push({ p: [0, 21.4, -32.4], s: [96, 1, 2.8], c: "#94A3B8" });
  // masa (üst, ayaklar), monitör (parlak ekran), tavan lambası (tema lambası rengi)
  b.push({ p: [DESK_X, DESK_TOP - 0.75, DESK_Z], s: [38, 1.5, 16], c: "#8B5A2B" });
  for (const [x, z] of [[-17, -6.5], [17, -6.5], [-17, 6.5], [17, 6.5]]) b.push({ p: [DESK_X + x, (DESK_TOP - 1.5) / 2, DESK_Z + z], s: [1.6, DESK_TOP - 1.5, 1.6], c: "#6B4423" });
  b.push({ p: [DESK_X + 12, DESK_TOP + 0.4, DESK_Z - 3], s: [4.6, 0.8, 3.2], c: "#334155" });
  b.push({ p: [DESK_X + 12, DESK_TOP + 3, DESK_Z - 3.6], s: [1, 4.4, 1], c: "#475569" });
  b.push({ p: [DESK_X + 12, DESK_TOP + 7.6, DESK_Z - 3.4], s: [12, 7.4, 1], c: "#1F2937" });
  b.push({ p: [DESK_X + 12, DESK_TOP + 7.6, DESK_Z - 2.85], s: [10.8, 6.4, 0.2], c: "#7FD4F0", glow: true });
  b.push({ p: [DESK_X, 30, DESK_Z], s: [0.5, 8, 0.5], c: "#374151" });
  b.push({ p: [DESK_X, 25.6, DESK_Z], s: [5, 1.6, 5], c: "#374151" });
  b.push({ p: [DESK_X, 24.6, DESK_Z], s: [3.4, 0.6, 3.4], c: t.lamp, glow: true });
  return b;
}

function Calls({ onCalls }: { onCalls?: (n: number) => void }) {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    // önceki karenin sayısı (info her karede sıfırlanır; useFrame çizimden önce koşar)
    if (onCalls && gl.info.render.frame % 30 === 0 && gl.info.render.calls > 0) onCalls(gl.info.render.calls);
  });
  return null;
}

function Quad({ q, a }: { q: QuadPart; a: Avatar }) {
  const face = MOOD_FACE.idle;
  return (
    <mesh position={q.p}>
      <planeGeometry args={[q.w, q.h]} />
      {q.quad === "face" ? <meshBasicMaterial map={faceTexture(a, face)} transparent toneMapped={false} />
        : q.quad === "snout" ? <meshBasicMaterial map={snoutTexture(face)} transparent toneMapped={false} />
          : <meshLambertMaterial map={bodyTexture(a)} />}
    </mesh>
  );
}

export interface TryOnProps {
  avatar: Avatar;
  badge?: boolean;
  desk?: DeskItem | null;
  world?: WorldItem | null;
  celebration?: CelebrationItem | null;
  celebrateAt?: number;
  height?: number;
  label: string;
  onCalls?: (n: number) => void;
}

export function TryOnStage({ avatar, badge = false, desk, world, celebration, celebrateAt = 0, height = 280, label, onCalls }: TryOnProps) {
  const calm = useReducedMotion();
  const t = world ? world.theme : DEFAULT_THEME;
  const ch = useMemo(() => characterBoxes(avatar, badge), [avatar, badge]);
  const layers = useMemo<Layer[]>(() => {
    const out: Layer[] = [{ boxes: roomBoxes(t), at: { pos: [0, 0, 0], scale: S } }];
    out.push({ boxes: ch.boxes, at: { pos: [CHAR[0] * S, 0, CHAR[2] * S], rotY: CHAR_ROT, scale: S } });
    if (desk) out.push({ boxes: desk.boxes(), at: { pos: [(DESK_X - 6) * S, DESK_TOP * S, (DESK_Z + 2) * S], scale: S * 0.85 } });
    if (world) out.push({ boxes: world.theme.boxes(), at: { pos: [0, 0, 0], scale: S } });
    return out;
  }, [t, ch, desk, world]);
  return (
    <div style={{ height }} className="preview-canvas" role="img" aria-label={label}>
      <Canvas dpr={[1, 2]} camera={{ position: [0, 1.75, 4.3], fov: 42 }}>
        <color attach="background" args={[t.sky]} />
        <hemisphereLight args={[t.hemiSky, t.hemiGround, 1.15]} />
        <directionalLight position={[3, 6, 4]} intensity={t.sunIntensity} color={t.sun} />
        <CosmeticBoxes layers={layers} />
        <group position={[CHAR[0] * S, 0, CHAR[2] * S]} rotation={[0, CHAR_ROT, 0]} scale={S}>
          {ch.quads.map((q, i) => <Quad key={`${q.quad}${i}`} q={q} a={avatar} />)}
        </group>
        <CelebrationBoxes item={celebration} start={celebrateAt} at={{ pos: [CHAR[0] * S, 0.02, CHAR[2] * S], scale: S }} />
        <OrbitControls target={[0, 0.75, -0.4]} enablePan={false} enableZoom={false} autoRotate={false}
          minPolarAngle={0.8} maxPolarAngle={1.45} minAzimuthAngle={-0.8} maxAzimuthAngle={0.8} enableDamping={!calm} />
        <Calls onCalls={onCalls} />
      </Canvas>
    </div>
  );
}
