// Ekip S5 (Oyunlaştırma) — /basarilar/:tab → kariyer | kupalar | gorevler | magaza
import { Building2, Settings2, Trophy } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { CareerView } from "../components/game/CareerView";
import { GameSettingsDialog } from "../components/game/GameSettings";
import { CoinAmount } from "../components/game/parts";
import { QuestBoard } from "../components/game/QuestBoard";
import { ShopView } from "../components/game/ShopView";
import { TrophyRoom } from "../components/game/TrophyRoom";
import { Badge, Button, Empty, PageHeader, Panel, Spinner, TabPanel, Tabs, Toggle } from "../components/ui";
import { ensureGameLoaded, useGame } from "../lib/game";
import { tp, tx, useT } from "../lib/i18n";
import { isUserAchievements } from "../lib/navModel";
import { shell } from "../locales/shell";
import { game as m, season as SM } from "../locales/game";
import { SeasonTrack } from "../components/game/SeasonTrack";
import { walk as WM } from "../locales/walk";
import { AlbumView } from "../components/game/album/AlbumView";

// W4: "album" — hatıralar, vizeler ve mini oyun kartları (components/game/album)
// "sezon" — sezon yolu (components/game/SeasonTrack)
type Tab = "kariyer" | "kupalar" | "gorevler" | "sezon" | "album" | "magaza";
const TABS: { value: Tab; key: "tab_career" | "tab_trophies" | "tab_quests" | "tab_shop" | "album" | "season" }[] = [
  { value: "kariyer", key: "tab_career" },
  { value: "kupalar", key: "tab_trophies" },
  { value: "gorevler", key: "tab_quests" },
  { value: "sezon", key: "season" },
  { value: "album", key: "album" },
  { value: "magaza", key: "tab_shop" },
];

export default function AchievementsPage() {
  const t = useT(m);
  const tw = useT(WM);
  const ts = useT(SM);
  const label = (k: (typeof TABS)[number]["key"]) => (k === "album" ? tw("album_tab") : k === "season" ? ts("season_tab") : t(k));
  const { tab: rawTab } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tab: Tab = TABS.some((x) => x.value === rawTab) ? (rawTab as Tab) : "kariyer";
  const profile = useGame((s) => s.profile);
  const loaded = useGame((s) => s.loaded);
  const error = useGame((s) => s.error);
  const saveSettings = useGame((s) => s.saveSettings);
  const [settings, setSettings] = useState(false);
  const tabsId = useId();

  useEffect(() => { void ensureGameLoaded(); }, []);

  const tabs = TABS.map((x) => ({
    value: x.value,
    label: x.value === "gorevler" && profile?.quests_ready
      ? <>{label(x.key)}<span className="chip tone-warn !px-1.5 num" aria-label={tp(m, "rewards_ready", profile.quests_ready)}>{profile.quests_ready}</span></>
      : x.value === "kupalar" && profile?.unseen
        ? <>{label(x.key)}<span className="chip tone-info !px-1.5 num" aria-label={tp(m, "new_achievements", profile.unseen)}>{profile.unseen}</span></>
        : label(x.key),
  }));

  return (
    <div className="p-3 sm:p-5 max-w-[1500px] mx-auto flex flex-col gap-4">
      {/* başlık, menüde bu sekmenin açtığı öğenin adıyla aynı (kariyer sekmeleri "Ajan kariyerleri", kupalar "Başarılar")*/}
      <PageHeader title={isUserAchievements(pathname) ? t("page_title") : tx(shell, "nav_agent_careers")}
        subtitle={t("page_subtitle")}
        meta={profile?.enabled && <>
          <Badge tone="ok"><Building2 size={12} />{t("office_lv", { n: profile.office.level })}</Badge>
          <Badge><CoinAmount value={profile.coins} /></Badge>
          <Badge tone="info"><Trophy size={12} />{t("achievements_count", { earned: profile.achievements.earned, total: profile.achievements.total })}</Badge>
        </>}
        actions={profile && <Button icon={<Settings2 size={15} />} onClick={() => setSettings(true)}>{t("settings")}</Button>} />

      {!loaded ? (
        <div className="grid place-items-center py-16"><Spinner size={24} /></div>
      ) : !profile ? (
        <Panel><Empty icon={<Trophy size={28} />} title={t("load_error_title")} text={error ?? undefined} /></Panel>
      ) : !profile.enabled ? (
        <Panel>
          <Empty icon={<Trophy size={28} />} title={t("disabled_title")}
            text={t("disabled_text")}
            action={<Toggle checked={false} onChange={(v) => { void saveSettings({ enabled: v }); }} label={t("enable_label")} />} />
        </Panel>
      ) : (
        <div className="panel overflow-hidden">
          <Tabs id={tabsId} value={tab} onChange={(x) => navigate(`/basarilar/${x}`)} tabs={tabs} label={t("tabs_label")} />
          <TabPanel tabs={tabsId} value={tab} label={label(TABS.find((x) => x.value === tab)?.key ?? "tab_career")} className="p-3 sm:p-5">
            {tab === "kariyer" && <CareerView profile={profile} />}
            {tab === "kupalar" && <TrophyRoom />}
            {tab === "gorevler" && <QuestBoard />}
            {tab === "sezon" && <SeasonTrack />}
            {tab === "album" && <AlbumView />}
            {tab === "magaza" && <ShopView />}
          </TabPanel>
        </div>
      )}
      {settings && profile && <GameSettingsDialog profile={profile} onClose={() => setSettings(false)} />}
    </div>
  );
}
