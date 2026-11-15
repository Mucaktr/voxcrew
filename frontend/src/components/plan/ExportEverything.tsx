// "Her şeyi dışa aktar" — plan sayfasında ve ayarlarda (Bağlantılar → Ayarlar) aynı panel.
// İndirmeden önce neyin gireceği (sayılar) ve neyin girmeyeceği gösterilir; indirme yalnız okur, hiçbir şey silinmez.
import { Archive } from "lucide-react";
import { useEffect, useState } from "react";
import { bytes } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { portabilityApi, type ExportReason, type PortabilityManifest } from "../../lib/portability";
import { portabilityMsg } from "../../locales/portability";
import { Button, Panel, Spinner } from "../ui";

export function ExportEverything({ reason = "manual" }: { reason?: ExportReason }) {
  const t = useT(portabilityMsg);
  const [man, setMan] = useState<PortabilityManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    portabilityApi.manifest().then((m) => { if (live) setMan(m); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const download = async () => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const size = await portabilityApi.download(reason);
      setNote(t("done", { size: bytes(size) }));
    } catch (e) {
      setError(t("error", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const c = man?.counts ?? {};
  const parts = man ? [
    t("sec_agents", { n: c.agents ?? 0 }), t("sec_workflows", { n: c.workflows ?? 0 }),
    t("sec_recipes", { n: c.recipes ?? 0 }), t("sec_deliverables", { n: c.deliverables ?? 0 }),
    t("sec_memory", { n: c.memory ?? 0 }), t("sec_runs", { n: c.runs ?? 0 }), t("sec_worlds", { n: c.worlds ?? 0 }),
    t("sec_ledgers"),
  ] : [];

  return (
    <Panel title={t("title")} icon={<Archive size={16} />}>
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-ink-2">{t("intro")}</p>
        {man ? <p>{t("includes", { list: parts.join(", ") })}</p> : <Spinner />}
        <p className="text-xs text-muted">{t("excluded")}</p>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <Button variant="primary" icon={busy ? <Spinner size={14} /> : <Archive size={15} />} disabled={busy}
            aria-busy={busy} onClick={() => void download()}>
            {busy ? t("downloading") : t("download")}
          </Button>
          <span role="status" aria-live="polite" className="text-xs text-ink-2 min-w-0 break-words">{note}</span>
        </div>
        {error && <p role="alert" className="text-xs text-bad break-words">{error}</p>}
      </div>
    </Panel>
  );
}
