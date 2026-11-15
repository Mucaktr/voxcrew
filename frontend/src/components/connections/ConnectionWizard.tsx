// S29 — Bağlantı sihirbazı: sağlayıcı kartları (tek birincil eylem), otomatik tarama, "Hepsini otomatik kur",
// eylem pencereleri (model indirme, Hermes klasörü, OpenAI uyumlu sunucu, API sunucusu). Sihirbaz adımı ve
// Bağlantılar sayfası aynı bileşeni kullanır; Hermes sayfası durum bölümünü aynı kaynaktan okur.
import { HardDrive, Plus, RefreshCcw, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BRAND } from "../../lib/brand";
import { BRAIN_KINDS, connectionsApi, connOf, publishStates, refreshConnections, useConnectionStates, type ConnectionState, type ProviderKind } from "../../lib/connections";
import { useT } from "../../lib/i18n";
import { cx } from "../../locales/connections";
import { GatewayPanel } from "../gateway/GatewayPanel";
import { Button, Modal, Spinner } from "../ui";
import { useConnectionActions, type ModalKind } from "./actions";
import { HermesHomePicker } from "./HermesHomePicker";
import { InstallGuide } from "./InstallGuide";
import { INSTALL_GUIDES, isGuideKind } from "./installGuides";
import { ModelSetup } from "./ModelSetup";
import { OpenAICompatForm } from "./OpenAICompatForm";
import { ProviderCard, ProviderDetailDrawer, ProviderSummaryCard } from "./ProviderCard";

const ORDER: ProviderKind[] = ["ollama", "codex", "claude", "hermes", "openai_compat", "gemini"];
/** Önerilen beyin sırası (sunucu: service.DEFAULT_BRAIN_ORDER, agents.default_connection ile aynı). */
const DEFAULT_BRAIN_ORDER: ProviderKind[] = ["ollama", "codex", "claude", "openai_compat"];

/** Açılışta ve her eylemden sonra tarama; bir sağlayıcı hâlâ kontrol ediliyorsa 2 sn'de bir tazele (eski yanıt yeniyi ezmez: sunucu sürümler). */
export function useAutoScan(enabled = true) {
  const conns = useConnectionStates();
  const [scanning, setScanning] = useState(false);
  const rescan = useCallback(async () => {
    setScanning(true);
    try { publishStates(await connectionsApi.rescan(3)); } catch { /* ağ hatası: kartlar son durumu gösterir */ } finally { setScanning(false); }
  }, []);
  useEffect(() => { if (enabled) void rescan(); }, [enabled, rescan]);
  const checking = conns.some((c) => c.checking);
  // "kontrol ediliyor" bitene kadar 2 sn'de bir tazele (ilk tarama kapalı olsa da: Hermes sayfası durum bölümü)
  useEffect(() => {
    if (!checking) return;
    const id = window.setTimeout(() => { void refreshConnections(false, 0).catch(() => undefined); }, 2000);
    return () => window.clearTimeout(id);
  }, [checking, conns]);
  return { conns, scanning, rescan };
}

export function ConnectionWizard({ kinds = ORDER, showAuto = true, intro = true, compact, view = "full" }: {
  kinds?: ProviderKind[]; showAuto?: boolean; intro?: boolean; compact?: boolean;
  /** `summary` (UI-CLARITY): sade kartlar, ayrıntı çekmecede. `full`: eski tam kart (kurulum sihirbazı). */
  view?: "full" | "summary";
}) {
  const t = useT(cx);
  const { conns, scanning, rescan } = useAutoScan();
  const [modal, setModal] = useState<ModalKind>(null);
  const [modalArgs, setModalArgs] = useState<Record<string, unknown> | undefined>();
  const openModal = useCallback((m: ModalKind, args?: Record<string, unknown>) => { setModal(m); setModalArgs(args); }, []);
  const { run, busy, feedback, tests } = useConnectionActions(openModal);
  const [auto, setAuto] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProviderKind | null>(null);
  // SETUP derin bağlantılar: ?ekle=model → Model API'leri ön ayar galerisi; ?kur=<codex|claude|hermes|ollama> → rehber
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const add = params.get("ekle");
    const guide = params.get("kur");
    if (add === "model") openModal("openai_compat", { add: true });
    else if (isGuideKind(guide)) openModal("install", { kind: guide });
    else return;
    const next = new URLSearchParams(params);
    next.delete("ekle"); next.delete("kur");
    setParams(next, { replace: true });
  }, [params, setParams, openModal]);

  const cards = useMemo(() => kinds.map((k) => connOf(conns, k)).filter((c): c is ConnectionState => !!c), [conns, kinds]);
  const brains = cards.filter((c) => BRAIN_KINDS.includes(c.kind) && c.ready === "ok");
  const hermes = connOf(conns, "hermes");
  const recommended = DEFAULT_BRAIN_ORDER.map((k) => brains.find((b) => b.kind === k)).find(Boolean);
  const detailCard = detail ? cards.find((x) => x.kind === detail) ?? null : null;
  const guideKind = modal === "install" && isGuideKind(modalArgs?.kind) ? modalArgs.kind : null;

  /** Güvenli adımlar: keşif → Hermes klasörü önerisi → Ollama'yı başlat → model yoksa indirme penceresi (onayla). */
  const autoSetup = async () => {
    setAuto(t("auto_running"));
    let did = 0;
    try {
      const fresh = await connectionsApi.rescan(5);
      publishStates(fresh);
      const h = fresh.find((c) => c.kind === "hermes");
      const better = h?.problems.find((p) => p.code === "hermes_home_wrong")?.fix;
      if (better?.args?.path) { await connectionsApi.setHermesHome(String(better.args.path)); did++; }
      const o = fresh.find((c) => c.kind === "ollama");
      if (o?.problems.some((p) => p.code === "ollama_stopped" && p.fix)) { await connectionsApi.ollamaStart(); did++; }
      await refreshConnections(true);
      const after = await connectionsApi.list(false, 4, true);
      publishStates(after);
      const o2 = after.find((c) => c.kind === "ollama");
      if (o2?.problems.some((p) => p.code === "ollama_no_models")) { openModal("models"); did++; }
      setAuto(did ? t("auto_done") : t("auto_nothing"));
    } catch (e) {
      setAuto(e instanceof Error ? e.message : String(e));
    }
  };

  const close = () => { setModal(null); void refreshConnections(true); };

  return (
    <div className="flex flex-col gap-4">
      {intro && <p className="text-sm text-ink-2">{t("wizard_intro", { brand: BRAND.name })}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => { void rescan(); }} disabled={scanning} icon={scanning ? <Spinner size={13} /> : <RefreshCcw size={14} />}>
          {scanning ? t("scanning") : t("rescan")}
        </Button>
        {showAuto && (
          <Button size="sm" variant="primary" icon={<Wand2 size={14} />} disabled={!!auto && auto === t("auto_running")} onClick={autoSetup} title={t("auto_setup_hint")}>
            {t("auto_setup")}
          </Button>
        )}
        <Button size="sm" icon={<Plus size={14} />} aria-label={t("add_model_aria")} onClick={() => openModal("openai_compat", { add: true })}>
          {t("add_model")}
        </Button>
        {auto && <span role="status" className="text-xs text-ink-2">{auto}</span>}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" aria-label={t("title")}>
        {cards.map((c) => (
          <li key={c.kind} className="min-w-0 flex">
            <div className="flex-1 min-w-0 flex flex-col">
              {view === "summary" ? (
                <ProviderSummaryCard c={c} onAction={run} busy={busy} test={tests[c.kind]} onOpen={() => setDetail(c.kind)}
                  feedback={feedback?.provider === c.kind ? feedback : null} />
              ) : (
                <ProviderCard c={c} onAction={run} busy={busy} test={tests[c.kind]} compact={compact}
                  feedback={feedback?.provider === c.kind ? feedback : null} />
              )}
            </div>
          </li>
        ))}
      </ul>
      {cards.length > 0 && brains.length === 0 && (
        <div role="status" className="chip tone-warn !whitespace-normal !items-start !rounded-lg p-3 text-sm font-medium">{t("no_brain")}</div>
      )}
      {recommended && brains.length > 1 && (
        <p role="status" className="text-xs text-muted">{t("recommended_brain", { name: recommended.name })}</p>
      )}
      {brains.length > 0 && hermes && !hermes.installed && (
        <div role="status" className="chip tone-info !whitespace-normal !items-start !rounded-lg p-3 text-sm font-medium">
          {t("hermes_absent_fine", { brains: brains.map((b) => b.name).join(", ") })}
        </div>
      )}

      {view === "summary" && detailCard && (
        <ProviderDetailDrawer c={detailCard} open onClose={() => setDetail(null)} onAction={run} busy={busy} test={tests[detailCard.kind]}
          feedback={feedback?.provider === detailCard.kind ? feedback : null} />
      )}

      {modal === "models" && (
        <Modal open onClose={close} title={t("models_title")} width={820}><ModelSetup /></Modal>
      )}
      {modal === "hermes_home" && (
        <Modal open onClose={close} title={t("home_title")} width={640}><HermesHomePicker onDone={close} suggest={typeof modalArgs?.path === "string" ? modalArgs.path : undefined} /></Modal>
      )}
      {modal === "openai_compat" && (
        <Modal open onClose={close} title={modalArgs?.add ? t("add_model") : t("compat_title")} width={680}>
          <div className="flex flex-col gap-3">
            {Boolean(modalArgs?.add) && (
              <>
                <div className="panel-soft p-2.5 flex flex-wrap items-center gap-2 text-sm">
                  <HardDrive size={16} className="shrink-0 text-ink-2" aria-hidden />
                  <span className="flex-1 min-w-[min(100%,14rem)]">{t("add_model_local")}</span>
                  <Button size="sm" onClick={() => openModal("models")}>{t("add_model_local_btn")}</Button>
                </div>
                <p className="text-xs text-muted">{t("add_model_policy")}</p>
              </>
            )}
            <OpenAICompatForm state={connOf(conns, "openai_compat")} initial={modalArgs} onDone={close} />
          </div>
        </Modal>
      )}
      {guideKind && (
        <Modal open onClose={close} title={t("g_title", { name: INSTALL_GUIDES[guideKind].name })} width={720}>
          <InstallGuide kind={guideKind} state={connOf(conns, guideKind)} />
        </Modal>
      )}
      {modal === "gateway" && (
        <Modal open onClose={close} title={t("hermes_api_section")} width={900}><GatewayPanel /></Modal>
      )}
    </div>
  );
}
