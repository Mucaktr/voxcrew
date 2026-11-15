// S40 — yönetici / test modu istemcisi. Derleme anı anahtarı brand.ts `adminModeAvailable` (brand.py ile aynı);
// false iken hiçbir istek gönderilmez, rozet ve Ayarlar bölümü çizilmez. Mod yalnızca kilitleri ATLAR: XP, jeton,
// envanter ve başarım yazılmaz. Simülasyon yardımcıları yalnızca bu tarayıcıdaki depolara olay verir (sunucuya yazmaz).
import { create } from "zustand";
import { useWorldTalk } from "../components/world/activity";
import { useAcademy } from "../full/data";
import { agentMood } from "./agents";
import { ApiError, bodyText } from "./api";
import { EDITION } from "../edition";
import { BRAND } from "./brand";
import { handleGameEvent, useGame } from "./game";
import { currentLocale } from "./i18n";
import { registerEventHandler, useStudio } from "./store";
import type { StudioEvent } from "./types";

// EDITION1: free sürümde /api/admin yok (404) — istek hiç gönderilmez, rozet ve bölüm çizilmez
export const ADMIN_MODE_AVAILABLE: boolean = BRAND.adminModeAvailable && (EDITION as string) !== "free";

export interface AdminStatus {
  available: boolean; active: boolean; setting: boolean; env: boolean; env_var: string; demo_agents: number;
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "X-Studio-Lang": currentLocale(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = bodyText(res.status, null);
    try {
      const j = await res.json();
      msg = bodyText(res.status, j);
    } catch { /* gövde yok */ }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const adminApi = {
  status: () => req<AdminStatus>("GET", "/api/admin/status"),
  setMode: (enabled: boolean) => req<AdminStatus & { scene_reset: string | null }>("PUT", "/api/admin/mode", { enabled }),
  seedDemo: (count: number) => req<AdminStatus & { created: string[] }>("POST", "/api/admin/demo-agents", { count, confirm: true }),
  removeDemo: () => req<AdminStatus & { removed: string[] }>("DELETE", "/api/admin/demo-agents?confirm=true"),
};

interface AdminStore {
  status: AdminStatus | null;
  load: () => Promise<void>;
  set: (s: AdminStatus) => void;
}

export const useAdmin = create<AdminStore>((set) => ({
  status: null,
  load: async () => {
    if (!ADMIN_MODE_AVAILABLE) return;
    try {
      set({ status: await adminApi.status() });
    } catch {
      set({ status: null }); // 404 (sunucuda kapalı) ya da bağlantı yok: arayüz hiçbir şey göstermez
    }
  },
  set: (status) => set({ status }),
}));

/** Rozet ve kilit seçicileri için: mod şu an açık mı (kullanılamıyorsa her zaman false). */
export function useAdminActive(): boolean {
  return useAdmin((s) => ADMIN_MODE_AVAILABLE && s.status?.active === true);
}

/** Mod ya da demo ajanlar değişti: durum, oyun profili (kilitler) ve ajan listesi tazelenir. */
function refreshAll() {
  void useAdmin.getState().load();
  void useGame.getState().refresh();
  void useStudio.getState().refreshAgents().catch(() => undefined);
}

let wired = false;
/** Olay bağı (bir kez): başka sekmede ya da ortam değişkeniyle değişen durum da görünsün. */
export function wireAdmin() {
  if (!ADMIN_MODE_AVAILABLE || wired) return;
  wired = true;
  registerEventHandler("admin.", refreshAll);
  void useAdmin.getState().load();
}

export async function setAdminMode(enabled: boolean): Promise<AdminStatus> {
  const st = await adminApi.setMode(enabled);
  useAdmin.getState().set(st);
  refreshAll();
  return st;
}

export async function seedDemoAgents(count: number): Promise<number> {
  const res = await adminApi.seedDemo(count);
  useAdmin.getState().set(res);
  refreshAll();
  return res.created.length;
}

export async function removeDemoAgents(): Promise<number> {
  const res = await adminApi.removeDemo();
  useAdmin.getState().set(res);
  refreshAll();
  return res.removed.length;
}

// ------------------------------------------------------------------ yerel olay simülasyonu (yalnızca görsel)
export type SimKind = "levelup" | "achievement" | "budget" | "interrupted" | "speech";
let simSeq = 0;

function fakeEvent(type: string, data: Record<string, unknown>): StudioEvent {
  return { seq: -(++simSeq), type, ts: Date.now() / 1000, ...data };
}

/** Örnek arayüz olayı gösterir. Sunucuya istek gitmez; oyun deposu yalnızca okumak için profili tazeleyebilir.
 *  Dönüş: "ok" | "need_agents" | "need_game". */
export function simulate(kind: SimKind, text: { achievementName: string; achievementText: string; speech: string }):
  "ok" | "need_agents" | "need_game" {
  const game = useGame.getState().profile;
  const gameVisible = !!game?.enabled && !game.focus;
  switch (kind) {
    case "levelup": {
      if (!gameVisible) return "need_game";
      const level = (game?.office?.level ?? 1) + 1;
      handleGameEvent(fakeEvent("game.levelup", { subject_type: "office", subject: "office", level, coins: 0 }));
      return "ok";
    }
    case "achievement":
      if (!gameVisible) return "need_game";
      handleGameEvent(fakeEvent("game.achievement", { achievement: "__test__", name: text.achievementName,
        description: text.achievementText, rarity: "epic", icon: "trophy", coins: 0, who: "" }));
      return "ok";
    case "budget":
    case "interrupted":
      // bilgi balonu doğrudan gösterilir: "görüldü" kaydı (tipSeen) sunucuya gönderilmez
      useAcademy.getState().setTip({ id: kind });
      return "ok";
    case "speech": {
      // dünyada uyuyan (beyni erişilemeyen) ajan konuşmaya katılmaz: yalnızca uyanık ajanlar seçilir
      const st = useStudio.getState();
      const agents = st.agents.filter((a) => !a.hidden && agentMood(a, st.states, st.connections) !== "offline");
      if (agents.length < 2) return "need_agents";
      const [a, b] = agents;
      useWorldTalk.setState((s) => ({ talks: [...s.talks, { key: `test:${Date.now()}:${++simSeq}`, from: a.slug, to: b.slug,
        text: text.speech, ts: Date.now() }].slice(-24) }));
      return "ok";
    }
  }
}
