// COS-B — kozmetik mağazası istemcisi. Parayla satış KAPALI: para fiyatı, ödeme, para ile
// satın al yok. Aynı set kazanılmış jetonla alınabilir (2026-10-19 gece kararı; oyunun mevcut onaylı alım akışı, bayrak arkasında).
//
// - Bayrak `store.cosmetics_enabled` (arka uç, COS-A) varsayılan kapalı. Sekme bayrak açıkken ya da yönetici/test modunda
//   görünür; yönetici/test modu yalnız önizler (sahiplik yazmaz, S40).
// - 3D deneme yalnız bellekte: kaydedilmez, pencere kapanınca geri döner. Deneme ve giyim davranışı telemetriye gitmez.
// - Canlı çizim: sahip olunan ve giyilebilir (`GET /api/cosmetics/collection`) parçalar, bu tarayıcıda "Kullan" ile
//   seçilince dünyada çizilir (kıyafet: ajan/"Ben" kalabalığı; masa süsü, dünya teması, kutlama: voxel/cosmetics/WorldLayer).
//   Seçim tercihi tarayıcıda saklanır (kişisel kolaylık); sahiplik her zaman sunucudan gelir, iade edilen parça çizilmez.
import { useMemo } from "react";
import { create } from "zustand";
import { dressAgents, dressMe, wornCostume, type WornCostume } from "../voxel/cosmetics/local";
import { COSMETIC_SETS, cosmeticItem, type CosmeticItem, type CosmeticSet, type Slot } from "../voxel/cosmetics/registry";
import { gameApi } from "./game";
import { currentLocale } from "./i18n";
import type { Avatar } from "./types";

export const COSMETICS_FLAG = "store.cosmetics_enabled";
export const STORE_PREFIX = "store:";

/** Arka uç parçası (COS-A `_piece_view`). */
export interface StorePiece {
  id: string; kind: string; label: string; surfaces: string[]; drawn: Record<string, boolean>;
  owned: boolean; source: string | null; wearable: boolean; unwearable_reason: string | null; temporarily_not_drawn: boolean;
  set?: string;
}
export interface StoreSetView {
  id: string; name: string; description: string; bucket: string; price: null; for_sale: false; sellable: boolean;
  status: string; pieces: StorePiece[]; sale_blockers: { code: string }[];
  free_path?: { signature_piece: string | null; free_after_months: number; archive_open: boolean };
  store_id?: string;
  /** 2026-10-19 gece kararı: aynı set kazanılmış jetonla da alınabilir (COS-A `set_view`). Jeton fiyatı para fiyatından
   *  türetilmez; arayüz hiçbir zaman kur ya da "X jeton = Y $" göstermez. Yoksa jeton teklifi çizilmez. */
  coin_price?: number | null;
  /** sahip olunan parçalar düşülmüş jeton tutarı */
  coin_cost?: number | null;
  coin_buy?: { method: string; path: string; confirm: boolean };
  /** sunucu kararı: bayrak açık, kapı geçti, eksik parça var, bakiye yeter, yönetici/test modu değil */
  can_buy_coins?: boolean;
}
export interface StoreView { enabled: boolean; mode: string; for_sale: false; price: null; sets: StoreSetView[] }

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "X-Studio-Lang": currentLocale() } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

interface CosState {
  /** null = henüz bilinmiyor */
  enabled: boolean | null;
  store: StoreView | null;
  /** sahip olunan parça kimliği (önek `store:` olmadan) → giyilebilir mi */
  owned: Record<string, boolean>;
  error: string | null;
}
export const useCosmetics = create<CosState>(() => ({ enabled: null, store: null, owned: {}, error: null }));
let loading: Promise<void> | null = null;

/** Vitrin ve (bayrak açıksa) koleksiyon; oturumda bir kez. Uç yoksa ya da hata varsa kapalı sayılır (fail-closed). */
export function ensureCosmetics(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const store = await get<StoreView>("/api/cosmetics/store");
      let owned: Record<string, boolean> = {};
      if (store.enabled) {
        const col = await get<{ enabled: boolean; items: StorePiece[] }>("/api/cosmetics/collection");
        for (const p of col.items ?? []) if (p.owned) owned[bare(p.id)] = p.wearable;
      }
      useCosmetics.setState({ enabled: store.enabled === true, store, owned, error: null });
    } catch (e) {
      useCosmetics.setState({ enabled: false, store: null, owned: {}, error: String((e as Error).message ?? e) });
    }
  })();
  return loading;
}

/** Haktan envantere idempotent projeksiyon (COS-A `POST /api/cosmetics/sync`; kullanıcı-yalnız, bayrak gerekir), sonra
 *  koleksiyonu tazeler. Yalnız kozmetik mağazası sekmesi açılınca ve bayrak açıkken çağrılır; satın alma değildir. */
export async function syncCosmetics(): Promise<void> {
  try {
    await fetch("/api/cosmetics/sync", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Lang": currentLocale() }, body: "{}" });
  } catch { /* çevrimdışı: eldeki koleksiyonla devam */ }
  await ensureCosmetics(true);
}

/** Jetonla alma: oyunun mevcut iki adımlı alım akışı (`POST /api/game/shop/store:<set>/buy`, `confirm: true`; COS-A
 *  `coin_buy.path`). Yalnız onay penceresindeki kullanıcı tıklamasıyla, bayrak açıkken. Para satışı yoktur. */
export async function buyWithCoins(storeId: string): Promise<void> {
  if (!storeId.startsWith(STORE_PREFIX)) throw new Error("store:* bekleniyor");
  await gameApi.buy(storeId);
  await ensureCosmetics(true);
}

export const bare = (id: string) => (id.startsWith(STORE_PREFIX) ? id.slice(STORE_PREFIX.length) : id);

/** Sekme görünür mü: bayrak açık ya da yönetici/test modu (yalnız önizleme). */
export function cosmeticsTabVisible(enabled: boolean | null, admin: boolean | undefined): boolean {
  return enabled === true || admin === true;
}

// ------------------------------------------------------------------ deneme (yalnız bellek)
/** Kıyafeti avatara giydirir (kopya). Başlık taşıyan kıyafette şapka/gözlük yuvası parts.ts'te çizilmez. */
export function applyWear(a: Avatar, item: CosmeticItem | null | undefined): Avatar {
  return item && item.slot === "outfit" ? { ...a, wear: item.id } : a;
}
export const setItems = (s: CosmeticSet, slot: Slot) => s.items.filter((i) => i.slot === slot);

// ------------------------------------------------------------------ canlı seçim (tarayıcı tercihi; sahiplikle kesişir)
const EQUIP_KEY = "voxcrew.cosmetics.equip.v1";
export interface Equip {
  desk?: string; world?: string; celebration?: string; me?: string; agents: Record<string, string>;
  /** ajanlar şehir sahnesinde yerel kostüm giysin (varsayılan açık; ücretsiz sahne içeriği, mağaza bayrağından bağımsız)*/
  local?: boolean;
  /** "Ben" avatarı da giysin (varsayılan kapalı; kullanıcının kendi görünümü onun kararıdır, O10)*/
  meLocal?: boolean;
}
function loadEquip(): Equip {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(EQUIP_KEY) : null;
    const v = raw ? JSON.parse(raw) as Partial<Equip> : {};
    return { desk: v.desk, world: v.world, celebration: v.celebration, me: v.me, agents: { ...(v.agents ?? {}) },
      local: v.local !== false, meLocal: v.meLocal === true };
  } catch { return { agents: {}, local: true, meLocal: false }; }
}
export const useEquip = create<Equip>(() => loadEquip());
export function setEquip(patch: Partial<Equip>) {
  const next = { ...useEquip.getState(), ...patch };
  useEquip.setState(next);
  try { window.localStorage.setItem(EQUIP_KEY, JSON.stringify(next)); } catch { /* özel pencere: yalnız oturumda */ }
}

/** Sahip olunan, giyilebilir ve bayrak açık → canlı çizilebilir. */
function usable(id: string | undefined, enabled: boolean | null, owned: Record<string, boolean>): string | undefined {
  return id && enabled === true && owned[id] === true && cosmeticItem(id) ? id : undefined;
}
export interface LiveEquip { desk?: CosmeticItem; world?: CosmeticItem; celebration?: CosmeticItem; me?: string; agents: Record<string, string> }
const NO_AGENTS: Record<string, string> = {};
/** Dünya katmanının kullandığı etkin seçim. Bayrak kapalıyken hep boştur. */
export function useLiveEquip(): LiveEquip {
  const enabled = useCosmetics((s) => s.enabled);
  const owned = useCosmetics((s) => s.owned);
  const eq = useEquip();
  return useMemo(() => {
    const it = (id?: string) => { const u = usable(id, enabled, owned); return u ? cosmeticItem(u)?.item : undefined; };
    const agents: Record<string, string> = {};
    for (const [slug, id] of Object.entries(eq.agents)) { const u = usable(id, enabled, owned); if (u) agents[slug] = u; }
    return { desk: it(eq.desk), world: it(eq.world), celebration: it(eq.celebration), me: usable(eq.me, enabled, owned),
      agents: Object.keys(agents).length ? agents : NO_AGENTS };
  }, [enabled, owned, eq]);
}

type Dressable = { agent: { slug: string; avatar?: Partial<Avatar> | null }; external?: unknown };
/** Dünya: seçili ajanlara mağaza kıyafetini, seçimi olmayanlara (ayar açıksa) şehrin yerel kostümünü giydirir. Öncelik:
 * dış ajan → mağaza seçimi → 3D deneme → kahraman görünümü → yerel kostüm (`voxel/cosmetics/local` `chooseWear`).
 * Hiçbir ajan değişmiyorsa AYNI diziyi döner (Crowd yeniden kurulmaz).*/
export function useDressedAgents<T extends Dressable>(agents: T[], live: LiveEquip, scene?: string): T[] {
  const local = useEquip((s) => s.local !== false);
  const store = live.agents === NO_AGENTS ? undefined : live.agents;
  return useMemo(() => dressAgents(agents, store, local ? scene : undefined), [agents, store, scene, local]);
}
/** UXF-E: ajan panelinin "Kostüm" satırı — `useDressedAgents` ile aynı kural (yerel kostüm ayarı kapalıysa yerel yok).*/
export function useAgentCostume(agent: { slug: string; name?: string; avatar?: Partial<Avatar> | null }, scene: string | null | undefined, external = false): WornCostume | null {
  const live = useLiveEquip();
  const local = useEquip((s) => s.local !== false);
  const store = live.agents === NO_AGENTS ? undefined : live.agents[agent.slug];
  return useMemo(() => wornCostume({ external, store, avatar: agent.avatar, slug: agent.slug, name: agent.name, scene: local && scene ? scene : undefined }),
    [external, store, agent.avatar, agent.slug, agent.name, scene, local]);
}
/** "Ben": mağaza seçimi kazanır; yerel kostüm yalnız kullanıcı açtıysa (varsayılan kapalı). */
export function useDressedMe<T extends { avatar: Avatar }>(me: T, live: LiveEquip, scene?: string): T {
  const optIn = useEquip((s) => s.meLocal === true);
  return useMemo(() => dressMe(me, live.me, scene, optIn), [me, live.me, scene, optIn]);
}

export { COSMETIC_SETS };
