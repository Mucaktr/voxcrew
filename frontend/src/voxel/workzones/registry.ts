/**
 * WORK-ZONES (ürün sahibi 2026-10-28, plan §5 C2) — çalışma bölgesi kaydı.
 *
 * "Agentlara çalışacakları alanlar görev verilirken belirlenebilir. Bölge olarak. Agentlar kullanıcının kendilerine belirlediği
 * o bölgelerde çalışırlar. Şehirlerde de ofis alanları ve binaları olabilir. Agentlar işe gider gibi buralara da gidebilirler."
 *
 * Tek kaynak `zones.json` (arka uç `backend/studio/workzones` AYNI dosyayı okur; doğrulama ikisinde de aynı kimliklerle). Bölge
 * kimliği: `office` (taban ofis / çalışma alanı; varsayılan = bugünkü davranış) ya da `<sahne>:<ofis>` (ör. `istanbul:levent`).
 * Yalnız 13 şehir sahnesinde ofis binası vardır; öteki sahnelerde tek seçenek `office`.
 *
 * Ad anahtarları (`dist_wz_<sahne>_<ofis>`) dünya sözlüğüne (locales/world.ts) modül yüklenirken eklenir — tabela ve mini harita
 * bölge adını bu anahtarla okur; var olan anahtar ezilmez (cities/locales.ts deseni). Saf modül: React/three yok.
*/
import data from "./zones.json";
import { world } from "../../locales/world";
import { FULL_ZONE_CITIES, FULL_ZONE_ORDER } from "../../full/workzones";

export type OfficeLook = "tower" | "han" | "loft" | "castiron" | "haussmann" | "modernist" | "canal" | "shophouse" | "teak"
  | "hanok" | "riad" | "cave" | "modern";

export interface OfficeDef { id: string; look: OfficeLook; tr: string; en: string }
export interface WorkZone {
  /** `office` ya da `<sahne>:<ofis>` */
  id: string;
  scene: string | null;
  office: string | null;
  look: OfficeLook | null;
  tr: string;
  en: string;
}

export const BASE_ZONE = "office";
/** Ofis binasındaki masa sayısı (iki ada × dört masa; offices.ts `OFFICE_SEATS` ile aynı). */
export const OFFICE_DESKS = 8;
/** Bölge tabelası/mini harita ad anahtarı öneki. */
export const ZONE_LABEL_PREFIX = "dist_wz_";

const RAW_CITIES: Record<string, OfficeDef[]> = { ...(data as { cities: Record<string, OfficeDef[]> }).cities, ...FULL_ZONE_CITIES };
/** Full edition keeps today's scene order (zones.json order + full/zones.full.json); the free edition has the json order only. */
const CITIES: Record<string, OfficeDef[]> = FULL_ZONE_ORDER.length ? Object.fromEntries(FULL_ZONE_ORDER.filter((k) => k in RAW_CITIES).map((k) => [k, RAW_CITIES[k]])) : RAW_CITIES;
const BASE = (data as { base: { id: string; tr: string; en: string } }).base;

export const ZONE_SCENES: readonly string[] = Object.keys(CITIES);
export const zoneId = (scene: string, office: string) => `${scene}:${office}`;
export const zoneLabel = (scene: string, office: string) => `${ZONE_LABEL_PREFIX}${scene}_${office}`;

/** `<sahne>:<ofis>` → parçalar (kayıtta yoksa null); `office` ve boş değer null. */
export function parseZone(id: string | null | undefined): { scene: string; office: string; def: OfficeDef } | null {
  if (!id || id === BASE_ZONE) return null;
  const k = id.indexOf(":");
  if (k <= 0) return null;
  const scene = id.slice(0, k), office = id.slice(k + 1);
  const def = CITIES[scene]?.find((o) => o.id === office);
  return def ? { scene, office, def } : null;
}

/** Bölge kimliği geçerli mi (ve verilirse bu sahnenin mi)? `office` her sahnede geçerlidir. */
export function isZoneFor(id: string | null | undefined, scene?: string | null): boolean {
  if (!id || id === BASE_ZONE) return true;
  const p = parseZone(id);
  return !!p && (scene == null || p.scene === scene);
}

const baseZone: WorkZone = { id: BASE_ZONE, scene: null, office: null, look: null, tr: BASE.tr, en: BASE.en };
const cache = new Map<string, WorkZone[]>();
/** Sahnenin seçilebilir bölgeleri: önce taban ofis, sonra (şehirse) ofis binaları. Aynı sahne → aynı dizi. */
export function zonesFor(scene: string | null | undefined): WorkZone[] {
  const key = scene ?? "";
  let out = cache.get(key);
  if (!out) {
    out = [baseZone, ...(CITIES[key] ?? []).map((o) => ({ id: zoneId(key, o.id), scene: key, office: o.id, look: o.look, tr: o.tr, en: o.en }))];
    cache.set(key, out);
  }
  return out;
}
export const officesOf = (scene: string | null | undefined): readonly OfficeDef[] => (scene ? CITIES[scene] ?? [] : []);
export const hasOffices = (scene: string | null | undefined) => officesOf(scene).length > 0;

/** Bölge adı (dil). Bilinmeyen kimlikte kimliğin kendisi değil taban ofis adı döner (ham kimlik gösterilmez). */
export function zoneName(id: string | null | undefined, lang: "tr" | "en"): string {
  const p = parseZone(id);
  return p ? p.def[lang] : BASE[lang];
}

/** Modül etiketinden (`dist_wz_<sahne>_<ofis>`) bölge kimliği; değilse null. */
const byLabel = new Map<string, string>();
for (const [scene, list] of Object.entries(CITIES)) for (const o of list) byLabel.set(zoneLabel(scene, o.id), zoneId(scene, o.id));
export const zoneOfLabel = (label: string | null | undefined): string | null => (label ? byLabel.get(label) ?? null : null);

// dünya sözlüğüne ofis adları (tabela, mini harita): var olan anahtar ezilmez
for (const [scene, list] of Object.entries(CITIES)) {
  for (const o of list) {
    const k = zoneLabel(scene, o.id);
    const tr = world.tr as Record<string, string>, en = world.en as Record<string, string>;
    if (!(k in tr)) tr[k] = o.tr;
    if (!(k in en)) en[k] = o.en;
  }
}
