import clsx from "clsx";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../../lib/i18n";
import { officeApi, TEAM_COLORS, type TeamInfo } from "../../lib/office";
import { officeMsg as m } from "../../locales/office";
import { Button, Field, Modal, Swatches } from "../ui";
import { ICON_KEYS, TEAM_ICONS, TeamBadge, TeamIcon } from "./TeamIcon";

/** Ekip oluşturma ve düzenleme penceresi (ad, misyon, renk, simge). */
export function TeamDialog({ open, onClose, team, onSaved }:
  { open: boolean; onClose: () => void; team?: TeamInfo | null; onSaved: (t: TeamInfo) => void | Promise<void> }) {
  const t = useT(m);
  const [name, setName] = useState("");
  const [mission, setMission] = useState("");
  const [color, setColor] = useState(TEAM_COLORS[0]);
  const [icon, setIcon] = useState("users");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(team?.name ?? "");
    setMission(team?.mission ?? "");
    setColor(team?.color ?? TEAM_COLORS[Math.floor(Math.random() * TEAM_COLORS.length)]);
    setIcon(team?.icon ?? "users");
    setError(null);
  }, [open, team]);

  const save = async () => {
    if (!name.trim()) { setError(t("team_name_empty")); return; }
    setBusy(true);
    setError(null);
    try {
      const data = { name: name.trim(), mission: mission.trim(), color, icon };
      const saved = team ? await officeApi.updateTeam(team.slug, data) : await officeApi.createTeam(data);
      await onSaved(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={520} title={team ? t("team_edit") : t("team_new")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button variant="primary" icon={<Save size={16} />} disabled={busy || !name.trim()} onClick={save}>
          {team ? t("save") : t("team_create")}
        </Button>
      </>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="flex items-center gap-3">
          <TeamBadge color={color} icon={icon} size={44} />
          <Field label={t("team_name")} className="flex-1">
            <input className="input" value={name} maxLength={60} autoFocus placeholder={t("team_name_placeholder")}
              onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label={t("mission")} hint={t("mission_hint")}>
          <textarea className="textarea" rows={3} value={mission} maxLength={600}
            placeholder={t("mission_placeholder")}
            onChange={(e) => setMission(e.target.value)} />
        </Field>
        <Field label={t("color")}>
          <Swatches colors={TEAM_COLORS} value={color} onChange={setColor} />
        </Field>
        <Field label={t("icon")}>
          <div className="flex flex-wrap gap-1.5">
            {ICON_KEYS.map((k) => (
              <button key={k} type="button" aria-pressed={icon === k} title={TEAM_ICONS[k].label} aria-label={TEAM_ICONS[k].label}
                onClick={() => setIcon(k)}
                className={clsx("card-select h-9 w-9 grid place-items-center", icon === k && "!border-line")}>
                <TeamIcon name={k} size={17} />
              </button>
            ))}
          </div>
        </Field>
        {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
