/**
 * "Hoş geldin" kartı durumu.
 *
 * - Şehre ilk girişte (yürüme modunda şehir sahnesi ya da şehir haritası varışı) kart **bir kez** açılır; şehir başına
 * görüldü kaydı bu tarayıcıda tutulur (`vc-welcome-seen`). Sahne ve harita aynı şehri sayar.
 * - Ayar (`vc-welcome`, varsayılan açık): kapalıyken kart hiç açılmaz. Kartın "Bir daha gösterme" düğmesi ve
 * `WelcomeSetting` satırı bunu yazar.
 * - Yürüme modu kapanınca kart kapanır (kayıt kalır: bir daha açılmaz).
 * - Kart `WalkHud` içinde çizilir (`<WelcomeCard />`, panel yuvası `dock`).
 *
 * Kart verisi `welcomeModel.ts`'te; burada yalnız durum. zustand seçicileri yeni nesne döndürmez.
*/
import { create } from "zustand";
import { isRitualCity, type RitualCity } from "../../voxel/fun/rituals";
import { useWalkStore } from "../../voxel/walk/walkStore";
import { returnWorldFocusSoon, type FocusHost } from "../../voxel/walk/worldFocus";

export const WELCOME_KEY = "vc-welcome";
export const WELCOME_SEEN_KEY = "vc-welcome-seen";

export type WelcomeScope = "scene" | "map";
export interface WelcomeOpen { city: RitualCity; scope: WelcomeScope; seq: number }

export interface WelcomeState {
  /** ayar: şehir girişinde kart (varsayılan açık) */
  enabled: boolean;
  /** kartı görülmüş şehirler (bu tarayıcı) */
  seen: ReadonlySet<string>;
  open: WelcomeOpen | null;
}

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string): void {
  try { window.localStorage.setItem(key, v); } catch { /* özel pencere: yalnız oturumda */ }
}
function loadSeen(): ReadonlySet<string> {
  try {
    const v = JSON.parse(read(WELCOME_SEEN_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && isRitualCity(x)) : []);
  } catch { return new Set(); }
}

export const useWelcome = create<WelcomeState>(() => (typeof window === "undefined"
  ? { enabled: true, seen: new Set(), open: null }
  : { enabled: read(WELCOME_KEY) !== "0", seen: loadSeen(), open: null }));

let seq = 0;
/**
 * Şehre giriş: ayar açık, şehir ritüel/bilgi şehri ve kart bu şehirde görülmemişse açar ve görüldü yazar. Dönüş: açıldı mı.
 */
export function showWelcome(city: string | null | undefined, scope: WelcomeScope): boolean {
  const s = useWelcome.getState();
  if (!s.enabled || !isRitualCity(city) || s.seen.has(city)) return false;
  const seen = new Set([...s.seen, city]);
  write(WELCOME_SEEN_KEY, JSON.stringify([...seen].sort()));
  useWelcome.setState({ seen, open: { city, scope, seq: ++seq } });
  return true;
}

/**
 * UXF-A ( B): kart kapanınca (✕, Esc, "Git", "Bir daha gösterme") odak kartın içindeyse ya da `body`'ye düştüyse dünya
 * kabına döner (WASD hemen çalışır); kullanıcı başka bir alana geçtiyse çalınmaz. `host`: açık kartın kökü (WelcomeCard bağlar).
*/
export const welcomeFocus: { host: FocusHost } = { host: null };
const focusBack = () => returnWorldFocusSoon(welcomeFocus.host);

export function closeWelcome(): void {
  if (!useWelcome.getState().open) return;
  useWelcome.setState({ open: null });
  focusBack();
}

/** Ayar: kapatınca açık kart da kapanır. */
export function setWelcomeEnabled(on: boolean): void {
  write(WELCOME_KEY, on ? "1" : "0");
  const wasOpen = !!useWelcome.getState().open;
  useWelcome.setState(on ? { enabled: true } : { enabled: false, open: null });
  if (!on && wasOpen) focusBack();
}

/** Denetim/geliştirme: görüldü kaydını sıfırla (kart yeniden bir kez açılabilir). */
export function resetWelcomeSeen(): void {
  write(WELCOME_SEEN_KEY, "[]");
  useWelcome.setState({ seen: new Set() });
}

// sahne girişi: yürüme modu açıldı ve dünya bir şehir sahnesi → kart; mod kapanınca kart kapanır. Modül yürüme açıldıktan
// sonra yüklendiyse (HUD parçaları tembel yüklenir) o anki giriş de sayılır.
if (typeof window !== "undefined") {
  useWalkStore.subscribe((s, prev) => {
    if (s.active && !prev.active) showWelcome(s.world, "scene");
    else if (!s.active && prev.active) closeWelcome();
  });
  const now = useWalkStore.getState();
  if (now.active) queueMicrotask(() => showWelcome(now.world, "scene"));
}
