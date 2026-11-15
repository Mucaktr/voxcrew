// FOLLOWUP — kalite kapısı ayarları: başarısız çıktının dış teslimini engelle (quality.gate_external block ↔ warn) ve
// AI denetçi varsayılanı (quality.reviewer.enabled). Yazma yalnızca kullanıcıdan (PUT /api/quality/settings; MCP 403).
import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../../lib/i18n";
import { qualityApi, type QualitySettings } from "../../lib/quality";
import { qualityMsg } from "../../locales/quality";
import { Panel, Toggle } from "../ui";

export function QualitySettingsPanel() {
  const t = useT(qualityMsg);
  const [s, setS] = useState<QualitySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    qualityApi.settings().then((v) => { if (alive) setS(v); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const save = async (patch: { block_on_fail?: boolean; reviewer?: boolean }) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { setS(await qualityApi.saveSettings(patch)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (!s || !s.enabled) return null;
  return (
    <Panel title={t("settings_title")} icon={<ShieldCheck size={16} aria-hidden />}>
      <div className="flex flex-col gap-2 pt-1">
        <Toggle checked={s.block_on_fail} onChange={(v) => { void save({ block_on_fail: v }); }}
          label={t("settings_block")} hint={t("settings_block_hint")} />
        <Toggle checked={!!s.reviewer?.enabled} onChange={(v) => { void save({ reviewer: v }); }}
          label={t("settings_reviewer")} hint={t("settings_reviewer_hint")} />
        {error && <p role="alert" className="text-sm text-bad">{t("settings_error", { error })}</p>}
      </div>
    </Panel>
  );
}
