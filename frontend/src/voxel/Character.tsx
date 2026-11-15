/**
 * Bloklardan oluşan (voxel) tek karakter: görünüm düzenleyici önizlemesi ve ajan profili için.
 * Parça listesi `parts.ts`'ten gelir; dünyadaki kalabalık aynı listeyi InstancedMesh ile çizer (Crowd.tsx).
 * Ölçüler "piksel" cinsindendir; grup 1/16 ölçeklenir (16 px = 1 blok). Kök ayak tabanı, +z'ye bakar.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { Avatar, Mood } from "../lib/types";
import { reducedMotion } from "./motion";
import { BONE_PIVOT, characterParts, lerpPose, newPose, poseTargets, type Bone, type BoxPart, type QuadPart, type V3 } from "./parts";
import { MOOD_FACE } from "./pixels";
import { bodyTexture, faceTexture, snoutTexture } from "./pixelTextures";

/** S33: oturan (sit/sitType/sitThink), okuma, konuşma/dinleme, kahve yudumu ve "✓ bitti" sevinci eklendi. */
export type Motion = "idle" | "walk" | "type" | "think" | "jump" | "wave" | "shake" | "sleep"
  | "sit" | "sitType" | "sitThink" | "lounge" | "read" | "talk" | "listen" | "sip" | "cheer"
  /** ACTIVITY-FEEL (B3): yemek yeme (ayakta / oturarak) — el yiyeceği ağza götürür, çiğner */
  | "eat" | "sitEat"
  /** S43: uyuklama (ayakta / oturarak), oturduğu yerde uyuyakalma, şezlong/hamakta uyuma, ayakta tabletle çalışma */
  | "doze" | "sitDoze" | "slump" | "sleepLounge" | "tablet"
  /** S48 eğlenceli hareketler: dans, olta tutma/çekme, masa tenisi, atma-tutma (frizbi/uçak/top), kartopu, hokkabazlık,
   *  top sektirme/pas, yoga, sandalyede dönme, çak bir beşlik, zafer dansı; çarpışma: sendeleme ve popo üstü düşme */
  | "dance" | "fish" | "reel" | "paddle" | "toss" | "snowball" | "juggle" | "kick" | "yoga" | "spin" | "highfive" | "victory"
  /** W2-INT: masa oyunu (tavla/dama) — oturur, sırası gelince taş sürer */
  | "board"
  /** W2-INT: yağmurda şemsiye tutma (Londra) */
  | "umbrella"
  /** W2b-INT: pétanque — ayakta, alttan sakin atış */
  | "bowl"
  /** W3 (WALK-FUN): alkış (tepki / tatlı) ve hediye uzatma (avatar: kol öne) */
  | "clap" | "give"
  | "stagger" | "fall";
/** Harici ajan aksesuarları: Claude Code oturumu "kulaklık" (mikrofonlu), Codex oturumu "vizör". */
export type Accessory = "headset" | "visor";

const geoCache = new Map<string, THREE.BoxGeometry>();
function boxGeo(s: V3) {
  const key = s.join(",");
  let g = geoCache.get(key);
  if (!g) { g = new THREE.BoxGeometry(...s); geoCache.set(key, g); }
  return g;
}
const planeCache = new Map<string, THREE.PlaneGeometry>();
function planeGeo(w: number, h: number) {
  const key = `${w},${h}`;
  let g = planeCache.get(key);
  if (!g) { g = new THREE.PlaneGeometry(w, h); planeCache.set(key, g); }
  return g;
}

/** Aynı renk ve saydamlıktaki parçalar tek malzemeyi paylaşır. */
const matCache = new Map<string, THREE.Material>();
function material(c: string, o?: number, glow?: boolean) {
  const key = `${c}|${o ?? 1}|${glow ? "g" : "l"}`;
  let m = matCache.get(key);
  if (!m) {
    m = glow ? new THREE.MeshBasicMaterial({ color: c, toneMapped: false })
      : new THREE.MeshLambertMaterial({ color: c, transparent: o !== undefined, opacity: o ?? 1 });
    matCache.set(key, m);
  }
  return m;
}

function Box({ part }: { part: BoxPart }) {
  return <mesh position={part.p} rotation={part.r} geometry={boxGeo(part.s)} material={material(part.c, part.o, part.glow)} castShadow={!part.glow} receiveShadow />;
}

export interface CharacterProps {
  avatar: Avatar;
  mood: Mood;
  motion: MutableRefObject<Motion> | Motion;
  phase?: number;
  accessory?: Accessory | null;
}

export function Character({ avatar: a, mood, motion, phase = 0, accessory = null }: CharacterProps) {
  const bones = useRef<Partial<Record<Bone, THREE.Group>>>({});
  const faceMat = useRef<THREE.MeshBasicMaterial>(null);
  const blink = useRef({ next: 2 + Math.random() * 3, until: 0 });
  const pose = useRef(newPose());
  const target = useRef(newPose());
  const baseFace = MOOD_FACE[mood];
  const parts = useMemo(() => characterParts(a, accessory).filter((p) => !(p.kind === "box" && (p.carry || p.device))), [a, accessory]);
  const byBone = useMemo(() => {
    const out: Partial<Record<Bone, (BoxPart | QuadPart)[]>> = {};
    for (const p of parts) (out[p.bone] ??= []).push(p);
    return out;
  }, [parts]);

  useEffect(() => {
    if (faceMat.current) {
      faceMat.current.map = faceTexture(a, baseFace);
      faceMat.current.needsUpdate = true;
    }
  }, [a, baseFace]);

  useFrame((state, dt) => {
    const m = typeof motion === "string" ? motion : motion.current;
    const t = state.clock.elapsedTime + phase;
    const k = Math.min(1, dt * 10);

    // göz kırpma
    const b = blink.current;
    const canBlink = baseFace === "smile" || baseFace === "focus" || baseFace === "curious" || baseFace === "think";
    if (faceMat.current && canBlink) {
      if (t > b.next) { b.until = t + 0.13; b.next = t + 2.2 + Math.random() * 3.5; faceMat.current.map = faceTexture(a, "blink"); }
      else if (b.until && t > b.until) { b.until = 0; faceMat.current.map = faceTexture(a, baseFace); }
    }

    poseTargets(m, t, reducedMotion(), target.current);
    lerpPose(pose.current, target.current, k);
    const p = pose.current, g = bones.current;
    if (g.armL) { g.armL.rotation.x = p.la; g.armL.rotation.z = p.laz; }
    if (g.armR) { g.armR.rotation.x = p.ra; g.armR.rotation.z = p.raz; }
    if (g.legL) g.legL.rotation.x = p.ll;
    if (g.legR) g.legR.rotation.x = p.rl;
    if (g.head) g.head.rotation.set(p.hx, p.hy, p.hz);
    if (g.body) g.body.position.y = p.by;
    if (g.root) { g.root.position.y = p.ry; g.root.position.z = p.fz; g.root.rotation.x = p.rx; }
  });

  const quadMaterial = (q: QuadPart) => {
    if (q.quad === "face") return <meshBasicMaterial ref={faceMat} map={faceTexture(a, baseFace)} transparent toneMapped={false} />;
    if (q.quad === "snout") return <meshBasicMaterial map={snoutTexture(baseFace)} transparent toneMapped={false} />;
    return <meshLambertMaterial map={bodyTexture(a)} />;
  };
  const renderBone = (bone: Bone) => (byBone[bone] ?? []).map((p, i) => p.kind === "box"
    ? <Box key={i} part={p} />
    : <mesh key={i} position={p.p} geometry={planeGeo(p.w, p.h)}>{quadMaterial(p)}</mesh>);
  const ref = (bone: Bone) => (el: THREE.Group | null) => { if (el) bones.current[bone] = el; else delete bones.current[bone]; };

  return (
    <group scale={1 / 16}>
      <group ref={ref("root")}>
        <group ref={ref("legL")} position={BONE_PIVOT.legL}>{renderBone("legL")}</group>
        <group ref={ref("legR")} position={BONE_PIVOT.legR}>{renderBone("legR")}</group>
        <group ref={ref("body")}>
          {renderBone("body")}
          <group ref={ref("armL")} position={BONE_PIVOT.armL}>{renderBone("armL")}</group>
          <group ref={ref("armR")} position={BONE_PIVOT.armR}>{renderBone("armR")}</group>
          <group ref={ref("head")} position={BONE_PIVOT.head}>{renderBone("head")}</group>
        </group>
      </group>
    </group>
  );
}
