// DEPO-TESLIM — PDF / ses / video önizlemesi. Bayt, kullanıcı-yalnız POST `/api/deliverables/{id}/view` ile alınır
// (kasa kopyası, maskelenmemiş ikili; jeton + çerez + Origin) ve `blob:` URL'sine çevrilir: tarayıcının `<audio src>` /
// `<iframe src>` istekleri sayfa jetonunu taşıyamaz. Tür iki yerde doğrulanır: sunucu (sihirli bayt + MIME tablosu) ve
// `fetchViewBlob` (tam MIME eşleşmesi; blob doğrulanmış türle yeniden sarılır). PDF iframe'i SANDBOX'SIZDIR: Chromium'un PDF
// görüntüleyicisi sandbox'lı iframe'de açılmaz. Kalan risk bilinçli: `blob:` kökeni uygulamayla aynıdır; ama içerik yalnızca
// doğrulanmış PDF'tir (PDF motoru tarayıcının kendi sandbox'lı işleminde çalışır, sayfa DOM'una erişemez). Giriş sınırı: `AUTO_LOAD_MAX_BYTES`
// altı otomatik yüklenir, üstü düğmeyle; sunucu sınırını (`view_max`) aşan dosya hiç istenmez.
import { Download, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Spinner } from "../../ui";
import { ViewTypeError, fetchViewBlob } from "../../../lib/deliverables";
import { AUTO_LOAD_MAX_BYTES } from "../../../lib/deliveryViewers";
import { useT } from "../../../lib/i18n";
import { deliverablesMsg as m } from "../../../locales/deliverables";

type Phase = "idle" | "loading" | "ready" | "error";

export function MediaView({ id, title, view, size, sizeLabel, maxLabel, max }: {
  id: string; title: string; view: "pdf" | "audio" | "video"; size?: number | null;
  /** biçimlendirilmiş boyut / sınır (boyut biçimleyicisi görüntüleyici dosyasında; döngüsel içe aktarma olmasın) */
  sizeLabel: string; maxLabel: string; max?: number;
}) {
  const t = useT(m);
  const tooBig = !!max && !!size && size > max;
  const auto = !tooBig && (size == null || size <= AUTO_LOAD_MAX_BYTES);
  const [phase, setPhase] = useState<Phase>("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [badType, setBadType] = useState(false);  // beklenmeyen tür (415) → yerelleştirilmiş ileti, ham MIME değil
  const live = useRef(0);  // yarış koruması: yalnız son istek sonucu uygulanır

  const release = useCallback(() => {
    setUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
  }, []);

  const load = useCallback(() => {
    const ticket = ++live.current;
    release();
    setPhase("loading"); setError(null); setBadType(false);
    fetchViewBlob(id, view).then((blob) => {
      if (ticket !== live.current) return;
      setUrl(URL.createObjectURL(blob));
      setPhase("ready");
    }).catch((e: unknown) => {
      if (ticket !== live.current) return;
      setBadType(e instanceof ViewTypeError);
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    });
  }, [id, view, release]);

  useEffect(() => {
    setPhase("idle"); setError(null);
    if (auto) load();
    return () => { live.current += 1; release(); };
  }, [id, auto, load, release]);

  if (tooBig) {
    return <p role="status" className="text-sm text-warn break-words">{t("media_too_big", { size: sizeLabel, max: maxLabel })}</p>;
  }
  return (
    <div className="flex flex-col gap-2 min-w-0" data-media-view={view}>
      {phase === "idle" && (
        <div>
          <Button size="sm" icon={<Download size={14} />} onClick={load}>{t("media_load", { size: sizeLabel })}</Button>
        </div>
      )}
      {phase === "loading" && (
        <div role="status" className="flex items-center gap-2 text-sm text-muted py-6 justify-center">
          <Spinner size={18} />{t("media_loading")}
        </div>
      )}
      {phase === "error" && (
        <div className="flex flex-col gap-2 items-start">
          <p role="alert" className="text-sm text-bad break-words">{badType ? t("media_bad_type") : t("media_error", { error: error ?? "" })}</p>
          <Button size="sm" icon={<RefreshCcw size={14} />} onClick={load}>{t("media_retry")}</Button>
        </div>
      )}
      {phase === "ready" && url && view === "pdf" && (
        // sandbox YOK (bkz. dosya başı)
        <iframe title={t("pdf_title", { title })} src={url} referrerPolicy="no-referrer"
          className="w-full h-[70vh] min-h-[360px] rounded-lg border-2 border-line bg-white" />
      )}
      {phase === "ready" && url && view === "audio" && (
        <audio controls preload="metadata" src={url} aria-label={t("audio_label", { title })} className="w-full">
          {t("media_fallback")}
        </audio>
      )}
      {phase === "ready" && url && view === "video" && (
        <video controls playsInline preload="metadata" src={url} aria-label={t("video_label", { title })}
          className="max-w-full max-h-[70vh] rounded-lg border-2 border-line bg-black">
          {t("media_fallback")}
        </video>
      )}
      <p className="text-xs text-muted" data-noprint>{t("media_note")}</p>
    </div>
  );
}
