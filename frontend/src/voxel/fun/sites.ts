/**
 * S48 — eğlence yerleri (dünya başına bir kez, WeakMap): olta noktaları (suya bakan yürünebilir karo: gölet kıyısı, iskele,
 * kumsal; deniz sahnesinde ızgara kenarından ufuk denizi) ve masa tenisi/langırt masaları (iki karşı yanında boş karo olan alçak
 * masa; W2-INT: `play` kancası `r = PLAY_BOARD` ise sessiz masa oyunu; W2b-INT: `PLAY_TOSS` pétanque, `PLAY_HOOP` sokak potası). S41/S46 kancaları (`built.ambient`: "play", "fish") varsa önce onlar kullanılır; yoksa bloklardan türetilir.
 * Yükseltilmiş su (havuz, fıskiye) olta yeri sayılmaz.
 * su kancadan bağımsızdır (habitat `waterY`/`open`/`bodies`: nehir, kanal, köprü altı); şamandıra hedef karonun gerçek
 * su yüzeyinde; her su gövdesi tavandan önce en az bir nokta alır; kutsal/sessiz bölgede türetilmiş nokta yok.
*/
import { habitat, type Habitat } from "../ambient/habitat";
import { isInSacredBuffer, zoneDistance } from "../city/sacred";
import { D, FEED_ONLY, key, PLAY_BOARD, PLAY_HOOP, PLAY_NET, PLAY_TOSS, tx, tz, W, type Built, type Tile } from "../scenes";

export interface FishSpot { tile: Tile; face: number; /** şamandıra noktası (dünya) */ bx: number; by: number; bz: number; /** W2-INT: gölete bakar (ördek besleme) */ pond?: boolean; /** W2-INT: yalnız besleme (olta yok; kanca r ≥ FEED_ONLY) */ feedOnly?: boolean }
export interface PlayTable { a: Tile; b: Tile; faceA: number; faceB: number; x: number; y: number; z: number; /** W2-INT: masa oyunu (tavla/dama) */ board?: boolean; /** W2b-INT: atma oyunu (`toss` pétanque, `hoop` sokak potası); W3a-INT: `volley` plaj voleybolu */ game?: "toss" | "hoop" | "volley";
  /** CORE-WALK (REAL-SEAT): uçlardaki gerçek oturağın (tabure/bank/sandalye) üstü; yoksa tanımsız (oturarak oynanmaz) */ ya?: number; yb?: number }
export interface Sites { h: Habitat; fishing: FishSpot[]; tables: PlayTable[] }

const DIRS: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
/** ikili oyunlarda önce x ekseni: varsayılan kamerada oyuncular yan yana görünür (biri ötekini örtmez) */
const PAIR_DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const cache = new WeakMap<Built, Sites>();
const MAX_SPOTS = 400;
/** CORE-WALK: alçak masada yer oturuşu (oturak üstü = zemin + 0,05; Crowd GROUND_Y). */
export const LOW_TABLE_SEAT = 0.05;
/** ızgara dışındaki ufuk denizi bundan aşağıdaysa olta atılmaz (Gökyüzü Adası bulut düzlemi y −7; yat denizi −1,3).*/
export const OCEAN_MIN_Y = -2;

export function sites(built: Built, oceanY: number | null): Sites {
  const hit = cache.get(built);
  if (hit) return hit;
  const h = habitat(built);
  const w = built.width, d = built.depth;
  const idx = (i: number, j: number) => j * w + i;
  const inGrid = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < d;
  const free = (i: number, j: number) => inGrid(i, j) && h.walk[idx(i, j)] === 1 && !h.busy.has(key(i, j));

  // su yüzeyi karo başına (habitat `waterY`/`open`/`bodies`; kancadan bağımsız: nehir ve kanal dahil). Ufuk
  // "denizi" yürüme yüzeyinden çok aşağıdaysa (Gökyüzü Adası'nın bulut düzlemi y −7) olta yeri değildir.
  const ocean = oceanY !== null && oceanY >= OCEAN_MIN_Y ? oceanY : null;
  const water = (i: number, j: number) => (inGrid(i, j) ? h.waterY[idx(i, j)] : -9);
  const pondAt = (i: number, j: number) => { const b = inGrid(i, j) ? h.bodyOf[idx(i, j)] : -1; return b >= 0 && h.bodies[b].pond; };

  const fishing: FishSpot[] = [];
  const hooks = (built as Built & { ambient?: { kind: string; tile: Tile; r?: number }[] }).ambient ?? [];
  const faceOf = (dx: number, dz: number) => Math.atan2(dx, dz);
  for (const hk of hooks) {
    if (hk.kind !== "fish" || !free(hk.tile[0], hk.tile[1])) continue;
    const rr = Math.max(0, Math.min(7, Math.round(hk.r ?? 0)));
    const [dx, dz] = DIRS[rr % 4];
    const ti = hk.tile[0] + dx, tj = hk.tile[1] + dz;
    const feed = rr >= FEED_ONLY;
    // şamandıra önündeki karonun gerçek su yüzeyinde (kenar taşıyla örtülü buz deliği dahil); su yoksa olta noktası değil
    const wy = water(ti, tj) > -9 ? water(ti, tj) : !inGrid(ti, tj) && ocean !== null ? ocean : feed ? oceanY ?? 0 : null;
    if (wy === null) continue;
    const fs: FishSpot = { tile: hk.tile, face: faceOf(dx, dz), bx: tx(hk.tile[0]) + dx * 1.3, by: wy, bz: tz(hk.tile[1]) + dz * 1.3 };
    if (pondAt(ti, tj)) fs.pond = true;
    if (feed) { fs.feedOnly = true; fs.pond = true; }
    fishing.push(fs);
  }
  {
    // kancalar (S46: büyümüş dünyada iskele/kıyı) + türetilenler (taban sahne, kancasız kıyılar)
    const hooked = new Set(fishing.map((f) => key(...f.tile)));
    // kutsal/sessiz bölgede (oyun açılmaz: walkFun.resolveMinigame) türetilmiş nokta yok
    const quietZones = built.zones?.filter((z) => z.kind === "quiet") ?? [];
    const quiet = (t: Tile) => isInSacredBuffer(t, built) || quietZones.some((z) => zoneDistance(t, z) <= (z.buffer ?? 0));
    // önce her su gövdesine (ve ufuk denizine) bir nokta, sonra tarama sırasıyla tavana dek — büyük dünyada uzak
    // göletler tavanın arkasında kalmaz
    const cands: { fs: FishSpot; body: number }[] = [];
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
      if (!free(i, j) || hooked.has(key(i, j))) continue;
      for (const [dx, dz] of DIRS) {
        // önündeki karo su (kıyı/iskele) ya da alçak bir engel (korkuluk, kaya şeridi) ve ardından su
        let reach = 0;
        let wy: number | undefined;
        let pond = false;
        let body = -2;
        for (const r of [1, 2]) {
          const ni = i + dx * r, nj = j + dz * r;
          if (!inGrid(ni, nj)) { if (ocean !== null) { wy = ocean; reach = r; } break; }
          if (h.open[idx(ni, nj)] === 1) {
            // ileride de su olsun (tek karoluk oluk/havuz kenarı değil; köprü altı/nilüfer örtüsü de su sayılır)
            const fi = ni + dx, fj = nj + dz;
            if (inGrid(fi, fj) && water(fi, fj) <= -9) break;
            wy = water(ni, nj); reach = r; pond = pondAt(ni, nj); body = h.bodyOf[idx(ni, nj)];
            break;
          }
          if (r === 1 && h.walk[idx(ni, nj)] === 1) break; // önü yürünebilir kara: kıyı değil
        }
        if (!reach || wy === undefined || wy > 0.45) continue;
        if (quiet([i, j])) break;
        const k = reach + 0.35;
        const fs: FishSpot = { tile: [i, j], face: faceOf(dx, dz), bx: tx(i) + dx * k, by: wy, bz: tz(j) + dz * k };
        if (pond) fs.pond = true;
        cands.push({ fs, body });
        break;
      }
    }
    const served = new Set<number>(), taken = new Set<FishSpot>();
    for (const c of cands) if (!served.has(c.body) && fishing.length < MAX_SPOTS) { served.add(c.body); taken.add(c.fs); fishing.push(c.fs); }
    for (const c of cands) if (!taken.has(c.fs) && fishing.length < MAX_SPOTS) fishing.push(c.fs);
  }

  // masa: engelli, en üstte ince bir tabla (0,55–1,0 yükseklikte, altı boş: yalnızca ince ayaklar), iki karşı yanı boş karo,
  // kısa (en çok bir komşusu da masa). Çit/çalı (tabandan dolu blok) ve dolap/tezgâh (dolu gövde) masa sayılmaz.
  const top = new Float32Array(w * d).fill(-9);
  const thin = new Uint8Array(w * d);
  const bulk = new Uint8Array(w * d);
  for (const b of built.blocks) {
    if (b.g !== "solid" && b.g !== "glass") continue;
    const x0 = Math.floor(b.p[0] - b.s[0] / 2 + W / 2 + 0.02), x1 = Math.floor(b.p[0] + b.s[0] / 2 + W / 2 - 0.02);
    const z0 = Math.floor(b.p[2] - b.s[2] / 2 + D / 2 + 0.02), z1 = Math.floor(b.p[2] + b.s[2] / 2 + D / 2 - 0.02);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4) continue;
    const t = b.p[1] + b.s[1] / 2, bottom = b.p[1] - b.s[1] / 2;
    const isBulk = bottom < 0.35 && b.s[0] >= 0.45 && b.s[2] >= 0.45 && b.s[1] > 0.25;
    // tabla: geniş, ince, altı boş (şemsiye, fincan gibi üstteki küçük nesneler yok sayılır)
    const slab = b.s[0] >= 0.6 && b.s[2] >= 0.6 && b.s[1] <= 0.2 && bottom >= 0.4 && t >= 0.55 && t <= 1.0;
    for (let i = Math.max(0, x0); i <= Math.min(w - 1, x1); i++) for (let j = Math.max(0, z0); j <= Math.min(d - 1, z1); j++) {
      const k = idx(i, j);
      if (isBulk) bulk[k] = 1;
      if (slab && t > top[k]) { top[k] = t; thin[k] = 1; }
    }
  }
  // CORE-WALK (REAL-SEAT): karodaki oturak (tabure/bank/sandalye levhası ya da küp tabure; üstü 0,25–0,6)
  const seatTop = new Float32Array(w * d).fill(-9);
  for (const b of built.blocks) {
    if (b.g !== "solid") continue;
    const t = b.p[1] + b.s[1] / 2;
    // ince oturak levhası (≤ 1,2) ya da küp tabure (≤ 0,8; yere basan dolu blok)
    const slabSeat = b.s[1] <= 0.12 && b.s[0] <= 1.2 && b.s[2] <= 1.2;
    const cubeSeat = b.s[0] <= 0.8 && b.s[2] <= 0.8 && b.p[1] - b.s[1] / 2 <= 0.05;
    if ((!slabSeat && !cubeSeat) || b.s[0] < 0.25 || b.s[2] < 0.25 || t < 0.25 || t > 0.6) continue;
    const i = Math.floor(b.p[0] + W / 2), j = Math.floor(b.p[2] + D / 2);
    if (inGrid(i, j) && t > seatTop[idx(i, j)]) seatTop[idx(i, j)] = t;
  }
  // masanın kendi yüzeyi (karodaki en yüksek ≥ 0,4 × 0,4 katı blok üstü): alçak masa ayrımı
  const tileTop = new Float32Array(w * d).fill(-9);
  for (const b of built.blocks) {
    if (b.g !== "solid" || b.s[0] < 0.4 || b.s[2] < 0.4 || b.s[0] > 1.2 || b.s[2] > 1.2) continue;
    const i = Math.floor(b.p[0] + W / 2), j = Math.floor(b.p[2] + D / 2);
    if (inGrid(i, j)) tileTop[idx(i, j)] = Math.max(tileTop[idx(i, j)], b.p[1] + b.s[1] / 2);
  }
  const seatAt = (t: Tile): number | undefined => (inGrid(t[0], t[1]) && seatTop[idx(t[0], t[1])] > 0 ? Math.round(seatTop[idx(t[0], t[1])] * 1000) / 1000 : undefined);
  const tableAt = (i: number, j: number) => inGrid(i, j) && built.blocked.has(key(i, j)) && thin[idx(i, j)] === 1 && !bulk[idx(i, j)];
  const stationNear = new Set<string>();
  for (const s of built.stations) for (const [dx, dz] of DIRS) stationNear.add(key(s.tile[0] + dx, s.tile[1] + dz));
  // kahve dolabı masa değildir
  for (const m of built.props ?? []) if (m.k === "coffee") stationNear.add(key(Math.floor(m.p[0] + W / 2), Math.floor(m.p[2] + D / 2)));
  const tables: PlayTable[] = [];
  const used = new Set<string>();
  const addTable = (i: number, j: number, ax: number, az: number, board = false, game?: "toss" | "hoop" | "volley") => {
    const a: Tile = [i - ax, j - az], b: Tile = [i + ax, j + az];
    if (used.has(key(...a)) || used.has(key(...b))) return;
    used.add(key(...a)); used.add(key(...b));
    const t: PlayTable = { a, b, faceA: faceOf(ax, az), faceB: faceOf(-ax, -az), x: tx(i), y: Math.max(0.6, top[idx(i, j)]), z: tz(j) };
    const ya = seatAt(a), yb = seatAt(b);
    if (ya !== undefined && yb !== undefined) { t.ya = ya; t.yb = yb; }
    // alçak masa (üstü ≤ 0,4; ör. <city> sedir masası) ve taburesiz: oyuncular yere/mindere oturur (kalça zemin + 0,05)
    else if (board && tileTop[idx(i, j)] > 0 && tileTop[idx(i, j)] <= 0.4) { t.ya = LOW_TABLE_SEAT; t.yb = LOW_TABLE_SEAT; }
    if (board) t.board = true;
    if (game) t.game = game;
    tables.push(t);
  };
  for (const hk of hooks) {
    if (hk.kind !== "play") continue;
    const [i, j] = hk.tile;
    const game = hk.r === PLAY_TOSS ? "toss" : hk.r === PLAY_HOOP ? "hoop" : hk.r === PLAY_NET ? "volley" : undefined;
    // CORE-WALK (REAL-SEAT): masa oyununda oyuncular taburelerin olduğu eksende oturur (tabure karosu engellemez ama ortam
    // haritasında dolu sayılabilir → yalnız ızgara engeline bakılır); taburesiz masada eski eksen sırası
    if (hk.r === PLAY_BOARD) {
      const open = (q: number, r: number) => inGrid(q, r) && !built.blocked.has(key(q, r));
      const ax2 = ([[1, 0], [0, 1]] as [number, number][]).find(([ax, az]) => seatAt([i - ax, j - az]) !== undefined && seatAt([i + ax, j + az]) !== undefined
        && open(i - ax, j - az) && open(i + ax, j + az));
      if (ax2) { addTable(i, j, ax2[0], ax2[1], true); continue; }
    }
    for (const [ax, az] of DIRS.slice(2).concat(DIRS.slice(0, 1))) if (free(i - ax, j - az) && free(i + ax, j + az)) { addTable(i, j, ax, az, hk.r === PLAY_BOARD, game); break; }
  }
  {
    for (let i = 1; i < w - 1 && tables.length < 60; i++) for (let j = 1; j < d - 1 && tables.length < 60; j++) {
      if (!tableAt(i, j) || stationNear.has(key(i, j))) continue;
      for (const [ax, az] of [[1, 0], [0, 1]] as [number, number][]) {
        // uzun tezgâh/masa sırası değil: dik yöndeki iki komşudan en çok biri masa
        if (tableAt(i + az, j + ax) && tableAt(i - az, j - ax)) continue;
        if (free(i - ax, j - az) && free(i + ax, j + az)) { addTable(i, j, ax, az); break; }
      }
    }
  }
  const out: Sites = { h, fishing, tables };
  cache.set(built, out);
  return out;
}

/** İki oyuncu için karşılıklı iki boş karo: ortaya yakın, aralarında `gap` karo (aradakiler de yürünebilir). */
export function pairSpots(s: Sites, built: Built, claims: Set<string>, mi: number, mj: number, gap: number): [Tile, Tile, number, number] | null {
  const { h } = s;
  const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < h.width && j < h.depth && h.walk[j * h.width + i] === 1 && !h.busy.has(key(i, j))
    && !claims.has(key(i, j)) && !built.blocked.has(key(i, j));
  for (let r = 0; r <= 5; r++) {
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = mi + di, j = mj + dj;
      if (!ok(i, j)) continue;
      for (const [dx, dz] of PAIR_DIRS) {
        const bi = i + dx * gap, bj = j + dz * gap;
        if (!ok(bi, bj)) continue;
        let line = true;
        for (let k = 1; k < gap; k++) { const ci = i + dx * k, cj = j + dz * k; if (h.walk[cj * h.width + ci] !== 1) { line = false; break; } }
        if (line) return [[i, j], [bi, bj], Math.atan2(dx, dz), Math.atan2(-dx, -dz)];
      }
    }
  }
  return null;
}
