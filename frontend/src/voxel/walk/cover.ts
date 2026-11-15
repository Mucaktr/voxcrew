/**
 * W1a (WALK-CORE) — kesit (cutaway) verisi ve +0 çizim çağrılı kırpma tasarımı ( A).
 *
 * İki terim, tek kırpma bloğu:
 * 1. **Çatı kesiti.** Avatarın karosu örtülüyse (`coverGrid`), merkez = avatar, yarıçap ~7 içinde ve `y > uCutY` (bulunulan
 * katın tavanı, ≈ çatı tabanı − 0,05) olan blok parçaları atılır; kenarda 0,6 birimlik dither.
 * 2. **Duvar penceresi.** Kameradan avatara giden doğruyu bir zemin bloğu kesiyorsa (ızgarada ışın yürütme), ekran uzayında
 * avatarın çevresinde ~90 px'lik dairede, avatardan kameraya daha yakın parçalar dither ile açılır.
 *
 * Bu dosyada **veri** (`computeCutaway`, saf) ve **birim + gölgelendirici yaması** (`cutawayUniforms`, `installCutaway`) var.
 * W1a hiçbir malzemeye dokunmaz: W2 (`Blocks.tsx`) yalnızca sahne bloğu malzemelerine (solid, glass, glow, …; kalabalık, ufuk ve
 * fx değil) bir kez `installCutaway(material)` çağırır. Birimler her karede değil, yalnızca değişince yazılır (WalkRig). Kapalıyken
 * (`uCutRoof.w = 0`, `uCutWin.w = 0`) gölgelendirici iki karşılaştırma yapar ve çıkar; program bir kez derlenir
 * (`customProgramCacheKey` sabit), malzeme ve çizim çağrısı sayısı değişmez.
 * three çalışma zamanı içe aktarılmaz (birimler düz dizi; three vec3/vec4 birimlerine dizi kabul eder) → Node testinde de yüklenir.
 *
 * WORLD-FIX (2026-10-26, ürün sahibi: "kamera açılarında şeffaflaşma var") — TEK KURAL, her alanda: kesit yalnız kamerayla avatar
 * arasındaki GERÇEK örtücüdür ve her zaman BÜTÜN BLOKtur (blok merkezine göre, köşe gölgelendiricisinde). Parça başına (fragment)
 * kesit yok: eski çatı kesiti 7 birimlik dairede çatı tabanı üstündeki HER parçayı dither'la atıyor (komşu simgenin tepesi, ağaç
 * tacı, sütun "yarı saydam/oyuk"), açık dünyadaki duvar penceresi 90 px'lik ekran dairesinde avatarın önündeki HER parçayı
 * atıyordu (örtücü olmayan masa/direk/zemin yarım kesilip içi görünüyordu; iç mekân ve sokak UX-AUDIT/UX-P2'de düzelmiş, açık
 * dünya — ofis, park, şehir sahneleri — eski kuralda kalmıştı). Şimdi:
 * 1. **Gövde yoklaması** (eski "sokak" terimi, `walkCutPlan`): üçüncü şahısta ve fotoğraf modunda her alanda açık; göğüs, baş ve
 * iki omuzdan kameraya giden doğrulardan birini kesen blok bütün olarak atılır (zemin, merkez y ≤ `minY`, kalır).
 * 2. **Çatı** (`roofRect`): avatar örtülü karodaysa yalnız AVATARIN ÇATISININ bileşeni (örtülü karoların bağlı kümesi) içinde ve
 * tamamı çatı tabanının üstünde kalan bloklar bütün olarak atılır; çatıyı delip geçen duvar/sütun/kule ve komşu yapılar kalır.
 * 3. **Kabuk** (iç mekân oda/salon): değişmedi (yan duvar kabuğu, blok merkezine göre).
 * 4. **Yörünge yakın bölgesi** (`orbitCutPlan`, yürüme dışı): kamera bir bloğun içine ya da yakın düzlemin önüne girerse yalnız
 * o bloklar bütün olarak atılır (yakın düzlemde kesilmiş "içi boş" model yok).
 * Ekran dairesi (pencere/kabarcık) terimi kaldırıldı; `writeWindowUniforms` uyumluluk için kalır ama gölgelendirici okumaz.
 *
 * CAMERA (2026-10-28, ürün sahibi: "kameranın binaların içinden geçmesi ve şeffaflaşmalar acemice"): gövde yoklaması (1) artık örtücü
 * bloğu bütün atmaz; yalnız kamera → avatar görüş konisinin içinde 4 × 4 Bayer titreşimiyle delik açar (`uCutLos`, camera/
 * occlusion.ts `LOS_GLSL`; plan `los` yoksa — yörünge, manzara — eski bütün blok). Çatı (2) bütün blok kalır ama `uCutFade`
 * yoğunluğuyla titreşerek gelir/gider. Kabuk (3) ve kamera kabarcığı değişmedi. Kamera artık katıya girmez (camera/collide.ts).
*/
import type { CoverGrid } from "./controller";
import { heightAt, occlusion, roofAt, tileAt } from "./controller";
import { D, W } from "../scenes";
import { BIG_GLSL, bigBlock, LOS_GLSL, LOS_R } from "../camera/occlusion";
import { THIN } from "../camera/collide";

export const CUT_RADIUS = 7;
export const CUT_EDGE = 0.6;
export const WIN_RADIUS_PX = 90;
/** Gölgelendiriciye giden satır/sütun dizisi boyu (iç mekân ızgarası en çok 27; daha büyük ızgarada fazlası sınır kutusuyla). */
export const SHAPE_MAX = 40;
/** çatı tabanının biraz altından kes (tavan döşemesinin alt yüzü de gitsin) */
const CUT_BELOW_ROOF = 0.05;

export interface Cutaway {
  /** çatı kesiti açık mı */
  roof: boolean;
  /** kesit merkezi (dünya) ve yükseklik eşiği */
  cx: number;
  cz: number;
  cutY: number;
  radius: number;
  /** duvar penceresi açık mı (kamera–avatar doğrusu bir bloğu kesiyor) */
  window: boolean;
  /** kamera çarpışması: kamera mesafesi bu orana kısaltılmalı (1 = kısaltma yok) */
  camScale: number;
  /** karo anahtarı: kesit yalnızca karo değişince yeniden hesaplanır (rig önbelleği) */
  tileKey: string;
  /** WORLD-FIX: avatarın çatı bileşeninin dünya dikdörtgeni (x0, z0, x1, z1); çatı yoksa null */
  rect?: [number, number, number, number] | null;
}

export const CUT_OFF: Readonly<Cutaway> = Object.freeze({ roof: false, cx: 0, cz: 0, cutY: Infinity, radius: CUT_RADIUS, window: false, camScale: 1, tileKey: "" });

/**
 * Avatar (göğüs ≈ 1,2) ve kamera konumundan kesit verisi. Saf ve belirlenimci.
 * `minCamDist`: kamera çarpışmasında kısalma alt sınırı (birim, §3.5.5: 2,5); `camDist` şu anki kamera–avatar uzaklığı.
 */
export function computeCutaway(cover: CoverGrid, avatar: { x: number; z: number }, cam: { x: number; y: number; z: number },
  opts: { chestY?: number; minCamDist?: number; footY?: number } = {}): Cutaway {
  const chestY = opts.chestY ?? 1.2;
  const [i, j] = tileAt(avatar.x, avatar.z);
  // WALK-PHYS: çatının üstünde duran avatar (tırmanma) çatı altında sayılmaz
  const roofY = roofAt(cover, i, j);
  const roof = roofY !== Infinity && roofY > (opts.footY ?? 0) + 0.5;
  const from: [number, number, number] = [avatar.x, chestY, avatar.z];
  const to: [number, number, number] = [cam.x, cam.y, cam.z];
  // INTERIOR-CAM: çatı artık kesilmez → çatı da kamerayı örter (kamera tavanın altında kalır: camera/ceiling.ts)
  const free = occlusion(cover, from, to);
  const window = free < 1;
  const dist = Math.hypot(cam.x - avatar.x, cam.y - chestY, cam.z - avatar.z);
  const minD = opts.minCamDist ?? 2.5;
  // pencere açıkken kamera yalnızca yakın engelde (ilk %35) kısalır; uzaktaki duvar pencereyle açılır
  const camScale = window && free < 0.35 && dist > 0 ? Math.max(Math.min(1, minD / dist), free) : 1;
  return { roof, cx: avatar.x, cz: avatar.z, cutY: roof ? roofY - CUT_BELOW_ROOF : Infinity, radius: CUT_RADIUS, window, camScale, tileKey: `${i},${j}`,
    rect: roof ? roofRect(cover, i, j) : null };
}

/**
 * W5 — kamera duvar kıskacı: kamera noktası bir zemin bloğunun (duvar sütunu) içine düştüyse kamerayı avatar–kamera doğrusu
 * üzerinde ilk engelin hemen önüne çeker. Dönüş: kamera mesafesinin çarpılacağı oran (1 = değişmez). Uzaktaki duvarı kesit
 * penceresi açmaya devam eder; bu yalnızca kameranın bloğun **içinde** kalmasını (iç yüzlerin görünmesi) önler.
 */
export function wallClamp(cover: CoverGrid, avatar: { x: number; z: number }, cam: { x: number; y: number; z: number },
  opts: { chestY?: number; minScale?: number } = {}): number {
  const [i, j] = tileAt(cam.x, cam.z);
  const [ai, aj] = tileAt(avatar.x, avatar.z);
  if (i === ai && j === aj) return 1;
  if (heightAt(cover, i, j) <= cam.y) return 1;
  const chestY = opts.chestY ?? 1.2;
  const free = occlusion(noRoof(cover), [avatar.x, chestY, avatar.z], [cam.x, cam.y, cam.z]);
  return Math.max(opts.minScale ?? 0.18, Math.min(1, free * 0.94));
}

// ------------------------------------------------------------------------------------------ kamera–baş yakınlığı
/**
 * : kısa engel kısalması (`computeCutaway.camScale`) ve duvar kıskacı
 * (`wallClamp`, en az 0,18) birlikte kamerayı göğüs pivotuna 0,47'ye kadar çekiyordu; kamera başın 0,15 birim arkasında kalıyor,
 * baş (koyu saç) bütün ekranı kaplıyordu ("siyah ekran": İstanbul gece girişi, Londra çark önü). Yeni çözüm sırası:
 * 1. eski kısalma + kıskaç (değişmedi); pivota uzaklık ≥ `CAM_MIN_DIST` ise o poz;
 * 2. değilse **kaldırılmış** poz (aynı yaw, daha dik yükseliş 43°/60°/77°) — yalnız yukarı bakmıyorken;
 * 3. sonra **omuz üstü** poz (yaw ±32°/±63°/±90°, aynı yükseliş; sırtı duvara dayalı avatarda duvar boyunca yandan bakış);
 * 2 ve 3'te uzak mesafe önce denenir (baş küçük kalsın), bakış göğsün bakış yönünde biraz önüne (`AIM_AHEAD`);
 * 4. hiçbiri sığmazsa ve kamera başa `CAM_HIDE_DIST`'ten yakınsa o karede **göz** (birinci şahıs gözü, avatar gizli).
 * Aday poz: göğüsten adayın 0,25 ötesine kadar ızgara doğrusu açık (duvar, çatı, ağaç tacı yok), aday karosunda duvar sütunu,
 * çatı ve tavan kameranın altında/üstünde değil. Kesit ve CAMERA-OPAQUE kuralı değişmez: kesit planı son kamera konumuyla kurulur
 * (WalkRig ve `opaqueCheck.ts` bu işlevi birlikte kullanır). Saf ve belirlenimci.
*/
/** avatar baş merkezinin ayaktan yüksekliği (yürüme ölçeği; baş kutusu y 0,55–1,0) */
export const HEAD_CENTER_Y = 0.78;
/** kamera baş merkezine bundan yakınsa avatar gizlenir; yeniden görünme eşiği (histerezis) */
export const CAM_HIDE_DIST = 0.9;
export const CAM_SHOW_DIST = 1.0;
/** kıskaç kamerayı göğüs pivotuna bundan yakın çekerse kaldırılmış / omuz üstü pozlar denenir */
export const CAM_MIN_DIST = 1.25;
/** kaldırılmış pozun yükselişleri (rad) ve yalnız bu eğimin altında denenmesi (yukarı bakışta omuz üstü) */
export const LIFT_ELEV = [0.75, 1.05, 1.35] as const;
export const LIFT_PITCH_MAX = 0.35;
/** omuz üstü yaw kaymaları (rad) */
export const SHOULDER_YAW = [0.55, -0.55, 1.1, -1.1, Math.PI / 2, -Math.PI / 2] as const;
/** adayın arkasında bırakılan boşluk (birim; yakın düzlem duvara değmesin) */
const CAND_PAD = 0.25;
/** kaldırılmış / omuz üstü pozda bakış noktası: göğüs + bakış yönü × bu (avatar kadrajda, bakış yönü okunur) */
const AIM_AHEAD = 1.5;
/** göz yüksekliği (ayaktan; scale.ts EYE_Y ile aynı — döngüsel içe aktarma olmasın diye burada) ve kamera zemin payı */
const EYE_H = 0.91, FLOOR_PAD = 0.3, ORBIT_LOW = -0.12;

export type FollowMode = "orbit" | "lift" | "shoulder" | "eye";
export interface FollowCam {
  x: number; y: number; z: number;
  /** bakış noktası */
  lx: number; ly: number; lz: number;
  mode: FollowMode;
  /** son kameranın göğüs pivotuna uzaklığı */
  dist: number;
}
type P3 = { x: number; y: number; z: number };

/** Kameranın avatar baş merkezine uzaklığı (`headY` = ayak + baş merkezi). */
export const headDistance = (cam: P3, avatar: { x: number; z: number }, headY: number) => Math.hypot(cam.x - avatar.x, cam.y - headY, cam.z - avatar.z);

function candidateFits(cover: CoverGrid, pivot: P3, x: number, y: number, z: number, footY: number, blocks?: readonly { p: V3; s: V3; g?: string }[]): boolean {
  if (y < footY + FLOOR_PAD) return false;
  // ızgara karo merkezine göre yazılır: karo kenarındaki ince blok (direk, saçak, çatı levhası) ızgarada görünmeyebilir → gerçek bloklar
  if (blocks && nearBlocks(blocks, [x, y, z], CAND_PAD).length) return false;
  const dx = x - pivot.x, dy = y - pivot.y, dz = z - pivot.z, d = Math.hypot(dx, dy, dz) || 1, k = (d + CAND_PAD) / d;
  const ex = pivot.x + dx * k, ey = pivot.y + dy * k, ez = pivot.z + dz * k;
  for (const [px, py, pz] of [[x, y, z], [ex, ey, ez]] as const) {
    const [i, j] = tileAt(px, pz);
    if (heightAt(cover, i, j) > py - 0.1 || roofAt(cover, i, j) < py + 0.1) return false;
    const inside = i >= 0 && j >= 0 && i < cover.width && j < cover.depth;
    if (inside && cover.ceilY && cover.ceilY[j * cover.width + i] < py + 0.1) return false;
  }
  return occlusion(cover, [pivot.x, pivot.y, pivot.z], [ex, ey, ez]) >= 1;
}

function setLook(out: FollowCam, pivot: P3, yaw: number, pitch: number, mode: FollowMode) {
  const c = Math.cos(pitch), fx = Math.sin(yaw) * c, fy = Math.sin(pitch), fz = Math.cos(yaw) * c;
  out.mode = mode;
  out.dist = Math.hypot(out.x - pivot.x, out.y - pivot.y, out.z - pivot.z);
  if (mode === "lift" || mode === "shoulder") { out.lx = pivot.x + fx * AIM_AHEAD; out.ly = pivot.y + fy * AIM_AHEAD; out.lz = pivot.z + fz * AIM_AHEAD; return; }
  const r = mode === "eye" ? 1 : Math.max(0.5, out.dist);
  out.lx = out.x + fx * r; out.ly = out.y + fy * r; out.lz = out.z + fz * r;
}

/**
 * Üçüncü şahıs takip kamerasının son konumu ve bakış noktası. `cam`: yörünge pozu (zemin payı uygulanmış), `pivot`: göğüs.
 * `camScale` verilirse kısa engel kısalması yeniden hesaplanmaz. `roomCut` (iç mekân/sokak kesiti): kamera hiç kısalmaz.
 */
export function resolveFollowCam(cover: CoverGrid, avatar: { x: number; z: number }, pivot: P3, cam: P3,
  o: { yaw: number; pitch: number; dist: number; footY: number; roomCut?: boolean; camScale?: number; blocks?: readonly { p: V3; s: V3; g?: string }[];
    /** INTERIOR-CAM: tavan sıkıştırmasının üst sınırı (camera/ceiling.ts `maxY`): kaldırılmış/omuz üstü aday tavanın üstüne çıkmaz */
    maxY?: number;
    /** kamera başa bundan yakınsa göz yedeği (varsayılan `CAM_HIDE_DIST`; iç mekânda `ARM_EYE_INDOOR`)*/
    eyeDist?: number },
  out?: FollowCam): FollowCam {
  const r = out ?? { x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, mode: "orbit", dist: 0 };
  r.x = cam.x; r.y = cam.y; r.z = cam.z;
  if (o.roomCut) { setLook(r, pivot, o.yaw, o.pitch, "orbit"); return r; }
  const toward = (k: number) => { r.x = pivot.x + (r.x - pivot.x) * k; r.y = pivot.y + (r.y - pivot.y) * k; r.z = pivot.z + (r.z - pivot.z) * k; };
  const pre = o.camScale ?? computeCutaway(cover, avatar, cam, { chestY: pivot.y, footY: o.footY }).camScale;
  if (pre < 1) toward(pre);
  const k = wallClamp(cover, avatar, r, { chestY: pivot.y });
  if (k < 1) toward(k);
  const arm = Math.hypot(r.x - pivot.x, r.y - pivot.y, r.z - pivot.z);
  // iç mekânda (eyeDist verilmiş) kol göz yedeği eşiğinden kısaysa WalkRig avatarı gizliyordu (dikey telefonda ≈ 2,1 birim: dar koridor/oda
  // karosunun ~yarısı); önce eşiğin hemen ötesinde kaldırılmış/omuz üstü poz denenir (baş küçük kalır), sığmazsa eski poz aynen
  const far = o.eyeDist !== undefined ? Math.max(o.dist, o.eyeDist + 0.1) : 0;
  if (arm >= CAM_MIN_DIST && !(far && arm < o.eyeDist!)) { setLook(r, pivot, o.yaw, o.pitch, "orbit"); return r; }
  const base = o.dist > CAM_MIN_DIST + 0.4 ? [o.dist, (o.dist + CAM_MIN_DIST) / 2, CAM_MIN_DIST] : [Math.max(o.dist, CAM_MIN_DIST)];
  const dists = arm >= CAM_MIN_DIST ? [far] : far && far !== base[0] ? [far, ...base] : base;
  const orbit = { x: r.x, y: r.y, z: r.z };
  const tryPose = (yaw: number, elev: number, d: number, mode: FollowMode): boolean => {
    const ce = Math.cos(elev), se = Math.sin(elev);
    const x = pivot.x - Math.sin(yaw) * ce * d, y = Math.max(o.footY + FLOOR_PAD, pivot.y + se * d), z = pivot.z - Math.cos(yaw) * ce * d;
    if (o.maxY !== undefined && y > o.maxY + 1e-6) return false;
    if (!candidateFits(cover, pivot, x, y, z, o.footY, o.blocks)) return false;
    r.x = x; r.y = y; r.z = z;
    setLook(r, pivot, o.yaw, o.pitch, mode);
    return true;
  };
  // uzak poz önce (baş küçük kalsın): her mesafede önce kaldırılmış, sonra omuz üstü
  const elev = Math.max(ORBIT_LOW, -o.pitch);
  for (const d of dists) {
    if (o.pitch <= LIFT_PITCH_MAX) for (const e of LIFT_ELEV) if (tryPose(o.yaw, Math.max(e, -o.pitch), d, "lift")) return r;
    // dosdoğru arkada aynı eğimle uzatılmış kol — dar iç mekân profili (`corridor`: kol 1,2 < göz eşiği 1,3, yükseliş tavanı
    // 0,6 < LIFT_ELEV) kaldırılmış adayı hiç sığdıramıyor, ince korkuluklu tek karoluk yolda kamera omuz üstü poza (avatarın yanına) düşüyordu
    if (tryPose(o.yaw, elev, d, "orbit")) return r;
    for (const dy of SHOULDER_YAW) if (tryPose(o.yaw + dy, elev, d, "shoulder")) return r;
  }
  // dikey telefonda (eyeDist < 0,5) 1,25+ birimlik aday sığmadıysa avatarı gizleme: daha kısa kolda kaldırılmış/omuz üstü ara (avatar iri görünür)
  if (o.eyeDist !== undefined && o.eyeDist < 0.5) for (const d of [0.95, 0.7, o.eyeDist + 0.12]) {
    for (const e of LIFT_ELEV) if (tryPose(o.yaw, Math.max(e, -o.pitch), d, "lift")) return r;
    for (const dy of SHOULDER_YAW) if (tryPose(o.yaw + dy, elev, d, "shoulder")) return r;
  }
  if (arm >= CAM_MIN_DIST) { r.x = orbit.x; r.y = orbit.y; r.z = orbit.z; setLook(r, pivot, o.yaw, o.pitch, "orbit"); return r; } // yalnız eşik-ötesi arandı, sığmadı — eski orbit pozu
  if (headDistance(r, avatar, o.footY + HEAD_CENTER_Y) < (o.eyeDist ?? CAM_HIDE_DIST)) {
    r.x = avatar.x; r.y = o.footY + EYE_H; r.z = avatar.z;
    setLook(r, pivot, o.yaw, o.pitch, "eye");
    return r;
  }
  setLook(r, pivot, o.yaw, o.pitch, "orbit");
  return r;
}

const roofless = new WeakMap<CoverGrid, CoverGrid>();
function noRoof(c: CoverGrid): CoverGrid {
  let r = roofless.get(c);
  if (!r) { r = { ...c, roofY: new Float32Array(c.roofY.length).fill(Infinity), covered: 0 }; roofless.set(c, r); }
  return r;
}

/** WORLD-FIX: çatı bileşenleri (4 komşulu, çatı tabanı farkı < 0,6) — örtü ızgarası başına bir kez. */
const ROOF_STEP = 0.6;
const roofComps = new WeakMap<CoverGrid, { label: Int32Array; rects: [number, number, number, number][] }>();
/** Avatarın karosunu örten çatının bileşeni: dünya dikdörtgeni (x0, z0, x1, z1); karo örtülü değilse null. */
export function roofRect(cover: CoverGrid, i: number, j: number): [number, number, number, number] | null {
  if (i < 0 || j < 0 || i >= cover.width || j >= cover.depth || cover.roofY[j * cover.width + i] === Infinity) return null;
  let rc = roofComps.get(cover);
  if (!rc) {
    const { width: w, depth: d, roofY } = cover;
    const label = new Int32Array(w * d).fill(-1);
    const rects: [number, number, number, number][] = [];
    const stack: number[] = [];
    for (let k0 = 0; k0 < w * d; k0++) {
      if (roofY[k0] === Infinity || label[k0] >= 0) continue;
      const id = rects.length;
      let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
      label[k0] = id; stack.push(k0);
      while (stack.length) {
        const k = stack.pop()!;
        const ci = k % w, cj = (k - ci) / w;
        i0 = Math.min(i0, ci); i1 = Math.max(i1, ci); j0 = Math.min(j0, cj); j1 = Math.max(j1, cj);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= d) continue;
          const nk = nj * w + ni;
          if (label[nk] >= 0 || roofY[nk] === Infinity || Math.abs(roofY[nk] - roofY[k]) > ROOF_STEP) continue;
          label[nk] = id; stack.push(nk);
        }
      }
      rects.push([i0 - W / 2, j0 - D / 2, i1 + 1 - W / 2, j1 + 1 - D / 2]);
    }
    rc = { label, rects };
    roofComps.set(cover, rc);
  }
  const l = rc.label[j * cover.width + i];
  return l >= 0 ? rc.rects[l] : null;
}

/** Blok çatı teriminde atılıyor mu (gölgelendiricideki `cutRoofBox` ikizi): merkez avatarın çatı dikdörtgeninde ve avatara
 *  `CUT_RADIUS` içinde (büyük bağlı çatılarda uzak yapılar kalır), tabanı çatı eşiğinin üstünde. */
export function roofCuts(rect: readonly number[] | null | undefined, cutY: number, b: { p: readonly number[]; s: readonly number[] },
  center?: { x: number; z: number }): boolean {
  if (!rect) return false;
  const [x, y, z] = b.p;
  if (x < rect[0] || x > rect[2] || z < rect[1] || z > rect[3]) return false;
  if (center && Math.hypot(x - center.x, z - center.z) > CUT_RADIUS) return false;
  return y - b.s[1] / 2 >= cutY - ROOF_SLACK;
}
const ROOF_SLACK = 0.02;

/** Avatar bir bina ayak izinde mi (HUD / ses: "içeride"). */
export const isIndoor = (cover: CoverGrid, x: number, z: number) => { const [i, j] = tileAt(x, z); return roofAt(cover, i, j) !== Infinity; };

/** Karonun yanındaki duvar yüksekliği (W2 görsel tur yardımcısı). */
export const wallHeight = (cover: CoverGrid, x: number, z: number) => { const [i, j] = tileAt(x, z); return heightAt(cover, i, j); };

// ------------------------------------------------------------------------------------------ birimler
export interface CutawayUniforms {
  /** xyz = kesit merkezi (y kullanılmaz), w = açık (1) / kapalı (0) */
  uCutRoof: { value: [number, number, number, number] };
  /** x = yarıçap, y = yükseklik eşiği (uCutY), z = dither kenarı */
  uCutParams: { value: [number, number, number, number] };
  /** WORLD-FIX: çatı bileşeninin dünya dikdörtgeni (x0, z0, x1, z1) — çatı terimi bütün blok, yalnız bu dikdörtgende */
  uCutRoofRect: { value: [number, number, number, number] };
  /** x, y = avatarın ekran konumu (fiziksel px, gl_FragCoord uzayı; alt-sol köken), z = yarıçap (px), w = açık / kapalı */
  uCutWin: { value: [number, number, number, number] };
  /** avatarın görüş uzayı derinliği (kameradan uzaklık, + değer); bundan yakın parçalar pencerede açılır */
  uCutWinDepth: { value: number };
  /** INTERIOR-VIEW: pencere yalnız bu dünya yüksekliğinin üstündeki parçaları açar (iç mekân kesitinde zemin kalır); kapalıyken −1e6 */
  uCutWinY: { value: number };
  /** INTERIOR-VIEW kabuk yanları açık mı (−x, +x, −z, +z); hepsi 0 → kapalı */
  uCutShellOn: { value: [number, number, number, number] };
  /** kabuk yalnız merkezi bu yüksekliğin üstündeki blokları atar (zemin kalır) */
  uCutShellY: { value: number };
  /** oda biçimi: x = ızgara eni, y = derinliği (≤ SHAPE_MAX); `shape` son yazılan biçim (yeniden yazmayı önler) */
  uCutShellGrid: { value: [number, number, number, number]; shape?: RoomShape | null };
  /** sınır kutusu karo dizini i0, j0, i1, j1 (dizi dışı satır/sütun için) */
  uCutShellBB: { value: number[] };
  /** satır başına yürünebilir i aralığı, sütun başına j aralığı (−1 = boş) */
  uCutRowMin: { value: Float32Array };
  uCutRowMax: { value: Float32Array };
  uCutColMin: { value: Float32Array };
  uCutColMax: { value: Float32Array };
  /** UX-P2 sokak kesiti: xyz = kamera (dünya; planın kamerası), w = açık / kapalı*/
  uCutStreet: { value: [number, number, number, number] };
  /** sokak kesiti yalnız merkezi bu yüksekliğin üstündeki blokları atar (zemin, yol, kaldırım kalır) */
  uCutStreetY: { value: number };
  /** avatar gövde yoklama noktaları (göğüs, baş, iki omuz; `streetProbes`) — 4 × vec3 */
  uCutProbe: { value: Float32Array };
  /** WORLD-FIX kamera kabarcığı: xyz = kamera, w = yarıçap (0 = kapalı); bu küreye değen blok bütün olarak açılır (yakın düzlem) */
  uCutNear: { value: [number, number, number, number] };
  /** kamera kabarcığı yalnız merkezi bu yüksekliğin üstündeki blokları açar (zemin kalır) */
  uCutNearY: { value: number };
  /** CAMERA: görüş konisi — xyz = avatar göğsü, w = avatar ucundaki yarıçap (0 → gövde yoklaması bütün blok atar) */
  uCutLos: { value: [number, number, number, number] };
  /** CAMERA: çatı kesitinin titreşim yoğunluğu (0 → çatı görünür, 1 → bütün açık); WalkRig yumuşatır */
  uCutFade: { value: number };
  /** CAMERA: 1 → kamera kabarcığı büyük blokları (duvar, cephe) bütün değil yalnız kamera çevresinde açar (yürüme); 0 → bütün (yörünge) */
  uCutNearBig: { value: number };
  /** yan kesit bandı (birim; 0 = kapalı) — `sideCuts`*/
  uCutSide: { value: number };
  /** PANO-SKELETON-001: yörünge kamerası büyük bir bloğun İÇİNDEYKEN o binanın ayak izi (x0, z0, x1, z1; x0 > x1 = kapalı) —
   * gövde bütün atılırken izine oturan ayak levhası/çatı/silme de atılır (duvarsız iskelet olmaz).*/
  uCutGrp: { value: [number, number, number, number] };
  /** `uCutGrp` yalnız üst yüzü bu yüksekliği aşan blokları atar (gövdenin altındaki zemin kalır) */
  uCutGrpY: { value: number };
}

/** Bütün sahne bloğu malzemelerinin paylaştığı tek birim seti (WalkRig yazar, Blocks okur). */
export const cutawayUniforms: CutawayUniforms = {
  uCutRoof: { value: [0, 0, 0, 0] },
  uCutParams: { value: [CUT_RADIUS, 1e6, CUT_EDGE, 0] },
  uCutRoofRect: { value: [0, 0, 0, 0] },
  uCutWin: { value: [0, 0, WIN_RADIUS_PX, 0] },
  uCutWinDepth: { value: 0 },
  uCutWinY: { value: -1e6 },
  uCutShellOn: { value: [0, 0, 0, 0] },
  uCutShellY: { value: -1e6 },
  uCutShellGrid: { value: [0, 0, 0, 0], shape: null },
  uCutShellBB: { value: [0, 0, -1, -1] },
  uCutRowMin: { value: new Float32Array(SHAPE_MAX).fill(-1) },
  uCutRowMax: { value: new Float32Array(SHAPE_MAX).fill(-1) },
  uCutColMin: { value: new Float32Array(SHAPE_MAX).fill(-1) },
  uCutColMax: { value: new Float32Array(SHAPE_MAX).fill(-1) },
  uCutStreet: { value: [0, 0, 0, 0] },
  uCutStreetY: { value: -1e6 },
  uCutProbe: { value: new Float32Array(12) },
  uCutNear: { value: [0, 0, 0, 0] },
  uCutNearY: { value: -1e6 },
  uCutLos: { value: [0, 0, 0, 0] },
  uCutFade: { value: 1 },
  uCutNearBig: { value: 0 },
  uCutSide: { value: 0 },
  uCutGrp: { value: [1, 1, -1, -1] },
  uCutGrpY: { value: 1e6 },
};

/** Kesit verisini birimlere yazar; değişiklik olduysa true (gereksiz GPU yüklemesi yok sayılır; three yine her karede yükler). */
export function writeRoofUniforms(u: Pick<CutawayUniforms, "uCutRoof" | "uCutParams"> & Partial<Pick<CutawayUniforms, "uCutRoofRect">>, c: Cutaway): boolean {
  // dikdörtgen birimi olmayan eski/kısmi birim setleri (testler) de yazılabilir
  const on = c.roof && c.rect ? 1 : 0;
  const rect = c.rect ?? [0, 0, 0, 0];
  const r = u.uCutRoof.value, p = u.uCutParams.value, q = u.uCutRoofRect?.value ?? [...rect];
  if (r[0] === c.cx && r[2] === c.cz && r[3] === on && p[1] === (on ? c.cutY : 1e6) && p[0] === c.radius
    && q[0] === rect[0] && q[1] === rect[1] && q[2] === rect[2] && q[3] === rect[3]) return false;
  r[0] = c.cx; r[1] = 0; r[2] = c.cz; r[3] = on;
  p[0] = c.radius; p[1] = on ? c.cutY : 1e6; p[2] = CUT_EDGE;
  q[0] = rect[0]; q[1] = rect[1]; q[2] = rect[2]; q[3] = rect[3];
  return true;
}

/** Duvar penceresi birimi: ekran konumu (fiziksel px), yarıçap, derinlik. `on = false` → kapalı. */
export function writeWindowUniforms(u: CutawayUniforms, on: boolean, px = 0, py = 0, depth = 0, radiusPx = WIN_RADIUS_PX, minY = NO_MIN_Y): void {
  const w = u.uCutWin.value;
  w[0] = px; w[1] = py; w[2] = radiusPx; w[3] = on ? 1 : 0;
  u.uCutWinDepth.value = depth;
  u.uCutWinY.value = on ? minY : NO_MIN_Y;
}
const NO_MIN_Y = -1e6;

// ------------------------------------------------------------------------------------------ INTERIOR-VIEW: oda/salon kesiti
/**
 * İç mekân kesiti (oda ve salon) — UX-AUDIT düzeltmesi (2026-10-22). Önceki tasarım pencere terimini sürekli açık ve bütün ekran
 * yarıçaplı tutuyordu: avatar düzleminin önündeki **her** parça (yan duvarlar, sütunlar, eşya, merdiven) atılıyor, düzlemi kesen
 * kutuların ön yüzü gidip arka yüzü de çizilmediği için katı modeller oyuk/saydam görünüyordu. Şimdi yalnız gerçek örtücüler
 * açılır, iki terimle (ek malzeme ya da çizim çağrısı yok, aynı birim seti):
 *  1. **Kabuk:** odanın biçimi satır/sütun başına yürünebilir aralık olarak tutulur (`roomShape`; kapı karosu hariç, avatarın karosu
 *     dahil — yuvarlak kule de doğru). Göğüsten kameraya giden doğru odanın bir yanının dışında bir engeli (duvar) kesiyorsa o yanın
 *     dışında kalan bloklar **blok merkezine göre bütün blok** olarak atılır: kesik çizgisi karo sınırında, yarım kesilmiş "oyuk"
 *     kutu yok; duvara asılı pencere/pano (`SHELL_PAD`) duvarla gider. Doğru o yanda açıksa (kamera odada ya da kapı açıklığından
 *     bakıyor) o yan kapalı. Katın ızgarası dışı (silüet halkası, panorama) hiç kesilmez.
 *  2. **Kabarcık:** doğru odanın **içinde** bir engeli (sütun, iç duvar, yüksek eşya) kesiyorsa avatarın çevresinde avatar boyuyla
 *     ölçeklenen ekran dairesinde, avatar derinliğinin önündeki parçalar açılır. Doğru açıksa kapalı.
 * Zemin (merkez/parça y ≤ `minY`), cam ve açıklıklar kendi malzemeleriyle kalır; doğru açıkken hiçbir blok kesilmez.
 */
export const INTERIOR_CUT_MARGIN = 0.2;
/** Kabuk payı: duvara asılı pencere/pano/denizlik (duvar karosu merkezinden 0,51–0,56) duvarla gider; odadaki eşya (≤ 0,45) kalır. */
export const SHELL_PAD = 0.07;
/** Kabarcık yarıçapı: avatarın ekrandaki boyunun bu katı (tam açık bölge yarıçapın %75'i → gövde tamamen görünür). */
export const BUBBLE_SCALE = 1.15;

/** Oda biçimi: satır başına (j) yürünebilir i aralığı, sütun başına (i) j aralığı; boş satır/sütun −1. `bb`: i0, j0, i1, j1. */
export interface RoomShape {
  w: number;
  d: number;
  rowMin: Int16Array;
  rowMax: Int16Array;
  colMin: Int16Array;
  colMax: Int16Array;
  bb: [number, number, number, number];
  /** kapı (portal) karoları (dizin j · eni + i): kapı ışık paneli ve çerçevesi örtü ızgarasında yok; doğru kapı boyunun altında
   *  bu karodan geçerse örtücü sayılır (kamera kapının dışındayken avatar parlak kapı panelinin arkasında kalmasın) */
  doors?: ReadonlySet<number>;
}
/** Kapı panelinin üst sınırı (generate.ts kapı çerçevesi: lento 1,25 + 0,05). */
export const DOOR_H = 1.3;

/**
 * Katın oda biçimi (`blocked`: 1 = oda dışı karo — iç mekânda `InteriorLevel.shell`, yoksa gezinme ızgarası). `skip`: sayılmayan karolar — kapı (çıkış portalı) karosu duvar sırasındadır;
 * sayılırsa kapının iki yanındaki duvar "odanın içinde" kalır. InteriorRig kat başına bir kez hesaplar (`WalkCameraRule.room`).
 */
export function roomShape(nav: { width: number; depth: number; blocked: Uint8Array }, skip: readonly (readonly [number, number])[] = []): RoomShape | null {
  const { width: w, depth: d } = nav;
  const skipSet = new Set(skip.map((t) => t[1] * w + t[0]));
  const rowMin = new Int16Array(d).fill(-1), rowMax = new Int16Array(d).fill(-1), colMin = new Int16Array(w).fill(-1), colMax = new Int16Array(w).fill(-1);
  const bb: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) {
    if (nav.blocked[j * w + i] || skipSet.has(j * w + i)) continue;
    if (rowMin[j] < 0 || i < rowMin[j]) rowMin[j] = i;
    if (i > rowMax[j]) rowMax[j] = i;
    if (colMin[i] < 0 || j < colMin[i]) colMin[i] = j;
    if (j > colMax[i]) colMax[i] = j;
    bb[0] = Math.min(bb[0], i); bb[1] = Math.min(bb[1], j); bb[2] = Math.max(bb[2], i); bb[3] = Math.max(bb[3], j);
  }
  return bb[0] === Infinity ? null : { w, d, rowMin, rowMax, colMin, colMax, bb, doors: skipSet };
}

/** Biçim + avatarın durduğu karo (merdiven basamağı gibi engelli ama üstünde durulan karo odanın dışında kalabilir). */
export function shapeWith(s: RoomShape, x: number, z: number): RoomShape {
  const [i, j] = tileAt(x, z);
  if (i < 0 || j < 0 || i >= s.w || j >= s.d) return s;
  if (s.rowMin[j] >= 0 && s.rowMin[j] <= i && i <= s.rowMax[j] && s.colMin[i] >= 0 && s.colMin[i] <= j && j <= s.colMax[i]) return s;
  const o: RoomShape = { ...s, rowMin: s.rowMin.slice(), rowMax: s.rowMax.slice(), colMin: s.colMin.slice(), colMax: s.colMax.slice(), bb: [...s.bb] };
  o.rowMin[j] = o.rowMin[j] < 0 ? i : Math.min(o.rowMin[j], i); o.rowMax[j] = Math.max(o.rowMax[j], i);
  o.colMin[i] = o.colMin[i] < 0 ? j : Math.min(o.colMin[i], j); o.colMax[i] = Math.max(o.colMax[i], j);
  o.bb = [Math.min(s.bb[0], i), Math.min(s.bb[1], j), Math.max(s.bb[2], i), Math.max(s.bb[3], j)];
  return o;
}

/**
 * Bir noktanın (blok merkezi ya da doğru örneği) oda biçimine göre hangi yanların dışında kaldığı: [−x, +x, −z, +z] (1/0).
 * `pad`: kabuk payı (karo dizini yön başına payla kaydırılır: asılı pencere duvar karosuna düşer). Izgara dışı → hepsi 0
 * (silüet halkası, panorama). Gölgelendiricideki `cutShellSide` ile aynı kural (CPU ikizi).
 */
export function outsideSides(s: RoomShape, x: number, z: number, pad = 0): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  const i = Math.floor(x + W / 2), j = Math.floor(z + D / 2);
  if (i < 0 || j < 0 || i >= s.w || j >= s.d) return out;
  const iN = Math.floor(x - pad + W / 2), iP = Math.floor(x + pad + W / 2), jN = Math.floor(z - pad + D / 2), jP = Math.floor(z + pad + D / 2);
  const rowHas = s.rowMax[j] >= 0, colHas = s.colMax[i] >= 0;
  out[0] = (rowHas ? iN < s.rowMin[j] : !colHas && iN < s.bb[0]) ? 1 : 0;
  out[1] = (rowHas ? iP > s.rowMax[j] : !colHas && iP > s.bb[2]) ? 1 : 0;
  out[2] = (colHas ? jN < s.colMin[i] : !rowHas && jN < s.bb[1]) ? 1 : 0;
  out[3] = (colHas ? jP > s.colMax[i] : !rowHas && jP > s.bb[3]) ? 1 : 0;
  return out;
}

/** Gövde yoklaması: göğüsten baş (+y) ve iki omuz (kameraya dik, ± yanal) doğruları da denenir (yürüme ölçeği; insan boyu ~0,65);
 *  avatar merkezine `near`'dan yakın örnekler (yanındaki duvar) sayılmaz. */
export const BODY_PROBE = { head: 0.3, side: 0.22, near: 0.5 };

export interface InteriorCutPlan {
  /** kabuk yanları: −x, +x, −z, +z (1 = doğru o yanın dışında bir engeli kesiyor → o yanın dışındaki bloklar açılır) */
  side: [number, number, number, number];
  /** kabarcık: doğru odanın içinde bir engeli kesiyor */
  bubble: boolean;
  /** göğüs → kamera doğrusu herhangi bir engeli (kabuk dahil) kesiyor */
  occluded: boolean;
}

/**
 * Saf: bir kamera pozunun iç mekân kesit planı (WalkRig her kare çağırır; walk_check WALK-INTERIOR aynı fonksiyonla denetler).
 * `shape`: `shapeWith(roomShape(nav, kapılar), avatar)`.
 */
export function interiorCutPlan(cover: CoverGrid, shape: RoomShape, chest: readonly [number, number, number], cam: readonly [number, number, number],
  body = BODY_PROBE): InteriorCutPlan {
  const side: [number, number, number, number] = [0, 0, 0, 0];
  let bubble = false, occluded = false;
  const [ai, aj] = tileAt(chest[0], chest[2]);
  const camOut = outsideSides(shape, cam[0], cam[2]);
  // göğüs + baş + iki omuz (kameraya dik yanal): yalnız göğüs doğrusu gövdenin yarısını örten duvarı kaçırır
  let lx = -(cam[2] - chest[2]), lz = cam[0] - chest[0];
  const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
  const probes: [number, number, number][] = [[chest[0], chest[1], chest[2]], [chest[0], chest[1] + body.head, chest[2]],
    [chest[0] + lx * body.side, chest[1], chest[2] + lz * body.side], [chest[0] - lx * body.side, chest[1], chest[2] - lz * body.side]];
  for (const from of probes) {
    const len = Math.hypot(cam[0] - from[0], cam[1] - from[1], cam[2] - from[2]);
    const n = Math.max(8, Math.ceil(len / 0.05));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const x = from[0] + (cam[0] - from[0]) * t, y = from[1] + (cam[1] - from[1]) * t, z = from[2] + (cam[2] - from[2]) * t;
      const [i, j] = tileAt(x, z);
      if ((i === ai && j === aj) || (heightAt(cover, i, j) <= y && !(y < DOOR_H && shape.doors?.has(j * shape.w + i)))) continue;
      // avatarın kendi gövde çevresi (yanındaki duvar) örtücü değil: yalnız avatarla kamera arasındaki engel
      if (Math.hypot(x - chest[0], z - chest[2]) < body.near) continue;
      occluded = true;
      // örtücü karonun merkezi odanın hangi yanının dışında: yalnız o yan açılır (kapı açıklığından bakan kameraya yan duvarlar kalır)
      const o = outsideSides(shape, i - W / 2 + 0.5, j - D / 2 + 0.5);
      if (o[0] || o[1] || o[2] || o[3]) {
        // köşe parçası birden çok yanın dışındaysa yalnız kameranın da dışında olduğu yan (yuvarlak kulede avatarın arkasındaki duvar kalır)
        const both = o[0] & camOut[0] | o[1] & camOut[1] | o[2] & camOut[2] | o[3] & camOut[3];
        for (let q = 0; q < 4; q++) side[q] = side[q] || (both ? o[q] & camOut[q] : o[q]);
      } else bubble = true;
    }
  }
  return { side, bubble, occluded };
}

/** Blok merkezi kabuk teriminde atılıyor mu (gölgelendiricinin köşe testinin CPU ikizi). */
export function shellCuts(shape: RoomShape, plan: Pick<InteriorCutPlan, "side">, c: readonly [number, number, number], minY: number): boolean {
  const [s0, s1, s2, s3] = plan.side;
  if (!(s0 || s1 || s2 || s3) || c[1] <= minY) return false;
  const o = outsideSides(shape, c[0], c[2], SHELL_PAD);
  return !!((s0 && o[0]) || (s1 && o[1]) || (s2 && o[2]) || (s3 && o[3]));
}

/** Kabuk birimleri: `plan` null → kapalı. Satır/sütun aralıkları `SHAPE_MAX`'a kadar; fazlası sınır kutusuyla (−1 = boş). */
export function writeShellUniforms(u: CutawayUniforms, shape: RoomShape | null, plan: Pick<InteriorCutPlan, "side"> | null, minY = NO_MIN_Y): void {
  const on = u.uCutShellOn.value;
  if (!shape || !plan) { on[0] = on[1] = on[2] = on[3] = 0; u.uCutShellY.value = NO_MIN_Y; return; }
  for (let k = 0; k < 4; k++) on[k] = plan.side[k];
  u.uCutShellY.value = minY;
  if (u.uCutShellGrid.shape === shape) return;
  u.uCutShellGrid.shape = shape;
  const g = u.uCutShellGrid.value;
  g[0] = Math.min(shape.w, SHAPE_MAX); g[1] = Math.min(shape.d, SHAPE_MAX); g[2] = 0; g[3] = 0;
  u.uCutShellBB.value.splice(0, 4, ...shape.bb);
  const fill = (dst: Float32Array, src: Int16Array) => { dst.fill(-1); for (let k = 0; k < Math.min(src.length, SHAPE_MAX); k++) dst[k] = src[k]; };
  fill(u.uCutRowMin.value, shape.rowMin); fill(u.uCutRowMax.value, shape.rowMax);
  fill(u.uCutColMin.value, shape.colMin); fill(u.uCutColMax.value, shape.colMax);
}

/**
 * Saf kapsama denetimi (walk_check WALK-INTERIOR "kesit kapsamı"): göğüsten kameraya giden doğru üzerinde engel karolarına
 * düşen her örnek nokta açılıyor mu? Kabuktaki örnek: o karonun bloğu (merkezi karo merkezinde) kabukta atılıyor. Odadaki örnek:
 * kabarcık açık, görüş derinliği < avatar derinliği − pay ve y > `minY` (doğru avatarın ekran konumuna izdüşer → kabarcığın
 * merkezi). `occluded`: doğru bir engeli kesiyor.
 */
export function interiorCutCovers(cover: CoverGrid, shape: RoomShape, chest: [number, number, number], cam: [number, number, number],
  look: [number, number, number], minY: number, margin = INTERIOR_CUT_MARGIN): { occluded: boolean; covered: boolean; plan: InteriorCutPlan } {
  const plan = interiorCutPlan(cover, shape, chest, cam);
  let fx = look[0] - cam[0], fy = look[1] - cam[1], fz = look[2] - cam[2];
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  const vz = (x: number, y: number, z: number) => (x - cam[0]) * fx + (y - cam[1]) * fy + (z - cam[2]) * fz;
  const limit = vz(chest[0], chest[1], chest[2]) - margin;
  const len = Math.hypot(cam[0] - chest[0], cam[1] - chest[1], cam[2] - chest[2]);
  const n = Math.max(8, Math.ceil(len / 0.05));
  let occluded = false, covered = true;
  const [ai, aj] = tileAt(chest[0], chest[2]);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const x = chest[0] + (cam[0] - chest[0]) * t, y = chest[1] + (cam[1] - chest[1]) * t, z = chest[2] + (cam[2] - chest[2]) * t;
    const [i, j] = tileAt(x, z);
    const door = y < DOOR_H && !!shape.doors?.has(j * shape.w + i);
    if ((i === ai && j === aj) || (heightAt(cover, i, j) <= y && !door)) continue;
    occluded = true;
    const cx = i - W / 2 + 0.5, cz = j - D / 2 + 0.5;
    const o = outsideSides(shape, cx, cz);
    const ok = o[0] || o[1] || o[2] || o[3]
      ? shellCuts(shape, plan, [cx, door ? DOOR_H / 2 : Math.max(y, heightAt(cover, i, j) / 2, minY + 0.01), cz], minY)
      : plan.bubble && vz(x, y, z) < limit && y > minY;
    if (!ok) covered = false;
  }
  return { occluded, covered, plan };
}

// ------------------------------------------------------------------------------------------ UX-P2: şehir sokağı kesiti
/**
 * şehir sokağı (`space: "street"`) kesiti — UX-P2 düzeltmesi (2026-10-22). Önceki kural iç mekândaki eski hatanın aynısıydı:
 * duvar penceresi her karede açık ve yarıçapı ekranın köşegeniydi; avatar düzleminin önündeki **her** parça (yan binalar, ağaçlar,
 * direkler) atılıyor, düzlemi kesen kutular ön yüzsüz kalıp oyuk görünüyordu. Şehirde örtü ızgarası (`CoverGrid`) yalnız varış
 * meydanını tanır (semt blokları kuyruk yuvalarında), bu yüzden karar doğrudan bloğun kendisiyle verilir:
 * - **yalnız gerçek örtücü:** bloğun dünya kutusu (örnek matrisinden; döndürülmüş blokta eksen hizalı sarmalayan kutu) avatar
 * gövdesinden (göğüs, baş, iki omuz — iç mekânla aynı `BODY_PROBE`) kameraya giden 4 doğru parçasından birini kesiyorsa;
 * - **bütün blok, blok merkezine göre:** karar köşe gölgelendiricisinde örnek başına verilir (`vCutShell`); yarım kesilmiş oyuk
 * kutu yok; zemin (merkez y ≤ `minY`) hiç kesilmez; doğru açıksa hiçbir blok kesilmez.
 * Ek malzeme, mesh ya da çizim çağrısı yok (aynı birim seti; program anahtarı `walk-cut-1` — kaynak oturum içinde sabit). `streetCuts` gölgelendiricinin CPU
 * ikizidir; `scripts/city_check.mjs` CITY-MAP-OPAQUE-001 her şehirde sokak pozlarını bununla denetler.
*/
export const STREET_PROBES = 4;
type V3 = readonly [number, number, number];

/** Avatar gövde yoklama noktaları (iç mekân `interiorCutPlan` ile aynı: göğüs, baş, kameraya dik iki omuz). */
export function streetProbes(chest: V3, cam: V3, body = BODY_PROBE): [number, number, number][] {
  let lx = -(cam[2] - chest[2]), lz = cam[0] - chest[0];
  const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
  return [[chest[0], chest[1], chest[2]], [chest[0], chest[1] + body.head, chest[2]],
    [chest[0] + lx * body.side, chest[1], chest[2] + lz * body.side], [chest[0] - lx * body.side, chest[1], chest[2] - lz * body.side]];
}

/** Doğru parçası a → b eksen hizalı kutuyu (merkez c, yarı boy h) kesiyor mu (dilim testi; gölgelendiricideki `cutSeg` ikizi). */
export function segmentHitsBox(a: V3, b: V3, c: V3, h: V3): boolean {
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const d = b[k] - a[k], lo = c[k] - h[k], hi = c[k] + h[k];
    if (Math.abs(d) < 1e-6) { if (a[k] < lo || a[k] > hi) return false; continue; }
    const ta = (lo - a[k]) / d, tb = (hi - a[k]) / d;
    t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
  }
  return t0 <= t1;
}

/** Blok sokak kesitinde atılıyor mu (bütün blok): merkez `minY` üstünde ve kutu gövde → kamera doğrularından birini kesiyor. */
export function streetCuts(b: { p: V3; s: V3 }, probes: readonly V3[], cam: V3, minY: number): boolean {
  if (b.p[1] <= minY) return false;
  const h: V3 = [b.s[0] / 2, b.s[1] / 2, b.s[2] / 2];
  return probes.some((a) => segmentHitsBox(a, cam, b.p, h));
}

/** Sokak kesiti birimleri: `probes` null → kapalı. */
export function writeStreetUniforms(u: CutawayUniforms, probes: readonly V3[] | null, cam: V3 = [0, 0, 0], minY = NO_MIN_Y): void {
  const s = u.uCutStreet.value;
  if (!probes) { s[3] = 0; u.uCutStreetY.value = NO_MIN_Y; return; }
  s[0] = cam[0]; s[1] = cam[1]; s[2] = cam[2]; s[3] = 1;
  u.uCutStreetY.value = minY;
  const p = u.uCutProbe.value;
  for (let k = 0; k < STREET_PROBES; k++) for (let q = 0; q < 3; q++) p[k * 3 + q] = probes[Math.min(k, probes.length - 1)][q];
}

export function resetCutaway(u: CutawayUniforms = cutawayUniforms): void {
  writeRoofUniforms(u, CUT_OFF);
  writeWindowUniforms(u, false);
  writeShellUniforms(u, null, null);
  writeStreetUniforms(u, null);
  writeNearUniforms(u, null);
  writeLosUniforms(u, null);
  if (u.uCutFade) u.uCutFade.value = 1;
  if (u.uCutNearBig) u.uCutNearBig.value = 0;
  if (u.uCutSide) u.uCutSide.value = 0;
}

/** CAMERA: görüş konisi birimi (`los` null → gövde yoklaması bütün blok). Eski/kısmi birim setlerinde (testler) yok sayılır. */
export function writeLosUniforms(u: Partial<Pick<CutawayUniforms, "uCutLos">>, los: { at: V3; r: number } | null | undefined): void {
  const v = u.uCutLos?.value;
  if (!v) return;
  if (!los) { v[3] = 0; return; }
  v[0] = los.at[0]; v[1] = los.at[1]; v[2] = los.at[2]; v[3] = los.r;
}

// ------------------------------------------------------------------------------------------ WORLD-FIX: tek kesit planı
/** Açık dünyada zemin eşiği (merkezi bunun altındaki blok — zemin, yol, su yüzü — hiç kesilmez). */
export const OPEN_MIN_Y = 0.08;
/** Üçüncü şahıs (ve fotoğraf) yakın düzlemi: 0,5 iken kameranın 0,5 birim önündeki her model yakın düzlemde kesilip içi görünüyordu. */
export const WALK_NEAR = 0.15;
/** Yörünge kamerası: kameranın önünde bu kadar (birim) kalan bloklar "kameranın içinde" sayılır ve bütün olarak açılır. */
export const NEAR_ZONE = 0.8;

export interface CutPlanInput {
  cover: CoverGrid;
  /** avatar (x, z) ve ayak yüksekliği */
  avatar: { x: number; z: number; foot: number };
  /** göğüs (pivot) ve SON kamera konumu (çarpışma kısaltmasından sonra) */
  chest: V3;
  cam: V3;
  /** birinci şahıs: hiç kesit yok */
  first: boolean;
  /** iç mekân / sokak / güverte kuralı (yoksa açık dünya) */
  rule: { space: string; cutaway: boolean; minY: number } | null;
  /** iç mekân oda biçimi (avatar karosuyla) */
  shape?: RoomShape | null;
  /** kameranın baktığı nokta (yan kesitin bakış derinliği; gölgelendirici görünüm matrisini kullanır)*/
  look?: V3 | null;
}
export interface CutPlan {
  /** çatı: eşik, bileşen dikdörtgeni ve avatar (yarıçap merkezi) */
  roof: { cutY: number; rect: [number, number, number, number]; cx: number; cz: number } | null;
  /** kabuk (iç mekân oda/salon) */
  shell: InteriorCutPlan | null;
  /** gövde yoklama noktaları (göğüs, baş, iki omuz) → kamera; null: kapalı */
  probes: [number, number, number][] | null;
  cam: V3;
  minY: number;
  /** kamera kabarcığı: merkez (kameranın kendisi) ve yarıçap; null kapalı */
  near: { at: V3; r: number } | null;
  /** CAMERA: gövde yoklamasının görüş konisi (avatar göğsü + yarıçap); yoksa örtücü bütün blok açılır (yörünge, manzara) */
  los?: { at: V3; r: number } | null;
  /** yolculukta görüş konisi (titreşim) yazılmaz — yoklamanın örtücüsü bütün blok açılır; `los` yalnız kabarcık kuralı için kalır*/
  losOff?: boolean;
  /** yolculukta koni KESKİN kenarlı yazılır (`uCutLos.w` < 0): örtücü araç bloğunda yalnız görüş doğrusundaki pencere açılır, titreşim yok*/
  losHard?: boolean;
  /** yan kesit bandı (birim); null/yok → kapalı (iç mekân odası, birinci şahıs, yörünge)*/
  side?: number | null;
  /** kameranın ileri ekseni (birim; yan kesitin derinlik testi) — yoksa kamera → avatar*/
  fwd?: V3 | null;
}
/**
 * (lider kararı: dar yan kesit). Kamera kabarcığı yalnız kameraya DEĞEN, koni yalnız kamera–avatar doğrusundaki
 * örtücüyü açıyordu; <city> kule kapısında kameranın ~1 m yanındaki ağaç (gövde + taç) kadrajın üçte birini kaplıyordu. Yan kesit:
 * yalnız DONATI (`sideProp`) — direk (yatayda iki kenarı da ≤ `THIN`: ağaç gövdesi, lamba direği/başı) ya da taç (havada: tabanı eşiğin
 * `SIDE_LIFT` üstünde; kare taban 0,4–1,5, boy 0,3–1,5; birim duvar küpü 1 × n × 1 değil) — kamera–avatar doğru parçasının
 * `SIDE_BAND` yakınında VE bütünüyle avatarın önünde (bakış derinliğinde uzak yüzü < avatar derinliği × `SIDE_T_MAX`) ise bütün blok açılır. Duvar/cephe/döşeme hiçbir zaman.
*/
export const SIDE_BAND = 1.2, SIDE_T_MAX = 0.9, SIDE_LIFT = 1.0, SIDE_HALF = 0.75;
/** Yan kesite girebilen donatı (tam boy `s`, eşik `minY`): direk ya da taç. Gölgelendiricideki `cutProp` ikizi.
 * biçim tek başına yetmez (revak sütunu, tapınak ayağı, cephe kanadı da incedir) — kaynağı yapı olan blok (`fix`:
 * cephe, simge modeli, hi-res simge, hat) hiçbir zaman; gölgelendiricide örnek başına `cutFix` özniteliği (Blocks.tsx, expanse/tail.ts).*/
export function sideProp(b: { p: V3; s: V3; fix?: 1 }, minY: number): boolean {
  if (b.fix) return false;
  const [x, y, z] = b.s;
  if (Math.max(x, z) <= THIN) return true;
  return b.p[1] - y / 2 >= minY + SIDE_LIFT && Math.abs(x - z) <= 0.05 && x >= 0.4 && x <= 2 * SIDE_HALF && y >= 0.3 && y <= 2 * SIDE_HALF
    && !(Math.abs(x - 1) < 0.01 && Math.abs(y - Math.round(y)) < 0.01);
}
const unit = (v: number[]): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
/** Yan kesitin CPU ikizi (gölgelendiricideki `cutSide`). */
export function sideCuts(b: { p: V3; s: V3; fix?: 1 }, cam: V3, chest: V3, minY: number, band = SIDE_BAND, fwd?: V3 | null): boolean {
  if (b.p[1] <= minY) return false;
  if (!sideProp(b, minY)) return false;
  const ab = [chest[0] - cam[0], chest[1] - cam[1], chest[2] - cam[2]];
  const L2 = Math.max(ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2], 1e-4);
  // bütün kutu avatarın önünde: bakış derinliğinde (kameranın ileri ekseni; yoksa avatara doğru) uzak yüzü < avatar derinliği × SIDE_T_MAX
  const f = fwd ?? ab.map((v) => v / Math.sqrt(L2));
  const dep = (p: readonly number[]) => (p[0] - cam[0]) * f[0] + (p[1] - cam[1]) * f[1] + (p[2] - cam[2]) * f[2];
  if (dep(b.p) + (Math.abs(f[0]) * b.s[0] + Math.abs(f[1]) * b.s[1] + Math.abs(f[2]) * b.s[2]) / 2 >= dep(chest) * SIDE_T_MAX) return false;
  const t = Math.max(0, ((b.p[0] - cam[0]) * ab[0] + (b.p[1] - cam[1]) * ab[1] + (b.p[2] - cam[2]) * ab[2]) / L2);
  let d2 = 0;
  for (let k = 0; k < 3; k++) { const e = Math.max(0, Math.abs(cam[k] + ab[k] * t - b.p[k]) - b.s[k] / 2); d2 += e * e; }
  return d2 <= band * band;
}

/** Üçüncü şahıs kamera kabarcığı yarıçapı (yakın düzlem `WALK_NEAR`'ın iki katı): kameraya değen yaprak, lamba başı, tabela. */
export const CAM_BUBBLE = 0.3;

/** Kamera kabarcığı CPU ikizi: kutu ile kürenin değmesi, merkez `minY` üstünde. */
export function nearCuts(b: { p: V3; s: V3 }, at: V3, r: number, minY: number): boolean {
  if (b.p[1] <= minY) return false;
  let d2 = 0;
  for (let q = 0; q < 3; q++) { const e = Math.max(0, Math.abs(at[q] - b.p[q]) - b.s[q] / 2); d2 += e * e; }
  return d2 <= r * r;
}

/**
 * Saf: bir yürüme pozunun kesit planı (WalkRig her kare uygular; walk_check OUTDOOR-OPAQUE-001 ve scripts/camera_opaque.test.mjs
 * aynı fonksiyonla denetler). Gövde yoklaması her üçüncü şahıs alanında açık; çatı yalnız avatar örtülü karodayken; kabuk yalnız
 * iç mekân oda/salon kuralında; birinci şahısta hiçbir şey.
 */
export function walkCutPlan(o: CutPlanInput): CutPlan {
  const minY = (o.rule ? o.rule.minY : OPEN_MIN_Y) + Math.max(0, o.avatar.foot);
  if (o.first) return { roof: null, shell: null, probes: null, cam: o.cam, minY, near: null };
  // INTERIOR-CAM (ürün sahibi 2026-10-29): çatı/üst kat kesiti emekli — çatı ve tavan hiçbir pozda kaldırılmaz; avatar örtülüyken kamera
  // tavanın altında çeker (camera/ceiling.ts `fitUnderCeiling`). `roof` alanı uyumluluk için kalır, her zaman null.
  const roof = null;
  const room = !!o.rule?.cutaway && o.rule.space !== "street" && !!o.shape;
  const shell = room ? interiorCutPlan(o.cover, o.shape!, o.chest, o.cam) : null;
  return { roof, shell, probes: streetProbes(o.chest, o.cam), cam: o.cam, minY, near: { at: o.cam, r: CAM_BUBBLE }, los: { at: o.chest, r: LOS_R }, side: room ? null : SIDE_BAND,
    fwd: o.look ? unit([o.look[0] - o.cam[0], o.look[1] - o.cam[1], o.look[2] - o.cam[2]]) : null };
}

/** Planın CPU ikizi: blok atılıyor mu (bütün blok; gölgelendiricideki `vCutShell` kararı). */
export function planCuts(plan: CutPlan, b: { p: V3; s: V3; fix?: 1 }, shape: RoomShape | null = null): boolean {
  if (plan.roof && roofCuts(plan.roof.rect, plan.roof.cutY, b, { x: plan.roof.cx, z: plan.roof.cz })) return true;
  if (plan.shell && shape && shellCuts(shape, plan.shell, b.p, plan.minY)) return true;
  if (plan.near && nearCuts(b, plan.near.at, plan.near.r, plan.minY)) return true;
  if (plan.side && plan.probes && plan.los && sideCuts(b, plan.cam, plan.los.at, plan.minY, plan.side, plan.fwd)) return true;
  return !!plan.probes && streetCuts(b, plan.probes, plan.cam, plan.minY);
}

/** Planı birimlere yazar (kapalı terimler sıfırlanır). Pencere/kabarcık ekran dairesi her zaman kapalı. */
export function writeCutPlan(u: CutawayUniforms, plan: CutPlan, shape: RoomShape | null = null, center: { x: number; z: number } = { x: 0, z: 0 }): void {
  void center;
  writeRoofUniforms(u, plan.roof ? { roof: true, cx: plan.roof.cx, cz: plan.roof.cz, cutY: plan.roof.cutY, radius: CUT_RADIUS, window: false, camScale: 1, tileKey: "", rect: plan.roof.rect } : CUT_OFF);
  writeShellUniforms(u, plan.shell ? shape : null, plan.shell, plan.minY);
  writeStreetUniforms(u, plan.probes, plan.cam, plan.minY);
  writeNearUniforms(u, plan.near, plan.minY);
  writeLosUniforms(u, plan.probes && !plan.losOff ? (plan.losHard && plan.los ? { at: plan.los.at, r: -plan.los.r } : plan.los) : null); // yolculukta keskin koni
  // CAMERA: yürüme planında (koni var) kabarcık büyük bloğu yalnız kamera çevresinde açar; yörüngede bütün blok (kamera modelin içinde)
  if (u.uCutNearBig) u.uCutNearBig.value = plan.los ? 1 : 0;
  if (u.uCutSide) u.uCutSide.value = plan.side && plan.probes && plan.los ? plan.side : 0;
  if (u.uCutWin.value[3]) writeWindowUniforms(u, false);
}

/** Kamera kabarcığı birimi (`near` null → kapalı). */
export function writeNearUniforms(u: CutawayUniforms, near: { at: V3; r: number } | null, minY = NO_MIN_Y, grp: OrbitGroup | null = null): void {
  const v = u.uCutNear.value;
  const g = u.uCutGrp?.value;
  if (g) { if (grp) { g[0] = grp.rect[0]; g[1] = grp.rect[1]; g[2] = grp.rect[2]; g[3] = grp.rect[3]; u.uCutGrpY.value = grp.y0; } else { g[0] = 1; g[1] = 1; g[2] = -1; g[3] = -1; u.uCutGrpY.value = 1e6; } }
  if (!near) { v[3] = 0; u.uCutNearY.value = NO_MIN_Y; return; }
  v[0] = near.at[0]; v[1] = near.at[1]; v[2] = near.at[2]; v[3] = near.r;
  u.uCutNearY.value = minY;
}

/** PANO-SKELETON-001: yörünge kamerasının İÇİNDE kaldığı büyük blok (gövde) ve bütün binayı atan ayak izi dikdörtgeni. */
export interface OrbitGroup { rect: [number, number, number, number]; y0: number }
const GRP_PAD = 0.15, GRP_ABOVE = 0.3;
const inBox = (b: { p: V3; s: V3 }, c: V3) => Math.abs(c[0] - b.p[0]) <= b.s[0] / 2 && Math.abs(c[1] - b.p[1]) <= b.s[1] / 2 && Math.abs(c[2] - b.p[2]) <= b.s[2] / 2;
/** Yörünge kamerası büyük bir bloğun içindeyse (en büyük hacim) o gövdenin bina grubu; değilse null. */
export function orbitGroup(blocks: readonly { p: V3; s: V3; g?: string }[], cam: V3, minY = OPEN_MIN_Y): OrbitGroup | null {
  // kamera ~5 cm kımıldamadıkça aynı sonuç (kare başına bütün blokları gezme)
  const key = `${Math.round(cam[0] * 20)},${Math.round(cam[1] * 20)},${Math.round(cam[2] * 20)},${minY}`;
  if (grpMemo.blocks === blocks && grpMemo.key === key) return grpMemo.val;
  const val = orbitGroupOf(blocks, cam, minY);
  grpMemo = { blocks, key, val };
  return val;
}
let grpMemo: { blocks: unknown; key: string; val: OrbitGroup | null } = { blocks: null, key: "", val: null };
function orbitGroupOf(blocks: readonly { p: V3; s: V3; g?: string }[], cam: V3, minY: number): OrbitGroup | null {
  let best: { p: V3; s: V3 } | null = null, bv = 0;
  for (const b of blocks) {
    if (b.p[1] <= minY || b.g === "cloud" || b.g === "snow" || b.g === "water" || !bigBlock(b.s) || !inBox(b, cam)) continue;
    const v = b.s[0] * b.s[1] * b.s[2];
    if (v > bv) { bv = v; best = b; }
  }
  if (!best) return null;
  const g: OrbitGroup = { rect: [best.p[0] - best.s[0] / 2 - GRP_PAD, best.p[2] - best.s[2] / 2 - GRP_PAD, best.p[0] + best.s[0] / 2 + GRP_PAD, best.p[2] + best.s[2] / 2 + GRP_PAD], y0: best.p[1] - best.s[1] / 2 + GRP_ABOVE };
  // kademeli bina: atılan büyük blok (merkezi dikdörtgende) dikdörtgeni kendi ayak iziyle genişletir (bütün kademeler, en çok 3 tur)
  for (let it = 0; it < 3; it++) {
    let grew = false;
    for (const b of blocks) {
      if (b.p[1] <= minY || !bigBlock(b.s) || !inGrp(g, b)) continue;
      const r = g.rect, x0 = b.p[0] - b.s[0] / 2 - GRP_PAD, z0 = b.p[2] - b.s[2] / 2 - GRP_PAD, x1 = b.p[0] + b.s[0] / 2 + GRP_PAD, z1 = b.p[2] + b.s[2] / 2 + GRP_PAD;
      const y0 = b.p[1] - b.s[1] / 2 + GRP_ABOVE;
      if (x0 < r[0] || z0 < r[1] || x1 > r[2] || z1 > r[3] || y0 < g.y0) {
        r[0] = Math.min(r[0], x0); r[1] = Math.min(r[1], z0); r[2] = Math.max(r[2], x1); r[3] = Math.max(r[3], z1); g.y0 = Math.min(g.y0, y0); grew = true;
      }
    }
    if (!grew) break;
  }
  return g;
}
const inGrp = (g: OrbitGroup, b: { p: V3; s: V3 }) => b.p[0] >= g.rect[0] && b.p[0] <= g.rect[2] && b.p[2] >= g.rect[1] && b.p[2] <= g.rect[3] && b.p[1] + b.s[1] / 2 > g.y0;

/**
 * Yörünge planının bütün-blok kararı (gölgelendirici ikizi): büyük blok (gövde) yalnız kamera İÇİNDEYKEN bütün atılır; dışında ve
 * yakınında yalnız kamera çevresi açılır (yoksa gövde gider, ayak levhası/çatı kalırdı: duvarsız iskelet). İçindeyken bina grubu
 * (`grp`) da atılır. Küçük/ince blok önceki gibi (kabarcık ya da gövde yoklaması).
 */
export function orbitWholeCut(plan: CutPlan, b: { p: V3; s: V3 }, cam: V3, grp: OrbitGroup | null = null): boolean {
  if (grp && inGrp(grp, b)) return true;
  const hit = (plan.probes ? streetCuts(b, plan.probes, plan.cam, plan.minY) : false) || (plan.near ? nearCuts(b, plan.near.at, plan.near.r, plan.minY) : false);
  return hit && (!bigBlock(b.s) || inBox(b, cam));
}

/**
 * Yörünge (yürüme dışı) yakın bölgesi: kamera ve yakın düzlem köşelerine yakın dört nokta → kameranın `NEAR_ZONE` önü. Bu
 * doğruları kesen (kamerayı içine alan ya da yakın düzlemde kesilecek) bloklar bütün olarak açılır; uzaktaki hiçbir şey değil.
 * `fwd`, `right`, `up` kameranın birim eksenleri.
 */
export function orbitCutPlan(cam: V3, fwd: V3, right: V3, up: V3): CutPlan {
  const at = (k: V3, s: number): [number, number, number] => [cam[0] + k[0] * s, cam[1] + k[1] * s, cam[2] + k[2] * s];
  const end = at(fwd, NEAR_ZONE);
  return { roof: null, shell: null, probes: [[cam[0], cam[1], cam[2]], at(right, 0.3), at(right, -0.3), at(up, 0.2)], cam: end, minY: OPEN_MIN_Y,
    near: { at: [cam[0], cam[1], cam[2]], r: NEAR_ZONE * 0.6 } };
}

/** Kamera yakın bölgesinde blok var mı (yörüngede kesit birimlerini yalnız gerektiğinde açmak için; ızgara kovaları). */
const blockBuckets = new WeakMap<readonly { p: V3; s: V3; g?: string }[], Map<number, number[]>>();
export function nearBlocks(blocks: readonly { p: V3; s: V3; g?: string }[], cam: V3, reach = NEAR_ZONE + 0.4): number[] {
  let m = blockBuckets.get(blocks);
  if (!m) {
    m = new Map();
    blocks.forEach((b, k) => {
      if (b.g === "cloud" || b.g === "snow") return;
      const x0 = Math.floor(b.p[0] - b.s[0] / 2), x1 = Math.floor(b.p[0] + b.s[0] / 2), z0 = Math.floor(b.p[2] - b.s[2] / 2), z1 = Math.floor(b.p[2] + b.s[2] / 2);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) > 400) return; // dev zemin/su plakaları (merkezi zeminde; kesilmez)
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const key = (x + 4096) * 8192 + (z + 4096); const l = m!.get(key); if (l) l.push(k); else m!.set(key, [k]); }
    });
    blockBuckets.set(blocks, m);
  }
  const out: number[] = [];
  const seen = new Set<number>();
  const r = Math.ceil(reach);
  for (let x = Math.floor(cam[0]) - r; x <= Math.floor(cam[0]) + r; x++) for (let z = Math.floor(cam[2]) - r; z <= Math.floor(cam[2]) + r; z++) {
    for (const k of m.get((x + 4096) * 8192 + (z + 4096)) ?? []) {
      if (seen.has(k)) continue;
      seen.add(k);
      const b = blocks[k];
      let d2 = 0;
      for (let q = 0; q < 3; q++) { const e = Math.max(0, Math.abs(cam[q] - b.p[q]) - b.s[q] / 2); d2 += e * e; }
      if (d2 <= reach * reach && b.p[1] > OPEN_MIN_Y) out.push(k);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------ gölgelendirici yaması
/** Köşe gölgelendiricisine eklenen bildirim ve dünya/görüş konumu (InstancedMesh: instanceMatrix dahil). */
export const CUT_VERTEX_DECL = /* glsl */ `
uniform vec4 uCutRoof;
uniform vec4 uCutParams;
uniform vec4 uCutRoofRect;
uniform vec4 uCutShellOn;
uniform float uCutShellY;
uniform vec4 uCutShellGrid;
uniform vec4 uCutShellBB;
uniform float uCutRowMin[${SHAPE_MAX}];
uniform float uCutRowMax[${SHAPE_MAX}];
uniform float uCutColMin[${SHAPE_MAX}];
uniform float uCutColMax[${SHAPE_MAX}];
uniform vec4 uCutStreet;
uniform float uCutStreetY;
uniform vec3 uCutProbe[4];
uniform vec4 uCutNear;
uniform float uCutNearY;
uniform float uCutNearBig;
uniform vec4 uCutLos;
uniform float uCutSide;
uniform vec4 uCutGrp;
uniform float uCutGrpY;
attribute float cutFix;
varying vec3 vCutWorld;
varying float vCutShell;
varying float vCutRoof;
varying float vCutLocal;
varying float vCutNear;
varying float vCutViewZ;${BIG_GLSL}
// INTERIOR-VIEW kabuk (walk/cover.ts outsideSides + shellCuts ikizi): blok merkezinin odanın hangi yanının dışında kaldığı
float cutShellSide(vec3 c) {
  if (dot(uCutShellOn, vec4(1.0)) < 0.5 || c.y <= uCutShellY) return 0.0;
  int i = int(floor(c.x + ${(W / 2).toFixed(1)})), j = int(floor(c.z + ${(D / 2).toFixed(1)}));
  int w = int(uCutShellGrid.x), d = int(uCutShellGrid.y);
  if (i < 0 || j < 0 || i >= w || j >= d) return 0.0;
  float iN = floor(c.x - ${SHELL_PAD} + ${(W / 2).toFixed(1)}), iP = floor(c.x + ${SHELL_PAD} + ${(W / 2).toFixed(1)});
  float jN = floor(c.z - ${SHELL_PAD} + ${(D / 2).toFixed(1)}), jP = floor(c.z + ${SHELL_PAD} + ${(D / 2).toFixed(1)});
  bool rowHas = uCutRowMax[j] >= 0.0, colHas = uCutColMax[i] >= 0.0;
  bool nx = rowHas ? iN < uCutRowMin[j] : (!colHas && iN < uCutShellBB.x);
  bool px = rowHas ? iP > uCutRowMax[j] : (!colHas && iP > uCutShellBB.z);
  bool nz = colHas ? jN < uCutColMin[i] : (!rowHas && jN < uCutShellBB.y);
  bool pz = colHas ? jP > uCutColMax[i] : (!rowHas && jP > uCutShellBB.w);
  return ((uCutShellOn.x > 0.5 && nx) || (uCutShellOn.y > 0.5 && px) || (uCutShellOn.z > 0.5 && nz) || (uCutShellOn.w > 0.5 && pz)) ? 1.0 : 0.0;
}
// UX-P2 sokak kesiti (walk/cover.ts segmentHitsBox + streetCuts ikizi): dilim testi, bütün blok
bool cutSeg(vec3 a, vec3 b, vec3 lo, vec3 hi) {
  vec3 d = b - a;
  float t0 = 0.0, t1 = 1.0;
  if (abs(d.x) < 1e-6) { if (a.x < lo.x || a.x > hi.x) return false; }
  else { float ta = (lo.x - a.x) / d.x, tb = (hi.x - a.x) / d.x; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
  if (abs(d.y) < 1e-6) { if (a.y < lo.y || a.y > hi.y) return false; }
  else { float ta = (lo.y - a.y) / d.y, tb = (hi.y - a.y) / d.y; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
  if (abs(d.z) < 1e-6) { if (a.z < lo.z || a.z > hi.z) return false; }
  else { float ta = (lo.z - a.z) / d.z, tb = (hi.z - a.z) / d.z; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
  return t0 <= t1;
}
float cutStreetBox(vec3 c, vec3 h) {
  if (uCutStreet.w < 0.5 || c.y <= uCutStreetY) return 0.0;
  for (int k = 0; k < 4; k++) if (cutSeg(uCutProbe[k], uCutStreet.xyz, c - h, c + h)) return 1.0;
  return 0.0;
}
// WORLD-FIX kamera kabarcığı (walk/cover.ts nearCuts ikizi): kameraya değen blok bütün olarak (yakın düzlemde kesik model yok)
float cutNearBox(vec3 c, vec3 h) {
  if (uCutNear.w <= 0.0 || c.y <= uCutNearY) return 0.0;
  vec3 d = max(abs(uCutNear.xyz - c) - h, vec3(0.0));
  return dot(d, d) <= uCutNear.w * uCutNear.w ? 1.0 : 0.0;
}
// yan kesit (walk/cover.ts sideCuts ikizi): kamera–avatar doğrusunun yanındaki donatı (ince ya da havada küçük), bütün blok
bool cutProp(vec3 c, vec3 h) {
  vec3 s = 2.0 * h;
  if (max(s.x, s.z) <= ${THIN.toFixed(3)}) return true;
  return c.y - h.y >= uCutStreetY + ${SIDE_LIFT.toFixed(2)} && abs(s.x - s.z) <= 0.05 && s.x >= 0.4 && s.x <= ${(2 * SIDE_HALF).toFixed(2)}
    && s.y >= 0.3 && s.y <= ${(2 * SIDE_HALF).toFixed(2)} && !(abs(s.x - 1.0) < 0.01 && abs(s.y - floor(s.y + 0.5)) < 0.01);
}
float cutSide(vec3 c, vec3 h) {
  if (uCutSide <= 0.0 || uCutLos.w <= 0.0 || uCutStreet.w < 0.5 || c.y <= uCutStreetY || cutFix > 0.5 || !cutProp(c, h)) return 0.0;
  vec3 a = uCutStreet.xyz, ab = uCutLos.xyz - a;
  // bakış derinliği (görünüm matrisi): kutunun uzak yüzü avatar derinliğinin SIDE_T_MAX katından yakın
  vec3 vz = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  if (-(viewMatrix * vec4(c, 1.0)).z + dot(abs(vz), h) >= -(viewMatrix * vec4(uCutLos.xyz, 1.0)).z * ${SIDE_T_MAX.toFixed(2)}) return 0.0;
  float t = max(dot(c - a, ab) / max(dot(ab, ab), 1e-4), 0.0);
  vec3 d = max(abs(a + ab * t - c) - h, vec3(0.0));
  return dot(d, d) <= uCutSide * uCutSide ? 1.0 : 0.0;
}
// WORLD-FIX çatı (walk/cover.ts roofCuts ikizi): avatarın çatı bileşeninde, tamamı çatı eşiğinin üstündeki blok — bütün blok
float cutRoofBox(vec3 c, vec3 h) {
  if (uCutRoof.w < 0.5) return 0.0;
  if (c.x < uCutRoofRect.x || c.x > uCutRoofRect.z || c.z < uCutRoofRect.y || c.z > uCutRoofRect.w) return 0.0;
  if (distance(c.xz, uCutRoof.xz) > uCutParams.x) return 0.0;
  return (c.y - h.y >= uCutParams.y - ${ROOF_SLACK}) ? 1.0 : 0.0;
}`;
export const CUT_VERTEX_BODY = /* glsl */ `
{
  vec4 cutP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  cutP = instanceMatrix * cutP;
  #endif
  vCutWorld = (modelMatrix * cutP).xyz;
  // blok (örnek) dünya matrisi: merkez ve eksen hizalı sarmalayan kutunun yarı boyu (birim kutu geometrisi, Blocks.tsx)
  mat4 cutM = modelMatrix;
  #ifdef USE_INSTANCING
  cutM = modelMatrix * instanceMatrix;
  #endif
  vec3 cutCtr = (cutM * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 cutHalf = 0.5 * (abs(cutM[0].xyz) + abs(cutM[1].xyz) + abs(cutM[2].xyz));
  // CAMERA: kabuk + kabarcık bütün blok; çatı bütün blok ama yoğunlukla (uCutFade); gövde yoklaması görüş konisinde (parça başı)
  // PANO-SKELETON-001: yörüngede büyük blok (gövde) yalnız kamera İÇİNDEYKEN bütün atılır (+ binanın ayak izindeki parçalar, uCutGrp);
  // dışında yalnız kamera çevresi açılır (gövde gidip ayak levhası/çatı kalmaz). Yürümede (uCutNearBig = 1) kural aynı kaldı.
  bool cutIn = all(lessThanEqual(abs(uCutNear.xyz - cutCtr), cutHalf));
  float cutOrbBig = (uCutNearBig < 0.5 && !cutIn) ? cutBig(cutHalf) : 0.0;
  float cutNb = cutNearBox(cutCtr, cutHalf), cutBg = max(uCutNearBig * cutBig(cutHalf), cutOrbBig);
  float cutGp = (uCutGrp.x <= uCutGrp.z && cutCtr.x >= uCutGrp.x && cutCtr.x <= uCutGrp.z && cutCtr.z >= uCutGrp.y && cutCtr.z <= uCutGrp.w && cutCtr.y + cutHalf.y > uCutGrpY) ? 1.0 : 0.0;
  vCutShell = max(max(max(cutShellSide(cutCtr), cutNb * (1.0 - cutBg)), cutSide(cutCtr, cutHalf)), cutGp);
  vCutNear = cutNb * cutBg;
  vCutRoof = cutRoofBox(cutCtr, cutHalf);
  vCutLocal = cutStreetBox(cutCtr, cutHalf) * (1.0 - cutOrbBig);
  vCutViewZ = -mvPosition.z;
}`;
export const CUT_FRAGMENT_DECL = /* glsl */ `
varying vec3 vCutWorld;
varying float vCutShell;
varying float vCutRoof;
varying float vCutLocal;
varying float vCutNear;
varying float vCutViewZ;${LOS_GLSL}`;
/** Parça başı: blok kararı köşede (örtücü mü). Kabuk/kabarcık bütün blok; çatı bütün blok, yoğunluk `uCutFade` (titreşimli geçiş);
 *  gövde yoklamasının örtücüsü yalnız görüş konisinde titreşimle açılır (CAMERA; `uCutLos.w` 0 → bütün blok). Örtücü olmayan
 *  blok hiçbir parçada açılmaz (WORLD-FIX kuralı korunur). */
export const CUT_FRAGMENT_BODY = /* glsl */ `
{
  if (vCutShell > 0.5) discard;
  if (vCutNear > 0.5 && distance(vCutWorld, uCutNear.xyz) < uCutNear.w + 0.05) discard;
  if (vCutRoof > 0.5 || vCutLocal > 0.5) {
    float cutT = cutBayer(gl_FragCoord.xy);
    if (vCutRoof > 0.5 && uCutFade >= cutT) discard;
    if (vCutLocal > 0.5 && cutLos(vCutWorld) >= cutT) discard;
  }
}`;

/** three.js malzemesinin bu yamanın kullandığı en küçük yüzeyi (çalışma zamanı içe aktarması olmadan). */
export interface PatchableMaterial {
  // yöntem sözdizimi: parametreler iki yönlü uyumlu (three'ün WebGLProgramParametersWithUniforms türü bu yüzeyi kapsar)
  onBeforeCompile(shader: { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string }, renderer: unknown): void;
  customProgramCacheKey(): string;
  userData: Record<string, unknown>;
  needsUpdate: boolean;
}

/**
 * W2 için: malzemeye kesit bloğunu bir kez ekler (idempotent). MeshLambertMaterial ve MeshBasicMaterial gölgelendiricilerinde
 * `#include <project_vertex>` ve `#include <clipping_planes_fragment>` bulunur. Var olan `onBeforeCompile` korunur (zincir).
 * Gölge derinlik malzemesine eklenmez: çatı kesilse de gölgesi kalır (bilinçli; iç mekân karanlığı korunur).
 */
export function installCutaway(material: PatchableMaterial, uniforms: CutawayUniforms = cutawayUniforms): void {
  if (material.userData.walkCut) return;
  material.userData.walkCut = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = patchVertex(shader.vertexShader);
    shader.fragmentShader = patchFragment(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}|walk-cut-1`;
  material.needsUpdate = true;
}

export function patchVertex(src: string): string {
  if (src.includes("vCutWorld")) return src;
  return src.replace("#include <common>", `#include <common>\n${CUT_VERTEX_DECL}`)
    .replace("#include <project_vertex>", `#include <project_vertex>\n${CUT_VERTEX_BODY}`);
}

export function patchFragment(src: string): string {
  if (src.includes("vCutShell")) return src;
  return src.replace("#include <common>", `#include <common>\n${CUT_FRAGMENT_DECL}`)
    .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${CUT_FRAGMENT_BODY}`);
}
