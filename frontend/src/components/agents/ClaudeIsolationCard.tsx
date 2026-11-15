// (karar 3): Claude Code ajanı kullanıcının ~/.claude kurulumunu varsayılan olarak devralmaz; ajan başına açılır.
// Açmak onay penceresi ister (sunucu `confirm: "inherit"` olmadan reddeder); kapatmak tek tıktır. Yazma kullanıcı-yalnız.
// UX-P2: kart bir bakışta okunur — durum rozeti + tek satır özet + anahtar; bütün iddialar (kapatılanlar, her
// durumda kalanlar, CLI'nin bakım yazımları, canlı doğrulanan / doğrulanmayan listeleri ve sınırlar) "Ayrıntılar"
// açılır bölümündedir. Metinler değişmedi (locales/claudeIsolation.ts; paylaşılan testler sabitler).
import { ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { claudeIsolationApi, type ClaudeIsolation } from "../../lib/claudeIsolation";
import { useT } from "../../lib/i18n";
import { splitLimits } from "../../lib/isoLimits";
import { claudeIsolationMsg as m } from "../../locales/claudeIsolation";
import { ConfirmDialog, Note } from "../hermes/common";
import { Badge, SectionTitle, Spinner, Toggle } from "../ui";

function Limits({ text }: { text: string }) {
  const parts = useMemo(() => splitLimits(text), [text]);
  if (!parts) return <p className="text-xs text-muted break-words">{text}</p>;
  const list = (title: string, items: string[]) => (
    <div className="flex flex-col gap-1 min-w-0">
      <p className="text-xs font-semibold text-ink-2 break-words">{title}</p>
      <ul className="list-disc pl-5 flex flex-col gap-0.5 text-xs text-muted">
        {items.map((x) => <li key={x} className="break-words">{x}</li>)}
      </ul>
    </div>
  );
  return (
    <>
      {list(parts.verifiedTitle, parts.verified)}
      {list(parts.unverifiedTitle, parts.unverified)}
      {parts.rest.length > 0 && <p className="text-xs text-muted break-words">{parts.rest.join(" ")}</p>}
    </>
  );
}

export function ClaudeIsolationCard({ slug }: { slug: string }) {
  const t = useT(m);
  const [state, setState] = useState<ClaudeIsolation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setState(null);
    setError(null);
    claudeIsolationApi.get(slug).then((s) => { if (live) setState(s); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [slug]);

  const save = async (inherit: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setState(await claudeIsolationApi.set(slug, inherit));
      setAsking(false);
    } catch (e) {
      setError(t("failed", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const inherited = state?.inherit_user_claude_config === true;
  return (
    <section className="flex flex-col gap-2.5 min-w-0 mt-6" aria-label={t("title")}>
      {/* rozet başlığın yanında değil altında; 375 px'te başlık kesilmez*/}
      <SectionTitle as="h3" size="sm" icon={<ShieldCheck size={15} />}>{t("title")}</SectionTitle>
      {state && (
        <div><Badge tone={inherited ? "warn" : "ok"}>{inherited ? t("inherited") : t("isolated")}</Badge></div>
      )}
      {/* kayıt doğrulanamadı / okunamadı → herkes yalıtılmış; yalnız günlükte kalmasın*/}
      {state?.record_ignored && (
        <Note tone="warn">{state.record === "corrupt" ? t("record_corrupt") : t("record_void")}</Note>
      )}
      {/* bir bakışta ne kapalı, ne aynen kalıyor — ayrıntı aşağıda*/}
      <p className="text-sm text-ink-2 break-words">{inherited ? t("summary_inherited") : t("summary")}</p>
      {!state && !error ? (
        <span className="text-sm text-muted inline-flex items-center gap-2"><Spinner size={13} /> {t("loading")}</span>
      ) : state && (state.internal ? (
        <Note tone="muted">{t("internal")}</Note>
      ) : (
        <Toggle checked={inherited} disabled={busy} label={t("toggle")} hint={t("toggle_hint")}
          onChange={(v) => { if (v) setAsking(true); else void save(false); }} />
      ))}
      {state && !inherited && (state.ancestor_files ?? 0) > 0 && (
        <Note tone="warn">{t("ancestor_warn", { n: state.ancestor_files ?? 0 })}</Note>
      )}
      {error && <Note tone="bad">{error}</Note>}
      <details className="panel-soft p-3 text-sm min-w-0">
        <summary className="cursor-pointer font-semibold text-ink-2">{t("details")}</summary>
        <div className="mt-2.5 flex flex-col gap-2.5 min-w-0">
          <p className="text-xs text-ink-2 break-words">{t("intro")}</p>
          {!inherited && <Limits text={t("limits")} />}
          <p className="text-xs text-muted break-words">{t("not_covered")}</p>
          {/* ISO-WORDING: CLI'nin ~/.claude bakım yazımları her iki kipte de olur; uygulamanın engelleyemediği bir sınır */}
          <p className="text-xs text-muted break-words">{t("cli_writes")}</p>
        </div>
      </details>
      <ConfirmDialog open={asking} title={t("confirm_title")} confirmLabel={t("confirm")} busy={busy}
        onConfirm={() => void save(true)} onClose={() => setAsking(false)}>
        <p>{t("confirm_body")}</p>
      </ConfirmDialog>
    </section>
  );
}
