// S29 — satır içi "hazır değil" ipucu + tek düzeltme düğmesi (BrainPicker, TaskComposer için).
// Ör. "Ollama kapalı — Başlat". Mantık actions.ts'te; burada yalnızca gösterim.
import { AlertTriangle } from "lucide-react";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { connOf, notReadyReason, useConnectionStates, type ProviderKind } from "../../lib/connections";
import { useT } from "../../lib/i18n";
import { cx } from "../../locales/connections";
import { Button, Spinner } from "../ui";
import { useConnectionActions } from "./actions";

export function NotReadyHint({ kind, className }: { kind: ProviderKind; className?: string }) {
  const t = useT(cx);
  const conns = useConnectionStates();
  const navigate = useNavigate();
  const c = connOf(conns, kind);
  const reason = notReadyReason(c);
  const openModal = useCallback(() => navigate("/baglantilar"), [navigate]);
  const { run, busy, feedback } = useConnectionActions(openModal);
  if (!c || !reason) return null;
  const direct = reason.fix && reason.fix.kind === "button" && !["ollama.pick_model", "hermes.pick_home", "openai_compat.pick", "openai_compat.edit", "hermes.enable_api", "hermes.start_gateway"].includes(reason.fix.action ?? "");
  return (
    <div className={`rounded-lg border-2 tone-warn px-2.5 py-1.5 text-xs flex flex-wrap items-center gap-2 ${className ?? ""}`} role="status">
      <AlertTriangle size={13} className="shrink-0" aria-hidden />
      <span className="flex-1 min-w-[10rem]">{feedback?.text ?? reason.message}</span>
      {reason.fix && (
        <Button size="sm" variant="ghost" disabled={!!busy} icon={busy ? <Spinner size={12} /> : undefined}
          onClick={() => (direct ? run(c, reason.fix) : navigate(reason.fix?.guide ? `/baglantilar?kur=${reason.fix.guide}` : "/baglantilar"))}>
          {direct ? reason.fix.label : t("inline_go")}
        </Button>
      )}
    </div>
  );
}
