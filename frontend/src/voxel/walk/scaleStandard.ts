/**
 * yürüme modu ölçek standardı, tek kaynak.
 * Saf veri + saf yardımcılar: React/three yok, ürün kodu bu modülü henüz çağırmaz. Denetim: `scripts/scale_check.mjs`
 * (WALK-SCALE-003 eşya/hayvan/harita taşıtı, LANDMARK-SCALE-001 simge eğrisi ve şehir içi sıra).
 *
 * Birim: yürüme insanı = 1,0 (`walk/scale.ts` WALK_HUMAN_H). Bütün aralıklar "× insan".
 *
 * Bağlam (lider kararı K1, 2026-10-27):
 * - `city` (şehir haritası): gerçek ölçek. Her aralık doğrudan × yürüme insanı.
 * - `scene` (25 sahne tabanı): sokak mobilyası chibi kalır. `sceneChibi` işaretli ölçüler chibi insana (1,55) göre
 * değerlendirilir. Bank sırtı K1 istisnasıdır: sahnede de gerçek aralık (0,5–0,6) → incelecek tek mobilya.
 * Yapı (lamba, ağaç, kiosk, kat, kapı) iki bağlamda da gerçek ölçektedir.
 *
 * Simge eğrisi (K2, şehir başına): r = gerçek yükseklik / 1,75 m; H = r (r ≤ 6), H = 6 + 4,2 · ln(r / 6) (r > 6); tavan 24;
 * bant ±%25; sahne sürümü = eğri × 0,6; şehir içinde gerçekte belirgin uzun olan (≥ ×1,1) modelde de uzun.
*/
import { FULL_LANDMARK_REFS } from "../../full/scaleStandard";

/** yürüme insanı (= walk/scale.ts WALK_HUMAN_H) ve chibi insan (= CHIBI_HEIGHT; genel bakış ve sahne mobilyası) */
export const PERSON_H = 1.0;
export const CHIBI_PERSON_H = 1.55;

export type ScaleContext = "scene" | "city";
export type ScaleGroup = "structure" | "furniture" | "vehicle" | "animal";
/** Ölçülen boyut: `top` yerden tepe, `height` gövde yüksekliği, `length` boy, `width` en, `seat` oturak üstü, `back` sırt üstü,
 *  `span` kanat açıklığı, `sill` pencere denizliği, `inner` kabin iç yüksekliği, `awning` tente üstü. */
export type ScaleDim = "top" | "height" | "length" | "width" | "seat" | "back" | "span" | "sill" | "inner" | "awning";
export type Range = readonly [number, number];

export interface ScaleClass {
  id: string;
  /** Türkçe ad (rapor ve belge) */
  label: string;
  group: ScaleGroup;
  dims: Partial<Record<ScaleDim, Range>>;
  /** sahne bağlamında chibi insana (1,55) göre değerlendirilen boyutlar (K1) */
  sceneChibi?: readonly ScaleDim[];
  /** okunurluk için izinli yukarı abartı çarpanı (üst sınır × bu); aralık ile bu sınır arası "~" (uyarı değil, bilgi) */
  exaggerate?: number;
  /** boy / yükseklik alt sınırı (ör. "kule otobüs" olmasın) */
  minAspect?: number;
  note: string;
}

const INF = Number.POSITIVE_INFINITY;

/** §2.2 aralıkları (× yürüme insanı 1,0). */
export const SCALE_CLASSES: readonly ScaleClass[] = [
  // yapı
  { id: "door", label: "Kapı", group: "structure", dims: { height: [1.2, 1.4], width: [0.5, 0.7] }, note: "Kapı insanı çerçeveler" },
  { id: "storey", label: "Kat", group: "structure", dims: { height: [1.6, 2.0] }, note: "Gerçekte 1,7; chibi kafası için pay. Zemin kat ≤ 2,2" },
  { id: "window", label: "Pencere", group: "structure", dims: { height: [0.5, 0.9], sill: [0.45, 0.6] }, note: "—" },
  { id: "street_lamp", label: "Sokak lambası", group: "structure", dims: { top: [2.2, 3.0] }, note: "—" },
  { id: "tree", label: "Ağaç", group: "structure", dims: { top: [2.5, 6] }, note: "—" },
  { id: "kiosk", label: "Kiosk", group: "structure", dims: { top: [1.4, 1.8] }, note: "§2.3" },
  // mobilya (sahnede chibi; K1)
  { id: "bench", label: "Bank", group: "furniture", dims: { seat: [0.25, 0.32], back: [0.5, 0.6] }, sceneChibi: ["seat"],
    note: "Diz ve kalça boyu. K1: sahnede oturak chibi kalır, sırt gerçek aralığa incelir" },
  { id: "table", label: "Masa", group: "furniture", dims: { top: [0.42, 0.5] }, sceneChibi: ["top"], note: "Masa yüzeyi (üstündeki fincan hariç)" },
  { id: "counter", label: "Tezgâh", group: "furniture", dims: { top: [0.5, 0.58] }, sceneChibi: ["top"], note: "—" },
  { id: "planter", label: "Saksı", group: "furniture", dims: { top: [0.3, 0.5] }, sceneChibi: ["top"], note: "—" },
  { id: "stall", label: "Pazar tezgâhı tentesi", group: "furniture", dims: { awning: [1.25, 1.5] }, sceneChibi: ["awning"],
    note: "Tentenin altında insan durabilmeli" },
  // taşıtlar (şehir haritası; sahne taşıtları WALK-SCALE-002 / walk/scale.ts WALK_MOVER_TARGET)
  { id: "car", label: "Araba / taksi", group: "vehicle", dims: { height: [0.8, 0.95], length: [2.0, 2.6], width: [0.9, 1.1] },
    note: "İnsandan kısa ama 2–2,5 insan uzunluğunda" },
  { id: "bus_single", label: "Otobüs (tek kat)", group: "vehicle", dims: { height: [1.7, 2.0], length: [4.5, 6] }, minAspect: 1.8, note: "—" },
  { id: "bus_double", label: "Otobüs (çift kat)", group: "vehicle", dims: { height: [2.3, 2.6], length: [4.5, 6] }, minAspect: 1.8,
    note: "Boy/yükseklik ≥ 1,8; kule otobüs olmasın" },
  { id: "railcar", label: "Tramvay / metro / füniküler / monoray", group: "vehicle", dims: { height: [1.8, 2.2], length: [4, INF] }, note: "—" },
  { id: "ferry", label: "Vapur / feribot", group: "vehicle", dims: { top: [2.5, 4], length: [7, INF] }, note: "Bir otobüsün en az 1,5 katı" },
  { id: "boat", label: "Kayık", group: "vehicle", dims: { top: [0, 1], length: [2.5, 4] }, note: "—" },
  { id: "cabin", label: "Teleferik / dönme dolap kabini", group: "vehicle", dims: { height: [1.5, 2.2], inner: [1.3, INF] },
    note: "İçinde insan ayakta durabilmeli" },
  { id: "balloon_basket", label: "Balon sepeti", group: "vehicle", dims: { height: [0.45, 0.8] }, note: "walk/scale.ts balloon ile aynı" },
  // hayvanlar (gerçeğe yakın; okunurluk için en çok × 1,3)
  { id: "cat", label: "Kedi", group: "animal", dims: { height: [0.15, 0.25] }, exaggerate: 1.3, note: "—" },
  { id: "dog", label: "Köpek", group: "animal", dims: { height: [0.25, 0.4] }, exaggerate: 1.3, note: "—" },
  { id: "pigeon", label: "Güvercin", group: "animal", dims: { height: [0.12, 0.2] }, exaggerate: 1.3, note: "—" },
  { id: "gull", label: "Martı", group: "animal", dims: { span: [0.6, 0.9] }, exaggerate: 1.3, note: "Kanat açıklığı" },
  { id: "duck", label: "Ördek", group: "animal", dims: { height: [0.15, 0.25] }, exaggerate: 1.3, note: "—" },
  { id: "bird", label: "Kuş", group: "animal", dims: { height: [0.1, 0.2] }, exaggerate: 1.3, note: "Küçük ötücü; CITY-PASS-BKK (denetimsizdi)" },
  { id: "squirrel", label: "Sincap", group: "animal", dims: { height: [0.1, 0.18] }, exaggerate: 1.3, note: "—" },
  { id: "rabbit", label: "Tavşan", group: "animal", dims: { height: [0.1, 0.18] }, exaggerate: 1.3, note: "—" },
  { id: "deer", label: "Geyik", group: "animal", dims: { height: [0.7, 1.0] }, exaggerate: 1.3, note: "—" },
  { id: "owl", label: "Baykuş", group: "animal", dims: { height: [0.2, 0.3] }, exaggerate: 1.3, note: "§2.4" },
  { id: "penguin", label: "Penguen", group: "animal", dims: { height: [0.3, 0.6] }, exaggerate: 1.3, note: "§2.4" },
  { id: "fish_caught", label: "Tutulan balık", group: "animal", dims: { length: [0.1, 0.4] }, exaggerate: 3,
    note: "Bilinçli abartı (ödül okunurluğu, ≤ × 3); denetlenmez" },
];

const BY_ID = new Map(SCALE_CLASSES.map((c) => [c.id, c]));
export const scaleClass = (id: string): ScaleClass | null => BY_ID.get(id) ?? null;

export interface ResolvedRange {
  min: number;
  max: number;
  /** abartı payıyla üst sınır (yoksa `max`) */
  softMax: number;
  /** ölçünün bölündüğü insan boyu (yürüme 1,0 ya da sahne mobilyasında chibi 1,55) */
  person: number;
  chibi: boolean;
}

/** Sınıf + boyut + bağlam → aralık (bilinmeyen sınıf/boyut: null). */
export function scaleRange(id: string, dim: ScaleDim, ctx: ScaleContext): ResolvedRange | null {
  const c = BY_ID.get(id);
  const r = c?.dims[dim];
  if (!c || !r) return null;
  const chibi = ctx === "scene" && !!c.sceneChibi?.includes(dim);
  return { min: r[0], max: r[1], softMax: r[1] * (c.exaggerate ?? 1), person: chibi ? CHIBI_PERSON_H : PERSON_H, chibi };
}

export type ScaleStatus = "ok" | "soft" | "low" | "high";
/** Ölçülen değer (dünya birimi) → oran ve durum. `soft`: aralık üstü ama izinli abartı içinde. low/high: ihlal. */
export function classify(value: number, id: string, dim: ScaleDim, ctx: ScaleContext): { ratio: number; status: ScaleStatus; range: ResolvedRange } | null {
  const range = scaleRange(id, dim, ctx);
  if (!range) return null;
  const ratio = value / range.person;
  const e = 1e-6;
  const status: ScaleStatus = ratio < range.min - e ? "low" : ratio <= range.max + e ? "ok" : ratio <= range.softMax + e ? "soft" : "high";
  return { ratio, status, range };
}
export const isViolation = (s: ScaleStatus) => s === "low" || s === "high";

/** Boy/yükseklik alt sınırı (yoksa her zaman geçer). */
export function aspectOk(id: string, length: number, height: number): boolean {
  const a = BY_ID.get(id)?.minAspect;
  return a === undefined || (height > 0 && length / height >= a - 1e-6);
}

/**
 * kancası: şehir haritası mobilyası için `city/kit.ts` yürüme varyantı adları. Varsa denetim onu ölçer; yoksa paylaşılan
 * (sahne) kit yapıcısını şehir aralığıyla ölçer ve satırı " bekliyor" diye işaretler.
*/
export const WALK_VARIANTS: Readonly<Record<"bench" | "planter" | "stall" | "table", string>> = {
  bench: "walkBench", planter: "walkPlanterRow", stall: "walkMarketStall", table: "walkCafeSet",
};

// ------------------------------------------------------------------------------------------ simge eğrisi
export const LANDMARK_CURVE = {
  /** gerçek insan boyu (m) */
  personM: 1.75,
  /** doğrusal bölgenin sonu (× insan) */
  knee: 6,
  /** logaritmik bölge eğimi */
  k: 4.2,
  /** tavan (citymap LANDMARK_MAX_H ile aynı) */
  cap: 24,
  /** hedef bandı (±) */
  band: 0.25,
  /** sahne sürümü katsayısı */
  sceneFactor: 0.6,
  /** şehir içi sıra: gerçekte en az bu kat uzun olan modelde de uzun olmalı (yakın yükseklikler sıralanmaz) */
  orderMinRatio: 1.1,
} as const;

/** r (× insan) → eğri yüksekliği (× insan; tavanlı). */
export function curveH(r: number): number {
  const { knee, k, cap } = LANDMARK_CURVE;
  if (!(r > 0)) return 0;
  return Math.min(cap, r <= knee ? r : knee + k * Math.log(r / knee));
}
/** Gerçek yükseklik (m) → hedef model yüksekliği (yürüme insanı 1,0 = dünya birimi). */
export function landmarkTarget(realM: number, ctx: ScaleContext = "city"): number {
  const h = curveH(realM / LANDMARK_CURVE.personM);
  return ctx === "scene" ? h * LANDMARK_CURVE.sceneFactor : h;
}
/** Model yüksekliğinin hedeften sapması (−0,1 = %10 kısa) ve bant içinde mi. */
export function landmarkDeviation(modelH: number, realM: number, ctx: ScaleContext = "city"): { target: number; dev: number; ok: boolean } {
  const target = landmarkTarget(realM, ctx);
  const dev = target > 0 ? modelH / target - 1 : 0;
  return { target, dev, ok: Math.abs(dev) <= LANDMARK_CURVE.band + 1e-9 && modelH <= LANDMARK_CURVE.cap + 1e-9 };
}

export interface OrderItem { id: string; realM: number; h: number }
/** Şehir içi sıra ihlalleri: gerçekte ≥ orderMinRatio kat uzun olan (`taller`) modelde daha uzun değilse. */
export function orderViolations(items: readonly OrderItem[]): { taller: string; shorter: string; realRatio: number; modelRatio: number }[] {
  const out: { taller: string; shorter: string; realRatio: number; modelRatio: number }[] = [];
  for (const a of items) for (const b of items) {
    if (a === b || !(a.realM >= b.realM * LANDMARK_CURVE.orderMinRatio)) continue;
    if (a.h <= b.h + 1e-6) out.push({ taller: a.id, shorter: b.id, realRatio: a.realM / b.realM, modelRatio: b.h > 0 ? a.h / b.h : INF });
  }
  return out;
}

/**
 * Gerçek dünya referans yükseklikleri (yalnız ölçek hesabı; arayüze girmez — IP belgesi ilkesi). `city` şehir haritası
 * kimliği, `id` harita simgesi (`null`: yalnız sahnede), `scene` sahne `landmark` bölge etiketleri. `verified`: değer bu iş
 * sırasında kaynağıyla yeniden doğrulandı mı (false = denetim belgesi §2.6'dan, ansiklopedik genel değer; doğrulanmadı).
 * `exempt`: gerekçeli muaf (ölçülür ve yazılır, ihlal sayılmaz).
 */
export interface LandmarkRef { city: string; id: string | null; scene?: readonly string[]; realM: number | null; source: string; verified: boolean; exempt?: string }
export const LANDMARK_REFS: readonly LandmarkRef[] = [
  { city: "istanbul", id: "galata_kulesi", scene: ["galata"], realM: 67, source: "§2.6; taş gövde ~63 m, külahla ~67 m", verified: false },
  { city: "istanbul", id: "ayasofya", scene: ["ayasofya"], realM: 55, source: "§2.6; ana kubbe tepesi", verified: false },
  { city: "istanbul", id: "sultanahmet", scene: ["sultanahmet"], realM: 64, source: "§2.6; minare", verified: false },
  { city: "istanbul", id: "kiz_kulesi", scene: ["maiden_tower"], realM: 23, source: "§2.6", verified: false },
  { city: "istanbul", id: "bogaz_koprusu", scene: ["bosphorus_bridge"], realM: 165, source: "§2.6; kule", verified: false },
  { city: "istanbul", id: "hipodrom", realM: 25, source: "§2.6; dikilitaş kaide dahil", verified: false },
  { city: "istanbul", id: "dolmabahce_saat", realM: 27, source: "§2.6", verified: false },
  { city: "londra", id: "saat_kulesi", scene: ["clocktower"], realM: 96, source: "§2.6", verified: false },
  { city: "londra", id: "cark", scene: ["wheel"], realM: 135, source: "§2.6; gözlem çarkı tepesi", verified: false },
  { city: "londra", id: "kule_koprusu", scene: ["bascule"], realM: 65, source: "§2.6", verified: false },
  { city: "londra", id: "kubbeli_katedral", realM: 111, source: "§2.6", verified: false },
  // §2.6 bu simge için 52 m yazdı; harita simgesi büyük yangın anıt sütunu (61,6 m, ansiklopedi + müze kaydı; 2026-10-27 doğrulandı).
  // 52 m sahnedeki aslanlı meydan sütununa ait (aşağıda).
  { city: "londra", id: "anit_sutun", realM: 61.6, source: "Yangın anıt sütunu 61,6 m (202 ft); §2.6'daki 52 m başka sütun", verified: true },
  { city: "londra", id: null, scene: ["column"], realM: 52, source: "§2.6; aslanlı meydan sütunu ~52 m", verified: false },
  { city: "kapadokya", id: "uchisar_kalesi", scene: ["castle"], realM: 60, source: "§2.6", verified: false,
    exempt: "Doğal kaya kale: yükselti kayanın kendisi, eğri yapılar içindir (§2.6 öneri)" },
  { city: "kapadokya", id: null, scene: ["fairy_chimneys"], realM: null, source: "doğal kaya oluşumu", verified: false, exempt: "Doğal kaya oluşumu" },
  ...FULL_LANDMARK_REFS,
];

/** Bir şehrin referansları (harita ya da sahne). */
export const refsOf = (city: string): LandmarkRef[] => LANDMARK_REFS.filter((r) => r.city === city);
