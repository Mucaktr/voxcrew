// Ekip S11 — istemci durumu ve "Bağlantıyı sına" (son MCP çağrısının zamanı).
import { CheckCircle2, CircleAlert, PlugZap, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { CLIENT_NAMES, useLiveLastSeen, type ClientId, type ClientsStatus } from "../../lib/clients";
import { timeAgo } from "../../lib/format";
import { useT } from "../../lib/i18n";
import { connect as m } from "../../locales/connect";
import { Badge, Button, Panel, Spinner } from "../ui";
import { Rich } from "./SetupStep";

const FRESH_S = 10 * 60;

export function ConnectionTest({ client, status, onTest, testing }:
  { client: ClientId; status: ClientsStatus | null; onTest: () => Promise<void>; testing: boolean }) {
  const t = useT(m);
  const [tested, setTested] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const live = useLiveLastSeen(client);
  const entry = status?.clients[client];
  const cli = entry?.cli;
  const lastSeen = Math.max(entry?.last_seen?.last_seen ?? 0, live ?? 0) || null;
  const fresh = lastSeen != null && Date.now() / 1000 - lastSeen < FRESH_S;
  const name = CLIENT_NAMES[client];
  const node = status?.node;

  const test = async () => {
    await onTest();
    setTested(true);
  };

  return (
    <Panel title={t("conn_title")} icon={<PlugZap size={18} />}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {!status ? <Badge>{t("checking")}</Badge> : cli?.available ? (
            <Badge tone="ok"><CheckCircle2 size={12} />{name}{cli.version ? ` ${cli.version}` : ""}</Badge>
          ) : (
            <Badge tone="warn" title={cli?.detail ?? undefined}><XCircle size={12} />{t("cli_missing", { name })}</Badge>
          )}
          {node && (node.available ? (
            <Badge tone={node.supported === false ? "warn" : "muted"}>{t("node_version", { v: node.version ?? "?" })}{node.supported === false ? t("node_required") : ""}</Badge>
          ) : <Badge tone="bad">{t("node_missing")}</Badge>)}
          {status && !status.server.exists && <Badge tone="bad">{t("server_missing")}</Badge>}
        </div>

        <div className={fresh ? "rounded-lg border-2 px-3 py-2 text-sm tone-ok" : "rounded-lg border-2 px-3 py-2 text-sm tone-muted"}
          role="status" aria-live="polite">
          {lastSeen ? (
            <>
              <b>{t("last_call")}</b> <span className="num">{timeAgo(lastSeen * 1000)}</span>
              {entry?.last_seen?.count ? <span>{t("total_requests", { n: entry.last_seen.count })}</span> : null}
              {fresh && <span>{t("looks_connected")}</span>}
            </>
          ) : (
            <span>{t("no_call_yet", { name })}</span>
          )}
        </div>

        {tested && !fresh && (
          <p className="text-sm text-ink-2 leading-relaxed">
            <CircleAlert size={14} className="inline mr-1 -mt-0.5 text-warn" aria-hidden="true" />
            <Rich text={t("restart_hint", { name: t(client === "codex" ? "restart_name_codex" : "restart_name_claude") })}
              parts={{ mcp: <span className="kbd">/mcp</span>, server: <span className="font-mono">voxcrew</span> }} />
          </p>
        )}
        {status && !status.settings.enabled && (
          <p className="text-sm text-warn">{t("mcp_disabled_warn")}</p>
        )}

        <div>
          <Button icon={testing ? <Spinner size={15} /> : <PlugZap size={15} />} disabled={testing} onClick={test}>
            {t("test_btn")}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
