// Ekip S24 — kullanıcı → ajan mesajı (POST /api/agents/{slug}/inbox). Ajan bir sonraki adımında okur; onay değildir.
import { Send } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button, Field } from "../ui";
import { byName } from "../../lib/agents";
import { useT } from "../../lib/i18n";
import { messagesApi, type InboxMessage } from "../../lib/messages";
import type { Agent } from "../../lib/types";
import { messagesMsg as m } from "../../locales/messages";

export function ComposeMessage({ agents, to: fixedTo, replyTo, defaultSubject, onSent, onCancel }:
  { agents: Agent[]; to?: string; replyTo?: string; defaultSubject?: string; onSent?: (msg: InboxMessage) => void; onCancel?: () => void }) {
  const t = useT(m);
  const visible = useMemo(() => agents.filter((a) => !a.hidden).sort(byName), [agents]);
  const [to, setTo] = useState(fixedTo ?? "");
  const [subject, setSubject] = useState(defaultSubject ?? "");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const target = fixedTo ?? to;
  // eksik alan işaretlenir (aria-invalid), hata o alana bağlanır ve odak oraya gider
  const [badField, setBadField] = useState<"to" | "body" | null>(null);
  const toRef = useRef<HTMLSelectElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const send = async () => {
    setError(null);
    setSent(false);
    setBadField(null);
    if (!target) { setBadField("to"); setError(t("compose_need_agent")); toRef.current?.focus(); return; }
    if (!body.trim()) { setBadField("body"); setError(t("compose_empty")); bodyRef.current?.focus(); return; }
    setBusy(true);
    try {
      const res = await messagesApi.sendToAgent(target, body.trim(), subject.trim() || undefined, replyTo);
      setBody("");
      setSent(true);
      onSent?.(res.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-2.5" aria-label={t("compose_title")} onSubmit={(e) => { e.preventDefault(); void send(); }}>
      {!fixedTo && (
        <Field label={t("compose_to")}>
          <select ref={toRef} className="select" value={to} onChange={(e) => { setTo(e.target.value); setBadField(null); setError(null); }} aria-label={t("compose_to")}
            aria-invalid={badField === "to" || undefined} aria-describedby={badField === "to" ? "compose-err" : undefined}>
            <option value="">{t("compose_pick_agent")}</option>
            {visible.map((a) => <option key={a.slug} value={a.slug}>{a.name}{a.title ? ` — ${a.title}` : ""}</option>)}
          </select>
        </Field>
      )}
      <Field label={t("compose_subject")}>
        <input className="input" aria-label={t("compose_subject")} value={subject} maxLength={160} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <Field label={t("compose_body")} hint={t("compose_hint")}>
        <textarea ref={bodyRef} className="textarea" rows={4} aria-invalid={badField === "body" || undefined} aria-describedby={badField === "body" ? "compose-err" : undefined} aria-label={t("compose_body")} value={body} maxLength={8000} placeholder={t("compose_body_placeholder")}
          onChange={(e) => { setBody(e.target.value); if (badField === "body") { setBadField(null); setError(null); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); } }} />
      </Field>
      {error && <p id="compose-err" className="text-sm font-semibold text-bad" role="alert">{error}</p>}
      {sent && !error && <p className="text-sm font-semibold text-ok" role="status">{t("compose_sent")}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        {onCancel && <Button variant="ghost" onClick={onCancel}>{t("cancel")}</Button>}
        <Button type="submit" variant="primary" disabled={busy} icon={<Send size={15} />}>{busy ? t("compose_sending") : t("compose_send")}</Button>
      </div>
    </form>
  );
}
