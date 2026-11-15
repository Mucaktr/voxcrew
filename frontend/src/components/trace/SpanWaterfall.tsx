// fazb3 / Faz B §2 — kayıtlı OTel biçimli span'lerin küçük zaman çizelgesi (içeriksiz) ve yerel OTLP-JSON indirme.
// Ayrıntılı iz yukarıdaki TraceView'da; burası yalnız saklanan biçimi gösterir (ad, süre, durum, token/model özeti).
import clsx from "clsx";
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { duration } from "../../lib/format";
import { fmtNumber, useT } from "../../lib/i18n";
import { fetchSpans, spansDownloadUrl, traceId, type RunSpans } from "../../lib/trace";
import { traceMsg as m } from "../../locales/trace";
import { Button } from "../ui";

const MAX_ROWS = 200;
const KIND_BAR: Record<string, string> = { span: "bg-ink-2", agent: "bg-sky", tool: "bg-gold", retriever: "bg-diamond", guardrail: "bg-amethyst" };

export function SpanWaterfall({ runId, live }: { runId: string; live: boolean }) {
  const t = useT(m);
  const [data, setData] = useState<RunSpans | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    fetchSpans(runId).then((d) => { if (alive) setData(d); }).catch(() => { /* iz sekmesi hatayı zaten gösterir */ });
    return () => { alive = false; };
  }, [runId, live]);
  const rows = useMemo(() => {
    if (!data?.spans.length) return [];
    const depth = new Map<string, number>();
    for (const s of data.spans) depth.set(s.span_id, s.parent_span_id ? (depth.get(s.parent_span_id) ?? 0) + 1 : 0);
    const t0 = Math.min(...data.spans.map((s) => s.start_ns));
    const total = Math.max(1, Math.max(...data.spans.map((s) => s.end_ns)) - t0);
    return data.spans.slice(0, MAX_ROWS).map((s) => ({
      s, depth: depth.get(s.span_id) ?? 0, ms: (s.end_ns - s.start_ns) / 1e6,
      left: ((s.start_ns - t0) / total) * 100, width: ((s.end_ns - s.start_ns) / total) * 100,
    }));
  }, [data]);
  if (!data) return null;
  const download = () => {
    const a = document.createElement("a");
    a.href = spansDownloadUrl(runId);
    a.download = `spans-${runId}.otlp.json`;
    a.click();
  };
  return (
    <section className="flex flex-col gap-1.5 panel-soft p-3" aria-label={t("sp_title")}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-display text-sm font-semibold">{t("sp_title")}</h4>
        <span className="text-xs text-muted num">{fmtNumber(data.spans.length)}</span>
        <Button size="sm" variant="ghost" className="ml-auto" icon={<Download size={14} />} title={t("sp_download_title")}
          onClick={download} disabled={!data.spans.length}>{t("sp_download")}</Button>
      </div>
      <p className="text-xs text-muted">{t("sp_hint")}</p>
      {data.source === "live" && <p className="text-xs text-warn" role="status">{t("sp_live")}</p>}
      {!rows.length ? <p className="text-sm text-muted">{t("sp_empty")}</p> : (
        <ol className="flex flex-col gap-0.5" aria-label={t("sp_label")}>
          {rows.map(({ s, depth, ms, left, width }) => {
            const a = s.attributes;
            const tok = typeof a["studio.tokens.total"] === "number" ? `${fmtNumber(a["studio.tokens.total"])} ${t("metric_tokens")}` : "";
            const info = [a["studio.step.id"] ? traceId(String(a["studio.step.id"]), t("id_task")) : "", a["studio.model"], tok].filter(Boolean).join(" · ");
            return (
              <li key={s.span_id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 items-center text-xs min-w-0">
                <span className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: Math.min(depth, 6) * 10 }}>
                  <span className={clsx("truncate font-mono", s.status === "ERROR" && "text-bad")} title={s.name}>{s.name}</span>
                  {info && <span className="text-muted truncate">{info}</span>}
                  <span className="ml-auto text-muted num shrink-0">{duration(ms)}</span>
                </span>
                <span className="relative h-2.5 rounded bg-panel-3 overflow-hidden" aria-hidden>
                  <span className={clsx("absolute top-0 bottom-0 rounded-sm",
                    s.status === "ERROR" ? "bg-red" : KIND_BAR[String(a["studio.span.kind"])] ?? "bg-ink-2")}
                    style={{ left: `${Math.min(100, left)}%`, width: width > 0.4 ? `${Math.min(100 - left, width)}%` : "3px" }} />
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
