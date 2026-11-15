/**
 * şehir pasaportu istemcisi (`/api/walk/city*`; sözleşme: backend/studio/walk/explore.py `city_state` / `city_visit`).
 * Yazma kullanıcı-yalnızdır (`/api/walk/` USER_ONLY_RE) ve idempotenttir (`client_request_id` + parmak izi). React yok.
*/
import { currentLocale } from "../../lib/i18n";
import { bodyText } from "../../lib/api";

export interface CityDistrictSum { total: number; found: number; percent: number }
export interface CityQuestRow { id: string; district: string; target: number; progress: number; done: boolean }
export interface CityStateRow {
  found: string[]; stops: string[]; districts: Record<string, CityDistrictSum>; total: number; found_count: number; percent: number;
  /** kilitli semtler ve süresiz görevler*/
  locked: string[]; quests: CityQuestRow[];
  /** görev semti kilitliyken kaydedilmiş duraklar → o anda kilitli görev semtleri*/
  stale: Record<string, string[]>;
  /** oyuncunun son baktığından beri kataloğa eklenen, henüz bulunmamış damgalar (yüzde düşüşünün nedeni)*/
  new_ids: string[];
}
export interface CityStateView { cities: Record<string, CityStateRow>; admin: boolean; level: number }
export interface CityVisitResult {
  already: boolean; recorded: boolean; admin: boolean; reason?: string; kind: string; stamp: boolean;
  /** bu kayıtla tamamlanan görevler ve güncel kilitli semtler (yoksa null: görüntüleme kipi)*/
  quests: string[]; locked: string[] | null;
  /** durak görev semti kilitliyken kaydedildiyse o semtler*/
  lockedFor: string[];
}

export class CityApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); msg = bodyText(res.status, j); } catch { /* gövde yok */ }
    throw new CityApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

function requestId() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const strLists = (v: unknown): Record<string, string[]> =>
  (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, arr(x)])) : {});

export function normalizeCityState(raw: unknown): CityStateView {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cities: Record<string, CityStateRow> = {};
  const src = (r.cities && typeof r.cities === "object" ? r.cities : {}) as Record<string, Record<string, unknown>>;
  for (const [id, c] of Object.entries(src)) {
    if (!c || typeof c !== "object") continue;
    const quests = (Array.isArray(c.quests) ? c.quests : []).filter((q): q is CityQuestRow => !!q && typeof q === "object" && typeof (q as CityQuestRow).id === "string");
    cities[id] = { found: arr(c.found), stops: arr(c.stops), districts: (c.districts && typeof c.districts === "object" ? c.districts : {}) as Record<string, CityDistrictSum>,
      total: Number(c.total) || 0, found_count: Number(c.found_count) || 0, percent: Number(c.percent) || 0, locked: arr(c.locked), quests,
      stale: strLists(c.stale), new_ids: arr(c.new_ids) };
  }
  return { cities, admin: !!r.admin, level: Number(r.level) || 1 };
}

export const cityApi = {
  state: (city?: string | null) => req<unknown>("GET", `/api/walk/city${city ? `?city=${encodeURIComponent(city)}` : ""}`).then(normalizeCityState),
  seen: (city: string) => req<unknown>("POST", "/api/walk/city/seen", { city, client_request_id: requestId() }),
  visit: (city: string, id: string) => req<Record<string, unknown>>("POST", "/api/walk/city", { city, id, client_request_id: requestId() })
    .then((r): CityVisitResult => ({ already: !!r.already, recorded: r.recorded !== false, admin: !!r.admin, kind: String(r.kind ?? ""),
      stamp: !!r.stamp, reason: typeof r.reason === "string" ? r.reason : undefined, quests: arr(r.quests_completed),
      locked: Array.isArray(r.locked) ? arr(r.locked) : null, lockedFor: arr(r.locked_for) })),
};
