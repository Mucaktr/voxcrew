/**
 * ACTIVITY-FEEL (B4/B6) — **şehir rehberi kioskü**: bütün şehir sahnelerindeki ekranlı-düğmeli kiosk (`Builder.terminal`: koyu gövde,
 * yeşil ekran, renkli düğmeler; ajanların kabuk istasyonu) yürüme modunda "Şehir rehberi" terminalidir. F "Şehir rehberine bak"
 * paneli açar (UI: components/world/walk/guide/CityGuide.tsx). Kiosk o şehirde bir kez kullanılınca rehber HUD'dan da açılır
 * (kiosk anlamlı kalsın). Ajanların kabuk işi değişmez (istasyon aynı yerde).
 *
 *  - Kiosk bulma: taban sahnede `Builder.terminal` imzası (gövde 0,8 × 1,4 × 0,6, renk #1F2937, merkez y 0,7) + ekranın yönü (yeşil
 *    `glow` #34D399) → ön karo. Büyümüş dünyada taban kayması eklenir (ritüel konumlarıyla aynı kural). Şehir haritasında kiosk
 *    girdisi yok (rehber açıldıysa HUD düğmesi orada da çalışır).
 *  - Yakındakiler: `hot:guide:<n>` (tür "guide"); dokunuş `guidePoke` (menzil `RITUAL_RANGE`).
 * Saf olmayan tek parça zustand deposu (`useCityGuide`): açık mı, hangi şehir, kilidi açılmış şehirler (tarayıcıda; yalnız kolaylık).
 */
import { create } from "zustand";
import { tx as t9n } from "../../lib/i18n";
import { cityGuide as GM } from "../../locales/cityGuide";
import { interiorRuntime } from "../interiors/runtime";
import { cityRuntime } from "../citymap/runtime";
import { useCity } from "../citymap/store";
import { tileOf, tx, tz, type Block, type Built, type Tile } from "../scenes";
import { useWalkStore, walkRuntime } from "../walk/walkStore";
import type { ProxEntity } from "../walk/controller";
import { say } from "./announce";
import { isRitualCity } from "./rituals";
import { RITUAL_RANGE, ritualSceneBuilt } from "./ritualRuntime";

export const GUIDE_PREFIX = "hot:guide:";
const BODY = "#1F2937", SCREEN = "#34D399";

/** `Builder.terminal` kutusu mu (taban sahne bloğu). */
export const isKioskBody = (q: Block): boolean => q.g === "solid" && q.c === BODY && Math.abs(q.s[0] - 0.8) < 1e-3 && Math.abs(q.s[1] - 1.4) < 1e-3
  && Math.abs(q.s[2] - 0.6) < 1e-3 && Math.abs(q.p[1] - 0.7) < 1e-3;

export interface Kiosk { n: number; /** kiosk karosu ve ön (müşteri) karosu; taban göreli */ tile: Tile; front: Tile; x: number; z: number; face: number }

/** Taban sahnedeki kiosklar (ekran yönü → ön karo). */
export function findKiosks(built: Pick<Built, "blocks">): Kiosk[] {
  const out: Kiosk[] = [];
  for (const q of built.blocks) {
    if (!isKioskBody(q)) continue;
    const scr = built.blocks.find((r) => r.g === "glow" && r.c === SCREEN && Math.abs(r.p[0] - q.p[0]) < 0.5 && Math.abs(r.p[2] - q.p[2]) < 0.5 && Math.abs(r.p[1] - 1.0) < 0.01);
    const dx = scr ? scr.p[0] - q.p[0] : 0, dz = scr ? scr.p[2] - q.p[2] : 0.31;
    const t = tileOf(q.p[0], q.p[2]);
    const f: Tile = Math.abs(dx) > Math.abs(dz) ? [t[0] + Math.sign(dx), t[1]] : [t[0], t[1] + Math.sign(dz || 1)];
    out.push({ n: out.length, tile: t, front: f, x: q.p[0], z: q.p[2], face: Math.atan2(q.p[0] - tx(f[0]), q.p[2] - tz(f[1])) });
  }
  return out;
}

const kioskCache = new Map<string, Kiosk[]>();
/** Şehir sahnesinin kioskları (taban; sahne başına bir kez). Şehir değilse boş. */
export function cityKiosks(world: string): Kiosk[] {
  if (!isRitualCity(world)) return [];
  let l = kioskCache.get(world);
  if (!l) {
    const b = ritualSceneBuilt(world);
    l = b ? findKiosks(b) : [];
    kioskCache.set(world, l);
  }
  return l;
}

// ------------------------------------------------------------------ depo
const UNLOCK_KEY = "voxcrew.cityGuide.unlocked";
function loadUnlocked(): string[] {
  try { const v = JSON.parse(globalThis.localStorage?.getItem(UNLOCK_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}
interface GuideState {
  open: boolean;
  /** panelin şehri */
  city: string | null;
  /** kioskta en az bir kez açılmış şehirler (HUD erişimi) */
  unlocked: readonly string[];
  /** son açılışta kilit yeni açıldı (panel bir kez bildirir) */
  justUnlocked: boolean;
}
export const useCityGuide = create<GuideState>(() => ({ open: false, city: null, unlocked: loadUnlocked(), justUnlocked: false }));

/** Rehberi açar. `fromKiosk`: kiosktan (şehrin kilidi açılır). HUD'dan yalnız kilidi açık şehirde açılır. */
export function openCityGuide(city: string, fromKiosk: boolean): boolean {
  const st = useCityGuide.getState();
  const known = st.unlocked.includes(city);
  if (!fromKiosk && !known) return false;
  const unlocked = known ? st.unlocked : [...st.unlocked, city];
  if (!known) { try { globalThis.localStorage?.setItem(UNLOCK_KEY, JSON.stringify(unlocked)); } catch { /* özel pencere: oturumluk */ } }
  useCityGuide.setState({ open: true, city, unlocked, justUnlocked: !known });
  return true;
}
export const closeCityGuide = () => useCityGuide.setState({ open: false, justUnlocked: false });
/** Test kancası. */
export function resetCityGuide(): void { useCityGuide.setState({ open: false, city: null, unlocked: [], justUnlocked: false }); kioskCache.clear(); }

// ------------------------------------------------------------------ Yakındakiler
export interface GuideEntity extends ProxEntity { label: string; type: "guide" }
const NONE: readonly GuideEntity[] = Object.freeze([]) as readonly GuideEntity[];
const pool: GuideEntity[] = [];

/** Şu anki şehir sahnesi (iç mekân ve şehir haritası dışında). */
function guideWorld(): string | null {
  const st = useWalkStore.getState();
  if (!st.active || !st.world || interiorRuntime.inside || cityRuntime.active) return null;
  return isRitualCity(st.world) ? st.world : null;
}
/** Kiosk girdileri (dünya koordinatı: kiosk gövdesi; "git ve dokun" ön karoya yürür). */
export function guideEntities(): readonly GuideEntity[] {
  const w = guideWorld();
  if (!w) return NONE;
  const ks = cityKiosks(w);
  if (!ks.length) return NONE;
  const off = walkRuntime.baseOffset;
  const label = t9n(GM, "kiosk");
  ks.forEach((k, i) => {
    const e = pool[i] ??= { id: `${GUIDE_PREFIX}${i}`, kind: "prop", x: 0, z: 0, label: "", type: "guide" };
    e.x = tx(k.tile[0] + off[0]); e.z = tz(k.tile[1] + off[1]); e.label = label;
  });
  pool.length = ks.length;
  return pool;
}

/** F / Yakındakiler: kiosk kimliğiyse rehberi açar (uzaksa kısa duyuru) ve true döner. */
export function guidePoke(id: string): boolean {
  if (!id.startsWith(GUIDE_PREFIX)) return false;
  const w = guideWorld();
  const n = Number(id.slice(GUIDE_PREFIX.length));
  const k = w ? cityKiosks(w)[n] : undefined;
  if (!w || !k) return true;
  const off = walkRuntime.baseOffset, x = tx(k.tile[0] + off[0]), z = tz(k.tile[1] + off[1]), av = walkRuntime.avatar;
  if (Math.hypot(av.x - x, av.z - z) > RITUAL_RANGE) { say(t9n(GM, "kiosk_closer"), x, 1.6, z); return true; }
  av.heading = Math.atan2(x - av.x, z - av.z);
  openCityGuide(w, true);
  return true;
}

/** HUD'daki rehberin şehri: sahnede sahne, şehir haritasında haritanın şehri (kilidi açıksa). */
export function guideCityNow(): string | null {
  const st = useWalkStore.getState();
  if (!st.active || !st.world) return null;
  if (cityRuntime.active) { const v = useCity.getState().view; const c = v?.city ?? null; return c && isRitualCity(c) ? c : null; }
  return isRitualCity(st.world) ? st.world : null;
}
