/**
 * INTERIOR-VIEW — iç mekân sahne modeli: her iç mekân katı kendi görüntüleme kuralları olan bir **sahne kaydıdır**.
 *
 * Kayıt (`InteriorSceneRecord`) dünya biçimiyle uyumlu bir şekildedir (`voxcrew-world` v1.x'in `grid`, `env`, `layers.lights`,
 * `zones` alanları aynı türlerle; bloklar `baked: null` gibi üreticiden pişer). İleride Dünya Yapıcı'da düzenlenebilsin diye
 * yalnız veri taşır; editör bu dalgada yok. Alanlar:
 *  - `space`: oda (`room`), büyük salon (`hall`: müze, stadyum tribün altı) ya da güverte/seyir/çatı (`deck`, açık hava)
 *  - `camera`: alan türünün kamera kuralı (`CAMERA_RULES`): oda → iç mekân profili (geniş açı, yakın takip, tavanın altında; kesit
 *    yok — INTERIOR-CAM), salon → salon profili (daha geniş, biraz uzak), güverte → birinci şahıs (V geçişi; üçüncü şahısta teras)
 *  - `light`: ışık ön ayarı — iç ışık (yarıküre) + pencere gün ışığı (dış dünyanın gün/gece saatine bağlı) + kat lambaları
 *  - `env`: gökyüzü, sis, ışık (dünya biçimi `WorldEnv`); `ambience`: ses yatağı ve sis aralığı
 *  - `minimap`: oda dikdörtgenleri; `exterior`: dış şehir çizilmez (`none`), açık hava katının pişmiş panoraması (`panorama`)
 *    ya da WORLD-PANO şehir landmarkı katının ucuz silüet halkası (`backdrop`; cityPano.ts — pencereden ve güverteden görünür,
 *    gök dış dünyanın saatinde, +0 çizim çağrısı)
 *  - `budget`: kat başına ≤ 22 çizim çağrısı (walk_check WALK-INTERIOR tahmini + walk_perf `--interior` canlı ölçüm)
 *
 * Saf modül: React/three yok (walk_check doğrudan yükler).
 */
import { DECK_FAR, towerDeckOf } from "./towerDeck";
import type { Light, SceneDef, SceneZone, Tile } from "../scenes";
import type { WorldEnv } from "../worldFormat";
import type { InteriorLevel, LevelRoom, LevelSpot, Portal, StairLink } from "./generate";
import type { CityPano } from "./cityPano";
import { CAMERA_PROFILES, profileFovAdd } from "../camera/profiles";

/** WORLD-PANO: iç mekândan görünen gece göğü (silüet halkalı katlar; World.tsx gece göğüyle uyumlu koyu lacivert). */
export const PANO_NIGHT_SKY = "#16203A";

export const INTERIOR_FORMAT = "voxcrew-interior";
export const INTERIOR_VERSION = 1;
/** Kat başına çizim çağrısı bütçesi ( "INTERIOR-VIEW").*/
export const INTERIOR_DRAW_BUDGET = 22;

export type SpaceType = "room" | "hall" | "deck" | "court"; // COURTYARD-PORTAL: court — duvarlı avlu (açık hava, üçüncü şahıs)
export type InteriorView = "first" | "third";

export interface CameraRule {
  space: SpaceType;
  /** varsayılan görünüm (V her zaman değiştirir) */
  view: InteriorView;
  /** üçüncü şahıs takip mesafesi (yürüme ölçeği birimi) */
  dist: number;
  /** üçüncü şahısta taban görüş açısına eklenen derece (geniş salon); hareket azaltmada da uygulanır (yalnız geçiş anlık) */
  fovAdd: number;
  /** kesit: kamerayla avatar arasındaki duvarlar (zeminin üstü) saydamlaşır */
  cutaway: boolean;
}

/** Alan türü → kamera kuralı. INTERIOR-CAM (ürün sahibi 2026-10-29): kesit (cutaway, "walls down") YOK — çatı/tavan ve duvarlar yerinde;
 * kamera iç mekân profiliyle (camera/profiles.ts: geniş açı, yakın takip, tavanın altında, duvara çarpar) odanın içinde çeker.
 * Mesafe ve açı eki profil tablosundan (tek kaynak); güverte (açık hava) üçüncü şahıs, seyir terası profili.*/
export const CAMERA_RULES: Readonly<Record<SpaceType, Readonly<CameraRule>>> = Object.freeze({
  room: Object.freeze({ space: "room", view: "third", dist: CAMERA_PROFILES.interior.dist, fovAdd: profileFovAdd(CAMERA_PROFILES.interior), cutaway: false }),
  hall: Object.freeze({ space: "hall", view: "third", dist: CAMERA_PROFILES.hall.dist, fovAdd: profileFovAdd(CAMERA_PROFILES.hall), cutaway: false }),
  // FIXPACK-A: güverte varışı üçüncü şahıs (seyir terası profili) — birinci şahısta avatar çizilmiyordu, kule üst katında kare
  // yalnız korkuluk + gökyüzüydü (scripts/interior_arrival.mjs INTERIOR-ARRIVAL-AVATAR-001); V ile birinci şahsa geçilir
  deck: Object.freeze({ space: "deck", view: "third", dist: CAMERA_PROFILES.terrace.dist, fovAdd: profileFovAdd(CAMERA_PROFILES.terrace), cutaway: false }),
  court: Object.freeze({ space: "court", view: "third", dist: CAMERA_PROFILES.courtyard.dist, fovAdd: profileFovAdd(CAMERA_PROFILES.courtyard), cutaway: false }),
});

/** Kesit penceresi: zeminin (y = 0) bu kadar üstündeki parçalar kesilir (zemin, halı, eşik ve keşif parıltısı kalır). */
export const CUT_FLOOR_Y = 0.08;

export type LightPresetId = "lamp_warm" | "gallery" | "quiet" | "open_air";
export interface LightPreset {
  id: LightPresetId;
  /** iç ışık (yarıküre: gök, yer, yoğunluk) gündüz ve gece */
  indoor: { day: [string, string, number]; night: [string, string, number] };
  /** pencere ışığı (yönlü ışık) — dış dünyanın saati: gündüz gün ışığı, gece ay ışığı */
  window: { day: { color: string; intensity: number }; night: { color: string; intensity: number } };
}

export const LIGHT_PRESETS: Readonly<Record<LightPresetId, LightPreset>> = {
  lamp_warm: {
    id: "lamp_warm",
    indoor: { day: ["#FFE9D2", "#3A2E26", 0.95], night: ["#FFD9A8", "#2E241C", 1.05] },
    window: { day: { color: "#FFF1DC", intensity: 0.75 }, night: { color: "#8FA6D8", intensity: 0.22 } },
  },
  gallery: {
    id: "gallery",
    indoor: { day: ["#F4F1EA", "#3A3630", 1.0], night: ["#F1E4CC", "#2C2925", 1.05] },
    window: { day: { color: "#FFF6E6", intensity: 0.85 }, night: { color: "#9DB0D8", intensity: 0.2 } },
  },
  quiet: {
    id: "quiet",
    indoor: { day: ["#E8EEF6", "#2A3442", 0.95], night: ["#DCE4F2", "#222A36", 0.9] },
    window: { day: { color: "#EAF2FF", intensity: 0.75 }, night: { color: "#8EA0C8", intensity: 0.2 } },
  },
  // açık hava katı dış dünyanın saatini doğrudan kullanır (SceneDef.time; World.tsx gece ışığı); bu ön ayar yalnız ad taşır
  open_air: {
    id: "open_air",
    indoor: { day: ["#FFFFFF", "#888888", 1], night: ["#FFFFFF", "#888888", 1] },
    window: { day: { color: "#FFFFFF", intensity: 1 }, night: { color: "#FFFFFF", intensity: 1 } },
  },
};

export type AmbienceSound = "room_tone" | "hall_echo" | "wind" | "hush";

export interface InteriorSceneRecord {
  format: typeof INTERIOR_FORMAT;
  version: typeof INTERIOR_VERSION;
  /** `<sahne>:<yer>:<kat>` */
  id: string;
  parent: { scene: string; site: string; kind: string };
  floor: { index: number; count: number; name: string; storey: number };
  space: SpaceType;
  camera: CameraRule;
  /** dünya biçimi `grid` (iç kat kendi ızgarası; ek yok) */
  grid: { w: number; d: number; annex: "none" };
  /** dünya biçimi `env` (gökyüzü, sis, ışık) — `recordDef` bundan SceneDef üretir */
  env: WorldEnv;
  light: { preset: LightPresetId; outsideNight: boolean };
  ambience: { sound: AmbienceSound; fog: [number, number] };
  minimap: { rooms: LevelRoom[] };
  /** dış şehir çizilmez; açık hava katı yalnız kendi pişmiş panoramasını taşır; WORLD-PANO: şehir landmarkı katı silüet halkası */
  exterior: "none" | "panorama" | "backdrop";
  budget: { drawCalls: number };
  /** dünya biçimi `layers` alt kümesi: kat lambaları (≤ 3) */
  layers: { lights: Light[] };
  nav: { portals: Portal[]; stairs: StairLink[]; spots: LevelSpot[] };
  zones: SceneZone[];
  /** bloklar üreticiden pişer (dünya biçimi `baked: null` gibi) */
  baked: null;
}

/** Salon sayılan en küçük yürünebilir karo sayısı. */
export const HALL_TILES = 120;
/** Katın alan türü: açık hava → güverte; müze / stadyum (ya da ≥ 120 yürünebilir karo) kapalı kat → salon; diğerleri → oda. */
export function spaceOf(lv: Pick<InteriorLevel, "outdoor" | "kind" | "built">): SpaceType {
  if (lv.kind === "courtyard") return "court"; // COURTYARD-PORTAL
  if (lv.outdoor) return "deck";
  if (lv.kind === "museum" || lv.kind === "stadium") return "hall";
  // yürünebilir alan (ayak izi değil: yuvarlak kule ve kalın duvarlı kat oda kalır)
  return lv.built.width * lv.built.depth - lv.built.blocked.size >= HALL_TILES ? "hall" : "room";
}

export const cameraRuleOf = (lv: Pick<InteriorLevel, "outdoor" | "kind" | "built">): CameraRule => CAMERA_RULES[spaceOf(lv)];

function presetOf(lv: InteriorLevel, space: SpaceType): LightPresetId {
  if (space === "deck" || space === "court") return "open_air";
  if (lv.quiet) return "quiet";
  return space === "hall" ? "gallery" : "lamp_warm";
}

const AMBIENCE: Record<SpaceType, AmbienceSound> = { room: "room_tone", hall: "hall_echo", deck: "wind", court: "wind" };
const FOG: Record<Exclude<SpaceType, "deck" | "court">, [number, number]> = { room: [18, 46], hall: [30, 80] };

/**
 * Kat → sahne kaydı. `base`: dış sahne tanımı (açık hava katının gökyüzü/saat/okyanusu), `outsideNight`: dış dünya şu an gece mi
 * (pencere ışığı). Belirlenimci (aynı girdi → aynı kayıt).
 */
export function interiorRecord(lv: InteriorLevel, base: SceneDef, outsideNight: boolean): InteriorSceneRecord {
  const space = spaceOf(lv);
  const preset = presetOf(lv, space);
  const env = envFor(lv, base, space, preset, outsideNight);
  return {
    format: INTERIOR_FORMAT, version: INTERIOR_VERSION, id: lv.key,
    parent: { scene: lv.scene, site: lv.site, kind: lv.kind },
    floor: { index: lv.index, count: lv.count, name: lv.name, storey: lv.storey },
    space, camera: CAMERA_RULES[space],
    grid: { w: lv.built.width, d: lv.built.depth, annex: "none" },
    env, light: { preset, outsideNight },
    ambience: { sound: lv.quiet ? "hush" : AMBIENCE[space], fog: env.fog },
    minimap: { rooms: lv.rooms },
    exterior: lv.pano ? "panorama" : lv.cityPano ? "backdrop" : "none",
    budget: { drawCalls: INTERIOR_DRAW_BUDGET },
    layers: { lights: lv.built.lights },
    nav: { portals: lv.portals, stairs: lv.stairs, spots: lv.spots },
    zones: lv.built.zones ?? [],
    baked: null,
  };
}

function envFor(lv: InteriorLevel, base: SceneDef, space: SpaceType, preset: LightPresetId, night: boolean): WorldEnv {
  if (space === "deck" || space === "court") {
    // açık hava: dış dünyanın gökyüzü ve saati; sis panorama inişi kadar ötelenir; deniz yüzeyi kata göre iner
    // şehir güvertesinde deniz şehrin deniz yüzünde (simge gövdesiyle aynı dönüşüm; eskiden döşemenin 0,42 altında, gövde suyun içinde)
    const td = towerDeckOf(lv);
    const drop = td ? -td.groundY : lv.pano?.drop ?? 0;
    const ocean = td ? (td.seaY != null ? { color: base.ocean?.color ?? "#2F7EA8", y: td.seaY } : null) // kıyı şehri: semtlerin ötesi deniz (şehir kabuğu gibi)
      : lv.pano?.sea != null ? { color: "#2C7DA0", y: lv.pano.sea } : base.ocean ? { ...base.ocean, y: base.ocean.y - drop } : null;
    // gerçek şehir güvertesinde sis uzak kıyıya kadar açık (kamera uzak düzlemi 400)
    const fog: [number, number] = td ? [Math.min(DECK_FAR * 0.45, base.fog[0] + 14 + drop), DECK_FAR] : [base.fog[0] + 14 + drop, base.fog[1] + 50 + drop * 2];
    return { swatch: [...base.swatch], sky: base.sky, fog, hemi: [...base.hemi],
      sun: { color: base.sun.color, intensity: base.sun.intensity, pos: [...base.sun.pos] }, night: !!base.night, ocean, weather: null,
      ...(base.time && base.time !== "auto" ? { time: base.time } : {}) };
  }
  const p = LIGHT_PRESETS[preset];
  const win = night ? p.window.night : p.window.day;
  // WORLD-PANO: silüet halkası varsa pencereden dış gök (dış dünyanın saati) görünür; sis halkanın ötesine ötelenir
  const cp: CityPano | null | undefined = lv.cityPano;
  const sky = cp ? (night ? PANO_NIGHT_SKY : base.sky) : lv.quiet ? "#141A22" : night ? "#0F0D12" : "#1A1512";
  const fog: [number, number] = cp ? [Math.max(FOG[space][0], Math.max(cp.hx, cp.hz) + cp.gap - 4), Math.max(cp.hx, cp.hz) + cp.gap + 40] : FOG[space];
  return { swatch: [...base.swatch], sky, fog, hemi: [...(night ? p.indoor.night : p.indoor.day)],
    // pencere ışığı arka (−z) duvarın pencerelerinden içeri, hafif yandan
    sun: { color: win.color, intensity: win.intensity, pos: [4, 12, -6] }, night: false, ocean: null, weather: null, time: "day" };
}

/**
 * HQA-FIX (HQA-FIX5-B0, CEO 1 Kasım: "Sultanahmet avlusunda kamerayı yukarı çekince karakter suya gömülüyor, her şey mavi"):
 * dünya zemin düzlemi (`World.tsx`, gök renginde ufuk dolgusu) kat tabanının en az 2 birim ALTINDA durur. Panorama halkası avlu gibi
 * duvarın üstünden görünsün diye YÜKSELTİLİNCE (`cityPano.elev` < 0, COURT_PANO_ELEV −3,2) eski formül −2,01 − elev düzlemi +1,19'a
 * çıkarıyordu: avluda kamera 1,2'nin üstüne çıkınca (eğim −0,8…−1,05) avatarı ve bütün zemini örten mavi bir levha. Yalnız INDİRİLEN
 * panoramalar (güverte `pano.drop` ≥ 0, kule `elev` > 0) düzlemi indirir.
 */
export const groundPlaneY = (lv?: { pano?: { drop: number } | null; cityPano?: { elev: number } | null } | null): number => {
  // gerçek şehir güvertesinde düzlem şehir sokağının altında (sokak ve deniz düzlemin üstünde kalır)
  const td = lv && "site" in lv ? towerDeckOf(lv as InteriorLevel) : null;
  return td ? td.groundY - 2.01 : -2.01 - Math.max(0, lv?.pano?.drop ?? lv?.cityPano?.elev ?? 0);
};

/** Kayıt → çizim tanımı (World.tsx `def`). Hava, çekirdek ve katman yok (iç mekân); ek kiti dış sahneninki. */
export function recordDef(rec: InteriorSceneRecord, base: SceneDef): SceneDef {
  const e = rec.env;
  return { ...base, weather: undefined, weatherNightOnly: undefined, core: undefined, tier: undefined, annex: base.annex ?? base.id,
    sky: e.sky, fog: e.fog, hemi: e.hemi, sun: e.sun, night: e.night || undefined, ocean: e.ocean ?? undefined,
    time: rec.space === "deck" || rec.space === "court" ? base.time : "day" };
}

/**
 * Asansör / kat seçici varışı: hedef kat alttan merdivenle bağlıysa üst sahanlık (merdivenden çıkınca varılan karo), değilse
 * yukarı merdivenin ayağı, o da yoksa çıkışın varışı. Merdivenle aynı yerlere varılır (duvar içinde ya da boşlukta doğulmaz).
 */
export function arrivalFor(levels: readonly (Pick<InteriorLevel, "portals" | "stairs"> & { lifts?: InteriorLevel["lifts"] })[], _from: number, to: number): Tile | null {
  const lv = levels[to];
  if (!lv) return null;
  // asansörlü katta kat seçici asansör kapısının önüne varır
  return (lv.stairs.find((s) => s.dir === "down") ?? lv.stairs.find((s) => s.dir === "up"))?.stand ?? lv.lifts?.[0]?.tile ?? lv.portals.find((p) => p.to === "out")?.arrive ?? null;
}
