// CITY-PACKS — şehir paketleri istemcisi. Parayla satış KAPALI (para fiyatı yok; arka uçtaki fiyat yalnız öneri ve yalnız
// yönetici/test modunda gösterilir). Aynı paket kazanılmış jetonla alınabilir (bayrak `store.cosmetics_enabled`, oyunun onaylı
// alım akışı). Paketler yalnız görünüştür.
//
// - Dünya yapıcı: yalnız gerçekten sahip olunan paketin öğeleri YENİ yerleştirilebilir; var olan yerleştirme her zaman çizilir.
// - Şehir haritası vitrini: sahip olunan paket (ya da yönetici/test modunda yalnız önizleme) ve bu tarayıcıdaki "Şehirde göster"
//   tercihi → `voxel/citypacks/cityOverlay` etkin kümesi. Değişiklik bir sonraki şehre girişte görünür.
// - Tercih tarayıcıda saklanır (kişisel kolaylık); sahiplik her zaman sunucudan gelir.
import { create } from "zustand";
import { clearDistrictCache } from "../voxel/citymap/district";
import { setActiveCityPacks } from "../voxel/citypacks/cityOverlay";
import { gameApi } from "./game";
import { currentLocale } from "./i18n";

export interface CityPackItemView {
  id: string; store_id: string; name: string; w: number; d: number; solid: boolean; ip_risk: number; culture_risk: number;
  ip_note: string; esinli: boolean; legal_review_before_sale: boolean; owned: boolean;
}
export interface CityPackView {
  id: string; store_id: string; kind: string; city: string | null; surfaces: string[]; name: string; description: string;
  seasonal: boolean; items: CityPackItemView[]; owned: boolean; owned_count: number; ip_risk: number; culture_risk: number;
  risk: string; legal_review_before_sale: boolean; price: null; for_sale: false;
  price_proposal: { usd: number; status: "proposal" } | null; plans_proposal: Record<string, string>;
  coin_price: number; coin_cost: number; can_buy_coins: boolean; cosmetic_only: true;
}
export interface CityPackStore { enabled: boolean; admin: boolean; packs: CityPackView[]; balance: number | null }

interface State { store: CityPackStore | null; error: string | null }
export const useCityPacks = create<State>(() => ({ store: null, error: null }));

let loading: Promise<void> | null = null;
/** Vitrin; oturumda bir kez (force ile yeniden). Hata → boş (fail-closed: hiçbir paket kullanılabilir sayılmaz). */
export function ensureCityPacks(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const res = await fetch("/api/citypacks/store", { headers: { "X-Studio-Lang": currentLocale() } });
      if (!res.ok) throw new Error(`${res.status}`);
      useCityPacks.setState({ store: (await res.json()) as CityPackStore, error: null });
    } catch (e) {
      useCityPacks.setState({ store: null, error: String((e as Error).message ?? e) });
    }
    applyCityOverlay();
  })();
  return loading;
}

/** Jetonla alma: oyunun iki adımlı alım akışı (`POST /api/game/shop/store:city-<paket>/buy`, `confirm: true`). */
export async function buyCityPack(storeId: string): Promise<void> {
  if (!storeId.startsWith("store:city-")) throw new Error("store:city-* bekleniyor");
  await gameApi.buy(storeId);
  await ensureCityPacks(true);
}

// ------------------------------------------------------------------ "Şehirde göster" tercihi (tarayıcı)
const PREF_KEY = "voxcrew.citypacks.city.v1";
function loadPrefs(): Record<string, boolean> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(PREF_KEY) : null;
    const v = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return Object.fromEntries(Object.entries(v).filter(([, b]) => typeof b === "boolean")) as Record<string, boolean>;
  } catch { return {}; }
}
export const useCityPackPrefs = create<Record<string, boolean>>(() => loadPrefs());
export function setShowInCity(pack: string, on: boolean): void {
  const next = { ...useCityPackPrefs.getState(), [pack]: on };
  useCityPackPrefs.setState(next, true);
  try { window.localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* özel pencere: yalnız oturumda */ }
  applyCityOverlay();
}

/** Paket gerçekten sahip olunuyor mu (bayrak açık, yönetici/test modu değil). */
export function packOwned(store: CityPackStore | null, pack: string): boolean {
  return !!store && store.enabled && !store.admin && !!store.packs.find((p) => p.id === pack)?.owned;
}
/** Şehirde gösterilebilir mi: sahip olunan paket (varsayılan açık) ya da yönetici/test modunda önizleme (varsayılan kapalı). */
export function showsInCity(store: CityPackStore | null, prefs: Record<string, boolean>, pack: string): boolean {
  if (!store) return false;
  const p = store.packs.find((x) => x.id === pack);
  if (!p || !p.surfaces.includes("city")) return false;
  if (packOwned(store, pack)) return prefs[pack] !== false;
  return store.admin && prefs[pack] === true;
}

/** Etkin küme → şehir katmanı; küme değiştiyse semt planı önbelleği boşaltılır. */
export function applyCityOverlay(): void {
  const store = useCityPacks.getState().store, prefs = useCityPackPrefs.getState();
  const ids = (store?.packs ?? []).filter((p) => showsInCity(store, prefs, p.id)).map((p) => p.id);
  if (setActiveCityPacks(ids)) clearDistrictCache();
}
