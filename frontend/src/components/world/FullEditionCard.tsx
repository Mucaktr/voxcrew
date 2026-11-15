// EDITION1 — free sürümde kaldırılan şehirlerin ve ücretli paketlerin yerinde tek "Yakında" kartı (yalnız görünen adlar,
// fiyat ya da satın alma yok; tam sürümde çizilmez).
import clsx from "clsx";
import { Clock } from "lucide-react";
import { useLocale } from "../../lib/i18n";
import { fullEditionCard } from "../../lib/editionUpsell";

export function FullEditionCard({ className }: { className?: string }) {
  const locale = useLocale((s) => s.locale);
  const card = fullEditionCard(locale);
  if (!card) return null;
  return (
    <section aria-label={card.aria} className={clsx("panel-soft border-dashed p-2.5 flex items-start gap-2 text-sm", className)}>
      <Clock size={14} className="shrink-0 mt-0.5 text-muted" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-semibold text-ink-2">{card.title}</span>
        {card.groups.map((g) => (
          <span key={g.label} className="block text-xs text-muted">{g.label}: {g.names.join(", ")}</span>
        ))}
        <span className="block text-xs text-muted mt-0.5">{card.note}</span>
      </span>
    </section>
  );
}
