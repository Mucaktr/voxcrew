// "Zip olarak indir": küçük onay penceresi (dosya sayısı/boyutu, pakete girmeyenler ve nedenleri, metin maskeli ↔
// maskelenmemiş seçimi). Önizleme sunucuda `dry_run` ile hesaplanır; indirme yalnızca bu pencerenin düğmesiyle başlar.
import { Archive, Download, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox, Modal, Spinner } from "../ui";
import { currentLocale, useT } from "../../lib/i18n";
import { downloadZip, zipPlan } from "../../lib/zipBundle";
import { formatBytes, groupSkipped, zipReasonKey, zipSummary, type ZipPlan, type ZipTarget } from "../../lib/zipFormat";
import { zipMsg as m } from "../../locales/zipBundle";

const SKIP_SHOWN = 6;  // her nedende en çok bu kadar ad; kalanı "+N"

export function ZipDialog({ target, open, onClose }: { target: ZipTarget; open: boolean; onClose: () => void }) {
  const t = useT(m);
  const [plan, setPlan] = useState<ZipPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [unmasked, setUnmasked] = useState(false);
  const key = JSON.stringify(target);

  const load = useCallback(() => {
    setPlan(null); setError(null); setDone(null);
    zipPlan(JSON.parse(key) as ZipTarget)
      .then(setPlan)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [key]);
  useEffect(() => { if (open) { setUnmasked(false); load(); } }, [open, load]);

  // maskesiz seçimi sayıyı değiştirebilir (maskelenemeyecek kadar büyük metin dosyaları): önizleme sessizce tazelenir
  const changeUnmasked = (v: boolean) => {
    setUnmasked(v);
    zipPlan(JSON.parse(key) as ZipTarget, v).then(setPlan).catch(() => undefined);
  };
  const sum = zipSummary(plan);
  const download = async () => {
    setBusy(true); setError(null);
    const err = await downloadZip(target, unmasked);
    setBusy(false);
    if (err) setError(err); else setDone(sum.count);
  };
  const lang = currentLocale() === "en" ? "en" : "tr";
  const groups = plan ? groupSkipped(plan.skipped) : [];

  return (
    <Modal open={open} onClose={onClose} title={t("zip_title")} width={520}
      footer={<>
        <Button onClick={onClose}>{done !== null ? t("zip_close") : t("zip_cancel")}</Button>
        {done === null && (
          <Button variant="primary" icon={<Download size={15} />} disabled={!plan || sum.empty || busy} onClick={() => { void download(); }}>
            {busy ? t("zip_downloading") : t("zip_download")}
          </Button>
        )}
      </>}>
      <div className="flex flex-col gap-3 text-sm min-w-0">
        {!plan && !error && <div className="grid place-items-center py-6" role="status" aria-label={t("zip_loading")}><Spinner size={20} /></div>}
        {plan && (
          <>
            <p className="font-semibold num" role="status">
              {sum.empty ? t("zip_empty") : t("zip_count", { n: sum.count, size: formatBytes(sum.bytes, lang) })}
            </p>
            <p className="text-muted">{t("zip_from_vault")}</p>
            {sum.hasText && (
              <div className="flex flex-col gap-2">
                <p className="text-muted">{t("zip_masked_note")}</p>
                <Checkbox checked={unmasked} onChange={changeUnmasked} disabled={busy || done !== null} label={t("zip_unmasked_label")} />
                {unmasked && (
                  <p role="status" className="text-xs text-warn flex items-start gap-1 break-words">
                    <TriangleAlert size={13} aria-hidden className="mt-0.5 shrink-0" />{t("zip_unmasked_warn")}
                  </p>
                )}
              </div>
            )}
            {plan.merged > 0 && <p className="text-xs text-muted">{t("zip_merged", { n: plan.merged })}</p>}
            {groups.length > 0 && (
              <section aria-label={t("zip_skipped_title", { n: plan.skipped.length })} className="flex flex-col gap-1.5 min-w-0">
                <h3 className="font-semibold text-warn flex items-center gap-1">
                  <TriangleAlert size={14} aria-hidden />{t("zip_skipped_title", { n: plan.skipped.length })}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {groups.map((g) => (
                    <li key={g.reason} className="min-w-0">
                      <span className="font-medium">{t(zipReasonKey(g.reason) as "zip_r_other")}</span>
                      <span className="text-xs text-muted break-all block">
                        {g.names.slice(0, SKIP_SHOWN).join(", ")}{g.names.length > SKIP_SHOWN ? ` +${g.names.length - SKIP_SHOWN}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        {error && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="font-semibold text-bad break-words">{error}</p>
            <div><Button size="sm" onClick={load}>{t("zip_retry")}</Button></div>
          </div>
        )}
        {done !== null && <p role="status" className="font-semibold text-ok">{t("zip_done", { n: done })}</p>}
      </div>
    </Modal>
  );
}

/** "Zip olarak indir" düğmesi + onay penceresi. */
export function ZipButton({ target, size = "sm", variant }: { target: ZipTarget; size?: "sm"; variant?: "default" | "ghost" | "primary" }) {
  const t = useT(m);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} icon={<Archive size={14} />} aria-haspopup="dialog"
        onClick={() => setOpen(true)}>{t("zip_button")}</Button>
      <ZipDialog target={target} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
