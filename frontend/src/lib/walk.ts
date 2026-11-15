/**
 * W4 (WALK-GAME-UI) — yürüme ilerlemesi istemcisi ve deposu (sözleşme:).
 *
 * - `walkApi`: `/api/walk/*` (state, position, collect, discover, cards). Durum değiştiren istekler kullanıcı-yalnızdır;
 * `X-Studio-UI` jetonunu `lib/presence.ts` ekler. Sunucu yanıtları toleranslı süzülür (alan adları değişse de kırılmaz).
 * - `useWalkProgress`: bulunan hatıralar, vizeler, kartlar, dünya başına kayıtlı konum; iyimser toplama (logic.ts).
 * - Kartlar: ilk yüklemede yereldeki `vc-walk-cards` sunucuya taşınır; sonra sunucu esas, yerel depo çevrimdışı önbellek.
 * - Konum: yürüme modundan çıkınca ve yürürken 5 sn'de bir (yalnızca değişince) dünya başına kaydedilir.
 *
 * Seçiciler kararlı referans döndürür: kümeler ve nesneler yalnızca değişince yeni referans alır.
*/
import { create } from "zustand";
import {
  confirmPickup, EMPTY_PICKUP, cardsToUpload, mergeCards, movedEnough, parseSouvenirId, positionSendDelay, rejectPickup, sanePos, startPickup,
  type PickupState, type SavedPos,
} from "../components/world/walk/progress/logic";
import { CARDS_KEY, loadCards, useCards } from "../voxel/fun/minigames";
import { sanitizeCollection } from "../voxel/fun/minigameLogic";
import { useWalkStore, walkRuntime } from "../voxel/walk/walkStore";
import { currentLocale } from "./i18n";
import { interiorSavePose } from "../voxel/interiors/runtime";
import { bodyText } from "./api";

// ------------------------------------------------------------------ istemci
export class WalkApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = bodyText(res.status, j);
    } catch { /* gövde yok */ }
    throw new WalkApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

/** Sunucu durumunun süzülmüş hâli. */
export interface WalkStateView {
  world: string | null;
  position: SavedPos | null;
  /** bulunan hatıra kimlikleri (`<scene>:hN`) */
  found: string[];
  /** vize kimlikleri (`<scene>:<tag>`) */
  visas: string[];
  /** vize → sahne */
  visaScene: Record<string, string>;
  cards: Record<string, number> | null;
  admin: boolean;
  /** sahne → albüm özeti (sunucu) */
  albums: Record<string, { found: number; total: number; complete: boolean }>;
}

const ids = (raw: unknown, keys: string[]): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") {
      for (const k of keys) { const s = (v as Record<string, unknown>)[k]; if (typeof s === "string") { out.push(s); break; } }
    }
  }
  return out;
};

/** Vize kimliği sahne önekli değilse dünyayla önekler (sunucu `landmark` + `world` dönebilir). */
function visaIds(raw: unknown, world: string | null): { list: string[]; scene: Record<string, string> } {
  const list: string[] = [], scene: Record<string, string> = {};
  if (!Array.isArray(raw)) return { list, scene };
  for (const v of raw) {
    let id: string | null = null, w: string | null = world;
    if (typeof v === "string") id = v;
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      id = typeof o.landmark === "string" ? o.landmark : typeof o.id === "string" ? o.id : null;
      if (typeof o.world === "string") w = o.world;
      if (typeof o.scene === "string") w = o.scene;
    }
    if (!id) continue;
    if (!id.includes(":") && w) id = `${w}:${id}`;
    list.push(id);
    scene[id] = id.slice(0, id.indexOf(":"));
  }
  return { list, scene };
}

export function normalizeState(raw: unknown, world: string | null): WalkStateView {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const v = visaIds(r.visas ?? r.visa ?? r.discovered, world);
  // sözleşme: `cards: {collection, migrated}`; eski/sade biçim `{id: n}` de kabul
  const cr = r.cards as Record<string, unknown> | undefined;
  const cardsRaw = cr && typeof cr === "object" && "collection" in cr ? cr.collection : cr;
  const albums: Record<string, { found: number; total: number; complete: boolean }> = {};
  if (r.albums && typeof r.albums === "object") {
    for (const [k, v] of Object.entries(r.albums as Record<string, Record<string, unknown>>)) {
      if (v && typeof v === "object") albums[k] = { found: Number(v.found) || 0, total: Number(v.total) || 5, complete: !!v.complete };
    }
  }
  return {
    world: typeof r.world === "string" ? r.world : world,
    position: sanePos(r.position ?? r.pos ?? null),
    found: ids(r.found ?? r.souvenirs ?? r.collected, ["item", "id"]).filter((x) => !!parseSouvenirId(x)),
    visas: v.list,
    visaScene: v.scene,
    cards: cardsRaw && typeof cardsRaw === "object" ? mergeCards({}, Array.isArray(cardsRaw) ? cardsFromList(cardsRaw) : cardsRaw) : null,
    admin: !!r.admin,
    albums,
  };
}

function cardsFromList(list: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const id = typeof o.card === "string" ? o.card : typeof o.id === "string" ? o.id : null;
    const n = Number(o.count ?? o.n ?? 1);
    if (id && Number.isFinite(n) && n > 0) out[id] = Math.max(out[id] ?? 0, n);
  }
  return out;
}

export interface WalkCatalog { scenes: Record<string, { souvenirs: string[]; landmarks: string[] }> }
export function normalizeCatalog(raw: unknown): WalkCatalog {
  const out: WalkCatalog = { scenes: {} };
  const sc = (raw && typeof raw === "object" ? (raw as Record<string, unknown>).scenes : null) as Record<string, Record<string, unknown>> | null;
  if (!sc || typeof sc !== "object") return out;
  for (const [k, v] of Object.entries(sc)) {
    if (!v || typeof v !== "object") continue;
    out.scenes[k] = { souvenirs: ids(v.souvenirs, ["id"]), landmarks: ids(v.landmarks, ["id"]) };
  }
  return out;
}

export interface CollectResult { ok: boolean; already: boolean; coins: number; admin: boolean; recorded: boolean; albumComplete: boolean; reason?: string }
const collectResult = (raw: unknown): CollectResult => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const album = (r.album && typeof r.album === "object" ? r.album : {}) as Record<string, unknown>;
  return { ok: r.ok !== false, already: !!r.already, coins: Number(r.coins ?? 0) || 0, admin: !!r.admin, recorded: r.recorded !== false, albumComplete: !!album.just_completed,
    reason: typeof r.reason === "string" ? r.reason : (r.creative ? "creative" : undefined) };
};

const enc = encodeURIComponent;
function requestId() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}
export const walkApi = {
  state: (world?: string | null) => req<unknown>("GET", `/api/walk/state${world ? `?world=${enc(world)}` : ""}`).then((r) => normalizeState(r, world ?? null)),
  position: (p: { world: string; x: number; z: number; facing: number; view: "third" | "first" }) => req<unknown>("PUT", "/api/walk/position", p),
  collect: (world: string, item: string) => req<unknown>("POST", "/api/walk/collect", { world, item }).then(collectResult),
  /** Sabit katalog: sahne → hatıra ve simge kimlikleri (albüm) */
  catalog: () => req<unknown>("GET", "/api/walk/catalog").then(normalizeCatalog),
  /** `landmark` tam kimlik: `<scene>:<tag>` */
  discover: (world: string, landmark: string) => req<unknown>("POST", "/api/walk/discover", { world, landmark }).then(collectResult),
  /** Yerel koleksiyonun tamamını (sanitizeCollection çıktısı) gönderir; sunucu kart başına büyüğü alır ve birleşik koleksiyonu döner. */
  putCards: (cards: Record<string, number>) => req<unknown>("POST", "/api/walk/cards", { cards, client_request_id: requestId() }).then((r) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    return mergeCards({}, o.collection ?? o.cards ?? {});
  }),
  /** WORLD-FIX: olta atışı — tür ve vuruş anı sunucuda (gizli); `assist` hareket azaltmada uzun pencere. yanıtta zaman yok.*/
  fishCast: (world: string, water: "pond" | "open", assist: boolean) =>
    req<unknown>("POST", "/api/walk/fish/cast", { world, water, assist, client_request_id: requestId() }).then(castResult),
  /** vuruş işareti — sunucu vuruş anına dek bekler (uzun yoklama), yanıt yalnız `cue` (zaman damgası yok).*/
  fishBite: (castId: string) => req<unknown>("POST", "/api/walk/fish/bite", { cast_id: castId }).then(cueResult),
  /** WORLD-FIX: çekiş — sonuç ve jeton yalnız sunucu saatinden; istemci miktar göndermez. */
  fishReel: (castId: string) => req<unknown>("POST", "/api/walk/fish/reel", { cast_id: castId, client_request_id: requestId() }).then(reelResult),
  /** bugünkü ortak mini oyun havuzu (olta dahil).*/
  minigamePool: () => req<unknown>("GET", "/api/walk/minigame").then((r) => poolOf((r as Record<string, unknown> | null)?.pool)),
  /** genel tur defteri (..28): başlat → (işaret) → bitir; sonuç ve jeton sunucuda.*/
  minigameStart: (kind: string, world: string, assist: boolean) =>
    req<unknown>("POST", "/api/walk/minigame/start", { kind, world, assist, client_request_id: requestId() }).then(roundResult),
  minigameCue: (roundId: string) => req<unknown>("POST", "/api/walk/minigame/cue", { round_id: roundId }).then(cueResult),
  minigameFinish: (roundId: string, result: Record<string, unknown>) =>
    req<unknown>("POST", "/api/walk/minigame/finish", { round_id: roundId, result, client_request_id: requestId() }).then(finishResult),
};

/** ortak günlük mini oyun havuzu (`today.coins_used` ile aynı sayı).*/
export interface MinigamePool { used: number; max: number }
const poolOf = (raw: unknown): MinigamePool | null => {
  const p = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  return p ? { used: Number(p.used) || 0, max: Number(p.max) || 0 } : null;
};
export interface CueResult { open: boolean; cue: boolean }
const cueResult = (raw: unknown): CueResult => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { open: r.open === true, cue: r.cue === true };
};
export interface MinigameRound { roundId: string; params: Record<string, unknown>; paidMode: boolean; reason: string | null; pool: MinigamePool | null }
const roundResult = (raw: unknown): MinigameRound => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { roundId: String(r.round_id ?? ""), params: (r.params && typeof r.params === "object" ? r.params : {}) as Record<string, unknown>,
    paidMode: r.paid_mode !== false, reason: typeof r.reason === "string" ? r.reason : null, pool: poolOf(r.pool) };
};
export interface MinigameFinish { result: string; coins: number; reason: string | null; balance: number | null; pool: MinigamePool | null }
const finishResult = (raw: unknown): MinigameFinish => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { result: typeof r.result === "string" ? r.result : "expired", coins: Math.max(0, Number(r.coins) || 0),
    reason: typeof r.reason === "string" ? r.reason : null, balance: typeof r.balance === "number" ? r.balance : null, pool: poolOf(r.pool) };
};

/** atış yanıtında vuruş anı ve pencere yok (sunucu saklar); pencere istemcide `assist`'ten (FISH_*_WINDOW_MS).*/
export interface FishCastResult { castId: string; paidMode: boolean; reason: string | null }
const castResult = (raw: unknown): FishCastResult => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { castId: String(r.cast_id ?? ""), paidMode: r.paid_mode !== false, reason: typeof r.reason === "string" ? r.reason : null };
};
export interface FishReelResult {
  result: "caught" | "early" | "late"; fish: string | null; coins: number; reason: string | null; balance: number | null;
  today: { used: number; max: number } | null;
}
const reelResult = (raw: unknown): FishReelResult => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fish = (r.fish && typeof r.fish === "object" ? r.fish : null) as Record<string, unknown> | null;
  const today = (r.today && typeof r.today === "object" ? r.today : null) as Record<string, unknown> | null;
  const result = r.result === "caught" || r.result === "early" || r.result === "late" ? r.result : "late";
  return { result, fish: fish && typeof fish.id === "string" ? fish.id : null, coins: Math.max(0, Number(r.coins) || 0),
    reason: typeof r.reason === "string" ? r.reason : null, balance: typeof r.balance === "number" ? r.balance : null,
    today: today ? { used: Number(today.coins_used) || 0, max: Number(today.max) || 0 } : null };
};

// ------------------------------------------------------------------ toast
export type WalkToastKind = "souvenir" | "visa" | "info";
export interface WalkToast { id: number; kind: WalkToastKind; title: string; text?: string; at: number }
let toastSeq = 0;
export const useWalkToasts = create<{ toasts: readonly WalkToast[] }>(() => ({ toasts: [] }));
/** UXF-D: "Hoş geldin" kartı açıkken tostlar bekletilir (kart ve tost üst üste/aynı anda çıkmaz); kart kapanınca sırayla
 * gösterilir, süreleri o an başlar. En çok `HELD_MAX` bekler (eskisi düşer).*/
const HELD_MAX = 3;
const held: Omit<WalkToast, "id" | "at">[] = [];
let holding = false;
export function holdWalkToasts(on: boolean) {
  holding = on;
  if (!on) for (const t of held.splice(0)) pushWalkToast(t);
}
export const heldWalkToasts = () => held.length;
export function pushWalkToast(t: Omit<WalkToast, "id" | "at">) {
  // aynı tost (tür + başlık + alt satır) zaten gösteriliyor/bekliyorsa ikincisi eklenmez (<city> girişinde iki aynı
  // "İç mekân damgası" tostu üst üste biniyor, ilkinin başlığı kesiliyordu).
  const same = (x: Pick<WalkToast, "kind" | "title" | "text">) => x.kind === t.kind && x.title === t.title && x.text === t.text;
  if (holding) { if (held.some(same)) return; held.push(t); if (held.length > HELD_MAX) held.shift(); return; }
  if (useWalkToasts.getState().toasts.some(same)) return;
  const toast = { ...t, id: ++toastSeq, at: Date.now() };
  useWalkToasts.setState((s) => ({ toasts: [...s.toasts.slice(-2), toast] }));
  window.setTimeout(() => dismissWalkToast(toast.id), 4200);
}
/**
 * ek not — son tost (≤ `withinMs` önce, alt satırı boş) varsa aynı tostun ikinci satırı olur (yeni süreyle);
 * yoksa ayrı tost. Ritüel bitişi + "Test modu açık: kaydedilmedi" iki tost üst üste biniyordu.
*/
export function pushWalkToastNote(t: Omit<WalkToast, "id" | "at">, withinMs = 3000) {
  if (holding) {
    const h = held[held.length - 1];
    if (h && !h.text) { h.text = t.title; return; }
    pushWalkToast(t);
    return;
  }
  const last = useWalkToasts.getState().toasts.at(-1);
  if (last && !last.text && Date.now() - last.at <= withinMs) {
    const merged: WalkToast = { ...last, text: t.title, id: ++toastSeq, at: Date.now() };
    useWalkToasts.setState((s) => ({ toasts: [...s.toasts.filter((x) => x.id !== last.id), merged] }));
    window.setTimeout(() => dismissWalkToast(merged.id), 4200);
    return;
  }
  pushWalkToast(t);
}
export function dismissWalkToast(id: number) {
  useWalkToasts.setState((s) => (s.toasts.some((x) => x.id === id) ? { toasts: s.toasts.filter((x) => x.id !== id) } : s));
}

// ------------------------------------------------------------------ depo
export interface WalkProgressState {
  /** en az bir kez sunucudan okundu */
  loaded: boolean;
  error: string | null;
  pickup: PickupState;
  visas: ReadonlySet<string>;
  visaPending: ReadonlySet<string>;
  visaScene: Readonly<Record<string, string>>;
  /** dünya → kayıtlı konum */
  positions: Readonly<Record<string, SavedPos>>;
  admin: boolean;
  /** sahne → albüm özeti (sunucu) */
  albums: Readonly<Record<string, { found: number; total: number; complete: boolean }>>;
  /** kartlar sunucuya taşındı mı (bu oturumda) */
  cardsSynced: boolean;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
export const useWalkProgress = create<WalkProgressState>(() => ({
  loaded: false, error: null, pickup: EMPTY_PICKUP, visas: EMPTY_SET, visaPending: EMPTY_SET, visaScene: {}, positions: {}, admin: false, albums: {}, cardsSynced: false,
}));

function absorb(v: WalkStateView) {
  const s = useWalkProgress.getState();
  const found = new Set([...s.pickup.found, ...v.found]);
  const visas = new Set([...s.visas, ...v.visas]);
  useWalkProgress.setState({
    loaded: true, error: null, admin: v.admin,
    pickup: found.size !== s.pickup.found.size ? { found, pending: s.pickup.pending } : s.pickup,
    visas: visas.size !== s.visas.size ? visas : s.visas,
    visaScene: Object.keys(v.visaScene).length ? { ...s.visaScene, ...v.visaScene } : s.visaScene,
    positions: v.world && v.position ? { ...s.positions, [v.world]: v.position } : s.positions,
    albums: Object.keys(v.albums).length ? { ...s.albums, ...v.albums } : s.albums,
  });
  if (v.cards) void syncCards(v.cards);
}

let inflight: Promise<void> | null = null;
/** Durumu yükler (dünya verilirse o dünyanın konumu da gelir). Hata sessizce depoya yazılır. */
export function loadWalkProgress(world?: string | null): Promise<void> {
  const p = walkApi.state(world ?? null).then(absorb).catch((e: unknown) => {
    useWalkProgress.setState({ loaded: true, error: e instanceof Error ? e.message : String(e) });
  });
  if (!world) inflight = p;
  return p;
}
export function ensureWalkProgress(): Promise<void> {
  return inflight ?? loadWalkProgress(null);
}

/** Kayıtlı konum (yoksa null; taban göreli x/z —); `World.walkEnter(saved)` buna verilir.*/
export function savedWalkPosition(world: string | null | undefined): SavedPos | null {
  return world ? useWalkProgress.getState().positions[world] ?? null : null;
}

// ------------------------------------------------------------------ toplama ve keşif
/** Sunucu kayıt yazmadı ve "zaten vardı" da değil: yönetici ya da yaratıcı mod (kilitli sahne yalnızca görüntüleme). */
export const isViewOnly = (r: Pick<CollectResult, "admin" | "recorded" | "already" | "reason">) =>
  r.admin || r.reason === "creative" || r.reason === "admin" || (!r.recorded && !r.already);
export interface CollectHooks { onDone?: (r: CollectResult) => void; onFail?: (e: unknown) => void }
/**
 * Hatırayı toplar (F ya da üstünden yürüme). İyimser: hemen gizlenir; sunucu reddederse geri gelir. Aynı hatıra ikinci kez
 * istek üretmez. Dönüş: istek başladı mı.
 */
export function collectSouvenir(world: string, item: string, hooks: CollectHooks = {}): boolean {
  const s = useWalkProgress.getState();
  const { next, started } = startPickup(s.pickup, item);
  if (!started) return false;
  useWalkProgress.setState({ pickup: next });
  walkApi.collect(world, item).then((r) => {
    // W5: yönetici / yaratıcı mod (görüntüleme) kayıt yazmaz → hatıra bu oturumda gizli kalır (bekleyen) ama albüme
    // sayılmaz; yeniden yüklemede yine görünür
    if (!isViewOnly(r)) useWalkProgress.setState((st) => ({ pickup: confirmPickup(st.pickup, item) }));
    hooks.onDone?.(r);
  }).catch((e: unknown) => {
    // zaten bulunmuş (409) da bulunmuş sayılır; diğer hatalarda hatıra yeniden görünür
    if (e instanceof WalkApiError && e.status === 409) { useWalkProgress.setState((st) => ({ pickup: confirmPickup(st.pickup, item) })); hooks.onDone?.({ ok: true, already: true, coins: 0, admin: false, recorded: false, albumComplete: false }); return; }
    useWalkProgress.setState((st) => ({ pickup: rejectPickup(st.pickup, item) }));
    hooks.onFail?.(e);
  });
  return true;
}

export function discoverLandmark(world: string, landmark: string, hooks: CollectHooks = {}): boolean {
  const s = useWalkProgress.getState();
  if (s.visas.has(landmark) || s.visaPending.has(landmark)) return false;
  useWalkProgress.setState({ visaPending: new Set([...s.visaPending, landmark]) });
  const done = (ok: boolean) => useWalkProgress.setState((st) => {
    const visaPending = new Set(st.visaPending); visaPending.delete(landmark);
    return ok
      ? { visaPending, visas: new Set([...st.visas, landmark]), visaScene: { ...st.visaScene, [landmark]: landmark.slice(0, landmark.indexOf(":")) } }
      : { visaPending };
  });
  // W5: görüntüleme yanıtı (yönetici / yaratıcı) vize yazmaz → yerel pasaporta da eklenmez
  walkApi.discover(world, landmark).then((r) => { done(!isViewOnly(r)); hooks.onDone?.(r); })
    .catch((e: unknown) => {
      if (e instanceof WalkApiError && e.status === 409) { done(true); hooks.onDone?.({ ok: true, already: true, coins: 0, admin: false, recorded: false, albumComplete: false }); return; }
      done(false); hooks.onFail?.(e);
    });
  return true;
}

// ------------------------------------------------------------------ kartlar
const SYNCED_KEY = "vc-walk-cards-synced";
let cardsUnsub: (() => void) | null = null;
let lastServer: Record<string, number> = {};

function writeLocal(c: Record<string, number>) {
  try { window.localStorage.setItem(CARDS_KEY, JSON.stringify(c)); } catch { /* yalnız oturumda */ }
}

/**
 * Sunucu kartlarıyla birleştirir. İlk kez (ya da çevrimdışıyken biriken) yerel fazlayı yükler; birleşik koleksiyonu yerel
 * önbelleğe ve `useCards`'a yazar. Sonra mini oyunlardan gelen yeni kartları izler ve yalnızca farkı yükler.
 */
export async function syncCards(server: Record<string, number>): Promise<void> {
  lastServer = mergeCards({}, server);
  const local = loadCards();
  const up = cardsToUpload(local, lastServer);
  if (Object.keys(up).length) {
    try { lastServer = mergeCards(lastServer, await walkApi.putCards(sanitizeCollection(local) as Record<string, number>)); }
    catch { /* çevrimdışı: yerel önbellek kalır; bir sonraki yüklemede yeniden denenir */ }
  }
  const merged = mergeCards(local, lastServer);
  writeLocal(merged);
  useCards.setState({ cards: merged });
  try { window.localStorage.setItem(SYNCED_KEY, "1"); } catch { /* yok */ }
  useWalkProgress.setState({ cardsSynced: true });
  if (!cardsUnsub) {
    let timer = 0;
    cardsUnsub = useCards.subscribe((s) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const diff = cardsToUpload(s.cards, lastServer);
        if (!Object.keys(diff).length) return;
        walkApi.putCards(sanitizeCollection(s.cards) as Record<string, number>).then((c) => { lastServer = mergeCards(lastServer, c); }).catch(() => undefined);
      }, 800);
    });
  }
}

// ------------------------------------------------------------------ konum kaydı
let posInstalled = false;
const lastSaved: Record<string, SavedPos> = {};
function savePosition(world: string) {
  const a = walkRuntime.avatar;
  const view = useWalkStore.getState().view;
  // taban göreli (büyüme tabanı kaydırır; geri yüklemede `spawnTile` bugünkü kaymayı ekler)
  const [oi, oj] = walkRuntime.baseOffset;
  // WALK-EXPLORE: iç mekândayken iç koordinat değil kapının dışı (taban göreli) kaydedilir
  const inner = interiorSavePose();
  const p: SavedPos = inner
    ? { x: Math.round(inner.x * 100) / 100, z: Math.round(inner.z * 100) / 100, facing: Math.round(inner.heading * 1000) / 1000, view }
    : { x: Math.round((a.x - oi) * 100) / 100, z: Math.round((a.z - oj) * 100) / 100, facing: Math.round(a.heading * 1000) / 1000, view };
  if (!movedEnough(lastSaved[world] ?? null, p)) return;
  lastSaved[world] = p;
  useWalkProgress.setState((s) => ({ positions: { ...s.positions, [world]: p } }));
  sendPosition(world, { world, x: p.x, z: p.z, facing: p.facing ?? 0, view });
}

/**
 * HQA-FIX — konum gönderimi dünya başına seyreltilir ve birleştirilir. Kök neden: sunucu dünya başına saniyede en çok bir
 * konum yazımı kabul eder (429). İstemci aralıklı kayıt (5 sn) ile çıkış/sahne değişimi/sayfadan ayrılma kaydını ardı ardına
 * gönderebiliyordu (ör. kayıttan 0,5 sn sonra Esc). Ayrıca aynı dünyada açık ikinci bir sekme vardı. Sonuç: konsolda 429 ve son konumun
 * kaybı. Şimdi son gönderimden `POSITION_SEND_MIN_MS` geçmeden gelen istek bekletilir; beklerken gelenler yalnız en sonuncuyla gider.
 * 429 dönerse bir kez, aralık sonunda en son konumla yeniden denenir.
*/
const posSentAt: Record<string, number> = {};
const posPending: Record<string, { body: Parameters<typeof walkApi.position>[0]; timer: number; retried: boolean }> = {};
function sendPosition(world: string, body: Parameters<typeof walkApi.position>[0], retried = false) {
  const wait = positionSendDelay(posSentAt[world], performance.now());
  const pend = posPending[world];
  if (wait > 0 || pend) {
    if (pend) { if (!retried) pend.body = body; pend.retried = pend.retried || retried; return; } // yeniden deneme yeni konumu ezmez
    posPending[world] = { body, retried, timer: window.setTimeout(() => {
      const q = posPending[world];
      delete posPending[world];
      if (q) sendPosition(world, q.body, q.retried);
    }, Math.max(wait, 50)) };
    return;
  }
  posSentAt[world] = performance.now();
  walkApi.position(body).catch((e: unknown) => {
    if (!retried && e instanceof WalkApiError && e.status === 429) {
      posSentAt[world] = performance.now();
      sendPosition(world, body, true);
    }
  });
}

/** Bir kez kurulur: yürürken 5 sn'de bir ve çıkışta (Esc, Çık, sahne değişimi, sayfadan ayrılma) konumu kaydeder. */
export function installWalkPositionSync(): void {
  if (posInstalled || typeof window === "undefined") return;
  posInstalled = true;
  let world: string | null = null;
  let timer = 0;
  useWalkStore.subscribe((s, prev) => {
    if (s.active && !prev.active && s.world) {
      world = s.world;
      if (s.pose) lastSaved[world] = { x: s.pose.x - walkRuntime.baseOffset[0], z: s.pose.z - walkRuntime.baseOffset[1] };
      window.clearInterval(timer);
      timer = window.setInterval(() => { if (world && walkRuntime.live) savePosition(world); }, 5000);
    } else if (!s.active && prev.active) {
      window.clearInterval(timer);
      if (world) savePosition(world);
      world = null;
    }
  });
  window.addEventListener("pagehide", () => { if (world && useWalkStore.getState().active) savePosition(world); });
}
