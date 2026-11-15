/**
 * S45 — dünya kuralları için iz kancası. Hiçbir şey içe aktarmaz (döngüsel içe aktarma
 * yok): `buildings.ts`, `districts/*` ve sahne dosyaları Builder YÖNTEMİ OLMAYAN serbest yardımcılarda (kat döşemesi, merdiven,
 * tekne, şezlong, araba…) `noteObject` çağırır. Kanca yalnızca kural denetimi sırasında (frontend/scripts/rules.mjs) kurulur;
 * uygulamada `sink` null'dır → çağrı tek bir null denetimidir, hiçbir şey kaydedilmez, dünya JSON'una girmez.
*/

/** Serbest yardımcıların bildirdiği ontoloji türleri (Builder yöntemleri ayrıca izlenir: rules/trace.ts). */
export type NotedType =
  | "floor_slab" | "upper_storey" | "parking_deck" | "stairs" | "ramp" | "escalator" | "elevator" | "tower"
  | "car" | "boat" | "sun_lounger" | "tent";

export interface NoteInfo {
  /** karo cinsinden genişlik × derinlik (döşeme, kule) */
  w?: number; d?: number;
  /** dünya biriminde üst yüz / taban yüksekliği (kat döşemesi, araba tabanı) */
  y?: number;
  /** kat sayısı (asansör, kule) */
  floors?: number;
  /** kapalı yapı: katlar arası erişim içeride varsayılır (kule, derslik kanadı) */
  enclosed?: boolean;
  /** su üstünde (tekne) */
  onWater?: boolean;
}

export interface TraceSink { note(b: object, type: NotedType, tile: [number, number], info?: NoteInfo): void }

/** Kural denetimi sırasında kurulur; uygulamada null. */
export const traceHooks: { sink: TraceSink | null } = { sink: null };

/** Serbest yardımcılar için: kanca kurulu değilse hiçbir şey yapmaz. */
export function noteObject(b: object, type: NotedType, tile: [number, number], info?: NoteInfo): void {
  traceHooks.sink?.note(b, type, tile, info);
}
