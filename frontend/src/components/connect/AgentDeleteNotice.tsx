// AGENT-DELETE (karar 31 Ekim): bir ajanın silme çağrısı durdurulunca görünür ama engellemeyen bildirim — hangi ajan,
// hangi öğe ve ayara bağlantı. Tekrarlar tek kutuda birleşir (lib/agentDelete.ts `coalesce`); kipli pencere açılmaz.
import { ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AGENT_DELETE_PAGE, agentLabel, coalesce, parseRefusal, type DeleteNotice } from "../../lib/agentDelete";
import { useT } from "../../lib/i18n";
import { registerEventHandler } from "../../lib/store";
import { agentDeleteMsg as m } from "../../locales/agentDelete";
import { Button } from "../ui";

export function AgentDeleteNotice() {
  const t = useT(m);
  const navigate = useNavigate();
  const [notice, setNotice] = useState<DeleteNotice | null>(null);

  useEffect(() => registerEventHandler("clients.", (ev) => {
    const r = parseRefusal(ev, Date.now() / 1000);
    if (r) setNotice((prev) => coalesce(prev, r, Date.now()));
  }), []);

  useEffect(() => {
    if (!notice) return;
    const h = window.setTimeout(() => setNotice(null), Math.max(0, notice.until - Date.now()));
    return () => window.clearTimeout(h);
  }, [notice]);

  if (!notice) return null;
  const agents = notice.agents.map((a) => agentLabel(a, t("notice_local"))).join(", ");
  const more = notice.items.length > 1 ? t("notice_more", { n: notice.items.length - 1 }) : "";
  return (
    <div role="status" aria-live="polite" aria-atomic="true"
      className="panel anim-rise fixed z-[45] right-2 left-2 sm:left-auto sm:right-4 sm:w-[22rem] p-3 flex items-start gap-2.5"
      style={{ top: "calc(4rem + env(safe-area-inset-top))" }}>
      <span className="text-warn shrink-0 mt-0.5"><ShieldAlert size={18} aria-hidden /></span>
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <span className="font-semibold text-sm">
          {notice.count > 1 ? t("notice_title_many", { n: notice.count }) : t("notice_title")}
        </span>
        <span className="text-xs text-ink-2 break-words line-clamp-3">
          {t("notice_body", { agent: agents, item: notice.items[0] })}{more}
        </span>
        <span className="text-xs text-muted">{t("notice_hint")}</span>
        <div>
          <Button size="sm" variant="primary" onClick={() => { navigate(AGENT_DELETE_PAGE); setNotice(null); }}>
            {t("notice_setting")}
          </Button>
        </div>
      </div>
      <Button size="sm" variant="ghost" icon={<X size={14} />} aria-label={t("dismiss")} onClick={() => setNotice(null)} />
    </div>
  );
}
