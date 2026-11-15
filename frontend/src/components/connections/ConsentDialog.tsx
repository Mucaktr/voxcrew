// S37 — çevrimiçi model için bir kerelik onay ("veriler bu bilgisayardan <sağlayıcı>'ya çıkar"). Onay sunucuda
// `models.consent` ayarına yazılır (yalnızca arayüzden; MCP değiştiremez) ve rota denetimi onu arar.
import { Cloud } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { policyApi, useModelPolicy, type BrainDecision } from "../../lib/modelPolicy";
import { useStudio } from "../../lib/store";
import { cx } from "../../locales/connections";
import { Button, Modal, Spinner } from "../ui";

export function useConsent(): { ensure: (d: BrainDecision) => Promise<boolean>; dialog: ReactNode } {
  const t = useT(cx);
  const setView = useModelPolicy((s) => s.set);
  const [pending, setPending] = useState<{ d: BrainDecision; resolve: (ok: boolean) => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ensure = useCallback((d: BrainDecision) => {
    if (!d.needsConsent || !d.consentKey) return Promise.resolve(d.allowed);
    return new Promise<boolean>((resolve) => { setError(null); setPending({ d, resolve }); });
  }, []);

  const close = (ok: boolean) => { pending?.resolve(ok); setPending(null); };
  const accept = async () => {
    if (!pending?.d.consentKey) return;
    setBusy(true); setError(null);
    try {
      setView(await policyApi.consent(pending.d.consentKey));
      await api.agents().then((agents) => useStudio.setState({ agents })).catch(() => undefined);  // rota hataları tazelensin
      close(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const dialog = pending ? (
    <Modal open onClose={() => close(false)} title={t("consent_title")} width={480}
      footer={<><Button variant="ghost" onClick={() => close(false)}>{t("cancel")}</Button>
        <Button variant="primary" icon={busy ? <Spinner size={14} /> : <Cloud size={14} />} disabled={busy} onClick={accept}>{t("consent_yes")}</Button></>}>
      <p className="text-sm text-ink-2">{t("consent_body", { provider: pending.d.provider, host: pending.d.host || pending.d.provider })}</p>
      {error && <p role="alert" className="text-sm text-bad mt-2">{error}</p>}
    </Modal>
  ) : null;
  return { ensure, dialog };
}
