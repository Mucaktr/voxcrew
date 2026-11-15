/**
 * ofis tabanının kenarındaki **"Şehre çık"** kapısı ( "Giriş").
 *
 * Kapı karosu belirlenimcidir: taban modülünün kenarlarında (ön +z öncelikli; arka, sol, sağ) yürünebilir ve doğma karosundan
 * yürüyerek ulaşılabilir, içeri komşusu da açık karolar arasından **mantıklı yer** kurallarını (`doorSite`; CITYLIFE, ürün sahibi "cam önünde
 * kapı olmaz") geçen, yan dağınıklığı en az ve kenar ortasına en yakın karo. Taban dünya büyüyünce modülle birlikte kayar (dünya ızgarası
 * karosu döner). İşaret blokları yalnız çizimdir (`solid` grubuna katılır: +0 çizim çağrısı; çarpışmaya girmez) — kemer, iskele
 * babaları ve zemin plakası; yazı/logo yok. Ofis tabanının blokları, istasyonları ve kuralları değişmez.
 *
 * Saf modül: React/three yok.
*/
import { reachable } from "../worldFormat";
import { tx, tz, type Block, type Built, type Tile } from "../scenes";
import { spawnTile } from "../walk/controller";
import { portalNarrow } from "../walk/portalApproach"; // PORTAL1

export interface OfficeDoor {
  /** dünya ızgarası karosu */
  tile: Tile;
  /** kapının dışa baktığı yön (karo adımı; kenarın dışı) */
  dir: [number, number];
  /** dönüşte avatarın bırakıldığı karo (kapının içeri komşusu) */
  out: Tile;
}

const cache = new WeakMap<Built, OfficeDoor | null>();

// ------------------------------------------------------------------------------------------ CITYLIFE (ürün sahibi 2026-10-28): kapı yeri
/**
 * Kapının yeri mantıklı mı (ürün sahibi: "cam önünde kapı olmaz", "yolun ortası, camın önü… absürt yerlerde olmamalı"): her aday karo için
 * ölçülür. Kemer kenar noktası e = karo ortası + dir·0,44.
 * - `arch` kemer hacminde (e çevresi, açıklık boyunca ±0,62, derinlik ±0,3, y 0,12–2,3) başka blok — kemer bir şeye gömülür
 * - `tile` kapı karosunda eşya (y 0,12–2,0)
 * - `facade` kemerin ARKASINDA (dışarı 2 birim, ±0,7): cam ya da üstü 1,0'ı aşan katı (duvar, cephe, pencere) — kapı cama/duvara açılır
 * - `beyond` dışarı komşu karo dünya içinde ve engelli (kapı duvara açılır)
 * - `side` yanlarda (açıklık boyunca ±1,5, karoda) üstü 1,0'ı aşan blok (kiosk, büfe, direk, duvar)
 * - `inner` içeri komşu karoda eşya (bank, masa: dönüş karosu ve yaklaşım kapalı)
 * - `agents` kapı ya da içeri komşusuna ≤ 1 karo ajan istasyonu / araç noktası (kiosk, terminal, masa)
 * - `approach` içeri iki karo yürünebilir mi (kapı açık alana bakar)
 * - `lane` karo yerde giden aracın (otobüs, tramvay, taksi, tren) şeridinde, süpürdüğü bantta ya da asfalt yolda; kemer
 * direkleri (açıklık boyunca iki yan) ve içeri komşusu da yola basmaz (yolun ortası)
 * - `cut` kapı karosu yürüyüş ağının kesim noktası: kapıyı çıkarınca başka karolar kopar (kapı tek geçidi tıkar)
*/
export interface DoorSite { arch: number; tile: number; facade: number; beyond: boolean; side: number; inner: number; agents: number; approach: boolean; lane: boolean; cut: boolean }
const overlap = (q: Block, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) =>
  q.p[0] + q.s[0] / 2 > x0 && q.p[0] - q.s[0] / 2 < x1 && q.p[2] + q.s[2] / 2 > z0 && q.p[2] - q.s[2] / 2 < z1 && q.p[1] + q.s[1] / 2 > y0 && q.p[1] - q.s[1] / 2 < y1;
const MASS = new Set(["solid", "glass", "glow", "spin", "flame"]);
/** Yerde giden hareketliler (şeritleri yaya kapısı yeri olamaz). */
export const GROUND_MOVERS: ReadonlySet<string> = new Set(["bus", "tram", "taxi", "train", "car", "cart", "trolley"]);
/** Noktanın yerde giden bir hareketlinin rotasına uzaklığı ≤ `pad` mi (rota parçaları; gövde yarı eni + pay). */
export function onLane(movers: Built["movers"], x: number, z: number, pad = 1.0): boolean {
  for (const m of movers ?? []) {
    if (!GROUND_MOVERS.has(m.shape) || m.path.length < 2) continue;
    const n = m.path.length, closed = (m.mode ?? "loop") === "loop";
    for (let k = 0; k < (closed ? n : n - 1); k++) {
      const a = m.path[k], b = m.path[(k + 1) % n];
      if (Math.max(a[1], b[1]) > 1.5) continue; // havada giden (teleferik, monoray) yayayı kesmez
      const dx = b[0] - a[0], dz = b[2] - a[2], L = dx * dx + dz * dz;
      const u = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L)) : 0;
      if (Math.hypot(x - (a[0] + u * dx), z - (a[2] + u * dz)) <= pad * (m.scale ?? 1)) return true;
    }
  }
  return false;
}

/** Asfalt zemin mi: noktanın altındaki zemin kaplaması (üstü −0,05…0,13) koyu ve renksiz (yol, şerit). */
export function roadAt(blocks: readonly Block[], x: number, z: number): boolean {
  for (const q of blocks) {
    const top = q.p[1] + q.s[1] / 2;
    if (q.g !== "solid" || top > 0.13 || top < -0.05 || Math.abs(q.p[0] - x) > q.s[0] / 2 || Math.abs(q.p[2] - z) > q.s[2] / 2) continue;
    const n = parseInt(q.c.slice(1, 7), 16);
    if (!Number.isFinite(n)) continue;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (lum < 0.36 && Math.max(r, g, b) - Math.min(r, g, b) <= 22) return true;
  }
  return false;
}

type SiteSource = Pick<Built, "width" | "depth" | "blocks" | "blocked" | "stations" | "spots" | "movers">;
const walkOf = (b: SiteSource) => (i: number, j: number) => i >= 0 && j >= 0 && i < b.width && j < b.depth && !b.blocked.has(`${i},${j}`);

/** Kapı karosu kesim noktası mı: `reach` (doğmadan ulaşılan) kümesinden kapı çıkarılınca ulaşılan karo sayısı düşer mi. */
function cutsWalk(tile: Tile, reach: ReadonlySet<string>): boolean {
  const k0 = `${tile[0]},${tile[1]}`;
  const startK = [...reach].find((k) => k !== k0);
  if (!startK) return false;
  const seen = new Set<string>([startK, k0]);
  const q = [startK];
  while (q.length) {
    const [i, j] = q.pop()!.split(",").map(Number);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${i + di},${j + dj}`;
      if (seen.has(k) || !reach.has(k)) continue;
      seen.add(k); q.push(k);
    }
  }
  return seen.size < reach.size;
}

export function doorSite(built: SiteSource, tile: Tile, dir: readonly [number, number], walk: (i: number, j: number) => boolean = walkOf(built),
  reach: ReadonlySet<string> | null = null): DoorSite {
  const cx = tx(tile[0]), cz = tz(tile[1]);
  const along = dir[1] !== 0; // açıklık x boyunca
  const ex = cx + dir[0] * 0.44, ez = cz + dir[1] * 0.44;
  const rect = (x: number, z: number, hu: number, hv: number): [number, number, number, number] =>
    along ? [x - hu, x + hu, z - hv, z + hv] : [x - hv, x + hv, z - hu, z + hu];
  let arch = 0, onTile = 0, facade = 0, side = 0, inner = 0;
  const A = rect(ex, ez, 0.62, 0.3);
  const T = rect(cx, cz, 0.45, 0.45);
  const F = rect(ex + dir[0] * 1.05, ez + dir[1] * 1.05, 0.7, 1.0);
  const S = rect(cx, cz, 1.5, 0.45);
  const I = rect(cx - dir[0], cz - dir[1], 0.45, 0.45);
  for (const q of built.blocks) {
    if (!MASS.has(q.g)) continue;
    const top = q.p[1] + q.s[1] / 2;
    if (top <= 0.12) continue; // zemin kaplaması
    if (overlap(q, A[0], A[1], A[2], A[3], 0.12, 2.3)) arch++;
    if (overlap(q, T[0], T[1], T[2], T[3], 0.12, 2.0)) onTile++;
    if (overlap(q, F[0], F[1], F[2], F[3], 0.3, 3.0) && (q.g === "glass" || top > 1.0)) facade++;
    if (overlap(q, S[0], S[1], S[2], S[3], 0.3, 2.4) && top > 1.0) side++;
    if (overlap(q, I[0], I[1], I[2], I[3], 0.15, 1.6)) inner++;
  }
  const near = (t: Tile) => Math.max(Math.abs(t[0] - tile[0]), Math.abs(t[1] - tile[1]));
  const nearIn = (t: Tile) => Math.max(Math.abs(t[0] - tile[0] + dir[0]), Math.abs(t[1] - tile[1] + dir[1]));
  let agents = 0;
  for (const s of built.stations) if (near(s.tile) <= 1 || nearIn(s.tile) <= 1) agents++;
  // HOTEL-SYS: otel kapısı geçidi (`bed: "hotel"`) kapının kendisidir — ajan yeri sayılmaz
  for (const list of Object.values(built.spots ?? {})) for (const s of list ?? []) if ((s as { bed?: string }).bed !== "hotel" && (near(s.tile) <= 1 || nearIn(s.tile) <= 1)) agents++;
  const o: Tile = [tile[0] + dir[0], tile[1] + dir[1]];
  const inside = o[0] >= 0 && o[1] >= 0 && o[0] < built.width && o[1] < built.depth;
  const beyond = inside && built.blocked.has(`${o[0]},${o[1]}`);
  const approach = walk(tile[0] - dir[0], tile[1] - dir[1]) && walk(tile[0] - 2 * dir[0], tile[1] - 2 * dir[1]);
  // yol: hareketli şeridi ya da asfalt zemin (kapı karosu, içeri komşusu ve açıklık boyunca iki yanı — kemer direkleri yola basmaz)
  const px = dir[1] !== 0 ? 1 : 0, pz = dir[1] !== 0 ? 0 : 1;
  const lane = onLane(built.movers, cx, cz) || onLane(built.movers, cx - dir[0], cz - dir[1])
    || [[0, 0], [px, pz], [-px, -pz], [-dir[0], -dir[1]]].some(([a, b]) => roadAt(built.blocks, cx + a, cz + b));
  // kesim noktası BFS'i pahalı: yalnız öbür kurallar geçtiyse
  const cut = reach && !arch && !onTile && !facade && !beyond && !agents && approach && !inner && !lane ? cutsWalk(tile, reach) : false;
  return { arch, tile: onTile, facade, beyond, side, inner, agents, approach, lane, cut };
}
/** Sert kural (gerçekçilik kapısı REAL-PORTAL-003 ile aynı): cama/duvara açılmaz, kemer/karo boş, ajan yerinin ve eşyanın dibinde
 *  değil, şeritte değil, tek geçidi tıkamaz, açık alana bakar. */
export const doorSiteOk = (s: DoorSite) => s.arch === 0 && s.tile === 0 && s.facade === 0 && !s.beyond && s.agents === 0 && s.approach && s.inner === 0 && !s.lane && !s.cut;
/** Bulgu metni (denetim): kuralı bozan ölçüler. */
export function doorSiteWhy(s: DoorSite): string[] {
  const out: string[] = [];
  if (s.facade) out.push(`arkasında cam/duvar (${s.facade})`);
  if (s.beyond) out.push("dışarı komşusu engelli (duvara açılıyor)");
  if (s.arch) out.push(`kemer bir bloğa gömülü (${s.arch})`);
  if (s.tile) out.push(`kapı karosunda eşya (${s.tile})`);
  if (s.inner) out.push(`içeri komşuda eşya/bank (${s.inner})`);
  if (s.agents) out.push(`ajan istasyonu/kiosk dibinde (${s.agents})`);
  if (!s.approach) out.push("içeri açık alana bakmıyor");
  if (s.lane) out.push("araç şeridinde / yolda (yolun ortası)");
  if (s.cut) out.push("tek geçidi tıkıyor (kesim noktası)");
  return out;
}

/** geçit ritüel mekânının sipariş karosundan en az bu kadar karo (Chebyshev) uzakta ( sınıfı: tabure portalın dibinde).*/
export const GATE_KEEPOUT = 3;
const nearKeepOut = (built: Built, t: Tile) => !!built.keepOut?.some((k) => Math.max(Math.abs(k[0] - t[0]), Math.abs(k[1] - t[1])) < GATE_KEEPOUT);

export function officeDoor(built: Built): OfficeDoor | null {
  if (cache.has(built)) return cache.get(built)!;
  const m = built.modules.find((x) => x.base) ?? built.modules[0] ?? { i0: 0, j0: 0, w: built.width, d: built.depth };
  const start = spawnTile(built)?.tile ?? null;
  const reach = start ? reachable(start, built) : null;
  const open = (i: number, j: number) => i >= 0 && j >= 0 && i < built.width && j < built.depth && !built.blocked.has(`${i},${j}`) && (!reach || reach.has(`${i},${j}`));
  const order = (n: number, c: number) => Array.from({ length: n }, (_, k) => k).sort((a, b) => Math.abs(a - c) - Math.abs(b - c) || a - b);
  const sides: { tiles: Tile[]; dir: [number, number]; pri: number; mid: number }[] = [
    { tiles: order(m.w, (m.w - 1) / 2).map((k) => [m.i0 + k, m.j0 + m.d - 1] as Tile), dir: [0, 1], pri: 0, mid: m.i0 + (m.w - 1) / 2 },
    { tiles: order(m.w, (m.w - 1) / 2).map((k) => [m.i0 + k, m.j0] as Tile), dir: [0, -1], pri: 3, mid: m.i0 + (m.w - 1) / 2 },
    { tiles: order(m.d, (m.d - 1) / 2).map((k) => [m.i0, m.j0 + k] as Tile), dir: [-1, 0], pri: 2, mid: m.j0 + (m.d - 1) / 2 },
    { tiles: order(m.d, (m.d - 1) / 2).map((k) => [m.i0 + m.w - 1, m.j0 + k] as Tile), dir: [1, 0], pri: 2, mid: m.j0 + (m.d - 1) / 2 },
  ];
  // CITYLIFE: ilk açık karo değil, kuralları geçen en iyi karo (cama/duvara açılmayan, kiosk/bank dibinde ve şeritte olmayan, tek
  // geçidi tıkamayan, ortaya yakın); hiçbiri geçmezse eski davranış (ilk açık karo) — denetim (REAL-PORTAL-003) bulgu gösterir
  let best: { door: OfficeDoor; score: number } | null = null;
  let first: OfficeDoor | null = null;
  for (const s of sides) {
    for (const t of s.tiles) {
      if (!open(t[0], t[1])) continue;
      const inn: Tile = [t[0] - s.dir[0], t[1] - s.dir[1]];
      // içeri komşusu da yürünebilir olmalı (dönüş karosu; kapıya basmadan bırakılır)
      if (!open(inn[0], inn[1])) continue;
      const door: OfficeDoor = { tile: t, dir: s.dir, out: inn };
      first ??= door;
      const site = doorSite(built, t, s.dir, open, reach);
      if (!doorSiteOk(site) || nearKeepOut(built, t)) continue;
      const off = Math.abs((s.dir[1] !== 0 ? t[0] : t[1]) - s.mid);
      // PORTAL1 (PORTAL-APPROACH-001): önünde 2 karo düz yaklaşma yoksa ya da karo geçiş boğazıysa ancak başka yer yoksa
      const score = s.pri * 4 + site.side * 3 + off * 0.25 + (portalNarrow(t, [-s.dir[0], -s.dir[1]], open) ? 1000 : 0);
      if (!best || score < best.score - 1e-9) best = { door, score };
    }
  }
  // kenarda mantıklı yer yoksa (büyümüş dünyada taban modüllerle çevriliyse): taban içinde açık zeminde serbest duran geçit — iki yanı
  // açık (dışarı komşusu da yürünür), kuralları geçen, kenara en yakın karo
  if (!best) {
    for (let j = m.j0 + 1; j < m.j0 + m.d - 1; j++) for (let i = m.i0 + 1; i < m.i0 + m.w - 1; i++) {
      if (!open(i, j)) continue;
      for (const s of sides) {
        const t: Tile = [i, j], inn: Tile = [i - s.dir[0], j - s.dir[1]];
        if (!open(inn[0], inn[1]) || !open(i + s.dir[0], j + s.dir[1])) continue;
        const site = doorSite(built, t, s.dir, open, reach);
        if (!doorSiteOk(site) || nearKeepOut(built, t)) continue;
        const edge = Math.min(i - m.i0, m.i0 + m.w - 1 - i, j - m.j0, m.j0 + m.d - 1 - j);
        const score = 100 + edge * 2 + s.pri + site.side * 3;
        if (!best || score < best.score - 1e-9) best = { door: { tile: t, dir: s.dir, out: inn }, score };
      }
    }
  }
  const out = best?.door ?? first;
  cache.set(built, out);
  return out;
}

/**
 * CORE-WALK (REAL-PORTAL): geçidin voksel ışık çerçevesi — kemer açıklığında yerden yükselen iki parlak dikme ve üst bant
 * (`glow`; ortası açık, içinden ışınlanma halkası/sütunu görünür: `PortalRing.tsx`). `along`: açıklık x boyunca (kapı ±z'ye bakar).
 * Yere basar (alt 0,05; kapı plakası 0,03), parçalar birbirine değer (REAL-SUPPORT). Gece `glow` grubu parlar.
 */
export function portalFrameBlocks(cx: number, cz: number, along: boolean, c = "#7EE8FA", top = "#C4B5FD"): Block[] {
  const out: Block[] = [];
  const box = (u: number, y: number, w: number, h: number, col: string) =>
    out.push({ p: [cx + (along ? u : 0), y, cz + (along ? 0 : u)], s: [along ? w : 0.05, h, along ? 0.05 : w], c: col, g: "glow", j: 0 });
  for (const s of [-1, 1]) box(s * 0.33, 0.05 + 0.93, 0.12, 1.86, c);
  box(0, 1.85, 0.78, 0.12, top);
  return out;
}

/**
 * Kapının işaret blokları (çizim; `solid`; CORE-WALK: açıklıkta `glow` ışık çerçevesi): kemer (iki direk + lento), kenara bakan zemin plakası. şehrin varış meydanı
 * iskeleyse (`pier`; İstanbul) kapı küçük bir vapur iskelesidir: dışa uzanan ahşap iskele, babalar, can simidi ve saçak.
*/
export function officeDoorBlocks(door: OfficeDoor, kind: "pier" | "plaza" = "plaza"): Block[] {
  const out: Block[] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string) => out.push({ p: [x, y, z], s: [w, h, d], c, g: "solid", j: 0.02 });
  const cx = tx(door.tile[0]), cz = tz(door.tile[1]);
  const ex = cx + door.dir[0] * 0.44, ez = cz + door.dir[1] * 0.44;
  const along = door.dir[1] !== 0;
  const px = along ? 0.46 : 0, pz = along ? 0 : 0.46;
  box(ex - px, 1.0, ez - pz, 0.14, 2.0, 0.14, "#2F6F8F");
  box(ex + px, 1.0, ez + pz, 0.14, 2.0, 0.14, "#2F6F8F");
  box(ex, 2.05, ez, along ? 1.08 : 0.18, 0.18, along ? 0.18 : 1.08, "#2F6F8F");
  box(ex, 2.22, ez, along ? 0.5 : 0.1, 0.16, along ? 0.1 : 0.5, "#F2C14E");
  box(cx, 0.015, cz, 0.84, 0.03, 0.84, "#7FC8E8");
  out.push(...portalFrameBlocks(ex, ez, along));
  if (kind === "pier") {
    // dışa uzanan ahşap iskele (karonun dış yarısı + kenarın ötesi), babalar, can simidi (direkte), mavi saçak
    const ox = door.dir[0], oz = door.dir[1], fx = cx + ox * 0.95, fz = cz + oz * 0.95;
    box(fx, 0.03, fz, along ? 1.1 : 1.3, 0.06, along ? 1.3 : 1.1, "#9C7A55");
    for (const s of [-1, 1]) box(fx + ox * 0.5 + px * s * 1.15, 0.16, fz + oz * 0.5 + pz * s * 1.15, 0.16, 0.32, 0.16, "#3F3A33");
    box(ex - px * 1.1, 1.0, ez - pz * 1.1, 0.06, 0.06, 0.06, "#2F6F8F");
    for (const dy of [0.14, -0.14]) box(ex - px * 1.0, 1.0 + dy, ez - pz * 1.0, along ? 0.3 : 0.06, 0.06, along ? 0.06 : 0.3, "#F97316");
    for (const s of [-1, 1]) box(ex - px * 1.0 + (along ? s * 0.14 : 0), 1.0, ez - pz * 1.0 + (along ? 0 : s * 0.14), 0.06, 0.22, 0.06, "#F97316");
    box(ex - ox * 0.2, 2.4, ez - oz * 0.2, along ? 1.3 : 0.7, 0.08, along ? 0.7 : 1.3, "#1F3A5F");
  }
  return out;
}
