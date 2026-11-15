/**
 * Sahne bloklarını malzeme grubuna göre tek InstancedMesh'lerle çizer (+ renk titreşimi).
 * Canlı gruplar (örnek başına): wave = dalga, bob = suda sallanan nesne, flag = direkte dalgalanan kumaş,
 * snow = yağan kar, spin = dönen yapı (çark, dolap, atlı karınca, yel değirmeni; `Block.r`, matematik voxel/spin.ts).
 * Hareket azaltma açıkken hepsi durağan çizilir (spin: yazılan taban poz).
 * EXP-INT (E1b): `tail` açıkken durağan gruplar (`solid/water/glass/glow`) `taban + TAIL_CAP` kapasiteyle kurulur; kuyruğa çevre
 * parselleri `expanse/tail.ts` ile imperatif yazılır (`blocks` dışında; +0 çizim çağrısı).
 * E3: kuyruğa hayalet yuvası + inşa bölgesi eklenir (`build/store.ts tailExtraFor`; parseli olmayan dünyada ek 0).
*/
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { isTailGroup, TAIL_CAP } from "./expanse/stream";
import { registerTail, tickTail, unregisterTail } from "./expanse/tail";
import { installTailFade } from "./fadeShader";
import { useBuildTail } from "./build/store";
import { reducedMotion } from "./motion";
import type { Block, Group } from "./scenes";
import { installCutaway } from "./walk/cover";
import { GROUP_ALPHA } from "./blockAlpha";
import { spinAngle, spinCenter, spinQuat } from "./spin";
import { tintHex } from "./props/weather";
import { AMBIENT_FLOOR } from "./props/fillLight";
import { installWaterFlow, tickWaterFlow } from "./waterFlow";
import { drawnBlocks } from "./zfight"; // aynı düzlemde örtüşen farklı renkli yüzler çizimden önce çözülür

const unit = new THREE.BoxGeometry(1, 1, 1);

function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const ANIMATED = new Set<Group>(["wave", "bob", "flag", "snow", "spin"]);
const SNOW_H = 8.5;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** Dalga yüksekliği: konuma bağlı faz, böylece su karoları birlikte "yuvarlanır". */
export const waveY = (t: number, x: number, z: number) => Math.sin(t * 1.5 + x * 0.7 + z * 0.45) * 0.07 + Math.sin(t * 0.9 - x * 0.3) * 0.03;

/** Grup malzemesi `GROUP_ALPHA` tablosundan (UX-AUDIT INTERIOR-OPAQUE-001: yalnız cam/su/bulut saydam; tablo walk_check'te denetlenir). */
function makeMaterial(group: Group): THREE.MeshBasicMaterial | THREE.MeshLambertMaterial {
  const a = GROUP_ALPHA[group] ?? GROUP_ALPHA.solid;
  if (a.basic) return new THREE.MeshBasicMaterial({ toneMapped: false });
  // opak malzemede ışıktan bağımsız küçük bir taban (props/fillLight.ts AMBIENT_FLOOR): koyu boyalı, güneşe sırtı dönük
  // yüzler (kiosk/pano arkası, durak çatısı altı) simsiyah okunuyordu; taban albedoya çarpılmaz, güneş yüzleri etkilenmez
  return a.transparent ? new THREE.MeshLambertMaterial({ transparent: true, opacity: a.opacity, depthWrite: a.depthWrite })
    : new THREE.MeshLambertMaterial({ emissive: new THREE.Color(AMBIENT_FLOOR, AMBIENT_FLOOR, AMBIENT_FLOOR) });
}

/** `spin` malzemesine örnek başına "ışıklı" bayrağı (`Spin.e`): bayraklı örnek gece parıltısı gibi ışıksız tam renk çizilir
 * (aynı malzeme, aynı çizim çağrısı). Kesit yaması bunun üstüne zincirlenir.*/
const NL = "\n";
function installSpinLit(m: THREE.MeshLambertMaterial | THREE.MeshBasicMaterial) {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>${NL}attribute float spinLit;${NL}varying float vSpinLit;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>${NL}vSpinLit = spinLit;`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>${NL}varying float vSpinLit;`)
      .replace("#include <opaque_fragment>", `outgoingLight = mix(outgoingLight, diffuseColor.rgb, vSpinLit);${NL}#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => "spin-lit-1";
}

function Instanced({ blocks, group, tail = 0 }: { blocks: Block[]; group: Group; tail?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const cap = blocks.length + tail;
  const still = useRef(false);
  // spin kendi geometri kopyasını taşır (örnek başına `spinLit` özniteliği paylaşılan birim kutuya yazılmaz)
  // TOUR-VIEW: kuyruklu grup da kendi kopyasını taşır (örnek başına `tailFade`, kapasite boyu)
  // kesitli grup örnek başına `cutFix` taşır (1 = yapı parçası, yan kesit açmaz; walk/cover.ts `sideProp`)
  const cuts = group !== "cloud" && group !== "snow";
  const geometry = useMemo(() => {
    if (group !== "spin" && !tail && !cuts) return unit;
    const g = unit.clone();
    if (cuts) g.setAttribute("cutFix", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    if (group === "spin") g.setAttribute("spinLit", new THREE.InstancedBufferAttribute(new Float32Array(blocks.map((b) => (b.r?.e ? 1 : 0))), 1));
    if (tail) g.setAttribute("tailFade", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    return g;
  }, [group, group === "spin" ? blocks : null, tail, cap, cuts]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (geometry !== unit) geometry.dispose(); }, [geometry]);
  const fades = tail > 0;
  const material = useMemo(() => {
    const m = makeMaterial(group);
    if (group === "spin") installSpinLit(m);
    if (group === "water") installWaterFlow(m); // CEOGOZU: akan su (doku kayması)
    if (fades) installTailFade(m);
    // W2 (WALK-INT): yürüme modu kesiti — çatı kırpması + duvar penceresi; birimler kapalıyken (w = 0) etkisiz, +0 çizim çağrısı.
    // Gökyüzü katmanları (bulut, kar) kesilmez: avatarı örtmezler.
    if (group !== "cloud" && group !== "snow") installCutaway(m);
    return m;
  }, [group, fades]);
  useEffect(() => () => material.dispose(), [material]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() }), []);
  const spin = useMemo(() => ({ c: [0, 0, 0], r: [0, 0, 0, 1] }), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    blocks.forEach((b, i) => {
      m.compose(new THREE.Vector3(...b.p), new THREE.Quaternion(), new THREE.Vector3(...b.s));
      mesh.setMatrixAt(i, m);
      c.set(tintHex(b.c)); // mevsim taç rengi (eşlem boşsa aynen)
      if (b.j) c.offsetHSL(0, 0, (hash(i + b.p[0] * 13 + b.p[2] * 7) - 0.5) * b.j * 2);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const fix = (geometry.getAttribute("cutFix") as THREE.InstancedBufferAttribute | undefined) ?? null;
    if (fix) { const fa = fix.array as Float32Array; fa.fill(0); blocks.forEach((b, i) => { if (b.fix) fa[i] = 1; }); fix.needsUpdate = true; }
    // EXP-INT: kuyruk sıfır matrisle gizli, count = taban (çevre akışı yuvaları yazınca uzar)
    if (tail) registerTail(group, mesh, blocks.length, blocks.length + tail, (geometry.getAttribute("tailFade") as THREE.InstancedBufferAttribute | undefined) ?? null, fix);
    mesh.computeBoundingSphere();
    still.current = true; // ilk karede taban konumlar yazıldı
    return tail ? () => unregisterTail(group, mesh) : undefined;
  }, [blocks, tail, group, geometry]);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    if (tail) tickTail(); // TOUR-VIEW: geçiş saati + süresi dolan silinmeler (kare başına bir kez işler)
    const t = clock.elapsedTime;
    const calm = reducedMotion();
    if (group === "water") tickWaterFlow(t, calm);
    // CEOGOZU: su mesh'i artık yukarı-aşağı sallanmaz (kıyı/köprü/zemin yüzleriyle ±0,04 bantta kesişip titreşiyordu); hareket doku akışıdır (waterFlow.ts)
    if (group === "cloud") mesh.position.x = calm ? 0 : ((t * 0.35) % 40) - 10;
    if (group === "flame") {
      mesh.scale.y = calm ? 1 : 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.05;
      mesh.position.y = -(mesh.scale.y - 1) * 0.3;
    }
    if (!ANIMATED.has(group)) return;
    if (calm) {
      if (still.current) return;
      // hareket azaltma: taban konumlara bir kez dön
      blocks.forEach((b, i) => {
        tmp.m.compose(tmp.p.set(...b.p), tmp.q.identity(), tmp.s.set(...b.s));
        mesh.setMatrixAt(i, tmp.m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      still.current = true;
      return;
    }
    still.current = false;
    const { m, p, q, s } = tmp;
    if (group === "spin") {
      const c = spin.c, r = spin.r;
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const ang = b.r ? spinAngle(b.r, t) : 0;
        spinCenter(b, ang, c);
        spinQuat(b, ang, r);
        m.compose(p.set(c[0], c[1], c[2]), q.set(r[0], r[1], r[2], r[3]), s.set(...b.s));
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      return;
    }
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const [x, y, z] = b.p;
      s.set(...b.s);
      if (group === "wave") {
        p.set(x, y + waveY(t, x, z), z); q.identity();
      } else if (group === "bob") {
        p.set(x, y + waveY(t, x, z) * 1.2, z); q.setFromAxisAngle(Z_AXIS, Math.sin(t * 1.3 + z) * 0.04);
      } else if (group === "flag") {
        // kumaş direğin çevresinde döner: pivot = merkez − 0,5 (bayrak eni 1)
        const a = Math.sin(t * 3.2 + x * 0.8) * 0.32 + Math.sin(t * 7.1 + z) * 0.07;
        const ox = x - 0.5;
        p.set(ox + Math.cos(a) * 0.5, y + Math.sin(t * 5 + x) * 0.015, z - Math.sin(a) * 0.5);
        q.setFromAxisAngle(Y_AXIS, a);
      } else {
        const v = 0.45 + hash(i) * 0.5;
        const yy = 0.3 + ((((y - 0.3 - t * v) % SNOW_H) + SNOW_H) % SNOW_H);
        p.set(x + Math.sin(t * 0.8 + i) * 0.25, yy, z + Math.cos(t * 0.6 + i * 1.7) * 0.15); q.identity();
      }
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  // spin gölge atmaz → gölge geçişinde ek çizim yok (yalnız kullanılan sahnede +1 çağrı)
  const shadows = group === "solid" || group === "bob" || group === "flag";
  return (
    <instancedMesh key={geometry.uuid} ref={ref} args={[geometry, material, cap]} renderOrder={(GROUP_ALPHA[group] ?? GROUP_ALPHA.solid).order} castShadow={shadows}
      receiveShadow={group !== "glow" && group !== "snow"} frustumCulled={false} />
  );
}

/** `tail`: yürüme modu çevre kuyruğu (yalnız World; durağan gruplar). */
export function Blocks({ blocks, tail = false }: { blocks: Block[]; tail?: boolean }) {
  const extra = useBuildTail(); // E3: inşa kuyruğu eki (kararlı referans; yalnız gereken kapasite değişince)
  const groups = useMemo(() => {
    const out = new Map<Group, Block[]>();
    for (const b of drawnBlocks(blocks)) { // (liste başına bir kez, önbellekli)
      if (!out.has(b.g)) out.set(b.g, []);
      out.get(b.g)!.push(b);
    }
    return [...out.entries()];
  }, [blocks]);
  return (
    <>
      {groups.map(([g, list]) => (
        <group key={g} position={g === "flame" ? [0, 0, 0] : undefined}>
          <Instanced group={g} blocks={list} tail={tail && isTailGroup(g) ? TAIL_CAP[g] + extra[g] : 0} />
        </group>
      ))}
    </>
  );
}
