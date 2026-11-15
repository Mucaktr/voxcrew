/**
 * COS-B — kozmetik mağaza setlerinin çizim kayıt defteri ( "her yerde çizili" kapısı).
 *
 * Her set özgün, belirlenimci ve tamdır; tek öğe satılmaz. Her öğe `surfaces` listesiyle çizildiğini iddia ettiği
 * yüzeyleri bildirir; bu defter her (öğe yüzü, yüzey) çifti için çiziciyi verir. `frontend/scripts/cosmetic_coverage.mjs`
 * çizicileri gerçekten çalıştırır (`voxel/cosmetics/coverage.ts`) ve COS-A'nın arka uç kapısının okuduğu
 * `cosmetic_coverage.json`'u yazar. Çizilmeyen yüzey, statik hâli olmayan kutlama ya da risk > 1 → satılamaz.
 *
 * Kurallar : bayrak, harita, logo, marka, gerçek kişi, gerçek dilde yazı, dinî simge ve
 * kültürel/yöresel kıyafet yok. Parçalar yalnız var olan voxel kutu dilinden kodla çizilir (dış model/doku yok).
 * Bu dosya saf veridir (three/React yok): node betiği ve Crowd/Character aynı tanımı okur.
 *
 * Ölçü: "piksel" (16 px = 1 blok), karakterle aynı. Saydamlık yalnız Crowd toplu gruplarındaki değerler (0,32 · 0,45 ·
 * 0,82 · 0,95) ya da parlak (`glow`) → kalabalıkta +0 çizim çağrısı.
*/
import type { Avatar } from "../../lib/types";
import type { BoxFn, V3 } from "../parts";
import { LOCAL_BY_ID } from "./local";
import { ANATOLIAN_LEGENDS } from "./sets/anatolianLegends";
import { CREATURE_WORKSHOP } from "./sets/creatureWorkshop";
import { ELEMENT_WARDENS } from "./sets/elementWardens";
import { GARDEN_LAB } from "./sets/gardenLab";
import { GOTHIC_CLASSICS } from "./sets/gothicClassics";
import { LEGEND_SQUAD } from "./sets/legendSquad";
import { NIGHT_WORKSHOP } from "./sets/nightWorkshop";
import { NORTHLANDS } from "./sets/northlands";
import { OLYMPUS_MYTHS } from "./sets/olympusMyths";
import { POLAR_TEAM } from "./sets/polarTeam";
import { SPOOKY_NIGHT } from "./sets/spookyNight";
import { STAR_WAYFARERS } from "./sets/starWayfarers";
import { YOKAI_NIGHT } from "./sets/yokaiNight";

/** yüzey sözlüğü. Bu dalga: avatar (ajan: dünya, profil, deneme), me ("Ben" yürüme avatarı), desk (ofis masası),
 * world (dünya teması), celebration (kutlama), collection (Koleksiyon listesi). build ve hero ikinci dalgadır.*/
export type Surface = "avatar" | "me" | "desk" | "world" | "celebration" | "build" | "hero" | "collection";
export const SURFACES: readonly Surface[] = ["avatar", "me", "desk", "world", "celebration", "build", "hero", "collection"];

/** Sahne kutusu (masa üstü, dünya teması ya da kutlama yerel koordinatı, px). */
export interface SceneBox { p: V3; s: V3; c: string; glow?: boolean; glass?: boolean; r?: V3 }

interface ItemBase {
  /** Envanter kimliğinin öğe kısmı: `store:<id>` (COS-A projeksiyonu). `<set>-<parça>` biçimi. */
  id: string;
  surfaces: Surface[];
}
/** Ajan kıyafeti: parts.ts `characterParts` içinde çizilir (Character, Crowd dünya kalabalığı, "Ben" avatarı). */
export interface OutfitItem extends ItemBase {
  slot: "outfit";
  /** başlık taşır: kendi şapka yuvası çizilmez, saç şapka altı biçimine geçer */
  head?: boolean;
  /** gözlük taşır: gözlük yuvası çizilmez */
  eyes?: boolean;
  wear: (a: Avatar, box: BoxFn) => void;
}
/** Masa süsü: masa üstü merkezli (y = 0 masa yüzeyi), ofis önizlemesinde masaya konur. */
export interface DeskItem extends ItemBase { slot: "desk"; boxes: () => SceneBox[] }
/** Dünya teması: var olan sahnenin ışık, gökyüzü ve lamba paleti varyantı + çevre süsü. Yeni sahne değildir (K6). */
export interface WorldTheme {
  sky: string; hemiSky: string; hemiGround: string; sun: string; sunIntensity: number;
  floor: [string, string]; wall: string; lamp: string;
  boxes: () => SceneBox[];
}
export interface WorldItem extends ItemBase { slot: "world"; theme: WorldTheme }
/** Kutlama: `t` 0..1 ilerleme. `calm` (prefers-reduced-motion) statik hâldir: t'den bağımsız, hareketsiz, yanıp sönmez. */
export interface CelebrationItem extends ItemBase {
  slot: "celebration";
  durationMs: number;
  frame: (t: number, calm: boolean) => SceneBox[];
}
export type CosmeticItem = OutfitItem | DeskItem | WorldItem | CelebrationItem;
export type Slot = CosmeticItem["slot"];

export interface CosmeticSet {
  /** hak kimliği `cosmetic:<id>` (entitlements), envanter `store:<öğe id>` */
  id: string;
  /** kovası [H]; fiyat bağlanmaz (satış kapalı)*/
  bucket: "small" | "large";
  /** 0–3: ≤ 1 yayınlanır, 2 insan/avukat incelemesi, 3 red*/
  ip_risk: number;
  culture_risk: number;
  /** imza parçası: süresiz bir başarımla ücretsiz kazanılır; başarımı COS-A kataloğu bağlar*/
  signature: string;
  /** satıştan sonra tüm setin ücretsiz arşiv görevine açılması [H] */
  free_after_months: number;
  /** vitrin rengi (kart ve deneme kaidesi; yazı değil) */
  tint: string;
  /** vitrin bölümü: ofis setleri (varsayılan) ya da HERO-PACKS karakter/kostüm paketleri*/
  group?: "office" | "costume";
  /** mevsimlik NOT (yalnız bilgi; geri sayım, son gün, sıralama, bildirim yok; set süresizdir) */
  seasonal?: "halloween";
  items: CosmeticItem[];
}

export const COSMETIC_SETS: readonly CosmeticSet[] = [
  POLAR_TEAM, NIGHT_WORKSHOP, GARDEN_LAB,
  // HERO-PACKS: özgün kahramanlar, kamu malı mit/folklor/edebiyat, genel kostüm ve yaratıklar
  LEGEND_SQUAD, ELEMENT_WARDENS, ANATOLIAN_LEGENDS, OLYMPUS_MYTHS, NORTHLANDS, YOKAI_NIGHT, GOTHIC_CLASSICS,
  STAR_WAYFARERS, CREATURE_WORKSHOP, SPOOKY_NIGHT,
];

const ITEMS = new Map<string, { set: CosmeticSet; item: CosmeticItem }>();
for (const set of COSMETIC_SETS) for (const item of set.items) ITEMS.set(item.id, { set, item });

export const cosmeticSet = (id: string): CosmeticSet | undefined => COSMETIC_SETS.find((s) => s.id === id);
export const cosmeticItem = (id: string) => ITEMS.get(id);

/** parts.ts: avatarın mağaza kıyafeti ya da şehir sahnesindeki ücretsiz yerel kostümü (yoksa null).*/
export function wearOf(id: string | undefined): OutfitItem | null {
  if (!id) return null;
  const hit = ITEMS.get(id)?.item ?? LOCAL_BY_ID.get(id);
  return hit && hit.slot === "outfit" ? hit : null;
}

/**
 * Çizici defteri: her (yuva, yüzey) için çizimin yapıldığı yer. `contexts` canlı uygulamada bu çizicinin çalıştığı
 * bileşenlerdir; kapsam betiği bunları JSON'a yazar ki arka uç kapısı neyin nerede çizildiğini görsün.
 * `live`: ürün sahiplenince ekstra bağlama gerekmeden canlı dünyada çizilir mi (false → bugün yalnız 3D deneme ve liste).
 */
export interface Renderer { renderer: string; contexts: string[]; live: boolean }
const TAB = "components/game/CosmeticStoreTab.tsx";
export const RENDERERS: Partial<Record<Slot, Partial<Record<Surface, Renderer>>>> = {
  outfit: {
    avatar: { renderer: "parts.characterParts → OutfitItem.wear()", live: true,
      contexts: ["voxel/Crowd.tsx (dünya kalabalığı; World.tsx useDressedAgents)", "voxel/Character.tsx", `${TAB} (3D deneme)`] },
    me: { renderer: "parts.characterParts(badge) → OutfitItem.wear()", live: true,
      contexts: ["voxel/Crowd.tsx makeMeCh (yürüme modu; World.tsx useDressedMe)", `${TAB} (3D deneme)`] },
    collection: { renderer: "CosmeticStoreTab › Koleksiyon", live: true, contexts: [TAB] },
  },
  desk: {
    desk: { renderer: "Boxes.CosmeticBoxes ← DeskItem.boxes()", live: true,
      contexts: ["voxel/cosmetics/WorldLayer.tsx (ajan masaları, monitör yanı)", `${TAB} (kaydedilmeyen ofis önizlemesi)`] },
    collection: { renderer: "CosmeticStoreTab › Koleksiyon", live: true, contexts: [TAB] },
  },
  world: {
    world: { renderer: "WorldLayer.ThemeSky + Boxes.CosmeticBoxes ← WorldItem.theme", live: true,
      contexts: ["voxel/cosmetics/WorldLayer.tsx (gökyüzü/sis paleti + dünya fonu)", `${TAB} (kaydedilmeyen ofis önizlemesi)`] },
    collection: { renderer: "CosmeticStoreTab › Koleksiyon", live: true, contexts: [TAB] },
  },
  celebration: {
    celebration: { renderer: "Boxes.CelebrationBoxes ← CelebrationItem.frame(t, calm)", live: true,
      contexts: ["voxel/cosmetics/WorldLayer.tsx (oyun kutlaması tetiklenince)", `${TAB} (deneme kutlaması)`] },
    collection: { renderer: "CosmeticStoreTab › Koleksiyon", live: true, contexts: [TAB] },
  },
};
export const rendererFor = (slot: Slot, surface: Surface): Renderer | undefined => RENDERERS[slot]?.[surface];
