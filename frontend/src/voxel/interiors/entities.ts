/**
 * WALK-EXPLORE — Yakındakiler'e giren keşif öğeleri (F ile etkileşim; hiçbiri yakınlıkla panel açmaz):
 * - dış dünyada: kapılar (`door:<yer>`) ve ilgi noktaları (`poi:<n>`); gizli köşeler listede YOK (gizli)
 * - içeride: çıkış portalı (`portal:<id>`), merdivenler (`stair:up|down`; INTERIOR-VIEW: F oraya yürütür, kat merdivenle değişir),
 * asansör durakları (`lift:<id>`; F ile binilir, hedef kattaki kapının önüne varılır), seyir noktası (`vp:<yer>`),
 * alınmamış keşif parçaları (`kesif:<kimlik>`)
 * `components/world/walk/entities.ts` her 4 Hz çağrıda bu listeyi ekler (aynı nesneler yeniden kullanılır; ayırma yok).
*/
import { tx, tz, type Tile } from "../scenes";
import type { ProxEntity } from "../walk/controller";
import { useWalkStore, walkRuntime } from "../walk/walkStore";
import { poiId } from "./catalog";
import { scenePlaces, shift } from "./placement";
import { useInterior } from "./store";

export type ExploreEntity =
  | { type: "door"; site: string }
  | { type: "poi"; n: number; id: string }
  | { type: "portal"; id: string; to: "out"; kind: "exit" }
  | { type: "stair"; id: string; dir: "up" | "down"; to: number }
  | { type: "lift"; id: string; to: number }
  | { type: "vp"; id: string }
  | { type: "kesif"; id: string; model?: string };

export const EXPLORE_PREFIXES = ["door:", "poi:", "portal:", "stair:", "lift:", "vp:", "kesif:"] as const;
export const isExploreEntity = (id: string) => EXPLORE_PREFIXES.some((p) => id.startsWith(p));

const buf: ProxEntity[] = [];
const pool: ProxEntity[] = [];
let info = new Map<string, ExploreEntity>();
let infoKey = "";

/** Kimlikten öğe bilgisi (son kurulan listeden). */
export const exploreEntity = (id: string): ExploreEntity | null => info.get(id) ?? null;

/** Şu anki bağlam (dış dünya / iç kat) için Yakındakiler öğeleri; aynı dizi yeniden doldurulur. */
export function exploreEntities(): readonly ProxEntity[] {
  buf.length = 0;
  const scene = useWalkStore.getState().world;
  if (!scene) return buf;
  const st = useInterior.getState();
  const view = st.view;
  const key = view ? `${view.key}` : `${scene}:${walkRuntime.baseOffset[0]},${walkRuntime.baseOffset[1]}`;
  let k = 0;
  const push = (id: string, kind: ProxEntity["kind"], t: Tile, e: ExploreEntity, far = false) => {
    const p = pool[k] ??= { id: "", kind: "prop", x: 0, z: 0 };
    p.id = id; p.kind = kind; p.x = tx(t[0]); p.z = tz(t[1]); p.far = far;
    buf.push(p); k++;
    if (key !== infoKey) info.set(id, e);
  };
  if (key !== infoKey) info = new Map();
  if (view) {
    const lv = view.level;
    for (const p of lv.portals) push(`portal:${p.id}`, "prop", p.tile, { type: "portal", id: p.id, to: p.to, kind: p.kind });
    // merdiven: yukarı → ayağında, aşağı → üst sahanlıkta (merdivenin başı; eskiden boşluğun ağzında) listelenir
    for (const st of lv.stairs) push(`stair:${st.id}`, "prop", st.stand, { type: "stair", id: st.id, dir: st.dir, to: st.to }, true);
    // aynı hedef kata giden ikinci kapı listede tekrarlanmaz (kapı çalışmaya devam eder). GATEFIX2: hedef kat başına
    // avatara EN YAKIN kapı listelenir (eskiden ilk kapı: NY gözlem gökdeleni girişinde yakın kapı 1,4 birimdeyken F istemi hiç çıkmıyordu)
    const av = walkRuntime.avatar, liftTo = new Map<number, (typeof lv.lifts)[number]>();
    const ld = (l: (typeof lv.lifts)[number]) => Math.hypot(tx(l.tile[0]) - av.x, tz(l.tile[1]) - av.z);
    for (const l of lv.lifts) { const c = liftTo.get(l.to); if (!c || ld(l) < ld(c) - 1e-6) liftTo.set(l.to, l); }
    if (key !== infoKey) for (const l of lv.lifts) info.set(`lift:${l.id}`, { type: "lift", id: l.id, to: l.to });
    for (const l of liftTo.values()) push(`lift:${l.id}`, "prop", l.tile, { type: "lift", id: l.id, to: l.to }, true); // kat bağı yarıçap dışında da listelenir
    for (const s of lv.spots) {
      if (s.kind === "vp") push(`vp:${lv.site}`, "landmark", s.tile, { type: "vp", id: s.id });
      else if (!st.taken.has(s.id)) push(`kesif:${s.id}`, "souvenir", s.tile, { type: "kesif", id: s.id, model: s.model });
    }
  } else {
    const off = walkRuntime.baseOffset;
    const pl = scenePlaces(scene);
    for (const d of pl.doors) if (d.open) push(`door:${d.site}`, "prop", shift(d.tile, off), { type: "door", site: d.site });
    for (const p of pl.pois) push(`poi:${p.id}`, "landmark", shift(p.tile, off), { type: "poi", n: p.id, id: poiId(scene, p.id) });
  }
  infoKey = key;
  return buf;
}
