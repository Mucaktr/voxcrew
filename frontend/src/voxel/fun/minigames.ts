/**
 * W3 (WALK-FUN) — yerel ve deterministik mini oyunlar: olta, masa oyunu (üç taş), atış.
 * Model çağrısı, token ve XP yok; ödül kozmetik koleksiyon kartıdır. WORLD-FIX: oltada başarılı yakalama sunucu yetkili jeton
 * verir (backend/studio/walk/fishing.py; günlük tavan, azalan getiri, atış başına tek ödeme) — istemci miktar belirlemez.
 *
 * Sözleşme (WALK-UX): `startMinigame(kind, spot)` (`spot`: Yakındakiler öğesi `{ id, x, z, tile }`), `isMinigameActive`,
 * `stopMinigame`. HUD: `components/world/walk/minigame/MinigameHud.tsx` (`<MinigameHud />`, WalkHud içinde). Dünya tarafı
 * (yer çözümü, rakip ajan, avatar ve ajan pozu, olta/top/taş çizimi) Crowd.tsx'te: `mgBridge.resolve` ve `mgActor`.
 *
 * ortak motor: her oyun `MINIGAMES` tablosunda TEK satırdır (tür, defter, havuz, jeton aralığı, Yakındakiler varlığı, yer
 * gereksinimi, kartlar, varlıklar, locale anahtarları, saf mantık modülü). HUD bileşeni `components/world/walk/minigame/huds.tsx`
 * `MINIGAME_HUDS` (`Record<MinigameKind, …>`: tür denetimi her oyun için HUD ister). Sunucu karşılığı `backend/studio/walk/
 * minigame.py KINDS` (eşlik testi `test_walk_minigame.py`). Jeton yalnız sunucudan ve TEK günlük mini oyun havuzundan (K3: olta
 * dahil 30); yerel oyunlar yalnız kart verir.
*/
import { create } from "zustand";
import type { PlayTable, FishSpot } from "./sites";
import { type Board, type Collection, EMPTY_BOARD, addCard, sanitizeCollection } from "./minigameLogic";
import { fishStep, initialFish, type FishEffect, type FishEvent, type FishPhase, type FishState } from "./fishing";
import { FISH, type MinigameLogic } from "./minigameLogic";
import { focusLost, returnWorldFocus as returnFocusTo } from "../walk/worldFocus"; // UXF-A: ortak odak dönüşü

export type MinigameKind = "fishing" | "board" | "toss";
export interface MgSpot { id: string; x: number; z: number; tile: [number, number]; /** HQA-FIX: açılışta ilk birincil eylem (olta: at) hemen*/ go?: boolean }

export interface MinigameState {
  kind: MinigameKind | null;
  spot: MgSpot | null;
  /** masa oyunu rakibi (yerel; model çağrısı yok) */
  opponent: { slug: string; name: string } | null;
  /** atış türü (pétanque / pota / file) */
  toss: "toss" | "hoop" | "volley" | null;
  /** tur sayacı (deterministik tohum: spot kimliği + tur) */
  round: number;
}
const IDLE: MinigameState = { kind: null, spot: null, opponent: null, toss: null, round: 0 };
export const useMinigame = create<MinigameState>(() => IDLE);

/** Kare başı görsel durum (HUD yazar, Crowd okur; React yeniden çizimi yok). */
export interface MgActor {
  kind: MinigameKind | null;
  fish: FishSpot | null;
  table: PlayTable | null;
  /** avatar: duruş ve yer */
  meMotion: "fish" | "reel" | "cast" | "board" | "toss" | "bowl" | "idle";
  /** olta: 0 bekle · 1 vuruş (şamandıra dalar) · 2 balık geliyor (elde) */
  bite: 0 | 1 | 2;
  /** balık uçuşunun başladığı an (performance.now ms) ve rengi */
  catchAt: number; catchCol: number;
  /** WORLD-FIX olta görseli (HUD yazar, walkFun.drawMinigame okur): evre ve giriş anı, tür, misina gerilimi (0–1) */
  fp: FishPhase; fpAt: number; species: string | null; tension: number;
  /** masa oyunu */
  board: Board; turn: 1 | 2; agent: string | null;
  /** atış: topun bırakıldığı an (ms), güç ve hedef güç (iniş noktası) */
  throwAt: number; power: number; target: number;
}
export const mgActor: MgActor = {
  kind: null, fish: null, table: null, meMotion: "idle", bite: 0, catchAt: 0, catchCol: 0,
  fp: "ready", fpAt: 0, species: null, tension: 0,
  board: EMPTY_BOARD, turn: 1, agent: null, throwAt: 0, power: 0, target: 0.7,
};

/** Crowd bağlar: yer çözümü (olta noktası, masa, rakip). Dünya yoksa null → oyun başlamaz. */
export interface MgResolved { fish?: FishSpot; table?: PlayTable; opponent?: { slug: string; name: string } }
export const mgBridge: { resolve: ((kind: MinigameKind, spot: MgSpot) => MgResolved | null) | null } = { resolve: null };

// ------------------------------------------------------------------ kayıt (tek tablo)
/** Sunucu defteri: `fishing` olta uçları, `generic` /api/walk/minigame/*, `local` jeton yok (yalnız kart). */
export type MinigameLedger = "fishing" | "generic" | "local";
export interface MinigameDef {
  kind: MinigameKind;
  ledger: MinigameLedger;
  /** ortak günlük mini oyun havuzundan öder (K3) */
  pool: boolean;
  /** tur başına taban jeton aralığı (havuz ve azalan getiri öncesi; sunucu kataloğuyla aynı) */
  coins: readonly [number, number];
  /** `startMinigame` takma adları */
  aliases: readonly string[];
  /** Yakındakiler varlık türü (entities.ts `type`) */
  entity: string;
  /** yer gereksinimi (`mgBridge.resolve` sonucu) */
  needs: { fish?: true; table?: true; opponent?: true };
  /** avatar duruşu */
  motion: MgActor["meMotion"];
  /** koleksiyon kartları */
  cards: readonly string[];
  /** dünyada kullanılan varlıklar (model, yer listesi, kanca) */
  assets: readonly string[];
  /** locale: ad alanı + anahtarlar (başlık, Yakındakiler düğmesi, alt metin) */
  locale: { ns: "walk"; title: string; start: string; text: string };
  /** saf mantık modülü (React/three yok); yerel oyunların kuralları minigameLogic.ts'te */
  logic: MinigameLogic | null;
}
const fishingLogic: MinigameLogic<FishState, FishEvent, FishEffect> = { initial: initialFish, step: fishStep };
export const MINIGAMES = [
  { kind: "fishing", ledger: "fishing", pool: true, coins: [0, 12], aliases: ["fishing", "fish"], entity: "fish", needs: { fish: true }, motion: "fish",
    cards: FISH.map((f) => `fish:${f.id}`), assets: ["fun/fishModels.ts", "fun/sites.ts#fishing", "ambient/habitat.ts"],
    locale: { ns: "walk", title: "mg_fish_title", start: "mg_start_fish", text: "mg_fish_text" }, logic: fishingLogic },
  { kind: "board", ledger: "local", pool: false, coins: [0, 0], aliases: ["board", "table"], entity: "table", needs: { table: true, opponent: true }, motion: "board",
    cards: ["board"], assets: ["fun/sites.ts#tables"],
    locale: { ns: "walk", title: "mg_board_title", start: "mg_start_board", text: "mg_text" }, logic: null },
  { kind: "toss", ledger: "local", pool: false, coins: [0, 0], aliases: ["toss", "hoop", "net", "volley"], entity: "toss", needs: { table: true }, motion: "idle",
    cards: ["toss"], assets: ["fun/sites.ts#tables"],
    locale: { ns: "walk", title: "mg_toss_title", start: "mg_start_toss", text: "mg_text" }, logic: null },
] as const satisfies readonly MinigameDef[];

export const MG_KINDS: readonly MinigameKind[] = MINIGAMES.map((d) => d.kind);
const DEFS: readonly MinigameDef[] = MINIGAMES;
export const MINIGAME_BY_KIND = Object.fromEntries(DEFS.map((d) => [d.kind, d])) as Readonly<Record<MinigameKind, MinigameDef>>;
const KIND_ALIAS: Readonly<Record<string, MinigameKind>> = Object.fromEntries(DEFS.flatMap((d) => d.aliases.map((a) => [a, d.kind])));
/** Yakındakiler varlık türü → mini oyun (yoksa null). */
export const minigameForEntity = (type: string): MinigameDef | null => DEFS.find((d) => d.entity === type) ?? null;

/** Mini oyunu başlatır (HUD açılır). Başka oyun açıksa, yer bulunamazsa (kutsal bölge, rakip yok…) false. */
export function startMinigame(kind: MinigameKind | string, spot: MgSpot): boolean {
  const k = KIND_ALIAS[kind];
  if (!k || !spot || useMinigame.getState().kind) return false;
  const def = MINIGAME_BY_KIND[k];
  const r = mgBridge.resolve?.(k, spot) ?? null;
  if (!r) return false;
  if (def.needs.fish && !r.fish) return false;
  if (def.needs.table && !r.table) return false;
  if (def.needs.opponent && !r.opponent) return false;
  Object.assign(mgActor, {
    kind: k, fish: r.fish ?? null, table: r.table ?? null, meMotion: def.motion, bite: 0, catchAt: 0,
    fp: "ready", fpAt: performance.now(), species: null, tension: 0,
    board: EMPTY_BOARD, turn: 1, agent: r.opponent?.slug ?? null, throwAt: 0, power: 0,
  } satisfies Partial<MgActor>);
  useMinigame.setState({ kind: k, spot, opponent: r.opponent ?? null, toss: r.table?.game ?? null, round: 0 });
  return true;
}

export function isMinigameActive(): boolean {
  return useMinigame.getState().kind !== null;
}

export function stopMinigame(): void {
  const was = useMinigame.getState().kind !== null;
  Object.assign(mgActor, { kind: null, fish: null, table: null, meMotion: "idle", bite: 0, agent: null, throwAt: 0, fp: "ready", species: null, tension: 0 } satisfies Partial<MgActor>);
  useMinigame.setState(IDLE);
  if (was) returnWorldFocus();
}

// ------------------------------------------------------------------ FISH-FIX: çıkışta yürüme girdisi
/**
 * Kök neden (CEO raporu "oltadan çıkınca yürüme tuşları çalışmıyor"): HUD açılınca odağı kendi paneline alır; yürüme klavyesi
 * (`walk/input.ts attachWalkKeyboard`, `requireSelf`) yalnız dünya kabı odaktayken çalışır. Kapat (X), Esc, yürüyüp uzaklaşma,
 * yürüme modundan çıkış… hangi yoldan kapanırsa kapansın panel sökülünce odak `body`'ye düşüyor, WASD/oklar ölü kalıyordu.
 * Kural: oyun her kapanışında (`stopMinigame`, tek kapı) odak HUD'daysa ya da düştüyse dünyaya döner; kullanıcı başka bir alana
 * geçtiyse (arama kutusu vb.) çalınmaz. WalkHud `onFocusWorld`'ü HUD üzerinden `mgFocus.world`'e bağlar.
 */
export const mgFocus: { world: (() => void) | null; host: { contains(n: unknown): boolean } | null } = { world: null, host: null };
/** Odağı dünyaya döndürür (döndürdüyse true). UXF-A: ortak yardımcı `voxel/walk/worldFocus.ts` (tüm yürüme katmanları). */
export function returnWorldFocus(): boolean {
  return returnFocusTo(mgFocus.host, mgFocus.world);
}
/** Odak kayıp mı: yok, `body`'de ya da (sökülen) HUD'un içinde (ortak yardımcıdan). */
export { focusLost };

/** Yürüme tuşları (HUD açıkken yakalanır; `CODE_KEY` ile düzenden bağımsız eşlenmiş anahtar). */
export const MG_WALK_KEYS: ReadonlySet<string> = new Set(["w", "a", "s", "d", "W", "A", "S", "D", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
/**
 * HUD açıkken yakalanan bir tuşun yolu: `close` (Esc), `leave` (oyun boştayken yürüme tuşu: oyun kapanır, avatar yürür),
 * `game` (oyunun kendi tuşu; tur sürerken yürüme tuşu da avatar yerinde kalsın diye yutulur). `idle`: oyun yürüme tuşunu
 * kullanmıyor ve tur sürmüyor (olta: hazır/sonuç; atış: basılı değil); masa oyunu WASD/okları imleç için kullanır → yok.
 */
export function mgKeyRoute(key: string, idle: boolean | undefined): "close" | "leave" | "game" {
  if (key === "Escape") return "close";
  return idle && MG_WALK_KEYS.has(key) ? "leave" : "game";
}
/**
 * `leave` yolu: oyunu kapatır (odak dünyaya döner) ve aynı basışı dünya kabına yeniden gönderir — avatar ilk basışta yürür
 * (tuş bırakılınca dünya kabı `keyup`'ı zaten alır). Tekrarlayan basış yeniden gönderilmez (işletim sistemi tekrarı sürdürür).
 */
export function leaveMinigameWalking(e: { key: string; code?: string; shiftKey?: boolean; repeat?: boolean }): void {
  stopMinigame();
  const doc = typeof document === "undefined" ? null : document;
  const world = doc?.activeElement ?? null;
  if (!world || world === doc?.body || e.repeat) return;
  world.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code ?? "", shiftKey: !!e.shiftKey, bubbles: true, cancelable: true }));
}
/** Yürüyüp uzaklaşma (dokun-git, joystick, ışınlanma): avatar oyunun başladığı yerden bu kadar uzaklaşınca oyun kapanır. */
export const MG_WALK_AWAY = 1.5;
/**
 * küçük nesne kartındaki "Oltayı at / Oyna / At" avatar nesneye bu kadar yaklaşınca etkinleşir (varış rotası
 * sürerken düğme "Varınca" der; önceden tıklanınca oyun uzaktan açılıp hiçbir şey olmuyordu). Birim; `INTERACT_RANGE` 1,6 + yürüme payı.
*/
export const MG_START_RANGE = 2.6;
export const mgInRange = (av: { x: number; z: number }, e: { x: number; z: number }, range = MG_START_RANGE) => Math.hypot(av.x - e.x, av.z - e.z) <= range;
export const walkedAway = (x0: number, z0: number, x: number, z: number, limit = MG_WALK_AWAY) => Math.hypot(x - x0, z - z0) > limit;

// ------------------------------------------------------------------ koleksiyon (bu tarayıcıda; W4'te arka uç)
export const CARDS_KEY = "vc-walk-cards";
export function loadCards(): Collection {
  try { return sanitizeCollection(JSON.parse(window.localStorage.getItem(CARDS_KEY) ?? "{}")); } catch { return {}; }
}
export const useCards = create<{ cards: Collection }>(() => ({ cards: typeof window === "undefined" ? {} : loadCards() }));
/** Kart ekler; yeni kartsa true. Depolama yoksa (özel pencere) yalnız oturumda tutulur. */
export function grantCard(id: string): boolean {
  const { next, isNew } = addCard(useCards.getState().cards, id);
  useCards.setState({ cards: next });
  try { window.localStorage.setItem(CARDS_KEY, JSON.stringify(next)); } catch { /* yalnız oturumda */ }
  return isNew;
}
