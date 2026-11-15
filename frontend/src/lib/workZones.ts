/**
 * WORK-ZONES (plan §5 C2) — çalışma bölgesi deposu: sunucudaki süren koşuların bölgeleri (`GET /api/work-zones/active`), ajan
 * varsayılanları, dünyanın hesapladığı masa durumları (dolu / yok / ulaşılamaz → taban ofis) ve oturum boyu "yapışkan" ofisler
 * (bir kez kurulan ofis binası, ajanlar işten dönerken dünyadan kalkmasın).
 *
 * Olaylar: `workzone.` (görev bölgeyle başladı, varsayılan değişti), `run.` (koşu bitti/başladı), `resync.` → yeniden yükle.
 * Yazma uçları yalnız kullanıcı arayüzünden (MCP 403).
 */
import { useMemo } from "react";
import { create } from "zustand";
import { ApiError, bodyText } from "./api";
import { currentLocale } from "./i18n";
import { registerEventHandler, useStudio } from "./store";
import { BASE_ZONE, parseZone } from "../voxel/workzones/registry";
import type { ZoneRequest, ZoneSeatState } from "../voxel/workzones/world";

export interface ActiveZoneRun { run_id: string; zone: string; agents: string[]; status: string; started_at?: string | null }
export interface ActiveZones { scene: string | null; active: ActiveZoneRun[]; defaults: Record<string, string> }
export interface ZoneOption { id: string; name: string; tr: string; en: string; scene: string | null; office: string | null; look: string | null; desks: number }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = bodyText(res.status, null);
    try { msg = bodyText(res.status, await res.json()); } catch { /* gövde yok */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const workZonesApi = {
  list: (scene?: string | null) => req<{ scene: string | null; default: string; zones: ZoneOption[] }>("GET", `/api/work-zones${scene ? `?scene=${encodeURIComponent(scene)}` : ""}`),
  active: () => req<ActiveZones>("GET", "/api/work-zones/active"),
  setDefault: (slug: string, zone: string | null) =>
    req<{ slug: string; work_zone: string | null }>("PUT", `/api/agents/${encodeURIComponent(slug)}/work-zone`, { zone: zone ?? BASE_ZONE }),
};

interface WZStore extends ActiveZones {
  loaded: boolean;
  /** sahne → bu oturumda kurulmuş ofis bölgeleri */
  sticky: Record<string, string[]>;
  /** ajan → dünyanın masa durumu (bölge isteyenler) */
  seat: Record<string, { zone: string; state: ZoneSeatState }>;
  refresh: () => Promise<void>;
  keep: (scene: string, zones: readonly string[]) => void;
  setSeats: (m: ReadonlyMap<string, { zone: string; state: ZoneSeatState }>) => void;
}

const NONE: Record<string, string> = {};
export const useWorkZones = create<WZStore>((set, get) => ({
  scene: null, active: [], defaults: NONE, loaded: false, sticky: {}, seat: {},
  refresh: async () => {
    try {
      const r = await workZonesApi.active();
      set({ scene: r.scene, active: r.active ?? [], defaults: r.defaults ?? NONE, loaded: true });
    } catch { set({ loaded: true }); }
  },
  keep: (scene, zones) => {
    const cur = get().sticky[scene] ?? [];
    const add = zones.filter((z) => !cur.includes(z));
    if (add.length) set({ sticky: { ...get().sticky, [scene]: [...cur, ...add].sort() } });
  },
  setSeats: (m) => {
    const next: WZStore["seat"] = {};
    for (const [k, v] of m) next[k] = v;
    const cur = get().seat;
    const same = Object.keys(next).length === Object.keys(cur).length
      && Object.entries(next).every(([k, v]) => cur[k]?.zone === v.zone && cur[k]?.state === v.state);
    if (!same) set({ seat: next });
  },
}));

let timer: number | undefined;
const soon = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void useWorkZones.getState().refresh(); }, 250); };
let wired = false;
/** Olay bağları ve ilk yükleme (bir kez). */
export function ensureWorkZones(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  registerEventHandler("workzone.", soon);
  registerEventHandler("run.", (ev) => { if (ev.type !== "run.updated") soon(); });
  registerEventHandler("resync.", soon);
  registerEventHandler("scene.", soon);
  void useWorkZones.getState().refresh();
}

/** Ajanın şu anki bölgesi (süren koşudan; yoksa null) ve varsayılanı. */
export function useAgentZone(slug: string | null | undefined): { zone: string | null; run: string | null; def: string | null } {
  const active = useWorkZones((s) => s.active);
  const defaults = useWorkZones((s) => s.defaults);
  const agentDef = useStudio((s) => (slug ? (s.agents.find((a) => a.slug === slug) as { work_zone?: string } | undefined)?.work_zone ?? null : null));
  return useMemo(() => {
    const row = slug ? active.find((r) => r.agents.includes(slug)) : undefined;
    return { zone: row?.zone ?? null, run: row?.run_id ?? null, def: (slug && defaults[slug]) || agentDef || null };
  }, [active, defaults, agentDef, slug]);
}

/**
 * Dünya için: bu sahnede bölgede çalışacak ajanlar (süren koşular; ilk başlayan önce) ve dünyada kurulacak ofisler (süren
 * koşular + varsayılanlar + oturumda kurulmuş olanlar). `sig` değişmedikçe aynı nesneler.
 */
export function useZoneRequests(scene: string | null | undefined): { requests: ZoneRequest[]; zones: string[]; sig: string } {
  const active = useWorkZones((s) => s.active);
  const defaults = useWorkZones((s) => s.defaults);
  const sticky = useWorkZones((s) => (scene ? s.sticky[scene] : undefined));
  const sig = `${scene}|${active.map((r) => `${r.run_id}:${r.zone}:${r.agents.join(",")}`).join(";")}|${Object.entries(defaults).map(([k, v]) => `${k}=${v}`).join(",")}|${(sticky ?? []).join(",")}`;
  return useMemo(() => {
    const requests: ZoneRequest[] = [];
    const zones = new Set<string>(sticky ?? []);
    active.forEach((r, k) => {
      if (parseZone(r.zone)?.scene !== scene) return;
      zones.add(r.zone);
      for (const slug of r.agents) if (!requests.some((q) => q.slug === slug)) requests.push({ slug, zone: r.zone, order: k });
    });
    for (const z of Object.values(defaults)) if (parseZone(z)?.scene === scene) zones.add(z);
    return { requests, zones: [...zones].sort(), sig };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
}
