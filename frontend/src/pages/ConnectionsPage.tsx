// Bağlantılar (S29): tek bağlantı durumu modelinden beslenen sihirbaz kartları, model hazırlığı (Modelfile yok),
// Hermes API sunucusu ve ayarlar. Kartlar sihirbazla ve Hermes sayfasıyla aynı bileşenlerdir (components/connections).
import { HardDrive, Plus, Settings as SettingsIcon } from "lucide-react";
import { useEffect } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { ConnectionWizard } from "../components/connections/ConnectionWizard";
import { InstalledModels } from "../components/connections/InstalledModels";
import { ModelPolicyPanel } from "../components/connections/ModelPolicyPanel";
import { SafeModePanel } from "../components/safety/SafeModePanel"; // TRUST: güvenli mod ön ayarı
import { ExportEverything } from "../components/plan/ExportEverything"; // hepsini dışa aktar
import { ModelSetup } from "../components/connections/ModelSetup";
import { GatewayPanel } from "../components/gateway/GatewayPanel";
import { McpServersPanel } from "../components/tools/McpServersPanel";
import { McpCatalogPanel } from "../components/connections/McpCatalogPanel"; // CG2: MCP bağlayıcı kataloğu
import { SecretsCorruptBanner } from "../components/connections/SecretsCorruptBanner";
import { Button, DeferMount, PageHeader, Panel } from "../components/ui";
import { useT } from "../lib/i18n";
import { useStudio } from "../lib/store";
import { cx } from "../locales/connections";

// UXF-A: sayfa başında "Bu sayfada" atlama çubuğu. UXF-E: uygulama ayarları artık kendi sayfasında (`/ayarlar`, menüde
// "Ayarlar"); çubukta oraya bağlantı durur ve eski `/baglantilar#ayarlar` / `#takdir-ayarlari` derin bağlantıları yönlenir.
const JUMPS = [
  { id: "baglantilar-kartlar", key: "jump_conn" },
  { id: "modeller", key: "jump_models" },
  { id: "guvenlik", key: "jump_safety" },
] as const;
function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "start" });
  el.focus({ preventScroll: true });
}

export default function ConnectionsPage() {
  const t = useT(cx);
  const models = useStudio((s) => s.models);
  // SETUP: "Model ekle" → ?ekle=model (aynı derin bağlantı kenar çubuğu / ajan beyin seçicisinden de gelir)
  const [, setParams] = useSearchParams();
  const { hash } = useLocation();
  const toSettings = hash === "#ayarlar" || hash === "#takdir-ayarlari";
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1));
    if (JUMPS.some((j) => j.id === id)) requestAnimationFrame(() => jumpTo(id));
  }, [hash]);

  if (toSettings) return <Navigate to={`/ayarlar${hash === "#takdir-ayarlari" ? hash : ""}`} replace />;
  return (
    <div className="p-3 sm:p-5 flex flex-col gap-4 max-w-[1500px] mx-auto">
      <PageHeader title={t("page_title")} subtitle={t("subtitle")} actions={
        <Button variant="primary" icon={<Plus size={15} />} aria-label={t("add_model_aria")} onClick={() => setParams({ ekle: "model" })}>
          {t("add_model")}
        </Button>
      } />

      <SecretsCorruptBanner />

      <nav aria-label={t("jump_label")} className="flex flex-wrap items-center gap-1.5 -mt-1">
        <span className="text-xs font-semibold text-muted mr-1">{t("jump_label")}:</span>
        {JUMPS.map((j) => (
          <a key={j.id} href={`#${j.id}`} className="chip min-h-11 sm:min-h-9 hover:border-ink-2"
            onClick={(e) => { e.preventDefault(); jumpTo(j.id); }}>{t(j.key)}</a>
        ))}
        <Link to="/ayarlar" className="chip min-h-11 sm:min-h-9 hover:border-ink-2"><SettingsIcon size={14} aria-hidden />{t("jump_settings")}</Link>
      </nav>

      <div id="baglantilar-kartlar" tabIndex={-1} className="scroll-mt-4 focus:outline-none"><ConnectionWizard intro={false} view="summary" /></div>

      <div id="modeller" tabIndex={-1} className="scroll-mt-4 focus:outline-none">
      <Panel title={t("models_title")} icon={<HardDrive size={16} />}>
        <ModelSetup />
        <InstalledModels models={models} />
      </Panel>
      </div>

      {/* S37: model erişim politikası (yalnız yerel / izin listesi / onaylar) */}
      <div id="guvenlik" tabIndex={-1} className="scroll-mt-4 focus:outline-none flex flex-col gap-4">
        <ModelPolicyPanel />
        <SafeModePanel />
      </div>

      {/* ekranın altındaki dört ağır panel görünmeye yaklaşınca bağlanır*/}
      <DeferMount minHeight={200}><ExportEverything /></DeferMount>

      <DeferMount minHeight={300}><GatewayPanel /></DeferMount>

      {/* CG2: MCP bağlayıcı kataloğu (komut göster → değişiklik servisiyle ekle) */}
      <DeferMount minHeight={400}><McpCatalogPanel /></DeferMount>

      <DeferMount minHeight={300}><McpServersPanel /></DeferMount>

      {/* UXF-E: uygulama ayarları, dil, tema, yönetici modu ve güvenli mod kendi sayfasında*/}
      <Panel title={t("settings_title")} icon={<SettingsIcon size={16} />}>
        <p className="text-sm text-ink-2">{t("settings_text")}</p>
        <Link to="/ayarlar" className="btn btn-primary self-start min-h-11">{t("settings_open")}</Link>
      </Panel>
    </div>
  );
}
