// STALE-DIST — sunulan arayüz derlemesi kaynak koddan eskiyse kapatılabilir uyarı bandı (her sayfada, üstte).
// Sunucu açılışta da konsola yazar; bant, tarayıcıda "yeni özellik görünmüyor" durumunu kaçırılmaz kılar.
// Kapatma bu derleme + kaynak çifti için hatırlanır (localStorage, try/catch); kaynak ilerleyince bant yeniden çıkar.
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { DISMISS_STORAGE_KEY, dismissKey, parseBuildMeta, rebuildCommand, showStaleBanner, type BuildMeta } from "../lib/buildInfo";
import { currentLocale, tp, useLocale, useT } from "../lib/i18n";
import { buildInfoMsg } from "../locales/buildInfo";
import { Button } from "./ui";

function readDismissed(): string | null {
  try { return localStorage.getItem(DISMISS_STORAGE_KEY); } catch { return null; }
}

export function StaleBuildBanner() {
  const t = useT(buildInfoMsg);
  useLocale((s) => s.locale); // tp() dil değişince yeniden çizilsin
  const [meta, setMeta] = useState<BuildMeta | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  useEffect(() => {
    if (import.meta.env.DEV) return; // Vite geliştirme sunucusu kaynaktan canlı sunar; dist eskiliği burada anlamsız
    let alive = true;
    const load = () => {
      fetch("/api/meta/build", { headers: { "X-Studio-Lang": currentLocale() } })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (alive) setMeta(parseBuildMeta(j)); })
        .catch(() => undefined);
    };
    load();
    window.addEventListener("focus", load);
    return () => { alive = false; window.removeEventListener("focus", load); };
  }, []);

  if (!showStaleBanner(meta, { dev: import.meta.env.DEV, dismissed }) || !meta) return null;

  const dismiss = () => {
    const key = dismissKey(meta);
    try { localStorage.setItem(DISMISS_STORAGE_KEY, key); } catch { /* gizli pencere: yalnız bu oturumda kapanır */ }
    setDismissed(key);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === "Escape") { e.stopPropagation(); dismiss(); } };
  const cmd = rebuildCommand(typeof navigator !== "undefined" ? navigator.userAgent : "");

  return (
    <div role="status" aria-live="polite" onKeyDown={onKey}
      className="panel tone-warn anim-rise fixed z-[44] inset-x-2 top-16 lg:top-3 lg:left-64 lg:right-4 mx-auto max-w-2xl p-3 flex items-start gap-2.5">
      <AlertTriangle size={18} aria-hidden className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1 flex flex-col gap-1 text-sm">
        <span className="font-semibold break-words">{t("text")}</span>
        <span className="break-words">
          {t("how")} <code className="font-mono font-semibold whitespace-nowrap">{cmd}</code>
        </span>
        {meta.behind != null && meta.behind > 0 && (
          <span className="text-xs break-words">{tp(buildInfoMsg, "behind", meta.behind)}</span>
        )}
      </div>
      <Button size="sm" variant="ghost" icon={<X size={14} />} aria-label={t("dismiss")} title={t("dismiss")} onClick={dismiss} />
    </div>
  );
}
