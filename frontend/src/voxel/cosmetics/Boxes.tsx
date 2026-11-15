/**
 * COS-B — kozmetik kutu katmanları (R3F). `CosmeticBoxes`: durağan kutular, malzeme grubu başına bir örneklenmiş dizi
 * (opak/parlak/cam → en çok 3 çizim çağrısı; boş grup çizilmez). `CelebrationBoxes`: kutlama, parlak + opak + cam dizisi,
 * yalnız oynarken görünür; hareket azaltmada çerçeve `calm` statik hâlidir (zamandan bağımsız, yanıp sönmez).
 */
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { reducedMotion } from "../motion";
import { finish, makeMaterial, split, UNIT_BOX, writeBoxes, type Group, type Placement } from "./draw";
import type { CelebrationItem, SceneBox } from "./registry";

export interface Layer { boxes: readonly SceneBox[]; at: Placement }
const GROUPS: Group[] = ["solid", "glow", "glass"];

function useMaterials() {
  const mats = useMemo(() => ({ solid: makeMaterial("solid"), glow: makeMaterial("glow"), glass: makeMaterial("glass") }), []);
  useEffect(() => () => { for (const g of GROUPS) mats[g].dispose(); }, [mats]);
  return mats;
}

export function CosmeticBoxes({ layers, shadows = false }: { layers: readonly Layer[]; shadows?: boolean }) {
  const mats = useMaterials();
  const parts = useMemo(() => layers.map((l) => ({ at: l.at, g: split(l.boxes) })), [layers]);
  const caps = useMemo(() => {
    const c: Record<Group, number> = { solid: 0, glow: 0, glass: 0 };
    for (const p of parts) for (const g of GROUPS) c[g] += p.g[g].length;
    return c;
  }, [parts]);
  const refs = { solid: useRef<THREE.InstancedMesh>(null), glow: useRef<THREE.InstancedMesh>(null), glass: useRef<THREE.InstancedMesh>(null) };
  useLayoutEffect(() => {
    for (const g of GROUPS) {
      const mesh = refs[g].current;
      if (!mesh) continue;
      let n = 0;
      for (const p of parts) n = writeBoxes(mesh, p.g[g], p.at, n);
      finish(mesh, n);
    }
  }); // her çizimde ucuz: yalnız katmanlar değişince React yeniden çizer
  return (
    <>
      {GROUPS.map((g) => caps[g] > 0 && (
        // kapasite değişince dizi yeniden kurulur (key)
        <instancedMesh key={`${g}:${caps[g]}`} ref={refs[g]} args={[UNIT_BOX, mats[g], caps[g]]} frustumCulled={false}
          castShadow={shadows && g === "solid"} receiveShadow={shadows && g !== "glow"} renderOrder={g === "glass" ? 2 : 0} />
      ))}
    </>
  );
}

const CAP = 220;
/** Kutlama: `start` (performance.now ms) değişince baştan oynar, `durationMs` sonra gizlenir. */
export function CelebrationBoxes({ item, start, at }: { item: CelebrationItem | null | undefined; start: number; at: Placement }) {
  const mats = useMaterials();
  const glow = useRef<THREE.InstancedMesh>(null);
  const solid = useRef<THREE.InstancedMesh>(null);
  const glass = useRef<THREE.InstancedMesh>(null);
  const last = useRef("");
  useFrame(() => {
    const g = glow.current, s = solid.current, c = glass.current;
    if (!g || !s || !c) return;
    const k = item && start > 0 ? (performance.now() - start) / item.durationMs : 2;
    if (!item || k < 0 || k > 1) {
      if (g.visible || s.visible || c.visible) { finish(g, 0); finish(s, 0); finish(c, 0); }
      last.current = "";
      return;
    }
    const calm = reducedMotion();
    // statik hâl: bir kez yazılır (her karede değişmez)
    const sig = `${item.id}:${start}`;
    if (calm && last.current === sig) return;
    last.current = calm ? sig : "";
    const parts = split(item.frame(calm ? 0 : k, calm));
    finish(g, writeBoxes(g, parts.glow, at, 0, CAP));
    finish(s, writeBoxes(s, parts.solid, at, 0, CAP));
    finish(c, writeBoxes(c, parts.glass, at, 0, CAP));
  });
  return (
    <>
      <instancedMesh ref={glow} args={[UNIT_BOX, mats.glow, CAP]} frustumCulled={false} visible={false} />
      <instancedMesh ref={solid} args={[UNIT_BOX, mats.solid, CAP]} frustumCulled={false} visible={false} />
      <instancedMesh ref={glass} args={[UNIT_BOX, mats.glass, CAP]} frustumCulled={false} visible={false} renderOrder={2} />
    </>
  );
}
