// PANO-FIX Pano Görünümünün sade "Başlarken" kartı (ilk kabule kadar). Dünya Görünümündeki "İlk mesai" kartının
// (components/game/FirstSessionCard) aynı gerçek verisi, oyun dili olmadan: Bağlantı · Ekip · İlk görev · İlk çıktı ·
// Kabul; ödül/parşömen yok. Yerleşim: karar bölümünün içinde, listenin ALTINDA; veri karar listesiyle aynı anda çizilir
// (BoardPage kararları ilk oturum yanıtını en çok START_WAIT_MS bekleyerek gösterir) — sonradan gelip düzeni itmez.
// Yalnız ilk oturumu sürenlerde gerekir: tembel parça (useFirstSession veriyle birlikte yükler; Pano parça bütçesi §9).
import clsx from "clsx";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import type { FirstSession, FsStepId } from "../../lib/loop";
import { boardStartMsg } from "../../locales/boardStart";
import { openOnboarding } from "../onboarding/onboarding";
import { Button } from "../ui";
import { HIDE_KEY, write } from "./useFirstSession";

type BoardStep = "connection" | "team" | "task" | "output" | "accept";
const STEPS: BoardStep[] = ["connection", "team", "task", "output", "accept"];
const OF: Record<FsStepId, BoardStep | null> = {
  age: "team", connection: "connection", office: "team", task: "task", working: "task", delivered: "output", accepted: "accept",
  reward: null,
};

export function BoardStartCard({ data }: { data: FirstSession }) {
  const t = useT(boardStartMsg);
  const [hidden, setHidden] = useState(false);
  if (hidden || data.complete || (data.accepted_at != null && data.accepted_at < data.started_at)) return null;
  const done = (s: BoardStep) => {
    const by = (id: FsStepId) => data.steps.find((x) => x.id === id)?.done ?? false;
    switch (s) {
      case "connection": return by("connection");
      case "team": return by("age") && by("office");
      case "task": return by("task");
      case "output": return by("delivered");
      case "accept": return by("accepted");
    }
  };
  const current = data.current ? OF[data.current] : null;
  const n = STEPS.filter(done).length;
  const hide = () => { setHidden(true); write(HIDE_KEY); };
  return (
    <div className="bd-start" role="group" aria-labelledby="bd-start-h">
      <div className="bd-start-head">
        <h3 id="bd-start-h">{t("title")}</h3>
        <span className="chip tone-muted num">{t("progress", { done: n, total: STEPS.length })}</span>
        <Button size="sm" variant="ghost" icon={<X size={14} aria-hidden />} onClick={hide} aria-label={t("hide")} title={t("hide")} className="ml-auto" />
      </div>
      <ol className="bd-start-steps" aria-label={t("region")}>
        {STEPS.map((s) => {
          const ok = done(s);
          return (
            <li key={s} aria-current={s === current ? "step" : undefined} className={clsx(ok && "is-done", s === current && "is-now")}>
              <span aria-hidden className="bd-start-dot">{ok ? <Check size={12} strokeWidth={3} /> : null}</span>
              <span>{t(`step_${s}`)}</span>
              {ok && <span className="sr-only"> ✓</span>}
            </li>
          );
        })}
      </ol>
      {data.current && <Next id={data.current} office={data.office} pendingRun={data.pending_run} localOnly={data.connection_hint === "local_model"} />}
    </div>
  );
}

function Next({ id, office, pendingRun, localOnly }: { id: FsStepId; office: string | null; pendingRun: string | null; localOnly?: boolean }) {
  const t = useT(boardStartMsg);
  const hint = id === "age" ? t("hint_age") : id === "connection" ? t(localOnly ? "hint_connection_local" : "hint_connection")
    : id === "office" ? t("hint_team") : id === "task" ? t("hint_task") : id === "working" ? t("hint_working")
    : id === "delivered" ? t("hint_output") : id === "accepted" ? t("hint_accept") : null;
  const cta = (() => {
    switch (id) {
      case "age":
      case "office":
        return <Button size="sm" variant="primary" onClick={openOnboarding}>{t("cta_wizard")}</Button>;
      case "connection":
        return <Link to="/baglantilar" className="btn btn-sm btn-primary">{t("cta_connect")}</Link>;
      case "task":
        return office?.startsWith("ikili-")
          ? <Link to={`/akislar/${encodeURIComponent(office)}`} className="btn btn-sm btn-primary">{t("cta_flow")}</Link>
          : <Button size="sm" variant="primary" onClick={openOnboarding}>{t("cta_wizard")}</Button>;
      case "accepted":
        return <Link to={pendingRun ? `/gorevler/${encodeURIComponent(pendingRun)}?kabul=1` : "/gorevler"} className="btn btn-sm btn-primary">{t("cta_review")}</Link>;
      default:
        return null;
    }
  })();
  if (!hint) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-sm text-ink-2 flex-1 min-w-[min(100%,220px)]">{hint}</p>
      {cta}
    </div>
  );
}
