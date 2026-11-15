/**
 * E3 (BUILD-UX) — yapı modu eylemleri (depo `voxel/build/store.ts`).
 *
 * - Gövdeler sunucudan (`GET /api/expanse/{dünya}/plots/{id}`) yalnız inşası olan parseller için bir kez istenir.
 * - Taslak her değişiklikte bu cihazda saklanır (`localStorage`, try/catch); sunucuya **yalnız "Kaydet"** ile gider (dünya yapıcı
 * kuralı: sunucu dosyası kendiliğinden ezilmez). Yapı moduna yeniden girişte kayıtlıdan farklı taslak geri yüklenir (X15).
 * - Deneme parseli (yönetici / test modu; E2 kuralı): "Kaydet" sunucuda doğrular ama yazmaz (`persisted: false`); inşa yalnız bu
 * oturumda görünür, taslak cihazda da saklanmaz.
 * - Kaydetmeden önce aynı kurallar istemcide denetlenir (`validateBody`); sunucu yine yetkilidir.
*/
import { EMPTY_BODY, BLOCK_BY_ID, isBuildPrefab, type Edit, type PlotBody, type PlotPrefab } from "../voxel/build/catalog";
import { commit, EMPTY_HISTORY, redo, sameBody, undo } from "../voxel/build/commands";
import { bumpBuild, renderBody, useBuildStore } from "../voxel/build/store";
import { addedLocked, validateBody } from "../voxel/build/volume";
import { usePlotStore } from "../voxel/expanse/plotStore";
import type { PlotInfo } from "../voxel/expanse/plots";
import { build as BM } from "../locales/build";
import { builder as BLD } from "../locales/builder";
import { ExpanseApiError, expanseApi, loadExpanse } from "./expanse";
import { useGame } from "./game";
import { tx } from "./i18n";

// ------------------------------------------------------------------ gövde ayrıştırma (toleranslı)
const isInt = (v: unknown): v is number => Number.isInteger(v);

export function parseBody(raw: unknown): PlotBody {
  const o = (raw && typeof raw === "object" ? raw : {}) as { edits?: unknown; prefabs?: unknown };
  const edits: Edit[] = [];
  for (const e of Array.isArray(o.edits) ? o.edits : []) {
    if (Array.isArray(e) && e.length === 5 && isInt(e[0]) && isInt(e[1]) && isInt(e[2]) && typeof e[3] === "string" && isInt(e[4])) {
      edits.push([e[0], e[1], e[2], e[3], e[4]]);
    }
  }
  const prefabs: PlotPrefab[] = [];
  for (const p of Array.isArray(o.prefabs) ? o.prefabs : []) {
    if (p && typeof p === "object" && typeof (p as { t?: unknown }).t === "string" && isBuildPrefab((p as { t: string }).t)
      && isInt((p as { i?: unknown }).i) && isInt((p as { j?: unknown }).j)) prefabs.push(p as PlotPrefab);
  }
  return { edits, prefabs };
}

// ------------------------------------------------------------------ yardımcılar
const plotIds = () => usePlotStore.getState().plots.map((p) => p.id);
const plotOf = (id: string | null): PlotInfo | null => (id ? usePlotStore.getState().plots.find((p) => p.id === id) ?? null : null);
const draftKey = (world: string, id: string) => `voxcrew.build.draft.${world}.${id}`;

function readDraft(world: string, id: string): PlotBody | null {
  try {
    const raw = window.localStorage.getItem(draftKey(world, id));
    return raw ? parseBody(JSON.parse(raw)) : null;
  } catch { return null; }
}
function writeDraft(world: string, id: string, body: PlotBody | null): void {
  try {
    if (body) window.localStorage.setItem(draftKey(world, id), JSON.stringify(body));
    else window.localStorage.removeItem(draftKey(world, id));
  } catch { /* depolama yok: taslak yalnız bellekte */ }
}

/** Kilitli dekor kimlikleri (S35; oyun kapalı / yaratıcı / yönetici modda boş) — sunucu kuralının istemci eşi.*/
export function lockedDecor(): Map<string, number> {
  const p = useGame.getState().profile;
  const out = new Map<string, number>();
  if (!p || !p.enabled || p.creative || p.admin === true) return out;
  for (const d of p.decor ?? []) if (!d.unlocked) out.set(d.id, d.unlock_level);
  return out;
}

/** Palet öğesinin görünen adı: blok (locales/build.ts) ya da prefab (dünya yapıcı `item_<kimlik>`). */
export function itemName(id: string): string {
  const b = BLOCK_BY_ID.get(id);
  if (b) return tx(BM, `blk_${b.id}` as never);
  return isBuildPrefab(id) ? tx(BLD, `item_${id}` as never) : id;
}

export function say(text: string): void {
  const st = useBuildStore.getState();
  st.set({ announce: { text, seq: st.announce.seq + 1 } });
}

// ------------------------------------------------------------------ gövdeleri yükle
/** Dünyanın parsel gövdelerini (inşası olanlar) yükler; dünya değişince depo sıfırlanır. Kuyruk eki parsel listesiyle güncellenir. */
export async function ensureBodies(world: string, plots: readonly PlotInfo[]): Promise<void> {
  const st = useBuildStore.getState();
  if (st.world !== world) {
    st.set({ world, bodies: {}, fetched: {}, active: false, plotId: null, draft: null, history: EMPTY_HISTORY, dirty: false, ghost: null,
      confirmExit: false, note: null, cursor: null });
  }
  const ids = plots.map((p) => p.id);
  bumpBuild({}, ids);
  const want = plots.filter((p) => (p.edits > 0 || p.prefabs > 0) && !useBuildStore.getState().fetched[p.id] && !p.trial);
  if (!want.length) return;
  useBuildStore.getState().set({ fetched: { ...useBuildStore.getState().fetched, ...Object.fromEntries(want.map((p) => [p.id, true as const])) } });
  const got = await Promise.all(want.map(async (p) => {
    try { return [p.id, parseBody((await expanseApi.plot(world, p.id)).body)] as const; } catch { return null; }
  }));
  if (useBuildStore.getState().world !== world) return;
  const bodies = { ...useBuildStore.getState().bodies };
  for (const g of got) if (g) bodies[g[0]] = g[1];
  // alınamayan gövde yeniden denenebilsin (yapı modu ona kadar açılmaz: boş taslak sunucudakini ezmesin)
  const fetched = { ...useBuildStore.getState().fetched };
  want.forEach((p, k) => { if (!got[k]) delete fetched[p.id]; });
  bumpBuild({ bodies, fetched }, plotIds());
}

// ------------------------------------------------------------------ oturum
/** Yapı moduna gir (parsel avatarın altında; çağıran denetler). İnşası olan parselin gövdesi henüz yüklenmediyse açılmaz
 *  (boş taslağın kaydı sunucudakini ezmesin): yükleme başlatılır, "Parsel yükleniyor" denir; `false` döner. */
export function enterBuild(world: string, plot: PlotInfo): boolean {
  const st = useBuildStore.getState();
  if (!plot.trial && (plot.edits > 0 || plot.prefabs > 0) && !st.bodies[plot.id]) {
    st.set({ note: { code: "loading", tone: "info" } });
    say(tx(BM, "msg_loading"));
    void ensureBodies(world, usePlotStore.getState().plots);
    return false;
  }
  const saved = st.bodies[plot.id] ?? EMPTY_BODY;
  const draft = plot.trial ? null : readDraft(world, plot.id);
  const restored = !!draft && !sameBody(draft, saved);
  bumpBuild({
    active: true, plotId: plot.id, trial: plot.trial, draft: restored ? draft : saved, history: EMPTY_HISTORY, dirty: restored,
    ghost: null, confirmExit: false, cursor: null, note: restored ? { code: "draft_restored", tone: "info" } : null,
  }, plotIds());
  say(tx(BM, "ann_on", { plot: plot.name || `#${plot.slot + 1}` }));
  return true;
}

/** Çıkış isteği: kaydedilmemiş değişiklik varsa onay sorulur. */
export function requestExit(): void {
  const st = useBuildStore.getState();
  if (!st.active) return;
  if (st.dirty) { st.set({ confirmExit: true }); return; }
  exitBuild("keep");
}

/** Çık: `keep` taslağı cihazda bırakır (deneme parselinde oturum gövdesine yazar), `discard` taslağı siler. */
export function exitBuild(mode: "keep" | "discard"): void {
  const st = useBuildStore.getState();
  if (!st.active) return;
  const bodies = { ...st.bodies };
  if (st.plotId && st.world) {
    if (mode === "discard") writeDraft(st.world, st.plotId, null);
    else if (st.trial && st.draft) bodies[st.plotId] = st.draft; // deneme: oturum gövdesi (kaydedilmez)
  }
  bumpBuild({ active: false, plotId: null, draft: null, history: EMPTY_HISTORY, dirty: false, ghost: null, confirmExit: false, cursor: null,
    note: null, bodies }, plotIds());
  say(tx(BM, "ann_off"));
}

/** Taslağı değiştir (geri al yığınına ekler, cihaza yazar). */
export function applyBody(next: PlotBody, text?: string): void {
  const st = useBuildStore.getState();
  if (!st.active || !st.draft || next === st.draft) return;
  const saved = st.plotId ? st.bodies[st.plotId] ?? EMPTY_BODY : EMPTY_BODY;
  bumpBuild({ draft: next, history: commit(st.history, st.draft), dirty: !sameBody(next, saved), note: null }, plotIds());
  if (st.world && st.plotId && !st.trial) writeDraft(st.world, st.plotId, next);
  if (text) say(text);
}

export function undoBuild(): void {
  const st = useBuildStore.getState();
  if (!st.active || !st.draft) return;
  const r = undo(st.history, st.draft);
  if (!r) return;
  const saved = st.plotId ? st.bodies[st.plotId] ?? EMPTY_BODY : EMPTY_BODY;
  bumpBuild({ draft: r.body, history: r.h, dirty: !sameBody(r.body, saved) }, plotIds());
  if (st.world && st.plotId && !st.trial) writeDraft(st.world, st.plotId, r.body);
  say(tx(BM, "ann_undo"));
}

export function redoBuild(): void {
  const st = useBuildStore.getState();
  if (!st.active || !st.draft) return;
  const r = redo(st.history, st.draft);
  if (!r) return;
  const saved = st.plotId ? st.bodies[st.plotId] ?? EMPTY_BODY : EMPTY_BODY;
  bumpBuild({ draft: r.body, history: r.h, dirty: !sameBody(r.body, saved) }, plotIds());
  if (st.world && st.plotId && !st.trial) writeDraft(st.world, st.plotId, r.body);
  say(tx(BM, "ann_redo"));
}

/** Öteki parsellerin blok toplamı (dünya bütçesi). */
export function otherEdits(plotId: string | null): number {
  const st = useBuildStore.getState();
  let n = 0;
  for (const p of usePlotStore.getState().plots) if (p.id !== plotId) n += st.bodies[p.id]?.edits.length ?? p.edits;
  return n;
}

/** Kaydet: istemci denetimi → PUT. Deneme parselinde sunucu yalnız doğrular. Başarıda `true`. */
export async function saveBuild(): Promise<boolean> {
  const st = useBuildStore.getState();
  if (!st.active || !st.draft || !st.plotId || !st.world || st.saving) return false;
  if (!st.dirty && !st.trial) { st.set({ note: { code: "nothing", tone: "info" } }); return true; }
  const problems = validateBody(st.draft, otherEdits(st.plotId));
  if (problems.length) {
    st.set({ note: { code: "invalid", tone: "warn", vars: { why: tx(BM, `code_${problems[0].code}` as never) } } });
    return false;
  }
  // eşi: kilitli dekor (S35) kayıtlı gövdeye göre yeni eklenmişse sunucuya gitmeden söyle (sunucu da reddeder)
  const locked = lockedDecor();
  const added = addedLocked(st.bodies[st.plotId] ?? EMPTY_BODY, st.draft, new Set(locked.keys()));
  if (added) {
    st.set({ note: { code: "invalid", tone: "warn", vars: { why: `${itemName(added)}: ${tx(BM, "code_locked")}` } } });
    return false;
  }
  const world = st.world, id = st.plotId, body = st.draft;
  st.set({ saving: true, note: null });
  try {
    const res = await expanseApi.putPlot(world, id, { edits: body.edits, prefabs: body.prefabs });
    const cur = useBuildStore.getState();
    if (cur.world !== world) return false;
    const persisted = res.persisted !== false;
    const saved = persisted ? parseBody(res.plot?.body) : body;
    const bodies = { ...cur.bodies, [id]: saved };
    const stillSame = cur.draft === body;
    bumpBuild({ bodies, saving: false, dirty: stillSame ? false : cur.dirty, note: { code: persisted ? "saved" : "saved_trial", tone: "ok" } }, plotIds());
    if (persisted && stillSame) writeDraft(world, id, null);
    say(tx(BM, persisted ? "msg_saved" : "msg_saved_trial"));
    if (persisted) void loadExpanse(world); // panel sayıları (blok/eşya)
    return true;
  } catch (e) {
    const msg = e instanceof ExpanseApiError || e instanceof Error ? e.message : String(e);
    useBuildStore.getState().set({ saving: false, note: { code: "save_failed", tone: "warn", vars: { msg } } });
    say(tx(BM, "msg_save_failed", { msg }));
    return false;
  }
}

/** Kaydet ve çık (onay penceresi). */
export async function saveAndExit(): Promise<void> {
  if (await saveBuild()) exitBuild("keep");
}

/** Sayfadan çıkarken kaydedilmemiş inşa uyarısı (X15). */
let unloadInstalled = false;
export function installBuildUnloadGuard(): void {
  if (unloadInstalled || typeof window === "undefined") return;
  unloadInstalled = true;
  window.addEventListener("beforeunload", (e) => {
    const st = useBuildStore.getState();
    if (st.active && st.dirty && !st.trial) { e.preventDefault(); e.returnValue = ""; }
  });
}

/** Çizim için: parselin şu anki gövdesi. */
export const currentBody = (plotId: string) => renderBody(useBuildStore.getState(), plotId);
export const activePlot = () => plotOf(useBuildStore.getState().plotId);
