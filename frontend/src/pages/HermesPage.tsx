// Ekip S1: Hermes yetenekleri — Skill kütüphanesi, Araç setleri, Profiller (SOUL/bellek/oturum/cron), Değişiklik geçmişi.
import { FolderOpen, RefreshCcw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { HermesStatus } from "../components/connections/HermesStatus";
import { ChangeHistory } from "../components/hermes/ChangeHistory";
import { LoadingBlock, Note, Rich, useLoad } from "../components/hermes/common";
import { ProfilesView } from "../components/hermes/ProfilesView";
import { SkillLibrary } from "../components/hermes/SkillLibrary";
import { ToolsetsView } from "../components/hermes/ToolsetsView";
import { Badge, Button, PageHeader, TabPanel, Tabs } from "../components/ui";
import { refreshConnections } from "../lib/connections";
import { hermesApi } from "../lib/hermes";
import { tp, tx, useT } from "../lib/i18n";
import { cx } from "../locales/connections";
import { hermesMsg as m } from "../locales/hermes";

type Tab = "skiller" | "arac-setleri" | "profiller" | "gecmis" | "kurulum";
const TABS: { value: Tab; label: string }[] = [
  { value: "skiller", get label() { return tx(m, "tab_skills"); } },
  { value: "arac-setleri", get label() { return tx(m, "tab_toolsets"); } },
  { value: "profiller", get label() { return tx(m, "tab_profiles"); } },
  { value: "gecmis", get label() { return tx(m, "tab_history"); } },
  // S29: kurulum, Hermes klasörü ve API sunucusu — Bağlantılar ile aynı kaynak ve bileşenler
  { value: "kurulum", get label() { return tx(cx, "setup_tab"); } },
];
/** S29 overview durum alanları (lib/hermes.ts türünde henüz yok). */
type OverviewStatus = { status?: "ok" | "empty" | "not_found" | "error"; error?: string | null };

export default function HermesPage() {
  const t = useT(m);
  const { tab: rawTab } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab: Tab = TABS.some((x) => x.value === rawTab) ? (rawTab as Tab) : "skiller";
  const { data, error, loading, reload: reloadOverview } = useLoad(() => hermesApi.overview(), []);
  // Yenile: overview + tek bağlantı durumu birlikte (iki ekran aynı gerçeği görsün)
  const reload = () => { reloadOverview(); void refreshConnections(true).catch(() => undefined); };
  const status = (data as (typeof data & OverviewStatus) | null)?.status
    ?? (data ? (!data.exists ? "not_found" : data.profiles.length === 0 ? "empty" : "ok") : undefined);
  const statusError = (data as (typeof data & OverviewStatus) | null)?.error ?? null;
  const profiles = data?.profiles ?? [];
  const wanted = params.get("profil");
  const [profile, setProfile] = useState<string>(wanted ?? "default");
  const edit = params.get("duzenle");
  const tabsId = useId();

  useEffect(() => {
    if (!profiles.length) return;
    if (!profiles.some((p) => p.name === profile)) setProfile(profiles.find((p) => p.name === "default")?.name ?? profiles[0].name);
  }, [profiles, profile]);
  useEffect(() => { if (wanted) setProfile(wanted); }, [wanted]);

  const pickProfile = (p: string) => {
    setProfile(p);
    const next = new URLSearchParams(params);
    next.set("profil", p);
    next.delete("duzenle");
    setParams(next, { replace: true });
  };

  return (
    <div className="p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      <PageHeader title={t("page_title")}
        subtitle={t("page_subtitle")}
        meta={data && <>
          {data.version && <Badge tone="info">Hermes {data.version}</Badge>}
          <Badge>{tp(m, "n_profiles", profiles.length)}</Badge>
          <Badge title={data.home} className="max-w-full"><FolderOpen size={12} /><span className="font-mono truncate max-w-[16rem]">{data.home}</span></Badge>
          {data.registry === "yerleşik" && <Badge tone="warn">{t("registry_builtin")}</Badge>}
        </>}
        actions={<Button icon={<RefreshCcw size={15} />} onClick={reload}>{t("refresh")}</Button>} />

      <div className="panel overflow-hidden">
        <Tabs id={tabsId} value={tab} onChange={(v) => navigate(`/hermes/${v}${params.toString() ? `?${params.toString()}` : ""}`)} tabs={TABS} />
        <TabPanel tabs={tabsId} value={tab} className="p-3 sm:p-5">
          {tab === "gecmis" ? <ChangeHistory /> : tab === "kurulum" ? (
            <HermesStatus overviewError={error ?? statusError} onRetry={reload} home={data?.home} />
          ) : (
            <>
              {/* istek hatası ≠ "bulunamadı": durum bölümü "kontrol edilemedi — yeniden dene" gösterir */}
              {error && <HermesStatus overviewError={error} onRetry={reload} home={data?.home} showGateway={false} />}
              {loading && !data ? <LoadingBlock label={t("reading_folder")} /> : data && (
                status !== "ok" ? (
                  <HermesStatus overviewError={status === "error" ? statusError : null} onRetry={reload} home={data.home}
                    showGateway={false} empty={status === "empty"} />
                ) : (
                  <>
                    {tab === "skiller" && <SkillLibrary profiles={profiles} profile={profile} onProfile={pickProfile} />}
                    {tab === "arac-setleri" && <ToolsetsView profiles={profiles} profile={profile} onProfile={pickProfile} />}
                    {tab === "profiller" && (
                      <ProfilesView profiles={profiles} profile={profile} onProfile={pickProfile} onReload={reload}
                        initialEdit={edit === "soul" ? "soul" : edit === "bellek" ? "memory" : null} />
                    )}
                  </>
                )
              )}
            </>
          )}
        </TabPanel>
      </div>
      <Note tone="muted">
        <Rich text={t("page_footer")} parts={{ history: <i>{t("history_name")}</i> }} />
      </Note>
    </div>
  );
}
