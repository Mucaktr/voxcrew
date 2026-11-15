// Sprint boss'u v1 (gamification B.13). İsteğe bağlı haftalık "daha büyük iş": ilerleme yalnız
// kabul edilen teslimlerden gelir; geri sayım yok, ceza yok (yetişmezse "dinlenmeye çekilir"); ödül yalnız unvan.
import clsx from "clsx";
import { Crown, Moon, Swords } from "lucide-react";
import { useId, useState } from "react";
import { useT } from "../../lib/i18n";
import { loopApi, type BossCandidates, type BossData } from "../../lib/loop";
import { loopMsg } from "../../locales/loop";
import { Badge, Button, Field, Spinner } from "../ui";
import { useGameData } from "./useGameData";

export function SprintBoss() {
  const t = useT(loopMsg);
  const { data, error, loading, setData } = useGameData<BossData>(() => loopApi.boss(), []);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (fn: () => Promise<BossData>) => {
    setBusy(true); setMsg(null);
    try { setData(await fn()); setPicking(false); } catch (e) { setMsg(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  };

  if (loading && !data) return <div className="grid place-items-center py-6"><Spinner size={20} /></div>;
  if (error && !data) return <p className="text-sm text-bad" role="alert">{error}</p>;
  if (!data) return null;
  const cur = data.current;
  const pct = cur ? Math.min(100, Math.round((cur.progress / Math.max(1, cur.target)) * 100)) : 0;

  return (
    <section aria-labelledby="sprint-boss-title" className="panel p-3.5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Swords size={18} aria-hidden className="text-ink-2" />
        <h2 id="sprint-boss-title" className="section-title flex-1 min-w-0">{t("sb_title")}</h2>
        {data.title && <Badge tone="info"><Crown size={12} aria-hidden />{t("sb_title_now", { title: data.title })}</Badge>}
      </div>
      <p className="text-sm text-ink-2 max-w-3xl">{t("sb_intro")}</p>

      {cur && !picking ? (
        <div className={clsx("panel-soft p-3 flex flex-col gap-2", cur.status === "defeated" && "border-ok")}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display font-semibold text-sm flex-1 min-w-0 break-words">{cur.title}</h3>
            <Badge>{t(cur.kind === "workflow" ? "sb_kind_workflow" : "sb_kind_goal")}</Badge>
            {cur.status === "defeated" && <Badge tone="ok">{t("sb_defeated")}</Badge>}
            {cur.status === "resting" && <Badge tone="muted"><Moon size={12} aria-hidden />{t("sb_resting")}</Badge>}
          </div>
          <div className="h-2 rounded-full bg-panel-3 overflow-hidden" role="progressbar" aria-valuemin={0}
            aria-valuemax={cur.target} aria-valuenow={cur.progress} aria-label={t("sb_progress", { n: cur.progress, target: cur.target })}>
            <div className="h-full bg-primary motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-sm text-ink-2 num">{t("sb_progress", { n: cur.progress, target: cur.target })}</p>
          {cur.status === "defeated" && cur.reward && <p className="text-sm text-ok">{t("sb_defeated_text", { title: cur.reward })}</p>}
          {cur.status === "resting" && <p className="text-sm text-ink-2">{t("sb_resting_text")}</p>}
          <div className="flex flex-wrap gap-2">
            {cur.status !== "defeated" && <Button size="sm" onClick={() => setPicking(true)} disabled={busy}>{t("sb_change")}</Button>}
            {cur.status === "active" && (
              <Button size="sm" variant="ghost" icon={<Moon size={14} />} disabled={busy}
                onClick={() => { void act(() => loopApi.restBoss()); }}>{t("sb_rest")}</Button>
            )}
          </div>
        </div>
      ) : picking ? (
        <BossPicker busy={busy} onCancel={() => setPicking(false)}
          onPick={(kind, ref, target) => { void act(() => loopApi.pickBoss(kind, ref, target)); }} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-ink-2 flex-1 min-w-[min(100%,220px)]">{t("sb_none")}</p>
          <Button size="sm" variant="primary" onClick={() => setPicking(true)}>{t("sb_pick")}</Button>
        </div>
      )}

      {msg && <p className="text-sm text-bad" role="alert">{msg}</p>}
      <p className="text-xs text-muted">
        {t("sb_reward_note")}
        {data.next_title && <> · {t("sb_next_title", { need: data.next_title.need, title: data.next_title.title })}</>}
      </p>
      {data.history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-2">{t("sb_history")}</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {data.history.map((h) => (
              <li key={h.week} className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="num text-muted">{h.week}</span>
                <span className="flex-1 min-w-0 truncate">{h.title}</span>
                <Badge tone={h.status === "defeated" ? "ok" : "muted"}>
                  {h.status === "defeated" ? t("sb_defeated") : t("sb_resting")}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function BossPicker({ busy, onPick, onCancel }:
  { busy: boolean; onPick: (kind: "workflow" | "goal", ref: string, target: number) => void; onCancel: () => void }) {
  const t = useT(loopMsg);
  const selId = useId();
  const numId = useId();
  const { data, loading } = useGameData<BossCandidates>(() => loopApi.bossCandidates(), []);
  const [choice, setChoice] = useState("");
  const [target, setTarget] = useState<number | null>(null);
  if (loading && !data) return <div className="grid place-items-center py-4"><Spinner size={18} /></div>;
  if (!data) return null;
  const options = [...data.workflows, ...data.goals];
  if (!options.length) return <p className="text-sm text-ink-2">{t("sb_no_candidates")}</p>;
  const picked = options.find((o) => `${o.kind}:${o.ref}` === choice) ?? options[0];
  const lim = data.targets[picked.kind];
  const value = Math.max(lim.min, Math.min(lim.max, target ?? lim.default));
  return (
    <form className="panel-soft p-3 grid gap-3 sm:grid-cols-[1fr_auto]"
      onSubmit={(e) => { e.preventDefault(); onPick(picked.kind, picked.ref, value); }}>
      <Field label={<label htmlFor={selId}>{t("sb_choose")}</label>}>
        <select id={selId} className="select" value={`${picked.kind}:${picked.ref}`}
          onChange={(e) => { setChoice(e.target.value); setTarget(null); }}>
          {data.workflows.length > 0 && (
            <optgroup label={t("sb_kind_workflow")}>
              {data.workflows.map((w) => <option key={w.ref} value={`workflow:${w.ref}`}>{w.title} · {t("sb_steps", { n: w.steps })}</option>)}
            </optgroup>
          )}
          {data.goals.length > 0 && (
            <optgroup label={t("sb_kind_goal")}>
              {data.goals.map((g) => <option key={g.ref} value={`goal:${g.ref}`}>{g.title}</option>)}
            </optgroup>
          )}
        </select>
      </Field>
      <Field label={<label htmlFor={numId}>{t("sb_target")}</label>} hint={t("sb_target_hint", { min: lim.min, max: lim.max })}>
        <input id={numId} type="number" className="input w-24" min={lim.min} max={lim.max} value={value}
          onChange={(e) => setTarget(Number(e.target.value) || lim.min)} />
      </Field>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" size="sm" variant="primary" disabled={busy} icon={busy ? <Spinner size={13} /> : undefined}>{t("sb_start")}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t("sb_cancel")}</Button>
      </div>
    </form>
  );
}
