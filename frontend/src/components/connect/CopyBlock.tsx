// Ekip S11 — kopyalanabilir komut / yapılandırma bloğu.
import clsx from "clsx";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../../lib/i18n";
import { connect as m } from "../../locales/connect";
import { Button } from "../ui";

/** Tek satırlık komutlar dar ekranda kaydırılmadan sarılır; çok satırlı bloklar (TOML/JSON) kendi kutusunda
 *  yatay kayar (sayfa taşmaz) ve klavyeyle odaklanıp kaydırılabilir. */
export function CopyBlock({ text, label, multiline = false, mono = true, className }:
  { text: string; label: string; multiline?: boolean; mono?: boolean; className?: string }) {
  const t = useT(m);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 1800);
  };
  return (
    <div className={clsx("panel-soft flex items-start gap-1.5 p-1.5 pl-3 min-w-0", className)}>
      <pre tabIndex={multiline ? 0 : undefined} aria-label={multiline ? label : undefined}
        className={clsx("leading-5 flex-1 min-w-0 py-1 m-0", mono ? "font-mono text-xs" : "font-sans text-sm",
          multiline ? "overflow-x-auto whitespace-pre max-h-80 overflow-y-auto"
            : mono ? "whitespace-pre-wrap break-all" : "whitespace-pre-wrap break-words")}>
        <code>{text}</code>
      </pre>
      <Button size="sm" variant="ghost" onClick={copy} title={t("copy")} aria-label={t("copy_aria", { label })}
        icon={copied === "ok" ? <Check size={15} className="text-ok" /> : <Copy size={15} />} />
      <span className="sr-only" aria-live="polite">
        {copied === "ok" ? t("copied") : copied === "fail" ? t("copy_failed") : ""}
      </span>
    </div>
  );
}
