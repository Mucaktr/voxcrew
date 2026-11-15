// Ekip S25 — webhook jetonu: yalnızca oluşturma/yenileme yanıtında bir kez gösterilir; kopyala + örnek curl.
import { Check, Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { useT } from "../../lib/i18n";
import { curlExample } from "../../lib/schedule";
import { scheduleMsg as m } from "../../locales/schedule";
import { Button } from "../ui";

function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useT(m);
  const [ok, setOk] = useState(false);
  return (
    <Button size="sm" variant="ghost" icon={ok ? <Check size={14} /> : <Copy size={14} />} aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })
          .catch(() => undefined);
      }}>
      {ok ? t("copied") : t("copy")}
    </Button>
  );
}

export function TokenReveal({ id, token }: { id: string; token?: string }) {
  const t = useT(m);
  const curl = curlExample(id, token);
  return (
    <div className="flex flex-col gap-3">
      {token ? (
        <div className="panel-soft p-3 flex flex-col gap-2" role="status">
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <KeyRound size={15} aria-hidden="true" />{t("token_once_title")}
          </p>
          <p className="text-xs text-ink-2">{t("token_once_text")}</p>
          <div className="flex items-center gap-2 min-w-0">
            <code className="input font-mono !text-xs flex-1 min-w-0 truncate select-all" aria-label={t("token")}>{token}</code>
            <CopyButton text={token} label={t("copy_token")} />
          </div>
        </div>
      ) : (
        <p className="text-xs text-ink-2">{t("token_hidden")}</p>
      )}
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="label">{t("curl_example")}</span>
          <CopyButton text={curl} label={t("copy_curl")} />
        </div>
        <pre className="input font-mono !text-xs whitespace-pre-wrap break-all">{curl}</pre>
        <p className="text-xs text-muted">{t("webhook_rules")}</p>
      </div>
    </div>
  );
}
