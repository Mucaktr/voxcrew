// TRUST (S2) — yerel 18+ beyanı. İlk kurulum sihirbazının ilk ekranıdır ve daha önce kurulumu bitirmiş kurulumlarda bir
// kez sorulur. Yanıtlamadan kapatılamaz (Esc ve dış tıklama yok); "Devam" yalnız onay kutusu işaretliyken açılır.
// 18 altı yanıtı kimseyi dışarıda bırakmaz: sunucu güvenli modu açar, kısa ve dürüst bir not gösterilir.
// Yanıt yalnız yerel settings.json'a yazılır (/api/safe-mode/age); hiçbir yere gönderilmez, kimlik istenmez.
import { ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../lib/i18n";
import { safeModeApi, useSafeMode } from "../../lib/safeMode";
import { ageGate } from "../../lib/trust";
import { safetyMsg } from "../../locales/safety";
import { Button } from "../ui";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Kapatılamayan küçük diyalog: odak içeride döner, açılınca ilk öğeye gider. */
function LockedDialog({ title, describedBy, children }: { title: string; describedBy?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => { prev?.focus?.(); };
  }, []);
  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !box.current) return;
    const els = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/45 backdrop-blur-[2px]">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy} onKeyDown={trap}
        className="panel anim-rise w-full max-w-[520px] max-h-[92vh] overflow-y-auto p-5 flex flex-col gap-4">
        <h2 id={titleId} className="t-h3 flex items-center gap-2">
          <ShieldCheck size={20} className="shrink-0 text-ink-2" aria-hidden />{title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Yaş sorusu. `legacy`: kurulumu daha önce bitmiş kurulumlarda bir kerelik soru (kısa açıklama eklenir). */
export function AgeDialog({ legacy = false, onAnswered }: { legacy?: boolean; onAnswered: (adult: boolean) => void }) {
  const t = useT(safetyMsg);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const introId = useId();
  const gate = ageGate(null, checked);
  const answer = async (adult: boolean) => {
    setBusy(true);
    setError(null);
    try {
      useSafeMode.getState().set(await safeModeApi.age(adult));
      onAnswered(adult);
    } catch (e) {
      setError(t("age_error", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <LockedDialog title={legacy ? t("age_dialog_title") : t("age_title")} describedBy={introId}>
      <div id={introId} className="flex flex-col gap-2 text-sm text-ink-2">
        {legacy && <p>{t("age_dialog_intro")}</p>}
        <p>{t("age_intro")}</p>
      </div>
      <label className="flex items-start gap-3 cursor-pointer panel-soft p-3">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--grass)]" aria-label={t("age_check")} checked={checked}
          onChange={(e) => setChecked(e.target.checked)} />
        <span className="text-sm font-semibold">{t("age_check")}</span>
      </label>
      <p className="text-xs text-muted">{t("age_local")}</p>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" className="mr-auto" disabled={busy} onClick={() => { void answer(false); }}>{t("age_minor")}</Button>
        <Button variant="primary" disabled={!gate.canContinue || busy} onClick={() => { void answer(true); }}>
          {t("age_continue")}
        </Button>
      </div>
    </LockedDialog>
  );
}

/** 18 altı yanıtından sonra kısa, dürüst not (güvenli mod sunucuda zaten açıldı). */
export function MinorNotice({ onClose }: { onClose: () => void }) {
  const t = useT(safetyMsg);
  const textId = useId();
  return (
    <LockedDialog title={t("age_minor_title")} describedBy={textId}>
      <p id={textId} className="text-sm text-ink-2">{t("age_minor_text")}</p>
      <div className="flex justify-end">
        <Button variant="primary" onClick={onClose}>{t("age_minor_ok")}</Button>
      </div>
    </LockedDialog>
  );
}
