// Onay adımı kartı (plan onayı, yeniden planlama kapısı, düz "devam edilsin mi?"): RunsPage StepCard'dan birebir taşındı
// (W3, D3 A). Koşular sayfası ve yürüme modundaki Konuş paneli AYNI kartı gösterir; karar aynı uca gider
// (`api.decide`), MCP kuralları değişmez.
import { AlertTriangle, CheckCircle2, ListChecks, XCircle } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/api";
import { useT } from "../../lib/i18n";
import type { Agent, Run, StepRun } from "../../lib/types";
import { runsMsg as m } from "../../locales/runs";
import { PixelFace } from "../PixelFace";
import { Button } from "../ui";
import { ResumeFirst, runSuspended } from "./RunControls";

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ApprovalStepCard({ run, step: s, agents }: { run: Run; step: StepRun; agents: Agent[] }) {
  const t = useT(m);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = (s.ask ?? null) as unknown as {
    kind?: string; plan?: { id: string; title: string; assignee: string; assignee_name?: string }[];
    failed?: { step: string; title: string; status?: string; error?: string | null }[];
  } | null;

  const decide = async (approved: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.decide(run.id, s.id, approved, note);
    } catch (e) {
      setError(errText(e));  // QA-m11: yakalanmayan söz reddi yok
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {card?.kind === "plan_approval" && !!card.plan?.length && (
        <div className="panel-soft p-2.5 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted flex items-center gap-1"><ListChecks size={13} aria-hidden />{t("plan_card_title")}</span>
          <ol className="flex flex-col gap-1 text-sm">
            {card.plan.map((p, i) => {
              const a = agents.find((x) => x.slug === p.assignee);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="text-muted num w-5 text-right shrink-0">{i + 1}.</span>
                  <PixelFace avatar={a?.avatar} size={20} ring={a?.color} />
                  <span className="font-semibold min-w-0 break-words">{p.title}</span>
                  <span className="text-ink-2">→ {p.assignee_name ?? p.assignee}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {card?.kind === "replan_gate" && !!card.failed?.length && (
        <div className="panel-soft p-2.5 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted flex items-center gap-1"><AlertTriangle size={13} aria-hidden />{t("gate_failed_title")}</span>
          <ul className="flex flex-col gap-1 text-sm">
            {card.failed.map((f) => (
              <li key={f.step} className="break-words"><b>{f.title}</b>{f.error ? <span className="text-muted"> — {f.error}</span> : null}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-sm">{s.awaiting_message || s.message || t("continue_q")}</p>
      {s.status === "awaiting_approval" && runSuspended(run) ? <ResumeFirst run={run} /> : s.status === "awaiting_approval" ? (
        <div className="flex flex-col sm:flex-row gap-2">
          <input className="input" aria-label={t("note_optional")} placeholder={t("note_optional")} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="primary" disabled={busy} icon={<CheckCircle2 size={16} />} onClick={() => decide(true)}>{t("approve")}</Button>
          <Button variant="danger" disabled={busy} icon={<XCircle size={16} />} onClick={() => decide(false)}>{t("reject")}</Button>
        </div>
      ) : s.output ? <p className="text-sm text-muted">{t("decision", { text: s.output })}</p> : null}
      {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
    </div>
  );
}
