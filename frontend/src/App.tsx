import { applyTheme, nextTheme, useThemePref } from "./lib/theme";
import clsx from "clsx";
import { ConnectionDots } from "./components/connections/ConnectionDots";
import { refreshConnections } from "./lib/connections";
import { Bell, BellOff, Boxes, Building2, Cable, ChevronDown, Ellipsis, Feather, Settings, Gem, Globe2, ListChecks, Monitor, Moon, Network, Plug, PlugZap, Plus, RefreshCcw, Sparkles, Sun, Target, TrendingUp, Trophy, Users, Volume2, VolumeX, Workflow } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
// UXF-A: tembel parçalar yeniden denenebilir (`lazy` = lib/lazyRoute; ağ düşünce bir kez kendiliğinden, sonra "Tekrar
// dene"); yüklenemeyen sayfa kabuğu sökmez, RouteErrorBoundary <main> içinde açık ileti gösterir
import { lazyRoute as lazy } from "./lib/lazyRoute";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { create } from "zustand";
import { AdminBadge } from "./components/admin/AdminBadge";
import { SafeModeBadge } from "./components/safety/SafeModeBadge"; // TRUST: "Güvenli mod açık" rozeti
import { GameLayer } from "./components/game/GameLayer";
import { PixelFace } from "./components/PixelFace";
import { TaskComposer } from "./components/TaskComposer";
import { Button, Empty, PageHeader, Panel, Spinner } from "./components/ui";
import { BRAND } from "./lib/brand";
import { api } from "./lib/api";
import { LOCALES, tx, useLocale, useT, type Locale } from "./lib/i18n";
import { common } from "./locales/common";
import { shell } from "./locales/shell";
import { builder as builderMsgs } from "./locales/builder";
import { Activity, CalendarClock, Hammer, Inbox } from "lucide-react";
import { heroesMsg } from "./locales/heroes";
import { Shield } from "lucide-react";
// S50: teslim bildirimi ("Raporun hazır") + Çıktılar rozeti
import { DeliverableNotifier, DeliverablesBadge } from "./components/deliverables/DeliverableNotifier";
// AGENT-DELETE: ajanın durdurulan silme isteği bildirimi (karar 31 Ekim)
import { AgentDeleteNotice } from "./components/connect/AgentDeleteNotice";
import { StaleBuildBanner } from "./components/StaleBuildBanner"; // STALE-DIST: eski arayüz derlemesi uyarısı
import { deliverablesMsg } from "./locales/deliverables";
import { FolderOutput } from "lucide-react";
import { useCloudEnabled, wireAccount } from "./full/account"; // bulut hesabı (free sürümde yok)
// S25: zamanlayıcı bildirimleri (gözetimsiz koşu duraklatıldı, heartbeat) sayfa açılmadan da dinlensin
import "./lib/schedule";
// BUNDLE: dünya ve ajan çekmecesi tembel yüklendiğinden, eskiden onlar üzerinden her sayfada bağlanan olay işleyicileri
// (koruma bayrağı akışı, koşu denetim olayları, harici oturumlar) burada açıkça yüklenir; davranış değişmez.
import "./lib/tools";
import "./lib/trace";
// Ücretli sürümün sayfaları, menü girişleri, katmanları ve bağlantıları (ücretsiz sürümde boş; bkz. full/routes)
import { PAID_NAV_ICON, PAID_NAV_LABEL, PAID_ROUTES, PaidLayers, SKILL_STORE_NAV, usePaidWiring } from "./full/routes";
import { wireResumeFeed } from "./full/data";
import { play, setSoundEnabled, setSoundVolume, soundEnabled, soundVolume, VOLUME_STEPS } from "./lib/sound";
import { connectEvents, useStudio } from "./lib/store";
import { reportServerUp, useServerPoll, useServerUp } from "./lib/serverHealth";
import { activeEntry, isNavActive, NAV_ENTRIES, NAV_GROUPS, NAV_OPEN_KEY, navVisible, parseOpenGroups, visibleEntries, type NavContext, type NavEntry, type NavGroup } from "./lib/navModel";
// DASH-MVP: görünüm (Dünya / Pano). uiMode modülü yüklenir yüklenmez <html data-ui> kurulur (ilk boyamadan önce).
import { LayoutDashboard } from "lucide-react";
import { initialUiMode, useMode, useUiMode } from "./lib/uiMode";
import { useOnboarding } from "./components/onboarding/onboarding";
import { useDecisionCount } from "./components/board/DecisionsBadge";
import { wireHealthAlerts } from "./lib/health"; // FAZB1: health.alert → bildirim akışı
import { healthMsg } from "./locales/health";
import { viewMsg } from "./locales/view";
import { ViewSwitch, ViewToast } from "./components/board/ViewSwitch";
import { DecisionsBadge } from "./components/board/DecisionsBadge";
// BUNDLE: dünya (three/R3F/voxel) yalnızca "/" (Dünya Görünümünde) ya da "/dunya" açılınca yüklenir; diğer sayfaların ilk
// boyaması hafif kalır. Açılışta parça, rotalar ilk yüklemeyi (loaded) beklerken hemen istenir. Parça hazırsa sayfa
// askıya alınmadan doğrudan çizilir (React'in Suspense açılış gecikmesi ~300 ms olmasın); dünya eskisinden geç açılmasın.
// DASH-MVP: Pano Görünümünde (yerel ayna `board`) "/" açılışında dünya parçası (three/World/scenes) HİÇ istenmez; ayna
// yoksa görünüm sunucudan öğrenilince (useLanguageSync) Dünya ise o an istenir.
const loadWorldPage = () => import("./pages/WorldPage");
let worldPageReady: (typeof import("./pages/WorldPage"))["default"] | null = null;
const prefetchWorld = () => { loadWorldPage().then((m) => { worldPageReady = m.default; }, () => undefined); };
if (typeof window !== "undefined" && (window.location.pathname === "/dunya"
  || (window.location.pathname === "/" && initialUiMode === "world"))) {
  prefetchWorld();
}
const WorldPageLazy = lazy(loadWorldPage);
// PANO-FIX Pano parçası, Pano açılacağı biliniyorsa (ayna `board` ve "/" ya da her zaman "/pano") giriş betiği
// değerlendirilirken istenir; genel veri (overview) beklenmeden indirilip derlenir.
const loadBoardPage = () => import("./pages/BoardPage");
if (typeof window !== "undefined" && (window.location.pathname === "/pano"
  || (window.location.pathname === "/" && initialUiMode === "board"))) {
  void loadBoardPage().catch(() => undefined);
}
const BoardPage = lazy(loadBoardPage); // DASH-MVP: Pano (three/voxel içe aktarmaz; board_bundle.test.mjs)
function WorldPage() {
  // bağlama başına bir kez seçilir: tür sonradan değişip dünya yeniden kurulmasın
  const [Ready] = useState(() => worldPageReady);
  return Ready ? <Ready /> : <WorldPageLazy />;
}
// BUNDLE: ilk boyamada gerekmeyen katmanlar (avatar önizlemesi R3F, sihirbazın sahne kataloğu) ayrı yüklenir
const AgentDrawer = lazy(() => import("./components/AgentDrawer").then((m) => ({ default: m.AgentDrawer })));
const OnboardingWizard = lazy(() => import("./components/onboarding/OnboardingWizard").then((m) => ({ default: m.OnboardingWizard })));

const RunsPage = lazy(() => import("./pages/RunsPage"));
const WorkflowsPage = lazy(() => import("./pages/WorkflowsPage"));
const MemoryPage = lazy(() => import("./pages/MemoryPage"));
const ConnectionsPage = lazy(() => import("./pages/ConnectionsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage")); // UXF-E: uygulama ayarları
const OfficePage = lazy(() => import("./pages/OfficePage"));
const HermesPage = lazy(() => import("./pages/HermesPage"));
const GoalsPage = lazy(() => import("./pages/GoalsPage"));
const AchievementsPage = lazy(() => import("./pages/AchievementsPage"));
const AgentsPage = lazy(() => import("./pages/AgentsPage"));
const ConnectPage = lazy(() => import("./pages/ConnectPage"));
const SkillsPage = lazy(() => import("./pages/SkillsPage"));
const WorldBuilderPage = lazy(() => import("./pages/WorldBuilderPage"));
// Faz 6: gelen kutusu (S24), zamanlayıcı (S25), değerlendirme ve kabul (S28)
const InboxPage = lazy(() => import("./pages/InboxPage"));
const SchedulePage = lazy(() => import("./pages/SchedulePage"));
const HeroesPage = lazy(() => import("./pages/HeroesPage")); // S44
const OutputsPage = lazy(() => import("./pages/OutputsPage")); // S50: çıktılar kütüphanesi
const PlanPage = lazy(() => import("./pages/PlanPage")); // paket, koltuk ve kullanım
const HealthPage = lazy(() => import("./pages/HealthPage")); // FAZB1: Sistem sağlığı

// NAV-COPY (2026-10-25): menünün yapısı (bölümler, sıra, koşullar, etkinlik kuralı) lib/navModel.ts'te; burada yalnızca
// kimliğe göre etiket, ikon ve açıklama eşlenir. Gerekçe ve önce/sonra tablosu:
type NavGroupKey = `nav_group_${NavGroup}`;
const GROUP_KEY = Object.fromEntries(NAV_GROUPS.map((g) => [g, `nav_group_${g}`])) as Record<NavGroup, NavGroupKey>;
type NavItem = NavEntry & { label: string; hint: string; icon: ReactNode; short?: string };

/** Menü etiketi: sayfanın kendi başlığıyla aynı kaynaktan (dile duyarlı getter). */
const NAV_LABEL: Record<string, () => string> = {
  ...PAID_NAV_LABEL,
  world: () => tx(shell, "nav_world"),
  board: () => tx(viewMsg, "title"),
  worldview: () => tx(viewMsg, "view_world"),
  runs: () => tx(shell, "nav_runs"),
  inbox: () => tx(shell, "nav_inbox"),
  outputs: () => tx(deliverablesMsg, "nav"),
  agents: () => tx(shell, "nav_agents"),
  goals: () => tx(shell, "nav_goals"),
  workflows: () => tx(shell, "nav_workflows"),
  schedule: () => tx(shell, "nav_schedule"),
  heroes: () => tx(heroesMsg, "nav"),
  office: () => tx(shell, "nav_office"),
  skills: () => tx(shell, "nav_skills"),
  memory: () => tx(shell, "nav_memory"),
  careers: () => tx(shell, "nav_agent_careers"),
  achievements: () => tx(shell, "nav_achievements"),
  builder: () => tx(builderMsgs, "title"),
  connections: () => tx(shell, "nav_connections"),
  settings: () => tx(shell, "nav_settings"),
  plan: () => tx(shell, "nav_plan"),
  connect: () => tx(shell, "nav_connect"),
  hermes: () => tx(shell, "nav_hermes"),
  health: () => tx(healthMsg, "nav"),
};
const NAV_SHORT: Record<string, () => string> = { inbox: () => tx(shell, "nav_inbox_short") };
const NAV_ICON: Record<string, ReactNode> = {
  ...PAID_NAV_ICON,
  world: <Globe2 size={18} />, board: <LayoutDashboard size={18} />, worldview: <Globe2 size={18} />, runs: <ListChecks size={18} />, inbox: <Inbox size={18} />,
  outputs: <FolderOutput size={18} />, agents: <Users size={18} />,
  goals: <Target size={18} />, workflows: <Workflow size={18} />, schedule: <CalendarClock size={18} />,
  heroes: <Shield size={18} />, office: <Building2 size={18} />, skills: <Sparkles size={18} />,
  memory: <Network size={18} />, careers: <TrendingUp size={18} />,
  achievements: <Trophy size={18} />,
  builder: <Hammer size={18} />,
  connections: <Plug size={18} />, settings: <Settings size={18} />, plan: <Gem size={18} />,
  connect: <Cable size={18} />, hermes: <Feather size={18} />, health: <Activity size={18} />,
};

// Yönetici modu olmayan derlemede Skill mağazası bağlantısı hiç oluşturulmaz; bulut koşulu çizimde uygulanır.
const NAV: NavItem[] = NAV_ENTRIES.filter((n) => n.when !== "skillStore" || SKILL_STORE_NAV).map((n) => ({
  ...n,
  icon: NAV_ICON[n.id],
  get label() { return NAV_LABEL[n.id](); },
  get hint() { return tx(shell, `nav_hint_${n.id}` as NavHintKey); },
  get short() { return NAV_SHORT[n.id]?.(); },
}));
type NavHintKey = Extract<keyof typeof shell.tr, `nav_hint_${string}`>;

/** Menünün görünme bağlamı. Bulut hesabı durumu sunucudan; Skill mağazası derleme bayrağından; görünüm (`mode`: Dünya /
 * Pano Görünümü) uiMode deposundan (DASH-MVP).*/
function useNavContext(): NavContext {
  const cloud = useCloudEnabled();
  const mode = useMode();
  return useMemo(() => ({ cloud, skillStore: SKILL_STORE_NAV, mode }), [cloud, mode]);
}

// Açık bölümler (masaüstü yan menü ve mobil "Daha fazla" ortak; kişisel kolaylık, okunamazsa hepsi kapalı)
function readOpen(): NavGroup[] {
  try { return parseOpenGroups(localStorage.getItem(NAV_OPEN_KEY)); } catch { return []; }
}

const MASCOT = { species: "fox", skin: "#E8833A", hat: "crown", glasses: "none", outfit: "hoodie", outfitColor: "#4F9E30", accent: "#FFD166" } as const;

function ThemeToggle({ className }: { className?: string }) {
  const t = useT(shell);
  // tercih `lib/theme.ts`te; birden çok düğme (üst çubuk, menü, "Daha fazla") ve Ayarlar › Görünüm aynı durumu gösterir
  const theme = useThemePref();
  const apply = () => applyTheme(nextTheme(theme));
  const icon = theme === "light" ? <Sun size={16} /> : theme === "dark" ? <Moon size={16} /> : <Monitor size={16} />;
  const label = theme === "light" ? t("theme_light") : theme === "dark" ? t("theme_dark") : t("theme_system");
  return <Button variant="ghost" size="sm" className={className} icon={icon} onClick={apply} title={t("theme_title", { label })} aria-label={label} />;
}

function SoundToggle() {
  const t = useT(shell);
  const [on, setOn] = useState(soundEnabled());
  const [vol, setVol] = useState(soundVolume());
  // kademe: kapalı → düşük → orta → yüksek → kapalı (VOLUME_STEPS)
  const cycle = () => {
    if (!on) { setSoundEnabled(true); setSoundVolume(VOLUME_STEPS[0]); setOn(true); setVol(VOLUME_STEPS[0]); play("done"); return; }
    const i = VOLUME_STEPS.findIndex((s) => Math.abs(s - vol) < 0.01);
    if (i >= 0 && i < VOLUME_STEPS.length - 1) { const next = VOLUME_STEPS[i + 1]; setSoundVolume(next); setVol(next); play("done"); return; }
    setSoundEnabled(false); setOn(false);
  };
  const pct = `${Math.round(vol * 100)}%`;
  return (
    <Button variant="ghost" size="sm" icon={on ? <Volume2 size={16} /> : <VolumeX size={16} />} aria-label={`${t("sounds")} ${on ? pct : ""}`}
      title={on ? `${t("sounds_on")} · ${pct}` : t("sounds_off")}
      onClick={cycle} />
  );
}

function NotifyToggle() {
  const t = useT(shell);
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [perm, setPerm] = useState(supported ? Notification.permission : "denied");
  if (!supported) return null;
  const on = perm === "granted";
  return (
    <Button variant="ghost" size="sm" icon={on ? <Bell size={16} /> : <BellOff size={16} />}
      title={on ? t("notify_on") : perm === "denied" ? t("notify_blocked") : t("notify_enable")}
      aria-label={t("notify")} disabled={perm === "denied"}
      onClick={() => { if (!on) Notification.requestPermission().then(setPerm); }} />
  );
}

/** Kurulu araçları yeniden keşfet (Hermes, Ollama, Codex, Claude). Yoğun makinede ilk tarama zaman aşımına
 *  uğrayabildiği için her zaman elde bir düğme bulunur. */
function RescanButton() {
  const t = useT(shell);
  const [busy, setBusy] = useState(false);
  // ConnectionService'i zorla tazeler; eski (4 tür) ve yeni (tüm sağlayıcılar) depolar birlikte güncellenir
  const run = async () => { setBusy(true); try { await refreshConnections(true); } catch { /* durum kartı hatayı gösterir */ } finally { setBusy(false); } };
  return (
    <Button variant="ghost" size="sm" aria-label={t("rescan_aria")} title={t("rescan_title")}
      disabled={busy} onClick={run} icon={busy ? <Spinner size={13} /> : <RefreshCcw size={14} />} />
  );
}

function HealthDots() {
  const t = useT(shell);
  const connected = useStudio((s) => s.connected);
  // sunucuya ulaşılamıyorsa (api hatası ya da /api/health yoklaması) akış durumu ne derse desin "Bağlantı yok"
  const up = useServerUp((s) => s.up);
  const down = !up;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="t-overline text-muted">{t("status")}</span>
        <span title={down ? t("offline_title") : connected ? t("live_title") : t("connecting_title")} role="status"
          className={clsx("flex items-center gap-1.5 text-xs font-semibold", down ? "text-bad" : connected ? "text-ok" : "text-muted")}>
          <span className={clsx("h-2 w-2 rounded-full", down ? "bg-bad" : connected ? "bg-grass animate-pulse" : "bg-muted")} />
          {down ? t("offline") : connected ? t("live") : t("connecting")}
        </span>
        <RescanButton />
      </div>
      {/* S29: tek bağlantı durumu modeli (ready: ok | needs_action | unavailable | checking), tüm sağlayıcılar */}
      <ConnectionDots />
    </div>
  );
}

/** TR/EN dil seçimi: yerelde hemen uygulanır, sunucu ayarına (ui.language) da kaydedilir. */
function LanguageToggle() {
  const locale = useLocale((s) => s.locale);
  const setPref = useLocale((s) => s.setPref);
  const next: Locale = locale === "tr" ? "en" : "tr";
  return (
    <Button variant="ghost" size="sm" aria-label={`${tx(common, "language")}: ${LOCALES.find((l) => l.id === locale)?.label}`}
      title={tx(shell, "language_title", { current: LOCALES.find((l) => l.id === locale)?.label, next: LOCALES.find((l) => l.id === next)?.label })}
      onClick={() => { setPref(next); void api.saveSettings({ ui: { language: next } }).catch(() => undefined); }}>
      <span className="font-mono text-xs font-semibold">{LOCALES.find((l) => l.id === locale)?.short}</span>
    </Button>
  );
}

function Preferences() {
  const t = useT(shell);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted">{t("prefs")}</span>
      <span className="flex"><LanguageToggle /><SoundToggle /><NotifyToggle /><ThemeToggle /></span>
    </div>
  );
}

function LocalNote() {
  const t = useT(shell);
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted">
      <Boxes size={14} className="shrink-0" aria-hidden /> {t("local_note")}
    </div>
  );
}

/** Açık bölümler: masaüstü yan menü ve mobil "Daha fazla" sayfası aynı durumu paylaşır (kişisel kolaylık). */
const useNavOpen = create<{ open: NavGroup[]; toggle: (g: NavGroup) => void }>((set) => ({
  open: readOpen(),
  toggle: (g) => set((cur) => {
    const open = cur.open.includes(g) ? cur.open.filter((x) => x !== g) : [...cur.open, g];
    try { localStorage.setItem(NAV_OPEN_KEY, JSON.stringify(open)); } catch { /* yok say */ }
    return { open };
  }),
}));

/** Bölümlü sayfa listesi. Ana bölüm her zaman açıktır (masaüstünde başlığı yalnız ekran okuyucuya görünür). Diğer
 *  bölümlerin başlığı aria-expanded düğmedir ve varsayılan olarak kapalıdır; kapalı bölümde yalnızca o an açık sayfa
 *  (varsa) görünür kalır, böylece nerede olduğun hiç kaybolmaz. `sheet` (mobil): açıklama her öğenin altında yazılır. */
function NavGroups({ items, labelPrefix, sheet = false }: { items: NavItem[]; labelPrefix: string; sheet?: boolean }) {
  const t = useT(shell);
  const { pathname } = useLocation();
  const open = useNavOpen((s) => s.open);
  const toggle = useNavOpen((s) => s.toggle);
  const ctx = useNavContext();
  const first = useRef<HTMLDivElement>(null);
  // kısa ekranda menü kayabilir: açık sayfa menüde hep görünür olsun (yalnızca menü kabı kayar)
  useEffect(() => {
    if (sheet) return;
    first.current?.closest("nav")?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [pathname, sheet]);
  return (
    <>
      {NAV_GROUPS.map((g) => {
        const all = items.filter((n) => n.group === g && navVisible(n, ctx));
        if (!all.length) return null;
        const id = `${labelPrefix}-${GROUP_KEY[g]}`;
        const label = t(GROUP_KEY[g]);
        const collapsible = g !== "main";
        const closed = collapsible && !open.includes(g);
        const list = closed ? all.filter((n) => isNavActive(n, pathname)) : all;
        const names = all.map((n) => n.label).join(", ");
        return (
          <div key={g} ref={g === NAV_GROUPS[0] ? first : undefined} role="group" aria-labelledby={id}>
            {collapsible ? (
              <button type="button" className={clsx("nav-section nav-section-btn", sheet && "min-h-11")} aria-expanded={!closed}
                aria-controls={`${id}-list`}
                title={`${closed ? t("nav_group_expand", { group: label }) : t("nav_group_collapse", { group: label })}: ${names}`}
                onClick={() => toggle(g)}>
                <span id={id}>{label}</span>
                {closed && <span className="nav-section-count num" aria-hidden>{all.length}</span>}
                <ChevronDown size={14} aria-hidden className="nav-section-chevron" />
              </button>
            ) : (
              <div id={id} className={clsx("nav-section", !sheet && "sr-only")}>{label}</div>
            )}
            {!!list.length && (
              <ul id={`${id}-list`} className="flex flex-col gap-1">
                {list.map((n) => {
                  const active = isNavActive(n, pathname);
                  const hintId = `${labelPrefix}-hint-${n.id}`;
                  return (
                    <li key={n.to}>
                      <Link to={n.to} className={clsx("nav-item", sheet && "!items-start")} aria-current={active ? "page" : undefined}
                        title={sheet ? undefined : n.hint} aria-describedby={sheet ? hintId : undefined}>
                        {n.icon}
                        <span className="min-w-0 flex-1 flex flex-col">
                          <span className="break-words leading-tight">{n.label}</span>
                          {sheet && <span id={hintId} aria-hidden className="text-xs font-normal text-muted leading-snug mt-0.5">{n.hint}</span>}
                        </span>
                        {n.to === "/gorevler" && <PendingBadge />}
                        {n.to === "/ciktilar" && <DeliverablesBadge />}
                        {(n.id === "board" || (n.id === "resume" && ctx.mode === "world")) && <DecisionsBadge />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Kararını bekleyen onay sayısı (iş akışı onay kapıları + Hermes araç onayları). */
function PendingBadge() {
  const t = useT(shell);
  const runList = useStudio((s) => s.runList);
  // yalnız karar verilebilen kartlar sayılır — duraklatılmış/kesilmiş koşunun kartı "önce sürdür" der
  const count = useMemo(() => runList.reduce((n, r) => (r.status !== "running" ? n : n + (r.steps ?? []).filter(
    (s) => s.status === "awaiting_approval" || s.status === "awaiting_tool_approval").length), 0), [runList]);
  // FOLLOWUP: onay bekleyen ama duraklatılmış koşular sayaca girmez; kullanıcı yine de görsün diye ayrı küçük sayı
  const resume = useMemo(() => runList.filter((r) => (r.status === "paused" || r.status === "interrupted") && (r.steps ?? []).some(
    (s) => s.status === "awaiting_approval" || s.status === "awaiting_tool_approval")).length, [runList]);
  if (!count && !resume) return null;
  const label = [count ? t("pending_approvals", { n: count }) : "", resume ? t("needs_resume_runs", { n: resume }) : ""]
    .filter(Boolean).join(" · ");
  return (
    <span className="ml-auto inline-flex items-center gap-1" title={label} aria-label={label}>
      {!!count && <span className="chip tone-warn !px-1.5 num" aria-hidden>{count}</span>}
      {!!resume && <span className="chip tone-muted !px-1.5 num" aria-hidden>
        <span className="h-1.5 w-1.5 rounded-full bg-gold" />{resume}
      </span>}
    </span>
  );
}

/** Mobil alt çubuk: 4 ana sayfa + "Daha fazla" sayfası (375 px'te yatay kaydırma yok). */
function MobileNav() {
  const t = useT(shell);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const sheet = useRef<HTMLDivElement>(null);
  const ctx = useNavContext();
  const visible = useMemo(() => visibleEntries(ctx, NAV), [ctx]);
  const navMobile = visible.filter((n) => n.mobile);
  const navMore = visible.filter((n) => !n.mobile);
  const moreActive = navMore.some((n) => isNavActive(n, pathname));

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLElement>("a, button")?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  return (
    <>
      {open && (
        <div className="lg:hidden fixed inset-0 z-[25]" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="absolute inset-0 bg-black/35 pointer-events-none" />
          <div ref={sheet} id="daha-fazla" role="dialog" aria-modal="true" aria-label={t("nav_more_dialog")}
            className="panel anim-rise absolute inset-x-2 p-3 flex flex-col gap-3 max-h-[70vh] overflow-y-auto"
            style={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom))" }}>
            <nav aria-label={t("nav_more_pages")} className="flex flex-col gap-3">
              <NavGroups items={navMore} labelPrefix="mobil" sheet />
            </nav>
            <div className="panel-soft p-3 flex flex-col gap-2.5"><HealthDots /><LocalNote /></div>
            <ViewSwitch />
            <Preferences />
          </div>
        </div>
      )}
      {/* data-mobile-nav: yürüme HUD'u (joystick, alt sayfa) bu çubuğun üstünde kalır (walk/media.ts useBottomInset) */}
      <nav data-mobile-nav="" aria-label={t("nav_main")} className="shell-tabbar lg:hidden fixed bottom-0 inset-x-0 z-30 bg-panel border-t-2 border-line flex px-1"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {navMobile.map((n) => (
          <Link key={n.to} to={n.to} className="tabbar-item relative" aria-current={isNavActive(n, pathname) ? "page" : undefined}
            aria-label={n.short ? n.label : undefined}>
            {/* rozetler simgeye bağlı (geniş alt çubukta öğenin sağ kenarına kaçmaz, üst üste binmez)*/}
            <span className="tabbar-icon relative">{n.icon}
              {n.to === "/gorevler" && <span className="absolute -top-1.5 left-[calc(100%-0.375rem)] flex"><PendingBadge /></span>}
              {n.id === "board" && <span className="absolute -top-1.5 left-[calc(100%-0.375rem)] flex"><DecisionsBadge /></span>}
            </span>
            <span className="truncate max-w-full px-0.5" aria-hidden={n.short ? true : undefined}>{n.short ?? n.label}</span>
          </Link>
        ))}
        <button type="button" className="tabbar-item" aria-expanded={open} aria-controls="daha-fazla" aria-haspopup="dialog"
          data-active={open || moreActive} onClick={() => setOpen((v) => !v)}>
          <span className="tabbar-icon"><Ellipsis size={18} /></span>
          <span className="truncate max-w-full px-0.5">{t("nav_more")}</span>
        </button>
      </nav>
    </>
  );
}

/** Sunucu ayarındaki dil tercihini (ui.language) yerele uygular; <html lang> güncel tutulur. */
function useLanguageSync() {
  const locale = useLocale((s) => s.locale);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    api.settings().then((st) => {
      const ui = (st as { ui?: { language?: string; mode?: string } }).ui;
      const onboarded = (st as { onboarding?: { completed?: boolean } }).onboarding?.completed === true;
      const pref = ui?.language;
      if ((pref === "auto" || pref === "tr" || pref === "en") && pref !== useLocale.getState().pref) {
        useLocale.getState().setPref(pref);
      }
      // DASH-MVP: görünüm sunucu ayarından (yerel ayna yalnız ilk boyama içindir); ayna yoktuysa Dünya parçası şimdi istenir
      // PANO-FIX temiz kurulumda (sihirbaz bitmedi, görünüm seçilmedi) dünya seçimden önce istenmez
      useUiMode.getState().applyServer(ui?.mode, onboarded);
      const um = useUiMode.getState();
      if (initialUiMode === null && um.mode === "world" && !um.fresh && window.location.pathname === "/") prefetchWorld();
    }).catch(() => { useUiMode.getState().markUnknown(); });
  }, []);
  return locale;
}

export default function App() {
  useDocumentTitle();
  const locale = useLanguageSync();
  const mode = useMode();
  const known = useUiMode((s) => s.known);
  const { pathname } = useLocation();
  usePaidWiring(pathname); // G7
  useServerPoll();
  const t = useT(shell);
  const load = useStudio((s) => s.load);
  const loaded = useStudio((s) => s.loaded);
  const openComposer = useStudio((s) => s.openComposer);
  const [error, setError] = useState<string | null>(null);
  // S39: sunucuya ulaşılamazsa boş "görev yok" sayfaları yerine tek bir hata ekranı; sunucu açılınca kendiliğinden toparlanır
  const retry = useCallback(() => { load().then(() => setError(null)).catch((e) => { setError(String(e)); reportServerUp(false); }); }, [load]);
  useEffect(() => {
    if (!error) return;
    const id = window.setInterval(retry, 5000);
    return () => window.clearInterval(id);
  }, [error, retry]);

  useEffect(() => {
    load().catch((e) => { setError(String(e)); reportServerUp(false); }); // ilk yükleme düştüyse durum noktası da "Bağlantı yok"
    connectEvents();
    wireHealthAlerts();
    wireResumeFeed(); // DASH-MVP: karar rozeti ve Pano aynı "Nerede kalmıştım?" verisini paylaşır
    wireAccount(); // hesap durumu (free sürümde boş)
    // tüm sağlayıcıların (OpenAI uyumlu vb. dahil) tek doğruluk kaynağından durumunu ilk açılışta çek. PANO-FIX Pano
    // Görünümünde ilk ekran bunu beklemez (ajan durumu genel veriden gelir); boşta istenir
    if (initialUiMode === "board") whenIdle(() => { void refreshConnections(false, 0).catch(() => undefined); });
    else void refreshConnections(false, 0).catch(() => undefined);
    // SETUP: kurulmamış araçlar için ucuz yeniden denetim lib/connections.ts'te (odak + 3 dk, `recheck`); burada yalnız
    // önbellekli durum tazelenir. Eskiden bir araç (ör. kurulu olmayan Hermes) hazır değilken 45 sn'de bir TAM tarama yapılıyordu.
    const id = window.setInterval(() => { void refreshConnections(false, 0).catch(() => undefined); }, 45000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openComposer();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [openComposer]);

  return (
    <div className="h-full flex flex-col lg:flex-row">
      <a href="#icerik"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] btn btn-sm">{t("skip_to_content")}</a>
      {/* STALE-DIST: sabit konumlu; DOM'da erken durur ki klavyede "içeriğe geç"ten hemen sonra ulaşılsın */}
      <StaleBuildBanner />

      {/* yan menü (masaüstü) / üst çubuk (mobil) */}
      <aside className="shell-aside lg:w-[16.5rem] shrink-0 lg:h-full flex lg:flex-col gap-3 px-3 py-2.5 lg:p-4 border-b-2 lg:border-b-0 lg:border-r-2 border-line bg-panel/85 backdrop-blur">
        <div className="flex items-center gap-2.5 min-w-0 flex-1 lg:flex-none lg:mb-1">
          <Link to="/" className="flex items-center gap-2.5 min-w-0 min-h-11 rounded-lg" aria-label={t("home_aria", { brand: BRAND.name })}>
            <span className="shrink-0 lg:hidden"><PixelFace avatar={MASCOT} size={32} ring="#4F9E30" /></span>
            <span className="shrink-0 hidden lg:block"><PixelFace avatar={MASCOT} size={40} ring="#4F9E30" /></span>
            <span className="flex flex-col min-w-0">
              <span className="wordmark truncate">{BRAND.name}</span>
              <span className="text-xs text-muted font-medium hidden lg:block">{locale === "en" ? BRAND.taglineEn : BRAND.tagline}</span>
            </span>
          </Link>
          {/* S40: yönetici / test modu açıkken her sayfada görünen rozet (mobilde üst çubukta, masaüstünde logonun altında) */}
          <AdminBadge className="lg:hidden min-h-11" />
          <SafeModeBadge className="lg:hidden min-h-11" />
          <div className="ml-auto lg:hidden flex items-center gap-1 shrink-0">
            {/* UXF-E: 375 px'te üst çubuk düğmeleri ≥ 44 px*/}
            <ThemeToggle className="min-h-11 min-w-11" />
            <Button variant="primary" size="sm" className="min-h-11 min-w-11" icon={<Plus size={16} />} onClick={() => openComposer()} aria-label={t("give_task")} />
          </div>
        </div>
        <AdminBadge className="hidden lg:inline-flex self-start" />
        <SafeModeBadge className="hidden lg:inline-flex self-start" />
        <Button variant="primary" className="hidden lg:flex w-full" icon={<Plus size={17} />} onClick={() => openComposer()}
          aria-keyshortcuts="Control+K">
          {t("give_task")} <kbd className="kbd ml-auto">Ctrl K</kbd>
        </Button>
        <nav aria-label={t("nav_main")} className="hidden lg:flex flex-col gap-3 mt-1 min-h-0 overflow-y-auto -mx-1 px-1 pb-1">
          <NavGroups items={NAV} labelPrefix="menu" />
        </nav>
        <div className="hidden lg:flex flex-col gap-2.5 mt-auto pt-1">
          <div className="panel-soft p-3 flex flex-col gap-2.5"><HealthDots /><div className="[@media(max-height:860px)]:hidden"><LocalNote /></div></div>
          <ViewSwitch />
          <Preferences />
        </div>
      </aside>

      <main id="icerik" tabIndex={-1} className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden pb-24 lg:pb-0 focus:outline-none">
        {error && !loaded ? (
          <div className="p-3 sm:p-5 max-w-[720px] mx-auto">
            <Panel>
              <div role="alert" className="flex flex-col items-center text-center gap-3 py-6 px-2">
                <span className="grid place-items-center h-12 w-12 rounded-xl border-2 border-line bg-bad-soft text-bad"><PlugZap size={24} aria-hidden /></span>
                <h1 className="t-h3">{t("server_down_title")}</h1>
                <p className="text-sm text-ink-2 max-w-prose">{t("server_down_text")}</p>
                <code className="font-mono text-sm panel-soft px-3 py-1.5">{t("start_hint")}</code>
                <Button variant="primary" icon={<RefreshCcw size={15} />} onClick={retry}>{t("server_retry")}</Button>
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer">{t("server_details")}</summary>
                  <p className="mt-1 font-mono break-all">{error}</p>
                </details>
              </div>
            </Panel>
          </div>
        ) : !loaded && !(known && boardFirst(pathname, mode)) ? (
          <div className="h-full grid place-items-center"><Spinner size={28} /></div>
        ) : (
          <RouteErrorBoundary resetKey={pathname}>
          <Suspense key={locale} fallback={<div className="p-10 grid place-items-center"><Spinner size={24} /></div>}>
            <Routes>
              <Route path="/" element={<HomeRoute />} />
              <Route path="/pano" element={<BoardPage />} />
              <Route path="/dunya" element={<WorldPage />} />
              <Route path="/gorevler" element={<RunsPage />} />
              <Route path="/gorevler/:id" element={<RunsPage />} />
              <Route path="/akislar" element={<WorkflowsPage />} />
              <Route path="/akislar/:slug" element={<WorkflowsPage />} />
              <Route path="/bellek" element={<MemoryPage />} />
              <Route path="/baglantilar" element={<ConnectionsPage />} />
              <Route path="/ayarlar" element={<SettingsPage />} />
              <Route path="/ofis" element={<OfficePage />} />
              <Route path="/hermes" element={<HermesPage />} />
              <Route path="/hermes/:tab" element={<HermesPage />} />
              <Route path="/hedefler" element={<GoalsPage />} />
              <Route path="/hedefler/:id" element={<GoalsPage />} />
              <Route path="/basarilar" element={<AchievementsPage />} />
              <Route path="/basarilar/:tab" element={<AchievementsPage />} />
              {PAID_ROUTES.achievements}
              <Route path="/ajanlar" element={<AgentsPage />} />
              <Route path="/ajanlar/:slug" element={<AgentsPage />} />
              <Route path="/skiller" element={<SkillsPage />} />
              <Route path="/skiller/:id" element={<SkillsPage />} />
              {PAID_ROUTES.skills}
              <Route path="/dunya-yapici" element={<WorldBuilderPage />} />
              <Route path="/dunya-yapici/:id" element={<WorldBuilderPage />} />
              {PAID_ROUTES.builder}
              <Route path="/paket" element={<PlanPage />} />
              {PAID_ROUTES.account}
              <Route path="/sistem-sagligi" element={<HealthPage />} />
              {PAID_ROUTES.health}
              <Route path="/kahramanlar" element={<HeroesPage />} />
              {PAID_ROUTES.heroes}
              <Route path="/gelen-kutusu" element={<InboxPage />} />
              <Route path="/gelen-kutusu/:id" element={<InboxPage />} />
              {PAID_ROUTES.inbox}
              <Route path="/ciktilar" element={<OutputsPage />} />
              <Route path="/ciktilar/:id" element={<OutputsPage />} />
              <Route path="/zamanlayici" element={<SchedulePage />} />
              <Route path="/zamanlayici/:id" element={<SchedulePage />} />
              {PAID_ROUTES.schedule}
              <Route path="/baglan" element={<ConnectPage />} />
              <Route path="/baglan/:client" element={<ConnectPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </RouteErrorBoundary>
        )}
      </main>

      {/* mobil alt gezinme */}
      <MobileNav />

      <TaskComposer />
      <ViewToast />
      <RouteErrorBoundary quiet resetKey={pathname}><Suspense fallback={null}><AgentDrawer /></Suspense></RouteErrorBoundary>
      {/* PANO-FIX Pano Görünümünde oyun ve akademi katmanları (profil, akademi, ilk oturum istekleri) ilk ekrandan
          sonra, boşta bağlanır; Dünya Görünümünde hemen (davranış aynı)*/}
      <Deferred when={mode === "board"}><GameLayer /><PaidLayers /></Deferred>
      <DeliverableNotifier />
      <AgentDeleteNotice />{/* AGENT-DELETE */}
      <RouteErrorBoundary quiet resetKey={pathname}><Suspense fallback={null}><OnboardingWizard /></Suspense></RouteErrorBoundary>
    </div>
  );
}

/** Sekme başlığı rotaya göre: "<Sayfa> · <marka>" (WCAG 2.4.2; QA-F3 m12). */
function useDocumentTitle() {
  const { pathname } = useLocation();
  const locale = useLocale((s) => s.locale);
  const ctx = useNavContext();
  const waiting = useDecisionCount();
  useEffect(() => {
    // menüyle aynı etkinlik kuralı (/basarilar sekmeleri iki öğeye bölünür); yalnız görünen öğeler, en özgül olan
    // menüde görünmeyen ama var olan rota (ör. bulut kapalıyken /hesap) "Sayfa bulunamadı" olmasın
    const item = activeEntry(pathname, visibleEntries(ctx, NAV)) ?? activeEntry(pathname, NAV);
    // DASH-MVP: /pano ve /dunya her iki görünümde açıktır; menüde karşılığı olmayan görünümde de doğru ad
    const p = pathname.replace(/\/+$/, "") || "/";
    const page = p === "/pano" || (p === "/" && ctx.mode === "board") ? tx(viewMsg, "title")
      : p === "/dunya" || p === "/" ? item?.label ?? tx(shell, "nav_world")
      : item?.label ?? tx(shell, "not_found");
    // PANO-FIX (ince dokunuş): Pano'da bekleyen karar sayısı sekme başlığında — arka sekmede "beni bekleyen" sinyali
    const board = p === "/pano" || (p === "/" && ctx.mode === "board");
    document.title = `${board && waiting ? `(${waiting}) ` : ""}${page} · ${BRAND.name}`;
  }, [pathname, locale, ctx, waiting]);
}

/** "/" görünüme göre: Pano Görünümünde Pano, Dünya Görünümünde dünya. Görünüm henüz bilinmiyorsa (yerel ayna yok,
 *  sunucu yanıtı bekleniyor) kısa yükleniyor durumu — Pano kullanıcısına dünya bir an bile çizilmez. */
function HomeRoute() {
  const mode = useMode();
  const known = useUiMode((s) => s.known);
  const fresh = useUiMode((s) => s.fresh);
  const wizardOpen = useOnboarding((s) => s.open);
  const wasOpen = useRef(false);
  // sihirbaz seçim yapılmadan kapanırsa varsayılan (Dünya) yüklenir. Yaş beyanı sihirbazdan önce açılabildiği için
  // zamanlayıcı yok; sihirbaz hiç açılmazsa yer tutucunun kendi seçim kartı vardır
  useEffect(() => {
    if (wizardOpen) { wasOpen.current = true; return; }
    if (wasOpen.current) useUiMode.getState().settleFresh();
  }, [wizardOpen]);
  if (!known) return <div className="p-10 grid place-items-center"><Spinner size={24} /></div>;
  if (fresh && mode === "world") return <NeutralHome />;
  return mode === "board" ? <BoardPage /> : <WorldPage />;
}

/** temiz kurulumda görünüm seçilene dek nötr, durağan yer tutucu (WebGL ve dünya parçası yok; animasyon yok).
 * Kurulum sihirbazı (ve yaş beyanı) üstünde açılır; sihirbaz açılmazsa ya da kapatılırsa buradaki iki düğmeyle seçilir.*/
function NeutralHome() {
  const tv = useT(viewMsg);
  const pick = (m: "world" | "board") => { void useUiMode.getState().setMode(m, { announce: false }); };
  // sihirbaz açıkken (2. adım aynı soruyu sorar) arkada ikinci bir "Nasıl çalışmak istersin?" seçicisi durmaz
  const wizardOpen = useOnboarding((s) => s.open);
  return (
    <div className="p-3 sm:p-5 max-w-[1440px] mx-auto flex flex-col gap-4">
      {!wizardOpen && <div className="panel p-4 sm:p-5 flex flex-col gap-3 max-w-xl">
        <h1 className="t-h3">{tv("wiz_title")}</h1>
        <p className="text-sm text-ink-2">{tv("wiz_text")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<LayoutDashboard size={16} aria-hidden />} onClick={() => pick("board")}>{tv("view_board")}</Button>
          <Button icon={<Globe2 size={16} aria-hidden />} onClick={() => pick("world")}>{tv("view_world")}</Button>
        </div>
      </div>}
      <div aria-hidden className="grid gap-3 grid-cols-2 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="panel h-24" />)}</div>
      <div aria-hidden className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]"><div className="panel h-72" /><div className="panel h-72" /></div>
    </div>
  );
}

/** Pano Görünümünde "/" ve her zaman "/pano" genel veri (overview) gelmeden çizilir; bölümler kendi iskeletini taşır.*/
function boardFirst(pathname: string, mode: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return p === "/pano" || (p === "/" && mode === "board");
}

/** Tarayıcı boşta (ya da en geç `ms` sonra) çağırır. */
function whenIdle(fn: () => void, ms = 2500): void {
  const w = window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: ms });
  else window.setTimeout(fn, Math.min(ms, 1200));
}

/** `when` doğruysa çocuklar ilk ekrandan sonra, boşta bağlanır (bir kez bağlanınca kalır). */
function Deferred({ when, children }: { when: boolean; children: ReactNode }) {
  const [on, setOn] = useState(!when);
  useEffect(() => {
    if (on) return;
    let live = true;
    whenIdle(() => { if (live) setOn(true); }, 3000);
    return () => { live = false; };
  }, [on]);
  return on ? <>{children}</> : null;
}

function NotFound() {
  const t = useT(shell);
  return (
    <div className="p-3 sm:p-5 max-w-[900px] mx-auto flex flex-col gap-4">
      <PageHeader title={t("not_found")} subtitle={t("not_found_sub")} />
      <Panel>
        <Empty icon={<Ellipsis size={28} />} title={t("not_found_empty")}
          action={<Link to="/" className="underline">{t("back_to_world")}</Link>} />
      </Panel>
    </div>
  );
}
