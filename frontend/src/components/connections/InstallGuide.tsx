// SETUP — eksik bir beyin için adım adım kurulum kartı: ne olduğu, maliyet/hesap (dürüst not), işletim sistemine göre
// resmî komut ya da indirme bağlantısı, "Komutu kopyala" + isteğe bağlı "Terminal aç" (BOŞ terminal; komut çalıştırılmaz),
// giriş / ilk ayar adımı (PATH dışında tam yol), "Tekrar kontrol et" ve açıkken birkaç saniyede bir ucuz kontrol.
// Hiçbir şey sessizce kurulmaz. Veri: installGuides.ts (kaynaklar:).
import clsx from "clsx";
import { CheckCircle2, ExternalLink, Info, RefreshCcw, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectionsApi, recheckConnections, type ConnectionState } from "../../lib/connections";
import { useLocale, useT } from "../../lib/i18n";
import { cx } from "../../locales/connections";
import { CopyBlock } from "../connect/CopyBlock";
import { Badge, Button, Segmented, Spinner } from "../ui";
import {
  detectGuideOS, GUIDE_OSES, INSTALL_GUIDES, loginCommand, pick, SOURCES_CHECKED,
  type GuideKind, type GuideMethod, type GuideOS, type GuideShell,
} from "./installGuides";

const OS_LABEL: Record<GuideOS, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };
const COST_TONE = { free: "ok", account: "info", paid: "warn", provider: "info" } as const;
const POLL_MS = 6000;

function thisOS(): GuideOS {
  if (typeof navigator === "undefined") return "windows";
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return detectGuideOS(uaData?.platform || navigator.platform || "", navigator.userAgent);
}

export function InstallGuide({ kind, state }: { kind: GuideKind; state?: ConnectionState }) {
  const t = useT(cx);
  const locale = useLocale((s) => s.locale);
  const g = INSTALL_GUIDES[kind];
  const here = useMemo(thisOS, []);
  const [os, setOs] = useState<GuideOS>(here);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "info" | "warn"; text: string } | null>(null);
  const [term, setTerm] = useState<{ ok: boolean; text: string } | null>(null);
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const installed = !!state?.installed;
  const ready = state?.ready === "ok";
  const wasInstalled = useRef(installed);

  const check = useCallback(async (manual: boolean) => {
    if (manual) setChecking(true);
    try {
      const res = await recheckConnections(true);
      const st = res?.states.find((c) => c.kind === kind);
      if (manual && st && !st.installed) setNote({ tone: "warn", text: t("g_not_yet") });
    } catch (e) {
      if (manual) setNote({ tone: "warn", text: e instanceof Error ? e.message : String(e) });
    } finally {
      if (manual) setChecking(false);
    }
  }, [kind, t]);

  // Açıkken kurulumu bekle: kurulu olana kadar birkaç saniyede bir ucuz kontrol (sunucu kısar; süreç başlatmaz)
  useEffect(() => {
    if (installed) return;
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void check(false); }, POLL_MS);
    return () => window.clearInterval(id);
  }, [installed, check]);

  useEffect(() => {
    if (installed && !wasInstalled.current) setNote({ tone: "ok", text: t("g_found", { name: g.name }) });
    wasInstalled.current = installed;
  }, [installed, g.name, t]);

  const openTerminal = async (shell: GuideShell) => {
    setTerm(null);
    try {
      const res = await connectionsApi.openTerminal(shell);
      setTerm(res.opened ? { ok: true, text: t("g_terminal_opened") } : { ok: false, text: t("g_terminal_failed", { error: res.error ?? "" }) });
    } catch (e) {
      setTerm({ ok: false, text: t("g_terminal_failed", { error: e instanceof Error ? e.message : String(e) }) });
    }
  };

  const openLogin = async () => {
    setLoginMsg(null);
    try {
      const res = await connectionsApi.login(kind);
      setLoginMsg(res.opened ? t("login_opened", { cmd: res.shown }) : t("login_manual", { cmd: res.command }));
    } catch (e) {
      setLoginMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const guide = g.os[os];
  const [first, ...rest] = guide.methods;
  const onPath = state?.extra.on_path as boolean | null | undefined;
  const loginCmd = g.login ? loginCommand(g.login, os, os === here ? state?.install_path : null, os === here ? onPath : null) : null;

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {ready ? (
        <div role="status" className="chip tone-ok !rounded-lg !whitespace-normal !items-start p-2.5 text-sm font-medium">
          <CheckCircle2 size={15} className="shrink-0 mt-0.5" aria-hidden />{t("g_ready", { name: g.name })}
        </div>
      ) : note ? (
        <div role="status" className={clsx("chip !rounded-lg !whitespace-normal !items-start p-2.5 text-sm font-medium", `tone-${note.tone}`)}>{note.text}</div>
      ) : null}

      <section className="flex flex-col gap-1.5" aria-labelledby={`g-what-${kind}`}>
        <h3 id={`g-what-${kind}`} className="panel-title">{t("g_what")}</h3>
        <p className="text-sm text-ink-2">{pick(g.what, locale)}</p>
      </section>

      <section className="panel-soft p-3 flex flex-col gap-1.5" aria-labelledby={`g-cost-${kind}`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`g-cost-${kind}`} className="panel-title">{t("g_cost")}</h3>
          <Badge tone={COST_TONE[g.cost]}>{t(`g_cost_${g.cost}` as "g_cost_free")}</Badge>
        </div>
        <p className="text-sm text-ink-2">{pick(g.costText, locale)}</p>
      </section>

      <div className="flex flex-col gap-1.5">
        <span id={`g-os-${kind}`} className="text-xs font-semibold text-muted">{t("g_os")}</span>
        <div role="group" aria-labelledby={`g-os-${kind}`}>
          <Segmented value={os} onChange={setOs} className="flex-wrap" options={GUIDE_OSES.map((o) => ({
            value: o, label: o === here ? `${OS_LABEL[o]} · ${t("g_this_os")}` : OS_LABEL[o],
          }))} />
        </div>
        {guide.requirements && <p className="text-xs text-muted">{t("g_requirements")}: {pick(guide.requirements, locale)}</p>}
      </div>

      <MethodBlock m={first} locale={locale} onTerminal={openTerminal} />
      {rest.length > 0 && (
        <details className="panel-soft p-3">
          <summary className="cursor-pointer text-sm font-semibold">{t("g_other")}</summary>
          <div className="mt-3 flex flex-col gap-4">
            {rest.map((m) => <MethodBlock key={m.id} m={m} locale={locale} onTerminal={openTerminal} />)}
          </div>
        </details>
      )}
      {term && <p role="status" className={clsx("text-xs", term.ok ? "text-ink-2" : "text-warn")}>{term.text}</p>}

      {g.login && loginCmd && (
        <section className="flex flex-col gap-1.5" aria-labelledby={`g-login-${kind}`}>
          <h3 id={`g-login-${kind}`} className="panel-title">{kind === "hermes" ? t("g_setup_title") : t("g_login_title")}</h3>
          <p className="text-sm text-ink-2">{pick(g.login.body, locale)}</p>
          <CopyBlock text={loginCmd} label={kind === "hermes" ? t("g_setup_title") : t("g_login_title")} />
          {os === here && installed && onPath === false && <p className="text-xs text-muted">{t("g_full_path")}</p>}
          {g.login.terminal && installed && os === here && (
            <Button size="sm" className="self-start" icon={<SquareTerminal size={14} />} onClick={() => { void openLogin(); }}>{t("g_login_open")}</Button>
          )}
          {loginMsg && <p role="status" className="text-xs text-ink-2">{loginMsg}</p>}
        </section>
      )}

      <div className="flex flex-col gap-2 border-t-2 border-line-soft pt-3">
        <p className="text-sm text-ink-2">{pick(g.after, locale)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" disabled={checking} icon={checking ? <Spinner size={13} /> : <RefreshCcw size={14} />} onClick={() => { void check(true); }}>
            {checking ? t("g_checking") : t("g_check")}
          </Button>
          {!installed && <span className="text-xs text-muted flex items-center gap-1"><Spinner size={11} />{t("g_watching")}</span>}
        </div>
        <p className="text-xs text-muted flex items-start gap-1"><Info size={12} className="shrink-0 mt-0.5" aria-hidden />{t("g_no_silent")}</p>
      </div>

      <details className="text-xs text-muted">
        <summary className="cursor-pointer font-semibold">{t("g_sources", { date: SOURCES_CHECKED })}</summary>
        <ul className="mt-1.5 flex flex-col gap-1">
          {g.sources.map((s) => (
            <li key={s.url} className="min-w-0">
              <a className="underline break-all inline-flex items-center gap-1" href={s.url} target="_blank" rel="noopener noreferrer">
                {s.label}<ExternalLink size={11} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function MethodBlock({ m, locale, onTerminal }: { m: GuideMethod; locale: string; onTerminal: (s: GuideShell) => void }) {
  const t = useT(cx);
  return (
    <section className="flex flex-col gap-2 min-w-0" aria-label={pick(m.label, locale)}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="panel-title">{pick(m.label, locale)}</h3>
        {m.recommended && <Badge tone="ok">{t("g_recommended")}</Badge>}
      </div>
      <ol className="flex flex-col gap-2.5 list-decimal pl-5" aria-label={t("g_steps")}>
        {m.steps.map((s, i) => (
          <li key={i} className="text-sm min-w-0 pl-1">
            <span className="font-semibold">{pick(s.title, locale)}</span>
            {s.body && <p className="text-xs text-muted mt-0.5">{pick(s.body, locale)}</p>}
            {s.command && (
              <div className="mt-1.5 flex flex-col gap-1.5">
                <CopyBlock text={s.command} label={pick(s.title, locale)} />
                {s.shell && (
                  <Button size="sm" variant="ghost" className="self-start" icon={<SquareTerminal size={14} />} onClick={() => onTerminal(s.shell!)}>
                    {t("g_open_terminal")}
                  </Button>
                )}
              </div>
            )}
            {s.url && (
              <div className="mt-1.5">
                <a className="btn btn-sm inline-flex max-w-full" href={s.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} aria-hidden /><span className="truncate">{s.urlLabel ? pick(s.urlLabel, locale) : t("g_docs")}</span>
                </a>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
