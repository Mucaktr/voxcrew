// DASH-MVP Pano "Ajanlar" bölümü (ortak AgentStatusRow sözleşmesi; harici oturumlar katlanır). §6.5.
// Alt sıradaki listeler (çıktılar, zamanlamalar, etkinlik) BoardLower.tsx'te.
// PANO-FIX: durum çipleri Pano'nun metinli, oyun dilsiz sözlüğünden ("Bağlantı yok", "Sırada", "Onay bekliyor");
// sunucunun etkinlik metni arayüz dilinde; genel veri gelmeden sahte "Henüz ajan yok" yerine iskelet.
import { Plus, Users } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { ExternalAgent } from "../../full/data";
import { useT } from "../../lib/i18n";
import { boardMsg } from "../../locales/board";
import { AgentStatusRow, type AgentStatusRowProps } from "../agents/AgentStatusRow";
import { Button } from "../ui";
import { Empty, Sk, useDelayed } from "./BoardParts";
import { activityText } from "./boardFormat";

export const AGENT_LIMIT = 8;

export type AgentRow = Omit<AgentStatusRowProps, "onPick" | "onTask" | "boardText" | "selected">;

export function AgentsList({ ready = true, rows, externals, onPick, onTask, onAdd }: {
  ready?: boolean; rows: AgentRow[]; externals: ExternalAgent[]; onPick: (slug: string) => void; onTask: (slug?: string) => void; onAdd: () => void;
}) {
  const t = useT(boardMsg);
  const skel = useDelayed(!ready);
  const text = useMemo(() => ({
    taskFor: (name: string) => t("agent_task_for", { name }), ready: (brain: string) => t("agent_ready", { brain }), fix: t("agent_fix"),
    status: { working: t("st_working"), queued: t("st_queued"), waiting: t("st_waiting"), error: t("st_error"), idle: t("st_idle"),
      offline: t("st_offline"), done: t("st_done") },
    activity: activityText,
  }), [t]);
  if (!ready) {
    return skel ? (
      <ul className="bd-agents" aria-hidden>{[0, 1, 2, 3].map((i) => (
        <li key={i} className="grid grid-cols-[40px_minmax(0,1fr)] gap-2.5 p-2"><Sk w="40px" h={40} r={10} /><span className="grid gap-1.5 content-center"><Sk w="50%" h={12} /><Sk w="75%" h={10} /></span></li>
      ))}</ul>
    ) : <span className="sr-only">{t("loading")}</span>;
  }
  if (!rows.length) {
    return <Empty tone="muted" icon={<Users size={18} />} title={t("agents_empty")}
      action={<Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={onAdd}>{t("agents_add")}</Button>} />;
  }
  const shown = rows.slice(0, AGENT_LIMIT);
  return (
    <>
      <ul className="bd-agents">
        {shown.map((r) => (
          <AgentStatusRow key={r.a.slug} {...r} selected={false} onPick={onPick} onTask={onTask} boardText={text} />
        ))}
      </ul>
      {rows.length > shown.length && <Link to="/ajanlar" className="bd-link bd-more">{t("agent_more", { n: rows.length - shown.length })}</Link>}
      {externals.length > 0 && (
        <details className="bd-ext mt-2">
          <summary>{t("ext_title", { n: externals.length })}</summary>
          <ul className="bd-list mt-1">
            {externals.map((e) => (
              <li key={e.id}>
                <Link to={`/projeler/${encodeURIComponent(e.projectKey)}`}>
                  <span className="bd-tt"><b>{e.title || e.source}</b><span>{e.source}{e.activity ? ` · ${e.activity}` : ""}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
