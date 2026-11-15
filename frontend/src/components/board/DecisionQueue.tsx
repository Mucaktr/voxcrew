// DASH-MVP DecisionQueue / DecisionRow / DecisionPreview.
// - Liste tek sekme durağıdır (dolaşan tabindex): yalnız geçerli satırın başlık düğmesi ve eylemleri sekmeyle gelir.
// - ↑/↓ ya da J/K, Home/End yalnız liste odaktayken (WCAG 2.1.4); Alt/Ctrl/Meta ile çalışmaz. Enter/Boşluk başlıkta
//   önizlemeyi açar, Esc kapatır ve odağı başlığa verir.
// - Önizleme SALT OKUMADIR: onay/ret düğmesi yok, tek tuşla karar yok; "Karar ver" mevcut karar adımına derin bağlantıdır
//   (K1 tek onay yolu; yeni onay ucu yok). Bu dosyada karar verme çağrısı yoktur (board_logic testi denetler).
// PANO-FIX: "Karar ver" kararın kartına iner ( `?karar=`); DOM sırası başlık → meta → eylem (dar ekranda kim
// ve ne zaman eylemden önce okunur); soru satırında maliyet yok; 1 saati geçen bekleme kehribar (yaşlanan karar).
import clsx from "clsx";
import { ArrowRight, CircleCheck, Clock, ListChecks, MessageCircleQuestion, Pause, ShieldCheck, Terminal, Wallet } from "lucide-react";
import { lazy, Suspense, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { Link } from "react-router-dom";
import { EDITION } from "../../edition";
import type { DailyBudgetStatus } from "../../lib/dailyBudget";
import { useT } from "../../lib/i18n";
import type { Agent } from "../../lib/types";
import { boardMsg } from "../../locales/board";
import { PixelFace } from "../PixelFace";
import { Empty, SectionError, Sk, useDelayed, type SectionState } from "./BoardParts";
import { queueMove, type Decision, type DecisionKind } from "./decisionModel";
import { costText, waitText, whyText } from "./boardFormat";

export const QUEUE_LIMIT = 8;

// Salt okuma önizleme yalnız bir satır açılınca gerekir: Pano parçasına girmez, Pano açıldıktan sonra boşta önden yüklenir
const loadPreview = () => import("./DecisionPreview");
const DecisionPreview = lazy(() => loadPreview().then((m) => ({ default: m.DecisionPreview })));
let prefetched = false;
function prefetchPreview() {
  if (prefetched) return;
  prefetched = true;
  const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (idle) idle(() => { void loadPreview(); }); else window.setTimeout(() => { void loadPreview(); }, 1500);
}

const OLD_MS = 60 * 60_000;

const KIND: Record<DecisionKind, { tone: "warn" | "info" | "ok"; icon: ReactNode; label: "kind_approval" | "kind_step" | "kind_budget" | "kind_tool" | "kind_acceptance" | "kind_message" | "kind_paused"; cta: "dec_decide" | "dec_review" | "dec_reply" | "dec_open_task" }> = {
  approval: { tone: "warn", icon: <ListChecks size={16} />, label: "kind_approval", cta: "dec_decide" },
  step: { tone: "warn", icon: <ShieldCheck size={16} />, label: "kind_step", cta: "dec_decide" },
  budget: { tone: "warn", icon: <Wallet size={16} />, label: "kind_budget", cta: "dec_decide" },
  tool_approval: { tone: "warn", icon: <Terminal size={16} />, label: "kind_tool", cta: "dec_decide" },
  message: { tone: "info", icon: <MessageCircleQuestion size={16} />, label: "kind_message", cta: "dec_reply" },
  paused: { tone: "info", icon: <Pause size={16} />, label: "kind_paused", cta: "dec_open_task" },
  acceptance: { tone: "ok", icon: <CircleCheck size={16} />, label: "kind_acceptance", cta: "dec_review" },
};

export interface QueueHandle { focusFirst: () => boolean }

export function DecisionQueue({ handle, decisions, total, state, error, onRetry, agents, daily, fresh, now }: {
  handle?: Ref<QueueHandle>; decisions: Decision[]; total: number; state: SectionState; error?: string | null; onRetry: () => void;
  agents: Agent[]; daily: DailyBudgetStatus | null; fresh: ReadonlySet<string>; now: number;
}) {
  const t = useT(boardMsg);
  const hintId = useId();
  const shown = decisions.slice(0, QUEUE_LIMIT);
  const [curKey, setCurKey] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const titles = useRef(new Map<string, HTMLButtonElement>());
  const curIdx = Math.max(0, shown.findIndex((d) => d.key === curKey));
  const showSkeleton = useDelayed(state === "loading");
  useEffect(() => { if (shown.length) prefetchPreview(); }, [shown.length]);

  // çözülen karar listeden düşünce açık önizleme de kapanır
  useEffect(() => { if (open && !shown.some((d) => d.key === open)) setOpen(null); }, [open, shown]);

  const focusRow = (i: number) => {
    const d = shown[i];
    if (!d) return;
    setCurKey(d.key);
    // dolaşan tabindex yeniden çizilmeden önce odak verilir (öğe zaten DOM'da)
    titles.current.get(d.key)?.focus();
  };
  useImperativeHandle(handle, () => ({ focusFirst: () => { if (!shown.length) return false; focusRow(0); return true; } }));

  if (state === "loading") {
    return showSkeleton ? (
      <div aria-hidden>{[0, 1, 2].map((i) => (
        <div key={i} className="bd-sk-row"><Sk h={32} r={9} /><span className="grid gap-1.5"><Sk w="30%" h={12} /><Sk w="70%" h={14} /><Sk w="50%" h={10} /></span></div>
      ))}</div>
    ) : <span className="sr-only">{t("loading")}</span>;
  }
  if (state === "error") return <SectionError name={t("sec_decisions")} detail={error} onRetry={onRetry} />;
  if (!shown.length) {
    return <Empty tone="ok" icon={<CircleCheck size={18} />} title={t("dec_empty")} text={t("dec_empty_hint")} />;
  }

  const agentOf = (slug: string | null) => (slug ? agents.find((a) => a.slug === slug) : undefined);
  const onKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const next = queueMove(e.key, curIdx, shown.length, { alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey });
    if (next !== null) { e.preventDefault(); focusRow(next); return; }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      const k = open;
      setOpen(null);
      titles.current.get(k)?.focus();
    }
  };

  return (
    <>
      <p className="sr-only" id={hintId}>{t("dec_kb_hint")}</p>
      <ul className="bd-queue" aria-describedby={hintId} onKeyDown={onKey}>
        {shown.map((d, i) => {
          const k = KIND[d.kind];
          const cur = i === curIdx;
          const isOpen = open === d.key;
          const tab = cur ? 0 : -1;
          const agent = agentOf(d.agent);
          const pvId = `pv-${hintId}-${i}`;
          const cta = t(k.cta);
          return (
            <li key={d.key} className={clsx("bd-drow", d.stops && "is-stop", cur && "is-current", fresh.has(d.key) && "is-fresh")}>
              <span className={clsx("bd-kind", `tone-${k.tone}`)} aria-hidden>{k.icon}</span>
              <button type="button" className="bd-dtitle" tabIndex={tab} aria-expanded={isOpen} aria-controls={pvId}
                ref={(el) => { if (el) titles.current.set(d.key, el); else titles.current.delete(d.key); }}
                onFocus={() => setCurKey(d.key)}
                onClick={() => { setCurKey(d.key); setOpen(isOpen ? null : d.key); }}>
                <span className="bd-dline">
                  <span className={clsx("chip", `tone-${k.tone}`)}>{t(k.label)}</span>
                  {d.stops && <span className="bd-stopped">{t("dec_stopped")}</span>}
                  {fresh.has(d.key) && <span className="chip tone-info">{t("dec_new")}</span>}
                </span>
                <span className={clsx("bd-dt", d.mono && "is-mono")}>{d.title}</span>
                <span className="bd-why">{whyText(d.why)}</span>
              </button>
              <span className="bd-dmeta">
                {(agent || d.agent) && (
                  <span className="bd-who">
                    {agent && <PixelFace avatar={agent.avatar} size={20} ring={agent.color} />}
                    {agent?.name ?? d.agent}
                  </span>
                )}
                {d.runTitle && d.runTitle !== d.title && <span className="min-w-0 truncate max-w-[32ch]">{d.runTitle}</span>}
                {d.since != null && (
                  <span className={clsx(now - d.since >= OLD_MS && "is-old")}>
                    <Clock size={14} aria-hidden /><time dateTime={new Date(d.since).toISOString()} title={new Date(d.since).toLocaleString()}>{waitText(now - d.since)}</time>
                  </span>
                )}
                {d.kind !== "message" && <span><Wallet size={14} aria-hidden />{costText(d.cost)}</span>}
              </span>
              <span className="bd-dact">
                <Link to={d.link} tabIndex={tab} className={clsx("btn btn-sm", d.stops && "btn-primary")}
                  aria-label={t("dec_action_aria", { action: cta, title: d.title })}>
                  {cta}<ArrowRight size={14} aria-hidden />
                </Link>
              </span>
              <div className="bd-preview" id={pvId} hidden={!isOpen}>
                {isOpen && <Suspense fallback={null}><DecisionPreview d={d} agent={agent} daily={daily} tab={tab} /></Suspense>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="bd-qhint" aria-hidden>
        <kbd className="kbd">J</kbd><kbd className="kbd">K</kbd>{t("kb_move")} · <kbd className="kbd">Enter</kbd>{t("kb_open")} · {t("kb_order")}
      </p>
      {total > shown.length && (EDITION as string) !== "free" && ( // "Nerede kalmıştım?" sayfası yalnız tam sürümde
        <Link to="/nerede-kalmistim" className="bd-link bd-more">{t("dec_more", { n: total - shown.length })}</Link>
      )}
    </>
  );
}
