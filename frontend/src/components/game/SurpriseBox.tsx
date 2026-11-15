// Sürpriz teslim kutusu: haftalık görev bitince ücretsiz bir kutu. Olasılıklar açmadan ÖNCE kutunun üstünde yazılı;
// kopya çıkmaz; satın alınamaz, jetonla açılmaz, yeniden çekilmez. Açılış anı
// `prefers-reduced-motion`'da hareketsizdir; saniyede 3'ten fazla parlama yok (Y12).
import clsx from "clsx";
import { Gift, Info, PackageOpen, Sparkles } from "lucide-react";
import { useState } from "react";
import { prefersReducedMotion, RARITY_LABEL, useGame } from "../../lib/game";
import { tp, useT } from "../../lib/i18n";
import { seasonApi, type BoxRarity, type SurpriseBoxItem, type SurpriseData } from "../../lib/season";
import { season as m } from "../../locales/game";
import { Button, Empty, Spinner } from "../ui";
import { RarityChip, RarityFrame } from "./parts";
import { useGameData } from "./useGameData";

const SHAKE_MS = 650;

function OddsLabel({ odds, base }: { odds: Record<BoxRarity, number>; base: Record<BoxRarity, number> }) {
  const t = useT(m);
  const adjusted = (Object.keys(base) as BoxRarity[]).some((r) => odds[r] !== base[r]);
  const pct = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-ink flex flex-wrap items-center gap-x-1.5">
        <span className="font-semibold">{t("sb_odds_label")}</span>
        <span className="num">{t("sb_odds", { c: pct(odds.common), r: pct(odds.rare), e: pct(odds.epic) })}</span>
      </p>
      {adjusted && <p className="text-xs text-muted">{t("sb_odds_adjusted")}</p>}
    </div>
  );
}

export function SurpriseBox() {
  const t = useT(m);
  const { data, error, loading, reload } = useGameData<SurpriseData>(() => seasonApi.surprise(), []);
  const [phase, setPhase] = useState<{ box: string; step: "opening" | "done"; result?: SurpriseBoxItem } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (loading && !data) return <div className="grid place-items-center py-8"><Spinner size={20} /></div>;
  if (error && !data) return <p className="text-sm text-bad" role="alert">{error}</p>;
  if (!data) return null;
  const unopened = data.boxes.filter((b) => b.opened_at == null);
  const opened = data.boxes.filter((b) => b.opened_at != null).slice(0, 6);

  const open = async (box: string) => {
    setMsg(null);
    setPhase({ box, step: "opening" });
    const wait = prefersReducedMotion() ? Promise.resolve() : new Promise((r) => window.setTimeout(r, SHAKE_MS));
    try {
      const [res] = await Promise.all([seasonApi.open(box), wait]);
      setPhase({ box, step: "done", result: res.box });
      void useGame.getState().refresh();
    } catch (e) {
      setPhase(null);
      setMsg(String((e as Error).message ?? e));
    }
  };
  const close = () => { setPhase(null); void reload(); };

  return (
    <section aria-label={t("sb_title")} className="flex flex-col gap-2">
      <style>{`
        @keyframes sb-shake { 0%,100% { transform: rotate(0) } 20% { transform: rotate(-6deg) } 40% { transform: rotate(5deg) }
          60% { transform: rotate(-4deg) } 80% { transform: rotate(3deg) } }
        @keyframes sb-pop { from { transform: scale(.7); opacity: 0 } to { transform: none; opacity: 1 } }
        .sb-shake { animation: sb-shake ${SHAKE_MS}ms ease-in-out both }
        .sb-pop { animation: sb-pop 320ms cubic-bezier(.2,.8,.2,1) both }
        @media (prefers-reduced-motion: reduce) { .sb-shake, .sb-pop { animation: none !important } }
      `}</style>
      <h2 className="section-title flex items-center gap-1.5"><Gift size={15} aria-hidden />{t("sb_title")}</h2>
      <p className="text-sm text-ink-2 max-w-3xl">{t("sb_intro")}</p>
      <p className="text-xs text-ink-2 flex items-start gap-1.5"><Info size={13} aria-hidden className="shrink-0 mt-0.5" />{t("sb_rules")}</p>

      {phase?.step === "done" && phase.result ? (
        <Reveal box={phase.result} onClose={close} />
      ) : unopened.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {unopened.map((b) => {
            const busy = phase?.box === b.id;
            return (
              <li key={b.id} className="min-w-0">
                <article className="panel p-3.5 h-full flex flex-col gap-2.5" aria-label={t("sb_box_aria")}>
                  <div className="flex items-center gap-3">
                    <span className={clsx("grid place-items-center h-14 w-14 shrink-0 rounded-xl border-2 border-line bg-panel-2 text-ink",
                      busy && "sb-shake")} aria-hidden>
                      <Gift size={28} />
                    </span>
                    {/* olasılıklar AÇMADAN ÖNCE kutunun üstünde yazılı */}
                    <OddsLabel odds={data.odds} base={data.base_odds} />
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="primary" icon={<PackageOpen size={14} />} onClick={() => { void open(b.id); }}
                      disabled={!!phase || data.pool_empty}>
                      {busy ? t("sb_opening") : t("sb_open")}
                    </Button>
                    {busy && <span className="sr-only" role="status">{t("sb_opening")}</span>}
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="panel"><Empty icon={<Gift size={24} />} title={t("sb_none_title")} text={t("sb_none")} /></div>
      )}
      {unopened.length > 0 && <p className="text-xs text-muted">{tp(m, "sb_unopened", unopened.length)}</p>}
      {data.pool_empty && <p className="text-xs text-ink-2">{t("sb_pool_empty")}</p>}
      {msg && <p className="text-sm text-bad" role="alert">{msg}</p>}
      {unopened.length === 0 && !phase && <OddsLabel odds={data.odds} base={data.base_odds} />}

      {opened.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-2 text-xs font-semibold">{t("sb_history")}</summary>
          <ul className="flex flex-col gap-1.5 mt-2">
            {opened.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2">
                <span className="text-ink min-w-0 break-words">{b.label}</span>
                {b.rarity && <RarityChip rarity={b.rarity} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Reveal({ box, onClose }: { box: SurpriseBoxItem; onClose: () => void }) {
  const t = useT(m);
  const rarity = box.rarity ?? "common";
  return (
    <div className="panel p-4 flex flex-col sm:flex-row items-center gap-4" role="status" aria-live="polite"
      aria-label={t("sb_result_aria", { label: box.label ?? "", rarity: RARITY_LABEL[rarity] })}>
      <span className="sb-pop"><RarityFrame rarity={rarity} icon="package" size={72} /></span>
      <div className="flex-1 min-w-0 text-center sm:text-left flex flex-col gap-1">
        <p className="text-xs text-muted flex items-center gap-1 justify-center sm:justify-start"><Sparkles size={12} aria-hidden />{t("sb_result_title")}</p>
        <p className="font-display font-semibold text-ink text-lg break-words">{box.label}</p>
        <div className="flex justify-center sm:justify-start"><RarityChip rarity={rarity} /></div>
        <p className="text-xs text-muted">{t("sb_result_note")}</p>
      </div>
      <Button onClick={onClose}>{t("sb_done")}</Button>
    </div>
  );
}
