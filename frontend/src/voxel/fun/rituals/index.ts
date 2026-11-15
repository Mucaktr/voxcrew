/**
 * şehir ritüelleri çekirdeği: veri biçimi, dalga 1 kataloğu ve toplayıcı.
 * Saf modül: three, React ve çalışma zamanı yok. Şehir verisi `rituals/<şehir>.ts` dosyalarında (..08 doldurur),
 * metinler `locales/ritual<Şehir>.ts` içinde. Ritüel ödülü yalnız anıdır: hiçbir alan oyun parası, XP ya da SP taşımaz.
*/
import type { Sfx } from "../../sfx/sfx";
import type { Burst } from "../fx";
import { isVenueKind, VENUE_KINDS, type VenueKind } from "../venues";
import { ISTANBUL_RITUALS } from "./istanbul";
import { LONDRA_RITUALS } from "./londra";
import { KAPADOKYA_RITUALS } from "./kapadokya";
import { NEW_CITY_IDS } from "../../cities/index";
import { FULL_RITUAL_CITIES, FULL_RITUAL_IDS, FULL_RITUALS_BY_CITY } from "../../../full/rituals";
import { cityRecord } from "../../cities/hooks";

/** dizindeki yeni şehirler sona eklenir (catalog.json `rituals`; arka uç walk/rituals.py aynı dosyayı okur).*/
export const RITUAL_CITIES = [...FULL_RITUAL_CITIES, ...NEW_CITY_IDS] as const;
export type RitualCity = (typeof RITUAL_CITIES)[number];
export const isRitualCity = (s: string | null | undefined): s is RitualCity => !!s && (RITUAL_CITIES as readonly string[]).includes(s);

/** Avatar hareketi (`Character.tsx Motion` adları). Oturma ayrı alandır (`act.sit`). ACTIVITY-FEEL (B3): `eat` — elde yiyecek
 *  ağza götürülür (ısırık döngüsü); veri `sip` + yiyecek yazsa da çalışma zamanı yemek hareketine çevirir (`rituals/logic.ts`). */
export type RitualMotion = "toss" | "sip" | "eat" | "cheer" | "dance" | "wave" | "read" | "type";
export type RitualSit = "sit_bench" | "sit_ground";
/** Elde tutulan nesne (§3.3). Çizimi (`propPool.ts ItemModel`); burada yalnız ad sözleşmesi.*/
export type HeldItem =
  | "simit" | "tea_glass" | "crepe" | "sandwich" | "paper_cone" | "hotdog" | "coconut" | "bento" | "bowl" | "hammer" | "peas"
  | "tea" | "snack" | "meal" | "note" | "cup";
export type LureKind = "gull" | "pigeon" | "duck" | "fish" | "cat" | "squirrel";
/** catch: süzülüp havada kapar · peck: yere inip gagalar · swim: halkaya yüzer/yüzeye çıkar · curious: yaklaşır, durur, döner */
export type LureMode = "catch" | "peck" | "swim" | "curious";
export type RitualBurst = Extract<Burst, "steam" | "petals" | "ripple" | "notes" | "puff" | "sparkle">;
/** day: gece görünmez · night: yalnız gece · dusk: var olan gün batımı kuralı (akşam ya da Gece ışığı) · any: her zaman */
export type RitualWhen = "day" | "dusk" | "night" | "any";

/** Sahne karosu (taban sahne ızgarası; büyümüş dünyada taban kayması çalışma zamanında eklenir). `face`: avatarın bakışı
 *  (rad, `AvatarState.heading` kuralı: 0 → +z, π → −z). */
export interface SceneAnchor { tile: [number, number]; face: number;
  /** HQA-FIX: mekânsız "al" ritüelinde satış arabası/tezgâhının yönü (rad, konumdan arabaya); satıcı figüranı arabanın
   * ardında durur (`citylife/vendors.ts venueVendors`). Denetim:.*/
  cart?: number }
/** Şehir haritası bağlantısı: semt, isteğe bağlı landmark (kapısı ya da ayak izinin ortası) ya da durak (`V/citymap/catalog.ts`). */
/** CORE-WALK: `tile` — semt yerel karo (mekânın sipariş karosu gibi; durak/landmark yerine). */
export interface MapAnchor { district: string; landmark?: string; stop?: string; tile?: [number, number];
  /** HQA-FIX: satış arabasının yönü (rad; `SceneAnchor.cart` ile aynı)*/
  cart?: number }

export interface RitualDef {
  /** "simit_marti" → anı kimliği `rt:istanbul:simit_marti` (`ritualMemoryId`) */
  id: string;
  city: RitualCity;
  at: {
    /** sahne karoları (test: yürünür, sessiz bölge dışı) */
    scene?: SceneAnchor[];
    /** şehir haritası bağlantıları */
    map?: MapAnchor[];
    /** hayvana bağlı ritüel: girdi yalnız bu türden bir ortam hayvanı avatarın yakınındayken ( `type` yayımlar)*/
    animal?: "cat";
  };
  act: {
    motion: RitualMotion; sit?: RitualSit; held?: HeldItem; /** ritüel süresi (sn, oturma/dönme payı hariç) */ secs: number;
    /** ACTIVITY-FEEL (B3): yeme sayılır mı (yemek hareketi + bitince sevinç). Boş → `sip` + yiyecek (`FOOD_ITEMS`) ise yemek;
     * `false` yiyecek gibi görünen içeceği (<city> çay kâsesi) ayırır.*/
    eat?: boolean;
  };
  react?: {
    lure?: { kinds: LureKind[]; n: number; mode: LureMode };
    burst?: RitualBurst;
    sfx?: Sfx;
  };
  when?: RitualWhen;
  /** CORE-WALK: ritüelin yapıldığı mekân türü (`fun/venues.ts`; ör. balık-patates → `chip_shop`). Oturmalı ritüel bu mekânın
   *  gerçek oturağına yürür; mekân sahne/semt dosyasında `city/venues.ts placeVenue` ile kurulur. */
  venue?: VenueKind;
  /** fotoğraf modu otomatik kadraj; fotoğraf odağı da sessiz bölge denetiminden geçer*/
  photo?: true;
  /** `locales/ritual<Şehir>.ts` anahtar öneki: `<locale>_label` (Yakındakiler fiili), `<locale>_done` (bitiş duyurusu),
   * `<locale>_note` (anı kartı notu)*/
  locale: string;
}

/** Dalga 1'in 25 ritüel kimliği (§1; arka uç `walk/rituals.py` eşlik testi bununla yapılır).*/
export const RITUAL_IDS = {
  istanbul: ["simit_marti", "cay_bogaz", "guvercin_yem", "balik_ekmek", "kedi_mama"],
  londra: ["ordek_bezelye", "ikindi_cayi", "balik_patates"],
  kapadokya: ["teras_balon", "testi_kebabi", "hali_dugum"],
  ...FULL_RITUAL_IDS,
  ...cityRecord((m): readonly string[] => m.catalog.rituals),
} as const satisfies Record<RitualCity, readonly string[]>;
export type RitualId = (typeof RITUAL_IDS)[RitualCity][number];
export const ALL_RITUAL_IDS: readonly RitualId[] = RITUAL_CITIES.flatMap((c) => RITUAL_IDS[c]);

/** Toplayıcı: bütün şehir verisi (şehir sırası sabit). */
const RITUALS_RAW = {
  istanbul: ISTANBUL_RITUALS, londra: LONDRA_RITUALS, kapadokya: KAPADOKYA_RITUALS,
  ...FULL_RITUALS_BY_CITY,
  ...cityRecord((m) => m.rituals),
};
/** Key order = RITUAL_CITIES order (the full edition keeps today's city order). */
export const RITUALS_BY_CITY: Readonly<Record<RitualCity, readonly RitualDef[]>> = Object.fromEntries(
  RITUAL_CITIES.map((c) => [c, (RITUALS_RAW as Readonly<Record<string, readonly RitualDef[]>>)[c]])) as Record<RitualCity, readonly RitualDef[]>;
export const RITUALS: readonly RitualDef[] = RITUAL_CITIES.flatMap((c) => RITUALS_BY_CITY[c]);

export const ritualMemoryId = (d: Pick<RitualDef, "city" | "id">) => `rt:${d.city}:${d.id}`;
/** Yakındakiler kimliği (`hot:wheel` deseni): `hot:rt:<ritüel>:<n>`; `n` bağlantı sırası. */
export const RITUAL_ENTITY_PREFIX = "hot:rt:";
export const ritualEntityId = (id: string, n: number) => `${RITUAL_ENTITY_PREFIX}${id}:${n}`;
export function parseRitualEntityId(eid: string): { id: string; n: number } | null {
  if (!eid.startsWith(RITUAL_ENTITY_PREFIX)) return null;
  const rest = eid.slice(RITUAL_ENTITY_PREFIX.length);
  const k = rest.lastIndexOf(":");
  if (k <= 0) return null;
  const n = Number(rest.slice(k + 1));
  return Number.isInteger(n) && n >= 0 ? { id: rest.slice(0, k), n } : null;
}

/** Ritüel süresi sınırları (sn): tek dokunuşluk "an"; uzun bekletme yok. */
export const RITUAL_SECS_MIN = 1;
export const RITUAL_SECS_MAX = 12;
const REWARD_KEYS = /coin|jeton|xp|sp$|reward|odul|ödül/i;

/**
 * Veri denetimi (şehir testleri ve eşliği kullanır). `strict` (varsayılan): kimlik dalga 1 kataloğunda olmalı.
 * Boş dizi = sorun yok.
*/
export function ritualIssues(defs: readonly RitualDef[], strict = true): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    const tag = `${d.city}:${d.id}`;
    if (!isRitualCity(d.city)) out.push(`${tag}: bilinmeyen şehir`);
    else if (strict && !(RITUAL_IDS[d.city] as readonly string[]).includes(d.id)) out.push(`${tag}: kimlik dalga 1 kataloğunda yok`);
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(d.id)) out.push(`${tag}: kimlik biçimi`);
    if (seen.has(d.id)) out.push(`${tag}: kimlik tekrarı`);
    seen.add(d.id);
    if (!d.at.scene?.length && !d.at.map?.length && !d.at.animal) out.push(`${tag}: konum yok`);
    if (!(d.act.secs >= RITUAL_SECS_MIN && d.act.secs <= RITUAL_SECS_MAX)) out.push(`${tag}: süre ${d.act.secs}`);
    if (d.react?.lure && !(d.react.lure.n >= 1 && d.react.lure.n <= 6 && d.react.lure.kinds.length)) out.push(`${tag}: çekme sayısı`);
    if (!/^[a-z][a-z0-9_]*$/.test(d.locale)) out.push(`${tag}: locale öneki`);
    if (d.venue !== undefined && !isVenueKind(d.venue)) out.push(`${tag}: bilinmeyen mekân ${d.venue}`);
    if (d.venue !== undefined && d.act.sit && VENUE_KINDS[d.venue].pose !== d.act.sit) out.push(`${tag}: mekân oturuşu ${VENUE_KINDS[d.venue].pose} ≠ ${d.act.sit}`);
    for (const k of Object.keys(d)) if (REWARD_KEYS.test(k)) out.push(`${tag}: ödül alanı yasak (${k})`);
  }
  return out;
}
