/**
 * WALK-EXPLORE — keşif istemcisi ve deposu (`/api/walk/explore*`; sözleşme: backend/studio/walk/explore.py).
 *
 *  - `useExplore`: bulunan keşif kimlikleri, sahne yüzdeleri, keşif görevleri, unvan, günlük (albüm). Seçiciler kararlı
 *    referans döndürür (kümeler yalnız değişince yeni referans alır).
 *  - `discoverExplore`: iyimser kayıt (aynı kimlik ikinci kez istek üretmez); sunucu reddederse geri alınır. Yazma
 *    kullanıcı-yalnızdır; `X-Studio-UI` jetonunu `lib/presence.ts` ekler. Yanıt tostu ve ekran okuyucu duyurusu üretir.
 *  - Yönetici/yaratıcı (görüntüleme) yanıtı kayıt yazmaz: yerelde de bulunmuş sayılmaz.
 */
import { create } from "zustand";
import { scheduleGameRefresh } from "../../../../lib/game";
import { currentLocale, tx } from "../../../../lib/i18n";
import { pushWalkToast, WalkApiError } from "../../../../lib/walk";
import { explore as XM } from "../../../../locales/explore";
import { parseExploreId } from "../../../../voxel/interiors/catalog";
import { markTaken, setTaken } from "../../../../voxel/interiors/store";
import { announceWalk } from "../announce";
import { sceneLabel } from "../progress/actions";
import { bodyText } from "../../../../lib/api";

export interface ExploreQuest { id: string; scene: string; kind: "vp" | "in" | "poi" | "gz" | "k"; target: number; progress: number; done: boolean; reward_coins: number }
export interface ExploreSceneSum { total: number; found: number; percent: number; explore_total: number; explore_found: number }
export interface ExploreLogRow { id: string; world: string; kind: string; ts: number }
export interface ExploreTitle { id: string; min: number }
export interface ExploreView {
  found: string[];
  scenes: Record<string, ExploreSceneSum>;
  quests: ExploreQuest[];
  count: number;
  title: ExploreTitle;
  next_title: ExploreTitle | null;
  log: ExploreLogRow[];
  admin: boolean;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); msg = bodyText(res.status, j); } catch { /* gövde yok */ }
    throw new WalkApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export function normalizeExplore(raw: unknown): ExploreView {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = (r.title && typeof r.title === "object" ? r.title : { id: "title_none", min: 0 }) as ExploreTitle;
  return {
    found: arr<string>(r.found).filter((x) => typeof x === "string"),
    scenes: (r.scenes && typeof r.scenes === "object" ? r.scenes : {}) as Record<string, ExploreSceneSum>,
    quests: arr<ExploreQuest>(r.quests),
    count: Number(r.count) || 0,
    title,
    next_title: (r.next_title && typeof r.next_title === "object" ? r.next_title : null) as ExploreTitle | null,
    log: arr<ExploreLogRow>(r.log),
    admin: !!r.admin,
  };
}

export interface ExploreResult {
  already: boolean; recorded: boolean; admin: boolean; coins: number; reason?: string;
  quests: { id: string; kind: ExploreQuest["kind"]; scene: string; target: number; coins: number; paid: boolean }[];
}
const result = (raw: unknown): ExploreResult => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { already: !!r.already, recorded: r.recorded !== false, admin: !!r.admin, coins: Number(r.coins) || 0,
    reason: typeof r.reason === "string" ? r.reason : r.creative ? "creative" : undefined,
    quests: arr<ExploreResult["quests"][number]>(r.quests_completed) };
};

function requestId() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export const exploreApi = {
  state: (world?: string | null) => req<unknown>("GET", `/api/walk/explore${world ? `?world=${encodeURIComponent(world)}` : ""}`).then(normalizeExplore),
  discover: (world: string, id: string) => req<unknown>("POST", "/api/walk/explore", { world, id, client_request_id: requestId() }).then(result),
};

// ------------------------------------------------------------------ depo
export interface ExploreState {
  loaded: boolean;
  error: string | null;
  view: ExploreView | null;
  found: ReadonlySet<string>;
  pending: ReadonlySet<string>;
}
const EMPTY: ReadonlySet<string> = new Set();
export const useExplore = create<ExploreState>(() => ({ loaded: false, error: null, view: null, found: EMPTY, pending: EMPTY }));

let inflight: Promise<void> | null = null;
/** Keşif durumunu yükler (bütün sahneler; görevler sahneye göre süzülmez). */
export function loadExplore(): Promise<void> {
  inflight = exploreApi.state(null).then((v) => {
    const s = useExplore.getState();
    const found = new Set([...s.found, ...v.found]);
    useExplore.setState({ loaded: true, error: null, view: v, found: found.size !== s.found.size ? found : s.found });
    setTaken(v.found.filter((id) => parseExploreId(id)?.kind === "k"));
  }).catch((e: unknown) => { useExplore.setState({ loaded: true, error: e instanceof Error ? e.message : String(e) }); })
    .finally(() => { inflight = null; });
  return inflight;
}
export const ensureExplore = () => inflight ?? (useExplore.getState().loaded ? Promise.resolve() : loadExplore());

let reloadTimer = 0;
function scheduleReload() {
  window.clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(() => { void loadExplore(); }, 500);
}

/** Bulunan sayılır mı (sunucu onayı ya da istekte). */
export const isFound = (id: string) => { const s = useExplore.getState(); return s.found.has(id) || s.pending.has(id); };

export interface DiscoverText { title: string; text?: string; kind: "souvenir" | "visa" | "info" }
/**
 * Keşif kaydı (iyimser). `text` tost içeriği (çağıran yer bilir: manzara, iç mekân, POI, gizli köşe, parça). Dönüş: istek başladı mı.
 * Kalıcı reddedilen (403/409/400) kimlik bu oturumda yeniden denenmez; 429 geçicidir.
 */
const refused = new Set<string>();
export function discoverExplore(world: string, id: string, text: DiscoverText | null): boolean {
  if (refused.has(id) || isFound(id)) return false;
  const s = useExplore.getState();
  useExplore.setState({ pending: new Set([...s.pending, id]) });
  if (parseExploreId(id)?.kind === "k") markTaken(id);
  exploreApi.discover(world, id).then((r) => {
    const viewOnly = r.admin || r.reason === "creative" || (!r.recorded && !r.already);
    useExplore.setState((st) => {
      const pending = new Set(st.pending); pending.delete(id);
      return viewOnly ? { pending } : { pending, found: new Set([...st.found, id]) };
    });
    if (viewOnly) refused.add(id);
    if (text && !r.already) {
      const extra = viewOnly ? tx(XM, "found_view_only") : r.coins > 0 ? tx(XM, "found_coins", { n: r.coins }) : r.reason === "daily_cap" ? tx(XM, "found_daily_cap") : "";
      pushWalkToast({ kind: text.kind, title: text.title, text: [text.text, extra].filter(Boolean).join(" · ") || undefined });
      announceWalk(text.title);
    }
    for (const q of r.quests) {
      const title = questTitle(q);
      pushWalkToast({ kind: "info", title: tx(XM, "quest_done", { title }),
        text: q.paid ? tx(XM, "quest_reward", { n: q.coins }) : tx(XM, "found_daily_cap") });
      announceWalk(tx(XM, "quest_done", { title }));
    }
    scheduleReload();
    if (r.coins > 0 || r.quests.length) scheduleGameRefresh();
  }).catch((e: unknown) => {
    useExplore.setState((st) => { const pending = new Set(st.pending); pending.delete(id); return { pending }; });
    const status = e instanceof WalkApiError ? e.status : 0;
    // 429 geçici; 409 zincir kuralı (giriş kaydı henüz yetişmedi) — ikisi de sonra yeniden denenebilir
    if (status !== 429 && status !== 409) refused.add(id);
    if (status === 409) return;
    if (text) pushWalkToast({ kind: "info", title: tx(XM, "fail", { msg: e instanceof Error ? e.message : String(e) }) });
  });
  return true;
}

// ------------------------------------------------------------------ metin yardımcıları
/** Türkçe bulunma eki (-da/-de/-ta/-te), kesme işaretiyle: "İstanbul'da", "<city>'te", "<city>'ta".*/
export function locativeTr(name: string): string {
  const s = name.trim();
  const vowels = "aıouâeiöüîû";
  let last = "";
  for (let k = s.length - 1; k >= 0; k--) { const ch = s[k].toLocaleLowerCase("tr"); if (vowels.includes(ch)) { last = ch; break; } }
  const front = "eiöüî".includes(last);
  const end = s[s.length - 1]?.toLocaleLowerCase("tr") ?? "";
  const hard = "fstkçşhp".includes(end);
  return `${s}'${hard ? "t" : "d"}${front ? "e" : "a"}`;
}

export function questTitle(q: Pick<ExploreQuest, "kind" | "scene" | "target">): string {
  const scene = sceneLabel(q.scene);
  return tx(XM, `q_${q.kind}` as "q_vp", { n: q.target, scene, where: locativeTr(scene) });
}
