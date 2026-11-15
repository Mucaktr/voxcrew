/**
 * W4 (WALK-GAME-UI) — hatıraların kare başı köprüsü (React yeniden çizimi yok; walkRuntime deseni).
 *
 *  - `WalkProgress` (HUD) görünür hatıraları **taban karosu** olarak yazar (`items`); bulunanlar listede yoktur.
 *  - `entities.ts` geçerli dünyayı (`built`) yazar ve Yakındakiler'e `souvenir:<id>` öğelerini ekler.
 *  - `walkFun.ts` (Crowd'un var olan ayrılmış yuvaları, +0 çizim çağrısı) hatıraları ve toplama animasyonunu çizer.
 * Büyümüş dünyada taban kayması (`modules[0]`) çizim ve yakınlık anında uygulanır.
 */
import type { SouvenirModel } from "./logic";

export interface LayerItem { id: string; n: number; model: SouvenirModel; /** taban karosu */ bi: number; bj: number }
export interface LayerPop { x: number; z: number; model: SouvenirModel; t0: number }
interface ModuleLike { base?: boolean; i0: number; j0: number }
export interface LayerBuilt { modules?: readonly ModuleLike[]; zones?: readonly { kind: string; i0: number; j0: number; w: number; d: number; tag?: string }[]; width: number; depth: number }

export const souvenirLayer: {
  /** hatıraların ait olduğu sahne (yürüme dünyası); null: çizilmez */
  scene: string | null;
  items: LayerItem[];
  pops: LayerPop[];
  /** geçerli dünya (entities.ts yazar) */
  built: LayerBuilt | null;
} = { scene: null, items: [], pops: [], built: null };

/** Taban karosunu geçerli dünyaya kaydırır (halka büyümesinde taban ortaya kayar). */
export function layerOffset(built: LayerBuilt | null | undefined): [number, number] {
  const m = built?.modules?.[0];
  return m && m.base ? [m.i0, m.j0] : [0, 0];
}

export const POP_MS = 700;
