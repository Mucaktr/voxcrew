// DASH-MVP Pano alt sırası: Son çıktılar (okunmadı noktası + sr-only), Yaklaşan zamanlamalar (zaman sütunu),
// Etkinlik (varsayılan kapalı <details>; açık/kapalı yalnız bu tarayıcıda).
// İlk ekranın altındadır: ayrı parçada, Pano ile birlikte paralel yüklenir (parça bütçesi §9).
// PANO-FIX: iki parça ( iki sütun: çıktılar sol, zamanlamalar + etkinlik sağ); çıktı türü okunur adıyla ("Rapor",
// ham `report` değil); hata cümlesi bölüm adıyla; Etkinlik başlığı gerçek h2 + açılır düğme.
import { Activity, CalendarClock, ChevronDown, FileText } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { timeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { useSchedules, type Schedule } from "../../lib/schedule";
import { feedText, type FeedItem } from "../../lib/store";
import type { Agent } from "../../lib/types";
import type { ResumeView } from "../../full/data";
import { boardLowerMsg } from "../../locales/boardLower";
import { deliverablesMsg } from "../../locales/deliverables";
import { PixelFace } from "../PixelFace";
import { BoardSection, Empty, SectionError, Sk, useDelayed } from "./BoardParts";
import { clock } from "./boardFormat";
import { intlTag, tx } from "../../lib/i18n";

function RecentOutputs({ items, runAgent }: { items: ResumeView["deliverables"]["items"]; runAgent: (runId: string) => Agent | undefined }) {
  const t = useT(boardLowerMsg);
  if (!items.length) return <Empty tone="muted" icon={<FileText size={18} />} title={t("outs_empty")} text={t("outs_empty_hint")} />;
  return (
    <ul className="bd-list">
      {items.slice(0, 5).map((d) => {
        const agent = runAgent(d.run_id);
        return (
          <li key={d.id}>
            <Link to={d.link}>
              <FileText size={16} aria-hidden className="shrink-0 text-ink-2" />
              <span className="bd-tt">
                <b>{d.title}</b>
                <span>{[agent?.name, kindName(d.kind), timeAgo(d.created_at)].filter(Boolean).join(" · ")}</span>
              </span>
              {d.version_state && <span className={`chip ${d.version_state === "revising" ? "tone-info" : "tone-muted"}`}>
                {t(d.version_state === "revising" ? "out_revising" : "out_superseded")}</span>}
              {d.unread && !d.version_state && <><span className="bd-unread" aria-hidden /><span className="sr-only">{t("out_unread")}</span></>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Teslim türünün okunur adı (Çıktılar sayfasıyla aynı sözlük); bilinmeyen tür gösterilmez. */
function kindName(kind: string | null | undefined): string {
  if (!kind) return "";
  const key = `kind_${kind}` as keyof typeof deliverablesMsg.tr;
  return key in deliverablesMsg.tr ? tx(deliverablesMsg, key) : "";
}

function UpcomingSchedules({ items, enabled, agents, now }: { items: Schedule[]; enabled: boolean; agents: Agent[]; now: number }) {
  const t = useT(boardLowerMsg);
  const next = useMemo(() => items.filter((s) => s.enabled && s.next_run_at)
    .map((s) => ({ s, at: Date.parse(s.next_run_at!) })).filter((x) => Number.isFinite(x.at))
    .sort((a, b) => a.at - b.at).slice(0, 5), [items]);
  const target = (s: Schedule): string => {
    const tg = s.target;
    if (!tg) return "";
    if (tg.type === "task") return t("target_task", { agent: agents.find((a) => a.slug === tg.agent)?.name ?? tg.agent });
    return t(tg.type === "recipe" ? "target_recipe" : tg.type === "workflow" ? "target_workflow" : "target_goal");
  };
  return (
    <>
      {!enabled && <p className="chip tone-warn !whitespace-normal mb-2">{t("sched_off")}</p>}
      {!next.length ? (
        <Empty tone="muted" icon={<CalendarClock size={18} />} title={t("sched_empty")} text={t("sched_empty_hint")}
          action={<Link to="/zamanlayici" className="bd-link">{t("sched_add")}</Link>} />
      ) : (
        <ul className="bd-list">
          {next.map(({ s, at }) => (
            <li key={s.id}>
              <Link to={`/zamanlayici/${encodeURIComponent(s.id)}`}>
                <time className="bd-when num" dateTime={s.next_run_at!}>{clock(at)}<small>{dayLabel(at, now)}</small></time>
                <span className="bd-tt"><b>{s.title}</b><span>{target(s)}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const FEED_KEY = "vc-board-feed-open";
const readOpen = () => { try { return window.localStorage.getItem(FEED_KEY) === "1"; } catch { return false; } };

function ActivityFeed({ feed, agents, now }: { feed: FeedItem[]; agents: Agent[]; now: number }) {
  const t = useT(boardLowerMsg);
  const bodyId = useId();
  const [open, setOpen] = useState(readOpen);
  const recent = feed.filter((f) => now - f.ts < 3_600_000).slice(0, 12);
  const toggle = () => {
    const v = !open;
    setOpen(v);
    try { window.localStorage.setItem(FEED_KEY, v ? "1" : "0"); } catch { /* gizli pencere */ }
  };
  // başlık gezintisinde görünen gerçek h2; açılır düğme başlığın içinde (WAI-ARIA açılır bölüm deseni)
  return (
    <div className="bd-feed" data-open={open || undefined}>
      <div className="bd-sec-head">
        <h2 id="bd-feed-h" className="panel-title">
          <button type="button" className="bd-feed-btn" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
            <Activity size={16} aria-hidden /><span>{t("feed_title")}</span>
            <span className="text-xs text-muted font-normal font-sans">{t("feed_hint")}</span>
            <ChevronDown size={16} aria-hidden className="bd-chev" />
          </button>
        </h2>
      </div>
      <div className="bd-sec-body" id={bodyId} hidden={!open}>
        {!recent.length ? <p className="text-xs text-muted px-2 py-1">{t("feed_empty")}</p> : (
          <ol className="flex flex-col">
            {recent.map((f) => {
              const a = f.agent ? agents.find((x) => x.slug === f.agent) : undefined;
              return (
                <li key={f.id} className="bd-ev">
                  <time className="num" dateTime={new Date(f.ts).toISOString()}>{clock(f.ts)}</time>
                  <span className="flex items-start gap-1.5 min-w-0">
                    {a && <PixelFace avatar={a.avatar} size={18} className="mt-px" />}
                    {f.run_id ? <Link to={`/gorevler/${f.run_id}`} className="min-w-0 break-words">{feedText(f)}</Link> : <span className="min-w-0 break-words">{feedText(f)}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

/** Gün etiketi: bugün / yarın / "Pzt" (bu hafta) / "1 Kas". */
function dayLabel(t: number, now = Date.now()): string {
  const d = new Date(t), n = new Date(now);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(n)) / 86400000);
  if (diff === 0) return tx(boardLowerMsg, "today");
  if (diff === 1) return tx(boardLowerMsg, "tomorrow");
  if (diff > 1 && diff < 7) return d.toLocaleDateString(intlTag(), { weekday: "short" });
  return d.toLocaleDateString(intlTag(), { day: "numeric", month: "short" });
}

/** Sol sütunun alt bölümü: Son çıktılar (kendi yükleniyor / boş / hata durumuyla). */
export function BoardLowerMain({ resume, resumeError, onRetryResume, runAgent }: {
  resume: ResumeView | null; resumeError: string | null; onRetryResume: () => void; runAgent: (runId: string) => Agent | undefined;
}) {
  const t = useT(boardLowerMsg);
  const skel = useDelayed(!resume && !resumeError);
  return (
    <BoardSection id="bd-outs" area="bd-a-outs" title={t("outs_title")} link={{ to: "/ciktilar", label: t("outs_all") }}>
      {resume ? <RecentOutputs items={resume.deliverables.items} runAgent={runAgent} />
        : resumeError ? <SectionError name={t("sec_outputs")} detail={resumeError} onRetry={onRetryResume} />
        : skel ? <div aria-hidden className="grid gap-3 py-2">{[0, 1, 2, 3].map((i) => <span key={i} className="grid gap-1.5"><Sk w="60%" h={12} /><Sk w="40%" h={10} /></span>)}</div> : null}
    </BoardSection>
  );
}

/** Sağ sütunun alt bölümleri: Yaklaşan zamanlamalar, Etkinlik. */
export function BoardLowerSide({ schedules, schedLoaded, schedError, schedEnabled, feed, agents, now }: {
  schedules: Schedule[]; schedLoaded: boolean; schedError: string | null; schedEnabled: boolean; feed: FeedItem[]; agents: Agent[]; now: number;
}) {
  const t = useT(boardLowerMsg);
  const schedSkel = useDelayed(!schedLoaded);
  return (
    <>
      <BoardSection id="bd-sched" area="bd-a-sched" title={t("sched_title")} link={{ to: "/zamanlayici", label: t("sched_all") }}>
        {schedLoaded && !schedError ? <UpcomingSchedules items={schedules} enabled={schedEnabled} agents={agents} now={now} />
          : schedError && !schedules.length ? <SectionError name={t("sec_schedules")} detail={schedError} onRetry={() => { void useSchedules.getState().refresh(); }} />
          : schedSkel ? <div aria-hidden className="grid gap-3 py-2"><Sk w="70%" h={12} /><Sk w="55%" h={12} /><Sk w="60%" h={12} /></div> : null}
      </BoardSection>
      <section className="panel bd-sec bd-a-feed" aria-labelledby="bd-feed-h">
        <ActivityFeed feed={feed} agents={agents} now={now} />
      </section>
    </>
  );
}
