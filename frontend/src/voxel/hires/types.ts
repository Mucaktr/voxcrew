/**
 * LANDMARK-HIRES (I1,) — simgeler için
 * yüksek çözünürlük yolu: türler, bütçe ve ayrıntı kademesi (LOD) sabitleri. Saf modül: React/three yok.
 *
 * Bir simgenin üç kademesi vardır:
 * - **hi** (yakın): bu yolun kendi yuvası — parsel/sahne blok bütçesinden bağımsız, simge başına `HIRES_BUDGET`. ½ ve ¼ birim
 * ayrıntı (pencere kafesi, mukarnas basamakları, şerefe korkuluğu, kasnak pencereleri, tepe süsleri) `hires/kit.ts` ile.
 * - **mid** (orta): bugünkü model (şehir haritasında `LandmarkModel.near`, taban sahnede simge bölgesindeki bloklar). Veri
 * katmanında olduğu gibi kalır (parsel bütçesi, çarpışma, kamera, ölçek denetimleri onu okur); yalnız ÇİZİMİ bu katmana geçer.
 * - **far** (uzak): parselin uzak LOD'u ve TOUR-VIEW silüeti (değişmez; bu yol çizmez).
 *
 * Çizim: bütün etkin simgeler malzeme grubu başına TEK örneklenmiş ağda (`HiResLayer`) — en çok `HIRES_GROUPS.length` (4) çizim
 * çağrısı (+ katı grubun gölge geçişi), simge sayısından bağımsız.
*/
import type { Block } from "../scenes";
import type { CityRect, LandmarkCtx } from "../citymap/design";

/** Yalnız durağan gruplar (canlı grup yok: hareket azaltma ve kuyruk kuralıyla aynı). */
export const HIRES_GROUPS = ["solid", "glow", "glass", "water"] as const;
export type HiResGroup = (typeof HIRES_GROUPS)[number];
export const isHiResGroup = (g: Block["g"]): g is HiResGroup => (HIRES_GROUPS as readonly string[]).includes(g);

/**
 * Simge başına yüksek çözünürlük bütçesi (kutu). Bugünkü en dolu simge (İstanbul Ayasofya/Sultanahmet ≈ 190 katı, parsel tavanı
 * 192) üzerinden ≥ 3 kat: büyük simge 600–1500 katı. `LANDMARK-HIRES-001` (city_check) aşımı hata sayar.
 */
export const HIRES_BUDGET: Readonly<Record<HiResGroup, number>> = { solid: 1500, glow: 192, glass: 96, water: 24 };
/** Katmanın çizim çağrısı tavanı (grup başına bir örneklenmiş ağ; gölge geçişi hariç). */
export const HIRES_MAX_DRAW = HIRES_GROUPS.length;
/** Bir ekranda aynı anda etkin (mid ya da hi) simge sayısı tavanı — yakın halkada (3 × 3 parsel) gerçekte ≤ 4. */
export const HIRES_MAX_ACTIVE = 8;
/** En küçük kutu kenarı (birim): ¼ birim ayrıntının altındaki kılcal kutular gürültüdür (çizim kalitesi ve gölge sivilcesi). */
export const HIRES_MIN_EDGE = 0.02;
/** Önerilen ince ızgara: ½ ve ¼ birim ayrıntı; `snap` ile yuvarlama (⅛). */
export const HIRES_GRID = 0.125;

/** Şehir haritası: avatar simge ayak izine bu kadar karo yakınsa hi, uzaksa mid (ev parseli yakın halkadayken). */
export const HIRES_NEAR_TILES = 22;
/** Kademe geçişinde histerezis (karo): sınırda titreme yok. */
export const HIRES_HYST = 3;
/** Taban sahne: kamera simge merkezine bu kadar yakınsa hi (genel kadraj ≈ 30–45). */
export const HIRES_SCENE_NEAR = 46;

/**
 * Yüksek çözünürlük kurucusu. `c` simgenin ayak izi bağlamı (dünya koordinatı; şehirde `LandmarkModel` ile aynı, sahnede simge
 * bölgesinden), `mid` bugünkü modelin blokları (yeniden kullanılabilir: ör. kaide, avlu zemini). Dönüş dünya koordinatında.
 */
export type HiResBuild = (c: LandmarkCtx, mid: readonly Block[]) => Block[];

/** Şehir haritası simgesi: `map` harita kimliği (ör. "istanbul"), `landmark` katalog kimliği (ör. "ayasofya"). */
export interface HiResMapEntry {
  map: string;
  landmark: string;
  hi: HiResBuild;
  /** ayak izi dışında izinli bölge (simge yerel karo [li, lj, w, d]; ör. Sultanahmet'in batı avlusu `[-6, 0, 6, 12]`) */
  zone?: CityRect[];
  /** simgeye özel bütçe (varsayılan `HIRES_BUDGET`; yalnız daraltılabilir) */
  budget?: Partial<Record<HiResGroup, number>>;
}

/** Taban sahne simgesi: `scene` sahne kimliği, `tag` sahnedeki `landmark` bölgesinin etiketi (`b.zones` → `kind: "landmark"`). */
export interface HiResSceneEntry {
  scene: string;
  tag: string;
  hi: HiResBuild;
  /** bölge dışına taşma payı (birim; minare saçağı vb.) */
  margin?: number;
  budget?: Partial<Record<HiResGroup, number>>;
}

/** Çizime hazır simge: kademe blokları ve LOD ölçüsü. */
export interface HiResItem {
  key: string;
  /** dünya XZ ayak izi [x0, z0, x1, z1] (uzaklık ölçüsü) */
  rect: [number, number, number, number];
  /** şehir: ev parseli (uzak LOD'u bu parselde; yakın halkadaysa çizilir) */
  home?: [number, number];
  mid: Block[];
  /** tembel kurulur (ilk yaklaşmada) */
  hi: () => Block[];
}

export type HiResLevel = "off" | "mid" | "hi";

export const budgetOf = (e: { budget?: Partial<Record<HiResGroup, number>> }): Record<HiResGroup, number> =>
  ({ ...HIRES_BUDGET, ...(e.budget ?? {}) });

/** Kutunun XZ ayak izine uzaklık (0: içinde). */
export function rectDistance(r: readonly [number, number, number, number], x: number, z: number): number {
  const dx = Math.max(r[0] - x, 0, x - r[2]), dz = Math.max(r[1] - z, 0, z - r[3]);
  return Math.hypot(dx, dz);
}

/**
 * Anahtar: `?hires=0` adres parametresi yolu kapatır (yönetilen bloklar yine akış kuyruğuna yazılır, katman çizmez → bugünkü
 * davranışın birebir aynısı; önce/sonra FPS ölçümü ve acil geri dönüş). Node'da (denetimler) her zaman açık.
 */
export const HIRES_ENABLED: boolean = typeof location === "undefined" || new URLSearchParams(location.search).get("hires") !== "0";
