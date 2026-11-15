// sınır kartı (satır içi, MODAL DEĞİL). Sıra: ne oldu → ücretsiz çözüm → paket ve gerçek fiyat → kapat.
// Oturumda aynı sınır için en çok bir kez kendiliğinden açılır (lib/planLimit.ts); görev çalışırken paket bağlantısı yok.
// Birden çok sayfada bağlansa da aynı anda tek örnek görünür (ilk bağlanan sahiplenir).
import { Info, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { planApi, useLimitCard, usePlan, type CompareTable } from "../../lib/plan";
import { upgradeCopy, type FreeFix } from "../../lib/planLimit";
import { plan as m } from "../../locales/plan";
import { Button } from "../ui";

let owner = 0;
let nextId = 1;
let compareCache: CompareTable | null = null;

const FIX_KEY: Record<FreeFix, `fix_${FreeFix}`> = {
  bench_swap: "fix_bench_swap", merge_roles: "fix_merge_roles", edit_existing: "fix_edit_existing",
  archive: "fix_archive", pause_other: "fix_pause_other", local_model: "fix_local_model",
  single_agent: "fix_single_agent", earn: "fix_earn",
};

export function LimitCardHost({ onRoster }: { onRoster?: () => void }) {
  const [me] = useState(() => nextId++);
  const [mine, setMine] = useState(false);
  useEffect(() => {
    if (owner === 0) { owner = me; setMine(true); }
    return () => { if (owner === me) owner = 0; };
  }, [me]);
  const decision = useLimitCard((s) => s.decision);
  const card = useLimitCard((s) => s.card);
  const dismiss = useLimitCard((s) => s.dismiss);
  if (!mine || !decision || !card) return null;
  return <LimitCard key={card.key} onRoster={onRoster} onClose={dismiss} />;
}

function LimitCard({ onClose, onRoster }: { onClose: () => void; onRoster?: () => void }) {
  const t = useT(m);
  const d = useLimitCard((s) => s.decision)!;
  const card = useLimitCard((s) => s.card)!;
  const titleId = useId();
  const [cmp, setCmp] = useState<CompareTable | null>(compareCache);
  useEffect(() => {
    if (!card.showUpgrade || compareCache) return;
    planApi.compare().then((c) => { compareCache = c; setCmp(c); }).catch(() => undefined);
  }, [card.showUpgrade]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = d.feature === "seats" ? t("limit_title_seats")
    : d.feature === "run" ? t("limit_title_run")
      : d.reason === "count_limit" ? t("limit_title_count") : t("limit_title_feature");
  const target = cmp?.plans.find((p) => p.id === card.upgradeTo);
  const planName = card.upgradeTo === "pro" ? t("plan_pro") : t("plan_plus");
  // gelir kararları açıkken ve satış yokken fiyat gösterilmez; yalnız satın alma açıksa (purchase.available)
  const purchasable = usePlan((s) => s.snapshot?.purchase?.available === true);
  const upgrade = upgradeCopy(d.feature, purchasable, target ?? null);

  return (
    <section role="status" aria-live="polite" aria-labelledby={titleId}
      className="panel-soft border border-line p-3 sm:p-4 flex flex-col gap-2 min-w-0" data-testid="limit-card">
      <div className="flex items-start gap-2">
        <Info size={18} className="text-info shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1 min-w-0">
          <h2 id={titleId} className="panel-title">{title}{!d.message && d.limit !== null && d.used !== null ? ` · ${d.used}/${d.limit}` : ""}</h2>
          {d.message && <p className="text-sm text-ink-2 mt-0.5 break-words">{d.message}</p>}
        </div>
        <Button size="sm" variant="ghost" icon={<X size={15} />} onClick={onClose} aria-label={t("dismiss")} title={t("dismiss")} />
      </div>
      {card.fixes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-ink-2">{t("limit_free_first")}</span>
          <ul className="flex flex-wrap gap-2">
            {card.fixes.map((f) => (
              <li key={f}>
                {f === "bench_swap" && onRoster
                  ? <Button size="sm" variant="primary" onClick={() => { onRoster(); onClose(); }}>{t("fix_bench_swap")}</Button>
                  : f === "bench_swap"
                    ? <Link className="btn btn-sm btn-primary" to="/paket#kadro" onClick={onClose}>{t("fix_bench_swap")}</Link>
                    : <span className="chip tone-muted">{t(FIX_KEY[f])}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {card.showUpgrade && (
        <p className="text-sm text-ink-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{upgrade.key === "upgrade_line"
            ? t("upgrade_line" as "upgrade_options", { plan: planName, seats: upgrade.seats ?? 0, price: upgrade.price ?? 0 })
            : t(upgrade.key)}</span>
          <Link className="text-link font-semibold hover:underline underline-offset-2" to="/paket" onClick={onClose}>{t("see_plans")}</Link>
        </p>
      )}
    </section>
  );
}
