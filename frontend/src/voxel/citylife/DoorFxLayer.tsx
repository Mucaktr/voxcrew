/**
 * CITYLIFE (B1) — geçit efekti ailesinin çizimi (`doorFx.ts`): bütün girişlerin parçaları tek örneklenmiş düzlem dizisinde (toplamalı,
 * sis/ton eşlemesiz, gölgesiz) → görünürken +1 çizim çağrısı, voksel blok/parıltı bütçesine girmez. Ses yok.
 *
 *  - Parça başına örnek öznitelikleri: biçim (perde, paspas, lamba, turnike çubuğu, ok şeridi, ışık sütunu), iki renk, evre.
 *  - `prefers-reduced-motion`: saat durur → durağan parıltı (perde bantları, oklar ve lamba sabit).
 *  - Gece biraz daha parlak. Liste boşsa dizi gizli (+0).
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useReducedMotion } from "../motion";
import { useWalkStore, walkRuntime } from "../walk/walkStore";
import { FX_SHAPE_ID, fxParts, type DoorFx, type FxPart } from "./doorFx";

/** Bir karede en çok çizilen parça (semt başına ~30 giriş × 3 parça; bütün harita da sığar). */
export const FX_PART_CAP = 384;
/** GATEFIX3: derlenen parça gölgelendiricisi (fx_view_check avatar sönmesini bu dizgeden okur). */
export { FRAG as DOOR_FX_FRAG };

/** kapı/durak ışık efektleri kameraya bu mesafede (m) tümüyle söner, FAR'da tam görünür (yakın düzlemde perde yok).*/
export const DOOR_FX_CAM_NEAR = 0.9, DOOR_FX_CAM_FAR = 2.2;
/**
 * 1. şahısta sönme daha geniş — durakta (turnike merkezinin ~1 birim çevresi) uzak çubuk bile ekranın %9'unu
 * örtüyordu (scripts/fx_view_check.mjs FX-VIEW-001: en çok %2). 3. şahıs değişmez (kamera zaten 3–5 birim geride).
*/
export const DOOR_FX_CAM_NEAR_FP = 1.8, DOOR_FX_CAM_FAR_FP = 3.4;
/**
 * (hqa21 kuş bakışı "binaların arasında havada küçük açık mavi kare çerçeveler"): efektler sissiz ve toplamalı; uzak LOD bina
 * yanında kapı perdesi + paspas yukarıdan uçan çerçeve gibi okunuyordu. Kameradan FADE_FAR0…FADE_FAR1 birimde söner: yürüme kamerası
 * (takip kolu ≤ 9) kapıyı aynen görür, kuş bakışında (kamera yerden ≥ AIR_H) hiç çizilmez (AERIAL-LOD-002, scripts/aerial_lod_check.mjs).
*/
export const DOOR_FX_FADE_FAR0 = 30, DOOR_FX_FADE_FAR1 = 44;
/** GATEFIX3: gece kazancı (uGain; renk ve alfa çarpanı) — scripts/fx_view_check.mjs gece görünümü bunu içe aktarır. */
export const DOOR_FX_NIGHT_GAIN = 1.3;
/** GATEFIX3: uFirst seçici — 1. şahıs ya da göz yedeği (avatar gizli) → 1. şahıs sönmesi. fx_view_check içe aktarır (kaynak metni okunmaz). */
export const doorFxFirst = (view: string | null | undefined, avatarVisible: boolean): number => (view === "first" || !avatarVisible ? 1 : 0);
const VERT = /* glsl */ `
attribute float aShape;
attribute vec3 aColA;
attribute vec3 aColB;
attribute float aPhase;
varying vec2 vUv;
varying float vShape;
varying vec3 vA;
varying vec3 vB;
varying float vPhase;
varying vec2 vWxz;
varying float vCam;
void main() {
  vUv = uv; vShape = aShape; vA = aColA; vB = aColB; vPhase = aPhase;
  vWxz = (instanceMatrix * vec4(position, 1.0)).xz;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vCam = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform float uTime;
uniform float uGain;
uniform vec2 uAv;
uniform float uFirst;
varying vec2 vWxz;
varying float vCam;
varying vec2 vUv;
varying float vShape;
varying vec3 vA;
varying vec3 vB;
varying float vPhase;
void main() {
  vec2 u = vUv;
  float t = uTime + vPhase * 6.2831853;
  float a;
  vec3 col;
  if (vShape < 0.5) {
    // perde: parlak kapı çerçevesi (yanlar + üst) + aşağıdan yükselen ışık bantları
    float edge = max(1.0 - smoothstep(0.0, 0.1, u.x), smoothstep(0.9, 1.0, u.x));
    float top = smoothstep(0.92, 1.0, u.y);
    float frame = max(edge, top);
    float sh = 0.5 + 0.5 * sin(16.0 * u.y - t * 2.2 + sin(u.x * 9.0 + t) * 1.2);
    float body = (0.16 + 0.24 * sh) * (1.0 - u.y * 0.5);
    a = clamp(frame * 0.95 + body, 0.0, 1.0);
    col = mix(vA, vB, u.y);
  } else if (vShape < 1.5) {
    // paspas: yuvarlatılmış kenar ışığı + yumuşak iç
    vec2 c = abs(u - 0.5) * 2.0;
    float d = max(c.x, c.y);
    float rim = smoothstep(0.68, 0.9, d) * (1.0 - smoothstep(0.94, 1.0, d));
    float pulse = 0.78 + 0.22 * sin(t * 1.6);
    a = (rim * 0.9 + (1.0 - d) * 0.22) * pulse;
    col = mix(vB, vA, d);
  } else if (vShape < 2.5) {
    // lamba ("ding" ışığı): yumuşak disk
    float d = length(u - 0.5) * 2.0;
    a = (1.0 - smoothstep(0.45, 1.0, d)) * (0.72 + 0.28 * sin(t * 3.0));
    col = vA * 1.3;
  } else if (vShape < 3.5) {
    // turnike: üç yatay ışık çubuğu, boyunca akan parıltı
    float s = fract(u.y * 3.0);
    float bar = smoothstep(0.22, 0.38, s) * (1.0 - smoothstep(0.62, 0.78, s));
    float run = 0.6 + 0.4 * sin(u.x * 8.0 - t * 3.0);
    a = bar * run * 0.95;
    // ışık çubukları avatarın gövdesinden geçmez — avatara yaklaştıkça söner (durakta turnike karosunda dururken)
    // çubuklar avatara ±0,45 yanda, 0,8 uzun → en uzak nokta ~0,6; eski 0,3–0,9 sönüm panel kamerasında (arkadan) hâlâ gövdeyi örtüyordu
    a *= smoothstep(0.7, 1.4, length(vWxz - uAv));
    // avatarın ÖNÜNDEN geçen (kamera–avatar doğrusuna yakın) çubuk da söner; avatar turnikenin ötesindeyken ışık gövdeyi örtüyordu
    vec2 sa = cameraPosition.xz, sb = uAv - sa;
    a *= smoothstep(0.45, 1.0, length(vWxz - (sa + sb * clamp(dot(vWxz - sa, sb) / max(dot(sb, sb), 1e-4), 0.0, 1.0))));
    col = mix(vA, vB, u.x);
  } else if (vShape < 4.5) {
    // ok şeritleri: ileri (+v) akan üç köşeli ok
    float v = fract(u.y * 3.0 - t * 0.8);
    float x = abs(u.x - 0.5) * 2.0;
    float chev = 1.0 - smoothstep(0.0, 0.16, abs(v - 0.62 + x * 0.32));
    float side = 1.0 - smoothstep(0.82, 1.0, x);
    a = chev * side * 0.9;
    col = mix(vA, vB, v);
  } else {
    // ışık sütunu: ortası parlak, yukarı sönen, yavaş bantlar
    float x = abs(u.x - 0.5) * 2.0;
    a = (1.0 - x) * pow(1.0 - u.y, 1.2) * 0.65 * (0.7 + 0.3 * sin(u.y * 10.0 - t * 2.0));
    col = mix(vA, vB, u.y);
  }
  // perde (kapı çerçevesi) ve sütun avatarın çevresinde ve kamera–avatar doğrusunun ÖNÜNDE söner — kapı karosunda
  // dururken ışık dikdörtgeni kadrajın ortasını kaplıyor, avatar onun içinde soluk kalıyordu (Marakeş minare kapısı). Uzaktan kapı aynen okunur.
  if (vShape < 0.5 || vShape > 4.5) {
    float dAv = distance(vWxz, uAv);
    vec2 cs = cameraPosition.xz, cb = uAv - cs;
    float tc = dot(vWxz - cs, cb) / max(dot(cb, cb), 1e-4);
    float dLine = length(vWxz - (cs + cb * clamp(tc, 0.0, 1.0)));
    a *= smoothstep(0.55, 1.3, dAv) * mix(1.0, smoothstep(0.5, 1.1, dLine), step(tc, 1.0));
  }
  // uzakta (kuş bakışı) söner
  a *= 1.0 - smoothstep(${DOOR_FX_FADE_FAR0.toFixed(1)}, ${DOOR_FX_FADE_FAR1.toFixed(1)}, vCam);
  // kameraya DOOR_FX_CAM_NEAR..FAR m içinde söner — 1. şahısta durakta ışık sütunu/turnike merceği örtmez
  a *= smoothstep(mix(${DOOR_FX_CAM_NEAR.toFixed(2)}, ${DOOR_FX_CAM_NEAR_FP.toFixed(2)}, uFirst), mix(${DOOR_FX_CAM_FAR.toFixed(2)}, ${DOOR_FX_CAM_FAR_FP.toFixed(2)}, uFirst), vCam);
  gl_FragColor = vec4(col * uGain, a * uGain);
}`;

const FLOOR = new Set(["mat", "chevrons"]);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Parçaları örnek dizisine yazar (saf değil: three nesneleri). Dönüş: yazılan örnek sayısı. */
function writeParts(mesh: THREE.InstancedMesh, parts: readonly FxPart[]): number {
  const g = mesh.geometry;
  const shape = g.getAttribute("aShape") as THREE.InstancedBufferAttribute, ca = g.getAttribute("aColA") as THREE.InstancedBufferAttribute;
  const cb = g.getAttribute("aColB") as THREE.InstancedBufferAttribute, ph = g.getAttribute("aPhase") as THREE.InstancedBufferAttribute;
  const n = Math.min(parts.length, FX_PART_CAP);
  for (let k = 0; k < n; k++) {
    const p = parts[k];
    // zemin parçası: düzlem yatırılır (+v ileri yöne bakar); dikey parça: normal ileri yöne
    _q.setFromEuler(FLOOR.has(p.shape) ? _e.set(Math.PI / 2, p.yaw, 0, "YXZ") : _e.set(0, p.yaw, 0, "YXZ"));
    _m.compose(_v.set(p.x, p.y, p.z), _q, _s.set(p.w, p.h, 1));
    mesh.setMatrixAt(k, _m);
    shape.setX(k, FX_SHAPE_ID[p.shape]);
    _c.set(p.a); ca.setXYZ(k, _c.r, _c.g, _c.b);
    _c.set(p.b); cb.setXYZ(k, _c.r, _c.g, _c.b);
    ph.setX(k, p.phase);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  shape.needsUpdate = true; ca.needsUpdate = true; cb.needsUpdate = true; ph.needsUpdate = true;
  return n;
}

/** Geçit efektleri (liste değişince yeniden yazılır; kare başına yalnız saat). */
export function DoorFxLayer({ list, night = false, visible = true }: { list: readonly DoorFx[]; night?: boolean; visible?: boolean }) {
  const calm = useReducedMotion();
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute("aShape", new THREE.InstancedBufferAttribute(new Float32Array(FX_PART_CAP), 1));
    g.setAttribute("aColA", new THREE.InstancedBufferAttribute(new Float32Array(FX_PART_CAP * 3), 3));
    g.setAttribute("aColB", new THREE.InstancedBufferAttribute(new Float32Array(FX_PART_CAP * 3), 3));
    g.setAttribute("aPhase", new THREE.InstancedBufferAttribute(new Float32Array(FX_PART_CAP), 1));
    return g;
  }, []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, toneMapped: false, fog: false, uniforms: { uTime: { value: 0 }, uGain: { value: 1 }, uAv: { value: new THREE.Vector2(1e4, 1e4) }, uFirst: { value: 0 } },
  }), []);
  useLayoutEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => { const out: FxPart[] = []; for (const f of list) fxParts(f, out); return out; }, [list]);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    writeParts(m, parts);
    m.visible = visible && parts.length > 0;
  }, [parts, visible]);
  mat.uniforms.uGain.value = night ? DOOR_FX_NIGHT_GAIN : 1;
  const t = useRef(0);
  useFrame((_, dt) => {
    if (!visible) return;
    mat.uniforms.uAv.value.set(walkRuntime.avatar.x, walkRuntime.avatar.z);
    // 3. şahıs kolu çöküp göz yedeğine düşünce (avatar gizli) kamera göz pozunda — 1. şahıs sönmesi
    mat.uniforms.uFirst.value = doorFxFirst(useWalkStore.getState().view, walkRuntime.visible);
    if (calm) return;
    t.current += Math.min(dt, 0.1);
    mat.uniforms.uTime.value = t.current;
  });
  // QATOOL (scripts/live_verify.mjs, yalnız DEV): turnike ışık çubuklarının avatar yakınında sönümü. Formül gölgelendiricinin
  // kendisinden okunur (değişirse `fade` null → betik yüksek sesle düşer); örnek: canlı `uAv` tekdüzeni ile çubuk boyunca 9 nokta.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __voxcrewDoorFx?: unknown };
    w.__voxcrewDoorFx = {
      /** efekt dizisini aç/kapa (betik: aynı karede açık/kapalı görüntü farkı = ekranın ışıkla örtülen payı) */
      show: (on: boolean) => { if (mesh.current) mesh.current.visible = on && parts.length > 0; return !!mesh.current?.visible; },
      turnstiles: () => list.filter((f) => f.kind === "turnstile").map((f) => ({ id: f.id, x: f.x, z: f.z, y: f.y, dir: f.dir, tile: f.tile, target: f.target })),
      probe: (x: number, z: number, r = 1.5) => {
        const m = /smoothstep\(([\d.]+), ([\d.]+), length\(vWxz - uAv\)\)/.exec(mat.fragmentShader);
        const av = mat.uniforms.uAv.value as THREE.Vector2;
        if (!m) return { fade: null, uAv: [av.x, av.y], bars: [] };
        const e0 = +m[1], e1 = +m[2];
        const ss = (d: number) => { const t = Math.min(1, Math.max(0, (d - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
        const bars = parts.filter((p) => p.shape === "bars" && Math.hypot(p.x - x, p.z - z) <= r).map((p) => {
          const f: number[] = [];
          for (let k = 0; k <= 8; k++) { const u = (k / 8 - 0.5) * p.w; f.push(ss(Math.hypot(p.x + u * Math.cos(p.yaw) - av.x, p.z - u * Math.sin(p.yaw) - av.y))); }
          return { x: p.x, z: p.z, mean: f.reduce((s, v) => s + v, 0) / f.length, min: Math.min(...f) };
        });
        return { fade: [e0, e1], uAv: [av.x, av.y], visible: !!mesh.current?.visible, bars };
      },
    };
    return () => { delete w.__voxcrewDoorFx; };
  }, [list, parts, mat]);
  return <instancedMesh ref={mesh} args={[geo, mat, FX_PART_CAP]} frustumCulled={false} renderOrder={5} name="door-fx" castShadow={false} receiveShadow={false} />;
}
