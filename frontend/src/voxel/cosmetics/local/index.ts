/**
 * yerel kostüm çekirdeği. Kendi kıyafeti seçili olmayan ajan, yerel kostümü olan bir
 * şehir sahnesinde o şehri temsil eden ücretsiz bir parça giyer. Yerel kostümler hiçbir zaman satılmaz; mağaza, sandık, sezon ya
 * da oyun kataloğunda yer almaz (`local-*`; `cosmetics/policy.py` denetler). Mağaza setleri `sets/` altındadır; bu klasör
 * bilerek onun DIŞINDADIR (`test_cosmetics_catalog` `sets/*.ts`'de satılık set bekler).
 *
 * Öncelik sırası (`chooseWear`):
 * 1. dış ajan → değişmez
 * 2. kullanıcının seçtiği ve sahip olduğu mağaza kıyafeti → her zaman kazanır
 * 3. avatarda zaten `wear` var (3D deneme) → değişmez
 * 4. kahraman görünümü (pelerin, maske, amblem, parıltı, süzülme) → değişmez (kararı O6: kahraman donanımı kimliktir)
 * 5. ayar açık ve sahnede yerel kostüm var → `localWearFor(slug, sahne)` (FNV-1a, oturumlar arası sabit; zaman kilidi yok)
 * "Ben" avatarı aynı kuralı yalnız kullanıcı açıkça isterse uygular (varsayılan kapalı, karar O10).
 *
 * Saf veri ve saf işlev (three/React yok): node testleri, politika testi ve Crowd aynı tanımı okur. Kutular Crowd'un var olan
 * toplu gruplarına girer (+0 çizim çağrısı); parça ≤ 30 kutu, uzak LOD (`lod: 0`) ≤ 12, `glow` ≤ 2, hareketli parça yok.
 * Kültürel inceleme listesi (§3.3) ve içerik politikası (§3.4) her parçada geçerlidir.
*/
import type { Avatar } from "../../../lib/types";
import { cosmeticsMsg } from "../../../locales/cosmetics";
import { hasAura, normalizeAvatar } from "../../avatar";
import { presentationOfName, type Presentation } from "../../../lib/presentation";
import { NEW_CITIES } from "../../cities/index";
import type { OutfitItem } from "../registry";
import { FULL_LOCAL_RAW } from "../../../full/localCostumes";

export type LocalKind = "gunluk" | "festival" | "is";
export interface LocalCostume extends OutfitItem {
  /** sahne kimliği ("istanbul", "<city>"…)*/
  city: string;
  kind: LocalKind;
  /** belirlenimci dağılım ağırlığı (festival ≈ 1/4) */
  weight: number;
  ip_risk: 0 | 1;
  culture_risk: 0 | 1;
  /** tek satır gerekçe (§3.3; politika ad taramasına girmez) */
  culture_note: string;
  /** culture_risk 1 → zorunlu */
  review?: { by: "lider" | "kultur" | "ceo"; date: string };
  /** görünen ad (locales/cosmetics.ts `local_<şehir>_<parça>`; politika ad taraması okur) */
  tr?: string;
  en?: string;
  /** GIFTS-GENDER: kadın kesimi (`<parça>-f`): aynı parça + etek. Yalnız `LOCAL_VARIANTS`/`LOCAL_BY_ID`'de; liste dışı. */
  gender?: "f";
  variantOf?: string;
}

/** Festival parçaları seyrek görünür; zaman kilidi yok (D8). */
export const LOCAL_WEIGHT: Readonly<Record<LocalKind, number>> = { gunluk: 4, is: 4, festival: 1 };

const RAW: readonly (readonly LocalCostume[])[] = [
  ...FULL_LOCAL_RAW,
  // dizindeki yeni şehirler (`V/cities/<id>/costumes.ts`); yalnız giyim kutusu (`wear`) taşıyan tam parçalar
  ...NEW_CITIES.map((m) => (m.costumes ?? []) as readonly LocalCostume[]).filter((l) => l.length && "wear" in l[0]),
];

export const localKey = (id: string) => id.replace(/-/g, "_") as keyof typeof cosmeticsMsg.tr;
const named = (c: LocalCostume): LocalCostume =>
  // sözlükte anahtar yoksa (yeni şehir) verinin kendi adı
  ({ ...c, tr: cosmeticsMsg.tr[localKey(c.id)] ?? c.tr, en: cosmeticsMsg.en[localKey(c.id)] ?? c.en });

export const LOCAL_COSTUMES: Readonly<Record<string, readonly LocalCostume[]>> = Object.freeze(
  Object.fromEntries(RAW.filter((l) => l.length > 0).map((l) => [l[0].city, Object.freeze(l.map(named))])));
/** GIFTS-GENDER: kadın kesimi kimliği. */
export const femId = (id: string) => `${id}-f`;
const SKIRTS = ["#3A4250", "#5B4636", "#2F625E"];
/** Parçanın kadın kesimi: aynı kostüm + altında düz renkli etek (politika: tek renk, yazı/simge yok). Ad: "… (kadın kesimi)". */
function femVariant(c: LocalCostume): LocalCostume {
  const skirt = SKIRTS[fnv1a(c.id) % SKIRTS.length];
  return {
    ...c, id: femId(c.id), gender: "f", variantOf: c.id,
    tr: `${c.tr ?? c.id} (kadın kesimi)`, en: `${c.en ?? c.id} (women's cut)`,
    culture_note: `${c.culture_note} Kadın kesimi: aynı parça, altında düz etek.`,
    wear: (a, box) => { c.wear(a, box); box("body", [0, 5.6, 0], [9.4, 3.8, 6.2], skirt, { lod: 0 }); },
  };
}
/** Her yerel kostümün kadın kesimi (liste dışı: 7 şehir/15 parça sözleşmesi değişmez). */
export const LOCAL_VARIANTS: ReadonlyMap<string, LocalCostume> = new Map(
  Object.values(LOCAL_COSTUMES).flatMap((l) => l.map((c) => [c.id, femVariant(c)] as const)));
/** kimlik `local-<şehir>-<parça>` (+ kadın kesimleri `…-f`) */
export const LOCAL_BY_ID: ReadonlyMap<string, LocalCostume> = new Map([
  ...Object.values(LOCAL_COSTUMES).flatMap((l) => l.map((c) => [c.id, c] as const)),
  ...[...LOCAL_VARIANTS.values()].map((v) => [v.id, v] as const)]);

/** FNV-1a 32 bit (UTF-16 kod birimleri). */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Ajanın bu şehirdeki yerel kostümü: `FNV-1a(slug + ":" + sahne) % Σağırlık`. Şehrin kostümü yoksa undefined. */
export function localWearFor(slug: string, scene: string | undefined, presentation?: Presentation): string | undefined {
  const id = baseWearFor(slug, scene);
  return id && presentation === "f" ? femId(id) : id; // GIFTS-GENDER: aynı parça, kadın kesimi
}
function baseWearFor(slug: string, scene: string | undefined): string | undefined {
  const list = scene ? LOCAL_COSTUMES[scene] : undefined;
  if (!list?.length) return undefined;
  const total = list.reduce((n, c) => n + c.weight, 0);
  let r = fnv1a(`${slug}:${scene}`) % total;
  for (const c of list) { if (r < c.weight) return c.id; r -= c.weight; }
  return list[list.length - 1].id;
}

/** Kahraman görünümü (O6): pelerin, maske, amblem, parıltı ya da süzülme varsayılan değil. */
export function hasHeroLook(a: Partial<Avatar> | null | undefined): boolean {
  if (!a) return false;
  return (!!a.cape && a.cape !== "none") || (!!a.mask && a.mask !== "none") || (!!a.emblem && a.emblem !== "none")
    || hasAura(a as Pick<Avatar, "aura">) || a.hover === true;
}

/**
 * Tek ajan için giyilecek kıyafet (öncelik sırası yukarıda). Dönüş: atanacak `wear` kimliği ya da undefined (değişmez).
 * `scene` undefined → yerel kostüm kapalı (ayar kapalı ya da şehir dışı).
 */
export function chooseWear(o: { external?: boolean; store?: string; avatar?: Partial<Avatar> | null; slug: string; scene?: string; presentation?: Presentation }): string | undefined {
  if (o.external) return undefined;
  if (o.store) return o.store;
  if (o.avatar?.wear) return undefined;
  if (hasHeroLook(o.avatar)) return undefined;
  return localWearFor(o.slug, o.scene, o.presentation);
}

type Dressable = { agent: { slug: string; name?: string; avatar?: Partial<Avatar> | null }; external?: unknown };
/** Dünya kalabalığı: kuralı uygular. Hiçbir ajan değişmiyorsa AYNI diziyi döner (Crowd yeniden kurulmaz). */
export function dressAgents<T extends Dressable>(agents: T[], store: Readonly<Record<string, string>> | undefined, scene: string | undefined): T[] {
  const local = !!scene && !!LOCAL_COSTUMES[scene];
  if (!local && !(store && Object.keys(store).length)) return agents;
  let changed = false;
  const out = agents.map((wa) => {
    const av = wa.agent.avatar;
    const pres = av?.presentation ?? (wa.agent.name ? presentationOfName(wa.agent.name) : undefined); // store türetir; yoksa addan
    const id = chooseWear({ external: !!wa.external, store: store?.[wa.agent.slug], avatar: av, slug: wa.agent.slug,
      scene: local ? scene : undefined, presentation: pres });
    if (!id || wa.agent.avatar?.wear === id) return wa;
    changed = true;
    return { ...wa, agent: { ...wa.agent, avatar: { ...normalizeAvatar(wa.agent.avatar), wear: id } } };
  });
  return changed ? out : agents;
}

/**
 * UXF-E: ajanın şu an giydiği KOSTÜM (ajan paneli satırı): yerel kostümse adı ve şehri, mağaza seçimiyse `store: true`.
 * `chooseWear` ile aynı kural (dış ajan, mağaza seçimi, 3D deneme, kahraman görünümü, yerel kostüm); giyilen yoksa null.
*/
export interface WornCostume { id: string; local: boolean; city: string | null; tr: string; en: string }
export function wornCostume(o: { external?: boolean; store?: string; avatar?: Partial<Avatar> | null; slug: string; name?: string; scene?: string }): WornCostume | null {
  const local = !!o.scene && !!LOCAL_COSTUMES[o.scene];
  const pres = o.avatar?.presentation ?? (o.name ? presentationOfName(o.name) : undefined);
  const id = o.external ? undefined : (o.store ?? o.avatar?.wear ?? chooseWear({ avatar: o.avatar, slug: o.slug, scene: local ? o.scene : undefined, presentation: pres }));
  if (!id) return null;
  const lc = LOCAL_BY_ID.get(id);
  if (lc) return { id, local: true, city: lc.city, tr: lc.tr ?? id, en: lc.en ?? id };
  return { id, local: false, city: null, tr: id, en: id };
}

/** "Ben" avatarının sabit karma anahtarı (kişisel veri değil). */
export const ME_LOCAL_SLUG = "me";
/** "Ben": mağaza seçimi kazanır; yerel kostüm yalnız `optIn` (varsayılan kapalı). Değişmezse AYNI nesne. */
export function dressMe<T extends { avatar: Avatar }>(me: T, store: string | undefined, scene: string | undefined, optIn: boolean): T {
  const id = chooseWear({ store, avatar: me.avatar, slug: ME_LOCAL_SLUG, scene: optIn ? scene : undefined });
  return id && me.avatar.wear !== id ? { ...me, avatar: { ...me.avatar, wear: id } } : me;
}
