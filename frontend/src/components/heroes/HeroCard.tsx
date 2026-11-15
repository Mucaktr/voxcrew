// S44: kahraman kartı — görünüm (2B kafa ikonu; 3B önizleme onay penceresinde), çözdüğü sorun, skill, hafıza, beyin.
import { Brain, BookOpen, Sparkles, Trash2, UserPlus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { tp, useT } from "../../lib/i18n";
import { BRAIN_LABEL, type Hero } from "../../lib/heroes";
import { useStudio } from "../../lib/store";
import { heroesMsg } from "../../locales/heroes";
import { PixelFace } from "../PixelFace";
import { Badge, Button } from "../ui";
import { useHeroBrain } from "./brain";

export function HeroCard({ hero, onRecruit, onRemove }: { hero: Hero; onRecruit: () => void; onRemove: (slug: string, name: string) => void }) {
  const t = useT(heroesMsg);
  const brain = useHeroBrain(hero.brain);
  const agents = useStudio((s) => s.agents);
  const titleId = `hero-${hero.id}-title`;
  const recruited = hero.recruited.map((slug) => ({ slug, name: agents.find((a) => a.slug === slug)?.name ?? slug }));
  return (
    <article className="panel flex flex-col overflow-hidden min-w-0 w-full" aria-labelledby={titleId}>
      <div className="h-1.5" style={{ background: hero.color }} aria-hidden />
      <div className="p-4 flex flex-col gap-3 flex-1 min-w-0">
        <div className="flex items-start gap-3 min-w-0">
          <PixelFace avatar={hero.avatar} size={60} ring={hero.color} />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-lg font-bold leading-tight truncate">{hero.name}</h2>
            <p className="text-sm text-ink-2 truncate">{hero.title}</p>
            <p className="text-xs text-muted italic mt-0.5 line-clamp-2">“{hero.catchphrase}”</p>
          </div>
        </div>
        <div>
          <div className="t-overline text-muted">{t("solves")}</div>
          <p className="text-sm mt-0.5">{hero.problem}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="info"><Sparkles size={12} aria-hidden />{tp(heroesMsg, "skill_count", hero.skills.length, { n: hero.skills.length })}</Badge>
          <Badge tone="muted"><BookOpen size={12} aria-hidden />{t("memory_nodes", { n: hero.memory_size })}</Badge>
          <Badge tone={brain.state === "ready" ? "ok" : brain.state === "blocked" ? "bad" : "warn"}
            title={t("brain_chain", { chain: brain.chain.map((k) => BRAIN_LABEL[k]).join(" → ") })}>
            <Brain size={12} aria-hidden />{BRAIN_LABEL[brain.pick]} · {brain.state === "ready" ? t("brain_ready") : brain.state === "blocked" ? t("brain_blocked") : t("brain_setup")}
          </Badge>
        </div>
        {recruited.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="t-overline text-muted inline-flex items-center gap-1"><Users size={12} aria-hidden />{t("in_team")}</div>
            <ul className="flex flex-col gap-1">
              {recruited.map((r) => (
                <li key={r.slug} className="flex items-center gap-2 min-w-0">
                  <Link to={`/ajanlar/${encodeURIComponent(r.slug)}`} className="text-sm font-semibold text-link truncate flex-1 min-w-0">{r.name}</Link>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => onRemove(r.slug, r.name)}
                    aria-label={`${t("remove")}: ${r.name}`}>{t("remove")}</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-auto pt-1">
          <Button variant="primary" icon={<UserPlus size={16} />} onClick={onRecruit} className="w-full justify-center"
            aria-describedby={titleId}>{recruited.length ? t("recruit_again") : t("recruit")}</Button>
        </div>
      </div>
    </article>
  );
}
