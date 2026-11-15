// 2026-10-19 — Özellik paketleri ("kurgular"): hangi katmana dahil, bu kurulumda açık mı. Satın alma yok ("Yakında").
// Tek kaynak backend/studio/entitlements/plans.py (FEATURE_PACKS, TIER_PACKS) → /api/plan/compare ve /api/plan.
import { Coins, Puzzle } from "lucide-react";
import { useT } from "../../lib/i18n";
import type { CompareTable, PlanSnapshot } from "../../lib/plan";
import { chests as m } from "../../locales/chests";
import { Badge, Panel } from "../ui";

const PLAN_NAME: Record<string, string> = { free: "Free", plus: "Plus", pro: "Pro" };

export function FeaturePacks({ cmp, snapshot }: { cmp: CompareTable; snapshot: PlanSnapshot }) {
  const t = useT(m);
  const packs = cmp.feature_packs ?? [];
  if (!packs.length) return null;
  const mine = new Set(snapshot.features.packs ?? []);
  const preview = snapshot.source === "admin" || snapshot.source === "test";
  return (
    <Panel title={t("packs_title")} icon={<Puzzle size={16} />}>
      <div className="flex flex-col gap-3 min-w-0">
        <p className="text-sm text-ink-2 max-w-3xl">{t("packs_intro")}</p>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {packs.map((p) => {
            const on = mine.has(p.id);
            const state = !p.enforced ? t("pack_declared") : on ? (preview ? t("pack_preview") : t("pack_active")) : t("pack_off");
            const tone = !p.enforced ? "muted" : on ? (preview ? "info" : "ok") : "muted";
            return (
              <li key={p.id} className="rounded-xl border border-line p-3 flex flex-col gap-1.5 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display font-semibold text-ink break-words min-w-0">{p.label}</h3>
                  <Badge tone={tone}>{state}</Badge>
                </div>
                <p className="text-sm text-ink-2 break-words">{p.description}</p>
                <p className="text-xs text-muted">
                  {t("pack_in", { plans: p.plans.map((x) => PLAN_NAME[x] ?? x).join(", ") || t("pack_none_plan") })}
                </p>
                {p.addon && <p className="text-xs text-muted">{t("pack_addon")}</p>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-ink-2 flex items-start gap-1.5"><Coins size={13} aria-hidden className="shrink-0 mt-0.5" />{t("coins_note")}</p>
      </div>
    </Panel>
  );
}
