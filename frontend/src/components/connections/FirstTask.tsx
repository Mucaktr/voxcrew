// S29 — sihirbazın son adımı: hazır beyinle başlangıç ajanına 1 cümlelik örnek görev; canlı ilerleme ve sonuç;
// başarısızsa anlaşılır neden + düzeltme düğmesi. (Eğitim/akademi ayrı ekibin; burada yalnızca bu adım.)
import clsx from "clsx";
import { CheckCircle2, ExternalLink, Send, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { BRAIN_KINDS, connOf, useConnectionStates, type ProviderKind } from "../../lib/connections";
import { CONNECTION_META } from "../../lib/format";
import { decide, usePolicyView } from "../../lib/modelPolicy";
import { useConsent } from "./ConsentDialog";
import { useT } from "../../lib/i18n";
import { useStudio } from "../../lib/store";
import type { Run } from "../../lib/types";
import { cx } from "../../locales/connections";
import { Markdown } from "../Markdown";
import { PixelFace } from "../PixelFace";
import { Badge, Button, Field, Segmented, Spinner } from "../ui";
import { NotReadyHint } from "./NotReadyHint";
import { readFirstTaskMemo, writeFirstTaskMemo } from "./firstTaskMemo"; // UXF-G

type Brain = "agent" | "ollama" | "codex" | "claude" | "openai_compat";

export function FirstTask({ onOpenRun, onFixConnections }: { onOpenRun: (runId: string) => void; onFixConnections: () => void }) {
  const t = useT(cx);
  const conns = useConnectionStates();
  const allAgents = useStudio((s) => s.agents);
  const models = useStudio((s) => s.models);
  // yedekteki ajan koltuk tutmaz ve koşu başlatamaz; ilk görev etkin kadrodan seçilir
  const agents = useMemo(() => allAgents.filter((a) => !a.hidden && !(a as { benched?: boolean }).benched), [allAgents]);
  // S37: model erişim politikası — izinsiz beyin önerilmez; uzak API'de bir kerelik onay
  const policy = usePolicyView();
  const { ensure, dialog } = useConsent();
  const apiEps = connOf(conns, "openai_compat")?.extra.endpoints ?? [];
  const apiDecision = () => decide(policy, "openai_compat", null, { endpoints: apiEps, defaultEndpoint: connOf(conns, "openai_compat")?.extra.default_endpoint });
  const brainAllowed = (k: string) => (k === "openai_compat" ? apiDecision().allowed : k === "ollama" ? true : decide(policy, k, null).allowed);
  const readyBrains = BRAIN_KINDS.filter((k) => connOf(conns, k)?.ready === "ok" && brainAllowed(k));
  const memo0 = useRef(readFirstTaskMemo()).current; // UXF-G
  const [agent, setAgent] = useState(memo0.agent);
  // UXF-A: örnek görev yalnız kullanıcı dokunmadıysa gösterilir (null = örnek); ilk odakta tümü seçili gelir, yazmak
  // örneğin YERİNE geçer ("…5 maddeBugün için…" birleşmesi yok) ve alan boşaltılabilir (eskiden boşalınca örnek geri doluyordu)
  const [draft, setDraft] = useState<string | null>(memo0.draft);
  const prompt = draft ?? t("first_example");
  const selectOnFocus = useRef(false);
  const [picked, setPicked] = useState<Brain | null>(memo0.picked);  // kullanıcı seçmediyse türetilmiş varsayılan
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  // UXF-G: durumu sakla; geri dönüşte son koşuyu kimliğinden yeniden yükle (çalışıyorsa yoklama sürer)
  useEffect(() => { writeFirstTaskMemo({ draft, agent, picked, runId: run?.id ?? readFirstTaskMemo().runId }); }, [draft, agent, picked, run]);
  useEffect(() => {
    const id = memo0.runId;
    if (!id) return;
    let alive = true;
    api.run(id).then((r) => { if (alive) setRun(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (!agent && agents[0]) setAgent(agents[0].slug); }, [agents, agent]);
  // ajanın kendi beyni hazır değilse hazır olan ilk beyni öner
  const current = agents.find((a) => a.slug === agent);
  const agentKind = (current?.route?.connection ?? current?.connection) as ProviderKind | undefined;
  const agentReady = agentKind ? connOf(conns, agentKind)?.ready === "ok" : false;
  // ajanın kendi beyni hazırsa onu, değilse hazır olan ilk beyni öner (ajan seçilmeden karar verilmez)
  const fallback = (readyBrains[0] ?? "agent") as Brain;
  const brain: Brain = picked ?? (!current || agentReady ? "agent" : fallback);
  const setBrain = (b: Brain) => setPicked(b);

  useEffect(() => {
    if (!run || !["running", "pending", "awaiting_approval", "awaiting_tool_approval"].includes(run.status)) return;
    timer.current = window.setTimeout(() => { api.run(run.id).then(setRun).catch(() => undefined); }, 1500);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [run]);

  const send = async () => {
    if (!agent || !prompt.trim()) return;
    if (brain === "openai_compat" && !(await ensure(apiDecision()))) return;
    setBusy(true); setError(null); setRun(null);
    try {
      const local = models.filter((m) => m.local);
      const res = await api.createTask({ agent, prompt: prompt.trim(), memory: false, remember: true,
        connection: brain === "agent" ? undefined : brain, model: brain === "ollama" ? local[0]?.name : undefined });
      setRun(await api.run(res.run_id));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const step = run?.steps[run.steps.length - 1];
  const failed = run && (run.status === "failed" || run.status === "interrupted");
  const done = run?.status === "done";
  const failKind = (step?.route?.connection ?? agentKind) as ProviderKind | undefined;

  if (readyBrains.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">{t("first_intro")}</p>
        <div role="status" className="chip tone-warn !whitespace-normal !items-start !rounded-lg p-3 text-sm font-medium">{t("first_no_brain")}</div>
        <div><Button variant="primary" onClick={onFixConnections}>{t("first_fix")}</Button></div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {dialog}
      <p className="text-sm text-ink-2">{t("first_intro")}</p>
      {agents.length === 0 ? <p className="text-sm text-warn">{t("first_no_agent")}</p> : (
        <Field label={t("first_agent")}>
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t("first_agent")}>
            {agents.slice(0, 6).map((a) => (
              <button key={a.slug} type="button" aria-pressed={a.slug === agent} onClick={() => setAgent(a.slug)}
                className="card-select flex items-center gap-2 px-2.5 py-2 min-w-[160px] shrink-0">
                <PixelFace avatar={a.avatar} size={34} ring={a.slug === agent ? a.color : undefined} />
                <span className="min-w-0"><span className="block font-semibold text-sm truncate">{a.name}</span>
                  <span className="block text-xs text-muted truncate">{a.route?.label ?? a.connection}</span></span>
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label={t("first_brain")} hint={brain === "agent" ? current?.route?.label : undefined}>
        <Segmented value={brain} onChange={setBrain} options={[
          { value: "agent", label: t("first_brain_agent"), disabled: !agentReady },
          ...(["ollama", "codex", "claude"] as const).map((k) => ({ value: k, label: connOf(conns, k)?.name ?? k, disabled: !readyBrains.includes(k) })),
          // S37: model API bağlantısı (varsayılan uç nokta + modeli); yalnızca bağlıysa gösterilir
          ...(connOf(conns, "openai_compat")?.extra.endpoints?.length ? [{ value: "openai_compat" as const, label: CONNECTION_META.openai_compat.label, disabled: !readyBrains.includes("openai_compat") }] : []),
        ]} />
        {brain !== "agent" && <NotReadyHint kind={brain} className="mt-1" />}
        {brain === "agent" && agentKind && !agentReady && <NotReadyHint kind={agentKind} className="mt-1" />}
      </Field>
      <Field label={t("first_prompt")}>
        <textarea className="textarea min-h-[72px]" value={prompt} onChange={(e) => setDraft(e.target.value)} aria-label={t("first_prompt")}
          onFocus={(e) => { if (draft === null) { e.currentTarget.select(); selectOnFocus.current = true; } }}
          onMouseUp={(e) => { if (selectOnFocus.current) { e.preventDefault(); selectOnFocus.current = false; } }}
          onBlur={() => { selectOnFocus.current = false; }} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={busy ? <Spinner size={14} /> : <Send size={14} />} disabled={busy || !agent || !prompt.trim() || (run != null && !done && !failed)} onClick={send}>
          {busy ? t("first_sending") : run && (done || failed) ? t("first_retry") : t("first_send")}
        </Button>
        {run && <Button variant="ghost" icon={<ExternalLink size={14} />} onClick={() => onOpenRun(run.id)}>{t("first_open")}</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {run && (
        <div className={clsx("rounded-lg border-2 p-3 text-sm flex flex-col gap-2", done ? "tone-ok" : failed ? "tone-bad" : "tone-info")} role="status" aria-live="polite">
          <div className="flex items-center gap-2 font-semibold">
            {done ? <CheckCircle2 size={16} aria-hidden /> : failed ? <XCircle size={16} aria-hidden /> : <Spinner size={14} />}
            {done ? t("first_done") : failed ? t("first_failed") : t("first_running")}
            {step?.model && <Badge>{step.model}</Badge>}
            {step?.tools?.length ? <Badge>{t("first_tools", { n: step.tools.length })}</Badge> : null}
          </div>
          {!done && !failed && step?.output && <p className="text-xs text-ink-2 line-clamp-3 whitespace-pre-wrap">{step.output.slice(-400)}</p>}
          {done && step?.output && <div className="max-h-64 overflow-y-auto text-ink"><Markdown text={step.output} /></div>}
          {failed && (
            <div className="flex flex-col gap-2">
              <p className="break-words">{step?.error ?? step?.last_error ?? run.status}</p>
              {failKind && BRAIN_KINDS.includes(failKind) && <NotReadyHint kind={failKind} />}
              <div><Button size="sm" onClick={onFixConnections}>{t("first_fix")}</Button></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
