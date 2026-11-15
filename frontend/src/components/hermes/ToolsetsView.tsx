// Ekip S1: Araç setleri — Hermes kayıt defteri, profil başına CLI / API varsayılanları, riskli ve kapalı rozetleri.
import clsx from "clsx";
import { Ban, CheckCircle2, Plug, ShieldAlert, Wrench } from "lucide-react";
import { useState } from "react";
import { hermesApi, TOOLSET_TR, type HermesProfile, type ToolsetInfo } from "../../lib/hermes";
import { tp, useT } from "../../lib/i18n";
import { hermesMsg as m } from "../../locales/hermes";
import { Badge, Empty, Segmented } from "../ui";
import { ErrorBox, LoadingBlock, Note, ProfileSelect, Rich, useLoad } from "./common";

type Filter = "all" | "cli" | "api" | "off";

export function ToolsetsView({ profiles, profile, onProfile }: { profiles: HermesProfile[]; profile: string; onProfile: (p: string) => void }) {
  const t = useT(m);
  const { data, error, loading, reload } = useLoad(() => hermesApi.toolsets(profile), [profile]);
  const [filter, setFilter] = useState<Filter>("all");
  const list = (data ?? []).filter((x) =>
    filter === "all" || (filter === "cli" ? x.default : filter === "api" ? x.api_default : !x.default));
  const cliCount = (data ?? []).filter((x) => x.default).length;
  const apiCount = (data ?? []).filter((x) => x.api_default).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ProfileSelect profiles={profiles} value={profile} onChange={onProfile} />
        <Segmented value={filter} onChange={setFilter} className="flex-wrap" options={[
          { value: "all", label: t("f_all") }, { value: "cli", label: t("f_cli", { n: cliCount }) },
          { value: "api", label: t("f_api", { n: apiCount }) }, { value: "off", label: t("f_off") },
        ]} />
      </div>
      <Note tone="info" icon={<Wrench size={15} />}>
        <Rich text={t("ts_note")} parts={{
          config: <code className="font-mono text-xs">config.yaml</code>, t: <code className="font-mono text-xs">-t</code>, api: <b>API</b>,
          api_server: <code className="font-mono text-xs">api_server</code>, more: <b>{t("ts_note_more")}</b>,
        }} />
      </Note>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <LoadingBlock label={t("ts_reading")} /> : list.length === 0 ? (
        <Empty icon={<Wrench size={28} />} title={t("ts_empty")} />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
          {list.map((x) => <li key={x.name}><ToolsetCard t={x} /></li>)}
        </ul>
      )}
    </div>
  );
}

export function ToolsetCard({ t }: { t: ToolsetInfo }) {
  const tr = useT(m);
  return (
    <article className={clsx("panel-soft p-3.5 h-full flex flex-col gap-2", t.profile_disabled && "opacity-75")}>
      <header className="flex items-start gap-2">
        <span className="h-8 w-8 rounded-md grid place-items-center bg-panel border-2 border-line-soft text-base shrink-0" aria-hidden>
          {t.kind === "mcp" ? <Plug size={15} /> : t.emoji ?? <Wrench size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">{TOOLSET_TR[t.name] ?? t.label}</h3>
          <p className="font-mono text-xs text-muted">{t.name}</p>
        </div>
      </header>
      <p className="text-xs text-ink-2 leading-relaxed">{t.description}</p>
      <div className="flex flex-wrap gap-1.5">
        {t.default ? <Badge tone="ok"><CheckCircle2 size={12} />{tr("cli_on")}</Badge> : <Badge>{tr("cli_off")}</Badge>}
        {t.api_default && <Badge tone="info">{tr("api_on")}</Badge>}
        {t.profile_disabled && <Badge tone="bad" title="agent.disabled_toolsets"><Ban size={12} />{tr("profile_disabled")}</Badge>}
        {t.default_off && !t.default && <Badge title={tr("default_off_title")}>{tr("default_off")}</Badge>}
        {t.risky && <Badge tone="warn" title={tr("risky_title")}><ShieldAlert size={12} />{tr("risky")}</Badge>}
        {t.config_only && <Badge>{tr("config_only")}</Badge>}
        {!t.cli_allowed && <Badge title={tr("only_platforms_title")}>{tr("only_platforms", { list: t.platforms.join(", ") })}</Badge>}
      </div>
      {t.tools.length > 0 && (
        <details className="text-xs mt-auto">
          <summary className="cursor-pointer text-muted hover:text-ink">{tp(m, "n_tools", t.tools.length)}</summary>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {t.tools.map((x) => <code key={x} className="font-mono text-xs bg-panel-3 rounded px-1.5 py-0.5">{x}</code>)}
          </div>
        </details>
      )}
    </article>
  );
}
