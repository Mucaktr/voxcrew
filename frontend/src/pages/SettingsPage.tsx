// UXF-E: uygulama ayarları (dil, bellek, Ollama, çalıştırma, sihirbaz, yönetici modu, güvenli mod) Bağlantılar sayfasının
// 36 başlıklık dibindeydi ve menüde "Ayarlar" adı yoktu → kendi sayfası (`/ayarlar`) ve menü öğesi. Eski `/baglantilar#ayarlar` derin
// bağlantısı buraya yönlenir (ConnectionsPage). Güvenli mod modellerle birlikte kalır (Bağlantılar › Güvenlik) ve burada da çizilir.
import { Languages, Palette, Save, Wand2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useLocation } from "react-router-dom";
import { AdminPanel } from "../components/admin/AdminPanel";
import { SafeModePanel } from "../components/safety/SafeModePanel";
import { openOnboarding } from "../components/onboarding/onboarding";
import { AcademySettingsRow, RecognitionSettingsRow, TelemetrySettingsRow } from "../full/ui";
import { StepCapSettingsRow } from "../components/runs/StepCapSettingsRow";
import { PromotionsSettingsRow } from "../full/account"; // "Tanıtımları gösterme" (bulut hesabı; free sürümde yok)
import { Badge, Button, Field, PageHeader, Panel, SectionTitle, Segmented, Spinner, Toggle } from "../components/ui";
import { api } from "../lib/api";
import { NUM_LIMITS, numOk, parseNum, type NumKey } from "../lib/settingsLimits";
import { brainLabel } from "../lib/brainLabel";
import { currentLocale, fmtNumber, useLocale, useT, type LangPref } from "../lib/i18n";
import { useStudio } from "../lib/store";
import { applyTheme, useThemePref, type ThemePref } from "../lib/theme";
import type { Settings } from "../lib/types";
import { settingsMsg } from "../locales/settings";

export default function SettingsPage() {
  const t = useT(settingsMsg);
  const { hash } = useLocation();
  // derin bağlantı (`/ayarlar#takdir-ayarlari`): panel yüklenince ilgili satıra kaydır
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1));
    if (!id) return;
    const tm = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 400);
    return () => window.clearTimeout(tm);
  }, [hash]);
  return (
    <div className="p-3 sm:p-5 flex flex-col gap-4 max-w-[1500px] mx-auto">
      <PageHeader title={t("title")} subtitle={t("page_subtitle")} />
      <SettingsPanel />
      <SafeModePanel />
      <AdminPanel />
    </div>
  );
}

type AgentLang = "ui" | "tr" | "en";

/** Arayüz dili (ui.language: auto | tr | en) ve ajanların yanıt dili (agents.language: ui | tr | en). Seçim anında
 *  kaydedilir; arayüz dili yerelde hemen uygulanır (App içeriği yeniden bağlanır). */
function LanguageSettings({ agentLang, onAgentLang }: { agentLang: AgentLang; onAgentLang: (v: AgentLang) => void }) {
  const t = useT(settingsMsg);
  const pref = useLocale((s) => s.pref);
  const setPref = useLocale((s) => s.setPref);
  const uiId = useId();
  const agId = useId();
  const [error, setError] = useState<string | null>(null);
  const saveUi = (v: LangPref) => {
    setError(null);
    setPref(v);
    void api.saveSettings({ ui: { language: v } }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  const saveAgents = async (v: AgentLang) => {
    setError(null);
    try {
      const next = await api.saveSettings({ agents: { language: v } });
      onAgentLang(next.agents?.language ?? v);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="mt-5 pt-4 border-t-2 border-line-soft flex flex-col gap-3">
      <SectionTitle as="h3" size="sm" icon={<Languages size={16} aria-hidden />}>{t("lang")}</SectionTitle>
      <div className="grid gap-5 lg:grid-cols-2">
        <Field label={<span id={uiId}>{t("lang_ui")}</span>} hint={t("lang_ui_hint")}>
          <div role="group" aria-labelledby={uiId}>
            <Segmented value={pref} onChange={saveUi} className="flex-wrap" options={[
              { value: "auto", label: t("lang_auto") }, { value: "tr", label: "Türkçe" }, { value: "en", label: "English" },
            ]} />
          </div>
        </Field>
        <Field label={<span id={agId}>{t("lang_agents")}</span>} hint={t("lang_agents_hint")}>
          <div role="group" aria-labelledby={agId}>
            <Segmented value={agentLang} onChange={(v) => { void saveAgents(v); }} className="flex-wrap" options={[
              { value: "ui", label: t("lang_agents_ui") }, { value: "tr", label: "Türkçe" }, { value: "en", label: "English" },
            ]} />
          </div>
        </Field>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{t("lang_error", { error })}</p>}
    </div>
  );
}

/** Görünüm — Sistem / Açık / Koyu; yan menü anahtarıyla aynı tercih (`lib/theme.ts`), anında uygulanır.*/
function AppearanceSettings() {
  const t = useT(settingsMsg);
  const theme = useThemePref();
  const id = useId();
  return (
    <div id="gorunum" className="mt-5 pt-4 border-t-2 border-line-soft flex flex-col gap-3">
      <SectionTitle as="h3" size="sm" icon={<Palette size={16} aria-hidden />}>{t("appearance")}</SectionTitle>
      <Field label={<span id={id}>{t("appearance_theme")}</span>} hint={t("appearance_hint")}>
        <div role="group" aria-labelledby={id}>
          <Segmented<ThemePref> value={theme} onChange={applyTheme} className="flex-wrap" options={[
            { value: "system", label: t("theme_system") }, { value: "light", label: t("theme_light") }, { value: "dark", label: t("theme_dark") },
          ]} />
        </div>
      </Field>
    </div>
  );
}

function SettingsPanel() {
  const t = useT(settingsMsg);
  const models = useStudio((s) => s.models);
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => { api.settings().then(setS); }, []);
  if (!s) return <Panel title={t("title")}><Spinner /></Panel>;
  const set = (fn: (x: Settings) => void) => { setS((cur) => { if (!cur) return cur; const c = structuredClone(cur); fn(c); return c; }); setSaved(false); setSaveError(null); };
  // Yalnızca bu panelin alanları gönderilir: sahne, oyunlaştırma, izleme ve sihirbaz durumu başka yerlerde değişir;
  // açılışta alınmış eski bir kopya onları geri almasın.
  // geçersiz sayı kaydedilmez; alan işaretlenir, ileti yazılır, "kaydedildi" çıkmaz
  const bad: Record<string, boolean> = {
    num_ctx: !numOk("num_ctx", s.ollama.num_ctx), max_turns: !numOk("max_turns", s.max_turns),
    step_timeout_min: !numOk("step_timeout_min", s.step_timeout_min),
    concurrency: Object.values(s.concurrency).some((v) => !numOk("concurrency", v)),
  };
  const anyBad = Object.values(bad).some(Boolean);
  const save = async () => {
    setSaveError(null);
    if (anyBad) { setSaveError(t("num_invalid")); return; }
    const { memory, ollama, concurrency, workdir, max_turns, step_timeout_min, codex_hermes_model } = s;
    try {
      setS(await api.saveSettings({ memory, ollama, concurrency, workdir, max_turns, step_timeout_min, codex_hermes_model }));
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };
  const numProps = (key: NumKey, name: string) => ({
    min: NUM_LIMITS[key].min, max: NUM_LIMITS[key].max, step: 1, "aria-invalid": bad[name] || undefined,
  });
  return (
    <Panel title={t("title")} actions={<>
      {saved && <Badge tone="ok">{t("saved")}</Badge>}
      <Button size="sm" variant="primary" icon={<Save size={14} />} onClick={save}>{t("save")}</Button></>}>
      {saveError && <p className="text-sm font-semibold text-bad mb-3" role="alert">{saveError}</p>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-4">
          <SectionTitle as="h3" size="sm">{t("memory")}</SectionTitle>
          <Toggle checked={s.memory.recall} onChange={(v) => set((x) => { x.memory.recall = v; })} label={t("recall")} />
          <Field label={t("extractor")} hint={t("extractor_hint")}>
            <Segmented value={s.memory.extractor} onChange={(v) => set((x) => { x.memory.extractor = v; })}
              options={[{ value: "auto", label: t("extractor_auto") }, { value: "llm", label: "LLM" }, { value: "heuristic", label: t("extractor_heuristic") }]} />
          </Field>
          <Field label={t("extractor_model")}>
            <select className="select" value={s.memory.extractor_model} onChange={(e) => set((x) => { x.memory.extractor_model = e.target.value; })}>
              {models.filter((m) => m.local).map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          </Field>
          <Field label={<>{t("budget_a")}<span className="num">{fmtNumber(s.memory.budget_chars)}</span>{t("budget_b")}</>}>
            <input type="range" min={600} max={6000} step={200} value={s.memory.budget_chars} onChange={(e) => set((x) => { x.memory.budget_chars = Number(e.target.value); })} />
          </Field>
        </div>
        <div className="flex flex-col gap-4">
          <SectionTitle as="h3" size="sm">{t("ollama")}</SectionTitle>
          <Field label={t("num_ctx")}>
            <input className="input" type="number" {...numProps("num_ctx", "num_ctx")} value={Number.isNaN(s.ollama.num_ctx) ? "" : s.ollama.num_ctx} onChange={(e) => set((x) => { x.ollama.num_ctx = parseNum(e.target.value); })} />
          </Field>
          <Toggle checked={s.ollama.think} onChange={(v) => set((x) => { x.ollama.think = v; })} label={t("think")}
            hint={t("think_hint")} />
          <Field label={t("concurrency")} hint={t("concurrency_hint")}>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(s.concurrency).map(([k, v]) => (
                <label key={k} className="flex flex-col gap-1 text-xs font-semibold text-muted min-w-0 break-words">{brainLabel(k, currentLocale())}
                  <input className="input !px-2" type="number" {...numProps("concurrency", "concurrency")} value={Number.isNaN(v) ? "" : v} onChange={(e) => set((x) => { x.concurrency[k] = parseNum(e.target.value); })} />
                </label>
              ))}
            </div>
          </Field>
        </div>
        <div className="flex flex-col gap-4">
          <SectionTitle as="h3" size="sm">{t("running")}</SectionTitle>
          <Field label={t("workdir")} hint={t("workdir_hint")}>
            <input className="input font-mono !text-xs" value={s.workdir} onChange={(e) => set((x) => { x.workdir = e.target.value; })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("max_turns")}><input className="input" type="number" {...numProps("max_turns", "max_turns")} value={Number.isNaN(s.max_turns) ? "" : s.max_turns} onChange={(e) => set((x) => { x.max_turns = parseNum(e.target.value); })} /></Field>
            <Field label={t("step_timeout")}><input className="input" type="number" {...numProps("step_timeout_min", "step_timeout_min")} value={Number.isNaN(s.step_timeout_min) ? "" : s.step_timeout_min} onChange={(e) => set((x) => { x.step_timeout_min = parseNum(e.target.value); })} /></Field>
          </div>
          <Field label={t("codex_hermes_model")}>
            <input className="input font-mono" value={s.codex_hermes_model} onChange={(e) => set((x) => { x.codex_hermes_model = e.target.value; })} />
          </Field>
          <p className="text-xs text-muted">{t("concurrency_restart")}</p>
        </div>
      </div>
      <AppearanceSettings />
      <LanguageSettings agentLang={s.agents?.language ?? "ui"}
        onAgentLang={(v) => setS((cur) => (cur ? { ...cur, agents: { language: v } } : cur))} />
      <div className="mt-5 pt-4 border-t-2 border-line-soft flex flex-wrap items-center gap-3">
        <Wand2 size={18} className="shrink-0 text-ink-2" aria-hidden />
        <div className="flex-1 min-w-[min(100%,240px)]">
          <SectionTitle as="h3" size="sm">{t("wizard")}</SectionTitle>
          <p className="text-xs text-muted mt-0.5">{t("wizard_text")}</p>
        </div>
        <Button size="sm" onClick={openOnboarding}>{t("wizard_open")}</Button>
      </div>
      <AcademySettingsRow />
      <RecognitionSettingsRow />
      <StepCapSettingsRow />
      <PromotionsSettingsRow />
      <TelemetrySettingsRow /> {/* G7: Gizlilik ve kullanım verisi (açık rıza, önizleme, geri alma) */}
    </Panel>
  );
}
