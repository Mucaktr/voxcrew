// Ekip S50 — tek çıktının okunabilir belge görünümü: Markdown işlenmiş, kod renkli, görsel; sabitle / okundu, kaynak
// koşuyu aç, klasör yolunu kopyala, panoya kopyala, .md / .txt / Word indir ve temiz baskı stiliyle PDF (yazdır).
// Açılınca okunmamışsa okundu işaretlenir. Metin sunucuda maskelidir (redact_text).
import {
  AlertTriangle, ArrowLeft, Check, Clipboard, Download, ExternalLink, FileText, FolderOpen, FolderSearch, Mail, MailOpen,
  Pin, PinOff, Printer,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Markdown } from "../Markdown";
import { Badge, Button, Empty, Panel, Segmented, Spinner } from "../ui";
import { timeAgo } from "../../lib/format";
import {
  copyText, deliverablesApi, downloadDeliverable, onDeliverableEvent, printDocument,
  type Deliverable, type DeliverableContent, type DeliverableVersion, type ExportFormat,
} from "../../lib/deliverables";
import { viewerFor } from "../../lib/deliveryViewers";  // DEPO-TESLIM
import { fmtDate, fmtNumber, useT } from "../../lib/i18n";
import { useStudio } from "../../lib/store";
import { deliverablesMsg as m } from "../../locales/deliverables";
import { CodeView } from "./CodeView";
import { AppPreview, RevealDialog, VersionStrip } from "./DeliverableExtras";
import { EstimateVsActual } from "../../full/ui";
import { KindBadge } from "./parts";
import { ZipButton } from "./ZipDialog";
// DEPO-TESLIM: sürüm karşılaştırma ve biçime özel görüntüleyiciler
import { CsvTable, JsonTree } from "./viewers/DataViews";
import { DiffView } from "./viewers/DiffView";
import { MediaView } from "./viewers/MediaView";

export function fmtSize(n?: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${fmtNumber(n)} B`;
  if (n < 1024 * 1024) return `${fmtNumber(Math.round(n / 102.4) / 10)} KB`;
  return `${fmtNumber(Math.round(n / 104857.6) / 10)} MB`;
}

export function DeliverableViewer({ id, onBack, onChanged }:
  { id: string; onBack?: () => void; onChanged?: (item: Deliverable) => void }) {
  const t = useT(m);
  const pdfHintId = useId();
  const agents = useStudio((s) => s.agents);
  const [data, setData] = useState<{ item: Deliverable; content: DeliverableContent; abs_path?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);  // indirme hatası (ör. değerlendirme sürüyor)
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);  // D3: "Klasörde göster" onay penceresi
  const [compare, setCompare] = useState<DeliverableVersion[] | null>(null);  // DEPO-TESLIM: sürüm karşılaştırma açık mı (sürüm listesi)
  const [asText, setAsText] = useState(false);  // DEPO-TESLIM: tablo / ağaç yerine ham metin
  const doc = useRef<HTMLDivElement>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const apply = useCallback((item: Deliverable) => {
    setData((d) => (d ? { ...d, item } : d));
    changed.current?.(item);
  }, []);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null); setNote(null); setCompare(null); setAsText(false);
    deliverablesApi.get(id).then((d) => {
      if (!alive) return;
      setData(d);
      if (d.item.unread) {
        deliverablesApi.update(id, { read: true }).then((r) => { if (alive) apply(r.item); }).catch(() => undefined);
      }
    }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [id, apply]);

  // aynı çıktı yeniden teslim edildiyse (koşu devam/yeniden bitiş) içeriği tazele
  useEffect(() => onDeliverableEvent((ev) => {
    if (ev.type === "deliverable.ready" && Array.isArray(ev.items) && ev.items.some((x) => (x as { id?: string }).id === id)) {
      deliverablesApi.get(id).then(setData).catch(() => undefined);
    }
  }), [id]);

  useEffect(() => {
    if (!note) return;
    const h = window.setTimeout(() => setNote(null), 4000);
    return () => window.clearTimeout(h);
  }, [note]);

  if (error) return <Panel><Empty title={t("not_found")} text={error} action={onBack && <Button onClick={onBack}>{t("back")}</Button>} /></Panel>;
  if (!data) return <Panel><div className="grid place-items-center py-10"><Spinner size={22} /></div></Panel>;

  const { item, content } = data;
  const agent = agents.find((a) => a.slug === item.agent);
  const text = content.text ?? "";
  const isText = content.kind === "markdown" || content.kind === "text" || content.kind === "code";

  const patch = async (p: { pinned?: boolean; read?: boolean }) => {
    setBusy(true);
    try { apply((await deliverablesApi.update(item.id, p)).item); }
    catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const copy = async () => setNote((await copyText(text)) ? t("copied") : t("copy_failed"));
  const copyPath = async () => {
    const path = data.abs_path ?? item.path ?? "";
    setNote((await copyText(path)) ? t("path_copied", { path }) : t("copy_failed"));
  };
  const print = () => {
    const meta = [agent?.name ?? item.agent, fmtDate(item.created_at, { dateStyle: "medium", timeStyle: "short" }),
      item.run_title].filter(Boolean).join(" · ");
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    printDocument(item.title, `<h1 class="doc-title">${esc(item.title)}</h1><div class="meta">${esc(meta)}</div>${doc.current?.innerHTML ?? ""}`);
  };
  const formats: { fmt: ExportFormat; label: string }[] = item.source === "output" || content.kind === "markdown"
    ? [{ fmt: "md", label: ".md" }, { fmt: "txt", label: ".txt" }, { fmt: "docx", label: t("word") }]
    : isText ? [{ fmt: "original", label: item.name.includes(".") ? `.${item.name.split(".").pop()}` : t("download_original") }, { fmt: "txt", label: ".txt" }]
    : [];
  const viewer = viewerFor(item, content);  // DEPO-TESLIM
  const plainBody = content.kind === "markdown" ? <Markdown text={text} /> :
    content.kind === "code" ? <CodeView text={text} lang={content.lang} /> :
    content.kind === "text" ? <pre className="font-mono text-xs whitespace-pre-wrap break-words panel-soft p-3">{text}</pre> :
    content.kind === "image" ? <img src={deliverablesApi.rawUrl(item.id)} alt={item.title} className="max-w-full h-auto rounded-lg border-2 border-line" /> :
    content.kind === "app" ? <AppPreview id={item.id} title={item.title} content={content} /> :
    content.kind === "missing" ? <Empty icon={<FileText size={26} />} title={t("missing")} /> :
    <Empty icon={<FileText size={26} />} title={t("binary")} text={item.binary ? t("binary_hint") : undefined} />;
  const hasFile = item.source !== "output";  // dosya ya da uygulama paketi (klasörde gösterilebilir)
  const vaultNote = item.vault_status === "too_large" ? t("vault_too_large")
    : item.vault_status === "quota" ? t("vault_quota") : item.vault_status === "missing" ? t("vault_missing")
      : item.vault_status === "forgotten" ? t("vault_forgotten") : null;

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <Panel title={<span className="break-words">{item.title}</span>}
        actions={onBack && <Button size="sm" variant="ghost" icon={<ArrowLeft size={15} />} onClick={onBack} aria-label={t("back")} />}>
        <div className="flex flex-col gap-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <KindBadge kind={item.kind} />
            <Badge>{item.source === "output" ? t("source_output") : item.source === "bundle" ? t("source_bundle") : t("source_file")}</Badge>
            {(item.version ?? 1) > 1 && <Badge tone="info">{t("version_n", { n: item.version ?? 1 })}</Badge>}
            {item.pinned && <Badge tone="warn"><Pin size={12} aria-hidden />{t("pinned")}</Badge>}
            {item.backfilled && <Badge>{t("backfilled")}</Badge>}
            <span className="text-xs text-muted num">
              {t("by_agent", { agent: agent?.name ?? item.agent ?? "—", when: timeAgo(item.created_at) })}
              {item.size ? ` · ${fmtSize(item.size)}` : ""}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Link to={`/gorevler/${encodeURIComponent(item.run_id)}`} className="chip hover:border-ink-2 !whitespace-normal">
              <ExternalLink size={12} aria-hidden />{t("open_run")}{item.run_title ? `: ${item.run_title}` : ""}
            </Link>
            {item.source === "file" && (
              <button type="button" className="chip hover:border-ink-2 !whitespace-normal break-all" onClick={() => { void copyPath(); }}
                title={data.abs_path ?? item.path ?? ""}>
                <FolderOpen size={12} aria-hidden />{t("copy_path")}
              </button>
            )}
          </div>
          <VersionStrip id={item.id} version={item.version} onCompare={setCompare} />
          {vaultNote && <p role="status" className="text-xs text-warn flex items-start gap-1 break-words"><AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />{vaultNote}</p>}
          {item.source === "output" && <EstimateVsActual runId={item.run_id} />}
          {dlError && <p role="alert" className="text-sm text-bad break-words">{dlError}</p>}
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("download")}>
            {formats.map((f) => (
              <Button key={f.fmt} size="sm" icon={<Download size={14} />} aria-label={t("download_label", { fmt: f.label })}
                onClick={() => { setDlError(null); void downloadDeliverable(item.id, f.fmt).then(setDlError); }}>{f.label}</Button>
            ))}
            {item.binary && (
              <Button size="sm" icon={<Download size={14} />} aria-label={t("download_unmasked_label")} title={t("unmasked_hint")}
                onClick={() => { setDlError(null); void downloadDeliverable(item.id, "original", { binary: true }).then(setDlError); }}>
                {t("download_unmasked")}
              </Button>
            )}
            {item.source === "bundle" && <ZipButton target={{ id: item.id }} />}
            {hasFile && <Button size="sm" icon={<FolderSearch size={14} />} onClick={() => setRevealOpen(true)}>{t("reveal")}</Button>}
            {(isText || content.kind === "image") && (
              // ad "PDF (yazdır)", ipucu açıklama (`aria-describedby`); `title` yalnız fare ipucu
              <>
                <Button size="sm" icon={<Printer size={14} />} onClick={print} title={t("print_pdf_hint")} aria-label={t("print_pdf")}
                  aria-describedby={pdfHintId}>{t("print_pdf")}</Button>
                <span id={pdfHintId} className="sr-only">{t("print_pdf_hint")}</span>
              </>
            )}
            {isText && <Button size="sm" icon={<Clipboard size={14} />} onClick={() => { void copy(); }}>{t("copy")}</Button>}
            <span className="flex gap-2 ml-auto">
              <Button size="sm" variant="ghost" disabled={busy} icon={item.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                aria-pressed={item.pinned} onClick={() => { void patch({ pinned: !item.pinned }); }}>{item.pinned ? t("unpin") : t("pin")}</Button>
              <Button size="sm" variant="ghost" disabled={busy} icon={item.unread ? <MailOpen size={14} /> : <Mail size={14} />}
                onClick={() => { void patch({ read: item.unread }); }}>{item.unread ? t("mark_read") : t("mark_unread")}</Button>
            </span>
          </div>
          {note && <p role="status" className="text-xs font-semibold text-ok flex items-center gap-1 break-all"><Check size={13} aria-hidden />{note}</p>}
        </div>
      </Panel>
      <RevealDialog id={item.id} open={revealOpen} onClose={() => setRevealOpen(false)} />
      {compare ? (
        <Panel title={t("compare_title")}>
          <DiffView id={item.id} title={item.title} versions={compare} onClose={() => setCompare(null)} />
        </Panel>
      ) : (
      <Panel>
        <div className="flex flex-col gap-2 min-w-0">
          {/* DEPO-TESLIM: CSV → tablo, JSON → ağaç (Metin düğmesiyle ham görünüm), PDF/ses/video → MediaView */}
          {(viewer === "csv" || viewer === "json") && (
            <Segmented value={asText ? "text" : "rich"} onChange={(v) => setAsText(v === "text")} className="self-start"
              options={[{ value: "rich", label: viewer === "csv" ? t("view_table") : t("view_tree") }, { value: "text", label: t("view_text") }]} />
          )}
          <div ref={doc} className="min-w-0 break-words">
            {viewer === "csv" && !asText ? <CsvTable name={item.name} text={text} truncated={content.truncated} /> :
              viewer === "json" && !asText ? <JsonTree name={item.name} text={text} truncated={content.truncated} fallback={plainBody} /> :
              (viewer === "pdf" || viewer === "audio" || viewer === "video") ? (
                <MediaView id={item.id} title={item.title} view={viewer} size={item.size} max={content.view_max}
                  sizeLabel={fmtSize(item.size)} maxLabel={fmtSize(content.view_max)} />
              ) : plainBody}
          </div>
          {content.truncated && (asText || (viewer !== "csv" && viewer !== "json")) && <p className="text-xs text-muted">{t("truncated")}</p>}
          {isText && <p className="text-xs text-muted" data-noprint>{t("redacted_note")}</p>}
          {item.binary && <p className="text-xs text-muted" data-noprint>{t("unmasked_note")}</p>}
        </div>
      </Panel>
      )}
    </div>
  );
}
