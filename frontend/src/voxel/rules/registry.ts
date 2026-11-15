/**
 * S45 — Rule Registry v1.0 (rehber §3, §10): VoxCrew dünyalarına uygulanan kurallar VERİ olarak.
 *
 * - Her kuralın kalıcı kimliği, semver sürümü, türü (MUST / MUST_NOT / REQUIRES / ALLOWS / PREFERS / DISCOURAGES /
 *   SCALES_WITH), derlenmiş şiddeti (error | warning — rehberdeki "hard/soft" burada kesinleşir), öncelik katmanı (§3.2),
 *   kapsamı, denetim işlemi (`check`: SONLU bir işlem listesinden; eval/serbest betik yok), onarım sırası ve testleri vardır.
 * - Öncelik (§3.2): 1 tutarlılık · 2 fizik/erişim · 3 oyun politikası/sahne · 4 ajan görevi · 5 kapasite · 6 estetik.
 *   `ALLOWS` bir kuralı yalnızca kendi kapsamında ve kendi katmanı hedefinkinden YÜKSEK değilse (sayı ≤) geçersiz kılar;
 *   estetik bir istisna fizik kuralını delemez (`compileRegistry` reddeder).
 * - Çakışma: aynı sahnede aynı nesne türü hem yasak hem gerekli ise derleme hatası (rehber §13.2 "gizli override").
 * Denetimlerin gövdesi rules/engine.ts'te; bu dosya yalnız veridir.
 */
import type { BedKind, Device, Pose, WorldSceneId } from "../scenes";
import { NEW_CITIES } from "../cities/index";
import { fullRules, FULL_CITY_WORK_OWN, FULL_NO_FLAME_SCENES, FULL_OUTDOOR_DEVICE_SCENES, FULL_PREMIUM_SCENES, FULL_RULE_CITY_SCENES } from "../../full/rulesRegistry";

export type RuleKind = "MUST" | "MUST_NOT" | "REQUIRES" | "ALLOWS" | "PREFERS" | "DISCOURAGES" | "SCALES_WITH";
export type Severity = "error" | "warning";
/** 1 tutarlılık · 2 fizik/erişim · 3 politika/sahne · 4 ajan görevi · 5 kapasite · 6 estetik */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6;

/** Sonlu denetim işlemleri (rehber §10.1 "beyaz listeli operatörler"). */
export type Check =
  | { op: "finite_geometry" }
  | { op: "anchors_in_bounds" }
  | { op: "anchors_free" }
  | { op: "anchors_supported" }
  | { op: "anchors_reachable" }
  | { op: "exclusive_slots" }
  | { op: "vocabulary" }
  | { op: "provenance_complete" }
  | { op: "block_budget"; base: number; perBay: number; /** CITY-BIG: çekirdekli büyük şehir tabanı (> 24×16) */ bigBase?: number }
  | { op: "district_connected" }
  | { op: "roads_walkable" }
  | { op: "growth_matches_demand" }
  | { op: "service_ratio" }
  | { op: "role_separation" }
  | { op: "no_objects"; types: string[] }
  | { op: "has_objects"; types: string[]; min: number; where: "base" | "work_districts" | "world" }
  | { op: "station_poses"; allow: Pose[] }
  | { op: "station_devices"; deny: Device[] }
  | { op: "laptop_work"; poses: Pose[]; minShare: number }
  | { op: "sleep_capacity"; base: number; ratio: number; perWorkBay: number }
  | { op: "sleep_beds"; allow: BedKind[] }
  | { op: "objects_on"; types: string[]; surface: "water" | "land"; minShare: number }
  | { op: "ambient_habitat" }
  | { op: "water_districts"; minShare: number }
  | { op: "level_access" }
  | { op: "anchors_ground_level" }
  | { op: "no_flame" }
  | { op: "annex_adjacency" }
  | { op: "water_not_walkable" }
  | { op: "sleep_body_clearance" }
  | { op: "has_hooks"; kinds: string[]; min: number }
  | { op: "tool_spots"; kinds: ("web" | "read" | "plan" | "shell" | "write")[] }
  // S46: görsel denetimde bulunan mantık hataları
  | { op: "team_contiguous" }
  | { op: "district_clone" }
  | { op: "district_adjacency" }
  | { op: "seam_water" }
  | { op: "district_density"; maxPlain: number; open: string[] }
  | { op: "station_faces_furniture" }
  | { op: "sleep_apart_from_work" }
  | { op: "sleep_in_hotel"; every: number; minY: number }
  // SP-W0: sacred bölgeler, hareketli set parçaları, ufuk silüeti, IP/kültür puanı
  | { op: "sacred_anchors" }
  | { op: "sacred_fun"; margin: number; kinds: string[] }
  | { op: "sacred_ambient" }
  | { op: "mover_budget"; max: number; boxes: number }
  | { op: "backdrop_budget"; max: number; /** CITY-BIG: çekirdekli büyük şehir tabanı (> 24×16) */ bigMax?: number }
  /** HORIZON: kopuk ufuk kümeleri (city/horizonGround.ts `detachedBackdrop`); en çok `report` küme raporlanır */
  | { op: "backdrop_ground"; report: number }
  /** W3a-INT — parlayan blok bütçesi (Neon Çarşı, Aurora): taban ızgara + ufuktaki `glow` blokları ≤ base; büyüyen bölge başına
   *  ortalama ≤ perBay; yalnız ufuk `glow` blokları ≤ backdrop; bütün dünyada `led` işareti ≤ led, nokta ışık ≤ lights. */
  | { op: "glow_budget"; base?: number; perBay?: number; backdrop?: number; led?: number; lights?: number }
  | { op: "scene_risk"; max: number }
  // SP-W1: simge silüet çevresinde gece ışık gösterisi yok (yalnız küçük kırmızı ikaz ışığı)
  | { op: "landmark_night"; tag: string; margin: number; beacons: number; beaconSize: number }
  // RING-INT: simge çekirdeği (`SceneDef.core`) dünyanın ortasında, bölgeler çekirdeğe girmez; çekirdekte en az bir simge
  | { op: "city_core"; maxOffset: number }
  | { op: "city_landmark" }
  // W2 (WALK-INT): yürüme modu — doğma, çıktı panosu, hatıra yerleşimi, kesit örtü yüksekliği (voxel/walk/controller.ts)
  | { op: "walk_spawn" }
  | { op: "walk_board" }
  | { op: "walk_sacred"; n: number }
  | { op: "walk_cover"; minY: number }
  // EXP (E1c): denetimi dış betikte olan kural (çevre parselleri `Built`'te yok); motor atlar, betik kayıtla iki yönlü eşleşir
  | { op: "external"; script: "expanse_check" | "tour_check" | "landmark_walk_check" | "ceo_eye_walk" | "ceo_eye_check" | "ceo_eye_towers" | "arrival_origin_check" | "arrival_landmark" | "walkflow_check" | "entry_door_check" | "facade_variety_check" | "aerial_lod_check" }; // LANDMARK-WALK: landmark_walk_check · LONDRA: ceo_eye_towers · ARRIVAL-ORIGIN: arrival_origin_check

export interface Scope {
  /** "*" = bütün sahneler; liste = yalnız bunlar */
  scenes: "*" | WorldSceneId[];
  /** kural yalnız büyümüş dünyada (bölge planı varken) anlamlıysa */
  grownOnly?: boolean;
}

export interface Rule {
  id: string;
  version: string;
  kind: RuleKind;
  severity: Severity;
  tier: Tier;
  origin: "game_design" | "engine_constraint" | "research_informed";
  scope: Scope;
  check?: Check;
  /** ALLOWS: geçersiz kıldığı kural */
  overrides?: string;
  /** onarım sırası (rehber §3.2: yer değiştir → ikame → kapasite → zon/bağlantı → açık görev uyuşmazlığı) */
  repair: string[];
  /** bu kuralı çalıştıran testler (frontend/scripts/rules.mjs vaka adları) */
  tests: string[];
  /** rehber karşılığı (varsa) */
  guide?: string;
  explanation: string;
}

const R = (r: Omit<Rule, "version" | "origin"> & Partial<Pick<Rule, "version" | "origin">>): Rule =>
  ({ version: "1.0.0", origin: "game_design", ...r });

const OUTDOOR_NO_OFFICE = ["desk", "monitor", "office_chair", "server_rack", "desk_lamp"];
const SUITE = ["suite:13x5"];
/** SP-W1 pilot şehirler (CITY-WORK-001 kapsamı) ve bütün pilot sahneler (barışçıl sahne politikaları). */
const CITY_SCENES: WorldSceneId[] = [...FULL_RULE_CITY_SCENES,
  ...NEW_CITIES.filter((m) => m.cityWork !== false).map((m) => m.catalog.id as WorldSceneId)];
const PILOT_SCENES: WorldSceneId[] = [...CITY_SCENES, ...FULL_PREMIUM_SCENES];

/** EXP (E1c): çevre arazisi kuralları — denetim `scripts/expanse_check.mjs`'te (`check.op = "external"`); `tests: []`. */
function EXPANSE_RULES(): Rule[] {
  const X = (id: string, kind: RuleKind, tier: Tier, explanation: string, origin: Rule["origin"] = "game_design") =>
    R({ id, kind, severity: "error", tier, scope: { scenes: "*" }, check: { op: "external", script: "expanse_check" }, repair: ["regenerate_parcel", "report_generator_bug"], tests: [],
      origin, explanation });
  return [
    X("EXP-DET-001", "MUST", 1, "Aynı tohum + (cx, cz) → aynı parsel karması (taze bağlam, ters üretim sırası); uzak LOD tek başına üretilse de aynı.", "engine_constraint"),
    X("EXP-STABLE-001", "MUST", 1, "Dünya büyürken (taban → 20 → 60 → 150 → 300 ajan) dikiş ve keşif sınırı dışında kalan, ulaşılabilirliği değişmeyen çevre parselleri bayt bayt aynı.", "engine_constraint"),
    X("EXP-SEAM-001", "MUST", 2, "Dünya kutusuna bitişik parselin 2 karoluk dikiş şeridi dünya kenarını sürdürür: yürünebilir kenar karosunun komşusu yürünebilir ve aynı yükseklikte; su kenarı su olarak sürer (kıyıda kesintisiz)."),
    X("EXP-REACH-001", "MUST", 2, "Parsel içi yürünebilir karolar tek bileşen; ulaşılabilir parselin her yürünebilir karosundan dünya kutusuna yol var (sıkışma yok); ulaşılamaz parsel yalnız görsel."),
    X("EXP-COLLIDE-001", "MUST_NOT", 2, "Avatar çevre yapılarının (ev, ağaç, kaya, engel) içinden geçmez: gövde bandındaki her çevre bloğunun ayak izi katı karodur; avatar benzetiminde çevre ızgarasına batma 0, yüklenmemiş parsele giriş yok; tıkla-git birleşik ızgarada yalnız geçilebilir karolardan geçer.", "engine_constraint"),
    X("EXP-BAND-001", "MUST_NOT", 3, "Ufuk bandı (backdrop ayak izi ve dışa gölgesi), ızgara dışı landmark ve yer hareketlisi yolları ile kesişen parsel üretilmez; dünya kutusuyla kesişen parsel bastırılır."),
    X("EXP-SACRED-001", "MUST_NOT", 3, "Çevrede ibadet yapısı yok; sacred tamponunda (3 karo) çevre öğesi yok."),
    X("EXP-IP-001", "MUST_NOT", 3, "Üreteç yalnız beyaz listedeki jenerik öğeleri üretir: yazı, bayrak, logo, simge ölçeği (> 3,5 birim) ve canlı/bayrak grubu yok."),
    X("EXP-BUDGET-001", "MUST", 5, "Parsel başına ≤ 90 (yakın) / ≤ 30 (uzak) blok, parıltı ≤ 8, nokta ışık 0; yalnız sahnede zaten var olan durağan gruplar (+0 çizim çağrısı).", "engine_constraint"),
    X("EXP-STREAM-001", "MUST", 5, "Akış: yuvalar tekil ve kapasite içinde (16 yakın + 56 uzak; yuva taşması 0), istenen yakın/uzak halka yakınsar, histerezis payı dışındaki parsel bırakılır, aynı yol → aynı yazım dizisi, temizlikte kuyruk tabana döner.", "engine_constraint"),
    X("EXP-TIME-001", "MUST", 5, "Yakın parsel üretim medyanı ≤ 1,5 ms (Node; kare başına ≤ 1 üretim).", "engine_constraint"),
    // E3 yapı modu: kurallar voxel/build/volume.ts ↔ backend/studio/expanse/build.py
    X("BUILD-ZONE-001", "MUST", 2, "İnşa yalnız sahiplenilmiş parselin hacminde (12 × 8 × 16): kenar halkası (çit, dikiş şeridi) ve omurga (li 5–6, lj 7–8; y < 2) boş, havada blok yok (destek kuralı), kilitli dekor (S35) yeni konmaz; seçim ışını mantıksal hacme karşı (DDA) doğru hücreyi bulur."),
    X("BUILD-NAV-001", "MUST", 2, "İnşadan sonra parselin ≥ %50'si yürünebilir ve tek bileşen; \"Parselime git\" karosu, kenar geçitleri ve dikiş şeridi açık; her yürünebilir parsel karosu dünyaya bağlı; gövde katmanı (y < 2) ve prefab ayak izi çarpışma ızgarasında katı (avatar giremez).", "engine_constraint"),
    X("BUILD-BUDGET-001", "MUST", 5, "Parsel başına ≤ 600 blok + 40 prefab, zeminde ≤ 48 dolu karo, dünya ≤ 6000 blok, gövde ≤ 64 KB; inşa yalnız sahnede var olan durağan gruplarla kapasite kuyruğunun inşa bölgesine çizilir (+0 çizim çağrısı) ve kuyruk eki bütün örnekleri karşılar.", "engine_constraint"),
    X("BUILD-DET-001", "MUST", 1, "Aynı parsel gövdesi → aynı inşa blokları (açgözlü birleştirme ve prefab pişirme belirlenimci); dünya büyürken inşa parsel yerel çerçevesinde değişmez (konum saklanmaz, yuva kayar).", "engine_constraint"),
    X("PLOT-RING-001", "MUST", 3,"Parsel yuvaları (E2) ≤ 12, dünya kutusunun dışındaki ilk halkada, üretilen ve ulaşılabilir parselde, tekil; ufuk yönünde değil; 20/60/150/300 ajanda çakışma yok (konum saklanmaz, yuva kutuyla kayar). Sahiplenilmiş parsel (düzleştirilmiş zemin, çit, bank, yazısız rozet) aynı yuva bütçesinde (+0 çizim), dikişi korur, tek bileşen ve dünyaya bağlı; donatı katı; belirlenimci."),
  ];
}

/**
 * şehir haritası kuralları — denetim `scripts/city_check.mjs`'te; `expanse_check` (kayıt eşlemesi,
 * iki yön) ve `walk_check` (avatar yürüyüşü) çağırır (`check.op = "external"`, `script: "expanse_check"`). Şehir haritası ofis
 * tabanından ayrıdır: RING/CITY-BIG ve ofis kuralları değişmez.
*/
function CITY_MAP_RULES(): Rule[] {
  const C = (id: string, kind: RuleKind, tier: Tier, explanation: string, origin: Rule["origin"] = "game_design") =>
    R({ id, kind, severity: "error", tier, scope: { scenes: "*" }, check: { op: "external", script: "expanse_check" }, repair: ["regenerate_district", "report_generator_bug"],
      tests: [], origin, explanation });
  return [
    C("CITY-MAP-FMT-001", "MUST", 1, "Dünya biçimi v1.3 `city_map`: kapalı şema, kimlikler tekil, semt sınırı parsel ızgarasına hizalı (12 × 16) ve varış meydanı ile birbirinden ayrık, landmark ayak izi semt kenar halkasının içinde, kapı ↔ iç mekân birlikte, duraklar var olan semtte, hat ≥ 2 tekrarsız durak; ön yüz ve arka uç aynı alan yollarını üretir; v1/v1.1/v1.2 dosyalar değişmez, city_map yalnız v1.3'te.", "engine_constraint"),
    C("CITY-MAP-CAT-001", "MUST", 1, "CITY-CATALOG bloğu (ön yüz = arka uç `walk/explore.py CITY_CATALOG`) haritalardan türeyen özetle aynı: semtler, landmarklar (girilebilir mi), seyir noktası sayısı, duraklar; pasaport kimlikleri tekil.", "engine_constraint"),
    C("CITY-MAP-DET-001", "MUST", 1, "Belirlenimci tohum: aynı (harita, semt tohumu) → aynı semt planı ve parsel karması (taze önbellek, ters üretim sırası); aynı yürüyüş yolu → aynı yuva yazım dizisi.", "engine_constraint"),
    C("CITY-MAP-REACH-001", "MUST", 2, "Her landmark erişilebilir: varış karosundan yürünerek ya da ulaşım hattıyla (ada ve karşı kıyı semtleri yalnız vapur/kayıkla) her landmarkın ayak izine bitişik bir karoya, her girilebilir landmark kapısına, durağa, giriş ve seyir noktasına, gizli köşeye ve \"Ofise dön\" kapısına yol var; avatar benzetimi (tıkla-git + adım, bütün parseller yüklü) her kapıya ve durağa varır, katı karoya ya da yapıya batmaz; ulaşılamayan cep karosu çite çevrilir (sıkışma yok)."),
    C("CITY-MAP-LINK-001", "MUST", 2, "Semtler bağlı: her semte varış meydanından yürüyerek (komşu yürünebilir sınır karoları) ya da ulaşım hattıyla ulaşılır; hattın ardışık durakları arasında iki yönde yolculuk planı var, süre aracın sınırında (3…9 sn), rota durak karolarında başlar ve biter."),
    C("CITY-MAP-BUDGET-001", "MUST", 5, "Çizim bütçesi: semt parselleri yalnız durağan gruplarla (`solid/water/glass/glow`) CITY_LAYOUT yuvalarına sığar (yakın 192/24/12/12, uzak 40/8/4/4; düşen blok 0), düzen + araç bölgesi `TAIL_CAP` içinde, varış meydanı dört durağan grubu taşır ve başka grup yok → şehir kipi +0 çizim çağrısı; canlı ölçüm gündüz ve gece ≤ 22 (walk_perf / __voxcrewPerf).", "engine_constraint"),
    C("CITY-MAP-STREAM-001", "MUST", 5, "Semt akışı: yalnız şehir kipinde; yuvalar tekil ve kapasitede (12 yakın + 24 uzak), taşma 0, istenen yakın (3 × 3) / uzak (5 × 5) halka yakınsar, histerezis payı dışındaki parsel ve uzak semt bırakılır, temizlikte kuyruk tabana döner; ofis tabanı ve çevresi şehirde çizilmez.", "engine_constraint"),
    C("CITY-MAP-LM-001", "MUST", 2, "Landmark kütüphanesi (SK-1): her şehir landmarkının yakın ayrıntı + uzak LOD (≤ 6 blok) modeli ve okuma notu var, IP/kültür riski ≤ 1, model ayak izinin yüksekliğini aşmaz; ibadet yeri yalnız dış görünüm + avlu (kapı/iç mekân yok, kutsal bölge); semt başına 2 gizli köşe, kilit kuralları geçerli ve en az bir ücretsiz başlangıç semti (SK-K5), süresiz görev kimlikleri katalogda; girilebilir landmark iç mekânlarında katlar bağlı, tek çıkış ilk katta, merdivenle her kata ulaşılır, kesit kapsamı %100 ve çizim çağrısı ≤ 22; WORLD-PANO: yer altı dışındaki her katta şehrin silüet halkası (pencere/güverte; +0 çizim çağrısı, kamera erişim kutusunun dışında).", "game_design"),
    C("CITY-MAP-TRANSIT-001", "MUST", 2, "Ulaşım aracı araziye ve yapıya girmez (CITY-POLISH): her hattın yolculuk planı 0,2 adımla örneklenir; aracın çizilen gövdesi (CityRig ile aynı: gövde durak karosunun dışına taşmaz, sürüş yüksekliği profili `CityDesign.rides`, yön 90°'ye yuvarlanır; ince halat/tel hariç; monoray eteği ve teleferik askısı kendi yolu) bütün semt bloklarıyla kesişmez ve tabanı karonun yükseklik alanının (zemin, `terraces`, su yüzü, yapı yığını) altına inmez. Yerde giden hatların (ray, otobüs) iki yanı boş koridordur. Hattın duraklarının 3 × 3 yanaşma halkasındaki değmeler yanaşmadır; başka muaf yalnız `TRANSIT_EXEMPT` içinde ve yazılı gerekçeyle. WORLD-PANO ortam taksileri de kapsanır: döngüleri yalnız sokak koridorunda (`T_STREET`, yükseltisiz), 0,2 adımla hiçbir yakın bloğa (ince süs dahil) değmez, karede ≤ `TAXI_MAX`, örneklenmiş kuyruk yuvası (+0 çizim çağrısı), hareket azaltmada durur; muaf yok.", "engine_constraint"),
    C("CITY-MAP-OPAQUE-001", "MUST", 2, "Sokak kesiti yalnız gerçek örtücüleri açar (UX-P2; iç mekân INTERIOR-OPAQUE-001'in sokak karşılığı): şehir sokağında (`space: street`) bir blok yalnız dünya kutusu avatar gövdesinden (göğüs, baş, iki omuz) kameraya giden doğrulardan birini kesiyorsa atılır, bütün blok olarak (karar blok merkezinde, köşe gölgelendiricisinde; yarım kesilmiş oyuk kutu yok); zemin (merkez ≤ minY) hiç atılmaz; doğru açıksa hiçbir blok atılmaz. Eski bütün-ekran penceresi (avatar düzleminin önündeki her parça) sokakta kullanılmaz. Ek malzeme/mesh/çizim çağrısı yok.", "engine_constraint"),
    C("CITY-MAP-LIVE-001", "MUST", 2, "Şehir haritası canlı katmanı (CL-05, `citymap/live.ts`): binilmeyen hat araçları (vapur, kayık, teleferik, monoray, balon) binilen aracın yolculuk planında dolaşır, martı/güvercin sürüleri ve süzülen balonlar yapıların ve ayakta duran avatarın başının üstündedir; hiçbir hareketli yakın bloğa, araziye, birbirine, binilen araca (binilen hattın canlı aracı çizilmez) ya da duraktaki avatara değmez; yalnız yüklü parselin (ya da varış meydanının / semt dışı açık suyun) üstünde çizilir. Karede ≤ 12 hareketli, ≤ 400 kutu, ≤ 3 sürü; kapasite kuyruğuna yazmaz (TAIL_CAP payı değişmez), görünür bir şey varken tek örneklenmiş dizi (+1 çizim çağrısı, gölgesiz), yokken +0. Hareket azaltmada kare donar ve sürü yok; gece sürü ve balon yok, cam ve far yanar.", "engine_constraint"),
    // METRO1 (ürün sahibi 2026-11-01): ray sürekliliği ve binmeye değer yolculuk — denetim scripts/metro_check.mjs (city_check çağırır)
    C("CITY-MAP-RAIL-001", "MUST", 2, "Raylı hat (metro, tramvay, füniküler) rotası kesintisizdir: rotanın her karosu semt içinde ray ya da durak karosudur (durak/giriş/seyir halkası, otobüs geçidi, simge ayak izi, yükselti sütunu ve ray üstündeki katı blok rayı kesmez); iki ray karosu arası boşluk ≤ 1 karo (yalnız durak); rota durak karosunda başlar ve biter. Raysız yeni mekik hattında (METRO2) süreklilik CITY-MAP-TRANSIT-001 ile aranır: araç arazi ve yapı içinden geçmez.", "engine_constraint"),
    C("CITY-MAP-HOP-001", "MUST", 2, "Binmeye değer yolculuk: ardışık iki durak arası ray yolu metroda en az 48, tramvayda en az 30, yeni otobüs/mekik hattında (METRO2: kasaba mekiği, Kapadokya) en az 45 karo (otobüs 45 karoda yolculuk + biniş beklemesi yürümeden kısa; muaf eski otobüs hatları metro_check.mjs LEGACY_BUS'ta yazılı gerekçeyle) (füniküler yokuş çıktığı için muaf; metro 48 karoda yolculuk + biniş beklemesi yürüme süresinden (2,6 karo/sn) kısa kalır); hattın hiçbir durak çifti 75 sn'yi aşmaz.", "game_design"),
    C("CITY-MAP-RIDE-001", "MUST", 2, "Rahat yolculuk süresi: ardışık duraklar arası VE hedef seçicide sunulan (stopLines; çok bacaklı dahil) her raylı ve yeni otobüs/mekik yolculuğunun TOPLAM süresi (travelPlan.seconds) 8…22 sn (hız ve ivme RIDE_MOTION ile sınırlı; çok kısa ya da çok uzun yolculuk yok).", "game_design"),
    // (ürün sahibi: "Kapadokya servisi yürümekten yavaş"): mekik yürümeden hızlı — denetim scripts/metro_check.mjs
    C("CITY-MAP-WORTH-001", "MUST", 2, "Yürümeden hızlı mekik: muaf olmayan her otobüs/mekik hattında her durak çifti için yolculuk (travelPlan.seconds + biniş beklemesi) duraklar arası kuş uçuşu yürüme süresinden (WALK_SPEED 2,6 karo/sn) kısadır; köşeli rotanın viraj yavaşlaması da sayılır (yalnız düz rota uzunluğu yetmez).", "game_design"),
    // LANDMARK-HIRES (I1): simge yüksek çözünürlük yolu — scripts/hires_check.mjs (city_check çağırır)
    C("LANDMARK-HIRES-001", "MUST", 2, "Simge yüksek çözünürlük yolu (hires/*): kayıtlı her simgenin yakın (hi) kademesi simge başına bütçede (katı 1500, ışık 192, cam 96, su 24; yalnız durağan gruplar), katman grup başına tek örneklenmiş ağ (≤ 4 çizim çağrısı + gölge, simge sayısından bağımsız); hi ≥ mid kutu, en küçük kenar ≥ 0,02, kutular ayak izi + kayıtlı ek bölge (ya da orta model zarfı) içinde, tepe mid ±%12, havada küme yok, yürünür karonun yürüme bandına girmez; orta model veri katmanında kalır (bütçe, çarpışma, kamera, ölçek), yalnız çizimi katmana geçer.", "engine_constraint"),
    // kaya semtinde pencereli bina yok — scripts/city_check.mjs `checkRock`
    C("CITY-MAP-ROCK-001", "MUST", 2, "Kaya semti doğal kaya dokusudur: tasarımında kaya kütlesi (`rock`) olan semtte (kaya geçidi, kayaya oyulmuş meydan) planda pencereli bina (hücre binası ya da kaya olmayan tasarım binası) yoktur ve tasarımdaki kaya kütlelerinin hiçbiri ayrılmış karoya (simge meydan halkası, durak/giriş/seyir halkası) değip düşmez; kaya kütlesi penceresiz katmanlı kaya bantlarıyla çizilir (citymap/facade.ts `rockBlocks`)."),
  ];
}

/**
 * TOUR-VIEW ( F1): gezi modunda görüş mesafesi — denetim `scripts/tour_check.mjs`'te
 * (`check.op = "external"`, `script: "tour_check"`); betik kendi kimliklerini bu kayıtla iki yönlü karşılaştırır.
*/
function TOUR_RULES(): Rule[] {
  const T = (id: string, kind: RuleKind, tier: Tier, explanation: string, origin: Rule["origin"] = "game_design") =>
    R({ id, kind, severity: "error", tier, scope: { scenes: "*" }, check: { op: "external", script: "tour_check" }, repair: ["regenerate_district", "report_generator_bug"],
      tests: [], origin, explanation });
  return [
    T("POP-IN-001", "MUST_NOT", 3, "Gezi modunda yapı ani belirmez: şehrin bütün parsellerinin uzak LOD'u silüet katmanında baştan görünür (uzak halka yazımı bire bir aynı blokları yazar); parıltı ve uzak yazım sis başlangıcından (≤ uzak halka yan erişimi + 4) ve halka kenarından (2 parsel) yakında, yakın halka ayrıntısı görüş konisinde 12 birimden yakında belirmez; yazım ve bırakma 0,4 sn titreşimli geçişle (CityRig `writeTail(…, fade)` / `releaseTail`), akış avatarın önündeki noktanın (yürüyüş ≈ 12, koşu ≈ 17 birim) çevresini de yükler; avatarın 8 birim çevresindeki açık parsel yakın halkada yüklüdür. Yürüyüş benzetimi: varış meydanından bütün semtlere (yürü, koş, dönüş) CityRig kare mantığıyla."),
    T("LANDMARK-GARDEN-001", "REQUIRES", 3, "`garden` tanımlı landmarkın kapıları boş, yürünür iç karoları (≥ 4) planda yürünür ve semt girişinden ulaşılır; ayak izi kenarında dışa açılan, ulaşılabilir en az bir giriş (kapı ya da duvarsız açık kenar) var. Duvar, kule, havuz ve çeşme katı kalır."),
    T("LANDMARK-SILHOUETTE-001", "REQUIRES", 3, "Her landmarkın uzak LOD'u (1…6 sonlu blok) var ve semt parselinin silüetinde bire bir bulunur; silüet katmanı parsel başına ≤ 24 blokla kapasiteye sığar ve bütün parselleri kapsar; doğal sınır katmanı (`cityBoundary`) boş değildir ve şehir kutusuna girmez."),
  ];
}

/**
 * LANDMARK-WALK (ürün sahibi 2026-10-30): simgenin yanında ve bahçesinde yürüme — denetim `scripts/landmark_walk_check.mjs`
 * (`check.op = "external"`, `script: "landmark_walk_check"`; walk_check çağırır); betik kimliklerini bu kayıtla iki yönlü karşılaştırır.
 */
function LWALK_RULES(): Rule[] {
  const T = (id: string, kind: RuleKind, explanation: string) =>
    R({ id, kind, severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "external", script: "landmark_walk_check" }, repair: ["regenerate_district", "report_generator_bug"],
      tests: [], origin: "game_design", explanation });
  return [
    T("WALK-LANDMARK-VIS-001", "MUST", "Simgenin yakında görünen modeli (yüksek çözünürlük kayıtlıysa hi, değilse orta model) ile çarpışma uyuşur: görünen modelce boş (yürüme bandında karo ortasının ±0,3 çevresi), yürünür bir komşudan basamakla (≤ 0,35) ulaşılan ayak izi karosu engelli değildir (görünmez duvar yok; kutsal simgenin tavanlı iç mekân karosu hariç) ve ayak izi ± 2 karo içinde yürünür bir karonun ortası yürüme bandında görünen bir bloğun içinde değildir (duvarın içinden geçilmez). Şehir haritasında ve taban sahnede."),
    T("WALK-LANDMARK-RING-001", "REQUIRES", "Simgenin katı karolarını (ayak izi + görünen parçasıyla katılaşan karo) çevreleyen halka yürünür ve semt girişinden (taban sahnede doğma karosundan) ulaşılır; yürünemeyen halka karosu ancak su, bina, ağaç, başka simge ya da görünür katı bir şeydir (çit, kapalı cep ve görünmez engel yok)."),
    // COURTYARD-PORTAL (ürün sahibi 2026-10-31 "Sultanahmet bahçesine kapıdan giremiyorsun, duvarın içinden geçerek giriyorsun")
    T("WALK-LANDMARK-WALL-001", "MUST", "Görünen duvardan geçilmez: simgenin görünen bloklarının kapladığı alan ± 1 karo içinde iki komşu yürünür karo arasındaki adım, yürüme bandında görünen bir katı bloğu (karo kenarındaki ince avlu duvarı, korkuluk, kapı oyması sonrası kalan dilim) kesmez. Taban sahnede sahnenin kendi çarpıştırıcısı aynı adımı kesiyorsa fizik durdurur. Şehir haritasında ve taban sahnede."),
    T("WALK-GARDEN-001", "REQUIRES", "Bahçe/avlu/sur içi girilebilir: `garden` tanımlı simgenin kapıları görünen modelce boş, iç karoları yürünür ve semt girişinden ulaşılır; hiçbir simgede görünen modelce boş, tavansız, ≥ 4 karoluk KAPALI cep (kapısız avlu) yoktur — her avlunun görünür bir girişi vardır. Taban sahnede açılan simge karoları doğmadan ulaşılır."),
  ];
}

/**
 * (ürün sahibi 2026-10-31, <city> kiremit çatılı ev sokağı): ürün sahibinin kendi gözüyle bulduğu hata sınıfları — denetim
 * `scripts/ceo_eye_walk.mjs` (`check.op = "external"`, `script: "ceo_eye_walk"`; walk_check çağırır); betik kimliklerini bu kayıtla iki yönlü
 * karşılaştırır. Rapor:.
*/
function CEYE_RULES(): Rule[] {
  const T = (id: string, kind: RuleKind, explanation: string) =>
    R({ id, kind, severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "external", script: "ceo_eye_walk" }, repair: ["regenerate_district", "report_generator_bug"],
      tests: [], origin: "game_design", explanation });
  return [
    T("WALK-STEP-001", "MUST_NOT", "Yürünebilir ızgarada iki yürünür komşu karonun zemini merdivensiz bir adımdan (STEP_H 0,35) fazla ayrılmaz: düşme noktası (uçurum) ve çıkılamayan basamak yok. Planlayıcı (district.ts) yüksek karoyu istinat duvarına çevirir; rampa adımı ≤ 0,35 olur. Tüm şehir haritaları, tüm semtler (ürün sahibi 2026-10-31: \"merdivenden düşülüyor\")."),
    T("WALK-BODY-001", "MUST_NOT", "Oyuncu gövdesi (yarıçap 0,28) yürünür bir karo ortasında görünen katı duvar/kütle bloğunun içine girmez (durak/giriş/seyir halkası tasarım duvarını delmez; soft halka). Simge ayak izi ± 1 karo LANDMARK-WALK'ta. Açık iş çıtası scripts/fixtures/ceo_eye_baseline.json (yalnız aşağı iner)."),
    T("WALK-NPC-GROUND-001", "MUST", "Figüran (NPC) rota noktasında ayak yüksekliği o karonun fizik zeminine (avatarın bastığı yükseklik: parsel near.top) eşittir — havada yürüme ve gömülme yok; rotada komşu karolar arası fark ≤ STEP_H (eskiden pedGrid zemini plan.top + plan.lift ile iki katlıyordu)."),
    T("VIEW-TURN-001", "MUST", "Her şehirdeki her seyir noktasının (şehir haritası seyir karosu, iç mekân dürbün karosu) bakış hedefi vardır; oyuncu karoya gelince karakter hedefe yumuşak döner ve kamera kadrajlar (walk/viewTurn.ts; hedef: şehirde semtin en belirgin simgesi, iç mekânda dürbünün AIM-001 hedefi), hareket azaltmada anında; kullanıcı fareyle çevirirse döndürme biter."),
    T("VIEW-SIGHT-001", "MUST", "her şehirdeki her seyir noktasının otomatik bakışı bir yüzeye/ağaca/direğe yapışmaz: bakış ışını yelpazesinin ilk 6 karosunda (hedef simgenin kendi blokları hariç) katı yüzey, ağaç gövdesi ya da direk yoktur; hedef simge görünür ve kadrajdadır (yatay sapma ≤ 0,5 rad). citymap/vpAim.ts pickVpAim aday hedefleri ve bakış yönlerini bu ölçüte göre seçer; sağlanamıyorsa seyir karosu taşınır."),
    T("VIEW-UNIQUE-001", "MUST", "iki şehir seyir karosu koordinat şablonunu paylaşmaz (en çok 1 ortak koordinat); her şehrin seyir noktaları kendi simgelerine göre yerleştirilir (üç şehir aynı 30,34 · 24,19 · 30,28 kullanıyordu)."),
    T("RIDE-CAM-001", "MUST", "şehir yolculuğu (metro, tramvay, füniküler, monoray, vapur, kayık, otobüs, teleferik, balon) boyunca 1. şahıs kamerası araç gövdesinin içinde kalamaz (düz gri ekran): yolculukta görünüm üçüncü şahsa geçer (walk/rideCut.ts firstPersonOn), varışta tercih geri gelir."),
    T("VIEW-FRAME-001", "MUST", "her seyir noktasının gerçek 1. şahıs karesinde (göz 0,91, dikey 62°, 16:10, 24 × 15 ışın; parsel blokları + simgelerin görünen modeli, hedef dahil) 3,5 m içinde engel karenin ≤ %12'si, kadraj ortası 8 m içinde başka bir şeyle ≤ %25 kapalı, hedef simge 14 m içinde karenin ≤ %30'unu doldurur ve üst kenardan taşmaz (cephe), hedef karede görünür (≥ %2; 60 m ötesi panoramada ≥ %0,8)."),
  ];
}

/**
 * (ürün sahibi 2026-11-01/02 "Hiçbir yapı yürüyüşü zorlaştırmamalı"): yürüme akışı — denetim `scripts/walkflow_check.mjs`
 * (`check.op = "external"`, `script: "walkflow_check"`; walk_check çağırır), 21 şehrin taban sahnesi ve şehir haritası semtleri; betik
 * kimliklerini bu kayıtla iki yönlü karşılaştırır. Rapor:.
*/
function WALKFLOW_RULES(): Rule[] {
  const T = (id: string, kind: RuleKind, explanation: string) =>
    R({ id, kind, severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "external", script: "walkflow_check" }, repair: ["regenerate_district", "report_generator_bug"],
      tests: [], origin: "game_design", explanation });
  return [
    T("WALK-CLEAR-001", "MUST_NOT", "Yürünür koridorda ince katı (direk, lamba, köprü kulesi ayağı, babası, ağaç gövdesi: gövde bandında yatay kenarı ≤ 0,35; yaya ölçeğinde örtü — tente, çardak, revak, alt ≤ 3,5, iki kenarı ≥ 0,5 × ≥ 2 — taşıyan çatı dikmesi yapının içidir) koridorun açık genişliğinde durmaz: ya kaldırım çizgisindedir (yürünmez komşu yapı karosunun kenarından ≤ 0,35) ya da yanında ≥ 2 karo açık şerit kalır (sokak ≥ 2, ara sokak direkle kapanmaz). Taban sahnede yalnız direk/ağaç yüzünden engelli karo da aynı şeridi bırakır. Üreteç: city/kerbPoles.ts (taban sahne kerbScene, semt süsü kerbPoles, sokak lambası lampSpot)."),
    T("STRUCT-OVERLAP-001", "MUST_NOT", "İki ayrı yapı iç içe girmez: bina/otel/mekân (3 × 3 tezgâh-sipariş-masa yerleşimi) ayak izleri kesişmez; simge ve mekân gövde blokları (ayak izine göre sahiplenilir) başka yapının gövdesine hacimce ≥ 0,3 (üç eksende) girmez; mekân sahipsiz bir yapı kütlesinin içine kurulmaz. Bitişme payı 0,3 altıdır."),
    T("STREET-BLOCKED-001", "MUST_NOT", "Sokak/ara sokak kanalı (≤ 3 geniş, iki yanda ≥ 3 karo) yabancı bir yapı duvarıyla (≤ 3 karo kalın) bütün eninden tıkanıp aynı hizada ardında sürmez: sokak ya bağlanır ya kasıtlı bir cepheyle biter (yalnız daralma WALK-CLEAR/CITY-SETTLE işidir)."),
    T("VENUE-CLEARANCE-001", "MUST", "Yeme-içme/etkinlik mekânı (ritüel `venue`, 3 × 3 yerleşim) büyük taşıyıcıdan (serbest duran, ≥ 3,2 boylu, kesiti 0,2–1,2, üstünde ≥ 2,5 açıklıklı güverte/kiriş taşıyan: köprü ayağı, pilon, kule ayağı) en az 2 boş karo uzaktadır (1 karo oturak geri itme + figüran payı, 1 karo yürüme koridoru)."),
  ];
}

/**
 * (ürün sahibi 2026-10-31, <city>: teleferik direğe/araziye giriyor ve F binmiyor; avlulu evler iç içe, sokaklar gezilemiyor): denetim
 * `scripts/ceo_eye_check.mjs` (`check.op = "external"`, `script: "ceo_eye_check"`); betik kimliklerini bu kayıtla iki yönlü karşılaştırır.
*/
function CEYE_CABLE_RULES(): Rule[] {
  const T = (id: string, kind: RuleKind, explanation: string) =>
    R({ id, kind, severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "external", script: "ceo_eye_check" }, repair: ["regenerate_district", "report_generator_bug"],
      tests: [], origin: "game_design", explanation });
  return [
    T("WALK-CABLE-CLEAR-001", "MUST_NOT", "Havada giden hat (teleferik, balon) araziye, yapıya, ağaca ve direğe girmez: her şehir hattında kabin kutusu 0,2 içinde hiçbir katı blokla (yüksek çözünürlüklü simge blokları dahil) kesişmez, tabanı arazinin ≥ 0,35 üstündedir, halat katı bloğa girmez; taban sahne kabini de (yürüme uyumu dahil) istasyon dışında bloğa girmez (gerekçeli muaflar yazılıdır)."),
    T("WALK-INTERACT-F-001", "MUST", "Etkileşim istemi gösteren her nesnede F onun eylemini tetikler: `hot:` kimliği tanımlayan her modülün `*Poke` işleyicisi `pokeEntity` zincirine bağlıdır, yalnız kendi kimliğine karşılık verir ve kimliği F hedef katmanında (`nearbyTier` = 0) simge bilgisinin önündedir."),
    T("CITY-SETTLE-001", "MUST_NOT", "Yerleşimde yapılar iç içe girmez, sokaklar yürünür genişliktedir: şehir planında yapı/landmark ayak izleri ve taban sahnede simge bölgeleri kesişmez; iki yanı yüksek yapı olan ≥ 3 karolu koridor ≥ 2 geniştir (mevcut dar sokaklar şehir başına dondurulmuş taban çizgisiyle; en iyi şehirde 0)."),
  ];
}

/**
 * LONDRA (ürün sahibi 2026-10-31: "teras köprüyle iç içe; dürbünde kamera binaların içinden geçiyor; saat kulesinin altı yok; kulelerde
 * merdiven portalı olmasın, asansör olsun") — kule/teras iç mekânlarının "ürün sahibi gözü" taraması, BÜTÜN şehirlerde ve iki giriş yolunda
 * (taban sahne kapısı + şehir haritası landmarkı): `scripts/ceo_eye_towers.mjs` (`check.op = "external"`; node --test
 * `ceo_eye_towers.test.mjs` çalıştırır, betik kimlikleri bu kayıtla iki yönlü karşılaştırır).
*/
function CEO_EYE_RULES(): Rule[] {
  const T = (id: string, kind: RuleKind, explanation: string) =>
    R({ id, kind, severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "external", script: "ceo_eye_towers" }, repair: ["report_generator_bug"],
      tests: [], origin: "game_design", explanation });
  return [
    T("LOOKOUT-CAM-001", "MUST_NOT", "Dürbün (manzara kipi) ve güverte takip kamerası hiçbir yönde bir katının içinde durmaz: her seyir noktasında dürbün hedefinin çevresinde 360° (24 yaw × yakınlık 0,75/1/2 × salınım uçları) kamera konumu yakın düzlem küresiyle (collide.ts `probeRadius`) hiçbir bloğa değmez (landmarkView `clearViewCam`); açık hava katında avatar gözünden 24 yönde yaylı kolun bıraktığı kamera konumu da boştadır."),
    T("TOWER-GROUND-001", "MUST", "Açık hava iç mekân katı (çan katı, seyir güvertesi, teras, tribün) havada durmaz: katın her yürünebilir karosunun altında döşemeden (y −1) panoramanın zeminine (taban iniş ya da şehir sokak yüksekliği) kadar kesintisiz katı gövde vardır (generate.ts `levelSupport`)."),
    T("PANO-FOOT-001", "MUST_NOT", "İç mekân açık hava katının ayak izi dış dünyadaki başka bir yapıyla kesişmez: panoramadaki (taban dünya, şehir silüet halkası) hiçbir zemin üstü blok katın ayak izi prizmasına (zemin + 0,36 → döşeme + 3) girmez (köprü, komşu bina, dönme dolap gövdeye ya da güverteye gömülmez; teras kendi yapısının üstünde)."),
    T("PANO-SKELETON-001", "MUST_NOT", "Yörünge (yürüme dışı) kamerası bir binayı KISMEN atmaz: dürbün ve güverte çevresi yörünge pozlarında gövde (büyük blok) bütün atılırken binanın ayak izine oturan ayak levhası/çatı/silme çizili kalmaz (\"duvarsız iskelet\", ürün sahibi 2026-11-05). Büyük blok yalnız kamera İÇİNDEYKEN bütün atılır (içindeyken bina grubu da: walk/cover.ts `orbitGroup`, `uCutGrp`); dışında yalnız kamera çevresi açılır."),
    T("LIFT-002", "MUST", "Kule/teras/çok katlı (yer altı şehri dahil; LIFT-006) iç mekânda kat değiştiren merdiven geçidi (StairLink, `stair:` öğesi) yoktur; her katta asansör durağı vardır ve her duraktan öteki bütün katlara binilir (en alt kattan doğrudan hedef kata); geçiş asansör kapısı kapanma görünümüyle (hareket azaltmada yumuşak saydamlık)."),
    // LIFTFLOOR (ürün sahibi 2026-11-01 "Galata kulesi, kule vb. yerlerin en üst seyir katına asansör çıkmıyor; birkaç kat varsa katı seçelim")
    T("LIFT-003", "MUST", "Her kule/teras/çok katlı iç mekânda en üst kat ve her açık hava seyir katı zemin kattan asansörle doğrudan ulaşılır (`LiftStop`); hiçbir güverteye yalnız merdivenle çıkılmaz."),
    T("LIFT-004", "MUST", "Çok katlı asansör kapısına binince açılan kat seçici (`interiors/liftPick.ts` `liftChoices`, `LiftPicker.tsx`) o kapının hizmet ettiği bütün katları (bulunulan kat işaretli) sunar; tek hedefli asansör seçicisiz doğrudan gider; seçici klavyeyle (rakam, ↑/↓ + Enter, Esc) ve fareyle kullanılır, odak tuzağı ve `role=\"dialog\"` taşır."),
    T("LIFT-005", "MUST", "Bütün şehirlerde her kule landmarkı (`shape: \"tower\"`) asansörlü, açık hava seyir katlı iç mekâna sahiptir (`interior: \"tower\"` + `door`); yalnız üst katı olmayan yapı (köprü pilonu, ibadet yeri, otel) gerekçeli `TOWER_NO_DECK` istisnasındadır."),
    // ( ürün sahibi "merdiven çıkışlarını kullanmayalım, asansör yapılarını kullanalım; en alt kattan gidilecek kata metrodaki gibi bir efekt ile çıksın")
    T("LIFT-006", "MUST", "Her çok katlı yerde (taban sahne + şehir haritası, istisnasız) katlar arası yol yalnız asansördür: hiçbir katta merdiven geçidi (StairLink) yok; zemin katta girişten yürüyerek asansör durağına varılır; zemin kattan duraklarla her kata gidilir ve her durağın hedef karosu yürünebilir; arayüzde asansörsüz kat atlaması (`goLevel`) yok — mini harita kat düğmesi `liftTo` ile asansöre biner; yolculuk kapı + kabin efektiyle (kat göstergesi sayar, sahne örtülü). Denetim scripts/lift_route_check.mjs."),

  ];
}

/**
 * ENTRY-DOOR (ürün sahibi 2026-11-05 "kulenin kapı girişi yok, nasıl girecek belli değil; diğer yerlerde de bak"): denetim
 * `scripts/entry_door_check.mjs` (`check.op = "external"`; node --test `.test.mjs`); ölçü `citymap/entryDoor.ts probeEntry`.
*/
function ENTRY_DOOR_RULES(): Rule[] {
  return [
    R({ id: "ENTRY-DOOR-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "external", script: "entry_door_check" }, repair: ["report_generator_bug"],
      tests: [], origin: "game_design",
      explanation: "Girilebilir her yapının (şehir simgesi, taban sahne kapısı) giriş karosunun önünde yapı yüzünde okunur bir kapı vardır: ≥ 1 m × ≥ 1,8 m açıklık (oyuk/kemer) ya da yüzden belirgin renkte kanat, önünde eşya yok, yüz karodan ≤ 3 birim; kapı yapının üslubuna uyar." }),
  ];
}

/** (ürün sahibi 2026-11-05 "aynı çizgili cephe çoğu binada"): komşu binalar aynı cephe tarifini tekrarlamaz. `scripts/facade_variety_check.mjs`; node --test `.test.mjs`.*/
function FACADE_VARIETY_RULES(): Rule[] {
  return [
    R({ id: "FACADE-VARIETY-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "external", script: "facade_variety_check" }, repair: ["report_generator_bug"],
      tests: [], origin: "game_design",
      explanation: "Şehir semtlerinde yan yana (≤ 3 karo) binalar aynı cephe tarifini (pencere ritmi, ayak kalınlığı, pencere boyu, ayak/söve türü, sokak katı, kat silmesi) tekrarlamaz: komşu çiftlerin ≤ %25'i aynı, şehirde ≥ 4 farklı tarif; şehrin mimari tipi korunur." }),
    // 001 <city>'te %1 ile geçiyordu — tarif dizgesi farklı, göze aynı (tek krem palet, tek çatı rengi)
    R({ id: "FACADE-VARIETY-002", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "external", script: "facade_variety_check" }, repair: ["report_generator_bug"],
      tests: [], origin: "game_design",
      explanation: "Yan yana (≤ 3 karo) binalar göze de aynı değildir: duvar rengi ve çatı rengi RGB uzaklığı < 30 ve aynı kat sayısı olan komşu çiftler ≤ %25 (tarifin ince farkları — ayak kalınlığı, açık/koyu söve — uzaktan okunmaz; okunan büyük yüzeyler duvar, çatı ve kat)." }),
  ];
}

/** kuş bakışında şehrin uzak LOD'u — çatısız/penceresiz kutu, havada küçük kare, meydan çevresinde boş düzlük yok. `scripts/aerial_lod_check.mjs`; node --test `.test.mjs`.*/
function AERIAL_LOD_RULES(): Rule[] {
  const T = (id: string, explanation: string) => R({ id, kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "external", script: "aerial_lod_check" },
    repair: ["report_generator_bug"], tests: [], origin: "game_design", explanation });
  return [
    T("AERIAL-LOD-001", "Her semt binasının (kaya kütlesi hariç) uzak LOD'unda (uzak halka + silüet; kuş bakışı) çatı (ayak izinin ≥ %50'si, duvar tepesinde) ve pencere (stilin cam renginde bant) var; uzun kenarı ≥ 3 binaların ≥ %60'ında pencere ritmi (bandı bölen ayak). Çizim çağrısı değişmez (aynı örneklenmiş diziler)."),
    T("AERIAL-LOD-002", "Kuş bakışında havada küçük kare yok: uzak LOD'da yerden ≥ 0,3 yüksekte başlayan küçük blok (en uzun kenar ≤ 1,5) altındaki bir bloğa oturur (direksiz fener yok); sissiz/toplamalı geçit efektleri (kapı perdesi, paspas, turnike) 24 birime kadar tam görünür, kuş bakışı uzaklığında (AIR_H − 4) sıfır."),
    T("AERIAL-LOD-003", "Uzak LOD bütçesi: parselin uzak katı yuvası (CITY_FAR_BUDGET.solid) dolmaz (sessiz düşme yok) ve şehrin uzak LOD toplamı (parıltı hariç) silüet katmanı payına (parsel × CITY_FAR_FILL) sığar."),
    R({ id: "AERIAL-LOD-004", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "external", script: "aerial_lod_check" },
      repair: ["report_generator_bug"], tests: [], origin: "game_design",
      explanation: "kuş bakışı halkasında (meydandan ≤ AIR_H + AIR_BACK) ayak izi ≥ 48 olan simgenin uzak modeli tek kutu değil: tepe payı (tepesi en yüksek noktanın ≥ %90'ında olan ayak izi alanı) ≤ 0,5. Kapsam İstanbul (pilot; uzak modeller Blender'dan üretilir: scripts/blender, farLod.gen.ts)." }),
    T("CITY-EDGE-001", "Kara şehrinde varış meydanının 44 karo çevresinde semt/meydan ve hat bandı dışındaki her 8 × 8 hücrede şehir dokusu (ada döşemesi + bina; horizon.ts cityFiller) var — meydan boş arazi önlüğünün kenarında kalmaz; dolgu yürünür alana ve hat bandına girmez."),
  ];
}

/**
 * ARRIVAL-ORIGIN (ürün sahibi 2026-10-31 "Portal geçişlerinden sonraki şehir gezi başlangıç noktaları birbirine çok benziyor"): şehir haritası
 * varış meydanının şehre özgülüğü — denetim `scripts/arrival_origin_check.mjs` (`check.op = "external"`, `script: "arrival_origin_check"`;
 * arrival_check çağırır); betik kimliklerini bu kayıtla iki yönlü karşılaştırır. Kit: citymap/arrivalKit.ts. Rapor:.
*/
function ARRIVAL_ORIGIN_RULES(): Rule[] {
  const T = (id: string, kind: RuleKind, explanation: string) =>
    R({ id, kind, severity: "error", tier: 3, scope: { scenes: "*" }, check: { op: "external", script: "arrival_origin_check" }, repair: ["regenerate_district", "report_generator_bug"],
      tests: [], origin: "game_design", explanation });
  return [
    T("ARRIVAL-ORIGIN-001", "REQUIRES", "Her şehir haritasının varış kiti var (genel şablon yok); kitin varış yönü varış bakışı kuralıyla (cityArrivalView) aynı; portaldan çıkıştaki ilk karede (takip kamerası 4,6 karo arkada, yatay yarı açı 35°) şehre özgü en az 4 öğe türü ve en az 1 simge öğesi (çeşme, metro girişi, arabacı kulübesi, torii …) var."),
    T("ARRIVAL-ORIGIN-002", "MUST_NOT", "İki şehrin varış ilk karesi birbirinin aynısı ya da çok benzeri değildir: kadraj imzası (öğe türleri + zemin dokusu + kemer tacı) Jaccard ≤ 0,25 ve kadrajdaki blokların biçim+renk hacim histogramı kosinüsü ≤ 0,5 (genel şablonda 137/210 çift birebir aynıydı)."),
    T("ARRIVAL-ORIGIN-003", "MUST_NOT", "Varış kiti oyuncuyu ve kamerayı engellemez: varış karosu ve 8 komşusu, kameranın oturduğu arka şerit (5 karo, |yan| ≤ 2) ve ortadaki görüş koridoru (5 karo, |yan| ≤ 1) engelsiz; varış karosunun gövde bandına (y < 2,2) blok girmez; meydanın yürünür karoları tek parça ve dönüş kapısına ulaşır; havada blok yok, yalnız durağan gruplar, z-titreşimi yok."),
    T("ARRIVAL-ORIGIN-004", "MUST_NOT", "Varış karosunda takip kamerası öğelere çarpmaz: 8 yaw × 2 eğimde (varsayılan, aşağı bakış) çözülen kamera göz yedeğine düşmez, takip kolu en az 2,4 birim, kamera hiçbir görünen katıya (ince direk dâhil) 0,25'ten yakın değil ve tek bir blok kadrajın %5'inden fazlasını kaplamaz (kenardaki tezgâh/pano/fener ekranın köşesini kapatmaz)."),
  ];
}

/**
 * ARRIVAL-LANDMARK: her şehrin varış meydanında şehre özgü simge (kitin en uzun `icon` öğesi) ilk karede görünür ve HUD'un
 * altında değil — denetim `scripts/arrival_landmark.mjs` (`check.op = "external"`; arrival_check çağırır). Kit: citymap/arrivalKit.ts.
*/
function ARRIVAL_LANDMARK_RULES(): Rule[] {
  const T = (id: string, kind: RuleKind, explanation: string) =>
    R({ id, kind, severity: "error", tier: 3, scope: { scenes: "*" }, check: { op: "external", script: "arrival_landmark" }, repair: ["regenerate_district", "report_generator_bug"],
      tests: [], origin: "game_design", explanation });
  return [
    T("ARRIVAL-LANDMARK-001", "REQUIRES", "Her şehrin varış meydanında şehre özgü simge (kitin en uzun simge öğesi, ≥ 3,5 karo) takip kamerasının ilk karesinde (1280 × 800 ve 1920 × 1080) görünür: kadrajın ≥ %0,8'ini kaplar, ≥ %70'i başka blok arkasında kalmaz ve HUD altında değildir (Görevler / Yakındakiler / harita / ilerleme panelleri ≤ %5, üst düğme sırası ve ipucu şeridi ≤ %25)."),
    T("ARRIVAL-LANDMARK-002", "REQUIRES", "Varış simgesinin ağırlık merkezi kadrajın yatay %20–%80 aralığında (HUD'un iki yan paneli arası) — simge kenarda ya da panelin arkasında değil."),
  ];
}

const FULL_RULES = fullRules(R, SUITE);
export const RULES: Rule[] = [
  // ---------------------------------------------------------------- 1 · temel tutarlılık
  R({ id: "CORE-UNITS-001", kind: "MUST", severity: "error", tier: 1, scope: { scenes: "*" }, check: { op: "finite_geometry" },
    repair: ["reject_world"], tests: [], 
    explanation: "Bütün blok konum/boyutları ve istasyon yükseklikleri sonlu sayı (NaN/∞ yok)." }),
  R({ id: "CORE-BOUNDS-001", kind: "MUST", severity: "error", tier: 1, scope: { scenes: "*" }, check: { op: "anchors_in_bounds" },
    repair: ["relocate_anchor", "reject_world"], tests: [], 
    explanation: "İstasyon, araç, uyku ve dinlenme karoları dünya sınırları içinde." }),
  R({ id: "CORE-ASSET-001", kind: "MUST", severity: "error", tier: 1, scope: { scenes: "*" }, check: { op: "vocabulary" },
    repair: ["fallback_to_default_pose"], tests: [], 
    explanation: "Duruş/cihaz/yatak bilinen sözlükte; istasyon 'lie' değil; uyku noktası yatak türüne uygun duruşta, cihazsız." }),
  R({ id: "CORE-PROV-001", kind: "MUST", severity: "error", tier: 1, scope: { scenes: "*" }, check: { op: "provenance_complete" },
    repair: ["report_generator_bug"], tests: SUITE, 
    explanation: "Her bölgenin köken kuralı ve şablonu var (MERKEZ: sahne; ekip/ortak: talep; olanak: hizmet oranı; avlu: topoloji)." }),
  // ---------------------------------------------------------------- 2 · fizik ve erişim
  R({ id: "CORE-COLLIDE-001", kind: "MUST_NOT", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "anchors_free" },
    repair: ["shift_decor", "relocate_anchor"], tests: [], 
    explanation: "Hiçbir istasyon/araç/uyku/dinlenme karosu engelli karoda değil (mobilya ajanın üstünde değil)." }),
  R({ id: "CORE-SUPPORT-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "anchors_supported" },
    repair: ["add_deck", "relocate_anchor"], tests: [], 
    explanation: "Her ajan karosunun altında zemin, güverte ya da iskele tahtası var (çıplak suda/boşlukta durulmaz)." }),
  R({ id: "CORE-ACCESS-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "anchors_reachable" },
    repair: ["shift_decor", "open_gate", "relocate_anchor"], tests: [], 
    explanation: "Her istasyon, araç, uyku ve dinlenme karosuna MERKEZ'den yürünerek ulaşılır." }),
  R({ id: "GROW-TOPO-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*", grownOnly: true }, check: { op: "district_connected" },
    repair: ["open_gate", "add_walkway", "reject_plan"], tests: [], 
    explanation: "Her yeni bölge mevcut dünyaya yürünebilir bağlantıyla eklenir (kopuk bölge yok)." }),
  R({ id: "GROW-ROAD-001", kind: "REQUIRES", severity: "error", tier: 2, scope: { scenes: "*", grownOnly: true }, check: { op: "roads_walkable" },
    repair: ["shift_decor", "reject_plan"], tests: SUITE, 
    explanation: "Bölgeler arası sokak ağı (yerel lj 0 satırı, li 0 sütunu) yürünebilir; yalnız ilk sıradaki dış duvar istisna." }),
  R({ id: "SHORE-TOPO-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "water_not_walkable" },
    repair: ["block_water_tile", "add_pier"], tests: [], 
    explanation: "Kara/su ayrımı: su karoları yürünemez; üstünde yürünen su karosunda iskele/güverte tahtası var." }),
  R({ id: "SLEEP-BODY-001", kind: "MUST_NOT", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "sleep_body_clearance" },
    repair: ["shift_sleeper", "lounge_instead_of_lie"], tests: [], 
    explanation: "Yatan ajan ~1,5 karo (karonun ortasında): iki 'lie' uyku noktası gövde ekseninde bitişik olamaz (baş-ayak iç içe geçer). Yataklar da 1,5 karo boyundadır." }),
  R({ id: "LEVEL-ACCESS-001", kind: "REQUIRES", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "level_access" },
    repair: ["add_connector", "make_enclosed", "remove_upper_level"], tests: [], 
    explanation: "Açık üst kat (galeri, asma kat, otopark katı) aynı bölgede merdiven/yürüyen merdiven/asansör/rampa ya da kapalı kat kulesiyle bağlı; bağlantının ayağı erişilebilir." }),
  R({ id: "LEVEL-GROUND-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "anchors_ground_level" },
    repair: ["relocate_anchor"], tests: [], 
    explanation: "Yürünebilirlik kararı (a): bütün ajan karoları zemin katta (oturak yüksekliği < 1 kat). Tasarım (b) gelene dek." }),
  R({ id: "CORE-BUDGET-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "block_budget", base: 6000, perBay: 1500, bigBase: 12000 },
    repair: ["reduce_decor_density"], tests: SUITE, origin: "engine_constraint",
    explanation: "Taban sahne ≤ 6000 blok (dünya dosyası sınırı; CITY-BIG: çekirdekli büyük şehir tabanı, ör. 36×32, ≤ 12000); bölge başına ortalama ≤ 1500 blok (örneklenmiş çizim bütçesi)." }),
  // ---------------------------------------------------------------- 3 · oyun politikası ve sahne mantığı
  R({ id: "BATTLE-POLICY-001", kind: "MUST_NOT", severity: "error", tier: 3,
    scope: { scenes: ["office", "park", "home", "beach", "cafe", "camp", "mall", "school", "sea", "yacht", "space", "snow", ...PILOT_SCENES] },
    check: { op: "no_objects", types: ["sandbags"] }, repair: ["remove_object"], tests: SUITE, 
    explanation: "Tatbikat (savaş sahası) öğeleri barışçıl sahnelere taşınmaz." }),
  R({ id: "CORE-FIRE-001", kind: "MUST_NOT", severity: "error", tier: 3,
    scope: { scenes: ["office", "home", "cafe", "mall", "school", "space", "yacht", ...FULL_NO_FLAME_SCENES] }, check: { op: "no_flame" },
    repair: ["replace_with_lamp"], tests: [], 
    explanation: "Kapalı mekânda ve uzay üssünde açık ateş yok." }),
  R({ id: "HOME-FIRE-001", kind: "ALLOWS", severity: "warning", tier: 3, scope: { scenes: ["home"] }, overrides: "CORE-FIRE-001",
    repair: [], tests: [], explanation: "Evde şömine izinlidir (açık istisna; izlenebilir override)." }),
  R({ id: "OFFICE-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["office"] },
    check: { op: "no_objects", types: ["tent", "sun_lounger", "palm"] }, repair: ["remove_object"], tests: SUITE,
    explanation: "Ofiste çadır, şezlong, palmiye yok." }),
  R({ id: "PARK-DESK-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["park"] },
    check: { op: "no_objects", types: OUTDOOR_NO_OFFICE }, repair: ["substitute_bench"], tests: [], 
    explanation: "Parkta sabit ofis masası, monitör, ofis sandalyesi, sunucu yok (rehberde DISCOURAGES; 'normal_public_park + dedicated_office_desk' çakışması sert kurala derlenir)." }),
  R({ id: "HOME-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["home"] },
    check: { op: "no_objects", types: ["server_rack", "sun_lounger", "tent"] }, repair: ["remove_object"], tests: SUITE,
    explanation: "Evde sunucu dolabı, şezlong, çadır yok." }),
  R({ id: "BEACH-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["beach"] },
    check: { op: "no_objects", types: OUTDOOR_NO_OFFICE }, repair: ["substitute_lounger"], tests: [], 
    explanation: "Sahilde ofis masası, masa lambası, sunucu yok." }),
  R({ id: "CAFE-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["cafe"] },
    check: { op: "no_objects", types: ["server_rack", "tent", "sun_lounger"] }, repair: ["remove_object"], tests: SUITE,
    explanation: "Kafede sunucu odası, çadır, şezlong yok." }),
  R({ id: "CAMP-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["camp"] },
    check: { op: "no_objects", types: [...OUTDOOR_NO_OFFICE, "sofa"] }, repair: ["substitute_log"], tests: SUITE,
    explanation: "Kampta ofis masası, monitör, kanepe yok." }),
  R({ id: "MALL-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["mall"] },
    check: { op: "no_objects", types: ["tent", "sun_lounger", "palm"] }, repair: ["remove_object"], tests: SUITE, 
    explanation: "AVM'de çadır, şezlong, palmiye yok (konut yalnız açık mixed_use ile — VoxCrew'da yok)." }),
  R({ id: "SCHOOL-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["school"] },
    check: { op: "no_objects", types: ["sun_lounger", "palm", "tent"] }, repair: ["remove_object"], tests: SUITE,
    explanation: "Okulda şezlong, palmiye, çadır yok." }),
  R({ id: "BATTLE-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["battlefield"] },
    check: { op: "no_objects", types: ["sun_lounger", "palm", "nap_pod"] }, repair: ["remove_object"], tests: SUITE,
    explanation: "Tatbikat alanında şezlong, palmiye, şekerleme kapsülü yok." }),
  R({ id: "SEA-LAND-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["sea"] },
    check: { op: "no_objects", types: [...OUTDOOR_NO_OFFICE, "car"] }, repair: ["remove_object"], tests: [], 
    explanation: "Açık denizde kara aracı ve ofis masası yok." }),
  R({ id: "YACHT-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["yacht"] },
    check: { op: "no_objects", types: ["server_rack", "car", "tent", "tree"] }, repair: ["remove_object"], tests: SUITE,
    explanation: "Yatta/marinada sunucu, araba, çadır, ağaç yok." }),
  R({ id: "SPACE-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["space"] },
    check: { op: "no_objects", types: ["tree", "palm", "tent", "sun_lounger", "car", "hammock"] }, repair: ["remove_object"], tests: SUITE, 
    explanation: "Uzay üssünde ağaç, palmiye, çadır, şezlong, araba, hamak yok (atmosfer/yerçekimi varsayımı kopyalanmaz)." }),
  R({ id: "SNOW-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["snow"] },
    check: { op: "no_objects", types: ["sun_lounger", "palm", "umbrella"] }, repair: ["remove_object"], tests: SUITE, 
    explanation: "Karlı köyde şezlong, palmiye, plaj şemsiyesi yok (tropik kurallar uygulanmaz)." }),
  R({ id: "OUTDOOR-DEVICE-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["park", "beach", "camp", "sea", ...FULL_OUTDOOR_DEVICE_SCENES] },
    check: { op: "station_devices", deny: ["desktop"] }, repair: ["substitute_laptop"], tests: SUITE, 
    explanation: "Açık hava sahnelerinde masaüstü bilgisayar istasyonu yok (dizüstü/tablet)." }),
  R({ id: "BEACH-ZONE-001", kind: "REQUIRES", severity: "error", tier: 3, scope: { scenes: ["beach", "sea", "yacht"] },
    check: { op: "objects_on", types: ["sun_lounger", "car", "tent"], surface: "land", minShare: 1 }, repair: ["relocate_to_dry_land"], tests: [], 
    explanation: "Şezlong, araba, çadır kuru zeminde ya da güvertede (su karosunda değil)." }),
  R({ id: "BEACH-VESSEL-001", kind: "REQUIRES", severity: "error", tier: 3, scope: { scenes: "*" },
    check: { op: "objects_on", types: ["boat"], surface: "water", minShare: 0.5 }, repair: ["relocate_to_navigable_water", "remove_unfulfillable_vessel"], tests: [], 
    explanation: "Tekne/yat ayak izinin en az yarısı su (kuma ya da karaya oturmuş tekne yok)." }),
  R({ id: "YACHT-WATER-001", kind: "REQUIRES", severity: "error", tier: 3, scope: { scenes: ["yacht", "sea"], grownOnly: true },
    check: { op: "water_districts", minShare: 0.15 }, repair: ["regenerate_as_marina"], tests: SUITE, 
    explanation: "Yat/deniz büyümesi marinadır: her çalışma bölgesinde su (≥ %15 karo) ve bağlı tekneler var." }),
  R({ id: "GROW-ECO-001", kind: "REQUIRES", severity: "error", tier: 3, scope: { scenes: "*" }, check: { op: "ambient_habitat" },
    repair: ["move_hook_to_habitat", "drop_hook"], tests: [], 
    explanation: "Canlı ortam kancaları habitatında: gölet/deniz kancası suya (ya da donmuş göle) yakın (balık, ördek, yunus, penguen), kum/çim kancası karada; S46: balık tutma yeri (`fish`) yürünebilir, erişilebilir ve suya bakar, oyun masası (`play`) engelli ve iki ucu yürünebilir." }),
  R({ id: "ADJ-POLICY-001", kind: "DISCOURAGES", severity: "warning", tier: 3, scope: { scenes: "*", grownOnly: true }, check: { op: "annex_adjacency" },
    repair: ["choose_compatible_annex", "add_transition_zone"], tests: [], 
    explanation: "Büyüme teması taban sahneyle uyumsuz komşuluk (ör. karlı köy + sahil, tatbikat + okul) uyarı verir." }),
  // ---------------------------------------------------------------- 4 · ajan görevi
  R({ id: "AGENT-RESV-001", kind: "MUST_NOT", severity: "error", tier: 4, scope: { scenes: "*" }, check: { op: "exclusive_slots" },
    repair: ["dedupe_anchor"], tests: [], 
    explanation: "Aynı karoda iki istasyon ya da iki uyku noktası yok; uyku noktası istasyon/dinlenme/araç karosuyla çakışmaz." }),
  R({ id: "AGENT-ROLE-001", kind: "MUST", severity: "error", tier: 4, scope: { scenes: "*", grownOnly: true }, check: { op: "role_separation" },
    repair: ["reassign_seats"], tests: SUITE, 
    explanation: "Ekip koltukları yalnız o ekibin bölgelerinde; misafir/harici oturum koltukları MERKEZ ve ortak çalışmada." }),
  R({ id: "PARK-WORK-001", kind: "REQUIRES", severity: "error", tier: 4, scope: { scenes: ["park"] },
    check: { op: "laptop_work", poses: ["sit_bench", "sit_ground", "lounge"], minShare: 1 }, repair: ["select_reachable_seating_slot"], tests: [], 
    explanation: "Parkta her istasyon dizüstü/tablet ile bank, örtü ya da şezlongda." }),
  R({ id: "BEACH-WORK-001", kind: "REQUIRES", severity: "error", tier: 4, scope: { scenes: ["beach"] },
    check: { op: "laptop_work", poses: ["lounge", "stand", "sit_ground"], minShare: 1 }, repair: ["select_lounger"], tests: SUITE, 
    explanation: "Sahilde istasyonlar şezlong (ya da plaj barında ayakta) — masa varsayımı yok." }),
  R({ id: "CAMP-WORK-001", kind: "REQUIRES", severity: "error", tier: 4, scope: { scenes: ["camp"] },
    check: { op: "laptop_work", poses: ["sit_bench", "sit_chair", "sit_ground"], minShare: 1 }, repair: ["select_log_seat"], tests: SUITE,
    explanation: "Kampta dizüstü kütükte/kamp sandalyesinde." }),
  R({ id: "BEACH-LOUNGE-001", kind: "REQUIRES", severity: "error", tier: 4, scope: { scenes: ["beach"] },
    check: { op: "has_objects", types: ["sun_lounger"], min: 4, where: "base" }, repair: ["add_compatible_seating"], tests: SUITE, 
    explanation: "Sahil tabanında şezlong var (dinlenme ve dizüstü işi)." }),
  R({ id: "BEACH-LOUNGE-002", kind: "REQUIRES", severity: "error", tier: 4, scope: { scenes: ["beach"], grownOnly: true },
    check: { op: "has_objects", types: ["sun_lounger"], min: 4, where: "work_districts" }, repair: ["add_compatible_seating"], tests: SUITE,
    explanation: "Sahil büyümesinde her çalışma bölgesi şezlong sıralarıdır." }),
  R({ id: "YACHT-BOAT-001", kind: "REQUIRES", severity: "error", tier: 4, scope: { scenes: ["yacht", "sea"], grownOnly: true },
    check: { op: "has_objects", types: ["boat"], min: 1, where: "work_districts" }, repair: ["moor_boat"], tests: SUITE, 
    explanation: "Marina bölgelerinde her ekip pod'u bağlı bir teknedir (en az bir tekne)." }),
  R({ id: "TOOL-SPOT-001", kind: "REQUIRES", severity: "error", tier: 4, scope: { scenes: "*" },
    check: { op: "tool_spots", kinds: ["web", "read", "plan", "shell"] }, repair: ["add_tool_spot"], tests: [], 
    explanation: "Araç noktaları: taban sahnede ve her çalışma bölgesinde web, okuma, plan ve kabuk noktası var (ajan aracına göre yürür)." }),
  R({ id: "SCENE-POSE-001", kind: "MUST_NOT", severity: "error", tier: 4, scope: { scenes: "*" },
    check: { op: "station_poses", allow: ["sit_chair", "sit_bench", "sit_ground", "lounge", "stand"] }, repair: ["fallback_to_default_pose"], tests: SUITE, 
    explanation: "Çalışma istasyonları çalışma duruşunda (yatarak çalışılmaz)." }),
  R({ id: "AQUA-PREF-001", kind: "PREFERS", severity: "warning", tier: 6, scope: { scenes: ["office", "home", "cafe", "school", "mall"] },
    check: { op: "has_hooks", kinds: ["aquarium"], min: 1 }, repair: ["add_aquarium"], tests: [], 
    explanation: "İç mekân sahnelerinde canlı ortam için en az bir akvaryum (`aquarium` kancası; balıkları S43 yüzdürür)." }),
  // ---------------------------------------------------------------- S46 · görsel denetim
  R({ id: "TEAM-CONTIG-001", kind: "MUST", severity: "error", tier: 3, scope: { scenes: "*", grownOnly: true }, check: { op: "team_contiguous" },
    repair: ["replan_snake_order"], tests: [], 
    explanation: "Bir ekibin bütün bölgeleri (ve ortak çalışma bölgeleri) kenar komşuluğuyla tek parça: ekip dünyanın iki ucuna dağılmaz." }),
  R({ id: "DIST-ADJ-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: "*", grownOnly: true }, check: { op: "district_adjacency" },
    repair: ["swap_amenity_template"], tests: [], 
    explanation: "Komşuluk matrisi: uyku bölgesi (yatakhane, kulübe, hamak korusu, koğuş…) gürültülü bölgeye (mutfak, yemek katı, spor sahası, otopark…) kapı komşusu değil." }),
  R({ id: "DIST-CLONE-001", kind: "MUST_NOT", severity: "error", tier: 6, scope: { scenes: "*", grownOnly: true }, check: { op: "district_clone" },
    repair: ["vary_template", "use_unused_amenity"], tests: [], 
    explanation: "Yan yana iki olanak/avlu birebir kopya değil (aynı avlunun sıra sıra tekrarı yok)." }),
  R({ id: "SEAM-WATER-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "seam_water" },
    repair: ["continue_shoreline", "add_coast_strip"], tests: [], 
    explanation: "Su (deniz, gölet) bölge sınırında düz bir çizgiyle kesilmez: sınırda ≥ 3 karo boyunca açık su ile kuru kara karşılaşmaz (sahil denizi büyüyen dünyada kıyı şeridiyle sürer)." }),
  R({ id: "DIST-DENSITY-001", kind: "DISCOURAGES", severity: "error", tier: 6, scope: { scenes: "*", grownOnly: true },
    check: { op: "district_density", maxPlain: 0.7, open: ["dist_sportsfield", "dist_skating", "dist_volley", "dist_parking", "dist_launchpad", "dist_training",
      /* HOTEL-SYS (E1): büyüme oteli bilerek küçük kabuk + önünde meydan (HOTEL-SCALE-001; bölge planlayıcının sabit modül boyunda) */ "dist_hotel"] },
    repair: ["add_decor", "add_path"], tests: [], 
    explanation: "Bölgede üstü boş, engelsiz düz zemin ≤ %70 (yol satırı/sütunu hariç; spor sahası, buz pisti, otopark gibi açık-tasarım alanlar ve küçük kabuk + meydan olan büyüme oteli `dist_hotel` muaf)." }),
  R({ id: "SEAT-FACE-001", kind: "REQUIRES", severity: "error", tier: 4, scope: { scenes: "*" }, check: { op: "station_faces_furniture" },
    repair: ["rotate_station", "add_table"], tests: [], 
    explanation: "Masada/tezgâhta çalışan istasyon (sit_chair, stand) mobilyaya bakar: masasız sandalye, boşluğa bakan ayakta çalışma yok." }),
  R({ id: "SLEEP-ZONE-001", kind: "MUST_NOT", severity: "error", tier: 4, scope: { scenes: "*" }, check: { op: "sleep_apart_from_work" },
    repair: ["move_sleeper_to_rest_strip"], tests: [], 
    explanation: "Uyku noktası çalışma istasyonuna bitişik değil (çalışma sırasının ortasında yatak yok)." }),
  // ---------------------------------------------------------------- SP-W0 · sahne paketleri
  R({ id: "SACRED-ANCHOR-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: "*" }, check: { op: "sacred_anchors" },
    repair: ["relocate_anchor", "shrink_zone"], tests: [],
    origin: "research_informed",
    explanation: "Sacred bölgede (ibadet yerinin ayak izi + tamponu, varsayılan 1 karo) istasyon, uyku, dinlenme, araç ya da kahve noktası yok; bölge dünya içinde." }),
  R({ id: "SACRED-FUN-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: "*" },
    check: { op: "sacred_fun", margin: 3, kinds: ["play", "fish"] }, repair: ["move_fun_site", "drop_hook"], tests: [],
    origin: "research_informed",
    explanation: "Sacred bölgenin ayak izine 3 karo (ya da daha geniş tamponu) içinde eğlence yeri (oyun masası, olta) yok. Çalışma anında S48 beyni aynı alanda eğlence, şaka ve şakşak başlatmaz (isInSacredBuffer)." }),
  R({ id: "SACRED-AMBIENT-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: "*" }, check: { op: "sacred_ambient" },
    repair: ["drop_hook", "move_hook_outside_zone"], tests: [],
    origin: "research_informed",
    explanation: "Sacred bölgede (tampon dahil) canlı ortam kancası yok: kedi tırmanmaz, kuş konmaz, ambient şaka yok (uçan kuşlar geçebilir). Dinî ses (ezan, çan, dua) hiçbir sahnede çalınmaz; ses kataloğunda yok." }),
  R({ id: "SCENE-MOVER-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "mover_budget", max: 12, boxes: 400 },
    repair: ["drop_mover"], tests: [], origin: "engine_constraint",
    explanation: "Hareketli set parçaları (vapur, tramvay, zeplin, balon…) ≤ 12 nesne ve ≤ 400 kutu; yol noktaları sonlu, süre pozitif (tek örneklenmiş dizi, +1 çizim çağrısı)." }),
  R({ id: "SCENE-BACKDROP-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "backdrop_budget", max: 1200, bigMax: 1600 },
    repair: ["reduce_backdrop", "move_backdrop_off_grid"], tests: [],
    origin: "engine_constraint",
    explanation: "Ufuk silüeti (backdrop) ≤ 1200 blok ve tamamen dünya ızgarasının dışında (yürünmez arka plan; simge yapılar burada)." }),
  R({ id: "SCENE-BACKDROP-002", kind: "MUST", severity: "error", tier: 6, scope: { scenes: "*" }, check: { op: "backdrop_ground", report: 6 },
    repair: ["ground_backdrop", "move_backdrop_closer"], tests: [],
    origin: "engine_constraint",
    explanation: "Ufuk silüetindeki her yapı zemine oturur: tabanın kenarına (≤ 0,6 birim), sahne okyanusuna ya da bunlara dayanan bir blok zincirine (zemin levhaları yan yana, yapılar üst üste) bağlıdır. Tabandan boşlukla ayrılmış ufuk şeridi ya da altında zemin olmayan tek başına kule yok (genel bakışta gökte asılı görünür). Işık/cam süsleri ve küçük parçalar (< 0,6 birim) sayılmaz." }),
  R({ id: "SCENE-RISK-001", kind: "REQUIRES", severity: "error", tier: 3, scope: { scenes: "*" }, check: { op: "scene_risk", max: 2 },
    repair: ["score_scene", "legal_or_culture_review", "drop_scene"], tests: [], origin: "research_informed",
    explanation: "Şehir/premium sahnede ip_risk ve culture_risk (0–3) yazılı; 3 yayınlanmaz. 2 yalnız yazılı inceleme notuyla yayınlanır (PR şablonu), ≤ 1 öz-denetimle." }),
  // ---------------------------------------------------------------- SP-W1 · pilot şehirler (İstanbul, <city>, Gökyüzü Adası)
  // W3a-INT: <city> şezlong istasyonları <city>-WORK-001 ile (aynı kural + lounge)
  R({ id: "CITY-WORK-001", kind: "REQUIRES", severity: "error", tier: 4, scope: { scenes: CITY_SCENES.filter((s) => !FULL_CITY_WORK_OWN.includes(s)) },
    check: { op: "laptop_work", poses: ["sit_chair", "sit_bench", "sit_ground", "stand"], minShare: 1 }, repair: ["select_city_work_spot", "substitute_laptop"],
    tests: [], 
    explanation: "Şehirde iş, şehre doğal yerlerde dizüstü/tablet ile: kafe ya da çay bahçesi masası (sit_chair), ortak çalışma çatı katı (sit_chair), park/iskele bankı (sit_bench), rıhtım kenarı (sit_ground), pazar tezgâhı (stand). Masaüstü bilgisayar istasyonu yok." }),
  R({ id: "ISTANBUL-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["istanbul"] },
    check: { op: "no_objects", types: ["server_rack", "tent", "sun_lounger", "palm", "sandbags"] }, repair: ["remove_object"], tests: [],
    explanation: "İstanbul'da sunucu dolabı, çadır, şezlong, palmiye, kum torbası yok (şehir sokağı, rıhtım ve çay bahçesi)." }),
  ...FULL_RULES.a,
  R({ id: "LONDRA-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["londra"] },
    check: { op: "no_objects", types: ["server_rack", "tent", "sun_lounger", "palm", "sandbags"] }, repair: ["remove_object"], tests: [],
    explanation: "Londra'da sunucu dolabı, çadır, şezlong, palmiye, kum torbası yok (tuğla sokak, pub terası, park ve rıhtım; park şemsiyesi serbest)." }),
  R({ id: "KAPADOKYA-FORBID-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: ["kapadokya"] },
    check: { op: "no_objects", types: ["server_rack", "sun_lounger", "palm", "sandbags", "boat", "car"] }, repair: ["remove_object"], tests: [],
    explanation: "Kapadokya'da sunucu dolabı, şezlong, palmiye, kum torbası, tekne, araba yok (tüf vadisi, bağ, mağara oteli)." }),
  ...FULL_RULES.b,
  // ---------------------------------------------------------------- RING-INT · simge çekirdeği ve halka büyüme
  R({ id: "CITY-CORE-001", kind: "MUST", severity: "error", tier: 3, scope: { scenes: "*" }, check: { op: "city_core", maxOffset: 0.15 },
    repair: ["ring_layout", "move_core_to_centre", "move_district_out_of_core"], tests: [],
    origin: "game_design",
    explanation: "Çekirdekli (`SceneDef.core`) sahnede simge çekirdeği her ölçekte dünyanın ortasında kalır: çekirdeğin ağırlık merkezi dünya merkezinden her eksende en çok %15 (dünya genişliği/derinliğine göre) uzakta; hiçbir büyüme bölgesi ya da bölge bloğu çekirdek dikdörtgenine girmez (kenardaki ≤ 0,4 birimlik tente, saçak ya da ağaç tacı taşması hariç). Çekirdek taban ızgarasının içinde, tam sayı karolu. CITY-BIG: taban birden çok bölge olabilir (ör. 36×32 = 3×2 bölge); boyutu bölge katı (12×16) ve konumu bölge ızgarasında olmalı (`CORE_BASE_NOT_BAYS`)." }),
  R({ id: "CITY-LANDMARK-001", kind: "REQUIRES", severity: "error", tier: 3, scope: { scenes: "*" }, check: { op: "city_landmark" },
    repair: ["add_landmark_zone", "move_landmark_into_core"], tests: [],
    origin: "game_design",
    explanation: "Çekirdekli şehir sahnesinde en az bir `landmark` bölgesi (sahnenin kahraman simgesi; ör. kafes kule, saat kulesi, kubbe) tümüyle çekirdeğin içindedir — simge ufukta küçük silüet değil, sahnenin merkezindedir." }),
  // ---------------------------------------------------------------- W2 (WALK-INT) · yürüme modu
  R({ id: "WALK-SPAWN-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "walk_spawn" },
    repair: ["move_spawn_to_main_component", "open_path"], tests: [],
    origin: "engine_constraint",
    explanation: "Yürüme modunun doğma karosu (`spawnTile`: çekirdeğin önü, yoksa ilk dinlenme karosu, yoksa taban merkezi) yürünebilir, istasyon değil ve ana bileşende; bütün istasyonlar (karosu ya da bir komşusu) doğmadan yürünerek ulaşılabilir." }),
  R({ id: "WALK-BOARD-001", kind: "REQUIRES", severity: "error", tier: 4, scope: { scenes: "*" }, check: { op: "walk_board" },
    repair: ["add_output_board", "use_coffee_or_rest_spot"], tests: [],
    origin: "game_design",
    explanation: "Her sahnede doğmadan ulaşılabilir bir çıktı panosu ya da eşdeğeri (`boardSpot`: duvar panosu, yoksa kahve makinesi önü, yoksa dinlenme karosu) var; avatar orada durup çıktıları inceler." }),
  R({ id: "WALK-SACRED-001", kind: "MUST_NOT", severity: "error", tier: 3, scope: { scenes: "*" }, check: { op: "walk_sacred", n: 5 },
    repair: ["reseed_souvenirs", "move_out_of_sacred_buffer"], tests: [],
    origin: "game_design",
    explanation: "Hatıra yerleri (`souvenirSpots`, taban sahnede belirlenimci; büyümüş dünyaya kaydırılır) tam 5 tane, farklı, yürünebilir, ulaşılabilir; çapa/kanca karosunda değil ve kutsal bölgenin eğlence payı (3 karo) dışında — kutsal bölgede hatıra ve mini oyun yok." }),
  R({ id: "WALK-COVER-001", kind: "MUST", severity: "error", tier: 2, scope: { scenes: "*" }, check: { op: "walk_cover", minY: 2.2 },
    repair: ["raise_roof", "lower_cut_height"], tests: [],
    origin: "engine_constraint",
    explanation: "Örtü ızgarasında (`coverGrid`) her örtülü karonun çatı tabanı kafa yüksekliğinin (2,2) üstünde: kesit gölgelendiricisi avatarın bulunduğu katı kesmez, yalnızca tavan ve üstünü açar." }),
  // ---------------------------------------------------------------- EXP (E1c) · çevre arazisi
  // Denetim gövdesi `rules/engine.ts`'te değil `scripts/expanse_check.mjs`'tedir (çevre parselleri `Built`'in dışında; 25 sahne ×
  // 5 ölçek × yarıçap 4 + akış ve avatar benzetimi). expanse_check kendi kural kimliklerini bu kayıtla karşılaştırır (iki yön).
  ...EXPANSE_RULES(),
  // ---------------------------------------------------------------- · şehir haritası
  ...CITY_MAP_RULES(),
  // ---------------------------------------------------------------- TOUR-VIEW · gezi görüş mesafesi (scripts/tour_check.mjs)
  ...TOUR_RULES(),
  ...LWALK_RULES(), // LANDMARK-WALK
  ...CEYE_RULES(),
  ...WALKFLOW_RULES(),
  ...CEYE_CABLE_RULES(), // (2026-10-31)
  ...CEO_EYE_RULES(), // LONDRA: kule/teras ürün sahibi gözü
  ...ENTRY_DOOR_RULES(), // giriş kapısı okunur
  ...FACADE_VARIETY_RULES(), // komşu cepheler tekrarlamaz
  ...AERIAL_LOD_RULES(), // kuş bakışı uzak LOD
  ...ARRIVAL_ORIGIN_RULES(), // ARRIVAL-ORIGIN
  ...ARRIVAL_LANDMARK_RULES(), // ARRIVAL-LANDMARK
  // ---------------------------------------------------------------- 5 · kapasite
  R({ id: "SLEEP-CAP-001", kind: "SCALES_WITH", severity: "error", tier: 5, scope: { scenes: "*" },
    check: { op: "sleep_capacity", base: 8, ratio: 0.5, perWorkBay: 8 }, repair: ["add_sleeper_row", "add_dorm_amenity"], tests: SUITE, 
    explanation: "Uyku kapasitesi: tabanda ≥ 8; büyümüş dünyada ≥ istasyonların %50'si ve her çalışma bölgesinde ≥ 8 (ön şerit; AVM/okulda dinlenme köşesi). GROWTH (2026-10-28): otel temalı şehirlerde bölge başına 8 yatak bölgenin ön şeridinde değil otellerde aranır (otel yatakları ≥ 8 × çalışma bölgesi). HOTEL-SYS (E1, 2026-10-29): otel/konak kapısı geçidi (`bed: \"hotel\"`) sanal kapasitedir (ajan sayısıyla ölçeklenir) — geçit varsa kapasite karşılanmış sayılır." }),
  R({ id: "SLEEP-HOTEL-001", kind: "MUST", severity: "error", tier: 5, scope: { scenes: "*", grownOnly: true }, check: { op: "sleep_in_hotel", every: 3, minY: 2.2 },
    repair: ["add_hotel", "move_bed_indoors"], tests: [], 
    origin: "game_design",
    explanation: "ürün sahibi 2026-10-28/29 (HOTEL-SYS E1): şehir başına TEK otel (taban sahnede `hotel` bölgesi ya da tabanı otelsizse büyümede tek `dist_hotel`); uyku yalnız otel kapısı geçidinde (`bed: \"hotel\"`), büyüme bölgelerinde açık hava yatağı yok. Eski geçitsiz otelde: uyku noktası otel içinde ve üstü kapalı (çatı tabanı ≥ 2,2). Ölçek ve açık yatak: realism_check HOTEL-SCALE-001 / SLEEP-OPEN-001." }),
  R({ id: "SLEEP-BED-001", kind: "REQUIRES", severity: "warning", tier: 5, scope: { scenes: "*" }, check: { op: "sleep_beds", allow: [] },
    repair: ["substitute_bed"], tests: SUITE,
    explanation: "Uyku yüzeyi sahneye uygun (katalog `beds`; ör. uzayda hamak yok, karlı köyde şezlong yok)." }),
  R({ id: "GROW-DEMAND-001", kind: "MUST", severity: "error", tier: 5, scope: { scenes: "*" }, check: { op: "growth_matches_demand" },
    repair: ["reuse_existing_capacity", "reject_plan"], tests: [], 
    explanation: "Yapı artışı gerçek koltuk açığından: ajanlar MERKEZ'e sığıyorsa büyüme yok; ekip bölgesi koltuğu ≥ ekip ve boşluk < 1 pod; misafir bölgesi yalnız MERKEZ taşınca." }),
  R({ id: "GROW-INFRA-001", kind: "REQUIRES", severity: "error", tier: 5, scope: { scenes: "*", grownOnly: true }, check: { op: "service_ratio" },
    repair: ["add_amenity"], tests: SUITE, 
    explanation: "Hizmet altyapısı yoğunlukla büyür: ilk çalışma çiftinden sonra her 2 çalışma bölgesine ≥ 1 olanak (⌊(n−1)/2⌋) ve her olanakta mola/dinlenme noktası." }),
];

// ------------------------------------------------------------------ derleme (kimlik, sürüm, öncelik, çakışma)
export interface CompiledRegistry { rules: Rule[]; byId: Map<string, Rule>; problems: string[] }

const SEMVER = /^\d+\.\d+\.\d+$/;
const ID = /^[A-Z]+(-[A-Z]+)*-\d{3}$/;

export function inScope(r: Rule, scene: WorldSceneId): boolean {
  return r.scope.scenes === "*" || r.scope.scenes.includes(scene);
}

/** Kayıt derlemesi: kimlik biçimi/tekilliği, semver, ALLOWS hedefi ve öncelik katmanı, yasak ↔ zorunlu nesne çakışması. */
export function compileRegistry(rules: Rule[] = RULES, scenes: WorldSceneId[] = []): CompiledRegistry {
  const problems: string[] = [];
  const byId = new Map<string, Rule>();
  for (const r of rules) {
    if (!ID.test(r.id)) problems.push(`${r.id}: kimlik biçimi`);
    if (byId.has(r.id)) problems.push(`${r.id}: yinelenen kimlik`);
    if (!SEMVER.test(r.version)) problems.push(`${r.id}: sürüm semver değil`);
    if (r.kind === "ALLOWS" ? !r.overrides : !r.check) problems.push(`${r.id}: ${r.kind === "ALLOWS" ? "overrides" : "check"} eksik`);
    if (!r.tests.length) problems.push(`${r.id}: test yok`);
    byId.set(r.id, r);
  }
  for (const r of rules) {
    if (r.kind !== "ALLOWS") continue;
    const target = byId.get(r.overrides!);
    if (!target) { problems.push(`${r.id}: bilinmeyen hedef ${r.overrides}`); continue; }
    if (r.tier > target.tier) problems.push(`${r.id}: katman ${r.tier} > hedef ${target.id} katmanı ${target.tier} (düşük öncelikli istisna)`);
    if (r.scope.scenes !== "*" && target.scope.scenes !== "*" && !r.scope.scenes.some((s) => (target.scope.scenes as WorldSceneId[]).includes(s)))
      problems.push(`${r.id}: kapsamı hedefle kesişmiyor`);
  }
  // yasak ↔ gerekli çakışması (aynı sahne, aynı tür)
  const allScenes = scenes.length ? scenes : [...new Set(rules.flatMap((r) => (r.scope.scenes === "*" ? [] : r.scope.scenes)))];
  for (const s of allScenes) {
    const banned = new Map<string, string>(), needed = new Map<string, string>();
    for (const r of rules) {
      if (!inScope(r, s) || !r.check) continue;
      if (r.check.op === "no_objects") for (const t of r.check.types) banned.set(t, r.id);
      if (r.check.op === "has_objects") for (const t of r.check.types) needed.set(t, r.id);
    }
    for (const [t, id] of needed) if (banned.has(t)) problems.push(`çakışma (${s}): ${id} '${t}' ister, ${banned.get(t)} yasaklar`);
  }
  return { rules, byId, problems };
}

/** Bir sahnede etkin kurallar, öncelik sırasıyla (katman, sonra kimlik); ALLOWS ile geçersiz kılınanlar çıkarılır. */
export function activeRules(scene: WorldSceneId, rules: Rule[] = RULES): { active: Rule[]; overridden: { rule: string; by: string }[] } {
  const scoped = rules.filter((r) => inScope(r, scene));
  const overridden: { rule: string; by: string }[] = [];
  const off = new Set<string>();
  for (const r of scoped) if (r.kind === "ALLOWS" && r.overrides) {
    const t = scoped.find((x) => x.id === r.overrides);
    if (t && r.tier <= t.tier) { off.add(t.id); overridden.push({ rule: t.id, by: r.id }); }
  }
  const active = scoped.filter((r) => r.kind !== "ALLOWS" && !off.has(r.id)).sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
  return { active, overridden };
}
