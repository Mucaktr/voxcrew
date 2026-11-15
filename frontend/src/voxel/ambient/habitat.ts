/**
 * S43 — ortam canlılarının yaşam alanı: dünyanın bloklarından ve S41'in `built.ambient` kancalarından
 * yürünebilir zemin, su (gölet / deniz), ağaç tepeleri, tüneme noktaları (çatı, korkuluk, direk), kum, çimen, pencere
 * pervazı ve akvaryum çıkarılır. Kanca yoksa (eski/kullanıcı dünyası) bloklardan türetilir. Dünya başına bir kez (WeakMap).
*/
import type { Built, Station, Tile } from "../scenes";
import { D, key, tx, tz, W } from "../scenes";
import { FREE, staticWorld } from "../physics/world";

/** S41 sözleşmesi: `built.ambient?: AmbientHook[]` (r: karo cinsinden yarıçap, yoksa 1). */
export interface AmbientHook { kind: "tree" | "pond" | "sea" | "sand" | "grass" | "roof" | "window" | "aquarium" | "perch"; tile: Tile; r?: number }

export interface Spot { x: number; y: number; z: number }
export interface Water { tiles: Tile[]; y: number; sea: boolean; cx: number; cz: number; r: number }
/**
 * olta suyu: kancadan bağımsız 4-komşu su kümesi (köprü altı ve kenarı taşla örtülü karolar dahil; aynı seviyede).
 * `open`: karo ortası açık su karosu sayısı. `pond`: küçük, kapalı su (≤ 60 karo, `sea` kancası yok) → göl türleri; büyük
 * su (nehir, boğaz, deniz) ve `sea` kancalı su sahnenin açık su biyomunu alır (minigameLogic `fishWater`).
*/
export interface WaterBody { tiles: Tile[]; open: number; y: number; pond: boolean }

export interface Habitat {
  width: number; depth: number;
  /** 1 = yürünebilir zemin karosu (engelsiz, su değil) */
  walk: Uint8Array;
  /** 1 = su karosu */
  wet: Uint8Array;
  /** istasyon, araç, dinlenme, uyku karoları: hayvan burada uyumaz/beklemez (yalnızca geçer) */
  busy: Set<string>;
  ground: Tile[];
  grass: Tile[];
  sand: Tile[];
  edge: Tile[];
  trees: Spot[];
  perches: Spot[];
  ponds: Water[];
  seas: Water[];
  /** WATER-ALL: taban alanındaki kancasız su (nehir, kanal): yalnız tıklanabilir (şapırtı); ortam canlısı yok (S43 kuralı korunur) */
  extra: Water[];
  windows: (Spot & { face: number })[];
  aquariums: Spot[];
  /** karo başına su yüzeyi (ince film/su birikintisi hariç; üstü örtülü karo dahil), yoksa −9*/
  waterY: Float32Array;
  /** 1 = olta atılabilir açık su (karo ortasında üstü kapalı değil: köprü, nilüfer, ada yok)*/
  open: Uint8Array;
  /** karo → `bodies` dizini (su yoksa −1)*/
  bodyOf: Int32Array;
  /** bütün su gövdeleri (ortam canlıları `ponds`/`seas` kullanır; bunlar yalnız olta içindir)*/
  bodies: WaterBody[];
}

/** bundan ince su bloğu (yağmur birikintisi) olta suyu değildir.*/
const FILM = 0.1;
/** Kancasız türetmeyle aynı eşik: bundan büyük su gövdesi gölet değildir. */
const POND_MAX = 60;
/** WATER-ALL: kancalı suya bitişik bu kadar küçük artık karo o suya katılır (ayrı gölet olmaz). */
const MERGE_MAX = 12;

const SKIP = new Set(["cloud", "flame", "flag", "snow"]);
const cache = new WeakMap<Built, Habitat>();

function isGreen(hex: string): boolean {
  const n = parseInt(hex.slice(1, 7), 16);
  if (!Number.isFinite(n)) return false;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return g > r + 12 && g > b + 8;
}

export function habitat(built: Built): Habitat {
  const hit = cache.get(built);
  if (hit) return hit;
  const w = built.width, d = built.depth, n = w * d;
  const top = new Float32Array(n).fill(-9);
  const green = new Uint8Array(n);
  const glassTop = new Float32Array(n).fill(-9);
  const waterTop = new Float32Array(n).fill(-9);
  // olta suyu — kalın (film değil) su yüzeyi ve karo ORTASINI örten blokların tepesi (kenar taşı/korkuluk örtmez)
  const deepTop = new Float32Array(n).fill(-9);
  const midTop = new Float32Array(n).fill(-9);
  const idx = (i: number, j: number) => j * w + i;
  for (const b of built.blocks) {
    if (SKIP.has(b.g)) continue;
    // karo = floor(x + W/2) (scenes.ts tileOf; büyümüş dünyada da W/D taban sabitleri)
    const x0 = Math.floor(b.p[0] - b.s[0] / 2 + W / 2 + 0.02), x1 = Math.floor(b.p[0] + b.s[0] / 2 + W / 2 - 0.02);
    const z0 = Math.floor(b.p[2] - b.s[2] / 2 + D / 2 + 0.02), z1 = Math.floor(b.p[2] + b.s[2] / 2 + D / 2 - 0.02);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 64) continue; // zemin altı levhaları vb.
    const t = b.p[1] + b.s[1] / 2;
    const wat = b.g === "water" || b.g === "wave";
    for (let i = Math.max(0, x0); i <= Math.min(w - 1, x1); i++) for (let j = Math.max(0, z0); j <= Math.min(d - 1, z1); j++) {
      const k = idx(i, j);
      if (wat) { if (t > waterTop[k]) waterTop[k] = t; if (b.s[1] >= FILM && t > deepTop[k]) deepTop[k] = t; continue; }
      if (b.g === "glass" && t > glassTop[k]) glassTop[k] = t;
      if (t > top[k]) { top[k] = t; green[k] = t > 1.3 && isGreen(b.c) ? 1 : 0; }
      if (t > midTop[k] && Math.abs(tx(i) - b.p[0]) <= b.s[0] / 2 && Math.abs(tz(j) - b.p[2]) <= b.s[2] / 2) midTop[k] = t;
    }
  }
  const walk = new Uint8Array(n), wet = new Uint8Array(n);
  const fine = Array.isArray(built.stations) && Array.isArray(built.blocks) ? staticWorld(built) : null;
  const busy = new Set<string>();
  const addBusy = (list?: Station[]) => list?.forEach((s) => busy.add(key(...s.tile)));
  addBusy(built.stations);
  Object.values(built.spots as Record<string, Station[] | undefined>).forEach(addBusy);
  built.rest.forEach((r) => busy.add(key(...r)));
  const ground: Tile[] = [], grass: Tile[] = [], sand: Tile[] = [], edge: Tile[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
    const k = idx(i, j);
    if (waterTop[k] > -9 && top[k] < waterTop[k] + 0.05) { wet[k] = 1; continue; }
    if (built.blocked.has(key(i, j))) continue;
    // PHYS: yürünebilir karodaki katı eşya (sandalye, bank, yatak, sandık…) hayvana da kapalı
    if (fine && fine.kind[k] !== FREE) continue;
    walk[k] = 1;
    ground.push([i, j]);
    if (i < 3 || j < 3 || i >= w - 3 || j >= d - 3) edge.push([i, j]);
  }

  const hooks = (built as Built & { ambient?: AmbientHook[] }).ambient;
  const trees: Spot[] = [], perches: Spot[] = [], windows: (Spot & { face: number })[] = [], aquariums: Spot[] = [];
  const ponds: Water[] = [], seas: Water[] = [];
  const spot = (i: number, j: number, y: number): Spot => ({ x: tx(i), y, z: tz(j) });
  const topAt = (i: number, j: number) => (i >= 0 && j >= 0 && i < w && j < d ? top[idx(i, j)] : -9);
  const waterAround = (ci: number, cj: number, r: number, sea: boolean) => {
    const tiles: Tile[] = [];
    let y = 0, c = 0;
    for (let i = Math.max(0, ci - r - 1); i <= Math.min(w - 1, ci + r + 1); i++) for (let j = Math.max(0, cj - r - 1); j <= Math.min(d - 1, cj + r + 1); j++)
      if (wet[idx(i, j)]) { tiles.push([i, j]); y += waterTop[idx(i, j)]; c++; }
    if (c) (sea ? seas : ponds).push({ tiles, y: y / c, sea, cx: tx(ci), cz: tz(cj), r: r + 0.5 });
  };
  if (hooks?.length) {
    for (const h of hooks) {
      const [i, j] = h.tile, r = Math.max(1, Math.round(h.r ?? 1));
      switch (h.kind) {
        case "tree": { const t = topAt(i, j); if (t > 0.5) trees.push(spot(i, j, t)); break; }
        case "roof": case "perch": { const t = topAt(i, j); if (t > 0.3) perches.push(spot(i, j, t)); break; }
        case "pond": waterAround(i, j, r, false); break;
        case "sea": waterAround(i, j, r, true); break;
        case "sand": for (let a = i - r; a <= i + r; a++) for (let b = j - r; b <= j + r; b++) if (a >= 0 && b >= 0 && a < w && b < d && walk[idx(a, b)]) sand.push([a, b]); break;
        case "grass": for (let a = i - r; a <= i + r; a++) for (let b = j - r; b <= j + r; b++) if (a >= 0 && b >= 0 && a < w && b < d && walk[idx(a, b)]) grass.push([a, b]); break;
        case "window": {
          // pervaz: camın alt kenarı, dünyanın dışına bakan yüzde (arka duvar → −z)
          const gy = glassTop[idx(i, j)] > -9 ? Math.max(0.9, glassTop[idx(i, j)] - 1.1) : 1.2;
          const out = j <= 1 ? Math.PI : i <= 1 ? -Math.PI / 2 : i >= w - 2 ? Math.PI / 2 : j >= d - 2 ? 0 : Math.PI;
          windows.push({ ...spot(i, j, gy), face: out });
          break;
        }
        case "aquarium": { const t = topAt(i, j); aquariums.push(spot(i, j, t > 0 ? t * 0.55 : 0.6)); break; }
      }
    }
  }
  // kanca yoksa (ya da eksikse) bloklardan türet
  if (!trees.length) {
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
      const k = idx(i, j);
      // tepe karosu: yeşil ve komşularından alçak değil (her taç için ≈ bir nokta)
      if (!green[k] || top[k] < topAt(i - 1, j) || top[k] < topAt(i, j - 1) || top[k] < topAt(i + 1, j) || top[k] < topAt(i, j + 1)) continue;
      trees.push(spot(i, j, top[k]));
    }
  }
  if (!ponds.length && !seas.length) {
    // bağlantılı su kümeleri (4-komşu); büyük küme deniz sayılır
    const seen = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      if (!wet[s] || seen[s]) continue;
      const q = [s]; seen[s] = 1;
      const tiles: Tile[] = [];
      let y = 0;
      while (q.length) {
        const c = q.pop()!;
        const ci = c % w, cj = (c - ci) / w;
        tiles.push([ci, cj]); y += waterTop[c];
        for (const [a, b] of [[ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]]) {
          if (a < 0 || b < 0 || a >= w || b >= d) continue;
          const nk = idx(a, b);
          if (wet[nk] && !seen[nk]) { seen[nk] = 1; q.push(nk); }
        }
      }
      const cx = tiles.reduce((acc, t) => acc + tx(t[0]), 0) / tiles.length, cz = tiles.reduce((acc, t) => acc + tz(t[1]), 0) / tiles.length;
      const sea = tiles.length > 60;
      (sea ? seas : ponds).push({ tiles, y: y / tiles.length, sea, cx, cz, r: Math.sqrt(tiles.length / Math.PI) });
    }
  }
  // WATER-ALL: kancasız su da bir su kaynağıdır. Kanca yalnız bir gölet/denizi etiketler; kancası olmayan su (büyüme bölgesi havuzu,
  // kanal, nehir) da `ponds`/`seas` içine girmeli ki tıklayınca şapırdasın, ördek/balık yaşasın. İki kural:
  //  - taban sahne alanındaki kancasız su (nehir, kanal…) `extra` olur: yalnız tıklanabilir; ortam canlısı (`ponds`/`seas`) DEĞİŞMEZ
  //    (S43 / fishing_water.test.mjs "ortam canlıları değişmedi");
  //  - büyüme bölgesindeki (taban dışı) kancasız su ortam canlılarına açılır: kancalı suya bitişik küçük artıklar (≤ MERGE_MAX karo)
  //    o suya katılır, kalanlar kendi göleti (≤ 60 karo) ya da denizi olur.
  const extra: Water[] = [];
  {
    const baseCell = (i: number, j: number) => {
      const mods = (built as Built & { modules?: { i0: number; j0: number; w: number; d: number; base: boolean }[] }).modules;
      if (!mods?.length) return true;
      return mods.some((mo) => mo.base && i >= mo.i0 && i < mo.i0 + mo.w && j >= mo.j0 && j < mo.j0 + mo.d);
    };
    const owner = new Map<number, Water>();
    for (const wa of [...ponds, ...seas]) for (const t of wa.tiles) owner.set(idx(t[0], t[1]), wa);
    const seen = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      if (!wet[s] || seen[s] || owner.has(s)) continue;
      const si = s % w, sj = (s - si) / w, home = baseCell(si, sj);
      const q = [s]; seen[s] = 1;
      const tiles: Tile[] = [];
      let y = 0, near: Water | null = null;
      while (q.length) {
        const c = q.pop()!;
        const ci = c % w, cj = (c - ci) / w;
        tiles.push([ci, cj]); y += waterTop[c];
        for (const [a, b] of [[ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]]) {
          if (a < 0 || b < 0 || a >= w || b >= d) continue;
          const nk = idx(a, b);
          if (!wet[nk] || baseCell(a, b) !== home) continue; // taban / büyüme bölgesi sınırında küme ayrılır
          const o = owner.get(nk);
          if (o) { near ??= o; continue; }
          if (!seen[nk]) { seen[nk] = 1; q.push(nk); }
        }
      }
      const cx = tiles.reduce((acc, t) => acc + tx(t[0]), 0) / tiles.length, cz = tiles.reduce((acc, t) => acc + tz(t[1]), 0) / tiles.length;
      const sea = tiles.length > POND_MAX;
      const water: Water = { tiles, y: y / tiles.length, sea, cx, cz, r: Math.sqrt(tiles.length / Math.PI) };
      if (home) { extra.push(water); continue; }
      if (near && tiles.length <= MERGE_MAX) { near.tiles.push(...tiles); for (const t of tiles) owner.set(idx(t[0], t[1]), near); continue; }
      (sea ? seas : ponds).push(water);
      for (const t of tiles) owner.set(idx(t[0], t[1]), water);
    }
  }
  if (!perches.length) {
    // çatılar, duvar üstleri, korkuluklar: 1,6 – 6 birim yükseklikte yeşil olmayan tepeler (seyrek örnek)
    for (let i = 1; i < w - 1; i += 2) for (let j = 0; j < d - 1; j += 2) {
      const k = idx(i, j);
      if (!green[k] && top[k] > 1.6 && top[k] < 6) perches.push(spot(i, j, top[k]));
    }
  }
  if (!windows.length) {
    // pencere: arka duvardaki cam (j ≤ 1), dışarıya bakan pervaz
    for (let i = 1; i < w - 1; i += 3) if (glassTop[idx(i, 0)] > 1.4) windows.push({ ...spot(i, 0, Math.max(0.9, glassTop[idx(i, 0)] - 1.1)), face: Math.PI });
  }
  // olta suyu kancadan bağımsız — her su kümesi (nehir, kanal, köprü altı dahil) bir gövde; kanca yalnız etiketler
  const waterY = deepTop, open = new Uint8Array(n), bodyOf = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) if (deepTop[k] > -9 && midTop[k] < deepTop[k] + 0.05) open[k] = 1;
  const seaTile = new Uint8Array(n);
  for (const s of seas) for (const t of s.tiles) seaTile[idx(t[0], t[1])] = 1;
  const bodies: WaterBody[] = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (waterY[s0] <= -9 || bodyOf[s0] >= 0) continue;
    const id = bodies.length, q = [s0], tiles: Tile[] = [];
    bodyOf[s0] = id;
    let nOpen = 0, ySum = 0, sea = false;
    while (q.length) {
      const c = q.pop()!;
      const ci = c % w, cj = (c - ci) / w;
      tiles.push([ci, cj]);
      if (open[c]) { nOpen++; ySum += waterY[c]; }
      if (seaTile[c]) sea = true;
      for (const [a, b] of [[ci + 1, cj], [ci - 1, cj], [ci, cj + 1], [ci, cj - 1]]) {
        if (a < 0 || b < 0 || a >= w || b >= d) continue;
        const nk = idx(a, b);
        // aynı seviye (yüksek havuz/fıskiye alttaki nehre karışmaz)
        if (waterY[nk] > -9 && bodyOf[nk] < 0 && Math.abs(waterY[nk] - waterY[c]) < 0.3) { bodyOf[nk] = id; q.push(nk); }
      }
    }
    const y = nOpen ? ySum / nOpen : tiles.reduce((acc, t) => acc + waterY[idx(t[0], t[1])], 0) / tiles.length;
    bodies.push({ tiles, open: nOpen, y, pond: !sea && tiles.length <= POND_MAX });
  }
  const h: Habitat = { width: w, depth: d, walk, wet, busy, ground, grass: grass.length ? grass : ground, sand, edge, trees, perches, ponds, seas, extra, windows, aquariums, waterY, open, bodyOf, bodies };
  cache.set(built, h);
  return h;
}
