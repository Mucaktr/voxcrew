// İlk kurulum sihirbazı (S8): açık/kapalı durumu ve sunucu ayarı yardımcıları.
// Görülme durumu sunucuda saklanır (settings.onboarding.completed); sihirbaz Ayarlar'dan yeniden açılır.
import { create } from "zustand";
import { tx } from "../../lib/i18n";
import { shell } from "../../locales/shell";
import { api } from "../../lib/api";
import type { Agent, ConnectionInfo, Settings } from "../../lib/types";

export interface OnboardingSettings {
  completed: boolean;
  starter_seeded: boolean;
  /** backend'in taze kurulumda oluşturduğu başlangıç ajanlarının slug'ları */
  starter_agents: string[];
}

export interface GamePrefs { enabled: boolean; celebrations: boolean; sounds: boolean; show_world_badges: boolean }
export interface TrackingPrefs {
  claude_code: { ingest_enabled: boolean; transcripts_enabled: boolean };
  codex: { ingest_enabled: boolean; transcripts_enabled: boolean };
}

/** /api/settings yanıtının sihirbazın kullandığı alanları (lib/types Settings'te henüz yok). */
export type WizardSettings = Settings & {
  onboarding?: OnboardingSettings;
  game?: GamePrefs;
  external?: { claude_code?: Partial<TrackingPrefs["claude_code"]>; codex?: Partial<TrackingPrefs["codex"]> };
};

interface OnboardingStore {
  open: boolean;
  /** bu oturumda sunucu ayarı denetlendi mi (otomatik açılış bir kez) */
  checked: boolean;
  show: () => void;
  hide: () => void;
  markChecked: () => void;
}

export const useOnboarding = create<OnboardingStore>((set) => ({
  open: false,
  checked: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  markChecked: () => set({ checked: true }),
}));

/** Ayarlar sayfasındaki "Sihirbazı yeniden aç" düğmesi için. */
export function openOnboarding() {
  useOnboarding.getState().show();
}

export async function loadWizardSettings(): Promise<WizardSettings> {
  return (await api.settings()) as WizardSettings;
}

/** Kısmi ayar kaydı (sunucu yalnızca bilinen anahtarları birleştirir). */
export function savePartialSettings(patch: Record<string, unknown>): Promise<WizardSettings> {
  return api.saveSettings(patch as Partial<Settings>) as Promise<WizardSettings>;
}

export function markOnboardingCompleted(): Promise<WizardSettings> {
  return savePartialSettings({ onboarding: { completed: true } });
}

// ------------------------------------------------------------------ beyin seçenekleri
export type BrainKind = "codex" | "claude" | "ollama" | "hermes";

export interface BrainOption {
  /** "codex" | "claude" | "ollama" | "hermes:<profil>" */
  value: string;
  label: string;
  kind: BrainKind;
  available: boolean;
}

export function connectionOf(conns: ConnectionInfo[], kind: ConnectionInfo["kind"]): ConnectionInfo | undefined {
  return conns.find((c) => c.kind === kind);
}

export function brainOptions(conns: ConnectionInfo[]): BrainOption[] {
  const ok = (k: ConnectionInfo["kind"]) => !!connectionOf(conns, k)?.available;
  const opts: BrainOption[] = [
    { value: "codex", label: "Codex", kind: "codex", available: ok("codex") },
    { value: "claude", label: "Claude Code", kind: "claude", available: ok("claude") },
    { value: "ollama", label: tx(shell, "ob_ollama_local"), kind: "ollama", available: ok("ollama") },
  ];
  const hermes = connectionOf(conns, "hermes");
  if (hermes?.available) {
    for (const p of ["default", ...(hermes.profiles ?? [])]) {
      opts.push({ value: `hermes:${p}`, label: `Hermes · ${p}`, kind: "hermes", available: true });
    }
  }
  return opts;
}

export function brainValueOf(agent: Agent): string {
  if (agent.needs_brain) return ""; // beyinsiz başlangıç ajanı — yer tutucu bağlantı seçili görünmez
  return agent.runtime === "hermes" ? `hermes:${agent.hermes_profile || "default"}` : agent.connection;
}

/** Seçilen beyin için ajan yaması (model boş: bağlantının varsayılanı kullanılır). */
export function brainPatch(value: string): Record<string, unknown> {
  if (value.startsWith("hermes:")) {
    return { runtime: "hermes", hermes_profile: value.slice("hermes:".length), connection: "profile", model: "" };
  }
  return { runtime: "direct", connection: value, model: "", hermes_profile: null };
}
