// PROC-FIX GPT Codex ajanı kullanıcının Codex kurulumunu varsayılan olarak devralmaz ve web araması kapalıdır;
// ikisi de ajan başına, yalnız kullanıcı tarafından açılır (MCP 403). Devralmayı açmak onay penceresi ister (sunucu
// `confirm: "inherit"` olmadan reddeder); kapatmak tek tıktır. Claude kartıyla aynı düzen: durum rozeti + özet + anahtar,
// bütün iddialar "Ayrıntılar" içinde (locales/codexIsolation.ts).
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { codexIsolationApi, type CodexIsolation } from "../../lib/codexIsolation";
import { useT } from "../../lib/i18n";
import { codexIsolationMsg as m } from "../../locales/codexIsolation";
import { ConfirmDialog, Note } from "../hermes/common";
import { Badge, SectionTitle, Spinner, Toggle } from "../ui";

export function CodexIsolationCard({ slug }: { slug: string }) {
  const t = useT(m);
  const [state, setState] = useState<CodexIsolation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askingPartial, setAskingPartial] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setState(null);
    setError(null);
    codexIsolationApi.get(slug).then((s) => { if (live) setState(s); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [slug]);

  const run = async (fn: () => Promise<CodexIsolation>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await fn());
      setAsking(false);
      setAskingPartial(false);
    } catch (e) {
      setError(t("failed", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const inherited = state?.inherit_user_codex_config === true;
  const sk = state?.skills;
  // skill listesi komut satırına sığmıyorsa kart bunu söyler (yalnız sayılar; ad yok)
  const tooMany = !inherited && !!sk && sk.state !== "complete";
  return (
    <section className="flex flex-col gap-2.5 min-w-0 mt-6" aria-label={t("title")}>
      <SectionTitle as="h3" size="sm" icon={<ShieldCheck size={15} />}>{t("title")}</SectionTitle>
      {state && (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={inherited ? "warn" : "ok"}>{inherited ? t("inherited") : t("isolated")}</Badge>
          {tooMany && <Badge tone={sk!.state === "partial" ? "warn" : "bad"}>{sk!.state === "partial" ? t("skills_partial_badge") : t("skills_too_many_badge")}</Badge>}
        </div>
      )}
      <p className="text-sm text-ink-2 break-words">{inherited ? t("summary_inherited") : t("summary")}</p>
      {!state && !error ? (
        <span className="text-sm text-muted inline-flex items-center gap-2"><Spinner size={13} /> {t("loading")}</span>
      ) : state && (state.internal ? (
        <Note tone="muted">{t("internal")}</Note>
      ) : (
        <div className="flex flex-col gap-2">
          <Toggle checked={inherited} disabled={busy} label={t("toggle")} hint={t("toggle_hint")}
            onChange={(v) => { if (v) setAsking(true); else void run(() => codexIsolationApi.setInherit(slug, false)); }} />
          <Toggle checked={state.web_search} disabled={busy} label={t("web_toggle")} hint={t("web_hint")}
            onChange={(v) => void run(() => codexIsolationApi.setWeb(slug, v))} />
          {tooMany && (
            <Note tone={sk!.state === "partial" ? "warn" : "bad"}>
              {t(sk!.state === "partial" ? "skills_partial" : "skills_too_many",
                { found: sk!.found_exact ? sk!.found : `${sk!.found}+`, fit: sk!.fit, enabled: sk!.enabled })}
            </Note>
          )}
          {(tooMany || state.partial_isolation) && (
            <Toggle checked={state.partial_isolation === true} disabled={busy} label={t("partial_toggle")} hint={t("partial_hint")}
              onChange={(v) => { if (v) setAskingPartial(true); else void run(() => codexIsolationApi.setPartial(slug, false)); }} />
          )}
        </div>
      ))}
      {error && <Note tone="bad">{error}</Note>}
      <details className="panel-soft p-3 text-sm min-w-0">
        <summary className="cursor-pointer font-semibold text-ink-2">{t("details")}</summary>
        <div className="mt-2.5 flex flex-col gap-2.5 min-w-0">
          <p className="text-xs text-ink-2 break-words">{t("intro")}</p>
          {!inherited && sk && sk.state === "complete" && (
            <p className="text-xs text-ink-2 break-words">{t("skills_found", { n: sk.disabled })}</p>
          )}
          <p className="text-xs text-muted break-words">{t("verified", { version: state?.live_check?.version ?? "codex-cli" })}</p>
          <p className="text-xs text-muted break-words">{t("not_verified")}</p>
          <p className="text-xs text-muted break-words">{t("not_covered")}</p>
          <p className="text-xs text-muted break-words">{t("cli_writes")}</p>
        </div>
      </details>
      <ConfirmDialog open={askingPartial} title={t("partial_confirm_title")} confirmLabel={t("partial_confirm")} busy={busy}
        onConfirm={() => void run(() => codexIsolationApi.setPartial(slug, true))} onClose={() => setAskingPartial(false)}>
        {/* onaydan sonra açık kalacak kesin sayı = bulunan − sığan (kapalıyken `enabled` hepsidir) */}
        <p>{t("partial_confirm_body", { enabled: sk ? (sk.found_exact ? sk.found - sk.fit : `${sk.found - sk.fit}+`) : "?" })}</p>
      </ConfirmDialog>
      <ConfirmDialog open={asking} title={t("confirm_title")} confirmLabel={t("confirm")} busy={busy}
        onConfirm={() => void run(() => codexIsolationApi.setInherit(slug, true))} onClose={() => setAsking(false)}>
        <p>{t("confirm_body")}</p>
      </ConfirmDialog>
    </section>
  );
}
