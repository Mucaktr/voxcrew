/**
 * şehir ritüellerinin React dışı çalışma zamanı.
 *
 * - Yakındakiler: `ritualEntities` şu anki şehrin (sahne tabanı ya da şehir haritası) görünür ritüel konumlarını
 * `hot:rt:<ritüel>:<n>` girdileri olarak verir; `fun/avatarActs.ts ambientEntities` bunları gözlem çarkı (`hot:wheel`)
 * gibi ekler. F/Enter mevcut "git ve dokun" akışıyla avatarı götürür → `ritualPoke(id)`.
 * - Ritüel: avatar döner, gerekirse oturur (`walkRuntime.sit`), `ritualFx.held/.motion/.lure/.burst` yazılır (Crowd ve Ambient
 * yalnız okur; çizer), süre sonunda `say` ve `onRitualDone` dinleyicileri ( anı kaydı).
 * - İptal: avatar yürüyünce, mini oyun ya da yolculuk başlayınca, yürüme modu/sahne/şehir değişince.
 * - Ödül yok: ritüel oyun parası, XP ya da SP yazmaz. Soğuma yalnız görseldir (20 sn).
*/
import { currentLocale, tx as t9n, type Messages } from "../../lib/i18n";
import { ritualsMsg } from "../../locales/rituals";
import { ritualIstanbul } from "../../locales/ritualIstanbul";
import { ritualLondra } from "../../locales/ritualLondra";
import { ritualKapadokya } from "../../locales/ritualKapadokya";
import { cityRecord } from "../cities/hooks";
import { FULL_CITY_MSG } from "../../full/ritualRuntime";
import { useCity } from "../citymap/store";
import { districtParcel, districtPlan, walkableKind } from "../citymap/district";
import { CITY_PD, CITY_PW, type CityMapFile } from "../citymap/format";
import { cityRuntime } from "../citymap/runtime";
import { interiorRuntime } from "../interiors/runtime";
import { reducedMotion } from "../motion";
import { isNightHour, useLightMode } from "../props/daynight";
import { SCENES, tileOf, tx, tz, type Block, type Built, type Tile, type WorldSceneId } from "../scenes";
import { isFurniture, propChairBlocks, seatsNear, type SeatSpot } from "./seats";
import { vendorsFrom } from "../citylife/vendors"; // tezgâhın müşteri yönü
import { playSfx } from "../sfx/sfx";
import { cityX, cityZ } from "../transit/model";
import { headingOf, navGrid, nearestReachable, nearestWalkable, walkable, type ProxEntity } from "../walk/controller";
import { useWalkStore, walkRuntime, type WalkSit } from "../walk/walkStore";
import { say } from "./announce";
import { inQuietZone } from "./brain";
import { isMinigameActive } from "./minigames";
import {
  isRitualCity, parseRitualEntityId, ritualEntityId, ritualMemoryId, RITUALS,
  type HeldItem, type LureKind, type LureMode, type RitualBurst, type RitualCity, type RitualDef, type RitualMotion, type RitualSit,
} from "./rituals";
import {
  anchorsOf, cooldownLeft, ritualBlock, ritualPhaseAt, ritualPlan,
  type AnchorSource, type AnimalLike, type RitualAnchor, type RitualCtx, type RitualPhase, type RitualPlan,
} from "./rituals/logic";

/** Ritüelin başlayabileceği en büyük avatar–konum uzaklığı (birim; "git ve dokun" menzili 1,85 + pay; `hot:wheel` ile aynı). */
export const RITUAL_RANGE = 2.6;
/** Avatar başlangıç yerinden bu kadar uzaklaşınca ritüel biter (Crowd oturuş kalkışıyla aynı eşik). */
export const RITUAL_MOVE_EPS = 0.3;
/** Parçacık yüksekliği (birim): halka su/zemin düzeyinde, toz zeminde; buhar, yaprak, nota, ışıltı el/baş hizasında. */
/** sevinç ışıltısı baş ÜSTÜNDEN doğar (+0,4): önceden 1,2 yüksekliğinde (yüz hizası) doğup beyaz artı işaretleri
 * satıcının gözlerinin üstüne biniyor, "bayılmış" gibi okunuyordu.*/
export const SPARKLE_Y = 1.6;
export const ritualBurstY = (kind: RitualBurst): number => (kind === "ripple" ? 0.02 : kind === "puff" ? 0.1 : kind === "sparkle" ? SPARKLE_Y : 1.2);

// ------------------------------------------------------------------ paylaşılan durum (React dışı)
export interface RitualLureFx {
  x: number; z: number;
  kinds: readonly LureKind[]; n: number; mode: LureMode;
  /** hareket azaltma: yönlendirme yok, hayvanlar anında dinlenme pozunda */
  still: boolean;
  /** bitiş (performance.now() ms); sonra ya da `ritualFx.lure = null` olunca hayvanlar eski davranışa döner */
  until: number;
}
export interface RitualBurstFx { kind: RitualBurst; x: number; y: number; z: number; /** her yeni istekte artar */ seq: number }
export interface RitualFx {
  /** süren ritüelin anı kimliği (`rt:<şehir>:<ritüel>`) ya da null */
  active: string | null;
  /** avatarın elindeki nesne ( çizer)*/
  held: HeldItem | null;
  /** avatarın oynattığı hareket (null → durağan poz ya da oturuş)*/
  motion: RitualMotion | null;
  /** hayvan çekme isteği ( Ambient ve şehir haritası sürüleri okur)*/
  lure: RitualLureFx | null;
  /** parçacık isteği (fx havuzu; hareket azaltmada hiç yazılmaz) */
  burst: RitualBurstFx | null;
}
export const ritualFx: RitualFx = { active: null, held: null, motion: null, lure: null, burst: null };
/**
 * ACTIVITY-FEEL (B3) — yeme hissi (Crowd yalnız okur): `eat` yeme anı (veri `sip` + yiyecek; Crowd `sip` yerine yemek hareketini
 * oynatır, `ritualFx.motion` veri hareketi olarak kalır), `joy` yemek bitti — sevinç evresi (mutlu yüz; hareket azaltmada durağan).
 */
export const ritualFeel: {
  eat: boolean; joy: boolean;
  /** ACTIVITY-CAM: içme anı (yudum + elde içecek, yeme değil); ifade ve yudum kolu (`fun/activityFace.ts`) */
  drink: boolean;
  /** ACTIVITY-CAM: asıl başlangıç (ritüel saati), yerleşme ve toplam süre (ms); son yeme/içme bitişi (0 → yok) */
  t0: number; settleMs: number; totalMs: number; doneAt: number;
} = { eat: false, joy: false, drink: false, t0: 0, settleMs: 0, totalMs: 0, doneAt: 0 };
/** ACTIVITY-CAM: elde içecek sayılanlar (yudum hareketiyle; yiyecek değil). */
const DRINK_ITEMS: ReadonlySet<HeldItem> = new Set<HeldItem>(["tea_glass", "tea", "cup", "coconut", "bowl"]);

/**
 * ACTIVITY-FEEL (B3) — satıcı **dikişi**: yeme-içme ritüeli başlarken (avatar oturağa/konuma vardı) sipariş anı. CITYLIFE'ın
 * "mekânda satıcı var" API'si `at` (konuma en yakın satıcı) ve `onOrder` (satıcı tezgâhta uzatır/el sallar) kancalarına bağlanır;
 * bağlı değilken ritüel bugünkü gibi sürer. Ajanların mekânda yemesi de (`Crowd.tsx` yemek molası) aynı `onOrder`'ı çağırır.
 */
export interface VendorOrder { by: string; city: string | null; ritual: string | null; item: HeldItem | null; x: number; z: number }
export const ritualVendor: {
  /** (x, z) yakınındaki satıcının duruş noktası (yoksa null) */
  at: ((x: number, z: number) => { x: number; z: number } | null) | null;
  onOrder: ((o: VendorOrder) => void) | null;
} = { at: null, onOrder: null };
/** Sipariş anını satıcı kancasına iletir (bağlı değilse etkisiz; kanca hatası ritüeli bozmaz). */
export function orderFromVendor(o: VendorOrder): void {
  try { ritualVendor.onOrder?.(o); } catch { /* satıcı katmanı hatası yemeği bozmaz */ }
}

/**
 * ACTIVITY-FEEL (B8) — ritüel kamerası isteği: ritüel asıl başladığında (oturuş/konum) bir kez yazılır; WalkRig `key` değişince
 * takip kamerasını eylemi yandan 45° gösterecek yana çevirir (`walk/actionCam.ts`; olta ile aynı kural). `targets`: ritüel konumu
 * (tezgâh/sipariş karosu).
 */
export const ritualCam: {
  key: number; x: number; z: number; face: number; targets: { x: number; z: number; /** HQA-FIX: mutlak yükseklik (yem noktası: yer) */ y?: number }[];
  /** ACTIVITY-CAM: avatarın bakışı (oturuşta oturak yönü), oturak yüksekliği (ayakta null), ritüel ve satıcının duruş noktası
   *  (`ritualVendor.at`; yoksa null) — WalkRig etkinlik kadrajı (`walk/activityFraming.ts`) */
  heading: number; seatY: number | null; def: RitualDef | null; sit: RitualSit | null; vendor: { x: number; z: number } | null;
} = { key: 0, x: 0, z: 0, face: 0, targets: [], heading: 0, seatY: null, def: null, sit: null, vendor: null };

/** Bitiş olayı ( anı defteri `POST /api/walk/ritual` buna bağlanır).*/
export interface RitualDoneEvent {
  id: string;
  city: RitualCity;
  memoryId: string;
  scope: "scene" | "map";
  /** yürüme dünyası (sahne kimliği) */
  world: string;
  /** bağlantı sırası */
  anchor: number;
  /** bu oturumda daha önce bitirildi (istemci ipucu; sunucu yine idempotenttir) */
  repeat: boolean;
  /** Date.now() */
  at: number;
}
/** Dinleyici `true` (ya da `true` veren söz) dönerse duyuruya "Anı defterine eklendi" eklenir. */
export type RitualDoneListener = (e: RitualDoneEvent) => void | boolean | Promise<boolean | void>;
export type RitualCancelReason = "move" | "minigame" | "ride" | "left" | "replaced" | "manual";

const listeners = new Set<RitualDoneListener>();
/** Bitiş kancası; çağrı aboneliği kaldıran işlevi döner. */
export function onRitualDone(fn: RitualDoneListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test ve canlı denetim ayarları: saat ve 100 ms'lik denetim zamanlayıcısı. */
export const ritualRuntimeOpts: { now: () => number; timer: boolean } = { now: () => performance.now(), timer: true };

// ------------------------------------------------------------------ veri ve metin
let defsOverride: readonly RitualDef[] | null = null;
const byCity = new Map<string, readonly RitualDef[]>();
/** Geliştirme/test kancası: ritüel listesini değiştirir (null → şehir dosyaları). */
export function setRitualDefs(defs: readonly RitualDef[] | null): void {
  defsOverride = defs;
  byCity.clear();
  if (run) cancelRitual("manual");
}
function defsFor(city: RitualCity): readonly RitualDef[] {
  let l = byCity.get(city);
  if (!l) byCity.set(city, (l = (defsOverride ?? RITUALS).filter((d) => d.city === city)));
  return l;
}

type AnyMsg = Messages<Record<string, string>>;
const CITY_MSG: Record<RitualCity, AnyMsg> = {
  istanbul: ritualIstanbul as AnyMsg, londra: ritualLondra as AnyMsg, kapadokya: ritualKapadokya as AnyMsg,
  ...FULL_CITY_MSG,
  // yeni şehrin ritüel metinleri kendi locale.ts `ritual` ad alanından
  ...cityRecord((m) => (m.locale.ritual ?? { tr: {}, en: {} }) as AnyMsg),
};
/** Ritüel metni (`<locale>_label` · `_done` · `_note`); şehir dosyasında yoksa ortak yedek. */
export function ritualText(def: Pick<RitualDef, "city" | "locale">, part: "label" | "done" | "note"): string {
  const m = CITY_MSG[def.city];
  const k = `${def.locale}_${part}`;
  // gece metni (`<locale>_label_night` / `_done_night`) varsa gece o — saatten bağımsız açık mekân ritüeli
  // (Kapadokya çay bahçesi: balonlar yalnız gündüz uçar) gece de satıcıdan çay alınır, metin balon demez
  if (m && part !== "note" && `${k}_night` in m.tr && clock().night) return t9n(m, `${k}_night`);
  if (m && (k in m.tr || k in m[currentLocale()])) return t9n(m, k);
  return part === "label" ? t9n(ritualsMsg, "fallback_label") : part === "done" ? t9n(ritualsMsg, "fallback_done") : "";
}

// ------------------------------------------------------------------ bağlam
interface Where { scope: "scene" | "map"; world: string; city: RitualCity; src: AnchorSource }
function where(animals?: readonly AnimalLike[]): Where | null {
  const st = useWalkStore.getState();
  if (!st.active || !st.world || interiorRuntime.inside) return null;
  const near = { x: walkRuntime.avatar.x, z: walkRuntime.avatar.z };
  if (cityRuntime.active) {
    const v = useCity.getState().view;
    const city = v ? (isRitualCity(v.city) ? v.city : isRitualCity(v.scene) ? v.scene : null) : null;
    if (!v || !city) return null;
    return { scope: "map", world: st.world, city, src: { kind: "map", map: v.map, toWorld: (I, J) => [cityX(I), cityZ(J)], animals, near } };
  }
  if (!isRitualCity(st.world)) return null;
  const off = walkRuntime.baseOffset;
  return { scope: "scene", world: st.world, city: st.world, src: { kind: "scene", toWorld: (i, j) => [tx(i + off[0]), tz(j + off[1])], animals, near } };
}

/** Etkin gece ve gün batımı (`props/daynight.ts` ışık kipi; gün batımı `citymap/store.ts sunsetNow` kuralı: Gece ışığı ya da
 *  otomatikte 17–21). */
function clock(): { night: boolean; dusk: boolean } {
  const mode = useLightMode.getState().mode;
  if (mode === "night") return { night: true, dusk: true };
  if (mode === "day") return { night: false, dusk: false };
  const d = new Date(), h = d.getHours();
  return { night: isNightHour(d), dusk: h >= 17 && h < 21 };
}
function baseCtx(): Omit<RitualCtx, "quiet"> {
  return { ...clock(), riding: walkRuntime.ride !== null, minigame: isMinigameActive() };
}
function quietAt(def: RitualDef, a: RitualAnchor): boolean {
  if (inQuietZone(a.x, a.z)) return true;
  const pf = walkRuntime.photoFocus;
  return !!def.photo && pf.ok && inQuietZone(pf.x, pf.z);
}

// ------------------------------------------------------------------ Yakındakiler
export interface RitualEntity extends ProxEntity { label: string; type: "ritual"; /** ritüel kimliği */ ritual: string }
const NONE: readonly RitualEntity[] = Object.freeze([]) as readonly RitualEntity[];
const pool = new Map<string, RitualEntity>();
const buf: RitualEntity[] = [];
/** son ritüelin yapıldığı yer (oturuşta oturak, ayakta avatar noktası) ve girdisi. Oturuşta `walkRuntime.sit` aynı nesne
 * kaldıkça, ayakta avatar oradan `RITUAL_MOVE_EPS` içinde kaldıkça geçerli (ritüel bitse de).*/
const spotOf: { id: string; world: string; x: number; z: number; sit: WalkSit | null } = { id: "", world: "", x: 0, z: 0, sit: null };
/** avatar ritüeli yaptığı yerde mi (o ritüelin girdisi oraya konur) — yer ya da null.*/
function ritualSpot(id: string, world: string): { x: number; z: number } | null {
  if (spotOf.id !== id || spotOf.world !== world) return null;
  if (spotOf.sit) return walkRuntime.sit === spotOf.sit ? spotOf : null;
  const av = walkRuntime.avatar;
  return Math.hypot(av.x - spotOf.x, av.z - spotOf.z) <= RITUAL_MOVE_EPS ? spotOf : null;
}

/** Yakındakiler girdileri (sessiz bölgede, yolculukta, mini oyunda ve saati değilken yok). Nesneler yeniden kullanılır.
 * `animals`: Ambient'in yayımladığı hayvanlar (hayvana bağlı ritüel; `type` alanını yazar).*/
export function ritualEntities(animals?: readonly AnimalLike[]): readonly RitualEntity[] {
  const w = where(animals);
  if (!w) return NONE;
  const list = defsFor(w.city);
  if (!list.length) return NONE;
  const ctx = baseCtx();
  buf.length = 0;
  for (const def of list) {
    for (const a of anchorsOf(def, w.src)) {
      if (ritualBlock(def, { ...ctx, quiet: quietAt(def, a) })) continue;
      const id = ritualEntityId(def.id, a.n);
      let e = pool.get(id);
      if (!e) pool.set(id, (e = { id, kind: "prop", x: 0, z: 0, label: "", type: "ritual", ritual: def.id }));
      // ritüeli yaptığı yerde duran/oturan avatar için girdi o yerdedir — oturuşta avatar noktası oturağa varış karosunda
      // (≤ RITUAL_SEAT_REACH) kalır, ayakta ritüel RITUAL_RANGE (2,6) içinden başlar; çapa oradan 1,6'dan uzak olunca F çevreleyen
      // simgenin bilgisine (ayak izinde mesafe 0: pazar holü, çarşı) gidiyordu
      const spot = ritualSpot(id, w.world);
      e.x = spot ? spot.x : a.x; e.z = spot ? spot.z : a.z; e.label = ritualText(def, "label");
      buf.push(e);
    }
  }
  return buf.length ? buf : NONE;
}

// ------------------------------------------------------------------ CORE-WALK: gerçek oturak (çapa ve mekân tabanlı)
// oturak sondası fun/seats.ts içine taşındı (ritualSeatAt aynı imzayla yeniden dışa verilir).
export { ritualSeatAt, type RitualSeat } from "./seats";
/** Oturmalı ritüelin oturağı ritüel konumunun (mekânın) bu yarıçapı içinde aranır (birim; mekân ≈ 3 × 3 karo + pay). */
export const RITUAL_SEAT_RADIUS = 3.6;
/** Avatar oturağa bu kadar yakınsa yürümeden oturur (birim). */
export const RITUAL_SEAT_SNAP = 0.6;
/** Yürüme bitince (rota yok) oturağa en çok bu kadar uzaksa varılmış sayılır (oturak engelli karoda: komşu karodan oturulur). */
export const RITUAL_SEAT_REACH = 1.15;
/** Oturağa yürüme için süre sınırı (ms); aşılırsa ritüel ayakta yapılır. */
export const RITUAL_APPROACH_MS = 12_000;
/** Yer oturuşu (oturak yoksa): ayak yüzeyinin bu kadar üstü (Crowd GROUND_Y ile aynı). */
const GROUND_SEAT = 0.05;

/** Oturak doluluğu: yürüme düzeneği ajan konumlarını bağlar (WalkRig); test null bırakır (hepsi boş). */
export const seatOccupancy: { at: ((x: number, z: number) => boolean) | null } = { at: null };

/** REAL-SEAT-001 kusur kaydı: oturmalı ritüelin gerçek oturağı yok ya da ulaşılamıyor → ritüel ayakta yapıldı. */
export interface RealismDefect { code: "REAL-SEAT-001"; city: string; ritual: string; anchor: number; scope: "scene" | "map"; x: number; z: number; reason: "no_seat" | "unreachable" }
export const realismDefects: RealismDefect[] = [];
function logDefect(d: RealismDefect): void {
  if (realismDefects.some((q) => q.city === d.city && q.ritual === d.ritual && q.anchor === d.anchor && q.scope === d.scope && q.reason === d.reason)) return;
  realismDefects.push(d);
  if (realismDefects.length > 64) realismDefects.shift();
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  if (env?.DEV) console.warn(`[REAL-SEAT-001] ${d.city}:${d.ritual}#${d.anchor} (${d.scope}) ${d.reason} — ritüel ayakta`);
}

/** Sahne tabanının eşya blokları (oturak + sırt/masa; yerleşik şehir sahnesi; sahne başına bir kez kurulur). */
const sceneSeatCache = new Map<string, readonly Block[]>();
const sceneBuiltCache = new Map<string, Built | null>();
function sceneBuilt(world: string): Built | null {
  if (!sceneBuiltCache.has(world)) {
    const def = (SCENES as Partial<Record<string, { build: () => Built }>>)[world as WorldSceneId];
    let b: Built | null = null;
    try { b = def ? def.build() : null; } catch { b = null; }
    sceneBuiltCache.set(world, b);
  }
  return sceneBuiltCache.get(world) ?? null;
}
function sceneSeatBlocks(world: string): readonly Block[] {
  let l = sceneSeatCache.get(world);
  if (!l) {
    const b = sceneBuilt(world);
    // Props.tsx sandalyeleri (blok değil) sanal oturak olarak eklenir: kafe/masa sandalyesine de oturulur
    l = b ? [...b.blocks.filter(isFurniture), ...propChairBlocks(b, tx, tz)] : [];
    sceneSeatCache.set(world, l);
  }
  return l;
}
/** Şehir haritası: (x, z) çevresindeki `r` birimlik kareye değen parsellerin yakın eşya blokları (semt üreteci önbellekli). */
function mapSeatBlocks(map: CityMapFile, x: number, z: number, r: number, keep: (q: Block) => boolean = isFurniture): Block[] {
  const out: Block[] = [], seen = new Set<string>();
  const I0 = Math.floor(x + 12 - r), I1 = Math.floor(x + 12 + r), J0 = Math.floor(z + 8 - r), J1 = Math.floor(z + 8 + r);
  for (let J = J0; J <= J1; J++) for (let I = I0; I <= I1; I++) {
    const d = map.districts.find((q) => I >= q.bounds[0] && I < q.bounds[0] + q.bounds[2] && J >= q.bounds[1] && J < q.bounds[1] + q.bounds[3]);
    if (!d) continue;
    const cx = Math.floor(I / CITY_PW), cz = Math.floor(J / CITY_PD), k = `${d.id}:${cx},${cz}`;
    if (seen.has(k)) continue;
    seen.add(k);
    try { const p = districtParcel(map, d, cx, cz); if (p) for (const q of p.near.blocks) if (keep(q)) out.push(q); } catch { /* parsel yoksa oturak yok */ }
  }
  return out;
}

/** tezgâh önünün sipariş karosundan uzaklığı (placeVenue yerel v: tezgâh üstü önü 0,45, sipariş karosu 1) ve çatı yarı genişliği.*/
export const COUNTER_FRONT_FROM_ANCHOR = 0.55;
export const STALL_HALF_W = 1.55;
/** (ax, az) sipariş karosu olan tezgâhlı mekânın müşteri yönü (tezgâhtan sipariş karosuna, birim) — `vendorsFrom` imzası; yoksa null.*/
export function venueDir(blocks: readonly Block[], ax: number, az: number): readonly [number, number] | null {
  for (const v of vendorsFrom(blocks)) if (v.dir && Math.hypot(v.anchor.x - ax, v.anchor.z - az) < 0.6) return v.dir;
  return null;
}
/** (x, z) tezgâhın arkasında mı (satıcı tarafı ya da kioskun ardı; çatı genişliği içinde, tezgâh önünün gerisinde).*/
export function behindCounter(dir: readonly [number, number], ax: number, az: number, x: number, z: number): boolean {
  const dx = x - ax, dz = z - az, v = dx * dir[0] + dz * dir[1], u = dx * dir[1] - dz * dir[0];
  return v < -COUNTER_FRONT_FROM_ANCHOR && Math.abs(u) < STALL_HALF_W;
}
/** mekânlı ritüelde tezgâhın arkasındaki oturaklar (komşu bank, kioskun ardı) elenir — avatar satıcı tarafında oturmaz.*/
export function customerSeats(dir: readonly [number, number] | null, a: { x: number; z: number }, list: SeatSpot[]): SeatSpot[] {
  if (!dir) return list;
  // tezgâh dibindeki tabure (sipariş karosu hizası) son çare: önünde 0,4 birimde tezgâh var, etkinlik kadrajı ancak tentenin altından
  // ya da satıcının yanından görebiliyordu. Önce mekânın masa takımı (sipariş karosunun önü), sonra tabure; her grupta yakınlık sırası.
  const table = (s: SeatSpot) => (s.x - a.x) * dir[0] + (s.z - a.z) * dir[1] > TABLE_ROW_FROM_ANCHOR;
  const ok = list.filter((s) => !behindCounter(dir, a.x, a.z, s.x, s.z));
  return [...ok.filter(table), ...ok.filter((s) => !table(s))];
}
/** masa takımı sırası (placeVenue v 2) sipariş karosundan (v 1) bu kadar ileride sayılır.*/
export const TABLE_ROW_FROM_ANCHOR = 0.5;
/** ritüel yerinin (taban göreli) tezgâh yönü — haritada çevre parsellerin bütün blokları, sahnede taban sahnenin blokları.*/
function venueDirAt(w: Pick<Where, "src" | "world">, x: number, z: number): readonly [number, number] | null {
  const blocks = w.src.kind === "map" ? mapSeatBlocks(w.src.map as CityMapFile, x, z, 1.5, () => true) : sceneBuilt(w.world)?.blocks ?? [];
  return venueDir(blocks, x, z);
}

/**
 * Ritüelin oturağı: ritüel konumunun `RITUAL_SEAT_RADIUS` içindeki boş gerçek oturaklardan avatara en yakını (`sit_bench`: bank,
 * tabure, sandalye, pub bankı; `sit_ground`: minder/hasır). Yoksa null.
 */
export function ritualSeatFor(w: Pick<Where, "src" | "world">, pose: RitualSit, a: { x: number; z: number }, from: { x: number; z: number }, venue = false, around = false): SeatSpot | null {
  const off = w.src.kind === "scene" ? walkRuntime.baseOffset : [0, 0] as const;
  const radius = venue ? RITUAL_VENUE_RADIUS : RITUAL_SEAT_RADIUS;
  const blocks = w.src.kind === "map" ? mapSeatBlocks(w.src.map as CityMapFile, a.x, a.z, radius + 0.5) : sceneSeatBlocks(w.world);
  const fx = from.x - off[0], fz = from.z - off[1];
  let list = seatsNear(blocks, a.x - off[0], a.z - off[1], radius, pose, { x: fx, z: fz });
  if (venue) list = customerSeats(venueDirAt(w, a.x - off[0], a.z - off[1]), { x: a.x - off[0], z: a.z - off[1] }, list);
  // avatar zaten bir müşteri oturağının dibindeyse (bilerek oraya yürümüş) masaya taşınmaz: orada oturur
  const here = list.findIndex((s) => Math.hypot(s.x - fx, s.z - fz) <= RITUAL_SEAT_SNAP);
  if (venue && here > 0) list = [list[here], ...list.slice(0, here), ...list.slice(here + 1)];
  for (const s of list) {
    const x = s.x + off[0], z = s.z + off[1];
    if (seatOccupancy.at?.(x, z)) continue;
    if (!seatReachable(w, s, { x: fx, z: fz })) continue;
    // ACTIVITY-FEEL (B8): oturağa giden yol kısa ve mantıklı olmalı — arka sokaklardan dolanan oturak seçilmez
    if (!seatRouteShort(w, s, { x: fx, z: fz }, around)) continue;
    return { ...s, x, z };
  }
  return null;
}

/** ACTIVITY-FEEL (B8): oturağa yürüyüşün en çok adımı (karo; ritüel menzili 2,6 + mekân yarıçapı 2,2 → düz yol ≤ ~7). */
export const RITUAL_PATH_MAX = 9;
/** Düz (Manhattan) yoldan en çok bu kadar fazla adım: duvarın arkasındaki oturağa sokak dolanarak gidilmez. */
export const RITUAL_DETOUR = 4;
/** Izgarada 4 komşulu en kısa adım sayısı (`max` aşılırsa null). `ok(i, j)`: karo yürünür mü. Hedef karosu engelliyse komşusuna
 *  varmak yeter (oturak engelli karoda: komşu karodan oturulur). */
export function gridSteps(ok: (i: number, j: number) => boolean, from: Tile, to: Tile, max: number): number | null {
  if (from[0] === to[0] && from[1] === to[1]) return 0;
  const goalOpen = ok(to[0], to[1]);
  if (!goalOpen && Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) === 1) return 0;
  const seen = new Set<string>([`${from[0]},${from[1]}`]);
  let front: Tile[] = [from];
  for (let d = 1; d <= max && front.length; d++) {
    const next: Tile[] = [];
    for (const [i, j] of front) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n: Tile = [i + di, j + dj], k = `${n[0]},${n[1]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (n[0] === to[0] && n[1] === to[1] && goalOpen) return d;
      if (!ok(n[0], n[1])) continue;
      if (!goalOpen && Math.abs(n[0] - to[0]) + Math.abs(n[1] - to[1]) === 1) return d;
      next.push(n);
    }
    front = next;
  }
  return null;
}
/** Oturağa yürüyüş kısa mı (taban göreli; sahnede taban ızgarası, haritada semt planları). */
/** `around` — tezgâhın arkasından gelen avatar kioskun çevresinden önden oturağa yürür (yol sınırı `RITUAL_AROUND_MAX`).*/
export const RITUAL_AROUND_MAX = 16;
function seatRouteShort(w: Pick<Where, "src" | "world">, s: { x: number; z: number }, from: { x: number; z: number }, around = false): boolean {
  const a = tileOf(from.x, from.z), b = tileOf(s.x, s.z);
  const lim = around ? RITUAL_AROUND_MAX : Math.min(RITUAL_PATH_MAX, Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + RITUAL_DETOUR);
  return routeSteps(w, a, b, lim) !== null;
}
/** Sahne/harita ızgarasında adım sayısı (`max` aşılırsa null; taban göreli). Test ve gerçekçilik kapısı için dışa açık. */
export function routeSteps(w: Pick<Where, "src" | "world">, a: Tile, b: Tile, max: number): number | null {
  if (w.src.kind === "map") {
    const map = w.src.map as CityMapFile;
    const start = mapWalkable(map, a[0], a[1]) ? a : nearTile(a, (I, J) => mapWalkable(map, I, J)) ?? a;
    return gridSteps((I, J) => mapWalkable(map, I, J), start, b, max);
  }
  const built = sceneBuilt(w.world);
  if (!built) return 0;
  const nav = navGrid(built);
  // avatar engelli karoda duruyorsa (yükselti/eşya kenarı) en yakın yürünür karodan say
  const start = walkable(nav, a[0], a[1]) ? a : nearestWalkable(nav, a, 1) ?? a;
  return gridSteps((i, j) => walkable(nav, i, j), start, b, max);
}
const nearTile = (a: Tile, ok: (i: number, j: number) => boolean): Tile | null => {
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) if (ok(a[0] + di, a[1] + dj)) return [a[0] + di, a[1] + dj];
  return null;
};
function mapWalkable(map: CityMapFile, I: number, J: number): boolean {
  const d = map.districts.find((q) => I >= q.bounds[0] && I < q.bounds[0] + q.bounds[2] && J >= q.bounds[1] && J < q.bounds[1] + q.bounds[3]);
  if (!d) return false;
  try { const plan = districtPlan(map, d); return walkableKind(plan.kind[(J - plan.j0) * plan.w + (I - plan.i0)]); } catch { return false; }
}
/**
 * Saf çözücü (gerçekçilik kapısı ve testler için; çalışma zamanının doluluk/erişim süzgeci hariç): ritüel konumu `a` ve başlangıç
 * `from` için oturak. `sit_bench`: mekânın/çevrenin gerçek oturağı ya da null (→ ayakta, REAL-SEAT-001); `sit_ground`: minder ya da
 * `floorY` + 0,05 (avatarın bastığı yüzey). Avatar oturağa yürür; oturuş noktası oturak (başlangıç değil).
 */
export function resolveRitualSeat(blocks: readonly Block[], a: { x: number; z: number }, from: { x: number; z: number }, pose: RitualSit,
  venue = false, floorY = 0): SeatSpot | null {
  let list = seatsNear(blocks, a.x, a.z, venue ? RITUAL_VENUE_RADIUS : RITUAL_SEAT_RADIUS, pose, from);
  if (venue) list = customerSeats(venueDir(blocks, a.x, a.z), a, list);
  if (list.length) return list[0];
  if (pose !== "sit_ground") return null;
  const g = groundSpotNear(blocks, from.x, from.z, floorY);
  return { x: g.x, z: g.z, y: floorY + GROUND_SEAT, kind: "cushion", heading: null, d: Math.hypot(g.x - from.x, g.z - from.z) };
}
/** Yer oturuşu için kalça sütunu boş nokta: (x, z) doluysa (masa ayağı, direk, gövde) 0,3–2,4 birim çevrede ilk boş nokta (zemin varsa zeminde). */
export function groundSpotNear(blocks: readonly Block[], x: number, z: number, floorY = 0): { x: number; z: number } {
  const free = (px: number, pz: number) => !blocks.some((r) => (r.g === "solid" || r.g === "glass") && r.p[1] + r.s[1] / 2 > floorY + 0.06
    && r.p[1] - r.s[1] / 2 < floorY + 0.9 && Math.abs(px - r.p[0]) < r.s[0] / 2 + 0.12 && Math.abs(pz - r.p[2]) < r.s[2] / 2 + 0.12);
  // zemin: noktanın altında üstü ayak yüzeyinde (±0,08) bir blok; başlangıçta varsa kayılan noktada da olmalı (suya/boşluğa kayma yok)
  const floorAt = (px: number, pz: number) => blocks.some((r) => r.g !== "glow" && Math.abs(r.p[1] + r.s[1] / 2 - floorY) <= 0.08
    && Math.abs(px - r.p[0]) <= r.s[0] / 2 && Math.abs(pz - r.p[2]) <= r.s[2] / 2);
  const needFloor = floorAt(x, z);
  if (free(x, z)) return { x, z };
  for (const d of [0.3, 0.45, 0.6, 0.75, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4]) for (let k = 0; k < 8; k++) {
    const px = x + Math.cos((k * Math.PI) / 4) * d, pz = z + Math.sin((k * Math.PI) / 4) * d;
    if (free(px, pz) && (!needFloor || floorAt(px, pz))) return { x: px, z: pz };
  }
  return { x, z };
}
/** Mekânlı ritüelde oturak yalnız mekânın kendi 3 × 3 yerleşiminde aranır (sipariş karosundan en uzak oturak ≈ 1,7). */
export const RITUAL_VENUE_RADIUS = 2.2;
/** Oturağa yürünebilir mi: sahnede taban ızgarasında oturak karosu (ya da komşusu) avatarın karosundan ulaşılır; haritada oturak
 *  karosu ya da bir komşusu yürünür. (Taban göreli koordinat.) */
function seatReachable(w: Pick<Where, "src" | "world">, s: { x: number; z: number }, from: { x: number; z: number }): boolean {
  const t = tileOf(s.x, s.z);
  if (w.src.kind === "map") {
    const map = w.src.map as CityMapFile;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const I = t[0] + di, J = t[1] + dj;
      const d = map.districts.find((q) => I >= q.bounds[0] && I < q.bounds[0] + q.bounds[2] && J >= q.bounds[1] && J < q.bounds[1] + q.bounds[3]);
      if (!d) continue;
      try { const plan = districtPlan(map, d); if (walkableKind(plan.kind[(J - plan.j0) * plan.w + (I - plan.i0)])) return true; } catch { /* plan yok */ }
    }
    return false;
  }
  const built = sceneBuilt(w.world);
  if (!built) return true;
  const nav = navGrid(built);
  const goal = nearestReachable(nav, tileOf(from.x, from.z), t);
  return !!goal && Math.hypot(tx(goal[0]) - s.x, tz(goal[1]) - s.z) <= RITUAL_SEAT_REACH;
}

// ------------------------------------------------------------------ ritüel
interface Approach { seat: SeatSpot; goal: Tile; t0: number; moved: boolean; /** tezgâh önüne (sipariş karosu) yürünür, ayakta başlanır*/ stand?: boolean }
interface Run {
  def: RitualDef; anchor: RitualAnchor; plan: RitualPlan; scope: Where["scope"]; world: string;
  t0: number; x0: number; z0: number; sit: WalkSit | null; acted: boolean; timer: ReturnType<typeof setInterval> | null;
  /** ACTIVITY-FEEL (B3): sevinç evresi başladı */
  joyed?: boolean;
  /** CORE-WALK: oturağa yürüyüş (bitince oturulur ve ritüel başlar); null → ritüel sürüyor */
  approach: Approach | null;
  /** tezgâhlı mekânda müşteri yönü ve taban kayması (yürüyüş yarıda kalırsa tezgâh arkasında ayakta başlanmaz)*/
  vdir?: readonly [number, number] | null;
  voff?: readonly [number, number];
  /** sipariş anı verildi*/
  ordered?: boolean;
}
let run: Run | null = null;
let burstSeq = 0;
const lastDone = new Map<string, number>();
const doneOnce = new Set<string>();

/** Süren ritüel (canlı denetim ve testler; kopya). `approach`: oturağa yürünüyor (ritüel henüz başlamadı). */
export function ritualState(): { id: string; memoryId: string; phase: RitualPhase; plan: RitualPlan; approach: { x: number; z: number; y: number; goal: Tile } | null } | null {
  const r = run;
  if (!r) return null;
  const ap = r.approach ? { x: r.approach.seat.x, z: r.approach.seat.z, y: r.approach.seat.y, goal: r.approach.goal } : null;
  return { id: r.def.id, memoryId: ritualMemoryId(r.def), phase: ap ? "settle" : ritualPhaseAt(r.plan, ritualRuntimeOpts.now() - r.t0), plan: r.plan, approach: ap };
}
/** Ritüelin kalan soğuması (ms). */
export const ritualCooldown = (def: Pick<RitualDef, "city" | "id">): number => cooldownLeft(lastDone.get(ritualMemoryId(def)), ritualRuntimeOpts.now());

/**
 * F / Enter / Yakındakiler: `hot:rt:` kimliği bizimse ritüeli başlatır (uzaktaysa, soğumadaysa ya da artık görünmüyorsa yalnız
 * kısa duyuru) ve true döner; değilse false (Ambient dokunuşu dener).
 */
export function ritualPoke(id: string, animals?: readonly AnimalLike[]): boolean {
  const p = parseRitualEntityId(id);
  if (!p) return false;
  const w = where(animals);
  const def = w ? defsFor(w.city).find((d) => d.id === p.id) : undefined;
  // ACTIVITY-FEEL (B8): avatarın menzilinde aynı ritüelin daha yakın bir konumu varsa o seçilir (uzak konuma yürüyüş yok)
  const a = w && def ? pickAnchor(anchorsOf(def, w.src), p.n, walkRuntime.avatar) : undefined;
  if (!w || !def || !a) return true;
  if (ritualBlock(def, { ...baseCtx(), quiet: quietAt(def, a) })) return true;
  if (run && run.def.id === def.id) return true;
  if (ritualCooldown(def) > 0) { say(t9n(ritualsMsg, "cooldown"), a.x, 1.4, a.z); return true; }
  const av = walkRuntime.avatar;
  if (Math.hypot(av.x - a.x, av.z - a.z) > RITUAL_RANGE) { say(t9n(ritualsMsg, "closer"), a.x, 1.4, a.z); return true; }
  start(def, a, w);
  return true;
}

/** Dürtülen konum; avatarın `RITUAL_RANGE` içinde aynı ritüelin daha yakın bir konumu varsa o (Yakındakiler sırası değişse de). */
export function pickAnchor(list: readonly RitualAnchor[], n: number, av: { x: number; z: number }): RitualAnchor | undefined {
  const a = list.find((q) => q.n === n);
  if (!a) return undefined;
  let best = a, bd = Math.hypot(av.x - a.x, av.z - a.z);
  for (const q of list) {
    const d = Math.hypot(av.x - q.x, av.z - q.z);
    if (d < bd - 0.25 && d <= RITUAL_RANGE) { best = q; bd = d; }
  }
  return best;
}

function start(def: RitualDef, a: RitualAnchor, w: Where): void {
  if (run) cancelRitual("replaced");
  const plan = ritualPlan(def, reducedMotion());
  const av = walkRuntime.avatar;
  av.speed = 0; av.route = null;
  const r: Run = { def, anchor: a, plan, scope: w.scope, world: w.world, t0: ritualRuntimeOpts.now(), x0: av.x, z0: av.z, sit: null, acted: false, timer: null, approach: null };
  run = r;
  Object.assign(ritualFx, { active: null, held: plan.held, motion: null, lure: null, burst: null } satisfies RitualFx);
  ritualFeel.eat = plan.eat; ritualFeel.joy = false;
  ritualFeel.drink = !plan.eat && def.act.motion === "sip" && !!plan.held && DRINK_ITEMS.has(plan.held); // ACTIVITY-CAM
  if (ritualRuntimeOpts.timer && typeof setInterval === "function") {
    r.timer = setInterval(() => ritualTick(), 100);
    (r.timer as { unref?: () => void }).unref?.();
  }
  // tezgâhın arkasından (satıcı tarafı, kioskun ardı) yerinde başlanmaz: önden bir oturağa yürünür, yoksa önden gelinmesi istenir
  const off = w.src.kind === "scene" ? walkRuntime.baseOffset : [0, 0] as const;
  const vdir = def.venue ? venueDirAt(w, a.x - off[0], a.z - off[1]) : null;
  const behind = !!vdir && behindCounter(vdir, a.x - off[0], a.z - off[1], av.x - off[0], av.z - off[1]);
  r.vdir = vdir; r.voff = off;
  const refuse = () => { say(t9n(ritualsMsg, "front"), a.x, 1.4, a.z); cancelRitual("move"); };
  // tezgâh arkasından başlanınca oturak yoksa: önce kioskun önüne (sipariş karosu) yürünür, orada ayakta başlanır; yol yoksa geri çevrilir
  const toFront = () => {
    const front = { x: a.x, z: a.z, y: av.y ?? 0, kind: "seat", heading: null, d: 0 } as SeatSpot, goal = tileOf(a.x, a.z);
    if (!seatRouteShort(w, { x: a.x - off[0], z: a.z - off[1] }, { x: av.x - off[0], z: av.z - off[1] }, true)) { refuse(); return; }
    r.approach = { seat: front, goal, t0: r.t0, moved: false, stand: true };
    useWalkStore.getState().setTarget(goal);
    if (def.venue) placeOrder(r);
  };
  if (plan.sit) {
    // CORE-WALK: oturak avatarın altında değil, ritüelin yerinde (mekânda) aranır; uzaksa avatar oturağa yürür
    const seat = ritualSeatFor(w, plan.sit, a, av, !!def.venue, behind);
    if (!seat && behind) { toFront(); return; }
    if (seat && Math.hypot(av.x - seat.x, av.z - seat.z) > RITUAL_SEAT_SNAP) {
      const goal = tileOf(seat.x, seat.z);
      r.approach = { seat, goal, t0: r.t0, moved: false };
      useWalkStore.getState().setTarget(goal);
      if (def.venue) placeOrder(r); // masaya yürümeden önce tezgâhta sipariş (sipariş anı ritüel başında, bir kez)
      return;
    }
    if (seat) { begin(r, seat); return; }
    if (plan.sit === "sit_bench") {
      // gerçek oturak yok: havada oturuş yok → ayakta yap + REAL-SEAT-001
      logDefect({ code: "REAL-SEAT-001", city: def.city, ritual: def.id, anchor: a.n, scope: w.scope, x: a.x, z: a.z, reason: "no_seat" });
      begin(r, null, true);
      return;
    }
    // yer oturuşu: minder yoksa avatarın bastığı yüzeye (yükseltide de batmaz, havada kalmaz)
    const near = w.src.kind === "map" ? mapSeatBlocks(w.src.map as CityMapFile, av.x, av.z, 1) : sceneSeatBlocks(w.world);
    const g = groundSpotNear(near, av.x - off[0], av.z - off[1], av.y ?? 0);
    begin(r, { x: g.x + off[0], z: g.z + off[1], y: (av.y ?? 0) + GROUND_SEAT, kind: "cushion", heading: null, d: 0 });
    return;
  }
  if (behind) { toFront(); return; }
  begin(r, null);
}

/** Oturuş (varsa) ve ritüelin asıl başlangıcı: yön, oturuş, saat. `stand`: oturmalı ritüel ayakta yapılır. */
function begin(r: Run, seat: SeatSpot | null, stand = false): void {
  const av = walkRuntime.avatar, a = r.anchor;
  if (stand) r.plan = { ...r.plan, sit: null };
  const dx = a.x - av.x, dz = a.z - av.z;
  av.heading = seat?.heading ?? (seat ? (Math.hypot(a.x - seat.x, a.z - seat.z) > 0.3 ? headingOf(a.x - seat.x, a.z - seat.z) : a.face ?? av.heading)
    : a.face ?? (Math.hypot(dx, dz) > 0.05 ? headingOf(dx, dz) : av.heading));
  av.speed = 0; av.route = null;
  r.approach = null;
  r.t0 = ritualRuntimeOpts.now(); r.x0 = av.x; r.z0 = av.z;
  if (r.plan.sit && seat) {
    r.sit = { pose: r.plan.sit, x: seat.x, z: seat.z, heading: av.heading, y: seat.y };
    walkRuntime.sit = r.sit;
  }
  // avatar orada kaldıkça (oturuş sürdükçe; ritüel bitse de) F bu ritüeli o yerde bulur
  Object.assign(spotOf, { id: ritualEntityId(r.def.id, a.n), world: r.world, x: r.sit ? r.sit.x : av.x, z: r.sit ? r.sit.z : av.z, sit: r.sit });
  ritualFx.active = ritualMemoryId(r.def);
  // ACTIVITY-FEEL (B8): kamera eylemi yandan gösterir (ritüel konumu kadrajda)
  // eylemin yönü: avatardan ritüel konumuna (oturakta mekân yanda/arkada kalabilir); konumun üstündeyse avatarın bakışı
  ritualCam.key++; ritualCam.x = av.x; ritualCam.z = av.z;
  ritualCam.face = Math.hypot(a.x - av.x, a.z - av.z) > 0.6 ? headingOf(a.x - av.x, a.z - av.z) : av.heading;
  ritualCam.targets = [{ x: a.x, z: a.z }];
  // HQA-FIX: hayvan çekmede yemin düştüğü nokta da kadrajda (güvercinler önde gagalar, martı önde kapar; Ambient `lureFocus`)
  const lu = r.def.react?.lure;
  if (lu) { const d = (lu.mode === "catch" ? 1.6 : lu.mode === "swim" ? 1.4 : 0.9) * walkRuntime.humanScale; ritualCam.targets.push({ x: av.x + Math.sin(av.heading) * d, z: av.z + Math.cos(av.heading) * d, y: (av.y ?? 0) + (lu.mode === "catch" ? 1.25 * walkRuntime.humanScale : 0.08) }); }
  // ACTIVITY-CAM: etkinlik kadrajı girdileri (bakış, oturak, ritüel, satıcı) ve ifade saati
  ritualCam.heading = r.sit ? r.sit.heading : av.heading; ritualCam.seatY = r.sit ? r.sit.y ?? null : null;
  ritualCam.def = r.def; ritualCam.sit = r.plan.sit;
  try { ritualCam.vendor = ritualVendor.at?.(a.x, a.z) ?? null; } catch { ritualCam.vendor = null; }
  ritualFeel.t0 = r.t0; ritualFeel.settleMs = r.plan.settleMs; ritualFeel.totalMs = r.plan.totalMs; ritualFeel.doneAt = 0;
  // ACTIVITY-FEEL (B3): yeme-içmede sipariş anı (satıcı dikişi; CITYLIFE bağlar)
  placeOrder(r);
  ritualTick(r.t0);
}
/** Yeme-içmede sipariş anı (bir kez; mekânlı ritüelde masaya yürümeden önce verilir). */
function placeOrder(r: Run): void {
  if (r.ordered || !(r.plan.held && (r.plan.eat || r.def.venue || r.def.act.motion === "sip"))) return;
  r.ordered = true;
  orderFromVendor({ by: "me", city: r.def.city, ritual: r.def.id, item: r.plan.held, x: r.anchor.x, z: r.anchor.z });
}

function cancelReason(r: Run): RitualCancelReason | null {
  const st = useWalkStore.getState();
  if (!st.active || st.world !== r.world || interiorRuntime.inside || cityRuntime.active !== (r.scope === "map")) return "left";
  if (walkRuntime.ride) return "ride";
  if (isMinigameActive()) return "minigame";
  if (r.approach) return null;
  const av = walkRuntime.avatar;
  if (Math.hypot(av.x - r.x0, av.z - r.z0) > RITUAL_MOVE_EPS) return "move";
  if (r.sit && walkRuntime.sit !== r.sit) return "move";
  return null;
}

/** Oturağa yürüyüş adımı: varınca oturur; kullanıcı başka yere yönelirse iptal; ulaşılamazsa ayakta (REAL-SEAT-001). */
function approachTick(r: Run, ap: Approach, now: number): void {
  const av = walkRuntime.avatar, st = useWalkStore.getState();
  const d = Math.hypot(av.x - ap.seat.x, av.z - ap.seat.z);
  const routing = !!av.route;
  if (routing) ap.moved = true;
  const ours = st.target !== null && st.target[0] === ap.goal[0] && st.target[1] === ap.goal[1];
  if (routing && !ours) { cancelRitual("move"); return; }
  if (!routing && (d <= RITUAL_SEAT_SNAP || (d <= RITUAL_SEAT_REACH && (ap.moved || now - ap.t0 > 250)))) { begin(r, ap.stand ? null : ap.seat, !!ap.stand); return; }
  const late = now - ap.t0 > RITUAL_APPROACH_MS;
  if ((!routing && (ap.moved || now - ap.t0 > 600)) || late) {
    // rota bitti ama oturağa varılmadı (ya da kullanıcı yürüyüşü kesti): ritüel yerindeysek ayakta, değilsek iptal
    const o = r.voff ?? [0, 0];
    if (r.vdir && behindCounter(r.vdir, r.anchor.x - o[0], r.anchor.z - o[1], av.x - o[0], av.z - o[1])) { cancelRitual("move"); return; }
    if (Math.hypot(av.x - r.anchor.x, av.z - r.anchor.z) <= RITUAL_RANGE + 0.5) {
      logDefect({ code: "REAL-SEAT-001", city: r.def.city, ritual: r.def.id, anchor: r.anchor.n, scope: r.scope, x: ap.seat.x, z: ap.seat.z, reason: "unreachable" });
      if (late && routing) useWalkStore.getState().setTarget(null);
      begin(r, null, true);
    } else cancelRitual("move");
  }
}

/** Kare/zamanlayıcı adımı: iptal koşulları, oturağa yürüyüş, hareket evresi ve bitiş. Tarayıcıda 100 ms'de bir kendiliğinden çağrılır. */
export function ritualTick(now = ritualRuntimeOpts.now()): void {
  const r = run;
  if (!r) return;
  const why = cancelReason(r);
  if (why) { cancelRitual(why); return; }
  if (r.approach) { approachTick(r, r.approach, now); return; }
  const ph = ritualPhaseAt(r.plan, now - r.t0);
  if (ph !== "settle" && !r.acted) act(r);
  if (r.plan.joyMs && (ph === "joy" || ph === "done") && !r.joyed) joy(r);
  if (ph === "done") finish(r);
}

/** ACTIVITY-FEEL (B3): yemek bitti — elde nesne biter, avatar sevinir (küçük sekme + tek kol havada; hareket azaltmada durağan kol)
 *  ve yüzü güler; oturuyorsa oturarak sevinir (kollar). Işıltı yalnız hareket azaltma kapalıyken. */
function joy(r: Run): void {
  r.joyed = true;
  ritualFx.held = null;
  ritualFx.motion = "cheer";
  ritualFeel.joy = true;
  if (!r.plan.calm) {
    const av = walkRuntime.avatar;
    ritualFx.burst = { kind: "sparkle", x: av.x, y: ritualBurstY("sparkle"), z: av.z, seq: ++burstSeq };
  }
}

function act(r: Run): void {
  r.acted = true;
  const { plan, anchor: a } = r;
  ritualFx.motion = plan.motion;
  ritualFx.lure = plan.lure ? { x: a.x, z: a.z, kinds: plan.lure.kinds, n: plan.lure.n, mode: plan.lure.mode, still: plan.lure.still, until: r.t0 + plan.totalMs } : null;
  ritualFx.burst = plan.burst ? { kind: plan.burst, x: a.x, y: ritualBurstY(plan.burst), z: a.z, seq: ++burstSeq } : null;
  if (plan.sfx) { try { playSfx(plan.sfx); } catch { /* ses yoksa sessiz */ } }
}

function clearRun(r: Run, keepSit: boolean): void {
  if (r.timer) clearInterval(r.timer);
  if (run === r) run = null;
  Object.assign(ritualFx, { active: null, held: null, motion: null, lure: null, burst: null } satisfies RitualFx);
  // ACTIVITY-CAM: yeme/içme bitişi (iptalde değil) — ifade ve kadraj kısa süre "mutlu" kalır
  ritualFeel.doneAt = keepSit && (ritualFeel.eat || ritualFeel.drink) ? ritualRuntimeOpts.now() : 0;
  ritualFeel.eat = false; ritualFeel.joy = false; ritualFeel.drink = false;
  if (!keepSit && r.sit && walkRuntime.sit === r.sit) walkRuntime.sit = null;
}

/** Süren ritüeli iptal eder (yoksa etkisiz). Duyuru ve anı yok. Oturuş da biter. */
export function cancelRitual(reason: RitualCancelReason = "manual"): void {
  const r = run;
  if (!r) return;
  clearRun(r, false);
  lastCancel = reason;
}
let lastCancel: RitualCancelReason | null = null;
/** Son iptalin nedeni (canlı denetim ve testler). */
export const ritualLastCancel = (): RitualCancelReason | null => lastCancel;

function finish(r: Run): void {
  // oturmalı ritüelde avatar oturmaya devam eder; yürüyünce kalkar (bugünkü bank davranışı)
  clearRun(r, true);
  const mid = ritualMemoryId(r.def);
  const repeat = doneOnce.has(mid);
  doneOnce.add(mid);
  lastDone.set(mid, ritualRuntimeOpts.now());
  const text = ritualText(r.def, "done");
  const { x, z } = r.anchor;
  say(text, x, 1.4, z);
  const ev: RitualDoneEvent = { id: r.def.id, city: r.def.city, memoryId: mid, scope: r.scope, world: r.world, anchor: r.anchor.n, repeat, at: Date.now() };
  let told = false;
  const memo = (v: unknown) => { if (v === true && !told) { told = true; say(t9n(ritualsMsg, "done_memory", { text }), x, 1.4, z); } };
  for (const fn of [...listeners]) {
    try {
      const out = fn(ev);
      if (out && typeof (out as Promise<unknown>).then === "function") (out as Promise<unknown>).then(memo, () => {});
      else memo(out);
    } catch { /* dinleyici hatası ritüeli bozmaz */ }
  }
}

/** Test kancası: soğuma ve oturum geçmişini sıfırlar, süren ritüeli iptal eder. */
export function resetRitualRuntime(): void {
  cancelRitual("manual");
  lastCancel = null;
  spotOf.id = "";
  lastDone.clear();
  doneOnce.clear();
}

/** ACTIVITY-FEEL (B4): taban şehir sahnesinin kurulmuş hâli (önbellekli; şehir rehberi kiosklarını bulur). */
export const ritualSceneBuilt = (world: string): Built | null => sceneBuilt(world);

/**
 * ACTIVITY-FEEL (B6): ritüelin şu anki dünyadaki konumları (sahne ya da şehir haritası; dünya koordinatı). Şehir rehberi "Yol
 * göster" hedefi için. Yürüme kapalıysa ya da iç mekândaysa boş.
 */
export function ritualAnchorsHere(def: RitualDef): RitualAnchor[] {
  const w = where();
  return w && w.city === def.city ? anchorsOf(def, w.src) : [];
}
