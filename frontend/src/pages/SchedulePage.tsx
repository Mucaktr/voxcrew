// Faz 6 — Ekip S25: zamanlayıcı ve tetikleyiciler. Yalnızca stüdyo çalışırken tetiklenir.
import { CalendarClock, Info, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ScheduleDetail } from "../components/schedule/ScheduleDetail";
import { ScheduleDialog } from "../components/schedule/ScheduleDialog";
import { ScheduleRow } from "../components/schedule/ScheduleRow";
import { Button, Empty, PageHeader, Spinner, Toggle } from "../components/ui";
import { useT } from "../lib/i18n";
import { scheduleApi, useSchedules, type Schedule } from "../lib/schedule";
import { scheduleMsg as m } from "../locales/schedule";

interface Notice { id: string; text: string; tone: "ok" | "warn" | "bad"; runId?: string }

export default function SchedulePage() {
  const t = useT(m);
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const items = useSchedules((s) => s.items);
  const loaded = useSchedules((s) => s.loaded);
  const loading = useSchedules((s) => s.loading);
  const error = useSchedules((s) => s.error);
  const enabled = useSchedules((s) => s.enabled);
  const refresh = useSchedules((s) => s.refresh);
  const [dialog, setDialog] = useState<{ open: boolean; schedule: Schedule | null }>({ open: false, schedule: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = items.find((s) => s.id === id) ?? null;
  // seçili zamanlamanın son koşuları canlı olay yerine ayrıntı ucundan tazelenir
  useEffect(() => {
    if (!id) return;
    scheduleApi.get(id).then((s) => useSchedules.getState().upsert(s)).catch(() => undefined);
  }, [id]);

  const act = async (s: Schedule, fn: () => Promise<void>) => {
    setBusy(s.id);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({ id: s.id, tone: "bad", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const toggle = (s: Schedule, on: boolean) => act(s, async () => {
    useSchedules.getState().upsert(await scheduleApi.update(s.id, { enabled: on }));
  });
  const [schedBusy, setSchedBusy] = useState(false);
  const toggleScheduler = async (on: boolean) => {
    setSchedBusy(true);
    setNotice(null);
    try {
      await scheduleApi.setSchedulerEnabled(on);
      await refresh();
    } catch (e) {
      setNotice({ id: "", tone: "bad", text: t("scheduler_toggle_error", { error: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setSchedBusy(false);
    }
  };
  const runNow = (s: Schedule) => act(s, async () => {
    const res = await scheduleApi.runNow(s.id);
    if (res.run_id) setNotice({ id: s.id, tone: "ok", text: t("run_started"), runId: res.run_id });
    else if (res.queued) setNotice({ id: s.id, tone: "warn", text: t("run_queued", { n: res.queued }) });
    else if (res.skipped === "running") setNotice({ id: s.id, tone: "warn", text: t("run_skipped_running") });
    else setNotice({ id: s.id, tone: "bad", text: res.error || t("run_failed") });
    scheduleApi.get(s.id).then((x) => useSchedules.getState().upsert(x)).catch(() => undefined);
  });
  const remove = (s: Schedule) => {
    if (!confirm(t("delete_q", { title: s.title }))) return;
    void act(s, async () => {
      await scheduleApi.remove(s.id);
      useSchedules.getState().drop(s.id);
      if (id === s.id) navigate("/zamanlayici");
    });
  };

  return (
    <div className="p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <PageHeader title={t("page_title")} subtitle={t("page_subtitle")}
        actions={(
          <>
            <Button variant="ghost" icon={<RefreshCw size={16} />} disabled={loading} onClick={() => void refresh()}>{t("refresh")}</Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setDialog({ open: true, schedule: null })}>{t("new_schedule")}</Button>
          </>
        )} />

      <p className="panel-soft px-3 py-2 text-sm text-ink-2 flex items-start gap-2">
        <Info size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span>{t("only_while_running_long")}</span>
      </p>
      <div className="panel-soft px-3 py-2" aria-busy={schedBusy}>
        <Toggle checked={enabled} onChange={(v) => { if (!schedBusy) void toggleScheduler(v); }}
          label={t("scheduler_toggle")} hint={t("scheduler_toggle_hint")} />
      </div>
      {!enabled && (
        <p className="panel-soft px-3 py-2 text-sm font-semibold text-warn flex items-start gap-2" role="status">
          <TriangleAlert size={16} className="shrink-0 mt-0.5" aria-hidden="true" />{t("scheduler_disabled")}
        </p>
      )}
      {error && <p className="text-sm font-semibold text-bad" role="alert">{t("load_error", { error })}</p>}
      {notice && (
        <p className={`text-sm font-semibold ${notice.tone === "ok" ? "text-ok" : notice.tone === "warn" ? "text-warn" : "text-bad"}`} role="status">
          {notice.text}
          {notice.runId && (
            <> · <Link className="text-link underline" to={`/gorevler/${encodeURIComponent(notice.runId)}`}>{t("watch_run")}</Link></>
          )}
        </p>
      )}

      {!loaded ? (
        <div className="flex justify-center py-10"><Spinner size={22} /></div>
      ) : items.length === 0 ? (
        <Empty icon={<CalendarClock size={26} />} title={t("empty_title")} text={t("empty_text")}
          action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setDialog({ open: true, schedule: null })}>{t("new_schedule")}</Button>} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
          <ul className="flex flex-col gap-2 min-w-0" aria-label={t("list_label")}>
            {items.map((s) => (
              <ScheduleRow key={s.id} s={s} selected={s.id === id} busy={busy === s.id}
                onSelect={() => navigate(s.id === id ? "/zamanlayici" : `/zamanlayici/${encodeURIComponent(s.id)}`)}
                onToggle={(on) => void toggle(s, on)} onRun={() => void runNow(s)}
                onEdit={() => setDialog({ open: true, schedule: s })} onDelete={() => remove(s)} />
            ))}
          </ul>
          <div className="min-w-0 lg:sticky lg:top-4">
            {selected ? <ScheduleDetail s={selected} /> : (
              <p className="text-sm text-muted panel-soft px-3 py-6 text-center">{id ? t("not_found") : t("pick_one")}</p>
            )}
          </div>
        </div>
      )}

      <ScheduleDialog open={dialog.open} schedule={dialog.schedule}
        onClose={() => setDialog({ open: false, schedule: null })}
        onSaved={(s) => { if (!dialog.schedule) navigate(`/zamanlayici/${encodeURIComponent(s.id)}`); }} />
    </div>
  );
}
