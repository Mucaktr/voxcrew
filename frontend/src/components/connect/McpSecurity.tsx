// Ekip S11 — MCP erişim ayarları (clients.mcp.enabled, clients.mcp.allow_decisions). Yalnızca açık tıklamayla.
// AGENT-DELETE: + "Ajanlar silebilsin" (clients.agents.allow_delete) ve risk onayı.
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AGENT_DELETE_ANCHOR, RISK_KEYS } from "../../lib/agentDelete";
import { clientsApi, type ClientsStatus } from "../../lib/clients";
import { useT } from "../../lib/i18n";
import { agentDeleteMsg } from "../../locales/agentDelete";
import { connect as m } from "../../locales/connect";
import { Button, Checkbox, Modal, Panel, Toggle } from "../ui";

export function McpSecurity({ status, onChanged }: { status: ClientsStatus | null; onChanged: () => Promise<void> }) {
  const t = useT(m);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = status?.settings;
  // AGENT-DELETE (karar 31 Ekim): "Ajanlar silebilsin" — açmak bütün riskleri sayan onay ister, kapatmak istemez
  const td = useT(agentDeleteMsg);
  const [delConfirm, setDelConfirm] = useState(false);
  const [delAck, setDelAck] = useState(false);
  const delRef = useRef<HTMLDivElement>(null);
  const { hash } = useLocation();
  useEffect(() => {
    if (hash !== `#${AGENT_DELETE_ANCHOR}` || !s) return;
    // yol değişiminde uygulama odağı <main>'e taşır; ondan sonra ayara kaydır ve anahtarı odakla
    const h = window.setTimeout(() => {
      delRef.current?.scrollIntoView({ block: "center" });
      delRef.current?.querySelector<HTMLElement>('[role="switch"]')?.focus({ preventScroll: true });
    }, 400);
    return () => window.clearTimeout(h);
  }, [hash, s]);
  const saveDelete = async (allow: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await clientsApi.saveAgentDelete(allow);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (patch: Partial<ClientsStatus["settings"]>) => {
    setBusy(true);
    setError(null);
    try {
      await clientsApi.saveMcpSettings(patch);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t("security_title")} icon={<ShieldCheck size={18} />}>
      {!s ? <p className="text-sm text-muted">{t("settings_loading")}</p> : (
        <div className="flex flex-col gap-4" aria-busy={busy}>
          <Toggle checked={s.enabled} onChange={(v) => { if (!busy) void save({ enabled: v }); }}
            label={t("access_label")}
            hint={t("access_hint")} />
          <Toggle checked={s.allow_decisions}
            onChange={(v) => { if (busy) return; if (v) setConfirming(true); else void save({ allow_decisions: false }); }}
            label={t("decisions_label")}
            hint={t("decisions_hint")} />
          <div id={AGENT_DELETE_ANCHOR} ref={delRef} className="scroll-mt-24">
            <Toggle checked={s.agent_delete === true}
              onChange={(v) => { if (busy) return; if (v) { setDelAck(false); setDelConfirm(true); } else void saveDelete(false); }}
              label={td("toggle_label")}
              hint={td("toggle_hint")} />
          </div>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        </div>
      )}
      <Modal open={confirming} onClose={() => setConfirming(false)} title={t("decisions_confirm_title")} width={520}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirming(false)}>{t("cancel")}</Button>
          <Button variant="danger" icon={<ShieldAlert size={15} />} disabled={busy}
            onClick={() => { setConfirming(false); void save({ allow_decisions: true }); }}>
            {t("open_anyway")}
          </Button>
        </>}>
        <div className="flex flex-col gap-2 text-sm leading-relaxed">
          <p>{t("decisions_warn1")}</p>
          <p>{t("decisions_warn2")}</p>
        </div>
      </Modal>
      <Modal open={delConfirm} onClose={() => setDelConfirm(false)} title={td("confirm_title")} width={560}
        footer={<>
          <Button variant="ghost" onClick={() => setDelConfirm(false)}>{td("cancel")}</Button>
          <Button variant="danger" icon={<ShieldAlert size={15} />} disabled={busy || !delAck}
            onClick={() => { setDelConfirm(false); void saveDelete(true); }}>
            {td("confirm_open")}
          </Button>
        </>}>
        <div className="flex flex-col gap-3 text-sm leading-relaxed">
          <p>{td("confirm_intro")}</p>
          <ul className="list-disc pl-5 flex flex-col gap-2" aria-label={td("confirm_title")}>
            {RISK_KEYS.map((k) => <li key={k}>{td(k)}</li>)}
          </ul>
          <Checkbox checked={delAck} onChange={setDelAck} label={td("confirm_ack")} labelClassName="font-semibold" />
        </div>
      </Modal>
    </Panel>
  );
}
