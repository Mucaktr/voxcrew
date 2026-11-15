// 2026-10-19 — Üyelik sandıkları. İçerik AÇMADAN ÖNCE kartta yazılı; aylık sandıkta
// gösterilen üç öğeden biri seçilir, yükselme sandığı sabit settir. Satın alma, jetonla açma ve yeniden çekme yok. Açılış anı
// `prefers-reduced-motion`'da hareketsiz; parlama yok.
import clsx from "clsx";
import { Check, Gift, Info, PackageOpen, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { chestApi, monthLabel, type Chest, type ChestData, type ChestOption } from "../../lib/chests";
import { prefersReducedMotion, useGame } from "../../lib/game";
import { useT } from "../../lib/i18n";
import { chests as m } from "../../locales/chests";
import { Badge, Button, Empty, Panel, Spinner } from "../ui";

const LIFT_MS = 600;
type T = ReturnType<typeof useT<typeof m.tr>>;

function kindLabel(t: T, kind: string): string {
  return ["decor", "skin", "variant", "material", "celebration", "plaque"].includes(kind) ? t(`kind_${kind}` as "kind_decor") : kind;
}

function chestTitle(t: T, c: Chest): string {
  if (c.kind === "monthly") return t("monthly", { month: monthLabel(c.period) });
  return t("tier_up", { tier: c.tier === "pro" ? "Pro" : "Plus" });
}

function OptionList({ c, picked, onPick, disabled, t }:
  { c: Chest; picked: string | null; onPick: (id: string) => void; disabled: boolean; t: T }) {
  const choose = c.mode === "choose" && !c.preview && c.opened_at == null;
  if (!choose) {
    return (
      <ul className="flex flex-col gap-1.5">
        {c.options.map((o) => <OptionRow key={o.item} o={o} t={t} />)}
      </ul>
    );
  }
  return (
    <div role="radiogroup" aria-label={chestTitle(t, c)} className="flex flex-col gap-1.5">
      {c.options.map((o) => {
        const sel = picked === o.item;
        return (
          <button key={o.item} type="button" role="radio" aria-checked={sel} disabled={disabled || o.owned}
            onClick={() => onPick(o.item)}
            className={clsx("card-select min-h-11 px-2.5 py-1.5 flex items-center gap-2 text-left text-sm",
              sel && "ring-2 ring-[color:var(--focus)]", o.owned && "opacity-70 cursor-not-allowed")}>
            <span className={clsx("grid place-items-center h-5 w-5 shrink-0 rounded-full border", sel ? "bg-primary border-primary text-white" : "border-line")} aria-hidden>
              {sel && <Check size={12} />}
            </span>
            <span className="min-w-0 flex-1 break-words">{o.label}</span>
            <span className="text-xs text-muted shrink-0">{o.owned ? t("owned") : kindLabel(t, o.kind)}</span>
          </button>
        );
      })}
    </div>
  );
}

function OptionRow({ o, t }: { o: ChestOption; t: T }) {
  return (
    <li className="flex items-center gap-2 text-sm min-w-0">
      <Gift size={14} className="text-ink-2 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 break-words">{o.label}</span>
      <span className="text-xs text-muted shrink-0">{o.owned ? t("owned") : kindLabel(t, o.kind)}</span>
    </li>
  );
}

export function MembershipChests() {
  const t = useT(m);
  const [data, setData] = useState<ChestData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Chest | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    chestApi.get().then((d) => { setData(d); setError(null); }).catch((e) => setError(String((e as Error).message ?? e)));
  }, []);
  useEffect(load, [load]);

  if (!data && !error) return <Panel title={t("title")} icon={<Gift size={16} />}><div className="grid place-items-center py-6"><Spinner size={20} /></div></Panel>;
  if (!data) return <Panel title={t("title")} icon={<Gift size={16} />}><p className="text-sm text-bad" role="alert">{error}</p></Panel>;

  const open = async (c: Chest) => {
    const choice = c.mode === "choose" ? picked[c.id] : undefined;
    const needsChoice = c.mode === "choose" && c.options.some((o) => !o.owned);
    if (needsChoice && !choice) { setMsg(t("choose_first")); return; }
    setMsg(null);
    setBusy(c.id);
    const wait = prefersReducedMotion() ? Promise.resolve() : new Promise((r) => window.setTimeout(r, LIFT_MS));
    try {
      const [res] = await Promise.all([chestApi.open(c.id, choice), wait]);
      setResult(res.chest);
      void useGame.getState().refresh();
      load();
    } catch (e) {
      setMsg(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const unopened = data.chests.filter((c) => c.opened_at == null);
  const opened = data.chests.filter((c) => c.opened_at != null).slice(0, 8);
  const shown = data.membership.persist ? unopened : data.preview;
  const isFree = data.membership.monthly === 0 && !data.preview.length;

  return (
    <Panel title={t("title")} icon={<Gift size={16} />}>
      <style>{`
        @keyframes ch-lift { 0% { transform: translateY(0) } 40% { transform: translateY(-6px) rotate(-3deg) } 70% { transform: translateY(-2px) rotate(2deg) } 100% { transform: none } }
        @keyframes ch-pop { from { transform: scale(.8); opacity: 0 } to { transform: none; opacity: 1 } }
        .ch-lift { animation: ch-lift ${LIFT_MS}ms ease-in-out both }
        .ch-pop { animation: ch-pop 300ms cubic-bezier(.2,.8,.2,1) both }
        @media (prefers-reduced-motion: reduce) { .ch-lift, .ch-pop { animation: none !important } }
      `}</style>
      <div className="flex flex-col gap-3 min-w-0">
        <p className="text-sm text-ink-2 max-w-3xl">{t("intro")}</p>
        <p className="text-xs text-ink-2 flex items-start gap-1.5"><Info size={13} aria-hidden className="shrink-0 mt-0.5" />{t("rules")}</p>
        {!data.membership.persist && data.preview.length > 0 && <p className="text-xs text-muted">{t("preview_note")}</p>}
        {isFree && <p className="text-xs text-ink-2">{t("free_note")}</p>}

        {result && (
          <div className="panel p-3 flex flex-col sm:flex-row items-center gap-3" role="status" aria-live="polite"
            aria-label={t("result_aria", { items: result.items.map((i) => i.label).join(", ") || "—" })}>
            <span className="ch-pop grid place-items-center h-14 w-14 rounded-xl border-2 border-line bg-panel-2 text-ink" aria-hidden><Sparkles size={26} /></span>
            <p className="flex-1 min-w-0 text-sm text-center sm:text-left break-words">
              {result.items.length ? t("got", { items: result.items.map((i) => i.label).join(", ") }) : t("got_none")}
            </p>
            <Button size="sm" onClick={() => setResult(null)}>{t("opened")}</Button>
          </div>
        )}

        {shown.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((c) => {
              const lifting = busy === c.id;
              return (
                <li key={c.id} className="min-w-0">
                  <article className="rounded-xl border border-line p-3 h-full flex flex-col gap-2.5 min-w-0" aria-label={chestTitle(t, c)}>
                    <div className="flex items-center gap-2.5">
                      <span className={clsx("grid place-items-center h-11 w-11 shrink-0 rounded-lg border-2 border-line bg-panel-2 text-ink", lifting && "ch-lift")} aria-hidden>
                        <Gift size={22} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-display font-semibold text-ink break-words">{chestTitle(t, c)}</h3>
                        <p className="text-xs text-muted">{c.mode === "choose" ? t("choose_hint") : t("fixed_hint")}</p>
                      </div>
                    </div>
                    <OptionList c={c} t={t} picked={picked[c.id] ?? null} disabled={!!busy}
                      onPick={(id) => setPicked((p) => ({ ...p, [c.id]: id }))} />
                    {!c.preview && (
                      <div className="mt-auto flex items-center gap-2">
                        <Button size="sm" variant="primary" icon={<PackageOpen size={14} />} disabled={!!busy} onClick={() => { void open(c); }}>
                          {lifting ? t("opening") : t("open")}
                        </Button>
                        {lifting && <span className="sr-only" role="status">{t("opening")}</span>}
                      </div>
                    )}
                    {c.preview && <Badge tone="muted">{t("pack_preview")}</Badge>}
                  </article>
                </li>
              );
            })}
          </ul>
        ) : !isFree ? (
          <Empty icon={<Gift size={24} />} title={t("none_title")} text={t("none")} />
        ) : null}
        {data.membership.persist && unopened.length > 0 && <p className="text-xs text-muted">{t("unopened", { n: unopened.length })}</p>}
        {msg && <p className="text-sm text-bad" role="alert">{msg}</p>}

        <details className="text-sm">
          <summary className="cursor-pointer text-ink-2 text-xs font-semibold">{t("next_title", { month: monthLabel(data.next_month.month) })}</summary>
          <p className="text-xs text-muted mt-1">{t("next_hint")}</p>
          <div className="grid gap-2 sm:grid-cols-2 mt-2">
            {data.next_month.sets.map((set, k) => (
              <ul key={k} className="rounded-lg border border-line-soft p-2 flex flex-col gap-1">
                {set.map((o) => <OptionRow key={o.item} o={o} t={t} />)}
              </ul>
            ))}
          </div>
        </details>

        {opened.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-2 text-xs font-semibold">{t("history")}</summary>
            <ul className="flex flex-col gap-1.5 mt-2">
              {opened.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="font-semibold min-w-0 break-words">{chestTitle(t, c)}</span>
                  <span className="text-ink-2 min-w-0 break-words">{c.items.map((i) => i.label).join(", ") || t("got_none")}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Panel>
  );
}
