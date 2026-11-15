/**
 * CAMERA (2026-10-28, ürün sahibi: "kameranın binaların içinden geçmesi ve şeffaflaşmalar çok acemice") — kamera çarpışma çözücüsü.
 * Araştırma ve eşleme:. Saf modül (three/React/depo yok; Node testinde de yüklenir).
 *
 * Oyunlardaki "yaylı kol" (Unreal SpringArm `ProbeSize` + `bDoCollisionTest`, Cinemachine Deoccluder `Camera Radius` +
 * "Pull Camera Forward", Godot SpringArm3D) yöntemi:
 * - **Küre süpürme:** pivottan (avatar göğsü) istenen kamera noktasına `radius` yarıçaplı küre süpürülür; ilk değen katı kutuda
 * durulur ve `margin` kadar geri çekilir. Yarıçap yakın düzlemin köşe uzaklığından türetilir (`probeRadius`): yakın düzlem hiçbir
 * zaman duvara girmez (köşeden komşu odaya "bakma" yok — Undersander, "Accurate collision zoom for cameras").
 * - **Hızlı içeri, yavaş dışarı** (`stepArm`): engel yaklaşınca kol AYNI karede kısalır (kamera hiçbir karede katının içinde
 * değil); engel kalkınca `EASE_OUT` hızıyla uzar (Cinemachine "Damping When Occluded" ≈ 0, "Damping" > 0). Hareket azaltmada
 * anında.
 * - **Kaldırma yedeği** (`solveArm`): kol `LIFT_TRIGGER`'dan kısa kalırsa (sırtı duvara dayalı avatar) aynı yaw'da daha dik
 * yükselişler denenir; en uzun açık kol seçilir (Nesky, GDC 2014 "50 Camera Mistakes" #11–12: geri değil yukarı).
 * - **Bıyıklar** (`whiskerLimit`): kolun iki yanına (± `WHISKER_YAW`) süpürme; yan bıyık köşeye merkezden önce değer ve kol
 * köşe kadraja girmeden kısalmaya başlar. Yaw'a dokunmaz (otomatik dönüş yok: yürüme yönü kameraya göre kalır).
 * - **İnce engeller geçilir** (Nesky #9): direk, lamba, ağaç gövdesi, ince süs çarpışmaya girmez (`collidable`); onları
 * gölgelendiricideki görüş konisi titreşimi (walk/cover.ts `CUT_LOS`) avatarın önünden açar.
*/

export type V3 = readonly [number, number, number];
export interface Box { p: readonly number[]; s: readonly number[]; g?: string }
/** Bölgedeki kutular (x0, z0, x1, z1 dünya dikdörtgeni): `out`a eklenir (kare başına dizi üretmesin diye). */
export type BoxSource = (x0: number, z0: number, x1: number, z1: number, out: Box[]) => void;

/** Kamera ile katı arasındaki en az boşluk payı (yarıçapın üstüne; birim). */
export const ARM_MARGIN = 0.04;
/** Taban küre yarıçapı: walk/cover.ts `CAM_BUBBLE` (0,3) kabarcığı katıya hiç değmesin diye ondan büyük. */
export const ARM_RADIUS = 0.32;
/** Kolun en kısa boyu (pivot göğüs; baş ~0,1 yukarıda). Bundan kısası WalkRig'de "göz" yedeğine düşer (avatar gizlenir). */
export const ARM_MIN = 0.35;
/** Kol bundan kısaysa (birim) WalkRig göz yedeğine geçer (birinci şahıs gözü, avatar gizli; baş ekranı kaplamaz).*/
export const ARM_EYE = 0.5;
/**
 * iç mekânda (oda/salon/koridor) kol bundan kısaysa (göğüsten kameraya) kamera baş çevresinde kalır — baş (saç/yüz) kare ortasını kaplıyordu
 * (<city> arena Saha holü, Kız Kulesi koridoru: 12 karenin ~5'i). İç mekânda göz yedeği bu eşikte devreye girer (avatar gizli, baş kare dışı); `ARM_EYE` dış dünyada kalır.
*/
export const ARM_EYE_INDOOR = 1.3;
/** iç mekân göz yedeği eşiği yatay görüşe göre — dikey telefonda (yatay ≈ 40°) 1,3–1,5 birimlik kolda baş (0,45) karenin
 * yarısını kaplıyordu ("avatarın sırtı + düz duvar"). Baş genişliği yatay görüşün en çok %30'u olacak uzaklıktan kısa kolda göz yedeği.
 * Masaüstü/yatay telefonda (yatay ≥ ~60°) ARM_EYE_INDOOR aynen. `hfov` radyan.*/
/** (karar 2026-11-05 "Avatar daha büyük görünsün"): dikey telefonda (yatay görüş < PHONE_HFOV) dar iç mekânda (tek karolu giriş, koy, koridor)
 * kamera ~2,06 birim kol bulamıyorsa göz yedeğine DÜŞMEZ (avatar gizlenmez): kola sığdığı kadar yaklaşır, avatar ekranda büyük görünür. Baş ≤ %30 sınırı yalnız bu dar pozlarda
 * gevşer; eşik dış dünyadaki ARM_EYE (0,5). Masaüstü/yatay telefonda eski kural.*/
export const PHONE_HFOV = 1.4;
/** ARM_EYE (0,5) + WalkRig güvenlik ağı (`CAM_HIDE_DIST` 0,9) telefonda hâlâ avatarı gizliyordu (<city> Arena koridoru: kamera–baş 0,13 m; <city> Zafer takı 0,69 m).
 * Dikey telefonda göz yedeği yalnız kol ARM_MIN'den (0,35) kısaysa, güvenlik ağı yalnız kamera baş küresine (r 0,25 + pay) girerse (`PHONE_HIDE_DIST`) — arası avatar iri görünür.*/
export const PHONE_HIDE_DIST = 0.3;
export const armEyeIndoor = (hfov: number) => (hfov < PHONE_HFOV ? ARM_MIN : Math.max(ARM_EYE_INDOOR, 0.45 / (0.6 * Math.tan(hfov / 2))));
/** göz yedeğinden çıkış histerezisi — dikey telefonda +0,2 kol 0,35–0,55 arasını yürürken göz kipinde tutuyordu (avatar gizli); orada 0 (kol yumuşatmalı, eşik ARM_MIN).*/
export const eyeHyst = (hfov: number) => (hfov < PHONE_HFOV ? 0 : 0.2);
/** Figüran/ajan arkada olunca göz yedeği eşiği: dikey telefonda iç mekânda ARM_MIN (statik kuralla aynı), aksi halde ARM_EYE. */
export const crowdEyeDist = (indoor: boolean, hfov: number) => (indoor && hfov < PHONE_HFOV ? ARM_MIN : ARM_EYE);
/** WalkRig güvenlik ağı eşiği (başa uzaklık): dikey telefonda iç mekânda `PHONE_HIDE_DIST`, aksi halde `outdoor` (CAM_HIDE_DIST). */
export const hideDistIndoor = (hfov: number, outdoor: number) => (hfov < PHONE_HFOV ? PHONE_HIDE_DIST : outdoor);
/** Engel kalkınca uzama hızı (1/sn; ~0,3 sn zaman sabiti). İçeri çekilme anlık. */
export const EASE_OUT = 3.2;
/** Kaldırma yedeği: kol bundan kısaysa (birim) daha dik yükselişler denenir. */
export const LIFT_TRIGGER = 2.4;
export const LIFT_ELEVS = [0.7, 1.0, 1.3] as const;
/** Omuz üstü yedeği: kaldırma da sığmazsa yaw kaymaları (rad; walk/cover.ts `SHOULDER_YAW` ile aynı aile). */
export const SHOULDER_YAWS = [0.55, -0.55, 1.1, -1.1, Math.PI / 2, -Math.PI / 2] as const;
/** Bıyık açısı (rad; ~11°: 2 karoluk sokakta yan duvara erken değmez) ve merkezle karışım payı (0 → etkisiz). */
export const WHISKER_YAW = 0.2;
export const WHISKER_BLEND = 0.5;
/** bıyıklar zeminden (floorTop) bu kadar alçak katıları (tabure oturağı, alçak bank) görmez — avatarın yanındaki tabure kolu yarıya kısaltıyordu (kol 4,6 → 1,3 m). Sert süpürme (kol) bunları yine görür.*/
export const WHISKER_LOW = 0.35;

/** İnce eşiği (birim): yatayda en ince kenarı bunu aşmayan ve küçük hacimli blok (direk, ağaç gövdesi 0,3) geçilir. */
export const THIN = 0.32;
/** Çarpışmaya giren gruplar: yalnız durağan katı/cam/ışıklı bloklar (su, bulut, kar, bayrak, dönen ve sallanan parçalar değil). */
const SOLID_GROUPS = new Set(["solid", "glass", "glow"]);

/**
 * Kutu kamera çarpışmasına girer mi: durağan katı grup, tepesi `floorTop`'un üstünde (zemin, yol, kaldırım değil), ince değil
 * (yatayda en ince kenar > `THIN` ya da hacim ≥ 0,6: direk, lamba, ağaç gövdesi, tabela ayağı geçilir; tente/balkon/duvar girer).
 */
export function collidable(b: Box, floorTop = 0.2): boolean {
  if (b.g !== undefined && !SOLID_GROUPS.has(b.g)) return false;
  if (b.p[1] + b.s[1] / 2 <= floorTop) return false;
  const thin = Math.min(b.s[0], b.s[2]);
  return thin > THIN || b.s[0] * b.s[1] * b.s[2] >= 0.6;
}

/** ince ama GÖRÜNEN durağan katı (çarpışmaya girmeyen direk, gövde): kamera noktası ona bu yarıçaptan yakın olamaz (yakın düzlem köşesi 0,22 + pay).*/
export const THIN_CAM_R = 0.25;
export function thinSolid(b: Box, floorTop = 0.2): boolean {
  return (b.g === undefined || SOLID_GROUPS.has(b.g)) && b.p[1] + b.s[1] / 2 > floorTop + 0.1;
}

/** Yakın düzlemin köşesinin kameraya uzaklığı (dikey görüş açısı derece, en/boy oranı). */
export function nearCorner(near: number, vfovDeg: number, aspect: number): number {
  const th = Math.tan((vfovDeg * Math.PI) / 360);
  return near * Math.sqrt(1 + th * th * (1 + aspect * aspect));
}
/** Küre yarıçapı: yakın düzlem köşesi + pay, en az `ARM_RADIUS`. */
/** dikey telefonda (aspect < 1) YALNIZ iç mekânda (`tight`) ARM_RADIUS tabanı yok (dış mekânda arrival_check rotası bozuluyordu) — yalnız yakın düzlem köşesi + pay; 1 karolu alçak koridorda 0,32 kabarcığı kolu < 0,35'e indirip avatarı gizliyordu.*/
export const probeRadius = (near: number, vfovDeg: number, aspect: number, tight = false) => (tight && aspect < 1 ? nearCorner(near, vfovDeg, aspect) + ARM_MARGIN : Math.max(ARM_RADIUS, nearCorner(near, vfovDeg, aspect) + ARM_MARGIN));

/**
 * Doğru parçası a + t·(b − a), t ∈ [0, 1], kutuya (yarı boy + `r` genişletilmiş) ilk giriş t'si; değmiyorsa Infinity. Başlangıç
 * kutuya `r`'den yakınsa (avatarın yanındaki duvar) yarıçap o uzaklığa indirilir: kol duvara başladığından daha çok yaklaşamaz
 * (içinden geçemez, boyunca kayarken de sürtünmez) ama yanındaki duvar kolu sıfıra indirmez. Başlangıç kutunun içindeyse yok sayılır.
 */
export function sweepBox(a: V3, b: V3, c: readonly number[], h: readonly number[], r: number): number {
  // genişletilmiş kutu eksen hizalı (Minkowski toplamının kutu yaklaşımı): başlangıcın dışarıda kalması eksen başına boşluğa bağlı
  let d0 = 0;
  for (let k = 0; k < 3; k++) d0 = Math.max(d0, Math.abs(a[k] - c[k]) - h[k]);
  if (d0 >= r) { const t = slab(a, b, c, h, r); return t >= 0 ? t : Infinity; }
  if (d0 <= 1e-6) return Infinity;
  const t = slab(a, b, c, h, Math.max(0, d0 - 0.005));
  return t > 0 ? t : Infinity;
}
function slab(a: V3, b: V3, c: readonly number[], h: readonly number[], r: number): number {
  let t0 = -Infinity, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k], lo = c[k] - h[k] - r, hi = c[k] + h[k] + r;
    if (Math.abs(d) < 1e-9) { if (a[k] < lo || a[k] > hi) return Infinity; continue; }
    let ta = (lo - a[k]) / d, tb = (hi - a[k]) / d;
    if (ta > tb) { const x = ta; ta = tb; tb = x; }
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return Infinity;
  }
  if (t1 < 0 || t0 > 1) return Infinity;
  return t0;
}

const _boxes: Box[] = [];
/**
 * Pivottan hedefe küre süpürmesi: açık kol boyu (birim; engel yoksa tam uzunluk). `floorTop`: zemin eşiği (pivot ayağı + pay).
 */
export function sweepArm(src: BoxSource, from: V3, to: V3, radius: number, floorTop: number): number {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  if (len < 1e-6) return 0;
  _boxes.length = 0;
  const pad = radius + 0.5;
  src(Math.min(from[0], to[0]) - pad, Math.min(from[2], to[2]) - pad, Math.max(from[0], to[0]) + pad, Math.max(from[2], to[2]) + pad, _boxes);
  let best = 1;
  const h = [0, 0, 0];
  for (const b of _boxes) {
    if (!collidable(b, floorTop)) continue;
    h[0] = b.s[0] / 2; h[1] = b.s[1] / 2; h[2] = b.s[2] / 2;
    const t = sweepBox(from, to, b.p, h, radius);
    if (t < best) best = t;
  }
  // ince katı son nokta temizliği yalnız solveArm'ın son kolunda (bıyık/aday/yolculuk süpürmelerine sızınca yandaki direk kolu kısaltıyordu)
  return best >= 1 ? len : Math.max(0, best * len - ARM_MARGIN);
}

/**
 * ince katılar (ağaç gövdesi, direk, tabela ayağı) kolu kesmez ama kolun SON noktası (kamera) içlerine girmez:
 * `from` + `u`·`len` bir ince katının (`THIN_CAM_R` şişirilmiş) içindeyse kol o katının giriş noktasına kısalır (direk sırasında
 * art arda). Kutular `_boxes`ta (sweepArm bölgeyi okumuş olmalı).
*/
const _h = [0, 0, 0], _e: [number, number, number] = [0, 0, 0];
function thinClear(from: V3, ux: number, uy: number, uz: number, len: number, floorTop: number): number {
  const h = _h;
  let out = len;
  for (let it = 0; it < 8; it++) {
    const e = _e; e[0] = from[0] + ux * out; e[1] = from[1] + uy * out; e[2] = from[2] + uz * out;
    let tHit = 1;
    for (const b of _boxes) {
      if (collidable(b, floorTop) || !thinSolid(b, floorTop)) continue;
      let inside = true;
      for (let k = 0; k < 3 && inside; k++) inside = Math.abs(e[k] - b.p[k]) < b.s[k] / 2 + THIN_CAM_R;
      if (!inside) continue;
      h[0] = b.s[0] / 2; h[1] = b.s[1] / 2; h[2] = b.s[2] / 2;
      const t = sweepBox(from, e, b.p, h, THIN_CAM_R);
      if (t < tHit) tHit = t;
    }
    if (tHit >= 1) break;
    out = Math.max(0, tHit * out - ARM_MARGIN);
  }
  return out;
}
/** Son kol boyunu (örn. bıyık sonrası) ince katılara göre yeniden temizler; sweepArm bölgesiyle aynı kutu kümesi. */
export function thinClearLen(src: BoxSource, from: V3, u: V3, len: number, floorTop: number): number {
  _boxes.length = 0;
  src(from[0] + Math.min(0, u[0] * len) - 0.8, from[2] + Math.min(0, u[2] * len) - 0.8, from[0] + Math.max(0, u[0] * len) + 0.8, from[2] + Math.max(0, u[2] * len) + 0.8, _boxes);
  return thinClear(from, u[0], u[1], u[2], len, floorTop);
}

/** Nokta katı bir kutunun içinde mi ya da ona `r`'den yakın mı (kamera güvenlik denetimi; çarpışmaya giren kutular). */
export function pointBlocked(src: BoxSource, p: V3, r: number, floorTop: number): boolean {
  _boxes.length = 0;
  src(p[0] - r - 0.5, p[2] - r - 0.5, p[0] + r + 0.5, p[2] + r + 0.5, _boxes);
  for (const b of _boxes) {
    if (!collidable(b, floorTop)) continue;
    let d2 = 0;
    for (let k = 0; k < 3; k++) { const e = Math.max(0, Math.abs(p[k] - b.p[k]) - b.s[k] / 2); d2 += e * e; }
    if (d2 < r * r - 1e-9) return true;
  }
  return false;
}

/** Pivot itmesinin üst sınırı (birim): duvara yaslı avatarda kol pivotu duvardan en çok bu kadar uzaklaştırılır. */
export const NUDGE_MAX = 0.16;
/**
 * Pivot itmesi: avatar duvara/köşeye yaslıysa (pivot çarpışan bir kutuya yarıçaptan yakın) kolun başlangıcı yatayda kutudan
 * uzaklaştırılır — kamera duvar boyunca kayarken yakın düzlem duvara girmesin (Unreal'da kol pivotu gövdenin dışında). En çok
 * `NUDGE_MAX`; itilmiş nokta başka bir kutuya girerse itme yok. `out`a yazar, dönüş: itildi mi.
 */
export function nudgePivot(src: BoxSource, pivot: V3, radius: number, floorTop: number, out: [number, number, number]): boolean {
  out[0] = pivot[0]; out[1] = pivot[1]; out[2] = pivot[2];
  _boxes.length = 0;
  src(pivot[0] - radius - 0.5, pivot[2] - radius - 0.5, pivot[0] + radius + 0.5, pivot[2] + radius + 0.5, _boxes);
  let px = 0, pz = 0;
  for (const b of _boxes) {
    if (!collidable(b, floorTop)) continue;
    if (Math.abs(pivot[1] - b.p[1]) > b.s[1] / 2 + radius) continue;
    const gx = Math.abs(pivot[0] - b.p[0]) - b.s[0] / 2, gz = Math.abs(pivot[2] - b.p[2]) - b.s[2] / 2;
    if (gx >= radius || gz >= radius || (gx < 0 && gz < 0)) continue;
    // en yakın yüzün dışına (köşede iki eksen)
    if (gx > -1e-6 && gx < radius) px += Math.sign(pivot[0] - b.p[0]) * (radius - Math.max(0, gx));
    if (gz > -1e-6 && gz < radius) pz += Math.sign(pivot[2] - b.p[2]) * (radius - Math.max(0, gz));
  }
  const l = Math.hypot(px, pz);
  if (l < 1e-4) return false;
  const k = Math.min(1, NUDGE_MAX / l);
  out[0] = pivot[0] + px * k; out[2] = pivot[2] + pz * k;
  if (pointBlocked(src, out, 0.05, floorTop)) { out[0] = pivot[0]; out[2] = pivot[2]; return false; }
  return true;
}

// ------------------------------------------------------------------------------------------ kol durumu
export interface ArmState {
  /** şu anki kol boyu (birim); NaN → ilk kare (istenen boya oturur) */
  len: number;
  /** son karede engel kolu kısalttı mı */
  hit: boolean;
}
export const createArm = (): ArmState => ({ len: NaN, hit: false });
/** Bıyık (yumuşak) sınırına yaklaşma hızı (1/sn): önseziyle kısalma da yumuşak. */
export const EASE_SOFT = 6;

/**
 * Kol boyunu bir kare ilerletir. `hard`: küre süpürmesinin açık boyu — kol bundan uzun olamaz, AYNI karede kısalır (kamera katıya
 * girmez). `soft` (≤ hard): bıyık önsezisi — kol ona `EASE_SOFT` hızıyla yaklaşır. Engel kalkınca `EASE_OUT` hızıyla uzar;
 * hareket azaltmada her şey anında. Dönüş: yeni boy (her zaman ≤ hard).
 */
export function stepArm(arm: ArmState, desired: number, hard: number, dt: number, calm: boolean, soft = hard): number {
  const target = Math.min(desired, soft, hard);
  arm.hit = Math.min(soft, hard) < desired - 1e-3;
  const k = (rate: number) => 1 - Math.exp(-Math.max(0, dt) * rate);
  if (!Number.isFinite(arm.len) || calm) arm.len = target;
  else if (target < arm.len) arm.len += (target - arm.len) * k(EASE_SOFT);
  else arm.len += (target - arm.len) * k(EASE_OUT);
  arm.len = Math.max(0, Math.min(arm.len, hard));
  return arm.len;
}

export interface ArmPose {
  /** kol doğrultusu (birim vektör) ve istenen boy */
  ux: number; uy: number; uz: number; desired: number;
  /** küre süpürmesinin açık boyu (sert sınır) ve bıyık sınırı (yumuşak; ≤ hard) */
  hard: number; soft: number;
  /** kaldırma ya da omuz üstü yedeği seçildi mi (bakış avatara döner) ve yükseliş (rad) */
  lifted: boolean; elev: number;
}

/**
 * Kolu çözer: pivot → istenen kamera doğrultusunda açık boy; çok kısaysa (`LIFT_TRIGGER`) aynı yaw'da dik yükselişler (yalnız
 * `allowLift`) ve en uzun açık kol; `whiskers` → bıyık sınırı. Saf: kol durumu değişmez (çağıran `stepArm` ile yumuşatır).
 */
export function solveArm(src: BoxSource, pivot: V3, cam: V3, o: { radius: number; floorTop: number; allowLift?: boolean; whiskers?: boolean;
  /** INTERIOR-CAM: kaldırma yükselişinin üst sınırı (rad; iç mekânda tepeden "bebek evi" bakışı yerine omuz üstü yan bakış) */
  maxElev?: number }, out?: ArmPose): ArmPose {
  const r: ArmPose = out ?? { ux: 0, uy: 0, uz: 1, desired: 0, hard: 0, soft: 0, lifted: false, elev: 0 };
  const dx = cam[0] - pivot[0], dy = cam[1] - pivot[1], dz = cam[2] - pivot[2];
  const desired = Math.hypot(dx, dy, dz);
  let hard = sweepArm(src, pivot, cam, o.radius, o.floorTop);
  r.ux = desired > 1e-6 ? dx / desired : 0; r.uy = desired > 1e-6 ? dy / desired : 0; r.uz = desired > 1e-6 ? dz / desired : 1;
  r.lifted = false; r.elev = Math.asin(Math.max(-1, Math.min(1, r.uy)));
  if (o.allowLift && hard < Math.min(desired, LIFT_TRIGGER)) {
    const hl = Math.hypot(dx, dz) || 1, hx = dx / hl, hz = dz / hl;
    for (const e of LIFT_ELEVS) {
      if (e <= r.elev + 0.05 || e > (o.maxElev ?? Infinity)) continue;
      const ce = Math.cos(e), se = Math.sin(e);
      const to: V3 = [pivot[0] + hx * ce * desired, pivot[1] + se * desired, pivot[2] + hz * ce * desired];
      const f = sweepArm(src, pivot, to, o.radius, o.floorTop);
      if (f > hard + 0.35) { hard = f; r.ux = hx * ce; r.uy = se; r.uz = hz * ce; r.lifted = true; r.elev = e; }
      if (hard >= Math.min(desired, LIFT_TRIGGER)) break;
    }
    // omuz üstü: aynı (ya da kaldırılmış) yükseliş, yaw kaydırılmış — sırtı köşeye/tezgâha dayalı avatar
    if (hard < Math.min(desired, LIFT_TRIGGER)) {
      const e0 = Math.asin(Math.max(-1, Math.min(1, dy / (desired || 1))));
      shoulder: for (const e of [e0, Math.min(Math.max(e0, LIFT_ELEVS[1]), Math.max(e0, o.maxElev ?? Infinity))]) {
        const ce = Math.cos(e), se = Math.sin(e);
        for (const w of SHOULDER_YAWS) {
          const c = Math.cos(w), sn = Math.sin(w), qx = hx * c + hz * sn, qz = -hx * sn + hz * c;
          const f = sweepArm(src, pivot, [pivot[0] + qx * ce * desired, pivot[1] + se * desired, pivot[2] + qz * ce * desired], o.radius, o.floorTop);
          if (f > hard + 0.35) { hard = f; r.ux = qx * ce; r.uy = se; r.uz = qz * ce; r.lifted = true; r.elev = e; }
          if (hard >= Math.min(desired, LIFT_TRIGGER)) break shoulder;
        }
      }
    }
  }
  hard = thinClearLen(src, pivot, [r.ux, r.uy, r.uz], hard, o.floorTop); // kamera ince katının (gövde, direk) içinde bitmez
  let soft = hard;
  if (o.whiskers && !r.lifted && hard > ARM_MIN) {
    const w = whiskerLimit(src, pivot, cam, o.radius, o.floorTop);
    if (w < hard) soft = Math.max(ARM_MIN, hard + (w - hard) * WHISKER_BLEND);
  }
  soft = Math.min(soft, hard);
  if (soft < hard) soft = thinClearLen(src, pivot, [r.ux, r.uy, r.uz], soft, o.floorTop); // bıyıkla kısalan kol da gövdede bitmesin
  r.desired = desired; r.hard = hard; r.soft = soft;
  return r;
}

/**
 * Bıyıklar (köşe önsezisi): kolun yatay doğrultusu ± `WHISKER_YAW` döndürülüp iki yana süpürülür. Kamera bir köşeye doğru
 * dönerken (ya da avatar köşeyi dönerken) yan bıyık engele merkezden ÖNCE değer; kol, merkez çarpmadan biraz kısalmaya başlar
 * (`WHISKER_BLEND`), böylece köşe kadraja "pat" diye girmez (Nesky #5: engel kadraja girmeden yaklaş). Yaw'a dokunmaz:
 * yürüme yönü kameraya göre kalır, eylem kamerası (ACTIVITY-FEEL) pozları ezilmez. Dönüş: bıyık sınırı (birim; engel yoksa ∞).
 */
export function whiskerLimit(src: BoxSource, pivot: V3, cam: V3, radius: number, floorTop: number): number {
  const dx = cam[0] - pivot[0], dy = cam[1] - pivot[1], dz = cam[2] - pivot[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.5) return Infinity;
  let lim = Infinity;
  for (const w of [WHISKER_YAW, -WHISKER_YAW]) {
    const c = Math.cos(w), sn = Math.sin(w);
    const to: V3 = [pivot[0] + dx * c + dz * sn, pivot[1] + dy, pivot[2] - dx * sn + dz * c];
    const f = sweepArm(src, pivot, to, radius, floorTop + WHISKER_LOW);
    if (f < len - 1e-3) lim = Math.min(lim, f);
  }
  return lim;
}
