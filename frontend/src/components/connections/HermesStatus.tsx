// S29 — Hermes sayfası "Kurulum" bölümü: durum aynı kaynaktan (store → ConnectionService); "bulunamadı" yalnızca
// gerçekten yoksa, istek hatasında "kontrol edilemedi — yeniden dene". API sunucusu etkinleştirme/başlatma aynı GatewayPanel.
import { ChevronDown, ChevronRight, Feather, RefreshCcw } from "lucide-react";
import { useCallback, useState } from "react";
import { connOf, useConnectionStates, type ConnectionState, type Fix } from "../../lib/connections";
import { useT } from "../../lib/i18n";
import { cx } from "../../locales/connections";
import { GatewayPanel } from "../gateway/GatewayPanel";
import { Button, Empty, Panel } from "../ui";
import { useConnectionActions, type ModalKind } from "./actions";
import { HermesHomePicker } from "./HermesHomePicker";
import { ProviderCard } from "./ProviderCard";
import { useAutoScan } from "./ConnectionWizard";

export function HermesStatus({ overviewError, onRetry, home, showGateway = true, empty }: {
  overviewError?: string | null; onRetry?: () => void; home?: string; showGateway?: boolean; empty?: boolean;
}) {
  const t = useT(cx);
  const conns = useConnectionStates();
  const { rescan, scanning } = useAutoScan(false);
  const hermes = connOf(conns, "hermes");
  const [picker, setPicker] = useState<false | { suggest?: string }>(false);
  const [gw, setGw] = useState(showGateway);
  const openModal = (m: ModalKind, args?: Record<string, unknown>) => {
    if (m === "hermes_home") setPicker({ suggest: typeof args?.path === "string" ? args.path : undefined });
    if (m === "gateway") setGw(true);
  };
  const { run, busy, feedback, tests } = useConnectionActions(openModal);
  // klasör değişince sayfa başlığı (Hermes özeti) da tazelenir; aksi hâlde başlık eski klasörü gösteriyordu (QA-F56)
  const onAction = useCallback(async (c: ConnectionState, fix: Fix | null | undefined, action?: string) => {
    await run(c, fix, action);
    if ((action ?? fix?.action) === "hermes.apply_home") onRetry?.();
  }, [run, onRetry]);

  if (overviewError && !hermes) {
    return <Empty icon={<Feather size={28} />} title={t("hermes_not_checked")} text={overviewError}
      action={<Button icon={<RefreshCcw size={14} />} onClick={() => { onRetry?.(); void rescan(); }}>{t("rescan")}</Button>} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {hermes && (
        <ProviderCard c={hermes} onAction={onAction} busy={busy} test={tests.hermes} feedback={feedback?.provider === "hermes" ? feedback : null} />
      )}
      {/* "veri kökü değil" yalnızca klasör gerçekten Hermes'e benzemiyorsa; klasör doğru ama çalıştırıcı yoksa kart
          "komut bulunamadı" der (veri kökü ≠ çalıştırıcı, çelişen durum yok, QA-F56)*/}
      {hermes && !hermes.installed && !hermes.extra.home_ok && (
        <Panel title={t("hermes_not_found")}>
          <p className="text-sm text-ink-2 mb-3">{t("hermes_not_found_text", { home: home ?? hermes.extra.home ?? "" })}</p>
          <HermesHomePicker onDone={() => { onRetry?.(); }} />
        </Panel>
      )}
      {empty && hermes?.installed && <p role="status" className="text-sm text-ink-2">{t("hermes_empty")}</p>}
      {overviewError && hermes?.installed && (
        <div role="alert" className="chip tone-warn !rounded-lg !whitespace-normal !items-start p-3 text-sm font-medium flex-wrap gap-2">
          <span className="flex-1">{t("hermes_not_checked")} {overviewError}</span>
          <Button size="sm" variant="ghost" icon={scanning ? undefined : <RefreshCcw size={13} />} onClick={() => { onRetry?.(); void rescan(); }}>{t("rescan")}</Button>
        </div>
      )}
      {picker && (
        <Panel title={t("home_title")}><HermesHomePicker suggest={picker.suggest} onDone={() => { setPicker(false); onRetry?.(); }} /></Panel>
      )}
      {hermes?.installed && (
        <div>
          <button type="button" className="flex items-center gap-1 text-xs font-semibold text-muted" aria-expanded={gw} onClick={() => setGw((v) => !v)}>
            {gw ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}{t("hermes_api_section")}
          </button>
          {gw && <div className="mt-2"><GatewayPanel /></div>}
        </div>
      )}
    </div>
  );
}
