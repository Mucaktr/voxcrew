/**
 * WALK-EXPLORE — dış dünyada kapı, ilgi noktası (POI) ve gizli köşe yerleşimi (belirlenimci; taban sahne koordinatında).
 *
 * Hepsi hatıralarla aynı **taban dünyada** (`buildWorld(sahne, 0, {teams: [], guests: 1})`) hesaplanır; büyümüş dünyada
 * `baseOffset` kadar kaydırılır (hatıra deseni). Sahne dosyaları değişmez: kapı yalnız "girilecek karo" ve onun çizim
 * işaretidir (`doorMarkerBlocks`, mevcut `solid` grubuna katılır → +0 çizim çağrısı).
 *
 *  - Simge kapısı: simge (`landmark`) ayak izine en yakın, doğmadan ulaşılabilir yürünebilir karo (önce ön yüz +z, sonra yanlar).
 *  - Teras kapısı: yüksek bir duvara (üstü ≥ 2,5) bitişik, simge/kutsal bölgelerden uzak, çapa noktasına en yakın karo.
 *  - İskele kapısı: taban ızgarasının ön (ya da arka) kenarında, çapa sütununa en yakın yürünebilir karo; iskele dışarı uzanır.
 *  - POI: verilen simgenin 2–5 karo yakınında (kutsal eğlence payı dışında); gizli köşe: kuytu (≥ 2 engelli komşu), doğmadan uzak.
 * Saf modül (React/three yok); `walk_check.mjs` WALK-INTERIOR kuralı aynı işlevleri çağırır.
 */
import { isInSacredBuffer, zoneDistance } from "../city/sacred";
import { components, fineWorld, navGrid, reservedTiles, sceneSeed, souvenirSpots, spawnTile, walkable } from "../walk/controller";
import { PROP } from "../physics/world";
import { buildWorld, D, rng, SCENES, tx, tz, W, type Block, type Built, type SceneZone, type Tile } from "../scenes";
import { HOTEL_SITE, HOTEL_SITE_SPEC, isOpenSite, sceneExplore, type SiteKind, type SiteSpec } from "./catalog";
import { NEW_CITIES } from "../cities/index";
import { FULL_ANCHORS, FULL_POI_NEAR } from "../../full/placement";
import { doorSite, officeDoor } from "../citymap/door";
import { portalNarrow } from "../walk/portalApproach"; // PORTAL1
import { ENTRY_DOOR_OWNED, ENTRY_FACE_MAX, entryDoorBlocks, entryStyle, probeEntry, type DoorStyle } from "../citymap/entryDoor"; // ENTRY-DOOR-001
import { sceneLandmarkVisuals } from "../walk/landmarkWalk";
import { isHiResManaged } from "../hires/registry";

// ------------------------------------------------------------------------------------------ taban dünya
const baseCache = new Map<string, Built>();
/** Taban sahne (hatıralarla aynı talep: 0 ajan, 1 misafir). */
export function baseWorld(scene: string): Built | null {
  if (!(SCENES as Record<string, unknown>)[scene]) return null;
  let b = baseCache.get(scene);
  if (!b) { b = buildWorld(scene, 0, { teams: [], guests: 1 }); baseCache.set(scene, b); }
  return b;
}

/** Karo başına katı blokların en yüksek üstü (solid/glass/glow); taban ızgarası. */
const topCache = new WeakMap<Built, Float32Array>();
export function topGrid(b: Built): Float32Array {
  let g = topCache.get(b);
  if (g) return g;
  g = new Float32Array(b.width * b.depth);
  for (const bl of b.blocks) {
    if (bl.g !== "solid" && bl.g !== "glass" && bl.g !== "glow") continue;
    const i = Math.floor(bl.p[0] + W / 2), j = Math.floor(bl.p[2] + D / 2);
    if (i < 0 || j < 0 || i >= b.width || j >= b.depth) continue;
    const t = bl.p[1] + bl.s[1] / 2;
    if (t > g[j * b.width + i]) g[j * b.width + i] = t;
  }
  topCache.set(b, g);
  return g;
}

// ------------------------------------------------------------------------------------------ çapa tanımları (yalnız istemci)
/** Yerin dış dünyadaki çapası: simge etiketi, duvar çapası (taban oranı fx, fz) ya da kenar (iskele). */
export type Anchor =
  | { landmark: string }
  | { wall: [number, number] }
  | { edge: "front" | "back"; at: number };

const ANCHORS: Record<string, Record<string, Anchor>> = {
  office: { ust_kat: { wall: [0.9, 0.05] } },
  cafe: { loft: { wall: [0.1, 0.05] } },
  mall: { ust_kat: { wall: [0.5, 0.05] } },
  istanbul: { galata: { landmark: "galata" }, teras: { wall: [0.1, 0.62] }, iskele: { edge: "front", at: 0.62 },
    ayasofya: { landmark: "ayasofya" }, sultanahmet: { landmark: "sultanahmet" } },
  kapadokya: { castle: { landmark: "castle" }, teras: { wall: [0.2, 0.42] } },
  londra: { clocktower: { landmark: "clocktower" }, keep: { landmark: "keep" }, teras: { wall: [0.3, 0.6] },
    iskele: { edge: "front", at: 0.3 } },
  ...FULL_ANCHORS,
  ...Object.fromEntries(NEW_CITIES.flatMap((m) => (m.placement?.anchors ? [[m.catalog.id, { ...m.placement.anchors }] as const] : []))),
};

/** POI çapaları: simge etiketi (sırayla `<sahne>:poi:1…`). */
export const POI_NEAR: Record<string, string[]> = {
  istanbul: ["bosphorus_bridge", "galata", "sultanahmet"],
  kapadokya: ["fairy_chimneys", "castle", "balloon_field"],
  londra: ["clocktower", "bascule", "keep"],
  ...FULL_POI_NEAR,
  ...Object.fromEntries(NEW_CITIES.flatMap((m) => (m.placement?.poi ? [[m.catalog.id, [...m.placement.poi]] as const] : []))),
};

// ------------------------------------------------------------------------------------------ tipler
export type Dir2 = [number, number];
export interface DoorPlace {
  scene: string;
  site: string;
  spec: SiteSpec;
  kind: SiteKind;
  /** girilen karo (taban koordinatı) */
  tile: Tile;
  /** kapının baktığı yapı/su yönü (karo adımı) */
  dir: Dir2;
  /** çıkışta avatarın bırakıldığı karo (kapı karosunun dışarı komşusu; yoksa kapının kendisi değil en yakın yürünebilir) */
  out: Tile;
  /** simge ayak izi (varsa) */
  zone: SceneZone | null;
  /** açık yer mi (kültür incelemesi bekleyen kapalı) */
  open: boolean;
  /** dış ızgarada çapa yüksekliği (teras: duvar üstü; kule: simge üstü) */
  height: number;
}
export interface PoiPlace { id: number; tile: Tile; near: string }
export interface ScenePlaces { doors: DoorPlace[]; pois: PoiPlace[]; hidden: Tile[] }

const NO_PLACES: ScenePlaces = { doors: [], pois: [], hidden: [] };
const placeCache = new Map<string, ScenePlaces>();
/** Denetim için yerleşim ve taban önbelleklerini boşaltır. */
export function clearPlaceCaches() { placeCache.clear(); baseCache.clear(); }

const kk = (t: Tile) => `${t[0]},${t[1]}`;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const DIRS: Dir2[] = [[0, 1], [1, 0], [-1, 0], [0, -1]];

/** Ayak izine en yakın noktaya doğru birim yön (karo adımı; eşitlikte ön/yan sırası). */
function dirToward(t: Tile, z: SceneZone): Dir2 {
  const ci = Math.max(z.i0, Math.min(z.i0 + z.w - 1, t[0])), cj = Math.max(z.j0, Math.min(z.j0 + z.d - 1, t[1]));
  const di = ci - t[0], dj = cj - t[1];
  if (Math.abs(dj) >= Math.abs(di) && dj !== 0) return [0, Math.sign(dj)];
  if (di !== 0) return [Math.sign(di), 0];
  return [0, -1];
}

/** Sahnenin yerleşimi (taban koordinatında; önbellekli, belirlenimci). */
export function scenePlaces(scene: string): ScenePlaces {
  const cached = placeCache.get(scene);
  if (cached) return cached;
  const ex = sceneExplore(scene);
  const base = ex ? baseWorld(scene) : null;
  if (!ex || !base) { placeCache.set(scene, NO_PLACES); return NO_PLACES; }
  const nav = navGrid(base);
  const { labels, main } = components(base);
  const reserved = reservedTiles(base);
  const fine = fineWorld(nav);
  const tops = topGrid(base);
  const spawn = spawnTile(base, { core: SCENES[scene as keyof typeof SCENES]?.core ?? null })?.tile ?? [Math.floor(base.width / 2), Math.floor(base.depth / 2)] as Tile;
  const souv = new Set(souvenirSpots(base, scene).map(kk));
  const taken = new Set<string>([kk(spawn)]);
  const zones = base.zones ?? [];
  const reach = (i: number, j: number) => walkable(nav, i, j) && labels[j * nav.width + i] === main;
  const free = (i: number, j: number) => reach(i, j) && !reserved.has(`${i},${j}`) && !souv.has(`${i},${j}`) && !taken.has(`${i},${j}`)
    && (!fine || fine.kind[j * fine.width + i] !== PROP);
  const top = (i: number, j: number) => (i >= 0 && j >= 0 && i < base.width && j < base.depth ? tops[j * base.width + i] : 0);
  /** kapının dışarı komşusu: kapının tersi yönünde yürünebilir karo (yoksa diğer komşular) */
  const outOf = (t: Tile, d: Dir2): Tile => {
    const order: Dir2[] = [[-d[0], -d[1]], ...DIRS.filter((x) => !(x[0] === -d[0] && x[1] === -d[1]) && !(x[0] === d[0] && x[1] === d[1]))];
    for (const o of order) { const n: Tile = [t[0] + o[0], t[1] + o[1]]; if (reach(n[0], n[1])) return n; }
    return t;
  };
  const doors: DoorPlace[] = [];
  const anchors = ANCHORS[scene] ?? {};
  const gateTile = officeDoor(base)?.tile ?? null;
  // HOTEL-SYS (E1): sahnenin tek oteli — kapı = otel geçidi karosu (`bed: "hotel"`, ayak izine bitişik); keşif kimliği değil
  const hz = zones.find((z) => z.kind === "hotel");
  const hs = hz ? (base.spots.sleep ?? []).find((s) => s.bed === "hotel" && zoneDistance(s.tile, hz) === 1) : undefined;
  if (hz && hs) {
    const t = hs.tile, dir = dirToward(t, hz);
    let zt = 0;
    for (let j = hz.j0; j < hz.j0 + hz.d; j++) for (let i = hz.i0; i < hz.i0 + hz.w; i++) zt = Math.max(zt, top(i, j));
    doors.push({ scene, site: HOTEL_SITE, spec: HOTEL_SITE_SPEC, kind: "hotel", tile: t, dir, out: outOf(t, dir), zone: hz, open: true, height: zt });
    taken.add(kk(t)); taken.add(kk(doors[0].out));
  }
  for (const [site, spec] of Object.entries(ex.sites)) {
    const a = anchors[site];
    if (!a) continue;
    let best: { t: Tile; score: number[]; dir: Dir2; zone: SceneZone | null; height: number } | null = null;
    const consider = (t: Tile, score0: number[], dir: Dir2, zone: SceneZone | null, height: number) => {
      // CITYLIFE (ürün sahibi: "kapılar absürt yerlerde olmamalı"): araç şeridi, ajan istasyonu/kiosk dibi ve eşyalı karo en sona kalır
      // ve şehir geçidinin (ofis kapısı) dibinde iki kapı yan yana durmaz
      const site = doorSite(base, t, [-dir[0], -dir[1]]);
      const cityGate = gateTile && cheb(gateTile, t) < 3 ? 1 : 0;
      // PORTAL1 (PORTAL-APPROACH-001): önünde 2 karo düz yaklaşma olmayan ya da geçiş boğazındaki karo her şeyden sonra
      const narrow = portalNarrow(t, [-dir[0], -dir[1]], reach) ? 1 : 0;
      const score = [narrow, (site.lane ? 2 : 0) + (site.agents ? 1 : 0) + (site.tile ? 1 : 0) + cityGate, ...score0];
      if (!best || cmp(score, best.score) < 0) best = { t, score, dir, zone, height };
    };
    if ("landmark" in a) {
      const z = zones.find((x) => x.kind === "landmark" && x.tag === a.landmark);
      if (!z) continue;
      let zt = 0;
      for (let j = Math.max(0, z.j0); j < Math.min(base.depth, z.j0 + z.d); j++)
        for (let i = Math.max(0, z.i0); i < Math.min(base.width, z.i0 + z.w); i++) zt = Math.max(zt, top(i, j));
      const ci = z.i0 + (z.w - 1) / 2;
      // PORTAL1: 1–4 karoda düz yaklaşmalı (boğaz olmayan) kapı karosu yoksa (hepsi narrow) menzil 6'ya açılır
      for (const maxD of [4, 6]) {
      if (maxD > 4 && (best as { score: number[] } | null)?.score[0] === 0) break;
      for (let j = 0; j < base.depth; j++) for (let i = 0; i < base.width; i++) {
        const dist = zoneDistance([i, j], z);
        if (dist < 1 || dist > maxD || !free(i, j)) continue;
        // COURTYARD-PORTAL: avlu portalı taç kapının bir karo önünde (meydanda) durur — dönüşte takip kamerası kapı perdesine düşmez
        if (spec.kind === "courtyard" && dist < 2) continue;
        const side = j >= z.j0 + z.d ? 0 : j < z.j0 ? 2 : 1;
        consider([i, j], [dist, side, Math.abs(i - ci), i, j], dirToward([i, j], z), z, zt);
      }
      }
    } else if ("wall" in a) {
      const want: Tile = [Math.round(a.wall[0] * (base.width - 1)), Math.round(a.wall[1] * (base.depth - 1))];
      for (let j = 0; j < base.depth; j++) for (let i = 0; i < base.width; i++) {
        if (!free(i, j) || cheb([i, j], spawn) < 3) continue;
        if (zones.some((z) => zoneDistance([i, j], z) <= 2)) continue;
        if (isInSacredBuffer([i, j], base)) continue;
        if (doors.some((d) => cheb(d.tile, [i, j]) < 4)) continue;
        for (const d of DIRS) {
          const ni = i + d[0], nj = j + d[1];
          if (ni < 0 || nj < 0 || ni >= base.width || nj >= base.depth || walkable(nav, ni, nj)) continue;
          const h = top(ni, nj);
          if (h < 2.5) continue;
          const back = d[1] === -1 ? 0 : 1, dist = Math.abs(i - want[0]) + Math.abs(j - want[1]);
          // iç sahnelerde (çapa arka duvarda) arka duvara bakan kapı önce gelir
          consider([i, j], a.wall[1] <= 0.1 ? [back, dist, i, j] : [dist, back, i, j], d, null, h);
          break;
        }
      }
    } else {
      const j = a.edge === "front" ? base.depth - 1 : 0;
      const wantI = Math.round(a.at * (base.width - 1));
      for (let i = 1; i < base.width - 1; i++) {
        if (!free(i, j) || !reach(i - 1, j) || !reach(i + 1, j)) continue;
        if (isInSacredBuffer([i, j], base)) continue;
        if (doors.some((d) => cheb(d.tile, [i, j]) < 4)) continue;
        consider([i, j], [Math.abs(i - wantI), i], a.edge === "front" ? [0, 1] : [0, -1], null, 0);
      }
    }
    const b = best as { t: Tile; dir: Dir2; zone: SceneZone | null; height: number } | null;
    if (!b) continue;
    taken.add(kk(b.t));
    // COURTYARD-PORTAL: avlu dönüşü kapıdan iki karo dışarı (kamera kapının geçit perdesine düşmez; arrival_check RETURN/CAM)
    const out1 = outOf(b.t, b.dir), out2: Tile = [2 * out1[0] - b.t[0], 2 * out1[1] - b.t[1]];
    const out = spec.kind === "courtyard" && reach(out2[0], out2[1]) && !taken.has(kk(out2)) ? out2 : out1;
    doors.push({ scene, site, spec, kind: spec.kind, tile: b.t, dir: b.dir, out, zone: b.zone, open: isOpenSite(spec), height: b.height });
    taken.add(kk(doors[doors.length - 1].out));
  }

  // ---- POI'ler
  const pois: PoiPlace[] = [];
  const near = POI_NEAR[scene] ?? [];
  for (let n = 1; n <= ex.poi; n++) {
    const tag = near[n - 1] ?? "spawn";
    const z = tag === "spawn" ? null : zones.find((x) => x.kind === "landmark" && x.tag === tag) ?? null;
    let best: { t: Tile; score: number[] } | null = null;
    for (let j = 0; j < base.depth; j++) for (let i = 0; i < base.width; i++) {
      if (!free(i, j) || isInSacredBuffer([i, j], base)) continue;
      if (pois.some((p) => cheb(p.tile, [i, j]) < 3) || doors.some((d) => cheb(d.tile, [i, j]) < 2)) continue;
      let score: number[];
      if (z) {
        const dist = zoneDistance([i, j], z);
        if (dist < 2 || dist > 6) continue;
        score = [Math.abs(dist - 2), j >= z.j0 + z.d ? 0 : 1, Math.abs(i - (z.i0 + (z.w - 1) / 2)), i, j];
      } else {
        const dist = cheb([i, j], spawn);
        if (dist < 3) continue;
        score = [Math.abs(dist - 4), i, j];
      }
      if (!best || cmp(score, best.score) < 0) best = { t: [i, j], score };
    }
    const bp = best as { t: Tile } | null;
    if (!bp) continue;
    taken.add(kk(bp.t));
    pois.push({ id: n, tile: bp.t, near: tag });
  }

  // ---- gizli köşeler: kuytu ve doğmadan uzak (BFS adımı), karıştırılmış üst adaylardan aralıklı seçim
  const hidden: Tile[] = [];
  if (ex.gz > 0) {
    const steps = bfsSteps(nav, labels, main, spawn);
    const cand: { t: Tile; nook: number; d: number }[] = [];
    for (let j = 1; j < base.depth - 1; j++) for (let i = 1; i < base.width - 1; i++) {
      if (!free(i, j) || isInSacredBuffer([i, j], base)) continue;
      if (pois.some((p) => cheb(p.tile, [i, j]) < 3) || doors.some((d) => cheb(d.tile, [i, j]) < 3)) continue;
      let nook = 0;
      for (const d of DIRS) if (!walkable(nav, i + d[0], j + d[1])) nook++;
      if (nook < 2) continue;
      cand.push({ t: [i, j], nook, d: steps[j * nav.width + i] });
    }
    // yedek: kuytu yoksa (açık alan) en uzak karolar
    if (cand.length < ex.gz) {
      for (let j = 1; j < base.depth - 1; j++) for (let i = 1; i < base.width - 1; i++) {
        if (!free(i, j) || isInSacredBuffer([i, j], base) || cand.some((c) => c.t[0] === i && c.t[1] === j)) continue;
        cand.push({ t: [i, j], nook: 0, d: steps[j * nav.width + i] });
      }
    }
    cand.sort((a, b) => b.nook - a.nook || b.d - a.d || a.t[1] - b.t[1] || a.t[0] - b.t[0]);
    const top = cand.slice(0, Math.max(ex.gz * 6, 12));
    const r = rng(sceneSeed(`${scene}:gizli`));
    for (let k = top.length - 1; k > 0; k--) { const m = Math.floor(r() * (k + 1)); const t = top[k]; top[k] = top[m]; top[m] = t; }
    for (const gap of [6, 4, 2]) {
      hidden.length = 0;
      for (const c of top) {
        if (hidden.every((h) => cheb(h, c.t) >= gap)) hidden.push(c.t);
        if (hidden.length === ex.gz) break;
      }
      if (hidden.length === ex.gz) break;
    }
  }
  const out = { doors, pois, hidden };
  placeCache.set(scene, out);
  return out;
}

function cmp(a: number[], b: number[]): number {
  for (let k = 0; k < Math.max(a.length, b.length); k++) { const d = (a[k] ?? 0) - (b[k] ?? 0); if (d) return d; }
  return 0;
}

function bfsSteps(nav: ReturnType<typeof navGrid>, labels: Int32Array, main: number, from: Tile): Int32Array {
  const n = nav.width * nav.depth;
  const out = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  const s = from[1] * nav.width + from[0];
  if (s < 0 || s >= n || labels[s] !== main) return out;
  let h = 0, t = 0;
  q[t++] = s; out[s] = 0;
  while (h < t) {
    const c = q[h++], ci = c % nav.width, cj = (c - ci) / nav.width;
    for (const [di, dj] of DIRS) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= nav.width || nj >= nav.depth) continue;
      const k = nj * nav.width + ni;
      if (out[k] !== -1 || nav.blocked[k]) continue;
      out[k] = out[c] + 1; q[t++] = k;
    }
  }
  return out;
}

/** Büyümüş dünyaya kaydırılmış karo. */
export const shift = (t: Tile, off: Tile): Tile => [t[0] + off[0], t[1] + off[1]];

// ------------------------------------------------------------------------------------------ çizim işaretleri (+0 çizim çağrısı)
const DOOR_WOOD = "#5B3A24", DOOR_FRAME = "#D6C7A8", MAT = "#8C2F2F", STONE = "#9CA3AF", CAP = "#2F6F8F";

const sceneStyle = (scene: string, kind: SiteKind): DoorStyle => entryStyle(scene, kind === "skyscraper" ? "tower" : kind === "mall_upper" || kind === "office_upper" || kind === "cafe_loft" ? "lobby" : kind);
const probeCache = new Map<string, Block[]>();
/** Sahne giriş kapısını ölçmek için görünen yapı blokları (hi-res yönetilen orta bloklar çıkar, yerine hi gelir). Denetim de bunu kullanır. */
export function sceneProbeBlocks(scene: string): Block[] {
  const hit = probeCache.get(scene);
  if (hit) return hit;
  const base = baseWorld(scene);
  const out = base ? [...base.blocks.filter((b) => !isHiResManaged(b)), ...sceneLandmarkVisuals(scene, base, tx, tz).flatMap((v) => v.vis)] : [];
  probeCache.set(scene, out);
  return out;
}
/** Sahne kapısı (taban koordinatı, kayıksız): yapı yüzü varsa kapı YÜZÜN önünde (eski işaret karo kenarında havada kalıyordu); yüz yoksa null. */
export function sceneEntryDoor(scene: string, d: DoorPlace): Block[] | null {
  if (ENTRY_DOOR_OWNED[`scene:${scene}/${d.site}`]) return null; // kapısı başka ekipte
  const cx = tx(d.tile[0]), cz = tz(d.tile[1]);
  const pr = probeEntry(sceneProbeBlocks(scene), cx, cz, d.dir, 0);
  if (pr.wall === null || pr.wall > ENTRY_FACE_MAX || (d.kind === "hotel" && pr.ok)) return null; // otel: kendi cephe kapısı okunuyorsa dokunulmaz; yüzsüz: serbest duran işaret (denetim: çerçeve dikmeleri)
  return entryDoorBlocks(pr, cx, cz, d.dir, sceneStyle(scene, d.kind), 0);
}

/**
 * Kapı ve POI işaretleri (yalnız çizim; çarpışma ve yol bulmayı etkilemez). Açık yerlerin kapıları ve POI kaideleri;
 * gizli köşe işaretsizdir. `off`: taban kayması (büyümüş dünya). Hepsi `solid` grubunda (her sahnede var → +0 çizim çağrısı).
 */
export function exploreMarkerBlocks(scene: string, off: Tile): Block[] {
  const pl = scenePlaces(scene);
  const out: Block[] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string) => out.push({ p: [x, y, z], s: [w, h, d], c, g: "solid", j: 0.02, entryDoor: true } as Block); // ENTRY-DOOR-001: kapı işareti (duvar ölçüsüne girmez)
  for (const d of pl.doors) {
    if (!d.open) continue;
    if (d.kind === "hotel") { // HOTEL-SYS: otel kapısını kendi cephesi çizer (districts/hotel.ts hotelShell); ENTRY-DOOR-001: okunmuyorsa standart kapı
      const hs = sceneEntryDoor(scene, d);
      if (hs) { const [hi, hj] = shift(d.tile, off); for (const b of hs) out.push({ ...b, p: [b.p[0] + tx(hi) - tx(d.tile[0]), b.p[1], b.p[2] + tz(hj) - tz(d.tile[1])] }); }
      continue;
    }
    const [i, j] = shift(d.tile, off);
    const cx = tx(i), cz = tz(j);
    if (d.kind === "pier") {
      // iskele kapısı: iki direk + üst kiriş + halat (dışarı bakan kenarda)
      const ex = cx + d.dir[0] * 0.42, ez = cz + d.dir[1] * 0.42;
      const px = d.dir[1] !== 0 ? 0.42 : 0, pz = d.dir[0] !== 0 ? 0.42 : 0;
      box(ex - px, 0.75, ez - pz, 0.14, 1.5, 0.14, DOOR_WOOD);
      box(ex + px, 0.75, ez + pz, 0.14, 1.5, 0.14, DOOR_WOOD);
      box(ex, 1.55, ez, px ? 1.0 : 0.16, 0.14, pz ? 1.0 : 0.16, DOOR_FRAME);
      box(cx, 0.015, cz, 0.8, 0.03, 0.8, "#A47148");
      continue;
    }
    // ENTRY-DOOR-001: yapının GÖRÜNEN yüzünde (hi varsa hi) kapı okunmuyorsa üsluba uygun standart kapı yüzün önüne kurulur
    const std = sceneEntryDoor(scene, d);
    if (std) {
      const dx = cx - tx(d.tile[0]), dz = cz - tz(d.tile[1]);
      for (const b of std) out.push({ ...b, p: [b.p[0] + dx, b.p[1], b.p[2] + dz] });
      box(cx - d.dir[0] * 0.05, 0.015, cz - d.dir[1] * 0.05, d.dir[1] !== 0 ? 0.78 : 0.5, 0.03, d.dir[1] !== 0 ? 0.5 : 0.78, MAT);
      continue;
    }
    // kapı: yapıya bakan kenarda çerçeve + koyu kanat + paspas
    const ex = cx + d.dir[0] * 0.44, ez = cz + d.dir[1] * 0.44;
    const along = d.dir[1] !== 0; // kenar x boyunca
    const px = along ? 0.66 : 0, pz = along ? 0 : 0.66; // ENTRY-DOOR-001: açıklık 1,1 (eski 0,8)
    box(ex - px, 0.95, ez - pz, along ? 0.14 : 0.12, 1.9, along ? 0.12 : 0.14, DOOR_FRAME);
    box(ex + px, 0.95, ez + pz, along ? 0.14 : 0.12, 1.9, along ? 0.12 : 0.14, DOOR_FRAME);
    box(ex, 1.95, ez, along ? 1.46 : 0.14, 0.14, along ? 0.14 : 1.46, DOOR_FRAME);
    box(ex + d.dir[0] * 0.03, 0.92, ez + d.dir[1] * 0.03, along ? 1.1 : 0.06, 1.8, along ? 0.06 : 1.1, DOOR_WOOD);
    box(cx - d.dir[0] * 0.05, 0.015, cz - d.dir[1] * 0.05, along ? 0.78 : 0.5, 0.03, along ? 0.5 : 0.78, MAT);
  }
  for (const p of pl.pois) {
    const [i, j] = shift(p.tile, off);
    const x = tx(i) + 0.3, z = tz(j) - 0.3;
    box(x, 0.3, z, 0.3, 0.6, 0.3, STONE);
    box(x, 0.64, z, 0.36, 0.08, 0.36, CAP);
  }
  return out;
}
