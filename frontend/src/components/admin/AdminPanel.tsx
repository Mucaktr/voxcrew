// S40 — Ayarlar → "Yönetici / test modu" bölümü. brand.ts adminModeAvailable false ise ya da sunucu /api/admin'i
// sunmuyorsa hiç çizilmez. Tüm yardımcılar geri alınabilir; hiçbiri XP defterine dokunmaz.
import { FlaskConical, Trash2, UserPlus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  ADMIN_MODE_AVAILABLE, removeDemoAgents, seedDemoAgents, setAdminMode, simulate, useAdmin, wireAdmin, type SimKind,
} from "../../lib/admin";
import { useT } from "../../lib/i18n";
import { adminMsg } from "../../locales/admin";
import { Badge, Button, Field, Modal, Panel, SectionTitle, Toggle } from "../ui";

const SIMS: { kind: SimKind; key: "sim_levelup" | "sim_achievement" | "sim_budget" | "sim_interrupted" | "sim_speech" }[] = [
  { kind: "levelup", key: "sim_levelup" }, { kind: "achievement", key: "sim_achievement" },
  { kind: "budget", key: "sim_budget" }, { kind: "interrupted", key: "sim_interrupted" }, { kind: "speech", key: "sim_speech" },
];

export function AdminPanel() {
  if (!ADMIN_MODE_AVAILABLE) return null;
  return <AdminPanelInner />;
}

function AdminPanelInner() {
  const t = useT(adminMsg);
  const status = useAdmin((s) => s.status);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(5);
  const [ask, setAsk] = useState<"seed" | "remove" | null>(null);
  const countId = useId();
  useEffect(() => { wireAdmin(); void useAdmin.getState().load(); }, []);
  if (!status) return null;

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setNote(null);
    try {
      setNote(await fn());
    } catch (e) {
      setNote(t("error", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  const sim = (kind: SimKind, label: string) => {
    const r = simulate(kind, { achievementName: t("sim_achievement_name"), achievementText: t("sim_achievement_text"),
      speech: t("sim_speech_text") });
    setNote(r === "ok" ? (kind === "speech" ? t("sim_speech_done") : t("sim_done", { what: label }))
      : r === "need_agents" ? t("sim_need_agents") : t("sim_need_game"));
  };

  return (
    <Panel title={t("title")} icon={<FlaskConical size={16} />}
      actions={status.active ? <Badge tone="warn">{t("badge")}</Badge> : undefined}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2 max-w-3xl">{t("intro")}</p>
        <p className="text-xs text-muted">{t("launch_note")}</p>
        <Toggle checked={status.active} label={t("toggle")} hint={t("toggle_hint")}
          onChange={(v) => { void run(async () => { await setAdminMode(v); return null; }); }} />
        {status.env && <p className="panel-soft tone-warn p-2.5 text-sm" role="status">{t("env_on", { var: status.env_var })}</p>}
        {status.active && <p className="text-xs text-muted">{t("residue")}</p>}

        <div className="pt-4 border-t-2 border-line-soft flex flex-col gap-2.5">
          <div>
            <SectionTitle as="h3" size="sm">{t("helpers")}</SectionTitle>
            <p className="text-xs text-muted mt-0.5">{t("helpers_hint")}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SIMS.map((s) => (
              <Button key={s.kind} size="sm" onClick={() => sim(s.kind, t(s.key))}>{t(s.key)}</Button>
            ))}
          </div>
          <p className="text-xs text-muted">{t("academy_note")}</p>
        </div>

        <div className="pt-4 border-t-2 border-line-soft flex flex-col gap-2.5">
          <div>
            <SectionTitle as="h3" size="sm">{t("demo")}</SectionTitle>
            <p className="text-xs text-muted mt-0.5">{t("demo_hint")}</p>
            <p className="text-sm mt-1" role="status">{t("demo_now", { n: status.demo_agents })}</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={<label htmlFor={countId}>{t("demo_count")}</label>} className="w-24">
              <input id={countId} className="input" type="number" min={1} max={50} value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
            </Field>
            <Button size="sm" icon={<UserPlus size={14} />} disabled={busy || !status.active} onClick={() => setAsk("seed")}>
              {t("demo_seed")}
            </Button>
            <Button size="sm" variant="danger" icon={<Trash2 size={14} />} disabled={busy || status.demo_agents === 0}
              onClick={() => setAsk("remove")}>
              {t("demo_remove")}
            </Button>
          </div>
        </div>
        {note && <p className="text-sm" role="status" aria-live="polite">{note}</p>}
      </div>

      <Modal open={ask === "seed"} onClose={() => setAsk(null)} title={t("demo_seed_title")} width={480}
        footer={<>
          <Button onClick={() => setAsk(null)}>{t("cancel")}</Button>
          <Button variant="primary" disabled={busy} onClick={() => { setAsk(null); void run(async () => t("demo_added", { n: await seedDemoAgents(count) })); }}>
            {t("demo_seed_yes", { n: count })}
          </Button></>}>
        <p className="text-sm">{t("demo_seed_text", { n: count })}</p>
      </Modal>
      <Modal open={ask === "remove"} onClose={() => setAsk(null)} title={t("demo_remove_title")} width={480}
        footer={<>
          <Button onClick={() => setAsk(null)}>{t("cancel")}</Button>
          <Button variant="danger" disabled={busy} onClick={() => { setAsk(null); void run(async () => t("demo_removed", { n: await removeDemoAgents() })); }}>
            {t("demo_remove_yes")}
          </Button></>}>
        <p className="text-sm">{t("demo_remove_text", { n: status.demo_agents })}</p>
      </Modal>
    </Panel>
  );
}
