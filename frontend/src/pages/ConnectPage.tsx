// Ekip S11 — Claude Code ve Codex içinden kullanım (MCP): kurulum, bağlantı sınaması, güvenlik, izleme kurulumu.
// Rotalar: /baglan → Claude Code sekmesi, /baglan/claude-code, /baglan/codex.
import { Cable, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ClaudeSetup } from "../components/connect/ClaudeSetup";
import { CodexSetup } from "../components/connect/CodexSetup";
import { ConnectionTest } from "../components/connect/ConnectionTest";
import { ExamplePrompts } from "../components/connect/ExamplePrompts";
import { McpSecurity } from "../components/connect/McpSecurity";
import { TrackingSetup } from "../full/ui";
import { Badge, Button, CONN_ICON, Empty, PageHeader, Spinner, TabPanel, Tabs } from "../components/ui";
import { CLIENT_NAMES, clientsApi, ensureClientEvents, isClientId, type ClientId, type ClientsStatus, type Snippets } from "../lib/clients";
import { useT } from "../lib/i18n";
import { connect as m } from "../locales/connect";

const TABS: { value: ClientId; label: ReactNode }[] = [
  { value: "claude-code", label: <span className="flex items-center gap-1.5">{CONN_ICON.claude}Claude Code</span> },
  { value: "codex", label: <span className="flex items-center gap-1.5">{CONN_ICON.codex}Codex</span> },
];

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function ConnectPage() {
  const t = useT(m);
  const { client: raw } = useParams();
  const navigate = useNavigate();
  const client: ClientId = isClientId(raw) ? raw : "claude-code";
  const tabsId = useId();
  const [status, setStatus] = useState<ClientsStatus | null>(null);
  const [snippets, setSnippets] = useState<Snippets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

  const refreshStatus = useCallback(async (force = false) => {
    try {
      setStatus(await clientsApi.status(force));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  const loadAll = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const [st, sn] = await Promise.all([clientsApi.status(force), clientsApi.snippets()]);
      setStatus(st);
      setSnippets(sn);
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    ensureClientEvents();
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (raw !== undefined && !isClientId(raw)) navigate("/baglan/claude-code", { replace: true });
  }, [raw, navigate]);

  const test = useCallback(async () => {
    setTesting(true);
    await refreshStatus(true);
    setTesting(false);
  }, [refreshStatus]);

  return (
    <div className="p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <PageHeader title={t("page_title")}
        subtitle={t("page_subtitle")}
        meta={snippets && <>
          <Badge title={t("studio_url_title")}><span className="font-mono">{snippets.studio_url}</span></Badge>
          <Badge tone={status?.settings.enabled === false ? "warn" : "muted"}>
            {status?.settings.enabled === false ? t("mcp_off") : t("mcp_on")}
          </Badge>
          <Badge tone={status?.settings.allow_decisions ? "warn" : "ok"}>
            {status?.settings.allow_decisions ? t("approvals_mcp") : t("approvals_ui")}
          </Badge>
        </>}
        actions={<Button icon={loading ? <Spinner size={15} /> : <RefreshCcw size={15} />} disabled={loading}
          onClick={() => void loadAll(true)}>{t("refresh")}</Button>} />

      {error && (
        <div role="alert" className="chip tone-bad !rounded-lg !whitespace-normal !items-start font-medium p-3 text-sm">
          {t("info_error", { e: error })}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] items-start">
        <div className="panel overflow-hidden min-w-0">
          <Tabs id={tabsId} value={client} onChange={(c) => navigate(`/baglan/${c}`)} tabs={TABS} label={t("tabs_label")} />
          <TabPanel tabs={tabsId} value={client} label={t("setup_of", { name: CLIENT_NAMES[client] })} className="p-3 sm:p-5">
            {!snippets ? (
              loading ? <div className="flex justify-center py-10"><Spinner size={22} /></div>
                : <Empty icon={<Cable size={28} />} title={t("load_fail_title")} text={t("load_fail_text")} />
            ) : client === "claude-code" ? (
              <ClaudeSetup snippets={snippets} />
            ) : (
              <CodexSetup snippets={snippets} status={status} onApplied={() => void refreshStatus()} />
            )}
          </TabPanel>
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <ConnectionTest client={client} status={status} onTest={test} testing={testing} />
          <McpSecurity status={status} onChanged={() => refreshStatus()} />
          {snippets && <ExamplePrompts client={client} examples={snippets.examples} />}
        </div>
      </div>

      <TrackingSetup client={client} />
    </div>
  );
}
