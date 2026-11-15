/**
 * şehir haritası **tasarım katmanı** (yalnız ön yüz; "Landmark kütüphanesi").
 *
 * Biçim v1.3 `city_map` kapalı şemadır (semt sınırı, landmark ayak izi, durak, hat); bir şehrin coğrafyası ve gerçek oranlı
 * landmarkları bu katmanda, harita kimliğine bağlı olarak tanımlanır (dosya biçimi değişmez, arka uç doğrulaması aynı kalır):
 * - `districts[semt]`: su (Boğaz, Haliç, Marmara), yürünür kaplama (köprü güvertesi, cadde), meydan, park, katı süs karoları
 * (avlu revakı, sur), açık bina listesi (renkli evler), gizli köşeler ve süs blokları (olta tutanlar, korkuluk, fener).
 * - `landmarks[landmark]`: landmark modeli — yakın ayrıntı (`near`) ve uzak LOD (`far`) blokları, IP/kültür risk notu
 * (≤ 1 yayınlanır), ibadet yeri işareti (`sacred`: yalnız dış görünüm + avlu; kutsal bölge kuralları şehirde de geçerli).
 * - Katalog ekleri (CITY-CATALOG bloğuna girer; arka uç aynı bloğu okur): semt başına gizli köşe sayısı (`gz`) ve zamanlı
 * anlar (`an`), semt kilitleri (`unlock`: önceki semt ziyareti ya da ofis seviyesi; para yolu yok) ve süresiz görevler.
 *
 * Bloklar dünya koordinatında üretilir ve parsel penceresine **konumlarına göre** dağıtılır (district.ts): büyük bir landmark
 * birkaç parselin yakın bütçesini paylaşır. Yalnız durağan gruplar (`solid/water/glass/glow`) — +0 çizim çağrısı. Yazı, logo,
 * bayrak, dinî simge yok. Saf modül: React/three yok.
*/
import type { Block } from "../scenes";
import type { CityTile } from "./format";

/** [li0, lj0, w, d] — semt yerel karo dikdörtgeni. */
export type CityRect = [number, number, number, number];

/** Landmark modeli çizim bağlamı (dünya koordinatı): ayak izinin sol-arka köşesi, boyu ve merkezi. */
export interface LandmarkCtx { x0: number; z0: number; w: number; d: number; h: number; cx: number; cz: number }

export interface LandmarkModel {
  /** yakın ayrıntı (dünya koordinatı) */
  near: (c: LandmarkCtx) => Block[];
  /** uzak LOD (≤ 6 blok; uzak halka) */
  far: (c: LandmarkCtx) => Block[];
  /** IP riski (0–2; ≤ 1 yayınlanır) */
  ip_risk: number;
  /** kültür riski (0–2; ≤ 1 yayınlanır) */
  culture_risk: number;
  /** kısa okuma notu (neyi stilize ettik, neyi bilerek koymadık) */
  note: string;
  /** ibadet yeri: dış görünüm + avlu; iç mekân kapalı, kutsal bölge (sessizlik, emote/mini oyun yok) */
  sacred?: boolean;
  /** TOUR-VIEW (LANDMARK-GARDEN-001): yürünür bahçe / avlu / sur içi (citymap/garden.ts) */
  garden?: LandmarkGarden;
}

/**
 * TOUR-VIEW — landmarkın yürünür iç alanı (sur içi, avlu, bahçe, kutsal alan çevresi). Karolar landmark yerel (`[0, w) × [0, d)`,
 * ayak izinin sol-arka köşesi 0, 0). Planlayıcı (district.ts) `rects` içinde modelin yakın bloklarının yürüme bandını
 * (0,15…1,7) kapatmadığı karoları ve `gates`'i yürünür yapar (zemin `floor`); duvar, kule, havuz, çeşme katı kalır. Giriş
 * yalnız kapılardan (sur/duvar açıklığı) ya da duvarsız avlunun açık kenarından. Kutsal landmarkta alan kutsal bölgenin içindedir:
 * yürünür, sessiz (emote, mini oyun, ortam şakası yok).
 */
export interface LandmarkGarden {
  kind: "bailey" | "court" | "garden" | "grounds";
  /** yürünür alan adayları (landmark yerel [li, lj, w, d]) */
  rects: CityRect[];
  /** kapılar (landmark yerel karo; ayak izinin kenar karosu, dışı yürünür meydan halkası) */
  gates: CityTile[];
  /** zemin türü (çizim: park yeşili ya da meydan taşı) */
  floor?: "park" | "plaza";
}

/** Açık bina (renkli ev sırası, cadde cepheleri): dikdörtgen ayak izi, yükseklik ve renkler. */
export interface DesignBuilding { i0: number; j0: number; w: number; d: number; h: number; wall: string; roof: string;
  /** doğal kaya kütlesi (kanyon duvarı) — penceresiz katmanlı kaya bantları çizilir (`facade.ts` `rockBlocks`), bina cephesi değil*/
  rock?: boolean }

/** Süs bağlamı: semt yerel (0, 0) karosunun sol-arka köşesi (dünya) — `x = ox + li`, `z = oz + lj`. */
export interface DecorCtx { ox: number; oz: number }

export interface DistrictDesign {
  /** su (yürünmez; katı) — ayrılmış karoları (landmark, durak, ray, seyir) ezmez */
  water?: CityRect[];
  /** yürünür kaplama (sokak rengi): köprü güvertesi, cadde, rıhtım — suyu ezer */
  pave?: CityRect[];
  /** meydan (yürünür) — suyu ezer */
  plaza?: CityRect[];
  /** park (yürünür, belirlenimci ağaçlar) */
  park?: CityRect[];
  /** katı süs karoları (revak, sur, dikilitaş kaidesi): çarpışma var, kendiliğinden çizilmez (süs blokları çizer) */
  solid?: CityRect[];
  /** açık binalar (ayrılmış) */
  buildings?: DesignBuilding[];
  /** gizli köşeler (semt yerel; yürünür, işaretsiz; üstüne basınca damga) — sıra kimliktir (gz:1, gz:2) */
  hidden?: CityTile[];
  /** süs blokları (dünya koordinatı; konumlarına göre parsellere dağıtılır) */
  decor?: (c: DecorCtx) => Block[];
  /**
   * (Kapadokya, <city>): yürünür yükselti — sahanlık, merdiven ve rampa. Dikdörtgenin YÜRÜNEBİLİR karolarının üst yüzü `y`
   * (sabit sahanlık) ya da `dir` yönünde karo başına eşit adımla `y`'den `y1`'e yükselir (adım ≤ 0,35: basamak kuralı; avatar
   * kendiliğinden çıkar). Zemin sütun olarak çizilir (`colors` adım başına döner: renkli mozaik basamaklar). Yükseltiye yürüyerek
   * çıkılmayan sahanlık (teleferik doruğu) katı karolarla (`solid`) çevrilmelidir. Tanımsızsa semt düzdür (eski davranış).
*/
  terraces?: DesignTerrace[];
}

/** Yürünür yükselti dikdörtgeni (semt yerel); `dir` +i/−i/+j/−j: adımların yükseldiği yön. */
export interface DesignTerrace { rect: CityRect; y: number; y1?: number; dir?: "+i" | "-i" | "+j" | "-j"; colors?: string[] }

/** Zamanlı an: seyir noktasında gün batımı (akşam saatleri ya da kullanıcının seçtiği gece ışığı). */
export interface CityMoment { id: string; vp: number; when: "sunset" }
/** Semt kilidi: önceki semte girilmişse ya da ofis seviyesi yeterliyse açılır (para yolu yok; SK-K5). */
export interface DistrictUnlock { after: string; level: number }
/** Süresiz semt görevi: `need` kimliklerinin tümü pasaportta olunca tamamlanır (geri sayım, seri, kayıp yok). */
export interface CityQuest { id: string; district: string; need: string[] }

export interface CityDesign {
  districts: Record<string, DistrictDesign>;
  landmarks: Record<string, LandmarkModel>;
  /** semt → zamanlı anlar ("an" damgası): semtin `vp` sıralı seyir noktasında, `when` koşulu sağlanınca (gün saatine bağlı ama
   *  süresiz; FOMO yok: "Gece" ışığı her an seçilebilir) */
  moments?: Record<string, CityMoment[]>;
  unlock?: Record<string, DistrictUnlock>;
  quests?: CityQuest[];
  /**
   * CITY-POLISH: hat kimliği → rota köşesi başına sürüş yüksekliği (avatar ayak y'si; dizi uzunluğu = rota köşe sayısı). Teleferik
   * gibi havada giden hatlarda araç halatı izler ve doruklara girmez; köşeler arası yay uzunluğuyla doğrusal. Tanımsızsa aracın
   * sabit `rideY`'si (transit/model.ts). city_check CITY-MAP-TRANSIT-001 aracın araziye ve yapıya girmediğini denetler.
   */
  rides?: Record<string, number[]>;
}

// ------------------------------------------------------------------------------------------ çizim ilkelleri
export type Sink = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, g?: Block["g"], j?: number) => void;

/** Blok listesine yazan kutu fonksiyonu. */
export function sink(out: Block[]): Sink {
  return (x, y, z, w, h, d, c, g = "solid", j = 0.03) => { out.push({ p: [x, y, z], s: [w, h, d], c, g, j }); };
}

/** Sekizgen prizma (üç kutu): yuvarlak gövde, kubbe kademesi. y merkez. */
export function oct(b: Sink, x: number, y: number, z: number, w: number, h: number, c: string, j = 0.03) {
  b(x, y, z, w, h, w * 0.42, c, "solid", j);
  b(x, y, z, w * 0.42, h, w, c, "solid", j);
  b(x, y, z, w * 0.8, h, w * 0.8, c, "solid", j);
}

/** Kubbe: y taban, r yarıçap, h yükseklik; sekizgen kademeler (kademe başına 3 kutu) + isteğe bağlı alem. */
export function dome(b: Sink, x: number, y: number, z: number, r: number, h: number, c: string, steps = 3, finial: string | null = null) {
  const hh = h / steps;
  for (let k = 0; k < steps; k++) {
    const t = (k + 0.35) / steps;
    oct(b, x, y + k * hh + hh / 2, z, 2 * r * Math.sqrt(1 - t * t), hh + 0.02, c);
  }
  if (finial) b(x, y + h + 0.2, z, 0.1, 0.4, 0.1, finial, "solid", 0);
}

/** İnce kalem minare (6 kutu): kaide, gövde, şerefe, üst gövde, külah (iki kademe). Yalnız dış silüet; alem yok. */
export function minaret(b: Sink, x: number, z: number, h: number, c: string, cap: string, shaft = 0.5) {
  b(x, 0.6, z, shaft * 1.6, 1.2, shaft * 1.6, c);
  b(x, h * 0.42, z, shaft, h * 0.84 - 1.2, shaft, c);
  b(x, h * 0.72, z, shaft * 1.9, 0.14, shaft * 1.9, "#8E98A1", "solid", 0.02);
  b(x, h * 0.86, z, shaft * 0.85, h * 0.28, shaft * 0.85, c);
  b(x, h + 0.25, z, shaft * 0.8, 0.5, shaft * 0.8, cap, "solid", 0.02);
  b(x, h + 0.85, z, shaft * 0.36, 0.7, shaft * 0.36, cap, "solid", 0.02);
}

/** Kademeli kablo (sarkık): (x0, y0) → (x1, y1), z sabit; n kutu. */
export function cable(b: Sink, x0: number, y0: number, x1: number, y1: number, sag: number, n: number, z: number, c: string, t = 0.08) {
  const at = (u: number) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u - sag * 4 * u * (1 - u)];
  for (let q = 0; q < n; q++) {
    const [ax, ay] = at(q / n), [bx, by] = at((q + 1) / n);
    b((ax + bx) / 2, (ay + by) / 2, z, Math.abs(bx - ax) + 0.02, Math.abs(by - ay) + t, t, c, "solid", 0);
  }
}
