/**
 * E2 (PLOT-FE) — parsel istemcisi (sunucu `backend/studio/expanse`).
 *
 * - `expanseApi`: `/api/expanse/{world}` (durum), `POST …/plots` (sahiplen; açık onay), `POST …/explored` (keşif bit kümesi).
 * Yazma uçları kullanıcı-yalnızdır; `X-Studio-UI` jetonunu `lib/presence.ts` ekler. Yanıtlar toleranslı süzülür.
 * - `loadExpanse(world)`: sunucu durumunu `voxel/expanse/plotStore.ts` deposuna yazar (parseller, yarıçap, keşif kümesi) ve
 * panel için son yanıtı tutar. Keşif kümesi yerelde birleşir; değişince en çok 20 sn'de bir gönderilir (ödül yok).
*/
import { create } from "zustand";
import { usePlotStore } from "../voxel/expanse/plotStore";
import { decodeBits, encodeBits, type PlotInfo } from "../voxel/expanse/plots";
import { scheduleGameRefresh } from "./game";
import { currentLocale } from "./i18n";
import { bodyText } from "./api";

export class ExpanseApiError extends Error {
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
    throw new ExpanseApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export type ClaimBlock = "full" | "locked" | "level" | "coins" | null;

export interface ExpanseState {
  world: string;
  radius: number;
  officeLevel: number;
  balance: number;
  admin: boolean;
  open: boolean;
  maxPlots: number;
  plots: PlotInfo[];
  next: { index: number; price: number; minLevel: number; canClaim: boolean; reason: ClaimBlock };
  explored: string;
  exploredCount: number;
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

function plotOf(raw: unknown): PlotInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const slot = num(o.slot, -1);
  if (!Number.isInteger(slot) || slot < 0 || slot > 11 || typeof o.id !== "string") return null;
  return { id: o.id, slot, color: str(o.color, "#F5F5F4"), name: str(o.name), trial: o.trial === true, edits: num(o.edits), prefabs: num(o.prefabs) };
}

export function parseState(raw: unknown): ExpanseState {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (o.next && typeof o.next === "object" ? o.next : {}) as Record<string, unknown>;
  const reason = ["full", "locked", "level", "coins"].includes(n.reason as string) ? (n.reason as ClaimBlock) : null;
  return {
    world: str(o.world), radius: num(o.radius, 4), officeLevel: num(o.office_level, 1), balance: num(o.balance), admin: o.admin === true,
    open: o.open !== false, maxPlots: num(o.max_plots, 12),
    plots: (Array.isArray(o.plots) ? o.plots : []).map(plotOf).filter((p): p is PlotInfo => !!p).sort((a, b) => a.slot - b.slot),
    next: { index: num(n.index), price: num(n.price), minLevel: num(n.min_level, 1), canClaim: n.can_claim === true, reason },
    explored: str(o.explored), exploredCount: num(o.explored_count),
  };
}

const enc = (w: string) => encodeURIComponent(w);
export const expanseApi = {
  state: (world: string) => req<unknown>("GET", `/api/expanse/${enc(world)}`).then(parseState),
  claim: (world: string, body: { slot: number; color: string; name?: string; client_request_id: string }) =>
    req<{ ok: boolean; already?: boolean; plot: unknown; balance: number; admin: boolean; spent: number }>(
      "POST", `/api/expanse/${enc(world)}/plots`, { ...body, confirm: true }),
  explored: (world: string, bits: string) =>
    req<{ ok: boolean; recorded: boolean }>("POST", `/api/expanse/${enc(world)}/explored`, { bits }),
  // E3 yapı modu: parsel gövdesi (`{edits, prefabs}`; şema voxel/build/catalog.ts ↔ studio/expanse/build.py)
  plot: (world: string, id: string) =>
    req<{ body?: { edits?: unknown; prefabs?: unknown } }>("GET", `/api/expanse/${enc(world)}/plots/${enc(id)}`),
  putPlot: (world: string, id: string, body: { edits: unknown[]; prefabs: unknown[] }) =>
    req<{ ok: boolean; persisted?: boolean; plot: { body?: { edits?: unknown; prefabs?: unknown } } }>(
      "PUT", `/api/expanse/${enc(world)}/plots/${enc(id)}`, body),
};

// ------------------------------------------------------------------ panel deposu
interface ExpanseView {
  state: ExpanseState | null;
  loading: boolean;
  error: string | null;
}
export const useExpanseView = create<ExpanseView>(() => ({ state: null, loading: false, error: null }));

let seq = 0;
/** Dünyanın parsel durumunu yükler ve depoları doldurur (aynı anda yalnız son istek yazar). */
export async function loadExpanse(world: string | null | undefined): Promise<void> {
  if (!world) return;
  const my = ++seq;
  useExpanseView.setState((s) => ({ loading: true, error: null, state: s.state?.world === world ? s.state : null }));
  const ps = usePlotStore.getState();
  if (ps.world !== world) {
    // önceki dünyanın gönderilmemiş keşfi kaybolmasın
    if (ps.dirty && ps.world) void expanseApi.explored(ps.world, encodeBits(ps.explored)).catch(() => undefined);
    ps.set({ world, plots: [], explored: decodeBits(null), dirty: false, goto: null });
  }
  try {
    const st = await expanseApi.state(world);
    if (my !== seq) return;
    useExpanseView.setState({ state: st, loading: false, error: null });
    const cur = usePlotStore.getState();
    // yerel (gönderilmemiş) keşiflerle birleşim
    const bits = decodeBits(st.explored);
    if (cur.world === world) for (let k = 0; k < bits.length; k++) bits[k] |= cur.explored[k];
    cur.set({ world, plots: st.plots, radius: st.radius, explored: bits });
  } catch (e) {
    if (my !== seq) return;
    useExpanseView.setState({ loading: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Sahiplen (açık onaydan sonra çağrılır). Dönüş: sahiplenilen yuva. */
export async function claimPlot(world: string, slot: number, color: string, name: string): Promise<void> {
  const rid = `claim-${world}-${slot}-${Date.now().toString(36)}`;
  await expanseApi.claim(world, { slot, color, name: name.trim() || undefined, client_request_id: rid });
  scheduleGameRefresh(200);
  await loadExpanse(world);
}

// ------------------------------------------------------------------ keşif kümesi eşitlemesi (ödülsüz)
let syncTimer: number | undefined;
let installed = false;
/** Keşif kümesi değişince en çok 20 sn'de bir sunucuya gönderilir (yönetici modunda sunucu kaydetmez). */
export function installExploredSync(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const flush = () => {
    syncTimer = undefined;
    const st = usePlotStore.getState();
    if (!st.dirty || !st.world) return;
    const world = st.world;
    st.set({ dirty: false });
    void expanseApi.explored(world, encodeBits(st.explored)).catch(() => {
      if (usePlotStore.getState().world === world) usePlotStore.getState().set({ dirty: true });
    });
  };
  usePlotStore.subscribe((s, prev) => {
    if (s.dirty && !prev.dirty && syncTimer === undefined) syncTimer = window.setTimeout(flush, 20_000);
  });
  window.addEventListener("pagehide", () => { if (usePlotStore.getState().dirty) flush(); });
}
