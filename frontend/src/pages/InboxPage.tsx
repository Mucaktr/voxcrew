// Faz 6 — Ekip S24: gelen kutusu (/gelen-kutusu, /gelen-kutusu/:id). Ajanlar arası görev/yanıt/devir mesajları ve
// kullanıcı → ajan notları: ajan / koşu / tür / okunmamış süzgeçleri, iplik görünümü, mesaj yazma. Canlı:
// `registerEventHandler("message.", …)` (lib/messages.ts). Mesajlar doğrulanmamış bilgidir; onay yerine geçmez.
import clsx from "clsx";
import { Inbox, PenLine, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ComposeMessage } from "../components/messages/ComposeMessage";
import { MessageList } from "../components/messages/MessageList";
import { MessageThread } from "../components/messages/MessageThread";
import { Badge, Button, Empty, Field, Modal, PageHeader, Panel, Toggle } from "../components/ui";
import { byName } from "../lib/agents";
import { useT } from "../lib/i18n";
import { MESSAGE_KINDS, useMessages, type MessageKind } from "../lib/messages";
import { useStudio } from "../lib/store";
import { messagesMsg as m } from "../locales/messages";
import { shell } from "../locales/shell";

export default function InboxPage() {
  const t = useT(m);
  const ts = useT(shell);
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const agents = useStudio((s) => s.agents);
  const [agent, setAgent] = useState("");
  const [run, setRun] = useState("");
  const [runInput, setRunInput] = useState("");
  const [kind, setKind] = useState<MessageKind | "">("");
  const [unread, setUnread] = useState(false);
  const [compose, setCompose] = useState(false);
  const { messages, loading, error, reload } = useMessages({ agent: agent || undefined, run: run || undefined, kind,
    unread, limit: 200 });
  const visibleAgents = useMemo(() => agents.filter((a) => !a.hidden).sort(byName), [agents]);
  // başlık yalnızca kullanıcıya gelen okunmamışları sayar (ajanların okunmamışı ajanın gelen kutusundadır)
  const unreadCount = useMemo(() => messages.filter((x) => x.unread && x.to_agent === "user").length, [messages]);

  // koşu kimliği yazılırken her tuşta istek atılmasın
  useEffect(() => {
    const h = window.setTimeout(() => setRun(runInput.trim()), 350);
    return () => window.clearTimeout(h);
  }, [runInput]);

  const open = (mid: string) => navigate(`/gelen-kutusu/${encodeURIComponent(mid)}`);

  return (
    <div className="p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <PageHeader title={ts("nav_inbox")} subtitle={t("page_subtitle")}
        meta={unreadCount > 0 ? <Badge tone="info">{t("unread_total", { n: unreadCount })}</Badge> : undefined}
        actions={<>
          <Button icon={<RefreshCcw size={15} />} onClick={reload}>{t("refresh")}</Button>
          <Button variant="primary" icon={<PenLine size={15} />} onClick={() => setCompose(true)}>{t("new_message")}</Button>
        </>} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] items-start">
        <div className={clsx("flex flex-col gap-3 min-w-0", id && "hidden lg:flex")}>
          <Panel>
            <div role="group" aria-label={t("filters_label")} className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-3">
              <Field label={t("filter_agent")}>
                <select className="select" aria-label={t("filter_agent")} value={agent} onChange={(e) => setAgent(e.target.value)}>
                  <option value="">{t("filter_all_agents")}</option>
                  <option value="user">{t("filter_to_me")}</option>
                  {visibleAgents.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                </select>
              </Field>
              <Field label={t("filter_kind")}>
                <select className="select" aria-label={t("filter_kind")} value={kind} onChange={(e) => setKind(e.target.value as MessageKind | "")}>
                  <option value="">{t("filter_all_kinds")}</option>
                  {MESSAGE_KINDS.map((k) => <option key={k} value={k}>{t(`kind_${k}` as "kind_note")}</option>)}
                </select>
              </Field>
              <Field label={t("filter_run")} className="sm:col-span-2">
                <input className="input" type="search" aria-label={t("filter_run")} placeholder={t("filter_run_placeholder")}
                  value={runInput} onChange={(e) => setRunInput(e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Toggle checked={unread} onChange={setUnread} label={t("filter_unread")} />
              </div>
            </div>
          </Panel>
          <Panel title={t("list_label")} icon={<Inbox size={16} aria-hidden />}>
            <div className="max-h-[70vh] overflow-y-auto -mx-1 px-1">
              <MessageList messages={messages} agents={agents} selected={id} onSelect={open} loading={loading} error={error} />
            </div>
          </Panel>
        </div>

        <div className={clsx("min-w-0", !id && "hidden lg:block")}>
          {id ? (
            <MessageThread key={id} id={id} agents={agents} onSelect={open} onBack={() => navigate("/gelen-kutusu")} />
          ) : (
            <Panel><Empty icon={<Inbox size={28} />} title={t("thread_pick_title")} text={t("thread_pick_text")} /></Panel>
          )}
        </div>
      </div>

      <Modal open={compose} onClose={() => setCompose(false)} title={t("compose_title")} width={560}>
        <ComposeMessage agents={agents} defaultSubject="" onCancel={() => setCompose(false)}
          onSent={(msg) => { setCompose(false); open(msg.id); }} />
      </Modal>
    </div>
  );
}
