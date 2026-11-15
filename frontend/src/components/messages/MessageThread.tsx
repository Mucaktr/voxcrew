// Ekip S24 — mesaj ipliği: seçili mesajın içeriği (uzunsa özet ↔ tamamı), referanslar, okundu işareti, aynı yazışmanın
// geçmişi ve (alıcı bir ajansa) yanıt yazma. Canlı: `message.*` olaylarında yeniden yüklenir.
import clsx from "clsx";
import { ArrowLeft, CheckCheck, ExternalLink, FileCheck2, FileText, Reply, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Markdown } from "../Markdown";
import { Badge, Button, Empty, Panel, Spinner } from "../ui";
import { timeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { messagesApi, useMessageEvents, type InboxMessage } from "../../lib/messages";
import type { Agent } from "../../lib/types";
import { messagesMsg as m } from "../../locales/messages";
import { ComposeMessage } from "./ComposeMessage";
import { FromTo, KindBadge } from "./parts";

const LONG = 2400;

export function MessageThread({ id, agents, onBack, onSelect }:
  { id: string; agents: Agent[]; onBack?: () => void; onSelect: (id: string) => void }) {
  const t = useT(m);
  const [data, setData] = useState<{ message: InboxMessage; thread: InboxMessage[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    messagesApi.get(id).then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  useEffect(() => { setData(null); setFull(false); setReplying(false); load(); }, [load]);
  useMessageEvents((ev) => {
    const mid = typeof ev.message_id === "string" ? ev.message_id : undefined;
    const sent = ev.message as InboxMessage | undefined;
    if (!data) return;
    const pair = new Set([data.message.from_agent, data.message.to_agent]);
    if (mid === id || (sent && pair.has(sent.from_agent) && pair.has(sent.to_agent) && (sent.run_id ?? null) === (data.message.run_id ?? null))) load();
  });

  if (error) return <Panel><Empty title={t("not_found")} text={error} action={onBack && <Button onClick={onBack}>{t("thread_back")}</Button>} /></Panel>;
  if (!data) return <Panel><div className="grid place-items-center py-10"><Spinner size={22} /></div></Panel>;
  const msg = data.message;
  const long = msg.body.length > LONG;
  // S50: teslim kalemi (rapor) ajan talimatı taşımaz; "doğrulanmamış" uyarısı yalnızca ajan mesajlarında
  const fromAgent = msg.from_agent !== "user" && msg.from_agent !== "system" && msg.kind !== "deliverable";
  const replyTarget = msg.to_agent !== "user" ? msg.to_agent : msg.from_agent;
  const files = msg.artifacts.filter((a) => a.type === "file");
  const outputs = msg.artifacts.filter((a) => a.type === "deliverable" && a.id);

  const markRead = async () => {
    setBusy(true);
    try {
      const res = await messagesApi.markRead(msg.id);
      setData((d) => (d ? { ...d, message: res.message } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <Panel title={msg.subject || t("thread_title")}
        actions={onBack && <Button size="sm" variant="ghost" icon={<ArrowLeft size={15} />} onClick={onBack} aria-label={t("thread_back")} />}>
        <div className="flex flex-col gap-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <KindBadge kind={msg.kind} />
            <FromTo msg={msg} agents={agents} />
            <span className="text-xs text-muted num">{timeAgo(msg.created_at)}</span>
            <span className="ml-auto text-xs font-semibold">
              {msg.read_at ? <span className="text-ok">{t("thread_read_at", { ago: timeAgo(msg.read_at) })}</span>
                : <span className="text-warn">{t("thread_unread")}</span>}
            </span>
          </div>
          {fromAgent && (
            <p className="chip tone-warn !rounded-lg !whitespace-normal !items-start font-medium p-2 text-xs">
              <ShieldAlert size={14} className="shrink-0 mt-[1px]" aria-hidden />{t("unverified_note")}
            </p>
          )}
          {long && !full && <p className="text-xs text-muted">{t("summary_only")}</p>}
          <div className="panel-soft p-3 max-h-[28rem] overflow-y-auto break-words">
            <Markdown text={long && !full ? msg.summary : msg.body} />
          </div>
          {long && (
            <div><Button size="sm" variant="ghost" onClick={() => setFull((v) => !v)}>{full ? t("show_summary") : t("show_full")}</Button></div>
          )}
          <div className="flex flex-wrap gap-1.5 text-xs">
            {msg.run_id && (
              <Link to={`/gorevler/${encodeURIComponent(msg.run_id)}`} className="chip hover:border-ink-2">
                <ExternalLink size={12} aria-hidden />{t("thread_run", { id: msg.run_id })}
              </Link>
            )}
            {msg.step_id && <Badge>{t("thread_step", { id: msg.step_id })}</Badge>}
            {msg.ref?.ref && <Badge className="!whitespace-normal break-all">{t("thread_ref", { ref: msg.ref.ref, n: msg.ref.chars ?? 0 })}</Badge>}
            {msg.reply_to && (
              <button type="button" className="chip hover:border-ink-2" onClick={() => onSelect(msg.reply_to!)}>
                <Reply size={12} aria-hidden />{t("thread_reply_to")}
              </button>
            )}
          </div>
          {!!outputs.length && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-semibold text-muted flex items-center gap-1"><FileCheck2 size={13} aria-hidden />{t("thread_deliverables")}</span>
              {outputs.map((f) => (
                <Link key={f.id} to={`/ciktilar?d=${encodeURIComponent(f.id!)}`} className="chip tone-ok hover:border-ink-2 break-all"
                  title={t("thread_open_outputs")}>{f.name}</Link>
              ))}
            </div>
          )}
          {!!files.length && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-semibold text-muted flex items-center gap-1"><FileText size={13} aria-hidden />{t("thread_files")}</span>
              {files.map((f) => <span key={f.id ?? f.name} className="chip tone-ok break-all">{f.name}</span>)}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {/* yalnızca kullanıcıya gelen mesaj okundu yapılır; ajana giden not ajan görünce okundu olur*/}
            {msg.unread && msg.to_agent === "user" && (
              <Button size="sm" disabled={busy} icon={<CheckCheck size={15} />} onClick={() => { void markRead(); }}>{t("mark_read")}</Button>
            )}
            {msg.unread && msg.to_agent !== "user" && (
              <span className="text-xs text-muted self-center">{t("unread_for_agent")}</span>
            )}
            {replyTarget !== "user" && replyTarget !== "system" && !replying && (
              <Button size="sm" variant="primary" icon={<Reply size={15} />} onClick={() => setReplying(true)}>{t("compose_reply")}</Button>
            )}
          </div>
          {replying && (
            <div className="panel-soft p-3">
              <ComposeMessage agents={agents} to={replyTarget} replyTo={msg.id}
                defaultSubject={msg.subject ? `Re: ${msg.subject}`.slice(0, 160) : ""}
                onSent={() => { setReplying(false); load(); }} onCancel={() => setReplying(false)} />
            </div>
          )}
        </div>
      </Panel>
      {data.thread.length > 1 && (
        <Panel title={t("thread_history", { n: data.thread.length })}>
          <ol className="flex flex-col gap-1.5">
            {data.thread.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => onSelect(x.id)} aria-pressed={x.id === msg.id}
                  className={clsx("card-select w-full text-left p-2 flex flex-col gap-0.5 min-w-0")}>
                  <span className="flex items-center gap-1.5 text-xs min-w-0">
                    <KindBadge kind={x.kind} />
                    <span className="min-w-0 flex-1 truncate"><FromTo msg={x} agents={agents} /></span>
                    <span className="text-muted num shrink-0">{timeAgo(x.created_at)}</span>
                  </span>
                  <span className="text-sm truncate">{x.subject || x.summary}</span>
                </button>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}
