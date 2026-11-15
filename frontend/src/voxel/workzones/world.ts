/**
 * WORK-ZONES — kurulmuş dünyadaki ofis binaları ve "işe gidiş" ataması (saf; React/three yok).
 *
 *  - `officeSites(built)`: modül etiketinden (`dist_wz_<sahne>_<ofis>`) ofis bölgeleri → bölge kimliği, kapı, içeri karo, masa
 *    istasyonlarının dizinleri (modül `slots` aralığı).
 *  - `officeDoorFx(built)`: kapılarda geçit perdesi (citylife/doorFx.ts `curtain`, giriş türü `interior`; F istemi doors.ts).
 *  - `assignZoneSeats(built, requests, home)`: bölgede çalışacak ajanlara boş masa; bölge bu dünyada yoksa (`missing`), masası
 *    kalmadıysa (`full`) ya da evinden yürüyerek ulaşılamıyorsa (`unreachable`) ajan taban ofiste (kendi masasında) çalışır.
 *    Belirlenimci: istek sırası (koşu başlama sırası, sonra ad) → aynı girdi aynı masa.
 *  - `withOffices(demand, offices)`: dünya talebine kullanılan ofisleri ekler (core.ts `Demand.offices`; boşsa talep aynen).
 */
import type { DoorFx } from "../citylife/doorFx";
import { findPath, tx, tz, type Built, type Tile } from "../scenes";
import type { Demand } from "../districts/core";
import { officeTiles } from "./offices";
import { parseZone, zoneOfLabel } from "./registry";

export interface OfficeSite {
  zone: string;
  /** modül sol-arka karosu */
  i0: number; j0: number;
  door: Tile;
  inside: Tile;
  /** istasyon dizinleri (built.stations) */
  stations: number[];
}

const siteCache = new WeakMap<Built, OfficeSite[]>();
export function officeSites(built: Built): OfficeSite[] {
  let out = siteCache.get(built);
  if (out) return out;
  out = [];
  for (const m of built.modules ?? []) {
    const zone = zoneOfLabel(m.label);
    if (!zone) continue;
    const t = officeTiles(m.i0, m.j0);
    const stations: number[] = [];
    for (let k = m.slots[0]; k < m.slots[1]; k++) stations.push(k);
    out.push({ zone, i0: m.i0, j0: m.j0, door: t.door, inside: t.inside, stations });
  }
  siteCache.set(built, out);
  return out;
}

const fxCache = new WeakMap<Built, DoorFx[]>();
/** Ofis kapılarının geçit perdesi (dünya koordinatı; içeri yön −z). */
export function officeDoorFx(built: Built): DoorFx[] {
  let out = fxCache.get(built);
  if (out) return out;
  out = officeSites(built).map((s) => ({ id: `wzdoor:${s.zone}`, kind: "curtain" as const, entrance: "interior" as const,
    x: tx(s.door[0]), z: tz(s.door[1]), y: 0, dir: [0, -1] as [number, number], tile: s.door, target: s.zone }));
  fxCache.set(built, out);
  return out;
}

export type ZoneSeatState = "ok" | "missing" | "full" | "unreachable";
export interface ZoneRequest { slug: string; zone: string; order?: number }
export interface ZoneSeatResult {
  /** ajan → istasyon dizini (yalnız "ok") */
  seats: Map<string, number>;
  /** ajan → durum (bölge isteyen herkes) */
  state: Map<string, { zone: string; state: ZoneSeatState }>;
}

/**
 * Bölge isteyen ajanlara bölgedeki boş masaları dağıtır. `home(slug)`: ajanın taban masası karosu (ulaşılabilirlik denetimi; yoksa
 * kapı karosundan denetlenir). Taban ofis (`office`) isteği atlanır (bugünkü davranış).
 */
export function assignZoneSeats(built: Built, requests: readonly ZoneRequest[], home: (slug: string) => Tile | null): ZoneSeatResult {
  const seats = new Map<string, number>();
  const state = new Map<string, { zone: string; state: ZoneSeatState }>();
  if (!requests.length) return { seats, state };
  const sites = officeSites(built);
  const used = new Map<string, number>();
  const sorted = [...requests].filter((r) => parseZone(r.zone)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const r of sorted) {
    const site = sites.find((s) => s.zone === r.zone);
    if (!site) { state.set(r.slug, { zone: r.zone, state: "missing" }); continue; }
    const k = used.get(site.zone) ?? 0;
    if (k >= site.stations.length) { state.set(r.slug, { zone: r.zone, state: "full" }); continue; }
    const st = built.stations[site.stations[k]];
    const from = home(r.slug);
    if (!st || (from && !findPath(from, st.tile, built))) { state.set(r.slug, { zone: r.zone, state: "unreachable" }); continue; }
    used.set(site.zone, k + 1);
    seats.set(r.slug, site.stations[k]);
    state.set(r.slug, { zone: r.zone, state: "ok" });
  }
  return { seats, state };
}

/** Dünya talebine kullanılan ofisleri ekler (yalnız bu sahnenin geçerli ofisleri; sıralı, tekil). Boşsa aynı nesne döner. */
export function withOffices(demand: Demand, scene: string | null | undefined, zones: readonly string[]): Demand {
  const offices = [...new Set(zones.map((z) => parseZone(z)).filter((p) => p && p.scene === scene).map((p) => p!.office))].sort();
  return offices.length ? { ...demand, offices } : demand;
}
