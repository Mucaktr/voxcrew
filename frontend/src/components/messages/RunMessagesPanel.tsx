// Ekip S24 — koşu ayrıntısındaki kompakt "Mesajlar" paneli: koşunun görev / yanıt / devir mesajları (canlı).
import { ChevronDown, ChevronRight, MessagesSquare } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Panel, Spinner } from "../ui";
import { timeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useMessages } from "../../lib/messages";
import { useStudio } from "../../lib/store";
import { messagesMsg as m } from "../../locales/messages";
import { FromTo, KindBadge } from "./parts";

const SHOWN = 8;

export function RunMessagesPanel({ runId }: { runId: string }) {
  const t = useT(m);
  const agents = useStudio((s) => s.agents);
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const { messages, loading, error } = useMessages({ run: runId, limit: 200 });
  const list = all ? messages : messages.slice(0, SHOWN);
  return (
    <Panel icon={<MessagesSquare size={16} aria-hidden />}
      title={<button type="button" className="flex items-center gap-1.5" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}{t("run_panel_title")}
        {!!messages.length && <span className="text-xs text-muted num">({messages.length})</span>}
      </button>}>
      {open && (
        error ? <p className="text-sm font-semibold text-bad" role="alert">{t("load_error", { error })}</p>
          : loading && !messages.length ? <div className="grid place-items-center py-4"><Spinner /></div>
          : !messages.length ? <p className="text-sm text-muted">{t("run_panel_empty")}</p>
          : (
            <div className="flex flex-col gap-1.5">
              <ul className="flex flex-col gap-1">
                {list.map((msg) => (
                  <li key={msg.id}>
                    <Link to={`/gelen-kutusu/${encodeURIComponent(msg.id)}`} title={t("run_panel_open")}
                      className="flex items-center gap-1.5 min-w-0 rounded-lg px-2 py-1.5 hover:bg-panel-2 text-sm">
                      <KindBadge kind={msg.kind} />
                      <span className="min-w-0 shrink truncate"><FromTo msg={msg} agents={agents} /></span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">{msg.subject}</span>
                      {msg.unread && <span className="h-2 w-2 rounded-full bg-accent shrink-0" aria-label={t("unread_dot")} role="img" />}
                      <span className="text-xs text-muted num shrink-0">{timeAgo(msg.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {messages.length > SHOWN && !all && (
                <button type="button" className="text-xs font-semibold text-accent self-start" onClick={() => setAll(true)}>
                  {t("run_panel_more", { n: messages.length - SHOWN })}
                </button>
              )}
            </div>
          )
      )}
    </Panel>
  );
}
