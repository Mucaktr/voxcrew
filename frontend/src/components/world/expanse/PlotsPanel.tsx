/**
 * E2 (PLOT-FE) — Dünya → Parseller paneli ( UX, §7, §13.1).
 *
 * Liste (renk rozeti, ad, deneme etiketi, "Parselime git"), sıradaki parselin fiyatı/seviye eşiği ve sahiplenme. Sahiplenme her
 * zaman açık onay penceresinden geçer (yuva, rozet rengi, isteğe bağlı ad; jeton tutarı metinde). Konum gösterilmez: parsel
 * yuva sırasıyla dünyayı saran halkada durur ve dünya büyüyünce kayar (mini harita ve "Parselime git" yerini gösterir).
 * Erişilebilirlik: düğmeler ≥ 44 px, renk seçimi adlı radyo grubu, durum metni `role="status"`; animasyon yok; 375 px'te sarılır.
*/
import clsx from "clsx";
import { Coins, Fence, LocateFixed, Plus } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { claimPlot, installExploredSync, loadExpanse, useExpanseView } from "../../../lib/expanse";
import { fmtNumber, tp, useT } from "../../../lib/i18n";
import { expanse as XM } from "../../../locales/expanse";
import { PLOT_COLORS } from "../../../voxel/expanse/plots";
import { Badge, Button, Modal, Panel } from "../../ui";

export function PlotsPanel({ world, onGo, className }: { world: string; onGo: (slot: number) => void; className?: string }) {
  const t = useT(XM);
  const { state, loading, error } = useExpanseView();
  const [open, setOpen] = useState(false);
  useEffect(() => { installExploredSync(); }, []);
  useEffect(() => { void loadExpanse(world); }, [world]);
  const st = state?.world === world ? state : null;
  const label = (n: number, name: string) => (name ? t("slot_named", { name, n: n + 1 }) : t("slot", { n: n + 1 }));

  let hint = "";
  if (st) {
    const nx = st.next;
    if (nx.reason === "full") hint = t("reason_full");
    else if (nx.reason === "locked") hint = t("reason_locked");
    else if (nx.reason === "level") hint = t("reason_level", { level: nx.minLevel, now: st.officeLevel });
    else if (nx.reason === "coins") hint = t("reason_coins", { price: fmtNumber(nx.price), balance: fmtNumber(st.balance) });
    else hint = nx.price ? t("next_price", { price: fmtNumber(nx.price), level: nx.minLevel }) : t("next_free");
  }

  return (
    <Panel className={className} title={t("title")} icon={<Fence size={16} aria-hidden="true" />}
      actions={st && (
        <Button size="sm" variant="primary" icon={<Plus size={14} aria-hidden="true" />} disabled={!st.next.canClaim} onClick={() => setOpen(true)}
          className="min-h-11 sm:min-h-0">
          {t("claim")}
        </Button>
      )}>
      <p className="text-sm text-ink-2 mb-3">{t("intro")}</p>
      {!st && loading && <p className="text-sm text-muted" role="status">{t("loading")}</p>}
      {!st && error && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <span className="text-ink-2">{t("error", { msg: error })}</span>
          <Button size="sm" onClick={() => void loadExpanse(world)}>{t("retry")}</Button>
        </div>
      )}
      {st && (
        <>
          <div className="flex flex-wrap gap-1.5 mb-3 text-xs">
            <Badge>{tp(XM, "count", st.plots.length, { max: st.maxPlots })}</Badge>
            <Badge><Coins size={12} aria-hidden="true" />{t("balance", { n: fmtNumber(st.balance) })}</Badge>
            <Badge>{t("radius", { n: st.radius })}</Badge>
            <Badge>{tp(XM, "explored", st.exploredCount)}</Badge>
          </div>
          {st.plots.length === 0 ? (
            <p className="text-sm text-ink-2">{t("empty")}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {st.plots.map((p) => (
                <li key={p.id} className="panel-soft p-2.5 flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="h-5 w-5 rounded-md border-2 border-line shrink-0" style={{ background: p.color }} aria-hidden="true" />
                  <span className="font-semibold text-sm truncate min-w-0 flex-1">{label(p.slot, p.name)}</span>
                  {p.trial && <Badge tone="warn" title={t("trial_hint")}>{t("trial")}</Badge>}
                  <Button size="sm" icon={<LocateFixed size={14} aria-hidden="true" />} className="min-h-11 sm:min-h-0"
                    aria-label={t("go_aria", { n: p.slot + 1 })} onClick={() => onGo(p.slot)}>
                    {t("go")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {(st.plots.length > 0 || st.next.reason) && <p className="text-sm text-ink-2 mt-3" role="status">{hint}</p>}
          {st.admin && <p className="text-xs text-muted mt-1">{t("trial_hint")}</p>}
        </>
      )}
      {st && open && <ClaimDialog world={world} onClose={() => setOpen(false)} />}
    </Panel>
  );
}

function ClaimDialog({ world, onClose }: { world: string; onClose: () => void }) {
  const t = useT(XM);
  const st = useExpanseView((s) => s.state);
  const taken = useMemo(() => new Set(st?.plots.map((p) => p.slot) ?? []), [st]);
  const free = useMemo(() => Array.from({ length: st?.maxPlots ?? 12 }, (_, k) => k).filter((k) => !taken.has(k)), [st, taken]);
  const [slot, setSlot] = useState(free[0] ?? 0);
  const [color, setColor] = useState<string>(PLOT_COLORS[(free[0] ?? 0) % PLOT_COLORS.length]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const slotId = useId(), nameId = useId(), colorId = useId();
  if (!st) return null;
  const price = st.admin ? 0 : st.next.price;
  const body = st.admin ? t("confirm_body_admin", { n: slot + 1 })
    : price ? t("confirm_body_price", { n: slot + 1, price: fmtNumber(price) }) : t("confirm_body_free", { n: slot + 1 });
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      await claimPlot(world, slot, color, name);
      onClose();
    } catch (e) {
      setErr(t("claim_failed", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={t("confirm_title")} width={460}
      footer={(
        <>
          <Button onClick={onClose} className="min-h-11 sm:min-h-0">{t("cancel")}</Button>
          <Button variant="primary" disabled={busy || !free.length} onClick={() => void submit()} className="min-h-11 sm:min-h-0">
            {price ? t("claim_price", { price: fmtNumber(price) }) : st.admin ? t("confirm_ok") : t("claim_free")}
          </Button>
        </>
      )}>
      <div className="flex flex-col gap-4">
        <p className="text-sm">{body}</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={slotId} className="text-sm font-semibold">{t("pick_slot")}</label>
          <select id={slotId} className="select min-h-11" value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
            {free.map((k) => <option key={k} value={k}>{t("slot_option", { n: k + 1 })}</option>)}
          </select>
        </div>
        <fieldset className="flex flex-col gap-1.5 min-w-0">
          <legend id={colorId} className="text-sm font-semibold mb-1.5">{t("confirm_color")}</legend>
          <div role="radiogroup" aria-labelledby={colorId} className="flex flex-wrap gap-2">
            {PLOT_COLORS.map((c, k) => {
              const on = c === color;
              return (
                <button key={c} type="button" role="radio" aria-checked={on} aria-label={t(`color_${k}` as `color_${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`)}
                  title={t(`color_${k}` as `color_${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`)} onClick={() => setColor(c)}
                  className={clsx("h-11 w-11 rounded-lg border-2", on ? "border-ink outline outline-2 outline-offset-2 outline-[var(--focus)]" : "border-line-soft")}
                  style={{ background: c }} />
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-sm font-semibold">{t("confirm_name")}</label>
          <input id={nameId} className="input min-h-11" maxLength={40} value={name} placeholder={t("confirm_name_ph")}
            onChange={(e) => setName(e.target.value)} />
        </div>
        {err && <p className="text-sm text-bad" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}
