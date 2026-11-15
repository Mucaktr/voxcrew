// Karar 13 — Koşular sayfası başlığında bugünkü harcama ve günlük toplam tavan (jeton · dolar), bugün için yükseltme
// ve tavan ayarı. Yazma uçları kullanıcıya aittir (arayüz jetonu otomatik; MCP 403).
import clsx from "clsx";
import { AlertTriangle, Pencil, Wallet } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { dailyBudgetApi, dailyRatio, type DailyBudgetStatus } from "../../lib/dailyBudget";
import { fmtNumber, intlTag, useT } from "../../lib/i18n";
import { registerEventHandler } from "../../lib/store";
import { dailyBudgetMsg as m } from "../../locales/dailyBudget";
import { Badge, Button, Field, Modal } from "../ui";
import { fmtUsd } from "./runFormat";
import { BudgetMeter } from "../board/BudgetMeter";

type Metric = "tokens" | "cost_usd";

function fmt(metric: Metric, v: number | null | undefined): string {
  if (v == null) return "—";
  return metric === "cost_usd" ? fmtUsd(v) : fmtNumber(Math.round(v));
}

function Gauge({ s, metric, label }: { s: DailyBudgetStatus; metric: Metric; label: string }) {
  const t = useT(m);
  const ratio = dailyRatio(s, metric);
  const used = s.spent[metric] ?? 0;
  const limit = s.effective[metric];
  const value = limit == null ? t("used_only", { used: fmt(metric, used) }) : t("of", { used: fmt(metric, used), limit: fmt(metric, limit) });
  return (
    <div className="flex flex-col gap-1 min-w-[min(100%,150px)] flex-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-ink-2">{label}</span>
        <span className={clsx("num font-medium", ratio != null && ratio >= 1 ? "text-bad" : ratio != null && ratio >= 0.8 ? "text-warn" : "text-ink")}>{value}</span>
      </div>
      {/* DASH-MVP: ortak BudgetMeter (bullet bar, %80 çentiği, --meter-* belirteçleri: açık temada eski bg-grass/bg-gold
          dolgusu iz üzerinde 2,70 / 1,66:1 idi, şimdi ≥ 3:1) */}
      {ratio != null && <BudgetMeter ratio={ratio} label={label} valueText={value} />}
    </div>
  );
}

export function DailyBudgetBar() {
  const t = useT(m);
  const [s, setS] = useState<DailyBudgetStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { dailyBudgetApi.status().then(setS).catch(() => undefined); }, []);
  useEffect(() => {
    load();
    const offs = [registerEventHandler("budget.", load), registerEventHandler("run.finished", load)];
    const timer = window.setInterval(load, 60_000);  // gün dönümü ve uzun koşular
    return () => { offs.forEach((off) => off()); window.clearInterval(timer); };
  }, [load]);

  if (!s) return null;
  const metrics: Metric[] = ["tokens", "cost_usd"];
  const near = s.enabled && !s.reached && metrics.some((k) => (dailyRatio(s, k) ?? 0) >= 0.8);
  const raise = async () => {
    setBusy(true);
    setError(null);
    try { setS(await dailyBudgetApi.raiseToday()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const resets = new Date(s.resets_at * 1000).toLocaleTimeString(intlTag(), { hour: "2-digit", minute: "2-digit" });

  return (
    <section className={clsx("panel-soft p-3 flex flex-col gap-2", s.reached && "tone-warn border-2")} aria-label={t("title")}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-sm font-semibold flex items-center gap-1.5"><Wallet size={15} aria-hidden />{t("title")}</h2>
        {!s.enabled && <Badge>{t("off")}</Badge>}
        {s.raised && <Badge tone="info">{t("raised")}</Badge>}
        <span className="flex-1" />
        {s.reached && <Button size="sm" variant="primary" disabled={busy} onClick={raise}>{t("raise")}</Button>}
        <Button size="sm" variant="ghost" icon={<Pencil size={13} aria-hidden />} onClick={() => setEditing(true)}>
          {s.enabled ? t("edit") : t("set")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Gauge s={s} metric="tokens" label={t("tokens")} />
        <Gauge s={s} metric="cost_usd" label={t("cost")} />
      </div>
      {(s.reached || near) && (
        <p className={clsx("text-xs font-semibold flex items-center gap-1.5", s.reached ? "text-bad" : "text-warn")} role="status">
          <AlertTriangle size={13} aria-hidden />{s.reached ? t("reached") : t("near")} {t("resets", { time: resets })}
        </p>
      )}
      {error && <p className="text-xs font-semibold text-bad" role="alert">{error}</p>}
      {editing && <CapForm s={s} onClose={() => setEditing(false)} onSaved={(n) => { setS(n); setEditing(false); }} />}
    </section>
  );
}

function CapForm({ s, onClose, onSaved }: { s: DailyBudgetStatus; onClose: () => void; onSaved: (s: DailyBudgetStatus) => void }) {
  const t = useT(m);
  const ids = { cost: useId(), tokens: useId() };
  const [cost, setCost] = useState(s.cap.cost_usd == null ? "" : String(s.cap.cost_usd));
  const [tokens, setTokens] = useState(s.cap.tokens == null ? "" : String(s.cap.tokens));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
  const save = async (cap: { cost_usd: number | null; tokens: number | null }) => {
    setBusy(true);
    setError(null);
    try { onSaved(await dailyBudgetApi.save(cap)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={t("modal_title")} width={480}
      footer={<>
        {s.enabled && <Button variant="ghost" disabled={busy} onClick={() => save({ cost_usd: null, tokens: null })}>{t("turn_off")}</Button>}
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="primary" disabled={busy} onClick={() => save({ cost_usd: num(cost), tokens: num(tokens) })}>{t("save")}</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">{t("modal_intro")}</p>
        <Field label={<label htmlFor={ids.tokens}>{t("f_tokens")}</label>}>
          <input id={ids.tokens} className="input num" type="number" min={0} step={1000} inputMode="numeric" value={tokens}
            onChange={(e) => setTokens(e.target.value)} />
        </Field>
        <Field label={<label htmlFor={ids.cost}>{t("f_cost")}</label>}>
          <input id={ids.cost} className="input num" type="number" min={0} step={0.5} inputMode="decimal" value={cost}
            onChange={(e) => setCost(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">{t("scope")}</p>
        {error && <p role="alert" className="text-sm text-bad">{t("error", { error })}</p>}
      </div>
    </Modal>
  );
}
