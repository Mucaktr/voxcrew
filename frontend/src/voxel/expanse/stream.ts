/**
 * EXP-STREAM (E1b) — çevre akışı: halkalar, histerezis, LRU ve kuyruk yuvası ayırıcısı (
 * "E0 sonuçları" ve "E1b'nin ihtiyacı"). Saf TypeScript; React/three yok. Çizimi `tail.ts` (kuyruk yazıcısı), çarpışmayı
 * `physics/world.ts` (çevre ızgarası) yapar; bu dosya yalnız "hangi parsel hangi yuvada" kararını verir.
 *
 * - **Halkalar:** avatarın parseli (taban çerçevesi) ± `near` (1 → 3 × 3) tam ayrıntı + çarpışma; ± `far` (3 → 7 × 7, mobilde 2 → 5 × 5)
 * yalnız uzak LOD (zemin + silüet). Yalnız `parcelState === "open"` parseller (kutu içi, yarıçap dışı, bastırılmış hariç).
 * - **Histerezis:** yakın parsel `near + hold`, uzak parsel `far + hold` uzaklığı aşınca bırakılır (sınırda titreme yok).
 * - **LRU:** en çok `cache` (64) parselin üretim çıktısı (`ParcelOut`, iki LOD birden) tutulur; geri dönüşte yeniden üretilmez.
 * - **Bütçe:** güncelleme başına ≤ `genPerUpdate` (1) üretim ve ≤ `writesPerUpdate` (6) yuva yazımı; öncelik önce yakın halka,
 * sonra uzak, her birinde uzaklık → cz → cx (belirlenimci).
 * - **Yuvalar** (E0 kuralı 1): iki sınıf, parsel başına ardışık blok. Yakın `solid 96 · water 16 · glass 8 · glow 8`, uzak
 * `solid 32 · water 8 · glass 4 · glow 4`; 16 yakın + 56 uzak yuva (histerezis payıyla). Kuyruk düzeni grup başına
 * `[yakın yuvalar][uzak yuvalar]`; boşalan yuva sıfır ölçekle gizlenir, en küçük boş yuva önce verilir (kuyruk ucu kısa kalır).
 * - Yalnız durağan gruplar (`solid/water/glass/glow`; canlı gruplar kuyruk almaz, plan §14.3 R2). Yuvaya sığmayan blok
 * `overflow` sayılır (denetim 0 ister: `expanse_check` EXP-STREAM-001).
 *
 * Aynı bağlam + aynı konum dizisi → aynı yazım dizisi (EXP-DET-001'in akış hâli).
 *
 * ( "Akış"): yuva mantığı `SlotStream` çekirdeğindedir ve bir **parsel kaynağına**
 * (`ParcelSource`: hangi parsel açık, nasıl üretilir, taban → dünya) ve bir **yuva düzenine** (`SlotLayout`) bağlıdır.
 * `ExpanseStream` = çevre kaynağı + varsayılan düzen (davranış değişmedi). Şehir haritası (`citymap/source.ts`) semt ölçeğinde
 * (semt ≈ 48 × 48 karo = 4 × 3 parsel) aynı çekirdeği `CITY_LAYOUT` ile kullanır: daha az ama daha büyük yakın yuva (landmark ve
 * bina yoğunluğu), uzak halka 2. Her iki düzen de aynı kuyruk kapasitesine (`TAIL_CAP`) sığar → +0 çizim çağrısı.
*/
import { D, W, type Block, type Group } from "../scenes";
import { parcelState, toWorld, type ExpanseContext } from "./context";
import { generateParcel, type ParcelOut, type PlotDecor } from "./generate";
import { PD, pkey, PW } from "./grid";
import { drawnBlocks } from "../zfight";
import { registerWaterAnchors, waterAnchorEpoch } from "../waterAnchors";

export const TAIL_GROUPS = ["solid", "water", "glass", "glow"] as const;
export type TailGroup = (typeof TAIL_GROUPS)[number];
export type SlotClass = "near" | "far";

/** Yuva boyu (örnek) — sınıf × grup (E0 kuralı 1; üreteç bütçesi yakın ≤ 90, uzak ≤ 30, parıltı ≤ 8). */
export const SLOT_SIZE: Readonly<Record<SlotClass, Readonly<Record<TailGroup, number>>>> = {
  near: { solid: 96, water: 16, glass: 8, glow: 8 },
  far: { solid: 32, water: 8, glass: 4, glow: 4 },
};
/** Yuva sayısı: 3 × 3 yakın + histerezis payı; 7 × 7 uzak − yakın + histerezis payı. */
export const SLOT_COUNT: Readonly<Record<SlotClass, number>> = { near: 16, far: 56 };
/** Grup başına kuyruk kapasitesi (Blocks.tsx mesh kapasitesi = taban + bu). */
export const TAIL_CAP: Readonly<Record<TailGroup, number>> = Object.fromEntries(
  TAIL_GROUPS.map((g) => [g, SLOT_COUNT.near * SLOT_SIZE.near[g] + SLOT_COUNT.far * SLOT_SIZE.far[g]]),
) as Record<TailGroup, number>;
export const isTailGroup = (g: Group): g is TailGroup => (TAIL_GROUPS as readonly Group[]).includes(g);

/** yuva düzeni — sınıf × grup yuva boyu ve sınıf başına yuva sayısı. Toplamı grup başına `TAIL_CAP`'i aşamaz.*/
export interface SlotLayout {
  size: Readonly<Record<SlotClass, Readonly<Record<TailGroup, number>>>>;
  count: Readonly<Record<SlotClass, number>>;
}
/** Çevre arazisinin (E1b) düzeni. */
export const DEFAULT_LAYOUT: SlotLayout = { size: SLOT_SIZE, count: SLOT_COUNT };
/**
 * şehir haritası düzeni: 12 yakın yuva (3 × 3 + histerezis payı) × solid 192 / su 24 / cam 12 / parıltı 12; 24 uzak yuva
 * (uzak halka 2 → 5 × 5 − 9 + pay) × 40 / 8 / 4 / 4. Toplam solid 3264, su 480, cam 240, parıltı 240 ≤ `TAIL_CAP`; kalan uç
 * (`layoutEnd` → `TAIL_CAP`) şehirde aracın yuvası (`transit` yolculuk sahnesi; CityRig).
*/
export const CITY_LAYOUT: SlotLayout = {
  size: { near: { solid: 192, water: 24, glass: 12, glow: 12 }, far: { solid: 40, water: 8, glass: 4, glow: 4 } },
  // TOUR-VIEW: öne kayan halka (`update(…, lead)`) aynı yuvalara sığar — düz yürüyüşte yakın 3 × 3 ∪ öndeki 3 × 3 = 12, uzak
  // 5 × 5 ∪ öndeki 5 × 5 − yakın = 18 ≤ 24; çaprazda en uzak iki yakın köşe bekler (uzak LOD + silüet görünür). TAIL_CAP değişmez.
  count: { near: 12, far: 24 },
};

/** Düzenin grup başına kapladığı kuyruk (örnek). */
export const layoutEnd = (L: SlotLayout, g: TailGroup) => L.count.near * L.size.near[g] + L.count.far * L.size.far[g];

/** Yuvanın grup kuyruğundaki başlangıcı (örnek dizini, taban sonrası) — verilen düzende. */
export function slotOffsetIn(L: SlotLayout, cls: SlotClass, slot: number, g: TailGroup): number {
  return cls === "near" ? slot * L.size.near[g] : L.count.near * L.size.near[g] + slot * L.size.far[g];
}
/** Kullanılan kuyruğun sonu — verilen düzende. */
export function tailEndIn(L: SlotLayout, high: Readonly<Record<SlotClass, number>>, g: TailGroup): number {
  return high.far > 0 ? L.count.near * L.size.near[g] + high.far * L.size.far[g] : high.near * L.size.near[g];
}

/** Yuvanın grup kuyruğundaki başlangıcı (örnek dizini, taban sonrası). */
export function slotOffset(cls: SlotClass, slot: number, g: TailGroup): number {
  return slotOffsetIn(DEFAULT_LAYOUT, cls, slot, g);
}

/** Kullanılan kuyruğun sonu (mesh.count = taban + bu). `high` = sınıf başına en yüksek dolu yuva + 1 (0: boş). */
export function tailEnd(high: Readonly<Record<SlotClass, number>>, g: TailGroup): number {
  return tailEndIn(DEFAULT_LAYOUT, high, g);
}

export interface StreamOptions {
  /** yakın halka yarıçapı (parsel) */
  near?: number;
  /** uzak halka yarıçapı (mobilde 2) */
  far?: number;
  /** histerezis (parsel) */
  hold?: number;
  /** LRU üretim önbelleği (parsel) */
  cache?: number;
  genPerUpdate?: number;
  writesPerUpdate?: number;
  /** E2: sahiplenilmiş parseller (taban çerçevesi anahtarı → donatı); yabani üretimin yerine düzleştirilmiş parsel çizilir */
  plots?: ReadonlyMap<string, PlotDecor>;
}
const NO_PLOTS: ReadonlyMap<string, PlotDecor> = new Map();
export const STREAM_DEFAULTS: Required<StreamOptions> = { near: 1, far: 3, hold: 1, cache: 64, genPerUpdate: 1, writesPerUpdate: 6, plots: NO_PLOTS };

/** Bir yuva yazımı: `groups` null → yuvayı boşalt (sıfır ölçek). Bloklar dünya çerçevesinde, yuva boyuna kırpılmış. */
export interface SlotWrite {
  cls: SlotClass;
  slot: number;
  key: string;
  groups: Record<TailGroup, Block[]> | null;
}

/** akışın parsel çıktısı (yalnız çizim alanları): yakın ayrıntı (yoksa null) ve uzak LOD blokları (taban çerçevesi).*/
export interface StreamParcel { near: { blocks: Block[] } | null; far: { blocks: Block[] } }

/** parsel kaynağı — hangi parsel açık, nasıl üretilir, taban çerçevesinden dünyaya.*/
export interface ParcelSource<P extends StreamParcel> {
  /** taban karosunun dünya ızgarasındaki ötelemesi (di, dj) */
  readonly origin: readonly [number, number];
  /** parsel akışa açık mı (yalnız açık parseller istenir) */
  open(cx: number, cz: number): boolean;
  /** parseli üretir (null: üretilemedi) */
  generate(cx: number, cz: number, key: string): P | null;
  /** taban çerçevesi → dünya (yeni dizi) */
  toWorld(blocks: readonly Block[]): Block[];
}

interface Loaded<P> { key: string; cx: number; cz: number; cls: SlotClass; slot: number; p: P }

const DIST = (a: { cx: number; cz: number }, cx: number, cz: number) => Math.max(Math.abs(a.cx - cx), Math.abs(a.cz - cz));

/**
 * Yuva akışı çekirdeği (E1b; ile kaynak ve düzenden bağımsız). Halkalar, histerezis, LRU, güncelleme bütçesi ve yuva
 * ayırıcısı — davranış ExpanseStream'in E1b hâliyle aynı (EXP-STREAM-001), yuva boyu ve sayısı `layout` ile.
*/
export class SlotStream<P extends StreamParcel> {
  readonly source: ParcelSource<P>;
  readonly layout: SlotLayout;
  readonly opt: Required<StreamOptions>;
  private cache = new Map<string, P>();
  private loaded = new Map<string, Loaded<P>>();
  private free: Record<SlotClass, number[]>;
  /** avatarın parseli (taban çerçevesi); ilk güncellemeden önce null */
  center: [number, number] | null = null;
  /** TOUR-VIEW: öndeki noktanın parseli (avatarınkinden farklıysa; yoksa null) */
  lead: [number, number] | null = null;
  /** istenip henüz yüklenemeyen parsel sayısı (bütçe/yuva) */
  pending = 0;
  /** PORTAL-ARRIVAL-COMPLETE-001: bunlardan yakın halkada olup yalnız bütçe yüzünden bekleyenler (yuva yoksa sayılmaz) */
  pendingNear = 0;
  /** yakın sınıf kümesi her değiştiğinde artar (çarpışma ızgarası yeniden kurulur) */
  nearVersion = 0;
  readonly stats = { generated: 0, hits: 0, writes: 0, releases: 0, overflow: 0, evicted: 0 };

  constructor(source: ParcelSource<P>, opts: StreamOptions = {}, layout: SlotLayout = DEFAULT_LAYOUT) {
    this.source = source;
    this.layout = layout;
    this.opt = { ...STREAM_DEFAULTS, ...opts };
    this.free = { near: range(layout.count.near), far: range(layout.count.far) };
  }

  /** Dünya (x, z) → taban çerçevesinde parsel (cx, cz). */
  parcelAt(x: number, z: number): [number, number] {
    const I = Math.floor(x + W / 2) - this.source.origin[0], J = Math.floor(z + D / 2) - this.source.origin[1];
    return [Math.floor(I / PW), Math.floor(J / PD)];
  }

  /** Yüklü parsel sayısı (sınıf başına). */
  counts(): Record<SlotClass, number> {
    const out = { near: 0, far: 0 };
    for (const l of this.loaded.values()) out[l.cls]++;
    return out;
  }

  /** Sınıf başına en yüksek dolu yuva + 1. */
  high(): Record<SlotClass, number> {
    const out = { near: 0, far: 0 };
    for (const l of this.loaded.values()) out[l.cls] = Math.max(out[l.cls], l.slot + 1);
    return out;
  }

  /** E3: parsel yüklü mü (yakın ya da uzak yuvada) — inşa yalnız yüklü parselde çizilir. */
  loadedClass(key: string): SlotClass | null {
    return this.loaded.get(key)?.cls ?? null;
  }

  /** E3: yüklü parselin üretim çıktısı (arazi yürünebilirliği; yoksa önbellek). */
  parcel(key: string): P | null {
    return this.loaded.get(key)?.p ?? this.cache.get(key) ?? null;
  }

  /** Yakın sınıftaki parseller (çarpışma ızgarası ve yürünebilirlik). */
  nearParcels(): P[] {
    const out: P[] = [];
    for (const l of this.loaded.values()) if (l.cls === "near") out.push(l.p);
    return out;
  }

  /** yüklü parseller (anahtar, sınıf, çıktı).*/
  loadedList(): { key: string; cls: SlotClass; p: P }[] {
    return [...this.loaded.values()].map((l) => ({ key: l.key, cls: l.cls, p: l.p }));
  }

  /** Yüklü bütün parsellerin yuva yazımları (kuyruk mesh'i yeniden kurulunca hepsi yeniden yazılır). */
  rewriteAll(): SlotWrite[] {
    return [...this.loaded.values()].map((l) => this.writeOf(l));
  }

  /** Bütün yuvaları boşalt (yürüme modundan çıkış, dünya değişimi). */
  clear(): SlotWrite[] {
    const out: SlotWrite[] = [];
    for (const l of [...this.loaded.values()]) out.push(this.release(l));
    this.center = null;
    this.pending = 0; this.pendingNear = 0;
    return out;
  }

  /**
   * Bir kare: avatar dünya konumuna göre yükle/bırak. Dönüş: uygulanacak yuva yazımları (sıralı).
   * TOUR-VIEW: `lead` (dünya x, z; isteğe bağlı) yürüyüş yönünde avatarın önündeki nokta — halkalar avatarın ve bu noktanın
   * çevresinin BİRLEŞİMİDİR (öne doğru ön yükleme: yeni parsel en az bir parsel daha uzakta belirir); bırakma ikisine de uzaklıkla.
   * `lead` yoksa ya da avatarla aynı parseldeyse davranış E1b ile birebir aynı (EXP-STREAM-001, CITY-MAP-STREAM-001).
   * `focus` (dünya x, z; dürbün/manzara hedefi) — yakın halka hedefin çevresine kayar; avatarın yalnız kendi parseli
   * yakın kalır (çarpışma), komşuları uzağa iner. Uzak halka ikisinin birleşimi. `lead` yok sayılır (manzara kipinde avatar durur).
*/
  update(x: number, z: number, budget: { gen?: number; writes?: number } = {}, lead: readonly [number, number] | null = null, focus: readonly [number, number] | null = null): SlotWrite[] {
    const { near, far, hold } = this.opt;
    // su kaynağı dönemi değiştiyse (WaterFx yeniden kuruldu: iç mekândan çıkış) yüklü parsellerin çeşme/şelaleleri
    // yeniden kaydedilir — yazım önbelleği (`drawn`) yüzünden `drawnBlocks` bir daha çağrılmıyordu
    if (this.waterEpoch !== waterAnchorEpoch()) {
      this.waterEpoch = waterAnchorEpoch();
      for (const l of this.loaded.values()) { const d = this.drawn.get(l.cls === "near" ? l.p.near?.blocks ?? [] : l.p.far.blocks); if (d) registerWaterAnchors(d); }
    }
    let gen = budget.gen ?? this.opt.genPerUpdate, writes = budget.writes ?? this.opt.writesPerUpdate;
    const [cx, cz] = this.parcelAt(x, z);
    this.center = [cx, cz];
    const F = focus ? this.parcelAt(focus[0], focus[1]) : null;
    const L = F ? F : lead ? this.parcelAt(lead[0], lead[1]) : null;
    const ahead = !!L && (L[0] !== cx || L[1] !== cz);
    this.lead = ahead ? L : null;
    /** avatarın ya da öndeki noktanın parseline Chebyshev uzaklığının küçüğü */
    const reach = (p: { cx: number; cz: number }) => (ahead ? Math.min(DIST(p, cx, cz), DIST(p, L![0], L![1])) : DIST(p, cx, cz));
    /** yakın sınıfı için uzaklık: odakta hedefe (avatarın kendi parseli 0) */
    const nearReach = (p: { cx: number; cz: number }) => (F ? Math.min(DIST(p, F[0], F[1]), DIST(p, cx, cz) === 0 ? 0 : Infinity) : reach(p));
    const out: SlotWrite[] = [];
    let nearChanged = false;

    // 1. bırak / yakından uzağa indir (histerezis)
    const demoted: Loaded<P>[] = [];
    for (const l of [...this.loaded.values()]) {
      const d = reach(l);
      if (d > far + hold) { out.push(this.release(l)); if (l.cls === "near") nearChanged = true; }
      else if (l.cls === "near" && nearReach(l) > near + hold) { out.push(this.release(l)); demoted.push(l); nearChanged = true; }
    }

    // 2. istenen parseller: yakın halka, sonra uzak; avatara uzaklık → cz → cx (öndeki halka da avatara uzaklıkla sıralanır)
    const want: { key: string; cx: number; cz: number; cls: SlotClass; d: number }[] = [];
    const seen = new Set<string>();
    const rings: [number, number][] = ahead ? [[cx, cz], [L![0], L![1]]] : [[cx, cz]];
    for (const [ox, oz] of rings) for (let dz = -far; dz <= far; dz++) for (let dx = -far; dx <= far; dx++) {
      const px = ox + dx, pz = oz + dz, key = pkey(px, pz);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!this.source.open(px, pz)) continue;
      const q = { cx: px, cz: pz };
      want.push({ key, cx: px, cz: pz, cls: nearReach(q) <= near ? "near" : "far", d: F ? reach(q) : DIST(q, cx, cz) });
    }
    want.sort((a, b) => (a.cls === b.cls ? 0 : a.cls === "near" ? -1 : 1) || a.d - b.d || a.cz - b.cz || a.cx - b.cx);
    const wanted = new Map(want.map((w) => [w.key, w.cls]));
    // indirilenler (yakın tutma payının dışında, uzak payının içinde) uzak yuvaya — istenen uzaklar arasına uzaklığıyla girer
    const kept = new Map<string, P>();
    for (const l of demoted) {
      kept.set(l.key, l.p);
      if (!wanted.has(l.key)) want.push({ key: l.key, cx: l.cx, cz: l.cz, cls: "far", d: DIST(l, cx, cz) });
    }

    // 3. yükle / yükselt
    this.pending = 0; this.pendingNear = 0;
    for (const w of want) {
      const l = this.loaded.get(w.key);
      if (l && (l.cls === w.cls || l.cls === "near")) continue; // aynı sınıf ya da yakın tutma payında (histerezis)
      if (writes <= 0) { this.pending++; if (w.cls === "near") this.pendingNear++; continue; }
      let p: P | null = l?.p ?? kept.get(w.key) ?? this.cached(w.key);
      if (!p) {
        if (gen <= 0) { this.pending++; if (w.cls === "near") this.pendingNear++; continue; }
        gen--;
        p = this.source.generate(w.cx, w.cz, w.key);
        this.stats.generated++;
        if (!p) continue;
        this.remember(w.key, p);
      }
      const slot = this.alloc(w.cls, cx, cz, wanted, out);
      if (slot < 0) { this.pending++; continue; }
      if (l) out.push(this.release(l)); // uzaktan yakına yükselme: eski uzak yuvası boşalır
      const nl: Loaded<P> = { key: w.key, cx: w.cx, cz: w.cz, cls: w.cls, slot, p };
      this.loaded.set(w.key, nl);
      out.push(this.writeOf(nl));
      writes--;
      if (w.cls === "near") nearChanged = true;
    }
    if (nearChanged) this.nearVersion++;
    return out;
  }

  // ------------------------------------------------------------------------------------------ iç
  private cached(key: string): P | null {
    const p = this.cache.get(key);
    if (!p) return null;
    this.cache.delete(key); this.cache.set(key, p); // LRU: en sona
    this.stats.hits++;
    return p;
  }

  private remember(key: string, p: P) {
    this.cache.set(key, p);
    while (this.cache.size > this.opt.cache) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
      this.stats.evicted++;
    }
  }

  /** Boş yuva; yoksa o sınıfta istenmeyen (histerezis payında tutulan) en uzak parsel boşaltılır. */
  private alloc(cls: SlotClass, cx: number, cz: number, wanted: Map<string, SlotClass>, out: SlotWrite[]): number {
    if (!this.free[cls].length) {
      let victim: Loaded<P> | null = null, vd = -1;
      for (const l of this.loaded.values()) {
        if (l.cls !== cls || wanted.get(l.key) === cls) continue;
        const d = DIST(l, cx, cz);
        if (d > vd || (d === vd && victim && l.key < victim.key)) { vd = d; victim = l; }
      }
      if (!victim) return -1;
      out.push(this.release(victim));
    }
    return this.free[cls].shift()!;
  }

  private release(l: Loaded<P>): SlotWrite {
    this.loaded.delete(l.key);
    const list = this.free[l.cls];
    let k = 0;
    while (k < list.length && list[k] < l.slot) k++;
    list.splice(k, 0, l.slot);
    this.stats.releases++;
    return { cls: l.cls, slot: l.slot, key: l.key, groups: null };
  }

  private readonly drawn = new WeakMap<readonly Block[], Block[]>();
  private waterEpoch = -1;

  private writeOf(l: Loaded<P>): SlotWrite {
    const src = l.cls === "near" ? l.p.near?.blocks ?? [] : l.p.far.blocks;
    const groups = { solid: [], water: [], glass: [], glow: [] } as Record<TailGroup, Block[]>;
    // parselin çizilen blokları z-fighting'den arındırılır (parsel listesi başına bir kez, önbellekli)
    let drawn = this.drawn.get(src);
    if (!drawn) { drawn = drawnBlocks(this.source.toWorld(src)); this.drawn.set(src, drawn); }
    for (const b of drawn) {
      if (!isTailGroup(b.g)) { this.stats.overflow++; continue; }
      const list = groups[b.g];
      if (list.length >= this.layout.size[l.cls][b.g]) { this.stats.overflow++; continue; }
      list.push(b);
    }
    this.stats.writes++;
    return { cls: l.cls, slot: l.slot, key: l.key, groups };
  }
}

/** E1b çevre akışı: çevre bağlamı kaynağı + varsayılan düzen (genel API değişmedi). */
export class ExpanseStream extends SlotStream<ParcelOut> {
  readonly ctx: ExpanseContext;

  constructor(ctx: ExpanseContext, opts: StreamOptions = {}) {
    const plots = opts.plots ?? NO_PLOTS;
    super({
      origin: ctx.origin,
      open: (cx, cz) => parcelState(ctx, cx, cz) === "open",
      generate: (cx, cz, key) => generateParcel(ctx, cx, cz, "both", plots.get(key) ?? null),
      toWorld: (blocks) => toWorld(blocks, ctx),
    }, opts, DEFAULT_LAYOUT);
    this.ctx = ctx;
  }
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, k) => k);
}
