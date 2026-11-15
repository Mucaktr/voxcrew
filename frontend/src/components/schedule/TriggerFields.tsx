// CG2 — olay tetikleyicisi alanları: klasör (durulma süresi), e-posta etiketi ve toplantı bitişi (kullanıcının MCP
// sunucusu; yalnız okuma aracı), ve tetikleyici verisinin gideceği girdi seçimi. ScheduleDialog içinde kullanılır.
import { CalendarSearch, Info, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fmtDate, useT } from "../../lib/i18n";
import { scheduleApi, type CalendarEvent, type ScheduleKind, type TriggerSources } from "../../lib/schedule";
import { triggersMsg as m } from "../../locales/triggers";
import { Button, Field, Segmented } from "../ui";

export interface TriggerDraft {
  debounce: number;
  server: string;
  label: string;
  everyMin: number;
  match: "keyword" | "event";
  keyword: string;
  eventId: string;
  eventTitle: string;
}

export const EMPTY_TRIGGER: TriggerDraft = {
  debounce: 5, server: "", label: "", everyMin: 5, match: "keyword", keyword: "", eventId: "", eventTitle: "",
};

/** Klasör izleyicisinin ek alanları (yol ve desen ScheduleDialog'da). */
export function FolderExtra({ value, onChange }: { value: TriggerDraft; onChange: (p: Partial<TriggerDraft>) => void }) {
  const t = useT(m);
  return (
    <div className="flex flex-col gap-2">
      <Field label={t("debounce")} hint={t("debounce_hint")} className="basis-40">
        <input type="number" min={0} max={3600} className="input !w-28" value={value.debounce} aria-label={t("debounce")}
          onChange={(e) => onChange({ debounce: Math.max(0, Number(e.target.value) || 0) })} />
      </Field>
      <p className="text-xs text-ink-2 flex items-start gap-1.5"><Info size={14} className="shrink-0 mt-0.5" aria-hidden />{t("per_file_note")}</p>
    </div>
  );
}

/** E-posta etiketi / toplantı bitişi: MCP sunucusu, etiket ya da toplantı, denetim aralığı. */
export function McpTriggerFields({ kind, value, onChange }: {
  kind: ScheduleKind; value: TriggerDraft; onChange: (p: Partial<TriggerDraft>) => void;
}) {
  const t = useT(m);
  const [sources, setSources] = useState<TriggerSources | null>(null);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const service = kind === "email_label" ? "email" : "calendar";

  useEffect(() => {
    let alive = true;
    scheduleApi.sources().then((s) => { if (alive) setSources(s); }).catch(() => { if (alive) setSources({ sources: [], folder_debounce_s: 5, mcp_every_s: { min: 120, default: 300 } }); });
    return () => { alive = false; };
  }, []);

  const list = (sources?.sources ?? []).filter((s) => s.service === service);
  const chosen = list.find((s) => s.id === value.server);
  const loadEvents = async () => {
    if (!value.server) return;
    setBusy(true);
    setError(null);
    try {
      const res = await scheduleApi.events(value.server);
      setEvents(res.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-soft p-3 flex flex-col gap-3">
      {sources && list.length === 0 ? (
        <p className="text-sm text-ink-2" role="status">
          {t(service === "email" ? "no_sources_email" : "no_sources_calendar")}{" "}
          <Link to="/baglantilar#mcp-katalog" className="text-link">{t("open_catalog")}</Link>
        </p>
      ) : (
        <Field label={t("mcp_server")} hint={chosen?.tool ? t("server_tool", { tool: chosen.tool }) : chosen?.reason ?? undefined}>
          <select className="select" value={value.server} aria-label={t("mcp_server")}
            onChange={(e) => { onChange({ server: e.target.value, eventId: "", eventTitle: "" }); setEvents(null); }}>
            <option value="">{t("pick_server")}</option>
            {list.map((s) => <option key={s.id} value={s.id}>{s.name}{s.ready ? "" : " ⚠"}</option>)}
          </select>
        </Field>
      )}
      {kind === "email_label" ? (
        <Field label={t("label")} hint={t("label_hint")}>
          <input className="input" value={value.label} maxLength={120} aria-label={t("label")} placeholder="Faturalar"
            onChange={(e) => onChange({ label: e.target.value })} />
        </Field>
      ) : (
        <>
          <Field label={t("match")}>
            <Segmented value={value.match} onChange={(v) => onChange({ match: v })} className="flex-wrap"
              options={[{ value: "keyword", label: t("match_keyword") }, { value: "event", label: t("match_event") }]} />
          </Field>
          {value.match === "keyword" ? (
            <Field label={t("keyword")} hint={t("keyword_hint")}>
              <input className="input" value={value.keyword} maxLength={80} aria-label={t("keyword")}
                onChange={(e) => onChange({ keyword: e.target.value })} />
            </Field>
          ) : (
            <div className="flex flex-col gap-2">
              <div>
                <Button size="sm" icon={<CalendarSearch size={14} />} disabled={!value.server || busy} onClick={loadEvents}>
                  {busy ? t("loading_events") : t("load_events")}
                </Button>
              </div>
              {error && <p className="text-sm text-bad" role="alert">{t("events_error", { error })}</p>}
              {events && events.length === 0 && <p className="text-sm text-muted">{t("no_events")}</p>}
              {(events?.length || value.eventId) ? (
                <Field label={t("match_event")}>
                  <select className="select" value={value.eventId} aria-label={t("match_event")}
                    onChange={(e) => {
                      const ev = events?.find((x) => x.id === e.target.value);
                      onChange({ eventId: e.target.value, eventTitle: ev?.title ?? "" });
                    }}>
                    <option value="">{t("pick_event")}</option>
                    {value.eventId && !events?.some((x) => x.id === value.eventId) && (
                      <option value={value.eventId}>{value.eventTitle || value.eventId}</option>
                    )}
                    {events?.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.title} · {fmtDate(ev.end, { dateStyle: "short", timeStyle: "short" })}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
            </div>
          )}
        </>
      )}
      <Field label={t("check_every")} hint={t("check_every_hint")} className="basis-40">
        <input type="number" min={2} max={1440} className="input !w-28" value={value.everyMin} aria-label={t("check_every")}
          onChange={(e) => onChange({ everyMin: Math.max(2, Number(e.target.value) || 2) })} />
      </Field>
      <p className="text-xs text-ink-2 flex items-start gap-1.5">
        <ShieldCheck size={14} className="shrink-0 mt-0.5" aria-hidden />{t("read_only_note")}
      </p>
    </div>
  );
}

/** Tetikleyici verisinin gideceği girdi (iş akışı / tarif hedefi; olay türlerinde). */
export function TriggerInputSelect({ names, value, onChange }: {
  names: { name: string; label: string }[]; value: string; onChange: (v: string) => void;
}) {
  const t = useT(m);
  if (!names.length) return null;
  return (
    <Field label={t("trigger_input")} hint={t("trigger_input_hint")}>
      <select className="select" value={value} aria-label={t("trigger_input")} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("trigger_input_auto")}</option>
        {names.map((n) => <option key={n.name} value={n.name}>{n.label || n.name}</option>)}
      </select>
    </Field>
  );
}

/** Taslak doğrulaması: eksik alan iletisi ya da null. */
export function triggerMissing(kind: ScheduleKind, v: TriggerDraft, t: (k: keyof typeof m.tr) => string): string | null {
  if (kind !== "email_label" && kind !== "meeting_end") return null;
  if (!v.server) return t("err_server");
  if (kind === "email_label" && !v.label.trim()) return t("err_label");
  if (kind === "meeting_end" && v.match === "keyword" && v.keyword.trim().length < 2) return t("err_keyword");
  if (kind === "meeting_end" && v.match === "event" && !v.eventId) return t("err_event");
  return null;
}
