// İlk kurulum sihirbazı (S8; S29: gerçek bağlantı sihirbazı + "İlk görevini ver").
// ilk oturum ( A1): yaş beyanı → araçlar (bağlantı) → İkili ofis → ilk görev/tarif; sahne,
// tercihler ve Claude/Codex adımları sonra gelir (isteğe bağlı). Teslim kabulüne kadarki ilerleme dünyadaki
// "İlk mesai" kartında (components/game/FirstSessionCard) izlenir.
// Taze kurulumda bir kez kendiliğinden açılır; kapatılınca "tamamlandı" sayılır ve Bağlantılar → Ayarlar'dan
// yeniden açılır. Kullanıcı dosyalarına yazmaz: yalnızca stüdyo ayarları (/api/settings) ve ajan kayıtları değişir.
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Cable, Check } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BRAND } from "../../lib/brand";
import { useT } from "../../lib/i18n";
import { cx } from "../../locales/connections";
import { shell } from "../../locales/shell";
import { ConnectionWizard } from "../connections/ConnectionWizard";
// PANO-FIX "İlk görev" adımı (Markdown önizlemesi, react-markdown) yalnız o adımda yüklenir; sihirbaz her sayfada
// bağlandığı için eskiden her açılışta indirilip çalıştırılıyordu
const FirstTask = lazy(() => import("../connections/FirstTask").then((m) => ({ default: m.FirstTask })));
import { useStudio } from "../../lib/store";
import { Button, dialogFocusLost, Modal, Spinner, Toggle } from "../ui";
import { StarterTeam } from "./StarterTeam";
import { IkiliOffice } from "./IkiliOffice"; // Free'nin ilk oturumu için İkili ofis
import { resetFirstTaskMemo } from "../connections/firstTaskMemo"; // UXF-G: İlk görev adımı durumu açılışta sıfırlanır
import { loopApi } from "../../lib/loop";
import { loopMsg } from "../../locales/loop";
import { AcademyCallout, StarterRecipe } from "../../full/ui"; // ilk gerçek iş olarak tarif, akademi çağrısı (ücretli sürüm)
import { needsAgeDialog, useSafeMode, wireSafeMode } from "../../lib/safeMode"; // TRUST: yerel 18+ beyanı
import { AgeDialog, MinorNotice } from "./AgeGate";
// DASH-MVP "Nasıl çalışmak istersin?" (Dünya Görünümü / Pano Görünümü); Pano seçilince sahne adımı atlanır
import { ModeStep } from "../board/ModeStep";
import { useMode } from "../../lib/uiMode";
import { viewMsg } from "../../locales/view";
import {
  loadWizardSettings, markOnboardingCompleted, savePartialSettings, useOnboarding,
  type GamePrefs, type TrackingPrefs, type WizardSettings,
} from "./onboarding";

const STEPS = [
  { id: "tools", key: "step_tools" },
  { id: "mode", key: "step_tools" }, // etiket viewMsg.wiz_step (aşağıda)
  { id: "team", key: "step_team" },
  { id: "first", key: "step_first" },
  { id: "scene", key: "step_scene" },
  { id: "prefs", key: "step_prefs" },
  { id: "connect", key: "step_connect" },
] as const;
type StepId = (typeof STEPS)[number]["id"];
const NO_SLUGS: string[] = [];

// S29: "Araçlar" adımı gerçek bağlantı sihirbazıdır (Bağlantılar sayfasıyla aynı kartlar, tek birincil eylem,
// açılışta ve her eylemden sonra otomatik tarama, "Hepsini otomatik kur").
function ToolsStep() {
  return <ConnectionWizard compact kinds={["ollama", "codex", "claude", "hermes", "openai_compat"]} />;
}

// BUNDLE: sahne adımı tüm sahne kataloğunu (voxel/scenes) çeker; sihirbaz her sayfada bağlandığı için tembel yüklenir
const SceneStep = lazy(() => import("./SceneStep").then((m) => ({ default: m.SceneStep })));

const DEFAULT_GAME: GamePrefs = { enabled: true, celebrations: true, sounds: true, show_world_badges: true };
const DEFAULT_TRACKING: TrackingPrefs = {
  claude_code: { ingest_enabled: true, transcripts_enabled: false },
  codex: { ingest_enabled: true, transcripts_enabled: false },
};

function PrefsStep({ settings, onSaved }: { settings: WizardSettings | null; onSaved: (s: WizardSettings) => void }) {
  const game: GamePrefs = { ...DEFAULT_GAME, ...settings?.game };
  const tracking: TrackingPrefs = {
    claude_code: { ...DEFAULT_TRACKING.claude_code, ...settings?.external?.claude_code },
    codex: { ...DEFAULT_TRACKING.codex, ...settings?.external?.codex },
  };
  const [error, setError] = useState<string | null>(null);
  const t = useT(shell);
  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    try { onSaved(await savePartialSettings(patch)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const setGame = (k: keyof GamePrefs, v: boolean) => save({ game: { [k]: v } });
  const setTrack = (src: keyof TrackingPrefs, k: keyof TrackingPrefs["claude_code"], v: boolean) =>
    save({ external: { [src]: { [k]: v } } });

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <section className="flex flex-col gap-3" aria-labelledby="ob-game">
        <h3 id="ob-game" className="panel-title">{t("ob_game")}</h3>
        <Toggle checked={game.enabled} onChange={(v) => { void setGame("enabled", v); }} label={t("ob_game_xp")}
          hint={t("ob_game_xp_hint")} />
        <Toggle checked={game.celebrations} onChange={(v) => { void setGame("celebrations", v); }} label={t("ob_celebrations")}
          hint={t("ob_celebrations_hint")} />
        <Toggle checked={game.show_world_badges} onChange={(v) => { void setGame("show_world_badges", v); }}
          label={t("ob_badges")} />
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="ob-track">
        <h3 id="ob-track" className="panel-title">{t("ob_tracking")}</h3>
        <Toggle checked={tracking.claude_code.ingest_enabled}
          onChange={(v) => { void setTrack("claude_code", "ingest_enabled", v); }}
          label={t("ob_track_claude")} hint={t("ob_track_claude_hint")} />
        <Toggle checked={tracking.codex.ingest_enabled} onChange={(v) => { void setTrack("codex", "ingest_enabled", v); }}
          label={t("ob_track_codex")} hint={t("ob_track_codex_hint")} />
        <Toggle checked={tracking.claude_code.transcripts_enabled || tracking.codex.transcripts_enabled}
          onChange={(v) => { void save({ external: { claude_code: { transcripts_enabled: v }, codex: { transcripts_enabled: v } } }); }}
          label={t("ob_transcripts")}
          hint={t("ob_transcripts_hint")} />
      </section>
      {error && <p role="alert" className="text-sm text-bad md:col-span-2">{error}</p>}
    </div>
  );
}

function ConnectStep({ onNavigate }: { onNavigate: (to: string) => void }) {
  const t = useT(shell);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        {t("ob_connect_intro", { brand: BRAND.name })}
      </p>
      <div className="panel-soft p-3 flex flex-wrap items-center gap-3">
        <Cable size={18} className="shrink-0 text-ink-2" aria-hidden />
        <p className="text-sm text-ink-2 flex-1 min-w-[min(100%,220px)]">
          {t("ob_connect_cmds")}
        </p>
        <Button size="sm" variant="primary" onClick={() => onNavigate("/baglan")}>{t("ob_connect_open")}</Button>
      </div>
      <p className="text-xs text-muted">
        {t("ob_reopen")}
      </p>
    </div>
  );
}

// "Ekip" adımı — önce İkili ofis (iki koltuk dolu başlar), başlangıç ajanlarını düzenleme katlanır bölümde.
function TeamStep({ starterSlugs, onNavigate, office, onOffice, onPending, nag }:
  { starterSlugs: string[]; onNavigate: () => void; office: string | null; onOffice: (id: string) => void;
    onPending: (pending: boolean) => void; nag: number }) {
  const t = useT(loopMsg);
  return (
    <div className="flex flex-col gap-4">
      <IkiliOffice current={office} onInstalled={(r) => onOffice(r.template)} onPending={onPending} nag={nag} />
      <details className="panel-soft p-3">
        <summary className="cursor-pointer text-sm font-semibold">{t("ik_customize")}</summary>
        <div className="mt-3"><StarterTeam starterSlugs={starterSlugs} onNavigate={onNavigate} /></div>
      </details>
    </div>
  );
}

// İkili ofis kurulduysa ilk iş olarak ofisin kendi akışı da önerilir (FirstTask ve tarif yanında).
function OfficeFlowCallout({ office, onNavigate }: { office: string | null; onNavigate: (to: string) => void }) {
  const t = useT(loopMsg);
  if (!office || !office.startsWith("ikili-")) return null;
  return (
    <div className="panel-soft p-3 flex flex-wrap items-center gap-3">
      <p className="text-sm text-ink-2 flex-1 min-w-[min(100%,220px)]">{t("fs_hint_task")}</p>
      <Button size="sm" onClick={() => onNavigate(`/akislar/${encodeURIComponent(office)}`)}>{t("fs_cta_flow")}</Button>
    </div>
  );
}

// ------------------------------------------------------------------ sihirbaz
export function OnboardingWizard() {
  const open = useOnboarding((s) => s.open);
  const checked = useOnboarding((s) => s.checked);
  const loaded = useStudio((s) => s.loaded);
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<WizardSettings | null>(null);
  const [office, setOffice] = useState<string | null>(null); // seçilen İkili ofis (ilk oturum durumu)
  const heading = useRef<HTMLHeadingElement>(null);
  // UXF-A: "Bu ofisi kur" onay bekliyorken İleri/Geri/adım çipi/kapat onayı sessizce düşürmez — uyarı + odak onaya
  const [officePending, setOfficePending] = useState(false);
  const [officeNag, setOfficeNag] = useState(0);
  const guard = (leave: () => void) => { if (officePending) setOfficeNag((n) => n + 1); else leave(); };
  // TRUST (S2): yaş beyanı yoksa sihirbazın ilk ekranı kapatılamayan beyan diyaloğudur; kurulumu daha önce bitmiş
  // kurulumlara bir kez sorulur. Telemetri ya da başka bir rıza sorusu yoktur; eklenirse bu beyandan SONRA gelmeli.
  const safeLoaded = useSafeMode((s) => s.status !== null);
  const age = useSafeMode((s) => s.status?.age ?? null);
  const [minorNote, setMinorNote] = useState(false);
  useEffect(() => { if (loaded) wireSafeMode(); }, [loaded]);
  // durum yüklenemezse (ağ hatası, yavaş sunucu) yeniden dene; bu arada sihirbaz beyanı ATLAMAZ
  useEffect(() => {
    if (!loaded || safeLoaded) return;
    const id = window.setInterval(() => { void useSafeMode.getState().load(); }, 3000);
    return () => window.clearInterval(id);
  }, [loaded, safeLoaded]);

  // Taze kurulumda bir kez kendiliğinden aç (sunucu ayarı: onboarding.completed)
  useEffect(() => {
    if (!loaded || checked) return;
    useOnboarding.getState().markChecked();
    loadWizardSettings().then((s) => {
      setSettings(s);
      if (!s.onboarding?.completed) {
        useOnboarding.getState().show();
        void loopApi.firstSession().catch(() => undefined); // ilk oturum saatini başlat (yalnız yerel)
      }
    }).catch(() => undefined);
  }, [loaded, checked]);

  // Açılınca ilk adımdan başla, ayarları tazele (başlangıç ekibi listesi için)
  useEffect(() => {
    if (!open) return;
    setStep(0);
    resetFirstTaskMemo(); // UXF-G
    loadWizardSettings().then(setSettings).catch(() => undefined);
    loopApi.firstSession().then((f) => setOffice(f.office)).catch(() => undefined);
    void useStudio.getState().refreshAgents().catch(() => undefined);
  }, [open]);

  useEffect(() => { if (open) heading.current?.focus(); }, [open, step]);

  const close = useCallback(() => {
    useOnboarding.getState().hide();
    void markOnboardingCompleted().catch(() => undefined);
    // Bitir/Atla sonrası odak `body`'de kalmaz — sayfanın ana eylemine ("Yürü"), yoksa ana içeriğe
    window.setTimeout(() => {
      const a = document.activeElement;
      if (!dialogFocusLost(a, document.body) && a?.id !== "icerik") return;
      (document.querySelector<HTMLElement>("[data-wizard-return]:not([disabled])") ?? document.getElementById("icerik"))?.focus({ preventScroll: true });
    }, 60);
  }, []);
  const tryClose = useCallback(() => { if (officePending) setOfficeNag((n) => n + 1); else close(); }, [officePending, close]);
  const go = useCallback((to: string) => { close(); navigate(to); }, [close, navigate]);

  const t = useT(cx);
  const ts = useT(shell);
  const tv = useT(viewMsg);
  const mode = useMode();
  // Pano Görünümünde dünya sahnesi seçilmez: sahne adımı listeden çıkar (mod adımı sahneden önce geldiği için sıra kaymaz)
  const steps = STEPS.filter((s) => !(s.id === "scene" && mode === "board"));
  const current: StepId = (steps[step] ?? steps[steps.length - 1]).id;
  const last = step >= steps.length - 1;
  const titles: Record<StepId, string> = {
    tools: t("welcome", { brand: BRAND.name }),
    mode: tv("wiz_title"),
    scene: ts("ob_scene_title"),
    team: ts("ob_team_title"),
    prefs: ts("ob_prefs_title"),
    connect: ts("ob_connect_title"),
    first: t("first_title"),
  };

  if (minorNote) return <MinorNotice onClose={() => setMinorNote(false)} />;
  // kapı kapalı başarısız olur — sihirbaz açıkken güvenli mod durumu henüz yüklenmediyse de beyan diyaloğu
  // gösterilir (normal sihirbaz ve "Atla" beyan olmadan hiç görünmez); eski kurulum yolu durumu bilince sorar.
  if (loaded && !age && ((open && !safeLoaded) || (safeLoaded && (open || needsAgeDialog(settings?.onboarding?.completed, age))))) {
    return <AgeDialog legacy={!open} onAnswered={(adult) => { if (!adult) setMinorNote(true); }} />;
  }

  return (
    <Modal open={open} onClose={tryClose} width={760} title={ts("ob_title", { brand: BRAND.name })}
      footer={<>
        <Button variant="ghost" className="mr-auto" onClick={tryClose}>{ts("ob_skip")}</Button>
        {step > 0 && <Button icon={<ArrowLeft size={15} />} onClick={() => guard(() => setStep((s) => s - 1))}>{ts("ob_back")}</Button>}
        {last
          ? <Button variant="primary" icon={<Check size={15} />} onClick={tryClose}>{ts("ob_finish")}</Button>
          : <Button variant="primary" onClick={() => guard(() => setStep((s) => s + 1))}>{ts("ob_next")} <ArrowRight size={15} aria-hidden /></Button>}
      </>}>
      {/* S39: adımlar arasında pencere yüksekliği sabit kalsın — "İleri" düğmesi her adımda yer değiştirmesin */}
      <div className="flex flex-col gap-4 sm:min-h-[min(62vh,560px)]">
        <ol className="flex flex-wrap gap-1.5" aria-label={ts("ob_steps")}>
          {steps.map((s, i) => (
            <li key={s.id}>
              <button type="button" onClick={() => { if (i !== step) guard(() => setStep(i)); }} aria-current={i === step ? "step" : undefined}
                className={clsx("chip !gap-1.5 max-sm:min-h-11 max-sm:min-w-11 max-sm:justify-center", i === step ? "tone-info" : i < step ? "tone-ok" : "tone-muted")}>
                <span className="num">{i + 1}</span>
                <span className={clsx(i !== step && "hidden sm:inline")}>{s.id === "mode" ? tv("wiz_step") : t(s.key)}</span>
                {i !== step && <span className="sr-only sm:hidden">{s.id === "mode" ? tv("wiz_step") : t(s.key)}</span>}
              </button>
            </li>
          ))}
        </ol>
        <h3 ref={heading} tabIndex={-1} className="t-h4 focus:outline-none">{titles[current]}</h3>
        {current === "tools" && <ToolsStep />}
        {current === "mode" && <ModeStep />}
        {current === "scene" && <Suspense fallback={<div className="py-6 grid place-items-center"><Spinner size={20} /></div>}><SceneStep /></Suspense>}
        {current === "team" && (
          <TeamStep starterSlugs={settings?.onboarding?.starter_agents ?? NO_SLUGS} onNavigate={close}
            office={office} onOffice={setOffice} onPending={setOfficePending} nag={officeNag} />
        )}
        {current === "prefs" && <PrefsStep settings={settings} onSaved={setSettings} />}
        {current === "connect" && <ConnectStep onNavigate={go} />}
        {current === "first" && (
          <Suspense fallback={<Spinner size={20} />}><FirstTask onOpenRun={(id) => go(`/gorevler/${id}`)} onFixConnections={() => setStep(0)} /></Suspense>
        )}
        {current === "first" && <OfficeFlowCallout office={office} onNavigate={go} />}
        {current === "first" && <StarterRecipe onNavigate={go} />}
        {current === "first" && <AcademyCallout variant="wizard" onNavigate={go} />}
      </div>
    </Modal>
  );
}
