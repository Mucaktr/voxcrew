// S44 — /kahramanlar: hazır kahraman ajan galerisi (işe al → önizle → onayla; kaldır).
import { Gift, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { HeroCard } from "../components/heroes/HeroCard";
import { RecruitDialog } from "../components/heroes/RecruitDialog";
import { RemoveDialog } from "../components/heroes/RemoveDialog";
import { Badge, Button, Empty, PageHeader, Spinner } from "../components/ui";
import { useLocale, useT } from "../lib/i18n";
import { heroesApi, type Hero } from "../lib/heroes";
import { heroesMsg } from "../locales/heroes";

export default function HeroesPage() {
  const t = useT(heroesMsg);
  const locale = useLocale((s) => s.locale);
  const [heroes, setHeroes] = useState<Hero[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recruiting, setRecruiting] = useState<Hero | null>(null);
  const [removing, setRemoving] = useState<{ slug: string; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setHeroes(await heroesApi.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load, locale]);

  return (
    <div className="p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <PageHeader title={t("page_title")} subtitle={t("page_subtitle")}
        meta={<>
          {heroes && <Badge tone="info"><Sparkles size={12} aria-hidden />{t("meta_count", { n: heroes.length })}</Badge>}
          <Badge tone="ok"><Gift size={12} aria-hidden />{t("meta_free")}</Badge>
          <Badge tone="muted">{t("meta_no_xp")}</Badge>
          <Badge tone="muted"><ShieldCheck size={12} aria-hidden />{t("meta_tools")}</Badge>
        </>} />

      {notice && <p className="panel px-4 py-2 text-sm" role="status">{notice}</p>}

      {error && (
        <Empty title={t("load_failed")} text={error}
          action={<Button icon={<RefreshCcw size={16} />} onClick={() => void load()}>{t("retry")}</Button>} />
      )}
      {!heroes && !error && <p className="text-sm text-muted inline-flex items-center gap-2"><Spinner />{t("loading")}</p>}
      {heroes && heroes.length === 0 && <Empty title={t("empty")} />}
      {heroes && heroes.length > 0 && (
        <ul className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("page_title")}>
          {heroes.map((h) => (
            <li key={h.id} className="flex min-w-0">
              <HeroCard hero={h} onRecruit={() => { setNotice(null); setRecruiting(h); }}
                onRemove={(slug, name) => { setNotice(null); setRemoving({ slug, name }); }} />
            </li>
          ))}
        </ul>
      )}

      {recruiting && <RecruitDialog hero={recruiting} onClose={() => setRecruiting(null)} onDone={() => void load()} />}
      {removing && <RemoveDialog slug={removing.slug} name={removing.name} onClose={() => setRemoving(null)}
        onDone={(msg) => { setRemoving(null); setNotice(msg); void load(); }} />}
    </div>
  );
}
