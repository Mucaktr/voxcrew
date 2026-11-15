/**
 * INTERIOR-CAM (ürün sahibi 2026-10-29, plan §7 E2) — ortam başına kamera profili: veri + seçim + yumuşak geçiş. Saf modül (three/React
 * yok; Node testinde yüklenir). Tablo ve gerekçe:
 *
 * İlke: iç mekâna girmek o mekânın içinde, dış dünyadan bağımsız dolaşmaktır; çatı/tavan kaldırılmaz ("cutaway" yok). Kamera,
 * gerçek bir kameranın gerçek bir objektifle iç mekânda çekim yaptığı gibi davranır: geniş açı (≈ 18–24 mm tam kare eşdeğeri),
 * yakın takip, göz/omuz yüksekliği, tavanın altında kalır (camera/ceiling.ts), duvara çarpar (camera/collide.ts yaylı kol).
 *
 * Birimler: yürüme ölçeği (insan boyu 1,0 ≈ 1,75 m → 1 birim ≈ 1,75 m). Görüş açısı DİKEY derece, kullanıcı ayarının varsayılanında
 * (Görünüm → "Yürüme görüş açısı" 55°); ayar farkı korunur (`profileFovAdd`), Hor+ tabanı ve tavanı walk/scale.ts `walkFov`.
 * Objektif eşdeğeri: tam kare (36 × 24 mm) dikey kenar 24 mm → f = 12 / tan(vfov / 2) (`lensMm`).
*/

export type BuiltinSpace = "street" | "plaza" | "interior" | "hall" | "corridor" | "terrace" | "vehicle" | "activity" | "courtyard";
/** Yerleşik ortamlar + kayıtla eklenenler (ör. RIDE-UX taşıt profilleri "vehicle:tram"; `registerCameraProfile`). */
export type CamSpace = BuiltinSpace | (string & {});

export interface CamProfile {
  id: CamSpace;
  /** dikey görüş açısı (derece; ayar varsayılanında) */
  vfov: number;
  /** takip mesafesi (birim; göğüs pivotundan) ve kullanıcı yakınlaştırma sınırları */
  dist: number;
  distMin: number;
  distMax: number;
  /** girişte/oturtmada varsayılan bakış eğimi (rad; − aşağı) */
  pitch: number;
  /** tavan sıkıştırması: avatarın üstünde tavan varken kamera tavanın altında kalır (iç mekânda her zaman) */
  ceiling: boolean;
  /** kaldırma + omuz üstü yedeği (collide.ts `solveArm`): tavan altında dik yükseliş tavana çarpar, omuz üstü yaw kayması işe yarar */
  lift: boolean;
  /** kaldırma yedeğinin en dik yükselişi (rad): iç mekânda tepeden bakış yok, sıkışınca omuz üstü yandan çeker */
  elevMax: number;
  /** omuz üstü yanal kayma (birim, sağa): iç mekânda baş kadrajın ortasını kapatmasın (≈ 0,55 m; dış dünyada 0) */
  shoulder: number;
  /** geçiş zaman sabiti (sn): mesafe ve açı bu sürede ~%63 yaklaşır; hareket azaltmada anında */
  tau: number;
  /** çerçeveleme bu modülde değil (vehicle: transit/rideCam.ts, activity: walk/actionCam.ts — ACTIVITY-CAM ekibi) */
  delegated?: "rideCam" | "actionCam";
}

/** Ayar varsayılanı (walk/scale.ts WALK_FOV_DEFAULT ile aynı; döngüsel içe aktarma olmasın diye burada). */
export const FOV_SETTING_DEFAULT = 55;
/** Tam kare (36 × 24 mm) dikey kenarın yarısı (mm). */
const HALF_FRAME_V = 12;
const RAD = Math.PI / 180;
/** Dikey görüş açısının tam kare eşdeğer odak uzaklığı (mm). */
export const lensMm = (vfovDeg: number) => HALF_FRAME_V / Math.tan((vfovDeg * RAD) / 2);
/** Odak uzaklığından (mm, tam kare) dikey görüş açısı (derece). */
export const vfovOfMm = (mm: number) => (2 * Math.atan(HALF_FRAME_V / mm)) / RAD;

/**
 * Profil tablosu. Dış dünya değerleri bugünkü takip kamerasıdır (FOLLOW_DIST 4,6, LOOK_DEFAULT −0,3, ayar 55°) — davranış
 * değişmedi; meydan biraz daha geniş bağlam için uzak. İç oda 64° (≈ 19 mm), salon 68° (≈ 18 mm), dar koridor/merdiven 62°
 * (≈ 20 mm) — spesifikasyondaki 62–75° bandında; yakın takip 0,9–1,6 birim (≈ 1,6–2,8 m), göz/omuz yüksekliğinde.
 */
export const CAMERA_PROFILES: Readonly<Record<BuiltinSpace, Readonly<CamProfile>>> = Object.freeze({
  street: Object.freeze({ id: "street", vfov: 55, dist: 4.6, distMin: 2.2, distMax: 9, pitch: -0.3, ceiling: false, lift: true, elevMax: Infinity, shoulder: 0, tau: 0.6 }),
  plaza: Object.freeze({ id: "plaza", vfov: 55, dist: 5.4, distMin: 2.2, distMax: 9, pitch: -0.3, ceiling: false, lift: true, elevMax: Infinity, shoulder: 0, tau: 0.9 }),
  // tavanlar 2,4'e yükselince (INTERIOR-CEIL) 1,6 baş + gövdeyi ekranın dörtte birine sıkıştırıyordu; salon (2,3) ölçüsüne
  interior: Object.freeze({ id: "interior", vfov: 64, dist: 2.3, distMin: 1.2, distMax: 3.4, pitch: -0.22, ceiling: true, lift: true, elevMax: 0.55, shoulder: 0.32, tau: 0.45 }),
  hall: Object.freeze({ id: "hall", vfov: 68, dist: 2.3, distMin: 1.2, distMax: 4, pitch: -0.22, ceiling: true, lift: true, elevMax: 0.6, shoulder: 0.28, tau: 0.5 }),
  corridor: Object.freeze({ id: "corridor", vfov: 62, dist: 1.2, distMin: 0.9, distMax: 1.8, pitch: -0.38, ceiling: true, lift: true, elevMax: 0.6, shoulder: 0.26, tau: 0.35 }),
  terrace: Object.freeze({ id: "terrace", vfov: 50, dist: 4.2, distMin: 2.2, distMax: 9, pitch: -0.12, ceiling: false, lift: true, elevMax: Infinity, shoulder: 0, tau: 0.7 }),
  vehicle: Object.freeze({ id: "vehicle", vfov: 58, dist: 4.6, distMin: 2.2, distMax: 9, pitch: -0.3, ceiling: false, lift: false, elevMax: Infinity, shoulder: 0, tau: 0.6, delegated: "rideCam" }),
  // COURTYARD-PORTAL: duvarlı avlu (gerçek ölçek): geniş açı (≈ 20 mm) ve orta mesafe — avatar ile yüksek cephe (kubbe, kule) aynı
  // karede; hafif yukarı bakış (eğim +0,1: cephe ve kubbe kadraja girer), tavan yok (açık hava), sokak gibi omuz kayması yok
  courtyard: Object.freeze({ id: "courtyard", vfov: 62, dist: 3.4, distMin: 1.8, distMax: 7, pitch: 0.1, ceiling: false, lift: true, elevMax: Infinity, shoulder: 0, tau: 0.6 }),
  activity: Object.freeze({ id: "activity", vfov: 55, dist: 4.6, distMin: 2.2, distMax: 9, pitch: -0.3, ceiling: false, lift: true, elevMax: Infinity, shoulder: 0, tau: 0.6, delegated: "actionCam" }),
});

// ------------------------------------------------------------------------------------------ kayıt (genişletme noktası)
const extra = new Map<string, Readonly<CamProfile>>();
/**
 * Başka ekiplerin profil eklemesi (RIDE-UX: taşıt türü başına "vehicle:<tür>", vb.). Yerleşik kimlik ezilemez. Seçim:
 * `selectProfile({ ride: true, rideProfile: "vehicle:tram" })` kayıtlıysa onu, değilse "vehicle" döndürür. Dönüş: kaydı silen işlev.
 */
export function registerCameraProfile(p: CamProfile): () => void {
  if (p.id in CAMERA_PROFILES) throw new Error(`yerleşik kamera profili ezilemez: ${p.id}`);
  const frozen = Object.freeze({ ...p });
  extra.set(p.id, frozen);
  return () => { if (extra.get(p.id) === frozen) extra.delete(p.id); };
}
/** Kimliğin profili (kayıtlı değilse sokak). */
export const profileOf = (id: CamSpace): Readonly<CamProfile> => (CAMERA_PROFILES as Record<string, Readonly<CamProfile>>)[id] ?? extra.get(id) ?? CAMERA_PROFILES.street;

/** Omuz üstü kayma: kamera noktasını (yerinde) yaw'ın sağına `k` birim kaydırır (walk/scale.ts ekseni: sağ = (−cos, sin)). */
export function shoulderShift(pos: { x: number; z: number }, yaw: number, k: number): void {
  if (!k) return;
  pos.x -= Math.cos(yaw) * k; pos.z += Math.sin(yaw) * k;
}

/** Kullanıcı ayarına eklenen derece (walk/scale.ts `walkFov(ayar, en/boy, ek)`): profil açısı − ayar varsayılanı. */
export const profileFovAdd = (p: Pick<CamProfile, "vfov">) => p.vfov - FOV_SETTING_DEFAULT;

/** Seçim girdisi (WalkRig kare başı, karo değişince yeniden hesaplanan kısımlar önbellekli). */
export interface ProfileCtx {
  /** alan kuralı (walk/cameraRule.ts): iç mekân katı room/hall/deck, şehir sokağı/seyir; yoksa dış dünya */
  space?: "room" | "hall" | "deck" | "street" | "court" | null;
  /** yolculuk (şehir taşıtı ya da çark) sürüyor; `rideProfile`: kayıtlı taşıt profili (RIDE-UX) */
  ride?: boolean;
  rideProfile?: string | null;
  /** olta/ritüel eylemi sürüyor (çerçeve actionCam'de) */
  activity?: boolean;
  /** avatarın üstündeki tavan yüksekliği (ayaktan; yoksa Infinity) */
  ceiling?: number;
  /** avatarın karosundan geçen yürünebilir açıklık: x ve z boyunca kesintisiz karo sayısı (en çok 9) */
  runX?: number;
  runZ?: number;
  /** 9 × 9 pencerede yürünebilir karo oranı (0–1) */
  open?: number;
  /** merdiven basamağında ya da sahanlığında */
  stair?: boolean;
}

/** Bu tavan yüksekliği ve üstü salon sayılır (birim; 2,6 ≈ 4,5 m). */
export const HALL_CEIL = 2.6;
/**
 * (<city> hutong): açık havada dar sokakta (en dar açıklık ≤ `CORRIDOR_RUN` karo) takip kolu engelde DİK YÜKSELİŞLE çatının üstüne çıkmaz
 * (`solveArm` kaldırma yükselişleri 0,7 rad ve üstü; kamera ev çatılarının üstüne/içine çıkıp kadraj koyu çatı levhası oluyordu). Kaldırma bu
 * sınırla kısıtlanır: kol kısalır ya da omuz üstü yaw kayması sokağın açık yönünü bulur (kesit bütün bloğu açar). Üst sınır (rad).
*/
export const LANE_ELEV_MAX = 0.35;
/** Dar sokak mı (9 × 9 pencerede x ya da z yönünde en dar yürünebilir açıklık ≤ `CORRIDOR_RUN`). */
export const inNarrowLane = (runX?: number, runZ?: number): boolean => Math.min(runX ?? 9, runZ ?? 9) <= CORRIDOR_RUN;

/** Dış dünyada "kapalı mekân": 9 × 9 pencerenin yürünebilir oranı bunun altında (duvarlarla çevrili). */
export const ENCLOSED_OPEN = 0.55;
/** Dar geçit: en dar açıklık bu kadar karo ya da daha az. */
export const CORRIDOR_RUN = 2;
/** Meydan/park: 9 × 9 pencerenin bu oranı yürünebilir ve iki eksende de geniş. */
export const PLAZA_OPEN = 0.82;
export const PLAZA_RUN = 7;

/** Ortamın profili (saf, belirlenimci). Öncelik: taşıt → eylem → seyir terası → iç mekân (koridor/salon/oda) → meydan → sokak. */
export function selectProfile(c: ProfileCtx): CamSpace {
  if (c.ride) return c.rideProfile && extra.has(c.rideProfile) ? c.rideProfile : "vehicle";
  if (c.activity) return "activity";
  if (c.space === "deck") return "terrace";
  if (c.space === "court") return "courtyard"; // COURTYARD-PORTAL
  const ceil = c.ceiling ?? Infinity;
  // dış dünyada tavan altı ancak kapalı bir mekânsa iç mekân (otel odası, çalışma salonu); açık saçak/kemer altı ve ağaç tacı sokak
  // şehir sokağı (`street`) iç mekân sayılmaz. Şehir dünyasında `open`/`run` tabanın 24 × 16 gezinme ızgarasından ölçülür (şehir
  // koordinatları ızgara dışı → 0), bu yüzden durak saçağı, ağaç tacı, çardak altında `ceil < HALL_CEIL && open 0` "kapalı dar koridor" çıkıyor, kamera
  // 1,2 birime (koridor profili) iniyordu: turnikede/palmiye bahçesinde avatar ekranın %60'ı. Gerçek iç mekânlar `room`/`hall`/`court` kurallarıyla gelir.
  const indoor = c.space === "room" || c.space === "hall" || (c.space !== "street" && ceil < HALL_CEIL && (c.open ?? 1) < ENCLOSED_OPEN);
  const narrow = Math.min(c.runX ?? 9, c.runZ ?? 9) <= CORRIDOR_RUN;
  if (indoor) {
    if (c.stair || narrow) return "corridor";
    if (c.space === "hall" || (c.space !== "room" && ceil >= HALL_CEIL)) return "hall";
    return "interior";
  }
  if ((c.open ?? 0) >= PLAZA_OPEN && Math.min(c.runX ?? 0, c.runZ ?? 0) >= PLAZA_RUN) return "plaza";
  return "street";
}

/** Yumuşak geçiş durumu: şu anki (karışmış) değerler ve hedef profil. */
export interface ProfileBlend { id: CamSpace; dist: number; vfov: number; distMin: number; distMax: number; shoulder: number; ready: boolean }
export const createProfileBlend = (id: CamSpace = "street"): ProfileBlend => {
  const p = profileOf(id);
  return { id, dist: p.dist, vfov: p.vfov, distMin: p.distMin, distMax: p.distMax, shoulder: p.shoulder, ready: false };
};

/**
 * Bir kare ilerletir: mesafe, açı ve yakınlaştırma sınırları hedef profile `tau` zaman sabitiyle yaklaşır (ani sıçrama yok).
 * `snap` (kararma altındaki kapı geçişi, ilk kare) ya da `calm` (prefers-reduced-motion) → anında. Dönüş: aynı nesne.
 */
export function stepProfileBlend(b: ProfileBlend, id: CamSpace, dt: number, calm: boolean, snap = false): ProfileBlend {
  const p = profileOf(id);
  b.id = id;
  if (snap || calm || !b.ready) {
    b.dist = p.dist; b.vfov = p.vfov; b.distMin = p.distMin; b.distMax = p.distMax; b.shoulder = p.shoulder; b.ready = true;
    return b;
  }
  const k = 1 - Math.exp(-Math.max(0, dt) / Math.max(1e-3, p.tau));
  b.dist += (p.dist - b.dist) * k;
  b.vfov += (p.vfov - b.vfov) * k;
  b.distMin += (p.distMin - b.distMin) * k;
  b.distMax += (p.distMax - b.distMax) * k;
  b.shoulder += (p.shoulder - b.shoulder) * k;
  return b;
}

/** Kullanıcı yakınlaştırma çarpanının sınırları (profil mesafesine göre; dış dünyada 2,2–9 / 4,6 ile aynı aralık). */
export const ZOOM_MIN = 0.45;
export const ZOOM_MAX = 2;
/** Takip mesafesi: karışmış profil mesafesi × yakınlaştırma, karışmış sınırlar içinde. */
export const followDistance = (b: ProfileBlend, zoom: number) => Math.min(b.distMax, Math.max(b.distMin, b.dist * zoom));

// ------------------------------------------------------------------------------------------ ortam ölçümü (gezinme ızgarası)
/** Avatarın karosundan x ve z boyunca kesintisiz yürünebilir karo sayısı (kendisi dahil, en çok `cap`) ve 9 × 9 açıklık oranı. */
export function openness(walkable: (i: number, j: number) => boolean, i: number, j: number, cap = 9): { runX: number; runZ: number; open: number } {
  const run = (di: number, dj: number) => { let n = 0; for (let k = 1; k < cap && walkable(i + di * k, j + dj * k); k++) n++; return n; };
  const here = walkable(i, j) ? 1 : 0;
  const runX = Math.min(cap, here + run(1, 0) + run(-1, 0)), runZ = Math.min(cap, here + run(0, 1) + run(0, -1));
  let free = 0;
  for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) if (walkable(i + di, j + dj)) free++;
  return { runX, runZ, open: free / 81 };
}
