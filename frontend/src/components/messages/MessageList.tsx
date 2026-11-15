// Ekip S24 — mesaj listesi (gelen kutusu sol sütunu): tür, gönderen → alıcı, konu, özet, zaman, okunmamış işareti.
import clsx from "clsx";
import { Inbox } from "lucide-react";
import { Empty, Spinner } from "../ui";
import { timeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import type { InboxMessage } from "../../lib/messages";
import type { Agent } from "../../lib/types";
import { messagesMsg as m } from "../../locales/messages";
import { FromTo, KindBadge } from "./parts";

export function MessageList({ messages, agents, selected, onSelect, loading, error }:
  { messages: InboxMessage[]; agents: Agent[]; selected?: string; onSelect: (id: string) => void; loading: boolean; error: string | null }) {
  const t = useT(m);
  if (error) return <p className="text-sm font-semibold text-bad p-3" role="alert">{t("load_error", { error })}</p>;
  if (loading && !messages.length) return <div className="grid place-items-center py-10"><Spinner size={22} /></div>;
  if (!messages.length) return <Empty icon={<Inbox size={26} />} title={t("empty_title")} text={t("empty_text")} />;
  return (
    <ul className="flex flex-col gap-1.5" aria-label={t("list_label")}>
      {messages.map((msg) => (
        <li key={msg.id}>
          <button type="button" onClick={() => onSelect(msg.id)} aria-pressed={selected === msg.id}
            className={clsx("card-select w-full text-left p-2.5 flex flex-col gap-1 min-w-0", msg.unread && "border-ink-2")}>
            <span className="flex items-center gap-1.5 min-w-0 text-sm">
              {msg.unread && <><span className="h-2 w-2 rounded-full bg-accent shrink-0" aria-hidden /><span className="sr-only">{t("unread_dot")}</span></>}
              <KindBadge kind={msg.kind} />
              <span className="min-w-0 flex-1 truncate"><FromTo msg={msg} agents={agents} /></span>
              <span className="text-xs text-muted shrink-0 num">{timeAgo(msg.created_at)}</span>
            </span>
            <span className={clsx("text-sm truncate", msg.unread ? "font-semibold" : "font-medium")}>{msg.subject || msg.summary}</span>
            {msg.summary && msg.summary !== msg.subject && (
              <span className="text-xs text-muted line-clamp-2 break-words">{msg.summary}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
