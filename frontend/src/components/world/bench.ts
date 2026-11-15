/**
 * Ölçüm düzeneği (S13, yalnızca geliştirme): `?bench=150&ext=30` ile sahte stüdyo ajanları, harici oturumlar ve
 * ekipler üretilir; durumlar birkaç saniyede bir değişir (yürüme, yazma, onay, teslim). Üretim derlemesinde etkisizdir
 * (`import.meta.env.DEV`). Veri sunucuya gitmez.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { ExternalAgent } from "../../lib/seamTypes";
import type { TeamInfo } from "../../lib/office";
import type { Agent, AgentState, Avatar, Mood } from "../../lib/types";
import { ACCENT_COLORS, FUR_TONES, HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES, SPECIES } from "../../voxel/avatar";

export interface BenchData {
  n: number;
  ext: number;
  agents: Agent[];
  externals: ExternalAgent[];
  teams: TeamInfo[];
  states: Record<string, AgentState>;
  moods: Record<string, Mood>;
}

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["Ada", "Baran", "Ceren", "Deniz", "Ela", "Ferhat", "Gizem", "Hakan", "Irmak", "Kaan", "Lale", "Mert", "Nehir", "Onur", "Pelin",
  "Rüzgâr", "Selin", "Tolga", "Umut", "Yasemin", "Zeynep", "Arda", "Bora", "Cem", "Derya", "Ege", "Fulya", "Gökçe", "Hale", "İlke"];
const TITLES = ["Analist", "Uzman", "Kıdemli Uzman", "Lider", "Stajyer", "Araştırmacı", "Tasarımcı", "Yazar", "Mühendis", "Editör"];
const TEAM_NAMES = ["Araştırma", "Yazılım", "Tasarım", "Pazarlama", "Satış", "Veri", "Destek", "Ürün", "Finans", "Operasyon", "Hukuk", "İK"];
const TEAM_COLORS = ["#7C5CFF", "#3B82F6", "#EF4444", "#F59E0B", "#10B981", "#EC4899", "#14B8A6", "#64748B", "#8B5CF6", "#F97316", "#06B6D4", "#84CC16"];
const HAIRS: Avatar["hair"][] = ["short", "long", "bob", "curly", "bun", "ponytail", "spiky", "mohawk", "bald"];
const BEARDS: Avatar["beard"][] = ["none", "stubble", "full", "goatee", "mustache"];
const OUTFITS: Avatar["outfit"][] = ["tshirt", "hoodie", "suit", "sweater", "labcoat", "dress", "overalls", "hawaii"];
const GLASSES: Avatar["glasses"][] = ["none", "round", "square", "sun", "star"];
const HATS: Avatar["hat"][] = ["none", "cap", "beanie", "beret", "straw", "tophat", "headphones", "crown", "party"];
const TOOLS = ["web_search", "read_file", "bash", "todo_plan", "write_file", null, null];
const ACTIVITIES = ["Düşünüyor…", "Yazıyor…", "Sonucu inceliyor", "Belleğe bakıyor", ""];

function makeAvatar(r: () => number): Avatar {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const sp = pick(SPECIES);
  const human = sp.id === "human";
  return {
    species: sp.id, skin: human ? pick(SKIN_TONES) : r() < 0.6 ? sp.fur : pick(FUR_TONES),
    hair: human ? pick(HAIRS) : "none", hairColor: pick(HAIR_COLORS), beard: human && r() < 0.35 ? pick(BEARDS.slice(1)) : "none",
    outfit: pick(OUTFITS), outfitColor: pick(OUTFIT_COLORS), accent: pick(ACCENT_COLORS),
    glasses: r() < 0.4 ? pick(GLASSES.slice(1)) : "none", hat: r() < 0.55 ? pick(HATS.slice(1)) : "none",
  };
}

function build(n: number, ext: number): Omit<BenchData, "states" | "moods"> {
  const r = rng(1234 + n);
  const teamCount = Math.max(1, Math.min(TEAM_NAMES.length, Math.round(n / 12)));
  const teams: TeamInfo[] = Array.from({ length: teamCount }, (_, i) => ({
    slug: `bench-team-${i}`, name: TEAM_NAMES[i], mission: "", color: TEAM_COLORS[i % TEAM_COLORS.length], icon: "users", lead: `bench-${i * Math.floor(n / teamCount)}`,
    order: i, members: [],
  }));
  const agents: Agent[] = Array.from({ length: n }, (_, i) => {
    const team = teams[Math.min(teamCount - 1, Math.floor(i / (n / teamCount)))];
    const slug = `bench-${i}`;
    team.members.push(slug);
    return {
      id: slug, slug, name: `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`, role: "test", persona: "", color: TEAM_COLORS[(i * 7) % TEAM_COLORS.length],
      avatar: makeAvatar(r), runtime: "direct", connection: "ollama", model: "test", permissions: "read", memory_scope: "shared", memory_enabled: true,
      hidden: false, created_by: "studio", route: { connector: "ollama", connection: "ollama", label: "test" }, route_error: null,
      state: { state: "idle", activity: "" }, team: team.slug, title: TITLES[i % TITLES.length], rank: i % 12 === 0 ? "lead" : "specialist",
    };
  });
  const externals: ExternalAgent[] = Array.from({ length: ext }, (_, i) => ({
    id: `bench-ext-${i}`, source: i % 3 === 0 ? "codex" : "claude-code", title: `Oturum ${i + 1}`, projectKey: `proje-${i % 9}`, projectName: `Proje ${i % 9}`,
    status: i % 4 === 0 ? "active" : i % 7 === 0 ? "waiting" : "idle", activity: i % 4 === 0 ? "Bash çalıştırıyor" : null, tool: i % 4 === 0 ? "Bash" : null,
    parent: i % 5 === 4 ? `bench-ext-${i - 1}` : null, isSubagent: i % 5 === 4, startedAt: new Date(Date.now() - i * 60000).toISOString(), lastEventAt: null,
  }));
  return { n, ext, agents, externals, teams };
}

const MOOD_MIX: Mood[] = ["idle", "idle", "idle", "idle", "idle", "working", "working", "thinking", "waiting", "done", "error", "offline"];

/** `?bench=N` (geliştirme) → sahte veri; yoksa null. */
export function useBench(): BenchData | null {
  const { search } = useLocation();
  const cfg = useMemo(() => {
    if (!import.meta.env.DEV) return null;
    const p = new URLSearchParams(search);
    const n = Number(p.get("bench"));
    if (!Number.isFinite(n) || n <= 0) return null;
    const ext = p.has("ext") ? Math.max(0, Number(p.get("ext")) || 0) : 30;
    return build(Math.min(600, Math.floor(n)), Math.min(200, ext));
  }, [search]);
  const [live, setLive] = useState<{ states: Record<string, AgentState>; moods: Record<string, Mood> }>({ states: {}, moods: {} });
  useEffect(() => {
    if (!cfg) return;
    const r = rng(99);
    const states: Record<string, AgentState> = {};
    const moods: Record<string, Mood> = {};
    const roll = (slug: string) => {
      const mood = MOOD_MIX[Math.floor(r() * MOOD_MIX.length)];
      const tool = mood === "working" ? TOOLS[Math.floor(r() * TOOLS.length)] : null;
      moods[slug] = mood;
      states[slug] = { state: mood, activity: mood === "working" || mood === "thinking" ? ACTIVITIES[Math.floor(r() * ACTIVITIES.length)] : "", tool, since: Date.now() / 1000 - r() * 300 };
    };
    for (const a of cfg.agents) roll(a.slug);
    setLive({ states: { ...states }, moods: { ...moods } });
    // her 2,5 sn'de ajanların ~%6'sı durum değiştirir (yürüme/animasyon/yol bulma yükü)
    const id = window.setInterval(() => {
      const k = Math.max(1, Math.round(cfg.agents.length * 0.06));
      for (let i = 0; i < k; i++) roll(cfg.agents[Math.floor(r() * cfg.agents.length)].slug);
      setLive({ states: { ...states }, moods: { ...moods } });
    }, 2500);
    return () => window.clearInterval(id);
  }, [cfg]);
  return useMemo(() => (cfg ? { ...cfg, states: live.states, moods: live.moods } : null), [cfg, live]);
}
