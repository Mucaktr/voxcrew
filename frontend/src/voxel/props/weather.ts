/**
 * SP-W0 — sahne hava durumu ve sahne saati ( `weather`, "Sahne saati").
 * - `SceneDef.weather`: yağmur, kar, sis, kabarcık, kıvılcım (ateş böceği tonu), aurora. Parçacıklar `props/SceneFx.tsx`
 * içinde movers ile ORTAK tek InstancedMesh'tir (+1 çizim çağrısı, ≤ 600 parçacık); hareket azaltmada parçacıklar kapalı,
 * aurora durağan.
 * - `SceneDef.time`: "night" sahneleri (Neon Çarşı, Aurora) Otomatik ışıkta gece görünür; kullanıcının Görünüm → Işık
 * seçimi (Gündüz/Gece) her zaman üstündür. `night: true` (kamp, uzay) eski anlamını korur.
 * - Görünüm → Hava durumu (açık/kapalı): `useWeatherFx`; tercih bu tarayıcıda.
*/
import { useEffect, useState } from "react";
import { create } from "zustand";
import type { SceneDef, WeatherKind } from "../scenes";
import { isNightHour, useLightMode } from "./daynight";
import { NEW_CITIES } from "../cities/index";
import { FULL_PLACE_CLIMATE, FULL_SNOW_GROUND } from "../../full/weather";

export const WEATHER_KINDS: WeatherKind[] = ["rain", "snow", "mist", "bubbles", "embers", "aurora", "petals"];
export const MAX_PARTICLES = 600;

/** Tür başına parçacık sayısı (bütçe paylaştırılır: toplam ≤ MAX_PARTICLES). */
export const PARTICLES: Record<WeatherKind, number> = { rain: 480, snow: 380, mist: 22, bubbles: 180, embers: 140, aurora: 42, petals: 90 };

/** W2-INT — aralıklı yağmur: sahne saatine bağlı belirlenimci döngü (RAIN_CYCLE sn). Döngünün ≈ %35'inde yağar; RAIN_FADE sn
 *  içinde yumuşakça başlar/diner; tepe yoğunluk RAIN_PEAK (hafif yağmur). Dönüş 0–1: görünen yağmur parçacığı payı.
 *  Hareket azaltmada parçacıklar zaten kapalı (SceneFx). Şemsiye anı (fun/brain.ts) da buna bakar. */
export const RAIN_CYCLE = 150, RAIN_ON = 0.35, RAIN_FADE = 9, RAIN_PEAK = 0.75;
export function rainLevel(t: number): number {
  const u = ((t % RAIN_CYCLE) + RAIN_CYCLE) % RAIN_CYCLE, on = RAIN_CYCLE * RAIN_ON;
  if (u >= on) return 0;
  const edge = Math.min(u, on - u);
  return RAIN_PEAK * Math.min(1, edge / RAIN_FADE);
}

/** Sahnenin hava katmanları için parçacık dağılımı (sıra korunur; tavanı aşarsa orantılı küçülür). */
export function particleBudget(kinds: readonly WeatherKind[] | undefined): [WeatherKind, number][] {
  const list = [...new Set(kinds ?? [])].filter((k) => k in PARTICLES);
  const want = list.reduce((s, k) => s + PARTICLES[k], 0);
  const f = want > MAX_PARTICLES ? MAX_PARTICLES / want : 1;
  return list.map((k) => [k, Math.floor(PARTICLES[k] * f)]);
}

// ------------------------------------------------------------------ Görünüm → hava durumu
const KEY = "voxcrew.world.weather";
function load(): boolean {
  try { return window.localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export const useWeatherFx = create<{ on: boolean; setOn: (on: boolean) => void }>((set) => ({
  on: typeof window === "undefined" ? true : load(),
  setOn: (on) => {
    try { window.localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* yoksay */ }
    set({ on });
  },
}));

// ------------------------------------------------------------------ sahne saati
/** Etkin gece mi: kullanıcı Gündüz/Gece seçtiyse o; Otomatik'te sahnenin saati (`time`), yoksa yerel saat. */
export function sceneNight(def: Pick<SceneDef, "time">, mode: "auto" | "day" | "night", hourNight: boolean): boolean {
  if (mode !== "auto") return mode === "night";
  if (def.time === "night") return true;
  if (def.time === "day") return false;
  return hourNight;
}

/** `useNight()`ın sahne saatine duyarlı sürümü (World.tsx). */
export function useSceneNight(def: Pick<SceneDef, "time">): boolean {
  const mode = useLightMode((s) => s.mode);
  const [hourNight, setHourNight] = useState(isNightHour);
  useEffect(() => {
    if (mode !== "auto" || def.time === "night" || def.time === "day") return;
    setHourNight(isNightHour());
    const id = window.setInterval(() => setHourNight(isNightHour()), 60_000);
    return () => window.clearInterval(id);
  }, [mode, def.time]);
  return sceneNight(def, mode, hourNight);
}

// ================================================================== mevsimler (C1) ve hava anları (A5)
/**
 * Mevsim YEREL tarihten (yalnız ay) belirlenimcidir ve her yıl aynı tekrar eder; ödül, sayaç, geri sayım ya da "kaçırdın" yoktur
 *. Sahneler yarım küre/iklim bildirmez (SceneDef'te alan yok), bu yüzden tablo burada, yer
 * kimliğiyle (sahne `def.annex ?? def.id` ya da şehir haritası `cityView.city`): <city> güney yarım kürede ve tropikal, taç rengi
 * değişmez, kar yok. Tabloda olmayan sahneler (ofis, fantastik, iç mekân) mevsim ve hava anı almaz.
 *
 * Hava anı: yer × ay × gün × SAAT tohumundan seçilen kısa (4–7 dk) tek bir an: hafif sağanak (su halkalarıyla), sabah sisi,
 * kışın birkaç kar tanesi. Yıl tohuma girmez: aynı tarih ve saatte her yıl aynı an. Aynı anda en çok bir an; mini oyun sürerken
 * yok; hareket azaltmada parçacık yok (sis yalnız durağan sis tonu: yakın sis mesafesi). Ayar: Görünüm → Hava anları.
*/
export type Season = "spring" | "summer" | "autumn" | "winter";
export const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];
export type MomentKind = "shower" | "mist" | "flurry";
export const MOMENT_KINDS: readonly MomentKind[] = ["shower", "mist", "flurry"];

export interface PlaceClimate {
  /** yarım küre: güneyde mevsim 6 ay kayar */
  hemi: "N" | "S";
  /** tropikal: taç rengi değişmez, kar yok */
  tropical: boolean;
  /** kış tacı: çıplak dal ya da kar serpintisi (iklime göre) */
  winter: "bare" | "snow";
  /** kışın "birkaç kar tanesi" anı olabilir mi */
  flurry: boolean;
  /** sağanak anı olabilir mi (sahnenin kendi yağmuru varsa hayır: Londra) */
  shower: boolean;
}
/** Şehir sahneleri ve şehir haritaları (aynı kimlikler). Değerler stilize; gerçek iklim kaydı değildir. */
export const PLACE_CLIMATE: Readonly<Record<string, PlaceClimate>> = {
  istanbul: { hemi: "N", tropical: false, winter: "bare", flurry: true, shower: true },
  londra: { hemi: "N", tropical: false, winter: "bare", flurry: true, shower: false },
  kapadokya: { hemi: "N", tropical: false, winter: "snow", flurry: true, shower: true },
  ...FULL_PLACE_CLIMATE,
  ...Object.fromEntries(NEW_CITIES.map((m) => [m.catalog.id, m.climate])),
};
export const climateOf = (place: string | null | undefined): PlaceClimate | null => (place ? PLACE_CLIMATE[place] ?? null : null);
/** C2 izleri: zemini baştan sona kar olan sahneler (kum, sahnenin `sand` kancalarından gelir). */
export const SNOW_GROUND: ReadonlySet<string> = new Set(["snow", ...FULL_SNOW_GROUND]);

/** Meteorolojik mevsim (kuzey: Mar–May ilkbahar, Haz–Ağu yaz, Eyl–Kas sonbahar, Ara–Şub kış; güneyde 6 ay kayık). */
export function seasonOf(date: Date, hemi: "N" | "S" = "N"): Season {
  const m = (date.getMonth() + (hemi === "S" ? 6 : 0)) % 12;
  return m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
}

/** Sıklık ve süre. `chance`: bir saatte an olma olasılığı (yer başına; günde ≈ 4–5 kısa an, zamanın ≈ %2'si). */
export const MOMENT = {
  chance: 0.2, minDur: 4, maxDur: 7, fade: 20,
  /** sabah sisi yalnız bu saatlerde [başlangıç, bitiş) */
  mistHours: [5, 10] as readonly [number, number],
  /** parçacık sayıları (sahnenin kendi havasıyla birlikte toplam ≤ MAX_PARTICLES; sis parçacık değil, sis tonu) */
  particles: { shower: 200, flurry: 48, mist: 0 } as Readonly<Record<MomentKind, number>>,
  /** sis anında sis mesafesi çarpanı (durağan ton; hareket azaltmada da) */
  mistFog: 0.5,
  /** sağanakta saniyede su halkası (fx havuzu) */
  ripples: 3,
} as const;

export interface Moment { kind: MomentKind; start: number; dur: number }

/** FNV-1a + xorshift: yer × ay × gün × saat → [0,1) sayı dizisi (yıl yok → her yıl aynı). */
function seedRand(s: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  h ||= 1;
  return () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}

/** Bu saatin anı (varsa): saf, belirlenimci. Uygun türler mevsim, saat ve iklimden; tek an döner. */
export function momentOfHour(place: string, date: Date): Moment | null {
  const c = climateOf(place);
  if (!c) return null;
  const hour = date.getHours();
  const r = seedRand(`${place}|${date.getMonth() + 1}-${date.getDate()}|${hour}`);
  if (r() >= MOMENT.chance) return null;
  const season = seasonOf(date, c.hemi);
  const kinds: MomentKind[] = [];
  if (c.shower && !(season === "winter" && c.winter === "snow")) kinds.push("shower");
  if (hour >= MOMENT.mistHours[0] && hour < MOMENT.mistHours[1]) kinds.push("mist");
  if (season === "winter" && c.flurry && !c.tropical) kinds.push("flurry");
  if (!kinds.length) return null;
  const kind = kinds[Math.floor(r() * kinds.length)];
  const dur = MOMENT.minDur + Math.floor(r() * (MOMENT.maxDur - MOMENT.minDur + 1));
  const start = Math.floor(r() * (60 - dur));
  return { kind, start, dur };
}

/** O anki an ve yoğunluğu 0–1 (giriş/çıkış `MOMENT.fade` sn). Pencere dışında null. */
export function momentAt(place: string | null | undefined, date: Date): { kind: MomentKind; level: number } | null {
  if (!place) return null;
  const m = momentOfHour(place, date);
  if (!m) return null;
  const u = (date.getMinutes() - m.start) * 60 + date.getSeconds() + date.getMilliseconds() / 1000; // saniye
  const len = m.dur * 60;
  if (u < 0 || u >= len) return null;
  return { kind: m.kind, level: Math.max(0, Math.min(1, u / MOMENT.fade, (len - u) / MOMENT.fade)) };
}

/** Anın parçacık payı: sahnenin kendi hava bütçesinden artanı aşmaz (toplam ≤ MAX_PARTICLES). */
export function momentParticles(kinds: readonly WeatherKind[] | undefined, kind: MomentKind | null): number {
  if (!kind) return 0;
  const used = particleBudget(kinds).reduce((s, [, n]) => s + n, 0);
  return Math.max(0, Math.min(MOMENT.particles[kind], MAX_PARTICLES - used));
}

// ------------------------------------------------------------------ geliştirme kancası (yalnız `vite dev`)
/** Canlı denetim için mevsim/an zorlama: `localStorage["voxcrew.dev.season"] = '{"season":"winter","moment":"flurry"}'`, sonra
 *  yeniden yükle. Üretim derlemesinde (`import.meta.env.DEV` false) hiç okunmaz. */
export interface SeasonForce { season?: Season; moment?: MomentKind | null }
function devForce(): SeasonForce | null {
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  if (!env?.DEV || typeof window === "undefined") return null;
  try { const v = window.localStorage.getItem("voxcrew.dev.season"); return v ? JSON.parse(v) as SeasonForce : null; } catch { return null; }
}
/** Yerin bugünkü mevsimi (tabloda yoksa null). */
export function seasonNow(place: string | null | undefined, date = new Date()): Season | null {
  const c = climateOf(place);
  if (!c) return null;
  const f = devForce();
  return f?.season && SEASONS.includes(f.season) ? f.season : seasonOf(date, c.hemi);
}
/** Yerin şu anki hava anı (dev zorlaması dahil; zorlanan an sürekli tam yoğunlukta). */
export function momentNow(place: string | null | undefined, date = new Date()): { kind: MomentKind; level: number } | null {
  const f = devForce();
  if (f && f.moment !== undefined && climateOf(place)) return f.moment && MOMENT_KINDS.includes(f.moment) ? { kind: f.moment, level: 1 } : null;
  return momentAt(place, date);
}

// ------------------------------------------------------------------ Görünüm → hava anları (açık/kapalı; varsayılan açık)
const MOMENTS_KEY = "voxcrew.world.weatherMoments";
function loadMoments(): boolean {
  try { return window.localStorage.getItem(MOMENTS_KEY) !== "off"; } catch { return true; }
}
export const useWeatherMoments = create<{ on: boolean; setOn: (on: boolean) => void }>((set) => ({
  on: typeof window === "undefined" ? true : loadMoments(),
  setOn: (on) => {
    try { window.localStorage.setItem(MOMENTS_KEY, on ? "on" : "off"); } catch { /* yoksay */ }
    set({ on });
  },
}));

// ------------------------------------------------------------------ mevsim taç rengi (çalışma anında örnek rengi)
/** Etkin taç eşlemi (büyük harf hex → mevsim rengi; tablo `city/kit.ts canopyTint`). World sahne/şehir değişince yazar; Blocks
 *  ve kuyruk yazıcısı (expanse/tail.ts) örnek rengini `tintHex` ile alır. Yeni mesh, malzeme ya da çizim çağrısı yok; sahne
 *  yapımı ve dünya JSON'u değişmez (bake = build eşdeğerliği korunur). Boş eşlem: renk aynen. */
let TINT: ReadonlyMap<string, string> = new Map();
let tintVer = 0;
export function setSeasonTint(map: ReadonlyMap<string, string>): void { if (map !== TINT) tintVer++; TINT = map; }
/** eşlem değişince artar (renk önbelleği `expanse/tail.ts blockColor` bununla geçersizlenir).*/
export const tintVersion = () => tintVer;
export function tintHex(hex: string): string {
  if (!TINT.size) return hex;
  return TINT.get(hex.toUpperCase()) ?? hex;
}
