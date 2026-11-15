// Ekip S5 — Görev panosu: 3 günlük + 2 haftalık yuva. Süre dolmaz; geri sayım ve kırmızı uyarı yok (araştırma C.4).
import clsx from "clsx";
import { ArrowRight, Check, Footprints, Gift, RefreshCcw, ScrollText } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { gameApi, useGame, type Quest, type QuestsData } from "../../lib/game";
import { useT } from "../../lib/i18n";
import { game as m } from "../../locales/game";
import { walk as WM } from "../../locales/walk";
import { Button, Empty, Panel, Spinner } from "../ui";
import { CoinAmount } from "./parts";
import { SprintBoss } from "./SprintBoss"; // haftalık "daha büyük iş" (isteğe bağlı, ceza yok)
import { useGameData } from "./useGameData";
import { SeasonStrip } from "./SeasonTrack";
import { SurpriseBox } from "./SurpriseBox";

export function QuestBoard() {
  const t = useT(m);
  const { data, error, loading, reload } = useGameData<QuestsData>(() => gameApi.quests(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    setMsg(null);
    try { await fn(); setMsg(ok); await reload(); void useGame.getState().refresh(); }
    catch (e) { setMsg(String((e as Error).message ?? e)); }
    finally { setBusy(null); }
  };

  if (loading && !data) return <div className="grid place-items-center py-16"><Spinner size={24} /></div>;
  if (error && !data) return <p className="text-sm text-bad" role="alert">{error}</p>;
  if (!data) return null;
  const daily = data.items.filter((q) => q.kind === "daily");
  const weekly = data.items.filter((q) => q.kind === "weekly");
  const hour = String(data.refill.day_start_hour).padStart(2, "0");
  const claim = (q: Quest) => act(q.id, () => gameApi.claim(q.id), t("claimed_msg", { coins: q.reward.coins, xp: q.reward.xp }));
  const swap = (q: Quest) => act(q.id, () => gameApi.swap(q.id), t("swapped_msg"));

  return (
    <div className="flex flex-col gap-4">
      <SeasonStrip /> {/* kompakt sezon şeridi (görev yuvası SP verir)*/}
      <p className="text-sm text-ink-2 max-w-3xl">{t("quests_intro")}</p>
      {/* W4: yürüme görevleri yuva sayısını artırmaz (günlük ve haftalık panoda en çok 1) */}
      <WalkSlotNote />
      <QuestColumn title={t("daily_title")} quests={daily} busy={busy} onClaim={claim} onSwap={swap} />
      <QuestColumn title={t("weekly_title")} quests={weekly} busy={busy} onClaim={claim} onSwap={swap} />
      <SurpriseBox /> {/* haftalık görev → ücretsiz sürpriz kutu (olasılıklar yazılı)*/}
      <SprintBoss />
      {msg && <p className="text-sm text-ink-2" role="status">{msg}</p>}
      <p className="text-xs text-muted">{t("refill_note", { hour })}</p>
    </div>
  );
}

function WalkSlotNote() {
  const tw = useT(WM);
  return <p className="text-xs text-ink-2 flex items-start gap-1.5 max-w-3xl"><Footprints size={13} aria-hidden="true" className="shrink-0 mt-0.5" />{tw("qt_slot_rule")}</p>;
}

function QuestColumn({ title, quests, busy, onClaim, onSwap }:
  { title: string; quests: Quest[]; busy: string | null; onClaim: (q: Quest) => void; onSwap: (q: Quest) => void }) {
  const t = useT(m);
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="section-title">{title}</h2>
      {quests.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {quests.map((q) => <li key={q.id} className="min-w-0"><QuestCard quest={q} busy={busy === q.id} onClaim={() => onClaim(q)} onSwap={() => onSwap(q)} /></li>)}
        </ul>
      ) : (
        <Panel><Empty icon={<ScrollText size={24} />} title={t("no_quests_title")} text={t("no_quests_text")} /></Panel>
      )}
    </section>
  );
}

function QuestCard({ quest: q, busy, onClaim, onSwap }: { quest: Quest; busy: boolean; onClaim: () => void; onSwap: () => void }) {
  const t = useT(m);
  const pct = Math.min(100, Math.round((q.progress / Math.max(1, q.target)) * 100));
  const done = q.status === "done";
  const claimed = q.status === "claimed";
  return (
    <article className={clsx("panel p-3.5 h-full flex flex-col gap-2.5", claimed && "bg-panel-2 border-line-soft shadow-none")} aria-label={q.title}>
      <div className="flex items-start gap-2">
        <h3 className="font-display font-semibold text-sm text-ink flex-1 min-w-0 leading-5">{q.title}</h3>
        {(q as Quest & { walk?: boolean }).walk && <WalkChip />}
        {claimed ? <span className="chip tone-ok shrink-0"><Check size={12} />{t("claimed_chip")}</span>
          : done ? <span className="chip tone-warn shrink-0"><Gift size={12} />{t("ready_chip")}</span> : null}
      </div>
      <p className="text-xs text-muted leading-4"><span className="font-semibold text-ink-2">{t("why")}</span>{q.why}</p>
      <div className="flex items-center gap-2">
        <div role="progressbar" aria-label={t("quest_progress", { title: q.title })} aria-valuemin={0} aria-valuemax={q.target} aria-valuenow={Math.min(q.progress, q.target)}
          aria-valuetext={`${Math.min(q.progress, q.target)} / ${q.target}`}
          className="flex-1 h-2.5 rounded-full border-2 border-line-soft bg-panel-3 overflow-hidden">
          <div className="h-full bg-grass" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs num text-ink-2">{Math.min(q.progress, q.target)}/{q.target}</span>
      </div>
      <p className="text-xs text-ink-2 flex items-center gap-2">{t("reward")} <CoinAmount value={q.reward.coins} sign /> <span className="num">+{q.reward.xp} XP</span></p>
      <div className="flex flex-wrap gap-2 mt-auto">
        {done && <Button size="sm" variant="primary" icon={<Gift size={14} />} onClick={onClaim} disabled={busy}>{t("claim")}</Button>}
        {!done && !claimed && q.go && <Link to={q.go} className="btn btn-sm"><ArrowRight size={14} aria-hidden />{t("go")}</Link>}
        {!done && !claimed && <Button size="sm" variant="ghost" icon={<RefreshCcw size={14} />} onClick={onSwap} disabled={busy}
          aria-label={t("swap_aria", { title: q.title })}>{t("swap")}</Button>}
      </div>
    </article>
  );
}

function WalkChip() {
  const tw = useT(WM);
  return <span className="chip tone-info shrink-0 text-xs"><Footprints size={11} aria-hidden="true" />{tw("qt_walk")}</span>;
}
