/**
 * E3 (BUILD-UX) — yapı modu deposu (zustand; seyrek): parsel gövdeleri (sunucu ya da deneme oturumu), etkin inşa oturumu
 * (taslak, geri al/yinele, palet seçimi, dönüş, araç), hayalet durumu (HUD metni için), duyurular ve kuyruk kapasitesi ekleri.
 *
 *  - Çizim kaynağı: etkin parselde taslak, ötekilerde kayıtlı gövde (`renderBody`). `version` her değişimde artar; çizim ve çarpışma
 *    (`Outskirts.tsx`) buna bakar.
 *  - Kuyruk kapasitesi (`extra`): inşa örnekleri kapasite kuyruğunun **inşa bölgesine** yazılır (+0 çizim çağrısı). Gereken örnek
 *    sayısı gövdelerden hesaplanır ve 512'ye (cam/parıltı 256) yuvarlanır; `Blocks.tsx` mesh kapasitesini buna göre kurar (sığmama
 *    yok, taşma 0). Parseli olmayan dünyada ek 0 (bugünkü düzen birebir aynı).
 *  - Seçiciler kararlı referans döndürür.
 */
import { create } from "zustand";
import { EMPTY_BODY, type PlotBody } from "./catalog";
import { EMPTY_HISTORY, type History } from "./commands";
import { boundOf } from "./mesh";

export type BuildTool = "place" | "break";
export type TailExtra = Readonly<{ solid: number; water: number; glass: number; glow: number }>;
export const NO_EXTRA: TailExtra = Object.freeze({ solid: 0, water: 0, glass: 0, glow: 0 });
/** Hayalet yuvası (kuyrukta akış yuvalarından hemen sonra): solid 24 (12 koyu + 12 açık yedeği), glow 12 (açık çubuklar). */
export const GHOST_SLOTS: TailExtra = Object.freeze({ solid: 24, water: 0, glass: 0, glow: 12 });

export interface GhostInfo {
  cell: [number, number, number];
  action: "place" | "break";
  /** null = geçerli; değilse kural kodu (volume.ts BuildCode) */
  code: string | null;
}

export interface BuildStore {
  world: string | null;
  /** kayıtlı gövdeler (gerçek parsel: sunucu; deneme parseli: yalnız bu oturum) */
  bodies: Record<string, PlotBody>;
  /** gövdesi sunucudan istenmiş parseller (yinelenmesin) */
  fetched: Record<string, true>;
  version: number;
  active: boolean;
  plotId: string | null;
  trial: boolean;
  draft: PlotBody | null;
  history: History;
  dirty: boolean;
  item: string;
  rot: number;
  tool: BuildTool;
  /** klavye ızgara imleci (yerel hücre); fare/dokunma kullanılınca null */
  cursor: [number, number, number] | null;
  ghost: GhostInfo | null;
  saving: boolean;
  /** HUD iletisi: kod + ton (locales/build.ts `msg_<kod>`) */
  note: { code: string; tone: "info" | "warn" | "ok"; vars?: Record<string, string | number> } | null;
  /** ekran okuyucu duyurusu (aria-live) — her duyuruda `seq` artar */
  announce: { text: string; seq: number };
  confirmExit: boolean;
  extra: TailExtra;
  /** "İnşa" (B / HUD): BuildLayer kaydeder; yürüme kapalıyken null */
  toggle: (() => void) | null;
  set: (patch: Partial<Omit<BuildStore, "set">>) => void;
}

export const useBuildStore = create<BuildStore>((set) => ({
  world: null,
  bodies: {},
  fetched: {},
  version: 0,
  active: false,
  plotId: null,
  trial: false,
  draft: null,
  history: EMPTY_HISTORY,
  dirty: false,
  item: "block_stone",
  rot: 0,
  tool: "place",
  cursor: null,
  ghost: null,
  saving: false,
  note: null,
  announce: { text: "", seq: 0 },
  confirmExit: false,
  extra: NO_EXTRA,
  toggle: null,
  set: (patch) => set(patch),
}));

/** Parselin çizilecek gövdesi: etkin parselde taslak, değilse kayıtlı gövde. */
export function renderBody(st: Pick<BuildStore, "active" | "plotId" | "draft" | "bodies">, plotId: string): PlotBody {
  if (st.active && st.plotId === plotId && st.draft) return st.draft;
  return st.bodies[plotId] ?? EMPTY_BODY;
}

const up = (n: number, q: number) => (n <= 0 ? 0 : Math.ceil(n / q) * q);
const boundCache = new WeakMap<PlotBody, ReturnType<typeof boundOf>>();
const bound = (b: PlotBody) => { let v = boundCache.get(b); if (!v) { v = boundOf(b); boundCache.set(b, v); } return v; };

/** Kuyruk kapasitesi eki: parsel varsa hayalet yuvası + inşa örneklerinin üst sınırı (yuvarlanmış). */
export function tailExtraFor(plotIds: readonly string[], st: Pick<BuildStore, "active" | "plotId" | "draft" | "bodies">): TailExtra {
  if (!plotIds.length) return NO_EXTRA;
  let all = 0, glass = 0, glow = 0;
  for (const id of plotIds) {
    const b = bound(renderBody(st, id));
    all += b.all; glass += b.glass; glow += b.glow;
  }
  return {
    solid: GHOST_SLOTS.solid + up(all, 512),
    water: 0,
    glass: up(glass, 256),
    glow: GHOST_SLOTS.glow + up(glow, 256),
  };
}

/** Bütün gövde değişimleri buradan: sürüm artar, kuyruk eki gerekirse güncellenir. */
export function bumpBuild(patch: Partial<Omit<BuildStore, "set">>, plotIds: readonly string[]): void {
  const st = useBuildStore.getState();
  const next = { ...st, ...patch };
  const extra = tailExtraFor(plotIds, next);
  const same = extra.solid === st.extra.solid && extra.glass === st.extra.glass && extra.glow === st.extra.glow && extra.water === st.extra.water;
  st.set({ ...patch, version: st.version + 1, ...(same ? {} : { extra }) });
}

export const useBuildToggle = () => useBuildStore((s) => s.toggle);
export const useBuildActive = () => useBuildStore((s) => s.active);
export const useBuildTail = () => useBuildStore((s) => s.extra);
export const useBuildVersion = () => useBuildStore((s) => s.version);
