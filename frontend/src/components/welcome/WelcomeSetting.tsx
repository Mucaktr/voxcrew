/**
 * "Şehir girişinde hoş geldin kartı" ayarı (Görünüm menüsüne tek satır: `<WelcomeSetting />`). Kapalıyken kart hiç
 * açılmaz; açınca yalnız henüz görülmemiş şehirlerde bir kez açılır. Ayar bu tarayıcıda saklanır (`welcomeStore`).
*/
import { Toggle } from "../ui";
import { useT } from "../../lib/i18n";
import { welcome as WM } from "../../locales/welcome";
import { setWelcomeEnabled, useWelcome } from "./welcomeStore";

export function WelcomeSetting() {
  const t = useT(WM);
  const on = useWelcome((s) => s.enabled);
  return <Toggle checked={on} onChange={setWelcomeEnabled} label={t("setting")} hint={t("setting_hint")} />;
}
