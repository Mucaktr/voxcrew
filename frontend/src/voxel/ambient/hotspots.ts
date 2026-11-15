/**
 * S48 — durağan etkileşimli öğeler (ağaç, çiçek, lamba, kahve makinesi, su, akvaryum): tek görünmez hedef dizisi. Saf TypeScript
 * (three/React yok): Ambient.tsx çizer ve dağıtır; `scripts/interact_all.test.mjs` her sahne + büyüme bölgesi için aynı fonksiyonu
 * Node'da çağırıp bütün suyun tıklanabilir olduğunu denetler (tek doğruluk kaynağı: ambient/habitat.ts su kümeleri).
 */
import type { Built, Tile } from "../scenes";
import { D, tx, tz, W } from "../scenes";
import { habitat, type Habitat, type Water } from "./habitat";
import { lampKey } from "./lampSwitch";
import type { HotKind } from "./touch";

/** Karonun su yüzü: kalın su yüzeyi (film/birikinti hariç), yoksa suyun ortalaması. */
function waterTopOf(h: Habitat, w: Water, tl: Tile): number {
  const y = h.waterY[tl[1] * h.width + tl[0]];
  return y > -9 ? y : w.y;
}

/** Aynı seviyedeki (0,05) su karolarını satır öncelikli açgözlü dikdörtgenlere birleştirir (dünya x/z merkezi + boyut). */
export function waterRects(h: Habitat, w: Water): { x: number; z: number; w: number; d: number; top: number }[] {
  const key = new Map<number, number>();
  for (const t of w.tiles) key.set(t[1] * h.width + t[0], Math.round(waterTopOf(h, w, t) * 20));
  const out: { x: number; z: number; w: number; d: number; top: number }[] = [];
  const order = [...key.keys()].sort((p, q) => p - q);
  for (const k of order) {
    const kv = key.get(k);
    if (kv === undefined) continue;
    const i0 = k % h.width, j0 = (k - i0) / h.width;
    let wd = 1;
    while (key.get(j0 * h.width + i0 + wd) === kv && i0 + wd < h.width) wd++;
    let ht = 1;
    grow: for (;;) {
      for (let i = i0; i < i0 + wd; i++) if (key.get((j0 + ht) * h.width + i) !== kv) break grow;
      ht++;
    }
    for (let j = j0; j < j0 + ht; j++) for (let i = i0; i < i0 + wd; i++) key.delete(j * h.width + i);
    out.push({ x: tx(i0) + (wd - 1) / 2, z: tz(j0) + (ht - 1) / 2, w: wd, d: ht, top: kv / 20 });
  }
  return out;
}

export interface Hot {
  kind: HotKind; x: number; y: number; z: number; sx: number; sy: number; sz: number; top: number; bulb?: [number, number, number, number, number, number];
  /** lamba işaretinin anahtarı (varsa): kapatınca zemindeki ışık havuzu ve nokta ışığı da söner (lampSwitch) */
  lamp?: string;
  /** WATER-ALL: büyük su (deniz/nehir/kanal) birleşik dikdörtgen; tıklama olay zincirini kesmez (tıkla-git bozulmaz), Yakındakiler/avatar dokunuşuna girmez */
  big?: boolean;
}
/** Hedef tavanı: ağaç, lamba, su karoları (gölet başına karo), çiçekler (en sonda). */
export const HOT_MAX = 1400;
const hotCache = new WeakMap<Built, Hot[]>();

function isGreenHex(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return g > r + 12 && g > b + 8;
}

function isWarm(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r > 200 && g > 150 && b < 200 && r >= g;
}

export function hotspots(built: Built): Hot[] {
  const hit = hotCache.get(built);
  if (hit) return hit;
  const h = habitat(built);
  const out: Hot[] = [];
  const push = (x: Hot) => { if (out.length < HOT_MAX) out.push(x); };
  for (const tr of h.trees) push({ kind: "tree", x: tr.x + 0.2, y: tr.y / 2, z: tr.z, sx: 1.5, sy: Math.max(1, tr.y), sz: 1.5, top: tr.y });
  for (const m of built.props ?? []) {
    if (m.k === "lamp") {
      const floor = (m.s?.[0] ?? 0) > 1.8;
      const bulb: Hot["bulb"] = floor ? [m.p[0], m.p[1], m.p[2], 0.54, 0.44, 0.54] : [m.p[0], m.p[1], m.p[2], 0.33, 0.15, 0.33];
      const lamp = lampKey(m.p[0], m.p[2]);
      push(floor ? { kind: "lamp", x: m.p[0], y: 0.9, z: m.p[2], sx: 0.6, sy: 1.8, sz: 0.6, top: 1.7, bulb, lamp }
        : { kind: "lamp", x: m.p[0], y: 1.15, z: m.p[2], sx: 0.36, sy: 0.6, sz: 0.36, top: 1.4, bulb, lamp });
    } else if (m.k === "coffee") push({ kind: "coffee", x: m.p[0], y: 0.8, z: m.p[2], sx: 0.9, sy: 1.6, sz: 0.9, top: 1.56 });
  }
  // dekor lambaları (fener direği, sarkıt lamba): sıcak renkli küçük parlayan blok; direği varsa hedef direği de kapsar
  const propLamp = (x: number, z: number) => out.some((o) => o.kind === "lamp" && Math.abs(o.x - x) < 0.15 && Math.abs(o.z - z) < 0.15);
  // dekor lambasının ışık havuzu işareti biraz kaymış olabilir (kol ucundaki fener): ≤ 1 birimdeki en yakın lamba işareti
  const lampMarks = (built.props ?? []).filter((m) => m.k === "lamp");
  const nearMark = (x: number, z: number) => {
    let best: string | undefined, bd = 1;
    for (const m of lampMarks) { const d = Math.hypot(m.p[0] - x, m.p[2] - z); if (d < bd) { bd = d; best = lampKey(m.p[0], m.p[2]); } }
    return best;
  };
  for (const g of built.blocks) {
    if (g.g !== "glow" || g.p[1] < 0.6 || Math.max(g.s[0], g.s[1], g.s[2]) > 0.6 || Math.min(g.s[0], g.s[2]) < 0.15 || !isWarm(g.c)) continue;
    if (propLamp(g.p[0], g.p[2])) continue;
    const bot = g.p[1] - g.s[1] / 2, topY = g.p[1] + g.s[1] / 2;
    let base = bot - 0.15;
    for (const b of built.blocks) {
      if (b.s[0] > 0.16 || b.s[2] > 0.16 || Math.abs(b.p[0] - g.p[0]) > 0.06 || Math.abs(b.p[2] - g.p[2]) > 0.06) continue;
      const bt = b.p[1] + b.s[1] / 2, bb = b.p[1] - b.s[1] / 2;
      if (Math.abs(bt - bot) < 0.2 && bb < base) base = bb; // ayaktaki direk
    }
    const bulb: Hot["bulb"] = [g.p[0], g.p[1], g.p[2], g.s[0] * 1.08, g.s[1] * 1.08, g.s[2] * 1.08];
    push({ kind: "lamp", x: g.p[0], y: (base + topY) / 2, z: g.p[2], sx: 0.55, sy: topY - base + 0.1, sz: 0.55, top: topY, bulb, lamp: nearMark(g.p[0], g.p[2]) });
  }
  for (const aq of h.aquariums) push({ kind: "aquarium", x: aq.x, y: 0.75, z: aq.z, sx: 0.9, sy: 1.5, sz: 0.75, top: 1.45 });
  // fıskiye: yükseltilmiş küçük su
  for (const b of built.blocks) {
    if (b.g !== "water" || b.p[1] < 0.12 || b.s[0] > 2.6 || b.s[2] > 2.6) continue;
    push({ kind: "water", x: b.p[0], y: b.p[1], z: b.p[2], sx: b.s[0], sy: Math.max(0.3, b.s[1]), sz: b.s[2], top: b.p[1] + b.s[1] / 2 });
  }
  // WATER-ALL: habitat'taki HER su (kancalı ya da kancasız: kaynak taban sahne, büyüme bölgesi, çevre/kullanıcı dünyası) tıklanabilir.
  // Gölet: karo başına bir hedef; deniz/nehir/kanal: aynı seviyedeki karolar birleşik dikdörtgenler (hedef sayısı kısıtlı).
  const all = [...h.ponds, ...h.seas, ...h.extra];
  for (const w of all) if (!w.sea) for (const tl of w.tiles) push({ kind: "water", x: tx(tl[0]), y: waterTopOf(h, w, tl) - 0.1, z: tz(tl[1]), sx: 1, sy: 0.3, sz: 1, top: waterTopOf(h, w, tl) });
  for (const w of all) if (w.sea) for (const r of waterRects(h, w)) push({ kind: "water", x: r.x, y: r.top - 0.1, z: r.z, sx: r.w, sy: 0.3, sz: r.d, top: r.top, big: true });
  // çiçekler: küçük renkli baş blokları, karo başına bir hedef
  const seen = new Set<string>();
  for (const b of built.blocks) {
    if (b.g !== "solid" || b.s[0] > 0.22 || b.s[2] > 0.22 || b.s[1] > 0.16 || b.p[1] < 0.2 || b.p[1] > 0.45 || isGreenHex(b.c)) continue;
    const k = `${Math.floor(b.p[0] + W / 2)},${Math.floor(b.p[2] + D / 2)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    push({ kind: "flower", x: b.p[0], y: 0.2, z: b.p[2], sx: 0.5, sy: 0.4, sz: 0.5, top: 0.4 });
  }
  hotCache.set(built, out);
  return out;
}


