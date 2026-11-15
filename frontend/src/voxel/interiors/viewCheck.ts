/**
 * INTERIOR-VIEW — iç mekân görüntüleme kuralları denetimi (saf; `scripts/walk_check.mjs` WALK-INTERIOR çağırır).
 *
 * Her açık yerin her katı (sahne kaydı) için:
 * - **kamera ataması:** açık hava katı → güverte (birinci şahıs, kesit yok); müze/stadyum kapalı katı → salon (üçüncü şahıs,
 * geniş açı > 0, kesit); diğer kapalı katlar → oda (yakın üçüncü şahıs: mesafe < açık hava takip mesafesi, kesit). Kayıttaki
 * kural `CAMERA_RULES[alan]` ile aynı; kayıt biçimi/sürümü, dış şehir yok (kapalı katta `exterior: none`, panorama yalnız açık
 * havada), sessiz katta "hush" ses yatağı.
 * - **kesit kapsamı:** oda/salonda her yürünebilir karo × 8 yön, kuralın takip mesafesi ve varsayılan eğimde kamera; göğüsten
 * kameraya giden doğruyu kesen her engel parçası gölgelendiricide açılıyor mu (walk/cover.ts `interiorCutCovers`: kabuk bandı
 * blok blok, odadaki engel avatar kabarcığında). Kapsam %100 olmalı. Ön duvarlar tam boy (WALL_H); alçak ön duvar kalmadı.
 * - **INTERIOR-OPAQUE-001 (UX-AUDIT):** örtücü olmayan katı bloklar her görünüm kipinde opak kalır. Her pozda katın bütün blokları
 * (eşya, panorama, gündüz/gece silüet halkası dahil) için: doğru açıksa kesit tamamen kapalı (kabuk yanı 0, kabarcık yok →
 * hiçbir blok atılmaz); kabukta atılan blok odanın içinde (kabuk payının içinde, odanın hiçbir yanının dışında olmayan) değil; kabarcık yalnız odada
 * bir örtücü varken. Güverte (birinci şahıs) kesitsiz. Malzeme tarafı: `voxel/blockAlpha.ts` (yalnız cam/su/bulut saydam).
 * `legacyCut`: eski bütün-ekran kuralının (avatar düzleminin önü) açık doğrulu pozlarda dokunacağı blok sayısı (karşılaştırma).
 * - **INTERIOR-CAM (2026-10-29):** kesit (cutaway) emekli — oda/salon kuralında `cutaway: false`; yukarıdaki kesit kapsamı ve
 * INTERIOR-OPAQUE-001 kabuk denetimi kesit kapalı olduğundan ölçülecek poz bulmaz (gerekçe: kabuk artık hiç açılmaz; yerine
 * aşağıdaki iki kural). **INTERIOR-CEILING-001:** kapalı katta her yürünebilir karonun (yukarı merdiven karoları hariç) üstünde
 * tavan var (`ceil` bloğu, örtü ızgarasında çatı) ve hiçbir kamera pozunda (çalışma zamanı kesit planı `walkCutPlan`/`planCuts`)
 * tavan ya da çatı bloğu atılmıyor; plan çatı terimi taşımıyor. **CAMERA-INSIDE-001:** her yürünebilir karo × 8 yön × 2 eğim,
 * ortamın profiliyle (camera/profiles.ts) WalkRig ile aynı çözüm (yörünge → zemin payı → tavan sıkıştırması → `resolveFollowCam`
 * → yaylı kol): kamera hiçbir katının (duvar, tavan, eşya) içinde değil ve yakın düzlem köşesinden yakın değil; kamera tavanın
 * üstüne çıkmıyor. Göz yedeğine düşen poz (avatar gizli) ayrıca sayılır.
 * - **çizim çağrısı bütçesi (tahmin):** kat başına çizilen blok grubu sayısı (`Blocks` grup başına bir InstancedMesh; gölge
 * geçişinde solid bir kez daha) + sabit iç mekân ek yükü (zemin düzlemi, avatar/Crowd, Props, kesit yok) ≤ 22. Canlı ölçüm:
 * `walk_perf.mjs --interior` ( "INTERIOR-VIEW").
*/
import { coverGrid, navGrid, walkable, type CoverGrid, type NavGrid } from "../walk/controller";
import { INTERIOR_CUT_MARGIN, interiorCutCovers, outsideSides, planCuts, resolveFollowCam, roomShape, shapeWith, shellCuts, walkCutPlan, WALK_NEAR } from "../walk/cover";
import { CAM_FLOOR, FOLLOW_DIST, LOOK_DEFAULT, LOOK_Y, lookDir, orbitPose, walkFov, WALK_FOV_DEFAULT } from "../walk/scale";
import { blockSource } from "../camera/world";
import { createCamRig, followArm } from "../camera/rig";
import { fitUnderCeiling, ceilingOver, elevCap, HEAD_CLEAR } from "../camera/ceiling";
import { ARM_EYE, armEyeIndoor, collidable, nearCorner, probeRadius, type BoxSource } from "../camera/collide";
import { CAMERA_PROFILES, openness, profileOf, selectProfile, shoulderShift, type CamSpace } from "../camera/profiles";
import { sceneDef, tx, tz, type Block, type SceneDef } from "../scenes";
import { openSites } from "./catalog";
import { interiorPlan, itemBlocks, panoramaBlocks, type InteriorLevel } from "./generate";
import { cityPanoBlocks, levelHasGlow } from "./cityPano";
import { CAMERA_RULES, CUT_FLOOR_Y, INTERIOR_DRAW_BUDGET, INTERIOR_FORMAT, INTERIOR_VERSION, interiorRecord, spaceOf } from "./sceneModel";
import { LOOK_EYE_Y } from "./lookout";

/**
 * Sabit iç mekân ek yükü (çizim çağrısı): zemin düzlemi 1 + Crowd'un avatar dizileri ve Props'un boş örnek dizileri + gölge
 * geçişi. `walk_perf.mjs --interior` canlı ölçümüyle ayarlanır ( "INTERIOR-VIEW"): tahmin ölçümden küçük olmamalı.
*/
export const INTERIOR_BASE_CALLS = 10;
/** gölge geçişinde ikinci kez çizilen gruplar (Blocks: yalnız `solid` gölge düşürür) */
const SHADOW_GROUPS = new Set<Block["g"]>(["solid"]);

export interface FloorViewRow {
  key: string;
  space: string;
  view: string;
  dist: number;
  fovAdd: number;
  cutaway: boolean;
  /** kesit denetimi: denenen poz, örtülü poz, kesitte açılan örtülü poz */
  poses: number;
  occluded: number;
  covered: number;
  /** INTERIOR-OPAQUE-001: pozlarda kabukta atılan blok (örtücü) toplamı, eski kuralın açık doğruda dokunacağı blok toplamı, ihlal */
  cutBlocks: number;
  legacyCut: number;
  opaqueViolations: number;
  /** INTERIOR-CAM: tavanlı karo / tavansız yürünebilir karo, kamera pozu, katı içinde poz, tavan üstünde poz, tavanı kesen poz, göz yedeği */
  ceilTiles: number;
  ceilMissing: number;
  camPoses: number;
  camInside: number;
  camAbove: number;
  ceilCut: number;
  eyePoses: number;
  /** pozlarda seçilen profiller */
  profiles: string;
  groups: number;
  estCalls: number;
}

export interface InteriorViewReport { problems: string[]; rows: FloorViewRow[] }

/**
 * Kat blok gruplarından çizim çağrısı tahmini (keşif parçaları alınmamış, panorama dahil: en kötü durum). WORLD-PANO: şehir
 * silüet halkası gündüz ve gece hâliyle dahil (`cityPano: false` → halkasız; cityCheck farkı 0 ister).
 */
export function estimateFloorCalls(lv: InteriorLevel, opts: { cityPano?: boolean } = {}): { groups: number; calls: number } {
  const gs = new Set<Block["g"]>();
  for (const b of lv.built.blocks) gs.add(b.g);
  for (const b of itemBlocks(lv, new Set())) gs.add(b.g);
  for (const b of panoramaBlocks(lv)) gs.add(b.g);
  if (opts.cityPano !== false) for (const night of [false, true]) for (const b of cityPanoBlocks(lv.cityPano, night, levelHasGlow(lv))) gs.add(b.g);
  let calls = INTERIOR_BASE_CALLS + gs.size;
  for (const g of gs) if (SHADOW_GROUPS.has(g)) calls++;
  if (lv.built.lights.length) calls += 0; // nokta ışıkları çizim çağrısı eklemez (yalnız gölgelendirici maliyeti)
  return { groups: gs.size, calls };
}

const YAWS = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);

/** Bir katın görüntüleme kuralları (kamera ataması, kesit kapsamı, çizim çağrısı tahmini); şehir iç mekânları da kullanır.*/
export function levelViewReport(lv: InteriorLevel, base: SceneDef): { problems: string[]; row: FloorViewRow } {
  const problems: string[] = [];
  const tag = `WALK-INTERIOR ${lv.key}`;
  const space = spaceOf(lv);
  const rec = interiorRecord(lv, base, false);
  const recN = interiorRecord(lv, base, true);
  const rule = rec.camera;
  // ---- kamera ataması
  if (rec.format !== INTERIOR_FORMAT || rec.version !== INTERIOR_VERSION) problems.push(`${tag}: sahne kaydı biçimi/sürümü yanlış`);
  if (rule !== CAMERA_RULES[space]) problems.push(`${tag}: kamera kuralı alanın kuralı değil`);
  if (lv.outdoor !== (space === "deck" || space === "court")) problems.push(`${tag}: açık hava ↔ güverte ataması yanlış`);
  if (space === "deck" && (rule.view !== "third" || rule.cutaway)) problems.push(`${tag}: güverte üçüncü şahıs (avatar görünür) ve kesitsiz olmalı`);
  // INTERIOR-CAM: oda/salon kesitsiz (çatı/duvar kaldırılmaz), iç mekân/salon profiliyle (geniş açı, yakın takip)
  if (space === "hall" && (rule.view !== "third" || rule.fovAdd <= 0 || rule.cutaway || rule.dist !== CAMERA_PROFILES.hall.dist)) problems.push(`${tag}: salon geniş açılı, kesitsiz üçüncü şahıs (salon profili) olmalı`);
  if (space === "room" && (rule.view !== "third" || rule.dist >= FOLLOW_DIST || rule.cutaway || rule.fovAdd <= 0 || rule.dist !== CAMERA_PROFILES.interior.dist)) problems.push(`${tag}: oda yakın, geniş açılı, kesitsiz üçüncü şahıs (iç mekân profili) olmalı`);
  if ((lv.kind === "museum" || lv.kind === "stadium") && !lv.outdoor && space !== "hall") problems.push(`${tag}: müze/stadyum kapalı katı salon değil`);
  if (!lv.outdoor && rec.exterior === "panorama") problems.push(`${tag}: kapalı katta dış şehir çiziliyor`);
  if (rec.exterior === "backdrop" && !lv.cityPano) problems.push(`${tag}: silüet halkası kaydı tutarsız`);
  if (lv.cityPano && lv.pano) problems.push(`${tag}: hem pişmiş panorama hem silüet halkası`);
  if (lv.outdoor && rec.exterior === "panorama" && !lv.pano) problems.push(`${tag}: panorama kaydı tutarsız`);
  if (lv.quiet && rec.ambience.sound !== "hush") problems.push(`${tag}: sessiz katta ses yatağı "hush" değil`);
  if (!lv.outdoor && (rec.env.sun.intensity <= recN.env.sun.intensity || rec.env.sun.color === recN.env.sun.color))
    problems.push(`${tag}: pencere ışığı dış dünyanın saatine bağlı değil`);
  if (rec.budget.drawCalls !== INTERIOR_DRAW_BUDGET) problems.push(`${tag}: bütçe ${rec.budget.drawCalls} ≠ ${INTERIOR_DRAW_BUDGET}`);
  // ---- kesit kapsamı (oda/salon) + INTERIOR-OPAQUE-001
  let poses = 0, occluded = 0, covered = 0, cutBlocks = 0, legacyCut = 0, opaqueViolations = 0;
  if (rule.cutaway) {
    const cover = coverGrid(lv.built), nav = navGrid(lv.built);
    const portals = new Set(lv.portals.map((p) => `${p.tile[0]},${p.tile[1]}`));
    // ön duvar tam boy (alçak "bebek evi" duvarı yok): son satırdaki duvar karoları kat yüksekliğinde
    for (let i = 0; i < lv.built.width; i++) {
      const h = cover.height[(lv.built.depth - 1) * cover.width + i];
      if (h > 0 && h < lv.storey - 0.05 && !portals.has(`${i},${lv.built.depth - 1}`)) { problems.push(`${tag}: ön duvar ${i} alçak (${h.toFixed(2)} < kat ${lv.storey})`); break; }
    }
    const base0 = roomShape(lv.shell ? { width: lv.built.width, depth: lv.built.depth, blocked: lv.shell } : nav, lv.portals.map((p) => p.tile));
    if (!base0) problems.push(`${tag}: yürünebilir karo yok (oda biçimi)`);
    // katın bütün çizilen blokları: kat + eşya + panorama + silüet halkası (gündüz ve gece)
    const all: Block[] = [...lv.built.blocks, ...itemBlocks(lv, new Set()), ...panoramaBlocks(lv)];
    for (const night of [false, true]) all.push(...cityPanoBlocks(lv.cityPano, night, levelHasGlow(lv)));
    const pivot = { x: 0, y: LOOK_Y, z: 0 }, pos = { x: 0, y: 0, z: 0 }, dir = { x: 0, y: 0, z: 0 };
    let firstOpaque = "";
    const flag = (msg: string) => { opaqueViolations++; if (!firstOpaque) firstOpaque = msg; };
    for (let j = 0; j < lv.built.depth && base0; j++) for (let i = 0; i < lv.built.width; i++) {
      if (!walkable(nav, i, j) || portals.has(`${i},${j}`)) continue;
      pivot.x = tx(i); pivot.z = tz(j);
      const shape = shapeWith(base0, pivot.x, pivot.z);
      // oda içi: merkezi kabuk payından derinde odanın içinde kalan blok (eşya, sütun, merdiven, iç duvar) hiçbir yanın dışında değil
      const inRoom = (c: readonly number[]) => !outsideSides(shape, c[0], c[2], 0.1).some((v) => v);
      for (const yaw of YAWS) {
        poses++;
        orbitPose(pivot, yaw, LOOK_DEFAULT, rule.dist, pos);
        lookDir(yaw, LOOK_DEFAULT, dir);
        const look: [number, number, number] = [pos.x + dir.x * rule.dist, pos.y + dir.y * rule.dist, pos.z + dir.z * rule.dist];
        const cam: [number, number, number] = [pos.x, pos.y, pos.z];
        const r = interiorCutCovers(cover, shape, [pivot.x, pivot.y, pivot.z], cam, look, CUT_FLOOR_Y);
        const plan = r.plan;
        const sides = plan.side.some((v) => v);
        if (r.occluded) { occluded++; if (r.covered) covered++; }
        // doğru (göğüs, baş, omuzlar) açıkken kesit tamamen kapalı olmalı
        if (!plan.occluded && (sides || plan.bubble)) flag(`açık doğruda kesit açık (${i},${j} yön ${yaw.toFixed(2)})`);
        // görüş derinliği (eski kural karşılaştırması)
        let fx = look[0] - cam[0], fy = look[1] - cam[1], fz = look[2] - cam[2];
        const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
        const vz = (x: number, y: number, z: number) => (x - cam[0]) * fx + (y - cam[1]) * fy + (z - cam[2]) * fz;
        const limit = vz(pivot.x, pivot.y, pivot.z) - INTERIOR_CUT_MARGIN;
        for (const b of all) {
          const c = b.p;
          if (sides && shellCuts(shape, plan, c, CUT_FLOOR_Y)) {
            cutBlocks++;
            if (inRoom(c))
              flag(`oda içi blok kabukta atılıyor (${c.map((v) => v.toFixed(2)).join(",")}, poz ${i},${j})`);
          }
          // eski kural (açık doğrulu pozda): kutunun en yakın köşesi avatar düzleminin önünde ve zeminin üstünde → parçası atılırdı
          if (!plan.occluded && c[1] + b.s[1] / 2 > CUT_FLOOR_Y) {
            const near = vz(c[0], c[1], c[2]) - Math.abs(fx) * b.s[0] / 2 - Math.abs(fy) * b.s[1] / 2 - Math.abs(fz) * b.s[2] / 2;
            if (near < limit) legacyCut++;
          }
        }
      }
    }
    if (covered < occluded) problems.push(`${tag}: kesit kapsamı ${covered}/${occluded} örtülü poz (%100 olmalı)`);
    if (opaqueViolations) problems.push(`${tag}: INTERIOR-OPAQUE-001 ${opaqueViolations} ihlal — örtücü olmayan blok kesitte açılıyor (ilk: ${firstOpaque})`);
  }
  // ---- INTERIOR-CEILING-002 (serbest yükseklik ≥ 2,6 × göz)
  const clear = ceilingClearIssue(lv);
  if (clear) problems.push(`${tag}: ${clear}`);
  // ---- INTERIOR-CAM: INTERIOR-CEILING-001 + CAMERA-INSIDE-001
  const ic = interiorCameraReport(lv);
  for (const pr of ic.problems) problems.push(`${tag}: ${pr}`);
  // ---- çizim çağrısı bütçesi (tahmin)
  const est = estimateFloorCalls(lv);
  if (est.calls > INTERIOR_DRAW_BUDGET) problems.push(`${tag}: tahmini ${est.calls} çizim çağrısı > ${INTERIOR_DRAW_BUDGET} (${est.groups} grup)`);
  const row: FloorViewRow = { key: lv.key, space, view: rule.view, dist: rule.dist, fovAdd: rule.fovAdd, cutaway: rule.cutaway, poses, occluded, covered,
    cutBlocks, legacyCut, opaqueViolations, groups: est.groups, estCalls: est.calls, ...ic.counts };
  return { problems, row };
}

export function checkInteriorView(scene: string): InteriorViewReport {
  const problems: string[] = [];
  const rows: FloorViewRow[] = [];
  const base = sceneDef(scene);
  for (const [site] of openSites(scene)) {
    const plan = interiorPlan(scene, site);
    if (!plan) continue;
    for (const lv of plan.levels) {
      const r = levelViewReport(lv, base);
      problems.push(...r.problems);
      rows.push(r.row);
    }
  }
  return { problems, rows };
}

// ------------------------------------------------------------------------------------------ INTERIOR-CEILING-002
/**
 * INTERIOR-CEILING-002 (ürün sahibi 2026-10-31 "galata kulesi tavanlar çok alçak"): her katın (kapalı ve açık hava) her yürünebilir karosunda
 * (portal karosu hariç) zeminden üstteki ilk örtüye (tavan levhası, çatı, saçak, kiriş levhası, lento; karo merkezini örten, izi
 * ≥ 0,3 ve tabanı ≥ 0,3) serbest yükseklik en az `CEIL_CLEAR_MIN` = 2,6 × göz hizası (LOOK_EYE_Y 0,91 → 2,37). Asılı lamba, ince
 * çubuk ve eşya sayılmaz. Kule tipi simgeler (Galata, kafes kule, saat kulesi, Kız Kulesi, kaya kalesi, stadyum, gökdelen) TOWER_H
 * 2,4 ile geçer. `CEIL_LOW_KNOWN`: CEIL işiyle (ürün sahibi 2026-10-31, kule dışı 20 alçak kat → INDOOR_H 2,4) BOŞ; yeni alçak kat eklenmez — gerekçeli
 * istisna ancak bu listeye anahtar + gerekçe yorumuyla girer (scripts/galata2.test.mjs, scripts/ceil.test.mjs).
*/
export const CEIL_CLEAR_MIN = 2.6 * LOOK_EYE_Y;
export const CEIL_LOW_KNOWN: ReadonlySet<string> = new Set<string>([]);
/** Katın kural anahtarı: sahne yeri `<sahne>:<yer>:<kat>`, şehir landmarkı `<sahne>:city:<landmark>:<kat>`. */
export const ceilKey = (lv: Pick<InteriorLevel, "scene" | "site" | "index">) => `${lv.scene}:${lv.site.replace(/^city_[a-z0-9_]+?__[a-z0-9_]+?__/, "city:")}:${lv.index}`;

/** Katın en alçak serbest yüksekliği ve eşiğin altında kalan yürünebilir karo sayısı. */
export function ceilingClear(lv: InteriorLevel): { min: number; low: number; first: string } {
  const built = lv.built, nav = navGrid(built);
  const portals = new Set(lv.portals.map((p) => `${p.tile[0]},${p.tile[1]}`));
  const over = built.blocks.filter((b) => b.p[1] - b.s[1] / 2 >= 0.3 && Math.min(b.s[0], b.s[2]) >= 0.3 && b.g !== "cloud" && b.g !== "snow");
  let min = Infinity, low = 0, first = "";
  for (let j = 0; j < built.depth; j++) for (let i = 0; i < built.width; i++) {
    if (!walkable(nav, i, j) || portals.has(`${i},${j}`)) continue;
    const x = tx(i), z = tz(j);
    let c = Infinity;
    for (const b of over) if (Math.abs(x - b.p[0]) <= b.s[0] / 2 && Math.abs(z - b.p[2]) <= b.s[2] / 2) c = Math.min(c, b.p[1] - b.s[1] / 2);
    if (c < min) min = c;
    if (c < CEIL_CLEAR_MIN - 1e-6) { low++; if (!first) first = `${i},${j} (${c.toFixed(2)})`; }
  }
  return { min, low, first };
}

/** INTERIOR-CEILING-002 bulgusu (bilinen alçak kat ya da geçen kat → null). */
export function ceilingClearIssue(lv: InteriorLevel): string | null {
  const c = ceilingClear(lv);
  if (!c.low || CEIL_LOW_KNOWN.has(ceilKey(lv))) return null;
  return `INTERIOR-CEILING-002 ${c.low} yürünebilir karoda serbest yükseklik < ${CEIL_CLEAR_MIN.toFixed(2)} (2,6 × göz ${LOOK_EYE_Y}; en alçak ${c.first})`;
}

// ------------------------------------------------------------------------------------------ INTERIOR-CAM
/** Masaüstü tuval en/boy oranı (real_camera.mjs OPTICS ile aynı); dikey açı profilin açısı (Hor+ tabanı altında kalmaz). */
const ASPECT = 1.6;
const CAM_PITCHES = [LOOK_DEFAULT, -0.75];

export interface InteriorCamCounts { ceilTiles: number; ceilMissing: number; camPoses: number; camInside: number; camAbove: number; ceilCut: number; eyePoses: number; profiles: string }

/** Bir pozda kameranın kutuya uzaklığı (dışarıdaysa ≥ 0). */
function boxDist(p: readonly number[], b: { p: readonly number[]; s: readonly number[] }): number {
  let d2 = 0;
  for (let q = 0; q < 3; q++) { const e = Math.max(0, Math.abs(p[q] - b.p[q]) - b.s[q] / 2); d2 += e * e; }
  return Math.sqrt(d2);
}

/**
 * WalkRig takip kamerasının saf ikizi (sabit durum, hareket azaltmadaki poz): yörünge → zemin payı → tavan sıkıştırması →
 * `resolveFollowCam` → yaylı kol. Dönüş: kamera, göz yedeğine düştü mü, profil. Test ve denetim aynı işlevi kullanır.
 */
export function solveInteriorPose(src: BoxSource, cover: CoverGrid, nav: NavGrid, blocks: readonly Block[], i: number, j: number, yaw: number, pitch: number,
  space: "room" | "hall" | "deck" | "court" | null, aspect = ASPECT, eyeOverride?: number): { cam: [number, number, number]; eye: boolean; profile: CamSpace; fov: number; look: [number, number, number] } {
  const o = openness((a, b) => walkable(nav, a, b), i, j);
  const x = tx(i), z = tz(j);
  const pivot = { x, y: LOOK_Y, z };
  const over = ceilingOver(src, x, z, LOOK_Y + HEAD_CLEAR, space === "room" || space === "hall" ? 0.45 : 0);
  const profile = selectProfile({ space, ...o, ceiling: over });
  const prof = profileOf(profile);
  // telefonda (en/boy ≠ 1,6) WalkRig'in açısı (thirdFov: Hor+ tabanlı walkFov) — dikey 375 × 812'de ≈ 77°
  const fov = aspect === ASPECT ? prof.vfov : walkFov(WALK_FOV_DEFAULT, aspect, prof.vfov - CAMERA_PROFILES.street.vfov), dist = prof.dist;
  const P = orbitPose(pivot, yaw, pitch, dist, { x: 0, y: 0, z: 0 });
  if (P.y < CAM_FLOOR) P.y = CAM_FLOOR;
  shoulderShift(P, yaw, prof.shoulder);
  const cf = fitUnderCeiling(src, pivot, P, { dist, pitch, radius: probeRadius(WALK_NEAR, fov, aspect, space === "room" || space === "hall"), floorTop: 0.2, footY: 0,
    reach: space === "room" || space === "hall" ? 0.45 : 0 });
  const eyeIn = eyeOverride ?? armEyeIndoor(2 * Math.atan(Math.tan((fov * Math.PI) / 360) * aspect)); // WalkRig ile aynı (yatay görüşle)
  const indoor = space === "room" || space === "hall"; // iç mekânda göz yedeği eşiği WalkRig ile aynı (ARM_EYE_INDOOR)
  const fc = resolveFollowCam(cover, { x, z }, pivot, P, { yaw, pitch: cf.pitch, dist, footY: 0, blocks, maxY: Math.min(cf.maxY, LOOK_Y + Math.sin(prof.elevMax) * dist), eyeDist: indoor ? eyeIn : undefined });
  if (fc.mode === "eye") return { cam: [fc.x, fc.y, fc.z], eye: true, profile, fov, look: [fc.lx, fc.ly, fc.lz] };
  const rig = createCamRig();
  const holder = { blocks: [] as Block[] };
  rig.built = holder; rig.src = src;
  const cam = { x: fc.x, y: fc.y, z: fc.z }, look = { x: fc.lx, y: fc.ly, z: fc.lz };
  followArm(rig, holder, pivot, cam, look, { dt: 1, calm: true, near: WALK_NEAR, fov, aspect, footY: 0, tight: indoor,
    lift: fc.mode === "orbit" && prof.lift, whiskers: true, maxElev: elevCap(cf, LOOK_Y, dist, prof.elevMax) });
  return { cam: [cam.x, cam.y, cam.z], eye: indoor ? Math.hypot(cam.x - pivot.x, cam.y - pivot.y, cam.z - pivot.z) < eyeIn : rig.arm.len < ARM_EYE, profile, fov, look: [look.x, look.y, look.z] }; // canlı kameranın bakış noktası (kapılar chest'e değil buna ışın atar)
}

/** INTERIOR-CEILING-001 + CAMERA-INSIDE-001 (bir kat). Açık hava katı (güverte) tavansızdır; yalnız CAMERA-INSIDE denetlenir. */
export function interiorCameraReport(lv: InteriorLevel): { problems: string[]; counts: InteriorCamCounts } {
  const problems: string[] = [];
  const counts: InteriorCamCounts = { ceilTiles: 0, ceilMissing: 0, camPoses: 0, camInside: 0, camAbove: 0, ceilCut: 0, eyePoses: 0, profiles: "" };
  const built = lv.built, nav = navGrid(built), cover = coverGrid(built);
  const blocks: Block[] = [...built.blocks, ...itemBlocks(lv, new Set())];
  const src = blockSource(blocks);
  const ceilings = built.blocks.filter((b) => b.ceil === 1);
  const space = spaceOf(lv);
  const stairRun = new Set(lv.stairs.filter((st) => st.dir === "up").flatMap((st) => st.run.map((t) => `${t[0]},${t[1]}`)));
  // tavan kapsamı
  if (!lv.outdoor) {
    let first = "";
    for (let j = 0; j < built.depth; j++) for (let i = 0; i < built.width; i++) {
      if (!walkable(nav, i, j) || stairRun.has(`${i},${j}`)) continue;
      if (cover.roofY[j * cover.width + i] !== Infinity) counts.ceilTiles++;
      else { counts.ceilMissing++; if (!first) first = `${i},${j}`; }
    }
    if (counts.ceilMissing) problems.push(`INTERIOR-CEILING-001 ${counts.ceilMissing} yürünebilir karonun üstünde tavan yok (ilk ${first})`);
    if (!ceilings.length) problems.push("INTERIOR-CEILING-001 kapalı katta tavan bloğu yok");
  } else if (ceilings.length) problems.push("INTERIOR-CEILING-001 açık hava katında tavan bloğu var");
  // kamera pozları
  const seen = new Map<string, number>();
  let firstInside = "", firstAbove = "", firstCut = "";
  for (let j = 0; j < built.depth; j++) for (let i = 0; i < built.width; i++) {
    if (!walkable(nav, i, j)) continue;
    const x = tx(i), z = tz(j);
    // avatar katının içinde duramaz (çarpışma iter): gövde sütunu katıya değen karo örneklenmez (real_camera.mjs ile aynı süzgeç)
    const pre: { p: readonly number[]; s: readonly number[]; g?: string }[] = [];
    src(x - 1, z - 1, x + 1, z + 1, pre);
    if (pre.some((b) => collidable(b, 0.2) && [0.3, 0.6, 0.9].some((y) => boxDist([x, y, z], b) < 0.18))) continue;
    for (const yaw of YAWS) for (const pitch of CAM_PITCHES) {
      const r = solveInteriorPose(src, cover, nav, blocks, i, j, yaw, pitch, space);
      counts.camPoses++;
      seen.set(r.profile, (seen.get(r.profile) ?? 0) + 1);
      if (r.eye) { counts.eyePoses++; continue; }
      const corner = nearCorner(WALK_NEAR, r.fov, ASPECT);
      const near: { p: readonly number[]; s: readonly number[]; g?: string }[] = [];
      src(r.cam[0] - 1, r.cam[2] - 1, r.cam[0] + 1, r.cam[2] + 1, near);
      if (near.some((b) => collidable(b, 0.2) && boxDist(r.cam, b) < corner - 1e-3)) { counts.camInside++; if (!firstInside) firstInside = `${i},${j} yön ${yaw.toFixed(2)} eğim ${pitch}`; }
      // kamera avatarın tavanının üstüne çıkmıyor (tavanlı karoda kamera noktasının üstünde de tavan var ya da kamera tavan altında)
      const top = ceilingOver(src, x, z, LOOK_Y + HEAD_CLEAR, 0);
      if (Number.isFinite(top) && r.cam[1] >= top - 1e-3) { counts.camAbove++; if (!firstAbove) firstAbove = `${i},${j} y ${r.cam[1].toFixed(2)} ≥ tavan ${top.toFixed(2)}`; }
      // çalışma zamanı kesit planı tavanı/çatıyı hiç atmıyor
      const plan = walkCutPlan({ cover, avatar: { x, z, foot: 0 }, chest: [x, LOOK_Y, z], cam: r.cam, first: false,
        rule: space === "deck" ? null : { space, cutaway: false, minY: CUT_FLOOR_Y } });
      const cutRoof = plan.roof !== null || ceilings.some((b) => planCuts(plan, b));
      if (cutRoof) { counts.ceilCut++; if (!firstCut) firstCut = `${i},${j} yön ${yaw.toFixed(2)}`; }
    }
  }
  counts.profiles = [...seen].map(([k, v]) => `${k}:${v}`).join(" ");
  if (counts.camInside) problems.push(`CAMERA-INSIDE-001 ${counts.camInside}/${counts.camPoses} pozda kamera katının (duvar/tavan/eşya) içinde (ilk ${firstInside})`);
  if (counts.camAbove) problems.push(`CAMERA-INSIDE-001 ${counts.camAbove} pozda kamera tavanın üstünde (ilk ${firstAbove})`);
  if (counts.ceilCut) problems.push(`INTERIOR-CEILING-001 ${counts.ceilCut} pozda tavan/çatı kesitte atılıyor (ilk ${firstCut})`);
  return { problems, counts };
}
