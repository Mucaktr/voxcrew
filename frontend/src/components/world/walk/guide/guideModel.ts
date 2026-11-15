/**
 * ACTIVITY-FEEL (B6) — şehir rehberi içeriği (saf; React/depo yok). karar: keşfedilenler tam (ad, not, yer), keşfedilmeyenler
 * "???" + kısa bilmece + semt; seçmek işi yapmaz, yalnız "Yol göster" hedefi verir.
 *
 * - Yapılacaklar: şehrin ritüelleri; keşif = anı defterinde yapılmış (`doneIds`). Hedef: avatara en yakın konum (sahne/harita).
 * Hayvana bağlı ritüelin sabit yeri yoktur (hedef yok; ipucu yeter).
 * - Görülecek yerler: sahnenin simge bölgeleri; keşif = vize (`visas`). Hedef: bölgenin avatara en yakın kenar karosu.
 * Test: scripts/feel_guide.test.mjs.
*/
import type { RitualDef } from "../../../../voxel/fun/rituals";

export type HintKey = "bird" | "cat" | "fish" | "squirrel" | "eat" | "drink" | "photo" | "music" | "sunset" | "read" | "craft" | "wave" | "place";
export type DirKey = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export interface GuideItem {
  id: string;
  kind: "do" | "see";
  found: boolean;
  /** keşfedildiyse ad ve not; değilse null (arayüz "???" yazar) */
  name: string | null;
  note: string | null;
  hint: HintKey;
  /** semt adı (biliniyorsa; keşfedilmeyende de gösterilir) */
  place: string | null;
  /** "Yol göster" hedefi (dünya) ve avatara göre yön/uzaklık (karo); yoksa null */
  target: { x: number; z: number } | null;
  dir: DirKey | null;
  steps: number | null;
}

const FOOD = new Set(["simit", "crepe", "sandwich", "paper_cone", "hotdog", "bento", "bowl", "snack", "meal"]);
/** Ritüelin bilmece türü (veriden; şehir dosyası gerekmez). */
export function hintOf(def: Pick<RitualDef, "act" | "react" | "photo" | "when"> & { at?: RitualDef["at"] }): HintKey {
  const lure = def.react?.lure?.kinds[0];
  if (def.photo) return "photo";
  if (lure === "cat" || def.at?.animal === "cat") return "cat";
  if (lure === "squirrel") return "squirrel";
  if (lure === "fish") return "fish";
  if (lure) return "bird";
  if (def.act.motion === "dance" || def.react?.burst === "notes") return "music";
  if (def.act.motion === "cheer" || def.when === "dusk") return "sunset";
  if (def.act.motion === "read") return "read";
  if (def.act.motion === "type" || def.act.held === "hammer") return "craft";
  if (def.act.motion === "sip" || def.act.motion === "eat") return def.act.held && FOOD.has(def.act.held) && def.act.eat !== false ? "eat" : "drink";
  return "wave";
}

/** Yön: −z kuzey (mini harita üstü), +x doğu. */
export function dirOf(dx: number, dz: number): DirKey {
  const a = Math.atan2(dx, -dz); // 0 → kuzey, π/2 → doğu
  const k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  return (["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const)[k];
}

export interface GuideZone { id: string; i0: number; i1: number; j0: number; j1: number }
export interface GuideInput {
  defs: readonly RitualDef[];
  doneIds: ReadonlySet<string>;
  zones: readonly GuideZone[];
  visas: ReadonlySet<string>;
  avatar: { x: number; z: number };
  /** ritüelin şu anki dünyadaki konumları (dünya) */
  anchors: (def: RitualDef) => readonly { x: number; z: number }[];
  /** karo → dünya */
  toWorld: (i: number, j: number) => readonly [number, number];
  ritualName: (def: RitualDef) => string;
  ritualNote: (def: RitualDef) => string;
  ritualPlace: (def: RitualDef) => string | null;
  zoneName: (id: string) => string;
}

function locate(av: { x: number; z: number }, t: { x: number; z: number } | null) {
  if (!t) return { target: null, dir: null, steps: null };
  const dx = t.x - av.x, dz = t.z - av.z;
  return { target: t, dir: dirOf(dx, dz), steps: Math.round(Math.hypot(dx, dz)) };
}

/** Rehber öğeleri: önce yapılacaklar (veri sırası), sonra yerler. */
export function buildGuide(inp: GuideInput): GuideItem[] {
  const out: GuideItem[] = [];
  for (const d of inp.defs) {
    const found = inp.doneIds.has(d.id);
    let best: { x: number; z: number } | null = null, bd = Infinity;
    for (const a of inp.anchors(d)) { const v = Math.hypot(a.x - inp.avatar.x, a.z - inp.avatar.z); if (v < bd) { bd = v; best = { x: a.x, z: a.z }; } }
    out.push({ id: `rt:${d.id}`, kind: "do", found, name: found ? inp.ritualName(d) : null, note: found ? inp.ritualNote(d) || null : null,
      hint: hintOf(d), place: inp.ritualPlace(d), ...locate(inp.avatar, best) });
  }
  for (const z of inp.zones) {
    const found = inp.visas.has(z.id);
    // bölgenin avatara en yakın karosu (simgenin kenarı; içine yürünmez)
    const [ax, az] = [inp.avatar.x, inp.avatar.z];
    let best: { x: number; z: number } | null = null, bd = Infinity;
    for (let j = z.j0; j <= z.j1; j++) for (let i = z.i0; i <= z.i1; i++) {
      if (i !== z.i0 && i !== z.i1 && j !== z.j0 && j !== z.j1) continue;
      const [x, w] = inp.toWorld(i, j), v = Math.hypot(x - ax, w - az);
      if (v < bd) { bd = v; best = { x, z: w }; }
    }
    out.push({ id: z.id, kind: "see", found, name: found ? inp.zoneName(z.id) : null, note: null, hint: "place", place: null, ...locate(inp.avatar, best) });
  }
  return out;
}
