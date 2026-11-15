/**
 * Hermes dosyalarına yazmadan önce kullanıcıya diff'i gösteren onay penceresi (teknik lider; S1/S2 kullanır).
 * Akış: özellik uç noktası bir ChangePlan döner → bu pencere açılır → kullanıcı "Onayla ve uygula" derse
 * /api/changes/plans/{id}/apply çağrılır (yedek alınır, geri alınabilir).
 */
import clsx from "clsx";
import { FileDiff, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { changesApi, type ChangeEntry, type ChangePlan } from "../lib/changes";
import { useT } from "../lib/i18n";
import { changeReviewMsg as m } from "../locales/gateway";
import { Button, Modal } from "./ui";

export function ChangeReviewModal({ plan, onClose, onApplied, title }:
  { plan: ChangePlan | null; onClose: () => void; onApplied?: (e: ChangeEntry) => void; title?: string }) {
  const t = useT(m);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!plan) return null;
  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const entry = await changesApi.apply(plan.id);
      onApplied?.(entry);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={title ?? t("title")} width={820}
      footer={<>
        <span className="mr-auto text-xs text-muted self-center">{t("footer")}</span>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="primary" icon={<ShieldCheck size={16} />} disabled={busy || plan.no_change} onClick={apply}>
          {busy ? t("applying") : t("confirm_apply")}
        </Button>
      </>}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 text-sm">
          <FileDiff size={18} className="text-accent shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="font-semibold">{plan.summary}</div>
            <div className="font-mono text-xs text-muted break-all">{plan.path}{plan.exists ? "" : t("new_file")}</div>
          </div>
        </div>
        {plan.no_change ? (
          <p className="text-sm text-muted">{t("no_change")}</p>
        ) : (
          <pre className="font-mono text-xs leading-relaxed panel-soft p-3 max-h-[55vh] overflow-auto">
            {plan.diff.map((l, i) => (
              <div key={i} className={clsx(
                l.startsWith("+") && !l.startsWith("+++") && "text-ok bg-[var(--ok-bg)]",
                l.startsWith("-") && !l.startsWith("---") && "text-bad bg-[var(--bad-bg)]",
                l.startsWith("@@") && "text-info")}>{l || " "}</div>
            ))}
          </pre>
        )}
        <p className="text-xs text-muted">{t("masked")}</p>
        {error && <div className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-3 text-sm">{error}</div>}
      </div>
    </Modal>
  );
}
