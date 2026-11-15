// bozuk secrets.json "anahtar yok" gibi görünmesin — kalıcı uyarı + kopyalanabilir kurtarma adımları.
// Otomatik silme yok: yalnız yol ve adımlar gösterilir.
import { AlertTriangle } from "lucide-react";
import { secretsCorruptPath, useConnectionStates } from "../../lib/connections";
import { useT } from "../../lib/i18n";
import { cx } from "../../locales/connections";
import { CopyBlock } from "../connect/CopyBlock";

export function SecretsCorruptBanner() {
  const t = useT(cx);
  const path = secretsCorruptPath(useConnectionStates());
  if (path === null) return null;
  const steps = (["sc_s1", "sc_s2", "sc_s3", "sc_s4"] as const).map((k) => t(k));
  return (
    <section role="alert" aria-labelledby="sc-title" data-secrets-corrupt="" className="panel tone-warn p-3 sm:p-4 flex flex-col gap-2 min-w-0">
      <h2 id="sc-title" className="font-display text-base font-semibold flex items-center gap-2">
        <AlertTriangle size={18} aria-hidden="true" className="shrink-0" />{t("sc_title")}
      </h2>
      <p className="text-sm">{t("sc_text")}</p>
      <ol aria-label={t("sc_steps_label")} className="list-decimal pl-5 text-sm flex flex-col gap-1">
        {steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      {path && <CopyBlock label={t("sc_path")} text={path} />}
    </section>
  );
}
