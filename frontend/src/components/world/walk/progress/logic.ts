/**
 * W4 (WALK-GAME-UI) — yürüme ilerlemesinin SAF kuralları: hatıra kimlikleri ve toplama
 * durumu, simge bölgesine giriş (vize tetikleyicisi), mini oyun kartlarının sunucuya taşınması (birleştirme).
 * React, zustand ve three içe aktarılmaz: `integrations/mcp/test/walk-progress.test.mjs` doğrudan paketler.
*/

export type Tile = [number, number];

// ------------------------------------------------------------------ hatıralar
export const SOUVENIRS_PER_SCENE = 5;
/** Katalog kimliği (`backend/studio/walk/catalog.py`): `<scene>:h1` … `<scene>:h5` (k sıfırdan). */
export const souvenirId = (scene: string, k: number) => `${scene}:h${k + 1}`;
/** Kimlikten sahne ve sıra (1…5); bozuksa null. */
export function parseSouvenirId(id: string): { scene: string; n: number } | null {
  const m = /^([a-z0-9_]+):h([1-5])$/.exec(id);
  return m ? { scene: m[1], n: Number(m[2]) } : null;
}

/** Yakındakiler kimliği (`souvenir:<item>`); WorldPage F'de bunu toplar. */
export const SOUVENIR_PREFIX = "souvenir:";
export const isSouvenirEntity = (id: string) => id.startsWith(SOUVENIR_PREFIX);
export const souvenirOfEntity = (id: string) => (isSouvenirEntity(id) ? id.slice(SOUVENIR_PREFIX.length) : null);

/** Hatıra modeli (sırayla; sahneye uygun, yazısız, bayraksız genel nesneler). */
export const SOUVENIR_MODELS = ["lantern", "shell", "ticket", "postcard", "bell"] as const;
export type SouvenirModel = (typeof SOUVENIR_MODELS)[number];
export const souvenirModel = (n: number): SouvenirModel => SOUVENIR_MODELS[(Math.max(1, n) - 1) % SOUVENIR_MODELS.length];

export interface SouvenirSpot { id: string; n: number; tile: Tile }
/** Karolardan (büyümüş dünyaya kaydırılmış) hatıra listesi; bulunanlar ve toplanmakta olanlar gizli. */
export function visibleSouvenirs(scene: string, tiles: readonly Tile[], hidden: ReadonlySet<string>): SouvenirSpot[] {
  const out: SouvenirSpot[] = [];
  tiles.forEach((tile, k) => {
    const id = souvenirId(scene, k);
    if (!hidden.has(id)) out.push({ id, n: k + 1, tile: [tile[0], tile[1]] });
  });
  return out;
}

/** Üstünden yürüme: avatar karosu bir hatıra karosuyla aynıysa o hatıra (yoksa null). */
export function souvenirAtTile(list: readonly SouvenirSpot[], tile: Tile | null | undefined): SouvenirSpot | null {
  if (!tile) return null;
  return list.find((s) => s.tile[0] === tile[0] && s.tile[1] === tile[1]) ?? null;
}

/**
 * Toplama durumu: `found` sunucunun onayladığı, `pending` istekte olan. Toplama iyimserdir: hatıra hemen gizlenir; sunucu
 * reddederse (`rejectPickup`) yeniden görünür. Aynı kimlik ikinci kez başlatılmaz (idempotent).
 */
export interface PickupState { found: ReadonlySet<string>; pending: ReadonlySet<string> }
export const EMPTY_PICKUP: PickupState = { found: new Set(), pending: new Set() };
export function startPickup(s: PickupState, id: string): { next: PickupState; started: boolean } {
  if (!parseSouvenirId(id) || s.found.has(id) || s.pending.has(id)) return { next: s, started: false };
  return { next: { found: s.found, pending: new Set([...s.pending, id]) }, started: true };
}
export function confirmPickup(s: PickupState, id: string): PickupState {
  const pending = new Set(s.pending); pending.delete(id);
  return { found: new Set([...s.found, id]), pending };
}
export function rejectPickup(s: PickupState, id: string): PickupState {
  if (!s.pending.has(id)) return s;
  const pending = new Set(s.pending); pending.delete(id);
  return { found: s.found, pending };
}
export const hiddenSet = (s: PickupState): Set<string> => new Set([...s.found, ...s.pending]);

/** Albüm: sahne başına bulunan sayısı ve hangi sıraların eksik olduğu. */
export function albumRow(scene: string, found: Iterable<string>): { scene: string; found: number; slots: boolean[] } {
  const slots = Array.from({ length: SOUVENIRS_PER_SCENE }, () => false);
  for (const id of found) {
    const p = parseSouvenirId(id);
    if (p && p.scene === scene && p.n <= SOUVENIRS_PER_SCENE) slots[p.n - 1] = true;
  }
  return { scene, found: slots.filter(Boolean).length, slots };
}

// ------------------------------------------------------------------ simge keşfi (vize)
export interface ZoneLike { kind: string; i0: number; j0: number; w: number; d: number; tag?: string }
export interface LandmarkZone { id: string; tag: string; i0: number; i1: number; j0: number; j1: number }
/** Simge bölgesine bu kadar karo yaklaşınca keşfedilir (§6.3). */
export const DISCOVER_RADIUS = 3;

/**
 * Sahnenin simge bölgeleri (dünya ızgarasında; büyümüş dünyada zaten kaydırılmış). Kimlik `<scene>:<tag>` (sunucu kataloğu,
 *); aynı etiketin birden çok bölgesi tek vizedir (aynı kimlik). Etiketsiz bölge atlanır. Ufuktaki (ızgara dışı)
 * ayak izleri en yakın ızgara kenarına izdüşürülür: kenara yaklaşınca keşfedilir.
*/
export function landmarkZones(scene: string, zones: readonly ZoneLike[] | null | undefined, width: number, depth: number): LandmarkZone[] {
  const out: LandmarkZone[] = [];
  const cl = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
  for (const z of zones ?? []) {
    if (z.kind !== "landmark" || !z.tag) continue;
    out.push({ id: `${scene}:${z.tag}`, tag: z.tag, i0: cl(z.i0, width - 1), i1: cl(z.i0 + z.w - 1, width - 1), j0: cl(z.j0, depth - 1), j1: cl(z.j0 + z.d - 1, depth - 1) });
  }
  return out;
}

/** Karonun bölgeye Chebyshev uzaklığı (içerideyse 0). */
export function distToZone(t: Tile, z: LandmarkZone): number {
  const di = t[0] < z.i0 ? z.i0 - t[0] : t[0] > z.i1 ? t[0] - z.i1 : 0;
  const dj = t[1] < z.j0 ? z.j0 - t[1] : t[1] > z.j1 ? t[1] - z.j1 : 0;
  return Math.max(di, dj);
}

/**
 * Vize tetikleyicisi: avatar karosu değişince çağrılır. `inside` önceki karede bölge içinde (yarıçap dahil) olanlar.
 * Yeni girilen ve henüz vizesi olmayan (ve istekte olmayan) bölgeler `discover` listesinde döner. Bölgede durmak, çıkıp
 * girmek ya da vizesi olan bölgeye dönmek yeni istek üretmez.
 */
export function visaTrigger(tile: Tile, zones: readonly LandmarkZone[], inside: ReadonlySet<string>, visas: ReadonlySet<string>, pending: ReadonlySet<string> = new Set()):
  { inside: Set<string>; discover: string[] } {
  const now = new Set<string>();
  const discover: string[] = [];
  for (const z of zones) {
    if (distToZone(tile, z) > DISCOVER_RADIUS) continue;
    const was = now.has(z.id);
    now.add(z.id);
    if (was) continue;
    if (!inside.has(z.id) && !visas.has(z.id) && !pending.has(z.id) && !discover.includes(z.id)) discover.push(z.id);
  }
  return { inside: now, discover };
}

// ------------------------------------------------------------------ kartlar (yerel → sunucu)
export type Cards = Readonly<Record<string, number>>;
const MAX_CARD = 999;
function clean(c: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!c || typeof c !== "object") return out;
  for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
    if (!/^[a-z0-9_:]{1,40}$/.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = Math.min(MAX_CARD, Math.floor(v));
  }
  return out;
}

/** Birleştirme: her kart için büyük adet (iki cihaz/sekme çakışmasında kart kaybolmaz, iki kez de sayılmaz). */
export function mergeCards(local: unknown, server: unknown): Record<string, number> {
  const a = clean(local), b = clean(server);
  const out: Record<string, number> = { ...b };
  for (const [k, v] of Object.entries(a)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}

/** Sunucuya gönderilecek fark: yerelde sunucudakinden fazla olan kartlar (yalnız bunlar yüklenir). */
export function cardsToUpload(local: unknown, server: unknown): Record<string, number> {
  const a = clean(local), b = clean(server);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(a)) if (v > (b[k] ?? 0)) out[k] = v;
  return out;
}

/** Albüm kart grupları: olta (`fish:*`), masa (`board`), atış (`toss`). */
export function cardGroup(id: string): "fish" | "board" | "toss" | null {
  if (id.startsWith("fish:")) return "fish";
  if (id === "board") return "board";
  if (id === "toss") return "toss";
  return null;
}

// ------------------------------------------------------------------ konum
export interface SavedPos { x: number; z: number; facing?: number; view?: "third" | "first" }
/** Sunucudan gelen kayıtlı konumu süzer (sınır içi sonlu sayılar). */
export function sanePos(raw: unknown): SavedPos | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const x = Number(r.x), z = Number(r.z);
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 1000 || Math.abs(z) > 1000) return null;
  const f = Number(r.facing);
  return { x, z, ...(Number.isFinite(f) ? { facing: f } : {}), ...(r.view === "first" || r.view === "third" ? { view: r.view } : {}) };
}
/** Kayda değer mi: son kayıttan ≥ 0,5 birim uzak ya da ilk kayıt. */
export const movedEnough = (a: SavedPos | null, b: SavedPos) => !a || Math.hypot(a.x - b.x, a.z - b.z) >= 0.5;
/** HQA-FIX: sunucu dünya başına konum yazımını saniyede 1 ile sınırlar (`POSITION_MIN_INTERVAL_S`, fazlası 429). İstemci
 * ardışık iki gönderim arasında en az bu kadar (ms; pay ile) bekler.*/
export const POSITION_SEND_MIN_MS = 1200;
/** HQA-FIX: şimdi gönderilebilir mi (0) ya da kaç ms sonra (sona kalan gönderim birleştirilir: en son konum gider).*/
export const positionSendDelay = (lastSentAt: number | undefined, now: number, minMs = POSITION_SEND_MIN_MS): number =>
  lastSentAt === undefined ? 0 : Math.max(0, lastSentAt + minMs - now);
