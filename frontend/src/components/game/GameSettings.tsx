// Ekip S5 — Oyunlaştırma ayarları (studio ayarı game.* + yaratıcı mod). Kapatınca hesap sürer, görünür katmanlar gizlenir.
import { useState } from "react";
import { useGame, type GameProfile, type GameSettingsPatch } from "../../lib/game";
import { useT } from "../../lib/i18n";
import { game as m, spotlight as S } from "../../locales/game";
import { Button, Toggle } from "../ui";
import { FunCheckToggle } from "../../full/ui";
import { GameDialog } from "./parts";

export function GameSettingsDialog({ profile, onClose }: { profile: GameProfile; onClose: () => void }) {
  const t = useT(m);
  const ts = useT(S);
  const save = useGame((s) => s.saveSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = async (patch: GameSettingsPatch) => {
    setBusy(true);
    setError(null);
    try { await save(patch); } catch (e) { setError(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  return (
    <GameDialog open onClose={onClose} title={t("settings_title")} width={520}
      footer={<Button variant="primary" onClick={onClose} data-autofocus>{t("ok")}</Button>}>
      <fieldset className="flex flex-col gap-4" disabled={busy} aria-busy={busy}>
        <Toggle checked={profile.enabled} onChange={(v) => set({ enabled: v })} label={t("s_enabled")} hint={t("s_enabled_hint")} />
        <Toggle checked={!!profile.focus} onChange={(v) => set({ focus: v })} label={ts("s_focus")} hint={ts("s_focus_hint")} />
        <Toggle checked={profile.celebrations} onChange={(v) => set({ celebrations: v })} label={t("s_celebrations")} hint={t("s_celebrations_hint")} />
        <Toggle checked={profile.sounds} onChange={(v) => set({ sounds: v })} label={t("s_sounds")} hint={t("s_sounds_hint")} />
        <Toggle checked={profile.show_world_badges} onChange={(v) => set({ show_world_badges: v })} label={t("s_badges")} hint={t("s_badges_hint")} />
        <Toggle checked={profile.creative} onChange={(v) => set({ creative: v })} label={t("s_creative")} hint={t("s_creative_hint")} />
        {/* G2-D R-3: isteğe bağlı haftalık "eğlenceli miydi?" sorusu (varsayılan kapalı, yalnız yerel) */}
        <FunCheckToggle />
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <p className="text-xs text-muted border-t-2 border-line-soft pt-3">{t("s_footer")}</p>
      </fieldset>
    </GameDialog>
  );
}
