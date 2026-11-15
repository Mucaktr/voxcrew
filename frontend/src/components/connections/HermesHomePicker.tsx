// S29 — Hermes klasörü seçici: bulunan adaylar (kaynak, profiller, çalıştırıcı) + özel yol. Stüdyo AYARI yazılır.
// Önizle → onayla: bir klasör seçilince önce sunucudan yazmadan önizleme alınır (ayar: eski → yeni; Hermes klasörüne
// yazılmaz), kullanıcı "Onayla" deyince ayar kaydedilir. `suggest`: karttaki "Bu klasörü kullan" önerisi (önizleme açık gelir).
import { Check, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { connectionsApi, publishOne, refreshConnections, type HermesCandidate, type HermesHomePreview } from "../../lib/connections";
import { useT } from "../../lib/i18n";
import { cx } from "../../locales/connections";
import { Badge, Button, Spinner } from "../ui";

export function HermesHomePicker({ onDone, suggest }: { onDone?: () => void; suggest?: string }) {
  const t = useT(cx);
  const [data, setData] = useState<{ candidates: HermesCandidate[]; current: string; wsl: { note: string } | null; env_locked: boolean } | null>(null);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<HermesHomePreview | null>(null);
  const suggested = useRef(false);

  useEffect(() => { connectionsApi.hermesCandidates().then(setData).catch((e) => setError(String(e))); }, []);

  const ask = async (path: string) => {
    setBusy(path); setError(null); setSaved(false); setPreview(null);
    try { setPreview((await connectionsApi.previewHermesHome(path)).preview); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  useEffect(() => {
    if (!suggest || suggested.current || !data || data.env_locked) return;
    suggested.current = true;
    void ask(suggest);
  }, [suggest, data]);

  const confirm = async () => {
    if (!preview) return;
    const path = preview.to;
    setBusy(path); setError(null);
    try {
      publishOne((await connectionsApi.setHermesHome(path)).state);
      await refreshConnections(true);
      setPreview(null);
      setSaved(true);
      onDone?.();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  if (!data) return error ? <p role="alert" className="text-sm text-bad">{error}</p> : <Spinner />;
  const sourceLabel = (s: string) => t(`home_source_${s}` as "home_source_setting");
  const found = data.candidates.filter((c) => c.exists);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">{t("home_current")}: <span className="font-mono break-all">{data.current}</span></p>
      {data.env_locked && <p className="text-sm text-warn">{t("home_env_locked")}</p>}
      {found.length === 0 ? <p className="text-sm text-ink-2">{t("home_none")}</p> : (
        <ul className="flex flex-col gap-2" aria-label={t("home_candidates")}>
          {found.map((c) => {
            const isCurrent = c.sources.includes("setting");
            return (
              <li key={c.path} className="panel-soft p-3 flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
                <FolderOpen size={16} className="shrink-0 text-muted hidden sm:block" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs break-all">{c.path}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.sources.map((s) => <Badge key={s}>{sourceLabel(s)}</Badge>)}
                    {c.recommended && <Badge tone="ok">{t("rec_recommended")}</Badge>}
                    {c.version && <Badge tone="info">{c.version}</Badge>}
                    {c.looks_like_home && <Badge>{t("home_profiles", { n: c.profiles.length + 1 })}</Badge>}
                    {!c.runner && <Badge tone="warn">{t("home_runner_missing")}</Badge>}
                  </div>
                </div>
                <Button size="sm" variant={c.recommended && !isCurrent ? "primary" : "default"} disabled={!!busy || data.env_locked || isCurrent}
                  icon={busy === c.path ? <Spinner size={13} /> : isCurrent ? <Check size={13} /> : undefined} onClick={() => ask(c.path)}>
                  {isCurrent ? t("home_current") : t("home_use")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <input className="input font-mono !text-xs flex-1 min-w-0" placeholder={t("home_custom")} value={custom} aria-label={t("home_custom")}
          onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && custom.trim()) void ask(custom.trim()); }} />
        <Button size="sm" disabled={!custom.trim() || !!busy || data.env_locked} onClick={() => ask(custom.trim())}>{t("home_use")}</Button>
      </div>
      {preview && (
        <div role="dialog" aria-label={t("home_preview_title")} className="panel-soft p-3 flex flex-col gap-2 text-sm">
          <b className="font-display">{t("home_preview_title")}</b>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs min-w-0">
            <dt className="text-muted">{t("home_preview_from")}</dt><dd className="font-mono break-all">{preview.from || "—"}</dd>
            <dt className="text-muted">{t("home_preview_to")}</dt><dd className="font-mono break-all">{preview.to}</dd>
          </dl>
          <div className="flex flex-wrap gap-1">
            {preview.version && <Badge tone="info">{preview.version}</Badge>}
            {preview.looks_like_home && <Badge>{t("home_profiles", { n: preview.profiles.length + 1 })}</Badge>}
            {!preview.runner && <Badge tone="warn">{t("home_runner_missing")}</Badge>}
          </div>
          <p className="text-xs text-ink-2">{t("home_preview_note")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" disabled={!!busy || !preview.changed}
              icon={busy === preview.to ? <Spinner size={13} /> : <Check size={13} />} onClick={() => void confirm()}>{t("home_confirm")}</Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setPreview(null)}>{t("home_cancel")}</Button>
          </div>
        </div>
      )}
      {data.wsl && <p className="text-xs text-muted">{data.wsl.note}</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {saved && <p role="status" className="text-sm text-ok">{t("home_saved")}</p>}
    </div>
  );
}
