/**
 * ACTIVITY-CAM — etkinlik kadrajı (ürün sahibi 2026-10-29: "çay içerken, balık ekmek yerken kamera açısından karakterin bunu nasıl yaptığı
 * görünmüyor; kamera karakteri yaparken net göstermeli, keyif aldığı yüzünden okunmalı").
 *
 * - Veri: etkinlik türü başına kadraj (`ACTIVITY_FRAMING`). Yeme, içme, piknik, kitap/tezgâh gezme, oyun, yem atma, fotoğraf:
 * karakterin **önünden 3/4** (bakışa göre ±`side`), göz hizasına yakın kamera (`lift`: gözün üstü), `dist` (dünya birimi; insan
 * boyu 1,0) bandında; üst beden + eller + elde nesne + varsa tezgâh/satıcı kadrajda.
 * - (ürün sahibi: "45° sağ ya da sol yan açı; arkadan değil, yüz ve şamandıra görünsün"): olta (`fish`) da bu kadrajda —
 * kamera karakterin bakışına göre **önden 45°** yanda (açık alanda 35–55°), şamandıra hedef; şamandıra suyun alçağındaysa bakış
 * noktası göz ile şamandıra arasına iner (`fishAimDrop`), ikisi de dikey kadrajda. Eski kural (`actionCam.ts`, arkadan ±45°) emekli.
 * - Seçim (`pickActivityFraming`): aday yanlar önce tercih edilen ±`side`, sonra daha geniş ön açılar (≤ 60°); hepsi duvara
 * gömülüyse yan (±80°, hâlâ önde) — **asla arkadan değil**. Her aday için mesafe bandı denenir. Puan: kamera noktası katının
 * içinde mi, kamera → göz ve kamera → hedef (tezgâh, satıcı) doğrularını kesen katı/cam blok (`actionCam.segmentHits`), kadraj
 * dışı hedef (yatay yarı açı). Çarpışmanın kalanını WalkRig'in yaylı kolu (`camera/rig.ts followArm`) çözer.
 * - Çıktı WalkRig yörünge modeline uyar: kamera `pivot − yön(yaw)·cos(elev)·dist`, `y = pivot + sin(elev)·dist`, bakış = pivot
 * (eğim = −elev). `pivotY` gözle eller arasında (oturuşta oturak yüksekliğinden). Geri dönüş (önceki kamera) WalkRig'de.
 * Saf modül (three/React/depo yok). Test: scripts/activity_cam.test.mjs.
*/
import type { BlockQuery } from "./landmarkView";
import { ACTION_HALF_FOV, offAxis, segmentHits } from "./actionCam";
import { isEatAct } from "../fun/rituals/logic";
import { inLane, laneSegHits, type MoverLane } from "./moverLanes";
import type { RitualDef, RitualSit } from "../fun/rituals";

export type ActivityKind = "eat" | "drink" | "picnic" | "browse" | "play" | "feed" | "photo" | "fish";
export const ACTIVITY_KINDS: readonly ActivityKind[] = ["eat", "drink", "picnic", "browse", "play", "feed", "photo", "fish"];

export interface ActivityFraming {
  /** "front": karakterin önünden 3/4 (olta dahil) · "side": eski olta kuralı (actionCam.ts, arkadan ±45°; kullanılmıyor)*/
  mode: "front" | "side";
  /** tercih edilen ön açı (rad; 0 tam karşı, + karakterin sağı) */
  side: number;
  /** tercih edilen mesafe ve izin verilen bant (dünya birimi; pivot → kamera) */
  dist: number;
  band: readonly [number, number];
  /** kamera yüksekliği: gözün bu kadar üstü (birim) */
  lift: number;
  /** pivot (bakış noktası): göz ile göğüs/eller arası — gözün bu kadar altı (birim) */
  aimDrop: number;
  /** dar olmayan ekranda (narrowScale 1) `aimDrop` yerine (avatar alt kenardan taşmasın)*/
  wideDrop?: number;
}

const DEG = Math.PI / 180;
/**
 * Etkinlik türü başına kadraj. Mesafeler insan boyu 1,0 birim olan yürüme ölçeğinde (yüz 1 voksel pikselleri ekranda ≥ 6 px).
 * Yem atma ve fotoğrafta önü (kuşlar, heykel) de görmek için daha geniş ön açı ve uzak.
 */
export const ACTIVITY_FRAMING: Readonly<Record<ActivityKind, ActivityFraming>> = {
  eat: { mode: "front", side: 35 * DEG, dist: 1.9, band: [1.6, 2.5], lift: 0.12, aimDrop: 0.16, wideDrop: 0.3 }, // geniş ekranda 0,16 → 0,3 — oturan avatarın alt kenarı 1280×800'de taşıyordu (dar ekranda yaylı kol çöker: STALL-CAM-003)
  drink: { mode: "front", side: 30 * DEG, dist: 1.75, band: [1.6, 2.4], lift: 0.1, aimDrop: 0.12, wideDrop: 0.3 }, // aynı sınıf (ayaklar −23°)
  picnic: { mode: "front", side: 35 * DEG, dist: 2.0, band: [1.6, 2.5], lift: 0.28, aimDrop: 0.18 },
  browse: { mode: "front", side: 50 * DEG, dist: 2.1, band: [1.7, 2.5], lift: 0.15, aimDrop: 0.2 },
  play: { mode: "front", side: 40 * DEG, dist: 2.3, band: [1.8, 2.5], lift: 0.1, aimDrop: 0.25 },
  // yem atmada kuşlar avatarın önüne, yere iner — 2,4 birimlik yüz kadrajında (sütunlar arasında kol 1 m'ye
  // çöküyordu) güvercinler kare altında kalıyordu. 45° yan, olta gibi geniş: avatar + yerdeki kuşlar birlikte
  feed: { mode: "front", side: 45 * DEG, dist: 3.2, band: [2.6, 4.2], lift: 0.55, aimDrop: 0.38 },
  photo: { mode: "front", side: 50 * DEG, dist: 2.3, band: [1.8, 2.5], lift: 0.12, aimDrop: 0.22 },
  // önden 45° yan (eskiden `side 135°` = arkadan ±45°: kare saç bloğu, yüz yok); mesafe avatar + şamandıra sığar
  fish: { mode: "front", side: 45 * DEG, dist: 3.3, band: [2.8, 4.4], lift: 0.5, aimDrop: 0.3 },
};
/**
 * kadraj mesafeleri yatay görüşü ≥ `REF_HALF` olan ekrana göre. Dikey telefonda (375 × 812) yatay yarı açı ~20°:
 * aynı 1,6–2,5 birimde kare 1,2–1,8 birim genişlikte kalıyor, yüz ekranın yarısını kaplıyordu (İstanbul balık ekmek, <city> krep).
 * Dar ekranda mesafe ve bant `tan(REF_HALF) / tan(yarı açı)` ile (en çok `NARROW_MAX`) uzar; masaüstü ve yatay telefon değişmez.
*/
export const REF_HALF = 30 * DEG, NARROW_MAX = 1.7;
/** `halfFov`: WalkRig `framingHalf` (yatay yarı açı − 0,08). */
export const narrowScale = (halfFov?: number) => (halfFov === undefined ? 1 : Math.min(NARROW_MAX, Math.max(1, Math.tan(REF_HALF) / Math.tan(halfFov + 0.08))));
/** Ön kadrajda en geniş "ön" açı (test: açık alanda |açı| ≤ 60°) ve engelde son çare yan açı (hâlâ önde, < 90°). */
export const FRONT_MAX = 60 * DEG;
export const SIDE_FALLBACK = 80 * DEG;
/** Masa/tezgâh karakterin önünü kapatıyorsa (yaylı kol kısalırdı) kamera bu kadar (birim) göz üstüne kaldırılarak denenir; en azı seçilir. */
export const RAISE_STEPS: readonly number[] = [0, 0.2, 0.4, 0.6, 0.85, 1.1];
/** Yerde oturan karakterin önünde alçak masa kolun başlangıcını kutunun içine alıyorsa (kol 0) bakış noktası bu kadar yükseltilerek denenir. */
export const AIM_UP_STEPS: readonly number[] = [0, 0.18, 0.36];
/** (STALL-CAM-003): kolu kısa kalan (< `ARM_OK_FRAC` × tam boy) bir poz için yüksek-geniş kurtarma adayları: kamera göz üstüne bu kadar
 * (birim) kaldırılır ve bant üstünün `WIDE_EXTRA` kadar ötesine alınır (tezgâh yanına sıkışmış oturak: her yan aday 0,06'ya çöküyordu).*/
export const ARM_OK_FRAC = 0.6;
export const HIGH_RAISE_STEPS: readonly number[] = [0, 0.5, 1.0, 1.6];
export const WIDE_EXTRA: readonly number[] = [0.6, 1.2];
/** Tezgâh/duvar karakterin bütün ön yarısını kapatıyorsa (oturak tezgâh yanına sıkışmış, öbür yan açık) son çare yan açılar: profilden hafif geriye (≤ 120°). */
export const RESCUE_SIDES: readonly number[] = [90 * DEG, 105 * DEG, 120 * DEG];
/** HQA-FIX: olta/yem atmada bakış noktası suya doğru iner (`fishAimDrop`); korkuluk/kıyı duvarı bakış noktasından yüksekse
 * yaylı kol korkuluğa çarpıp sıfıra çöküyordu (<city>: kamera korkuluğun içine bakıyordu). Bu kipte bakış noktası göz hizasının
 * 0,1 altına dek bu adımlarla yükseltilerek denenir (şamandıra dikey kadrajdan çıkarsa küçük ceza; kol çökmesi büyük ceza).*/
export const LOW_AIM_UP_STEPS: readonly number[] = [0, 0.18, 0.36, 0.55, 0.75];

/** Ritüel → etkinlik türü (yeme: oturarak yerde → piknik; yudum → içme; okuma → gezme; atma → yem; fotoğraf; geri kalanı oyun). */
export function activityKindOf(def: Pick<RitualDef, "act" | "photo">, sit: RitualSit | null = def.act.sit ?? null): ActivityKind {
  if (isEatAct(def)) return sit === "sit_ground" ? "picnic" : "eat";
  const m = def.act.motion;
  if (m === "sip") return "drink";
  if (m === "read") return "browse";
  if (def.photo) return "photo";
  if (m === "toss") return "feed";
  return "play";
}

/**
 * ritüel bittikten sonra etkinlik kadrajı sürer mi. Avatar ritüelin oturağında oturdukça (ritüel bitse de oturuş sürer)
 * kadraj kalır: takip kamerası avatar noktasına (oturağa varış karosu; gövde oturakta) döndüğünde pazar holü çatısının altında göz
 * yedeğine düşüyor, avatar kayboluyordu. Yürüyünce (kalkış) ya da oturuş yoksa `end` saatinde biter.
*/
export const activityHolds = (o: { walking: boolean; seated: boolean; now: number; end: number }): boolean => !o.walking && (o.seated || o.now < o.end);

type CamAxes = { yaw: number; pitch: number; dist: number };
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * etkinlik kadrajından takibe dönüş WalkRig'de KESMEdir (`s.settle`) — kesme son kadraja iner, ara yaw'a değil.
 * Eskiden yalnız `yawTarget` geri kuruluyordu; kare yumuşatması (10/sn) kesme karesinde yaw'ı yarı yolda bırakıyordu (2,09 → 1,78): 4,6 m
 * kol tezgâhın üstünden geçip kısalıyor, o kare göz yedeği (kamera başta, avatar gizli; İstanbul balık-ekmek, yürüyüşle çıkışların ~yarısı).
 * Kullanıcının arada çevirdiği eksen kalır. Saf.
*/
export function activityRestore(cam: CamAxes & { yawTarget: number }, pick: CamAxes, saved: CamAxes): CamAxes & { yawTarget: number } {
  const yawTarget = Math.abs(wrapA(cam.yawTarget - pick.yaw)) < 0.05 ? cam.yaw + wrapA(saved.yaw - cam.yaw) : cam.yawTarget;
  return { yaw: yawTarget, yawTarget, pitch: Math.abs(cam.pitch - pick.pitch) < 1e-3 ? saved.pitch : cam.pitch, dist: Math.abs(cam.dist - pick.dist) < 1e-3 ? saved.dist : cam.dist };
}

/** Oturan karakterin gözü kalçanın (oturak üstü) bu kadar üstünde; ayakta göz `EYE_Y` (scale.ts 0,91). */
export const SEATED_EYE = 0.5;
export const STAND_EYE = 0.91;

export interface FramingInput {
  /** avatar ayak noktası ve ayak yüzeyi */
  x: number; z: number; footY: number;
  /** karakterin bakışı (`AvatarState.heading`; 0 → +z) */
  heading: number;
  /** oturak yüksekliği (ayakta null) */
  seatY?: number | null;
  /** kadrajda kalması gereken noktalar (ritüel konumu/tezgâh, satıcı) */
  targets?: readonly { x: number; z: number; y?: number }[];
  kind: ActivityKind;
  /** eşitlikte tercih edilen yan: +1 karakterin sağı, −1 solu */
  prefer?: 1 | -1;
  /** yatay yarı görüş açısı (rad) */
  halfFov?: number;
  /** dikey yarı görüş açısı (rad; yalnız olta şamandırasının dikey kadraj denetimi)*/
  vHalfFov?: number;
  /** yakındaki ajanlar (beden yarıçapı ~0,25): kamera ile yüz arasına giren ajan kadrajı bozar */
  actors?: readonly { x: number; z: number }[];
  /** HQA-FIX: taşıt şeritleri (`moverLanes.ts`; yürüme ölçeği): kamera vapur/tramvay hacmine konmaz, kamera → yüz doğrusu
   * şeritten geçmez (taşıt geçince kare gövdenin içinde kalıyordu)*/
  lanes?: readonly MoverLane[];
  /** WalkRig yaylı kolunun açık boyu (pivot → kamera süpürmesi; `camera/collide.ts sweepArm`): kısalan kol kadrajı bozar (masa/tezgâh/sandalye) */
  armLen?: (pivot: { x: number; y: number; z: number }, cam: { x: number; y: number; z: number }) => number;
}
export interface FramingPick {
  /** WalkRig yörünge parametreleri: kamera bakış yaw'ı, eğim (−elev), pivot mesafesi, pivot yüksekliği (mutlak) */
  yaw: number; pitch: number; dist: number; pivotY: number;
  /** bakış noktasının yatay konumu (olta: avatar ile şamandıra arası; öteki etkinliklerde karakterin kendisi)*/
  px: number; pz: number;
  /** karakter bakışına göre kameranın açısı (rad; 0 tam karşı) */
  offset: number;
  cam: { x: number; y: number; z: number };
  eyeY: number;
  score: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Yatay düzlemde (a → b) doğru parçasının p noktasına uzaklığı (uçlardan 0,3 içeride; karakterin kendisi sayılmaz). */
function segPointDist(a: { x: number; z: number }, b: { x: number; z: number }, p: { x: number; z: number }): number {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
  if (L2 < 1e-6) return Infinity;
  const L = Math.sqrt(L2), u = ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2;
  if (u * L < 0.1 || (1 - u) * L < 0.3) return Infinity;
  return Math.hypot(a.x + dx * u - p.x, a.z + dz * u - p.z);
}

/** Noktayı içeren katı/cam blok var mı (zemin hariç). */
function inside(q: BlockQuery, p: { x: number; y: number; z: number }, floorY: number): boolean {
  for (const r of q(p.x - 0.4, p.z - 0.4, p.x + 0.4, p.z + 0.4)) {
    if (!(r.g === undefined || r.g === "solid" || r.g === "glass")) continue;
    if (r.p[1] + r.s[1] / 2 <= floorY + 0.12) continue;
    const pad = 0.12;
    if (Math.abs(p.x - r.p[0]) <= r.s[0] / 2 + pad && Math.abs(p.y - r.p[1]) <= r.s[1] / 2 + pad && Math.abs(p.z - r.p[2]) <= r.s[2] / 2 + pad) return true;
  }
  return false;
}

/** kameranın hemen üstünde (≤ `AWNING_H`) ince bir saçak/tente/çatı levhası var mı — tezgâh tentesinin altına giren kamera
 * "tezgâhın içinden" bakıyordu (<city> krep, 60+ tezgâh; scripts/stall_cam_check.mjs STALL-CAM-001).*/
export const AWNING_H = 1.4;
export const AWNING_PEN = 8;
/** tente ucunun hemen önü de sayılır (kare tentenin kenarından başlamasın) */
export const AWNING_PAD = 0.08;
export function underAwning(q: BlockQuery, p: { x: number; y: number; z: number }): boolean {
  for (const r of q(p.x - 0.05, p.z - 0.05, p.x + 0.05, p.z + 0.05)) {
    if (!(r.g === undefined || r.g === "solid" || r.g === "glass") || r.s[1] > 0.2) continue;
    const bottom = r.p[1] - r.s[1] / 2;
    if (bottom > p.y && bottom - p.y <= AWNING_H && Math.abs(p.x - r.p[0]) <= r.s[0] / 2 + AWNING_PAD && Math.abs(p.z - r.p[2]) <= r.s[2] / 2 + AWNING_PAD) return true;
  }
  return false;
}

/** Göz yüksekliği (mutlak): oturuşta oturak + `SEATED_EYE`, ayakta ayak + `STAND_EYE`. */
export const eyeHeight = (footY: number, seatY: number | null | undefined) => (seatY != null ? Math.max(footY + 0.3, seatY + SEATED_EYE) : footY + STAND_EYE);

/** Kamera konumu: karakterin bakışına göre `offset` açısında önde, pivot çevresinde `dist`, göz + `lift` (+ `raise`) yüksekliğinde; `aimUp` bakış noktasını (pivot) kaldırır. */
export function framingPose(inp: Pick<FramingInput, "x" | "z" | "footY" | "heading" | "seatY">, f: ActivityFraming, offset: number, dist: number, raise = 0, aimUp = 0, ahead = 0) {
  const eyeY = eyeHeight(inp.footY, inp.seatY);
  const pivotY = eyeY - f.aimDrop + aimUp;
  const rise = eyeY + f.lift + raise - pivotY;
  const elev = Math.asin(Math.max(-0.9, Math.min(0.9, rise / dist)));
  // `ahead` — bakış noktası karakterin bakış yönünde bu kadar önde (olta: şamandıraya doğru)
  const px = inp.x + Math.sin(inp.heading) * ahead, pz = inp.z + Math.cos(inp.heading) * ahead;
  const bearing = inp.heading + offset; // bakış noktasından kameraya
  const h = Math.cos(elev) * dist;
  const cam = { x: px + Math.sin(bearing) * h, y: pivotY + Math.sin(elev) * dist, z: pz + Math.cos(bearing) * h };
  return { yaw: wrap(bearing + Math.PI), pitch: -elev, pivotY, eyeY, cam, px, pz };
}

/**
 * Etkinlik kadrajı: önden 3/4, göz hizası, mesafe bandı; engelde daha geniş ön açı ya da yan — arkadan asla. olta da
 * buradan (WalkRig olta başlangıcı; önden 45°, şamandıra hedef).
*/
export function pickActivityFraming(q: BlockQuery, inp: FramingInput): FramingPick {
  const f0 = ACTIVITY_FRAMING[inp.kind] ?? ACTIVITY_FRAMING.eat;
  const fish = inp.kind === "fish";
  // HQA-FIX: yem atmada (güvercin/martı/ördek) yemin düştüğü yer de dikey kadrajda — olta gibi bakış noktası iner
  const low = fish || inp.kind === "feed";
  const k = fish ? 1 : narrowScale(inp.halfFov); // dar ekranda kadraj uzar (olta kendi bandında)
  const f1 = k > 1 ? { ...f0, dist: f0.dist * k, band: [f0.band[0] * k, f0.band[1] * k] as const } : f0.wideDrop !== undefined ? { ...f0, aimDrop: f0.wideDrop } : f0;
  const f = low ? { ...f1, aimDrop: fishAimDrop(f1, eyeHeight(inp.footY, inp.seatY), inp.targets ?? []) } : f1;
  const prefer = inp.prefer ?? 1, half = inp.halfFov ?? ACTION_HALF_FOV, vHalf = inp.vHalfFov ?? FISH_V_HALF;
  const ahead = fish ? fishAhead(inp) : 0; // avatar + şamandıra birlikte ortada
  const s0 = Math.min(f.side, FRONT_MAX);
  const wide = Math.min(FRONT_MAX, s0 + 20 * DEG);
  const offs: { o: number; pen: number }[] = [
    { o: prefer * s0, pen: 0 }, { o: -prefer * s0, pen: 0.05 },
    { o: prefer * wide, pen: 1 }, { o: -prefer * wide, pen: 1.05 },
    { o: prefer * FRONT_MAX, pen: 1.1 }, { o: -prefer * FRONT_MAX, pen: 1.15 },
    { o: prefer * Math.max(0, s0 - 25 * DEG), pen: 1.2 }, { o: -prefer * Math.max(0, s0 - 25 * DEG), pen: 1.25 },
    { o: prefer * 70 * DEG, pen: 2 }, { o: -prefer * 70 * DEG, pen: 2.05 }, { o: prefer * 75 * DEG, pen: 2.5 }, { o: -prefer * 75 * DEG, pen: 2.55 },
    { o: prefer * SIDE_FALLBACK, pen: 3 }, { o: -prefer * SIDE_FALLBACK, pen: 3.05 },
  ];
  const dists = [f.dist, f.band[0] + (f.dist - f.band[0]) / 2, f.band[0], f.band[1]].filter((d, i, l) => l.indexOf(d) === i);
  const foot = inp.footY;
  let best: FramingPick | null = null;
  let bestCenter = Infinity;
  // HQA-FIX: olta bakış noktası önde (şamandıraya doğru); korkuluğa yaslanırsa kol çöker — önce tam, sonra yarı, sonra sıfır
  // öne kayma denenir (iyi aday bulununca durulur; adaylar az kalır)
  const aheads = fish && ahead > 0 ? [ahead, ahead * 0.5, 0] : [ahead];
  // 2. aşama (yalnız kol kısa kalan en iyi aday varsa; yalnız yeme/içme/piknik/gezme): yüksek-geniş adaylar, kolu ≥ ARM_OK_FRAC olanlar önceliklidir
  let bestOk = true;
  const rescue = !!inp.armLen && !low && !fish;
  for (let stage = 0; stage < (rescue ? 2 : 1); stage++) {
  if (stage === 1 && bestOk) break;
  const dl = stage ? [f.dist, f.band[1], ...WIDE_EXTRA.map((e) => f.band[1] + e)] : dists, rl = stage ? HIGH_RAISE_STEPS : inp.armLen ? RAISE_STEPS : RAISE_STEPS.slice(0, 1);
  for (const ah of aheads) {
  if (stage === 0 && best && (best as FramingPick).score < 3) break;
  const stageOffs = stage ? [...offs, ...RESCUE_SIDES.flatMap((r, i) => [{ o: prefer * r, pen: 4 + i }, { o: -prefer * r, pen: 4.05 + i }])] : offs;
  for (const { o, pen } of stageOffs) {
    for (const d of dl) for (const raise of rl) for (const aimUp of inp.armLen ? (low ? LOW_AIM_UP_STEPS : stage ? AIM_UP_STEPS.slice(0, 2) : AIM_UP_STEPS) : AIM_UP_STEPS.slice(0, 1)) {
      if (low && aimUp > 0 && f.aimDrop - aimUp < 0.1) continue; // HQA-FIX: olta/yemde bakış noktası gözün 0,1 altından yukarı çıkmaz
      const p = framingPose(inp, f, o, d, raise, aimUp, ah);
      const head = { x: inp.x, y: p.eyeY, z: inp.z };
      let score = pen + Math.abs(d - f.dist) * 0.4 + raise * 1.8 + aimUp * 1.2 + (ahead > 0 ? (1 - ah / ahead) * 0.6 : 0);
      if (inside(q, p.cam, foot)) score += 50;
      else if (underAwning(q, p.cam)) score += AWNING_PEN;
      // HQA-FIX: taşıt şeridinin hacminde kamera (vapur/tramvay geçince kare gövdenin içinde) ve şeritten geçen bakış
      if (inp.lanes?.length) { if (inLane(inp.lanes, p.cam)) score += 50; score += laneSegHits(inp.lanes, p.cam, head) * 3; }
      score += segmentHits(q, p.cam, head, foot) * 3;
      // eller/elde nesne (göğüs önü)
      const hx = inp.x + Math.sin(inp.heading) * 0.15, hz = inp.z + Math.cos(inp.heading) * 0.15;
      score += segmentHits(q, p.cam, { x: hx, y: p.pivotY, z: hz }, foot) * 2;
      let armOk = true;
      if (inp.armLen) {
        const L = inp.armLen({ x: p.px, y: p.pivotY, z: p.pz }, p.cam), full = Math.hypot(p.cam.x - p.px, p.cam.y - p.pivotY, p.cam.z - p.pz);
        armOk = L >= ARM_OK_FRAC * full;
        if (L < full - 0.05) score += 1 + (full - L) * 3 + (L < f.band[0] - 0.3 ? 4 : 0); // yay kısalırsa kamera masaya/yüze yapışır
      }
      for (const ac of inp.actors ?? []) if (segPointDist(p.cam, head, ac) < 0.32 || Math.hypot(ac.x - p.cam.x, ac.z - p.cam.z) < 0.4) score += 2.5;
      let center = 0;
      for (const t of inp.targets ?? []) {
        score += segmentHits(q, p.cam, { x: t.x, y: t.y ?? foot + 0.6, z: t.z }, foot) * (fish ? 2.5 : 0.5); // HQA-FIX: şamandıra görünür olmalı
        const off = offAxis(p.cam, p.yaw, t);
        if (off > half) score += 2;
        // olta — şamandıra dikey kadrajda da (iskele suyun çok üstündeyse bakış noktası iner; yetmezse aday cezalı)
        if (low && t.y !== undefined && vertOff(p.cam, p.pivotY, { x: p.px, z: p.pz }, t) > vHalf) score += 2; // HQA-FIX: yem de
        center += off;
      }
      // olta — bakış noktası önde olduğundan avatarın kendisi de kadrajda olmalı
      if (fish && offAxis(p.cam, p.yaw, inp) > half) score += 2;
      const better = stage === 1 && armOk !== bestOk ? armOk : !best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && center < bestCenter - 1e-6);
      if (!best || better) {
        best = { yaw: p.yaw, pitch: p.pitch, dist: d, pivotY: p.pivotY, px: p.px, pz: p.pz, offset: o, cam: p.cam, eyeY: p.eyeY, score };
        bestCenter = center; bestOk = armOk;
      }
    }
  }
  }
  }
  return best!;
}

/** olta kadrajında şamandıranın dikey denetimi için varsayılan dikey yarı açı (rad; 55° dikey görüşün ~%85'i).*/
export const FISH_V_HALF = 24 * DEG;
/**
 * olta bakış noktası — göz ile şamandıra arasında (şamandıra suyun alçağındaysa aşağı iner; avatar ve şamandıra
 * birlikte dikey kadrajda). Tabloda `aimDrop` en az değerdir; en çok 0,9 birim.
*/
export function fishAimDrop(f: Pick<ActivityFraming, "aimDrop">, eyeY: number, targets: readonly { y?: number }[]): number {
  const ys = targets.filter((t) => t.y !== undefined).map((t) => t.y as number);
  if (!ys.length) return f.aimDrop;
  return Math.max(f.aimDrop, Math.min(0.9, (eyeY - Math.min(...ys)) * 0.45));
}
/** olta bakış noktasının karakterin önündeki uzaklığı — şamandıraya uzaklığın %45'i (en çok 1,2 birim).*/
export function fishAhead(inp: Pick<FramingInput, "x" | "z" | "heading" | "targets">): number {
  const t = inp.targets?.[0];
  if (!t) return 0;
  const along = (t.x - inp.x) * Math.sin(inp.heading) + (t.z - inp.z) * Math.cos(inp.heading);
  return Math.max(0, Math.min(1.2, along * 0.45));
}
/** Hedefin kameranın bakış doğrultusuna (kamera → pivot) göre dikey açısı (rad, mutlak). */
export function vertOff(cam: { x: number; y: number; z: number }, pivotY: number, piv: { x: number; z: number }, t: { x: number; z: number; y?: number }): number {
  const look = Math.atan2(pivotY - cam.y, Math.hypot(piv.x - cam.x, piv.z - cam.z));
  const tgt = Math.atan2((t.y ?? pivotY) - cam.y, Math.hypot(t.x - cam.x, t.z - cam.z));
  return Math.abs(tgt - look);
}

/** Kameranın karakterin önüne göre açısı (rad, mutlak; 0 tam karşı, π tam arka) — test ve canlı denetim. */
export function frontAngle(pick: Pick<FramingPick, "cam">, inp: Pick<FramingInput, "x" | "z" | "heading">): number {
  return Math.abs(wrap(Math.atan2(pick.cam.x - inp.x, pick.cam.z - inp.z) - inp.heading));
}

/** Etkin kadraj isteği (canlı denetim): WalkRig yazar; `kind` null → etkinlik kadrajı yok. */
export const activityCam: { key: number; kind: ActivityKind | null; pick: FramingPick | null; restoring: boolean } = { key: 0, kind: null, pick: null, restoring: false };
