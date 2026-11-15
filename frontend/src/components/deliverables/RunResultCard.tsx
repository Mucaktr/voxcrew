// Ekip S50 — koşu sayfasının üstündeki "Sonuç" kartı: bitmiş koşunun teslim ettiği son çıktı (özet) ve dosyaları,
// her biri için Aç (Çıktılar sayfası) ve indirme düğmeleri. Teslim kaydı koşu bitişinde sunucuda oluşur;
// `deliverable.ready` gelince kart kendini tazeler.
import { Download, ExternalLink, Trophy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Markdown } from "../Markdown";
import { Button, Panel } from "../ui";
import { deliverablesApi, downloadDeliverable, onDeliverableEvent, type Deliverable } from "../../lib/deliverables";
import { useT } from "../../lib/i18n";
import { deliverablesMsg as m } from "../../locales/deliverables";
import { fmtSize } from "./DeliverableViewer";
import { KindBadge } from "./parts";
import { QualityBadge } from "../quality/QualityBadge";
import { QualityPanel } from "../quality/QualityPanel";
import { DeliverButton, DeliveryBadge, type DeliveredInfo } from "../delivery/DeliverButton";
import { ZipButton } from "./ZipDialog";

const TEXT_KINDS = ["report", "text", "code", "data"];

export function RunResultCard({ runId, status }: { runId: string; status: string }) {
  const t = useT(m);
  const [items, setItems] = useState<Deliverable[] | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const dl = (id: string, f: Parameters<typeof downloadDeliverable>[1], binary?: boolean) => {
    setDlError(null);
    void downloadDeliverable(id, f, { binary }).then(setDlError);
  };

  const load = useCallback(() => {
    deliverablesApi.list({ run: runId, limit: 50 }).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [runId]);

  useEffect(() => { if (status === "done") load(); else setItems(null); }, [status, load]);
  useEffect(() => onDeliverableEvent((ev) => { if (ev.run_id === runId && status === "done") load(); }), [runId, status, load]);

  if (status !== "done" || !items) return null;
  const output = items.find((d) => d.source === "output");
  const files = items.filter((d) => d.source === "file");
  const open = (d: Deliverable) => `/ciktilar/${encodeURIComponent(d.id)}`;

  return (
    <Panel title={<span className="flex items-center gap-2"><Trophy size={16} aria-hidden className="text-ok" />{t("result_title")}</span>}
      actions={items.length > 0 && <>
        {items.some((d) => d.source !== "output" || items.length > 1) && <ZipButton target={{ runId }} />}
        <Link to={`/ciktilar?run=${encodeURIComponent(runId)}`} className="text-xs font-semibold underline">{t("result_all")}</Link>
      </>}>
      <div className="flex flex-col gap-3 min-w-0" aria-label={t("result_subtitle")}>
        {!items.length && <p className="text-sm text-muted">{t("result_none")}</p>}
        {dlError && <p role="alert" className="text-sm text-bad break-words">{dlError}</p>}
        {output && (
          <div className="panel-soft p-3 flex flex-col gap-2 min-w-0 border-2 !border-ok">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <KindBadge kind={output.kind} />
              <span className="font-semibold text-sm min-w-0 break-words flex-1">{output.title}</span>
              <DeliveryBadge id={output.id} initial={(output as Deliverable & { delivery?: DeliveredInfo }).delivery} />
            </div>
            {output.summary && <div className="text-sm max-h-48 overflow-hidden break-words"><Markdown text={output.summary} /></div>}
            <QualityPanel deliverableId={output.id} compact />
            <div className="flex flex-wrap gap-2">
              <Link to={open(output)} className="btn btn-sm btn-primary"><ExternalLink size={14} aria-hidden />{t("result_open")}</Link>
              {(["md", "txt", "docx"] as const).map((f) => (
                <Button key={f} size="sm" icon={<Download size={14} />} aria-label={t("download_label", { fmt: f === "docx" ? t("word") : `.${f}` })}
                  onClick={() => dl(output.id, f)}>{f === "docx" ? t("word") : `.${f}`}</Button>
              ))}
              <DeliverButton item={output} />
            </div>
          </div>
        )}
        {!!files.length && (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">{t("result_files")}</span>
            <ul className="flex flex-col gap-1.5">
              {files.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 min-w-0">
                  <KindBadge kind={d.kind} />
                  <Link to={open(d)} className="text-sm font-semibold underline break-all min-w-0">{d.name}</Link>
                  <QualityBadge quality={d.quality} />
                  {d.size ? <span className="text-xs text-muted num">{fmtSize(d.size)}</span> : null}
                  {(TEXT_KINDS.includes(d.kind) || d.kind === "image" || d.binary) && (
                    <Button size="sm" variant="ghost" icon={<Download size={14} />} className="ml-auto"
                      aria-label={t("download_label", { fmt: d.name })} onClick={() => dl(d.id, "original", d.binary)} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
