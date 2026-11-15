// Açılım yolu kartları ( "ilerlemeli gösterim, kilit değil"). Seviye yalnız sıradaki özelliği öne
// çıkarır; her kart özelliği HEMEN açan bir bağlantıdır. Paket sınırı yalnız bilgi olarak yazılır.
import clsx from "clsx";
import { ArrowRight, CalendarClock, Check, Footprints, Hammer, Send, ShieldCheck, Target, Workflow, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { loopApi, type UnlockCard, type UnlockId, type UnlockPathData } from "../../lib/loop";
import { loopMsg } from "../../locales/loop";
import { Badge, Spinner } from "../ui";
import { useGameData } from "./useGameData";

const ICON: Record<UnlockId, LucideIcon> = {
  workflows: Workflow, goals: Target, scheduler: CalendarClock, triggers: Zap, delivery: Send, quality: ShieldCheck,
  walk: Footprints, builder: Hammer,
};

export function UnlockPath({ compact = false }: { compact?: boolean }) {
  const t = useT(loopMsg);
  const { data, error, loading } = useGameData<UnlockPathData>(() => loopApi.unlockPath(), []);
  if (loading && !data) return <div className="grid place-items-center py-8"><Spinner size={20} /></div>;
  if (error && !data) return <p className="text-sm text-bad" role="alert">{error}</p>;
  if (!data) return null;
  const cards = compact ? data.cards.filter((c) => c.next || c.state === "spotlight").slice(0, 2) : data.cards;
  return (
    <section aria-labelledby="unlock-path-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="unlock-path-title" className="section-title flex-1 min-w-0">{t("up_title")}</h2>
        <Badge tone="info">{t("up_level", { n: data.level })}</Badge>
        <Badge tone="ok"><span className="num">{t("up_progress", { done: data.done, total: data.total })}</span></Badge>
      </div>
      <p className="text-sm text-ink-2 max-w-3xl">{t("up_intro")}</p>
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("up_title")}>
        {cards.map((c) => <li key={c.id} className="min-w-0"><PathCard card={c} /></li>)}
      </ol>
    </section>
  );
}

function PathCard({ card: c }: { card: UnlockCard }) {
  const t = useT(loopMsg);
  const Icon = ICON[c.id];
  const name = t(`up_name_${c.id}` as const);
  const state = c.state === "tried" ? t("up_tried") : c.state === "spotlight" ? t("up_spot") : t("up_later", { n: c.level });
  return (
    <article aria-label={name} aria-current={c.next ? "step" : undefined}
      className={clsx("panel p-3.5 h-full flex flex-col gap-2", c.next && "ring-2 ring-primary",
        c.state === "tried" && "bg-panel-2 shadow-none")}>
      <div className="flex items-start gap-2">
        <span aria-hidden className="h-8 w-8 shrink-0 rounded-md grid place-items-center bg-panel-2 border border-line text-ink-2">
          {c.state === "tried" ? <Check size={16} className="text-ok" /> : <Icon size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display font-semibold text-sm text-ink leading-5">{name}</h3>
          <p className="text-xs text-muted">{state}</p>
        </div>
        {c.next && <Badge tone="info">{t("up_next")}</Badge>}
      </div>
      <p className="text-sm text-ink-2 flex-1">{t(`up_desc_${c.id}` as const)}</p>
      <div className="flex flex-wrap items-center gap-2">
        {c.plan_limit != null && <span className="text-xs text-muted">{t("up_plan_limit", { n: c.plan_limit })}</span>}
        <Link to={c.to} className="btn btn-sm ml-auto" aria-label={`${t("up_open")}: ${name}`}>
          {t("up_open")} <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </article>
  );
}
