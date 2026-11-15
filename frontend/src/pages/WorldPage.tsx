import clsx from "clsx";
import { retryImport } from "../lib/lazyRetry"; // HQA-FIX
import { Activity, Brain, Expand, Eye, Gauge, Grid2x2, Hammer, Headphones, LayoutDashboard, LocateFixed, Maximize2, Minimize2, Plus, Send, Shrink, Users, X, ZoomIn, ZoomOut } from "lucide-react";
import { useUiMode } from "../lib/uiMode"; // PANO-FIX
import { viewMsg } from "../locales/view";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LiveFeed } from "../components/LiveFeed";
import { PixelFace } from "../components/PixelFace";
import { Badge, Button, Empty, PageHeader, Panel, StatusPill } from "../components/ui";
// Ücretli sürümün parçaları (tarif, akademi, eğlence anketi, kazanılan zaman, arşiv): ücretsiz sürümde boş (bkz. full/ui, full/data)
import { AcademyCallout, ArchivePanel, ExhibitCard, FunCheckCard, RecipeStartButton, TimeSavedCard, useExhibits } from "../full/ui";
import { scheduleAcademyLoad, useExternalAgents, useResumeFeed } from "../full/data";
import { exhibitLabels as exhibitLabelsOf } from "../full/more";
import { RecapCard } from "../components/game/RecapCard";
import { FirstSessionCard } from "../components/game/FirstSessionCard"; // ilk oturum (A1) adımları
import { WorldProgress } from "../components/game/WorldProgress";
import { buildDecisions, decisionTotal } from "../components/board/decisionModel"; // STORE-VISUAL: özet şeridi (Pano ile aynı sayım)
import { useWorldStatData, WorldStatStrip } from "../components/world/WorldStatStrip";
import { UsageStrip, useUsageStrip } from "../components/metrics/UsageStrip";
import { AgentCard } from "../components/world/AgentCard";
import { WorkZoneChips } from "../components/workzones/WorkZones"; // WORK-ZONES: ofisteki ajanlar, dönüş uyarıları
// DASH-MVP ekip satırı (eski TeamRow) Pano ile ortak sözleşmeli bileşen
import { WorldAgentStatusRow } from "../components/agents/AgentStatusRowWorld";
import {
  deriveWork, EXT_META, externalIdentity, externalMood, externalWork, extStatusLabel, findRun, sameWork,
  useElapsedTicker, useStableList, useWorldFx,
} from "../components/world/activity";
import { useBench } from "../components/world/bench";
import { MiniMap } from "../components/world/MiniMap";
import { ScenePicker } from "../components/world/ScenePicker";
import { WorldTools, type WalkToggle } from "../components/world/WorldTools";
import { WalkHud } from "../components/world/walk/WalkHud";
import { entityTypeOf } from "../components/world/walk/entities";
import { targetAction } from "../components/world/walk/selectLogic";
import { PlotsPanel } from "../components/world/expanse/PlotsPanel"; // E2: parseller
import { usePlotStore } from "../voxel/expanse/plotStore";
import { ambientLabel, isAmbientId, pokeAmbient } from "../components/world/walk/funBridge";
import { pickupSouvenir, souvenirLabel } from "../components/world/walk/progress/actions";
import { parseSouvenirId, souvenirOfEntity } from "../components/world/walk/progress/logic";
import { useScenePreview } from "../components/world/scenePreview";
import { api } from "../lib/api";
import { ensureWorld, useWorlds } from "../lib/builder";
import { agentAvailability, agentMood } from "../lib/agents";
import { isBenched } from "../lib/composerPick";
import { useActiveGoalTeams } from "../lib/goals";
import { fmtNumber, tx, useT } from "../lib/i18n";
import { timeAgo } from "../lib/format";
import { useOffice } from "../lib/office";
import { userRuns } from "../lib/runFilter";
import { useStudio } from "../lib/store";
import type { Mood, SceneId } from "../lib/types";
import { installWalkPositionSync, loadWalkProgress, savedWalkPosition } from "../lib/walk";
import { walk as WM } from "../locales/walk";
import { announceWalk } from "../components/world/walk/announce";
import { exploreInteract, exploreName } from "../components/world/walk/explore/actions";
import { doorAction } from "../components/world/walk/explore/doorAction";
import { ExploreHud } from "../components/world/walk/explore/ExploreHud";
import { useInterior } from "../voxel/interiors/store";
import { world as M } from "../locales/world";
import { createLive } from "../voxel/live";
import { sceneDef, worldDemand, worldLayout, type Built, type WorldSceneId } from "../voxel/scenes";
import { World, type GoalMarker, type PerfSample, type WorldAgent, type WorldHandle, type WorldTeam } from "../voxel/World";
import type { NearbyItem } from "../voxel/walk/controller";
import { entityPanelId, talkPanelId, useWalkActive, useWalkEditor, useWalkPhoto, useWalkStore } from "../voxel/walk/walkStore";
import { hasStoredLook, loadMeLook } from "../voxel/walk/me";
import { useWalkFocus } from "../components/world/focus/useWalkFocus"; // odak görünümü
import { FocusFullscreenButton } from "../components/world/focus/FocusFullscreenButton";
import { useAdminActive } from "../lib/admin";
import { isCityDoorId, isCityGateId } from "../voxel/citymap/doorEntity";

// W5: "Ben" avatar editörü tembel yüklenir (AvatarEditor + satın alma penceresi yalnız açılınca)
const MeEditor = lazy(() => retryImport(() => import("../components/world/walk/MeEditor"))); // HQA-FIX
// E3: yapı modu HUD'u (yalnız yürürken; tembel yüklenir)
const BuildHud = lazy(() => retryImport(() => import("../components/world/build/BuildHud")).then((m) => ({ default: m.BuildHud }))); // HQA-FIX: ağ geçişinde yeniden dene

const sameExternal = (a: WorldAgent["external"], b: WorldAgent["external"]) =>
  a === b || (!!a && !!b && a.label === b.label && a.color === b.color && a.accessory === b.accessory && a.small === b.small);
const sameActor = (a: WorldAgent, b: WorldAgent) =>
  a.agent === b.agent && a.mood === b.mood && a.activity === b.activity && (a.tool ?? null) === (b.tool ?? null) &&
  sameWork(a.work, b.work) && sameExternal(a.external, b.external);

interface HoverState { slug: string; x: number; y: number; width: number; height: number }

declare global { interface Window { __voxcrewPerf?: PerfSample } }

export default function WorldPage() {
  const t = useT(M);
  const storeAgents = useStudio((s) => s.agents);
  const storeStates = useStudio((s) => s.states);
  const conns = useStudio((s) => s.connections);
  const scene = useStudio((s) => s.scene);
  // Faz 7a (S30): etkin sahne bir kullanıcı dünyasıysa (w_…) yüklenip kaydedilir; kayıt değişince dünya yeniden çizilir
  const worldsVersion = useWorlds((s) => s.version);
  useEffect(() => { ensureWorld(scene); }, [scene]);
  const setScene = useStudio((s) => s.setScene);
  const selected = useStudio((s) => s.selectedAgent);
  const select = useStudio((s) => s.selectAgent);
  const openComposer = useStudio((s) => s.openComposer);
  const runList = useStudio((s) => s.runList);
  // değerlendirme/hakem/sistem koşuları "Son çalıştırmalar"da ve çalışan sayısında yok
  const userRunList = useMemo(() => userRuns(runList), [runList]);
  const stats = useStudio((s) => s.stats);
  const upsert = useStudio((s) => s.upsertAgent);
  const handoffs = useStudio((s) => s.handoffs);
  const world = useRef<WorldHandle>(null);
  const live = useMemo(createLive, []);
  // UXF-D: mini haritanın coğrafya katmanı için kurulmuş dış dünya
  const [mapBuilt, setMapBuilt] = useState<Built | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [focusTeam, setFocusTeam] = useState<string | null>(null);
  const navigate = useNavigate();
  const officeTeams = useOffice((s) => s.teams);
  const refreshOffice = useOffice((s) => s.refresh);
  // ölçüm modu (yalnızca geliştirme): ?bench=150 → sahte ajanlar, ekipler, harici oturumlar
  const bench = useBench();
  const agents = bench ? bench.agents : storeAgents;
  const states = bench ? bench.states : storeStates;
  const teams = bench ? bench.teams : officeTeams;
  // Ekip bölgeleri: ajanların ekip/liderlik bilgisi değişince ekipleri tazele.
  const teamSig = storeAgents.map((a) => `${a.slug}:${a.team ?? ""}`).join("|");
  useEffect(() => { if (!bench) refreshOffice(); }, [teamSig, refreshOffice, bench]);
  const worldTeams = useMemo<WorldTeam[]>(() => teams.map((tm) => ({ slug: tm.slug, name: tm.name, color: tm.color, lead: tm.lead, order: tm.order })), [teams]);
  const teamRank = useMemo(() => new Map(teams.map((tm, i) => [tm.slug, i])), [teams]);

  const runs = useStudio((s) => s.runs);
  const saving = useWorldFx((s) => s.saving);
  const realExternals = useExternalAgents();
  const externals = bench ? bench.externals : realExternals;
  useElapsedTicker();

  // CORE-WALK: demo (test) ajanları yalnız test modunda dünyada (ve Yakındakiler'de) görünür
  const testMode = useAdminActive();
  const listed = useMemo(() => agents.filter((a) => !a.hidden && (testMode || !a.demo)), [agents, testMode]);
  // yedekteki ajan (koltuk dışı) dünyada masaya oturmaz ve ajan sayısına girmez; ekip listesinde kalır
  const visible = useMemo(() => listed.filter((a) => !isBenched(a)), [listed]);
  const benchedCount = listed.length - visible.length;
  // kabul edilen işler dünyada arşiv sırası (yalnız başlık); tıklayınca kart, içerik yalnız "Aç" ile
  const exhibitsData = useExhibits(); // ölçüm modunda da çizilir (önce/sonra çizim çağrısı ölçümü için)
  const [exhibitSel, setExhibitSel] = useState<string | null>(null);
  const closeExhibit = useCallback(() => setExhibitSel(null), []);
  const exhibitLabels = useMemo(() => exhibitLabelsOf(),
    [t]); // eslint-disable-line react-hooks/exhaustive-deps
  const hidden = agents.filter((a) => a.hidden && (testMode || !a.demo)).length;
  const byTeam = (list: typeof agents) => [...list].sort((a, b) =>
    (a.team && teamRank.has(a.team) ? teamRank.get(a.team)! : 999) - (b.team && teamRank.has(b.team) ? teamRank.get(b.team)! : 999));
  const moodOf = useCallback((a: (typeof agents)[number]): Mood => (bench ? bench.moods[a.slug] ?? "idle" : agentMood(a, states, conns)), [bench, states, conns]);

  // Stüdyo ajanları: canlı durum + iş aşaması (Bellek → Düşünme → Araç → Yazma → Belleğe kayıt)
  const studioActors = useMemo<WorldAgent[]>(() => visible.map((a) => {
    const st = states[a.slug] ?? a.state;
    const sv = saving[a.slug];
    const run = findRun(st?.run_id ?? sv?.run, runs, runList);
    return { agent: a, mood: moodOf(a), activity: st?.activity ?? "", tool: st?.tool ?? null, work: deriveWork(st, run, sv) };
  }), [visible, states, moodOf, runs, runList, saving]);
  // Harici oturumlar (S9): Claude Code "kulaklık", Codex "vizör"; alt ajanlar küçük
  const liveExternals = useMemo(() => externals.filter((e) => e.status !== "ended"), [externals]);
  const extActors = useMemo<WorldAgent[]>(() => liveExternals.map((e) => {
    const meta = EXT_META[e.source] ?? EXT_META["claude-code"];
    return {
      agent: externalIdentity(e), mood: externalMood(e), activity: e.activity ?? "", tool: e.tool ?? null, work: externalWork(e),
      external: { label: e.isSubagent ? `${meta.label} · ${t("ext_subagent")}` : meta.label, color: meta.color, accessory: meta.accessory, small: e.isSubagent },
    };
  }), [liveExternals, t]);
  const allActors = useMemo(() => [...studioActors, ...extActors], [studioActors, extActors]);
  const actors = useStableList(allActors, (w) => w.agent.slug, sameActor);
  const actorBySlug = useMemo(() => new Map(allActors.map((w) => [w.agent.slug, w])), [allActors]);
  // STORE-VISUAL: Dünya özet şeridi — bekleyen karar sayısı Pano ve menü rozetiyle aynı kuraldan; veri paylaşılan depodan
  const resume = useResumeFeed((s) => s.data);
  const decisionRuns = useMemo(() => userRunList.map((r) => runs[r.id] ?? r), [userRunList, runs]);
  const waitingCount = useMemo(() => (resume ? decisionTotal(resume, buildDecisions(resume, decisionRuns).length) : null), [resume, decisionRuns]);
  const statData = useWorldStatData();
  const usage = useUsageStrip();
  const running = bench ? allActors.filter((w) => w.mood === "working" || w.mood === "thinking").length : userRunList.filter((r) => r.status === "running").length;
  // S38: büyüme ekip başına bölgelerle yapılır; çip, dünyanın gerçek boyutunu göstersin diye aynı talep kullanılır
  const layout = useMemo(() => worldLayout(scene, actors.length, worldDemand(actors.map((a) => ({ team: a.agent.team })), worldTeams)),
    [scene, actors, worldTeams, worldsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const findable = useMemo(() => allActors.map((w) => ({ slug: w.agent.slug, name: w.agent.name, title: w.agent.title, team: w.agent.team, color: w.agent.color })), [allActors]);

  // Hedef bayrakları: hedefe bağlı (Run.goal) çalışan koşuda çalışan her ekibin bölgesine bir bayrak;
  // ekipsiz ajanlar için koşu başına tek bayrak (ilk çalışan ajanın masası). Sürmekte olan hedefi bulunan
  // (S10 `useActiveGoalTeams`) ama şu an koşusu olmayan ekipler de bölgelerinde bayrak taşır.
  const goalTeams = useActiveGoalTeams();
  const goalsRef = useRef<GoalMarker[]>([]);
  const goals = useMemo<GoalMarker[]>(() => {
    const out: GoalMarker[] = [];
    for (const r of runList) {
      if (!r.goal || r.status !== "running") continue;
      const busy = r.steps.filter((s) => s.agent && /running|awaiting/.test(s.status)).map((s) => s.agent as string);
      const slugs = busy.length ? busy : r.steps.filter((s) => s.agent).slice(0, 1).map((s) => s.agent as string);
      const seen = new Set<string>();
      for (const slug of slugs) {
        const team = agents.find((a) => a.slug === slug)?.team ?? null;
        const k = team ?? "@ekipsiz";
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ key: `${r.id}:${k}`, team, agent: slug, label: r.title });
      }
    }
    const flagged = new Set(out.map((g) => g.team).filter(Boolean));
    for (const team of goalTeams) if (!flagged.has(team)) out.push({ key: `goal-team:${team}`, team, label: "" });
    // S39 (C-08): akan çıktı runList'i sık değiştirir; bayraklar aynıysa önceki dizi korunur (3B sahne gereksiz güncellenmez)
    const prev = goalsRef.current;
    const same = prev.length === out.length && prev.every((g, i) => g.key === out[i].key && g.agent === out[i].agent && g.label === out[i].label);
    if (same) return prev;
    goalsRef.current = out;
    return out;
  }, [runList, agents, goalTeams]);

  // Bilgi kartı: imleç karakterdeyken açılır, karta geçince açık kalır
  const sectionRef = useRef<HTMLElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const [hover, setHover] = useState<HoverState | null>(null);
  const onHover = useCallback((slug: string | null, at?: { x: number; y: number }) => {
    window.clearTimeout(hideTimer.current);
    if (!slug) { hideTimer.current = window.setTimeout(() => setHover(null), 280); return; }
    const r = sectionRef.current?.getBoundingClientRect();
    if (!r || !at) return;
    setHover((h) => (h?.slug === slug ? h : { slug, x: at.x - r.left, y: at.y - r.top, width: r.width, height: r.height }));
  }, []);
  const keepCard = useCallback(() => window.clearTimeout(hideTimer.current), []);
  const dropCard = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHover(null), 200);
  }, []);
  const closeCard = useCallback(() => { window.clearTimeout(hideTimer.current); setHover(null); }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  const hovered = hover ? actorBySlug.get(hover.slug) : undefined;

  const onWorldSelect = useCallback((slug: string | null) => {
    if (slug?.startsWith("ext:")) {
      const ext = liveExternals.find((e) => `ext:${e.id}` === slug);
      setHover(null);
      if (ext && !bench) navigate(`/projeler/${encodeURIComponent(ext.projectKey)}`);
      return;
    }
    if (slug) setHover(null);
    // W3: yürürken ajana tıklamak çekmece yerine Konuş panelini açar (açık bir tık; yakınlık tek başına açmaz)
    if (slug && useWalkStore.getState().active) { useWalkStore.getState().setPanel(talkPanelId(slug)); return; }
    select(slug);
  }, [liveExternals, navigate, select, bench]);
  // W2–W3: yürüme modu — Yürü düğmesi / Y, HUD, F (Konuş paneli / nesne paneli), Yakındakiler ve mini haritadan yürüme
  const walkOn = useWalkActive();
  // WALK-EXPLORE: iç mekândayken yapı modu (parsel) kapalı
  const inside = useInterior((s) => !!s.view);
  const previewing = !!useScenePreview((s) => s.id);
  const tw = useT(WM);
  const walkToggle = useMemo<WalkToggle>(() => ({
    on: walkOn, disabled: previewing && !walkOn,
    // W4: dünya başına kayıtlı konumdan devam (yoksa doğma karosu); büyümüş dünyada en yakın yürünebilir karoya düzeltilir
    onToggle: () => (useWalkStore.getState().active ? world.current?.walkExit() : world.current?.walkEnter(savedWalkPosition(scene))),
  }), [walkOn, previewing, scene]);
  // W4: konum kaydı (çıkışta ve yürürken 5 sn'de bir) ve sahnenin kayıtlı konumu, hatıra/vize durumu
  useEffect(() => { installWalkPositionSync(); }, []);
  useEffect(() => { if (scene) void loadWalkProgress(scene); }, [scene]);
  const walkStatus = useRef(false);
  const [walkMsg, setWalkMsg] = useState("");
  useEffect(() => {
    if (walkStatus.current === walkOn) return;
    walkStatus.current = walkOn;
    setWalkMsg(walkOn ? tw("status_on") : tw("status_off"));
    // W5: Akademi "Yürüme" dersi konum kaydına bakar; çıkışta kayıt yazıldıktan sonra yeniden değerlendirilsin
    if (!walkOn) scheduleAcademyLoad(1500);
  }, [walkOn, tw]);
  // W5: "Ben" görünümü sunucudan (yerel önbellek çevrimdışı); ilk yürüyüşte hiç kayıt yoksa editör bir kez açılır (§3.3)
  const editorOpen = useWalkEditor();
  const photoOn = useWalkPhoto();
  useEffect(() => { if (!bench) void loadMeLook(); }, [bench]);
  const askedLook = useRef(false);
  useEffect(() => {
    if (!walkOn || bench || askedLook.current) return;
    askedLook.current = true;
    // Kullanıcı geri bildirimi: "Yürü"ye basınca editör açılması yürüyüşü engelliyordu. Editör yalnız "Ben" düğmesiyle açılır;
    // kayıt yoksa bir kez sessiz bir ipucu duyurulur.
    void loadMeLook().then(() => { if (!hasStoredLook() && useWalkStore.getState().active) announceWalk(tx(WM, "me_hint")); });
  }, [walkOn, bench]);
  // W5 (yalnız geliştirme ölçümü): ?bench=N&walk=1 dünya kurulunca yürüme moduna girer (25 sahne perf kapısı)
  useEffect(() => {
    if (!import.meta.env.DEV || !bench || !new URLSearchParams(window.location.search).has("walk")) return;
    const id = window.setTimeout(() => world.current?.walkEnter(null), 1500);
    return () => window.clearTimeout(id);
  }, [bench, scene]);
  const walkName = useCallback((it: Pick<NearbyItem, "id" | "kind">) => {
    // WALK-EXPLORE: kapı, bilgi noktası, merdiven, seyir noktası, keşif parçası
    const xn = exploreName(it.id);
    if (xn) return xn;
    const ent = entityTypeOf(it.id);
    const sv = souvenirOfEntity(it.id);
    if (sv) return souvenirLabel(parseSouvenirId(sv)?.n ?? 1);
    const kindWord = tw(`kind_${it.kind}` as const);
    return actorBySlug.get(it.id)?.agent.name ?? (ent ? tw(`ent_${ent}` as const) : (isAmbientId(it.id) && ambientLabel(it.id))
      || kindWord.charAt(0).toLocaleUpperCase() + kindWord.slice(1));
  }, [actorBySlug, tw]);
  // FIX-UX: Yakındakiler tür adı — ajan unvanı, hayvan, nesne…; ad zaten türü söylüyorsa (pano, hatıra, ağaç) boş
  const walkType = useCallback((it: Pick<NearbyItem, "id" | "kind">) => {
    const a = actorBySlug.get(it.id)?.agent;
    if (a) return (a as { demo?: boolean }).demo ? tw("kind_test_agent") : a.title || tw("kind_agent");
    if (exploreName(it.id)) return "";
    if (it.kind === "board" || it.kind === "souvenir" || it.id.startsWith("hot:")) return "";
    return tw(`kind_${it.kind}` as const);
  }, [actorBySlug, tw]);
  // CORE-WALK: F istemi eylemle başlar — "Demo 3 ile konuş", "Otur", "Geçitten şehre geç"; ritüel etiketi zaten fiil ("Balık-patates ye")
  const walkAction = useCallback((it: Pick<NearbyItem, "id" | "kind">) => {
    const a = actorBySlug.get(it.id)?.agent;
    if (a) return tw("f_talk", { name: a.name });
    if (isCityDoorId(it.id)) return tw("f_door_city");
    if (isCityGateId(it.id)) return tw("f_gate_home");
    // CITYLIFE (B1): geçit istemi hedefi söyler ("İçeri gir — Galata Kulesi", "Dışarı çık — …", "Turnikeden geç — …")
    const da = doorAction(it.id);
    if (da) return da;
    const ent = entityTypeOf(it.id);
    if (ent) return tw(`f_${ent}` as const);
    if (souvenirOfEntity(it.id)) return tw("f_souvenir");
    // F istemi fiille başlar ve Yakındakiler eylemiyle (`targetAction`) aynı işi söyler: hayvan "Sev", pano/nesne "Aç", diğeri "Git"
    const act = targetAction(it.id, it.kind);
    return tw(it.kind === "animal" ? "f_animal" : act === "touch" ? "f_touch" : act === "open" ? "f_open" : act === "go" ? "f_go" : "f_look", { name: walkName(it) });
  }, [actorBySlug, tw, walkName]);
  // W3: F / Enter / Etkileşim → ajan için Konuş paneli, dünya nesnesi için kendi paneli (harici oturum: proje sayfası)
  const walkInteract = useCallback((id: string) => {
    if (id.startsWith("ext:")) { onWorldSelect(id); return; }
    // WALK-EXPLORE: kapıdan gir, merdiven/çıkış, seyir noktası, keşif parçası, bilgi notu
    if (exploreInteract(id)) return;
    if (actorBySlug.has(id)) { setHover(null); useWalkStore.getState().setPanel(talkPanelId(id)); return; }
    if (entityTypeOf(id)) { useWalkStore.getState().setPanel(entityPanelId(id)); return; }
    // W4: hatıra — F ile al (panel yok)
    const sv = souvenirOfEntity(id);
    if (sv) { pickupSouvenir(sv); return; }
    // hayvan / ağaç / su: mevcut Ambient dokunma tepkisi (kozmetik; panel yok)
    if (isAmbientId(id)) pokeAmbient(id);
  }, [actorBySlug, onWorldSelect]);
  const walkFocusWorld = useCallback(() => world.current?.focusWorld(), []);
  const walkExit = useCallback(() => world.current?.walkExit(), []);
  const walkTo = useCallback((x: number, z: number) => world.current?.walkTo(x, z), []);
  // E2 "Parselime git": yürüme moduna gir (kapalıysa), çevre akışı hazır olunca parsele ışınla (Outskirts), dünyayı göster
  const goPlot = useCallback((slot: number) => {
    if (!useWalkStore.getState().active) world.current?.walkEnter(savedWalkPosition(scene));
    usePlotStore.getState().set({ goto: slot });
    sectionRef.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    world.current?.focusWorld();
  }, [scene]);
  const pickAgent = useCallback((slug: string) => {
    if (!slug.startsWith("ext:")) select(slug);
    world.current?.focusAgent(slug);
  }, [select]);

  // Sahne: kilitli olanlar seçicide seçilemez; yeni sahne sunucuda henüz tanınmıyorsa yine de gösterilir ve uyarılır
  const [sceneNote, setSceneNote] = useState<string | null>(null);
  const pickScene = (id: WorldSceneId) => {
    setSceneNote(null);
    setScene(id as SceneId).catch(() => setSceneNote(t("page_scene_note", { scene: sceneDef(id).label })));
  };

  const addAgent = async () => {
    const a = await api.createAgent({ name: t("page_new_agent_name", { n: agents.length + 1 }), role: t("page_new_agent_role"), runtime: "direct" }); // S39 (C-16): beyni sunucu seçer (default_connection: ilk hazır beyin)
    upsert(a);
    select(a.slug);
  };

  // ölçüm çipi: React yeniden çizimi olmadan yazılır
  const perfEl = useRef<HTMLSpanElement>(null);
  const onPerf = useCallback((s: PerfSample) => {
    window.__voxcrewPerf = s;
    if (perfEl.current) perfEl.current.textContent = `${s.ms.toFixed(1)} ms (p95 ${s.p95.toFixed(1)}, ${t("perf_crowd")} ${s.crowdMs.toFixed(1)}) · ${s.calls} ${t("perf_calls")} · ${s.agents} ${t("perf_agents")}`;
  }, [t]);

  // Görünüm ölçeği: "fit" = dünya tüm pencereyi kaplar (CSS), "full" = tarayıcı tam ekranı (Fullscreen API). Esc ikisinden de çıkar.
  const [view, setView] = useState<"normal" | "fit" | "full">("normal");
  const canFullscreen = typeof document !== "undefined" && !!document.fullscreenEnabled;
  useEffect(() => {
    const onFs = () => setView((v) => (document.fullscreenElement ? "full" : v === "full" ? "normal" : v));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  useEffect(() => {
    if (view !== "fit") return;
    // S39: Esc önce üstteki pencereyi (Görev ver, ajan çekmecesi) kapatır; dünya ancak açık pencere yokken küçülür
    // W2: yürüme modunda Esc önce moddan çıkar (dünya kabı); pencere küçülmez
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !useWalkStore.getState().active && !document.querySelector('[aria-modal="true"]')) setView("normal"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);
  const toggleFit = () => setView((v) => (v === "fit" ? "normal" : "fit"));
  const toggleFull = () => {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => undefined); return; }
    // S39: belgenin tamamı tam ekrana alınır, dünya "fit" gibi pencereyi kaplar. Yalnız <section> tam ekran olsaydı
    // body'ye taşınan pencereler (Görev ver, ajan çekmecesi, bildirimler) tam ekranda görünmezdi.
    // tarayıcı izin vermezse (gömülü görünüm, politika) sessizce hiçbir şey olmasın diye pencereye sığdırmaya düşer
    const req = document.documentElement.requestFullscreen?.();
    if (!req) { setView("fit"); return; }
    void req.catch(() => setView("fit"));
  };
  // (K4): odak görünümü — yürürken (ayar açıkken) başlık, yan paneller ve bantlar gizli; lg ve üstünde bölüm
  // pencereyi kaplar. Esc / Çık normal görünüme döndürür (odak dünya kabına). HUD'daki tam ekran düğmesiyle girilen tam ekran
  // (ya da reddedilince düşülen "pencereye sığdır") yürüme bitince kapanır.
  const focus = useWalkFocus(walkOn, walkExit);
  const focusFs = useRef(false);
  const toggleFocusFull = () => { focusFs.current = !document.fullscreenElement; toggleFull(); };
  useEffect(() => {
    if (walkOn || !focusFs.current) return;
    focusFs.current = false;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setView((v) => (v === "fit" ? "normal" : v));
  }, [walkOn]);

  return (
    <div className="p-3 sm:p-5 flex flex-col gap-4 max-w-[1680px] mx-auto">
      {/* odak görünümünde başlık gizlenir ama ekran okuyucu için sayfanın h1'i kalır*/}
      {focus && <h1 className="sr-only">{t("page_title")}</h1>}
      <div className={focus ? "hidden" : "contents"}>
      <PageHeader title={t("page_title")}
        subtitle={<span className="hidden sm:inline">{t("page_subtitle", { scene: sceneDef(scene).label })}</span>}
        actions={<>
          {/* PANO-FIX (bilinçli küçük Dünya değişikliği): başlık eylemlerinin başında sakin, ikincil "Pano Görünümüne
              geç" — tek yol yan menüdeki anahtar değil. Dünya tuvali ve araç çubuğu aynı kalır; dar ekranda yalnız simge*/}
          <Button variant="ghost" icon={<LayoutDashboard size={16} aria-hidden />} title={tx(viewMsg, "to_board")} aria-label={tx(viewMsg, "to_board")}
            onClick={() => { void useUiMode.getState().setMode("board"); if (window.location.pathname !== "/") navigate("/"); }}>
            <span className="hidden 2xl:inline">{tx(viewMsg, "to_board")}</span>
          </Button>
          {/* mevcut dünyayı düzenle: kullanıcı dünyası doğrudan, yerleşik dünya senin sürümün (yoksa kopyası) açılır */}
          <Link to={`/dunya-yapici/${scene}`} className="btn"><Hammer size={16} aria-hidden />{t("page_edit_world")}</Link>
          <RecipeStartButton />
          <Button icon={<Plus size={16} />} onClick={addAgent} disabled={!!bench}>{t("page_add_agent")}</Button>
          <Button variant="primary" icon={<Send size={16} />} onClick={() => openComposer()}>{t("page_give_task")}</Button>
        </>} />
      {/* STORE-VISUAL: dar ekranda dünyanın üstünde tek sıra ince özet; geniş ekranda aynı özet sağ sütunun başındadır */}
      {!bench && <div className="xl:hidden"><WorldStatStrip waiting={waitingCount} running={running} stats={statData} /></div>}
      {!bench && <UsageStrip state={usage} className="xl:hidden" />}
      <AcademyCallout />
      </div>
      {/* S39: dünya ilk ekranda görünsün — haftalık özet ve dar ekrandaki ekip ilerlemesi dünyanın ALTINDA */}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-2 min-w-0">
        {/* geniş ekranda dünya, sağ sütunun (ekip + canlı akış) yüksekliğine kadar uzar; altta boş alan kalmaz.
            S39: üst sınır görünür alan − başlık/akademi şeridi (~13rem): mini harita, ilerleme ve çipler ilk ekranda kalsın */}
        <section ref={sectionRef} aria-label={t("page_world_aria")}
          className={clsx("panel relative overflow-hidden @container",
            // z-[35]: mobil alt çubuğun (30) üstünde, ajan çekmecesi (40), bildirimler (45) ve pencerelerin (50) altında
            view === "fit" ? "!fixed inset-2 z-[35] !rounded-xl shadow-2xl"
              : view === "full" ? "!fixed inset-0 z-[35] !rounded-none !border-0"
              // odak görünümü — lg ve üstünde pencereyi kaplar (dar ekranda yürüme düzeni aynı; yalnız başlık gizli)
              : focus ? "h-[calc(100dvh-8.5rem)] min-h-[420px] lg:!fixed lg:inset-0 lg:z-[35] lg:h-auto lg:min-h-0 lg:!rounded-none lg:!border-0"
              // UIUX-OVERLAP: lg altında yürürken bölüm üst ve alt çubuk arasındaki alanı alır (HUD bölgeleri — çubuk, paneller,
              // joystick, yapı paneli — 58vh'ye sığmıyordu); girişte useRevealOnEnter bölümü alt çubuğun üstüne kaydırır
              : clsx(walkOn ? "h-[calc(100dvh-8.5rem)] min-h-[420px]" : "h-[58vh] min-h-[380px]", "lg:h-[64vh] lg:min-h-[380px] xl:h-[calc(100dvh-13rem)] xl:min-h-[420px]"),
            // yatay telefonda (yükseklik ≤ 480) yürürken bölüm pencereyi kaplar — üst çubuk ve alt sekme
            // çubuğu sahneden ~135 px yiyordu, bölüm (min 420 px) görünür alandan uzundu: kat seçici ve menü öğeleri alt çubuğun altında kalıyordu
            walkOn && view === "normal" && "short:!fixed short:inset-0 short:z-[35] short:!h-auto short:!min-h-0 short:!rounded-none short:!border-0")}>
          <World ref={world} scene={scene as WorldSceneId} agents={actors} selected={selected} onSelect={onWorldSelect} handoffs={handoffs}
            teams={worldTeams} onTeamClick={(slug) => navigate(`/ofis#ekip-${slug}`)} onHover={onHover} hovered={hover?.slug ?? null}
            goals={goals} focusTeam={focusTeam} live={live} onBuilt={setMapBuilt} onPerf={bench ? onPerf : undefined} onInteract={walkInteract}
            exhibits={exhibitsData.items} exhibitLabels={exhibitLabels} onExhibit={setExhibitSel} />
          {exhibitSel && !walkOn && <ExhibitCard id={exhibitSel} items={exhibitsData.items} onClose={closeExhibit} />}
          <span className="sr-only" role="status" aria-live="polite">{walkMsg}</span>
          {/* sahne seçici (kök tüm alanı kaplar ki açılır panel kısa ekranda da sığsın); yürürken yerini yürüme HUD'u alır */}
          {walkOn
            ? <WalkHud nameOf={walkName} typeOf={walkType} actionOf={walkAction} onExit={walkExit} onInteract={walkInteract} onWalkTo={walkTo} onFocusWorld={walkFocusWorld} host={sectionRef} />
            : <ScenePicker className="absolute inset-3 z-20" value={scene as WorldSceneId} onPick={pickScene} />}
          {/* E3: yapı modu (İnşa / B) — sahiplenilmiş parselde koy/kır, palet, geri al, kaydet */}
          {/* WALK-EXPLORE: geçiş kararması, keşif izleyicisi (K) ve bilgi notu */}
          {walkOn && !bench && <ExploreHud />}
          {/* tek düğmeyle tarayıcı tam ekranı (HUD eylem yuvası; ince işaretçi ve destek varsa)*/}
          {walkOn && !photoOn && <FocusFullscreenButton full={view === "full"} onToggle={toggleFocusFull} />}
          {walkOn && !bench && scene && !inside && <Suspense fallback={null}><BuildHud world={scene} swatch={sceneDef(scene).swatch?.[0] ?? null} onFocusWorld={walkFocusWorld} /></Suspense>}
          {/* araçlar: geniş ekranda sağ üstte (kamera düğmelerinin solunda); dar ekranda dünyayı örtmesin diye
              dünyanın altında akış içinde (S39) */}
          {!walkOn && (
          <div className="hidden sm:flex absolute top-14 @4xl:top-3 left-3 right-14 z-10 justify-end pointer-events-none">
            <WorldTools agents={findable} teams={worldTeams} focusTeam={focusTeam} onFocusTeam={setFocusTeam} onPick={pickAgent} walk={walkToggle} />
          </div>
          )}
          {!walkOn && (
          <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
            <Button size="sm" icon={<LocateFixed size={15} />} onClick={() => world.current?.resetCamera()} title={t("page_reset_camera")} aria-label={t("page_reset_camera")} />
            <Button size="sm" icon={<ZoomIn size={15} />} onClick={() => world.current?.zoom(0.8)} title={t("page_zoom_in")} aria-label={t("page_zoom_in")} />
            <Button size="sm" icon={<ZoomOut size={15} />} onClick={() => world.current?.zoom(1.25)} title={t("page_zoom_out")} aria-label={t("page_zoom_out")} />
            {view !== "full" && (
              <Button size="sm" icon={view === "fit" ? <Minimize2 size={15} /> : <Maximize2 size={15} />} onClick={toggleFit}
                aria-pressed={view === "fit"} title={view === "fit" ? t("page_exit_fit") : t("page_fit_window")}
                aria-label={view === "fit" ? t("page_exit_fit") : t("page_fit_window")} />
            )}
            {canFullscreen && (
              <Button size="sm" icon={view === "full" ? <Shrink size={15} /> : <Expand size={15} />} onClick={toggleFull}
                aria-pressed={view === "full"} title={view === "full" ? t("page_exit_fullscreen") : t("page_fullscreen")}
                aria-label={view === "full" ? t("page_exit_fullscreen") : t("page_fullscreen")} />
            )}
          </div>
          )}
          {/* W5: fotoğraf modunda HUD (mini harita dahil) gizli */}
          {/* FIX-UX: yürürken --walk-inset-b (sabit mobil alt çubuk) kadar yukarıda; mod kapalıyken değişken yok → 0*/}
          {!photoOn && <MiniMap className="absolute right-[max(0.75rem,env(safe-area-inset-right))] bottom-[calc(var(--walk-inset-b,0px)_+_0.75rem)] z-10" live={live} teams={worldTeams} selected={selected} built={mapBuilt}
            onGo={(x, z) => (walkOn ? world.current?.walkTo(x, z) : world.current?.panTo(x, z))} onZoom={(f) => world.current?.zoom(f)} onFocusTeam={(slug) => world.current?.focusTeam(slug)} />}
          {hover && hovered && (
            <AgentCard wa={hovered} anchor={hover} onEnter={keepCard} onLeave={dropCard} onClose={closeCard}
              routeLabel={hovered.external ? null : agents.find((a) => a.slug === hovered.agent.slug)?.route?.label}
              teamName={hovered.agent.team ? teams.find((tm) => tm.slug === hovered.agent.team)?.name : null}
              projectKey={hovered.external ? liveExternals.find((e) => `ext:${e.id}` === hovered.agent.slug)?.projectKey : null}
              onOpenAgent={(slug) => { closeCard(); select(slug); }} />
          )}
          {/* alt şerit (S39): ekip ilerlemesi + durum çipleri AYNI akışta (üst üste binmez); sağda mini harita için
              boşluk bırakılır. Kullanım ipucu dünyanın altında, çerçevenin dışında. */}
          <div className={clsx("absolute bottom-3 left-3 right-[calc(var(--mm-w,2.25rem)+1.25rem)] z-10 flex flex-wrap items-end gap-1.5 pointer-events-none", walkOn && "hidden")}>
            <div className="hidden sm:block empty:hidden pointer-events-auto"><WorldProgress variant="overlay" /></div>
            <span className="chip !bg-panel/90"><Users size={12} />{t("page_chip_agents", { n: visible.length })}</span>
            {benchedCount > 0 && <span className="chip !bg-panel/90">{t("page_chip_bench", { n: benchedCount })}</span>}
            <span className="chip !bg-panel/90"><Activity size={12} />{t("page_chip_running", { n: running })}</span>
            <WorkZoneChips />
            {extActors.length > 0 && <span className="chip !bg-panel/90"><Headphones size={12} />{t("page_chip_external", { n: extActors.length })}</span>}
            {bench && layout.extra > 0 && <span className="chip !bg-panel/90"><Grid2x2 size={12} />{t("page_chip_modules", { n: layout.extra + 1, w: layout.width, d: layout.depth })}</span>}
            {!bench && <span className="chip !bg-panel/90 hidden md:inline-flex"><Brain size={12} />{t("page_chip_nodes", { n: fmtNumber(stats?.nodes ?? 0) })}</span>}
            {bench && <span className="chip tone-warn !whitespace-normal max-w-full"><Gauge size={12} /><span ref={perfEl}>{t("page_bench", { n: bench.n, e: bench.ext })}</span></span>}
            {sceneNote && (
              <span role="status" className="chip tone-warn pointer-events-auto !whitespace-normal max-w-full">
                {sceneNote}
                <button type="button" className="btn btn-sm btn-ghost btn-icon shrink-0" aria-label={t("page_close_warning")} onClick={() => setSceneNote(null)}>
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
          {!visible.length && (
            <div className="absolute inset-0 grid place-items-center pointer-events-none">
              <div className="panel p-5 pointer-events-auto"><Empty title={t("page_empty_title")} text={t("page_empty_text")} action={<Button variant="primary" onClick={addAgent}>{t("page_add_agent")}</Button>} /></div>
            </div>
          )}
        </section>
        <div className="sm:hidden">
          <WorldTools className="!max-w-full" compact agents={findable} teams={worldTeams} focusTeam={focusTeam} onFocusTeam={setFocusTeam} onPick={pickAgent} walk={walkToggle} />
        </div>
        <p className="hidden md:block px-1 text-xs text-muted">{t("page_hint")}</p>
        <div className="sm:hidden empty:hidden"><WorldProgress variant="strip" /></div>
        </div>

        {/* S39 (C-01): geniş ekranda sağ sütun satır yüksekliğine katkı vermez (absolute), dünyanın yüksekliğini alır;
            ekip listesi kalan alanı doldurup kendi içinde kayar — dünyanın altında boş alan kalmaz, kaplamalar ilk ekranda */}
        <div className={clsx("min-w-0 xl:relative", focus && "hidden")}>
        <div className="flex flex-col gap-4 min-w-0 xl:absolute xl:inset-0">
          {!bench && <div className="hidden xl:block xl:shrink-0"><WorldStatStrip waiting={waitingCount} running={running} stats={statData} /></div>}
          {!bench && <UsageStrip state={usage} className="hidden xl:flex xl:shrink-0" />}
          <Panel className="xl:flex-1 xl:min-h-0" bodyClass="xl:flex-1 xl:flex xl:flex-col xl:min-h-0" title={t("page_team")} icon={<Users size={16} />} actions={hidden > 0 && (
            <Button size="sm" variant="ghost" icon={<Eye size={14} />} onClick={() => setShowHidden((v) => !v)}>{showHidden ? t("page_hide") : t("page_hidden_n", { n: hidden })}</Button>)}>
            <ul className="flex flex-col gap-1.5 max-h-[64vh] xl:max-h-none xl:flex-1 xl:min-h-0 overflow-y-auto">
              {byTeam(showHidden ? agents : listed).map((a) => {
                const mood = moodOf(a);
                const av = bench ? { ok: true } : agentAvailability(a, conns);
                const st = states[a.slug] ?? a.state;
                const team = teams.find((tm) => tm.slug === a.team);
                return (
                  <WorldAgentStatusRow key={a.slug} a={a} mood={mood} avOk={av.ok} avReason={(av as { reason?: string }).reason}
                    activity={st?.activity} teamName={team?.name} teamColor={team?.color}
                    work={actorBySlug.get(a.slug)?.work ?? null} selected={selected === a.slug} onPick={pickAgent} onTask={openComposer} />
                );
              })}
            </ul>
            {liveExternals.length > 0 && (
              <div className="mt-3 pt-3 border-t-2 border-line-soft">
                <h3 className="t-overline text-muted mb-1.5 flex items-center gap-1.5"><Headphones size={14} aria-hidden="true" />{t("page_external_sessions")}</h3>
                <ul className="flex flex-col gap-1 max-h-[32vh] overflow-y-auto">
                  {liveExternals.map((e) => {
                    const meta = EXT_META[e.source] ?? EXT_META["claude-code"];
                    const id = externalIdentity(e);
                    return (
                      <li key={e.id}>
                        <Link to={`/projeler/${encodeURIComponent(e.projectKey)}`}
                          className={clsx("flex items-center gap-2.5 rounded-xl p-2 hover:bg-panel-2 min-w-0", e.isSubagent && "ml-6")}>
                          <PixelFace avatar={id.avatar} mood={externalMood(e)} size={e.isSubagent ? 30 : 38} ring={meta.color} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-sm truncate">{id.name}</span>
                              <Badge tone={e.status === "waiting" ? "warn" : e.status === "active" ? "info" : "muted"} className="!px-1.5">
                                {extStatusLabel(e.status)}
                              </Badge>
                            </span>
                            <span className="text-xs text-muted truncate block">
                              {meta.label}{e.isSubagent ? ` · ${t("ext_subagent")}` : ""}{e.activity ? ` · ${e.activity}` : e.title ? ` · ${e.title}` : ""}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Panel>
          <Panel className="xl:shrink-0" title={t("page_live_feed")} icon={<Activity size={16} />} bodyClass="max-h-[340px] xl:max-h-[min(340px,30vh)] overflow-y-auto">
            <LiveFeed />
          </Panel>
        </div>
        </div>
      </div>

      {editorOpen && <Suspense fallback={null}><MeEditor onClosed={walkFocusWorld} /></Suspense>}

      {/* odak görünümünde alttaki kartlar ve paneller gizli (söküm yok: durumları korunur)*/}
      <div className={focus ? "hidden" : "contents"}>
      {/* ilk oturum adımları (ilk kabul edilen teslime kadar; kapatılabilir)*/}
      <FirstSessionCard />
      {/* S35 haftalık özet (S39: dünyanın altına taşındı; dünyayı ilk ekranın dışına itmesin) */}
      <RecapCard />
      {/* G2-D R-3: isteğe bağlı haftalık "eğlenceli miydi?" (varsayılan kapalı; kapatılırsa gelecek haftaya kadar gelmez) */}
      <FunCheckCard />
      {/* CG2: bu hafta kabul edilen işlerle tahmini kazanılan zaman (iş yoksa çizilmez) */}
      <TimeSavedCard />
      {/* kabul edilen işlerin arşivi (dünyadaki sıranın erişilebilir listesi; tezgâh ölçümünde yok)*/}
      {!bench && <ArchivePanel items={exhibitsData.items} total={exhibitsData.total} selected={exhibitSel} />}
      {/* E2: parseller (sahiplen, liste, "Parselime git"; tezgâh ölçümünde yok) */}
      {!bench && scene && <PlotsPanel world={scene} onGo={goPlot} />}

      <Panel title={t("page_recent_runs")} actions={<Link to="/gorevler" className="text-sm font-semibold text-link hover:underline underline-offset-2">{t("page_all")}</Link>}>
        {userRunList.length === 0 ? (
          <Empty title={t("page_no_runs_title")} text={t("page_no_runs_text")} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {userRunList.slice(0, 8).map((r) => (
              <Link key={r.id} to={`/gorevler/${r.id}`} className="panel-soft p-3 hover:border-ink-2 transition-colors flex flex-col gap-2 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-2">
                    {[...new Set(r.steps.map((s) => s.agent).filter(Boolean))].slice(0, 3).map((slug) => {
                      const a = agents.find((x) => x.slug === slug);
                      return a ? <PixelFace key={slug} avatar={a.avatar} size={26} className="bg-panel border-2 border-panel" /> : null;
                    })}
                  </div>
                  <StatusPill status={r.status} />
                  <span className="ml-auto text-xs text-muted num whitespace-nowrap">{timeAgo(r.started_at)}</span>
                </div>
                <div className="font-semibold text-sm line-clamp-2">{r.title}</div>
              </Link>
            ))}
          </div>
        )}
      </Panel>
      </div>
    </div>
  );
}
