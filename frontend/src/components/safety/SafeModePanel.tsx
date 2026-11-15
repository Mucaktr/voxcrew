// TRUST (S3, STRATEGY §7.3) — "Güvenli mod" ön ayarı. Tek anahtar: açmadan önce neyin değişeceği gösterilir, onaylanınca
// var olan ayar anahtarlarına güvenli değerler yazılır ve önceki değerler saklanır. "Kapat" bunları geri getirir
// (sonradan elle değiştirilen ayar korunur). Her ayar sonra da görünür; evet/hayır olanlar burada tek tek değişir,
// diğerleri kendi panelinden (model politikası, araçlar, bütçe). Yazma uçları kullanıcıya aittir (MCP değiştiremez).
import { Info, ShieldCheck } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useT } from "../../lib/i18n";
import { fmtValue, safeModeApi, useSafeMode, wireSafeMode, type SafeItem, type SafeModeStatus } from "../../lib/safeMode";
import { safetyMsg } from "../../locales/safety";
import { Badge, Button, Panel, Spinner, Toggle } from "../ui";

export function SafeModePanel() {
  const t = useT(safetyMsg);
  const status = useSafeMode((s) => s.status);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const previewId = useId();
  const words = useMemo(() => ({ yes: t("yes"), no: t("no"), none: t("none"), empty: t("empty"), min: t("min"), tokens: t("tokens") }), [t]);

  useEffect(() => { wireSafeMode(); void useSafeMode.getState().load(); }, []);
  // kabuk rozetinden gelince (#guvenli-mod) panel görünür olsun
  const ready = status !== null;
  useEffect(() => {
    if (ready && window.location.hash === "#guvenli-mod") document.getElementById("guvenli-mod")?.scrollIntoView({ block: "start" });
  }, [ready]);

  const run = async (fn: () => Promise<SafeModeStatus>, after?: (s: SafeModeStatus) => void) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const s = await fn();
      useSafeMode.getState().set(s);
      after?.(s);
    } catch (e) {
      setError(t("error", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <Panel title={t("title")} icon={<ShieldCheck size={16} />}><Spinner /></Panel>;

  const changes = status.items.filter((i) => i.changed);
  const label = (i: SafeItem) => t(`item_${i.id}` as "item_models_local_only");
  const since = status.since ? new Date(status.since).toLocaleString() : "";

  const onToggle = (v: boolean) => {
    if (v) { setResult(null); setPreviewing(true); return; }
    void run(() => safeModeApi.disable(), (s) => {
      const parts = [t("restored", { n: s.restored?.length ?? 0 })];
      if (s.kept?.length) parts.push(t("kept", { n: s.kept.length }));
      setResult(parts.join(" "));
    });
  };

  return (
    <div id="guvenli-mod" className="scroll-mt-4">
      <Panel title={t("title")} icon={<ShieldCheck size={16} />}
        actions={status.enabled ? <Badge tone="ok">{t("badge")}</Badge> : undefined}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-2 max-w-prose">{t("intro")}</p>
          <Toggle checked={status.enabled || previewing} onChange={(v) => { if (!busy) onToggle(v); }} label={t("toggle")}
            hint={status.enabled ? `${t("on_since", { since })}${status.source === "age" ? ` ${t("on_by_age")}` : ""}` : undefined} />

          {!status.enabled && previewing && (
            <section aria-labelledby={previewId} className="panel-soft p-3 flex flex-col gap-3">
              <h3 id={previewId} className="text-sm font-semibold">
                {t("preview_title")} · <span className="num">{changes.length ? t("preview_count", { n: changes.length }) : t("preview_none")}</span>
              </h3>
              {changes.length > 0 && (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {changes.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-line-soft pt-1.5 min-w-0">
                      <span className="font-semibold min-w-0 flex-1 basis-[14rem]">{label(i)}</span>
                      <span className="text-muted break-all">
                        <span className="sr-only">{t("col_now")}: </span>{fmtValue(i.current, words)}
                        <span aria-hidden> {t("arrow")} </span>
                        <span className="sr-only">, {t("col_safe")}: </span>
                        <span className="text-ink font-semibold">{fmtValue(i.safe, words)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setPreviewing(false)}>{t("cancel")}</Button>
                <Button variant="primary" disabled={busy} icon={busy ? <Spinner size={13} /> : <ShieldCheck size={15} />}
                  onClick={() => { void run(() => safeModeApi.enable(), () => setPreviewing(false)); }}>
                  {changes.length ? t("enable_confirm", { n: changes.length }) : t("enable")}
                </Button>
              </div>
            </section>
          )}

          {status.enabled && <p className="text-xs text-muted">{t("disable_hint")}</p>}
          {status.enabled && (
            <section aria-label={t("current_title")} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t("current_title")}</h3>
              <ul className="flex flex-col gap-2">
                {status.items.map((i) => (
                  <li key={i.id} className="border-t border-line-soft pt-2 min-w-0">
                    {i.kind === "bool" ? (
                      <Toggle checked={i.current === true} label={label(i)} hint={t("edit_here")}
                        onChange={(v) => { if (!busy) void run(() => safeModeApi.setItem(i.id, v)); }} />
                    ) : (
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                        <span className="font-semibold min-w-0 flex-1 basis-[14rem]">{label(i)}</span>
                        <span className={i.changed ? "text-warn font-semibold break-all" : "text-ink-2 break-all"}>
                          {fmtValue(i.current, words)}
                        </span>
                        <span className="text-xs text-muted basis-full">{t("edit_elsewhere")}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result && <p role="status" className="text-sm text-ok">{result}</p>}
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}

          <section aria-label={t("notes_title")} className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">{t("notes_title")}</h3>
            <ul className="flex flex-col gap-1.5 text-xs text-ink-2">
              {status.notes.map((n) => (
                <li key={n} className="flex items-start gap-1.5">
                  <Info size={13} className="shrink-0 mt-0.5" aria-hidden />{t(`note_${n}` as "note_not_a_lock")}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </Panel>
    </div>
  );
}
