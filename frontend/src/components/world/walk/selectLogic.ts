/**
 * FIX-UX (A3) — Yakındakiler seçimi için saf işlevler (React/DOM yok; testler esbuild ile yükler).
 *
 * - `cycleTarget`: Tab / Shift+Tab bir sonraki / önceki hedefi **kimlikle** seçer. Liste yeniden sıralansa da seçim
 * sıçramaz (eski sıra numarası değil, seçili kimliğin listedeki yeri esas alınır). Tab avatarı yürütmez.
 * - `targetAction`: hedefin türüne göre Enter/F'nin yapacağı iş (konuş, aç, al, dokun).
 * - `arrivalStep`: "git ve aç" bekleyişinin her adımda kararı: aç, bekle, yeniden yürü ya da vazgeç. Hedef ajan yürüyüp
 * uzaklaşsa da kimlikle izlenir; yakınına varınca panel açılır (F'nin o an başka hedefe bakması önemli değil).
*/
import type { ProxKind } from "../../../voxel/walk/controller";

export interface Selectable { id: string; kind: ProxKind; dist: number; x: number; z: number }

/** Tab (+1) / Shift+Tab (−1): kimlikle sıradaki hedef; seçili yoksa ilk (ya da son). Boş listede null. */
export function cycleTarget(list: readonly Pick<Selectable, "id">[], current: string | null, dir: 1 | -1): string | null {
  if (!list.length) return null;
  const i = current ? list.findIndex((n) => n.id === current) : -1;
  if (i < 0) return list[dir > 0 ? 0 : list.length - 1].id;
  return list[(i + dir + list.length) % list.length].id;
}

export type TargetAction = "talk" | "open" | "take" | "touch" | "go";

/** Enter / F / Yakındakiler tıklamasının hedefteki işi (duyuru ve düğme metni için). */
export function targetAction(id: string, kind: ProxKind): TargetAction {
  if (id.startsWith("citystop:")) return "go";
  if (kind === "agent") return id.startsWith("ext:") ? "open" : "talk";
  if (kind === "souvenir") return "take";
  if (kind === "animal" || id.startsWith("hot:")) return "touch";
  if (kind === "board" || kind === "prop") return "open";
  return "go";
}

/** Panel bu mesafede (birim) açılır: etkileşim menzili (1,6) + karo yuvarlama payı. */
export const OPEN_RANGE = 1.85;
/** Yol bitti ama hedef bu kadar yakınsa yine açılır (dolu karo, masa başındaki ajan). */
export const NEAR_ENOUGH = 2.6;
/** Bekleyiş üst sınırı (ms) ve en çok yeniden yürüme sayısı. */
export const PENDING_TIMEOUT_MS = 25_000;
/** avatar yolda ve hedefe yaklaşıyorsa (`progress`; uzun şehir yürüyüşü: 19 adım ≈ 25 sn) bekleyiş bu sınıra dek
 * sürer — eskiden 25. sn'de düşüyor, bilgi kartından "oraya yürü ve başlat" denen ritüel varınca başlamıyordu (<city> tapas).
 * Takılan (yaklaşmayan) avatar yine `PENDING_TIMEOUT_MS`'de düşer.*/
export const PENDING_MOVING_MS = 120_000;

/**
 * HQA-FIX (<city> şehir haritası) — "git ve aç" ilerleme izi. Kök neden: ilerleme yalnız hedefe KUŞ UÇUŞU uzaklıkla ölçülüyordu.
 * Nehir/köprü dolanan rotada (10 adımlık geçide 40 karoluk yol) avatar uzun süre hedeften uzaklaşır; 4 sn yaklaşmayınca "ilerlemiyor"
 * sayılıp 25. sn'de bekleyiş düşüyor, "hedefine ulaşılamadı" deniyordu (avatar hâlâ yürürken). Şimdi rotanın kalan karo sayısı da
 * ilerlemedir: azaldıkça (ya da yeni rota kurulunca) ilerleme saati yenilenir.
*/
export interface ProgressTrack { best: number; closerAt: number; bestLeft: number; route: unknown; /** HQA-FIX: rotanın son karosu*/ end?: readonly [number, number] | null }
export function trackProgress(j: ProgressTrack, goalDist: number, route: readonly unknown[] | null, routeIdx: number, now: number): void {
  if (goalDist < j.best - 0.25) { j.best = goalDist; j.closerAt = now; }
  const left = route ? route.length - routeIdx : Infinity;
  if (route !== j.route) { j.route = route; j.bestLeft = left; if (route) { j.closerAt = now; j.end = (route[route.length - 1] as readonly [number, number]) ?? null; } }
  else if (left < j.bestLeft) { j.bestLeft = left; j.closerAt = now; }
}
/** HQA-FIX: rota bitti, avatar rotanın son noktasında (bu pay içinde) ve hedef bu kadar yakınsa açılır — son nokta planlayıcının
 * hedefe en yakın ulaşılabilir karosudur (rıhtım korkuluğu, alçak havuz, portal çerçevesi); yeniden yürümek aynı karoya döner, eskiden
 * üç yeniden yürümeden sonra "ulaşılamadı" deniyordu (<city>/Londra/Şanghay: hedefe 2–5 adım kala).*/
export const END_TOL = 0.75;
export const END_REACH_MAX = 5.2;
export const MAX_REWALKS = 3;
/** Hedef (yürüyen ajan) son yürüme noktasından bu kadar uzaklaştıysa yol yenilenir. */
export const DRIFT = 1.5;
/** Yürüme komutundan sonra yol kurulana dek "durdu" sayılmaz (ms). */
export const ROUTE_GRACE_MS = 450;

export interface ArrivalInput {
  /** hedefin avatara uzaklığı; hedef Yakındakiler'de değilse null */
  dist: number | null;
  /** etkileşim hedefi (F) şu an bu kimlik */
  focused: boolean;
  /** avatar yolda (tıkla-git hedefi ya da rota var) */
  moving: boolean;
  /** son yürüme komutundan beri geçen süre (ms) */
  sinceWalkMs: number;
  /** bekleyişin başından beri geçen süre (ms) */
  elapsedMs: number;
  rewalks: number;
  /** hedefin son yürüme noktasından uzaklaşması (birim) */
  drift: number;
  /** avatarın yürüme noktasına uzaklığı — hedef Yakındakiler'den düştüyse (kalabalık pazar holü) varışı bu söyler*/
  goalDist?: number;
  /** avatar son birkaç saniyede yürüme noktasına yaklaştı (ilerliyor)*/
  progress?: boolean;
  /** HQA-FIX: avatarın son rotanın bitiş noktasına uzaklığı (rota kurulmadıysa yok)*/
  endDist?: number;
}

export type ArrivalStep = "open" | "wait" | "rewalk" | "fail";

export function arrivalStep(p: ArrivalInput): ArrivalStep {
  if (p.dist !== null && (p.focused || p.dist <= OPEN_RANGE)) return "open";
  if (p.elapsedMs > (p.moving && p.progress ? PENDING_MOVING_MS : PENDING_TIMEOUT_MS)) return "fail"; // ilerlerken süre uzar
  const settling = p.moving || p.sinceWalkMs < ROUTE_GRACE_MS;
  if (p.dist === null) {
    if (settling) return "wait";
    if (p.goalDist !== undefined && p.goalDist <= NEAR_ENOUGH) return "open";
    // HQA-FIX: hedef Yakındakiler'den düştüyse de (ağacın/derenin arkasındaki hatıra) rota bittiyse ve avatar rotanın ucundaysa
    // yürüme noktası END_REACH_MAX içinde açılır — kuralı listedeki hedeflerle sınırlıydı
    if (p.endDist !== undefined && p.endDist <= END_TOL && p.goalDist !== undefined && p.goalDist <= END_REACH_MAX) return "open";
    return "fail";
  }
  if (settling) return p.drift > DRIFT && p.rewalks < MAX_REWALKS && p.sinceWalkMs >= ROUTE_GRACE_MS ? "rewalk" : "wait";
  if (p.dist <= NEAR_ENOUGH) return "open";
  if (p.endDist !== undefined && p.endDist <= END_TOL && p.dist <= END_REACH_MAX) return "open"; // HQA-FIX
  return p.rewalks < MAX_REWALKS ? "rewalk" : "fail";
}

// ------------------------------------------------------------------ Yakındakiler önceliği ve gruplama
/**
 * — öncelik katmanı (küçük önce). Hem Yakındakiler'in 12 sınırı
 * (controller `nearbyPolicy`) hem F hedefi bu sırayı kullanır; katman içinde mesafe ve bakış puanı eskisi gibi.
 * 0 yapılacak: ritüel (`hot:rt:`), gözlem çarkı (`hot:wheel`), teleferik (`hot:cablecar`), ajan, pano, hatıra ve keşif parçası, masa/atış oyunu,
 * iç mekân geçişi (portal, merdiven), "Şehre çık" kapısı (`citydoor:`, UXF-B)
 * 1 gör: bilgi kartı (`info:`), bilgi noktası (`poi:`), seyir noktası, simge, kapı
 * 2 dinlen: oturma, kahve, olta yeri ve öteki nesneler
 * 3 hayvan
 * 4 süs: ağaç, çiçek, lamba, su, akvaryum (`hot:<n>`)
*/
export type NearbyTier = 0 | 1 | 2 | 3 | 4;
/** geçit girdisinin F önceliği: karonun merkezinden en çok bu kadar (köşegen komşu 1,41) */
export const PORTAL_FOCUS_DIST = 1.5;
export function nearbyTier(id: string, kind: ProxKind, dist = Infinity): NearbyTier {
  if (id.startsWith("hot:rt:") || id.startsWith("hot:wheel") || id.startsWith("hot:cablecar") || id.startsWith("hot:guide:")) return 0; // ACTIVITY-FEEL: şehir rehberi kioskü
  if (kind === "agent" || kind === "board" || kind === "souvenir") return 0;
  if (id.startsWith("table:") || id.startsWith("toss:") || id.startsWith("portal:") || id.startsWith("stair:")) return 0;
  // UXF-B: "Şehre çık" kapısı (şehir haritası girişi) — yapılacak
  if (id.startsWith("citydoor:")) return 0;
  // CORE-WALK: şehir haritasındaki geri dönüş geçidi
  if (id.startsWith("citygate:")) return 0;
  // UXF-E: ulaşım durakları (`citystop:`) — yapılacak
  if (id.startsWith("citystop:")) return 0;
  // PORTAL-INTENT-001: iç mekânlı landmark kapısı / sahne kapısı geçittir, girmek F ister — avatar kapının karosunda ya da 1 karo
  // yanındayken (`PORTAL_FOCUS_DIST`) F onu seçer (simge bilgi kartı çalamaz); uzakta eski katmanı (kapı "Gör", landmark kapısı "Yapılacak")
  if ((id.startsWith("citylm:") || id.startsWith("door:")) && dist <= PORTAL_FOCUS_DIST) return 0;
  // şehir seyir karosunun dürbünü — yapılacak; su kenarındaki karoda olta yerinin (2) önünde
  if (id.startsWith("cityvp:")) return 0;
  if (kind === "landmark" || id.startsWith("info:") || id.startsWith("poi:") || id.startsWith("door:") || id.startsWith("vp:")) return 1;
  if (kind === "animal" || id.startsWith("animal:")) return 3;
  if (id.startsWith("hot:")) return 4;
  return 2;
}

/**
 * sabit hedef — yerinden oynamayan geçit/durak/kapı/asansör/seyir noktası. Menzildeyken ve oyuncu ona bakıyorken F bunu açar;
 * yanından geçen figüran/ajan/hayvan ve satıcı ritüeli öne geçmez (`controller.pickInteractTarget`).
*/
const FIXED_PREFIXES = ["citystop:", "citydoor:", "citygate:", "citylm:", "wzdoor:", "door:", "stair:", "lift:", "vp:", "cityvp:"] as const;
export const isFixedTarget = (id: string): boolean => FIXED_PREFIXES.some((p) => id.startsWith(p));
/** durak F menzili (`controller.nearbyPolicy.reach`): paneli duraktan 2 karoya dek açılan 5 durakta varış karosu varsayılan menzilin dışındaydı.*/
export const fixedReach = (id: string): number => (id.startsWith("citystop:") ? 3 : 0);

/** Bölüm: "Yapılacak" (0, 2) · "Gör" (1) · "Çevre" (3, 4; varsayılan kapalı). */
export type NearbySection = "do" | "see" | "around";
export const NEARBY_SECTIONS: readonly NearbySection[] = ["do", "see", "around"];
export const sectionOf = (tier: NearbyTier): NearbySection => (tier === 1 ? "see" : tier >= 3 ? "around" : "do");
/** Bu katmandan itibaren aynı adlı öğeler tek satıra katlanır ("Su ×8"); bilgi ve ajan hiç katlanmaz; ritüel yalnız aynı
 *  ritüel kimliğiyle (UXF-D, `ritualKeyOf`) tek satır olur. */
export const COLLAPSE_FROM: NearbyTier = 2;

export interface NearbyRow<T> {
  /** satır anahtarı (grupta "g:<ad>", tekte kimlik) */
  key: string;
  /** satırın hedefi: grubun en yakını */
  item: T;
  name: string;
  /** gruptaki öğe sayısı (tekte 1) */
  count: number;
  tier: NearbyTier;
  section: NearbySection;
}
export interface NearbyGroup<T> { section: NearbySection; rows: NearbyRow<T>[] }

/**
 * Yakındakiler satırları: öncelik katmanına, sonra mesafeye göre sıralı; katman ≥ `COLLAPSE_FROM` olan aynı adlı öğeler
 * tek satır (en yakını hedef, `count` adet). Boş bölüm dönmez; bölüm sırası sabit.
 */
export function groupNearby<T extends { id: string; kind: ProxKind; dist: number }>(items: readonly T[], nameOf: (it: T) => string): NearbyGroup<T>[] {
  const sorted = items.map((it) => ({ it, tier: nearbyTier(it.id, it.kind) }))
    .sort((a, b) => a.tier - b.tier || a.it.dist - b.it.dist || (a.it.id < b.it.id ? -1 : a.it.id > b.it.id ? 1 : 0));
  const rows: NearbyRow<T>[] = [];
  const byName = new Map<string, NearbyRow<T>>();
  for (const { it, tier } of sorted) {
    const name = nameOf(it);
    if (tier >= COLLAPSE_FROM) {
      const gk = `${tier}:${name.toLocaleLowerCase()}`;
      const g = byName.get(gk);
      // UXF-E: olta yerleri "×N" olmadan tek satır (hedef en yakın yer); öbür süsler ("Su ×8") katlanıp sayılır
      if (g) { if (!it.id.startsWith("fish:")) g.count++; continue; }
      const row: NearbyRow<T> = { key: `g:${gk}`, item: it, name, count: 1, tier, section: sectionOf(tier) };
      byName.set(gk, row);
      rows.push(row);
      continue;
    }
    // UXF-D (lider kararı): aynı ritüel kimliği birden çok bağlantı noktasında → tek satır, hedef en yakın nokta
    // (sıralama mesafeye göre olduğundan ilk gelen en yakındır). Farklı ritüeller, adları aynı olsa da asla katlanmaz.
    const rk = ritualKeyOf(it.id);
    if (rk) {
      if (byName.has(rk)) continue;
      const row: NearbyRow<T> = { key: rk, item: it, name, count: 1, tier, section: sectionOf(tier) };
      byName.set(rk, row);
      rows.push(row);
      continue;
    }
    rows.push({ key: it.id, item: it, name, count: 1, tier, section: sectionOf(tier) });
  }
  const out: NearbyGroup<T>[] = [];
  for (const section of NEARBY_SECTIONS) {
    // bölüm içinde: önce katman ("Yapılacak": ritüel ve ajan, sonra oturma/kahve), sonra mesafe
    const r = rows.filter((x) => x.section === section);
    if (r.length) out.push({ section, rows: r });
  }
  return out;
}

/** UXF-D: `hot:rt:<ritüel>:<n>` → `rt:<ritüel>` (aynı ritüelin noktaları için satır anahtarı); ritüel değilse null.*/
export function ritualKeyOf(id: string): string | null {
  if (!id.startsWith("hot:rt:")) return null;
  const rest = id.slice(7), k = rest.lastIndexOf(":");
  return `rt:${k > 0 ? rest.slice(0, k) : rest}`;
}

/** Tab sırası: görünen satırların hedefleri (gruptan yalnız en yakını), bölüm sırasıyla. */
export const nearbyCycleOrder = <T>(groups: readonly NearbyGroup<T>[]): T[] => groups.flatMap((g) => g.rows.map((r) => r.item));
