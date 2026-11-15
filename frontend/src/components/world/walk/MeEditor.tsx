/**
 * W5 (WALK-W5) — "Ben" avatar editörü ( A). Tembel yüklenir (WalkHud / WorldPage).
 *
 * Ajan editörünün (`AvatarEditor`) aynısı: parçalar, kıyafetler, şapka, saç, gözlük; kilitli kozmetik ajanlardaki kuralla
 * (oyun envanteri) gösterilir ve tıklanınca açılma yolu (mağaza fiyatı / seviye) satın alma penceresinde görünür. Ayırt edici
 * yaka kartı her zaman takılıdır (parts.ts `badge`), seçilmez. Ad isteğe bağlı (boşsa "Ben").
 *
 * Kaydet: `PUT /api/walk/avatar` (kullanıcı-yalnız; kilit ve doğrulama sunucuda), başarılıysa yerel önbellek. Sunucuya
 * ulaşılamazsa yalnız bu tarayıcıda saklanır ve bu söylenir. Avatar ajan değildir: XP, sıralama, ödül yok.
*/
import { BadgeCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { AvatarEditor } from "../../AvatarEditor";
import { Button, Modal } from "../../ui";
import { useT } from "../../../lib/i18n";
import type { Avatar } from "../../../lib/types";
import { walk as WM } from "../../../locales/walk";
import { loadMeLook, MeSaveError, saveMeLook, useMeLook } from "../../../voxel/walk/me";
import { useWalkStore } from "../../../voxel/walk/walkStore";
import { announceWalk } from "./announce";

export default function MeEditor({ onClosed }: { onClosed?: () => void }) {
  const t = useT(WM);
  const look = useMeLook();
  const [avatar, setAvatarRaw] = useState<Avatar>(look.avatar);
  const [name, setNameRaw] = useState(look.name);
  const touched = useRef(false);
  const setAvatar = (a: Avatar) => { touched.current = true; setAvatarRaw(a); };
  const setName = (n: string) => { touched.current = true; setNameRaw(n); };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameId = useId();
  const errId = useId();
  // sunucudaki kayıt bu oturumda henüz okunmadıysa okunur; kullanıcı henüz bir şey değiştirmediyse taslak güncellenir
  useEffect(() => {
    const off = useMeLook.subscribe((s) => { if (!touched.current) { setAvatarRaw(s.avatar); setNameRaw(s.name); } });
    void loadMeLook();
    return off;
  }, []);
  const close = () => { useWalkStore.getState().setEditor(false); onClosed?.(); };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await saveMeLook(avatar, name);
      announceWalk(r.offline ? t("me_saved_offline") : t("me_saved"));
      close();
    } catch (e) {
      setErr(e instanceof MeSaveError ? e.message : t("me_save_failed"));
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={close} width={720} title={<span className="flex items-center gap-2"><BadgeCheck size={18} aria-hidden="true" className="text-ink-2" />{t("me_title")}</span>}
      footer={<>
        <Button variant="ghost" onClick={close}>{t("me_cancel")}</Button>
        <Button variant="primary" onClick={() => void save()} disabled={busy} aria-describedby={err ? errId : undefined}>{busy ? t("me_saving") : t("me_save")}</Button>
      </>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">{t("me_intro")}</p>
        <label htmlFor={nameId} className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">{t("me_name")}</span>
          <input id={nameId} className="input max-w-xs" value={name} maxLength={24} placeholder={t("me_default")} autoComplete="off"
            onChange={(e) => setName(e.target.value)} />
          <span className="text-xs text-muted">{t("me_name_hint")}</span>
        </label>
        <AvatarEditor value={avatar} onChange={setAvatar} />
        <p className="text-xs text-muted">{t("me_badge_note")}</p>
        {err && <p id={errId} role="alert" className="text-sm text-bad font-semibold">{err}</p>}
      </div>
    </Modal>
  );
}
