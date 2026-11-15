// Ekip S6 — devretme sırasında işe alınan ajanlar ve "İşten çıkar" (gizle: geri alınabilir · sil: kalıcı).
import { EyeOff, ExternalLink, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import type { Agent } from "../../lib/types";
import { officeMsg as m } from "../../locales/office";
import { PixelFace } from "../PixelFace";
import { Badge, Button, Empty, Modal } from "../ui";
import { RankBadge } from "./RankBadge";
import { hierarchyApi } from "./hierarchy";

export function HiredPanel({ agents, onChanged }: { agents: Agent[]; onChanged: () => Promise<void> }) {
  const t = useT(m);
  const hired = agents.filter((a) => a.hired_by);
  const [target, setTarget] = useState<Agent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (slug?: string | null) => agents.find((a) => a.slug === slug)?.name ?? slug ?? "?";

  const fire = async (mode: "hide" | "delete") => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await hierarchyApi.fire(target.slug, mode);
      await onChanged();
      setTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!hired.length) {
    return <Empty icon={<UserPlus size={26} />} title={t("hired_empty")} text={t("hired_empty_text")} />;
  }
  return (
    <>
      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 max-h-[32rem] overflow-y-auto">
        {hired.map((a) => (
          <li key={a.slug} className="panel-soft p-2.5 flex items-center gap-2.5 min-w-0">
            <PixelFace avatar={a.avatar} size={38} ring={a.color} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-semibold text-sm truncate">{a.name}</span>
                {a.hidden && <Badge tone="muted"><EyeOff size={12} />{t("hidden")}</Badge>}
              </div>
              <div className="text-xs text-ink-2 truncate">{t("hired_by", { title: a.title || t("no_title_short"), name: nameOf(a.hired_by) })}</div>
              <div className="flex flex-wrap items-center gap-1 mt-1">
                <RankBadge rank={a.rank} />
                {a.hired_in_run && (
                  <Link to={`/gorevler/${a.hired_in_run}`} className="chip hover:border-ink-2" title={t("hire_run_title")}>
                    <ExternalLink size={12} />{t("run")}
                  </Link>
                )}
              </div>
            </div>
            <Button size="sm" icon={<UserMinus size={14} />} onClick={() => { setError(null); setTarget(a); }}
              aria-label={t("fire_label", { name: a.name })}>
              <span className="hidden sm:inline">{t("fire")}</span>
            </Button>
          </li>
        ))}
      </ul>
      <Modal open={!!target} onClose={() => setTarget(null)} width={480} title={t("fire_q")}
        footer={<>
          <Button variant="ghost" onClick={() => setTarget(null)}>{t("cancel")}</Button>
          {!target?.hidden && <Button icon={<EyeOff size={15} />} disabled={busy} onClick={() => fire("hide")}>{t("hide")}</Button>}
          <Button variant="danger" icon={<Trash2 size={15} />} disabled={busy} onClick={() => fire("delete")}>{t("delete_permanent")}</Button>
        </>}>
        <div className="flex flex-col gap-2 text-sm leading-relaxed">
          <p>{t("fire_text", { name: target?.name ?? "", title: target?.title || t("no_title_lower") })}</p>
          <ul className="list-disc pl-5 text-ink-2">
            <li><b>{t("fire_hide_a")}</b>{t("fire_hide_b")}</li>
            <li><b>{t("fire_delete_a")}</b>{t("fire_delete_b")}</li>
            <li>{t("fire_reports", { name: nameOf(target?.reports_to) })}</li>
          </ul>
          {error && <p className="font-semibold text-bad" role="alert">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
