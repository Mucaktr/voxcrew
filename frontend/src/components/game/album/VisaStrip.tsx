/**
 * W4 (WALK-GAME-UI) — pasaport şeridinde damgaların yanında ayrı "Vizeler" bölümü: simge keşfiyle kazanılan vize sayısı,
 * vizelerin şehir AÇMADIĞI notu ve albüme bağlantı.
*/
import { Stamp } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../../lib/i18n";
import { ensureWalkProgress, useWalkProgress } from "../../../lib/walk";
import { walk as WM } from "../../../locales/walk";

export function VisaStrip() {
  const t = useT(WM);
  const n = useWalkProgress((s) => s.visas.size);
  useEffect(() => { void ensureWalkProgress(); }, []);
  return (
    <section aria-label={t("visas_section")} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-line-soft pt-2">
      <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5"><Stamp size={14} aria-hidden="true" className="text-info" />{t("visas_section")}</h3>
      <span className="chip tone-info num text-xs">{t("visas_count", { n })}</span>
      <Link to="/basarilar/album" className="text-xs underline text-link">{t("visas_open_album")}</Link>
      <p className="text-xs text-muted w-full">{t("album_visas_note")}</p>
    </section>
  );
}
