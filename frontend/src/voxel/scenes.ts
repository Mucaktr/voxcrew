/**
 * Voxel sahneler. Her sahne 24×16 karolu bir zemin, bloklardan dekor, ajanların çalıştığı
 * istasyonlar (masa/sehpa/kütük…) ve uyuma noktaları üretir. Blokajlı karolar yol bulmada kullanılır.
 * Faz 3 (S7): savaş sahası (oyuncak, şiddetsiz), açık deniz, yat, uzay üssü, karlı köy.
 * Faz 5 (S13): ajan sayısı istasyonları aşınca dünya 24×16'lık "modüller" (odalar) ile ızgara hâlinde büyür:
 * `worldLayout` / `buildWorld`.
 * S38: büyüme artık amaçlı ve temalı BÖLGELERLE olur (voxel/districts/): ekip alanları (ekip renginde çerçeve, tabela,
 * bayrak), ortak çalışma, paylaşılan olanaklar (mutfak, toplantı, kütüphane, sunucu odası; parkta gölet/oyun alanı/bahçe…)
 * ve avlular. Taban sahne hiç kaymaz; ajan eklemek başka ekiplerin yerini değiştirmez (`assignSeats`).
 */
import { tx as msg } from "../lib/i18n";
import type { SceneId } from "../lib/types";
import { world as M } from "../locales/world";
import { BAY, buildDistricts, planDistricts, type BaseBays, type Demand } from "./districts/core";
import { aquarium } from "./districts/parts";
import { hasTheme, theme as districtTheme } from "./districts/themes";
import { hotelPlanKit, placeHotel } from "./districts/hotel"; // HOTEL-SYS: tabanında otel varsa büyüme otel eklemez; sahnenin konağı
import { buildMall } from "./scenes/mall";
import { buildSchool } from "./scenes/school";
import { buildIstanbul, ISTANBUL_ENV } from "./scenes/istanbul";
// EDITION1: tam sürüme özgü sahneler (eski dalga şehirleri + premium); free sürümde boş eş (full/scenes/index.ts)
import { FULL_CITY_SCENES, FULL_PICKER_ORDER, FULL_SCENE_KEYS, fullScenes } from "../full/scenes";
import { buildKapadokya, KAPADOKYA_ENV } from "./scenes/kapadokya";
import { buildLondra, LONDRA_ENV } from "./scenes/londra";
// şehir dizini (V/cities): saf manifestler en üst düzeyde, ağır kurucu tembel (parts.ts; döngü güvenli)
import { NEW_CITY_IDS, type NewCityId } from "./cities/index";
import { INTRUDE_HARD, isObstacle, obstacleTiles } from "./walk/obstacle"; // CITYFIX1
import { kerbScene } from "./city/kerbPoles";
import { cityRecord } from "./cities/hooks";
import { landmarkWalkScene } from "./walk/landmarkWalk"; // LANDMARK-WALK
import { rectTiles, sceneCourtyard } from "./interiors/courtyards"; // COURTYARD-PORTAL
import { carveGates, GATE_TOP_SCENE, sceneGates } from "./walk/landmarkGates"; // LANDMARK-WALK
import { NEW_CITY_PARTS } from "./cities/parts";
import type { CityManifest } from "./cities/types";
import { withHorizonGround } from "./city/horizonGround"; // HORIZON: ufuk bandının zemini (önlük)
import type { CityStyle } from "./city/style";
import { LONDRA_STYLE } from "./city/styles/londra";
import { KAPADOKYA_STYLE } from "./city/styles/kapadokya";
import { ISTANBUL_STYLE } from "./city/styles/istanbul";

export const W = 24;
export const D = 16;
export type Tile = [number, number];
/** Malzeme grupları. wave/bob/flag/snow/spin örnek başına canlandırılır (Blocks.tsx); hareket azaltmada durağandır.
 * `spin`: dönen yapı (gözlem çarkı, dönme dolap, atlı karınca, yel değirmeni) — her blok `r` dönüş tanımını taşır.*/
export type Group = "solid" | "glow" | "water" | "glass" | "cloud" | "flame" | "wave" | "bob" | "flag" | "snow" | "spin";
/** dönen blok tanımı (yalnız `spin` grubunda; mutlak dünya koordinatı). Açı = `ph + w · t` (radyan); yazılan blok
 * konumu açı 0 pozudur (hareket azaltmada, kesit/geçilebilirlik denetiminde taban poz). `k` (kabin askı noktası) verilirse
 * blok dik kalır: yalnız `k` pivot çevresinde döner, blok ona göre ötelenir (kabin başına kendi ters dönüşü). `e`: ışıklı
 * parça (gece parıltısı gibi ışıksız tam renk; aynı çizim çağrısında). Saf matematik: voxel/spin.ts.*/
export type SpinAxis = "x" | "y" | "z";
export interface Spin { a: SpinAxis; o: [number, number, number]; w: number; ph?: number; k?: [number, number, number]; e?: boolean }

/** Faz 3 sahneleri. `SceneId` (lib/types.ts, teknik lider) genişletilene kadar dünya bu birleşimi kullanır. */
export type NewSceneId = "battlefield" | "sea" | "yacht" | "space" | "snow";
/** yeni dünya şehirleri (V/cities/<id>; üretilmiş `NewCityId`, şehir yokken `never`).*/
export type WorldSceneId = SceneId | NewSceneId | NewCityId;

export interface Block { p: [number, number, number]; s: [number, number, number]; c: string; g: Group; j: number; r?: Spin;
  /** INTERIOR-CAM: iç mekân tavanı (interiors/generate.ts `ceiling`) — örtü ızgarası onu kat yüksekliğinden bağımsız çatı sayar */
  ceil?: 1;
  /** yapı parçası (bina cephesi, simge modeli, hat direği) — yan kesit (walk/cover.ts `sideProp`) hiçbir zaman açmaz*/
  fix?: 1 }
/** S41 — istasyondaki çalışma duruşu (Crowd/Character animasyonu için ipucu; yoksa "sit_chair"):
 *  sit_chair: masada sandalye/tabure · sit_bench: masasız bank/kütük (dizüstü kucakta) · sit_ground: örtü/çim/minder ·
 *  lounge: şezlong/hamak/puf (yarı uzanık) · stand: konsol, dümen, bar, tezgâh başında ayakta · lie: yalnızca uyku noktası. */
export type Pose = "sit_chair" | "sit_bench" | "sit_ground" | "lounge" | "stand" | "lie";
/** S41 — istasyondaki cihaz (yoksa renderer bugünkü masaüstü görünümünü varsayar). */
export type Device = "laptop" | "desktop" | "tablet" | "console" | "none";
/** S41 — uyku noktasının yatağı (S43 sözleşmesi).*/
export type BedKind = "bed" | "bunk" | "hammock" | "lounger" | "cot" | "tent" | "mat" | "sofa"
  /** HOTEL-SYS (E1): otel kapısı geçidi — görünür yatak yok; ajan kapıya yürür, geçitten "görünmeyen odalara" girer (sanal kapasite) */
  | "hotel";
export interface Station {
  tile: Tile; face: number;
  pose?: Pose; device?: Device;
  /** oturak/yatak yüzeyinin yüksekliği (dünya birimi) */
  y?: number;
  /** yalnızca uyku noktası */
  bed?: BedKind;
}
export const stationPose = (s: Station): Pose => s.pose ?? "sit_chair";
export const stationDevice = (s: Station): Device => s.device ?? "desktop";
/** S41 — S43 canlı ortam kancaları (kuşlar ağaçta, ördek gölette, martı denizde…). Karo engelli olabilir; yol hedefi değildir. */
/** S46 (S48 eğlence davranışları): `play` = iki kişilik oyun masası (karo masanın kendisi, engelli; iki ucu x ya da z boyunca
 *  yürünebilir) · `fish` = balık tutma yeri (karo yürünebilir iskele/kıyı ucu; `r` bakış yönü dizini 0:+z 1:−z 2:+x 3:−x,
 *  o yöndeki komşu su). Denetim: rules/engine.ts `ambient_habitat` (FUN-HOOK-001). */
export type AmbientKind = "tree" | "pond" | "sea" | "sand" | "grass" | "roof" | "window" | "aquarium" | "perch" | "play" | "fish";
export interface AmbientHook { kind: AmbientKind; tile: Tile; r?: number }
/** W2-INT — `play` kancasında `r = PLAY_BOARD`: sessiz masa oyunu (tavla, dama, satranç): iki ajan karşılıklı oturur, küçük
 *  el hareketleri, raket/top yok. `r` yoksa masa tenisi/langırt masası (S48). Dünya JSON'unda `nav.ambient[].r` olarak kalır. */
export const PLAY_BOARD = 1;
/** W2b-INT — `play` kancasında `r = PLAY_TOSS`: sessiz atma oyunu (pétanque/bocce): iki ajan ayakta, sırayla alttan atar, küçük
 *  top yere düşüp yuvarlanır; raket/masa yok. Karo sözleşmesi masayla aynı: kanca karosu engelli, x (ya da z) boyunca iki ucu boş. */
export const PLAY_TOSS = 2;
/** W2b-INT — `play` kancasında `r = PLAY_HOOP`: sokak potası: iki ajan kancanın iki yanında ayakta, sırayla şut atar; top kanca
 *  karosunun ortasında y = HOOP_RIM_Y yüksekliğindeki çembere kavisle gider, içinden düşüp seker. Kanca karosu = pota direği (engelli). */
export const PLAY_HOOP = 3;
/** W3a-INT — `play` kancasında `r = PLAY_NET`: plaj voleybolu: kanca karosu = file direği (engelli); iki ajan iki yanda ayakta,
 *  top fileyi aşan yüksek kavisle karşılıklı gidip gelir (parmak pası). Karo sözleşmesi PLAY_HOOP ile aynı. */
export const PLAY_NET = 4;
export const HOOP_RIM_Y = 2.3;
/** W2-INT — `fish` kancasında `r = yön + FEED_ONLY` (4–7): yalnız besleme noktası (kırıntı atma, olta yok; ör. ay havuzu).
 *  Yön dizini `r % 4`. */
export const FEED_ONLY = 4;
/** Araç noktaları + uyku noktaları (S41/S43: `spots.sleep`). */
export type SpotKind = ToolKind | "sleep";
export interface Light { pos: [number, number, number]; color: string; intensity: number; distance: number; flicker?: boolean }

/** S33 — yön: dekorun ön yüzünün (ekran, raf önü, sandalyede oturanın) baktığı yön. */
export type Dir = "+z" | "-z" | "+x" | "-x";
export const DIR_ANGLE: Record<Dir, number> = { "+z": 0, "-z": Math.PI, "+x": Math.PI / 2, "-x": -Math.PI / 2 };
export const DIR_VEC: Record<Dir, [number, number]> = { "+z": [0, 1], "-z": [0, -1], "+x": [1, 0], "-x": [-1, 0] };
/** S33 — canlı dekor işareti: pişmiş bloklardan ayrı olarak `voxel/props/` çizer ve canlandırır (tek döngü, örneklenmiş).
 *  screen: kayan kodlu ekran · led: yanıp sönen ışık · lamp: gece ışık havuzu · board: duvar skor panosu ·
 *  chair: istasyonda sandalye var (çalışma anında ikinci sandalye çizilmez) · coffee: kahve makinesi (boşta ajanın uğrak yeri). */
export type PropKind = "screen" | "led" | "lamp" | "board" | "chair" | "coffee" | "window";
export interface PropMark {
  k: PropKind;
  p: [number, number, number];
  /** y ekseni dönüşü (ön yüz yönü; DIR_ANGLE) */
  r: number;
  /** genişlik × yükseklik (ekran, pano) ya da ışık yarıçapı (lamba) */
  s?: [number, number];
  c?: string;
  /** kahve: ajanın duracağı ön karo */
  tile?: Tile;
}

/** SP-W0 — sahne katmanı: çekirdek (mevcut 13), şehir (Dünya Turu paketleri), premium.*/
export type SceneTier = "core" | "city" | "premium";
/** SP-W0 — sahne hava durumu (voxel/props/weather.ts): tek örneklenmiş parçacık dizisi; hareket azaltmada kapalı. */
export type WeatherKind = "rain" | "snow" | "mist" | "bubbles" | "embers" | "aurora"
  /** W2b-INT (<city>): süzülen kiraz yaprakları (pembe yassı parçacık, az sayıda)*/
  | "petals";
/** SP-W0 — sahne saati: "auto" yerel saat (varsayılan), "day"/"night" sahnenin kendi saati. Kullanıcının Görünüm → Işık
 *  seçimi (Gündüz/Gece) her zaman üstündür; `night: true` (eski alan) değişmeden "her zaman gece" anlamını korur. */
export type SceneTime = "auto" | "day" | "night";
/** SP-W0 — IP ve kültür riski (0–3; plan §3.4): ikisi de ≤ 1 ise yayınlanır, 2 yazılı inceleme, 3 ret. */
export type RiskScore = 0 | 1 | 2 | 3;

export interface SceneDef {
  id: WorldSceneId;
  label: string;
  hint: string;
  /** seçicideki küçük renk örneği: [zemin, gökyüzü/vurgu] */
  swatch: [string, string];
  sky: string;
  fog: [number, number];
  hemi: [string, string, number];
  sun: { color: string; intensity: number; pos: [number, number, number] };
  night?: boolean;
  /** ızgaranın dışında ufka uzanan su yüzeyi (deniz sahneleri) */
  ocean?: { color: string; y: number };
  build: () => Built;
  /** Faz 7a: kullanıcı dünyası büyürken hangi sahnenin modül kitini kullanır (null: büyümez; yoksa kendi kimliği) */
  annex?: WorldSceneId | null;
  // ---- SP-W0 sahne paketleri (hepsi isteğe bağlı; yoksa bugünkü davranış)
  /** sahne seçici/mağaza grubu (yoksa "core") */
  tier?: SceneTier;
  /** Dünya Turu paketi (ör. "world_tour_europe"); yalnız şehir/premium */
  pack?: string;
  /** hava durumu katmanları (yoksa yok); ör. Neon Çarşı ["rain"], Aurora ["snow", "aurora"] */
  weather?: WeatherKind[];
  /** W3a-INT — `weather` içinden yalnız gece görünen türler (ör. Simyacı ateş böceği `embers`, Aurora `aurora`); dünya biçimi
   *  v1.1 `env.weather_night`. `aurora` her zaman yalnız gecedir (yazılmasa da). */
  weatherNightOnly?: WeatherKind[];
  /** sahne saati (yoksa "auto") */
  time?: SceneTime;
  /** IP / kültür riski (plan §3.4; yeni sahnelerde zorunlu —)*/
  ip_risk?: RiskScore;
  culture_risk?: RiskScore;
  /** RING-INT — simge çekirdeği (taban karosunda dikdörtgen; bütün taban `{ i0: 0, j0: 0, w: 24, d: 16 }` olabilir). Varsa dünya
   *  halka halinde büyür: taban dünyanın ortasında kalır, bölgeler dört yandan eklenir (districts/core.ts `ringPlan`); taban
   *  kadrajı ızgaradaki simge tepelerini de sığdırır. Yoksa eski büyüme (taban sol-arka köşede). `CITY-CORE-001`,
   *  `CITY-LANDMARK-001`; dünya biçimi v1.1 `grid.core`. */
  core?: SceneCore;
}
/** RING-INT — simge çekirdeği dikdörtgeni (taban karosu). */
export interface SceneCore { i0: number; j0: number; w: number; d: number }

/** Ajanın kullandığı aracın türü → sahnede yürüyeceği yer (Pixel Agents / Realm esinli). */
import type { ToolKind } from "./toolKind";
import { legs4, sleds } from "./city/furniture";
import { resolveStationSeats } from "./fun/seats";
export type { ToolKind } from "./toolKind";
export interface Built {
  blocks: Block[]; blocked: Set<string>; stations: Station[]; rest: Tile[]; lights: Light[];
  /** araç noktaları ve `sleep` (S41: uyuyan/çevrimdışı ajanın uzandığı yürünebilir karolar) */
  spots: Partial<Record<SpotKind, Station[]>>;
  /** ritüel mekânı sipariş karoları; şehir geçidi ≥ GATE_KEEPOUT karo uzakta (citymap/door.ts)*/
  keepOut?: Tile[];
  /** S41: canlı ortam kancaları (S43) */
  ambient?: AmbientHook[];
  /** S33 canlı dekor işaretleri (yoksa boş kabul edilir) */
  props?: PropMark[];
  /** x yönündeki karo sayısı: taban sahnede W, modüllerle büyümüş dünyada daha fazla (tx/tz değişmez) */
  width: number;
  /** z yönündeki karo sayısı: taban sahnede D, modüllerle büyümüş dünyada daha fazla */
  depth: number;
  /** yerleşmiş bölgeler (taban dahil); mini harita, etiketler ve kamera için */
  modules: ModuleCell[];
  /** S38: bölgeli dünyada koltuklar — ekip → istasyon dizinleri (bölge sırasıyla), misafirler (MERKEZ + ortak çalışma) */
  seats?: { teams: Record<string, number[]>; guests: number[] };
  /** SP-W0: sacred/quiet bölgeleri (taban sahne koordinatında) */
  zones?: SceneZone[];
  /** SP-W0: ızgaranın dışında, ufukta yürünmez silüet blokları (voxel/city/skyline.ts). Blok bütçesine ayrı tavan (≤ 1200,
   *  `SCENE-BACKDROP-001`); çizimde mevcut malzeme gruplarına katılır (+0 çizim çağrısı). */
  backdrop?: Block[];
  /** SP-W0: hareketli set parçaları (≤ 12 nesne, `SCENE-MOVER-001`) */
  movers?: Mover[];
}

/** S38 — bölge türü: hq (taban sahne), team (ekip alanı), guest (ortak çalışma: ekipsiz ajanlar + harici oturumlar),
 *  amenity (paylaşılan olanak), yard (avlu / boş parsel). */
export type DistrictKind = "hq" | "team" | "guest" | "amenity" | "yard";

/** SP-W0 — sahne bölgesi (plan §3.3): `sacred` ibadet yerinin dış silüeti + çevresi (istasyon/uyku/eğlence/şaka yok,
 * `SACRED-*` kuralları; sorgu: voxel/city/sacred.ts `isInSacredBuffer`), `quiet` sessiz alan (yalnız eğlence/şaka yok).
 * (i0, j0) sol-arka karo, w×d karo; `buffer` ayak izinin çevresindeki ek karo (varsayılan 1).
 * SP-W1: `landmark` ufuktaki simge silüetin ayak izi (ızgara dışında olabilir; negatif karo); `tag` türü (ör. "lattice":
 * kafes kule, `<city>-NIGHT-001` gece ışık gösterisi yok — yalnız kırmızı ikaz ışığı). Çapa/eğlence kurallarını etkilemez.*/
export type ZoneKind = "sacred" | "quiet" | "landmark"
  /** HOTEL-SYS (E1): şehrin tek oteli — küçük dış kabuğun ayak izi (`tag` lobi tarifi); kapı karosu `bed: "hotel"` uyku geçidi */
  | "hotel";
export interface SceneZone { kind: ZoneKind; i0: number; j0: number; w: number; d: number; buffer?: number; tag?: string }

/** SP-W0 — hareketli set parçası (voxel/props/movers.ts): yol boyunca döngüyle giden vapur, tramvay, zeplin, balon…
 *  Tek örneklenmiş dizi; hareket azaltmada `phase` konumunda durağan. `path` dünya koordinatı [x, y, z] noktaları. */
export type MoverShape = "ferry" | "tram" | "airship" | "balloon" | "bus" | "boat" | "felucca" | "cablecar" | "submarine" | "train"
  /** W2-INT (reef): vatoz (yassı baklava + kanat uçları) ve balık sürüsü (küçük dağınık kutular) */
  | "manta" | "fish_school"
  /** W2b-INT (<city>): sarı taksi (logosuz, yazısız)*/
  | "taxi"
  /** W3a-INT: teslimat dronu (Neon Çarşı) ve kayaklı küçük uçak (Aurora); logosuz */
  | "drone" | "skiplane";
export interface Mover {
  shape: MoverShape;
  path: [number, number, number][];
  /** bir tur süresi (sn) */
  period: number;
  /** başlangıç payı 0–1 (hareket azaltmada durduğu yer) */
  phase?: number;
  /** "loop": son noktadan ilke kapanır · "pingpong": gidip gelir (tramvay, teleferik) */
  mode?: "loop" | "pingpong";
  /** gövde / vurgu rengi (logo ve livre yok —)*/
  color?: string;
  accent?: string;
  scale?: number;
  /** gece gizlenir (ör. balonlar yalnız gündüz uçar) */
  dayOnly?: boolean;
}

/** Dünya ızgarasındaki bir bölge: sol-arka köşe karosu, boyut ve içindeki istasyon yuvaları. S38 alanları: tür, ekip,
 *  ekip rengi, ad anahtarı (locales/world.ts `dist_*`; ekipte yok — ekip adı kullanılır) ve etiket çapası (dünya koordinatı). */
export interface ModuleCell {
  i0: number; j0: number; w: number; d: number; base: boolean; slots: [number, number];
  kind?: DistrictKind; team?: string; color?: string; label?: string; sign?: [number, number, number];
  /** çalışma bölgesinin mekân modeli (workzones/venues.ts; şehirde kafe/atölye/ortak/pazar)*/
  venue?: string;
}

/** Dünyanın x/z sınırları (dünya birimi) — kamera, kaydırma sınırı ve mini harita için. */
export function worldBounds(b: Pick<Built, "width" | "depth">) {
  return { minX: tx(0) - 0.5, maxX: tx(b.width - 1) + 0.5, minZ: tz(0) - 0.5, maxZ: tz(b.depth - 1) + 0.5 };
}

// toolKind ./toolKind.ts içindedir (BUNDLE: kabuk bu küçük eşlemeyi tüm sahne kataloğunu çekmeden kullanır)
export { toolKind } from "./toolKind";

export const tx = (i: number) => i - W / 2 + 0.5;
export const tz = (j: number) => j - D / 2 + 0.5;
export const key = (i: number, j: number) => `${i},${j}`;
export const tileOf = (x: number, z: number): Tile => [Math.floor(x + W / 2), Math.floor(z + D / 2)];

/** Belirlenimci rastgele sayı üreteci. `state`: anlık tohum (dünya biçimi prosedürel prefab'larda saklar; worldFormat.ts). */
export type Rng = (() => number) & { readonly state: number };
export function rng(seed: number): Rng {
  const next = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.defineProperty(next, "state", { get: () => seed }) as Rng;
}

const UP = 0, DOWN = Math.PI, RIGHT = Math.PI / 2, LEFT = -Math.PI / 2; // +z, -z, +x, -x yönüne bakış

/** Sahne kurucu. Faz 7a: dünya biçiminin prefab'ları da bu yardımcılarla pişer (voxel/prefabs.ts). */
export class Builder {
  blocks: Block[] = [];
  blocked = new Set<string>();
  stations: Station[] = [];
  rest: Tile[] = [];
  /** ritüel mekânı sipariş karoları — şehir geçidi bunlardan ≥ 3 karo uzağa kurulur (citymap/door.ts officeDoor)*/
  keepOut: Tile[] = [];
  lights: Light[] = [];
  spots: Partial<Record<SpotKind, Station[]>> = {};
  props: PropMark[] = [];
  ambient: AmbientHook[] = [];
  /** SP-W0 (voxel/city/*): bölgeler, ufuk silüeti, hareketli set parçaları */
  zones: SceneZone[] = [];
  backdrop: Block[] = [];
  movers: Mover[] = [];
  rand: () => number;
  /** CITY-BIG — taban ızgara boyutu (karo). Varsayılan 24×16; şehir tabanları bölge katı olabilir (ör. 36×32 = 3×2 bölge).
   *  Karo kökeni değişmez (`tx`/`tz` sabit): büyük taban +x ve +z yönünde uzar. */
  readonly w: number;
  readonly d: number;
  constructor(seed: number, w = W, d = D) { this.rand = rng(seed); this.w = w; this.d = d; }

  /** `r`: yalnız `g = "spin"` ile; dönüş tanımı (bkz. `Spin`).*/
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: string, g: Group = "solid", j = 0, r?: Spin) {
    this.blocks.push(r && g === "spin" ? { p: [x, y, z], s: [w, h, d], c, g, j, r } : { p: [x, y, z], s: [w, h, d], c, g, j });
  }
  /** (i,j) karosunda, tabanı y0 olan tam karo bloğu */
  cube(i: number, j: number, y0: number, c: string, h = 1, g: Group = "solid", jit = 0.04) {
    this.box(tx(i), y0 + h / 2, tz(j), 1, h, 1, c, g, jit);
  }
  block(i: number, j: number) { this.blocked.add(key(i, j)); }
  ground(top: (i: number, j: number) => string | null, under: string, jit = 0.06) {
    for (let i = 0; i < this.w; i++) for (let j = 0; j < this.d; j++) {
      const c = top(i, j);
      if (c) this.cube(i, j, -1, c, 1, "solid", jit);
      this.cube(i, j, -2, under, 1, "solid", 0.08);
    }
  }
  /** İstasyon. S41: `pose`/`device` duruş ipucu (varsayılan: sandalye + masaüstü), `y` oturak yüksekliği. */
  station(i: number, j: number, face: number, pose?: Pose, device?: Device, y?: number) {
    const s: Station = { tile: [i, j], face };
    if (pose) s.pose = pose;
    if (device) s.device = device;
    if (y !== undefined) s.y = y;
    this.stations.push(s);
  }
  /** S41 — uyku noktası: yürünebilir karo; yatak bu karoya (engellemeden) çizilir. `face`: başın baktığı yön. */
  sleep(i: number, j: number, face: number, bed: BedKind, y = 0.35) {
    (this.spots.sleep ??= []).push({ tile: [i, j], face, pose: bed === "hammock" || bed === "lounger" || bed === "sofa" ? "lounge" : "lie", device: "none", y, bed });
  }
  /** S41 — canlı ortam kancası (S43). */
  hook(kind: AmbientKind, i: number, j: number, r?: number) { this.ambient.push(r ? { kind, tile: [i, j], r } : { kind, tile: [i, j] }); }
  spot(kind: ToolKind, i: number, j: number, face: number) { (this.spots[kind] ??= []).push({ tile: [i, j], face }); }
  /** Kabuk araçları için küçük bir terminal/kiosk: yüzü `face` yönüne bakar. */
  terminal(i: number, j: number, glowToward: "+z" | "+x" | "-x") {
    this.box(tx(i), 0.7, tz(j), 0.8, 1.4, 0.6, "#1F2937", "solid", 0.04);
    const [dx, dz] = glowToward === "+z" ? [0, 0.31] : glowToward === "+x" ? [0.41, 0] : [-0.41, 0];
    this.box(tx(i) + dx, 1.0, tz(j) + dz, glowToward === "+z" ? 0.6 : 0.02, 0.5, glowToward === "+z" ? 0.02 : 0.45, "#34D399", "glow");
    for (let k = 0; k < 3; k++) this.box(tx(i) + dx * 1.01, 0.35 + k * 0.12, tz(j) + dz * 1.01, glowToward === "+z" ? 0.1 : 0.02, 0.05, glowToward === "+z" ? 0.02 : 0.1, k % 2 ? "#F87171" : "#60A5FA", "glow");
    // (KIOSK-BACK-001): arkadan/yandan da kiosk okunsun ("kara monolit" değil) — arkada yazısız şehir haritası panosu (kâğıt
    // zemin + nehir ve yol şeritleri), tepede gövdeyi saran ekran yeşili bant
    const along = glowToward === "+z", sg = along ? -1 : -Math.sign(dx), half = along ? 0.3 : 0.4; // arka yüz: ekranın karşısı
    const at = (off: number): [number, number] => (along ? [tx(i), tz(j) + sg * (half + off)] : [tx(i) + sg * (half + off), tz(j)]);
    const panel = (off: number, y: number, w: number, h: number, c: string, t: number) => { const [x, z] = at(off); this.box(x, y, z, along ? w : t, h, along ? t : w, c); };
    panel(0.01, 0.98, 0.56, 0.62, "#ECE6D3", 0.02); // pano (gövde yüzünden 0,02 dışarı)
    panel(0.025, 1.02, 0.46, 0.05, "#4A90C8", 0.01); // nehir şeridi
    panel(0.025, 0.94, 0.05, 0.42, "#E0A33A", 0.01); // yol şeridi
    for (const s of [-1, 1]) { // iki yanda açık renkli yan levha (yandan da siyah blok okunmasın)
      const sh = along ? 0.41 : 0.31;
      this.box(tx(i) + (along ? s * sh : 0), 0.85, tz(j) + (along ? 0 : s * sh), along ? 0.02 : 0.5, 0.8, along ? 0.4 : 0.02, "#CBD5E1");
    }
    this.box(tx(i), 1.38, tz(j), 0.84, 0.08, 0.64, "#34D399");
    this.block(i, j);
  }

  // ---- dekor yardımcıları
  /** user: kullanıcının (ajanın) laptopa göre hangi tarafta olduğu; ekran onun karşısında durur. */
  laptop(x: number, y: number, z: number, user: "-z" | "+z" | "-x" | "+x") {
    const ax = user[1] === "x";
    const sgn = user[0] === "-" ? -1 : 1;
    const at = (d: number): [number, number] => (ax ? [x - sgn * d, z] : [x, z - sgn * d]);
    this.box(x, y + 0.03, z, ax ? 0.38 : 0.56, 0.05, ax ? 0.56 : 0.38, "#CBD5E1");
    const [sx, sz] = at(0.2);
    this.box(sx, y + 0.22, sz, ax ? 0.04 : 0.56, 0.36, ax ? 0.56 : 0.04, "#334155");
    const [gx, gz] = at(0.17);
    this.box(gx, y + 0.23, gz, ax ? 0.02 : 0.48, 0.28, ax ? 0.48 : 0.02, "#7DD3FC", "glow");
  }
  /** `bare`: dizüstü yok (S33: ofiste masaya ayrı monitör konur). */
  desk(i: number, j: number, w: number, top: string, legs: string, bare = false) {
    const x = tx(i) + (w - 1) / 2, z = tz(j);
    this.box(x, 0.74, z, w, 0.1, 0.9, top, "solid", 0.03);
    for (const dx of [-w / 2 + 0.12, w / 2 - 0.12]) for (const dz of [-0.33, 0.33]) this.box(x + dx, 0.35, z + dz, 0.1, 0.7, 0.1, legs);
    for (let k = 0; k < w; k++) this.block(i + k, j);
    if (!bare) this.laptop(tx(i), 0.79, z, "-z");
    if (w > 1) this.box(tx(i + 1), 0.86, z, 0.16, 0.16, 0.16, "#F8FAFC");
  }
  plant(i: number, j: number) {
    this.box(tx(i), 0.25, tz(j), 0.55, 0.5, 0.55, "#C2410C", "solid", 0.05);
    this.box(tx(i), 0.75, tz(j), 0.7, 0.5, 0.7, "#2F855A", "solid", 0.12);
    this.box(tx(i), 1.12, tz(j), 0.45, 0.35, 0.45, "#38A169", "solid", 0.12);
    this.block(i, j);
  }
  tree(i: number, j: number, h = 3) {
    for (let y = 0; y < h; y++) this.cube(i, j, y, "#6B4226", 1, "solid", 0.06);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      this.box(tx(i + dx), h + 0.5, tz(j + dz), 1, 1, 1, "#3E8E3E", "solid", 0.14);
      if (!dx || !dz) this.box(tx(i + dx), h + 1.5, tz(j + dz), 1, 1, 1, "#4CAF50", "solid", 0.14);
    }
    this.block(i, j);
    this.hook("tree", i, j);
  }
  pine(i: number, j: number) {
    this.cube(i, j, 0, "#5D3A1A", 2, "solid", 0.06);
    [[3, 2], [2.2, 3], [1.4, 4], [0.6, 4.8]].forEach(([w, y]) => this.box(tx(i), y, tz(j), w, 1.0, w, "#1F5130", "solid", 0.1)); // REAL-SUPPORT: katmanlar birbirine değer (eskiden 0,1 boşlukla havada)
    this.block(i, j);
    this.hook("tree", i, j);
  }
  palm(i: number, j: number) {
    for (let k = 0; k < 6; k++) this.box(tx(i) + k * 0.07, k * 0.55 + 0.28, tz(j), 0.45, 0.55, 0.45, "#9C7A54", "solid", 0.08);
    const tx0 = tx(i) + 0.4, ty = 3.45, tz0 = tz(j);
    this.box(tx0, ty, tz0, 0.8, 0.4, 0.8, "#2E9E4F", "solid", 0.1);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      this.box(tx0 + dx * 1.1, ty - 0.2, tz0 + dz * 1.1, dx ? 1.6 : 0.5, 0.2, dz ? 1.6 : 0.5, "#38B25A", "solid", 0.1);
      // REAL-SUPPORT-001: sarkan yaprak ucu içteki yaprağa değer (y üst yüzü 3,17 ≥ iç yaprağın tabanı 3,15; eskiden 0,1 boşlukla havadaydı)
      this.box(tx0 + dx * 1.9, ty - 0.38, tz0 + dz * 1.9, dx ? 0.6 : 0.5, 0.2, dz ? 0.6 : 0.5, "#2E9E4F", "solid", 0.1);
    }
    this.box(tx0 + 0.25, ty - 0.3, tz0 + 0.25, 0.25, 0.25, 0.25, "#6B4226"); // hindistan cevizi tacın altına yapışık
    this.block(i, j);
    this.hook("tree", i, j);
  }
  cloud(x: number, y: number, z: number) {
    const n = 2 + Math.floor(this.rand() * 3);
    for (let k = 0; k < n; k++) this.box(x + k * 1.1, y + (k % 2) * 0.3, z + (this.rand() - 0.5), 1.6, 0.7, 1.2, "#FFFFFF", "cloud");
  }
  flowers(n: number, ok: (i: number, j: number) => boolean) {
    const colors = ["#F472B6", "#FDE047", "#FFFFFF", "#A78BFA", "#FB7185"];
    for (let k = 0; k < n; k++) {
      const i = Math.floor(this.rand() * this.w), j = Math.floor(this.rand() * this.d);
      if (!ok(i, j) || this.blocked.has(key(i, j))) continue;
      const x = tx(i) + (this.rand() - 0.5) * 0.6, z = tz(j) + (this.rand() - 0.5) * 0.6;
      this.box(x, 0.12, z, 0.06, 0.24, 0.06, "#2F855A");
      this.box(x, 0.28, z, 0.18, 0.14, 0.18, colors[k % colors.length]);
    }
  }
  wall(j: number, from: number, to: number, h: number, color: (i: number, y: number) => string, windows: [number, number][] = []) {
    for (let i = from; i <= to; i++) {
      for (let y = 0; y < h; y++) {
        const win = windows.some(([a, b]) => i >= a && i <= b) && y >= 1 && y <= 2;
        if (win) this.cube(i, j, y, "#A8D8F0", 1, "glass");
        else this.cube(i, j, y, color(i, y), 1, "solid", 0.03);
      }
      this.block(i, j);
    }
  }
  sideWall(i: number, from: number, to: number, h: number, c: string) {
    for (let j = from; j <= to; j++) {
      for (let y = 0; y < h; y++) this.cube(i, j, y, c, 1, "solid", 0.03);
      this.block(i, j);
    }
  }

  // ---- Faz 3 dekor yardımcıları
  /** Dalgalanan deniz karosu; üst yüzü `top` yüksekliğinde. `blocking=false`: üstünde iskele var, yürünebilir. */
  sea(i: number, j: number, c: string, top = -0.2, blocking = true) {
    // 0,7 derin — taban (−1) ile ±0,1 sallanma arasında açıklık (alt yüz tabanın içinden geçip titremez)
    this.box(tx(i), top - 0.35, tz(j), 1, 0.7, 1, c, "wave", 0.03);
    if (blocking) this.block(i, j);
  }
  /** x boyunca kum torbası sırası (şaşırtmalı katlar). */
  sandbags(i0: number, i1: number, j: number, layers = 2) {
    const cs = ["#CDB287", "#BFA275", "#D8C29A"];
    for (let i = i0; i <= i1; i++) {
      for (let l = 0; l < layers; l++) {
        for (let k = 0; k < 2; k++) {
          const x = l % 2 ? tx(i) + (k ? 0.24 : -0.26) : tx(i) - 0.25 + k * 0.5;
          this.box(x, 0.13 + l * 0.25, tz(j), 0.47, 0.24, 0.56, cs[(i * 3 + k + l) % 3], "solid", 0.05);
        }
      }
      this.block(i, j);
    }
  }
  /** z boyunca kum torbası sırası. */
  sandbagsZ(i: number, j0: number, j1: number, layers = 2) {
    const cs = ["#CDB287", "#BFA275", "#D8C29A"];
    for (let j = j0; j <= j1; j++) {
      for (let l = 0; l < layers; l++) {
        for (let k = 0; k < 2; k++) {
          const z = l % 2 ? tz(j) + (k ? 0.24 : -0.26) : tz(j) - 0.25 + k * 0.5;
          this.box(tx(i), 0.13 + l * 0.25, z, 0.56, 0.24, 0.47, cs[(j * 3 + k + l) % 3], "solid", 0.05);
        }
      }
      this.block(i, j);
    }
  }
  /** Direkli bayrak: kumaş "flag" grubunda direğin çevresinde dalgalanır (pivot = kumaş merkezi − 0,5). */
  flag(i: number, j: number, color: string, h = 3, emblem?: string) {
    this.box(tx(i), h / 2, tz(j), 0.1, h, 0.1, "#E5E7EB", "solid", 0.02);
    this.box(tx(i), h + 0.07, tz(j), 0.18, 0.14, 0.18, "#F2B33D");
    this.box(tx(i), 0.1, tz(j), 0.5, 0.2, 0.5, "#6B7280");
    this.box(tx(i) + 0.55, h - 0.38, tz(j), 1, 0.6, 0.04, color, "flag");
    if (emblem) this.box(tx(i) + 0.55, h - 0.38, tz(j), 0.34, 0.26, 0.07, emblem, "flag");
    this.block(i, j);
  }
  crate(x: number, y: number, z: number, s = 0.8, c = "#9A7442") {
    this.box(x, y + s / 2, z, s, s, s, c, "solid", 0.05);
    this.box(x, y + s / 2, z, s + 0.03, 0.1, s + 0.03, "#6E5230");
  }
  /** Fener direği (yalnızca parlayan blok; nokta ışığı sahne bütçesi için ayrıca eklenir). */
  lantern(i: number, j: number, glow = "#FFD27A", post = "#374151") {
    this.box(tx(i), 0.8, tz(j), 0.1, 1.6, 0.1, post);
    this.box(tx(i), 1.7, tz(j), 0.3, 0.3, 0.3, glow, "glow");
    this.box(tx(i), 1.9, tz(j), 0.38, 0.08, 0.38, post);
    this.block(i, j);
  }
  /** Karlı çam: katmanların üstünde kar kapağı. */
  snowyPine(i: number, j: number) {
    this.cube(i, j, 0, "#5D3A1A", 1.6, "solid", 0.06);
    [[3, 1.7], [2.3, 2.6], [1.5, 3.5], [0.7, 4.3]].forEach(([w, y]) => {
      this.box(tx(i), y, tz(j), w, 0.85, w, "#1F5130", "solid", 0.1);
      this.box(tx(i), y + 0.47, tz(j), w * 0.82, 0.12, w * 0.82, "#F8FAFC", "solid", 0.02);
    });
    this.block(i, j);
    this.hook("tree", i, j);
  }
  /** Yağan kar taneleri (hacim içinde rastgele; Blocks.tsx döngüyle düşürür). */
  snowfall(n: number) {
    for (let k = 0; k < n; k++) {
      const x = (this.rand() - 0.5) * 30, z = (this.rand() - 0.5) * 22, y = 0.3 + this.rand() * 8.5;
      this.box(x, y, z, 0.09, 0.09, 0.09, "#FFFFFF", "snow");
    }
  }
  // ---- S33 canlı dekor yardımcıları (her biri prefab türüne karşılık gelir: prefabs.ts)
  /** Masaüstü monitör: ekranı `face` yönüne bakar; (dx, dz) karo merkezine göre kayma, y masa yüksekliği. */
  monitor(i: number, j: number, face: Dir, dx = 0, dz = 0, y = 0.79) {
    const x = tx(i) + dx, z = tz(j) + dz;
    const [fx, fz] = DIR_VEC[face];
    const alongX = fz !== 0;
    const sz = (w: number, d: number): [number, number] => (alongX ? [w, d] : [d, w]);
    const [bw, bd] = sz(0.3, 0.2);
    this.box(x, y + 0.02, z, bw, 0.04, bd, "#334155");
    this.box(x - fx * 0.05, y + 0.18, z - fz * 0.05, 0.06, 0.3, 0.06, "#475569");
    const [ww, wd] = sz(0.76, 0.06);
    this.box(x, y + 0.52, z, ww, 0.48, wd, "#1F2937", "solid", 0.02);
    this.props.push({ k: "screen", p: [x + fx * 0.035, y + 0.52, z + fz * 0.035], r: DIR_ANGLE[face], s: [0.68, 0.4] });
  }
  /** Ofis sandalyesi: oturan `face` yönüne bakar (sırtlık arkada). Karoyu engellemez (istasyon karosuna konur). */
  chair(i: number, j: number, face: Dir, c = "#2B2F3A") {
    const x = tx(i), z = tz(j);
    const [fx, fz] = DIR_VEC[face];
    const alongX = fz !== 0;
    this.box(x, 0.03, z, 0.5, 0.05, 0.08, "#111827");
    this.box(x, 0.03, z, 0.08, 0.05, 0.5, "#111827");
    this.box(x + fx * 0.06, 0.15, z + fz * 0.06, 0.07, 0.22, 0.07, "#4B5563");
    this.box(x + fx * 0.08, 0.27, z + fz * 0.08, alongX ? 0.56 : 0.52, 0.08, alongX ? 0.52 : 0.56, c, "solid", 0.03);
    this.box(x - fx * 0.2, 0.56, z - fz * 0.2, alongX ? 0.54 : 0.08, 0.5, alongX ? 0.08 : 0.54, c, "solid", 0.03);
    this.props.push({ k: "chair", p: [x, 0, z], r: DIR_ANGLE[face] });
  }
  /** Sunucu dolabı: ön yüzü `face` yönünde, raflarda yanıp sönen LED'ler. Karoyu engeller. */
  serverRack(i: number, j: number, face: Dir) {
    const x = tx(i), z = tz(j);
    const [fx, fz] = DIR_VEC[face];
    const alongX = fz !== 0;
    this.box(x, 1.0, z, 0.9, 2.0, 0.85, "#1E222B", "solid", 0.03);
    this.box(x, 2.03, z, 0.94, 0.06, 0.89, "#111827");
    const LED = ["#34D399", "#60A5FA", "#FBBF24", "#34D399"];
    for (let k = 0; k < 6; k++) {
      const y = 0.32 + k * 0.29;
      this.box(x + fx * 0.43, y, z + fz * 0.43, alongX ? 0.74 : 0.02, 0.06, alongX ? 0.02 : 0.74, "#3B4252");
      for (let c = 0; c < 3; c++) {
        const off = 0.12 + c * 0.09;
        this.props.push({ k: "led", p: [x + fx * 0.445 + (alongX ? off : 0), y + 0.09, z + fz * 0.445 + (alongX ? 0 : off)], r: DIR_ANGLE[face],
          c: LED[(k + c + i + j) % LED.length] });
      }
    }
    this.block(i, j);
  }
  /** Kahve makinesi (dolap + makine + fincan): boştaki ajanların uğrak yeri; ön karo `face` yönünde. Karoyu engeller.
   *  `onCounter`: yalnızca makine, var olan tezgâhın üstünde (y 0,96; karoyu tezgâh engeller). */
  coffeeMachine(i: number, j: number, face: Dir = "+z", onCounter = false) {
    const x = tx(i), z = tz(j);
    const [fx, fz] = DIR_VEC[face];
    const y0 = 0.96; // makinenin tabanı (dolap ya da tezgâh üstü)
    if (!onCounter) {
      this.box(x, 0.45, z, 0.9, 0.9, 0.8, "#94A3B8", "solid", 0.03);
      this.box(x, 0.93, z, 0.94, 0.06, 0.84, "#475569");
    }
    this.box(x, y0 + 0.28, z, 0.5, 0.56, 0.44, "#1F2937", "solid", 0.02);
    this.box(x + fx * 0.23, y0 + 0.34, z + fz * 0.23, 0.18, 0.1, 0.18, "#F87171", "glow");
    this.box(x + fx * 0.18, y0 + 0.06, z + fz * 0.18, 0.12, 0.12, 0.12, "#F8FAFC");
    this.props.push({ k: "coffee", p: [x, 0, z], r: DIR_ANGLE[face], tile: [i + fx, j + fz] });
    this.props.push({ k: "led", p: [x + fx * 0.225, y0 + 0.5, z + fz * 0.225], r: DIR_ANGLE[face], c: "#34D399" });
    if (!onCounter) this.block(i, j);
  }
  /** Duvar skor panosu: (i, j) duvar karosunun ön (+z) yüzüne asılır; `w` karo genişliğinde. Canlı içerik props/ çizer. */
  scoreboard(i: number, j: number, w = 2) {
    const x = tx(i) + (w - 1) / 2, z = tz(j) + 0.53, y = 2.9;
    this.box(x, y, z, w + 0.4, 1.2, 0.08, "#111827", "solid", 0.02);
    this.box(x, y - 0.66, z + 0.06, w + 0.1, 0.06, 0.14, "#374151");
    this.props.push({ k: "board", p: [x, y, z + 0.045], r: 0, s: [w + 0.26, 1.06] });
  }
  /** Ayaklı lamba (eski `lamp` prefab'ıyla aynı bloklar) + gece ışık havuzu. */
  lamp(i: number, j: number, glow = "#FDE68A") {
    this.box(tx(i), 0.7, tz(j), 0.1, 1.4, 0.1, "#78716C");
    this.box(tx(i), 1.5, tz(j), 0.5, 0.4, 0.5, glow, "glow");
    this.props.push({ k: "lamp", p: [tx(i), 1.5, tz(j)], r: 0, s: [2.2, 0], c: glow });
    this.block(i, j);
  }
  /** Masa lambası: masa üstünde (y 0,79), karo merkezine göre (dx, dz). Karoyu engellemez. */
  deskLamp(i: number, j: number, glow = "#FDE68A", dx = 0.25, dz = -0.25) {
    const x = tx(i) + dx, z = tz(j) + dz;
    this.box(x, 1.04, z, 0.12, 0.5, 0.12, "#374151");
    this.box(x, 1.32, z, 0.3, 0.12, 0.3, glow, "glow");
    this.props.push({ k: "lamp", p: [x, 1.32, z], r: 0, s: [1.3, 0], c: glow });
  }
  /** REAL-SUPPORT — kavisli (ark) sarkıt lamba: dikme bir yüzeyden (masa/tezgâh `baseY`) yükselir, üstte L biçimli kol gölgelik
   *  (`shadeX`, `shadeZ`) üstüne uzanır, gölgelik ince telle kolun altına asılır (eskiden tel tavansız havada kalıyordu). Gölgelik
   *  kutusunu çağıran çizer; `shadeTop` onun üst yüzü. Karoyu engellemez. */
  armLamp(baseX: number, baseZ: number, baseY: number, shadeX: number, shadeZ: number, shadeTop: number, topY = 3.4, c = "#1F2937") {
    this.box(baseX, (baseY + topY) / 2, baseZ, 0.05, topY - baseY, 0.05, c);
    const ax = (baseX + shadeX) / 2, az = (baseZ + shadeZ) / 2;
    if (Math.abs(shadeX - baseX) > 0.02) this.box(ax, topY, baseZ, Math.abs(shadeX - baseX) + 0.05, 0.04, 0.05, c);
    if (Math.abs(shadeZ - baseZ) > 0.02) this.box(shadeX, topY, az, 0.05, 0.04, Math.abs(shadeZ - baseZ) + 0.05, c);
    this.box(shadeX, (shadeTop + topY) / 2, shadeZ, 0.03, topY - shadeTop, 0.03, c);
  }
  /** Kanepe (eski `sofa` prefab'ıyla aynı bloklar): 3 karo. */
  sofa(i: number, j: number, c: string, back: string) {
    this.box(tx(i + 1), 0.3, tz(j), 3, 0.6, 1, c, "solid", 0.04);
    this.box(tx(i + 1), 0.75, tz(j) + 0.38, 3, 0.9, 0.25, back, "solid", 0.04);
    for (let k = 0; k < 3; k++) this.block(i + k, j);
  }
  // ---- S41 sahne mantığı yardımcıları: oturak/yatak İSTASYON ya da UYKU karosuna çizilir ve karoyu ENGELLEMEZ
  // (ajan üstüne oturur/uzanır). Hepsi var olan blok gruplarıyla; yeni malzeme/çizim çağrısı yok.
  /** Park bankı: x boyunca `n` karo, oturan `face` yönüne bakar, sırtlık arkada. Oturak üstü y≈0,46. */
  parkBench(i: number, j: number, n: number, face: "+z" | "-z", seat = "#B07D48", leg = "#3F4A3C") {
    const x = tx(i) + (n - 1) / 2, z = tz(j), s = face === "+z" ? -1 : 1;
    for (const dx of [-n / 2 + 0.16, n / 2 - 0.16]) {
      this.box(x + dx, 0.2, z, 0.1, 0.4, 0.52, leg);
      this.box(x + dx, 0.6, z + s * 0.3, 0.08, 0.5, 0.08, leg);
    }
    this.box(x, 0.43, z + s * 0.02, n - 0.08, 0.07, 0.52, seat, "solid", 0.03);
    this.box(x, 0.74, z + s * 0.3, n - 0.08, 0.3, 0.06, seat, "solid", 0.03);
  }
  /** Kapalı dizüstü (bank, havlu, şezlong yanında bırakılmış). */
  closedLaptop(x: number, y: number, z: number, c = "#CBD5E1") {
    this.box(x, y + 0.03, z, 0.46, 0.05, 0.34, c);
    this.box(x + 0.12, y + 0.06, z + 0.08, 0.08, 0.01, 0.06, "#7DD3FC", "glow");
  }
  /** Yerde (örtü/kum/iskele) önüne açılmış dizüstü: oturanın `face` yönünde, karonun içinde. */
  groundLaptop(i: number, j: number, face: Dir, y = 0.03) {
    const [fx, fz] = DIR_VEC[face];
    const user = ({ "+z": "-z", "-z": "+z", "+x": "-x", "-x": "+x" } as const)[face];
    this.laptop(tx(i) + fx * 0.36, y, tz(j) + fz * 0.36, user);
  }
  /** Piknik örtüsü (w×d karo, engellemez): zemin rengi + şerit. */
  blanket(i0: number, j0: number, w: number, d: number, c: string, stripe = "#FFFFFF") {
    const x = (tx(i0) + tx(i0 + w - 1)) / 2, z = (tz(j0) + tz(j0 + d - 1)) / 2;
    this.box(x, 0.015, z, w - 0.1, 0.03, d - 0.1, c, "solid", 0.02);
    for (let k = 0; k < w; k++) this.box(tx(i0 + k), 0.032, z, 0.18, 0.006, d - 0.14, stripe);
  }
  /** Piknik sepeti (karoyu engeller). */
  basket(i: number, j: number) {
    this.box(tx(i), 0.18, tz(j), 0.56, 0.34, 0.4, "#B07D48", "solid", 0.05);
    this.box(tx(i), 0.38, tz(j), 0.58, 0.06, 0.42, "#E07A5F");
    this.box(tx(i), 0.52, tz(j), 0.06, 0.24, 0.42, "#8B5A2B");
    this.block(i, j);
  }
  /** Şezlong: başı `face`in tersinde yükselir; ajan (istasyon ya da uyku) üstüne uzanır. Üst yüzey y≈0,34. */
  sunLounger(i: number, j: number, face: "+z" | "-z", cushion = "#F8FAFC", frame = "#94A3B8") {
    const x = tx(i), z = tz(j), s = face === "+z" ? -1 : 1;
    for (const dz of [-0.38, 0.38]) this.box(x, 0.11, z + dz, 0.62, 0.06, 0.06, frame);
    this.box(x, 0.24, z + s * -0.08, 0.66, 0.08, 0.82, frame, "solid", 0.02);
    legs4(this.box.bind(this), x, z + s * -0.08, 0.66, 0.82, 0.2, frame); // CORE-WALK (REAL-SEAT): şezlong yere basar
    this.box(x, 0.3, z + s * -0.08, 0.6, 0.05, 0.76, cushion, "solid", 0.02);
    this.box(x, 0.48, z + s * 0.38, 0.6, 0.4, 0.1, cushion, "solid", 0.02);
  }
  /** Plaj şemsiyesi: direk karoyu engeller; altında içecekli küçük sehpa. */
  umbrella(i: number, j: number, c1: string, c2 = "#FFFFFF") {
    const x = tx(i), z = tz(j);
    this.box(x, 1.15, z, 0.08, 2.3, 0.08, "#E5E7EB");
    this.box(x, 2.25, z, 2.6, 0.14, 2.6, c1, "solid", 0.02);
    this.box(x, 2.38, z, 1.7, 0.14, 1.7, c2);
    this.box(x, 2.5, z, 0.7, 0.12, 0.7, c1);
    this.box(x, 0.42, z, 0.62, 0.05, 0.62, "#F8FAFC");
    this.box(x - 0.15, 0.52, z + 0.1, 0.1, 0.16, 0.1, "#F59E0B", "glass");
    this.block(i, j);
  }
  /** Hamak: (i±1, j) direkleri engeller, (i, j) kumaş altı yürünebilir uyku karosu (y≈0,6). */
  hammock(i: number, j: number, c = "#D9A441", post = "#6B4226") {
    for (const di of [-1, 1]) { this.box(tx(i + di), 0.75, tz(j), 0.16, 1.5, 0.16, post); this.block(i + di, j); }
    this.box(tx(i), 0.6, tz(j), 1.3, 0.08, 0.62, c, "solid", 0.03);
    // CORE-WALK (REAL-SUPPORT): bez iplerle direklere bağlı (ipler bezin ucundan direğe değer; eskiden bez havada asılıydı)
    for (const s of [-1, 1]) this.box(tx(i) + s * 0.78, 0.63, tz(j), 0.36, 0.04, 0.04, "#E8D5B5");
    this.box(tx(i), 0.66, tz(j), 1.2, 0.02, 0.06, "#FFFFFF");
  }
  /** Portatif kamp/koğuş yatağı (z boyunca, başı −z'de): üst yüzey y≈0,36. S45: yatan ajan ~1,5 karo — yatak karonun
   *  ortasında 1,5 karo boyunda (iki uçta ¼ karo taşar, engellemez); ayaklar dışarıda kalmaz. */
  cot(i: number, j: number, c = "#5E7A3A", pillow = "#F3E7C9", frame = "#4B5563") {
    const x = tx(i), z = tz(j);
    for (const dx of [-0.3, 0.3]) for (const dz of [-0.66, 0.66]) this.box(x + dx, 0.15, z + dz, 0.05, 0.3, 0.05, frame);
    this.box(x, 0.32, z, 0.66, 0.06, 1.44, c, "solid", 0.02);
    this.box(x, 0.38, z - 0.56, 0.5, 0.08, 0.22, pillow);
  }
  /** Yatak (başı −z'de, başlık arkada; S45: 1,5 karo boyunda, karonun ortasında): üst yüzey y≈0,5. */
  bed(i: number, j: number, quilt: string, frame = "#8B5E3C", pillow = "#F8FAFC") {
    const x = tx(i), z = tz(j);
    this.box(x, 0.2, z, 0.9, 0.3, 1.46, frame, "solid", 0.03);
    this.box(x, 0.42, z + 0.08, 0.86, 0.14, 1.28, quilt, "solid", 0.03);
    this.box(x, 0.44, z - 0.58, 0.6, 0.1, 0.22, pillow);
    this.box(x, 0.6, z - 0.72, 0.9, 0.7, 0.06, frame, "solid", 0.03);
  }
  /** Uyku kapsülü / ranza / şekerleme kabini (arka ve yan kabuk + cam tavan; ön açık, başı −z). Yüzey y≈0,34. */
  napPod(i: number, j: number, shell = "#E2E8F0", mat = "#93C5FD", glow = "#7DD3FC") {
    const x = tx(i), z = tz(j);
    // S45: 1,5 karo boyunda (yatan ajan ~1,5 karo; karonun ortasında)
    this.box(x, 0.12, z, 0.92, 0.24, 1.46, shell, "solid", 0.02);
    this.box(x, 0.3, z + 0.02, 0.8, 0.08, 1.34, mat);
    this.box(x, 0.36, z - 0.56, 0.5, 0.08, 0.2, "#F8FAFC");
    for (const s of [-1, 1]) this.box(x + s * 0.44, 0.55, z, 0.05, 0.62, 1.46, shell, "solid", 0.02);
    this.box(x, 0.55, z - 0.71, 0.92, 0.62, 0.05, shell, "solid", 0.02);
    this.box(x, 0.9, z, 0.94, 0.06, 1.48, "#BFE3F5", "glass");
    this.box(x, 0.8, z - 0.66, 0.4, 0.04, 0.02, glow, "glow");
  }
  /** Divan/puf (engellemez): yüzey y≈0,36; sırtlık `back` yönünde. */
  daybed(i: number, j: number, c: string, backC: string, back: Dir = "-z") {
    const x = tx(i), z = tz(j), [bx, bz] = DIR_VEC[back];
    this.box(x, 0.18, z, 0.94, 0.36, 0.94, c, "solid", 0.04);
    this.box(x + bx * 0.4, 0.55, z + bz * 0.4, bx ? 0.14 : 0.94, 0.5, bz ? 0.14 : 0.94, backC, "solid", 0.04);
  }
  /** Yer yatağı / havlu / uyku tulumu (engellemez): yüzey y≈0,05. S45: 1,5 karo boyunda (karonun ortasında). */
  mat(i: number, j: number, c: string, pillow = "#F8FAFC") {
    this.box(tx(i), 0.03, tz(j), 0.7, 0.06, 1.44, c, "solid", 0.02);
    this.box(tx(i), 0.07, tz(j) - 0.56, 0.46, 0.06, 0.2, pillow);
  }
  /** Açık önlü çadır: (i0…i0+w−1) × (j0…j0+2); yan sütunlar ve arka orta engelli, iç 2 sütun × 2 sıra yürünebilir
   *  (arka iç sıra uyku karosu). Kapı +z yönünde. */
  openTent(i0: number, j0: number, c: string, dark: string, w = 4) {
    const x = (tx(i0) + tx(i0 + w - 1)) / 2, z = tz(j0 + 1), half = w / 2;
    for (let k = 0; k < 4; k++) {
      const off = half - 0.25 - k * 0.42, y = 0.32 + k * 0.56;
      for (const s of [-1, 1]) this.box(x + s * off, y, z, 0.5, 0.6, 2.9, k % 2 ? dark : c, "solid", 0.04);
    }
    this.box(x, 2.45, z, 0.5, 0.2, 3.0, dark);
    for (let k = 0; k < 3; k++) this.box(x, 0.4 + k * 0.62, z - 1.42, w - 1.1 - k * 0.84, 0.62, 0.06, c, "solid", 0.03);
    for (const s of [-1, 1]) this.box(x + s * (half - 0.7), 1.0, z + 1.46, 0.5, 1.6, 0.04, dark);
    for (let j = j0; j <= j0 + 2; j++) { this.block(i0, j); this.block(i0 + w - 1, j); }
    for (let i = i0 + 1; i < i0 + w - 1; i++) this.rug1(i, j0 + 1, "#8B7355");
  }
  /** Tek karoluk ince zemin örtüsü (engellemez). */
  rug1(i: number, j: number, c: string) { this.box(tx(i), 0.012, tz(j), 0.92, 0.024, 0.92, c, "solid", 0.02); }
  /** Direkli tente/sığınak çatısı (köşe direkleri karo kenarında, engellemez): (i0…i1) × (j0…j1). */
  canopy(i0: number, i1: number, j0: number, j1: number, c: string, h = 2.2, post = "#6B4226", cap?: string) {
    const x0 = tx(i0) - 0.45, x1 = tx(i1) + 0.45, z0 = tz(j0) - 0.45, z1 = tz(j1) + 0.45;
    for (const px of [x0, x1]) for (const pz of [z0, z1]) this.box(px, h / 2, pz, 0.1, h, 0.1, post);
    this.box((x0 + x1) / 2, h + 0.06, (z0 + z1) / 2, x1 - x0 + 0.4, 0.12, z1 - z0 + 0.4, c, "solid", 0.03);
    if (cap) this.box((x0 + x1) / 2, h + 0.17, (z0 + z1) / 2, x1 - x0 + 0.3, 0.1, z1 - z0 + 0.3, cap, "solid", 0.02);
  }
  /** Katlanır kamp sandalyesi (engellemez): oturan `face` yönüne bakar. Oturak y≈0,42. */
  campChair(i: number, j: number, face: Dir, c: string) {
    const x = tx(i), z = tz(j), [fx, fz] = DIR_VEC[face], ax = fz !== 0;
    for (const s of [-1, 1]) this.box(x + (ax ? s * 0.26 : 0), 0.21, z + (ax ? 0 : s * 0.26), 0.05, 0.42, 0.05, "#374151");
    this.box(x, 0.4, z, 0.56, 0.05, 0.56, c, "solid", 0.02);
    this.box(x - fx * 0.27, 0.68, z - fz * 0.27, ax ? 0.56 : 0.05, 0.5, ax ? 0.05 : 0.56, c, "solid", 0.02);
  }
  /** Bar/ada taburesi (engellemez). Oturak y≈0,62. */
  stool(i: number, j: number, c: string) {
    this.box(tx(i), 0.3, tz(j), 0.08, 0.6, 0.08, "#374151");
    this.box(tx(i), 0.585, tz(j), 0.44, 0.07, 0.44, c, "solid", 0.02); // CORE-WALK: oturak üstü 0,62 (istasyon y ile aynı; kalça gömülmez)
  }
  done(): Built {
    // CORE-WALK (REAL-SEAT): oturan istasyonun `y`'si verilmemişse altındaki gerçek oturağın üst yüzü (ajan oturağa oturur)
    resolveStationSeats(this.blocks, this.stations, tx, tz);
    return {
      props: this.props,
      blocks: this.blocks, blocked: this.blocked, stations: this.stations, rest: this.rest, lights: this.lights, spots: this.spots,
      ambient: this.ambient, width: this.w, depth: this.d, modules: [{ i0: 0, j0: 0, w: this.w, d: this.d, base: true, slots: [0, this.stations.length] }],
      ...(this.zones.length ? { zones: this.zones } : {}),
      ...(this.keepOut.length ? { keepOut: this.keepOut } : {}),
      ...(this.backdrop.length ? { backdrop: this.backdrop } : {}),
      ...(this.movers.length ? { movers: this.movers } : {}),
    };
  }
}

// ------------------------------------------------------------------------------------------ sahneler
function office(): Built {
  const b = new Builder(11);
  // S33: mor halı ön sıranın önünde; sağ altta yeşil halılı dinlenme köşesi (kanepe, ayaklı lamba)
  const lounge = (i: number, j: number) => i >= 18 && i <= 22 && j >= 13 && j <= 15;
  b.ground((i, j) => (lounge(i, j) ? ((i + j) % 2 ? "#5E8C6A" : "#689A74")
    : i >= 9 && i <= 14 && j >= 12 && j <= 14 ? ((i + j) % 2 ? "#7C6CF0" : "#8E80F5") : j % 2 ? "#B88758" : "#AD7C4E"), "#7A5230", 0.04);
  b.wall(0, 0, 23, 4, (_i, y) => (y === 0 ? "#C9BBA5" : "#ECE6DA"), [[2, 5], [9, 13], [19, 21]]);
  b.sideWall(0, 1, 9, 3, "#E2DACB");
  // beyaz tahta
  b.box(tx(16), 1.8, tz(0) + 0.55, 2.6, 1.2, 0.08, "#F8FAFC");
  [["#3B82F6", 1.4, 2.1], ["#EF4444", 1.0, 1.9], ["#10B981", 1.6, 1.6], ["#F59E0B", 0.8, 1.35]].forEach(([c, w, y]) =>
    b.box(tx(16) - 0.4 + (w as number) / 4, y as number, tz(0) + 0.6, w as number, 0.08, 0.03, c as string));
  // kitaplık + üstünde canlı skor panosu (S33)
  for (const i of [6, 7]) {
    b.box(tx(i), 1.1, tz(1), 1, 2.2, 0.8, "#7B5236", "solid", 0.04);
    for (const y of [0.5, 1.2, 1.9]) for (let k = 0; k < 4; k++)
      b.box(tx(i) - 0.33 + k * 0.22, y, tz(1) + 0.42, 0.16, 0.45, 0.05, ["#EF4444", "#3B82F6", "#F59E0B", "#10B981"][(k + i) % 4]);
    b.block(i, 1);
  }
  b.scoreboard(6, 0, 2);
  // kahve köşesi (S33: kahve makinesi boştaki ajanların uğrak yeri) + su sebili
  b.coffeeMachine(15, 1, "+z");
  b.box(tx(16), 0.45, tz(1), 1, 0.9, 0.8, "#94A3B8"); b.block(16, 1);
  b.box(tx(16) - 0.15, 0.95, tz(1), 0.3, 0.06, 0.3, "#F59E0B"); b.box(tx(16) + 0.22, 0.98, tz(1) + 0.1, 0.12, 0.14, 0.12, "#F8FAFC");
  b.box(tx(22), 0.5, tz(1), 0.6, 1, 0.6, "#E5E7EB"); b.box(tx(22), 1.25, tz(1), 0.45, 0.5, 0.45, "#7DD3FC", "glass"); b.block(22, 1);
  // masalar. Sıra arka sıra soldan sağa, sonra ön sıra: ardışık istasyonlar yan yana düşer, böylece aynı ekibin üyeleri
  // komşu masalara oturur (bkz. assignStations). S33: arka sıra kameraya bakar (monitörün arkası görünür), ön sıra
  // sırtı kameraya dönük oturur (kayan kodlu ekran görünür); her istasyonda sandalye, masada monitör + klavye + lamba.
  for (const [i, j] of [[3, 7], [8, 7], [14, 7], [19, 7], [5, 11], [10, 11], [16, 11], [21, 11]] as Tile[]) {
    const front = j === 11;
    const aj = front ? j + 1 : j - 1;
    b.desk(i, j, 2, "#E7D7C1", "#6B7280", true);
    b.monitor(i, j, front ? "+z" : "-z", 0, front ? -0.14 : 0.14);
    b.box(tx(i), 0.81, tz(j) + (front ? 0.26 : -0.26), 0.5, 0.03, 0.16, "#CBD5E1");
    b.deskLamp(i + 1, j, "#FDE68A", 0.25, front ? 0.25 : -0.25);
    b.station(i, aj, front ? DOWN : UP, "sit_chair", "desktop");
    b.chair(i, aj, front ? "-z" : "+z");
  }
  // HOTEL-SYS (E1): görünür uyku kapsülü yok — ön köşede dinlenme odası kapısı (geçit; içerisi ayrı dinlenme salonu), yumuşak halı
  b.box(tx(5.5), 0.012, tz(15), 8, 0.024, 0.96, "#C7CEDB", "solid", 0.02);
  placeHotel(b, "office", { at: [3, 14], w: 2, d: 1, door: [3, 15] });
  b.hook("window", 3, 1); b.hook("window", 11, 1); b.hook("window", 20, 1);
  // dinlenme köşesi: kanepe, ayaklı lamba
  b.sofa(19, 14, "#5B7DB1", "#4A6A9C");
  b.rest.push([19, 13], [20, 13], [21, 13]);
  b.lamp(22, 14, "#FFE3A3");
  for (const [i, j] of [[1, 12], [23, 14], [12, 3], [1, 15]] as Tile[]) b.plant(i, j);
  // kabuk: köşedeki terminal + sol duvarda iki sunucu dolabı (yanıp sönen LED'ler)
  b.terminal(20, 1, "+z");
  b.serverRack(0, 10, "+x"); b.serverRack(0, 11, "+x");
  b.spot("web", 3, 1, DOWN); b.spot("web", 11, 1, DOWN); b.spot("web", 13, 1, DOWN);
  b.spot("read", 6, 2, DOWN); b.spot("read", 7, 2, DOWN);
  b.spot("plan", 17, 1, DOWN); b.spot("plan", 14, 2, DOWN);
  b.spot("shell", 20, 2, DOWN); b.spot("shell", 19, 2, DOWN); b.spot("shell", 1, 10, LEFT); b.spot("shell", 1, 11, LEFT);
  b.lights.push({ pos: [0, 3.5, 2], color: "#FFE8C2", intensity: 6, distance: 14 });
  aquarium(b, 23, 5); // S45: iç mekân canlı ortamı (AQUA-PREF-001); (EXIT-FACE-001): (23, 3) üst kat kapısının çıkış önünü kapatıyordu
  return b.done();
}

/** Park (S41: masa yok): bank, ağaç altında piknik örtüsü ve gölet iskelesi; dizüstü kucakta. Hamak ve çim örtülerinde uyku. */
function park(): Built {
  const b = new Builder(7);
  const path = (i: number, j: number) => Math.abs(j - (8 + Math.round(2 * Math.sin(i / 3)))) <= 0;
  const pond = (i: number, j: number) => i >= 17 && i <= 21 && j >= 1 && j <= 4;
  const pier = (i: number, j: number) => i === 19 && j >= 3 && j <= 4;
  b.ground((i, j) => (pond(i, j) ? null : path(i, j) ? "#C9A36B" : (i * 7 + j * 3) % 9 === 0 ? "#5FAF3C" : "#6DBE45"), "#8B5A2B", 0.09);
  for (let i = 17; i <= 21; i++) for (let j = 1; j <= 4; j++) {
    b.box(tx(i), -0.6, tz(j), 1, 0.8, 1, (i + j) % 3 ? "#3B9DDB" : "#3591CC", "water");
    if (!pier(i, j)) b.block(i, j);
  }
  // gölet: nilüferler, kamış, iskele (uç: suya bakan oturma yeri)
  b.box(tx(18), -0.17, tz(2), 0.5, 0.04, 0.5, "#2F855A"); b.box(tx(20.6), -0.17, tz(1.6), 0.4, 0.04, 0.4, "#38A169");
  b.box(tx(18) + 0.1, -0.13, tz(2), 0.12, 0.06, 0.12, "#F9A8D4");
  for (const [x, z] of [[16.6, 1.2], [16.7, 3.6], [21.6, 4.2]]) for (let k = 0; k < 3; k++) b.box(tx(x) + k * 0.12, 0.25 + k * 0.08, tz(z), 0.05, 0.5 + k * 0.16, 0.05, "#4D7C2F");
  for (let j = 3; j <= 4; j++) {
    for (const o of [-0.33, 0, 0.33]) b.box(tx(19) + o, -0.03, tz(j), 0.28, 0.1, 0.96, (j % 2) ? "#A0805A" : "#94744F", "solid", 0.05);
    for (const dx of [-0.45, 0.45]) b.box(tx(19) + dx, -0.45, tz(j) - 0.4, 0.1, 0.9, 0.1, "#6B4F35");
  }
  b.hook("pond", 19, 2, 2.5);
  for (const [i, j, h] of [[2, 2, 3], [7, 1, 4], [12, 2, 3], [22, 10, 3], [1, 13, 4], [10, 14, 3]]) b.tree(i, j, h);
  for (const [i, j] of [[4, 1], [14, 1], [23, 6], [16, 15]] as Tile[]) { b.cube(i, j, 0, "#2F7D32", 1, "solid", 0.15); b.block(i, j); }

  // banklar: oturan patikaya (kameraya) bakar; dizüstü kucakta, yanında çanta/fincan (orta karo)
  const benchPair = (i: number, j: number) => {
    b.parkBench(i, j, 3, "+z");
    b.station(i, j, UP, "sit_bench", "laptop", 0.46); b.station(i + 2, j, UP, "sit_bench", "laptop", 0.46);
    b.closedLaptop(tx(i + 1), 0.46, tz(j)); b.box(tx(i + 1) + 0.22, 0.54, tz(j) - 0.05, 0.1, 0.14, 0.1, "#F8FAFC");
    b.block(i + 1, j);
  };
  benchPair(12, 5); benchPair(4, 9); benchPair(19, 7);
  // gölet iskelesinin ucu: suya karşı oturan (iki kişi)
  b.station(19, 3, DOWN, "sit_ground", "laptop", 0.05); b.groundLaptop(19, 3, "-z", 0.05);
  // ağaç altında piknik örtüleri: örtüde bağdaş, dizüstü önde; ortada sepet
  const picnic = (i: number, j: number, c: string) => {
    b.blanket(i, j, 3, 2, c);
    b.basket(i + 1, j);
    for (const di of [0, 2]) { b.station(i + di, j + 1, UP, "sit_ground", "laptop", 0.04); b.groundLaptop(i + di, j + 1, "+z", 0.04); }
  };
  picnic(13, 9, "#E07A5F"); picnic(20, 12, "#6C8EBF"); picnic(5, 12, "#F2B33D");
  // fenerler patika boyunca (kuşların tüneği), çöp kutusu, kahve arabası
  for (const [i, j] of [[8, 11], [16, 5], [3, 7]] as Tile[]) { b.lantern(i, j, "#FFE3A3", "#2F3A2C"); b.hook("perch", i, j); }
  b.box(tx(11), 0.35, tz(9), 0.4, 0.7, 0.4, "#3F6E5A"); b.box(tx(11), 0.72, tz(9), 0.46, 0.06, 0.46, "#2F5A48"); b.block(11, 9);
  b.box(tx(16), 0.5, tz(11), 0.9, 0.7, 0.7, "#F2B33D", "solid", 0.03);
  for (const dx of [-0.35, 0.35]) b.box(tx(16) + dx, 0.12, tz(11) + 0.3, 0.08, 0.24, 0.24, "#1F2937");
  b.box(tx(16), 1.9, tz(11), 1.2, 0.1, 1.0, "#E07A5F"); b.box(tx(16), 1.35, tz(11), 0.06, 1.0, 0.06, "#9CA3AF");
  b.coffeeMachine(16, 11, "+z", true); b.block(16, 11);
  // HOTEL-SYS (E1): hamak ve çim örtüsü yatakları kalktı — uyku parkın ahşap kulübesinin geçidinde (sol kıyı, kapı (1, 11))
  // (EXIT-FACE-001): kapı (0, 11) — (1, 11) kapısından çıkışta önü (1, 13) engeldi
  placeHotel(b, "park", { at: [0, 9], w: 2, d: 2, door: [0, 11] });
  // dinlenme: bank ve ağaç altı
  b.parkBench(4, 15, 2, "-z", "#8B5A2B");
  b.rest.push([4, 14], [5, 14], [16, 9]); // REAL-SEAT: dinlenme bankın önündeki zeminde (eskiden bankın üstündeki karolarda: y 0,46)
  b.terminal(0, 8, "+x");
  b.spot("web", 18, 5, DOWN); b.spot("web", 20, 5, DOWN);
  b.spot("read", 7, 2, DOWN); b.spot("read", 2, 3, DOWN);
  b.spot("plan", 12, 3, DOWN);
  b.spot("shell", 1, 8, LEFT);
  b.hook("grass", 6, 6, 5); b.hook("grass", 16, 13, 4);
  b.flowers(70, (i, j) => !path(i, j) && !pond(i, j));
  for (let k = 0; k < 6; k++) b.cloud(-14 + k * 6, 7.5 + (k % 3) * 0.8, -6 + (k % 2) * 4);
  return b.done();
}

/** Ev: ofisten ayrışan sıcak bir daire — balıksırtı parke, adaçayı duvar kâğıdı, şömine, mutfak adası, yemek masası,
 *  okuma köşesi ve kedi. Sekiz istasyonun hiçbiri ofis masası sırası değildir (ada, yemek masası, çalışma köşesi, berjerler). */
function home(): Built {
  const b = new Builder(5);
  const kitchen = (i: number, j: number) => i >= 16 && j >= 1 && j <= 6;
  const livingRug = (i: number, j: number) => i >= 2 && i <= 7 && j >= 6 && j <= 9;
  const diningRug = (i: number, j: number) => i >= 9 && i <= 14 && j >= 7 && j <= 11;
  b.ground((i, j) => {
    if (kitchen(i, j)) return (i + j) % 2 ? "#F3F4F6" : "#9CC3D5";
    if (livingRug(i, j)) return i === 2 || i === 7 || j === 6 || j === 9 ? "#9A3412" : (i + j) % 2 ? "#E07A5F" : "#F2CC8F";
    if (diningRug(i, j)) return i === 9 || i === 14 || j === 7 || j === 11 ? "#3F6E5A" : (i * 2 + j) % 3 ? "#7FB59A" : "#93C5AC";
    return (i + j) % 4 < 2 ? "#C99A6B" : "#B98A5C";
  }, "#8B6B4A", 0.04);
  // duvarlar: adaçayı duvar kâğıdı, süpürgelik, perdeli pencereler, tablo
  const windows: [number, number][] = [[12, 14], [18, 19]];
  b.wall(0, 0, 23, 4, (i, y) => (y === 0 ? "#8B6B4A" : y === 3 ? "#F3E9DC" : i % 2 ? "#B7C9A8" : "#AABD9A"), windows);
  b.sideWall(0, 1, 11, 3, "#B2C5A2");
  for (const [a, c] of windows) {
    b.box((tx(a) + tx(c)) / 2, 2.62, tz(0) + 0.6, c - a + 2.4, 0.06, 0.06, "#6B4F3A");
    for (const x of [tx(a) - 0.68, tx(c) + 0.68]) b.box(x, 1.8, tz(0) + 0.6, 0.34, 1.55, 0.08, "#C2410C");
  }
  b.box(tx(8.5), 2.2, tz(0) + 0.53, 1.2, 0.9, 0.06, "#7C3AED"); b.box(tx(8.5), 2.2, tz(0) + 0.57, 0.95, 0.65, 0.02, "#FDE68A");

  // oturma odası: TV ünitesi, sehpa, TV'ye dönük kanepe
  b.box(tx(3.5), 0.3, tz(1), 4, 0.6, 0.7, "#6B4F3A"); for (const i of [2, 3, 4, 5]) b.block(i, 1);
  b.box(tx(3.5), 1.15, tz(1), 2.2, 1.1, 0.12, "#111827"); b.box(tx(3.5), 1.15, tz(1) + 0.07, 2, 0.9, 0.02, "#60A5FA", "glow");
  b.box(tx(3.5), 0.24, tz(2.5), 1.7, 0.08, 1.2, "#A47148", "solid", 0.03);
  for (const [dx, dz] of [[-0.75, -0.5], [0.75, -0.5], [-0.75, 0.5], [0.75, 0.5]]) b.box(tx(3.5) + dx, 0.1, tz(2.5) + dz, 0.08, 0.2, 0.08, "#6B4F3A");
  b.box(tx(3.2), 0.33, tz(2.4), 0.3, 0.1, 0.22, "#F59E0B"); b.box(tx(3.9), 0.32, tz(2.6), 0.18, 0.08, 0.18, "#F8FAFC");
  for (const i of [3, 4]) for (const j of [2, 3]) b.block(i, j);
  b.box(tx(3.5), 0.3, tz(4), 4, 0.6, 1, "#6C8EBF", "solid", 0.04);
  b.box(tx(3.5), 0.8, tz(4) + 0.4, 4, 0.9, 0.25, "#5878A8", "solid", 0.04);
  for (const [dx, c] of [[-1.2, "#FDE68A"], [1.1, "#F9A8D4"]] as [number, string][]) b.box(tx(3.5) + dx, 0.75, tz(4) + 0.18, 0.5, 0.42, 0.14, c);
  for (const i of [2, 3, 4, 5]) b.block(i, 4);
  b.rest.push([3, 7], [5, 8], [6, 7]);

  // şömine (sol duvar): alev "flame" grubunda, hareket azaltmada durur
  b.box(tx(0) + 0.75, 0.8, tz(7.5), 0.5, 1.6, 2.2, "#9A4A3A", "solid", 0.06);
  b.box(tx(0) + 0.7, 2.35, tz(7.5), 0.4, 1.5, 1.2, "#8C4434", "solid", 0.05);
  b.box(tx(0) + 1.01, 0.45, tz(7.5), 0.03, 0.75, 1.1, "#1F1A17");
  b.box(tx(0) + 0.88, 1.65, tz(7.5), 0.8, 0.1, 2.5, "#6B4F3A");
  b.box(tx(0) + 1.05, 0.12, tz(7.5), 0.18, 0.12, 0.9, "#5D3A1A");
  b.box(tx(0) + 1.05, 0.38, tz(7.5), 0.22, 0.4, 0.6, "#FF7A1A", "flame"); b.box(tx(0) + 1.06, 0.62, tz(7.5), 0.16, 0.3, 0.36, "#FFD34D", "flame");
  for (const [dz, c] of [[-0.8, "#F2CC8F"], [0.7, "#93C5FD"]] as [number, string][]) b.box(tx(0) + 0.95, 1.85, tz(7.5) + dz, 0.2, 0.3, 0.2, c);
  b.block(1, 7); b.block(1, 8);
  b.lights.push({ pos: [tx(1), 0.9, tz(7.5)], color: "#FF9A3C", intensity: 6, distance: 9, flicker: true });

  // çalışma köşesi + kitaplık (okuma) + ev bilgisayarı (kabuk)
  b.desk(8, 2, 2, "#A47148", "#6B4F3A"); b.station(8, 1, UP, "sit_chair", "laptop");
  b.box(tx(9) + 0.25, 1.05, tz(2) - 0.25, 0.1, 0.5, 0.1, "#374151"); b.box(tx(9) + 0.25, 1.32, tz(2) - 0.25, 0.28, 0.12, 0.28, "#FDE68A", "glow");
  for (const i of [10, 11]) {
    b.box(tx(i), 1.1, tz(1), 1, 2.2, 0.8, "#7B5236", "solid", 0.04);
    for (const y of [0.5, 1.2, 1.9]) for (let k = 0; k < 4; k++)
      b.box(tx(i) - 0.33 + k * 0.22, y, tz(1) + 0.42, 0.16, 0.45, 0.05, ["#E07A5F", "#3F6E5A", "#F2CC8F", "#6C8EBF"][(k + i) % 4]);
    b.block(i, 1);
  }
  b.terminal(15, 1, "+z");

  // mutfak: tezgâh, üst dolaplar, lavabo, ocak, buzdolabı ve ada (iki istasyon)
  for (let i = 16; i <= 22; i++) {
    b.cube(i, 1, 0, "#F5F5F4", 0.9); b.box(tx(i), 0.93, tz(1), 1, 0.06, 1, "#57534E"); b.block(i, 1);
    if (i < 18 || i > 19) b.box(tx(i), 2.35, tz(0) + 0.78, 0.96, 0.8, 0.5, "#E7E5E4", "solid", 0.02);
  }
  b.box(tx(18.5), 0.96, tz(1), 1.2, 0.03, 0.6, "#94A3B8"); b.box(tx(18.5), 1.15, tz(1) - 0.3, 0.06, 0.36, 0.06, "#CBD5E1");
  b.box(tx(21), 0.97, tz(1), 0.7, 0.03, 0.7, "#1F2937"); b.box(tx(21), 1.0, tz(1), 0.25, 0.02, 0.25, "#F97316", "glow");
  b.cube(23, 1, 0, "#E7E5E4", 2.2); b.box(tx(23) - 0.3, 1.3, tz(1) + 0.51, 0.06, 0.6, 0.03, "#94A3B8"); b.block(23, 1);
  b.box(tx(18.5), 0.45, tz(5), 4, 0.9, 1, "#3F6E5A", "solid", 0.03);
  b.box(tx(18.5), 0.93, tz(5), 4.1, 0.08, 1.1, "#F8FAFC", "solid", 0.02);
  for (const i of [17, 18, 19, 20]) b.block(i, 5);
  for (const i of [17, 19]) { b.laptop(tx(i), 0.97, tz(5), "-z"); b.stool(i, 4, "#E07A5F"); b.station(i, 4, UP, "sit_chair", "laptop", 0.62); }
  b.box(tx(18.4), 1.05, tz(5) + 0.15, 0.4, 0.12, 0.4, "#F59E0B"); b.box(tx(18.4), 1.14, tz(5) + 0.15, 0.16, 0.12, 0.16, "#EF4444");
  // REAL-SUPPORT: sarkıt lambalar ada tezgâhının ucundaki dikmeden uzanan kola asılı (eskiden tavansız havada)
  for (const x of [tx(17.5), tx(19.6)]) b.box(x, 2.65, tz(5), 0.4, 0.25, 0.4, "#FDE68A", "glow");
  b.armLamp(tx(20.4), tz(5), 0.97, tx(19.6), tz(5), 2.775);
  b.box((tx(17.5) + tx(19.6)) / 2, 3.4, tz(5), tx(19.6) - tx(17.5) + 0.05, 0.04, 0.05, "#1F2937");
  b.box(tx(17.5), 3.09, tz(5), 0.03, 0.62, 0.03, "#1F2937");
  for (const i of [18, 20]) {
    b.box(tx(i), 0.35, tz(6), 0.4, 0.7, 0.4, "#6B4F3A"); b.box(tx(i), 0.72, tz(6), 0.5, 0.08, 0.5, "#E07A5F"); b.block(i, 6);
  }

  // yemek masası (iki istasyon), önde sandalyeler, üstte sarkıt lamba
  b.box(tx(11.5), 0.74, tz(9), 4, 0.1, 1.1, "#8B5E3C", "solid", 0.03);
  for (const [dx, dz] of [[-1.85, -0.4], [1.85, -0.4], [-1.85, 0.4], [1.85, 0.4]]) b.box(tx(11.5) + dx, 0.35, tz(9) + dz, 0.1, 0.7, 0.1, "#5D3A1A");
  for (const i of [10, 11, 12, 13]) b.block(i, 9);
  for (const i of [10, 12]) { b.laptop(tx(i), 0.79, tz(9), "-z"); b.station(i, 8, UP, "sit_chair", "laptop"); }
  b.box(tx(11.5), 0.95, tz(9), 0.2, 0.32, 0.2, "#93C5FD", "glass");
  for (const [dx, c] of [[-0.06, "#F472B6"], [0.07, "#FDE047"]] as [number, string][]) b.box(tx(11.5) + dx, 1.18, tz(9), 0.12, 0.12, 0.12, c);
  for (const i of [10, 11, 12, 13]) {
    b.box(tx(i), 0.45, tz(10) - 0.05, 0.55, 0.08, 0.55, "#6B4F3A");
    b.box(tx(i), 0.78, tz(10) + 0.22, 0.55, 0.6, 0.06, "#6B4F3A");
    for (const dx of [-0.22, 0.22]) b.box(tx(i) + dx, 0.2, tz(10), 0.06, 0.4, 0.06, "#5D3A1A");
    b.block(i, 10);
  }
  b.box(tx(11.5), 2.7, tz(9), 0.9, 0.2, 0.4, "#FDE68A", "glow");
  b.armLamp(tx(11.5) + 1.7, tz(9), 0.79, tx(11.5), tz(9), 2.8); // REAL-SUPPORT: masanın ucundan yükselen kol

  // HOTEL-SYS (E1): yatak odası görünmez — kapısı (geçit) komodinlerin arasında; içerisi ayrı dinlenme salonu; şövale köşede
  b.box(tx(20.5), 0.012, tz(13.5), 4.6, 0.024, 2.8, "#E9D5FF", "solid", 0.02);
  // (EXIT-FACE-001): kapı odaya (kuzey, (20, 12)) — güney kapısı (20, 14) dünyanın son sırasına, kenara açılıyordu
  placeHotel(b, "home", { at: [20, 13], w: 2, d: 1, door: [20, 12] });
  for (const i of [19, 22]) {
    b.box(tx(i), 0.28, tz(13) - 0.2, 0.6, 0.56, 0.5, "#A47148", "solid", 0.03); b.block(i, 13);
    b.box(tx(i), 0.68, tz(13) - 0.2, 0.2, 0.24, 0.2, "#FDE68A", "glow");
  }
  b.box(tx(17), 1.05, tz(11), 0.9, 2.1, 0.8, "#8B6B4A", "solid", 0.03); b.box(tx(17) + 0.02, 1.05, tz(11) + 0.41, 0.03, 1.9, 0.02, "#5D3A1A"); b.block(17, 11);
  b.box(tx(21), 0.6, tz(10), 0.08, 1.2, 0.5, "#8B5A2B"); b.box(tx(21) - 0.05, 1.15, tz(10), 0.04, 0.8, 0.7, "#F8FAFC");
  b.box(tx(21) - 0.08, 1.2, tz(10) - 0.1, 0.02, 0.3, 0.3, "#38BDF8"); b.box(tx(21) - 0.08, 1.0, tz(10) + 0.15, 0.02, 0.25, 0.25, "#F97316");
  b.block(21, 10);
  // şömine önü divanlar (oturma; HOTEL-SYS: uyku yatak odası kapısında) ve TV karşısında puf (çalışma)
  for (const j of [10, 11]) b.daybed(1, j, "#E07A5F", "#9A3412", "-x");
  b.box(tx(6), 0.2, tz(3), 0.8, 0.4, 0.8, "#3F6E5A", "solid", 0.06); b.box(tx(6), 0.42, tz(3) + 0.3, 0.8, 0.3, 0.2, "#2F5A48", "solid", 0.05);
  b.station(6, 3, DOWN, "lounge", "laptop", 0.4);

  // okuma köşesi: berjer + yan sehpa (iki istasyon), ayaklı lamba
  for (const i of [3, 6]) {
    b.box(tx(i), 0.3, tz(11), 0.95, 0.5, 0.8, "#D97706", "solid", 0.04);
    b.box(tx(i), 0.8, tz(11) - 0.3, 0.95, 0.8, 0.22, "#B45309", "solid", 0.04);
    for (const dx of [-0.42, 0.42]) b.box(tx(i) + dx, 0.6, tz(11), 0.12, 0.3, 0.8, "#B45309");
    b.block(i, 11);
    b.station(i, 12, UP, "sit_chair", "laptop");
    b.box(tx(i), 0.25, tz(13), 0.6, 0.5, 0.6, "#A47148", "solid", 0.03); b.laptop(tx(i), 0.5, tz(13), "-z"); b.block(i, 13);
  }
  b.box(tx(1), 0.7, tz(12), 0.1, 1.4, 0.1, "#78716C"); b.box(tx(1), 1.5, tz(12), 0.5, 0.4, 0.5, "#FDE68A", "glow"); b.block(1, 12);
  b.lights.push({ pos: [tx(1), 1.6, tz(12)], color: "#FFD38A", intensity: 5, distance: 8 });

  // kedi yatağında
  b.box(tx(15), 0.08, tz(13), 0.9, 0.16, 0.9, "#7C3AED"); b.box(tx(15), 0.17, tz(13), 0.7, 0.04, 0.7, "#C4B5FD");
  b.box(tx(15), 0.32, tz(13), 0.46, 0.24, 0.32, "#F59E0B"); b.box(tx(15) + 0.28, 0.44, tz(13), 0.24, 0.22, 0.26, "#F59E0B");
  for (const dz of [-0.08, 0.08]) b.box(tx(15) + 0.3, 0.6, tz(13) + dz, 0.07, 0.08, 0.06, "#D97706");
  b.box(tx(15) + 0.41, 0.46, tz(13), 0.02, 0.04, 0.16, "#1F2937");
  b.box(tx(15) - 0.32, 0.26, tz(13) + 0.12, 0.3, 0.06, 0.06, "#D97706");
  b.block(15, 13);

  for (const [i, j] of [[1, 14], [23, 13], [9, 14]] as Tile[]) b.plant(i, j);
  b.spot("web", 12, 1, DOWN); b.spot("web", 13, 1, DOWN);
  b.spot("read", 10, 2, DOWN); b.spot("read", 11, 2, DOWN);
  b.spot("shell", 15, 2, DOWN);
  b.spot("plan", 22, 2, DOWN);
  aquarium(b, 23, 3, "#8B5E3C"); // S45: AQUA-PREF-001
  return b.done();
}

/** Sahil (S41): şemsiye altında şezlonglarda dizüstü; plaj barında ayakta; kabanada ve şezlong sırasında uyku. */
function beach(): Built {
  const b = new Builder(3);
  b.ground((i, j) => (j <= 4 ? null : j === 5 ? "#E3CF98" : (i * 5 + j * 3) % 7 ? "#EBD9A8" : "#E5D29E"), "#D6C08A", 0.05);
  for (let i = 0; i < W; i++) for (let j = 0; j <= 4; j++) {
    b.box(tx(i), -0.6, tz(j), 1, 0.8, 1, j === 4 ? "#7DD3FC" : j === 3 ? "#38BDF8" : "#1E8FD0", "water");
    b.block(i, j);
  }
  for (let i = 0; i < W; i += 2) b.box(tx(i) + 0.3, -0.17, tz(4) + 0.4, 0.6, 0.06, 0.2, "#F0F9FF");
  b.hook("sea", 12, 2, 10); b.hook("sand", 12, 10, 8);
  for (const [i, j] of [[1, 7], [22, 6], [12, 14]] as Tile[]) b.palm(i, j);
  // şezlong grupları: [şezlong][şemsiye + sehpa][şezlong]; ajan şezlonga uzanır, dizüstü karnında, yüzü denize (−z)
  const stripes = [["#EF4444", "#FFFFFF"], ["#3B82F6", "#FDE047"], ["#10B981", "#FFFFFF"], ["#F97316", "#FFFFFF"], ["#8B5CF6", "#FDE68A"], ["#E11D48", "#FDE68A"]];
  [[3, 8], [8, 8], [13, 8], [18, 8], [5, 11], [10, 11]].forEach(([i, j], n) => {
    const [c1, c2] = stripes[n];
    b.umbrella(i + 1, j, c1, c2);
    for (const di of [0, 2]) {
      b.sunLounger(i + di, j, "-z", c2 === "#FFFFFF" ? c1 : c2, "#F8FAFC");
      b.station(i + di, j, DOWN, "lounge", "laptop", 0.34);
    }
  });
  // plaj barı (ayakta çalışma + kahve) — sazdan çatı
  for (let i = 16; i <= 19; i++) { b.box(tx(i), 0.5, tz(12), 1, 1.0, 0.8, "#B07D48", "solid", 0.04); b.box(tx(i), 1.03, tz(12), 1, 0.06, 0.9, "#F8FAFC"); b.block(i, 12); }
  b.coffeeMachine(17, 12, "-z", true);
  b.laptop(tx(19), 1.06, tz(12), "-z");
  b.canopy(16, 19, 12, 12, "#D9B45A", 2.5, "#8B5E3C", "#CBA24A");
  b.station(19, 11, UP, "stand", "laptop"); b.station(16, 11, UP, "stand", "tablet");
  b.rest.push([18, 13], [16, 13], [15, 11]);
  // kabana: dört direkli tente, iki divan (dinlenme; HOTEL-SYS: uyku plaj kulübesinin geçidinde), sehpa
  b.canopy(20, 22, 13, 14, "#F8FAFC", 2.3, "#E5E7EB", "#7DD3FC");
  b.box(tx(21), 0.25, tz(13.5), 0.5, 0.5, 0.5, "#B07D48"); b.block(21, 13); b.block(21, 14);
  for (const i of [20, 22]) for (const j of [13, 14]) b.daybed(i, j, "#F8FAFC", "#7DD3FC", "-z");
  // ön sıra: şemsiye altında şezlonglar (plaj eşyası) + plaj kulübeleri; HOTEL-SYS: konak (saz çatılı kulübe, kapı (1, 13))
  for (const [i, c] of [[2, "#FCA5A5"], [3, "#FCA5A5"], [5, "#93C5FD"], [6, "#93C5FD"]] as [number, string][]) b.sunLounger(i, 14, "-z", c, "#E5E7EB");
  placeHotel(b, "beach", { at: [1, 11], w: 2, d: 2, door: [1, 13] });
  b.umbrella(4, 14, "#F97316"); b.umbrella(7, 14, "#14B8A6");
  for (const [i, c] of [[9, "#3B82F6"], [10, "#F59E0B"]] as [number, string][]) {
    b.box(tx(i), 0.9, tz(15), 0.9, 1.8, 0.8, c, "solid", 0.03); b.box(tx(i), 1.95, tz(15), 1.0, 0.3, 0.9, "#F8FAFC");
    b.box(tx(i), 0.7, tz(15) + 0.41, 0.4, 1.2, 0.02, "#1F2937"); b.block(i, 15); b.hook("roof", i, 15);
  }
  // kumdan kale, top, sörf tahtaları, cankurtaran kulesi
  b.cube(13, 13, 0, "#D9C08A", 0.6); b.box(tx(13) - 0.3, 0.8, tz(13) - 0.3, 0.3, 0.4, 0.3, "#D9C08A"); b.box(tx(13) + 0.3, 0.8, tz(13) + 0.3, 0.3, 0.4, 0.3, "#D9C08A"); b.block(13, 13);
  b.box(tx(11) + 0.2, 0.22, tz(14), 0.44, 0.44, 0.44, "#F43F5E");
  for (const [k, c] of [[0, "#F97316"], [1, "#14B8A6"], [2, "#F8FAFC"]] as [number, string][]) b.box(tx(15) - 0.3 + k * 0.3, 0.8, tz(15), 0.24, 1.6, 0.08, c);
  b.block(15, 15);
  const lx = tx(0), lz = tz(10);
  for (const dx of [-0.3, 0.3]) b.box(lx + dx, 0.9, lz, 0.1, 1.8, 0.1, "#F8FAFC");
  b.box(lx, 1.85, lz, 0.9, 0.12, 0.9, "#E11D48"); b.box(lx, 2.375, lz - 0.3, 0.9, 0.95, 0.1, "#E11D48"); b.box(lx, 2.85, lz, 1.0, 0.1, 1.0, "#F2B33D");
  b.block(0, 10); b.hook("perch", 0, 10);
  b.box(-6, 10, -18, 3, 3, 0.5, "#FFE066", "glow");
  b.terminal(23, 10, "-x");
  b.spot("web", 8, 5, DOWN); b.spot("web", 14, 5, DOWN); b.spot("web", 1, 10, LEFT);
  b.spot("read", 9, 14, DOWN); b.spot("read", 11, 13, DOWN);
  b.spot("plan", 17, 13, DOWN);
  b.spot("shell", 22, 10, RIGHT);
  for (let k = 0; k < 5; k++) b.cloud(-14 + k * 7, 8 + (k % 2), -9);
  return b.done();
}

function cafe(): Built {
  const b = new Builder(9);
  b.ground((i, j) => ((i + j) % 2 ? "#F1E3D3" : "#3B2F2F"), "#5B4636", 0.03);
  b.wall(0, 0, 23, 4, (i, y) => ((i + y) % 3 === 0 ? "#A44A35" : "#B5543C"), [[3, 6]]);
  b.sideWall(23, 1, 6, 3, "#9A4532");
  // menü tahtası
  b.box(tx(16.5), 2.4, tz(0) + 0.53, 3, 1.4, 0.06, "#1F3B2D");
  for (let k = 0; k < 4; k++) b.box(tx(16.5) - 0.5 + (k % 2) * 0.3, 2.85 - k * 0.27, tz(0) + 0.57, 1.6 - (k % 2) * 0.5, 0.06, 0.02, "#F8FAFC");
  // tezgâh + espresso
  for (let i = 11; i <= 19; i++) { b.cube(i, 2, 0, "#5B3A29", 0.95); b.box(tx(i), 0.98, tz(2), 1, 0.06, 1, "#2F2F2F"); b.block(i, 2); }
  b.box(tx(13), 1.3, tz(2), 0.7, 0.6, 0.5, "#9CA3AF"); b.box(tx(13), 1.35, tz(2) + 0.26, 0.4, 0.1, 0.02, "#34D399", "glow");
  b.box(tx(16.5), 1.25, tz(2), 1.8, 0.5, 0.8, "#BAE6FD", "glass");
  for (let k = 0; k < 4; k++) b.box(tx(16) + k * 0.4, 1.08, tz(2), 0.22, 0.12, 0.22, ["#F59E0B", "#FDE68A", "#B45309", "#FCA5A5"][k]);
  // masalar
  for (const [i, j] of [[4, 7], [9, 8], [15, 8], [20, 7], [6, 12], [17, 12]] as Tile[]) {
    b.box(tx(i), 0.35, tz(j), 0.15, 0.7, 0.15, "#3F3F46");
    b.box(tx(i), 0.74, tz(j), 0.95, 0.08, 0.95, "#8B5E3C", "solid", 0.03);
    b.block(i, j);
    b.laptop(tx(i), 0.78, tz(j), "-z");
    b.box(tx(i) + 0.32, 0.86, tz(j) + 0.2, 0.14, 0.16, 0.14, "#FFFFFF");
    b.station(i, j - 1, UP, "sit_chair", "laptop");
    b.box(tx(i), 0.45, tz(j + 1), 0.45, 0.08, 0.45, "#B45309"); b.box(tx(i), 0.22, tz(j + 1), 0.08, 0.44, 0.08, "#3F3F46");
  }
  // sarkıt lambalar
  // REAL-SUPPORT: lamba masanın arka köşesinden yükselen dikme + kola asılı (eskiden tavansız havada)
  for (const [i, j] of [[4, 7], [9, 8], [15, 8], [20, 7]] as Tile[]) {
    b.box(tx(i), 2.75, tz(j), 0.35, 0.22, 0.35, "#FCD34D", "glow");
    b.armLamp(tx(i) - 0.4, tz(j) - 0.4, 0.78, tx(i), tz(j), 2.86);
  }
  b.lights.push({ pos: [-2, 2.8, 0], color: "#FFC56B", intensity: 7, distance: 14 }, { pos: [6, 2.8, 0], color: "#FFC56B", intensity: 7, distance: 14 });
  // S41 — bar tezgâhında ayakta çalışma (dizüstü tezgâhta)
  for (const i of [11, 19]) { b.laptop(tx(i), 1.01, tz(2), "+z"); b.station(i, 3, DOWN, "stand", "laptop"); }
  // arka köşe: halı, sıcak lamba, divan ve puflar (oturma); HOTEL-SYS: uyku arka kapıdaki dinlenme odası geçidinde (6, 15)
  b.box(tx(1), 0.012, tz(11), 2.8, 0.024, 6.6, "#7C2D12", "solid", 0.02);
  for (let j = 8; j <= 13; j++) b.daybed(0, j, j % 2 ? "#B45309" : "#9A3412", "#6B260F", "-x");
  for (const i of [2, 3]) b.daybed(i, 15, "#B45309", "#6B260F", "+z");
  placeHotel(b, "cafe", { at: [6, 14], w: 2, d: 1, door: [6, 15] });
  b.lamp(1, 7, "#FFC56B");
  b.hook("window", 4, 1); b.hook("window", 5, 1);
  // koltuk (dinlenme)
  b.box(tx(21.5), 0.3, tz(14), 2, 0.6, 1, "#7C2D12", "solid", 0.05); b.box(tx(21.5), 0.8, tz(14) + 0.4, 2, 0.9, 0.2, "#6B260F");
  b.block(21, 14); b.block(22, 14);
  b.rest.push([21, 13], [22, 13], [12, 14]);
  for (const [i, j] of [[1, 2], [9, 1], [1, 14], [23, 9]] as Tile[]) b.plant(i, j);
  b.spot("web", 4, 1, DOWN); b.spot("web", 5, 1, DOWN);
  b.spot("read", 17, 3, DOWN); b.spot("read", 16, 3, DOWN);
  b.spot("shell", 13, 3, DOWN);
  b.spot("plan", 20, 3, DOWN);
  aquarium(b, 22, 5, "#3B2F2F", "#FDE68A"); // S45: AQUA-PREF-001
  return b.done();
}

function camp(): Built {
  const b = new Builder(13);
  const fire = (i: number, j: number) => Math.hypot(i - 12, j - 8) < 2.3;
  b.ground((i, j) => (fire(i, j) ? "#6B4F35" : "#355E2E"), "#4A3420", 0.1);
  // kamp ateşi
  for (let a = 0; a < 8; a++) b.box(tx(12) + Math.cos(a * 0.785) * 0.55, 0.1, tz(8) + Math.sin(a * 0.785) * 0.55, 0.25, 0.2, 0.25, "#78716C");
  b.box(tx(12), 0.12, tz(8), 0.9, 0.14, 0.18, "#5D3A1A"); b.box(tx(12), 0.18, tz(8), 0.18, 0.14, 0.9, "#6B4226");
  b.box(tx(12), 0.4, tz(8), 0.45, 0.45, 0.45, "#FF7A1A", "flame"); b.box(tx(12), 0.75, tz(8), 0.28, 0.35, 0.28, "#FFD34D", "flame");
  b.box(tx(12) + 0.15, 0.95, tz(8) - 0.05, 0.12, 0.2, 0.12, "#FFF3B0", "flame");
  b.block(12, 8);
  b.lights.push({ pos: [tx(12), 1.2, tz(8)], color: "#FF9A3C", intensity: 14, distance: 13, flicker: true });
  // kütükler ve istasyonlar (ateşe bakar)
  const seats: [number, number, number][] = [[12, 5, UP], [12, 11, DOWN], [9, 8, RIGHT], [15, 8, LEFT], [9, 5, UP], [15, 11, DOWN]];
  for (const [i, j, f] of seats) {
    b.station(i, j, f, "sit_bench", "laptop", 0.38);
    // CORE-WALK (REAL-SEAT): kütük kalçanın altında (eskiden 0,55 geride: ajan kütüğün önünde havada oturuyordu)
    const back = f === UP ? [0, -0.1] : f === DOWN ? [0, 0.1] : f === RIGHT ? [-0.1, 0] : [0.1, 0];
    b.box(tx(i) + back[0], 0.2, tz(j) + back[1], f === UP || f === DOWN ? 1 : 0.35, 0.35, f === UP || f === DOWN ? 0.35 : 1, "#7A4E2A");
    const front = [-back[0] * 0.9, -back[1] * 0.9];
    b.laptop(tx(i) + front[0], 0.02, tz(j) + front[1], f === UP ? "-z" : f === DOWN ? "+z" : f === RIGHT ? "-x" : "+x");
  }
  // S41 — açık önlü çadırlar (kamp dekoru; HOTEL-SYS: içeride yatak/tulum yok — uyku kamp kulübesinin geçidinde, kapı (11, 3));
  // katlanır kamp masası + sandalyeler
  for (const [i0, j0, c, d] of [[3, 1, "#F97316", "#C2410C"], [18, 1, "#22C55E", "#15803D"],
    [3, 11, "#EAB308", "#A16207"], [17, 11, "#0EA5E9", "#0369A1"]] as [number, number, string, string][]) {
    b.openTent(i0, j0, c, d);
    b.hook("roof", i0 + 1, j0 + 1);
  }
  placeHotel(b, "camp", { at: [10, 1], w: 2, d: 2, door: [11, 3] });
  b.box(tx(6), 0.66, tz(8), 0.9, 0.06, 0.7, "#A47148", "solid", 0.02);
  for (const dx of [-0.38, 0.38]) b.box(tx(6) + dx, 0.32, tz(8), 0.05, 0.64, 0.6, "#4B5563");
  b.laptop(tx(6) - 0.22, 0.69, tz(8), "-x"); b.laptop(tx(6) + 0.22, 0.69, tz(8), "+x");
  b.box(tx(6), 0.78, tz(8) - 0.25, 0.14, 0.2, 0.14, "#FDE68A", "glow");
  b.block(6, 8);
  b.campChair(5, 8, "+x", "#2563EB"); b.station(5, 8, RIGHT, "sit_chair", "laptop", 0.42);
  b.campChair(7, 8, "-x", "#DC2626"); b.station(7, 8, LEFT, "sit_chair", "laptop", 0.42);
  b.hook("grass", 6, 12, 5);
  b.box(tx(6), 0.2, tz(4), 0.25, 0.4, 0.25, "#FDE68A", "glow");
  b.lights.push({ pos: [tx(6), 0.8, tz(4)], color: "#FFE08A", intensity: 3, distance: 5 });
  for (const [i, j] of [[1, 7], [22, 7], [2, 13], [21, 13], [8, 1], [15, 1], [6, 14], [17, 15]] as Tile[]) b.pine(i, j);
  b.rest.push([4, 5], [19, 5], [11, 13]);
  // teleskop (web: gökyüzüne bakar)
  b.box(tx(20), 0.45, tz(10), 0.08, 0.9, 0.08, "#9CA3AF"); b.box(tx(20) - 0.2, 0.3, tz(10), 0.08, 0.6, 0.08, "#9CA3AF");
  b.box(tx(20), 1.0, tz(10), 0.9, 0.22, 0.22, "#E5E7EB"); b.block(20, 10);
  b.terminal(1, 10, "+x");
  b.spot("web", 19, 10, RIGHT);
  b.spot("read", 4, 4, DOWN);
  b.spot("plan", 19, 4, DOWN);
  b.spot("shell", 2, 10, LEFT);
  b.box(-9, 12, -18, 2.2, 2.2, 0.4, "#F8F5E1", "glow");
  b.flowers(25, (i, j) => !fire(i, j));
  return b.done();
}

// ------------------------------------------------------------------------------------------ Faz 3 sahneleri (S7)
/** Oyuncak tadında tatbikat alanı: siperler, kum torbaları, takım bayrakları, karargâh çadırı. Silah yok. */
function battlefield(): Built {
  const b = new Builder(21);
  const parade = (i: number, j: number) => i >= 8 && i <= 15 && j >= 4 && j <= 5;
  const trench = (i: number, j: number) => j === 14 && i >= 1 && i <= 8;
  b.ground((i, j) => (trench(i, j) ? "#5E4630" : parade(i, j) ? ((i + j) % 2 ? "#B39563" : "#A88B5C")
    : (i * 7 + j * 3) % 11 === 0 ? "#6E8F33" : (i + j) % 2 ? "#86A843" : "#7FA23A"), "#6B4F35", 0.07);

  // karargâh çadırı (arka orta) + tepesinde bayrak
  const cx = tx(11.5), cz = tz(2);
  [[5.6, 0.65], [4.6, 0.6], [3.4, 0.6], [2.0, 0.6]].forEach(([w, h], k) => // REAL-SUPPORT: tepe katı 0,6 (eskiden 0,5: altındaki kata 0,07 boşluk)
    b.box(cx, 0.33 + k * 0.62, cz, w, h, 2.8, k % 2 ? "#5E7A3A" : "#56703A", "solid", 0.04));
  b.box(cx, 0.55, cz + 1.41, 1.1, 1.1, 0.02, "#2A3320");
  b.box(cx - 0.75, 0.7, cz + 1.42, 0.4, 1.3, 0.03, "#7A9450");
  b.box(cx + 0.75, 0.7, cz + 1.42, 0.4, 1.3, 0.03, "#7A9450");
  b.box(cx, 3.2, cz, 0.08, 1.6, 0.08, "#E5E7EB");
  b.box(cx + 0.55, 3.62, cz, 1, 0.56, 0.04, "#F2B33D", "flag");
  b.box(cx + 0.55, 3.62, cz, 0.3, 0.24, 0.07, "#FFFFFF", "flag");
  for (let i = 9; i <= 14; i++) for (let j = 1; j <= 3; j++) b.block(i, j);
  b.box(tx(14), 0.725, tz(3.45), 0.04, 1.45, 0.04, "#374151"); // REAL-SUPPORT: fener direği yere iner (eskiden 0,3'lük kısa çubuk havada)
  b.box(tx(14), 1.05, tz(3.45), 0.22, 0.22, 0.22, "#FDE68A", "glow");
  b.lights.push({ pos: [tx(14), 1.4, tz(4)], color: "#FFD38A", intensity: 4, distance: 7 });

  // harita masası (plan): mavi ve kırmızı takım piyonları
  b.box(tx(11.5), 0.72, tz(4), 1.9, 0.1, 0.9, "#8A5A32", "solid", 0.03);
  for (const dx of [-0.8, 0.8]) for (const dz of [-0.33, 0.33]) b.box(tx(11.5) + dx, 0.34, tz(4) + dz, 0.1, 0.68, 0.1, "#5D3A1A");
  b.box(tx(11.5), 0.78, tz(4), 1.6, 0.02, 0.72, "#F3E7C9");
  b.box(tx(11.5) - 0.3, 0.8, tz(4) - 0.1, 0.5, 0.01, 0.2, "#7FB3D5");
  [["#4A9BE0", -0.55, 0.15], ["#4A9BE0", -0.35, -0.2], ["#E5584E", 0.45, 0.1], ["#E5584E", 0.6, -0.22], ["#F2B33D", 0.05, 0.02]].forEach(([c, dx, dz]) =>
    b.box(tx(11.5) + (dx as number), 0.86, tz(4) + (dz as number), 0.1, 0.14, 0.1, c as string));
  b.block(11, 4); b.block(12, 4);

  // gözetleme kulesi (web: dürbün)
  const wx = tx(21.5), wz = tz(1.5);
  for (const dx of [-0.8, 0.8]) for (const dz of [-0.8, 0.8]) {
    b.box(wx + dx, 1.4, wz + dz, 0.14, 2.8, 0.14, "#7A5230");
    b.box(wx + dx, 3.35, wz + dz, 0.08, 1.0, 0.08, "#7A5230");
  }
  b.box(wx, 2.86, wz, 2.0, 0.14, 2.0, "#8B6239", "solid", 0.04);
  for (const s of [-1, 1]) {
    b.box(wx, 3.2, wz + s * 0.8, 2.0, 0.07, 0.07, "#7A5230"); // REAL-SUPPORT: korkuluk direklerin içinden geçer (eskiden 0,16 dışarıda havada)
    b.box(wx + s * 0.8, 3.2, wz, 0.07, 0.07, 2.0, "#7A5230");
  }
  b.box(wx, 3.9, wz, 2.3, 0.16, 2.3, "#56703A", "solid", 0.05);
  b.box(wx, 3.1, wz + 0.9, 0.36, 0.16, 0.2, "#1F2937");
  for (let k = 0; k < 6; k++) b.box(wx - 0.3, 0.3 + k * 0.45, wz + 1.0, 0.5, 0.06, 0.06, "#6B4226");
  b.box(wx - 0.55, 1.4, wz + 1.0, 0.06, 2.8, 0.06, "#6B4226"); b.box(wx - 0.05, 1.4, wz + 1.0, 0.06, 2.8, 0.06, "#6B4226");
  for (const [i, j] of [[21, 1], [22, 1], [21, 2], [22, 2]] as Tile[]) b.block(i, j);

  // ikmal sandıkları kütüphanesi (okuma: el kitapları)
  for (const [i, k] of [[2, 0], [3, 1], [4, 0]] as [number, number][]) {
    b.crate(tx(i), 0, tz(1), 0.85);
    b.crate(tx(i) + (k ? 0.05 : -0.05), 0.85, tz(1), 0.7, "#A88050");
    b.box(tx(i), 0.45, tz(1) + 0.44, 0.3, 0.3, 0.02, "#F2E8CF");
    b.block(i, 1);
  }
  b.crate(tx(5), 0, tz(1), 0.6, "#8A6A3A"); b.block(5, 1);

  // telsiz masası (kabuk: sinyal)
  b.box(tx(17.5), 0.7, tz(1), 1.9, 0.1, 0.8, "#6E5230", "solid", 0.03);
  for (const dx of [-0.8, 0.8]) b.box(tx(17.5) + dx, 0.33, tz(1), 0.1, 0.66, 0.6, "#5D3A1A");
  b.box(tx(17), 1.0, tz(1), 0.8, 0.5, 0.5, "#4B5E33", "solid", 0.04);
  b.box(tx(17) - 0.15, 1.05, tz(1) + 0.26, 0.2, 0.2, 0.02, "#34D399", "glow");
  b.box(tx(17) + 0.18, 1.05, tz(1) + 0.26, 0.12, 0.12, 0.02, "#FCD34D", "glow");
  b.box(tx(17) + 0.3, 1.9, tz(1) - 0.1, 0.04, 1.3, 0.04, "#9CA3AF");
  b.box(tx(17) + 0.3, 2.6, tz(1) - 0.1, 0.1, 0.1, 0.1, "#F87171", "glow");
  b.laptop(tx(18), 0.75, tz(1), "+z");
  b.block(17, 1); b.block(18, 1);

  // takım bayrakları ("bayrağı kap" oyunu)
  b.flag(1, 4, "#E5584E", 3, "#FFFFFF");
  b.flag(22, 5, "#4A9BE0", 3, "#FFFFFF");
  b.flag(7, 1, "#F2B33D", 2.4);

  // tahta masalar (iki sıra) + önlerinde alçak kum torbası duvarı
  for (const [i, j] of [[3, 7], [8, 7], [14, 7], [19, 7], [5, 11], [10, 11], [16, 11], [20, 11]] as Tile[]) {
    b.desk(i, j, 2, "#9C7A4A", "#5D3A1A");
    b.station(i, j - 1, UP, "sit_chair", "laptop");
    b.sandbags(i, i + 1, j + 1, 1);
  }

  // siper (sol ön): koyu hendek, ızgara tahtaları, iki yanında kum torbaları
  for (let i = 1; i <= 8; i++) {
    for (const dz of [-0.3, 0, 0.3]) b.box(tx(i), 0.02, tz(14) + dz, 0.9, 0.04, 0.14, "#8A6A3A");
    b.block(i, 14);
  }
  b.sandbags(1, 8, 13, 1);
  b.sandbags(1, 8, 15, 2);

  // oyuncak cip (sol orta)
  const jx = tx(1.5), jz = tz(9.5);
  b.box(jx, 0.6, jz, 1.1, 0.5, 1.8, "#5E7A3A", "solid", 0.04);
  b.box(jx, 1.0, jz + 0.35, 1.0, 0.35, 0.1, "#BFE3F5", "glass");
  b.box(jx, 0.86, jz - 0.55, 1.12, 0.06, 0.6, "#4E6630");
  b.box(jx, 0.88, jz - 0.55, 0.22, 0.02, 0.22, "#FFFFFF");
  for (const dx of [-0.58, 0.58]) for (const dz of [-0.6, 0.6]) b.box(jx + dx, 0.26, jz + dz, 0.2, 0.52, 0.52, "#1F2937");
  for (const [i, j] of [[1, 9], [2, 9], [1, 10], [2, 10]] as Tile[]) b.block(i, j);

  // lastik parkuru (yürünebilir) ve trafik konileri
  for (let k = 0; k < 5; k++) {
    const x = tx(17 + k), z = tz(14);
    for (const [dx, dz, w, d] of [[0, -0.3, 0.7, 0.14], [0, 0.3, 0.7, 0.14], [-0.3, 0, 0.14, 0.46], [0.3, 0, 0.14, 0.46]])
      b.box(x + dx, 0.07, z + dz, w, 0.14, d, "#1F2937");
  }
  for (const [i, j] of [[16, 4], [7, 4], [16, 5]] as Tile[]) {
    b.box(tx(i), 0.05, tz(j), 0.4, 0.1, 0.4, "#F97316");
    b.box(tx(i), 0.25, tz(j), 0.24, 0.3, 0.24, "#F97316");
    b.box(tx(i), 0.24, tz(j), 0.26, 0.07, 0.26, "#FFFFFF");
  }

  // yemek alanı (dinlenme): kütük banklar + tencere ateşi
  b.box(tx(12), 0.22, tz(15), 3, 0.42, 0.5, "#7A4E2A", "solid", 0.05);
  for (const i of [11, 12, 13]) b.block(i, 15);
  b.rest.push([11, 14], [12, 14], [13, 14]);
  for (let a = 0; a < 6; a++) b.box(tx(15) + Math.cos(a * 1.05) * 0.4, 0.08, tz(15) + Math.sin(a * 1.05) * 0.4, 0.2, 0.16, 0.2, "#78716C");
  b.box(tx(15), 0.08, tz(15), 0.42, 0.16, 0.42, "#5D3A1A"); // REAL-SUPPORT: alev kütük tabanın üstünde (eskiden 0,17 havada)
  b.box(tx(15), 0.32, tz(15), 0.36, 0.3, 0.36, "#FF7A1A", "flame"); b.box(tx(15), 0.55, tz(15), 0.2, 0.22, 0.2, "#FFD34D", "flame");
  b.block(15, 15);
  b.lights.push({ pos: [tx(15), 1.0, tz(15)], color: "#FF9A3C", intensity: 6, distance: 7, flicker: true });

  for (const [i, j] of [[23, 12], [23, 13]] as Tile[]) {
    b.box(tx(i), 0.45, tz(j), 0.62, 0.9, 0.62, "#4B5E33", "solid", 0.05);
    b.box(tx(i), 0.92, tz(j), 0.64, 0.05, 0.64, "#3F4F2A");
    b.block(i, j);
  }
  b.tree(0, 7, 3);
  // HOTEL-SYS (E1): açık koğuş (8 portatif yatak) kalktı — uyku sahra barakasının geçidinde (kapı (16, 15))
  placeHotel(b, "battlefield", { at: [16, 13], w: 2, d: 2, door: [16, 15] });
  b.hook("roof", 16, 13); b.hook("grass", 12, 9, 6);
  b.spot("web", 21, 3, DOWN); b.spot("web", 22, 3, DOWN);
  b.spot("read", 3, 2, DOWN); b.spot("read", 4, 2, DOWN);
  b.spot("plan", 11, 5, DOWN); b.spot("plan", 12, 5, DOWN);
  b.spot("shell", 17, 2, DOWN); b.spot("shell", 18, 2, DOWN);
  for (let k = 0; k < 5; k++) b.cloud(-14 + k * 7, 8 + (k % 2) * 0.8, -8 + (k % 3));
  return b.done();
}

/** Açık deniz: iki ada, aralarında köprü, iskele ve dalgalanan su. Su karoları yürünmez. */
function openSea(): Built {
  const b = new Builder(17);
  const main = (i: number, j: number) => ((i - 8) / 7.2) ** 2 + ((j - 8) / 5.2) ** 2;
  const isle = (i: number, j: number) => ((i - 19.5) / 3.3) ** 2 + ((j - 5) / 2.8) ** 2;
  const land = (i: number, j: number) => main(i, j) <= 1 || isle(i, j) <= 1;
  const pier = (i: number, j: number) => (i === 12 && j >= 13 && j <= 15) || (j >= 14 && j <= 15 && i >= 11 && i <= 13);
  const bridge = (i: number, j: number) => j === 6 && (i === 15 || i === 16);
  const deck = (i: number, j: number) => pier(i, j) || bridge(i, j);
  const near = (i: number, j: number) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([a, c]) => land(i + a, j + c));

  b.ground((i, j) => {
    if (!land(i, j)) return null;
    const d = Math.min(main(i, j), isle(i, j));
    return d > 0.62 ? ((i + j) % 2 ? "#EBD9A8" : "#E3CF98") : (i * 3 + j) % 5 ? "#6DBE45" : "#62B03E";
  }, "#C9B27A", 0.06);
  for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) {
    if (land(i, j)) continue;
    const c = deck(i, j) ? "#2A9BDB" : near(i, j) ? "#5EC8F2" : (i * 5 + j * 3) % 7 === 0 ? "#2A9BDB" : "#1E8FD0";
    b.sea(i, j, c, -0.2, !deck(i, j));
    if (near(i, j) && !deck(i, j) && b.rand() < 0.35) b.box(tx(i) + (b.rand() - 0.5) * 0.5, -0.17, tz(j) + (b.rand() - 0.5) * 0.5, 0.5, 0.05, 0.16, "#F0F9FF", "wave");
  }
  // iskele ve köprü tahtaları + sudaki direkler
  for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) {
    if (!deck(i, j)) continue;
    const across = bridge(i, j);
    for (const o of [-0.33, 0, 0.33]) {
      if (across) b.box(tx(i) + o, -0.03, tz(j), 0.28, 0.1, 0.96, (i + j) % 2 ? "#A0805A" : "#94744F", "solid", 0.05);
      else b.box(tx(i), -0.03, tz(j) + o, 0.96, 0.1, 0.28, (i + j) % 2 ? "#A0805A" : "#94744F", "solid", 0.05);
    }
    for (const [dx, dz] of [[-0.45, -0.45], [0.45, 0.45]]) b.box(tx(i) + dx, -0.45, tz(j) + dz, 0.12, 0.9, 0.12, "#6B4F35");
  }
  for (const s of [-1, 1]) {
    b.box(tx(15.5), 0.35, tz(6) + s * 0.47, 2, 0.06, 0.06, "#C8A165");
    for (const e of [-0.95, 0.95]) b.box(tx(15.5) + e, 0.17, tz(6) + s * 0.47, 0.06, 0.34, 0.06, "#C8A165"); // REAL-SUPPORT: korkuluk direkleri köprü tahtasına basar
  }

  // kulübe (okuma: raflı hasır kulübe)
  const hx = tx(3.5), hz = tz(5.5);
  b.box(hx, 0.75, hz, 1.9, 1.5, 1.9, "#C8A165", "solid", 0.05);
  b.box(hx, 0.6, hz + 0.96, 0.6, 1.1, 0.02, "#5B3A1F");
  for (const dx of [-0.6, 0.6]) b.box(hx + dx, 0.95, hz + 0.96, 0.36, 0.3, 0.02, "#7DD3FC", "glass");
  [[2.5, 0.35], [2.0, 0.35], [1.3, 0.35], [0.6, 0.3]].forEach(([w, h], k) => b.box(hx, 1.6 + k * 0.33, hz, w, h, w, k % 2 ? "#D9B45A" : "#CBA24A", "solid", 0.06));
  for (const [i, j] of [[3, 5], [4, 5], [3, 6], [4, 6]] as Tile[]) b.block(i, j);

  // harita panosu (plan)
  for (const dx of [-0.9, 0.9]) b.box(tx(8.5) + dx, 0.7, tz(3), 0.1, 1.4, 0.1, "#6B4F35");
  b.box(tx(8.5), 1.15, tz(3), 1.9, 0.8, 0.08, "#8B6B47");
  b.box(tx(8.5), 1.15, tz(3) + 0.05, 1.7, 0.62, 0.02, "#F3E7C9");
  b.box(tx(8.5) - 0.3, 1.2, tz(3) + 0.07, 0.6, 0.3, 0.01, "#7FB3D5");
  b.box(tx(8.5) + 0.45, 1.05, tz(3) + 0.07, 0.3, 0.2, 0.01, "#6DBE45");
  b.block(8, 3); b.block(9, 3);

  // deniz feneri (web) — küçük adada
  for (let k = 0; k < 6; k++) b.box(tx(21), 0.3 + k * 0.6, tz(4), 0.9 - k * 0.04, 0.6, 0.9 - k * 0.04, k % 2 ? "#FFFFFF" : "#E5584E", "solid", 0.02);
  b.box(tx(21), 3.85, tz(4), 0.62, 0.5, 0.62, "#FDE68A", "glow");
  b.box(tx(21), 4.2, tz(4), 0.8, 0.18, 0.8, "#1F2937");
  b.block(21, 4);
  b.lights.push({ pos: [tx(21), 3.9, tz(4)], color: "#FFE08A", intensity: 5, distance: 10 });

  // telsiz köşkü (kabuk)
  b.terminal(7, 12, "+z");

  // S41 — adada masa yok: iskele ucunda oturma, ağaç altında örtü, palmiye gölgesinde şezlong ve bank, adacıkta bar
  for (const i of [11, 13]) { b.station(i, 15, UP, "sit_ground", "laptop", 0.08); b.groundLaptop(i, 15, "+z", 0.03); } // REAL-SUPPORT: dizüstü iskele tahtasına basar
  b.blanket(6, 8, 3, 2, "#E07A5F"); b.basket(7, 8);
  for (const i of [6, 8]) { b.station(i, 9, UP, "sit_ground", "laptop", 0.04); b.groundLaptop(i, 9, "+z", 0.04); }
  for (const i of [8, 9]) { b.sunLounger(i, 12, "+z", "#FDE68A", "#B07D48"); b.station(i, 12, UP, "lounge", "laptop", 0.34); }
  b.parkBench(12, 10, 2, "+z", "#A0805A", "#5D3A1A");
  for (const i of [12, 13]) b.station(i, 10, UP, "sit_bench", "laptop", 0.46);
  for (const i of [18, 19]) { b.box(tx(i), 0.5, tz(4), 1, 1.0, 0.8, "#8B5E3C", "solid", 0.04); b.box(tx(i), 1.03, tz(4), 1, 0.06, 0.9, "#F3E7C9"); b.block(i, 4); }
  b.laptop(tx(18), 1.06, tz(4), "+z"); b.box(tx(19), 1.14, tz(4), 0.14, 0.16, 0.14, "#F59E0B", "glass");
  b.canopy(18, 19, 4, 5, "#D9B45A", 2.3, "#7A4E2A", "#CBA24A");
  for (const i of [18, 19]) { b.stool(i, 5, "#E07A5F"); b.station(i, 5, DOWN, "sit_chair", "laptop", 0.62); }
  for (const [i, j] of [[2, 9], [6, 4], [13, 9], [10, 12], [22, 6]] as Tile[]) b.palm(i, j);
  // havlular (dinlenme) ve kumda uyku havluları
  [[3, 10, "#F472B6"], [4, 11, "#38BDF8"], [11, 11, "#FDE047"]].forEach(([i, j, c]) => {
    b.box(tx(i as number), 0.02, tz(j as number), 0.8, 0.04, 1.4, c as string);
    b.rest.push([i as number, j as number]);
  });
  // S46 (SLEEP-ZONE-001): (12, 11)/(13, 11) havluları ada barı taburelerinin (12–13, 10) dibindeydi → çimde (9–10, 7)
  // HOTEL-SYS (E1): çimdeki havlu yataklar kalktı — uyku adanın saz kulübesinin geçidinde (kapı (9, 8): örtünün ve (8, 9)
  // istasyonunun yanından kaydırıldı — SLEEP-ZONE-001)
  placeHotel(b, "sea", { at: [8, 6], w: 2, d: 2, door: [9, 8] });
  b.hook("sea", 20, 12, 6); b.hook("sea", 2, 2, 4); b.hook("sand", 8, 12, 3); b.hook("grass", 8, 7, 3); b.hook("perch", 21, 4);

  // suda: bağlı sandal, yelkenli, şamandıralar, balina
  b.box(tx(14), -0.05, tz(14.5), 0.9, 0.36, 1.8, "#F8FAFC", "bob", 0.02);
  b.box(tx(14), 0.15, tz(14.5), 0.92, 0.08, 1.82, "#D9453B", "bob");
  b.box(tx(14), 0.12, tz(14.5), 0.7, 0.08, 0.3, "#8B6B47", "bob");
  b.box(tx(19.5), -0.02, tz(12), 2.4, 0.42, 0.9, "#FFFFFF", "bob", 0.02);
  b.box(tx(19.5), 0.2, tz(12), 2.42, 0.08, 0.92, "#1E3A5F", "bob");
  b.box(tx(19.6), 1.5, tz(12), 0.08, 2.6, 0.08, "#E5E7EB", "bob");
  [[1.2, 0.5], [0.95, 1.0], [0.7, 1.5], [0.45, 2.0], [0.2, 2.4]].forEach(([w, y]) =>
    b.box(tx(19.6) + w / 2 + 0.06, 0.25 + y, tz(12), w, 0.5, 0.04, "#F8FAFC", "bob"));
  for (const [i, j] of [[16, 10], [2, 14], [22, 11], [17, 1]] as Tile[]) {
    b.box(tx(i), -0.05, tz(j), 0.36, 0.3, 0.36, "#E5584E", "bob");
    b.box(tx(i), 0.15, tz(j), 0.3, 0.12, 0.3, "#FFFFFF", "bob");
    b.box(tx(i), 0.32, tz(j), 0.12, 0.2, 0.12, "#FDE68A", "glow");
  }
  b.box(tx(3), -0.12, tz(1), 1.6, 0.3, 0.7, "#475569", "bob", 0.04);
  b.box(tx(3) - 0.95, 0.05, tz(1), 0.3, 0.12, 0.9, "#475569", "bob");
  b.box(tx(3) + 0.4, 0.12, tz(1), 0.16, 0.36, 0.16, "#BAE6FD", "bob");

  b.spot("web", 21, 5, DOWN); b.spot("web", 20, 4, RIGHT);
  b.spot("read", 3, 7, DOWN); b.spot("read", 4, 7, DOWN);
  b.spot("plan", 8, 4, DOWN); b.spot("plan", 9, 4, DOWN);
  b.spot("shell", 7, 13, DOWN);
  for (let k = 0; k < 5; k++) b.cloud(-14 + k * 7, 8.5 + (k % 2), -9 + (k % 3) * 2);
  return b.done();
}

/** Yat: tik güverte, havuz, kokpit; çevresi açık deniz. Kenar karoları korkuluktur (yürünmez). */
function yacht(): Built {
  const b = new Builder(29);
  const deck = (i: number, j: number) => {
    if (j < 2 || j > 13 || i < 1 || i > 22) return false;
    if (i <= 15) return true;
    return Math.abs(j - 7.5) <= 6 * (1 - (i - 15) / 8.5);
  };
  const edge = (i: number, j: number) => deck(i, j) && (!deck(i + 1, j) || !deck(i - 1, j) || !deck(i, j + 1) || !deck(i, j - 1));
  const pool = (i: number, j: number) => i >= 3 && i <= 6 && j >= 9 && j <= 11;
  const rim = (i: number, j: number) => !pool(i, j) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => pool(i + a, j + c));
  const WATER = -1.15;

  for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) {
    if (!deck(i, j)) { b.sea(i, j, (i * 3 + j * 5) % 7 === 0 ? "#2A9BDB" : "#1E8FD0", WATER); continue; }
    b.cube(i, j, -2, "#1E3A5F", 1, "solid", 0.03);
    if (pool(i, j)) {
      b.cube(i, j, -1, "#BAE6FD", 0.55, "solid", 0.02);
      b.box(tx(i), -0.27, tz(j), 1, 0.36, 1, "#38BDF8", "water");
      b.block(i, j);
      continue;
    }
    const c = edge(i, j) ? "#F1F5F9" : rim(i, j) ? "#F8FAFC" : i % 2 ? "#C08A57" : "#B47D4B";
    b.cube(i, j, -1, c, 1, "solid", edge(i, j) || rim(i, j) ? 0.02 : 0.05);
    if (edge(i, j)) {
      b.box(tx(i), 0.42, tz(j), 0.08, 0.84, 0.08, "#CBD5E1");
      if (edge(i + 1, j)) for (const y of [0.45, 0.84]) b.box(tx(i + 0.5), y, tz(j), 1, 0.05, 0.05, "#CBD5E1");
      if (edge(i, j + 1)) for (const y of [0.45, 0.84]) b.box(tx(i), y, tz(j + 0.5), 0.05, 0.05, 1, "#CBD5E1");
      if ((i + j) % 3 === 0) b.box(tx(i), 0.9, tz(j), 0.1, 0.1, 0.1, (i + j) % 2 ? "#FDE68A" : "#F9A8D4", "glow");
      b.block(i, j);
    }
  }
  // havuz merdiveni
  for (const dz of [-0.2, 0.2]) b.box(tx(6) + 0.45, 0.3, tz(10) + dz, 0.05, 0.7, 0.05, "#E2E8F0");

  // kokpit kabini (köprü üstü): beyaz gövde, koyu cam bant, radar direği
  const kx = tx(10.5), kz = tz(3.5);
  b.box(kx, 1.0, kz, 6, 2.0, 2, "#F8FAFC", "solid", 0.02);
  b.box(kx, 1.35, kz + 1.01, 5.6, 0.7, 0.04, "#22314A");
  b.box(kx, 1.6, kz + 1.03, 5.4, 0.06, 0.02, "#7DD3FC", "glow");
  b.box(kx, 2.1, kz + 0.2, 6.6, 0.18, 2.8, "#E2E8F0", "solid", 0.02);
  b.box(tx(11), 2.8, kz, 0.1, 1.3, 0.1, "#94A3B8");
  b.box(tx(11), 3.4, kz, 1.2, 0.1, 0.2, "#CBD5E1");
  b.box(tx(11), 3.55, kz, 0.1, 0.1, 0.1, "#F87171", "glow");
  for (let i = 8; i <= 13; i++) for (let j = 3; j <= 4; j++) b.block(i, j);
  b.lights.push({ pos: [tx(10.5), 2.4, tz(5.5)], color: "#FFE2B8", intensity: 4, distance: 10 });

  // dümen konsolu (kabuk) ve harita masası (plan)
  b.box(tx(11), 0.5, tz(5), 0.9, 1.0, 0.6, "#334155", "solid", 0.03);
  b.box(tx(11), 0.85, tz(5) + 0.31, 0.6, 0.3, 0.02, "#34D399", "glow");
  for (const [dx, dy, w, h] of [[0, 0.32, 0.5, 0.07], [0, -0.06, 0.5, 0.07], [-0.22, 0.13, 0.07, 0.42], [0.22, 0.13, 0.07, 0.42]])
    b.box(tx(11) + dx, 1.1 + dy, tz(5) + 0.36, w, h, 0.05, "#8B5A2B");
  b.block(11, 5);
  b.box(tx(9), 0.7, tz(5), 0.9, 0.1, 0.7, "#8B5A2B"); b.box(tx(9), 0.35, tz(5), 0.12, 0.7, 0.12, "#6B4226");
  b.box(tx(9), 0.76, tz(5), 0.7, 0.02, 0.5, "#F3E7C9"); b.box(tx(9) + 0.1, 0.78, tz(5), 0.3, 0.01, 0.2, "#7FB3D5");
  b.block(9, 5);

  // salon kitaplığı (okuma)
  for (let j = 4; j <= 6; j++) {
    b.box(tx(2), 0.8, tz(j), 0.6, 1.6, 1, "#7B5236", "solid", 0.04);
    for (const y of [0.45, 0.95, 1.4]) for (let k = 0; k < 4; k++)
      b.box(tx(2) + 0.31, y, tz(j) - 0.33 + k * 0.22, 0.04, 0.36, 0.15, ["#EF4444", "#3B82F6", "#F59E0B", "#10B981"][(k + j) % 4]);
    b.block(2, j);
  }

  // dürbün (web) — pruvada
  b.box(tx(19), 0.5, tz(7), 0.12, 1.0, 0.12, "#94A3B8");
  b.box(tx(19), 1.1, tz(7), 0.6, 0.22, 0.22, "#E2E8F0");
  b.block(19, 7);

  // şezlonglar (dinlenme) + şemsiye
  for (const i of [8, 9, 10]) {
    b.box(tx(i), 0.22, tz(12), 0.8, 0.14, 0.95, "#F8FAFC");
    sleds(b.box.bind(b), tx(i), tz(12), 0.8, 0.95, 0.15, "z"); // CORE-WALK (REAL-SEAT): şezlong yere basar
    b.box(tx(i), 0.3, tz(12) + 0.1, 0.7, 0.04, 0.7, ["#F472B6", "#38BDF8", "#FDE047"][i % 3]);
    b.box(tx(i), 0.45, tz(12) + 0.42, 0.8, 0.4, 0.1, "#F8FAFC");
    b.block(i, 12);
  }
  b.rest.push([8, 11], [9, 11], [10, 11]);
  b.box(tx(11), 1.1, tz(12), 0.08, 2.2, 0.08, "#E5E7EB");
  b.box(tx(11), 2.2, tz(12), 2.2, 0.14, 2.2, "#F8FAFC");
  for (const [dx, dz] of [[-0.55, -0.55], [0.55, 0.55]]) b.box(tx(11) + dx, 2.3, tz(12) + dz, 1.1, 0.08, 1.1, "#F59E8B");
  b.box(tx(11), 2.4, tz(12), 0.3, 0.14, 0.3, "#F8FAFC");
  b.block(11, 12);

  // S41 — yatta ofis masası yok: köprüde ayakta konsollar, kıç güvertede yemek masası, salonda yazı masası, pruvada şezlonglar
  for (const i of [10, 12]) {
    b.box(tx(i), 0.5, tz(5), 0.8, 1.0, 0.55, "#1E3A5F", "solid", 0.03);
    b.box(tx(i), 1.05, tz(5) + 0.18, 0.7, 0.32, 0.04, "#22314A");
    b.box(tx(i), 1.05, tz(5) + 0.21, 0.6, 0.24, 0.02, i === 10 ? "#7DD3FC" : "#34D399", "glow");
    b.block(i, 5);
    b.station(i, 6, DOWN, "stand", "console");
  }
  b.box(tx(13.5), 0.72, tz(9), 1.9, 0.08, 0.9, "#C08A57", "solid", 0.03);
  b.box(tx(13.5), 0.36, tz(9), 0.3, 0.72, 0.3, "#94A3B8");
  b.block(13, 9); b.block(14, 9);
  b.laptop(tx(13), 0.76, tz(9), "-z"); b.laptop(tx(14), 0.76, tz(9), "+z");
  b.box(tx(13.5), 0.84, tz(9), 0.14, 0.16, 0.14, "#FDE68A", "glass");
  b.chair(13, 8, "+z", "#F8FAFC"); b.station(13, 8, UP, "sit_chair", "laptop");
  b.chair(14, 10, "-z", "#F8FAFC"); b.station(14, 10, DOWN, "sit_chair", "laptop");
  b.desk(5, 5, 2, "#8B5E3C", "#5D3A1A", true);
  b.laptop(tx(5), 0.79, tz(5), "-z"); b.deskLamp(6, 5, "#FDE68A", 0.25, -0.25);
  b.chair(5, 4, "+z", "#1E3A5F"); b.station(5, 4, UP, "sit_chair", "laptop");
  for (const [i, j] of [[16, 5], [17, 5], [16, 10], [17, 10], [7, 9], [7, 10]] as Tile[]) {
    b.sunLounger(i, j, "+z", "#F8FAFC", "#CBD5E1");
    b.station(i, j, UP, "lounge", "laptop", 0.34);
  }
  // güneşlenme minderleri (pruva ve kıç; güverte eşyası) — HOTEL-SYS: uyku güverte evinin kamara kapısında (geçit (14, 4))
  for (const [i, j] of [[16, 7], [17, 7], [16, 8], [17, 8], [2, 8], [2, 12], [4, 12], [5, 12]] as Tile[]) b.daybed(i, j, (i + j) % 2 ? "#F8FAFC" : "#E2E8F0", "#2386C8", "-z");
  placeHotel(b, "yacht", { at: [14, 3], w: 2, d: 1, door: [14, 4] });
  // uzakta demirli yelkenli ve motoryat (ızgara dışı; deniz boş görünmesin)
  const sail = (x: number, z: number, hull: string) => {
    b.box(x, -0.95, z, 3.2, 0.5, 1.1, hull, "bob", 0.02); b.box(x, -0.66, z, 3.0, 0.08, 0.9, "#C08A57", "bob");
    b.box(x, 0.8, z, 0.1, 3.4, 0.1, "#E5E7EB", "bob");
    [[1.6, 0.0], [1.2, 0.7], [0.8, 1.4], [0.4, 2.0]].forEach(([w, y]) => b.box(x + w / 2 + 0.08, -0.3 + y + 0.3, z, w, 0.7, 0.04, "#F8FAFC", "bob"));
  };
  sail(-8, -9, "#F8FAFC"); sail(9, -11, "#1E3A5F");
  b.box(19, -0.95, -11.5, 4.2, 0.6, 1.5, "#F8FAFC", "bob", 0.02); b.box(18.6, -0.45, -11.5, 2.2, 0.5, 1.2, "#F8FAFC", "bob");
  b.box(18.6, -0.42, -11.5 + 0.61, 2.0, 0.24, 0.02, "#22314A", "bob");
  b.hook("sea", 12, 0, 12); b.hook("perch", 11, 3); b.hook("perch", 1, 7);
  // can simitleri ve kıç bayrağı
  for (const j of [4, 11]) {
    const x = tx(1) - 0.52, z = tz(j);
    for (const [dy, dz, h, d] of [[0.25, 0, 0.12, 0.6], [-0.25, 0, 0.12, 0.6], [0, 0.25, 0.6, 0.12], [0, -0.25, 0.6, 0.12]])
      b.box(x, -0.45 + dy, z + dz, 0.12, h, d, Math.abs(dz) > 0 ? "#FFFFFF" : "#F97316");
  }
  b.box(tx(1), 1.2, tz(7.5), 0.07, 2.4, 0.07, "#E5E7EB");
  b.box(tx(1) + 0.55, 2.1, tz(7.5), 1, 0.6, 0.04, "#1E3A5F", "flag");
  b.box(tx(1) + 0.55, 2.1, tz(7.5), 0.32, 0.22, 0.07, "#F2B33D", "flag");
  // kıçta bekleyen jet-ski
  b.box(tx(-1.2), -0.95, tz(7.5), 1.6, 0.35, 0.7, "#F8FAFC", "bob");
  b.box(tx(-1.0), -0.7, tz(7.5), 0.6, 0.2, 0.4, "#1E3A5F", "bob");

  b.spot("web", 18, 7, RIGHT); b.spot("web", 19, 8, DOWN);
  b.spot("read", 3, 4, LEFT); b.spot("read", 3, 5, LEFT);
  b.spot("plan", 9, 6, DOWN);
  b.spot("shell", 11, 6, DOWN);
  for (let k = 0; k < 4; k++) b.cloud(-14 + k * 8, 9 + (k % 2), -10 + (k % 2) * 2);
  return b.done();
}

/** Uzay üssü: metal platform, roket rampası, holo masa, veri rafları; gece gökyüzünde halkalı gezegen. */
function space(): Built {
  const b = new Builder(41);
  const pad = (i: number, j: number) => Math.hypot(i - 3, j - 3) < 2.6;
  const lane = (i: number, j: number) => j === 9 || (i === 12 && j >= 6);
  b.ground((i, j) => (pad(i, j) ? ((i + j) % 2 ? "#4A5066" : "#555C74") : lane(i, j) ? "#5A6690"
    : (i + j) % 2 ? "#3C4561" : "#46506E"), "#1B1F2E", 0.04);
  for (let i = 0; i < W; i++) for (const s of [-1, 1]) b.box(tx(i), 0.012, tz(9) + s * 0.47, 0.6, 0.02, 0.05, "#5EEAD4", "glow");
  for (let j = 6; j < D; j++) if (j !== 9) for (const s of [-1, 1]) b.box(tx(12) + s * 0.47, 0.012, tz(j), 0.05, 0.02, 0.6, "#5EEAD4", "glow");
  for (let a = 0; a < 12; a++) b.box(tx(3) + Math.cos(a * 0.524) * 2.1, 0.012, tz(3) + Math.sin(a * 0.524) * 2.1, 0.3, 0.02, 0.3, "#F2B33D", "glow");

  // roket (arka sol)
  const rx = tx(3), rz = tz(3);
  for (const [dx, dz] of [[-0.75, 0], [0.75, 0], [0, -0.75], [0, 0.75]]) b.box(rx + dx, 0.55, rz + dz, dx ? 0.5 : 0.12, 1.1, dz ? 0.5 : 0.12, "#E5584E");
  b.box(rx, 2.5, rz, 1.0, 4.4, 1.0, "#F1F5F9", "solid", 0.02);
  b.box(rx, 3.3, rz + 0.51, 0.4, 0.4, 0.02, "#7DD3FC", "glow");
  b.box(rx, 2.4, rz + 0.51, 0.3, 0.3, 0.02, "#7DD3FC", "glow");
  [[0.8, 4.9], [0.55, 5.3], [0.3, 5.65]].forEach(([w, y]) => b.box(rx, y, rz, w, 0.4, w, "#E5584E"));
  b.box(rx, 0.12, rz, 0.7, 0.24, 0.7, "#475569");
  for (let i = 2; i <= 4; i++) for (let j = 2; j <= 4; j++) b.block(i, j);

  // veri rafları (okuma)
  for (const i of [7, 8, 9]) {
    b.box(tx(i), 1.1, tz(1), 0.9, 2.2, 0.8, "#1F2937", "solid", 0.03);
    for (let k = 0; k < 6; k++) b.box(tx(i) - 0.2 + (k % 3) * 0.2, 0.5 + Math.floor(k / 3) * 0.6 + (i % 2) * 0.3, tz(1) + 0.41, 0.1, 0.06, 0.02,
      ["#5EEAD4", "#C084FC", "#FDE68A"][(k + i) % 3], "glow");
    b.block(i, 1);
  }
  b.lights.push({ pos: [tx(8), 2.0, tz(2)], color: "#C084FC", intensity: 4, distance: 8 });
  // konsollar (kabuk)
  b.terminal(11, 1, "+z"); b.terminal(12, 1, "+z");
  // teleskop (web)
  b.box(tx(15.5), 0.4, tz(1), 1.6, 0.8, 0.8, "#94A3B8", "solid", 0.03);
  [[0, 1.0], [0.3, 1.35], [0.6, 1.7], [0.9, 2.05]].forEach(([dz, y]) => b.box(tx(15.5), y, tz(1) - dz, 0.45, 0.45, 0.55, "#F1F5F9"));
  b.box(tx(15.5), 2.1, tz(1) - 1.2, 0.36, 0.36, 0.04, "#7DD3FC", "glow");
  b.block(15, 1); b.block(16, 1);
  // kubbe (arka sağ)
  [[5, 1.0, 0.5], [4.2, 0.9, 1.45], [2.8, 0.7, 2.25]].forEach(([w, h, y]) => b.box(tx(20), y, tz(1), w, h, 2.6, "#BFE3F5", "glass"));
  b.box(tx(20), 0.45, tz(1), 0.9, 0.9, 0.9, "#22C55E", "solid", 0.1);
  b.box(tx(20), 1.0, tz(1), 0.5, 0.4, 0.5, "#4ADE80", "solid", 0.1);
  for (let i = 18; i <= 22; i++) for (let j = 0; j <= 2; j++) b.block(i, j);

  // holo masa (plan)
  b.box(tx(11.5), 0.4, tz(5), 1.8, 0.8, 0.8, "#334155", "solid", 0.03);
  b.box(tx(11.5), 0.82, tz(5), 1.6, 0.04, 0.6, "#5EEAD4", "glow");
  b.box(tx(11.5), 1.0, tz(5), 0.08, 0.36, 0.08, "#5EEAD4", "glow"); // REAL-SUPPORT: hologram projeksiyon ışını masadan yükselir (eskiden küp havada)
  b.box(tx(11.5), 1.4, tz(5), 0.5, 0.5, 0.5, "#5EEAD4", "glass");
  b.box(tx(11.5) + 0.5, 1.25, tz(5), 0.16, 0.16, 0.16, "#C084FC", "glow");
  b.box(tx(11.5), 1.4, tz(5), 0.9, 0.04, 0.9, "#99F6E4", "glass");
  b.block(11, 5); b.block(12, 5);
  b.lights.push({ pos: [tx(11.5), 1.8, tz(5.5)], color: "#5EEAD4", intensity: 6, distance: 9 });

  // iş istasyonları
  for (const [i, j] of [[3, 7], [8, 7], [14, 7], [19, 7], [5, 11], [10, 11], [16, 11], [21, 11]] as Tile[]) {
    b.desk(i, j, 2, "#64748B", "#94A3B8", true);
    b.monitor(i, j, "-z", 0, 0.14); b.monitor(i + 1, j, "-z", 0, 0.14);
    b.box(tx(i) + 0.5, 0.7, tz(j) + 0.46, 1.9, 0.04, 0.03, "#5EEAD4", "glow");
    b.station(i, j - 1, UP, "sit_chair", "console");
  }
  // HOTEL-SYS (E1): açık ranza kapsülleri kalktı — mürettebat modülünün kapağı (geçit (4, 15); içerisi ayrı dinlenme salonu)
  placeHotel(b, "space", { at: [4, 13], w: 2, d: 2, door: [4, 15] });
  b.hook("grass", 1, 13); b.hook("window", 20, 1);
  // uyku kapsülleri (dinlenme)
  for (const i of [17, 18, 19]) {
    b.box(tx(i), 0.25, tz(15), 0.9, 0.5, 0.95, "#E2E8F0", "solid", 0.02);
    b.box(tx(i), 0.6, tz(15), 0.8, 0.3, 0.85, "#BFE3F5", "glass");
    b.box(tx(i), 0.52, tz(15) - 0.48, 0.6, 0.05, 0.02, "#93C5FD", "glow");
    b.block(i, 15);
  }
  b.rest.push([17, 14], [18, 14], [19, 14]);
  b.lights.push({ pos: [tx(18), 1.2, tz(14)], color: "#93C5FD", intensity: 3, distance: 6 });
  // hidroponik saksılar + çanak anten
  for (const [i, j] of [[1, 13], [22, 8], [1, 8]] as Tile[]) {
    b.box(tx(i), 0.3, tz(j), 0.7, 0.6, 0.7, "#E2E8F0", "solid", 0.02);
    b.box(tx(i), 0.75, tz(j), 0.6, 0.4, 0.6, "#22C55E", "solid", 0.12);
    b.box(tx(i), 1.1, tz(j), 0.05, 0.3, 0.05, "#94A3B8"); // REAL-SUPPORT: büyütme lambası saksıdaki çubukta (eskiden 0,27 havada)
    b.box(tx(i), 1.25, tz(j), 0.5, 0.05, 0.5, "#E879F9", "glow");
    b.block(i, j);
  }
  b.box(tx(22), 0.7, tz(14), 0.1, 1.4, 0.1, "#94A3B8");
  b.box(tx(22), 1.5, tz(14), 1.3, 0.1, 1.3, "#E2E8F0"); b.box(tx(22), 1.75, tz(14), 0.1, 0.4, 0.1, "#F87171", "glow");
  b.block(22, 14);

  // gökyüzü: halkalı gezegen, ay, asteroitler
  const px = -17, py = 11, pz = -27;
  b.box(px, py, pz, 6, 4.2, 6, "#7C5CE0", "glow"); b.box(px, py, pz, 4.2, 6, 4.2, "#8B6CF0", "glow"); b.box(px, py, pz, 5.2, 5.2, 5.2, "#9B80F2", "glow");
  b.box(px, py + 1.4, pz, 5.4, 0.5, 5.4, "#B4A0F7", "glow");
  for (const s of [-1, 1]) {
    b.box(px, py - 0.2, pz + s * 5.2, 11.6, 0.18, 1.0, "#FDE68A", "glow");
    b.box(px + s * 5.2, py - 0.2, pz, 1.0, 0.18, 9.4, "#FDE68A", "glow");
  }
  b.box(13, 14, -30, 2.2, 2.2, 2.2, "#E5E7EB", "glow"); b.box(13.4, 14.5, -28.9, 0.6, 0.6, 0.1, "#CBD5E1", "glow");
  for (let k = 0; k < 5; k++) b.box(-14 + k * 7, 7.5 + (k % 3) * 1.2, -12 + (k % 2) * 3, 0.9 + (k % 2) * 0.5, 0.7, 0.8, k % 2 ? "#6B7280" : "#57534E", "cloud");

  b.spot("web", 15, 2, DOWN); b.spot("web", 16, 2, DOWN);
  b.spot("read", 7, 2, DOWN); b.spot("read", 8, 2, DOWN);
  b.spot("plan", 11, 6, DOWN); b.spot("plan", 12, 6, DOWN);
  b.spot("shell", 11, 2, DOWN); b.spot("shell", 12, 2, DOWN);
  return b.done();
}

/** Karlı köy: kütük evler, karlı çamlar, donmuş gölet, kardan adam, kamp ateşi ve yağan kar. */
function snow(): Built {
  const b = new Builder(53);
  const path = (i: number, j: number) => j === 8 || (i === 12 && j >= 4);
  const pond = (i: number, j: number) => i >= 17 && i <= 21 && j >= 10 && j <= 13;
  b.ground((i, j) => (pond(i, j) ? ((i + j) % 2 ? "#BFE6F5" : "#B3DDF0") : path(i, j) ? "#D9CBB4"
    : (i * 5 + j * 7) % 9 === 0 ? "#E4ECF5" : (i + j) % 2 ? "#F4F7FB" : "#EDF2F8"), "#A8B4C4", 0.03);
  for (let i = 17; i <= 21; i++) for (let j = 10; j <= 13; j++) {
    b.block(i, j);
    if ((i + j) % 3 === 0) b.box(tx(i) + 0.2, 0.01, tz(j) - 0.2, 0.3, 0.02, 0.06, "#FFFFFF", "glow");
  }
  // gölette iki penguen
  for (const [i, j] of [[18, 11], [20, 12]] as Tile[]) {
    b.box(tx(i), 0.3, tz(j), 0.4, 0.6, 0.34, "#2B2D42"); b.box(tx(i), 0.3, tz(j) + 0.15, 0.3, 0.45, 0.06, "#F8FAFC");
    b.box(tx(i), 0.42, tz(j) + 0.2, 0.12, 0.06, 0.1, "#F59E0B"); b.box(tx(i), 0.02, tz(j) + 0.08, 0.3, 0.04, 0.2, "#F59E0B");
  }

  // kütük evler (sıcak pencere ışığı)
  const cabin = (i0: number, j0: number) => {
    const x = tx(i0 + 2), z = tz(j0 + 1);
    for (let k = 0; k < 3; k++) b.box(x, 0.3 + k * 0.6, z, 5, 0.58, 3, k % 2 ? "#8B5A2B" : "#7A4E25", "solid", 0.04);
    for (const dx of [-2.5, 2.5]) for (const dz of [-1.5, 1.5]) b.box(x + dx, 0.9, z + dz, 0.22, 1.8, 0.22, "#5D3A1A");
    for (const dx of [-1.4, 1.4]) {
      b.box(x + dx, 1.0, z + 1.51, 0.75, 0.6, 0.04, "#FFD27A", "glow");
      b.box(x + dx, 1.0, z + 1.53, 0.06, 0.6, 0.02, "#5D3A1A");
    }
    b.box(x, 0.65, z + 1.51, 0.8, 1.3, 0.05, "#5B3A1F");
    [[3.9, 0], [2.9, 1], [1.9, 2], [0.9, 3]].forEach(([d, k]) => {
      b.box(x, 1.95 + k * 0.38, z, 5.9, 0.12, d, "#6B4226");
      b.box(x, 2.07 + k * 0.38, z, 5.8, 0.26, d - 0.1, "#F8FAFC", "solid", 0.02);
    });
    b.box(x + 1.5, 3.1, z - 0.5, 0.5, 1.1, 0.5, "#78716C", "solid", 0.06);
    b.box(x + 1.5, 3.68, z - 0.5, 0.56, 0.08, 0.56, "#F8FAFC");
    for (let i = i0; i <= i0 + 4; i++) for (let j = j0; j <= j0 + 2; j++) b.block(i, j);
    b.lights.push({ pos: [x, 1.2, z + 2.1], color: "#FFC56B", intensity: 4, distance: 7 });
  };
  cabin(2, 1); cabin(16, 1);

  // duyuru panosu (plan)
  for (const dx of [-0.9, 0.9]) b.box(tx(11.5) + dx, 0.75, tz(2), 0.12, 1.5, 0.12, "#6B4226");
  b.box(tx(11.5), 1.2, tz(2), 2, 0.9, 0.1, "#8B5A2B");
  b.box(tx(11.5), 1.7, tz(2), 2.1, 0.12, 0.3, "#F8FAFC");
  [["#FDE68A", -0.55, 1.3], ["#93C5FD", 0, 1.1], ["#FCA5A5", 0.55, 1.3], ["#BBF7D0", -0.25, 0.95]].forEach(([c, dx, y]) =>
    b.box(tx(11.5) + (dx as number), y as number, tz(2) + 0.06, 0.4, 0.3, 0.02, c as string));
  b.block(11, 2); b.block(12, 2);

  // tepe teleskobu (web)
  b.box(tx(22), 0.25, tz(6), 0.9, 0.5, 0.9, "#F4F7FB", "solid", 0.03);
  b.box(tx(22), 0.8, tz(6), 0.1, 0.7, 0.1, "#475569");
  b.box(tx(22) - 0.15, 1.2, tz(6), 0.7, 0.2, 0.2, "#CBD5E1");
  b.block(22, 6);
  // karlı terminal (kabuk)
  b.terminal(0, 8, "+x");
  b.box(tx(0), 1.45, tz(8), 0.84, 0.1, 0.64, "#F8FAFC");

  // pazar tezgâhları (çizgili tente): satıcı tezgâhın arkasında ayakta, dizüstü tezgâhta
  for (const [i, j] of [[3, 7], [8, 7], [14, 7], [19, 7]] as Tile[]) {
    b.desk(i, j, 2, "#A47148", "#6B4F3A");
    for (const dx of [-0.08, 1.08]) b.box(tx(i) + dx, 1.25, tz(j) + 0.42, 0.07, 1.0, 0.07, "#6B4F3A");
    for (let k = 0; k < 4; k++) b.box(tx(i) - 0.3 + k * 0.53, 1.78, tz(j) + 0.2, 0.53, 0.1, 0.8, k % 2 ? "#FFFFFF" : "#D9453B");
    b.station(i, j - 1, UP, "stand", "laptop");
  }
  // S41 — ateş çukurları çevresinde kütük banklar (dizüstü kucakta)
  for (const [ci, cj] of [[5, 11], [14, 11]] as Tile[]) {
    for (let a = 0; a < 8; a++) b.box(tx(ci) + Math.cos(a * 0.785) * 0.42, 0.08, tz(cj) + Math.sin(a * 0.785) * 0.42, 0.2, 0.16, 0.2, "#78716C");
    b.box(tx(ci), 0.3, tz(cj), 0.34, 0.36, 0.34, "#FF7A1A", "flame"); b.box(tx(ci), 0.56, tz(cj), 0.2, 0.24, 0.2, "#FFD34D", "flame");
    b.block(ci, cj);
    for (const [di, dj, f, ax] of [[-1, 0, RIGHT, "z"], [1, 0, LEFT, "z"], [0, -1, UP, "x"], [0, 1, DOWN, "x"]] as [number, number, number, string][]) {
      const i = ci + di, j = cj + dj;
      b.box(tx(i) + di * 0.12, 0.2, tz(j) + dj * 0.12, ax === "x" ? 0.9 : 0.4, 0.36, ax === "x" ? 0.4 : 0.9, "#7A4E2A", "solid", 0.05);
      b.box(tx(i) + di * 0.12, 0.4, tz(j) + dj * 0.12, ax === "x" ? 0.86 : 0.36, 0.06, ax === "x" ? 0.36 : 0.86, "#F8FAFC");
      b.station(i, j, f, "sit_bench", "laptop", 0.42);
    }
  }
  b.lights.push({ pos: [tx(9.5), 1.0, tz(11)], color: "#FF9A3C", intensity: 7, distance: 11, flicker: true });
  // HOTEL-SYS (E1): açık sığınak ranzaları kalktı — karlı çatılı dağ kulübesi (geçit (13, 15))
  placeHotel(b, "snow", { at: [13, 13], w: 2, d: 2, door: [13, 15] });
  b.hook("roof", 4, 2); b.hook("roof", 18, 2); b.hook("pond", 19, 11, 2);

  // kamp ateşi ve kütük banklar (dinlenme)
  for (let a = 0; a < 8; a++) b.box(tx(9) + Math.cos(a * 0.785) * 0.5, 0.1, tz(14) + Math.sin(a * 0.785) * 0.5, 0.22, 0.2, 0.22, "#78716C");
  b.box(tx(9), 0.36, tz(14), 0.42, 0.42, 0.42, "#FF7A1A", "flame"); b.box(tx(9), 0.68, tz(14), 0.24, 0.3, 0.24, "#FFD34D", "flame");
  b.block(9, 14);
  b.lights.push({ pos: [tx(9), 1.1, tz(14)], color: "#FF9A3C", intensity: 9, distance: 9, flicker: true });
  for (const i of [7, 11]) { b.box(tx(i), 0.22, tz(14), 0.4, 0.4, 1, "#7A4E2A", "solid", 0.05); b.block(i, 14); }
  b.rest.push([8, 14], [10, 14], [9, 13]);

  // kardan adam, kızak, fenerler, çamlar
  b.box(tx(1), 0.35, tz(13), 0.7, 0.7, 0.7, "#F8FAFC"); b.box(tx(1), 0.95, tz(13), 0.52, 0.52, 0.52, "#F8FAFC");
  b.box(tx(1), 1.42, tz(13), 0.4, 0.4, 0.4, "#F8FAFC"); b.box(tx(1), 1.42, tz(13) + 0.26, 0.08, 0.08, 0.22, "#F97316");
  b.box(tx(1), 1.2, tz(13), 0.58, 0.1, 0.58, "#D9453B"); b.box(tx(1), 1.72, tz(13), 0.42, 0.06, 0.42, "#1F2937");
  b.box(tx(1), 1.92, tz(13), 0.28, 0.34, 0.28, "#1F2937");
  b.block(1, 13);
  b.box(tx(5), 0.07, tz(14), 0.6, 0.14, 1.2, "#D9453B"); b.box(tx(5), 0.2, tz(14), 0.5, 0.06, 0.9, "#A47148"); // REAL-SUPPORT: kızak zemine basar
  b.block(5, 14);
  for (const [i, j] of [[6, 9], [17, 9], [13, 4]] as Tile[]) b.lantern(i, j);
  for (const [i, j] of [[0, 4], [23, 10], [22, 14], [14, 1], [8, 1], [23, 2], [0, 14]] as Tile[]) b.snowyPine(i, j);

  b.spot("web", 21, 6, RIGHT);
  b.spot("read", 3, 4, DOWN); b.spot("read", 4, 4, DOWN);
  b.spot("plan", 11, 3, DOWN); b.spot("plan", 12, 3, DOWN);
  b.spot("shell", 1, 8, LEFT);
  b.snowfall(170);
  for (let k = 0; k < 4; k++) b.cloud(-14 + k * 8, 9 + (k % 2), -10);
  return b.done();
}

/** CITYFIX1 (B9 tezgâh katılığı, tüm şehirler): tezgâh biçimli dolu nesne (katı, yerden yükselen, üstü 0,7–1,6, ayak izi iki yönde ≥ 0,35;
 *  pazar/baharat tezgâhı, kiosk, kum tepesi eteği, alçak duvar, saray salonu basamak rampası) yürünür karoya taşıyorsa karo engelli olur —
 *  alçak diye (LANDMARK-WALK basamak payı) içinden geçilmesin. İstasyon, dinlenme ve nokta karoları korunur. */
/** Şehir sahneleri (tezgâh katılığı yalnız şehirlerde; şehir dışı sahneler değişmez). */
export const CITY_SCENE_IDS = new Set<string>(["istanbul", "kapadokya", "londra", ...FULL_CITY_SCENES, ...NEW_CITY_IDS]);
export function blockCounters(b: Built): void {
  const keep = new Set<string>([...b.stations.map((q) => key(q.tile[0], q.tile[1])), ...b.rest.map((q) => key(q[0], q[1])),
    ...Object.values(b.spots).flatMap((l) => (l ?? []).map((q) => key(q.tile[0], q.tile[1])))]);
  const ox = tx(0) - 0.5, oz = tz(0) - 0.5;
  for (const bl of b.blocks) {
    if (!isObstacle(bl)) continue;
    for (const [i, j] of obstacleTiles(bl, ox, oz, INTRUDE_HARD)) if (i >= 0 && j >= 0 && i < b.width && j < b.depth && !keep.has(key(i, j))) b.blocked.add(key(i, j));
  }
}

type SceneBase = Omit<SceneDef, "label" | "hint">;
/** `label` ve `hint` dile duyarlı getter'lardır (locales/world.ts); SCENES'i okuyan bileşenler değişmeden iki dil alır. */
function scene(d: SceneBase): SceneDef {
  // LANDMARK-WALK: simge bölgelerinde engel kümesi görünen modelle (yakında hi) uzlaşır — boş karo açılır, görünen parçanın
  // ortasından kestiği yürünür karo engellenir (walk/landmarkWalk.ts; denetim scripts/landmark_walk_check.mjs)
  const raw = d.build;
  d.build = () => {
    const b = raw();
    // avlu/bahçe girişleri (walk/landmarkGates.ts): kapı karolarında bloklar oyulur (orta model; hi kayıtta oyulur)
    for (const z of b.zones ?? []) {
      const g = z.kind === "landmark" && z.tag ? sceneGates(d.id, z.tag) : null;
      if (g) b.blocks = carveGates(b.blocks, tx(z.i0) - 0.5, tz(z.j0) - 0.5, g, GATE_TOP_SCENE);
    }
    landmarkWalkScene(d.id, b, tx, tz);
    if (CITY_SCENE_IDS.has(d.id)) blockCounters(b); // CITYFIX1: simge yürüme uzlaşmasından SONRA (basamak payıyla açılan tezgâh karosu geri kapanır)
    if (CITY_SCENE_IDS.has(d.id)) kerbScene(b, tx(0) - 0.5, tz(0) - 0.5); // koridoru daraltan direk/ağaç karosu ve yürünür karodaki direk kaldırıma
    // COURTYARD-PORTAL: duvarlı avlu dışarıdan yürünmez (portalla ayrı sahneye geçilir; interiors/courtyards.ts)
    for (const z of b.zones ?? []) {
      const cy = z.kind === "landmark" && z.tag ? sceneCourtyard(d.id, z.tag) : null;
      if (cy?.scene) for (const [a, c] of rectTiles(cy.scene.rect)) b.blocked.add(`${z.i0 + a},${z.j0 + c}`);
    }
    return b;
  };
  const labelKey = `scene_${d.id}` as keyof typeof M.tr;
  const hintKey = `scene_${d.id}_hint` as keyof typeof M.tr;
  return Object.defineProperties(d, {
    label: { get: () => msg(M, labelKey), enumerable: true },
    hint: { get: () => msg(M, hintKey), enumerable: true },
  }) as SceneDef;
}

/** RING-INT — şehir yeniden tasarımları (RB-IST, RB-PAR, RB-LON; CITY-B: RB-TKY, RB-NYC, RB-<city>, RB-KAP): simgeler bütün tabana
 * yayılır → çekirdek = taban. Kıyı temalı <city> taban arka kıyıda kalarak büyür (districts/core.ts `shorePlan`).*/
const CITY_CORE: SceneCore = { i0: 0, j0: 0, w: W, d: D };

/** HORIZON — şehir tabanının ufuk bandı gökte asılı durmasın: tabanın arka/yan kenarından ufuk yapılarının altına alçak arazi
 *  (city/horizonGround.ts; yalnız `backdrop` blokları, `solid` → +0 çizim çağrısı; ızgara blokları değişmez). Arazi rengi şehrin
 *  çim rengi (Kapadokya: meydan/tüf) + tabanın kenar rengi, uzakta gök rengine açılır. */
const grounded = (build: () => Built, style: () => CityStyle, sky: string, dusty = false) =>
  withHorizonGround(build, () => { const s = style(); return { land: (dusty ? s.ground.plaza : s.ground.grass)[0], under: s.ground.under, sky }; });
/** HORIZON — premium sahnelerde de ufuk tepesi/kulesi gökte durmasın (Kuzey Işığı karlı tepeleri, Neon kuleleri); arazi rengi
 *  çevre biyomunun zemini (expanse/biomes.ts snowfield / neonfringe). */
const groundedAs = (build: () => Built, land: string, under: string, sky: string) => withHorizonGround(build, () => ({ land, under, sky }));

const BASE_SCENES: Record<string, SceneDef> = {
  office: scene({ id: "office", swatch: ["#B88758", "#ECE6DA"], sky: "#BFE3F5", fog: [30, 60],
    hemi: ["#FFFFFF", "#B88758", 1.1], sun: { color: "#FFF4E0", intensity: 1.6, pos: [6, 14, 10] }, build: office }),
  park: scene({ id: "park", swatch: ["#6DBE45", "#8ED1FC"], sky: "#8ED1FC", fog: [32, 70],
    hemi: ["#DFF3FF", "#6DBE45", 1.15], sun: { color: "#FFF6D8", intensity: 2, pos: [10, 16, 8] }, build: park }),
  home: scene({ id: "home", swatch: ["#C99A6B", "#B7C9A8"], sky: "#F6E7D8", fog: [30, 60],
    hemi: ["#FFF3E6", "#CFA67F", 1.05], sun: { color: "#FFE2B8", intensity: 1.3, pos: [-6, 12, 10] }, build: home }),
  beach: scene({ id: "beach", swatch: ["#EBD9A8", "#1E8FD0"], sky: "#9BE1FF", fog: [34, 80],
    hemi: ["#E0F7FF", "#EBD9A8", 1.2], sun: { color: "#FFF8E1", intensity: 2.2, pos: [-8, 18, 6] }, build: beach }),
  cafe: scene({ id: "cafe", swatch: ["#3B2F2F", "#B5543C"], sky: "#3A2A24", fog: [30, 60],
    hemi: ["#FFE7CC", "#3B2F2F", 0.85], sun: { color: "#FFD9A8", intensity: 0.9, pos: [8, 12, 10] }, build: cafe }),
  camp: scene({ id: "camp", swatch: ["#355E2E", "#0B1026"], sky: "#0B1026", fog: [24, 55], night: true,
    // HQA-FIX: ateşten uzakta avatar/zemin siyahtı (hemisfer 0,45, koyu mavi) — gece taban ışığı (nightLight.ts) gibi nötre yakın gök, açık zemin, ≥ 0,9
    hemi: ["#B4C2F0", "#4A5578", 0.9], sun: { color: "#9DB4FF", intensity: 0.8, pos: [-8, 14, 6] }, build: camp }),
  battlefield: scene({ id: "battlefield", swatch: ["#7FA23A", "#CDB287"], sky: "#BEE0EE", fog: [32, 70],
    hemi: ["#F4FAFF", "#7FA23A", 1.1], sun: { color: "#FFF4DC", intensity: 1.9, pos: [8, 16, 9] }, build: battlefield }),
  sea: scene({ id: "sea", swatch: ["#EBD9A8", "#1E8FD0"],
    sky: "#8FD3FF", fog: [36, 85], hemi: ["#E6F7FF", "#1E8FD0", 1.15], sun: { color: "#FFF8E6", intensity: 2.1, pos: [-9, 17, 7] },
    ocean: { color: "#1E8FD0", y: -0.32 }, build: openSea }),
  yacht: scene({ id: "yacht", swatch: ["#C08A57", "#FAD6B4"],
    sky: "#FAD6B4", fog: [36, 85], hemi: ["#FFF4E6", "#2386C8", 1.1], sun: { color: "#FFD9A8", intensity: 1.9, pos: [-12, 11, 9] },
    ocean: { color: "#2386C8", y: -1.3 }, build: yacht }),
  space: scene({ id: "space", swatch: ["#363D52", "#5EEAD4"],
    sky: "#060A1C", fog: [30, 72], night: true, hemi: ["#8B9BFF", "#2A3150", 0.95], sun: { color: "#DCE3FF", intensity: 1.15, pos: [8, 14, 10] },
    build: space }),
  snow: scene({ id: "snow", swatch: ["#F4F7FB", "#7A4E25"],
    sky: "#D3E4F1", fog: [22, 58], hemi: ["#FFFFFF", "#C9D6E3", 1.15], sun: { color: "#FFF6E8", intensity: 1.5, pos: [-8, 14, 9] },
    build: snow }),
  // S34: AVM (scenes/mall.ts) — ücretsiz sahne (mağaza listesinde yok)
  mall: scene({ id: "mall", swatch: ["#F1ECE3", "#4FA3A5"],
    sky: "#E2EEF6", fog: [32, 70], hemi: ["#FFFFFF", "#E3DCD0", 1.2], sun: { color: "#FFF8EC", intensity: 1.7, pos: [6, 16, 10] },
    build: buildMall }),
  // S42: Okul (scenes/school.ts) — ücretsiz sahne (mağaza listesinde yok)
  school: scene({ id: "school", swatch: ["#C99A6B", "#C8553D"],
    sky: "#BFE3F5", fog: [32, 72], hemi: ["#FFFFFF", "#D8C3A0", 1.15], sun: { color: "#FFF4E0", intensity: 1.8, pos: [8, 16, 10] },
    build: buildSchool }),
  // SP-W1 pilot (Türkiye, ücretsiz — W1-IST)
  istanbul: scene({ id: "istanbul", core: CITY_CORE, ...ISTANBUL_ENV, build: grounded(buildIstanbul, () => ISTANBUL_STYLE, ISTANBUL_ENV.sky) }),
  // SP-W2a (Dünya Turu: Avrupa — W2-LON)
  londra: scene({ id: "londra", core: CITY_CORE, ...LONDRA_ENV, build: grounded(buildLondra, () => LONDRA_STYLE, LONDRA_ENV.sky) }),
  // SP-W2a (Türkiye, ücretsiz — W2-KAP)
  kapadokya: scene({ id: "kapadokya", core: CITY_CORE, ...KAPADOKYA_ENV, build: grounded(buildKapadokya, () => KAPADOKYA_STYLE, KAPADOKYA_ENV.sky, true) }),
};
// EDITION1: tam sürüm sahneleri bugünkü anahtar sırasına geri dizilir (free sürümde FULL_SCENE_KEYS boş → yalnız BASE_SCENES)
const FULL_SCENES: Record<string, SceneDef> = fullScenes({ scene, grounded, groundedAs, core: CITY_CORE });
export const SCENES: Record<WorldSceneId, SceneDef> = {
  ...Object.fromEntries((FULL_SCENE_KEYS.length ? FULL_SCENE_KEYS : Object.keys(BASE_SCENES)).map((k) => [k, BASE_SCENES[k] ?? FULL_SCENES[k]])),
  // yeni dünya şehirleri (V/cities/<id>/; sıra NEW_CITIES = catalog.json `order`)
  ...cityRecord(cityScene),
} as Record<WorldSceneId, SceneDef>;

/** dizindeki şehrin sahne kaydı: ortam manifestten; katman/paket/risk catalog.json'dan (game/catalog.py ile tek kaynak);
 * kurucu ilk çağrıda `parts.ts`'den okunur (manifest saf kalır, sahne seçilince kurulur).
 * çekirdek varsayılanı = taban sahnenin KENDİ boyutu (36 × 32 kompakt taban `env.core` yazmadan bütün taban; 24 × 16
 * tabanda `CITY_CORE` ile aynı). Boyut kurucudan gelir: tembel getter ilk okumada tabanı (önbellekli `baseScene`) kurar ve
 * sabit nesneyi döndürür. `env.core` verilirse o kullanılır.*/
function cityScene(m: CityManifest): SceneDef {
  const c = m.catalog;
  const def = scene({ id: c.id as WorldSceneId, ...m.env, tier: "city", pack: c.shop.pack,
    ip_risk: c.ip.ip_risk, culture_risk: c.ip.culture_risk, build: grounded(() => NEW_CITY_PARTS[c.id].build(), () => NEW_CITY_PARTS[c.id].style, m.env.sky) });
  if (m.env.core) return def;
  let core: SceneCore | null = null;
  return Object.defineProperty(def, "core", {
    get: () => {
      if (!core) { const b = baseScene(def); core = { i0: 0, j0: 0, w: b.width, d: b.depth }; }
      return core;
    },
    // denetim betikleri (rules.mjs) çekirdeği geçici olarak ezip geri koyabilir
    set: (v: SceneCore | undefined) => { core = v ?? null; },
    enumerable: true, configurable: true,
  });
}

// EDITION1: free sürümde tam sürüm sahneleri yok; tam sürümde bugünkü sıra full/scenes.ts FULL_PICKER_ORDER'dan gelir
const BASE_ORDER: WorldSceneId[] = ["office", "park", "home", "beach", "cafe", "camp", "mall", "school", "battlefield", "sea", "yacht", "space", "snow", "istanbul", "kapadokya", "londra"];
export const SCENE_ORDER: WorldSceneId[] = [...(FULL_PICKER_ORDER.length ? FULL_PICKER_ORDER as WorldSceneId[] : BASE_ORDER), ...NEW_CITY_IDS];

/** Kilit kimliği (lib/game.ts `isUnlocked`): "scene:<id>". */
export const sceneItemId = (id: WorldSceneId) => `scene:${id}`;

/** Faz 7a: kullanıcı dünyaları (`w_…`, dünya yapıcı) çalışma anında kaydedilir; yerleşik sahneler değişmez. */
const customScenes = new Map<string, SceneDef>();

export function sceneDef(id: string | null | undefined): SceneDef {
  return (id && ((SCENES as Record<string, SceneDef>)[id] ?? customScenes.get(id))) || SCENES.office;
}

/** Kullanıcı dünyasını kaydeder (ya da günceller): önbelleğe alınmış taban ve modüllü dünyalar atılır. */
export function registerScene(def: SceneDef): void {
  if ((SCENES as Record<string, SceneDef>)[def.id]) return; // yerleşik sahne ezilmez
  customScenes.set(def.id, def);
  forgetScene(def.id);
}

export function unregisterScene(id: string): void {
  customScenes.delete(id);
  forgetScene(id);
}

function forgetScene(id: string) {
  baseScenes.delete(id);
  for (const k of [...worldCache.keys()]) if (k.startsWith(`${id}:`)) worldCache.delete(k);
}

// ------------------------------------------------------------------------------------------ büyüyen dünya (S38: bölgeler)
/**
 * Ajan sayısı taban sahnenin istasyonlarını aşınca dünya, sahnenin temasında amaçlı bölgelerle büyür (voxel/districts/):
 * her ekibe kendi renginde, tabelalı bir çalışma alanı; ekipsiz ajanlar ve harici oturumlar MERKEZ'de (taban sahne) ve
 * gerekirse ortak çalışma alanında; her iki çalışma alanına bir paylaşılan olanak (mutfak, toplantı, kütüphane… sahneye
 * göre); boş parseller avlu/otopark. Taban sahne hiç kaymaz (sol-arka köşe); hücreler sabit sırayla eklenir.
 * Aynı talep → aynı dünya (önbellek anahtarı plan imzası). Kullanıcı dünyası `annex` temasıyla aynı şekilde büyür.
 */
/** Taban sahneler belirlenimci: bir kez kurulur (bölgeler yeni nesne üretir, tabanı değiştirmez). */
const baseScenes = new Map<string, Built>();
function baseScene(def: SceneDef): Built {
  let built = baseScenes.get(def.id);
  if (!built) { built = def.build(); baseScenes.set(def.id, built); }
  return built;
}

/** Dünya düzeni (mini bilgi çipi): kaç ek hücre (24×16), ızgara boyutu. Aynı girdi → aynı çıktı. */
export interface WorldLayout { extra: number; cols: number; rows: number; baseCol: number; width: number; depth: number }

/** Ekip başına ajan sayısı (ekip sırasıyla) + ekipsiz/harici karakter sayısı. */
export type WorldDemand = Demand;

/** Sahnenin büyüme teması: yerleşik sahnede kendisi, kullanıcı dünyasında `annex` (null → büyümez). */
function kitFor(def: SceneDef): string | null {
  if (def.annex === null) return null;
  const id = def.annex ?? def.id;
  return hasTheme(id) ? id : null;
}

/** Karakter listesi + ekipler → talep. Bilinen bir ekibe bağlı olmayanlar (ekipsiz ajanlar, harici oturumlar) misafirdir. */
export function worldDemand(agents: { team?: string | null }[], teams: { slug: string; color: string }[]): WorldDemand {
  const count = new Map<string, number>();
  let guests = 0;
  const known = new Set(teams.map((t) => t.slug));
  for (const a of agents) {
    if (a.team != null && known.has(a.team)) count.set(a.team, (count.get(a.team) ?? 0) + 1);
    else guests++;
  }
  return { teams: teams.filter((t) => count.get(t.slug)).map((t) => ({ slug: t.slug, n: count.get(t.slug)!, color: t.color })), guests };
}

/** CITY-BIG — taban sahnenin bölge birimi boyutu (sütun × satır; bölge 12×16 karo). 24×16 taban → 2×1. Çekirdekli sahnede
 *  (şehir) taban bölge katı olabilir (ör. 36×32 → 3×2) ve halka/kıyı düzeniyle büyür. Başka boyut → null (dünya büyümez). */
export function baseBays(def: Pick<SceneDef, "core">, base: Pick<Built, "width" | "depth">): BaseBays | null {
  if (base.width === W && base.depth === D) return [2, 1];
  if (def.core && base.width >= W && base.depth >= D && base.width % BAY === 0 && base.depth % D === 0) return [base.width / BAY, base.depth / D];
  return null;
}

function planFor(id: string | null | undefined, agents: number, demand?: WorldDemand) {
  const def = sceneDef(id);
  const base = baseScene(def);
  // bölge ızgarası taban boyutu W×D (ya da çekirdekli şehirde bölge katı) varsayar; özel boyutlu dünya büyümez (istasyonlar paylaşılır)
  const bays = baseBays(def, base);
  const theme = bays ? kitFor(def) : null;
  // RING-INT: çekirdekli sahne (şehir simgeleri) halka halinde büyür; çekirdeksiz sahnede plan eskisiyle birebir aynı
  const plan = theme && bays ? planDistricts(base.stations.length, demand ?? { teams: [], guests: agents }, hotelPlanKit(districtTheme(theme), base), !!def.core, bays) : null;
  return { def, base, theme, plan };
}

/** `demand` verilmezse herkes misafir sayılır (ekip bilgisi olmayan çağıranlar için yaklaşık düzen). */
export function worldLayout(id: string | null | undefined, agents: number, demand?: WorldDemand): WorldLayout {
  const { plan } = planFor(id, agents, demand);
  if (!plan) {
    // CITY-BIG: büyük şehir tabanı kendi boyutunu bildirir; öteki sahnelerde eskisi gibi 24×16
    const def = sceneDef(id), b = def.core ? baseScene(def) : null;
    return b ? { extra: 0, cols: b.width / W, rows: b.depth / D, baseCol: 0, width: b.width, depth: b.depth } : { extra: 0, cols: 1, rows: 1, baseCol: 0, width: W, depth: D };
  }
  return { extra: plan.cells.length + plan.holes.length, cols: plan.width / W, rows: plan.depth / D, baseCol: plan.core ? plan.core[0] / 2 : 0, width: plan.width, depth: plan.depth };
}

const worldCache = new Map<string, Built>();

/** Sahne + gerekirse bölgeler. `agents`: yerleştirilecek karakter sayısı (stüdyo + harici); `demand`: ekip dağılımı. */
export function buildWorld(id: string | null | undefined, agents: number, demand?: WorldDemand): Built {
  const { def, base, theme, plan } = planFor(id, agents, demand);
  if (!plan || !theme) return base;
  const cacheKey = `${def.id}:${theme}:${plan.sig}`;
  const hit = worldCache.get(cacheKey);
  if (hit) return hit;
  const built = buildDistricts(base, theme, plan);
  if (worldCache.size > 24) worldCache.clear();
  worldCache.set(cacheKey, built);
  return built;
}

/**
 * S38 — bölgeli dünyada koltuk ataması: her ekip kendi bölgesindeki koltuklara (lider ilk), misafirler (ekipsiz stüdyo
 * ajanları, sonra harici oturumlar) MERKEZ'e ve ortak çalışma alanına oturur. Bir ekibe ajan eklemek yalnız o ekibin bir
 * sonraki boş koltuğunu doldurur; diğer ekiplerin kimse yerinden kalkmaz. Büyümemiş dünyada eski davranış (assignStations).
 */
export function assignSeats(built: Built, agents: { slug: string; team?: string | null; guest?: boolean }[], teamOrder: string[],
  leads: Set<string> = new Set()): Map<string, number> {
  if (!built.seats) return assignStations(agents, teamOrder, leads);
  const known = new Set(teamOrder);
  const out = new Map<string, number>();
  let shared = built.stations.length;
  const byTeam = new Map<string, { slug: string; lead: number; i: number }[]>();
  const guests: { slug: string; ext: number; i: number }[] = [];
  agents.forEach((a, i) => {
    if (a.team != null && known.has(a.team)) (byTeam.get(a.team) ?? byTeam.set(a.team, []).get(a.team)!).push({ slug: a.slug, lead: leads.has(a.slug) ? 0 : 1, i });
    else guests.push({ slug: a.slug, ext: a.guest ? 1 : 0, i });
  });
  for (const [team, list] of byTeam) {
    list.sort((a, b) => a.lead - b.lead || a.i - b.i);
    const seats = built.seats.teams[team] ?? [];
    list.forEach((r, k) => out.set(r.slug, k < seats.length ? seats[k] : shared++));
  }
  guests.sort((a, b) => a.ext - b.ext || a.i - b.i);
  guests.forEach((r, k) => out.set(r.slug, k < built.seats!.guests.length ? built.seats!.guests[k] : shared++));
  return out;
}

// ------------------------------------------------------------------------------------------ ekip bölgeleri (S3)
/**
 * Ajanları ekip sırasına göre gruplayıp ardışık istasyon yuvalarına yerleştirir (slug → yuva).
 * Aynı ekipte lider ilk yuvayı alır (tabelanın yanındaki masa); ekipsiz ajanlar en sona düşer.
 * Yuva ≥ istasyon sayısı ise istasyon paylaşılır (yuva % istasyon sayısı).
 */
export function assignStations(agents: { slug: string; team?: string | null }[], teamOrder: string[],
  leads: Set<string> = new Set()): Map<string, number> {
  const rank = new Map(teamOrder.map((t, i) => [t, i]));
  const NONE = 1e9;
  const rows = agents.map((a, i) => ({ slug: a.slug, rank: a.team != null && rank.has(a.team) ? rank.get(a.team)! : NONE,
                                      lead: leads.has(a.slug) ? 0 : 1, i }));
  rows.sort((a, b) => a.rank - b.rank || a.lead - b.lead || a.i - b.i);
  return new Map(rows.map((r, slot) => [r.slug, slot]));
}

// ------------------------------------------------------------------------------------------ yol bulma
/**
 * Izgara BFS'i tipli dizilerle: blokaj ızgarası dünya başına bir kez kurulur (WeakMap), ziyaret/önceki dizileri
 * çağrılar arasında yeniden kullanılır. Kısa yollar hedef bulununca biter; 72×64'lük dünyada bile bir yol < 0,1 ms.
 */
const gridCache = new WeakMap<Built, Uint8Array>();
function blockGrid(built: Built): Uint8Array {
  let g = gridCache.get(built);
  if (!g) {
    g = new Uint8Array(built.width * built.depth);
    for (const k of built.blocked) {
      const [i, j] = k.split(",").map(Number);
      if (i >= 0 && j >= 0 && i < built.width && j < built.depth) g[j * built.width + i] = 1;
    }
    gridCache.set(built, g);
  }
  return g;
}

let bfsPrev = new Int32Array(0);
let bfsQueue = new Int32Array(0);
let bfsStamp = new Int32Array(0);
let stamp = 0;

export function findPath(from: Tile, to: Tile, built: Pick<Built, "width" | "depth" | "blocked">): Tile[] | null {
  const { width, depth } = built;
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < width && j < depth;
  if (!inside(to[0], to[1])) return null;
  const grid = blockGrid(built as Built);
  const n = width * depth;
  if (bfsPrev.length < n) { bfsPrev = new Int32Array(n); bfsQueue = new Int32Array(n); bfsStamp = new Int32Array(n); stamp = 0; }
  stamp++;
  if (stamp > 2_000_000_000) { bfsStamp.fill(0); stamp = 1; }
  const start = Math.min(n - 1, Math.max(0, from[1] * width + from[0]));
  const goal = to[1] * width + to[0];
  let head = 0, tail = 0;
  bfsQueue[tail++] = start; bfsStamp[start] = stamp; bfsPrev[start] = -1;
  while (head < tail) {
    const cur = bfsQueue[head++];
    if (cur === goal) {
      const path: Tile[] = [];
      for (let k = cur; k !== start && k >= 0; k = bfsPrev[k]) path.push([k % width, Math.floor(k / width)]);
      path.reverse();
      return path;
    }
    const ci = cur % width, cj = (cur - ci) / width;
    for (let d = 0; d < 4; d++) {
      const ni = ci + (d === 0 ? 1 : d === 1 ? -1 : 0), nj = cj + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (!inside(ni, nj)) continue;
      const nk = nj * width + ni;
      if (bfsStamp[nk] === stamp) continue;
      if (grid[nk] && nk !== goal) continue;
      bfsStamp[nk] = stamp; bfsPrev[nk] = cur; bfsQueue[tail++] = nk;
    }
  }
  return null;
}

/** Yürünebilir ve ayrılmamış karolar (kenar şeritleri hariç). */
export function freeTiles(built: Pick<Built, "width" | "depth" | "blocked">, reserved: Set<string>): Tile[] {
  const out: Tile[] = [];
  for (let i = 1; i < built.width - 1; i++) for (let j = 2; j < built.depth - 1; j++) {
    const k = key(i, j);
    if (!built.blocked.has(k) && !reserved.has(k)) out.push([i, j]);
  }
  return out;
}

/** Listede `from` karosuna (Manhattan) en yakın istasyon; `maxDist` aşılırsa null. */
export function nearestStation(from: Tile, list: Station[] | undefined, maxDist = Infinity): Station | null {
  if (!list?.length) return null;
  let best: Station | null = null, bd = Infinity;
  for (const s of list) {
    const d = Math.abs(s.tile[0] - from[0]) + Math.abs(s.tile[1] - from[1]);
    if (d < bd) { bd = d; best = s; }
  }
  return bd <= maxDist ? best : null;
}
