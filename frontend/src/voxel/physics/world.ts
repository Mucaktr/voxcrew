/**
 * PHYS — statik çarpışma dünyası: kurulmuş sahneden (blok + engel ızgarası) bir kez türetilen katı ayak izleri.
 *
 * Karo başına en çok bir eksen hizalı kutu (AABB, dünya birimi) tutulur; karo ızgarası aynı zamanda uzamsal karmadır
 * (sorgu: dairenin kapladığı karolar). Üç tür:
 *  - `SOLID`: engelli karo (`built.blocked`: duvar, masa, ağaç, tezgâh, su…). Kutu, karodaki gövde yüksekliğindeki katı
 *    blokların birleşimi (karoya kırpılır); hiç blok yoksa (su, boş engel) bütün karo. Izgara dışı da katıdır.
 *  - `PROP`: yürünebilir karoda gövde yüksekliğinde katı eşya (yalnız süs): yol bulma için kapalı.
 *  - `SEAT`: yürünebilir bir HEDEF karosunda eşya (sandalye, bank, yatak, şezlong…): yalnız o karoyu hedefleyen beden
 *    girebilir ("izinli hedef" istisnası; çarpıştırıcı yok sayılmaz, beden başına muaf tutulur). Yol bulmada hedef dışında kapalı.
 * Kapılar/geçitler: yürünebilir karodaki eşya bir istasyonu, yatağı ya da araç noktasını ulaşılamaz kılarsa (ör. kapı kanadı,
 * dar geçitteki süs) hedeften en az eşyalı tek yol üstündeki karolar açılır (`repair`): kutu önce karonun köşesine küçültülür
 * (çarpıştırıcı korunur), sığmazsa düşürülür; sahne dosyalarına dokunulmaz.
 *
 * Saf modül: React/three yok; aynı `built` → aynı sonuç (WeakMap önbelleği).
 *
 * WALK-PHYS: avatarın dikey boyutu (yükseklik alanı, basamak, zıplama, tırmanma) ve WALK-EXPLORE için ek yürünebilir alan
 * kaydı `physics/height.ts` içindedir; buradan da dışa aktarılır:
 *   `registerWalkArea(id, { w, d, solid }, { floor, ceil? }, [i0, j0]) → unregister` — iç mekân/kat karoları yalnız avatar
 *   için taban dünyayı ezer (çarpışma, yüzey yüksekliği, tıkla-git). Ayrıntı ve kurallar: height.ts dosya başı.
 * Çevre parseli (`OuterParcel.top`) isteğe bağlı karo üst yüzü taşır (FREE: zemin y'si; SOLID: tırmanılabilirse üst yüz, değilse
 * NaN): Outskirts.tsx arazi yüksekliği, alçak öğeler (kaya, sandık…) ve inşa blok yığınlarından yazar.
 */
import { D, W, type Block, type Built, type Tile } from "../scenes";

export const FREE = 0;
export const SOLID = 1;
export const PROP = 2;
export const SEAT = 3;

/** Gövde yüksekliği bandı: tabanı bunun altında ve tepesi bunun üstünde olan katı blok bedeni durdurur. */
export const BODY_LOW = 0.3;
export const BODY_HIGH = 1.0;
/** Çarpıştırıcı türeten blok grupları (su, dalga, bulut, alev, bayrak… hayır). */
const SOLID_GROUPS = new Set(["solid", "glass", "glow"]);
/** Bundan küçük alanlı eşya kutusu yok sayılır (sap, ince süs) */
const MIN_AREA = 0.02;
/** Tek bloğun ayak izi bundan küçükse (çiçek, sandalye ayağı) ve boyu BODY_HIGH'ı aşmıyorsa yok sayılır; direkler kalır. */
const MIN_BLOCK_AREA = 0.05;
/** Beden yarıçapı (yol ızgarası kararı): eşya kutusu karo merkezinden geçen artı biçimli şeride (± NAV_R) değmiyorsa karo
 *  yol bulmada açık kalır (kenara yaslı ince süs). */
export const NAV_R = 0.26;

export interface NavLike { width: number; depth: number; blocked: Set<string> }

export interface StaticWorld {
  width: number;
  depth: number;
  /** karo türü (j * width + i) */
  kind: Uint8Array;
  /** karo başına kutu [minX, minZ, maxX, maxZ] (dünya); tür FREE ise anlamsız */
  box: Float32Array;
  /** yol bulma ızgarası: engelli ∪ merkez şeridine değen PROP/SEAT (findPath hedefi her zaman girilebilir) */
  nav: NavLike;
  /** 1 = yol bulmada kapalı (SOLID ya da merkez şeridine değen eşya) */
  closed: Uint8Array;
  /** hedef karoları (istasyon, araç/uyku noktası, dinlenme, kahve önü) — j * width + i */
  targets: Set<number>;
  /** onarımla çarpıştırıcısı düşürülen karolar (kapı/geçit) */
  repaired: number;
  /** onarımla çarpıştırıcısı köşeye küçültülen (korunan) karolar */
  shrunk: number;
  props: number;
  seats: number;
}

const HW = W / 2, HD = D / 2;
export const tileX = (x: number) => Math.floor(x + HW);
export const tileZ = (z: number) => Math.floor(z + HD);
export const tileIndex = (sw: Pick<StaticWorld, "width" | "depth">, x: number, z: number) => {
  const i = tileX(x), j = tileZ(z);
  return i >= 0 && j >= 0 && i < sw.width && j < sw.depth ? j * sw.width + i : -1;
};
export const centerX = (i: number) => i - HW + 0.5;
export const centerZ = (j: number) => j - HD + 0.5;

type StaticSource = Pick<Built, "width" | "depth" | "blocked" | "blocks" | "stations" | "spots" | "rest" | "props">;
const cache = new WeakMap<object, StaticWorld>();

/** Hedef karoları: istasyonlar, bütün araç/uyku noktaları, dinlenme karoları, kahve makinesi önü. */
export function targetTiles(built: Pick<Built, "width" | "depth" | "stations" | "spots" | "rest" | "props">): Set<number> {
  const out = new Set<number>();
  const add = (t: Tile | undefined) => { if (t && t[0] >= 0 && t[1] >= 0 && t[0] < built.width && t[1] < built.depth) out.add(t[1] * built.width + t[0]); };
  for (const s of built.stations) add(s.tile);
  for (const list of Object.values(built.spots ?? {})) for (const s of list ?? []) add(s.tile);
  for (const r of built.rest ?? []) add(r);
  for (const p of built.props ?? []) if (p.k === "coffee") add(p.tile);
  return out;
}

/** Statik dünya (dünya başına bir kez). */
export function staticWorld(built: StaticSource): StaticWorld {
  let sw = cache.get(built);
  if (sw) return sw;
  const { width, depth } = built;
  const n = width * depth;
  const kind = new Uint8Array(n);
  const box = new Float32Array(n * 4);
  // birleşim kutuları: +Inf/-Inf ile başla
  for (let k = 0; k < n; k++) { box[k * 4] = Infinity; box[k * 4 + 1] = Infinity; box[k * 4 + 2] = -Infinity; box[k * 4 + 3] = -Infinity; }
  const blockedGrid = new Uint8Array(n);
  for (const key of built.blocked) {
    const c = key.indexOf(",");
    const i = Number(key.slice(0, c)), j = Number(key.slice(c + 1));
    if (i >= 0 && j >= 0 && i < width && j < depth) blockedGrid[j * width + i] = 1;
  }
  const hasBox = new Uint8Array(n);
  // WALK-SCALE: yol bulma kutusu — katı komşuya yaslı kenar parçaları (köprü/iskele korkuluğu, rıhtım bordürü) hariç
  const navBox = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) { navBox[k * 4] = Infinity; navBox[k * 4 + 1] = Infinity; navBox[k * 4 + 2] = -Infinity; navBox[k * 4 + 3] = -Infinity; }
  const hasNav = new Uint8Array(n);
  for (const b of built.blocks) addBlock(b, width, depth, box, hasBox, blockedGrid, navBox, hasNav);
  const targets = targetTiles(built);
  let props = 0, seats = 0;
  for (let k = 0; k < n; k++) {
    const i = k % width, j = (k - i) / width;
    const x0 = i - HW, z0 = j - HD;
    if (blockedGrid[k]) {
      kind[k] = SOLID;
      if (!hasBox[k] || (box[k * 4 + 2] - box[k * 4]) * (box[k * 4 + 3] - box[k * 4 + 1]) < MIN_AREA) setBox(box, k, x0, z0, x0 + 1, z0 + 1);
    } else if (hasBox[k] && (box[k * 4 + 2] - box[k * 4]) * (box[k * 4 + 3] - box[k * 4 + 1]) >= MIN_AREA) {
      if (targets.has(k)) { kind[k] = SEAT; seats++; } else { kind[k] = PROP; props++; }
    }
  }
  const closed = new Uint8Array(n);
  for (let k = 0; k < n; k++) closed[k] = kind[k] === SOLID || (kind[k] !== FREE && hasNav[k] === 1 && crossHit(navBox, k, width)) ? 1 : 0;
  sw = { width, depth, kind, box, nav: { width, depth, blocked: new Set() }, closed, targets, repaired: 0, shrunk: 0, props, seats };
  repair(sw, blockedGrid);
  rebuildNav(sw);
  cache.set(built, sw);
  return sw;
}

/** Kutu, karo merkezinden geçen ± NAV_R artı şeridine değiyor mu. */
function crossHit(box: Float32Array, k: number, width: number): boolean {
  const i = k % width, j = (k - i) / width;
  const cx = i - HW + 0.5, cz = j - HD + 0.5;
  const a = box[k * 4], b = box[k * 4 + 1], c = box[k * 4 + 2], d = box[k * 4 + 3];
  return (a < cx + NAV_R && c > cx - NAV_R) || (b < cz + NAV_R && d > cz - NAV_R);
}

function setBox(box: Float32Array, k: number, a: number, b: number, c: number, d: number) {
  box[k * 4] = a; box[k * 4 + 1] = b; box[k * 4 + 2] = c; box[k * 4 + 3] = d;
}

/** WALK-SCALE: katı komşuya yaslı kenar parçası bu kalınlıktan inceyse (korkuluk, küpeşte, bordür, direk yüzü) çarpıştırıcıya da
 *  girmez: beden o yana zaten geçemez; fark en çok bu kadar görsel değme. Kalın parça (kule ayağı) çarpıştırıcıda kalır. */
export const EDGE_THIN = 0.15;

/**
 * Kenar parçası katı bir komşuya mı yaslı (WALK-SCALE, WALK-PASS-001); dönüş: yaslandığı kenardan içe kalınlığı (yaslı değilse
 * Infinity). Parça merkez artı şeridinin bir kolunu hiç kesmiyor (karonun bir yarısında ya da köşesinde kalıyor) ve o taraftaki
 * komşu karo engelli ya da ızgara dışı. Böyle parça (köprü korkuluğu, iskele küpeştesi, rıhtım babası, kule ayağının taşan kenarı)
 * yol bulmayı kapatmaz: beden zaten o yana geçemez, merkezden geçen beden (≤ NAV_R) parçaya değmez. Eskiden bir kenar korkuluğu
 * artı şeridinin öteki koluna değdiği için köprü ve iskele karolarının tamamı yol bulmada kapalıydı; iki yanı korkuluklu tek
 * karoluk güvertede birleşim kutusu bütün karoyu kapladığı için avatar da geçemiyordu.
 */
function backedEdge(i: number, j: number, a: number, bz: number, c: number, d: number, width: number, depth: number, blockedGrid: Uint8Array, home: number): number {
  const x0 = i - HW, z0 = j - HD, cx = x0 + 0.5, cz = z0 + 0.5;
  // katı komşu ya da bloğun kendi karosu (komşudan taşan divan/şezlong ucu: o karoya zaten eşyası yüzünden girilmez)
  const solidAt = (ni: number, nj: number) => ni < 0 || nj < 0 || ni >= width || nj >= depth || blockedGrid[nj * width + ni] === 1 || nj * width + ni === home;
  const missV = c <= cx - NAV_R || a >= cx + NAV_R, missH = d <= cz - NAV_R || bz >= cz + NAV_R;
  let t = Infinity;
  if (missV) { const left = c <= cx - NAV_R; if (solidAt(left ? i - 1 : i + 1, j)) t = Math.min(t, left ? c - x0 : x0 + 1 - a); }
  if (missH) { const back = d <= cz - NAV_R; if (solidAt(i, back ? j - 1 : j + 1)) t = Math.min(t, back ? d - z0 : z0 + 1 - bz); }
  return t;
}

/** Bloğun gövde bandındaki xz izdüşümünü dokunduğu karolara (kırpılmış) birleştirir; yol bulma kutusu katı komşuya yaslı kenar
 *  parçalarını içermez (`backedEdge`). */
function addBlock(b: Block, width: number, depth: number, box: Float32Array, hasBox: Uint8Array, blockedGrid: Uint8Array, navBox: Float32Array, hasNav: Uint8Array) {
  if (!SOLID_GROUPS.has(b.g)) return;
  const y0 = b.p[1] - b.s[1] / 2, y1 = b.p[1] + b.s[1] / 2;
  if (y0 >= BODY_HIGH || y1 <= BODY_LOW) return;
  if (b.s[0] * b.s[2] < MIN_BLOCK_AREA && y1 < BODY_HIGH + 0.2) return;
  const minX = b.p[0] - b.s[0] / 2, maxX = b.p[0] + b.s[0] / 2, minZ = b.p[2] - b.s[2] / 2, maxZ = b.p[2] + b.s[2] / 2;
  // dev zemin/çatı plakaları (≥ 6 karo) gövde bandına girse de eşya sayılmaz (yürüyüş yüzeyi, rampa)
  if ((maxX - minX) * (maxZ - minZ) > 36) return;
  const i0 = Math.max(0, tileX(minX + 1e-4)), i1 = Math.min(width - 1, tileX(maxX - 1e-4));
  const hi = tileX(b.p[0]), hj = tileZ(b.p[2]);
  const home = hi >= 0 && hj >= 0 && hi < width && hj < depth ? hj * width + hi : -1;
  const j0 = Math.max(0, tileZ(minZ + 1e-4)), j1 = Math.min(depth - 1, tileZ(maxZ - 1e-4));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x0 = i - HW, z0 = j - HD;
    const a = Math.max(minX, x0), c = Math.min(maxX, x0 + 1), bz = Math.max(minZ, z0), d = Math.min(maxZ, z0 + 1);
    if (c - a < 0.04 || d - bz < 0.04) continue; // komşu karoya yalnız sızan kenar
    const k = j * width + i;
    const edge = backedEdge(i, j, a, bz, c, d, width, depth, blockedGrid, home);
    if (edge <= EDGE_THIN) continue;
    hasBox[k] = 1;
    if (a < box[k * 4]) box[k * 4] = a;
    if (bz < box[k * 4 + 1]) box[k * 4 + 1] = bz;
    if (c > box[k * 4 + 2]) box[k * 4 + 2] = c;
    if (d > box[k * 4 + 3]) box[k * 4 + 3] = d;
    if (edge !== Infinity) continue;
    hasNav[k] = 1;
    if (a < navBox[k * 4]) navBox[k * 4] = a;
    if (bz < navBox[k * 4 + 1]) navBox[k * 4 + 1] = bz;
    if (c > navBox[k * 4 + 2]) navBox[k * 4 + 2] = c;
    if (d > navBox[k * 4 + 3]) navBox[k * 4 + 3] = d;
  }
}

function rebuildNav(sw: StaticWorld) {
  const blocked = new Set<string>();
  for (let k = 0; k < sw.kind.length; k++) if (sw.closed[k]) blocked.add(`${k % sw.width},${Math.floor(k / sw.width)}`);
  sw.nav = { width: sw.width, depth: sw.depth, blocked };
}

/** 4-komşu bileşen etiketleri; `open(k)` yürünebilir karo. */
function label(width: number, depth: number, open: (k: number) => boolean): Int32Array {
  const n = width * depth;
  const labels = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (labels[s] !== -1 || !open(s)) continue;
    let h = 0, t = 0;
    q[t++] = s; labels[s] = next;
    while (h < t) {
      const cur = q[h++];
      const ci = cur % width, cj = (cur - ci) / width;
      for (let d = 0; d < 4; d++) {
        const ni = ci + (d === 0 ? 1 : d === 1 ? -1 : 0), nj = cj + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (ni < 0 || nj < 0 || ni >= width || nj >= depth) continue;
        const nk = nj * width + ni;
        if (labels[nk] !== -1 || !open(nk)) continue;
        labels[nk] = next; q[t++] = nk;
      }
    }
    next++;
  }
  return labels;
}

/** Karo `k` bileşen `lab`'e (kendisi ya da 4 komşusundan biri) bağlı mı. */
function touches(labels: Int32Array, width: number, depth: number, k: number, lab: number): boolean {
  if (labels[k] === lab) return true;
  const i = k % width, j = (k - i) / width;
  return (i + 1 < width && labels[k + 1] === lab) || (i > 0 && labels[k - 1] === lab)
    || (j + 1 < depth && labels[k + width] === lab) || (j > 0 && labels[k - width] === lab);
}

/** En çok hedefe dokunan bileşen. */
function mainLabel(labels: Int32Array, width: number, depth: number, targets: Iterable<number>): number {
  const count = new Map<number, number>();
  for (const k of targets) {
    const i = k % width, j = (k - i) / width;
    const seen = new Set<number>();
    for (const nk of [k, i + 1 < width ? k + 1 : -1, i > 0 ? k - 1 : -1, j + 1 < depth ? k + width : -1, j > 0 ? k - width : -1]) {
      if (nk < 0) continue;
      const l = labels[nk];
      if (l >= 0 && !seen.has(l)) { seen.add(l); count.set(l, (count.get(l) ?? 0) + 1); }
    }
  }
  let best = -1, bc = -1;
  for (const [l, c] of count) if (c > bc || (c === bc && l < best)) { bc = c; best = l; }
  return best;
}

/** Onarımda küçültülen kutunun merkez artı şeridinden uzaklığı: avatar yarıçapından (0,28) büyük → merkezden geçen hiçbir
 *  beden kutuya değmez (ajan 0,24; avatar 0,28). */
export const SHRINK_R = 0.3;
/** Onarım yolu maliyeti: açık karo 1, köşeye küçültülebilen eşya karosu 24, düşürülmesi gereken 64 → önce en az düşürme,
 *  sonra en az açılan eşya, eşitse en kısa yol */
const COST_FREE = 1, COST_SHRINK = 24, COST_DROP = 64;

/**
 * Yol üstündeki kapalı eşya karosunu açar: önce kutuyu karonun bir köşesine (merkez şeridinin ± SHRINK_R dışına) kırpar;
 * kırpılmış parça anlamlıysa (≥ MIN_AREA) çarpıştırıcı korunur (`shrunk`), değilse düşürülür (`repaired`). Yalnız katı bir
 * komşuya (duvar, masa; ızgara kenarı) yaslanan köşe kullanılır: geçidin ortasında kalan köşe kutusu, kaçınma için yana
 * çekilen bedeni sıkıştırırdı (FIX-PHYS canlı ölçüm: uyuyan komşu + köşe kutusu arasında kama) — o zaman düşürülür.
 */
function cornerBox(sw: StaticWorld, k: number, out: number[]): number {
  const { box, width, depth, kind } = sw;
  const i = k % width, j = (k - i) / width;
  const x0 = i - HW, z0 = j - HD, cx = x0 + 0.5, cz = z0 + 0.5;
  const a = box[k * 4], b = box[k * 4 + 1], c = box[k * 4 + 2], d = box[k * 4 + 3];
  const solidAt = (ni: number, nj: number) => ni < 0 || nj < 0 || ni >= width || nj >= depth || kind[nj * width + ni] === SOLID;
  let best = 0;
  for (const [sx, qx0, qx1] of [[-1, x0, cx - SHRINK_R], [1, cx + SHRINK_R, x0 + 1]]) for (const [sz, qz0, qz1] of [[-1, z0, cz - SHRINK_R], [1, cz + SHRINK_R, z0 + 1]]) {
    if (!solidAt(i + sx, j) && !solidAt(i, j + sz)) continue;
    const ia = Math.max(a, qx0), ic = Math.min(c, qx1), ib = Math.max(b, qz0), id = Math.min(d, qz1);
    const area = Math.max(0, ic - ia) * Math.max(0, id - ib);
    if (area > best) { best = area; out[0] = ia; out[1] = ib; out[2] = ic; out[3] = id; }
  }
  return best;
}
const _corner = [0, 0, 0, 0];

function openTile(sw: StaticWorld, k: number) {
  sw.closed[k] = 0;
  if (cornerBox(sw, k, _corner) >= MIN_AREA) { setBox(sw.box, k, _corner[0], _corner[1], _corner[2], _corner[3]); sw.shrunk++; return; }
  if (sw.kind[k] === PROP) sw.props--; else sw.seats--;
  sw.kind[k] = FREE; sw.repaired++;
}

/**
 * Onarım: kaba ızgarada (yalnız engelli karolar) ana bileşene bağlı olan ama ince ızgarada (eşyalar kapalı) kopan her hedef
 * için, hedeften ince ana bileşene en az eşyadan geçen kaba yol (Dijkstra) bulunur ve yalnız o yol üstündeki kapalı eşya
 * karoları açılır (`openTile`: önce köşeye küçült, olmazsa düşür). Açılan cep hemen ana bileşene katılır; aynı cepteki öteki
 * hedefler için ikinci yol açılmaz. Sayaçlar: `sw.repaired` (düşürülen), `sw.shrunk` (küçültülen).
 */
function repair(sw: StaticWorld, blockedGrid: Uint8Array) {
  const { width, depth, kind, closed } = sw;
  const n = width * depth;
  const coarse = label(width, depth, (k) => !blockedGrid[k]);
  const cMain = mainLabel(coarse, width, depth, sw.targets);
  if (cMain < 0) return;
  const dist = new Float64Array(n), prev = new Int32Array(n);
  const heap = new Int32Array(n * 4 + 8), hd = new Float64Array(n * 4 + 8);
  const flood = new Int32Array(n);
  // kapalı eşya karosunun açma maliyeti (köşeye sığıyorsa düşük)
  const cost = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (closed[k] && kind[k] !== SOLID) cost[k] = cornerBox(sw, k, _corner) >= MIN_AREA ? COST_SHRINK : COST_DROP;
  for (let round = 0; round < 8; round++) {
    const fine = label(width, depth, (k) => !closed[k]);
    const fMain = mainLabel(fine, width, depth, sw.targets);
    if (fMain < 0) return;
    let changed = false;
    for (const broken of sw.targets) {
      if (!touches(coarse, width, depth, broken, cMain)) continue; // kaba ızgarada da kopuk: sahne sorunu, bizim değil
      if (touches(fine, width, depth, broken, fMain)) continue;
      // Dijkstra (ikili yığın): hedeften ince ana bileşene ilk değen karoya
      dist.fill(Infinity); prev.fill(-1);
      let hn = 0, hit = -1;
      const push = (k: number, dd: number) => {
        let p = hn++;
        while (p > 0) { const u = (p - 1) >> 1; if (hd[u] <= dd) break; heap[p] = heap[u]; hd[p] = hd[u]; p = u; }
        heap[p] = k; hd[p] = dd;
      };
      const pop = () => {
        const top = heap[0];
        const lk = heap[--hn], ld = hd[hn];
        let p = 0;
        for (;;) {
          let ch = 2 * p + 1;
          if (ch >= hn) break;
          if (ch + 1 < hn && hd[ch + 1] < hd[ch]) ch++;
          if (hd[ch] >= ld) break;
          heap[p] = heap[ch]; hd[p] = hd[ch]; p = ch;
        }
        heap[p] = lk; hd[p] = ld;
        return top;
      };
      dist[broken] = 0; push(broken, 0);
      while (hn > 0) {
        const dcur = hd[0];
        const cur = pop();
        if (dcur > dist[cur]) continue;
        if (cur !== broken && fine[cur] === fMain) { hit = cur; break; }
        const ci = cur % width, cj = (cur - ci) / width;
        for (let dd = 0; dd < 4; dd++) {
          const ni = ci + (dd === 0 ? 1 : dd === 1 ? -1 : 0), nj = cj + (dd === 2 ? 1 : dd === 3 ? -1 : 0);
          if (ni < 0 || nj < 0 || ni >= width || nj >= depth) continue;
          const nk = nj * width + ni;
          if (blockedGrid[nk]) continue;
          const w = !closed[nk] ? COST_FREE : cost[nk];
          const nd = dcur + w;
          if (nd < dist[nk] && hn < heap.length) { dist[nk] = nd; prev[nk] = cur; push(nk, nd); }
        }
      }
      if (hit < 0) continue;
      let opened = 0;
      for (let k = prev[hit]; k >= 0 && k !== broken; k = prev[k]) if (closed[k]) { openTile(sw, k); opened++; }
      // hedefin kendisi süs eşyasıysa (oturak değil) ve kapalıysa o da açılır
      if (kind[broken] === PROP && closed[broken]) { openTile(sw, broken); opened++; }
      if (!opened) continue;
      changed = true;
      // açılan yol ve ardındaki cep ana bileşene katılır (aynı round'da aynı cep için ikinci yol açılmaz)
      let fh = 0, ft = 0;
      for (let k = hit; k >= 0; k = prev[k]) if (!closed[k] && fine[k] !== fMain) { fine[k] = fMain; flood[ft++] = k; }
      while (fh < ft) {
        const cur = flood[fh++];
        const ci = cur % width, cj = (cur - ci) / width;
        for (let dd = 0; dd < 4; dd++) {
          const ni = ci + (dd === 0 ? 1 : dd === 1 ? -1 : 0), nj = cj + (dd === 2 ? 1 : dd === 3 ? -1 : 0);
          if (ni < 0 || nj < 0 || ni >= width || nj >= depth) continue;
          const nk = nj * width + ni;
          if (closed[nk] || fine[nk] === fMain) continue;
          fine[nk] = fMain; flood[ft++] = nk;
        }
      }
    }
    if (!changed) return;
  }
}

// ------------------------------------------------------------------------------------------ sorgular
/** Karo `k` bu beden için katı mı (izinli hedef / çıkış karosu muaf). */
export function solidFor(sw: StaticWorld, k: number, allowA: number, allowB: number, propsOnly = false): boolean {
  const kd = sw.kind[k];
  if (kd === FREE || (propsOnly && kd === SOLID)) return false;
  if (kd !== SOLID && (k === allowA || k === allowB)) return false;
  return true;
}

/** WALK-PHYS: bu çağrıda yok sayılacak eşya karoları (avatarın üstüne çıkabildiği bank, sandık); null → hiçbiri. Çağıran
 *  kare başına yeni işlev üretmez: tek bir kapanış `skipProps.fn` ile kurulur ve sıfırlanır. */
export const skipProps: { fn: ((k: number) => boolean) | null } = { fn: null };

export interface Push { x: number; z: number; pen: number }
const _push: Push = { x: 0, z: 0, pen: 0 };

/**
 * Dairenin statik dünyaya en büyük batması ve onu gideren itme (en derin kutuya göre; çağıran yineler).
 * Izgara dışı karolar tam katı kutudur. Dönen nesne paylaşılır (kare başına nesne üretmez).
 */
export function staticPush(sw: StaticWorld, x: number, z: number, r: number, allowA = -1, allowB = -1, propsOnly = false): Push {
  _push.x = 0; _push.z = 0; _push.pen = 0;
  const i0 = tileX(x - r), i1 = tileX(x + r), j0 = tileZ(z - r), j1 = tileZ(z + r);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    let a: number, b: number, c: number, d: number;
    if (i < 0 || j < 0 || i >= sw.width || j >= sw.depth) { if (propsOnly) continue; a = i - HW; b = j - HD; c = a + 1; d = b + 1; }
    else {
      const k = j * sw.width + i;
      if (!solidFor(sw, k, allowA, allowB, propsOnly)) continue;
      if (skipProps.fn && sw.kind[k] !== SOLID && skipProps.fn(k)) continue;
      a = sw.box[k * 4]; b = sw.box[k * 4 + 1]; c = sw.box[k * 4 + 2]; d = sw.box[k * 4 + 3];
    }
    circleBox(x, z, r, a, b, c, d);
  }
  return _push;
}

/** daire–kutu: batma `_push`'takinden büyükse itmeyi yazar */
function circleBox(x: number, z: number, r: number, a: number, b: number, c: number, d: number) {
  const inside = x > a && x < c && z > b && z < d;
  let nx: number, nz: number, pen: number;
  if (inside) {
    // merkez kutunun içinde: en kısa çıkış ekseni
    const l = x - a, rr = c - x, t = z - b, bt = d - z;
    const m = Math.min(l, rr, t, bt);
    if (m === l) { nx = -1; nz = 0; } else if (m === rr) { nx = 1; nz = 0; } else if (m === t) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
    pen = m + r;
  } else {
    const cx = x < a ? a : x > c ? c : x, cz = z < b ? b : z > d ? d : z;
    const dx = x - cx, dz = z - cz;
    const dist = Math.hypot(dx, dz);
    if (dist >= r) return;
    if (dist < 1e-9) { nx = 1; nz = 0; } else { nx = dx / dist; nz = dz / dist; }
    pen = r - dist;
  }
  if (pen > _push.pen) { _push.pen = pen; _push.x = nx * pen; _push.z = nz * pen; }
}

/** Daireyi statik dünyadan dışarı çıkarır (en çok `iters` itme). Dönüş: kalan batma. */
export function resolveStatic(sw: StaticWorld, p: { x: number; z: number }, r: number, allowA = -1, allowB = -1, iters = 4, propsOnly = false): number {
  for (let k = 0; k < iters; k++) {
    const s = staticPush(sw, p.x, p.z, r, allowA, allowB, propsOnly);
    if (s.pen <= 1e-5) return 0;
    p.x += s.x * 1.001; p.z += s.z * 1.001;
  }
  return staticPush(sw, p.x, p.z, r, allowA, allowB, propsOnly).pen;
}

/** Nokta bir çarpıştırıcının içinde mi (hayvanlar, yerleştirme). */
export function pointBlocked(sw: StaticWorld, x: number, z: number, r = 0): boolean {
  return staticPush(sw, x, z, Math.max(r, 1e-3)).pen > 1e-4;
}

/** Ince (eşya dahil) bileşen etiketleri — walk_check ve testler için. */
export function fineLabels(sw: StaticWorld): { labels: Int32Array; main: number } {
  const labels = label(sw.width, sw.depth, (k) => !sw.closed[k]);
  return { labels, main: mainLabel(labels, sw.width, sw.depth, sw.targets) };
}

/** Hedef karo `t` ince ana bileşene bağlı mı (karonun kendisi ya da 4 komşusu). */
export function reachableFine(sw: StaticWorld, t: Tile, fl = fineLabels(sw)): boolean {
  const [i, j] = t;
  if (i < 0 || j < 0 || i >= sw.width || j >= sw.depth || fl.main < 0) return false;
  return touches(fl.labels, sw.width, sw.depth, j * sw.width + i, fl.main);
}

// ------------------------------------------------------------------------------------------ EXP (E1b): çevre ızgarası
/**
 * Çevre (outskirts) çarpışma ızgarası: yapılı ızgaranın DIŞINDAKİ yüklü yakın parseller.
 * Parsel başına 12 × 16 karo türü (FREE / SOLID; üreteçteki `near.solid` ile aynı değerler) ve karo başına bir AABB (dünya).
 * Yalnız yürüme modunda avatarın yakın halkası (3 × 3 + histerezis) tutulur; yüklenmemiş parsel katıdır (giriş yok, boşluğa
 * düşme yok). Ajanlar ve öteki bedenler bu ızgarayı görmez: onlar için ızgara dışı her zaman katıdır (ajan yapılı dünyada kalır).
 * Karo (i, j) dünya ızgarasıdır (`tileX/tileZ`); parsel (cx, cz) taban çerçevesindedir, köken (oi, oj) = taban ötelemesi.
*/
export interface OuterParcel {
  cx: number;
  cz: number;
  /** FREE / SOLID (j · pw + i) */
  kind: Uint8Array;
  /** karo başına [minX, minZ, maxX, maxZ] (dünya); FREE'de anlamsız */
  box: Float32Array;
  /** WALK-PHYS (isteğe bağlı): karo üst yüzü (dünya y). FREE: zemin; SOLID: tırmanılabilirse üst yüz, değilse NaN */
  top?: Float32Array;
}

export interface OuterGrid {
  pw: number;
  pd: number;
  /** taban ötelemesi (karo): dünya karosu i = taban karosu I + oi */
  oi: number;
  oj: number;
  parcels: Map<number, OuterParcel>;
}

const okey = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);

export function outerGrid(pw: number, pd: number, origin: readonly [number, number]): OuterGrid {
  return { pw, pd, oi: origin[0], oj: origin[1], parcels: new Map() };
}

/** Yakın parselleri ızgaraya yazar (öncekiler silinir). `solid`/`box` üreteç çıktısı (taban çerçevesi) → dünya. */
export function setOuterParcels(og: OuterGrid, list: Iterable<{ cx: number; cz: number; solid: Uint8Array; box: Float32Array; top?: Float32Array }>): void {
  og.parcels.clear();
  for (const p of list) {
    const box = new Float32Array(p.box.length);
    for (let k = 0; k < box.length; k += 4) {
      box[k] = p.box[k] + og.oi; box[k + 1] = p.box[k + 1] + og.oj; box[k + 2] = p.box[k + 2] + og.oi; box[k + 3] = p.box[k + 3] + og.oj;
    }
    og.parcels.set(okey(p.cx, p.cz), { cx: p.cx, cz: p.cz, kind: p.solid, box, ...(p.top ? { top: p.top } : {}) });
  }
}

/** WALK-PHYS: dünya karosunun çevre üst yüzü (`OuterParcel.top`); parsel yüklü değilse ya da veri yoksa NaN. */
export function outerTop(og: OuterGrid, i: number, j: number): number {
  const I = i - og.oi, J = j - og.oj;
  const cx = Math.floor(I / og.pw), cz = Math.floor(J / og.pd);
  const p = og.parcels.get(okey(cx, cz));
  if (!p?.top) return NaN;
  return p.top[(J - cz * og.pd) * og.pw + (I - cx * og.pw)];
}

/** Dünya karosunun çevre türü: −1 = parsel yüklü değil (katı say), FREE ya da SOLID. */
export function outerKind(og: OuterGrid, i: number, j: number): number {
  const I = i - og.oi, J = j - og.oj;
  const cx = Math.floor(I / og.pw), cz = Math.floor(J / og.pd);
  const p = og.parcels.get(okey(cx, cz));
  if (!p) return -1;
  return p.kind[(J - cz * og.pd) * og.pw + (I - cx * og.pw)];
}

/** Dairenin çevre ızgarasındaki en büyük batması (SOLID karonun AABB'si; yüklenmemiş karo tam katı). Yalnız ızgara dışı karolar. */
export function outerPush(og: OuterGrid, sw: Pick<StaticWorld, "width" | "depth">, x: number, z: number, r: number): Push {
  _push.x = 0; _push.z = 0; _push.pen = 0;
  const i0 = tileX(x - r), i1 = tileX(x + r), j0 = tileZ(z - r), j1 = tileZ(z + r);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (i >= 0 && j >= 0 && i < sw.width && j < sw.depth) continue;
    const kd = outerKind(og, i, j);
    if (kd === FREE) continue;
    let a = i - HW, b = j - HD, c = a + 1, d = b + 1;
    if (kd === SOLID) {
      const I = i - og.oi, J = j - og.oj, cx = Math.floor(I / og.pw), cz = Math.floor(J / og.pd);
      const p = og.parcels.get(okey(cx, cz))!, k = ((J - cz * og.pd) * og.pw + (I - cx * og.pw)) * 4;
      a = p.box[k]; b = p.box[k + 1]; c = p.box[k + 2]; d = p.box[k + 3];
    }
    circleBox(x, z, r, a, b, c, d);
  }
  return _push;
}

export { registerWalkArea, unregisterWalkArea, walkAreas, areaAt, heightField, type WalkArea, type HeightField } from "./height";
