// Ekip S6 — ofis rolleri ve rol atama (QA-M1): rolü bir ajana ver, boşalt, yeni rol ekle, sil.
// İş akışlarındaki `role:` adımları rolü taşıyan ajanı çalıştırır; rol başka ajana verilince akış yeni ajanı kullanır.
import { Plus, Trash2, UserCog } from "lucide-react";
import { useMemo, useState } from "react";
import { byName } from "../../lib/agents";
import { useT } from "../../lib/i18n";
import type { TeamInfo } from "../../lib/office";
import type { Agent } from "../../lib/types";
import { officeMsg as m } from "../../locales/office";
import { PixelFace } from "../PixelFace";
import { Badge, Button, Empty } from "../ui";
import { RankBadge } from "./RankBadge";
import { hierarchyApi, rankIndex, type RoleInfo } from "./hierarchy";

export function RolesPanel({ roles, agents, teams, onChanged }:
  { roles: RoleInfo[]; agents: Agent[]; teams: TeamInfo[]; onChanged: () => Promise<void> }) {
  const t = useT(m);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const visible = useMemo(() => agents.filter((a) => !a.hidden).sort(byName), [agents]);
  const sorted = useMemo(() => [...roles].sort((a, b) =>
    (rankIndex(a.rank) < 0 ? 99 : rankIndex(a.rank)) - (rankIndex(b.rank) < 0 ? 99 : rankIndex(b.rank))
    || byName(a, b)), [roles]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {!sorted.length ? (
        <Empty icon={<UserCog size={26} />} title={t("roles_empty")} text={t("roles_empty_text")} />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((r) => {
            const holder = visible.find((a) => a.slug === r.holder);
            const team = teams.find((x) => x.slug === r.team);
            return (
              <li key={r.id} className="panel-soft p-2.5 flex flex-col gap-2 min-w-0">
                <div className="flex items-start gap-2 min-w-0">
                  <PixelFace avatar={holder?.avatar} size={34} ring={holder?.color} />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate" title={r.description || r.name}>{r.name}</div>
                    <div className="flex flex-wrap items-center gap-1 mt-0.5">
                      <RankBadge rank={r.rank} />
                      {team && <span className="chip"><span className="h-2 w-2 rounded-full" style={{ background: team.color }} />{team.name}</span>}
                      {!r.holder && <Badge tone="warn">{t("no_holder")}</Badge>}
                    </div>
                  </div>
                  {confirm === r.id ? (
                    <Button size="sm" variant="danger" disabled={busy === r.id}
                      onClick={() => run(r.id, async () => { await hierarchyApi.deleteRole(r.id); setConfirm(null); })}>{t("delete")}</Button>
                  ) : (
                    <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirm(r.id)}
                      aria-label={t("delete_role", { name: r.name })} title={t("delete_role_title")} />
                  )}
                </div>
                <label className="sr-only" htmlFor={`rol-${r.id}`}>{t("role_holder_label", { name: r.name })}</label>
                <select id={`rol-${r.id}`} className="select !py-1.5 !text-sm" value={r.holder ?? ""} disabled={busy === r.id}
                  onChange={(e) => run(r.id, () => hierarchyApi.updateRole(r.id, { holder: e.target.value || null }))}>
                  <option value="">{t("holder_none")}</option>
                  {visible.map((a) => <option key={a.slug} value={a.slug}>{a.name}{a.title ? ` — ${a.title}` : ""}</option>)}
                </select>
              </li>
            );
          })}
        </ul>
      )}
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim();
        if (n) run("__yeni", async () => { await hierarchyApi.createRole({ name: n }); setName(""); });
      }}>
        <label className="sr-only" htmlFor="yeni-rol">{t("new_role_label")}</label>
        <input id="yeni-rol" className="input !w-auto flex-1 min-w-[12rem]" value={name} maxLength={60}
          placeholder={t("new_role_placeholder")} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" icon={<Plus size={15} />} disabled={!name.trim() || busy === "__yeni"}>{t("add_role")}</Button>
      </form>
      {error && <p className="text-sm font-semibold text-bad" role="alert">{error}</p>}
    </div>
  );
}
