// DASH-MVP arayüz görünümü: Dünya Görünümü (`world`) / Pano Görünümü (`board`).-D,
// araştırma §4.1.
// - Tek doğruluk kaynağı sunucu ayarıdır (`ui.mode`, `ui.language` gibi PUT /api/settings ile kaydedilir).
// - `localStorage` "vc-ui-mode" yalnız ilk boyama içindir: modül yüklenir yüklenmez okunur ve <html data-ui="board">
//   ilk boyamadan ÖNCE kurulur (App.tsx'in dünya önden çekmesi de buna bakar; Pano Görünümünde dünya parçası istenmez).
//   Okunamazsa `world` sayılır ve sunucu yanıtı gelince düzeltilir.
// - Pano Görünümü oyun katmanını gizler: geçişte `game.focus = true` yazılır; Dünya Görünümüne dönünce yalnız bizim
//   açtığımız odak kapatılır (kullanıcının kendi açtığı odak korunur).
// - Seçiciler ilkel değer döndürür (yeni dizi/nesne yok).
// PANO-FIX:
// - `explicit`: görünüm artık bir seçimdir — kurulum bitti (geçerli görünüm, geçmek onu değiştirmez) ya da Pano
//   seçildi ya da bu oturumda seçim yapıldı. Sunucu varsayılanı `ui.mode = "world"` yazılı geldiği için değerin varlığı
//   seçim sayılmaz. Sihirbaz yeniden açıldığında kart dolu gelir; "seçmeden geçersen Dünya açılır" notu yalnız ilk kurulumda.
// - `fresh`: temiz kurulum (sihirbaz tamamlanmadı ve görünüm hiç seçilmedi). Bu durumda "/" dünyayı (WebGL)
//   seçimden ÖNCE yüklemez; nötr bir yer tutucu çizilir. Ayna da yalnız açık seçimde ya da kurulum bittiyse yazılır.
// - kayıt isteği sayfa değişimi/yenilemeyle iptal edilirse (AbortError) seçim geri alınmaz.
import { create } from "zustand";
import { api } from "./api";
import { useGame } from "./game";
import type { Settings } from "./types";

export type UiMode = "world" | "board";
export const UI_MODE_KEY = "vc-ui-mode";
const FOCUS_KEY = "vc-ui-mode-focus";

/** Sunucu ya da depodan gelen değeri doğrular; eski `plain` adı `board` sayılır. Bilinmeyen değer null. */
export function normalizeUiMode(v: unknown): UiMode | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s === "board" || s === "plain") return "board";
  if (s === "world") return "world";
  return null;
}

const store = {
  get: (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => {
    try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch { /* gizli pencere */ }
  },
};

/** <html data-ui="board"> katmanı (index.css). Dünya Görünümünde öznitelik hiç yoktur. */
export function applyUiModeDom(m: UiMode): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (m === "board") el.dataset.ui = "board";
  else delete el.dataset.ui;
}

const mirrored: UiMode | null = typeof window !== "undefined" ? normalizeUiMode(store.get(UI_MODE_KEY)) : null;
applyUiModeDom(mirrored ?? "world");
/** İlk boyamadaki görünüm; ayna yoksa null (sunucu yanıtı beklenir, `/` kısa bir yükleniyor durumu gösterir). */
export const initialUiMode: UiMode | null = mirrored;

/** Kayıt sayfa gezinmesi/yenilemesiyle iptal edildi mi (sunucuya ulaşmış olabilir; seçim geri alınmaz). */
function aborted(e: unknown): boolean {
  return e instanceof DOMException ? e.name === "AbortError" : e instanceof Error && e.name === "AbortError";
}

export interface ViewSwitchNote { id: number; from: UiMode; to: UiMode; undo: boolean }

interface UiModeState {
  mode: UiMode;
  /** görünüm biliniyor (ayna ya da sunucu yanıtı); `/` buna göre Pano ya da Dünya çizer */
  known: boolean;
  /** kullanıcı bir görünümü açıkça seçti (sunucuda `ui.mode` yazılı ya da bu oturumda seçildi)*/
  explicit: boolean;
  /** temiz kurulum — sihirbaz bitmedi ve görünüm seçilmedi; "/" dünyayı yüklemez*/
  fresh: boolean;
  saving: boolean;
  /** son geçiş (geri al bildirimi için); null = bildirim yok */
  note: ViewSwitchNote | null;
  error: string | null;
  setMode: (m: UiMode, opts?: { undo?: boolean; announce?: boolean }) => Promise<boolean>;
  applyServer: (raw: unknown, onboarded?: boolean) => void;
  markUnknown: () => void;
  /** sihirbaz seçim yapılmadan kapandı — varsayılan (Dünya) artık yüklenebilir*/
  settleFresh: () => void;
  dismiss: () => void;
}

let noteSeq = 0;

async function mapGameFocus(next: UiMode): Promise<void> {
  const game = useGame.getState();
  try {
    if (next === "board") {
      if (!game.profile) await game.refresh();
      const prof = useGame.getState().profile;
      if (!prof || !prof.enabled) { store.set(FOCUS_KEY, null); return; }
      if (prof.focus) { store.set(FOCUS_KEY, "kept"); return; }
      store.set(FOCUS_KEY, "set");
      await useGame.getState().saveSettings({ focus: true });
    } else {
      const mine = store.get(FOCUS_KEY) === "set";
      store.set(FOCUS_KEY, null);
      if (mine && useGame.getState().profile?.focus) await useGame.getState().saveSettings({ focus: false });
    }
  } catch { /* oyun ayarı yazılamazsa görünüm yine değişir; katman yalnız görsel */ }
}

export const useUiMode = create<UiModeState>((set, get) => ({
  mode: mirrored ?? "world",
  known: mirrored !== null,
  explicit: false,
  fresh: false,
  saving: false,
  note: null,
  error: null,

  setMode: async (m, opts) => {
    const prev = get().mode;
    if (m === prev) return true;
    set({ mode: m, known: true, explicit: true, fresh: false, saving: true, error: null,
      note: opts?.announce === false ? null : { id: ++noteSeq, from: prev, to: m, undo: !!opts?.undo } });
    store.set(UI_MODE_KEY, m);
    applyUiModeDom(m);
    try {
      await api.saveSettings({ ui: { mode: m } } as unknown as Partial<Settings>);
      void mapGameFocus(m);
      set({ saving: false });
      return true;
    } catch (e) {
      if (aborted(e)) { set({ saving: false }); return true; }
      // kaydedilemedi: önceki görünüme dön, hata satır içi bildirimde (yalnız toast'a bırakılmaz: anahtarın altında da)
      store.set(UI_MODE_KEY, prev);
      applyUiModeDom(prev);
      set({ mode: prev, saving: false, note: null, error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  applyServer: (raw, onboarded = true) => {
    if (get().saving) return; // kullanıcının o anki seçimi sunucunun eski yanıtına yenilmesin
    const m = normalizeUiMode(raw) ?? "world";
    // kurulum bitmeden Pano seçilmediyse "temiz kurulum": ayna yazılmaz (sonraki açılış da seçimden önce dünyayı
    // yüklemesin) ve "/" nötr yer tutucu çizer
    const settled = onboarded || m === "board";
    if (settled) store.set(UI_MODE_KEY, m); else store.set(UI_MODE_KEY, null);
    applyUiModeDom(m);
    set({ mode: m, known: true, explicit: settled, fresh: !settled });
  },
  settleFresh: () => { if (get().fresh) set({ fresh: false }); },
  markUnknown: () => { if (!get().known) set({ known: true }); },
  dismiss: () => set({ note: null, error: null }),
}));

/** Görünüm seçicisi (ilkel). */
export const useMode = (): UiMode => useUiMode((s) => s.mode);
