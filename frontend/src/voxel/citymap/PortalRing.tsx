/**
 * CORE-WALK (kalite seferberliği, KAPI) — **ışınlanma halkası**: şehir kapısının ("Şehre çık", ofis tabanı) ve şehir haritasındaki
 * "Ofise dön" kapısının karosunun ortasında dönen ışık girdabı, hafif ışık sütunu ve yükselen parıltılar — kullanıcı karonun bir
 * geçit olduğunu görür. Ses yok.
 *
 *  - Çizim: tek birleşik geometri (zemin girdabı + açık ışık sütunu; tek gölgelendirici, toplamalı, sis/ton eşlemesiz) + parçacık
 *    noktaları → görünürken 2 çizim çağrısı; voksel blok/parıltı bütçesine girmez (ayrı ağ, blok yok).
 *  - `prefers-reduced-motion`: saat durur (durağan parıltı; girdap ve sütun bantları sabit), parçacıklar çizilmez.
 *  - Konum: `portalSpot` (saf; test: scripts/portal_ring.test.mjs) — karonun ortası, zeminin hemen üstü.
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useReducedMotion } from "../motion";
import { tx, tz, type Tile } from "../scenes";
import { tx as tx18 } from "../../lib/i18n";
import { city as CM } from "../../locales/city";

/** Halkanın yarıçapı (karo 1 birim; kemer direkleri arasında kalır) ve sütun boyu. */
export const PORTAL_R = 0.42;
export const PORTAL_H = 1.7;
/** Halkanın zeminden yüksekliği (kapı zemin plakasının üstü: plaka üstü 0,03). */
export const PORTAL_Y = 0.036;
const PARTICLES = 16;

/** etiketin sütun tepesinden yüksekliği ve dünya yüksekliği (birim; genişlik metinle).*/
export const PORTAL_LABEL_Y = PORTAL_H + 0.45;
const LABEL_H = 0.34;

/** Hedef tabelası: koyu yarı saydam zemin, açık yazı; kamera ölçeğiyle küçülür (dünyada sabit boy), sis yok, derinlik sınaması var. */
function portalLabel(text: string): THREE.Sprite {
  const px = 48, pad = 18;
  const c = document.createElement("canvas");
  const g0 = c.getContext("2d")!;
  g0.font = `600 ${px}px system-ui, sans-serif`;
  const w = Math.ceil(g0.measureText(text).width) + pad * 2, h = px + pad;
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(15,23,42,0.82)";
  g.beginPath(); g.roundRect(0, 0, w, h, h / 2); g.fill();
  g.font = `600 ${px}px system-ui, sans-serif`; g.fillStyle = "#F8FAFC"; g.textBaseline = "middle"; g.textAlign = "center";
  g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  sp.scale.set((LABEL_H * w) / h, LABEL_H, 1);
  sp.position.set(0, PORTAL_LABEL_Y, 0);
  sp.renderOrder = 7;
  sp.name = "portal-label";
  return sp;
}

/** Karonun portal noktası (dünya). Saf. */
export const portalSpot = (tile: Tile): { x: number; y: number; z: number } => ({ x: tx(tile[0]), y: PORTAL_Y, z: tz(tile[1]) });

/** Girdap (disk) + sütun geometrisi: `aKind` 0 disk, 1 sütun; uv disk için kutupsal (r, θ), sütun için (θ, y). */
function portalGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], kind: number[] = [], idx: number[] = [];
  const SEG = 48, RINGS = 6;
  // disk: merkez + halkalar
  for (let r = 0; r <= RINGS; r++) for (let s = 0; s <= SEG; s++) {
    const a = (s / SEG) * Math.PI * 2, rr = (r / RINGS) * PORTAL_R;
    pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); uv.push(rr / PORTAL_R, s / SEG); kind.push(0);
  }
  for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) {
    const a = r * (SEG + 1) + s, b = a + SEG + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // sütun: açık silindir (yan yüz), tabandan PORTAL_H'ye
  const base = pos.length / 3, ROWS = 4;
  for (let y = 0; y <= ROWS; y++) for (let s = 0; s <= SEG; s++) {
    const a = (s / SEG) * Math.PI * 2, h = (y / ROWS) * PORTAL_H, rr = PORTAL_R * (1 - 0.18 * (y / ROWS));
    pos.push(Math.cos(a) * rr, h, Math.sin(a) * rr); uv.push(s / SEG, y / ROWS); kind.push(1);
  }
  for (let y = 0; y < ROWS; y++) for (let s = 0; s < SEG; s++) {
    const a = base + y * (SEG + 1) + s, b = a + SEG + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(idx);
  return g;
}

const VERT = /* glsl */ `
attribute float aKind;
varying vec2 vUv;
varying float vKind;
void main() {
  vUv = uv; vKind = aKind;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform float uGain;
varying vec2 vUv;
varying float vKind;
void main() {
  float a;
  vec3 col;
  if (vKind < 0.5) {
    // girdap: kutupsal (r, θ); üç kollu sarmal + parlak kenar halkası + yumuşak merkez
    float r = vUv.x, th = vUv.y * 6.2831853;
    float spiral = 0.5 + 0.5 * sin(3.0 * th + 9.0 * r - uTime * 2.4);
    float rim = smoothstep(0.78, 0.9, r) * (1.0 - smoothstep(0.93, 1.0, r));
    float body = smoothstep(1.0, 0.55, r) * (0.25 + 0.75 * spiral) * smoothstep(0.0, 0.35, r);
    a = clamp(rim * 1.2 + body * 0.75 + (1.0 - smoothstep(0.0, 0.3, r)) * 0.35, 0.0, 1.0);
    col = mix(uA, uB, spiral * r);
  } else {
    // sütun: yukarı doğru sönen, yavaş yükselen ince bantlar
    float y = vUv.y;
    float bands = 0.55 + 0.45 * sin(14.0 * y - uTime * 2.0 + vUv.x * 6.2831853 * 2.0);
    a = pow(1.0 - y, 1.6) * 0.38 * bands;
    col = mix(uA, uB, y);
  }
  gl_FragColor = vec4(col * uGain, a * uGain);
}`;

const P_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uScale;
varying float vFade;
void main() {
  float k = fract(aSeed * 7.31 + uTime * 0.32);
  float ang = aSeed * 6.2831853 + uTime * 0.9;
  float r = ${PORTAL_R.toFixed(2)} * (0.55 + 0.4 * fract(aSeed * 3.7));
  vec3 p = vec3(cos(ang) * r, k * ${(PORTAL_H * 0.85).toFixed(2)}, sin(ang) * r);
  vFade = (1.0 - k) * smoothstep(0.0, 0.12, k);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uScale * 0.05 / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const P_FRAG = /* glsl */ `
uniform vec3 uB;
varying float vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = 1.0 - smoothstep(0.2, 0.5, length(c));
  gl_FragColor = vec4(uB * 1.4, d * vFade);
}`;

/**
 * Işınlanma halkası. `kind`: "city" (şehre geçit; turkuaz → mor) ya da "home" (geri dönüş; altın → turkuaz). `night`: gece biraz
 * daha parlak. Görünmezken (`visible=false`) saat de durur.
 */
export function PortalRing({ tile, kind = "city", night = false, visible = true }: { tile: Tile; kind?: "city" | "home"; night?: boolean; visible?: boolean }) {
  const calm = useReducedMotion();
  const geo = useMemo(() => portalGeometry(), []);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, toneMapped: false, fog: false,
    uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uGain: { value: 1 } },
  }), []);
  const pGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(Array.from({ length: PARTICLES }, (_, k) => (k + 0.5) / PARTICLES), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, PORTAL_H / 2, 0), PORTAL_H);
    return g;
  }, []);
  const pMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: P_VERT, fragmentShader: P_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uB: { value: new THREE.Color() } },
  }), []);
  // söküldüğünde GPU kaynakları bırakılır (her şehir girişi/çıkışı yeni geometri + iki gölgelendirici bırakıyordu)
  useEffect(() => () => { geo.dispose(); mat.dispose(); pGeo.dispose(); pMat.dispose(); }, [geo, mat, pGeo, pMat]);
  const [a, b] = kind === "home" ? ["#FFD36B", "#5EEAD4"] : ["#38E1F5", "#A78BFA"];
  mat.uniforms.uA.value.set(a); mat.uniforms.uB.value.set(b);
  mat.uniforms.uGain.value = night ? 1.25 : 1;
  pMat.uniforms.uB.value.set(b);
  const t = useRef(0);
  useFrame((st, dt) => {
    if (!visible || calm) return;
    t.current += Math.min(dt, 0.1);
    mat.uniforms.uTime.value = t.current;
    pMat.uniforms.uTime.value = t.current;
    pMat.uniforms.uScale.value = st.size.height * 1.2;
  });
  // halka etiketsizdi (doğuşun dibinde ne olduğu belli değildi) — sütunun üstünde hedefi söyleyen tabela
  const label = useMemo(() => portalLabel(tx18(CM, kind === "home" ? "gate_label" : "door_label")), [kind]);
  useEffect(() => () => { label.material.map?.dispose(); label.material.dispose(); }, [label]);
  const p = portalSpot(tile);
  return (
    <group position={[p.x, p.y, p.z]} visible={visible} name="portal-ring">
      <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />
      {!calm && <points geometry={pGeo} material={pMat} frustumCulled={false} renderOrder={6} />}
      <primitive object={label} />
    </group>
  );
}
