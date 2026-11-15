/**
 * GIFTS-GENDER — hediye rafı katmanı (R3F): hediye almış her ajanın masasının yanına küçük bir voxel dolap koyar; içinde en
 * yeni 6 hediye minik voxel eşya olarak durur (`giftShelf.ts`). Raf, istasyonun komşu karolarından ilk serbest olana
 * (sağ, sol, arka) konur; hiçbiri serbest değilse çizilmez (mobilyaya girmez). Tek `CosmeticBoxes` çağrısı (≤ 3 çizim
 * çağrısı); kimsenin hediyesi yoksa hiçbir şey bağlanmaz. En çok 48 raf.
 */
import { useMemo } from "react";
import { useShelves } from "../../full/worldGifts";
import type { Shelf } from "../../lib/seamTypes";
import type { AgentPlan } from "../Crowd";
import type { Built } from "../scenes";
import { key, tx as tileX, tz } from "../scenes";
import { CosmeticBoxes, type Layer } from "./Boxes";
import { shelfBoxes } from "./giftShelf";

const MAX_SHELVES = 48;
const SCALE = 1 / 11;

interface Slotted { slug: string; plan: AgentPlan }

/** Rafın dünya konumu: (x, z, rotY) ya da null. `face` ajanın baktığı yön (sin, cos). */
export function shelfSpot(built: Pick<Built, "blocked">, tile: [number, number], face: number): { x: number; z: number; rotY: number } | null {
  const sx = Math.sin(face), cz = Math.cos(face);
  const dirs: [number, number][] = [[cz, -sx], [-cz, sx], [-sx, -cz]]; // sağ, sol, arka
  for (const [dx, dz] of dirs) {
    const ti = tile[0] + Math.round(dx), tj = tile[1] + Math.round(dz);
    if (ti < 0 || tj < 0 || built.blocked.has(key(ti, tj))) continue;
    // raf komşu karonun ajana yakın kenarına oturur; ön yüzü ajanla aynı yöne bakar (kameraya eşyalar görünür)
    return { x: tileX(tile[0]) + dx * 1.15, z: tz(tile[1]) + dz * 1.15, rotY: face };
  }
  return null;
}

export function GiftShelfLayer({ built, items, enabled = true }: { built: Built; items: Slotted[]; enabled?: boolean }) {
  const shelves = useShelves(enabled);
  const layers = useMemo<Layer[]>(() => {
    const out: Layer[] = [];
    for (const { slug, plan } of items) {
      const shelf: Shelf | undefined = shelves[slug];
      if (!shelf || out.length >= MAX_SHELVES) continue;
      const spot = shelfSpot(built, plan.station.tile, plan.station.face);
      if (!spot) continue;
      out.push({ boxes: shelfBoxes(shelf.items.map((g) => g.kind)), at: { pos: [spot.x, 0, spot.z], rotY: spot.rotY, scale: SCALE } });
    }
    return out;
  }, [built, items, shelves]);
  if (!layers.length) return null;
  return <CosmeticBoxes layers={layers} shadows />;
}
