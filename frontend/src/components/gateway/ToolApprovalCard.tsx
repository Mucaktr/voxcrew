/**
 * Görev adımı içindeki araç onayı kartı (Ekip S2) + verilmiş kararların listesi + "Gönderilen" satırı.
 * Hermes API `approval.request` → adım `awaiting_tool_approval`. Stüdyo hiçbir onayı kendiliğinden vermez;
 * süre dolarsa (sunucu ~290 sn) "Reddet" gönderilir.
 */
import clsx from "clsx";
import { Ban, Check, CheckCheck, Clock, Infinity as InfinityIcon, Send, ShieldAlert, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import {
  gatewayApi, invocationLine, type ApprovalChoice, type StepInvocation, type ToolApprovalRecord, type ToolApprovalRequest,
} from "../../lib/gateway";
import { fmtDate, useT } from "../../lib/i18n";
import { gatewayMsg as m } from "../../locales/gateway";
import { Rich } from "../hermes/common";
import { Badge, Button } from "../ui";

const HIGH_RISK = /\brm\s+-[a-z]*r|\brmdir\b|\bdel\s+\/|\bformat\b|\bmkfs\b|\bshutdown\b|\breg\s+delete\b|curl[^|\n]*\|\s*(ba|z)?sh|wget[^|\n]*\|\s*(ba|z)?sh|chmod\s+-?R?\s*777|drop\s+(table|database)|git\s+push\s+.*--force|Remove-Item\b.*-Recurse/i;

function useCountdown(expiresAt?: number): number | null {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!expiresAt) return;
    const t = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(t);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.round(expiresAt - now)) : null;
}

/** Verilmiş karar etiketi (lib/gateway CHOICE_LABEL yerine dil duyarlı). */
const CHOICE_KEY: Record<ApprovalChoice, "choice_once" | "choice_session" | "choice_always" | "choice_deny"> = {
  once: "choice_once", session: "choice_session", always: "choice_always", deny: "choice_deny",
};

function mmss(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ToolApprovalCard({ runId, req, agentName }: { runId: string; req: ToolApprovalRequest; agentName?: string }) {
  const t = useT(m);
  const [busy, setBusy] = useState<ApprovalChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmAlways, setConfirmAlways] = useState(false);
  const left = useCountdown(req.expires_at);
  const risky = HIGH_RISK.test(req.command) || HIGH_RISK.test(req.description);
  const can = (c: ApprovalChoice) => req.choices.includes(c);
  const expired = left === 0;
  // QA-m8: aynı kart yeni bir onay isteğiyle yeniden kullanılırsa önceki durum (busy/hata) taşınmasın
  useEffect(() => { setBusy(null); setError(null); setConfirmAlways(false); }, [req.approval_id]);

  const decide = async (choice: ApprovalChoice) => {
    setBusy(choice);
    setError(null);
    try {
      await gatewayApi.decideTool(runId, req.approval_id, choice);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <section role="alert" aria-live="assertive"
      className={clsx("rounded-xl border-2 p-3 sm:p-4 flex flex-col gap-3", risky ? "tone-bad" : "tone-warn")}>
      <header className="flex flex-wrap items-center gap-2">
        <ShieldAlert size={18} className="shrink-0" />
        <h4 className="font-display font-semibold text-sm flex-1 min-w-[12rem]">
          {agentName ? t("ask_agent", { name: agentName }) : t("ask")}
        </h4>
        <Badge tone={risky ? "bad" : "warn"}>{risky ? t("high_risk") : t("caution")}</Badge>
        {left != null && (
          <Badge tone={left < 60 ? "bad" : "muted"} title={t("expire_title")}>
            <Timer size={12} />{expired ? t("expired") : t("left", { t: mmss(left) })}
          </Badge>
        )}
      </header>
      <div className="flex flex-col gap-1.5 text-ink">
        <span className="label">{req.tool ? t("tool", { tool: req.tool }) : t("command")}</span>
        <pre className="font-mono text-sm whitespace-pre-wrap break-all rounded-lg bg-panel border-2 border-line-soft p-2.5 max-h-48 overflow-auto">{req.command || t("no_preview")}</pre>
        {req.description && <p className="text-sm text-ink-2"><b className="text-ink">{t("why")}</b> {req.description}</p>}
      </div>
      {expired ? (
        <p className="text-sm font-semibold">{t("expired_msg")}</p>
      ) : confirmAlways ? (
        <div className="flex flex-col gap-2 text-ink">
          <p className="text-sm">
            <Rich text={t("always_confirm")} parts={{ b: <b>{t("always_b")}</b> }} />
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="gold" disabled={!!busy} icon={<InfinityIcon size={15} />} onClick={() => decide("always")}>
              {busy === "always" ? t("sending") : t("yes_always")}
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => setConfirmAlways(false)}>{t("back")}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
          {can("once") && (
            <Button variant="primary" disabled={!!busy} icon={<Check size={15} />} onClick={() => decide("once")}>
              {busy === "once" ? t("sending") : t("once")}
            </Button>
          )}
          {can("session") && req.allow_session && (
            <Button disabled={!!busy} icon={<CheckCheck size={15} />} onClick={() => decide("session")}>
              {busy === "session" ? t("sending") : t("session")}
            </Button>
          )}
          {can("always") && req.allow_permanent && (
            <Button disabled={!!busy} icon={<InfinityIcon size={15} />} onClick={() => setConfirmAlways(true)}>{t("always")}</Button>
          )}
          <Button variant="danger" disabled={!!busy} icon={<Ban size={15} />} onClick={() => decide("deny")}>
            {busy === "deny" ? t("sending") : t("deny")}
          </Button>
        </div>
      )}
      {error && <div className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-2.5 text-sm">{error}</div>}
    </section>
  );
}

export function ApprovalHistory({ items }: { items: ToolApprovalRecord[] }) {
  const t = useT(m);
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((a) => {
        const denied = a.choice === "deny";
        return (
          <li key={a.approval_id + (a.decided_at ?? "")} className="flex flex-wrap items-center gap-2 text-sm min-w-0">
            <Badge tone={denied ? "bad" : "ok"}>{denied ? <Ban size={12} /> : <Check size={12} />}{CHOICE_KEY[a.choice] ? t(CHOICE_KEY[a.choice]) : a.choice}</Badge>
            {a.timed_out && <Badge tone="warn"><Clock size={12} />{t("timeout")}</Badge>}
            <code className="font-mono text-xs text-ink-2 truncate min-w-0 flex-1" title={a.command}>{a.command || a.description}</code>
            {a.decided_at && <span className="text-xs text-muted num">{fmtDate(a.decided_at, { timeStyle: "medium" })}</span>}
            {a.error && <span className="basis-full text-xs text-bad">{t("not_delivered", { e: a.error })}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function InvocationLine({ inv }: { inv?: StepInvocation | null }) {
  const t = useT(m);
  const line = invocationLine(inv);
  if (!line || !inv) return null;
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex items-start gap-1.5 text-ink-2 min-w-0">
        <Send size={13} className="shrink-0 mt-0.5" />
        <span className="min-w-0 break-words"><b>{t("sent")}</b> <span className="font-mono">{line}</span></span>
      </div>
      {inv.reason && <span className="text-muted pl-5">{t("why_transport", { t: inv.transport === "api" ? "API" : "CLI", reason: inv.reason })}</span>}
      {!!inv.warnings?.length && (
        <div className="flex flex-wrap gap-1 pl-5">
          {inv.warnings.map((w, i) => <Badge key={i} tone="warn" className="!whitespace-normal">{w}</Badge>)}
        </div>
      )}
    </div>
  );
}
