// kadro paneli: etkin ve yedek iki sütun; sürükle-bırak ya da düğmeler (klavye: Tab + Enter).
// Yedekteki ajan silinmez; değişim ücretsizdir. Çalışan koşudaki ajan kilitlidir. Yönetici modunda kadro değişmez.
import { ArrowLeftRight, ArrowDown, ArrowUp, Loader2, Lock, Users } from "lucide-react";
import { useEffect, useId, useState, type DragEvent } from "react";
import { useT } from "../../lib/i18n";
import { decisionOf, planApi, useLimitCard, usePlan, wirePlanEvents, type RosterAgent } from "../../lib/plan";
import { useStudio } from "../../lib/store";
import { plan as m } from "../../locales/plan";
import { PixelFace } from "../PixelFace";
import { Badge, Button, Panel } from "../ui";
import type { Avatar } from "../../lib/types";

export function SeatRoster({ id = "kadro", compact = false }: { id?: string; compact?: boolean }) {
  const t = useT(m);
  const roster = usePlan((s) => s.roster);
  const refresh = usePlan((s) => s.refresh);
  const setRoster = usePlan((s) => s.setRoster);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [swapFor, setSwapFor] = useState<RosterAgent | null>(null);
  const [dragOver, setDragOver] = useState<"active" | "bench" | null>(null);
  const hintId = useId();

  useEffect(() => { wirePlanEvents(); void refresh(); }, [refresh]);

  const act = async (key: string, fn: () => Promise<import("../../lib/plan").Roster>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      setRoster(r);
      setSwapFor(null);
      void useStudio.getState().refreshAgents();
      void refresh();
    } catch (e) {
      const d = decisionOf(e);
      if (d && d.reason === "seat_limit") useLimitCard.getState().notify(d, true);
      setError(d?.message ?? (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  };

  if (!roster) return null;
  const full = roster.limit !== null && roster.used >= roster.limit;
  const activate = (a: RosterAgent) => {
    if (full) { setSwapFor(a); return; }
    void act(a.slug, () => planApi.activate(a.slug));
  };
  const swap = (out: RosterAgent) => {
    if (!swapFor) return;
    void act(swapFor.slug, () => planApi.swap(swapFor.slug, out.slug));
  };
  const onDrop = (zone: "active" | "bench") => (e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const slug = e.dataTransfer.getData("text/plain");
    const a = [...roster.active, ...roster.bench].find((x) => x.slug === slug);
    if (!a || roster.locked) return;
    if (zone === "bench" && roster.active.some((x) => x.slug === slug)) void act(slug, () => planApi.bench(slug));
    if (zone === "active" && roster.bench.some((x) => x.slug === slug)) activate(a);
  };
  const zoneProps = (zone: "active" | "bench") => ({
    onDragOver: (e: DragEvent) => { if (!roster.locked) { e.preventDefault(); setDragOver(zone); } },
    onDragLeave: () => setDragOver(null),
    onDrop: onDrop(zone),
  });

  const row = (a: RosterAgent, where: "active" | "bench") => {
    const pickable = swapFor !== null && where === "active";
    return (
      <li key={a.slug} draggable={!roster.locked && !a.busy}
        onDragStart={(e) => e.dataTransfer.setData("text/plain", a.slug)}
        className="flex items-center gap-2 rounded-lg border border-line-soft bg-panel px-2 py-1.5 min-w-0">
        <PixelFace avatar={a.avatar as Partial<Avatar> | null} size={28} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{a.name}</div>
          {a.title && <div className="text-xs text-muted truncate">{a.title}</div>}
        </div>
        {a.busy && <Badge tone="info" title={t("busy_hint")}><Lock size={11} aria-hidden />{t("busy")}</Badge>}
        {!roster.locked && !pickable && where === "active" && (
          <Button size="sm" variant="ghost" icon={busy === a.slug ? <Loader2 size={14} className="animate-spin" /> : <ArrowDown size={14} />}
            disabled={a.busy || busy !== null} title={a.busy ? t("busy_hint") : t("to_bench")}
            aria-label={`${t("to_bench")}: ${a.name}`} onClick={() => void act(a.slug, () => planApi.bench(a.slug))}>
            <span className="hidden sm:inline">{t("to_bench")}</span>
          </Button>
        )}
        {!roster.locked && where === "bench" && (
          <Button size="sm" icon={busy === a.slug ? <Loader2 size={14} className="animate-spin" /> : full ? <ArrowLeftRight size={14} /> : <ArrowUp size={14} />}
            disabled={busy !== null} aria-label={`${full ? t("swap_with") : t("to_active")}: ${a.name}`}
            onClick={() => activate(a)}>
            <span className="hidden sm:inline">{full ? t("swap_with") : t("to_active")}</span>
          </Button>
        )}
        {pickable && (
          <Button size="sm" variant="primary" disabled={a.busy || busy !== null} title={a.busy ? t("busy_hint") : undefined}
            aria-label={`${t("swap_with")}: ${a.name}`} onClick={() => swap(a)}>
            {t("swap_with")}
          </Button>
        )}
      </li>
    );
  };

  return (
    <Panel title={t("roster_title")} icon={<Users size={16} />} className="scroll-mt-20"
      actions={<Badge tone={full ? "warn" : "ok"}>
        {roster.limit === null ? t("roster_active_unl", { used: roster.used }) : t("roster_active", { used: roster.used, limit: roster.limit })}
      </Badge>}>
      <div id={id} className="flex flex-col gap-3">
        <p id={hintId} className="text-xs text-ink-2">{roster.locked ? t("locked") : t("roster_hint")}</p>
        {error && <p className="text-sm text-bad font-semibold" role="alert">{error}</p>}
        {swapFor && (
          <div className="panel-soft p-2 flex flex-wrap items-center gap-2 text-sm" role="status">
            <ArrowLeftRight size={15} aria-hidden />
            <span className="flex-1 min-w-0">{t("swap_pick", { name: swapFor.name })}</span>
            <Button size="sm" variant="ghost" onClick={() => setSwapFor(null)}>{t("swap_cancel")}</Button>
          </div>
        )}
        <div className={compact ? "grid gap-3 md:grid-cols-2" : "grid gap-3 md:grid-cols-2"} aria-describedby={hintId}>
          <section aria-label={t("roster_active", { used: roster.used, limit: roster.limit ?? "∞" })} {...zoneProps("active")}
            className={`rounded-xl p-2 min-w-0 ${dragOver === "active" ? "bg-ok-soft" : "bg-panel-2"}`}>
            <h3 className="text-xs font-semibold text-ink-2 mb-1.5 px-1">
              {roster.limit === null ? t("roster_active_unl", { used: roster.used }) : t("roster_active", { used: roster.used, limit: roster.limit })}
            </h3>
            {roster.active.length ? <ul className="flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-1">{roster.active.map((a) => row(a, "active"))}</ul>
              : <p className="text-sm text-muted px-1">{t("active_empty")}</p>}
          </section>
          <section aria-label={t("roster_bench", { n: roster.bench.length })} {...zoneProps("bench")}
            className={`rounded-xl p-2 min-w-0 ${dragOver === "bench" ? "bg-info-soft" : "bg-panel-2"}`}>
            <h3 className="text-xs font-semibold text-ink-2 mb-1.5 px-1">{t("roster_bench", { n: roster.bench.length })}</h3>
            {roster.bench.length ? <ul className="flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-1">{roster.bench.map((a) => row(a, "bench"))}</ul>
              : <p className="text-sm text-muted px-1">{t("bench_empty")}</p>}
          </section>
        </div>
        {!roster.locked && <p className="text-xs text-muted">{t("drag_hint")}</p>}
      </div>
    </Panel>
  );
}
