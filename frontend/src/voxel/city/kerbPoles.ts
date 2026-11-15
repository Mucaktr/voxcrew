/**
 * (ürün sahibi 2026-11-01/02: "Hiçbir yapı yürüyüşü zorlaştırmamalı"; sokak lambası ve köprü direkleri yürüme hattında) —
 * serbest duran ince direk takımlarını (lamba, fener, babası, tabela direği: direk + başlık + taban) kaldırım çizgisine alır.
 *
 * Direk (`isPoleBlock`): gövde bandında (alt ≤ zemin + 0,3, üst ≥ zemin + 1) yatay kenarı ≤ `POLE_W` katı blok. Takım: direğe değen
 * (≤ 0,02) küçük blokların bileşeni (bantta yatay kenar ≤ 1, ≤ 24 blok, bant ayak izi ≤ 1,2; üstteki taç/tel takıma katılır). Takım bir yapıya (büyük blok) değiyorsa
 * yapının parçasıdır (tente/pergola/köprü kulesi) — dokunulmaz. Direk yürünür bir karoda ve yürünmez komşu yapı karosunun kenarına
 * `KERB`'den uzaksa takım, aynı karoda ya da 8 komşusunda kaldırım noktasına (yürünmez komşunun kenarından `KERB_AT`) en kısa
 * yoldan kaydırılır; kaldırım yoksa çizilmez (yürüme hattında direk kalmaz). Saf modül; denetim scripts/walkflow_check.mjs
 * (WALK-CLEAR-001).
*/
import type { Block, Built } from "../scenes";

export const POLE_W = 0.35;
export const KERB = 0.35;
/** kaldırım noktası: direk merkezi yürünmez komşunun kenarından bu kadar içeride */
export const KERB_AT = 0.25;

const lo = (b: Block, k: number) => b.p[k] - b.s[k] / 2;
const hi = (b: Block, k: number) => b.p[k] + b.s[k] / 2;

export const isPoleBlock = (b: Block, ground = 0) =>
  b.g === "solid" && Math.max(b.s[0], b.s[2]) <= POLE_W && lo(b, 1) <= ground + 0.3 && hi(b, 1) >= ground + 1;

/** Karo ızgarası: (0, 0) karosunun dünya köşesi (ox, oz), karo 1 × 1. */
export interface KerbGrid {
  ox: number; oz: number;
  /** yürünür karo (ızgara dışı: false) */
  walk: (i: number, j: number) => boolean;
  /** kaldırımı oluşturan yürünmez yapı karosu (bina, duvar, su kıyısı; ızgara dışı: false) */
  edge: (i: number, j: number) => boolean;
  /** karo zemini (dünya y) */
  ground?: (i: number, j: number) => number;
  /** bu karoya direk konmaz (durak çevresi vb.) */
  avoid?: (i: number, j: number) => boolean;
}

/** Direğin karo içi konumu kaldırımda mı (yürünmez 4-komşunun kenarına ≤ KERB). */
export function atKerb(g: KerbGrid, x: number, z: number): boolean {
  const i = Math.floor(x - g.ox), j = Math.floor(z - g.oz), fx = x - g.ox - i, fz = z - g.oz - j;
  return (fx <= KERB && g.edge(i - 1, j)) || (fx >= 1 - KERB && g.edge(i + 1, j)) || (fz <= KERB && g.edge(i, j - 1)) || (fz >= 1 - KERB && g.edge(i, j + 1));
}

const touch = (a: Block, b: Block) => [0, 1, 2].every((k) => Math.abs(a.p[k] - b.p[k]) <= (a.s[k] + b.s[k]) / 2 + 0.02);
/** takım büyütme: kademeli çam tacı gövdenin 0,05 üstünden başlar → 0,08 pay */
const near8 = (a: Block, b: Block) => [0, 1, 2].every((k) => Math.abs(a.p[k] - b.p[k]) <= (a.s[k] + b.s[k]) / 2 + 0.08);

/**
 * Yürünür karodaki kaldırım dışı serbest direk takımlarını kaldırıma taşır ya da çizmez. Dönüş: yeni blok dizisi (sıra korunur),
 * taşınan ve düşen takım sayısı ve boşalan karolar (taban sahne bu karoların engelini kaldırır).
 */
export interface KerbResult { blocks: Block[]; moved: number; dropped: number; freed: [number, number][];
  /** taşınan/düşen direklerin eski konumu ve kayması (null: düştü) — ışık işaretleri aynı kaymayı alır */
  poles: { x: number; z: number; d: [number, number] | null }[] }
/** Taban sahnede (`kerbScene`) yerinde kaydırılan / çizilmeyen bloklar: dünya kaydedicisi (worldRecord.ts) bunların yardımcısını prefab
 *  yerine son konumdaki ham bloklar olarak yazar (bake kerbScene'i yeniden koşmaz). */
export const KERB_MOVED = new WeakSet<Block>(), KERB_DROPPED = new WeakSet<Block>();
export function kerbPoles(blocks: readonly Block[], g: KerbGrid, inPlace = false): KerbResult {
  const gnd = (x: number, z: number) => g.ground?.(Math.floor(x - g.ox), Math.floor(z - g.oz)) ?? 0;
  const shift = new Map<Block, [number, number] | null>();
  const freed: [number, number][] = [], poles: KerbResult["poles"] = [];
  let moved = 0, dropped = 0;
  for (const pole of blocks) {
    if (shift.has(pole) || !isPoleBlock(pole, gnd(pole.p[0], pole.p[2]))) continue;
    const i0 = Math.floor(pole.p[0] - g.ox), j0 = Math.floor(pole.p[2] - g.oz);
    if (!g.walk(i0, j0) || atKerb(g, pole.p[0], pole.p[2]) || (laneBeside(g.walk, i0, j0) ?? LANE_MIN) >= LANE_MIN) continue; // yanında ≥ 2 şerit kalan direk açık genişliğin dışında
    // takım: direğe değen küçük bloklar; büyük bloğa değen takım yapının parçasıdır
    const near = blocks.filter((b) => Math.abs(b.p[0] - pole.p[0]) < 8 && Math.abs(b.p[2] - pole.p[2]) < 8); // tel öbür direğe dek uzanır
    const comp: Block[] = [pole];
    let anchored = false;
    for (let k = 0; k < comp.length && !anchored; k++) for (const o of near) {
      if (comp.includes(o) || !touch(comp[k], o)) continue;
      if (hi(o, 1) <= gnd(o.p[0], o.p[2]) + 0.06 && lo(o, 1) < gnd(o.p[0], o.p[2])) continue; // zemin levhası
      // gövde bandı üstündeki geniş blok (ağaç tacı, ışık teli) takıma katılır; yerdeki geniş blok yapıdır. Tel öbür direğe varır →
      // bant ayak izi > 1,2 → dokunulmaz (iki direkli ışık dizisi, tente)
      if ((Math.max(o.s[0], o.s[2]) > 1 && lo(o, 1) < gnd(o.p[0], o.p[2]) + 1) || comp.length >= 24 || shift.has(o)) { anchored = true; break; }
      comp.push(o);
    }
    const foot = comp.filter((b) => lo(b, 1) < gnd(b.p[0], b.p[2]) + 1);
    const x0 = Math.min(...foot.map((b) => lo(b, 0))), x1 = Math.max(...foot.map((b) => hi(b, 0)));
    const z0 = Math.min(...foot.map((b) => lo(b, 2))), z1 = Math.max(...foot.map((b) => hi(b, 2)));
    if (anchored || x1 - x0 > 1.2 || z1 - z0 > 1.2) continue;
    // taban sahne: takımın kutusuna (± 0,15) değen başka blok varsa (kepenk, tabela, asılı süs) takım bir yapının parçasıdır → yerinde
    if (inPlace) {
      const bb = [0, 1, 2].map((k) => [Math.min(...comp.map((q) => lo(q, k))) - 0.15, Math.max(...comp.map((q) => hi(q, k))) + 0.15]);
      if (near.some((o) => !comp.includes(o) && hi(o, 1) > gnd(o.p[0], o.p[2]) + 0.3 && [0, 1, 2].every((k) => hi(o, k) > bb[k][0] && lo(o, k) < bb[k][1]))) continue;
    }
    // aday kaldırım noktaları: karo ve 8 komşusu, yürünmez 4-komşu kenarı
    let best: [number, number] | null = null, bd = Infinity;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const i = i0 + a, j = j0 + b;
      if (!g.walk(i, j) || g.avoid?.(i, j)) continue;
      const cx = Math.min(Math.max(pole.p[0] - g.ox - i, 0.3), 0.7), cz = Math.min(Math.max(pole.p[2] - g.oz - j, 0.3), 0.7);
      const opts: [number, number][] = [];
      if (g.edge(i - 1, j)) opts.push([KERB_AT, cz]);
      if (g.edge(i + 1, j)) opts.push([1 - KERB_AT, cz]);
      if (g.edge(i, j - 1)) opts.push([cx, KERB_AT]);
      if (g.edge(i, j + 1)) opts.push([cx, 1 - KERB_AT]);
      for (const [fx, fz] of opts) {
        const x = g.ox + i + fx, z = g.oz + j + fz, d = Math.hypot(x - pole.p[0], z - pole.p[2]);
        if (d < bd) { bd = d; best = [x - pole.p[0], z - pole.p[2]]; }
      }
    }
    if (!best && inPlace) continue; // taban sahnede çizmemek ağacı/feneri envanterden siler (live_inventory) → yerinde kalır
    for (const b of comp) shift.set(b, best);
    if (best) moved++; else dropped++;
    freed.push([i0, j0]);
    poles.push({ x: pole.p[0], z: pole.p[2], d: best });
  }
  if (!shift.size) return { blocks: [...blocks], moved, dropped, freed, poles };
  const out: Block[] = [];
  for (const b of blocks) {
    if (!shift.has(b)) { out.push(b); continue; }
    const d = shift.get(b);
    if (!inPlace) { if (d) out.push({ ...b, p: [b.p[0] + d[0], b.p[1], b.p[2] + d[1]] }); continue; }
    if (d) { b.p = [b.p[0] + d[0], b.p[1], b.p[2] + d[1]]; KERB_MOVED.add(b); out.push(b); } else KERB_DROPPED.add(b);
  }
  return { blocks: out, moved, dropped, freed, poles };
}

const band = (q: Block) => (q.g === "solid" || q.g === "glass") && lo(q, 1) <= 0.5 && hi(q, 1) >= 1 && q.s[0] * q.s[2] >= 0.02;
/** sokak açık genişliği: direk/ağaç karosunun yanında kalması gereken en az yürünür şerit (scripts/walkflow_check.mjs ile aynı) */
export const LANE_MIN = 2;
const LANE_SCAN = 4;
/** Karodan akan koridor(lar)da (eksen boyunca iki komşu yürünür) karonun yanında kalan en geniş yürünür şerit (en dar akış ekseni);
 *  koridor bu karodan akmıyorsa null. */
export function laneBeside(walk: (i: number, j: number) => boolean, i: number, j: number): number | null {
  let worst: number | null = null;
  for (const [ax, az] of [[1, 0], [0, 1]] as const) {
    if (!walk(i - ax, j - az) || !walk(i + ax, j + az)) continue;
    let best = 0;
    for (const s of [-1, 1]) { let n = 0; while (n < LANE_SCAN && walk(i + s * az * (n + 1), j + s * ax * (n + 1))) n++; best = Math.max(best, n); }
    worst = worst === null ? best : Math.min(worst, best);
  }
  return worst;
}

/**
 * Taban şehir sahnesi. (1) Yalnız direk/ağaç gövdesi yüzünden engelli karo (sokak lambası, kiraz ağacı, fener) koridorun
 * açık genişliğindeyse (yanında < LANE_MIN şerit) takım, 2 karo içinde koridoru daraltmayan boş bir karoya (önce yapı kenarındaki)
 * tam karo kaydırılır; yer yoksa çizilmez. (2) Yürünür karodaki engelsiz direk (ince çarpıştırıcı) kaldırım çizgisine alınır. Boşalan
 * karonun engeli kalkar, lamba ışığı (`props` "lamp") takımla birlikte kayar. İstasyon/dinlenme/araç karosuna ve komşusuna konmaz.
 * (ox, oz): (0, 0) karosunun dünya köşesi.
*/
export function kerbScene(b: Built, ox: number, oz: number): { moved: number; dropped: number } {
  const W = b.width, D = b.depth, K = (i: number, j: number) => `${i},${j}`;
  const inG = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < D;
  const bandTiles = (blocks: readonly Block[]) => {
    const per = new Map<string, Block[]>();
    for (const q of blocks) {
      if (!band(q)) continue;
      for (let j = Math.floor(lo(q, 2) - oz + 0.01); j <= Math.floor(hi(q, 2) - oz - 0.01); j++) for (let i = Math.floor(lo(q, 0) - ox + 0.01); i <= Math.floor(hi(q, 0) - ox - 0.01); i++) {
        if (inG(i, j)) (per.get(K(i, j)) ?? per.set(K(i, j), []).get(K(i, j))!).push(q);
      }
    }
    return per;
  };
  let per = bandTiles(b.blocks);
  const poleOnly = (i: number, j: number) => { const l = per.get(K(i, j)); return !!l?.length && l.every((q) => isPoleBlock(q)); };
  const blocked = (i: number, j: number) => b.blocked.has(K(i, j));
  const keep = new Set<string>([...b.stations.map((q) => K(q.tile[0], q.tile[1])), ...b.rest.map((q) => K(q[0], q[1])),
    ...Object.values(b.spots).flatMap((l) => (l ?? []).map((q) => K(q.tile[0], q.tile[1])))]);
  // su karosu: taşınan ağaç tacı suya taşarsa su yüzü/olta kıyısı kaybolur (habitat) → su komşusu karoya direk/ağaç konmaz
  const wet = new Set<string>();
  for (const q of b.blocks) if (q.g === "water") for (let j = Math.floor(lo(q, 2) - oz + 0.01); j <= Math.floor(hi(q, 2) - oz - 0.01); j++) for (let i = Math.floor(lo(q, 0) - ox + 0.01); i <= Math.floor(hi(q, 0) - ox - 0.01); i++) wet.add(K(i, j));
  // kıyıdan 2 karo içi (olta yeri, su yüzü) — ağaç/direk buraya taşınmaz
  let wetR = 2; // önce kıyıdan 2 karo uzak; yer yoksa yalnız su komşusu yasak (taç suya taşmaz)
  const nearWet = (i: number, j: number) => { for (let c = -wetR; c <= wetR; c++) for (let a = -wetR; a <= wetR; a++) if (wet.has(K(i + a, j + c))) return true; return false; };
  // simge/otel bölgesi ± 1: taşınan ağaç simgenin boyunu ve kadrajını değiştirmez (Marakeş sur kapısı)
  // (bölgenin en yüksek bloğunun yarısından alçak takım bölge kenarına girebilir: çalı, küçük ağaç simgenin boyunu/kadrajını değiştirmez)
  const zoneTop = new Map<object, number>();
  const topOfZone = (z: { i0: number; j0: number; w: number; d: number }) => {
    if (!zoneTop.has(z)) zoneTop.set(z, Math.max(0, ...b.blocks.filter((q) => q.p[0] >= ox + z.i0 && q.p[0] < ox + z.i0 + z.w && q.p[2] >= oz + z.j0 && q.p[2] < oz + z.j0 + z.d).map((q) => hi(q, 1))));
    return zoneTop.get(z)!;
  };
  let compTop = 0;
  const inZone = (i: number, j: number) => (b.zones ?? []).some((z) => (z.kind === "landmark" || z.kind === "hotel") && i >= z.i0 - 1 && j >= z.j0 - 1 && i <= z.i0 + z.w && j <= z.j0 + z.d && compTop > topOfZone(z) / 2);
  const nearKeep = (i: number, j: number) => nearWet(i, j) || [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => keep.has(K(i + a, j + c)));
  // ağaç ortam kancası (habitat: dokunma/kuş) takımla aynı karoya
  const shiftHooks = (i: number, j: number, to: [number, number] | null) => {
    if (!b.ambient?.length) return;
    b.ambient = b.ambient.flatMap((h) => (h.kind !== "tree" || h.tile[0] !== i || h.tile[1] !== j ? [h] : to ? [{ ...h, tile: to }] : []));
  };
  const walk = (i: number, j: number) => inG(i, j) && !blocked(i, j);
  const tileOf = (q: Block): [number, number] => [Math.floor(q.p[0] - ox), Math.floor(q.p[2] - oz)];
  const ground = (q: Block) => hi(q, 1) <= 0.06;
  const shiftProps = (i: number, j: number, d: [number, number] | null) => {
    if (!b.props?.length) return;
    const out: typeof b.props = [];
    for (const pr of b.props) {
      const [pi, pj] = [Math.floor(pr.p[0] - ox), Math.floor(pr.p[2] - oz)];
      if (pr.k !== "lamp" || pi !== i || pj !== j) { out.push(pr); continue; }
      if (d) out.push({ ...pr, p: [pr.p[0] + d[0], pr.p[1], pr.p[2] + d[1]] as typeof pr.p });
    }
    b.props = out;
  };
  // (1) koridoru daraltan direk/ağaç karosu — birden çok tur: taşınan takımın yanı daralırsa sonraki turda o da yer değiştirir
  let moved = 0, dropped = 0;
  // erişim: bir karo engellenince ana yürünür bileşen (en büyük) yalnız o karo kadar küçülmeli (cep/ada açılmaz: WALK-PASS-001)
  const reachSeen = (seed: number): Uint8Array => {
    const seen = new Uint8Array(W * D);
    if (seed < 0) return seen;
    const q = [seed]; seen[seed] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h] % W, j = (q[h] - i) / W;
      for (const [p, r] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + p, c = j + r; if (walk(a, c) && !seen[c * W + a]) { seen[c * W + a] = 1; q.push(c * W + a); } }
    }
    return seen;
  };
  const mainSeed = (): number => {
    const lab = new Int32Array(W * D).fill(-1); let best = -1, bn = 0;
    for (let k = 0; k < W * D; k++) {
      if (lab[k] >= 0 || !walk(k % W, (k - (k % W)) / W)) continue;
      const q = [k]; lab[k] = k;
      for (let h = 0; h < q.length; h++) { const i = q[h] % W, j = (q[h] - i) / W; for (const [p, r] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + p, c = j + r; if (walk(a, c) && lab[c * W + a] < 0) { lab[c * W + a] = k; q.push(c * W + a); } } }
      if (q.length > bn) { bn = q.length; best = k; }
    }
    return best;
  };
  for (let pass = 0; pass < 4; pass++) {
    const centered = new Map<string, Block[]>();
    for (const q of b.blocks) { if (ground(q)) continue; const k = K(...tileOf(q)); (centered.get(k) ?? centered.set(k, []).get(k)!).push(q); }
    const moveBy = new Map<Block, [number, number] | null>();
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
      if (!blocked(i, j) || !poleOnly(i, j) || keep.has(K(i, j))) continue;
      const lane = laneBeside(walk, i, j);
      if (lane === null || lane >= LANE_MIN) continue;
      // takım: karodaki direk/gövde + ona (zincirle) değen yükseltilmiş parçalar (taç, çiçek salkımı, palmiye yaprağı, fener başı);
      // karodaki alçak eşya (bisiklet, bank) ve komşu karodan gelen yer eşyası yerinde kalır (havada parça kalmaz, eşya taşınmaz);
      // başka dikme/gövde parçası yalnız ilk gövdenin ekseninde (≤ 0,3: palmiye gövde kademeleri), ince levha (kepenk, tabela) alınmaz
      const comp = (centered.get(K(i, j)) ?? []).filter((q) => isPoleBlock(q));
      // parça direğin/gövdenin 1,3 yakınında ve küçük (≤ 2,2): komşu binanın saçağı/çatısı takıma girmez
      const pool = b.blocks.filter((o) => !ground(o) && (lo(o, 1) >= 0.5 || Math.hypot(o.p[0] - comp[0]?.p[0], o.p[2] - comp[0]?.p[2]) <= 0.12) && Math.max(o.s[0], o.s[2]) <= 2.2 && Math.abs(o.p[0] - (ox + i + 0.5)) < 1.3 && Math.abs(o.p[2] - (oz + j + 0.5)) < 1.3);
      for (let k = 0; k < comp.length && comp.length < 40; k++) for (const o of pool) if (!comp.includes(o) && (isPoleBlock(o) || (Math.max(o.s[0], o.s[2]) <= 0.35 && o.s[1] >= 1.2) ? Math.hypot(o.p[0] - comp[0].p[0], o.p[2] - comp[0].p[2]) <= 0.3 : (lo(o, 1) >= 0.5 && Math.min(o.s[0], o.s[2]) >= 0.1) || Math.hypot(o.p[0] - comp[0].p[0], o.p[2] - comp[0].p[2]) <= 0.12) && near8(comp[k], o)) comp.push(o); // gövde halkası (huş) eksende
      if (!comp.length || comp.some((q) => Math.max(q.s[0], q.s[2]) > 2.2 || moveBy.has(q))) continue;
      compTop = Math.max(...comp.map((q) => hi(q, 1)));
      // yapının parçası (köprü kulesi güverteyi, tente direği saçağı taşır): takıma değen, yükseltilmiş (alt ≥ 1) geniş (≥ 2) yabancı blok → dokunma
      const near = b.blocks.filter((o) => Math.abs(o.p[0] - (ox + i + 0.5)) < 8 && Math.abs(o.p[2] - (oz + j + 0.5)) < 8 && !comp.includes(o));
      if (comp.some((q) => isPoleBlock(q) && near.some((o) => lo(o, 1) >= 1 && Math.max(o.s[0], o.s[2]) >= 2 && touch(q, o)))) continue; // ağaç tacının komşu saçağa değmesi sayılmaz
      // yalnız yürüme hattındaki (ana bileşene bağlı) direk/ağaç: erişilmeyen arka şeritte yer değiştirmek cepleri adaya çevirir
      // (scripts/walkflow_check.mjs ile aynı ölçü: ana bileşene komşu karo; döngülü koridorda da direk hattı keser)
      const seed0 = mainSeed();
      const main = new Uint8Array(W * D);
      if (seed0 >= 0) { const q = [seed0]; main[seed0] = 1; for (let h = 0; h < q.length; h++) { const x = q[h] % W, y = (q[h] - x) / W; for (const [p, r] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = x + p, c = y + r; if (walk(a, c) && !main[c * W + a]) { main[c * W + a] = 1; q.push(c * W + a); } } } }
      if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([p, r]) => inG(i + p, j + r) && main[(j + r) * W + i + p])) continue;
      b.blocked.delete(K(i, j));
      const seed = seed0;
      let best: [number, number] | null = null, bs = Infinity;
      for (wetR = 2; wetR >= 1 && !best; wetR--) {
      // adaylar puan sırasıyla (yakın, önce yapı kenarı); ilk geçerli aday seçilir (erişim taraması pahalı)
      const cands: [number, number, number][] = [];
      for (let c = -3; c <= 3; c++) for (let a = -3; a <= 3; a++) {
        const ti = i + a, tj = j + c;
        if ((!a && !c) || !walk(ti, tj) || nearKeep(ti, tj) || inZone(ti, tj) || centered.get(K(ti, tj))?.length) continue;
        const kerb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([p, q]) => inG(ti + p, tj + q) && blocked(ti + p, tj + q));
        cands.push([Math.max(Math.abs(a), Math.abs(c)) + (kerb ? 0 : 0.5), a, c]);
      }
      cands.sort((x, y) => x[0] - y[0] || x[2] - y[2] || x[1] - y[1]);
      for (const [score, a, c] of cands) {
        if (best) break;
        const ti = i + a, tj = j + c;
        b.blocked.add(K(ti, tj));
        // hedefte ve 8 komşusundaki direk karolarında koridor ≥ LANE_MIN şerit tutar
        let ok = (laneBeside(walk, ti, tj) ?? LANE_MIN) >= LANE_MIN;
        for (let q = -1; q <= 1 && ok; q++) for (let p = -1; p <= 1 && ok; p++) {
          const ni = ti + p, nj = tj + q;
          if ((p || q) && inG(ni, nj) && blocked(ni, nj) && poleOnly(ni, nj) && (laneBeside(walk, ni, nj) ?? LANE_MIN) < LANE_MIN) ok = false;
        }
        // önceden ulaşılan her karo (hedef hariç) yine ulaşılır: cep/ada açılmaz (WALK-PASS-001)
        if (ok) { const sd = seed === tj * W + ti ? mainSeed() : seed, now = reachSeen(sd); for (let k = 0; k < W * D && ok; k++) if (main[k] && !now[k] && k !== tj * W + ti) ok = false; }
        b.blocked.delete(K(ti, tj));
        if (!ok) continue;
        bs = score; best = [a, c];
      }
      }
      wetR = 2;
      // yürünür yer yoksa: zaten engelli, üstü boş (çim/çiçek tarhı, alçak set; su ve yapı değil) bir karo — yürüyüşü hiç daraltmaz
      if (!best) {
        const bare = (ti: number, tj: number) => { const cx = ox + ti + 0.5, cz = oz + tj + 0.5; return !b.blocks.some((o) => hi(o, 1) > 0.6 && Math.abs(o.p[0] - cx) < o.s[0] / 2 + 0.45 && Math.abs(o.p[2] - cz) < o.s[2] / 2 + 0.45); };
        for (let c = -5; c <= 5; c++) for (let a = -5; a <= 5; a++) {
          const ti = i + a, tj = j + c, d = Math.max(Math.abs(a), Math.abs(c));
          if ((!a && !c) || !inG(ti, tj) || !blocked(ti, tj) || wet.has(K(ti, tj)) || keep.has(K(ti, tj)) || d >= bs || !bare(ti, tj)) continue;
          bs = d; best = [a, c];
        }
      }
      // yer yoksa takım yerinde kalır (taban sahnede çizmemek ağacı/feneri envanterden siler: live_inventory)
      if (!best) { b.blocked.add(K(i, j)); continue; }
      b.blocked.add(K(i + best[0], j + best[1])); centered.set(K(i + best[0], j + best[1]), comp); moved++;
      centered.delete(K(i, j));
      for (const q of comp) moveBy.set(q, best);
      shiftProps(i, j, best);
      shiftHooks(i, j, best ? [i + best[0], j + best[1]] : null);
    }
    if (!moveBy.size) break;
    const out: Block[] = [];
    for (const q of b.blocks) {
      if (!moveBy.has(q)) { out.push(q); continue; }
      const d = moveBy.get(q);
      if (d) { q.p = [q.p[0] + d[0], q.p[1], q.p[2] + d[1]]; KERB_MOVED.add(q); out.push(q); } else KERB_DROPPED.add(q); // yerinde (kaydedici izler)
    }
    b.blocks = out;
    per = bandTiles(b.blocks);
  }
  // (2) yürünür karoda engelsiz direk → kaldırım
  const r = kerbPoles(b.blocks, {
    ox, oz,
    walk: (i, j) => inG(i, j) && !blocked(i, j),
    edge: (i, j) => inG(i, j) && blocked(i, j) && !poleOnly(i, j) && !wet.has(K(i, j)),
    avoid: (i, j) => nearKeep(i, j),
  }, true);
  if (r.moved || r.dropped) {
    b.blocks = r.blocks;
    for (const q of r.poles) { const fi = Math.floor(q.x - ox), fj = Math.floor(q.z - oz); shiftHooks(fi, fj, q.d ? [Math.floor(q.x + q.d[0] - ox), Math.floor(q.z + q.d[1] - oz)] : null); }
    if (b.props?.length) {
      const out: typeof b.props = [];
      for (const pr of b.props) {
        const hit = pr.k === "lamp" ? r.poles.find((q) => Math.abs(q.x - pr.p[0]) < 0.02 && Math.abs(q.z - pr.p[2]) < 0.02) : undefined;
        if (!hit) { out.push(pr); continue; }
        if (hit.d) out.push({ ...pr, p: [pr.p[0] + hit.d[0], pr.p[1], pr.p[2] + hit.d[1]] as typeof pr.p });
      }
      b.props = out;
    }
  }
  return { moved: moved + r.moved, dropped: dropped + r.dropped };
}

/** (STREET-BLOCKED-001): sokak kanalı tıkayıcıları (scripts/walkflow_check.mjs `blockedStreets` ile aynı ölçü): kanal ≤ 3 geniş,
 * iki yanında ≥ 3 karo, aradaki ≤ 3 karo kalın engelde en az bir `plug` karosu ve kanalın hiçbir şeridinde aynı hizada geçit yok.*/
export function streetPlugs(W: number, D: number, walk: (i: number, j: number) => boolean, plug: (i: number, j: number) => boolean): [number, number][][] {
  const CH = 3, PL = 3, RUN = 3;
  const width = (i: number, j: number, axis: "x" | "z") => {
    let n = 1;
    for (const s of [-1, 1]) for (let k = 1; k <= CH + 1; k++) { const a = axis === "x" ? i : i + s * k, b = axis === "x" ? j + s * k : j; if (a < 0 || b < 0 || a >= W || b >= D || !walk(a, b)) break; n++; }
    return n;
  };
  const found = new Map<string, [number, number][]>();
  for (const axis of ["x", "z"] as const) {
    const outer = axis === "x" ? D : W, inner = axis === "x" ? W : D;
    const at = (a: number, b: number): [number, number] => (axis === "x" ? [b, a] : [a, b]);
    for (let a = 0; a < outer; a++) {
      const runs: [number, number][] = [];
      let st = -1;
      for (let b = 0; b <= inner; b++) {
        const ok = b < inner && walk(...at(a, b));
        if (ok && st < 0) st = b;
        if (!ok && st >= 0) { runs.push([st, b - 1]); st = -1; }
      }
      for (let r = 0; r + 1 < runs.length; r++) {
        const e1 = runs[r][1], s2 = runs[r + 1][0], gap = s2 - e1 - 1;
        if (gap < 1 || gap > PL || e1 - runs[r][0] + 1 < RUN || runs[r + 1][1] - s2 + 1 < RUN) continue;
        const ch = (b: number) => width(...at(a, b), axis) <= CH;
        if (!ch(e1) || !ch(e1 - 1) || !ch(s2) || !ch(s2 + 1)) continue;
        const tiles: [number, number][] = [];
        let foreign = false;
        for (let b = e1 + 1; b < s2; b++) { const t = at(a, b); tiles.push(t); if (plug(...t)) foreign = true; }
        if (!foreign) continue;
        let bypass = false;
        for (const s of [-1, 1]) for (let k = 1; k <= CH && !bypass; k++) {
          const lane = a + s * k;
          if (lane < 0 || lane >= outer || !walk(...at(lane, e1))) break;
          let open = true;
          for (let b = e1 + 1; b < s2; b++) if (!walk(...at(lane, b))) { open = false; break; }
          if (open) bypass = true;
        }
        if (!bypass) found.set(tiles.map((t) => t.join(",")).join(" "), tiles);
      }
    }
  }
  return [...found.values()];
}
